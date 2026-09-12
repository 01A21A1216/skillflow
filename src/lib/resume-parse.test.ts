import { describe, expect, it } from "vitest";

import { clampResume, parseResume } from "./resume-parse";

const VOCAB = [
  "Oracle 19c",
  "RAC",
  "Data Guard",
  "PL/SQL",
  "Performance Tuning",
  "Oracle EBS R12",
  "GoldenGate",
  "Exadata",
];

const CV = `Priya Raghavan
Austin, TX  ·  priya.raghavan@mail.com  ·  +1 (512) 555-0142
linkedin.com/in/priya-raghavan

Senior Oracle database professional with 12 years of experience running large production estates across finance and supply chain, including two Exadata migrations delivered without downtime.

US Citizen. Available immediately.

EXPERIENCE
Senior Oracle DBA at Infosys | 2019 - present
- Owned a 40TB estate across RAC and Data Guard
- Led performance tuning that took month-end close from 9 hours to 3

Oracle DBA at Wipro | 2015 - 2019
- Ran the upgrade from 11g to 19c

SKILLS
- Oracle 19c, RAC, Data Guard
- PL/SQL, Performance Tuning
- Hyperion Planning
`;

/**
 * Resume parsing is judged on what it declines to guess as much as on what it
 * finds. A wrong name or a confidently invented employer is not obviously
 * wrong to whoever reviews it.
 */
describe("parseResume", () => {
  it("reads the contact details exactly", () => {
    const r = parseResume(CV, VOCAB);
    expect(r.email.value).toBe("priya.raghavan@mail.com");
    expect(r.phone.value).toContain("512");
    expect(r.linkedinUrl.value).toBe("https://linkedin.com/in/priya-raghavan");
    expect(r.location.value).toBe("Austin, TX");
  });

  it("reads the name from the top of the document", () => {
    const r = parseResume(CV, VOCAB);
    expect(r.firstName.value).toBe("Priya");
    expect(r.lastName.value).toBe("Raghavan");
  });

  it("reads the current role and employer from the experience section", () => {
    const r = parseResume(CV, VOCAB);
    expect(r.currentTitle.value).toBe("Senior Oracle DBA");
    expect(r.currentCompany.value).toBe("Infosys");
  });

  it("reads total years", () => {
    expect(parseResume(CV, VOCAB).yearsExperience.value).toBe(12);
  });

  it("infers seniority from the title rather than the years", () => {
    expect(parseResume(CV, VOCAB).seniority.value).toBe("senior");
    const principal = parseResume("Jane Doe\n\nEXPERIENCE\nPrincipal Architect at Acme | 2020 - present", VOCAB);
    expect(principal.seniority.value).toBe("principal");
  });

  it("matches skills against the organisation's own list", () => {
    const r = parseResume(CV, VOCAB);
    expect(r.skills.value).toEqual(
      expect.arrayContaining(["Oracle 19c", "RAC", "Data Guard", "PL/SQL", "Performance Tuning"]),
    );
  });

  it("surfaces a skill it does not recognise rather than dropping it", () => {
    expect(parseResume(CV, VOCAB).unmatched).toEqual(
      expect.arrayContaining(["Hyperion Planning"]),
    );
  });

  it("reads work authorization and availability", () => {
    const r = parseResume(CV, VOCAB);
    expect(r.workAuthorization.value).toBe("citizen");
    expect(r.availability.value).toBe("immediate");
  });

  /**
   * The failure that matters. A CV starting with a heading rather than a name
   * must produce nothing, not a confident "Curriculum Vitae".
   */
  it("refuses to read a heading as a name", () => {
    const r = parseResume("CURRICULUM VITAE\n\nSome text here.", VOCAB);
    expect(r.firstName.value).toBe("");
    expect(r.firstName.confidence).toBe(0);
  });

  it("does not read a bullet describing work as a job title", () => {
    const r = parseResume(
      "Jane Doe\n\nEXPERIENCE\n- Led a migration at a large bank\nSenior DBA at Acme | 2020 - present",
      VOCAB,
    );
    expect(r.currentTitle.value).not.toMatch(/^Led/);
  });

  it("does not read a year range as a phone number", () => {
    const r = parseResume("Jane Doe\n\n2015 - 2019 at Acme", VOCAB);
    expect(r.phone.value).toBe("");
  });

  it("lowers its confidence when there is no experience heading", () => {
    const withHeading = parseResume(CV, VOCAB);
    const without = parseResume("Jane Doe\n\nSenior DBA at Acme | 2020 - present", VOCAB);
    expect(without.currentTitle.confidence).toBeLessThan(withHeading.currentTitle.confidence);
  });

  it("returns something usable from an empty document", () => {
    const r = parseResume("", VOCAB);
    expect(r.email.value).toBe("");
    expect(r.skills.value).toEqual([]);
    expect(r.yearsExperience.confidence).toBe(0);
  });

  it("clamps a value that is not in its vocabulary", () => {
    const r = parseResume(CV, VOCAB);
    r.workAuthorization.value = "something_invented";
    r.availability.value = "whenever";
    const clamped = clampResume(r);
    expect(clamped.workAuthorization.value).toBe("");
    expect(clamped.availability.value).toBe("");
  });
});
