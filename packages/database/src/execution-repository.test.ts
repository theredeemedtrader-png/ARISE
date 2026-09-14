import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { ExecutionRepository } from './execution-repository';
import { Mt5Repository } from './mt5-repository';
import {
  createExecutionIntent,
  createOrderPlan,
  validateExecution,
  type ExecutionHealth,
} from '@arise/execution';
import { mt5SnapshotSchema, type Mt5AgentEnvelope } from '@arise/shared';
type FillPayload = Extract<Mt5AgentEnvelope['payload'], { kind: 'FILL' }>;
type ProtectionPayload = Extract<
  Mt5AgentEnvelope['payload'],
  { kind: 'PROTECTION_ATTEMPT' }
>;
const at = '2026-09-11T12:00:00.000Z';
const health: ExecutionHealth = {
  connection: 'CONNECTED',
  truth: 'VERIFIED',
  reconciliation: 'MATCHED',
  terminalConnected: true,
  protocolCompatible: true,
  accountKey: 'demo-1',
  accountIsLive: false,
  sessionId: 'session-1',
  brokerSymbol: 'EURUSD',
  quote: { bid: 1.1, ask: 1.1002, receivedAt: at, sequence: 1 },
  deploymentApproved: true,
  colonyActive: true,
  ideaActive: true,
  attemptBudgetAvailable: true,
  stackingEligible: true,
  riskFresh: true,
  sessionPermitted: true,
  newsPermitted: true,
  spreadPermitted: true,
  instrumentPermitted: true,
  sizePermitted: true,
  stopPermitted: true,
  duplicateAbsent: true,
  executionStateSafe: true,
};
function setup() {
  const connection = openDatabase(':memory:');
  connection.sqlite.pragma('foreign_keys=OFF');
  connection.sqlite
    .prepare(
      "INSERT INTO runtime_action_proposals VALUES ('proposal-1','runtime-1','node-1','graph-1','CREATE_SCOUT','{}','source-1',?)",
    )
    .run(at);
  const repo = new ExecutionRepository(connection.sqlite);
  const intent = createExecutionIntent({
    id: 'intent-1',
    proposalCorrelationId: 'proposal-1',
    strategyRuntimeId: 'runtime-1',
    runtimeNodeId: 'node-1',
    colonyId: 'colony-1',
    ideaVersionId: 'idea-version-1',
    strategyMapVersionId: 'map-version-1',
    mode: 'DEMO',
    canonicalSymbol: 'EURUSD',
    direction: 'LONG',
    gearId: 'gear-1',
    lots: 0.1,
    initialStop: 1.09,
    maxSpreadPips: 2,
    createdAt: at,
    expiresAt: '2026-09-11T12:01:00.000Z',
  });
  const validation = validateExecution(intent, health, 'validation-1', at);
  repo.persistIntentValidation(intent, validation);
  const plan = createOrderPlan({ id: 'plan-1', intent, validation, health });
  repo.persistPlan(plan, {});
  const command = repo.createCommand(plan);
  return { connection, repo, command };
}
const envelope = (
  payload: Mt5AgentEnvelope['payload'],
  messageId: string,
): Mt5AgentEnvelope => ({
  messageId,
  correlationId: 'command-transport',
  schemaVersion: 3,
  sentAt: at,
  payload,
});
const fill = (
  commandId: string,
  eventId: string,
  volume: number,
  cumulativeVolume: number,
  remainingVolume: number,
  price = 1.1,
): FillPayload => ({
  kind: 'FILL',
  eventId,
  commandId,
  orderPlanId: 'plan-1',
  brokerOrderKey: 'order-1',
  brokerPositionKey: 'position-1',
  volume,
  price,
  cumulativeVolume,
  remainingVolume,
  filledAt: at,
});
const protection = (
  commandId: string,
  eventId: string,
  protectedVolume: number,
  actualStop: number | null,
  attempt = 1,
): ProtectionPayload => ({
  kind: 'PROTECTION_ATTEMPT',
  eventId,
  commandId,
  orderPlanId: 'plan-1',
  brokerPositionKey: 'position-1',
  brokerCommandId: `protect-command-${eventId}`,
  idempotencyKey: `order-plan:plan-1:protect:position-1:${protectedVolume}`,
  attempt,
  protectedVolume,
  requestedStop: 1.09,
  actualStop,
  status: actualStop === null ? 'REJECTED' : 'VERIFIED',
  reason: actualStop === null ? 'rejected' : null,
  occurredAt: at,
});
describe('M10 durable execution lifecycle', () => {
  it('does not materialize Position from intent, plan, ACK, or fill before protection verification', () => {
    const { connection, repo, command } = setup();
    expect(
      (
        connection.sqlite
          .prepare('SELECT COUNT(*) count FROM positions')
          .get() as { count: number }
      ).count,
    ).toBe(0);
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'COMMAND_ACK',
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          status: 'ACCEPTED',
          brokerOrderKey: 'order-1',
          reason: null,
        },
        'message-ack',
      ),
    );
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'FILL',
          eventId: 'fill-1',
          commandId: command.commandId,
          orderPlanId: 'plan-1',
          brokerOrderKey: 'order-1',
          brokerPositionKey: 'position-1',
          volume: 0.1,
          price: 1.1002,
          cumulativeVolume: 0.1,
          remainingVolume: 0,
          filledAt: at,
        },
        'message-fill',
      ),
    );
    expect(
      (
        connection.sqlite
          .prepare('SELECT COUNT(*) count FROM positions')
          .get() as { count: number }
      ).count,
    ).toBe(0);
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'PROTECTION_ATTEMPT',
          eventId: 'protect-1',
          commandId: command.commandId,
          orderPlanId: 'plan-1',
          brokerPositionKey: 'position-1',
          brokerCommandId: 'protect-command-1',
          idempotencyKey: 'order-plan:plan-1:protect:position-1:0.1',
          attempt: 1,
          protectedVolume: 0.1,
          requestedStop: 1.09,
          actualStop: 1.09,
          status: 'VERIFIED',
          reason: null,
          occurredAt: at,
        },
        'message-protect',
      ),
    );
    expect(
      connection.sqlite
        .prepare('SELECT current_state state FROM positions')
        .get(),
    ).toEqual({ state: 'SCOUT' });
    connection.sqlite.close();
  });
  it('deduplicates broker events and records stale acknowledgements without applying them', () => {
    const { connection, repo, command } = setup();
    const fill = envelope(
      {
        kind: 'FILL',
        eventId: 'fill-1',
        commandId: command.commandId,
        orderPlanId: 'plan-1',
        brokerOrderKey: 'order-1',
        brokerPositionKey: 'position-1',
        volume: 0.05,
        price: 1.1,
        cumulativeVolume: 0.05,
        remainingVolume: 0.05,
        filledAt: at,
      },
      'message-fill',
    );
    repo.recordAgentMessage(fill);
    repo.recordAgentMessage({ ...fill, messageId: 'message-fill-duplicate' });
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'COMMAND_ACK',
          commandId: 'stale-command',
          idempotencyKey: 'stale',
          status: 'ACCEPTED',
          brokerOrderKey: 'x',
          reason: null,
        },
        'message-stale',
      ),
    );
    expect(
      (
        connection.sqlite
          .prepare('SELECT COUNT(*) count FROM execution_fills')
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        connection.sqlite
          .prepare(
            "SELECT COUNT(*) count FROM mt5_safety_events WHERE event_type='STALE_EXECUTION_EVENT'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    connection.sqlite.close();
  });
  it('audits bounded protection failure and verified safety flatten without creating exposure', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'FILL',
          eventId: 'fill-1',
          commandId: command.commandId,
          orderPlanId: 'plan-1',
          brokerOrderKey: 'order-1',
          brokerPositionKey: 'position-1',
          volume: 0.1,
          price: 1.1,
          cumulativeVolume: 0.1,
          remainingVolume: 0,
          filledAt: at,
        },
        'm1',
      ),
    );
    for (const attempt of [1, 2])
      repo.recordAgentMessage(
        envelope(
          {
            kind: 'PROTECTION_ATTEMPT',
            eventId: `p-${attempt}`,
            commandId: command.commandId,
            orderPlanId: 'plan-1',
            brokerPositionKey: 'position-1',
            brokerCommandId: `protect-command-${attempt}`,
            idempotencyKey: 'order-plan:plan-1:protect:position-1:0.1',
            attempt,
            protectedVolume: 0.1,
            requestedStop: 1.09,
            actualStop: null,
            status: 'REJECTED',
            reason: 'rejected',
            occurredAt: at,
          },
          `mp-${attempt}`,
        ),
      );
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'FLATTEN_RESULT',
          eventId: 'flat-1',
          commandId: command.commandId,
          orderPlanId: 'plan-1',
          brokerPositionKey: 'position-1',
          brokerCommandId: 'flatten-command-1',
          idempotencyKey: 'order-plan:plan-1:flatten:position-1',
          targetVolume: 0.1,
          status: 'VERIFIED',
          closedVolume: 0.1,
          reason: 'bounded retry exhausted',
          occurredAt: at,
        },
        'mf',
      ),
    );
    expect(
      connection.sqlite.prepare('SELECT state FROM execution_lifecycles').get(),
    ).toEqual({ state: 'FLATTENED' });
    expect(
      (
        connection.sqlite
          .prepare('SELECT COUNT(*) count FROM positions')
          .get() as { count: number }
      ).count,
    ).toBe(0);
    connection.sqlite.close();
  });
  it('keeps an uncertain command durable and retryable across a repository restart', () => {
    const { connection, repo, command } = setup();
    repo.markSending(command.commandId);
    repo.markUnknown(command.commandId, 'simulated disconnect');
    const restarted = new ExecutionRepository(connection.sqlite);
    expect(restarted.pendingCommands()).toEqual([command]);
    expect(
      connection.sqlite
        .prepare('SELECT status,attempt_count attempts FROM execution_commands')
        .get(),
    ).toEqual({ status: 'UNKNOWN', attempts: 1 });
    connection.sqlite.close();
  });
  it('replays acknowledged and partially completed commands after restart, with bounded attempts', () => {
    const { connection, repo, command } = setup();
    repo.markSending(command.commandId);
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'COMMAND_ACK',
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          status: 'ACCEPTED',
          brokerOrderKey: 'order-1',
          reason: null,
        },
        'ack-before-restart',
      ),
    );
    expect(
      new ExecutionRepository(connection.sqlite).pendingCommands(),
    ).toEqual([command]);
    repo.markSending(command.commandId);
    repo.markUnknown(command.commandId, 'second attempt unresolved');
    repo.markSending(command.commandId);
    repo.markUnknown(command.commandId, 'third attempt unresolved');
    expect(repo.pendingCommands()).toEqual([]);
    expect(
      connection.sqlite
        .prepare('SELECT attempt_count attempts FROM execution_commands')
        .get(),
    ).toEqual({ attempts: 3 });
    connection.sqlite.close();
  });
  it('protects each actual partial-fill quantity and updates the Scout without quantity drift', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-1', 0.04, 0.04, 0.06, 1.1), 'mf-1'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-1', 0.04, 1.09), 'mp-1'),
    );
    expect(
      connection.sqlite
        .prepare('SELECT original_size,current_size,entry_price FROM positions')
        .get(),
    ).toEqual({ original_size: 0.04, current_size: 0.04, entry_price: 1.1 });
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-2', 0.06, 0.1, 0, 1.2), 'mf-2'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-2', 0.1, 1.09), 'mp-2'),
    );
    expect(
      connection.sqlite
        .prepare('SELECT original_size,current_size,entry_price FROM positions')
        .get(),
    ).toEqual({ original_size: 0.1, current_size: 0.1, entry_price: 1.16 });
    expect(
      connection.sqlite
        .prepare(
          "SELECT GROUP_CONCAT(target_volume, ',') volumes FROM execution_safety_operations WHERE operation_type='SET_INITIAL_STOP'",
        )
        .get(),
    ).toEqual({ volumes: '0.04,0.1' });
    connection.sqlite.close();
  });
  it('rejects over-protection and out-of-order cumulative fills into recovery-safe state', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-1', 0.05, 0.05, 0.05), 'mf-1'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-over', 0.1, 1.09), 'mp-over'),
    );
    expect(
      connection.sqlite
        .prepare(
          'SELECT state,protected_volume protected FROM execution_lifecycles',
        )
        .get(),
    ).toEqual({ state: 'UNKNOWN', protected: 0 });
    expect(
      (
        connection.sqlite
          .prepare('SELECT COUNT(*) count FROM positions')
          .get() as { count: number }
      ).count,
    ).toBe(0);
    connection.sqlite.close();

    const second = setup();
    second.repo.recordAgentMessage(
      envelope(
        fill(second.command.commandId, 'f-full', 0.1, 0.1, 0),
        'mf-full',
      ),
    );
    second.repo.recordAgentMessage(
      envelope(
        fill(second.command.commandId, 'f-old', 0.05, 0.05, 0.05),
        'mf-old',
      ),
    );
    expect(
      second.connection.sqlite
        .prepare('SELECT filled_volume filled FROM execution_lifecycles')
        .get(),
    ).toEqual({ filled: 0.1 });
    expect(
      (
        second.connection.sqlite
          .prepare('SELECT COUNT(*) count FROM execution_fills')
          .get() as { count: number }
      ).count,
    ).toBe(1);
    second.connection.sqlite.close();
  });
  it('does not worsen an already verified stop while protecting a later fill', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-1', 0.05, 0.05, 0.05), 'mf-1'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-1', 0.05, 1.09), 'mp-1'),
    );
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-2', 0.05, 0.1, 0), 'mf-2'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-worse', 0.1, 1.08), 'mp-worse'),
    );
    expect(
      connection.sqlite
        .prepare(
          'SELECT state,protected_volume protected FROM execution_lifecycles',
        )
        .get(),
    ).toEqual({ state: 'UNKNOWN', protected: 0.05 });
    expect(
      connection.sqlite
        .prepare('SELECT current_size size FROM positions')
        .get(),
    ).toEqual({ size: 0.05 });
    connection.sqlite.close();
  });
  it('lets an established broker fill outrank a late rejection ACK', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-1', 0.1, 0.1, 0), 'mf-1'),
    );
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'COMMAND_ACK',
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          status: 'REJECTED',
          brokerOrderKey: null,
          reason: 'late rejection',
        },
        'late-rejection',
      ),
    );
    expect(
      connection.sqlite
        .prepare('SELECT state,filled_volume filled FROM execution_lifecycles')
        .get(),
    ).toEqual({ state: 'PROTECTING', filled: 0.1 });
    expect(
      connection.sqlite.prepare('SELECT status FROM execution_commands').get(),
    ).toEqual({ status: 'CREATED' });
    connection.sqlite.close();
  });
  it('keeps terminal execution monotonic while durably auditing late ACKs and fills', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-1', 0.1, 0.1, 0), 'mf-1'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-1', 0.1, 1.09), 'mp-1'),
    );
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'COMMAND_ACK',
          commandId: command.commandId,
          idempotencyKey: command.idempotencyKey,
          status: 'REJECTED',
          brokerOrderKey: null,
          reason: 'late',
        },
        'late-ack',
      ),
    );
    repo.recordAgentMessage(
      envelope(
        {
          ...fill(command.commandId, 'late-fill', 0.01, 0.11, 0),
          remainingVolume: 0,
        },
        'late-fill-message',
      ),
    );
    expect(
      connection.sqlite
        .prepare(
          'SELECT state,filled_volume filled,protected_volume protected FROM execution_lifecycles',
        )
        .get(),
    ).toEqual({ state: 'ACTIVE', filled: 0.1, protected: 0.1 });
    expect(
      connection.sqlite.prepare('SELECT status FROM execution_commands').get(),
    ).toEqual({ status: 'COMPLETED' });
    expect(
      (
        connection.sqlite
          .prepare('SELECT COUNT(*) count FROM broker_execution_events')
          .get() as { count: number }
      ).count,
    ).toBe(4);
    expect(
      (
        connection.sqlite
          .prepare('SELECT COUNT(*) count FROM execution_fills')
          .get() as { count: number }
      ).count,
    ).toBe(1);
    connection.sqlite.close();
  });
  it('lets reconciled broker quantity and protection override local execution assumptions', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-1', 0.1, 0.1, 0), 'mf-1'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-1', 0.1, 1.09), 'mp-1'),
    );
    const brokerSnapshot = mt5SnapshotSchema.parse({
      snapshotId: 'broker-authority',
      complete: true,
      capturedAt: at,
      account: {
        accountKey: 'demo-1',
        broker: 'Fake',
        server: 'Demo',
        login: '1',
        currency: 'USD',
        balance: 10000,
        equity: 10000,
        margin: 0,
        freeMargin: 10000,
        leverage: 100,
        isLive: false,
        hedging: true,
        capturedAt: at,
      },
      symbols: [
        {
          brokerSymbol: 'EURUSD',
          canonicalSymbol: 'EURUSD',
          digits: 5,
          tickSize: 0.00001,
          pipSize: 0.0001,
          contractSize: 100000,
          minVolume: 0.01,
          volumeStep: 0.01,
          maxVolume: 100,
          stopsLevel: 0,
          freezeLevel: 0,
        },
      ],
      positions: [
        {
          brokerPositionKey: 'position-1',
          brokerSymbol: 'EURUSD',
          direction: 'LONG',
          volume: 0.08,
          openPrice: 1.101,
          currentPrice: 1.102,
          stopLoss: null,
          takeProfit: 1.12,
          openedAt: at,
          magic: 10,
          comment: 'ARISE plan-1',
        },
      ],
      pendingOrders: [],
      quotes: [
        {
          brokerSymbol: 'EURUSD',
          bid: 1.102,
          ask: 1.1021,
          brokerTime: at,
          receivedAt: at,
          sequence: 2,
        },
      ],
      candles: [],
      unavailableReason: null,
    });
    new Mt5Repository(connection.sqlite).ingest(
      envelope(
        { kind: 'BROKER_SNAPSHOT', snapshot: brokerSnapshot },
        'snapshot-message',
      ),
      'RECONNECT',
    );
    expect(
      connection.sqlite
        .prepare('SELECT current_size size,entry_price entry FROM positions')
        .get(),
    ).toEqual({ size: 0.08, entry: 1.101 });
    expect(
      connection.sqlite
        .prepare(
          'SELECT state,filled_volume filled,protected_volume protected FROM execution_lifecycles',
        )
        .get(),
    ).toEqual({ state: 'UNKNOWN', filled: 0.08, protected: 0 });
    expect(
      connection.sqlite
        .prepare(
          'SELECT category FROM reconciliation_items ORDER BY category',
        )
        .all(),
    ).toEqual([
      { category: 'PROTECTION_MISMATCH' },
      { category: 'QUANTITY_MISMATCH' },
      { category: 'UNKNOWN' },
    ]);
    expect(
      connection.sqlite
        .prepare(
          'SELECT verified_stop stop,verified_take_profit tp FROM position_protection_current',
        )
        .get(),
    ).toEqual({ stop: null, tp: 1.12 });
    connection.sqlite.close();
  });
  it('requires two failed protection attempts and an exact idempotent flatten quantity', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-1', 0.1, 0.1, 0), 'mf-1'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-1', 0.1, null, 1), 'mp-1'),
    );
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'FLATTEN_RESULT',
          eventId: 'flat-early',
          commandId: command.commandId,
          orderPlanId: 'plan-1',
          brokerPositionKey: 'position-1',
          brokerCommandId: 'flatten-1',
          idempotencyKey: 'order-plan:plan-1:flatten:position-1',
          targetVolume: 0.1,
          status: 'VERIFIED',
          closedVolume: 0.1,
          reason: null,
          occurredAt: at,
        },
        'flat-early-message',
      ),
    );
    expect(
      connection.sqlite.prepare('SELECT state FROM execution_lifecycles').get(),
    ).toEqual({ state: 'UNKNOWN' });
    expect(
      (
        connection.sqlite
          .prepare('SELECT COUNT(*) count FROM execution_safety_operations')
          .get() as { count: number }
      ).count,
    ).toBe(1);
    connection.sqlite.close();
  });
  it('flattens the full broker quantity when a subsequent partial fill cannot be protected', () => {
    const { connection, repo, command } = setup();
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-1', 0.04, 0.04, 0.06), 'mf-1'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-1', 0.04, 1.09), 'mp-1'),
    );
    repo.recordAgentMessage(
      envelope(fill(command.commandId, 'f-2', 0.06, 0.1, 0), 'mf-2'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-2a', 0.1, null, 1), 'mp-2a'),
    );
    repo.recordAgentMessage(
      envelope(protection(command.commandId, 'p-2b', 0.1, null, 2), 'mp-2b'),
    );
    repo.recordAgentMessage(
      envelope(
        {
          kind: 'FLATTEN_RESULT',
          eventId: 'flat-full',
          commandId: command.commandId,
          orderPlanId: 'plan-1',
          brokerPositionKey: 'position-1',
          brokerCommandId: 'flatten-full',
          idempotencyKey: 'order-plan:plan-1:flatten:position-1',
          targetVolume: 0.1,
          status: 'VERIFIED',
          closedVolume: 0.1,
          reason: 'bounded failure',
          occurredAt: at,
        },
        'flat-full-message',
      ),
    );
    expect(
      connection.sqlite
        .prepare(
          'SELECT state,filled_volume filled,protected_volume protected FROM execution_lifecycles',
        )
        .get(),
    ).toEqual({ state: 'FLATTENED', filled: 0.1, protected: 0.04 });
    expect(
      connection.sqlite
        .prepare('SELECT current_state state,current_size size FROM positions')
        .get(),
    ).toEqual({ state: 'CLOSED', size: 0 });
    expect(
      connection.sqlite
        .prepare(
          "SELECT target_volume volume,idempotency_key key FROM execution_safety_operations WHERE operation_type='SAFETY_FLATTEN'",
        )
        .get(),
    ).toEqual({ volume: 0.1, key: 'order-plan:plan-1:flatten:position-1' });
    connection.sqlite.close();
  });
});
