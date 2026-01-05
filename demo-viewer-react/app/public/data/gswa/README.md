# Attribution — GSWA Geochem sample CSVs

This repository includes small sample CSV files derived from the **GSWA Geochemistry (DMIRS‑047)** dataset. 

These data files are used for the demo viewer for baselode.

## Source

- Dataset portal (DASC): https://dasc.dmirs.wa.gov.au/home?productAlias=GSWAGeochem  
- Data WA catalogue record: https://catalogue.data.wa.gov.au/dataset/gswa-geochemistry  
- Date accessed: 2026-02-11

## Licence

- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**
- Licence text (legal code): https://creativecommons.org/licenses/by/4.0/legalcode

## Required credit lines (verbatim from the data publisher)

© State of Western Australia (Department of Mines, Petroleum and Exploration) 2025

Attribution: Based on Department of Mines, Petroleum and Exploration material.

## Changes made

The sample CSV files in this repository are subsets and format-converted extracts from the upstream dataset (selection/filtering and conversion to CSV). There may be occasional additional cleaning/normalisation.

All demo data is taken from the csvs in `baselode.git/test/data/gswa` with the following modificiations

* `demo_gswa_sample_collars.csv` is reduced to the minimum columns required for the datamodel/demo
* `demo_gswa_sample_survey.csv` is reduced to the minimum columns required for the datamodel/demo, and filtered to drillholes with CompanyHoleId starting with 'FF'
* `demo_gswa_sample_assays.csv` is reduced to the minimum columns required for the datamodel/demo, and columns containing only NaN are removed

* `demo_gswa_precomputed_desurveyed.csv` is desurveyed hole trajectories for the holes in the survey file, using minimum curvature, for 3D visualisation demo

## No endorsement

Use of these samples does not imply endorsement by the State of Western Australia or the Department of Mines, Petroleum and Exploration.

## Licence scope note

These sample CSV files are licensed under **CC BY 4.0**. Do not apply GPL‑3.0 terms to them.
