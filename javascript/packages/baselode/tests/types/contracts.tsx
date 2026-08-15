import type { Toolkit } from '@assistant-ui/react';
import { createElement } from 'react';
import {
  BASELODE_TOOL_UI_CONTRACTS,
  BaselodeScatterPlotToolUI,
  type BaselodeScatterPlotResult,
  type BaselodeToolUiKind,
} from 'baselode/tool-ui';
import {
  BASELODE_TOOL_UI_SCHEMA_CONTRACTS,
  getBaselodeToolUiSchemaContractByToolName,
  parseBaselodeToolUiResult,
  resolveBaselodeToolUiToolNames,
} from 'baselode/tool-ui/contracts';
import {
  type BaselodeAssistantToolEvent,
  createBaselodeAssistantToolRenderer,
  createBaselodeAssistantUiToolkit,
} from 'baselode/assistant-ui';

const result: BaselodeScatterPlotResult = {
  id: 'scatter-1',
  rows: [{ au: 1, cu: 2 }],
  xProp: 'au',
  yProp: 'cu',
};

createElement(BaselodeScatterPlotToolUI, result);

const kind: BaselodeToolUiKind = BASELODE_TOOL_UI_CONTRACTS['scatter-plot'].kind;
const parsed = parseBaselodeToolUiResult(kind, result);
if (parsed.success) {
  parsed.data.xProp.toUpperCase();
}

BASELODE_TOOL_UI_SCHEMA_CONTRACTS['scatter-plot'].schema.parse(result);
getBaselodeToolUiSchemaContractByToolName('baselode_scatter_plot');
resolveBaselodeToolUiToolNames({ 'scatter-plot': 'plot_assays' });

const toolkit: Toolkit = createBaselodeAssistantUiToolkit({
  toolNames: { 'scatter-plot': 'plot_assays' },
  onEvent: (event: BaselodeAssistantToolEvent) => {
    event.kind.toUpperCase();
  },
});
toolkit.plot_assays.render;

createBaselodeAssistantToolRenderer('scatter-plot', { payloadSource: 'result' });
