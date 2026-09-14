import { validateColony, type Colony } from './colony';
import {
  copyTransitionContext,
  requireTransition,
  transitionTable,
  type TransitionContext,
} from './lifecycle';
import {
  DomainValidationError,
  requireId,
  requireMember,
  requireNotBefore,
  requireText,
  timestamp,
  type ColonyId,
  type MarketObjectId,
  type TargetId,
  type TargetEventId,
  type Timestamp,
} from './primitives';

export const TARGET_MANAGEMENT_MODES = Object.freeze([
  'REFERENCE_ONLY',
  'FULL_TP',
  'PARTIAL_TP',
  'TRAIL',
  'MANUAL',
  'HYBRID',
  'RUNNER',
] as const);
export type TargetManagementMode = (typeof TARGET_MANAGEMENT_MODES)[number];
export const TARGET_STATUSES = Object.freeze([
  'ACTIVE',
  'APPROACHING',
  'REACHED',
  'HIT',
  'INVALIDATED',
  'REASSIGNED',
  'COMPLETED',
] as const);
export type TargetStatus = (typeof TARGET_STATUSES)[number];
/** Conservative M1.1 defaults: docs define meanings, not the complete edge table. */
export const TARGET_TRANSITIONS = transitionTable<TargetStatus>({
  ACTIVE: ['APPROACHING', 'INVALIDATED', 'REASSIGNED'],
  APPROACHING: ['REACHED', 'INVALIDATED', 'REASSIGNED'],
  REACHED: ['HIT', 'INVALIDATED', 'REASSIGNED'],
  HIT: ['COMPLETED'],
  INVALIDATED: ['COMPLETED'],
  REASSIGNED: ['COMPLETED'],
  COMPLETED: [],
});
export interface Target {
  readonly id: TargetId;
  readonly colonyId: ColonyId;
  /** Open semantic key; no canonical target-type enum is specified. */
  readonly targetType: string;
  readonly exactPrice: number | null;
  readonly zoneMarketObjectId: MarketObjectId | null;
  readonly managementMode: TargetManagementMode;
  readonly status: TargetStatus;
  readonly createdAt: Timestamp;
}
export function validateTarget(target: Target): void {
  requireId(target.id);
  requireId(target.colonyId);
  requireText(target.targetType, 'targetType');
  timestamp(target.createdAt);
  // Zero/negative finite prices remain valid for non-Forex instruments.
  if (
    target.exactPrice !== null &&
    (typeof target.exactPrice !== 'number' ||
      !Number.isFinite(target.exactPrice))
  ) {
    throw new DomainValidationError('exactPrice must be finite or null');
  }
  if (target.zoneMarketObjectId !== null) requireId(target.zoneMarketObjectId);
  requireMember(
    target.managementMode,
    TARGET_MANAGEMENT_MODES,
    'Target management mode',
  );
  requireMember(target.status, TARGET_STATUSES, 'Target status');
}
export function createTarget(
  colony: Colony,
  input: Omit<Target, 'colonyId' | 'status'>,
): Target {
  validateColony(colony);
  requireNotBefore(input.createdAt, colony.createdAt);
  const target: Target = {
    id: input.id,
    colonyId: colony.id,
    targetType: input.targetType,
    exactPrice: input.exactPrice,
    zoneMarketObjectId: input.zoneMarketObjectId,
    managementMode: input.managementMode,
    status: 'ACTIVE',
    createdAt: input.createdAt,
  };
  validateTarget(target);
  return Object.freeze(target);
}
// COMPLETED is also an event so the last consequential transition remains representable.
export const TARGET_EVENT_TYPES = Object.freeze([
  'APPROACHING',
  'REACHED',
  'HIT',
  'INVALIDATED',
  'REASSIGNED',
  'COMPLETED',
] as const);
export type TargetEventType = (typeof TARGET_EVENT_TYPES)[number];
export interface TargetEvent extends TransitionContext {
  readonly id: TargetEventId;
  readonly targetId: TargetId;
  readonly fromStatus: TargetStatus;
  readonly toStatus: TargetEventType;
  readonly eventType: TargetEventType;
}
export function createTargetEvent(input: TargetEvent): TargetEvent {
  requireId(input.id);
  requireId(input.targetId);
  requireMember(input.eventType, TARGET_EVENT_TYPES, 'Target event type');
  if (input.eventType !== input.toStatus)
    throw new DomainValidationError(
      'Target event type must match destination status',
    );
  requireTransition(
    'Target',
    TARGET_TRANSITIONS,
    input.fromStatus,
    input.toStatus,
  );
  return Object.freeze({
    ...copyTransitionContext(input),
    id: input.id,
    targetId: input.targetId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    eventType: input.eventType,
  });
}
/** REASSIGNED records retirement of this target; replacement/Colony assignment is later orchestration. */
export function transitionTarget(
  target: Target,
  to: TargetEventType,
  context: TransitionContext & { readonly id: TargetEventId },
): Readonly<{ target: Target; event: TargetEvent }> {
  validateTarget(target);
  requireNotBefore(context.occurredAt, target.createdAt);
  const event = createTargetEvent({
    ...context,
    targetId: target.id,
    fromStatus: target.status,
    toStatus: to,
    eventType: to,
  });
  const next: Target = {
    id: target.id,
    colonyId: target.colonyId,
    targetType: target.targetType,
    exactPrice: target.exactPrice,
    zoneMarketObjectId: target.zoneMarketObjectId,
    managementMode: target.managementMode,
    createdAt: target.createdAt,
    status: to,
  };
  return Object.freeze({ target: Object.freeze(next), event });
}
