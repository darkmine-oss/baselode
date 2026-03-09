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
    </div>
  );
}

export default Baselode3DControls;
