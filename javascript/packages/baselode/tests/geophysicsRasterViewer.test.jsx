/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { act, create as createTestRenderer } from 'react-test-renderer';
import { BaselodeGeophysicsRasterToolUI } from '../src/tool-ui/BaselodeGeophysicsRasterToolUI.jsx';
import { GeophysicsRasterViewer, resolveGeophysicsView } from '../src/viz/GeophysicsRasterViewer.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const raster = {
  data: [[[0, 10, 20], [30, 40, null]]],
  transform: [25, 0, 500000, 0, -25, 7000000],
  crs: 'EPSG:28351',
  bandNames: ['tmi'],
};

function textOf(node) {
  return node.findAll((child) => typeof child.children?.[0] === 'string')
    .map((child) => child.children.join('')).join(' | ');
}

async function render(element) {
  let renderer;
  await act(async () => {
    renderer = createTestRenderer(element, { createNodeMock: () => ({ getContext: () => null }) });
  });
  return renderer;
}

describe('geophysics raster viewer', () => {
  it('resolves legacy clip ranges and fills defaults', () => {
    expect(resolveGeophysicsView({ clipRange: [1, 5] }).stretch).toEqual({ mode: 'absolute', min: 1, max: 5 });
    expect(resolveGeophysicsView().hillshade).toMatchObject({ enabled: false, zFactor: 'auto' });
  });

  it('renders a static chat view with colour bar and raster summary by default', async () => {
    const renderer = await render(
      <BaselodeGeophysicsRasterToolUI title="TMI" raster={raster} units="nT" stretch={{ mode: 'absolute', min: 0, max: 40 }} />,
    );
    const root = renderer.root;
    expect(root.findAllByType('fieldset')).toHaveLength(0);
    const text = textOf(root);
    expect(text).toContain('TMI');
    expect(text).toContain('Absolute range');
    expect(text).toContain('nT');
    expect(text).toContain('tmi · 3 × 2 cells · EPSG:28351 · cell 25 × 25');
    expect(root.findAll((node) => node.props.className === 'baselode-geophysics-raster__ticks')[0].children
      .map((tick) => tick.children[0])).toEqual(['0', '10', '20', '30', '40']);
  });

  it('applies changed display props to an uncontrolled Tool UI', async () => {
    const renderer = await render(<BaselodeGeophysicsRasterToolUI raster={raster} stretch={{ mode: 'equalize' }} />);
    expect(textOf(renderer.root)).toContain('Histogram equalised');
    await act(async () => renderer.update(
      <BaselodeGeophysicsRasterToolUI raster={raster} stretch={{ mode: 'absolute', min: 0, max: 40 }} />,
    ));
    expect(textOf(renderer.root)).toContain('Absolute range');
  });

  it('opens a valid absolute range for a constant raster', async () => {
    const views = [];
    const renderer = await render(
      <GeophysicsRasterViewer raster={{ data: [[5, 5], [5, 5]] }} value={{}} onViewChange={(view) => views.push(view)} />,
    );
    await act(async () => renderer.root.findAllByType('select')[1].props.onChange({ target: { value: 'absolute' } }));
    const { min, max } = views.at(-1).stretch;
    expect(min).toBeLessThan(5);
    expect(max).toBeGreaterThan(5);
    await act(async () => renderer.update(
      <GeophysicsRasterViewer raster={{ data: [[5, 5], [5, 5]] }} value={views.at(-1)} onViewChange={() => {}} />,
    ));
  });

  it('switches stretch mode through the controls', async () => {
    const views = [];
    const renderer = await render(
      <GeophysicsRasterViewer raster={raster} value={{}} onViewChange={(view) => views.push(view)} />,
    );
    const stretchSelect = renderer.root.findAllByType('select')[1];
    await act(async () => stretchSelect.props.onChange({ target: { value: 'equalize' } }));
    expect(views.at(-1).stretch).toEqual({ mode: 'equalize' });
  });
});
