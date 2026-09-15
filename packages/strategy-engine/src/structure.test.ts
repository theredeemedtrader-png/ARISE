import { describe, expect, it } from 'vitest';
import type { MarketCandle } from './detectors';
import { analyzeLegStructure, analyzeNestedLegStructure } from './structure';

function candle(index: number, open: number, high: number, low: number, close: number): MarketCandle {
  const opened = new Date(Date.UTC(2026, 8, 14, index, 0, 0)).toISOString();
  const closed = new Date(Date.UTC(2026, 8, 14, index, 59, 59)).toISOString();
  return Object.freeze({ id: `c${index}`, open, high, low, close, openedAt: opened, closedAt: closed });
}

const series = Object.freeze([
  candle(0, 1.1000, 1.1002, 1.0998, 1.1000),
  candle(1, 1.1000, 1.1012, 1.0999, 1.1010),
  candle(2, 1.1010, 1.1030, 1.1008, 1.1020),
  candle(3, 1.1020, 1.1024, 1.1015, 1.1017),
  candle(4, 1.1017, 1.1018, 1.1008, 1.1010),
  candle(5, 1.1010, 1.1011, 1.0995, 1.1000),
  candle(6, 1.1000, 1.1001, 1.0988, 1.0990),
  candle(7, 1.0990, 1.1002, 1.0989, 1.1000),
  candle(8, 1.1000, 1.1035, 1.0998, 1.1030),
  candle(9, 1.1030, 1.1032, 1.1018, 1.1020),
  candle(10, 1.1020, 1.1021, 1.1000, 1.1005),
  candle(11, 1.1005, 1.1016, 1.1002, 1.1015),
]);

const config = Object.freeze({
  instrumentId: 'EURUSD',
  timeframe: 'H1',
  degree: 'MICRO' as const,
  pipSize: 0.0001,
  reversalPips: 5,
  equalityTolerancePips: 0.5,
});

describe('leg and swing structure', () => {
  it('uses close progression for structure while retaining the wick extreme', () => {
    const result = analyzeLegStructure(series.slice(0, 5), config);
    expect(result.swings).toHaveLength(1);
    expect(result.swings[0]).toMatchObject({
      kind: 'HIGH',
      closeExtreme: 1.102,
      wickExtreme: 1.103,
      classification: null,
    });
    expect(result.legs[0]).toMatchObject({ direction: 'BULLISH', endSwingId: result.swings[0]!.id });
  });

  it('never relocates a confirmed swing when later candles extend the candidate leg', () => {
    const prefix = analyzeLegStructure(series.slice(0, 8), config);
    const replay = analyzeLegStructure(series, config);
    expect(prefix.swings.length).toBeGreaterThanOrEqual(2);
    expect(replay.swings.slice(0, prefix.swings.length)).toEqual(prefix.swings);
  });

  it('classifies same-degree swings against prior swings of the same kind', () => {
    const result = analyzeLegStructure(series, config);
    const highs = result.swings.filter((swing) => swing.kind === 'HIGH');
    expect(highs.length).toBeGreaterThanOrEqual(2);
    expect(highs[1]!.classification).toBe('HH');
  });

  it('is deterministic across a complete historical replay', () => {
    expect(analyzeLegStructure(series, config)).toEqual(analyzeLegStructure([...series], { ...config }));
  });

  it('runs one structure model at nested sensitivities instead of bar-count fractals', () => {
    const nested = analyzeNestedLegStructure(series, {
      instrumentId: 'EURUSD',
      timeframe: 'H1',
      pipSize: 0.0001,
      reversalPips: { MICRO: 5, INTERIOR: 12, EXTERIOR: 20 },
      equalityTolerancePips: 0.5,
    });
    expect(nested.MICRO.swings.length).toBeGreaterThanOrEqual(nested.INTERIOR.swings.length);
    expect(nested.INTERIOR.swings.length).toBeGreaterThanOrEqual(nested.EXTERIOR.swings.length);
    for (const swing of nested.MICRO.swings) {
      if (swing.parentSwingId !== null)
        expect(nested.INTERIOR.swings.some((parent) => parent.id === swing.parentSwingId)).toBe(true);
    }
  });

  it('rejects invalid degree ordering so hierarchy remains meaningful', () => {
    expect(() => analyzeNestedLegStructure(series, {
      instrumentId: 'EURUSD',
      timeframe: 'H1',
      pipSize: 0.0001,
      reversalPips: { MICRO: 10, INTERIOR: 5, EXTERIOR: 20 },
    })).toThrow(/MICRO < INTERIOR < EXTERIOR/);
  });
});
