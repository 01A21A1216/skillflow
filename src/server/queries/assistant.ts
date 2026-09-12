import "server-only";

import { eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { candidates, requisitions } from "@/db/schema";
import type { User } from "@/db/schema";
import { normaliseName } from "@/lib/matching";
import { parseQuery, type StructuredQuery, type Vocabulary } from "@/lib/nl-query";
import { listCandidates } from "@/server/queries/candidates";
import { awaitingFeedback, listInterviews } from "@/server/queries/interviews";
import { rankForRequisition } from "@/server/queries/matching";
import { recruiterPerformance } from "@/server/queries/analytics";
import { listRequisitions } from "@/server/queries/requisitions";
import { loadPipeline } from "@/server/pipeline";

export interface AnswerRow {
  id: string;
  title: string;
  subtitle: string;
  meta?: string;
  href: string;
}

export interface Answer {
  question: string;
  /** What the parser understood, shown so a misreading is visible. */
  interpretation: string[];
  headline: string;
  rows: AnswerRow[];
  total: number;
  /** Where to see the whole set with the usual filters. */
  seeAllHref: string | null;
  /** True when the question was not understood and this is a plain search. */
  fallback: boolean;
}

/**
 * The assistant (§15).
 *
 * Every branch below calls a query function that already takes `actor` and
 * applies the same row-level scope the pages do. That is the entire answer to
 * "never expose information the logged-in user is not authorized to see": the
 * assistant has no privileged path to the data, because it has no path at all
 * except the one the UI uses.
 *
 * Where a branch does reach the database directly, it repeats the scope
 * explicitly — visible requirement ids, soft-delete predicates — rather than
 * relying on the question having been benign.
 */
export async function answer(
  question: string,
  actor: User,
  vocabulary: Vocabulary,
): Promise<Answer> {
  const q = parseQuery(question, vocabulary);

  switch (q.entity) {
    case "requirements":
      return requirementAnswer(question, q, actor);
    case "interviews":
      return interviewAnswer(question, q, actor);
    case "recruiters":
      return recruiterAnswer(question, q);
    case "clients":
      return clientAnswer(question, q, actor);
    default:
      return candidateAnswer(question, q, actor);
  }
}

/* ------------------------------------------------------------------ *
 * Candidates
 * ------------------------------------------------------------------ */

async function candidateAnswer(
  question: string,
  q: StructuredQuery,
  actor: User,
): Promise<Answer> {
  // "Which candidates match REQ-x" is the matching engine, not a search.
  if (q.code) {
    const req = (
      await db.select().from(requisitions).where(eq(requisitions.code, q.code))
    )[0];
    if (!req) {
      return empty(question, q, `No requirement called ${q.code}.`);
    }
    const ranked = await rankForRequisition(req.id, actor, 15);
    return {
      question,
      interpretation: q.interpretation,
      headline: `${ranked?.ranked.length ?? 0} candidates matched against ${req.code}`,
      rows: (ranked?.ranked ?? []).map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.currentTitle} · ${c.currentCompany}`,
        meta: `${c.match.score}% — ${c.match.summary.split(" · ").slice(1, 2).join("")}`,
        href: `/candidates/${c.id}`,
      })),
      total: ranked?.ranked.length ?? 0,
      seeAllHref: `/requisitions/${req.id}`,
      fallback: false,
    };
  }

  // Candidates awaiting feedback are a property of their interviews, so the
  // question is answered from there and mapped back.
  if (q.awaitingFeedback) {
    const rows = await awaitingFeedback(undefined, actor);
    const filtered = q.interviewedThisWeek
      ? rows.filter((r) => Date.now() - r.scheduledAt.getTime() < 7 * 86_400_000)
      : rows;
    return {
      question,
      interpretation: q.interpretation,
      headline: `${filtered.length} candidates waiting on feedback`,
      rows: filtered.slice(0, 20).map((r) => ({
        id: r.id,
        title: r.candidateName,
        subtitle: `${r.title} · ${r.requisitionCode}`,
        meta: r.overdueBucket ? `${Math.round(r.hoursLate)}h overdue` : "inside SLA",
        href: `/candidates/${r.candidateId}`,
      })),
      total: filtered.length,
      seeAllHref: "/interviews?window=awaiting_feedback",
      fallback: false,
    };
  }

  if (q.withClient) {
    const pipeline = await loadPipeline();
    const stages = pipeline.ofKind("submitted");
    const { pipelineCards } = await import("@/server/queries/pipeline");
    const cards = (await pipelineCards({}, actor)).filter((c) => stages.includes(c.stage));
    return {
      question,
      interpretation: q.interpretation,
      headline: `${cards.length} candidates sitting with a client`,
      rows: cards.slice(0, 20).map((c) => ({
        id: c.id,
        title: c.candidateName,
        subtitle: `${c.requisitionCode} · ${c.requisitionTitle}`,
        meta: `${c.daysInStage}d in ${pipeline.label(c.stage)}`,
        href: `/candidates/${c.candidateId}`,
      })),
      total: cards.length,
      seeAllHref: `/pipeline?stage=${stages[0] ?? ""}`,
      fallback: false,
    };
  }

  // Everything else is the ordinary candidate list, filtered. Scope, PII
  // redaction and soft-delete all come along because it is the same function
  // the candidates page calls.
  const all = await listCandidates(
    {
      // A named role becomes a title search; a named skill becomes a skill
      // filter. Conflating them finds nobody and says so confidently.
      q: q.titles[0] ?? q.text ?? undefined,
      skill: q.skills[0],
      availability: q.availability ?? undefined,
      minExp: q.minExperience !== null ? String(q.minExperience) : undefined,
      location: q.location ?? undefined,
    },
    actor,
  );

  // Additional named skills are applied here rather than in SQL, because the
  // list filter takes one and the question may name three.
  const extra = q.skills.slice(1).map(normaliseName);
  const rows = extra.length
    ? all.filter((c) => {
        const held = new Set(c.skills.map(normaliseName));
        return extra.every((s) => held.has(s));
      })
    : all;

  const params = new URLSearchParams();
  if (q.titles[0] ?? q.text) params.set("q", q.titles[0] ?? q.text);
  if (q.skills[0]) params.set("skill", q.skills[0]);
  if (q.availability) params.set("availability", q.availability);

  return {
    question,
    interpretation: q.interpretation,
    headline: `${rows.length} ${rows.length === 1 ? "candidate" : "candidates"}`,
    rows: rows.slice(0, 20).map((c) => ({
      id: c.id,
      title: `${c.firstName} ${c.lastName}`,
      subtitle: `${c.currentTitle} · ${c.currentCompany} · ${c.location}`,
      meta: `${c.yearsExperience} yrs · ${c.primaryTechnology || c.skills[0] || ""}`,
      href: `/candidates/${c.id}`,
    })),
    total: rows.length,
    seeAllHref: `/candidates${params.size ? `?${params}` : ""}`,
    fallback: q.fallback,
  };
}

/* ------------------------------------------------------------------ *
 * Requirements
 * ------------------------------------------------------------------ */

async function requirementAnswer(
  question: string,
  q: StructuredQuery,
  actor: User,
): Promise<Answer> {
  let rows = await listRequisitions({ status: q.noSubmissions ? "active" : "all", q: q.text || undefined }, actor);

  if (q.code) rows = rows.filter((r) => r.code === q.code);
  if (q.openLongerThan !== null) rows = rows.filter((r) => r.ageDays > q.openLongerThan!);
  if (q.noSubmissions) rows = rows.filter((r) => r.totalCount === 0);
  if (q.skills.length) {
    const wanted = q.skills.map(normaliseName);
    rows = rows.filter((r) => {
      const have = new Set([...r.requiredSkills, ...r.preferredSkills].map(normaliseName));
      return wanted.some((s) => have.has(s));
    });
  }
  if (q.location) {
    const where = normaliseName(q.location);
    rows = rows.filter((r) => normaliseName(r.location).includes(where));
  }

  const headline = q.noSubmissions
    ? `${rows.length} open requirements with nothing submitted`
    : q.openLongerThan !== null
      ? `${rows.length} requirements open more than ${q.openLongerThan} days`
      : `${rows.length} ${rows.length === 1 ? "requirement" : "requirements"}`;

  return {
    question,
    interpretation: q.interpretation,
    headline,
    rows: rows.slice(0, 20).map((r) => ({
      id: r.id,
      title: `${r.code} — ${r.title}`,
      subtitle: `${r.clientName} · ${r.location}`,
      meta: `${r.ageDays}d open · ${r.activeCount} in play`,
      href: `/requisitions/${r.id}`,
    })),
    total: rows.length,
    seeAllHref: "/requisitions?status=active",
    fallback: q.fallback,
  };
}

/* ------------------------------------------------------------------ *
 * Interviews
 * ------------------------------------------------------------------ */

async function interviewAnswer(
  question: string,
  q: StructuredQuery,
  actor: User,
): Promise<Answer> {
  const window = q.awaitingFeedback
    ? "awaiting_feedback"
    : q.interviewedThisWeek
      ? "past"
      : "upcoming";
  let rows = await listInterviews({ window }, actor);

  if (q.interviewedThisWeek) {
    rows = rows.filter((r) => Date.now() - r.scheduledAt.getTime() < 7 * 86_400_000);
  }

  return {
    question,
    interpretation: q.interpretation,
    headline: `${rows.length} ${rows.length === 1 ? "interview" : "interviews"}`,
    rows: rows.slice(0, 20).map((r) => ({
      id: r.id,
      title: `${r.candidateName} — ${r.title}`,
      subtitle: `${r.requisitionCode} · ${r.requisitionTitle}`,
      meta: r.scheduledAt.toLocaleDateString(),
      href: `/interviews?focus=${r.id}`,
    })),
    total: rows.length,
    seeAllHref: `/interviews?window=${window}`,
    fallback: q.fallback,
  };
}

/* ------------------------------------------------------------------ *
 * Recruiters
 * ------------------------------------------------------------------ */

async function recruiterAnswer(question: string, q: StructuredQuery): Promise<Answer> {
  const stats = await recruiterPerformance();

  const ranked = [...stats].sort((a, b) => {
    if (q.rankBy === "hires") return b.hires - a.hires;
    if (q.rankBy === "submissions") return b.submitted - a.submitted;
    // Interview-to-selection: what share of interviewed candidates reached an
    // offer. Desks with almost no interviews are excluded rather than topping
    // the list on a single lucky conversion.
    const ratio = (s: (typeof stats)[number]) =>
      s.interviewed >= 3 ? s.offers / s.interviewed : -1;
    return ratio(b) - ratio(a);
  });

  return {
    question,
    interpretation: q.interpretation,
    headline:
      q.rankBy === "interview_to_selection"
        ? "Recruiters by interview-to-selection rate"
        : q.rankBy === "hires"
          ? "Recruiters by hires"
          : "Recruiters",
    rows: ranked.slice(0, 15).map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: r.title,
      meta:
        q.rankBy === "interview_to_selection"
          ? r.interviewed >= 3
            ? `${Math.round((r.offers / r.interviewed) * 100)}% · ${r.interviewed} interviewed`
            : `too few interviews to rank (${r.interviewed})`
          : `${r.hires} hires · ${r.submitted} submitted`,
      href: `/team/${r.id}`,
    })),
    total: ranked.length,
    seeAllHref: "/team",
    fallback: q.fallback,
  };
}

/* ------------------------------------------------------------------ *
 * Clients
 * ------------------------------------------------------------------ */

async function clientAnswer(question: string, q: StructuredQuery, actor: User): Promise<Answer> {
  const reqs = await listRequisitions({ status: "all" }, actor);
  const byClient = new Map<string, { id: string; name: string; open: number; active: number }>();
  for (const r of reqs) {
    const entry = byClient.get(r.clientId) ?? {
      id: r.clientId,
      name: r.clientName,
      open: 0,
      active: 0,
    };
    if (["open", "on_hold", "draft"].includes(r.status)) entry.open += 1;
    entry.active += r.activeCount;
    byClient.set(r.clientId, entry);
  }

  const rows = [...byClient.values()].sort((a, b) => b.open - a.open);
  return {
    question,
    interpretation: q.interpretation,
    headline: `${rows.length} clients`,
    rows: rows.slice(0, 20).map((c) => ({
      id: c.id,
      title: c.name,
      subtitle: `${c.open} open requirements`,
      meta: `${c.active} candidates in play`,
      href: `/clients/${c.id}`,
    })),
    total: rows.length,
    seeAllHref: "/clients",
    fallback: q.fallback,
  };
}

function empty(question: string, q: StructuredQuery, headline: string): Answer {
  return {
    question,
    interpretation: q.interpretation,
    headline,
    rows: [],
    total: 0,
    seeAllHref: null,
    fallback: q.fallback,
  };
}

/**
 * The vocabulary the parser matches against: the organisation's own skills and
 * its own job titles, kept apart because they are filtered differently.
 */
export async function assistantVocabulary(): Promise<Vocabulary> {
  const rows = await db
    .select({ skill: sql<string>`s.skill`, n: sql<number>`count(*)::int` })
    .from(
      sql`${candidates}, jsonb_array_elements_text(${candidates.skills}) as s(skill)`,
    )
    .groupBy(sql`s.skill`)
    .orderBy(sql`count(*) desc`);

  const reqSkills = await db
    .select({ skill: sql<string>`s.skill` })
    .from(
      sql`${requisitions}, jsonb_array_elements_text(${requisitions.requiredSkills}) as s(skill)`,
    )
    .groupBy(sql`s.skill`);

  const titles = await db
    .selectDistinct({ title: candidates.currentTitle })
    .from(candidates)
    .where(isNull(candidates.deletedAt))
    .limit(200);

  const reqTitles = await db
    .selectDistinct({ title: requisitions.title })
    .from(requisitions)
    .where(isNull(requisitions.deletedAt));

  return {
    skills: [...new Set([...rows.map((r) => r.skill), ...reqSkills.map((r) => r.skill)])],
    titles: [...new Set([...titles.map((t) => t.title), ...reqTitles.map((t) => t.title)])],
  };
}
