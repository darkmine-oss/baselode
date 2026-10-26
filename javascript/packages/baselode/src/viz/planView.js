/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Fit a metric, equal-scale X/Y viewport to finite {x, y} points. */
export function fitPlanView(points, width, height, padding = 32) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new Error('Plan-view dimensions must be positive');
  const valid = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!valid.length) return { x: 0, y: 0, scale: 1, width, height };
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of valid) {
    xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
    ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
  }
  const dx = xmax - xmin, dy = ymax - ymin;
  const minimumSpan = Math.max(dx, dy, 1) * 0.01;
  return { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2,
    scale: Math.min(Math.max(width - 2 * padding, 1) / Math.max(dx, minimumSpan),
      Math.max(height - 2 * padding, 1) / Math.max(dy, minimumSpan)), width, height };
}

/** Convert local coordinates to screen pixels, preserving equal X/Y scale. */
export function planToScreen(view, x, y) {
  return { x: view.width / 2 + (x - view.x) * view.scale,
    y: view.height / 2 - (y - view.y) * view.scale };
}

/** Convert screen pixels back to the unchanged local coordinate frame. */
export function screenToPlan(view, x, y) {
  return { x: view.x + (x - view.width / 2) / view.scale,
    y: view.y - (y - view.height / 2) / view.scale };
}

/** Zoom around a screen position without moving the coordinate under it. */
export function zoomPlanView(view, factor, x = view.width / 2, y = view.height / 2) {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Zoom factor must be finite and positive');
  const anchor = screenToPlan(view, x, y);
  const scale = Math.max(1e-12, Math.min(1e12, view.scale * factor));
  return { ...view, scale, x: anchor.x - (x - view.width / 2) / scale,
    y: anchor.y + (y - view.height / 2) / scale };
}

/** Pan by a screen-pixel displacement. Does not mutate the input viewport. */
export function panPlanView(view, dx, dy) {
  return { ...view, x: view.x - dx / view.scale, y: view.y + dy / view.scale };
}

function niceStep(span, divisions = 6) {
  const raw = Math.max(span / divisions, 1e-300);
  const power = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / power;
  return (ratio >= 5 ? 5 : ratio >= 2 ? 2 : 1) * power;
}

/**
 * A map-style plan view for local X/Y data with no geographic CRS.
 *
 * Native Canvas rendering; no tiles, projection, geographic coordinates,
 * network access or plotting-library dependency. Increasing Y points upward.
 * Points remain in their original coordinate units. Pan with drag/arrow keys;
 * zoom with wheel, +/− buttons or keys; Home/double-click/fit resets the extent.
 *
 * Options: xProp, yProp, idProp, groupProp, unit, colors, pointRadius,
 * background, ink, gridColor, fontFamily, onPointClick, onViewChange.
 * setPoints(rows, {fit: true}) replaces data; resize(), fitToData(),
 * zoom(factor), getView(), and destroy() support host lifecycle management.
 */
export class PlanView {
  constructor(container, options = {}) {
    if (!container || !container.ownerDocument) throw new Error('PlanView requires a DOM container');
    this.container = container;
    this.options = { xProp: 'x', yProp: 'y', idProp: 'id', groupProp: null,
      unit: 'm', colors: {}, pointRadius: 3, background: '#ffffff', ink: '#1a1c1c',
      gridColor: '#e8e8e8', fontFamily: 'system-ui, sans-serif', ...options };
    this.points = []; this.excludedPoints = 0; this.viewport = null; this.drag = null;
    this.frame = null; this.destroyed = false; this.autoFit = true; this.listeners = [];
    const doc = container.ownerDocument;
    this.originalPosition = container.style.position;
    container.style.position = 'relative';
    this.root = doc.createElement('div');
    this.root.className = 'baselode-plan-view';
    Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: this.options.background });
    this.root.setAttribute('role', 'region'); this.root.setAttribute('aria-label', 'Local X/Y plan view');
    this.canvas = doc.createElement('canvas');
    Object.assign(this.canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' });
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Local coordinates. Drag or arrow keys to pan; plus/minus to zoom; Home to fit data.');
    this.root.append(this.canvas); container.append(this.root);
    this.context = this.canvas.getContext('2d');
    if (!this.context) { this.root.remove(); throw new Error('Canvas 2D is unavailable'); }
    this.tooltip = doc.createElement('div');
    Object.assign(this.tooltip.style, { display: 'none', position: 'absolute', pointerEvents: 'none',
      background: this.options.background, color: this.options.ink, border: '1px solid ' + this.options.ink,
      padding: '7px 10px', font: '12px ' + this.options.fontFamily, whiteSpace: 'pre', zIndex: '3' });
    this.root.append(this.tooltip);
    this.legend = doc.createElement('div');
    Object.assign(this.legend.style, { position: 'absolute', left: '12px', top: '10px', display: 'flex',
      gap: '12px', flexWrap: 'wrap', maxWidth: '65%', font: '11px ' + this.options.fontFamily,
      color: this.options.ink, background: this.options.background, padding: '3px 5px', pointerEvents: 'none' });
    this.root.append(this.legend);
    const controls = doc.createElement('div');
    Object.assign(controls.style, { position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '4px' });
    for (const [label, title, action] of [['+', 'Zoom in', () => this.zoom(1.5)], ['−', 'Zoom out', () => this.zoom(1 / 1.5)], ['Fit', 'Fit all points', () => this.fitToData()]]) {
      const button = doc.createElement('button'); button.textContent = label; button.type = 'button';
      button.title = title; button.setAttribute('aria-label', title);
      Object.assign(button.style, { background: this.options.background, color: this.options.ink,
        border: '1px solid ' + this.options.gridColor, minWidth: '32px', padding: '5px 9px', cursor: 'pointer' });
      button.addEventListener('click', action); controls.append(button);
    }
    this.root.append(controls);
    this.on('wheel', e => {
      e.preventDefault(); const p = this.eventPosition(e);
      this.changeView(zoomPlanView(this.viewport, Math.exp(Math.max(-0.7, Math.min(0.7, -e.deltaY * 0.002))), p.x, p.y));
    }, { passive: false });
    this.on('pointerdown', e => { if (e.button !== 0) return; this.drag = { x: e.clientX, y: e.clientY, moved: false }; this.canvas.setPointerCapture(e.pointerId); this.canvas.style.cursor = 'grabbing'; this.tooltip.style.display = 'none'; });
    this.on('pointermove', e => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.moved ||= Math.abs(dx) + Math.abs(dy) > 1;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        this.changeView(panPlanView(this.viewport, dx, dy));
      } else this.showPoint(e);
    });
    this.on('pointerup', e => {
      if (this.drag && !this.drag.moved && this.options.onPointClick) this.options.onPointClick(this.nearest(this.eventPosition(e))?.row || null);
      this.drag = null; this.canvas.style.cursor = 'grab';
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    });
    this.on('pointercancel', () => { this.drag = null; this.canvas.style.cursor = 'grab'; });
    this.on('pointerleave', () => { this.tooltip.style.display = 'none'; });
    this.on('dblclick', e => { e.preventDefault(); this.fitToData(); });
    this.on('keydown', e => {
      const moves = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] };
      if (moves[e.key]) { e.preventDefault(); this.changeView(panPlanView(this.viewport, ...moves[e.key])); }
      else if (['+', '=', '-', 'Home'].includes(e.key)) { e.preventDefault(); if (e.key === 'Home') this.fitToData(); else this.zoom(e.key === '-' ? 1 / 1.5 : 1.5); }
    });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
  }

  on(name, handler, options) { this.canvas.addEventListener(name, handler, options); this.listeners.push([name, handler, options]); }
  eventPosition(event) { const r = this.canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  changeView(view) { if (!view || this.destroyed) return; this.viewport = view; this.autoFit = false; this.tooltip.style.display = 'none'; this.schedule(); this.options.onViewChange?.(this.getView()); }
  schedule() { if (this.frame != null || this.destroyed) return; this.frame = requestAnimationFrame(() => { this.frame = null; if (!this.destroyed) this.draw(); }); }

  setPoints(rows, { fit = true } = {}) {
    this.points = []; this.excludedPoints = 0;
    for (const row of rows || []) {
      const rawX = row[this.options.xProp], rawY = row[this.options.yProp];
      const x = Number(rawX), y = Number(rawY);
      if (rawX == null || rawY == null || String(rawX).trim() === '' || String(rawY).trim() === '' || !Number.isFinite(x) || !Number.isFinite(y)) { this.excludedPoints++; continue; }
      this.points.push({ x, y, row, group: this.options.groupProp ? String(row[this.options.groupProp] ?? '') : '' });
    }
    const groups = new Map(); for (const p of this.points) groups.set(p.group, (groups.get(p.group) || 0) + 1);
    this.legend.replaceChildren();
    for (const [group, count] of groups) {
      const item = this.container.ownerDocument.createElement('span');
      const dot = this.container.ownerDocument.createElement('span');
      Object.assign(dot.style, { display: 'inline-block', width: '7px', height: '7px', marginRight: '5px', borderRadius: '50%', background: this.options.colors[group] || this.options.ink });
      item.append(dot, this.container.ownerDocument.createTextNode((group || 'Points') + ' · ' + count.toLocaleString())); this.legend.append(item);
    }
    if (fit || !this.viewport) this.fitToData(); else this.schedule();
    return this;
  }

  resize() {
    if (this.destroyed) return;
    const r = this.container.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return;
    this.ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(r.width * this.ratio); this.canvas.height = Math.round(r.height * this.ratio);
    this.width = r.width; this.height = r.height;
    if (this.autoFit || !this.viewport) this.fitToData();
    else { this.viewport = { ...this.viewport, width: this.width, height: this.height }; this.schedule(); }
  }
  fitToData() { if (!this.width || !this.height) return; this.viewport = fitPlanView(this.points, this.width, this.height, 52); this.autoFit = true; this.tooltip.style.display = 'none'; this.schedule(); this.options.onViewChange?.(this.getView()); }
  zoom(factor) { if (this.viewport) this.changeView(zoomPlanView(this.viewport, factor)); }
  getView() { return { ...this.viewport, pointCount: this.points.length, excludedCount: this.excludedPoints, unit: this.options.unit }; }
  nearest(pixel) {
    let nearest = null, distance = 100;
    for (const p of this.points) { const s = planToScreen(this.viewport, p.x, p.y); const d = (s.x - pixel.x) ** 2 + (s.y - pixel.y) ** 2; if (d < distance) { distance = d; nearest = p; } }
    return nearest;
  }
  showPoint(event) {
    if (!this.viewport) return;
    const pixel = this.eventPosition(event), point = this.nearest(pixel);
    if (!point) { this.tooltip.style.display = 'none'; return; }
    this.tooltip.textContent = String(point.row[this.options.idProp] ?? '') + (point.group ? '\n' + point.group : '') + '\nX: ' + point.x.toLocaleString() + '  Y: ' + point.y.toLocaleString() + ' ' + this.options.unit;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = Math.max(4, Math.min(pixel.x + 14, this.width - this.tooltip.offsetWidth - 6)) + 'px';
    this.tooltip.style.top = Math.max(4, Math.min(pixel.y + 14, this.height - this.tooltip.offsetHeight - 6)) + 'px';
  }

  draw() {
    if (!this.viewport || !this.context) return;
    const ctx = this.context, v = this.viewport;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0); ctx.clearRect(0, 0, v.width, v.height);
    ctx.fillStyle = this.options.background; ctx.fillRect(0, 0, v.width, v.height);
    const low = screenToPlan(v, 0, v.height), high = screenToPlan(v, v.width, 0);
    const step = Math.max(niceStep(Math.max(high.x - low.x, high.y - low.y)),
      Number.EPSILON * Math.max(Math.abs(low.x), Math.abs(high.x), Math.abs(low.y), Math.abs(high.y), 1) * 8);
    const format = n => n.toLocaleString(undefined, { maximumFractionDigits: 6 });
    ctx.font = '10px ' + this.options.fontFamily; ctx.lineWidth = 1;
    for (let x = Math.ceil(low.x / step) * step; x <= high.x; x += step) {
      const s = planToScreen(v, x, 0); ctx.strokeStyle = this.options.gridColor; ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, v.height); ctx.stroke();
      ctx.fillStyle = this.options.ink; if (s.x > 35 && s.x < v.width - 90) ctx.fillText(format(x), s.x + 3, v.height - 9);
    }
    for (let y = Math.ceil(low.y / step) * step; y <= high.y; y += step) {
      const s = planToScreen(v, 0, y); ctx.strokeStyle = this.options.gridColor; ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(v.width, s.y); ctx.stroke();
      ctx.fillStyle = this.options.ink; if (s.y > 40 && s.y < v.height - 35) ctx.fillText(format(y), 8, s.y - 4);
    }
    const grouped = new Map(); for (const p of this.points) { if (!grouped.has(p.group)) grouped.set(p.group, []); grouped.get(p.group).push(p); }
    ctx.globalAlpha = 0.78;
    for (const [group, points] of grouped) {
      ctx.fillStyle = this.options.colors[group] || this.options.ink; ctx.beginPath();
      for (const p of points) {
        const s = planToScreen(v, p.x, p.y), radius = typeof this.options.pointRadius === 'function' ? this.options.pointRadius(p.row) : this.options.pointRadius;
        if (s.x < -radius || s.y < -radius || s.x > v.width + radius || s.y > v.height + radius) continue;
        ctx.moveTo(s.x + radius, s.y); ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const length = niceStep(110 / v.scale, 1), pixels = length * v.scale;
    ctx.fillStyle = this.options.background; ctx.fillRect(14, v.height - 58, pixels + 28, 33);
    ctx.strokeStyle = this.options.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(25, v.height - 34); ctx.lineTo(25 + pixels, v.height - 34); ctx.stroke();
    ctx.fillStyle = this.options.ink; ctx.fillText(format(length) + ' ' + this.options.unit, 25, v.height - 42);
    ctx.fillText('X →  Y ↑', v.width - 75, v.height - 12);
    if (!this.points.length) { ctx.textAlign = 'center'; ctx.fillText('No finite X/Y points', v.width / 2, v.height / 2); ctx.textAlign = 'start'; }
  }

  destroy() {
    if (this.destroyed) return; this.destroyed = true;
    this.observer.disconnect(); if (this.frame != null) cancelAnimationFrame(this.frame);
    for (const [name, handler, options] of this.listeners) this.canvas.removeEventListener(name, handler, options);
    this.root.remove(); this.container.style.position = this.originalPosition;
  }
}

/** Create a reusable local plan view. See PlanView for options and lifecycle. */
export function createPlanView(container, options = {}) { return new PlanView(container, options); }
