# Copyright (C) 2026 Darkmine Pty Ltd
# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded straight-segment crossover geometry; public orchestration is in corrections."""
import copy
import json
import math
import pathlib

_DESCRIPTOR = json.loads((pathlib.Path(__file__).parent / "geophysics_crossovers.json").read_text())
_LIMITS = _DESCRIPTOR["resources"]


class _ResourceError(ValueError):
    pass


def describe_crossovers():
    """Return independent crossover/constant-levelling contracts and limits.

    Returns
    -------
    dict
        Parameter/result schemas, resource limits, assumptions and references.
    """
    return copy.deepcopy(_DESCRIPTOR)


def _sum(values):
    total, correction = 0.0, 0.0
    for value in values:
        updated = total + value
        correction += (total - updated) + value if abs(total) >= abs(value) else (value - updated) + total
        total = updated
    return total + correction


def _rms(values):
    if not values:
        return None
    scale = max(abs(v) for v in values)
    return math.sqrt(_sum([(v / scale) ** 2 for v in values]) / len(values)) * scale if scale else 0.0


def _linear(left, right, fraction):
    if fraction == 0:
        return left
    if fraction == 1:
        return right
    return None if left is None or right is None else float(left) + (float(right) - float(left)) * fraction


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e100


def _compute(data, params):
    records, channel, tol = data["records"], params["channel"], params["intersection_tolerance"]
    lines, segments = [], []
    long_segments = 0
    previous = None
    for index, row in enumerate(records):
        line = row["line_id"]
        if previous is None or previous["line_id"] != line:
            if line in lines:
                raise ValueError("each line_id must form one contiguous acquisition run; relabel repeated runs explicitly")
            lines.append(line)
            if len(lines) > _LIMITS["max_lines"]:
                raise _ResourceError("crossovers accept at most 128 lines")
        else:
            rx, ry = float(row["x"]) - float(previous["x"]), float(row["y"]) - float(previous["y"])
            length = math.hypot(rx, ry)
            if length <= 2 * tol:
                raise ValueError("coincident/tiny consecutive geometry requires QC or a smaller declared tolerance")
            if length > params["max_segment_length"]:
                long_segments += 1
            else:
                segments.append({"index": index - 1, "line": line, "line_index": len(lines) - 1, "left": previous, "right": row, "rx": rx, "ry": ry, "length": length,
                                 "minx": min(previous["x"], row["x"]), "maxx": max(previous["x"], row["x"]), "miny": min(previous["y"], row["y"]), "maxy": max(previous["y"], row["y"])})
        previous = row
    if len(segments) > _LIMITS["max_segments"]:
        raise _ResourceError("too many crossover segments")
    active, unique = [], {}
    pair_tests = raw_count = parallel = duplicates = 0
    for current in sorted(segments, key=lambda s: (s["minx"], s["index"])):
        active = [s for s in active if s["maxx"] + tol >= current["minx"]]
        for old in active:
            pair_tests += 1
            if pair_tests > _LIMITS["max_pair_tests"]:
                raise _ResourceError("crossover sweep exceeds 1000000 active pair tests; partition by complete lines and retain required references")
            if old["line"] == current["line"] or old["maxy"] + tol < current["miny"] or current["maxy"] + tol < old["miny"]:
                continue
            a, b = (old, current) if old["line_index"] < current["line_index"] else (current, old)
            rs, ss = max(abs(a["rx"]), abs(a["ry"])), max(abs(b["rx"]), abs(b["ry"]))
            rx, ry, sx, sy = a["rx"] / rs, a["ry"] / rs, b["rx"] / ss, b["ry"] / ss
            denominator = rx * sy - ry * sx
            if abs(denominator) <= _LIMITS["parallel_threshold"]:
                parallel += 1
                continue
            qx, qy = float(b["left"]["x"]) - float(a["left"]["x"]), float(b["left"]["y"]) - float(a["left"]["y"])
            t = ((qx / rs) * sy - (qy / rs) * sx) / denominator
            u = ((qx / ss) * ry - (qy / ss) * rx) / denominator
            if not -tol / a["length"] <= t <= 1 + tol / a["length"] or not -tol / b["length"] <= u <= 1 + tol / b["length"]:
                continue
            def snap(value, length):
                if value <= tol / length:
                    return 0.0
                if value >= 1 - tol / length:
                    return 1.0
                return value
            t, u = snap(t, a["length"]), snap(u, b["length"])
            pax, pay = a["rx"] * t, a["ry"] * t
            pbx, pby = qx + b["rx"] * u, qy + b["ry"] * u
            if math.hypot(pax - pbx, pay - pby) > tol:
                continue
            raw_count += 1
            if raw_count > _LIMITS["max_raw_crossovers"]:
                raise _ResourceError("too many raw crossover candidates")
            angle = math.atan2(abs(denominator), abs(rx * sx + ry * sy)) * (180 / math.pi)
            va = _linear(a["left"]["values"][channel], a["right"]["values"][channel], t)
            vb = _linear(b["left"]["values"][channel], b["right"]["values"][channel], u)
            za, zb = _linear(a["left"]["z"], a["right"]["z"], t), _linear(b["left"]["z"], b["right"]["z"], u)
            dz = abs(float(za) - float(zb)) if za is not None and zb is not None else None
            difference = float(va) - float(vb) if va is not None and vb is not None else None
            if any(value is not None and not _number(value) for value in (va, vb, za, zb, dz, difference)):
                raise ValueError("interpolated crossover values exceed portable numeric range")
            reason = None
            if va is None or vb is None:
                reason = "missing_reading"
            elif angle < params["min_crossing_angle"]:
                reason = "shallow_angle"
            elif params["elevation_policy"] == "limit":
                if za is None or zb is None:
                    reason = "missing_height"
                elif dz > params["max_height_difference"]:
                    reason = "height_difference"
            def location(segment, fraction):
                return ("v", segment["left"]["id"] if fraction == 0 else segment["right"]["id"]) if fraction in (0, 1) else ("s", segment["index"])
            key = (a["line_index"], b["line_index"], location(a, t), location(b, u))
            row = {"line_a": a["line"], "line_b": b["line"], "x": float(a["left"]["x"]) + (pax + pbx) / 2, "y": float(a["left"]["y"]) + (pay + pby) / 2,
                   "segment_a": [a["left"]["id"], a["right"]["id"]], "segment_b": [b["left"]["id"], b["right"]["id"]], "fraction_a": t, "fraction_b": u,
                   "angle_degrees": angle, "value_a": va, "value_b": vb, "height_a": za, "height_b": zb, "height_difference": dz, "difference": difference, "eligible": reason is None, "reason": reason}
            candidate = (row, a["index"], b["index"])
            if key in unique:
                duplicates += 1
                previous_row, ai, bi = unique[key]
                if (row["eligible"], angle, -a["index"], -b["index"]) > (previous_row["eligible"], previous_row["angle_degrees"], -ai, -bi):
                    unique[key] = candidate
            else:
                unique[key] = candidate
                if len(unique) > _LIMITS["max_crossovers"]:
                    raise _ResourceError("too many unique crossovers")
        active.append(current)
    crossovers = []
    for row, _, _ in sorted(unique.values(), key=lambda item: (item[1], item[2])):
        crossovers.append({"id": "x" + str(len(crossovers)), **row})
    eligible = [row["difference"] for row in crossovers if row["eligible"]]
    return {"crossovers": crossovers, "lines": lines,
            "diagnostics": {"records": len(records), "lines": len(lines), "segments": len(segments), "long_segments_excluded": long_segments, "pair_tests": pair_tests, "raw_crossovers": raw_count, "vertex_duplicates": duplicates, "parallel_candidates_excluded": parallel},
            "summary": {"crossovers": len(crossovers), "eligible": len(eligible), "rms_difference": _rms(eligible)}}
