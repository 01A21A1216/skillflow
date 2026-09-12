import { describe, expect, it } from "vitest";

import { PERMISSIONS, ROLES } from "@/lib/permissions";
import { RETENTION, rule } from "./privacy";

/**
 * The parts of the privacy machinery that can be checked without a database.
 *
 * Erasure itself is exercised end to end against Postgres — see the commit —
 * because what it does is delete things, and a test that mocks the database
 * would assert that the mock was called rather than that the data is gone.
 * What is worth pinning here is the policy: which roles can do it, and that
 * the retention periods are the ones somebody decided on rather than
 * whatever a refactor left behind.
 */

describe("the retention policy", () => {
  it("names a period for every class of personal data the app stores", () => {
    const keys = RETENTION.map((r) => r.key);
    expect(keys).toContain("candidate_dormant");
    expect(keys).toContain("communications");
    // Queued deliveries carry names and addresses in their payloads, which is
    // the least obvious store of personal data in the application and the
    // easiest one to forget.
    expect(keys).toContain("job_history");
    expect(keys).toContain("sessions");
  });

  it("keeps candidate records no longer than two years", () => {
    expect(rule("candidate_dormant").days).toBe(730);
  });

  it("expires nothing sooner than it expires job history", () => {
    // Job payloads are transient copies of data held properly elsewhere, so
    // they should be the shortest-lived thing here. If some other rule went
    // below a day it would be deleting a system of record.
    const shortest = Math.min(...RETENTION.map((r) => r.days));
    expect(rule("job_history").days).toBe(shortest);
  });

  it("explains each rule in words a person outside engineering could act on", () => {
    for (const r of RETENTION) {
      expect(r.description.length, r.key).toBeGreaterThan(40);
      expect(r.label.length, r.key).toBeGreaterThan(3);
    }
  });
});

describe("who may handle a data-subject request", () => {
  const holders = ROLES.filter((r) => r.permissions.includes("privacy.manage")).map((r) => r.key);

  it("is only the super admin by default", () => {
    // Erasure is irreversible and answers a legal request rather than a
    // recruiting need. An organisation whose ops lead fields those emails can
    // grant it — the matrix is rows — but the default is the restrictive one.
    expect(holders).toEqual(["super_admin"]);
  });

  it("is not implied by being able to see contact details", () => {
    const piiHolders = ROLES.filter((r) => r.permissions.includes("candidate.pii")).map((r) => r.key);
    expect(piiHolders.length).toBeGreaterThan(1);
    for (const role of piiHolders) {
      if (role === "super_admin") continue;
      expect(holders, `${role} should not be able to erase`).not.toContain(role);
    }
  });

  it("is marked sensitive, so the permission matrix flags it", () => {
    const permission = PERMISSIONS.find((p) => p.key === "privacy.manage");
    expect(permission?.sensitive).toBe(true);
  });
});
