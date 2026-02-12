/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import './Baselode3DControls.css';

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
