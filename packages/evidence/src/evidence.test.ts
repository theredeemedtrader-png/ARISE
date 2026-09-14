import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvidenceAssetStore, renderEvidenceChartPng } from './asset-store';
import { EvidenceCaptureQueue } from './capture-queue';
import { createEvidenceSnapshot, createEvidenceStageSummary, defaultEvidenceFramingProfile } from './model';
import { buildRuntimeEvidencePlans } from './runtime-evidence';

const now = '2026-09-11T12:00:00.000Z';
let sequence = 0;
const runtimeInput = () => ({
  runtime: { id: 'runtime-1', colonyId: 'colony-1', strategyMapVersionId: 'map-v1' },
  nodes: [{ id: 'node-1', graphNodeId: 'graph-1', state: 'CONFIRMED' }],
  graphNodes: [{ id: 'graph-1', family: 'STRATEGY', label: 'MSS', timeframe: '1H', strategyVersionId: 'strategy-v3' }],
  nodeEvents: [{ id: 'node-event-1', strategyRuntimeId: 'runtime-1', runtimeNodeId: 'node-1', fromState: 'WATCHING', toState: 'CONFIRMED', eventType: 'DETECTOR_CONFIRMED', summary: 'MSS confirmed', occurredAt: now }],
  evaluations: [{ id: 'evaluation-1', runtimeNodeId: 'node-1', strategyVersionId: 'strategy-v3', result: 'CONFIRMED', candleId: 'candle-1', evaluatedAt: now }],
  traces: [{ id: 'trace-1', runtimeNodeId: 'node-1', eventType: 'DETECTOR_CONFIRMED', occurredAt: now }],
  context: { instrumentId: 'instrument-eurusd', timeframe: '1H', candles: [{ id: 'candle-1', open: 1, high: 2, low: 0.5, close: 1.5, openedAt: '2026-09-11T11:00:00.000Z', closedAt: now }], marketObjects: [{ id: 'fvg-1', versionId: 'fvg-v7' }], economicEvents: [{ id: 'nfp-revision-2' }], occurredAt: now },
  ideaVersionId: 'idea-v4',
  ids: { evidenceEvent: () => `evidence-${++sequence}`, evidenceReference: () => `reference-${++sequence}` },
});

describe('M8 immutable Evidence contracts', () => {
  it('derives Decision Evidence from an immutable runtime transition and exact versions', () => {
    const [plan] = buildRuntimeEvidencePlans(runtimeInput());
    expect(plan?.event).toMatchObject({ sourceId: 'node-event-1', eventType: 'STRATEGY_CONFIRMATION', status: 'CONFIRMED', decisionTraceId: 'trace-1', timeframe: '1H' });
    expect(plan?.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationType: 'EXACT_IDEA_VERSION', entityVersionId: 'idea-v4' }),
      expect.objectContaining({ relationType: 'EXACT_STRATEGY_MAP_VERSION', entityVersionId: 'map-v1' }),
      expect.objectContaining({ relationType: 'EXACT_STRATEGY_VERSION', entityVersionId: 'strategy-v3' }),
      expect.objectContaining({ relationType: 'EXACT_MARKET_OBJECT_VERSION', entityVersionId: 'fvg-v7' }),
      expect.objectContaining({ relationType: 'EXACT_ECONOMIC_EVENT_REVISION', entityVersionId: 'nfp-revision-2' }),
    ]));
    expect(plan?.workspaceState.candles[0]?.id).toBe('candle-1');
  });

  it('retains nested projection breadcrumbs and per-node Stage Summary links', () => {
    const plan = buildRuntimeEvidencePlans(runtimeInput())[0]!;
    const snapshot = createEvidenceSnapshot({ id: 'snapshot-1', evidenceEventId: plan.event.id, chartWorkspaceState: { ...plan.workspaceState, projections: [
      { projectionId: 'projection-d-h1', sourceTimeframe: 'D', targetTimeframe: '1H', intervalStart: '2026-09-11T00:00:00.000Z', intervalEnd: '2026-09-12T00:00:00.000Z', sourceCandleId: 'candle-d', parentProjectionId: null },
      { projectionId: 'projection-h1-m5', sourceTimeframe: '1H', targetTimeframe: '5M', intervalStart: '2026-09-11T11:00:00.000Z', intervalEnd: now, sourceCandleId: 'candle-1', parentProjectionId: 'projection-d-h1' },
    ] }, imagePath: 'evidence-1/snapshot-1.png', imageHash: 'a'.repeat(64), capturedAt: now, captureOrigin: 'AUTOMATIC' });
    expect(snapshot.chartWorkspaceState.projections[1]?.parentProjectionId).toBe('projection-d-h1');
    const summary = createEvidenceStageSummary({ id: 'summary-1', strategyRuntimeId: 'runtime-1', timeframe: '1H', title: '1H confirmations', evidenceEventIds: [plan.event.id, 'evidence-other'], createdAt: now });
    expect(summary.evidenceEventIds).toHaveLength(2);
  });

  it('queues capture without blocking and records each failed attempt', async () => {
    const queue = new EvidenceCaptureQueue(2); const failures: number[] = []; let returned = false;
    queue.enqueue({ key: 'event-1', run: async () => { expect(returned).toBe(true); throw new Error('capture unavailable'); }, onFailure: (_error, attempt) => { failures.push(attempt); } });
    returned = true;
    await queue.waitForIdle();
    expect(failures).toEqual([1, 2]);
  });

  it('preserves failed cascades as failed Decision Evidence without mislabeling cancelled descendants', () => {
    const input = runtimeInput();
    const plans = buildRuntimeEvidencePlans({ ...input, nodes: [{ id: 'node-1', graphNodeId: 'graph-1', state: 'FAILED' }, { id: 'node-2', graphNodeId: 'graph-2', state: 'CANCELLED' }], graphNodes: [...input.graphNodes, { id: 'graph-2', family: 'ACTION', label: 'Downstream', timeframe: '1H' }], nodeEvents: [
      { ...input.nodeEvents[0]!, id: 'failure-event', toState: 'FAILED', eventType: 'DETECTOR_FAILED', summary: 'MSS failed' },
      { ...input.nodeEvents[0]!, id: 'cancel-event', runtimeNodeId: 'node-2', toState: 'CANCELLED', eventType: 'UPSTREAM_FAILED', summary: 'Downstream cancelled' },
    ], traces: [{ id: 'failure-trace', runtimeNodeId: 'node-1', eventType: 'DETECTOR_FAILED', occurredAt: now }] });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.event).toMatchObject({ sourceId: 'failure-event', eventType: 'STRATEGY_FAILURE', status: 'FAILED', decisionTraceId: 'failure-trace' });
  });

  it('stores portable original rasters and detects corruption', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'arise-evidence-'));
    try {
      const store = new EvidenceAssetStore(directory);
      const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      const asset = await store.writePng({ eventId: 'event-1', snapshotId: 'snapshot-1', bytes: png });
      expect(asset.relativePath).toBe('event-1/snapshot-1.png');
      expect(asset.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(await store.verify(asset.relativePath, asset.hash)).toBe('VERIFIED');
      await writeFile(path.join(directory, 'event-1', 'snapshot-1.png'), Uint8Array.from([1, 2, 3]));
      expect(await store.verify(asset.relativePath, asset.hash)).toBe('CORRUPT');
      expect(await store.verify('event-1/missing.png', asset.hash)).toBe('MISSING');
      expect(defaultEvidenceFramingProfile.annotationDensity).toBe('STANDARD');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('renders the immutable event-time candles into a valid original PNG raster', () => {
    const state = buildRuntimeEvidencePlans(runtimeInput())[0]!.workspaceState;
    const png = renderEvidenceChartPng(state, 400, 240);
    expect([...png.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10]);
    expect(png.length).toBeGreaterThan(500);
  });
});
