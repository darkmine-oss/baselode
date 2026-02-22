import fs from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';
import proj4 from 'proj4';
import { desurveyTraces } from '../../../javascript/packages/baselode/src/data/desurvey.js';
import { standardizeColumns } from '../../../javascript/packages/baselode/src/data/keying.js';
import { HOLE_ID, LATITUDE, LONGITUDE, DEPTH, AZIMUTH, DIP, PROJECT_ID } from '../../../javascript/packages/baselode/src/data/datamodel.js';

const appRoot = path.resolve(process.cwd(), 'demo-viewer-react/app');
const repoRoot = path.resolve(appRoot, '../..');
const collarsPath = path.join(repoRoot, 'test/data/gswa/gswa_sample_collars.csv');
const surveyPath = path.join(repoRoot, 'test/data/gswa/gswa_sample_survey.csv');
const outPath = path.join(repoRoot, 'test/data/gswa/demo_gswa_precomputed_desurveyed.csv');

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
    return { lat, lng, project, holeId, companyHoleId, collarId, primaryId };
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

const desurveyed = desurveyTraces(collars, surveyRows, { primaryKey: 'collarId', customKey: '' });

proj4.defs('EPSG:28350', '+proj=utm +zone=50 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const projectTo28350 = (lat, lon) => {
  const [x, y] = proj4('EPSG:4326', 'EPSG:28350', [lon, lat]);
  return { x, y };
};

const projectedCollars = collars.map((c) => ({ ...c, zone50: projectTo28350(c.lat, c.lng) }));
const centroid = projectedCollars.reduce((acc, c) => ({ x: acc.x + c.zone50.x, y: acc.y + c.zone50.y }), { x: 0, y: 0 });
centroid.x /= projectedCollars.length;
centroid.y /= projectedCollars.length;

const lines = ['hole_id,company_hole_id,project,order,md,x,y,z'];
let pointCount = 0;
let holeCount = 0;
for (const hole of desurveyed) {
  const companyHoleId = hole?.collar?.companyHoleId ? `${hole.collar.companyHoleId}`.trim() : '';
  const exportHoleId = companyHoleId || `${hole.id}`;
  const pts = (hole.points || [])
    .map((p) => {
      const proj = projectTo28350(p.lat ?? 0, p.lng ?? 0);
      return { x: proj.x - centroid.x, y: proj.y - centroid.y, z: p.z, md: p.md };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  if (pts.length < 2) continue;
  holeCount += 1;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    lines.push(`${csv(exportHoleId)},${csv(companyHoleId)},${csv(hole.project ?? '')},${i},${num(p.md)},${num(p.x)},${num(p.y)},${num(p.z)}`);
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
