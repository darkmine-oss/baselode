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

import baselode.geophysics.igrf as geophysics_igrf

describe_igrf = geophysics_igrf.describe_igrf
calculate_igrf = geophysics_igrf.calculate_igrf
remove_igrf = geophysics_igrf.remove_igrf

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
correct_magnetic_lag = geophysics_corrections.correct_magnetic_lag
correct_magnetic_heading = geophysics_corrections.correct_magnetic_heading
describe_crossovers = geophysics_corrections.describe_crossovers
analyze_crossovers = geophysics_corrections.analyze_crossovers
level_magnetic_lines = geophysics_corrections.level_magnetic_lines

__all__ = [
    "describe_crossovers",
    "analyze_crossovers",
    "level_magnetic_lines",
    "correct_magnetic_heading",
    "correct_magnetic_lag",
    "describe_igrf",
    "calculate_igrf",
    "remove_igrf",
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

# Horizontal observation derivation preserves bound correction history.
describe_reprojection = geophysics_corrections.describe_reprojection
reproject_observations = geophysics_corrections.reproject_observations
__all__ += ["describe_reprojection", "reproject_observations"]

import baselode.geophysics.observation_workflows as geophysics_observation_workflows

describe_observation_workflow = geophysics_observation_workflows.describe_observation_workflow
validate_observation_workflow = geophysics_observation_workflows.validate_observation_workflow
run_observation_workflow = geophysics_observation_workflows.run_observation_workflow
magnetic_observation_recipe = geophysics_observation_workflows.magnetic_observation_recipe
__all__ += ["describe_observation_workflow", "validate_observation_workflow", "run_observation_workflow", "magnetic_observation_recipe"]

import baselode.geophysics.normal_gravity as geophysics_normal_gravity

describe_normal_gravity = geophysics_normal_gravity.describe_normal_gravity
calculate_normal_gravity = geophysics_normal_gravity.calculate_normal_gravity
remove_normal_gravity = geophysics_normal_gravity.remove_normal_gravity
__all__ += ["describe_normal_gravity", "calculate_normal_gravity", "remove_normal_gravity"]

import baselode.geophysics.gravity_temporal as geophysics_gravity_temporal

describe_gravity_temporal = geophysics_gravity_temporal.describe_gravity_temporal
apply_gravity_tide = geophysics_gravity_temporal.apply_gravity_tide
correct_gravity_drift = geophysics_gravity_temporal.correct_gravity_drift
analyze_gravity_repeats = geophysics_gravity_temporal.analyze_gravity_repeats
__all__ += ["describe_gravity_temporal", "apply_gravity_tide", "correct_gravity_drift", "analyze_gravity_repeats"]

import baselode.geophysics.gravity_topography as geophysics_gravity_topography

describe_gravity_topography = geophysics_gravity_topography.describe_gravity_topography
calculate_bouguer_plate = geophysics_gravity_topography.calculate_bouguer_plate
apply_bouguer_plate = geophysics_gravity_topography.apply_bouguer_plate
correct_gravity_terrain = geophysics_gravity_topography.correct_gravity_terrain

__all__ += ["describe_gravity_topography", "calculate_bouguer_plate", "apply_bouguer_plate", "correct_gravity_terrain"]

import baselode.geophysics.radiometrics as geophysics_radiometrics
describe_radiometrics = geophysics_radiometrics.describe_radiometrics
stack_radiometric_grids = geophysics_radiometrics.stack_radiometric_grids
radiometric_ratios = geophysics_radiometrics.radiometric_ratios
radiometric_ternary = geophysics_radiometrics.radiometric_ternary
__all__ += ['describe_radiometrics', 'stack_radiometric_grids', 'radiometric_ratios', 'radiometric_ternary']
