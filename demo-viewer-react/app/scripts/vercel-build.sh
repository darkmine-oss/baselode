#!/bin/sh
set -e

# Copy demo data into public (not committed to avoid large files in git)
mkdir -p public/data/gswa
cp ../../test/data/gswa/gswa_sample_collars.csv \
   ../../test/data/gswa/gswa_sample_assays.csv \
   ../../test/data/gswa/gswa_sample_geology.csv \
   ../../test/data/gswa/gswa_sample_survey.csv \
   ../../test/data/gswa/gswa_sample_structure.csv \
   ../../test/data/gswa/demo_gswa_precomputed_desurveyed.csv \
   public/data/gswa/

mkdir -p public/data/blockmodel
cp ../../test/data/blockmodel/demo_blockmodel.csv \
   public/data/blockmodel/

mkdir -p public/data/grade_blocks
cp ../../test/data/grade_blocks/demo_grade_blocks.json \
   public/data/grade_blocks/

# Build baselode library (local file: dep must be built before the app)
(cd ../../javascript/packages/baselode && npm ci && npm run build)

# Build demo app
npm run build
