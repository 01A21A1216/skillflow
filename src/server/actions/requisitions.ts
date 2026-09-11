"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { clients, requisitionAssignees, requisitions, users } from "@/db/schema";
import { REQ_STATUS, type ReqStatus } from "@/lib/domain";
import { requisitionSchema, requisitionStatusSchema } from "@/lib/validation";
import { currentUser } from "@/server/session";
import { fail, logActivity, newId, parseForm, succeed, type ActionState } from "./shared";

function nextReqCode() {
  const year = new Date().getFullYear();
  const prefix = `REQ-${year}-`;
  const highest = db
    .select({ code: requisitions.code })
    .from(requisitions)
    .where(sql`${requisitions.code} like ${`${prefix}%`}`)
    .orderBy(sql`${requisitions.code} desc`)
    .get();

  const n = highest ? Number(highest.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(3, "0")}`;
}

export async function createRequisition(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseForm(requisitionSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const actor = await currentUser();

  const client = db.select().from(clients).where(eq(clients.id, input.clientId)).get();
  if (!client) return fail("That client no longer exists.", { clientId: "Unknown client" });

  const id = newId("req");
  const code = nextReqCode();
  const today = new Date().toISOString().slice(0, 10);

  db.insert(requisitions)
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
      skills: input.skills,
      description: input.description ?? "",
      requirements: input.requirements,
      openedAt: today,
      targetFillDate: input.targetFillDate ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  db.insert(requisitionAssignees)
    .values({
      id: newId("ras"),
      requisitionId: id,
      userId: input.leadRecruiterId,
      role: "lead",
    })
    .run();

  logActivity({
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

export async function updateRequisition(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  if (!requisitionId) return fail("Missing requisition.");

  const parsed = parseForm(requisitionSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const existing = db.select().from(requisitions).where(eq(requisitions.id, requisitionId)).get();
  if (!existing) return fail("That requisition no longer exists.");

  const actor = await currentUser();

  db.update(requisitions)
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
      skills: input.skills,
      description: input.description ?? "",
      requirements: input.requirements,
      targetFillDate: input.targetFillDate ?? null,
      updatedAt: new Date(),
    })
    .where(eq(requisitions.id, requisitionId))
    .run();

  logActivity({
    entityType: "requisition",
    entityId: requisitionId,
    type: "requisition_updated",
    actorId: actor.id,
    summary: `${existing.code} details updated`,
  });

  revalidatePath(`/requisitions/${requisitionId}`);
  revalidatePath("/requisitions");
  return succeed("Requisition updated", requisitionId);
}

export async function changeRequisitionStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseForm(requisitionStatusSchema, formData);
  if (!parsed.success) return parsed.state;
  const { requisitionId, status, reason } = parsed.data;

  const existing = db.select().from(requisitions).where(eq(requisitions.id, requisitionId)).get();
  if (!existing) return fail("That requisition no longer exists.");
  if (existing.status === status) return fail(`Already ${REQ_STATUS[status as ReqStatus].label.toLowerCase()}.`);

  const actor = await currentUser();
  const closing = ["filled", "closed", "cancelled"].includes(status);

  db.update(requisitions)
    .set({
      status,
      closedAt: closing ? new Date().toISOString().slice(0, 10) : null,
      updatedAt: new Date(),
    })
    .where(eq(requisitions.id, requisitionId))
    .run();

  logActivity({
    entityType: "requisition",
    entityId: requisitionId,
    type: "requisition_status",
    actorId: actor.id,
    summary: `${existing.code} moved to ${REQ_STATUS[status as ReqStatus].label}${reason ? ` — ${reason}` : ""}`,
    meta: { from: existing.status, to: status },
  });

  revalidatePath(`/requisitions/${requisitionId}`);
  revalidatePath("/requisitions");
  revalidatePath("/");
  return succeed(`Moved to ${REQ_STATUS[status as ReqStatus].label}`);
}

export async function assignToRequisition(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requisitionId = String(formData.get("requisitionId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "support");
  if (!requisitionId || !userId) return fail("Pick someone to add.");

  const person = db.select().from(users).where(eq(users.id, userId)).get();
  if (!person) return fail("That person no longer exists.");

  const already = db
    .select()
    .from(requisitionAssignees)
    .where(eq(requisitionAssignees.requisitionId, requisitionId))
    .all()
    .some((a) => a.userId === userId);

  if (already) return fail(`${person.name} is already on this requisition.`);

  db.insert(requisitionAssignees)
    .values({ id: newId("ras"), requisitionId, userId, role })
    .run();

  const actor = await currentUser();
  logActivity({
    entityType: "requisition",
    entityId: requisitionId,
    type: "requisition_updated",
    actorId: actor.id,
    summary: `${person.name} added to the requisition team`,
  });

  revalidatePath(`/requisitions/${requisitionId}`);
  return succeed(`${person.name} added`);
}
