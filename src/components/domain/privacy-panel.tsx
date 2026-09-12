"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { eraseCandidateData, setRetentionConsent } from "@/server/actions/privacy";

/**
 * Data-subject requests, on the person's own record (§23).
 *
 * Placed here rather than on an administrative screen because a request
 * arrives about a person, and the first thing whoever handles it needs is
 * that person's record in front of them. Only shown to somebody who holds
 * `privacy.manage`, which by default is a Super Admin alone.
 */
export function PrivacyPanel({
  candidateId,
  candidateName,
  erasedAt,
  consentAt,
  canErase,
  canRecordConsent,
}: {
  candidateId: string;
  candidateName: string;
  erasedAt: Date | null;
  consentAt: Date | null;
  canErase: boolean;
  canRecordConsent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  if (erasedAt) {
    return (
      <Card>
        <CardHeader
          icon={<ShieldCheck className="size-4" />}
          title="Erased"
          description={`This person's data was erased on ${erasedAt.toLocaleDateString()}. What remains is the shape of the applications — which requirement, how far, when it ended — with nothing that identifies anybody.`}
        />
      </Card>
    );
  }

  if (!canErase && !canRecordConsent) return null;

  async function erase() {
    setBusy(true);
    const fd = new FormData();
    fd.set("candidateId", candidateId);
    fd.set("confirmation", confirmation);
    const result = await eraseCandidateData({ ok: false }, fd);
    setBusy(false);
    toast(
      result.ok
        ? { kind: "success", title: result.message ?? "Erased" }
        : { kind: "error", title: "Could not erase", description: result.message },
    );
    if (result.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  async function toggleConsent() {
    const fd = new FormData();
    fd.set("candidateId", candidateId);
    fd.set("granted", consentAt ? "" : "true");
    const result = await setRetentionConsent({ ok: false }, fd);
    toast(
      result.ok
        ? { kind: "success", title: result.message ?? "Saved" }
        : { kind: "error", title: "Could not save", description: result.message },
    );
    router.refresh();
  }

  return (
    <>
      <Card padded={false}>
        <div className="p-5 pb-3.5">
          <CardHeader
            icon={<ShieldAlert className="size-4" />}
            title="Data-subject requests"
            description="What this person is entitled to ask for, and what happens when they do."
          />
        </div>

        <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
          {canErase ? (
            <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-content">Everything held about them</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-content-subtle">
                  A single file: profile, applications, stage history, interview scorecards,
                  offers, contact log and internal notes — including the parts nobody enjoys
                  sharing.
                </p>
              </div>
              <a
                href={`/api/privacy/${candidateId}`}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-[13px] font-medium text-content transition-colors hover:bg-surface-muted"
              >
                <Download className="size-3.5" />
                Export
              </a>
            </li>
          ) : null}

          {canRecordConsent ? (
            <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-content">
                  Kept on file
                  {consentAt ? (
                    <Badge tone="emerald" size="sm">
                      agreed {consentAt.toLocaleDateString()}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" size="sm" variant="outline">
                      not agreed
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-content-subtle">
                  Without this, the retention policy erases the record once it has been dormant
                  for two years.
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={toggleConsent}>
                {consentAt ? "Withdraw" : "Record consent"}
              </Button>
            </li>
          ) : null}

          {canErase ? (
            <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-content">Erase them</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-content-subtle">
                  Overwrites every identifying field, deletes their documents, and clears the free
                  text from notes, scorecards and the audit trail. The applications survive as
                  anonymous rows so the funnel still counts them.{" "}
                  <strong className="text-content">This cannot be undone.</strong>
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
                Erase
              </Button>
            </li>
          ) : null}
        </ul>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Erase ${candidateName}`}
        description="This is the deletion a person asks for, not the one you undo. Nothing identifying survives it."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              disabled={confirmation.trim().toUpperCase() !== "ERASE"}
              onClick={erase}
            >
              Erase permanently
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="rounded-lg border border-border-base bg-surface-muted p-3.5">
            <p className="text-[12px] leading-relaxed text-content-muted">
              <strong className="text-content">What goes:</strong> name, contact details,
              location, employment history, education, skills, salary expectations, uploaded
              documents, the body of every logged call and email, every internal note, and the
              prose in interview scorecards.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-content-muted">
              <strong className="text-content">What stays:</strong> that an application existed,
              which requirement it was for, how far it got and when it ended — plus the scores on
              each scorecard. Those are the organisation&rsquo;s record of its own process, and
              none of them name anybody afterwards.
            </p>
          </div>

          <Field label={`Type ERASE to confirm`}>
            <Input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="ERASE"
              autoComplete="off"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
