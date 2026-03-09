# Baselode React Demo Viewer

React demo application for the [`baselode`](../../javascript/packages/baselode) JavaScript library.

The hosted version is at **[demo.baselode.net](https://demo.baselode.net)**.

## Running locally

The app depends on the local `baselode` library package (linked via `file:../../javascript/packages/baselode`). Use the combined dev script to watch both simultaneously:

```bash
# from repo root
npm install

# start library watch + app dev server together (recommended)
npm run dev:local --workspace=demo-viewer-react/app
# or from this directory:
cd demo-viewer-react/app
npm run dev:local
```

The Vite dev server starts at **http://localhost:5173** (or next available port). The `dev:local` script runs the library in watch mode (`vite build --watch`) and the app dev server concurrently, so changes to the library are reflected immediately.

## Analytics

This app includes [Vercel Analytics](https://vercel.com/analytics). Analytics are **disabled when running locally** — the library is a no-op outside of Vercel deployments and makes no network requests during local development.
