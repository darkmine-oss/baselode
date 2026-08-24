/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useMemo, useState } from 'react';
import { GeophysicsRasterViewer, loadGeoTiff } from 'baselode';
import './GeophysicsRaster.css';

const FORESTANIA_SAMPLE_RASTER = createSyntheticMagnetics();

function createSyntheticMagnetics() {
  const width = 160;
  const height = 120;
  const data = [];
  for (let row = 0; row < height; row += 1) {
    const values = [];
    for (let column = 0; column < width; column += 1) {
      const anomalyA = 720 * Math.exp(-(((column - 54) ** 2) / 420 + ((row - 45) ** 2) / 250));
      const anomalyB = -580 * Math.exp(-(((column - 118) ** 2) / 300 + ((row - 79) ** 2) / 570));
      const regional = 160 * Math.sin(column / 17) * Math.cos(row / 23);
      values.push(Math.round(anomalyA + anomalyB + regional));
    }
    data.push(values);
  }
  return {
    data: [data],
    // The sample covers the Forrestania GSWA drillhole extract. It is not
    // survey data; it makes affine/CRS handling visible before a real grid is
    // available for this demo.
    transform: [0.00025, 0, 119.615, 0, -0.00025, -32.345],
    crs: 'EPSG:4326',
    bandNames: ['synthetic_tmi_nt'],
    metadata: { source: 'Baselode synthetic magnetic anomaly', units: 'nT' },
  };
}

function GeophysicsRaster() {
  const [raster, setRaster] = useState(FORESTANIA_SAMPLE_RASTER);
  const [view, setView] = useState({
    palette: 'magnetic',
    clipRange: [-700, 700],
    hillshade: { enabled: true, azimuth: 315, altitude: 45, strength: 0.55 },
  });
  const [sourceLabel, setSourceLabel] = useState('Synthetic TMI over the GSWA Forrestania sample area');
  const [error, setError] = useState('');
  const metadata = useMemo(() => raster.metadata ?? {}, [raster]);

  const loadFile = async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    setError('');
    try {
      const loaded = await loadGeoTiff(file);
      setRaster(loaded);
      setSourceLabel(file.name);
      setView({
        palette: 'magnetic',
        clipRange: null,
        hillshade: { enabled: false, azimuth: 315, altitude: 45, strength: 0.65 },
      });
    } catch (loadError) {
      setError(`Could not read ${file.name}: ${loadError.message}`);
    }
  };

  const restoreSample = () => {
    setRaster(FORESTANIA_SAMPLE_RASTER);
    setSourceLabel('Synthetic TMI over the GSWA Forrestania sample area');
    setError('');
    setView({
      palette: 'magnetic',
      clipRange: [-700, 700],
      hillshade: { enabled: true, azimuth: 315, altitude: 45, strength: 0.55 },
    });
  };

  return (
    <main className="geophysics-raster-page">
      <header className="geophysics-raster-page__header">
        <div>
          <h1>Geophysics Raster</h1>
          <p>
            A reusable 2D raster view for magnetics, radiometrics, gravity, and other gridded geophysics.
            Change the colour map, display clip, and hillshade controls below.
          </p>
        </div>
        <div className="geophysics-raster-page__actions">
          <label className="geophysics-raster-page__upload">
            Open GeoTIFF / COG
            <input type="file" accept=".tif,.tiff,image/tiff" onChange={loadFile} />
          </label>
          <button type="button" onClick={restoreSample}>Restore sample</button>
        </div>
      </header>

      <div className="geophysics-raster-page__body">
        <section className="geophysics-raster-page__viewer">
          <GeophysicsRasterViewer raster={raster} value={view} onViewChange={setView} height={560} />
        </section>
        <aside className="geophysics-raster-page__info">
          <h2>Raster source</h2>
          <dl>
            <div><dt>File</dt><dd>{sourceLabel}</dd></div>
            <div><dt>CRS</dt><dd>{raster.crs || 'Unreferenced'}</dd></div>
            <div><dt>Band</dt><dd>{raster.bandNames?.[0] || 'band_1'}</dd></div>
            <div><dt>Units</dt><dd>{metadata.units || 'Not supplied'}</dd></div>
          </dl>
          <p>
            This initial sample is synthetic but geographically aligned with the demo drillhole area.
            A browser can open GeoTIFF/COG directly. ERS files are loaded with Python
            <code> baselode.geophysics.load_raster()</code> and transferred as a raster payload.
          </p>
          {error && <p className="geophysics-raster-page__error">{error}</p>}
        </aside>
      </div>
    </main>
  );
}

export default GeophysicsRaster;
