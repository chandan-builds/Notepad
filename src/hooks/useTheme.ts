"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export const THEME_STORAGE_KEY = "notepadly-theme";

export type ThemeMode = "light" | "dark";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const next = isThemeMode(stored) ? stored : "light";
    document.documentElement.dataset.theme = next;
    setMode(next);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = mode;
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  }, [mode, ready]);

  const toggleTheme = useCallback(() => {
    setMode((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { mode, toggleTheme };
}
