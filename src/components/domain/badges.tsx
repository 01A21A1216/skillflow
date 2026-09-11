import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from "lucide-react";

import {
  AVAILABILITY,
  CANDIDATE_STATUS,
  ACTIVITY_TYPES,
  CLIENT_TIER,
  FEEDBACK_STATUS,
  EMPLOYMENT_TYPE,
  INTERVIEW_MODE,
  INTERVIEW_STATUS,
  INTERVIEW_TYPE,
  OFFER_STATUS,
  OUTCOME,
  PRIORITY,
  RECOMMENDATION,
  REQUISITION_SOURCE,
  REQ_STATUS,
  SENIORITY,
  SOURCE,
  STAGE_KIND,
  SUBMISSION_STATUS,
  USER_ROLE,
  WORK_AUTHORIZATION,
  WORK_MODE,
  type Tone,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toneVars } from "@/components/ui/tone";

type AnyMeta = Record<string, { label: string; tone: Tone } | undefined>;

function metaBadge(map: AnyMeta, fallbackTone: Tone = "neutral") {
  return function MetaBadge({
    value,
    dot,
    size,
    variant,
    className,
  }: {
    value: string;
    dot?: boolean;
    size?: "sm" | "md";
    variant?: "soft" | "outline" | "solid";
    className?: string;
  }) {
    const meta = map[value];
    return (
      <Badge
        tone={meta?.tone ?? fallbackTone}
        dot={dot}
        size={size}
        variant={variant}
        className={className}
      >
        {meta?.label ?? value.replace(/_/g, " ")}
      </Badge>
    );
  };
}

export const SubmissionStatusBadge = metaBadge(SUBMISSION_STATUS as AnyMeta);
export const StageKindBadge = metaBadge(STAGE_KIND as AnyMeta);
export const ReqStatusBadge = metaBadge(REQ_STATUS as AnyMeta);
export const PriorityBadge = metaBadge(PRIORITY as AnyMeta);
export const EmploymentBadge = metaBadge(EMPLOYMENT_TYPE as AnyMeta);
export const WorkModeBadge = metaBadge(WORK_MODE as AnyMeta);
export const WorkAuthBadge = metaBadge(WORK_AUTHORIZATION as AnyMeta);
export const SeniorityBadge = metaBadge(SENIORITY as AnyMeta);
export const CandidateStatusBadge = metaBadge(CANDIDATE_STATUS as AnyMeta);
export const AvailabilityBadge = metaBadge(AVAILABILITY as AnyMeta);
export const RequisitionSourceBadge = metaBadge(REQUISITION_SOURCE as AnyMeta);
export const FeedbackStatusBadge = metaBadge(FEEDBACK_STATUS as AnyMeta);
export const SourceBadge = metaBadge(SOURCE as AnyMeta);
export const InterviewTypeBadge = metaBadge(INTERVIEW_TYPE as AnyMeta);
export const InterviewStatusBadge = metaBadge(INTERVIEW_STATUS as AnyMeta);
export const InterviewModeBadge = metaBadge(INTERVIEW_MODE as AnyMeta);
export const OutcomeBadge = metaBadge(OUTCOME as AnyMeta);
export const RecommendationBadge = metaBadge(RECOMMENDATION as AnyMeta);
export const OfferStatusBadge = metaBadge(OFFER_STATUS as AnyMeta);
export const RoleBadge = metaBadge(USER_ROLE as AnyMeta);
export const ClientTierBadge = metaBadge(CLIENT_TIER as AnyMeta);
export const ActivityTypeBadge = metaBadge(ACTIVITY_TYPES as AnyMeta);

/** Health pill for a requisition, with the reason as its tooltip. */
export function HealthBadge({
  health,
  showReason = false,
}: {
  health: { key: string; label: string; tone: Tone; reason: string };
  showReason?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2" title={health.reason}>
      <Badge tone={health.tone} dot>
        {health.label}
      </Badge>
      {showReason ? (
        <span className="truncate text-[12px] text-content-muted">{health.reason}</span>
      ) : null}
    </span>
  );
}

/** Days-in-stage chip that turns amber then rose as it passes the SLA. */
export function AgeChip({
  days,
  sla,
  className,
}: {
  days: number;
  sla: number;
  className?: string;
}) {
  const over = sla > 0 && days > sla;
  const badlyOver = sla > 0 && days > sla * 2;
  const tone: Tone = badlyOver ? "rose" : over ? "amber" : "slate";

  return (
    <span
      style={toneVars(tone)}
      title={over ? `${days} days in stage — target is ${sla}` : `${days} days in stage`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        over ? "tone-chip" : "bg-surface-muted text-content-subtle",
        className,
      )}
    >
      {over ? <AlertTriangle className="size-3" /> : null}
      {days}d
    </span>
  );
}

/** Signed delta with direction-aware colouring. */
export function Delta({
  value,
  suffix = "%",
  goodWhenUp = true,
  className,
}: {
  value: number | undefined;
  suffix?: string;
  goodWhenUp?: boolean;
  className?: string;
}) {
  if (value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const flat = rounded === 0;
  const up = rounded > 0;
  const good = flat ? false : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums",
        flat
          ? "text-content-subtle"
          : good
            ? "text-[hsl(var(--tone-emerald))]"
            : "text-[hsl(var(--tone-rose))]",
        className,
      )}
    >
      <Icon className="size-3" />
      {Math.abs(rounded)}
      {suffix}
    </span>
  );
}

export function SkillChips({
  skills,
  max = 4,
  matched,
  className,
}: {
  skills: string[];
  max?: number;
  /** Skills to highlight, typically the requisition's must-haves. */
  matched?: string[];
  className?: string;
}) {
  const matchSet = new Set((matched ?? []).map((s) => s.toLowerCase()));
  const shown = skills.slice(0, max);
  const rest = skills.length - shown.length;

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((s) => {
        const hit = matchSet.has(s.toLowerCase());
        return (
          <span
            key={s}
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] whitespace-nowrap",
              hit
                ? "bg-[hsl(var(--tone-emerald-bg))] font-medium text-[hsl(var(--tone-emerald))]"
                : "bg-surface-muted text-content-muted",
            )}
          >
            {s}
          </span>
        );
      })}
      {rest > 0 ? (
        <span className="text-[11px] text-content-subtle" title={skills.slice(max).join(", ")}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

export function MetaRow({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[10.5px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
            {i.label}
          </dt>
          <dd className="mt-0.5 truncate text-[13px] text-content">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A stage's label and tone are configuration, so its badge lives with the
// provider that supplies them.
export { StageBadge } from "./pipeline-context";
