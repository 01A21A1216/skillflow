"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { INTERVIEW_MODES, INTERVIEW_TYPES } from "@/lib/domain";
import { Avatar } from "@/components/ui/avatar";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { scheduleInterview } from "@/server/actions/interviews";
import { FormModal } from "./form-shell";

export interface PanelOption {
  id: string;
  name: string;
  title?: string;
  department?: string;
}

/** Local datetime string for an <input type="datetime-local"> default. */
function defaultSlot() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleInterviewModal({
  open,
  onClose,
  submissionId,
  candidateName,
  requisitionTitle,
  interviewers,
  coordinators,
  suggestedRound,
}: {
  open: boolean;
  onClose: () => void;
  submissionId: string;
  candidateName: string;
  requisitionTitle: string;
  interviewers: PanelOption[];
  coordinators: PanelOption[];
  suggestedRound?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="lg"
      title="Schedule an interview"
      description={`${candidateName} — ${requisitionTitle}`}
      action={scheduleInterview}
      submitLabel="Schedule"
      onSuccess={() => {
        setSelected([]);
        router.refresh();
      }}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          {selected.map((id) => (
            <input key={id} type="hidden" name="panelIds" value={id} />
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Round title" required error={errors.title} className="sm:col-span-2">
              <Input
                name="title"
                defaultValue={suggestedRound ?? "Technical deep dive"}
                placeholder="Technical deep dive"
                required
              />
            </Field>

            <Field label="Interview type" error={errors.type}>
              <Select name="type" defaultValue="technical">
                {INTERVIEW_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Format" error={errors.mode}>
              <Select name="mode" defaultValue="video">
                {INTERVIEW_MODES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Date and time" required error={errors.scheduledAt}>
              <Input name="scheduledAt" type="datetime-local" defaultValue={defaultSlot()} required />
            </Field>

            <Field label="Duration" hint="Minutes" error={errors.durationMinutes}>
              <Select name="durationMinutes" defaultValue="60">
                {[30, 45, 60, 75, 90, 120, 180].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Location or meeting link"
              error={errors.locationOrLink}
              className="sm:col-span-2"
            >
              <Input name="locationOrLink" placeholder="https://meet.meridiantalent.com/…" />
            </Field>

            <Field label="Coordinator" error={errors.organizerId} className="sm:col-span-2">
              <Select name="organizerId" defaultValue={coordinators[0]?.id} required>
                {coordinators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 flex items-baseline gap-2 text-[13px] font-medium text-content">
              Interview panel
              <span className="text-[11.5px] font-normal text-content-subtle">
                {selected.length ? `${selected.length} selected` : "pick at least one"}
              </span>
            </legend>
            {errors.panelIds ? (
              <p className="mb-2 text-xs text-[hsl(var(--tone-rose))]">{errors.panelIds}</p>
            ) : null}

            <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border-base p-1.5 sm:grid-cols-2">
              {interviewers.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-pressed={on}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                      on ? "bg-brand-soft ring-1 ring-brand/40" : "hover:bg-surface-muted",
                    )}
                  >
                    <Avatar name={p.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-content">
                        {p.name}
                      </span>
                      <span className="block truncate text-[11px] text-content-subtle">
                        {p.title}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field label="Agenda" hint="Shared with the panel in the invite." error={errors.agenda}>
            <Textarea
              name="agenda"
              placeholder="Live problem-solving on a realistic scenario from the team backlog."
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}
