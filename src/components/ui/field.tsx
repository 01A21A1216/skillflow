import { forwardRef } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-content transition-colors " +
  "placeholder:text-content-subtle hover:border-[hsl(var(--text-subtle))] " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, "h-9", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea ref={ref} className={cn(CONTROL, "min-h-[84px] py-2 leading-relaxed", className)} {...props} />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(CONTROL, "h-9 cursor-pointer appearance-none pr-8", className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-content-subtle" />
      </div>
    );
  },
);

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="flex items-baseline gap-1 text-[13px] font-medium text-content">
        {label}
        {required ? <span className="text-[hsl(var(--tone-rose))]">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-[hsl(var(--tone-rose))]">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-content-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

export function Fieldset({
  legend,
  children,
  className,
}: {
  legend: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-content-subtle uppercase">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-[13px] text-content", className)}>
      <input
        type="checkbox"
        className="size-4 shrink-0 cursor-pointer rounded border-border-strong accent-[hsl(var(--brand))]"
        {...props}
      />
      {label}
    </label>
  );
}
