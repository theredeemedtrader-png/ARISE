import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('M8 Evidence preserves runtime Decision Trace, exact versions, raster integrity, and regenerated-view identity', async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-m8-'));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const seeded = await page.evaluate(async () => {
      const colony = await window.arise.createPlanningIdea({ symbol: 'EURUSD', timeframe: 'D', direction: 'LONG', thesisText: 'M8 evidence thesis', targetDescription: 'External liquidity', invalidationDescription: 'Daily invalidation', primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null });
      const strategy = await window.arise.createStrategyDefinition({ name: 'Evidence Price Touch', category: 'ENTRY', description: 'M8 Decision Evidence detector', tags: ['m8'], automationCapability: 'AUTOMATABLE', deploymentStatus: 'VALIDATED', detectorKey: 'price_touch', detectorVersion: '1', evaluationMode: 'ON_PRICE_UPDATE', parameterSchema: {} });
      const map = await window.arise.createStrategyMap({ name: 'M8 Evidence Map', kind: 'STRATEGY_MAP', graph: { nodes: [
        { id: 'evidence-touch', family: 'STRATEGY', label: 'Evidence touch', position: { x: 80, y: 80 }, timeframe: 'M5', purposes: ['ENTRY'], importance: 'REQUIRED', executionMode: 'AUTO', strategyVersionId: strategy.versionId, parameters: { level: 1.1, tolerancePips: 0 } },
      ], edges: [] } });
      const runtime = await window.arise.createStrategyRuntime({ mapId: map.mapId, colonyId: colony.colonyId, mode: 'SHADOW' });
      await window.arise.simulateStrategyRuntimeEvent({ runtimeId: runtime.runtimeId, eventType: 'PRICE_UPDATE', timeframe: 'M5', price: 1.1, spreadPips: 1, pipSize: 0.0001, candle: { id: 'm5-candle-1', open: 1.099, high: 1.101, low: 1.098, close: 1.1, openedAt: '2026-09-11T12:00:00.000Z', closedAt: '2026-09-11T12:05:00.000Z' }, states: {} });
      return { colony, strategy, map, runtime };
    });

    await expect.poll(async () => page.evaluate(async () => (await window.arise.getEvidenceWorkspace()).events[0]?.snapshots.length ?? 0)).toBe(1);
    const workspace = await page.evaluate(async () => window.arise.getEvidenceWorkspace());
    const evidence = workspace.events[0]!;
    expect(evidence.eventType).toBe('STRATEGY_CONFIRMATION');
    expect(evidence.decisionTrace?.eventType).toBe('DETECTOR_CONFIRMED');
    expect(evidence.captureState).toBe('CAPTURED');
    expect(evidence.snapshots[0]?.assetIntegrity).toBe('VERIFIED');
    expect(evidence.snapshots[0]?.imageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationType: 'EXACT_IDEA_VERSION', entityVersionId: seeded.colony.ideaVersionId }),
      expect.objectContaining({ relationType: 'EXACT_STRATEGY_MAP_VERSION', entityVersionId: seeded.map.versionId }),
      expect.objectContaining({ relationType: 'EXACT_STRATEGY_VERSION', entityVersionId: seeded.strategy.versionId }),
    ]));
    expect(workspace.executionAvailable).toBe(false);

    await page.getByRole('button', { name: 'Review' }).first().click();
    await page.getByRole('button', { name: 'EVIDENCE', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Evidence + Decision Trace' })).toBeVisible();
    await expect(page.getByText('Evidence touch confirmed').first()).toBeVisible();
    await expect(page.getByAltText('Original evidence for Evidence touch confirmed')).toBeVisible();
    await page.getByRole('button', { name: 'DRILL-DOWN' }).click();
    await expect(page.getByText('EXACT REFERENCES')).toBeVisible();
    await expect(page.getByText('DETECTOR CONFIRMED')).toBeVisible();
    await page.getByRole('button', { name: 'REGENERATE CURRENT VIEW' }).click();
    await expect.poll(async () => page.evaluate(async (id) => (await window.arise.getEvidenceWorkspace()).events.find((item) => item.id === id)?.snapshots.length ?? 0, evidence.id)).toBe(2);
    const regenerated = await page.evaluate(async (id) => (await window.arise.getEvidenceWorkspace()).events.find((item) => item.id === id), evidence.id);
    expect(regenerated?.snapshots.some((snapshot) => snapshot.captureOrigin === 'REGENERATED_VIEW')).toBe(true);
    expect(regenerated?.snapshots.some((snapshot) => snapshot.captureOrigin === 'AUTOMATIC')).toBe(true);

    await app.close(); app = undefined;
    app = await launch(); page = await app.firstWindow();
    const restored = await page.evaluate(async () => window.arise.getEvidenceWorkspace());
    expect(restored.events[0]?.decisionTrace?.eventType).toBe('DETECTOR_CONFIRMED');
    expect(restored.events[0]?.snapshots).toHaveLength(2);
    expect(restored.events[0]?.snapshots.every((snapshot) => snapshot.assetIntegrity === 'VERIFIED')).toBe(true);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
