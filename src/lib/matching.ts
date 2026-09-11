/**
 * Candidate identity matching (§6, §20).
 *
 * Pure, because this is where a wrong answer is expensive in both directions:
 * a missed duplicate splits one person's history across two records, and a
 * false positive offers to merge two different people. Neither is discovered
 * quickly, so the rules are here with tests rather than inline in an action.
 *
 * Nothing here blocks a save. Exact email is already enforced by a unique
 * index; everything else is a *suggestion* shown to a recruiter, who knows
 * things this code does not — two Priya Raghavans at the same integrator is
 * entirely possible.
 */

/** Lower case, strip anything that is not a letter or digit. */
export function normaliseName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    // Strip diacritics, so "Renée" and "Renee" are the same person.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The last ten digits of a phone number.
 *
 * Enough to match across the formats people actually type — `+1 (512)
 * 555-0142`, `512.555.0142`, `0015125550142` — without pretending to parse
 * international dialling properly. Anything shorter than ten digits is not
 * matched on at all, because a four-digit extension would collide constantly.
 */
export function normalisePhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function normaliseEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/**
 * The local part of an email, with the things providers ignore removed.
 *
 * `p.raghavan+oracle@gmail.com` and `praghavan@gmail.com` are one mailbox at
 * Gmail. Used only as a weak signal, never on its own, because the dot rule is
 * not universal.
 */
export function emailIdentity(value: string | null | undefined) {
  const email = normaliseEmail(value);
  const at = email.indexOf("@");
  if (at < 1) return "";
  const local = email.slice(0, at).split("+")[0]!.replace(/\./g, "");
  return `${local}@${email.slice(at + 1)}`;
}

/** Levenshtein distance, capped — we only care whether it is small. */
function editDistance(a: string, b: string, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      current[j] = value;
      if (value < best) best = value;
    }
    // Every path through this row already exceeds the cap.
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}

export interface Identity {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  currentCompany?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
}

export interface DuplicateMatch {
  /** 0–100. Above 90 is effectively certain; below 60 is not reported. */
  score: number;
  /** Why, in the words a recruiter would use. */
  reasons: string[];
  /** True only for a match no human should have to adjudicate. */
  certain: boolean;
}

const REPORT_THRESHOLD = 60;

/**
 * How likely two records are the same person.
 *
 * Deliberately additive and explainable rather than a single similarity
 * metric: a recruiter deciding whether to merge needs to see *which* fields
 * agreed, and "87% similar" tells them nothing they can act on.
 */
export function duplicateScore(a: Identity, b: Identity): DuplicateMatch | null {
  const reasons: string[] = [];
  let score = 0;
  let certain = false;

  const emailA = normaliseEmail(a.email);
  const emailB = normaliseEmail(b.email);
  if (emailA && emailA === emailB) {
    score += 100;
    reasons.push("Same email address");
    certain = true;
  } else if (emailA && emailIdentity(a.email) === emailIdentity(b.email)) {
    score += 55;
    reasons.push("Same mailbox, written differently");
  }

  const phoneA = normalisePhone(a.phone);
  const phoneB = normalisePhone(b.phone);
  if (phoneA && phoneA === phoneB) {
    score += 70;
    reasons.push("Same phone number");
  }

  const linkedinA = (a.linkedinUrl ?? "").trim().toLowerCase().replace(/\/$/, "");
  const linkedinB = (b.linkedinUrl ?? "").trim().toLowerCase().replace(/\/$/, "");
  if (linkedinA && linkedinA === linkedinB) {
    score += 80;
    reasons.push("Same LinkedIn profile");
  }

  const nameA = normaliseName(`${a.firstName}${a.lastName}`);
  const nameB = normaliseName(`${b.firstName}${b.lastName}`);
  const distance = editDistance(nameA, nameB);
  const sameName = distance === 0;
  const nearName = distance > 0 && distance <= 2 && nameA.length > 6;

  if (sameName) {
    score += 35;
    reasons.push("Same name");
  } else if (nearName) {
    score += 20;
    reasons.push("Name is one or two characters different");
  }

  // A shared name is common; a shared name *and* a shared employer or city is
  // the pattern that actually means one person entered twice.
  if (sameName || nearName) {
    const companyA = normaliseName(a.currentCompany ?? "");
    const companyB = normaliseName(b.currentCompany ?? "");
    if (companyA && companyA === companyB) {
      score += 30;
      reasons.push("Same current employer");
    }
    const locationA = normaliseName(a.location ?? "");
    const locationB = normaliseName(b.location ?? "");
    if (locationA && locationA === locationB) {
      score += 15;
      reasons.push("Same location");
    }
  }

  if (score < REPORT_THRESHOLD) return null;
  return { score: Math.min(100, score), reasons, certain };
}

/**
 * Matches against a pool, strongest first.
 *
 * Certainty sorts before score, not with it. Scores cap at 100, so a match on
 * phone, name, employer and city ties with an exact email — but those are
 * different categories of answer, and the one that needs no judgement should
 * be at the top.
 */
export function findDuplicates(subject: Identity, pool: Identity[]) {
  return pool
    .filter((other) => other.id !== subject.id)
    .map((other) => ({ other, match: duplicateScore(subject, other) }))
    .filter((r): r is { other: Identity; match: DuplicateMatch } => r.match !== null)
    .sort(
      (x, y) =>
        Number(y.match.certain) - Number(x.match.certain) || y.match.score - x.match.score,
    );
}
