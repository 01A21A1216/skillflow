import "server-only";

import { and, asc, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidateEducation,
  candidateExperience,
  candidates,
  clients,
  feedback,
  interviewPanel,
  interviews,
  notes,
  offers,
  requisitions,
  stageEvents,
  submissions,
  users,
} from "@/db/schema";
import { loadPipeline } from "@/server/pipeline";
import { daysBetween } from "@/lib/utils";
import type { User } from "@/db/schema";
import { redactCandidate } from "@/server/authz";
import { listAttachments } from "@/server/queries/attachments";

export interface CandidateFilters {
  q?: string;
  status?: string;
  source?: string;
  seniority?: string;
  owner?: string;
  skill?: string;
  minExp?: string;
  maxExp?: string;
  auth?: string;
  inPipeline?: string;
  sort?: string;
}

export interface CandidateRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  location: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: number;
  seniority: string;
  skills: string[];
  tags: string[];
  source: string;
  status: string;
  rating: number;
  expectedSalary: number | null;
  currency: string;
  workAuthorization: string;
  noticePeriodDays: number;
  willingToRelocate: boolean;
  ownerId: string;
  ownerName: string;
  createdAt: Date;
  lastContactedAt: Date | null;
  activeSubmissions: number;
  totalSubmissions: number;
  furthestStage: string | null;
}


const STAGE_RANK: Record<string, number> = {
  sourced: 0,
  screening: 1,
  submitted: 2,
  interview: 3,
  offer: 4,
  hired: 5,
  rejected: -1,
  withdrawn: -1,
};

async function submissionSummary() {
  const rows = (await db
    .select({
      candidateId: submissions.candidateId,
      stage: submissions.stage,
      status: submissions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(submissions)
    .groupBy(submissions.candidateId, submissions.stage, submissions.status)
    );

  const pipeline = await loadPipeline();
  const activeSet = new Set(pipeline.active);
  const map = new Map<string, { active: number; total: number; furthest: string | null }>();
  for (const r of rows) {
    const entry = map.get(r.candidateId) ?? { active: 0, total: 0, furthest: null };
    entry.total += r.count;
    if (r.status === "active" && activeSet.has(r.stage)) entry.active += r.count;
    const rank = STAGE_RANK[r.stage] ?? -1;
    if (rank >= 0 && (entry.furthest === null || rank > (STAGE_RANK[entry.furthest] ?? -1))) {
      entry.furthest = r.stage;
    }
    map.set(r.candidateId, entry);
  }
  return map;
}

export async function listCandidates(filters: CandidateFilters = {}, actor?: User): Promise<CandidateRow[]> {
  const conditions = [];

  if (filters.q) {
    const term = `%${filters.q.toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${candidates.firstName} || ' ' || ${candidates.lastName})`, term),
        like(sql`lower(${candidates.email})`, term),
        like(sql`lower(${candidates.currentTitle})`, term),
        like(sql`lower(${candidates.currentCompany})`, term),
        like(sql`lower(${candidates.location})`, term),
        like(sql`lower(${candidates.skills}::text)`, term),
      ),
    );
  }
  if (filters.status && filters.status !== "all") conditions.push(eq(candidates.status, filters.status));
  if (filters.source && filters.source !== "all") conditions.push(eq(candidates.source, filters.source));
  if (filters.seniority && filters.seniority !== "all")
    conditions.push(eq(candidates.seniority, filters.seniority));
  if (filters.owner && filters.owner !== "all") conditions.push(eq(candidates.ownerId, filters.owner));
  if (filters.auth && filters.auth !== "all")
    conditions.push(eq(candidates.workAuthorization, filters.auth));
  if (filters.skill && filters.skill !== "all")
    conditions.push(like(sql`lower(${candidates.skills}::text)`, `%${filters.skill.toLowerCase()}%`));
  if (filters.minExp) conditions.push(gte(candidates.yearsExperience, Number(filters.minExp)));
  if (filters.maxExp) conditions.push(lte(candidates.yearsExperience, Number(filters.maxExp)));

  const rows = (await db
    .select({ candidate: candidates, ownerName: users.name })
    .from(candidates)
    .innerJoin(users, eq(users.id, candidates.ownerId))
    .where(conditions.length ? and(...conditions) : undefined)
    );

  const summary = await submissionSummary();

  let result: CandidateRow[] = rows.map(({ candidate: c, ownerName }) => {
    const sum = summary.get(c.id) ?? { active: 0, total: 0, furthest: null };
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      location: c.location,
      currentTitle: c.currentTitle,
      currentCompany: c.currentCompany,
      yearsExperience: c.yearsExperience,
      seniority: c.seniority,
      skills: c.skills ?? [],
      tags: c.tags ?? [],
      source: c.source,
      status: c.status,
      rating: c.rating,
      expectedSalary: c.expectedSalary,
      currency: c.currency,
      workAuthorization: c.workAuthorization,
      noticePeriodDays: c.noticePeriodDays,
      willingToRelocate: c.willingToRelocate,
      ownerId: c.ownerId,
      ownerName,
      createdAt: c.createdAt,
      lastContactedAt: c.lastContactedAt,
      activeSubmissions: sum.active,
      totalSubmissions: sum.total,
      furthestStage: sum.furthest,
    };
  });

  // Contact details and compensation are stripped server-side for actors
  // without `candidate.pii`, so the values never reach the browser at all.
  if (actor) result = result.map((c) => redactCandidate(actor, c));

  if (filters.inPipeline === "yes") result = result.filter((c) => c.activeSubmissions > 0);
  if (filters.inPipeline === "no") result = result.filter((c) => c.activeSubmissions === 0);

  const sorter: Record<string, (a: CandidateRow, b: CandidateRow) => number> = {
    recent: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    name: (a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`),
    rating: (a, b) => b.rating - a.rating || b.yearsExperience - a.yearsExperience,
    experience: (a, b) => b.yearsExperience - a.yearsExperience,
    pipeline: (a, b) => b.activeSubmissions - a.activeSubmissions,
    contacted: (a, b) => (b.lastContactedAt?.getTime() ?? 0) - (a.lastContactedAt?.getTime() ?? 0),
  };
  result.sort(sorter[filters.sort ?? "recent"] ?? sorter.recent!);

  return result;
}

export async function getCandidate(candidateId: string, actor?: User) {
  const raw = (await db.select().from(candidates).where(eq(candidates.id, candidateId)))[0];
  if (!raw) return null;
  const candidate = actor ? redactCandidate(actor, raw) : raw;

  const owner = (await db.select().from(users).where(eq(users.id, candidate.ownerId)))[0]!;

  const subs = (await db
    .select({
      submission: submissions,
      requisition: requisitions,
      client: clients,
      owner: users,
    })
    .from(submissions)
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .innerJoin(users, eq(users.id, submissions.ownerId))
    .where(eq(submissions.candidateId, candidateId))
    .orderBy(desc(submissions.updatedAt))
    );

  const submissionIds = subs.map((s) => s.submission.id);

  const ivs = submissionIds.length
    ? (await db
        .select({ interview: interviews, requisition: requisitions })
        .from(interviews)
        .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
        .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
        .where(inArray(interviews.submissionId, submissionIds))
        .orderBy(desc(interviews.scheduledAt))
        )
    : [];

  const interviewIds = ivs.map((i) => i.interview.id);

  const fbs = interviewIds.length
    ? (await db
        .select({ feedback, interviewer: users, interview: interviews })
        .from(feedback)
        .innerJoin(users, eq(users.id, feedback.interviewerId))
        .innerJoin(interviews, eq(interviews.id, feedback.interviewId))
        .where(inArray(feedback.interviewId, interviewIds))
        .orderBy(desc(feedback.submittedAt))
        )
    : [];

  const panelists = interviewIds.length
    ? (await db
        .select({ interviewId: interviewPanel.interviewId, user: users, role: interviewPanel.role })
        .from(interviewPanel)
        .innerJoin(users, eq(users.id, interviewPanel.userId))
        .where(inArray(interviewPanel.interviewId, interviewIds))
        )
    : [];

  const offerRows = submissionIds.length
    ? (await db
        .select({ offer: offers, requisition: requisitions })
        .from(offers)
        .innerJoin(submissions, eq(submissions.id, offers.submissionId))
        .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
        .where(inArray(offers.submissionId, submissionIds))
        .orderBy(desc(offers.createdAt))
        )
    : [];

  const timeline = submissionIds.length
    ? (await db
        .select({ event: stageEvents, actor: users, requisition: requisitions })
        .from(stageEvents)
        .innerJoin(submissions, eq(submissions.id, stageEvents.submissionId))
        .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
        .leftJoin(users, eq(users.id, stageEvents.actorId))
        .where(inArray(stageEvents.submissionId, submissionIds))
        .orderBy(desc(stageEvents.createdAt))
        )
    : [];

  const education = (await db
    .select()
    .from(candidateEducation)
    .where(eq(candidateEducation.candidateId, candidateId))
    .orderBy(desc(candidateEducation.endYear))
    );

  const experience = (await db
    .select()
    .from(candidateExperience)
    .where(eq(candidateExperience.candidateId, candidateId))
    // Current role first, then most recent. A null end date sorts to the top.
    .orderBy(desc(candidateExperience.startedOn))
    );

  const files = await listAttachments("candidate", candidateId);

  const candidateNotes = (await db
    .select({ note: notes, author: users })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .where(
      or(
        and(eq(notes.entityType, "candidate"), eq(notes.entityId, candidateId)),
        submissionIds.length
          ? and(eq(notes.entityType, "submission"), inArray(notes.entityId, submissionIds))
          : sql`0 = 1`,
      ),
    )
    .orderBy(desc(notes.pinned), desc(notes.createdAt))
    );

  return {
    candidate,
    owner,
    submissions: subs,
    interviews: ivs,
    feedback: fbs,
    panelists,
    offers: offerRows,
    timeline,
    education,
    experience,
    attachments: files,
    notes: candidateNotes,
    daysInSystem: daysBetween(candidate.createdAt),
  };
}

export type CandidateDetail = NonNullable<ReturnType<typeof getCandidate>>;

export async function candidateFacets() {
  const owners = (await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.role, ["recruiter", "recruitment_manager", "super_admin", "sourcer"]))
    .orderBy(asc(users.name))
    );

  // Skill facet is derived from the JSON arrays actually present on candidates.
  const skillRows = (await db.select({ skills: candidates.skills }).from(candidates));
  const tally = new Map<string, number>();
  for (const r of skillRows) {
    for (const s of r.skills ?? []) tally.set(s, (tally.get(s) ?? 0) + 1);
  }
  const skills = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  return { owners, skills };
}

/** Candidates not currently in any live pipeline — the re-engagement list. */
export async function benchCandidates(limit = 8) {
  return (await listCandidates({ inPipeline: "no", status: "active", sort: "rating" })).slice(0, limit);
}
