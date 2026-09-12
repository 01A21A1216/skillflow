import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db";
import {
  activities,
  candidates,
  feedback,
  interviews,
  offers,
  requisitions,
  scorecardCriteria,
  scorecardTemplates,
  submissions,
} from "@/db/schema";
import type { User } from "@/db/schema";

import { addToPipeline, moveStage } from "@/server/actions/pipeline";
import {
  scheduleInterview,
  submitFeedback,
  updateInterviewOutcome,
} from "@/server/actions/interviews";
import { createOffer, transitionOffer } from "@/server/actions/offers";
import { loadPipeline } from "@/server/pipeline";
import {
  cleanUp,
  form,
  makeFixture,
  revalidated,
  signInAs,
  userWithRole,
  type Fixture,
} from "./harness";

/**
 * One candidate, all the way from sourced to hired, through the real actions.
 *
 * This is the path the whole product exists to support, and almost none of it
 * is checkable without a database. The interesting assertions are the side
 * effects: a stage change writes a stage event, a completed round starts the
 * feedback clock, an accepted offer fills a seat and closes the requirement.
 * Each of those is a cascade in an action, and a cascade that silently stops
 * working looks exactly like one that works until somebody counts.
 */

/** The competencies the seeded default template actually asks for. */
async function scorecardKeys() {
  const rows = await db
    .select({ key: scorecardCriteria.key })
    .from(scorecardCriteria)
    .innerJoin(scorecardTemplates, eq(scorecardTemplates.id, scorecardCriteria.templateId))
    .where(eq(scorecardTemplates.isDefault, true))
    .orderBy(scorecardCriteria.position);
  return rows.map((r) => r.key);
}

let fixture: Fixture;
let recruiter: User;
let manager: User;
let submissionId: string;
let interviewId: string;
let offerId: string;

beforeAll(async () => {
  await cleanUp();
  recruiter = await userWithRole("super_admin");
  manager = await userWithRole("hiring_manager");
  fixture = await makeFixture({
    leadRecruiterId: recruiter.id,
    hiringManagerId: manager.id,
    openings: 1,
  });
  await signInAs(recruiter.id);
});

// Identity is re-established before every test rather than restored at the end
// of the one that changed it: a test that fails half way through would
// otherwise leave the next four signed in as somebody else, and they would
// fail for a reason that has nothing to do with them.
beforeEach(async () => {
  await signInAs(recruiter.id);
});

afterAll(async () => {
  await cleanUp();
  await pool.end();
});

describe("sourced to hired", () => {
  it("puts the candidate into the pipeline", async () => {
    const result = await addToPipeline(
      { ok: false },
      form({ candidateId: fixture.candidateId, requisitionId: fixture.requisitionId }),
    );
    expect(result.ok, result.message).toBe(true);

    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.candidateId, fixture.candidateId));
    expect(row).toBeDefined();
    submissionId = row!.id;

    const pipeline = await loadPipeline();
    expect(row!.stage).toBe(pipeline.order[0]);
    expect(row!.status).toBe("active");
    // The board and the requirement both show this person now.
    expect(revalidated).toContain("/pipeline");
  });

  it("advances through the stages, writing a stage event each time", async () => {
    const pipeline = await loadPipeline();
    const path = [
      pipeline.entryOf("submitted"),
      pipeline.entryOf("interviewing"),
    ];

    for (const stage of path) {
      const result = await moveStage({ ok: false }, form({ submissionId, stage }));
      expect(result.ok, `${stage}: ${result.message}`).toBe(true);
    }

    const [row] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    expect(row!.stage).toBe(pipeline.entryOf("interviewing"));
    // Moving forward through the pipeline backfills the stages in between, so
    // the history reads as a path rather than as a jump.
    expect(row!.submittedAt).not.toBeNull();

    const events = await db
      .select()
      .from(activities)
      .where(eq(activities.entityId, submissionId));
    expect(events.length).toBeGreaterThan(0);
  });

  it("schedules a round and moves nobody backwards", async () => {
    const startsAt = new Date(Date.now() + 2 * 86_400_000);
    const result = await scheduleInterview(
      { ok: false },
      form({
        submissionId,
        title: "Technical Round 1",
        type: "technical",
        mode: "video",
        scheduledAt: startsAt.toISOString(),
        durationMinutes: 60,
        timezone: "America/Chicago",
        organizerId: recruiter.id,
        panelIds: [manager.id],
      }),
    );
    expect(result.ok, result.message).toBe(true);

    const [row] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.submissionId, submissionId));
    expect(row).toBeDefined();
    interviewId = row!.id;
    expect(row!.status).toBe("scheduled");
    // Booked for an hour, and the end instant is stored rather than derived.
    expect(row!.endsAt.getTime() - row!.scheduledAt.getTime()).toBe(3_600_000);
  });

  it("starts the feedback clock when the round completes", async () => {
    const result = await updateInterviewOutcome(
      { ok: false },
      form({ interviewId, status: "completed", outcome: "yes" }),
    );
    expect(result.ok, result.message).toBe(true);

    const [row] = await db.select().from(interviews).where(eq(interviews.id, interviewId));
    expect(row!.status).toBe("completed");
    expect(row!.feedbackDueAt).not.toBeNull();
    expect(row!.feedbackDueAt!.getTime()).toBeGreaterThan(row!.endsAt.getTime());
  });

  it("records a scorecard, scored against the configured template", async () => {
    await signInAs(manager.id);

    const scores = await scorecardKeys();
    expect(scores.length, "no default scorecard template is seeded").toBeGreaterThan(0);

    // A scorecard missing one of the template's competencies is refused —
    // a partial scorecard is worse than none, because it averages as if it
    // were complete.
    const partial = await submitFeedback(
      { ok: false },
      form({
        interviewId,
        interviewerId: manager.id,
        recommendation: "hire",
        overall: 4,
        ...Object.fromEntries(scores.slice(1).map((k) => [`scores.${k}`, 4])),
      }),
    );
    expect(partial.ok).toBe(false);

    const result = await submitFeedback(
      { ok: false },
      form({
        interviewId,
        interviewerId: manager.id,
        recommendation: "hire",
        overall: 4,
        strengths: "Knew the stack.",
        concerns: "Little exposure to our scale.",
        ...Object.fromEntries(scores.map((k) => [`scores.${k}`, 4])),
      }),
    );
    expect(result.ok, result.message).toBe(true);

    const [row] = await db.select().from(feedback).where(eq(feedback.interviewId, interviewId));
    expect(row!.interviewerId).toBe(manager.id);
    expect(Object.keys(row!.scores).sort()).toEqual([...scores].sort());
  });

  it("drafts an offer and fills the seat when it is accepted", async () => {
    const pipeline = await loadPipeline();
    await moveStage({ ok: false }, form({ submissionId, stage: pipeline.entryOf("offer") }));

    const created = await createOffer(
      { ok: false },
      form({
        submissionId,
        baseSalary: 150000,
        currency: "USD",
        startDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
      }),
    );
    expect(created.ok, created.message).toBe(true);

    const [offer] = await db.select().from(offers).where(eq(offers.submissionId, submissionId));
    offerId = offer!.id;
    expect(offer!.status).toBe("draft");

    // The state machine will not let a draft be accepted directly.
    const skipped = await transitionOffer({ ok: false }, form({ offerId, status: "accepted" }));
    expect(skipped.ok).toBe(false);
    expect(skipped.message).toBeTruthy();

    for (const status of ["pending_approval", "approved", "extended", "accepted"]) {
      const step = await transitionOffer({ ok: false }, form({ offerId, status }));
      expect(step.ok, `${status}: ${step.message}`).toBe(true);
    }

    // The hire cascade: seat filled, requirement closed, candidate placed.
    const [req] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, fixture.requisitionId));
    expect(req!.filled).toBe(1);
    expect(req!.status).toBe("filled");
    expect(req!.closedAt).not.toBeNull();

    const [sub] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    expect(sub!.status).toBe("hired");
  });

  it("returns the seat when the offer is rescinded", async () => {
    const result = await transitionOffer({ ok: false }, form({ offerId, status: "rescinded" }));
    expect(result.ok, result.message).toBe(true);

    // The bug this exists to catch: rescinding used to leave the requirement
    // Filled with a stale closedAt, and the seat never came back.
    const [req] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, fixture.requisitionId));
    expect(req!.filled).toBe(0);
    expect(req!.status).not.toBe("filled");
    expect(req!.closedAt).toBeNull();

    // And the person is back in the talent pool rather than filtered out of
    // every search as Placed, on a job they never started.
    const [person] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, fixture.candidateId));
    expect(person!.status).toBe("active");

    const [sub] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    expect(sub!.status).toBe("rejected");
  });
});
