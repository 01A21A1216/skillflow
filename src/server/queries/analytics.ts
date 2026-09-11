import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidates,
  clients,
  feedback,
  interviewPanel,
  interviews,
  offers,
  requisitions,
  stageEvents,
  submissions,
  users,
} from "@/db/schema";
import { PIPELINE_STAGES, STAGE_ORDER, type Stage } from "@/lib/domain";
import { average, daysBetween, median, pct } from "@/lib/utils";

const DAY = 86_400_000;

export interface Period {
  days: number;
  label: string;
}

export const PERIODS: Record<string, Period> = {
  "30": { days: 30, label: "Last 30 days" },
  "90": { days: 90, label: "Last quarter" },
  "180": { days: 180, label: "Last 6 months" },
  "365": { days: 365, label: "Last 12 months" },
  all: { days: 3650, label: "All time" },
};

export function resolvePeriod(key?: string): Period & { since: Date; key: string } {
  const k = key && key in PERIODS ? key : "180";
  const period = PERIODS[k]!;
  return { ...period, key: k, since: new Date(Date.now() - period.days * DAY) };
}

/* ------------------------------------------------------------------ *
 * Funnel — how many submissions ever reached each stage
 * ------------------------------------------------------------------ */

export interface FunnelStep {
  stage: Stage;
  label: string;
  count: number;
  /** Conversion from the previous step. */
  stepConversion: number;
  /** Conversion from the top of the funnel. */
  overallConversion: number;
  dropOff: number;
}

export function funnel(since?: Date): FunnelStep[] {
  const rows = db
    .select({ stage: stageEvents.toStage, count: sql<number>`count(distinct ${stageEvents.submissionId})` })
    .from(stageEvents)
    .where(since ? gte(stageEvents.createdAt, since) : undefined)
    .groupBy(stageEvents.toStage)
    .all();

  const byStage = new Map(rows.map((r) => [r.stage, r.count]));
  const top = byStage.get("sourced") ?? 0;

  return PIPELINE_STAGES.map((meta, i) => {
    const count = byStage.get(meta.value) ?? 0;
    const prev = i === 0 ? count : (byStage.get(PIPELINE_STAGES[i - 1]!.value) ?? 0);
    return {
      stage: meta.value,
      label: meta.label,
      count,
      stepConversion: prev ? pct(count, prev) : 0,
      overallConversion: top ? pct(count, top) : 0,
      dropOff: Math.max(0, prev - count),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Velocity — how long things actually take
 * ------------------------------------------------------------------ */

export interface StageVelocity {
  stage: Stage;
  label: string;
  avgDays: number;
  medianDays: number;
  samples: number;
}

export function stageVelocity(since?: Date): StageVelocity[] {
  const events = db
    .select({
      submissionId: stageEvents.submissionId,
      toStage: stageEvents.toStage,
      createdAt: stageEvents.createdAt,
    })
    .from(stageEvents)
    .where(since ? gte(stageEvents.createdAt, since) : undefined)
    .orderBy(stageEvents.submissionId, stageEvents.createdAt)
    .all();

  const durations = new Map<string, number[]>();
  let currentSub: string | null = null;
  let prev: { stage: string; at: number } | null = null;

  for (const e of events) {
    if (e.submissionId !== currentSub) {
      currentSub = e.submissionId;
      prev = null;
    }
    if (prev) {
      const days = (e.createdAt.getTime() - prev.at) / DAY;
      if (days >= 0 && days < 400) {
        const list = durations.get(prev.stage) ?? [];
        list.push(days);
        durations.set(prev.stage, list);
      }
    }
    prev = { stage: e.toStage, at: e.createdAt.getTime() };
  }

  return PIPELINE_STAGES.filter((s) => s.value !== "hired").map((meta) => {
    const values = durations.get(meta.value) ?? [];
    return {
      stage: meta.value,
      label: meta.label,
      avgDays: average(values),
      medianDays: median(values),
      samples: values.length,
    };
  });
}

export interface TimeToHire {
  timeToFillDays: number[];
  timeToHireDays: number[];
  avgTimeToFill: number;
  medianTimeToFill: number;
  avgTimeToHire: number;
  medianTimeToHire: number;
}

export function timeToHire(since?: Date): TimeToHire {
  const hires = db
    .select({
      submissionId: submissions.id,
      createdAt: submissions.createdAt,
      stageSince: submissions.stageSince,
      reqOpenedAt: requisitions.openedAt,
    })
    .from(submissions)
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(
      since
        ? and(eq(submissions.status, "hired"), gte(submissions.stageSince, since))
        : eq(submissions.status, "hired"),
    )
    .all();

  const timeToFillDays: number[] = [];
  const timeToHireDays: number[] = [];

  for (const h of hires) {
    const fill = daysBetween(h.reqOpenedAt, h.stageSince);
    const hire = daysBetween(h.createdAt, h.stageSince);
    if (fill >= 0 && fill < 500) timeToFillDays.push(fill);
    if (hire >= 0 && hire < 500) timeToHireDays.push(hire);
  }

  return {
    timeToFillDays,
    timeToHireDays,
    avgTimeToFill: average(timeToFillDays),
    medianTimeToFill: median(timeToFillDays),
    avgTimeToHire: average(timeToHireDays),
    medianTimeToHire: median(timeToHireDays),
  };
}

/* ------------------------------------------------------------------ *
 * Trends
 * ------------------------------------------------------------------ */

export interface MonthPoint {
  month: string;
  label: string;
  added: number;
  submitted: number;
  interviewed: number;
  offers: number;
  hires: number;
}

export function monthlyTrend(months = 12): MonthPoint[] {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - (months - 1));

  const buckets = new Map<string, MonthPoint>();
  for (let i = 0; i < months; i += 1) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, {
      month: key,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      added: 0,
      submitted: 0,
      interviewed: 0,
      offers: 0,
      hires: 0,
    });
  }

  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const events = db
    .select({ toStage: stageEvents.toStage, createdAt: stageEvents.createdAt })
    .from(stageEvents)
    .where(gte(stageEvents.createdAt, start))
    .all();

  for (const e of events) {
    const bucket = buckets.get(keyOf(e.createdAt));
    if (!bucket) continue;
    if (e.toStage === "sourced") bucket.added += 1;
    if (e.toStage === "submitted") bucket.submitted += 1;
    if (e.toStage === "interview") bucket.interviewed += 1;
    if (e.toStage === "offer") bucket.offers += 1;
    if (e.toStage === "hired") bucket.hires += 1;
  }

  return [...buckets.values()];
}

/* ------------------------------------------------------------------ *
 * Source effectiveness
 * ------------------------------------------------------------------ */

export interface SourceStat {
  source: string;
  candidates: number;
  submitted: number;
  interviewed: number;
  hires: number;
  submitRate: number;
  hireRate: number;
  avgDaysToHire: number;
}

export function sourceEffectiveness(since?: Date): SourceStat[] {
  const rows = db
    .select({
      source: candidates.source,
      stage: submissions.stage,
      status: submissions.status,
      createdAt: submissions.createdAt,
      stageSince: submissions.stageSince,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .where(since ? gte(submissions.createdAt, since) : undefined)
    .all();

  const reached = db
    .select({
      source: candidates.source,
      toStage: stageEvents.toStage,
      count: sql<number>`count(distinct ${stageEvents.submissionId})`,
    })
    .from(stageEvents)
    .innerJoin(submissions, eq(submissions.id, stageEvents.submissionId))
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .where(since ? gte(stageEvents.createdAt, since) : undefined)
    .groupBy(candidates.source, stageEvents.toStage)
    .all();

  const map = new Map<string, SourceStat & { hireDays: number[] }>();
  const ensure = (source: string) => {
    let entry = map.get(source);
    if (!entry) {
      entry = {
        source,
        candidates: 0,
        submitted: 0,
        interviewed: 0,
        hires: 0,
        submitRate: 0,
        hireRate: 0,
        avgDaysToHire: 0,
        hireDays: [],
      };
      map.set(source, entry);
    }
    return entry;
  };

  for (const r of rows) {
    const entry = ensure(r.source);
    entry.candidates += 1;
    if (r.status === "hired") {
      const days = daysBetween(r.createdAt, r.stageSince);
      if (days >= 0 && days < 500) entry.hireDays.push(days);
    }
  }
  for (const r of reached) {
    const entry = ensure(r.source);
    if (r.toStage === "submitted") entry.submitted = r.count;
    if (r.toStage === "interview") entry.interviewed = r.count;
    if (r.toStage === "hired") entry.hires = r.count;
  }

  return [...map.values()]
    .map(({ hireDays, ...rest }) => ({
      ...rest,
      submitRate: pct(rest.submitted, rest.candidates),
      hireRate: pct(rest.hires, rest.candidates),
      avgDaysToHire: average(hireDays),
    }))
    .sort((a, b) => b.candidates - a.candidates);
}

/* ------------------------------------------------------------------ *
 * Recruiter performance
 * ------------------------------------------------------------------ */

export interface RecruiterStat {
  id: string;
  name: string;
  title: string;
  capacity: number;
  openReqs: number;
  activePipeline: number;
  submitted: number;
  interviewed: number;
  offers: number;
  hires: number;
  submitToInterview: number;
  interviewToOffer: number;
  offerAcceptance: number;
  avgTimeToHire: number;
  load: number;
}

export function recruiterPerformance(since?: Date): RecruiterStat[] {
  const people = db
    .select()
    .from(users)
    .where(inArray(users.role, ["recruiter", "admin"]))
    .all()
    .filter((u) => u.capacity > 0);

  const openReqRows = db
    .select({ recruiterId: requisitions.leadRecruiterId, count: sql<number>`count(*)` })
    .from(requisitions)
    .where(inArray(requisitions.status, ["open", "on_hold", "draft"]))
    .groupBy(requisitions.leadRecruiterId)
    .all();
  const openReqs = new Map(openReqRows.map((r) => [r.recruiterId, r.count]));

  const activeRows = db
    .select({ ownerId: submissions.ownerId, count: sql<number>`count(*)` })
    .from(submissions)
    .where(eq(submissions.status, "active"))
    .groupBy(submissions.ownerId)
    .all();
  const activePipeline = new Map(activeRows.map((r) => [r.ownerId, r.count]));

  const reachedRows = db
    .select({
      ownerId: submissions.ownerId,
      toStage: stageEvents.toStage,
      count: sql<number>`count(distinct ${stageEvents.submissionId})`,
    })
    .from(stageEvents)
    .innerJoin(submissions, eq(submissions.id, stageEvents.submissionId))
    .where(since ? gte(stageEvents.createdAt, since) : undefined)
    .groupBy(submissions.ownerId, stageEvents.toStage)
    .all();

  const reached = new Map<string, Record<string, number>>();
  for (const r of reachedRows) {
    const entry = reached.get(r.ownerId) ?? {};
    entry[r.toStage] = r.count;
    reached.set(r.ownerId, entry);
  }

  const offerRows = db
    .select({ ownerId: submissions.ownerId, status: offers.status, count: sql<number>`count(*)` })
    .from(offers)
    .innerJoin(submissions, eq(submissions.id, offers.submissionId))
    .where(since ? gte(offers.createdAt, since) : undefined)
    .groupBy(submissions.ownerId, offers.status)
    .all();

  const offerTally = new Map<string, { accepted: number; declined: number }>();
  for (const r of offerRows) {
    const entry = offerTally.get(r.ownerId) ?? { accepted: 0, declined: 0 };
    if (r.status === "accepted") entry.accepted += r.count;
    if (r.status === "declined") entry.declined += r.count;
    offerTally.set(r.ownerId, entry);
  }

  const hireRows = db
    .select({
      ownerId: submissions.ownerId,
      createdAt: submissions.createdAt,
      stageSince: submissions.stageSince,
    })
    .from(submissions)
    .where(eq(submissions.status, "hired"))
    .all();

  const hireDays = new Map<string, number[]>();
  for (const r of hireRows) {
    const days = daysBetween(r.createdAt, r.stageSince);
    if (days < 0 || days > 500) continue;
    const list = hireDays.get(r.ownerId) ?? [];
    list.push(days);
    hireDays.set(r.ownerId, list);
  }

  return people
    .map((u) => {
      const r = reached.get(u.id) ?? {};
      const o = offerTally.get(u.id) ?? { accepted: 0, declined: 0 };
      const responded = o.accepted + o.declined;
      const open = openReqs.get(u.id) ?? 0;
      return {
        id: u.id,
        name: u.name,
        title: u.title,
        capacity: u.capacity,
        openReqs: open,
        activePipeline: activePipeline.get(u.id) ?? 0,
        submitted: r.submitted ?? 0,
        interviewed: r.interview ?? 0,
        offers: r.offer ?? 0,
        hires: r.hired ?? 0,
        submitToInterview: pct(r.interview ?? 0, r.submitted ?? 0),
        interviewToOffer: pct(r.offer ?? 0, r.interview ?? 0),
        offerAcceptance: responded ? pct(o.accepted, responded) : 0,
        avgTimeToHire: average(hireDays.get(u.id) ?? []),
        load: u.capacity ? pct(open, u.capacity) : 0,
      };
    })
    .sort((a, b) => b.hires - a.hires || b.activePipeline - a.activePipeline);
}

/* ------------------------------------------------------------------ *
 * Breakdowns
 * ------------------------------------------------------------------ */

export function departmentBreakdown() {
  const rows = db
    .select({
      department: requisitions.department,
      openings: sql<number>`sum(${requisitions.openings})`,
      filled: sql<number>`sum(${requisitions.filled})`,
      reqs: sql<number>`count(*)`,
    })
    .from(requisitions)
    .groupBy(requisitions.department)
    .all();

  const active = db
    .select({ department: requisitions.department, count: sql<number>`count(*)` })
    .from(submissions)
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.status, "active"))
    .groupBy(requisitions.department)
    .all();
  const activeMap = new Map(active.map((r) => [r.department, r.count]));

  return rows
    .map((r) => ({
      ...r,
      activePipeline: activeMap.get(r.department) ?? 0,
      fillRate: pct(r.filled, r.openings),
    }))
    .sort((a, b) => b.openings - a.openings);
}

export function clientBreakdown() {
  const rows = db
    .select({
      id: clients.id,
      name: clients.name,
      tier: clients.tier,
      industry: clients.industry,
      slaDays: clients.slaDays,
      reqs: sql<number>`count(${requisitions.id})`,
      openings: sql<number>`coalesce(sum(${requisitions.openings}), 0)`,
      filled: sql<number>`coalesce(sum(${requisitions.filled}), 0)`,
    })
    .from(clients)
    .leftJoin(requisitions, eq(requisitions.clientId, clients.id))
    .groupBy(clients.id)
    .all();

  const open = db
    .select({ clientId: requisitions.clientId, count: sql<number>`count(*)` })
    .from(requisitions)
    .where(inArray(requisitions.status, ["open", "on_hold", "draft"]))
    .groupBy(requisitions.clientId)
    .all();
  const openMap = new Map(open.map((r) => [r.clientId, r.count]));

  const active = db
    .select({ clientId: requisitions.clientId, count: sql<number>`count(*)` })
    .from(submissions)
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.status, "active"))
    .groupBy(requisitions.clientId)
    .all();
  const activeMap = new Map(active.map((r) => [r.clientId, r.count]));

  return rows
    .map((r) => ({
      ...r,
      openReqs: openMap.get(r.id) ?? 0,
      activePipeline: activeMap.get(r.id) ?? 0,
      fillRate: pct(r.filled, r.openings),
    }))
    .sort((a, b) => b.openReqs - a.openReqs || b.reqs - a.reqs);
}

export function rejectionReasons(since?: Date) {
  const rows = db
    .select({
      reason: submissions.rejectionReason,
      stage: submissions.stage,
      count: sql<number>`count(*)`,
    })
    .from(submissions)
    .where(
      since
        ? and(inArray(submissions.status, ["rejected", "withdrawn"]), gte(submissions.rejectedAt, since))
        : inArray(submissions.status, ["rejected", "withdrawn"]),
    )
    .groupBy(submissions.rejectionReason)
    .all();

  const total = rows.reduce((s, r) => s + r.count, 0);
  return rows
    .filter((r) => r.reason)
    .map((r) => ({ reason: r.reason!, count: r.count, share: pct(r.count, total) }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ *
 * Interview and feedback quality
 * ------------------------------------------------------------------ */

export function interviewAnalytics(since?: Date) {
  const rows = db
    .select({
      type: interviews.type,
      status: interviews.status,
      outcome: interviews.outcome,
      scheduledAt: interviews.scheduledAt,
      duration: interviews.durationMinutes,
    })
    .from(interviews)
    .where(since ? gte(interviews.scheduledAt, since) : undefined)
    .all();

  const byType = new Map<string, { total: number; completed: number; positive: number }>();
  for (const r of rows) {
    const entry = byType.get(r.type) ?? { total: 0, completed: 0, positive: 0 };
    entry.total += 1;
    if (r.status === "completed") entry.completed += 1;
    if (r.outcome.includes("yes")) entry.positive += 1;
    byType.set(r.type, entry);
  }

  const completed = rows.filter((r) => r.status === "completed").length;
  const noShows = rows.filter((r) => r.status === "no_show").length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;
  const totalHours = rows.reduce((s, r) => s + r.duration, 0) / 60;

  // Feedback turnaround: interview end to feedback submission.
  const fbRows = db
    .select({
      submittedAt: feedback.submittedAt,
      scheduledAt: interviews.scheduledAt,
      recommendation: feedback.recommendation,
      overall: feedback.overall,
    })
    .from(feedback)
    .innerJoin(interviews, eq(interviews.id, feedback.interviewId))
    .where(since ? gte(interviews.scheduledAt, since) : undefined)
    .all();

  const turnaround = fbRows
    .filter((r) => r.submittedAt)
    .map((r) => (r.submittedAt!.getTime() - r.scheduledAt.getTime()) / DAY)
    .filter((d) => d >= 0 && d < 30);

  const recommendationMix = new Map<string, number>();
  for (const r of fbRows) {
    recommendationMix.set(r.recommendation, (recommendationMix.get(r.recommendation) ?? 0) + 1);
  }

  return {
    total: rows.length,
    completed,
    noShows,
    cancelled,
    completionRate: pct(completed, rows.length),
    noShowRate: pct(noShows, rows.length),
    totalHours,
    avgFeedbackTurnaroundDays: average(turnaround),
    avgRating: average(fbRows.map((r) => r.overall)),
    byType: [...byType.entries()]
      .map(([type, v]) => ({
        type,
        ...v,
        passRate: pct(v.positive, v.completed),
      }))
      .sort((a, b) => b.total - a.total),
    recommendationMix: [...recommendationMix.entries()]
      .map(([recommendation, count]) => ({ recommendation, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Interview hours carried by each panelist — used to spot burnout. */
export function interviewerLoad(since?: Date) {
  const rows = db
    .select({
      userId: interviewPanel.userId,
      name: users.name,
      title: users.title,
      department: users.department,
      duration: interviews.durationMinutes,
      status: interviews.status,
      interviewId: interviews.id,
    })
    .from(interviewPanel)
    .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
    .innerJoin(users, eq(users.id, interviewPanel.userId))
    .where(since ? gte(interviews.scheduledAt, since) : undefined)
    .all();

  const submitted = new Set(
    db
      .select({ key: sql<string>`${feedback.interviewId} || ':' || ${feedback.interviewerId}` })
      .from(feedback)
      .all()
      .map((r) => r.key),
  );

  const map = new Map<
    string,
    { id: string; name: string; title: string; department: string; interviews: number; hours: number; owed: number }
  >();

  for (const r of rows) {
    const entry =
      map.get(r.userId) ??
      { id: r.userId, name: r.name, title: r.title, department: r.department, interviews: 0, hours: 0, owed: 0 };
    entry.interviews += 1;
    entry.hours += r.duration / 60;
    if (r.status === "completed" && !submitted.has(`${r.interviewId}:${r.userId}`)) entry.owed += 1;
    map.set(r.userId, entry);
  }

  return [...map.values()].sort((a, b) => b.hours - a.hours);
}

/* ------------------------------------------------------------------ *
 * Pipeline health snapshot
 * ------------------------------------------------------------------ */

export function pipelineAging() {
  const rows = db
    .select({ stage: submissions.stage, stageSince: submissions.stageSince })
    .from(submissions)
    .where(eq(submissions.status, "active"))
    .all();

  const buckets = [
    { label: "0-7 days", min: 0, max: 7, count: 0 },
    { label: "8-14 days", min: 8, max: 14, count: 0 },
    { label: "15-30 days", min: 15, max: 30, count: 0 },
    { label: "31-60 days", min: 31, max: 60, count: 0 },
    { label: "60+ days", min: 61, max: Infinity, count: 0 },
  ];

  const byStage = new Map<Stage, number[]>();
  for (const r of rows) {
    const days = daysBetween(r.stageSince);
    const bucket = buckets.find((b) => days >= b.min && days <= b.max);
    if (bucket) bucket.count += 1;
    const list = byStage.get(r.stage as Stage) ?? [];
    list.push(days);
    byStage.set(r.stage as Stage, list);
  }

  return {
    buckets,
    byStage: STAGE_ORDER.map((stage) => ({
      stage,
      count: byStage.get(stage)?.length ?? 0,
      avgDays: average(byStage.get(stage) ?? []),
    })),
  };
}

export function offerTrend(months = 12) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - (months - 1));

  const rows = db
    .select({ status: offers.status, respondedAt: offers.respondedAt, createdAt: offers.createdAt })
    .from(offers)
    .where(gte(offers.createdAt, start))
    .all();

  const buckets = new Map<string, { month: string; label: string; accepted: number; declined: number; rate: number }>();
  for (let i = 0; i < months; i += 1) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, {
      month: key,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      accepted: 0,
      declined: 0,
      rate: 0,
    });
  }

  for (const r of rows) {
    if (!r.respondedAt || !["accepted", "declined"].includes(r.status)) continue;
    const key = `${r.respondedAt.getFullYear()}-${String(r.respondedAt.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (r.status === "accepted") bucket.accepted += 1;
    else bucket.declined += 1;
  }

  return [...buckets.values()].map((b) => ({
    ...b,
    rate: b.accepted + b.declined ? pct(b.accepted, b.accepted + b.declined) : 0,
  }));
}
