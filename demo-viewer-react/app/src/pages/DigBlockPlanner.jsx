/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useMemo, useState } from 'react';
import { createSyntheticDigBlockModel, digDirectionAxes, optimizeDigBlocks } from 'baselode';
import './DigBlockPlanner.css';

const DEFAULT_CONTROLS = {
  digDirectionDeg: 20,
  targetTonnes: 10_000,
  targetGrade: 57,
  targetFaceToDepthRatio: 1.8,
  minFaceWidth: 20,
  weights: { tonnes: 1, grade: 0.8, shape: 0.65, material: 0.15, hardness: 0.1 },
};

const ABOVE_CUTOFF_COLOUR = '#dc2626';
const BELOW_CUTOFF_COLOUR = '#2563eb';

function formatKt(tonnes) {
  return `${(tonnes / 1000).toFixed(tonnes >= 100_000 ? 0 : 1)} kt`;
}

function gradeColour(grade) {
  const amount = Math.max(0, Math.min(1, (grade - 50) / 12));
  const hue = 18 + amount * 105;
  return `hsl(${hue} 68% ${58 - amount * 12}%)`;
}

function Control({ label, value, min, max, step, unit, onChange }) {
  return (
    <label className="dig-control">
      <span className="dig-control-label">
        <span>{label}</span>
        <output>{Number(value).toFixed(step < 1 ? 1 : 0)}{unit}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function DigBlockPlanner() {
  const source = useMemo(() => createSyntheticDigBlockModel(), []);
  const [controls, setControls] = useState(DEFAULT_CONTROLS);
  const [selectedId, setSelectedId] = useState(null);
  const [showSource, setShowSource] = useState(true);
  const [blockDisplayMode, setBlockDisplayMode] = useState('cutoff');

  const solution = useMemo(() => {
    const started = performance.now();
    const result = optimizeDigBlocks(source.cells, source.blastPolygon, controls);
    return { ...result, solveMs: performance.now() - started };
  }, [controls, source]);

  const selected = solution.blocks.find((block) => block.id === selectedId) || null;
  const selectedCells = new Set(selected?.cellIds || []);
  const allPoints = source.blastPolygon;
  const minX = Math.min(...allPoints.map(([x]) => x));
  const maxX = Math.max(...allPoints.map(([x]) => x));
  const minY = Math.min(...allPoints.map(([, y]) => y));
  const maxY = Math.max(...allPoints.map(([, y]) => y));
  const pad = 12;
  const svgY = (y) => minY + maxY - y;
  const polygonPoints = (ring) => ring.map(([x, y]) => `${x},${svgY(y)}`).join(' ');
  const axes = digDirectionAxes(controls.digDirectionDeg);
  const blastCentre = {
    x: allPoints.reduce((sum, [x]) => sum + x, 0) / allPoints.length,
    y: allPoints.reduce((sum, [, y]) => sum + y, 0) / allPoints.length,
  };
  const arrowStart = { x: blastCentre.x - axes.forward.x * 26, y: blastCentre.y - axes.forward.y * 26 };
  const arrowEnd = { x: blastCentre.x + axes.forward.x * 26, y: blastCentre.y + axes.forward.y * 26 };

  const update = (key, value) => setControls((current) => ({ ...current, [key]: value }));
  const updateWeight = (key, value) => setControls((current) => ({
    ...current,
    weights: { ...current.weights, [key]: value },
  }));

  return (
    <div className="dig-planner">
      <header className="dig-header">
        <div>
          <p className="dig-eyebrow">Interactive grade control concept</p>
          <h1>Dig Block Planner</h1>
          <p>Subdivide a blast into practical mining shapes while balancing tonnes, grade and dig direction.</p>
        </div>
        <div className="dig-live-pill"><span /> Live solution · {solution.solveMs.toFixed(1)} ms</div>
      </header>

      <section className="dig-metrics" aria-label="Solution summary">
        <div><span>Blast tonnes</span><strong>{formatKt(solution.metrics.totalTonnes)}</strong></div>
        <div><span>Dig blocks</span><strong>{solution.metrics.blockCount}</strong></div>
        <div><span>Average block</span><strong>{formatKt(solution.metrics.totalTonnes / solution.metrics.blockCount)}</strong></div>
        <div><span>Head grade</span><strong>{solution.metrics.weightedGrade.toFixed(1)}% Fe</strong></div>
        <div><span>Mean grade miss</span><strong>±{solution.metrics.meanGradeError.toFixed(1)}%</strong></div>
      </section>

      <div className="dig-workspace">
        <main className="dig-canvas-card">
          <div className="dig-canvas-toolbar">
            <div>
              <strong>Synthetic iron-ore bench</strong>
              <span> · {source.cells.length} cells · 10 × 10 × 5 m</span>
            </div>
            <div className="dig-canvas-actions">
              <div className="dig-display-toggle" role="group" aria-label="Dig block display">
                <button
                  type="button"
                  className={blockDisplayMode === 'cutoff' ? 'active' : ''}
                  aria-pressed={blockDisplayMode === 'cutoff'}
                  onClick={() => setBlockDisplayMode('cutoff')}
                >
                  Red / blue
                </button>
                <button
                  type="button"
                  className={blockDisplayMode === 'outline' ? 'active' : ''}
                  aria-pressed={blockDisplayMode === 'outline'}
                  onClick={() => setBlockDisplayMode('outline')}
                >
                  Outline only
                </button>
              </div>
              <label><input type="checkbox" checked={showSource} onChange={(event) => setShowSource(event.target.checked)} /> Grade cells</label>
            </div>
          </div>

          <div className="dig-canvas-wrap">
            <svg
              className="dig-canvas"
              viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
              role="img"
              aria-label="Plan view of a blast subdivided into generated dig blocks"
            >
              <defs>
                <marker id="dig-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#172554" />
                </marker>
                <filter id="selected-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#ffffff" floodOpacity="1" />
                </filter>
              </defs>

              <polygon className="dig-blast-fill" points={polygonPoints(source.blastPolygon)} />
              {showSource && source.cells.map((cell) => (
                <rect
                  key={cell.id}
                  x={cell.x - cell.dx / 2}
                  y={svgY(cell.y + cell.dy / 2)}
                  width={cell.dx}
                  height={cell.dy}
                  fill={gradeColour(cell.fe)}
                  opacity={selected && !selectedCells.has(cell.id) ? 0.14 : 0.72}
                  className="dig-source-cell"
                >
                  <title>{cell.id}: {cell.fe.toFixed(1)}% Fe · {formatKt(cell.tonnes)} · {cell.geology}</title>
                </rect>
              ))}

              {solution.blocks.map((block) => {
                const aboveCutoff = block.headGrade >= controls.targetGrade;
                return (
                  <polygon
                    key={block.id}
                    points={polygonPoints(block.polygon)}
                    fill={aboveCutoff ? ABOVE_CUTOFF_COLOUR : BELOW_CUTOFF_COLOUR}
                    fillOpacity={blockDisplayMode === 'outline' ? 0 : selected ? (selected.id === block.id ? 0.88 : 0.12) : 0.68}
                    className={`dig-result-block ${aboveCutoff ? 'above-cutoff' : 'below-cutoff'}${blockDisplayMode === 'outline' ? ' outline-only' : ''}${selected?.id === block.id ? ' selected' : ''}`}
                    aria-label={`${block.id}, ${aboveCutoff ? 'at or above' : 'below'} grade cut-off`}
                    onClick={() => setSelectedId((current) => current === block.id ? null : block.id)}
                  >
                    <title>{block.id}: {formatKt(block.tonnes)} · {block.headGrade.toFixed(1)}% Fe · {aboveCutoff ? 'at or above' : 'below'} {controls.targetGrade.toFixed(1)}% cut-off</title>
                  </polygon>
                );
              })}

              {solution.blocks.map((block) => (
                <g key={`${block.id}-label`} className="dig-block-label" pointerEvents="none">
                  <text x={block.centroid.x} y={svgY(block.centroid.y) - 1.7}>{block.id.replace('DIG-', '')}</text>
                  <text x={block.centroid.x} y={svgY(block.centroid.y) + 3.2}>{(block.tonnes / 1000).toFixed(1)}kt</text>
                </g>
              ))}

              <polygon className="dig-blast-outline" points={polygonPoints(source.blastPolygon)} />
              <line
                className="dig-direction-line"
                x1={arrowStart.x}
                y1={svgY(arrowStart.y)}
                x2={arrowEnd.x}
                y2={svgY(arrowEnd.y)}
                markerEnd="url(#dig-arrow)"
              />
              <text className="dig-direction-label" x={arrowStart.x} y={svgY(arrowStart.y) + 7}>DIG</text>
              <text className="dig-north" x={maxX - 3} y={svgY(maxY - 4)}>N ↑</text>
            </svg>

            <div className="dig-legend">
              {blockDisplayMode === 'cutoff' ? (
                <>
                  <span><i className="block-above" /> ≥ {controls.targetGrade.toFixed(1)}% Fe</span>
                  <span><i className="block-below" /> &lt; {controls.targetGrade.toFixed(1)}% Fe</span>
                </>
              ) : <span><i className="block-outline" /> Dig-block outline</span>}
              <span><i className="cell-grade-scale" /> Source-cell Fe</span>
            </div>
          </div>

          <div className="dig-selection" aria-live="polite">
            {selected ? (
              <>
                <div><span>Selected</span><strong>{selected.id}</strong></div>
                <div><span>Tonnes</span><strong>{formatKt(selected.tonnes)}</strong></div>
                <div><span>Head grade</span><strong>{selected.headGrade.toFixed(1)}% Fe</strong></div>
                <div>
                  <span>Cut-off class</span>
                  <strong className={selected.headGrade >= controls.targetGrade ? 'cutoff-above' : 'cutoff-below'}>
                    {selected.headGrade >= controls.targetGrade ? 'At / above' : 'Below'} {controls.targetGrade.toFixed(1)}%
                  </strong>
                </div>
                <div><span>Shape</span><strong>{selected.faceWidth.toFixed(0)} × {selected.advanceDepth.toFixed(0)} m</strong></div>
                <div><span>Material</span><strong>{selected.dominantGeology}</strong></div>
                <button type="button" onClick={() => setSelectedId(null)}>Clear</button>
              </>
            ) : <p>Select a generated block to inspect its tonnes, blended grade and digging shape.</p>}
          </div>
        </main>

        <aside className="dig-controls-card">
          <div className="dig-controls-heading">
            <div><p>Design controls</p><h2>Shape the block-out</h2></div>
            <button type="button" onClick={() => { setControls(DEFAULT_CONTROLS); setSelectedId(null); }}>Reset</button>
          </div>

          <div className="dig-control-group">
            <h3>Production targets</h3>
            <Control label="Target tonnes" value={controls.targetTonnes / 1000} min={6} max={20} step={0.5} unit=" kt" onChange={(value) => update('targetTonnes', value * 1000)} />
            <Control label="Target / grade cut-off" value={controls.targetGrade} min={52} max={62} step={0.1} unit="% Fe" onChange={(value) => update('targetGrade', value)} />
          </div>

          <div className="dig-control-group">
            <h3>Mining geometry</h3>
            <Control label="Dig direction" value={controls.digDirectionDeg} min={0} max={359} step={1} unit="°" onChange={(value) => update('digDirectionDeg', value)} />
            <Control label="Face : advance" value={controls.targetFaceToDepthRatio} min={0.8} max={3.5} step={0.1} unit=":1" onChange={(value) => update('targetFaceToDepthRatio', value)} />
            <Control label="Minimum face width" value={controls.minFaceWidth} min={10} max={50} step={1} unit=" m" onChange={(value) => update('minFaceWidth', value)} />
          </div>

          <div className="dig-control-group">
            <h3>Competing priorities</h3>
            <Control label="Tonnes" value={controls.weights.tonnes} min={0} max={2} step={0.1} unit="" onChange={(value) => updateWeight('tonnes', value)} />
            <Control label="Grade" value={controls.weights.grade} min={0} max={2} step={0.1} unit="" onChange={(value) => updateWeight('grade', value)} />
            <Control label="Dig shape" value={controls.weights.shape} min={0} max={2} step={0.1} unit="" onChange={(value) => updateWeight('shape', value)} />
            <Control label="Material mixing" value={controls.weights.material} min={0} max={1} step={0.05} unit="" onChange={(value) => updateWeight('material', value)} />
          </div>

          <div className="dig-method-note">
            <strong>First-pass heuristic</strong>
            <p>Cells rotate into mining coordinates, split into advancing bands, then use a bounded shortest-path search to choose contiguous face cuts with the lowest weighted penalty.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default DigBlockPlanner;
