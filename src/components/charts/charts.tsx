"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn, formatNumber, truncate } from "@/lib/utils";
import { ChartSkeleton, TooltipShell, useChartPalette } from "./primitives";
import { AXIS, GRID, SERIES, SURFACE, ordinalStep } from "./palette";

const MARGIN = { top: 8, right: 8, bottom: 0, left: -14 };

export interface LineSeries {
  key: string;
  label: string;
  color: string;
}

/**
 * Charts accept any row shape. `object[]` keeps typed query results (which have
 * no index signature) assignable without forcing every caller to widen.
 */
export type Row = Record<string, string | number>;
const rows = (data: readonly object[]) => data as Row[];

/**
 * Extra tooltip lines, declared as data rather than a render callback — a
 * function prop cannot cross the server/client boundary, and these charts are
 * mostly rendered from server components.
 */
export interface TooltipField {
  key: string;
  label: string;
  suffix?: string;
}

function extraRows(fields: TooltipField[] | undefined, row: Row) {
  return (fields ?? []).map((f) => ({
    label: f.label,
    value: `${row[f.key] ?? "—"}${f.suffix ?? ""}`,
  }));
}

type Resolve = (token: string) => string;

const axisTick = (resolve: Resolve) => ({ fill: resolve(AXIS), fontSize: 11 });
const numberTick = (v: number) => formatNumber(v);

/* ------------------------------------------------------------------ *
 * Multi-series line — one axis, 2px strokes, hover crosshair
 * ------------------------------------------------------------------ */

export function TrendLines({
  data,
  series,
  xKey = "label",
  height = 240,
  valueSuffix = "",
}: {
  data: readonly object[];
  series: LineSeries[];
  xKey?: string;
  height?: number;
  valueSuffix?: string;
}) {
  const { resolve, mounted } = useChartPalette();
  if (!mounted) return <ChartSkeleton height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={MARGIN}>
        <CartesianGrid stroke={resolve(GRID)} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={{ stroke: resolve(GRID) }}
        />
        <YAxis
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={numberTick}
        />
        <Tooltip
          cursor={{ stroke: resolve(AXIS), strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipShell
                title={String(label)}
                rows={payload.map((p) => ({
                  label: series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey),
                  value: `${formatNumber(Number(p.value))}${valueSuffix}`,
                  color: String(p.color),
                }))}
              />
            ) : null
          }
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={resolve(s.color)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4, fill: resolve(s.color), stroke: resolve(SURFACE), strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ *
 * Single-series area — a wash, never a saturated block
 * ------------------------------------------------------------------ */

export function TrendArea({
  data,
  dataKey,
  label,
  color = SERIES[0],
  xKey = "label",
  height = 200,
  valueSuffix = "",
}: {
  data: readonly object[];
  dataKey: string;
  label: string;
  color?: string;
  xKey?: string;
  height?: number;
  valueSuffix?: string;
}) {
  const { resolve, mounted } = useChartPalette();
  if (!mounted) return <ChartSkeleton height={height} />;

  const hue = resolve(color);
  const gradientId = `wash-${dataKey}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={MARGIN}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity={0.16} />
            <stop offset="100%" stopColor={hue} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={resolve(GRID)} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={{ stroke: resolve(GRID) }}
        />
        <YAxis
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={numberTick}
        />
        <Tooltip
          cursor={{ stroke: resolve(AXIS), strokeWidth: 1 }}
          content={({ active, payload, label: x }) =>
            active && payload?.length ? (
              <TooltipShell
                title={String(x)}
                rows={[
                  {
                    label,
                    value: `${formatNumber(Number(payload[0]!.value))}${valueSuffix}`,
                    color: hue,
                  },
                ]}
              />
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={hue}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 4, fill: hue, stroke: resolve(SURFACE), strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ *
 * Columns — one series, one colour; ordered categories get the ramp
 * ------------------------------------------------------------------ */

export function Columns({
  data,
  dataKey,
  label,
  xKey = "label",
  height = 220,
  ordinal = false,
  color = SERIES[0],
  valueSuffix = "",
  tooltipFields,
}: {
  data: readonly object[];
  dataKey: string;
  label: string;
  xKey?: string;
  height?: number;
  /** Use the single-hue ramp because the categories have a natural order. */
  ordinal?: boolean;
  color?: string;
  valueSuffix?: string;
  tooltipFields?: TooltipField[];
}) {
  const { resolve, mounted } = useChartPalette();
  if (!mounted) return <ChartSkeleton height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={MARGIN} barCategoryGap="22%">
        <CartesianGrid stroke={resolve(GRID)} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={{ stroke: resolve(GRID) }}
          interval={0}
        />
        <YAxis
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={numberTick}
        />
        <Tooltip
          cursor={{ fill: resolve(GRID), fillOpacity: 0.45 }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipShell
                title={String((payload[0]!.payload as Row)[xKey])}
                rows={[
                  {
                    label,
                    value: `${formatNumber(Number(payload[0]!.value))}${valueSuffix}`,
                    color: String(payload[0]!.color ?? resolve(color)),
                  },
                  ...extraRows(tooltipFields, payload[0]!.payload as Row),
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} maxBarSize={24}>
          {rows(data).map((_, i) => (
            <Cell
              key={i}
              fill={resolve(ordinal ? ordinalStep(i, rows(data).length) : color)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontal bars — good for long category names
 * ------------------------------------------------------------------ */

export function HorizontalBars({
  data,
  dataKey,
  label,
  yKey = "label",
  height = 260,
  color = SERIES[0],
  ordinal = false,
  valueSuffix = "",
  tooltipFields,
  yWidth = 140,
  maxLabel = 22,
}: {
  data: readonly object[];
  dataKey: string;
  label: string;
  yKey?: string;
  height?: number;
  color?: string;
  ordinal?: boolean;
  valueSuffix?: string;
  tooltipFields?: TooltipField[];
  yWidth?: number;
  /** Axis labels longer than this are clipped; the tooltip keeps the full text. */
  maxLabel?: number;
}) {
  const { resolve, mounted } = useChartPalette();
  if (!mounted) return <ChartSkeleton height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 28, bottom: 0, left: 0 }}
        barCategoryGap="24%"
      >
        <CartesianGrid stroke={resolve(GRID)} strokeWidth={1} horizontal={false} />
        <XAxis
          type="number"
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={{ stroke: resolve(GRID) }}
          tickFormatter={numberTick}
        />
        <YAxis
          type="category"
          dataKey={yKey}
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={false}
          width={yWidth}
          tickFormatter={(v: string) => truncate(String(v), maxLabel)}
        />
        <Tooltip
          cursor={{ fill: resolve(GRID), fillOpacity: 0.45 }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipShell
                title={String((payload[0]!.payload as Row)[yKey])}
                rows={[
                  {
                    label,
                    value: `${formatNumber(Number(payload[0]!.value))}${valueSuffix}`,
                    color: String(payload[0]!.color ?? resolve(color)),
                  },
                  ...extraRows(tooltipFields, payload[0]!.payload as Row),
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {rows(data).map((_, i) => (
            <Cell
              key={i}
              fill={resolve(ordinal ? ordinalStep(i, rows(data).length) : color)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ *
 * Stacked columns — 2px surface gap between segments
 * ------------------------------------------------------------------ */

export function StackedColumns({
  data,
  series,
  xKey = "label",
  height = 240,
}: {
  data: readonly object[];
  series: LineSeries[];
  xKey?: string;
  height?: number;
}) {
  const { resolve, mounted } = useChartPalette();
  if (!mounted) return <ChartSkeleton height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={MARGIN} barCategoryGap="26%">
        <CartesianGrid stroke={resolve(GRID)} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={{ stroke: resolve(GRID) }}
        />
        <YAxis
          tick={axisTick(resolve)}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={numberTick}
        />
        <Tooltip
          cursor={{ fill: resolve(GRID), fillOpacity: 0.45 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipShell
                title={String(label)}
                rows={[...payload].reverse().map((p) => ({
                  label: series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey),
                  value: formatNumber(Number(p.value)),
                  color: String(p.color),
                }))}
                footer={`Total ${formatNumber(
                  payload.reduce((sum, p) => sum + Number(p.value ?? 0), 0),
                )}`}
              />
            ) : null
          }
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="a"
            fill={resolve(s.color)}
            maxBarSize={24}
            // A surface-coloured stroke is the 2px gap between segments.
            stroke={resolve(SURFACE)}
            strokeWidth={2}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ *
 * Small multiples — the right answer when series share an x-axis but
 * differ by an order of magnitude. One shared scale would flatten the
 * small series; a second y-axis would invent a correlation.
 * ------------------------------------------------------------------ */

export function SmallMultiples({
  data,
  series,
  xKey = "label",
  height = 84,
  className,
}: {
  data: readonly object[];
  series: LineSeries[];
  xKey?: string;
  height?: number;
  className?: string;
}) {
  const { resolve, mounted } = useChartPalette();
  const source = rows(data);

  return (
    <div className={cn("grid gap-x-6 gap-y-5 sm:grid-cols-2", className)}>
      {series.map((s) => {
        const values = source.map((d) => Number(d[s.key] ?? 0));
        const max = Math.max(...values, 1);
        const latest = values[values.length - 1] ?? 0;
        const previous = values[values.length - 2] ?? 0;
        const total = values.reduce((sum, v) => sum + v, 0);
        const hue = resolve(s.color);

        return (
          <div key={s.key} className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="truncate text-[12px] text-content-muted">{s.label}</span>
              </span>
              <span className="shrink-0 text-[15px] leading-none font-semibold text-content">
                {formatNumber(latest)}
              </span>
            </div>

            {mounted ? (
              <ResponsiveContainer width="100%" height={height}>
                <AreaChart data={source} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                  <defs>
                    <linearGradient id={`sm-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={hue} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={hue} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey={xKey} hide />
                  <YAxis hide domain={[0, max]} />
                  <Tooltip
                    cursor={{ stroke: resolve(AXIS), strokeWidth: 1 }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <TooltipShell
                          title={String(label)}
                          rows={[
                            {
                              label: s.label,
                              value: formatNumber(Number(payload[0]!.value)),
                              color: hue,
                            },
                          ]}
                          footer={`Peak ${formatNumber(max)} over the window`}
                        />
                      ) : null
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey={s.key}
                    stroke={hue}
                    strokeWidth={2}
                    fill={`url(#sm-${s.key})`}
                    activeDot={{ r: 4, fill: hue, stroke: resolve(SURFACE), strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartSkeleton height={height} />
            )}

            <p className="mt-1 text-[11px] text-content-subtle tabular-nums">
              {formatNumber(total)} total · peak {formatNumber(max)}
              {previous
                ? ` · ${latest >= previous ? "+" : ""}${formatNumber(latest - previous)} vs prior month`
                : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Funnel — an ordered set of stages, so it wears the ordinal ramp.
 * Built from divs rather than SVG, so `var()` resolves directly.
 * ------------------------------------------------------------------ */

export function FunnelBars({
  steps,
  className,
}: {
  steps: { label: string; count: number; stepConversion: number; overallConversion: number }[];
  className?: string;
}) {
  const top = steps[0]?.count ?? 0;

  return (
    <ol className={cn("space-y-2.5", className)}>
      {steps.map((s, i) => {
        const width = top ? Math.max((s.count / top) * 100, 1.5) : 0;
        const hue = ordinalStep(i, steps.length);
        return (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 text-[13px] font-medium text-content">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: hue }}
                  aria-hidden
                />
                {s.label}
              </span>
              <span className="flex items-baseline gap-2.5 text-[12px] text-content-muted tabular-nums">
                <span className="font-semibold text-content">{formatNumber(s.count)}</span>
                {i > 0 ? (
                  <span title="Conversion from the previous stage">
                    {Math.round(s.stepConversion)}%
                  </span>
                ) : null}
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
              title={`${s.label}: ${formatNumber(s.count)} (${Math.round(s.overallConversion)}% of everyone sourced)`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${width}%`, backgroundColor: hue }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
