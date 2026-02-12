# Baselode

Baselode is a (work in progress) open-source toolkit designed for the mineral exploration and mining industries. It provides a suite of tools for processing, managing, and visualizing geological and mining data, initially focused on drillhole and spatial datasets.

## Goals

The primary goal of Baselode is to provide high-quality, open-source, tooling across multiple programming environments that be incorporated into notebooks, dashboards, apps, and AI workflows. 

- **Multi-language Support**: Tooling (currently) available in **Python** and **JavaScript/React** .
- **Industry Standards**: Implementation, or inclusion/wrapping of other open-source, standard algorithms like Minimum Curvature for drillhole desurveying.
- **Accessibility**: Lowering the barrier to entry for using geological and mining data.

## Project Structure

- **[`baselode` (Python)](./src/baselode)**: A Python package for drillhole data processing, desurveying, and validation.

- **[`demo-viewer-react/` (JavaScript/React)](./demo-viewer-react)**: A web-based application demonstrating use of the React **baselode** components for 1D, 2D, and 3D visualisation.
- **[`notebooks/`](./notebooks)**: Example Jupyter notebooks demonstrating use of the python module **baselode**.



## Licensing

This repository contains **software code** and **third-party data**, which are licensed under **different terms**.

1. **Software code** is licensed under the **GNU General Public License v3.0 or later (GPL-3.0-or-later)**.  
  See [`LICENSE`](./LICENSE).  Copyright (C) 2026 Darkmine Pty Ltd (software code only).

2. **Sample data files** derived from the **GSWA Geochemistry dataset** are licensed under the  
  **Creative Commons Attribution 4.0 International Licence (CC BY 4.0)**.  
  See [`DATA_LICENSE.md`](./DATA_LICENSE.md) and [`ATTRIBUTION.md`](./ATTRIBUTION.md).

## Data source and attribution

This repository includes sample CSV files derived from the **GSWA Geochemistry** dataset published by the  
Geological Survey of Western Australia (GSWA), Government of Western Australia.

- Source portal: https://dasc.dmirs.wa.gov.au/home?productAlias=GSWAGeochem  
- Licence: https://creativecommons.org/licenses/by/4.0/

Required attribution wording and modification notes are provided in [`ATTRIBUTION.md`](./ATTRIBUTION.md).

The State of Western Australia and GSWA **do not endorse** this project or its use of the data.

