/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import './Baselode3DControls.css';

function SectionOverview({ bounds, sectionAxis, sectionPosition, sliceAxis, slicePosition, sliceWidth }) {
  if (!bounds || (!sectionAxis && !sliceAxis)) return null;
  const width = Number(bounds.maxX) - Number(bounds.minX);
  const height = Number(bounds.maxY) - Number(bounds.minY);
  if (!(width > 0) || !(height > 0)) return null;
  const activeAxis = sectionAxis || sliceAxis;
  const activePosition = sectionAxis ? sectionPosition : slicePosition;
  const isSlab = Boolean(sliceAxis);
  const toX = (value) => 10 + ((value - bounds.minX) / width) * 120;
  const toY = (value) => 130 - ((value - bounds.minY) / height) * 120;
  const isX = activeAxis === 'x';
  const linePosition = isX ? toX(activePosition) : toY(activePosition);
  const bandSize = isX ? (sliceWidth / width) * 120 : (sliceWidth / height) * 120;

  return (
    <div className="baselode-section-overview" aria-label="Top-down section overview">
      <div className="baselode-section-overview-title">Top down</div>
      <svg viewBox="0 0 140 140" role="img" aria-label={`${activeAxis.toUpperCase()} ${isSlab ? 'slab' : 'section'} position`}>
        <rect x="10" y="10" width="120" height="120" className="baselode-section-overview-bounds" />
        {isSlab && (isX
          ? <rect x={linePosition - bandSize / 2} y="10" width={bandSize} height="120" className="baselode-section-overview-slab" />
          : <rect x="10" y={linePosition - bandSize / 2} width="120" height={bandSize} className="baselode-section-overview-slab" />
        )}
        {isX
          ? <line x1={linePosition} x2={linePosition} y1="10" y2="130" className="baselode-section-overview-line" />
          : <line x1="10" x2="130" y1={linePosition} y2={linePosition} className="baselode-section-overview-line" />
        }
      </svg>
      <span className="baselode-section-overview-axis">X → &nbsp; Y ↑</span>
    </div>
  );
}

/**
 * 3D scene control buttons component
 * Provides UI controls for camera manipulation in the 3D drillhole viewer
 * @param {Object} props - Component props
 * @param {string} props.controlMode - Current control mode ('orbit' or 'fly')
 * @param {Function} props.onToggleFly - Handler for toggling fly mode
 * @param {Function} props.onRecenter - Handler for recentering camera
 * @param {Function} props.onLookDown - Handler for top-down view
 * @param {Function} props.onFit - Handler for fitting camera to scene
 * @returns {JSX.Element} Control buttons component
 */
function Baselode3DControls({
  controlMode = 'orbit',
  onToggleFly = () => {},
  onRecenter = () => {},
  onLookDown = () => {},
  onFit = () => {},
  darkBackground = false,
  onToggleDarkBackground = () => {},
  sectionAxis = null,
  sectionPosition = 0,
  sectionRange = null,
  onToggleSection = () => {},
  onSetSectionPosition = () => {},
  sliceAxis = null,
  slicePosition = 0,
  sliceWidth = 50,
  sliceRange = null,
  onToggleSlice = () => {},
  onSetSliceAxis = () => {},
  onSetSlicePosition = () => {},
  onSetSliceWidth = () => {},
  overviewBounds = null,
}) {
  return (
    <div className="baselode-3d-controls">
      <SectionOverview
        bounds={overviewBounds}
        sectionAxis={sectionAxis}
        sectionPosition={sectionPosition}
        sliceAxis={sliceAxis}
        slicePosition={slicePosition}
        sliceWidth={sliceWidth}
      />
      <button type="button" className="ghost-button" onClick={onRecenter}>
        Recenter to (0,0,0)
      </button>
      <button type="button" className="ghost-button" onClick={onLookDown}>
        Look down
      </button>
      <button type="button" className="ghost-button" onClick={onFit}>
        Fit to scene
      </button>
      <button type="button" className="ghost-button" onClick={onToggleFly}>
        {controlMode === 'orbit' ? 'Enable fly controls' : 'Disable fly controls'}
      </button>
      <label className="baselode-3d-controls-checkbox">
        <input
          type="checkbox"
          checked={darkBackground}
          onChange={onToggleDarkBackground}
        />
        Dark background
      </label>
      <div className="baselode-3d-controls-group">
        <button type="button" className={`ghost-button${sectionAxis === 'x' ? ' active' : ''}`} onClick={() => onToggleSection('x')}>Section X</button>
        <button type="button" className={`ghost-button${sectionAxis === 'y' ? ' active' : ''}`} onClick={() => onToggleSection('y')}>Section Y</button>
        {sectionAxis && sectionRange && (
          <input
            aria-label={`${sectionAxis.toUpperCase()} section position`}
            className="baselode-3d-slider"
            type="range"
            min={sectionRange.min}
            max={sectionRange.max}
            step="any"
            value={sectionPosition}
            onChange={(event) => onSetSectionPosition(Number(event.target.value))}
          />
        )}
      </div>
      <div className="baselode-3d-controls-group">
        <button type="button" className={`ghost-button${sliceAxis ? ' active' : ''}`} onClick={() => onToggleSlice(sliceAxis || 'x')}>Slab</button>
        {sliceAxis && <>
          <button type="button" className={`ghost-button${sliceAxis === 'x' ? ' active' : ''}`} onClick={() => onSetSliceAxis('x')}>X</button>
          <button type="button" className={`ghost-button${sliceAxis === 'y' ? ' active' : ''}`} onClick={() => onSetSliceAxis('y')}>Y</button>
          {sliceRange && <input aria-label={`${sliceAxis.toUpperCase()} slab position`} className="baselode-3d-slider" type="range" min={sliceRange.min} max={sliceRange.max} step="any" value={slicePosition} onChange={(event) => onSetSlicePosition(Number(event.target.value))} />}
          <label className="baselode-3d-width-label">Width <input aria-label="Slab width" type="number" min="0.001" step="1" value={sliceWidth} onChange={(event) => onSetSliceWidth(Number(event.target.value))} /></label>
        </>}
      </div>
    </div>
  );
}

export default Baselode3DControls;
