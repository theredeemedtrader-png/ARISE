import {
  DomainValidationError,
  requireId,
  requireInteger,
  requirePositive,
  requireText,
  timestamp,
  type InstrumentId,
  type TimeframeId,
  type Timestamp,
} from './primitives';

export interface Instrument {
  readonly id: InstrumentId;
  readonly canonicalSymbol: string;
  readonly displayName: string;
  /** Open classification; canonical docs do not prescribe an asset-class enum. */
  readonly assetClass: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly pipSize: number;
  readonly tickSize: number;
  readonly priceDigits: number;
  readonly enabled: boolean;
  readonly createdAt: Timestamp;
}
export function createInstrument(input: Instrument): Instrument {
  requireId(input.id);
  for (const field of [
    'canonicalSymbol',
    'displayName',
    'assetClass',
    'baseCurrency',
    'quoteCurrency',
  ] as const) {
    requireText(input[field], field);
  }
  requirePositive(input.pipSize, 'pipSize');
  requirePositive(input.tickSize, 'tickSize');
  requireInteger(input.priceDigits, 0, 'priceDigits');
  timestamp(input.createdAt);
  if (typeof input.enabled !== 'boolean')
    throw new DomainValidationError('enabled must be boolean');
  return Object.freeze({
    id: input.id,
    canonicalSymbol: input.canonicalSymbol,
    displayName: input.displayName,
    assetClass: input.assetClass,
    baseCurrency: input.baseCurrency,
    quoteCurrency: input.quoteCurrency,
    pipSize: input.pipSize,
    tickSize: input.tickSize,
    priceDigits: input.priceDigits,
    enabled: input.enabled,
    createdAt: input.createdAt,
  });
}
export interface Timeframe {
  readonly id: TimeframeId;
  readonly code: string;
  readonly durationSeconds: number | null;
  /** Opaque calendar-rule key, resolved by a future TimeframeService. */
  readonly calendarRule: string | null;
  readonly displayOrder: number;
}
export function createTimeframe(input: Timeframe): Timeframe {
  requireId(input.id);
  requireText(input.code, 'code');
  requireInteger(input.displayOrder, 0, 'displayOrder');
  if (input.durationSeconds !== null)
    requireInteger(input.durationSeconds, 1, 'durationSeconds');
  if (input.calendarRule !== null)
    requireText(input.calendarRule, 'calendarRule');
  if (input.durationSeconds === null && input.calendarRule === null) {
    throw new DomainValidationError(
      'Timeframe requires durationSeconds or calendarRule',
    );
  }
  if (['D', 'W', 'M'].includes(input.code) && input.calendarRule === null) {
    throw new DomainValidationError('D/W/M timeframes require a calendarRule');
  }
  return Object.freeze({
    id: input.id,
    code: input.code,
    durationSeconds: input.durationSeconds,
    calendarRule: input.calendarRule,
    displayOrder: input.displayOrder,
  });
}
