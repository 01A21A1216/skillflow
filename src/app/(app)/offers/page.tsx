import type { Metadata } from "next";
import { FileSignature } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { ChartFrame } from "@/components/charts/primitives";
import { SERIES } from "@/components/charts/palette";
import { HorizontalBars, TrendLines } from "@/components/charts/charts";
import { FilterBar, SortSelect } from "@/components/domain/filter-bar";
import { KpiTile } from "@/components/domain/kpi-tile";
import { NewOfferButton, OfferTable } from "@/components/domain/offer-table";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/misc";
import { OFFER_STATUSES } from "@/lib/domain";
import { formatMoney, pluralize } from "@/lib/utils";
import { offerTrend } from "@/server/queries/analytics";
import {
  listOffers,
  offerReadySubmissions,
  offerStats,
  type OfferFilters,
} from "@/server/queries/offers";
import { listRequisitions, requisitionFacets } from "@/server/queries/requisitions";
import { can } from "@/server/authz";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Offers" };

const TABS = [
  { value: "open", label: "In flight" },
  { value: "extended", label: "With the candidate" },
  { value: "pending_approval", label: "Awaiting approval" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "all", label: "Everything" },
];

const SORTS = [
  { value: "recent", label: "Most recent" },
  { value: "expiring", label: "Expiring soonest" },
  { value: "value", label: "Highest value" },
  { value: "candidate", label: "Candidate A–Z" },
];

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const filters: OfferFilters = {
    status: get("status") ?? "open",
    requisition: get("requisition"),
    recruiter: get("recruiter"),
    sort: get("sort") ?? "recent",
  };

  const actor = await requirePermission("offer.view");
  const rows = listOffers(filters, actor);
  const stats = offerStats(actor);
  const trend = offerTrend(12);
  const ready = can(actor, "offer.create") ? offerReadySubmissions().slice(0, 40) : [];
  const facets = requisitionFacets();
  const openReqs = listRequisitions({ status: "active" }, actor);

  const all = listOffers({}, actor);
  const counts = Object.fromEntries(
    OFFER_STATUSES.map((s) => [s.value, all.filter((o) => o.status === s.value).length]),
  );

  const declineData = stats.declineReasons.map((d) => ({ label: d.reason, count: d.count }));

  return (
    <>
      <PageHeader
        title="Offers"
        description="Every offer from first draft through to signature, with the compensation story behind each one."
        actions={ready.length ? <NewOfferButton candidates={ready} /> : null}
        tabs={
          <LinkTabs
            param="status"
            tabs={TABS.map((t) => ({
              ...t,
              count:
                t.value === "open"
                  ? stats.open
                  : t.value === "all"
                    ? all.length
                    : counts[t.value],
            }))}
          />
        }
      />

      <PageBody>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Acceptance rate"
            value={`${Math.round(stats.acceptanceRate)}%`}
            hint={`${stats.accepted} accepted of ${stats.accepted + stats.declined} answered`}
            tone={stats.acceptanceRate >= 75 ? "emerald" : stats.acceptanceRate >= 60 ? "amber" : "rose"}
          />
          <KpiTile
            label="Out with candidates"
            value={String(stats.outstanding)}
            hint={`${stats.expiringSoon} expiring within three days`}
            tone={stats.expiringSoon > 0 ? "amber" : "blue"}
          />
          <KpiTile
            label="Median response time"
            value={`${Math.round(stats.avgTurnaroundDays)}d`}
            hint="From extended to answered"
            tone="violet"
          />
          <KpiTile
            label="Average accepted base"
            value={formatMoney(Math.round(stats.avgAcceptedBase), "USD", { compact: true })}
            hint={`Across ${pluralize(stats.accepted, "accepted offer")}`}
            tone="indigo"
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <ChartFrame
            title="Acceptance rate by month"
            description="Offers answered in each month, and the share that were accepted."
            legend={[
              { label: "Accepted", color: SERIES[2] },
              { label: "Declined", color: SERIES[7] },
            ]}
            height={220}
            table={{
              columns: ["Month", "Accepted", "Declined", "Rate"],
              rows: trend.map((t) => [t.label, t.accepted, t.declined, `${Math.round(t.rate)}%`]),
            }}
          >
            <TrendLines
              data={trend}
              height={220}
              series={[
                { key: "accepted", label: "Accepted", color: SERIES[2] },
                { key: "declined", label: "Declined", color: SERIES[7] },
              ]}
            />
          </ChartFrame>

          <ChartFrame
            title="Why candidates decline"
            description="Every recorded decline reason, most common first."
            height={220}
            table={{
              columns: ["Reason", "Count", "Share"],
              rows: stats.declineReasons.map((d) => [
                d.reason,
                d.count,
                `${Math.round((d.count / Math.max(stats.declined, 1)) * 100)}%`,
              ]),
            }}
          >
            {declineData.length ? (
              <HorizontalBars
                data={declineData}
                dataKey="count"
                label="Declines"
                height={220}
                color={SERIES[7]}
              />
            ) : (
              <EmptyState compact title="No declines recorded yet" />
            )}
          </ChartFrame>
        </div>

        <FilterBar
          searchKey={null}
          filters={[
            {
              name: "requisition",
              label: "Requisition",
              width: "w-auto min-w-[13rem]",
              options: openReqs.map((r) => ({ value: r.id, label: `${r.code} — ${r.title}` })),
            },
            {
              name: "recruiter",
              label: "Raised by",
              options: facets.recruiters.map((r) => ({ value: r.id, label: r.name })),
            },
          ]}
          right={<SortSelect options={SORTS} defaultValue="recent" />}
        />

        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<FileSignature className="size-5" />}
              title="No offers in this view"
              description="Draft one from a candidate who has reached the offer stage."
            />
          </div>
        ) : (
          <OfferTable offers={rows} focusId={get("focus")} />
        )}
      </PageBody>
    </>
  );
}
