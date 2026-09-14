import {
  DomainValidationError,
  requireId,
  requireText,
  timestamp,
  type ColonyId,
  type EntityId,
  type EntityKind,
  type TimeframeId,
  type TimeframeProjectionId,
  type Timestamp,
} from './primitives';
import { requireFinite } from './participation-values';

export interface TimeframeProjection {
  readonly id: TimeframeProjectionId;
  readonly sourceEntityType: string;
  readonly sourceEntityId: EntityId<EntityKind>;
  readonly sourceTimeframeId: TimeframeId;
  readonly targetTimeframeId: TimeframeId;
  readonly intervalStart: Timestamp;
  readonly intervalEnd: Timestamp;
  readonly sourceHigh: number | null;
  readonly sourceLow: number | null;
  readonly colonyId: ColonyId | null;
  readonly parentProjectionId: TimeframeProjectionId | null;
  readonly createdAt: Timestamp;
}
/** Supplied semantic interval only; no calendar, duration, purpose or market-data inference. */
export function createTimeframeProjection(
  input: TimeframeProjection,
): TimeframeProjection {
  for (const id of [
    input.id,
    input.sourceEntityId,
    input.sourceTimeframeId,
    input.targetTimeframeId,
  ])
    requireId(id);
  for (const id of [input.colonyId, input.parentProjectionId])
    if (id !== null) requireId(id);
  requireText(input.sourceEntityType, 'sourceEntityType');
  timestamp(input.intervalStart);
  timestamp(input.intervalEnd);
  timestamp(input.createdAt);
  if (input.intervalEnd <= input.intervalStart)
    throw new DomainValidationError(
      'Projection interval end must be strictly after start',
    );
  if (input.sourceHigh !== null) requireFinite(input.sourceHigh, 'sourceHigh');
  if (input.sourceLow !== null) requireFinite(input.sourceLow, 'sourceLow');
  if (
    input.sourceHigh !== null &&
    input.sourceLow !== null &&
    input.sourceHigh < input.sourceLow
  )
    throw new DomainValidationError(
      'Projection source high must be at least source low',
    );
  if (input.id === input.parentProjectionId)
    throw new DomainValidationError('Projection cannot parent itself');
  return Object.freeze({
    id: input.id,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    sourceTimeframeId: input.sourceTimeframeId,
    targetTimeframeId: input.targetTimeframeId,
    intervalStart: input.intervalStart,
    intervalEnd: input.intervalEnd,
    sourceHigh: input.sourceHigh,
    sourceLow: input.sourceLow,
    colonyId: input.colonyId,
    parentProjectionId: input.parentProjectionId,
    createdAt: input.createdAt,
  });
}
/** Immediate relationship/containment only; does not traverse or infer timeframe ordering. */
export function validateProjectionParent(
  child: TimeframeProjection,
  parent: TimeframeProjection,
): void {
  const childRecord = createTimeframeProjection(child);
  const parentRecord = createTimeframeProjection(parent);
  if (childRecord.parentProjectionId !== parentRecord.id)
    throw new DomainValidationError('Projection parent identity mismatch');
  if (
    childRecord.intervalStart < parentRecord.intervalStart ||
    childRecord.intervalEnd > parentRecord.intervalEnd
  )
    throw new DomainValidationError(
      'Child projection interval is outside its parent',
    );
}
