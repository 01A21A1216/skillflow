import "server-only";

import { randomUUID } from "node:crypto";
import type { z } from "zod";

import { db } from "@/db";
import { activities, type User } from "@/db/schema";
import type { PermissionKey } from "@/lib/permissions";
import { ForbiddenError } from "@/server/authz";
import { actorWithPermission } from "@/server/session";

export interface ActionState {
  ok: boolean;
  message?: string;
  /** Field-level messages keyed by form field name. */
  errors?: Record<string, string>;
  /** Id of the record that was created or touched, for optimistic navigation. */
  id?: string;
}

export const IDLE: ActionState = { ok: false };

export function newId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Run a Zod schema over FormData and flatten errors into field messages. */
export function parseForm<T extends z.ZodTypeAny>(
  schema: T,
  formData: FormData,
  arrayFields: string[] = [],
): { success: true; data: z.infer<T> } | { success: false; state: ActionState } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$")) continue; // Next internals
    if (arrayFields.includes(key)) {
      (raw[key] ??= [] as unknown[]);
      (raw[key] as unknown[]).push(value);
    } else {
      raw[key] = value;
    }
  }
  for (const field of arrayFields) raw[field] ??= [];

  // Unchecked checkboxes are simply absent from FormData.
  for (const key of ["willingToRelocate", "pinned"]) {
    if (key in raw) raw[key] = raw[key] === "on" || raw[key] === "true";
  }

  const result = schema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_form";
    errors[path] ??= issue.message;
  }
  return {
    success: false,
    state: { ok: false, message: "Please correct the highlighted fields.", errors },
  };
}

export function fail(message: string, errors?: Record<string, string>): ActionState {
  return { ok: false, message, errors };
}

/**
 * Wrap a server action so it cannot run without the required permission.
 *
 * Every mutation goes through this. Putting the check inside the wrapper
 * rather than at the top of each body means a new action cannot forget it —
 * there is no path to the handler that skips the guard. Server actions are
 * reachable as POST endpoints by anyone who can load the page, so the guard
 * has to live here and not in the component that renders the button.
 */
export function guarded(
  permission: PermissionKey,
  handler: (actor: User, formData: FormData) => Promise<ActionState>,
) {
  return async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    let actor: User;
    try {
      actor = await actorWithPermission(permission);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return {
          ok: false,
          message: "You do not have permission to do that.",
        };
      }
      throw error;
    }
    return handler(actor, formData);
  };
}

/** Denial that happens after the permission check, e.g. row-level scope. */
export function denied(what = "that record"): ActionState {
  return { ok: false, message: `You do not have access to ${what}.` };
}

export function succeed(message: string, id?: string): ActionState {
  return { ok: true, message, id };
}

export function logActivity(entry: {
  entityType: string;
  entityId: string;
  type: string;
  actorId: string | null;
  summary: string;
  meta?: Record<string, unknown>;
}) {
  db.insert(activities)
    .values({
      id: newId("act"),
      entityType: entry.entityType,
      entityId: entry.entityId,
      type: entry.type,
      actorId: entry.actorId,
      summary: entry.summary,
      meta: entry.meta ?? null,
      createdAt: new Date(),
    })
    .run();
}

/** ISO date string (yyyy-mm-dd) for `n` days from now. */
export function daysFromNow(n: number) {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}
