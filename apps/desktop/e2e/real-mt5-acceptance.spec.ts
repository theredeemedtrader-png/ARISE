import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PythonMt5DemoConnector,
  ReadOnlyMt5AgentServer,
  pythonMt5OptionsFromEnvironment,
} from '@arise/mt5-agent';

const enabled = process.env.ARISE_RUN_REAL_MT5_ACCEPTANCE === '1';
test.skip(!enabled, 'Requires an explicitly authorized real MT5 DEMO terminal');

async function waitForHealthy(page: Page) {
  await expect
    .poll(
      async () => {
        const workspace = await page.evaluate(() => window.arise.getMt5Workspace());
        return `${workspace.connection.state}/${workspace.connection.truth}/${workspace.reconciliation.status}`;
      },
      { timeout: 30_000 },
    )
    .toBe('CONNECTED/VERIFIED/MATCHED');
}

async function reconcile(page: Page) {
  await page.evaluate(() => window.arise.reconcileMt5());
  await waitForHealthy(page);
}

async function executeManagement(
  page: Page,
  input: Readonly<{
    action:
      | 'MOVE_TO_PRICE'
      | 'SET_TP'
      | 'REMOVE_TP'
      | 'PARTIAL_CLOSE'
      | 'FULL_CLOSE';
    config: Readonly<Record<string, unknown>>;
    positionId: string;
    brokerPositionKey: string;
    sequence: number;
  }>,
  expectedStatus: 'VERIFIED' | 'REJECTED' = 'VERIFIED',
) {
  const identity = randomUUID();
  const ruleVersionId = `real-rule-${identity}`;
  const triggerEventId = `real-trigger-${identity}`;
  const proposalId = `real-proposal-${identity}`;
  await page.evaluate(
    async ({ input, ruleVersionId, triggerEventId, proposalId }) => {
      const now = new Date().toISOString();
      await window.arise.createProtectionRule({
        id: ruleVersionId,
        ruleId: `rule-${ruleVersionId}`,
        version: 1,
        triggerType: 'MANUAL',
        actionType: input.action,
        scope: 'THIS_POSITION',
        config: input.config,
        createdAt: now,
        supersedesId: null,
      });
      await window.arise.recordProtectionTrigger({
        id: triggerEventId,
        ruleVersionId,
        sourceType: 'MANUAL',
        sourceId: 'real-mt5-demo-acceptance',
        payload: { acceptance: true },
        occurredAt: now,
        correlationId: proposalId,
      });
      await window.arise.executeProtectionProposal({
        mode: 'DEMO',
        proposal: {
          proposalId,
          ruleVersionId,
          triggerEventId,
          positionId: input.positionId,
          brokerPositionKey: input.brokerPositionKey,
          action: input.action,
          requestedStop: null,
          requestedTakeProfit: null,
          requestedCloseVolume: null,
          convertToRunner: false,
          sequence: input.sequence,
          createdAt: now,
        },
      });
    },
    { input, ruleVersionId, triggerEventId, proposalId },
  );
  await expect
    .poll(
      async () =>
        page.evaluate(
          async (id) => {
            const workspace = await window.arise.getProtectionWorkspace();
            return String(
              workspace.requests.find((item) => item.id === id)?.status ??
                'MISSING',
            );
          },
          proposalId,
        ),
      { timeout: 30_000 },
    )
    .toBe(expectedStatus);
  return proposalId;
}

test('real Eightcap DEMO runtime entry, restart, protection, and close', async () => {
  test.setTimeout(180_000);
  const connector = new PythonMt5DemoConnector(
    pythonMt5OptionsFromEnvironment(),
  );
  const executeBroker = connector.execute.bind(connector);
  const simulatingResultLoss =
    process.env.ARISE_REAL_SIMULATE_RESULT_LOSS === '1';
  let loseFirstBrokerResult = simulatingResultLoss;
  const exercisingPartialClose =
    process.env.ARISE_REAL_PARTIAL_CLOSE === '1';
  const exercisingColony = process.env.ARISE_REAL_COLONY === '1';
  const exercisingManagementMatrix =
    process.env.ARISE_REAL_MANAGEMENT_MATRIX === '1';
  connector.execute = (command) => {
    const startedAt = Date.now();
    const result = executeBroker(command);
    console.log(
      `REAL_MT5_AGENT_EXECUTION=${JSON.stringify({
        commandId: command.commandId,
        elapsedMs: Date.now() - startedAt,
        payloads: result.payloads,
      })}`,
    );
    if (loseFirstBrokerResult) {
      loseFirstBrokerResult = false;
      return { payloads: result.payloads, disconnectAfter: 0 };
    }
    return result;
  };
  let probe = connector.acceptanceProbe();
  const expectedPrefix = process.env.ARISE_EXPECTED_ACCOUNT_PREFIX;
  expect(probe.terminalMetadata.server).toBe('Eightcap-Demo');
  expect(probe.terminalMetadata.accountTradeMode).toBe('DEMO');
  expect(probe.terminalMetadata.tradeAllowed).toBe(true);
  expect(probe.terminalMetadata.externalApiDisabled).toBe(false);
  expect(probe.terminalMetadata.accountTradeAllowed).toBe(true);
  expect(probe.terminalMetadata.accountTradeExpert).toBe(true);
  expect(probe.snapshot.account?.isLive).toBe(false);
  expect(probe.snapshot.account?.hedging).toBe(true);
  if (expectedPrefix)
    expect(probe.snapshot.account?.accountKey.startsWith(expectedPrefix)).toBe(
      true,
    );
  expect(probe.snapshot.positions).toHaveLength(0);
  expect(probe.snapshot.pendingOrders).toHaveLength(0);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const quote = probe.snapshot.quotes[0];
    const age = quote ? Date.now() - Date.parse(quote.receivedAt) : Infinity;
    if (age >= -1_000 && age <= 5_000) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
    probe = connector.acceptanceProbe();
  }
  const freshQuote = probe.snapshot.quotes[0];
  expect(freshQuote).toBeDefined();
  expect(Date.now() - Date.parse(freshQuote!.receivedAt)).toBeLessThanOrEqual(
    5_000,
  );

  const agent = new ReadOnlyMt5AgentServer({
    mode: 'MT5_DEMO',
    demoBroker: connector,
    snapshot: () => connector.snapshot(),
    terminalConnected: () => connector.terminalConnected(),
  });
  const address = await agent.start();
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-real-mt5-'));
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        ARISE_MT5_ENDPOINT: `${address.host}:${address.port}`,
      },
    });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  let page: Page | undefined;
  const observed: Record<string, unknown> = {};
  try {
    app = await launch();
    page = await app.firstWindow();
    await waitForHealthy(page);
    const preflight = await page.evaluate(() => window.arise.getMt5Workspace());
    expect(preflight.connection.transportMode).toBe('MT5_DEMO');
    expect(preflight.connection.terminalConnected).toBe(true);
    expect(preflight.account?.isLive).toBe(false);
    expect(preflight.positions).toHaveLength(0);
    expect(preflight.pendingOrders).toHaveLength(0);

    await reconcile(page);
    const seeded = await page.evaluate(async (exercisingPartialClose) => {
      const broker = await window.arise.getMt5Workspace();
      const quote = broker.quotes.find(
        (item) => item.canonicalSymbol === 'EURUSD',
      );
      const symbol = broker.symbols.find(
        (item) => item.canonicalSymbol === 'EURUSD',
      );
      if (!quote || !symbol) throw new Error('EURUSD.i broker truth unavailable');
      const spread = (quote.ask - quote.bid) / symbol.pipSize;
      const initialStop = Number((quote.bid - 0.003).toFixed(symbol.digits));
      const colony = await window.arise.createPlanningIdea({
        symbol: 'EURUSD',
        timeframe: 'D',
        direction: 'LONG',
        thesisText: 'Real MT5 DEMO acceptance thesis',
        targetDescription: 'Controlled acceptance target',
        invalidationDescription: 'Acceptance cleanup invalidation',
        primaryTargetMarketObjectVersionId: null,
        invalidationMarketObjectVersionId: null,
      });
      const strategy = await window.arise.createStrategyDefinition({
        name: 'Real MT5 DEMO Price Touch',
        category: 'ENTRY',
        description: 'Controlled real-terminal acceptance detector',
        tags: ['real-mt5-acceptance'],
        automationCapability: 'AUTOMATABLE',
        deploymentStatus: 'DEMO_APPROVED',
        detectorKey: 'price_touch',
        detectorVersion: '1',
        evaluationMode: 'ON_PRICE_UPDATE',
        parameterSchema: {},
      });
      const map = await window.arise.createStrategyMap({
        name: 'Real MT5 DEMO Acceptance Map',
        kind: 'STRATEGY_MAP',
        graph: {
          nodes: [
            {
              id: 'real-gate',
              family: 'STRATEGY',
              label: 'Real quote touch',
              position: { x: 80, y: 80 },
              timeframe: 'M5',
              purposes: ['ENTRY'],
              importance: 'REQUIRED',
              executionMode: 'AUTO',
              strategyVersionId: strategy.versionId,
              parameters: { level: quote.ask, tolerancePips: 1 },
            },
            {
              id: 'real-scout',
              family: 'ACTION',
              label: 'Create controlled Scout',
              position: { x: 330, y: 80 },
              timeframe: 'M5',
              purposes: ['ENTRY'],
              importance: 'REQUIRED',
              executionMode: 'AUTO',
              actionKey: 'create_scout',
              parameters: {
                canonicalSymbol: 'EURUSD',
                direction: 'LONG',
                gearId: 'ACCEPTANCE_MIN',
                lots: exercisingPartialClose
                  ? symbol.minVolume * 2
                  : symbol.minVolume,
                initialStop,
                referencePrice: quote.ask,
                expiresInSeconds: 120,
                maxSpreadPips: Math.max(3, spread + 1),
                stackingEligible: true,
                riskFresh: true,
                sessionPermitted: true,
                newsPermitted: true,
              },
            },
          ],
          edges: [
            {
              id: 'real-gate-scout',
              sourceNodeId: 'real-gate',
              targetNodeId: 'real-scout',
              sourcePort: 'out',
              targetPort: 'in',
            },
          ],
        },
      });
      const runtime = await window.arise.createStrategyRuntime({
        mapId: map.mapId,
        colonyId: colony.colonyId,
        mode: 'DEMO',
      });
      await window.arise.simulateStrategyRuntimeEvent({
        runtimeId: runtime.runtimeId,
        eventType: 'PRICE_UPDATE',
        timeframe: 'M5',
        price: quote.ask,
        spreadPips: spread,
        pipSize: symbol.pipSize,
        candle: null,
        states: {},
      });
      const finished = await window.arise.simulateStrategyRuntimeEvent({
        runtimeId: runtime.runtimeId,
        eventType: 'EVENT',
        timeframe: 'M5',
        price: quote.ask,
        spreadPips: spread,
        pipSize: symbol.pipSize,
        candle: null,
        states: {},
      });
      const proposal = finished.actionProposals[0];
      if (!proposal) throw new Error('Runtime did not emit CREATE_SCOUT');
      const execution = await window.arise.executeActionProposal({
        proposalCorrelationId: proposal.correlationId,
      });
      return {
        colonyId: colony.colonyId,
        ideaVersionId: colony.ideaVersionId,
        strategyVersionId: strategy.versionId,
        mapVersionId: map.versionId,
        mapId: map.mapId,
        runtimeId: runtime.runtimeId,
        proposalCorrelationId: proposal.correlationId,
        planId: String(execution.plans[0]?.id ?? ''),
        validation: execution.validations[0] ?? null,
        initialStop,
        minVolume: symbol.minVolume,
        requestedVolume: exercisingPartialClose
          ? symbol.minVolume * 2
          : symbol.minVolume,
        referencePrice: quote.ask,
        spread,
        pipSize: symbol.pipSize,
      };
    }, exercisingPartialClose);
    expect(
      seeded.planId,
      JSON.stringify(seeded.validation),
    ).not.toBe('');

    await new Promise((resolve) => setTimeout(resolve, 5_000));
    console.log(
      `REAL_MT5_DESKTOP_AFTER_SEND=${JSON.stringify(
        await page.evaluate(async () => ({
          execution: await window.arise.getExecutionWorkspace(),
          broker: await window.arise.getMt5Workspace(),
          protection: await window.arise.getProtectionWorkspace(),
        })),
      )}`,
    );

    await expect
      .poll(
        async () =>
          page!.evaluate(async () => {
            const workspace = await window.arise.getExecutionWorkspace();
            return workspace.lifecycles[0]?.state ?? 'MISSING';
          }),
        { timeout: 45_000 },
      )
      .toBe('ACTIVE');
    await reconcile(page);
    const activeBroker = await page.evaluate(() => window.arise.getMt5Workspace());
    expect(activeBroker.positions).toHaveLength(1);
    const activePosition = activeBroker.positions[0]!;
    expect(activePosition.volume).toBe(seeded.requestedVolume);
    expect(activePosition.stopLoss).not.toBeNull();
    const execution = await page.evaluate(() =>
      window.arise.getExecutionWorkspace(),
    );
    expect(execution.commands).toHaveLength(1);
    expect(execution.commands[0]).toMatchObject({
      status: 'COMPLETED',
      attemptCount: simulatingResultLoss ? 2 : 1,
    });
    expect(execution.lifecycles[0]).toMatchObject({
      state: 'ACTIVE',
      filledVolume: seeded.requestedVolume,
      protectedVolume: seeded.requestedVolume,
    });
    const evidence = await page.evaluate(() => window.arise.getEvidenceWorkspace());
    expect(evidence.events.length).toBeGreaterThan(0);

    observed.entry = {
      ...seeded,
      brokerPositionKey: activePosition.brokerPositionKey,
      brokerVolume: activePosition.volume,
      brokerEntry: activePosition.openPrice,
      brokerStop: activePosition.stopLoss,
      commandId: execution.commands[0]?.commandId,
      idempotencyKey: execution.commands[0]?.idempotencyKey,
      evidenceEventCount: evidence.events.length,
    };

    if (exercisingColony) {
      const second = await page.evaluate(async (input) => {
        const runtime = await window.arise.createStrategyRuntime({
          mapId: input.mapId,
          colonyId: input.colonyId,
          mode: 'DEMO',
        });
        await window.arise.simulateStrategyRuntimeEvent({
          runtimeId: runtime.runtimeId,
          eventType: 'PRICE_UPDATE',
          timeframe: 'M5',
          price: input.referencePrice,
          spreadPips: input.spread,
          pipSize: input.pipSize,
          candle: null,
          states: {},
        });
        const finished = await window.arise.simulateStrategyRuntimeEvent({
          runtimeId: runtime.runtimeId,
          eventType: 'EVENT',
          timeframe: 'M5',
          price: input.referencePrice,
          spreadPips: input.spread,
          pipSize: input.pipSize,
          candle: null,
          states: {},
        });
        const proposal = finished.actionProposals[0];
        if (!proposal) throw new Error('Second Colony runtime did not emit CREATE_SCOUT');
        const execution = await window.arise.executeActionProposal({
          proposalCorrelationId: proposal.correlationId,
        });
        return {
          runtimeId: runtime.runtimeId,
          planId: String(execution.plans[0]?.id ?? ''),
          validation: execution.validations[0] ?? null,
        };
      }, seeded);
      expect(second.planId, JSON.stringify(second.validation)).not.toBe('');
      await expect
        .poll(
          async () =>
            page!.evaluate(async () => {
              const workspace = await window.arise.getExecutionWorkspace();
              return workspace.lifecycles.filter((item) => item.state === 'ACTIVE').length;
            }),
          { timeout: 45_000 },
        )
        .toBe(2);
      await reconcile(page);
      const colony = await page.evaluate(async () => ({
        broker: await window.arise.getMt5Workspace(),
        protection: await window.arise.getProtectionWorkspace(),
      }));
      expect(colony.broker.positions).toHaveLength(2);
      expect(
        colony.protection.positions.filter(
          (item) => item.colony_id === seeded.colonyId,
        ),
      ).toHaveLength(2);
      observed.colony = {
        secondRuntimeId: second.runtimeId,
        secondPlanId: second.planId,
        brokerPositions: colony.broker.positions.map((item) => ({
          key: item.brokerPositionKey,
          volume: item.volume,
          stopLoss: item.stopLoss,
        })),
      };
    }

    await app.close();
    app = undefined;
    page = undefined;
    app = await launch();
    page = await app.firstWindow();
    await waitForHealthy(page);
    const afterRestart = await page.evaluate(async () => ({
      broker: await window.arise.getMt5Workspace(),
      execution: await window.arise.getExecutionWorkspace(),
    }));
    expect(afterRestart.broker.reconciliation.status).toBe('MATCHED');
    expect(afterRestart.broker.positions).toHaveLength(
      exercisingColony ? 2 : 1,
    );
    expect(afterRestart.execution.commands).toHaveLength(
      exercisingColony ? 2 : 1,
    );
    const restartedCommand = afterRestart.execution.commands.find(
      (item) => item.orderPlanId === seeded.planId,
    );
    expect(restartedCommand).toMatchObject({
      status: 'COMPLETED',
      attemptCount: simulatingResultLoss ? 2 : 1,
    });
    observed.restart = {
      brokerPositionKey: afterRestart.broker.positions[0]?.brokerPositionKey,
      volume: afterRestart.broker.positions[0]?.volume,
      stopLoss: afterRestart.broker.positions[0]?.stopLoss,
      executionCommandCount: afterRestart.execution.commands.length,
      commandAttemptCount: restartedCommand?.attemptCount,
    };

    await reconcile(page);
    const facts = await page.evaluate(async () => ({
      broker: await window.arise.getMt5Workspace(),
      protection: await window.arise.getProtectionWorkspace(),
    }));
    const brokerPosition = facts.broker.positions.find(
      (item) => item.brokerPositionKey === activePosition.brokerPositionKey,
    );
    const local = facts.protection.positions.find(
      (item) => item.broker_position_key === activePosition.brokerPositionKey,
    );
    const quote = facts.broker.quotes.find(
      (item) => item.brokerSymbol === brokerPosition?.brokerSymbol,
    );
    const projection = facts.protection.protection.find(
      (item) => item.broker_position_key === activePosition.brokerPositionKey,
    );
    if (!local || !brokerPosition || !quote)
      throw new Error('Restart did not restore controlled Scout facts');
    const improvedStop = Number(
      Math.min(
        quote.bid - 0.001,
        Math.max(
          Number(brokerPosition.stopLoss ?? seeded.initialStop) + 0.0005,
          quote.bid - 0.002,
        ),
      ).toFixed(5),
    );
    const moveRequest = await executeManagement(page, {
      action: 'MOVE_TO_PRICE',
      config: { explicitPrice: improvedStop },
      positionId: String(local.position_id),
      brokerPositionKey: brokerPosition.brokerPositionKey,
      sequence: Number(projection?.last_applied_sequence ?? 0) + 1,
    });
    await reconcile(page);
    const moved = await page.evaluate(() => window.arise.getMt5Workspace());
    const movedPosition = moved.positions.find(
      (item) => item.brokerPositionKey === brokerPosition.brokerPositionKey,
    );
    expect(movedPosition?.stopLoss).toBeCloseTo(improvedStop, 5);
    observed.management = {
      requestId: moveRequest,
      requestedStop: improvedStop,
      actualStop: movedPosition?.stopLoss,
    };

    if (exercisingManagementMatrix) {
      const beforeWorsening = await page.evaluate(() =>
        window.arise.getProtectionWorkspace(),
      );
      const worseningProjection = beforeWorsening.protection.find(
        (item) => item.broker_position_key === brokerPosition.brokerPositionKey,
      );
      const worseningRequest = await executeManagement(
        page,
        {
          action: 'MOVE_TO_PRICE',
          config: { explicitPrice: seeded.initialStop },
          positionId: String(local.position_id),
          brokerPositionKey: brokerPosition.brokerPositionKey,
          sequence: Number(worseningProjection?.last_applied_sequence ?? 0) + 1,
        },
        'REJECTED',
      );
      await reconcile(page);
      const afterWorsening = await page.evaluate(() =>
        window.arise.getMt5Workspace(),
      );
      const unchanged = afterWorsening.positions.find(
        (item) => item.brokerPositionKey === brokerPosition.brokerPositionKey,
      );
      expect(unchanged?.stopLoss).toBeCloseTo(improvedStop, 5);

      const beforeTp = await page.evaluate(() =>
        window.arise.getProtectionWorkspace(),
      );
      const tpProjection = beforeTp.protection.find(
        (item) => item.broker_position_key === brokerPosition.brokerPositionKey,
      );
      const tpQuote = afterWorsening.quotes.find(
        (item) => item.brokerSymbol === brokerPosition.brokerSymbol,
      );
      if (!tpQuote) throw new Error('Fresh quote unavailable for real TP test');
      const takeProfit = Number((tpQuote.ask + 0.003).toFixed(5));
      const setTpRequest = await executeManagement(page, {
        action: 'SET_TP',
        config: { takeProfitPrice: takeProfit },
        positionId: String(local.position_id),
        brokerPositionKey: brokerPosition.brokerPositionKey,
        sequence: Number(tpProjection?.last_applied_sequence ?? 0) + 2,
      });
      await reconcile(page);
      const withTp = await page.evaluate(async () => ({
        broker: await window.arise.getMt5Workspace(),
        protection: await window.arise.getProtectionWorkspace(),
      }));
      expect(
        withTp.broker.positions.find(
          (item) => item.brokerPositionKey === brokerPosition.brokerPositionKey,
        )?.takeProfit,
      ).toBeCloseTo(takeProfit, 5);
      const removeProjection = withTp.protection.protection.find(
        (item) => item.broker_position_key === brokerPosition.brokerPositionKey,
      );
      const removeTpRequest = await executeManagement(page, {
        action: 'REMOVE_TP',
        config: {},
        positionId: String(local.position_id),
        brokerPositionKey: brokerPosition.brokerPositionKey,
        sequence: Number(removeProjection?.last_applied_sequence ?? 0) + 1,
      });
      await reconcile(page);
      const withoutTp = await page.evaluate(() =>
        window.arise.getMt5Workspace(),
      );
      expect(
        withoutTp.positions.find(
          (item) => item.brokerPositionKey === brokerPosition.brokerPositionKey,
        )?.takeProfit,
      ).toBeNull();
      observed.managementMatrix = {
        worseningRequest,
        stopAfterRejectedWorsening: unchanged?.stopLoss,
        setTpRequest,
        takeProfit,
        removeTpRequest,
      };
    }

    if (exercisingPartialClose) {
      const beforePartial = await page.evaluate(() =>
        window.arise.getProtectionWorkspace(),
      );
      const partialProjection = beforePartial.protection.find(
        (item) => item.broker_position_key === brokerPosition.brokerPositionKey,
      );
      const partialRequest = await executeManagement(page, {
        action: 'PARTIAL_CLOSE',
        config: { partialCloseVolume: seeded.minVolume },
        positionId: String(local.position_id),
        brokerPositionKey: brokerPosition.brokerPositionKey,
        sequence: Number(partialProjection?.last_applied_sequence ?? 0) + 1,
      });
      await reconcile(page);
      const afterPartial = await page.evaluate(async () => ({
        broker: await window.arise.getMt5Workspace(),
        protection: await window.arise.getProtectionWorkspace(),
      }));
      expect(afterPartial.broker.positions[0]?.volume).toBe(seeded.minVolume);
      const remainingProjection = afterPartial.protection.protection[0];
      const remainingQuote = afterPartial.broker.quotes.find(
        (item) => item.brokerSymbol === brokerPosition.brokerSymbol,
      );
      if (!remainingQuote)
        throw new Error('Fresh quote unavailable after real partial close');
      const remainingStop = Number(
        Math.min(
          remainingQuote.bid - 0.0005,
          improvedStop + 0.0001,
        ).toFixed(5),
      );
      expect(remainingStop).toBeGreaterThan(improvedStop);
      const remainingStopRequest = await executeManagement(page, {
        action: 'MOVE_TO_PRICE',
        config: { explicitPrice: remainingStop },
        positionId: String(local.position_id),
        brokerPositionKey: brokerPosition.brokerPositionKey,
        sequence: Number(remainingProjection?.last_applied_sequence ?? 0) + 1,
      });
      await reconcile(page);
      const afterRemainingStop = await page.evaluate(() =>
        window.arise.getMt5Workspace(),
      );
      expect(afterRemainingStop.positions[0]).toMatchObject({
        volume: seeded.minVolume,
        stopLoss: remainingStop,
      });
      observed.partialClose = {
        requestId: partialRequest,
        remainingStopRequest,
        remainingVolume: afterRemainingStop.positions[0]?.volume,
        remainingStop: afterRemainingStop.positions[0]?.stopLoss,
      };
    }

    const afterMove = await page.evaluate(() =>
      window.arise.getProtectionWorkspace(),
    );
    const moveProjection = afterMove.protection.find(
      (item) => item.broker_position_key === brokerPosition.brokerPositionKey,
    );
    const closeRequest = await executeManagement(page, {
      action: 'FULL_CLOSE',
      config: {},
      positionId: String(local.position_id),
      brokerPositionKey: brokerPosition.brokerPositionKey,
      sequence: Number(moveProjection?.last_applied_sequence ?? 0) + 1,
    });
    await reconcile(page);
    const closedBroker = await page.evaluate(() => window.arise.getMt5Workspace());
    expect(closedBroker.positions).toHaveLength(exercisingColony ? 1 : 0);
    expect(closedBroker.pendingOrders).toHaveLength(0);
    const closedProtection = await page.evaluate(() =>
      window.arise.getProtectionWorkspace(),
    );
    observed.close = {
      requestId: closeRequest,
      positions: closedBroker.positions.length,
      pendingOrders: closedBroker.pendingOrders.length,
      managementFillCount: closedProtection.managementFills.length,
    };
    if (exercisingColony) {
      const survivor = closedBroker.positions[0]!;
      const survivorLocal = closedProtection.positions.find(
        (item) => item.broker_position_key === survivor.brokerPositionKey,
      );
      const survivorProjection = closedProtection.protection.find(
        (item) => item.broker_position_key === survivor.brokerPositionKey,
      );
      const survivorQuote = closedBroker.quotes.find(
        (item) => item.brokerSymbol === survivor.brokerSymbol,
      );
      if (!survivorLocal || !survivorQuote)
        throw new Error('Remaining Colony Scout facts unavailable');
      const survivorStop = Number(
        Math.min(
          survivorQuote.bid - 0.0005,
          Number(survivor.stopLoss) + 0.0005,
        ).toFixed(5),
      );
      await executeManagement(page, {
        action: 'MOVE_TO_PRICE',
        config: { explicitPrice: survivorStop },
        positionId: String(survivorLocal.position_id),
        brokerPositionKey: survivor.brokerPositionKey,
        sequence: Number(survivorProjection?.last_applied_sequence ?? 0) + 1,
      });
      await reconcile(page);
      const afterSurvivorStop = await page.evaluate(() =>
        window.arise.getProtectionWorkspace(),
      );
      const updatedProjection = afterSurvivorStop.protection.find(
        (item) => item.broker_position_key === survivor.brokerPositionKey,
      );
      await executeManagement(page, {
        action: 'FULL_CLOSE',
        config: {},
        positionId: String(survivorLocal.position_id),
        brokerPositionKey: survivor.brokerPositionKey,
        sequence: Number(updatedProjection?.last_applied_sequence ?? 0) + 1,
      });
      await reconcile(page);
      const finalColonyBroker = await page.evaluate(() =>
        window.arise.getMt5Workspace(),
      );
      expect(finalColonyBroker.positions).toHaveLength(0);
      expect(finalColonyBroker.pendingOrders).toHaveLength(0);
      observed.colony = {
        ...(observed.colony as Record<string, unknown>),
        firstScoutClosedIndependently: true,
        survivorManagedIndependently: true,
        finalPositions: 0,
      };
    }
    console.log(`REAL_MT5_ACCEPTANCE=${JSON.stringify(observed)}`);
  } finally {
    if (page) {
      try {
        await reconcile(page);
        const broker = await page.evaluate(() => window.arise.getMt5Workspace());
        const protection = await page.evaluate(() =>
          window.arise.getProtectionWorkspace(),
        );
        for (const position of broker.positions.filter(
          (item) => item.magic !== 0 && item.comment.startsWith('ARISE:'),
        )) {
          const local = protection.positions.find(
            (item) => item.broker_position_key === position.brokerPositionKey,
          );
          const projection = protection.protection.find(
            (item) => item.broker_position_key === position.brokerPositionKey,
          );
          if (local)
            await executeManagement(page, {
              action: 'FULL_CLOSE',
              config: {},
              positionId: String(local.position_id),
              brokerPositionKey: position.brokerPositionKey,
              sequence: Number(projection?.last_applied_sequence ?? 0) + 1,
            });
        }
        await reconcile(page);
      } catch (error) {
        console.error('REAL MT5 acceptance cleanup failed', error);
      }
    }
    await app?.close();
    await agent.stop();
    await rm(userData, { recursive: true, force: true });
  }
});
