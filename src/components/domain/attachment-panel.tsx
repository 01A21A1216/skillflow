"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";

import type { AttachmentRow } from "@/server/queries/attachments";
import { deleteAttachment, uploadAttachment } from "@/server/actions/attachments";
import { formatBytes, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

/**
 * Files on a record (§5, §6).
 *
 * Uploads post a real `File` through a server action rather than to an API
 * route, so the same permission wrapper that guards every other mutation
 * guards this one too. Downloads go through `/api/attachments/[id]`, which
 * re-checks the viewer — the storage key is never exposed.
 */
export function AttachmentPanel({
  entityType,
  entityId,
  attachments,
  canUpload,
  canDelete,
  kind = "document",
  title = "Files",
  description,
}: {
  entityType: "candidate" | "requisition";
  entityId: string;
  attachments: AttachmentRow[];
  canUpload: boolean;
  canDelete: boolean;
  kind?: string;
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear immediately, so picking the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;

    startTransition(async () => {
      const fd = new FormData();
      fd.set("entityType", entityType);
      fd.set("entityId", entityId);
      fd.set("kind", kind);
      fd.set("file", file);
      const result = await uploadAttachment({ ok: false }, fd);
      toast(
        result.ok
          ? { kind: "success", title: result.message ?? "Uploaded" }
          : { kind: "error", title: "Could not upload", description: result.message },
      );
      if (result.ok) router.refresh();
    });
  }

  function onDelete(attachment: AttachmentRow) {
    setBusyId(attachment.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("attachmentId", attachment.id);
      const result = await deleteAttachment({ ok: false }, fd);
      setBusyId(null);
      toast(
        result.ok
          ? { kind: "success", title: result.message ?? "Removed" }
          : { kind: "error", title: "Could not remove", description: result.message },
      );
      if (result.ok) router.refresh();
    });
  }

  if (!attachments.length && !canUpload) return null;

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
        <CardHeader
          icon={<Paperclip className="size-4" />}
          title={title}
          description={
            description ??
            (attachments.length
              ? `${attachments.length} file${attachments.length === 1 ? "" : "s"} attached.`
              : "Nothing attached yet.")
          }
        />
        {canUpload ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={onPick}
              accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg"
            />
            <Button
              size="sm"
              variant="secondary"
              loading={pending && !busyId}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-3.5" />
              Upload
            </Button>
          </>
        ) : null}
      </div>

      {attachments.length ? (
        <ul className="divide-y divide-[hsl(var(--border))] border-t border-border-base">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3">
              <FileText className="size-4 shrink-0 text-content-subtle" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-content">{a.filename}</p>
                <p className="mt-0.5 text-[11.5px] text-content-subtle">
                  {formatBytes(a.sizeBytes)} · {a.uploadedBy} · {formatDate(a.createdAt)}
                </p>
              </div>
              <a
                href={a.href}
                className="rounded-lg p-1.5 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
                aria-label={`Download ${a.filename}`}
              >
                <Download className="size-4" />
              </a>
              {canDelete ? (
                <button
                  type="button"
                  disabled={busyId === a.id}
                  onClick={() => onDelete(a)}
                  className="rounded-lg p-1.5 text-content-subtle transition-colors hover:bg-[hsl(var(--tone-rose-bg))] hover:text-[hsl(var(--tone-rose))] disabled:opacity-50"
                  aria-label={`Remove ${a.filename}`}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
