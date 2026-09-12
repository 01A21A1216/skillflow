import { AVAILABILITIES, SENIORITIES, WORK_AUTHORIZATIONS } from "./domain";
import type { Extracted } from "./jd-parse";

/**
 * Resume extraction (§6, §2.2).
 *
 * Same shape as the job-description parser and for the same reasons: matched
 * against the organisation's own vocabulary, every field carrying a confidence
 * and the text it came from, and nothing written until a recruiter has looked
 * at it. A resume is a document supplied by a third party — extraction reads
 * it as data, never as instructions.
 *
 * What this does *not* attempt is a full CV understanding. It finds the
 * handful of structured facts a recruiter would otherwise retype — contact
 * details, skills, years, current role, authorization — and says plainly what
 * it could not find. A parser that confidently invents an employment history
 * is worse than one that leaves the section empty.
 */

export interface ParsedResume {
  firstName: Extracted<string>;
  lastName: Extracted<string>;
  email: Extracted<string>;
  phone: Extracted<string>;
  location: Extracted<string>;
  linkedinUrl: Extracted<string>;
  currentTitle: Extracted<string>;
  currentCompany: Extracted<string>;
  yearsExperience: Extracted<number>;
  seniority: Extracted<string>;
  skills: Extracted<string[]>;
  primaryTechnology: Extracted<string>;
  workAuthorization: Extracted<string>;
  availability: Extracted<string>;
  summary: Extracted<string>;
  /** Skill-shaped lines nothing recognised, so nothing is silently dropped. */
  unmatched: string[];
}

const field = <T>(value: T, confidence: number, evidence = ""): Extracted<T> => ({
  value,
  confidence,
  evidence: evidence.trim().slice(0, 160),
});

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/;
// Ten or more digits with the usual separators, so an employee number or a
// year range is not mistaken for a phone number.
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const LINKEDIN = /\b(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/[\w%-]+\/?/i;
const CITY_STATE = /\b([A-Z][a-z]+(?:[ -][A-Z][a-z]+)*),\s*([A-Z]{2})\b/;
const TOTAL_YEARS =
  /(\d{1,2})(?:\.\d)?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:total|overall|professional|relevant|industry))?\s*(?:experience|exp)?/i;

const AUTH_HINTS: [string, RegExp][] = [
  ["citizen", /\b(?:us citizen|u\.s\. citizen|usc)\b/i],
  ["green_card", /\b(?:green\s?card|gc holder|permanent resident|lpr)\b/i],
  ["h1b", /\bh[\s-]?1[\s-]?b\b/i],
  ["ead", /\b(?:h4[\s-]?ead|l2[\s-]?ead|\bead\b)/i],
  ["opt_cpt", /\b(?:opt|cpt|f[\s-]?1)\b/i],
  ["tn", /\btn\s*(?:visa|status)\b/i],
  ["requires_sponsorship", /\b(?:requires? sponsorship|need sponsorship|visa required)\b/i],
];

const AVAILABILITY_HINTS: [string, RegExp][] = [
  ["immediate", /\b(?:immediately available|available immediately|immediate joiner|can start immediately)\b/i],
  ["two_weeks", /\b(?:two weeks|2 weeks)\s*(?:notice)?\b/i],
  ["one_month", /\b(?:30 days?|one month|1 month)\s*(?:notice)?\b/i],
  ["two_months", /\b(?:60 days?|two months?|2 months?)\s*(?:notice)?\b/i],
];

/** Headings a CV uses before its current role. */
const EXPERIENCE_HEADING =
  /(?:^|\n)\s*(?:experience|work experience|professional experience|employment(?: history)?|career(?: history)?)\s*:?\s*\n/i;

/**
 * "Senior Oracle DBA at Infosys" / "Senior Oracle DBA | Infosys | 2021-present"
 *
 * Both forms are common and neither is a standard, so both are tried and a
 * failure is reported rather than guessed around.
 */
const ROLE_AT = /^(.{3,70}?)\s+(?:at|@|\||-|–|,)\s+(.{2,60}?)(?:\s*[|,–-]\s*.*)?$/;

function findSkills(text: string, vocabulary: string[]) {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return vocabulary.filter((skill) => {
    const needle = ` ${skill.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    return needle.trim().length > 1 && haystack.includes(needle);
  });
}

function lineWith(lines: string[], pattern: RegExp) {
  return lines.find((l) => pattern.test(l)) ?? "";
}

/**
 * A person's name from the top of a CV.
 *
 * Taken from the first line only when it looks like a name — two to four
 * capitalised words and no digits or punctuation. A CV that starts with
 * "CURRICULUM VITAE" or an address should produce nothing rather than a
 * plausible-looking wrong answer, because a wrong name is not obviously wrong
 * to whoever reviews it.
 */
function extractName(lines: string[]) {
  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 60) continue;
    if (/\d|@|\||resume|curriculum|vitae|profile/i.test(trimmed)) continue;
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((w) => /^[A-Z][\w'’-]*\.?$/.test(w))) continue;
    return {
      first: field(words[0]!, 0.75, trimmed),
      last: field(words[words.length - 1]!, 0.75, trimmed),
    };
  }
  return { first: field("", 0, ""), last: field("", 0, "") };
}

/** Current role and employer, from the first entry under an experience heading. */
function extractCurrentRole(text: string, lines: string[]) {
  const at = text.search(EXPERIENCE_HEADING);
  const after = at === -1 ? lines : text.slice(at).split("\n").slice(1);

  for (const raw of after.slice(0, 8)) {
    const line = raw.replace(/^[\s*\-•]+/, "").trim();
    if (line.length < 6 || line.length > 110) continue;
    const m = line.match(ROLE_AT);
    if (!m) continue;
    const [, title, company] = m;
    if (!title || !company) continue;
    // A bullet describing a responsibility is not a job title.
    if (/^(?:led|built|managed|delivered|responsible|owned|worked)/i.test(title)) continue;
    return {
      title: field(title.trim(), at === -1 ? 0.55 : 0.8, line),
      company: field(company.trim(), at === -1 ? 0.5 : 0.75, line),
    };
  }
  return { title: field("", 0, ""), company: field("", 0, "") };
}

function seniorityFor(title: string, years: number) {
  const t = title.toLowerCase();
  if (/\b(?:director|head of|vp|chief)\b/.test(t)) return "director";
  if (/\bprincipal\b/.test(t)) return "principal";
  if (/\b(?:staff|lead|architect)\b/.test(t)) return "staff";
  if (/\bsenior|sr\.?\b/.test(t)) return "senior";
  if (/\b(?:junior|jr\.?|associate|graduate)\b/.test(t)) return "junior";
  if (/\bintern\b/.test(t)) return "intern";
  // Falling back to years is a weaker signal than the title, and is reported
  // with a lower confidence by the caller.
  if (years >= 10) return "senior";
  if (years >= 4) return "mid";
  if (years > 0) return "junior";
  return "mid";
}

export function parseResume(text: string, vocabulary: string[]): ParsedResume {
  const lines = text.split("\n");

  const email = text.match(EMAIL)?.[0] ?? "";
  const phone = text.match(PHONE)?.[0] ?? "";
  const linkedin = text.match(LINKEDIN)?.[0] ?? "";
  const cityState = text.match(CITY_STATE);

  const name = extractName(lines);
  const role = extractCurrentRole(text, lines);

  const yearsMatch = text.match(TOTAL_YEARS);
  const years = yearsMatch ? Number(yearsMatch[1]) : 0;

  const skills = findSkills(text, vocabulary);

  const auth = AUTH_HINTS.find(([, p]) => p.test(text));
  const availability = AVAILABILITY_HINTS.find(([, p]) => p.test(text));

  // The first substantial paragraph, which on most CVs is the summary.
  const summary =
    lines
      .map((l) => l.trim())
      .find((l) => l.length > 80 && l.length < 600 && !/[@|]/.test(l)) ?? "";

  const knownKeys = new Set(vocabulary.map((v) => v.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const unmatched = [
    ...new Set(
      lines
        .filter((l) => /^[\s*\-•]/.test(l) && l.length < 60)
        .flatMap((l) => l.replace(/^[\s*\-•]+/, "").split(/[,;/]| and /i))
        .map((t) => t.trim())
        .filter(
          (t) =>
            t.length > 1 &&
            t.length < 36 &&
            !knownKeys.has(t.toLowerCase().replace(/[^a-z0-9]/g, "")),
        ),
    ),
  ].slice(0, 10);

  const titleValue = role.title.value;

  return {
    firstName: name.first,
    lastName: name.last,
    email: email ? field(email.toLowerCase(), 0.95, lineWith(lines, EMAIL)) : field("", 0, ""),
    phone: phone ? field(phone, 0.9, lineWith(lines, PHONE)) : field("", 0, ""),
    location: cityState
      ? field(`${cityState[1]}, ${cityState[2]}`, 0.8, cityState[0])
      : field("", 0, ""),
    linkedinUrl: linkedin
      ? field(linkedin.startsWith("http") ? linkedin : `https://${linkedin}`, 0.9, linkedin)
      : field("", 0, ""),
    currentTitle: role.title,
    currentCompany: role.company,
    yearsExperience: yearsMatch
      ? field(years, 0.8, yearsMatch[0])
      : field(0, 0, ""),
    seniority: field(
      seniorityFor(titleValue, years),
      titleValue ? 0.7 : years ? 0.4 : 0,
      titleValue,
    ),
    skills: field(skills, skills.length ? 0.8 : 0, `${skills.length} matched the skill list`),
    primaryTechnology: skills.length
      ? field(skills[0]!, 0.6, "most prominent known skill")
      : field("", 0, ""),
    workAuthorization: auth ? field(auth[0], 0.7, lineWith(lines, auth[1])) : field("", 0, ""),
    availability: availability
      ? field(availability[0], 0.7, lineWith(lines, availability[1]))
      : field("", 0, ""),
    summary: summary ? field(summary, 0.5, "first substantial paragraph") : field("", 0, ""),
    unmatched,
  };
}

/** Guard rails, so an extracted value can never escape its vocabulary. */
export function clampResume(parsed: ParsedResume) {
  const authKeys = new Set(WORK_AUTHORIZATIONS.map((w) => w.value));
  const availKeys = new Set(AVAILABILITIES.map((a) => a.value));
  const seniorityKeys = new Set(SENIORITIES.map((s) => s.value));

  if (!authKeys.has(parsed.workAuthorization.value as never)) {
    parsed.workAuthorization = field("", 0, "");
  }
  if (!availKeys.has(parsed.availability.value as never)) {
    parsed.availability = field("", 0, "");
  }
  if (!seniorityKeys.has(parsed.seniority.value as never)) {
    parsed.seniority = field("mid", 0, "");
  }
  return parsed;
}
