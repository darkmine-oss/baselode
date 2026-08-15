/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineToolkit } from '@assistant-ui/react';
import { Component, useMemo } from 'react';
import {
  BASELODE_TOOL_UI_CONTRACTS,
  BASELODE_TOOL_UI_KINDS,
  BASELODE_TOOL_UI_TOOL_NAMES,
  getBaselodeToolUiContract,
  isBaselodeToolUiResultEmpty,
  parseBaselodeToolUiResult,
  resolveBaselodeToolUiToolNames,
} from '../tool-ui/contracts.js';

const CALLBACK_EVENT_TYPES = Object.freeze({
  onPropertyChange: 'property-change',
  onTrackChange: 'track-change',
  onIntervalClick: 'interval-click',
  onDepthRangeChange: 'depth-range-change',
});

const DEFAULT_STATE_MESSAGES = Object.freeze({
  running: 'Preparing visualisation…',
  'requires-action': 'Waiting for the tool to continue…',
  incomplete: 'The visualisation tool did not complete.',
  empty: 'The tool returned no visualisation data.',
  invalid: 'The tool returned an invalid visualisation contract.',
  error: 'The visualisation could not be rendered.',
});

function issueSummary(issues) {
  return (issues || []).map((issue) => {
    const path = issue.path?.length ? issue.path.join('.') : 'result';
    return `${path}: ${issue.message}`;
  });
}

export function BaselodeAssistantToolState({ state, message, issues = [] }) {
  const isError = state === 'invalid' || state === 'incomplete' || state === 'error';
  const summaries = issueSummary(issues);
  return (
    <section
      className={`baselode-assistant-tool-state baselode-assistant-tool-state--${state}`}
      data-baselode-tool-state={state}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <p>{message || DEFAULT_STATE_MESSAGES[state] || DEFAULT_STATE_MESSAGES.error}</p>
      {summaries.length > 0 && (
        <details>
          <summary>Contract details</summary>
          <ul>
            {summaries.map((summary) => <li key={summary}>{summary}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

class BaselodeToolErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error, info) {
    this.props.onRenderError?.(error, info);
  }

  render() {
    if (this.state.error) {
      return this.props.renderState({
        state: 'error',
        message: this.state.error?.message || DEFAULT_STATE_MESSAGES.error,
        error: this.state.error,
        issues: [],
      });
    }
    return this.props.children;
  }
}

function renderDefaultState(state) {
  return <BaselodeAssistantToolState {...state} />;
}

function resolveStateRenderer(options) {
  return typeof options.renderState === 'function'
    ? options.renderState
    : renderDefaultState;
}

function eventProps(kind, contract, toolIdentity, options) {
  const configured = options.callbacks?.[kind] || {};
  const props = {};
  for (const callbackName of contract.callbacks) {
    const directCallback = configured[callbackName];
    if (!directCallback && !options.onEvent) continue;
    props[callbackName] = (payload) => {
      directCallback?.(payload);
      options.onEvent?.({
        type: CALLBACK_EVENT_TYPES[callbackName] || callbackName,
        kind,
        toolName: toolIdentity.toolName,
        toolCallId: toolIdentity.toolCallId,
        payload,
      });
    };
  }
  return props;
}

function incompleteMessage(status) {
  if (status?.reason === 'cancelled') return 'The visualisation tool was cancelled.';
  if (status?.reason === 'error' && status.error instanceof Error) {
    return status.error.message;
  }
  return DEFAULT_STATE_MESSAGES.incomplete;
}

export function createBaselodeAssistantToolRenderer(kind, options = {}) {
  const contract = getBaselodeToolUiContract(kind);
  if (!contract) {
    throw new TypeError(`Unknown Baselode Tool UI kind: ${String(kind)}`);
  }
  const payloadSource = options.payloadSource || 'result';
  if (!['result', 'args'].includes(payloadSource)) {
    throw new TypeError(`Unsupported Baselode Tool UI payload source: ${payloadSource}`);
  }
  const renderState = resolveStateRenderer(options);

  function BaselodeAssistantToolRenderer(part) {
    const status = part.status || { type: part.result === undefined ? 'running' : 'complete' };
    const payload = payloadSource === 'args' ? part.args : part.result;
    const shouldParse = status.type === 'complete'
      && !part.isError
      && payload !== undefined
      && payload !== null;
    const parsed = useMemo(
      () => (shouldParse ? parseBaselodeToolUiResult(kind, payload) : null),
      [payload, shouldParse],
    );
    const componentEventProps = useMemo(
      () => eventProps(kind, contract, {
        toolName: part.toolName,
        toolCallId: part.toolCallId,
      }, options),
      [part.toolName, part.toolCallId],
    );

    if (status.type === 'running') {
      return renderState({ state: 'running', issues: [], part });
    }
    if (status.type === 'requires-action') {
      return renderState({ state: 'requires-action', issues: [], part });
    }
    if (status.type === 'incomplete' || part.isError) {
      return renderState({
        state: 'incomplete',
        message: incompleteMessage(status),
        error: status.error,
        issues: [],
        part,
      });
    }

    if (payload === undefined || payload === null) {
      return renderState({ state: 'empty', issues: [], part });
    }

    if (!parsed.success) {
      return renderState({
        state: 'invalid',
        error: parsed.error,
        issues: parsed.error.issues,
        part,
      });
    }
    if (isBaselodeToolUiResultEmpty(kind, parsed.data)) {
      return renderState({ state: 'empty', issues: [], part });
    }

    const component = (
      <contract.Component
        {...parsed.data}
        {...componentEventProps}
      />
    );
    return (
      <BaselodeToolErrorBoundary
        resetKey={payload}
        renderState={renderState}
        onRenderError={options.onRenderError}
      >
        {component}
      </BaselodeToolErrorBoundary>
    );
  }

  BaselodeAssistantToolRenderer.displayName = `BaselodeAssistantToolRenderer(${kind})`;
  return BaselodeAssistantToolRenderer;
}

export function createBaselodeAssistantUiToolkit(options = {}) {
  const toolNames = resolveBaselodeToolUiToolNames(options.toolNames);

  const toolkit = {};
  for (const kind of Object.keys(BASELODE_TOOL_UI_CONTRACTS)) {
    toolkit[toolNames[kind]] = {
      type: 'backend',
      display: options.display || 'standalone',
      render: createBaselodeAssistantToolRenderer(kind, options),
    };
  }
  return defineToolkit(toolkit);
}

export {
  BASELODE_TOOL_UI_KINDS,
  BASELODE_TOOL_UI_TOOL_NAMES,
};
