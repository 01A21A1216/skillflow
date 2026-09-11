"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidates,
  feedback,
  interviewPanel,
  interviews,
  requisitions,
  stageEvents,
  submissions,
  users,
} from "@/db/schema";
import type { User } from "@/db/schema";
import { INTERVIEW_TYPE, type InterviewType } from "@/lib/domain";
import { feedbackSchema, interviewOutcomeSchema, interviewSchema } from "@/lib/validation";
import { can, canTouchRequisition } from "@/server/authz";
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

function context(submissionId: string) {
  return db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    .get();
}

async function scheduleInterviewImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(interviewSchema, formData, ["panelIds"]);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const ctx = context(input.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");
  if (!canTouchRequisition(actor, ctx.requisition.id)) return denied("that requisition");

  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return fail("Pick a valid date and time.", { scheduledAt: "Invalid date" });
  }

  const panelPeople = input.panelIds.length
    ? db.select().from(users).where(inArray(users.id, input.panelIds)).all()
    : [];

  if (!panelPeople.length) {
    return fail("Pick at least one interviewer.", { panelIds: "Select an interviewer" });
  }

  const id = newId("ivw");
  const now = new Date();

  const lastRound = db
    .select({ max: sql<number>`coalesce(max(${interviews.round}), 0)` })
    .from(interviews)
    .where(eq(interviews.submissionId, input.submissionId))
    .get()!.max;

  db.transaction((tx) => {
    tx.insert(interviews)
      .values({
        id,
        submissionId: input.submissionId,
        round: lastRound + 1,
        title: input.title,
        type: input.type,
        mode: input.mode,
        scheduledAt: when,
        durationMinutes: input.durationMinutes,
        locationOrLink: input.locationOrLink ?? null,
        status: "scheduled",
        outcome: "pending",
        organizerId: input.organizerId,
        agenda: input.agenda ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const person of panelPeople) {
      tx.insert(interviewPanel)
        .values({ id: newId("pnl"), interviewId: id, userId: person.id, role: "interviewer" })
        .run();
    }

    // Scheduling a loop moves the candidate into the interview stage.
    if (["sourced", "screening", "submitted"].includes(ctx.submission.stage)) {
      tx.update(submissions)
        .set({ stage: "interview", stageSince: now, updatedAt: now })
        .where(eq(submissions.id, input.submissionId))
        .run();

      tx.insert(stageEvents)
        .values({
          id: newId("stg"),
          submissionId: input.submissionId,
          fromStage: ctx.submission.stage,
          toStage: "interview",
          actorId: actor.id,
          note: `Advanced when ${input.title} was scheduled`,
          createdAt: now,
        })
        .run();
    }
  });

  logActivity({
    entityType: "submission",
    entityId: input.submissionId,
    type: "interview_scheduled",
    actorId: actor.id,
    summary: `${INTERVIEW_TYPE[input.type as InterviewType].label} scheduled for ${ctx.candidate.firstName} ${ctx.candidate.lastName}`,
    meta: {
      requisitionId: ctx.requisition.id,
      candidateId: ctx.candidate.id,
      interviewId: id,
      panel: panelPeople.map((p) => p.name),
    },
  });

  revalidatePath("/interviews");
  revalidatePath("/pipeline");
  revalidatePath("/");
  revalidatePath(`/requisitions/${ctx.requisition.id}`);
  revalidatePath(`/candidates/${ctx.candidate.id}`);
  return succeed(`${input.title} scheduled`, id);
}

async function updateInterviewOutcomeImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(interviewOutcomeSchema, formData);
  if (!parsed.success) return parsed.state;
  const { interviewId, status, outcome } = parsed.data;

  const interview = db.select().from(interviews).where(eq(interviews.id, interviewId)).get();
  if (!interview) return fail("That interview no longer exists.");

  const ctx = context(interview.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");


  db.update(interviews)
    .set({ status, outcome: status === "completed" ? outcome : "pending", updatedAt: new Date() })
    .where(eq(interviews.id, interviewId))
    .run();

  logActivity({
    entityType: "submission",
    entityId: interview.submissionId,
    type: status === "cancelled" ? "interview_cancelled" : "interview_completed",
    actorId: actor.id,
    summary: `${interview.title} marked ${status.replace("_", " ")} for ${ctx.candidate.firstName} ${ctx.candidate.lastName}`,
    meta: { requisitionId: ctx.requisition.id, candidateId: ctx.candidate.id, interviewId },
  });

  revalidatePath("/interviews");
  revalidatePath("/");
  revalidatePath(`/requisitions/${ctx.requisition.id}`);
  revalidatePath(`/candidates/${ctx.candidate.id}`);
  return succeed("Interview updated");
}

async function submitFeedbackImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(feedbackSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const interview = db.select().from(interviews).where(eq(interviews.id, input.interviewId)).get();
  if (!interview) return fail("That interview no longer exists.");

  const ctx = context(interview.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");

  const interviewer = db.select().from(users).where(eq(users.id, input.interviewerId)).get();
  if (!interviewer) return fail("Unknown interviewer.");

  const onPanel = db
    .select()
    .from(interviewPanel)
    .where(
      and(
        eq(interviewPanel.interviewId, input.interviewId),
        eq(interviewPanel.userId, input.interviewerId),
      ),
    )
    .get();

  if (!onPanel) {
    return fail(`${interviewer.name} is not on this interview panel.`, {
      interviewerId: "Not on the panel",
    });
  }
  // You may only file a scorecard as yourself, unless you administer feedback.
  if (input.interviewerId !== actor.id && !can(actor, "feedback.view.all")) {
    return fail("You can only submit your own feedback.");
  }

  const existing = db
    .select()
    .from(feedback)
    .where(
      and(eq(feedback.interviewId, input.interviewId), eq(feedback.interviewerId, input.interviewerId)),
    )
    .get();

  const now = new Date();
  const values = {
    recommendation: input.recommendation,
    overall: input.overall,
    technical: input.technical,
    communication: input.communication,
    problemSolving: input.problemSolving,
    cultureFit: input.cultureFit,
    strengths: input.strengths ?? "",
    concerns: input.concerns ?? "",
    notes: input.notes ?? "",
    submittedAt: now,
  };

  if (existing) {
    db.update(feedback).set(values).where(eq(feedback.id, existing.id)).run();
  } else {
    db.insert(feedback)
      .values({
        id: newId("fbk"),
        interviewId: input.interviewId,
        interviewerId: input.interviewerId,
        createdAt: now,
        ...values,
      })
      .run();
  }

  // Once every panelist has weighed in, settle the interview outcome from
  // the balance of recommendations rather than asking someone to restate it.
  const all = db.select().from(feedback).where(eq(feedback.interviewId, input.interviewId)).all();
  const panelSize = db
    .select({ count: sql<number>`count(*)` })
    .from(interviewPanel)
    .where(eq(interviewPanel.interviewId, input.interviewId))
    .get()!.count;

  if (all.length >= panelSize) {
    const score =
      all.reduce((sum, f) => {
        const map: Record<string, number> = {
          strong_hire: 2,
          hire: 1,
          lean_hire: 0.5,
          lean_no_hire: -1,
          no_hire: -2,
        };
        return sum + (map[f.recommendation] ?? 0);
      }, 0) / all.length;

    const settled =
      score >= 1.5 ? "strong_yes" : score >= 0.75 ? "yes" : score > 0 ? "lean_yes" : score > -1 ? "lean_no" : score > -1.75 ? "no" : "strong_no";

    db.update(interviews)
      .set({ status: "completed", outcome: settled, updatedAt: now })
      .where(eq(interviews.id, input.interviewId))
      .run();
  } else if (interview.status === "scheduled" && interview.scheduledAt.getTime() < Date.now()) {
    db.update(interviews)
      .set({ status: "completed", updatedAt: now })
      .where(eq(interviews.id, input.interviewId))
      .run();
  }

  logActivity({
    entityType: "submission",
    entityId: interview.submissionId,
    type: "feedback_submitted",
    actorId: input.interviewerId,
    summary: `${interviewer.name} submitted feedback for ${ctx.candidate.firstName} ${ctx.candidate.lastName}`,
    meta: {
      requisitionId: ctx.requisition.id,
      candidateId: ctx.candidate.id,
      interviewId: input.interviewId,
      recommendation: input.recommendation,
    },
  });

  revalidatePath("/interviews");
  revalidatePath("/");
  revalidatePath(`/requisitions/${ctx.requisition.id}`);
  revalidatePath(`/candidates/${ctx.candidate.id}`);
  return succeed(existing ? "Feedback updated" : "Feedback submitted");
}

async function cancelInterviewImpl(actor: User, formData: FormData): Promise<ActionState> {
  const interviewId = String(formData.get("interviewId") ?? "");
  const interview = db.select().from(interviews).where(eq(interviews.id, interviewId)).get();
  if (!interview) return fail("That interview no longer exists.");

  const ctx = context(interview.submissionId);

  db.update(interviews)
    .set({ status: "cancelled", outcome: "pending", updatedAt: new Date() })
    .where(eq(interviews.id, interviewId))
    .run();

  logActivity({
    entityType: "submission",
    entityId: interview.submissionId,
    type: "interview_cancelled",
    actorId: actor.id,
    summary: `${interview.title} cancelled${ctx ? ` for ${ctx.candidate.firstName} ${ctx.candidate.lastName}` : ""}`,
  });

  revalidatePath("/interviews");
  revalidatePath("/");
  return succeed("Interview cancelled");
}


/* ---- Guarded exports -------------------------------------------- *
 * Each mutation is only reachable through its permission check.
 * ------------------------------------------------------------------ */

export const scheduleInterview = guarded("interview.schedule", scheduleInterviewImpl);
export const updateInterviewOutcome = guarded("interview.schedule", updateInterviewOutcomeImpl);
export const submitFeedback = guarded("feedback.submit", submitFeedbackImpl);
export const cancelInterview = guarded("interview.cancel", cancelInterviewImpl);
