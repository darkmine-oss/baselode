/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_gravity_temporal.json';
/** Independent calibrated tide/drift/repeat schemas, limits and assumptions. */
export function describeGeophysicsGravityTemporal() {return JSON.parse(JSON.stringify(descriptor));}
export {applyGeophysicsGravityTide,correctGeophysicsGravityDrift,analyzeGeophysicsGravityRepeats} from './geophysicsCorrections.js';
