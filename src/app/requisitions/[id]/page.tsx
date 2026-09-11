import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Banknote,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  FileSignature,
  MapPin,
  MessageSquare,
  Users,
} from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { ActivityFeed } from "@/components/domain/activity-feed";
import {
  EmploymentBadge,
  HealthBadge,
  InterviewStatusBadge,
  InterviewTypeBadge,
  MetaRow,
  OfferStatusBadge,
  PriorityBadge,
  ReqStatusBadge,
  SeniorityBadge,
  SkillChips,
  StageBadge,
  WorkModeBadge,
} from "@/components/domain/badges";
import { EditRequisitionButton } from "@/components/domain/forms/requisition-form";
import { NoteComposer } from "@/components/domain/forms/pipeline-form";
import { NotesList } from "@/components/domain/notes-list";
import { PipelineBoard } from "@/components/domain/pipeline-board";
import { PipelineOptionsProvider } from "@/components/domain/pipeline-actions";
import { RequisitionStatusMenu } from "@/components/domain/requisition-status-menu";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/link-button";
import { Meter } from "@/components/ui/misc";
import { STAGE_SLA_DAYS, type Stage } from "@/lib/domain";
import { daysBetween, formatDate, formatDateTime, formatMoney, formatRange, pct, pluralize } from "@/lib/utils";
import { requisitionActivity } from "@/server/queries/dashboard";
import {
  getRequisition,
  listRequisitions,
  requisitionFacets,
  requisitionHealth,
} from "@/server/queries/requisitions";
import { pipelineCards } from "@/server/queries/pipeline";
import { listInterviews } from "@/server/queries/interviews";
import { hiringManagerOptions, listUsers } from "@/server/queries/people";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = getRequisition(id);
  return { title: detail ? `${detail.req.code} · ${detail.req.title}` : "Requisition" };
}

export default async function RequisitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = getRequisition(id);
  if (!detail) notFound();

  const { req, client, recruiter, hiringManager, team, pipeline, interviews, offers, notes } = detail;

  const summary = listRequisitions({ status: "all" }).find((r) => r.id === id)!;
  const health = requisitionHealth(summary);
  const cards = pipelineCards({ requisition: id });
  const activity = requisitionActivity(id, 25);
  const facets = requisitionFacets();
  const people = listUsers();

  const closedOut = pipeline.filter((p) => ["rejected", "withdrawn"].includes(p.submission.status));
  const hires = pipeline.filter((p) => p.submission.status === "hired");
  // Asking the query layer keeps the clock out of the component render.
  const upcoming = listInterviews({ window: "upcoming", requisition: id, status: "scheduled" });

  const rejectionTally = new Map<string, number>();
  for (const p of closedOut) {
    const reason = p.submission.rejectionReason ?? "Unspecified";
    rejectionTally.set(reason, (rejectionTally.get(reason) ?? 0) + 1);
  }
  const topReasons = [...rejectionTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const submittedCount = pipeline.filter((p) => p.submission.submittedAt).length;
  const conversion = pct(hires.length, submittedCount);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Requisitions", href: "/requisitions" },
          { label: req.code },
        ]}
        title={req.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={`/clients/${client.id}`} className="hover:text-brand">
              {client.name}
            </Link>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {req.location}
            </span>
            <span aria-hidden>·</span>
            <span>Opened {formatDate(req.openedAt)}</span>
            <span aria-hidden>·</span>
            <span>{summary.ageDays} days old</span>
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <ReqStatusBadge value={req.status} dot />
            <PriorityBadge value={req.priority} dot />
            <WorkModeBadge value={req.workMode} />
            <EmploymentBadge value={req.employmentType} />
            <SeniorityBadge value={req.seniority} />
            <HealthBadge health={health} showReason />
          </div>
        }
        actions={
          <>
            <LinkButton href={`/pipeline?requisition=${req.id}`} size="sm">
              Board view
            </LinkButton>
            <EditRequisitionButton
              requisition={req}
              options={{
                clients: facets.clients,
                recruiters: facets.recruiters,
                hiringManagers: hiringManagerOptions(),
                departments: facets.departments,
              }}
            />
            <RequisitionStatusMenu requisitionId={req.id} current={req.status} />
          </>
        }
      />

      <PageBody>
        {/* ---------------- Headline numbers ---------------- */}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Card className="p-4">
            <p className="text-[12.5px] font-medium text-content-muted">Openings filled</p>
            <p className="mt-2 text-[26px] leading-none font-semibold text-content">
              {req.filled}
              <span className="text-content-subtle">/{req.openings}</span>
            </p>
            <Meter
              className="mt-3"
              value={req.filled}
              max={req.openings}
              tone={req.filled >= req.openings ? "emerald" : "indigo"}
              label="Openings filled"
            />
          </Card>

          <Card className="p-4">
            <p className="text-[12.5px] font-medium text-content-muted">Active pipeline</p>
            <p className="mt-2 text-[26px] leading-none font-semibold text-content">
              {cards.length}
            </p>
            <p className="mt-2 text-[11.5px] text-content-subtle">
              {cards.filter((c) => c.isAging).length} past the stage target
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-[12.5px] font-medium text-content-muted">Submitted to date</p>
            <p className="mt-2 text-[26px] leading-none font-semibold text-content">
              {submittedCount}
            </p>
            <p className="mt-2 text-[11.5px] text-content-subtle">
              of {pipeline.length} sourced in total
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-[12.5px] font-medium text-content-muted">Submit-to-hire</p>
            <p className="mt-2 text-[26px] leading-none font-semibold text-content">
              {Math.round(conversion)}%
            </p>
            <p className="mt-2 text-[11.5px] text-content-subtle">
              {pluralize(hires.length, "hire")} from {submittedCount} submitted
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-[12.5px] font-medium text-content-muted">Target fill date</p>
            <p className="mt-2 text-[26px] leading-none font-semibold text-content">
              {req.targetFillDate ? formatDate(req.targetFillDate, false) : "—"}
            </p>
            <p
              className={
                summary.daysToTarget !== null && summary.daysToTarget < 0
                  ? "mt-2 text-[11.5px] text-[hsl(var(--tone-rose))]"
                  : "mt-2 text-[11.5px] text-content-subtle"
              }
            >
              {summary.daysToTarget === null
                ? "No target set"
                : summary.daysToTarget < 0
                  ? `${Math.abs(summary.daysToTarget)} days over`
                  : `${summary.daysToTarget} days remaining`}
            </p>
          </Card>
        </section>

        {/* ---------------- Board ---------------- */}
        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              icon={<Users className="size-4" />}
              title="Pipeline"
              description="Drag a candidate to move them between stages. Skills that match this requisition are highlighted."
            />
          </div>
          <div className="border-t border-border-base p-4">
            {cards.length ? (
              <PipelineOptionsProvider
                value={{
                  interviewers: people
                    .filter((p) =>
                      ["interviewer", "hiring_manager", "recruiter", "admin"].includes(p.role),
                    )
                    .map((p) => ({ id: p.id, name: p.name, title: p.title })),
                  coordinators: people
                    .filter((p) => ["coordinator", "recruiter", "admin"].includes(p.role))
                    .map((p) => ({ id: p.id, name: p.name, title: p.title })),
                }}
              >
                <PipelineBoard cards={cards} requiredSkills={req.skills} compact />
              </PipelineOptionsProvider>
            ) : (
              <EmptyState
                icon={<Users className="size-5" />}
                title="Nobody in the pipeline yet"
                description="Find people in the candidate list and add them to this requisition."
                action={<LinkButton href="/candidates" size="sm" variant="primary">Browse candidates</LinkButton>}
              />
            )}
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-3">
          {/* ---------------- Left ---------------- */}
          <div className="space-y-5 lg:col-span-2">
            <Card padded={false}>
              <div className="p-5 pb-4">
                <CardHeader
                  icon={<CalendarDays className="size-4" />}
                  title="Interviews"
                  description={
                    upcoming.length
                      ? `${pluralize(upcoming.length, "round")} scheduled ahead, ${interviews.length} in total.`
                      : `${pluralize(interviews.length, "round")} run so far.`
                  }
                />
              </div>

              {interviews.length ? (
                <ul className="max-h-[26rem] divide-y divide-[hsl(var(--border))] overflow-y-auto border-t border-border-base">
                  {interviews.slice(0, 25).map(({ interview: iv, candidate }) => (
                    <li key={iv.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                      <Avatar name={`${candidate.firstName} ${candidate.lastName}`} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/candidates/${candidate.id}`}
                          className="text-[13px] font-medium text-content hover:text-brand"
                        >
                          {candidate.firstName} {candidate.lastName}
                        </Link>
                        <p className="mt-0.5 truncate text-[12px] text-content-muted">
                          Round {iv.round} · {iv.title} · {formatDateTime(iv.scheduledAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <InterviewTypeBadge value={iv.type} />
                        <InterviewStatusBadge value={iv.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact icon={<CalendarDays className="size-5" />} title="No interviews yet" />
              )}
            </Card>

            {offers.length ? (
              <Card padded={false}>
                <div className="p-5 pb-4">
                  <CardHeader
                    icon={<FileSignature className="size-4" />}
                    title="Offers"
                    description={`${pluralize(offers.length, "offer")} raised against this requisition.`}
                  />
                </div>
                <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {offers.map(({ offer: o, candidate }) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/candidates/${candidate.id}`}
                          className="text-[13px] font-medium text-content hover:text-brand"
                        >
                          {candidate.firstName} {candidate.lastName}
                        </Link>
                        <p className="mt-0.5 text-[12px] text-content-muted tabular-nums">
                          {formatMoney(o.baseSalary)} base
                          {o.bonusPercent ? ` · ${o.bonusPercent}% bonus` : ""}
                          {o.startDate ? ` · starts ${formatDate(o.startDate)}` : ""}
                        </p>
                      </div>
                      <OfferStatusBadge value={o.status} />
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card padded={false}>
              <div className="p-5 pb-4">
                <CardHeader
                  icon={<Briefcase className="size-4" />}
                  title="Closed out"
                  description={`${pluralize(closedOut.length, "candidate")} did not progress.`}
                />
              </div>

              {topReasons.length ? (
                <div className="border-t border-border-base px-5 py-4">
                  <ul className="space-y-2.5">
                    {topReasons.map(([reason, count]) => (
                      <li key={reason}>
                        <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                          <span className="text-content-muted">{reason}</span>
                          <span className="font-medium text-content tabular-nums">{count}</span>
                        </div>
                        <Meter
                          value={count}
                          max={closedOut.length}
                          tone="rose"
                          height={5}
                          label={reason}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <EmptyState compact icon={<CheckCircle2 className="size-5" />} title="Nobody closed out yet" />
              )}
            </Card>

            <Card>
              <CardHeader
                icon={<MessageSquare className="size-4" />}
                title="Notes"
                description="Intake decisions, market feedback and anything the panel should know."
              />
              <div className="mt-4 space-y-4">
                <NoteComposer entityType="requisition" entityId={req.id} />
                <NotesList notes={notes} />
              </div>
            </Card>
          </div>

          {/* ---------------- Right ---------------- */}
          <div className="space-y-5">
            <Card>
              <CardHeader title="The brief" />
              {req.description ? (
                <p className="mt-3 text-[13px] leading-relaxed text-content-muted">
                  {req.description}
                </p>
              ) : null}

              {req.requirements.length ? (
                <ul className="mt-4 space-y-2">
                  {req.requirements.map((r) => (
                    <li key={r} className="flex gap-2 text-[13px] leading-relaxed text-content">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--tone-emerald))]" />
                      {r}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-4 border-t border-border-base pt-4">
                <p className="mb-2 text-[10.5px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
                  Must-have skills
                </p>
                <SkillChips skills={req.skills} max={20} />
              </div>
            </Card>

            <Card>
              <CardHeader icon={<Banknote className="size-4" />} title="Commercials" />
              <MetaRow
                className="mt-4 grid-cols-2"
                items={[
                  {
                    label: "Salary band",
                    value: formatRange(req.minSalary, req.maxSalary, req.currency),
                  },
                  ...(req.billRateMin
                    ? [
                        {
                          label: "Bill rate",
                          value: `$${req.billRateMin}–${req.billRateMax}/hr`,
                        },
                      ]
                    : []),
                  { label: "Experience", value: `${req.experienceMin}–${req.experienceMax} yrs` },
                  { label: "Department", value: req.department },
                  { label: "Client SLA", value: `${client.slaDays} days` },
                  {
                    label: "Days open",
                    value: req.closedAt
                      ? `${daysBetween(req.openedAt, req.closedAt)} (closed)`
                      : String(summary.ageDays),
                  },
                ]}
              />
            </Card>

            <Card>
              <CardHeader title="Working this requisition" />
              <ul className="mt-4 space-y-3">
                <li className="flex items-center justify-between gap-3">
                  <UserChip name={recruiter.name} meta={recruiter.title} />
                  <span className="shrink-0 text-[11px] text-content-subtle">Lead</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <UserChip name={hiringManager.name} meta={hiringManager.title} />
                  <span className="shrink-0 text-[11px] text-content-subtle">Hiring manager</span>
                </li>
                {team
                  .filter((t) => t.user.id !== recruiter.id)
                  .map(({ user, role }) => (
                    <li key={user.id} className="flex items-center justify-between gap-3">
                      <UserChip name={user.name} meta={user.title} />
                      <span className="shrink-0 text-[11px] text-content-subtle capitalize">
                        {role}
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>

            <Card>
              <CardHeader
                title="Stage targets"
                description="How long a candidate should spend in each stage."
              />
              <ul className="mt-4 space-y-2 text-[12.5px]">
                {(Object.entries(STAGE_SLA_DAYS) as [Stage, number][])
                  .filter(([, days]) => days > 0)
                  .map(([stage, days]) => {
                    const inStage = cards.filter((c) => c.stage === stage);
                    const over = inStage.filter((c) => c.isAging).length;
                    return (
                      <li key={stage} className="flex items-center gap-2">
                        <StageBadge value={stage} />
                        <span className="ml-auto text-content-muted tabular-nums">
                          {inStage.length} here
                        </span>
                        <span
                          className={
                            over
                              ? "w-16 text-right text-[hsl(var(--tone-amber))] tabular-nums"
                              : "w-16 text-right text-content-subtle tabular-nums"
                          }
                        >
                          {over ? `${over} over` : `${days}d target`}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </Card>

            {hires.length ? (
              <Card className="border-[hsl(var(--tone-emerald)/0.4)] bg-[hsl(var(--tone-emerald-bg)/0.35)]">
                <CardHeader title="Hired" />
                <ul className="mt-3 space-y-2">
                  {hires.map(({ candidate }) => (
                    <li key={candidate.id}>
                      <Link
                        href={`/candidates/${candidate.id}`}
                        className="flex items-center gap-2 text-[13px] text-content hover:text-brand"
                      >
                        <Avatar name={`${candidate.firstName} ${candidate.lastName}`} size="xs" />
                        {candidate.firstName} {candidate.lastName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Activity" />
              <div className="mt-4">
                <ActivityFeed items={activity} compact />
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
