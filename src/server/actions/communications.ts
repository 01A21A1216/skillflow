"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { candidates, communications } from "@/db/schema";
import type { User } from "@/db/schema";
import { CHANNEL, type Channel } from "@/lib/domain";
import { communicationSchema } from "@/lib/validation";
import { fail, guarded, logActivity, newId, parseForm, succeed, type ActionState } from "./shared";

/**
 * Record a conversation with a candidate (§7).
 *
 * Logged by hand. This application does not own anyone's mailbox, and a
 * complete-looking history it cannot actually guarantee would be worse than an
 * honest partial one — a recruiter who believes the log is complete stops
 * checking their inbox.
 */
async function logContactImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(communicationSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const candidate = (await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, input.candidateId))
    )[0];
  if (!candidate || candidate.deletedAt) return fail("That candidate no longer exists.");

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return fail("Pick a valid date and time.", { occurredAt: "Invalid date" });
  }
  // A conversation cannot have happened tomorrow. A follow-up can.
  if (occurredAt.getTime() > Date.now() + 60_000) {
    return fail("That is in the future — did you mean to set a follow-up?", {
      occurredAt: "Cannot be in the future",
    });
  }

  const followUpAt = input.followUpAt ? new Date(input.followUpAt) : null;
  if (followUpAt && Number.isNaN(followUpAt.getTime())) {
    return fail("Pick a valid follow-up date.", { followUpAt: "Invalid date" });
  }

  const id = newId("com");
  (await db.insert(communications)
    .values({
      id,
      candidateId: input.candidateId,
      submissionId: input.submissionId || null,
      channel: input.channel,
      direction: input.direction,
      subject: input.subject ?? "",
      body: input.body,
      followUpAt,
      occurredAt,
      loggedById: actor.id,
      createdAt: new Date(),
    })
    );

  // Last contacted is what the candidate list sorts and filters on, so it has
  // to move when a conversation is logged — otherwise the log and the list
  // disagree about the same fact.
  if (!candidate.lastContactedAt || candidate.lastContactedAt < occurredAt) {
    (await db.update(candidates)
      .set({ lastContactedAt: occurredAt, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(candidates.id, input.candidateId))
      );
  }

  await logActivity({
    entityType: "candidate",
    entityId: input.candidateId,
    type: "contact_logged",
    actorId: actor.id,
    summary: `${actor.name} logged ${
      input.direction === "inbound" ? "an inbound" : "an outbound"
    } ${CHANNEL[input.channel as Channel].label.toLowerCase()} with ${candidate.firstName} ${candidate.lastName}`,
    meta: { communicationId: id, channel: input.channel },
  });

  revalidatePath(`/candidates/${input.candidateId}`);
  revalidatePath("/");
  return succeed("Contact logged", id);
}

async function deleteContactImpl(actor: User, formData: FormData): Promise<ActionState> {
  const contactId = String(formData.get("contactId") ?? "");
  const row = (await db.select().from(communications).where(eq(communications.id, contactId)))[0];
  if (!row || row.deletedAt) return fail("That entry is already gone.");

  // Only the person who wrote it, or someone who can edit the candidate.
  if (row.loggedById !== actor.id) {
    return fail("You can only remove entries you logged.");
  }

  (await db.update(communications)
    .set({ deletedAt: new Date(), deletedBy: actor.id })
    .where(and(eq(communications.id, contactId)))
    );

  revalidatePath(`/candidates/${row.candidateId}`);
  return succeed("Entry removed");
}

export const logContact = guarded("note.create", logContactImpl);
export const deleteContact = guarded("note.create", deleteContactImpl);
