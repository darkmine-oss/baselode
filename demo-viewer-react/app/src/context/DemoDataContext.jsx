/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { loadAssayFile, parseStructuralCSV, parseUnifiedDataset, parseGeologyCsvText } from 'baselode';
import {
  loadDemoCollarRows,
  loadDemoGswaAssayCsvText,
  loadDemoStructuralCsvText,
  loadDemoGswaGeologyCsvText,
} from '../data/demoGswaData.js';

const DemoDataContext = createContext({
  loading: true,
  errors: { collars: null, assay: null, unified: null, structural: null, geology: null },
  collars: [],
  assayState: null,
  combinedHoles: [],
  structureRows: null,
  geologyHoles: [],
});

export function DemoDataProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    errors: { collars: null, assay: null, unified: null, structural: null, geology: null },
    collars: [],
    assayState: null,
    combinedHoles: [],
    structureRows: null,
    geologyHoles: [],
  });

  useEffect(() => {
    // Single network requests — Promises are reused across fetches
    const assayCsvText = loadDemoGswaAssayCsvText();
    const structuralText = loadDemoStructuralCsvText();
    const geologyText = loadDemoGswaGeologyCsvText();

    const collarsFetch = loadDemoCollarRows();
    const assayFetch = assayCsvText.then((csv) => {
      const file = new File([new Blob([csv], { type: 'text/csv' })], 'gswa_sample_assays.csv', { type: 'text/csv' });
      return loadAssayFile(file, '');
    });
    const unifiedFetch = Promise.all([assayCsvText, structuralText, geologyText])
      .then(([assayCsv, structuralCsv, geologyCsv]) => parseUnifiedDataset({ assayCsv, structuralCsv, geologyCsv }))
      .then(({ holes }) => holes);
    const structuralFetch = structuralText
      .then((t) => parseStructuralCSV(t))
      .then(({ rows }) => rows);
    const geologyFetch = geologyText
      .then((t) => parseGeologyCsvText(t))
      .then(({ holes }) => holes);

    Promise.allSettled([collarsFetch, assayFetch, unifiedFetch, structuralFetch, geologyFetch])
      .then(([c, a, u, s, g]) => {
        setState({
          loading: false,
          collars: c.status === 'fulfilled' ? c.value : [],
          assayState: a.status === 'fulfilled' ? a.value : null,
          combinedHoles: u.status === 'fulfilled' ? u.value : [],
          structureRows: s.status === 'fulfilled' ? s.value : null,
          geologyHoles: g.status === 'fulfilled' ? g.value : [],
          errors: {
            collars: c.reason?.message ?? null,
            assay: a.reason?.message ?? null,
            unified: u.reason?.message ?? null,
            structural: s.reason?.message ?? null,
            geology: g.reason?.message ?? null,
          },
        });
      });
  }, []);

  return <DemoDataContext.Provider value={state}>{children}</DemoDataContext.Provider>;
}

export function useDemoData() {
  return useContext(DemoDataContext);
}
