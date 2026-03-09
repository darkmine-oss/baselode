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

"""Baselode Light Plotly template.

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

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------

BASELODE_LIGHT = {
    "bg":        "#ffffff",
    "panel":     "#f8fafc",
    "ink":       "#1e293b",
    "ink_soft":  "#64748b",
    "grid":      "#e8e8e8",
    "line":      "#d0d0d0",
    "accent":    "#f59e0b",
    "accent_2":  "#fcd34d",
    "muted_1":   "#94a3b8",
    "muted_2":   "#cbd5e1",
    "muted_3":   "#e2e8f0",
    "primary":   "#8b1e3f",
    "primary_2": "#a8324f",
}

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

# ---------------------------------------------------------------------------
# Template definition
# ---------------------------------------------------------------------------

BASELODE_TEMPLATE = go.layout.Template(
    layout=go.Layout(
        paper_bgcolor=BASELODE_LIGHT["bg"],
        plot_bgcolor=BASELODE_LIGHT["bg"],
        colorway=BASELODE_COLORWAY,
        font=dict(family="Inter, system-ui, sans-serif", size=12, color=BASELODE_LIGHT["ink"]),
        title=dict(font=dict(size=14, color=BASELODE_LIGHT["ink"]), x=0.05),
        hovermode="x unified",
        hoverlabel=dict(
            bgcolor=BASELODE_LIGHT["bg"],
            bordercolor=BASELODE_LIGHT["line"],
            font=dict(size=12, color=BASELODE_LIGHT["ink"]),
        ),
        legend=dict(
            bgcolor="rgba(255,255,255,0.9)",
            bordercolor=BASELODE_LIGHT["muted_3"],
            borderwidth=1,
            font=dict(size=11, color=BASELODE_LIGHT["ink"]),
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="left",
            x=0.0,
        ),
        xaxis=go.layout.XAxis(
            showline=True,
            linewidth=1,
            linecolor=BASELODE_LIGHT["line"],
            mirror=False,
            ticks="outside",
            tickwidth=1,
            tickcolor=BASELODE_LIGHT["line"],
            ticklen=4,
            showgrid=True,
            gridcolor=BASELODE_LIGHT["grid"],
            gridwidth=1,
            zeroline=False,
            title_font=dict(color=BASELODE_LIGHT["ink"], size=12),
            tickfont=dict(color=BASELODE_LIGHT["ink_soft"], size=10),
        ),
        yaxis=go.layout.YAxis(
            showline=True,
            linewidth=1,
            linecolor=BASELODE_LIGHT["line"],
            mirror=False,
            ticks="outside",
            tickwidth=1,
            tickcolor=BASELODE_LIGHT["line"],
            ticklen=4,
            showgrid=True,
            gridcolor=BASELODE_LIGHT["grid"],
            gridwidth=1,
            zeroline=False,
            title_font=dict(color=BASELODE_LIGHT["ink"], size=12),
            tickfont=dict(color=BASELODE_LIGHT["ink_soft"], size=10),
        ),
        modebar=dict(remove=["select2d", "lasso2d", "autoScale2d"]),
        bargap=0.18,
        bargroupgap=0.08,
    )
)

# Trace defaults
BASELODE_TEMPLATE.data.scatter = [
    go.Scatter(
        mode="lines+markers",
        line=dict(width=2, color=BASELODE_LIGHT["primary"]),
        marker=dict(
            size=7,
            color=BASELODE_LIGHT["primary_2"],
            line=dict(width=1.5, color=BASELODE_LIGHT["bg"]),
        ),
    )
]

BASELODE_TEMPLATE.data.bar = [
    go.Bar(
        marker=dict(
            color=BASELODE_LIGHT["primary"],
            line=dict(color=BASELODE_LIGHT["bg"], width=0),
        )
    )
]

BASELODE_TEMPLATE.data.histogram = [
    go.Histogram(
        marker=dict(
            color=BASELODE_LIGHT["primary"],
            line=dict(color=BASELODE_LIGHT["bg"], width=0),
        )
    )
]

BASELODE_TEMPLATE.data.box = [
    go.Box(
        fillcolor=BASELODE_LIGHT["accent"],
        line=dict(color=BASELODE_LIGHT["ink"], width=1.5),
        marker=dict(color=BASELODE_LIGHT["ink"]),
    )
]

BASELODE_TEMPLATE.data.violin = [
    go.Violin(
        fillcolor=BASELODE_LIGHT["accent"],
        line=dict(color=BASELODE_LIGHT["ink"], width=1.5),
        marker=dict(color=BASELODE_LIGHT["ink"]),
    )
]

BASELODE_TEMPLATE.data.heatmap = [
    go.Heatmap(
        colorscale=[
            [0.00, "#ffffff"],
            [0.20, "#f1f5f9"],
            [0.40, "#cbd5e1"],
            [0.60, "#94a3b8"],
            [0.80, "#475569"],
            [1.00, "#1e293b"],
        ],
        colorbar=dict(
            outlinecolor=BASELODE_LIGHT["line"],
            tickcolor=BASELODE_LIGHT["line"],
            tickfont=dict(color=BASELODE_LIGHT["ink_soft"]),
        ),
    )
]

BASELODE_TEMPLATE.data.contour = [
    go.Contour(
        colorscale=[
            [0.00, "#ffffff"],
            [0.25, "#fef3c7"],
            [0.50, "#f59e0b"],
            [0.75, "#92400e"],
            [1.00, "#1e293b"],
        ],
        colorbar=dict(
            outlinecolor=BASELODE_LIGHT["line"],
            tickcolor=BASELODE_LIGHT["line"],
            tickfont=dict(color=BASELODE_LIGHT["ink_soft"]),
        ),
    )
]

# ---------------------------------------------------------------------------
# Register globally
# ---------------------------------------------------------------------------

pio.templates[BASELODE_TEMPLATE_NAME] = BASELODE_TEMPLATE
