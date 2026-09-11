import type { Metadata } from "next";
import Link from "next/link";
import { Building2, MapPin } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { ClientTierBadge } from "@/components/domain/badges";
import { KpiTile } from "@/components/domain/kpi-tile";
import { Card } from "@/components/ui/card";
import { Meter } from "@/components/ui/misc";
import { pluralize } from "@/lib/utils";
import { clientBreakdown } from "@/server/queries/analytics";
import { clientOptions } from "@/server/queries/people";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Client accounts" };

export default async function ClientsPage() {
  const rows = clientBreakdown();
  const tiers = new Map(clientOptions().map((c) => [c.id, c.tier]));

  const totalOpen = rows.reduce((s, c) => s + c.openReqs, 0);
  const totalPipeline = rows.reduce((s, c) => s + c.activePipeline, 0);
  const totalSeats = rows.reduce((s, c) => s + c.openings, 0);
  const totalFilled = rows.reduce((s, c) => s + c.filled, 0);

  return (
    <>
      <PageHeader
        title="Client accounts"
        description="The business units and client organisations raising requirements, and how well each one is being served."
      />

      <PageBody>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Accounts"
            value={String(rows.length)}
            hint={`${rows.filter((c) => c.openReqs > 0).length} with live demand`}
            tone="indigo"
          />
          <KpiTile
            label="Open requisitions"
            value={String(totalOpen)}
            hint={`Across ${pluralize(rows.filter((c) => c.openReqs > 0).length, "account")}`}
            tone="blue"
          />
          <KpiTile
            label="Candidates in play"
            value={String(totalPipeline)}
            hint={`${(totalPipeline / Math.max(totalOpen, 1)).toFixed(1)} per open requisition`}
            tone="violet"
          />
          <KpiTile
            label="Overall fill rate"
            value={`${Math.round((totalFilled / Math.max(totalSeats, 1)) * 100)}%`}
            hint={`${totalFilled} of ${totalSeats} seats placed`}
            tone="emerald"
          />
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => {
            const thin = c.openReqs > 0 && c.activePipeline / c.openReqs < 3;
            return (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="card group flex flex-col p-4 transition-shadow hover:shadow-[var(--shadow-raised)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-content group-hover:text-brand">
                      {c.name}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-content-muted">{c.industry}</p>
                  </div>
                  <ClientTierBadge value={tiers.get(c.id) ?? "standard"} />
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    { label: "Open", value: c.openReqs },
                    { label: "Pipeline", value: c.activePipeline },
                    { label: "Placed", value: c.filled },
                  ].map((s) => (
                    <div key={s.label}>
                      <dt className="text-[10.5px] tracking-wide text-content-subtle uppercase">
                        {s.label}
                      </dt>
                      <dd className="mt-0.5 text-[17px] leading-none font-semibold text-content tabular-nums">
                        {s.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 border-t border-border-base pt-3">
                  <div className="mb-1.5 flex items-baseline justify-between text-[11.5px]">
                    <span className="text-content-subtle">Seats filled</span>
                    <span className="text-content-muted tabular-nums">
                      {c.filled}/{c.openings}
                    </span>
                  </div>
                  <Meter
                    value={c.filled}
                    max={Math.max(c.openings, 1)}
                    tone={c.fillRate >= 70 ? "emerald" : c.fillRate >= 40 ? "blue" : "amber"}
                    height={6}
                    label={`${c.name} fill rate`}
                  />
                  {thin ? (
                    <p className="mt-2 text-[11.5px] text-[hsl(var(--tone-amber))]">
                      Thin coverage — under three live candidates per open role.
                    </p>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Building2 className="size-6 text-content-subtle" />
              <p className="text-sm font-semibold">No client accounts yet</p>
            </div>
          </Card>
        ) : null}

        <p className="flex items-center gap-2 text-[12px] text-content-subtle">
          <MapPin className="size-3.5" />
          Fill rate counts placed seats against every seat raised by that account, including
          requisitions that have since been closed.
        </p>
      </PageBody>
    </>
  );
}
