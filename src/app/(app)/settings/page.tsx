import type { Metadata } from "next";
import { KanbanSquare, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { submissions } from "@/db/schema";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StageKindBadge } from "@/components/domain/badges";
import {
  NewStageButton,
  StageRowActions,
  type StageRow,
} from "@/components/domain/forms/stage-form";
import { listStageRows } from "@/server/pipeline";
import { listScorecards } from "@/server/queries/scorecards";
import { permissionMatrixView } from "@/server/queries/people";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

/**
 * Configuration that changes how the application behaves, rather than what it
 * contains (§3).
 *
 * Pipeline stages are the substantial part: they were a compile-time constant
 * and are now rows an administrator owns. Everything here is read-your-writes —
 * an edit is visible on every board immediately, because the action clears the
 * cached pipeline rather than waiting for a restart.
 */
export default async function SettingsPage() {
  await requirePermission("settings.manage");

  const stages = await listStageRows();
  const scorecards = await listScorecards();
  const matrix = await permissionMatrixView();

  // How many people are standing in each stage, so a delete can be refused with
  // a reason rather than stranding them somewhere nothing renders.
  const occupancy = new Map<string, number>(
    (
      await db
        .select({ stage: submissions.stage, count: sql<number>`count(*)::int` })
        .from(submissions)
        .where(eq(submissions.status, "active"))
        .groupBy(submissions.stage)
    ).map((r) => [r.stage, r.count]),
  );

  const rows: StageRow[] = stages.map((s) => ({
    id: s.id,
    key: s.key,
    label: s.label,
    kind: s.kind,
    tone: s.tone,
    description: s.description,
    slaDays: s.slaDays,
    position: s.position,
    active: s.active,
    builtIn: s.builtIn,
    rowVersion: s.rowVersion,
    occupied: occupancy.get(s.key) ?? 0,
  }));

  const nextPosition = Math.max(-1, ...rows.map((r) => r.position)) + 1;

  return (
    <>
      <PageHeader
        title="Settings"
        description="How this workspace behaves: the pipeline every board renders, the scorecards panels fill in, and who can do what."
      />

      <PageBody>
        <Card padded={false}>
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
            <CardHeader
              icon={<KanbanSquare className="size-4" />}
              title="Pipeline stages"
              description="Rename, reorder, retune a target, switch one off, or add your own. Every board, funnel and report follows immediately."
            />
            <NewStageButton nextPosition={nextPosition} />
          </div>

          <TableShell>
            <Table>
              <thead>
                <Tr>
                  <Th>Stage</Th>
                  <Th>Phase</Th>
                  <Th align="center">Target</Th>
                  <Th align="center">Here now</Th>
                  <Th align="right">{""}</Th>
                </Tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="w-6 shrink-0 text-[11.5px] text-content-subtle tabular-nums">
                          {s.position}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-medium text-content">
                            {s.label}
                            {!s.active ? (
                              <span className="ml-2 text-[11px] font-normal text-content-subtle">
                                hidden
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-content-subtle">
                            {s.key}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <StageKindBadge value={s.kind} size="sm" />
                        {s.builtIn ? (
                          <Badge tone="neutral" size="sm" variant="outline">
                            built-in
                          </Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td align="center">
                      <span className="text-[12.5px] text-content-muted tabular-nums">
                        {s.slaDays ? `${s.slaDays}d` : "—"}
                      </span>
                    </Td>
                    <Td align="center">
                      <span className="text-[12.5px] text-content-muted tabular-nums">
                        {s.occupied}
                      </span>
                    </Td>
                    <Td align="right">
                      <StageRowActions stage={s} nextPosition={nextPosition} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableShell>

          <p className="border-t border-border-base px-5 py-3 text-[12px] leading-relaxed text-content-subtle">
            A stage&rsquo;s <strong>phase</strong> is what the application reasons about: when a
            candidate counts as submitted, which stages the interview sync owns, and what a
            requirement reports as its own status. Names and order are yours; phases are fixed
            for the built-in eleven so those rules cannot be rewritten by accident. Rejected,
            Withdrawn and On&nbsp;Hold are not listed because each one means something the
            application itself acts on.
          </p>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              icon={<SlidersHorizontal className="size-4" />}
              title="Scorecards"
              description="What interview panels score against. A requirement picks one; the default covers the rest."
            />
          </div>
          <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
            {scorecards.map((t) => (
              <li key={t.id ?? t.name} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13.5px] font-medium text-content">{t.name}</p>
                  {t.isDefault ? (
                    <Badge tone="emerald" size="sm">
                      default
                    </Badge>
                  ) : null}
                  {!t.active ? (
                    <Badge tone="neutral" size="sm" variant="outline">
                      inactive
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.criteria.map((c) => (
                    <span
                      key={c.key}
                      title={c.description}
                      className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-content-muted"
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              icon={<ShieldCheck className="size-4" />}
              title="Roles and permissions"
              description="Permissions are rows, not code. This is what each role currently holds."
            />
          </div>
          <TableShell>
            <Table>
              <thead>
                <Tr>
                  <Th>Permission</Th>
                  {matrix.roles.map((r) => (
                    <Th key={r.key} align="center">
                      {r.label}
                    </Th>
                  ))}
                </Tr>
              </thead>
              <tbody>
                {matrix.permissions.map((p) => (
                  <Tr key={p.key}>
                    <Td>
                      <p className="text-[13px] text-content">{p.label}</p>
                      <p className="mt-0.5 text-[11.5px] text-content-subtle">{p.description}</p>
                    </Td>
                    {matrix.roles.map((r) => (
                      <Td key={r.key} align="center">
                        {matrix.granted.has(`${r.key}|${p.key}`) ? (
                          <span
                            className="inline-block size-1.5 rounded-full bg-[hsl(var(--tone-emerald))]"
                            aria-label="granted"
                          />
                        ) : (
                          <span className="text-content-subtle" aria-label="not granted">
                            ·
                          </span>
                        )}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableShell>
          <p className="border-t border-border-base px-5 py-3 text-[12px] text-content-subtle">
            Editing the matrix in-app is still on the backlog; today it is changed in{" "}
            <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[11px]">
              src/lib/permissions.ts
            </code>{" "}
            and re-seeded. The rows above are read from the database, which is the runtime
            authority either way.
          </p>
        </Card>
      </PageBody>
    </>
  );
}
