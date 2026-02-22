
# Baselode Demo Viewer – React

This is a React app that showcases the Baselode JavaScript library for geoscience drillhole data loading, manipulation, and interactive visualization (2D strip logs, maps, and 3D scenes).

The app demonstrates:
- Loading canonical GSWA drillhole data (CSV) from the test/data/gswa/ directory
- Interactive 2D and 3D drillhole visualizations using Plotly and Three.js
- Map view, strip log view, and block model view
- Configurable drillhole display and color mapping

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 9 (or yarn/pnpm)

### Install Dependencies

From the repository root:

```bash
# Install all workspace dependencies
npm install
```

### Run the App (Dev Mode)

```bash
# Start the Vite dev server
npm run dev --workspace=demo-viewer-react/app
```

The app will be available at: **http://localhost:3000**

### Build for Production

```bash
npm run build --workspace=demo-viewer-react/app
```

