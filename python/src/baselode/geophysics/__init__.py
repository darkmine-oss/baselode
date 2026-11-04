"""Geophysics raster models, readers, processing and colour scales.

The module intentionally keeps a small, NumPy-first public contract.  It can
therefore move data between acquisition formats, visualisation clients, and
future modelling packages without making any particular algorithm package a
core Baselode dependency.
"""

# Aliases avoid reading ``baselode.geophysics`` before this package finishes
# initialising.
import baselode.geophysics.colour_scales as geophysics_colour_scales
import baselode.geophysics.editing as geophysics_editing
import baselode.geophysics.ers as geophysics_ers
import baselode.geophysics.processing as geophysics_processing
import baselode.geophysics.raster as geophysics_raster
import baselode.geophysics.writers as geophysics_writers

GeophysicsRaster = geophysics_raster.GeophysicsRaster
load_raster = geophysics_raster.load_raster
read_ers = geophysics_ers.read_ers
hillshade = geophysics_processing.hillshade
hillshade_z_factor = geophysics_processing.hillshade_z_factor
low_pass = geophysics_processing.low_pass
high_pass = geophysics_processing.high_pass
band_pass = geophysics_processing.band_pass
vertical_derivative = geophysics_processing.vertical_derivative
horizontal_derivative = geophysics_processing.horizontal_derivative
total_horizontal_derivative = geophysics_processing.total_horizontal_derivative
tilt_derivative = geophysics_processing.tilt_derivative
analytic_signal = geophysics_processing.analytic_signal
upward_continuation = geophysics_processing.upward_continuation
reduce_to_pole = geophysics_processing.reduce_to_pole
COLOUR_SCALES = geophysics_colour_scales.COLOUR_SCALES
stretch_values = geophysics_colour_scales.stretch_values
colourize = geophysics_colour_scales.colourize
crop = geophysics_editing.crop
clip = geophysics_editing.clip
combine = geophysics_editing.combine
fill_gaps = geophysics_editing.fill_gaps
COMBINE_OPERATIONS = geophysics_editing.COMBINE_OPERATIONS
write_ers = geophysics_writers.write_ers
write_geotiff = geophysics_writers.write_geotiff
save_raster = geophysics_writers.save_raster

__all__ = [
    "GeophysicsRaster",
    "load_raster",
    "read_ers",
    "hillshade",
    "hillshade_z_factor",
    "low_pass",
    "high_pass",
    "band_pass",
    "vertical_derivative",
    "horizontal_derivative",
    "total_horizontal_derivative",
    "tilt_derivative",
    "analytic_signal",
    "upward_continuation",
    "reduce_to_pole",
    "COLOUR_SCALES",
    "stretch_values",
    "colourize",
    "crop",
    "clip",
    "combine",
    "fill_gaps",
    "COMBINE_OPERATIONS",
    "write_ers",
    "write_geotiff",
    "save_raster",
]
