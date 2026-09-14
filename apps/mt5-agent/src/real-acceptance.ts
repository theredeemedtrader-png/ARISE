import { connect } from 'node:net';
import {
  MT5_PROTOCOL_VERSION,
  mt5AgentEnvelopeSchema,
  type Mt5AgentEnvelope,
  type Mt5ExecutionCommand,
} from '@arise/shared';
import { PythonMt5DemoConnector, pythonMt5OptionsFromEnvironment } from './python-demo-connector';
import { ReadOnlyMt5AgentServer } from './server';

async function transportGuardProbe(
  connector: PythonMt5DemoConnector,
  command: Mt5ExecutionCommand,
): Promise<Readonly<{transportMode:string;status:string;reason:string|null}>> {
  const server=new ReadOnlyMt5AgentServer({
    mode:'MT5_DEMO',demoBroker:connector,snapshot:()=>connector.snapshot(),
    terminalConnected:()=>connector.terminalConnected(),
  });
  const address=await server.start();
  try {
    return await new Promise((resolve,reject)=>{
      const socket=connect(address.port,address.host,()=>socket.write(`${JSON.stringify({messageId:'probe-hello',correlationId:null,schemaVersion:MT5_PROTOCOL_VERSION,sentAt:new Date().toISOString(),payload:{kind:'HELLO',appVersion:'acceptance-probe',protocolVersion:MT5_PROTOCOL_VERSION,minimumCompatibleVersion:MT5_PROTOCOL_VERSION}})}\n`));
      let buffer='',transportMode='UNKNOWN';
      socket.setEncoding('utf8');
      socket.on('data',(chunk)=>{
        buffer+=chunk;
        for(;;){
          const end=buffer.indexOf('\n');if(end<0)break;
          const envelope=mt5AgentEnvelopeSchema.parse(JSON.parse(buffer.slice(0,end))) as Mt5AgentEnvelope;buffer=buffer.slice(end+1);
          if(envelope.payload.kind==='HELLO_ACK'){
            transportMode=envelope.payload.transportMode;
            socket.write(`${JSON.stringify({messageId:'probe-execute',correlationId:null,schemaVersion:MT5_PROTOCOL_VERSION,sentAt:new Date().toISOString(),payload:{kind:'EXECUTION_COMMAND',command:{...command,expectedSessionId:envelope.payload.sessionId}}})}\n`);
          } else if(envelope.payload.kind==='COMMAND_ACK'){
            socket.destroy();resolve(Object.freeze({transportMode,status:envelope.payload.status,reason:envelope.payload.reason}));
          }
        }
      });
      socket.on('error',reject);
    });
  } finally { await server.stop(); }
}

const connector = new PythonMt5DemoConnector(pythonMt5OptionsFromEnvironment());
const before = connector.acceptanceProbe();
const account = before.snapshot.account;
if (!account) throw new Error('MT5 account truth is unavailable');

const stamp = new Date().toISOString();
const probeCommand:Mt5ExecutionCommand = {
  commandId: 'real-terminal-live-guard-probe',
  idempotencyKey: 'real-terminal-live-guard-probe',
  orderPlanId: 'real-terminal-live-guard-probe',
  commandType: 'CREATE_ORDER',
  accountKey: account.accountKey,
  brokerSymbol: before.snapshot.symbols[0]?.brokerSymbol ?? 'UNAVAILABLE',
  direction: 'LONG',
  volume: before.snapshot.symbols[0]?.minVolume ?? 0.01,
  initialStop: 1,
  brokerPositionKey: null,
  expectedSessionId: 'probe-session',
  createdAt: stamp,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  maxSpreadPips: 0,
};
const liveGuard = connector.execute(probeCommand);
const transportGuard=await transportGuardProbe(connector,probeCommand);
const after = connector.acceptanceProbe();
const rejection = liveGuard.payloads.find((payload) => payload.kind === 'COMMAND_ACK');
const unchanged =
  before.snapshot.positions.length === after.snapshot.positions.length &&
  before.snapshot.pendingOrders.length === after.snapshot.pendingOrders.length;

const summary = {
  terminalBuild: before.terminalMetadata.build,
  terminalCompany: before.terminalMetadata.company,
  brokerServer: before.terminalMetadata.server,
  accountTradeMode: before.terminalMetadata.accountTradeMode,
  terminalConnected: before.terminalMetadata.connected,
  terminalTradeAllowed: before.terminalMetadata.tradeAllowed,
  externalApiDisabled: before.terminalMetadata.externalApiDisabled,
  accountTradeAllowed: before.terminalMetadata.accountTradeAllowed,
  accountTradeExpert: before.terminalMetadata.accountTradeExpert,
  hedging: account.hedging,
  configuredSymbols: before.snapshot.symbols.map((symbol) => symbol.brokerSymbol),
  openPositionCountBefore: before.snapshot.positions.length,
  openPositionCountAfter: after.snapshot.positions.length,
  pendingOrderCountBefore: before.snapshot.pendingOrders.length,
  pendingOrderCountAfter: after.snapshot.pendingOrders.length,
  liveGuardStatus: rejection?.kind === 'COMMAND_ACK' ? rejection.status : 'NO_RESULT',
  liveGuardReason: rejection?.kind === 'COMMAND_ACK' ? rejection.reason : null,
  transportMode:transportGuard.transportMode,
  transportGuardStatus:transportGuard.status,
  transportGuardReason:transportGuard.reason,
  brokerStateUnchanged: unchanged,
  demoAcceptanceEligible: before.terminalMetadata.accountTradeMode === 'DEMO',
  demoContextHealthy:
    before.snapshot.complete &&
    before.terminalMetadata.connected &&
    before.terminalMetadata.tradeAllowed &&
    !before.terminalMetadata.externalApiDisabled &&
    before.terminalMetadata.accountTradeAllowed &&
    before.terminalMetadata.accountTradeExpert &&
    account.hedging,
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.demoAcceptanceEligible || !summary.demoContextHealthy || summary.liveGuardStatus !== 'REJECTED' || summary.transportGuardStatus !== 'REJECTED' || summary.transportMode !== 'MT5_DEMO' || !unchanged)
  process.exitCode = 2;
