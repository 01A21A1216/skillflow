"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import { deleteScorecard, saveScorecard } from "@/server/actions/scorecards";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { FormModal } from "./form-shell";

export interface ScorecardRow {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  active: boolean;
  criteria: { key: string; label: string; description: string }[];
  /** How many requirements point at it, so a delete can be refused with a reason. */
  usedBy: number;
  /** Whether a panel has already scored against it. */
  scored: boolean;
}

interface Draft {
  key: string;
  label: string;
  description: string;
  /** Existing and already scored against: the key cannot change or go. */
  locked: boolean;
}

const BLANK: Draft = { key: "", label: "", description: "", locked: false };

/** "Systems Design" → "systems_design", so nobody has to invent a key. */
function slug(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * Create or edit a scorecard template (§3, §11).
 *
 * The competencies are the substance, so they are edited as a list of rows
 * rather than hidden behind a second screen. A key is generated from the label
 * and then left alone: it is what a filed scorecard stores its scores under,
 * and renaming one would orphan them. Keys already scored against are shown
 * locked rather than hidden, so the constraint reads as a decision.
 */
export function ScorecardFormModal({
  open,
  onClose,
  template,
}: {
  open: boolean;
  onClose: () => void;
  template?: ScorecardRow;
}) {
  const router = useRouter();
  const editing = Boolean(template);

  const [rows, setRows] = useState<Draft[]>(
    template?.criteria.length
      ? template.criteria.map((c) => ({ ...c, locked: template.scored }))
      : [{ ...BLANK }, { ...BLANK }, { ...BLANK }],
  );

  const update = (i: number, patch: Partial<Draft>) =>
    setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${template!.name}` : "Add a scorecard"}
      description={
        editing
          ? "Labels and descriptions can change freely — an already-filed scorecard keeps the wording its author saw. Keys cannot, because the scores are stored under them."
          : "What every panel using this scorecard will be asked to score. Three to six competencies is what people actually fill in honestly."
      }
      action={saveScorecard}
      submitLabel={editing ? "Save scorecard" : "Add scorecard"}
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          {editing ? <input type="hidden" name="templateId" value={template!.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name}>
              <Input
                name="name"
                defaultValue={template?.name}
                required
                placeholder="Engineering — Senior"
              />
            </Field>
            <Field label="When to use it" error={errors.description}>
              <Input
                name="description"
                defaultValue={template?.description}
                placeholder="Staff level and above"
              />
            </Field>
          </div>

          <fieldset className="space-y-2.5">
            <legend className="text-[12.5px] font-medium text-content">
              Competencies
              {errors.criterionKey ? (
                <span className="ml-2 font-normal text-[hsl(var(--tone-rose))]">
                  {errors.criterionKey}
                </span>
              ) : null}
            </legend>

            {rows.map((row, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-border-base p-2.5"
              >
                <GripVertical
                  className="mt-2 size-3.5 shrink-0 text-content-subtle"
                  aria-hidden
                />
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_1.4fr]">
                  <div className="space-y-1">
                    <Input
                      name="criterionLabel"
                      value={row.label}
                      required
                      placeholder="Technical depth"
                      aria-label={`Competency ${i + 1} label`}
                      onChange={(e) => {
                        const label = e.target.value;
                        update(i, {
                          label,
                          // The key follows the label only until it is saved;
                          // after that it is what the scores hang off.
                          key: row.locked ? row.key : slug(label),
                        });
                      }}
                    />
                    <input type="hidden" name="criterionKey" value={row.key} />
                    <p className="pl-0.5 font-mono text-[10.5px] text-content-subtle">
                      {row.key || "…"}
                      {row.locked ? " · in use" : ""}
                    </p>
                  </div>
                  <Input
                    name="criterionDescription"
                    value={row.description}
                    placeholder="What a strong answer looks like"
                    aria-label={`Competency ${i + 1} description`}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  disabled={row.locked || rows.length <= 1}
                  onClick={() => setRows((c) => c.filter((_, j) => j !== i))}
                  title={
                    row.locked
                      ? "Already scored against — it cannot be removed"
                      : "Remove this competency"
                  }
                  aria-label={`Remove competency ${i + 1}`}
                  className="mt-1 rounded-lg p-1.5 text-content-subtle transition-colors hover:bg-[hsl(var(--tone-rose-bg))] hover:text-[hsl(var(--tone-rose))] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-content-subtle"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}

            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={rows.length >= 12}
              onClick={() => setRows((c) => [...c, { ...BLANK }])}
            >
              <Plus className="size-3.5" />
              Add a competency
            </Button>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox
              name="isDefault"
              label="Use this when a requirement does not pick one"
              defaultChecked={template?.isDefault}
            />
            <Checkbox
              name="active"
              label="Offer it on the requirement form"
              defaultChecked={template?.active ?? true}
            />
          </div>
        </>
      )}
    </FormModal>
  );
}

export function NewScorecardButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        Add scorecard
      </Button>
      <ScorecardFormModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ScorecardRowActions({ template }: { template: ScorecardRow }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function remove() {
    setBusy(true);
    const fd = new FormData();
    fd.set("templateId", template.id);
    const result = await deleteScorecard({ ok: false }, fd);
    setBusy(false);
    toast(
      result.ok
        ? { kind: "success", title: result.message ?? "Removed" }
        : { kind: "error", title: "Could not remove", description: result.message },
    );
    if (result.ok) router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button size="xs" variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <button
        type="button"
        disabled={busy || template.isDefault || template.usedBy > 0}
        onClick={remove}
        title={
          template.isDefault
            ? "This is the default — make another one the default first"
            : template.usedBy
              ? `${template.usedBy} requirement(s) use it`
              : template.scored
                ? "Switch off — panels have already scored against it, so it is kept"
                : `Remove ${template.name}`
        }
        aria-label={`Remove ${template.name}`}
        className="rounded-lg p-1.5 text-content-subtle transition-colors hover:bg-[hsl(var(--tone-rose-bg))] hover:text-[hsl(var(--tone-rose))] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content-subtle"
      >
        <Trash2 className="size-3.5" />
      </button>
      <ScorecardFormModal open={open} onClose={() => setOpen(false)} template={template} />
    </div>
  );
}
