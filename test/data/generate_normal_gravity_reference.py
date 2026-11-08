# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Generate independent reference values by differentiating the normal potential.

Run manually with the test extra installed. This never imports Boule or Baselode.
The standard external ellipsoidal normal potential is evaluated at 80 decimal
places, differentiated numerically by mpmath, then scaled with the confocal
coordinate metric. This is independent of Boule's binary64 acceleration formulas.
References: Hofmann-Wellenhof & Moritz (2006), Physical Geodesy, normal potential;
Li & Goetze (2001), Journal of Geodesy 75, 460-470, doi:10.1007/s001900100198.
"""
import json
import pathlib

import mpmath

mpmath.mp.dps = 80


def normal(model, latitude, height):
    a = mpmath.mpf('6378137')
    f = 1 / mpmath.mpf('298.257223563' if model == 'WGS84' else '298.257222101')
    gm = mpmath.mpf('398600441800000' if model == 'WGS84' else '398600500000000')
    omega = mpmath.mpf('0.00007292115')
    b = a * (1-f)
    eccentricity = mpmath.sqrt(a*a-b*b)
    phi = mpmath.radians(latitude)
    prime = a / mpmath.sqrt(1-(2*f-f*f)*mpmath.sin(phi)**2)
    radius = (prime+height)*mpmath.cos(phi)
    z = (prime*(1-f)**2+height)*mpmath.sin(phi)
    square = radius*radius+z*z-eccentricity**2
    u = mpmath.sqrt((square+mpmath.sqrt(square*square+4*eccentricity**2*z*z))/2)
    beta = mpmath.atan2(z/u,radius/mpmath.sqrt(u*u+eccentricity**2))
    def q(value):
        return ((1+3*value*value/eccentricity**2)*mpmath.atan(eccentricity/value)-3*value/eccentricity)/2
    def potential(value, angle):
        gravitational = gm/eccentricity*mpmath.atan(eccentricity/value)
        flattening_term = omega**2*a*a/2*q(value)/q(b)*(mpmath.sin(angle)**2-mpmath.mpf(1)/3)
        centrifugal = omega**2/2*(value*value+eccentricity**2)*mpmath.cos(angle)**2
        return gravitational+flattening_term+centrifugal
    hu = mpmath.sqrt((u*u+eccentricity**2*mpmath.sin(beta)**2)/(u*u+eccentricity**2))
    hb = mpmath.sqrt(u*u+eccentricity**2*mpmath.sin(beta)**2)
    gu = mpmath.diff(lambda value:potential(value,beta),u)/hu
    gb = mpmath.diff(lambda angle:potential(u,angle),beta)/hb
    return mpmath.sqrt(gu*gu+gb*gb)*100000


def generate():
    cases = []
    for model in ['WGS84','GRS80']:
        for latitude,height in [(0,0),(90,0),(-90,0),(45,0),(-32,100),(60,10000),(0,100000),(90,100000),(45,100000),(-60,100000)]:
            gravity = normal(model,latitude,mpmath.mpf(height))
            sensitivity = normal(model,latitude,mpmath.mpf(height)+1)-gravity
            cases.append({'model':model,'point':{'id':model+'_'+str(latitude)+'_'+str(height),'longitude':117,'latitude':latitude,'height_m':height},'normal_gravity':float(gravity),'height_sensitivity_mGal_per_m':float(sensitivity)})
    result = {'method':__doc__,'tolerance_mGal':1e-5,'sensitivity_tolerance_mGal_per_m':1e-5,'cases':cases}
    pathlib.Path(__file__).with_name('normal_gravity_reference.json').write_text(json.dumps(result,indent=2)+'\n')


if __name__ == '__main__':
    generate()
