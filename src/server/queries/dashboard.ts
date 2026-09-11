import "server-only";

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { activities, offers, requisitions, submissions, users } from "@/db/schema";
import { ACTIVE_STAGES, STAGE_SLA_DAYS, type Stage } from "@/lib/domain";
import { daysBetween, pct } from "@/lib/utils";
import { funnel, monthlyTrend, timeToHire } from "./analytics";
import { awaitingFeedback, listInterviews } from "./interviews";
import { listOffers } from "./offers";
import { pipelineCards } from "./pipeline";
import { listRequisitions, requisitionHealth, type RequisitionRow } from "./requisitions";

const DAY = 86_400_000;

export interface Kpi {
  key: string;
  label: string;
  value: string;
  raw: number;
  delta?: number;
  deltaLabel?: string;
  hint: string;
  tone: "emerald" | "amber" | "rose" | "indigo" | "blue" | "violet";
  href?: string;
}

function quarterStart(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}

export function dashboardSnapshot() {
  const reqs = listRequisitions();
  const openReqs = reqs.filter((r) => ["open", "on_hold", "draft"].includes(r.status));
  const cards = pipelineCards();

  const now = Date.now();
  const weekAhead = new Date(now + 7 * DAY);

  const upcoming = listInterviews({ window: "upcoming" });
  const thisWeek = upcoming.filter((i) => i.scheduledAt <= weekAhead);

  const allOffers = listOffers();
  const openOffers = allOffers.filter((o) => o.isOpen);
  const extendedOffers = allOffers.filter((o) => o.status === "extended");

  const qStart = quarterStart();
  const hiresQtd = db
    .select({ count: sql<number>`count(*)` })
    .from(submissions)
    .where(and(eq(submissions.status, "hired"), gte(submissions.stageSince, qStart)))
    .get()!.count;

  const hires30 = db
    .select({ count: sql<number>`count(*)` })
    .from(submissions)
    .where(and(eq(submissions.status, "hired"), gte(submissions.stageSince, new Date(now - 30 * DAY))))
    .get()!.count;

  const hiresPrev30 = db
    .select({ count: sql<number>`count(*)` })
    .from(submissions)
    .where(
      and(
        eq(submissions.status, "hired"),
        gte(submissions.stageSince, new Date(now - 60 * DAY)),
        sql`${submissions.stageSince} < ${now - 30 * DAY}`,
      ),
    )
    .get()!.count;

  const ttf = timeToHire();
  const responded = allOffers.filter((o) => ["accepted", "declined"].includes(o.status));
  const acceptance = responded.length
    ? pct(responded.filter((o) => o.status === "accepted").length, responded.length)
    : 0;

  const agingCards = cards.filter((c) => c.isAging);
  const openings = openReqs.reduce((s, r) => s + (r.openings - r.filled), 0);

  const kpis: Kpi[] = [
    {
      key: "reqs",
      label: "Open requisitions",
      value: String(openReqs.length),
      raw: openReqs.length,
      hint: `${openings} seat${openings === 1 ? "" : "s"} still to fill`,
      tone: "indigo",
      href: "/requisitions?status=active",
    },
    {
      key: "pipeline",
      label: "Active pipeline",
      value: String(cards.length),
      raw: cards.length,
      hint: `${agingCards.length} past the stage SLA`,
      tone: agingCards.length > cards.length * 0.3 ? "amber" : "blue",
      href: "/pipeline",
    },
    {
      key: "interviews",
      label: "Interviews this week",
      value: String(thisWeek.length),
      raw: thisWeek.length,
      hint: `${upcoming.length} scheduled in total`,
      tone: "violet",
      href: "/interviews?window=week",
    },
    {
      key: "offers",
      label: "Offers outstanding",
      value: String(extendedOffers.length),
      raw: extendedOffers.length,
      hint: `${openOffers.length} in flight including drafts`,
      tone: "amber",
      href: "/offers?status=open",
    },
    {
      key: "hires",
      label: "Hires this quarter",
      value: String(hiresQtd),
      raw: hiresQtd,
      // A percentage swing off a base of one or two is noise, not a signal.
      delta: hiresPrev30 >= 3 ? ((hires30 - hiresPrev30) / hiresPrev30) * 100 : undefined,
      deltaLabel: "vs prior 30 days",
      hint: `${hires30} in the last 30 days`,
      tone: "emerald",
      href: "/analytics",
    },
    {
      key: "ttf",
      label: "Median time to fill",
      value: `${Math.round(ttf.medianTimeToFill)}d`,
      raw: ttf.medianTimeToFill,
      hint: `Mean ${Math.round(ttf.avgTimeToFill)} days across ${ttf.timeToFillDays.length} hires`,
      tone: ttf.medianTimeToFill > 60 ? "amber" : "blue",
      href: "/analytics",
    },
    {
      key: "acceptance",
      label: "Offer acceptance",
      value: `${Math.round(acceptance)}%`,
      raw: acceptance,
      hint: `${responded.filter((o) => o.status === "accepted").length} of ${responded.length} answered offers`,
      tone: acceptance >= 75 ? "emerald" : acceptance >= 60 ? "amber" : "rose",
      href: "/offers",
    },
    {
      key: "attention",
      label: "Requisitions at risk",
      value: String(openReqs.filter((r) => ["at_risk", "stalled"].includes(requisitionHealth(r).key)).length),
      raw: openReqs.filter((r) => ["at_risk", "stalled"].includes(requisitionHealth(r).key)).length,
      hint: "Stalled or past target with no loop",
      tone: "rose",
      href: "/requisitions?health=at_risk",
    },
  ];

  return {
    kpis,
    reqs,
    openReqs,
    cards,
    upcoming,
    thisWeek,
    offers: allOffers,
    openOffers,
    funnel: funnel(new Date(now - 180 * DAY)),
    trend: monthlyTrend(12),
    stageTotals: stageTotals(cards),
  };
}

function stageTotals(cards: ReturnType<typeof pipelineCards>) {
  const totals = new Map<Stage, { count: number; aging: number }>();
  for (const stage of ACTIVE_STAGES) totals.set(stage, { count: 0, aging: 0 });
  for (const c of cards) {
    const entry = totals.get(c.stage);
    if (!entry) continue;
    entry.count += 1;
    if (c.isAging) entry.aging += 1;
  }
  return [...totals.entries()].map(([stage, v]) => ({ stage, ...v, sla: STAGE_SLA_DAYS[stage] }));
}

/* ------------------------------------------------------------------ *
 * The action queue — what a recruiter should actually do next
 * ------------------------------------------------------------------ */

export interface ActionItem {
  id: string;
  kind: "feedback" | "aging" | "offer_expiring" | "req_stalled" | "interview_today" | "no_pipeline";
  title: string;
  detail: string;
  href: string;
  tone: "rose" | "amber" | "blue" | "violet";
  urgency: number;
  meta?: string;
}

/** Feedback older than this is historical debt, not something to chase today. */
const FEEDBACK_CHASE_WINDOW_DAYS = 21;

export function actionQueue(limit = 12): ActionItem[] {
  const items: ActionItem[] = [];
  const now = Date.now();

  for (const iv of awaitingFeedback()) {
    const overdueDays = daysBetween(iv.scheduledAt);
    if (overdueDays < 1 || overdueDays > FEEDBACK_CHASE_WINDOW_DAYS) continue;
    const missing = iv.panelSize - iv.feedbackCount;
    items.push({
      id: `fb-${iv.id}`,
      kind: "feedback",
      title: `${missing} feedback form${missing === 1 ? "" : "s"} outstanding`,
      detail: `${iv.title} with ${iv.candidateName} — ${iv.requisitionTitle}`,
      href: `/interviews?window=awaiting_feedback&focus=${iv.id}`,
      tone: overdueDays > 4 ? "rose" : "amber",
      urgency: 100 + overdueDays * 2,
      meta: `${overdueDays}d overdue`,
    });
  }

  for (const o of listOffers({ status: "open" })) {
    if (o.daysToExpiry === null || o.daysToExpiry > 5) continue;
    items.push({
      id: `off-${o.id}`,
      kind: "offer_expiring",
      title: o.daysToExpiry < 0 ? "Offer expired without a response" : "Offer expires soon",
      detail: `${o.candidateName} — ${o.requisitionTitle}`,
      href: `/offers?focus=${o.id}`,
      tone: o.daysToExpiry <= 1 ? "rose" : "amber",
      urgency: 130 - o.daysToExpiry * 5,
      meta: o.daysToExpiry < 0 ? `${Math.abs(o.daysToExpiry)}d ago` : `${o.daysToExpiry}d left`,
    });
  }

  const cards = pipelineCards();
  for (const c of cards) {
    if (!c.isAging || c.daysInStage < c.slaDays * 2) continue;
    items.push({
      id: `age-${c.id}`,
      kind: "aging",
      title: `Stalled in ${c.stage} for ${c.daysInStage} days`,
      detail: `${c.candidateName} — ${c.requisitionTitle}`,
      href: `/pipeline?focus=${c.id}`,
      tone: c.daysInStage > c.slaDays * 3 ? "rose" : "amber",
      urgency: 60 + c.daysInStage,
      meta: `SLA ${c.slaDays}d`,
    });
  }

  for (const r of listRequisitions({ status: "active" })) {
    const health = requisitionHealth(r);
    if (health.key !== "stalled" && health.key !== "at_risk") continue;
    items.push({
      id: `req-${r.id}`,
      kind: r.activeCount === 0 ? "no_pipeline" : "req_stalled",
      title: health.label === "Stalled" ? "Requisition has no active pipeline" : "Requisition is at risk",
      // The reason belongs on the wider detail line; the meta column is narrow
      // and a long sentence there squeezes the title into an ellipsis.
      detail: `${r.code} — ${r.title} · ${health.reason}`,
      href: `/requisitions/${r.id}`,
      tone: "rose",
      urgency: 90 + r.ageDays / 4,
      meta: `${r.ageDays}d open`,
    });
  }

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  for (const iv of listInterviews({ window: "today" })) {
    if (iv.status !== "scheduled" || iv.scheduledAt.getTime() < now) continue;
    items.push({
      id: `iv-${iv.id}`,
      kind: "interview_today",
      title: `${iv.title} today`,
      detail: `${iv.candidateName} — ${iv.requisitionTitle}`,
      href: `/interviews?window=today&focus=${iv.id}`,
      tone: "violet",
      urgency: 150,
      meta: iv.scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    });
  }

  // A queue of ten identical rows is useless. Interleave by kind so the top of
  // the list stays a genuine cross-section of what needs doing.
  const byKind = new Map<ActionItem["kind"], ActionItem[]>();
  for (const item of items.sort((a, b) => b.urgency - a.urgency)) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }

  const queues = [...byKind.values()];
  const out: ActionItem[] = [];
  let round = 0;
  while (out.length < limit && queues.some((q) => q.length > round)) {
    const slice = queues
      .map((q) => q[round])
      .filter((i): i is ActionItem => Boolean(i))
      .sort((a, b) => b.urgency - a.urgency);
    for (const item of slice) {
      if (out.length >= limit) break;
      out.push(item);
    }
    round += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Activity feed
 * ------------------------------------------------------------------ */

export function recentActivity(limit = 25, entity?: { type: string; id: string }) {
  return db
    .select({ activity: activities, actor: users })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(
      entity
        ? and(eq(activities.entityType, entity.type), eq(activities.entityId, entity.id))
        : undefined,
    )
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .all();
}

/** Activity for a requisition, including everything on its submissions. */
export function requisitionActivity(requisitionId: string, limit = 40) {
  const submissionIds = db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.requisitionId, requisitionId))
    .all()
    .map((r) => r.id);

  const ids = [requisitionId, ...submissionIds];

  return db
    .select({ activity: activities, actor: users })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(inArray(activities.entityId, ids))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .all();
}

export function candidateActivity(candidateId: string, limit = 40) {
  const submissionIds = db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.candidateId, candidateId))
    .all()
    .map((r) => r.id);

  return db
    .select({ activity: activities, actor: users })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(inArray(activities.entityId, [candidateId, ...submissionIds]))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .all();
}

/** Requisitions ranked by how much they need a human today. */
export function attentionList(limit = 6): (RequisitionRow & { health: ReturnType<typeof requisitionHealth> })[] {
  return listRequisitions({ status: "active" })
    .map((r) => ({ ...r, health: requisitionHealth(r) }))
    .filter((r) => r.health.key !== "healthy")
    .sort((a, b) => {
      const rank = { stalled: 0, at_risk: 1, watch: 2, healthy: 3, closed: 4 };
      return rank[a.health.key] - rank[b.health.key] || b.ageDays - a.ageDays;
    })
    .slice(0, limit);
}

export function globalSearch(term: string) {
  if (!term.trim()) return { requisitions: [], candidates: [] };
  const reqs = listRequisitions({ q: term }).slice(0, 6);
  return { requisitions: reqs };
}

export function teamRoster() {
  return db.select().from(users).orderBy(users.name).all();
}

export function openRequisitionCount() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(requisitions)
    .where(inArray(requisitions.status, ["open", "on_hold", "draft"]))
    .get()!.count;
}

export function activePipelineCount() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(submissions)
    .where(and(eq(submissions.status, "active"), inArray(submissions.stage, ACTIVE_STAGES as unknown as string[])))
    .get()!.count;
}

export function openOfferCount() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(offers)
    .where(inArray(offers.status, ["draft", "pending_approval", "approved", "extended"]))
    .get()!.count;
}
