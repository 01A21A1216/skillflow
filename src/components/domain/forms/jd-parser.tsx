"use client";

import { useActionState, useState } from "react";
import { FileText, Sparkles, Wand2 } from "lucide-react";

import type { ParsedRequirement } from "@/server/ai/provider";
import { parseJd, type JdParseState } from "@/server/actions/jd";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { RequisitionFormModal, type RequisitionFormOptions } from "./requisition-form";

const INITIAL: JdParseState = { ok: false };

/** Below this, a value is offered as a suggestion rather than filled in. */
const TRUSTED = 0.7;

function Confidence({ value }: { value: number }) {
  if (value === 0) return <Badge tone="slate" size="sm" variant="outline">not found</Badge>;
  if (value >= TRUSTED) return <Badge tone="emerald" size="sm">confident</Badge>;
  return <Badge tone="amber" size="sm">check this</Badge>;
}

function Row({
  label,
  value,
  confidence,
  evidence,
}: {
  label: string;
  value: string;
  confidence: number;
  evidence: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border-base py-2 last:border-0">
      <span className="w-40 shrink-0 text-[11.5px] font-medium text-content-subtle">{label}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-content">{value || "—"}</span>
        {evidence ? (
          <span className="mt-0.5 block text-[11px] text-content-subtle italic">
            from “{evidence}”
          </span>
        ) : null}
      </span>
      <Confidence value={confidence} />
    </div>
  );
}

/**
 * Paste a job description, review what was read out of it, then create the
 * requirement (§17).
 *
 * The review step is the point. Every field shows its confidence and the text
 * it came from, so a recruiter can see what the parser was looking at rather
 * than being asked to trust it. Nothing is written until they submit the
 * ordinary requirement form, pre-filled.
 */
export function JdParserModal({
  open,
  onClose,
  options,
}: {
  open: boolean;
  onClose: () => void;
  options: RequisitionFormOptions;
}) {
  const [state, formAction, pending] = useActionState(parseJd, INITIAL);
  const [reviewing, setReviewing] = useState(false);

  const parsed = state.parsed;

  return (
    <>
      <Modal
        open={open && !reviewing}
        onClose={onClose}
        size="lg"
        title="Create from a job description"
        description="Paste what the client sent. Nothing is saved until you review it."
        footer={
          <>
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            {parsed ? (
              <Button variant="primary" size="sm" onClick={() => setReviewing(true)}>
                <Wand2 className="size-4" />
                Use this
              </Button>
            ) : (
              <Button variant="primary" size="sm" type="submit" form="jd-form" loading={pending}>
                <Sparkles className="size-4" />
                Read it
              </Button>
            )}
          </>
        }
      >
        <form id="jd-form" action={formAction} className="space-y-4">
          <Field
            label="Job description"
            hint="Paste the whole thing — headings and bullets help a lot."
            error={state.ok ? undefined : state.message}
          >
            <Textarea
              name="text"
              rows={12}
              required
              placeholder={"Job Title: Senior Oracle EBS Consultant\n\nLocation: Austin, TX\nRate: $95 - $115 per hour\n\nRequired skills:\n- Oracle EBS R12\n- PL/SQL\n\nNice to have:\n- BI Publisher"}
            />
          </Field>

          {parsed ? (
            <div className="rounded-lg border border-border-base p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
                <FileText className="size-3.5" />
                What was read
              </p>

              <Row label="Job title" value={parsed.title.value} confidence={parsed.title.confidence} evidence={parsed.title.evidence} />
              <Row
                label="Must-have skills"
                value={parsed.requiredSkills.value.join(", ")}
                confidence={parsed.requiredSkills.confidence}
                evidence={parsed.requiredSkills.evidence}
              />
              <Row
                label="Nice to have"
                value={parsed.preferredSkills.value.join(", ")}
                confidence={parsed.preferredSkills.confidence}
                evidence={parsed.preferredSkills.evidence}
              />
              <Row
                label="Experience"
                value={`${parsed.experienceMin.value}–${parsed.experienceMax.value} years`}
                confidence={Math.min(parsed.experienceMin.confidence, parsed.experienceMax.confidence)}
                evidence={parsed.experienceMin.evidence}
              />
              <Row label="Location" value={parsed.location.value} confidence={parsed.location.confidence} evidence={parsed.location.evidence} />
              <Row label="Work mode" value={parsed.workMode.value} confidence={parsed.workMode.confidence} evidence={parsed.workMode.evidence} />
              <Row label="Engagement" value={parsed.employmentType.value} confidence={parsed.employmentType.confidence} evidence={parsed.employmentType.evidence} />
              <Row
                label="Work authorization"
                value={parsed.workAuthorization.value.join(", ")}
                confidence={parsed.workAuthorization.confidence}
                evidence={parsed.workAuthorization.evidence}
              />
              <Row
                label="Rate"
                value={parsed.billRateMin.value ? `$${parsed.billRateMin.value}–${parsed.billRateMax.value}/hr` : ""}
                confidence={parsed.billRateMin.confidence}
                evidence={parsed.billRateMin.evidence}
              />
              <Row
                label="Salary"
                value={parsed.minSalary.value ? `${parsed.minSalary.value}–${parsed.maxSalary.value}` : ""}
                confidence={parsed.minSalary.confidence}
                evidence={parsed.minSalary.evidence}
              />
              <Row label="Priority" value={parsed.priority.value} confidence={parsed.priority.confidence} evidence={parsed.priority.evidence} />

              {parsed.unmatched.length ? (
                <p className="mt-3 text-[11.5px] leading-relaxed text-content-subtle">
                  <span className="font-medium text-content">Not recognised:</span>{" "}
                  {parsed.unmatched.join(", ")}. Add any of these by hand — they are shown rather
                  than dropped because an unfamiliar skill is usually a real one.
                </p>
              ) : null}

              <p className="mt-3 border-t border-border-base pt-2.5 text-[11px] text-content-subtle">
                Read locally by the <strong>{state.providerName}</strong> parser
                {state.external ? " — this text was sent to an external service." : ", so nothing left this system."}{" "}
                Everything above is editable on the next screen; nothing has been saved.
              </p>
            </div>
          ) : null}
        </form>
      </Modal>

      {/* The ordinary requirement form, pre-filled. A parse is a head start,
          not a separate way of creating a record. */}
      {reviewing && parsed ? (
        <RequisitionFormModal
          open
          onClose={() => {
            setReviewing(false);
            onClose();
          }}
          options={options}
          prefill={toPrefill(parsed)}
        />
      ) : null}
    </>
  );
}

/** Only fields the parser was confident about are pre-filled. */
function toPrefill(parsed: ParsedRequirement) {
  const take = <T,>(f: { value: T; confidence: number }, fallback: T) =>
    f.confidence >= TRUSTED ? f.value : fallback;

  return {
    title: take(parsed.title, ""),
    requiredSkills: parsed.requiredSkills.value,
    preferredSkills: parsed.preferredSkills.value,
    experienceMin: take(parsed.experienceMin, 0),
    experienceMax: take(parsed.experienceMax, 10),
    location: take(parsed.location, ""),
    workMode: take(parsed.workMode, "hybrid"),
    employmentType: take(parsed.employmentType, "full_time"),
    visaRequirements: parsed.workAuthorization.value,
    minSalary: take(parsed.minSalary, null),
    maxSalary: take(parsed.maxSalary, null),
    priority: take(parsed.priority, "medium"),
    description: parsed.interviewProcess.value,
  };
}
