# QAQC UI primitives after Explorer integration

Status: deferred; proposed extraction from Explorer TRK-418. No primitives are implemented by this document.

Explorer first implements the concrete Project chat workflow in `src/components/ChatQaqcTable.web.tsx`, `src/api/projectDrilling.ts` and `src/services/chatMapLayers.ts`. Extract reusable presentation and pure data helpers after the app integration has been validated in deployment.

## Proposed public contract

- `ValidationIssue`: stable issue ID, severity, check ID, stable and displayed hole identity, table, canonical/source row reference, message and optional suggested fix.
- `ValidationCoverage`: engine/check identity and version, input requirements, executed/partial/skipped/failed status, evaluated/excluded counts, reason and severity counts. Zero-finding checks remain visible.
- Controlled `ValidationIssueTable`: columns, rows, full matching count, global severity totals, coverage, filter state, loading/error states; callbacks for filter changes, more rows, full filtered CSV, report selection and hole selection.
- `ValidationSeverityLegend` and accessible severity badges, with theme-overridable colours and text labels.
- Pure `aggregateHoleSeverity`/map-style helpers: stable source IDs, error > warning > info precedence, no implicit inference that unvalidated holes are clean. Accept full filtered aggregates rather than relying on the visible issue page.

Keep project authorization, authenticated downloads, worker/job state, report retention, chat persistence, map camera ownership and API calls in Explorer. Do not introduce assistant-ui, Supabase, Expo or Explorer service imports into Baselode. Check existing JavaScript package export conventions before choosing an optional React entry point; keep pure aggregation separate so non-React consumers do not acquire a UI dependency.

## Extraction sequence

1. Validate the Explorer workflow against a deployed fixture, including a report larger than 10,000 issues and the no-location case.
2. Inventory existing table/legend exports and settle the minimal controlled props contract; avoid expanding a generic table API around one app's backend endpoints.
3. Extract presentation and pure aggregation helpers, documenting installation, exports, styling and accessibility. Provide a deterministic demo with mock async paging and exports.
4. Test independent filter state, zero matches versus zero findings, paging boundaries, stale-response rejection, keyboard interaction, severity precedence, duplicate displayed IDs and missing locations.
5. Publish a versioned Baselode release. Replace Explorer's local presentation with those primitives while keeping the same backend contract and app services.

The follow-up does not add non-WA conversion, laboratory QAQC, automatic repairs or direct database Baselode exports; those are separate capabilities.

Copyright (C) 2026 Darkmine Pty Ltd.
