/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(
  path.resolve(testDir, '../visual-baselines/strip-log-manifest.json'),
  'utf8'
));

const galleryUrl = '/strip-log-gallery?capture=1';
const errorBarSnapshotIds = new Set([
  'standard-numeric-markers',
  'standard-numeric-markers-line',
  'toolui-numeric-markers',
  'toolui-numeric-markers-line',
]);

async function openReadyGallery(page) {
  await page.addInitScript(() => {
    localStorage.setItem('baselode-demo-viewer-theme', 'light');
  });
  await page.goto(galleryUrl);
  await expect(page.locator('[data-snapshot-gallery-ready="true"]')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-snapshot-key] .js-plotly-plot')).toHaveCount(manifest.length, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function prepareSnapshotState(frame, entry) {
  if (entry.family !== 'Standard TracePlot') return;
  await frame.locator('.plot-settings-button').click();
  await expect(frame.locator('.plot-settings-popover')).toBeVisible();
}

test('manifest covers every rendered strip-log snapshot @smoke', async ({ page }) => {
  await openReadyGallery(page);

  const renderedIds = await page.locator('[data-snapshot-key]').evaluateAll((elements) =>
    elements.map((element) => element.dataset.snapshotKey).sort()
  );
  const manifestIds = manifest.map((entry) => entry.id).sort();

  expect(renderedIds).toEqual(manifestIds);
  expect(new Set(manifest.map((entry) => entry.file)).size).toBe(manifest.length);
  await expect(page.locator('[data-snapshot-manifest-covered="true"]')).toBeVisible();
});

test('every strip-log snapshot is rendered and contained @smoke', async ({ page }) => {
  await openReadyGallery(page);

  for (const entry of manifest) {
    const frame = page.locator(`[data-snapshot-key="${entry.id}"]`);
    await expect(frame, `${entry.id} frame`).toHaveCount(1);
    await expect(frame.locator('.js-plotly-plot'), `${entry.id} Plotly render`).toHaveCount(1);
    await frame.scrollIntoViewIfNeeded();
    await prepareSnapshotState(frame, entry);

    const geometry = await frame.evaluate((element) => {
      const plot = element.querySelector('.js-plotly-plot');
      const popover = element.querySelector('.plot-settings-popover');
      const rect = element.getBoundingClientRect();
      const plotRect = plot?.getBoundingClientRect();
      const popoverRect = popover?.getBoundingClientRect();
      return {
        frameWidth: rect.width,
        frameHeight: rect.height,
        plotWidth: plotRect?.width || 0,
        plotHeight: plotRect?.height || 0,
        overflowX: element.scrollWidth - element.clientWidth,
        overflowY: element.scrollHeight - element.clientHeight,
        traces: plot?.querySelectorAll('.trace').length || 0,
        popoverContained: !popoverRect || (
          popoverRect.left >= rect.left - 1
          && popoverRect.right <= rect.right + 1
          && popoverRect.top >= rect.top - 1
          && popoverRect.bottom <= rect.bottom + 1
        ),
      };
    });

    expect(geometry.frameWidth, `${entry.id} frame width`).toBeGreaterThan(280);
    expect(geometry.plotWidth, `${entry.id} plot width`).toBeGreaterThan(240);
    expect(geometry.plotHeight, `${entry.id} plot height`).toBeGreaterThan(300);
    expect(geometry.traces, `${entry.id} visible traces`).toBeGreaterThan(0);
    expect(geometry.overflowX, `${entry.id} horizontal clipping`).toBeLessThanOrEqual(1);
    expect(geometry.overflowY, `${entry.id} vertical clipping`).toBeLessThanOrEqual(1);
    expect(geometry.popoverContained, `${entry.id} settings popover containment`).toBe(true);

    if (errorBarSnapshotIds.has(entry.id)) {
      const errorBars = frame.locator('.errorbars path.yerror');
      expect(await errorBars.count(), `${entry.id} interval error bars`).toBeGreaterThan(0);
      const visibleExtents = await errorBars.evaluateAll((paths) => paths.filter((path) => {
        const box = path.getBoundingClientRect();
        return box.height >= 2 && box.width >= 1;
      }).length);
      expect(visibleExtents, `${entry.id} visible interval error bars`).toBeGreaterThan(0);
    }
  }
});

test('strip-log snapshots match committed baselines @snapshot', async ({ page }) => {
  test.setTimeout(180000);
  await openReadyGallery(page);

  for (const entry of manifest) {
    const frame = page.locator(`[data-snapshot-key="${entry.id}"]`);
    await frame.scrollIntoViewIfNeeded();
    await prepareSnapshotState(frame, entry);
    await expect(frame).toHaveScreenshot(entry.file);
  }
});
