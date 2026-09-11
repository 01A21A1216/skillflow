"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { attachments, candidates, requisitions } from "@/db/schema";
import type { User } from "@/db/schema";
import { canTouchRequisition } from "@/server/authz";
import {
  AttachmentRejected,
  attachmentStore,
  checkUpload,
} from "@/server/storage";
import { denied, fail, guarded, logActivity, newId, succeed, type ActionState } from "./shared";

/** Records a file may hang off. Anything else is refused. */
const ATTACHABLE = ["candidate", "requisition"] as const;
type Attachable = (typeof ATTACHABLE)[number];

/**
 * May this actor attach to, or read attachments on, this record?
 *
 * Attachments inherit the visibility of whatever they hang off — a resume is
 * exactly as sensitive as the candidate it belongs to (§23), so there is no
 * separate sharing model to get out of step.
 */
async function ownerVisible(actor: User, entityType: Attachable, entityId: string) {
  if (entityType === "requisition") {
    const req = (await db.select().from(requisitions).where(eq(requisitions.id, entityId)))[0];
    if (!req) return false;
    return canTouchRequisition(actor, req.id);
  }
  const row = (await db.select().from(candidates).where(eq(candidates.id, entityId)))[0];
  return Boolean(row && !row.deletedAt);
}

async function uploadAttachmentImpl(actor: User, formData: FormData): Promise<ActionState> {
  const entityType = String(formData.get("entityType") ?? "") as Attachable;
  const entityId = String(formData.get("entityId") ?? "");
  const kind = String(formData.get("kind") ?? "document");
  const file = formData.get("file");

  if (!ATTACHABLE.includes(entityType) || !entityId) return fail("Nothing to attach that to.");
  if (!(file instanceof File)) return fail("Choose a file to upload.", { file: "Required" });
  if (!(await ownerVisible(actor, entityType, entityId))) return denied("that record");

  try {
    checkUpload({ name: file.name, type: file.type, size: file.size });
  } catch (error) {
    if (error instanceof AttachmentRejected) return fail(error.message, { file: error.message });
    throw error;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const store = attachmentStore();

  // The same file uploaded twice is almost always a mis-click, not an intent to
  // keep two copies. Re-point at the existing row rather than storing it again.
  const digest = store.digest(bytes);
  const duplicate = (await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.entityType, entityType),
        eq(attachments.entityId, entityId),
        eq(attachments.digest, digest),
        isNull(attachments.deletedAt),
      ),
    )
    )[0];
  if (duplicate) return succeed(`${file.name} is already attached.`, duplicate.id);

  const storageKey = await store.put({
    filename: file.name,
    contentType: file.type,
    bytes,
  });

  const id = newId("att");
  (await db.insert(attachments)
    .values({
      id,
      entityType,
      entityId,
      kind,
      // The stored name is the one the user recognises; it is never used to
      // build a path, so a hostile filename cannot reach the filesystem.
      filename: file.name.slice(0, 200),
      contentType: file.type,
      sizeBytes: bytes.byteLength,
      storageKey,
      digest,
      uploadedById: actor.id,
      createdAt: new Date(),
    })
    );

  await logActivity({
    entityType,
    entityId,
    type: "attachment_added",
    actorId: actor.id,
    summary: `${actor.name} attached ${file.name}`,
    meta: { attachmentId: id, kind },
  });

  revalidatePath(entityType === "candidate" ? `/candidates/${entityId}` : `/requisitions/${entityId}`);
  return succeed(`${file.name} attached`, id);
}

async function deleteAttachmentImpl(actor: User, formData: FormData): Promise<ActionState> {
  const attachmentId = String(formData.get("attachmentId") ?? "");
  if (!attachmentId) return fail("Nothing to delete.");

  const row = (await db.select().from(attachments).where(eq(attachments.id, attachmentId)))[0];
  if (!row || row.deletedAt) return fail("That file is already gone.");
  if (!(await ownerVisible(actor, row.entityType as Attachable, row.entityId))) {
    return denied("that record");
  }

  // Soft delete, like every other record (§20). The bytes stay in the store so
  // a mistaken delete is recoverable; a retention sweep is what removes them
  // for good, and that is item 5.4.
  (await db.update(attachments)
    .set({ deletedAt: new Date(), deletedBy: actor.id })
    .where(eq(attachments.id, attachmentId))
    );

  await logActivity({
    entityType: row.entityType,
    entityId: row.entityId,
    type: "attachment_removed",
    actorId: actor.id,
    summary: `${actor.name} removed ${row.filename}`,
    meta: { attachmentId },
  });

  revalidatePath(
    row.entityType === "candidate" ? `/candidates/${row.entityId}` : `/requisitions/${row.entityId}`,
  );
  return succeed(`${row.filename} removed`);
}

export const uploadAttachment = guarded("attachment.upload", uploadAttachmentImpl);
export const deleteAttachment = guarded("attachment.delete", deleteAttachmentImpl);
