import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Mail, MapPin, User } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import {
  ClientTierBadge,
  HealthBadge,
  MetaRow,
  PriorityBadge,
  ReqStatusBadge,
} from "@/components/domain/badges";
import { KpiTile } from "@/components/domain/kpi-tile";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentBar } from "@/components/ui/misc";
import { STAGE, type Stage } from "@/lib/domain";
import { formatDate, formatRange, pluralize } from "@/lib/utils";
import { getClient } from "@/server/queries/people";
import {
  listRequisitions,
  requisitionHealth,
  stageBreakdownForRequisitions,
} from "@/server/queries/requisitions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = getClient(id);
  return { title: detail?.client.name ?? "Client" };
}

const STAGES: Stage[] = ["sourced", "screening", "submitted", "interview", "offer"];

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = getClient(id);
  if (!detail) notFound();

  const { client, owner, requisitions } = detail;
  const summaries = listRequisitions({ client: id, status: "all" });
  const breakdown = stageBreakdownForRequisitions(summaries.map((r) => r.id));

  const open = summaries.filter((r) => ["open", "on_hold", "draft"].includes(r.status));
  const activePipeline = summaries.reduce((s, r) => s + r.activeCount, 0);
  const seats = summaries.reduce((s, r) => s + r.openings, 0);
  const filled = summaries.reduce((s, r) => s + r.filled, 0);
  const atRisk = open.filter((r) => ["at_risk", "stalled"].includes(requisitionHealth(r).key));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Client accounts", href: "/clients" }, { label: client.name }]}
        title={client.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{client.industry}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {client.location}
            </span>
            <span aria-hidden>·</span>
            <span>{client.slaDays}-day fill SLA</span>
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <ClientTierBadge value={client.tier} dot />
            <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-content-muted capitalize">
              {client.status}
            </span>
          </div>
        }
      />

      <PageBody>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Open requisitions"
            value={String(open.length)}
            hint={`${summaries.length} raised in total`}
            tone="indigo"
          />
          <KpiTile
            label="Candidates in play"
            value={String(activePipeline)}
            hint={
              open.length
                ? `${(activePipeline / open.length).toFixed(1)} per open requisition`
                : "No live requisitions"
            }
            tone="blue"
          />
          <KpiTile
            label="Seats filled"
            value={`${filled}/${seats}`}
            hint={`${Math.round((filled / Math.max(seats, 1)) * 100)}% fill rate all time`}
            tone="emerald"
          />
          <KpiTile
            label="At risk"
            value={String(atRisk.length)}
            hint="Stalled, or past target with nobody interviewing"
            tone={atRisk.length ? "rose" : "emerald"}
            goodWhenUp={false}
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" padded={false}>
            <div className="p-5 pb-4">
              <CardHeader
                icon={<Building2 className="size-4" />}
                title="Requisitions"
                description={`${pluralize(open.length, "live requisition")} of ${summaries.length} raised.`}
              />
            </div>

            {summaries.length ? (
              <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                {summaries.map((r) => {
                  const stages = breakdown.get(r.id) ?? ({} as Record<Stage, number>);
                  return (
                    <li key={r.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/requisitions/${r.id}`}
                              className="text-[13.5px] font-medium text-content hover:text-brand"
                            >
                              {r.title}
                            </Link>
                            <span className="font-mono text-[11px] text-content-subtle">
                              {r.code}
                            </span>
                            <PriorityBadge value={r.priority} dot />
                            <ReqStatusBadge value={r.status} />
                          </div>
                          <p className="mt-0.5 text-[12px] text-content-muted">
                            {r.location} · opened {formatDate(r.openedAt)} ·{" "}
                            {formatRange(r.minSalary, r.maxSalary, r.currency)}
                          </p>

                          {r.activeCount > 0 ? (
                            <div className="mt-2 max-w-xs">
                              <SegmentBar
                                height={5}
                                segments={STAGES.map((s) => ({
                                  label: STAGE[s].label,
                                  value: stages[s] ?? 0,
                                  tone: STAGE[s].tone,
                                }))}
                              />
                              <p className="mt-1 text-[11px] text-content-subtle tabular-nums">
                                {r.activeCount} active · {r.interviewCount} interviewing ·{" "}
                                {r.filled}/{r.openings} filled
                              </p>
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <HealthBadge health={requisitionHealth(r)} />
                          <UserChip name={r.recruiterName} meta="Recruiter" />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={<Building2 className="size-5" />}
                title="No requisitions raised yet"
              />
            )}
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Account" />
              <MetaRow
                className="mt-4 grid-cols-2"
                items={[
                  { label: "Tier", value: client.tier },
                  { label: "Industry", value: client.industry },
                  { label: "Location", value: client.location },
                  { label: "Fill SLA", value: `${client.slaDays} days` },
                  { label: "Status", value: client.status },
                  { label: "On file since", value: formatDate(client.createdAt) },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title="Contacts" />
              <div className="mt-4 space-y-3">
                {owner ? (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={owner.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-content">{owner.name}</p>
                      <p className="truncate text-[11.5px] text-content-subtle">
                        Account owner · {owner.title}
                      </p>
                    </div>
                  </div>
                ) : null}

                {client.contactName ? (
                  <div className="flex items-start gap-2.5 border-t border-border-base pt-3">
                    <User className="mt-0.5 size-4 shrink-0 text-content-subtle" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-content">{client.contactName}</p>
                      {client.contactEmail ? (
                        <a
                          href={`mailto:${client.contactEmail}`}
                          className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-content-subtle hover:text-brand"
                        >
                          <Mail className="size-3 shrink-0" />
                          <span className="truncate">{client.contactEmail}</span>
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHeader title="Recruiters on this account" />
              <ul className="mt-4 space-y-2.5">
                {[...new Map(requisitions.map((r) => [r.recruiter.id, r.recruiter])).values()].map(
                  (u) => (
                    <li key={u.id}>
                      <Link href={`/team/${u.id}`} className="block">
                        <UserChip name={u.name} meta={u.title} />
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
