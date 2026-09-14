import {
  DomainValidationError,
  requireId,
  requireText,
  timestamp,
  type Timestamp,
} from './primitives';

export type TransitionTable<S extends string> = Readonly<
  Record<S, readonly S[]>
>;
export function transitionTable<S extends string>(
  table: Record<S, readonly S[]>,
): TransitionTable<S> {
  for (const destinations of Object.values<readonly S[]>(table))
    Object.freeze(destinations);
  return Object.freeze(table);
}
export class InvalidTransitionError extends DomainValidationError {
  constructor(
    readonly entityType: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${entityType} transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}
export function canTransition<S extends string>(
  table: TransitionTable<S>,
  from: S,
  to: S,
): boolean {
  return Object.hasOwn(table, from) && table[from].includes(to);
}
export function requireTransition<S extends string>(
  entity: string,
  table: TransitionTable<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(table, from, to))
    throw new InvalidTransitionError(entity, from, to);
}
/** sourceType is an open semantic key: the canonical docs do not specify its enum. */
export interface TransitionContext {
  readonly reason: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly occurredAt: Timestamp;
  readonly manualOverride: boolean;
  readonly correlationId: string | null;
}
export function validateTransitionContext(context: TransitionContext): void {
  requireText(context.reason, 'reason');
  requireText(context.sourceType, 'sourceType');
  if (context.sourceId !== null) requireId(context.sourceId);
  if (context.correlationId !== null) requireId(context.correlationId);
  timestamp(context.occurredAt);
  if (typeof context.manualOverride !== 'boolean')
    throw new DomainValidationError('manualOverride must be boolean');
}
export function copyTransitionContext(
  context: TransitionContext,
): TransitionContext {
  validateTransitionContext(context);
  return {
    reason: context.reason,
    sourceType: context.sourceType,
    sourceId: context.sourceId,
    occurredAt: context.occurredAt,
    manualOverride: context.manualOverride,
    correlationId: context.correlationId,
  };
}
