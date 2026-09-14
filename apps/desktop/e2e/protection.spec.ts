import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FakeExecutionBroker, ReadOnlyMt5AgentServer } from '@arise/mt5-agent';
import { mt5SnapshotSchema } from '@arise/shared';

test('M11 DEMO protection uses the M10 gateway, verifies broker effect, and restores after restart', async () => {
  test.setTimeout(120_000);
  const stamp = () => new Date().toISOString();
  const broker = new FakeExecutionBroker();
  let activePositionKey: string | null = null;
  const snapshot = () => {
    const current = activePositionKey ? broker.managedPosition(activePositionKey) : null;
    return mt5SnapshotSchema.parse({
      snapshotId: randomUUID(), complete: true, capturedAt: stamp(),
      account: { accountKey: 'fake:demo-m11', broker: 'Fake MT5', server: 'Harness', login: '1011', currency: 'USD', balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, leverage: 100, isLive: false, hedging: true, capturedAt: stamp() },
      symbols: [{ brokerSymbol: 'EURUSD.a', canonicalSymbol: 'EURUSD', digits: 5, tickSize: 0.00001, pipSize: 0.0001, contractSize: 100000, minVolume: 0.01, volumeStep: 0.01, maxVolume: 100, stopsLevel: 5, freezeLevel: 2 }],
      positions: current && activePositionKey ? [{ brokerPositionKey: activePositionKey, brokerSymbol: 'EURUSD.a', direction: 'LONG', volume: current.volume, openPrice: 1.1002, currentPrice: 1.11, stopLoss: current.stop, takeProfit: current.takeProfit, openedAt: stamp(), magic: 1011, comment: 'ARISE automated Scout' }] : [],
      pendingOrders: [], quotes: [{ brokerSymbol: 'EURUSD.a', bid: 1.11, ask: 1.1102, brokerTime: stamp(), receivedAt: stamp(), sequence: 2 }], candles: [], unavailableReason: null,
    });
  };
  const agent = new ReadOnlyMt5AgentServer({ mode: 'FAKE_HARNESS', fakeBroker: broker, terminalConnected: () => true, snapshot });
  const address = await agent.start();
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-m11-protection-'));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, ARISE_MT5_ENDPOINT: `${address.host}:${address.port}` } });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await expect.poll(async () => page.evaluate(async () => (await window.arise.getMt5Workspace()).connection.state)).toBe('CONNECTED');
    const planId = await page.evaluate(async () => {
      const colony = await window.arise.createPlanningIdea({ symbol: 'EURUSD', timeframe: 'D', direction: 'LONG', thesisText: 'M11 protected Colony', targetDescription: 'Semantic target', invalidationDescription: 'Thesis invalidation', primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null });
      const strategy = await window.arise.createStrategyDefinition({ name: 'M11 Scout Entry', category: 'ENTRY', description: 'M11 setup', tags: ['m11'], automationCapability: 'AUTOMATABLE', deploymentStatus: 'DEMO_APPROVED', detectorKey: 'price_touch', detectorVersion: '1', evaluationMode: 'ON_PRICE_UPDATE', parameterSchema: {} });
      const map = await window.arise.createStrategyMap({ name: 'M11 Map', kind: 'STRATEGY_MAP', graph: { nodes: [
        { id: 'gate', family: 'STRATEGY', label: 'Gate', position: { x: 80, y: 80 }, timeframe: 'M5', purposes: ['ENTRY'], importance: 'REQUIRED', executionMode: 'AUTO', strategyVersionId: strategy.versionId, parameters: { level: 1.11, tolerancePips: 0 } },
        { id: 'scout', family: 'ACTION', label: 'Create Scout', position: { x: 330, y: 80 }, timeframe: 'M5', purposes: ['ENTRY'], importance: 'REQUIRED', executionMode: 'AUTO', actionKey: 'create_scout', parameters: { canonicalSymbol: 'EURUSD', direction: 'LONG', gearId: 'GEAR_1', lots: 0.1, initialStop: 1.09, referencePrice: 1.11, expiresInSeconds: 30, maxSpreadPips: 3, stackingEligible: true, riskFresh: true, sessionPermitted: true, newsPermitted: true } },
      ], edges: [{ id: 'edge', sourceNodeId: 'gate', targetNodeId: 'scout', sourcePort: 'out', targetPort: 'in' }] } });
      const runtime = await window.arise.createStrategyRuntime({ mapId: map.mapId, colonyId: colony.colonyId, mode: 'DEMO' });
      await window.arise.simulateStrategyRuntimeEvent({ runtimeId: runtime.runtimeId, eventType: 'PRICE_UPDATE', timeframe: 'M5', price: 1.11, spreadPips: 2, pipSize: 0.0001, candle: null, states: {} });
      const done = await window.arise.simulateStrategyRuntimeEvent({ runtimeId: runtime.runtimeId, eventType: 'EVENT', timeframe: 'M5', price: 1.11, spreadPips: 2, pipSize: 0.0001, candle: null, states: {} });
      const action = done.actionProposals[0];
      if (!action) throw new Error('Expected Scout proposal');
      const execution = await window.arise.executeActionProposal({ proposalCorrelationId: action.correlationId });
      return String(execution.plans[0]?.id ?? '');
    });
    expect(planId).not.toBe('');
    activePositionKey = `position-${planId}`;
    await expect.poll(async () => page.evaluate(async () => (await window.arise.getExecutionWorkspace()).lifecycles[0]?.state)).toBe('ACTIVE');
    await page.evaluate(() => window.arise.reconcileMt5());
    await expect.poll(async () => page.evaluate(async () => (await window.arise.getMt5Workspace()).positions.length)).toBe(1);
    await expect.poll(async () => page.evaluate(async () => (await window.arise.getMt5Workspace()).reconciliation.status)).toBe('MATCHED');
    const result = await page.evaluate(async ({ brokerPositionKey }) => {
      const workspace = await window.arise.getProtectionWorkspace();
      const positionId = String(workspace.positions[0]?.position_id ?? '');
      const now = new Date().toISOString();
      await window.arise.createProtectionRule({ id: 'm11-rule-v1', ruleId: 'm11-rule', version: 1, triggerType: 'MANUAL', actionType: 'MOVE_TO_PRICE_BE', scope: 'THIS_POSITION', config: {}, createdAt: now, supersedesId: null });
      await window.arise.recordProtectionTrigger({ id: 'm11-trigger-1', ruleVersionId: 'm11-rule-v1', sourceType: 'MANUAL', sourceId: 'operator', payload: {}, occurredAt: now, correlationId: 'm11-manual-trigger' });
      return window.arise.executeProtectionProposal({ mode: 'DEMO', proposal: { proposalId: 'm11-request-1', ruleVersionId: 'm11-rule-v1', triggerEventId: 'm11-trigger-1', positionId, brokerPositionKey, action: 'MOVE_TO_PRICE_BE', requestedStop: 1.1, requestedTakeProfit: null, requestedCloseVolume: null, convertToRunner: false, sequence: 1, createdAt: now } });
    }, { brokerPositionKey: activePositionKey });
    expect(result.commands).toHaveLength(1);
    await expect.poll(async () => page.evaluate(async () => String((await window.arise.getProtectionWorkspace()).requests[0]?.status))).toBe('VERIFIED');
    const verified = await page.evaluate(() => window.arise.getProtectionWorkspace());
    expect(verified.protection[0]).toMatchObject({ state: 'PROTECTED', broker_volume: 0.1, protected_volume: 0.1, verified_stop: 1.1002, truth_state: 'VERIFIED' });
    expect(broker.managementEffectCount).toBe(1);
    const shadow = await page.evaluate(async ({ positionId, brokerPositionKey }) => {
      const now = new Date().toISOString();
      await window.arise.createProtectionRule({ id: 'm11-shadow-rule-v1', ruleId: 'm11-shadow-rule', version: 1, triggerType: 'MANUAL', actionType: 'LOCK_PIPS', scope: 'THIS_POSITION', config: { lockPips: 10 }, createdAt: now, supersedesId: null });
      await window.arise.recordProtectionTrigger({ id: 'm11-shadow-trigger', ruleVersionId: 'm11-shadow-rule-v1', sourceType: 'MANUAL', sourceId: 'operator', payload: {}, occurredAt: now, correlationId: 'm11-shadow' });
      return window.arise.executeProtectionProposal({ mode: 'SHADOW', proposal: { proposalId: 'm11-shadow-request', ruleVersionId: 'm11-shadow-rule-v1', triggerEventId: 'm11-shadow-trigger', positionId, brokerPositionKey, action: 'LOCK_PIPS', requestedStop: null, requestedTakeProfit: null, requestedCloseVolume: null, convertToRunner: false, sequence: 2, createdAt: now } });
    }, { positionId: String(verified.positions[0]?.position_id), brokerPositionKey: activePositionKey });
    expect(shadow.requests).toHaveLength(2);
    expect(shadow.requests[1]).toMatchObject({ status: 'SHADOW_COMPLETED' });
    expect(shadow.commands).toHaveLength(1);
    expect(broker.managementEffectCount).toBe(1);

    await app.close();
    app = undefined;
    app = await launch();
    page = await app.firstWindow();
    await expect.poll(async () => page.evaluate(async () => (await window.arise.getMt5Workspace()).reconciliation.status)).toBe('MATCHED');
    const restored = await page.evaluate(() => window.arise.getProtectionWorkspace());
    expect(restored.requests[0]).toMatchObject({ status: 'VERIFIED' });
    expect(restored.requests[1]).toMatchObject({ status: 'SHADOW_COMPLETED' });
    expect(restored.commands[0]).toMatchObject({ status: 'COMPLETED', attempt_count: 1 });
    expect(broker.managementEffectCount).toBe(1);
  } finally {
    await app?.close();
    await agent.stop();
    await rm(userData, { recursive: true, force: true });
  }
});
