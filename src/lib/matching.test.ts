import { describe, expect, it } from "vitest";

import {
  duplicateScore,
  emailIdentity,
  findDuplicates,
  normaliseName,
  normalisePhone,
  type Identity,
} from "./matching";

/**
 * Duplicate detection is expensive to get wrong in both directions: a missed
 * duplicate splits one person's history across two records, and a false
 * positive offers to merge two different people. Neither is discovered
 * quickly, so the interesting tests here are the near misses.
 */

const person = (over: Partial<Identity> = {}): Identity => ({
  id: "a",
  firstName: "Priya",
  lastName: "Raghavan",
  email: "priya.raghavan@mail.com",
  phone: "+1 (512) 555-0142",
  currentCompany: "Infosys",
  location: "Austin, TX",
  ...over,
});

describe("normalisePhone", () => {
  it("matches the same number written four different ways", () => {
    const forms = ["+1 (512) 555-0142", "512.555.0142", "5125550142", "001 512 555 0142"];
    const normalised = new Set(forms.map(normalisePhone));
    expect(normalised.size).toBe(1);
  });

  it("refuses to match on anything shorter than ten digits", () => {
    // An extension would otherwise collide with every other extension.
    expect(normalisePhone("4021")).toBe("");
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone(null)).toBe("");
  });
});

describe("normaliseName", () => {
  it("ignores punctuation, case and spacing", () => {
    expect(normaliseName("O'Brien")).toBe(normaliseName("obrien"));
    expect(normaliseName("Van Der Berg")).toBe(normaliseName("vanderberg"));
  });

  it("ignores diacritics, so one person is one person", () => {
    expect(normaliseName("Renée")).toBe(normaliseName("Renee"));
    expect(normaliseName("Muñoz")).toBe(normaliseName("Munoz"));
  });
});

describe("emailIdentity", () => {
  it("sees through plus-addressing and dots", () => {
    expect(emailIdentity("p.raghavan+oracle@gmail.com")).toBe("praghavan@gmail.com");
    expect(emailIdentity("praghavan@gmail.com")).toBe("praghavan@gmail.com");
  });

  it("keeps different domains apart", () => {
    expect(emailIdentity("a@gmail.com")).not.toBe(emailIdentity("a@outlook.com"));
  });

  it("returns nothing for something that is not an email", () => {
    expect(emailIdentity("not-an-email")).toBe("");
    expect(emailIdentity(null)).toBe("");
  });
});

describe("duplicateScore", () => {
  it("is certain about an exact email match", () => {
    const match = duplicateScore(person(), person({ id: "b", firstName: "P", lastName: "R" }));
    expect(match?.certain).toBe(true);
    expect(match?.reasons).toContain("Same email address");
  });

  it("catches the same person entered under a work and a personal address", () => {
    const match = duplicateScore(
      person(),
      person({ id: "b", email: "praghavan@infosys.com" }),
    );
    expect(match).not.toBeNull();
    expect(match!.score).toBeGreaterThanOrEqual(80);
    expect(match!.reasons).toContain("Same phone number");
    expect(match!.certain).toBe(false);
  });

  it("catches a plus-addressed re-registration", () => {
    const match = duplicateScore(
      person({ phone: null }),
      person({ id: "b", email: "priya.raghavan+2026@mail.com", phone: null }),
    );
    expect(match?.reasons).toContain("Same mailbox, written differently");
  });

  /**
   * The false positive that matters. Two people genuinely called the same
   * thing, at different employers, are two people — and at a firm placing
   * offshore ERP contractors this is not a hypothetical.
   */
  it("does not flag two different people who share a name", () => {
    const match = duplicateScore(
      person({ phone: null, email: "priya.r@mail.com" }),
      person({
        id: "b",
        phone: null,
        email: "priya.raghavan@outlook.com",
        currentCompany: "Wipro",
        location: "Pune, IN",
      }),
    );
    expect(match).toBeNull();
  });

  it("does flag a shared name at the same employer and city", () => {
    const match = duplicateScore(
      person({ phone: null, email: "priya.r@mail.com" }),
      person({ id: "b", phone: null, email: "priya.raghavan@outlook.com" }),
    );
    expect(match).not.toBeNull();
    expect(match!.reasons).toEqual(
      expect.arrayContaining(["Same name", "Same current employer", "Same location"]),
    );
  });

  it("tolerates a typo in a long name", () => {
    const match = duplicateScore(
      person({ phone: null, email: "a@mail.com" }),
      person({ id: "b", lastName: "Raghavn", phone: null, email: "b@mail.com" }),
    );
    expect(match?.reasons).toContain("Name is one or two characters different");
  });

  it("does not treat two short different names as a typo", () => {
    const match = duplicateScore(
      person({ firstName: "Li", lastName: "Wu", phone: null, email: "a@mail.com" }),
      person({ id: "b", firstName: "Lu", lastName: "Wu", phone: null, email: "b@mail.com" }),
    );
    expect(match).toBeNull();
  });

  it("matches on LinkedIn alone plus a name", () => {
    const match = duplicateScore(
      person({ phone: null, email: "a@mail.com", linkedinUrl: "https://linkedin.com/in/praghavan" }),
      person({
        id: "b",
        phone: null,
        email: "b@mail.com",
        currentCompany: "Wipro",
        location: "Pune, IN",
        linkedinUrl: "https://linkedin.com/in/praghavan/",
      }),
    );
    expect(match?.reasons).toContain("Same LinkedIn profile");
  });

  it("never scores above 100", () => {
    const match = duplicateScore(person(), person({ id: "b" }));
    expect(match!.score).toBe(100);
  });
});

describe("findDuplicates", () => {
  const pool = [
    person({ id: "b", email: "other@mail.com", phone: "512-555-0142" }),
    person({
      id: "c",
      firstName: "Marcus",
      lastName: "Ellery",
      email: "m@mail.com",
      phone: "212-555-0001",
      currentCompany: "Wipro",
    }),
    person({ id: "d", email: "priya.raghavan@mail.com", phone: null }),
  ];

  it("never matches a record against itself", () => {
    expect(findDuplicates(person({ id: "b" }), pool).some((r) => r.other.id === "b")).toBe(false);
  });

  it("returns the strongest match first", () => {
    const results = findDuplicates(person(), pool);
    expect(results[0]!.other.id).toBe("d");
    expect(results[0]!.match.certain).toBe(true);
  });

  it("leaves out people who are plainly someone else", () => {
    expect(findDuplicates(person(), pool).some((r) => r.other.id === "c")).toBe(false);
  });
});
