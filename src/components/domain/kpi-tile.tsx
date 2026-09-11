import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { Tone } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { toneVars } from "@/components/ui/tone";
import { Delta } from "./badges";

export function KpiTile({
  label,
  value,
  hint,
  tone = "indigo",
  delta,
  deltaLabel,
  goodWhenUp = true,
  href,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  delta?: number;
  deltaLabel?: string;
  goodWhenUp?: boolean;
  href?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] leading-snug font-medium text-content-muted">{label}</p>
        <span
          style={toneVars(tone)}
          className="mt-1 size-2 shrink-0 rounded-full bg-[hsl(var(--tone))]"
          aria-hidden
        />
      </div>

      <div className="mt-2 flex items-end gap-2.5">
        {/* Proportional figures: a display-size number should not be tabular. */}
        <span className="text-[28px] leading-none font-semibold tracking-[-0.02em] text-content">
          {value}
        </span>
        {delta !== undefined ? (
          <Delta value={delta} goodWhenUp={goodWhenUp} className="mb-1" />
        ) : null}
      </div>

      {hint || deltaLabel ? (
        <p className="mt-2 text-[11.5px] leading-snug text-content-subtle">
          {hint}
          {delta !== undefined && deltaLabel ? (
            <span className="text-content-subtle"> · {deltaLabel}</span>
          ) : null}
        </p>
      ) : null}

      {children ? <div className="mt-3">{children}</div> : null}
    </>
  );

  const shell =
    "card group relative flex flex-col p-4 transition-shadow hover:shadow-[var(--shadow-raised)]";

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link href={href} className={cn(shell, "focus-visible:ring-2 focus-visible:ring-brand/40")}>
      {body}
      <ArrowUpRight className="absolute top-3.5 right-3.5 size-3.5 text-content-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

export function StatRow({
  stats,
  className,
}: {
  stats: { label: string; value: string; tone?: Tone }[];
  className?: string;
}) {
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-xl bg-border-base", className)}>
      {stats.map((s) => (
        <div key={s.label} className="bg-surface px-4 py-3">
          <p className="text-[11px] font-medium tracking-wide text-content-subtle uppercase">
            {s.label}
          </p>
          <p
            className={cn("mt-1 text-lg leading-none font-semibold text-content")}
            style={s.tone ? { color: `hsl(var(--tone-${s.tone}))` } : undefined}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}
