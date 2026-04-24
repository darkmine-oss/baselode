/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import Baselode3DScene from '../viz/baselode3dScene.js';
import { createRasterOverlay } from '../viz/rasterOverlayScene.js';

export function Baselode3DSceneToolUI({
  id,
  title,
  subtitle,
  height = 520,
  background = 'white',
  controlMode = 'orbit',
  drillholes,
  stripLogs = [],
  structuralDiscs,
  blocks,
  rasterOverlays = [],
  camera,
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return undefined;

    let disposed = false;
    const scene = new Baselode3DScene();
    sceneRef.current = scene;

    async function renderScene() {
      try {
        setRenderError('');
        scene.init(target);
        scene.setBackground(background);
        scene.setControlMode(controlMode);

        const holes = drillholes?.holes || [];
        if (holes.length) {
          scene.setDrillholes(holes, drillholes?.options || {});
        }

        if (holes.length && stripLogs.length) {
          scene.setStripLogs(holes, stripLogs);
        }

        if (structuralDiscs?.structures?.length) {
          scene.setStructuralDiscs(
            structuralDiscs.structures,
            holes,
            structuralDiscs.options || {}
          );
          if (structuralDiscs.visible !== undefined) {
            scene.setStructuralDiscsVisible(structuralDiscs.visible);
          }
        }

        if (blocks?.data?.length) {
          scene.setBlocks(
            blocks.data,
            blocks.selectedProperty,
            blocks.stats || {},
            blocks.options || {}
          );
        }

        for (const overlay of rasterOverlays) {
          const layer = await createRasterOverlay(overlay);
          if (disposed) {
            layer.mesh?.geometry?.dispose?.();
            layer.mesh?.material?.dispose?.();
            layer.texture?.dispose?.();
            return;
          }
          scene.addRasterOverlay(layer);
        }

        if (camera?.viewState) {
          scene.setViewState(camera.viewState);
        } else if (camera?.fitToBounds !== false) {
          scene.focusOnLastBounds(camera?.focusPadding || 1.2);
        }
      } catch (err) {
        console.error('Baselode 3D Tool UI render error', err);
        setRenderError(err?.message || '3D scene render error');
      }
    }

    void renderScene();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scene.resize())
      : null;
    resizeObserver?.observe(target);

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [
    background,
    blocks,
    camera,
    controlMode,
    drillholes,
    rasterOverlays,
    stripLogs,
    structuralDiscs,
  ]);

  return (
    <article className="baselode-tool-3d-scene" data-tool-ui-id={id}>
      {(title || subtitle) && (
        <header className="baselode-tool-3d-scene__header">
          {title && <h3>{title}</h3>}
          {subtitle && <p>{subtitle}</p>}
        </header>
      )}
      {renderError && (
        <div className="baselode-tool-3d-scene__error">Scene error: {renderError}</div>
      )}
      <div
        className="baselode-tool-3d-scene__viewport"
        ref={containerRef}
        style={{ height }}
      />
    </article>
  );
}
