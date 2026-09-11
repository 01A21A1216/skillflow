import { describe, expect, it } from "vitest";

import {
  ACTIVE_STAGES,
  ALL_STAGES,
  AUTHORED_REQ_STATUSES,
  EMPLOYMENT_TYPES,
  PIPELINE_STAGES,
  PROGRESS_BUCKETS,
  REQ_STATUSES,
  STAGE_ORDER,
  STAGE_SLA_DAYS,
  TERMINAL_STAGES,
  WORK_AUTHORIZATIONS,
  atOrPast,
  bucketStages,
  isRateBased,
  progressBucket,
  requisitionProgress,
  stageIndex,
  visaMatches,
  type Stage,
} from "./domain";

/**
 * The domain vocabulary is the one thing every other layer reads. A stage that
 * loses its SLA, or a status that becomes settable when it is supposed to be
 * derived, breaks quietly — these pin the shape the spec asks for.
 */

describe("pipeline stages", () => {
  it("has the eleven stages from the specification, in order", () => {
    expect(STAGE_ORDER).toEqual([
      "new",
      "screening",
      "qualified",
      "submitted",
      "client_review",
      "interview_scheduled",
      "interview_completed",
      "feedback_pending",
      "selected",
      "offer",
      "joined",
    ]);
  });

  it("carries Rejected, Withdrawn and On Hold as terminal states", () => {
    expect(TERMINAL_STAGES.map((s) => s.value)).toEqual(["rejected", "withdrawn", "on_hold"]);
  });

  it("gives every stage an SLA entry, so no stage silently never ages", () => {
    for (const stage of ALL_STAGES) {
      expect(STAGE_SLA_DAYS[stage.value]).toBeTypeOf("number");
    }
  });

  it("counts everything before Joined as live pipeline", () => {
    expect(ACTIVE_STAGES).toHaveLength(PIPELINE_STAGES.length - 1);
    expect(ACTIVE_STAGES).not.toContain("joined");
  });

  it("places terminal stages outside the ordered pipeline", () => {
    for (const t of TERMINAL_STAGES) expect(stageIndex(t.value)).toBe(-1);
  });

  it("labels each stage exactly once", () => {
    const values = ALL_STAGES.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("atOrPast", () => {
  it("is true at the mark and beyond", () => {
    expect(atOrPast("submitted", "submitted")).toBe(true);
    expect(atOrPast("offer", "submitted")).toBe(true);
  });

  it("is false before the mark", () => {
    expect(atOrPast("screening", "submitted")).toBe(false);
  });

  it("is false for a terminal stage, which is not 'past' anything", () => {
    expect(atOrPast("rejected", "new")).toBe(false);
    expect(atOrPast("on_hold", "new")).toBe(false);
  });
});

describe("requirement statuses", () => {
  it("offers the ten from the specification", () => {
    expect(REQ_STATUSES.map((s) => s.value)).toEqual([
      "draft",
      "open",
      "active_sourcing",
      "candidate_submitted",
      "interviewing",
      "offer",
      "filled",
      "on_hold",
      "cancelled",
      "closed",
    ]);
  });

  it("lets a person set only the six that are decisions", () => {
    expect(AUTHORED_REQ_STATUSES.map((s) => s.value)).toEqual([
      "draft",
      "open",
      "filled",
      "on_hold",
      "cancelled",
      "closed",
    ]);
  });

  it("keeps the derived four out of the settable list", () => {
    const settable = new Set(AUTHORED_REQ_STATUSES.map((s) => s.value));
    for (const derived of ["active_sourcing", "candidate_submitted", "interviewing", "offer"]) {
      expect(settable.has(derived as never)).toBe(false);
    }
  });
});

describe("requisitionProgress", () => {
  const counts = (over: Partial<Record<string, number>> = {}) => ({
    sourcing: 0,
    submitted: 0,
    interviewing: 0,
    offer: 0,
    ...over,
  });

  it("reports the furthest thing happening, not the first", () => {
    expect(requisitionProgress("open", counts({ sourcing: 9, submitted: 3, offer: 1 }))).toBe("offer");
    expect(requisitionProgress("open", counts({ sourcing: 9, interviewing: 2 }))).toBe("interviewing");
    expect(requisitionProgress("open", counts({ sourcing: 4, submitted: 1 }))).toBe("candidate_submitted");
    expect(requisitionProgress("open", counts({ sourcing: 4 }))).toBe("active_sourcing");
  });

  it("stays Open when nobody is in the pipeline yet", () => {
    expect(requisitionProgress("open", counts())).toBe("open");
  });

  it("never overrides a status a person chose", () => {
    for (const stored of ["draft", "on_hold", "filled", "cancelled", "closed"]) {
      expect(requisitionProgress(stored, counts({ offer: 5 }))).toBe(stored);
    }
  });
});

describe("progress buckets", () => {
  it("assigns every live stage to exactly one bucket", () => {
    for (const stage of ACTIVE_STAGES) expect(progressBucket(stage)).not.toBeNull();
  });

  it("assigns no terminal stage or Joined to a bucket", () => {
    for (const t of [...TERMINAL_STAGES.map((s) => s.value), "joined" as Stage]) {
      expect(progressBucket(t)).toBeNull();
    }
  });

  it("folds a stage breakdown without losing anyone", () => {
    const folded = bucketStages({
      new: 4,
      qualified: 2,
      client_review: 3,
      feedback_pending: 1,
      selected: 1,
      offer: 2,
    });
    expect(folded).toEqual({ sourcing: 6, submitted: 3, interviewing: 1, offer: 3 });
    const total = PROGRESS_BUCKETS.reduce((n, b) => n + folded[b.key], 0);
    expect(total).toBe(13);
  });

  it("ignores stages that are not live pipeline", () => {
    expect(bucketStages({ joined: 5, rejected: 9, on_hold: 2 })).toEqual({
      sourcing: 0,
      submitted: 0,
      interviewing: 0,
      offer: 0,
    });
  });
});

describe("employment types", () => {
  it("includes W-2 and corp-to-corp", () => {
    const values = EMPLOYMENT_TYPES.map((e) => e.value);
    expect(values).toContain("w2");
    expect(values).toContain("c2c");
  });

  it("bills contract engagements by rate and permanent ones by salary", () => {
    expect(isRateBased("w2")).toBe(true);
    expect(isRateBased("c2c")).toBe(true);
    expect(isRateBased("contract_to_hire")).toBe(true);
    expect(isRateBased("full_time")).toBe(false);
    expect(isRateBased("intern")).toBe(false);
  });
});

describe("visaMatches", () => {
  it("treats an empty list as no constraint, not as nothing accepted", () => {
    expect(visaMatches([], "requires_sponsorship")).toBe(true);
    expect(visaMatches(null, "h1b")).toBe(true);
    expect(visaMatches(undefined, "h1b")).toBe(true);
  });

  it("accepts only what the requirement lists", () => {
    expect(visaMatches(["citizen", "green_card"], "green_card")).toBe(true);
    expect(visaMatches(["citizen", "green_card"], "h1b")).toBe(false);
  });

  it("draws from the same vocabulary both sides use", () => {
    const known = WORK_AUTHORIZATIONS.map((w) => w.value);
    expect(known).toContain("h1b");
    expect(known).toContain("green_card");
    expect(new Set(known).size).toBe(known.length);
  });
});
