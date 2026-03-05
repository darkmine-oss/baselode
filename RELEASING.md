# Releasing Baselode

Both the Python (`baselode` on PyPI) and JavaScript (`baselode` on npm) packages
are versioned from a single git tag in this repository.

## Automated releases (CI)

Merging to `main` triggers the `.github/workflows/release.yml` workflow, which:

1. Reads the latest `vX.Y.Z` tag and creates the next patch tag automatically
   (e.g. `v0.1.5` → `v0.1.6`).
2. Runs the Python test suite (`pytest test -q`).
3. Runs the JavaScript test suite (`npm test`).
4. Builds the Python package and publishes it to PyPI using trusted publishing
   (OIDC — no long-lived token required).
5. Builds the JavaScript package and publishes it to npm using the `NPM_TOKEN`
   repository secret.

Both publish jobs run against a GitHub Actions environment named **`release`**.
Configure that environment in *Settings → Environments → release* to add any
required reviewers or deployment protection rules.

Required secrets / configurations:

| Secret / setting | Where | Purpose |
|---|---|---|
| `NPM_TOKEN` | Repository secret | Authenticate `npm publish` |
| PyPI trusted publisher | PyPI project settings | OIDC publish from Actions |

---

## Manual releases

The steps below describe how to publish a release manually from your local
machine when bypassing CI is necessary.

## Version scheme

Tags follow semver with a `v` prefix: `v0.2.0`, `v0.2.1`, etc.

- The Python package reads the version from the tag via `setuptools-scm`.
- The JS `prepack` hook reads the tag via `version:from-tag` and stamps
  `package.json` / `package-lock.json` before building.

## Pre-release checklist

- [ ] All feature branches merged to `main` and CI green.
- [ ] `git status` is clean (no uncommitted changes).
- [ ] You are on `main` and have pulled the latest: `git pull origin main`.
- [ ] Python tests pass: `python -m pytest test -q` (from repo root).
- [ ] JS tests pass: `cd javascript/packages/baselode && npm test`.

## Step 1 — Tag the commit

Decide the next version (e.g. `0.2.0`) and create an annotated tag:

```bash
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

> **Do not push the tag until you are ready to publish.** Both build tools
> derive the version from the tag at build time, so the tag must exist on HEAD
> before you run any build or publish command.

## Step 2 — Publish the Python package to PyPI

`setuptools-scm` reads the nearest git tag automatically; no manual version
editing is needed.

```bash
cd python

# Clean any previous build artefacts
rm -rf dist/ build/

# Build source distribution + wheel
python -m build

# Dry-run first (optional but recommended)
python -m twine check dist/*

# Upload to PyPI (requires credentials — see "Credentials" below)
python -m twine upload dist/*
```

After upload, verify: https://pypi.org/project/baselode/

## Step 3 — Publish the JavaScript package to npm

The `prepack` lifecycle hook (`npm run version:from-tag && npm run build`) runs
automatically before `npm publish`, so you do not need to manually set the
version or run a build beforehand.

```bash
cd javascript/packages/baselode

# Dry-run to inspect what will be published
npm pack --dry-run

# Publish to npm (requires authentication — see "Credentials" below)
npm publish
```

After upload, verify: https://www.npmjs.com/package/baselode

## Step 4 — Rebuild the standalone bundle (demo-viewer-dash)

The Dash demo app uses a standalone bundle (`baselode-module.js`) that has
`three.js` bundled in. This file is checked into `demo-viewer-dash/assets/` and
must be regenerated whenever `baselode3dScene.js` or the Three.js/gizmo layer
changes.

```bash
cd javascript/packages/baselode
npm run build:module
```

This builds `dist/baselode-module.js` and copies it to
`demo-viewer-dash/assets/baselode-module.js`. Commit the updated file.

## Verifying the release

```bash
# Python
pip install --upgrade baselode
python -c "import baselode; print(baselode.__version__)"

# JavaScript (in any project)
npm install baselode@latest
node -e "import('baselode').then(m => console.log(Object.keys(m)))"
```

