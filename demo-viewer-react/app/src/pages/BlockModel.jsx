/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Baselode3DScene,
  Baselode3DControls,
  BlockModelWidget,
  SectionHelper,
  SliceHelper,
  parseBlockModelCSV,
  calculatePropertyStats
} from 'baselode';
import 'baselode/style.css';
import './BlockModel.css';

function BlockModel() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const sectionHelperRef = useRef(null);
  const sliceHelperRef = useRef(null);
  const opacityRef = useRef(1.0);
  const drawStartRef = useRef(null);

  const [blockData, setBlockData] = useState(null);
  const [properties, setProperties] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState('');
  const [opacity, setOpacity] = useState(1.0);
  const [clickedBlock, setClickedBlock] = useState(null);
  const [error, setError] = useState('');
  const [controlMode, setControlMode] = useState('orbit');
  const [sectionMode, setSectionMode] = useState(null);
  const [sectionPosition, setSectionPosition] = useState(0);
  const [sliceActive, setSliceActive] = useState(false);
  const [slicePosition, setSlicePosition] = useState(0);
  const [sliceWidth, setSliceWidth] = useState(50);
  const [sliceNormal, setSliceNormal] = useState({ x: 1, y: 0, z: 0 });
  const [drawingSlice, setDrawingSlice] = useState(false);
  const [drawLine, setDrawLine] = useState(null);

  opacityRef.current = opacity;

  const propertyStats = useMemo(() => {
    if (!blockData || !selectedProperty) return null;
    return calculatePropertyStats(blockData, selectedProperty);
  }, [blockData, selectedProperty]);

  // Bounding box across all block centroids.
  const blockBounds = useMemo(() => {
    if (!blockData?.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const b of blockData) {
      if (b.x < minX) minX = b.x;
      if (b.x > maxX) maxX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.y > maxY) maxY = b.y;
    }
    return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
  }, [blockData]);

  const sectionRange = useMemo(() => {
    if (!blockBounds || !sectionMode) return null;
    return sectionMode === 'x'
      ? { min: blockBounds.minX, max: blockBounds.maxX }
      : { min: blockBounds.minY, max: blockBounds.maxY };
  }, [blockBounds, sectionMode]);

  const sliceRange = useMemo(() => {
    if (!blockData?.length || !sliceActive) return null;
    const n = sliceNormal;
    let min = Infinity, max = -Infinity;
    for (const b of blockData) {
      const d = b.x * n.x + b.y * n.y;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return Number.isFinite(min) ? { min, max } : null;
  }, [blockData, sliceActive, sliceNormal]);

  // Load demo block model CSV on mount
  useEffect(() => {
    fetch('/data/blockmodel/demo_blockmodel.csv')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load block model (${r.status})`);
        return r.text();
      })
      .then((text) => parseBlockModelCSV(text))
      .then(({ data, properties: props }) => {
        setBlockData(data);
        setProperties(props);
        if (props.length > 0) setSelectedProperty(props[0]);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Initialize 3D scene
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Baselode3DScene();
    scene.init(containerRef.current);
    scene.setBlockClickHandler((blockRow) => setClickedBlock(blockRow));
    sceneRef.current = scene;

    const sectionHelper = new SectionHelper(scene);
    sectionHelperRef.current = sectionHelper;
    const sliceHelper = new SliceHelper(scene);
    sliceHelperRef.current = sliceHelper;

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      sectionHelper.dispose();
      sliceHelper.dispose();
      scene.dispose();
    };
  }, []);

  // Re-render blocks when data or selected property changes
  useEffect(() => {
    if (!sceneRef.current || !blockData || !selectedProperty || !propertyStats) return;
    sceneRef.current.setBlocks(blockData, selectedProperty, propertyStats, {
      opacity: opacityRef.current
    });
  }, [blockData, selectedProperty, propertyStats]);

  // Update opacity without a full re-render
  useEffect(() => {
    sceneRef.current?.setBlockOpacity(opacity);
  }, [opacity]);

  useEffect(() => {
    sceneRef.current?.setControlMode(controlMode);
  }, [controlMode]);

  const handlePropertyChange = (prop) => {
    setSelectedProperty(prop);
    setClickedBlock(null);
  };

  const handleToggleSectionX = useCallback(() => {
    const helper = sectionHelperRef.current;
    if (!helper) return;
    if (sectionMode === 'x') {
      helper.disableSectionMode();
      setSectionMode(null);
    } else {
      helper.enableSectionMode('x');
      setSectionMode('x');
      setSliceActive(false);
    }
  }, [sectionMode]);

  const handleToggleSectionY = useCallback(() => {
    const helper = sectionHelperRef.current;
    if (!helper) return;
    if (sectionMode === 'y') {
      helper.disableSectionMode();
      setSectionMode(null);
    } else {
      helper.enableSectionMode('y');
      setSectionMode('y');
      setSliceActive(false);
    }
  }, [sectionMode]);

  const handleStepSection = useCallback((delta) => {
    sectionHelperRef.current?.stepSection(delta);
    setSectionPosition((prev) => prev + delta);
  }, []);

  const handleSetSectionPosition = useCallback((newPos) => {
    sectionHelperRef.current?.setSectionPosition(newPos);
    setSectionPosition(newPos);
  }, []);

  const handleToggleSlice = useCallback(() => {
    const helper = sliceHelperRef.current;
    if (!helper) return;
    if (sliceActive) {
      helper.disableSliceMode();
      setSliceActive(false);
    } else {
      helper.enableSliceMode();
      setSliceActive(true);
      setSectionMode(null);
    }
  }, [sliceActive]);

  const handleStepSlice = useCallback((delta) => {
    sliceHelperRef.current?.moveSlice(delta);
    setSlicePosition((prev) => prev + delta);
  }, []);

  const handleSetSlicePosition = useCallback((newPos) => {
    sliceHelperRef.current?.moveSlice(newPos - slicePosition);
    setSlicePosition(newPos);
  }, [slicePosition]);

  const handleSetSliceWidth = useCallback((width) => {
    sliceHelperRef.current?.setSliceWidth(width);
    setSliceWidth(width);
  }, []);

  const handleDrawStart = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    drawStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDrawLine({ x1: drawStartRef.current.x, y1: drawStartRef.current.y,
                  x2: drawStartRef.current.x, y2: drawStartRef.current.y });
  }, []);

  const handleDrawMove = useCallback((e) => {
    if (!drawStartRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDrawLine({ x1: drawStartRef.current.x, y1: drawStartRef.current.y,
                  x2: e.clientX - rect.left, y2: e.clientY - rect.top });
  }, []);

  const handleDrawEnd = useCallback((e) => {
    if (!drawStartRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = drawStartRef.current;
    const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    drawStartRef.current = null;
    setDrawLine(null);
    setDrawingSlice(false);

    const helper = sliceHelperRef.current;
    if (!helper) return;
    const result = helper.createSlicePlaneFromScreenLine(start, end);
    if (!result) return;

    helper.setSlicePlane(result.normal, result.distance);
    setSliceNormal({ x: result.normal.x, y: result.normal.y, z: result.normal.z });
    setSlicePosition(result.distance);

    if (!sliceActive) {
      helper.enableSliceMode();
      setSliceActive(true);
      setSectionMode(null);
    }
  }, [sliceActive]);

  const handleCancelDraw = useCallback(() => {
    drawStartRef.current = null;
    setDrawLine(null);
    setDrawingSlice(false);
  }, []);

  return (
    <div className="blockmodel-container">
      <div className="blockmodel-header">
        <h1>Block Models</h1>
        <div className="blockmodel-header-meta">
          {blockData && (
            <span className="blockmodel-info">{blockData.length} blocks loaded</span>
          )}
          {error && <span className="blockmodel-error">{error}</span>}
        </div>
      </div>

      <div className="blockmodel-canvas" ref={containerRef}>
        {!blockData && !error && (
          <div className="blockmodel-placeholder">
            <p>Loading block model...</p>
          </div>
        )}

        {drawingSlice && (
          <div
            className="slice-draw-overlay"
            onMouseDown={handleDrawStart}
            onMouseMove={handleDrawMove}
            onMouseUp={handleDrawEnd}
            onMouseLeave={handleCancelDraw}
          >
            <svg className="slice-draw-svg">
              {drawLine && (
                <line
                  x1={drawLine.x1} y1={drawLine.y1}
                  x2={drawLine.x2} y2={drawLine.y2}
                  stroke="#ff9900" strokeWidth="2.5" strokeDasharray="8 4"
                />
              )}
            </svg>
            <div className="slice-draw-hint">
              Click and drag to define the slice plane — release to apply
            </div>
          </div>
        )}

        <Baselode3DControls
          controlMode={controlMode}
          onToggleFly={() => setControlMode((m) => (m === 'orbit' ? 'fly' : 'orbit'))}
          onRecenter={() => sceneRef.current?.recenterCameraToOrigin(2000)}
          onLookDown={() => sceneRef.current?.lookDown(3000)}
          onFit={() => sceneRef.current?.focusOnLastBounds(1.2)}
          sectionMode={sectionMode}
          onToggleSectionX={handleToggleSectionX}
          onToggleSectionY={handleToggleSectionY}
          onStepSection={handleStepSection}
          sectionPosition={sectionPosition}
          sectionRange={sectionRange}
          onSetSectionPosition={handleSetSectionPosition}
          sliceActive={sliceActive}
          onToggleSlice={handleToggleSlice}
          onStepSlice={handleStepSlice}
          slicePosition={slicePosition}
          sliceRange={sliceRange}
          onSetSlicePosition={handleSetSlicePosition}
          sliceWidth={sliceWidth}
          onSetSliceWidth={handleSetSliceWidth}
          onDrawSlice={() => setDrawingSlice(true)}
          drawingSlice={drawingSlice}
          onCancelDraw={handleCancelDraw}
        />

        {blockData && (
          <div className="blockmodel-widget-overlay">
            <BlockModelWidget
              properties={properties}
              selectedProperty={selectedProperty}
              onPropertyChange={handlePropertyChange}
              opacity={opacity}
              onOpacityChange={setOpacity}
              propertyStats={propertyStats}
              clickedBlock={clickedBlock}
              onPopupClose={() => setClickedBlock(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default BlockModel;
