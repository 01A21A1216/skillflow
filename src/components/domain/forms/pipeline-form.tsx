"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send } from "lucide-react";

import { usePipeline } from "../pipeline-context";
import { addToPipeline } from "@/server/actions/pipeline";
import { addNote } from "@/server/actions/misc";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { FormModal, useFormAction } from "./form-shell";

export function AddToPipelineButton({
  candidateId,
  candidateName,
  requisitions,
}: {
  candidateId: string;
  candidateName: string;
  requisitions: { id: string; code: string; title: string; clientName: string }[];
}) {
  const router = useRouter();
  const pipeline = usePipeline();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={requisitions.length === 0}
        title={
          requisitions.length === 0
            ? "This candidate is already on every open requisition"
            : undefined
        }
      >
        <Plus className="size-4" />
        Add to requisition
      </Button>

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title="Add to a requisition"
        description={`${candidateName} will enter the pipeline and appear on the board.`}
        action={addToPipeline}
        submitLabel="Add to pipeline"
        onSuccess={() => router.refresh()}
      >
        {({ errors }) => (
          <>
            <input type="hidden" name="candidateId" value={candidateId} />

            <Field label="Requisition" required error={errors.requisitionId}>
              <Select name="requisitionId" required defaultValue="">
                <option value="" disabled>
                  Select a requisition…
                </option>
                {requisitions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {r.title} ({r.clientName})
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Entry stage"
              hint="Earlier stages are backfilled so funnel analytics stay accurate."
              error={errors.stage}
            >
              <Select name="stage" defaultValue={pipeline.order[0]}>
                {pipeline.active.map((key) => (
                  <option key={key} value={key}>
                    {pipeline.label(key)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Match score"
              hint="0–100. A quick read on fit against the requirement."
              error={errors.matchScore}
            >
              <Select name="matchScore" defaultValue="75">
                {[50, 60, 70, 75, 80, 85, 90, 95].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Opening note" error={errors.note}>
              <Textarea
                name="note"
                placeholder="Why this person is worth the hiring manager's time."
              />
            </Field>
          </>
        )}
      </FormModal>
    </>
  );
}

/** Inline composer used on candidate and requisition detail pages. */
export function NoteComposer({
  entityType,
  entityId,
  placeholder = "Add a note…",
}: {
  entityType: "candidate" | "requisition" | "submission";
  entityId: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const { formAction, pending, errors } = useFormAction(addNote, {
    onSuccess: () => {
      setBody("");
      router.refresh();
    },
  });

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <Textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        className="min-h-[72px]"
        required
      />
      {errors.body ? (
        <p className="text-xs text-[hsl(var(--tone-rose))]">{errors.body}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <Checkbox name="pinned" label="Pin to the top" />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={pending}
          disabled={!body.trim()}
        >
          <Send className="size-3.5" />
          Add note
        </Button>
      </div>
    </form>
  );
}
