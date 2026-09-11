import { describe, expect, it } from "vitest";

import { matchCandidate, type CandidateProfile, type RequirementProfile } from "./match-score";

/**
 * Match scoring is an automated employment decision tool in every sense that
 * matters legally, so the tests double as the documentation of what it
 * weighs. Anyone auditing this can read them and know.
 */

const req = (over: Partial<RequirementProfile> = {}): RequirementProfile => ({
  requiredSkills: ["Oracle EBS R12", "PL/SQL", "AP / AR"],
  preferredSkills: ["BI Publisher", "OAF"],
  location: "Austin, TX",
  workMode: "hybrid",
  visaRequirements: [],
  employmentType: "w2",
  experienceMin: 5,
  experienceMax: 12,
  minSalary: 140000,
  maxSalary: 175000,
  billRateMin: 80,
  billRateMax: 110,
  ...over,
});

const cand = (over: Partial<CandidateProfile> = {}): CandidateProfile => ({
  skills: ["Oracle EBS R12", "PL/SQL", "AP / AR", "BI Publisher"],
  primaryTechnology: "Oracle EBS R12",
  location: "Austin, TX",
  willingToRelocate: false,
  workAuthorization: "citizen",
  availability: "two_weeks",
  yearsExperience: 8,
  expectedSalary: 160000,
  expectedRate: 95,
  ...over,
});

describe("matchCandidate", () => {
  it("scores a textbook match near the top", () => {
    const result = matchCandidate(req(), cand());
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.missingRequired).toEqual([]);
    expect(result.blocker).toBeNull();
  });

  it("never exceeds 100, so the number reads as a percentage", () => {
    const perfect = matchCandidate(
      req(),
      cand({ availability: "immediate", skills: ["Oracle EBS R12", "PL/SQL", "AP / AR", "BI Publisher", "OAF"] }),
    );
    expect(perfect.score).toBeLessThanOrEqual(100);
  });

  it("names the must-haves a candidate does not have", () => {
    const result = matchCandidate(req(), cand({ skills: ["PL/SQL"], primaryTechnology: "PL/SQL" }));
    expect(result.missingRequired).toEqual(["Oracle EBS R12", "AP / AR"]);
    expect(result.summary).toContain("missing Oracle EBS R12");
  });

  it("matches skills loosely enough to survive punctuation and case", () => {
    const result = matchCandidate(
      req({ requiredSkills: ["PL/SQL", "Oracle 19c"] }),
      cand({ skills: ["plsql", "ORACLE 19C"] }),
    );
    expect(result.missingRequired).toEqual([]);
  });

  it("counts the primary technology as a skill", () => {
    const result = matchCandidate(
      req({ requiredSkills: ["SAP S/4HANA"] }),
      cand({ skills: [], primaryTechnology: "SAP S/4HANA" }),
    );
    expect(result.matchingSkills).toEqual(["SAP S/4HANA"]);
  });

  /**
   * The one factor that is a hard fact rather than a preference. It is
   * surfaced as a blocker and costs its points — but it does not zero the
   * score, because §16 says AI must not auto-reject and a recruiter may know
   * the client will make an exception.
   */
  it("flags an unacceptable work authorization without rejecting the candidate", () => {
    const result = matchCandidate(
      req({ visaRequirements: ["citizen", "green_card"] }),
      cand({ workAuthorization: "h1b" }),
    );
    expect(result.blocker).toMatch(/does not accept/);
    expect(result.score).toBeGreaterThan(0);
    expect(result.summary).toContain("does not accept");
  });

  it("treats an empty visa list as no constraint", () => {
    const result = matchCandidate(req({ visaRequirements: [] }), cand({ workAuthorization: "requires_sponsorship" }));
    expect(result.blocker).toBeNull();
  });

  it("ignores location entirely for a remote role", () => {
    const here = matchCandidate(req({ workMode: "remote" }), cand({ location: "Pune, IN" }));
    const location = here.factors.find((f) => f.key === "location")!;
    expect(location.verdict).toBe("strong");
    expect(location.points).toBe(location.max);
  });

  it("gives partial credit to someone willing to relocate", () => {
    const willing = matchCandidate(req(), cand({ location: "Denver, CO", willingToRelocate: true }));
    const wont = matchCandidate(req(), cand({ location: "Denver, CO", willingToRelocate: false }));
    expect(willing.score).toBeGreaterThan(wont.score);
  });

  it("penalises being under the experience band more than being over it", () => {
    const junior = matchCandidate(req(), cand({ yearsExperience: 2 }));
    const senior = matchCandidate(req(), cand({ yearsExperience: 18 }));
    expect(senior.score).toBeGreaterThan(junior.score);
  });

  /**
   * Comparing an hourly rate to an annual band produces confident nonsense, so
   * the factor switches on the engagement type.
   */
  it("compares a contract role on rate and a permanent one on salary", () => {
    const contract = matchCandidate(req({ employmentType: "c2c" }), cand({ expectedRate: 95 }));
    expect(contract.factors.find((f) => f.key === "commercials")!.label).toBe("Rate");
    expect(contract.factors.find((f) => f.key === "commercials")!.detail).toContain("95/hr");

    const permanent = matchCandidate(req({ employmentType: "full_time" }), cand());
    expect(permanent.factors.find((f) => f.key === "commercials")!.label).toBe("Salary");
  });

  it("treats an unrecorded expectation as unknown rather than as bad", () => {
    const blank = matchCandidate(req(), cand({ expectedRate: null }));
    const over = matchCandidate(req(), cand({ expectedRate: 200 }));
    const factor = blank.factors.find((f) => f.key === "commercials")!;
    expect(factor.verdict).toBe("unknown");
    expect(blank.score).toBeGreaterThan(over.score);
  });

  it("explains every factor in terms of the values it compared", () => {
    const result = matchCandidate(req(), cand({ location: "Denver, CO" }));
    for (const f of result.factors) {
      expect(f.detail.length, `${f.key} has no explanation`).toBeGreaterThan(0);
      expect(f.points).toBeLessThanOrEqual(f.max);
      expect(f.points).toBeGreaterThanOrEqual(0);
    }
  });

  it("weights sum to 100, so the score is a real percentage", () => {
    const result = matchCandidate(req(), cand());
    expect(result.factors.reduce((n, f) => n + f.max, 0)).toBe(100);
  });

  it("copes with a requirement that specifies nothing", () => {
    const result = matchCandidate(
      req({ requiredSkills: [], preferredSkills: [], minSalary: null, maxSalary: null, billRateMin: null, billRateMax: null }),
      cand(),
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.missingRequired).toEqual([]);
  });
});
