"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";

import type { Requisition } from "@/db/schema";
import {
  AUTHORED_REQ_STATUSES,
  REQUISITION_SOURCES,
  EMPLOYMENT_TYPES,
  PRIORITIES,
  SENIORITIES,
  WORK_AUTHORIZATIONS,
  WORK_MODES,
} from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "./form-shell";
import { JdParserModal } from "./jd-parser";
import { createRequisition, updateRequisition } from "@/server/actions/requisitions";

export interface RequisitionFormOptions {
  clients: { id: string; name: string }[];
  recruiters: { id: string; name: string }[];
  hiringManagers: { id: string; name: string; department: string }[];
  departments: string[];
  scorecards?: { id: string; name: string }[];
}

const DEPARTMENT_FALLBACK = [
  "Engineering",
  "Data & Analytics",
  "Product",
  "Design",
  "Security",
  "Go-to-Market",
  "Finance & Operations",
];

export function RequisitionFormModal({
  open,
  onClose,
  options,
  requisition,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  options: RequisitionFormOptions;
  /** Present when editing. */
  requisition?: Requisition;
  /**
   * Starting values for a new requirement, from the job-description parser
   * (§17). Deliberately the same form as a blank one: a parse is a head start,
   * not a second way of creating a record, and every field stays editable.
   */
  prefill?: Partial<Requisition>;
}) {
  const router = useRouter();
  const editing = Boolean(requisition);
  // `requisition` when editing, `prefill` when creating from a parse. Both
  // populate the same defaults, so there is one form rather than two.
  const initial = (requisition ?? prefill) as Partial<Requisition> | undefined;
  const departments = options.departments.length ? options.departments : DEPARTMENT_FALLBACK;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${requisition!.code}` : "Open a requisition"}
      description={
        editing
          ? "Changes are recorded on the requisition timeline."
          : "Capture the intake so recruiters, the hiring manager and the panel are working from the same brief."
      }
      action={editing ? updateRequisition : createRequisition}
      submitLabel={editing ? "Save changes" : "Open requisition"}
      onSuccess={(s) => {
        if (!editing && s.id) router.push(`/requisitions/${s.id}`);
        else router.refresh();
      }}
    >
      {({ errors }) => (
        <>
          {editing ? (
            <>
              <input type="hidden" name="requisitionId" value={requisition!.id} />
              {/* The version this form was rendered with. The action compares it
                  against the row and refuses a save that would overwrite
                  someone else's edit. */}
              <input type="hidden" name="rowVersion" value={requisition!.rowVersion} />
            </>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Job title" required error={errors.title} className="sm:col-span-2">
              <Input
                name="title"
                defaultValue={initial?.title}
                placeholder="Senior Backend Engineer"
                required
              />
            </Field>

            <Field label="Client account" required error={errors.clientId}>
              <Select name="clientId" defaultValue={initial?.clientId} required>
                <option value="">Select a client…</option>
                {options.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Department" required error={errors.department}>
              <Select name="department" defaultValue={initial?.department ?? "Engineering"} required>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Hiring manager" required error={errors.hiringManagerId}>
              <Select name="hiringManagerId" defaultValue={initial?.hiringManagerId} required>
                <option value="">Select…</option>
                {options.hiringManagers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.department}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Lead recruiter" required error={errors.leadRecruiterId}>
              <Select name="leadRecruiterId" defaultValue={initial?.leadRecruiterId} required>
                <option value="">Select…</option>
                {options.recruiters.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Backup recruiter"
              hint="Who picks this up when the lead is away."
              error={errors.backupRecruiterId}
            >
              <Select name="backupRecruiterId" defaultValue={initial?.backupRecruiterId ?? ""}>
                <option value="">None</option>
                {options.recruiters
                  .filter((u) => u.id !== initial?.leadRecruiterId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="How it reached us" error={errors.source}>
              <Select name="source" defaultValue={initial?.source ?? "client_direct"}>
                {REQUISITION_SOURCES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            {options.scorecards?.length ? (
              <Field
                label="Scorecard"
                hint="What this requirement's panels score against."
                error={errors.scorecardTemplateId}
              >
                <Select
                  name="scorecardTemplateId"
                  defaultValue={initial?.scorecardTemplateId ?? ""}
                >
                  <option value="">Default</option>
                  {options.scorecards.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Employment type" error={errors.employmentType}>
              <Select name="employmentType" defaultValue={initial?.employmentType ?? "full_time"}>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Work mode" error={errors.workMode}>
              <Select name="workMode" defaultValue={initial?.workMode ?? "hybrid"}>
                {WORK_MODES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Level" error={errors.seniority}>
              <Select name="seniority" defaultValue={initial?.seniority ?? "mid"}>
                {SENIORITIES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Location" required error={errors.location} className="sm:col-span-2">
              <Input
                name="location"
                defaultValue={initial?.location}
                placeholder="Austin, TX"
                required
              />
            </Field>

            <Field label="Openings" error={errors.openings}>
              <Input
                name="openings"
                type="number"
                min={1}
                max={50}
                defaultValue={initial?.openings ?? 1}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Salary min" error={errors.minSalary}>
              <Input
                name="minSalary"
                type="number"
                min={0}
                step={1000}
                defaultValue={initial?.minSalary ?? undefined}
                placeholder="150000"
              />
            </Field>
            <Field label="Salary max" error={errors.maxSalary}>
              <Input
                name="maxSalary"
                type="number"
                min={0}
                step={1000}
                defaultValue={initial?.maxSalary ?? undefined}
                placeholder="195000"
              />
            </Field>
            <Field label="Experience min" hint="Years" error={errors.experienceMin}>
              <Input
                name="experienceMin"
                type="number"
                min={0}
                max={40}
                defaultValue={initial?.experienceMin ?? 3}
              />
            </Field>
            <Field label="Experience max" hint="Years" error={errors.experienceMax}>
              <Input
                name="experienceMax"
                type="number"
                min={0}
                max={40}
                defaultValue={initial?.experienceMax ?? 8}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Priority" error={errors.priority}>
              <Select name="priority" defaultValue={initial?.priority ?? "medium"}>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" error={errors.status}>
              <Select name="status" defaultValue={initial?.status ?? "open"}>
                {AUTHORED_REQ_STATUSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Target fill date" error={errors.targetFillDate}>
              <Input
                name="targetFillDate"
                type="date"
                defaultValue={initial?.targetFillDate ?? undefined}
              />
            </Field>
          </div>

          <Field
            label="Must-have skills"
            hint="Comma separated. A candidate without these is not submittable."
            error={errors.requiredSkills}
          >
            <Input
              name="requiredSkills"
              defaultValue={(initial?.requiredSkills ?? []).join(", ")}
              placeholder="Oracle EBS, PL/SQL, Oracle Fusion"
            />
          </Field>

          <Field
            label="Nice-to-have skills"
            hint="Comma separated. These raise a match score but never rule anyone out."
            error={errors.preferredSkills}
          >
            <Input
              name="preferredSkills"
              defaultValue={(initial?.preferredSkills ?? []).join(", ")}
              placeholder="OIC, SOA Suite, Kubernetes"
            />
          </Field>

          <Field
            label="Accepted work authorization"
            hint="Leave every box clear if the client has set no constraint."
            error={errors.visaRequirements}
          >
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
              {WORK_AUTHORIZATIONS.map((w) => (
                <Checkbox
                  key={w.value}
                  name="visaRequirements"
                  value={w.value}
                  defaultChecked={(initial?.visaRequirements ?? []).includes(w.value)}
                  label={w.label}
                />
              ))}
            </div>
          </Field>

          <Field label="Role summary" error={errors.description}>
            <Textarea
              name="description"
              defaultValue={initial?.description}
              placeholder="What this person will own, and why the role exists."
            />
          </Field>

          <Field
            label="Requirements"
            hint="One per line. Shown on the requisition brief."
            error={errors.requirements}
          >
            <Textarea
              name="requirements"
              defaultValue={(initial?.requirements ?? []).join("\n")}
              placeholder={"Production ownership of a high-throughput service\nStrong relational data modelling"}
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/** Button + modal pair, so pages only need to drop in one component. */
export function NewRequisitionButton({
  options,
  defaultOpen = false,
}: {
  options: RequisitionFormOptions;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [parsing, setParsing] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Most requirements arrive as a pasted job description, so reading
            one is offered beside the blank form rather than buried in it. */}
        <Button variant="secondary" size="sm" onClick={() => setParsing(true)}>
          <Sparkles className="size-4" />
          From a JD
        </Button>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          New requisition
        </Button>
      </div>
      <RequisitionFormModal open={open} onClose={() => setOpen(false)} options={options} />
      <JdParserModal open={parsing} onClose={() => setParsing(false)} options={options} />
    </>
  );
}

export function EditRequisitionButton({
  options,
  requisition,
}: {
  options: RequisitionFormOptions;
  requisition: Requisition;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <RequisitionFormModal
        open={open}
        onClose={() => setOpen(false)}
        options={options}
        requisition={requisition}
      />
    </>
  );
}
