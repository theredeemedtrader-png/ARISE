import { describe, expect, it } from 'vitest';
import {
  createDirectionalZone,
  createMarketObjectIntelligenceMetadata,
  encodeMarketObjectIntelligenceMetadata,
  measureZonePenetration,
  rangeContains,
  rangeDistance,
  rangesOverlap,
} from './market-object-foundation';
import { entityId } from './primitives';

describe('market object intelligence foundation', () => {
  it('normalizes directional zones from the expected approach side', () => {
    const bullish = createDirectionalZone({ low: 1.1, high: 1.2, approachDirection: 'FROM_BELOW' });
    expect(bullish.nearBoundary).toBe(1.1);
    expect(bullish.farBoundary).toBe(1.2);
    expect(measureZonePenetration(bullish, 1.15).currentPenetrationRatio).toBeCloseTo(0.5);

    const bearish = createDirectionalZone({ low: 1.1, high: 1.2, approachDirection: 'FROM_ABOVE' });
    expect(bearish.nearBoundary).toBe(1.2);
    expect(bearish.farBoundary).toBe(1.1);
    expect(measureZonePenetration(bearish, 1.15).currentPenetrationRatio).toBeCloseTo(0.5);
  });

  it('keeps raw traversal information while clamping strategy-friendly depth', () => {
    const zone = createDirectionalZone({ low: 100, high: 110, approachDirection: 'FROM_BELOW' });
    expect(measureZonePenetration(zone, 98)).toMatchObject({
      beforeNearBoundary: true,
      inside: false,
      fullyTraversed: false,
      currentPenetrationRatio: 0,
    });
    expect(measureZonePenetration(zone, 112)).toMatchObject({
      beforeNearBoundary: false,
      inside: false,
      fullyTraversed: true,
      currentPenetrationRatio: 1,
    });
  });

  it('encodes structural metadata inside the existing immutable JSON payload', () => {
    const parent = entityId('MarketObject', 'object.parent');
    const child = entityId('MarketObject', 'object.child');
    const metadata = createMarketObjectIntelligenceMetadata({
      source: 'DETECTOR',
      lifecycle: 'CONFIRMED',
      direction: 'BULLISH',
      degree: 'INTERIOR',
      parentMarketObjectId: parent,
      childMarketObjectIds: [child],
      detectorKey: 'leg_structure',
    });
    expect(metadata.childMarketObjectIds).toEqual([child]);
    expect(encodeMarketObjectIntelligenceMetadata(metadata)).toEqual({
      intelligenceSchema: 1,
      source: 'DETECTOR',
      lifecycle: 'CONFIRMED',
      direction: 'BULLISH',
      degree: 'INTERIOR',
      parentMarketObjectId: parent,
      childMarketObjectIds: [child],
      detectorKey: 'leg_structure',
    });
  });

  it('provides common spatial operators for all zone families', () => {
    expect(rangesOverlap({ low: 1, high: 3 }, { low: 3, high: 5 })).toBe(true);
    expect(rangeContains({ low: 1, high: 5 }, { low: 2, high: 4 })).toBe(true);
    expect(rangeDistance({ low: 1, high: 2 }, { low: 5, high: 7 })).toBe(3);
  });
});
