"use client";

import { useActionState, useRef, useState } from "react";
import { FileText, Sparkles, Upload, Wand2 } from "lucide-react";

import type { ParsedResume } from "@/lib/resume-parse";
import { parseResumeAction, type ResumeParseState } from "@/server/actions/resume";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { CandidateFormModal, type CandidateFormOptions } from "./candidate-form";

const INITIAL: ResumeParseState = { ok: false };
const TRUSTED = 0.7;

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
      <span className="w-36 shrink-0 text-[11.5px] font-medium text-content-subtle">{label}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-content">{value || "—"}</span>
        {evidence && confidence > 0 ? (
          <span className="mt-0.5 block text-[11px] text-content-subtle italic">{evidence}</span>
        ) : null}
      </span>
      {confidence === 0 ? (
        <Badge tone="slate" size="sm" variant="outline">
          not found
        </Badge>
      ) : confidence >= TRUSTED ? (
        <Badge tone="emerald" size="sm">
          confident
        </Badge>
      ) : (
        <Badge tone="amber" size="sm">
          check this
        </Badge>
      )}
    </div>
  );
}

/**
 * Read a resume into a candidate record (§6).
 *
 * Upload or paste; see what was read and how sure the parser is; then create
 * the candidate through the ordinary form, pre-filled. Only fields the parser
 * was confident about are filled in — a "check this" value is shown but left
 * out, because a wrong value somebody accepts without reading is worse than a
 * blank one they have to fill.
 */
export function ResumeParserModal({
  open,
  onClose,
  options,
}: {
  open: boolean;
  onClose: () => void;
  options: CandidateFormOptions;
}) {
  const [state, formAction, pending] = useActionState(parseResumeAction, INITIAL);
  const [reviewing, setReviewing] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = state.parsed;

  return (
    <>
      <Modal
        open={open && !reviewing}
        onClose={onClose}
        size="lg"
        title="Add a candidate from a resume"
        description="Upload a PDF or paste the text. Nothing is saved until you review it."
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
              <Button variant="primary" size="sm" type="submit" form="resume-form" loading={pending}>
                <Sparkles className="size-4" />
                Read it
              </Button>
            )}
          </>
        }
      >
        <form id="resume-form" action={formAction} className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept=".pdf,.txt,.md"
              className="hidden"
              onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
            />
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-3.5" />
              Choose a file
            </Button>
            <span className="text-[12.5px] text-content-subtle">
              {filename ?? "PDF, or paste the text below"}
            </span>
          </div>

          <Field
            label="Or paste the resume"
            hint="Word documents cannot be read automatically — open and copy the text."
            error={state.ok ? undefined : state.message}
          >
            <Textarea name="text" rows={10} placeholder="Paste the resume text here…" />
          </Field>

          {parsed ? (
            <div className="rounded-lg border border-border-base p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
                <FileText className="size-3.5" />
                What was read
              </p>

              <Row label="Name" value={`${parsed.firstName.value} ${parsed.lastName.value}`.trim()} confidence={parsed.firstName.confidence} evidence={parsed.firstName.evidence} />
              <Row label="Email" value={parsed.email.value} confidence={parsed.email.confidence} evidence={parsed.email.evidence} />
              <Row label="Phone" value={parsed.phone.value} confidence={parsed.phone.confidence} evidence={parsed.phone.evidence} />
              <Row label="Location" value={parsed.location.value} confidence={parsed.location.confidence} evidence={parsed.location.evidence} />
              <Row label="LinkedIn" value={parsed.linkedinUrl.value} confidence={parsed.linkedinUrl.confidence} evidence="" />
              <Row label="Current title" value={parsed.currentTitle.value} confidence={parsed.currentTitle.confidence} evidence={parsed.currentTitle.evidence} />
              <Row label="Current employer" value={parsed.currentCompany.value} confidence={parsed.currentCompany.confidence} evidence={parsed.currentCompany.evidence} />
              <Row label="Experience" value={parsed.yearsExperience.value ? `${parsed.yearsExperience.value} years` : ""} confidence={parsed.yearsExperience.confidence} evidence={parsed.yearsExperience.evidence} />
              <Row label="Skills" value={parsed.skills.value.join(", ")} confidence={parsed.skills.confidence} evidence={parsed.skills.evidence} />
              <Row label="Work authorization" value={parsed.workAuthorization.value} confidence={parsed.workAuthorization.confidence} evidence={parsed.workAuthorization.evidence} />
              <Row label="Availability" value={parsed.availability.value} confidence={parsed.availability.confidence} evidence={parsed.availability.evidence} />

              {parsed.unmatched.length ? (
                <p className="mt-3 text-[11.5px] leading-relaxed text-content-subtle">
                  <span className="font-medium text-content">Not recognised:</span>{" "}
                  {parsed.unmatched.slice(0, 6).join(", ")}. Add any of these by hand.
                </p>
              ) : null}

              <p className="mt-3 border-t border-border-base pt-2.5 text-[11px] text-content-subtle">
                Read on this machine — the resume was not sent anywhere. Only the confident
                fields are filled in on the next screen; everything is editable, and nothing has
                been saved.
              </p>
            </div>
          ) : null}
        </form>
      </Modal>

      {reviewing && parsed ? (
        <CandidateFormModal
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

function toPrefill(parsed: ParsedResume) {
  const take = <T,>(f: { value: T; confidence: number }, fallback: T) =>
    f.confidence >= TRUSTED ? f.value : fallback;

  return {
    firstName: take(parsed.firstName, ""),
    lastName: take(parsed.lastName, ""),
    email: take(parsed.email, ""),
    phone: take(parsed.phone, ""),
    location: take(parsed.location, ""),
    linkedinUrl: take(parsed.linkedinUrl, ""),
    currentTitle: take(parsed.currentTitle, ""),
    currentCompany: take(parsed.currentCompany, ""),
    yearsExperience: take(parsed.yearsExperience, 0),
    seniority: take(parsed.seniority, "mid"),
    skills: parsed.skills.value,
    primaryTechnology: take(parsed.primaryTechnology, ""),
    workAuthorization: take(parsed.workAuthorization, "citizen"),
    availability: take(parsed.availability, "one_month"),
    summary: parsed.summary.value,
  };
}
