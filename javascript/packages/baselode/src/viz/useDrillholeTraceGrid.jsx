/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveAssayProps,
  loadAssayHole,
  loadAssayMetadata
} from '../data/assayDataLoader.js';
import {
  buildTraceConfigsForHoleIds,
  coerceChartTypeForProperty,
  reorderHoleIds
} from '../data/traceGridConfig.js';
import { buildIntervalPoints, holeHasData } from './drillholeViz.js';

/**
 * Merge two arrays of hole objects by holeId.
 * For holes that appear in both arrays, their points are concatenated.
 * @private
 */
function mergeHoleSets(primary, extra) {
  if (!extra?.length) return primary;
  const byId = new Map(primary.map((h) => [h.id || h.holeId, { ...h }]));
  for (const eh of extra) {
    const id = eh.id || eh.holeId;
    if (!id) continue;
    if (byId.has(id)) {
      const existing = byId.get(id);
      byId.set(id, { ...existing, points: [...(existing.points || []), ...(eh.points || [])] });
    } else {
      byId.set(id, eh);
    }
  }
  return Array.from(byId.values());
}

/**
 * Build comment-type interval points from a hole.
 * Unlike buildIntervalPoints, this keeps intervals with empty/null comment values
 * so that buildCommentsConfig can draw the interval border rectangles.
 * @private
 */
function buildCommentPoints(hole, property) {
  if (!hole || !property) return [];
  const seen = new Set();
  const out = [];
  for (const p of hole.points || []) {
    const from = Number(p.from ?? p.samp_from ?? p.depth_from ?? p.from_depth);
    const to = Number(p.to ?? p.samp_to ?? p.depth_to ?? p.to_depth);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const key = `${from}-${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to, [property]: p[property] ?? '' });
  }
  return out;
}

/**
 * React hook for managing a grid of drillhole trace plots.
 * Handles loading assay data, optional extra hole data (e.g. structural intervals),
 * column metadata classification, and trace config coordination.
 *
 * @param {Object} options
 * @param {string} options.initialFocusedHoleId - Initial focused hole ID
 * @param {File|Blob|null} options.sourceFile - Assay data CSV file
 * @param {Array<Object>} options.extraHoles - Pre-parsed extra hole data (e.g. structural)
 * @param {number} options.plotCount - Number of plots in grid (default: 4)
 * @returns {Object} Hook state and actions
 */
export default function useDrillholeTraceGrid({
  initialFocusedHoleId = '',
  sourceFile = null,
  extraHoles = [],
  plotCount = 4
} = {}) {
  const [holes, setHoles] = useState([]);
  const [holeIds, setHoleIds] = useState([]);
  const [numericProps, setNumericProps] = useState([]);
  const [categoricalProps, setCategoricalProps] = useState([]);
  const [commentProps, setCommentProps] = useState([]);
  const [columnMeta, setColumnMeta] = useState({});
  const [defaultProp, setDefaultProp] = useState('');
  const [traceConfigs, setTraceConfigs] = useState([]);
  const [error, setError] = useState('');
  const [focusedHoleId, setFocusedHoleId] = useState(initialFocusedHoleId || '');
  const [loadingHoles, setLoadingHoles] = useState([]);
  const loadedSourceFileRef = useRef(null);

  const applyAssayState = (state) => {
    if (!state) return;
    setError('');
    setHoles(state.holes || []);
    setHoleIds((state.holes || []).map((h) => ({
      holeId: h.id || h.holeId
    })).filter((h) => h.holeId));
    setNumericProps(state.numericProps || []);
    setCategoricalProps(state.categoricalProps || []);
    setCommentProps(state.commentProps || []);
    setColumnMeta(state.columnMeta || {});
    setDefaultProp(state.defaultProp || '');
    setTraceConfigs(state.traceConfigs || []);
  };

  // Load metadata (hole IDs) from assay CSV on first mount
  useEffect(() => {
    if (!sourceFile || loadedSourceFileRef.current === sourceFile) return;
    loadedSourceFileRef.current = sourceFile;
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
          commentProps,
          numericDefaultChartType: 'markers+line'
        }));
      })
      .catch((err) => {
        console.info('Assay metadata load skipped:', err.message);
      });
  }, [sourceFile, focusedHoleId, plotCount, categoricalProps, commentProps]);

  // Inject extra holes (structural etc.) into holeIds — always, regardless of whether
  // an assay sourceFile is also present. This ensures structural-only holes appear in
  // the dropdown even when assay data is loaded from a separate file.
  useEffect(() => {
    if (!extraHoles?.length) return;
    const ids = extraHoles
      .map((h) => ({ holeId: h.id || h.holeId }))
      .filter((h) => h.holeId);
    setHoleIds((prev) => {
      const existing = new Set(prev.map((h) => h.holeId));
      const newIds = ids.filter((h) => !existing.has(h.holeId));
      return newIds.length ? [...prev, ...newIds] : prev;
    });
  }, [extraHoles]);

  useEffect(() => {
    setError((prev) => (prev && prev.startsWith('Loading ') && prev.includes(' for hole ') ? prev : ''));
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
          commentProps,
          numericDefaultChartType: 'markers+line'
        });
        return { holeId, property, chartType };
      });
      return next;
    });
  }, [holeIds, focusedHoleId, defaultProp, categoricalProps, commentProps, plotCount]);

  // Load assay hole data on demand as trace configs change
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
            const merged = mergeHoleSets(
              [...prev.filter((h) => (h.id || h.holeId) !== holeId), hole],
              extraHoles
            );
            const props = deriveAssayProps(merged);
            setNumericProps(props.numericProps);
            setCategoricalProps(props.categoricalProps);
            setCommentProps(props.commentProps);
            setColumnMeta(props.columnMeta);
            if (!defaultProp && props.defaultProp) {
              setDefaultProp(props.defaultProp);
              setTraceConfigs((configs) => configs.map((cfg) => ({
                ...cfg,
                property: cfg.property || props.defaultProp,
                chartType: coerceChartTypeForProperty({
                  property: cfg.property || props.defaultProp,
                  chartType: cfg.chartType,
                  categoricalProps: props.categoricalProps,
                  commentProps: props.commentProps,
                  numericDefaultChartType: 'markers+line'
                })
              })));
            }
            return merged;
          });
        })
        .catch((err) => {
          console.error(err);
          setLoadingHoles((prev) => prev.filter((id) => id !== holeId));
          setError(err.message || `Error loading hole ${holeId}`);
        });
    });
  }, [traceConfigs, sourceFile, holes, loadingHoles, defaultProp, extraHoles]);

  // Merge extra holes whenever they change (and assay holes are present)
  useEffect(() => {
    if (!extraHoles?.length) return;
    setHoles((prev) => {
      if (!prev.length) {
        // No assay data yet — seed from extra holes only
        const props = deriveAssayProps(extraHoles);
        setNumericProps(props.numericProps);
        setCategoricalProps(props.categoricalProps);
        setCommentProps(props.commentProps);
        setColumnMeta(props.columnMeta);
        if (!defaultProp && props.defaultProp) setDefaultProp(props.defaultProp);
        return extraHoles;
      }
      const merged = mergeHoleSets(prev, extraHoles);
      const props = deriveAssayProps(merged);
      setNumericProps(props.numericProps);
      setCategoricalProps(props.categoricalProps);
      setCommentProps(props.commentProps);
      setColumnMeta(props.columnMeta);
      if (!defaultProp && props.defaultProp) setDefaultProp(props.defaultProp);
      return merged;
    });
  }, [extraHoles]); // eslint-disable-line react-hooks/exhaustive-deps

  const propertyOptions = useMemo(
    () => [...numericProps, ...categoricalProps, ...commentProps],
    [numericProps, categoricalProps, commentProps]
  );

  const labeledHoleOptions = useMemo(
    () => holeIds
      .map((h) => ({ holeId: h.holeId, label: h.holeId }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [holeIds]
  );

  const traceGraphs = useMemo(() => {
    const allProps = [...numericProps, ...categoricalProps, ...commentProps];
    return Array.from({ length: plotCount }).map((_, idx) => {
      const cfg = traceConfigs[idx] || {};
      const hole = holes.find((h) => (h.id || h.holeId) === cfg.holeId) || null;

      // Per-hole property list: only columns this hole actually has data for
      const holePropertyOptions = hole
        ? allProps.filter((p) => holeHasData(hole, p))
        : allProps;

      let property = cfg.property || defaultProp;
      // Auto-select first available property if the configured one has no data for this hole
      if (hole && !holePropertyOptions.includes(property)) {
        property = holePropertyOptions[0] || property;
      }

      const isComment = commentProps.includes(property);
      const isCategorical = !isComment && categoricalProps.includes(property);
      const isTadpole = !isComment && !isCategorical && property === 'dip';
      const displayType = isComment ? 'comment' : isTadpole ? 'tadpole' : (isCategorical ? 'categorical' : 'numeric');

      const chartType = isTadpole ? 'tadpole' : cfg.chartType || (isComment ? 'comment' : (isCategorical ? 'categorical' : 'markers+line'));
      const holeId = cfg.holeId || hole?.id || hole?.holeId || '';

      const points = isTadpole
        ? (hole?.points || [])
        : isComment
          ? buildCommentPoints(hole, property)
          : buildIntervalPoints(hole, property, isCategorical);

      return {
        config: { holeId, property, chartType },
        hole,
        loading: loadingHoles.includes(cfg.holeId),
        isCategorical,
        isComment,
        isTadpole,
        displayType,
        points,
        propertyOptions: holePropertyOptions,
        label: holeId
      };
    });
  }, [traceConfigs, holes, defaultProp, categoricalProps, commentProps, loadingHoles, plotCount, numericProps]);

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
          commentProps,
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
    commentProps,
    columnMeta,
    propertyOptions,
    labeledHoleOptions,
    traceGraphs,
    handleConfigChange
  };
}
