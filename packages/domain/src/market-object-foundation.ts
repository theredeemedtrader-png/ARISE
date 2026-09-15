import {
  DomainValidationError,
  requireId,
  requireMember,
  requireText,
  type MarketObjectId,
} from './primitives';
import { copyMarketObjectJson, type MarketObjectJson } from './market-object-values';

export const STRUCTURAL_DEGREES = Object.freeze([
  'MICRO',
  'INTERIOR',
  'EXTERIOR',
] as const);
export type StructuralDegree = (typeof STRUCTURAL_DEGREES)[number];

export const MARKET_OBJECT_SOURCES = Object.freeze([
  'MANUAL',
  'DETECTOR',
  'DERIVED',
] as const);
export type MarketObjectSource = (typeof MARKET_OBJECT_SOURCES)[number];

export const MARKET_OBJECT_LIFECYCLE_STATES = Object.freeze([
  'CANDIDATE',
  'CONFIRMED',
  'ACTIVE',
  'INVALIDATED',
  'EXPIRED',
  'CONSUMED',
] as const);
export type MarketObjectLifecycleState =
  (typeof MARKET_OBJECT_LIFECYCLE_STATES)[number];

export const MARKET_DIRECTIONS = Object.freeze([
  'BULLISH',
  'BEARISH',
  'NEUTRAL',
] as const);
export type MarketDirection = (typeof MARKET_DIRECTIONS)[number];

export const ZONE_APPROACH_DIRECTIONS = Object.freeze([
  'FROM_BELOW',
  'FROM_ABOVE',
] as const);
export type ZoneApproachDirection =
  (typeof ZONE_APPROACH_DIRECTIONS)[number];

export const STRATEGY_INTELLIGENCE_RELATION_TYPES = Object.freeze([
  'CREATED_BY',
  'PARENT_OF',
  'CHILD_OF',
  'CONTAINS',
  'PRECEDES',
  'FOLLOWS',
  'RETESTS',
  'BREAKS',
  'INVALIDATES',
  'RESUMES_FROM',
  'SAME_OBJECT',
] as const);
export type StrategyIntelligenceRelationType =
  (typeof STRATEGY_INTELLIGENCE_RELATION_TYPES)[number];

export interface MarketObjectIntelligenceMetadata {
  readonly source: MarketObjectSource;
  readonly lifecycle: MarketObjectLifecycleState;
  readonly direction: MarketDirection;
  readonly degree: StructuralDegree | null;
  readonly parentMarketObjectId: MarketObjectId | null;
  readonly childMarketObjectIds: readonly MarketObjectId[];
  readonly detectorKey: string | null;
}

export function createMarketObjectIntelligenceMetadata(
  input: MarketObjectIntelligenceMetadata,
): Readonly<MarketObjectIntelligenceMetadata> {
  requireMember(input.source, MARKET_OBJECT_SOURCES, 'source');
  requireMember(input.lifecycle, MARKET_OBJECT_LIFECYCLE_STATES, 'lifecycle');
  requireMember(input.direction, MARKET_DIRECTIONS, 'direction');
  if (input.degree !== null)
    requireMember(input.degree, STRUCTURAL_DEGREES, 'degree');
  if (input.parentMarketObjectId !== null)
    requireId(input.parentMarketObjectId);
  if (!Array.isArray(input.childMarketObjectIds))
    throw new DomainValidationError('childMarketObjectIds must be an array');
  const children = [...input.childMarketObjectIds];
  for (const child of children) requireId(child);
  if (new Set(children).size !== children.length)
    throw new DomainValidationError('childMarketObjectIds must be unique');
  if (
    input.parentMarketObjectId !== null &&
    children.includes(input.parentMarketObjectId)
  )
    throw new DomainValidationError('A Market Object cannot parent itself');
  if (input.detectorKey !== null) requireText(input.detectorKey, 'detectorKey');
  return Object.freeze({
    source: input.source,
    lifecycle: input.lifecycle,
    direction: input.direction,
    degree: input.degree,
    parentMarketObjectId: input.parentMarketObjectId,
    childMarketObjectIds: Object.freeze(children),
    detectorKey: input.detectorKey,
  });
}

/**
 * Canonical JSON payload used inside MarketObjectVersion.semanticPropertiesJson.
 * The foundation stays schema-compatible with beta.2 by versioning semantics
 * inside the existing immutable Market Object payload rather than mutating the
 * persistence schema for each new detector family.
 */
export function encodeMarketObjectIntelligenceMetadata(
  input: MarketObjectIntelligenceMetadata,
): MarketObjectJson {
  const value = createMarketObjectIntelligenceMetadata(input);
  return copyMarketObjectJson({
    intelligenceSchema: 1,
    source: value.source,
    lifecycle: value.lifecycle,
    direction: value.direction,
    degree: value.degree,
    parentMarketObjectId: value.parentMarketObjectId,
    childMarketObjectIds: value.childMarketObjectIds,
    detectorKey: value.detectorKey,
  });
}

export interface DirectionalZone {
  readonly low: number;
  readonly high: number;
  readonly nearBoundary: number;
  readonly farBoundary: number;
  readonly midpoint: number;
  readonly approachDirection: ZoneApproachDirection;
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value))
    throw new DomainValidationError(`${field} must be finite`);
  return value;
}

/**
 * Normalizes every directional zone to the same semantic depth model:
 * 0% = near boundary from expected approach side, 100% = far boundary.
 */
export function createDirectionalZone(input: {
  readonly low: number;
  readonly high: number;
  readonly approachDirection: ZoneApproachDirection;
}): DirectionalZone {
  const low = finite(Math.min(input.low, input.high), 'low');
  const high = finite(Math.max(input.low, input.high), 'high');
  if (low === high)
    throw new DomainValidationError('Directional zone requires non-zero width');
  requireMember(
    input.approachDirection,
    ZONE_APPROACH_DIRECTIONS,
    'approachDirection',
  );
  const nearBoundary =
    input.approachDirection === 'FROM_BELOW' ? low : high;
  const farBoundary =
    input.approachDirection === 'FROM_BELOW' ? high : low;
  return Object.freeze({
    low,
    high,
    nearBoundary,
    farBoundary,
    midpoint: (low + high) / 2,
    approachDirection: input.approachDirection,
  });
}

export interface ZonePenetrationMeasurement {
  readonly rawPenetrationRatio: number;
  readonly currentPenetrationRatio: number;
  readonly inside: boolean;
  readonly fullyTraversed: boolean;
  readonly beforeNearBoundary: boolean;
}

export function measureZonePenetration(
  zone: DirectionalZone,
  priceInput: number,
): ZonePenetrationMeasurement {
  const price = finite(priceInput, 'price');
  const width = Math.abs(zone.farBoundary - zone.nearBoundary);
  const raw = zone.approachDirection === 'FROM_BELOW'
    ? (price - zone.nearBoundary) / width
    : (zone.nearBoundary - price) / width;
  return Object.freeze({
    rawPenetrationRatio: raw,
    currentPenetrationRatio: Math.max(0, Math.min(1, raw)),
    inside: raw >= 0 && raw <= 1,
    fullyTraversed: raw >= 1,
    beforeNearBoundary: raw < 0,
  });
}

export function rangesOverlap(
  first: Readonly<{ low: number; high: number }>,
  second: Readonly<{ low: number; high: number }>,
): boolean {
  const aLow = finite(Math.min(first.low, first.high), 'first.low');
  const aHigh = finite(Math.max(first.low, first.high), 'first.high');
  const bLow = finite(Math.min(second.low, second.high), 'second.low');
  const bHigh = finite(Math.max(second.low, second.high), 'second.high');
  return aLow <= bHigh && bLow <= aHigh;
}

export function rangeContains(
  outer: Readonly<{ low: number; high: number }>,
  inner: Readonly<{ low: number; high: number }>,
): boolean {
  const outerLow = finite(Math.min(outer.low, outer.high), 'outer.low');
  const outerHigh = finite(Math.max(outer.low, outer.high), 'outer.high');
  const innerLow = finite(Math.min(inner.low, inner.high), 'inner.low');
  const innerHigh = finite(Math.max(inner.low, inner.high), 'inner.high');
  return outerLow <= innerLow && outerHigh >= innerHigh;
}

export function rangeDistance(
  first: Readonly<{ low: number; high: number }>,
  second: Readonly<{ low: number; high: number }>,
): number {
  if (rangesOverlap(first, second)) return 0;
  const aLow = Math.min(first.low, first.high);
  const aHigh = Math.max(first.low, first.high);
  const bLow = Math.min(second.low, second.high);
  const bHigh = Math.max(second.low, second.high);
  return aHigh < bLow ? bLow - aHigh : aLow - bHigh;
}
