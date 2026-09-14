import { DIRECTIONS, type Direction } from './idea-version';
import {
  copyTransitionContext,
  requireTransition,
  transitionTable,
  type TransitionContext,
} from './lifecycle';
import {
  brokerPositionKey,
  requireFinite,
  requireNonnegative,
  type BrokerPositionKey,
} from './participation-values';
import {
  DomainValidationError,
  requireId,
  requireMember,
  requireNotBefore,
  requirePositive,
  timestamp,
  type PositionId,
  type PositionStateEventId,
  type TradeId,
  type BrokerAccountId,
  type ColonyId,
  type Timestamp,
} from './primitives';
import { validateTrade, type Trade } from './trade';

export const POSITION_STATES = Object.freeze([
  'CANDIDATE',
  'SCOUT',
  'SURVIVOR',
  'PROTECTED',
  'LEG',
  'MATURE_LEG',
  'RUNNER',
  'FAILED',
  'CLOSED',
  'CONSOLIDATED',
] as const);
export type PositionState = (typeof POSITION_STATES)[number];
/** Exposure records require actual opening facts. Pre-fill lifecycle is evaluated separately. */
export type ExposurePositionState = Exclude<PositionState, 'CANDIDATE'>;
export const POSITION_TRANSITIONS = transitionTable<PositionState>({
  CANDIDATE: ['SCOUT'],
  SCOUT: ['SURVIVOR', 'FAILED', 'CLOSED'],
  SURVIVOR: ['PROTECTED', 'LEG', 'FAILED', 'CLOSED'],
  PROTECTED: ['LEG', 'MATURE_LEG', 'CLOSED'],
  LEG: ['MATURE_LEG', 'RUNNER', 'CLOSED', 'CONSOLIDATED'],
  MATURE_LEG: ['RUNNER', 'CLOSED', 'CONSOLIDATED'],
  RUNNER: ['CLOSED', 'CONSOLIDATED'],
  FAILED: [],
  CLOSED: [],
  CONSOLIDATED: [],
});
export function transitionPositionState(
  from: PositionState,
  to: PositionState,
): PositionState {
  requireTransition('Position', POSITION_TRANSITIONS, from, to);
  return to;
}
export interface Position {
  readonly id: PositionId;
  readonly tradeId: TradeId;
  readonly brokerAccountId: BrokerAccountId;
  readonly brokerPositionKey: BrokerPositionKey;
  readonly originalColonyId: ColonyId;
  readonly currentColonyId: ColonyId;
  readonly direction: Direction;
  readonly originalSize: number;
  readonly currentSize: number;
  readonly entryPrice: number;
  readonly currentState: ExposurePositionState;
  readonly openedAt: Timestamp;
  readonly closedAt: Timestamp | null;
}
export function validatePosition(position: Position): void {
  for (const id of [
    position.id,
    position.tradeId,
    position.brokerAccountId,
    position.originalColonyId,
    position.currentColonyId,
  ])
    requireId(id);
  brokerPositionKey(position.brokerPositionKey);
  requireMember(position.direction, DIRECTIONS, 'Position direction');
  requirePositive(position.originalSize, 'originalSize');
  requireNonnegative(position.currentSize, 'currentSize');
  // No netting/add-to-position size policy is inferred: currentSize may exceed originalSize.
  requireFinite(position.entryPrice, 'entryPrice');
  timestamp(position.openedAt);
  requireMember<PositionState>(
    position.currentState,
    POSITION_STATES,
    'Position state',
  );
  if ((position.currentState as PositionState) === 'CANDIDATE')
    throw new DomainValidationError(
      'Pre-fill CANDIDATE uses the pure lifecycle API, not an exposure record',
    );
  if (position.closedAt !== null) {
    requireNotBefore(position.closedAt, position.openedAt);
    if (position.currentSize !== 0)
      throw new DomainValidationError(
        'Closed exposure must have zero currentSize',
      );
    if (!['CLOSED', 'FAILED', 'CONSOLIDATED'].includes(position.currentState))
      throw new DomainValidationError(
        'Active lifecycle must not have closedAt',
      );
  }
  if (position.currentState === 'CLOSED' && position.closedAt === null)
    throw new DomainValidationError('CLOSED requires closedAt');
}
export function createPosition(
  trade: Trade,
  input: Omit<Position, 'tradeId' | 'originalColonyId' | 'direction'>,
): Position {
  validateTrade(trade);
  requireNotBefore(input.openedAt, trade.createdAt);
  const position: Position = {
    id: input.id,
    tradeId: trade.id,
    brokerAccountId: input.brokerAccountId,
    brokerPositionKey: input.brokerPositionKey,
    originalColonyId: trade.colonyId,
    currentColonyId: input.currentColonyId,
    direction: trade.direction,
    originalSize: input.originalSize,
    currentSize: input.currentSize,
    entryPrice: input.entryPrice,
    currentState: input.currentState,
    openedAt: input.openedAt,
    closedAt: input.closedAt,
  };
  validatePosition(position);
  return Object.freeze(position);
}
export interface PositionStateEvent extends TransitionContext {
  readonly id: PositionStateEventId;
  readonly positionId: PositionId;
  readonly fromState: PositionState;
  readonly toState: PositionState;
}
export function createPositionStateEvent(
  input: PositionStateEvent,
): PositionStateEvent {
  requireId(input.id);
  requireId(input.positionId);
  transitionPositionState(input.fromState, input.toState);
  return Object.freeze({
    ...copyTransitionContext(input),
    id: input.id,
    positionId: input.positionId,
    fromState: input.fromState,
    toState: input.toState,
  });
}
/** Records a declaration from supplied facts. Never closes exposure or changes size/price/lineage. */
export function transitionPosition(
  position: Position,
  to: ExposurePositionState,
  context: TransitionContext & { readonly id: PositionStateEventId },
): Readonly<{ position: Position; event: PositionStateEvent }> {
  validatePosition(position);
  requireNotBefore(context.occurredAt, position.openedAt);
  const event = createPositionStateEvent({
    ...context,
    positionId: position.id,
    fromState: position.currentState,
    toState: to,
  });
  if (to === 'CLOSED' && position.currentSize !== 0)
    throw new DomainValidationError(
      'CLOSED requires supplied zero exposure; lifecycle cannot close a broker position',
    );
  const next = createPositionSnapshot(
    position,
    to,
    to === 'CLOSED' ? context.occurredAt : position.closedAt,
  );
  return Object.freeze({ position: next, event });
}
function createPositionSnapshot(
  input: Position,
  currentState: ExposurePositionState,
  closedAt: Timestamp | null,
): Position {
  const next: Position = {
    id: input.id,
    tradeId: input.tradeId,
    brokerAccountId: input.brokerAccountId,
    brokerPositionKey: input.brokerPositionKey,
    originalColonyId: input.originalColonyId,
    currentColonyId: input.currentColonyId,
    direction: input.direction,
    originalSize: input.originalSize,
    currentSize: input.currentSize,
    entryPrice: input.entryPrice,
    currentState,
    openedAt: input.openedAt,
    closedAt,
  };
  validatePosition(next);
  return Object.freeze(next);
}
