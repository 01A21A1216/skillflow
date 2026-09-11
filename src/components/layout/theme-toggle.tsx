"use client";

import { Moon, Sun } from "lucide-react";

import { setTheme, useTheme } from "@/lib/browser-store";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const theme = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      {/* `null` until hydrated, so the server and client markup agree. */}
      {theme === null ? (
        <span className="size-[18px]" />
      ) : theme === "dark" ? (
        <Sun className="size-[18px]" />
      ) : (
        <Moon className="size-[18px]" />
      )}
    </Button>
  );
}
