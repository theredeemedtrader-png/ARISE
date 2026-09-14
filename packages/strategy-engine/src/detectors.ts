import type { EvaluationMode } from './model';

export type DetectorResultStatus = 'NOT_MET' | 'PARTIAL' | 'TRIGGERED' | 'CONFIRMED' | 'BLOCKED' | 'FAILED' | 'EXPIRED' | 'ERROR';
export type PriceSource = 'BID' | 'ASK' | 'MID' | 'CHART_PRICE' | 'EITHER_SIDE';

export interface MarketCandle {
  readonly id: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly openedAt: string;
  readonly closedAt: string | null;
}

export interface RuntimeMarketObject {
  readonly id: string;
  readonly versionId: string | null;
  readonly semanticType: string;
  readonly role: string;
  readonly low: number | null;
  readonly high: number | null;
  readonly price: number | null;
}

export interface RuntimeEconomicEvent {
  readonly id: string;
  readonly currency: string;
  readonly impact: string;
  readonly scheduledAt: string;
}

export interface MarketContext {
  readonly instrumentId: string;
  readonly timeframe: string | null;
  readonly candles: readonly MarketCandle[];
  readonly bid: number | null;
  readonly ask: number | null;
  readonly chartPrice: number | null;
  readonly spreadPips: number | null;
  readonly pipSize: number;
  readonly marketObjects: readonly RuntimeMarketObject[];
  readonly states: Readonly<Record<string, string | number | boolean | null>>;
  readonly session: string | null;
  readonly economicEvents: readonly RuntimeEconomicEvent[];
  readonly occurredAt: string;
}

export interface DetectorResult {
  readonly status: DetectorResultStatus;
  readonly diagnostics: Readonly<Record<string, unknown>>;
  readonly memory: Readonly<Record<string, unknown>>;
  readonly candleId: string | null;
  readonly sourceObjectIds: readonly string[];
}

export interface DetectorDefinition {
  readonly key: string;
  readonly version: string;
  readonly evaluationMode: EvaluationMode;
  evaluate(context: MarketContext, parameters: Readonly<Record<string, unknown>>, previousMemory: Readonly<Record<string, unknown>>): DetectorResult;
}

function immutable<T>(value: T): T {
  return Object.freeze(value);
}
function result(status: DetectorResultStatus, diagnostics: Record<string, unknown>, memory: Record<string, unknown> = {}, candleId: string | null = null, sourceObjectIds: readonly string[] = []): DetectorResult {
  return immutable({ status, diagnostics: immutable({ ...diagnostics }), memory: immutable({ ...memory }), candleId, sourceObjectIds: immutable([...sourceObjectIds]) });
}
function numberParam(parameters: Readonly<Record<string, unknown>>, key: string, fallback?: number): number {
  const value = parameters[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${key} must be a finite number`);
}
function stringParam(parameters: Readonly<Record<string, unknown>>, key: string, fallback?: string): string {
  const value = parameters[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`${key} must be a non-empty string`);
}
function booleanParam(parameters: Readonly<Record<string, unknown>>, key: string, fallback = false): boolean {
  const value = parameters[key];
  return typeof value === 'boolean' ? value : fallback;
}
function currentPrice(context: MarketContext, source: PriceSource): number | null {
  if (source === 'BID') return context.bid;
  if (source === 'ASK') return context.ask;
  if (source === 'MID') return context.bid !== null && context.ask !== null ? (context.bid + context.ask) / 2 : null;
  if (source === 'CHART_PRICE') return context.chartPrice ?? context.bid ?? context.ask;
  return context.chartPrice ?? context.bid ?? context.ask;
}
function latestClosed(context: MarketContext): MarketCandle | null {
  for (let index = context.candles.length - 1; index >= 0; index -= 1) {
    const candle = context.candles[index];
    if (candle?.closedAt !== null) return candle ?? null;
  }
  return null;
}

export const priceTouchDetector: DetectorDefinition = immutable({
  key: 'price_touch', version: '1', evaluationMode: 'ON_PRICE_UPDATE',
  evaluate(context, parameters, previousMemory) {
    const level = numberParam(parameters, 'level');
    const tolerance = Math.max(0, numberParam(parameters, 'tolerancePips', 0)) * context.pipSize;
    const source = stringParam(parameters, 'priceSource', 'CHART_PRICE') as PriceSource;
    const price = currentPrice(context, source);
    if (price === null) return result('BLOCKED', { reason: 'PRICE_UNAVAILABLE', source }, previousMemory);
    const touched = Math.abs(price - level) <= tolerance;
    return result(touched ? 'CONFIRMED' : 'NOT_MET', { price, level, tolerance, source }, { lastPrice: price });
  },
});

export const priceCrossDetector: DetectorDefinition = immutable({
  key: 'price_cross', version: '1', evaluationMode: 'ON_PRICE_UPDATE',
  evaluate(context, parameters, previousMemory) {
    const level = numberParam(parameters, 'level');
    const direction = stringParam(parameters, 'direction', 'EITHER').toUpperCase();
    const source = stringParam(parameters, 'priceSource', 'CHART_PRICE') as PriceSource;
    const price = currentPrice(context, source);
    const prior = typeof previousMemory.lastPrice === 'number' ? previousMemory.lastPrice : null;
    if (price === null) return result('BLOCKED', { reason: 'PRICE_UNAVAILABLE', source }, previousMemory);
    if (prior === null) return result('NOT_MET', { reason: 'SEEDING_PREVIOUS_PRICE', price, level }, { lastPrice: price });
    const crossedUp = prior < level && price >= level;
    const crossedDown = prior > level && price <= level;
    const matched = direction === 'UP' ? crossedUp : direction === 'DOWN' ? crossedDown : crossedUp || crossedDown;
    return result(matched ? 'CONFIRMED' : 'NOT_MET', { prior, price, level, direction, crossedUp, crossedDown }, { lastPrice: price });
  },
});

export const zoneEntryDetector: DetectorDefinition = immutable({
  key: 'zone_entry', version: '1', evaluationMode: 'ON_PRICE_UPDATE',
  evaluate(context, parameters, previousMemory) {
    const low = Math.min(numberParam(parameters, 'low'), numberParam(parameters, 'high'));
    const high = Math.max(numberParam(parameters, 'low'), numberParam(parameters, 'high'));
    const source = stringParam(parameters, 'priceSource', 'CHART_PRICE') as PriceSource;
    const price = currentPrice(context, source);
    if (price === null) return result('BLOCKED', { reason: 'PRICE_UNAVAILABLE' }, previousMemory);
    const inside = price >= low && price <= high;
    const wasInside = previousMemory.inside === true;
    const status: DetectorResultStatus = inside && !wasInside ? 'CONFIRMED' : 'NOT_MET';
    return result(status, { price, low, high, inside, entered: inside && !wasInside }, { inside, lastPrice: price });
  },
});

export const spreadDetector: DetectorDefinition = immutable({
  key: 'spread', version: '1', evaluationMode: 'ON_PRICE_UPDATE',
  evaluate(context, parameters, previousMemory) {
    const maxPips = numberParam(parameters, 'maxPips');
    if (context.spreadPips === null) return result('BLOCKED', { reason: 'SPREAD_UNAVAILABLE', maxPips }, previousMemory);
    return result(context.spreadPips <= maxPips ? 'CONFIRMED' : 'BLOCKED', { spreadPips: context.spreadPips, maxPips }, { lastSpreadPips: context.spreadPips });
  },
});

export const liquiditySweepDetector: DetectorDefinition = immutable({
  key: 'liquidity_sweep', version: '1', evaluationMode: 'ON_BAR_CLOSE',
  evaluate(context, parameters, previousMemory) {
    const candle = latestClosed(context);
    if (!candle) return result('BLOCKED', { reason: 'CLOSED_CANDLE_UNAVAILABLE' }, previousMemory);
    if (previousMemory.lastConfirmedCandleId === candle.id) return result('NOT_MET', { reason: 'ALREADY_CONFIRMED', candleId: candle.id }, previousMemory, candle.id);
    const direction = stringParam(parameters, 'direction', 'LONG').toUpperCase();
    const level = numberParam(parameters, 'level');
    const reclaimRequired = booleanParam(parameters, 'reclaimRequired', true);
    const wickThrough = direction === 'LONG' ? candle.low < level : candle.high > level;
    const reclaimed = direction === 'LONG' ? candle.close > level : candle.close < level;
    const confirmed = wickThrough && (!reclaimRequired || reclaimed);
    return result(confirmed ? 'CONFIRMED' : wickThrough ? 'TRIGGERED' : 'NOT_MET', { direction, level, wickThrough, reclaimed, reclaimRequired }, confirmed ? { ...previousMemory, lastConfirmedCandleId: candle.id } : { ...previousMemory }, candle.id);
  },
});

export const displacementDetector: DetectorDefinition = immutable({
  key: 'displacement', version: '1', evaluationMode: 'ON_BAR_CLOSE',
  evaluate(context, parameters, previousMemory) {
    const candle = latestClosed(context);
    if (!candle) return result('BLOCKED', { reason: 'CLOSED_CANDLE_UNAVAILABLE' }, previousMemory);
    const direction = stringParam(parameters, 'direction', 'LONG').toUpperCase();
    const minBodyPips = numberParam(parameters, 'minBodyPips', 1);
    const bodyPips = Math.abs(candle.close - candle.open) / context.pipSize;
    const directionPass = direction === 'LONG' ? candle.close > candle.open : candle.close < candle.open;
    const confirmed = directionPass && bodyPips >= minBodyPips;
    return result(confirmed ? 'CONFIRMED' : 'NOT_MET', { direction, bodyPips, minBodyPips, directionPass }, confirmed ? { lastConfirmedCandleId: candle.id } : previousMemory, candle.id);
  },
});

export const fvgDetector: DetectorDefinition = immutable({
  key: 'fvg', version: '1', evaluationMode: 'ON_BAR_CLOSE',
  evaluate(context, parameters, previousMemory) {
    const closed = context.candles.filter((candle) => candle.closedAt !== null);
    if (closed.length < 3) return result('BLOCKED', { reason: 'THREE_CLOSED_CANDLES_REQUIRED' }, previousMemory);
    const a = closed[closed.length - 3]!;
    const c = closed[closed.length - 1]!;
    const direction = stringParam(parameters, 'direction', 'LONG').toUpperCase();
    const minGapPips = numberParam(parameters, 'minGapPips', 0);
    const gap = direction === 'LONG' ? c.low - a.high : a.low - c.high;
    const gapPips = gap / context.pipSize;
    const confirmed = gap > 0 && gapPips >= minGapPips;
    return result(confirmed ? 'CONFIRMED' : 'NOT_MET', { direction, gapPips, minGapPips, sourceCandleIds: [a.id, c.id] }, confirmed ? { low: direction === 'LONG' ? a.high : c.high, high: direction === 'LONG' ? c.low : a.low, sourceCandleIds: [a.id, c.id] } : previousMemory, c.id);
  },
});

export const fvgRetracementDetector: DetectorDefinition = immutable({
  key: 'fvg_retracement', version: '1', evaluationMode: 'ON_PRICE_UPDATE',
  evaluate(context, parameters, previousMemory) {
    const low = Math.min(numberParam(parameters, 'low'), numberParam(parameters, 'high'));
    const high = Math.max(numberParam(parameters, 'low'), numberParam(parameters, 'high'));
    const price = currentPrice(context, stringParam(parameters, 'priceSource', 'CHART_PRICE') as PriceSource);
    if (price === null) return result('BLOCKED', { reason: 'PRICE_UNAVAILABLE' }, previousMemory);
    const inside = price >= low && price <= high;
    return result(inside ? 'CONFIRMED' : 'NOT_MET', { price, low, high, inside }, { inside, lastPrice: price });
  },
});

export const mssDetector: DetectorDefinition = immutable({
  key: 'mss', version: '1', evaluationMode: 'ON_BAR_CLOSE',
  evaluate(context, parameters, previousMemory) {
    const direction = stringParam(parameters, 'direction', 'LONG').toUpperCase();
    const swingPrice = numberParam(parameters, 'swingPrice');
    const closeRequired = booleanParam(parameters, 'closeRequired', true);
    const candle = latestClosed(context);
    if (closeRequired && !candle) return result('BLOCKED', { reason: 'CLOSED_CANDLE_UNAVAILABLE' }, previousMemory);
    const price = closeRequired ? candle!.close : (currentPrice(context, 'CHART_PRICE') ?? candle?.close ?? null);
    if (price === null) return result('BLOCKED', { reason: 'PRICE_UNAVAILABLE' }, previousMemory);
    const broken = direction === 'LONG' ? price > swingPrice : price < swingPrice;
    if (!broken) return result('NOT_MET', { direction, swingPrice, price, closeRequired }, previousMemory, candle?.id ?? null);
    if (previousMemory.lastBrokenSwingPrice === swingPrice) return result('NOT_MET', { reason: 'DUPLICATE_BREAK', direction, swingPrice }, previousMemory, candle?.id ?? null);
    return result('CONFIRMED', { direction, swingPrice, price, closeRequired }, { lastBrokenSwingPrice: swingPrice, lastConfirmedCandleId: candle?.id ?? null }, candle?.id ?? null);
  },
});

export class DetectorRegistry {
  private readonly entries = new Map<string, DetectorDefinition>();
  constructor(definitions: readonly DetectorDefinition[] = []) { for (const definition of definitions) this.register(definition); }
  register(definition: DetectorDefinition): void {
    const identity = `${definition.key}@${definition.version}`;
    if (this.entries.has(identity)) throw new Error(`Detector ${identity} is already registered`);
    this.entries.set(identity, definition);
  }
  get(key: string, version: string): DetectorDefinition | null { return this.entries.get(`${key}@${version}`) ?? null; }
  list(): readonly DetectorDefinition[] { return Object.freeze([...this.entries.values()]); }
}

export function createDefaultDetectorRegistry(): DetectorRegistry {
  return new DetectorRegistry([priceTouchDetector, priceCrossDetector, zoneEntryDetector, spreadDetector, liquiditySweepDetector, displacementDetector, fvgDetector, fvgRetracementDetector, mssDetector]);
}
