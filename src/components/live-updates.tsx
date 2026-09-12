"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keep this browser in step with everybody else's changes (§1, item 4.1).
 *
 * Mounted once in the app shell. It opens the event stream, and when somebody
 * else changes something it calls `router.refresh()` — which re-renders the
 * server components of whatever page is open, through the same scoped queries
 * and with this viewer's permissions. Nothing about the change comes down the
 * wire except that it happened.
 *
 * Three decisions keep it from being annoying, which is the real risk with
 * live updates:
 *
 * **Your own changes are ignored.** The action you just took already updated
 * your screen. Refreshing again on the echo would fight your own optimistic
 * update and make a drag-and-drop flicker.
 *
 * **Bursts collapse.** Accepting an offer writes a submission, a requisition
 * and an activity in quick succession. That is one thing happening, and it
 * should cost one refresh.
 *
 * **A refresh never interrupts.** `router.refresh()` re-renders in the
 * background and swaps the result in; it does not scroll, does not lose focus
 * and does not discard what somebody is typing into a form.
 */

/** Long enough that a burst becomes one refresh; short enough to feel live. */
const DEBOUNCE_MS = 400;

interface ChangeEvent {
  entity: string;
  entityId: string;
  actorId: string | null;
  scope?: Record<string, string>;
  at: number;
}

export function LiveUpdates({ actorId }: { actorId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");

    source.onopen = () => setConnected(true);

    source.onmessage = (message) => {
      let event: ChangeEvent;
      try {
        event = JSON.parse(message.data) as ChangeEvent;
      } catch {
        return;
      }

      // Their own echo. Their screen is already right.
      if (event.actorId === actorId) return;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), DEBOUNCE_MS);
    };

    source.onerror = () => {
      // `EventSource` reconnects on its own with backoff; this only reflects
      // the state. Closing and reopening here would fight that and, on a
      // flaky connection, produce a reconnect storm.
      setConnected(false);
    };

    return () => {
      if (timer.current) clearTimeout(timer.current);
      source.close();
    };
  }, [actorId, router]);

  /*
   * Announced, not shown.
   *
   * A permanent "live" badge is visual noise about something that should
   * simply work, but a screen-reader user needs to know the page updates
   * underneath them — otherwise content changes with no explanation. The
   * status is also worth exposing for a test to assert on.
   */
  return (
    <div
      data-live={connected ? "connected" : "reconnecting"}
      aria-live="polite"
      className="sr-only"
    >
      {connected ? "Live updates are on." : "Reconnecting to live updates."}
    </div>
  );
}
