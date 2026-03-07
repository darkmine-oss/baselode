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
 * @param {'x'|'y'|null} props.sectionMode - Active section axis, or null when inactive
 * @param {Function} props.onToggleSectionX - Toggle East–West (X-axis) section mode
 * @param {Function} props.onToggleSectionY - Toggle North–South (Y-axis) section mode
 * @param {Function} props.onStepSection - Step the section plane; receives delta in world units
 * @param {number} props.sectionStep - World-unit step size used by the step buttons (default 25)
 * @param {number} props.sectionPosition - Current section plane world coordinate
 * @param {{min:number,max:number}|null} props.sectionRange - Data extent for the slider; null hides it
 * @param {Function} props.onSetSectionPosition - Called with absolute world coordinate from slider
 * @param {boolean} props.sliceActive - Whether slab-slice mode is active
 * @param {Function} props.onToggleSlice - Toggle slab-slice mode
 * @param {Function} props.onStepSlice - Step the slice plane; receives delta in world units
 * @param {number} props.sliceStep - World-unit step size used by the slice step buttons (default 25)
 * @param {number} props.slicePosition - Current slice plane signed distance from origin
 * @param {{min:number,max:number}|null} props.sliceRange - Data extent along slice normal; null hides slider
 * @param {Function} props.onSetSlicePosition - Called with absolute distance from slider
 * @param {number} props.sliceWidth - Total slab thickness in world units (default 50)
 * @param {Function} props.onSetSliceWidth - Called with new width value
 * @param {Function} props.onDrawSlice - Enter draw-slice mode (user draws a knife line on the canvas)
 * @param {boolean} props.drawingSlice - Whether draw-slice mode is active
 * @param {Function} props.onCancelDraw - Cancel draw-slice mode
 * @returns {JSX.Element} Control buttons component
 */
function Baselode3DControls({
  controlMode = 'orbit',
  onToggleFly = () => {},
  onRecenter = () => {},
  onLookDown = () => {},
  onFit = () => {},
  sectionMode = null,
  onToggleSectionX = () => {},
  onToggleSectionY = () => {},
  onStepSection = () => {},
  sectionStep = 25,
  sectionPosition = 0,
  sectionRange = null,
  onSetSectionPosition = () => {},
  sliceActive = false,
  onToggleSlice = () => {},
  onStepSlice = () => {},
  sliceStep = 25,
  slicePosition = 0,
  sliceRange = null,
  onSetSlicePosition = () => {},
  sliceWidth = 50,
  onSetSliceWidth = () => {},
  onDrawSlice = () => {},
  drawingSlice = false,
  onCancelDraw = () => {},
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

      <div className="baselode-3d-controls-group">
        <button
          type="button"
          className={`ghost-button${sectionMode === 'x' ? ' active' : ''}`}
          onClick={onToggleSectionX}
          title="East–West cross-section (orthographic, looks in −X)"
        >
          Section X
        </button>
        <button
          type="button"
          className={`ghost-button${sectionMode === 'y' ? ' active' : ''}`}
          onClick={onToggleSectionY}
          title="North–South cross-section (orthographic, looks in −Y)"
        >
          Section Y
        </button>
        {sectionMode && (
          <>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onStepSection(-sectionStep)}
              title={`Step section −${sectionStep} m`}
            >
              ←
            </button>
            {sectionRange && (
              <input
                type="range"
                className="baselode-3d-slider"
                min={sectionRange.min}
                max={sectionRange.max}
                step="any"
                value={sectionPosition}
                onChange={(e) => onSetSectionPosition(Number(e.target.value))}
                title={`Section position: ${sectionPosition.toFixed(0)} m`}
              />
            )}
            <button
              type="button"
              className="ghost-button"
              onClick={() => onStepSection(sectionStep)}
              title={`Step section +${sectionStep} m`}
            >
              →
            </button>
            {sectionRange && (
              <span className="baselode-3d-position-label" title="Current section position">
                {sectionPosition.toFixed(0)} m
              </span>
            )}
          </>
        )}
      </div>

      <div className="baselode-3d-controls-group">
        {drawingSlice ? (
          <button
            type="button"
            className="ghost-button"
            onClick={onCancelDraw}
            title="Cancel draw-slice mode"
          >
            Cancel draw
          </button>
        ) : (
          <>
            <button
              type="button"
              className="ghost-button"
              onClick={onDrawSlice}
              title="Click and drag on the scene to define the slice plane"
            >
              Draw slice
            </button>
            <button
              type="button"
              className={`ghost-button${sliceActive ? ' active' : ''}`}
              onClick={onToggleSlice}
              title="Slab slice — show only geometry within a finite thickness"
            >
              Slice
            </button>
          </>
        )}
        {sliceActive && !drawingSlice && (
          <>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onStepSlice(-sliceStep)}
              title={`Move slice −${sliceStep} m`}
            >
              ←
            </button>
            {sliceRange && (
              <input
                type="range"
                className="baselode-3d-slider"
                min={sliceRange.min}
                max={sliceRange.max}
                step="any"
                value={slicePosition}
                onChange={(e) => onSetSlicePosition(Number(e.target.value))}
                title={`Slice position: ${slicePosition.toFixed(0)} m`}
              />
            )}
            <button
              type="button"
              className="ghost-button"
              onClick={() => onStepSlice(sliceStep)}
              title={`Move slice +${sliceStep} m`}
            >
              →
            </button>
            {sliceRange && (
              <span className="baselode-3d-position-label" title="Current slice position">
                {slicePosition.toFixed(0)} m
              </span>
            )}
            <label className="baselode-3d-width-label" title="Total slab thickness in metres">
              W:
              <input
                type="number"
                className="baselode-3d-width-input"
                min={1}
                step={10}
                value={sliceWidth}
                onChange={(e) => {
                  const w = Math.max(1, Number(e.target.value));
                  if (Number.isFinite(w)) onSetSliceWidth(w);
                }}
              />
              m
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export default Baselode3DControls;
