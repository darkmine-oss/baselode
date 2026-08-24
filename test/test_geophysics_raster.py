import json

import numpy as np
import pytest

import baselode.geophysics
import baselode.geophysics.raster


def test_single_grid_is_stored_as_one_band_and_preserves_georeferencing():
    raster = baselode.geophysics.GeophysicsRaster(
        [[1, 2], [3, 4]],
        transform=(10, 0, 500000, 0, -10, 7000000),
        crs="EPSG:28351",
        band_names=["mag_tmi"],
    )

    assert raster.data.shape == (1, 2, 2)
    assert raster.width == 2
    assert raster.height == 2
    assert raster.band(1).tolist() == [[1, 2], [3, 4]]
    assert raster.bounds == (500000.0, 6999980.0, 500020.0, 7000000.0)


def test_multiple_bands_and_metadata_round_trip_through_payload():
    raster = baselode.geophysics.GeophysicsRaster(
        np.array([[[1.0, np.nan]], [[2.0, 3.0]]]),
        transform=(1, 0, 0, 0, -1, 1),
        nodata=-9999,
        band_names=["magnetic", "gravity"],
        metadata={"survey": "example"},
    )

    payload = raster.to_payload()
    assert payload["data"][0][0][1] is None
    assert json.loads(json.dumps(payload))["bandNames"] == ["magnetic", "gravity"]
    rebuilt = baselode.geophysics.GeophysicsRaster.from_payload(payload)
    assert rebuilt.band_names == ("magnetic", "gravity")
    assert np.isnan(rebuilt.data[0, 0, 1])


def test_model_rejects_invalid_dimensions_and_band_access():
    with pytest.raises(ValueError, match="shape"):
        baselode.geophysics.GeophysicsRaster([1, 2, 3])
    with pytest.raises(ValueError, match="one name"):
        baselode.geophysics.GeophysicsRaster([[1]], band_names=["a", "b"])

    raster = baselode.geophysics.GeophysicsRaster([[1]])
    with pytest.raises(IndexError, match="between"):
        raster.band(2)


def test_missing_optional_rasterio_has_clear_installation_message(monkeypatch):
    monkeypatch.setattr(baselode.geophysics.raster, "_rasterio", None)
    with pytest.raises(ImportError, match=r"baselode\[raster\]"):
        baselode.geophysics.raster.load_raster("magnetics.ers")
