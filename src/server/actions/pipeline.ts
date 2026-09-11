"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { candidates, notes, requisitions, stageEvents, submissions } from "@/db/schema";
import type { User } from "@/db/schema";
import { STAGE, stageIndex, type Stage } from "@/lib/domain";
import { addToPipelineSchema, moveStageSchema, rejectSchema, reopenSchema } from "@/lib/validation";
import { canTouchRequisition } from "@/server/authz";
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
function syncRequisitionFill(requisitionId: string) {
  const req = db.select().from(requisitions).where(eq(requisitions.id, requisitionId)).get();
  if (!req) return;

  const hires = db
    .select({ count: sql<number>`count(*)` })
    .from(submissions)
    .where(and(eq(submissions.requisitionId, requisitionId), eq(submissions.status, "hired")))
    .get()!.count;

  const filled = Math.min(hires, req.openings);
  const shouldClose = hires >= req.openings;
  const isOpenish = ["open", "on_hold", "draft"].includes(req.status);

  db.update(requisitions)
    .set({
      filled,
      status: shouldClose && isOpenish ? "filled" : !shouldClose && req.status === "filled" ? "open" : req.status,
      closedAt: shouldClose ? (req.closedAt ?? new Date().toISOString().slice(0, 10)) : null,
      updatedAt: new Date(),
    })
    .where(eq(requisitions.id, requisitionId))
    .run();
}

async function addToPipelineImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(addToPipelineSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const candidate = db.select().from(candidates).where(eq(candidates.id, input.candidateId)).get();
  const req = db.select().from(requisitions).where(eq(requisitions.id, input.requisitionId)).get();
  if (!candidate) return fail("That candidate no longer exists.");
  if (!req) return fail("That requisition no longer exists.");
  if (!canTouchRequisition(actor, req.id)) return denied("that requisition");

  const duplicate = db
    .select()
    .from(submissions)
    .where(
      and(eq(submissions.candidateId, input.candidateId), eq(submissions.requisitionId, input.requisitionId)),
    )
    .get();

  if (duplicate) {
    return fail(`${candidate.firstName} is already on ${req.code}.`, {
      requisitionId: "Already in this pipeline",
    });
  }

  const id = newId("sub");
  const now = new Date();
  const stage = input.stage as Stage;

  db.transaction((tx) => {
    tx.insert(submissions)
      .values({
        id,
        candidateId: input.candidateId,
        requisitionId: input.requisitionId,
        stage,
        status: "active",
        ownerId: req.leadRecruiterId,
        matchScore: input.matchScore,
        submittedAt: stageIndex(stage) >= 2 ? now : null,
        stageSince: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Backfill the stages this candidate is being dropped past, so funnel
    // analytics and the timeline stay consistent.
    const path = ["sourced", "screening", "submitted", "interview", "offer"] as Stage[];
    for (const s of path.slice(0, stageIndex(stage) + 1)) {
      tx.insert(stageEvents)
        .values({
          id: newId("stg"),
          submissionId: id,
          fromStage: s === "sourced" ? null : path[path.indexOf(s) - 1]!,
          toStage: s,
          actorId: actor.id,
          note: s === stage ? (input.note ?? null) : null,
          createdAt: now,
        })
        .run();
    }

    if (candidate.status === "new" || candidate.status === "passive") {
      tx.update(candidates)
        .set({ status: "active", updatedAt: now })
        .where(eq(candidates.id, candidate.id))
        .run();
    }
  });

  if (input.note) {
    db.insert(notes)
      .values({
        id: newId("not"),
        entityType: "submission",
        entityId: id,
        authorId: actor.id,
        body: input.note,
        pinned: false,
        createdAt: now,
      })
      .run();
  }

  logActivity({
    entityType: "submission",
    entityId: id,
    type: "submission_created",
    actorId: actor.id,
    summary: `${candidate.firstName} ${candidate.lastName} added to ${req.code}`,
    meta: { requisitionId: req.id, candidateId: candidate.id },
  });

  revalidateEverywhere(req.id, candidate.id);
  return succeed(`Added to ${req.code}`, id);
}

async function moveStageImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(moveStageSchema, formData);
  if (!parsed.success) return parsed.state;
  const { submissionId, stage, note } = parsed.data;

  const row = db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    .get();

  if (!row) return fail("That submission no longer exists.");
  const { submission, candidate, requisition } = row;

  if (submission.stage === stage && submission.status === "active") {
    return fail(`Already in ${STAGE[stage as Stage].label}.`);
  }

  const target = stage as Stage;
  const hiring = target === "hired";
  const now = new Date();

  db.transaction((tx) => {
    tx.update(submissions)
      .set({
        stage: target,
        status: hiring ? "hired" : "active",
        stageSince: now,
        rejectionReason: null,
        rejectedAt: null,
        submittedAt:
          stageIndex(target) >= 2 && !submission.submittedAt ? now : submission.submittedAt,
        updatedAt: now,
      })
      .where(eq(submissions.id, submissionId))
      .run();

    tx.insert(stageEvents)
      .values({
        id: newId("stg"),
        submissionId,
        fromStage: submission.stage,
        toStage: target,
        actorId: actor.id,
        note: note ?? null,
        createdAt: now,
      })
      .run();

    if (hiring) {
      tx.update(candidates)
        .set({ status: "placed", updatedAt: now })
        .where(eq(candidates.id, candidate.id))
        .run();
    }
  });

  if (hiring || submission.status === "hired") syncRequisitionFill(requisition.id);

  logActivity({
    entityType: "submission",
    entityId: submissionId,
    type: "stage_changed",
    actorId: actor.id,
    summary: hiring
      ? `${candidate.firstName} ${candidate.lastName} hired for ${requisition.title}`
      : `${candidate.firstName} ${candidate.lastName} moved to ${STAGE[target].label} on ${requisition.code}`,
    meta: { requisitionId: requisition.id, candidateId: candidate.id, from: submission.stage, to: target },
  });

  revalidateEverywhere(requisition.id, candidate.id);
  return succeed(
    hiring
      ? `${candidate.firstName} marked as hired`
      : `Moved to ${STAGE[target].label}`,
  );
}

async function rejectSubmissionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(rejectSchema, formData);
  if (!parsed.success) return parsed.state;
  const { submissionId, outcome, reason, note } = parsed.data;

  const row = db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    .get();

  if (!row) return fail("That submission no longer exists.");
  const { submission, candidate, requisition } = row;
  if (submission.status !== "active") return fail("This candidate is already closed out.");

  const now = new Date();

  db.transaction((tx) => {
    tx.update(submissions)
      .set({
        stage: outcome,
        status: outcome,
        rejectionReason: reason,
        rejectedAt: now,
        stageSince: now,
        updatedAt: now,
      })
      .where(eq(submissions.id, submissionId))
      .run();

    tx.insert(stageEvents)
      .values({
        id: newId("stg"),
        submissionId,
        fromStage: submission.stage,
        toStage: outcome,
        actorId: actor.id,
        note: note ?? reason,
        createdAt: now,
      })
      .run();
  });

  if (note) {
    db.insert(notes)
      .values({
        id: newId("not"),
        entityType: "submission",
        entityId: submissionId,
        authorId: actor.id,
        body: note,
        pinned: false,
        createdAt: now,
      })
      .run();
  }

  logActivity({
    entityType: "submission",
    entityId: submissionId,
    type: "submission_rejected",
    actorId: actor.id,
    summary: `${candidate.firstName} ${candidate.lastName} ${
      outcome === "withdrawn" ? "withdrew from" : "was closed out of"
    } ${requisition.code} — ${reason}`,
    meta: { requisitionId: requisition.id, candidateId: candidate.id, reason },
  });

  revalidateEverywhere(requisition.id, candidate.id);
  return succeed(outcome === "withdrawn" ? "Marked as withdrawn" : "Candidate closed out");
}

async function reopenSubmissionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(reopenSchema, formData);
  if (!parsed.success) return parsed.state;
  const { submissionId, stage } = parsed.data;

  const row = db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    .get();

  if (!row) return fail("That submission no longer exists.");
  const { submission, candidate, requisition } = row;
  if (submission.status === "active") return fail("This candidate is already active.");

  const now = new Date();
  const wasHired = submission.status === "hired";

  db.transaction((tx) => {
    tx.update(submissions)
      .set({
        stage,
        status: "active",
        rejectionReason: null,
        rejectedAt: null,
        stageSince: now,
        updatedAt: now,
      })
      .where(eq(submissions.id, submissionId))
      .run();

    tx.insert(stageEvents)
      .values({
        id: newId("stg"),
        submissionId,
        fromStage: submission.stage,
        toStage: stage,
        actorId: actor.id,
        note: "Reopened",
        createdAt: now,
      })
      .run();

    tx.update(candidates)
      .set({ status: "active", updatedAt: now })
      .where(eq(candidates.id, candidate.id))
      .run();
  });

  if (wasHired) syncRequisitionFill(requisition.id);

  logActivity({
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

/** Optimistic drag-and-drop target on the pipeline board. */
export async function moveStageById(submissionId: string, stage: Stage) {
  const formData = new FormData();
  formData.set("submissionId", submissionId);
  formData.set("stage", stage);
  return moveStage({ ok: false }, formData);
}


/* ---- Guarded exports -------------------------------------------- *
 * Each mutation is only reachable through its permission check.
 * ------------------------------------------------------------------ */

export const addToPipeline = guarded("submission.create", addToPipelineImpl);
export const moveStage = guarded("submission.move", moveStageImpl);
export const rejectSubmission = guarded("submission.close", rejectSubmissionImpl);
export const reopenSubmission = guarded("submission.move", reopenSubmissionImpl);
