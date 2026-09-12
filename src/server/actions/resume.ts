"use server";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { attachments } from "@/db/schema";
import { clampResume, parseResume, type ParsedResume } from "@/lib/resume-parse";
import { assistantVocabulary } from "@/server/queries/assistant";
import { extractText } from "@/server/ai/extract-text";
import { ForbiddenError, loadPermissionMatrix } from "@/server/authz";
import { attachmentStore, checkUpload, AttachmentRejected } from "@/server/storage";
import { actorWithPermission } from "@/server/session";

export interface ResumeParseState {
  ok: boolean;
  message?: string;
  parsed?: ParsedResume;
  /** The text that was read, so a reviewer can see what the parser saw. */
  source?: string;
}

/**
 * Read a resume into candidate fields (§6).
 *
 * Nothing is saved. The result goes to the candidate form for a person to
 * check and submit, for the same reason the JD parser works that way: an
 * extraction error that becomes a record nobody reviewed is worse than
 * retyping.
 *
 * Two inputs are accepted — an uploaded file or pasted text — because the
 * formats resumes actually arrive in do not all yield their text. A scanned
 * PDF is told so plainly rather than producing a blank extraction that looks
 * like a parser fault.
 */
export async function parseResumeAction(
  _prev: ResumeParseState,
  formData: FormData,
): Promise<ResumeParseState> {
  await loadPermissionMatrix();
  try {
    await actorWithPermission("candidate.create");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: "You do not have permission to do that." };
    }
    throw error;
  }

  let text = String(formData.get("text") ?? "").trim();
  const file = formData.get("file");

  if (!text && file instanceof File && file.size > 0) {
    try {
      checkUpload({ name: file.name, type: file.type, size: file.size });
    } catch (error) {
      if (error instanceof AttachmentRejected) return { ok: false, message: error.message };
      throw error;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const extraction = await extractText(file.type, bytes);
    if (extraction.problem) return { ok: false, message: extraction.problem };
    text = extraction.text;
  }

  if (text.length < 60) {
    return { ok: false, message: "That is too short to read as a resume." };
  }

  const vocabulary = await assistantVocabulary();
  const parsed = clampResume(parseResume(text, vocabulary.skills));

  return { ok: true, parsed, source: text.slice(0, 4000) };
}

/** Re-parse a resume already attached to a record. */
export async function parseAttachedResume(attachmentId: string): Promise<ResumeParseState> {
  await loadPermissionMatrix();
  try {
    await actorWithPermission("candidate.edit");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: "You do not have permission to do that." };
    }
    throw error;
  }

  const row = (await db.select().from(attachments).where(eq(attachments.id, attachmentId)))[0];
  if (!row || row.deletedAt) return { ok: false, message: "That file is no longer here." };

  const bytes = await attachmentStore().get(row.storageKey);
  const extraction = await extractText(row.contentType, bytes);
  if (extraction.problem) return { ok: false, message: extraction.problem };

  const vocabulary = await assistantVocabulary();
  return {
    ok: true,
    parsed: clampResume(parseResume(extraction.text, vocabulary.skills)),
    source: extraction.text.slice(0, 4000),
  };
}
