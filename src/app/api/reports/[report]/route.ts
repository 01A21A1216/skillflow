import { can, loadPermissionMatrix } from "@/server/authz";
import { currentUser } from "@/server/session";
import { findReport, reportPeriod, toCsv } from "@/server/queries/reports";

export const dynamic = "force-dynamic";

/**
 * CSV export for a report (§19).
 *
 * A route handler rather than a server action because the browser has to
 * *receive a file*: an action returns a value into the React tree, and the
 * download would have to be reconstructed client-side from it.
 *
 * The rows come from the same definition the screen renders, so an export can
 * never quietly disagree with the chart above it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const { report: key } = await params;

  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });

  await loadPermissionMatrix();
  if (!can(user, "report.export")) {
    return new Response("Not found", { status: 404 });
  }

  const report = findReport(key);
  if (!report) return new Response("Not found", { status: 404 });

  const period = reportPeriod(new URL(request.url).searchParams.get("period") ?? undefined);
  const rows = await report.load(period.since);
  const csv = toCsv(report.columns, rows);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${report.key}-${period.key}-${stamp}.csv`;

  return new Response(
    // A BOM, so Excel opens the file as UTF-8 rather than as the local
    // codepage. Without it an em dash or a name with an accent arrives mangled.
    "\uFEFF" + csv,
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
