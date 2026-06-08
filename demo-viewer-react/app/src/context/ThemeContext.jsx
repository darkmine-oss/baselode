/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// App-wide light/dark theme.  Stores the user's pick in localStorage
// so the choice survives reloads, and falls back to the OS preference
// otherwise.  Toggles a `.light` / `.dark` class on `<html>` so any
// page-level CSS (and the baselode wrapper components' custom
// properties) can re-theme through a single switch.

const STORAGE_KEY = 'baselode-demo-viewer-theme';
const VALID = new Set(['dark', 'light']);

const ThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {},
  setTheme: () => {},
});

function readInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.has(stored)) return stored;
  } catch (e) {
    /* ignore */
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (VALID.has(next)) setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
