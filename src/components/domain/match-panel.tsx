"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Sparkles, UserPlus } from "lucide-react";

import type { RankedCandidate } from "@/server/queries/matching";
import type { Factor } from "@/lib/match-score";
import { addToPipeline } from "@/server/actions/pipeline";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { AvailabilityBadge, SkillChips, WorkAuthBadge } from "./badges";

const VERDICT_TONE: Record<Factor["verdict"], string> = {
  strong: "emerald",
  partial: "amber",
  weak: "rose",
  unknown: "slate",
};

/**
 * Ranked matches for a requirement (§16).
 *
 * Every row can be expanded into the factors behind its number, because
 * "92%" on its own is not evidence and the specification asks for evidence.
 * The panel says plainly that nothing has been filtered out on the reader's
 * behalf: a candidate the client will not accept is ranked low and labelled,
 * not hidden, and adding anyone is still a person's decision.
 */
export function MatchPanel({
  requisitionId,
  requisitionCode,
  ranked,
  canAdd,
}: {
  requisitionId: string;
  requisitionCode: string;
  ranked: RankedCandidate[];
  canAdd: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function add(candidate: RankedCandidate) {
    setAdding(candidate.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("candidateId", candidate.id);
      fd.set("requisitionId", requisitionId);
      fd.set("matchScore", String(candidate.match.score));
      const result = await addToPipeline({ ok: false }, fd);
      setAdding(null);
      toast(
        result.ok
          ? { kind: "success", title: `${candidate.name} added to ${requisitionCode}` }
          : { kind: "error", title: "Could not add", description: result.message },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <Card padded={false}>
      <div className="p-5 pb-4">
        <CardHeader
          icon={<Sparkles className="size-4" />}
          title="Matching candidates"
          description="Scored against this requirement's must-haves, band, location, work authorization and availability. Open a row to see why."
        />
      </div>

      {ranked.length === 0 ? (
        <p className="border-t border-border-base px-5 py-6 text-[12.5px] text-content-subtle">
          Nobody in the database holds any of the skills on this requirement. Widen the
          must-haves, or source against it.
        </p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
          {ranked.map((c) => {
            const open = expanded === c.id;
            return (
              <li key={c.id} className={cn(c.alreadySubmitted && "opacity-70")}>
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5">
                  <div className="w-11 shrink-0 pt-0.5">
                    <p className="text-[15px] leading-none font-semibold text-content tabular-nums">
                      {c.match.score}
                      <span className="text-[10px] font-normal text-content-subtle">%</span>
                    </p>
                    <Meter
                      value={c.match.score}
                      max={100}
                      tone={c.match.score >= 80 ? "emerald" : c.match.score >= 60 ? "amber" : "slate"}
                      className="mt-1.5"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/candidates/${c.id}`}
                        className="text-[13.5px] font-medium text-content hover:text-brand"
                      >
                        {c.name}
                      </Link>
                      <span className="text-[12px] text-content-subtle">
                        {c.currentTitle} · {c.currentCompany}
                      </span>
                      {c.alreadySubmitted ? (
                        <Badge tone="slate" size="sm" variant="outline">
                          already on this pipeline
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <SkillChips
                        skills={c.skills}
                        max={5}
                        matched={c.match.matchingSkills}
                      />
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-content-subtle">
                      <span>{c.location}</span>
                      <span>{c.yearsExperience} yrs</span>
                      <AvailabilityBadge value={c.availability} size="sm" />
                      <WorkAuthBadge value={c.workAuthorization} size="sm" />
                    </div>

                    {c.match.blocker ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[hsl(var(--tone-rose))]">
                        <AlertTriangle className="size-3 shrink-0" />
                        {c.match.blocker}
                      </p>
                    ) : null}
                    {c.match.missingRequired.length ? (
                      <p className="mt-1 text-[11.5px] text-content-subtle">
                        Missing: {c.match.missingRequired.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : c.id)}
                      aria-expanded={open}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-border-strong px-2 text-[12px] text-content-muted hover:bg-surface-muted"
                    >
                      Why
                      <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
                    </button>
                    {canAdd && !c.alreadySubmitted ? (
                      <Button
                        size="xs"
                        variant="secondary"
                        loading={adding === c.id}
                        onClick={() => add(c)}
                      >
                        <UserPlus className="size-3" />
                        Add
                      </Button>
                    ) : null}
                  </div>
                </div>

                {open ? (
                  <div className="border-t border-border-base bg-surface-muted/40 px-5 py-3">
                    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                      {c.match.factors.map((f) => (
                        <li key={f.key} className="flex items-baseline gap-2">
                          <span
                            className="mt-1.5 size-1.5 shrink-0 rounded-full"
                            style={{ background: `hsl(var(--tone-${VERDICT_TONE[f.verdict]}))` }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-[12px] font-medium text-content">{f.label}</span>
                            <span className="ml-2 text-[11.5px] text-content-subtle tabular-nums">
                              {f.points}/{f.max}
                            </span>
                            <span className="block text-[11.5px] text-content-muted">
                              {f.detail}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t border-border-base px-5 py-3 text-[11.5px] leading-relaxed text-content-subtle">
        Nobody has been filtered out on your behalf. Candidates are narrowed to those holding at
        least one required skill, then ranked — never excluded on location, work authorization or
        availability. A score is a starting point for a conversation, not a decision.
      </p>
    </Card>
  );
}
