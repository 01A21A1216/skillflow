import "server-only";

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

export interface InterviewFilters {
  window?: string; // upcoming | today | week | past | all | awaiting_feedback
  type?: string;
  status?: string;
  interviewer?: string;
  requisition?: string;
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
  panel: { id: string; name: string; role: string; hasFeedback: boolean }[];
  feedbackCount: number;
  panelSize: number;
  avgRating: number | null;
  recommendations: string[];
}

const DAY = 86_400_000;

function startOfDay(d = new Date()) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function listInterviews(filters: InterviewFilters = {}): InterviewRow[] {
  const now = Date.now();
  const conditions = [];

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

  const rows = db
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
    .all();

  const ids = rows.map((r) => r.interview.id);
  if (!ids.length) return [];

  const panelRows = db
    .select({ interviewId: interviewPanel.interviewId, user: users, role: interviewPanel.role })
    .from(interviewPanel)
    .innerJoin(users, eq(users.id, interviewPanel.userId))
    .where(inArray(interviewPanel.interviewId, ids))
    .all();

  const feedbackRows = db
    .select({
      interviewId: feedback.interviewId,
      interviewerId: feedback.interviewerId,
      overall: feedback.overall,
      recommendation: feedback.recommendation,
    })
    .from(feedback)
    .where(inArray(feedback.interviewId, ids))
    .all();

  const panelByInterview = new Map<string, { id: string; name: string; role: string }[]>();
  for (const p of panelRows) {
    const list = panelByInterview.get(p.interviewId) ?? [];
    list.push({ id: p.user.id, name: p.user.name, role: p.role });
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
    return {
      id: i.id,
      round: i.round,
      title: i.title,
      type: i.type,
      mode: i.mode,
      status: i.status,
      outcome: i.outcome,
      scheduledAt: i.scheduledAt,
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
      avgRating: fbs.length ? fbs.reduce((s, f) => s + f.overall, 0) / fbs.length : null,
      recommendations: fbs.map((f) => f.recommendation),
    };
  });

  if (filters.interviewer && filters.interviewer !== "all") {
    result = result.filter((r) => r.panel.some((p) => p.id === filters.interviewer));
  }
  if (filters.window === "awaiting_feedback") {
    result = result.filter((r) => r.status === "completed" && r.feedbackCount < r.panelSize);
  }

  return result;
}

/** Completed interviews where at least one panelist still owes feedback. */
export function awaitingFeedback(limit?: number) {
  const rows = listInterviews({ window: "past", status: "completed" }).filter(
    (r) => r.feedbackCount < r.panelSize,
  );
  return limit ? rows.slice(0, limit) : rows;
}

export function getInterview(interviewId: string) {
  const row = db
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
    .get();

  if (!row) return null;

  const panel = db
    .select({ user: users, role: interviewPanel.role })
    .from(interviewPanel)
    .innerJoin(users, eq(users.id, interviewPanel.userId))
    .where(eq(interviewPanel.interviewId, interviewId))
    .all();

  const fbs = db
    .select({ feedback, interviewer: users })
    .from(feedback)
    .innerJoin(users, eq(users.id, feedback.interviewerId))
    .where(eq(feedback.interviewId, interviewId))
    .all();

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

export function interviewerOptions() {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.role, ["interviewer", "hiring_manager", "recruiter", "admin"]))
    .orderBy(asc(users.name))
    .all();
}
