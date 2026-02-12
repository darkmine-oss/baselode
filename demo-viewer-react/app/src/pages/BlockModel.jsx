/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import {
  parseBlockModelCSV,
  calculatePropertyStats,
  Baselode3DScene,
  Baselode3DControls
} from 'baselode';
import 'baselode/style.css';
import './BlockModel.css';

function BlockModel() {
  const containerRef = useRef(null);
  const blockSceneRef = useRef(null);

  const [blockData, setBlockData] = useState(null);
  const [properties, setProperties] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState('');
  const [propertyStats, setPropertyStats] = useState(null);
  const [controlMode, setControlMode] = useState('orbit');

  // Initialize reusable Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Baselode3DScene();
    scene.init(containerRef.current);
    scene.setControlMode(controlMode);
    blockSceneRef.current = scene;

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      scene.dispose();
    };
  }, []);

  // Handle file upload
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    parseBlockModelCSV(file)
      .then(({ data, properties }) => {
        setBlockData(data);
        setProperties(properties);
        if (properties.length > 0) {
          setSelectedProperty(properties[0]);
        }
      })
      .catch((error) => {
        console.error('Error parsing CSV:', error);
        alert('Error parsing CSV file. Please check the format.');
      });
  };

  // Create/refresh blocks when data or selection changes
  useEffect(() => {
    if (!blockData || !selectedProperty || !blockSceneRef.current) return;

    const stats = calculatePropertyStats(blockData, selectedProperty);
    setPropertyStats(stats);
    blockSceneRef.current.setBlocks(blockData, selectedProperty, stats);
  }, [blockData, selectedProperty]);

  useEffect(() => {
    if (blockSceneRef.current) {
      blockSceneRef.current.setControlMode(controlMode);
    }
  }, [controlMode]);

  return (
    <div className="block-model-container">
      <div className="block-model-header">
        <h1>Block Model Viewer</h1>
        <div className="controls">
          <div className="file-input-wrapper">
            <label className="file-input-label">
              Upload CSV
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
              />
            </label>
          </div>

          {properties.length > 0 && (
            <div className="select-wrapper">
              <label>Property:</label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
              >
                {properties.map(prop => (
                  <option key={prop} value={prop}>{prop}</option>
                ))}
              </select>
            </div>
          )}

          {blockData && (
            <span className="info-text">
              {blockData.length} blocks loaded
            </span>
          )}
        </div>
      </div>

      <div className="canvas-container" ref={containerRef}>
        {!blockData && (
          <div className="placeholder-message">
            <div className="icon">📦</div>
            <p>Upload a CSV file to visualize block model data</p>
          </div>
        )}
        <Baselode3DControls
          controlMode={controlMode}
          onToggleFly={() => setControlMode((m) => (m === 'orbit' ? 'fly' : 'orbit'))}
          onRecenter={() => blockSceneRef.current?.recenterCameraToOrigin(2000)}
          onLookDown={() => blockSceneRef.current?.lookDown(3000)}
          onFit={() => blockSceneRef.current?.focusOnLastBounds(1.2)}
        />
      </div>
    </div>
  );
}

export default BlockModel;
