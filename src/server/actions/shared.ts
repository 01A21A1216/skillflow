import "server-only";

import { randomUUID } from "node:crypto";
import type { z } from "zod";

import { db } from "@/db";
import { activities, type FieldChange, type User } from "@/db/schema";
import type { PermissionKey } from "@/lib/permissions";
import { ForbiddenError, loadPermissionMatrix } from "@/server/authz";
import { ConcurrencyError, concurrencyMessage } from "@/server/integrity";
import { publish } from "@/server/realtime";
import { actorWithPermission } from "@/server/session";

export interface ActionState {
  ok: boolean;
  message?: string;
  /** Field-level messages keyed by form field name. */
  errors?: Record<string, string>;
  /** Id of the record that was created or touched, for optimistic navigation. */
  id?: string;
  /** Set when the write lost a race against another editor. */
  conflict?: boolean;
  /**
   * Set when a save was stopped because the record looks like a duplicate.
   * The form offers to go ahead; submitting again carries `confirmDuplicate`.
   */
  duplicateWarning?: boolean;
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

  // Dotted names build one level of nesting, so a scorecard can post
  // `scores.technical=4` without the schema needing a column per competency.
  for (const key of Object.keys(raw)) {
    const dot = key.indexOf(".");
    if (dot <= 0) continue;
    const [group, field] = [key.slice(0, dot), key.slice(dot + 1)];
    const bucket = (raw[group] ??= {}) as Record<string, unknown>;
    bucket[field] = raw[key];
    delete raw[key];
  }

  /*
   * Checkbox values.
   *
   * `Checkbox` renders a hidden companion for every boolean toggle, so an
   * unchecked one arrives as "" rather than not arriving at all — without
   * which a field defaulting to true could never be switched off. Here the
   * browser's "on" and that "" become real booleans, because `z.coerce
   * .boolean()` is `Boolean()`, and `Boolean("false")` is true.
   */
  for (const key of ["willingToRelocate", "pinned", "active", "isDefault", "granted"]) {
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
    await loadPermissionMatrix();

    let actor: User;
    try {
      actor = await actorWithPermission(permission);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return { ok: false, message: "You do not have permission to do that." };
      }
      throw error;
    }

    try {
      return await handler(actor, formData);
    } catch (error) {
      // A lost write race is an expected outcome with several people on one
      // desk, not a crash: report it so the user can reload and reapply.
      if (error instanceof ConcurrencyError) {
        return { ok: false, message: concurrencyMessage(error), conflict: true };
      }
      throw error;
    }
  };
}

/** Denial that happens after the permission check, e.g. row-level scope. */
export function denied(what = "that record"): ActionState {
  return { ok: false, message: `You do not have access to ${what}.` };
}

export function succeed(message: string, id?: string): ActionState {
  return { ok: true, message, id };
}

export async function logActivity(entry: {
  entityType: string;
  entityId: string;
  type: string;
  actorId: string | null;
  summary: string;
  /** Field-level before/after, so the trail answers "from what, to what" (§13). */
  changes?: FieldChange[];
  meta?: Record<string, unknown>;
}) {
  await db.insert(activities).values({
    id: newId("act"),
    entityType: entry.entityType,
    entityId: entry.entityId,
    type: entry.type,
    actorId: entry.actorId,
    summary: entry.summary,
    changes: entry.changes?.length ? entry.changes : null,
    meta: entry.meta ?? null,
    createdAt: new Date(),
  });

  /*
   * Tell every other open browser (item 4.1).
   *
   * Hooked here rather than added to each action, because "something was
   * audited" and "something changed" are the same event — every mutation in
   * the application already writes an activity row, so one hook gives
   * complete coverage and there is no way to add a mutation later that
   * silently fails to broadcast.
   *
   * A hint only: the entity, its id and who did it. What actually reaches a
   * screen is re-rendered by the same scoped queries as a navigation.
   */
  const scope: Record<string, string> = {};
  for (const key of ["requisitionId", "candidateId", "submissionId", "interviewId"]) {
    const value = entry.meta?.[key];
    if (typeof value === "string") scope[key] = value;
  }

  await publish({
    entity: entry.entityType,
    entityId: entry.entityId,
    actorId: entry.actorId,
    scope: Object.keys(scope).length ? scope : undefined,
  });
}

/** ISO date string (yyyy-mm-dd) for `n` days from now. */
export function daysFromNow(n: number) {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}
