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

interface MutableSwing {
  id: string;
  degree: StructuralDegree;
  kind: SwingKind;
  wickExtreme: number;
  closeExtreme: number;
  pivotAt: string;
  structuralCloseAt: string;
  confirmedAt: string;
  classification: SwingClassification;
  precedingLegId: string | null;
  followingLegId: string | null;
  parentLegId: string | null;
  parentSwingId: string | null;
  childSwingIds: string[];
}

interface MutableLeg {
  id: string;
  degree: StructuralDegree;
  direction: StructuralDirection;
  startedAt: string;
  endedAt: string;
  confirmedAt: string;
  startClose: number;
  endClose: number;
  wickExtreme: number;
  startSwingId: string | null;
  endSwingId: string;
  parentLegId: string | null;
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
    .map((candle) => Object.freeze({
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
    for (const [field, value] of Object.entries({ open: candle.open, high: candle.high, low: candle.low, close: candle.close }))
      if (!Number.isFinite(value)) throw new Error(`candle.${field} must be finite`);
    if (
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < candle.low
    ) throw new Error(`Invalid OHLC geometry for candle ${candle.id}`);
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

function freezeResult(
  degree: StructuralDegree,
  swings: readonly MutableSwing[],
  legs: readonly MutableLeg[],
  candidate: CandidateSwing | null,
  activeDirection: StructuralDirection | null,
): LegStructureResult {
  return Object.freeze({
    degree,
    swings: Object.freeze(swings.map((swing) => Object.freeze({
      ...swing,
      childSwingIds: Object.freeze([...swing.childSwingIds]),
    }))),
    legs: Object.freeze(legs.map((leg) => Object.freeze({
      ...leg,
      childLegIds: Object.freeze([...leg.childLegIds]),
    }))),
    candidate,
    activeDirection,
  });
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
    return freezeResult(config.degree, [], [], null, null);

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

  const seedDirection = (throughIndex: number, nextDirection: StructuralDirection) => {
    const seed = candles.slice(0, throughIndex + 1);
    direction = nextDirection;
    if (nextDirection === 'BULLISH') {
      const closeCandle = seed.reduce((best, candle) => candle.close > best.close ? candle : best);
      const wickCandle = seed.reduce((best, candle) => candle.high > best.high ? candle : best);
      extremeClose = closeCandle.close;
      extremeCloseAt = closeCandle.openedAt;
      extremeWick = wickCandle.high;
      extremeWickAt = wickCandle.openedAt;
    } else {
      const closeCandle = seed.reduce((best, candle) => candle.close < best.close ? candle : best);
      const wickCandle = seed.reduce((best, candle) => candle.low < best.low ? candle : best);
      extremeClose = closeCandle.close;
      extremeCloseAt = closeCandle.openedAt;
      extremeWick = wickCandle.low;
      extremeWickAt = wickCandle.openedAt;
    }
  };

  const confirm = (candle: MarketCandle, kind: SwingKind) => {
    const pivotAt = extremeWickAt;
    const id = swingId(config, kind, pivotAt);
    const legDirection: StructuralDirection = kind === 'HIGH' ? 'BULLISH' : 'BEARISH';
    const leg = legId(config, legDirection, legStartAt, pivotAt);
    swings.push({
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
    });
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
      if (delta >= reversal) seedDirection(index, 'BULLISH');
      else if (delta <= -reversal) seedDirection(index, 'BEARISH');
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
  const candidate: CandidateSwing | null = direction === null ? null : Object.freeze({
    degree: config.degree,
    kind: direction === 'BULLISH' ? 'HIGH' : 'LOW',
    wickExtreme: extremeWick,
    closeExtreme: extremeClose,
    pivotAt: extremeWickAt,
    structuralCloseAt: extremeCloseAt,
  });
  return freezeResult(config.degree, swings, legs, candidate, direction);
}

function containsTime(leg: StructureLeg, timestamp: string): boolean {
  const value = Date.parse(timestamp);
  return value >= Date.parse(leg.startedAt) && value <= Date.parse(leg.endedAt);
}

function parentForLeg(child: StructureLeg, parents: readonly StructureLeg[]): StructureLeg | null {
  const midpoint = (Date.parse(child.startedAt) + Date.parse(child.endedAt)) / 2;
  return parents
    .filter((parent) => midpoint >= Date.parse(parent.startedAt) && midpoint <= Date.parse(parent.endedAt))
    .sort((left, right) =>
      (Date.parse(left.endedAt) - Date.parse(left.startedAt)) -
      (Date.parse(right.endedAt) - Date.parse(right.startedAt)),
    )[0] ?? null;
}

function linkHierarchy(
  childInput: LegStructureResult,
  parentInput: LegStructureResult,
): readonly [LegStructureResult, LegStructureResult] {
  const legChildren = new Map<string, string[]>();
  const swingChildren = new Map<string, string[]>();
  const childLegs: MutableLeg[] = childInput.legs.map((leg) => {
    const parent = parentForLeg(leg, parentInput.legs);
    if (parent) legChildren.set(parent.id, [...(legChildren.get(parent.id) ?? []), leg.id]);
    return { ...leg, parentLegId: parent?.id ?? null, childLegIds: [...leg.childLegIds] };
  });
  const childSwings: MutableSwing[] = childInput.swings.map((swing) => {
    const parentLeg = parentInput.legs.find((leg) => containsTime(leg, swing.pivotAt)) ?? null;
    const parentSwing = parentInput.swings.find((candidate) =>
      candidate.kind === swing.kind && candidate.pivotAt === swing.pivotAt,
    ) ?? null;
    if (parentSwing)
      swingChildren.set(parentSwing.id, [...(swingChildren.get(parentSwing.id) ?? []), swing.id]);
    return {
      ...swing,
      parentLegId: parentLeg?.id ?? null,
      parentSwingId: parentSwing?.id ?? null,
      childSwingIds: [...swing.childSwingIds],
    };
  });
  const parentLegs: MutableLeg[] = parentInput.legs.map((leg) => ({
    ...leg,
    childLegIds: [...new Set([...leg.childLegIds, ...(legChildren.get(leg.id) ?? [])])],
  }));
  const parentSwings: MutableSwing[] = parentInput.swings.map((swing) => ({
    ...swing,
    childSwingIds: [...new Set([...swing.childSwingIds, ...(swingChildren.get(swing.id) ?? [])])],
  }));
  return Object.freeze([
    freezeResult(childInput.degree, childSwings, childLegs, childInput.candidate, childInput.activeDirection),
    freezeResult(parentInput.degree, parentSwings, parentLegs, parentInput.candidate, parentInput.activeDirection),
  ]);
}

function degreeConfig(
  input: Readonly<{
    instrumentId: string;
    timeframe: string;
    pipSize: number;
    equalityTolerancePips?: number;
  }>,
  degree: StructuralDegree,
  reversalPips: number,
): LegStructureConfig {
  return {
    instrumentId: input.instrumentId,
    timeframe: input.timeframe,
    degree,
    pipSize: input.pipSize,
    reversalPips,
    ...(input.equalityTolerancePips === undefined ? {} : { equalityTolerancePips: input.equalityTolerancePips }),
  };
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

  let exterior = analyzeLegStructure(candles, degreeConfig(input, 'EXTERIOR', exteriorThreshold));
  let interior = analyzeLegStructure(candles, degreeConfig(input, 'INTERIOR', interiorThreshold));
  let micro = analyzeLegStructure(candles, degreeConfig(input, 'MICRO', microThreshold));

  [interior, exterior] = linkHierarchy(interior, exterior);
  [micro, interior] = linkHierarchy(micro, interior);

  return Object.freeze({ MICRO: micro, INTERIOR: interior, EXTERIOR: exterior });
}
