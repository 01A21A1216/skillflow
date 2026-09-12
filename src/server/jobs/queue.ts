import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs, type Job } from "@/db/schema";

import type { JobKind } from "./handlers";

/**
 * A durable work queue on top of Postgres (§22).
 *
 * The three operations a queue needs are enqueue, claim and settle, and all
 * three are one statement each. The interesting one is `claim`:
 *
 *   select … for update skip locked
 *
 * which hands each worker a disjoint set of rows without any worker waiting on
 * another, and without a claimed row being invisible to a reader. Two server
 * instances polling the same table therefore share the work correctly with no
 * coordination, no leader election and no lock table of our own.
 *
 * What this deliberately is not: a general-purpose job system. There is no
 * priority, no fan-out, no chaining. Those are real features and every one of
 * them is a reason this file would grow a scheduler of its own. The moment the
 * work outgrows a table is the moment to move to something built for it — and
 * because handlers take a payload and return nothing, that move does not touch
 * the handlers.
 */

/** Retry backoff: 30s, 2m, 8m, 32m, capped. Deterministic, so it is testable. */
export function backoffMs(attempt: number) {
  const base = 30_000 * 4 ** Math.max(0, attempt - 1);
  return Math.min(base, 60 * 60_000);
}

export interface EnqueueOptions {
  /**
   * Typed against the handler registry, so enqueueing work nothing can run
   * does not compile. The alternative is a row that waits for ever and a
   * user-visible effect that silently never happens.
   */
  kind: JobKind;
  payload?: Record<string, unknown>;
  /** Not before this instant. Defaults to now. */
  runAt?: Date;
  /** Stable for the work. A second enqueue with the same key is dropped. */
  dedupeKey?: string;
  maxAttempts?: number;
}

/**
 * Put work on the queue.
 *
 * Never throws. A caller that has already committed the user's change must not
 * fail because the follow-up work could not be queued — the same reasoning as
 * `notify()`. It returns the job id, or null if nothing was written, so a
 * caller that does care can tell.
 */
export async function enqueue(options: EnqueueOptions): Promise<string | null> {
  const id = `job_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  try {
    const [row] = await db
      .insert(jobs)
      .values({
        id,
        kind: options.kind,
        payload: options.payload ?? {},
        runAt: options.runAt ?? new Date(),
        dedupeKey: options.dedupeKey ?? null,
        maxAttempts: options.maxAttempts ?? 5,
      })
      // The unique index on dedupeKey is what makes scheduling idempotent
      // across instances; a collision is the expected case, not an error.
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    return row?.id ?? null;
  } catch (error) {
    console.error("[jobs] enqueue failed:", error);
    return null;
  }
}

/**
 * Take up to `limit` due jobs for this worker.
 *
 * `skip locked` is doing the work here: a row another transaction is already
 * claiming is passed over rather than waited on, so two workers polling
 * simultaneously never serialise behind each other.
 *
 * A job whose lock is older than `staleAfterMs` is reclaimable. That is how a
 * worker that died mid-job releases its work: not by cleaning up — a crashed
 * process cannot — but by its lock ageing out. The window has to be longer
 * than any handler's honest runtime, or a slow job gets run twice.
 */
export async function claim(workerId: string, limit = 5, staleAfterMs = 5 * 60_000) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleAfterMs);

  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      or(
        and(eq(jobs.status, "pending"), lte(jobs.runAt, now)),
        and(eq(jobs.status, "running"), lt(jobs.lockedAt, staleBefore)),
      ),
    )
    .orderBy(jobs.runAt)
    .limit(limit)
    .for("update", { skipLocked: true });

  return db
    .update(jobs)
    .set({
      status: "running",
      lockedAt: now,
      lockedBy: workerId,
      attempts: sql`${jobs.attempts} + 1`,
    })
    .where(inArray(jobs.id, due))
    .returning();
}

/** A job that ran cleanly. Kept, not deleted — see `sweepFinished`. */
export async function succeed(id: string, durationMs: number) {
  await db
    .update(jobs)
    .set({ status: "done", finishedAt: new Date(), durationMs, lastError: null, lockedBy: null })
    .where(eq(jobs.id, id));
}

/**
 * A job that threw.
 *
 * Back to pending with a delay while attempts remain; dead-lettered as
 * `failed` once they are exhausted. A failed row is never silently dropped —
 * it is the only record that something the user expected to happen did not.
 */
export async function fail(job: Job, error: unknown, durationMs: number) {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  await db
    .update(jobs)
    .set({
      status: exhausted ? "failed" : "pending",
      runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
      lastError: message.slice(0, 1000),
      durationMs,
      lockedBy: null,
      lockedAt: null,
      finishedAt: exhausted ? new Date() : null,
    })
    .where(eq(jobs.id, job.id));

  if (exhausted) {
    console.error(`[jobs] ${job.kind} (${job.id}) failed permanently: ${message}`);
  }
}

/**
 * Discard finished work older than a day.
 *
 * Completed rows are kept for a day rather than deleted on completion, because
 * "did the sweep run this morning?" is a question somebody asks, and a queue
 * that empties itself cannot answer it. Failures are kept far longer, for the
 * same reason inverted.
 */
export async function sweepFinished(doneAfterMs = 24 * 3_600_000, failedAfterMs = 30 * 86_400_000) {
  const now = Date.now();
  await db
    .delete(jobs)
    .where(
      and(eq(jobs.status, "done"), lte(jobs.finishedAt, new Date(now - doneAfterMs))),
    );
  await db
    .delete(jobs)
    .where(
      and(eq(jobs.status, "failed"), lte(jobs.finishedAt, new Date(now - failedAfterMs))),
    );
}

/* ------------------------------------------------------------------ *
 * Visibility
 * ------------------------------------------------------------------ */

export interface QueueHealth {
  counts: { pending: number; running: number; done: number; failed: number };
  /**
   * How long the oldest *due* job has been waiting, in seconds.
   *
   * The number that matters: it is queue depth in the only unit anybody
   * cares about. Steadily rising means the worker cannot keep up; null means
   * nothing is waiting.
   */
  oldestPendingSeconds: number | null;
  recent: {
    id: string;
    kind: string;
    status: string;
    attempts: number;
    durationMs: number | null;
    lastError: string | null;
    finishedAt: Date | null;
    runAt: Date;
  }[];
}

export async function queueHealth(): Promise<QueueHealth> {
  const byStatus = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);

  const counts = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const row of byStatus) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = row.n;
  }

  // Only jobs that are actually due. A retry scheduled for two minutes from
  // now is not a backlog, and counting it as one would make a healthy queue
  // look permanently behind.
  const [oldest] = await db
    .select({ runAt: jobs.runAt })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, new Date())))
    .orderBy(jobs.runAt)
    .limit(1);

  const fields = {
    id: jobs.id,
    kind: jobs.kind,
    status: jobs.status,
    attempts: jobs.attempts,
    durationMs: jobs.durationMs,
    lastError: jobs.lastError,
    finishedAt: jobs.finishedAt,
    runAt: jobs.runAt,
  };

  /** Newest first, by when the row last did something. */
  const lastActivity = sql`coalesce(${jobs.finishedAt}, ${jobs.runAt})`;

  /**
   * The last run of each kind.
   *
   * `distinct on` rather than a plain list of recent rows, because a burst of
   * twenty deliveries would otherwise fill the table and hide the fact that a
   * sweep has not run since yesterday. The question this answers is "is each
   * kind of work happening?", and one row per kind is exactly that question.
   */
  const perKind = await db
    .selectDistinctOn([jobs.kind], fields)
    .from(jobs)
    .orderBy(jobs.kind, desc(lastActivity));

  /**
   * Failures, separately.
   *
   * A dead-lettered job is the one thing that must not be crowded out by
   * whatever ran most recently — it is the only record that something a user
   * expected to happen did not.
   */
  const failures = await db
    .select(fields)
    .from(jobs)
    .where(eq(jobs.status, "failed"))
    .orderBy(desc(lastActivity))
    .limit(5);

  const seen = new Set<string>();
  const recent = [...failures, ...perKind]
    .filter((row) => !seen.has(row.id) && seen.add(row.id))
    .sort((a, b) => (b.finishedAt ?? b.runAt).getTime() - (a.finishedAt ?? a.runAt).getTime());

  return {
    counts,
    oldestPendingSeconds: oldest
      ? Math.max(0, Math.round((Date.now() - oldest.runAt.getTime()) / 1000))
      : null,
    recent,
  };
}
