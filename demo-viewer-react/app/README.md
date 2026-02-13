# Baselode Viewer

A React-based web application for demonstrating the visualisation capabilities of the `baselode` javascript module.

## Features of baselode

* Drill hole data loading
* Desurvey
* Map-based collar view and inspection
* Interactive strip logs for numeric variables (line, bar, marker, etc), categorical variables (stacked bar), and structural variables (tadpole) 
* 3D drillhole viewer with numeric and categorical coloring

## Getting Started

### Install Dependencies

```bash
npm install
```

### Use Local `baselode` Package

The app is configured to use the local package at `../../javascript/packages/baselode` via a `file:` dependency.

Build the package before running the app:

```bash
cd ../../javascript/packages/baselode
npm install
npm run build
```

Then run the viewer:

```bash
cd ../../demo-viewer-react/app
npm install
npm run dev
```

For active local development (watch `baselode` + run app together):

```bash
cd ../../demo-viewer-react/app
npm install
npm run dev:local
```

This runs:
- `baselode` library build in watch mode
- Vite dev server for the demo app

### Run Development Server

```bash
npm run dev
```

The app will open at http://localhost:3000

### Build for Production

```bash
npm run build
```

## Project Structure

```
frontend/app/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── App.css
    ├── index.css
    ├── components/
    │   ├── Layout.jsx
    │   ├── Sidebar.jsx
    │   └── Sidebar.css
    └── pages/
        ├── Home.jsx
        ├── Home.css
        ├── Drillhole.jsx
        └── Placeholder.css
```

## Technologies

- React 18
- Vite
- React Router
- Leaflet / React-Leaflet
