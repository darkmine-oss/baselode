# Contributing to Baselode

Thanks for your interest in improving Baselode. Bug reports, feature ideas,
documentation fixes and code are all welcome.

Please read this whole file before opening a pull request. Section 5, the
**Contributor Licence Agreement**, applies to every contribution and must be
accepted before any pull request can be merged.

---

## 1. Ways to contribute

- **Report a bug.** Open a GitHub issue with the package (Python or
  JavaScript) and version, your environment, what you expected, what
  happened, and a minimal reproduction. Please do not attach confidential or
  unreleased exploration data: reduce the problem to synthetic data or the
  bundled GSWA sample in `test/data/gswa`.
- **Suggest a feature.** Open an issue describing the problem you are trying
  to solve before starting work, so we can agree on the approach and on how
  it fits both the Python and JavaScript packages.
- **Submit a change.** Fork the repository, make your change on a branch and
  open a pull request against `main`.

Security issues should not be reported in public issues. Use GitHub's
**Report a vulnerability** option on the repository's Security tab instead.

## 2. Repository layout

| Path | What it is |
|------|------------|
| `python/src/baselode/` | Python package (PyPI: `baselode`) |
| `javascript/packages/baselode/` | JavaScript package (npm: `baselode`) |
| `test/` | Python test suite and shared test data, including the parity contract |
| `demo-viewer-react/`, `demo-viewer-dash/` | Demo applications |
| `notebooks/` | Example Jupyter notebooks |
| `docs/` | Documentation site |

## 3. Development setup and checks

The Conda environment is described in `environment.yml`.

**Python**

```sh
python -m pytest test -q
```

**JavaScript**

```sh
cd javascript/packages/baselode
npm ci
npm run verify    # tests, build, type checks and package checks
```

Both suites run in CI on every pull request and must pass before merging.

## 4. Making a change

### Keep Python and JavaScript in step

Baselode ships the same capabilities in both languages. Read
[`PARITY_SPEC.md`](PARITY_SPEC.md) before changing anything in its scope
(loading and column normalisation, desurveying, plotting helpers, 3D
payloads, extents and CRS handling, block models).

- A change to one implementation should usually come with the matching
  change to the other. If it intentionally does not, record the gap in
  `PARITY_SPEC.md`.
- Update `test/data/parity_contract.json` and `test/test_parity_contract.py`
  when you change a shared API.

### Python conventions

Follow [`AGENTS.md`](AGENTS.md). In short:

- No `typing` imports or type annotations, except in FastAPI route handlers
  and Pydantic models. Document parameters and return values in numpydoc
  docstrings instead.
- Use fully qualified internal imports (`import baselode.drill.data`).
- Do not wrap imports in `try/except ImportError` unless the package is one
  of the optional extras in `python/pyproject.toml`. Add new dependencies to
  `python/pyproject.toml` (and `python/requirements.txt` if CI or scripts use
  them).

### General

- **Keep pull requests focused.** One feature or fix per pull request.
- **Add tests** for new behaviour and bug fixes, in both languages where
  relevant.
- **Update the docs** under `docs/` when you change public behaviour.
- **Releases are automated.** Merging to `main` cuts a new version (see
  [`RELEASING.md`](RELEASING.md)), so do not bump version numbers yourself.
- **Data.** Only commit data you have the right to redistribute, and include
  its licence and attribution (see [`DATA_LICENSE.md`](DATA_LICENSE.md) and
  [`ATTRIBUTION.md`](ATTRIBUTION.md)).
- **Verification.** Describe in the pull request how you tested the change.

## 5. Contributor Licence Agreement

Baselode is published under the GNU General Public License v3.0 or later,
with an additional permission for Darkmine Pty Ltd described in
[`LICENSE`](LICENSE). So that Darkmine can continue to maintain the project
and use it under that additional permission, every contributor must agree to
the terms below.

**You accept these terms by opening a pull request and ticking the
agreement box in its description.** If you contribute on behalf of an
employer or another organisation, you confirm that you are authorised to
accept these terms on its behalf.

### 5.1 Definitions

- **"Darkmine"** means Darkmine Pty Ltd (ACN 694 885 455) and its successors
  and assigns.
- **"You"** means the individual or legal entity submitting a Contribution.
- **"Contribution"** means any code, documentation, data, design or other
  material that You submit to this repository, by pull request, patch, issue
  or any other means, that is intended for inclusion in the project.

### 5.2 Copyright licence to Darkmine

You grant Darkmine a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable licence to use, reproduce, modify, prepare
derivative works of, publicly display, publicly perform, sublicense and
distribute Your Contributions and such derivative works, under any licence
terms Darkmine chooses, including proprietary and commercial terms and
including in web, desktop, mobile and hosted software.

### 5.3 Licence to everyone else

Your Contribution is also licensed to all recipients of the project under
the GNU General Public License v3.0 or later, the same terms as the rest of
the project.

### 5.4 Patent licence

You grant Darkmine and all recipients of the project a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable patent licence to make,
have made, use, sell, offer for sale, import and otherwise transfer Your
Contribution, alone or combined with the project, for any patent claims You
can license that are necessarily infringed by Your Contribution.

### 5.5 Moral rights

To the extent permitted by law, You consent to Darkmine and its licensees
doing anything with Your Contribution that would otherwise infringe Your
moral rights, including under Part IX of the *Copyright Act 1968* (Cth),
such as modifying it or using it without attribution.

### 5.6 Your representations

You confirm that:

1. each Contribution is Your original work, or You otherwise have the right
   to submit it under these terms;
2. if Your employer or anyone else has rights in the Contribution, they have
   given permission for You to submit it under these terms;
3. You will identify any part of a Contribution that is not Your original
   work, along with its source and licence; and
4. You will tell Darkmine if any of these statements stop being true.

### 5.7 You keep your copyright

These terms grant licences; they do not transfer ownership. You keep the
copyright in Your Contributions and may use them for any other purpose.

### 5.8 No obligation and no warranty

Darkmine is not required to accept or use any Contribution. Contributions
are provided "as is", without warranties of any kind, except as stated in
section 5.6.

### 5.9 Governing law

These terms are governed by the laws of Western Australia, Australia.

---

## 6. Pull request checklist

Copy this into your pull request description:

```markdown
- [ ] I have read CONTRIBUTING.md and agree to the Contributor Licence
      Agreement in section 5 on behalf of myself (and my employer, if
      applicable).
- [ ] Python tests pass (`python -m pytest test -q`).
- [ ] JavaScript checks pass (`npm run verify` in `javascript/packages/baselode`).
- [ ] Python and JavaScript stay in parity, or the gap is recorded in
      `PARITY_SPEC.md`.
- [ ] I have described how I tested this change.
```

Pull requests without the agreement box ticked cannot be reviewed or
merged.

## 7. Code of conduct

Be respectful and constructive. Harassment or abusive behaviour in issues,
pull requests or discussions will not be tolerated, and maintainers may
remove such content or block participants.
