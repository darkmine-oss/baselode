/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const DEFAULT_OPTIONS = Object.freeze({
  digDirectionDeg: 0,
  targetTonnes: 10_000,
  targetGrade: null,
  targetFaceToDepthRatio: 1.8,
  minFaceWidth: 20,
  gradeScale: 5,
  weights: Object.freeze({ tonnes: 1, grade: 0.8, shape: 0.65, material: 0.15, hardness: 0.1 }),
});

const EPSILON = 1e-9;
const MAX_TRANSITION_CANDIDATES = 64;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePolygon(polygon) {
  const coordinates = polygon?.type === 'Polygon'
    ? polygon.coordinates?.[0]
    : polygon?.coordinates?.[0] || polygon;
  if (!Array.isArray(coordinates)) throw new Error('blastPolygon must be a polygon coordinate array or GeoJSON Polygon');
  const points = coordinates.map((point) => ({ x: Number(point?.[0] ?? point?.x), y: Number(point?.[1] ?? point?.y) }));
  if (points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) points.pop();
  if (points.length < 3 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('blastPolygon must contain at least three finite XY points');
  }
  return points;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  }
  return Math.abs(area) / 2;
}

function polygonCentroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  const total = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

/**
 * Return unit axes for a mining bearing measured clockwise from north.
 *
 * @param {number} bearingDeg - Bearing in degrees clockwise from north
 * @returns {{forward: {x:number,y:number}, cross: {x:number,y:number}}}
 */
export function digDirectionAxes(bearingDeg) {
  const radians = (finiteNumber(bearingDeg, 0) * Math.PI) / 180;
  return {
    forward: { x: Math.sin(radians), y: Math.cos(radians) },
    cross: { x: Math.cos(radians), y: -Math.sin(radians) },
  };
}

function toDigPoint(point, axes) {
  return {
    x: point.x * axes.cross.x + point.y * axes.cross.y,
    y: point.x * axes.forward.x + point.y * axes.forward.y,
  };
}

function fromDigPoint(point, axes) {
  return {
    x: point.x * axes.cross.x + point.y * axes.forward.x,
    y: point.x * axes.cross.y + point.y * axes.forward.y,
  };
}

function clipAgainst(points, inside, intersect) {
  const output = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[(index + points.length - 1) % points.length];
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersect(previous, current));
    }
  }
  return output;
}

function clipPolygonToRect(polygon, minCross, maxCross, minForward, maxForward) {
  let output = polygon.slice();
  const verticalIntersection = (edge) => (a, b) => {
    const ratio = (edge - a.x) / ((b.x - a.x) || EPSILON);
    return { x: edge, y: a.y + ratio * (b.y - a.y) };
  };
  const horizontalIntersection = (edge) => (a, b) => {
    const ratio = (edge - a.y) / ((b.y - a.y) || EPSILON);
    return { x: a.x + ratio * (b.x - a.x), y: edge };
  };
  output = clipAgainst(output, (point) => point.x >= minCross - EPSILON, verticalIntersection(minCross));
  output = clipAgainst(output, (point) => point.x <= maxCross + EPSILON, verticalIntersection(maxCross));
  output = clipAgainst(output, (point) => point.y >= minForward - EPSILON, horizontalIntersection(minForward));
  output = clipAgainst(output, (point) => point.y <= maxForward + EPSILON, horizontalIntersection(maxForward));
  return output;
}

function makePrefix(cells, categories) {
  const prefix = {
    tonnes: [0],
    grade: [0],
    hardness: [0],
    hardnessSquared: [0],
    area: [0],
    categories: Object.fromEntries(categories.map((category) => [category, [0]])),
  };
  for (const cell of cells) {
    const tonnes = cell.tonnes;
    prefix.tonnes.push(prefix.tonnes.at(-1) + tonnes);
    prefix.grade.push(prefix.grade.at(-1) + tonnes * cell.fe);
    prefix.hardness.push(prefix.hardness.at(-1) + tonnes * cell.hardness);
    prefix.hardnessSquared.push(prefix.hardnessSquared.at(-1) + tonnes * cell.hardness * cell.hardness);
    prefix.area.push(prefix.area.at(-1) + cell.area);
    for (const category of categories) {
      prefix.categories[category].push(prefix.categories[category].at(-1) + (cell.geology === category ? tonnes : 0));
    }
  }
  return prefix;
}

function range(prefix, start, end) {
  return prefix[end] - prefix[start];
}

function scorePhysicals(stats, targetGrade, options) {
  const tonnesPenalty = ((stats.tonnes - options.targetTonnes) / options.targetTonnes) ** 2;
  const gradePenalty = ((stats.grade - targetGrade) / options.gradeScale) ** 2;
  const ratio = stats.faceWidth / Math.max(stats.bandDepth, EPSILON);
  const ratioPenalty = Math.log(Math.max(ratio, 0.05) / options.targetFaceToDepthRatio) ** 2;
  const widthPenalty = Math.max(0, (options.minFaceWidth - stats.faceWidth) / options.minFaceWidth) ** 2;
  const dominantTonnes = Math.max(0, ...Object.values(stats.geologyTonnes));
  const materialPenalty = stats.tonnes ? 1 - dominantTonnes / stats.tonnes : 0;
  const hardnessPenalty = stats.hardnessVariance / Math.max(stats.hardnessMean ** 2, 1);
  const score = options.weights.tonnes * tonnesPenalty
    + options.weights.grade * gradePenalty
    + options.weights.shape * (ratioPenalty + 2 * widthPenalty)
    + options.weights.material * materialPenalty
    + options.weights.hardness * hardnessPenalty
    - 0.1 * options.weights.tonnes;
  return { score, ratio, materialPenalty };
}

function scoreSegment(cells, prefix, categories, start, end, bandDepth, targetGrade, options) {
  const tonnes = range(prefix.tonnes, start, end);
  const grade = range(prefix.grade, start, end) / Math.max(tonnes, EPSILON);
  const hardnessMean = range(prefix.hardness, start, end) / Math.max(tonnes, EPSILON);
  const hardnessVariance = Math.max(0, range(prefix.hardnessSquared, start, end) / Math.max(tonnes, EPSILON) - hardnessMean ** 2);
  const faceWidth = Math.max(cells[end - 1].crossMax - cells[start].crossMin, EPSILON);
  const geologyTonnes = Object.fromEntries(categories.map((category) => [category, range(prefix.categories[category], start, end)]));
  const scored = scorePhysicals({
    tonnes,
    grade,
    hardnessMean,
    hardnessVariance,
    faceWidth,
    bandDepth,
    geologyTonnes,
  }, targetGrade, options);
  return { ...scored, tonnes, grade, hardnessMean, hardnessVariance, faceWidth, geologyTonnes };
}

function lowerBound(values, target, end) {
  let low = 0;
  let high = end;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function transitionCandidates(prefixTonnes, end, targetTonnes) {
  const starts = new Set([0, end - 1]);
  const total = prefixTonnes[end];
  const ideal = clamp(lowerBound(prefixTonnes, total - targetTonnes, end), 0, end - 1);
  for (let offset = -5; offset <= 5; offset += 1) starts.add(clamp(ideal + offset, 0, end - 1));

  const tonnageMin = clamp(lowerBound(prefixTonnes, total - 3 * targetTonnes, end), 0, end - 1);
  const tonnageMax = clamp(lowerBound(prefixTonnes, total - 0.25 * targetTonnes, end), 0, end - 1);
  const tonnageSamples = Math.min(24, tonnageMax - tonnageMin + 1);
  for (let index = 0; index < tonnageSamples; index += 1) {
    const fraction = tonnageSamples === 1 ? 0 : index / (tonnageSamples - 1);
    starts.add(Math.round(tonnageMin + fraction * (tonnageMax - tonnageMin)));
  }

  const globalSamples = Math.min(12, end);
  for (let index = 0; index < globalSamples; index += 1) {
    const fraction = globalSamples === 1 ? 0 : index / (globalSamples - 1);
    starts.add(Math.round(fraction * (end - 1)));
  }
  return [...starts].sort((a, b) => a - b).slice(0, MAX_TRANSITION_CANDIDATES);
}

function partitionBand(cells, band, targetGrade, options, blastBounds, blastDig, axes, idOffset) {
  const sorted = cells.slice().sort((a, b) => a.cross - b.cross || a.id.localeCompare(b.id));
  const categories = [...new Set(sorted.map((cell) => cell.geology))].sort();
  const prefix = makePrefix(sorted, categories);
  const depth = Math.max(band.max - band.min, EPSILON);
  const bestScore = Array(sorted.length + 1).fill(Infinity);
  const previous = Array(sorted.length + 1).fill(-1);
  bestScore[0] = 0;
  for (let end = 1; end <= sorted.length; end += 1) {
    for (const start of transitionCandidates(prefix.tonnes, end, options.targetTonnes)) {
      if (!Number.isFinite(bestScore[start])) continue;
      const candidate = scoreSegment(sorted, prefix, categories, start, end, depth, targetGrade, options);
      const totalScore = bestScore[start] + candidate.score;
      if (totalScore < bestScore[end]) {
        bestScore[end] = totalScore;
        previous[end] = start;
      }
    }
  }

  const ranges = [];
  let end = sorted.length;
  while (end > 0) {
    const start = previous[end];
    ranges.unshift({ start, end });
    end = start;
  }

  const cuts = [blastBounds.minCross];
  for (let index = 0; index < ranges.length - 1; index += 1) {
    const left = sorted[ranges[index].end - 1].cross;
    const right = sorted[ranges[index + 1].start].cross;
    cuts.push((left + right) / 2);
  }
  cuts.push(blastBounds.maxCross);

  return ranges.map((cellRange, index) => {
    const members = sorted.slice(cellRange.start, cellRange.end);
    const stats = scoreSegment(sorted, prefix, categories, cellRange.start, cellRange.end, depth, targetGrade, options);
    const minCross = cuts[index];
    const maxCross = cuts[index + 1];
    const digPolygon = clipPolygonToRect(blastDig, minCross, maxCross, band.min, band.max);
    const polygon = digPolygon.map((point) => fromDigPoint(point, axes));
    const ring = polygon.map((point) => [point.x, point.y]);
    if (ring.length) ring.push(ring[0]);
    const geologyTonnes = {};
    for (const member of members) geologyTonnes[member.geology] = (geologyTonnes[member.geology] || 0) + member.tonnes;
    const dominantGeology = Object.entries(geologyTonnes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
    const centroid = polygonCentroid(polygon);
    return {
      id: `DIG-${String(idOffset + index + 1).padStart(2, '0')}`,
      polygon: ring,
      geometry: { type: 'Polygon', coordinates: [ring] },
      centroid,
      cellIds: members.map((cell) => cell.id),
      tonnes: stats.tonnes,
      headGrade: stats.grade,
      averageHardness: stats.hardnessMean,
      dominantGeology,
      geologyTonnes,
      faceWidth: stats.faceWidth,
      advanceDepth: depth,
      faceToDepthRatio: stats.ratio,
      score: stats.score,
      miningOrder: idOffset + index + 1,
    };
  });
}

function applyExactCellIntersections(blocks, cells, targetGrade, options) {
  const assignments = [];
  const exactBlocks = blocks.map((block) => {
    const polygon = block.polygon.slice(0, -1).map(([x, y]) => ({ x, y }));
    const blockBounds = {
      minX: Math.min(...polygon.map((point) => point.x)),
      maxX: Math.max(...polygon.map((point) => point.x)),
      minY: Math.min(...polygon.map((point) => point.y)),
      maxY: Math.max(...polygon.map((point) => point.y)),
    };
    let tonnes = 0;
    let gradeMass = 0;
    let hardnessMass = 0;
    let hardnessSquaredMass = 0;
    let intersectionArea = 0;
    let volume = 0;
    let volumeComplete = true;
    const geologyTonnes = {};
    const cellIds = [];

    for (const cell of cells) {
      const minX = cell.x - cell.dx / 2;
      const maxX = cell.x + cell.dx / 2;
      const minY = cell.y - cell.dy / 2;
      const maxY = cell.y + cell.dy / 2;
      if (maxX <= blockBounds.minX + EPSILON || minX >= blockBounds.maxX - EPSILON
        || maxY <= blockBounds.minY + EPSILON || minY >= blockBounds.maxY - EPSILON) continue;
      const intersection = clipPolygonToRect(polygon, minX, maxX, minY, maxY);
      const area = Math.min(cell.sourceArea, polygonArea(intersection));
      if (area <= EPSILON) continue;
      const cellFraction = clamp(area / cell.sourceArea, 0, 1);
      const contributionTonnes = cell.sourceTonnes * cellFraction;
      const contributionVolume = cell.dz === null ? null : area * cell.dz;
      tonnes += contributionTonnes;
      gradeMass += contributionTonnes * cell.fe;
      hardnessMass += contributionTonnes * cell.hardness;
      hardnessSquaredMass += contributionTonnes * cell.hardness * cell.hardness;
      intersectionArea += area;
      if (contributionVolume === null) volumeComplete = false;
      else volume += contributionVolume;
      geologyTonnes[cell.geology] = (geologyTonnes[cell.geology] || 0) + contributionTonnes;
      cellIds.push(cell.id);
      assignments.push({
        cellId: cell.id,
        digBlockId: block.id,
        intersectionArea: area,
        intersectionVolume: contributionVolume,
        cellFraction,
        blastFraction: cell.blastFraction,
        tonnes: contributionTonnes,
      });
    }

    const headGrade = gradeMass / Math.max(tonnes, EPSILON);
    const averageHardness = hardnessMass / Math.max(tonnes, EPSILON);
    const hardnessVariance = Math.max(0, hardnessSquaredMass / Math.max(tonnes, EPSILON) - averageHardness ** 2);
    const dominantGeology = Object.entries(geologyTonnes)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
    const scored = scorePhysicals({
      tonnes,
      grade: headGrade,
      hardnessMean: averageHardness,
      hardnessVariance,
      faceWidth: block.faceWidth,
      bandDepth: block.advanceDepth,
      geologyTonnes,
    }, targetGrade, options);
    return {
      ...block,
      cellIds,
      tonnes,
      headGrade,
      averageHardness,
      dominantGeology,
      geologyTonnes,
      intersectionArea,
      volume: volumeComplete ? volume : null,
      faceToDepthRatio: scored.ratio,
      score: scored.score,
    };
  });
  return { blocks: exactBlocks, assignments };
}

function normalizeOptions(options, cells) {
  const targetTonnes = finiteNumber(options.targetTonnes, DEFAULT_OPTIONS.targetTonnes);
  if (!(targetTonnes > 0)) throw new Error('targetTonnes must be greater than zero');
  const weights = { ...DEFAULT_OPTIONS.weights, ...(options.weights || {}) };
  const totalTonnes = cells.reduce((sum, cell) => sum + cell.tonnes, 0);
  const averageGrade = cells.reduce((sum, cell) => sum + cell.tonnes * cell.fe, 0) / Math.max(totalTonnes, EPSILON);
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    targetTonnes,
    targetGrade: finiteNumber(options.targetGrade, averageGrade),
    targetFaceToDepthRatio: Math.max(0.2, finiteNumber(options.targetFaceToDepthRatio, DEFAULT_OPTIONS.targetFaceToDepthRatio)),
    minFaceWidth: Math.max(EPSILON, finiteNumber(options.minFaceWidth, DEFAULT_OPTIONS.minFaceWidth)),
    gradeScale: Math.max(EPSILON, finiteNumber(options.gradeScale, DEFAULT_OPTIONS.gradeScale)),
    weights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Math.max(0, finiteNumber(value, 0))])),
  };
}

/**
 * Partition a single-bench block model into direction-aligned dig blocks.
 *
 * Axis-aligned cell footprints are intersected exactly in XY. Tonnage and
 * grade contributions are prorated by intersection area; when `dz` is
 * supplied the corresponding vertical-prism intersection volume is returned.
 *
 * @param {Array<object>} inputCells - Block-model cells
 * @param {Array<Array<number>>|object} blastPolygon - XY ring or GeoJSON Polygon
 * @param {object} [inputOptions] - Optimisation controls
 * @returns {object} Dig blocks, assignments and aggregate metrics
 */
export function optimizeDigBlocks(inputCells, blastPolygon, inputOptions = {}) {
  if (!Array.isArray(inputCells) || !inputCells.length) throw new Error('cells must be a non-empty array');
  const blast = normalizePolygon(blastPolygon);
  const axes = digDirectionAxes(inputOptions.digDirectionDeg);
  const blastDig = blast.map((point) => toDigPoint(point, axes));
  const cells = inputCells.map((cell, index) => {
    const x = finiteNumber(cell.x);
    const y = finiteNumber(cell.y);
    const sourceTonnes = finiteNumber(cell.tonnes);
    const fe = finiteNumber(cell.fe);
    const dx = Math.abs(finiteNumber(cell.dx, 1));
    const dy = Math.abs(finiteNumber(cell.dy, 1));
    if (![x, y, sourceTonnes, fe, dx, dy].every(Number.isFinite) || sourceTonnes <= 0 || dx <= 0 || dy <= 0) {
      throw new Error(`cell ${cell.id ?? index} requires finite x, y and fe plus positive tonnes, dx and dy`);
    }
    const sourceArea = dx * dy;
    const blastIntersection = clipPolygonToRect(blast, x - dx / 2, x + dx / 2, y - dy / 2, y + dy / 2);
    const blastIntersectionArea = Math.min(sourceArea, polygonArea(blastIntersection));
    if (blastIntersectionArea <= EPSILON) return null;
    const blastFraction = clamp(blastIntersectionArea / sourceArea, 0, 1);
    const representative = polygonCentroid(blastIntersection);
    const dig = toDigPoint(representative, axes);
    const projectedHalfCross = (dx * Math.abs(axes.cross.x) + dy * Math.abs(axes.cross.y)) / 2;
    const inputDz = finiteNumber(cell.dz);
    return {
      ...cell,
      id: String(cell.id ?? `CELL-${index + 1}`),
      x,
      y,
      dx,
      dy,
      dz: inputDz > 0 ? inputDz : null,
      sourceTonnes,
      tonnes: sourceTonnes * blastFraction,
      fe,
      hardness: finiteNumber(cell.hardness, 1),
      geology: String(cell.geology ?? 'Unclassified'),
      cross: dig.x,
      forward: dig.y,
      crossMin: dig.x - projectedHalfCross,
      crossMax: dig.x + projectedHalfCross,
      sourceArea,
      area: blastIntersectionArea,
      blastIntersectionArea,
      blastFraction,
    };
  }).filter(Boolean);
  if (!cells.length) throw new Error('blastPolygon does not intersect any cell footprints');
  const options = normalizeOptions(inputOptions, cells);
  const minCross = Math.min(...blastDig.map((point) => point.x));
  const maxCross = Math.max(...blastDig.map((point) => point.x));
  const minForward = Math.min(...blastDig.map((point) => point.y));
  const maxForward = Math.max(...blastDig.map((point) => point.y));
  const estimatedTotalTonnes = cells.reduce((sum, cell) => sum + cell.tonnes, 0);
  const estimatedBlocks = Math.max(1, Math.round(estimatedTotalTonnes / options.targetTonnes));
  const targetArea = polygonArea(blastDig) / estimatedBlocks;
  const targetDepth = Math.sqrt(targetArea / options.targetFaceToDepthRatio);
  const bandCount = clamp(Math.round((maxForward - minForward) / Math.max(targetDepth, EPSILON)), 1, estimatedBlocks);
  const bandDepth = (maxForward - minForward) / bandCount;
  const bands = Array.from({ length: bandCount }, (_, index) => {
    const min = minForward + index * bandDepth;
    const max = index === bandCount - 1 ? maxForward : min + bandDepth;
    return {
      min,
      max,
      cells: cells.filter((cell) => cell.forward >= min - EPSILON
        && (index === bandCount - 1 ? cell.forward <= max + EPSILON : cell.forward < max)),
    };
  }).filter((band) => band.cells.length);

  const provisionalBlocks = [];
  for (const band of bands) {
    provisionalBlocks.push(...partitionBand(
      band.cells,
      band,
      options.targetGrade,
      options,
      { minCross, maxCross },
      blastDig,
      axes,
      provisionalBlocks.length,
    ));
  }
  const exact = applyExactCellIntersections(provisionalBlocks, cells, options.targetGrade, options);
  const blocks = exact.blocks;
  const assignments = exact.assignments;
  const totalTonnes = blocks.reduce((sum, block) => sum + block.tonnes, 0);
  const weightedGrade = blocks.reduce((sum, block) => sum + block.tonnes * block.headGrade, 0) / totalTonnes;
  const meanTonnesError = blocks.reduce((sum, block) => sum + Math.abs(block.tonnes - options.targetTonnes) / options.targetTonnes, 0) / blocks.length;
  const meanGradeError = blocks.reduce((sum, block) => sum + Math.abs(block.headGrade - options.targetGrade), 0) / blocks.length;
  const assignmentCounts = assignments.reduce((counts, assignment) => {
    counts.set(assignment.cellId, (counts.get(assignment.cellId) || 0) + 1);
    return counts;
  }, new Map());
  const volumesComplete = blocks.every((block) => block.volume !== null);
  return {
    blocks,
    assignments,
    blastPolygon: { type: 'Polygon', coordinates: [[...blast.map((point) => [point.x, point.y]), [blast[0].x, blast[0].y]]] },
    options,
    metrics: {
      blockCount: blocks.length,
      assignedCellCount: assignmentCounts.size,
      intersectionCount: assignments.length,
      splitCellCount: [...assignmentCounts.values()].filter((count) => count > 1).length,
      totalTonnes,
      totalVolume: volumesComplete ? blocks.reduce((sum, block) => sum + block.volume, 0) : null,
      weightedGrade,
      meanTonnesError,
      meanGradeError,
      totalScore: blocks.reduce((sum, block) => sum + block.score, 0),
    },
  };
}

/**
 * Create deterministic iron-ore bench cells and a convex ~200 kt blast.
 *
 * @returns {{cells:Array<object>, blastPolygon:Array<Array<number>>}}
 */
export function createSyntheticDigBlockModel() {
  const blastPolygon = [[10, 0], [155, 0], [180, 20], [175, 78], [145, 100], [22, 95], [0, 75], [0, 20]];
  const blast = blastPolygon.map(([x, y]) => ({ x, y }));
  const cells = [];
  let index = 0;
  for (let y = 5; y < 105; y += 10) {
    for (let x = 5; x < 185; x += 10) {
      const intersection = clipPolygonToRect(blast, x - 5, x + 5, y - 5, y + 5);
      if (polygonArea(intersection) <= EPSILON) continue;
      const highGradeLens = 8 * Math.exp(-(((x - 65) / 38) ** 2 + ((y - 52) / 24) ** 2));
      const secondLens = 5 * Math.exp(-(((x - 135) / 28) ** 2 + ((y - 35) / 30) ** 2));
      const fe = 52 + highGradeLens + secondLens + 1.4 * Math.sin(x / 17) - 0.8 * Math.cos(y / 13);
      const geology = x < 72 + 0.35 * y ? 'BIF' : y > 67 + 0.08 * x ? 'Shale' : 'Goethite';
      const hardness = geology === 'BIF' ? 8.2 : geology === 'Goethite' ? 5.4 : 3.8;
      const density = geology === 'BIF' ? 2.55 : geology === 'Goethite' ? 2.35 : 2.15;
      cells.push({
        id: `BM-${String(++index).padStart(3, '0')}`,
        x,
        y,
        z: 100,
        dx: 10,
        dy: 10,
        dz: 5,
        tonnes: 10 * 10 * 5 * density,
        fe,
        geology,
        hardness,
      });
    }
  }
  return { cells, blastPolygon };
}
