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
import {
  FEEDBACK_SLA_HOURS,
  INTERVIEW_TYPE,
  PENDING_INTERVIEW_STATUSES,
  type InterviewStatus,
  type InterviewType,
} from "@/lib/domain";
import { loadPipeline } from "@/server/pipeline";
import { nextInterviewStage, settleOutcome } from "@/server/rules";
import {
  declineFeedbackSchema,
  feedbackSchema,
  interviewOutcomeSchema,
  interviewSchema,
} from "@/lib/validation";
import { can, canTouchRequisition } from "@/server/authz";
import { scorecardForSubmission } from "@/server/queries/scorecards";
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

/**
 * Keep the three interview-band stages honest (§8).
 *
 * Interview Scheduled / Interview Completed / Feedback Pending are not three
 * things a recruiter remembers to click — they are three readings of the same
 * underlying facts, so they are recomputed from the interviews and scorecards
 * whenever either changes. A submission outside the band (still screening, or
 * already selected) is left alone: this never moves anyone forwards or back
 * past a decision a person made.
 */
async function syncInterviewStage(submissionId: string, actorId: string) {
  const current = (await db.select().from(submissions).where(eq(submissions.id, submissionId)))[0];
  if (!current) return;
  if (current.status !== "active") return;
  const pipeline = await loadPipeline();
  if (pipeline.kind(current.stage) !== "interviewing") return;

  const rounds = await db
    .select({
      id: interviews.id,
      status: interviews.status,
      scheduledAt: interviews.scheduledAt,
      panelSize: sql<number>`(select count(*)::int from interview_panel p where p.interview_id = ${interviews.id})`,
      feedbackCount: sql<number>`(select count(*)::int from feedback f where f.interview_id = ${interviews.id})`,
    })
    .from(interviews)
    .where(eq(interviews.submissionId, submissionId));

  const live = rounds.filter((r) => r.status !== "cancelled");
  if (live.length === 0) return;

  const awaiting = live.some((r) => r.status === "scheduled" && r.scheduledAt.getTime() > Date.now());
  const owing = live.some((r) => r.status === "completed" && r.feedbackCount < r.panelSize);

  const next = nextInterviewStage(
    pipeline.ofKind("interviewing"),
    { awaiting, owing },
    current.stage,
  );

  if (next === current.stage) return;

  const now = new Date();
  (await db.update(submissions)
    .set({ stage: next, stageSince: now, updatedAt: now })
    .where(eq(submissions.id, submissionId))
    );

  (await db.insert(stageEvents)
    .values({
      id: newId("stg"),
      submissionId,
      fromStage: current.stage,
      toStage: next,
      actorId,
      note: "Followed the interview schedule",
      createdAt: now,
    })
    );
}

async function context(submissionId: string) {
  return (await db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    )[0];
}

async function scheduleInterviewImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(interviewSchema, formData, ["panelIds"]);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const ctx = await context(input.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");
  if (!await canTouchRequisition(actor, ctx.requisition.id)) return denied("that requisition");

  const pipeline = await loadPipeline();
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) {
    return fail("Pick a valid date and time.", { scheduledAt: "Invalid date" });
  }

  const panelPeople = input.panelIds.length
    ? (await db.select().from(users).where(inArray(users.id, input.panelIds)))
    : [];

  if (!panelPeople.length) {
    return fail("Pick at least one interviewer.", { panelIds: "Select an interviewer" });
  }

  const id = newId("ivw");
  const now = new Date();

  const lastRound = (await db
    .select({ max: sql<number>`coalesce(max(${interviews.round}), 0)` })
    .from(interviews)
    .where(eq(interviews.submissionId, input.submissionId))
    )[0]!.max;

  // Whichever stage the configured pipeline calls the start of interviewing.
  const interviewEntry = pipeline.entryOf("interviewing");

  db.transaction(async (tx) => {
    (await tx.insert(interviews)
      .values({
        id,
        submissionId: input.submissionId,
        round: lastRound + 1,
        title: input.title,
        type: input.type,
        mode: input.mode,
        scheduledAt: when,
        endsAt: new Date(when.getTime() + input.durationMinutes * 60_000),
        durationMinutes: input.durationMinutes,
        timezone: input.timezone,
        locationOrLink: input.locationOrLink ?? null,
        status: "scheduled",
        outcome: "pending",
        organizerId: input.organizerId,
        agenda: input.agenda ?? null,
        createdAt: now,
        updatedAt: now,
      })
      );

    for (const person of panelPeople) {
      (await tx.insert(interviewPanel)
        .values({ id: newId("pnl"), interviewId: id, userId: person.id, role: "interviewer" })
        );
    }

    // Booking a round moves the candidate to Interview Scheduled, but never
    // drags anyone backwards — someone already at Selected or Offer who picks up
    // an extra round keeps the stage they earned.
    if (!pipeline.atOrPastKind(ctx.submission.stage, "interviewing")) {
      (await tx.update(submissions)
        .set({ stage: interviewEntry, stageSince: now, updatedAt: now })
        .where(eq(submissions.id, input.submissionId))
        );

      (await tx.insert(stageEvents)
        .values({
          id: newId("stg"),
          submissionId: input.submissionId,
          fromStage: ctx.submission.stage,
          toStage: interviewEntry,
          actorId: actor.id,
          note: `Advanced when ${input.title} was scheduled`,
          createdAt: now,
        })
        );
    }
  });

  await logActivity({
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

  const interview = (await db.select().from(interviews).where(eq(interviews.id, interviewId)))[0];
  if (!interview) return fail("That interview no longer exists.");

  const ctx = await context(interview.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");


  const now = new Date();

  // Completing a round starts the scorecard clock. It is set once and kept, so
  // marking a round complete twice does not quietly grant another day.
  const feedbackDueAt =
    status === "completed"
      ? (interview.feedbackDueAt ??
        new Date(
          Math.max(interview.endsAt.getTime(), now.getTime()) + FEEDBACK_SLA_HOURS * 3_600_000,
        ))
      : interview.feedbackDueAt;

  (await db.update(interviews)
    .set({
      status,
      outcome: status === "completed" ? outcome : "pending",
      feedbackDueAt,
      updatedAt: now,
    })
    .where(eq(interviews.id, interviewId))
    );

  // Nobody owes a scorecard for a round that did not happen.
  if (status === "cancelled" || status === "no_show" || status === "rescheduled") {
    (await db.update(interviewPanel)
      .set({ feedbackStatus: "declined" })
      .where(
        and(eq(interviewPanel.interviewId, interviewId), eq(interviewPanel.feedbackStatus, "pending")),
      )
      );
  }

  await logActivity({
    entityType: "submission",
    entityId: interview.submissionId,
    type: status === "cancelled" ? "interview_cancelled" : "interview_completed",
    actorId: actor.id,
    summary: `${interview.title} marked ${status.replace("_", " ")} for ${ctx.candidate.firstName} ${ctx.candidate.lastName}`,
    meta: { requisitionId: ctx.requisition.id, candidateId: ctx.candidate.id, interviewId },
  });

  await syncInterviewStage(interview.submissionId, actor.id);

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

  const interview = (await db.select().from(interviews).where(eq(interviews.id, input.interviewId)))[0];
  if (!interview) return fail("That interview no longer exists.");

  const ctx = await context(interview.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");

  const interviewer = (await db.select().from(users).where(eq(users.id, input.interviewerId)))[0];
  if (!interviewer) return fail("Unknown interviewer.");

  const onPanel = (await db
    .select()
    .from(interviewPanel)
    .where(
      and(
        eq(interviewPanel.interviewId, input.interviewId),
        eq(interviewPanel.userId, input.interviewerId),
      ),
    )
    )[0];

  if (!onPanel) {
    return fail(`${interviewer.name} is not on this interview panel.`, {
      interviewerId: "Not on the panel",
    });
  }
  // You may only file a scorecard as yourself, unless you administer feedback.
  if (input.interviewerId !== actor.id && !can(actor, "feedback.view.all")) {
    return fail("You can only submit your own feedback.");
  }

  const existing = (await db
    .select()
    .from(feedback)
    .where(
      and(eq(feedback.interviewId, input.interviewId), eq(feedback.interviewerId, input.interviewerId)),
    )
    )[0];

  // Score only against the template this panel was actually given. A stale
  // form posting a competency the template no longer has would otherwise write
  // a key nothing knows how to render.
  const template = await scorecardForSubmission(interview.submissionId);
  const allowed = new Set(template.criteria.map((c) => c.key));
  const scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.scores)) {
    if (allowed.has(key)) scores[key] = value;
  }

  const missing = template.criteria.filter((c) => scores[c.key] === undefined);
  if (missing.length) {
    return fail("Score every competency before submitting.", {
      [`scores.${missing[0]!.key}`]: "Required",
    });
  }

  const now = new Date();
  const values = {
    recommendation: input.recommendation,
    overall: input.overall,
    templateId: template.id,
    scores,
    strengths: input.strengths ?? "",
    concerns: input.concerns ?? "",
    notes: input.notes ?? "",
    submittedAt: now,
  };

  if (existing) {
    (await db.update(feedback).set(values).where(eq(feedback.id, existing.id)));
  } else {
    (await db.insert(feedback)
      .values({
        id: newId("fbk"),
        interviewId: input.interviewId,
        interviewerId: input.interviewerId,
        createdAt: now,
        ...values,
      })
      );
  }

  (await db.update(interviewPanel)
    .set({ feedbackStatus: "submitted" })
    .where(eq(interviewPanel.id, onPanel.id))
    );

  // Once everyone who still owes a scorecard has filed it, settle the round's
  // outcome from the balance of recommendations rather than asking someone to
  // restate a decision the scorecards already made. Panelists who stood down
  // are not counted as outstanding.
  const all = (await db.select().from(feedback).where(eq(feedback.interviewId, input.interviewId)));
  const outstanding = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(interviewPanel)
    .where(
      and(
        eq(interviewPanel.interviewId, input.interviewId),
        eq(interviewPanel.feedbackStatus, "pending"),
      ),
    )
    )[0]!.count;

  const settled =
    outstanding === 0 ? settleOutcome(all.map((f) => f.recommendation)) : null;

  if (settled) {
    (await db.update(interviews)
      .set({ status: "completed", outcome: settled, updatedAt: now })
      .where(eq(interviews.id, input.interviewId))
      );
  } else if (
    PENDING_INTERVIEW_STATUSES.includes(interview.status as InterviewStatus) &&
    interview.scheduledAt.getTime() < Date.now()
  ) {
    (await db.update(interviews)
      .set({ status: "completed", updatedAt: now })
      .where(eq(interviews.id, input.interviewId))
      );
  }

  await logActivity({
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

  await syncInterviewStage(interview.submissionId, actor.id);

  revalidatePath("/interviews");
  revalidatePath("/");
  revalidatePath(`/requisitions/${ctx.requisition.id}`);
  revalidatePath(`/candidates/${ctx.candidate.id}`);
  return succeed(existing ? "Feedback updated" : "Feedback submitted");
}

async function cancelInterviewImpl(actor: User, formData: FormData): Promise<ActionState> {
  const interviewId = String(formData.get("interviewId") ?? "");
  const interview = (await db.select().from(interviews).where(eq(interviews.id, interviewId)))[0];
  if (!interview) return fail("That interview no longer exists.");

  const ctx = await context(interview.submissionId);

  (await db.update(interviews)
    .set({ status: "cancelled", outcome: "pending", updatedAt: new Date() })
    .where(eq(interviews.id, interviewId))
    );

  await logActivity({
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


/**
 * Stand down from a round you cannot score (§10).
 *
 * The alternative is a scorecard that never arrives and an SLA that never
 * clears, so the honest outcome is recorded rather than chased forever. The
 * reason lands on the timeline — this is a visible act, not a quiet one.
 */
async function declineFeedbackImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(declineFeedbackSchema, formData);
  if (!parsed.success) return parsed.state;
  const { interviewId, interviewerId, reason } = parsed.data;

  if (interviewerId !== actor.id && !can(actor, "feedback.view.all")) {
    return fail("You can only stand down from your own rounds.");
  }

  const interview = (await db.select().from(interviews).where(eq(interviews.id, interviewId)))[0];
  if (!interview) return fail("That interview no longer exists.");

  const ctx = await context(interview.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");

  const seat = (await db
    .select()
    .from(interviewPanel)
    .where(
      and(eq(interviewPanel.interviewId, interviewId), eq(interviewPanel.userId, interviewerId)),
    )
    )[0];
  if (!seat) return fail("That person is not on this panel.");
  if (seat.feedbackStatus === "submitted") {
    return fail("That scorecard has already been submitted.");
  }

  const person = (await db.select().from(users).where(eq(users.id, interviewerId)))[0];

  (await db.update(interviewPanel)
    .set({ feedbackStatus: "declined" })
    .where(eq(interviewPanel.id, seat.id))
    );

  await logActivity({
    entityType: "submission",
    entityId: interview.submissionId,
    type: "feedback_submitted",
    actorId: actor.id,
    summary: `${person?.name ?? "An interviewer"} stood down from ${interview.title}${reason ? ` — ${reason}` : ""}`,
    meta: { requisitionId: ctx.requisition.id, candidateId: ctx.candidate.id, interviewId },
  });

  await syncInterviewStage(interview.submissionId, actor.id);

  revalidatePath("/interviews");
  revalidatePath(`/candidates/${ctx.candidate.id}`);
  return succeed("Marked as stood down");
}

/* ---- Guarded exports -------------------------------------------- *
 * Each mutation is only reachable through its permission check.
 * ------------------------------------------------------------------ */

export const scheduleInterview = guarded("interview.schedule", scheduleInterviewImpl);
export const updateInterviewOutcome = guarded("interview.schedule", updateInterviewOutcomeImpl);
export const submitFeedback = guarded("feedback.submit", submitFeedbackImpl);
export const declineFeedback = guarded("feedback.submit", declineFeedbackImpl);
export const cancelInterview = guarded("interview.cancel", cancelInterviewImpl);
