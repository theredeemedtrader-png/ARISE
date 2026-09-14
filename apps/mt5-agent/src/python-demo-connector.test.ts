import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mt5SnapshotSchema, type Mt5ExecutionCommand } from '@arise/shared';
import { PythonMt5DemoConnector } from './python-demo-connector';

const stamp = '2026-09-12T12:00:00.000Z';
function snapshot(isLive: boolean, sequence = 1, brokerTime = stamp) {
  return mt5SnapshotSchema.parse({
    snapshotId: 'snapshot-1',
    complete: true,
    capturedAt: stamp,
    account: {
      accountKey: 'account-key', broker: 'Broker', server: isLive ? 'Live' : 'Demo',
      login: 'redacted', currency: 'USD', balance: 10_000, equity: 10_000,
      margin: 0, freeMargin: 10_000, leverage: 100, isLive, hedging: true,
      capturedAt: stamp,
    },
    symbols: [{
      brokerSymbol: 'EURUSD.i', canonicalSymbol: 'EURUSD', digits: 5,
      tickSize: 0.00001, pipSize: 0.0001, contractSize: 100_000,
      minVolume: 0.01, volumeStep: 0.01, maxVolume: 100,
      stopsLevel: 0, freezeLevel: 0,
    }],
    positions: [], pendingOrders: [],
    quotes: [{brokerSymbol:'EURUSD.i',bid:1.1,ask:1.1001,brokerTime,receivedAt:brokerTime,sequence}],
    candles: [], unavailableReason: null,
  });
}

function command(): Mt5ExecutionCommand {
  return {
    commandId:'command-1', idempotencyKey:'plan:1:create', orderPlanId:'plan-1',
    commandType:'CREATE_ORDER', accountKey:'account-key', brokerSymbol:'EURUSD.i',
    direction:'LONG', volume:0.01, initialStop:1.09, brokerPositionKey:null,
    expectedSessionId:'session-1', createdAt:stamp, expiresAt:'2099-01-01T00:00:00.000Z',
    maxSpreadPips:2,
  };
}

function result(isLive: boolean, tradeAllowed = true, accountTradeMode?: 'DEMO' | 'CONTEST' | 'REAL') {
  return {
    ok:true,
    snapshot:snapshot(isLive),
    terminalMetadata:{build:5833,company:'MetaQuotes Ltd.',connected:true,tradeAllowed,externalApiDisabled:false,accountTradeAllowed:true,accountTradeExpert:true,accountTradeMode:accountTradeMode ?? (isLive?'REAL':'DEMO'),server:isLive?'Broker-Live':'Broker-Demo'},
  };
}

describe('real MT5 demo connector boundary', () => {
  it('recognizes only durable PREPARED/APPLIED identities for restart replay', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'arise-ledger-'));
    const ledgerPath = path.join(directory, 'ledger.json');
    try {
      const connector = new PythonMt5DemoConnector({
        pythonExecutable:'python',terminalPath:'terminal64.exe',ledgerPath,
        symbolMappings:[{canonicalSymbol:'EURUSD',brokerSymbol:'EURUSD.i',pipSize:.0001}],
        invoke:()=>result(false),
      });
      expect(connector.hasApplied('known')).toBe(false);
      writeFileSync(ledgerPath, JSON.stringify({version:1,commands:{known:{state:'PREPARED'},done:{state:'APPLIED'},other:{state:'FAILED'}}}));
      expect(connector.hasApplied('known')).toBe(true);
      expect(connector.hasApplied('done')).toBe(true);
      expect(connector.hasApplied('other')).toBe(false);
      expect(connector.hasApplied('missing')).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('hard-blocks a real account before invoking a mutation operation', () => {
    const operations:string[]=[];
    const connector=new PythonMt5DemoConnector({
      pythonExecutable:'python',terminalPath:'terminal64.exe',ledgerPath:'ledger.json',
      symbolMappings:[{canonicalSymbol:'EURUSD',brokerSymbol:'EURUSD.i',pipSize:.0001}],
      invoke:(request)=>{operations.push(String(request.operation));return result(true);},
    });
    expect(connector.execute(command()).payloads[0]).toMatchObject({status:'REJECTED'});
    expect(operations).toEqual(['snapshot']);
  });

  it('passes a verified demo command to the bridge and validates returned payloads', () => {
    const operations:string[]=[];
    let sequence=0;
    const connector=new PythonMt5DemoConnector({
      pythonExecutable:'python',terminalPath:'terminal64.exe',ledgerPath:'ledger.json',
      symbolMappings:[{canonicalSymbol:'EURUSD',brokerSymbol:'EURUSD.i',pipSize:.0001}],
      invoke:(request)=>{
        operations.push(String(request.operation));
        if(request.operation==='snapshot')return {...result(false),snapshot:snapshot(false,++sequence)};
        return {ok:true,payloads:[{kind:'COMMAND_ACK',commandId:'command-1',idempotencyKey:'plan:1:create',status:'ACCEPTED',brokerOrderKey:'1',reason:null}]};
      },
    });
    connector.acceptanceProbe();
    expect(connector.execute(command()).payloads[0]).toMatchObject({kind:'COMMAND_ACK',status:'ACCEPTED'});
    expect(operations).toEqual(['snapshot','snapshot','execute']);
  });

  it('blocks disabled terminal trading before invoking a mutation operation', () => {
    const operations:string[]=[];
    const connector=new PythonMt5DemoConnector({
      pythonExecutable:'python',terminalPath:'terminal64.exe',ledgerPath:'ledger.json',
      symbolMappings:[{canonicalSymbol:'EURUSD',brokerSymbol:'EURUSD.i',pipSize:.0001}],
      invoke:(request)=>{operations.push(String(request.operation));return result(false, false);},
    });
    expect(connector.execute(command()).payloads[0]).toMatchObject({status:'REJECTED',reason:expect.stringContaining('permission')});
    expect(connector.terminalConnected()).toBe(false);
    expect(operations).toEqual(['snapshot']);
  });

  it('hard-blocks a contest account before invoking a mutation operation', () => {
    const operations:string[]=[];
    const connector=new PythonMt5DemoConnector({
      pythonExecutable:'python',terminalPath:'terminal64.exe',ledgerPath:'ledger.json',
      symbolMappings:[{canonicalSymbol:'EURUSD',brokerSymbol:'EURUSD.i',pipSize:.0001}],
      invoke:(request)=>{operations.push(String(request.operation));return result(true, true, 'CONTEST');},
    });
    expect(connector.execute(command()).payloads[0]).toMatchObject({status:'REJECTED'});
    expect(operations).toEqual(['snapshot']);
  });

  it('turns an uncertain bridge failure into no broker result so Desktop reconciliation owns recovery', () => {
    let sequence=0;
    const connector=new PythonMt5DemoConnector({
      pythonExecutable:'python',terminalPath:'terminal64.exe',ledgerPath:'ledger.json',
      symbolMappings:[{canonicalSymbol:'EURUSD',brokerSymbol:'EURUSD.i',pipSize:.0001}],
      invoke:(request)=>{if(request.operation==='snapshot')return {...result(false),snapshot:snapshot(false,++sequence)};throw new Error('lost after send');},
    });
    connector.acceptanceProbe();
    expect(connector.execute(command()).payloads).toEqual([]);
  });

  it('uses locally observed sequence progress instead of future broker-server time for freshness', () => {
    const operations:string[]=[];
    let sequence=40;
    let now=Date.parse('2026-09-14T02:30:00.000Z');
    const connector=new PythonMt5DemoConnector({
      pythonExecutable:'python',terminalPath:'terminal64.exe',ledgerPath:'ledger.json',now:()=>now,
      symbolMappings:[{canonicalSymbol:'EURUSD',brokerSymbol:'EURUSD.i',pipSize:.0001}],
      invoke:(request)=>{
        operations.push(String(request.operation));
        if(request.operation==='snapshot')return {...result(false),snapshot:snapshot(false,sequence,'2026-09-14T05:30:00.000Z')};
        return {ok:true,payloads:[{kind:'COMMAND_ACK',commandId:'command-1',idempotencyKey:'plan:1:create',status:'ACCEPTED',brokerOrderKey:'1',reason:null}]};
      },
    });
    const first=connector.acceptanceProbe().snapshot.quotes[0]!;
    expect(first.brokerTime).toBe('2026-09-14T05:30:00.000Z');
    expect(first.receivedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(connector.execute(command()).payloads[0]).toMatchObject({status:'REJECTED',reason:expect.stringContaining('sequence')});
    expect(operations).toEqual(['snapshot','snapshot']);
    sequence+=1;
    expect(connector.execute(command()).payloads[0]).toMatchObject({status:'ACCEPTED'});
    expect(operations).toEqual(['snapshot','snapshot','snapshot','execute']);
    now+=5_001;
    expect(connector.execute(command()).payloads[0]).toMatchObject({status:'REJECTED',reason:expect.stringContaining('sequence')});
    expect(operations).toEqual(['snapshot','snapshot','snapshot','execute','snapshot']);
  });
});
