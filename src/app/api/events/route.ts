import { currentUser } from "@/server/session";
import { subscribe, type ChangeEvent } from "@/server/realtime";

export const dynamic = "force-dynamic";

/**
 * The live-update stream (§1, item 4.1).
 *
 * Server-sent events rather than a WebSocket. Everything here goes one way —
 * the browser never pushes, it calls server actions — and SSE is the protocol
 * for that: it is plain HTTP, it needs no custom server alongside Next, and
 * `EventSource` reconnects on its own with backoff. A WebSocket would buy
 * bidirectionality nobody needs, in exchange for an upgrade path through
 * every proxy and load balancer between here and the browser.
 *
 * Events carry a hint, never data: which kind of record changed, its id, who
 * changed it. The client turns that into `router.refresh()`, so what actually
 * arrives on screen is rendered by the same scoped queries as a normal
 * navigation, with this viewer's permissions. See `server/realtime.ts` for
 * why that indirection is the point rather than a limitation.
 */

/** Long enough to be idle-friendly, short enough to beat a 60s proxy timeout. */
const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const user = await currentUser();
  // 401 rather than a redirect: `EventSource` cannot follow one usefully, and
  // an HTML login page arriving on an event stream is a parse error rather
  // than a message the client can act on.
  if (!user) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (line: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          // The client went away between the check and the write. Nothing to
          // do but stop: `cancel` will run and clean up.
          closed = true;
        }
      };

      // An immediate comment flushes headers, so the browser fires `onopen`
      // now rather than when the first real change happens — which might be
      // hours. Without it a working connection is indistinguishable from a
      // hung one.
      send(": connected\n\n");

      unsubscribe = await subscribe((event: ChangeEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });

      // Proxies and load balancers close connections that say nothing. A
      // comment line is ignored by `EventSource` and costs two bytes.
      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      });
    },

    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx not to buffer, which would hold every event until the
      // buffer filled and make the whole feature look broken.
      "X-Accel-Buffering": "no",
    },
  });
}
