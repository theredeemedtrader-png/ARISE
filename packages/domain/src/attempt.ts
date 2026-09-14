import { validateColony, type Colony } from './colony';
import { requireTransition, transitionTable } from './lifecycle';
import { requireFinite } from './participation-values';
import {
  DomainValidationError,
  requireId,
  requireInteger,
  requireMember,
  requireNotBefore,
  timestamp,
  type AttemptId,
  type ColonyId,
  type StrategyRuntimeId,
  type Timestamp,
} from './primitives';

export const ATTEMPT_RESULTS = Object.freeze([
  'EXPIRED',
  'FAILED',
  'SCRATCH',
  'SURVIVED',
] as const);
export type AttemptResult = (typeof ATTEMPT_RESULTS)[number];
export const ATTEMPT_STATES = Object.freeze([
  'CREATED',
  'WAITING',
  'READY',
  'ORDER_SUBMITTED',
  'FILLED',
  'SURVIVED',
  'FAILED',
  'SCRATCH',
  'EXPIRED',
  'CANCELLED',
  'REJECTED',
] as const);
export type AttemptState = (typeof ATTEMPT_STATES)[number];
/** Suggested lifecycle: pre-fill expiry/cancellation, rejection only after submission. */
export const ATTEMPT_TRANSITIONS = transitionTable<AttemptState>({
  CREATED: ['WAITING', 'EXPIRED', 'CANCELLED'],
  WAITING: ['READY', 'EXPIRED', 'CANCELLED'],
  READY: ['ORDER_SUBMITTED', 'EXPIRED', 'CANCELLED'],
  ORDER_SUBMITTED: ['FILLED', 'EXPIRED', 'CANCELLED', 'REJECTED'],
  FILLED: ['SURVIVED', 'FAILED', 'SCRATCH'],
  SURVIVED: [],
  FAILED: [],
  SCRATCH: [],
  EXPIRED: [],
  CANCELLED: [],
  REJECTED: [],
});
/** Lifecycle is deliberately independent of the canonical stored result; no invented history schema. */
export function transitionAttemptState(
  from: AttemptState,
  to: AttemptState,
): AttemptState {
  requireTransition('Attempt', ATTEMPT_TRANSITIONS, from, to);
  return to;
}
export interface Attempt {
  readonly id: AttemptId;
  readonly colonyId: ColonyId;
  readonly strategyRuntimeId: StrategyRuntimeId | null;
  readonly sequenceNo: number;
  readonly startedAt: Timestamp;
  readonly completedAt: Timestamp | null;
  readonly result: AttemptResult | null;
  readonly pipCost: number | null;
}
export function validateAttempt(attempt: Attempt): void {
  requireId(attempt.id);
  requireId(attempt.colonyId);
  if (attempt.strategyRuntimeId !== null) requireId(attempt.strategyRuntimeId);
  requireInteger(attempt.sequenceNo, 1, 'sequenceNo');
  timestamp(attempt.startedAt);
  if (attempt.result !== null) {
    requireMember(attempt.result, ATTEMPT_RESULTS, 'Attempt result');
    if (attempt.completedAt === null)
      throw new DomainValidationError(
        'Terminal Attempt result requires completedAt',
      );
  }
  // A completed CANCELLED/REJECTED lifecycle has no canonical result equivalent.
  if (attempt.completedAt !== null)
    requireNotBefore(attempt.completedAt, attempt.startedAt);
  // The sign convention is unspecified; retain finite signed pips, never silently take abs().
  if (attempt.pipCost !== null) requireFinite(attempt.pipCost, 'pipCost');
}
export function createAttempt(
  colony: Colony,
  input: Omit<Attempt, 'colonyId'>,
): Attempt {
  validateColony(colony);
  requireNotBefore(input.startedAt, colony.createdAt);
  const attempt: Attempt = {
    id: input.id,
    colonyId: colony.id,
    strategyRuntimeId: input.strategyRuntimeId,
    sequenceNo: input.sequenceNo,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    result: input.result,
    pipCost: input.pipCost,
  };
  validateAttempt(attempt);
  return Object.freeze(attempt);
}
