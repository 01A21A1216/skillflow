import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, MapPin } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { FilterBar, SortSelect } from "@/components/domain/filter-bar";
import { NewRequisitionButton } from "@/components/domain/forms/requisition-form";
import { scorecardOptions } from "@/server/queries/scorecards";
import {
  EmploymentBadge,
  HealthBadge,
  PriorityBadge,
  ReqStatusBadge,
  SkillChips,
  WorkModeBadge,
} from "@/components/domain/badges";
import { UserChip } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentBar } from "@/components/ui/misc";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import {
  EMPLOYMENT_TYPES,
  PRIORITIES,
  PROGRESS_BUCKETS,
  REQ_STATUSES,
  WORK_MODES,
  bucketStages,
} from "@/lib/domain";
import { cn, formatDate, formatRange, pluralize } from "@/lib/utils";
import {
  listRequisitions,
  requisitionFacets,
  requisitionHealth,
  stageBreakdownForRequisitions,
  type RequisitionFilters,
} from "@/server/queries/requisitions";
import { hiringManagerOptions } from "@/server/queries/people";
import { can } from "@/server/authz";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Requisitions" };

const SORTS = [
  { value: "priority", label: "Priority" },
  { value: "pipeline", label: "Most pipeline" },
  { value: "target", label: "Closest to target" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
];

const HEALTH_OPTIONS = [
  { value: "healthy", label: "On track" },
  { value: "watch", label: "Needs attention" },
  { value: "at_risk", label: "At risk" },
  { value: "stalled", label: "Stalled" },
];

export default async function RequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const filters: RequisitionFilters = {
    q: get("q"),
    status: get("status") ?? "active",
    priority: get("priority"),
    department: get("department"),
    client: get("client"),
    recruiter: get("recruiter"),
    workMode: get("workMode"),
    employmentType: get("employmentType"),
    health: get("health"),
    sort: get("sort") ?? "priority",
  };

  const actor = await requirePermission("requisition.view.assigned");
  const rows = await listRequisitions(filters, actor);
  const facets = await requisitionFacets();
  const breakdown = await stageBreakdownForRequisitions(rows.map((r) => r.id));

  const allForCounts = await listRequisitions({ status: "all" }, actor);
  const summary = {
    open: allForCounts.filter((r) => r.status === "open").length,
    onHold: allForCounts.filter((r) => r.status === "on_hold").length,
    filled: allForCounts.filter((r) => r.status === "filled").length,
    seats: allForCounts
      .filter((r) => ["open", "on_hold", "draft"].includes(r.status))
      .reduce((s, r) => s + (r.openings - r.filled), 0),
  };

  return (
    <>
      <PageHeader
        title="Requisitions"
        description={`${summary.open} open · ${summary.onHold} on hold · ${summary.filled} filled this year · ${pluralize(summary.seats, "seat")} still to fill.`}
        actions={
          !can(actor, "requisition.create") ? null : (
          <NewRequisitionButton
            defaultOpen={get("new") === "1"}
            options={{
              clients: facets.clients,
              recruiters: facets.recruiters,
              hiringManagers: await hiringManagerOptions(),
                scorecards: await scorecardOptions(),
              departments: facets.departments,
            }}
          />
          )
        }
      />

      <PageBody>
        <FilterBar
          searchPlaceholder="Search title, code, client, location…"
          filters={[
            {
              name: "status",
              label: "Status",
              allLabel: "Any status",
              options: [
                { value: "active", label: "Active (open, hold, draft)" },
                ...REQ_STATUSES.map((s) => ({ value: s.value, label: s.label })),
              ],
            },
            { name: "health", label: "Health", allLabel: "Any health", options: HEALTH_OPTIONS },
            {
              name: "priority",
              label: "Priority",
              options: PRIORITIES.map((p) => ({ value: p.value, label: p.label })),
            },
            {
              name: "department",
              label: "Department",
              options: facets.departments.map((d) => ({ value: d, label: d })),
            },
            {
              name: "client",
              label: "Client",
              options: facets.clients.map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: "recruiter",
              label: "Recruiter",
              options: facets.recruiters.map((r) => ({ value: r.id, label: r.name })),
            },
            {
              name: "workMode",
              label: "Work mode",
              options: WORK_MODES.map((w) => ({ value: w.value, label: w.label })),
            },
            {
              name: "employmentType",
              label: "Type",
              options: EMPLOYMENT_TYPES.map((e) => ({ value: e.value, label: e.label })),
            },
          ]}
          right={<SortSelect options={SORTS} defaultValue="priority" />}
        />

        <p className="text-[12.5px] text-content-subtle">
          {pluralize(rows.length, "requisition")} matching
        </p>

        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Briefcase className="size-5" />}
              title="No requisitions match these filters"
              description="Try widening the status filter or clearing the search term."
            />
          </div>
        ) : (
          <TableShell>
            <Table>
              <thead>
                <tr>
                  <Th className="min-w-[22rem]">Requisition</Th>
                  <Th>Health</Th>
                  <Th className="min-w-[11rem]">Pipeline</Th>
                  <Th align="center">Openings</Th>
                  <Th>Team</Th>
                  <Th>Compensation</Th>
                  <Th align="right">Target</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const health = requisitionHealth(r);
                  const stages = breakdown.get(r.id);
                  const overdue = r.daysToTarget !== null && r.daysToTarget < 0;

                  return (
                    <Tr key={r.id} interactive>
                      <Td>
                        <Link href={`/requisitions/${r.id}`} className="group block">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-[11px] text-content-subtle">
                              {r.code}
                            </span>
                            <ReqStatusBadge value={r.displayStatus} />
                            <PriorityBadge value={r.priority} dot />
                          </div>
                          <p className="mt-1 text-[13.5px] font-medium text-content group-hover:text-brand">
                            {r.title}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-content-muted">
                            <span className="truncate">{r.clientName}</span>
                            <span aria-hidden>·</span>
                            <MapPin className="size-3 shrink-0" />
                            <span className="truncate">{r.location}</span>
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <WorkModeBadge value={r.workMode} />
                            <EmploymentBadge value={r.employmentType} />
                            <SkillChips skills={r.requiredSkills} max={3} />
                          </div>
                        </Link>
                      </Td>

                      <Td>
                        <div className="max-w-[13rem]">
                          <HealthBadge health={health} />
                          <p className="mt-1 text-[11.5px] leading-snug text-content-subtle">
                            Open {r.ageDays}d
                          </p>
                        </div>
                      </Td>

                      <Td>
                        <div className="min-w-[9rem]">
                          <div className="mb-1.5 flex items-baseline gap-1.5">
                            <span className="text-[15px] font-semibold text-content tabular-nums">
                              {r.activeCount}
                            </span>
                            <span className="text-[11.5px] text-content-subtle">active</span>
                          </div>
                          <SegmentBar
                            height={6}
                            segments={PROGRESS_BUCKETS.map((b) => ({
                              label: b.label,
                              value: bucketStages(stages)[b.key],
                              tone: b.tone,
                            }))}
                          />
                          <p className="mt-1.5 text-[11.5px] text-content-subtle tabular-nums">
                            {r.interviewCount} interviewing · {r.offerCount} at offer
                          </p>
                        </div>
                      </Td>

                      <Td align="center">
                        <span className="text-[13px] font-medium text-content tabular-nums">
                          {r.filled}/{r.openings}
                        </span>
                      </Td>

                      <Td>
                        <div className="space-y-1.5">
                          <UserChip name={r.recruiterName} meta="Recruiter" />
                          <UserChip name={r.hiringManagerName} meta="Hiring manager" />
                        </div>
                      </Td>

                      <Td>
                        <span className="text-[13px] whitespace-nowrap text-content tabular-nums">
                          {formatRange(r.minSalary, r.maxSalary, r.currency)}
                        </span>
                      </Td>

                      <Td align="right">
                        <span
                          className={cn(
                            "text-[12.5px] whitespace-nowrap tabular-nums",
                            overdue ? "font-medium text-[hsl(var(--tone-rose))]" : "text-content-muted",
                          )}
                        >
                          {formatDate(r.targetFillDate, false)}
                        </span>
                        {r.daysToTarget !== null ? (
                          <p className="mt-0.5 text-[11px] text-content-subtle tabular-nums">
                            {overdue
                              ? `${Math.abs(r.daysToTarget)}d over`
                              : `${r.daysToTarget}d left`}
                          </p>
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableShell>
        )}
      </PageBody>
    </>
  );
}
