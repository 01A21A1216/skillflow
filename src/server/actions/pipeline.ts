"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { candidates, notes, requisitions, stageEvents, submissions } from "@/db/schema";
import type { User } from "@/db/schema";
import { isTerminal, type Pipeline, type Stage } from "@/lib/domain";
import { loadPipeline } from "@/server/pipeline";
import { backfillPath, requisitionFill } from "@/server/rules";
import { notify } from "@/server/notify";
import {
  addToPipelineSchema,
  holdSchema,
  moveStageSchema,
  rejectSchema,
  reopenSchema,
} from "@/lib/validation";
import { canTouchRequisition } from "@/server/authz";
import { stamp, stampNew } from "@/server/integrity";
import {
  denied,
  fail,
  guarded,
  logActivity,
  newId,
  parseForm,
  succeed,
  type ActionState,
} from "./shared";

function revalidateEverywhere(requisitionId?: string, candidateId?: string) {
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/requisitions");
  revalidatePath("/offers");
  if (requisitionId) revalidatePath(`/requisitions/${requisitionId}`);
  if (candidateId) revalidatePath(`/candidates/${candidateId}`);
}

/** Keep `requisitions.filled` and its status honest after any hire change. */
async function syncRequisitionFill(requisitionId: string) {
  const req = (await db.select().from(requisitions).where(eq(requisitions.id, requisitionId)))[0];
  if (!req) return;

  const hires = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .where(and(eq(submissions.requisitionId, requisitionId), eq(submissions.status, "hired")))
    )[0]!.count;

  const next = requisitionFill({
    hires,
    openings: req.openings,
    status: req.status,
    closedAt: req.closedAt,
    today: new Date().toISOString().slice(0, 10),
  });

  (await db.update(requisitions)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(requisitions.id, requisitionId))
    );
}

/**
 * Resolve a stage key posted by a form against the configured pipeline.
 *
 * Stage keys used to be a compile-time enum; now they are rows, so this is the
 * boundary where an unknown one is caught. A stale tab posting a stage an
 * administrator has since removed gets a message naming the problem rather than
 * writing a key nothing can render.
 */
function resolveStage(pipeline: Pipeline, key: string | undefined, fallback: Stage) {
  const stage = key ?? fallback;
  return pipeline.index(stage) >= 0 ? { ok: true as const, stage } : { ok: false as const, stage };
}

/** The last live stage a submission held before it was parked or closed out. */
async function lastLiveStage(submissionId: string, fallback: string) {
  const events = await db
    .select({ toStage: stageEvents.toStage })
    .from(stageEvents)
    .where(eq(stageEvents.submissionId, submissionId))
    .orderBy(desc(stageEvents.createdAt));

  const live = events.find((e) => !isTerminal(e.toStage));
  return (live?.toStage ?? fallback) as Stage;
}

async function addToPipelineImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(addToPipelineSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;
  const pipeline = await loadPipeline();

  const entry = resolveStage(pipeline, input.stage, pipeline.order[0]!);
  if (!entry.ok) {
    return fail("That stage no longer exists. Reload and try again.", { stage: "Unknown stage" });
  }

  const candidate = (await db.select().from(candidates).where(eq(candidates.id, input.candidateId)))[0];
  const req = (await db.select().from(requisitions).where(eq(requisitions.id, input.requisitionId)))[0];
  if (!candidate) return fail("That candidate no longer exists.");
  if (!req) return fail("That requisition no longer exists.");
  if (!await canTouchRequisition(actor, req.id)) return denied("that requisition");

  const duplicate = (await db
    .select()
    .from(submissions)
    .where(
      and(eq(submissions.candidateId, input.candidateId), eq(submissions.requisitionId, input.requisitionId)),
    )
    )[0];

  if (duplicate) {
    return fail(`${candidate.firstName} is already on ${req.code}.`, {
      requisitionId: "Already in this pipeline",
    });
  }

  const id = newId("sub");
  const now = new Date();
  const stage = entry.stage;

  db.transaction(async (tx) => {
    (await tx.insert(submissions)
      .values({
        id,
        candidateId: input.candidateId,
        requisitionId: input.requisitionId,
        stage,
        status: "active",
        ownerId: req.leadRecruiterId,
        matchScore: input.matchScore,
        submittedAt: pipeline.atOrPastKind(stage, "submitted") ? now : null,
        stageSince: now,
        ...stampNew(actor.id),
      })
      );

    // Backfill the stages this candidate is being dropped past, so funnel
    // analytics and the timeline stay consistent.
    const path = backfillPath(pipeline, stage);
    for (const [i, s] of path.entries()) {
      (await tx.insert(stageEvents)
        .values({
          id: newId("stg"),
          submissionId: id,
          fromStage: i === 0 ? null : path[i - 1]!,
          toStage: s,
          actorId: actor.id,
          note: s === stage ? (input.note ?? null) : null,
          createdAt: now,
        })
        );
    }

    if (candidate.status === "new" || candidate.status === "passive") {
      (await tx.update(candidates)
        .set({ status: "active", updatedAt: now })
        .where(eq(candidates.id, candidate.id))
        );
    }
  });

  if (input.note) {
    (await db.insert(notes)
      .values({
        id: newId("not"),
        entityType: "submission",
        entityId: id,
        authorId: actor.id,
        body: input.note,
        pinned: false,
        createdAt: now,
      })
      );
  }

  await logActivity({
    entityType: "submission",
    entityId: id,
    type: "submission_created",
    actorId: actor.id,
    summary: `${candidate.firstName} ${candidate.lastName} added to ${req.code}`,
    meta: { requisitionId: req.id, candidateId: candidate.id },
  });

  await notify({
    userIds: [req.leadRecruiterId, req.backupRecruiterId ?? "", req.hiringManagerId],
    type: "candidate_assigned",
    title: `${candidate.firstName} ${candidate.lastName} added to ${req.code}`,
    body: `${req.title} · ${pipeline.label(stage)}`,
    href: `/candidates/${candidate.id}`,
    actorId: actor.id,
    entityType: "submission",
    entityId: id,
    dedupeKey: `candidate_assigned:${id}`,
  });

  revalidateEverywhere(req.id, candidate.id);
  return succeed(`Added to ${req.code}`, id);
}

async function moveStageImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(moveStageSchema, formData);
  if (!parsed.success) return parsed.state;
  const { submissionId, stage, note } = parsed.data;
  const pipeline = await loadPipeline();
  if (pipeline.index(stage) < 0) {
    return fail("That stage no longer exists. Reload and try again.", { stage: "Unknown stage" });
  }

  const row = (await db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    )[0];

  if (!row) return fail("That submission no longer exists.");
  const { submission, candidate, requisition } = row;

  if (submission.stage === stage && submission.status === "active") {
    return fail(`Already in ${pipeline.label(stage)}.`);
  }

  const target = stage as Stage;
  const hiring = target === "joined";
  const now = new Date();

  db.transaction(async (tx) => {
    (await tx.update(submissions)
      .set({
        stage: target,
        status: hiring ? "hired" : "active",
        stageSince: now,
        rejectionReason: null,
        rejectedAt: null,
        submittedAt:
          pipeline.atOrPastKind(target, "submitted") && !submission.submittedAt
            ? now
            : submission.submittedAt,
        ...stamp(actor.id, submission.rowVersion + 1),
      })
      .where(eq(submissions.id, submissionId))
      );

    (await tx.insert(stageEvents)
      .values({
        id: newId("stg"),
        submissionId,
        fromStage: submission.stage,
        toStage: target,
        actorId: actor.id,
        note: note ?? null,
        createdAt: now,
      })
      );

    if (hiring) {
      (await tx.update(candidates)
        .set({ status: "placed", updatedAt: now })
        .where(eq(candidates.id, candidate.id))
        );
    }
  });

  if (hiring || submission.status === "hired") await syncRequisitionFill(requisition.id);

  await logActivity({
    entityType: "submission",
    entityId: submissionId,
    type: "stage_changed",
    actorId: actor.id,
    summary: hiring
      ? `${candidate.firstName} ${candidate.lastName} joined ${requisition.title}`
      : `${candidate.firstName} ${candidate.lastName} moved to ${pipeline.label(target)} on ${requisition.code}`,
    changes: [{ field: "stage", label: "Stage", from: submission.stage, to: target }],
    meta: { requisitionId: requisition.id, candidateId: candidate.id, from: submission.stage, to: target },
  });

  const kind = pipeline.kind(target);
  if (kind === "submitted" || kind === "offer" || kind === "placement") {
    await notify({
      userIds: [requisition.leadRecruiterId, requisition.backupRecruiterId ?? "", requisition.hiringManagerId],
      type:
        kind === "submitted"
          ? "candidate_submitted"
          : kind === "offer"
            ? "candidate_selected"
            : "candidate_selected",
      title: `${candidate.firstName} ${candidate.lastName} → ${pipeline.label(target)}`,
      body: `${requisition.code} · ${requisition.title}`,
      href: `/candidates/${candidate.id}`,
      actorId: actor.id,
      entityType: "submission",
      entityId: submissionId,
      // Keyed by the stage, not the move: shuffling back and forth between two
      // stages should not produce a notification each time.
      dedupeKey: `stage:${submissionId}:${target}`,
    });
  }

  revalidateEverywhere(requisition.id, candidate.id);
  return succeed(
    hiring
      ? `${candidate.firstName} marked as joined`
      : `Moved to ${pipeline.label(target)}`,
  );
}

async function rejectSubmissionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(rejectSchema, formData);
  if (!parsed.success) return parsed.state;
  const { submissionId, outcome, reason, note } = parsed.data;

  const row = (await db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    )[0];

  if (!row) return fail("That submission no longer exists.");
  const { submission, candidate, requisition } = row;
  if (submission.status !== "active") return fail("This candidate is already closed out.");

  const now = new Date();

  db.transaction(async (tx) => {
    (await tx.update(submissions)
      .set({
        stage: outcome,
        status: outcome,
        rejectionReason: reason,
        rejectedAt: now,
        stageSince: now,
        ...stamp(actor.id, submission.rowVersion + 1),
      })
      .where(eq(submissions.id, submissionId))
      );

    (await tx.insert(stageEvents)
      .values({
        id: newId("stg"),
        submissionId,
        fromStage: submission.stage,
        toStage: outcome,
        actorId: actor.id,
        note: note ?? reason,
        createdAt: now,
      })
      );
  });

  if (note) {
    (await db.insert(notes)
      .values({
        id: newId("not"),
        entityType: "submission",
        entityId: submissionId,
        authorId: actor.id,
        body: note,
        pinned: false,
        createdAt: now,
      })
      );
  }

  await logActivity({
    entityType: "submission",
    entityId: submissionId,
    type: "submission_rejected",
    actorId: actor.id,
    summary: `${candidate.firstName} ${candidate.lastName} ${
      outcome === "withdrawn" ? "withdrew from" : "was closed out of"
    } ${requisition.code} — ${reason}`,
    changes: [
      { field: "stage", label: "Stage", from: submission.stage, to: outcome },
      { field: "status", label: "Status", from: submission.status, to: outcome },
    ],
    meta: { requisitionId: requisition.id, candidateId: candidate.id, reason },
  });

  revalidateEverywhere(requisition.id, candidate.id);
  return succeed(outcome === "withdrawn" ? "Marked as withdrawn" : "Candidate closed out");
}

/**
 * Park a candidate without closing them out (§8).
 *
 * Unlike a rejection this carries no reason and stays reversible: the stage
 * event records where they were, so `reopenSubmission` can put them back.
 */
async function holdSubmissionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(holdSchema, formData);
  if (!parsed.success) return parsed.state;
  const { submissionId, note } = parsed.data;

  const row = (await db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    )[0];

  if (!row) return fail("That submission no longer exists.");
  const { submission, candidate, requisition } = row;
  if (submission.status !== "active") return fail("This candidate is not active.");

  const now = new Date();

  db.transaction(async (tx) => {
    (await tx.update(submissions)
      .set({
        stage: "on_hold",
        status: "on_hold",
        stageSince: now,
        ...stamp(actor.id, submission.rowVersion + 1),
      })
      .where(eq(submissions.id, submissionId))
      );

    (await tx.insert(stageEvents)
      .values({
        id: newId("stg"),
        submissionId,
        fromStage: submission.stage,
        toStage: "on_hold",
        actorId: actor.id,
        note: note ?? "Put on hold",
        createdAt: now,
      })
      );
  });

  await logActivity({
    entityType: "submission",
    entityId: submissionId,
    type: "stage_changed",
    actorId: actor.id,
    summary: `${candidate.firstName} ${candidate.lastName} put on hold for ${requisition.code}`,
    changes: [
      { field: "stage", label: "Stage", from: submission.stage, to: "on_hold" },
      { field: "status", label: "Status", from: submission.status, to: "on_hold" },
    ],
    meta: { requisitionId: requisition.id, candidateId: candidate.id },
  });

  revalidateEverywhere(requisition.id, candidate.id);
  return succeed("Candidate put on hold");
}

async function reopenSubmissionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(reopenSchema, formData);
  if (!parsed.success) return parsed.state;
  const { submissionId, stage } = parsed.data;

  const row = (await db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    )[0];

  if (!row) return fail("That submission no longer exists.");
  const { submission, candidate, requisition } = row;
  if (submission.status === "active") return fail("This candidate is already active.");

  const now = new Date();
  const wasHired = submission.status === "hired";

  // A held candidate resumes where they stopped rather than restarting at
  // Screening, so parking someone does not cost them their pipeline position.
  const pipeline = await loadPipeline();
  const restartAt = resolveStage(pipeline, stage, pipeline.order[1] ?? pipeline.order[0]!);
  if (!restartAt.ok) {
    return fail("That stage no longer exists. Reload and try again.", { stage: "Unknown stage" });
  }
  const resumeAt =
    submission.status === "on_hold"
      ? await lastLiveStage(submissionId, restartAt.stage)
      : restartAt.stage;

  db.transaction(async (tx) => {
    (await tx.update(submissions)
      .set({
        stage: resumeAt,
        status: "active",
        rejectionReason: null,
        rejectedAt: null,
        stageSince: now,
        updatedAt: now,
      })
      .where(eq(submissions.id, submissionId))
      );

    (await tx.insert(stageEvents)
      .values({
        id: newId("stg"),
        submissionId,
        fromStage: submission.stage,
        toStage: resumeAt,
        actorId: actor.id,
        note: "Reopened",
        createdAt: now,
      })
      );

    (await tx.update(candidates)
      .set({ status: "active", updatedAt: now })
      .where(eq(candidates.id, candidate.id))
      );
  });

  if (wasHired) await syncRequisitionFill(requisition.id);

  await logActivity({
    entityType: "submission",
    entityId: submissionId,
    type: "stage_changed",
    actorId: actor.id,
    summary: `${candidate.firstName} ${candidate.lastName} reopened on ${requisition.code}`,
    meta: { requisitionId: requisition.id, candidateId: candidate.id },
  });

  revalidateEverywhere(requisition.id, candidate.id);
  return succeed("Candidate reopened");
}



/* ---- Guarded exports -------------------------------------------- *
 * Each mutation is only reachable through its permission check.
 * ------------------------------------------------------------------ */

export const addToPipeline = guarded("submission.create", addToPipelineImpl);
export const moveStage = guarded("submission.move", moveStageImpl);
export const rejectSubmission = guarded("submission.close", rejectSubmissionImpl);
export const holdSubmission = guarded("submission.move", holdSubmissionImpl);
export const reopenSubmission = guarded("submission.move", reopenSubmissionImpl);

/**
 * Optimistic drag-and-drop target on the pipeline board.
 *
 * Declared after the guarded exports so it calls the permission-checked
 * wrapper rather than the raw implementation.
 */
export async function moveStageById(submissionId: string, stage: Stage) {
  const formData = new FormData();
  formData.set("submissionId", submissionId);
  formData.set("stage", stage);
  return moveStage({ ok: false }, formData);
}
