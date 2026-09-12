import "server-only";

import { once, queryKey } from "@/server/request-cache";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidates,
  clients,
  feedback,
  interviewPanel,
  interviews,
  requisitions,
  submissions,
  users,
} from "@/db/schema";
import type { User } from "@/db/schema";
import { overdueBucket, type OverdueBucket } from "@/lib/domain";
import { interviewScope } from "@/server/authz";

export interface InterviewFilters {
  window?: string; // upcoming | today | week | past | all | awaiting_feedback
  type?: string;
  status?: string;
  interviewer?: string;
  requisition?: string;
  /** Narrow to rounds whose scorecards have blown the SLA. */
  overdueOnly?: boolean;
}

export interface InterviewRow {
  id: string;
  round: number;
  title: string;
  type: string;
  mode: string;
  status: string;
  outcome: string;
  scheduledAt: Date;
  endsAt: Date;
  /** IANA zone the round was booked in, so a distributed panel can see whose morning it is. */
  timezone: string;
  /** Computed on the server so the client never reads the clock mid-render. */
  isUpcoming: boolean;
  durationMinutes: number;
  locationOrLink: string | null;
  agenda: string | null;
  submissionId: string;
  candidateId: string;
  candidateName: string;
  candidateTitle: string;
  requisitionId: string;
  requisitionCode: string;
  requisitionTitle: string;
  clientName: string;
  organizerName: string;
  panel: { id: string; name: string; role: string; hasFeedback: boolean; feedbackStatus: string }[];
  feedbackCount: number;
  /** Panelists who still owe a scorecard — people who stood down are excluded. */
  panelSize: number;
  outstandingFeedback: number;
  /** When every scorecard was due, and how late it is now (§10). */
  feedbackDueAt: Date | null;
  hoursLate: number;
  overdueBucket: OverdueBucket | null;
  avgRating: number | null;
  recommendations: string[];
  /** The competencies this round's scorecards are filled against. */
  scorecardTemplateId: string | null;
}

const DAY = 86_400_000;

/** Exported so the sidebar's `count(*)` uses the same day boundary the list does. */
export function startOfDay(d = new Date()) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

async function loadInterviews(
  filters: InterviewFilters = {},
  actor?: User,
): Promise<InterviewRow[]> {
  const now = Date.now();
  const conditions = [];

  if (actor) {
    const scope = await interviewScope(actor);
    if (scope) conditions.push(scope);
  }

  switch (filters.window) {
    case "today":
      conditions.push(
        gte(interviews.scheduledAt, startOfDay()),
        lte(interviews.scheduledAt, new Date(startOfDay().getTime() + DAY)),
      );
      break;
    case "week":
      conditions.push(
        gte(interviews.scheduledAt, startOfDay()),
        lte(interviews.scheduledAt, new Date(startOfDay().getTime() + 7 * DAY)),
      );
      break;
    case "past":
    // Feedback can only be outstanding on a round that already happened, so
    // this window is scoped the same way "past" is.
    case "awaiting_feedback":
      conditions.push(lte(interviews.scheduledAt, new Date(now)));
      break;
    case "all":
      break;
    case "upcoming":
    default:
      conditions.push(gte(interviews.scheduledAt, new Date(now)));
      break;
  }

  if (filters.type && filters.type !== "all") conditions.push(eq(interviews.type, filters.type));
  if (filters.status && filters.status !== "all") conditions.push(eq(interviews.status, filters.status));
  if (filters.requisition && filters.requisition !== "all")
    conditions.push(eq(requisitions.id, filters.requisition));

  const rows = (await db
    .select({
      interview: interviews,
      candidate: candidates,
      requisition: requisitions,
      clientName: clients.name,
      organizerName: users.name,
    })
    .from(interviews)
    .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .innerJoin(users, eq(users.id, interviews.organizerId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      filters.window === "past" || filters.window === "awaiting_feedback"
        ? sql`${interviews.scheduledAt} desc`
        : asc(interviews.scheduledAt),
    )
    );

  const ids = rows.map((r) => r.interview.id);
  if (!ids.length) return [];

  const panelRows = (await db
    .select({
      interviewId: interviewPanel.interviewId,
      user: users,
      role: interviewPanel.role,
      feedbackStatus: interviewPanel.feedbackStatus,
    })
    .from(interviewPanel)
    .innerJoin(users, eq(users.id, interviewPanel.userId))
    .where(inArray(interviewPanel.interviewId, ids))
    );

  const feedbackRows = (await db
    .select({
      interviewId: feedback.interviewId,
      interviewerId: feedback.interviewerId,
      overall: feedback.overall,
      recommendation: feedback.recommendation,
    })
    .from(feedback)
    .where(inArray(feedback.interviewId, ids))
    );

  const panelByInterview = new Map<
    string,
    { id: string; name: string; role: string; feedbackStatus: string }[]
  >();
  for (const p of panelRows) {
    const list = panelByInterview.get(p.interviewId) ?? [];
    list.push({ id: p.user.id, name: p.user.name, role: p.role, feedbackStatus: p.feedbackStatus });
    panelByInterview.set(p.interviewId, list);
  }

  const fbByInterview = new Map<string, typeof feedbackRows>();
  for (const f of feedbackRows) {
    const list = fbByInterview.get(f.interviewId) ?? [];
    list.push(f);
    fbByInterview.set(f.interviewId, list);
  }

  let result: InterviewRow[] = rows.map(({ interview: i, candidate: c, requisition: r, clientName, organizerName }) => {
    const panel = panelByInterview.get(i.id) ?? [];
    const fbs = fbByInterview.get(i.id) ?? [];
    const submitted = new Set(fbs.map((f) => f.interviewerId));
    const owed = panel.some((p) => p.feedbackStatus === "pending");
    const hoursLate =
      owed && i.feedbackDueAt ? Math.max(0, (now - i.feedbackDueAt.getTime()) / 3_600_000) : 0;
    return {
      id: i.id,
      round: i.round,
      title: i.title,
      type: i.type,
      mode: i.mode,
      status: i.status,
      outcome: i.outcome,
      scheduledAt: i.scheduledAt,
      endsAt: i.endsAt,
      timezone: i.timezone,
      isUpcoming: i.scheduledAt.getTime() > now,
      durationMinutes: i.durationMinutes,
      locationOrLink: i.locationOrLink,
      agenda: i.agenda,
      submissionId: i.submissionId,
      candidateId: c.id,
      candidateName: `${c.firstName} ${c.lastName}`,
      candidateTitle: c.currentTitle,
      requisitionId: r.id,
      requisitionCode: r.code,
      requisitionTitle: r.title,
      clientName,
      organizerName,
      panel: panel.map((p) => ({ ...p, hasFeedback: submitted.has(p.id) })),
      feedbackCount: fbs.length,
      panelSize: panel.length,
      // Someone who stood down is not outstanding — chasing them is noise.
      outstandingFeedback: panel.filter((p) => p.feedbackStatus === "pending").length,
      feedbackDueAt: i.feedbackDueAt,
      hoursLate,
      overdueBucket: overdueBucket(hoursLate),
      avgRating: fbs.length ? fbs.reduce((s, f) => s + f.overall, 0) / fbs.length : null,
      recommendations: fbs.map((f) => f.recommendation),
      scorecardTemplateId: r.scorecardTemplateId,
    };
  });

  if (filters.interviewer && filters.interviewer !== "all") {
    result = result.filter((r) => r.panel.some((p) => p.id === filters.interviewer));
  }
  if (filters.window === "awaiting_feedback") {
    result = result.filter((r) => r.status === "completed" && r.outstandingFeedback > 0);
  }
  if (filters.overdueOnly) {
    result = result.filter((r) => r.overdueBucket !== null);
  }

  return result;
}

/**
 * Completed rounds where somebody still owes a scorecard, most overdue first.
 *
 * Sorted by lateness rather than date, because the point of this list is the
 * chase order: a round that is four days late outranks one from this morning.
 */
export async function awaitingFeedback(limit?: number, actor?: User) {
  const rows = (await listInterviews({ window: "past", status: "completed" }, actor))
    .filter((r) => r.outstandingFeedback > 0)
    .sort((a, b) => b.hoursLate - a.hoursLate);
  return limit ? rows.slice(0, limit) : rows;
}

/** The overdue-scorecard view, bucketed the way §10 asks to report it. */
export async function feedbackSlaBuckets(actor?: User) {
  const rows = await awaitingFeedback(undefined, actor);
  const buckets = new Map<OverdueBucket | "on_time", InterviewRow[]>();
  for (const row of rows) {
    const key = row.overdueBucket ?? "on_time";
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  return buckets;
}

export async function getInterview(interviewId: string) {
  const row = (await db
    .select({
      interview: interviews,
      candidate: candidates,
      requisition: requisitions,
      clientName: clients.name,
      organizer: users,
      submission: submissions,
    })
    .from(interviews)
    .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .innerJoin(users, eq(users.id, interviews.organizerId))
    .where(eq(interviews.id, interviewId))
    )[0];

  if (!row) return null;

  const panel = (await db
    .select({ user: users, role: interviewPanel.role })
    .from(interviewPanel)
    .innerJoin(users, eq(users.id, interviewPanel.userId))
    .where(eq(interviewPanel.interviewId, interviewId))
    );

  const fbs = (await db
    .select({ feedback, interviewer: users })
    .from(feedback)
    .innerJoin(users, eq(users.id, feedback.interviewerId))
    .where(eq(feedback.interviewId, interviewId))
    );

  return { ...row, panel, feedback: fbs };
}

/** Group interviews into calendar days for the schedule view. */
export function groupByDay(rows: InterviewRow[]) {
  const map = new Map<string, InterviewRow[]>();
  for (const r of rows) {
    const key = r.scheduledAt.toISOString().slice(0, 10);
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.entries()].map(([date, items]) => ({ date, items }));
}

export async function interviewerOptions() {
  return (await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.role, ["interviewer", "hiring_manager", "recruiter", "recruitment_manager", "super_admin"]))
    .orderBy(asc(users.name))
    );
}

/** listInterviews, memoised for the request — see `server/request-cache.ts`. */
export function listInterviews(
  filters: InterviewFilters = {},
  actor?: User,
): Promise<InterviewRow[]> {
  return once(queryKey("interviews", filters, actor?.id), () => loadInterviews(filters, actor));
}
