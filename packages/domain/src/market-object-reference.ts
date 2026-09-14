import {
  DomainValidationError,
  requireId,
  type MarketObjectId,
  type MarketObjectVersionId,
} from './primitives';
import {
  createMarketObject,
  createMarketObjectVersion,
  validateMarketObjectVersionLink,
  type MarketObject,
  type MarketObjectVersion,
} from './market-object';

export type MarketObjectReference =
  | {
      readonly mode: 'FROZEN';
      readonly marketObjectId: MarketObjectId;
      readonly versionId: MarketObjectVersionId;
    }
  | { readonly mode: 'LIVE_LINKED'; readonly marketObjectId: MarketObjectId };

export function createMarketObjectReference(
  input: MarketObjectReference,
): MarketObjectReference {
  requireId(input.marketObjectId);
  if (input.mode === 'FROZEN') {
    requireId(input.versionId);
    return Object.freeze({
      mode: input.mode,
      marketObjectId: input.marketObjectId,
      versionId: input.versionId,
    });
  }
  if (input.mode === 'LIVE_LINKED') {
    if ('versionId' in input)
      throw new DomainValidationError(
        'LIVE_LINKED references must not pin a version',
      );
    return Object.freeze({
      mode: input.mode,
      marketObjectId: input.marketObjectId,
    });
  }
  throw new DomainValidationError('Invalid Market Object reference mode');
}

/** Caller supplies every record. No fallback, repository lookup, cache or clock. */
export function resolveMarketObjectReference(
  input: MarketObjectReference,
  object: MarketObject,
  versions: readonly MarketObjectVersion[],
): MarketObjectVersion {
  const reference = createMarketObjectReference(input);
  const current = createMarketObject(object);
  if (reference.marketObjectId !== current.id)
    throw new DomainValidationError(
      'Market Object reference identity mismatch',
    );
  const requestedId =
    reference.mode === 'FROZEN'
      ? reference.versionId
      : current.currentVersionId;
  const matches = versions.filter((version) => version.id === requestedId);
  if (matches.length === 0)
    throw new DomainValidationError(
      'Requested Market Object version was not supplied',
    );
  if (matches.length !== 1)
    throw new DomainValidationError(
      'Ambiguous duplicate Market Object version ID',
    );
  const version = createMarketObjectVersion(matches[0]!);
  validateMarketObjectVersionLink(current, version);
  return version;
}
