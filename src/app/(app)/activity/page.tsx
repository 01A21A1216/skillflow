import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { FilterBar } from "@/components/domain/filter-bar";
import { ActivityTypeBadge } from "@/components/domain/badges";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { ACTIVITY_TYPES } from "@/lib/domain";
import { formatDateTime, pluralize } from "@/lib/utils";
import { AUDIT_PAGE_SIZE, auditFacets, listAudit, type AuditFilters } from "@/server/queries/audit";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Activity" };

const ENTITY_LABELS: Record<string, string> = {
  requisition: "Requirement",
  candidate: "Candidate",
  submission: "Submission",
  settings: "Settings",
};

function labelFor(type: string) {
  return ACTIVITY_TYPES[type as keyof typeof ACTIVITY_TYPES]?.label ?? type.replace(/_/g, " ");
}

/**
 * The audit trail (§13).
 *
 * Detail pages already narrate their own history; what was missing was the
 * organisation-wide view you reach for when the question starts "who changed".
 * So this one leads with the structured diff — field, before, after — rather
 * than only the sentence, and can be narrowed to entries that actually changed
 * something.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const actor = await requirePermission("audit.view");

  const filters: AuditFilters = {
    q: get("q"),
    actor: get("actor"),
    type: get("type"),
    entityType: get("entityType"),
    from: get("from"),
    to: get("to"),
    changesOnly: get("changesOnly") === "yes",
    page: Number(get("page") ?? 1) || 1,
  };

  const { entries, total, page, pageCount } = await listAudit(filters, actor);
  const facets = await auditFacets();

  const qs = (next: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const value = Array.isArray(v) ? v[0] : v;
      if (value && k !== "page") sp.set(k, value);
    }
    sp.set("page", String(next));
    return `/activity?${sp.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every recorded change, across every record you can see. Entries that altered a field carry what it was before."
        meta={
          <p className="text-[12.5px] text-content-subtle tabular-nums">
            {pluralize(total, "entry", "entries")} matching
          </p>
        }
      />

      <PageBody>
        <FilterBar
          searchPlaceholder="Search summaries and changed values…"
          filters={[
            {
              name: "actor",
              label: "Who",
              allLabel: "Anyone",
              width: "w-auto min-w-[11rem]",
              options: facets.actors.map((a) => ({ value: a.id, label: a.name })),
            },
            {
              name: "type",
              label: "Action",
              allLabel: "Any action",
              width: "w-auto min-w-[12rem]",
              options: facets.types.map((t) => ({ value: t, label: labelFor(t) })),
            },
            {
              name: "entityType",
              label: "Record",
              allLabel: "Any record",
              options: facets.entityTypes.map((t) => ({
                value: t,
                label: ENTITY_LABELS[t] ?? t,
              })),
            },
            {
              name: "changesOnly",
              label: "Detail",
              allLabel: "Everything",
              options: [{ value: "yes", label: "Field changes only" }],
            },
          ]}
        />

        {/* Dates are their own control: a pair of bounds does not fit the
            single-select shape the filter bar is built around. */}
        <form className="flex flex-wrap items-end gap-3" action="/activity">
          {(["q", "actor", "type", "entityType", "changesOnly"] as const).map((k) => {
            const value = get(k);
            return value ? <input key={k} type="hidden" name={k} value={value} /> : null;
          })}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-content-subtle uppercase">From</span>
            <input
              type="date"
              name="from"
              defaultValue={get("from") ?? ""}
              className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-content"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-content-subtle uppercase">To</span>
            <input
              type="date"
              name="to"
              defaultValue={get("to") ?? ""}
              className="h-9 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] text-content"
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-[13px] font-medium text-content hover:bg-surface-muted"
          >
            Apply dates
          </button>
        </form>

        {entries.length === 0 ? (
          <EmptyState
            icon={<History className="size-5" />}
            title="Nothing matches those filters"
            description="Widen the date range, or clear a filter."
          />
        ) : (
          <>
            <ol className="card divide-y divide-[hsl(var(--border))] p-0">
              {entries.map((e) => (
                <li key={e.id} className="flex gap-3 px-5 py-3.5">
                  <Avatar name={e.actorName} size="sm" className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[13px] font-medium text-content">{e.actorName}</span>
                      <ActivityTypeBadge value={e.type} size="sm" />
                      <span className="ml-auto text-[11.5px] text-content-subtle tabular-nums">
                        {formatDateTime(e.createdAt)}
                      </span>
                    </div>

                    <p className="mt-1 text-[13px] leading-relaxed text-content-muted">
                      {e.summary}
                    </p>

                    {e.href ? (
                      <Link
                        href={e.href}
                        className="mt-1 inline-block text-[11.5px] text-content-subtle hover:text-brand"
                      >
                        {e.subject}
                      </Link>
                    ) : e.subject ? (
                      <span className="mt-1 block text-[11.5px] text-content-subtle">
                        {e.subject}
                      </span>
                    ) : null}

                    {e.changes?.length ? (
                      <ul className="mt-2 space-y-1 border-l-2 border-border-base pl-3">
                        {e.changes.map((c, i) => (
                          <li key={`${c.field}-${i}`} className="text-[12px] text-content-muted">
                            <span className="font-medium text-content">{c.label}</span>{" "}
                            <span className="text-content-subtle line-through">
                              {c.from === null || c.from === "" ? "empty" : String(c.from)}
                            </span>{" "}
                            <span aria-hidden>→</span>{" "}
                            <span className="text-content">
                              {c.to === null || c.to === "" ? "empty" : String(c.to)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            {pageCount > 1 ? (
              <nav className="flex items-center justify-between gap-3" aria-label="Activity pages">
                <p className="text-[12.5px] text-content-subtle tabular-nums">
                  Showing {(page - 1) * AUDIT_PAGE_SIZE + 1}–
                  {Math.min(page * AUDIT_PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  {page > 1 ? (
                    <Link
                      href={qs(page - 1)}
                      className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-[13px] hover:bg-surface-muted"
                    >
                      Previous
                    </Link>
                  ) : null}
                  <span className="text-[12.5px] text-content-muted tabular-nums">
                    Page {page} of {pageCount}
                  </span>
                  {page < pageCount ? (
                    <Link
                      href={qs(page + 1)}
                      className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-[13px] hover:bg-surface-muted"
                    >
                      Next
                    </Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </>
        )}
      </PageBody>
    </>
  );
}
