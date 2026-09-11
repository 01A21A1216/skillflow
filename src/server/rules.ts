import {
  OFFER_STATUS,
  OFFER_TRANSITIONS,
  RECOMMENDATION_SCORE,
  type Outcome,
  type OfferStatus,
  type Pipeline,
  type Recommendation,
  type Stage,
} from "@/lib/domain";

/**
 * The business rules that were living inside server actions.
 *
 * They are here, pure, for one reason: an action needs a request, a session
 * and a database before it will run, so a rule buried in one is a rule nothing
 * tests. These are the rules that break silently — a requirement that stays
 * Filled after its hire falls through, a panel whose verdict does not match
 * its scorecards — and every one of them is now a function with inputs and a
 * return value.
 */

/* ------------------------------------------------------------------ *
 * Requisition fill
 * ------------------------------------------------------------------ */

export interface FillInput {
  /** Submissions on this requirement whose status is `hired`. */
  hires: number;
  openings: number;
  /** The authored status currently stored on the row. */
  status: string;
  closedAt: string | null;
  /** `YYYY-MM-DD`, passed in so the rule does not read the clock. */
  today: string;
}

export interface FillResult {
  filled: number;
  status: string;
  closedAt: string | null;
}

/** Statuses a fill change may overwrite. A cancelled requirement stays cancelled. */
const OPENISH = ["open", "on_hold", "draft"];

/**
 * What a requirement's seat count and status should be, given its hires.
 *
 * This ran in two places with two different answers: the pipeline path
 * reopened a filled requirement when a hire was undone, and the offer path did
 * not — so rescinding an accepted offer left the requirement marked Filled
 * with a stale close date, and the seat never came back. One rule now, used by
 * both.
 */
export function requisitionFill(input: FillInput): FillResult {
  const filled = Math.min(input.hires, input.openings);
  const complete = input.hires >= input.openings;

  if (complete) {
    return {
      filled,
      status: OPENISH.includes(input.status) ? "filled" : input.status,
      // Keep the original close date: when it closed is a fact, and re-deriving
      // it would move the date every time a seat is recounted.
      closedAt: input.closedAt ?? input.today,
    };
  }

  // A seat has opened back up. Only undo the close if this requirement was
  // closed *by* being filled — somebody who cancelled it meant it.
  const reopened = input.status === "filled";
  return {
    filled,
    status: reopened ? "open" : input.status,
    closedAt: reopened ? null : input.closedAt,
  };
}

/* ------------------------------------------------------------------ *
 * Offer transitions
 * ------------------------------------------------------------------ */

export interface TransitionContext {
  declineReason?: string | null;
  /** Whether the actor holds `offer.approve`. */
  canApprove: boolean;
}

/**
 * Why this offer transition is not allowed, or null if it is.
 *
 * Returning the message rather than a boolean keeps the reason and the rule in
 * the same place — a caller cannot accidentally reject a move and then explain
 * it wrongly.
 */
export function offerTransitionError(
  from: OfferStatus,
  to: OfferStatus,
  ctx: TransitionContext,
): string | null {
  if (!OFFER_TRANSITIONS[from]?.includes(to)) {
    return `Cannot move an offer from ${OFFER_STATUS[from]?.label.toLowerCase() ?? from} to ${
      OFFER_STATUS[to]?.label.toLowerCase() ?? to
    }.`;
  }
  if (to === "declined" && !ctx.declineReason) {
    return "Pick a reason so we can learn from it.";
  }
  // Approval is a separate permission from progressing an offer: a recruiter
  // may extend one and record the response, but must not sign off their own
  // terms.
  if (to === "approved" && !ctx.canApprove) {
    return "Only a hiring manager or recruitment manager can approve an offer.";
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Panel verdict
 * ------------------------------------------------------------------ */

/**
 * The round's outcome, read off the scorecards.
 *
 * Asking someone to restate a decision the panel already made is how the
 * recorded outcome drifts from the feedback underneath it. `null` means the
 * panel has not finished and nothing should be written yet.
 */
export function settleOutcome(recommendations: string[]): Outcome | null {
  if (!recommendations.length) return null;

  const score =
    recommendations.reduce(
      (sum, r) => sum + (RECOMMENDATION_SCORE[r as Recommendation] ?? 0),
      0,
    ) / recommendations.length;

  if (score >= 1.5) return "strong_yes";
  if (score >= 0.75) return "yes";
  if (score > 0) return "lean_yes";
  // Exactly zero is the honest middle: a panel of Maybes has not decided, and
  // rounding it to a lean either way would invent a verdict nobody gave.
  if (score === 0) return "pending";
  if (score > -1) return "lean_no";
  if (score > -1.75) return "no";
  return "strong_no";
}

/* ------------------------------------------------------------------ *
 * Interview stage
 * ------------------------------------------------------------------ */

export interface InterviewState {
  /** A round is booked in the future. */
  awaiting: boolean;
  /** A completed round is missing at least one scorecard. */
  owing: boolean;
}

/**
 * Which of the interview-band stages a submission belongs in.
 *
 * Interview Scheduled, Interview Completed and Feedback Pending are three
 * readings of the same facts rather than three things a recruiter remembers to
 * click, so they are derived. A pipeline configured with fewer interview
 * stages simply lands everyone on the ones it has.
 */
export function nextInterviewStage(
  band: Stage[],
  state: InterviewState,
  current: Stage,
): Stage {
  if (!band.length) return current;
  if (state.awaiting) return band[0]!;
  if (state.owing) return band[2] ?? band[band.length - 1]!;
  return band[1] ?? band[0]!;
}

/* ------------------------------------------------------------------ *
 * Stage backfill
 * ------------------------------------------------------------------ */

/**
 * The stages to record when a candidate is dropped straight into a later one.
 *
 * A candidate added at Client Review did pass through sourcing and submission,
 * even if nobody clicked through them, and a funnel that does not say so
 * reports a conversion rate it never measured.
 */
export function backfillPath(pipeline: Pipeline, target: Stage): Stage[] {
  const index = pipeline.index(target);
  if (index < 0) return [];
  return pipeline.order.slice(0, index + 1);
}
