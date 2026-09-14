import { describe, expect, it } from 'vitest';
import type { ProtectionProposal } from '@arise/execution';
import { mt5SnapshotSchema, type Mt5AgentEnvelope, type Mt5ManagementCommand } from '@arise/shared';
import { openDatabase } from './database';
import { ProtectionRepository } from './protection-repository';
import { Mt5Repository } from './mt5-repository';

const at = '2026-09-12T12:00:00.000Z';
const later = '2026-09-12T12:01:00.000Z';

function setup(source = 'ARISE_AUTO') {
  const connection = openDatabase(':memory:');
  connection.sqlite.pragma('foreign_keys=OFF');
  connection.sqlite.prepare(`INSERT INTO trades
    (id,attempt_id,colony_id,idea_version_id,strategy_map_version_id,direction,created_at,source_type)
    VALUES ('trade-1',NULL,'colony-1','idea-version-1',NULL,'LONG',?,?)`).run(at, source);
  connection.sqlite.prepare(`INSERT INTO positions VALUES
    ('position-domain-1','trade-1','demo-1','position-1','colony-1','colony-1','LONG',0.6,0.6,1.1,'LEG',?,NULL)`).run(at);
  const repo = new ProtectionRepository(connection.sqlite);
  repo.persistRuleVersion({
    id: 'rule-v1', ruleId: 'rule-1', version: 1, triggerType: 'MANUAL', actionType: 'MOVE_TO_PRICE_BE',
    scope: 'THIS_POSITION', config: {}, createdAt: at, supersedesId: null,
  });
  repo.recordTrigger({ id: 'trigger-1', ruleVersionId: 'rule-v1', sourceType: 'MANUAL', sourceId: 'operator-1', payload: {}, occurredAt: at, correlationId: 'correlation-1' });
  return { connection, repo };
}

const proposal = (overrides: Partial<ProtectionProposal> = {}): ProtectionProposal => ({
  proposalId: 'request-1', ruleVersionId: 'rule-v1', triggerEventId: 'trigger-1',
  positionId: 'position-domain-1', brokerPositionKey: 'position-1', action: 'MOVE_TO_PRICE_BE',
  requestedStop: 1.1, requestedTakeProfit: null, requestedCloseVolume: null,
  convertToRunner: false, sequence: 1, createdAt: at, ...overrides,
});
const context = { accountKey: 'demo-1', brokerSymbol: 'EURUSD', direction: 'LONG' as const, actualBrokerVolume: 0.6, expectedSessionId: 'session-1', expiresAt: '2099-01-01T00:00:00.000Z' };
const ack = (
  command: Mt5ManagementCommand,
  overrides: Partial<Extract<Mt5AgentEnvelope['payload'], { kind: 'MANAGEMENT_ACK' }>> = {},
  messageId = `message-${command.commandId}`,
): Mt5AgentEnvelope => ({
  messageId, correlationId: command.commandId, schemaVersion: 3, sentAt: later,
  payload: {
    kind: 'MANAGEMENT_ACK', eventId: `event-${command.commandId}`, commandId: command.commandId,
    protectionRequestId: command.protectionRequestId, idempotencyKey: command.idempotencyKey,
    brokerEffectId: `effect-${command.commandId}`, brokerPositionKey: command.brokerPositionKey,
    sequence: command.sequence, status: 'VERIFIED', actualVolume: command.expectedBrokerVolume,
    actualStop: command.requestedStop, actualTakeProfit: null, closedVolume: 0, reason: null, occurredAt: later,
    ...overrides,
  },
});

describe('M11 durable protection and management', () => {
  it('records SHADOW results without producing a broker command', () => {
    const { connection, repo } = setup();
    repo.persistRequest(proposal(), 'SHADOW');
    expect(repo.pendingCommands()).toEqual([]);
    expect(connection.sqlite.prepare('SELECT status FROM protection_requests').get()).toEqual({ status: 'SHADOW_COMPLETED' });
    expect(connection.sqlite.prepare('SELECT COUNT(*) count FROM management_commands').get()).toEqual({ count: 0 });
    connection.sqlite.close();
  });

  it('keeps uncertain commands durable across restart with bounded retries and stable identity', () => {
    const { connection, repo } = setup();
    repo.persistRequest(proposal(), 'DEMO');
    const command = repo.createCommand(proposal(), context);
    repo.markSending(command.commandId);
    repo.markUnknown(command.commandId, 'disconnect during update');
    expect(new ProtectionRepository(connection.sqlite).pendingCommands()).toEqual([command]);
    expect(repo.attemptCount(command.commandId)).toBe(1);
    expect(command.idempotencyKey).toContain('rule-v1:trigger-1:position-1');
    connection.sqlite.close();
  });

  it('serializes effects per Position and lets idempotent full close supersede queued mutations', () => {
    const { connection, repo } = setup();
    repo.persistRequest(proposal(), 'DEMO');
    const first = repo.createCommand(proposal(), context);
    const secondProposal = proposal({ proposalId: 'request-2', sequence: 2, requestedStop: 1.105 });
    repo.persistRequest(secondProposal, 'DEMO');
    const second = repo.createCommand(secondProposal, context);
    expect(repo.pendingCommands().map((item) => item.commandId)).toEqual([first.commandId]);
    expect(repo.markSending(second.commandId)).toBe(false);
    const closeProposal = proposal({ proposalId: 'request-3', sequence: 3, action: 'FULL_CLOSE', requestedStop: null, requestedCloseVolume: 0.6 });
    repo.persistRequest(closeProposal, 'DEMO');
    const close = repo.createCommand(closeProposal, context);
    expect(repo.pendingCommands().map((item) => item.commandId)).toEqual([close.commandId]);
    expect(connection.sqlite.prepare("SELECT COUNT(*) count FROM protection_requests WHERE status='SUPERSEDED'").get()).toEqual({ count: 2 });
    connection.sqlite.close();
  });

  it('deduplicates broker results and does not let stale ACKs regress newer protection', () => {
    const { connection, repo } = setup();
    repo.persistRequest(proposal(), 'DEMO');
    const first = repo.createCommand(proposal(), context);
    repo.recordAgentMessage(ack(first));
    const secondProposal = proposal({ proposalId: 'request-2', requestedStop: 1.105, sequence: 2 });
    repo.persistRequest(secondProposal, 'DEMO');
    const second = repo.createCommand(secondProposal, context);
    repo.recordAgentMessage(ack(second));
    repo.recordAgentMessage(ack(first, { eventId: 'late-first', actualStop: 1.095 }, 'late-message'));
    expect(connection.sqlite.prepare('SELECT verified_stop stop,last_applied_sequence sequence FROM position_protection_current').get()).toEqual({ stop: 1.105, sequence: 2 });
    expect(connection.sqlite.prepare("SELECT COUNT(*) count FROM broker_management_events WHERE status='STALE'").get()).toEqual({ count: 1 });
    connection.sqlite.close();
  });

  it('reconciles a partial close then protects the actual remaining quantity', () => {
    const { connection, repo } = setup();
    const closeProposal = proposal({ action: 'PARTIAL_CLOSE', requestedStop: null, requestedCloseVolume: 0.2 });
    repo.persistRequest(closeProposal, 'DEMO');
    const close = repo.createCommand(closeProposal, context);
    repo.recordAgentMessage(ack(close, { actualVolume: 0.4, actualStop: 1.09, closedVolume: 0.2 }));
    expect(connection.sqlite.prepare('SELECT current_size size FROM positions').get()).toEqual({ size: 0.4 });
    expect(connection.sqlite.prepare('SELECT requested_volume requested,actual_closed_volume closed,remaining_broker_volume remaining FROM position_management_fills').get()).toEqual({ requested: 0.2, closed: 0.2, remaining: 0.4 });
    const stopProposal = proposal({ proposalId: 'request-2', sequence: 2, requestedStop: 1.105 });
    repo.persistRequest(stopProposal, 'DEMO');
    const stop = repo.createCommand(stopProposal, { ...context, actualBrokerVolume: 0.4 });
    repo.recordAgentMessage(ack(stop, { actualVolume: 0.4, actualStop: 1.105 }));
    expect(connection.sqlite.prepare('SELECT broker_volume volume,protected_volume protected,verified_stop stop FROM position_protection_current').get()).toEqual({ volume: 0.4, protected: 0.4, stop: 1.105 });
    connection.sqlite.close();
  });

  it('fails safe on rejected or broker-worsened protection and remains auditable', () => {
    const { connection, repo } = setup();
    repo.persistRequest(proposal(), 'DEMO');
    const first = repo.createCommand(proposal(), context);
    repo.recordAgentMessage(ack(first));
    const nextProposal = proposal({ proposalId: 'request-2', requestedStop: 1.105, sequence: 2 });
    repo.persistRequest(nextProposal, 'DEMO');
    const next = repo.createCommand(nextProposal, context);
    repo.recordAgentMessage(ack(next, { actualStop: 1.08 }));
    expect(connection.sqlite.prepare('SELECT state,truth_state truth FROM position_protection_current').get()).toEqual({ state: 'PROTECTION_ERROR', truth: 'UNKNOWN' });
    expect(connection.sqlite.prepare("SELECT COUNT(*) count FROM mt5_safety_events WHERE event_type='PROTECTION_WORSENED'").get()).toEqual({ count: 1 });
    connection.sqlite.close();
  });

  it('rejects inconsistent partial-close quantities or loss of existing protection', () => {
    const { connection, repo } = setup();
    repo.reconcilePosition({ positionId: 'position-domain-1', brokerPositionKey: 'position-1', actualVolume: 0.6, actualStop: 1.09, actualTakeProfit: null, occurredAt: at });
    const closeProposal = proposal({ action: 'PARTIAL_CLOSE', requestedStop: null, requestedCloseVolume: 0.2 });
    repo.persistRequest(closeProposal, 'DEMO');
    const command = repo.createCommand(closeProposal, context);
    repo.recordAgentMessage(ack(command, { actualVolume: 0.5, actualStop: null, closedVolume: 0.2 }));
    expect(connection.sqlite.prepare('SELECT status FROM management_commands').get()).toEqual({ status: 'FAILED' });
    expect(connection.sqlite.prepare('SELECT state,truth_state truth FROM position_protection_current').get()).toEqual({ state: 'PROTECTION_ERROR', truth: 'UNKNOWN' });
    expect(connection.sqlite.prepare("SELECT COUNT(*) count FROM mt5_safety_events WHERE event_type='MANAGEMENT_EFFECT_MISMATCH'").get()).toEqual({ count: 1 });
    connection.sqlite.close();
  });

  it('lets broker reconciliation override local quantity and protection assumptions', () => {
    const { connection, repo } = setup();
    repo.reconcilePosition({ positionId: 'position-domain-1', brokerPositionKey: 'position-1', actualVolume: 0.35, actualStop: 1.095, actualTakeProfit: null, occurredAt: later });
    expect(connection.sqlite.prepare('SELECT current_size size FROM positions').get()).toEqual({ size: 0.35 });
    expect(connection.sqlite.prepare('SELECT broker_volume volume,protected_volume protected,verified_stop stop,truth_state truth FROM position_protection_current').get()).toEqual({ volume: 0.35, protected: 0.35, stop: 1.095, truth: 'VERIFIED' });
    connection.sqlite.close();
  });

  it('converges an UNKNOWN protection command from broker truth after restart without replay', () => {
    const { connection, repo } = setup();
    repo.persistRequest(proposal(), 'DEMO');
    const command = repo.createCommand(proposal(), context);
    repo.markSending(command.commandId);
    repo.markUnknown(command.commandId, 'restart during protection update');
    const snapshot = mt5SnapshotSchema.parse({
      snapshotId: 'snapshot-restart', complete: true, capturedAt: later,
      account: { accountKey: 'demo-1', broker: 'Fake', server: 'Demo', login: '1', currency: 'USD', balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, leverage: 100, isLive: false, hedging: true, capturedAt: later },
      symbols: [{ brokerSymbol: 'EURUSD', canonicalSymbol: 'EURUSD', digits: 5, tickSize: 0.00001, pipSize: 0.0001, contractSize: 100000, minVolume: 0.01, volumeStep: 0.01, maxVolume: 100, stopsLevel: 0, freezeLevel: 0 }],
      positions: [{ brokerPositionKey: 'position-1', brokerSymbol: 'EURUSD', direction: 'LONG', volume: 0.6, openPrice: 1.1, currentPrice: 1.11, stopLoss: 1.1, takeProfit: null, openedAt: at, magic: 1011, comment: 'ARISE' }],
      pendingOrders: [], quotes: [{ brokerSymbol: 'EURUSD', bid: 1.11, ask: 1.1102, brokerTime: later, receivedAt: later, sequence: 1 }], candles: [], unavailableReason: null,
    });
    new Mt5Repository(connection.sqlite).ingest({ messageId: 'snapshot-message', correlationId: null, schemaVersion: 3, sentAt: later, payload: { kind: 'BROKER_SNAPSHOT', snapshot } }, 'RECONNECT');
    expect(connection.sqlite.prepare('SELECT status FROM management_commands').get()).toEqual({ status: 'COMPLETED' });
    expect(connection.sqlite.prepare('SELECT status FROM protection_requests').get()).toEqual({ status: 'VERIFIED' });
    expect(new ProtectionRepository(connection.sqlite).pendingCommands()).toEqual([]);
    expect(connection.sqlite.prepare("SELECT event_type FROM management_command_events WHERE event_type='BROKER_RECONCILIATION'").get()).toEqual({ event_type: 'BROKER_RECONCILIATION' });
    connection.sqlite.close();
  });

  it('preserves Runner/Colony lineage and disarms entry on default thesis invalidation', () => {
    const { connection, repo } = setup();
    repo.configureColony({ policyVersionId: 'stack-v1', policyId: 'stack-1', colonyId: 'colony-1', version: 1, mode: 'ANY_VALID_ENTRY', config: { maxConcurrentExposure: 2 }, attemptBudgetId: null, currentPeriodKey: 'day-1', occurredAt: at });
    repo.reconcilePosition({ positionId: 'position-domain-1', brokerPositionKey: 'position-1', actualVolume: 0.6, actualStop: 1.09, actualTakeProfit: null, occurredAt: at });
    repo.convertToRunner({ positionId: 'position-domain-1', targetId: 'target-1', policy: { managementMode: 'RUNNER' }, occurredAt: later, correlationId: 'runner-1' });
    expect(connection.sqlite.prepare('SELECT current_state state,original_colony_id origin,current_colony_id current FROM positions').get()).toEqual({ state: 'RUNNER', origin: 'colony-1', current: 'colony-1' });
    expect(connection.sqlite.prepare('SELECT colony_id colony,target_id target FROM runner_conversion_events').get()).toEqual({ colony: 'colony-1', target: 'target-1' });
    expect(repo.invalidateThesis('colony-1', later, 'invalidate-1')).toBe('MANUAL_DECISION');
    expect(connection.sqlite.prepare('SELECT entry_armed armed,invalidation_policy policy,countertrend_enabled countertrend FROM colony_automation_assignments').get()).toEqual({ armed: 0, policy: 'MANUAL_DECISION', countertrend: 0 });
    expect(connection.sqlite.prepare("SELECT event_type FROM colony_automation_events WHERE event_type LIKE 'THESIS%'").get()).toEqual({ event_type: 'THESIS_INVALIDATED_ENTRY_DISARMED' });
    connection.sqlite.close();
  });

  it('cancels an unsent Scout and blocks restart replay when thesis invalidates during creation', () => {
    const { connection, repo } = setup();
    repo.configureColony({ policyVersionId: 'stack-v1', policyId: 'stack-1', colonyId: 'colony-1', version: 1, mode: 'ANY_VALID_ENTRY', config: {}, attemptBudgetId: null, currentPeriodKey: 'day-1', occurredAt: at });
    connection.sqlite.exec(`
      INSERT INTO strategy_runtimes VALUES ('runtime-1','colony-1','map-v1','DEMO','RUNNING','${at}',NULL);
      INSERT INTO execution_intents VALUES ('intent-1','proposal-1','runtime-1','DEMO','{}','${at}');
      INSERT INTO order_plans VALUES ('plan-1','intent-1','deployment-1','DEMO','demo-1','session-1','{}','${at}');
      INSERT INTO execution_lifecycles VALUES ('plan-1','COMMAND_PENDING',0,0,'${at}','pending');
      INSERT INTO execution_commands VALUES ('entry-command','plan-1','entry-idempotency','CREATE_ORDER','CREATED',0,'{}','${at}','${at}');
    `);
    repo.invalidateThesis('colony-1', later, 'invalidation-race');
    expect(connection.sqlite.prepare('SELECT status FROM execution_commands WHERE id=?').get('entry-command')).toEqual({ status: 'FAILED' });
    expect(connection.sqlite.prepare('SELECT state FROM execution_lifecycles WHERE order_plan_id=?').get('plan-1')).toEqual({ state: 'REJECTED' });
    expect(connection.sqlite.prepare("SELECT COUNT(*) count FROM execution_command_events WHERE event_type='THESIS_INVALIDATED'").get()).toEqual({ count: 1 });
    connection.sqlite.close();
  });

  it('persists cooldown and explicit AttemptBudget period reset history', () => {
    const { connection, repo } = setup();
    connection.sqlite.prepare("INSERT INTO attempt_budgets VALUES ('budget-1','colony-1',3,20,NULL,'{}','day-1',?)").run(at);
    repo.configureColony({ policyVersionId: 'stack-v1', policyId: 'stack-1', colonyId: 'colony-1', version: 1, mode: 'ONLY_AFTER_PROTECTED', config: {}, attemptBudgetId: 'budget-1', currentPeriodKey: 'day-1', occurredAt: at });
    repo.setCooldown('colony-1', '2026-09-12T13:00:00.000Z', later, 'cooldown-1');
    repo.resetAttemptPeriod('colony-1', 'day-2', '2026-09-13T00:00:00.000Z', 'reset-1');
    expect(connection.sqlite.prepare('SELECT current_period_key period,cooldown_until cooldown FROM colony_automation_assignments').get()).toEqual({ period: 'day-2', cooldown: null });
    expect(connection.sqlite.prepare('SELECT current_period_key period FROM attempt_budgets').get()).toEqual({ period: 'day-2' });
    expect(connection.sqlite.prepare("SELECT GROUP_CONCAT(event_type, ',') events FROM colony_automation_events").get()).toEqual({ events: 'POLICY_ASSIGNED,COOLDOWN_STARTED,ATTEMPT_PERIOD_RESET' });
    connection.sqlite.close();
  });

  it('isolates manual/external positions from commands and runner conversion', () => {
    const { connection, repo } = setup('EXTERNAL_MANUAL');
    expect(repo.isAutomatedPositionKey('position-1')).toBe(false);
    expect(() => repo.convertToRunner({ positionId: 'position-domain-1', targetId: null, policy: {}, occurredAt: later, correlationId: 'x' })).toThrow('automated');
    connection.sqlite.close();
  });

  it('keeps rules, triggers, costs, and command history immutable', () => {
    const { connection, repo } = setup();
    repo.recordCostFact({ id: 'cost-1', positionId: 'position-domain-1', brokerFillEventId: null, costType: 'COMMISSION', amountMoney: 2.5, occurredAt: at, sourceId: 'broker-deal-1' });
    expect(() => connection.sqlite.prepare("UPDATE broker_position_cost_events SET amount_money=0 WHERE id='cost-1'").run()).toThrow('immutable');
    expect(() => connection.sqlite.prepare("UPDATE protection_rule_versions SET action_type='FULL_CLOSE' WHERE id='rule-v1'").run()).toThrow('immutable');
    connection.sqlite.close();
  });
});
