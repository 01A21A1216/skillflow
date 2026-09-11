import "server-only";

import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { activities, candidates, requisitions, submissions, users } from "@/db/schema";
import type { FieldChange, User } from "@/db/schema";
import { visibleRequisitionIds } from "@/server/authz";

export interface AuditFilters {
  q?: string;
  actor?: string;
  type?: string;
  entityType?: string;
  from?: string;
  to?: string;
  /** Only entries that recorded a field-level diff. */
  changesOnly?: boolean;
  page?: number;
}

export interface AuditEntry {
  id: string;
  type: string;
  summary: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string;
  entityType: string;
  entityId: string;
  changes: FieldChange[] | null;
  /** Where to go to see the record this happened to, when it still exists. */
  href: string | null;
  /** How the record reads today, so a 6-month-old line is still identifiable. */
  subject: string | null;
}

export const AUDIT_PAGE_SIZE = 50;

/**
 * The audit trail (§13).
 *
 * Two things make this different from the inline feeds on detail pages. It is
 * filterable across the whole organisation, and it surfaces the structured
 * `changes` diff — which is the part that answers "who changed this, and what
 * was it before?" rather than merely "something happened".
 *
 * It is scoped exactly as every other read is: an entry narrating a
 * requirement the actor cannot see would leak the thing the scope exists to
 * hide, so the same predicate applies here.
 */
export async function listAudit(filters: AuditFilters = {}, actor?: User) {
  const conditions = [];

  if (actor) {
    const visible = await visibleRequisitionIds(actor);
    if (visible !== null) {
      const subIds = visible.length
        ? (
            await db
              .select({ id: submissions.id })
              .from(submissions)
              .where(inArray(submissions.requisitionId, visible))
          ).map((r) => r.id)
        : [];
      const reachable = [...visible, ...subIds, actor.id];
      conditions.push(
        reachable.length ? inArray(activities.entityId, reachable) : eq(activities.id, "__none__"),
      );
    }
  }

  if (filters.actor && filters.actor !== "all") {
    conditions.push(eq(activities.actorId, filters.actor));
  }
  if (filters.type && filters.type !== "all") {
    conditions.push(eq(activities.type, filters.type));
  }
  if (filters.entityType && filters.entityType !== "all") {
    conditions.push(eq(activities.entityType, filters.entityType));
  }
  if (filters.from) conditions.push(gte(activities.createdAt, new Date(`${filters.from}T00:00:00`)));
  if (filters.to) conditions.push(lte(activities.createdAt, new Date(`${filters.to}T23:59:59`)));
  if (filters.changesOnly) {
    conditions.push(sql`jsonb_array_length(coalesce(${activities.changes}, '[]'::jsonb)) > 0`);
  }
  if (filters.q) {
    const term = `%${filters.q.toLowerCase()}%`;
    const match = or(
      like(sql`lower(${activities.summary})`, term),
      like(sql`lower(${activities.changes}::text)`, term),
    );
    if (match) conditions.push(match);
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page ?? 1);

  const total = (
    await db.select({ count: sql<number>`count(*)::int` }).from(activities).where(where)
  )[0]!.count;

  const rows = await db
    .select({ activity: activities, actorName: users.name })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(where)
    .orderBy(desc(activities.createdAt))
    .limit(AUDIT_PAGE_SIZE)
    .offset((page - 1) * AUDIT_PAGE_SIZE);

  // Resolve the subject of each entry in three grouped lookups rather than one
  // per row. A summary written six months ago names a record by whatever it
  // was called then; showing what it is called now is what makes the line
  // clickable and identifiable.
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byType.get(r.activity.entityType) ?? new Set<string>();
    set.add(r.activity.entityId);
    byType.set(r.activity.entityType, set);
  }

  const subjects = new Map<string, { label: string; href: string }>();

  const reqIds = [...(byType.get("requisition") ?? [])];
  if (reqIds.length) {
    for (const r of await db
      .select({ id: requisitions.id, code: requisitions.code, title: requisitions.title })
      .from(requisitions)
      .where(inArray(requisitions.id, reqIds))) {
      subjects.set(r.id, { label: `${r.code} · ${r.title}`, href: `/requisitions/${r.id}` });
    }
  }

  const candIds = [...(byType.get("candidate") ?? [])];
  if (candIds.length) {
    for (const c of await db
      .select({ id: candidates.id, first: candidates.firstName, last: candidates.lastName })
      .from(candidates)
      .where(inArray(candidates.id, candIds))) {
      subjects.set(c.id, { label: `${c.first} ${c.last}`, href: `/candidates/${c.id}` });
    }
  }

  const subIds = [...(byType.get("submission") ?? [])];
  if (subIds.length) {
    for (const s of await db
      .select({
        id: submissions.id,
        candidateId: candidates.id,
        first: candidates.firstName,
        last: candidates.lastName,
        code: requisitions.code,
      })
      .from(submissions)
      .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
      .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
      .where(inArray(submissions.id, subIds))) {
      subjects.set(s.id, {
        label: `${s.first} ${s.last} on ${s.code}`,
        href: `/candidates/${s.candidateId}`,
      });
    }
  }

  const entries: AuditEntry[] = rows.map(({ activity: a, actorName }) => {
    const subject = subjects.get(a.entityId);
    return {
      id: a.id,
      type: a.type,
      summary: a.summary,
      createdAt: a.createdAt,
      actorId: a.actorId,
      // A null actor is the system, not a missing name — a seeded event or a
      // scheduled sweep. Saying so is more honest than an empty cell.
      actorName: actorName ?? "System",
      entityType: a.entityType,
      entityId: a.entityId,
      changes: a.changes,
      href: subject?.href ?? null,
      subject: subject?.label ?? null,
    };
  });

  return {
    entries,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

/** The distinct actors and entity types present, for the filter bar. */
export async function auditFacets() {
  const actorRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(users.name);

  const typeRows = await db
    .selectDistinct({ type: activities.type })
    .from(activities)
    .orderBy(activities.type);

  const entityRows = await db
    .selectDistinct({ entityType: activities.entityType })
    .from(activities)
    .orderBy(activities.entityType);

  return {
    actors: actorRows,
    types: typeRows.map((r) => r.type),
    entityTypes: entityRows.map((r) => r.entityType),
  };
}
