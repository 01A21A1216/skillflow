"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireUser } from "@/server/session";
import type { ActionState } from "./shared";

/**
 * Marking a notification read.
 *
 * Not `guarded`: there is no permission to hold, because the only record
 * anyone can touch is their own — the `userId` predicate is the whole
 * authorisation story, and it is on every statement below.
 */
export async function markRead(id: string): Promise<ActionState> {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
  revalidatePath("/");
  return { ok: true };
}

export async function markAllRead(): Promise<ActionState> {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  revalidatePath("/");
  return { ok: true, message: "All caught up" };
}
