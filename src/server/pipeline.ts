import "server-only";

import { asc } from "drizzle-orm";

import { db } from "@/db";
import { pipelineStages } from "@/db/schema";
import {
  DEFAULT_PIPELINE,
  DEFAULT_STAGES,
  EMPTY_STAGE_COUNTS,
  Pipeline,
  type StageCounts,
  type StageDef,
  type Tone,
} from "@/lib/domain";

/**
 * The configured pipeline.
 *
 * Cached per process, exactly as the permission matrix is: stages change when
 * an administrator edits them, which is rare, and every page and query reads
 * them, which is constant. `invalidatePipeline()` is called by the settings
 * action so an edit takes effect without a restart.
 *
 * A database with no stage rows falls back to the specification's eleven rather
 * than rendering an empty board — the same fail-safe posture the permission
 * matrix takes, inverted: there, absence must deny; here, absence must still
 * show a working pipeline.
 */
let cached: Pipeline | null = null;

export async function loadPipeline(): Promise<Pipeline> {
  if (cached) return cached;

  const rows = await db.select().from(pipelineStages).orderBy(asc(pipelineStages.position));
  if (!rows.length) {
    cached = DEFAULT_PIPELINE;
    return cached;
  }

  cached = new Pipeline(
    rows.map(
      (r): StageDef => ({
        key: r.key,
        label: r.label,
        kind: r.kind as StageDef["kind"],
        tone: r.tone as Tone,
        description: r.description,
        slaDays: r.slaDays,
        position: r.position,
        active: r.active,
      }),
    ),
  );
  return cached;
}

export function invalidatePipeline() {
  cached = null;
}

/** Every row, including disabled ones, for the settings screen. */
export async function listStageRows() {
  return db.select().from(pipelineStages).orderBy(asc(pipelineStages.position));
}

/** What the seed writes, and what a "reset to defaults" would restore. */
export function defaultStageRows() {
  return DEFAULT_STAGES.map((s) => ({ ...s, builtIn: true }));
}

/**
 * Fold a per-stage count map into the four summary buckets.
 *
 * Eleven columns is the right resolution for a board someone is working in and
 * the wrong one for a bar in a table row, so every summary folds to these four
 * and the bar still totals the live pipeline rather than a subset of it.
 */
export function bucketStages(
  pipeline: Pipeline,
  counts: Record<string, number> | undefined,
): StageCounts {
  const out = { ...EMPTY_STAGE_COUNTS };
  for (const [stage, n] of Object.entries(counts ?? {})) {
    const bucket = pipeline.bucket(stage);
    if (bucket) out[bucket] += n;
  }
  return out;
}
