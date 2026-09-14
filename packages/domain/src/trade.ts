import { validateAttempt, type Attempt } from './attempt';
import { validateColony, type Colony } from './colony';
import {
  DIRECTIONS,
  validateIdeaVersion,
  type Direction,
  type IdeaVersion,
} from './idea-version';
import {
  DomainValidationError,
  requireId,
  requireMember,
  requireNotBefore,
  timestamp,
  type TradeId,
  type AttemptId,
  type ColonyId,
  type IdeaVersionId,
  type StrategyMapVersionId,
  type Timestamp,
} from './primitives';

export const TRADE_SOURCE_TYPES = Object.freeze([
  'ARISE_AUTO',
  'ARISE_MANUAL',
  'EXTERNAL_MANUAL',
  'IMPORTED',
] as const);
export type TradeSourceType = (typeof TRADE_SOURCE_TYPES)[number];
export interface Trade {
  readonly id: TradeId;
  readonly attemptId: AttemptId | null;
  readonly colonyId: ColonyId;
  readonly ideaVersionId: IdeaVersionId;
  readonly strategyMapVersionId: StrategyMapVersionId | null;
  readonly direction: Direction;
  readonly createdAt: Timestamp;
  readonly sourceType: TradeSourceType;
}
export function validateTrade(trade: Trade): void {
  requireId(trade.id);
  requireId(trade.colonyId);
  requireId(trade.ideaVersionId);
  if (trade.attemptId !== null) requireId(trade.attemptId);
  if (trade.strategyMapVersionId !== null)
    requireId(trade.strategyMapVersionId);
  requireMember(trade.direction, DIRECTIONS, 'Trade direction');
  requireMember(trade.sourceType, TRADE_SOURCE_TYPES, 'Trade source type');
  timestamp(trade.createdAt);
}
export function createTrade(input: {
  readonly id: TradeId;
  readonly colony: Colony;
  readonly ideaVersion: IdeaVersion;
  readonly attempt: Attempt | null;
  readonly strategyMapVersionId: StrategyMapVersionId | null;
  readonly direction: Direction;
  readonly createdAt: Timestamp;
  readonly sourceType: TradeSourceType;
}): Trade {
  validateColony(input.colony);
  validateIdeaVersion(input.ideaVersion);
  if (input.ideaVersion.ideaId !== input.colony.ideaId)
    throw new DomainValidationError(
      'Trade IdeaVersion belongs to another Idea',
    );
  // The exact version can be a successor of the Colony's original version; never substitute it.
  if (input.attempt !== null) {
    validateAttempt(input.attempt);
    if (input.attempt.colonyId !== input.colony.id)
      throw new DomainValidationError(
        'Trade and Attempt must belong to the same Colony',
      );
    requireNotBefore(input.createdAt, input.attempt.startedAt);
  }
  requireNotBefore(input.createdAt, input.colony.createdAt);
  requireNotBefore(input.createdAt, input.ideaVersion.createdAt);
  const trade: Trade = {
    id: input.id,
    colonyId: input.colony.id,
    ideaVersionId: input.ideaVersion.id,
    attemptId: input.attempt?.id ?? null,
    strategyMapVersionId: input.strategyMapVersionId,
    direction: input.direction,
    createdAt: input.createdAt,
    sourceType: input.sourceType,
  };
  validateTrade(trade);
  return Object.freeze(trade);
}
