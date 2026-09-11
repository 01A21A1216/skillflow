import "server-only";

import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidates,
  clients,
  feedback,
  interviewPanel,
  interviews,
  requisitions,
  submissions,
  users,
} from "@/db/schema";
import { average, pct } from "@/lib/utils";
import { recruiterPerformance } from "./analytics";

export function listUsers() {
  return db.select().from(users).orderBy(asc(users.name)).all();
}

export function recruiterOptions() {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(inArray(users.role, ["recruiter", "recruitment_manager", "super_admin", "sourcer"]))
    .orderBy(asc(users.name))
    .all();
}

export function hiringManagerOptions() {
  return db
    .select({ id: users.id, name: users.name, department: users.department })
    .from(users)
    .where(eq(users.role, "hiring_manager"))
    .orderBy(asc(users.name))
    .all();
}

export function clientOptions() {
  return db
    .select({ id: clients.id, name: clients.name, tier: clients.tier })
    .from(clients)
    .orderBy(asc(clients.name))
    .all();
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

export function teamOverview(): TeamMember[] {
  const people = listUsers();
  const perf = new Map(recruiterPerformance().map((p) => [p.id, p]));

  const owned = new Map(
    db
      .select({ ownerId: candidates.ownerId, count: sql<number>`count(*)` })
      .from(candidates)
      .groupBy(candidates.ownerId)
      .all()
      .map((r) => [r.ownerId, r.count]),
  );

  const panelRows = db
    .select({
      userId: interviewPanel.userId,
      status: interviews.status,
      interviewId: interviews.id,
    })
    .from(interviewPanel)
    .innerJoin(interviews, eq(interviews.id, interviewPanel.interviewId))
    .all();

  const submittedKeys = new Set(
    db
      .select({ key: sql<string>`${feedback.interviewId} || ':' || ${feedback.interviewerId}` })
      .from(feedback)
      .all()
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
  for (const r of db
    .select({ interviewerId: feedback.interviewerId, overall: feedback.overall })
    .from(feedback)
    .all()) {
    const list = ratings.get(r.interviewerId) ?? [];
    list.push(r.overall);
    ratings.set(r.interviewerId, list);
  }

  const hmReqs = new Map(
    db
      .select({ id: requisitions.hiringManagerId, count: sql<number>`count(*)` })
      .from(requisitions)
      .where(inArray(requisitions.status, ["open", "on_hold", "draft"]))
      .groupBy(requisitions.hiringManagerId)
      .all()
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

export function getTeamMember(userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return null;

  const member = teamOverview().find((m) => m.id === userId)!;

  const reqs = db
    .select({ requisition: requisitions, clientName: clients.name })
    .from(requisitions)
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .where(eq(requisitions.leadRecruiterId, userId))
    .orderBy(desc(requisitions.openedAt))
    .all();

  const managed = db
    .select({ requisition: requisitions, clientName: clients.name })
    .from(requisitions)
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .where(eq(requisitions.hiringManagerId, userId))
    .orderBy(desc(requisitions.openedAt))
    .all();

  const now = Date.now();
  const panelHistory = db
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
    .all()
    .map((row) => ({ ...row, isUpcoming: row.interview.scheduledAt.getTime() > now }));

  return { user, member, requisitions: reqs, managed, interviews: panelHistory };
}

export function getClient(clientId: string) {
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) return null;

  const owner = client.accountOwnerId
    ? db.select().from(users).where(eq(users.id, client.accountOwnerId)).get()
    : null;

  const reqs = db
    .select({ requisition: requisitions, recruiter: users })
    .from(requisitions)
    .innerJoin(users, eq(users.id, requisitions.leadRecruiterId))
    .where(eq(requisitions.clientId, clientId))
    .orderBy(desc(requisitions.openedAt))
    .all();

  return { client, owner, requisitions: reqs };
}
