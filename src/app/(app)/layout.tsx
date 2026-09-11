import { AppShell } from "@/components/layout/app-shell";
import { permissionSet } from "@/server/authz";
import { requireUser } from "@/server/session";
import {
  activePipelineCount,
  openOfferCount,
  openRequisitionCount,
} from "@/server/queries/dashboard";
import { listInterviews } from "@/server/queries/interviews";

/**
 * Every authenticated route renders through here, so the session check cannot
 * be forgotten on a new page. Counts are scoped to the actor, which is why
 * they are fetched after `requireUser()` rather than in the root layout.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const granted = permissionSet(actor);

  const counts = {
    requisitions: openRequisitionCount(actor),
    pipeline: activePipelineCount(actor),
    interviews: listInterviews({ window: "week" }, actor).length,
    offers: openOfferCount(actor),
  };

  return (
    <AppShell actor={actor} permissions={[...granted]} counts={counts}>
      {children}
    </AppShell>
  );
}
