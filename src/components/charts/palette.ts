/**
 * Chart palette tokens.
 *
 * Deliberately NOT a "use client" module: server components read these values
 * to build series definitions, and a client module's exports reach the server
 * as client references rather than real values.
 *
 * `SERIES` is the validated 8-hue categorical order — hues are assigned by slot
 * and never cycled or re-assigned by rank, so a series keeps its colour when a
 * reader filters the chart. `ORDINAL` is a single-hue blue ramp for ordered
 * categories (funnel stages, age bands). Both were checked with the palette
 * validator against the light and dark chart surfaces rather than by eye.
 */

export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

export const ORDINAL = [
  "var(--ord-1)",
  "var(--ord-2)",
  "var(--ord-3)",
  "var(--ord-4)",
  "var(--ord-5)",
  "var(--ord-6)",
] as const;

/**
 * Pick the ordinal step for item `i` of `n`.
 *
 * The ramp has six validated steps; an ordered category list can be longer
 * (eleven pipeline stages). Spreading the list across the ramp keeps the
 * light-to-dark reading of order and introduces no unvalidated colour, which
 * clamping to the darkest step would have destroyed — everything past the sixth
 * bar would have been identical.
 */
export function ordinalStep(i: number, n: number) {
  if (n <= 1) return ORDINAL[ORDINAL.length - 1]!;
  const slot = Math.round((i / (n - 1)) * (ORDINAL.length - 1));
  return ORDINAL[Math.min(Math.max(slot, 0), ORDINAL.length - 1)]!;
}

export const GRID = "var(--chart-grid)";
export const AXIS = "var(--chart-axis)";
export const SURFACE = "var(--chart-surface)";

/**
 * Light-mode values, used for the first paint before the client can read the
 * computed custom properties off the document.
 */
export const FALLBACK: Record<string, string> = {
  "--chart-1": "#2a78d6",
  "--chart-2": "#eb6834",
  "--chart-3": "#1baf7a",
  "--chart-4": "#eda100",
  "--chart-5": "#e87ba4",
  "--chart-6": "#008300",
  "--chart-7": "#4a3aa7",
  "--chart-8": "#e34948",
  "--ord-1": "#8bb6eb",
  "--ord-2": "#639de2",
  "--ord-3": "#3883d9",
  "--ord-4": "#0069c9",
  "--ord-5": "#0051a9",
  "--ord-6": "#003c80",
  "--chart-grid": "#e2e8f0",
  "--chart-axis": "#8a94a6",
  "--chart-surface": "#ffffff",
};
