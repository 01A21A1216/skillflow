"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { candidates, offers, requisitions, stageEvents, submissions } from "@/db/schema";
import type { User } from "@/db/schema";
import { OFFER_STATUS, OFFER_TRANSITIONS, type OfferStatus } from "@/lib/domain";
import { offerSchema, offerTransitionSchema } from "@/lib/validation";
import { can, canTouchRequisition } from "@/server/authz";
import { checkVersion, describeChanges, diffFields, stamp, stampNew } from "@/server/integrity";
import {
  daysFromNow,
  denied,
  fail,
  guarded,
  logActivity,
  newId,
  parseForm,
  succeed,
  type ActionState,
} from "./shared";

async function context(submissionId: string) {
  return (await db
    .select({ submission: submissions, candidate: candidates, requisition: requisitions })
    .from(submissions)
    .innerJoin(candidates, eq(candidates.id, submissions.candidateId))
    .innerJoin(requisitions, eq(requisitions.id, submissions.requisitionId))
    .where(eq(submissions.id, submissionId))
    )[0];
}

function revalidateAll(requisitionId?: string, candidateId?: string) {
  revalidatePath("/offers");
  revalidatePath("/pipeline");
  revalidatePath("/");
  if (requisitionId) revalidatePath(`/requisitions/${requisitionId}`);
  if (candidateId) revalidatePath(`/candidates/${candidateId}`);
}

async function createOfferImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(offerSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const ctx = await context(input.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");
  if (ctx.submission.status !== "active") {
    return fail("You can only draft an offer for an active candidate.");
  }

  const open = (await db
    .select()
    .from(offers)
    .where(eq(offers.submissionId, input.submissionId))
    .orderBy(desc(offers.createdAt))
    )
    .find((o) => !["declined", "rescinded", "expired"].includes(o.status));

  if (open) {
    return fail(
      `There is already a ${OFFER_STATUS[open.status as OfferStatus].label.toLowerCase()} offer for this candidate.`,
    );
  }

  const previousVersions = (await db
    .select()
    .from(offers)
    .where(eq(offers.submissionId, input.submissionId))
    ).length;

  const id = newId("ofr");
  const now = new Date();

  db.transaction(async (tx) => {
    (await tx.insert(offers)
      .values({
        id,
        submissionId: input.submissionId,
        status: "draft",
        baseSalary: input.baseSalary,
        bonusPercent: input.bonusPercent,
        signingBonus: input.signingBonus,
        equityUnits: input.equityUnits,
        currency: "USD",
        startDate: input.startDate ?? null,
        expiresAt: input.expiresAt ?? daysFromNow(7),
        createdById: actor.id,
        version: previousVersions + 1,
        notes: input.notes ?? "",
        ...stampNew(actor.id),
      })
      );

    if (ctx.submission.stage !== "offer") {
      (await tx.update(submissions)
        .set({ stage: "offer", stageSince: now, updatedAt: now })
        .where(eq(submissions.id, input.submissionId))
        );

      (await tx.insert(stageEvents)
        .values({
          id: newId("stg"),
          submissionId: input.submissionId,
          fromStage: ctx.submission.stage,
          toStage: "offer",
          actorId: actor.id,
          note: "Offer drafted",
          createdAt: now,
        })
        );
    }
  });

  await logActivity({
    entityType: "submission",
    entityId: input.submissionId,
    type: "offer_created",
    actorId: actor.id,
    summary: `Offer drafted for ${ctx.candidate.firstName} ${ctx.candidate.lastName} — ${ctx.requisition.title}`,
    meta: { requisitionId: ctx.requisition.id, candidateId: ctx.candidate.id, offerId: id },
  });

  revalidateAll(ctx.requisition.id, ctx.candidate.id);
  return succeed("Offer drafted", id);
}

async function updateOfferImpl(actor: User, formData: FormData): Promise<ActionState> {
  const offerId = String(formData.get("offerId") ?? "");
  const parsed = parseForm(offerSchema, formData);
  if (!parsed.success) return parsed.state;
  const input = parsed.data;

  const existing = (await db.select().from(offers).where(eq(offers.id, offerId)))[0];
  if (!existing) return fail("That offer no longer exists.");
  if (["accepted", "declined", "rescinded"].includes(existing.status)) {
    return fail("A settled offer can no longer be edited.");
  }

  const ctx = await context(existing.submissionId);
  const nextVersion = checkVersion("Offer", existing.rowVersion, formData.get("rowVersion"));

  const changes = diffFields(existing, input, {
    baseSalary: "Base salary",
    bonusPercent: "Bonus",
    signingBonus: "Signing bonus",
    equityUnits: "Equity",
    startDate: "Start date",
    expiresAt: "Expiry",
    notes: "Notes",
  });

  (await db.update(offers)
    .set({
      baseSalary: input.baseSalary,
      bonusPercent: input.bonusPercent,
      signingBonus: input.signingBonus,
      equityUnits: input.equityUnits,
      startDate: input.startDate ?? null,
      expiresAt: input.expiresAt ?? null,
      notes: input.notes ?? "",
      // Re-opening the terms invalidates any approval already given.
      status: existing.status === "approved" ? "pending_approval" : existing.status,
      approvedById: existing.status === "approved" ? null : existing.approvedById,
      ...stamp(actor.id, nextVersion),
    })
    .where(eq(offers.id, offerId))
    );

  await logActivity({
    entityType: "submission",
    entityId: existing.submissionId,
    type: "offer_status",
    actorId: actor.id,
    summary: `Offer terms revised${ctx ? ` for ${ctx.candidate.firstName} ${ctx.candidate.lastName}` : ""}${
      changes.length ? ` — ${describeChanges(changes)}` : ""
    }`,
    changes,
    meta: { offerId },
  });

  revalidateAll(ctx?.requisition.id, ctx?.candidate.id);
  return succeed("Offer updated", offerId);
}

async function transitionOfferImpl(actor: User, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(offerTransitionSchema, formData);
  if (!parsed.success) return parsed.state;
  const { offerId, status, declineReason } = parsed.data;

  const offer = (await db.select().from(offers).where(eq(offers.id, offerId)))[0];
  if (!offer) return fail("That offer no longer exists.");

  const from = offer.status as OfferStatus;
  const to = status as OfferStatus;

  if (!OFFER_TRANSITIONS[from]?.includes(to)) {
    return fail(
      `Cannot move an offer from ${OFFER_STATUS[from].label.toLowerCase()} to ${OFFER_STATUS[to].label.toLowerCase()}.`,
    );
  }
  if (to === "declined" && !declineReason) {
    return fail("Pick a reason so we can learn from it.", { declineReason: "Reason required" });
  }

  const ctx = await context(offer.submissionId);
  if (!ctx) return fail("That candidate is no longer in this pipeline.");
  if (!await canTouchRequisition(actor, ctx.requisition.id)) return denied("that offer");
  // Approval is a separate permission from progressing an offer: a recruiter
  // may extend and record a response, but must not sign off their own terms.
  if (to === "approved" && !can(actor, "offer.approve")) {
    return fail("Only a hiring manager or recruitment manager can approve an offer.");
  }

  const now = new Date();

  db.transaction(async (tx) => {
    (await tx.update(offers)
      .set({
        status: to,
        approvedById: to === "approved" ? actor.id : offer.approvedById,
        extendedAt: to === "extended" ? now : offer.extendedAt,
        respondedAt: ["accepted", "declined"].includes(to) ? now : offer.respondedAt,
        declineReason: to === "declined" ? (declineReason ?? null) : offer.declineReason,
        ...stamp(actor.id, offer.rowVersion + 1),
      })
      .where(eq(offers.id, offerId))
      );

    if (to === "accepted") {
      (await tx.update(submissions)
        .set({ stage: "joined", status: "hired", stageSince: now, updatedAt: now })
        .where(eq(submissions.id, offer.submissionId))
        );

      (await tx.insert(stageEvents)
        .values({
          id: newId("stg"),
          submissionId: offer.submissionId,
          fromStage: ctx.submission.stage,
          toStage: "joined",
          actorId: actor.id,
          note: "Offer accepted",
          createdAt: now,
        })
        );

      (await tx.update(candidates)
        .set({ status: "placed", updatedAt: now })
        .where(eq(candidates.id, ctx.candidate.id))
        );
    }

    if (["declined", "rescinded"].includes(to) && ctx.submission.status === "active") {
      (await tx.update(submissions)
        .set({
          stage: to === "declined" ? "withdrawn" : "rejected",
          status: to === "declined" ? "withdrawn" : "rejected",
          rejectionReason: declineReason ?? "Offer rescinded",
          rejectedAt: now,
          stageSince: now,
          updatedAt: now,
        })
        .where(eq(submissions.id, offer.submissionId))
        );

      (await tx.insert(stageEvents)
        .values({
          id: newId("stg"),
          submissionId: offer.submissionId,
          fromStage: ctx.submission.stage,
          toStage: to === "declined" ? "withdrawn" : "rejected",
          actorId: actor.id,
          note: declineReason ?? "Offer rescinded",
          createdAt: now,
        })
        );
    }
  });

  if (to === "accepted") {
    const req = (await db.select().from(requisitions).where(eq(requisitions.id, ctx.requisition.id)))[0];
    if (req) {
      const hires = (await db
        .select()
        .from(submissions)
        .where(eq(submissions.requisitionId, req.id))
        )
        .filter((s) => s.status === "hired").length;

      const filled = Math.min(hires, req.openings);
      (await db.update(requisitions)
        .set({
          filled,
          status: hires >= req.openings && ["open", "on_hold", "draft"].includes(req.status) ? "filled" : req.status,
          closedAt:
            hires >= req.openings ? (req.closedAt ?? now.toISOString().slice(0, 10)) : req.closedAt,
          updatedAt: now,
        })
        .where(eq(requisitions.id, req.id))
        );
    }
  }

  await logActivity({
    entityType: "submission",
    entityId: offer.submissionId,
    type: "offer_status",
    actorId: actor.id,
    summary: `Offer ${OFFER_STATUS[to].label.toLowerCase()} for ${ctx.candidate.firstName} ${ctx.candidate.lastName}${
      declineReason ? ` — ${declineReason}` : ""
    }`,
    changes: [{ field: "status", label: "Offer status", from, to }],
    meta: { requisitionId: ctx.requisition.id, candidateId: ctx.candidate.id, offerId, from, to },
  });

  revalidateAll(ctx.requisition.id, ctx.candidate.id);
  return succeed(`Offer ${OFFER_STATUS[to].label.toLowerCase()}`);
}


/* ---- Guarded exports -------------------------------------------- *
 * Each mutation is only reachable through its permission check.
 * ------------------------------------------------------------------ */

export const createOffer = guarded("offer.create", createOfferImpl);
export const updateOffer = guarded("offer.edit", updateOfferImpl);
export const transitionOffer = guarded("offer.transition", transitionOfferImpl);
