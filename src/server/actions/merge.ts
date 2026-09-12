"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  activities,
  attachments,
  candidateEducation,
  candidateExperience,
  candidates,
  notes,
  submissions,
} from "@/db/schema";
import type { User } from "@/db/schema";
import { softDeleteValues, stamp } from "@/server/integrity";
import { fail, guarded, logActivity, succeed, type ActionState } from "./shared";

/**
 * Merge one candidate record into another (§6, §20).
 *
 * The rule the whole thing is built around: **nothing is deleted.** Every
 * submission, interview, scorecard, note, file and activity entry from the
 * duplicate is re-pointed at the record being kept, and the duplicate is soft
 * deleted with a pointer back to where its history went. A merge that loses a
 * pipeline history is worse than the duplicate it was fixing.
 *
 * Empty fields on the keeper are filled from the duplicate — a phone number
 * captured on one record and not the other is exactly why the duplicate
 * existed — but nothing already present is overwritten. A merge should never
 * be a way to silently change data.
 */
async function mergeCandidatesImpl(actor: User, formData: FormData): Promise<ActionState> {
  const keepId = String(formData.get("keepId") ?? "");
  const mergeId = String(formData.get("mergeId") ?? "");

  if (!keepId || !mergeId) return fail("Pick both records to merge.");
  if (keepId === mergeId) return fail("That is the same record.");

  const rows = await db
    .select()
    .from(candidates)
    .where(inArray(candidates.id, [keepId, mergeId]));

  const keep = rows.find((r) => r.id === keepId);
  const merge = rows.find((r) => r.id === mergeId);

  if (!keep || !merge) return fail("One of those records no longer exists.");
  if (keep.deletedAt || merge.deletedAt) return fail("One of those records has been removed.");

  const now = new Date();

  // Both records may already be on the same requirement, and the unique index
  // on (candidate, requisition) would reject the second. Keep the one that got
  // furthest — that is the history worth having — and close the other out
  // rather than dropping it.
  const keepSubs = await db.select().from(submissions).where(eq(submissions.candidateId, keepId));
  const mergeSubs = await db.select().from(submissions).where(eq(submissions.candidateId, mergeId));
  const keepByReq = new Map(keepSubs.map((s) => [s.requisitionId, s]));

  const collisions = mergeSubs.filter((s) => keepByReq.has(s.requisitionId));
  const movable = mergeSubs.filter((s) => !keepByReq.has(s.requisitionId));

  await db.transaction(async (tx) => {
    // 1. Move everything that can simply move.
    if (movable.length) {
      (await tx.update(submissions)
        .set({ candidateId: keepId, updatedAt: now, updatedBy: actor.id })
        .where(
          and(
            eq(submissions.candidateId, mergeId),
            inArray(
              submissions.requisitionId,
              movable.map((s) => s.requisitionId),
            ),
          ),
        )
        );
    }

    // 2. Collisions: the duplicate's copy is closed out, with a reason that
    //    says where to look. It keeps its interviews and scorecards, so the
    //    evidence is still there even though the pipeline entry is not live.
    for (const dup of collisions) {
      (await tx.update(submissions)
        .set({
          status: "withdrawn",
          stage: "withdrawn",
          rejectionReason: "Duplicate record merged",
          rejectedAt: now,
          stageSince: now,
          ...stamp(actor.id, dup.rowVersion + 1),
        })
        .where(eq(submissions.id, dup.id))
        );
    }

    for (const table of [candidateEducation, candidateExperience] as const) {
      (await tx.update(table)
        .set({ candidateId: keepId })
        .where(eq(table.candidateId, mergeId))
        );
    }

    (await tx.update(attachments)
      .set({ entityId: keepId })
      .where(and(eq(attachments.entityType, "candidate"), eq(attachments.entityId, mergeId)))
      );

    (await tx.update(notes)
      .set({ entityId: keepId })
      .where(and(eq(notes.entityType, "candidate"), eq(notes.entityId, mergeId)))
      );

    // Activity is re-pointed too, so the kept record's timeline is the whole
    // story rather than half of it.
    (await tx.update(activities)
      .set({ entityId: keepId })
      .where(and(eq(activities.entityType, "candidate"), eq(activities.entityId, mergeId)))
      );

    // 3. Fill gaps on the keeper, overwrite nothing.
    const filled: Record<string, unknown> = {};
    const fillable = [
      "phone",
      "linkedinUrl",
      "sourceDetail",
      "primaryTechnology",
      "availableFrom",
      "summary",
    ] as const;
    for (const field of fillable) {
      if (!keep[field] && merge[field]) filled[field] = merge[field];
    }
    for (const field of ["currentSalary", "expectedSalary", "expectedRate"] as const) {
      if (keep[field] == null && merge[field] != null) filled[field] = merge[field];
    }
    // Union the lists rather than picking one: both were true of this person.
    const skills = [...new Set([...(keep.skills ?? []), ...(merge.skills ?? [])])];
    const tags = [...new Set([...(keep.tags ?? []), ...(merge.tags ?? [])])];

    (await tx.update(candidates)
      .set({
        ...filled,
        skills,
        tags,
        rating: Math.max(keep.rating, merge.rating),
        ...stamp(actor.id, keep.rowVersion + 1),
      })
      .where(eq(candidates.id, keepId))
      );

    // 4. Soft delete the duplicate. The row stays, so an id that leaked into a
    //    bookmark or an email still resolves to something explainable.
    (await tx.update(candidates)
      .set({
        ...softDeleteValues(actor.id),
        summary: `Merged into ${keep.firstName} ${keep.lastName}. ${merge.summary}`.trim(),
        updatedAt: now,
      })
      .where(eq(candidates.id, mergeId))
      );
  });

  const moved = movable.length;
  await logActivity({
    entityType: "candidate",
    entityId: keepId,
    type: "candidate_merged",
    actorId: actor.id,
    summary: `${merge.firstName} ${merge.lastName} merged into this record${
      moved ? ` — ${moved} pipeline ${moved === 1 ? "entry" : "entries"} moved across` : ""
    }`,
    changes: [
      { field: "mergedFrom", label: "Merged from", from: null, to: merge.email },
    ],
    meta: { mergedFromId: mergeId, moved, collisions: collisions.length },
  });

  revalidatePath("/candidates");
  revalidatePath(`/candidates/${keepId}`);
  revalidatePath("/pipeline");
  return succeed(`Merged into ${keep.firstName} ${keep.lastName}`, keepId);
}

export const mergeCandidates = guarded("candidate.merge", mergeCandidatesImpl);
