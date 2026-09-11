import type { CSSProperties } from "react";
import type { Tone } from "@/lib/domain";

/**
 * Every coloured element resolves its palette through these two custom
 * properties, so a badge, a dot and a chart series with the same tone are
 * guaranteed to be the same colour in both themes.
 */
export function toneVars(tone: Tone): CSSProperties {
  return {
    ["--tone" as string]: `var(--tone-${tone})`,
    ["--tone-bg" as string]: `var(--tone-${tone}-bg)`,
  };
}

export function toneColor(tone: Tone) {
  return `hsl(var(--tone-${tone}))`;
}

export function toneBg(tone: Tone) {
  return `hsl(var(--tone-${tone}-bg))`;
}
