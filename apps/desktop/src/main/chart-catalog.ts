import { createInstrument, createTimeframe, entityId, timestamp, type Instrument, type Timeframe } from '@arise/domain';
import { InstrumentRepository, TimeframeRepository } from '@arise/database';

const SEEDED_AT = timestamp('2026-09-10T00:00:00.000Z');

const INSTRUMENTS = [
  { symbol: 'EURUSD', displayName: 'Euro / US Dollar', assetClass: 'FX', baseCurrency: 'EUR', quoteCurrency: 'USD', pipSize: 0.0001, tickSize: 0.00001, priceDigits: 5 },
  { symbol: 'GBPUSD', displayName: 'British Pound / US Dollar', assetClass: 'FX', baseCurrency: 'GBP', quoteCurrency: 'USD', pipSize: 0.0001, tickSize: 0.00001, priceDigits: 5 },
  { symbol: 'USDJPY', displayName: 'US Dollar / Japanese Yen', assetClass: 'FX', baseCurrency: 'USD', quoteCurrency: 'JPY', pipSize: 0.01, tickSize: 0.001, priceDigits: 3 },
  { symbol: 'XAUUSD', displayName: 'Gold / US Dollar', assetClass: 'METAL', baseCurrency: 'XAU', quoteCurrency: 'USD', pipSize: 0.01, tickSize: 0.01, priceDigits: 2 },
  { symbol: 'NAS100', displayName: 'Nasdaq 100', assetClass: 'INDEX', baseCurrency: 'NAS100', quoteCurrency: 'USD', pipSize: 0.1, tickSize: 0.1, priceDigits: 1 },
] as const;

const TIMEFRAMES = [
  { code: 'M1', durationSeconds: 60, calendarRule: null, displayOrder: 10 },
  { code: 'M2', durationSeconds: 120, calendarRule: null, displayOrder: 20 },
  { code: 'M3', durationSeconds: 180, calendarRule: null, displayOrder: 30 },
  { code: 'M5', durationSeconds: 300, calendarRule: null, displayOrder: 40 },
  { code: 'M10', durationSeconds: 600, calendarRule: null, displayOrder: 50 },
  { code: 'M15', durationSeconds: 900, calendarRule: null, displayOrder: 60 },
  { code: 'M30', durationSeconds: 1800, calendarRule: null, displayOrder: 70 },
  { code: 'H1', durationSeconds: 3600, calendarRule: null, displayOrder: 80 },
  { code: 'H2', durationSeconds: 7200, calendarRule: null, displayOrder: 90 },
  { code: 'H4', durationSeconds: 14400, calendarRule: null, displayOrder: 100 },
  { code: 'H6', durationSeconds: 21600, calendarRule: null, displayOrder: 110 },
  { code: 'H8', durationSeconds: 28800, calendarRule: null, displayOrder: 120 },
  { code: 'H12', durationSeconds: 43200, calendarRule: null, displayOrder: 130 },
  { code: 'D', durationSeconds: null, calendarRule: 'BROKER_DAY', displayOrder: 140 },
  { code: 'W', durationSeconds: null, calendarRule: 'BROKER_WEEK', displayOrder: 150 },
  { code: 'M', durationSeconds: null, calendarRule: 'BROKER_MONTH', displayOrder: 160 },
] as const;

export function ensureChartCatalog(instruments: InstrumentRepository, timeframes: TimeframeRepository): void {
  const existingInstruments = instruments.list();
  for (const seed of INSTRUMENTS) {
    if (existingInstruments.some((entry) => entry.canonicalSymbol === seed.symbol)) continue;
    instruments.insert(createInstrument({
      id: entityId('Instrument', `instrument:${seed.symbol}`),
      canonicalSymbol: seed.symbol,
      displayName: seed.displayName,
      assetClass: seed.assetClass,
      baseCurrency: seed.baseCurrency,
      quoteCurrency: seed.quoteCurrency,
      pipSize: seed.pipSize,
      tickSize: seed.tickSize,
      priceDigits: seed.priceDigits,
      enabled: true,
      createdAt: SEEDED_AT,
    }));
  }

  const existingTimeframes = timeframes.list();
  for (const seed of TIMEFRAMES) {
    if (existingTimeframes.some((entry) => entry.code === seed.code)) continue;
    timeframes.insert(createTimeframe({
      id: entityId('Timeframe', `tf:${seed.code}`),
      code: seed.code,
      durationSeconds: seed.durationSeconds,
      calendarRule: seed.calendarRule,
      displayOrder: seed.displayOrder,
    }));
  }
}

export function chartInstrumentBySymbol(repository: InstrumentRepository, symbol: string): Instrument | null {
  return repository.list().find((entry) => entry.canonicalSymbol === symbol) ?? null;
}

export function chartTimeframeByCode(repository: TimeframeRepository, code: string): Timeframe | null {
  return repository.list().find((entry) => entry.code === code) ?? null;
}
