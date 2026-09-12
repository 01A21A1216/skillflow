"use client";

import { Fragment, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";

import { setRolePermission } from "@/server/actions/permissions";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

export interface MatrixRole {
  key: string;
  label: string;
}

export interface MatrixPermission {
  key: string;
  label: string;
  description: string;
  category: string;
  sensitive: boolean;
}

/**
 * The permission matrix, editable (§2, §3).
 *
 * A grid of toggles rather than a form with a Save button, because each cell
 * is independent and a whole-grid save would let two administrators silently
 * undo each other. Each click is its own action and its own audit entry, which
 * names the role and the permission rather than saying "settings changed".
 *
 * The optimistic update matters more here than it looks: the server has to
 * refuse some of these — revoking the last hold on settings management — and
 * an optimistic cell that snaps back with a toast explaining why is a much
 * clearer answer than a checkbox that appears to work and silently does not.
 */
export function PermissionMatrix({
  roles,
  permissions,
  granted,
}: {
  roles: MatrixRole[];
  permissions: MatrixPermission[];
  /** `${roleKey}|${permissionKey}` for every grant. */
  granted: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const [cells, toggle] = useOptimistic(new Set(granted), (current, cell: string) => {
    const next = new Set(current);
    if (next.has(cell)) next.delete(cell);
    else next.add(cell);
    return next;
  });

  async function set(roleKey: string, permissionKey: string, nowGranted: boolean) {
    const cell = `${roleKey}|${permissionKey}`;
    setBusy(cell);

    const fd = new FormData();
    fd.set("roleKey", roleKey);
    fd.set("permissionKey", permissionKey);
    // An unchecked checkbox is absent from FormData, so "off" is the empty
    // string rather than "false".
    fd.set("granted", nowGranted ? "true" : "");

    const result = await setRolePermission({ ok: false }, fd);
    setBusy(null);

    if (!result.ok) {
      toast({ kind: "error", title: "Not changed", description: result.message });
    }
    // Refreshed either way: on success to pick up the new grant, on failure to
    // discard the optimistic one.
    router.refresh();
  }

  // Grouped, because twenty-odd permissions in one undifferentiated list is a
  // wall. The categories are the ones the permission definitions already carry.
  const categories = [...new Set(permissions.map((p) => p.category))];

  return (
    <TableShell>
      <Table>
        <thead>
          <Tr>
            <Th>Permission</Th>
            {roles.map((r) => (
              <Th key={r.key} align="center">
                {r.label}
              </Th>
            ))}
          </Tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <Fragment key={category}>
              <Tr>
                <Td colSpan={roles.length + 1}>
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
                    {category}
                  </span>
                </Td>
              </Tr>
              {permissions
                .filter((p) => p.category === category)
                .map((p) => (
                  <Tr key={p.key}>
                    <Td>
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-content">
                        {p.label}
                        {p.sensitive ? (
                          <Lock
                            className="size-3 text-[hsl(var(--tone-amber))]"
                            aria-label="sensitive"
                          />
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-content-subtle">{p.description}</p>
                    </Td>
                    {roles.map((r) => {
                      const cell = `${r.key}|${p.key}`;
                      const on = cells.has(cell);
                      return (
                        <Td key={r.key} align="center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${p.label} for ${r.label}`}
                            disabled={busy === cell}
                            onClick={() => {
                              startTransition(async () => {
                                toggle(cell);
                                await set(r.key, p.key, !on);
                              });
                            }}
                            className={`inline-flex size-5 items-center justify-center rounded-md border transition-colors disabled:opacity-50 ${
                              on
                                ? "border-transparent bg-[hsl(var(--tone-emerald))] text-white"
                                : "border-border-strong bg-surface hover:bg-surface-muted"
                            }`}
                          >
                            {on ? <Check className="size-3" strokeWidth={3} /> : null}
                          </button>
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </TableShell>
  );
}
