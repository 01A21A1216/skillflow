"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { candidates } from "@/db/schema";
import { candidateSchema } from "@/lib/validation";
import { currentUser } from "@/server/session";
import { fail, logActivity, newId, parseForm, succeed, type ActionState } from "./shared";

export async function createCandidate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseForm(candidateSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const clash = db.select().from(candidates).where(eq(candidates.email, input.email)).get();
  if (clash) {
    return fail("A candidate with that email already exists.", {
      email: `Already in the system as ${clash.firstName} ${clash.lastName}`,
    });
  }

  const actor = await currentUser();
  const id = newId("cnd");

  db.insert(candidates)
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
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  logActivity({
    entityType: "candidate",
    entityId: id,
    type: "candidate_created",
    actorId: actor.id,
    summary: `Added ${input.firstName} ${input.lastName} to the talent pool`,
  });

  revalidatePath("/candidates");
  return succeed(`${input.firstName} ${input.lastName} added`, id);
}

export async function updateCandidate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const candidateId = String(formData.get("candidateId") ?? "");
  if (!candidateId) return fail("Missing candidate.");

  const parsed = parseForm(candidateSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const existing = db.select().from(candidates).where(eq(candidates.id, candidateId)).get();
  if (!existing) return fail("That candidate no longer exists.");

  const clash = db.select().from(candidates).where(eq(candidates.email, input.email)).get();
  if (clash && clash.id !== candidateId) {
    return fail("Another candidate already uses that email.", { email: "Email already in use" });
  }

  const actor = await currentUser();

  db.update(candidates)
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
      updatedAt: new Date(),
    })
    .where(eq(candidates.id, candidateId))
    .run();

  logActivity({
    entityType: "candidate",
    entityId: candidateId,
    type: "candidate_updated",
    actorId: actor.id,
    summary: `${input.firstName} ${input.lastName} profile updated`,
  });

  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
  return succeed("Candidate updated", candidateId);
}

export async function logContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const candidateId = String(formData.get("candidateId") ?? "");
  const candidate = db.select().from(candidates).where(eq(candidates.id, candidateId)).get();
  if (!candidate) return fail("That candidate no longer exists.");

  const actor = await currentUser();
  db.update(candidates)
    .set({ lastContactedAt: new Date(), updatedAt: new Date() })
    .where(eq(candidates.id, candidateId))
    .run();

  logActivity({
    entityType: "candidate",
    entityId: candidateId,
    type: "candidate_updated",
    actorId: actor.id,
    summary: `${actor.name} logged an outreach touchpoint`,
  });

  revalidatePath(`/candidates/${candidateId}`);
  return succeed("Touchpoint logged");
}
