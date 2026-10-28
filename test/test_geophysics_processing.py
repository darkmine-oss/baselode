# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

import json
import math
import pathlib

import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.colour_scales
import baselode.geophysics.ers
import baselode.geophysics.processing


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
JS_SCALES_PATH = REPO_ROOT / "javascript" / "packages" / "baselode" / "src" / "data" / "geophysics_color_scales.json"


ERS_HEADER = """DatasetHeader Begin
	Version		= "7.0"
	DataSetType	= ERStorage
	DataType	= Raster
	ByteOrder	= {byte_order}
	CoordinateSpace Begin
		Datum		= "{datum}"
		Projection	= "{projection}"
		CoordinateType	= {coordinate_type}
		Rotation	= 0:0:0.0
	CoordinateSpace End
	RasterInfo Begin
		CellType	= {cell_type}
		NullCellValue	= {null}
		CellInfo Begin
			Xdimension	= {cell_x}
			Ydimension	= {cell_y}
		CellInfo End
		NrOfLines	= {rows}
		NrOfCellsPerLine	= {columns}
		RegistrationCellX	= {registration_cell_x}
		RegistrationCellY	= {registration_cell_y}
		RegistrationCoord Begin
{registration}
		RegistrationCoord End
		NrOfBands	= {bands}
{band_ids}
	RasterInfo End
DatasetHeader End
"""


def write_ers(directory, data, name="grid", byte_order="MSBFirst", dtype=">f4", cell_type="IEEE4ByteReal",
              null=-99999, datum="GDA94", projection="MGA51", coordinate_type="EN",
              registration="\t\t\tEastings\t= 500000\n\t\t\tNorthings\t= 7000000",
              registration_cell=(0, 0), cell=(50, 50), band_ids=None):
    data = np.asarray(data)
    bands, rows, columns = data.shape
    band_ids = band_ids or [("TMI", "nT")] * bands
    band_text = "\n".join(
        f"\t\tBandId Begin\n\t\t\tValue\t= \"{value}\"\n\t\t\tUnits\t= \"{units}\"\n\t\tBandId End"
        for value, units in band_ids
    )
    header = ERS_HEADER.format(
        byte_order=byte_order, datum=datum, projection=projection, coordinate_type=coordinate_type,
        cell_type=cell_type, null=null, cell_x=cell[0], cell_y=cell[1], rows=rows, columns=columns,
        registration_cell_x=registration_cell[0], registration_cell_y=registration_cell[1],
        registration=registration, bands=bands, band_ids=band_text,
    )
    header_path = pathlib.Path(directory) / f"{name}.ers"
    header_path.write_text(header)
    # Band-interleaved by line.
    data.transpose(1, 0, 2).astype(dtype).tofile(header_path.with_suffix(""))
    return header_path


def two_band_grid():
    magnetics = np.arange(12, dtype=float).reshape(3, 4) * 10 - 40
    gravity = np.arange(12, dtype=float).reshape(3, 4)[::-1] * 0.5
    magnetics[1, 2] = -99999
    return np.stack([magnetics, gravity])


# --- ERS ---------------------------------------------------------------------

def test_native_ers_reads_band_interleaved_big_endian_grid(tmp_path):
    data = two_band_grid()
    path = write_ers(tmp_path, data, band_ids=[("TMI", "nT"), ("Bouguer", "mGal")])

    raster = baselode.geophysics.load_raster(path)

    assert raster.data.shape == (2, 3, 4)
    assert raster.transform == (50.0, 0.0, 500000.0, 0.0, -50.0, 7000000.0)
    assert raster.crs == "EPSG:28351"
    assert raster.nodata == -99999
    assert raster.band_names == ("TMI", "Bouguer")
    assert raster.metadata["units"] == ["nT", "mGal"]
    assert raster.metadata["driver"] == "ERS"
    assert np.isnan(raster.data[0, 1, 2])
    expected = data.copy()
    expected[0, 1, 2] = np.nan
    np.testing.assert_array_equal(raster.data, expected.astype(np.float32))


def test_native_ers_matches_gdal_reader(tmp_path):
    pytest.importorskip("rasterio")
    paths = [
        write_ers(tmp_path, two_band_grid()),
        write_ers(
            tmp_path, np.array([[[1, 2, 3], [4, -32768, 6]]]), name="geodetic", byte_order="LSBFirst",
            dtype="<i2", cell_type="Signed16BitInteger", null=-32768, projection="GEODETIC",
            coordinate_type="LL", registration="\t\t\tLongitude\t= 120:30:0.0\n\t\t\tLatitude\t= -31:30:0.0",
            registration_cell=(1, 1), cell=(0.01, 0.02),
        ),
    ]
    for path in paths:
        native = baselode.geophysics.load_raster(path)
        gdal = baselode.geophysics.load_raster(path, engine="rasterio")

        np.testing.assert_array_equal(native.data, gdal.data)
        np.testing.assert_allclose(native.transform, gdal.transform)
        assert native.nodata == gdal.nodata
        if gdal.crs.startswith("EPSG:"):
            assert native.crs == gdal.crs


def test_native_ers_geodetic_registration_and_integer_cells(tmp_path):
    data = np.array([[[1, 2, 3], [4, -32768, 6]]])
    path = write_ers(
        tmp_path, data, byte_order="LSBFirst", dtype="<i2", cell_type="Signed16BitInteger",
        null=-32768, projection="GEODETIC", coordinate_type="LL",
        registration="\t\t\tLongitude\t= 120:30:0.0\n\t\t\tLatitude\t= -31:30:0.0",
        registration_cell=(1, 1), cell=(0.01, 0.02),
    )

    raster = baselode.geophysics.load_raster(path)

    assert raster.crs == "EPSG:4283"
    a, _, c, _, e, f = raster.transform
    assert (a, e) == (0.01, -0.02)
    assert c == pytest.approx(120.5 - 0.01)
    assert f == pytest.approx(-31.5 + 0.02)
    assert np.isnan(raster.data[0, 1, 1])
    assert raster.data[0, 0, 2] == 3


def test_native_ers_selects_bands_and_rejects_bad_files(tmp_path):
    path = write_ers(tmp_path, two_band_grid(), band_ids=[("TMI", "nT"), ("Bouguer", "mGal")])
    selected = baselode.geophysics.load_raster(path, bands=[2])
    assert selected.band_names == ("Bouguer",)
    assert selected.metadata["units"] == ["mGal"]

    path.with_suffix("").write_bytes(b"\x00" * 8)
    with pytest.raises(ValueError, match="expected 24 cells"):
        baselode.geophysics.load_raster(path)
    with pytest.raises(ValueError, match="DatasetHeader"):
        baselode.geophysics.ers.parse_ers_header("Other Begin\nOther End\n")
    with pytest.raises(ValueError, match="unclosed"):
        baselode.geophysics.ers.parse_ers_header("DatasetHeader Begin\n")


@pytest.mark.parametrize(
    ("datum", "projection", "expected"),
    [
        ("GDA94", "MGA50", "EPSG:28350"),
        ("GDA2020", "MGA55", "EPSG:7855"),
        ("AGD84", "AMG51", "EPSG:20351"),
        ("WGS84", "SUTM53", "EPSG:32753"),
        ("WGS84", "GEODETIC", "EPSG:4326"),
        ("GDA94", "LOCAL", None),
        ("UNKNOWN", "MGA50", None),
    ],
)
def test_ers_datum_projection_maps_to_epsg(datum, projection, expected):
    assert baselode.geophysics.ers.ers_crs(datum, projection) == expected


# --- decimation and chat payload -------------------------------------------------

def test_decimate_block_averages_ignoring_missing_cells():
    data = np.arange(36, dtype=float).reshape(6, 6)
    data[0, 0] = np.nan
    raster = baselode.geophysics.GeophysicsRaster(data, transform=(10, 0, 0, 0, -10, 60))

    small = raster.decimate(max_cells=9)

    assert small.data.shape == (1, 3, 3)
    assert small.transform == (20.0, 0.0, 0.0, 0.0, -20.0, 60.0)
    assert small.data[0, 0, 0] == pytest.approx((1 + 6 + 7) / 3)
    assert small.metadata["processing"][-1] == {"operation": "decimate", "factor": 2, "method": "block_mean"}
    assert raster.decimate(max_cells=36) is raster


def test_payload_marks_long_nodata_sentinels_missing_before_rounding():
    sentinel = float(np.finfo(np.float32).min)
    raster = baselode.geophysics.GeophysicsRaster(np.array([[1.25, sentinel]], dtype=np.float32), nodata=sentinel)
    payload = raster.to_tool_ui_payload()["raster"]
    assert payload["data"] == [[[1.25, None]]]
    assert payload["nodata"] is None


def test_cell_size_handles_rotation_and_rejects_shear():
    rotated = baselode.geophysics.GeophysicsRaster([[1, 2], [3, 4]], transform=(8, 6, 0, 6, -8, 0))
    assert rotated.cell_size == pytest.approx((10.0, 10.0))
    sheared = baselode.geophysics.GeophysicsRaster([[1]], transform=(10, 5, 0, 0, -10, 0))
    with pytest.raises(ValueError, match="sheared"):
        sheared.cell_size


def test_payloads_are_strict_json_with_nan_nodata():
    raster = baselode.geophysics.GeophysicsRaster([[1.0, np.nan]], nodata=float("nan"))
    assert raster.to_payload()["nodata"] is None
    json.dumps(raster.to_payload(), allow_nan=False)
    json.dumps(raster.to_tool_ui_payload(), allow_nan=False)


def test_tool_ui_payload_is_compact_and_describes_display():
    rng = np.random.default_rng(1)
    raster = baselode.geophysics.GeophysicsRaster(
        rng.normal(size=(2, 500, 400)),
        transform=(25, 0, 400000, 0, -25, 6500000),
        crs="EPSG:28350",
        band_names=["tmi", "rtp"],
        metadata={"units": ["nT", "nT"]},
    )

    result = raster.to_tool_ui_payload(
        title="TMI", band=2, palette="turbo", hillshade={"enabled": True, "zFactor": "auto"},
        max_cells=10_000, result_id="tmi-1",
    )

    grid = result["raster"]["data"]
    assert len(grid) == 1 and len(grid[0]) * len(grid[0][0]) <= 10_000
    assert result["id"] == "tmi-1"
    assert result["units"] == "nT"
    assert result["raster"]["bandNames"] == ["rtp"]
    assert result["stretch"] == {"mode": "relative", "low": 2, "high": 98}
    assert result["showControls"] is False
    assert len(json.dumps(result)) < 200_000
    with pytest.raises(ValueError, match="palette"):
        raster.to_tool_ui_payload(palette="jet")
    with pytest.raises(ValueError, match="absolute"):
        raster.to_tool_ui_payload(stretch={"mode": "absolute", "min": 1})


# --- colour scales -----------------------------------------------------------

def test_colour_scales_match_javascript_package():
    shared = json.loads(JS_SCALES_PATH.read_text())["scales"]
    assert shared == baselode.geophysics.colour_scales.COLOUR_SCALES


def test_relative_absolute_and_equalized_stretches():
    values = np.array([[0.0, 1.0, 2.0, 3.0, 100.0], [np.nan, -5, 4, 5, 6]])
    finite = values[np.isfinite(values)]

    ratios, limits = baselode.geophysics.stretch_values(values, {"mode": "relative", "low": 10, "high": 90})
    assert limits == pytest.approx(tuple(np.percentile(finite, [10, 90])))
    assert np.isnan(ratios[1, 0])
    assert ratios[0, 4] == 1.0 and ratios[1, 1] == 0.0

    ratios, limits = baselode.geophysics.stretch_values(values, {"mode": "absolute", "min": 0, "max": 10})
    assert limits == (0.0, 10.0)
    assert ratios[0, 1] == pytest.approx(0.1)

    ratios, _ = baselode.geophysics.stretch_values(values, {"mode": "equalize"})
    ordered = np.sort(ratios[np.isfinite(ratios)])
    np.testing.assert_allclose(ordered, np.linspace(0, 1, finite.size))

    with pytest.raises(ValueError, match="percentiles"):
        baselode.geophysics.colour_scales.validate_stretch({"mode": "relative", "low": 50, "high": 5})


def test_colourize_makes_missing_cells_transparent_and_applies_shade():
    values = np.array([[0.0, 1.0], [np.nan, 0.5]])
    rgba = baselode.geophysics.colourize(values, palette="grayscale", stretch={"mode": "absolute", "min": 0, "max": 1})
    assert rgba.dtype == np.uint8
    assert rgba[1, 0, 3] == 0
    assert rgba[0, 1].tolist() == [255, 255, 255, 255]

    shaded = baselode.geophysics.colourize(
        values, palette="grayscale", stretch={"mode": "absolute", "min": 0, "max": 1},
        shade=np.zeros((2, 2)), shade_strength=1.0,
    )
    assert shaded[0, 1].tolist() == [0, 0, 0, 255]
    reversed_rgba = baselode.geophysics.colourize(values, palette="grayscale", reverse=True,
                                                  stretch={"mode": "absolute", "min": 0, "max": 1})
    assert reversed_rgba[0, 0, 0] == 255


# --- hillshade ---------------------------------------------------------------

def plane_raster(slope_x=0.0, slope_y=0.0, size=9, cell=10.0):
    rows, columns = np.indices((size, size), dtype=float)
    data = slope_x * columns * cell - slope_y * rows * cell
    return baselode.geophysics.GeophysicsRaster(data, transform=(cell, 0, 0, 0, -cell, size * cell))


def test_hillshade_of_flat_grid_is_sine_of_sun_altitude():
    shade = baselode.geophysics.hillshade(plane_raster(), altitude=30, z_factor=1)
    np.testing.assert_allclose(shade, math.sin(math.radians(30)))


def test_hillshade_lights_slopes_facing_the_sun():
    # Surface rising to the east faces west.
    east_rising = plane_raster(slope_x=1.0)
    west_sun = baselode.geophysics.hillshade(east_rising, azimuth=270, altitude=45, z_factor=1)
    east_sun = baselode.geophysics.hillshade(east_rising, azimuth=90, altitude=45, z_factor=1)
    assert west_sun[4, 4] == pytest.approx(1.0)
    assert east_sun[4, 4] == pytest.approx(0.0, abs=1e-12)

    # Surface rising to the north faces south.
    north_rising = plane_raster(slope_y=1.0)
    south_sun = baselode.geophysics.hillshade(north_rising, azimuth=180, altitude=45, z_factor=1)
    assert south_sun[4, 4] == pytest.approx(1.0)


def test_hillshade_auto_z_factor_normalises_units_and_keeps_gaps():
    raster = plane_raster(slope_x=0.002)
    assert baselode.geophysics.hillshade_z_factor(raster) == pytest.approx(500.0)
    raster.data[0, 3, 3] = np.nan
    shade = baselode.geophysics.hillshade(raster, azimuth=270, altitude=45)
    assert np.isnan(shade[3, 3])
    assert shade[4, 4] == pytest.approx(1.0)
    with pytest.raises(ValueError, match="altitude"):
        baselode.geophysics.hillshade(raster, altitude=0)


# --- wavelength filters -----------------------------------------------------------

def two_wavelength_raster(size=128, cell=50.0, long_wavelength=3200.0, short_wavelength=200.0):
    rows, columns = np.indices((size, size), dtype=float)
    x = columns * cell
    regional = 100 * np.sin(2 * np.pi * x / long_wavelength)
    residual = 10 * np.sin(2 * np.pi * x / short_wavelength)
    raster = baselode.geophysics.GeophysicsRaster(
        regional + residual + 0.01 * x + 50,
        transform=(cell, 0, 0, 0, -cell, size * cell),
    )
    return raster, regional, residual


def interior(values, margin=24):
    return values[..., margin:-margin, margin:-margin]


def test_low_and_high_pass_separate_wavelengths():
    raster, regional, residual = two_wavelength_raster()

    low = baselode.geophysics.low_pass(raster, 600)
    high = baselode.geophysics.high_pass(raster, 600)

    trend = raster.data[0] - regional - residual
    # A Gaussian passes 97.6% of a wavelength 5x the cut-off.
    assert np.abs(interior(low.data[0] - regional - trend)).max() < 3.0
    assert np.abs(interior(high.data[0] - residual)).max() < 3.0
    assert low.metadata["processing"][-1]["operation"] == "low_pass"
    assert high.metadata["processing"][-1] == {
        "operation": "high_pass", "wavelength": 600.0, "method": "gaussian", "order": 4, "detrend": True,
    }


def test_band_pass_and_butterworth_keep_the_middle_band():
    raster, _, residual = two_wavelength_raster(short_wavelength=400.0)
    kept = baselode.geophysics.band_pass(raster, 1200, 150, method="butterworth", order=6)
    error = interior(kept.data[0] - residual)
    # RMS error under 10% of the 10-unit residual amplitude; the input is
    # dominated by the 100-unit regional.
    assert np.sqrt(np.mean(error ** 2)) < 1.0
    with pytest.raises(ValueError, match="less than"):
        baselode.geophysics.band_pass(raster, 100, 200)
    with pytest.raises(ValueError, match="method"):
        baselode.geophysics.low_pass(raster, 100, method="boxcar")


def test_filters_keep_missing_cells_missing():
    raster, _, _ = two_wavelength_raster(size=64)
    raster.data[0, 10:14, 20:30] = np.nan
    filtered = baselode.geophysics.low_pass(raster, 800)
    assert np.isnan(filtered.data[0, 10:14, 20:30]).all()
    assert np.isfinite(filtered.data[0, 30:, :]).all()
