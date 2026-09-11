import type { Metadata } from "next";
import Link from "next/link";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { ChartFrame } from "@/components/charts/primitives";
import { SERIES } from "@/components/charts/palette";
import {
  Columns,
  FunnelBars,
  HorizontalBars,
  SmallMultiples,
  StackedColumns,
} from "@/components/charts/charts";
import { PeriodPicker } from "@/components/domain/period-picker";
import { KpiTile } from "@/components/domain/kpi-tile";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/misc";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { SOURCE, STAGE, type Source, type Stage } from "@/lib/domain";
import { formatNumber, formatPercent, pluralize } from "@/lib/utils";
import {
  clientBreakdown,
  departmentBreakdown,
  funnel,
  interviewAnalytics,
  interviewerLoad,
  monthlyTrend,
  PERIODS,
  pipelineAging,
  recruiterPerformance,
  rejectionReasons,
  resolvePeriod,
  sourceEffectiveness,
  stageVelocity,
  timeToHire,
} from "@/server/queries/analytics";
import { offerStats } from "@/server/queries/offers";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  await requirePermission("report.view");
  const period = resolvePeriod(get("period"));
  const since = period.key === "all" ? undefined : period.since;

  const steps = await funnel(since);
  const velocity = await stageVelocity(since);
  const tth = await timeToHire(since);
  const trend = await monthlyTrend(12);
  const sources = await sourceEffectiveness(since);
  const recruiters = await recruiterPerformance(since);
  const departments = await departmentBreakdown();
  const clients = await clientBreakdown();
  const rejections = await rejectionReasons(since);
  const ivStats = await interviewAnalytics(since);
  const load = await interviewerLoad(since);
  const aging = await pipelineAging();
  const offers = await offerStats();

  const submitted = steps.find((s) => s.stage === "submitted")?.count ?? 0;
  const hires = steps.find((s) => s.stage === "joined")?.count ?? 0;
  const sourcedToHire = steps.find((s) => s.stage === "joined")?.overallConversion ?? 0;

  const trendSeries = [
    { key: "added", label: "Added", color: SERIES[0] },
    { key: "submitted", label: "Submitted", color: SERIES[1] },
    { key: "interviewed", label: "Interviewed", color: SERIES[2] },
    { key: "hires", label: "Hired", color: SERIES[6] },
  ];

  return (
    <>
      <PageHeader
        title="Hiring analytics"
        description="Where the funnel leaks, how long each stage really takes, which sources convert, and who is carrying the load."
        actions={<PeriodPicker />}
        meta={
          <p className="text-[12.5px] text-content-subtle">
            Showing {PERIODS[period.key]!.label.toLowerCase()}. Every chart has a table view — use
            the toggle in its top-right corner to read the exact numbers.
          </p>
        }
      />

      <PageBody>
        {/* ---------------- Headline ---------------- */}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Hires"
            value={String(hires)}
            hint={`${formatPercent(sourcedToHire, 1)} of everyone sourced`}
            tone="emerald"
          />
          <KpiTile
            label="Median time to fill"
            value={`${Math.round(tth.medianTimeToFill)}d`}
            hint={`Mean ${Math.round(tth.avgTimeToFill)}d · requisition open to hire`}
            tone={tth.medianTimeToFill > 60 ? "amber" : "blue"}
          />
          <KpiTile
            label="Median time to hire"
            value={`${Math.round(tth.medianTimeToHire)}d`}
            hint="Candidate entering the pipeline to accepted offer"
            tone="violet"
          />
          <KpiTile
            label="Offer acceptance"
            value={`${Math.round(offers.acceptanceRate)}%`}
            hint={`${offers.accepted} accepted, ${offers.declined} declined`}
            tone={offers.acceptanceRate >= 75 ? "emerald" : "amber"}
          />
        </section>

        {/* ---------------- Funnel + velocity ---------------- */}
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartFrame
            title="Conversion funnel"
            description={`How many of the ${formatNumber(steps[0]?.count ?? 0)} people sourced reached each stage.`}
            table={{
              columns: ["Stage", "Reached", "From previous", "From sourced", "Lost here"],
              rows: steps.map((s) => [
                s.label,
                formatNumber(s.count),
                `${Math.round(s.stepConversion)}%`,
                `${Math.round(s.overallConversion)}%`,
                formatNumber(s.dropOff),
              ]),
            }}
          >
            <FunnelBars steps={steps} />
          </ChartFrame>

          <ChartFrame
            title="Average days in each stage"
            description="Ordered stages, so the ramp reads as progression rather than category."
            height={240}
            table={{
              columns: ["Stage", "Average days", "Median days", "Transitions measured"],
              rows: velocity.map((v) => [
                v.label,
                v.avgDays.toFixed(1),
                v.medianDays.toFixed(1),
                formatNumber(v.samples),
              ]),
            }}
          >
            <Columns
              data={velocity.map((v) => ({
                ...v,
                avgDays: Number(v.avgDays.toFixed(1)),
                medianDaysLabel: v.medianDays.toFixed(1),
              }))}
              dataKey="avgDays"
              xKey="label"
              label="Average days"
              ordinal
              height={240}
              valueSuffix="d"
              tooltipFields={[
                { key: "medianDaysLabel", label: "Median", suffix: "d" },
                { key: "samples", label: "Transitions measured" },
              ]}
            />
          </ChartFrame>
        </div>

        {/* ---------------- Throughput ---------------- */}
        <ChartFrame
          title="Throughput over the last 12 months"
          description="Each panel keeps its own scale. Additions and hires differ by an order of magnitude, so plotting them against one shared axis would hide the series that matters most, and a second y-axis would imply a correlation that is not in the data."
          table={{
            columns: ["Month", "Added", "Submitted", "Interviewed", "Hired"],
            rows: trend.map((t) => [t.label, t.added, t.submitted, t.interviewed, t.hires]),
          }}
        >
          <SmallMultiples data={trend} series={trendSeries} className="lg:grid-cols-4" />
        </ChartFrame>

        {/* ---------------- Sources ---------------- */}
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartFrame
            title="Where hires actually come from"
            description="Volume by channel, with the hire rate behind each bar."
            height={280}
            table={{
              columns: ["Source", "Candidates", "Submitted", "Interviewed", "Hires", "Hire rate"],
              rows: sources.map((s) => [
                SOURCE[s.source as Source]?.label ?? s.source,
                s.candidates,
                s.submitted,
                s.interviewed,
                s.hires,
                `${s.hireRate.toFixed(1)}%`,
              ]),
            }}
          >
            <HorizontalBars
              data={sources.map((s) => ({
                label: SOURCE[s.source as Source]?.label ?? s.source,
                candidates: s.candidates,
                hires: s.hires,
                hireRate: Number(s.hireRate.toFixed(1)),
              }))}
              dataKey="candidates"
              label="Candidates"
              height={280}
              tooltipFields={[
                { key: "hires", label: "Hires" },
                { key: "hireRate", label: "Hire rate", suffix: "%" },
              ]}
            />
          </ChartFrame>

          <Card className="flex flex-col">
            <CardHeader
              title="Source quality"
              description="Volume is easy; conversion is the number worth managing."
            />
            <ul className="mt-4 space-y-3">
              {sources.slice(0, 8).map((s) => (
                <li key={s.source}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="truncate text-content">
                      {SOURCE[s.source as Source]?.label ?? s.source}
                    </span>
                    <span className="shrink-0 text-content-muted tabular-nums">
                      {s.hires} of {s.candidates} · {s.hireRate.toFixed(1)}%
                    </span>
                  </div>
                  <Meter
                    value={s.hireRate}
                    max={Math.max(...sources.map((x) => x.hireRate), 1)}
                    tone={s.hireRate >= 5 ? "emerald" : s.hireRate >= 2 ? "blue" : "slate"}
                    height={6}
                    label={`${s.source} hire rate`}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* ---------------- Recruiter performance ---------------- */}
        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              title="Recruiter performance"
              description={`Conversion and throughput per recruiter over ${PERIODS[period.key]!.label.toLowerCase()}.`}
            />
          </div>
          <div className="overflow-x-auto border-t border-border-base">
            <Table>
              <thead>
                <tr>
                  <Th className="min-w-[13rem]">Recruiter</Th>
                  <Th align="right">Open reqs</Th>
                  <Th className="min-w-[8rem]">Load</Th>
                  <Th align="right">Active</Th>
                  <Th align="right">Submitted</Th>
                  <Th align="right">Interviewed</Th>
                  <Th align="right">Hires</Th>
                  <Th align="right">Submit → interview</Th>
                  <Th align="right">Offer acceptance</Th>
                  <Th align="right">Time to hire</Th>
                </tr>
              </thead>
              <tbody>
                {recruiters.map((r) => (
                  <Tr key={r.id} interactive>
                    <Td>
                      <Link href={`/team/${r.id}`} className="flex items-center gap-2.5">
                        <Avatar name={r.name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-content">
                            {r.name}
                          </span>
                          <span className="block truncate text-[11px] text-content-subtle">
                            {r.title}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.openReqs}/{r.capacity}
                    </Td>
                    <Td>
                      <Meter
                        value={Math.min(r.load, 100)}
                        tone={r.load > 100 ? "rose" : r.load > 80 ? "amber" : "emerald"}
                        height={6}
                        label={`${r.name} load`}
                      />
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.activePipeline}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.submitted}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.interviewed}
                    </Td>
                    <Td align="right" className="font-semibold tabular-nums">
                      {r.hires}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {Math.round(r.submitToInterview)}%
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.offerAcceptance ? `${Math.round(r.offerAcceptance)}%` : "—"}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.avgTimeToHire ? `${Math.round(r.avgTimeToHire)}d` : "—"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        {/* ---------------- Pipeline health ---------------- */}
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartFrame
            title="How long live candidates have been waiting"
            description="Age buckets across the whole active pipeline — an ordered scale, so it wears the ordinal ramp."
            height={230}
            table={{
              columns: ["Age", "Candidates"],
              rows: aging.buckets.map((b) => [b.label, b.count]),
            }}
          >
            <Columns
              data={aging.buckets}
              dataKey="count"
              xKey="label"
              label="Candidates"
              ordinal
              height={230}
            />
          </ChartFrame>

          <ChartFrame
            title="Why candidates are closed out"
            description="Recorded reasons across rejections and withdrawals."
            height={230}
            table={{
              columns: ["Reason", "Count", "Share"],
              rows: rejections.map((r) => [r.reason, r.count, `${Math.round(r.share)}%`]),
            }}
          >
            <HorizontalBars
              data={rejections.slice(0, 8).map((r) => ({ label: r.reason, count: r.count }))}
              dataKey="count"
              label="Candidates"
              height={230}
              color={SERIES[7]}
            />
          </ChartFrame>
        </div>

        {/* ---------------- Interviews ---------------- */}
        <div className="grid gap-5 lg:grid-cols-3">
          <ChartFrame
            className="lg:col-span-2"
            title="Interview volume and pass rate by round type"
            description="How many of each round we run, and the share that end in a positive signal."
            height={240}
            legend={[
              { label: "Completed", color: SERIES[0] },
              { label: "Not completed", color: SERIES[4] },
            ]}
            table={{
              columns: ["Round type", "Scheduled", "Completed", "Positive", "Pass rate"],
              rows: ivStats.byType.map((t) => [
                t.type.replace(/_/g, " "),
                t.total,
                t.completed,
                t.positive,
                `${Math.round(t.passRate)}%`,
              ]),
            }}
          >
            <StackedColumns
              data={ivStats.byType.map((t) => ({
                label: t.type.replace(/_/g, " "),
                completed: t.completed,
                other: t.total - t.completed,
                passRate: Math.round(t.passRate),
              }))}
              height={240}
              series={[
                { key: "completed", label: "Completed", color: SERIES[0] },
                { key: "other", label: "Not completed", color: SERIES[4] },
              ]}
            />
          </ChartFrame>

          <Card>
            <CardHeader title="Interview operations" />
            <dl className="mt-4 space-y-3.5">
              {[
                {
                  label: "Completion rate",
                  value: `${Math.round(ivStats.completionRate)}%`,
                  hint: `${ivStats.completed} of ${ivStats.total} scheduled`,
                },
                {
                  label: "No-show rate",
                  value: `${ivStats.noShowRate.toFixed(1)}%`,
                  hint: `${ivStats.noShows} candidates did not attend`,
                },
                {
                  label: "Panel hours",
                  value: `${Math.round(ivStats.totalHours)}h`,
                  hint: "Total interviewer time booked",
                },
                {
                  label: "Feedback turnaround",
                  value: `${ivStats.avgFeedbackTurnaroundDays.toFixed(1)}d`,
                  hint: "From the interview ending to a scorecard landing",
                },
                {
                  label: "Average score",
                  value: `${ivStats.avgRating.toFixed(1)}/5`,
                  hint: "Across every submitted scorecard",
                },
              ].map((m) => (
                <div key={m.label} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <dt className="text-[13px] text-content">{m.label}</dt>
                    <dd className="mt-0.5 text-[11.5px] text-content-subtle">{m.hint}</dd>
                  </div>
                  <span className="shrink-0 text-[15px] font-semibold text-content tabular-nums">
                    {m.value}
                  </span>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        {/* ---------------- Interviewer load ---------------- */}
        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              title="Interviewer load"
              description="Panel hours carried by each person, and any scorecards they still owe."
            />
          </div>
          <TableShell className="rounded-none border-0 border-t border-border-base shadow-none">
            <Table>
              <thead>
                <tr>
                  <Th className="min-w-[13rem]">Interviewer</Th>
                  <Th>Department</Th>
                  <Th align="right">Rounds</Th>
                  <Th align="right">Hours</Th>
                  <Th align="right">Feedback owed</Th>
                  <Th className="min-w-[9rem]">Relative load</Th>
                </tr>
              </thead>
              <tbody>
                {load.slice(0, 12).map((p) => (
                  <Tr key={p.id} interactive>
                    <Td>
                      <Link href={`/team/${p.id}`} className="flex items-center gap-2.5">
                        <Avatar name={p.name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-content">
                            {p.name}
                          </span>
                          <span className="block truncate text-[11px] text-content-subtle">
                            {p.title}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td className="text-[12.5px] text-content-muted">{p.department}</Td>
                    <Td align="right" className="tabular-nums">
                      {p.interviews}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {Math.round(p.hours)}h
                    </Td>
                    <Td align="right">
                      {p.owed > 0 ? (
                        <span className="font-medium text-[hsl(var(--tone-amber))] tabular-nums">
                          {p.owed}
                        </span>
                      ) : (
                        <span className="text-content-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <Meter
                        value={p.hours}
                        max={load[0]?.hours ?? 1}
                        tone="indigo"
                        height={6}
                        label={`${p.name} interview hours`}
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableShell>
        </Card>

        {/* ---------------- Demand ---------------- */}
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartFrame
            title="Demand by department"
            description="Open seats and how much live pipeline sits behind them."
            height={260}
            legend={[
              { label: "Seats", color: SERIES[0] },
              { label: "Active pipeline", color: SERIES[2] },
            ]}
            table={{
              columns: ["Department", "Requisitions", "Seats", "Filled", "Active pipeline", "Fill rate"],
              rows: departments.map((d) => [
                d.department,
                d.reqs,
                d.openings,
                d.filled,
                d.activePipeline,
                `${Math.round(d.fillRate)}%`,
              ]),
            }}
          >
            <StackedColumns
              data={departments.map((d) => ({
                label: d.department.split(" ")[0]!,
                seats: d.openings,
                pipeline: d.activePipeline,
              }))}
              height={260}
              series={[
                { key: "seats", label: "Seats", color: SERIES[0] },
                { key: "pipeline", label: "Active pipeline", color: SERIES[2] },
              ]}
            />
          </ChartFrame>

          <Card padded={false}>
            <div className="p-5 pb-4">
              <CardHeader
                title="Client accounts"
                description="Where the demand sits and how well we are serving it."
              />
            </div>
            <TableShell className="rounded-none border-0 border-t border-border-base shadow-none">
              <Table>
                <thead>
                  <tr>
                    <Th>Client</Th>
                    <Th align="right">Open</Th>
                    <Th align="right">Pipeline</Th>
                    <Th align="right">Filled</Th>
                    <Th align="right">Fill rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {clients.slice(0, 12).map((c) => (
                    <Tr key={c.id} interactive>
                      <Td>
                        <Link
                          href={`/clients/${c.id}`}
                          className="text-[13px] font-medium text-content hover:text-brand"
                        >
                          {c.name}
                        </Link>
                        <p className="text-[11px] text-content-subtle">{c.industry}</p>
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {c.openReqs}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {c.activePipeline}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {c.filled}/{c.openings}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {Math.round(c.fillRate)}%
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          </Card>
        </div>

        <p className="text-[12px] text-content-subtle">
          Funnel figures count distinct submissions that reached each stage, so a candidate who
          moves backwards and forwards is only counted once per stage.{" "}
          {pluralize(submitted, "submission")} reached the hiring manager in this window, across{" "}
          {pluralize(aging.byStage.reduce((s, b) => s + b.count, 0), "live candidate")} currently in
          play. Stage labels:{" "}
          {(Object.keys(STAGE) as Stage[])
            .slice(0, 6)
            .map((s) => STAGE[s].label)
            .join(" → ")}
          .
        </p>
      </PageBody>
    </>
  );
}
