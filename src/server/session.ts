import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { User } from "@/db/schema";
import type { PermissionKey } from "@/lib/permissions";
import { SESSION_COOKIE, resolveSession } from "./auth";
import { ForbiddenError, assertCan, can, loadPermissionMatrix } from "./authz";

/**
 * Session access.
 *
 * `currentUser()` returns null when signed out; `requireUser()` redirects.
 * Both are wrapped in React's `cache` so a page that asks several times in
 * one render resolves the session once.
 */

export const currentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  return await resolveSession(store.get(SESSION_COOKIE)?.value);
});

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Every authenticated entry point loads the matrix, so `can()` can stay
  // synchronous without any caller having to remember to prime it.
  await loadPermissionMatrix();
  return user;
}

/**
 * Guard for pages. Sends an unauthenticated visitor to sign in and anyone
 * lacking the permission to the "no access" page, rather than rendering an
 * empty shell that looks like a bug.
 */
export async function requirePermission(permission: PermissionKey): Promise<User> {
  const user = await requireUser();
  if (!can(user, permission)) redirect(`/no-access?permission=${encodeURIComponent(permission)}`);
  return user;
}

/**
 * Guard for server actions. Throws rather than redirecting, so the action can
 * return a structured failure the form renders inline.
 */
export async function actorWithPermission(permission: PermissionKey): Promise<User> {
  const user = await currentUser();
  if (!user) throw new ForbiddenError(permission);
  await loadPermissionMatrix();
  assertCan(user, permission);
  return user;
}

export { SESSION_COOKIE };
