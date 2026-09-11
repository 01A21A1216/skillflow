"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, MapPin, MoreHorizontal, ThumbsUp, Video, X } from "lucide-react";

import type { InterviewRow } from "@/server/queries/interviews";
import { PENDING_INTERVIEW_STATUSES, type InterviewStatus } from "@/lib/domain";
import { cancelInterview } from "@/server/actions/interviews";
import { cn, formatDate, formatTime } from "@/lib/utils";
import { useIsHydrated } from "@/lib/browser-store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import {
  InterviewModeBadge,
  InterviewStatusBadge,
  InterviewTypeBadge,
  OutcomeBadge,
} from "./badges";
import { FeedbackModal, useScorecard } from "./forms/feedback-form";

export function InterviewDayGroups({
  groups,
  focusId,
  today,
}: {
  groups: { date: string; items: InterviewRow[] }[];
  focusId?: string;
  /** yyyy-mm-dd from the server, so "Today" does not depend on the client clock. */
  today: string;
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const date = new Date(`${group.date}T12:00:00`);
        const isToday = group.date === today;
        const totalMinutes = group.items.reduce((s, i) => s + i.durationMinutes, 0);

        return (
          <section key={group.date}>
            <header className="mb-2 flex items-baseline gap-3">
              <h2
                className={cn(
                  "text-[13px] font-semibold",
                  isToday ? "text-brand" : "text-content",
                )}
              >
                {isToday ? "Today" : date.toLocaleDateString("en-US", { weekday: "long" })}
                <span className="ml-2 font-normal text-content-subtle">
                  {formatDate(date)}
                </span>
              </h2>
              <span className="text-[11.5px] text-content-subtle tabular-nums">
                {group.items.length} interview{group.items.length === 1 ? "" : "s"} ·{" "}
                {Math.round((totalMinutes / 60) * 10) / 10}h
              </span>
            </header>

            <ul className="space-y-2">
              {group.items.map((iv) => (
                <InterviewRowCard key={iv.id} interview={iv} highlight={iv.id === focusId} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Names the zone a round was booked in, but only when it is not the viewer's.
 *
 * The time above is rendered in the reader's own zone, which is right for them
 * and silently wrong for a panel spread across continents — "9:00" means a very
 * different morning in Austin and Bangalore. Reading the viewer's zone is a
 * browser-only fact, so it renders after hydration rather than guessing on the
 * server and mismatching.
 */
function TimezoneNote({ scheduledAt, timezone }: { scheduledAt: Date; timezone: string }) {
  const hydrated = useIsHydrated();
  if (!hydrated) return null;

  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!viewerZone || viewerZone === timezone) return null;

  const there = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(scheduledAt);

  const label = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;

  return (
    <p className="mt-1 text-[10.5px] text-content-subtle" title={`Booked in ${timezone}`}>
      {there} in {label}
    </p>
  );
}

export function InterviewRowCard({
  interview: iv,
  highlight = false,
}: {
  interview: InterviewRow;
  highlight?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const missing = iv.outstandingFeedback;
  const needsFeedback = iv.status === "completed" && missing > 0;
  const upcoming = iv.isUpcoming;
  const scorecard = useScorecard(iv.scorecardTemplateId);

  async function doCancel() {
    setCancelling(true);
    const fd = new FormData();
    fd.set("interviewId", iv.id);
    const result = await cancelInterview({ ok: false }, fd);
    setCancelling(false);
    toast(
      result.ok
        ? { kind: "success", title: "Interview cancelled" }
        : { kind: "error", title: "Could not cancel", description: result.message },
    );
    router.refresh();
  }

  return (
    <li
      className={cn(
        "card p-4 transition-shadow hover:shadow-[var(--shadow-raised)]",
        highlight && "ring-2 ring-brand/50",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {/* Time block */}
        <div className="w-[5.5rem] shrink-0">
          <p className="text-[15px] leading-none font-semibold text-content tabular-nums">
            {formatTime(iv.scheduledAt)}
          </p>
          <p className="mt-1 text-[11px] text-content-subtle tabular-nums">
            to {formatTime(iv.endsAt)}
          </p>
          {/* The zone the round was booked in. Shown only when it differs from
              the viewer's, because that is the only time it tells them
              anything — and the only time the time above can mislead. */}
          <TimezoneNote scheduledAt={iv.scheduledAt} timezone={iv.timezone} />
        </div>

        {/* Main */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/candidates/${iv.candidateId}`}
              className="text-[14px] font-medium text-content hover:text-brand"
            >
              {iv.candidateName}
            </Link>
            <span className="text-[12px] text-content-subtle">· {iv.candidateTitle}</span>
          </div>

          <p className="mt-1 text-[12.5px] text-content-muted">
            Round {iv.round} · {iv.title} ·{" "}
            <Link href={`/requisitions/${iv.requisitionId}`} className="hover:text-brand">
              {iv.requisitionCode} {iv.requisitionTitle}
            </Link>
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <InterviewTypeBadge value={iv.type} />
            <InterviewModeBadge value={iv.mode} />
            <InterviewStatusBadge value={iv.status} />
            {iv.outcome !== "pending" ? <OutcomeBadge value={iv.outcome} /> : null}
            {needsFeedback ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  iv.overdueBucket
                    ? "bg-[hsl(var(--tone-rose-bg))] text-[hsl(var(--tone-rose))]"
                    : "bg-[hsl(var(--tone-amber-bg))] text-[hsl(var(--tone-amber))]",
                )}
                title={
                  iv.feedbackDueAt
                    ? `Due ${iv.feedbackDueAt.toLocaleString()}`
                    : "No due date recorded"
                }
              >
                <Clock className="size-3" />
                {missing} scorecard{missing === 1 ? "" : "s"}{" "}
                {iv.overdueBucket ? `${Math.round(iv.hoursLate)}h overdue` : "outstanding"}
              </span>
            ) : null}
          </div>

          {iv.locationOrLink ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-content-subtle">
              {iv.mode === "onsite" ? (
                <MapPin className="size-3 shrink-0" />
              ) : (
                <Video className="size-3 shrink-0" />
              )}
              <span className="truncate">{iv.locationOrLink}</span>
            </p>
          ) : null}
        </div>

        {/* Panel */}
        <div className="w-44 shrink-0">
          <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
            Panel
          </p>
          <ul className="space-y-1">
            {iv.panel.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <Avatar name={p.name} size="xs" />
                <span className="truncate text-[11.5px] text-content-muted">{p.name}</span>
                {iv.status === "completed" ? (
                  <span
                    className={cn(
                      "ml-auto size-1.5 shrink-0 rounded-full",
                      p.hasFeedback
                        ? "bg-[hsl(var(--tone-emerald))]"
                        : "bg-[hsl(var(--tone-amber))]",
                    )}
                    title={p.hasFeedback ? "Feedback submitted" : "Feedback outstanding"}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {iv.status !== "cancelled" ? (
            <Button
              size="xs"
              variant={needsFeedback ? "primary" : "secondary"}
              onClick={() => setFeedbackOpen(true)}
            >
              <ThumbsUp className="size-3.5" />
              {needsFeedback ? "Add feedback" : "Feedback"}
            </Button>
          ) : null}

          <Menu
            align="right"
            trigger={
              <button
                className="rounded-lg p-1.5 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
                aria-label={`Actions for ${iv.candidateName}`}
              >
                <MoreHorizontal className="size-4" />
              </button>
            }
          >
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    close();
                    router.push(`/candidates/${iv.candidateId}`);
                  }}
                >
                  Open candidate
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    router.push(`/requisitions/${iv.requisitionId}`);
                  }}
                >
                  Open requisition
                </MenuItem>
                {upcoming && PENDING_INTERVIEW_STATUSES.includes(iv.status as InterviewStatus) ? (
                  <MenuItem
                    danger
                    disabled={cancelling}
                    icon={<X className="size-3.5" />}
                    onClick={() => {
                      close();
                      void doCancel();
                    }}
                  >
                    Cancel interview
                  </MenuItem>
                ) : null}
              </>
            )}
          </Menu>
        </div>
      </div>

      {iv.agenda ? (
        <p className="mt-3 border-t border-border-base pt-3 text-[12px] leading-relaxed text-content-muted">
          {iv.agenda}
        </p>
      ) : null}

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        interviewId={iv.id}
        interviewTitle={iv.title}
        candidateName={iv.candidateName}
        panel={iv.panel}
        scorecard={scorecard}
      />
    </li>
  );
}
