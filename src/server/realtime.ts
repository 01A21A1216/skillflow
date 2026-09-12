import "server-only";

import { Client } from "pg";
import { sql } from "drizzle-orm";

import { CONNECTION, db } from "@/db";

/**
 * Live updates across every open browser (§1, item 4.1).
 *
 * "All updates must immediately appear for other authorized users." Until now
 * a mutation revalidated only for the person who made it; everybody else saw
 * stale data until they navigated. This closes that.
 *
 * ## What is sent
 *
 * **A hint, never data.** An event says "a submission changed, on this
 * requirement, by this person" and nothing more. The browser responds by
 * asking the server to re-render, which goes through the same scoped queries
 * the page always used, with the viewer's own permissions applied.
 *
 * That is the whole security design, and it is why the alternative — pushing
 * the changed rows down the socket — was not built. Pushing data would mean
 * re-deriving "who may see this" in the broadcast path, a second
 * implementation of the row scoping that would have to stay in step with the
 * first for ever. One stale branch there is a data leak. Pushing a hint means
 * the only thing that can go wrong is a wasted refresh.
 *
 * ## How it crosses processes
 *
 * Postgres `LISTEN`/`NOTIFY`. Several application instances behind a load
 * balancer each hold connections from different people, and an in-memory
 * event emitter would only ever reach the instance that handled the write.
 * The database is already the thing every instance shares, and `NOTIFY` is
 * transactional — the event is delivered when the transaction commits, and
 * not at all if it rolls back, so nobody is ever told about a change that did
 * not happen.
 *
 * One `LISTEN` connection per process, fanned out in memory to every stream.
 * A connection per browser tab would exhaust the database long before it
 * exhausted the web tier.
 */

export const CHANNEL = "rcc_changes";

export interface ChangeEvent {
  /** What kind of record: "submission", "requisition", "interview", … */
  entity: string;
  entityId: string;
  /** Who did it, so their own browser can ignore the echo. */
  actorId: string | null;
  /**
   * Extra ids the change is *about*, so a page showing one requirement can
   * ignore a change to a different one. Kept small — this rides in a Postgres
   * notification, which has an 8000-byte ceiling.
   */
  scope?: Record<string, string>;
  at: number;
}

/* ------------------------------------------------------------------ *
 * Publishing
 * ------------------------------------------------------------------ */

/**
 * Announce a change.
 *
 * Never throws. A mutation that succeeded must not be reported as failed
 * because nobody could be told about it — the same reasoning as `notify()`
 * and the job queue. The worst case is that other people's screens stay stale
 * until they navigate, which is exactly where the product was before this.
 */
export async function publish(event: Omit<ChangeEvent, "at">) {
  const payload = JSON.stringify({ ...event, at: Date.now() });

  // Postgres refuses a payload over 8000 bytes. Nothing here should come
  // close, but a truncated event is worse than none: it would arrive as
  // unparseable JSON on every listener.
  if (payload.length > 7000) {
    console.warn("[realtime] event too large to publish:", event.entity, event.entityId);
    return;
  }

  try {
    await db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
  } catch (error) {
    console.error("[realtime] publish failed:", error);
  }
}

/* ------------------------------------------------------------------ *
 * Listening
 * ------------------------------------------------------------------ */

type Listener = (event: ChangeEvent) => void;

interface Hub {
  client: Client | null;
  listeners: Set<Listener>;
  connecting: Promise<void> | null;
}

// On `globalThis` because Next re-evaluates modules on hot reload, and a
// second listening client per edit would leak connections until the database
// refused new ones.
const globalForHub = globalThis as unknown as { __rccHub?: Hub };
const hub: Hub = (globalForHub.__rccHub ??= { client: null, listeners: new Set(), connecting: null });

async function connect() {
  if (hub.client) return;
  if (hub.connecting) return hub.connecting;

  hub.connecting = (async () => {
    // A dedicated client, not one borrowed from the pool: `LISTEN` binds to a
    // session, and a pooled connection handed back to somebody else would
    // stop listening without saying so.
    const client = new Client({ connectionString: CONNECTION });

    client.on("notification", (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      let event: ChangeEvent;
      try {
        event = JSON.parse(message.payload) as ChangeEvent;
      } catch {
        return;
      }
      for (const listener of hub.listeners) {
        try {
          listener(event);
        } catch (error) {
          // One broken stream must not stop the others being told.
          console.error("[realtime] listener failed:", error);
        }
      }
    });

    client.on("error", (error) => {
      console.error("[realtime] listen connection lost:", error.message);
      hub.client = null;
      // Not reconnected here. The next subscriber reconnects, and in the
      // meantime every browser's `EventSource` is already reconnecting on its
      // own — retrying in two places races and doubles connections.
      void client.end().catch(() => {});
    });

    await client.connect();
    await client.query(`listen ${CHANNEL}`);
    hub.client = client;
  })();

  try {
    await hub.connecting;
  } finally {
    hub.connecting = null;
  }
}

/** Receive every change this process hears about. Returns an unsubscribe. */
export async function subscribe(listener: Listener): Promise<() => void> {
  await connect();
  hub.listeners.add(listener);
  return () => {
    hub.listeners.delete(listener);
    // The connection is deliberately kept when the last listener goes. A busy
    // application opens and closes streams constantly, and reconnecting to
    // Postgres on each one costs more than one idle session.
  };
}

/** For the settings screen: whether this process is actually listening. */
export function realtimeStatus() {
  return { connected: hub.client !== null, streams: hub.listeners.size };
}
