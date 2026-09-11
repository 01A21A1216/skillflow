"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Plus, Trash2 } from "lucide-react";

import { CHANNELS, DIRECTIONS } from "@/lib/domain";
import { deleteContact, logContact } from "@/server/actions/communications";
import { formatDateTime, isoDateTimeLocal } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ChannelBadge, DirectionBadge } from "./badges";
import { FormModal } from "./forms/form-shell";

export interface ContactEntry {
  id: string;
  channel: string;
  direction: string;
  subject: string;
  body: string;
  occurredAt: Date;
  followUpAt: Date | null;
  loggedBy: string;
  loggedById: string;
  requisitionCode: string | null;
}

/**
 * Contact history with a candidate (§7).
 *
 * Entries are typed in rather than synced from a mailbox, and the panel says
 * so. A recruiter who believes this log is complete stops checking their
 * inbox, and that is a worse failure than an obviously partial record.
 */
export function CommunicationLog({
  candidateId,
  candidateName,
  entries,
  submissions,
  actorId,
  canLog,
}: {
  candidateId: string;
  candidateName: string;
  entries: ContactEntry[];
  submissions: { id: string; label: string }[];
  actorId: string;
  canLog: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function remove(entry: ContactEntry) {
    setBusy(entry.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("contactId", entry.id);
      const result = await deleteContact({ ok: false }, fd);
      setBusy(null);
      toast(
        result.ok
          ? { kind: "success", title: "Entry removed" }
          : { kind: "error", title: "Could not remove", description: result.message },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
          <CardHeader
            icon={<MessageCircle className="size-4" />}
            title="Communication"
            description="Calls, emails and messages logged by the desk. Not a mailbox sync — what is here is what someone recorded."
          />
          {canLog ? (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Plus className="size-3.5" />
              Log contact
            </Button>
          ) : null}
        </div>

        {entries.length ? (
          <ol className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
            {entries.map((e) => (
              <li key={e.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <ChannelBadge value={e.channel} size="sm" />
                  <DirectionBadge value={e.direction} size="sm" variant="outline" />
                  {e.requisitionCode ? (
                    <span className="font-mono text-[11px] text-content-subtle">
                      {e.requisitionCode}
                    </span>
                  ) : null}
                  <span className="ml-auto text-[11.5px] text-content-subtle tabular-nums">
                    {formatDateTime(e.occurredAt)}
                  </span>
                  {e.loggedById === actorId ? (
                    <button
                      type="button"
                      disabled={busy === e.id}
                      onClick={() => remove(e)}
                      aria-label="Remove this entry"
                      className="rounded p-1 text-content-subtle transition-colors hover:bg-[hsl(var(--tone-rose-bg))] hover:text-[hsl(var(--tone-rose))] disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>

                {e.subject ? (
                  <p className="mt-1.5 text-[13px] font-medium text-content">{e.subject}</p>
                ) : null}
                <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-line text-content-muted">
                  {e.body}
                </p>
                <p className="mt-1.5 text-[11.5px] text-content-subtle">
                  Logged by {e.loggedBy}
                  {e.followUpAt ? (
                    <span className="text-[hsl(var(--tone-amber))]">
                      {" "}
                      · follow up {formatDateTime(e.followUpAt)}
                    </span>
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-t border-border-base px-5 py-4 text-[12.5px] text-content-subtle">
            Nothing logged yet.
          </p>
        )}
      </Card>

      <FormModal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title={`Log contact with ${candidateName}`}
        description="What was said, so whoever picks this up next knows where it left off."
        action={logContact}
        submitLabel="Log it"
        onSuccess={() => router.refresh()}
      >
        {({ errors }) => (
          <>
            <input type="hidden" name="candidateId" value={candidateId} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Channel" error={errors.channel}>
                <Select name="channel" defaultValue="call">
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Direction" error={errors.direction}>
                <Select name="direction" defaultValue="outbound">
                  {DIRECTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {submissions.length ? (
              <Field
                label="About"
                hint="Optional. Ties the conversation to one requirement."
                error={errors.submissionId}
              >
                <Select name="submissionId" defaultValue="">
                  <option value="">General</option>
                  {submissions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Field label="Subject" error={errors.subject}>
              <Input name="subject" placeholder="Availability and rate for the Fusion role" />
            </Field>

            <Field label="What was said" required error={errors.body}>
              <Textarea
                name="body"
                required
                placeholder="Confirmed available from the 3rd, wants $95/hr C2C, asked about the client's onsite expectation."
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="When" hint="Defaults to now." error={errors.occurredAt}>
                <Input
                  name="occurredAt"
                  type="datetime-local"
                  defaultValue={isoDateTimeLocal(new Date())}
                />
              </Field>
              <Field label="Follow up" hint="Optional." error={errors.followUpAt}>
                <Input name="followUpAt" type="datetime-local" />
              </Field>
            </div>
          </>
        )}
      </FormModal>
    </>
  );
}
