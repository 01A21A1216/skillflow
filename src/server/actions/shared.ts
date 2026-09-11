import "server-only";

import { randomUUID } from "node:crypto";
import type { z } from "zod";

import { db } from "@/db";
import { activities } from "@/db/schema";

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
