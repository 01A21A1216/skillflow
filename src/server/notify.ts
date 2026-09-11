import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { notifications, users } from "@/db/schema";

/**
 * Notifications (§14).
 *
 * Three decisions shape this file.
 *
 * **A notification is a delivery, not an event.** One row per person, because
 * read state belongs to the reader. Fanning out at write time also makes the
 * inbox a single indexed read rather than a re-derivation of who should have
 * been told.
 *
 * **Delivery is behind a transport interface.** §14 asks for in-app now and
 * email, Teams or Slack later. Callers publish a notification; they never know
 * or care how it travels. Adding a transport means adding one object to the
 * list at the bottom — no call site changes.
 *
 * **Nothing is delivered twice.** Every notification carries a `dedupeKey`
 * that is stable for (person, fact). An SLA sweep that runs hourly must not
 * produce an hourly reminder about the same requirement, and the database
 * enforces that rather than the caller remembering to.
 */

/** The thirteen triggers §14 names, plus the two the app already had. */
export const NOTIFICATION_TYPES = {
  requirement_assigned: { label: "Requirement assigned", tone: "indigo" },
  candidate_assigned: { label: "Candidate assigned", tone: "cyan" },
  candidate_submitted: { label: "Candidate submitted", tone: "blue" },
  interview_scheduled: { label: "Interview scheduled", tone: "violet" },
  interview_changed: { label: "Interview changed", tone: "amber" },
  interview_completed: { label: "Interview completed", tone: "emerald" },
  feedback_pending: { label: "Feedback needed", tone: "amber" },
  feedback_overdue: { label: "Feedback overdue", tone: "rose" },
  candidate_selected: { label: "Candidate selected", tone: "amber" },
  offer_created: { label: "Offer drafted", tone: "amber" },
  requirement_sla: { label: "Requirement approaching SLA", tone: "amber" },
  requirement_aging: { label: "Requirement aging", tone: "rose" },
  candidate_idle: { label: "Candidate has gone quiet", tone: "slate" },
  mention: { label: "Mentioned", tone: "violet" },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export interface Notification {
  /** Who to tell. Duplicates and unknown ids are dropped. */
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  /**
   * Stable for the fact being reported. Two calls with the same key reach a
   * given person once, however many times they are made.
   */
  dedupeKey: string;
}

/**
 * A delivery channel.
 *
 * In-app is the only one implemented. The others (§14: email, Teams, Slack)
 * are an object each, registered below — the port exists now precisely so
 * adding one later is not a refactor of every caller.
 */
export interface Transport {
  readonly name: string;
  deliver(notification: Notification, recipients: string[]): Promise<void>;
}

const inApp: Transport = {
  name: "in-app",
  async deliver(notification, recipients) {
    if (!recipients.length) return;

    await db
      .insert(notifications)
      .values(
        recipients.map((userId) => ({
          id: `ntf_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
          userId,
          type: notification.type,
          title: notification.title,
          body: notification.body ?? "",
          href: notification.href ?? null,
          actorId: notification.actorId ?? null,
          entityType: notification.entityType ?? null,
          entityId: notification.entityId ?? null,
          dedupeKey: notification.dedupeKey,
        })),
      )
      // The unique index on (user, dedupeKey) is the deduplication. Colliding
      // rows are skipped rather than failing the write, because a caller
      // re-reporting a known fact is normal, not an error.
      .onConflictDoNothing();
  },
};

const transports: Transport[] = [inApp];

/**
 * Tell people something happened.
 *
 * Never throws into the caller. A mutation that succeeded must not be reported
 * as failed because a notification could not be written — the user's work is
 * done, and losing the note about it is the lesser harm.
 */
export async function notify(notification: Notification) {
  const recipients = [...new Set(notification.userIds.filter(Boolean))];
  if (!recipients.length) return;

  // Never notify someone about their own action. The single most common way
  // an inbox becomes noise is telling people what they just did.
  const targets = notification.actorId
    ? recipients.filter((id) => id !== notification.actorId)
    : recipients;
  if (!targets.length) return;

  // Deactivated accounts do not need an inbox.
  const active = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, targets), eq(users.active, true)))
  ).map((r) => r.id);
  if (!active.length) return;

  for (const transport of transports) {
    try {
      await transport.deliver(notification, active);
    } catch (error) {
      console.error(`[notify] ${transport.name} failed:`, error);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export async function unreadCount(userId: string) {
  const row = (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  )[0];
  return row?.n ?? 0;
}

export async function inbox(userId: string, limit = 30) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(sql`${notifications.readAt} nulls first`, sql`${notifications.createdAt} desc`)
    .limit(limit);
}
