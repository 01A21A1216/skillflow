import "server-only";

import { and, asc, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
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
import { ACTIVE_STAGES } from "@/lib/domain";
import { daysBetween } from "@/lib/utils";

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

const ACTIVE_SET = ACTIVE_STAGES as readonly string[];
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

function submissionSummary() {
  const rows = db
    .select({
      candidateId: submissions.candidateId,
      stage: submissions.stage,
      status: submissions.status,
      count: sql<number>`count(*)`,
    })
    .from(submissions)
    .groupBy(submissions.candidateId, submissions.stage, submissions.status)
    .all();

  const map = new Map<string, { active: number; total: number; furthest: string | null }>();
  for (const r of rows) {
    const entry = map.get(r.candidateId) ?? { active: 0, total: 0, furthest: null };
    entry.total += r.count;
    if (r.status === "active" && ACTIVE_SET.includes(r.stage)) entry.active += r.count;
    const rank = STAGE_RANK[r.stage] ?? -1;
    if (rank >= 0 && (entry.furthest === null || rank > (STAGE_RANK[entry.furthest] ?? -1))) {
      entry.furthest = r.stage;
    }
    map.set(r.candidateId, entry);
  }
  return map;
}

export function listCandidates(filters: CandidateFilters = {}): CandidateRow[] {
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
        like(sql`lower(${candidates.skills})`, term),
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
    conditions.push(like(sql`lower(${candidates.skills})`, `%${filters.skill.toLowerCase()}%`));
  if (filters.minExp) conditions.push(gte(candidates.yearsExperience, Number(filters.minExp)));
  if (filters.maxExp) conditions.push(lte(candidates.yearsExperience, Number(filters.maxExp)));

  const rows = db
    .select({ candidate: candidates, ownerName: users.name })
    .from(candidates)
    .innerJoin(users, eq(users.id, candidates.ownerId))
    .where(conditions.length ? and(...conditions) : undefined)
    .all();

  const summary = submissionSummary();

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

export function getCandidate(candidateId: string) {
  const candidate = db.select().from(candidates).where(eq(candidates.id, candidateId)).get();
  if (!candidate) return null;

  const owner = db.select().from(users).where(eq(users.id, candidate.ownerId)).get()!;

  const subs = db
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
    .all();

  const submissionIds = subs.map((s) => s.submission.id);

  const ivs = submissionIds.length
    ? db
        .select({ interview: interviews, requisition: requisitions })
        .from(interviews)
        .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
        .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
        .where(inArray(interviews.submissionId, submissionIds))
        .orderBy(desc(interviews.scheduledAt))
        .all()
    : [];

  const interviewIds = ivs.map((i) => i.interview.id);

  const fbs = interviewIds.length
    ? db
        .select({ feedback, interviewer: users, interview: interviews })
        .from(feedback)
        .innerJoin(users, eq(users.id, feedback.interviewerId))
        .innerJoin(interviews, eq(interviews.id, feedback.interviewId))
        .where(inArray(feedback.interviewId, interviewIds))
        .orderBy(desc(feedback.submittedAt))
        .all()
    : [];

  const panelists = interviewIds.length
    ? db
        .select({ interviewId: interviewPanel.interviewId, user: users, role: interviewPanel.role })
        .from(interviewPanel)
        .innerJoin(users, eq(users.id, interviewPanel.userId))
        .where(inArray(interviewPanel.interviewId, interviewIds))
        .all()
    : [];

  const offerRows = submissionIds.length
    ? db
        .select({ offer: offers, requisition: requisitions })
        .from(offers)
        .innerJoin(submissions, eq(submissions.id, offers.submissionId))
        .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
        .where(inArray(offers.submissionId, submissionIds))
        .orderBy(desc(offers.createdAt))
        .all()
    : [];

  const timeline = submissionIds.length
    ? db
        .select({ event: stageEvents, actor: users, requisition: requisitions })
        .from(stageEvents)
        .innerJoin(submissions, eq(submissions.id, stageEvents.submissionId))
        .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
        .leftJoin(users, eq(users.id, stageEvents.actorId))
        .where(inArray(stageEvents.submissionId, submissionIds))
        .orderBy(desc(stageEvents.createdAt))
        .all()
    : [];

  const candidateNotes = db
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
    .all();

  return {
    candidate,
    owner,
    submissions: subs,
    interviews: ivs,
    feedback: fbs,
    panelists,
    offers: offerRows,
    timeline,
    notes: candidateNotes,
    daysInSystem: daysBetween(candidate.createdAt),
  };
}

export type CandidateDetail = NonNullable<ReturnType<typeof getCandidate>>;

export function candidateFacets() {
  const owners = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.role, ["recruiter", "admin"]))
    .orderBy(asc(users.name))
    .all();

  // Skill facet is derived from the JSON arrays actually present on candidates.
  const skillRows = db.select({ skills: candidates.skills }).from(candidates).all();
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
export function benchCandidates(limit = 8) {
  return listCandidates({ inPipeline: "no", status: "active", sort: "rating" }).slice(0, limit);
}
