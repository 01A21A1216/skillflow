import { Pin } from "lucide-react";

import type { Note, User } from "@/db/schema";
import { cn, relativeTime } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";

export function NotesList({
  notes,
  className,
  emptyLabel = "No notes yet",
}: {
  notes: { note: Note; author: User }[];
  className?: string;
  emptyLabel?: string;
}) {
  if (!notes.length) {
    return (
      <EmptyState
        compact
        title={emptyLabel}
        description="Notes you add here are visible to everyone working this requisition."
      />
    );
  }

  return (
    <ul className={cn("space-y-3", className)}>
      {notes.map(({ note, author }) => (
        <li
          key={note.id}
          className={cn(
            "rounded-lg border p-3",
            note.pinned
              ? "border-[hsl(var(--tone-amber)/0.35)] bg-[hsl(var(--tone-amber-bg)/0.4)]"
              : "border-border-base bg-surface-muted/40",
          )}
        >
          <div className="flex items-center gap-2">
            <Avatar name={author.name} size="xs" />
            <span className="text-[12px] font-medium text-content">{author.name}</span>
            <span className="text-[11px] text-content-subtle">
              {relativeTime(note.createdAt)}
            </span>
            {note.pinned ? (
              <Pin className="ml-auto size-3 text-[hsl(var(--tone-amber))]" aria-label="Pinned" />
            ) : null}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-content">{note.body}</p>
        </li>
      ))}
    </ul>
  );
}
