import { describe, expect, it } from "vitest";

import { HANDLERS } from "./handlers";
import { backoffMs } from "./queue";
import { RECURRING, slotKey } from "./schedule";

/**
 * The queue's arithmetic and its registry.
 *
 * Both of these fail quietly. A slot key that is not stable schedules a sweep
 * several times an hour and nobody notices except as a busier log; a backoff
 * that grows the wrong way turns one unreachable provider into a retry storm
 * against it.
 */

describe("slotKey", () => {
  it("is the same for every instant inside one slot", () => {
    const every = 60;
    const first = slotKey("k", every, new Date("2026-09-11T14:00:00Z"));
    expect(slotKey("k", every, new Date("2026-09-11T14:00:01Z"))).toBe(first);
    expect(slotKey("k", every, new Date("2026-09-11T14:59:59Z"))).toBe(first);
  });

  it("changes at the slot boundary", () => {
    const every = 60;
    expect(slotKey("k", every, new Date("2026-09-11T14:59:59Z"))).not.toBe(
      slotKey("k", every, new Date("2026-09-11T15:00:00Z")),
    );
  });

  it("floors to the period, not to the hour", () => {
    // A six-hourly job has four slots a day, at 00, 06, 12 and 18 UTC.
    const at = (iso: string) => slotKey("sweep.requirements", 360, new Date(iso));
    expect(at("2026-09-11T14:37:00Z")).toBe("sweep.requirements@2026-09-11T12:00");
    expect(at("2026-09-11T17:59:00Z")).toBe("sweep.requirements@2026-09-11T12:00");
    expect(at("2026-09-11T18:00:00Z")).toBe("sweep.requirements@2026-09-11T18:00");
  });

  it("separates two kinds that share a period", () => {
    const at = new Date("2026-09-11T14:00:00Z");
    expect(slotKey("a", 60, at)).not.toBe(slotKey("b", 60, at));
  });

  it("is UTC, so a DST change cannot skip or double a sweep", () => {
    // 02:30 US Eastern on the spring-forward date does not exist locally.
    expect(slotKey("k", 60, new Date("2026-03-08T07:30:00Z"))).toBe("k@2026-03-08T07:00");
  });
});

describe("backoffMs", () => {
  it("grows with each attempt", () => {
    const delays = [1, 2, 3, 4].map(backoffMs);
    expect(delays).toEqual([30_000, 120_000, 480_000, 1_920_000]);
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it("caps, so a long-dead provider is retried hourly rather than never", () => {
    expect(backoffMs(20)).toBe(3_600_000);
  });

  it("never returns a negative or zero delay", () => {
    expect(backoffMs(0)).toBeGreaterThan(0);
    expect(backoffMs(-5)).toBeGreaterThan(0);
  });
});

describe("the recurring schedule", () => {
  it("only names job kinds that have a handler", () => {
    // Also enforced by the type of `Recurring.kind`; asserted here because a
    // job kind with no handler is the failure this whole registry exists to
    // prevent, and a cast anywhere would quietly reopen it.
    for (const job of RECURRING) {
      expect(HANDLERS[job.kind], `no handler for ${job.kind}`).toBeTypeOf("function");
    }
  });

  it("has no duplicate kinds, which would double every tick", () => {
    const kinds = RECURRING.map((r) => r.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("runs nothing more often than once an hour", () => {
    // A sweep is about facts that change daily. Polling harder buys nothing
    // and costs three table scans each time.
    for (const job of RECURRING) {
      expect(job.everyMinutes).toBeGreaterThanOrEqual(60);
    }
  });
});
