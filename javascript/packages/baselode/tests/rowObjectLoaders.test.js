/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  parseAssayHoleFromRows,
  parseAssayHoleIdsFromRows,
  parseAssayHoleIdsWithAssaysFromRows,
  parseAssaysCSV,
  parseAssaysFromRows,
} from '../src/data/assayLoader.js';
import { loadAssayFromRows } from '../src/data/assayDataLoader.js';
import {
  parseAssayHolesFromRows,
  parseAssayCsvTextToHoles,
  parseGeologyCsvText,
  parseGeologyFromRows,
  parseUnifiedDataset,
  parseUnifiedDatasetFromRows,
} from '../src/data/unifiedLoader.js';
import {
  parseBlockModelCSV,
  parseBlockModelFromRows,
} from '../src/data/blockModelLoader.js';
import {
  parseDrillholesCSV,
  parseDrillholesFromRows,
} from '../src/data/drillholeLoader.js';
import {
  parseGeophysicsCSV,
  parseGeophysicsFromRows,
} from '../src/data/geophysicsLoader.js';
import {
  parseStructuralCSV,
  parseStructuralFromRows,
} from '../src/data/structuralLoader.js';
import {
  parseSurveyCSV,
  parseSurveyFromRows,
} from '../src/data/desurvey.js';

describe('row-object loader entry points', () => {
  it('matches the streaming assay CSV APIs', async () => {
    const rows = [
      { hole_id: 'H1', from: 10, to: 20, au_ppm: 1.5 },
      { hole_id: 'H1', from: 0, to: 10, au_ppm: 0.5 },
      { hole_id: 'H2', from: 0, to: 5, au_ppm: null },
    ];
    const csv = [
      'hole_id,from,to,au_ppm',
      'H1,10,20,1.5',
      'H1,0,10,0.5',
      'H2,0,5,',
    ].join('\n');

    expect(parseAssaysFromRows(rows)).toEqual(await parseAssaysCSV(csv));
    expect(parseAssayHoleIdsFromRows(rows)).toEqual(['H1', 'H2']);
    expect(parseAssayHoleIdsWithAssaysFromRows(rows)).toEqual([{ holeId: 'H1' }]);
    expect(parseAssayHoleFromRows(rows, 'H1')).toEqual(
      parseAssaysFromRows(rows).holes[0],
    );
    expect(loadAssayFromRows(rows).holes).toEqual(parseAssaysFromRows(rows).holes);
  });

  it('matches survey, drillhole, block-model, and geophysics CSV adapters', async () => {
    const surveyRows = [
      { hole_id: 'H1', depth: 0, dip: -60, azimuth: 120 },
      { hole_id: 'H1', depth: 20, dip: -62, azimuth: 125 },
    ];
    const surveyCsv = 'hole_id,depth,dip,azimuth\nH1,0,-60,120\nH1,20,-62,125';
    expect(parseSurveyFromRows(surveyRows)).toEqual(await parseSurveyCSV(surveyCsv));

    const drillholeRows = [
      { hole_id: 'H1', easting: 1, northing: 2, elevation: 3, md: 0 },
      { hole_id: 'H1', easting: 4, northing: 5, elevation: 6, md: 10 },
    ];
    const drillholeCsv = 'hole_id,easting,northing,elevation,md\nH1,1,2,3,0\nH1,4,5,6,10';
    expect(parseDrillholesFromRows(drillholeRows)).toEqual(
      await parseDrillholesCSV(drillholeCsv),
    );

    const blockRows = [
      { center_x: 1, center_y: 2, center_z: 3, size_x: 4, size_y: 5, size_z: 6, au: 2.5 },
    ];
    const blockCsv = 'center_x,center_y,center_z,size_x,size_y,size_z,au\n1,2,3,4,5,6,2.5';
    expect(parseBlockModelFromRows(blockRows)).toEqual(await parseBlockModelCSV(blockCsv));

    const geophysicsRows = [
      { hole_id: 'H1', depth: 0, gamma: 10 },
      { hole_id: 'H1', depth: 1, gamma: 20 },
    ];
    const geophysicsCsv = 'hole_id,depth,gamma\nH1,0,10\nH1,1,20';
    expect(parseGeophysicsFromRows(geophysicsRows)).toEqual(
      parseGeophysicsCSV(geophysicsCsv),
    );
  });

  it('matches structural and unified CSV adapters', async () => {
    const assayRows = [{ hole_id: 'H1', from: 0, to: 10, au_ppm: 1.2 }];
    const structuralRows = [{ hole_id: 'H1', depth: 5, dip: 45, azimuth: 180 }];
    const geologyRows = [{ hole_id: 'H1', from: 0, to: 10, geology_code: 'BIF' }];

    expect(parseStructuralFromRows(structuralRows)).toEqual(
      await parseStructuralCSV('hole_id,depth,dip,azimuth\nH1,5,45,180'),
    );
    expect(parseAssayHolesFromRows(assayRows)).toEqual(
      await parseAssayCsvTextToHoles('hole_id,from,to,au_ppm\nH1,0,10,1.2'),
    );
    expect(parseGeologyFromRows(geologyRows)).toEqual(
      await parseGeologyCsvText('hole_id,from,to,geology_code\nH1,0,10,BIF'),
    );

    expect(parseUnifiedDatasetFromRows({ assayRows, structuralRows, geologyRows })).toEqual(
      await parseUnifiedDataset({
        assayCsv: 'hole_id,from,to,au_ppm\nH1,0,10,1.2',
        structuralCsv: 'hole_id,depth,dip,azimuth\nH1,5,45,180',
        geologyCsv: 'hole_id,from,to,geology_code\nH1,0,10,BIF',
      }),
    );
  });

  it('preserves typed extra values and does not mutate source rows', () => {
    const observedAt = new Date('2026-08-15T00:00:00Z');
    const assayRows = [{
      hole_id: 'H1',
      from: 0,
      to: 10,
      source_record_id: 9007199254740993n,
      observed_at: observedAt,
    }];
    const original = { ...assayRows[0] };

    const { holes } = parseUnifiedDatasetFromRows({ assayRows });
    const point = holes[0].points[0];

    expect(point.source_record_id).toBe(9007199254740993n);
    expect(point.observed_at).toBe(observedAt);
    expect(assayRows[0]).toEqual(original);
  });

  it('lets row sources take precedence without parsing fallback CSV', async () => {
    const result = await parseUnifiedDataset({
      assayRows: [{ hole_id: 'H1', from: 0, to: 1, au_ppm: 2 }],
      assayCsv: 'not,a,valid,assay',
    });

    expect(result.holes).toHaveLength(1);
    expect(result.holes[0].holeId).toBe('H1');
  });
});
