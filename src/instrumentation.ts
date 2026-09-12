/**
 * Runs once when a server instance starts, before it takes requests.
 *
 * The only thing registered here is the job worker (item 4.2). It is guarded
 * on the runtime because `instrumentation.ts` is also evaluated on the Edge
 * runtime, where there is no `setInterval` worth having and no database
 * connection to claim jobs with.
 *
 * Disabled by `JOB_WORKER=off`, which is how a deployment that runs a separate
 * worker process stops every web instance from also polling.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.JOB_WORKER === "off") return;

  const { startWorker } = await import("@/server/jobs/worker");
  startWorker();
}
