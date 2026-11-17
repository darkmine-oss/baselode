/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import Plotly from 'plotly.js-dist-min';
import TracePlot from '../src/viz/TracePlot.jsx';

vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: vi.fn((target, data, layout) => {
      target.data = data;
      target.layout = { ...layout };
      return Promise.resolve();
    }),
    relayout: vi.fn((target, update) => {
      Object.assign(target.layout, update);
      return Promise.resolve();
    }),
    purge: vi.fn(),
  },
}));

const props = {
  config: { holeId: 'H1', property: 'Au', chartType: 'line' },
  graph: { hole: { id: 'H1' }, points: [{ z: 1, val: 0.1 }, { z: 2, val: 0.2 }] },
  holeOptions: ['H1'],
  propertyOptions: ['Au'],
};

describe('TracePlot container sizing', () => {
  let renderer;
  let body;
  let target;
  let observers;
  let frames;
  let nextFrame;

  beforeEach(() => {
    vi.clearAllMocks();
    body = { clientWidth: 100, clientHeight: 600 };
    target = {};
    observers = [];
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
    vi.stubGlobal('ResizeObserver', class {
      constructor(notify) {
        this.notify = notify;
        observers.push(this);
      }
      observe(element) { this.element = element; }
      disconnect() { this.element = null; }
    });
  });

  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    vi.unstubAllGlobals();
  });

  async function flushSize() {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    });
  }

  async function mount() {
    await act(async () => {
      renderer = create(<TracePlot {...props} />, {
        createNodeMock: ({ props: nodeProps }) => (
          nodeProps.className === 'plot-card__body' ? body : target
        ),
      });
    });
    await flushSize();
  }

  async function resize(width, height) {
    body.clientWidth = width;
    body.clientHeight = height;
    observers.filter((observer) => observer.element === body)
      .forEach((observer) => observer.notify());
    await flushSize();
  }

  it('updates the figure when the surrounding body grows or shrinks', async () => {
    await mount();
    expect(target.layout).toMatchObject({ width: 100, height: 600 });
    const draws = Plotly.react.mock.calls.length;

    // The body is the size authority. A notification from the Plotly div
    // must not be needed to recover from a narrow initial layout.
    await resize(550, 900);
    expect(target.layout).toMatchObject({ width: 550, height: 900 });
    await resize(320, 450);
    expect(target.layout).toMatchObject({ width: 320, height: 450 });
    await resize(320, 700);
    expect(target.layout).toMatchObject({ width: 320, height: 700 });
    expect(Plotly.react).toHaveBeenCalledTimes(draws);
  });

  it('waits for a visible size and recovers after being hidden', async () => {
    body.clientWidth = 0;
    await mount();
    expect(Plotly.react).not.toHaveBeenCalled();
    await resize(500, 600);
    expect(Plotly.react.mock.lastCall[2]).toMatchObject({ width: 500, height: 600 });

    const calls = Plotly.react.mock.calls.length;
    await resize(0, 0);
    expect(Plotly.react).toHaveBeenCalledTimes(calls);
    await resize(600, 800);
    expect(Plotly.react.mock.lastCall[2]).toMatchObject({ width: 600, height: 800 });
  });
});
