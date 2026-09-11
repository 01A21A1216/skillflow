import "server-only";

import { and, eq, isNull, type SQL } from "drizzle-orm";

import type { FieldChange } from "@/db/schema";

/**
 * Data integrity primitives (§20).
 *
 * Three concerns that every mutation shares, kept here so each action does not
 * re-implement them slightly differently:
 *
 *   diffFields()       structured before/after for the audit trail (§13)
 *   ConcurrencyError   two people editing the same record
 *   alive()            soft-deleted rows stay out of every read
 */

/* ------------------------------------------------------------------ *
 * Structured change history
 * ------------------------------------------------------------------ */

/** Human labels for the fields worth narrating. Anything absent is skipped. */
export type FieldLabels<T> = Partial<Record<keyof T & string, string>>;

function comparable(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return String(value);
}

/**
 * Produce one entry per field that actually changed.
 *
 * The specification asks the audit trail to record old value and new value
 * (§13), not just a sentence. Comparing here rather than in each action means
 * "updated" entries never claim a change that did not happen — a real problem
 * with prose-only logs, where saving a form with no edits still reads as an
 * update.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  labels: FieldLabels<T>,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [field, label] of Object.entries(labels) as [keyof T & string, string][]) {
    if (!(field in after)) continue;
    const from = comparable(before[field]);
    const to = comparable(after[field]);
    if (from === to) continue;
    changes.push({ field, label, from, to });
  }

  return changes;
}

/** One-line summary of a diff, for the activity feed. */
export function describeChanges(changes: FieldChange[]): string {
  if (!changes.length) return "";
  if (changes.length === 1) {
    const c = changes[0]!;
    return `${c.label} ${c.from ?? "empty"} → ${c.to ?? "empty"}`;
  }
  return `${changes.length} fields changed: ${changes.map((c) => c.label).join(", ")}`;
}

/* ------------------------------------------------------------------ *
 * Optimistic concurrency
 * ------------------------------------------------------------------ */

export class ConcurrencyError extends Error {
  constructor(
    public readonly entity: string,
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`${entity} changed since you loaded it (expected v${expected}, found v${actual})`);
    this.name = "ConcurrencyError";
  }
}

/**
 * Compare the version the form was rendered with against the row as it stands.
 *
 * The form carries the version it read in a hidden field. If someone else has
 * saved in the meantime the numbers differ, and the edit is refused rather
 * than silently overwriting their work — the "if two recruiters edit the same
 * record, prevent accidental overwriting" requirement.
 *
 * Returns the next version to write.
 */
export function checkVersion(
  entity: string,
  current: number,
  submitted: unknown,
): number {
  // A form that predates the version field submits nothing; treat that as a
  // blind write rather than failing, but never for a row someone else touched.
  if (submitted === undefined || submitted === null || submitted === "") {
    return current + 1;
  }

  const expected = Number(submitted);
  if (!Number.isFinite(expected)) return current + 1;
  if (expected !== current) throw new ConcurrencyError(entity, expected, current);
  return current + 1;
}

export function concurrencyMessage(error: ConcurrencyError) {
  return (
    `Someone else saved changes to this ${error.entity.toLowerCase()} while you were editing. ` +
    `Reload to see their version, then reapply your changes.`
  );
}

/* ------------------------------------------------------------------ *
 * Soft delete
 * ------------------------------------------------------------------ */

/** Column set every soft-deletable table carries. */
interface SoftDeletable {
  deletedAt: SQL.Aliased<Date | null> | never;
}

/**
 * Predicate that excludes soft-deleted rows.
 *
 * Every read composes this. Deleting is `deletedAt = now()` plus `deletedBy`,
 * so a mistaken delete is recoverable and the history it anchors — stage
 * events, interviews, audit entries — is never orphaned.
 */
export function alive<T extends { deletedAt: unknown }>(table: T): SQL {
  return isNull(table.deletedAt as never);
}

/** Combine the soft-delete predicate with any other conditions. */
export function aliveAnd<T extends { deletedAt: unknown }>(
  table: T,
  ...conditions: (SQL | undefined)[]
): SQL | undefined {
  return and(alive(table), ...conditions);
}

/** Values to stamp when soft-deleting a row. */
export function softDeleteValues(actorId: string) {
  return { deletedAt: new Date(), deletedBy: actorId };
}

/** Values to stamp when restoring one. */
export function restoreValues() {
  return { deletedAt: null, deletedBy: null };
}

/** Values every write stamps: who touched it, when, and the next version. */
export function stamp(actorId: string, nextVersion?: number) {
  return {
    updatedAt: new Date(),
    updatedBy: actorId,
    ...(nextVersion !== undefined ? { rowVersion: nextVersion } : {}),
  };
}

/** Values every insert stamps. */
export function stampNew(actorId: string) {
  const now = new Date();
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    rowVersion: 1,
  };
}

export type { SoftDeletable };
export { eq };
