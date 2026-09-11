"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { notes, users } from "@/db/schema";
import { noteSchema } from "@/lib/validation";
import {
  SESSION_COOKIE,
  burnPasswordTime,
  createSession,
  revokeSession,
  verifyPassword,
} from "@/server/auth";
import { currentUser } from "@/server/session";
import { fail, guarded, logActivity, newId, parseForm, succeed, type ActionState } from "./shared";

/* ------------------------------------------------------------------ *
 * Notes
 * ------------------------------------------------------------------ */

export const addNote = guarded("note.create", async (actor, formData) => {
  const parsed = parseForm(noteSchema, formData);
  if (!parsed.success) return parsed.state;
  const { entityType, entityId, body, pinned } = parsed.data;

  const id = newId("not");

  db.insert(notes)
    .values({ id, entityType, entityId, authorId: actor.id, body, pinned, createdAt: new Date() })
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
});

export const togglePinNote = guarded("note.create", async (actor, formData) => {
  const noteId = String(formData.get("noteId") ?? "");
  const note = db.select().from(notes).where(eq(notes.id, noteId)).get();
  if (!note) return fail("That note no longer exists.");
  // Authors pin their own notes; anyone curating the record needs the same
  // permission they would need to write one.
  if (note.authorId !== actor.id && actor.role !== "super_admin" && actor.role !== "recruitment_manager") {
    return fail("You can only pin your own notes.");
  }

  db.update(notes).set({ pinned: !note.pinned }).where(eq(notes.id, noteId)).run();

  if (note.entityType === "requisition") revalidatePath(`/requisitions/${note.entityId}`);
  if (note.entityType === "candidate") revalidatePath(`/candidates/${note.entityId}`);
  return succeed(note.pinned ? "Note unpinned" : "Note pinned");
});

/* ------------------------------------------------------------------ *
 * Sign in / sign out
 * ------------------------------------------------------------------ */

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return fail("Enter your email and password.");
  }

  const user = db.select().from(users).where(eq(users.email, email)).get();

  // Always spend the same time whether or not the account exists, so the form
  // cannot be used to enumerate valid email addresses.
  if (!user || !user.active) {
    await burnPasswordTime(password);
    return fail("Those credentials did not match an active account.");
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return fail("Those credentials did not match an active account.");
  }

  const agent = (await headers()).get("user-agent") ?? undefined;
  const { token, expiresAt } = createSession(user.id, agent);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  logActivity({
    entityType: "user",
    entityId: user.id,
    type: "note_added",
    actorId: user.id,
    summary: `${user.name} signed in`,
  });

  redirect("/");
}

export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const actor = await currentUser();

  revokeSession(token);
  store.delete(SESSION_COOKIE);

  if (actor) {
    logActivity({
      entityType: "user",
      entityId: actor.id,
      type: "note_added",
      actorId: actor.id,
      summary: `${actor.name} signed out`,
    });
  }

  redirect("/login");
}
