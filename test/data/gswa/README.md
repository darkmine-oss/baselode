# Attribution — GSWA Geochem sample CSVs

This repository includes small sample CSV files derived from the **GSWA Geochemistry (DMIRS‑047)** dataset. 

These data files are used for unit testing, example code, and the demo viewers within baselode.

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

All sample data was extracted using the below lat/lon bounding box to filter for collars (a random area near Hyden, Western Australia):

    [-32.329994174232176, 118.77253985070098]
    [-32.75139434476367, 119.74208332736906]

The CompanyHoleId is used as primary key (assumed globally unique within this subset).

* `gswa_sample_collars.csv` filters on collar location after joining tables `dbo.Collar` and `dbo.CollarElevation`
* `gswa_sample_survey.csv` using the collars above, uses `dbo.DHSurvey` and takes only the latest survey results when there are duplicates
* `gswa_sample_assays.csv` using the collars above, uses `gsd.dhAssayFlat` 

## No endorsement

Use of these samples does not imply endorsement by the State of Western Australia or the Department of Mines, Petroleum and Exploration.

## Licence scope note

These sample CSV files are licensed under **CC BY 4.0**. Do not apply GPL‑3.0 terms to them.
