/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { primaryFieldFromConfig } from 'baselode';

const STORAGE_KEY = 'baselode-drill-config-v1';
const defaultConfig = { primaryKey: 'companyHoleId', customKey: '' };

const DrillConfigContext = createContext({
  config: defaultConfig,
  primaryField: primaryFieldFromConfig(defaultConfig),
  setPrimaryKey: () => {},
  setCustomKey: () => {}
});

export function DrillConfigProvider({ children }) {
  const [config, setConfig] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return { ...defaultConfig, ...parsed };
        }
      }
    } catch (e) {
      console.warn('Failed to load drill config', e);
    }
    return defaultConfig;
  });

  const primaryField = useMemo(() => primaryFieldFromConfig(config), [config]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('Failed to persist drill config', e);
    }
  }, [config]);

  const setPrimaryKey = (key) => setConfig((prev) => ({ ...prev, primaryKey: key }));
  const setCustomKey = (value) => setConfig((prev) => ({ ...prev, customKey: value }));

  return (
    <DrillConfigContext.Provider value={{ config, primaryField, setPrimaryKey, setCustomKey }}>
      {children}
    </DrillConfigContext.Provider>
  );
}

export function useDrillConfig() {
  return useContext(DrillConfigContext);
}
