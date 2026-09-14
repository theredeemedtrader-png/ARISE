import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createColony,
  createIdea,
  createIdeaVersion,
  createInstrument,
  createMarketObjectWithInitialVersion,
  createTimeframe,
  entityId,
  timestamp,
} from '@arise/domain';
import { CanonicalIdeaRepository } from './canonical-idea-repository';
import { ColonyRepository } from './colony-repository';
import { openDatabase } from './database';
import { MarketObjectRepository } from './market-object-repository';
import { InstrumentRepository, TimeframeRepository } from './reference-repository';

const at = (minute: number) => timestamp(`2026-09-10T01:${String(minute).padStart(2, '0')}:00.000Z`);

describe('canonical restart reconstruction', () => {
  it('reconstructs exact M1 identities and versions after closing and reopening SQLite', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'arise-m2-restart-'));
    const filename = path.join(dir, 'arise.db');
    let connection = openDatabase(filename);
    try {
      const instrument = createInstrument({
        id: entityId('Instrument', 'instrument-eurusd'), canonicalSymbol: 'EURUSD', displayName: 'EUR/USD', assetClass: 'FOREX',
        baseCurrency: 'EUR', quoteCurrency: 'USD', pipSize: 0.0001, tickSize: 0.00001, priceDigits: 5, enabled: true, createdAt: at(0),
      });
      const daily = createTimeframe({ id: entityId('Timeframe', 'timeframe-d'), code: 'D', durationSeconds: null, calendarRule: 'BROKER_DAILY', displayOrder: 10 });
      new InstrumentRepository(connection.db).insert(instrument);
      new TimeframeRepository(connection.db).insert(daily);
      const idea = createIdea({ id: entityId('Idea', 'idea-restart'), instrumentId: instrument.id, thesisTimeframeId: daily.id, createdAt: at(1) });
      const ideaRepo = new CanonicalIdeaRepository(connection.db);
      ideaRepo.insert(idea);
      const version = createIdeaVersion(idea, {
        id: entityId('IdeaVersion', 'idea-version-restart'), direction: 'LONG', thesisText: 'Restart-safe thesis', targetDescription: 'External liquidity',
        invalidationDescription: 'Invalidation', primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null, createdAt: at(2),
      });
      ideaRepo.appendVersion(version);
      const colony = createColony({ id: entityId('Colony', 'colony-restart'), idea, originalIdeaVersion: version, label: 'Restart Colony', createdAt: at(3) });
      new ColonyRepository(connection.db).insert(colony);
      const marketObject = createMarketObjectWithInitialVersion({
        id: entityId('MarketObject', 'market-object-restart'), versionId: entityId('MarketObjectVersion', 'market-object-version-restart'),
        instrumentId: instrument.id, ownerType: 'COLONY', ownerId: colony.id, geometryType: 'RECTANGLE', semanticType: 'LIQUIDITY_ZONE', role: 'TARGET',
        timeframeId: daily.id, name: 'D BSL', createdAt: at(4), archivedAt: null, geometryJson: { low: 1.12, high: 1.121 },
        semanticPropertiesJson: { side: 'BUY_SIDE' }, sourceCandleIds: [entityId('Candle', 'candle-restart')],
      });
      new MarketObjectRepository(connection.db).insertInitial(marketObject);

      connection.sqlite.close();
      connection = openDatabase(filename);

      expect(new CanonicalIdeaRepository(connection.db).reconstruct(idea.id)).toEqual({ idea, versions: [version] });
      expect(new ColonyRepository(connection.db).reconstruct(colony.id)).toEqual({ colony, stateEvents: [], lineage: [] });
      expect(new MarketObjectRepository(connection.db).reconstruct(marketObject.marketObject.id)).toEqual({
        marketObject: marketObject.marketObject,
        versions: [marketObject.version],
        relations: [],
      });
    } finally {
      connection.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
