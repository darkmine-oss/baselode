"""Geophysics raster models, readers, processing and colour scales.

The module intentionally keeps a small, NumPy-first public contract.  It can
therefore move data between acquisition formats, visualisation clients, and
future modelling packages without making any particular algorithm package a
core Baselode dependency.
"""

# Aliases avoid reading ``baselode.geophysics`` before this package finishes
# initialising.
import baselode.geophysics.colour_scales as geophysics_colour_scales
import baselode.geophysics.ers as geophysics_ers
import baselode.geophysics.processing as geophysics_processing
import baselode.geophysics.raster as geophysics_raster

GeophysicsRaster = geophysics_raster.GeophysicsRaster
load_raster = geophysics_raster.load_raster
read_ers = geophysics_ers.read_ers
hillshade = geophysics_processing.hillshade
hillshade_z_factor = geophysics_processing.hillshade_z_factor
low_pass = geophysics_processing.low_pass
high_pass = geophysics_processing.high_pass
band_pass = geophysics_processing.band_pass
COLOUR_SCALES = geophysics_colour_scales.COLOUR_SCALES
stretch_values = geophysics_colour_scales.stretch_values
colourize = geophysics_colour_scales.colourize

__all__ = [
    "GeophysicsRaster",
    "load_raster",
    "read_ers",
    "hillshade",
    "hillshade_z_factor",
    "low_pass",
    "high_pass",
    "band_pass",
    "COLOUR_SCALES",
    "stretch_values",
    "colourize",
]
