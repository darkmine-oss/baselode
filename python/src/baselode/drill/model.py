# SPDX-License-Identifier: GPL-3.0-or-later

# Copyright (C) 2026 Darkmine Pty Ltd

# This file is part of baselode.

# baselode is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

# baselode is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.

# You should have received a copy of the GNU General Public License
# along with baselode.  If not, see <https://www.gnu.org/licenses/>.

"""Lightweight container objects for drillhole projects.

These keep pandas DataFrames together with project-level settings for easy
filtering, slicing, and downstream visualization.
"""

import pandas as pd

from . import data


class ProjectConfig:
    def __init__(self, project_id=None, crs=None, lithology_legend=None, color_tables=None, metadata=None):
        self.project_id = project_id
        self.crs = crs
        self.lithology_legend = lithology_legend or {}
        self.color_tables = color_tables or {}
        self.metadata = metadata or {}

    def update(self, **kwargs):
        for key, val in kwargs.items():
            setattr(self, key, val)
        return self

    def to_dict(self):
        return {
            "project_id": self.project_id,
            "crs": self.crs,
            "lithology_legend": self.lithology_legend,
            "color_tables": self.color_tables,
            "metadata": self.metadata,
        }


class DrillholeDataset:
    def __init__(self, project=None, collars=None, surveys=None, assays=None, geology=None, structures=None, traces=None, metadata=None):
        self.project = project or ProjectConfig()
        self.collars = data._frame(collars)
        self.surveys = data._frame(surveys)
        self.assays = data._frame(assays)
        self.geology = data._frame(geology)
        self.structures = data._frame(structures)
        self.traces = data._frame(traces)
        self.metadata = metadata or {}

    def copy(self):
        return DrillholeDataset(
            project=ProjectConfig(**self.project.to_dict()),
            collars=self.collars.copy(),
            surveys=self.surveys.copy(),
            assays=self.assays.copy(),
            geology=self.geology.copy(),
            structures=self.structures.copy(),
            traces=self.traces.copy(),
            metadata=dict(self.metadata),
        )

    def select_holes(self, hole_ids):
        hole_ids = set(hole_ids)
        return DrillholeDataset(
            project=self.project,
            collars=self.collars[self.collars["hole_id"].isin(hole_ids)],
            surveys=self.surveys[self.surveys["hole_id"].isin(hole_ids)],
            assays=self.assays[self.assays["hole_id"].isin(hole_ids)],
            geology=self.geology[self.geology["hole_id"].isin(hole_ids)],
            structures=self.structures[self.structures["hole_id"].isin(hole_ids)],
            traces=self.traces[self.traces["hole_id"].isin(hole_ids)],
            metadata=self.metadata,
        )

    def filter_project(self, project_id=None):
        if project_id is None:
            return self
        filtered = DrillholeDataset(
            project=self.project,
            collars=data.filter_by_project(self.collars, project_id),
            surveys=data.filter_by_project(self.surveys, project_id),
            assays=data.filter_by_project(self.assays, project_id),
            geology=data.filter_by_project(self.geology, project_id),
            structures=data.filter_by_project(self.structures, project_id),
            traces=data.filter_by_project(self.traces, project_id),
            metadata=self.metadata,
        )
        filtered.project.project_id = project_id
        return filtered

    def hole_trace(self, hole_id):
        if self.traces.empty:
            return pd.DataFrame()
        return self.traces[self.traces["hole_id"] == hole_id].copy()

    def hole_assays(self, hole_id):
        if self.assays.empty:
            return pd.DataFrame()
        return self.assays[self.assays["hole_id"] == hole_id].copy()

    def holes(self):
        if self.collars.empty:
            return []
        return list(self.collars["hole_id"].unique())

    def to_dict(self):
        return {
            "project": self.project.to_dict(),
            "collars": self.collars,
            "surveys": self.surveys,
            "assays": self.assays,
            "geology": self.geology,
            "structures": self.structures,
            "traces": self.traces,
            "metadata": self.metadata,
        }
