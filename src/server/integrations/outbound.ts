import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  candidates,
  interviewPanel,
  interviews,
  requisitions,
  submissions,
  users,
} from "@/db/schema";
import { INTERVIEW_TYPE, type InterviewType } from "@/lib/domain";

import {
  calendar,
  email,
  jobBoard,
  type CalendarEvent,
  type DeliveryResult,
} from "./ports";

/**
 * The outside world, in domain terms (§22).
 *
 * Actions call the functions in this file with an id and nothing else. They
 * do not know a calendar exists, cannot see a `DeliveryResult`, and are not
 * written differently depending on whether a provider is configured. Everything
 * that knows about an external system lives here and in `ports.ts`.
 *
 * Two rules hold throughout:
 *
 * **An integration failure never fails the user's action.** Booking an
 * interview is a fact in this database; whether Google accepted the invite is
 * a separate and lesser question. The same reasoning as `notify()` — the work
 * succeeded, and losing the side effect is the smaller harm — except that here
 * the failure is also recorded, because an invite nobody received is something
 * a person eventually has to chase.
 *
 * **Idempotency keys are ours, not the provider's.** Every payload carries a
 * key derived from our row id and, where it matters, the version of the fact
 * being sent. A retried delivery is one event at the far end, not two.
 */

function report(what: string, result: DeliveryResult) {
  if (!result.sent && result.reason) {
    // Not an error when nothing is configured, which is the default posture;
    // noted at info level so the absence is visible in a deployment that
    // expected a provider to be wired up.
    console.info(`[integration] ${what}: ${result.reason}`);
  }
  return result;
}

/** Everything the calendar needs about one round, in one read. */
export interface InterviewDetail {
  interview: typeof interviews.$inferSelect;
  candidate: typeof candidates.$inferSelect;
  requisition: typeof requisitions.$inferSelect;
  organiser: typeof users.$inferSelect;
  panelEmails: string[];
}

async function interviewDetail(interviewId: string): Promise<InterviewDetail | null> {
  const row = (
    await db
      .select({
        interview: interviews,
        candidate: candidates,
        requisition: requisitions,
        organiser: users,
      })
      .from(interviews)
      .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
      .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
      .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
      .innerJoin(users, eq(users.id, interviews.organizerId))
      .where(eq(interviews.id, interviewId))
  )[0];
  if (!row) return null;

  const panel = await db
    .select({ email: users.email })
    .from(interviewPanel)
    .innerJoin(users, eq(users.id, interviewPanel.userId))
    .where(eq(interviewPanel.interviewId, interviewId));

  return { ...row, panelEmails: panel.map((p) => p.email) };
}

/**
 * The calendar payload for one round.
 *
 * Exported because this is where the decisions are — what the key is, who is
 * invited, what the description says — and those are worth a test that does
 * not need a database or a provider.
 */
export function calendarEventFor(detail: InterviewDetail): CalendarEvent {
  const { interview, candidate, requisition, organiser, panelEmails } = detail;
  const type = INTERVIEW_TYPE[interview.type as InterviewType]?.label ?? interview.type;

  return {
    // `updatedAt` is part of the key so a rescheduled round is a new payload
    // to the provider rather than a duplicate of the original booking.
    idempotencyKey: `interview:${interview.id}:${interview.updatedAt.getTime()}`,
    title: `${interview.title} — ${candidate.firstName} ${candidate.lastName}`,
    description: [
      `${type} · Round ${interview.round}`,
      `${requisition.code} — ${requisition.title}`,
      interview.agenda ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
    startsAt: interview.scheduledAt,
    endsAt: interview.endsAt,
    timezone: interview.timezone,
    location: interview.locationOrLink,
    organiserEmail: organiser.email,
    // The candidate is deliberately not on the invite. Panel calendars are
    // internal; sending a candidate an invite is a communication decision a
    // recruiter makes, not something a stage change does silently.
    attendeeEmails: [...new Set(panelEmails)],
  };
}

/**
 * Put a newly booked round in the panel's calendars.
 *
 * The provider's id is written back, because cancelling later needs it.
 */
export async function interviewBooked(interviewId: string) {
  const detail = await interviewDetail(interviewId);
  if (!detail) return;

  const result = report("calendar create", await calendar().create(calendarEventFor(detail)));
  if (result.sent && result.externalId) {
    await db
      .update(interviews)
      .set({ calendarEventId: result.externalId })
      .where(eq(interviews.id, interviewId));
  }
}

/**
 * Keep the invite in step with the round.
 *
 * A round that was cancelled, rescheduled or no-showed should not still be in
 * anyone's calendar as if it were happening. Without a stored provider id
 * there is nothing to act on — which is the state of every row until a
 * provider is configured — so this is a no-op rather than an error.
 */
export async function interviewChanged(interviewId: string, status: string) {
  const detail = await interviewDetail(interviewId);
  if (!detail?.interview.calendarEventId) return;
  const externalId = detail.interview.calendarEventId;

  if (status === "cancelled" || status === "no_show") {
    const result = report(
      "calendar cancel",
      await calendar().cancel(externalId, `Marked ${status.replace("_", " ")}`),
    );
    if (result.sent) {
      await db
        .update(interviews)
        .set({ calendarEventId: null })
        .where(eq(interviews.id, interviewId));
    }
    return;
  }

  report("calendar update", await calendar().update(externalId, calendarEventFor(detail)));
}

/* ------------------------------------------------------------------ *
 * Job boards
 * ------------------------------------------------------------------ */

/**
 * Publish an open requirement, or take it down.
 *
 * Only the client-safe fields go out: the title, the location, the shape of
 * the engagement and the skills. Never the client's name, the internal
 * margin, or the pay range's ceiling if it was marked confidential — a job
 * board is a public surface and the requisition record is not.
 */
export async function requisitionPublished(requisitionId: string) {
  const req = (await db.select().from(requisitions).where(eq(requisitions.id, requisitionId)))[0];
  if (!req) return;

  report(
    "job board publish",
    await jobBoard().publish({
      idempotencyKey: `requisition:${req.id}:${req.rowVersion}`,
      title: req.title,
      description: req.description,
      location: req.location,
      workMode: req.workMode,
      employmentType: req.employmentType,
      salaryMin: req.minSalary,
      salaryMax: req.maxSalary,
      skills: req.requiredSkills,
    }),
  );
}

export async function requisitionClosed(requisitionId: string) {
  report("job board unpublish", await jobBoard().unpublish(requisitionId));
}

/* ------------------------------------------------------------------ *
 * Email
 * ------------------------------------------------------------------ */

/**
 * Send one message.
 *
 * Exposed for the notification transport rather than for call sites: nothing
 * in the application composes an email directly, because a message that is
 * worth sending outside the app is worth having in the inbox too.
 */
export async function sendEmail(message: {
  idempotencyKey: string;
  to: string[];
  subject: string;
  body: string;
}) {
  const recipients = [...new Set(message.to.filter(Boolean))];
  if (!recipients.length) return { sent: false, reason: "No recipients." };
  return report("email", await email().send({ ...message, to: recipients }));
}
