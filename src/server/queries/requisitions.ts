import "server-only";

import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  candidates,
  clients,
  interviews,
  notes,
  offers,
  requisitionAssignees,
  requisitions,
  submissions,
  users,
} from "@/db/schema";
import { ACTIVE_STAGES, PRIORITY_WEIGHT, type Priority, type Stage } from "@/lib/domain";
import { daysBetween } from "@/lib/utils";
import type { User } from "@/db/schema";
import { requisitionScope, visibleRequisitionIds } from "@/server/authz";

export interface RequisitionFilters {
  q?: string;
  status?: string;
  priority?: string;
  department?: string;
  client?: string;
  recruiter?: string;
  workMode?: string;
  employmentType?: string;
  sort?: string;
  health?: string;
}

export interface RequisitionRow {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  department: string;
  location: string;
  workMode: string;
  employmentType: string;
  seniority: string;
  openings: number;
  filled: number;
  minSalary: number | null;
  maxSalary: number | null;
  currency: string;
  openedAt: string;
  targetFillDate: string | null;
  closedAt: string | null;
  clientId: string;
  clientName: string;
  clientTier: string;
  recruiterId: string;
  recruiterName: string;
  hiringManagerId: string;
  hiringManagerName: string;
  skills: string[];
  /** Derived pipeline counts. */
  activeCount: number;
  submittedCount: number;
  interviewCount: number;
  offerCount: number;
  hiredCount: number;
  totalCount: number;
  ageDays: number;
  daysToTarget: number | null;
}

const ACTIVE_SET = ACTIVE_STAGES as readonly string[];

/**
 * One pass over submissions, grouped by requisition. Small enough dataset
 * that a single aggregate beats N per-row lookups.
 */
async function pipelineCounts() {
  const rows = (await db
    .select({
      requisitionId: submissions.requisitionId,
      stage: submissions.stage,
      status: submissions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(submissions)
    .groupBy(submissions.requisitionId, submissions.stage, submissions.status)
    );

  const map = new Map<
    string,
    { active: number; submitted: number; interview: number; offer: number; hired: number; total: number }
  >();

  for (const r of rows) {
    const entry =
      map.get(r.requisitionId) ??
      { active: 0, submitted: 0, interview: 0, offer: 0, hired: 0, total: 0 };
    entry.total += r.count;
    if (r.status === "active" && ACTIVE_SET.includes(r.stage)) {
      entry.active += r.count;
      if (r.stage === "submitted") entry.submitted += r.count;
      if (r.stage === "interview") entry.interview += r.count;
      if (r.stage === "offer") entry.offer += r.count;
    }
    if (r.status === "hired") entry.hired += r.count;
    map.set(r.requisitionId, entry);
  }
  return map;
}

export async function listRequisitions(
  filters: RequisitionFilters = {},
  actor?: User,
): Promise<RequisitionRow[]> {
  const hm = alias(users, "hm");
  const conditions = [];

  // Row-level scope. Applied as SQL so out-of-scope rows are never loaded,
  // rather than filtered out after the fact.
  if (actor) {
    const scope = await requisitionScope(actor);
    if (scope) conditions.push(scope);
  }

  if (filters.q) {
    const term = `%${filters.q.toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${requisitions.title})`, term),
        like(sql`lower(${requisitions.code})`, term),
        like(sql`lower(${requisitions.location})`, term),
        like(sql`lower(${requisitions.department})`, term),
        like(sql`lower(${clients.name})`, term),
      ),
    );
  }
  if (filters.status && filters.status !== "all") {
    if (filters.status === "active") {
      conditions.push(inArray(requisitions.status, ["open", "on_hold", "draft"]));
    } else {
      conditions.push(eq(requisitions.status, filters.status));
    }
  }
  if (filters.priority && filters.priority !== "all")
    conditions.push(eq(requisitions.priority, filters.priority));
  if (filters.department && filters.department !== "all")
    conditions.push(eq(requisitions.department, filters.department));
  if (filters.client && filters.client !== "all")
    conditions.push(eq(requisitions.clientId, filters.client));
  if (filters.recruiter && filters.recruiter !== "all")
    conditions.push(eq(requisitions.leadRecruiterId, filters.recruiter));
  if (filters.workMode && filters.workMode !== "all")
    conditions.push(eq(requisitions.workMode, filters.workMode));
  if (filters.employmentType && filters.employmentType !== "all")
    conditions.push(eq(requisitions.employmentType, filters.employmentType));

  const rows = (await db
    .select({
      req: requisitions,
      clientName: clients.name,
      clientTier: clients.tier,
      recruiterName: users.name,
      hiringManagerName: hm.name,
    })
    .from(requisitions)
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .innerJoin(users, eq(users.id, requisitions.leadRecruiterId))
    .innerJoin(hm, eq(hm.id, requisitions.hiringManagerId))
    .where(conditions.length ? and(...conditions) : undefined)
    );

  const counts = await pipelineCounts();

  let result: RequisitionRow[] = rows.map(({ req, clientName, clientTier, recruiterName, hiringManagerName }) => {
    const c = counts.get(req.id) ?? { active: 0, submitted: 0, interview: 0, offer: 0, hired: 0, total: 0 };
    return {
      id: req.id,
      code: req.code,
      title: req.title,
      status: req.status,
      priority: req.priority,
      department: req.department,
      location: req.location,
      workMode: req.workMode,
      employmentType: req.employmentType,
      seniority: req.seniority,
      openings: req.openings,
      filled: req.filled,
      minSalary: req.minSalary,
      maxSalary: req.maxSalary,
      currency: req.currency,
      openedAt: req.openedAt,
      targetFillDate: req.targetFillDate,
      closedAt: req.closedAt,
      clientId: req.clientId,
      clientName,
      clientTier,
      recruiterId: req.leadRecruiterId,
      recruiterName,
      hiringManagerId: req.hiringManagerId,
      hiringManagerName,
      skills: req.skills ?? [],
      activeCount: c.active,
      submittedCount: c.submitted,
      interviewCount: c.interview,
      offerCount: c.offer,
      hiredCount: c.hired,
      totalCount: c.total,
      ageDays: daysBetween(req.openedAt),
      daysToTarget: req.targetFillDate ? -daysBetween(req.targetFillDate) : null,
    };
  });

  if (filters.health && filters.health !== "all") {
    result = result.filter((r) => requisitionHealth(r).key === filters.health);
  }

  const sorter: Record<string, (a: RequisitionRow, b: RequisitionRow) => number> = {
    priority: (a, b) =>
      PRIORITY_WEIGHT[a.priority as Priority] - PRIORITY_WEIGHT[b.priority as Priority] ||
      b.ageDays - a.ageDays,
    newest: (a, b) => b.openedAt.localeCompare(a.openedAt),
    oldest: (a, b) => a.openedAt.localeCompare(b.openedAt),
    pipeline: (a, b) => b.activeCount - a.activeCount,
    title: (a, b) => a.title.localeCompare(b.title),
    target: (a, b) => (a.daysToTarget ?? 9e9) - (b.daysToTarget ?? 9e9),
  };
  result.sort(sorter[filters.sort ?? "priority"] ?? sorter.priority!);

  return result;
}

export type HealthKey = "healthy" | "watch" | "at_risk" | "stalled" | "closed";

export interface Health {
  key: HealthKey;
  label: string;
  tone: "emerald" | "amber" | "rose" | "slate" | "orange";
  reason: string;
}

/**
 * A requisition's health is the honest answer to "should a recruiter look at
 * this today?" — driven by pipeline depth, age against target, and momentum.
 */
export function requisitionHealth(r: RequisitionRow): Health {
  if (["filled", "closed", "cancelled"].includes(r.status)) {
    return { key: "closed", label: "Closed", tone: "slate", reason: `Requisition is ${r.status}.` };
  }
  const overdue = r.daysToTarget !== null && r.daysToTarget < 0;
  const deep = r.interviewCount + r.offerCount;

  if (r.activeCount === 0 && r.ageDays > 10) {
    return {
      key: "stalled",
      label: "Stalled",
      tone: "rose",
      reason: `No active candidates after ${r.ageDays} days open.`,
    };
  }
  if (overdue && deep === 0) {
    return {
      key: "at_risk",
      label: "At risk",
      tone: "rose",
      reason: `${Math.abs(r.daysToTarget!)} days past target with nobody in interviews.`,
    };
  }
  if (overdue || (r.ageDays > 45 && deep === 0)) {
    return {
      key: "watch",
      label: "Needs attention",
      tone: "amber",
      reason: overdue
        ? `${Math.abs(r.daysToTarget!)} days past the target fill date.`
        : `Open ${r.ageDays} days with nobody past submission.`,
    };
  }
  if (r.activeCount < 3 && r.ageDays > 21) {
    return {
      key: "watch",
      label: "Thin pipeline",
      tone: "amber",
      reason: `Only ${r.activeCount} active candidate${r.activeCount === 1 ? "" : "s"} after ${r.ageDays} days.`,
    };
  }
  return {
    key: "healthy",
    label: "On track",
    tone: "emerald",
    reason: `${r.activeCount} active, ${deep} in interviews or offer.`,
  };
}

export async function getRequisition(reqId: string, actor?: User) {
  if (actor) {
    const visible = await visibleRequisitionIds(actor);
    if (visible !== null && !visible.includes(reqId)) return null;
  }
  const hm = alias(users, "hm");
  const row = (await db
    .select({
      req: requisitions,
      client: clients,
      recruiter: users,
      hiringManager: hm,
    })
    .from(requisitions)
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .innerJoin(users, eq(users.id, requisitions.leadRecruiterId))
    .innerJoin(hm, eq(hm.id, requisitions.hiringManagerId))
    .where(eq(requisitions.id, reqId))
    )[0];

  if (!row) return null;

  const team = (await db
    .select({ user: users, role: requisitionAssignees.role })
    .from(requisitionAssignees)
    .innerJoin(users, eq(users.id, requisitionAssignees.userId))
    .where(eq(requisitionAssignees.requisitionId, reqId))
    );

  const pipeline = (await db
    .select({
      submission: submissions,
      candidate: candidates,
      owner: users,
    })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(users, eq(users.id, submissions.ownerId))
    .where(eq(submissions.requisitionId, reqId))
    .orderBy(desc(submissions.matchScore))
    );

  const submissionIds = pipeline.map((p) => p.submission.id);

  const reqInterviews = submissionIds.length
    ? (await db
        .select({ interview: interviews, candidate: candidates })
        .from(interviews)
        .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
        .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
        .where(inArray(interviews.submissionId, submissionIds))
        .orderBy(desc(interviews.scheduledAt))
        )
    : [];

  const reqOffers = submissionIds.length
    ? (await db
        .select({ offer: offers, candidate: candidates })
        .from(offers)
        .innerJoin(submissions, eq(submissions.id, offers.submissionId))
        .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
        .where(inArray(offers.submissionId, submissionIds))
        .orderBy(desc(offers.createdAt))
        )
    : [];

  const reqNotes = (await db
    .select({ note: notes, author: users })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .where(and(eq(notes.entityType, "requisition"), eq(notes.entityId, reqId)))
    .orderBy(desc(notes.pinned), desc(notes.createdAt))
    );

  const stageCounts: Record<string, number> = {};
  for (const p of pipeline) {
    if (p.submission.status !== "active") continue;
    stageCounts[p.submission.stage] = (stageCounts[p.submission.stage] ?? 0) + 1;
  }

  return {
    ...row,
    team,
    pipeline,
    interviews: reqInterviews,
    offers: reqOffers,
    notes: reqNotes,
    stageCounts,
    ageDays: daysBetween(row.req.openedAt),
    daysToTarget: row.req.targetFillDate ? -daysBetween(row.req.targetFillDate) : null,
  };
}

export type RequisitionDetail = NonNullable<ReturnType<typeof getRequisition>>;

/** Distinct values for the filter bar, derived from live data. */
export async function requisitionFacets() {
  const departments = (await db
    .selectDistinct({ value: requisitions.department })
    .from(requisitions)
    .orderBy(asc(requisitions.department))
    )
    .map((r) => r.value);

  const clientList = (await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .orderBy(asc(clients.name))
    );

  const recruiterList = (await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.role, ["recruiter", "recruitment_manager", "super_admin", "sourcer"]))
    .orderBy(asc(users.name))
    );

  return { departments, clients: clientList, recruiters: recruiterList };
}

export async function stageBreakdownForRequisitions(ids: string[]) {
  if (!ids.length) return new Map<string, Record<Stage, number>>();
  const rows = (await db
    .select({
      requisitionId: submissions.requisitionId,
      stage: submissions.stage,
      count: sql<number>`count(*)::int`,
    })
    .from(submissions)
    .where(and(inArray(submissions.requisitionId, ids), eq(submissions.status, "active")))
    .groupBy(submissions.requisitionId, submissions.stage)
    );

  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const entry = map.get(r.requisitionId) ?? {};
    entry[r.stage] = r.count;
    map.set(r.requisitionId, entry);
  }
  return map as Map<string, Record<Stage, number>>;
}
