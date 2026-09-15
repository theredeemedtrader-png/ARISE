import type { MarketCandle } from './detectors';

export type StructuralDegree = 'MICRO' | 'INTERIOR' | 'EXTERIOR';
export type StructuralDirection = 'BULLISH' | 'BEARISH';
export type SwingKind = 'HIGH' | 'LOW';
export type SwingClassification = 'HH' | 'LH' | 'EH' | 'HL' | 'LL' | 'EL' | null;

export interface LegStructureConfig {
  readonly instrumentId: string;
  readonly timeframe: string;
  readonly degree: StructuralDegree;
  readonly pipSize: number;
  readonly reversalPips: number;
  readonly equalityTolerancePips?: number;
}

export interface StructureSwing {
  readonly id: string;
  readonly degree: StructuralDegree;
  readonly kind: SwingKind;
  readonly wickExtreme: number;
  readonly closeExtreme: number;
  readonly pivotAt: string;
  readonly structuralCloseAt: string;
  readonly confirmedAt: string;
  readonly classification: SwingClassification;
  readonly precedingLegId: string | null;
  readonly followingLegId: string | null;
  readonly parentLegId: string | null;
  readonly parentSwingId: string | null;
  readonly childSwingIds: readonly string[];
}

export interface StructureLeg {
  readonly id: string;
  readonly degree: StructuralDegree;
  readonly direction: StructuralDirection;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly confirmedAt: string;
  readonly startClose: number;
  readonly endClose: number;
  readonly wickExtreme: number;
  readonly startSwingId: string | null;
  readonly endSwingId: string;
  readonly parentLegId: string | null;
  readonly childLegIds: readonly string[];
}

export interface CandidateSwing {
  readonly degree: StructuralDegree;
  readonly kind: SwingKind;
  readonly wickExtreme: number;
  readonly closeExtreme: number;
  readonly pivotAt: string;
  readonly structuralCloseAt: string;
}

export interface LegStructureResult {
  readonly degree: StructuralDegree;
  readonly swings: readonly StructureSwing[];
  readonly legs: readonly StructureLeg[];
  readonly candidate: CandidateSwing | null;
  readonly activeDirection: StructuralDirection | null;
}

export interface NestedLegStructureResult {
  readonly MICRO: LegStructureResult;
  readonly INTERIOR: LegStructureResult;
  readonly EXTERIOR: LegStructureResult;
}

interface MutableSwing extends Omit<StructureSwing, 'childSwingIds'> {
  childSwingIds: string[];
}
interface MutableLeg extends Omit<StructureLeg, 'childLegIds'> {
  childLegIds: string[];
}

function finitePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${field} must be a positive finite number`);
  return value;
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function token(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '_');
  if (!normalized) throw new Error('Structure identity fields must be non-empty');
  return normalized;
}

function closedCandles(input: readonly MarketCandle[]): readonly MarketCandle[] {
  const candles = input
    .filter((candle) => candle.closedAt !== null)
    .map((candle) => ({
      ...candle,
      openedAt: iso(candle.openedAt, 'candle.openedAt'),
      closedAt: iso(candle.closedAt!, 'candle.closedAt'),
    }))
    .sort((left, right) => Date.parse(left.openedAt) - Date.parse(right.openedAt));
  const ids = new Set<string>();
  let prior = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    if (ids.has(candle.id)) throw new Error(`Duplicate candle id ${candle.id}`);
    ids.add(candle.id);
    const opened = Date.parse(candle.openedAt);
    if (opened <= prior) throw new Error('Closed candles must have unique chronological open times');
    prior = opened;
    for (const [field, value] of Object.entries({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })) {
      if (!Number.isFinite(value)) throw new Error(`candle.${field} must be finite`);
    }
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low)
      throw new Error(`Invalid OHLC geometry for candle ${candle.id}`);
  }
  return Object.freeze(candles);
}

function identityPrefix(config: LegStructureConfig): string {
  return `${token(config.instrumentId)}:${token(config.timeframe)}:${config.degree}`;
}

function swingId(config: LegStructureConfig, kind: SwingKind, pivotAt: string): string {
  return `swing:${identityPrefix(config)}:${kind}:${Date.parse(pivotAt)}`;
}

function legId(config: LegStructureConfig, direction: StructuralDirection, startedAt: string, endedAt: string): string {
  return `leg:${identityPrefix(config)}:${direction}:${Date.parse(startedAt)}:${Date.parse(endedAt)}`;
}

function classifySwings(swings: MutableSwing[], tolerance: number): void {
  let priorHigh: MutableSwing | null = null;
  let priorLow: MutableSwing | null = null;
  for (const swing of swings) {
    if (swing.kind === 'HIGH') {
      if (priorHigh) {
        const delta = swing.wickExtreme - priorHigh.wickExtreme;
        swing.classification = Math.abs(delta) <= tolerance ? 'EH' : delta > 0 ? 'HH' : 'LH';
      }
      priorHigh = swing;
    } else {
      if (priorLow) {
        const delta = swing.wickExtreme - priorLow.wickExtreme;
        swing.classification = Math.abs(delta) <= tolerance ? 'EL' : delta > 0 ? 'HL' : 'LL';
      }
      priorLow = swing;
    }
  }
}

export function analyzeLegStructure(
  input: readonly MarketCandle[],
  config: LegStructureConfig,
): LegStructureResult {
  const candles = closedCandles(input);
  const pipSize = finitePositive(config.pipSize, 'pipSize');
  const reversal = finitePositive(config.reversalPips, 'reversalPips') * pipSize;
  const equalityTolerance = Math.max(0, config.equalityTolerancePips ?? 0) * pipSize;
  token(config.instrumentId);
  token(config.timeframe);
  if (!['MICRO', 'INTERIOR', 'EXTERIOR'].includes(config.degree))
    throw new Error('degree must be MICRO, INTERIOR, or EXTERIOR');
  if (candles.length < 2)
    return Object.freeze({ degree: config.degree, swings: Object.freeze([]), legs: Object.freeze([]), candidate: null, activeDirection: null });

  const first = candles[0]!;
  let direction: StructuralDirection | null = null;
  let legStartAt = first.openedAt;
  let legStartClose = first.close;
  let priorSwingId: string | null = null;
  let extremeClose = first.close;
  let extremeCloseAt = first.openedAt;
  let extremeWick = first.close;
  let extremeWickAt = first.openedAt;
  const swings: MutableSwing[] = [];
  const legs: MutableLeg[] = [];

  const seedBullish = (candle: MarketCandle) => {
    direction = 'BULLISH';
    extremeClose = candle.close;
    extremeCloseAt = candle.openedAt;
    extremeWick = Math.max(first.high, candle.high);
    extremeWickAt = first.high >= candle.high ? first.openedAt : candle.openedAt;
  };
  const seedBearish = (candle: MarketCandle) => {
    direction = 'BEARISH';
    extremeClose = candle.close;
    extremeCloseAt = candle.openedAt;
    extremeWick = Math.min(first.low, candle.low);
    extremeWickAt = first.low <= candle.low ? first.openedAt : candle.openedAt;
  };

  const confirm = (candle: MarketCandle, kind: SwingKind) => {
    const pivotAt = extremeWickAt;
    const id = swingId(config, kind, pivotAt);
    const legDirection: StructuralDirection = kind === 'HIGH' ? 'BULLISH' : 'BEARISH';
    const leg = legId(config, legDirection, legStartAt, pivotAt);
    const swing: MutableSwing = {
      id,
      degree: config.degree,
      kind,
      wickExtreme: extremeWick,
      closeExtreme: extremeClose,
      pivotAt,
      structuralCloseAt: extremeCloseAt,
      confirmedAt: candle.closedAt!,
      classification: null,
      precedingLegId: leg,
      followingLegId: null,
      parentLegId: null,
      parentSwingId: null,
      childSwingIds: [],
    };
    swings.push(swing);
    legs.push({
      id: leg,
      degree: config.degree,
      direction: legDirection,
      startedAt: legStartAt,
      endedAt: pivotAt,
      confirmedAt: candle.closedAt!,
      startClose: legStartClose,
      endClose: extremeClose,
      wickExtreme: extremeWick,
      startSwingId: priorSwingId,
      endSwingId: id,
      parentLegId: null,
      childLegIds: [],
    });
    if (swings.length >= 2) swings[swings.length - 2]!.followingLegId = leg;
    priorSwingId = id;
    legStartAt = pivotAt;
    legStartClose = extremeClose;
  };

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index]!;
    if (direction === null) {
      const delta = candle.close - first.close;
      if (delta >= reversal) seedBullish(candle);
      else if (delta <= -reversal) seedBearish(candle);
      continue;
    }

    if (direction === 'BULLISH') {
      if (candle.close > extremeClose) {
        extremeClose = candle.close;
        extremeCloseAt = candle.openedAt;
      }
      if (candle.high > extremeWick) {
        extremeWick = candle.high;
        extremeWickAt = candle.openedAt;
      }
      if (extremeClose - candle.close >= reversal) {
        confirm(candle, 'HIGH');
        direction = 'BEARISH';
        extremeClose = candle.close;
        extremeCloseAt = candle.openedAt;
        extremeWick = candle.low;
        extremeWickAt = candle.openedAt;
      }
    } else {
      if (candle.close < extremeClose) {
        extremeClose = candle.close;
        extremeCloseAt = candle.openedAt;
      }
      if (candle.low < extremeWick) {
        extremeWick = candle.low;
        extremeWickAt = candle.openedAt;
      }
      if (candle.close - extremeClose >= reversal) {
        confirm(candle, 'LOW');
        direction = 'BULLISH';
        extremeClose = candle.close;
        extremeCloseAt = candle.openedAt;
        extremeWick = candle.high;
        extremeWickAt = candle.openedAt;
      }
    }
  }

  classifySwings(swings, equalityTolerance);
  const candidate: CandidateSwing | null = direction === null
    ? null
    : Object.freeze({
        degree: config.degree,
        kind: direction === 'BULLISH' ? 'HIGH' : 'LOW',
        wickExtreme: extremeWick,
        closeExtreme: extremeClose,
        pivotAt: extremeWickAt,
        structuralCloseAt: extremeCloseAt,
      });

  return Object.freeze({
    degree: config.degree,
    swings: Object.freeze(swings.map((swing) => Object.freeze({ ...swing, childSwingIds: Object.freeze([...swing.childSwingIds]) }))),
    legs: Object.freeze(legs.map((leg) => Object.freeze({ ...leg, childLegIds: Object.freeze([...leg.childLegIds]) }))),
    candidate,
    activeDirection: direction,
  });
}

function containsTime(leg: StructureLeg, timestamp: string): boolean {
  const value = Date.parse(timestamp);
  return value >= Date.parse(leg.startedAt) && value <= Date.parse(leg.endedAt);
}

function parentForLeg(child: StructureLeg, parents: readonly StructureLeg[]): StructureLeg | null {
  const midpoint = (Date.parse(child.startedAt) + Date.parse(child.endedAt)) / 2;
  return parents
    .filter((parent) => midpoint >= Date.parse(parent.startedAt) && midpoint <= Date.parse(parent.endedAt))
    .sort((left, right) => (Date.parse(left.endedAt) - Date.parse(left.startedAt)) - (Date.parse(right.endedAt) - Date.parse(right.startedAt)))[0] ?? null;
}

function enrichChild(
  childInput: LegStructureResult,
  parentInput: LegStructureResult,
): LegStructureResult {
  const parentLegChildren = new Map<string, string[]>();
  const parentSwingChildren = new Map<string, string[]>();
  const childLegs = childInput.legs.map((leg) => {
    const parent = parentForLeg(leg, parentInput.legs);
    if (parent) parentLegChildren.set(parent.id, [...(parentLegChildren.get(parent.id) ?? []), leg.id]);
    return { ...leg, parentLegId: parent?.id ?? null };
  });
  const childSwings = childInput.swings.map((swing) => {
    const parentLeg = parentInput.legs.find((leg) => containsTime(leg, swing.pivotAt)) ?? null;
    const parentSwing = parentInput.swings.find((candidate) => candidate.kind === swing.kind && candidate.pivotAt === swing.pivotAt) ?? null;
    if (parentSwing) parentSwingChildren.set(parentSwing.id, [...(parentSwingChildren.get(parentSwing.id) ?? []), swing.id]);
    return { ...swing, parentLegId: parentLeg?.id ?? null, parentSwingId: parentSwing?.id ?? null };
  });
  const parentLegs = parentInput.legs.map((leg) => ({ ...leg, childLegIds: Object.freeze(parentLegChildren.get(leg.id) ?? []) }));
  const parentSwings = parentInput.swings.map((swing) => ({ ...swing, childSwingIds: Object.freeze(parentSwingChildren.get(swing.id) ?? []) }));
  Object.assign(parentInput, { legs: Object.freeze(parentLegs), swings: Object.freeze(parentSwings) });
  return Object.freeze({
    ...childInput,
    legs: Object.freeze(childLegs.map((leg) => Object.freeze({ ...leg, childLegIds: Object.freeze([...leg.childLegIds]) }))),
    swings: Object.freeze(childSwings.map((swing) => Object.freeze({ ...swing, childSwingIds: Object.freeze([...swing.childSwingIds]) }))),
  });
}

export function analyzeNestedLegStructure(
  candles: readonly MarketCandle[],
  input: Readonly<{
    instrumentId: string;
    timeframe: string;
    pipSize: number;
    reversalPips: Readonly<Record<StructuralDegree, number>>;
    equalityTolerancePips?: number;
  }>,
): NestedLegStructureResult {
  const microThreshold = finitePositive(input.reversalPips.MICRO, 'reversalPips.MICRO');
  const interiorThreshold = finitePositive(input.reversalPips.INTERIOR, 'reversalPips.INTERIOR');
  const exteriorThreshold = finitePositive(input.reversalPips.EXTERIOR, 'reversalPips.EXTERIOR');
  if (!(microThreshold < interiorThreshold && interiorThreshold < exteriorThreshold))
    throw new Error('Nested reversal thresholds must satisfy MICRO < INTERIOR < EXTERIOR');

  let exterior = analyzeLegStructure(candles, {
    instrumentId: input.instrumentId,
    timeframe: input.timeframe,
    degree: 'EXTERIOR',
    pipSize: input.pipSize,
    reversalPips: exteriorThreshold,
    equalityTolerancePips: input.equalityTolerancePips,
  });
  let interior = analyzeLegStructure(candles, {
    instrumentId: input.instrumentId,
    timeframe: input.timeframe,
    degree: 'INTERIOR',
    pipSize: input.pipSize,
    reversalPips: interiorThreshold,
    equalityTolerancePips: input.equalityTolerancePips,
  });
  let micro = analyzeLegStructure(candles, {
    instrumentId: input.instrumentId,
    timeframe: input.timeframe,
    degree: 'MICRO',
    pipSize: input.pipSize,
    reversalPips: microThreshold,
    equalityTolerancePips: input.equalityTolerancePips,
  });

  interior = enrichChild(interior, exterior);
  micro = enrichChild(micro, interior);

  return Object.freeze({ MICRO: micro, INTERIOR: interior, EXTERIOR: exterior });
}
