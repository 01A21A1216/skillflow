import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Users } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { KpiTile } from "@/components/domain/kpi-tile";
import { RoleBadge } from "@/components/domain/badges";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/misc";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { USER_ROLES, type UserRole } from "@/lib/domain";
import { average, groupBy, pluralize } from "@/lib/utils";
import { teamOverview } from "@/server/queries/people";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Team" };

const ORDER: UserRole[] = ["admin", "recruiter", "coordinator", "hiring_manager", "interviewer"];

export default async function TeamPage() {
  const members = teamOverview();
  const grouped = groupBy(members, (m) => m.role);

  const recruiters = members.filter((m) => m.capacity > 0);
  const totalOpen = recruiters.reduce((s, m) => s + m.openReqs, 0);
  const totalCapacity = recruiters.reduce((s, m) => s + m.capacity, 0);
  const overloaded = recruiters.filter((m) => m.load > 100).length;
  const feedbackOwed = members.reduce((s, m) => s + m.feedbackOwed, 0);

  return (
    <>
      <PageHeader
        title="Team"
        description="Who is carrying what, and where the load is uneven."
      />

      <PageBody>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="People"
            value={String(members.length)}
            hint={`${recruiters.length} recruiters, ${members.length - recruiters.length} partners and panelists`}
            tone="indigo"
          />
          <KpiTile
            label="Recruiter utilisation"
            value={`${Math.round((totalOpen / Math.max(totalCapacity, 1)) * 100)}%`}
            hint={`${totalOpen} open requisitions against a capacity of ${totalCapacity}`}
            tone={totalOpen / Math.max(totalCapacity, 1) > 0.9 ? "amber" : "emerald"}
          />
          <KpiTile
            label="Over capacity"
            value={String(overloaded)}
            hint="Recruiters carrying more requisitions than their target"
            tone={overloaded ? "rose" : "emerald"}
            goodWhenUp={false}
          />
          <KpiTile
            label="Scorecards owed"
            value={String(feedbackOwed)}
            hint="Completed interviews still missing feedback"
            tone={feedbackOwed > 10 ? "amber" : "blue"}
            href="/interviews?window=awaiting_feedback"
          />
        </section>

        {/* Recruiter workload */}
        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              title="Recruiter workload"
              description="Requisitions carried against target capacity, and the pipeline behind them."
            />
          </div>
          <TableShell className="rounded-none border-0 border-t border-border-base shadow-none">
            <Table>
              <thead>
                <tr>
                  <Th className="min-w-[14rem]">Recruiter</Th>
                  <Th align="right">Open reqs</Th>
                  <Th className="min-w-[10rem]">Capacity</Th>
                  <Th align="right">Active pipeline</Th>
                  <Th align="right">Candidates owned</Th>
                  <Th align="right">Hires</Th>
                  <Th align="right">Offer acceptance</Th>
                </tr>
              </thead>
              <tbody>
                {recruiters
                  .sort((a, b) => b.load - a.load)
                  .map((m) => (
                    <Tr key={m.id} interactive>
                      <Td>
                        <Link href={`/team/${m.id}`} className="flex items-center gap-2.5">
                          <Avatar name={m.name} size="md" />
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-medium text-content">
                              {m.name}
                            </span>
                            <span className="block truncate text-[11.5px] text-content-subtle">
                              {m.title}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {m.openReqs}
                      </Td>
                      <Td>
                        <Meter
                          value={Math.min(m.load, 100)}
                          tone={m.load > 100 ? "rose" : m.load > 85 ? "amber" : "emerald"}
                          height={6}
                          label={`${m.name} capacity`}
                        />
                        <p className="mt-1 text-[11px] text-content-subtle tabular-nums">
                          {Math.round(m.load)}% of {m.capacity}
                        </p>
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {m.activePipeline}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {m.candidatesOwned}
                      </Td>
                      <Td align="right" className="font-semibold tabular-nums">
                        {m.hires}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {m.offerAcceptance ? `${Math.round(m.offerAcceptance)}%` : "—"}
                      </Td>
                    </Tr>
                  ))}
              </tbody>
            </Table>
          </TableShell>
        </Card>

        {/* Directory */}
        {ORDER.map((role) => {
          const people = grouped[role];
          if (!people?.length) return null;
          const meta = USER_ROLES.find((r) => r.value === role)!;

          return (
            <section key={role}>
              <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-semibold text-content">
                {meta.label}
                <span className="text-[11.5px] font-normal text-content-subtle">
                  {pluralize(people.length, "person", "people")}
                </span>
              </h2>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {people.map((m) => (
                  <Link
                    key={m.id}
                    href={`/team/${m.id}`}
                    className="card group p-4 transition-shadow hover:shadow-[var(--shadow-raised)]"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={m.name} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-content group-hover:text-brand">
                          {m.name}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-content-muted">{m.title}</p>
                        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-content-subtle">
                          <Mail className="size-3 shrink-0" />
                          <span className="truncate">{m.email}</span>
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <RoleBadge value={m.role} />
                          <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-content-muted">
                            {m.department}
                          </span>
                        </div>
                      </div>
                    </div>

                    <dl className="mt-3.5 grid grid-cols-3 gap-2 border-t border-border-base pt-3">
                      {[
                        { label: "Open reqs", value: m.openReqs },
                        {
                          label: role === "recruiter" || role === "admin" ? "Pipeline" : "Interviews",
                          value:
                            role === "recruiter" || role === "admin"
                              ? m.activePipeline
                              : m.interviewsRun,
                        },
                        {
                          label: m.feedbackOwed ? "Owed" : "Hires",
                          value: m.feedbackOwed || m.hires,
                        },
                      ].map((s) => (
                        <div key={s.label}>
                          <dt className="text-[10.5px] tracking-wide text-content-subtle uppercase">
                            {s.label}
                          </dt>
                          <dd className="mt-0.5 text-[15px] font-semibold text-content tabular-nums">
                            {s.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}

        <p className="flex items-center gap-2 text-[12px] text-content-subtle">
          <Users className="size-3.5" />
          Average scorecard rating given across the panel:{" "}
          {average(
            members.filter((m) => m.avgRatingGiven !== null).map((m) => m.avgRatingGiven!),
          ).toFixed(2)}{" "}
          out of 5.
        </p>
      </PageBody>
    </>
  );
}
