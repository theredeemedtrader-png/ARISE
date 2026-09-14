import { describe, expect, it } from 'vitest';
import {
  MT5_PROTOCOL_VERSION,
  classifyExternalPositionInputSchema,
  mt5TransportModeSchema,
  mt5DesktopEnvelopeSchema,
} from './mt5';

describe('M9-M11 MT5 protocol boundary', () => {
  it('uses the M11-compatible version and keeps broker messages allow-listed', () => {
    const base = {
      messageId: 'm1',
      correlationId: null,
      schemaVersion: MT5_PROTOCOL_VERSION,
      sentAt: new Date().toISOString(),
    };
    for (const payload of [
      {
        kind: 'HELLO',
        appVersion: '1',
        protocolVersion: MT5_PROTOCOL_VERSION,
        minimumCompatibleVersion: MT5_PROTOCOL_VERSION,
      },
      { kind: 'SNAPSHOT_REQUEST', trigger: 'STARTUP' },
      { kind: 'HEARTBEAT' },
    ])
      expect(
        mt5DesktopEnvelopeSchema.safeParse({ ...base, payload }).success,
      ).toBe(true);
    for (const kind of [
      'PLACE_ORDER',
      'MODIFY_ORDER',
      'CANCEL_ORDER',
      'SET_STOP',
      'SET_TP',
    ])
      expect(
        mt5DesktopEnvelopeSchema.safeParse({ ...base, payload: { kind } })
          .success,
      ).toBe(false);
    expect(
      mt5DesktopEnvelopeSchema.safeParse({
        ...base,
        schemaVersion: 1,
        payload: { kind: 'HEARTBEAT' },
      }).success,
    ).toBe(false);
  });
  it('requires explicit identity, quantity, session, and action fields for management commands', () => {
    const base = { messageId: 'm11', correlationId: null, schemaVersion: MT5_PROTOCOL_VERSION, sentAt: new Date().toISOString() };
    const command = { commandId: 'c1', idempotencyKey: 'k1', protectionRequestId: 'r1', ruleVersionId: 'rv1', triggerEventId: 't1', commandType: 'PARTIAL_CLOSE', accountKey: 'demo', brokerSymbol: 'EURUSD', brokerPositionKey: 'p1', direction: 'LONG', expectedBrokerVolume: 0.5, requestedStop: null, requestedTakeProfit: null, requestedCloseVolume: 0.2, expectedSessionId: 's1', sequence: 1, createdAt: base.sentAt, expiresAt: '2099-01-01T00:00:00.000Z' };
    expect(mt5DesktopEnvelopeSchema.safeParse({ ...base, payload: { kind: 'MANAGEMENT_COMMAND', command } }).success).toBe(true);
    expect(mt5DesktopEnvelopeSchema.safeParse({ ...base, payload: { kind: 'MANAGEMENT_COMMAND', command: { ...command, requestedCloseVolume: null } } }).success).toBe(false);
  });
  it('requires a Colony only for ATTACH TO COLONY', () => {
    expect(
      classifyExternalPositionInputSchema.safeParse({
        brokerPositionKey: '7',
        classification: 'ATTACH_TO_COLONY',
        colonyId: null,
      }).success,
    ).toBe(false);
    expect(
      classifyExternalPositionInputSchema.safeParse({
        brokerPositionKey: '7',
        classification: 'TRACK_AS_EXTERNAL',
        colonyId: null,
      }).success,
    ).toBe(true);
  });
  it('identifies real demo transport separately without adding a live transport mode', () => {
    expect(mt5TransportModeSchema.parse('MT5_DEMO')).toBe('MT5_DEMO');
    expect(mt5TransportModeSchema.safeParse('MT5_LIVE').success).toBe(false);
  });
});
