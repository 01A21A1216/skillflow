"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { pipelineStages, submissions } from "@/db/schema";
import type { User } from "@/db/schema";
import { stageOrderSchema, stageSchema } from "@/lib/validation";
import { tick } from "@/server/jobs/worker";
import { invalidatePipeline, loadPipeline } from "@/server/pipeline";
import { checkVersion, diffFields, describeChanges, stamp, stampNew } from "@/server/integrity";
import {
  fail,
  guarded,
  logActivity,
  newId,
  parseForm,
  succeed,
  type ActionState,
} from "./shared";

const STAGE_LABELS = {
  key: "Key",
  label: "Label",
  kind: "Phase",
  tone: "Colour",
  description: "Description",
  slaDays: "Stage target",
  position: "Position",
  active: "Active",
};

function afterStageChange() {
  // The pipeline is cached per process, so an edit has to say so explicitly.
  invalidatePipeline();
  for (const path of ["/", "/pipeline", "/requisitions", "/analytics", "/settings"]) {
    revalidatePath(path);
  }
}

async function saveStageImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(stageSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const existing = input.stageId
    ? (await db.select().from(pipelineStages).where(eq(pipelineStages.id, input.stageId)))[0]
    : undefined;

  if (input.stageId && !existing) return fail("That stage no longer exists.");

  // A key is what every submission row points at, so it cannot change once the
  // stage exists — renaming is what `label` is for.
  if (existing && existing.key !== input.key) {
    return fail("A stage's key cannot change once it exists. Edit the label instead.", {
      key: "Fixed after creation",
    });
  }

  // The whole application reasons about stages by phase, so letting a built-in
  // stage change phase would silently rewrite the funnel, the interview sync
  // and every requirement's derived status at once.
  if (existing?.builtIn && existing.kind !== input.kind) {
    return fail("A built-in stage's phase is fixed. Add a new stage instead.", {
      kind: "Fixed for built-in stages",
    });
  }

  if (!existing) {
    const clash = (await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.key, input.key))
      )[0];
    if (clash) return fail("A stage with that key already exists.", { key: "Already in use" });
  }


  if (existing) {
    const nextVersion = checkVersion("Stage", existing.rowVersion, formData.get("rowVersion"));
    const changes = diffFields(existing, input, STAGE_LABELS);

    (await db.update(pipelineStages)
      .set({
        label: input.label,
        kind: input.kind,
        tone: input.tone,
        description: input.description ?? "",
        slaDays: input.slaDays,
        position: input.position,
        active: input.active,
        ...stamp(actor.id, nextVersion),
      })
      .where(eq(pipelineStages.id, existing.id))
      );

    await logActivity({
      entityType: "settings",
      entityId: existing.id,
      type: "settings_changed",
      actorId: actor.id,
      summary: changes.length
        ? `Pipeline stage ${existing.label}: ${describeChanges(changes)}`
        : `Pipeline stage ${existing.label} saved with no changes`,
      changes,
    });

    afterStageChange();
    return succeed(`${input.label} saved`, existing.id);
  }

  const id = newId("stg");
  (await db.insert(pipelineStages)
    .values({
      id,
      key: input.key,
      label: input.label,
      kind: input.kind,
      tone: input.tone,
      description: input.description ?? "",
      slaDays: input.slaDays,
      position: input.position,
      active: input.active,
      builtIn: false,
      ...stampNew(actor.id),
    })
    );

  await logActivity({
    entityType: "settings",
    entityId: id,
    type: "settings_changed",
    actorId: actor.id,
    summary: `Added pipeline stage ${input.label}`,
  });

  afterStageChange();
  return succeed(`${input.label} added`, id);
}

async function deleteStageImpl(actor: User, formData: FormData): Promise<ActionState> {
  const stageId = String(formData.get("stageId") ?? "");
  const row = (await db.select().from(pipelineStages).where(eq(pipelineStages.id, stageId)))[0];
  if (!row) return fail("That stage no longer exists.");

  if (row.builtIn) {
    return fail("Built-in stages cannot be deleted. Switch it off instead.");
  }

  // Deleting a stage candidates are standing in would strand them somewhere
  // nothing can render, so this is refused rather than cascading.
  const occupied = (await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.stage, row.key))
    );
  if (occupied.length) {
    return fail(
      `${occupied.length} candidate${occupied.length === 1 ? " is" : "s are"} in ${row.label}. Move them first, or switch the stage off.`,
    );
  }

  (await db.delete(pipelineStages).where(eq(pipelineStages.id, stageId)));

  await logActivity({
    entityType: "settings",
    entityId: stageId,
    type: "settings_changed",
    actorId: actor.id,
    summary: `Removed pipeline stage ${row.label}`,
  });

  afterStageChange();
  return succeed(`${row.label} removed`);
}

async function reorderStagesImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(stageOrderSchema, formData, ["order"]);
  if (!parsed.success) return parsed.state;

  const pipeline = await loadPipeline();
  const known = new Set(pipeline.all.map((s) => s.key));
  if (parsed.data.order.some((k) => !known.has(k))) {
    return fail("That ordering refers to a stage that no longer exists. Reload and try again.");
  }

  for (const [position, key] of parsed.data.order.entries()) {
    (await db.update(pipelineStages)
      .set({ position, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(pipelineStages.key, key))
      );
  }

  await logActivity({
    entityType: "settings",
    entityId: "pipeline",
    type: "settings_changed",
    actorId: actor.id,
    summary: "Reordered the pipeline",
  });

  afterStageChange();
  return succeed("Pipeline reordered");
}

/**
 * Run one pass of the queue now.
 *
 * Not a feature so much as an answer to "is the worker actually working?".
 * The alternative is waiting out a poll interval and guessing, which is how
 * background work quietly stops being trusted.
 */
async function runJobsNowImpl(actor: User): Promise<ActionState> {
  const { claimed, ran } = await tick();

  await logActivity({
    entityType: "settings",
    entityId: "jobs",
    type: "settings_changed",
    actorId: actor.id,
    summary: `Ran the job queue by hand — ${ran} of ${claimed} finished cleanly`,
  });

  revalidatePath("/settings");
  return succeed(
    claimed === 0
      ? "Nothing was due. The queue is up to date."
      : `Ran ${claimed} job${claimed === 1 ? "" : "s"}; ${ran} finished cleanly.`,
  );
}

export const saveStage = guarded("settings.manage", saveStageImpl);
export const deleteStage = guarded("settings.manage", deleteStageImpl);
export const reorderStages = guarded("settings.manage", reorderStagesImpl);
export const runJobsNow = guarded("settings.manage", runJobsNowImpl);
