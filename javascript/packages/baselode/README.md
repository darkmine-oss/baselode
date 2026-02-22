# Baselode (JavaScript)

Baselode is an open-source JavaScript toolkit providing structured data models for exploration and mining applications.

Version 0.1.0 focuses on domain-aware data models and validation utilities for drillhole-style data. The goal is to provide a consistent foundation for analytics, visualization, and AI workflows.

---

## Installation

```bash
npm install baselode
```

**Requires:** Node.js 20+, React 18+

---

## Example

```javascript
import { parseDrillholesCSV } from 'baselode';

// Example: file is a File object from an <input type="file" />
const file = /* your File object */;
file.text().then(csvText => {
  const { holes } = parseDrillholesCSV(csvText);
  // holes is an array of collar objects
  console.log(holes);
});
```

---

## Included in 0.1.0

- Drillhole collar, survey, and assay models  
- Downhole interval structures  
- Basic validation utilities  
- Strip log visualisations
- Map visualisations
- 3D visualisations 

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
