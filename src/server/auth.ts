import "server-only";

import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/* ------------------------------------------------------------------ *
 * Password hashing
 *
 * scrypt from node:crypto — memory-hard, in the standard library, no
 * dependency to keep patched. Parameters are stored alongside the digest so
 * the cost can be raised later without invalidating existing passwords.
 * ------------------------------------------------------------------ */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, { ...SCRYPT, maxmem: MAXMEM });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, "base64");
  const derived = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  // Constant-time: a length mismatch must not short-circuit before comparing.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * A dummy verification used when the email does not exist, so that a wrong
 * email and a wrong password take the same amount of time. Without it, the
 * login endpoint is a user-enumeration oracle.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "Y2FsaWJyYXRpb24tb25seS1uZXZlci1tYXRjaGVzLWFueS1yZWFsLXBhc3N3b3JkLWhhc2g=";

export async function burnPasswordTime(password: string) {
  await verifyPassword(password, DUMMY_HASH).catch(() => false);
}

/* ------------------------------------------------------------------ *
 * Sessions
 *
 * The cookie holds a random opaque token. The database stores only its
 * SHA-256 hash, so a dump of the sessions table cannot be replayed.
 * ------------------------------------------------------------------ */

export const SESSION_COOKIE = "rcc_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SLIDING_REFRESH_MS = 30 * 60 * 1000; // extend at most every 30 minutes

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

export function createSession(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();

  db.insert(sessions)
    .values({
      id: newId("ses"),
      userId,
      tokenHash: hashToken(token),
      userAgent: userAgent?.slice(0, 300) ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .run();

  db.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId)).run();

  return { token, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) };
}

/** Resolve a raw cookie token to its user, or null. Refreshes the sliding expiry. */
export function resolveSession(token: string | undefined): User | null {
  if (!token) return null;

  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .get();

  if (!row || !row.user.active) return null;

  const now = Date.now();
  if (now - row.session.lastSeenAt.getTime() > SLIDING_REFRESH_MS) {
    db.update(sessions)
      .set({ lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.session.id))
      .run();
  }

  return row.user;
}

export function revokeSession(token: string | undefined) {
  if (!token) return;
  db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)))
    .run();
}

/** Revoke every session for a user — used when a role changes or on demand. */
export function revokeAllSessions(userId: string) {
  db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .run();
}

export function purgeExpiredSessions() {
  db.delete(sessions).where(gt(new Date() as never, sessions.expiresAt)).run();
}
