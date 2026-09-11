import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "subtle";
type Size = "xs" | "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-brand-contrast shadow-sm hover:bg-brand-strong",
  secondary: "border border-border-strong bg-surface text-content hover:bg-surface-muted",
  subtle: "bg-surface-muted text-content hover:bg-[hsl(var(--border))]",
  ghost: "text-content-muted hover:bg-surface-muted hover:text-content",
};

const SIZES: Record<Size, string> = {
  xs: "h-7 gap-1.5 rounded-md px-2 text-xs",
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px]",
  md: "h-9 gap-2 rounded-lg px-3.5 text-sm",
};

/** An anchor that looks like a Button, without pulling in client JS. */
export function LinkButton({
  href,
  children,
  variant = "secondary",
  size = "md",
  className,
  title,
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center font-medium transition-colors select-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}
