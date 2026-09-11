import { describe, expect, it } from "vitest";

import {
  ConcurrencyError,
  checkVersion,
  describeChanges,
  diffFields,
  restoreValues,
  softDeleteValues,
  stamp,
  stampNew,
} from "./integrity";

/**
 * The integrity rules from §20. These are the behaviours that fail silently
 * when they regress: a diff that reports a change nobody made, or a version
 * check that lets one recruiter overwrite another.
 */

describe("diffFields", () => {
  const before = {
    title: "Backend Engineer",
    priority: "medium",
    openings: 1,
    minSalary: 120000,
    skills: ["Go", "SQL"],
    targetFillDate: null as string | null,
  };

  const labels = {
    title: "Job title",
    priority: "Priority",
    openings: "Openings",
    minSalary: "Salary minimum",
    skills: "Skills",
    targetFillDate: "Target fill date",
  };

  it("reports only fields that actually changed", () => {
    const changes = diffFields(before, { title: "Backend Engineer", priority: "high" }, labels);
    expect(changes).toEqual([
      { field: "priority", label: "Priority", from: "medium", to: "high" },
    ]);
  });

  it("returns nothing when a form is saved untouched", () => {
    expect(diffFields(before, { ...before }, labels)).toEqual([]);
  });

  it("ignores fields absent from the update", () => {
    const changes = diffFields(before, { openings: 2 }, labels);
    expect(changes.map((c) => c.field)).toEqual(["openings"]);
  });

  it("ignores fields with no label, so internals stay out of the trail", () => {
    const changes = diffFields(before, { priority: "high" }, { openings: "Openings" });
    expect(changes).toEqual([]);
  });

  it("compares arrays by content, not identity", () => {
    expect(diffFields(before, { skills: ["Go", "SQL"] }, labels)).toEqual([]);
    const changed = diffFields(before, { skills: ["Go", "Kafka"] }, labels);
    expect(changed[0]).toMatchObject({ field: "skills", from: "Go, SQL", to: "Go, Kafka" });
  });

  it("records a transition into and out of empty", () => {
    const set = diffFields(before, { targetFillDate: "2026-12-01" }, labels);
    expect(set[0]).toMatchObject({ from: null, to: "2026-12-01" });

    const cleared = diffFields(
      { ...before, targetFillDate: "2026-12-01" as string | null },
      { targetFillDate: null },
      labels,
    );
    expect(cleared[0]).toMatchObject({ from: "2026-12-01", to: null });
  });

  it("normalises dates so equal instants do not read as a change", () => {
    const at = new Date("2026-03-04T10:00:00Z");
    const changes = diffFields({ when: at }, { when: new Date(at.getTime()) }, { when: "When" });
    expect(changes).toEqual([]);
  });
});

describe("describeChanges", () => {
  it("names the single change", () => {
    expect(
      describeChanges([{ field: "priority", label: "Priority", from: "low", to: "high" }]),
    ).toBe("Priority low → high");
  });

  it("summarises several", () => {
    const text = describeChanges([
      { field: "a", label: "Priority", from: 1, to: 2 },
      { field: "b", label: "Openings", from: 1, to: 3 },
    ]);
    expect(text).toBe("2 fields changed: Priority, Openings");
  });

  it("says nothing when nothing changed", () => {
    expect(describeChanges([])).toBe("");
  });
});

describe("checkVersion", () => {
  it("advances when the submitted version matches", () => {
    expect(checkVersion("Requisition", 3, "3")).toBe(4);
  });

  it("refuses a save built on a stale read", () => {
    expect(() => checkVersion("Requisition", 5, "3")).toThrow(ConcurrencyError);
  });

  it("carries the versions on the error for the message", () => {
    try {
      checkVersion("Offer", 9, "7");
      expect.unreachable("should have thrown");
    } catch (error) {
      const e = error as ConcurrencyError;
      expect(e.entity).toBe("Offer");
      expect(e.expected).toBe(7);
      expect(e.actual).toBe(9);
    }
  });

  it("tolerates a form that predates the version field", () => {
    expect(checkVersion("Requisition", 2, undefined)).toBe(3);
    expect(checkVersion("Requisition", 2, "")).toBe(3);
    expect(checkVersion("Requisition", 2, null)).toBe(3);
  });

  it("treats a non-numeric version as absent rather than throwing", () => {
    expect(checkVersion("Requisition", 2, "not-a-number")).toBe(3);
  });
});

describe("stewardship stamps", () => {
  it("marks a new row as version 1 with both audit columns", () => {
    const s = stampNew("usr_1");
    expect(s.rowVersion).toBe(1);
    expect(s.createdBy).toBe("usr_1");
    expect(s.updatedBy).toBe("usr_1");
    expect(s.createdAt).toEqual(s.updatedAt);
  });

  it("records the editor and the next version on update", () => {
    const s = stamp("usr_2", 7);
    expect(s.updatedBy).toBe("usr_2");
    expect(s).toHaveProperty("rowVersion", 7);
  });

  it("omits rowVersion when no new version is supplied", () => {
    expect(stamp("usr_2")).not.toHaveProperty("rowVersion");
  });

  it("soft delete records who and when; restore clears both", () => {
    const deleted = softDeleteValues("usr_3");
    expect(deleted.deletedBy).toBe("usr_3");
    expect(deleted.deletedAt).toBeInstanceOf(Date);

    expect(restoreValues()).toEqual({ deletedAt: null, deletedBy: null });
  });
});
