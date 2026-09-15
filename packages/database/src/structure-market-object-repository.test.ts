import { describe, expect, it } from 'vitest';
import {
  createInstrument,
  createTimeframe,
  entityId,
  timestamp,
} from '@arise/domain';
import { analyzeNestedLegStructure, type MarketCandle } from '@arise/strategy-engine';
import { openDatabase } from './database';
import { MarketObjectRepository } from './market-object-repository';
import { InstrumentRepository, TimeframeRepository } from './reference-repository';
import { StructureMarketObjectRepository } from './structure-market-object-repository';

function candle(index: number, open: number, high: number, low: number, close: number): MarketCandle {
  const openedAt = new Date(Date.UTC(2026, 8, 14, index, 0, 0)).toISOString();
  const closedAt = new Date(Date.UTC(2026, 8, 14, index, 59, 59)).toISOString();
  return { id: `c${index}`, open, high, low, close, openedAt, closedAt };
}

const candles = [
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
] as const;

describe('StructureMarketObjectRepository', () => {
  it('persists replay-stable structure objects idempotently', () => {
    const connection = openDatabase(':memory:');
    try {
      const instrument = createInstrument({
        id: entityId('Instrument', 'instrument-eurusd'),
        canonicalSymbol: 'EURUSD',
        displayName: 'EUR/USD',
        assetClass: 'FOREX',
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        pipSize: 0.0001,
        tickSize: 0.00001,
        priceDigits: 5,
        enabled: true,
        createdAt: timestamp('2026-09-14T00:00:00.000Z'),
      });
      const timeframe = createTimeframe({
        id: entityId('Timeframe', 'timeframe-h1'),
        code: 'H1',
        durationSeconds: 3600,
        calendarRule: null,
        displayOrder: 20,
      });
      new InstrumentRepository(connection.db).insert(instrument);
      new TimeframeRepository(connection.db).insert(timeframe);

      const analysis = analyzeNestedLegStructure(candles, {
        instrumentId: instrument.canonicalSymbol,
        timeframe: timeframe.code,
        pipSize: instrument.pipSize,
        reversalPips: { MICRO: 5, INTERIOR: 12, EXTERIOR: 20 },
      });
      const objects = new MarketObjectRepository(connection.db);
      const repository = new StructureMarketObjectRepository(objects);
      const first = repository.persist({ instrumentId: instrument.id, timeframeId: timeframe.id, analysis });
      const second = repository.persist({ instrumentId: instrument.id, timeframeId: timeframe.id, analysis });

      expect(first.insertedObjects).toBeGreaterThan(0);
      expect(second.insertedObjects).toBe(0);
      expect(second.existingObjects).toBe(first.objectIds.length);

      const stored = objects.listByInstrument(instrument.id);
      expect(stored.some((entry) => entry.semanticType === 'STRUCTURE_LEG')).toBe(true);
      expect(stored.some((entry) => entry.semanticType === 'STRUCTURE_SWING')).toBe(true);
      for (const object of stored) {
        expect(object.ownerType).toBe('STRATEGY_INTELLIGENCE');
        expect(object.currentVersionId).toBe(`${object.id}:v1`);
      }

      const swing = stored.find((entry) => entry.semanticType === 'STRUCTURE_SWING');
      expect(swing).toBeDefined();
      const aggregate = objects.reconstruct(swing!.id)!;
      expect(aggregate.versions[0]!.semanticPropertiesJson).toMatchObject({
        intelligenceSchema: 1,
        persistenceSchema: 1,
        source: 'DETECTOR',
        lifecycle: 'CONFIRMED',
        detectorKey: 'leg_structure',
      });
    } finally {
      connection.sqlite.close();
    }
  });
});
