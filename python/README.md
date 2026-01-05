# BASELODE (Python)

Baselode is an open-source Python toolkit for working with structured exploration and mining datasets.

Version 0.1.0 focuses on domain-aware data models and validation utilities for drillhole-style data. The goal is to provide a consistent foundation for analytics, visualization, and AI workflows.

---

## Installation

```bash
pip install baselode
```

**Requires:** Python 3.12+

---

## Example

```python
import baselode.drill.data

gdf = baselode.drill.data.load_collars(COLLAR_CSV)
```

---

## Included in 0.1.0

- Drillhole collar, survey, and assay models  
- Downhole interval structures  
- Basic validation utilities  
- Strip log visualisations
- Map visualisations
- 3D visualisations (requires the `baselode` javascript module from npm)

---

## Design Principles

- Explicit domain models (not generic tables)  
- Minimal dependencies  
- Visualisation tooling as key to data analysis
- Designed for integration with analytics, GIS, and AI systems  

---

## Roadmap

Future releases may include:

- Assay and lithology schemas  
- Geospatial helpers  
- Interoperability with common mining formats  
- Visualization adapters  

---

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).

See the `LICENSE` file in this repository for full details.

---

## Contributing

Contributions and issue reports are welcome via GitHub.
