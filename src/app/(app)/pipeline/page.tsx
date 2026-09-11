import type { Metadata } from "next";
import { KanbanSquare } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { FilterBar } from "@/components/domain/filter-bar";
import { PipelineBoard } from "@/components/domain/pipeline-board";
import { PipelineOptionsProvider } from "@/components/domain/pipeline-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { PRIORITIES } from "@/lib/domain";
import { loadPipeline } from "@/server/pipeline";
import { formatNumber, pluralize } from "@/lib/utils";
import { pipelineCards, type PipelineFilters } from "@/server/queries/pipeline";
import { listRequisitions, requisitionFacets } from "@/server/queries/requisitions";
import { interviewerOptions } from "@/server/queries/interviews";
import { listUsers } from "@/server/queries/people";
import { can } from "@/server/authz";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const filters: PipelineFilters = {
    q: get("q"),
    requisition: get("requisition"),
    recruiter: get("recruiter"),
    client: get("client"),
    department: get("department"),
    priority: get("priority"),
    aging: get("aging"),
    stage: get("stage"),
    status: get("status"),
  };

  const actor = await requirePermission("requisition.view.assigned");
  const pipeline = await loadPipeline();
  const cards = await pipelineCards(filters, actor);
  const facets = await requisitionFacets();
  const openReqs = await listRequisitions({ status: "active", sort: "pipeline" }, actor);
  const people = await listUsers();

  // Which columns this view is about. A drill-down from a KPI is asking about
  // one stage or one outcome, and nine empty columns beside one full one is
  // not a useful answer to that.
  const status = filters.status ?? "active";
  const columns =
    filters.stage && filters.stage !== "all"
      ? [filters.stage]
      : status === "active"
        ? pipeline.active
        : status === "hired"
          ? pipeline.ofKind("placement")
          : status === "all"
            ? pipeline.order
            : [status];

  const live = status === "active";
  const aging = cards.filter((c) => c.isAging).length;
  const stageCounts = new Map<string, number>();
  for (const c of cards) stageCounts.set(c.stage, (stageCounts.get(c.stage) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={
          <>
            Every live candidate across every requisition. Drag a card between columns to move
            someone forward — the change is written straight to their timeline.
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
            <span className="text-content-muted">
              <span className="font-semibold text-content tabular-nums">
                {formatNumber(cards.length)}
              </span>{" "}
              in play
            </span>
            {aging > 0 ? (
              <span className="text-[hsl(var(--tone-amber))]">
                <span className="font-semibold tabular-nums">{aging}</span> past the stage target
              </span>
            ) : null}
            <span className="hidden items-center gap-3 text-content-subtle sm:flex">
              {pipeline.live
                .filter((s) => s.slaDays > 0)
                .map((s) => (
                  <span key={s.key} title={`Target time in ${s.label.toLowerCase()}`}>
                    {s.label} {s.slaDays}d
                  </span>
                ))}
            </span>
          </div>
        }
      />

      <PageBody>
        <FilterBar
          searchPlaceholder="Search candidate or requisition…"
          filters={[
            {
              name: "requisition",
              label: "Requisition",
              allLabel: "All requisitions",
              width: "w-auto min-w-[13rem]",
              options: openReqs.map((r) => ({
                value: r.id,
                label: `${r.code} — ${r.title}`,
              })),
            },
            {
              name: "client",
              label: "Client",
              options: facets.clients.map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: "department",
              label: "Department",
              options: facets.departments.map((d) => ({ value: d, label: d })),
            },
            {
              name: "recruiter",
              label: "Recruiter",
              options: facets.recruiters.map((r) => ({ value: r.id, label: r.name })),
            },
            {
              name: "priority",
              label: "Priority",
              options: PRIORITIES.map((p) => ({ value: p.value, label: p.label })),
            },
            {
              name: "aging",
              label: "Aging",
              allLabel: "All ages",
              options: [{ value: "yes", label: "Past stage target only" }],
            },
            {
              name: "stage",
              label: "Stage",
              allLabel: "Every stage",
              width: "w-auto min-w-[12rem]",
              options: pipeline.live.map((st) => ({ value: st.key, label: st.label })),
            },
            {
              name: "status",
              label: "Outcome",
              allLabel: "Live only",
              options: [
                { value: "hired", label: "Joined" },
                { value: "rejected", label: "Rejected" },
                { value: "withdrawn", label: "Withdrawn" },
                { value: "on_hold", label: "On hold" },
                { value: "all", label: "Everything" },
              ],
            },
          ]}
        />

        {cards.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<KanbanSquare className="size-5" />}
              title="No candidates match these filters"
              description="Clear a filter, or add candidates to a requisition from the candidates list."
            />
          </div>
        ) : (
          <PipelineOptionsProvider
            value={{
              interviewers: people
                .filter((p) => ["interviewer", "hiring_manager", "recruiter", "recruitment_manager", "super_admin"].includes(p.role))
                .map((p) => ({ id: p.id, name: p.name, title: p.title, department: p.department })),
              coordinators: people
                .filter((p) => ["recruiter", "recruitment_manager", "super_admin"].includes(p.role))
                .map((p) => ({ id: p.id, name: p.name, title: p.title })),
              capabilities: {
                // A closed-out candidate is not dragged between columns;
                // reopening them is a decision, not a drag.
                move: live && can(actor, "submission.move"),
                close: can(actor, "submission.close"),
                schedule: can(actor, "interview.schedule"),
                draftOffer: can(actor, "offer.create"),
              },
            }}
          >
            <PipelineBoard cards={cards} columns={columns} />
          </PipelineOptionsProvider>
        )}

        <p className="text-[12px] text-content-subtle">
          Showing {pluralize(cards.length, "candidate")} across{" "}
          {pluralize(new Set(cards.map((c) => c.requisitionId)).size, "requisition")}.{" "}
          {(await interviewerOptions()).length} people are available as interviewers.
        </p>
      </PageBody>
    </>
  );
}
