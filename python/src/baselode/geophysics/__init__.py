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
import baselode.geophysics.sampling as geophysics_sampling
import baselode.geophysics.writers as geophysics_writers
import baselode.geophysics.workflows as geophysics_workflows
import baselode.geophysics.observations as geophysics_observations
import baselode.geophysics.gridding as geophysics_gridding
import baselode.geophysics.alignment as geophysics_alignment
import baselode.geophysics.equivalent_sources as geophysics_equivalent_sources
import baselode.geophysics.corrections as geophysics_corrections

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
sample_points = geophysics_sampling.sample_points
sample_table = geophysics_sampling.sample_table
sample_profile = geophysics_sampling.sample_profile
profile_stations = geophysics_sampling.profile_stations
SAMPLING_METHODS = geophysics_sampling.SAMPLING_METHODS
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

list_operations = geophysics_workflows.list_operations
describe_operation = geophysics_workflows.describe_operation
workflow_schema = geophysics_workflows.workflow_schema
magnetic_grid_recipe = geophysics_workflows.magnetic_grid_recipe
validate_workflow = geophysics_workflows.validate_workflow
run_workflow = geophysics_workflows.run_workflow

create_observations = geophysics_observations.create_observations
observation_schema = geophysics_observations.observation_schema
describe_observation_qc = geophysics_observations.describe_observation_qc
qc_observations = geophysics_observations.qc_observations

describe_gridding = geophysics_gridding.describe_gridding
grid_observations = geophysics_gridding.grid_observations
cross_validate_gridding = geophysics_gridding.cross_validate_gridding

describe_alignment = geophysics_alignment.describe_alignment
align_raster = geophysics_alignment.align_raster
match_raster = geophysics_alignment.match_raster

run_equivalent_sources = geophysics_equivalent_sources.run_equivalent_sources
describe_equivalent_sources = geophysics_equivalent_sources.describe_equivalent_sources
grid_equivalent_sources = geophysics_equivalent_sources.grid_equivalent_sources
cross_validate_equivalent_sources = geophysics_equivalent_sources.cross_validate_equivalent_sources

describe_corrections = geophysics_corrections.describe_corrections
inspect_corrections = geophysics_corrections.inspect_corrections
declare_corrections = geophysics_corrections.declare_corrections
correct_magnetic_base = geophysics_corrections.correct_magnetic_base

__all__ = [
    "describe_corrections",
    "inspect_corrections",
    "declare_corrections",
    "correct_magnetic_base",
    "run_equivalent_sources",
    "describe_equivalent_sources",
    "grid_equivalent_sources",
    "cross_validate_equivalent_sources",
    "describe_alignment",
    "align_raster",
    "match_raster",

    "describe_gridding",
    "grid_observations",
    "cross_validate_gridding",

    "create_observations",
    "observation_schema",
    "describe_observation_qc",
    "qc_observations",

    "list_operations",
    "describe_operation",
    "workflow_schema",
    "magnetic_grid_recipe",
    "validate_workflow",
    "run_workflow",

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
    "sample_points",
    "sample_table",
    "sample_profile",
    "profile_stations",
    "SAMPLING_METHODS",
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
