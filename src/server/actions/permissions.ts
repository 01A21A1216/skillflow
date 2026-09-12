"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { rolePermissions, users } from "@/db/schema";
import type { User } from "@/db/schema";
import { PERMISSION_KEYS, ROLES, type PermissionKey } from "@/lib/permissions";
import { rolePermissionSchema } from "@/lib/validation";
import { invalidatePermissionMatrix } from "@/server/authz";
import { fail, guarded, logActivity, newId, parseForm, succeed, type ActionState } from "./shared";

/**
 * Editing the permission matrix (§2, §3).
 *
 * The matrix has always been rows — that is what made it configurable — but
 * until now the only way to change it was to edit `permissions.ts` and
 * re-seed, which is not a product feature, it is a deployment.
 *
 * One cell at a time, deliberately. A form that posted the whole grid would
 * let two administrators editing at once silently undo each other, and it
 * would make every audit entry read "changed permissions" instead of naming
 * what changed and for whom. A grid of checkboxes that each save themselves is
 * also simply what the thing is.
 *
 * The guards below are the interesting part. A permission system that can be
 * used to lock everybody out of the permission system is a permission system
 * with a hole in it, and the hole is only ever found once.
 */

async function setRolePermissionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(rolePermissionSchema, formData);
  if (!parsed.success) return parsed.state;
  const { roleKey, permissionKey, granted } = parsed.data;

  const role = ROLES.find((r) => r.key === roleKey);
  if (!role) return fail("That role no longer exists. Reload and try again.");
  if (!PERMISSION_KEYS.includes(permissionKey as PermissionKey)) {
    return fail("That permission no longer exists. Reload and try again.");
  }

  /*
   * Nobody may lock the door and drop the key.
   *
   * Revoking `settings.manage` from the last role that holds it — or from
   * your own role when you are the only person in it — leaves an installation
   * where the matrix can never be edited again by anybody, and the only
   * recovery is a database console. It is an easy mistake to make with a
   * checkbox, and impossible to undo through the product.
   */
  if (!granted && permissionKey === "settings.manage") {
    const holders = await rolesHolding("settings.manage");
    if (holders.size <= 1 && holders.has(roleKey)) {
      return fail(
        "That is the last role that can manage settings. Grant it to another role first, or nobody will be able to change this again.",
      );
    }
    if (roleKey === actor.role) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.role, roleKey), eq(users.active, true)));
      if (n <= 1) {
        return fail(
          "You are the only active person with this role, so this would lock you out of settings. Grant it elsewhere first.",
        );
      }
    }
  }

  const existing = (
    await db
      .select()
      .from(rolePermissions)
      .where(
        and(eq(rolePermissions.roleKey, roleKey), eq(rolePermissions.permissionKey, permissionKey)),
      )
  )[0];

  if (granted === Boolean(existing)) {
    // Somebody else already made this change, or a double click. Not an error.
    return succeed("Already set that way");
  }

  if (granted) {
    await db
      .insert(rolePermissions)
      .values({ id: newId("rpm"), roleKey, permissionKey })
      .onConflictDoNothing();
  } else {
    await db.delete(rolePermissions).where(eq(rolePermissions.id, existing!.id));
  }

  // The matrix is cached per process for `can()` to stay synchronous, so a
  // change has to say so explicitly or it takes a restart to appear.
  invalidatePermissionMatrix();

  await logActivity({
    entityType: "settings",
    entityId: "permissions",
    type: "settings_changed",
    actorId: actor.id,
    summary: `${granted ? "Granted" : "Revoked"} ${permissionKey} ${granted ? "to" : "from"} ${role.label}`,
    changes: [
      {
        field: `${roleKey}.${permissionKey}`,
        label: `${role.label} · ${permissionKey}`,
        from: granted ? "no" : "yes",
        to: granted ? "yes" : "no",
      },
    ],
    meta: { roleKey, permissionKey, granted },
  });

  revalidatePath("/settings");
  revalidatePath("/");
  return succeed(`${granted ? "Granted" : "Revoked"} for ${role.label}`);
}

async function rolesHolding(permissionKey: string) {
  const rows = await db
    .select({ roleKey: rolePermissions.roleKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.permissionKey, permissionKey));
  return new Set(rows.map((r) => r.roleKey));
}

export const setRolePermission = guarded("settings.manage", setRolePermissionImpl);
