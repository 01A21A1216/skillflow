"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";

import type { Candidate } from "@/db/schema";
import {
  AVAILABILITIES,
  CANDIDATE_STATUSES,
  RATE_BASES,
  SENIORITIES,
  SOURCES,
  WORK_AUTHORIZATIONS,
} from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { createCandidate, updateCandidate } from "@/server/actions/candidates";
import { FormModal } from "./form-shell";
import { ResumeParserModal } from "./resume-parser";

export interface CandidateFormOptions {
  owners: { id: string; name: string }[];
}

export function CandidateFormModal({
  open,
  onClose,
  options,
  candidate,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  options: CandidateFormOptions;
  candidate?: Candidate;
  /**
   * Starting values from the resume parser (§6). The same form as a blank
   * one, deliberately: a parse is a head start, not a second way of creating
   * a record.
   */
  prefill?: Partial<Candidate>;
}) {
  const router = useRouter();
  const editing = Boolean(candidate);
  const initial = (candidate ?? prefill) as Partial<Candidate> | undefined;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${candidate!.firstName} ${candidate!.lastName}` : "Add a candidate"}
      description={
        editing
          ? "Updates are recorded against the candidate timeline."
          : "Capture enough to qualify them properly — the rest can be filled in as the conversation develops."
      }
      action={editing ? updateCandidate : createCandidate}
      submitLabel={editing ? "Save changes" : "Add candidate"}
      onSuccess={(s) => {
        if (!editing && s.id) router.push(`/candidates/${s.id}`);
        else router.refresh();
      }}
    >
      {({ errors, state }) => (
        <>
          {/* A second submit carries the override, so the same button that was
              just refused is the one that goes through — no separate "save
              anyway" control to find. */}
          {state?.duplicateWarning ? (
            <input type="hidden" name="confirmDuplicate" value="yes" />
          ) : null}
          {editing ? (
            <>
              <input type="hidden" name="candidateId" value={candidate!.id} />
              <input type="hidden" name="rowVersion" value={candidate!.rowVersion} />
            </>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required error={errors.firstName}>
              <Input name="firstName" defaultValue={initial?.firstName} required />
            </Field>
            <Field label="Last name" required error={errors.lastName}>
              <Input name="lastName" defaultValue={initial?.lastName} required />
            </Field>
            <Field label="Email" required error={errors.email}>
              <Input name="email" type="email" defaultValue={initial?.email} required />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <Input name="phone" defaultValue={initial?.phone ?? ""} placeholder="+1 (512) 555-0142" />
            </Field>
            <Field label="Location" required error={errors.location}>
              <Input name="location" defaultValue={initial?.location} placeholder="Austin, TX" required />
            </Field>
            <Field label="LinkedIn" error={errors.linkedinUrl}>
              <Input
                name="linkedinUrl"
                type="url"
                defaultValue={initial?.linkedinUrl ?? ""}
                placeholder="https://linkedin.com/in/…"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current title" required error={errors.currentTitle}>
              <Input name="currentTitle" defaultValue={initial?.currentTitle} required />
            </Field>
            <Field label="Current company" required error={errors.currentCompany}>
              <Input name="currentCompany" defaultValue={initial?.currentCompany} required />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Years of experience" required error={errors.yearsExperience}>
              <Input
                name="yearsExperience"
                type="number"
                min={0}
                max={60}
                step={0.5}
                defaultValue={initial?.yearsExperience ?? 5}
                required
              />
            </Field>
            <Field label="Level" error={errors.seniority}>
              <Select name="seniority" defaultValue={initial?.seniority ?? "mid"}>
                {SENIORITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Rating" hint="0 means not yet rated" error={errors.rating}>
              <Select name="rating" defaultValue={String(initial?.rating ?? 0)}>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Unrated" : `${n} star${n === 1 ? "" : "s"}`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source" error={errors.source}>
              <Select name="source" defaultValue={initial?.source ?? "sourced"}>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Source detail" error={errors.sourceDetail}>
              <Input
                name="sourceDetail"
                defaultValue={initial?.sourceDetail ?? ""}
                placeholder="Referred by Priya Raghavan"
              />
            </Field>
            <Field label="Owner" required error={errors.ownerId}>
              <Select name="ownerId" defaultValue={initial?.ownerId ?? options.owners[0]?.id} required>
                {options.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" error={errors.status}>
              <Select name="status" defaultValue={initial?.status ?? "new"}>
                {CANDIDATE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Primary technology"
              hint="The one they lead with."
              error={errors.primaryTechnology}
            >
              <Input
                name="primaryTechnology"
                defaultValue={initial?.primaryTechnology ?? ""}
                placeholder="Oracle EBS"
              />
            </Field>
            <Field label="Availability" error={errors.availability}>
              <Select name="availability" defaultValue={initial?.availability ?? "one_month"}>
                {AVAILABILITIES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Available from" error={errors.availableFrom}>
              <Input
                name="availableFrom"
                type="date"
                defaultValue={initial?.availableFrom ?? undefined}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Contract rate"
              hint="Leave empty for permanent-only candidates."
              error={errors.expectedRate}
            >
              <Input
                name="expectedRate"
                type="number"
                min={0}
                step={1}
                defaultValue={initial?.expectedRate ?? undefined}
                placeholder="85"
              />
            </Field>
            <Field label="Rate basis" error={errors.rateBasis}>
              <Select name="rateBasis" defaultValue={initial?.rateBasis ?? "hourly"}>
                {RATE_BASES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Current salary" error={errors.currentSalary}>
              <Input
                name="currentSalary"
                type="number"
                min={0}
                step={1000}
                defaultValue={initial?.currentSalary ?? undefined}
              />
            </Field>
            <Field label="Expected salary" error={errors.expectedSalary}>
              <Input
                name="expectedSalary"
                type="number"
                min={0}
                step={1000}
                defaultValue={initial?.expectedSalary ?? undefined}
              />
            </Field>
            <Field label="Notice period" hint="Days" error={errors.noticePeriodDays}>
              <Input
                name="noticePeriodDays"
                type="number"
                min={0}
                max={180}
                defaultValue={initial?.noticePeriodDays ?? 14}
              />
            </Field>
          </div>

          <div className="grid items-end gap-4 sm:grid-cols-2">
            <Field label="Work authorization" error={errors.workAuthorization}>
              <Select
                name="workAuthorization"
                defaultValue={initial?.workAuthorization ?? "citizen"}
              >
                {WORK_AUTHORIZATIONS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox
              name="willingToRelocate"
              defaultChecked={initial?.willingToRelocate}
              label="Open to relocation"
              className="pb-2"
            />
          </div>

          <Field label="Skills" hint="Comma separated." error={errors.skills}>
            <Input
              name="skills"
              defaultValue={(initial?.skills ?? []).join(", ")}
              placeholder="Go, PostgreSQL, Kubernetes"
            />
          </Field>

          <Field label="Tags" hint="Comma separated." error={errors.tags}>
            <Input
              name="tags"
              defaultValue={(initial?.tags ?? []).join(", ")}
              placeholder="silver-medalist, passive"
            />
          </Field>

          <Field label="Summary" error={errors.summary}>
            <Textarea
              name="summary"
              defaultValue={initial?.summary}
              placeholder="What stands out, what they are looking for, and anything the hiring manager should know."
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

export function NewCandidateButton({
  options,
  defaultOpen = false,
}: {
  options: CandidateFormOptions;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [parsing, setParsing] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Most candidates arrive as a CV, so reading one sits beside the
            blank form rather than behind it. */}
        <Button variant="secondary" size="sm" onClick={() => setParsing(true)}>
          <Sparkles className="size-4" />
          From a resume
        </Button>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Add candidate
        </Button>
      </div>
      <CandidateFormModal open={open} onClose={() => setOpen(false)} options={options} />
      <ResumeParserModal open={parsing} onClose={() => setParsing(false)} options={options} />
    </>
  );
}

export function EditCandidateButton({
  options,
  candidate,
}: {
  options: CandidateFormOptions;
  candidate: Candidate;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit profile
      </Button>
      <CandidateFormModal
        open={open}
        onClose={() => setOpen(false)}
        options={options}
        candidate={candidate}
      />
    </>
  );
}
