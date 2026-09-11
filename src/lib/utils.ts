import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DAY = 86_400_000;

export function toDate(value: Date | number | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a: Date | number | string, b: Date | number | string = Date.now()) {
  const from = toDate(a);
  const to = toDate(b);
  if (!from || !to) return 0;
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}

export function formatMoney(
  amount: number | null | undefined,
  currency = "USD",
  opts: { compact?: boolean } = {},
) {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    notation: opts.compact ? "compact" : "standard",
  }).format(amount);
}

export function formatRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency = "USD",
) {
  if (min == null && max == null) return "—";
  if (min != null && max != null) {
    return `${formatMoney(min, currency, { compact: true })} – ${formatMoney(max, currency, { compact: true })}`;
  }
  return formatMoney(min ?? max, currency, { compact: true });
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number, digits = 0) {
  return `${formatNumber(value, digits)}%`;
}

export function formatDate(value: Date | number | string | null | undefined, withYear = true) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/**
 * A `YYYY-MM` month, as "Mar 2024".
 *
 * Work history is stored to the month, not the day, because that is what a CV
 * actually says — parsing it into a full date would invent precision.
 */
/**
 * A `datetime-local` input value for a given instant, in the *viewer's* zone.
 *
 * `toISOString()` would hand back UTC and the field would show the wrong hour
 * for everyone outside London.
 */
export function isoDateTimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatMonth(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Bytes as the shortest human-readable unit, e.g. "1.4 MB". */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDateTime(value: Date | number | string | null | undefined) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(value: Date | number | string | null | undefined) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function relativeTime(value: Date | number | string | null | undefined) {
  const d = toDate(value);
  if (!d) return "—";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < DAY * 30) return rtf.format(Math.round(diff / DAY), "day");
  if (abs < DAY * 365) return rtf.format(Math.round(diff / (DAY * 30)), "month");
  return rtf.format(Math.round(diff / (DAY * 365)), "year");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function fullName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function pct(part: number, whole: number) {
  if (!whole) return 0;
  return (part / whole) * 100;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    (acc[k] ??= []).push(item);
    return acc;
  }, {});
}

export function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

/** Deterministic slot for avatar colouring. */
export function hashToIndex(input: string, buckets: number) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % buckets;
}

export function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function isoDate(value: Date | number | string) {
  return (toDate(value) ?? new Date()).toISOString().slice(0, 10);
}

/** Turn a URLSearchParams-ish record into a clean query string. */
export function buildQuery(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === "all") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
