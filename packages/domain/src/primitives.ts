/** Infrastructure-free, caller-supplied identities. No ID generation or clock reads. */
declare const identityBrand: unique symbol;
export type EntityKind =
  | 'Instrument'
  | 'Timeframe'
  | 'Idea'
  | 'IdeaVersion'
  | 'Colony'
  | 'ColonyLineage'
  | 'ColonyStateEvent'
  | 'Target'
  | 'TargetEvent'
  | 'MarketObject'
  | 'MarketObjectVersion'
  | 'Attempt'
  | 'Trade'
  | 'Position'
  | 'PositionStateEvent'
  | 'AttemptBudget'
  | 'StrategyRuntime'
  | 'StrategyMapVersion'
  | 'BrokerAccount'
  | 'MarketObjectRelation'
  | 'TimeframeProjection'
  | 'Candle';
export type EntityId<K extends EntityKind> = string & {
  readonly [identityBrand]: K;
};
export type InstrumentId = EntityId<'Instrument'>;
export type TimeframeId = EntityId<'Timeframe'>;
export type IdeaId = EntityId<'Idea'>;
export type IdeaVersionId = EntityId<'IdeaVersion'>;
export type ColonyId = EntityId<'Colony'>;
export type ColonyLineageId = EntityId<'ColonyLineage'>;
export type ColonyStateEventId = EntityId<'ColonyStateEvent'>;
export type TargetId = EntityId<'Target'>;
export type TargetEventId = EntityId<'TargetEvent'>;
export type MarketObjectId = EntityId<'MarketObject'>;
export type MarketObjectVersionId = EntityId<'MarketObjectVersion'>;

export type AttemptId = EntityId<'Attempt'>;
export type TradeId = EntityId<'Trade'>;
export type PositionId = EntityId<'Position'>;
export type PositionStateEventId = EntityId<'PositionStateEvent'>;
export type AttemptBudgetId = EntityId<'AttemptBudget'>;
export type StrategyRuntimeId = EntityId<'StrategyRuntime'>;
export type StrategyMapVersionId = EntityId<'StrategyMapVersion'>;
export type BrokerAccountId = EntityId<'BrokerAccount'>;

export type MarketObjectRelationId = EntityId<'MarketObjectRelation'>;
export type TimeframeProjectionId = EntityId<'TimeframeProjection'>;
/** Opaque source reference only; Candle data and identity composition are deferred. */
export type CandleId = EntityId<'Candle'>;

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export function requireId(value: string): void {
  // Token syntax deliberately excludes presentation labels (spaces, #). No symbol parsing.
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)
  ) {
    throw new DomainValidationError(
      'ID must be a non-empty opaque token, not a presentation label',
    );
  }
}
export function entityId<K extends EntityKind>(
  _kind: K,
  value: string,
): EntityId<K> {
  requireId(value);
  return value as EntityId<K>;
}

declare const timestampBrand: unique symbol;
/** ISO UTC string instead of mutable Date, including within frozen history. */
export type Timestamp = string & { readonly [timestampBrand]: true };
export function timestamp(value: string): Timestamp {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new DomainValidationError(
      'Timestamp must be a valid ISO UTC instant with milliseconds',
    );
  }
  return value as Timestamp;
}
export function requireNotBefore(value: Timestamp, earliest: Timestamp): void {
  timestamp(value);
  timestamp(earliest);
  if (value < earliest)
    throw new DomainValidationError('Timestamp precedes referenced entity');
}
export function requireText(value: string, field: string): void {
  if (typeof value !== 'string' || !value.trim())
    throw new DomainValidationError(`${field} is required`);
}
export function requireMember<T extends string>(
  value: T,
  values: readonly T[],
  field: string,
): void {
  if (!values.includes(value))
    throw new DomainValidationError(`Invalid ${field}: ${String(value)}`);
}
export function requireInteger(
  value: number,
  minimum: number,
  field: string,
): void {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new DomainValidationError(`Invalid ${field}`);
}
export function requirePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new DomainValidationError(`${field} must be positive and finite`);
}
