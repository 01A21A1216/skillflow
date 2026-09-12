import "server-only";

import { asc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  feedback,
  interviews,
  requisitions,
  scorecardCriteria,
  scorecardTemplates,
  submissions,
} from "@/db/schema";
import { DEFAULT_COMPETENCIES } from "@/lib/domain";

export interface Criterion {
  key: string;
  label: string;
  description: string;
}

export interface Scorecard {
  id: string | null;
  name: string;
  criteria: Criterion[];
}

/**
 * The compile-time fallback.
 *
 * Used only if the templates table is empty — a database that has not been
 * seeded yet. A panel is never shown an empty scorecard.
 */
const BUILT_IN: Scorecard = {
  id: null,
  name: "Default scorecard",
  criteria: DEFAULT_COMPETENCIES.map((c) => ({ ...c })),
};

async function load(templateId: string | null): Promise<Scorecard> {
  const rows = templateId
    ? await db
        .select({ template: scorecardTemplates, criterion: scorecardCriteria })
        .from(scorecardTemplates)
        .leftJoin(scorecardCriteria, eq(scorecardCriteria.templateId, scorecardTemplates.id))
        .where(eq(scorecardTemplates.id, templateId))
        .orderBy(asc(scorecardCriteria.position))
    : await db
        .select({ template: scorecardTemplates, criterion: scorecardCriteria })
        .from(scorecardTemplates)
        .leftJoin(scorecardCriteria, eq(scorecardCriteria.templateId, scorecardTemplates.id))
        .where(eq(scorecardTemplates.isDefault, true))
        .orderBy(asc(scorecardCriteria.position));

  const first = rows[0]?.template;
  if (!first) return BUILT_IN;

  const criteria = rows
    .map((r) => r.criterion)
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({ key: c.key, label: c.label, description: c.description }));

  // A template with no criteria would render a scorecard nobody can fill in.
  if (!criteria.length) return BUILT_IN;

  return { id: first.id, name: first.name, criteria };
}

/** The scorecard a requirement's panels fill in. */
export async function scorecardForRequisition(requisitionId: string): Promise<Scorecard> {
  const req = (await db
    .select({ templateId: requisitions.scorecardTemplateId })
    .from(requisitions)
    .where(eq(requisitions.id, requisitionId))
    )[0];
  return load(req?.templateId ?? null);
}

export async function scorecardForSubmission(submissionId: string): Promise<Scorecard> {
  const row = (await db
    .select({ templateId: requisitions.scorecardTemplateId })
    .from(submissions)
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    )[0];
  return load(row?.templateId ?? null);
}

/**
 * The scorecard an already-filed scorecard was scored against, so an old one
 * still renders with the labels its author saw rather than today's.
 */
export async function scorecardForFeedback(templateId: string | null): Promise<Scorecard> {
  return load(templateId);
}

export async function scorecardForInterview(interviewId: string): Promise<Scorecard> {
  const row = (await db
    .select({ templateId: requisitions.scorecardTemplateId })
    .from(interviews)
    .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(interviews.id, interviewId))
    )[0];
  return load(row?.templateId ?? null);
}

/**
 * Every template keyed by id, plus `__default__`, for the client-side lookup a
 * list of interviews needs. Loaded once per page rather than once per row.
 */
export async function scorecardMap(): Promise<Record<string, Scorecard>> {
  const all = await listScorecards();
  const map: Record<string, Scorecard> = {};
  for (const t of all) {
    if (!t.id) continue;
    map[t.id] = { id: t.id, name: t.name, criteria: t.criteria };
    if (t.isDefault) map.__default__ = map[t.id]!;
  }
  map.__default__ ??= BUILT_IN;
  return map;
}

/** Every template, for the settings screen and the requirement form. */
export async function listScorecards(): Promise<(Scorecard & { isDefault: boolean; active: boolean })[]> {
  const rows = await db
    .select({ template: scorecardTemplates, criterion: scorecardCriteria })
    .from(scorecardTemplates)
    .leftJoin(scorecardCriteria, eq(scorecardCriteria.templateId, scorecardTemplates.id))
    .orderBy(asc(scorecardTemplates.name), asc(scorecardCriteria.position));

  const byId = new Map<string, Scorecard & { isDefault: boolean; active: boolean }>();
  for (const { template, criterion } of rows) {
    let entry = byId.get(template.id);
    if (!entry) {
      entry = {
        id: template.id,
        name: template.name,
        isDefault: template.isDefault,
        active: template.active,
        criteria: [],
      };
      byId.set(template.id, entry);
    }
    if (criterion) {
      entry.criteria.push({
        key: criterion.key,
        label: criterion.label,
        description: criterion.description,
      });
    }
  }
  return [...byId.values()];
}

/** Just id and name, for a picker on the requirement form. */
export async function scorecardOptions() {
  const all = await listScorecards();
  return all
    .filter((t) => t.active && t.id)
    .map((t) => ({ id: t.id!, name: t.name }));
}

/**
 * Every template with what the settings screen needs to refuse a delete: how
 * many requirements point at it, and whether a panel has already scored
 * against it. Both are counted in SQL rather than by loading the rows.
 */
export async function scorecardSettings() {
  const templates = await db
    .select()
    .from(scorecardTemplates)
    .orderBy(asc(scorecardTemplates.name));

  const criteria = await db
    .select()
    .from(scorecardCriteria)
    .orderBy(asc(scorecardCriteria.position));

  const usage = new Map(
    (
      await db
        .select({
          templateId: requisitions.scorecardTemplateId,
          n: sql<number>`count(*)::int`,
        })
        .from(requisitions)
        .where(isNotNull(requisitions.scorecardTemplateId))
        .groupBy(requisitions.scorecardTemplateId)
    ).map((r) => [r.templateId!, r.n]),
  );

  const scored = new Set(
    (
      await db
        .selectDistinct({ templateId: feedback.templateId })
        .from(feedback)
        .where(isNotNull(feedback.templateId))
    ).map((r) => r.templateId!),
  );

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.isDefault,
    active: t.active,
    criteria: criteria
      .filter((c) => c.templateId === t.id)
      .map((c) => ({ key: c.key, label: c.label, description: c.description })),
    usedBy: usage.get(t.id) ?? 0,
    scored: scored.has(t.id),
  }));
}
