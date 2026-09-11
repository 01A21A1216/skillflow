import "server-only";

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { activities, submissions, users } from "@/db/schema";
import type { User } from "@/db/schema";
import { can, visibleRequisitionIds } from "@/server/authz";
import type { Stage } from "@/lib/domain";
import { loadPipeline } from "@/server/pipeline";
import { daysBetween, pct } from "@/lib/utils";
import { funnel, monthlyTrend, timeToHire } from "./analytics";
import { awaitingFeedback, listInterviews } from "./interviews";
import { listOffers } from "./offers";
import { pipelineCards, type PipelineCard } from "./pipeline";
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

export async function dashboardSnapshot(actor?: User) {
  const reqs = await listRequisitions({}, actor);
  const openReqs = reqs.filter((r) => ["open", "on_hold", "draft"].includes(r.status));
  const cards = await pipelineCards({}, actor);

  const now = Date.now();
  const weekAhead = new Date(now + 7 * DAY);

  const upcoming = await listInterviews({ window: "upcoming" }, actor);
  const thisWeek = upcoming.filter((i) => i.scheduledAt <= weekAhead);

  const allOffers = await listOffers({}, actor);
  const openOffers = allOffers.filter((o) => o.isOpen);
  const extendedOffers = allOffers.filter((o) => o.status === "extended");

  const qStart = quarterStart();
  const hiresQtd = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .where(and(eq(submissions.status, "hired"), gte(submissions.stageSince, qStart)))
    )[0]!.count;

  const hires30 = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .where(and(eq(submissions.status, "hired"), gte(submissions.stageSince, new Date(now - 30 * DAY))))
    )[0]!.count;

  const hiresPrev30 = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .where(
      and(
        eq(submissions.status, "hired"),
        gte(submissions.stageSince, new Date(now - 60 * DAY)),
        lt(submissions.stageSince, new Date(now - 30 * DAY)),
      ),
    )
    )[0]!.count;

  const reporting = actor ? can(actor, "report.view") : true;
  const ttf = await timeToHire();
  const responded = allOffers.filter((o) => ["accepted", "declined"].includes(o.status));
  const acceptance = responded.length
    ? pct(responded.filter((o) => o.status === "accepted").length, responded.length)
    : 0;

  const agingCards = cards.filter((c) => c.isAging);
  const openings = openReqs.reduce((s, r) => s + (r.openings - r.filled), 0);

  const allKpis: Kpi[] = [
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

  // Tiles the actor has no permission to see are dropped server-side rather
  // than hidden in the markup.
  const REPORTING_TILES = new Set(["hires", "ttf", "acceptance"]);
  const kpis = allKpis.filter((k) => {
    if (REPORTING_TILES.has(k.key) && !reporting) return false;
    if (k.key === "offers" && actor && !can(actor, "offer.view")) return false;
    if (k.key === "reqs" && actor && !can(actor, "requisition.view.assigned")) return false;
    if (k.key === "pipeline" && actor && !can(actor, "requisition.view.assigned")) return false;
    if (k.key === "attention" && actor && !can(actor, "requisition.view.assigned")) return false;
    return true;
  });

  return {
    kpis,
    reporting,
    reqs,
    openReqs,
    cards,
    upcoming,
    thisWeek,
    offers: allOffers,
    openOffers,
    funnel: reporting ? await funnel(new Date(now - 180 * DAY)) : [],
    trend: reporting ? await monthlyTrend(12) : [],
    stageTotals: await stageTotals(cards),
  };
}

async function stageTotals(cards: PipelineCard[]) {
  const totals = new Map<Stage, { count: number; aging: number }>();
  const pipeline = await loadPipeline();
  for (const stage of pipeline.active) totals.set(stage, { count: 0, aging: 0 });
  for (const c of cards) {
    const entry = totals.get(c.stage);
    if (!entry) continue;
    entry.count += 1;
    if (c.isAging) entry.aging += 1;
  }
  return [...totals.entries()].map(([stage, v]) => ({ stage, ...v, sla: pipeline.sla(stage) }));
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

export async function actionQueue(limit = 12, actor?: User): Promise<ActionItem[]> {
  const items: ActionItem[] = [];
  const now = Date.now();

  for (const iv of await awaitingFeedback(undefined, actor)) {
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

  for (const o of await listOffers({ status: "open" }, actor)) {
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

  const cards = await pipelineCards({}, actor);
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

  for (const r of await listRequisitions({ status: "active" }, actor)) {
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
  for (const iv of await listInterviews({ window: "today" }, actor)) {
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

export async function recentActivity(
  limit = 25,
  entity?: { type: string; id: string },
  actor?: User,
) {
  const conditions = [];
  if (entity) {
    conditions.push(and(eq(activities.entityType, entity.type), eq(activities.entityId, entity.id)));
  }

  // Scope the feed to entities the actor can reach. Without this the activity
  // summaries would narrate records their permissions otherwise hide.
  if (actor) {
    const visible = await visibleRequisitionIds(actor);
    if (visible !== null) {
      const subIds = visible.length
        ? (await db
            .select({ id: submissions.id })
            .from(submissions)
            .where(inArray(submissions.requisitionId, visible))
            )
            .map((r) => r.id)
        : [];
      const reachable = [...visible, ...subIds, actor.id];
      conditions.push(
        reachable.length ? inArray(activities.entityId, reachable) : eq(activities.id, "__none__"),
      );
    }
  }

  return (await db
    .select({ activity: activities, actor: users })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    );
}

/** Activity for a requisition, including everything on its submissions. */
export async function requisitionActivity(requisitionId: string, limit = 40) {
  const submissionIds = (await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.requisitionId, requisitionId))
    )
    .map((r) => r.id);

  const ids = [requisitionId, ...submissionIds];

  return (await db
    .select({ activity: activities, actor: users })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(inArray(activities.entityId, ids))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    );
}

export async function candidateActivity(candidateId: string, limit = 40) {
  const submissionIds = (await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.candidateId, candidateId))
    )
    .map((r) => r.id);

  return (await db
    .select({ activity: activities, actor: users })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(inArray(activities.entityId, [candidateId, ...submissionIds]))
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    );
}

/** Requisitions ranked by how much they need a human today. */
export async function attentionList(
  limit = 6,
  actor?: User,
): Promise<(RequisitionRow & { health: ReturnType<typeof requisitionHealth> })[]> {
  return (await listRequisitions({ status: "active" }, actor))
    .map((r) => ({ ...r, health: requisitionHealth(r) }))
    .filter((r) => r.health.key !== "healthy")
    .sort((a, b) => {
      const rank = { stalled: 0, at_risk: 1, watch: 2, healthy: 3, closed: 4 };
      return rank[a.health.key] - rank[b.health.key] || b.ageDays - a.ageDays;
    })
    .slice(0, limit);
}

export async function globalSearch(term: string) {
  if (!term.trim()) return { requisitions: [], candidates: [] };
  const reqs = (await listRequisitions({ q: term })).slice(0, 6);
  return { requisitions: reqs };
}

export async function teamRoster() {
  return (await db.select().from(users).orderBy(users.name));
}

export async function openRequisitionCount(actor?: User) {
  return (await listRequisitions({ status: "active" }, actor)).length;
}

export async function activePipelineCount(actor?: User) {
  return (await pipelineCards({}, actor)).length;
}

export async function openOfferCount(actor?: User) {
  return (await listOffers({ status: "open" }, actor)).length;
}
