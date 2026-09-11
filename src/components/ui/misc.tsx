"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn, clamp } from "@/lib/utils";
import type { Tone } from "@/lib/domain";
import { toneVars } from "./tone";

/* ------------------------------------------------------------------ *
 * Progress / meters
 * ------------------------------------------------------------------ */

export function Meter({
  value,
  max = 100,
  tone = "indigo",
  className,
  height = 6,
  label,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
  height?: number;
  label?: string;
}) {
  const pctValue = clamp(max ? (value / max) * 100 : 0, 0, 100);
  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-surface-muted", className)}
      style={{ height, ...toneVars(tone) }}
      role="progressbar"
      aria-valuenow={Math.round(pctValue)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-full bg-[hsl(var(--tone))] transition-[width] duration-500 ease-out"
        style={{ width: `${pctValue}%` }}
      />
    </div>
  );
}

/** Segmented bar — one slice per stage, used for pipeline composition. */
export function SegmentBar({
  segments,
  className,
  height = 8,
}: {
  segments: { label: string; value: number; tone: Tone }[];
  className?: string;
  height?: number;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (!total) {
    return (
      <div className={cn("w-full rounded-full bg-surface-muted", className)} style={{ height }} />
    );
  }
  return (
    <div className={cn("flex w-full overflow-hidden rounded-full", className)} style={{ height }}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, ...toneVars(s.tone) }}
            className="h-full bg-[hsl(var(--tone))] transition-all duration-500"
          />
        ))}
    </div>
  );
}

export function RatingStars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          className={cn(
            "size-3.5",
            n <= value ? "fill-[hsl(var(--tone-amber))]" : "fill-[hsl(var(--border-strong))]",
          )}
        >
          <path d="M10 1.6l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.2l-4.94 2.6.94-5.5-4-3.9 5.53-.8z" />
        </svg>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Tabs driven by the URL, so views are shareable and survive reloads
 * ------------------------------------------------------------------ */

export function LinkTabs({
  tabs,
  param = "tab",
  className,
}: {
  tabs: { value: string; label: string; count?: number }[];
  param?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(param) ?? tabs[0]?.value;

  return (
    <div
      className={cn("flex gap-1 overflow-x-auto border-b border-border-base", className)}
      role="tablist"
    >
      {tabs.map((t) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set(param, t.value);
        const isActive = active === t.value;
        return (
          <Link
            key={t.value}
            href={`${pathname}?${params.toString()}`}
            scroll={false}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
              isActive
                ? "border-brand text-content"
                : "border-transparent text-content-muted hover:border-border-strong hover:text-content",
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                  isActive ? "bg-brand-soft text-brand" : "bg-surface-muted text-content-subtle",
                )}
              >
                {t.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

/** Local (non-URL) tab strip for panes inside a page. */
export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex gap-0.5 rounded-lg bg-surface-muted p-0.5", className)}
      role="tablist"
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-[13px] font-medium transition-all",
            value === t.value
              ? "bg-surface text-content shadow-sm"
              : "text-content-muted hover:text-content",
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className="ml-1.5 tabular-nums opacity-60">{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Popover menu
 * ------------------------------------------------------------------ */

export function Menu({
  trigger,
  children,
  align = "right",
  className,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open ? (
        <div
          className={cn(
            "absolute z-40 mt-1.5 min-w-[13rem] animate-[slide-up_0.14s_ease-out] overflow-hidden rounded-xl border border-border-base bg-surface-raised p-1 shadow-[var(--shadow-pop)]",
            align === "right" ? "right-0" : "left-0",
            className,
          )}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  icon,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
        "disabled:pointer-events-none disabled:opacity-45",
        danger
          ? "text-[hsl(var(--tone-rose))] hover:bg-[hsl(var(--tone-rose-bg))]"
          : "text-content hover:bg-surface-muted",
      )}
    >
      {icon ? <span className="shrink-0 opacity-70">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
      {children}
    </div>
  );
}
