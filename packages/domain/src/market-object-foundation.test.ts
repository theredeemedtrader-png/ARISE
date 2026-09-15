import { describe, expect, it } from 'vitest';
import {
  createDirectionalZone,
  createMarketObjectIntelligenceMetadata,
  createZoneForMarketDirection,
  encodeMarketObjectIntelligenceMetadata,
  measureRangeOverlap,
  measureZonePenetration,
  rangeContains,
  rangeDistance,
  rangesOverlap,
  summarizeZoneInteraction,
} from './market-object-foundation';
import { entityId } from './primitives';

describe('market object intelligence foundation', () => {
  it('normalizes directional zones from the expected approach side', () => {
    const fromBelow = createDirectionalZone({ low: 1.1, high: 1.2, approachDirection: 'FROM_BELOW' });
    expect(fromBelow.nearBoundary).toBe(1.1);
    expect(fromBelow.farBoundary).toBe(1.2);
    expect(measureZonePenetration(fromBelow, 1.15).currentPenetrationRatio).toBeCloseTo(0.5);

    const fromAbove = createDirectionalZone({ low: 1.1, high: 1.2, approachDirection: 'FROM_ABOVE' });
    expect(fromAbove.nearBoundary).toBe(1.2);
    expect(fromAbove.farBoundary).toBe(1.1);
    expect(measureZonePenetration(fromAbove, 1.15).currentPenetrationRatio).toBeCloseTo(0.5);
  });

  it('provides canonical approach direction for directional support/resistance zones', () => {
    expect(createZoneForMarketDirection({ low: 100, high: 110, direction: 'BULLISH' })).toMatchObject({
      nearBoundary: 110,
      farBoundary: 100,
      approachDirection: 'FROM_ABOVE',
    });
    expect(createZoneForMarketDirection({ low: 100, high: 110, direction: 'BEARISH' })).toMatchObject({
      nearBoundary: 100,
      farBoundary: 110,
      approachDirection: 'FROM_BELOW',
    });
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

  it('tracks current and maximum penetration across an ordered price path', () => {
    const zone = createZoneForMarketDirection({ low: 100, high: 110, direction: 'BULLISH' });
    expect(summarizeZoneInteraction(zone, [112, 109, 106, 108])).toEqual({
      currentPenetrationRatio: 0.2,
      maximumPenetrationRatio: 0.4,
      entered: true,
      fullyTraversed: false,
      firstEntryIndex: 1,
      firstTraversalIndex: null,
    });
    expect(summarizeZoneInteraction(zone, [112, 109, 99])).toMatchObject({
      maximumPenetrationRatio: 1,
      fullyTraversed: true,
      firstTraversalIndex: 2,
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
    expect(measureRangeOverlap({ low: 1, high: 4 }, { low: 3, high: 8 })).toEqual({
      overlaps: true,
      low: 3,
      high: 4,
      width: 1,
    });
    expect(measureRangeOverlap({ low: 1, high: 2 }, { low: 3, high: 4 })).toEqual({
      overlaps: false,
      low: null,
      high: null,
      width: 0,
    });
  });
});
