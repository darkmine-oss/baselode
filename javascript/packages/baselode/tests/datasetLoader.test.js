import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLUMN_MAP,
  loadAssays,
  loadCollars,
  loadSurveys,
  loadTable,
  standardizeColumns
} from '../src/data/datasetLoader.js';


describe('datasetLoader', () => {
  it('includes depth -> from alias in default map', () => {
    expect(DEFAULT_COLUMN_MAP.depth).toBe('from');
  });

  it('standardizes mixed-case GSWA-like columns', () => {
    const rows = [{ HoleId: 'ABC1', CollarId: 10, Latitude: -31.2, Longitude: 119.1, Elevation: 400 }];
    const standardized = standardizeColumns(rows);
    expect(standardized[0]).toMatchObject({
      hole_id: 'ABC1',
      collar_id: 10,
      lat: -31.2,
      lon: 119.1,
      z: 400
    });
  });

  it('loads collars from CSV and derives x/y from lon/lat', async () => {
    const csv = [
      'HoleId,Latitude,Longitude,Elevation',
      'A1,-31.5,119.7,410',
      'A2,-31.6,119.8,415'
    ].join('\n');

    const collars = await loadCollars(csv);

    expect(collars).toHaveLength(2);
    expect(collars[0].hole_id).toBe('A1');
    expect(collars[0].x).toBeCloseTo(119.7, 12);
    expect(collars[0].y).toBeCloseTo(-31.5, 12);
  });

  it('loads surveys using depth as from via default map', async () => {
    const csv = [
      'CollarId,Depth,Azimuth,Dip',
      'C1,10,90,-60',
      'C1,0,88,-58',
      'C2,5,100,-55'
    ].join('\n');

    const surveys = await loadSurveys(csv, { holeIdCol: 'collar_id' });

    expect(surveys).toHaveLength(3);
    expect(surveys[0].hole_id).toBe('C1');
    expect(surveys[0].from).toBe(0);
    expect(surveys[1].from).toBe(10);
    expect(surveys[2].hole_id).toBe('C2');
  });

  it('fails loadAssays when to column is missing', async () => {
    const csv = [
      'CollarId,Depth,Azimuth,Dip',
      'C1,10,90,-60'
    ].join('\n');

    await expect(loadAssays(csv, { holeIdCol: 'collar_id' }))
      .rejects
      .toThrow('Assay table missing column: to');
  });

  it('supports loadTable on array input', async () => {
    const table = await loadTable([{ HoleId: 'X1', Depth: 12 }]);
    expect(table[0]).toMatchObject({ hole_id: 'X1', from: 12 });
  });
});
