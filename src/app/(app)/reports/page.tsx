import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSpreadsheet } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { PeriodPicker } from "@/components/domain/period-picker";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { can } from "@/server/authz";
import { REPORTS, reportPeriod } from "@/server/queries/reports";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reports" };

/** Rows to show inline before the table starts scrolling on its own. */
const PREVIEW_ROWS = 8;

/**
 * Reports (§19).
 *
 * Analytics is for reading a trend; this is for taking the numbers somewhere
 * else. Every report renders from the same definition its CSV is built from,
 * so what is exported is what was on screen — the usual failure here is an
 * export written as a second query that slowly stops agreeing with the first.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const actor = await requirePermission("report.view");
  const period = reportPeriod(get("period"));
  const mayExport = can(actor, "report.export");

  const rendered = await Promise.all(
    REPORTS.map(async (report) => ({ report, rows: await report.load(period.since) })),
  );

  return (
    <>
      <PageHeader
        title="Reports"
        description="The numbers as tables, ready to leave the building. Every export carries exactly the rows shown here."
        actions={<PeriodPicker />}
        meta={
          <p className="text-[12.5px] text-content-subtle">
            Showing {period.label.toLowerCase()}.{" "}
            {mayExport
              ? "Exports are CSV, UTF-8, and open cleanly in Excel."
              : "You can read these; exporting needs the report export permission."}
          </p>
        }
      />

      <PageBody>
        {rendered.map(({ report, rows }) => (
          <Card key={report.key} padded={false}>
            <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
              <CardHeader
                icon={<FileSpreadsheet className="size-4" />}
                title={report.label}
                description={report.description}
              />
              {mayExport ? (
                <Link
                  href={`/api/reports/${report.key}?period=${period.key}`}
                  prefetch={false}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-[13px] font-medium text-content transition-colors hover:bg-surface-muted"
                >
                  <Download className="size-3.5" />
                  CSV
                </Link>
              ) : null}
            </div>

            <TableShell>
              <Table>
                <thead>
                  <Tr>
                    {report.columns.map((c, i) => (
                      <Th key={c} align={i === 0 ? "left" : "right"}>
                        {c}
                      </Th>
                    ))}
                  </Tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <Tr key={i}>
                      {row.map((cell, j) => (
                        <Td key={j} align={j === 0 ? "left" : "right"}>
                          <span
                            className={
                              j === 0
                                ? "text-[13px] text-content"
                                : "text-[13px] text-content-muted tabular-nums"
                            }
                          >
                            {cell === null ? "—" : String(cell)}
                          </span>
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>

            {rows.length > PREVIEW_ROWS ? (
              <p className="border-t border-border-base px-5 py-2.5 text-[12px] text-content-subtle tabular-nums">
                Showing {PREVIEW_ROWS} of {rows.length} rows. The export has all of them.
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="border-t border-border-base px-5 py-3 text-[12.5px] text-content-subtle">
                Nothing in this period.
              </p>
            ) : null}
          </Card>
        ))}
      </PageBody>
    </>
  );
}
