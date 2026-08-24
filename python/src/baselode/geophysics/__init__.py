"""Geophysics raster models and optional file readers.

The module intentionally keeps a small, NumPy-first public contract.  It can
therefore move data between acquisition formats, visualisation clients, and
future modelling packages without making any particular algorithm package a
core Baselode dependency.
"""

from baselode.geophysics.raster import GeophysicsRaster, load_raster

__all__ = ["GeophysicsRaster", "load_raster"]
