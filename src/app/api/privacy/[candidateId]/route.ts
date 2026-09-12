import { can, loadPermissionMatrix } from "@/server/authz";
import { currentUser } from "@/server/session";
import { subjectAccessExport } from "@/server/privacy";
import { logActivity } from "@/server/actions/shared";

export const dynamic = "force-dynamic";

/**
 * Subject-access export (§23).
 *
 * A route handler rather than a server action, for the same reason the report
 * export is: the browser has to receive a file.
 *
 * JSON rather than CSV. A subject-access response is not a table — it is a
 * profile, a list of applications, a set of scorecards and a thread of
 * messages, and flattening that into rows would lose the structure that makes
 * it comprehensible. GDPR asks for a "commonly used, machine-readable
 * format", which JSON is; the prettified indentation is so a person can also
 * simply read it.
 *
 * The export itself is logged. Handing over everything held about somebody is
 * an event worth having a record of, and the record belongs against the
 * candidate so that the next person to look can see it happened.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const { candidateId } = await params;

  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });

  await loadPermissionMatrix();
  // Deliberately the same permission as erasure. Both are answers to a
  // data-subject request, and a full dossier — contact details, salary
  // expectations, every word a panel wrote — is not something the ordinary
  // candidate-view permission should hand over as a file.
  if (!can(user, "privacy.manage")) {
    return new Response("Not found", { status: 404 });
  }

  const data = await subjectAccessExport(candidateId);
  if (!data) return new Response("Not found", { status: 404 });

  await logActivity({
    entityType: "candidate",
    entityId: candidateId,
    type: "data_exported",
    actorId: user.id,
    summary: "Subject-access export produced",
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="subject-access-${candidateId}-${stamp}.json"`,
      // Never cached, anywhere. This response is the most sensitive thing the
      // application produces.
      "Cache-Control": "private, no-store",
    },
  });
}
