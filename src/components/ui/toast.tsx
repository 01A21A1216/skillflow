"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { Tone } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { toneVars } from "./tone";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

const TONE: Record<ToastKind, Tone> = {
  success: "emerald",
  error: "rose",
  info: "blue",
};

const ICON = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const ToastContext = createContext<{
  toast: (t: Omit<Toast, "id">) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.kind === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div
              key={t.id}
              style={toneVars(TONE[t.kind])}
              className={cn(
                "pointer-events-auto flex animate-[slide-up_0.2s_cubic-bezier(0.22,1,0.36,1)] items-start gap-3",
                "rounded-xl border border-border-base bg-surface-raised p-3.5 shadow-[var(--shadow-pop)]",
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-[hsl(var(--tone))]" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-tight font-semibold text-content">{t.title}</p>
                {t.description ? (
                  <p className="mt-1 text-xs leading-snug text-content-muted">{t.description}</p>
                ) : null}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded p-0.5 text-content-subtle transition-colors hover:text-content"
                aria-label="Dismiss notification"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}
