import { asc, eq } from 'drizzle-orm';
import { createInstrument, createTimeframe, type Instrument, type InstrumentId, type Timeframe, type TimeframeId } from '@arise/domain';
import { boolToInt, hydrateInstrument, hydrateTimeframe } from './codec';
import type { AriseDatabase } from './database';
import { instruments, timeframes } from './schema';

export class InstrumentRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: Instrument): Instrument {
    const value = createInstrument(input);
    this.db.insert(instruments).values({
      id: value.id,
      canonicalSymbol: value.canonicalSymbol,
      displayName: value.displayName,
      assetClass: value.assetClass,
      baseCurrency: value.baseCurrency,
      quoteCurrency: value.quoteCurrency,
      pipSize: value.pipSize,
      tickSize: value.tickSize,
      priceDigits: value.priceDigits,
      enabled: boolToInt(value.enabled),
      createdAt: value.createdAt,
    }).run();
    return value;
  }

  findById(id: InstrumentId): Instrument | null {
    const row = this.db.select().from(instruments).where(eq(instruments.id, id)).limit(1).all()[0];
    return row ? hydrateInstrument(row) : null;
  }

  list(): readonly Instrument[] {
    return Object.freeze(this.db.select().from(instruments).orderBy(asc(instruments.canonicalSymbol)).all().map(hydrateInstrument));
  }
}

export class TimeframeRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: Timeframe): Timeframe {
    const value = createTimeframe(input);
    this.db.insert(timeframes).values({
      id: value.id,
      code: value.code,
      durationSeconds: value.durationSeconds,
      calendarRule: value.calendarRule,
      displayOrder: value.displayOrder,
    }).run();
    return value;
  }

  findById(id: TimeframeId): Timeframe | null {
    const row = this.db.select().from(timeframes).where(eq(timeframes.id, id)).limit(1).all()[0];
    return row ? hydrateTimeframe(row) : null;
  }

  list(): readonly Timeframe[] {
    return Object.freeze(this.db.select().from(timeframes).orderBy(asc(timeframes.displayOrder), asc(timeframes.code)).all().map(hydrateTimeframe));
  }
}
