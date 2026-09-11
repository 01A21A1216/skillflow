import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { PERMISSIONS, roleDef } from "@/lib/permissions";
import { LinkButton } from "@/components/ui/link-button";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireUser();
  const params = await searchParams;
  const key = Array.isArray(params.permission) ? params.permission[0] : params.permission;
  const permission = PERMISSIONS.find((p) => p.key === key);
  const role = roleDef(actor.role);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[hsl(var(--tone-amber-bg))] text-[hsl(var(--tone-amber))]">
          <ShieldAlert className="size-6" />
        </span>

        <h1 className="mt-4 text-lg font-semibold text-content">
          You do not have access to that
        </h1>

        <p className="mt-2 text-[13.5px] leading-relaxed text-content-muted">
          {permission ? (
            <>
              That page needs the <strong className="text-content">{permission.label}</strong>{" "}
              permission. Your role, {role?.label ?? actor.role}, does not include it.
            </>
          ) : (
            <>Your role, {role?.label ?? actor.role}, does not include the permission that page needs.</>
          )}
        </p>

        <p className="mt-3 text-[12.5px] text-content-subtle">
          If you think this is wrong, ask a recruitment manager to review your role.
        </p>

        <div className="mt-5 flex items-center justify-center gap-2">
          <LinkButton href="/" variant="primary" size="sm">
            Back to the dashboard
          </LinkButton>
          <LinkButton href={`/team/${actor.id}`} size="sm">
            My profile
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
