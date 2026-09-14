import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ATTEMPT_RESULTS,
  ATTEMPT_STATES,
  ATTEMPT_TRANSITIONS,
  DIRECTIONS,
  POSITION_STATES,
  POSITION_TRANSITIONS,
  TRADE_SOURCE_TYPES,
  DomainValidationError,
  InvalidTransitionError,
  brokerPositionKey,
  canTransition,
  createAttempt,
  createPosition,
  createPositionStateEvent,
  createSuccessorIdeaVersion,
  createTrade,
  entityId,
  transitionAttemptState,
  transitionPosition,
  transitionPositionState,
  validateAttempt,
  validatePosition,
  validateTrade,
  type AttemptId,
  type AttemptResult,
  type AttemptState,
  type BrokerAccountId,
  type BrokerPositionKey,
  type ColonyId,
  type Direction,
  type ExposurePositionState,
  type PositionId,
  type PositionStateEventId,
  type StrategyMapVersionId,
  type StrategyRuntimeId,
  type TradeId,
  type TradeSourceType,
  type AttemptBudgetId,
} from './index';
import {
  attempt,
  attemptInput,
  colony,
  earlier,
  eventContext,
  idea,
  later,
  position,
  positionInput,
  start,
  trade,
  tradeInput,
  version,
} from './participation-fixtures';

// Independent expected canonical edges, not generated from the implementation.
const positionEdges = [
  'CANDIDATE:SCOUT',
  'SCOUT:SURVIVOR',
  'SCOUT:FAILED',
  'SCOUT:CLOSED',
  'SURVIVOR:PROTECTED',
  'SURVIVOR:LEG',
  'SURVIVOR:FAILED',
  'SURVIVOR:CLOSED',
  'PROTECTED:LEG',
  'PROTECTED:MATURE_LEG',
  'PROTECTED:CLOSED',
  'LEG:MATURE_LEG',
  'LEG:RUNNER',
  'LEG:CLOSED',
  'LEG:CONSOLIDATED',
  'MATURE_LEG:RUNNER',
  'MATURE_LEG:CLOSED',
  'MATURE_LEG:CONSOLIDATED',
  'RUNNER:CLOSED',
  'RUNNER:CONSOLIDATED',
];
const attemptEdges = [
  'CREATED:WAITING',
  'CREATED:EXPIRED',
  'CREATED:CANCELLED',
  'WAITING:READY',
  'WAITING:EXPIRED',
  'WAITING:CANCELLED',
  'READY:ORDER_SUBMITTED',
  'READY:EXPIRED',
  'READY:CANCELLED',
  'ORDER_SUBMITTED:FILLED',
  'ORDER_SUBMITTED:EXPIRED',
  'ORDER_SUBMITTED:CANCELLED',
  'ORDER_SUBMITTED:REJECTED',
  'FILLED:SURVIVED',
  'FILLED:FAILED',
  'FILLED:SCRATCH',
];

describe('M1.2 opaque identities', () => {
  it.each([
    'Attempt',
    'Trade',
    'Position',
    'PositionStateEvent',
    'AttemptBudget',
    'StrategyRuntime',
    'StrategyMapVersion',
    'BrokerAccount',
  ] as const)('preserves %s IDs without interpreting them', (kind) => {
    const id = entityId(kind, 'd917-opaque:001');
    expect(id).toBe('d917-opaque:001');
    expect(entityId(kind, JSON.parse(JSON.stringify(id)))).toBe(id);
    for (const invalid of ['', 'Scout #24', 'Weekly Long #05', 24])
      expect(() => entityId(kind, invalid as string)).toThrow(
        DomainValidationError,
      );
  });
  it('separates all identity kinds from other entities, labels, and sequence numbers', () => {
    expectTypeOf<AttemptId>().not.toMatchTypeOf<TradeId>();
    expectTypeOf<TradeId>().not.toMatchTypeOf<PositionId>();
    expectTypeOf<PositionId>().not.toMatchTypeOf<PositionStateEventId>();
    expectTypeOf<AttemptBudgetId>().not.toMatchTypeOf<AttemptId>();
    expectTypeOf<StrategyRuntimeId>().not.toMatchTypeOf<StrategyMapVersionId>();
    expectTypeOf<BrokerAccountId>().not.toMatchTypeOf<BrokerPositionKey>();
    expectTypeOf<string>().not.toMatchTypeOf<AttemptId>();
    expectTypeOf<number>().not.toMatchTypeOf<AttemptId>();
    expect(attempt.id).not.toBe(String(attempt.sequenceNo));
    expect(position.id).not.toBe('Scout #24');
  });
  it('preserves external broker keys without parsing MT5 or coercing numbers', () => {
    const raw = 'Broker Alpha / opaque:position@001';
    expect(brokerPositionKey(raw)).toBe(raw);
    for (const invalid of ['', ' ', 1])
      expect(() => brokerPositionKey(invalid as string)).toThrow(
        DomainValidationError,
      );
  });
});

describe('Attempt record and separate suggested lifecycle', () => {
  it('creates an unfilled Attempt with canonical nulls and no order/lifecycle fields', () => {
    expect(attempt).toEqual({ ...attemptInput, colonyId: colony.id });
    expect(Object.keys(attempt).sort()).toEqual([
      'colonyId',
      'completedAt',
      'id',
      'pipCost',
      'result',
      'sequenceNo',
      'startedAt',
      'strategyRuntimeId',
    ]);
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(() => Object.assign(attempt, { sequenceNo: 30 })).toThrow(TypeError);
  });
  it.each(ATTEMPT_RESULTS)(
    'represents terminal result %s without rewriting its parent',
    (result) => {
      const value = createAttempt(colony, {
        ...attemptInput,
        result,
        completedAt: later,
        pipCost: 0,
        strategyRuntimeId: entityId('StrategyRuntime', 'runtime-p'),
      });
      expect(value.result).toBe(result);
      expect(value.completedAt).toBe(later);
      expect(value.pipCost).toBe(0);
      expect(colony.currentState).toBe('DORMANT');
      expect(idea.currentStatus).toBe('DRAFT');
    },
  );
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid sequence %s',
    (sequenceNo) => {
      expect(() =>
        createAttempt(colony, { ...attemptInput, sequenceNo }),
      ).toThrow(DomainValidationError);
    },
  );
  it('keeps completed cancellation/rejection result null and signed pip-cost convention unaltered', () => {
    const cancelled = createAttempt(colony, {
      ...attemptInput,
      completedAt: later,
      result: null,
      pipCost: null,
    });
    expect(cancelled.completedAt).toBe(later);
    expect(cancelled.result).toBeNull();
    expect(
      createAttempt(colony, { ...attemptInput, pipCost: -3.5 }).pipCost,
    ).toBe(-3.5);
    expect(
      createAttempt(colony, { ...attemptInput, pipCost: 3.5 }).pipCost,
    ).toBe(3.5);
  });
  it('rejects invalid result, identity, nonfinite cost and temporal inconsistency', () => {
    for (const result of ['CANCELLED', 'REJECTED', 'WIN'])
      expect(() =>
        createAttempt(colony, {
          ...attemptInput,
          result: result as AttemptResult,
          completedAt: later,
        }),
      ).toThrow(DomainValidationError);
    expect(() =>
      createAttempt(colony, { ...attemptInput, result: 'FAILED' }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createAttempt(colony, { ...attemptInput, completedAt: earlier }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createAttempt(colony, { ...attemptInput, startedAt: earlier }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createAttempt(colony, {
        ...attemptInput,
        strategyRuntimeId: '' as StrategyRuntimeId,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      validateAttempt({ ...attempt, colonyId: '' as ColonyId }),
    ).toThrow(DomainValidationError);
    for (const pipCost of [NaN, Infinity, -Infinity])
      expect(() => createAttempt(colony, { ...attemptInput, pipCost })).toThrow(
        DomainValidationError,
      );
  });
  it('supports CREATED → WAITING → READY → ORDER_SUBMITTED → FILLED → SURVIVED', () => {
    let state: AttemptState = 'CREATED';
    for (const to of [
      'WAITING',
      'READY',
      'ORDER_SUBMITTED',
      'FILLED',
      'SURVIVED',
    ] as const)
      state = transitionAttemptState(state, to);
    expect(state).toBe('SURVIVED');
    expect(attempt.result).toBeNull();
  });
  it.each(ATTEMPT_STATES)(
    'checks all Attempt edges and forbidden reopenings from %s',
    (from) => {
      for (const to of ATTEMPT_STATES) {
        const allowed = attemptEdges.includes(`${from}:${to}`);
        expect(canTransition(ATTEMPT_TRANSITIONS, from, to)).toBe(allowed);
        if (allowed) expect(transitionAttemptState(from, to)).toBe(to);
        else
          expect(() => transitionAttemptState(from, to)).toThrow(
            InvalidTransitionError,
          );
      }
    },
  );
  it('does not treat unexpected or prototype keys as valid lifecycle states', () => {
    expect(() =>
      transitionAttemptState('toString' as AttemptState, 'WAITING'),
    ).toThrow(InvalidTransitionError);
    expect(() => transitionAttemptState('CREATED', 'READY')).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('Trade identity and provenance', () => {
  it.each(TRADE_SOURCE_TYPES)(
    'preserves %s and optional Attempt/Strategy Map references',
    (sourceType) => {
      const value = createTrade({ ...tradeInput, sourceType, attempt: null });
      expect(value.sourceType).toBe(sourceType);
      expect(value.attemptId).toBeNull();
      expect(value.strategyMapVersionId).toBeNull();
      expect(Object.isFrozen(value)).toBe(true);
      expect(
        createTrade({
          ...tradeInput,
          sourceType,
          strategyMapVersionId: entityId('StrategyMapVersion', 'map-v1'),
        }),
      ).toMatchObject({
        attemptId: attempt.id,
        strategyMapVersionId: 'map-v1',
      });
    },
  );
  it.each(DIRECTIONS)(
    'preserves canonical %s direction without adding a countertrend policy',
    (direction) => {
      expect(createTrade({ ...tradeInput, direction }).direction).toBe(
        direction,
      );
    },
  );
  it('references the exact supplied thesis revision, including a successor', () => {
    const successor = createSuccessorIdeaVersion(version, {
      ...version,
      id: entityId('IdeaVersion', 'iv-successor'),
      createdAt: later,
    });
    const value = createTrade({
      ...tradeInput,
      ideaVersion: successor,
      createdAt: later,
    });
    expect(value.ideaVersionId).toBe(successor.id);
    expect(colony.originalIdeaVersionId).toBe(version.id);
    expect(trade.ideaVersionId).toBe(version.id);
  });
  it('rejects cross-Colony Attempts and unrelated thesis versions', () => {
    expect(() =>
      createTrade({
        ...tradeInput,
        attempt: { ...attempt, colonyId: entityId('Colony', 'other') },
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createTrade({
        ...tradeInput,
        ideaVersion: { ...version, ideaId: entityId('Idea', 'other') },
      }),
    ).toThrow(DomainValidationError);
  });
  it('rejects malformed references, vocabulary and chronology', () => {
    expect(() =>
      createTrade({ ...tradeInput, direction: 'BULL' as Direction }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createTrade({ ...tradeInput, sourceType: 'BOT' as TradeSourceType }),
    ).toThrow(DomainValidationError);
    expect(() => createTrade({ ...tradeInput, createdAt: earlier })).toThrow(
      DomainValidationError,
    );
    expect(() =>
      createTrade({
        ...tradeInput,
        strategyMapVersionId: '' as StrategyMapVersionId,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      validateTrade({ ...trade, attemptId: '' as AttemptId }),
    ).toThrow(DomainValidationError);
    expect(() =>
      validateTrade({
        ...trade,
        ideaVersionId: '' as typeof trade.ideaVersionId,
      }),
    ).toThrow(DomainValidationError);
  });
  it('is an immutable conceptual entity, distinct from Attempt and Position', () => {
    expect(Object.keys(trade).sort()).toEqual([
      'attemptId',
      'colonyId',
      'createdAt',
      'direction',
      'id',
      'ideaVersionId',
      'sourceType',
      'strategyMapVersionId',
    ]);
    expect(trade.id).not.toBe(attempt.id);
    expect(trade.id).not.toBe(position.id);
    expect(() => Object.assign(trade, { sourceType: 'IMPORTED' })).toThrow(
      TypeError,
    );
  });
});

describe('Position and canonical state history', () => {
  it('records supplied exposure and derives source lineage/direction from its Trade', () => {
    expect(position).toEqual({
      ...positionInput,
      tradeId: trade.id,
      originalColonyId: trade.colonyId,
      direction: trade.direction,
    });
    expect(Object.isFrozen(position)).toBe(true);
    const promoted = createPosition(trade, {
      ...positionInput,
      currentColonyId: entityId('Colony', 'later-colony'),
    });
    expect(promoted.originalColonyId).toBe(colony.id);
    expect(promoted.currentColonyId).toBe('later-colony');
    expect(position.currentColonyId).toBe(colony.id);
  });
  it.each(DIRECTIONS)(
    'uses %s without narrowing canonical direction',
    (direction) => {
      const value = createPosition(
        createTrade({ ...tradeInput, direction }),
        positionInput,
      );
      expect(value.direction).toBe(direction);
    },
  );
  it.each(POSITION_STATES)(
    'checks all 10 destinations from %s against the exact canonical graph',
    (from) => {
      for (const to of POSITION_STATES) {
        const allowed = positionEdges.includes(`${from}:${to}`);
        expect(canTransition(POSITION_TRANSITIONS, from, to)).toBe(allowed);
        if (allowed) {
          expect(transitionPositionState(from, to)).toBe(to);
          const event = createPositionStateEvent({
            ...eventContext,
            positionId: position.id,
            fromState: from,
            toState: to,
          });
          expect(event).toMatchObject({
            ...eventContext,
            positionId: position.id,
            fromState: from,
            toState: to,
          });
          expect(Object.isFrozen(event)).toBe(true);
          if (from !== 'CANDIDATE') {
            const value = createPosition(trade, {
              ...positionInput,
              currentState: from,
              currentSize: to === 'CLOSED' ? 0 : 0.1,
            });
            const result = transitionPosition(
              value,
              to as ExposurePositionState,
              eventContext,
            );
            expect(result.position.currentState).toBe(to);
            expect(result.event).toEqual(event);
            expect(result.position.closedAt).toBe(
              to === 'CLOSED' ? later : null,
            );
            expect(value.currentState).toBe(from);
          }
        } else {
          expect(() => transitionPositionState(from, to)).toThrow(
            InvalidTransitionError,
          );
          expect(() =>
            createPositionStateEvent({
              ...eventContext,
              positionId: position.id,
              fromState: from,
              toState: to,
            }),
          ).toThrow(InvalidTransitionError);
        }
      }
    },
  );
  it('keeps pre-fill CANDIDATE semantic state separate from actual broker fields', () => {
    expect(transitionPositionState('CANDIDATE', 'SCOUT')).toBe('SCOUT');
    expect(() =>
      createPosition(trade, {
        ...positionInput,
        currentState: 'CANDIDATE' as ExposurePositionState,
      }),
    ).toThrow(DomainValidationError);
  });
  it('cannot manufacture a broker close merely by changing lifecycle state', () => {
    expect(() => transitionPosition(position, 'CLOSED', eventContext)).toThrow(
      'zero exposure',
    );
    expect(position.currentSize).toBe(0.1);
    expect(position.closedAt).toBeNull();
    const alreadyFlat = createPosition(trade, {
      ...positionInput,
      currentSize: 0,
    });
    const closed = transitionPosition(alreadyFlat, 'CLOSED', eventContext);
    expect(closed.position.currentSize).toBe(0);
    expect(closed.position.closedAt).toBe(later);
    expect(alreadyFlat.closedAt).toBeNull();
    expect(() =>
      transitionPosition(closed.position, 'SCOUT', eventContext),
    ).toThrow(InvalidTransitionError);
  });
  it('does not mistake FAILED or CONSOLIDATED for a broker close', () => {
    const failed = transitionPosition(
      position,
      'FAILED',
      eventContext,
    ).position;
    expect(failed.currentSize).toBe(0.1);
    expect(failed.closedAt).toBeNull();
    const leg = createPosition(trade, {
      ...positionInput,
      currentState: 'LEG',
    });
    const consolidated = transitionPosition(
      leg,
      'CONSOLIDATED',
      eventContext,
    ).position;
    expect(consolidated.currentSize).toBe(0.1);
    expect(consolidated.closedAt).toBeNull();
    expect(consolidated.currentColonyId).toBe(leg.currentColonyId);
    expect(idea.currentStatus).toBe('DRAFT');
    expect(colony.currentState).toBe('DORMANT');
  });
  it('preserves size/price/lineage through maturity without management fields or parent changes', () => {
    let value = position;
    for (const state of [
      'SURVIVOR',
      'PROTECTED',
      'LEG',
      'MATURE_LEG',
      'RUNNER',
    ] as const) {
      const before = JSON.stringify(value);
      const result = transitionPosition(value, state, eventContext);
      expect(JSON.stringify(value)).toBe(before);
      expect(Object.keys(result).sort()).toEqual(['event', 'position']);
      expect(result.position).toEqual({ ...value, currentState: state });
      expect(Object.keys(result.position).sort()).toEqual([
        'brokerAccountId',
        'brokerPositionKey',
        'closedAt',
        'currentColonyId',
        'currentSize',
        'currentState',
        'direction',
        'entryPrice',
        'id',
        'openedAt',
        'originalColonyId',
        'originalSize',
        'tradeId',
      ]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.position)).toBe(true);
      value = result.position;
    }
    expect(idea.currentStatus).toBe('DRAFT');
    expect(colony.currentState).toBe('DORMANT');
    expect(attempt.result).toBeNull();
  });
  it.each([0, -1, NaN, Infinity])(
    'rejects invalid original size %s',
    (originalSize) => {
      expect(() =>
        createPosition(trade, { ...positionInput, originalSize }),
      ).toThrow(DomainValidationError);
    },
  );
  it.each([-1, NaN, Infinity])(
    'rejects invalid current size %s',
    (currentSize) => {
      expect(() =>
        createPosition(trade, { ...positionInput, currentSize }),
      ).toThrow(DomainValidationError);
    },
  );
  it('validates remaining fields and closure chronology without imposing a netting model', () => {
    expect(
      createPosition(trade, {
        ...positionInput,
        currentSize: 0.2,
        entryPrice: -1,
      }).currentSize,
    ).toBe(0.2);
    for (const entryPrice of [NaN, Infinity])
      expect(() =>
        createPosition(trade, { ...positionInput, entryPrice }),
      ).toThrow(DomainValidationError);
    expect(() =>
      createPosition(trade, {
        ...positionInput,
        brokerAccountId: '' as BrokerAccountId,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createPosition(trade, { ...positionInput, openedAt: earlier }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createPosition(trade, {
        ...positionInput,
        currentState: 'CLOSED',
        closedAt: later,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createPosition(trade, {
        ...positionInput,
        currentState: 'CLOSED',
        currentSize: 0,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createPosition(trade, {
        ...positionInput,
        currentSize: 0,
        closedAt: later,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createPosition(trade, {
        ...positionInput,
        currentState: 'CLOSED',
        currentSize: 0,
        closedAt: earlier,
      }),
    ).toThrow(DomainValidationError);
    expect(
      createPosition(trade, {
        ...positionInput,
        currentState: 'FAILED',
        currentSize: 0,
        closedAt: later,
      }).closedAt,
    ).toBe(later);
    expect(() =>
      validatePosition({ ...position, direction: 'BEAR' as Direction }),
    ).toThrow(DomainValidationError);
    expect(() =>
      validatePosition({
        ...position,
        currentState: 'unknown' as ExposurePositionState,
      }),
    ).toThrow(DomainValidationError);
  });
  it('validates audit context, retains null source IDs, and rejects backdated transitions', () => {
    const result = transitionPosition(position, 'SURVIVOR', {
      ...eventContext,
      sourceId: null,
      correlationId: null,
    });
    expect(result.event.sourceId).toBeNull();
    expect(result.event.correlationId).toBeNull();
    expect(() => Object.assign(result.event, { fromState: 'LEG' })).toThrow(
      TypeError,
    );
    for (const bad of [
      { reason: '' },
      { sourceType: '' },
      { sourceId: '' },
      { correlationId: '' },
      { manualOverride: undefined },
    ]) {
      expect(() =>
        transitionPosition(position, 'SURVIVOR', {
          ...eventContext,
          ...bad,
        } as typeof eventContext),
      ).toThrow(DomainValidationError);
    }
    expect(() =>
      transitionPosition(position, 'SURVIVOR', {
        ...eventContext,
        occurredAt: earlier,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createPositionStateEvent({
        ...eventContext,
        id: '' as PositionStateEventId,
        positionId: position.id,
        fromState: 'SCOUT',
        toState: 'SURVIVOR',
      }),
    ).toThrow(DomainValidationError);
    expect(transitionPosition(position, 'SURVIVOR', eventContext)).toEqual(
      transitionPosition(position, 'SURVIVOR', eventContext),
    );
    expect(start).toBe(position.openedAt);
  });
});
