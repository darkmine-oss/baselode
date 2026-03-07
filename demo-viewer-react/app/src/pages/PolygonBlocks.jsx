/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import {
  Baselode3DScene,
  Baselode3DControls,
  loadGradeBlocksFromJson,
  addGradeBlocksToScene,
} from 'baselode';
import 'baselode/style.css';
import './PolygonBlocks.css';

function PolygonBlocks() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const gradeGroupRef = useRef(null);

  const [blockSet, setBlockSet] = useState(null);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [error, setError] = useState('');
  const [controlMode, setControlMode] = useState('orbit');

  // Load demo grade blocks JSON on mount
  useEffect(() => {
    fetch('/data/grade_blocks/demo_grade_blocks.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load grade blocks (${r.status})`);
        return r.json();
      })
      .then((json) => loadGradeBlocksFromJson(json))
      .then((parsed) => setBlockSet(parsed))
      .catch((err) => setError(err.message));
  }, []);

  // Initialize 3D scene
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Baselode3DScene();
    scene.init(containerRef.current);
    sceneRef.current = scene;

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      scene.dispose();
    };
  }, []);

  // Add grade blocks to scene once both scene and data are ready
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene?.scene || !blockSet) return;

    // Remove previous group if any
    if (gradeGroupRef.current) {
      scene.scene.remove(gradeGroupRef.current);
      gradeGroupRef.current.children.forEach((mesh) => {
        mesh.children.forEach((child) => {
          child.geometry?.dispose();
          child.material?.dispose();
        });
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
      gradeGroupRef.current = null;
    }

    const group = addGradeBlocksToScene(scene.scene, blockSet);
    gradeGroupRef.current = group;

    // Register meshes with the scene's selection glow system
    scene.selectables = Array.from(group.children);

    // Compute bounding box from all vertices across all blocks to fit camera
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    blockSet.blocks.forEach(({ vertices }) => {
      vertices.forEach(([x, y, z]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      });
    });

    // Center the group at the origin so the camera controls work naturally
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    group.position.set(-cx, -cy, -cz);

    scene._fitCameraToBounds({
      minX: minX - cx, maxX: maxX - cx,
      minY: minY - cy, maxY: maxY - cy,
      minZ: minZ - cz, maxZ: maxZ - cz,
    });

    // Attach click handler to detect which grade block mesh was clicked
    const handleClick = (event) => {
      if (event.button !== 0) return;
      if (!scene.raycaster || !scene.camera || !scene.renderer) return;
      const rect = scene.renderer.domElement.getBoundingClientRect();
      scene.raycaster.setFromCamera(
        {
          x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
          y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
        },
        scene.camera
      );
      const hits = scene.raycaster.intersectObjects(group.children, false);
      if (hits.length > 0) {
        setSelectedBlock(hits[0].object.userData);
      } else {
        setSelectedBlock(null);
      }
    };
    scene.renderer.domElement.addEventListener('click', handleClick);
    return () => {
      scene.renderer?.domElement.removeEventListener('click', handleClick);
      scene.selectables = [];
    };
  }, [blockSet]);

  // Toggle edge-line overlay on the selected block mesh
  useEffect(() => {
    const group = gradeGroupRef.current;
    if (!group) return;
    group.children.forEach((mesh) => {
      const edgeLines = mesh.children[0];
      if (edgeLines) edgeLines.visible = mesh.userData.id === selectedBlock?.id;
    });
  }, [selectedBlock]);

  useEffect(() => {
    sceneRef.current?.setControlMode(controlMode);
  }, [controlMode]);

  return (
    <div className="polygon-blocks-container">
      <div className="polygon-blocks-header">
        <h1>Polygon Blocks</h1>
        <div className="polygon-blocks-header-meta">
          {blockSet && (
            <span className="polygon-blocks-info">
              {blockSet.blocks.length} block{blockSet.blocks.length !== 1 ? 's' : ''} loaded
              {blockSet.units ? ` · ${blockSet.units}` : ''}
            </span>
          )}
          {error && <span className="polygon-blocks-error">{error}</span>}
        </div>
      </div>

      <div className="polygon-blocks-canvas" ref={containerRef}>
        {!blockSet && !error && (
          <div className="polygon-blocks-placeholder">
            <p>Loading grade blocks…</p>
          </div>
        )}

        <Baselode3DControls
          controlMode={controlMode}
          onToggleFly={() => setControlMode((m) => (m === 'orbit' ? 'fly' : 'orbit'))}
          onRecenter={() => sceneRef.current?.recenterCameraToOrigin(2000)}
          onLookDown={() => sceneRef.current?.lookDown(3000)}
          onFit={() => sceneRef.current?.focusOnLastBounds(1.2)}
        />

        {selectedBlock && (
          <div className="polygon-blocks-info-panel">
            <button
              className="polygon-blocks-info-close"
              onClick={() => setSelectedBlock(null)}
              aria-label="Close"
            >
              ×
            </button>
            <h3>{selectedBlock.id}</h3>
            {selectedBlock.attributes &&
              Object.entries(selectedBlock.attributes).map(([k, v]) => (
                <div key={k} className="polygon-blocks-attr">
                  <span className="polygon-blocks-attr-key">{k}</span>
                  <span className="polygon-blocks-attr-val">{String(v)}</span>
                </div>
              ))}
          </div>
        )}

        {blockSet && (
          <div className="polygon-blocks-legend">
            {blockSet.blocks.map((block) => (
              <div key={block.id} className="polygon-blocks-legend-item">
                <span
                  className="polygon-blocks-legend-swatch"
                  style={{ background: block.material?.color ?? '#888' }}
                />
                <span className="polygon-blocks-legend-label">{block.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PolygonBlocks;
