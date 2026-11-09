/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import {preflightRadiometricProduct,RadiometricNeedsInput,calculateGeophysicsRadiometricRatios,createGeophysicsRadiometricTernary} from './geophysicsRadiometrics.js';
import catalogue from './geophysics_operations.json';
import schema from './geophysics_workflow.schema.json';
import recipe from './magnetic_grid_recipe.json';
import { jsonValue, encodeProvenance } from './geophysicsProvenance.js';
import { createGeophysicsRaster } from './geophysicsRaster.js';
import { geophysicsCoordinateUnit, processGeophysicsRaster } from './geophysicsProcessing.js';
import { combineGeophysicsRasters } from './geophysicsEditing.js';

const pointwise=['radiometric_ratios','radiometric_ternary'];
const operations = new Map(catalogue.map((item) => [item.id, item]));
const clone = (value) => JSON.parse(JSON.stringify(value));
const identifier = (value) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysEqual = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** Independent JSON operation contracts, including parameter schemas and limits. */
export function listGeophysicsOperations() { return clone(catalogue); }
/** Unknown operation IDs throw RangeError. */
export function describeGeophysicsOperation(operation) {
  if (!operations.has(operation)) throw new RangeError('unknown registered geophysics operation');
  return clone(operations.get(operation));
}
export function geophysicsWorkflowSchema() { return clone(schema); }
/** Example for an already-corrected magnetic anomaly grid; height is in CRS units. */
export function magneticGridRecipe() { return clone(recipe); }

function parameters(operation, supplied, issue, path) {
  const spec = operation.parameters;
  if (!object(supplied)) {
    issue('rejected', 'parameters', path, 'parameters must be a JSON object');
    return {};
  }
  const result = {};
  for (const key of Object.keys(supplied)) {
    if (!Object.hasOwn(spec.properties, key)) issue('rejected', 'parameter', `${path}.${key}`, 'unknown parameter');
  }
  for (const [key, rule] of Object.entries(spec.properties)) {
    if (!Object.hasOwn(supplied, key) && !Object.hasOwn(rule, 'default')) {
      if (spec.required.includes(key)) issue('needs_input', 'parameter', `${path}.${key}`, 'supply required parameter');
      continue;
    }
    const value = Object.hasOwn(supplied, key) ? supplied[key] : rule.default;
    let valid = rule.type === 'integer' ? Number.isInteger(value) : typeof value === rule.type;
    if (valid && ['number', 'integer'].includes(rule.type)) {
      valid = Number.isFinite(value) && (rule.minimum === undefined || value >= rule.minimum)
        && (rule.maximum === undefined || value <= rule.maximum)
        && (rule.exclusiveMinimum === undefined || value > rule.exclusiveMinimum);
    }
    if (rule.enum) valid = valid && rule.enum.includes(value);
    if (!valid) issue('rejected', 'parameter', `${path}.${key}`, 'value violates the operation parameter schema');
    else result[key] = value;
  }
  if (operation.id === 'band_pass' && result.short_wavelength >= result.long_wavelength) {
    issue('rejected', 'parameter', path, 'short_wavelength must be less than long_wavelength');
  }
  if (operation.id === 'reduce_to_pole' && Math.abs(result.inclination ?? 90) < 15) {
    issue('rejected', 'parameter', `${path}.inclination`, 'RTP requires |inclination| >= 15 degrees');
  }
  return result;
}

function outputContext(context, operation, params) {
  const result = { ...context, units: [...context.units] };
  if (operation.outputs.field_type !== 'preserve') result.field_type = operation.outputs.field_type;
  if(pointwise.includes(operation.id))result.units=[...operation.outputs.units];
  else if (operation.id === 'tilt_derivative') result.units = context.units.map(() => 'degree');
  else if (['vertical_derivative', 'horizontal_derivative', 'total_horizontal_derivative', 'analytic_signal'].includes(operation.id)) {
    const order = params.order ?? 1;
    const denominator = order === 1 ? context.distance_unit : `${context.distance_unit}^${order}`;
    result.units = context.units.map((unit) => `${/[/^]/.test(unit) ? `(${unit})` : unit}/${denominator}`);
  }
  return result;
}

/**
 * Preflight all steps without retaining products or doing I/O. Pointwise support QC reads source values.
 * Portable parameter names are snake_case in both languages.
 * Limits bound retained cells/FFT shapes, not exact peak bytes or wall time.
 */
export function validateGeophysicsWorkflow(workflow, inputs) {
  const issues = []; const plan = []; const contexts = new Map();
  const issue = (state, code, path, message) => issues.push({ state, code, path, message });
  const finish = (retained = 0, fft = 0) => ({
    state: issues.some((item) => item.state === 'rejected') ? 'rejected' : (issues.length ? 'needs_input' : 'ok'),
    issues, plan, resource_estimate: { retained_cell_values: retained, max_fft_cells_per_band: fft, limits: clone(catalogue[0].resources) },
  });
  try { jsonValue(workflow); } catch {
    issue('rejected', 'schema', 'workflow', 'workflow must be finite acyclic JSON'); return finish();
  }
  if (!keysEqual(workflow, ['schema', 'version', 'steps', 'outputs'])) {
    issue('rejected', 'schema', 'workflow', 'require exactly schema, version, steps and outputs'); return finish();
  }
  if (workflow.schema !== 'baselode.geophysics.workflow' || workflow.version !== 1) {
    issue('rejected', 'version', 'workflow', 'unsupported workflow schema/version'); return finish();
  }
  const { steps, outputs } = workflow;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 64 || !Array.isArray(outputs) || !outputs.length
    || !outputs.every(identifier) || new Set(outputs).size !== outputs.length) {
    issue('rejected', 'schema', 'workflow', 'require 1..64 steps and unique nonempty output IDs'); return finish();
  }
  if (!object(inputs) || !Object.keys(inputs).every(identifier)) {
    issue('rejected', 'input', 'inputs', 'inputs must be an object with identifier keys'); return finish();
  }
  const pointwiseOnly=steps.every(step=>object(step)&&pointwise.includes(step.operation));
  let retained = 0; let largestFft = 0;
  for (const [key, raster] of Object.entries(inputs)) {
    const path = `inputs.${key}`;
    if (!object(raster) || !Array.isArray(raster.data) || !Number.isInteger(raster.bandCount) || !raster.metadata) {
      issue('rejected', 'input', path, 'expected GeophysicsRaster'); continue;
    }
    if (![raster.width, raster.height, raster.bandCount].every((size) => Number.isSafeInteger(size) && size > 0)
      || raster.data.length !== raster.bandCount) {
      issue('rejected', 'input', path, 'invalid raster dimensions'); continue;
    }
    const cells = raster.width * raster.height * raster.bandCount;
    if (cells <= 1000000 && !raster.data.every((band) => Array.isArray(band) && band.length === raster.height
      && band.every((row) => Array.isArray(row) && row.length === raster.width
        && Array.from(row).every((value) => value === null || (typeof value === 'number' && Number.isFinite(value)))))) {
      issue('rejected', 'input', path, 'data must match declared dimensions and contain numeric/null cells'); continue;
    }
    retained += cells;
    if (cells > 1000000) issue('rejected', 'resource', path, 'input exceeds 1000000 cell values');
    let distance = 'coordinate_unit'; let spacing = [1, 1];
    try {
      encodeProvenance(raster.metadata, 'GeoTIFF', 'float64');
      distance = pointwiseOnly?'pointwise':geophysicsCoordinateUnit(raster);
      if (distance === 'coordinate_unit') issue('needs_input', 'coordinates', path, 'supply explicit local metadata.crs_units or a projected CRS');
      const t = raster.transform;
      if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite)) throw new RangeError('require a finite invertible rectangular affine transform');
      const determinant = t[0] * t[4] - t[1] * t[3];
      const column = Math.hypot(t[0], t[3]); const row = Math.hypot(t[1], t[4]);
      spacing = [column, row];
      if (!Number.isFinite(determinant) || determinant === 0 || !Number.isFinite(column) || !Number.isFinite(row)
        || column === 0 || row === 0 || (!pointwiseOnly&&Math.abs(t[0] * t[1] + t[3] * t[4]) > 1e-9 * column * row)) {
        throw new RangeError('require a finite invertible rectangular affine transform; sheared grids are unsupported');
      }
    } catch (error) { issue('rejected', 'input', path, error.message); spacing = [1, 1]; }
    const field = raster.metadata.field_type;
    if (field === undefined || field === null) issue('needs_input', 'field_type', path, 'supply scalar metadata.field_type for all bands');
    else if (!['magnetic_anomaly', 'gravity_anomaly', 'gravity_disturbance', 'radiometric', 'other'].includes(field)) {
      issue('rejected', 'field_type', path, 'unsupported field_type; total fields require correction before this workflow');
    }
    let { units } = raster.metadata;
    if (!Array.isArray(units) || units.length !== raster.bandCount || !units.every((unit) => typeof unit === 'string' && unit.trim())) {
      issue('needs_input', 'units', path, 'supply one nonempty metadata.units string per band'); units = Array(raster.bandCount).fill('unknown');
    }
    contexts.set(key, { grid: raster, field_type: field, units, distance_unit: distance, spacing });
  }
  const ids = new Set(Object.keys(inputs));
  steps.forEach((step, index) => {
    const path = `steps[${index}]`;
    if (!keysEqual(step, ['id', 'operation', 'version', 'inputs', 'parameters'])) {
      issue('rejected', 'schema', path, 'step requires exactly id, operation, version, inputs and parameters'); return;
    }
    const name = step.id;
    if (!identifier(name) || ids.has(name)) { issue('rejected', 'reference', `${path}.id`, 'step ID must be valid and unique across inputs/steps'); return; }
    const operation = operations.get(step.operation);
    if (!operation || step.version !== 1) { issue('rejected', 'operation', path, 'unknown operation or unsupported version'); ids.add(name); return; }
    const refs = step.inputs;
    if (!Array.isArray(refs) || refs.length !== operation.inputs.count || !refs.every(identifier)) {
      issue('rejected', 'input', `${path}.inputs`, 'wrong input count or invalid reference IDs'); ids.add(name); return;
    }
    const params = parameters(operation, step.parameters, issue, `${path}.parameters`);
    const sources = [];
    for (const ref of refs) {
      if (!contexts.has(ref)) {
        if (!ids.has(ref)) {
          const state = steps.slice(index).some((later) => later?.id === ref) ? 'rejected' : 'needs_input';
          issue(state, 'reference', `${path}.inputs`, `supply input '${ref}'; step references must point backward`);
        }
      } else sources.push(contexts.get(ref));
    }
    if (sources.length === refs.length) {
      for (const source of sources) {
        if (source.field_type != null && !operation.inputs.field_types.includes(source.field_type)) issue('rejected', 'applicability', path, 'operation is not applicable to this field_type');
      }
      const left = sources[0];
      if (sources.length === 2) {
        const right = sources[1]; const a = left.grid; const b = right.grid;
        if (a.width !== b.width || a.height !== b.height || a.bandCount !== b.bandCount || !equal(a.transform, b.transform) || a.crs !== b.crs) {
          issue('rejected', 'alignment', path, 'combine requires exactly matching shape, transform and CRS');
        }
        if (!equal(left.units, right.units) || left.field_type !== right.field_type) issue('rejected', 'units', path, 'combine requires matching units and field_type');
      }
      if(pointwise.includes(operation.id)&&!Object.hasOwn(inputs,refs[0]))issue('rejected','radiometric',path,'radiometric product steps require a named verified input stack; run upstream transforms separately and verify their output context/support first');
      if(pointwise.includes(operation.id)&&Object.hasOwn(inputs,refs[0])&&left.grid.width*left.grid.height*left.grid.bandCount<=1000000&&retained+left.grid.width*left.grid.height*left.grid.bandCount<=16000000){try{preflightRadiometricProduct(left.grid,operation.id,params);}catch(error){issue(error instanceof RadiometricNeedsInput?'needs_input':'rejected','radiometric',path,error.message);}}
      contexts.set(name, outputContext(left, operation, params));
      retained += left.grid.width * left.grid.height * left.grid.bandCount;
      if (!['combine', 'horizontal_derivative', 'total_horizontal_derivative',...pointwise].includes(operation.id)) {
        const length = params.long_wavelength ?? params.wavelength;
        const [cellX, cellY] = left.spacing;
        if (length !== undefined && ![cellX, cellY].every((spacing) => Number.isFinite(length / spacing))) {
          issue('rejected', 'parameter', path, 'wavelength/cell-size ratio exceeds numeric backend range');
        } else if (cellX > 0 && cellY > 0) {
          const pad = (size, spacing) => Math.min(Math.max(8, length === undefined ? Math.floor(size / 2) : Math.ceil(length / spacing)), size);
          const fft = 2 ** Math.ceil(Math.log2(left.grid.height + 2 * pad(left.grid.height, cellY)))
            * 2 ** Math.ceil(Math.log2(left.grid.width + 2 * pad(left.grid.width, cellX)));
          largestFft = Math.max(largestFft, fft);
        }
      }
    }
    ids.add(name); plan.push({ ...step, parameters: params });
  });
  for (const ref of outputs) if (!ids.has(ref)) issue('rejected', 'reference', 'outputs', 'output must name an available input or step');
  if (retained > 16000000 || largestFft > 4194304) issue('rejected', 'resource', 'workflow', 'retained cell values or padded FFT exceeds registered resource limits');
  return finish(retained, largestFft);
}

/** Full-resolution artifacts and explicit states; preserves inputs and never evaluates code. */
export function runGeophysicsWorkflow(workflow, inputs) {
  const report = { ...validateGeophysicsWorkflow(workflow, inputs), artifacts: {}, diagnostics: [], completed_steps: [] };
  if (report.state !== 'ok') return report;
  const values = new Map();
  try {
    for (const [key, raster] of Object.entries(inputs)) {
      values.set(key, createGeophysicsRaster({ ...raster, metadata: clone(raster.metadata) }));
    }
    for (const step of report.plan) {
      const sources = step.inputs.map((ref) => values.get(ref));
      const params = step.parameters;
      const options = Object.fromEntries(Object.entries(params).map(([key, value]) => [key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()), value]));
      const product = step.operation === 'combine'
        ? combineGeophysicsRasters(sources[0], sources[1], params.operation)
        : step.operation==='radiometric_ratios'?calculateGeophysicsRadiometricRatios(sources[0],params)
          :step.operation==='radiometric_ternary'?createGeophysicsRadiometricTernary(sources[0],params)
            :processGeophysicsRaster(sources[0], step.operation, options);
      const field = operations.get(step.operation).outputs.field_type;
      product.metadata.field_type = field === 'preserve' ? sources[0].metadata.field_type : field;
      product.metadata.processing = [...(product.metadata.processing ?? []), {
        operation: 'workflow_step', id: step.id, registered_operation: step.operation, operation_version: 1,
        parameters: clone(params), workflow_version: 1,
        library_version: typeof __BASELODE_VERSION__ === 'undefined' ? 'unversioned' : __BASELODE_VERSION__,
        backend: { name: 'baselode-native', version: typeof __BASELODE_VERSION__ === 'undefined' ? 'unversioned' : __BASELODE_VERSION__ },
      }];
      values.set(step.id, product); report.completed_steps.push(step.id);
      report.diagnostics.push({ step: step.id, cell_values: product.width * product.height * product.bandCount, assumptions: clone(operations.get(step.operation).assumptions) });
    }
    report.artifacts = Object.fromEntries(workflow.outputs.map((key) => [key, values.get(key)]));
  } catch (error) {
    report.state = 'failed'; report.issues.push({ state: 'failed', code: 'execution', path: 'execution', message: error.message });
  }
  return report;
}
