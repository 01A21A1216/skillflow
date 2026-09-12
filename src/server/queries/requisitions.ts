import "server-only";

import { once, queryKey } from "@/server/request-cache";

import { cache } from "react";

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
import {
  EMPTY_STAGE_COUNTS,
  PRIORITY_WEIGHT,
  requisitionProgress,
  type Priority,
  type ReqStatus,
  type StageCounts,
  type Stage,
} from "@/lib/domain";
import { daysBetween } from "@/lib/utils";
import type { User } from "@/db/schema";
import { requisitionScope, visibleRequisitionIds } from "@/server/authz";
import { loadPipeline } from "@/server/pipeline";
import { matches } from "@/server/search";
import { listAttachments } from "@/server/queries/attachments";

export interface RequisitionFilters {
  /**
   * Only these requirements.
   *
   * For the callers that want the derived row — progress, health, stage
   * counts — for a handful of known ids, rather than for all of them. It is
   * still the same function and the same scope check; it just stops reading
   * five hundred rows to use three.
   */
  ids?: string[];
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
  /** The authored status stored on the row — the only one a person can set. */
  status: string;
  /**
   * What the requirement actually reads as: the authored status, unless it is
   * open, in which case the pipeline says whether it is Active Sourcing,
   * Candidate Submitted, Interviewing or at Offer (§5).
   */
  displayStatus: ReqStatus;
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
  requiredSkills: string[];
  preferredSkills: string[];
  visaRequirements: string[];
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



const DERIVED_STATUSES: string[] = ["active_sourcing", "candidate_submitted", "interviewing", "offer"];

/**
 * One pass over submissions, grouped by requisition — a single aggregate
 * rather than N per-row lookups.
 *
 * Narrowed to the requirements actually being listed when there are few of
 * them, so asking for one requirement's row does not group every submission
 * in the database to fill in its stage counts.
 */
async function pipelineCounts(only?: string[]) {
  const rows = (await db
    .select({
      requisitionId: submissions.requisitionId,
      stage: submissions.stage,
      status: submissions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(submissions)
    .where(only?.length ? inArray(submissions.requisitionId, only) : undefined)
    .groupBy(submissions.requisitionId, submissions.stage, submissions.status)
    );

  const pipeline = await loadPipeline();
  const activeSet = new Set(pipeline.active);

  interface Counts extends StageCounts {
    active: number;
    hired: number;
    total: number;
  }
  const blank = (): Counts => ({ ...EMPTY_STAGE_COUNTS, active: 0, hired: 0, total: 0 });
  const map = new Map<string, Counts>();

  for (const r of rows) {
    const entry = map.get(r.requisitionId) ?? blank();
    entry.total += r.count;
    if (r.status === "active" && activeSet.has(r.stage)) {
      entry.active += r.count;
      // Eleven stages collapse into the four the requirement card reports on.
      const bucket = pipeline.bucket(r.stage) as keyof StageCounts | null;
      if (bucket) entry[bucket] += r.count;
    }
    if (r.status === "hired") entry.hired += r.count;
    map.set(r.requisitionId, entry);
  }
  return map;
}

async function loadRequisitions(
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

  if (filters.ids) {
    if (!filters.ids.length) return [];
    conditions.push(inArray(requisitions.id, filters.ids));
  }

  /*
   * Full-text against the generated vector (§22).
   *
   * The client's name is the one thing not in it: the vector is a function of
   * the requisition row alone, and reaching across the join to build it would
   * mean a trigger on `clients` that reindexed every requirement whenever an
   * account was renamed. Matching it separately costs one comparison against
   * a few dozen clients and keeps the index honest.
   */
  if (filters.q) {
    const textMatch = matches(requisitions.searchVector, filters.q);
    const clientMatch = like(sql`lower(${clients.name})`, `%${filters.q.toLowerCase()}%`);
    conditions.push(textMatch ? or(textMatch, clientMatch)! : clientMatch);
  }
  // The four derived statuses are not columns, so they cannot be filtered in
  // SQL — they are applied against `displayStatus` once the counts are in.
  const derivedStatusFilter = DERIVED_STATUSES.includes(filters.status ?? "")
    ? (filters.status as ReqStatus)
    : null;
  if (filters.status && filters.status !== "all" && !derivedStatusFilter) {
    if (filters.status === "active") {
      conditions.push(inArray(requisitions.status, ["open", "on_hold", "draft"]));
    } else {
      conditions.push(eq(requisitions.status, filters.status));
    }
  } else if (derivedStatusFilter) {
    // Every derived status belongs to an open requirement.
    conditions.push(eq(requisitions.status, "open"));
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

  const counts = await pipelineCounts(rows.map((r) => r.req.id));

  let result: RequisitionRow[] = rows.map(({ req, clientName, clientTier, recruiterName, hiringManagerName }) => {
    const c = counts.get(req.id) ?? {
      ...EMPTY_STAGE_COUNTS,
      active: 0,
      hired: 0,
      total: 0,
    };
    return {
      id: req.id,
      code: req.code,
      title: req.title,
      status: req.status,
      displayStatus: requisitionProgress(req.status, c),
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
      requiredSkills: req.requiredSkills ?? [],
      preferredSkills: req.preferredSkills ?? [],
      visaRequirements: req.visaRequirements ?? [],
      activeCount: c.active,
      submittedCount: c.submitted,
      interviewCount: c.interviewing,
      offerCount: c.offer,
      hiredCount: c.hired,
      totalCount: c.total,
      ageDays: daysBetween(req.openedAt),
      daysToTarget: req.targetFillDate ? -daysBetween(req.targetFillDate) : null,
    };
  });

  if (derivedStatusFilter) {
    result = result.filter((r) => r.displayStatus === derivedStatusFilter);
  }

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

async function loadRequisition(reqId: string, actor?: User) {
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

  const backupRecruiter = row.req.backupRecruiterId
    ? ((await db.select().from(users).where(eq(users.id, row.req.backupRecruiterId)))[0] ?? null)
    : null;

  return {
    ...row,
    team,
    backupRecruiter,
    attachments: await listAttachments("requisition", reqId),
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

/**
 * Per-request memoisation.
 *
 * A detail page loads its record twice: once in `generateMetadata`, to put the
 * person's name in the tab title, and once in the page body. Next runs both,
 * and without this the second call repeats every query the first one made —
 * on the team page that was thirty-odd statements, including the whole
 * recruiter-performance aggregate, to produce a string.
 *
 * React's `cache` scopes the memo to a single request, so it is not a cache in
 * the stale-data sense: two people looking at the same record still get their
 * own reads, and a mutation is visible on the next request.
 */
export const getRequisition = cache(loadRequisition);

/** listRequisitions, memoised for the request — see `server/request-cache.ts`. */
export function listRequisitions(
  filters: RequisitionFilters = {},
  actor?: User,
): Promise<RequisitionRow[]> {
  return once(queryKey("requisitions", filters, actor?.id), () => loadRequisitions(filters, actor));
}
