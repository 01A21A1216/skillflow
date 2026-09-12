import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  activities,
  attachments,
  candidateEducation,
  candidateExperience,
  candidates,
  clients,
  communications,
  feedback,
  interviews,
  notes,
  offers,
  requisitions,
  stageEvents,
  submissions,
  users,
} from "@/db/schema";
import { attachmentStore } from "@/server/storage";

/**
 * Data-subject rights (§23).
 *
 * Recruiting runs on personal data that the person concerned did not
 * necessarily volunteer and usually cannot see. Three obligations follow, and
 * this file implements all three rather than only the easy one:
 *
 * **Access.** On request, hand over everything held about someone, in a form
 * they can actually read. That is not a page — it is a file, and it has to
 * include the parts a recruiter would rather not show: the interview
 * feedback, the rejection reasons, the internal notes.
 *
 * **Erasure.** Delete it, irreversibly, on request. This is a different
 * operation from the soft delete the rest of the application uses, and the
 * difference is not a technicality. A soft delete hides a row and keeps every
 * field so the action can be undone; that is a feature for a mis-click and a
 * violation for a deletion request.
 *
 * **Retention.** Do not keep it indefinitely because storage is cheap. A
 * candidate nobody has spoken to in two years, who never agreed to be kept on
 * file, is personal data held without a purpose.
 *
 * The technique throughout is **anonymisation in place**, not deletion of
 * rows. The submissions, interviews and offers attached to a candidate are
 * the organisation's own record of its hiring process — it needs them for its
 * funnel, its audit trail and, in several jurisdictions, to show it did not
 * discriminate. Deleting those would be destroying the controller's records,
 * not the subject's data. What has to go is everything identifying; what
 * stays is a tombstone the statistics can still count.
 */

export const ERASED = "[erased]";

/* ------------------------------------------------------------------ *
 * Retention
 * ------------------------------------------------------------------ */

const DAY = 86_400_000;

export interface RetentionRule {
  key: string;
  label: string;
  days: number;
  description: string;
}

/**
 * How long each class of data is kept.
 *
 * Constants rather than settings, because a retention period is a decision a
 * data controller makes once with legal advice and then applies — not a knob
 * somebody tunes between sprints. They are gathered here so the policy is
 * visible in one place, and the settings screen reports them so nobody has to
 * read this file to know what it is.
 */
export const RETENTION: RetentionRule[] = [
  {
    key: "candidate_dormant",
    label: "Dormant candidates",
    days: 730,
    description:
      "A candidate with nothing live, no contact and no movement for two years, who never agreed to be kept on file, is erased.",
  },
  {
    key: "communications",
    label: "Contact history",
    days: 1095,
    description:
      "The body of a logged call or email is cleared after three years. That contact happened, and when, is kept.",
  },
  {
    key: "job_history",
    label: "Background job history",
    days: 1,
    description:
      "Queued deliveries carry names and addresses in their payload, so finished jobs are pruned the next day.",
  },
  {
    key: "sessions",
    label: "Expired sessions",
    days: 30,
    description: "Session rows are removed a month after they expire.",
  },
];

export const rule = (key: string) => RETENTION.find((r) => r.key === key)!;

/**
 * Candidates the dormant rule applies to.
 *
 * Four conditions, each there to stop the sweep erasing somebody it should
 * not: nothing live in a pipeline, no contact logged recently, nothing moved
 * recently, and no consent on file. A candidate who fails any one of them is
 * being used for something.
 */
export async function dormantCandidates(now = new Date(), limit = 500) {
  const cutoff = new Date(now.getTime() - rule("candidate_dormant").days * DAY);

  const live = db
    .select({ id: submissions.candidateId })
    .from(submissions)
    .where(and(eq(submissions.status, "active"), isNull(submissions.deletedAt)));

  const recentlyContacted = db
    .select({ id: communications.candidateId })
    .from(communications)
    .where(sql`${communications.occurredAt} >= ${cutoff}`);

  const recentlyMoved = db
    .select({ id: submissions.candidateId })
    .from(submissions)
    .where(sql`${submissions.stageSince} >= ${cutoff}`);

  return db
    .select({
      id: candidates.id,
      firstName: candidates.firstName,
      lastName: candidates.lastName,
      lastContactedAt: candidates.lastContactedAt,
      updatedAt: candidates.updatedAt,
      ownerId: candidates.ownerId,
    })
    .from(candidates)
    .where(
      and(
        isNull(candidates.erasedAt),
        isNull(candidates.retentionConsentAt),
        lt(candidates.updatedAt, cutoff),
        // `lastContactedAt` is null for someone never contacted, which is
        // older than any cutoff rather than newer. Without the `or`, SQL
        // drops the row on the null and the sweep quietly skips exactly the
        // people it most clearly applies to.
        or(isNull(candidates.lastContactedAt), lt(candidates.lastContactedAt, cutoff)),
        sql`${candidates.id} not in ${live}`,
        sql`${candidates.id} not in ${recentlyContacted}`,
        sql`${candidates.id} not in ${recentlyMoved}`,
      ),
    )
    .orderBy(candidates.updatedAt)
    .limit(limit);
}

/* ------------------------------------------------------------------ *
 * Subject access
 * ------------------------------------------------------------------ */

/**
 * Everything held about one person.
 *
 * Deliberately generous. The temptation with a subject-access request is to
 * hand over the profile and call it complete, but the parts a person is most
 * entitled to see — why they were rejected, what a panel said about them —
 * are exactly the parts a database makes easy to leave out. Interviewer and
 * author names are included, because an opinion recorded about somebody is
 * not an anonymous verdict.
 */
export async function subjectAccessExport(candidateId: string) {
  const person = (await db.select().from(candidates).where(eq(candidates.id, candidateId)))[0];
  if (!person) return null;

  const subs = await db
    .select({
      submission: submissions,
      requisitionTitle: requisitions.title,
      requisitionCode: requisitions.code,
      clientName: clients.name,
    })
    .from(submissions)
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .where(eq(submissions.candidateId, candidateId));

  const submissionIds = subs.map((s) => s.submission.id);

  const [education, experience, contactHistory, documents, ivs] = await Promise.all([
    db.select().from(candidateEducation).where(eq(candidateEducation.candidateId, candidateId)),
    db.select().from(candidateExperience).where(eq(candidateExperience.candidateId, candidateId)),
    db.select().from(communications).where(eq(communications.candidateId, candidateId)),
    db
      .select()
      .from(attachments)
      .where(and(eq(attachments.entityType, "candidate"), eq(attachments.entityId, candidateId))),
    submissionIds.length
      ? db
          .select({ interview: interviews, requisitionCode: requisitions.code })
          .from(interviews)
          .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
          .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
          .where(inArray(interviews.submissionId, submissionIds))
      : Promise.resolve([]),
  ]);

  const interviewIds = ivs.map((i) => i.interview.id);

  const [scorecards, stageHistory, offerRows, noteRows] = await Promise.all([
    interviewIds.length
      ? db
          .select({ feedback, interviewerName: users.name })
          .from(feedback)
          .innerJoin(users, eq(users.id, feedback.interviewerId))
          .where(inArray(feedback.interviewId, interviewIds))
      : Promise.resolve([]),
    submissionIds.length
      ? db
          .select()
          .from(stageEvents)
          .where(inArray(stageEvents.submissionId, submissionIds))
          .orderBy(stageEvents.createdAt)
      : Promise.resolve([]),
    submissionIds.length
      ? db.select().from(offers).where(inArray(offers.submissionId, submissionIds))
      : Promise.resolve([]),
    db
      .select({ note: notes, authorName: users.name })
      .from(notes)
      .innerJoin(users, eq(users.id, notes.authorId))
      .where(
        or(
          and(eq(notes.entityType, "candidate"), eq(notes.entityId, candidateId)),
          submissionIds.length
            ? and(eq(notes.entityType, "submission"), inArray(notes.entityId, submissionIds))
            : undefined,
        ),
      ),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    notice:
      "Everything this recruitment system holds about you, including internal assessments. Interviewer and author names are included because an opinion recorded about you is not anonymous.",
    profile: person,
    education,
    experience,
    applications: subs.map((s) => ({
      requisition: `${s.requisitionCode} — ${s.requisitionTitle}`,
      client: s.clientName,
      stage: s.submission.stage,
      status: s.submission.status,
      rejectionReason: s.submission.rejectionReason,
      appliedAt: s.submission.createdAt,
    })),
    stageHistory,
    interviews: ivs.map((i) => ({
      requisition: i.requisitionCode,
      title: i.interview.title,
      scheduledAt: i.interview.scheduledAt,
      status: i.interview.status,
      outcome: i.interview.outcome,
    })),
    scorecards: scorecards.map((s) => ({
      interviewer: s.interviewerName,
      recommendation: s.feedback.recommendation,
      overall: s.feedback.overall,
      scores: s.feedback.scores,
      strengths: s.feedback.strengths,
      concerns: s.feedback.concerns,
      notes: s.feedback.notes,
      submittedAt: s.feedback.submittedAt,
    })),
    offers: offerRows,
    contactHistory,
    internalNotes: noteRows.map((n) => ({
      author: n.authorName,
      body: n.note.body,
      at: n.note.createdAt,
    })),
    documents: documents.map((f) => ({ filename: f.filename, uploadedAt: f.createdAt })),
  };
}

/* ------------------------------------------------------------------ *
 * Erasure
 * ------------------------------------------------------------------ */

export interface ErasureResult {
  candidateId: string;
  /** What was overwritten or removed, for the confirmation and the audit row. */
  cleared: { table: string; rows: number }[];
  documentsDeleted: number;
  documentsFailed: number;
}

/**
 * Erase a person, keeping the organisation's record of its own process.
 *
 * Everything identifying is overwritten in place; nothing is left to
 * un-delete. What survives is the shape: that an application existed, which
 * requirement it was for, how far it got, when it ended and why. That is what
 * the funnel counts and what an equal-opportunities review looks at, and none
 * of it names anybody once this has run.
 *
 * Documents go from the store, not just from their rows. A resume left in
 * object storage after an erasure request is the erasure not having happened;
 * a store that refuses is counted and reported rather than swallowed, because
 * somebody then has to go and remove the file by hand.
 */
export async function eraseCandidate(
  candidateId: string,
  actorId: string,
  reason: "request" | "retention",
): Promise<ErasureResult | null> {
  const person = (await db.select().from(candidates).where(eq(candidates.id, candidateId)))[0];
  if (!person || person.erasedAt) return null;

  const now = new Date();
  const cleared: { table: string; rows: number }[] = [];

  const files = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.entityType, "candidate"), eq(attachments.entityId, candidateId)));

  const store = attachmentStore();
  let documentsDeleted = 0;
  let documentsFailed = 0;
  for (const file of files) {
    try {
      await store.delete(file.storageKey);
      documentsDeleted += 1;
    } catch (error) {
      documentsFailed += 1;
      console.error(`[privacy] could not delete ${file.storageKey}:`, error);
    }
  }
  if (files.length) {
    await db.delete(attachments).where(
      inArray(
        attachments.id,
        files.map((f) => f.id),
      ),
    );
    cleared.push({ table: "documents", rows: files.length });
  }

  const subIds = (
    await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.candidateId, candidateId))
  ).map((r) => r.id);

  await db.transaction(async (tx) => {
    // The person themself. The id, the owner and the dates stay so the record
    // is still joinable; nothing else about them does.
    await tx
      .update(candidates)
      .set({
        firstName: ERASED,
        lastName: `${ERASED} ${candidateId.slice(-4)}`,
        // A unique index means this cannot simply be blanked. `.invalid` is
        // reserved by RFC 2606 and can never resolve, so a mistake here
        // cannot become a real email to a real person.
        email: `erased+${candidateId}@invalid`,
        phone: null,
        location: ERASED,
        currentTitle: ERASED,
        currentCompany: ERASED,
        linkedinUrl: null,
        summary: "",
        skills: [],
        tags: [],
        expectedSalary: null,
        currentSalary: null,
        expectedRate: null,
        sourceDetail: null,
        rating: 0,
        status: "archived",
        erasedAt: now,
        erasedBy: actorId,
        erasureReason: reason,
        updatedAt: now,
        updatedBy: actorId,
      })
      .where(eq(candidates.id, candidateId));
    cleared.push({ table: "profile", rows: 1 });

    const edu = await tx
      .delete(candidateEducation)
      .where(eq(candidateEducation.candidateId, candidateId))
      .returning({ id: candidateEducation.id });
    if (edu.length) cleared.push({ table: "education", rows: edu.length });

    const exp = await tx
      .delete(candidateExperience)
      .where(eq(candidateExperience.candidateId, candidateId))
      .returning({ id: candidateExperience.id });
    if (exp.length) cleared.push({ table: "employment history", rows: exp.length });

    // Contact history keeps its skeleton — that an email went out on a date
    // is a record of what the business did — and loses its content.
    const comms = await tx
      .update(communications)
      .set({ subject: ERASED, body: ERASED })
      .where(eq(communications.candidateId, candidateId))
      .returning({ id: communications.id });
    if (comms.length) cleared.push({ table: "contact history", rows: comms.length });

    // Free text about a person is about that person wherever it was typed.
    const noteTargets = or(
      and(eq(notes.entityType, "candidate"), eq(notes.entityId, candidateId)),
      subIds.length
        ? and(eq(notes.entityType, "submission"), inArray(notes.entityId, subIds))
        : undefined,
    );
    const clearedNotes = await tx
      .update(notes)
      .set({ body: ERASED })
      .where(noteTargets)
      .returning({ id: notes.id });
    if (clearedNotes.length) cleared.push({ table: "notes", rows: clearedNotes.length });

    if (subIds.length) {
      const ivIds = (
        await tx
          .select({ id: interviews.id })
          .from(interviews)
          .where(inArray(interviews.submissionId, subIds))
      ).map((r) => r.id);

      if (ivIds.length) {
        // Scorecards keep their scores and recommendation — the numbers are
        // how the process is audited for fairness — and lose the prose, which
        // is where a person is described.
        const fb = await tx
          .update(feedback)
          .set({ strengths: ERASED, concerns: ERASED, notes: ERASED })
          .where(inArray(feedback.interviewId, ivIds))
          .returning({ id: feedback.id });
        if (fb.length) cleared.push({ table: "scorecards", rows: fb.length });

        await tx
          .update(interviews)
          .set({ agenda: null, locationOrLink: null })
          .where(inArray(interviews.id, ivIds));
      }

      const stages = await tx
        .update(stageEvents)
        .set({ note: null })
        .where(inArray(stageEvents.submissionId, subIds))
        .returning({ id: stageEvents.id });
      if (stages.length) cleared.push({ table: "stage notes", rows: stages.length });
    }

    /*
     * The audit trail is the hard case.
     *
     * It must not simply be deleted — an audit trail with a hole in it is
     * worse than none — but it is full of summaries like "Priya Raghavan moved
     * to Offer" and diffs holding old email addresses. So the rows stay, with
     * their type, actor and timestamp intact, and their human-readable content
     * is replaced. What remains answers "who did what, when" without answering
     * "to whom".
     */
    const audited = await tx
      .update(activities)
      .set({ summary: ERASED, changes: [], meta: {} })
      .where(
        or(
          and(eq(activities.entityType, "candidate"), eq(activities.entityId, candidateId)),
          subIds.length
            ? and(eq(activities.entityType, "submission"), inArray(activities.entityId, subIds))
            : undefined,
        ),
      )
      .returning({ id: activities.id });
    if (audited.length) cleared.push({ table: "audit entries", rows: audited.length });
  });

  return { candidateId, cleared, documentsDeleted, documentsFailed };
}

/** What has been erased, so a controller can show a request was honoured. */
export async function erasureLog(limit = 20) {
  return db
    .select({
      id: candidates.id,
      erasedAt: candidates.erasedAt,
      reason: candidates.erasureReason,
      actorName: users.name,
    })
    .from(candidates)
    .leftJoin(users, eq(users.id, candidates.erasedBy))
    .where(isNotNull(candidates.erasedAt))
    .orderBy(desc(candidates.erasedAt))
    .limit(limit);
}
