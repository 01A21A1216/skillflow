import { eq } from "drizzle-orm";

import { db } from "@/db";
import { attachments, candidates } from "@/db/schema";
import { can, canTouchRequisition, loadPermissionMatrix } from "@/server/authz";
import { currentUser } from "@/server/session";
import { attachmentStore } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * The only path by which attachment bytes reach a browser.
 *
 * Files are stored under random keys outside the web root, so this handler is
 * the whole access-control story for them (§23): it re-checks the signed-in
 * user against the record the file hangs off, exactly as the pages do. A
 * candidate's resume is precisely as private as the candidate.
 *
 * Everything below returns 404 rather than 403 for a file the caller may not
 * see, because "this id exists but is not yours" is itself a disclosure.
 */
/**
 * A filename safe to put inside a quoted `Content-Disposition`.
 *
 * Quotes, backslashes and control characters would let an uploaded name break
 * out of the header value and inject one of its own.
 */
function safeFilename(name: string) {
  const cleaned = name.replace(/[^\w .\-()\[\]]+/g, "_").slice(0, 120);
  return cleaned || "attachment";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });

  await loadPermissionMatrix();
  if (!can(user, "attachment.view")) return new Response("Not found", { status: 404 });

  const row = (await db.select().from(attachments).where(eq(attachments.id, id)))[0];
  if (!row || row.deletedAt) return new Response("Not found", { status: 404 });

  if (row.entityType === "requisition") {
    if (!(await canTouchRequisition(user, row.entityId))) {
      return new Response("Not found", { status: 404 });
    }
  } else if (row.entityType === "candidate") {
    const candidate = (await db
      .select({ deletedAt: candidates.deletedAt })
      .from(candidates)
      .where(eq(candidates.id, row.entityId))
      )[0];
    if (!candidate || candidate.deletedAt) return new Response("Not found", { status: 404 });
    if (!can(user, "candidate.view.all")) return new Response("Not found", { status: 404 });
  } else {
    // An entity type nothing knows how to authorize is not served.
    return new Response("Not found", { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await attachmentStore().get(row.storageKey);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(bytes.byteLength),
      // `attachment` rather than `inline`: an uploaded HTML or SVG file rendered
      // in this origin would run as the app.
      "Content-Disposition": `attachment; filename="${safeFilename(row.filename)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
