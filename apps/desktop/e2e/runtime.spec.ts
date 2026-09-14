import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('M7 Strategy Runtime evaluates detectors, records safe proposals, and restores exact state across restart', async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-m7-'));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();

    const seeded = await page.evaluate(async () => {
      const colony = await window.arise.createPlanningIdea({
        symbol: 'EURUSD', timeframe: 'D', direction: 'LONG',
        thesisText: 'M7 runtime thesis', targetDescription: 'External liquidity', invalidationDescription: 'Daily invalidation',
        primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null,
      });
      const strategy = await window.arise.createStrategyDefinition({
        name: 'Runtime Price Touch', category: 'ENTRY', description: 'M7 deterministic price touch detector', tags: ['m7'],
        automationCapability: 'AUTOMATABLE', deploymentStatus: 'VALIDATED', detectorKey: 'price_touch', detectorVersion: '1',
        evaluationMode: 'ON_PRICE_UPDATE', parameterSchema: {},
      });
      const map = await window.arise.createStrategyMap({
        name: 'M7 Price Touch to Scout', kind: 'STRATEGY_MAP', graph: {
          nodes: [
            { id: 'touch', family: 'STRATEGY', label: 'Touch 1.1000', position: { x: 80, y: 80 }, timeframe: 'M5', purposes: ['ENTRY'], importance: 'REQUIRED', executionMode: 'AUTO', strategyVersionId: strategy.versionId, parameters: { level: 1.1, tolerancePips: 0 } },
            { id: 'scout', family: 'ACTION', label: 'Create Scout', position: { x: 330, y: 80 }, timeframe: 'M5', purposes: ['ENTRY'], importance: 'REQUIRED', executionMode: 'AUTO', actionKey: 'create_scout', parameters: {} },
          ],
          edges: [{ id: 'touch-to-scout', sourceNodeId: 'touch', targetNodeId: 'scout', sourcePort: 'out', targetPort: 'in' }],
        },
      });
      const runtime = await window.arise.createStrategyRuntime({ mapId: map.mapId, colonyId: colony.colonyId, mode: 'SHADOW' });
      return { colony, strategy, map, runtime };
    });

    expect(seeded.runtime.mode).toBe('SHADOW');
    expect(seeded.runtime.nodes.find((node) => node.graphNodeId === 'touch')?.state).toBe('WATCHING');
    expect(seeded.runtime.nodes.find((node) => node.graphNodeId === 'scout')?.state).toBe('DORMANT');

    const afterTouch = await page.evaluate(async (runtimeId) => window.arise.simulateStrategyRuntimeEvent({
      runtimeId, eventType: 'PRICE_UPDATE', timeframe: 'M5', price: 1.1, spreadPips: 1, pipSize: 0.0001, candle: null, states: {},
    }), seeded.runtime.runtimeId);
    expect(afterTouch.nodes.find((node) => node.graphNodeId === 'touch')?.state).toBe('CONFIRMED');
    expect(afterTouch.nodes.find((node) => node.graphNodeId === 'scout')?.state).toBe('WATCHING');
    expect(afterTouch.evaluations.some((entry) => entry.detectorKey === 'price_touch' && entry.result === 'CONFIRMED')).toBe(true);

    const afterAction = await page.evaluate(async (runtimeId) => window.arise.simulateStrategyRuntimeEvent({
      runtimeId, eventType: 'EVENT', timeframe: 'M5', price: 1.1, spreadPips: 1, pipSize: 0.0001, candle: null, states: {},
    }), seeded.runtime.runtimeId);
    expect(afterAction.nodes.find((node) => node.graphNodeId === 'scout')?.state).toBe('COMPLETED');
    expect(afterAction.actionProposals).toHaveLength(1);
    expect(afterAction.actionProposals[0]?.actionKind).toBe('CREATE_SCOUT');
    expect(afterAction.traces.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Strategy' }).first().click();
    await page.getByRole('button', { name: 'LIVE' }).click();
    await expect(page.getByText('M7 LAB INPUT · NO LIVE FEED')).toBeVisible();
    await expect(page.locator('.strategy-node.runtime-confirmed')).toHaveCount(1);
    await expect(page.locator('.strategy-node.runtime-completed')).toHaveCount(1);
    await page.locator('.strategy-node.runtime-completed').click();
    await expect(page.getByText('Proposal: CREATE_SCOUT · recorded only, never executed in M7.')).toBeVisible();

    const manualRuntime = await page.evaluate(async (colonyId) => {
      const strategy = await window.arise.createStrategyDefinition({
        name: 'Manual Context Gate', category: 'CONTEXT', description: 'Human-confirmed M7 node', tags: ['m7','manual'],
        automationCapability: 'MANUAL', deploymentStatus: 'EXPERIMENTAL', detectorKey: '', detectorVersion: '1',
        evaluationMode: 'MANUAL', parameterSchema: {},
      });
      const map = await window.arise.createStrategyMap({
        name: 'M7 Manual Gate', kind: 'STRATEGY_MAP', graph: {
          nodes: [
            { id: 'manual-gate', family: 'STRATEGY', label: 'Manual Context Gate', position: { x: 80, y: 80 }, timeframe: 'D', purposes: ['HINDSIGHT'], importance: 'REQUIRED', executionMode: 'CONFIRM', strategyVersionId: strategy.versionId, parameters: {} },
            { id: 'manual-notify', family: 'ACTION', label: 'Notify After Manual Gate', position: { x: 330, y: 80 }, timeframe: 'D', purposes: ['HINDSIGHT'], importance: 'REQUIRED', executionMode: 'OBSERVE', actionKey: 'notify', parameters: {} },
          ],
          edges: [{ id: 'manual-gate-to-notify', sourceNodeId: 'manual-gate', targetNodeId: 'manual-notify', sourcePort: 'out', targetPort: 'in' }],
        },
      });
      return window.arise.createStrategyRuntime({ mapId: map.mapId, colonyId, mode: 'OBSERVE' });
    }, seeded.colony.colonyId);

    // The fixture above writes through IPC outside the mounted React workspace.
    // Remount so the runtime selector reads the newly persisted runtime.
    await page.reload();
    await page.getByRole('button', { name: 'Strategy' }).first().click();
    await page.getByRole('button', { name: 'LIVE' }).click();
    await page.getByLabel('Runtime', { exact: true }).selectOption(manualRuntime.runtimeId);
    await page.locator('.strategy-node').filter({ hasText: 'Manual Context Gate' }).click();
    await expect(page.getByText('MANUAL DECISION REQUIRED')).toBeVisible();
    await page.getByRole('button', { name: 'CONFIRM', exact: true }).click();
    await expect(page.locator('.strategy-node').filter({ hasText: 'Manual Context Gate' })).toHaveClass(/runtime-confirmed/);
    await expect(page.locator('.strategy-node').filter({ hasText: 'Notify After Manual Gate' })).toHaveClass(/runtime-watching/);

    await app.close(); app = undefined;
    app = await launch(); page = await app.firstWindow();
    const restored = await page.evaluate(async () => window.arise.getStrategyWorkspace());
    const runtime = restored.runtimes.find((entry) => entry.runtimeId === seeded.runtime.runtimeId);
    expect(runtime?.mapVersionId).toBe(seeded.runtime.mapVersionId);
    expect(runtime?.nodes.find((node) => node.graphNodeId === 'touch')?.state).toBe('CONFIRMED');
    expect(runtime?.nodes.find((node) => node.graphNodeId === 'scout')?.state).toBe('COMPLETED');
    expect(runtime?.actionProposals).toHaveLength(1);
    expect(runtime?.traces.length).toBeGreaterThan(0);
    const restoredManual = restored.runtimes.find((entry) => entry.runtimeId === manualRuntime.runtimeId);
    expect(restoredManual?.nodes.find((node) => node.graphNodeId === 'manual-gate')?.state).toBe('CONFIRMED');
    expect(restoredManual?.nodes.find((node) => node.graphNodeId === 'manual-notify')?.state).toBe('WATCHING');
    expect(restoredManual?.traces.some((entry) => entry.eventType === 'MANUAL_CONFIRM' && entry.details.source === 'USER_MANUAL')).toBe(true);
    expect(restored.liveMarketDataAvailable).toBe(false);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
