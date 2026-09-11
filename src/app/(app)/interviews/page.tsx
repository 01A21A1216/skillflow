import type { Metadata } from "next";
import { CalendarX2, Clock, Users } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { FilterBar } from "@/components/domain/filter-bar";
import { InterviewDayGroups } from "@/components/domain/interview-list";
import { KpiTile } from "@/components/domain/kpi-tile";
import { LinkTabs } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/empty-state";
import { INTERVIEW_STATUSES, INTERVIEW_TYPES } from "@/lib/domain";
import { isoDate, pluralize } from "@/lib/utils";
import {
  awaitingFeedback,
  groupByDay,
  interviewerOptions,
  listInterviews,
  type InterviewFilters,
} from "@/server/queries/interviews";
import { listRequisitions } from "@/server/queries/requisitions";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Interviews" };

const WINDOWS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
  { value: "awaiting_feedback", label: "Awaiting feedback" },
  { value: "past", label: "Past" },
  { value: "all", label: "Everything" },
];

export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const window = get("window") ?? "upcoming";
  const filters: InterviewFilters = {
    window,
    type: get("type"),
    status: get("status"),
    interviewer: get("interviewer"),
    requisition: get("requisition"),
  };

  const actor = await requirePermission("interview.view.own");
  const rows = listInterviews(filters, actor);
  const groups = groupByDay(rows);
  const focusId = get("focus");

  const upcoming = listInterviews({ window: "upcoming" }, actor);
  const thisWeek = listInterviews({ window: "week" }, actor);
  const debt = awaitingFeedback(undefined, actor);
  const openReqs = listRequisitions({ status: "active" }, actor);

  const hoursThisWeek =
    Math.round((thisWeek.reduce((s, i) => s + i.durationMinutes, 0) / 60) * 10) / 10;
  const panelSeats = thisWeek.reduce((s, i) => s + i.panelSize, 0);

  return (
    <>
      <PageHeader
        title="Interviews"
        description="The schedule, the panels, and whose feedback the process is still waiting on."
        tabs={
          <LinkTabs
            param="window"
            tabs={WINDOWS.map((w) => ({
              ...w,
              count:
                w.value === "awaiting_feedback"
                  ? debt.length
                  : w.value === "upcoming"
                    ? upcoming.length
                    : w.value === "week"
                      ? thisWeek.length
                      : undefined,
            }))}
          />
        }
      />

      <PageBody>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Scheduled ahead"
            value={String(upcoming.length)}
            hint={`${thisWeek.length} of them in the next seven days`}
            tone="violet"
          />
          <KpiTile
            label="Panel hours this week"
            value={`${hoursThisWeek}h`}
            hint={`${panelSeats} interviewer seats to fill`}
            tone="blue"
          />
          <KpiTile
            label="Awaiting feedback"
            value={String(debt.length)}
            hint="Completed rounds missing at least one scorecard"
            tone={debt.length > 12 ? "rose" : "amber"}
            href="/interviews?window=awaiting_feedback"
          />
          <KpiTile
            label="Interviewers available"
            value={String(interviewerOptions().length)}
            hint="People who can be added to a panel"
            tone="indigo"
            href="/team"
          />
        </section>

        <FilterBar
          searchKey={null}
          filters={[
            {
              name: "type",
              label: "Type",
              options: INTERVIEW_TYPES.map((t) => ({ value: t.value, label: t.label })),
            },
            {
              name: "status",
              label: "Status",
              options: INTERVIEW_STATUSES.map((t) => ({ value: t.value, label: t.label })),
            },
            {
              name: "interviewer",
              label: "Interviewer",
              width: "w-auto min-w-[11rem]",
              options: interviewerOptions().map((i) => ({ value: i.id, label: i.name })),
            },
            {
              name: "requisition",
              label: "Requisition",
              width: "w-auto min-w-[13rem]",
              options: openReqs.map((r) => ({ value: r.id, label: `${r.code} — ${r.title}` })),
            },
          ]}
        />

        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={window === "awaiting_feedback" ? <Clock className="size-5" /> : <CalendarX2 className="size-5" />}
              title={
                window === "awaiting_feedback"
                  ? "Every completed interview has full feedback"
                  : "Nothing scheduled in this window"
              }
              description={
                window === "awaiting_feedback"
                  ? "Nobody on a panel currently owes a scorecard."
                  : "Schedule a loop from the pipeline board or a candidate profile."
              }
            />
          </div>
        ) : (
          <>
            <p className="flex items-center gap-2 text-[12.5px] text-content-subtle">
              <Users className="size-3.5" />
              {pluralize(rows.length, "interview")} across{" "}
              {pluralize(new Set(rows.map((r) => r.requisitionId)).size, "requisition")}
            </p>
            <InterviewDayGroups groups={groups} focusId={focusId} today={isoDate(new Date())} />
          </>
        )}
      </PageBody>
    </>
  );
}
