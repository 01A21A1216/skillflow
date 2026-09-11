import { normaliseName } from "./matching";
import { isRateBased, visaMatches } from "./domain";

/**
 * Candidate-to-requirement matching (§16).
 *
 * Deliberately deterministic rather than a language model, for three reasons
 * that all point the same way.
 *
 * **The spec demands explainable evidence.** Every number below traces to a
 * field a recruiter can open and check. "The model said 92%" is not evidence.
 *
 * **Ranking candidates for employment is regulated.** NYC Local Law 144
 * requires an annual bias audit of automated employment decision tools; the
 * EU AI Act treats recruitment screening as high risk. An auditor can read
 * this file and tell you exactly what it weighs. Nobody can say that about an
 * opaque embedding.
 *
 * **It is simply more accurate here.** Skill overlap, work authorization,
 * rate and availability are structured facts. Asking a model to infer them
 * from prose, when they are already columns, would add error rather than
 * intelligence.
 *
 * Where a model genuinely helps — reading unstructured resume text into these
 * fields — that is the parser (§17), behind the provider port. This file
 * scores what is already known.
 *
 * Nothing here rejects anybody (§16). It produces a ranked, explained list
 * that a recruiter reads.
 */

export interface RequirementProfile {
  requiredSkills: string[];
  preferredSkills: string[];
  location: string;
  workMode: string;
  visaRequirements: string[];
  employmentType: string;
  experienceMin: number;
  experienceMax: number;
  minSalary: number | null;
  maxSalary: number | null;
  billRateMin: number | null;
  billRateMax: number | null;
}

export interface CandidateProfile {
  skills: string[];
  primaryTechnology: string;
  location: string;
  willingToRelocate: boolean;
  workAuthorization: string;
  availability: string;
  yearsExperience: number;
  expectedSalary: number | null;
  expectedRate: number | null;
}

export type FactorVerdict = "strong" | "partial" | "weak" | "unknown";

export interface Factor {
  key: string;
  label: string;
  verdict: FactorVerdict;
  /** What the recruiter reads. Always names the actual values compared. */
  detail: string;
  /** Contribution to the score, already weighted. */
  points: number;
  max: number;
}

export interface MatchResult {
  /** 0–100. */
  score: number;
  factors: Factor[];
  matchingSkills: string[];
  missingRequired: string[];
  matchingPreferred: string[];
  /** One sentence a recruiter could paste into an email. */
  summary: string;
  /**
   * True when something about this candidate rules them out for this client —
   * work authorization, almost always. Surfaced, never acted on.
   */
  blocker: string | null;
}

/** Weights. They sum to 100 so a score is directly readable as a percentage. */
const WEIGHTS = {
  requiredSkills: 40,
  preferredSkills: 10,
  experience: 15,
  location: 10,
  workAuthorization: 10,
  availability: 8,
  commercials: 7,
} as const;

const key = (skill: string) => normaliseName(skill);

/** Matched loosely, so "Oracle 19c" counts against "Oracle 19C" and "PL/SQL" against "PLSQL". */
function overlap(have: string[], want: string[]) {
  const haveKeys = new Set(have.map(key));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of want) {
    if (haveKeys.has(key(skill))) matched.push(skill);
    else missing.push(skill);
  }
  return { matched, missing };
}

/** The city part of "Austin, TX" — enough to compare two free-text locations. */
function city(location: string) {
  return normaliseName(location.split(",")[0] ?? location);
}

const AVAILABILITY_DAYS: Record<string, number> = {
  immediate: 0,
  two_weeks: 14,
  one_month: 30,
  two_months: 60,
  not_looking: 999,
};

export function matchCandidate(
  requirement: RequirementProfile,
  candidate: CandidateProfile,
): MatchResult {
  const factors: Factor[] = [];
  let blocker: string | null = null;

  /* --- Required skills ------------------------------------------- */
  const required = overlap(
    [...candidate.skills, candidate.primaryTechnology].filter(Boolean),
    requirement.requiredSkills,
  );
  const requiredRatio = requirement.requiredSkills.length
    ? required.matched.length / requirement.requiredSkills.length
    : 1;
  factors.push({
    key: "requiredSkills",
    label: "Must-have skills",
    verdict: requiredRatio === 1 ? "strong" : requiredRatio >= 0.6 ? "partial" : "weak",
    detail: requirement.requiredSkills.length
      ? `${required.matched.length} of ${requirement.requiredSkills.length}${
          required.missing.length ? ` — missing ${required.missing.join(", ")}` : ""
        }`
      : "No must-haves specified",
    points: Math.round(requiredRatio * WEIGHTS.requiredSkills),
    max: WEIGHTS.requiredSkills,
  });

  /* --- Preferred skills ------------------------------------------- */
  const preferred = overlap(candidate.skills, requirement.preferredSkills);
  const preferredRatio = requirement.preferredSkills.length
    ? preferred.matched.length / requirement.preferredSkills.length
    : 1;
  factors.push({
    key: "preferredSkills",
    label: "Nice to have",
    verdict: preferredRatio >= 0.5 ? "strong" : preferredRatio > 0 ? "partial" : "weak",
    detail: requirement.preferredSkills.length
      ? `${preferred.matched.length} of ${requirement.preferredSkills.length}`
      : "None specified",
    points: Math.round(preferredRatio * WEIGHTS.preferredSkills),
    max: WEIGHTS.preferredSkills,
  });

  /* --- Experience -------------------------------------------------- */
  const years = candidate.yearsExperience;
  const { experienceMin: lo, experienceMax: hi } = requirement;
  let experiencePoints: number;
  let experienceVerdict: FactorVerdict;
  let experienceDetail: string;
  if (years >= lo && years <= hi) {
    experiencePoints = WEIGHTS.experience;
    experienceVerdict = "strong";
    experienceDetail = `${years} years, inside the ${lo}–${hi} band`;
  } else if (years > hi) {
    // Over-qualified is a flight risk, not a disqualification, so it costs
    // a little rather than a lot.
    experiencePoints = Math.round(WEIGHTS.experience * 0.75);
    experienceVerdict = "partial";
    experienceDetail = `${years} years, above the ${lo}–${hi} band`;
  } else {
    const shortfall = lo - years;
    const ratio = Math.max(0, 1 - shortfall / Math.max(2, lo));
    experiencePoints = Math.round(WEIGHTS.experience * ratio);
    experienceVerdict = ratio > 0.6 ? "partial" : "weak";
    experienceDetail = `${years} years, ${shortfall} short of the ${lo}-year minimum`;
  }
  factors.push({
    key: "experience",
    label: "Experience",
    verdict: experienceVerdict,
    detail: experienceDetail,
    points: experiencePoints,
    max: WEIGHTS.experience,
  });

  /* --- Location ---------------------------------------------------- */
  const remote = requirement.workMode === "remote";
  const sameCity = city(candidate.location) === city(requirement.location);
  let locationPoints: number;
  let locationVerdict: FactorVerdict;
  let locationDetail: string;
  if (remote) {
    locationPoints = WEIGHTS.location;
    locationVerdict = "strong";
    locationDetail = "Remote role — location is not a constraint";
  } else if (sameCity) {
    locationPoints = WEIGHTS.location;
    locationVerdict = "strong";
    locationDetail = `Already in ${candidate.location}`;
  } else if (candidate.willingToRelocate) {
    locationPoints = Math.round(WEIGHTS.location * 0.6);
    locationVerdict = "partial";
    locationDetail = `In ${candidate.location}, open to relocating`;
  } else {
    locationPoints = 0;
    locationVerdict = "weak";
    locationDetail = `In ${candidate.location}, not open to relocating — role is ${requirement.workMode}`;
  }
  factors.push({
    key: "location",
    label: "Location",
    verdict: locationVerdict,
    detail: locationDetail,
    points: locationPoints,
    max: WEIGHTS.location,
  });

  /* --- Work authorization ------------------------------------------ */
  const authorised = visaMatches(requirement.visaRequirements, candidate.workAuthorization);
  if (!authorised) {
    blocker = "This client does not accept that work authorization";
  }
  factors.push({
    key: "workAuthorization",
    label: "Work authorization",
    verdict: authorised ? "strong" : "weak",
    detail: requirement.visaRequirements.length
      ? authorised
        ? "Accepted by this client"
        : `Client accepts ${requirement.visaRequirements.join(", ")}`
      : "Client has set no constraint",
    points: authorised ? WEIGHTS.workAuthorization : 0,
    max: WEIGHTS.workAuthorization,
  });

  /* --- Availability -------------------------------------------------- */
  const days = AVAILABILITY_DAYS[candidate.availability] ?? 30;
  const availabilityRatio = days >= 999 ? 0 : Math.max(0, 1 - days / 60);
  factors.push({
    key: "availability",
    label: "Availability",
    verdict: days <= 14 ? "strong" : days <= 30 ? "partial" : "weak",
    detail:
      days >= 999
        ? "Not currently looking"
        : days === 0
          ? "Available immediately"
          : `About ${days} days out`,
    points: Math.round(availabilityRatio * WEIGHTS.availability),
    max: WEIGHTS.availability,
  });

  /* --- Commercials ---------------------------------------------------- */
  // Contract roles are compared on rate and permanent ones on salary, because
  // comparing an hourly figure to an annual band produces confident nonsense.
  const contract = isRateBased(requirement.employmentType);
  const wants = contract ? candidate.expectedRate : candidate.expectedSalary;
  const bandLo = contract ? requirement.billRateMin : requirement.minSalary;
  const bandHi = contract ? requirement.billRateMax : requirement.maxSalary;
  const unit = contract ? "/hr" : "";

  let commercialPoints: number;
  let commercialVerdict: FactorVerdict;
  let commercialDetail: string;
  if (wants == null || bandHi == null) {
    // Unknown is not the same as bad. Award the midpoint and say it is unknown,
    // rather than silently penalising a profile nobody has finished filling in.
    commercialPoints = Math.round(WEIGHTS.commercials * 0.5);
    commercialVerdict = "unknown";
    commercialDetail = wants == null ? "No expectation recorded" : "No band on the requirement";
  } else if (wants <= bandHi) {
    commercialPoints = WEIGHTS.commercials;
    commercialVerdict = "strong";
    commercialDetail = `Wants ${wants}${unit}, inside the ${bandLo ?? 0}–${bandHi}${unit} band`;
  } else {
    const over = (wants - bandHi) / bandHi;
    commercialPoints = over < 0.15 ? Math.round(WEIGHTS.commercials * 0.5) : 0;
    commercialVerdict = over < 0.15 ? "partial" : "weak";
    commercialDetail = `Wants ${wants}${unit}, ${Math.round(over * 100)}% above the ${bandHi}${unit} ceiling`;
  }
  factors.push({
    key: "commercials",
    label: contract ? "Rate" : "Salary",
    verdict: commercialVerdict,
    detail: commercialDetail,
    points: commercialPoints,
    max: WEIGHTS.commercials,
  });

  const score = Math.min(100, factors.reduce((n, f) => n + f.points, 0));

  const strengths = [...required.matched, ...preferred.matched].slice(0, 4);
  const summary = [
    `${score}% match`,
    strengths.length ? `strong on ${strengths.join(", ")}` : "no overlapping skills",
    required.missing.length ? `missing ${required.missing.join(", ")}` : null,
    blocker,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    score,
    factors,
    matchingSkills: required.matched,
    missingRequired: required.missing,
    matchingPreferred: preferred.matched,
    summary,
    blocker,
  };
}
