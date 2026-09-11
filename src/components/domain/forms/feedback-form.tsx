"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { DEFAULT_COMPETENCIES, RECOMMENDATIONS } from "@/lib/domain";
import type { Criterion } from "@/server/queries/scorecards";
import { cn } from "@/lib/utils";
import { submitFeedback } from "@/server/actions/interviews";
import { Field, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "./form-shell";

/**
 * Scorecards available to whatever is on screen, keyed by template id.
 *
 * Cards live several levels inside a list, and every requirement on that list
 * may use a different template, so the page loads the handful of templates once
 * and each card looks up its own rather than fetching per row.
 */
const ScorecardContext = createContext<Record<string, Scorecard>>({});

export function ScorecardProvider({
  value,
  children,
}: {
  value: Record<string, Scorecard>;
  children: ReactNode;
}) {
  return <ScorecardContext.Provider value={value}>{children}</ScorecardContext.Provider>;
}

/** Falls back to the built-in six, so a panel is never shown an empty card. */
export function useScorecard(templateId: string | null): Scorecard {
  const all = useContext(ScorecardContext);
  return (
    (templateId ? all[templateId] : undefined) ??
    all.__default__ ?? {
      name: "Scorecard",
      criteria: DEFAULT_COMPETENCIES.map((c) => ({ ...c })),
    }
  );
}

const SCALE = [1, 2, 3, 4, 5];
interface Scorecard {
  name: string;
  criteria: Criterion[];
}

const SCALE_HINT: Record<number, string> = {
  1: "Well below the bar",
  2: "Below the bar",
  3: "Meets the bar",
  4: "Above the bar",
  5: "Exceptional",
};

function RatingRow({
  name,
  label,
  hint,
  defaultValue = 3,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-[13px] text-content">{label}</span>
        {hint ? <span className="block text-[11.5px] text-content-subtle">{hint}</span> : null}
      </span>
      <input type="hidden" name={name} value={value} />
      <div className="flex shrink-0 items-center gap-1" role="radiogroup" aria-label={label}>
        {SCALE.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            title={SCALE_HINT[n]}
            onClick={() => setValue(n)}
            className={cn(
              "size-8 rounded-lg border text-[13px] font-medium transition-colors",
              value === n
                ? "border-brand bg-brand text-brand-contrast"
                : "border-border-strong text-content-muted hover:bg-surface-muted",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FeedbackModal({
  open,
  onClose,
  interviewId,
  interviewTitle,
  candidateName,
  panel,
  defaultInterviewerId,
  scorecard,
}: {
  open: boolean;
  onClose: () => void;
  interviewId: string;
  interviewTitle: string;
  candidateName: string;
  panel: { id: string; name: string; hasFeedback: boolean }[];
  defaultInterviewerId?: string;
  /** The competencies this requirement's panels score against (§11). */
  scorecard: Scorecard;
}) {
  const router = useRouter();
  const pending = panel.filter((p) => !p.hasFeedback);

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="Submit interview feedback"
      description={`${interviewTitle} with ${candidateName}`}
      action={submitFeedback}
      submitLabel="Submit feedback"
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="interviewId" value={interviewId} />

          <Field
            label="Submitting as"
            hint="Only people on the panel can leave a scorecard."
            error={errors.interviewerId}
          >
            <Select
              name="interviewerId"
              defaultValue={defaultInterviewerId ?? pending[0]?.id ?? panel[0]?.id}
              required
            >
              {panel.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.hasFeedback ? " (already submitted — will be revised)" : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Recommendation" required error={errors.recommendation}>
            <Select name="recommendation" defaultValue="hire">
              {RECOMMENDATIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset className="space-y-3 rounded-lg border border-border-base p-3.5">
            <legend className="px-1 text-[11px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
              {scorecard.name}
            </legend>
            <RatingRow name="overall" label="Overall" defaultValue={4} />
            {scorecard.criteria.map((c) => (
              // `scores.` prefixed, so the action receives one map rather than a
              // column per competency — which is what makes the card editable.
              <RatingRow
                key={c.key}
                name={`scores.${c.key}`}
                label={c.label}
                hint={c.description}
              />
            ))}
            <p className="pt-1 text-[11.5px] text-content-subtle">
              3 means the candidate meets the bar for this level.
            </p>
          </fieldset>

          <Field label="Strengths" error={errors.strengths}>
            <Textarea
              name="strengths"
              placeholder="Specific evidence, not impressions — what did they actually demonstrate?"
            />
          </Field>

          <Field label="Concerns" error={errors.concerns}>
            <Textarea name="concerns" placeholder="Gaps, risks, or what you would want probed next." />
          </Field>

          <Field label="Notes" error={errors.notes}>
            <Textarea name="notes" placeholder="Anything else the hiring panel should weigh." />
          </Field>

          <p className="text-[12px] text-content-subtle">
            Once every panelist has submitted, the round outcome is settled automatically from the
            balance of recommendations.
          </p>
        </>
      )}
    </FormModal>
  );
}
