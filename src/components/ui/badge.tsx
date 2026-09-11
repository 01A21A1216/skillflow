import type { ReactNode } from "react";
import type { Tone } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { toneVars } from "./tone";

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  size?: "sm" | "md";
  variant?: "soft" | "outline" | "solid";
}

export function Badge({
  tone = "neutral",
  children,
  className,
  dot = false,
  size = "sm",
  variant = "soft",
}: BadgeProps) {
  return (
    <span
      style={toneVars(tone)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        variant === "soft" && "tone-chip",
        variant === "outline" &&
          "border border-[hsl(var(--tone)/0.35)] text-[hsl(var(--tone))]",
        variant === "solid" && "bg-[hsl(var(--tone))] text-white",
        className,
      )}
    >
      {dot ? (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            variant === "solid" ? "bg-white/80" : "bg-[hsl(var(--tone))]",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  return (
    <span
      style={toneVars(tone)}
      className={cn("inline-block size-2 shrink-0 rounded-full bg-[hsl(var(--tone))]", className)}
    />
  );
}

/** Small uppercase label used above values in cards and detail panes. */
export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "text-[10.5px] font-semibold tracking-[0.08em] text-content-subtle uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}
