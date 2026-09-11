import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { attachments, users } from "@/db/schema";

export interface AttachmentRow {
  id: string;
  kind: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
  href: string;
}

function toRow(a: typeof attachments.$inferSelect, uploadedBy: string): AttachmentRow {
  return {
    id: a.id,
    kind: a.kind,
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    uploadedBy,
    createdAt: a.createdAt,
    // Never the storage key: the bytes are only reachable through a route that
    // re-checks who is asking (§23).
    href: `/api/attachments/${a.id}`,
  };
}

/** Files on one record, newest first. Soft-deleted ones never come back. */
export async function listAttachments(entityType: string, entityId: string): Promise<AttachmentRow[]> {
  const rows = await db
    .select({ attachment: attachments, uploader: users.name })
    .from(attachments)
    .innerJoin(users, eq(users.id, attachments.uploadedById))
    .where(
      and(
        eq(attachments.entityType, entityType),
        eq(attachments.entityId, entityId),
        isNull(attachments.deletedAt),
      ),
    )
    .orderBy(desc(attachments.createdAt));

  return rows.map((r) => toRow(r.attachment, r.uploader));
}

/** Files across many records at once, for list views. */
export async function attachmentCounts(entityType: string, entityIds: string[]) {
  if (!entityIds.length) return new Map<string, number>();
  const rows = await db
    .select({ entityId: attachments.entityId })
    .from(attachments)
    .where(
      and(
        eq(attachments.entityType, entityType),
        inArray(attachments.entityId, entityIds),
        isNull(attachments.deletedAt),
      ),
    );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.entityId, (map.get(r.entityId) ?? 0) + 1);
  return map;
}
