// Copyright (C) 2026 Darkmine Pty Ltd.

// SPDX-License-Identifier: GPL-3.0-or-later

import { getGeologicalSchema, getGeologicalTable } from 'baselode/geological-schema';

const schema = getGeologicalSchema();
const approximate: string = schema.spatialProfile.locationStatuses.approximate;
const qualification: string = schema.spatialProfile.qualification;
const table = getGeologicalTable('drill.petrophysics');
const description: string | undefined = table?.columns.specific_gravity?.description;
void [approximate, qualification, description];
