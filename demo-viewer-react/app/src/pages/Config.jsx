/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import { useDrillConfig } from '../context/DrillConfigContext.jsx';
import './Config.css';

function Config() {
  const { config, setPrimaryKey, setCustomKey } = useDrillConfig();
  const [primarySelection, setPrimarySelection] = useState(config.primaryKey || 'companyHoleId');
  const [customKeyInput, setCustomKeyInput] = useState(config.customKey || '');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setPrimarySelection(config.primaryKey || 'companyHoleId');
    setCustomKeyInput(config.customKey || '');
  }, [config]);

  const primaryLabel = useMemo(() => {
    if (primarySelection === 'holeId') return 'Hole ID';
    if (primarySelection === 'collarId') return 'Collar ID';
    if (primarySelection === 'anumber') return 'Anumber';
    if (primarySelection === 'custom') return customKeyInput || 'Custom key';
    return 'Company Hole ID';
  }, [primarySelection, customKeyInput]);

  const handleSave = (event) => {
    event.preventDefault();
    setStatus('');
    if (primarySelection === 'custom' && !customKeyInput.trim()) {
      setError('Enter a custom column name.');
      return;
    }
    setError('');
    setPrimaryKey(primarySelection);
    setCustomKey(primarySelection === 'custom' ? customKeyInput.trim() : '');
    setStatus('Saved. This will be used across map and drillhole viewers.');
  };

  return (
    <div className="config-page">
      <div className="config-card">
        <div className="config-header">
          <div>
            <h1 className="config-title">Drillhole Key Config</h1>
            <p className="config-subtitle">Choose which column identifies drillholes across all viewers.</p>
          </div>
          <div className="config-summary">
            Current primary key: <strong>{primaryLabel}</strong>
          </div>
        </div>

        <form className="config-form" onSubmit={handleSave}>
          <div className="config-field">
            <label className="config-label" htmlFor="primary-key">Primary key</label>
            <select
              id="primary-key"
              className="config-select"
              value={primarySelection}
              onChange={(e) => {
                setPrimarySelection(e.target.value);
                setStatus('');
                if (e.target.value !== 'custom') {
                  setCustomKeyInput('');
                }
              }}
            >
              <option value="companyHoleId">CompanyHoleId (default)</option>
              <option value="holeId">HoleId</option>
              <option value="collarId">CollarId</option>
              <option value="anumber">Anumber</option>
              <option value="custom">Custom</option>
            </select>
            <p className="config-hint">This choice is stored locally and shared across map, 3D, and 2D drillhole pages.</p>
          </div>

          {primarySelection === 'custom' && (
            <div className="config-field">
              <label className="config-label" htmlFor="custom-key">Custom column name</label>
              <input
                id="custom-key"
                className="config-input"
                type="text"
                placeholder="e.g. collar_uid"
                value={customKeyInput}
                onChange={(e) => {
                  setCustomKeyInput(e.target.value);
                  setStatus('');
                }}
              />
              <p className="config-hint">Matches the column header in your CSV files. Case-insensitive.</p>
            </div>
          )}

          <div className="config-actions">
            <button className="config-button" type="submit">Save</button>
            {status && <span className="config-status">{status}</span>}
            {error && <span className="config-error">{error}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

export default Config;
