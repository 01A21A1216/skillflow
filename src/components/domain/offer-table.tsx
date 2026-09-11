"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import type { OfferRow } from "@/server/queries/offers";
import { OFFER_STATUS, OFFER_TRANSITIONS, type OfferStatus } from "@/lib/domain";
import { cn, formatDate, formatMoney, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/misc";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/misc";
import { Table, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { Dot } from "@/components/ui/badge";
import { OfferStatusBadge } from "./badges";
import { OfferFormModal, OfferTransitionModal } from "./forms/offer-form";

export function OfferTable({ offers, focusId }: { offers: OfferRow[]; focusId?: string }) {
  const [edit, setEdit] = useState<OfferRow | null>(null);
  const [transition, setTransition] = useState<{ offer: OfferRow; to: OfferStatus } | null>(null);

  return (
    <>
      <TableShell>
        <Table>
          <thead>
            <tr>
              <Th className="min-w-[16rem]">Candidate</Th>
              <Th>Status</Th>
              <Th align="right">Base</Th>
              <Th className="min-w-[11rem]">Against band</Th>
              <Th align="right">Total comp</Th>
              <Th>Dates</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => {
              const expiringSoon =
                o.isOpen && o.daysToExpiry !== null && o.daysToExpiry <= 3;
              const allowed = OFFER_TRANSITIONS[o.status as OfferStatus] ?? [];
              const aboveBand = o.maxSalary !== null && o.baseSalary > o.maxSalary;

              return (
                <Tr key={o.id} interactive className={cn(focusId === o.id && "bg-brand-soft/50")}>
                  <Td>
                    <Link href={`/candidates/${o.candidateId}`} className="group block">
                      <p className="text-[13.5px] font-medium text-content group-hover:text-brand">
                        {o.candidateName}
                      </p>
                      <p className="mt-0.5 text-[12px] text-content-muted">
                        {o.requisitionTitle} · {o.clientName}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-content-subtle">
                        {o.requisitionCode}
                        {o.version > 1 ? ` · v${o.version}` : ""}
                      </p>
                    </Link>
                  </Td>

                  <Td>
                    <OfferStatusBadge value={o.status} dot />
                    {o.declineReason ? (
                      <p className="mt-1 max-w-[11rem] text-[11px] leading-snug text-[hsl(var(--tone-rose))]">
                        {o.declineReason}
                      </p>
                    ) : null}
                    {o.daysOutstanding !== null ? (
                      <p className="mt-1 text-[11px] text-content-subtle tabular-nums">
                        {o.daysOutstanding}d with the candidate
                      </p>
                    ) : null}
                  </Td>

                  <Td align="right">
                    <span className="text-[13.5px] font-medium text-content tabular-nums">
                      {formatMoney(o.baseSalary, o.currency)}
                    </span>
                    {o.expectedSalary ? (
                      <p className="mt-0.5 text-[11px] whitespace-nowrap text-content-subtle tabular-nums">
                        asked {formatMoney(o.expectedSalary, o.currency, { compact: true })}
                      </p>
                    ) : null}
                  </Td>

                  <Td>
                    {o.bandPosition !== null ? (
                      <div className="min-w-[9rem]">
                        <Meter
                          value={o.bandPosition}
                          tone={aboveBand ? "amber" : o.bandPosition > 85 ? "amber" : "emerald"}
                          height={6}
                          label="Position within the approved band"
                        />
                        <p className="mt-1.5 text-[11px] text-content-subtle tabular-nums">
                          {aboveBand
                            ? "Above band — needs an exception"
                            : `${Math.round(o.bandPosition)}th percentile`}
                        </p>
                      </div>
                    ) : (
                      <span className="text-[12px] text-content-subtle">No band set</span>
                    )}
                  </Td>

                  <Td align="right">
                    <span className="text-[13px] text-content tabular-nums">
                      {formatMoney(Math.round(o.totalComp), o.currency, { compact: true })}
                    </span>
                    <p className="mt-0.5 text-[11px] whitespace-nowrap text-content-subtle">
                      {o.bonusPercent ? `${o.bonusPercent}% bonus` : "no bonus"}
                      {o.equityUnits ? ` · ${o.equityUnits.toLocaleString()} units` : ""}
                    </p>
                  </Td>

                  <Td>
                    <p className="text-[12px] whitespace-nowrap text-content-muted">
                      {o.startDate ? `Starts ${formatDate(o.startDate, false)}` : "No start date"}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-[11px] whitespace-nowrap tabular-nums",
                        expiringSoon
                          ? "font-medium text-[hsl(var(--tone-rose))]"
                          : "text-content-subtle",
                      )}
                    >
                      {o.isOpen && o.daysToExpiry !== null
                        ? o.daysToExpiry < 0
                          ? `Expired ${Math.abs(o.daysToExpiry)}d ago`
                          : `Expires in ${o.daysToExpiry}d`
                        : o.respondedAt
                          ? `Answered ${relativeTime(o.respondedAt)}`
                          : `Drafted ${relativeTime(o.createdAt)}`}
                    </p>
                  </Td>

                  <Td align="right">
                    <div className="flex items-center justify-end gap-1.5">
                      {!["accepted", "declined", "rescinded"].includes(o.status) ? (
                        <Button size="xs" variant="secondary" onClick={() => setEdit(o)}>
                          Terms
                        </Button>
                      ) : null}

                      {allowed.length ? (
                        <Menu
                          align="right"
                          trigger={
                            <Button size="xs" variant="primary">
                              Advance
                              <ChevronDown className="size-3" />
                            </Button>
                          }
                        >
                          {(close) => (
                            <>
                              <MenuLabel>Move offer to</MenuLabel>
                              {allowed.map((s) => (
                                <MenuItem
                                  key={s}
                                  icon={<Dot tone={OFFER_STATUS[s].tone} />}
                                  onClick={() => {
                                    close();
                                    setTransition({ offer: o, to: s });
                                  }}
                                >
                                  {OFFER_STATUS[s].label}
                                </MenuItem>
                              ))}
                            </>
                          )}
                        </Menu>
                      ) : (
                        <span className="text-[11.5px] text-content-subtle">Settled</span>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableShell>

      {edit ? (
        <OfferFormModal
          open
          onClose={() => setEdit(null)}
          submissionId={edit.submissionId}
          candidateName={edit.candidateName}
          requisitionTitle={edit.requisitionTitle}
          band={{ min: edit.minSalary, max: edit.maxSalary }}
          offer={{
            id: edit.id,
            baseSalary: edit.baseSalary,
            bonusPercent: edit.bonusPercent,
            signingBonus: edit.signingBonus,
            equityUnits: edit.equityUnits,
            startDate: edit.startDate,
            expiresAt: edit.expiresAt,
            notes: edit.notes,
          }}
        />
      ) : null}

      {transition ? (
        <OfferTransitionModal
          open
          onClose={() => setTransition(null)}
          offerId={transition.offer.id}
          from={transition.offer.status as OfferStatus}
          to={transition.to}
          candidateName={transition.offer.candidateName}
        />
      ) : null}
    </>
  );
}

/** Draft a brand-new offer for a submission that does not have one. */
export function NewOfferButton({
  candidates,
}: {
  candidates: { submissionId: string; label: string; minSalary: number | null; maxSalary: number | null }[];
}) {
  const [pick, setPick] = useState<string>("");
  const chosen = candidates.find((c) => c.submissionId === pick);

  return (
    <div className="flex items-center gap-2">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        aria-label="Choose a candidate to draft an offer for"
        className="h-8 max-w-[18rem] cursor-pointer rounded-lg border border-border-strong bg-surface px-2.5 text-[13px]"
      >
        <option value="">Draft an offer for…</option>
        {candidates.map((c) => (
          <option key={c.submissionId} value={c.submissionId}>
            {c.label}
          </option>
        ))}
      </select>

      {chosen ? (
        <OfferFormModal
          open
          onClose={() => setPick("")}
          submissionId={chosen.submissionId}
          candidateName={chosen.label.split(" — ")[0] ?? chosen.label}
          requisitionTitle={chosen.label.split(" — ")[1] ?? ""}
          band={{ min: chosen.minSalary, max: chosen.maxSalary }}
        />
      ) : null}
    </div>
  );
}
