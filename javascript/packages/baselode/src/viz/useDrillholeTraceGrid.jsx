/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import {
  deriveAssayProps,
  loadAssayHole,
  loadAssayMetadata,
  loadCachedAssayState,
  saveAssayCache
} from '../data/assayDataLoader.js';
import {
  buildTraceConfigsForHoleIds,
  coerceChartTypeForProperty,
  reorderHoleIds
} from '../data/traceGridConfig.js';
import { buildIntervalPoints, holeHasData } from './drillholeViz.js';

export default function useDrillholeTraceGrid({
  initialFocusedHoleId = '',
  sourceFile = null,
  plotCount = 4
} = {}) {
  const [holes, setHoles] = useState([]);
  const [holeIds, setHoleIds] = useState([]);
  const [numericProps, setNumericProps] = useState([]);
  const [categoricalProps, setCategoricalProps] = useState([]);
  const [defaultProp, setDefaultProp] = useState('');
  const [traceConfigs, setTraceConfigs] = useState([]);
  const [error, setError] = useState('');
  const [focusedHoleId, setFocusedHoleId] = useState(initialFocusedHoleId || '');
  const [loadingHoles, setLoadingHoles] = useState([]);

  const applyAssayState = (state) => {
    if (!state) return;
    setError('');
    setHoles(state.holes || []);
    setHoleIds((state.holes || []).map((h) => ({
      holeId: h.id || h.holeId
    })).filter((h) => h.holeId));
    setNumericProps(state.numericProps || []);
    setCategoricalProps(state.categoricalProps || []);
    setDefaultProp(state.defaultProp || '');
    setTraceConfigs(state.traceConfigs || []);
  };

  useEffect(() => {
    const cachedState = loadCachedAssayState(focusedHoleId);
    if (cachedState) {
      applyAssayState(cachedState);
    }
  }, [focusedHoleId]);

  useEffect(() => {
    if (!sourceFile || holeIds.length > 0) return;
    loadAssayMetadata(sourceFile)
      .then((ids) => {
        if (!ids) return;
        const uniqueIds = Array.from(new Map(ids.map((h) => [h.holeId, h])).values());
        setHoleIds(uniqueIds);
        setTraceConfigs(buildTraceConfigsForHoleIds({
          holeIds: uniqueIds.map((h) => h.holeId),
          focusedHoleId,
          plotCount,
          defaultProp: '',
          categoricalProps,
          numericDefaultChartType: 'markers+line'
        }));
      })
      .catch((err) => {
        console.info('Assay metadata load skipped:', err.message);
      });
  }, [sourceFile, holeIds.length, focusedHoleId, plotCount, categoricalProps]);

  useEffect(() => {
    setError((prev) => (prev && prev.startsWith('Loading assays for hole') ? prev : ''));
  }, [traceConfigs]);

  useEffect(() => {
    if (!holeIds.length) {
      setTraceConfigs([]);
      return;
    }
    const orderedHoleIds = reorderHoleIds(holeIds.map((h) => h.holeId), focusedHoleId);
    setTraceConfigs((prev) => {
      const next = Array.from({ length: plotCount }).map((_, idx) => {
        const existing = prev[idx] || {};
        const holeId = holeIds.some((h) => h.holeId === existing.holeId) ? existing.holeId : orderedHoleIds[idx] || holeIds[idx]?.holeId || '';
        const property = existing.property || defaultProp;
        const chartType = coerceChartTypeForProperty({
          property,
          chartType: existing.chartType,
          categoricalProps,
          numericDefaultChartType: 'markers+line'
        });
        return { holeId, property, chartType };
      });
      return next;
    });
  }, [holeIds, focusedHoleId, defaultProp, categoricalProps, plotCount]);

  useEffect(() => {
    if (!sourceFile) return;
    const needed = traceConfigs.map((cfg) => cfg.holeId).filter(Boolean);
    needed.forEach((holeId) => {
      const already = holes.some((h) => (h.id || h.holeId) === holeId);
      const loading = loadingHoles.includes(holeId);
      if (already || loading) return;
      setLoadingHoles((prev) => [...prev, holeId]);
      loadAssayHole(sourceFile, holeId)
        .then((hole) => {
          setLoadingHoles((prev) => prev.filter((id) => id !== holeId));
          if (!hole) return;
          setHoles((prev) => {
            const next = [...prev.filter((h) => (h.id || h.holeId) !== holeId), hole];
            const props = deriveAssayProps(next);
            setNumericProps(props.numericProps);
            setCategoricalProps(props.categoricalProps);
            if (!defaultProp && props.defaultProp) {
              setDefaultProp(props.defaultProp);
              setTraceConfigs((configs) => configs.map((cfg) => ({
                ...cfg,
                property: cfg.property || props.defaultProp,
                chartType: coerceChartTypeForProperty({
                  property: cfg.property || props.defaultProp,
                  chartType: cfg.chartType,
                  categoricalProps: props.categoricalProps,
                  numericDefaultChartType: 'markers+line'
                })
              })));
            }
            const cached = saveAssayCache(next, {
              holes: next,
              numericProps: props.numericProps,
              categoricalProps: props.categoricalProps,
              defaultProp: props.defaultProp
            }, { fallbackToMetaOnly: true });
            if (!cached) {
              console.info('Proceeding without cached assays (quota exceeded).');
            }
            return next;
          });
        })
        .catch((err) => {
          console.error(err);
          setLoadingHoles((prev) => prev.filter((id) => id !== holeId));
          setError(err.message || `Error loading hole ${holeId}`);
        });
    });
  }, [traceConfigs, sourceFile, holes, loadingHoles, defaultProp]);

  const propertyOptions = useMemo(() => [...numericProps, ...categoricalProps], [numericProps, categoricalProps]);

  const labeledHoleOptions = useMemo(
    () => holeIds
      .map((h) => ({ holeId: h.holeId, label: h.holeId }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [holeIds]
  );

  const traceGraphs = useMemo(() => {
    return Array.from({ length: plotCount }).map((_, idx) => {
      const cfg = traceConfigs[idx] || {};
      const hole = holes.find((h) => (h.id || h.holeId) === cfg.holeId) || null;
      let property = cfg.property || defaultProp;
      if (hole && (!property || !holeHasData(hole, property))) {
        const fallback = [...numericProps, ...categoricalProps].find((p) => holeHasData(hole, p));
        if (fallback) property = fallback;
      }
      const chartType = cfg.chartType || (property && categoricalProps.includes(property) ? 'categorical' : 'markers+line');
      const holeId = cfg.holeId || hole?.id || hole?.holeId || '';
      const isCategorical = categoricalProps.includes(property);
      const points = buildIntervalPoints(hole, property, isCategorical);
      return {
        config: { holeId, property, chartType },
        hole,
        loading: loadingHoles.includes(cfg.holeId),
        isCategorical,
        points,
        label: holeId
      };
    });
  }, [traceConfigs, holes, defaultProp, categoricalProps, loadingHoles, plotCount, numericProps]);

  const handleConfigChange = (index, patch) => {
    setTraceConfigs((prev) => {
      const next = [...prev];
      const base = next[index] || {};
      const merged = { ...base, ...patch };
      if (patch.property) {
        merged.chartType = coerceChartTypeForProperty({
          property: patch.property,
          chartType: merged.chartType,
          categoricalProps,
          numericDefaultChartType: 'markers+line'
        });
      }
      next[index] = merged;
      return next;
    });
  };

  return {
    error,
    focusedHoleId,
    setFocusedHoleId,
    setError,
    holeCount: holeIds.length,
    numericProps,
    categoricalProps,
    propertyOptions,
    labeledHoleOptions,
    traceGraphs,
    handleConfigChange
  };
}
