"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "30", label: "30d" },
  { value: "90", label: "Quarter" },
  { value: "180", label: "6 months" },
  { value: "365", label: "12 months" },
  { value: "all", label: "All time" },
];

export function PeriodPicker({ param = "period" }: { param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? "180";

  return (
    <div
      className="inline-flex gap-0.5 rounded-lg bg-surface-muted p-0.5"
      role="group"
      aria-label="Reporting period"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          aria-pressed={current === o.value}
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString());
            params.set(param, o.value);
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-all",
            current === o.value
              ? "bg-surface text-content shadow-sm"
              : "text-content-muted hover:text-content",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
