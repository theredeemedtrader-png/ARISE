import { ReadOnlyMt5AgentServer, unavailableSnapshot } from './server';
import { PythonMt5DemoConnector, pythonMt5OptionsFromEnvironment } from './python-demo-connector';

const demoRequested = process.env.ARISE_MT5_MODE === 'DEMO';
const connectorRequested = process.env.ARISE_MT5_CONNECTOR === 'PYTHON';
const connector = connectorRequested
  ? new PythonMt5DemoConnector(pythonMt5OptionsFromEnvironment())
  : null;
const server=new ReadOnlyMt5AgentServer({
  host:'127.0.0.1',
  port:Number(process.env.ARISE_MT5_AGENT_PORT??19781),
  mode:demoRequested && connector?'MT5_DEMO':'MT5_READ_ONLY',
  terminalConnected:()=>connector?.terminalConnected()??false,
  snapshot:()=>connector?.snapshot()??unavailableSnapshot(),
  ...(demoRequested && connector?{demoBroker:connector}:{}),
});
const address=await server.start();
console.log(demoRequested && connector
  ? `ARISE demo-only MT5 Agent listening on ${address.host}:${address.port}; LIVE/contest accounts are hard-blocked.`
  : `ARISE MT5 read-only agent listening on ${address.host}:${address.port}; terminal mutation is disabled${connector ? '' : ' and no terminal connector is configured'}.`);
const snapshotTimer=connector?setInterval(()=>server.broadcastSnapshot(),2_000):null;
snapshotTimer?.unref();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{
  if(snapshotTimer)clearInterval(snapshotTimer);
  void server.stop().then(()=>process.exit(0));
});
