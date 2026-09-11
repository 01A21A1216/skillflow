"use client";

import { useState, type ReactNode } from "react";

import { useTheme } from "@/lib/browser-store";
import { Table2, BarChart3 } from "lucide-react";

import { cn } from "@/lib/utils";

export { SERIES, ORDINAL, GRID, AXIS, SURFACE } from "./palette";

import { AXIS as AXIS_TOKEN, FALLBACK, SURFACE as SURFACE_TOKEN } from "./palette";

export const AXIS_TICK = { fill: AXIS_TOKEN, fontSize: 11 } as const;

/* ------------------------------------------------------------------ *
 * Tooltip
 * ------------------------------------------------------------------ */

export function TooltipShell({
  title,
  rows,
  footer,
}: {
  title: ReactNode;
  rows: { label: string; value: ReactNode; color?: string }[];
  footer?: ReactNode;
}) {
  return (
    <div className="pointer-events-none min-w-[10rem] rounded-xl border border-border-base bg-surface-raised px-3 py-2.5 shadow-[var(--shadow-pop)]">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-content-subtle uppercase">
        {title}
      </p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2.5 text-[12.5px]">
            {r.color ? (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
                aria-hidden
              />
            ) : null}
            <span className="flex-1 text-content-muted">{r.label}</span>
            <span className="font-medium text-content tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
      {footer ? (
        <p className="mt-2 border-t border-border-base pt-1.5 text-[11px] text-content-subtle">
          {footer}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Legend — always present for two or more series
 * ------------------------------------------------------------------ */

export function Legend({
  items,
  className,
}: {
  items: { label: string; color: string }[];
  className?: string;
}) {
  if (items.length < 2) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[11.5px] text-content-muted">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: i.color }}
            aria-hidden
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Chart frame with a table fallback
 * ------------------------------------------------------------------ */

export function ChartFrame({
  title,
  description,
  legend,
  action,
  table,
  children,
  className,
  height,
}: {
  title: string;
  description?: string;
  legend?: { label: string; color: string }[];
  action?: ReactNode;
  /** Same numbers as the plot, for screen readers and low-contrast relief. */
  table?: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <figure className={cn("card flex flex-col p-5", className)}>
      <figcaption className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] leading-tight font-semibold text-content">{title}</h3>
          {description ? (
            <p className="mt-1 text-[12.5px] leading-snug text-content-muted">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {action}
          {table ? (
            <button
              onClick={() => setShowTable((v) => !v)}
              title={showTable ? "Show chart" : "Show the underlying numbers"}
              aria-label={showTable ? "Show chart" : "Show data table"}
              className="rounded-lg p-1.5 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
            >
              {showTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
            </button>
          ) : null}
        </div>
      </figcaption>

      {legend && legend.length > 1 ? <Legend items={legend} className="mb-3" /> : null}

      {showTable && table ? (
        <div className="-mx-1 overflow-x-auto" style={height ? { maxHeight: height + 40 } : undefined}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th
                    key={c}
                    className={cn(
                      "border-b border-border-base px-2 py-1.5 text-[11px] font-semibold tracking-wide text-content-subtle uppercase",
                      i === 0 ? "text-left" : "text-right",
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "border-b border-border-base px-2 py-1.5 last:border-b-0",
                        ci === 0 ? "text-content" : "text-right text-content-muted tabular-nums",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="min-w-0 flex-1" style={height ? { height } : undefined}>
          {children}
        </div>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Stat tile — when the answer is a single number, not a plot
 * ------------------------------------------------------------------ */

export function Sparkline({
  values,
  color = "var(--chart-1)",
  width = 96,
  height = 28,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2]);
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x!.toFixed(1)} ${y!.toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke={SURFACE_TOKEN} strokeWidth={2} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Token resolution
 *
 * SVG presentation attributes (fill="…", stroke="…") do NOT support
 * `var()` — only CSS declarations do. Recharts writes colours as
 * attributes, so the `var(--chart-n)` tokens have to be resolved to real
 * values on the client. This hook does that and re-resolves whenever the
 * theme class on <html> changes, so charts follow light/dark correctly.
 * ------------------------------------------------------------------ */

const TOKEN = /^var\((--[\w-]+)\)$/;

export function useChartPalette() {
  // `null` until hydrated, and it changes whenever the theme class flips, so
  // charts re-resolve their colours without an effect or a mount cascade.
  const theme = useTheme();
  const mounted = theme !== null;

  const resolve = (token: string) => {
    const match = TOKEN.exec(token);
    if (!match) return token;
    const name = match[1]!;
    const computed = mounted
      ? getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      : "";
    return computed || FALLBACK[name] || token;
  };

  return { resolve, mounted };
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <div className="skeleton w-full" style={{ height }} aria-hidden />;
}
