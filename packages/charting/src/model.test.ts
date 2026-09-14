import { describe, expect, it } from 'vitest';
import { createDemoCandles } from './demo-data';
import { decodeDrawingGeometry, encodeDrawingGeometry, lowerTimeframes, projectCandle } from './model';

describe('M4 chart model', () => {
  it('creates deterministic multi-timeframe demo candles from the same source series', () => {
    const first = createDemoCandles('EURUSD', 'H1');
    const second = createDemoCandles('EURUSD', 'H1');
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(100);
    expect(first[0]!.high).toBeGreaterThanOrEqual(Math.max(first[0]!.open, first[0]!.close));
  });

  it('exposes only lower timeframe projection destinations', () => {
    expect(lowerTimeframes('H4')).toEqual(['H1', 'M15', 'M5']);
    expect(lowerTimeframes('M5')).toEqual([]);
  });

  it('projects the exact source candle interval and range', () => {
    const candle = { time: 1_000_000, open: 1, high: 1.2, low: 0.9, close: 1.1 };
    expect(projectCandle(candle, 'H1', 'M15')).toMatchObject({
      intervalStart: 1_000_000,
      intervalEnd: 1_003_600,
      high: 1.2,
      low: 0.9,
      sourceTimeframe: 'H1',
      targetTimeframe: 'M15',
    });
    expect(() => projectCandle(candle, 'H1', 'H4')).toThrow(/lower/);
  });

  it('round-trips ARISE drawing geometry without presentation semantics', () => {
    const geometry = {
      kind: 'RECTANGLE' as const,
      start: { time: 10, price: 1.2 },
      end: { time: 20, price: 1.1 },
    };
    expect(decodeDrawingGeometry(encodeDrawingGeometry(geometry))).toEqual(geometry);
  });
});
