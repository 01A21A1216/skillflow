import "server-only";

import {
  PERIODS,
  resolvePeriod,
  clientBreakdown,
  departmentBreakdown,
  funnel,
  interviewerLoad,
  monthlyTrend,
  offerTrend,
  pipelineAging,
  recruiterPerformance,
  rejectionReasons,
  sourceEffectiveness,
  stageVelocity,
  timeToHire,
  timeToInterview,
} from "./analytics";
import { loadPipeline } from "@/server/pipeline";

/**
 * The exportable reports (§19).
 *
 * Each is defined once — heading, columns and rows together — and both the
 * screen and the CSV read the same definition. That is the whole point: an
 * export built from a second query drifts from the chart above it, and nobody
 * notices until the numbers are already in a client's inbox.
 *
 * Rows are plain scalars rather than formatted strings, so the CSV carries
 * numbers a spreadsheet can total rather than text it has to be coaxed into
 * parsing.
 */
export type Cell = string | number | null;

export interface ReportDef {
  key: string;
  label: string;
  description: string;
  columns: string[];
  load: (since?: Date) => Promise<Cell[][]>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export const REPORTS: ReportDef[] = [
  {
    key: "funnel",
    label: "Pipeline funnel",
    description: "Distinct submissions that reached each stage, with step and overall conversion.",
    columns: ["Stage", "Reached", "From previous %", "From first stage %", "Dropped off"],
    load: async (since) =>
      (await funnel(since)).map((f) => [
        f.label,
        f.count,
        f.stepConversion === null ? null : round1(f.stepConversion),
        round1(f.overallConversion),
        f.dropOff,
      ]),
  },
  {
    key: "stage-velocity",
    label: "Stage velocity",
    description: "How long candidates actually spend in each stage.",
    columns: ["Stage", "Average days", "Median days", "Samples"],
    load: async (since) =>
      (await stageVelocity(since)).map((v) => [
        v.label,
        round1(v.avgDays),
        round1(v.medianDays),
        v.samples,
      ]),
  },
  {
    key: "time-to-hire",
    label: "Time to fill, hire and interview",
    description: "The three cycle-time numbers a client asks about, with sample sizes.",
    columns: ["Measure", "Average days", "Median days", "Samples"],
    load: async (since) => {
      const t = await timeToHire(since);
      const ti = await timeToInterview(since);
      return [
        ["Time to fill (requirement opened → hire)", round1(t.avgTimeToFill), round1(t.medianTimeToFill), t.timeToFillDays.length],
        ["Time to hire (submission → hire)", round1(t.avgTimeToHire), round1(t.medianTimeToHire), t.timeToHireDays.length],
        ["Time to interview (submission → first round booked)", round1(ti.avg), round1(ti.median), ti.samples],
      ];
    },
  },
  {
    key: "monthly-trend",
    label: "Monthly throughput",
    description: "Added, submitted, interviewed, offered and hired, by month.",
    columns: ["Month", "Added", "Submitted", "Interviewed", "Offers", "Hires"],
    load: async () =>
      (await monthlyTrend(12)).map((m) => [
        m.label,
        m.added,
        m.submitted,
        m.interviewed,
        m.offers,
        m.hires,
      ]),
  },
  {
    key: "source-effectiveness",
    label: "Source effectiveness",
    description: "Which sources convert, and how quickly they reach a hire.",
    columns: ["Source", "Candidates", "Submitted", "Interviewed", "Hires", "Submit rate %", "Hire rate %", "Avg days to hire"],
    load: async (since) =>
      (await sourceEffectiveness(since)).map((s) => [
        s.source,
        s.candidates,
        s.submitted,
        s.interviewed,
        s.hires,
        round1(s.submitRate),
        round1(s.hireRate),
        round1(s.avgDaysToHire),
      ]),
  },
  {
    key: "recruiter-performance",
    label: "Recruiter performance",
    description: "Per-desk volumes and conversion.",
    columns: [
      "Recruiter",
      "Title",
      "Open requirements",
      "Active pipeline",
      "Submitted",
      "Interviewed",
      "Offers",
      "Hires",
      "Submit → interview %",
      "Interview → offer %",
      "Offer acceptance %",
      "Avg days to hire",
      "Load %",
    ],
    load: async (since) =>
      (await recruiterPerformance(since)).map((r) => [
        r.name,
        r.title,
        r.openReqs,
        r.activePipeline,
        r.submitted,
        r.interviewed,
        r.offers,
        r.hires,
        round1(r.submitToInterview),
        round1(r.interviewToOffer),
        round1(r.offerAcceptance),
        round1(r.avgTimeToHire),
        round1(r.load),
      ]),
  },
  {
    key: "client-breakdown",
    label: "Client accounts",
    description: "Volume and outcomes per client.",
    columns: [
      "Client",
      "Industry",
      "Tier",
      "SLA days",
      "Requirements",
      "Open",
      "Seats",
      "Filled",
      "Fill rate %",
      "Active pipeline",
    ],
    load: async () =>
      (await clientBreakdown()).map((c) => [
        c.name,
        c.industry,
        c.tier,
        c.slaDays,
        Number(c.reqs),
        c.openReqs,
        c.openings,
        c.filled,
        round1(c.fillRate),
        c.activePipeline,
      ]),
  },
  {
    key: "practice-breakdown",
    label: "Practice areas",
    description: "Requirements and outcomes by practice.",
    columns: ["Practice", "Requirements", "Seats", "Filled", "Fill rate %", "Active pipeline"],
    load: async () =>
      (await departmentBreakdown()).map((d) => [
        d.department,
        d.reqs,
        d.openings,
        d.filled,
        round1(d.fillRate),
        d.activePipeline,
      ]),
  },
  {
    key: "rejection-reasons",
    label: "Close-out reasons",
    description: "Why candidates leave the pipeline, ranked.",
    columns: ["Reason", "Count", "Share %"],
    load: async (since) => {
      const rows = await rejectionReasons(since);
      const total = rows.reduce((n, r) => n + r.count, 0);
      return rows.map((r) => [r.reason, r.count, total ? round1((r.count / total) * 100) : 0]);
    },
  },
  {
    key: "interviewer-load",
    label: "Interviewer load",
    description: "Who is carrying the interviewing, and whose scorecards are outstanding.",
    columns: ["Interviewer", "Title", "Practice", "Interviews", "Hours", "Scorecards owed"],
    load: async (since) =>
      (await interviewerLoad(since)).map((i) => [
        i.name,
        i.title,
        i.department,
        i.interviews,
        round1(i.hours),
        i.owed,
      ]),
  },
  {
    key: "pipeline-aging",
    label: "Pipeline aging",
    description: "Live candidates by stage, and how many are past the stage target.",
    columns: ["Stage", "Live candidates", "Average days in stage"],
    load: async () => {
      const aging = await pipelineAging();
      const pipeline = await loadPipeline();
      return aging.byStage.map((b) => [pipeline.label(b.stage), b.count, round1(b.avgDays)]);
    },
  },
  {
    key: "offers",
    label: "Offer outcomes",
    description: "Offers extended, accepted and declined, by month.",
    columns: ["Month", "Accepted", "Declined", "Acceptance %"],
    load: async () =>
      (await offerTrend(12)).map((o) => [o.label, o.accepted, o.declined, round1(o.rate)]),
  },
];

export function findReport(key: string) {
  return REPORTS.find((r) => r.key === key);
}

/**
 * RFC 4180 CSV.
 *
 * Quoting every field that could possibly need it rather than guessing: a
 * comma inside a client name, a newline inside a close-out reason, or a quote
 * inside a job title would each silently corrupt the file.
 *
 * The leading apostrophe guard is deliberate. A cell beginning `=`, `+`, `-`
 * or `@` is executed as a formula when the file is opened in Excel, so an
 * attacker who can set a candidate's name can run something on the machine of
 * whoever exports the report. Prefixing breaks that without changing what the
 * reader sees.
 */
export function toCsv(columns: string[], rows: Cell[][]) {
  const cell = (value: Cell) => {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  return [columns.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

/** The period a report was run for, resolved exactly the way the screen does. */
export function reportPeriod(key: string | undefined) {
  return resolvePeriod(key);
}

export { PERIODS };
