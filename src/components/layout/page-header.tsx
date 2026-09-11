import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  meta,
  tabs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
  meta?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("border-b border-border-base bg-surface", className)}>
      <div className="px-4 pt-5 sm:px-6">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[12px]">
            {breadcrumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 ? <ChevronRight className="size-3 text-content-subtle" /> : null}
                {c.href ? (
                  <Link
                    href={c.href}
                    className="text-content-muted transition-colors hover:text-content"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-content-subtle">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          {/* A minimum width forces the actions onto their own line on narrow
              screens instead of squeezing the title into a two-word column. */}
          <div className="min-w-[min(100%,15rem)] flex-1">
            <h1 className="text-xl leading-tight font-semibold tracking-[-0.01em] text-content sm:text-[22px]">
              {title}
            </h1>
            {description ? (
              <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-content-muted">
                {description}
              </p>
            ) : null}
            {meta ? <div className="mt-3">{meta}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </div>

      {tabs ? <div className="mt-4 px-4 sm:px-6">{tabs}</div> : <div className="h-5" />}
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-5 px-4 py-5 sm:px-6", className)}>{children}</div>;
}
