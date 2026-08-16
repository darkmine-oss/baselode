import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import proj4 from 'proj4';
import { minimumCurvatureDesurvey } from '../../../javascript/packages/baselode/src/data/desurveyMethods.js';
import { standardizeColumns } from '../../../javascript/packages/baselode/src/data/keying.js';
import { HOLE_ID, LATITUDE, LONGITUDE, DEPTH, AZIMUTH, DIP, PROJECT_ID, ELEVATION } from '../../../javascript/packages/baselode/src/data/datamodel.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
const collarsPath = path.join(repoRoot, 'test/data/gswa/gswa_sample_collars.csv');
const surveyPath = path.join(repoRoot, 'test/data/gswa/gswa_sample_survey.csv');
const outPath = path.join(repoRoot, 'test/data/gswa/demo_gswa_precomputed_desurveyed.csv');

proj4.defs('EPSG:28350', '+proj=utm +zone=50 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const projectTo28350 = (lat, lon) => {
  const [x, y] = proj4('EPSG:4326', 'EPSG:28350', [lon, lat]);
  return { x, y };
};

const collarsCsv = await fs.readFile(collarsPath, 'utf8');
const surveyCsv = await fs.readFile(surveyPath, 'utf8');

const parseCsv = (text) => Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true }).data;
const collarRows = parseCsv(collarsCsv);
const surveyRowsRaw = parseCsv(surveyCsv);

// Use the new data model standardization
const collars = collarRows
  .map((row) => {
    const standardized = standardizeColumns(row);
    const lat = Number(standardized[LATITUDE]);
    const lng = Number(standardized[LONGITUDE]);
    const project = String(standardized[PROJECT_ID] || standardized.dataset || '').trim();
    const holeId = String(standardized[HOLE_ID] || '').trim();
    const companyHoleId = String(standardized.company_hole_id || standardized.companyholeid || '').trim();
    const collarId = companyHoleId || holeId;
    const primaryId = collarId.toLowerCase();
    const elevation = Number(standardized[ELEVATION] ?? standardized.elevation ?? 0);
    const { x: easting, y: northing } = projectTo28350(lat, lng);
    return { lat, lng, easting, northing, elevation, project, holeId, companyHoleId, collarId, primaryId };
  })
  .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.holeId && r.primaryId);

const surveyRows = surveyRowsRaw
  .map((row) => {
    const standardized = standardizeColumns(row);
    const depth = Number(standardized[DEPTH]);
    const dip = Number(standardized[DIP]);
    const azimuth = Number(standardized[AZIMUTH]);
    const holeId = String(standardized[HOLE_ID] || '').trim();
    const companyHoleId = String(standardized.company_hole_id || standardized.companyholeid || '').trim();
    const primaryId = (companyHoleId || holeId).toLowerCase();
    return {
      raw: standardized,
      [HOLE_ID]: holeId,
      primary_id: primaryId,
      [DEPTH]: depth,
      surveydepth: depth, // legacy field for compatibility
      [DIP]: dip,
      dip,
      [AZIMUTH]: azimuth,
      azimuth
    };
  })
  .filter((r) => r.primary_id && Number.isFinite(r[DEPTH]) && Number.isFinite(r[DIP]) && Number.isFinite(r[AZIMUTH]));

console.log(`Loaded ${collars.length} collars and ${surveyRows.length} survey records`);

const desurveyed = minimumCurvatureDesurvey(
  collars.map((collar) => ({
    hole_id: collar.primaryId,
    easting: collar.easting,
    northing: collar.northing,
    elevation: collar.elevation
  })),
  surveyRows.map((survey) => ({
    hole_id: survey.primary_id,
    depth: survey[DEPTH],
    azimuth: survey[AZIMUTH],
    dip: survey[DIP]
  })),
  { step: null }
);

const centroid = collars.reduce((acc, collar) => ({ x: acc.x + collar.easting, y: acc.y + collar.northing }), { x: 0, y: 0 });
centroid.x /= collars.length;
centroid.y /= collars.length;

const collarByPrimaryId = new Map(collars.map((collar) => [collar.primaryId, collar]));

const lines = ['hole_id,company_hole_id,project,order,md,x,y,z'];
let pointCount = 0;
let holeCount = 0;
const pointsByHole = new Map();
desurveyed.forEach((point) => {
  if (!pointsByHole.has(point.hole_id)) pointsByHole.set(point.hole_id, []);
  pointsByHole.get(point.hole_id).push(point);
});
for (const [primaryId, trace] of pointsByHole) {
  const collar = collarByPrimaryId.get(primaryId);
  if (!collar) continue;
  const companyHoleId = `${collar.companyHoleId || ''}`.trim();
  const exportHoleId = companyHoleId || `${collar.holeId}`;
  const pts = trace
    .map((point) => ({ x: point.x - centroid.x, y: point.y - centroid.y, z: point.z, md: point.md }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  if (pts.length < 2) continue;
  holeCount += 1;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    lines.push(`${csv(exportHoleId)},${csv(companyHoleId)},${csv(collar.project)},${i},${num(p.md)},${num(p.x)},${num(p.y)},${num(p.z)}`);
    pointCount += 1;
  }
}

await fs.writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${pointCount} points across ${holeCount} holes to ${path.relative(repoRoot, outPath)}`);

function num(v) {
  return Number.isFinite(v) ? v : '';
}

function csv(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
