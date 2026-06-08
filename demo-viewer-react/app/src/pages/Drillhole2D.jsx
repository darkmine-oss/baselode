/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  BaselodeStripLogGrid,
  BASELODE_DARK_TEMPLATE,
  BASELODE_TEMPLATE,
} from 'baselode';
import 'baselode/style.css';
import './Drillhole2D.css';
import { createPortal } from 'react-dom';
import { useDemoData } from '../context/DemoDataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

// The demo GSWA assay columns encode the unit as a trailing token, e.g.
// "Au_PPM". Split that into a clean label + unit so the strip-log axes and
// tooltips read "Au (ppm)" rather than the raw "Au_PPM" — otherwise a column
// shown as bare "Au" would leave the reader guessing at the units. Production
// datasets supply this through per-row `analysis_uom` metadata instead.
const UNIT_SUFFIXES = {
  ppm: 'ppm',
  ppb: 'ppb',
  pct: '%',
  gpt: 'g/t',
  oz: 'oz/t',
};

function titleCase(token) {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function metaForProperty(property) {
  if (typeof property !== 'string') return null;
  const tokens = property.split(/[_\-/\s]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const unit = UNIT_SUFFIXES[tokens[tokens.length - 1].toLowerCase()];
  if (!unit) return null;
  // Element symbols (Au, Cu, …) read best title-cased regardless of source casing.
  return { label: tokens.slice(0, -1).map(titleCase).join(' '), unit };
}

/**
 * Build a propertyMeta map by inspecting every row's keys.  Cheap
 * enough to do once per render given the dataset is fixed for the
 * demo; production code would use upstream `analysis_uom` instead.
 */
function buildPropertyMeta(combinedHoles) {
  const map = {};
  for (const hole of combinedHoles || []) {
    const points = hole?.points || hole?.rows || [];
    for (const row of points) {
      for (const key of Object.keys(row || {})) {
        if (key in map) continue;
        const m = metaForProperty(key);
        if (m) map[key] = m;
      }
    }
  }
  return map;
}

function Drillhole2D() {
  const location = useLocation();
  const { combinedHoles } = useDemoData();
  const { theme } = useTheme();
  const template = theme === 'dark' ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;
  const holeCount = (combinedHoles || []).length;

  const propertyMeta = useMemo(() => buildPropertyMeta(combinedHoles), [combinedHoles]);

  return (
    <div className="drillhole2d-container">
      <div className="drillhole2d-header">
        <h2>Drillhole Strip Logs</h2>
      </div>

      <BaselodeStripLogGrid
        holes={combinedHoles}
        initialHoleId={location.state?.holeId || ''}
        plotCount={4}
        propertyMeta={propertyMeta}
        template={template}
        className="drillhole2d-grid"
      />

      {(() => {
        const dataSourceTarget = typeof document !== 'undefined' ? document.getElementById('data-source-slot') : null;
        if (!dataSourceTarget) return null;
        const dataSourceInfo = (
          <div className="data-source-text">
            {holeCount > 0 && (
              <div>demo_gswa ({holeCount} holes, assay + structural + geology)</div>
            )}
          </div>
        );
        return createPortal(dataSourceInfo, dataSourceTarget);
      })()}
    </div>
  );
}

export default Drillhole2D;
