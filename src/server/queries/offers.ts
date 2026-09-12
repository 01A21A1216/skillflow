import "server-only";

import { once, queryKey } from "@/server/request-cache";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { candidates, clients, offers, requisitions, submissions, users } from "@/db/schema";
import { daysBetween } from "@/lib/utils";
import { alias } from "drizzle-orm/pg-core";
import type { User } from "@/db/schema";
import { visibleRequisitionIds } from "@/server/authz";

export interface OfferFilters {
  status?: string;
  requisition?: string;
  recruiter?: string;
  sort?: string;
}

export interface OfferRow {
  id: string;
  status: string;
  baseSalary: number;
  bonusPercent: number;
  signingBonus: number;
  equityUnits: number;
  currency: string;
  startDate: string | null;
  expiresAt: string | null;
  extendedAt: Date | null;
  respondedAt: Date | null;
  declineReason: string | null;
  notes: string;
  version: number;
  createdAt: Date;
  submissionId: string;
  candidateId: string;
  candidateName: string;
  candidateTitle: string;
  expectedSalary: number | null;
  requisitionId: string;
  requisitionCode: string;
  requisitionTitle: string;
  minSalary: number | null;
  maxSalary: number | null;
  clientName: string;
  createdByName: string;
  approvedByName: string | null;
  totalComp: number;
  /** Percentile of the requisition band the base lands on, 0-100. */
  bandPosition: number | null;
  daysOutstanding: number | null;
  daysToExpiry: number | null;
  isOpen: boolean;
}

/**
 * An offer that is still in play.
 *
 * Exported because the sidebar badge counts the same set with `count(*)`
 * rather than by building this list; sharing the definition is what keeps the
 * badge and the page from drifting apart.
 */
export const OPEN_OFFER_STATUSES = ["draft", "pending_approval", "approved", "extended"];
const OPEN_STATUSES = OPEN_OFFER_STATUSES;

async function loadOffers(filters: OfferFilters = {}, actor?: User): Promise<OfferRow[]> {
  const approver = alias(users, "approver");
  const conditions = [];

  if (actor) {
    const visible = await visibleRequisitionIds(actor);
    if (visible !== null) {
      if (!visible.length) return [];
      conditions.push(inArray(requisitions.id, visible));
    }
  }

  if (filters.status && filters.status !== "all") {
    if (filters.status === "open") conditions.push(inArray(offers.status, OPEN_STATUSES));
    // The acceptance-rate tile drills to the offers it was calculated from,
    // which is the answered ones — an offer still out is not a data point yet.
    else if (filters.status === "responded")
      conditions.push(inArray(offers.status, ["accepted", "declined"]));
    else conditions.push(eq(offers.status, filters.status));
  }
  if (filters.requisition && filters.requisition !== "all")
    conditions.push(eq(requisitions.id, filters.requisition));
  if (filters.recruiter && filters.recruiter !== "all")
    conditions.push(eq(offers.createdById, filters.recruiter));

  const rows = (await db
    .select({
      offer: offers,
      candidate: candidates,
      requisition: requisitions,
      clientName: clients.name,
      createdByName: users.name,
      approvedByName: approver.name,
      submissionId: submissions.id,
    })
    .from(offers)
    .innerJoin(submissions, eq(submissions.id, offers.submissionId))
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .innerJoin(clients, eq(clients.id, requisitions.clientId))
    .innerJoin(users, eq(users.id, offers.createdById))
    .leftJoin(approver, eq(approver.id, offers.approvedById))
    .where(conditions.length ? and(...conditions) : undefined)
    );

  const result: OfferRow[] = rows.map(
    ({ offer: o, candidate: c, requisition: r, clientName, createdByName, approvedByName, submissionId }) => {
      const totalComp = o.baseSalary * (1 + o.bonusPercent / 100) + o.signingBonus;
      const band =
        r.minSalary != null && r.maxSalary != null && r.maxSalary > r.minSalary
          ? ((o.baseSalary - r.minSalary) / (r.maxSalary - r.minSalary)) * 100
          : null;
      const isOpen = OPEN_STATUSES.includes(o.status);
      return {
        id: o.id,
        status: o.status,
        baseSalary: o.baseSalary,
        bonusPercent: o.bonusPercent,
        signingBonus: o.signingBonus,
        equityUnits: o.equityUnits,
        currency: o.currency,
        startDate: o.startDate,
        expiresAt: o.expiresAt,
        extendedAt: o.extendedAt,
        respondedAt: o.respondedAt,
        declineReason: o.declineReason,
        notes: o.notes,
        version: o.version,
        createdAt: o.createdAt,
        submissionId,
        candidateId: c.id,
        candidateName: `${c.firstName} ${c.lastName}`,
        candidateTitle: c.currentTitle,
        expectedSalary: c.expectedSalary,
        requisitionId: r.id,
        requisitionCode: r.code,
        requisitionTitle: r.title,
        minSalary: r.minSalary,
        maxSalary: r.maxSalary,
        clientName,
        createdByName,
        approvedByName,
        totalComp,
        bandPosition: band === null ? null : Math.max(0, Math.min(100, band)),
        daysOutstanding: o.extendedAt && !o.respondedAt ? daysBetween(o.extendedAt) : null,
        daysToExpiry: o.expiresAt && isOpen ? -daysBetween(o.expiresAt) : null,
        isOpen,
      };
    },
  );

  const sorter: Record<string, (a: OfferRow, b: OfferRow) => number> = {
    recent: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    value: (a, b) => b.totalComp - a.totalComp,
    expiring: (a, b) => (a.daysToExpiry ?? 9e9) - (b.daysToExpiry ?? 9e9),
    candidate: (a, b) => a.candidateName.localeCompare(b.candidateName),
  };
  result.sort(sorter[filters.sort ?? "recent"] ?? sorter.recent!);

  return result;
}

/** Headline numbers for the offers page. */
export async function offerStats(actor?: User) {
  const all = await listOffers({}, actor);
  const responded = all.filter((o) => ["accepted", "declined"].includes(o.status));
  const accepted = all.filter((o) => o.status === "accepted");
  const open = all.filter((o) => o.isOpen);
  const extended = all.filter((o) => o.extendedAt && o.respondedAt);

  const turnaround = extended
    .map((o) => daysBetween(o.extendedAt!, o.respondedAt!))
    .filter((d) => d >= 0);

  const declineReasons = new Map<string, number>();
  for (const o of all) {
    if (o.status !== "declined" || !o.declineReason) continue;
    declineReasons.set(o.declineReason, (declineReasons.get(o.declineReason) ?? 0) + 1);
  }

  return {
    total: all.length,
    open: open.length,
    outstanding: all.filter((o) => o.status === "extended").length,
    accepted: accepted.length,
    declined: all.filter((o) => o.status === "declined").length,
    acceptanceRate: responded.length ? (accepted.length / responded.length) * 100 : 0,
    avgAcceptedBase: accepted.length
      ? accepted.reduce((s, o) => s + o.baseSalary, 0) / accepted.length
      : 0,
    avgTurnaroundDays: turnaround.length
      ? turnaround.reduce((s, d) => s + d, 0) / turnaround.length
      : 0,
    // Scoped to offers actually sitting with a candidate, so it lines up with
    // the "out with candidates" figure it is shown beneath.
    expiringSoon: all.filter(
      (o) => o.status === "extended" && o.daysToExpiry !== null && o.daysToExpiry <= 3,
    ).length,
    declineReasons: [...declineReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Submissions at offer stage that do not yet have an offer record. */
export async function offerReadySubmissions() {
  const existing = new Set((await db.select({ id: offers.submissionId }).from(offers)).map((r) => r.id));

  return (await db
    .select({
      submissionId: submissions.id,
      candidateName: candidates.firstName,
      lastName: candidates.lastName,
      requisitionTitle: requisitions.title,
      requisitionCode: requisitions.code,
      minSalary: requisitions.minSalary,
      maxSalary: requisitions.maxSalary,
    })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(and(eq(submissions.status, "active"), inArray(submissions.stage, ["interview_completed", "feedback_pending", "selected", "offer"])))
    .orderBy(desc(submissions.stageSince))
    )
    .filter((r) => !existing.has(r.submissionId))
    .map((r) => ({
      submissionId: r.submissionId,
      label: `${r.candidateName} ${r.lastName} — ${r.requisitionTitle} (${r.requisitionCode})`,
      minSalary: r.minSalary,
      maxSalary: r.maxSalary,
    }));
}

/** listOffers, memoised for the request — see `server/request-cache.ts`. */
export function listOffers(
  filters: OfferFilters = {},
  actor?: User,
): Promise<OfferRow[]> {
  return once(queryKey("offers", filters, actor?.id), () => loadOffers(filters, actor));
}
