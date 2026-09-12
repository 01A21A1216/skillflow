import "server-only";

import { randomUUID } from "node:crypto";

import { handlerFor } from "./handlers";
import { claim, fail, succeed } from "./queue";
import { scheduleDue } from "./schedule";

/**
 * The worker loop (§22).
 *
 * In-process, started once from `instrumentation.ts`, which Next runs a single
 * time per server instance. That is the honest shape for this deployment: one
 * Node process serving the application, and the work it needs done is three
 * sweeps and the occasional outbound call. A separate worker process is the
 * right answer at a scale this is not at, and moving to one changes this file
 * and nothing else — handlers take a payload and return nothing, and the queue
 * is a table any process can reach.
 *
 * What it does buy, which running sweeps on page render did not:
 *
 * - the work happens whether or not anybody is looking at a screen;
 * - a failure is retried with backoff instead of disappearing;
 * - a failure that will not resolve is visible as a row rather than a log line
 *   in a container that has since been replaced;
 * - a recruiter's navigation is not waiting on three table scans.
 */

const POLL_MS = Number(process.env.JOB_POLL_MS ?? 15_000);
const BATCH = Number(process.env.JOB_BATCH ?? 5);
/**
 * Most jobs a single pass will run.
 *
 * A pass keeps claiming until the queue comes back short, so a burst drains in
 * one tick rather than five at a time every fifteen seconds — one sweep can
 * produce dozens of deliveries, and a notification that arrives a minute late
 * because the worker was pacing itself is a notification that did not work.
 * The cap is there so a pathological backlog cannot occupy the loop
 * indefinitely; whatever is left is simply picked up next tick.
 */
const MAX_PER_TICK = Number(process.env.JOB_MAX_PER_TICK ?? 50);

/** Identifies this process's claims, so a crashed instance's rows are legible. */
const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * One pass: schedule anything due, then run what is claimable.
 *
 * Exported so the settings screen can run a pass on demand, which is how an
 * administrator checks the queue works without waiting a poll interval.
 */
export async function tick() {
  await scheduleDue();

  let claimed = 0;
  let ran = 0;

  while (claimed < MAX_PER_TICK) {
    const batch = await claim(WORKER_ID, Math.min(BATCH, MAX_PER_TICK - claimed));
    if (!batch.length) break;
    claimed += batch.length;

    for (const job of batch) {
      const startedAt = Date.now();
      try {
        await handlerFor(job.kind)(job.payload);
        await succeed(job.id, Date.now() - startedAt);
        ran += 1;
      } catch (error) {
        // Never rethrown. A handler that throws must not take down the loop;
        // that is the difference between one job failing and all of them
        // stopping, and the second is much harder to notice.
        await fail(job, error, Date.now() - startedAt);
      }
    }
  }

  return { claimed, ran };
}

const globalForWorker = globalThis as unknown as { __rccWorker?: NodeJS.Timeout };

/**
 * Start polling.
 *
 * Guarded on `globalThis` because Next re-evaluates modules on hot reload, and
 * a second interval would double every sweep. `unref()` so an interval never
 * holds the process open during a shutdown — a job half-run is retried, and a
 * container that will not exit is worse.
 */
export function startWorker() {
  if (globalForWorker.__rccWorker) return;

  const run = () => {
    void tick().catch((error) => console.error("[jobs] tick failed:", error));
  };

  const timer = setInterval(run, POLL_MS);
  timer.unref();
  globalForWorker.__rccWorker = timer;

  // The first pass is delayed rather than immediate: a server that has just
  // started is answering its first requests, and three table scans is not what
  // it should be doing with them.
  setTimeout(run, 5_000).unref();

  console.info(`[jobs] worker ${WORKER_ID} polling every ${POLL_MS / 1000}s`);
}
