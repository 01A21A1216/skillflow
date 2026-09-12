import { AppShell } from "@/components/layout/app-shell";
import { permissionSet } from "@/server/authz";
import { requireUser } from "@/server/session";
import {
  activePipelineCount,
  openOfferCount,
  openRequisitionCount,
  weekInterviewCount,
} from "@/server/queries/dashboard";
import { loadPipeline } from "@/server/pipeline";
import { PipelineProvider } from "@/components/domain/pipeline-context";
import { inbox, unreadCount, NOTIFICATION_TYPES, type NotificationType } from "@/server/notify";

/**
 * Every authenticated route renders through here, so the session check cannot
 * be forgotten on a new page. Counts are scoped to the actor, which is why
 * they are fetched after `requireUser()` rather than in the root layout.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const granted = permissionSet(actor);

  // Four `count(*)` queries, in parallel. They are badges on every page, so
  // both halves of that matter: they must not each build a list to measure it,
  // and they must not wait for each other.
  const [requisitions, pipelineCount, interviewsThisWeek, offers] = await Promise.all([
    openRequisitionCount(actor),
    activePipelineCount(actor),
    weekInterviewCount(actor),
    openOfferCount(actor),
  ]);
  const counts = {
    requisitions,
    pipeline: pipelineCount,
    interviews: interviewsThisWeek,
    offers,
  };

  // Published once here rather than fetched by each board, picker and badge.
  const pipeline = await loadPipeline();

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
