import fs from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';
import proj4 from 'proj4';
import { desurveyTraces } from '../../../javascript/packages/baselode/src/data/desurvey.js';
import { resolvePrimaryId } from '../../../javascript/packages/baselode/src/data/keying.js';

const appRoot = path.resolve(process.cwd(), 'demo-viewer-react/app');
const collarsPath = path.join(appRoot, 'public/data/gswa/demo_gswa_sample_collars.csv');
const surveyPath = path.join(appRoot, 'public/data/gswa/demo_gswa_sample_survey.csv');
const outPath = path.join(appRoot, 'public/data/gswa/demo_gswa_precomputed_desurveyed.csv');

const collarsCsv = await fs.readFile(collarsPath, 'utf8');
const surveyCsv = await fs.readFile(surveyPath, 'utf8');

const parseCsv = (text) => Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true }).data;
const collarRows = parseCsv(collarsCsv);
const surveyRowsRaw = parseCsv(surveyCsv);

const pick = (obj, keys) => {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && `${obj[key]}`.trim() !== '') return obj[key];
  }
  return undefined;
};

const collars = collarRows
  .map((row) => {
    const n = {};
    Object.entries(row || {}).forEach(([k, v]) => {
      if (!k) return;
      n[k.trim().toLowerCase()] = v;
    });
    const lat = Number(pick(n, ['latitude', 'lat']));
    const lng = Number(pick(n, ['longitude', 'lon', 'lng']));
    const project = String(pick(n, ['project_code', 'project']) ?? '').trim();
    const holeId = String(pick(n, ['hole_id', 'holeid', 'id']) ?? '').trim();
    const companyHoleId = String(pick(n, ['companyholeid', 'company_hole_id']) ?? '').trim();
    const collarId = String(pick(n, ['collarid', 'collar_id']) ?? '').trim();
    const primaryId = resolvePrimaryId(n, 'collarid');
    return { lat, lng, project, holeId, companyHoleId, collarId, primaryId };
  })
  .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.project && r.holeId && r.primaryId);

const surveyRows = surveyRowsRaw
  .map((row) => {
    const n = {};
    Object.entries(row || {}).forEach(([k, v]) => {
      if (!k) return;
      n[k.trim().toLowerCase()] = v;
    });
    const depth = Number(n.surveydepth ?? n.depth);
    const dip = Number(n.dip);
    const azimuth = Number(n.azimuth);
    const primaryId = resolvePrimaryId(n, 'collarid');
    const holeId = pick(n, ['hole_id', 'holeid', 'id']);
    return {
      raw: n,
      hole_id: holeId,
      primary_id: primaryId,
      surveydepth: depth,
      dip,
      azimuth
    };
  })
  .filter((r) => r.primary_id && Number.isFinite(r.surveydepth) && Number.isFinite(r.dip) && Number.isFinite(r.azimuth));

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
console.log(`Wrote ${pointCount} points across ${holeCount} holes to ${path.relative(appRoot, outPath)}`);

function num(v) {
  return Number.isFinite(v) ? v : '';
}

function csv(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
