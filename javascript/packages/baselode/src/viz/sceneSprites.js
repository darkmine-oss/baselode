/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import * as THREE from 'three';

/**
 * Small helpers for screen-constant sprites (labels, pivot marker).  Sprites
 * use `sizeAttenuation: false`, so their scale is expressed in clip units and
 * has to be recomputed from the camera each frame to hold a pixel size.
 */

/**
 * Compute the sprite scale (clip-space units) that renders as `pixels` tall.
 * @param {THREE.Camera} camera
 * @param {number} viewportHeight - CSS pixel height of the viewport
 * @param {number} pixels
 * @returns {number}
 */
export function spriteScaleForPixels(camera, viewportHeight, pixels) {
  if (!camera || !(viewportHeight > 0)) return 0.05;
  if (camera.isOrthographicCamera) {
    return (pixels * ((camera.top - camera.bottom) / (camera.zoom || 1))) / viewportHeight;
  }
  const fov = THREE.MathUtils.degToRad(camera.fov || 28);
  return (pixels * 2 * Math.tan(fov / 2)) / viewportHeight;
}

/**
 * Create a text label sprite from a canvas.
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.fontSize=12]
 * @param {string} [opts.fontFamily]
 * @param {string} [opts.color='#1f2937']
 * @param {string} [opts.background='rgba(255,255,255,0.86)']
 * @param {string} [opts.border='rgba(15,23,42,0.25)']
 * @param {number} [opts.padding=5]
 * @returns {THREE.Sprite|null}
 */
export function createTextSprite(text, opts = {}) {
  if (typeof document === 'undefined') return null;
  const fontSize = opts.fontSize ?? 12;
  const fontFamily = opts.fontFamily || 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const padding = opts.padding ?? 5;
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1) * 1.5;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(String(text));
  const w = Math.ceil(metrics.width + padding * 2);
  const h = Math.ceil(fontSize + padding * 2);
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  ctx.scale(dpr, dpr);
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  if (opts.background !== 'none') {
    ctx.fillStyle = opts.background || 'rgba(255,255,255,0.86)';
    ctx.strokeStyle = opts.border || 'rgba(15,23,42,0.25)';
    ctx.lineWidth = 1;
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 4);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = opts.color || '#1f2937';
  ctx.fillText(String(text), padding, h / 2 + 0.5);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.userData.aspect = w / h;
  sprite.userData.pixelHeight = h;
  sprite.userData.isLabel = true;
  sprite.renderOrder = 1000;
  return sprite;
}

/**
 * Create a crosshair-ring sprite used as the orbit pivot marker.
 * @param {string} [color='#8c2981']
 * @returns {THREE.Sprite|null}
 */
export function createPivotSprite(color = '#8c2981') {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const c = size / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(c, c, 14, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2.5;
  [[c - 30, c, c - 20, c], [c + 20, c, c + 30, c], [c, c - 30, c, c - 20], [c, c + 20, c, c + 30]].forEach(([x1, y1, x2, y2]) => {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  });
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(c, c, 2.5, 0, Math.PI * 2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
  const sprite = new THREE.Sprite(material);
  sprite.userData.aspect = 1;
  sprite.renderOrder = 1001;
  sprite.visible = false;
  return sprite;
}

/**
 * Size a sprite to a pixel height for the current camera.
 */
export function applySpritePixelSize(sprite, camera, viewportHeight, pixels) {
  if (!sprite) return;
  const s = spriteScaleForPixels(camera, viewportHeight, pixels);
  sprite.scale.set(s * (sprite.userData.aspect || 1), s, 1);
}

/**
 * Dispose a sprite's texture and material.
 */
export function disposeSprite(sprite) {
  if (!sprite) return;
  sprite.material?.map?.dispose?.();
  sprite.material?.dispose?.();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
