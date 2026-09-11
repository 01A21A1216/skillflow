import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  ListChecks,
  Sparkles,
  Video,
} from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { ChartFrame } from "@/components/charts/primitives";
import { SERIES } from "@/components/charts/palette";
import { FunnelBars, SmallMultiples } from "@/components/charts/charts";
import { ActivityFeed } from "@/components/domain/activity-feed";
import { HealthBadge, InterviewModeBadge, PriorityBadge } from "@/components/domain/badges";
import { KpiTile } from "@/components/domain/kpi-tile";
import { AvatarStack } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentBar } from "@/components/ui/misc";
import { toneVars } from "@/components/ui/tone";
import { STAGE } from "@/lib/domain";
import { cn, formatDate, formatNumber, formatTime, pluralize } from "@/lib/utils";
import {
  actionQueue,
  attentionList,
  dashboardSnapshot,
  recentActivity,
} from "@/server/queries/dashboard";
import { requireUser } from "@/server/session";
import { can } from "@/server/authz";

export const dynamic = "force-dynamic";

const ACTION_TONE = {
  rose: "rose",
  amber: "amber",
  blue: "blue",
  violet: "violet",
} as const;

export default async function DashboardPage() {
  const actor = await requireUser();
  const snapshot = dashboardSnapshot(actor);
  const actions = actionQueue(10, actor);
  const attention = attentionList(5, actor);
  const activity = recentActivity(12, undefined, actor);

  const now = new Date();
  const greeting =
    now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";

  const todayInterviews = snapshot.upcoming.filter(
    (i) => i.scheduledAt.toDateString() === now.toDateString(),
  );

  // Which panels this actor may see decides the grid shape — otherwise a
  // restricted role gets one card stranded in a three-column layout.
  const showReporting = snapshot.reporting;
  const showPipelinePanels = can(actor, "requisition.view.assigned");
  const sideCards = (showReporting ? 1 : 0) + (showPipelinePanels ? 1 : 0);

  const trendSeries = [
    { key: "added", label: "Added to pipeline", color: SERIES[0] },
    { key: "submitted", label: "Submitted", color: SERIES[1] },
    { key: "interviewed", label: "Interviewed", color: SERIES[2] },
    { key: "hires", label: "Hired", color: SERIES[6] },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting}, ${actor.name.split(" ")[0]}`}
        description={
          <>
            {pluralize(snapshot.openReqs.length, "open requisition")} ·{" "}
            {pluralize(snapshot.cards.length, "candidate")} in play ·{" "}
            {todayInterviews.length
              ? `${pluralize(todayInterviews.length, "interview")} today`
              : "no interviews today"}
            .
          </>
        }
        actions={
          <>
            {can(actor, "requisition.view.assigned") ? (
              <LinkButton href="/pipeline" size="sm">
                Open pipeline
              </LinkButton>
            ) : null}
            {can(actor, "requisition.create") ? (
              <LinkButton href="/requisitions?new=1" variant="primary" size="sm">
                New requisition
              </LinkButton>
            ) : null}
          </>
        }
      />

      <PageBody>
        {/* ---------- KPI row ---------- */}
        <section aria-label="Key metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {snapshot.kpis.map((k) => (
            <KpiTile
              key={k.key}
              label={k.label}
              value={k.value}
              hint={k.hint}
              tone={k.tone}
              delta={k.delta}
              deltaLabel={k.deltaLabel}
              goodWhenUp={k.key !== "ttf" && k.key !== "attention"}
              href={k.href}
            />
          ))}
        </section>

        <div className={cn("grid gap-5", sideCards > 0 && "xl:grid-cols-3")}>
          {/* ---------- Action queue ---------- */}
          <Card
            className={cn("flex flex-col", sideCards > 1 && "xl:row-span-2")}
            padded={false}
          >
            <div className="p-5 pb-3">
              <CardHeader
                icon={<ListChecks className="size-4" />}
                title="Needs you today"
                description="Ranked by urgency across feedback, offers, aging candidates and stalled requisitions."
              />
            </div>

            {actions.length ? (
              <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                {actions.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={a.href}
                      className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <span
                        style={toneVars(ACTION_TONE[a.tone])}
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-[hsl(var(--tone))]"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-content">
                            {a.title}
                          </span>
                          {a.meta ? (
                            <span className="shrink-0 text-[11px] whitespace-nowrap text-content-subtle tabular-nums">
                              {a.meta}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-content-muted">
                          {a.detail}
                        </span>
                      </span>
                      <ArrowRight className="mt-1 size-3.5 shrink-0 text-content-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<CheckCircle2 className="size-5" />}
                title="Nothing is waiting on you"
                description="No overdue feedback, expiring offers or stalled requisitions right now."
              />
            )}
          </Card>

          {/* ---------- Funnel ---------- */}
          {snapshot.reporting ? (
          <ChartFrame
            title="Conversion funnel"
            description="Submissions that reached each stage in the last 180 days."
            table={{
              columns: ["Stage", "Reached", "From previous", "From sourced"],
              rows: snapshot.funnel.map((f) => [
                f.label,
                formatNumber(f.count),
                `${Math.round(f.stepConversion)}%`,
                `${Math.round(f.overallConversion)}%`,
              ]),
            }}
          >
            <FunnelBars steps={snapshot.funnel} />
          </ChartFrame>
          ) : null}

          {/* ---------- Live pipeline composition ---------- */}
          {can(actor, "requisition.view.assigned") ? (
          <Card className="flex flex-col">
            <CardHeader
              title="Live pipeline"
              description={`${formatNumber(snapshot.cards.length)} active candidates across every open requisition.`}
            />
            <SegmentBar
              className="mt-4"
              height={10}
              segments={snapshot.stageTotals.map((s) => ({
                label: STAGE[s.stage].label,
                value: s.count,
                tone: STAGE[s.stage].tone,
              }))}
            />
            <ul className="mt-4 space-y-2.5">
              {snapshot.stageTotals.map((s) => (
                <li key={s.stage}>
                  <Link
                    href={`/pipeline?stage=${s.stage}`}
                    className="group flex items-center gap-3 text-[13px]"
                  >
                    <span
                      style={toneVars(STAGE[s.stage].tone)}
                      className="size-2 shrink-0 rounded-full bg-[hsl(var(--tone))]"
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-content-muted group-hover:text-content">
                      {STAGE[s.stage].label}
                    </span>
                    {s.aging > 0 ? (
                      <span
                        className="text-[11px] text-[hsl(var(--tone-amber))] tabular-nums"
                        title={`${s.aging} past the ${s.sla}-day stage target`}
                      >
                        {s.aging} aging
                      </span>
                    ) : null}
                    <span className="w-8 shrink-0 text-right font-semibold text-content tabular-nums">
                      {s.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          ) : null}
        </div>

        <div className={cn("grid gap-5", showReporting && "xl:grid-cols-3")}>
          {/* ---------- Trend ---------- */}
          {snapshot.reporting ? (
          <ChartFrame
            className="xl:col-span-2"
            title="Hiring throughput"
            description="Stage entries per month. Each panel keeps its own scale — hires and top-of-funnel additions differ by an order of magnitude, so one shared axis would flatten the series that matters most."
            height={260}
            table={{
              columns: ["Month", "Added", "Submitted", "Interviewed", "Hired"],
              rows: snapshot.trend.map((t) => [t.label, t.added, t.submitted, t.interviewed, t.hires]),
            }}
          >
            <SmallMultiples data={snapshot.trend} series={trendSeries} />
          </ChartFrame>
          ) : null}

          {/* ---------- Upcoming interviews ---------- */}
          <Card className="flex flex-col" padded={false}>
            <div className="p-5 pb-3">
              <CardHeader
                icon={<CalendarClock className="size-4" />}
                title="Next up"
                description="Interviews scheduled over the coming days."
                action={
                  <Link
                    href="/interviews"
                    className="text-[12px] font-medium text-brand hover:underline"
                  >
                    All
                  </Link>
                }
              />
            </div>

            {snapshot.upcoming.length ? (
              <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                {snapshot.upcoming.slice(0, 6).map((iv) => (
                  <li key={iv.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/candidates/${iv.candidateId}`}
                          className="block truncate text-[13px] font-medium text-content hover:text-brand"
                        >
                          {iv.candidateName}
                        </Link>
                        <p className="mt-0.5 truncate text-[12px] text-content-muted">
                          {iv.title} · {iv.requisitionTitle}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[12px] font-medium text-content tabular-nums">
                          {formatTime(iv.scheduledAt)}
                        </p>
                        <p className="text-[11px] text-content-subtle">
                          {formatDate(iv.scheduledAt, false)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <InterviewModeBadge value={iv.mode} />
                      <AvatarStack names={iv.panel.map((p) => p.name)} max={3} size="xs" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Video className="size-5" />}
                title="No interviews scheduled"
                description="Schedule a loop from any candidate in the pipeline."
              />
            )}
          </Card>
        </div>

        <div className={cn("grid gap-5", showPipelinePanels && "xl:grid-cols-3")}>
          {/* ---------- Requisitions needing attention ---------- */}
          {showPipelinePanels ? (
          <Card className="xl:col-span-2" padded={false}>
            <div className="p-5 pb-4">
              <CardHeader
                icon={<Sparkles className="size-4" />}
                title="Requisitions to look at"
                description="Open roles that are stalled, thin on pipeline, or past their target fill date."
                action={
                  <Link
                    href="/requisitions?status=active"
                    className="text-[12px] font-medium text-brand hover:underline"
                  >
                    View all
                  </Link>
                }
              />
            </div>

            {attention.length ? (
              <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                {attention.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/requisitions/${r.id}`}
                      className="block px-5 py-3.5 transition-colors hover:bg-surface-muted"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-content-subtle">
                              {r.code}
                            </span>
                            <PriorityBadge value={r.priority} dot />
                          </div>
                          <p className="mt-1 truncate text-[13.5px] font-medium text-content">
                            {r.title}
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-content-muted">
                            {r.clientName} · {r.location} · open {r.ageDays} days
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <HealthBadge health={r.health} />
                          <span className="text-[11.5px] text-content-subtle tabular-nums">
                            {r.activeCount} active · {r.interviewCount} interviewing
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-[12px] text-content-muted">{r.health.reason}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={<CheckCircle2 className="size-5" />}
                title="Every open requisition is on track"
              />
            )}
          </Card>
          ) : null}

          {/* ---------- Activity ---------- */}
          <Card>
            <CardHeader
              icon={<Clock className="size-4" />}
              title="Recent activity"
              description="The last things that happened across the team."
            />
            <div className="mt-4">
              <ActivityFeed items={activity} compact />
            </div>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
