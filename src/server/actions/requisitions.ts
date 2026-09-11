"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { clients, requisitionAssignees, requisitions, users } from "@/db/schema";
import type { User } from "@/db/schema";
import { REQ_STATUS, type ReqStatus } from "@/lib/domain";
import { requisitionSchema, requisitionStatusSchema } from "@/lib/validation";
import { canTouchRequisition } from "@/server/authz";
import { checkVersion, describeChanges, diffFields, stamp, stampNew } from "@/server/integrity";
import {
  denied,
  fail,
  guarded,
  logActivity,
  newId,
  parseForm,
  succeed,
  type ActionState,
} from "./shared";

async function nextReqCode() {
  const year = new Date().getFullYear();
  const prefix = `REQ-${year}-`;
  const highest = (await db
    .select({ code: requisitions.code })
    .from(requisitions)
    .where(sql`${requisitions.code} like ${`${prefix}%`}`)
    .orderBy(sql`${requisitions.code} desc`)
    )[0];

  const n = highest ? Number(highest.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(3, "0")}`;
}

async function createRequisitionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(requisitionSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;


  const client = (await db.select().from(clients).where(eq(clients.id, input.clientId)))[0];
  if (!client) return fail("That client no longer exists.", { clientId: "Unknown client" });

  const id = newId("req");
  const code = await nextReqCode();
  const today = new Date().toISOString().slice(0, 10);

  (await db.insert(requisitions)
    .values({
      id,
      code,
      title: input.title,
      clientId: input.clientId,
      hiringManagerId: input.hiringManagerId,
      leadRecruiterId: input.leadRecruiterId,
      department: input.department,
      employmentType: input.employmentType,
      workMode: input.workMode,
      location: input.location,
      openings: input.openings,
      filled: 0,
      priority: input.priority,
      status: input.status,
      seniority: input.seniority,
      minSalary: input.minSalary ?? null,
      maxSalary: input.maxSalary ?? null,
      currency: "USD",
      experienceMin: input.experienceMin,
      experienceMax: input.experienceMax,
      requiredSkills: input.requiredSkills,
      preferredSkills: input.preferredSkills,
      visaRequirements: input.visaRequirements,
      description: input.description ?? "",
      requirements: input.requirements,
      openedAt: today,
      targetFillDate: input.targetFillDate ?? null,
      ...stampNew(actor.id),
    })
    );

  (await db.insert(requisitionAssignees)
    .values({
      id: newId("ras"),
      requisitionId: id,
      userId: input.leadRecruiterId,
      role: "lead",
    })
    );

  await logActivity({
    entityType: "requisition",
    entityId: id,
    type: "requisition_created",
    actorId: actor.id,
    summary: `Opened ${code} — ${input.title} for ${client.name}`,
  });

  revalidatePath("/requisitions");
  revalidatePath("/");
  return succeed(`${code} created`, id);
}

async function updateRequisitionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  if (!requisitionId) return fail("Missing requisition.");

  const parsed = parseForm(requisitionSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const existing = (await db.select().from(requisitions).where(eq(requisitions.id, requisitionId)))[0];
  if (!existing) return fail("That requisition no longer exists.");
  if (!await canTouchRequisition(actor, requisitionId)) return denied("that requisition");

  // Throws ConcurrencyError if someone else saved since this form was rendered;
  // `guarded` converts that into a message telling the user to reload.
  const nextVersion = checkVersion("Requisition", existing.rowVersion, formData.get("rowVersion"));

  const changes = diffFields(existing, input, {
    title: "Job title",
    status: "Status",
    priority: "Priority",
    openings: "Openings",
    location: "Location",
    department: "Department",
    employmentType: "Employment type",
    workMode: "Work mode",
    seniority: "Level",
    minSalary: "Salary minimum",
    maxSalary: "Salary maximum",
    targetFillDate: "Target fill date",
    leadRecruiterId: "Lead recruiter",
    hiringManagerId: "Hiring manager",
    requiredSkills: "Must-have skills",
    preferredSkills: "Nice-to-have skills",
    visaRequirements: "Accepted work authorization",
  });

  (await db.update(requisitions)
    .set({
      title: input.title,
      clientId: input.clientId,
      hiringManagerId: input.hiringManagerId,
      leadRecruiterId: input.leadRecruiterId,
      department: input.department,
      employmentType: input.employmentType,
      workMode: input.workMode,
      location: input.location,
      openings: input.openings,
      priority: input.priority,
      status: input.status,
      seniority: input.seniority,
      minSalary: input.minSalary ?? null,
      maxSalary: input.maxSalary ?? null,
      experienceMin: input.experienceMin,
      experienceMax: input.experienceMax,
      requiredSkills: input.requiredSkills,
      preferredSkills: input.preferredSkills,
      visaRequirements: input.visaRequirements,
      description: input.description ?? "",
      requirements: input.requirements,
      targetFillDate: input.targetFillDate ?? null,
      ...stamp(actor.id, nextVersion),
    })
    .where(eq(requisitions.id, requisitionId))
    );

  await logActivity({
    entityType: "requisition",
    entityId: requisitionId,
    type: "requisition_updated",
    actorId: actor.id,
    summary: changes.length
      ? `${existing.code}: ${describeChanges(changes)}`
      : `${existing.code} saved with no changes`,
    changes,
  });

  revalidatePath(`/requisitions/${requisitionId}`);
  revalidatePath("/requisitions");
  return succeed("Requisition updated", requisitionId);
}

async function changeRequisitionStatusImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(requisitionStatusSchema, formData);
  if (!parsed.success) return parsed.state;
  const { requisitionId, status, reason } = parsed.data;

  const existing = (await db.select().from(requisitions).where(eq(requisitions.id, requisitionId)))[0];
  if (!existing) return fail("That requisition no longer exists.");
  if (existing.status === status) return fail(`Already ${REQ_STATUS[status as ReqStatus].label.toLowerCase()}.`);
  if (!await canTouchRequisition(actor, requisitionId)) return denied("that requisition");

  const closing = ["filled", "closed", "cancelled"].includes(status);

  (await db.update(requisitions)
    .set({
      status,
      closedAt: closing ? new Date().toISOString().slice(0, 10) : null,
      ...stamp(actor.id, existing.rowVersion + 1),
    })
    .where(eq(requisitions.id, requisitionId))
    );

  await logActivity({
    entityType: "requisition",
    entityId: requisitionId,
    type: "requisition_status",
    actorId: actor.id,
    summary: `${existing.code} moved to ${REQ_STATUS[status as ReqStatus].label}${reason ? ` — ${reason}` : ""}`,
    changes: [
      { field: "status", label: "Status", from: existing.status, to: status },
    ],
    meta: { from: existing.status, to: status, reason: reason ?? null },
  });

  revalidatePath(`/requisitions/${requisitionId}`);
  revalidatePath("/requisitions");
  revalidatePath("/");
  return succeed(`Moved to ${REQ_STATUS[status as ReqStatus].label}`);
}

async function assignToRequisitionImpl(actor: User, formData: FormData): Promise<ActionState> {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "support");
  if (!requisitionId || !userId) return fail("Pick someone to add.");

  if (!await canTouchRequisition(actor, requisitionId)) return denied("that requisition");

  const person = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!person) return fail("That person no longer exists.");

  const already = (await db
    .select()
    .from(requisitionAssignees)
    .where(eq(requisitionAssignees.requisitionId, requisitionId))
    )
    .some((a) => a.userId === userId);

  if (already) return fail(`${person.name} is already on this requisition.`);

  (await db.insert(requisitionAssignees)
    .values({ id: newId("ras"), requisitionId, userId, role })
    );

  await logActivity({
    entityType: "requisition",
    entityId: requisitionId,
    type: "requisition_updated",
    actorId: actor.id,
    summary: `${person.name} added to the requisition team`,
  });

  revalidatePath(`/requisitions/${requisitionId}`);
  return succeed(`${person.name} added`);
}


/* ---- Guarded exports -------------------------------------------- *
 * Each mutation is only reachable through its permission check.
 * ------------------------------------------------------------------ */

export const createRequisition = guarded("requisition.create", createRequisitionImpl);
export const updateRequisition = guarded("requisition.edit", updateRequisitionImpl);
export const changeRequisitionStatus = guarded("requisition.status", changeRequisitionStatusImpl);
export const assignToRequisition = guarded("requisition.assign", assignToRequisitionImpl);
