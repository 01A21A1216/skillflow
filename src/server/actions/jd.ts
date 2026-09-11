"use server";

import { asc, sql } from "drizzle-orm";

import { db } from "@/db";
import { candidates, requisitions } from "@/db/schema";
import { knownAuthorizations } from "@/lib/jd-parse";
import { aiProvider, type ParsedRequirement } from "@/server/ai/provider";
import { actorWithPermission } from "@/server/session";
import { ForbiddenError, loadPermissionMatrix } from "@/server/authz";

export interface JdParseState {
  ok: boolean;
  message?: string;
  parsed?: ParsedRequirement;
  /** Whether the provider that ran sent the text outside. Shown to the user. */
  external?: boolean;
  providerName?: string;
}

/**
 * Parse a pasted job description (§17).
 *
 * The result is *never* written. It comes back to a review form the recruiter
 * edits and submits themselves, which is what §17 asks for and what stops an
 * extraction error becoming a requirement nobody checked.
 */
export async function parseJd(_prev: JdParseState, formData: FormData): Promise<JdParseState> {
  await loadPermissionMatrix();
  try {
    await actorWithPermission("requisition.create");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: "You do not have permission to do that." };
    }
    throw error;
  }

  const text = String(formData.get("text") ?? "").trim();
  if (text.length < 40) {
    return { ok: false, message: "Paste a bit more of the job description." };
  }
  if (text.length > 40_000) {
    return { ok: false, message: "That is too long to parse — paste the role description only." };
  }

  // The vocabulary is the organisation's own skills, taken from the
  // requirements and candidates it already has. Extraction against what this
  // desk actually recruits for beats a general taxonomy every time.
  const vocabulary = await skillVocabulary();

  const provider = await aiProvider();
  const parsed = await provider.parseRequirement(text, vocabulary);

  // Anything categorical is clamped to a known value before it reaches a form.
  // Extracted text is untrusted input, and a select whose value is not in its
  // option list silently posts the wrong thing.
  parsed.workAuthorization.value = knownAuthorizations(parsed.workAuthorization.value);

  return {
    ok: true,
    parsed,
    external: provider.external,
    providerName: provider.name,
  };
}

/** Every skill this organisation already knows about, most common first. */
async function skillVocabulary(): Promise<string[]> {
  const rows = await db
    .select({
      skill: sql<string>`s.skill`,
      n: sql<number>`count(*)::int`,
    })
    .from(sql`${requisitions}, jsonb_array_elements_text(${requisitions.requiredSkills} || ${requisitions.preferredSkills}) as s(skill)`)
    .groupBy(sql`s.skill`)
    .orderBy(sql`count(*) desc`);

  const fromCandidates = await db
    .select({ skill: sql<string>`s.skill` })
    .from(sql`${candidates}, jsonb_array_elements_text(${candidates.skills}) as s(skill)`)
    .groupBy(sql`s.skill`)
    .orderBy(asc(sql`s.skill`));

  return [...new Set([...rows.map((r) => r.skill), ...fromCandidates.map((r) => r.skill)])];
}
