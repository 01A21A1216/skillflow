import "server-only";

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { candidates, requisitions, submissions } from "@/db/schema";
import type { User } from "@/db/schema";
import { matchCandidate, type MatchResult } from "@/lib/match-score";
import { normaliseName } from "@/lib/matching";
import { redactCandidate } from "@/server/authz";

export interface RankedCandidate {
  id: string;
  name: string;
  currentTitle: string;
  currentCompany: string;
  location: string;
  primaryTechnology: string;
  skills: string[];
  availability: string;
  workAuthorization: string;
  yearsExperience: number;
  expectedRate: number | null;
  expectedSalary: number | null;
  rating: number;
  /** Already on this requirement's pipeline — shown, not hidden. */
  alreadySubmitted: boolean;
  match: MatchResult;
}

/**
 * Rank the candidate pool against one requirement (§16).
 *
 * Two things this deliberately does *not* do.
 *
 * It does not hide anybody. A candidate who fails on work authorization is
 * ranked lower and labelled, not removed — §16 is explicit that the tool
 * assists and must not auto-reject, and a recruiter may know the client will
 * make an exception.
 *
 * It does not score the whole table. The pool is narrowed in SQL to people who
 * have at least one of the required skills, or whose primary technology
 * matches, because scoring a hundred thousand candidates to show twenty is
 * both slow and pointless. The narrowing is by skill only — never by location,
 * authorization or availability, which are the attributes it would be
 * discriminatory to silently exclude on.
 */
export async function rankForRequisition(
  requisitionId: string,
  actor: User,
  limit = 25,
): Promise<{ requisition: typeof requisitions.$inferSelect; ranked: RankedCandidate[] } | null> {
  const req = (await db.select().from(requisitions).where(eq(requisitions.id, requisitionId)))[0];
  if (!req || req.deletedAt) return null;

  const wanted = [...req.requiredSkills, ...req.preferredSkills];
  const wantedKeys = wanted.map(normaliseName).filter(Boolean);

  // Any candidate holding one of the skills, matched on the same normalised
  // form the scorer uses so formatting differences do not hide people.
  //
  // The list is expanded into bound parameters rather than passed as a single
  // array: Drizzle binds a JS array as one value, and Postgres will not accept
  // that on the right of `= any(...)`.
  const keyList = sql.join(
    wantedKeys.map((k) => sql`${k}`),
    sql`, `,
  );
  const skillMatch = wantedKeys.length
    ? or(
        sql`exists (
          select 1 from jsonb_array_elements_text(${candidates.skills}) as s(skill)
          where lower(regexp_replace(s.skill, '[^a-zA-Z0-9]', '', 'g')) in (${keyList})
        )`,
        sql`lower(regexp_replace(${candidates.primaryTechnology}, '[^a-zA-Z0-9]', '', 'g')) in (${keyList})`,
      )
    : undefined;

  const pool = await db
    .select()
    .from(candidates)
    .where(
      and(
        isNull(candidates.deletedAt),
        // Somebody marked do-not-contact is not a candidate for anything.
        ne(candidates.status, "do_not_contact"),
        skillMatch,
      ),
    )
    .limit(400);

  const onPipeline = new Set(
    (
      await db
        .select({ candidateId: submissions.candidateId })
        .from(submissions)
        .where(eq(submissions.requisitionId, requisitionId))
    ).map((r) => r.candidateId),
  );

  const profile = {
    requiredSkills: req.requiredSkills,
    preferredSkills: req.preferredSkills,
    location: req.location,
    workMode: req.workMode,
    visaRequirements: req.visaRequirements,
    employmentType: req.employmentType,
    experienceMin: req.experienceMin,
    experienceMax: req.experienceMax,
    minSalary: req.minSalary,
    maxSalary: req.maxSalary,
    billRateMin: req.billRateMin,
    billRateMax: req.billRateMax,
  };

  const ranked = pool
    .map((raw) => {
      // PII redaction applies here exactly as it does everywhere else (§23);
      // a ranking screen is not an exemption.
      const c = redactCandidate(actor, raw);
      return {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        location: c.location,
        primaryTechnology: c.primaryTechnology,
        skills: c.skills,
        availability: c.availability,
        workAuthorization: c.workAuthorization,
        yearsExperience: c.yearsExperience,
        expectedRate: c.expectedRate,
        expectedSalary: c.expectedSalary,
        rating: c.rating,
        alreadySubmitted: onPipeline.has(c.id),
        match: matchCandidate(profile, {
          skills: c.skills,
          primaryTechnology: c.primaryTechnology,
          location: c.location,
          willingToRelocate: c.willingToRelocate,
          workAuthorization: c.workAuthorization,
          availability: c.availability,
          yearsExperience: c.yearsExperience,
          expectedSalary: c.expectedSalary,
          expectedRate: c.expectedRate,
        }),
      } satisfies RankedCandidate;
    })
    .sort((a, b) => {
      // Someone already on the pipeline is not a suggestion, so they sink —
      // but they stay visible, because "we already have them" is useful.
      if (a.alreadySubmitted !== b.alreadySubmitted) return a.alreadySubmitted ? 1 : -1;
      return b.match.score - a.match.score;
    })
    .slice(0, limit);

  return { requisition: req, ranked };
}

/** The reverse view: which open requirements suit one candidate. */
export async function rankForCandidate(candidateId: string, actor: User, limit = 8) {
  const raw = (await db.select().from(candidates).where(eq(candidates.id, candidateId)))[0];
  if (!raw || raw.deletedAt) return [];
  const c = redactCandidate(actor, raw);

  const open = await db
    .select()
    .from(requisitions)
    .where(and(eq(requisitions.status, "open"), isNull(requisitions.deletedAt)));

  const existing = new Set(
    (
      await db
        .select({ requisitionId: submissions.requisitionId })
        .from(submissions)
        .where(eq(submissions.candidateId, candidateId))
    ).map((r) => r.requisitionId),
  );

  return open
    .filter((r) => !existing.has(r.id))
    .map((r) => ({
      requisition: r,
      match: matchCandidate(
        {
          requiredSkills: r.requiredSkills,
          preferredSkills: r.preferredSkills,
          location: r.location,
          workMode: r.workMode,
          visaRequirements: r.visaRequirements,
          employmentType: r.employmentType,
          experienceMin: r.experienceMin,
          experienceMax: r.experienceMax,
          minSalary: r.minSalary,
          maxSalary: r.maxSalary,
          billRateMin: r.billRateMin,
          billRateMax: r.billRateMax,
        },
        {
          skills: c.skills,
          primaryTechnology: c.primaryTechnology,
          location: c.location,
          willingToRelocate: c.willingToRelocate,
          workAuthorization: c.workAuthorization,
          availability: c.availability,
          yearsExperience: c.yearsExperience,
          expectedSalary: c.expectedSalary,
          expectedRate: c.expectedRate,
        },
      ),
    }))
    .filter((r) => r.match.score >= 45)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
}
