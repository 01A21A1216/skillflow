import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Attachment storage.
 *
 * §22 says not to hard-code the architecture around one external provider, so
 * the application only ever sees this interface. The default implementation
 * writes to a directory outside the web root; swapping in S3, GCS or Azure Blob
 * means writing one more object with these four methods and changing the
 * factory at the bottom — no caller changes.
 *
 * Nothing here serves a file. Bytes reach a browser only through a route that
 * has already checked the viewer may see the record the file hangs off (§23),
 * which is why there is no "public URL" method to be tempted by.
 */
export interface AttachmentStore {
  /** Returns the opaque key the row should remember. */
  put(input: { filename: string; contentType: string; bytes: Buffer }): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** A stable digest, so the same file uploaded twice can be recognised. */
  digest(bytes: Buffer): string;
}

/** What may be attached. Anything else is refused before it reaches a store. */
export const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export class AttachmentRejected extends Error {}

/**
 * Validate before storing. The extension is taken from the declared content
 * type rather than the supplied filename: a browser will happily send
 * `resume.pdf.exe`, and nothing downstream should have to parse that.
 */
export function checkUpload(file: { name: string; type: string; size: number }) {
  if (!ALLOWED_ATTACHMENT_TYPES[file.type]) {
    throw new AttachmentRejected(
      `${file.type || "That file type"} is not accepted. Use a PDF, Word document, text file or image.`,
    );
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRejected(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB.`,
    );
  }
  if (file.size === 0) throw new AttachmentRejected("That file is empty.");
}

/**
 * Local-disk store, for development and single-node deployments.
 *
 * Keys are random, not derived from the filename, so one candidate's upload
 * can never be reached by guessing another's name.
 */
class LocalAttachmentStore implements AttachmentStore {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    // Keys are generated here and never come from a user, but a traversal in a
    // storage key would be catastrophic, so the join is checked rather than
    // trusted.
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error("Refusing a storage key that escapes the store root.");
    }
    return full;
  }

  async put({ contentType, bytes }: { filename: string; contentType: string; bytes: Buffer }) {
    const ext = ALLOWED_ATTACHMENT_TYPES[contentType] ?? "bin";
    const key = `${new Date().getUTCFullYear()}/${randomBytes(16).toString("hex")}.${ext}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return key;
  }

  async get(key: string) {
    return readFile(this.resolve(key));
  }

  async delete(key: string) {
    await unlink(this.resolve(key)).catch(() => undefined);
  }

  digest(bytes: Buffer) {
    return createHash("sha256").update(bytes).digest("hex");
  }
}

let store: AttachmentStore | null = null;

/**
 * The one place a provider is chosen. `ATTACHMENT_STORE=s3` would branch here
 * once an S3 implementation exists; every caller keeps using the interface.
 */
export function attachmentStore(): AttachmentStore {
  if (!store) {
    store = new LocalAttachmentStore(
      process.env.ATTACHMENT_ROOT ?? path.join(process.cwd(), "storage", "attachments"),
    );
  }
  return store;
}
