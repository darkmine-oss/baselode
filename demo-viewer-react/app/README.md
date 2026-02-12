# Baselode Viewer

A React-based web application for visualizing geological data.

## Features

- 🗺️ Interactive Leaflet map on landing page
- 🔍 Drillhole visualization (placeholder)
- 📦 Block Model visualization (placeholder)
- Translucent sidebar navigation

## Getting Started

### Install Dependencies

```bash
npm install
```

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
        ├── BlockModel.jsx
        └── Placeholder.css
```

## Technologies

- React 18
- Vite
- React Router
- Leaflet / React-Leaflet
