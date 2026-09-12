import "server-only";

import {
  interviewBooked,
  interviewChanged,
  requisitionClosed,
  requisitionPublished,
  sendEmail,
} from "@/server/integrations/outbound";
import { feedbackOverdueSweep, idleCandidateSweep, requirementSweep } from "@/server/sweeps";

import { sweepFinished } from "./queue";

/**
 * What the queue can be asked to do (§22).
 *
 * A closed registry, deliberately. A job kind that is not in this map fails
 * loudly rather than being skipped, because a payload sitting in the table
 * that nothing knows how to run is a silent data-loss bug — exactly the class
 * of failure a queue is supposed to make impossible.
 *
 * Two kinds of work qualify for this table, and the distinction is what
 * decides whether something belongs here at all:
 *
 * **Work nobody is waiting for.** The SLA sweeps are the clearest case. They
 * used to run on every page render, which was honest but wrong: three table
 * scans in the critical path of a navigation, to produce notifications about
 * things that changed at most once a day.
 *
 * **Work that talks to somebody else.** A calendar invite or a job-board post
 * is a network call to a system that can be down. On the request path that is
 * latency the recruiter pays for and a failure they cannot retry; here it is a
 * row with an attempt count and a backoff.
 *
 * What is *not* here is as considered. Resume parsing and candidate matching
 * happen while a person waits for their result on screen — moving them to a
 * queue would mean a spinner and a poll to deliver something that takes tens
 * of milliseconds in-process. In-app notification fan-out is a single insert
 * and stays inline for the same reason. "Make it a background job" is not
 * automatically an improvement; it is a trade of latency for durability, and
 * it is only worth making where durability is the thing that was missing.
 */

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const str = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Job payload is missing "${key}"`);
  }
  return value;
};

export const HANDLERS = {
  /* The periodic sweeps (§14). Each is separate so one failing does not
   * prevent the others, and so a slow one is visible by name. */
  "sweep.feedback_overdue": () => feedbackOverdueSweep(),
  "sweep.requirements": () => requirementSweep(),
  "sweep.idle_candidates": () => idleCandidateSweep(),

  /* Housekeeping on the queue itself. A queue that does not prune its own
   * history becomes the largest table in the database within a month. */
  "jobs.prune": () => sweepFinished(),

  /* Outbound integrations (§22). */
  "calendar.book": (p) => interviewBooked(str(p, "interviewId")),
  "calendar.change": (p) => interviewChanged(str(p, "interviewId"), str(p, "status")),
  "jobboard.publish": (p) => requisitionPublished(str(p, "requisitionId")),
  "jobboard.unpublish": (p) => requisitionClosed(str(p, "requisitionId")),

  "email.send": async (p) => {
    const to = p.to;
    if (!Array.isArray(to) || !to.length) throw new Error('Job payload is missing "to"');
    await sendEmail({
      idempotencyKey: str(p, "idempotencyKey"),
      to: to.map(String),
      subject: str(p, "subject"),
      body: typeof p.body === "string" ? p.body : "",
    });
  },
} satisfies Record<string, Handler>;

/**
 * The kinds that exist, derived from the registry rather than declared beside
 * it. `enqueue` takes this type, so a job that nothing can run is a
 * compile error rather than a row that sits in the table for ever.
 */
export type JobKind = keyof typeof HANDLERS;

export function handlerFor(kind: string): Handler {
  const handler = (HANDLERS as Record<string, Handler | undefined>)[kind];
  if (!handler) throw new Error(`No handler registered for job kind "${kind}"`);
  return handler;
}
