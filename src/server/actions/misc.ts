"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { notes, users } from "@/db/schema";
import { noteSchema } from "@/lib/validation";
import { currentUser, setCurrentUser } from "@/server/session";
import { fail, logActivity, newId, parseForm, succeed, type ActionState } from "./shared";

export async function addNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(noteSchema, formData);
  if (!parsed.success) return parsed.state;
  const { entityType, entityId, body, pinned } = parsed.data;

  const actor = await currentUser();
  const id = newId("not");

  db.insert(notes)
    .values({
      id,
      entityType,
      entityId,
      authorId: actor.id,
      body,
      pinned,
      createdAt: new Date(),
    })
    .run();

  logActivity({
    entityType,
    entityId,
    type: "note_added",
    actorId: actor.id,
    summary: `${actor.name} added a note`,
  });

  if (entityType === "requisition") revalidatePath(`/requisitions/${entityId}`);
  if (entityType === "candidate") revalidatePath(`/candidates/${entityId}`);
  revalidatePath("/pipeline");
  return succeed("Note added", id);
}

export async function togglePinNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const noteId = String(formData.get("noteId") ?? "");
  const note = db.select().from(notes).where(eq(notes.id, noteId)).get();
  if (!note) return fail("That note no longer exists.");

  db.update(notes).set({ pinned: !note.pinned }).where(eq(notes.id, noteId)).run();

  if (note.entityType === "requisition") revalidatePath(`/requisitions/${note.entityId}`);
  if (note.entityType === "candidate") revalidatePath(`/candidates/${note.entityId}`);
  return succeed(note.pinned ? "Note unpinned" : "Note pinned");
}

export async function switchActor(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const person = db.select().from(users).where(eq(users.id, userId)).get();
  if (!person) return;

  await setCurrentUser(person.id);
  revalidatePath("/", "layout");
}
