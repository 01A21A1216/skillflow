"use client";

import { useActionState } from "react";
import { AlertCircle, LogIn } from "lucide-react";

import { signIn } from "@/server/actions/misc";
import type { ActionState } from "@/server/actions/shared";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const INITIAL: ActionState = { ok: false };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="space-y-4">
      {state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-[hsl(var(--tone-rose-bg))] px-3 py-2.5 text-[13px] text-[hsl(var(--tone-rose))]"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <Field label="Email" required>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@meridiantalent.com"
          required
          autoFocus
        />
      </Field>

      <Field label="Password" required>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      <Button type="submit" variant="primary" size="md" className="w-full justify-center" loading={pending}>
        {!pending ? <LogIn className="size-4" /> : null}
        Sign in
      </Button>
    </form>
  );
}
