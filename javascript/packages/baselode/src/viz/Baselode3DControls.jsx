/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import './Baselode3DControls.css';

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
}) {
  return (
    <div className="baselode-3d-controls">
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
