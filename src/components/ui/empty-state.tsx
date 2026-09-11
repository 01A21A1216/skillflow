import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <span className="flex size-11 items-center justify-center rounded-xl bg-surface-muted text-content-subtle">
          {icon}
        </span>
      ) : null}
      <div>
        <p className="text-sm font-semibold text-content">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-content-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
