"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Merge } from "lucide-react";

import type { DuplicateCandidate } from "@/server/queries/duplicates";
import { mergeCandidates } from "@/server/actions/merge";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * Possible duplicates of the candidate on screen (§6).
 *
 * The panel shows *why* each one matched rather than a similarity score,
 * because the recruiter is the one deciding and "87%" tells them nothing they
 * can act on. Merging asks for confirmation and says plainly what will happen
 * — it is the one action here that cannot be undone with an edit.
 */
export function DuplicatePanel({
  candidateId,
  candidateName,
  duplicates,
  canMerge,
}: {
  candidateId: string;
  candidateName: string;
  duplicates: DuplicateCandidate[];
  canMerge: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState<DuplicateCandidate | null>(null);
  const [pending, startTransition] = useTransition();

  if (!duplicates.length) return null;

  function merge(other: DuplicateCandidate) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("keepId", candidateId);
      fd.set("mergeId", other.id);
      const result = await mergeCandidates({ ok: false }, fd);
      setConfirming(null);
      toast(
        result.ok
          ? { kind: "success", title: result.message ?? "Merged" }
          : { kind: "error", title: "Could not merge", description: result.message },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <Card padded={false} className="border-[hsl(var(--tone-amber))]/40">
        <div className="p-5 pb-4">
          <CardHeader
            icon={<Copy className="size-4" />}
            title={`${duplicates.length} possible duplicate${duplicates.length === 1 ? "" : "s"}`}
            description="These records look like the same person. Merging keeps every pipeline, interview and note from both."
          />
        </div>
        <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
          {duplicates.map((d) => (
            <li key={d.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/candidates/${d.id}`}
                    className="text-[13.5px] font-medium text-content hover:text-brand"
                  >
                    {d.name}
                  </Link>
                  {d.match.certain ? (
                    <Badge tone="rose" size="sm">
                      Certain
                    </Badge>
                  ) : (
                    <Badge tone="amber" size="sm">
                      Likely
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-content-muted">
                  {d.email}
                  {d.currentCompany ? ` · ${d.currentCompany}` : ""} · added {formatDate(d.createdAt)}
                </p>
                <p className="mt-1 text-[11.5px] text-content-subtle">
                  {d.match.reasons.join(" · ")}
                </p>
              </div>
              {canMerge ? (
                <Button size="xs" variant="secondary" onClick={() => setConfirming(d)}>
                  <Merge className="size-3" />
                  Merge in
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        size="sm"
        title="Merge these records?"
        description={`${confirming?.name} will be folded into ${candidateName}.`}
        footer={
          <>
            <Button variant="ghost" size="sm" type="button" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={pending}
              onClick={() => confirming && merge(confirming)}
            >
              Merge
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px] leading-relaxed text-content-muted">
          <p>
            Every submission, interview, scorecard, note and file moves to{" "}
            <strong className="text-content">{candidateName}</strong>. Nothing is deleted.
          </p>
          <p>
            Where both records are on the same requirement, the one on{" "}
            <strong className="text-content">{candidateName}</strong> is kept and the other is
            closed out as a merged duplicate — its interviews and feedback stay readable.
          </p>
          <p>
            Empty fields on {candidateName} are filled in from {confirming?.name}; nothing
            already recorded is overwritten.
          </p>
          <p className="text-[hsl(var(--tone-amber))]">
            This cannot be undone from the interface.
          </p>
        </div>
      </Modal>
    </>
  );
}
