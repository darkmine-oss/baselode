/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import {
  BaselodeStripLogToolUI,
  Baselode3DSceneToolUI,
  BaselodeScatterPlotToolUI,
  BaselodeHistogramPlotToolUI,
  BaselodeBoxPlotToolUI,
  BaselodeViolinPlotToolUI,
  BaselodeTernaryPlotToolUI,
} from 'baselode/tool-ui';
import 'baselode/tool-ui/style.css';
import './ChatHelpers.css';

// Surface sample rows that an assistant might emit from a database
// query — `surface_sample_type` is the categorical axis the analytics
// ToolUI components colour by.
const SURFACE_SAMPLES = [
  { sample_id: 'GS001', surface_sample_type: 'rock_chip',       Au_ppm: 0.05, Cu_ppm: 142, Zn_ppm: 88,  Pb_ppm: 12  },
  { sample_id: 'GS002', surface_sample_type: 'rock_chip',       Au_ppm: 0.18, Cu_ppm: 320, Zn_ppm: 110, Pb_ppm: 28  },
  { sample_id: 'GS003', surface_sample_type: 'rock_chip',       Au_ppm: 1.42, Cu_ppm: 980, Zn_ppm: 65,  Pb_ppm: 540 },
  { sample_id: 'GS004', surface_sample_type: 'rock_chip',       Au_ppm: 0.62, Cu_ppm: 410, Zn_ppm: 240, Pb_ppm: 75  },
  { sample_id: 'GS005', surface_sample_type: 'rock_chip',       Au_ppm: 2.85, Cu_ppm: 1240, Zn_ppm: 38, Pb_ppm: 880 },
  { sample_id: 'GS006', surface_sample_type: 'stream_sediment', Au_ppm: 0.02, Cu_ppm: 38,  Zn_ppm: 64,  Pb_ppm: 8   },
  { sample_id: 'GS007', surface_sample_type: 'stream_sediment', Au_ppm: 0.06, Cu_ppm: 52,  Zn_ppm: 90,  Pb_ppm: 14  },
  { sample_id: 'GS008', surface_sample_type: 'stream_sediment', Au_ppm: 0.31, Cu_ppm: 96,  Zn_ppm: 140, Pb_ppm: 35  },
  { sample_id: 'GS009', surface_sample_type: 'stream_sediment', Au_ppm: 0.04, Cu_ppm: 41,  Zn_ppm: 72,  Pb_ppm: 11  },
  { sample_id: 'GS010', surface_sample_type: 'soil',            Au_ppm: 0.008, Cu_ppm: 22, Zn_ppm: 48,  Pb_ppm: 6   },
  { sample_id: 'GS011', surface_sample_type: 'soil',            Au_ppm: 0.012, Cu_ppm: 28, Zn_ppm: 55,  Pb_ppm: 9   },
  { sample_id: 'GS012', surface_sample_type: 'soil',            Au_ppm: 0.045, Cu_ppm: 67, Zn_ppm: 92,  Pb_ppm: 23  },
  { sample_id: 'GS013', surface_sample_type: 'soil',            Au_ppm: 0.005, Cu_ppm: 18, Zn_ppm: 42,  Pb_ppm: 4   },
  { sample_id: 'GS014', surface_sample_type: 'outcrop',         Au_ppm: 0.42, Cu_ppm: 540, Zn_ppm: 28,  Pb_ppm: 180 },
  { sample_id: 'GS015', surface_sample_type: 'outcrop',         Au_ppm: 0.95, Cu_ppm: 720, Zn_ppm: 32,  Pb_ppm: 350 },
];

// --- Example data -----------------------------------------------------------
// The Tool UI components are designed to render structured assistant results
// inside a chat conversation. The data below stands in for what a backend
// tool call would emit.

// A single multi-element assay hole: Au / Cu numeric tracks plus a categorical
// lithology track. Units are supplied explicitly through `propertyMeta`.
const ASSAY_HOLE = {
  id: 'BLDD-CHAT-001',
  points: [
    { from: 0, to: 12, Au: 0.03, Cu: 88, lithology: 'SAP' },
    { from: 12, to: 24, Au: 0.07, Cu: 142, lithology: 'SAP' },
    { from: 24, to: 36, Au: 0.21, Cu: 210, lithology: 'CLAY' },
    { from: 36, to: 48, Au: 0.58, Cu: 365, lithology: 'BAS' },
    { from: 48, to: 60, Au: 1.42, Cu: 880, lithology: 'BAS' },
    { from: 60, to: 72, Au: 2.05, Cu: 1240, lithology: 'BAS' },
    { from: 72, to: 84, Au: 0.96, Cu: 540, lithology: 'GRN' },
    { from: 84, to: 96, Au: 0.34, Cu: 198, lithology: 'GRN' },
    { from: 96, to: 108, Au: 0.11, Cu: 96, lithology: 'GRN' },
  ],
};

const ASSAY_PROPERTY_META = {
  Au: { unit: 'ppm', sourceAttribute: 'Au_ppb' },
  Cu: { unit: 'ppm', sourceAttribute: 'Cu_ppm' },
};

// A single-analyte hole that carries per-row unit metadata in the
// `analysis_uom` / `analyte_attribute` columns — rendered with
// `deriveMetaFromRows` so the Tool UI infers the label without a meta map.
const DERIVED_HOLE = {
  id: 'BLDD-CHAT-002',
  points: [
    { from: 0, to: 10, Au: 0.05, analyte_attribute: 'Au_ppb', analysis_uom: 'ppm' },
    { from: 10, to: 20, Au: 0.18, analyte_attribute: 'Au_ppb', analysis_uom: 'ppm' },
    { from: 20, to: 30, Au: 0.74, analyte_attribute: 'Au_ppb', analysis_uom: 'ppm' },
    { from: 30, to: 40, Au: 1.93, analyte_attribute: 'Au_ppb', analysis_uom: 'ppm' },
    { from: 40, to: 50, Au: 0.42, analyte_attribute: 'Au_ppb', analysis_uom: 'ppm' },
  ],
};

// Build a straight desurveyed drillhole for the 3D scene.
function buildSceneHole(id, originX, originY, azimuthDeg, dipDeg, length, step) {
  const az = (azimuthDeg * Math.PI) / 180;
  const dip = (dipDeg * Math.PI) / 180;
  const points = [];
  for (let md = 0; md <= length; md += step) {
    const horizontal = md * Math.cos(dip);
    points.push({
      x: originX + horizontal * Math.sin(az),
      y: originY + horizontal * Math.cos(az),
      z: -md * Math.sin(dip),
      md,
    });
  }
  return { id, points };
}

const SCENE_HOLES = [
  buildSceneHole('BLDD-CHAT-001', 0, 0, 90, 60, 180, 15),
  buildSceneHole('BLDD-CHAT-002', 60, 20, 90, 65, 200, 15),
  buildSceneHole('BLDD-CHAT-003', 120, -10, 90, 55, 160, 15),
];

// --- Mock chat scaffolding --------------------------------------------------

function ChatMessage({ role, children }) {
  const isUser = role === 'user';
  return (
    <div className={`chat-msg chat-msg--${role}`}>
      {!isUser && <div className="chat-avatar chat-avatar--assistant">B</div>}
      <div className={`chat-bubble chat-bubble--${role}`}>{children}</div>
      {isUser && <div className="chat-avatar chat-avatar--user">You</div>}
    </div>
  );
}

function ChatHelpers() {
  return (
    <div className="chat-helpers-container">
      <div className="chat-helpers-header">
        <h1>Chat Helpers</h1>
        <p className="chat-helpers-subtitle">
          A mock assistant conversation showing each Baselode Tool UI rendered
          from structured tool results.
        </p>
      </div>

      <div className="chat-window">
        <ChatMessage role="user">
          Show me the assay strip log for hole BLDD-CHAT-001.
        </ChatMessage>

        <ChatMessage role="assistant">
          <p>
            Here is the strip log for <strong>BLDD-CHAT-001</strong>. Use the
            property selector to switch between Au, Cu and lithology — the unit
            travels with the label.
          </p>
          <div className="chat-tool">
            <BaselodeStripLogToolUI
              id="chat-strip-log-assay"
              title="Assay strip log"
              subtitle="9 intervals · ASSAY"
              hole={ASSAY_HOLE}
              propertyOptions={['Au', 'Cu', 'lithology']}
              propertyMeta={ASSAY_PROPERTY_META}
              allowPropertySelection
              allowChartTypeSelection
              tracks={[
                { id: 'grade', property: 'Au', displayType: 'numeric', chartType: 'markers+line' },
                { id: 'lith', property: 'lithology', displayType: 'categorical', chartType: 'categorical', showLegend: true },
              ]}
            />
          </div>
        </ChatMessage>

        <ChatMessage role="user">
          What about BLDD-CHAT-002? The rows already carry their units.
        </ChatMessage>

        <ChatMessage role="assistant">
          <p>
            BLDD-CHAT-002 ships <code>analysis_uom</code> and{' '}
            <code>analyte_attribute</code> on every row, so{' '}
            <code>deriveMetaFromRows</code> infers <strong>Au (ppm, source:
            Au_ppb)</strong> with no explicit metadata map.
          </p>
          <div className="chat-tool">
            <BaselodeStripLogToolUI
              id="chat-strip-log-derived"
              title="Strip log"
              subtitle="5 intervals · ASSAY"
              hole={DERIVED_HOLE}
              deriveMetaFromRows
              tracks={[
                { id: 'au', property: 'Au', displayType: 'numeric', chartType: 'bar' },
              ]}
            />
          </div>
        </ChatMessage>

        <ChatMessage role="user">Now show those holes in 3D.</ChatMessage>

        <ChatMessage role="assistant">
          <p>
            Here are the three holes desurveyed in a 3D scene. Drag to orbit,
            scroll to zoom.
          </p>
          <div className="chat-tool">
            <Baselode3DSceneToolUI
              id="chat-3d-scene"
              title="Drillhole scene"
              subtitle="3 holes"
              height={460}
              drillholes={{ holes: SCENE_HOLES }}
              camera={{ fitToBounds: true }}
            />
          </div>
        </ChatMessage>

        <ChatMessage role="user">
          I pulled 15 surface samples on the project boundary — can you check
          Au vs Cu and see how the sample types separate?
        </ChatMessage>

        <ChatMessage role="assistant">
          <p>
            Rock chips trend high-grade NE, soils sit at the low corner, and
            stream sediments fall in between — see for yourself. Coloured by
            <code> surface_sample_type</code>; the colour palette cycles
            <code> BASELODE_COLORWAY</code> because no built-in map covers
            sample types.
          </p>
          <div className="chat-tool">
            <BaselodeScatterPlotToolUI
              id="chat-analytics-scatter"
              rows={SURFACE_SAMPLES}
              xProp="Au_ppm"
              yProp="Cu_ppm"
              colorBy="surface_sample_type"
              log={{ x: true, y: true }}
              height={380}
              showModeBar
            />
          </div>
        </ChatMessage>

        <ChatMessage role="user">What does the Au distribution look like per sample type?</ChatMessage>

        <ChatMessage role="assistant">
          <p>
            Histogram and box plot side-by-side. Rock chips and outcrop samples
            sit well above the soil baseline.
          </p>
          <div className="chat-tool">
            <BaselodeHistogramPlotToolUI
              id="chat-analytics-histogram"
              rows={SURFACE_SAMPLES}
              prop="Au_ppm"
              groupBy="surface_sample_type"
              log
              bins={15}
              height={320}
              showModeBar
            />
          </div>
          <div className="chat-tool">
            <BaselodeBoxPlotToolUI
              id="chat-analytics-box"
              rows={SURFACE_SAMPLES}
              prop="Au_ppm"
              groupBy="surface_sample_type"
              log
              height={320}
              showModeBar
            />
          </div>
        </ChatMessage>

        <ChatMessage role="user">Show the shape of Cu by sample type too.</ChatMessage>

        <ChatMessage role="assistant">
          <p>
            Violin shows the density profile — outcrops have a long tail,
            soils cluster tight.
          </p>
          <div className="chat-tool">
            <BaselodeViolinPlotToolUI
              id="chat-analytics-violin"
              rows={SURFACE_SAMPLES}
              prop="Cu_ppm"
              groupBy="surface_sample_type"
              log
              height={340}
              showModeBar
            />
          </div>
        </ChatMessage>

        <ChatMessage role="user">Plot Cu / Pb / Zn as a ternary so we can read the base-metal mix.</ChatMessage>

        <ChatMessage role="assistant">
          <p>
            Plotly normalises each row's three components to 100, so you read
            it as relative proportions of the base metals.
          </p>
          <div className="chat-tool">
            <BaselodeTernaryPlotToolUI
              id="chat-analytics-ternary"
              rows={SURFACE_SAMPLES}
              aProp="Cu_ppm"
              bProp="Pb_ppm"
              cProp="Zn_ppm"
              colorBy="surface_sample_type"
              height={460}
              showModeBar
            />
          </div>
        </ChatMessage>
      </div>
    </div>
  );
}

export default ChatHelpers;
