import "server-only";

import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidates,
  clients,
  feedback,
  interviewPanel,
  interviews,
  permissions,
  requisitions,
  rolePermissions,
  roles,
  submissions,
  users,
} from "@/db/schema";
import { average, pct } from "@/lib/utils";
import { recruiterPerformance } from "./analytics";

export async function listUsers() {
  return (await db.select().from(users).orderBy(asc(users.name)));
}

export async function recruiterOptions() {
  return (await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(inArray(users.role, ["recruiter", "recruitment_manager", "super_admin", "sourcer"]))
    .orderBy(asc(users.name))
    );
}

export async function hiringManagerOptions() {
  return (await db
    .select({ id: users.id, name: users.name, department: users.department })
    .from(users)
    .where(eq(users.role, "hiring_manager"))
    .orderBy(asc(users.name))
    );
}

export async function clientOptions() {
  return (await db
    .select({ id: clients.id, name: clients.name, tier: clients.tier })
    .from(clients)
    .orderBy(asc(clients.name))
    );
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string;
  department: string;
  phone: string | null;
  timezone: string;
  capacity: number;
  joinedAt: string;
  openReqs: number;
  activePipeline: number;
  hires: number;
  candidatesOwned: number;
  interviewsRun: number;
  feedbackOwed: number;
  avgRatingGiven: number | null;
  offerAcceptance: number;
  load: number;
}

export async function teamOverview(): Promise<TeamMember[]> {
  const people = await listUsers();
  const perf = new Map((await recruiterPerformance()).map((p) => [p.id, p]));

  const owned = new Map(
    (await db
      .select({ ownerId: candidates.ownerId, count: sql<number>`count(*)::int` })
      .from(candidates)
      .groupBy(candidates.ownerId)
      )
      .map((r) => [r.ownerId, r.count]),
  );

  const panelRows = (await db
    .select({
      userId: interviewPanel.userId,
      status: interviews.status,
      interviewId: interviews.id,
    })
    .from(interviewPanel)
    .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
    );

  const submittedKeys = new Set(
    (await db
      .select({ key: sql<string>`${feedback.interviewId} || ':' || ${feedback.interviewerId}` })
      .from(feedback)
      )
      .map((r) => r.key),
  );

  const interviewsRun = new Map<string, number>();
  const feedbackOwed = new Map<string, number>();
  for (const r of panelRows) {
    if (r.status === "completed") {
      interviewsRun.set(r.userId, (interviewsRun.get(r.userId) ?? 0) + 1);
      if (!submittedKeys.has(`${r.interviewId}:${r.userId}`)) {
        feedbackOwed.set(r.userId, (feedbackOwed.get(r.userId) ?? 0) + 1);
      }
    }
  }

  const ratings = new Map<string, number[]>();
  for (const r of (await db
    .select({ interviewerId: feedback.interviewerId, overall: feedback.overall })
    .from(feedback)
    )) {
    const list = ratings.get(r.interviewerId) ?? [];
    list.push(r.overall);
    ratings.set(r.interviewerId, list);
  }

  const hmReqs = new Map(
    (await db
      .select({ id: requisitions.hiringManagerId, count: sql<number>`count(*)::int` })
      .from(requisitions)
      .where(inArray(requisitions.status, ["open", "on_hold", "draft"]))
      .groupBy(requisitions.hiringManagerId)
      )
      .map((r) => [r.id, r.count]),
  );

  return people.map((u) => {
    const p = perf.get(u.id);
    const given = ratings.get(u.id) ?? [];
    const openReqs = p?.openReqs ?? hmReqs.get(u.id) ?? 0;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      title: u.title,
      department: u.department,
      phone: u.phone,
      timezone: u.timezone,
      capacity: u.capacity,
      joinedAt: u.joinedAt,
      openReqs,
      activePipeline: p?.activePipeline ?? 0,
      hires: p?.hires ?? 0,
      candidatesOwned: owned.get(u.id) ?? 0,
      interviewsRun: interviewsRun.get(u.id) ?? 0,
      feedbackOwed: feedbackOwed.get(u.id) ?? 0,
      avgRatingGiven: given.length ? average(given) : null,
      offerAcceptance: p?.offerAcceptance ?? 0,
      load: u.capacity ? pct(openReqs, u.capacity) : 0,
    };
  });
}

export async function getTeamMember(userId: string) {
  const user = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!user) return null;

  const member = (await teamOverview()).find((m) => m.id === userId)!;

  const reqs = (await db
    .select({ requisition: requisitions, clientName: clients.name })
    .from(requisitions)
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .where(eq(requisitions.leadRecruiterId, userId))
    .orderBy(desc(requisitions.openedAt))
    );

  const managed = (await db
    .select({ requisition: requisitions, clientName: clients.name })
    .from(requisitions)
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .where(eq(requisitions.hiringManagerId, userId))
    .orderBy(desc(requisitions.openedAt))
    );

  const now = Date.now();
  const panelHistory = (await db
    .select({
      interview: interviews,
      candidate: candidates,
      requisition: requisitions,
    })
    .from(interviewPanel)
    .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
    .innerJoin(submissions, eq(submissions.id, interviews.submissionId))
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(interviewPanel.userId, userId))
    .orderBy(desc(interviews.scheduledAt))
    .limit(12)
    )
    .map((row) => ({ ...row, isUpcoming: row.interview.scheduledAt.getTime() > now }));

  return { user, member, requisitions: reqs, managed, interviews: panelHistory };
}

export async function getClient(clientId: string) {
  const client = (await db.select().from(clients).where(eq(clients.id, clientId)))[0];
  if (!client) return null;

  const owner = client.accountOwnerId
    ? (await db.select().from(users).where(eq(users.id, client.accountOwnerId)))[0]
    : null;

  const reqs = (await db
    .select({ requisition: requisitions, recruiter: users })
    .from(requisitions)
    .innerJoin(users, eq(users.id, requisitions.leadRecruiterId))
    .where(eq(requisitions.clientId, clientId))
    .orderBy(desc(requisitions.openedAt))
    );

  return { client, owner, requisitions: reqs };
}

/**
 * The permission matrix as it stands in the database.
 *
 * Read from rows rather than from `src/lib/permissions.ts`, because the rows
 * are what `can()` actually consults at runtime — showing the constant would
 * be showing what the matrix was seeded as, not what it is.
 */
export async function permissionMatrixView() {
  const roleRows = await db.select().from(roles).orderBy(asc(roles.rank));
  const permissionRows = await db.select().from(permissions).orderBy(asc(permissions.category), asc(permissions.label));
  const grants = await db.select().from(rolePermissions);

  return {
    roles: roleRows.map((r) => ({ key: r.key, label: r.label })),
    permissions: permissionRows.map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      category: p.category,
    })),
    granted: new Set(grants.map((g) => `${g.roleKey}|${g.permissionKey}`)),
  };
}
