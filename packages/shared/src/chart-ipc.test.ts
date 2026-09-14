import { describe, expect, it } from 'vitest';
import { chartCatalogSchema, chartMarketObjectSchema, createChartObjectInputSchema } from './ipc';

describe('M4 chart IPC contracts', () => {
  it('accepts a chart catalog with canonical opaque IDs', () => {
    expect(chartCatalogSchema.parse({
      instruments: [{ instrumentId: 'instrument:EURUSD', symbol: 'EURUSD', displayName: 'Euro / US Dollar', priceDigits: 5, pipSize: 0.0001, tickSize: 0.00001 }],
      timeframes: [{ timeframeId: 'tf:H1', code: 'H1' }],
    }).instruments[0]!.symbol).toBe('EURUSD');
  });

  it('keeps geometry transport vendor-neutral', () => {
    const input = createChartObjectInputSchema.parse({
      symbol: 'EURUSD', timeframe: 'H1', geometryType: 'RECTANGLE', semanticType: 'FVG', role: 'AREA', name: 'H1 FVG',
      geometryJson: { kind: 'RECTANGLE', start: { time: 1, price: 1.1 }, end: { time: 2, price: 1.2 } },
    });
    expect(input.geometryJson).toEqual({ kind: 'RECTANGLE', start: { time: 1, price: 1.1 }, end: { time: 2, price: 1.2 } });
  });

  it('rejects non-canonical chart timeframe labels at the IPC boundary', () => {
    expect(() => chartMarketObjectSchema.parse({
      id: 'x', versionId: 'v', versionNo: 1, symbol: 'EURUSD', geometryType: 'LINE', semanticType: 'FVG', role: 'AREA', timeframe: 'H1X', name: 'x', geometryJson: {}, semanticPropertiesJson: {}, createdAt: 'x',
    })).toThrow();
  });
});
