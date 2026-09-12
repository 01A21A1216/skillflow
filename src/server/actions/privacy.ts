"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { candidates } from "@/db/schema";
import type { User } from "@/db/schema";
import { eraseCandidate } from "@/server/privacy";
import { fail, guarded, logActivity, parseForm, succeed, type ActionState } from "./shared";
import { z } from "zod";

/**
 * Data-subject requests (§23).
 *
 * Both actions are behind `privacy.manage`, which by default only a Super
 * Admin holds. That is not because the operations are dangerous to the
 * system — erasure leaves the database perfectly consistent — but because
 * they answer a legal request rather than a recruiting need, and the person
 * doing it should be the person accountable for it.
 */

const erasureSchema = z.object({
  candidateId: z.string().min(1),
  /** Typed by hand, so a stray click cannot erase somebody. */
  confirmation: z.string(),
});

const consentSchema = z.object({
  candidateId: z.string().min(1),
  granted: z.coerce.boolean(),
});

const CONFIRM_WORD = "ERASE";

async function eraseCandidateDataImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(erasureSchema, formData);
  if (!parsed.success) return parsed.state;
  const { candidateId, confirmation } = parsed.data;

  if (confirmation.trim().toUpperCase() !== CONFIRM_WORD) {
    return fail(`Type ${CONFIRM_WORD} to confirm. This cannot be undone.`, {
      confirmation: "Does not match",
    });
  }

  const result = await eraseCandidate(candidateId, actor.id, "request");
  if (!result) return fail("That person no longer exists, or has already been erased.");

  const summary = result.cleared.map((c) => `${c.rows} ${c.table}`).join(", ");

  // Recorded against the candidate, deliberately: the erasure wrote `[erased]`
  // over that record's older audit entries, and this row is the one that says
  // why they are empty. Without it the trail looks tampered with rather than
  // lawfully cleared.
  await logActivity({
    entityType: "candidate",
    entityId: candidateId,
    type: "data_erased",
    actorId: actor.id,
    summary: `Personal data erased on request — ${summary}`,
    meta: {
      reason: "request",
      documentsDeleted: result.documentsDeleted,
      documentsFailed: result.documentsFailed,
    },
  });

  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  revalidatePath("/settings");

  if (result.documentsFailed) {
    // Not a failure of the erasure — the record is erased — but somebody has
    // to go and remove those files, and silence would hide that.
    return succeed(
      `Erased. ${result.documentsFailed} document(s) could not be removed from storage and need deleting by hand.`,
    );
  }
  return succeed("Erased. Nothing identifying that person remains.");
}

async function setRetentionConsentImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(consentSchema, formData);
  if (!parsed.success) return parsed.state;
  const { candidateId, granted } = parsed.data;

  await db
    .update(candidates)
    .set({ retentionConsentAt: granted ? new Date() : null, updatedBy: actor.id })
    .where(eq(candidates.id, candidateId));

  await logActivity({
    entityType: "candidate",
    entityId: candidateId,
    type: "note_added",
    actorId: actor.id,
    summary: granted
      ? "Agreed to be kept on file past the retention period"
      : "Withdrew consent to be kept on file",
  });

  revalidatePath(`/candidates/${candidateId}`);
  return succeed(granted ? "Consent recorded" : "Consent withdrawn");
}

export const eraseCandidateData = guarded("privacy.manage", eraseCandidateDataImpl);
export const setRetentionConsent = guarded("candidate.edit", setRetentionConsentImpl);
