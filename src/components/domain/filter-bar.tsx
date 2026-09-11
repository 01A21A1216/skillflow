"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";

export interface FilterDef {
  /** Query-string key. */
  name: string;
  label: string;
  options: { value: string; label: string }[];
  /** Label for the "no filter" option. Defaults to `All <label>`. */
  allLabel?: string;
  width?: string;
}

/**
 * Filters live in the URL: every view is shareable, survives a reload, and the
 * back button behaves the way people expect.
 */
export function FilterBar({
  filters,
  searchKey = "q",
  searchPlaceholder = "Search…",
  right,
  className,
}: {
  filters: FilterDef[];
  searchKey?: string | null;
  searchPlaceholder?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentTerm = searchKey ? (searchParams.get(searchKey) ?? "") : "";
  const [term, setTerm] = useState(currentTerm);

  // When the URL changes from elsewhere (the Clear button, the back button),
  // pull the input back in line. Adjusting during render is the supported
  // alternative to a sync-in-effect, and avoids the extra commit.
  const [syncedTerm, setSyncedTerm] = useState(currentTerm);
  if (currentTerm !== syncedTerm) {
    setSyncedTerm(currentTerm);
    setTerm(currentTerm);
  }

  const apply = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === "all") params.delete(key);
        else params.set(key, value);
      }
      // Any filter change resets pagination.
      params.delete("page");
      const qs = params.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Debounce the text box so we are not navigating on every keystroke.
  useEffect(() => {
    if (!searchKey || term === currentTerm) return;
    const t = window.setTimeout(() => apply({ [searchKey]: term || null }), 260);
    return () => window.clearTimeout(t);
  }, [term, currentTerm, searchKey, apply]);

  const activeCount = filters.filter((f) => {
    const v = searchParams.get(f.name);
    return v && v !== "all";
  }).length;
  const hasSearch = Boolean(currentTerm);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {searchKey ? (
        <div className="relative min-w-[13rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-content-subtle" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-border-strong bg-surface pr-8 pl-8 text-[13px] transition-colors placeholder:text-content-subtle hover:border-[hsl(var(--text-subtle))] focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none"
          />
          {term ? (
            <button
              onClick={() => setTerm("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-content-subtle hover:text-content"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {filters.map((f) => {
        const value = searchParams.get(f.name) ?? "all";
        const active = value !== "all";
        return (
          <Select
            key={f.name}
            aria-label={f.label}
            value={value}
            onChange={(e) => apply({ [f.name]: e.target.value })}
            className={cn(
              "h-9 text-[13px]",
              f.width ?? "w-auto min-w-[8.5rem]",
              active && "border-brand/60 bg-brand-soft text-brand",
            )}
          >
            <option value="all">{f.allLabel ?? `All ${f.label.toLowerCase()}`}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      })}

      {activeCount > 0 || hasSearch ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTerm("");
            apply(
              Object.fromEntries([
                ...filters.map((f) => [f.name, null] as const),
                ...(searchKey ? [[searchKey, null] as const] : []),
              ]),
            );
          }}
        >
          <X className="size-3.5" />
          Clear
        </Button>
      ) : null}

      {pending ? <Loader2 className="size-4 animate-spin text-content-subtle" /> : null}

      {right ? <div className="ml-auto flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** Standalone sort control that writes to the `sort` query key. */
export function SortSelect({
  options,
  name = "sort",
  defaultValue,
}: {
  options: { value: string; label: string }[];
  name?: string;
  defaultValue: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <Select
      aria-label="Sort by"
      value={searchParams.get(name) ?? defaultValue}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set(name, e.target.value);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      className="h-9 w-auto min-w-[9.5rem] text-[13px]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
