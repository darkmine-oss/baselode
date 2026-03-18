# Baselode Docs

The Baselode documentation site, built with [VitePress](https://vitepress.dev).

The live site is at **[docs.baselode.net](https://docs.baselode.net)**.

## Building and previewing locally

```bash
# from repo root
cd docs
npm install

# start the dev server with hot reload
npm run dev
```

The docs site is available at **`http://localhost:5173`**.

To build and preview the production output:

```bash
npm run build
npm run preview
```

## Analytics

This site includes [Vercel Analytics](https://vercel.com/analytics). Analytics are **disabled when running locally** — the library is a no-op outside of Vercel deployments and makes no network requests during local development.
