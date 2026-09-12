import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, CalendarDays, Clock, Gauge, Mail, Phone, PhoneCall } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import {
  HealthBadge,
  InterviewStatusBadge,
  MetaRow,
  PriorityBadge,
  ReqStatusBadge,
  RoleBadge,
} from "@/components/domain/badges";
import { KpiTile } from "@/components/domain/kpi-tile";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter } from "@/components/ui/misc";
import { formatDate, formatDateTime, pluralize } from "@/lib/utils";
import { getTeamMember } from "@/server/queries/people";
import {
  owedScorecards,
  recruiterFollowUps,
  recruiterScorecard,
  recruiterTrend,
} from "@/server/queries/recruiter";
import { StackedColumns } from "@/components/charts/charts";
import { ChartFrame } from "@/components/charts/primitives";
import { SERIES } from "@/components/charts/palette";
import { listRequisitions, requisitionHealth } from "@/server/queries/requisitions";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getTeamMember(id);
  return { title: detail?.user.name ?? "Team member" };
}

export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission("team.view");
  const detail = await getTeamMember(id);
  if (!detail) notFound();

  const { user, member, requisitions, managed, interviews } = detail;
  // Only the requirements this person is on, rather than every one in the
  // business to look up a dozen.
  const summaries = new Map(
    (
      await listRequisitions(
        {
          ids: [...requisitions, ...managed].map((r) => r.requisition.id),
          status: "all",
        },
        actor,
      )
    ).map((r) => [r.id, r]),
  );

  const owned = requisitions.filter((r) =>
    ["open", "on_hold", "draft"].includes(r.requisition.status),
  );
  const upcoming = interviews.filter((i) => i.isUpcoming);

  // The personal desk view (§12). Only meaningful for people who own
  // requirements — an interviewer has no funnel of their own, and a row of
  // zeroes would read as a broken page rather than an empty one.
  const ownsADesk = ["recruiter", "recruitment_manager", "sourcer", "super_admin"].includes(
    user.role,
  );
  const desk = ownsADesk ? await recruiterScorecard(user.id) : null;
  const trend = ownsADesk ? await recruiterTrend(user.id) : null;
  const followUps = ownsADesk ? await recruiterFollowUps(user.id) : [];
  const owedFeedback = await owedScorecards(user.id);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Team", href: "/team" }, { label: user.name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={user.name} size="lg" />
            <span>{user.name}</span>
          </span>
        }
        description={`${user.title} · ${user.department}`}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <RoleBadge value={user.role} dot />
            <span className="text-[12px] text-content-subtle">
              Joined {formatDate(user.joinedAt)} · {user.timezone.replace("_", " ")}
            </span>
          </div>
        }
      />

      <PageBody>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Open requisitions"
            value={String(member.openReqs)}
            hint={member.capacity ? `Target capacity ${member.capacity}` : "Not a requisition owner"}
            tone="indigo"
          />
          <KpiTile
            label="Active pipeline"
            value={String(member.activePipeline)}
            hint={`${member.candidatesOwned} candidates owned overall`}
            tone="blue"
          />
          <KpiTile
            label="Hires"
            value={String(member.hires)}
            hint={
              member.offerAcceptance
                ? `${Math.round(member.offerAcceptance)}% offer acceptance`
                : "No offers answered yet"
            }
            tone="emerald"
          />
          <KpiTile
            label="Interviews run"
            value={String(member.interviewsRun)}
            hint={
              member.feedbackOwed
                ? `${member.feedbackOwed} scorecards still owed`
                : "All feedback submitted"
            }
            tone={member.feedbackOwed ? "amber" : "violet"}
          />
        </section>

        {desk ? (
          <Card>
            <CardHeader
              icon={<Gauge className="size-4" />}
              title="This desk"
              description="Where their candidates stand now, and what they have put through in the last 90 days."
            />
            <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "Requirements", value: desk.assignedRequirements, note: `${desk.agingRequirements} open over 15 days` },
                { label: "Sourced", value: desk.sourced, note: "added in 90 days" },
                { label: "Screened", value: desk.screened, note: "qualified in 90 days" },
                { label: "Submitted", value: desk.submitted, note: "to clients in 90 days" },
                { label: "Interviews booked", value: desk.interviewsScheduled, note: `${desk.interviewsCompleted} completed` },
                { label: "Feedback pending", value: desk.feedbackPending, note: "scorecards owed to them" },
                { label: "Selected", value: desk.selected, note: "live, at or near offer" },
                { label: "At offer", value: desk.offers, note: "live offers out" },
                { label: "Joined", value: desk.joined, note: "all time" },
                { label: "Closed out", value: desk.rejected, note: "rejected or withdrawn" },
                { label: "Follow-ups due", value: desk.followUpsDue, note: "promised callbacks" },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-[11px] font-medium tracking-[0.04em] text-content-subtle uppercase">
                    {m.label}
                  </p>
                  <p className="mt-0.5 text-[20px] leading-none font-semibold text-content tabular-nums">
                    {m.value}
                  </p>
                  <p className="mt-1 text-[11px] text-content-subtle">{m.note}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 border-t border-border-base pt-3 text-[11.5px] leading-relaxed text-content-subtle">
              Sourced, screened and submitted are things that <em>happened</em> in the last 90
              days; selected, at offer and joined are where candidates <em>are</em>. The two do
              not add up to each other, and should not be read as if they did.
            </p>
          </Card>
        ) : null}

        {trend ? (
          <ChartFrame
            title="Activity by week"
            description="Whether a week went on sourcing or on closing, rather than a single measure of busy."
            table={{
              columns: ["Week", "Added", "Submitted", "Interviews", "Contacts"],
              rows: trend.map((t) => [
                t.label,
                String(t.added),
                String(t.submitted),
                String(t.interviews),
                String(t.contacts),
              ]),
            }}
          >
            <StackedColumns
              data={trend}
              xKey="label"
              series={[
                { key: "added", label: "Added", color: SERIES[0] },
                { key: "submitted", label: "Submitted", color: SERIES[1] },
                { key: "interviews", label: "Interviews", color: SERIES[2] },
                { key: "contacts", label: "Contacts", color: SERIES[3] },
              ]}
            />
          </ChartFrame>
        ) : null}

        {followUps.length || owedFeedback.length ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {followUps.length ? (
              <Card padded={false}>
                <div className="p-5 pb-4">
                  <CardHeader
                    icon={<PhoneCall className="size-4" />}
                    title="Follow-ups"
                    description="Callbacks they promised when logging a conversation."
                  />
                </div>
                <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {followUps.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                      <Link
                        href={`/candidates/${f.candidateId}`}
                        className="min-w-0 flex-1 text-[13px] font-medium text-content hover:text-brand"
                      >
                        {f.candidateName}
                        <span className="ml-2 font-normal text-content-subtle">
                          {f.subject || f.channel}
                        </span>
                      </Link>
                      <span
                        className={
                          f.overdue
                            ? "shrink-0 text-[11.5px] text-[hsl(var(--tone-rose))] tabular-nums"
                            : "shrink-0 text-[11.5px] text-content-subtle tabular-nums"
                        }
                      >
                        {formatDate(f.followUpAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {owedFeedback.length ? (
              <Card padded={false}>
                <div className="p-5 pb-4">
                  <CardHeader
                    icon={<Clock className="size-4" />}
                    title="Scorecards they owe"
                    description="Rounds they sat on where the feedback has not arrived."
                  />
                </div>
                <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {owedFeedback.map((f) => (
                    <li key={f.interviewId} className="flex items-center gap-3 px-5 py-3">
                      <Link
                        href={`/candidates/${f.candidateId}`}
                        className="min-w-0 flex-1 text-[13px] font-medium text-content hover:text-brand"
                      >
                        {f.firstName} {f.lastName}
                        <span className="ml-2 font-normal text-content-subtle">{f.title}</span>
                      </Link>
                      <span className="shrink-0 font-mono text-[11px] text-content-subtle">
                        {f.requisitionCode}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-content-subtle tabular-nums">
                        {formatDate(f.scheduledAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card padded={false}>
              <div className="p-5 pb-4">
                <CardHeader
                  icon={<Briefcase className="size-4" />}
                  title={member.role === "hiring_manager" ? "Requisitions they own" : "Requisitions they lead"}
                  description={`${pluralize(owned.length, "active requisition")} of ${
                    (member.role === "hiring_manager" ? managed : requisitions).length
                  } all time.`}
                />
              </div>

              {(member.role === "hiring_manager" ? managed : requisitions).length ? (
                <ul className="max-h-[30rem] divide-y divide-[hsl(var(--border))] overflow-y-auto border-t border-border-base">
                  {(member.role === "hiring_manager" ? managed : requisitions).map(
                    ({ requisition: r, clientName }) => {
                      const summary = summaries.get(r.id);
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
                              </div>
                              <p className="mt-0.5 text-[12px] text-content-muted">
                                {clientName} · {r.location} · opened {formatDate(r.openedAt)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <PriorityBadge value={r.priority} dot />
                              <ReqStatusBadge value={r.status} />
                              {summary ? <HealthBadge health={requisitionHealth(summary)} /> : null}
                            </div>
                          </div>
                          {summary ? (
                            <p className="mt-1.5 text-[11.5px] text-content-subtle tabular-nums">
                              {summary.activeCount} active · {summary.interviewCount} interviewing ·{" "}
                              {summary.filled}/{summary.openings} filled
                            </p>
                          ) : null}
                        </li>
                      );
                    },
                  )}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={<Briefcase className="size-5" />}
                  title="No requisitions assigned"
                />
              )}
            </Card>

            <Card padded={false}>
              <div className="p-5 pb-4">
                <CardHeader
                  icon={<CalendarDays className="size-4" />}
                  title="Interview panel history"
                  description={
                    upcoming.length
                      ? `${pluralize(upcoming.length, "round")} coming up.`
                      : "Most recent rounds first."
                  }
                />
              </div>

              {interviews.length ? (
                <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {interviews.map(({ interview: iv, candidate, requisition: r }) => (
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
                          {iv.title} · {r.code} · {formatDateTime(iv.scheduledAt)}
                        </p>
                      </div>
                      <InterviewStatusBadge value={iv.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={<CalendarDays className="size-5" />}
                  title="Has not sat on a panel yet"
                />
              )}
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Contact" />
              <div className="mt-4 space-y-2.5 text-[13px]">
                <a
                  href={`mailto:${user.email}`}
                  className="flex items-center gap-2.5 text-content hover:text-brand"
                >
                  <Mail className="size-4 shrink-0 text-content-subtle" />
                  <span className="truncate">{user.email}</span>
                </a>
                {user.phone ? (
                  <p className="flex items-center gap-2.5 text-content">
                    <Phone className="size-4 shrink-0 text-content-subtle" />
                    {user.phone}
                  </p>
                ) : null}
                <p className="flex items-center gap-2.5 text-content">
                  <Clock className="size-4 shrink-0 text-content-subtle" />
                  {user.timezone.replace("_", " ")}
                </p>
              </div>
            </Card>

            {member.capacity > 0 ? (
              <Card>
                <CardHeader
                  title="Capacity"
                  description={`${member.openReqs} open requisitions against a target of ${member.capacity}.`}
                />
                <Meter
                  className="mt-4"
                  value={Math.min(member.load, 100)}
                  height={8}
                  tone={member.load > 100 ? "rose" : member.load > 85 ? "amber" : "emerald"}
                  label="Capacity used"
                />
                <p className="mt-2 text-[12.5px] text-content-muted">
                  {member.load > 100
                    ? "Over target — consider redistributing a requisition."
                    : member.load > 85
                      ? "Close to target. Watch before assigning more."
                      : "Has room for more work."}
                </p>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Profile" />
              <MetaRow
                className="mt-4 grid-cols-2"
                items={[
                  { label: "Role", value: member.role.replace("_", " ") },
                  { label: "Department", value: user.department },
                  { label: "Joined", value: formatDate(user.joinedAt) },
                  {
                    label: "Avg rating given",
                    value: member.avgRatingGiven ? member.avgRatingGiven.toFixed(1) : "—",
                  },
                  { label: "Interviews run", value: String(member.interviewsRun) },
                  { label: "Feedback owed", value: String(member.feedbackOwed) },
                ]}
              />
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
