import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mt5AgentPayloadSchema,
  mt5SnapshotSchema,
  type Mt5ExecutionCommand,
  type Mt5ManagementCommand,
  type Mt5Snapshot,
} from '@arise/shared';
import type { BrokerMutationConnector } from './server.js';

export interface RealMt5SymbolMapping {
  readonly canonicalSymbol: string;
  readonly brokerSymbol: string;
  readonly pipSize: number;
}

export interface PythonMt5DemoConnectorOptions {
  readonly pythonExecutable: string;
  readonly terminalPath: string;
  readonly ledgerPath: string;
  readonly symbolMappings: readonly RealMt5SymbolMapping[];
  readonly timeframes?: readonly string[];
  readonly historyBars?: number | undefined;
  readonly historyBarsByTimeframe?: Readonly<Record<string, number>> | undefined;
  readonly magic?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly invoke?: (request: Readonly<Record<string, unknown>>) => unknown;
}

export interface RealMt5Probe {
  readonly snapshot: Mt5Snapshot;
  readonly terminalMetadata: Readonly<{
    build: number;
    company: string;
    connected: boolean;
    tradeAllowed: boolean;
    externalApiDisabled: boolean;
    accountTradeAllowed: boolean;
    accountTradeExpert: boolean;
    accountTradeMode: 'DEMO' | 'CONTEST' | 'REAL';
    server: string;
  }>;
}

type AgentPayload = ReturnType<typeof mt5AgentPayloadSchema.parse>;

const bridgePath = process.env.ARISE_MT5_BRIDGE_PATH?.trim() || fileURLToPath(
  new URL('../python/mt5_bridge.py', import.meta.url),
);
const marketDataBridgePath = process.env.ARISE_MT5_MARKET_DATA_BRIDGE_PATH?.trim() || fileURLToPath(
  new URL('../python/mt5_market_data_bridge.py', import.meta.url),
);
const DEFAULT_MARKET_DATA_TIMEFRAMES = Object.freeze([
  'M1',
  'M5',
  'M15',
  'H1',
  'H4',
  'D1',
  'W1',
] as const);
const DEFAULT_HISTORY_BARS_BY_TIMEFRAME = Object.freeze({
  M1: 5_000,
  M5: 5_000,
  M15: 4_000,
  H1: 3_000,
  H4: 2_000,
  D1: 1_500,
  W1: 520,
} as const);
const LIVE_TAIL_BARS = 3;
const DEEP_HISTORY_REFRESH_EVERY = 300;

function rejectedExecution(
  command: Mt5ExecutionCommand,
  reason: string,
): AgentPayload {
  return mt5AgentPayloadSchema.parse({
    kind: 'COMMAND_ACK',
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    status: 'REJECTED',
    brokerOrderKey: null,
    reason,
  });
}

function rejectedManagement(
  command: Mt5ManagementCommand,
  reason: string,
): AgentPayload {
  return mt5AgentPayloadSchema.parse({
    kind: 'MANAGEMENT_ACK',
    eventId: randomUUID(),
    commandId: command.commandId,
    protectionRequestId: command.protectionRequestId,
    idempotencyKey: command.idempotencyKey,
    brokerEffectId: `rejected:${command.idempotencyKey}`,
    brokerPositionKey: command.brokerPositionKey,
    sequence: command.sequence,
    status: 'REJECTED',
    actualVolume: command.expectedBrokerVolume,
    actualStop: null,
    actualTakeProfit: null,
    closedVolume: 0,
    reason,
    occurredAt: new Date().toISOString(),
  });
}

export class PythonMt5DemoConnector implements BrokerMutationConnector {
  private lastSnapshot: Mt5Snapshot | null = null;
  private lastTerminalMetadata: RealMt5Probe['terminalMetadata'] | null = null;
  private snapshotRequestCount = 0;
  private readonly quoteObservations = new Map<
    string,
    Readonly<{ sequence: number; receivedAt: string }>
  >();

  constructor(private readonly options: PythonMt5DemoConnectorOptions) {
    if (!options.pythonExecutable.trim())
      throw new Error('A Python executable is required for MT5 DEMO transport');
    if (!options.terminalPath.trim())
      throw new Error('An explicit MT5 terminal path is required');
    if (!options.ledgerPath.trim())
      throw new Error('A durable Agent ledger path is required');
    if (!options.symbolMappings.length)
      throw new Error('At least one explicit broker symbol mapping is required');
    for (const mapping of options.symbolMappings) {
      if (
        !mapping.canonicalSymbol.trim() ||
        !mapping.brokerSymbol.trim() ||
        !Number.isFinite(mapping.pipSize) ||
        mapping.pipSize <= 0
      )
        throw new Error('Invalid MT5 broker symbol mapping');
    }
  }

  snapshot(): Mt5Snapshot {
    try {
      const snapshot = this.acceptanceProbe().snapshot;
      this.lastSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      this.snapshotRequestCount = 0;
      const snapshot = mt5SnapshotSchema.parse({
        snapshotId: randomUUID(),
        complete: false,
        capturedAt: new Date().toISOString(),
        account: null,
        symbols: [],
        positions: [],
        pendingOrders: [],
        quotes: [],
        candles: [],
        unavailableReason: `Real MT5 connector unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
      this.lastSnapshot = snapshot;
      return snapshot;
    }
  }

  acceptanceProbe(): RealMt5Probe {
    const result = this.invoke('snapshot');
    const snapshot = this.normalizeQuoteReceipt(
      mt5SnapshotSchema.parse(result.snapshot),
    );
    const metadata = result.terminalMetadata as Record<string, unknown> | undefined;
    if (
      !metadata ||
      typeof metadata.build !== 'number' ||
      typeof metadata.company !== 'string' ||
      typeof metadata.connected !== 'boolean' ||
      typeof metadata.tradeAllowed !== 'boolean' ||
      typeof metadata.externalApiDisabled !== 'boolean' ||
      typeof metadata.accountTradeAllowed !== 'boolean' ||
      typeof metadata.accountTradeExpert !== 'boolean' ||
      !['DEMO', 'CONTEST', 'REAL'].includes(String(metadata.accountTradeMode)) ||
      typeof metadata.server !== 'string'
    )
      throw new Error('MT5 bridge returned invalid terminal metadata');
    this.lastSnapshot = snapshot;
    const terminalMetadata = Object.freeze({
      build: metadata.build,
      company: metadata.company,
      connected: metadata.connected,
      tradeAllowed: metadata.tradeAllowed,
      externalApiDisabled: metadata.externalApiDisabled,
      accountTradeAllowed: metadata.accountTradeAllowed,
      accountTradeExpert: metadata.accountTradeExpert,
      accountTradeMode: metadata.accountTradeMode as 'DEMO' | 'CONTEST' | 'REAL',
      server: metadata.server,
    });
    this.lastTerminalMetadata = terminalMetadata;
    return Object.freeze({
      snapshot,
      terminalMetadata,
    });
  }

  terminalConnected(): boolean {
    const snapshot = this.lastSnapshot ?? this.snapshot();
    const terminal = this.lastTerminalMetadata;
    return (
      snapshot.complete &&
      snapshot.account !== null &&
      terminal !== null &&
      terminal.connected &&
      terminal.tradeAllowed &&
      !terminal.externalApiDisabled &&
      terminal.accountTradeAllowed &&
      terminal.accountTradeExpert
    );
  }

  hasApplied(idempotencyKey: string): boolean {
    try {
      const ledger = JSON.parse(
        readFileSync(this.options.ledgerPath, 'utf8'),
      ) as {
        readonly commands?: Readonly<
          Record<string, Readonly<{ state?: unknown }>>
        >;
      };
      const state = ledger.commands?.[idempotencyKey]?.state;
      return state === 'PREPARED' || state === 'APPLIED';
    } catch {
      return false;
    }
  }

  execute(command: Mt5ExecutionCommand): {
    readonly payloads: readonly AgentPayload[];
    readonly disconnectAfter: number | null;
  } {
    const unsafe = this.mutationBlockReason(
      command.accountKey,
      command.brokerSymbol,
    );
    if (unsafe)
      return {
        payloads: Object.freeze([rejectedExecution(command, unsafe)]),
        disconnectAfter: null,
      };
    try {
      return {
        payloads: this.parsePayloads(this.invoke('execute', command).payloads),
        disconnectAfter: null,
      };
    } catch {
      return { payloads: Object.freeze([]), disconnectAfter: null };
    }
  }

  executeManagement(command: Mt5ManagementCommand): {
    readonly payloads: readonly AgentPayload[];
    readonly disconnectAfter: number | null;
  } {
    const unsafe = this.mutationBlockReason(
      command.accountKey,
      command.brokerSymbol,
    );
    if (unsafe)
      return {
        payloads: Object.freeze([rejectedManagement(command, unsafe)]),
        disconnectAfter: null,
      };
    try {
      return {
        payloads: this.parsePayloads(this.invoke('manage', command).payloads),
        disconnectAfter: null,
      };
    } catch {
      return { payloads: Object.freeze([]), disconnectAfter: null };
    }
  }

  private mutationBlockReason(
    expectedAccountKey: string,
    brokerSymbol: string,
  ): string | null {
    const snapshot = this.snapshot();
    if (!snapshot.complete || !snapshot.account)
      return 'Real MT5 broker truth is incomplete; mutation is blocked';
    const terminal = this.lastTerminalMetadata;
    if (
      !terminal ||
      !terminal.connected ||
      !terminal.tradeAllowed ||
      terminal.externalApiDisabled ||
      !terminal.accountTradeAllowed ||
      !terminal.accountTradeExpert
    )
      return 'MT5 terminal/account trading permission is unhealthy; mutation is blocked';
    if (snapshot.account.isLive)
      return 'LIVE/contest account detected by MT5; demo-only connector blocked mutation before order_send';
    if (snapshot.account.accountKey !== expectedAccountKey)
      return 'MT5 account identity changed; mutation is blocked';
    const quote = snapshot.quotes.find(
      (item) => item.brokerSymbol === brokerSymbol,
    );
    const quoteAge = quote
      ? (this.options.now?.() ?? Date.now()) - Date.parse(quote.receivedAt)
      : Number.POSITIVE_INFINITY;
    if (!quote || quoteAge < -1_000 || quoteAge > 5_000)
      return 'MT5 quote sequence has not advanced recently; mutation is blocked';
    return null;
  }

  private normalizeQuoteReceipt(snapshot: Mt5Snapshot): Mt5Snapshot {
    const observedAtMs = this.options.now?.() ?? Date.now();
    const observedAt = new Date(observedAtMs).toISOString();
    const unavailableAt = new Date(0).toISOString();
    const quotes = snapshot.quotes.map((quote) => {
      const prior = this.quoteObservations.get(quote.brokerSymbol);
      let receivedAt = unavailableAt;
      if (prior && quote.sequence > prior.sequence) receivedAt = observedAt;
      else if (prior && quote.sequence === prior.sequence)
        receivedAt = prior.receivedAt;
      if (!prior || quote.sequence > prior.sequence)
        this.quoteObservations.set(
          quote.brokerSymbol,
          Object.freeze({ sequence: quote.sequence, receivedAt }),
        );
      return Object.freeze({ ...quote, receivedAt });
    });
    return mt5SnapshotSchema.parse({ ...snapshot, quotes });
  }

  private parsePayloads(raw: unknown): readonly AgentPayload[] {
    if (!Array.isArray(raw)) throw new Error('MT5 bridge omitted payloads');
    return Object.freeze(raw.map((payload) => mt5AgentPayloadSchema.parse(payload)));
  }

  private deepHistoryBars(): Readonly<Record<string, number>> {
    if (this.options.historyBarsByTimeframe)
      return this.options.historyBarsByTimeframe;
    if (this.options.historyBars !== undefined)
      return Object.fromEntries(
        (this.options.timeframes ?? DEFAULT_MARKET_DATA_TIMEFRAMES).map((timeframe) => [
          timeframe,
          this.options.historyBars!,
        ]),
      );
    return DEFAULT_HISTORY_BARS_BY_TIMEFRAME;
  }

  private invoke(
    operation: 'snapshot' | 'execute' | 'manage',
    command?: Mt5ExecutionCommand | Mt5ManagementCommand,
  ): {
    readonly snapshot?: unknown;
    readonly payloads?: unknown;
    readonly terminalMetadata?: unknown;
  } {
    const snapshotIndex = operation === 'snapshot' ? this.snapshotRequestCount++ : -1;
    const deepHistory = operation === 'snapshot' && (
      snapshotIndex < 2 || snapshotIndex % DEEP_HISTORY_REFRESH_EVERY === 0
    );
    const request = Object.freeze({
      operation,
      terminalPath: this.options.terminalPath,
      ledgerPath: this.options.ledgerPath,
      symbolMappings: this.options.symbolMappings,
      timeframes: this.options.timeframes ?? DEFAULT_MARKET_DATA_TIMEFRAMES,
      historyBars: deepHistory ? undefined : LIVE_TAIL_BARS,
      historyBarsByTimeframe: deepHistory ? this.deepHistoryBars() : undefined,
      magic: this.options.magic ?? 260912,
      ...(command ? { command } : {}),
    });
    if (this.options.invoke)
      return this.options.invoke(request) as {
        readonly snapshot?: unknown;
        readonly payloads?: unknown;
        readonly terminalMetadata?: unknown;
      };
    const result = spawnSync(
      this.options.pythonExecutable,
      [operation === 'snapshot' ? marketDataBridgePath : bridgePath],
      {
        input: JSON.stringify(request),
        encoding: 'utf8',
        windowsHide: true,
        timeout: this.options.timeoutMs ?? 30_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(result.stderr.trim() || `MT5 bridge exited ${result.status}`);
    const output = JSON.parse(result.stdout) as {
      readonly ok?: boolean;
      readonly error?: string;
      readonly snapshot?: unknown;
      readonly payloads?: unknown;
      readonly terminalMetadata?: unknown;
    };
    if (!output.ok) throw new Error(output.error ?? 'MT5 bridge failed');
    return output as {
      readonly snapshot?: unknown;
      readonly payloads?: unknown;
      readonly terminalMetadata?: unknown;
    };
  }
}

export function pythonMt5OptionsFromEnvironment(): PythonMt5DemoConnectorOptions {
  const rawMappings = process.env.ARISE_MT5_SYMBOLS_JSON;
  if (!rawMappings)
    throw new Error('ARISE_MT5_SYMBOLS_JSON is required for explicit real-terminal mappings');
  const mappings = JSON.parse(rawMappings) as RealMt5SymbolMapping[];
  const rawHistoryMap = process.env.ARISE_MT5_HISTORY_BARS_JSON?.trim();
  const legacyHistoryBars = process.env.ARISE_MT5_HISTORY_BARS?.trim();
  return {
    pythonExecutable: process.env.ARISE_MT5_PYTHON ?? 'python',
    terminalPath: process.env.ARISE_MT5_TERMINAL_PATH ?? '',
    ledgerPath:
      process.env.ARISE_MT5_LEDGER_PATH ??
      path.join(
        process.env.LOCALAPPDATA ?? process.cwd(),
        'ARISE',
        'mt5-agent-ledger.json',
      ),
    symbolMappings: mappings,
    timeframes: (process.env.ARISE_MT5_TIMEFRAMES ?? DEFAULT_MARKET_DATA_TIMEFRAMES.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    historyBarsByTimeframe: rawHistoryMap
      ? JSON.parse(rawHistoryMap) as Record<string, number>
      : undefined,
    historyBars: legacyHistoryBars ? Number(legacyHistoryBars) : undefined,
    magic: Number(process.env.ARISE_MT5_MAGIC ?? 260912),
  };
}