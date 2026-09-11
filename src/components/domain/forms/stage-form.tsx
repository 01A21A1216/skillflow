"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { STAGE_KINDS, TONES, type StageKind } from "@/lib/domain";
import { deleteStage, saveStage } from "@/server/actions/settings";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { FormModal } from "./form-shell";

export interface StageRow {
  id: string;
  key: string;
  label: string;
  kind: string;
  tone: string;
  description: string;
  slaDays: number;
  position: number;
  active: boolean;
  builtIn: boolean;
  rowVersion: number;
  occupied: number;
}

/**
 * Create or edit a pipeline stage (§8).
 *
 * Two fields are deliberately immutable once a stage exists: the key, because
 * every submission row points at it, and — for built-in stages — the phase,
 * because the funnel, the interview sync and every requirement's derived status
 * are all written against phases. Both are shown rather than hidden, so the
 * constraint reads as a design decision and not a missing feature.
 */
export function StageFormModal({
  open,
  onClose,
  stage,
  nextPosition,
}: {
  open: boolean;
  onClose: () => void;
  stage?: StageRow;
  nextPosition: number;
}) {
  const router = useRouter();
  const editing = Boolean(stage);

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="md"
      title={editing ? `Edit ${stage!.label}` : "Add a pipeline stage"}
      description={
        editing
          ? "Changes apply to every board and every report immediately."
          : "New stages behave like the built-in ones: pick the phase they belong to and the rest follows."
      }
      action={saveStage}
      submitLabel={editing ? "Save stage" : "Add stage"}
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          {editing ? (
            <>
              <input type="hidden" name="stageId" value={stage!.id} />
              <input type="hidden" name="rowVersion" value={stage!.rowVersion} />
            </>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Label" required error={errors.label}>
              <Input name="label" defaultValue={stage?.label} required placeholder="Client Review" />
            </Field>
            <Field
              label="Key"
              hint={editing ? "Fixed: every candidate record points at it." : "Lower case, no spaces."}
              error={errors.key}
            >
              {/* Read-only rather than disabled: a disabled field is not
                  submitted, and the action needs the key to confirm it is
                  unchanged rather than having to trust a hidden twin. */}
              <Input
                name="key"
                defaultValue={stage?.key}
                readOnly={editing}
                required
                placeholder="client_review"
                className={editing ? "text-content-subtle" : undefined}
              />
            </Field>
          </div>

          <Field
            label="Phase"
            hint={
              stage?.builtIn
                ? "Fixed for built-in stages — the application's rules are written against it."
                : "What this stage means. Every rule in the app reads the phase, not the name."
            }
            error={errors.kind}
          >
            <Select
              name="kind"
              defaultValue={stage?.kind ?? "sourcing"}
              disabled={stage?.builtIn}
            >
              {STAGE_KINDS.filter((k) => k.value !== "terminal").map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label} — {k.description}
                </option>
              ))}
            </Select>
          </Field>
          {stage?.builtIn ? (
            <input type="hidden" name="kind" value={stage.kind as StageKind} />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Colour" error={errors.tone}>
              <Select name="tone" defaultValue={stage?.tone ?? "slate"}>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Stage target"
              hint="Days before aging. 0 never ages."
              error={errors.slaDays}
            >
              <Input
                name="slaDays"
                type="number"
                min={0}
                max={120}
                defaultValue={stage?.slaDays ?? 5}
              />
            </Field>
            <Field label="Position" error={errors.position}>
              <Input
                name="position"
                type="number"
                min={0}
                max={99}
                defaultValue={stage?.position ?? nextPosition}
              />
            </Field>
          </div>

          <Field label="Description" error={errors.description}>
            <Textarea
              name="description"
              defaultValue={stage?.description}
              placeholder="What it means for a candidate to be sitting here."
            />
          </Field>

          <Checkbox
            name="active"
            defaultChecked={stage?.active ?? true}
            label="Show this stage on the board"
          />
        </>
      )}
    </FormModal>
  );
}

export function NewStageButton({ nextPosition }: { nextPosition: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add stage
      </Button>
      <StageFormModal open={open} onClose={() => setOpen(false)} nextPosition={nextPosition} />
    </>
  );
}

export function StageRowActions({ stage, nextPosition }: { stage: StageRow; nextPosition: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function remove() {
    setBusy(true);
    const fd = new FormData();
    fd.set("stageId", stage.id);
    const result = await deleteStage({ ok: false }, fd);
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
      {!stage.builtIn ? (
        <button
          type="button"
          disabled={busy || stage.occupied > 0}
          onClick={remove}
          title={
            stage.occupied
              ? `${stage.occupied} candidate(s) are here — move them first`
              : `Remove ${stage.label}`
          }
          className="rounded-lg p-1.5 text-content-subtle transition-colors hover:bg-[hsl(var(--tone-rose-bg))] hover:text-[hsl(var(--tone-rose))] disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
      <StageFormModal
        open={open}
        onClose={() => setOpen(false)}
        stage={stage}
        nextPosition={nextPosition}
      />
    </div>
  );
}
