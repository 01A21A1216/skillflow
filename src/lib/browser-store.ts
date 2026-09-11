"use client";

import { useSyncExternalStore } from "react";

/**
 * Browser-only state (the theme class, a localStorage preference) read through
 * `useSyncExternalStore` rather than `useState` + `useEffect`.
 *
 * This is the pattern React actually wants for external stores: the server
 * snapshot is `null`, so the first client render matches the server exactly and
 * there is no hydration mismatch, and the value updates on real events instead
 * of a cascading render after mount.
 */

function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/** `"dark"` | `"light"` once hydrated; `null` on the server and during hydration. */
export function useTheme(): "dark" | "light" | null {
  return useSyncExternalStore(
    subscribeToThemeClass,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => null,
  );
}

export function setTheme(next: "dark" | "light") {
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem("rcc-theme", next);
  } catch {
    /* private mode — the class still applies for this session */
  }
}

/* ------------------------------------------------------------------ *
 * localStorage-backed flags
 * ------------------------------------------------------------------ */

const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function useLocalFlag(key: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const set = listeners.get(key) ?? new Set();
      set.add(onChange);
      listeners.set(key, set);
      window.addEventListener("storage", onChange);
      return () => {
        set.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    () => null,
  );
}

export function setLocalFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
  notify(key);
}

/* ------------------------------------------------------------------ *
 * Hydration
 * ------------------------------------------------------------------ */

const noopSubscribe = () => () => {};

/**
 * `false` on the server and for the hydrating render, `true` afterwards.
 *
 * Anything that renders into a portal must wait for this: `document` does not
 * exist on the server, so a portal that opens on the first render produces a
 * tree the server never emitted, and React throws a hydration mismatch.
 */
export function useIsHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
