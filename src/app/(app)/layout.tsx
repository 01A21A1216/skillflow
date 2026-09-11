import { AppShell } from "@/components/layout/app-shell";
import { permissionSet } from "@/server/authz";
import { requireUser } from "@/server/session";
import {
  activePipelineCount,
  openOfferCount,
  openRequisitionCount,
} from "@/server/queries/dashboard";
import { listInterviews } from "@/server/queries/interviews";
import { loadPipeline } from "@/server/pipeline";
import { PipelineProvider } from "@/components/domain/pipeline-context";
import { inbox, unreadCount, NOTIFICATION_TYPES, type NotificationType } from "@/server/notify";
import { runSweeps } from "@/server/sweeps";

/**
 * Every authenticated route renders through here, so the session check cannot
 * be forgotten on a new page. Counts are scoped to the actor, which is why
 * they are fetched after `requireUser()` rather than in the root layout.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const granted = permissionSet(actor);

  const counts = {
    requisitions: await openRequisitionCount(actor),
    pipeline: await activePipelineCount(actor),
    interviews: (await listInterviews({ window: "week" }, actor)).length,
    offers: await openOfferCount(actor),
  };

  // Published once here rather than fetched by each board, picker and badge.
  const pipeline = await loadPipeline();

  // The sweeps that produce the "nothing happened" notifications (§14) run
  // here, because there is no scheduler yet (item 4.2) and pretending
  // otherwise would be worse than saying so. Every notification is
  // deduplicated on (person, fact), so running them per request is safe: the
  // second run writes nothing.
  await runSweeps();
  const notifications = await inbox(actor.id);
  const unread = await unreadCount(actor.id);

  return (
    <PipelineProvider stages={pipeline.all}>
      <AppShell
        actor={actor}
        permissions={[...granted]}
        counts={counts}
        unread={unread}
        notifications={notifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          href: n.href,
          createdAt: n.createdAt,
          readAt: n.readAt,
          tone: NOTIFICATION_TYPES[n.type as NotificationType]?.tone ?? "slate",
        }))}
      >
        {children}
      </AppShell>
    </PipelineProvider>
  );
}
