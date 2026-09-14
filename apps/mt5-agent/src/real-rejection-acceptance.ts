import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  MT5_PROTOCOL_VERSION,
  mt5AgentEnvelopeSchema,
  type Mt5AgentEnvelope,
  type Mt5ExecutionCommand,
} from '@arise/shared';
import { PythonMt5DemoConnector, pythonMt5OptionsFromEnvironment } from './python-demo-connector.js';
import { ReadOnlyMt5AgentServer } from './server.js';

if (process.env.ARISE_RUN_REAL_MT5_REJECTIONS !== '1')
  throw new Error('Set ARISE_RUN_REAL_MT5_REJECTIONS=1 for the real DEMO rejection gate');

const connector = new PythonMt5DemoConnector(pythonMt5OptionsFromEnvironment());
let probe = connector.acceptanceProbe();
if (
  probe.terminalMetadata.accountTradeMode !== 'DEMO' ||
  !probe.terminalMetadata.tradeAllowed ||
  probe.snapshot.account?.isLive !== false ||
  probe.snapshot.positions.length !== 0 ||
  probe.snapshot.pendingOrders.length !== 0
)
  throw new Error('Real rejection matrix requires an empty, trading-enabled DEMO account');
for (let attempt = 0; attempt < 20; attempt += 1) {
  const quote = probe.snapshot.quotes[0];
  const age = quote ? Date.now() - Date.parse(quote.receivedAt) : Infinity;
  if (age >= -1_000 && age <= 5_000) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
  probe = connector.acceptanceProbe();
}
const account = probe.snapshot.account!;
const symbol = probe.snapshot.symbols[0]!;
const quote = probe.snapshot.quotes[0]!;
const server = new ReadOnlyMt5AgentServer({
  mode: 'MT5_DEMO',
  demoBroker: connector,
  snapshot: () => connector.snapshot(),
  terminalConnected: () => connector.terminalConnected(),
});
const address = await server.start();

async function send(
  name: string,
  mutate: (command: Mt5ExecutionCommand) => Mt5ExecutionCommand,
) {
  return new Promise<Readonly<{ name: string; status: string; reason: string | null }>>(
    (resolve, reject) => {
      const socket = connect(address.port, address.host);
      let buffer = '';
      const timeout = setTimeout(() => reject(new Error(`${name} timed out`)), 15_000);
      const write = (messageId: string, payload: object) =>
        socket.write(`${JSON.stringify({ messageId, correlationId: null, schemaVersion: MT5_PROTOCOL_VERSION, sentAt: new Date().toISOString(), payload })}\n`);
      socket.setEncoding('utf8');
      socket.on('connect', () =>
        write(`${name}-hello`, {
          kind: 'HELLO',
          appVersion: 'real-rejection-acceptance',
          protocolVersion: MT5_PROTOCOL_VERSION,
          minimumCompatibleVersion: MT5_PROTOCOL_VERSION,
        }),
      );
      socket.on('error', reject);
      socket.on('data', (chunk) => {
        buffer += chunk;
        for (;;) {
          const end = buffer.indexOf('\n');
          if (end < 0) break;
          const envelope = mt5AgentEnvelopeSchema.parse(
            JSON.parse(buffer.slice(0, end)),
          ) as Mt5AgentEnvelope;
          buffer = buffer.slice(end + 1);
          if (envelope.payload.kind === 'HELLO_ACK') {
            const at = new Date().toISOString();
            const base: Mt5ExecutionCommand = {
              commandId: `${name}-${randomUUID()}`,
              idempotencyKey: `real-rejection:${name}:${randomUUID()}`,
              orderPlanId: `real-rejection-plan:${name}:${randomUUID()}`,
              commandType: 'CREATE_ORDER',
              accountKey: account.accountKey,
              brokerSymbol: symbol.brokerSymbol,
              direction: 'LONG',
              volume: symbol.minVolume,
              initialStop: Number((quote.bid - 0.003).toFixed(symbol.digits)),
              brokerPositionKey: null,
              expectedSessionId: envelope.payload.sessionId,
              createdAt: at,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              maxSpreadPips: 5,
            };
            write(`${name}-command`, {
              kind: 'EXECUTION_COMMAND',
              command: mutate(base),
            });
          } else if (envelope.payload.kind === 'COMMAND_ACK') {
            clearTimeout(timeout);
            socket.destroy();
            resolve({
              name,
              status: envelope.payload.status,
              reason: envelope.payload.reason,
            });
          } else if (envelope.payload.kind === 'ERROR') {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error(`${name}: ${envelope.payload.message}`));
          }
        }
      });
    },
  );
}

try {
  const results = [];
  results.push(await send('invalid-volume', (command) => ({ ...command, volume: 0.011 })));
  results.push(await send('invalid-stop', (command) => ({ ...command, initialStop: quote.ask + 0.001 })));
  results.push(await send('excessive-spread', (command) => ({ ...command, maxSpreadPips: 0 })));
  results.push(await send('unknown-symbol', (command) => ({ ...command, brokerSymbol: 'ARISE.INVALID' })));
  results.push(await send('wrong-account', (command) => ({ ...command, accountKey: 'wrong-account' })));
  results.push(await send('stale-session', (command) => ({ ...command, expectedSessionId: 'stale-session' })));
  if (results.some((result) => result.status !== 'REJECTED'))
    throw new Error(`A real rejection scenario was not rejected: ${JSON.stringify(results)}`);
  const after = connector.acceptanceProbe();
  if (after.snapshot.positions.length !== 0 || after.snapshot.pendingOrders.length !== 0)
    throw new Error('Real rejection matrix changed broker exposure');
  console.log(JSON.stringify({ results, finalPositions: 0, finalPendingOrders: 0 }, null, 2));
} finally {
  await server.stop();
}
