import "server-only";

import { once, queryKey } from "@/server/request-cache";

import { cache } from "react";

import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidateEducation,
  candidateExperience,
  candidates,
  clients,
  communications,
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
  /** Additional skills, all of which must be held. */
  skills?: string[];
  minExp?: string;
  maxExp?: string;
  auth?: string;
  availability?: string;
  location?: string;
  inPipeline?: string;
  sort?: string;
  /** Page size. Defaults to 40; the list is never returned unbounded. */
  limit?: number;
  offset?: number;
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
  primaryTechnology: string;
  availability: string;
  expectedRate: number | null;
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


/**
 * Live and total submissions per candidate, and how far they ever reached.
 *
 * A grouped subquery rather than a second round trip, so the counts can be
 * filtered, sorted and paginated on in SQL. `furthest` is the highest stage
 * rank the candidate ever reached; the ranks come from the configured
 * pipeline, passed in as a `case` expression because they are rows, not
 * constants.
 */
async function submissionStats() {
  const pipeline = await loadPipeline();

  // rank(stage) as SQL. Terminal stages rank -1: being rejected is not
  // progress, and a candidate whose only movement was a rejection has no
  // furthest stage rather than a flattering one.
  const rankCases = pipeline.order.map(
    (stage, i) => sql`when ${submissions.stage} = ${stage} then ${i}`,
  );
  const rank = sql`(case ${sql.join(rankCases, sql` `)} else -1 end)`;

  const activeStages = pipeline.active;

  return db
    .select({
      candidateId: submissions.candidateId,
      active: sql<number>`count(*) filter (
        where ${submissions.status} = 'active'
          and ${submissions.stage} in ${activeStages}
      )::int`.as("active_count"),
      total: sql<number>`count(*)::int`.as("total_count"),
      furthestRank: sql<number>`max(${rank})::int`.as("furthest_rank"),
    })
    .from(submissions)
    .groupBy(submissions.candidateId)
    .as("stats");
}

/** One page of candidates, plus the totals the header reports. */
export interface CandidatePage {
  rows: CandidateRow[];
  /** Everyone matching the filters, not just this page. */
  total: number;
  /** How many of those are in a live pipeline. */
  inPlay: number;
}

/**
 * The candidate list (§7).
 *
 * Filtering, sorting and pagination all happen in SQL. That is worth stating
 * because it used to not: the page read all 1,306 candidates with their owner,
 * grouped every submission in the database to count them, sorted the result in
 * JavaScript and then threw away all but forty rows. It was fast enough at
 * this size and would not have been at ten times it, and the fix is the same
 * amount of code.
 *
 * The submission counts are a grouped subquery joined in rather than a second
 * round trip, because two of the sorts and one of the filters are expressed in
 * terms of them — "most active" cannot be ordered in SQL if the number it
 * orders by is computed afterwards.
 */
async function loadCandidateList(
  filters: CandidateFilters = {},
  actor?: User,
): Promise<CandidatePage> {
  const pipeline = await loadPipeline();
  const stats = await submissionStats();
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
  // One named skill, or several. Each is a separate `and`, because a question
  // that names three skills means all three — a candidate who has one of them
  // is not an answer to it.
  for (const skill of [filters.skill, ...(filters.skills ?? [])]) {
    if (!skill || skill === "all") continue;
    conditions.push(like(sql`lower(${candidates.skills}::text)`, `%${skill.toLowerCase()}%`));
  }
  if (filters.availability && filters.availability !== "all")
    conditions.push(eq(candidates.availability, filters.availability));
  if (filters.location && filters.location !== "all")
    conditions.push(like(sql`lower(${candidates.location})`, `%${filters.location.toLowerCase()}%`));
  if (filters.minExp) conditions.push(gte(candidates.yearsExperience, Number(filters.minExp)));
  if (filters.maxExp) conditions.push(lte(candidates.yearsExperience, Number(filters.maxExp)));

  // A candidate with no submissions has no row in the subquery, so the live
  // count is null rather than zero — coalesced here so "on the bench" means
  // "nobody, ever" and "nobody, currently" alike.
  const activeCount = sql<number>`coalesce(${stats.active}, 0)`;
  if (filters.inPipeline === "yes") conditions.push(sql`${activeCount} > 0`);
  if (filters.inPipeline === "no") conditions.push(sql`${activeCount} = 0`);

  const where = conditions.length ? and(...conditions) : undefined;

  const ORDER: Record<string, ReturnType<typeof desc>[]> = {
    recent: [desc(candidates.createdAt)],
    name: [asc(candidates.lastName), asc(candidates.firstName)],
    rating: [desc(candidates.rating), desc(candidates.yearsExperience)],
    experience: [desc(candidates.yearsExperience)],
    pipeline: [desc(activeCount)],
    // Nulls last: never contacted is not the same as contacted longest ago,
    // and sorting by "recently contacted" should not lead with people nobody
    // has ever called.
    contacted: [sql`${candidates.lastContactedAt} desc nulls last`],
  };
  const orderBy = ORDER[filters.sort ?? "recent"] ?? ORDER.recent!;

  const limit = filters.limit ?? 40;
  const offset = filters.offset ?? 0;

  const [rows, totals] = await Promise.all([
    db
      .select({
        candidate: candidates,
        ownerName: users.name,
        active: activeCount,
        total: sql<number>`coalesce(${stats.total}, 0)`,
        furthestRank: stats.furthestRank,
      })
      .from(candidates)
      .innerJoin(users, eq(users.id, candidates.ownerId))
      .leftJoin(stats, eq(stats.candidateId, candidates.id))
      .where(where)
      // Tie-break on the primary key. Without it two candidates with the same
      // rating can swap places between page 1 and page 2, which shows one
      // twice and hides the other entirely.
      .orderBy(...orderBy, asc(candidates.id))
      .limit(limit)
      .offset(offset),
    db
      .select({
        total: sql<number>`count(*)::int`,
        inPlay: sql<number>`count(*) filter (where ${activeCount} > 0)::int`,
      })
      .from(candidates)
      .leftJoin(stats, eq(stats.candidateId, candidates.id))
      .where(where),
  ]);

  const byRank = pipeline.order;

  let result: CandidateRow[] = rows.map(({ candidate: c, ownerName, active, total, furthestRank }) => ({
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
    primaryTechnology: c.primaryTechnology,
    availability: c.availability,
    expectedRate: c.expectedRate,
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
    activeSubmissions: active,
    totalSubmissions: total,
    furthestStage: furthestRank !== null && furthestRank >= 0 ? (byRank[furthestRank] ?? null) : null,
  }));

  // Contact details and compensation are stripped server-side for actors
  // without `candidate.pii`, so the values never reach the browser at all.
  if (actor) result = result.map((c) => redactCandidate(actor, c));

  return {
    rows: result,
    total: totals[0]?.total ?? 0,
    inPlay: totals[0]?.inPlay ?? 0,
  };
}

async function loadCandidate(candidateId: string, actor?: User) {
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

  const contacts = (await db
    .select({ comm: communications, loggedBy: users.name, code: requisitions.code })
    .from(communications)
    .innerJoin(users, eq(users.id, communications.loggedById))
    .leftJoin(submissions, eq(submissions.id, communications.submissionId))
    .leftJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(and(eq(communications.candidateId, candidateId), isNull(communications.deletedAt)))
    .orderBy(desc(communications.occurredAt))
    ).map((r) => ({
      id: r.comm.id,
      channel: r.comm.channel,
      direction: r.comm.direction,
      subject: r.comm.subject,
      body: r.comm.body,
      occurredAt: r.comm.occurredAt,
      followUpAt: r.comm.followUpAt,
      loggedBy: r.loggedBy,
      loggedById: r.comm.loggedById,
      requisitionCode: r.code,
    }));

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
    contacts,
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

  /*
   * The skill facet, tallied by Postgres.
   *
   * Derived from the arrays actually on candidates rather than from a fixed
   * list, so a skill nobody has does not appear in the filter and a new one
   * appears the moment somebody is given it. `jsonb_array_elements_text`
   * unnests the array so this is an ordinary group-by, rather than reading
   * every candidate's skills into the application to count them there.
   */
  const skillRows = await db.execute<{ name: string; count: number }>(sql`
    select skill as name, count(*)::int as count
    from ${candidates}, jsonb_array_elements_text(${candidates.skills}) as skill
    group by skill
    order by count(*) desc, lower(skill) asc
  `);
  const skills = skillRows.rows.map((r) => ({ name: r.name, count: Number(r.count) }));

  return { owners, skills };
}

/** Candidates not currently in any live pipeline — the re-engagement list. */
export async function benchCandidates(limit = 8) {
  return (await listCandidates({ inPipeline: "no", status: "active", sort: "rating", limit })).rows;
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
export const getCandidate = cache(loadCandidate);

/** listCandidates, memoised for the request — see `server/request-cache.ts`. */
export function listCandidates(
  filters: CandidateFilters = {},
  actor?: User,
): Promise<CandidatePage> {
  return once(queryKey("candidates", filters, actor?.id), () => loadCandidateList(filters, actor));
}
