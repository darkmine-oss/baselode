---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Baselode"
  text: "Open-source geoscience toolkit"
  tagline: Free, multi-language tooling for the mineral exploration and mining industries — built for developers, geologists, and data scientists.
  image:
    src: /baselode_logo.png
    alt: Baselode logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/darkmine-oss/baselode

features:
  - icon: 📥
    title: Data Loading
    details: Import and normalise drillhole collars, surveys, assays, structural measurements, and geotechnical intervals from CSV, Parquet, or SQL sources. A smart column-mapping layer handles common naming variations automatically.
  - icon: 🧮
    title: Desurveying
    details: Convert depth-based survey tables into 3D space. Supports industry-standard Minimum Curvature, as well as Tangential and Balanced Tangential methods.
  - icon: 🗺️
    title: Map Visualisation
    details: Plot collar locations on an interactive map. The Python library uses Folium/Plotly; the JavaScript library uses MapLibre GL JS.
  - icon: 📊
    title: 2D Strip Logs
    details: Multi-track Plotly strip logs for numeric, categorical, structural (tadpole), and free-text comment columns. Depth increases downward, matching industry convention.
  - icon: 🧊
    title: 3D Scene
    details: Three.js-powered 3D viewer renders desurveyed hole traces and structural disc markers. Fully embeddable as a standalone HTML page or as a React component.
  - icon: 🐍🟨
    title: Python & JavaScript
    details: Feature-parity across both languages. Use Python in Jupyter notebooks, Dash apps, or analytics pipelines. Use JavaScript/React in web dashboards or Node.js workflows.
---

## Why Baselode?

The exploration and mining industry relies on a small set of core data structures — drillhole collars, surveys, and assays — yet each project reinvents the wheel for loading, cleaning, and visualising them.

**Baselode** provides a consistent, open data model and a growing library of algorithms and visualisations so you can focus on geology and analysis, not data plumbing.

```python
import baselode.drill.data as drill

collars  = drill.load_collars("collars.csv")
surveys  = drill.load_surveys("surveys.csv")
assays   = drill.load_assays("assays.csv")
dataset  = drill.assemble_dataset(collars=collars, surveys=surveys, assays=assays)
```

::: tip Quick install
```bash
pip install baselode      # Python
npm install baselode      # JavaScript
```
:::
