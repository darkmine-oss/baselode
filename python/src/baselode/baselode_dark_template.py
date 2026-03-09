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

"""Baselode Dark Plotly template.

Defines and registers a named Plotly template called ``baselode-dark`` that
applies the Baselode Dark visual identity: dark warm backgrounds, Inter-based
sans-serif typography, subtle warm grid lines, and light ink primary colours
accented with the signature highlight yellow.

Importing this module registers the template with Plotly's template
registry so it can be referenced by name::

    import baselode.baselode_dark_template  # registers the template
    fig.update_layout(template="baselode-dark")

The template object is also exported as :data:`BASELODE_DARK_TEMPLATE` for
direct use without string-based lookup.
"""

import plotly.graph_objects as go
import plotly.io as pio

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------

BASELODE_DARK = {
    "bg":        "#1b1b1f",   # dark page / paper (matches docs dark mode)
    "panel":     "#25252a",   # slightly lighter panel
    "ink":       "#f0f0e4",   # primary light text
    "ink_soft":  "#c8c8b8",   # softened light for secondary text
    "grid":      "#2a2a26",   # subtle dark grid
    "line":      "#3a3a34",   # borders / axis lines
    "accent":    "#ffffbb",   # highlight yellow
    "accent_2":  "#f3ef9b",   # slightly deeper highlight
    "muted_1":   "#8a8a80",   # muted neutral
    "muted_2":   "#5e5e56",   # softer neutral
    "muted_3":   "#3a3a34",   # dark support
}

# ---------------------------------------------------------------------------
# Template definition
# ---------------------------------------------------------------------------

BASELODE_DARK_TEMPLATE = go.layout.Template(
    layout=go.Layout(
        font=dict(
            family="Inter, Arial, sans-serif",
            color=BASELODE_DARK["ink"],
            size=14,
        ),
        title=dict(
            x=0.02,
            xanchor="left",
            font=dict(
                family="Inter, Arial, sans-serif",
                size=22,
                color=BASELODE_DARK["ink"],
            ),
        ),
        paper_bgcolor=BASELODE_DARK["bg"],
        plot_bgcolor=BASELODE_DARK["bg"],
        colorway=[
            BASELODE_DARK["ink"],
            BASELODE_DARK["accent"],
            BASELODE_DARK["muted_1"],
            BASELODE_DARK["accent_2"],
            BASELODE_DARK["muted_2"],
            BASELODE_DARK["muted_3"],
        ],
        margin=dict(l=70, r=30, t=70, b=60),
        hovermode="x unified",
        hoverlabel=dict(
            bgcolor=BASELODE_DARK["panel"],
            bordercolor=BASELODE_DARK["accent"],
            font=dict(
                family="Inter, Arial, sans-serif",
                color=BASELODE_DARK["ink"],
                size=13,
            ),
        ),
        legend=dict(
            bgcolor="rgba(37,37,42,0.88)",
            bordercolor=BASELODE_DARK["line"],
            borderwidth=1,
            font=dict(
                family="Inter, Arial, sans-serif",
                color=BASELODE_DARK["ink"],
                size=12,
            ),
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="left",
            x=0.0,
        ),
        xaxis=dict(
            showline=False,
            ticks="outside",
            tickwidth=1,
            tickcolor=BASELODE_DARK["muted_1"],
            ticklen=6,
            showgrid=True,
            gridcolor=BASELODE_DARK["grid"],
            gridwidth=1,
            zeroline=False,
            title_font=dict(color=BASELODE_DARK["ink"]),
            tickfont=dict(color=BASELODE_DARK["ink_soft"]),
        ),
        yaxis=dict(
            showline=False,
            ticks="outside",
            tickwidth=1,
            tickcolor=BASELODE_DARK["muted_1"],
            ticklen=6,
            showgrid=True,
            gridcolor=BASELODE_DARK["grid"],
            gridwidth=1,
            zeroline=False,
            title_font=dict(color=BASELODE_DARK["ink"]),
            tickfont=dict(color=BASELODE_DARK["ink_soft"]),
        ),
        polar=dict(
            bgcolor=BASELODE_DARK["bg"],
            radialaxis=dict(
                gridcolor=BASELODE_DARK["grid"],
                linecolor=BASELODE_DARK["ink"],
                tickfont=dict(color=BASELODE_DARK["ink_soft"]),
            ),
            angularaxis=dict(
                gridcolor=BASELODE_DARK["grid"],
                linecolor=BASELODE_DARK["ink"],
                tickfont=dict(color=BASELODE_DARK["ink_soft"]),
            ),
        ),
        ternary=dict(
            bgcolor=BASELODE_DARK["bg"],
            aaxis=dict(gridcolor=BASELODE_DARK["grid"], linecolor=BASELODE_DARK["ink"]),
            baxis=dict(gridcolor=BASELODE_DARK["grid"], linecolor=BASELODE_DARK["ink"]),
            caxis=dict(gridcolor=BASELODE_DARK["grid"], linecolor=BASELODE_DARK["ink"]),
        ),
        scene=dict(
            bgcolor=BASELODE_DARK["bg"],
            xaxis=dict(
                backgroundcolor=BASELODE_DARK["bg"],
                gridcolor=BASELODE_DARK["grid"],
                showbackground=True,
                zerolinecolor=BASELODE_DARK["line"],
            ),
            yaxis=dict(
                backgroundcolor=BASELODE_DARK["bg"],
                gridcolor=BASELODE_DARK["grid"],
                showbackground=True,
                zerolinecolor=BASELODE_DARK["line"],
            ),
            zaxis=dict(
                backgroundcolor=BASELODE_DARK["bg"],
                gridcolor=BASELODE_DARK["grid"],
                showbackground=True,
                zerolinecolor=BASELODE_DARK["line"],
            ),
        ),
        bargap=0.18,
        bargroupgap=0.08,
    )
)

# Trace defaults
BASELODE_DARK_TEMPLATE.data.scatter = [
    go.Scatter(
        mode="lines+markers",
        line=dict(width=2.5, color=BASELODE_DARK["ink"]),
        marker=dict(
            size=7,
            color=BASELODE_DARK["ink"],
            line=dict(width=1.5, color=BASELODE_DARK["bg"]),
        ),
    )
]

BASELODE_DARK_TEMPLATE.data.bar = [
    go.Bar(
        marker=dict(
            color=BASELODE_DARK["ink"],
            line=dict(color=BASELODE_DARK["bg"], width=0),
        )
    )
]

BASELODE_DARK_TEMPLATE.data.histogram = [
    go.Histogram(
        marker=dict(
            color=BASELODE_DARK["ink"],
            line=dict(color=BASELODE_DARK["bg"], width=0),
        )
    )
]

BASELODE_DARK_TEMPLATE.data.box = [
    go.Box(
        fillcolor=BASELODE_DARK["accent"],
        line=dict(color=BASELODE_DARK["ink"], width=1.5),
        marker=dict(color=BASELODE_DARK["ink"]),
    )
]

BASELODE_DARK_TEMPLATE.data.violin = [
    go.Violin(
        fillcolor=BASELODE_DARK["accent"],
        line=dict(color=BASELODE_DARK["ink"], width=1.5),
        marker=dict(color=BASELODE_DARK["ink"]),
    )
]

BASELODE_DARK_TEMPLATE.data.heatmap = [
    go.Heatmap(
        colorscale=[
            [0.00, "#1b1b1f"],
            [0.20, "#2e2e28"],
            [0.40, "#5e5e50"],
            [0.60, "#c8c89a"],
            [0.80, "#f3ef9b"],
            [1.00, "#ffffbb"],
        ],
        colorbar=dict(
            outlinecolor=BASELODE_DARK["ink"],
            tickcolor=BASELODE_DARK["ink"],
            tickfont=dict(color=BASELODE_DARK["ink_soft"]),
        ),
    )
]

BASELODE_DARK_TEMPLATE.data.contour = [
    go.Contour(
        colorscale=[
            [0.00, "#1b1b1f"],
            [0.25, "#2e2e28"],
            [0.50, "#6b6b50"],
            [0.75, "#f3ef9b"],
            [1.00, "#ffffbb"],
        ],
        colorbar=dict(
            outlinecolor=BASELODE_DARK["ink"],
            tickcolor=BASELODE_DARK["ink"],
            tickfont=dict(color=BASELODE_DARK["ink_soft"]),
        ),
    )
]

# ---------------------------------------------------------------------------
# Register globally
# ---------------------------------------------------------------------------

BASELODE_DARK_TEMPLATE_NAME = "baselode-dark"
pio.templates[BASELODE_DARK_TEMPLATE_NAME] = BASELODE_DARK_TEMPLATE
