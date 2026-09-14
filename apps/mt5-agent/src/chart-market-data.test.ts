import { describe, expect, it } from 'vitest';
import { mt5SnapshotSchema } from '@arise/shared';
import { PythonMt5DemoConnector } from './python-demo-connector';

const stamp = '2026-09-14T12:00:00.000Z';

function snapshot() {
  return mt5SnapshotSchema.parse({
    snapshotId: 'chart-snapshot',
    complete: true,
    capturedAt: stamp,
    account: {
      accountKey: 'demo-account',
      broker: 'Broker',
      server: 'Demo',
      login: 'redacted',
      currency: 'USD',
      balance: 10_000,
      equity: 10_000,
      margin: 0,
      freeMargin: 10_000,
      leverage: 100,
      isLive: false,
      hedging: true,
      capturedAt: stamp,
    },
    symbols: [{
      brokerSymbol: 'EURUSD.i',
      canonicalSymbol: 'EURUSD',
      digits: 5,
      tickSize: 0.00001,
      pipSize: 0.0001,
      contractSize: 100_000,
      minVolume: 0.01,
      volumeStep: 0.01,
      maxVolume: 100,
      stopsLevel: 0,
      freezeLevel: 0,
    }],
    positions: [],
    pendingOrders: [],
    quotes: [{
      brokerSymbol: 'EURUSD.i',
      bid: 1.1,
      ask: 1.1001,
      brokerTime: stamp,
      receivedAt: stamp,
      sequence: 1,
    }],
    candles: [],
    unavailableReason: null,
  });
}

describe('chart market-data snapshot defaults', () => {
  it('requests all chart timeframes with enough history for a useful chart', () => {
    let request: Readonly<Record<string, unknown>> | null = null;
    const connector = new PythonMt5DemoConnector({
      pythonExecutable: 'python',
      terminalPath: 'terminal64.exe',
      ledgerPath: 'ledger.json',
      symbolMappings: [{ canonicalSymbol: 'EURUSD', brokerSymbol: 'EURUSD.i', pipSize: 0.0001 }],
      invoke: (value) => {
        request = value;
        return {
          ok: true,
          snapshot: snapshot(),
          terminalMetadata: {
            build: 5833,
            company: 'MetaQuotes Ltd.',
            connected: true,
            tradeAllowed: true,
            externalApiDisabled: false,
            accountTradeAllowed: true,
            accountTradeExpert: true,
            accountTradeMode: 'DEMO',
            server: 'Broker-Demo',
          },
        };
      },
    });

    connector.acceptanceProbe();

    expect(request).toMatchObject({
      operation: 'snapshot',
      timeframes: ['M1', 'M5', 'M15', 'H1', 'H4', 'D1', 'W1'],
      historyBars: 300,
    });
  });
});
