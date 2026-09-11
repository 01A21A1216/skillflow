"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Briefcase, Loader2, Search, User, UsersRound } from "lucide-react";

import type { SearchHit } from "@/app/api/search/route";
import { cn } from "@/lib/utils";
import { useIsHydrated } from "@/lib/browser-store";

const ICONS = {
  requisition: Briefcase,
  candidate: User,
  person: UsersRound,
} as const;

const KIND_LABEL = {
  requisition: "Requisition",
  candidate: "Candidate",
  person: "Team",
} as const;

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hydrated = useIsHydrated();

  // Cmd/Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setTerm("");
    setHits([]);
    setCursor(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  // Debounced fetch; an AbortController keeps results in order.
  const tooShort = term.trim().length < 2;

  useEffect(() => {
    if (tooShort) return;
    const controller = new AbortController();
    // The spinner turns on when the debounce actually fires, not on every
    // keystroke — which also keeps setState out of the effect body.
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits);
        setCursor(0);
      } catch {
        /* aborted or offline — keep the previous results */
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term, tooShort]);

  const go = useCallback(
    (hit: SearchHit) => {
      close();
      router.push(hit.href);
    },
    [router, close],
  );

  const results = tooShort ? [] : hits;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    }
    if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      go(results[cursor]);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex h-9 w-full max-w-sm items-center gap-2.5 rounded-lg border border-border-base bg-surface-muted px-3 text-left text-[13px] text-content-subtle transition-colors hover:border-border-strong"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate">Search requisitions, candidates, people…</span>
        <kbd className="hidden shrink-0 rounded border border-border-strong bg-surface px-1.5 py-0.5 font-sans text-[10px] text-content-subtle sm:block">
          ⌘K
        </kbd>
      </button>

      {open && hydrated
        ? createPortal(
            <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
              <div
                className="fixed inset-0 bg-[hsl(var(--overlay)/0.55)] backdrop-blur-[2px]"
                onClick={close}
                aria-hidden
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Search"
                className="relative w-full max-w-xl animate-[slide-up_0.18s_cubic-bezier(0.22,1,0.36,1)] overflow-hidden rounded-2xl border border-border-base bg-surface shadow-[var(--shadow-pop)]"
              >
                <div className="flex items-center gap-3 border-b border-border-base px-4">
                  <Search className="size-4 shrink-0 text-content-subtle" />
                  <input
                    ref={inputRef}
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search by name, title, requisition code, client…"
                    className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-content-subtle"
                  />
                  {loading ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-content-subtle" />
                  ) : null}
                </div>

                <div className="max-h-[52vh] overflow-y-auto p-1.5">
                  {tooShort ? (
                    <p className="px-3 py-8 text-center text-[13px] text-content-subtle">
                      Type at least two characters to search.
                    </p>
                  ) : results.length === 0 && !loading ? (
                    <p className="px-3 py-8 text-center text-[13px] text-content-subtle">
                      Nothing matched “{term}”.
                    </p>
                  ) : (
                    results.map((hit, i) => {
                      const Icon = ICONS[hit.kind];
                      return (
                        <button
                          key={`${hit.kind}-${hit.id}`}
                          onClick={() => go(hit)}
                          onMouseEnter={() => setCursor(i)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                            i === cursor ? "bg-surface-muted" : "hover:bg-surface-muted",
                          )}
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-content-muted">
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{hit.title}</span>
                            <span className="block truncate text-[11.5px] text-content-subtle">
                              {hit.subtitle}
                            </span>
                          </span>
                          <span className="shrink-0 text-[10.5px] tracking-wide text-content-subtle uppercase">
                            {hit.meta ?? KIND_LABEL[hit.kind]}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center gap-4 border-t border-border-base bg-surface-muted/60 px-4 py-2 text-[11px] text-content-subtle">
                  <span>↑↓ to navigate</span>
                  <span>↵ to open</span>
                  <span>esc to close</span>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
