import {
  EMPLOYMENT_TYPES,
  PRIORITIES,
  WORK_AUTHORIZATIONS,
  WORK_MODES,
  type Priority,
} from "./domain";
import { normaliseName } from "./matching";

/**
 * Job-description extraction (§17).
 *
 * Pure, so it can be tested against real job-description prose rather than
 * against a mock of something that calls a model.
 *
 * The approach is extraction against a known vocabulary rather than open-ended
 * comprehension, and that is why it works: the organisation already knows what
 * skills it recruits for, what employment types it offers, and which work
 * authorizations exist. Matching against that list beats a general model
 * guessing at an unfamiliar taxonomy and inventing "Oracle Fusion Middleware
 * Cloud Suite" where the JD said "OIC".
 *
 * Everything comes back with a confidence and the span of text it came from,
 * because §17 requires a recruiter to review before saving and a reviewer
 * needs to see what the parser was looking at.
 */

export interface Extracted<T> {
  value: T;
  confidence: number;
  evidence: string;
}

const field = <T>(value: T, confidence: number, evidence = ""): Extracted<T> => ({
  value,
  confidence,
  evidence: evidence.trim().slice(0, 180),
});

/** The line a match was found on, for the evidence trail. */
function lineContaining(text: string, index: number) {
  if (index < 0) return "";
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? undefined : end).trim();
}

/* ------------------------------------------------------------------ *
 * Title
 * ------------------------------------------------------------------ */

const TITLE_LABEL = /(?:job\s*title|position|role|req(?:uirement)?\s*title)\s*[:\-–]\s*(.+)/i;

function extractTitle(text: string): Extracted<string> {
  const labelled = text.match(TITLE_LABEL);
  if (labelled?.[1]) return field(labelled[1].trim().slice(0, 120), 0.95, labelled[0]);

  // Otherwise the first non-empty line, which is where a title usually is —
  // but a low confidence, because it is a guess and the reviewer should look.
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 3 && l.length < 120);
  return first ? field(first, 0.45, first) : field("", 0, "");
}

/* ------------------------------------------------------------------ *
 * Skills
 * ------------------------------------------------------------------ */

const REQUIRED_HEADING =
  /(?:^|\n)\s*(?:required|must[\s-]?have|essential|mandatory)[^\n:]*:?\s*\n?/i;
const PREFERRED_HEADING =
  /(?:^|\n)\s*(?:preferred|nice[\s-]?to[\s-]?have|desirable|bonus|plus)[^\n:]*:?\s*\n?/i;

/**
 * Split the document at a required/preferred heading.
 *
 * A JD that separates its must-haves from its nice-to-haves is telling us
 * something the skill list alone cannot, and honouring that is the difference
 * between a useful extraction and a bag of words.
 */
function splitSections(text: string) {
  const requiredAt = text.search(REQUIRED_HEADING);
  const preferredAt = text.search(PREFERRED_HEADING);

  if (requiredAt === -1 && preferredAt === -1) {
    return { required: text, preferred: "", split: false };
  }
  if (preferredAt === -1) {
    return { required: text.slice(requiredAt), preferred: "", split: true };
  }
  if (requiredAt === -1 || requiredAt > preferredAt) {
    return { required: text.slice(0, preferredAt), preferred: text.slice(preferredAt), split: true };
  }
  return {
    required: text.slice(requiredAt, preferredAt),
    preferred: text.slice(preferredAt),
    split: true,
  };
}

/**
 * Find known skills in a block of text.
 *
 * Matched on word boundaries over the normalised form, so "PL/SQL" is found in
 * "strong PL/SQL", and "Go" is not found inside "Mongo".
 */
function findSkills(block: string, vocabulary: string[]) {
  const haystack = ` ${block.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const found: string[] = [];
  for (const skill of vocabulary) {
    const needle = ` ${skill.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    if (needle.trim() && haystack.includes(needle)) found.push(skill);
  }
  return [...new Set(found)];
}

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

const EXPERIENCE_RANGE = /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years|yrs)/i;
const EXPERIENCE_MIN = /(\d{1,2})\s*\+?\s*(?:years|yrs)/i;

function extractExperience(text: string): { min: Extracted<number>; max: Extracted<number> } {
  const range = text.match(EXPERIENCE_RANGE);
  if (range) {
    return {
      min: field(Number(range[1]), 0.9, lineContaining(text, range.index ?? -1)),
      max: field(Number(range[2]), 0.9, lineContaining(text, range.index ?? -1)),
    };
  }
  const min = text.match(EXPERIENCE_MIN);
  if (min) {
    const years = Number(min[1]);
    return {
      min: field(years, 0.8, lineContaining(text, min.index ?? -1)),
      // "8+ years" states a floor and nothing else. A ceiling has to be
      // invented, so it is invented visibly and with low confidence.
      max: field(years + 6, 0.3, lineContaining(text, min.index ?? -1)),
    };
  }
  return { min: field(0, 0, ""), max: field(10, 0, "") };
}

const MONEY = /\$?\s?(\d{2,3})(?:[,.](\d{3}))?\s*(k\b|,000)?/gi;
const RATE_CONTEXT = /(?:per\s*hour|\/\s*hr|hourly|an hour|\/hour)/i;
const SALARY_CONTEXT = /(?:per\s*annum|annually|\/\s*yr|per year|salary|base)/i;

/**
 * Compensation, as either a rate or a salary.
 *
 * Which one is decided by the words around the number rather than by its
 * size: a $95 figure could be a rate, and "95k" a salary, and guessing from
 * magnitude alone gets it wrong at the boundaries.
 */
function extractMoney(text: string) {
  const empty = {
    minSalary: field<number | null>(null, 0, ""),
    maxSalary: field<number | null>(null, 0, ""),
    billRateMin: field<number | null>(null, 0, ""),
    billRateMax: field<number | null>(null, 0, ""),
  };

  const lines = text.split("\n");
  for (const line of lines) {
    const isRate = RATE_CONTEXT.test(line);
    const isSalary = SALARY_CONTEXT.test(line) || /\d{2,3}\s?k\b/i.test(line);
    if (!isRate && !isSalary) continue;

    const numbers: number[] = [];
    for (const m of line.matchAll(MONEY)) {
      const base = Number(m[1]);
      const thousands = m[2] ? Number(m[2]) : null;
      const kSuffix = Boolean(m[3]);
      if (Number.isNaN(base)) continue;
      numbers.push(thousands !== null ? base * 1000 + thousands : kSuffix ? base * 1000 : base);
    }
    if (!numbers.length) continue;

    const lo = Math.min(...numbers);
    const hi = Math.max(...numbers);
    if (isRate) {
      return {
        ...empty,
        billRateMin: field<number | null>(lo, 0.85, line),
        billRateMax: field<number | null>(hi, 0.85, line),
      };
    }
    return {
      ...empty,
      minSalary: field<number | null>(lo, 0.85, line),
      maxSalary: field<number | null>(hi, 0.85, line),
    };
  }
  return empty;
}

/* ------------------------------------------------------------------ *
 * Categorical fields
 * ------------------------------------------------------------------ */

const EMPLOYMENT_HINTS: [string, RegExp][] = [
  ["c2c", /\b(?:c2c|corp[\s-]?to[\s-]?corp)\b/i],
  ["w2", /\bw[\s-]?2\b/i],
  ["contract_to_hire", /\b(?:c2h|contract[\s-]?to[\s-]?hire|temp[\s-]?to[\s-]?perm)\b/i],
  ["full_time", /\b(?:full[\s-]?time|permanent|perm|fte)\b/i],
  ["part_time", /\bpart[\s-]?time\b/i],
  ["intern", /\b(?:intern|internship)\b/i],
  ["contract", /\bcontract(?:or)?\b/i],
];

const WORK_MODE_HINTS: [string, RegExp][] = [
  ["remote", /\b(?:remote|work from home|wfh|fully distributed)\b/i],
  ["hybrid", /\bhybrid\b/i],
  ["onsite", /\b(?:on[\s-]?site|in[\s-]?office|in person)\b/i],
];

const AUTH_HINTS: [string, RegExp][] = [
  ["citizen", /\b(?:us citizen|usc|citizens? only)\b/i],
  ["green_card", /\b(?:green[\s-]?card|gc holder|permanent resident)\b/i],
  ["h1b", /\bh[\s-]?1[\s-]?b\b/i],
  ["ead", /\b(?:ead|h4[\s-]?ead|l2[\s-]?ead)\b/i],
  ["opt_cpt", /\b(?:opt|cpt)\b/i],
  ["tn", /\btn\s*visa\b/i],
  ["requires_sponsorship", /\b(?:sponsorship (?:is )?available|will sponsor)\b/i],
];

/**
 * A labelled location line.
 *
 * The label is matched case-insensitively but a separator is required: without
 * one, the word "office" anywhere in the prose would capture whatever followed
 * it. The captured text stops at a comma-plus-state or the end of the line.
 */
const LOCATION_LABEL =
  /(?:location|based in|onsite in|office)\s*[:\-–]\s*([^\n,]+(?:,\s*[A-Za-z]{2}\b)?)/i;

function firstHint(text: string, hints: [string, RegExp][], fallback: string, confidence = 0.85) {
  for (const [value, pattern] of hints) {
    const m = text.match(pattern);
    if (m) return field(value, confidence, lineContaining(text, m.index ?? -1));
  }
  return field(fallback, 0, "");
}

/* ------------------------------------------------------------------ *
 * Interview process
 * ------------------------------------------------------------------ */

const PROCESS_HEADING = /(?:interview\s*process|hiring\s*process|selection\s*process)\s*[:\-–]?\s*/i;

function extractProcess(text: string): Extracted<string> {
  const at = text.search(PROCESS_HEADING);
  if (at === -1) return field("", 0, "");
  // Take to the next blank line: a process description is a short block.
  const after = text.slice(at);
  const end = after.indexOf("\n\n");
  return field((end === -1 ? after : after.slice(0, end)).trim().slice(0, 600), 0.8, "");
}

/* ------------------------------------------------------------------ *
 * The parse
 * ------------------------------------------------------------------ */

export interface JdParseResult {
  title: Extracted<string>;
  requiredSkills: Extracted<string[]>;
  preferredSkills: Extracted<string[]>;
  experienceMin: Extracted<number>;
  experienceMax: Extracted<number>;
  location: Extracted<string>;
  workMode: Extracted<string>;
  workAuthorization: Extracted<string[]>;
  employmentType: Extracted<string>;
  minSalary: Extracted<number | null>;
  maxSalary: Extracted<number | null>;
  billRateMin: Extracted<number | null>;
  billRateMax: Extracted<number | null>;
  priority: Extracted<string>;
  interviewProcess: Extracted<string>;
  unmatched: string[];
}

export function parseJobDescription(text: string, vocabulary: string[]): JdParseResult {
  const sections = splitSections(text);

  const requiredFound = findSkills(sections.required, vocabulary);
  const preferredFound = findSkills(sections.preferred, vocabulary).filter(
    (s) => !requiredFound.includes(s),
  );

  // With no headings there is no basis for calling anything preferred, so
  // everything found is offered as required and the confidence says why.
  const requiredSkills = field(
    requiredFound,
    sections.split ? 0.85 : 0.55,
    sections.split ? "From the must-have section" : "No must-have heading found",
  );
  const preferredSkills = field(
    preferredFound,
    sections.split && preferredFound.length ? 0.8 : 0,
    sections.split ? "From the nice-to-have section" : "",
  );

  const experience = extractExperience(text);
  const money = extractMoney(text);

  const locationMatch = text.match(LOCATION_LABEL);
  const location = locationMatch?.[1]
    ? field(locationMatch[1].trim(), 0.8, locationMatch[0])
    : field("", 0, "");

  const authFound = AUTH_HINTS.filter(([, p]) => p.test(text)).map(([v]) => v);
  const workAuthorization = field(
    authFound,
    authFound.length ? 0.75 : 0,
    authFound.length ? lineContaining(text, text.search(AUTH_HINTS[0]![1])) : "",
  );

  const urgent = /\b(?:urgent|asap|immediate(?:ly)? (?:start|need)|critical|hot)\b/i.exec(text);
  const priority = urgent
    ? field<string>("critical", 0.7, lineContaining(text, urgent.index))
    : field<string>("medium", 0, "");

  // Anything that looked like a skill line but matched nothing known. Shown
  // to the reviewer rather than dropped, because an unknown skill is usually
  // a real one the vocabulary has not caught up with.
  const knownKeys = new Set(vocabulary.map(normaliseName));
  const unmatched = [
    ...new Set(
      text
        .split(/\n/)
        .filter((l) => /^[\s*\-•]/.test(l))
        .flatMap((l) => l.replace(/^[\s*\-•]+/, "").split(/[,;/]| and /i))
        .map((t) => t.trim())
        .filter((t) => t.length > 1 && t.length < 40 && !knownKeys.has(normaliseName(t))),
    ),
  ].slice(0, 12);

  return {
    title: extractTitle(text),
    requiredSkills,
    preferredSkills,
    experienceMin: experience.min,
    experienceMax: experience.max,
    location,
    workMode: firstHint(text, WORK_MODE_HINTS, WORK_MODES[0]!.value),
    workAuthorization,
    employmentType: firstHint(text, EMPLOYMENT_HINTS, EMPLOYMENT_TYPES[0]!.value),
    ...money,
    priority,
    interviewProcess: extractProcess(text),
    unmatched,
  };
}

/** Guard rails, so an extracted value can never be outside its vocabulary. */
export function isKnownPriority(value: string): value is Priority {
  return PRIORITIES.some((p) => p.value === value);
}

export function knownAuthorizations(values: string[]) {
  const known = new Set(WORK_AUTHORIZATIONS.map((w) => w.value));
  return values.filter((v) => known.has(v as never));
}
