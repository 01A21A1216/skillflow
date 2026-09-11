import { FileQuestion } from "lucide-react";

import { LinkButton } from "@/components/ui/link-button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-surface-muted text-content-subtle">
          <FileQuestion className="size-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-content">We could not find that</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-content-muted">
          The requisition, candidate or record you were looking for no longer exists, or the link
          was mistyped.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <LinkButton href="/" variant="primary" size="sm">
            Back to the dashboard
          </LinkButton>
          <LinkButton href="/requisitions" size="sm">
            Browse requisitions
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
