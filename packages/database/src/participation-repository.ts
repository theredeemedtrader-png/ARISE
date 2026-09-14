import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  createPositionStateEvent,
  transitionPosition,
  validateAttempt,
  validateAttemptBudget,
  validatePosition,
  validateTrade,
  type Attempt,
  type AttemptBudget,
  type AttemptBudgetId,
  type AttemptId,
  type ColonyId,
  type ExposurePositionState,
  type Position,
  type PositionId,
  type PositionStateEvent,
  type Timestamp,
  type Trade,
  type TradeId,
} from '@arise/domain';
import {
  boolToInt,
  encodeJson,
  hydrateAttempt,
  hydrateAttemptBudget,
  hydratePosition,
  hydratePositionStateEvent,
  hydrateTrade,
} from './codec';
import type { AriseDatabase } from './database';
import { PersistenceConflictError, PersistenceIntegrityError, PersistenceNotFoundError } from './errors';
import { attemptBudgets, attempts, colonies, ideaVersions, positions, positionStateEvents, trades } from './schema';

export class AttemptRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: Attempt): Attempt {
    validateAttempt(input);
    this.db.insert(attempts).values({
      id: input.id,
      colonyId: input.colonyId,
      strategyRuntimeId: input.strategyRuntimeId,
      sequenceNo: input.sequenceNo,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      result: input.result,
      pipCost: input.pipCost,
    }).run();
    return input;
  }

  findById(id: AttemptId): Attempt | null {
    const row = this.db.select().from(attempts).where(eq(attempts.id, id)).limit(1).all()[0];
    return row ? hydrateAttempt(row) : null;
  }

  listByColony(colonyId: ColonyId): readonly Attempt[] {
    return Object.freeze(this.db.select().from(attempts).where(eq(attempts.colonyId, colonyId))
      .orderBy(asc(attempts.sequenceNo)).all().map(hydrateAttempt));
  }

  complete(next: Attempt): Attempt {
    validateAttempt(next);
    if (next.completedAt === null) throw new PersistenceIntegrityError('Completed Attempt requires completedAt');
    const current = this.findById(next.id);
    if (!current) throw new PersistenceNotFoundError('Attempt', next.id);
    if (current.completedAt !== null) throw new PersistenceConflictError('Attempt is already completed');
    if (
      current.colonyId !== next.colonyId ||
      current.strategyRuntimeId !== next.strategyRuntimeId ||
      current.sequenceNo !== next.sequenceNo ||
      current.startedAt !== next.startedAt
    ) throw new PersistenceIntegrityError('Attempt immutable fields cannot change');
    const updated = this.db.update(attempts).set({
      completedAt: next.completedAt,
      result: next.result,
      pipCost: next.pipCost,
    }).where(and(eq(attempts.id, next.id), isNull(attempts.completedAt))).run();
    if (updated.changes !== 1) throw new PersistenceConflictError('Attempt changed concurrently');
    return next;
  }
}

export class TradeRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: Trade): Trade {
    validateTrade(input);
    const colony = this.db.select().from(colonies).where(eq(colonies.id, input.colonyId)).limit(1).all()[0];
    if (!colony) throw new PersistenceNotFoundError('Colony', input.colonyId);
    const version = this.db.select().from(ideaVersions).where(eq(ideaVersions.id, input.ideaVersionId)).limit(1).all()[0];
    if (!version) throw new PersistenceNotFoundError('IdeaVersion', input.ideaVersionId);
    if (version.ideaId !== colony.ideaId)
      throw new PersistenceIntegrityError('Trade IdeaVersion does not belong to Colony Idea');
    if (input.attemptId !== null) {
      const attempt = this.db.select().from(attempts).where(eq(attempts.id, input.attemptId)).limit(1).all()[0];
      if (!attempt) throw new PersistenceNotFoundError('Attempt', input.attemptId);
      if (attempt.colonyId !== input.colonyId)
        throw new PersistenceIntegrityError('Trade Attempt belongs to another Colony');
    }
    this.db.insert(trades).values({
      id: input.id,
      attemptId: input.attemptId,
      colonyId: input.colonyId,
      ideaVersionId: input.ideaVersionId,
      strategyMapVersionId: input.strategyMapVersionId,
      direction: input.direction,
      createdAt: input.createdAt,
      sourceType: input.sourceType,
    }).run();
    return input;
  }

  findById(id: TradeId): Trade | null {
    const row = this.db.select().from(trades).where(eq(trades.id, id)).limit(1).all()[0];
    return row ? hydrateTrade(row) : null;
  }

  listByColony(colonyId: ColonyId): readonly Trade[] {
    return Object.freeze(this.db.select().from(trades).where(eq(trades.colonyId, colonyId))
      .orderBy(asc(trades.createdAt), asc(trades.id)).all().map(hydrateTrade));
  }
}

export class PositionRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: Position): Position {
    validatePosition(input);
    const trade = this.db.select().from(trades).where(eq(trades.id, input.tradeId)).limit(1).all()[0];
    if (!trade) throw new PersistenceNotFoundError('Trade', input.tradeId);
    if (trade.colonyId !== input.originalColonyId || trade.direction !== input.direction)
      throw new PersistenceIntegrityError('Position must preserve Trade origin Colony and direction');
    if (!this.db.select({ id: colonies.id }).from(colonies).where(eq(colonies.id, input.currentColonyId)).limit(1).all()[0])
      throw new PersistenceNotFoundError('Current Colony', input.currentColonyId);
    this.db.insert(positions).values({
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
      currentState: input.currentState,
      openedAt: input.openedAt,
      closedAt: input.closedAt,
    }).run();
    return input;
  }

  findById(id: PositionId): Position | null {
    const row = this.db.select().from(positions).where(eq(positions.id, id)).limit(1).all()[0];
    return row ? hydratePosition(row) : null;
  }

  listByColony(colonyId: ColonyId): readonly Position[] {
    return Object.freeze(this.db.select().from(positions).where(eq(positions.currentColonyId, colonyId))
      .orderBy(asc(positions.openedAt), asc(positions.id)).all().map(hydratePosition));
  }

  transition(eventInput: PositionStateEvent): Position {
    const event = createPositionStateEvent(eventInput);
    let next!: Position;
    this.db.transaction((tx) => {
      const row = tx.select().from(positions).where(eq(positions.id, event.positionId)).limit(1).all()[0];
      if (!row) throw new PersistenceNotFoundError('Position', event.positionId);
      const current = hydratePosition(row);
      if (current.currentState !== event.fromState)
        throw new PersistenceConflictError(`Position stale state: expected ${event.fromState}, found ${current.currentState}`);
      next = transitionPosition(current, event.toState as ExposurePositionState, event).position;
      const updated = tx.update(positions).set({
        currentState: next.currentState,
        closedAt: next.closedAt,
      }).where(and(eq(positions.id, current.id), eq(positions.currentState, event.fromState))).run();
      if (updated.changes !== 1) throw new PersistenceConflictError('Position changed concurrently');
      tx.insert(positionStateEvents).values({
        id: event.id,
        positionId: event.positionId,
        fromState: event.fromState,
        toState: event.toState,
        reason: event.reason,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        occurredAt: event.occurredAt,
        manualOverride: boolToInt(event.manualOverride),
        correlationId: event.correlationId,
      }).run();
    });
    return next;
  }

  listEvents(id: PositionId): readonly PositionStateEvent[] {
    return Object.freeze(this.db.select().from(positionStateEvents).where(eq(positionStateEvents.positionId, id))
      .orderBy(asc(positionStateEvents.occurredAt), asc(positionStateEvents.id)).all().map(hydratePositionStateEvent));
  }
}

export class AttemptBudgetRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: AttemptBudget): AttemptBudget {
    validateAttemptBudget(input);
    this.db.insert(attemptBudgets).values({
      id: input.id,
      colonyId: input.colonyId,
      maxAttempts: input.maxAttempts,
      maxScoutingLossPips: input.maxScoutingLossPips,
      cooldownRuleJson: input.cooldownRule === null ? null : encodeJson(input.cooldownRule),
      resetRuleJson: encodeJson(input.resetRule),
      currentPeriodKey: input.currentPeriodKey,
      updatedAt: input.updatedAt,
    }).run();
    return input;
  }

  findById(id: AttemptBudgetId): AttemptBudget | null {
    const row = this.db.select().from(attemptBudgets).where(eq(attemptBudgets.id, id)).limit(1).all()[0];
    return row ? hydrateAttemptBudget(row) : null;
  }

  listByColony(colonyId: ColonyId): readonly AttemptBudget[] {
    return Object.freeze(this.db.select().from(attemptBudgets).where(eq(attemptBudgets.colonyId, colonyId))
      .orderBy(asc(attemptBudgets.id)).all().map(hydrateAttemptBudget));
  }

  replace(next: AttemptBudget, expectedUpdatedAt: Timestamp): AttemptBudget {
    validateAttemptBudget(next);
    const current = this.findById(next.id);
    if (!current) throw new PersistenceNotFoundError('AttemptBudget', next.id);
    if (current.updatedAt !== expectedUpdatedAt)
      throw new PersistenceConflictError(`AttemptBudget stale version: expected ${expectedUpdatedAt}, found ${current.updatedAt}`);
    if (current.colonyId !== next.colonyId)
      throw new PersistenceIntegrityError('AttemptBudget Colony cannot change');
    if (next.updatedAt <= current.updatedAt)
      throw new PersistenceIntegrityError('AttemptBudget update timestamp must advance');
    const updated = this.db.update(attemptBudgets).set({
      maxAttempts: next.maxAttempts,
      maxScoutingLossPips: next.maxScoutingLossPips,
      cooldownRuleJson: next.cooldownRule === null ? null : encodeJson(next.cooldownRule),
      resetRuleJson: encodeJson(next.resetRule),
      currentPeriodKey: next.currentPeriodKey,
      updatedAt: next.updatedAt,
    }).where(and(eq(attemptBudgets.id, next.id), eq(attemptBudgets.updatedAt, expectedUpdatedAt))).run();
    if (updated.changes !== 1) throw new PersistenceConflictError('AttemptBudget changed concurrently');
    return next;
  }
}
