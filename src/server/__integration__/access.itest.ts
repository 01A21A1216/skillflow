import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "@/db";
import { candidates, requisitions, submissions } from "@/db/schema";
import type { User } from "@/db/schema";

import { changeRequisitionStatus, updateRequisition } from "@/server/actions/requisitions";
import { addToPipeline, moveStage } from "@/server/actions/pipeline";
import { eraseCandidateData } from "@/server/actions/privacy";
import { listRequisitions } from "@/server/queries/requisitions";
import { listCandidates } from "@/server/queries/candidates";
import { loadPipeline } from "@/server/pipeline";
import { cleanUp, form, makeFixture, signInAs, signOut, userWithRole, type Fixture } from "./harness";

/**
 * Access control, through the real guard rather than around it.
 *
 * `guarded(permission, impl)` is the single door every mutation goes through,
 * and the unit tests prove the matrix says the right things. What they cannot
 * prove is that the door is actually in the frame: that the permission a
 * handler was registered with is the one the operation needs, that a scoped
 * query really excludes rows rather than hiding them in the UI, and that a
 * signed-out caller gets nothing at all.
 *
 * These are the failures that do not look like failures. A mutation registered
 * under a permission everybody holds still works perfectly; it simply protects
 * nothing.
 */

let fixture: Fixture;
let admin: User;
let manager: User;
let interviewer: User;

beforeAll(async () => {
  await cleanUp();
  admin = await userWithRole("super_admin");
  manager = await userWithRole("hiring_manager");
  interviewer = await userWithRole("interviewer");

  fixture = await makeFixture({ leadRecruiterId: admin.id, hiringManagerId: manager.id });
  await signInAs(admin.id);
  await addToPipeline(
    { ok: false },
    form({ candidateId: fixture.candidateId, requisitionId: fixture.requisitionId }),
  );
});

afterAll(async () => {
  await cleanUp();
  await pool.end();
});

describe("signed out", () => {
  it("is refused, not served", async () => {
    signOut();
    const result = await changeRequisitionStatus(
      { ok: false },
      form({ requisitionId: fixture.requisitionId, status: "on_hold" }),
    );
    expect(result.ok).toBe(false);

    const [row] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, fixture.requisitionId));
    expect(row!.status).toBe("open");

    await signInAs(admin.id);
  });
});

describe("an interviewer", () => {
  beforeAll(async () => {
    await signInAs(interviewer.id);
  });

  it("cannot change a requirement's status", async () => {
    const result = await changeRequisitionStatus(
      { ok: false },
      form({ requisitionId: fixture.requisitionId, status: "on_hold" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/permission/i);

    const [row] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, fixture.requisitionId));
    expect(row!.status).toBe("open");
  });

  it("cannot move a candidate through the pipeline", async () => {
    const pipeline = await loadPipeline();
    const [before] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.candidateId, fixture.candidateId));

    const result = await moveStage(
      { ok: false },
      form({ submissionId: before!.id, stage: pipeline.entryOf("submitted") }),
    );
    expect(result.ok).toBe(false);

    const [after] = await db.select().from(submissions).where(eq(submissions.id, before!.id));
    expect(after!.stage).toBe(before!.stage);
  });

  it("cannot erase a person, even though they can see them", async () => {
    const result = await eraseCandidateData(
      { ok: false },
      form({ candidateId: fixture.candidateId, confirmation: "ERASE" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/permission/i);

    const [row] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, fixture.candidateId));
    expect(row!.erasedAt).toBeNull();
    expect(row!.firstName).not.toMatch(/erased/i);
  });

  it("sees only the requirements they are actually on", async () => {
    const visible = await listRequisitions({ status: "all" }, interviewer);
    // Scoping is a SQL predicate, so an out-of-scope row is never loaded —
    // not loaded and then filtered in the component, which is the version of
    // this that leaks through an export or an API route.
    expect(visible.map((r) => r.id)).not.toContain(fixture.requisitionId);

    const all = await listRequisitions({ status: "all" }, admin);
    expect(all.map((r) => r.id)).toContain(fixture.requisitionId);
    expect(all.length).toBeGreaterThan(visible.length);
  });
});

describe("candidate PII", () => {
  it("is redacted server-side for a role without the permission", async () => {
    const asInterviewer = await listCandidates({ q: "Test Candidate" }, interviewer);
    const asAdmin = await listCandidates({ q: "Test Candidate" }, admin);

    const mine = asAdmin.rows.find((c) => c.id === fixture.candidateId);
    expect(mine?.email).toBe(`${fixture.candidateId}@example.invalid`);

    // The interviewer may or may not see the row at all depending on scope;
    // what must never happen is seeing it *with* the contact details.
    for (const row of asInterviewer.rows) {
      expect(row.phone, `${row.id} leaked a phone number`).toBeNull();
      expect(row.expectedSalary, `${row.id} leaked a salary`).toBeNull();
    }
  });
});

describe("optimistic concurrency", () => {
  it("refuses the second of two edits made from the same starting point", async () => {
    await signInAs(admin.id);

    const [before] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, fixture.requisitionId));

    const base = {
      requisitionId: fixture.requisitionId,
      title: before!.title,
      clientId: before!.clientId,
      hiringManagerId: before!.hiringManagerId,
      leadRecruiterId: before!.leadRecruiterId,
      department: before!.department,
      employmentType: before!.employmentType,
      workMode: before!.workMode,
      location: before!.location,
      openings: before!.openings,
      priority: before!.priority,
      status: before!.status,
      seniority: before!.seniority,
      experienceMin: before!.experienceMin,
      experienceMax: before!.experienceMax,
      openedAt: before!.openedAt,
      rowVersion: before!.rowVersion,
    };

    const first = await updateRequisition({ ok: false }, form({ ...base, title: "First writer" }));
    expect(first.ok, first.message).toBe(true);

    // Same rowVersion: this is the second person, who loaded the form before
    // the first one saved.
    const second = await updateRequisition(
      { ok: false },
      form({ ...base, title: "Second writer" }),
    );
    expect(second.ok).toBe(false);
    expect(second.conflict).toBe(true);

    const [after] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, fixture.requisitionId));
    // The first writer's value survives. A last-write-wins bug looks identical
    // from the screen and silently discards somebody's work.
    expect(after!.title).toBe("First writer");
  });
});
