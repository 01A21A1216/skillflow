import "server-only";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users, type User } from "@/db/schema";

const COOKIE = "rcc_actor";

/**
 * There is no auth provider in this build. Instead the app operates "as" a
 * member of the talent team, chosen from the top bar and remembered in a
 * cookie, so every write is still attributed to a real person and the audit
 * trail stays meaningful.
 */
export async function currentUser(): Promise<User> {
  const store = await cookies();
  const id = store.get(COOKIE)?.value;

  if (id) {
    const found = db.select().from(users).where(eq(users.id, id)).get();
    if (found) return found;
  }

  const fallback =
    db.select().from(users).where(eq(users.role, "admin")).get() ??
    db.select().from(users).get();

  if (!fallback) {
    throw new Error("No users in the database — run `npm run db:seed` first.");
  }
  return fallback;
}

export async function setCurrentUser(userId: string) {
  const store = await cookies();
  store.set(COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export const ACTOR_COOKIE = COOKIE;
