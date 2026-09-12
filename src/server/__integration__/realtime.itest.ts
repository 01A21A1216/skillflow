import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "@/db";
import { submissions } from "@/db/schema";
import type { User } from "@/db/schema";

import { addToPipeline, moveStage } from "@/server/actions/pipeline";
import { publish, subscribe, type ChangeEvent } from "@/server/realtime";
import { loadPipeline } from "@/server/pipeline";
import { cleanUp, form, makeFixture, signInAs, userWithRole, type Fixture } from "./harness";

/**
 * The broadcast path (§1, item 4.1).
 *
 * Everything between a mutation and another person's screen: the action
 * publishes, Postgres carries it, this process's listener receives it. The
 * browser half — `EventSource` and `router.refresh()` — is verified in a real
 * browser, because a test of it here would be a test of a mock.
 *
 * What matters most is the last assertion: an event carries a hint and never
 * the changed data. That is the whole reason this design is safe, and it is
 * the kind of thing that erodes the first time somebody adds "just the name"
 * to save a round trip.
 */

let fixture: Fixture;
let admin: User;
let manager: User;
let submissionId: string;

/**
 * Start listening, then hand back a promise for the first matching event.
 *
 * Awaited before the mutation, deliberately. Subscribing opens a Postgres
 * connection and issues `LISTEN`, and publishing before that finishes loses
 * the event — a race that makes the test flaky rather than failing, which is
 * worse than either.
 */
async function listenFor(match: (e: ChangeEvent) => boolean, timeoutMs = 5000) {
  let resolve!: (e: ChangeEvent) => void;
  let reject!: (error: Error) => void;
  const settled = new Promise<ChangeEvent>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const unsubscribe = await subscribe((event) => {
    if (match(event)) resolve(event);
  });

  const timer = setTimeout(() => reject(new Error("no matching event arrived")), timeoutMs);

  // Wrapped in an object because awaiting this function must mean "listening
  // now", not "waiting for the event" — a promise returned directly would be
  // flattened by that await and deadlock against the mutation below it.
  return {
    received: settled.finally(() => {
      clearTimeout(timer);
      unsubscribe();
    }),
  };
}

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

afterAll(async () => {
  await cleanUp();
  await pool.end();
});

describe("publish and listen", () => {
  it("carries an event through Postgres", async () => {
    const { received } = await listenFor((e) => e.entityId === "rt_probe");
    await publish({ entity: "probe", entityId: "rt_probe", actorId: "usr_probe" });

    const event = await received;
    expect(event.entity).toBe("probe");
    expect(event.actorId).toBe("usr_probe");
    // Stamped by the publisher, so a client can tell a fresh event from a
    // replay after a reconnect.
    expect(event.at).toBeGreaterThan(Date.now() - 60_000);
  });

  it("survives a payload it cannot carry, rather than throwing", async () => {
    // Postgres refuses a notification over 8000 bytes. The caller is a
    // mutation that already succeeded; it must not fail because of this.
    await expect(
      publish({
        entity: "probe",
        entityId: "rt_big",
        actorId: null,
        scope: { huge: "x".repeat(9000) },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("a mutation announces itself", () => {
  it("publishes when a candidate is moved, naming who did it", async () => {
    const pipeline = await loadPipeline();
    const target = pipeline.entryOf("submitted");

    const { received } = await listenFor((e) => e.entityId === submissionId && e.entity === "submission");
    const result = await moveStage({ ok: false }, form({ submissionId, stage: target }));
    expect(result.ok, result.message).toBe(true);

    const event = await received;
    // The actor is what lets somebody's own browser ignore the echo of their
    // own action instead of fighting its own optimistic update.
    expect(event.actorId).toBe(admin.id);
    expect(event.scope?.requisitionId).toBe(fixture.requisitionId);
    expect(event.scope?.candidateId).toBe(fixture.candidateId);
  });

  it("sends a hint and never the data", async () => {
    const { received } = await listenFor((e) => e.entityId === submissionId && e.entity === "submission");
    const pipeline = await loadPipeline();
    await moveStage(
      { ok: false },
      form({ submissionId, stage: pipeline.entryOf("interviewing") }),
    );

    const event = await received;
    const payload = JSON.stringify(event);

    /*
     * Nothing identifying, and nothing about the change itself.
     *
     * A recipient must not be able to learn anything from an event they were
     * not entitled to learn from a page. The moment a name or a stage appears
     * here, "who may see this" has to be decided in the broadcast path too —
     * a second implementation of the row scoping, which is where the leak
     * would eventually come from.
     */
    expect(payload).not.toContain("Test Candidate");
    expect(payload).not.toContain("@example.invalid");
    expect(payload).not.toContain(pipeline.entryOf("interviewing"));
    expect(Object.keys(event).sort()).toEqual(["actorId", "at", "entity", "entityId", "scope"]);
  });
});
