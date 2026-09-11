import { describe, expect, it } from "vitest";

import {
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLES,
  SCOPE_FALLBACK,
  roleDef,
  type PermissionKey,
} from "./permissions";

/**
 * The permission matrix is the kind of thing that breaks silently: a typo in a
 * permission key, or a role quietly gaining a capability during a refactor,
 * produces no error and no visible symptom until someone sees data they should
 * not. These tests pin the intent from the specification.
 */

const has = (roleKey: string, permission: PermissionKey) =>
  Boolean(roleDef(roleKey)?.permissions.includes(permission));

describe("permission catalogue", () => {
  it("has no duplicate keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("only grants permissions that exist", () => {
    const known = new Set<string>(PERMISSION_KEYS);
    for (const role of ROLES) {
      for (const p of role.permissions) {
        expect(known.has(p), `${role.key} grants unknown permission "${p}"`).toBe(true);
      }
    }
  });

  it("grants no permission twice within a role", () => {
    for (const role of ROLES) {
      expect(new Set(role.permissions).size, `${role.key} has duplicates`).toBe(
        role.permissions.length,
      );
    }
  });

  it("marks candidate contact data as sensitive", () => {
    expect(PERMISSIONS.find((p) => p.key === "candidate.pii")?.sensitive).toBe(true);
  });

  it("points every scope fallback at a real permission", () => {
    for (const [narrow, broad] of Object.entries(SCOPE_FALLBACK)) {
      expect(PERMISSION_KEYS).toContain(narrow);
      expect(PERMISSION_KEYS).toContain(broad!);
    }
  });
});

describe("roles match the specification", () => {
  it("defines exactly the seven specified roles", () => {
    expect(ROLES.map((r) => r.key).sort()).toEqual(
      [
        "hiring_manager",
        "interviewer",
        "readonly_management",
        "recruiter",
        "recruitment_manager",
        "sourcer",
        "super_admin",
      ].sort(),
    );
  });

  it("gives super admin everything", () => {
    expect(roleDef("super_admin")!.permissions).toHaveLength(PERMISSION_KEYS.length);
  });

  it("reserves settings management to super admin", () => {
    const withSettings = ROLES.filter((r) => r.permissions.includes("settings.manage"));
    expect(withSettings.map((r) => r.key)).toEqual(["super_admin"]);
  });
});

describe("read-only management is genuinely read-only", () => {
  const WRITES: PermissionKey[] = [
    "requisition.create",
    "requisition.edit",
    "requisition.status",
    "candidate.create",
    "candidate.edit",
    "submission.create",
    "submission.move",
    "submission.close",
    "interview.schedule",
    "interview.cancel",
    "feedback.submit",
    "offer.create",
    "offer.edit",
    "offer.approve",
    "offer.transition",
    "client.manage",
    "team.manage",
    "settings.manage",
    "note.create",
  ];

  it.each(WRITES)("cannot %s", (permission) => {
    expect(has("readonly_management", permission)).toBe(false);
  });

  it("cannot see candidate contact details", () => {
    expect(has("readonly_management", "candidate.pii")).toBe(false);
  });

  it("can still read dashboards and export", () => {
    expect(has("readonly_management", "report.view")).toBe(true);
    expect(has("readonly_management", "report.export")).toBe(true);
  });
});

describe("interviewer is scoped to their own panel", () => {
  it("sees only their own interviews", () => {
    expect(has("interviewer", "interview.view.own")).toBe(true);
    expect(has("interviewer", "interview.view.all")).toBe(false);
  });

  it("can submit feedback", () => {
    expect(has("interviewer", "feedback.submit")).toBe(true);
  });

  it("cannot browse the candidate database", () => {
    expect(has("interviewer", "candidate.view.all")).toBe(false);
    expect(has("interviewer", "candidate.pii")).toBe(false);
  });

  it("cannot move candidates or touch offers", () => {
    expect(has("interviewer", "submission.move")).toBe(false);
    expect(has("interviewer", "offer.view")).toBe(false);
  });
});

describe("recruiter is scoped to their own desk", () => {
  it("sees assigned requirements, not the whole organisation", () => {
    expect(has("recruiter", "requisition.view.assigned")).toBe(true);
    expect(has("recruiter", "requisition.view.all")).toBe(false);
  });

  it("runs the pipeline end to end", () => {
    for (const p of ["submission.create", "submission.move", "submission.close"] as PermissionKey[]) {
      expect(has("recruiter", p)).toBe(true);
    }
  });

  it("cannot approve its own offers", () => {
    expect(has("recruiter", "offer.create")).toBe(true);
    expect(has("recruiter", "offer.transition")).toBe(true);
    // Separation of duties: drafting and extending is not signing off.
    expect(has("recruiter", "offer.approve")).toBe(false);
  });

  it("cannot reconfigure the system", () => {
    expect(has("recruiter", "settings.manage")).toBe(false);
    expect(has("recruiter", "team.manage")).toBe(false);
  });
});

describe("sourcer works top of funnel only", () => {
  it("can add and qualify candidates", () => {
    expect(has("sourcer", "candidate.create")).toBe(true);
    expect(has("sourcer", "submission.create")).toBe(true);
  });

  it("cannot submit onward, interview, or touch offers", () => {
    expect(has("sourcer", "submission.move")).toBe(false);
    expect(has("sourcer", "interview.schedule")).toBe(false);
    expect(has("sourcer", "offer.view")).toBe(false);
  });
});

describe("hiring manager owns the decision, not the desk", () => {
  it("approves offers", () => {
    expect(has("hiring_manager", "offer.approve")).toBe(true);
  });

  it("does not draft or extend them", () => {
    expect(has("hiring_manager", "offer.create")).toBe(false);
    expect(has("hiring_manager", "offer.transition")).toBe(false);
  });

  it("cannot edit requirement details such as the salary band", () => {
    expect(has("hiring_manager", "requisition.edit")).toBe(false);
  });
});

describe("recruitment manager runs the organisation", () => {
  it("sees every requirement and every candidate", () => {
    expect(has("recruitment_manager", "requisition.view.all")).toBe(true);
    expect(has("recruitment_manager", "candidate.view.all")).toBe(true);
  });

  it("approves offers", () => {
    expect(has("recruitment_manager", "offer.approve")).toBe(true);
  });

  it("stops short of system configuration", () => {
    expect(has("recruitment_manager", "settings.manage")).toBe(false);
  });
});
