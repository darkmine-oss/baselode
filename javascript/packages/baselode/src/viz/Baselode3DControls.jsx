/*
 * Copyright (C) 2026 Tamara Vasey
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
  onFit = () => {}
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
    </div>
  );
}

export default Baselode3DControls;
