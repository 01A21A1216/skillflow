import { describe, expect, it } from "vitest";

import { DEFAULT_PIPELINE, OFFER_STATUSES, type OfferStatus } from "@/lib/domain";
import {
  backfillPath,
  nextInterviewStage,
  offerTransitionError,
  requisitionFill,
  settleOutcome,
} from "./rules";

/**
 * The rules that used to live inside server actions, where nothing could reach
 * them. Each of these fails silently in production: a requirement that stays
 * Filled after its hire falls through looks fine on every screen until someone
 * wonders why no candidates are being sourced for it.
 */

describe("requisitionFill", () => {
  const base = { openings: 2, status: "open", closedAt: null, today: "2026-09-11" };

  it("counts filled seats but never more than there are", () => {
    expect(requisitionFill({ ...base, hires: 1 }).filled).toBe(1);
    expect(requisitionFill({ ...base, hires: 5 }).filled).toBe(2);
  });

  it("closes the requirement when the last seat goes", () => {
    const next = requisitionFill({ ...base, hires: 2 });
    expect(next.status).toBe("filled");
    expect(next.closedAt).toBe("2026-09-11");
  });

  it("leaves it open while seats remain", () => {
    const next = requisitionFill({ ...base, hires: 1 });
    expect(next.status).toBe("open");
    expect(next.closedAt).toBeNull();
  });

  it("keeps the original close date rather than moving it on every recount", () => {
    const next = requisitionFill({ ...base, hires: 2, closedAt: "2026-08-01" });
    expect(next.closedAt).toBe("2026-08-01");
  });

  /**
   * The bug this rule was extracted to fix. Rescinding an accepted offer ran
   * down a different code path that never reopened the requirement, so the
   * seat silently disappeared.
   */
  it("reopens a filled requirement when a hire is undone", () => {
    const next = requisitionFill({ ...base, hires: 1, status: "filled", closedAt: "2026-08-01" });
    expect(next.status).toBe("open");
    expect(next.closedAt).toBeNull();
    expect(next.filled).toBe(1);
  });

  it("does not resurrect a requirement somebody deliberately closed", () => {
    for (const status of ["cancelled", "closed"]) {
      const next = requisitionFill({ ...base, hires: 0, status, closedAt: "2026-08-01" });
      expect(next.status).toBe(status);
      expect(next.closedAt).toBe("2026-08-01");
    }
  });

  it("fills a draft or on-hold requirement rather than leaving it mislabelled", () => {
    expect(requisitionFill({ ...base, hires: 2, status: "on_hold" }).status).toBe("filled");
    expect(requisitionFill({ ...base, hires: 2, status: "draft" }).status).toBe("filled");
  });

  it("will not overwrite a cancelled requirement even if somebody was hired", () => {
    expect(requisitionFill({ ...base, hires: 2, status: "cancelled" }).status).toBe("cancelled");
  });

  it("handles a single-seat requirement, which is most of them", () => {
    const next = requisitionFill({ ...base, openings: 1, hires: 1 });
    expect(next).toEqual({ filled: 1, status: "filled", closedAt: "2026-09-11" });
  });
});

describe("offerTransitionError", () => {
  const allowed = { canApprove: true, declineReason: "Compensation below expectation" };

  it("allows the normal path from draft to accepted", () => {
    const path: OfferStatus[] = ["draft", "pending_approval", "approved", "extended", "accepted"];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(offerTransitionError(path[i]!, path[i + 1]!, allowed)).toBeNull();
    }
  });

  it("refuses a jump that skips approval", () => {
    expect(offerTransitionError("draft", "extended", allowed)).toMatch(/Cannot move an offer/);
    expect(offerTransitionError("pending_approval", "accepted", allowed)).toMatch(/Cannot move/);
  });

  it("refuses to move an offer that has already been declined", () => {
    for (const to of OFFER_STATUSES.map((s) => s.value)) {
      expect(offerTransitionError("declined", to, allowed)).not.toBeNull();
    }
  });

  it("requires a reason for a decline, so the analytics mean something", () => {
    expect(offerTransitionError("extended", "declined", { canApprove: true })).toBe(
      "Pick a reason so we can learn from it.",
    );
    expect(offerTransitionError("extended", "declined", allowed)).toBeNull();
  });

  it("keeps approval away from whoever drafted the terms", () => {
    expect(offerTransitionError("pending_approval", "approved", { canApprove: false })).toMatch(
      /Only a hiring manager/,
    );
    expect(offerTransitionError("pending_approval", "approved", { canApprove: true })).toBeNull();
  });

  it("lets an expired offer be re-extended", () => {
    expect(offerTransitionError("expired", "extended", allowed)).toBeNull();
  });

  it("lets an accepted offer be rescinded, because that happens", () => {
    expect(offerTransitionError("accepted", "rescinded", allowed)).toBeNull();
  });

  it("names both ends of a refused move, so the message is actionable", () => {
    const message = offerTransitionError("draft", "accepted", allowed);
    expect(message).toContain("draft");
    expect(message).toContain("accepted");
  });
});

describe("settleOutcome", () => {
  it("says nothing when nobody has scored", () => {
    expect(settleOutcome([])).toBeNull();
  });

  it("reads a unanimous panel", () => {
    expect(settleOutcome(["strong_hire", "strong_hire"])).toBe("strong_yes");
    expect(settleOutcome(["no_hire", "no_hire"])).toBe("strong_no");
  });

  it("averages a split panel rather than taking the loudest voice", () => {
    expect(settleOutcome(["strong_hire", "no_hire"])).toBe("pending");
    expect(settleOutcome(["hire", "hire", "lean_no_hire"])).toBe("lean_yes");
  });

  /**
   * The reason Maybe exists. A panel that genuinely cannot decide should
   * produce a recorded verdict that says so, not a lean invented by rounding.
   */
  it("leaves a panel of Maybes undecided", () => {
    expect(settleOutcome(["maybe", "maybe", "maybe"])).toBe("pending");
    expect(settleOutcome(["maybe"])).toBe("pending");
  });

  it("lets a Maybe pull a weak yes back to undecided", () => {
    expect(settleOutcome(["lean_hire", "lean_no_hire"])).toBe("lean_no");
    expect(settleOutcome(["hire", "lean_no_hire"])).toBe("pending");
  });

  it("ignores a recommendation it does not recognise rather than crashing", () => {
    expect(settleOutcome(["hire", "something_else"])).toBe("lean_yes");
  });
});

describe("nextInterviewStage", () => {
  const band = DEFAULT_PIPELINE.ofKind("interviewing");

  it("is Interview Scheduled while a round is still ahead", () => {
    expect(nextInterviewStage(band, { awaiting: true, owing: true }, "feedback_pending")).toBe(
      "interview_scheduled",
    );
  });

  it("is Feedback Pending when a scorecard is owed and nothing is booked", () => {
    expect(nextInterviewStage(band, { awaiting: false, owing: true }, "interview_scheduled")).toBe(
      "feedback_pending",
    );
  });

  it("is Interview Completed when the loop is done and everyone has filed", () => {
    expect(nextInterviewStage(band, { awaiting: false, owing: false }, "feedback_pending")).toBe(
      "interview_completed",
    );
  });

  it("copes with a pipeline configured with a single interview stage", () => {
    const one = ["iv"];
    expect(nextInterviewStage(one, { awaiting: true, owing: false }, "iv")).toBe("iv");
    expect(nextInterviewStage(one, { awaiting: false, owing: true }, "iv")).toBe("iv");
    expect(nextInterviewStage(one, { awaiting: false, owing: false }, "iv")).toBe("iv");
  });

  it("leaves the candidate where they are if there is no interview band at all", () => {
    expect(nextInterviewStage([], { awaiting: true, owing: true }, "screening")).toBe("screening");
  });
});

describe("backfillPath", () => {
  it("records the stages a candidate was dropped past", () => {
    expect(backfillPath(DEFAULT_PIPELINE, "submitted")).toEqual([
      "new",
      "screening",
      "qualified",
      "submitted",
    ]);
  });

  it("is just the first stage when they start at the top", () => {
    expect(backfillPath(DEFAULT_PIPELINE, "new")).toEqual(["new"]);
  });

  it("is empty for a stage the pipeline does not have", () => {
    expect(backfillPath(DEFAULT_PIPELINE, "rejected")).toEqual([]);
    expect(backfillPath(DEFAULT_PIPELINE, "nonsense")).toEqual([]);
  });

  it("never skips a stage, so the funnel measures what it reports", () => {
    const path = backfillPath(DEFAULT_PIPELINE, "offer");
    expect(path).toEqual(DEFAULT_PIPELINE.order.slice(0, path.length));
    expect(path[path.length - 1]).toBe("offer");
  });
});
