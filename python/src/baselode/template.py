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

"""Baselode Plotly template.

Defines and registers a named Plotly template called ``baselode`` that
captures Baselode's default chart visual identity.

Importing this module registers the template with Plotly's template registry
so it can be referenced by name::

    import baselode.template  # registers the template
    fig.update_layout(template="baselode")

The template is automatically imported by Baselode plotting helpers, so
charts will use it by default without any manual setup.

To override the template when calling a Baselode plotting helper, pass a
``template`` keyword argument::

    fig = plot_drillhole_trace(df, value_col="grade", template="plotly_white")
"""

import plotly.graph_objects as go
import plotly.io as pio

#: Name of the Baselode Plotly template as registered with ``plotly.io.templates``.
BASELODE_TEMPLATE_NAME = "baselode"

#: Default colorway used across Baselode charts.
BASELODE_COLORWAY = [
    "#8b1e3f",
    "#2563eb",
    "#16a34a",
    "#f59e0b",
    "#7c3aed",
    "#0ea5e9",
    "#ef4444",
    "#10b981",
    "#f97316",
    "#8b5cf6",
]


def _build_baselode_template():
    """Construct and return the Baselode Plotly :class:`~plotly.graph_objects.layout.Template`."""
    layout = go.Layout(
        paper_bgcolor="white",
        plot_bgcolor="white",
        font=dict(family="Inter, system-ui, sans-serif", size=12, color="#1e293b"),
        title=dict(font=dict(size=14, color="#0f172a"), x=0.05),
        colorway=BASELODE_COLORWAY,
        xaxis=go.layout.XAxis(
            gridcolor="#e8e8e8",
            linecolor="#d0d0d0",
            zerolinecolor="#d0d0d0",
            tickfont=dict(size=10),
            title_font=dict(size=12),
        ),
        yaxis=go.layout.YAxis(
            gridcolor="#e8e8e8",
            linecolor="#d0d0d0",
            zerolinecolor="#d0d0d0",
            tickfont=dict(size=10),
            title_font=dict(size=12),
        ),
        legend=dict(
            bgcolor="rgba(255,255,255,0.9)",
            bordercolor="#e2e8f0",
            borderwidth=1,
            font=dict(size=11),
        ),
        hoverlabel=dict(
            bgcolor="white",
            bordercolor="#cbd5e1",
            font=dict(size=12, color="#1e293b"),
        ),
        modebar=dict(remove=["select2d", "lasso2d", "autoScale2d"]),
    )
    return go.layout.Template(layout=layout)


#: The Baselode Plotly template instance.
BASELODE_TEMPLATE = _build_baselode_template()

# Register the template with Plotly so it can be referenced by name.
pio.templates[BASELODE_TEMPLATE_NAME] = BASELODE_TEMPLATE
