import ee from "papaparse";
import { jsx as k, jsxs as ae } from "react/jsx-runtime";
import { useRef as rt, useState as W, useEffect as re, useMemo as ze } from "react";
import me from "plotly.js-dist-min";
import * as g from "three";
import { OrbitControls as ot } from "three/examples/jsm/controls/OrbitControls";
import { FlyControls as it } from "three/examples/jsm/controls/FlyControls";
import { ViewportGizmo as st } from "three-viewport-gizmo";
const x = "hole_id", q = "latitude", X = "longitude", oe = "elevation", j = "azimuth", B = "dip", $ = "from", H = "to", we = "mid", Z = "project_id", K = "easting", J = "northing", $e = "crs", V = "depth", cn = {
  // A unique hole identifier across the entire dataset and all future data sets
  [x]: "string",
  // The hole ID from the original collar source
  datasource_hole_id: "string",
  // The project ID or project code from the original collar source, if available
  [Z]: "string",
  // The latitude of the collar, in decimal degrees (WGS84)
  [q]: "number",
  // The longitude of the collar, in decimal degrees (WGS84)
  [X]: "number",
  // The elevation of the collar, in meters above sea level (WGS84)
  [oe]: "number",
  // The easting coordinate of the collar, in meters (projected CRS)
  [K]: "number",
  // The northing coordinate of the collar, in meters (projected CRS)
  [J]: "number",
  // The coordinate reference system of the collar coordinates for easting/northing, as an EPSG code or proj string
  [$e]: "string"
}, un = {
  // The unique hole id that maps to the collar and any other data tables
  [x]: "string",
  // The depth along the hole where the survey measurement was taken / started
  [V]: "number",
  // The depth along the hole where the survey measurement ended, if applicable (some surveys are point measurements and may not have a 'to' depth)
  [H]: "number",
  // The azimuth of the hole at the survey depth, in degrees from north
  [j]: "number",
  // The dip of the hole at the survey depth, in degrees from horizontal (negative values indicate downward inclination)
  [B]: "number"
}, dn = {
  // The unique hole id that maps to the collar and any other data tables
  [x]: "string",
  // The depth along the hole where the assay interval starts
  [$]: "number",
  // The depth along the hole where the assay interval ends
  [H]: "number",
  // The midpoint depth of the assay interval
  [we]: "number"
  // assay value columns are variable and not standardized here. 
  // Assays may be flattened (one column per assay type) or long (one row per assay type with an additional 'assay_type' column)
}, at = {
  [x]: ["hole_id", "holeid", "hole id", "hole-id"],
  datasource_hole_id: ["datasource_hole_id", "datasourceholeid", "datasource hole id", "datasource-hole-id", "company_hole_id", "companyholeid", "company hole id", "company-hole-id"],
  [Z]: ["project_id", "projectid", "project id", "project-id", "project_code", "projectcode", "project code", "project-code", "companyId", "company_id", "companyid", "company id", "company-id", "dataset", "project"],
  [q]: ["latitude", "lat"],
  [X]: ["longitude", "lon"],
  [oe]: ["elevation", "rl", "elev", "z"],
  [K]: ["easting", "x"],
  [J]: ["northing", "y"],
  [$e]: ["crs", "epsg", "projection"],
  [$]: ["from", "depth_from", "from_depth", "samp_from", "sample_from", "sampfrom", "fromdepth"],
  [H]: ["to", "depth_to", "to_depth", "samp_to", "sample_to", "sampto", "todepth"],
  [j]: ["azimuth", "az", "dipdir", "dip_direction"],
  [B]: ["dip"],
  declination: ["declination", "dec"],
  [V]: ["depth", "survey_depth", "surveydepth"]
}, je = {};
for (const [e, t] of Object.entries(at))
  for (const n of t) {
    const r = n.toLowerCase().trim();
    je[r] = e;
  }
function fe(e) {
  return (e || "").toString().trim().toLowerCase().replace(/\s+/g, "_");
}
function ce(e, t = null, n = null) {
  const r = { ...je };
  if (n) {
    for (const [s, i] of Object.entries(n))
      if (s != null && i != null) {
        const a = fe(s), c = fe(i);
        r[a] = c;
      }
  }
  const o = {};
  for (const [s, i] of Object.entries(e)) {
    const a = fe(s), c = r[a] || a;
    o[c] = i;
  }
  return o;
}
function mn(e, t = null, n = null) {
  return e.map((r) => ce(r, t, n));
}
const Be = /* @__PURE__ */ new Set([
  "hole_id",
  "holeid",
  "id",
  "holeId",
  "project_code",
  "project",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "elevation",
  "dip",
  "azimuth",
  "holetype",
  "shape",
  "anumber",
  "collarid",
  "companyholeid",
  "company_hole_id",
  "samp_from",
  "samp_to",
  "sample_from",
  "sample_to",
  "from",
  "to",
  "depth_from",
  "depth_to",
  "fromdepth",
  "todepth",
  "comment",
  "z"
]), Ie = "[baselode:data]";
function lt(e, t = "Unknown error") {
  if (e instanceof Error) return e;
  const n = typeof e == "string" && e.trim() ? e : t;
  return new Error(n);
}
function P(e, t, n = "Operation failed") {
  const r = lt(t, n), o = new Error(`${e}: ${r.message}`);
  return o.cause = r, o;
}
function fn(e, t) {
  if (t !== void 0) {
    console.warn(`${Ie} ${e}`, t);
    return;
  }
  console.warn(`${Ie} ${e}`);
}
function hn(e) {
  console.info(`${Ie} ${e}`);
}
const ye = (e, t = null) => ce(e, null, t);
function ct(e) {
  return { holeId: e[x] };
}
function Ue(e, t = null) {
  const n = e[x], r = n !== void 0 ? `${n}`.trim() : "";
  if (!r) return null;
  const o = e[Z] || e.project || e.project_code, s = Number(e[$]), i = Number(e[H]);
  return !Number.isFinite(s) || !Number.isFinite(i) || i <= s ? null : {
    holeId: r,
    project: o,
    from: s,
    to: i,
    ...e
  };
}
function Ye(e, t) {
  var o;
  const n = t.sort((s, i) => s.from - i.from), r = [];
  return n.forEach((s) => {
    const { from: i, to: a, project: c, ...l } = s, u = {
      z: i,
      from: i,
      to: a,
      [x]: e,
      [Z]: c,
      ...l
    };
    r.push(u), r.push({ ...u, z: a });
  }), { id: e, project: (o = n[0]) == null ? void 0 : o.project, points: r };
}
function pn(e, t = null) {
  return new Promise((n, r) => {
    const o = /* @__PURE__ */ new Set();
    ee.parse(e, {
      header: !0,
      dynamicTyping: !0,
      skipEmptyLines: !0,
      step: (s) => {
        const a = ye(s.data, t)[x];
        a !== void 0 && `${a}`.trim() !== "" && o.add(`${a}`.trim());
      },
      complete: () => n(Array.from(o)),
      error: (s) => r(P("parseAssayHoleIds", s))
    });
  });
}
function ut(e) {
  return Object.entries(e || {}).some(([t, n]) => !(Be.has(t) || n == null || typeof n == "string" && n.trim() === ""));
}
function dt(e, t = null) {
  return new Promise((n, r) => {
    const o = /* @__PURE__ */ new Map();
    ee.parse(e, {
      header: !0,
      dynamicTyping: !0,
      skipEmptyLines: !0,
      step: (s) => {
        const i = ye(s.data, t);
        if (!ut(i)) return;
        const c = ct(i).holeId;
        if (c !== void 0 && `${c}`.trim() !== "") {
          const l = `${c}`.trim();
          o.has(l) || o.set(l, {
            holeId: l
          });
        }
      },
      complete: () => n(Array.from(o.values())),
      error: (s) => r(P("parseAssayHoleIdsWithAssays", s))
    });
  });
}
function mt(e, t, n = null, r = null) {
  return new Promise((o, s) => {
    const i = `${t}`.trim();
    if (!i) {
      s(P("parseAssayHole", new Error("Missing hole id")));
      return;
    }
    const a = [];
    ee.parse(e, {
      header: !0,
      dynamicTyping: !0,
      skipEmptyLines: !0,
      step: (c) => {
        const l = ye(c.data, r), u = Ue(l, r);
        u && `${u.holeId}`.trim() === i && a.push(u);
      },
      complete: () => {
        if (!a.length) {
          o(null);
          return;
        }
        const c = Ye(i, a);
        o(c);
      },
      error: (c) => s(P("parseAssayHole", c))
    });
  });
}
function ft(e, t = null, n = null) {
  return new Promise((r, o) => {
    ee.parse(e, {
      header: !0,
      dynamicTyping: !0,
      skipEmptyLines: !0,
      complete: (s) => {
        const i = /* @__PURE__ */ new Map();
        s.data.forEach((c) => {
          const l = ye(c, n), u = Ue(l, n);
          u && (i.has(u.holeId) || i.set(u.holeId, []), i.get(u.holeId).push(u));
        });
        const a = Array.from(i.entries()).map(([c, l]) => Ye(c, l));
        r({ holes: a });
      },
      error: (s) => o(P("parseAssaysCSV", s))
    });
  });
}
function yn(e = {}) {
  const t = {};
  return Object.entries(e || {}).forEach(([n, r]) => {
    n && (t[fe(n)] = r);
  }), t;
}
function gn(e = {}, t = [], n) {
  for (const r of t) {
    const o = e[r];
    if (o != null && `${o}`.trim() !== "")
      return o;
  }
  return n;
}
const ht = 4;
function Ge(e = [], t = "") {
  if (!e.length) return [];
  if (!t) return e;
  const n = e.findIndex((s) => s === t);
  if (n === -1) return e;
  const r = e[n], o = e.filter((s, i) => i !== n);
  return [r, ...o];
}
function he({
  property: e = "",
  chartType: t = "",
  categoricalProps: n = [],
  numericDefaultChartType: r = "markers+line"
} = {}) {
  return e ? n.includes(e) ? "categorical" : !t || t === "categorical" ? r : t : t || r;
}
function qe({
  holeIds: e = [],
  focusedHoleId: t = "",
  plotCount: n = ht,
  defaultProp: r = "",
  categoricalProps: o = [],
  numericDefaultChartType: s = "markers+line"
} = {}) {
  const i = Ge(e, t);
  return Array.from({ length: n }).map((a, c) => {
    const l = i[c] || e[c] || "", u = he({
      property: r,
      chartType: "",
      categoricalProps: o,
      numericDefaultChartType: s
    });
    return {
      holeId: l,
      property: r,
      chartType: u
    };
  });
}
function Xe(e = []) {
  const t = e.flatMap((i) => i.points || []), n = /* @__PURE__ */ new Set();
  t.forEach((i) => {
    Object.keys(i || {}).forEach((a) => {
      Be.has(a) || n.add(a);
    });
  });
  const r = [], o = [];
  n.forEach((i) => {
    var l;
    let a = !1, c = !1;
    for (let u = 0; u < t.length; u += 1) {
      const m = (l = t[u]) == null ? void 0 : l[i];
      if (!(m == null || typeof m == "string" && m.trim() === "") && (c = !0, typeof m == "number" && Number.isFinite(m))) {
        a = !0;
        break;
      }
    }
    a ? r.push(i) : c && o.push(i);
  });
  const s = r[0] || o[0] || "";
  return { numericProps: r, categoricalProps: o, defaultProp: s };
}
async function pt(e, t = null) {
  return await dt(e);
}
async function yt(e, t, n = null) {
  return await mt(e, t);
}
function gt(e = [], t = "") {
  if (!e.length) return null;
  const { numericProps: n, categoricalProps: r, defaultProp: o } = Xe(e), s = e.map((a) => a.id || a.holeId).filter(Boolean), i = qe({
    holeIds: s,
    focusedHoleId: t,
    plotCount: 4,
    defaultProp: o,
    categoricalProps: r,
    numericDefaultChartType: "line"
  });
  return {
    holes: e,
    numericProps: n,
    categoricalProps: r,
    defaultProp: o,
    traceConfigs: i
  };
}
async function bn(e, t = "", n = null) {
  const { holes: r } = await ft(e, n), o = gt(r, t);
  if (!o) throw new Error("No valid assay intervals found.");
  return o;
}
function Cn(e, t = null) {
  return new Promise((n, r) => {
    ee.parse(e, {
      header: !0,
      dynamicTyping: !0,
      skipEmptyLines: !0,
      complete: (o) => {
        const s = o.data.map((i) => bt(i, t)).filter((i) => i[x] && Number.isFinite(i[V]) && Number.isFinite(i[B]) && Number.isFinite(i[j]));
        n(s);
      },
      error: (o) => r(P("parseSurveyCSV", o))
    });
  });
}
function bt(e, t = null) {
  const n = ce(e, null, t), r = n[x], o = n[Z] || n.project || n.project_code, s = ne(n[q]), i = ne(n[X]), a = ne(n[V]), c = ne(n[B]), l = ne(n[j]), u = ne(n.maxdepth);
  return {
    raw: n,
    [x]: r,
    [Z]: o,
    [q]: s,
    [X]: i,
    [V]: a,
    [B]: c,
    [j]: l,
    maxdepth: u,
    // Legacy field names for backwards compatibility
    project_code: o,
    latitude: s,
    longitude: i,
    surveydepth: a
  };
}
const ne = (e) => {
  const t = Number(e);
  return Number.isFinite(t) ? t : void 0;
};
function _n(e, t) {
  var l, u, m, f;
  const n = /* @__PURE__ */ new Map();
  e.forEach((d) => {
    const p = (d[x] || d.holeId || d.id || "").toString().trim();
    if (!p) return;
    const y = p.toLowerCase();
    n.has(y) || n.set(y, d);
  });
  const r = ((l = e[0]) == null ? void 0 : l.lat) ?? ((u = e[0]) == null ? void 0 : u[q]) ?? 0, o = ((m = e[0]) == null ? void 0 : m.lng) ?? ((f = e[0]) == null ? void 0 : f[X]) ?? 0, s = 111132, i = 111320 * Math.cos(r * Math.PI / 180), a = /* @__PURE__ */ new Map();
  t.forEach((d) => {
    const p = (d[x] || "").toString().trim();
    if (!p) return;
    const y = p.toLowerCase();
    a.has(y) || a.set(y, []), a.get(y).push(d);
  });
  const c = [];
  return a.forEach((d, p) => {
    const y = n.get(p);
    if (!y) return;
    const h = d.filter((b) => Number.isFinite(b[V] ?? b.surveydepth)).sort((b, _) => (b[V] ?? b.surveydepth) - (_[V] ?? _.surveydepth));
    if (!h.length) return;
    const A = y.lat ?? y[q], O = y.lng ?? y[X], F = 111132, D = 111320 * Math.cos(A * Math.PI / 180), R = (O - o) * i, w = (A - r) * s, I = [];
    let N = 0, z = 0, C = 0;
    for (let b = 0; b < h.length; b += 1) {
      const _ = h[b], M = h[b - 1], L = _[V] ?? _.surveydepth, v = _[j] ?? _.azimuth, T = _[B] ?? _.dip;
      if (!M) {
        I.push({
          x: R + N,
          y: w + z,
          z: 0,
          md: L,
          azimuth: v,
          dip: T
        });
        continue;
      }
      const S = M[V] ?? M.surveydepth, Y = M[j] ?? M.azimuth, ue = M[B] ?? M.dip, de = L - S;
      if (de <= 0) continue;
      const ie = Fe(ue), se = Fe(T), ge = Ee(Y), be = Ee(v), Ce = Math.acos(
        Math.sin(ie) * Math.sin(se) * Math.cos(ge - be) + Math.cos(ie) * Math.cos(se)
      ), _e = Ce > 1e-6 ? 2 / Ce * Math.tan(Ce / 2) : 1, et = 0.5 * de * (Math.sin(ie) * Math.cos(ge) + Math.sin(se) * Math.cos(be)) * _e, tt = 0.5 * de * (Math.sin(ie) * Math.sin(ge) + Math.sin(se) * Math.sin(be)) * _e, nt = 0.5 * de * (Math.cos(ie) + Math.cos(se)) * _e;
      N += et, z += tt, C += nt, I.push({
        x: R + N,
        y: w + z,
        z: -C,
        // render with z up; depth down
        md: L,
        azimuth: v,
        dip: T
      });
    }
    const E = I.map((b) => ({
      ...b,
      lat: A + b.y / F,
      lng: O + b.x / D
    }));
    c.push({
      id: y[x] || y.holeId || p,
      project: y[Z] || y.project_id || y.project || "",
      points: E,
      collar: y
    });
  }), c;
}
const Ee = (e) => e * Math.PI / 180, Fe = (e) => {
  const t = Number(e), n = 90 + (Number.isFinite(t) ? t : 0), r = Math.min(180, Math.max(0, n));
  return Ee(r);
};
function G(e, t = void 0) {
  const n = Number(e);
  return Number.isFinite(n) ? n : t;
}
function Se(e) {
  return e == null ? "" : `${e}`.trim();
}
function pe(e = [], t = null) {
  const n = t || "hole_id", o = [n, "hole_id", "holeId", "id"].find((s) => e.some((i) => Se(i == null ? void 0 : i[s])));
  if (!o)
    throw P("canonicalizeHoleIdRows", new Error(`hole id column '${n}' not found`));
  return {
    aliasCol: o,
    rows: e.map((s) => ({
      ...s,
      hole_id: Se(s == null ? void 0 : s[o])
    }))
  };
}
function ke(e) {
  return Number(e) * Math.PI / 180;
}
function xe(e, t) {
  const n = ke(e), r = ke(t), o = Math.cos(r) * Math.sin(n), s = Math.cos(r) * Math.cos(n), i = Math.sin(r) * -1;
  return { ca: o, cb: s, cc: i };
}
function Ct(e, t, n, r, o, s = "minimum_curvature") {
  const i = xe(t, n), a = xe(r, o);
  if (s === "tangential")
    return {
      dx: e * i.ca,
      dy: e * i.cb,
      dz: e * i.cc,
      azimuth: t,
      dip: n
    };
  if (s === "balanced_tangential") {
    const m = 0.5 * (t + r), f = 0.5 * (n + o), d = xe(m, f);
    return {
      dx: e * d.ca,
      dy: e * d.cb,
      dz: e * d.cc,
      azimuth: m,
      dip: f
    };
  }
  const c = i.ca * a.ca + i.cb * a.cb + i.cc * a.cc, l = Math.acos(Math.max(-1, Math.min(1, c))), u = l > 1e-6 ? 2 * Math.tan(l / 2) / l : 1;
  return {
    dx: 0.5 * e * (i.ca + a.ca) * u,
    dy: 0.5 * e * (i.cb + a.cb) * u,
    dz: 0.5 * e * (i.cc + a.cc) * u,
    azimuth: r,
    dip: o
  };
}
function ve(e = [], t = [], n = {}) {
  const {
    step: r = 1,
    holeIdCol: o = null,
    method: s = "minimum_curvature"
  } = n, i = Number.isFinite(Number(r)) && Number(r) > 0 ? Number(r) : 1, a = pe(e, o), c = pe(t, o || a.aliasCol);
  if (!a.rows.length || !c.rows.length) return [];
  const l = /* @__PURE__ */ new Map();
  a.rows.forEach((f) => {
    !f.hole_id || l.has(f.hole_id) || l.set(f.hole_id, f);
  });
  const u = /* @__PURE__ */ new Map();
  c.rows.forEach((f) => {
    f.hole_id && (u.has(f.hole_id) || u.set(f.hole_id, []), u.get(f.hole_id).push(f));
  });
  const m = [];
  return u.forEach((f, d) => {
    const p = l.get(d);
    if (!p) return;
    const y = [...f].map((I) => ({
      ...I,
      from: G(I.from),
      azimuth: G(I.azimuth),
      dip: G(I.dip)
    })).filter((I) => Number.isFinite(I.from) && Number.isFinite(I.azimuth) && Number.isFinite(I.dip)).sort((I, N) => I.from - N.from);
    if (!y.length) return;
    let h = G(p.x, 0), A = G(p.y, 0), O = G(p.z, 0), F = y[0].from;
    const D = y[0].azimuth, R = y[0].dip, w = {
      hole_id: d,
      md: F,
      x: h,
      y: A,
      z: O,
      azimuth: D,
      dip: R
    };
    a.aliasCol !== "hole_id" && p[a.aliasCol] !== void 0 && (w[a.aliasCol] = p[a.aliasCol]), m.push(w);
    for (let I = 0; I < y.length - 1; I += 1) {
      const N = y[I], z = y[I + 1], C = N.from, b = z.from - C;
      if (b <= 0) continue;
      const _ = Math.max(1, Math.ceil(b / i)), M = b / _;
      for (let L = 0; L < _; L += 1) {
        F += M;
        const v = (F - C) / b, T = N.azimuth + v * (z.azimuth - N.azimuth), S = N.dip + v * (z.dip - N.dip), Y = Ct(M, N.azimuth, N.dip, z.azimuth, z.dip, s);
        h += Y.dx, A += Y.dy, O += Y.dz;
        const ue = {
          hole_id: d,
          md: F,
          x: h,
          y: A,
          z: O,
          azimuth: s === "minimum_curvature" ? T : Y.azimuth,
          dip: s === "minimum_curvature" ? S : Y.dip
        };
        a.aliasCol !== "hole_id" && p[a.aliasCol] !== void 0 && (ue[a.aliasCol] = p[a.aliasCol]), m.push(ue);
      }
    }
  }), m;
}
function _t(e, t, n = {}) {
  return ve(e, t, { ...n, method: "minimum_curvature" });
}
function zn(e, t, n = {}) {
  return ve(e, t, { ...n, method: "tangential" });
}
function xn(e, t, n = {}) {
  return ve(e, t, { ...n, method: "balanced_tangential" });
}
function Nn(e, t, n = {}) {
  return _t(e, t, n);
}
function zt(e, t) {
  if (!e.length || !Number.isFinite(t)) return null;
  let n = null, r = 1 / 0;
  for (let o = 0; o < e.length; o += 1) {
    const s = e[o], i = G(s.md);
    if (!Number.isFinite(i)) continue;
    const a = Math.abs(i - t);
    a < r && (r = a, n = s);
  }
  return n;
}
function Mn(e = [], t = [], n = {}) {
  const r = n.holeIdCol || "hole_id", o = pe(e, r), s = pe(t, r);
  if (!o.rows.length || !s.rows.length) return [...o.rows];
  const i = /* @__PURE__ */ new Map();
  return s.rows.forEach((a) => {
    a.hole_id && (i.has(a.hole_id) || i.set(a.hole_id, []), i.get(a.hole_id).push(a));
  }), i.forEach((a, c) => {
    i.set(c, [...a].sort((l, u) => G(l.md, 0) - G(u.md, 0)));
  }), o.rows.map((a) => {
    const c = G(a.from), l = G(a.to), u = Number.isFinite(c) && Number.isFinite(l) ? 0.5 * (c + l) : void 0;
    if (!a.hole_id || !Number.isFinite(u)) return { ...a };
    const m = zt(i.get(a.hole_id) || [], u);
    if (!m) return { ...a };
    const f = { ...a };
    return ["md", "x", "y", "z", "azimuth", "dip"].forEach((d) => {
      m[d] !== void 0 && (Object.prototype.hasOwnProperty.call(f, d) ? f[`${d}_trace`] = m[d] : f[d] = m[d]);
    }), f;
  });
}
function An(e, t = null) {
  return new Promise((n, r) => {
    ee.parse(e, {
      header: !0,
      dynamicTyping: !0,
      skipEmptyLines: !0,
      complete: (o) => {
        const s = /* @__PURE__ */ new Map();
        o.data.forEach((a, c) => {
          const l = ce(a, null, t), u = l[x], m = u !== void 0 ? `${u}`.trim() : "", f = l[K] ?? l.x, d = l[J] ?? l.y, p = l[oe] ?? l.z, y = l.order ?? c;
          !m || f === null || f === void 0 || d === null || d === void 0 || p === null || p === void 0 || (s.has(m) || s.set(m, []), s.get(m).push({
            ...l,
            holeId: m,
            order: y,
            x: Number(f) ?? 0,
            y: Number(d) ?? 0,
            z: Number(p) ?? 0
          }));
        });
        const i = Array.from(s.entries()).map(([a, c]) => ({
          id: a,
          points: c.sort((l, u) => l.order - u.order).map((l) => ({
            ...l,
            x: Number(l.x) || 0,
            y: Number(l.y) || 0,
            z: Number(l.z) || 0
          }))
        }));
        n({ holes: i });
      },
      error: (o) => r(P("parseDrillholesCSV", o))
    });
  });
}
function le(e) {
  return e ? Array.isArray(e) ? [...e] : [] : [];
}
function U(e) {
  const t = Number(e);
  return Number.isFinite(t) ? t : void 0;
}
function We(e = [], t = []) {
  const n = [...e];
  return n.sort((r, o) => {
    for (let s = 0; s < t.length; s += 1) {
      const i = t[s], a = r == null ? void 0 : r[i], c = o == null ? void 0 : o[i];
      if (a !== c)
        return a == null ? 1 : c == null ? -1 : typeof a == "number" && typeof c == "number" ? a - c : `${a}`.localeCompare(`${c}`);
    }
    return 0;
  }), n;
}
function xt(e, t = {}) {
  return new Promise((n, r) => {
    ee.parse(e, {
      header: !0,
      dynamicTyping: !0,
      skipEmptyLines: !0,
      ...t,
      complete: (o) => n(Array.isArray(o == null ? void 0 : o.data) ? o.data : []),
      error: (o) => r(P("loadTable(csv)", o))
    });
  });
}
function Nt(e = [], t = null, n = null) {
  return e.map((r) => ce(r, t, n));
}
async function De(e, t = {}) {
  const {
    kind: n = "csv",
    columnMap: r = null,
    sourceColumnMap: o = null,
    papaParseConfig: s = {}
  } = t;
  let i;
  if (Array.isArray(e))
    i = le(e);
  else if (n === "csv")
    i = await xt(e, s);
  else throw n === "parquet" || n === "sql" ? P("loadTable", new Error(`Unsupported kind in JS runtime: ${n}`)) : P("loadTable", new Error(`Unsupported kind: ${n}`));
  return Nt(i, r, o);
}
async function In(e, t = {}) {
  const {
    crs: n = null,
    sourceColumnMap: r = null,
    keepAll: o = !0,
    ...s
  } = t, i = await De(e, { ...s, sourceColumnMap: r });
  if (!i.some((f) => x in f))
    throw P("loadCollars", new Error(`Collar table missing column: ${x}`));
  const c = i.some((f) => K in f && J in f), l = i.some((f) => q in f && X in f);
  if (!c && !l)
    throw P("loadCollars", new Error("Collar table missing coordinate columns (need easting/northing or latitude/longitude)"));
  const u = i.map((f) => {
    const d = { ...f };
    if (x in d) {
      const p = d[x];
      d[x] = p == null ? "" : `${p}`.trim();
    }
    return q in d && (d[q] = U(d[q])), X in d && (d[X] = U(d[X])), oe in d && (d[oe] = U(d[oe])), K in d && (d[K] = U(d[K])), J in d && (d[J] = U(d[J])), !("datasource_hole_id" in d) && x in d && (d.datasource_hole_id = d[x]), d;
  });
  if (!u.every((f) => !(!f[x] || l && (!Number.isFinite(f[q]) || !Number.isFinite(f[X])) || c && !l && (!Number.isFinite(f[K]) || !Number.isFinite(f[J])))))
    throw P("loadCollars", new Error("Collar table has missing required values"));
  return u;
}
async function En(e, t = {}) {
  const {
    sourceColumnMap: n = null,
    keepAll: r = !0,
    ...o
  } = t, s = await De(e, { ...o, sourceColumnMap: n }), i = [x, V, j, B];
  for (const l of i)
    if (!s.some((m) => l in m))
      throw P("loadSurveys", new Error(`Survey table missing column: ${l}`));
  const a = s.map((l) => {
    const u = { ...l };
    if (x in u) {
      const m = u[x];
      u[x] = m == null ? "" : `${m}`.trim();
    }
    return V in u && (u[V] = U(u[V])), H in u && (u[H] = U(u[H])), j in u && (u[j] = U(u[j])), B in u && (u[B] = U(u[B])), u;
  });
  if (!a.every((l) => !(!l[x] || !Number.isFinite(l[V]) || !Number.isFinite(l[j]) || !Number.isFinite(l[B]))))
    throw P("loadSurveys", new Error("Survey table has missing required values"));
  return We(a, [x, V]);
}
async function vn(e, t = {}) {
  const {
    sourceColumnMap: n = null,
    keepAll: r = !0,
    ...o
  } = t, s = await De(e, { ...o, sourceColumnMap: n }), i = [x, $, H];
  for (const l of i)
    if (!s.some((m) => l in m))
      throw P("loadAssays", new Error(`Assay table missing column: ${l}`));
  const a = s.map((l) => {
    const u = { ...l };
    if (x in u) {
      const m = u[x];
      u[x] = m == null ? "" : `${m}`.trim();
    }
    return $ in u && (u[$] = U(u[$])), H in u && (u[H] = U(u[H])), $ in u && H in u && Number.isFinite(u[$]) && Number.isFinite(u[H]) && (u[we] = 0.5 * (u[$] + u[H])), u;
  });
  if (!a.every((l) => !(!l[x] || !Number.isFinite(l[$]) || !Number.isFinite(l[H]))))
    throw P("loadAssays", new Error("Assay table has missing required values"));
  return We(a, [x, $, H]);
}
function Dn(e = [], t = [], n = {}) {
  const r = Array.isArray(n.onCols) && n.onCols.length ? n.onCols : [x];
  if (!t.length) return [...e];
  const o = (i) => r.map((a) => `${(i == null ? void 0 : i[a]) ?? ""}`).join("|"), s = /* @__PURE__ */ new Map();
  return t.forEach((i) => {
    s.set(o(i), i);
  }), e.map((i) => {
    const a = s.get(o(i));
    if (!a) return { ...i };
    const c = { ...i };
    return Object.entries(a).forEach(([l, u]) => {
      r.includes(l) || (Object.prototype.hasOwnProperty.call(c, l) ? c[`${l}_trace`] = u : c[l] = u);
    }), c;
  });
}
function Ln(e = [], t = null) {
  return t == null ? [...e] : e.length ? e.some((r) => Z in r) ? e.filter((r) => (r == null ? void 0 : r[Z]) === t) : [...e] : [];
}
function Tn(e = [], t = []) {
  return e.map((n) => {
    const r = { ...n };
    return t.forEach((o) => {
      if (!(o in r)) return;
      const s = U(r[o]);
      r[o] = s;
    }), r;
  });
}
function Pn({
  collars: e = [],
  surveys: t = [],
  assays: n = [],
  structures: r = [],
  metadata: o = {}
} = {}) {
  return {
    collars: le(e),
    surveys: le(t),
    assays: le(n),
    structures: le(r),
    metadata: o || {}
  };
}
function On(e) {
  return new Promise((t, n) => {
    ee.parse(e, {
      header: !0,
      dynamicTyping: !0,
      complete: (r) => {
        const o = r.data.filter(
          (a) => a.center_x !== null && a.center_y !== null && a.center_z !== null
        ), s = ["center_x", "center_y", "center_z", "size_x", "size_y", "size_z"], i = Object.keys(o[0] || {}).filter(
          (a) => !s.includes(a)
        );
        t({ data: o, properties: i });
      },
      error: (r) => {
        n(P("parseBlockModelCSV", r));
      }
    });
  });
}
function Fn(e, t) {
  const n = e.map((s) => s[t]).filter((s) => s != null);
  if (n.every((s) => typeof s == "number")) {
    const s = Math.min(...n), i = Math.max(...n);
    return { type: "numeric", min: s, max: i, values: n };
  }
  return { type: "categorical", categories: [...new Set(n)], values: n };
}
function Mt(e, t, n) {
  if (!t) return new n.Color("#888888");
  if (t.type === "numeric") {
    const s = t.max - t.min, a = (1 - (s === 0 ? 0.5 : (e - t.min) / s)) * 240;
    return new n.Color().setHSL(a / 360, 0.8, 0.5);
  }
  const o = t.categories.indexOf(e) / Math.max(t.categories.length, 1) * 360;
  return new n.Color().setHSL(o / 360, 0.7, 0.5);
}
const He = "#8b1e3f", At = "#a8324f", It = "#6b7280";
function Ve(e, t) {
  var r;
  if (!e || !t) return !1;
  const n = e.points || [];
  for (let o = 0; o < n.length; o += 1) {
    const s = (r = n[o]) == null ? void 0 : r[t];
    if (s != null && (typeof s == "number" && Number.isFinite(s) || typeof s == "string" && s.trim() !== ""))
      return !0;
  }
  return !1;
}
function Et(e, t, n) {
  if (!e || !t) return [];
  const r = (e == null ? void 0 : e.points) || [], o = [], s = /* @__PURE__ */ new Set();
  return r.forEach((i) => {
    const a = Number(
      i.from ?? i.samp_from ?? i.sample_from ?? i.fromdepth ?? i.from_depth ?? i.depth_from
    ), c = Number(
      i.to ?? i.samp_to ?? i.sample_to ?? i.todepth ?? i.to_depth ?? i.depth_to
    ), l = i == null ? void 0 : i[t];
    if (!Number.isFinite(a) || !Number.isFinite(c) || c <= a || l == null || l === "") return;
    const u = `${t}:${a}-${c}`;
    if (s.has(u)) return;
    s.add(u);
    const m = (a + c) / 2, f = n ? l : Number(l);
    !n && !Number.isFinite(f) || o.push({
      z: m,
      val: f,
      from: a,
      to: c,
      errorPlus: c - m,
      errorMinus: m - a
    });
  }), o.sort((i, a) => a.z - i.z);
}
function vt(e, t) {
  if (!e.length) return { data: [], layout: {} };
  const n = [...e].sort((c, l) => l.z - c.z), r = [];
  for (let c = 0; c < n.length; c += 1) {
    const l = n[c], u = n[c + 1], m = l.z, f = u ? u.z : l.z - 20;
    f !== m && r.push({ y0: m, y1: f, category: l.val || "unknown" });
  }
  const o = ["#8b1e3f", "#a8324f", "#b84c68", "#d16587", "#e07ba0", "#f091b6", "#f7a7c8", "#fbcfe8"], s = r.map((c, l) => ({
    type: "rect",
    xref: "x",
    yref: "y",
    x0: 0,
    x1: 1,
    y0: c.y0,
    y1: c.y1,
    fillcolor: o[l % o.length],
    line: { width: 0 }
  }));
  return { data: [{
    x: r.map(() => 0.5),
    y: r.map((c) => (c.y0 + c.y1) / 2),
    mode: "text",
    text: r.map((c) => c.category),
    textposition: "middle center",
    showlegend: !1,
    hoverinfo: "text",
    customdata: r.map((c) => [c.y0, c.y1]),
    hovertemplate: "Category: %{text}<br>from: %{customdata[0]} to %{customdata[1]}<extra></extra>"
  }], layout: {
    height: 260,
    margin: { l: 50, r: 10, t: 10, b: 30 },
    xaxis: { range: [0, 1], visible: !1, fixedrange: !0 },
    yaxis: { title: "Depth (m)", autorange: "reversed", zeroline: !1 },
    shapes: s,
    showlegend: !1,
    title: t || void 0
  } };
}
function Dt(e, t, n) {
  if (!e.length) return { data: [], layout: {} };
  const r = n === "bar", o = n === "markers", s = n === "line", i = {
    x: e.map((u) => u.val),
    y: e.map((u) => u.z),
    hovertemplate: `${t}: %{x}<br>from: %{customdata[0]} to %{customdata[1]}<extra></extra>`,
    customdata: e.map((u) => [u.from, u.to])
  }, a = {
    type: "data",
    symmetric: !1,
    array: e.map((u) => u.errorPlus),
    arrayminus: e.map((u) => u.errorMinus),
    thickness: 1.5,
    width: 2,
    color: It
  };
  return { data: [r ? {
    ...i,
    type: "bar",
    orientation: "h",
    marker: { color: He },
    error_y: a
  } : {
    ...i,
    type: "scatter",
    mode: o ? "markers" : s ? "lines" : "lines+markers",
    line: { color: He, width: 2 },
    marker: { size: 7, color: At },
    error_y: s ? void 0 : a
  }], layout: {
    height: 260,
    margin: { l: 50, r: 10, t: 10, b: 30 },
    xaxis: { title: t, zeroline: !1 },
    yaxis: { title: "Depth (m)", autorange: "reversed", zeroline: !1 },
    barmode: "overlay",
    showlegend: !1
  } };
}
function Lt({ points: e, isCategorical: t, property: n, chartType: r }) {
  return !e || !e.length || !n ? { data: [], layout: {} } : t || r === "categorical" ? vt(e, n) : Dt(e, n, r);
}
const Le = "markers+line", Tt = [{ value: "categorical", label: "Categorical bands" }], Pt = [
  { value: "bar", label: "Bars" },
  { value: "markers", label: "Markers" },
  { value: Le, label: "Markers + Line" },
  { value: "line", label: "Line only" }
];
function Ot(e, t) {
  var n;
  return e.some((r) => r.value === t) ? t : ((n = e[0]) == null ? void 0 : n.value) || Le;
}
function Sn({ config: e, graph: t, holeOptions: n = [], propertyOptions: r = [], onConfigChange: o }) {
  const s = rt(null), i = t == null ? void 0 : t.hole, a = (t == null ? void 0 : t.points) || [], c = (e == null ? void 0 : e.property) || "", l = (e == null ? void 0 : e.chartType) || Le, u = (e == null ? void 0 : e.holeId) || "", m = (t == null ? void 0 : t.isCategorical) || !1, f = m ? Tt : Pt, d = Ot(f, l), [p, y] = W("");
  return re(() => {
    if (!i || !c || a.length === 0) return;
    const h = s.current;
    if (!h) return;
    const { data: A, layout: O } = Lt({ points: a, isCategorical: m, property: c, chartType: d });
    if (!A || A.length === 0) return;
    const F = {
      displayModeBar: !0,
      responsive: !0,
      useResizeHandler: !0,
      modeBarButtonsToRemove: ["select2d", "lasso2d", "zoom2d", "zoomIn2d", "zoomOut2d", "autoScale2d"]
    };
    try {
      y(""), me.react(h, A, O, F), requestAnimationFrame(() => {
        h && h.parentElement && me.Plots.resize(h);
      });
    } catch (D) {
      console.error("Plot render error", D), y((D == null ? void 0 : D.message) || "Plot render error");
    }
    return () => {
      if (h)
        try {
          me.purge(h);
        } catch (D) {
          console.warn("Plot purge error", D);
        }
    };
  }, [i, c, d, m, a]), re(() => {
    const h = s.current;
    if (!h || typeof ResizeObserver > "u") return;
    const A = new ResizeObserver(() => {
      try {
        h && h.data && me.Plots.resize(h);
      } catch (O) {
        console.warn("Plot resize error", O);
      }
    });
    return A.observe(h), () => A.disconnect();
  }, []), !i || !c ? /* @__PURE__ */ k("div", { className: "plot-card empty", children: /* @__PURE__ */ k("div", { className: "placeholder", children: e != null && e.holeId ? t != null && t.loading ? `Loading ${e.holeId}...` : "Select a property" : "Loading demo data..." }) }) : a.length === 0 ? /* @__PURE__ */ k("div", { className: "plot-card empty", children: /* @__PURE__ */ ae("div", { className: "placeholder", children: [
    "No numeric data for ",
    c
  ] }) }) : p ? /* @__PURE__ */ k("div", { className: "plot-card empty", children: /* @__PURE__ */ ae("div", { className: "placeholder", children: [
    "Plot error: ",
    p
  ] }) }) : /* @__PURE__ */ ae("div", { className: "plot-card", children: [
    /* @__PURE__ */ k("div", { className: "plot-title", children: /* @__PURE__ */ k(
      "select",
      {
        className: "plot-select",
        value: u,
        onChange: (h) => o && o({ holeId: h.target.value }),
        children: n.map((h) => {
          const A = typeof h == "string" ? h : h.holeId, O = typeof h == "string" ? h : h.label || h.holeId;
          return /* @__PURE__ */ k("option", { value: A, children: O }, A);
        })
      }
    ) }),
    /* @__PURE__ */ ae("div", { className: "plot-controls column", children: [
      r.length > 0 && /* @__PURE__ */ k(
        "select",
        {
          className: "plot-select",
          value: c,
          onChange: (h) => o && o({ property: h.target.value }),
          children: r.map((h) => /* @__PURE__ */ k("option", { value: h, children: h }, h))
        }
      ),
      /* @__PURE__ */ k(
        "select",
        {
          className: "plot-select",
          value: d,
          onChange: (h) => o && o({ chartType: h.target.value }),
          children: f.map((h) => /* @__PURE__ */ k("option", { value: h.value, children: h.label }, h.value))
        }
      )
    ] }),
    /* @__PURE__ */ k("div", { className: "plotly-chart", ref: s })
  ] });
}
function kn({
  initialFocusedHoleId: e = "",
  sourceFile: t = null,
  plotCount: n = 4
} = {}) {
  const [r, o] = W([]), [s, i] = W([]), [a, c] = W([]), [l, u] = W([]), [m, f] = W(""), [d, p] = W([]), [y, h] = W(""), [A, O] = W(e || ""), [F, D] = W([]);
  re(() => {
    !t || s.length > 0 || pt(t).then((z) => {
      if (!z) return;
      const C = Array.from(new Map(z.map((E) => [E.holeId, E])).values());
      i(C), p(qe({
        holeIds: C.map((E) => E.holeId),
        focusedHoleId: A,
        plotCount: n,
        defaultProp: "",
        categoricalProps: l,
        numericDefaultChartType: "markers+line"
      }));
    }).catch((z) => {
      console.info("Assay metadata load skipped:", z.message);
    });
  }, [t, s.length, A, n, l]), re(() => {
    h((z) => z && z.startsWith("Loading assays for hole") ? z : "");
  }, [d]), re(() => {
    if (!s.length) {
      p([]);
      return;
    }
    const z = Ge(s.map((C) => C.holeId), A);
    p((C) => Array.from({ length: n }).map((b, _) => {
      var S;
      const M = C[_] || {}, L = s.some((Y) => Y.holeId === M.holeId) ? M.holeId : z[_] || ((S = s[_]) == null ? void 0 : S.holeId) || "", v = M.property || m, T = he({
        property: v,
        chartType: M.chartType,
        categoricalProps: l,
        numericDefaultChartType: "markers+line"
      });
      return { holeId: L, property: v, chartType: T };
    }));
  }, [s, A, m, l, n]), re(() => {
    if (!t) return;
    d.map((C) => C.holeId).filter(Boolean).forEach((C) => {
      const E = r.some((_) => (_.id || _.holeId) === C), b = F.includes(C);
      E || b || (D((_) => [..._, C]), yt(t, C).then((_) => {
        D((M) => M.filter((L) => L !== C)), _ && o((M) => {
          const L = [...M.filter((T) => (T.id || T.holeId) !== C), _], v = Xe(L);
          return c(v.numericProps), u(v.categoricalProps), !m && v.defaultProp && (f(v.defaultProp), p((T) => T.map((S) => ({
            ...S,
            property: S.property || v.defaultProp,
            chartType: he({
              property: S.property || v.defaultProp,
              chartType: S.chartType,
              categoricalProps: v.categoricalProps,
              numericDefaultChartType: "markers+line"
            })
          })))), L;
        });
      }).catch((_) => {
        console.error(_), D((M) => M.filter((L) => L !== C)), h(_.message || `Error loading hole ${C}`);
      }));
    });
  }, [d, t, r, F, m]);
  const R = ze(() => [...a, ...l], [a, l]), w = ze(
    () => s.map((z) => ({ holeId: z.holeId, label: z.holeId })).sort((z, C) => z.label.localeCompare(C.label)),
    [s]
  ), I = ze(() => Array.from({ length: n }).map((z, C) => {
    const E = d[C] || {}, b = r.find((S) => (S.id || S.holeId) === E.holeId) || null;
    let _ = E.property || m;
    if (b && (!_ || !Ve(b, _))) {
      const S = [...a, ...l].find((Y) => Ve(b, Y));
      S && (_ = S);
    }
    const M = E.chartType || (_ && l.includes(_) ? "categorical" : "markers+line"), L = E.holeId || (b == null ? void 0 : b.id) || (b == null ? void 0 : b.holeId) || "", v = l.includes(_), T = Et(b, _, v);
    return {
      config: { holeId: L, property: _, chartType: M },
      hole: b,
      loading: F.includes(E.holeId),
      isCategorical: v,
      points: T,
      label: L
    };
  }), [d, r, m, l, F, n, a]), N = (z, C) => {
    p((E) => {
      const b = [...E], M = { ...b[z] || {}, ...C };
      return C.property && (M.chartType = he({
        property: C.property,
        chartType: M.chartType,
        categoricalProps: l,
        numericDefaultChartType: "markers+line"
      })), b[z] = M, b;
    });
  };
  return {
    error: y,
    focusedHoleId: A,
    setFocusedHoleId: O,
    setError: h,
    holeCount: s.length,
    numericProps: a,
    categoricalProps: l,
    propertyOptions: R,
    labeledHoleOptions: w,
    traceGraphs: I,
    handleConfigChange: N
  };
}
const Ft = [
  "#313695",
  "#4575b4",
  "#74add1",
  "#abd9e9",
  "#e0f3f8",
  "#fee090",
  "#fdae61",
  "#f46d43",
  "#d73027",
  "#a50026"
];
function St(e = [], t = Ft) {
  const n = e.filter((l) => Number.isFinite(l));
  if (!n.length)
    return {
      min: null,
      max: null,
      step: null,
      bins: [],
      colors: t
    };
  const r = n.slice().sort((l, u) => l - u), o = r[0], s = r[r.length - 1], i = t.length;
  if (s === o) {
    const l = t.map((u, m) => ({
      index: m,
      min: o,
      max: s,
      label: `${o}`
    }));
    return {
      min: o,
      max: s,
      step: 0,
      bins: l,
      colors: t
    };
  }
  const a = t.map((l, u) => {
    const m = u / i, f = (u + 1) / i, d = Math.floor(m * r.length), p = Math.min(r.length - 1, Math.floor(f * r.length)), y = r[d], h = u === i - 1 ? s : r[p];
    return {
      index: u,
      min: y,
      max: h,
      label: kt(y, h)
    };
  }), c = (s - o) / i;
  return {
    min: o,
    max: s,
    step: c,
    bins: a,
    colors: t
  };
}
function kt(e, t) {
  const n = (r) => Number.isFinite(r) ? Math.abs(r) >= 1e3 ? r.toFixed(0) : Math.abs(r) >= 10 ? r.toFixed(1) : Math.abs(r) >= 0.1 ? r.toFixed(2) : r.toFixed(3) : "n/a";
  return `${n(e)} – ${n(t)}`;
}
function Ze(e, t) {
  if (!Number.isFinite(e) || !t || !Array.isArray(t.bins) || !t.bins.length)
    return -1;
  if (t.max === t.min)
    return e === t.min ? 0 : -1;
  for (let n = 0; n < t.bins.length; n += 1) {
    const r = t.bins[n];
    if (e >= r.min && (e <= r.max || n === t.bins.length - 1))
      return n;
  }
  return -1;
}
function Ht(e, t, n = "#8b1e3f") {
  const r = Ze(e, t);
  return r < 0 ? n : t.colors[r] || n;
}
function Ke(e) {
  return Array.isArray(e) ? e : [];
}
function Ne(e) {
  const t = Number(e);
  return Number.isFinite(t) ? t : void 0;
}
function Je(e = {}) {
  return {
    ...e,
    x: Ne(e.x),
    y: Ne(e.y),
    z: Ne(e.z)
  };
}
function Vt(e = [], t = [0, 0], n = 0) {
  const [r, o] = t, s = Number(n) * Math.PI / 180, i = Math.cos(s), a = Math.sin(s);
  return Ke(e).map(Je).map((c) => {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return { ...c };
    const l = c.x - r, u = c.y - o;
    return {
      ...c,
      along: l * a + u * i,
      across: l * i - u * a
    };
  });
}
function Rt(e = [], t = [0, 0], n = 0, r = 50) {
  const o = Vt(e, t, n), s = 0.5 * Number(r || 0);
  return !Number.isFinite(s) || s <= 0 ? o : o.filter((i) => Number.isFinite(i.across) && Math.abs(i.across) <= s);
}
function Hn(e = [], t = null, n = null) {
  let r = Ke(e).map(Je);
  if (Array.isArray(t) && t.length === 2) {
    const [o, s] = t;
    r = r.filter((i) => Number.isFinite(i.z) && i.z <= Number(o) && i.z >= Number(s));
  }
  return n && (r = r.map((o) => ({
    ...o,
    color_value: o == null ? void 0 : o[n]
  }))), r;
}
function Vn(e = [], t = [0, 0], n = 0, r = 50, o = null) {
  let s = Rt(e, t, n, r);
  return o && (s = s.map((i) => ({
    ...i,
    color_value: i == null ? void 0 : i[o]
  }))), s;
}
function Te(e) {
  return Array.isArray(e) ? e : [];
}
function Pe(e = {}) {
  return e.hole_id ?? e.holeId ?? e.id;
}
function te(e) {
  const t = Number(e);
  return Number.isFinite(t) ? t : void 0;
}
function Rn(e = [], t = null) {
  const n = /* @__PURE__ */ new Map();
  Te(e).forEach((o) => {
    const s = Pe(o);
    if (s == null || `${s}`.trim() === "") return;
    const i = `${s}`;
    n.has(i) || n.set(i, []), n.get(i).push(o);
  });
  const r = [];
  return n.forEach((o, s) => {
    const i = [...o].sort((c, l) => te(c.md) - te(l.md)), a = {
      hole_id: s,
      x: i.map((c) => te(c.x)),
      y: i.map((c) => te(c.y)),
      z: i.map((c) => te(c.z)),
      color: null
    };
    t && (a.color = i.map((c) => c == null ? void 0 : c[t])), r.push(a);
  }), r;
}
function wn(e = [], t = 1, n = null) {
  return Te(e).map((r) => ({
    hole_id: Pe(r),
    from: r == null ? void 0 : r.from,
    to: r == null ? void 0 : r.to,
    radius: t,
    color: n ? r == null ? void 0 : r[n] : null,
    value: n ? r == null ? void 0 : r[n] : null
  }));
}
function $n(e = [], t = null) {
  return t ? Te(e).filter((n) => Object.prototype.hasOwnProperty.call(n || {}, t)).map((n) => ({
    hole_id: Pe(n),
    label: n == null ? void 0 : n[t],
    depth: 0.5 * (te(n == null ? void 0 : n.from) + te(n == null ? void 0 : n.to))
  })) : [];
}
function Oe(e) {
  var n, r, o, s, i, a, c, l, u;
  if (!e) return "";
  const t = (m) => Number.isFinite(m) ? m.toFixed(3) : "nan";
  return [
    t((n = e.camera) == null ? void 0 : n.x),
    t((r = e.camera) == null ? void 0 : r.y),
    t((o = e.camera) == null ? void 0 : o.z),
    t((s = e.target) == null ? void 0 : s.x),
    t((i = e.target) == null ? void 0 : i.y),
    t((a = e.target) == null ? void 0 : a.z),
    t((c = e.up) == null ? void 0 : c.x),
    t((l = e.up) == null ? void 0 : l.y),
    t((u = e.up) == null ? void 0 : u.z)
  ].join("|");
}
function Qe(e) {
  return !e.camera || !e.controls ? null : {
    camera: {
      x: e.camera.position.x,
      y: e.camera.position.y,
      z: e.camera.position.z
    },
    target: {
      x: e.controls.target.x,
      y: e.controls.target.y,
      z: e.controls.target.z
    },
    up: {
      x: e.camera.up.x,
      y: e.camera.up.y,
      z: e.camera.up.z
    }
  };
}
function wt(e, t) {
  if (!e.camera || !e.controls || !t) return !1;
  const n = t.camera || {}, r = t.target || {}, o = t.up || {};
  return [n.x, n.y, n.z, r.x, r.y, r.z, o.x, o.y, o.z].every(Number.isFinite) ? (e.camera.position.set(n.x, n.y, n.z), e.controls.target.set(r.x, r.y, r.z), e.camera.up.set(o.x, o.y, o.z), e.camera.lookAt(r.x, r.y, r.z), e.controls.update(), e._lastViewSignature = Oe(t), !0) : !1;
}
function $t(e) {
  if (!e.viewChangeHandler) return;
  const t = Date.now();
  if (t - e._lastViewEmitMs < 250) return;
  const n = Qe(e);
  if (!n) return;
  const r = Oe(n);
  r !== e._lastViewSignature && (e._lastViewSignature = r, e._lastViewEmitMs = t, e.viewChangeHandler(n));
}
function Me(e, { minX: t, maxX: n, minY: r, maxY: o, minZ: s, maxZ: i }) {
  const a = (t + n) / 2, c = (r + o) / 2, l = (s + i) / 2, u = n - t, m = o - r, f = i - s, p = Math.max(u, m, f, 1) * 2;
  e.controls.target.set(a, c, l), e.camera.position.set(a + p, c + p, l + p), e.camera.lookAt(a, c, l), e.controls.update();
}
function jt(e, t = 1e3) {
  !e.camera || !e.controls || (e.controls.target.set(0, 0, 0), e.camera.position.set(t, t, t), e.camera.lookAt(0, 0, 0), e.controls.update());
}
function Bt(e, t = 2e3) {
  !e.camera || !e.controls || (e.controls.target.set(0, 0, 0), e.camera.position.set(0, 0, t), e.camera.up.set(0, 1, 0), e.camera.lookAt(0, 0, 0), e.controls.update());
}
function Ut(e, t = 0, n = 0) {
  e.controls && typeof e.controls.pan == "function" && (e.controls.pan(t, n), e.controls.update());
}
function Yt(e, t = 1.1) {
  !e.controls || typeof e.controls.dollyIn != "function" || typeof e.controls.dollyOut != "function" || (t > 1 ? e.controls.dollyOut(t) : e.controls.dollyIn(1 / t), e.controls.update());
}
function Gt(e, t = 1.2) {
  if (!e.lastBounds) return;
  const {
    minX: n,
    maxX: r,
    minY: o,
    maxY: s,
    minZ: i,
    maxZ: a
  } = e.lastBounds, c = (r - n) * t, l = (s - o) * t, u = (a - i) * t, m = (n + r) / 2, f = (o + s) / 2, d = (i + a) / 2, y = Math.max(c, l, u, 1) * 2;
  e.controls.target.set(m, f, d), e.camera.position.set(m + y, f + y, d + y), e.camera.lookAt(m, f, d), e.controls.update();
}
function qt(e, t = "orbit") {
  if (e.controlMode = t === "fly" ? "fly" : "orbit", e.controlMode === "fly")
    e.controls && (e.controls.enabled = !1), e.flyControls && (e.flyControls.enabled = !0);
  else if (e.flyControls && (e.flyControls.enabled = !1), e.controls) {
    e.controls.enabled = !0, e.camera.getWorldDirection(e._tmpDir);
    const n = e.camera.position.clone().addScaledVector(e._tmpDir, 10);
    e.controls.target.copy(n), e.controls.update();
  }
}
const Q = "#9ca3af";
function Re(e, t) {
  const n = Number(e == null ? void 0 : e.md), r = Number(t == null ? void 0 : t.md);
  if (!Number.isFinite(n) || !Number.isFinite(r)) return null;
  const o = Math.min(n, r), s = Math.max(n, r);
  return s <= o ? null : { segStart: o, segEnd: s };
}
function Xt(e, t, n) {
  let r = 0, o = 0;
  for (let i = 0; i < e.length; i += 1) {
    const a = e[i], c = Number(a == null ? void 0 : a.from), l = Number(a == null ? void 0 : a.to), u = Number(a == null ? void 0 : a.value);
    if (!Number.isFinite(c) || !Number.isFinite(l) || !Number.isFinite(u) || l <= c) continue;
    const m = Math.max(t, c), d = Math.min(n, l) - m;
    d <= 0 || (r += u * d, o += d);
  }
  if (o <= 0) return null;
  const s = r / o;
  return Number.isFinite(s) ? s : null;
}
function Wt(e, t) {
  if (!Number.isFinite(e)) return new g.Color(Q);
  if (Ze(e, t) < 0) return new g.Color(Q);
  const r = Ht(e, t, Q);
  return new g.Color(r);
}
function Zt(e = {}) {
  return {
    preserveView: !!e.preserveView,
    assayIntervalsByHole: e.assayIntervalsByHole || null,
    selectedAssayVariable: e.selectedAssayVariable || ""
  };
}
function Kt(e, t) {
  if (!e || !t) return [];
  const n = [];
  return Object.values(e).forEach((r) => {
    (r || []).forEach((o) => {
      const s = Number(o == null ? void 0 : o.value);
      Number.isFinite(s) && n.push(s);
    });
  }), n;
}
function Ae(e) {
  return {
    holeId: e.id,
    project: e.project
  };
}
class jn {
  constructor() {
    this.container = null, this.scene = null, this.camera = null, this.renderer = null, this.controls = null, this.flyControls = null, this.gizmo = null, this.blocks = [], this.drillLines = [], this.drillMeshes = [], this.frameId = null, this.clock = new g.Clock(), this.handleCanvasClick = null, this.raycaster = new g.Raycaster(), this.pointer = new g.Vector2(), this.drillholeClickHandler = null, this.controlMode = "orbit", this._tmpDir = new g.Vector3(), this.viewChangeHandler = null, this._lastViewSignature = "", this._lastViewEmitMs = 0;
  }
  init(t) {
    if (!t) return;
    this.container = t;
    const n = t.clientWidth, r = t.clientHeight;
    this.scene = new g.Scene(), this.scene.background = new g.Color(16777215), this.camera = new g.PerspectiveCamera(28, n / r, 1e-3, 1e5), this.camera.up.set(0, 0, 1), this.camera.position.set(50, 50, 50), this.camera.lookAt(0, 0, 0), this.renderer = new g.WebGLRenderer({ antialias: !0 }), this.renderer.setSize(n, r), this.renderer.setPixelRatio(window.devicePixelRatio), this.renderer.autoClear = !1, t.appendChild(this.renderer.domElement);
    const o = new g.AmbientLight(16777215, 0.5);
    this.scene.add(o);
    const s = new g.DirectionalLight(16777215, 0.6);
    s.position.set(10, 10, 5), this.scene.add(s);
    const i = new g.AxesHelper(20);
    this.scene.add(i), this.controls = new ot(this.camera, this.renderer.domElement), this.controls.enableDamping = !1, this.controls.screenSpacePanning = !0, this.controls.enableZoom = !0, this.controls.zoomSpeed = 1.2, this.controls.minDistance = 3e-3, this.controls.maxDistance = 4e4, this.controls.mouseButtons = {
      LEFT: g.MOUSE.PAN,
      MIDDLE: g.MOUSE.DOLLY,
      RIGHT: g.MOUSE.ROTATE
    }, this.controls.touches = {
      ONE: g.TOUCH.ROTATE,
      TWO: g.TOUCH.PAN
    }, this.controls.maxPolarAngle = Math.PI, this.flyControls = new it(this.camera, this.renderer.domElement), this.flyControls.movementSpeed = 2e3, this.flyControls.rollSpeed = Math.PI / 12, this.flyControls.dragToLook = !0, this.flyControls.enabled = !1, this.gizmo = new st(this.camera, this.renderer, {
      container: this.container,
      placement: "top-right",
      size: 110,
      offset: { top: 12, right: 12 },
      animated: !0,
      speed: 1.5
    }), this.gizmo.attachControls(this.controls), this._attachCanvasClickHandler();
    const a = () => {
      var l;
      this.frameId = requestAnimationFrame(a);
      const c = this.clock.getDelta();
      this.renderer.clear(), this.controlMode === "fly" && ((l = this.flyControls) != null && l.enabled) ? this.flyControls.update(c) : this.controls && this.controls.update(), this._emitViewChangeIfNeeded(), this.renderer.render(this.scene, this.camera), this.gizmo && this.gizmo.render();
    };
    a();
  }
  setViewChangeHandler(t) {
    this.viewChangeHandler = typeof t == "function" ? t : null;
  }
  getViewState() {
    return Qe(this);
  }
  setViewState(t) {
    return wt(this, t);
  }
  _buildViewSignature(t) {
    return Oe(t);
  }
  _emitViewChangeIfNeeded() {
    $t(this);
  }
  _attachCanvasClickHandler() {
    const t = this.renderer;
    t && (this.handleCanvasClick = (n) => {
      var u, m, f, d;
      if (n.button !== 0) return;
      if ((u = this.gizmo) != null && u.domElement) {
        const p = this.gizmo.domElement.getBoundingClientRect();
        if (n.clientX >= p.left && n.clientX <= p.right && n.clientY >= p.top && n.clientY <= p.bottom)
          return;
      }
      const r = t.domElement.getBoundingClientRect(), o = n.clientX - r.left, s = n.clientY - r.top;
      this.pointer.x = o / r.width * 2 - 1, this.pointer.y = -(s / r.height * 2) + 1, this.raycaster.setFromCamera(this.pointer, this.camera);
      const i = this.raycaster.intersectObjects(this.drillMeshes, !0);
      if (i.length === 0) return;
      let a = i[0].object;
      for (; a && a.parent && !((m = a.userData) != null && m.holeId); )
        a = a.parent;
      const c = (f = a == null ? void 0 : a.userData) == null ? void 0 : f.holeId, l = (d = a == null ? void 0 : a.userData) == null ? void 0 : d.project;
      c && this.drillholeClickHandler && this.drillholeClickHandler({ holeId: c, project: l });
    }, t.domElement.addEventListener("click", this.handleCanvasClick));
  }
  resize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const t = this.container.clientWidth, n = this.container.clientHeight;
    this.camera.aspect = t / n, this.camera.updateProjectionMatrix(), this.renderer.setSize(t, n), this.gizmo && this.gizmo.update();
  }
  setBlocks(t, n, r) {
    if (!this.scene || (this._clearBlocks(), !t || !n || !r)) return;
    let o = 1 / 0, s = -1 / 0, i = 1 / 0, a = -1 / 0, c = 1 / 0, l = -1 / 0;
    t.forEach((u) => {
      const {
        center_x: m = 0,
        center_y: f = 0,
        center_z: d = 0,
        size_x: p = 1,
        size_y: y = 1,
        size_z: h = 1
      } = u;
      o = Math.min(o, m - p / 2), s = Math.max(s, m + p / 2), i = Math.min(i, f - y / 2), a = Math.max(a, f + y / 2), c = Math.min(c, d - h / 2), l = Math.max(l, d + h / 2);
      const A = new g.BoxGeometry(p, y, h), O = Mt(u[n], r, g), F = new g.MeshStandardMaterial({
        color: O,
        transparent: !0,
        opacity: 0.7,
        side: g.DoubleSide
      }), D = new g.Mesh(A, F);
      D.position.set(m, f, d), this.scene.add(D), this.blocks.push(D);
    }), this.camera && this.controls && (this.lastBounds = { minX: o, maxX: s, minY: i, maxY: a, minZ: c, maxZ: l }, Me(this, { minX: o, maxX: s, minY: i, maxY: a, minZ: c, maxZ: l }));
  }
  setDrillholes(t, n = {}) {
    if (!this.scene || (this._clearDrillholes(), !t || t.length === 0)) return;
    const { preserveView: r, assayIntervalsByHole: o, selectedAssayVariable: s } = Zt(n), i = Kt(o, s), a = St(i);
    let c = 1 / 0, l = -1 / 0, u = 1 / 0, m = -1 / 0, f = 1 / 0, d = -1 / 0;
    const p = new g.Vector3(), y = new g.Vector3(0, 1, 0);
    t.forEach((h, A) => {
      const F = A * 137.5 % 360 / 360, D = new g.Color().setHSL(F, 0.75, 0.55), R = (h.points || []).map((N) => {
        c = Math.min(c, N.x), l = Math.max(l, N.x), u = Math.min(u, N.y), m = Math.max(m, N.y), f = Math.min(f, N.z), d = Math.max(d, N.z);
        const z = new g.Vector3(N.x, N.y, N.z);
        return z.md = N.md, z;
      });
      if (R.length < 2) {
        if (R.length === 1) {
          const N = new g.SphereGeometry(5, 12, 12), z = new g.MeshLambertMaterial({
            color: D,
            emissive: D,
            emissiveIntensity: 0.2
          }), C = new g.Mesh(N, z);
          C.position.copy(R[0]), C.userData = Ae(h), this.scene.add(C), this.drillLines.push(C), this.drillMeshes.push(C);
        }
        return;
      }
      const w = new g.Group();
      w.userData = Ae(h);
      const I = s ? this._resolveAssayIntervalsForHole(h, o) : [];
      for (let N = 0; N < R.length - 1; N += 1) {
        const z = R[N], C = R[N + 1], E = p.subVectors(C, z), b = E.length();
        if (b <= 1e-3) continue;
        const _ = 2.2, M = new g.CylinderGeometry(_, _, b, 6, 1, !1), L = this._getSegmentColor({
          selectedAssayVariable: s,
          assayIntervals: I,
          assayScale: a,
          holeId: h.id,
          segmentIndex: N,
          p1: z,
          p2: C
        }), v = new g.MeshLambertMaterial({
          color: L,
          flatShading: !0,
          emissive: L,
          emissiveIntensity: 0.15
        }), T = new g.Mesh(M, v);
        T.position.copy(z.clone().addScaledVector(E, 0.5)), T.quaternion.setFromUnitVectors(y, E.clone().normalize()), T.userData = Ae(h), w.add(T), this.drillMeshes.push(T);
      }
      this.scene.add(w), this.drillLines.push(w);
    }), this.camera && this.controls && (this.lastBounds = { minX: c, maxX: l, minY: u, maxY: m, minZ: f, maxZ: d }, r || Me(this, { minX: c, maxX: l, minY: u, maxY: m, minZ: f, maxZ: d }));
  }
  _getSegmentColor({ selectedAssayVariable: t, assayIntervals: n, assayScale: r, holeId: o, segmentIndex: s, p1: i, p2: a }) {
    if (!t)
      return Qt(o, s);
    if (t === "__HAS_ASSAY__") {
      if (!(n != null && n.length)) return new g.Color(Q);
      const u = Re(i, a);
      return u ? n.some((f) => {
        const d = Number(f == null ? void 0 : f.from), p = Number(f == null ? void 0 : f.to);
        if (!Number.isFinite(d) || !Number.isFinite(p)) return !1;
        const y = Math.max(u.segStart, d);
        return Math.min(u.segEnd, p) > y;
      }) ? new g.Color("#ff8c42") : new g.Color(Q) : new g.Color(Q);
    }
    if (!(n != null && n.length)) return new g.Color(Q);
    const c = Re(i, a);
    if (!c) return new g.Color(Q);
    const l = Xt(n, c.segStart, c.segEnd);
    return Wt(l, r);
  }
  _resolveAssayIntervalsForHole(t, n) {
    if (!n || !t) return [];
    const r = t.id || t.holeId;
    if (!r) return [];
    const o = n[r];
    if (Array.isArray(o) && o.length) return o;
    const s = Jt(r);
    if (s) {
      const i = n[s];
      if (Array.isArray(i) && i.length) return i;
    }
    return [];
  }
  _fitCameraToBounds({ minX: t, maxX: n, minY: r, maxY: o, minZ: s, maxZ: i }) {
    Me(this, { minX: t, maxX: n, minY: r, maxY: o, minZ: s, maxZ: i });
  }
  recenterCameraToOrigin(t = 1e3) {
    jt(this, t);
  }
  lookDown(t = 2e3) {
    Bt(this, t);
  }
  pan(t = 0, n = 0) {
    Ut(this, t, n);
  }
  dolly(t = 1.1) {
    Yt(this, t);
  }
  focusOnLastBounds(t = 1.2) {
    Gt(this, t);
  }
  _clearBlocks() {
    this.blocks.forEach((t) => {
      this.scene.remove(t), t.geometry.dispose(), t.material.dispose();
    }), this.blocks = [];
  }
  _clearDrillholes() {
    this.drillLines.forEach((t) => {
      this.scene.remove(t), t.isGroup ? t.traverse((n) => {
        n.isMesh && (n.geometry.dispose(), n.material.dispose());
      }) : t.isMesh && (t.geometry.dispose(), t.material.dispose());
    }), this.drillLines = [], this.drillMeshes = [];
  }
  dispose() {
    this.frameId && cancelAnimationFrame(this.frameId), this.renderer && this.handleCanvasClick && this.renderer.domElement.removeEventListener("click", this.handleCanvasClick), this.gizmo && (this.gizmo.dispose(), this.gizmo = null), this.viewChangeHandler = null, this._clearBlocks(), this._clearDrillholes(), this.controls && this.controls.dispose(), this.flyControls && this.flyControls.dispose(), this.renderer && (this.renderer.dispose(), this.container && this.renderer.domElement && this.container.removeChild(this.renderer.domElement));
  }
  setDrillholeClickHandler(t) {
    this.drillholeClickHandler = t;
  }
  setControlMode(t = "orbit") {
    qt(this, t);
  }
}
function Jt(e) {
  return `${e ?? ""}`.trim().toLowerCase();
}
function Qt(e, t) {
  const n = `${e ?? ""}:${t ?? 0}`, r = en(n), o = (t ?? 0) % 14 / 14, s = (r * 0.15 + o * 0.85) % 1, i = new g.Color();
  return i.setHSL(s, 1, 0.5), i;
}
function en(e) {
  const t = `${e ?? ""}`;
  let n = 2166136261;
  for (let r = 0; r < t.length; r += 1)
    n ^= t.charCodeAt(r), n = Math.imul(n, 16777619);
  return (n >>> 0) / 4294967295;
}
function Bn({
  controlMode: e = "orbit",
  onToggleFly: t = () => {
  },
  onRecenter: n = () => {
  },
  onLookDown: r = () => {
  },
  onFit: o = () => {
  }
}) {
  return /* @__PURE__ */ ae("div", { className: "baselode-3d-controls", children: [
    /* @__PURE__ */ k("button", { type: "button", className: "ghost-button", onClick: n, children: "Recenter to (0,0,0)" }),
    /* @__PURE__ */ k("button", { type: "button", className: "ghost-button", onClick: r, children: "Look down" }),
    /* @__PURE__ */ k("button", { type: "button", className: "ghost-button", onClick: o, children: "Fit to scene" }),
    /* @__PURE__ */ k("button", { type: "button", className: "ghost-button", onClick: t, children: e === "orbit" ? "Enable fly controls" : "Disable fly controls" })
  ] });
}
export {
  Ft as ASSAY_COLOR_PALETTE_10,
  Be as ASSAY_NON_VALUE_FIELDS,
  j as AZIMUTH,
  dn as BASELODE_DATA_MODEL_DRILL_ASSAY,
  cn as BASELODE_DATA_MODEL_DRILL_COLLAR,
  un as BASELODE_DATA_MODEL_DRILL_SURVEY,
  Bn as Baselode3DControls,
  jn as Baselode3DScene,
  $e as CRS,
  at as DEFAULT_COLUMN_MAP,
  V as DEPTH,
  B as DIP,
  K as EASTING,
  oe as ELEVATION,
  It as ERROR_COLOR,
  $ as FROM,
  x as HOLE_ID,
  q as LATITUDE,
  X as LONGITUDE,
  we as MID,
  J as NORTHING,
  He as NUMERIC_LINE_COLOR,
  At as NUMERIC_MARKER_COLOR,
  Z as PROJECT_ID,
  H as TO,
  Sn as TracePlot,
  $n as annotationsFromIntervals,
  Pn as assembleDataset,
  Mn as attachAssayPositions,
  xn as balancedTangentialDesurvey,
  gt as buildAssayState,
  St as buildEqualRangeColorScale,
  Et as buildIntervalPoints,
  Lt as buildPlotConfig,
  Nn as buildTraces,
  Oe as buildViewSignature,
  Fn as calculatePropertyStats,
  Tn as coerceNumeric,
  Xe as deriveAssayProps,
  _n as desurveyTraces,
  Yt as dolly,
  $t as emitViewChangeIfNeeded,
  Ln as filterByProject,
  Me as fitCameraToBounds,
  Gt as focusOnLastBounds,
  Mt as getColorForValue,
  Ze as getEqualRangeBinIndex,
  Ht as getEqualRangeColor,
  Qe as getViewState,
  Ve as holeHasData,
  wn as intervalsAsTubes,
  Dn as joinAssaysToTraces,
  bn as loadAssayFile,
  yt as loadAssayHole,
  pt as loadAssayMetadata,
  vn as loadAssays,
  In as loadCollars,
  En as loadSurveys,
  De as loadTable,
  hn as logDataInfo,
  fn as logDataWarning,
  Bt as lookDown,
  _t as minimumCurvatureDesurvey,
  yn as normalizeCsvRow,
  fe as normalizeFieldName,
  Ut as pan,
  mt as parseAssayHole,
  pn as parseAssayHoleIds,
  dt as parseAssayHoleIdsWithAssays,
  ft as parseAssaysCSV,
  On as parseBlockModelCSV,
  An as parseDrillholesCSV,
  Cn as parseSurveyCSV,
  gn as pickFirstPresent,
  Hn as planView,
  Vt as projectTraceToSection,
  jt as recenterCameraToOrigin,
  Ge as reorderHoleIds,
  Vn as sectionView,
  Rt as sectionWindow,
  qt as setControlMode,
  wt as setViewState,
  ce as standardizeColumns,
  mn as standardizeRowArray,
  zn as tangentialDesurvey,
  lt as toError,
  Rn as tracesAsSegments,
  kn as useDrillholeTraceGrid,
  P as withDataErrorContext
};
//# sourceMappingURL=baselode.js.map
