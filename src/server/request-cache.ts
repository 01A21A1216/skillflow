import "server-only";

import { cache } from "react";

/**
 * Memoise a query for the duration of one request.
 *
 * React's `cache` memoises on argument *identity*, which is no use to a query
 * layer whose functions take a filter object: `listInterviews({ window:
 * "week" })` called from two sections of the dashboard passes two different
 * objects and runs twice. `cache` is still the right primitive, though —
 * applied to a `Map` it yields one map per request, and the key can then be
 * whatever actually identifies the work.
 *
 * The dashboard was the case that made this necessary. Its sections are
 * written independently, as they should be — each asks for what it needs
 * rather than receiving a prop-drilled bundle — and between them they were
 * asking for the same interview list four times, the same offer list three
 * times and the same requisition list three times, each with its own joins
 * and hydration.
 *
 * This is not a cache in the stale-data sense and must not be used as one.
 * The map lives and dies with the request: two people looking at the same
 * page each get their own reads, and a mutation is visible on the next
 * request. Anything longer-lived belongs in Postgres or in `revalidatePath`,
 * not here.
 */

const store = cache(() => new Map<string, Promise<unknown>>());

export function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const map = store();
  const existing = map.get(key);
  if (existing) return existing as Promise<T>;

  // The promise is stored, not the value, so concurrent callers share one
  // round trip rather than racing to start a second.
  const started = run();
  map.set(key, started);
  return started;
}

/**
 * A key for (function, filters, actor).
 *
 * The actor is reduced to their id because that is what the scope predicates
 * are built from; including the whole row would key on `updatedAt` and never
 * hit.
 */
export function queryKey(name: string, filters: unknown, actorId?: string) {
  return `${name}|${actorId ?? "-"}|${JSON.stringify(filters ?? {})}`;
}
