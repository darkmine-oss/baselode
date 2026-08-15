/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create as createTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('plotly.js-dist-min', () => ({
  default: {
    react: vi.fn(),
    purge: vi.fn(),
    Plots: { resize: vi.fn() },
  },
}));

import {
  BASELODE_TOOL_UI_TOOL_NAMES,
  createBaselodeAssistantToolRenderer,
  createBaselodeAssistantUiToolkit,
} from '../src/assistant-ui/index.jsx';
import { BaselodeStripLogToolUI } from '../src/tool-ui/BaselodeStripLogToolUI.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function part(overrides = {}) {
  return {
    type: 'tool-call',
    toolCallId: 'call-1',
    toolName: 'baselode_scatter_plot',
    args: {},
    argsText: '{}',
    status: { type: 'complete' },
    addResult: vi.fn(),
    resume: vi.fn(),
    respondToApproval: vi.fn(),
    ...overrides,
  };
}

function render(kind, overrides = {}, options = {}) {
  const Renderer = createBaselodeAssistantToolRenderer(kind, options);
  return renderToStaticMarkup(createElement(Renderer, part(overrides)));
}

describe('assistant-ui Tool UI adapter', () => {
  it('creates a renderer-only backend toolkit with every canonical name', () => {
    const toolkit = createBaselodeAssistantUiToolkit();
    expect(Object.keys(toolkit)).toEqual(Object.values(BASELODE_TOOL_UI_TOOL_NAMES));
    for (const entry of Object.values(toolkit)) {
      expect(entry.type).toBe('backend');
      expect(entry.display).toBe('standalone');
      expect(entry.render).toBeTypeOf('function');
      expect(entry.execute).toBeUndefined();
    }
  });

  it('supports backend aliases and rejects ambiguous names', () => {
    const toolkit = createBaselodeAssistantUiToolkit({
      toolNames: { 'scatter-plot': 'plot_assays' },
      display: 'inline',
    });
    expect(toolkit.plot_assays.display).toBe('inline');
    expect(toolkit.baselode_scatter_plot).toBeUndefined();

    expect(() => createBaselodeAssistantUiToolkit({
      toolNames: { 'scatter-plot': 'baselode_strip_log' },
    })).toThrow('must be unique');
    expect(() => createBaselodeAssistantUiToolkit({
      toolNames: { 'scatter-plot': '  ' },
    })).toThrow('non-empty string');
    expect(() => createBaselodeAssistantUiToolkit({
      toolNames: { scatterplot: 'plot_assays' },
    })).toThrow('Unknown Baselode Tool UI kind');
  });

  it('renders explicit running, incomplete, empty, and invalid states', () => {
    expect(render('scatter-plot', { status: { type: 'running' } }))
      .toContain('data-baselode-tool-state="running"');
    expect(render('scatter-plot', {
      status: { type: 'incomplete', reason: 'cancelled' },
    })).toContain('was cancelled');
    expect(render('scatter-plot', { result: null }))
      .toContain('data-baselode-tool-state="empty"');

    const invalid = render('scatter-plot', {
      result: { id: 'scatter-1', rows: [{}], xProp: '' },
    });
    expect(invalid).toContain('data-baselode-tool-state="invalid"');
    expect(invalid).toContain('Contract details');
    expect(invalid).toContain('xProp');
    expect(invalid).toContain('yProp');
  });

  it('renders a valid tool result and can read a frontend payload from args', () => {
    const result = {
      id: 'scatter-1',
      title: 'Assay relationship',
      rows: [{ au: 1, cu: 2 }],
      xProp: 'au',
      yProp: 'cu',
    };
    const resultMarkup = render('scatter-plot', { result });
    const argsMarkup = render('scatter-plot', { args: result }, { payloadSource: 'args' });
    expect(resultMarkup).toContain('height:480px');
    expect(resultMarkup).not.toContain('data-baselode-tool-state');
    expect(argsMarkup).toContain('height:480px');
    expect(argsMarkup).not.toContain('data-baselode-tool-state');
  });

  it('keeps parsed props and callbacks stable while normalising events', async () => {
    const onEvent = vi.fn();
    const Renderer = createBaselodeAssistantToolRenderer('strip-log', { onEvent });
    const result = {
      id: 'strip-1',
      hole: { id: 'BLDD001', points: [{ from: 0, to: 1, au: 1 }] },
      tracks: [{ id: 'au', property: 'au' }],
    };
    const initialPart = part({
      toolName: 'show_strip_log',
      result,
    });
    let rendered;
    await act(async () => {
      rendered = createTestRenderer(createElement(Renderer, initialPart));
    });
    const initialComponent = rendered.root.findByType(BaselodeStripLogToolUI);
    const initialHole = initialComponent.props.hole;
    const initialCallback = initialComponent.props.onPropertyChange;

    initialCallback({
      trackId: 'au',
      property: 'cu',
      displayType: 'numeric',
      chartType: 'line',
    });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'property-change',
      kind: 'strip-log',
      toolName: 'show_strip_log',
      toolCallId: 'call-1',
    }));

    await act(async () => {
      rendered.update(createElement(Renderer, part({
        toolName: 'show_strip_log',
        result,
        artifact: { refreshed: true },
      })));
    });
    const updatedComponent = rendered.root.findByType(BaselodeStripLogToolUI);
    expect(updatedComponent.props.hole).toBe(initialHole);
    expect(updatedComponent.props.onPropertyChange).toBe(initialCallback);

    await act(async () => rendered.unmount());
  });

  it('allows applications to replace status rendering', () => {
    expect(render('histogram-plot', { status: { type: 'running' } }, {
      renderState: ({ state }) => createElement('span', null, `custom-${state}`),
    })).toContain('custom-running');
  });
});
