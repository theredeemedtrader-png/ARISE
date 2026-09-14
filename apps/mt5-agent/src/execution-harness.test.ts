import { describe, expect, it } from 'vitest';
import { FakeExecutionBroker, type FakeBrokerScenario } from './server';
import type { Mt5ExecutionCommand, Mt5ManagementCommand } from '@arise/shared';
const command: Mt5ExecutionCommand = {
  commandId: 'command-1',
  idempotencyKey: 'plan-1:create',
  orderPlanId: 'plan-1',
  commandType: 'CREATE_ORDER',
  accountKey: 'demo-1',
  brokerSymbol: 'EURUSD',
  direction: 'LONG',
  volume: 0.1,
  initialStop: 1.09,
  brokerPositionKey: null,
  expectedSessionId: 'session-1',
  createdAt: '2026-09-11T12:00:00.000Z',
  expiresAt: '2099-09-11T12:01:00.000Z',
  maxSpreadPips: 2,
};
describe('M10 fake broker failure harness', () => {
  it('makes duplicate sends and restart replay effectively-once', () => {
    const broker = new FakeExecutionBroker();
    const first = broker.execute(command);
    const afterRestart = broker.execute(command);
    expect(first.payloads.some((p) => p.kind === 'FILL')).toBe(true);
    expect(afterRestart.payloads[0]).toMatchObject({
      kind: 'COMMAND_ACK',
      status: 'ALREADY_APPLIED',
    });
    expect(broker.exposureCount).toBe(1);
    expect(broker.exposureVolume).toBe(0.1);
  });
  it('protects each partial fill at the actual cumulative quantity', () => {
    const result = new FakeExecutionBroker('PARTIAL_FILL').execute(command);
    expect(
      result.payloads
        .filter((p) => p.kind === 'PROTECTION_ATTEMPT')
        .map((p) => (p.kind === 'PROTECTION_ATTEMPT' ? p.protectedVolume : 0)),
    ).toEqual([0.05, 0.1]);
  });
  it('applies emergency flatten once under duplicate entry replay', () => {
    const broker = new FakeExecutionBroker('PROTECTION_FAILURE');
    broker.execute(command);
    broker.execute(command);
    expect(broker.exposureVolume).toBe(0);
    expect(broker.flattenEffectCount).toBe(1);
  });
  it('rejects an idempotency-key collision with different exposure parameters', () => {
    const broker = new FakeExecutionBroker();
    broker.execute(command);
    const collision = broker.execute({ ...command, volume: 0.2 });
    expect(collision.payloads[0]).toMatchObject({
      kind: 'COMMAND_ACK',
      status: 'REJECTED',
    });
    expect(broker.exposureVolume).toBe(0.1);
  });
  for (const [scenario, assertion] of [
    [
      'REJECTION',
      (payloads: readonly { kind: string }[]) =>
        expect(payloads[0]).toMatchObject({
          kind: 'COMMAND_ACK',
          status: 'REJECTED',
        }),
    ],
    [
      'TIMEOUT',
      (payloads: readonly { kind: string }[]) =>
        expect(payloads).toHaveLength(0),
    ],
    [
      'PARTIAL_FILL',
      (payloads: readonly { kind: string }[]) =>
        expect(payloads.filter((p) => p.kind === 'FILL')).toHaveLength(2),
    ],
    [
      'DISCONNECT',
      (
        _payloads: readonly { kind: string }[],
        disconnectAfter: number | null,
      ) => expect(disconnectAfter).toBe(0),
    ],
    [
      'DISCONNECT_AFTER_ACK',
      (
        _payloads: readonly { kind: string }[],
        disconnectAfter: number | null,
      ) => expect(disconnectAfter).toBe(1),
    ],
    [
      'DISCONNECT_AFTER_FILL',
      (
        _payloads: readonly { kind: string }[],
        disconnectAfter: number | null,
      ) => expect(disconnectAfter).toBe(2),
    ],
    [
      'STALE_ACK',
      (payloads: readonly { kind: string }[]) =>
        expect(payloads.filter((p) => p.kind === 'COMMAND_ACK')).toHaveLength(
          2,
        ),
    ],
    [
      'PROTECTION_FAILURE',
      (payloads: readonly { kind: string }[]) => {
        expect(
          payloads.filter((p) => p.kind === 'PROTECTION_ATTEMPT'),
        ).toHaveLength(2);
        expect(payloads.some((p) => p.kind === 'FLATTEN_RESULT')).toBe(true);
      },
    ],
  ] as const)
    it(`covers ${scenario.toLowerCase()}`, () => {
      const result = new FakeExecutionBroker(
        scenario as FakeBrokerScenario,
      ).execute(command);
      assertion(result.payloads, result.disconnectAfter);
    });
});

const management = (
  overrides: Partial<Mt5ManagementCommand> = {},
): Mt5ManagementCommand => ({
  commandId: 'management-1',
  idempotencyKey: 'protection:r1:t1:position-1:MOVE_TO_PRICE_BE:1',
  protectionRequestId: 'request-1',
  ruleVersionId: 'rule-v1',
  triggerEventId: 'trigger-1',
  commandType: 'MOVE_STOP',
  accountKey: 'demo-1',
  brokerSymbol: 'EURUSD',
  brokerPositionKey: 'position-1',
  direction: 'LONG',
  expectedBrokerVolume: 0.6,
  requestedStop: 1.1,
  requestedTakeProfit: null,
  requestedCloseVolume: null,
  expectedSessionId: 'session-1',
  sequence: 1,
  createdAt: '2026-09-11T12:00:00.000Z',
  expiresAt: '2099-09-11T12:01:00.000Z',
  ...overrides,
});

describe('M11 fake broker management failure harness', () => {
  it('deduplicates stop modifications and rejects an idempotency collision', () => {
    const broker = new FakeExecutionBroker();
    broker.seedPosition('position-1', { volume: 0.6, stop: 1.09 });
    expect(broker.executeManagement(management()).payloads[0]).toMatchObject({ status: 'VERIFIED' });
    expect(broker.executeManagement(management()).payloads[0]).toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(broker.executeManagement(management({ requestedStop: 1.101 })).payloads[0]).toMatchObject({ status: 'REJECTED' });
    expect(broker.managementEffectCount).toBe(1);
  });

  it('reconciles partial close then stop update to the actual remaining quantity', () => {
    const broker = new FakeExecutionBroker();
    broker.seedPosition('position-1', { volume: 0.6, stop: 1.09 });
    broker.executeManagement(management({
      commandId: 'close-1', idempotencyKey: 'close-1', protectionRequestId: 'close-request',
      commandType: 'PARTIAL_CLOSE', requestedStop: null, requestedCloseVolume: 0.2,
    }));
    const reality = broker.managedPosition('position-1');
    expect(reality?.volume).toBeCloseTo(0.4);
    const update = broker.executeManagement(management({
      commandId: 'trail-2', idempotencyKey: 'trail-2', protectionRequestId: 'trail-request',
      expectedBrokerVolume: reality!.volume, requestedStop: 1.105, sequence: 2,
    }));
    expect(update.payloads[0]).toMatchObject({ kind: 'MANAGEMENT_ACK', actualStop: 1.105 });
    expect(update.payloads[0]!.kind === 'MANAGEMENT_ACK' && update.payloads[0].actualVolume).toBeCloseTo(0.4);
  });

  it('models reconnect replay, timeout, disconnect, stale ACK, and broker-worsening failures', () => {
    const broker = new FakeExecutionBroker();
    broker.seedPosition('position-1', { volume: 0.6, stop: 1.09 });
    broker.managementScenario = 'TIMEOUT';
    expect(broker.executeManagement(management()).payloads).toHaveLength(0);
    broker.managementScenario = 'NORMAL';
    expect(broker.executeManagement(management()).payloads[0]).toMatchObject({ status: 'ALREADY_APPLIED' });

    const disconnected = new FakeExecutionBroker();
    disconnected.seedPosition('position-1', { volume: 0.6, stop: 1.09 });
    disconnected.managementScenario = 'DISCONNECT';
    expect(disconnected.executeManagement(management()).disconnectAfter).toBe(0);

    const stale = new FakeExecutionBroker();
    stale.seedPosition('position-1', { volume: 0.6, stop: 1.09 });
    stale.managementScenario = 'STALE_ACK';
    expect(stale.executeManagement(management({ sequence: 2 })).payloads[0]).toMatchObject({ sequence: 1 });

    const worsening = new FakeExecutionBroker();
    worsening.seedPosition('position-1', { volume: 0.6, stop: 1.09 });
    worsening.managementScenario = 'WORSENING_PROTECTION';
    const worsened = worsening.executeManagement(management()).payloads[0];
    expect(worsened?.kind === 'MANAGEMENT_ACK' && worsened.actualStop).toBeCloseTo(1.099);
  });
  it('makes emergency/full close idempotent at the broker effect boundary', () => {
    const broker = new FakeExecutionBroker();
    broker.seedPosition('position-1', { volume: 0.6, stop: 1.09 });
    const close = management({ commandId: 'full-close', idempotencyKey: 'full-close-key', protectionRequestId: 'full-close-request', commandType: 'FULL_CLOSE', requestedStop: null, requestedCloseVolume: 0.6 });
    expect(broker.executeManagement(close).payloads[0]).toMatchObject({ status: 'VERIFIED', actualVolume: 0, closedVolume: 0.6 });
    expect(broker.executeManagement(close).payloads[0]).toMatchObject({ status: 'ALREADY_APPLIED', actualVolume: 0 });
    expect(broker.managementEffectCount).toBe(1);
  });
});
