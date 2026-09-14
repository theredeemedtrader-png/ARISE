# ARISE M4 — Charting, Drawing, Market Objects, and Timeframe Projection

Status: **FREEZE CANDIDATE — Windows validation required**

## 1. Objective completed
M4 turns the frozen M3 Trading workspace into the first real chart workspace while preserving all execution safety gates. The renderer now hosts TradingView Lightweight Charts behind `@arise/charting`, supports persisted semantic Market Objects, immutable geometry revisions, and interactive lower-timeframe candle projection using deterministic offline demo candles.

## 2. Chart boundary
`packages/charting` is the vendor boundary. Domain and persistence code do not import Lightweight Charts. The package exposes ARISE candle/drawing/projection models plus an `AriseChartController`; vendor-specific chart APIs do not leak into domain entities or IPC contracts.

Pinned dependency: `lightweight-charts@5.2.0`.

## 3. Market data in M4
M4 deliberately does **not** introduce a live market-data provider. The chart uses a deterministic synthetic M5 series aggregated to M15/H1/H4/D/W and is visibly marked `DEMO SERIES`.

The synthetic aggregation is presentation/test scaffolding only. Broker/calendar-aware D/W boundaries remain owned by the future canonical TimeframeService/market-data milestone and must not be inferred from this demo implementation.

## 4. Drawing tools
The Trading chart exposes ARISE-owned drawing interactions for LINE, RAY, RECTANGLE, TRENDLINE, POINT, and TEXT. Drawing geometry is converted through vendor-neutral `DrawingGeometry` values before crossing IPC.

The canonical rule is preserved: **drawing tools define geometry; Market Object properties define meaning.**

## 5. Semantic Market Objects
The inspector assigns independent semantic type and role values. Manual drawings create canonical M1 Market Objects through typed preload IPC and persist through the M2 `MarketObjectRepository`.

Objects are owned by the Instrument Master Chart and may carry a timeframe reference. The renderer receives only a schema-validated current-view DTO.

## 6. Immutable revisions
The selected-object inspector includes ±1 pip nudge controls as a narrow M4 proof of revision behavior. A nudge does not mutate historical geometry; it calls the domain `reviseMarketObject` path and appends a new immutable `MarketObjectVersion` through M2 persistence.

## 7. Timeframe projection
Clicking a demo candle exposes valid lower timeframe destinations. `EXPAND TO …` switches to the lower timeframe while drawing the selected source candle's exact demo interval/high-low box. Projection nesting is supported, with `SHOW PARENT CANDLE` walking back one level.

Projection UI state is intentionally session-local in M4. Persisting canonical `TimeframeProjection` records requires real Candle identity and canonical market/calendar boundaries, which are explicitly deferred rather than fabricated from demo data.

## 8. Chart catalog/bootstrap
The main process seeds a small canonical local Instrument/Timeframe catalog when absent (EURUSD, GBPUSD, USDJPY, XAUUSD, NAS100; M5/M15/H1/H4/D/W). This is reference-data bootstrap only; it contains no MT5 broker identifiers.

## 9. IPC/security
Renderer code never reaches SQLite directly. New typed/validated IPC operations are:
- `getChartCatalog`
- `listChartObjects`
- `createChartObject`
- `reviseChartObject`

The preload bridge validates request and response schemas. M0 IPC construction remains compatible because chart repositories are optional at registration time; the production main process supplies them.

## 10. UI integration
The frozen M3 Trading placeholder now hosts the chart workbench, timeframe controls, drawing toolbar, projection controls, Market Object inspector/list, and an explicit execution lock. Market Navigator symbol changes feed the chart workspace.

TradingView attribution is enabled on the chart and a creator notice is visible in the chart stage.

## 11. Safety preserved
No MT5 bridge, broker orders, fills, stops, position management, strategy runtime, detector runtime, or live execution was added. The Trading workspace explicitly remains `EXECUTION LOCKED`.

## 12. Tests added
- `packages/charting/src/model.test.ts`: deterministic demo candles, lower-timeframe ordering, projection interval/range, geometry round-trip.
- `packages/shared/src/chart-ipc.test.ts`: chart catalog/Market Object transport contracts.
- `apps/desktop/e2e/chart.spec.ts`: chart render, canonical catalog, Market Object v1 creation, immutable v2 revision, workspace reload, projection controls, and SQLite persistence across Electron restart.

## 13. Validation completed in this environment
- Targeted strict TypeScript compile of chart controller/model/demo code against the v5 API shape: PASS.
- Pure compiled chart-model smoke test: PASS (336 EURUSD H1 demo bars; geometry and projection checks passed).
- `pnpm` dependency-backed monorepo tests/build/Electron cannot run in this container because registry/network access is unavailable and the clean source intentionally contains no `node_modules`.

## 14. Required Windows freeze gate
From the extracted repo root run:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
pnpm dev
```

Expected Electron E2E count after M4: 3 tests (M0 foundation, M3 shell, M4 chart). Visually verify the Trading workspace renders candlesticks and the chart/inspector are usable.

## 15. Freeze recommendation
Freeze M4 only after the Windows dependency-backed suite is green and the visual chart sanity check passes. If the new dependency lock or Lightweight Charts typings surface a platform/compiler issue, patch M4 only; do not reopen M0–M3 architecture.
