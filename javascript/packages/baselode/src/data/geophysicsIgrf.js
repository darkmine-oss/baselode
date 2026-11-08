/* Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later */
import descriptor from './geophysics_igrf.json';
/** Independent IGRF14 schemas and conventions. Execution requires Python baselode[magnetics]. */
export function describeGeophysicsIgrf() { return JSON.parse(JSON.stringify(descriptor)); }
