"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { candidates } from "@/db/schema";
import type { User } from "@/db/schema";
import { candidateSchema } from "@/lib/validation";
import { checkVersion, describeChanges, diffFields, stamp, stampNew } from "@/server/integrity";
import {
  fail,
  guarded,
  logActivity,
  newId,
  parseForm,
  succeed,
  type ActionState,
} from "./shared";

async function createCandidateImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(candidateSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const clash = (await db.select().from(candidates).where(eq(candidates.email, input.email)))[0];
  if (clash) {
    return fail("A candidate with that email already exists.", {
      email: `Already in the system as ${clash.firstName} ${clash.lastName}`,
    });
  }

  const id = newId("cnd");

  (await db.insert(candidates)
    .values({
      id,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? null,
      location: input.location,
      currentTitle: input.currentTitle,
      currentCompany: input.currentCompany,
      yearsExperience: input.yearsExperience,
      seniority: input.seniority,
      skills: input.skills,
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      ownerId: input.ownerId,
      status: input.status,
      expectedSalary: input.expectedSalary ?? null,
      currentSalary: input.currentSalary ?? null,
      currency: "USD",
      noticePeriodDays: input.noticePeriodDays,
      workAuthorization: input.workAuthorization,
      willingToRelocate: input.willingToRelocate,
      linkedinUrl: input.linkedinUrl ?? null,
      summary: input.summary ?? "",
      tags: input.tags,
      rating: input.rating,
      lastContactedAt: new Date(),
      ...stampNew(actor.id),
    })
    );

  await logActivity({
    entityType: "candidate",
    entityId: id,
    type: "candidate_created",
    actorId: actor.id,
    summary: `Added ${input.firstName} ${input.lastName} to the talent pool`,
  });

  revalidatePath("/candidates");
  return succeed(`${input.firstName} ${input.lastName} added`, id);
}

async function updateCandidateImpl(actor: User, formData: FormData): Promise<ActionState> {
  const candidateId = String(formData.get("candidateId") ?? "");
  if (!candidateId) return fail("Missing candidate.");

  const parsed = parseForm(candidateSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const existing = (await db.select().from(candidates).where(eq(candidates.id, candidateId)))[0];
  if (!existing) return fail("That candidate no longer exists.");

  const clash = (await db.select().from(candidates).where(eq(candidates.email, input.email)))[0];
  if (clash && clash.id !== candidateId) {
    return fail("Another candidate already uses that email.", { email: "Email already in use" });
  }


  const nextVersion = checkVersion("Candidate", existing.rowVersion, formData.get("rowVersion"));

  const changes = diffFields(existing, input, {
    firstName: "First name",
    lastName: "Last name",
    email: "Email",
    phone: "Phone",
    location: "Location",
    currentTitle: "Current title",
    currentCompany: "Current company",
    yearsExperience: "Experience",
    seniority: "Level",
    status: "Status",
    source: "Source",
    ownerId: "Owner",
    expectedSalary: "Expected salary",
    noticePeriodDays: "Notice period",
    workAuthorization: "Work authorization",
    rating: "Rating",
    skills: "Skills",
  });

  (await db.update(candidates)
    .set({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? null,
      location: input.location,
      currentTitle: input.currentTitle,
      currentCompany: input.currentCompany,
      yearsExperience: input.yearsExperience,
      seniority: input.seniority,
      skills: input.skills,
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      ownerId: input.ownerId,
      status: input.status,
      expectedSalary: input.expectedSalary ?? null,
      currentSalary: input.currentSalary ?? null,
      noticePeriodDays: input.noticePeriodDays,
      workAuthorization: input.workAuthorization,
      willingToRelocate: input.willingToRelocate,
      linkedinUrl: input.linkedinUrl ?? null,
      summary: input.summary ?? "",
      tags: input.tags,
      rating: input.rating,
      ...stamp(actor.id, nextVersion),
    })
    .where(eq(candidates.id, candidateId))
    );

  await logActivity({
    entityType: "candidate",
    entityId: candidateId,
    type: "candidate_updated",
    actorId: actor.id,
    summary: changes.length
      ? `${input.firstName} ${input.lastName}: ${describeChanges(changes)}`
      : `${input.firstName} ${input.lastName} saved with no changes`,
    changes,
  });

  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  return succeed("Candidate updated", candidateId);
}

async function logContactImpl(actor: User, formData: FormData): Promise<ActionState> {
  const candidateId = String(formData.get("candidateId") ?? "");
  const candidate = (await db.select().from(candidates).where(eq(candidates.id, candidateId)))[0];
  if (!candidate) return fail("That candidate no longer exists.");

  (await db.update(candidates)
    .set({ lastContactedAt: new Date(), updatedAt: new Date() })
    .where(eq(candidates.id, candidateId))
    );

  await logActivity({
    entityType: "candidate",
    entityId: candidateId,
    type: "candidate_updated",
    actorId: actor.id,
    summary: `${actor.name} logged an outreach touchpoint`,
  });

  revalidatePath(`/candidates/${candidateId}`);
  return succeed("Touchpoint logged");
}


/* ---- Guarded exports -------------------------------------------- *
 * Each mutation is only reachable through its permission check.
 * ------------------------------------------------------------------ */

export const createCandidate = guarded("candidate.create", createCandidateImpl);
export const updateCandidate = guarded("candidate.edit", updateCandidateImpl);
export const logContact = guarded("candidate.edit", logContactImpl);
