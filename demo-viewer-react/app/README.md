# Baselode Demo Viewer - React

A React-based web application for demonstrating the visualisation capabilities of the `baselode` javascript module.

## Features of baselode

* Drill hole data loading
* Desurvey
* Map-based collar view and inspection
* Interactive strip logs for numeric variables (line, bar, marker, etc), categorical variables (stacked bar), and structural variables (tadpole) 
* 3D drillhole viewer with numeric and categorical coloring

## Getting Started

### Quick Start (After Git Checkout)

From the repository root:

```bash
# 1. Build the baselode library
cd javascript/packages/baselode
npm install
npm run build
cd ../../..

# 2. Install and run the React demo app
cd demo-viewer-react/app
npm install
npm run dev
```

The app will open at: **http://localhost:3000**

### Alternative: Development with Live Rebuild

For active development where changes to the `baselode` library automatically rebuild:

```bash
# From the repository root
cd demo-viewer-react/app
npm install
npm run dev:local
```

This command:
- Watches the `baselode` library and rebuilds on changes
- Runs the Vite dev server with hot module replacement
- Both run concurrently in the same terminal

### Manual Setup (Step by Step)

If you prefer to see each step separately:

```bash
# 1. Build the baselode library
cd javascript/packages/baselode
npm install
npm run build
cd ../../..

# 2. Run the demo viewer
cd demo-viewer-react/app
npm install
npm run dev
```

### Build for Production

```bash
npm run build
```

