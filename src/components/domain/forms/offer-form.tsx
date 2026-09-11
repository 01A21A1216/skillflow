"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { DECLINE_REASONS, OFFER_STATUS, OFFER_TRANSITIONS, type OfferStatus } from "@/lib/domain";
import { clamp, formatMoney } from "@/lib/utils";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Meter } from "@/components/ui/misc";
import { createOffer, transitionOffer, updateOffer } from "@/server/actions/offers";
import { FormModal } from "./form-shell";

function isoIn(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function OfferFormModal({
  open,
  onClose,
  submissionId,
  candidateName,
  requisitionTitle,
  band,
  offer,
}: {
  open: boolean;
  onClose: () => void;
  submissionId: string;
  candidateName: string;
  requisitionTitle: string;
  band?: { min: number | null; max: number | null };
  offer?: {
    id: string;
    baseSalary: number;
    bonusPercent: number;
    signingBonus: number;
    equityUnits: number;
    startDate: string | null;
    expiresAt: string | null;
    notes: string;
  };
}) {
  const router = useRouter();
  const editing = Boolean(offer);
  const [base, setBase] = useState(offer?.baseSalary ?? band?.min ?? 150000);

  const bandPosition =
    band?.min != null && band?.max != null && band.max > band.min
      ? clamp(((base - band.min) / (band.max - band.min)) * 100, 0, 100)
      : null;
  const aboveBand = band?.max != null && base > band.max;
  const belowBand = band?.min != null && base < band.min;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={editing ? "Revise offer terms" : "Draft an offer"}
      description={`${candidateName} — ${requisitionTitle}`}
      action={editing ? updateOffer : createOffer}
      submitLabel={editing ? "Save terms" : "Create draft"}
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          {editing ? <input type="hidden" name="offerId" value={offer!.id} /> : null}

          <Field label="Base salary" required error={errors.baseSalary}>
            <Input
              name="baseSalary"
              type="number"
              min={0}
              step={500}
              value={base}
              onChange={(e) => setBase(Number(e.target.value) || 0)}
              required
            />
          </Field>

          {band?.min != null && band?.max != null ? (
            <div className="rounded-lg bg-surface-muted p-3">
              <div className="mb-2 flex items-baseline justify-between text-[11.5px] text-content-muted tabular-nums">
                <span>{formatMoney(band.min)}</span>
                <span className="font-medium text-content">Approved band</span>
                <span>{formatMoney(band.max)}</span>
              </div>
              <Meter
                value={bandPosition ?? 0}
                tone={aboveBand || belowBand ? "amber" : "emerald"}
                height={8}
                label="Position within the approved band"
              />
              <p className="mt-2 text-[12px] text-content-muted">
                {aboveBand
                  ? `${formatMoney(base - band.max)} above the top of band — this needs a compensation exception.`
                  : belowBand
                    ? `${formatMoney(band.min - base)} below the bottom of band.`
                    : `At the ${Math.round(bandPosition ?? 0)}th percentile of the band.`}
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Bonus" hint="% of base" error={errors.bonusPercent}>
              <Input
                name="bonusPercent"
                type="number"
                min={0}
                max={200}
                step={1}
                defaultValue={offer?.bonusPercent ?? 10}
              />
            </Field>
            <Field label="Signing bonus" error={errors.signingBonus}>
              <Input
                name="signingBonus"
                type="number"
                min={0}
                step={1000}
                defaultValue={offer?.signingBonus ?? 0}
              />
            </Field>
            <Field label="Equity units" error={errors.equityUnits}>
              <Input
                name="equityUnits"
                type="number"
                min={0}
                step={100}
                defaultValue={offer?.equityUnits ?? 0}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Proposed start date" error={errors.startDate}>
              <Input
                name="startDate"
                type="date"
                defaultValue={offer?.startDate ?? isoIn(30)}
              />
            </Field>
            <Field label="Offer expires" error={errors.expiresAt}>
              <Input name="expiresAt" type="date" defaultValue={offer?.expiresAt ?? isoIn(7)} />
            </Field>
          </div>

          <Field label="Internal notes" error={errors.notes}>
            <Textarea
              name="notes"
              defaultValue={offer?.notes}
              placeholder="Context for approvers — competing offers, exception rationale, negotiation history."
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

export function OfferTransitionModal({
  open,
  onClose,
  offerId,
  from,
  to,
  candidateName,
}: {
  open: boolean;
  onClose: () => void;
  offerId: string;
  from: OfferStatus;
  to: OfferStatus;
  candidateName: string;
}) {
  const router = useRouter();
  const allowed = OFFER_TRANSITIONS[from] ?? [];

  return (
    <FormModal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Mark offer ${OFFER_STATUS[to].label.toLowerCase()}`}
      description={`${candidateName} · currently ${OFFER_STATUS[from].label.toLowerCase()}`}
      action={transitionOffer}
      submitLabel="Confirm"
      onSuccess={() => router.refresh()}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="offerId" value={offerId} />
          <Field label="New status" error={errors.status}>
            <Select name="status" defaultValue={to}>
              {allowed.map((s) => (
                <option key={s} value={s}>
                  {OFFER_STATUS[s].label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Decline reason"
            hint="Required when a candidate declines — it feeds the offer analytics."
            error={errors.declineReason}
          >
            <Select name="declineReason" defaultValue="">
              <option value="">Not applicable</option>
              {DECLINE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>

          {to === "accepted" ? (
            <p className="rounded-lg bg-[hsl(var(--tone-emerald-bg))] px-3 py-2.5 text-[12.5px] text-[hsl(var(--tone-emerald))]">
              Accepting the offer marks the candidate hired and counts against the openings on this
              requisition.
            </p>
          ) : null}
        </>
      )}
    </FormModal>
  );
}
