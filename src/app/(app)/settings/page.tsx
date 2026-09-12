import type { Metadata } from "next";
import { KanbanSquare, Plug, ShieldCheck, ShieldOff, SlidersHorizontal, Timer } from "lucide-react";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { submissions } from "@/db/schema";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StageKindBadge } from "@/components/domain/badges";
import { RunJobsButton } from "@/components/domain/forms/run-jobs-button";
import {
  NewScorecardButton,
  ScorecardRowActions,
  type ScorecardRow,
} from "@/components/domain/forms/scorecard-form";
import {
  NewStageButton,
  StageRowActions,
  type StageRow,
} from "@/components/domain/forms/stage-form";
import { integrationStatus } from "@/server/integrations/ports";
import { queueHealth } from "@/server/jobs/queue";
import { erasureLog, RETENTION } from "@/server/privacy";
import { RECURRING } from "@/server/jobs/schedule";
import { listStageRows } from "@/server/pipeline";
import { scorecardSettings } from "@/server/queries/scorecards";
import { permissionMatrixView } from "@/server/queries/people";
import { PermissionMatrix } from "@/components/domain/permission-matrix";
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
  const scorecards = await scorecardSettings();
  const matrix = await permissionMatrixView();
  const integrations = integrationStatus();
  const queue = await queueHealth();
  const erasures = await erasureLog();

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

  const scorecardRows: ScorecardRow[] = scorecards.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.isDefault,
    active: t.active,
    criteria: t.criteria,
    usedBy: t.usedBy,
    scored: t.scored,
  }));

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
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
            <CardHeader
              icon={<SlidersHorizontal className="size-4" />}
              title="Scorecards"
              description="What interview panels score against. A requirement picks one; the default covers the rest."
            />
            <NewScorecardButton />
          </div>
          <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
            {scorecardRows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13.5px] font-medium text-content">{t.name}</p>
                    {t.isDefault ? (
                      <Badge tone="emerald" size="sm">
                        default
                      </Badge>
                    ) : null}
                    {!t.active ? (
                      <Badge tone="neutral" size="sm" variant="outline">
                        off
                      </Badge>
                    ) : null}
                    {t.usedBy ? (
                      <span className="text-[11.5px] text-content-subtle">
                        {t.usedBy} requirement{t.usedBy === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  {t.description ? (
                    <p className="mt-0.5 text-[12px] text-content-subtle">{t.description}</p>
                  ) : null}
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
                </div>
                <ScorecardRowActions template={t} />
              </li>
            ))}
          </ul>
          <p className="border-t border-border-base px-5 py-3 text-[12px] leading-relaxed text-content-subtle">
            Labels and descriptions can be reworded freely: a scorecard already filed keeps the
            wording its author saw, because it stores the template it was scored against. A
            competency&rsquo;s <em>key</em> cannot change once a panel has scored on it &mdash;
            the scores are stored under it &mdash; so those are shown locked, and a scorecard
            with history is switched off rather than deleted.
          </p>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              icon={<ShieldCheck className="size-4" />}
              title="Roles and permissions"
              description="Permissions are rows, not code. This is what each role currently holds."
            />
          </div>
          <PermissionMatrix
            roles={matrix.roles}
            permissions={matrix.permissions}
            granted={matrix.granted}
          />

          <p className="border-t border-border-base px-5 py-3 text-[12px] leading-relaxed text-content-subtle">
            Every toggle saves on its own and writes its own audit entry naming the role and the
            permission &mdash; a single Save for the whole grid would let two administrators
            editing at once quietly undo each other. Changes take effect on the next request; no
            restart, no re-seed. One thing is refused: revoking the last hold on{" "}
            <strong>Manage settings</strong>, which would leave nobody able to change this again.
          </p>
        </Card>
        <Card padded={false}>
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
            <CardHeader
              icon={<Timer className="size-4" />}
              title="Background work"
              description="The sweeps that produce notifications nobody's action causes, and the outbound calls that should not make anyone wait."
            />
            <RunJobsButton />
          </div>

          <div className="grid grid-cols-2 gap-px border-y border-border-base bg-[hsl(var(--border))] sm:grid-cols-5">
            {[
              { label: "Waiting", value: queue.counts.pending },
              { label: "Running", value: queue.counts.running },
              { label: "Done today", value: queue.counts.done },
              { label: "Failed", value: queue.counts.failed, alarming: queue.counts.failed > 0 },
              {
                label: "Oldest waiting",
                value:
                  queue.oldestPendingSeconds === null
                    ? "—"
                    : queue.oldestPendingSeconds < 90
                      ? `${queue.oldestPendingSeconds}s`
                      : `${Math.round(queue.oldestPendingSeconds / 60)}m`,
                alarming: (queue.oldestPendingSeconds ?? 0) > 600,
              },
            ].map((stat) => (
              <div key={stat.label} className="bg-surface px-5 py-3.5">
                <p
                  className={`text-[18px] font-semibold tabular-nums ${
                    stat.alarming ? "text-[hsl(var(--tone-rose))]" : "text-content"
                  }`}
                >
                  {stat.value}
                </p>
                <p className="mt-0.5 text-[11.5px] text-content-subtle">{stat.label}</p>
              </div>
            ))}
          </div>

          <ul className="divide-y divide-[hsl(var(--border))]">
            {RECURRING.map((job) => (
              <li key={job.kind} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                <span className="font-mono text-[11.5px] text-content-muted">{job.kind}</span>
                <span className="min-w-0 flex-1 text-[12.5px] text-content-subtle">
                  {job.description}
                </span>
                <Badge tone="neutral" size="sm" variant="outline">
                  {job.everyMinutes >= 60
                    ? `every ${job.everyMinutes / 60}h`
                    : `every ${job.everyMinutes}m`}
                </Badge>
              </li>
            ))}
          </ul>

          {queue.recent.length ? (
            <TableShell>
              <Table>
                <thead>
                  <Tr>
                    <Th>Last run of each kind</Th>
                    <Th align="center">Tries</Th>
                    <Th align="right">Took</Th>
                    <Th align="right">When</Th>
                  </Tr>
                </thead>
                <tbody>
                  {queue.recent.map((job) => (
                    <Tr key={job.id}>
                      <Td>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11.5px] text-content">{job.kind}</span>
                          <Badge
                            tone={
                              job.status === "failed"
                                ? "rose"
                                : job.status === "done"
                                  ? "emerald"
                                  : job.status === "running"
                                    ? "cyan"
                                    : "neutral"
                            }
                            size="sm"
                            variant={job.status === "pending" ? "outline" : "solid"}
                          >
                            {job.status}
                          </Badge>
                        </div>
                        {job.lastError ? (
                          <p className="mt-1 text-[11.5px] text-[hsl(var(--tone-rose))]">
                            {job.lastError}
                          </p>
                        ) : null}
                      </Td>
                      <Td align="center">
                        <span className="text-[12.5px] text-content-muted tabular-nums">
                          {job.attempts}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="text-[12.5px] text-content-muted tabular-nums">
                          {job.durationMs === null ? "—" : `${job.durationMs}ms`}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="text-[12.5px] text-content-subtle tabular-nums">
                          {(job.finishedAt ?? job.runAt).toLocaleString()}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          ) : null}

          <p className="border-t border-border-base px-5 py-3 text-[12px] leading-relaxed text-content-subtle">
            The queue is a Postgres table claimed with{" "}
            <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[11px]">
              for update skip locked
            </code>
            , so several server instances share the work without coordinating. A job that throws
            is retried with a widening delay and, once its attempts run out, stays here as a
            failed row &mdash; the only record that something expected did not happen. Finished
            rows are kept for a day so &ldquo;did it run this morning?&rdquo; has an answer.
          </p>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              icon={<ShieldOff className="size-4" />}
              title="Data retention and erasure"
              description="How long personal data is kept, and what has been erased on request."
            />
          </div>

          <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
            {RETENTION.map((r) => (
              <li key={r.key} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-content">{r.label}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-content-subtle">
                    {r.description}
                  </p>
                </div>
                <Badge tone="neutral" size="sm" variant="outline">
                  {r.days >= 365
                    ? `${Math.round((r.days / 365) * 10) / 10} years`
                    : `${r.days} day${r.days === 1 ? "" : "s"}`}
                </Badge>
              </li>
            ))}
          </ul>

          {erasures.length ? (
            <TableShell>
              <Table>
                <thead>
                  <Tr>
                    <Th>Erased</Th>
                    <Th>Why</Th>
                    <Th align="right">When</Th>
                  </Tr>
                </thead>
                <tbody>
                  {erasures.map((e) => (
                    <Tr key={e.id}>
                      <Td>
                        <span className="font-mono text-[11.5px] text-content-muted">{e.id}</span>
                      </Td>
                      <Td>
                        <Badge tone={e.reason === "request" ? "rose" : "slate"} size="sm">
                          {e.reason === "request"
                            ? `on request${e.actorName ? ` · ${e.actorName}` : ""}`
                            : "retention policy"}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <span className="text-[12.5px] text-content-subtle tabular-nums">
                          {e.erasedAt?.toLocaleDateString()}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          ) : null}

          <p className="border-t border-border-base px-5 py-3 text-[12px] leading-relaxed text-content-subtle">
            Erasure is not the soft delete used elsewhere. It overwrites every identifying field,
            removes the documents from storage and clears the free text from notes, scorecards and
            the audit trail &mdash; and cannot be undone. What survives is the shape of each
            application, which is this organisation&rsquo;s own record of its hiring process and
            names nobody afterwards. Only a role holding <strong>Handle data-subject
            requests</strong> can do it; by default that is Super Admin alone.
            <br />
            <br />
            <strong className="text-content">Encryption at rest</strong> is a deployment control,
            not an application one: it belongs to the volume or the managed Postgres instance.
            Encrypting these columns in the application would put the key beside the data and
            break every search that makes the product work, which is security theatre rather than
            security.
          </p>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-4">
            <CardHeader
              icon={<Plug className="size-4" />}
              title="Outbound integrations"
              description="Where this workspace reaches outside itself. Nothing is configured, and the application is correct without any of it."
            />
          </div>
          <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
            {integrations.map((i) => (
              <li key={i.key} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-content">{i.label}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-content-subtle">
                    {i.purpose}
                  </p>
                </div>
                {i.provider === "none" ? (
                  <Badge tone="neutral" size="sm" variant="outline">
                    not connected
                  </Badge>
                ) : (
                  <Badge tone="emerald" size="sm">
                    {i.provider}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-border-base px-5 py-3 text-[12px] leading-relaxed text-content-subtle">
            Each of these is an interface with a no-op default, so scheduling an interview or
            opening a requirement already calls the right seam and simply sends nothing. A
            provider is added in one file. Until then the application says so rather than
            pretending an invite went out &mdash; the in-app record is the one it guarantees.
          </p>
        </Card>
      </PageBody>
    </>
  );
}
