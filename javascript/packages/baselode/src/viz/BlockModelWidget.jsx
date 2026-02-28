/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import './BlockModelWidget.css';

/**
 * A panel of controls for exploring a block model in the 3-D scene.
 *
 * Exports widget state (attribute selection, opacity) so that a wrapping
 * application can pass the values on to the 3-D scene.  Renders:
 *   - An attribute (color-by) drop-down selector
 *   - A translucency / opacity slider
 *   - A simple color-scale legend (numeric attributes)
 *   - A popup card showing all attributes of the last clicked block
 *
 * @param {Object} props
 * @param {Array<string>} props.properties - List of attribute column names
 * @param {string} props.selectedProperty - Currently selected attribute
 * @param {Function} props.onPropertyChange - Called with new property name string
 * @param {number} props.opacity - Current opacity value (0–1, default 0.85)
 * @param {Function} props.onOpacityChange - Called with new opacity number
 * @param {Object|null} props.propertyStats - Stats object for the selected
 *   property (``{type, min?, max?, categories?}`` from calculatePropertyStats)
 * @param {Object|null} props.clickedBlock - Block row data to display in the
 *   popup, or null when no block is selected
 * @param {Function} props.onPopupClose - Called when the user dismisses the popup
 */
function BlockModelWidget({
  properties = [],
  selectedProperty = '',
  onPropertyChange = () => {},
  opacity = 0.85,
  onOpacityChange = () => {},
  propertyStats = null,
  clickedBlock = null,
  onPopupClose = () => {},
}) {
  return (
    <div className="bm-widget">
      {/* Attribute selector */}
      <label className="bm-widget__label" htmlFor="bm-property-select">
        Color by
      </label>
      <select
        id="bm-property-select"
        className="bm-widget__select"
        value={selectedProperty}
        onChange={(e) => onPropertyChange(e.target.value)}
      >
        {properties.length === 0 && (
          <option value="">— no attributes —</option>
        )}
        {properties.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      {/* Color scale legend */}
      {propertyStats && propertyStats.type === 'numeric' && (
        <div className="bm-widget__scale">
          <span className="bm-widget__scale-label bm-widget__scale-label--min">
            {propertyStats.min?.toFixed(2) ?? '—'}
          </span>
          <div className="bm-widget__scale-bar" />
          <span className="bm-widget__scale-label bm-widget__scale-label--max">
            {propertyStats.max?.toFixed(2) ?? '—'}
          </span>
        </div>
      )}
      {propertyStats && propertyStats.type === 'categorical' && (
        <div className="bm-widget__categories">
          {(propertyStats.categories || []).map((cat, i) => {
            const hue = Math.round((i / Math.max(propertyStats.categories.length, 1)) * 360);
            return (
              <span key={cat} className="bm-widget__category-chip"
                style={{ background: `hsl(${hue},70%,50%)` }}>
                {cat}
              </span>
            );
          })}
        </div>
      )}

      {/* Opacity slider */}
      <label className="bm-widget__label" htmlFor="bm-opacity-slider">
        Opacity ({Math.round(opacity * 100)}%)
      </label>
      <input
        id="bm-opacity-slider"
        type="range"
        className="bm-widget__slider"
        min="0"
        max="1"
        step="0.01"
        value={opacity}
        onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
      />

      {/* Block attribute popup */}
      {clickedBlock && (
        <div className="bm-widget__popup">
          <div className="bm-widget__popup-header">
            <span>Block attributes</span>
            <button
              type="button"
              className="bm-widget__popup-close"
              onClick={onPopupClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <table className="bm-widget__popup-table">
            <tbody>
              {Object.entries(clickedBlock).map(([key, value]) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>{value === null || value === undefined ? '—' : String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default BlockModelWidget;
