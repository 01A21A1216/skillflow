"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import type { ActionState } from "@/server/actions/shared";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const INITIAL: ActionState = { ok: false };

/**
 * Every mutation in the app goes through the same shape: a server action
 * returning `{ ok, message, errors }`, rendered with useActionState so errors
 * land next to the field and the button reports its own pending state.
 */
export function useFormAction(
  action: Action,
  opts: { onSuccess?: (state: ActionState) => void } = {},
) {
  const toast = useToast();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const seen = useRef<ActionState | null>(null);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.ok) {
      toast({ kind: "success", title: state.message ?? "Saved" });
      opts.onSuccess?.(state);
    } else if (state.message && !state.errors && !state.conflict) {
      toast({ kind: "error", title: "Could not save", description: state.message });
    } else if (state.conflict) {
      toast({ kind: "error", title: "Someone else saved first", description: state.message });
    } else if (state.duplicateWarning) {
      toast({ kind: "error", title: "Possible duplicate", description: state.message });
    }
    // `opts` is a fresh object each render; only the state transition matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return { state, formAction, pending, errors: state.errors ?? {} };
}

export function FormError({
  message,
  conflict,
  warning,
}: {
  message?: string;
  conflict?: boolean;
  /** A question rather than a failure: submitting again goes ahead. */
  warning?: boolean;
}) {
  if (!message) return null;

  // Three different things wear three different colours. A lost write race
  // needs a reload; a duplicate warning needs a decision; only a validation
  // failure needs a correction.
  const tone = conflict || warning ? "amber" : "rose";
  const Icon = conflict ? RefreshCw : AlertCircle;

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg bg-[hsl(var(--tone-${tone}-bg))] px-3 py-2.5 text-[13px] text-[hsl(var(--tone-${tone}))]`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>
        {message}
        {conflict ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ml-2 underline underline-offset-2"
          >
            Reload now
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** A Modal whose body is a form wired to a server action. */
export function FormModal({
  open,
  onClose,
  title,
  description,
  action,
  submitLabel,
  size = "md",
  children,
  extraFooter,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  action: Action;
  submitLabel: string;
  size?: "sm" | "md" | "lg" | "xl";
  children: (ctx: {
    errors: Record<string, string>;
    pending: boolean;
    state: ActionState;
  }) => ReactNode;
  extraFooter?: ReactNode;
  onSuccess?: (state: ActionState) => void;
}) {
  const { formAction, pending, errors, state } = useFormAction(action, {
    onSuccess: (s) => {
      onSuccess?.(s);
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          {extraFooter}
          <Button variant="ghost" size="sm" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" form="form-modal" loading={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="form-modal" action={formAction} className="space-y-4">
        <FormError
          message={
            state.errors || state.conflict || state.duplicateWarning ? state.message : undefined
          }
          conflict={state.conflict}
          warning={state.duplicateWarning}
        />
        {children({ errors, pending, state })}
      </form>
    </Modal>
  );
}
