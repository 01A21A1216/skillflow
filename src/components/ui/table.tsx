import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <table className={cn("data-table w-full border-collapse text-sm", className)}>{children}</table>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "border-b border-border-base px-4 py-2.5 text-[11px] font-semibold tracking-[0.06em] text-content-subtle uppercase whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  /** For a full-width row, such as a group heading inside a table body. */
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "border-b border-border-base px-4 py-3 align-middle text-content",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <tr
      className={cn(
        "last:[&>td]:border-b-0",
        interactive && "transition-colors hover:bg-surface-muted",
        className,
      )}
    >
      {children}
    </tr>
  );
}
