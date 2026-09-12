import "server-only";

import { and, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidates,
  clients,
  interviewPanel,
  interviews,
  requisitions,
  submissions,
} from "@/db/schema";
import { logActivity } from "@/server/actions/shared";
import { notify } from "@/server/notify";
import { dormantCandidates, eraseCandidate, rule } from "@/server/privacy";
import { loadPipeline } from "@/server/pipeline";
import { communications, sessions } from "@/db/schema";

const DAY = 86_400_000;

/**
 * The notifications no user action produces (§14).
 *
 * Four of the thirteen triggers are about the *absence* of something —
 * feedback that has not arrived, a requirement that is not filling, a
 * candidate nobody has touched. Nothing happens to cause them, so something
 * has to come looking.
 *
 * Each sweep is a job kind (item 4.2, `jobs/handlers.ts`) and runs on a
 * schedule, not on a page render. They are exported individually rather than
 * only through `runSweeps()` so that one failing does not stop the other two,
 * and so the queue can report which one was slow.
 *
 * Every notification they produce is deduplicated on (person, fact), so the
 * cadence is a cost question rather than a correctness one: running a sweep
 * twice writes nothing the second time.
 */

/** Requirements within this many days of the client's SLA get a warning. */
const SLA_WARNING_DAYS = 5;
/** Open this long with nothing moving is an escalation, not a warning. */
const AGING_DAYS = 30;
/** A live candidate untouched for this long has effectively been dropped. */
const IDLE_DAYS = 14;

/** All three, for a manual run from the settings screen. */
export async function runSweeps() {
  await Promise.all([feedbackOverdueSweep(), requirementSweep(), idleCandidateSweep()]);
}

/**
 * Scorecards past their due time.
 *
 * Deduplicated per person per interview, so this fires once however often the
 * sweep runs — the point is to tell someone, not to nag them hourly.
 */
export async function feedbackOverdueSweep() {
  const rows = await db
    .select({
      interviewId: interviews.id,
      title: interviews.title,
      userId: interviewPanel.userId,
      dueAt: interviews.feedbackDueAt,
      candidateFirst: candidates.firstName,
      candidateLast: candidates.lastName,
      code: requisitions.code,
    })
    .from(interviewPanel)
    .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
    .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(
      and(
        eq(interviewPanel.feedbackStatus, "pending"),
        eq(interviews.status, "completed"),
        lt(interviews.feedbackDueAt, new Date()),
        // Old debt is a report, not a notification. Telling someone about a
        // scorecard from two months ago achieves nothing except training them
        // to ignore the bell.
        gte(interviews.feedbackDueAt, new Date(Date.now() - 21 * DAY)),
      ),
    )
    .limit(200);

  for (const r of rows) {
    const hoursLate = r.dueAt ? Math.round((Date.now() - r.dueAt.getTime()) / 3_600_000) : 0;
    await notify({
      userIds: [r.userId],
      type: "feedback_overdue",
      title: `Scorecard overdue: ${r.candidateFirst} ${r.candidateLast}`,
      body: `${r.title} · ${r.code} · ${hoursLate}h past due`,
      href: `/interviews?window=awaiting_feedback&focus=${r.interviewId}`,
      entityType: "interview",
      entityId: r.interviewId,
      dedupeKey: `feedback_overdue:${r.interviewId}`,
    });
  }
}

/**
 * Requirements approaching their client SLA, and those well past it.
 *
 * Two separate triggers because they need different responses: one is "start
 * pushing", the other is "this needs a conversation with the client".
 */
export async function requirementSweep() {
  const rows = await db
    .select({
      id: requisitions.id,
      code: requisitions.code,
      title: requisitions.title,
      openedAt: requisitions.openedAt,
      leadRecruiterId: requisitions.leadRecruiterId,
      backupRecruiterId: requisitions.backupRecruiterId,
      hiringManagerId: requisitions.hiringManagerId,
      clientName: clients.name,
      slaDays: clients.slaDays,
    })
    .from(requisitions)
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .where(and(eq(requisitions.status, "open"), isNull(requisitions.deletedAt)));

  for (const r of rows) {
    const ageDays = Math.floor((Date.now() - new Date(r.openedAt).getTime()) / DAY);
    const recipients = [r.leadRecruiterId, r.backupRecruiterId ?? "", r.hiringManagerId];

    if (ageDays >= AGING_DAYS) {
      await notify({
        userIds: recipients,
        type: "requirement_aging",
        title: `${r.code} has been open ${ageDays} days`,
        body: `${r.title} · ${r.clientName}. Past the ${r.slaDays}-day SLA.`,
        href: `/requisitions/${r.id}`,
        entityType: "requisition",
        entityId: r.id,
        // Keyed to the threshold crossed, not the day, so one requirement
        // produces one warning and one escalation — not one of each per day.
        dedupeKey: `requirement_aging:${r.id}`,
      });
    } else if (ageDays >= r.slaDays - SLA_WARNING_DAYS) {
      await notify({
        userIds: recipients,
        type: "requirement_sla",
        title: `${r.code} is approaching its SLA`,
        body: `${r.title} · ${r.clientName}. Day ${ageDays} of ${r.slaDays}.`,
        href: `/requisitions/${r.id}`,
        entityType: "requisition",
        entityId: r.id,
        dedupeKey: `requirement_sla:${r.id}`,
      });
    }
  }
}

/**
 * Live candidates nobody has touched.
 *
 * "Touched" means the stage moved, not that somebody looked at the page — a
 * candidate sitting in one stage for a fortnight has been forgotten whatever
 * anybody has read.
 */
export async function idleCandidateSweep() {
  const pipeline = await loadPipeline();
  const cutoff = new Date(Date.now() - IDLE_DAYS * DAY);

  const rows = await db
    .select({
      submissionId: submissions.id,
      candidateId: candidates.id,
      firstName: candidates.firstName,
      lastName: candidates.lastName,
      stage: submissions.stage,
      stageSince: submissions.stageSince,
      ownerId: submissions.ownerId,
      code: requisitions.code,
    })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(
      and(
        eq(submissions.status, "active"),
        isNull(submissions.deletedAt),
        lte(submissions.stageSince, cutoff),
        // A candidate waiting on a client is not being neglected by us.
        sql`${submissions.stage} <> ${pipeline.lastOf("submitted")}`,
      ),
    )
    .limit(200);

  for (const r of rows) {
    const days = Math.floor((Date.now() - r.stageSince.getTime()) / DAY);
    await notify({
      userIds: [r.ownerId],
      type: "candidate_idle",
      title: `${r.firstName} ${r.lastName} has not moved in ${days} days`,
      body: `${pipeline.label(r.stage)} on ${r.code}`,
      href: `/candidates/${r.candidateId}`,
      entityType: "submission",
      entityId: r.submissionId,
      // Keyed to the stage they are stuck in, so moving them and getting stuck
      // again later is a new fact worth reporting.
      dedupeKey: `candidate_idle:${r.submissionId}:${r.stage}`,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Retention (§23)
 * ------------------------------------------------------------------ */

/**
 * Apply the retention policy.
 *
 * The one sweep in this file that deletes rather than notifies, which is why
 * it reports what it did. An erasure the business cannot see happening is an
 * erasure nobody can answer questions about, so every run returns its counts
 * and each individual erasure writes its own audit entry.
 *
 * The actor is recorded as the system rather than as whoever happened to
 * trigger the pass. Attributing an automatic deletion to a person who merely
 * opened a page would make the audit trail a lie.
 */
export const RETENTION_ACTOR = "system:retention";

export async function retentionSweep() {
  const now = new Date();

  const due = await dormantCandidates(now, 200);
  let erased = 0;
  for (const person of due) {
    const result = await eraseCandidate(person.id, RETENTION_ACTOR, "retention");
    if (!result) continue;
    erased += 1;
    await logActivity({
      entityType: "candidate",
      entityId: person.id,
      type: "data_erased",
      actorId: null,
      summary: `Personal data erased — dormant for over ${Math.round(rule("candidate_dormant").days / 365)} years`,
      meta: { reason: "retention", documentsDeleted: result.documentsDeleted },
    });
  }

  // Old message bodies. The row stays — that contact happened on a date is a
  // record of what the business did — and the content goes.
  const commsCutoff = new Date(now.getTime() - rule("communications").days * DAY);
  const scrubbed = await db
    .update(communications)
    .set({ subject: "[retained: content removed]", body: "" })
    .where(and(lt(communications.occurredAt, commsCutoff), sql`${communications.body} <> ''`))
    .returning({ id: communications.id });

  // Sessions are pure liability once expired: a token hash and a user agent,
  // useful to nobody and interesting to an attacker.
  const sessionCutoff = new Date(now.getTime() - rule("sessions").days * DAY);
  const expired = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, sessionCutoff))
    .returning({ id: sessions.id });

  return {
    candidatesErased: erased,
    communicationsScrubbed: scrubbed.length,
    sessionsRemoved: expired.length,
  };
}
