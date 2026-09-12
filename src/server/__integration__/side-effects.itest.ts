import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db";
import { candidates, interviews, jobs, notifications, submissions } from "@/db/schema";
import type { User } from "@/db/schema";

import { addToPipeline } from "@/server/actions/pipeline";
import { scheduleInterview } from "@/server/actions/interviews";
import { eraseCandidateData } from "@/server/actions/privacy";
import { tick } from "@/server/jobs/worker";
import { cleanUp, form, makeFixture, signInAs, userWithRole, type Fixture } from "./harness";

/**
 * What an action does besides writing its own row.
 *
 * Notifications, queued integration calls and audit entries are all fire-and-
 * forget by design — they must never fail the user's action — which means a
 * broken one is completely silent. Nothing on any screen says "the panel was
 * not told". These are the tests that notice.
 */

let fixture: Fixture;
let admin: User;
let manager: User;
let submissionId: string;

beforeAll(async () => {
  await cleanUp();
  admin = await userWithRole("super_admin");
  manager = await userWithRole("hiring_manager");
  fixture = await makeFixture({ leadRecruiterId: admin.id, hiringManagerId: manager.id });
  await signInAs(admin.id);

  await addToPipeline(
    { ok: false },
    form({ candidateId: fixture.candidateId, requisitionId: fixture.requisitionId }),
  );
  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.candidateId, fixture.candidateId));
  submissionId = row!.id;
});

beforeEach(async () => {
  await signInAs(admin.id);
});

afterAll(async () => {
  await cleanUp();
  await pool.end();
});

describe("scheduling an interview", () => {
  let interviewId: string;

  beforeAll(async () => {
    await signInAs(admin.id);
    const result = await scheduleInterview(
      { ok: false },
      form({
        submissionId,
        title: "Side Effects Round",
        type: "technical",
        mode: "video",
        scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        durationMinutes: 45,
        timezone: "Europe/London",
        organizerId: admin.id,
        panelIds: [manager.id],
      }),
    );
    expect(result.ok, result.message).toBe(true);

    const [row] = await db
      .select()
      .from(interviews)
      .where(eq(interviews.submissionId, submissionId));
    interviewId = row!.id;
  });

  it("tells the panel, and does not tell the person who did it", async () => {
    const sent = await db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupeKey, `interview_scheduled:${interviewId}`));

    expect(sent.map((n) => n.userId)).toContain(manager.id);
    // The single most reliable way to make an inbox worthless is telling
    // people what they themselves just did.
    expect(sent.map((n) => n.userId)).not.toContain(admin.id);
    expect(sent[0]!.href).toContain(interviewId);
  });

  it("queues the calendar sync rather than waiting on it", async () => {
    const [queued] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.dedupeKey, `calendar.book:${interviewId}`));

    expect(queued, "no calendar job was queued").toBeDefined();
    expect(queued!.kind).toBe("calendar.book");
    expect(queued!.status).toBe("pending");
    expect(queued!.payload).toEqual({ interviewId });
  });

  it("runs that job to completion, declining because nothing is configured", async () => {
    await tick();

    const [ran] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.dedupeKey, `calendar.book:${interviewId}`));

    // Success, not failure: "no provider configured" is a state of the world,
    // not an error to retry against.
    expect(ran!.status).toBe("done");
    expect(ran!.attempts).toBe(1);
    expect(ran!.lastError).toBeNull();
  });

  it("deduplicates, so two identical enqueues are one job", async () => {
    const all = await db
      .select()
      .from(jobs)
      .where(eq(jobs.dedupeKey, `calendar.book:${interviewId}`));
    expect(all).toHaveLength(1);
  });

  afterAll(async () => {
    // Notifications and jobs are keyed on ids rather than the test prefix, so
    // they are cleaned up here where the ids are still known.
    await db
      .delete(notifications)
      .where(like(notifications.dedupeKey, `%${interviewId}%`));
    await db.delete(jobs).where(like(jobs.dedupeKey, `%${interviewId}%`));
  });
});

describe("erasing through the action", () => {
  it("refuses without the typed confirmation, and changes nothing", async () => {
    const result = await eraseCandidateData(
      { ok: false },
      form({ candidateId: fixture.candidateId, confirmation: "yes" }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors?.confirmation).toBeTruthy();

    const [row] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, fixture.candidateId));
    expect(row!.erasedAt).toBeNull();
    expect(row!.firstName).toBe("Test");
  });

  it("erases with it, and records why the audit trail next to it is empty", async () => {
    const result = await eraseCandidateData(
      { ok: false },
      form({ candidateId: fixture.candidateId, confirmation: "erase" }),
    );
    expect(result.ok, result.message).toBe(true);

    const [row] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, fixture.candidateId));
    expect(row!.erasedAt).not.toBeNull();
    expect(row!.erasureReason).toBe("request");
    expect(row!.email).toMatch(/@invalid$/);

    const { activities } = await import("@/db/schema");
    const [entry] = await db
      .select()
      .from(activities)
      .where(
        and(eq(activities.entityId, fixture.candidateId), eq(activities.type, "data_erased")),
      );
    expect(entry, "no audit entry explaining the erasure").toBeDefined();
    expect(entry!.summary).toContain("erased");
    expect(entry!.actorId).toBe(admin.id);

    // The submission survives as an anonymous row so the funnel still counts it.
    const [sub] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    expect(sub).toBeDefined();
    expect(sub!.requisitionId).toBe(fixture.requisitionId);
  });

  it("is a no-op the second time rather than an error", async () => {
    const result = await eraseCandidateData(
      { ok: false },
      form({ candidateId: fixture.candidateId, confirmation: "ERASE" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already been erased/i);
  });
});
