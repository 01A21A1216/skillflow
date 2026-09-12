import "server-only";

import type { JobKind } from "./handlers";
import { enqueue } from "./queue";

/**
 * Recurring work (§22).
 *
 * Not cron. Cron expressions buy flexibility this application does not need
 * and cost a parser, a timezone argument, and a class of bug where nobody can
 * say off the top of their head when a given expression next fires. Four jobs
 * run on a fixed period, and a period is a number.
 *
 * The scheduling is idempotent by construction rather than by coordination.
 * Every tick is named — `sweep.requirements@2026-09-11T14` — and that name is
 * the job's dedupe key, which the database holds a unique index on. Three
 * server instances all deciding at once that the 14:00 sweep is due therefore
 * produce one row, with no leader election and no distributed lock. A worker
 * that was down for the 14:00 tick and comes back at 14:20 enqueues it and it
 * runs late, which for a sweep is the correct behaviour.
 */

export interface Recurring {
  kind: JobKind;
  /** How often, in minutes. */
  everyMinutes: number;
  description: string;
}

export const RECURRING: Recurring[] = [
  {
    kind: "sweep.feedback_overdue",
    everyMinutes: 60,
    description: "Chase scorecards that are past their 24-hour window.",
  },
  {
    kind: "sweep.requirements",
    everyMinutes: 6 * 60,
    description: "Warn on requirements nearing their client SLA, escalate the ones past it.",
  },
  {
    kind: "sweep.idle_candidates",
    everyMinutes: 12 * 60,
    description: "Find live candidates who have not moved in a fortnight.",
  },
  {
    kind: "jobs.prune",
    everyMinutes: 24 * 60,
    description: "Discard finished job history so this table does not grow without bound.",
  },
];

/**
 * The slot a given instant falls into, as a stable string.
 *
 * Floored to the period so that every instance computes the same name for the
 * same tick. Always UTC: a schedule that shifts twice a year because the
 * server is in a DST zone is a schedule that skips or doubles a sweep, and
 * nothing here is tied to a human's local clock.
 */
export function slotKey(kind: string, everyMinutes: number, at: Date) {
  const period = everyMinutes * 60_000;
  const floored = Math.floor(at.getTime() / period) * period;
  return `${kind}@${new Date(floored).toISOString().slice(0, 16)}`;
}

/** Whether this tick is the first one this process has seen for that slot. */
export async function scheduleDue(now = new Date()) {
  const enqueued: string[] = [];

  for (const job of RECURRING) {
    const key = slotKey(job.kind, job.everyMinutes, now);
    const id = await enqueue({ kind: job.kind, dedupeKey: key, maxAttempts: 3 });
    if (id) enqueued.push(job.kind);
  }

  return enqueued;
}
