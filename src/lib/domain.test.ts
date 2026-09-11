import { describe, expect, it } from "vitest";

import {
  AUTHORED_REQ_STATUSES,
  DEFAULT_PIPELINE,
  DEFAULT_STAGES,
  EMPLOYMENT_TYPES,
  KIND_ORDER,
  Pipeline,
  PROGRESS_BUCKETS,
  REQ_STATUSES,
  TERMINAL_STAGES,
  WORK_AUTHORIZATIONS,
  isRateBased,
  isTerminal,
  requisitionProgress,
  visaMatches,
  type StageDef,
} from "./domain";

/**
 * The domain vocabulary is the one thing every other layer reads. A stage that
 * loses its SLA, or a status that becomes settable when it is supposed to be
 * derived, breaks quietly — these pin the shape the spec asks for.
 *
 * Since stages became configuration, the tests that matter most are the ones
 * showing a *custom* pipeline still answers every question the application asks
 * of it. That is the whole promise of moving them into a table.
 */

describe("the default pipeline", () => {
  it("has the eleven stages from the specification, in order", () => {
    expect(DEFAULT_PIPELINE.order).toEqual([
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
    expect(TERMINAL_STAGES.map((s) => s.key)).toEqual(["rejected", "withdrawn", "on_hold"]);
    for (const t of TERMINAL_STAGES) expect(isTerminal(t.key)).toBe(true);
  });

  it("counts everything before the placement stage as live pipeline", () => {
    expect(DEFAULT_PIPELINE.active).toHaveLength(DEFAULT_PIPELINE.live.length - 1);
    expect(DEFAULT_PIPELINE.active).not.toContain("joined");
  });

  it("places terminal stages outside the ordered pipeline", () => {
    for (const t of TERMINAL_STAGES) expect(DEFAULT_PIPELINE.index(t.key)).toBe(-1);
  });

  it("names each stage exactly once", () => {
    const keys = DEFAULT_STAGES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("assigns every live stage a kind that is part of the progression", () => {
    for (const s of DEFAULT_PIPELINE.live) expect(KIND_ORDER).toContain(s.kind);
  });

  it("renders an unknown stage as itself rather than as a blank", () => {
    const unknown = DEFAULT_PIPELINE.get("something_bespoke");
    expect(unknown.label).toBe("something bespoke");
    expect(unknown.tone).toBe("neutral");
  });
});

describe("atOrPast", () => {
  const p = DEFAULT_PIPELINE;

  it("is true at the mark and beyond", () => {
    expect(p.atOrPast("submitted", "submitted")).toBe(true);
    expect(p.atOrPast("offer", "submitted")).toBe(true);
  });

  it("is false before the mark", () => {
    expect(p.atOrPast("screening", "submitted")).toBe(false);
  });

  it("is false for a terminal stage, which is not 'past' anything", () => {
    expect(p.atOrPast("rejected", "new")).toBe(false);
    expect(p.atOrPastKind("on_hold", "sourcing")).toBe(false);
  });

  it("compares by phase, so a renamed stage still answers correctly", () => {
    expect(p.atOrPastKind("client_review", "submitted")).toBe(true);
    expect(p.atOrPastKind("qualified", "submitted")).toBe(false);
    expect(p.atOrPastKind("joined", "offer")).toBe(true);
  });
});

describe("a customised pipeline", () => {
  /**
   * What an administrator might actually do: drop Qualified, rename Client
   * Review to something client-facing, add a second client-side stage, and
   * retune an SLA. Nothing here is a code change.
   */
  const custom = new Pipeline([
    { key: "new", label: "Inbox", kind: "sourcing", tone: "slate", description: "", slaDays: 2, position: 0, active: true },
    { key: "screening", label: "Screening", kind: "sourcing", tone: "cyan", description: "", slaDays: 3, position: 1, active: true },
    { key: "qualified", label: "Qualified", kind: "sourcing", tone: "cyan", description: "", slaDays: 3, position: 2, active: false },
    { key: "submitted", label: "Sent to client", kind: "submitted", tone: "blue", description: "", slaDays: 2, position: 3, active: true },
    { key: "shortlisted", label: "Client shortlist", kind: "submitted", tone: "indigo", description: "", slaDays: 4, position: 4, active: true },
    { key: "iv_booked", label: "Interview booked", kind: "interviewing", tone: "violet", description: "", slaDays: 6, position: 5, active: true },
    { key: "iv_done", label: "Interview done", kind: "interviewing", tone: "violet", description: "", slaDays: 2, position: 6, active: true },
    { key: "offer", label: "Offer", kind: "offer", tone: "amber", description: "", slaDays: 5, position: 7, active: true },
    { key: "started", label: "Started", kind: "placement", tone: "emerald", description: "", slaDays: 0, position: 8, active: true },
  ] satisfies StageDef[]);

  it("drops a disabled stage from the board without losing its definition", () => {
    expect(custom.order).not.toContain("qualified");
    expect(custom.active).toEqual([
      "new",
      "screening",
      "submitted",
      "shortlisted",
      "iv_booked",
      "iv_done",
      "offer",
    ]);
  });

  it("answers phase questions about stages the code has never heard of", () => {
    expect(custom.kind("shortlisted")).toBe("submitted");
    expect(custom.atOrPastKind("shortlisted", "submitted")).toBe(true);
    expect(custom.atOrPastKind("shortlisted", "interviewing")).toBe(false);
    expect(custom.bucket("shortlisted")).toBe("submitted");
  });

  it("knows where to put someone entering a phase", () => {
    expect(custom.entryOf("interviewing")).toBe("iv_booked");
    expect(custom.entryOf("submitted")).toBe("submitted");
    expect(custom.lastOf("submitted")).toBe("shortlisted");
  });

  it("uses the configured SLA, not the built-in one", () => {
    expect(custom.sla("new")).toBe(2);
    expect(DEFAULT_PIPELINE.sla("new")).toBe(3);
  });

  it("uses the configured label, not the stage key", () => {
    expect(custom.label("new")).toBe("Inbox");
    expect(custom.label("submitted")).toBe("Sent to client");
  });

  it("keeps the terminal states, which are not configurable", () => {
    expect(custom.terminal.map((t) => t.key)).toEqual(["rejected", "withdrawn", "on_hold"]);
  });

  it("falls back rather than rendering an empty board", () => {
    const empty = new Pipeline([]);
    expect(empty.order).toEqual(DEFAULT_PIPELINE.order);
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
    for (const stage of DEFAULT_PIPELINE.active) {
      expect(DEFAULT_PIPELINE.bucket(stage)).not.toBeNull();
    }
  });

  it("assigns no terminal stage or placement stage to a bucket", () => {
    for (const t of [...TERMINAL_STAGES.map((s) => s.key), "joined"]) {
      expect(DEFAULT_PIPELINE.bucket(t)).toBeNull();
    }
  });

  it("covers every bucket the summary bar renders", () => {
    const reachable = new Set(DEFAULT_PIPELINE.active.map((s) => DEFAULT_PIPELINE.bucket(s)));
    for (const b of PROGRESS_BUCKETS) expect(reachable.has(b.key)).toBe(true);
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
