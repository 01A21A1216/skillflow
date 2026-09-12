import { eq, inArray, like, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  activities,
  attachments,
  candidates,
  clients,
  communications,
  jobs,
  notes,
  notifications,
  offers,
  requisitions,
  sessions,
  submissions,
  users,
} from "@/db/schema";
import { createSession, SESSION_COOKIE } from "@/server/auth";
import { cookieJar as jar, revalidated as paths } from "./next-stubs";
import { invalidatePermissionMatrix, loadPermissionMatrix } from "@/server/authz";

/**
 * A harness for exercising real server actions against a real database.
 *
 * The unit tests cover the rules; these cover the wiring, which is where the
 * bugs that actually reached the screen have lived. Every one of them was
 * invisible to a pure function: a permission that was checked but not granted,
 * a cascade that ran on one path and not the sibling path, a row version that
 * was incremented in the wrong order. You cannot find those without a session,
 * a database and the action itself.
 *
 * Three things have to be faked, and only three. `cookies()` and
 * `revalidatePath()` exist only inside a Next request; `redirect()` throws by
 * design. Everything else — the session, the permission matrix, the scope
 * predicates, the transactions — is the real thing, because faking any of it
 * would be faking the part under test.
 */

/* ------------------------------------------------------------------ *
 * The Next request context
 * ------------------------------------------------------------------ */

export { cookieJar, revalidated, RedirectError } from "./next-stubs";

/**
 * Sign in as a real user, through `createSession`.
 *
 * Not a stubbed `currentUser`. The token is hashed and stored exactly as it is
 * in production, and every action then resolves it the same way a request
 * would — which is the only way a test can catch a session bug.
 */
export async function signInAs(userId: string) {
  const { token } = await createSession(userId, "integration-test");
  jar.set(SESSION_COOKIE, token);
  invalidatePermissionMatrix();
  await loadPermissionMatrix();
  return token;
}

export function signOut() {
  jar.clear();
}

/** Forget which paths were revalidated, so one test's assertions are its own. */
export function resetRevalidated() {
  paths.length = 0;
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/**
 * Everything this suite creates is prefixed, and everything prefixed is
 * deleted afterwards. Tests therefore run against the real seeded database —
 * with its real permission rows and pipeline stages — without being able to
 * damage it, and without depending on any particular seeded record.
 */
export const TEST_PREFIX = "ittest";

let counter = 0;
export const testId = (kind: string) => `${TEST_PREFIX}_${kind}_${Date.now().toString(36)}_${counter++}`;

export interface Fixture {
  clientId: string;
  requisitionId: string;
  candidateId: string;
}

export async function makeFixture(options: {
  leadRecruiterId: string;
  hiringManagerId: string;
  openings?: number;
}): Promise<Fixture> {
  const clientId = testId("cli");
  const requisitionId = testId("req");
  const candidateId = testId("cnd");
  const now = new Date();

  await db.insert(clients).values({
    id: clientId,
    name: `${TEST_PREFIX} Client`,
    industry: "Technology",
    location: "Austin, TX",
    tier: "standard",
    status: "active",
    slaDays: 30,
  });

  await db.insert(requisitions).values({
    id: requisitionId,
    code: `${TEST_PREFIX.toUpperCase()}-${counter}`,
    title: "Integration Test Engineer",
    clientId,
    hiringManagerId: options.hiringManagerId,
    leadRecruiterId: options.leadRecruiterId,
    department: "Engineering",
    employmentType: "full_time",
    workMode: "remote",
    location: "Austin, TX",
    openings: options.openings ?? 1,
    priority: "high",
    status: "open",
    seniority: "senior",
    minSalary: 120000,
    maxSalary: 160000,
    experienceMin: 5,
    experienceMax: 12,
    requiredSkills: ["Selenium"],
    openedAt: now.toISOString().slice(0, 10),
  });

  await db.insert(candidates).values({
    id: candidateId,
    firstName: "Test",
    lastName: "Candidate",
    email: `${candidateId}@example.invalid`,
    location: "Austin, TX",
    currentTitle: "Test Engineer",
    currentCompany: "Nowhere",
    yearsExperience: 8,
    seniority: "senior",
    skills: ["Selenium"],
    source: "inbound",
    ownerId: options.leadRecruiterId,
    status: "active",
  });

  return { clientId, requisitionId, candidateId };
}

/**
 * Remove everything this suite made.
 *
 * By prefix rather than by remembering ids, so a test that fails half way
 * through still cleans up after itself — the alternative is a database that
 * slowly fills with debris from crashed runs and a suite that starts failing
 * for reasons nobody can reconstruct.
 */
export async function cleanUp() {
  const p = `${TEST_PREFIX}%`;

  const testCandidates = (
    await db.select({ id: candidates.id }).from(candidates).where(like(candidates.id, p))
  ).map((r) => r.id);
  const testReqs = (
    await db.select({ id: requisitions.id }).from(requisitions).where(like(requisitions.id, p))
  ).map((r) => r.id);

  const subs = testCandidates.length
    ? (
        await db
          .select({ id: submissions.id })
          .from(submissions)
          .where(inArray(submissions.candidateId, testCandidates))
      ).map((r) => r.id)
    : [];

  if (subs.length) {
    await db.delete(offers).where(inArray(offers.submissionId, subs));
    await db.delete(notes).where(inArray(notes.entityId, subs));
    await db.delete(activities).where(inArray(activities.entityId, subs));
  }
  if (testCandidates.length) {
    await db.delete(communications).where(inArray(communications.candidateId, testCandidates));
    await db.delete(attachments).where(inArray(attachments.entityId, testCandidates));
    await db.delete(notes).where(inArray(notes.entityId, testCandidates));
    await db.delete(activities).where(inArray(activities.entityId, testCandidates));
    await db.delete(submissions).where(inArray(submissions.candidateId, testCandidates));
    await db.delete(candidates).where(inArray(candidates.id, testCandidates));
  }
  if (testReqs.length) {
    await db.delete(activities).where(inArray(activities.entityId, testReqs));
    await db.delete(requisitions).where(inArray(requisitions.id, testReqs));
  }

  await db.delete(clients).where(like(clients.id, p));
  await db.delete(sessions).where(eq(sessions.userAgent, "integration-test"));
  await db.delete(notifications).where(like(notifications.dedupeKey, `%${TEST_PREFIX}%`));
  await db.delete(jobs).where(like(jobs.dedupeKey, `%${TEST_PREFIX}%`));
}

/* ------------------------------------------------------------------ *
 * Calling an action
 * ------------------------------------------------------------------ */

/** Build the FormData a server action expects. */
export function form(fields: Record<string, string | number | boolean | string[] | undefined>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) fd.append(key, v);
    } else {
      fd.set(key, String(value));
    }
  }
  return fd;
}

/** Find a seeded user by role, so fixtures do not hard-code ids. */
export async function userWithRole(role: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`${users.role} = ${role} and ${users.active} = true`)
    .limit(1);
  if (!row) throw new Error(`No seeded user with role ${role}. Run npm run db:seed.`);
  return row;
}
