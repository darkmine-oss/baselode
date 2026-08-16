/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Baselode3DScene,
  Baselode3DControls,
  SectionHelper,
  SliceHelper,
  BlockModelWidget,
  parseBlockModelCSV,
  calculatePropertyStats
} from 'baselode';
import 'baselode/style.css';
import './BlockModel.css';

function BlockModel() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const opacityRef = useRef(1.0);
  const sectionRef = useRef(null);
  const sliceRef = useRef(null);

  const [blockData, setBlockData] = useState(null);
  const [properties, setProperties] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState('');
  const [opacity, setOpacity] = useState(1.0);
  const [clickedBlock, setClickedBlock] = useState(null);
  const [error, setError] = useState('');
  const [controlMode, setControlMode] = useState('orbit');
  const [sectionAxis, setSectionAxis] = useState(null);
  const [sectionPosition, setSectionPosition] = useState(0);
  const [sliceAxis, setSliceAxis] = useState(null);
  const [slicePosition, setSlicePosition] = useState(0);
  const [sliceWidth, setSliceWidth] = useState(50);

  opacityRef.current = opacity;

  const propertyStats = useMemo(() => {
    if (!blockData || !selectedProperty) return null;
    return calculatePropertyStats(blockData, selectedProperty);
  }, [blockData, selectedProperty]);

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
    sectionRef.current = new SectionHelper(scene);
    sliceRef.current = new SliceHelper(scene);

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      sectionRef.current?.dispose();
      sliceRef.current?.dispose();
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

  const rangeFor = (axis) => {
    const bounds = sceneRef.current?.lastBounds;
    if (!bounds) return null;
    return axis === 'y' ? { min: bounds.minY, max: bounds.maxY } : { min: bounds.minX, max: bounds.maxX };
  };
  const toggleSection = (axis) => {
    if (sectionAxis === axis) { sectionRef.current?.disable(); setSectionAxis(null); return; }
    sliceRef.current?.disable();
    const range = rangeFor(axis); const position = range ? (range.min + range.max) / 2 : 0;
    sectionRef.current?.enable(axis, position); setSectionAxis(axis); setSectionPosition(position); setSliceAxis(null);
  };
  const updateSection = (position) => { sectionRef.current?.setPosition(position); setSectionPosition(position); };
  const toggleSlice = (axis) => {
    if (sliceAxis) { sliceRef.current?.disable(); setSliceAxis(null); return; }
    sectionRef.current?.disable();
    const range = rangeFor(axis); const position = range ? (range.min + range.max) / 2 : 0;
    sliceRef.current?.enable(axis, position, sliceWidth); setSliceAxis(axis); setSlicePosition(position); setSectionAxis(null);
  };
  const updateSliceAxis = (axis) => { const range = rangeFor(axis); const position = range ? (range.min + range.max) / 2 : 0; sliceRef.current?.enable(axis, position, sliceWidth); setSliceAxis(axis); setSlicePosition(position); };
  const updateSlice = (position) => { sliceRef.current?.setPosition(position); setSlicePosition(position); };
  const updateSliceWidth = (width) => { if (!Number.isFinite(width) || width <= 0) return; sliceRef.current?.setWidth(width); setSliceWidth(width); };

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

        <Baselode3DControls
          controlMode={controlMode}
          onToggleFly={() => setControlMode((m) => (m === 'orbit' ? 'fly' : 'orbit'))}
          onRecenter={() => sceneRef.current?.recenterCameraToOrigin(2000)}
          onLookDown={() => sceneRef.current?.lookDown(3000)}
          onFit={() => sceneRef.current?.focusOnLastBounds(1.2)}
          sectionAxis={sectionAxis} sectionPosition={sectionPosition} sectionRange={rangeFor(sectionAxis)} onToggleSection={toggleSection} onSetSectionPosition={updateSection}
          sliceAxis={sliceAxis} slicePosition={slicePosition} sliceWidth={sliceWidth} sliceRange={rangeFor(sliceAxis)} onToggleSlice={toggleSlice} onSetSliceAxis={updateSliceAxis} onSetSlicePosition={updateSlice} onSetSliceWidth={updateSliceWidth}
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
