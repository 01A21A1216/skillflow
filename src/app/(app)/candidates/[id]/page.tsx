import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Briefcase,
  CalendarDays,
  GraduationCap,
  FileSignature,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
} from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { ActivityFeed } from "@/components/domain/activity-feed";
import {
  AvailabilityBadge,
  CandidateStatusBadge,
  InterviewStatusBadge,
  InterviewTypeBadge,
  MetaRow,
  OfferStatusBadge,
  OutcomeBadge,
  RecommendationBadge,
  SeniorityBadge,
  SkillChips,
  SourceBadge,
  StageBadge,
  SubmissionStatusBadge,
} from "@/components/domain/badges";
import { AttachmentPanel } from "@/components/domain/attachment-panel";
import { CommunicationLog } from "@/components/domain/communication-log";
import { DuplicatePanel } from "@/components/domain/duplicate-panel";
import { potentialDuplicates } from "@/server/queries/duplicates";
import { EditCandidateButton } from "@/components/domain/forms/candidate-form";
import { scorecardMap } from "@/server/queries/scorecards";
import { AddToPipelineButton, NoteComposer } from "@/components/domain/forms/pipeline-form";
import { NotesList } from "@/components/domain/notes-list";
import { RowActions } from "@/components/domain/pipeline-actions";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Meter, RatingStars } from "@/components/ui/misc";
import {
  RATE_BASIS,
  WORK_AUTHORIZATIONS,
  type RateBasis,
  type Stage,
} from "@/lib/domain";
import { average, formatDate, formatDateTime, formatMoney, formatMonth, pluralize } from "@/lib/utils";
import { candidateActivity } from "@/server/queries/dashboard";
import { candidateFacets, getCandidate } from "@/server/queries/candidates";
import { openRequisitionOptions } from "@/server/queries/pipeline";
import { can } from "@/server/authz";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getCandidate(id);
  return {
    title: detail ? `${detail.candidate.firstName} ${detail.candidate.lastName}` : "Candidate",
  };
}

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requirePermission("candidate.view.all");
  const detail = await getCandidate(id, actor);
  if (!detail) notFound();

  const {
    candidate: c,
    owner,
    submissions,
    interviews,
    feedback,
    offers,
    notes,
    education,
    experience,
    attachments,
    contacts,
  } = detail;
  const name = `${c.firstName} ${c.lastName}`;
  const activity = await candidateActivity(c.id, 25);
  const openReqs = await openRequisitionOptions(c.id);
  const facets = await candidateFacets();
  const scorecardsByTemplate = await scorecardMap();
  const duplicates = await potentialDuplicates({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    currentCompany: c.currentCompany,
    location: c.location,
    linkedinUrl: c.linkedinUrl,
  });

  const active = submissions.filter((s) => s.submission.status === "active");
  const hired = submissions.find((s) => s.submission.status === "hired");
  const auth = WORK_AUTHORIZATIONS.find((w) => w.value === c.workAuthorization)?.label;

  const ratings = feedback.map((f) => f.feedback.overall);
  const avgRating = ratings.length ? average(ratings) : null;

  // Scorecards are template-driven, so a candidate interviewed against two
  // requirements can carry two different sets of competencies. Averaging is
  // done per key over the scorecards that actually scored it, rather than
  // treating a missing competency as a zero.
  const competencyAverages = (() => {
    const totals = new Map<string, { label: string; sum: number; n: number }>();
    for (const f of feedback) {
      const card = scorecardsByTemplate[f.feedback.templateId ?? "__default__"];
      for (const [key, score] of Object.entries(f.feedback.scores ?? {})) {
        if (typeof score !== "number") continue;
        const label = card?.criteria.find((c) => c.key === key)?.label ?? key.replace(/_/g, " ");
        const entry = totals.get(key) ?? { label, sum: 0, n: 0 };
        entry.sum += score;
        entry.n += 1;
        totals.set(key, entry);
      }
    }
    return [...totals.entries()]
      .map(([key, t]) => ({ key, label: t.label, value: t.sum / t.n, samples: t.n }))
      .sort((a, b) => b.value - a.value);
  })();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Candidates", href: "/candidates" }, { label: name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={name} size="lg" />
            <span>{name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {c.currentTitle} at {c.currentCompany}
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {c.location}
            </span>
            <span aria-hidden>·</span>
            <span>{c.yearsExperience} years experience</span>
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <CandidateStatusBadge value={c.status} dot />
            <SeniorityBadge value={c.seniority} />
            <SourceBadge value={c.source} />
            {c.rating > 0 ? <RatingStars value={c.rating} /> : null}
            {c.tags.map((t) => (
              <span
                key={t}
                className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-content-muted"
              >
                #{t}
              </span>
            ))}
          </div>
        }
        actions={
          <>
            {can(actor, "candidate.edit") ? (
              <EditCandidateButton candidate={c} options={{ owners: facets.owners }} />
            ) : null}
            {can(actor, "submission.create") ? (
              <AddToPipelineButton
                candidateId={c.id}
                candidateName={name}
                requisitions={openReqs}
              />
            ) : null}
          </>
        }
      />

      <PageBody>
        <div className="grid gap-5 lg:grid-cols-3">
          {/* ---------------- Left column ---------------- */}
          <div className="space-y-5 lg:col-span-2">
            {/* Pipelines */}
            <Card padded={false}>
              <div className="p-5 pb-4">
                <CardHeader
                  icon={<Briefcase className="size-4" />}
                  title="Requisition pipelines"
                  description={
                    submissions.length
                      ? `${pluralize(active.length, "live pipeline")} of ${submissions.length} total.`
                      : "Not yet submitted to any requisition."
                  }
                />
              </div>

              {submissions.length ? (
                <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {submissions.map(({ submission: s, requisition: r, client }) => (
                    <li key={s.id} className="px-5 py-3.5">
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
                            {client.name} · {r.location} · added {formatDate(s.createdAt)}
                          </p>
                          {s.rejectionReason ? (
                            <p className="mt-1 text-[12px] text-[hsl(var(--tone-rose))]">
                              {s.rejectionReason}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <div className="flex items-center gap-1.5">
                            <StageBadge value={s.stage} />
                            <SubmissionStatusBadge value={s.status} />
                          </div>
                          <span className="text-[11.5px] text-content-subtle tabular-nums">
                            Match {s.matchScore}
                          </span>
                          {s.status === "hired" || !can(actor, "submission.move") ? null : (
                            <RowActions
                              submissionId={s.id}
                              candidateName={name}
                              requisitionTitle={r.title}
                              stage={s.stage as Stage}
                              status={s.status}
                            />
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={<Briefcase className="size-5" />}
                  title="Not in any pipeline"
                  description="Add them to an open requisition to start the process."
                />
              )}
            </Card>

            {/* Interviews */}
            <Card padded={false}>
              <div className="p-5 pb-4">
                <CardHeader
                  icon={<CalendarDays className="size-4" />}
                  title="Interview history"
                  description={
                    interviews.length
                      ? `${pluralize(interviews.length, "round")} across every requisition.`
                      : "No interviews yet."
                  }
                />
              </div>

              {interviews.length ? (
                <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {interviews.map(({ interview: iv, requisition: r }) => {
                    const fbs = feedback.filter((f) => f.feedback.interviewId === iv.id);
                    return (
                      <li key={iv.id} className="px-5 py-3.5">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-medium text-content">
                              Round {iv.round} · {iv.title}
                            </p>
                            <p className="mt-0.5 text-[12px] text-content-muted">
                              {r.code} · {formatDateTime(iv.scheduledAt)} · {iv.durationMinutes} min
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <InterviewTypeBadge value={iv.type} />
                            <InterviewStatusBadge value={iv.status} />
                            {iv.outcome !== "pending" ? <OutcomeBadge value={iv.outcome} /> : null}
                          </div>
                        </div>

                        {fbs.length ? (
                          <ul className="mt-3 space-y-2">
                            {fbs.map(({ feedback: f, interviewer }) => (
                              <li
                                key={f.id}
                                className="rounded-lg border border-border-base bg-surface-muted/40 p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <Avatar name={interviewer.name} size="xs" />
                                  <span className="text-[12px] font-medium text-content">
                                    {interviewer.name}
                                  </span>
                                  <RecommendationBadge value={f.recommendation} />
                                  <span className="ml-auto text-[11px] text-content-subtle tabular-nums">
                                    {f.overall}/5 overall
                                  </span>
                                </div>
                                {f.strengths ? (
                                  <p className="mt-2 text-[12.5px] leading-relaxed text-content">
                                    <span className="font-medium text-[hsl(var(--tone-emerald))]">
                                      Strengths.{" "}
                                    </span>
                                    {f.strengths}
                                  </p>
                                ) : null}
                                {f.concerns ? (
                                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-content">
                                    <span className="font-medium text-[hsl(var(--tone-amber))]">
                                      Concerns.{" "}
                                    </span>
                                    {f.concerns}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : iv.status === "completed" ? (
                          <p className="mt-2 text-[12px] text-[hsl(var(--tone-amber))]">
                            Feedback still outstanding from the panel.
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState compact icon={<CalendarDays className="size-5" />} title="No interviews yet" />
              )}
            </Card>

            <DuplicatePanel
              candidateId={c.id}
              candidateName={name}
              duplicates={duplicates}
              canMerge={can(actor, "candidate.merge")}
            />

            {/* Experience */}
            {experience.length ? (
              <Card padded={false}>
                <div className="p-5 pb-4">
                  <CardHeader
                    icon={<Briefcase className="size-4" />}
                    title="Experience"
                    description={`${pluralize(experience.length, "role")} on record.`}
                  />
                </div>
                <ol className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {experience.map((e) => (
                    <li key={e.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-[13.5px] font-medium text-content">
                          {e.title}
                          <span className="font-normal text-content-muted"> · {e.company}</span>
                        </p>
                        <p className="text-[11.5px] text-content-subtle tabular-nums">
                          {formatMonth(e.startedOn)} — {e.endedOn ? formatMonth(e.endedOn) : "present"}
                        </p>
                      </div>
                      {e.location ? (
                        <p className="mt-0.5 text-[11.5px] text-content-subtle">{e.location}</p>
                      ) : null}
                      {e.summary ? (
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-content-muted">
                          {e.summary}
                        </p>
                      ) : null}
                      {e.skills.length ? (
                        <div className="mt-2">
                          <SkillChips skills={e.skills} max={6} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </Card>
            ) : null}

            {/* Education */}
            {education.length ? (
              <Card padded={false}>
                <div className="p-5 pb-4">
                  <CardHeader icon={<GraduationCap className="size-4" />} title="Education" />
                </div>
                <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {education.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium text-content">
                          {e.qualification}
                          {e.field ? ` ${e.field}` : ""}
                        </p>
                        <p className="mt-0.5 text-[12px] text-content-muted">{e.institution}</p>
                      </div>
                      <p className="text-[11.5px] text-content-subtle tabular-nums">
                        {e.startYear ? `${e.startYear}–` : ""}
                        {e.endYear ?? ""}
                        {e.grade ? ` · ${e.grade}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <CommunicationLog
              candidateId={c.id}
              candidateName={name}
              entries={contacts}
              actorId={actor.id}
              canLog={can(actor, "note.create")}
              submissions={submissions.map(({ submission, requisition }) => ({
                id: submission.id,
                label: `${requisition.code} — ${requisition.title}`,
              }))}
            />

            {/* Resume and other files */}
            <AttachmentPanel
              entityType="candidate"
              entityId={c.id}
              attachments={attachments}
              canUpload={can(actor, "attachment.upload")}
              canDelete={can(actor, "attachment.delete")}
              kind="resume"
              title="Resume and documents"
              description="The CV the client sees, plus anything else worth keeping on file."
            />

            {/* Offers */}
            {offers.length ? (
              <Card padded={false}>
                <div className="p-5 pb-4">
                  <CardHeader
                    icon={<FileSignature className="size-4" />}
                    title="Offers"
                    description={`${pluralize(offers.length, "offer")} on record.`}
                  />
                </div>
                <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
                  {offers.map(({ offer: o, requisition: r }) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-content">{r.title}</p>
                        <p className="mt-0.5 text-[12px] text-content-muted">
                          {formatMoney(o.baseSalary)} base
                          {o.bonusPercent ? ` · ${o.bonusPercent}% bonus` : ""}
                          {o.signingBonus ? ` · ${formatMoney(o.signingBonus)} signing` : ""}
                          {o.startDate ? ` · starts ${formatDate(o.startDate)}` : ""}
                        </p>
                        {o.declineReason ? (
                          <p className="mt-1 text-[12px] text-[hsl(var(--tone-rose))]">
                            {o.declineReason}
                          </p>
                        ) : null}
                      </div>
                      <OfferStatusBadge value={o.status} />
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {/* Notes */}
            <Card>
              <CardHeader
                icon={<MessageSquare className="size-4" />}
                title="Notes"
                description="Everything the team has recorded about this person."
              />
              <div className="mt-4 space-y-4">
                <NoteComposer
                  entityType="candidate"
                  entityId={c.id}
                  placeholder="What came out of the last conversation?"
                />
                <NotesList notes={notes} />
              </div>
            </Card>
          </div>

          {/* ---------------- Right column ---------------- */}
          <div className="space-y-5">
            <Card>
              <CardHeader title="Contact" />
              <div className="mt-4 space-y-2.5 text-[13px]">
                <a
                  href={`mailto:${c.email}`}
                  className="flex items-center gap-2.5 text-content hover:text-brand"
                >
                  <Mail className="size-4 shrink-0 text-content-subtle" />
                  <span className="truncate">{c.email}</span>
                </a>
                {c.phone ? (
                  <a
                    href={`tel:${c.phone}`}
                    className="flex items-center gap-2.5 text-content hover:text-brand"
                  >
                    <Phone className="size-4 shrink-0 text-content-subtle" />
                    {c.phone}
                  </a>
                ) : null}
                {c.linkedinUrl ? (
                  <a
                    href={c.linkedinUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-2.5 text-content hover:text-brand"
                  >
                    <Link2 className="size-4 shrink-0 text-content-subtle" />
                    <span className="truncate">LinkedIn profile</span>
                  </a>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHeader title="Profile" />
              <MetaRow
                className="mt-4 grid-cols-2"
                items={[
                  { label: "Owner", value: owner.name },
                  { label: "Experience", value: `${c.yearsExperience} years` },
                  {
                    label: "Current salary",
                    value: formatMoney(c.currentSalary, c.currency, { compact: true }),
                  },
                  {
                    label: "Expectation",
                    value: formatMoney(c.expectedSalary, c.currency, { compact: true }),
                  },
                  {
                    label: "Notice",
                    value: c.noticePeriodDays ? `${c.noticePeriodDays} days` : "Immediate",
                  },
                  {
                    label: "Availability",
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <AvailabilityBadge value={c.availability} size="sm" />
                        {c.availableFrom ? (
                          <span className="text-content-subtle">from {formatDate(c.availableFrom)}</span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    label: "Primary technology",
                    value: c.primaryTechnology || "—",
                  },
                  {
                    label: "Contract rate",
                    value: c.expectedRate
                      ? `${formatMoney(c.expectedRate, c.currency)} ${RATE_BASIS[c.rateBasis as RateBasis]?.label ?? ""}`
                      : "Not quoted",
                  },
                  { label: "Relocation", value: c.willingToRelocate ? "Open" : "In-market only" },
                  {
                    label: "Work authorization",
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck className="size-3.5 text-content-subtle" />
                        {auth}
                      </span>
                    ),
                  },
                  { label: "In system", value: `${detail.daysInSystem} days` },
                ]}
              />

              {c.summary ? (
                <p className="mt-4 border-t border-border-base pt-4 text-[13px] leading-relaxed text-content-muted">
                  {c.summary}
                </p>
              ) : null}

              <div className="mt-4 border-t border-border-base pt-4">
                <p className="mb-2 text-[10.5px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
                  Skills
                </p>
                <SkillChips skills={c.skills} max={20} />
              </div>
            </Card>

            {feedback.length ? (
              <Card>
                <CardHeader
                  title="Interview scorecard"
                  description={`Averaged across ${pluralize(feedback.length, "submitted scorecard")}.`}
                />
                <div className="mt-4 space-y-3">
                  {competencyAverages.map((comp) => (
                    <div key={comp.key}>
                      <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                        <span className="text-content-muted">{comp.label}</span>
                        <span className="font-medium text-content tabular-nums">
                          {comp.value.toFixed(1)}
                        </span>
                      </div>
                      <Meter
                        value={comp.value}
                        max={5}
                        tone={comp.value >= 4 ? "emerald" : comp.value >= 3 ? "blue" : "amber"}
                        label={comp.label}
                      />
                    </div>
                  ))}
                  {avgRating !== null ? (
                    <p className="border-t border-border-base pt-3 text-[12.5px] text-content-muted">
                      Overall average{" "}
                      <span className="font-semibold text-content tabular-nums">
                        {avgRating.toFixed(1)}
                      </span>{" "}
                      out of 5.
                    </p>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {hired ? (
              <Card className="border-[hsl(var(--tone-emerald)/0.4)] bg-[hsl(var(--tone-emerald-bg)/0.35)]">
                <CardHeader
                  title="Placed"
                  description={`Hired into ${hired.requisition.title} at ${hired.client.name}.`}
                />
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Timeline" />
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
