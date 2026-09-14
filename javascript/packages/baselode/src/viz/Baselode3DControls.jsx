/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import './Baselode3DControls.css';

function SectionOverview({ bounds, sectionAxis, sectionPosition, sliceAxis, slicePosition, sliceWidth, overviewPoints = [], overviewPaths = [] }) {
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
  const pathPoints = (path) => path
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => `${toX(point.x)},${toY(point.y)}`)
    .join(' ');

  return (
    <div className="baselode-section-overview" aria-label="Top-down section overview">
      <div className="baselode-section-overview-title">Top down</div>
      <svg viewBox="0 0 140 140" role="img" aria-label={`${activeAxis.toUpperCase()} ${isSlab ? 'slice' : 'section'} position`}>
        <rect x="10" y="10" width="120" height="120" className="baselode-section-overview-bounds" />
        {overviewPaths.map((path, index) => {
          const points = pathPoints(path);
          return points ? <polyline key={index} points={points} className="baselode-section-overview-trace" /> : null;
        })}
        {overviewPoints.map((point, index) => (
          <circle key={index} cx={toX(point.x)} cy={toY(point.y)} r="1" className="baselode-section-overview-point" />
        ))}
        {isSlab && (isX
          ? <rect x={linePosition - bandSize / 2} y="10" width={bandSize} height="120" className="baselode-section-overview-slab" />
          : <rect x="10" y={linePosition - bandSize / 2} width="120" height={bandSize} className="baselode-section-overview-slab" />
        )}
        {isX
          ? <line x1={linePosition} x2={linePosition} y1="10" y2="130" className="baselode-section-overview-line" />
          : <line x1="10" x2="130" y1={linePosition} y2={linePosition} className="baselode-section-overview-line" />
        }
        {isX
          ? <path d={`M 10 ${70} l 8 -5 v 10 z`} className="baselode-section-overview-camera" />
          : <path d={`M ${70} 130 l -5 -8 h 10 z`} className="baselode-section-overview-camera" />
        }
      </svg>
      <span className="baselode-section-overview-axis">X → &nbsp; Y ↑ · camera ●</span>
    </div>
  );
}

function Toggle({ checked, onChange, label, title }) {
  return (
    <label className="baselode-3d-controls-checkbox" title={title}>
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * 3D scene control panel.
 *
 * Existing props (camera / section / slab) are unchanged.  The new groups
 * render only when their handler is supplied, so hosts can opt in piecemeal:
 *
 *   projection / onToggleProjection          perspective ↔ orthographic
 *   showGrid / onToggleGrid                  ground grid
 *   showExtent / onToggleExtent              extent box
 *   showLabels / onToggleLabels              hole-id labels
 *   showCollars / onToggleCollars            collar markers
 *   fog / onToggleFog                        depth-cue fog
 *   radiusScale / onSetRadiusScale           tube thickness multiplier (0.25–4)
 *   constantWidth / onToggleConstantWidth    screen-constant tube width
 *   lodEnabled / onToggleLod                 far-view line level of detail
 *   filterText / onSetFilterText             ghost holes not matching text
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
  overviewPoints = [],
  overviewPaths = [],
  projection = 'perspective',
  onToggleProjection = null,
  showGrid = true,
  onToggleGrid = null,
  showExtent = false,
  onToggleExtent = null,
  showLabels = true,
  onToggleLabels = null,
  showCollars = true,
  onToggleCollars = null,
  fog = false,
  onToggleFog = null,
  radiusScale = 1,
  onSetRadiusScale = null,
  constantWidth = false,
  onToggleConstantWidth = null,
  lodEnabled = true,
  onToggleLod = null,
  filterText = '',
  onSetFilterText = null,
}) {
  const hasSceneGroup = onToggleGrid || onToggleExtent || onToggleLabels || onToggleCollars || onToggleFog;
  const hasHoleGroup = onSetRadiusScale || onToggleConstantWidth || onToggleLod || onSetFilterText;
  return (
    <div className={`baselode-3d-controls${darkBackground ? ' baselode-3d-controls--dark' : ''}`} data-baselode-scroll>
      <SectionOverview
        bounds={overviewBounds}
        sectionAxis={sectionAxis}
        sectionPosition={sectionPosition}
        sliceAxis={sliceAxis}
        slicePosition={slicePosition}
        sliceWidth={sliceWidth}
        overviewPoints={overviewPoints}
        overviewPaths={overviewPaths}
      />
      <div className="baselode-3d-controls-group" role="group" aria-label="Camera">
        <button type="button" className="ghost-button" onClick={onFit} title="Frame everything (Home)">Fit</button>
        <button type="button" className="ghost-button" onClick={onLookDown} title="Look straight down (7)">Look down</button>
        <button type="button" className="ghost-button" onClick={onRecenter} title="Recentre on the scene">Recentre</button>
        {onToggleProjection && (
          <button type="button" className={`ghost-button${projection === 'orthographic' ? ' active' : ''}`} onClick={onToggleProjection} title="Perspective / orthographic (5)">
            {projection === 'orthographic' ? 'Ortho' : 'Persp'}
          </button>
        )}
        <button type="button" className={`ghost-button${controlMode === 'fly' ? ' active' : ''}`} onClick={onToggleFly} title="First-person walk: W A S D, Q E, Shift">
          {controlMode === 'orbit' ? 'Walk' : 'Exit walk'}
        </button>
      </div>
      {hasSceneGroup && (
        <div className="baselode-3d-controls-group" role="group" aria-label="Scene">
          {onToggleGrid && <Toggle checked={showGrid} onChange={onToggleGrid} label="Grid" title="Ground grid at collar datum (G)" />}
          {onToggleExtent && <Toggle checked={showExtent} onChange={onToggleExtent} label="Extent" title="Hairline extent box with dimensions" />}
          {onToggleLabels && <Toggle checked={showLabels} onChange={onToggleLabels} label="Labels" title="Hole-id labels (L)" />}
          {onToggleCollars && <Toggle checked={showCollars} onChange={onToggleCollars} label="Collars" title="Collar markers" />}
          {onToggleFog && <Toggle checked={fog} onChange={onToggleFog} label="Fog" title="Depth-cue fog" />}
          <Toggle checked={darkBackground} onChange={(v) => onToggleDarkBackground({ target: { checked: v } })} label="Dark" title="Dark background" />
        </div>
      )}
      {!hasSceneGroup && (
        <label className="baselode-3d-controls-checkbox">
          <input type="checkbox" checked={darkBackground} onChange={onToggleDarkBackground} />
          Dark background
        </label>
      )}
      {hasHoleGroup && (
        <div className="baselode-3d-controls-group" role="group" aria-label="Holes">
          {onSetRadiusScale && (
            <label className="baselode-3d-width-label" title="Tube thickness">
              Thickness
              <input aria-label="Tube thickness" className="baselode-3d-slider baselode-3d-slider--short" type="range" min="0.25" max="4" step="0.05" value={radiusScale} onChange={(e) => onSetRadiusScale(Number(e.target.value))} />
            </label>
          )}
          {onToggleConstantWidth && <Toggle checked={constantWidth} onChange={onToggleConstantWidth} label="Px width" title="Keep tubes the same width on screen at any distance" />}
          {onToggleLod && <Toggle checked={lodEnabled} onChange={onToggleLod} label="Far LOD" title="Draw lines instead of tubes when zoomed far out" />}
          {onSetFilterText && (
            <input
              aria-label="Filter holes by id"
              className="baselode-3d-filter"
              type="search"
              placeholder="Filter hole id…"
              value={filterText}
              onChange={(e) => onSetFilterText(e.target.value)}
            />
          )}
        </div>
      )}
      <div className="baselode-3d-controls-group" role="group" aria-label="Section">
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
      <div className="baselode-3d-controls-group" role="group" aria-label="Slab">
        <button type="button" className={`ghost-button${sliceAxis ? ' active' : ''}`} onClick={() => onToggleSlice(sliceAxis || 'x')}>Slice</button>
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
