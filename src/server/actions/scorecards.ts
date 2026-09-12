"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { feedback, requisitions, scorecardCriteria, scorecardTemplates } from "@/db/schema";
import type { User } from "@/db/schema";
import { scorecardDeleteSchema, scorecardTemplateSchema } from "@/lib/validation";
import { fail, guarded, logActivity, newId, parseForm, succeed, type ActionState } from "./shared";

/**
 * Editing what interview panels score against (§3, §11).
 *
 * The competencies were a compile-time constant; they became rows so an
 * organisation could ask its own questions. This is the other half of that —
 * without it, "configurable" means "editable by whoever has psql".
 *
 * Two rules shape the whole file, and both are about scorecards that already
 * exist. A filed scorecard stores its `templateId` and a map of scores keyed
 * by competency, so changing a template's labels is safe — an old scorecard
 * renders with the labels its author saw. Changing a *key* is not: it orphans
 * the scores under it. So keys are immutable once used, and a template that
 * has been scored against is deactivated rather than deleted.
 */

const ARRAYS = ["criterionKey", "criterionLabel", "criterionDescription"];

async function saveScorecardImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(scorecardTemplateSchema, formData, ARRAYS);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  if (input.criterionKey.length !== input.criterionLabel.length) {
    // Parallel arrays that have drifted would silently pair a label with the
    // wrong key, which is worse than refusing the save.
    return fail("That form arrived mangled. Reload and try again.");
  }

  const keys = input.criterionKey.map((k) => k.trim());
  if (new Set(keys).size !== keys.length) {
    return fail("Two competencies share a key. Each needs its own.", {
      criterionKey: "Duplicate key",
    });
  }

  const criteria = keys.map((key, i) => ({
    key,
    label: input.criterionLabel[i]!.trim(),
    description: (input.criterionDescription[i] ?? "").trim(),
    position: i,
  }));

  const existing = input.templateId
    ? (await db.select().from(scorecardTemplates).where(eq(scorecardTemplates.id, input.templateId)))[0]
    : undefined;
  if (input.templateId && !existing) {
    return fail("That scorecard no longer exists. Reload and try again.");
  }

  // Keys that have already been scored against cannot be removed or renamed:
  // the scores are stored under them, and dropping one orphans real data.
  if (existing) {
    const used = await usedKeys(existing.id);
    const missing = [...used].filter((k) => !keys.includes(k));
    if (missing.length) {
      return fail(
        `${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} already been scored against and cannot be removed. Rename the label instead, or switch this scorecard off.`,
        { criterionKey: "In use" },
      );
    }
  }

  const id = existing?.id ?? newId("sct");
  const now = new Date();

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(scorecardTemplates)
        .set({
          name: input.name,
          description: input.description ?? "",
          isDefault: input.isDefault,
          active: input.active,
          updatedAt: now,
        })
        .where(eq(scorecardTemplates.id, id));

      // Replace the criteria wholesale. Safe because the keys that matter are
      // guaranteed above to still be present, and simpler than diffing three
      // parallel arrays against existing rows.
      await tx.delete(scorecardCriteria).where(eq(scorecardCriteria.templateId, id));
    } else {
      await tx.insert(scorecardTemplates).values({
        id,
        name: input.name,
        description: input.description ?? "",
        isDefault: input.isDefault,
        active: input.active,
      });
    }

    await tx.insert(scorecardCriteria).values(
      criteria.map((c) => ({ id: newId("scc"), templateId: id, ...c })),
    );

    // Exactly one default. Enforced here rather than by an index, because a
    // partial unique index would reject the save instead of doing the obvious
    // thing, and the obvious thing is that the newest choice wins.
    if (input.isDefault) {
      await tx
        .update(scorecardTemplates)
        .set({ isDefault: false, updatedAt: now })
        .where(ne(scorecardTemplates.id, id));
    }
  });

  await logActivity({
    entityType: "settings",
    entityId: "scorecards",
    type: "settings_changed",
    actorId: actor.id,
    summary: existing
      ? `Edited the ${input.name} scorecard — ${criteria.length} ${criteria.length === 1 ? "competency" : "competencies"}`
      : `Added the ${input.name} scorecard`,
    meta: { templateId: id, criteria: keys },
  });

  revalidateSettings();
  return succeed(existing ? "Scorecard saved" : "Scorecard added", id);
}

async function deleteScorecardImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(scorecardDeleteSchema, formData);
  if (!parsed.success) return parsed.state;

  const template = (
    await db.select().from(scorecardTemplates).where(eq(scorecardTemplates.id, parsed.data.templateId))
  )[0];
  if (!template) return fail("That scorecard no longer exists.");

  if (template.isDefault) {
    return fail("Make another scorecard the default first — a panel always needs one.");
  }

  const [{ n: inUse }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(requisitions)
    .where(eq(requisitions.scorecardTemplateId, template.id));
  if (inUse) {
    return fail(
      `${inUse} requirement${inUse === 1 ? " uses" : "s use"} this scorecard. Point them at another one first.`,
    );
  }

  const scored = (await usedKeys(template.id)).size > 0;
  if (scored) {
    // Deactivated rather than deleted: the scorecards already filed against it
    // need their labels to render, and a foreign key that still resolves is
    // worth more than a tidy table.
    await db
      .update(scorecardTemplates)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(scorecardTemplates.id, template.id));

    await logActivity({
      entityType: "settings",
      entityId: "scorecards",
      type: "settings_changed",
      actorId: actor.id,
      summary: `Switched off the ${template.name} scorecard — it has been scored against, so it was kept`,
    });

    revalidateSettings();
    return succeed("Switched off. It was kept because panels have already scored against it.");
  }

  await db.delete(scorecardTemplates).where(eq(scorecardTemplates.id, template.id));

  await logActivity({
    entityType: "settings",
    entityId: "scorecards",
    type: "settings_changed",
    actorId: actor.id,
    summary: `Removed the ${template.name} scorecard`,
  });

  revalidateSettings();
  return succeed("Scorecard removed");
}

/** Competency keys that already carry somebody's score. */
async function usedKeys(templateId: string) {
  const rows = await db
    .select({ key: sql<string>`jsonb_object_keys(${feedback.scores})` })
    .from(feedback)
    .where(and(eq(feedback.templateId, templateId), sql`${feedback.scores} <> '{}'::jsonb`));
  return new Set(rows.map((r) => r.key));
}

function revalidateSettings() {
  for (const path of ["/settings", "/interviews", "/requisitions"]) revalidatePath(path);
}

export const saveScorecard = guarded("settings.manage", saveScorecardImpl);
export const deleteScorecard = guarded("settings.manage", deleteScorecardImpl);
