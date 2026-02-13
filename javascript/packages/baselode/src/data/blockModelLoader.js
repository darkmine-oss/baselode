/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Papa from 'papaparse';
import { withDataErrorContext } from './dataErrorUtils.js';

export function parseBlockModelCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      complete: (results) => {
        const data = results.data.filter((row) =>
          row.center_x !== null &&
          row.center_y !== null &&
          row.center_z !== null
        );

        const excludeColumns = ['center_x', 'center_y', 'center_z', 'size_x', 'size_y', 'size_z'];
        const propertyColumns = Object.keys(data[0] || {}).filter(
          (key) => !excludeColumns.includes(key)
        );

        resolve({ data, properties: propertyColumns });
      },
      error: (error) => {
        reject(withDataErrorContext('parseBlockModelCSV', error));
      }
    });
  });
}

export function calculatePropertyStats(data, property) {
  const values = data
    .map((row) => row[property])
    .filter((v) => v !== null && v !== undefined);

  const isNumeric = values.every((v) => typeof v === 'number');

  if (isNumeric) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { type: 'numeric', min, max, values };
  }

  const uniqueValues = [...new Set(values)];
  return { type: 'categorical', categories: uniqueValues, values };
}

export function getColorForValue(value, stats, THREEInstance) {
  if (!stats) return new THREEInstance.Color('#888888');

  if (stats.type === 'numeric') {
    const range = stats.max - stats.min;
    const normalized = range === 0 ? 0.5 : (value - stats.min) / range;
    const hue = (1 - normalized) * 240; // 240 is blue, 0 is red
    return new THREEInstance.Color().setHSL(hue / 360, 0.8, 0.5);
  }

  const index = stats.categories.indexOf(value);
  const hue = (index / Math.max(stats.categories.length, 1)) * 360;
  return new THREEInstance.Color().setHSL(hue / 360, 0.7, 0.5);
}
