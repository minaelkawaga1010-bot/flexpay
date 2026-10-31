"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ThemeToggle — light/dark switch built on the app's existing
 * next-themes provider (see components/providers.tsx, which sets
 * attribute="class" + persistence). We deliberately do NOT introduce a
 * second theme context: next-themes already owns the `dark` class on
 * <html>, system-preference detection, and localStorage persistence.
 * A parallel ThemeContext would create two writers for the same class
 * and desync on reload — so this component is a thin, accessible
 * controller over the single source of truth.
 *
 * Hydration: next-themes resolves the theme only on the client, so we
 * gate the icon swap behind a `mounted` flag to avoid a server/client
 * markup mismatch. Until mounted we render a stable, inert placeholder
 * of identical dimensions to prevent layout shift.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-hidden="true"
        tabIndex={-1}
        className="size-9 rounded-full"
      >
        <span className="size-4" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      title={isDark ? "Light mode" : "Dark mode"}
      className="size-9 rounded-full text-muted-foreground transition-colors duration-200 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
    >
      <Sun
        className={`size-4 transition-all duration-300 ${
          isDark ? "scale-0 -rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"
        }`}
      />
      <Moon
        className={`absolute size-4 transition-all duration-300 ${
          isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 rotate-90 opacity-0"
        }`}
      />
    </Button>
  );
}
