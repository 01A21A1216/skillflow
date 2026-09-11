import "server-only";

import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";

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
import { ACTIVE_STAGES, STAGE_SLA_DAYS, visaMatches, type Stage } from "@/lib/domain";
import { daysBetween } from "@/lib/utils";
import type { User } from "@/db/schema";
import { submissionScope, visibleRequisitionIds } from "@/server/authz";

export interface PipelineFilters {
  q?: string;
  requisition?: string;
  recruiter?: string;
  client?: string;
  department?: string;
  priority?: string;
  aging?: string;
}

export interface PipelineCard {
  id: string;
  stage: Stage;
  status: string;
  matchScore: number;
  stageSince: Date;
  daysInStage: number;
  slaDays: number;
  isAging: boolean;
  candidateId: string;
  candidateName: string;
  candidateTitle: string;
  candidateLocation: string;
  candidateRating: number;
  candidateSkills: string[];
  /** Shown on the card (§8) and checked against the requirement's accepted list. */
  candidateWorkAuthorization: string;
  visaMismatch: boolean;
  requisitionId: string;
  requisitionCode: string;
  requisitionTitle: string;
  requisitionPriority: string;
  clientName: string;
  ownerId: string;
  ownerName: string;
  nextInterviewAt: Date | null;
  interviewCount: number;
  offerStatus: string | null;
}

/** Every live card in the funnel, ready to be bucketed by stage. */
export async function pipelineCards(filters: PipelineFilters = {}, actor?: User): Promise<PipelineCard[]> {
  const conditions = [
    eq(submissions.status, "active"),
    inArray(submissions.stage, ACTIVE_STAGES as unknown as string[]),
  ];

  if (actor) {
    const scope = await submissionScope(actor);
    if (scope) conditions.push(scope);
  }
  if (filters.requisition && filters.requisition !== "all")
    conditions.push(eq(submissions.requisitionId, filters.requisition));
  if (filters.recruiter && filters.recruiter !== "all")
    conditions.push(eq(submissions.ownerId, filters.recruiter));
  if (filters.client && filters.client !== "all")
    conditions.push(eq(requisitions.clientId, filters.client));
  if (filters.department && filters.department !== "all")
    conditions.push(eq(requisitions.department, filters.department));
  if (filters.priority && filters.priority !== "all")
    conditions.push(eq(requisitions.priority, filters.priority));
  if (filters.q) {
    const term = `%${filters.q.toLowerCase()}%`;
    const match = or(
      like(sql`lower(${candidates.firstName} || ' ' || ${candidates.lastName})`, term),
      like(sql`lower(${candidates.currentTitle})`, term),
      like(sql`lower(${requisitions.title})`, term),
      like(sql`lower(${requisitions.code})`, term),
    );
    if (match) conditions.push(match);
  }

  const rows = (await db
    .select({
      submission: submissions,
      candidate: candidates,
      requisition: requisitions,
      clientName: clients.name,
      ownerName: users.name,
    })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .innerJoin(users, eq(users.id, submissions.ownerId))
    .where(and(...conditions))
    );

  const ids = rows.map((r) => r.submission.id);

  // Next scheduled interview per submission.
  const nextIv = new Map<string, Date>();
  const ivCount = new Map<string, number>();
  if (ids.length) {
    for (const iv of (await db
      .select({
        submissionId: interviews.submissionId,
        scheduledAt: interviews.scheduledAt,
        status: interviews.status,
      })
      .from(interviews)
      .where(inArray(interviews.submissionId, ids))
      )) {
      ivCount.set(iv.submissionId, (ivCount.get(iv.submissionId) ?? 0) + 1);
      if (iv.status !== "scheduled" || iv.scheduledAt.getTime() < Date.now()) continue;
      const current = nextIv.get(iv.submissionId);
      if (!current || iv.scheduledAt < current) nextIv.set(iv.submissionId, iv.scheduledAt);
    }
  }

  const offerStatus = new Map<string, string>();
  if (ids.length) {
    for (const o of (await db
      .select({ submissionId: offers.submissionId, status: offers.status, createdAt: offers.createdAt })
      .from(offers)
      .where(inArray(offers.submissionId, ids))
      .orderBy(desc(offers.createdAt))
      )) {
      if (!offerStatus.has(o.submissionId)) offerStatus.set(o.submissionId, o.status);
    }
  }

  let cards: PipelineCard[] = rows.map(({ submission: s, candidate: c, requisition: r, clientName, ownerName }) => {
    const stage = s.stage as Stage;
    const daysInStage = daysBetween(s.stageSince);
    const slaDays = STAGE_SLA_DAYS[stage] ?? 7;
    return {
      id: s.id,
      stage,
      status: s.status,
      matchScore: s.matchScore,
      stageSince: s.stageSince,
      daysInStage,
      slaDays,
      isAging: daysInStage > slaDays,
      candidateId: c.id,
      candidateName: `${c.firstName} ${c.lastName}`,
      candidateTitle: c.currentTitle,
      candidateLocation: c.location,
      candidateRating: c.rating,
      candidateSkills: c.skills ?? [],
      candidateWorkAuthorization: c.workAuthorization,
      visaMismatch: !visaMatches(r.visaRequirements, c.workAuthorization),
      requisitionId: r.id,
      requisitionCode: r.code,
      requisitionTitle: r.title,
      requisitionPriority: r.priority,
      clientName,
      ownerId: s.ownerId,
      ownerName,
      nextInterviewAt: nextIv.get(s.id) ?? null,
      interviewCount: ivCount.get(s.id) ?? 0,
      offerStatus: offerStatus.get(s.id) ?? null,
    };
  });

  if (filters.aging === "yes") cards = cards.filter((c) => c.isAging);

  cards.sort((a, b) => b.daysInStage - a.daysInStage || b.matchScore - a.matchScore);
  return cards;
}

export function groupByStage(cards: PipelineCard[]) {
  const buckets = new Map<Stage, PipelineCard[]>();
  for (const stage of ACTIVE_STAGES) buckets.set(stage, []);
  for (const card of cards) buckets.get(card.stage)?.push(card);
  return buckets;
}

export async function getSubmission(submissionId: string, actor?: User) {
  if (actor) {
    const visible = await visibleRequisitionIds(actor);
    if (visible !== null && !visible.length) return null;
  }
  const row = (await db
    .select({
      submission: submissions,
      candidate: candidates,
      requisition: requisitions,
      client: clients,
      owner: users,
    })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .innerJoin(users, eq(users.id, submissions.ownerId))
    .where(eq(submissions.id, submissionId))
    )[0];

  if (!row) return null;
  if (actor) {
    const visible = await visibleRequisitionIds(actor);
    if (visible !== null && !visible.includes(row.requisition.id)) return null;
  }

  const ivs = (await db
    .select()
    .from(interviews)
    .where(eq(interviews.submissionId, submissionId))
    .orderBy(desc(interviews.scheduledAt))
    );

  const ivIds = ivs.map((i) => i.id);

  const panel = ivIds.length
    ? (await db
        .select({ interviewId: interviewPanel.interviewId, user: users, role: interviewPanel.role })
        .from(interviewPanel)
        .innerJoin(users, eq(users.id, interviewPanel.userId))
        .where(inArray(interviewPanel.interviewId, ivIds))
        )
    : [];

  const fbs = ivIds.length
    ? (await db
        .select({ feedback, interviewer: users })
        .from(feedback)
        .innerJoin(users, eq(users.id, feedback.interviewerId))
        .where(inArray(feedback.interviewId, ivIds))
        )
    : [];

  const events = (await db
    .select({ event: stageEvents, actor: users })
    .from(stageEvents)
    .leftJoin(users, eq(users.id, stageEvents.actorId))
    .where(eq(stageEvents.submissionId, submissionId))
    .orderBy(desc(stageEvents.createdAt))
    );

  const offerRows = (await db
    .select()
    .from(offers)
    .where(eq(offers.submissionId, submissionId))
    .orderBy(desc(offers.createdAt))
    );

  const noteRows = (await db
    .select({ note: notes, author: users })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .where(and(eq(notes.entityType, "submission"), eq(notes.entityId, submissionId)))
    .orderBy(desc(notes.createdAt))
    );

  return { ...row, interviews: ivs, panel, feedback: fbs, events, offers: offerRows, notes: noteRows };
}

export type SubmissionDetail = NonNullable<ReturnType<typeof getSubmission>>;

/** Requisitions a candidate could still be added to. */
export async function openRequisitionOptions(excludeCandidateId?: string) {
  const taken = excludeCandidateId
    ? new Set(
        (await db
          .select({ requisitionId: submissions.requisitionId })
          .from(submissions)
          .where(eq(submissions.candidateId, excludeCandidateId))
          )
          .map((r) => r.requisitionId),
      )
    : new Set<string>();

  return (await db
    .select({
      id: requisitions.id,
      code: requisitions.code,
      title: requisitions.title,
      clientName: clients.name,
    })
    .from(requisitions)
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .where(inArray(requisitions.status, ["open", "on_hold", "draft"]))
    .orderBy(desc(requisitions.openedAt))
    )
    .filter((r) => !taken.has(r.id));
}
