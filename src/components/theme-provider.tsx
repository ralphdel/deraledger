"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type ThemePreference = "light" | "dark" | "system";
type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemePreference) => void;
};

const STORAGE_KEY = "purp_theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(theme: ThemePreference) {
  return theme === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : theme;
}

function applyTheme(theme: ThemePreference) {
  const resolved = resolveTheme(theme);
  const root = window.document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.dataset.themePreference = theme;
  root.style.colorScheme = resolved;
  return resolved;
}

function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(getStoredTheme);
  const [systemIsDark, setSystemIsDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const resolvedTheme = (theme === "system" ? (systemIsDark ? "dark" : "light") : theme) as "light" | "dark";

  useEffect(() => {
    applyTheme(theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setSystemIsDark(media.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme, systemIsDark]);

  const setTheme = (nextTheme: ThemePreference) => {
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
  };

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}

export const themeInitScript = `(() => {
  const storageKey = "${STORAGE_KEY}";
  const root = document.documentElement;
  const stored = localStorage.getItem(storageKey);
  const theme = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  const resolved = theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "system" ? "light" : theme;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.dataset.themePreference = theme;
  root.style.colorScheme = resolved;
})();`;
