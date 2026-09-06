# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later

"""Regenerate the committed sub-blocked block model fixture.

Writes, under ``test/data/blockmodel/``:

- ``demo_subblocked.csv`` — 5x4x3 parents of 10 m on a 5 m base grid,
  rotated 30 degrees in plan, with a deterministic mix of whole parents,
  half-height splits and full 2x2x2 sub-blocking;
- ``demo_subblocked_meta.json`` — the definition (``BlockModel.to_dict``);
- ``blockmodel_reference.json`` — values computed by the Python
  implementation that the JS test-suite asserts against (parity).

Run from the repo root::

    PYTHONPATH=python/src python scripts/dev/generate_blockmodel_fixture.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

import baselode.blockmodel.data as data
import baselode.blockmodel.definition as definition_module

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "test" / "data" / "blockmodel"


def build_definition():
    return definition_module.BlockModelDefinition(
        origin=(500000.0, 6900000.0, 290.0),
        block_size=(5.0, 5.0, 5.0),
        n_blocks=(10, 8, 6),
        parent_size=(2, 2, 2),
        rotation={"azimuth": 30.0, "dip": 0.0, "plunge": 0.0},
        crs="EPSG:32750",
        name="demo_subblocked",
        description="Synthetic sub-blocked model: 5x4x3 parents of 10 m on a 5 m base grid, 30 deg azimuth.",
        extra={"source": "synthetic", "generator": "scripts/dev/generate_blockmodel_fixture.py"},
    )


def build_blocks(definition):
    rng = np.random.default_rng(417)
    px, py, pz = definition.parent_size
    rows = []
    for pk in range(definition.n_parent_blocks[2]):
        for pj in range(definition.n_parent_blocks[1]):
            for pi in range(definition.n_parent_blocks[0]):
                mode = (pi + pj + pk) % 3
                if mode == 0:
                    pieces = [(pi * px + a, pj * py + b, pk * pz + c, 1, 1, 1)
                              for c in range(pz) for b in range(py) for a in range(px)]
                elif mode == 1:
                    pieces = [(pi * px, pj * py, pk * pz, px, py, pz)]
                else:
                    pieces = [(pi * px, pj * py, pk * pz + c, px, py, 1) for c in range(pz)]
                for (i, j, k, ni, nj, nk) in pieces:
                    # Grade trends up-hole and east, with mild noise; density by level.
                    grade = round(0.4 + 0.15 * i + 0.1 * j + 0.05 * k + rng.normal(0.0, 0.08), 3)
                    density = round(2.65 + 0.05 * (k // 2) + rng.normal(0.0, 0.01), 3)
                    rock_type = ("oxide", "transition", "fresh")[min(2, k // 2)]
                    classification = "ore" if grade >= 1.5 else ("low_grade" if grade >= 0.8 else "waste")
                    rows.append({
                        "i": i, "j": j, "k": k, "ni": ni, "nj": nj, "nk": nk,
                        "grade": max(grade, 0.01), "density": density,
                        "rock_type": rock_type, "classification": classification,
                    })
    frame = pd.DataFrame(rows)
    return data.attach_block_centroids(frame, definition)


def reference(model):
    definition = model.definition
    parents = model.to_parent_blocks(density_col="density")
    regular = model.regularize()
    corners = definition.corners()
    sample_points = [
        [500010.0, 6900010.0, 292.5],
        [500001.0, 6900030.0, 317.0],
        [499990.0, 6900000.0, 300.0],  # outside (west of the rotated grid)
    ]
    samples = model.sample_at(sample_points, attributes=["grade", "rock_type"])
    gt = model.grade_tonnage("grade", [0.0, 1.0, 2.0], density_col="density")
    return {
        "version": "1.0",
        "generator": "scripts/dev/generate_blockmodel_fixture.py",
        "definition": definition.to_dict(),
        "block_count": int(len(model.blocks)),
        "regularized_count": int(len(regular.blocks)),
        "parent_count": int(len(parents.blocks)),
        "total_volume": model.total_volume(),
        "tonnes": model.tonnage(density_col="density"),
        "bounds": definition.bounds(),
        "corners": [[float(v) for v in corner] for corner in corners],
        "index_to_world": [
            {"index": [0, 0, 0], "size": [1, 1, 1], "world": [float(v) for v in definition.index_to_world(0, 0, 0)]},
            {"index": [9, 7, 5], "size": [1, 1, 1], "world": [float(v) for v in definition.index_to_world(9, 7, 5)]},
            {"index": [2, 4, 2], "size": [2, 2, 2], "world": [float(v) for v in definition.index_to_world(2, 4, 2, 2, 2, 2)]},
        ],
        "world_to_index": [
            {"world": point, "index": [int(v) for v in definition.world_to_index(*point)]}
            for point in sample_points
        ],
        "samples": [
            {"point": point, "block_row": int(row.block_row),
             "grade": None if row.block_row < 0 else float(row.grade),
             "rock_type": None if row.block_row < 0 else row.rock_type}
            for point, row in zip(sample_points, samples.itertuples())
        ],
        "grade_tonnage": gt.to_dict(orient="records"),
        "parents": [
            {"i": int(r.i), "j": int(r.j), "k": int(r.k), "x": float(r.x), "y": float(r.y), "z": float(r.z),
             "grade": float(r.grade), "density": float(r.density), "rock_type": r.rock_type,
             "n_subblocks": int(r.n_subblocks), "fill_fraction": float(r.fill_fraction)}
            for r in parents.blocks.itertuples()
        ],
        "validation": model.validate()["summary"],
    }


def main():
    definition = build_definition()
    blocks = build_blocks(definition)
    model = data.BlockModel(blocks, definition=definition)
    report = model.validate()
    assert report["summary"] == {"error": 0, "warning": 0, "info": 0}, report["issues"][:3]

    OUT.mkdir(parents=True, exist_ok=True)
    ordered = [*data.BLOCK_INDEX_COLS, *data.BLOCK_GEOMETRY_COLS, "grade", "density", "rock_type", "classification"]
    model.blocks[ordered].to_csv(OUT / "demo_subblocked.csv", index=False, float_format="%.6f")
    (OUT / "demo_subblocked_meta.json").write_text(json.dumps(model.to_dict(), indent=2) + "\n", encoding="utf-8")
    (OUT / "blockmodel_reference.json").write_text(json.dumps(reference(model), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(model.blocks)} blocks -> {OUT}")


if __name__ == "__main__":
    main()
