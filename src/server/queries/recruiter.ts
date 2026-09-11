import "server-only";

import { and, asc, count, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";

import { db } from "@/db";
import {
  candidates,
  communications,
  interviewPanel,
  interviews,
  requisitions,
  stageEvents,
  submissions,
} from "@/db/schema";
import { loadPipeline } from "@/server/pipeline";

const DAY = 86_400_000;

export interface RecruiterScorecard {
  assignedRequirements: number;
  agingRequirements: number;
  sourced: number;
  screened: number;
  submitted: number;
  interviewsScheduled: number;
  interviewsCompleted: number;
  feedbackPending: number;
  selected: number;
  offers: number;
  joined: number;
  rejected: number;
  followUpsDue: number;
}

export interface ActivityPoint {
  week: string;
  label: string;
  added: number;
  submitted: number;
  interviews: number;
  contacts: number;
}

/**
 * One recruiter's desk (§12).
 *
 * Two different things are being counted here and the distinction matters.
 * **Stage counts** — selected, offers, joined — are where candidates *are*
 * right now, and answer "what does my desk look like". **Event counts** —
 * sourced, screened, submitted — are things that *happened* in a window, and
 * answer "what did I do". Mixing them produces a dashboard where the numbers
 * never reconcile and nobody can say why.
 */
export async function recruiterScorecard(
  userId: string,
  since = new Date(Date.now() - 90 * DAY),
): Promise<RecruiterScorecard> {
  const pipeline = await loadPipeline();

  const ownReqs = await db
    .select({ id: requisitions.id, openedAt: requisitions.openedAt, status: requisitions.status })
    .from(requisitions)
    .where(and(eq(requisitions.leadRecruiterId, userId), isNull(requisitions.deletedAt)));

  const openReqs = ownReqs.filter((r) => ["open", "on_hold", "draft"].includes(r.status));
  const agingRequirements = openReqs.filter(
    (r) => (Date.now() - new Date(r.openedAt).getTime()) / DAY > 15,
  ).length;

  // Where this desk's candidates are standing, by phase.
  const byStage = await db
    .select({ stage: submissions.stage, status: submissions.status, n: count() })
    .from(submissions)
    .where(and(eq(submissions.ownerId, userId), isNull(submissions.deletedAt)))
    .groupBy(submissions.stage, submissions.status);

  const liveIn = (kind: Parameters<typeof pipeline.ofKind>[0]) => {
    const stages = new Set(pipeline.ofKind(kind));
    return byStage
      .filter((r) => r.status === "active" && stages.has(r.stage))
      .reduce((n, r) => n + Number(r.n), 0);
  };

  const statusTotal = (status: string) =>
    byStage.filter((r) => r.status === status).reduce((n, r) => n + Number(r.n), 0);

  // What this desk *did* in the window. Read from stage events, because a
  // candidate who has since moved on was still screened by someone.
  const events = await db
    .select({ toStage: stageEvents.toStage, n: count() })
    .from(stageEvents)
    .innerJoin(submissions, eq(submissions.id, stageEvents.submissionId))
    .where(and(eq(submissions.ownerId, userId), gte(stageEvents.createdAt, since)))
    .groupBy(stageEvents.toStage);

  const reached = (stage: string) =>
    Number(events.find((e) => e.toStage === stage)?.n ?? 0);

  const sourcingStages = pipeline.ofKind("sourcing");
  const sourced = reached(sourcingStages[0] ?? "new");
  const screened = sourcingStages.slice(1).reduce((n, st) => n + reached(st), 0);
  const submitted = pipeline.ofKind("submitted").reduce((n, st) => n + reached(st), 0);

  const interviewRows = await db
    .select({ status: interviews.status, n: count() })
    .from(interviews)
    .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
    .where(and(eq(submissions.ownerId, userId), gte(interviews.scheduledAt, since)))
    .groupBy(interviews.status);

  const ivCount = (...statuses: string[]) =>
    interviewRows.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + Number(r.n), 0);

  // Scorecards this desk is still waiting on, from rounds it arranged.
  const feedbackPending = Number(
    (
      await db
        .select({ n: count() })
        .from(interviewPanel)
        .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
        .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
        .where(
          and(
            eq(submissions.ownerId, userId),
            eq(interviews.status, "completed"),
            eq(interviewPanel.feedbackStatus, "pending"),
          ),
        )
    )[0]?.n ?? 0,
  );

  const followUpsDue = Number(
    (
      await db
        .select({ n: count() })
        .from(communications)
        .where(
          and(
            eq(communications.loggedById, userId),
            isNull(communications.deletedAt),
            isNotNull(communications.followUpAt),
            lte(communications.followUpAt, new Date()),
          ),
        )
    )[0]?.n ?? 0,
  );

  return {
    assignedRequirements: openReqs.length,
    agingRequirements,
    sourced,
    screened,
    submitted,
    interviewsScheduled: ivCount("scheduled", "confirmed"),
    interviewsCompleted: ivCount("completed"),
    feedbackPending,
    selected: liveIn("offer"),
    offers: pipeline.ofKind("offer").length
      ? byStage
          .filter((r) => r.status === "active" && r.stage === pipeline.lastOf("offer"))
          .reduce((n, r) => n + Number(r.n), 0)
      : 0,
    joined: statusTotal("hired"),
    rejected: statusTotal("rejected") + statusTotal("withdrawn"),
    followUpsDue,
  };
}

/**
 * Weekly activity for one recruiter (§12).
 *
 * Four series rather than one total, because "busy" is not a number a
 * recruiter can act on — the useful question is whether the week was spent
 * sourcing or closing.
 */
export async function recruiterTrend(userId: string, weeks = 12): Promise<ActivityPoint[]> {
  const pipeline = await loadPipeline();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  // Back to the Monday of the earliest week in range.
  start.setDate(start.getDate() - (weeks - 1) * 7 - ((start.getDay() + 6) % 7));

  const buckets = new Map<string, ActivityPoint>();
  for (let i = 0; i < weeks; i += 1) {
    const d = new Date(start.getTime() + i * 7 * DAY);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, {
      week: key,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      added: 0,
      submitted: 0,
      interviews: 0,
      contacts: 0,
    });
  }

  const weekKey = (at: Date) => {
    const d = new Date(at);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  const firstStage = pipeline.order[0]!;
  const submittedStages = new Set(pipeline.ofKind("submitted"));

  for (const e of await db
    .select({ toStage: stageEvents.toStage, createdAt: stageEvents.createdAt })
    .from(stageEvents)
    .innerJoin(submissions, eq(submissions.id, stageEvents.submissionId))
    .where(and(eq(submissions.ownerId, userId), gte(stageEvents.createdAt, start)))) {
    const bucket = buckets.get(weekKey(e.createdAt));
    if (!bucket) continue;
    if (e.toStage === firstStage) bucket.added += 1;
    if (submittedStages.has(e.toStage)) bucket.submitted += 1;
  }

  for (const iv of await db
    .select({ scheduledAt: interviews.scheduledAt })
    .from(interviews)
    .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
    .where(and(eq(submissions.ownerId, userId), gte(interviews.scheduledAt, start)))) {
    const bucket = buckets.get(weekKey(iv.scheduledAt));
    if (bucket) bucket.interviews += 1;
  }

  for (const c of await db
    .select({ occurredAt: communications.occurredAt })
    .from(communications)
    .where(
      and(
        eq(communications.loggedById, userId),
        isNull(communications.deletedAt),
        gte(communications.occurredAt, start),
      ),
    )) {
    const bucket = buckets.get(weekKey(c.occurredAt));
    if (bucket) bucket.contacts += 1;
  }

  return [...buckets.values()];
}

/** Follow-ups this recruiter owes, soonest first. */
export async function recruiterFollowUps(userId: string, limit = 8) {
  const rows = await db
    .select({
      id: communications.id,
      candidateId: communications.candidateId,
      firstName: candidates.firstName,
      lastName: candidates.lastName,
      subject: communications.subject,
      channel: communications.channel,
      followUpAt: communications.followUpAt,
    })
    .from(communications)
    .innerJoin(candidates, eq(candidates.id, communications.candidateId))
    .where(
      and(
        eq(communications.loggedById, userId),
        isNull(communications.deletedAt),
        isNull(candidates.deletedAt),
        isNotNull(communications.followUpAt),
      ),
    )
    .orderBy(asc(communications.followUpAt))
    .limit(limit);

  // Overdue is decided here rather than in the view: the clock is a server
  // fact, and a component that reads it during render is one the framework is
  // entitled to re-run at any moment.
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    followUpAt: r.followUpAt!,
    overdue: r.followUpAt!.getTime() < now,
    candidateName: `${r.firstName} ${r.lastName}`,
  }));
}

/** Scorecards this person owes as a panelist, which is a different debt. */
export async function owedScorecards(userId: string) {
  return db
    .select({
      interviewId: interviews.id,
      title: interviews.title,
      scheduledAt: interviews.scheduledAt,
      feedbackDueAt: interviews.feedbackDueAt,
      candidateId: candidates.id,
      firstName: candidates.firstName,
      lastName: candidates.lastName,
      requisitionCode: requisitions.code,
    })
    .from(interviewPanel)
    .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
    .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(
      and(
        eq(interviewPanel.userId, userId),
        eq(interviewPanel.feedbackStatus, "pending"),
        eq(interviews.status, "completed"),
      ),
    )
    .orderBy(asc(interviews.scheduledAt))
    .limit(10);
}
