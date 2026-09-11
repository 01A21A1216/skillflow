import { describe, expect, it } from "vitest";

import { parseJobDescription } from "./jd-parse";

/**
 * Extraction tested against job descriptions written the way real ones are —
 * inconsistently. A parser that only handles tidy input is a demo.
 */

const VOCAB = [
  "Oracle EBS R12",
  "Oracle Fusion Cloud",
  "PL/SQL",
  "Oracle 19c",
  "RAC",
  "Performance Tuning",
  "OCI",
  "BI Publisher",
  "SAP S/4HANA",
  "Salesforce",
  "Apex",
  ".NET 8",
  "Go",
];

const TIDY = `Job Title: Senior Oracle EBS Consultant

Location: Austin, TX
Hybrid, 3 days on site.
Employment type: W-2 contract
Rate: $95 - $115 per hour
US Citizen or Green Card only. No sponsorship.

Required skills:
- Oracle EBS R12
- PL/SQL
- Performance Tuning

Nice to have:
- BI Publisher
- OCI

8-12 years of experience in Oracle applications.

Interview process:
Recruiter screen, then a client technical panel, then a final round with the programme director.
`;

describe("parseJobDescription", () => {
  it("reads a labelled title exactly", () => {
    const r = parseJobDescription(TIDY, VOCAB);
    expect(r.title.value).toBe("Senior Oracle EBS Consultant");
    expect(r.title.confidence).toBeGreaterThan(0.9);
  });

  it("honours the must-have and nice-to-have split", () => {
    const r = parseJobDescription(TIDY, VOCAB);
    expect(r.requiredSkills.value).toEqual(
      expect.arrayContaining(["Oracle EBS R12", "PL/SQL", "Performance Tuning"]),
    );
    expect(r.requiredSkills.value).toHaveLength(3);
    // Order follows the organisation's skill vocabulary rather than the
    // document, and is not a contract worth asserting.
    expect(r.preferredSkills.value).toEqual(expect.arrayContaining(["BI Publisher", "OCI"]));
    expect(r.preferredSkills.value).toHaveLength(2);
  });

  it("reads an experience range", () => {
    const r = parseJobDescription(TIDY, VOCAB);
    expect(r.experienceMin.value).toBe(8);
    expect(r.experienceMax.value).toBe(12);
  });

  it("reads an hourly rate as a rate, not a salary", () => {
    const r = parseJobDescription(TIDY, VOCAB);
    expect(r.billRateMin.value).toBe(95);
    expect(r.billRateMax.value).toBe(115);
    expect(r.minSalary.value).toBeNull();
  });

  it("reads location, work mode and employment type", () => {
    const r = parseJobDescription(TIDY, VOCAB);
    expect(r.location.value).toBe("Austin, TX");
    expect(r.workMode.value).toBe("hybrid");
    expect(r.employmentType.value).toBe("w2");
  });

  it("reads the accepted work authorizations", () => {
    const r = parseJobDescription(TIDY, VOCAB);
    expect(r.workAuthorization.value).toEqual(expect.arrayContaining(["citizen", "green_card"]));
  });

  it("captures the interview process as written", () => {
    const r = parseJobDescription(TIDY, VOCAB);
    expect(r.interviewProcess.value).toContain("client technical panel");
  });

  /**
   * A JD with no headings cannot distinguish must-have from nice-to-have. The
   * parser must say so through its confidence rather than inventing a split.
   */
  it("lowers its confidence when there is no must-have heading", () => {
    const flat = "We need someone strong in Oracle EBS R12 and PL/SQL for a project in Denver.";
    const r = parseJobDescription(flat, VOCAB);
    expect(r.requiredSkills.value).toEqual(["Oracle EBS R12", "PL/SQL"]);
    expect(r.requiredSkills.confidence).toBeLessThan(0.7);
    expect(r.preferredSkills.value).toEqual([]);
  });

  it("guesses a title from the first line, and says it is a guess", () => {
    const r = parseJobDescription("Salesforce Developer\n\nWe are hiring.", VOCAB);
    expect(r.title.value).toBe("Salesforce Developer");
    expect(r.title.confidence).toBeLessThan(0.6);
  });

  it("invents an experience ceiling visibly when only a floor is stated", () => {
    const r = parseJobDescription("10+ years of Oracle EBS R12 experience required.", VOCAB);
    expect(r.experienceMin.value).toBe(10);
    expect(r.experienceMin.confidence).toBeGreaterThan(0.7);
    // A ceiling nobody stated should not be presented as though they had.
    expect(r.experienceMax.confidence).toBeLessThan(0.5);
  });

  it("reads a salary written with a k suffix", () => {
    const r = parseJobDescription("Base salary 140k - 175k per annum.", VOCAB);
    expect(r.minSalary.value).toBe(140000);
    expect(r.maxSalary.value).toBe(175000);
    expect(r.billRateMin.value).toBeNull();
  });

  it("reads a salary written in full", () => {
    const r = parseJobDescription("Salary: $140,000 to $175,000 annually", VOCAB);
    expect(r.minSalary.value).toBe(140000);
    expect(r.maxSalary.value).toBe(175000);
  });

  it("spots urgency and raises the priority", () => {
    const r = parseJobDescription("URGENT: immediate start needed for this critical role.", VOCAB);
    expect(r.priority.value).toBe("critical");
  });

  it("defaults priority to medium rather than guessing", () => {
    const r = parseJobDescription("A steady long-term engagement.", VOCAB);
    expect(r.priority.value).toBe("medium");
    expect(r.priority.confidence).toBe(0);
  });

  /**
   * Substring matching would find "Go" inside "Mongo" and "RAC" inside
   * "Oracle". Word boundaries over the normalised form are what stop it.
   */
  it("does not find a short skill inside a longer word", () => {
    const r = parseJobDescription("Experience with MongoDB and tracing tools.", VOCAB);
    expect(r.requiredSkills.value).not.toContain("Go");
    expect(r.requiredSkills.value).not.toContain("RAC");
  });

  it("matches a skill despite punctuation differences", () => {
    const r = parseJobDescription("Strong PL SQL and Oracle 19C background.", VOCAB);
    expect(r.requiredSkills.value).toEqual(expect.arrayContaining(["PL/SQL", "Oracle 19c"]));
  });

  it("surfaces bullet items it could not place, rather than dropping them", () => {
    const r = parseJobDescription(
      "Required skills:\n- Oracle EBS R12\n- Hyperion Planning\n- Some bespoke internal tool\n",
      VOCAB,
    );
    expect(r.unmatched).toEqual(expect.arrayContaining(["Hyperion Planning"]));
  });

  it("carries evidence for anything it claims with confidence", () => {
    const r = parseJobDescription(TIDY, VOCAB);
    for (const f of [r.title, r.location, r.workMode, r.employmentType]) {
      if (f.confidence > 0.5) expect(f.evidence.length).toBeGreaterThan(0);
    }
  });

  it("returns something usable from an empty document", () => {
    const r = parseJobDescription("", VOCAB);
    expect(r.title.value).toBe("");
    expect(r.requiredSkills.value).toEqual([]);
    expect(r.title.confidence).toBe(0);
  });
});
