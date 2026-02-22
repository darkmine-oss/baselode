import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLUMN_MAP,
  loadAssays,
  loadCollars,
  loadGeology,
  loadSurveys,
  loadTable,
  standardizeColumns
} from '../src/data/datasetLoader.js';


describe('datasetLoader', () => {
  it('DEFAULT_COLUMN_MAP has depth field with variations', () => {
    expect(Array.isArray(DEFAULT_COLUMN_MAP.depth)).toBe(true);
    expect(DEFAULT_COLUMN_MAP.depth).toContain('depth');
  });

  it('standardizes mixed-case GSWA-like columns', () => {
    const rows = [{ HoleId: 'ABC1', Latitude: -31.2, Longitude: 119.1, Elevation: 400 }];
    const standardized = standardizeColumns(rows);
    expect(standardized[0]).toMatchObject({
      hole_id: 'ABC1',
      latitude: -31.2,
      longitude: 119.1,
      elevation: 400
    });
  });

  it('loads collars from CSV with latitude/longitude', async () => {
    const csv = [
      'HoleId,Latitude,Longitude,Elevation',
      'A1,-31.5,119.7,410',
      'A2,-31.6,119.8,415'
    ].join('\n');

    const collars = await loadCollars(csv);

    expect(collars).toHaveLength(2);
    expect(collars[0].hole_id).toBe('A1');
    expect(collars[0].latitude).toBeCloseTo(-31.5, 12);
    expect(collars[0].longitude).toBeCloseTo(119.7, 12);
    expect(collars[0].elevation).toBeCloseTo(410, 12);
  });

  it('loads surveys with sourceColumnMap for custom column names', async () => {
    const csv = [
      'CollarId,Depth,Azimuth,Dip',
      'C1,0,88,-58',
      'C1,10,90,-60',
      'C2,5,100,-55'
    ].join('\n');

    const surveys = await loadSurveys(csv, { sourceColumnMap: { CollarId: 'hole_id' } });

    expect(surveys).toHaveLength(3);
    expect(surveys[0].hole_id).toBe('C1');
    expect(surveys[0].depth).toBe(0);
    expect(surveys[1].depth).toBe(10);
    expect(surveys[2].hole_id).toBe('C2');
  });

  it('fails loadAssays when required columns are missing', async () => {
    const csv = [
      'HoleId,From',
      'C1,10'
    ].join('\n');

    await expect(loadAssays(csv))
      .rejects
      .toThrow('Assay table missing column: to');
  });

  it('supports loadTable on array input', async () => {
    const table = await loadTable([{ HoleId: 'X1', Depth: 12 }]);
    expect(table[0]).toMatchObject({ hole_id: 'X1', depth: 12 });
  });

  it('loads geology and standardizes lithology/comment fields', async () => {
    const csv = [
      'HoleId,FromDepth,ToDepth,Lith1,GeologyComment',
      'G1,0,10,Fg,Granite',
      'G1,10,20,Sbif,Banded iron formation'
    ].join('\n');

    const geology = await loadGeology(csv);
    expect(geology).toHaveLength(2);
    expect(geology[0]).toMatchObject({
      hole_id: 'G1',
      from: 0,
      to: 10,
      mid: 5,
      geology_code: 'Fg',
      geology_description: 'Granite'
    });
  });

  it('rejects overlapping geology intervals for a hole', async () => {
    const csv = [
      'HoleId,FromDepth,ToDepth,Lith1',
      'G1,0,10,Fg',
      'G1,9.5,20,Sbif'
    ].join('\n');

    await expect(loadGeology(csv)).rejects.toThrow('overlap');
  });
});
