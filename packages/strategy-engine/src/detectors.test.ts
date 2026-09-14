import { describe, expect, it } from 'vitest';
import { createDefaultDetectorRegistry, type MarketContext } from './detectors';

const now = '2026-09-11T12:00:00.000Z';
function context(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    instrumentId: 'EURUSD', timeframe: 'M5', candles: [], bid: 1.1000, ask: 1.1002, chartPrice: 1.1001,
    spreadPips: 2, pipSize: 0.0001, marketObjects: [], states: {}, session: 'NY', economicEvents: [], occurredAt: now,
    ...overrides,
  };
}

describe('detector registry and representative detectors', () => {
  const registry = createDefaultDetectorRegistry();
  it('registers deterministic detector versions', () => {
    expect(registry.get('price_touch','1')?.evaluationMode).toBe('ON_PRICE_UPDATE');
    expect(registry.get('liquidity_sweep','1')?.evaluationMode).toBe('ON_BAR_CLOSE');
    expect(registry.list().length).toBeGreaterThanOrEqual(9);
  });
  it('detects touch/cross and prevents duplicate cross without a new crossing', () => {
    expect(registry.get('price_touch','1')!.evaluate(context({chartPrice:1.1010}), {level:1.1010,tolerancePips:0}, {}).status).toBe('CONFIRMED');
    const cross = registry.get('price_cross','1')!;
    const seeded = cross.evaluate(context({chartPrice:1.0990}), {level:1.1000,direction:'UP'}, {});
    expect(seeded.status).toBe('NOT_MET');
    const confirmed = cross.evaluate(context({chartPrice:1.1005}), {level:1.1000,direction:'UP'}, seeded.memory);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(cross.evaluate(context({chartPrice:1.1006}), {level:1.1000,direction:'UP'}, confirmed.memory).status).toBe('NOT_MET');
  });
  it('distinguishes liquidity trigger from reclaim confirmation', () => {
    const detector = registry.get('liquidity_sweep','1')!;
    const candle = {id:'c1',open:1.1000,high:1.1010,low:1.0980,close:1.0990,openedAt:now,closedAt:now};
    expect(detector.evaluate(context({candles:[candle]}), {direction:'LONG',level:1.0995,reclaimRequired:true}, {}).status).toBe('TRIGGERED');
    const reclaimed = {...candle,id:'c2',close:1.1000};
    expect(detector.evaluate(context({candles:[reclaimed]}), {direction:'LONG',level:1.0995,reclaimRequired:true}, {}).status).toBe('CONFIRMED');
  });
  it('detects bullish FVG geometry from three closed candles', () => {
    const candles = [
      {id:'a',open:1.1000,high:1.1010,low:1.0990,close:1.1005,openedAt:now,closedAt:now},
      {id:'b',open:1.1010,high:1.1040,low:1.1008,close:1.1035,openedAt:now,closedAt:now},
      {id:'c',open:1.1030,high:1.1050,low:1.1020,close:1.1045,openedAt:now,closedAt:now},
    ];
    const value = registry.get('fvg','1')!.evaluate(context({candles}), {direction:'LONG',minGapPips:5}, {});
    expect(value.status).toBe('CONFIRMED');
    expect(value.diagnostics.gapPips).toBeCloseTo(10);
  });
  it('blocks spread above threshold and confirms below it', () => {
    const detector = registry.get('spread','1')!;
    expect(detector.evaluate(context({spreadPips:2.1}), {maxPips:2}, {}).status).toBe('BLOCKED');
    expect(detector.evaluate(context({spreadPips:1.9}), {maxPips:2}, {}).status).toBe('CONFIRMED');
  });
});
