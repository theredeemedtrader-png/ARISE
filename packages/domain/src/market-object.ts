import {
  DomainValidationError,
  requireId,
  requireInteger,
  requireMember,
  requireNotBefore,
  requireText,
  timestamp,
  type CandleId,
  type EntityId,
  type EntityKind,
  type InstrumentId,
  type MarketObjectId,
  type MarketObjectVersionId,
  type TimeframeId,
  type Timestamp,
} from './primitives';
import {
  copyMarketObjectJson,
  type MarketObjectJson,
} from './market-object-values';

export const MARKET_OBJECT_GEOMETRY_TYPES = Object.freeze([
  'LINE',
  'RAY',
  'RECTANGLE',
  'TRENDLINE',
  'POINT',
  'CANDLE_REFERENCE',
  'TEXT',
] as const);
export type MarketObjectGeometryType =
  (typeof MARKET_OBJECT_GEOMETRY_TYPES)[number];
export const MARKET_OBJECT_ROLES = Object.freeze([
  'REFERENCE',
  'AREA',
  'TRIGGER',
  'TARGET',
  'INVALIDATION',
  'PROTECTION',
  'CONFIRMATION',
  'ORIGIN',
] as const);
export type MarketObjectRole = (typeof MARKET_OBJECT_ROLES)[number];
/** Examples, deliberately not a closed semantic-type union. */
export const MARKET_OBJECT_SEMANTIC_TYPES = Object.freeze([
  'GENERIC_ZONE',
  'FVG',
  'ORDER_BLOCK',
  'LIQUIDITY_ZONE',
  'RANGE',
  'PREMIUM_DISCOUNT',
  'TARGET_ZONE',
  'INVALIDATION_ZONE',
  'CUSTOM',
] as const);
export interface MarketObjectSnapshot {
  readonly geometryType: MarketObjectGeometryType;
  readonly semanticType: string;
  readonly role: MarketObjectRole;
  readonly timeframeId: TimeframeId | null;
  readonly name: string;
}
export interface MarketObject extends MarketObjectSnapshot {
  readonly id: MarketObjectId;
  readonly instrumentId: InstrumentId;
  readonly ownerType: string;
  readonly ownerId: EntityId<EntityKind>;
  readonly currentVersionId: MarketObjectVersionId;
  readonly createdAt: Timestamp;
  readonly archivedAt: Timestamp | null;
}
export interface MarketObjectPayload {
  readonly geometryJson: MarketObjectJson;
  readonly semanticPropertiesJson: MarketObjectJson;
  readonly sourceCandleIds: readonly CandleId[];
}
export interface MarketObjectVersion
  extends MarketObjectSnapshot, MarketObjectPayload {
  readonly id: MarketObjectVersionId;
  readonly marketObjectId: MarketObjectId;
  readonly versionNo: number;
  readonly createdAt: Timestamp;
  readonly supersedesVersionId: MarketObjectVersionId | null;
}
const snapshotKeys = [
  'geometryType',
  'semanticType',
  'role',
  'timeframeId',
  'name',
] as const;
function copySnapshot(input: MarketObjectSnapshot): MarketObjectSnapshot {
  requireMember(
    input.geometryType,
    MARKET_OBJECT_GEOMETRY_TYPES,
    'geometryType',
  );
  requireMember(input.role, MARKET_OBJECT_ROLES, 'role');
  requireText(input.semanticType, 'semanticType');
  requireText(input.name, 'name');
  if (input.timeframeId !== null) requireId(input.timeframeId);
  return {
    geometryType: input.geometryType,
    semanticType: input.semanticType,
    role: input.role,
    timeframeId: input.timeframeId,
    name: input.name,
  };
}
/** Validate/copy a supplied current or archived record; no dependency scanning. */
export function createMarketObject(input: MarketObject): MarketObject {
  requireId(input.id);
  requireId(input.instrumentId);
  requireId(input.ownerId);
  requireText(input.ownerType, 'ownerType');
  requireId(input.currentVersionId);
  timestamp(input.createdAt);
  if (input.archivedAt !== null)
    requireNotBefore(input.archivedAt, input.createdAt);
  return Object.freeze({
    ...copySnapshot(input),
    id: input.id,
    instrumentId: input.instrumentId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    currentVersionId: input.currentVersionId,
    createdAt: input.createdAt,
    archivedAt: input.archivedAt,
  });
}
/** Hydration boundary; cross-record consistency is checked by the pair/revision/resolver APIs. */
export function createMarketObjectVersion(
  input: MarketObjectVersion,
): MarketObjectVersion {
  requireId(input.id);
  requireId(input.marketObjectId);
  requireInteger(input.versionNo, 1, 'versionNo');
  timestamp(input.createdAt);
  if ((input.versionNo === 1) !== (input.supersedesVersionId === null))
    throw new DomainValidationError(
      'Only Market Object v1 has no superseded version',
    );
  if (input.supersedesVersionId !== null) {
    requireId(input.supersedesVersionId);
    if (input.id === input.supersedesVersionId)
      throw new DomainValidationError(
        'A Market Object version cannot supersede itself',
      );
  }
  if (!Array.isArray(input.sourceCandleIds))
    throw new DomainValidationError(
      'sourceCandleIds must be an array of opaque IDs',
    );
  const sourceCandleIds = copyMarketObjectJson(
    input.sourceCandleIds,
  ) as readonly CandleId[];
  for (const id of sourceCandleIds) requireId(id);
  return Object.freeze({
    ...copySnapshot(input),
    id: input.id,
    marketObjectId: input.marketObjectId,
    versionNo: input.versionNo,
    createdAt: input.createdAt,
    supersedesVersionId: input.supersedesVersionId,
    geometryJson: copyMarketObjectJson(input.geometryJson),
    semanticPropertiesJson: copyMarketObjectJson(input.semanticPropertiesJson),
    sourceCandleIds,
  });
}
export interface MarketObjectWithVersion {
  readonly marketObject: MarketObject;
  readonly version: MarketObjectVersion;
}
export type NewMarketObject = Omit<MarketObject, 'currentVersionId'> &
  MarketObjectPayload & {
    readonly versionId: MarketObjectVersionId;
  };
export function createMarketObjectWithInitialVersion(
  input: NewMarketObject,
): MarketObjectWithVersion {
  const marketObject = createMarketObject({
    ...input,
    currentVersionId: input.versionId,
  });
  const version = createMarketObjectVersion({
    ...input,
    id: input.versionId,
    marketObjectId: input.id,
    versionNo: 1,
    supersedesVersionId: null,
  });
  return Object.freeze({ marketObject, version });
}
/** Verifies ownership/chronology, and mirrored semantics when this is the current version. */
export function validateMarketObjectVersionLink(
  object: MarketObject,
  version: MarketObjectVersion,
): void {
  if (version.marketObjectId !== object.id)
    throw new DomainValidationError('Market Object version ownership mismatch');
  requireNotBefore(version.createdAt, object.createdAt);
  if (
    version.id === object.currentVersionId &&
    snapshotKeys.some((key) => object[key] !== version[key])
  )
    throw new DomainValidationError(
      'Current Market Object semantic snapshot differs from its version',
    );
}
export type MarketObjectRevision = Partial<
  MarketObjectSnapshot & MarketObjectPayload
> & {
  readonly id: MarketObjectVersionId;
  readonly createdAt: Timestamp;
};
/** Caller supplies only the new version identity/time and changed versioned values. */
export function reviseMarketObject(
  object: MarketObject,
  previous: MarketObjectVersion,
  input: MarketObjectRevision,
): MarketObjectWithVersion {
  const current = createMarketObject(object);
  const prior = createMarketObjectVersion(previous);
  validateMarketObjectVersionLink(current, prior);
  if (current.currentVersionId !== prior.id)
    throw new DomainValidationError(
      'Revision requires the supplied current version',
    );
  const allowed = [
    ...snapshotKeys,
    'geometryJson',
    'semanticPropertiesJson',
    'sourceCandleIds',
    'id',
    'createdAt',
  ];
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      !('value' in descriptor) ||
      descriptor.value === undefined
    )
      throw new DomainValidationError(
        'Revision accepts only explicit versioned fields, new version ID and time',
      );
  }
  requireNotBefore(input.createdAt, prior.createdAt);
  if (input.id === prior.id || input.id === prior.supersedesVersionId)
    throw new DomainValidationError(
      'Revision requires a fresh Market Object version ID',
    );
  const version = createMarketObjectVersion({
    ...prior,
    ...input,
    marketObjectId: current.id,
    versionNo: prior.versionNo + 1,
    supersedesVersionId: prior.id,
  });
  const marketObject = createMarketObject({
    ...current,
    ...copySnapshot(version),
    currentVersionId: version.id,
  });
  return Object.freeze({ marketObject, version });
}
