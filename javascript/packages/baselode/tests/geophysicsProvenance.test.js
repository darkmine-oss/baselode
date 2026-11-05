/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from 'vitest';
import { encodeErs, encodeGeoTiff } from '../src/data/geophysicsWriters.js';
import { createGeophysicsRaster, loadGeoTiff } from '../src/data/geophysicsRaster.js';
import { readErs } from '../src/data/ersLoader.js';
import { processGeophysicsRaster } from '../src/data/geophysicsProcessing.js';
import { combineGeophysicsRasters } from '../src/data/geophysicsEditing.js';
import { encodeProvenance, restoreProvenance } from '../src/data/geophysicsProvenance.js';

function sourceGrid() {
  return createGeophysicsRaster({
    data: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]], bandNames: ['magnetic', 'auxiliary'],
    transform: [10, 0, 400000, 0, -10, 6500000], crs: 'EPSG:28350',
    metadata: { units: ['nT', null], source: 'survey-α.ers', calibration: { note: 'café 🧲' } },
  });
}

async function roundTrip(raster, format, options = {}) {
  if (format === 'ers') {
    const { header, data } = encodeErs(raster, options);
    return readErs(header, data);
  }
  return loadGeoTiff(encodeGeoTiff(raster, options));
}

describe.each(['ers', 'tif'])('embedded %s provenance', (format) => {
  it('preserves Unicode, history and sources without recursive envelopes', async () => {
    const source = sourceGrid();
    let raster = processGeophysicsRaster(source, 'horizontal_derivative');
    for (let index = 0; index < 3; index += 1) {
      raster = await roundTrip(raster, format);
      expect(raster.metadata.processing).toEqual([{ operation: 'horizontal_derivative', direction: 'east' }]);
      expect(raster.metadata.units).toEqual(['nT/m', null]);
      expect(raster.metadata.calibration.note).toBe('café 🧲');
      expect(raster.metadata.provenance.sources).toEqual(['survey-α.ers']);
      expect(raster.metadata.provenance.metadata.provenance).toBeUndefined();
      expect(raster.metadata.provenance.export.dtype).toBe('float32');
    }
    expect(source.metadata.processing).toBeUndefined();
  });

  it('supports an explicit legacy opt-out', async () => {
    const result = await roundTrip(sourceGrid(), format, { includeProvenance: false });
    expect(result.metadata.provenance).toBeUndefined();
  });

  it('retains both input histories', async () => {
    const right = processGeophysicsRaster(sourceGrid(), 'upward_continuation', { height: 20 });
    const result = combineGeophysicsRasters(sourceGrid(), right, 'subtract');
    right.metadata.processing[0].height = 999;
    const restored = await roundTrip(result, format);
    expect(restored.metadata.input_lineage[0].metadata.processing[0].height).toBe(20);
  });
});

it('records GeoTIFF band selection before decimation', async () => {
  const encoded = encodeGeoTiff(sourceGrid());
  const selected = await loadGeoTiff(encoded, { samples: [1, 0], maxCells: 1 });
  expect(selected.metadata.units).toEqual([null, 'nT']);
  expect(selected.bandNames).toEqual(['auxiliary', 'magnetic']);
  expect(selected.metadata.processing.map((step) => step.operation)).toEqual(['select_bands', 'decimate']);
  expect(selected.metadata.processing[0].bands).toEqual([2, 1]);
});

it.each([NaN, Infinity, undefined, () => {}, { processing: null }, { x: new Date() }, { tags: new Date() }])('rejects non-JSON metadata %s', (bad) => {
  const source = sourceGrid();
  source.metadata = bad && typeof bad === 'object' ? bad : { bad };
  expect(() => encodeErs(source)).toThrow(/JSON|processing/);
  expect(() => encodeGeoTiff(source)).toThrow(/JSON|processing/);
});

it('rejects cycles and future/malformed records rather than losing history', () => {
  const metadata = {};
  metadata.self = metadata;
  expect(() => encodeProvenance(metadata, 'ERS', 'float32')).toThrow(/JSON/);
  const encoded = encodeProvenance({}, 'ERS', 'float32');
  const manifest = JSON.parse(atob(encoded));
  manifest.version = 2;
  expect(() => restoreProvenance({}, btoa(JSON.stringify(manifest)))).toThrow(/unsupported.*version/);
  expect(() => restoreProvenance({}, '!')).toThrow(/provenance/);
});

it('decodes band descriptions and unit XML escapes independently of provenance', async () => {
  const raster = sourceGrid();
  raster.bandNames = ['K & Th <α>', 'auxiliary'];
  raster.metadata.units = ['nT/m & test', null];
  const restored = await roundTrip(raster, 'tif', { includeProvenance: false });
  expect(restored.bandNames).toEqual(raster.bandNames);
  expect(restored.metadata.units).toEqual(raster.metadata.units);
});

it('does not revive stale fields after a cross-format round trip', async () => {
  const ers = await roundTrip(sourceGrid(), 'ers');
  const tif = await roundTrip(ers, 'tif', { dtype: 'float64' });
  expect(tif.metadata.cell_type).toBeUndefined();
  expect(tif.metadata.datum).toBeUndefined();
  expect(tif.metadata.provenance.metadata.cell_type).toBe('IEEE4ByteReal');
  const back = await roundTrip(tif, 'ers');
  expect(back.metadata.width).toBeUndefined();
  expect(back.metadata.provenance.metadata.width).toBe(2);
});

it('redacts source URL credentials on capture and reading without mutating callers', () => {
  const source = 'https://user:secret@example.com/survey.tif?X-Amz-Signature=token#fragment';
  const metadata = { source, processing: [{ operation: 'subtract', operand_source: source }] };
  const encoded = encodeProvenance(metadata, 'GeoTIFF', 'float32');
  const restored = restoreProvenance({}, encoded);
  expect(JSON.stringify(restored)).not.toMatch(/secret|token/);
  expect(restored.provenance.sources).toEqual(['https://example.com/survey.tif']);
  expect(metadata.source).toBe(source);
  expect(restoreProvenance({ source }, null).source).toBe('https://example.com/survey.tif');
});

it('uses flat graph references for repeated and branching combinations', async () => {
  let raster = sourceGrid();
  for (let index = 0; index < 16; index += 1) raster = combineGeophysicsRasters(raster, raster, 'add');
  expect(raster.metadata.input_lineage).toHaveLength(16);
  expect(JSON.stringify(raster.metadata).length).toBeLessThan(50000);
  const right = combineGeophysicsRasters(sourceGrid(), sourceGrid(), 'multiply');
  const combined = combineGeophysicsRasters(raster, right, 'subtract');
  const operand = combined.metadata.processing.at(-1).operand_lineage;
  expect(combined.metadata.input_lineage[operand].metadata.processing.at(-1)).toMatchObject({ operation: 'multiply', operand_lineage: 0 });
  const back = await roundTrip(combined, 'tif');
  expect(back.metadata.input_lineage).toEqual(combined.metadata.input_lineage);
});

it('rejects invalid lineage references, symbol keys and sparse/extended arrays', () => {
  expect(() => encodeProvenance({ processing: [{ operation: 'add', operand_lineage: 123 }] }, 'ERS', 'float32')).toThrow(/operand_lineage/);
  const symbolMetadata = { [Symbol('key')]: 'value' };
  expect(() => encodeProvenance(symbolMetadata, 'ERS', 'float32')).toThrow(/JSON/);
  expect(() => encodeProvenance({ values: Array(2) }, 'ERS', 'float32')).toThrow(/JSON/);
  const values = [1];
  values.extra = 2;
  expect(() => encodeProvenance({ values }, 'ERS', 'float32')).toThrow(/JSON/);
});
