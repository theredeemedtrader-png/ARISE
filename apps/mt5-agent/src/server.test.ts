import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  MT5_PROTOCOL_VERSION,
  mt5AgentEnvelopeSchema,
  mt5SnapshotSchema,
  type Mt5AgentEnvelope,
  type Mt5ExecutionCommand,
  type Mt5ManagementCommand,
  type Mt5Snapshot,
} from '@arise/shared';
import {
  FakeExecutionBroker,
  ReadOnlyMt5AgentServer,
  unavailableSnapshot,
} from './server';

const snapshot = (isLive = false): Mt5Snapshot => {
  const stamp = new Date().toISOString();
  return mt5SnapshotSchema.parse({
    snapshotId: `snapshot-${stamp}`,
    complete: true,
    capturedAt: stamp,
    account: {
      accountKey: 'demo-1',
      broker: 'Fake',
      server: isLive ? 'Live' : 'Demo',
      login: '1',
      currency: 'USD',
      balance: 10000,
      equity: 10000,
      margin: 0,
      freeMargin: 10000,
      leverage: 100,
      isLive,
      hedging: true,
      capturedAt: stamp,
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
    positions: [],
    pendingOrders: [],
    quotes: [
      {
        brokerSymbol: 'EURUSD',
        bid: 1.1,
        ask: 1.1001,
        brokerTime: stamp,
        receivedAt: stamp,
        sequence: 1,
      },
    ],
    candles: [],
    unavailableReason: null,
  });
};

const managedSnapshot = (
  input: { readonly isLive?: boolean; readonly external?: boolean; readonly volume?: number } = {},
): Mt5Snapshot => {
  const value = snapshot(input.isLive ?? false);
  value.positions.push({
    brokerPositionKey: 'position-1', brokerSymbol: 'EURUSD', direction: 'LONG',
    volume: input.volume ?? 0.6, openPrice: 1.1, currentPrice: 1.11, stopLoss: 1.09,
    takeProfit: null, openedAt: new Date().toISOString(), magic: input.external ? 0 : 1011,
    comment: input.external ? 'manual' : 'ARISE plan-1',
  });
  value.quotes[0]!.bid = 1.11;
  value.quotes[0]!.ask = 1.1102;
  return value;
};

async function commandAck(
  server: ReadOnlyMt5AgentServer,
  commandPatch: Partial<Mt5ExecutionCommand>,
): Promise<Extract<Mt5AgentEnvelope['payload'], { kind: 'COMMAND_ACK' }>> {
  const address = await server.start();
  return new Promise((resolve, reject) => {
    const socket = connect(address.port, address.host, () => {
      socket.write(
        `${JSON.stringify({ messageId: 'hello', correlationId: null, schemaVersion: MT5_PROTOCOL_VERSION, sentAt: new Date().toISOString(), payload: { kind: 'HELLO', appVersion: 'test', protocolVersion: MT5_PROTOCOL_VERSION, minimumCompatibleVersion: MT5_PROTOCOL_VERSION } })}\n`,
      );
    });
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const envelope = mt5AgentEnvelopeSchema.parse(JSON.parse(line));
        if (envelope.payload.kind === 'HELLO_ACK') {
          const stamp = new Date().toISOString();
          const command: Mt5ExecutionCommand = {
            commandId: 'command-1',
            idempotencyKey: 'order-plan:plan-1:create',
            orderPlanId: 'plan-1',
            commandType: 'CREATE_ORDER',
            accountKey: 'demo-1',
            brokerSymbol: 'EURUSD',
            direction: 'LONG',
            volume: 0.1,
            initialStop: 1.09,
            brokerPositionKey: null,
            expectedSessionId: envelope.payload.sessionId,
            createdAt: stamp,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            maxSpreadPips: 2,
            ...commandPatch,
          };
          socket.write(
            `${JSON.stringify({ messageId: 'execute', correlationId: null, schemaVersion: MT5_PROTOCOL_VERSION, sentAt: stamp, payload: { kind: 'EXECUTION_COMMAND', command } })}\n`,
          );
        } else if (envelope.payload.kind === 'COMMAND_ACK') {
          socket.destroy();
          resolve(envelope.payload);
        }
      }
    });
    socket.on('error', reject);
  });
}

async function managementAck(
  server: ReadOnlyMt5AgentServer,
  commandPatch: Partial<Mt5ManagementCommand> = {},
): Promise<Extract<Mt5AgentEnvelope['payload'], { kind: 'MANAGEMENT_ACK' }>> {
  const address = await server.start();
  return new Promise((resolve, reject) => {
    const socket = connect(address.port, address.host, () => {
      socket.write(`${JSON.stringify({ messageId: 'hello-m11', correlationId: null, schemaVersion: MT5_PROTOCOL_VERSION, sentAt: new Date().toISOString(), payload: { kind: 'HELLO', appVersion: 'test', protocolVersion: MT5_PROTOCOL_VERSION, minimumCompatibleVersion: MT5_PROTOCOL_VERSION } })}\n`);
    });
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const envelope = mt5AgentEnvelopeSchema.parse(JSON.parse(buffer.slice(0, end)));
        buffer = buffer.slice(end + 1);
        if (envelope.payload.kind === 'HELLO_ACK') {
          const stamp = new Date().toISOString();
          const command: Mt5ManagementCommand = {
            commandId: 'management-1', idempotencyKey: 'm11-key-1', protectionRequestId: 'request-1',
            ruleVersionId: 'rule-v1', triggerEventId: 'trigger-1', commandType: 'MOVE_STOP',
            accountKey: 'demo-1', brokerSymbol: 'EURUSD', brokerPositionKey: 'position-1', direction: 'LONG',
            expectedBrokerVolume: 0.6, requestedStop: 1.1, requestedTakeProfit: null, requestedCloseVolume: null,
            expectedSessionId: envelope.payload.sessionId, sequence: 1, createdAt: stamp,
            expiresAt: new Date(Date.now() + 60_000).toISOString(), ...commandPatch,
          };
          socket.write(`${JSON.stringify({ messageId: 'manage', correlationId: null, schemaVersion: MT5_PROTOCOL_VERSION, sentAt: stamp, payload: { kind: 'MANAGEMENT_COMMAND', command } })}\n`);
        } else if (envelope.payload.kind === 'MANAGEMENT_ACK') {
          socket.destroy();
          resolve(envelope.payload);
        }
      }
    });
    socket.on('error', reject);
  });
}

describe('M10 Agent mutation boundary', () => {
  it('identifies the fake harness honestly and returns UNKNOWN broker truth', async () => {
    const server = new ReadOnlyMt5AgentServer({
      mode: 'FAKE_HARNESS',
      snapshot: () => unavailableSnapshot('fake terminal offline'),
      terminalConnected: () => false,
    });
    const address = await server.start();
    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        const socket = connect(address.port, address.host, () =>
          socket.write(
            `${JSON.stringify({ messageId: 'hello', correlationId: null, schemaVersion: MT5_PROTOCOL_VERSION, sentAt: new Date().toISOString(), payload: { kind: 'HELLO', appVersion: 'test', protocolVersion: MT5_PROTOCOL_VERSION, minimumCompatibleVersion: MT5_PROTOCOL_VERSION } })}\n`,
          ),
        );
        let data = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
          data += chunk;
          if (data.includes('\n')) {
            socket.end();
            resolve(JSON.parse(data.trim()));
          }
        });
        socket.on('error', reject);
      });
      expect(mt5AgentEnvelopeSchema.parse(response).payload).toMatchObject({
        kind: 'HELLO_ACK',
        transportMode: 'FAKE_HARNESS',
        terminalConnected: false,
      });
    } finally {
      await server.stop();
    }
  });

  const staleQuote = snapshot();
  staleQuote.quotes[0]!.receivedAt = '2020-01-01T00:00:00.000Z';
  const wideSpread = snapshot();
  wideSpread.quotes[0]!.ask = 1.101;
  for (const [name, snap, patch, reason, terminalConnected] of [
    ['live account', snapshot(true), {}, 'demo account', true],
    [
      'expired plan',
      snapshot(),
      { expiresAt: '2020-01-01T00:00:00.000Z' },
      'expired',
      true,
    ],
    [
      'account mismatch',
      snapshot(),
      { accountKey: 'other-account' },
      'demo account',
      true,
    ],
    [
      'stale session',
      snapshot(),
      { expectedSessionId: 'old-session' },
      'session',
      true,
    ],
    ['stale quote', staleQuote, {}, 'incompatible', true],
    ['excessive spread', wideSpread, {}, 'incompatible', true],
    [
      'incomplete broker truth',
      unavailableSnapshot('unknown'),
      {},
      'incompatible',
      true,
    ],
    ['disconnected terminal', snapshot(), {}, 'incompatible', false],
    [
      'external position target',
      snapshot(),
      { commandType: 'SAFETY_FLATTEN', brokerPositionKey: 'manual-ticket' },
      'CREATE_ORDER',
      true,
    ],
  ] as const)
    it(`rejects ${name} before any broker effect`, async () => {
      const broker = new FakeExecutionBroker();
      const server = new ReadOnlyMt5AgentServer({
        mode: 'FAKE_HARNESS',
        fakeBroker: broker,
        snapshot: () => snap,
        terminalConnected: () => terminalConnected,
      });
      try {
        const ack = await commandAck(
          server,
          patch as Partial<Mt5ExecutionCommand>,
        );
        expect(ack).toMatchObject({ status: 'REJECTED' });
        expect(ack.reason).toContain(reason);
        expect(broker.exposureCount).toBe(0);
      } finally {
        await server.stop();
      }
    });

  it('keeps the real MT5 transport read-only even for an otherwise valid command', async () => {
    const server = new ReadOnlyMt5AgentServer({
      mode: 'MT5_READ_ONLY',
      snapshot: () => snapshot(),
      terminalConnected: () => true,
    });
    try {
      const ack = await commandAck(server, {});
      expect(ack).toMatchObject({ status: 'REJECTED' });
      expect(ack.reason).toContain('read-only');
    } finally {
      await server.stop();
    }
  });

  it('routes MT5_DEMO only through an explicit mutation connector', async () => {
    const connector = new FakeExecutionBroker();
    const server = new ReadOnlyMt5AgentServer({
      mode: 'MT5_DEMO',
      demoBroker: connector,
      snapshot: () => snapshot(),
      terminalConnected: () => true,
    });
    try {
      expect(await commandAck(server, {})).toMatchObject({ status: 'ACCEPTED' });
      expect(connector.exposureCount).toBe(1);
    } finally {
      await server.stop();
    }
  });
});

describe('M11 Agent protection boundary', () => {
  it('applies a valid DEMO stop only to an ARISE-owned broker position', async () => {
    const broker = new FakeExecutionBroker();
    broker.seedPosition('position-1', { volume: 0.6, stop: 1.09 });
    const server = new ReadOnlyMt5AgentServer({ mode: 'FAKE_HARNESS', fakeBroker: broker, snapshot: () => managedSnapshot(), terminalConnected: () => true });
    try {
      expect(await managementAck(server)).toMatchObject({ status: 'VERIFIED', actualStop: 1.1, actualVolume: 0.6 });
      expect(broker.managementEffectCount).toBe(1);
    } finally { await server.stop(); }
  });

  it.each([
    ['live account', managedSnapshot({ isLive: true }), {}, 'demo account'],
    ['manual/external position', managedSnapshot({ external: true }), {}, 'ownership'],
    ['broker quantity changed', managedSnapshot({ volume: 0.4 }), {}, 'quantity'],
    ['worsening stop', managedSnapshot(), { requestedStop: 1.08 }, 'worsening'],
  ] as const)('rejects %s before a broker effect', async (_name, snap, patch, reason) => {
    const broker = new FakeExecutionBroker();
    broker.seedPosition('position-1', { volume: snap.positions[0]!.volume, stop: 1.09 });
    const server = new ReadOnlyMt5AgentServer({ mode: 'FAKE_HARNESS', fakeBroker: broker, snapshot: () => snap, terminalConnected: () => true });
    try {
      const ack = await managementAck(server, patch as Partial<Mt5ManagementCommand>);
      expect(ack.status).toBe('REJECTED');
      expect(ack.reason).toContain(reason);
      expect(broker.managementEffectCount).toBe(0);
    } finally { await server.stop(); }
  });
});
