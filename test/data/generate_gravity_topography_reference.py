# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent 50-digit Newtonian horizontal integration; no modelling imports."""
import json
import pathlib

import mpmath

mpmath.mp.dps = 50
G = mpmath.mpf('6.67430e-11')
density = 2670
heights = [[100,120,100],[80,100,100],[100,100,100]]
west, south, east, north = 499985,6499985,500015,6500015
expected, records = [], []
for index, x in enumerate([500000,500010]):
    y, z = 6500000,100
    gz = mpmath.mpf(0)
    for i, row in enumerate(heights):
        for j, height in enumerate(row):
            if height == z:
                continue
            bottom, top = min(z,height)-z, max(z,height)-z
            a,b = west+j*10-x,west+(j+1)*10-x
            c,d = north-(i+1)*10-y,north-i*10-y
            def integrand(xx, yy):
                return 1/mpmath.sqrt(xx*xx+yy*yy+top*top)-1/mpmath.sqrt(xx*xx+yy*yy+bottom*bottom)
            horizontal = mpmath.quad(lambda xx: mpmath.quad(lambda yy: integrand(xx,yy),[c,d]),[a,b])
            gz += G*density*(1 if height>z else -1)*horizontal*100000
    plate = 2*mpmath.pi*G*density*z*100000
    tc = -gz
    truth = 7+4*index
    raw = truth+plate-tc
    expected.append({'id':'p'+str(index),'truth_mGal':truth,'plate_mGal':float(plate),'terrain_mGal':float(tc),'raw_disturbance_mGal':float(raw)})
    records.append({'id':'p'+str(index),'x':x,'y':y,'z':z,'values':{'g':float(raw),'other':index+2}})
records.append({'id':'missing','values':{'g':None,'other':5}})
plate_options={'channel':'g','density_kg_m3':density,'reference_height_m':0,'height_datum':'WGS84_ellipsoid','reference_policy':'caller_verified','max_abs_correction_mGal':100,'event_id':'plate','evidence':'independent synthetic Newtonian terrain and supplied land density'}
terrain_options={**plate_options,'event_id':'terrain','dem':{'id':'synthetic-relief','crs':'EPSG:32750','crs_units':'m','frame_id':None,'height_datum':'WGS84_ellipsoid','bounds':[west,south,east,north],'heights':heights},'outside_dem_policy':'flat_at_station_height','min_edge_distance_m':1,'ground_tolerance_m':0}
f={'method':'Independent 50-digit double quadrature of Newtonian downward gravity after analytical vertical integration. Known flat reference plate plus signed hill/valley terrain effects injected into known 7/11 mGal disturbances; no Baselode/Harmonica/Choclo import.','survey':{'crs':'EPSG:32750','crs_units':'m','channels':{'g':{'field_type':'gravity_disturbance','units':'mGal'},'other':{'field_type':'gravity_disturbance','units':'mGal'}},'records':records,'metadata':{'height_units':'m','height_datum':'WGS84_ellipsoid','z_positive':'up','gravity_datum':'synthetic absolute datum','tide_system':'tide_free','corrections':{'gravity_normal':'applied','gravity_drift':'applied','gravity_tide':'applied','gravity_free_air':'unapplied','gravity_bouguer':'unapplied','gravity_terrain':'unapplied'},'uncertainty':{'g':0.01}}},'plate_options':plate_options,'terrain_options':terrain_options,'expected':expected}
pathlib.Path(__file__).with_name('gravity_topography_reference.json').write_text(json.dumps(f,indent=2)+'\n')
