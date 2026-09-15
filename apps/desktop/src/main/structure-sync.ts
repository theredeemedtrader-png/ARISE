import {
  InstrumentRepository,
  MarketObjectRepository,
  Mt5Repository,
  StructureMarketObjectRepository,
  TimeframeRepository,
} from '@arise/database';
import {
  analyzeNestedLegStructure,
  type MarketCandle,
  type StructuralDegree,
} from '@arise/strategy-engine';

export interface StructureThresholds {
  readonly MICRO: number;
  readonly INTERIOR: number;
  readonly EXTERIOR: number;
}

export interface StructureSyncConfiguration {
  readonly timeframes: Readonly<Record<string, StructureThresholds>>;
  readonly equalityTolerancePips: number;
  readonly intervalMs: number;
}

const MT5_TO_CHART_TIMEFRAME: Readonly<Record<string, string>> = Object.freeze({
  M5: 'M5',
  M15: 'M15',
  H1: 'H1',
  H4: 'H4',
  D1: 'D',
  W1: 'W',
});

/**
 * Initial development calibration only. These values are not strategy meaning
 * and are deliberately overrideable. Exact ATR/structural/hybrid calibration
 * remains a later acceptance task.
 */
const DEFAULT_PREVIEW_THRESHOLDS: Readonly<Record<string, StructureThresholds>> = Object.freeze({
  H1: Object.freeze({ MICRO: 8, INTERIOR: 20, EXTERIOR: 50 }),
});

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
}

function parseThresholds(raw: string | undefined): Readonly<Record<string, StructureThresholds>> {
  if (!raw?.trim()) return DEFAULT_PREVIEW_THRESHOLDS;
  const value = JSON.parse(raw) as Record<string, Partial<Record<StructuralDegree, unknown>>>;
  const result: Record<string, StructureThresholds> = {};
  for (const [timeframe, entry] of Object.entries(value)) {
    if (!MT5_TO_CHART_TIMEFRAME[timeframe])
      throw new Error(`Unsupported structure timeframe ${timeframe}`);
    const micro = positive(Number(entry.MICRO), `${timeframe}.MICRO`);
    const interior = positive(Number(entry.INTERIOR), `${timeframe}.INTERIOR`);
    const exterior = positive(Number(entry.EXTERIOR), `${timeframe}.EXTERIOR`);
    if (!(micro < interior && interior < exterior))
      throw new Error(`${timeframe} structure thresholds must satisfy MICRO < INTERIOR < EXTERIOR`);
    result[timeframe] = Object.freeze({ MICRO: micro, INTERIOR: interior, EXTERIOR: exterior });
  }
  return Object.freeze(result);
}

export function structureSyncConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): StructureSyncConfiguration {
  const intervalMs = Math.max(2_000, Number(environment.ARISE_STRUCTURE_SYNC_INTERVAL_MS ?? 10_000));
  const equalityTolerancePips = Math.max(0, Number(environment.ARISE_STRUCTURE_EQUALITY_TOLERANCE_PIPS ?? 0.5));
  if (!Number.isFinite(intervalMs) || !Number.isFinite(equalityTolerancePips))
    throw new Error('Invalid structure synchronization configuration');
  return Object.freeze({
    timeframes: parseThresholds(environment.ARISE_STRUCTURE_REVERSAL_PIPS_JSON),
    equalityTolerancePips,
    intervalMs,
  });
}

function candleIdentity(symbol: string, timeframe: string, openTime: string): string {
  return `mt5:${symbol}:${timeframe}:${Date.parse(openTime)}`;
}

function lastClosedSignature(candles: readonly MarketCandle[]): string {
  const last = candles[candles.length - 1];
  return last ? `${candles.length}:${last.id}:${last.close}` : 'empty';
}

export class StructureSyncCoordinator {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly signatures = new Map<string, string>();
  private readonly persistence: StructureMarketObjectRepository;

  constructor(
    private readonly mt5: Mt5Repository,
    private readonly instruments: InstrumentRepository,
    private readonly timeframes: TimeframeRepository,
    marketObjects: MarketObjectRepository,
    private readonly configuration: StructureSyncConfiguration,
    private readonly log: (event: string, detail: string) => void = () => undefined,
  ) {
    this.persistence = new StructureMarketObjectRepository(marketObjects);
  }

  start(): void {
    if (this.timer) return;
    void this.sync();
    this.timer = setInterval(() => void this.sync(), this.configuration.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async sync(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const workspace = this.mt5.workspace();
      if (workspace.connection.truth !== 'VERIFIED' || workspace.connection.state !== 'CONNECTED') return;

      for (const [mt5Timeframe, reversalPips] of Object.entries(this.configuration.timeframes)) {
        const chartCode = MT5_TO_CHART_TIMEFRAME[mt5Timeframe];
        if (!chartCode) continue;
        const timeframe = this.timeframes.list().find((entry) => entry.code === chartCode);
        if (!timeframe) continue;

        const symbols = new Set(
          workspace.candles
            .filter((entry) => entry.timeframe === mt5Timeframe && entry.closeTime !== null)
            .map((entry) => entry.canonicalSymbol),
        );
        for (const symbol of symbols) {
          const instrument = this.instruments.list().find((entry) => entry.canonicalSymbol === symbol);
          if (!instrument) continue;
          const candles: MarketCandle[] = workspace.candles
            .filter((entry) =>
              entry.canonicalSymbol === symbol &&
              entry.timeframe === mt5Timeframe &&
              entry.closeTime !== null,
            )
            .sort((left, right) => Date.parse(left.openTime) - Date.parse(right.openTime))
            .map((entry) => Object.freeze({
              id: candleIdentity(symbol, mt5Timeframe, entry.openTime),
              open: entry.open,
              high: entry.high,
              low: entry.low,
              close: entry.close,
              openedAt: entry.openTime,
              closedAt: entry.closeTime,
            }));
          if (candles.length < 6) continue;

          const signatureKey = `${symbol}:${mt5Timeframe}`;
          const signature = lastClosedSignature(candles);
          if (this.signatures.get(signatureKey) === signature) continue;

          const analysis = analyzeNestedLegStructure(candles, {
            instrumentId: symbol,
            timeframe: chartCode,
            pipSize: instrument.pipSize,
            reversalPips,
            equalityTolerancePips: this.configuration.equalityTolerancePips,
          });
          const summary = this.persistence.persist({
            instrumentId: instrument.id,
            timeframeId: timeframe.id,
            analysis,
          });
          this.signatures.set(signatureKey, signature);
          if (summary.insertedObjects > 0 || summary.insertedRelations > 0)
            this.log(
              'structure-sync',
              `${symbol} ${chartCode}: +${summary.insertedObjects} objects, +${summary.insertedRelations} relations`,
            );
        }
      }
    } catch (error) {
      this.log('structure-sync-error', error instanceof Error ? error.message : String(error));
    } finally {
      this.running = false;
    }
  }
}
