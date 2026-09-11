import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { FilterBar, SortSelect } from "@/components/domain/filter-bar";
import { NewCandidateButton } from "@/components/domain/forms/candidate-form";
import {
  CandidateStatusBadge,
  SeniorityBadge,
  SkillChips,
  SourceBadge,
  StageBadge,
} from "@/components/domain/badges";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { RatingStars } from "@/components/ui/misc";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { CANDIDATE_STATUSES, SENIORITIES, SOURCES, WORK_AUTHORIZATIONS } from "@/lib/domain";
import { formatMoney, pluralize, relativeTime } from "@/lib/utils";
import {
  candidateFacets,
  listCandidates,
  type CandidateFilters,
} from "@/server/queries/candidates";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Candidates" };

const SORTS = [
  { value: "recent", label: "Recently added" },
  { value: "rating", label: "Highest rated" },
  { value: "pipeline", label: "Most active" },
  { value: "experience", label: "Most experienced" },
  { value: "contacted", label: "Recently contacted" },
  { value: "name", label: "Name A–Z" },
];

const PAGE_SIZE = 40;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);

  const filters: CandidateFilters = {
    q: get("q"),
    status: get("status"),
    source: get("source"),
    seniority: get("seniority"),
    owner: get("owner"),
    skill: get("skill"),
    auth: get("auth"),
    inPipeline: get("inPipeline"),
    sort: get("sort") ?? "recent",
  };

  const all = listCandidates(filters);
  const page = Math.max(1, Number(get("page") ?? 1) || 1);
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const facets = candidateFacets();
  const inPlay = all.filter((c) => c.activeSubmissions > 0).length;

  const qs = (next: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      const value = Array.isArray(v) ? v[0] : v;
      if (value && k !== "page") sp.set(k, value);
    }
    sp.set("page", String(next));
    return `/candidates?${sp.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Candidates"
        description={`${pluralize(all.length, "person")} matching · ${inPlay} currently in a live pipeline.`}
        actions={
          <NewCandidateButton
            defaultOpen={get("new") === "1"}
            options={{ owners: facets.owners }}
          />
        }
      />

      <PageBody>
        <FilterBar
          searchPlaceholder="Search name, title, company, skill…"
          filters={[
            {
              name: "status",
              label: "Status",
              options: CANDIDATE_STATUSES.map((s) => ({ value: s.value, label: s.label })),
            },
            {
              name: "inPipeline",
              label: "Pipeline",
              allLabel: "Any pipeline state",
              options: [
                { value: "yes", label: "In a live pipeline" },
                { value: "no", label: "On the bench" },
              ],
            },
            {
              name: "seniority",
              label: "Level",
              options: SENIORITIES.map((s) => ({ value: s.value, label: s.label })),
            },
            {
              name: "skill",
              label: "Skill",
              width: "w-auto min-w-[10rem]",
              options: facets.skills
                .slice(0, 40)
                .map((s) => ({ value: s.name, label: `${s.name} (${s.count})` })),
            },
            {
              name: "source",
              label: "Source",
              options: SOURCES.map((s) => ({ value: s.value, label: s.label })),
            },
            {
              name: "owner",
              label: "Owner",
              options: facets.owners.map((o) => ({ value: o.id, label: o.name })),
            },
            {
              name: "auth",
              label: "Work auth",
              options: WORK_AUTHORIZATIONS.map((w) => ({ value: w.value, label: w.label })),
            },
          ]}
          right={<SortSelect options={SORTS} defaultValue="recent" />}
        />

        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Users className="size-5" />}
              title="No candidates match these filters"
              description="Try a broader search, or add someone new to the talent pool."
            />
          </div>
        ) : (
          <>
            <TableShell>
              <Table>
                <thead>
                  <tr>
                    <Th className="min-w-[20rem]">Candidate</Th>
                    <Th>Experience</Th>
                    <Th className="min-w-[13rem]">Skills</Th>
                    <Th>Pipeline</Th>
                    <Th>Source</Th>
                    <Th align="right">Expectation</Th>
                    <Th>Owner</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <Tr key={c.id} interactive>
                      <Td>
                        <Link href={`/candidates/${c.id}`} className="group flex items-start gap-3">
                          <Avatar name={`${c.firstName} ${c.lastName}`} size="md" />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[13.5px] font-medium text-content group-hover:text-brand">
                                {c.firstName} {c.lastName}
                              </span>
                              <CandidateStatusBadge value={c.status} />
                              {c.rating > 0 ? <RatingStars value={c.rating} /> : null}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-content-muted">
                              {c.currentTitle} at {c.currentCompany}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-content-subtle">
                              <MapPin className="size-3 shrink-0" />
                              {c.location}
                              {c.willingToRelocate ? " · open to relocation" : ""}
                            </span>
                          </span>
                        </Link>
                      </Td>

                      <Td>
                        <div className="whitespace-nowrap">
                          <p className="text-[13px] text-content tabular-nums">
                            {c.yearsExperience} yrs
                          </p>
                          <SeniorityBadge value={c.seniority} className="mt-1" />
                        </div>
                      </Td>

                      <Td>
                        <SkillChips skills={c.skills} max={4} />
                      </Td>

                      <Td>
                        {c.activeSubmissions > 0 ? (
                          <div>
                            <p className="text-[13px] font-medium text-content tabular-nums">
                              {c.activeSubmissions} active
                            </p>
                            {c.furthestStage ? (
                              <StageBadge value={c.furthestStage} className="mt-1" />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-[12.5px] text-content-subtle">
                            {c.totalSubmissions ? `${c.totalSubmissions} past` : "Never submitted"}
                          </span>
                        )}
                      </Td>

                      <Td>
                        <SourceBadge value={c.source} />
                        <p className="mt-1 text-[11px] text-content-subtle">
                          Added {relativeTime(c.createdAt)}
                        </p>
                      </Td>

                      <Td align="right">
                        <span className="text-[13px] whitespace-nowrap text-content tabular-nums">
                          {formatMoney(c.expectedSalary, c.currency, { compact: true })}
                        </span>
                        <p className="mt-0.5 text-[11px] whitespace-nowrap text-content-subtle">
                          {c.noticePeriodDays ? `${c.noticePeriodDays}d notice` : "Available now"}
                        </p>
                      </Td>

                      <Td>
                        <UserChip name={c.ownerName} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>

            {totalPages > 1 ? (
              <nav
                className="flex items-center justify-between gap-3"
                aria-label="Candidate pagination"
              >
                <p className="text-[12.5px] text-content-subtle tabular-nums">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, all.length)} of{" "}
                  {all.length}
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
                    Page {page} of {totalPages}
                  </span>
                  {page < totalPages ? (
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
