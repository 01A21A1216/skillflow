import { cn, hashToIndex, initials } from "@/lib/utils";

const PALETTE = [
  "indigo",
  "violet",
  "blue",
  "cyan",
  "emerald",
  "amber",
  "orange",
  "rose",
  "slate",
] as const;

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
  xl: "size-16 text-lg",
} as const;

export function Avatar({
  name,
  size = "md",
  className,
  ring = false,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  ring?: boolean;
}) {
  const tone = PALETTE[hashToIndex(name, PALETTE.length)]!;
  return (
    <span
      title={name}
      style={{
        ["--tone" as string]: `var(--tone-${tone})`,
        ["--tone-bg" as string]: `var(--tone-${tone}-bg)`,
      }}
      className={cn(
        "tone-chip inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        SIZES[size],
        ring && "ring-2 ring-[hsl(var(--surface))]",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({
  names,
  max = 4,
  size = "sm",
}: {
  names: string[];
  max?: number;
  size?: keyof typeof SIZES;
}) {
  const shown = names.slice(0, max);
  const overflow = names.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((n) => (
        <Avatar key={n} name={n} size={size} ring />
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-surface-muted font-semibold text-content-muted ring-2 ring-[hsl(var(--surface))]",
            SIZES[size],
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

export function UserChip({
  name,
  meta,
  size = "sm",
  className,
}: {
  name: string;
  meta?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Avatar name={name} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] leading-tight font-medium text-content">
          {name}
        </span>
        {meta ? (
          <span className="block truncate text-[11px] leading-tight text-content-subtle">{meta}</span>
        ) : null}
      </span>
    </span>
  );
}
