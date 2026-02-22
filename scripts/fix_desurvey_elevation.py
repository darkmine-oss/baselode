"""
One-off script: augment the precomputed desurvey file with real collar elevations.

The existing desurvey has z=0 at surface, going negative with depth (metres
displaced from collar). The collar file carries true elevation (metres ASL).

Join key: the generate script builds hole_id as
    lower(strip(HoleId)).replace(' ', '')
so we normalise the collar HoleId the same way to look up Elevation, then
add it to every trace point so z becomes metres above sea level throughout.
"""

import pandas as pd
from pathlib import Path

REPO        = Path(__file__).resolve().parent.parent
DESURVEY_IN = REPO / "demo-viewer-react/app/dist/data/gswa/demo_gswa_precomputed_desurveyed.csv"
COLLARS     = REPO / "test/data/gswa/gswa_sample_collars.csv"
OUT         = REPO / "test/data/gswa/demo_gswa_precomputed_desurveyed.csv"

d = pd.read_csv(DESURVEY_IN)
c = pd.read_csv(COLLARS)

print("Desurvey rows:", len(d), "| holes:", d["hole_id"].nunique())
print("z at collar (md==0) before fix:")
print(d[d["md"] == 0][["hole_id", "z"]].head(8).to_string())

# Normalise collar HoleId to match desurvey hole_id format
c["_ckey"] = c["HoleId"].astype(str).str.strip().str.lower().str.replace(" ", "", regex=False)
d["_dkey"]  = d["hole_id"].astype(str).str.strip().str.lower()

matched_ids = set(d["_dkey"].unique()) & set(c["_ckey"].unique())
print("Key match:", len(matched_ids), "/", d["hole_id"].nunique(), "holes")

elev_map = c.set_index("_ckey")["Elevation"].to_dict()
d["collar_elevation"] = d["_dkey"].map(elev_map)

unmatched = d[d["collar_elevation"].isna()]["hole_id"].nunique()
print("Unmatched holes (z unchanged):", unmatched)

# z_corrected = collar_elevation + z_displacement
d["z"] = d["collar_elevation"].fillna(0) + d["z"]

d = d.drop(columns=["_dkey", "collar_elevation"])
d.to_csv(OUT, index=False)
print("Wrote", len(d), "rows to:", str(OUT))

print("z at collar (md==0) after fix:")
r = pd.read_csv(OUT)
print(r[r["md"] == 0][["hole_id", "z"]].head(8).to_string())
