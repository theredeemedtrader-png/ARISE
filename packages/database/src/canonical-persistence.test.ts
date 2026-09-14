import { afterEach, describe, expect, it } from 'vitest';
import {
  brokerPositionKey,
  createAttempt,
  createAttemptBudget,
  createColony,
  createColonyLineage,
  createIdea,
  createIdeaVersion,
  createInstrument,
  createMarketObjectRelation,
  createMarketObjectWithInitialVersion,
  createPosition,
  createSuccessorIdeaVersion,
  createTarget,
  createTimeframe,
  createTimeframeProjection,
  createTrade,
  entityId,
  reviseMarketObject,
  timestamp,
  transitionColony,
  transitionIdea,
  transitionPosition,
  transitionTarget,
  type Attempt,
  type Colony,
  type Idea,
  type IdeaVersion,
  type Instrument,
  type MarketObjectWithVersion,
  type Position,
  type Timeframe,
  type Trade,
} from '@arise/domain';
import { CanonicalIdeaRepository } from './canonical-idea-repository';
import { ColonyRepository } from './colony-repository';
import { openDatabase } from './database';
import { PersistenceConflictError } from './errors';
import { MarketObjectRepository } from './market-object-repository';
import { AttemptBudgetRepository, AttemptRepository, PositionRepository, TradeRepository } from './participation-repository';
import { InstrumentRepository, TimeframeRepository } from './reference-repository';
import { TargetRepository } from './target-repository';
import { TimeframeProjectionRepository } from './timeframe-projection-repository';

const t = (minute: number) => timestamp(`2026-09-10T00:${String(minute).padStart(2, '0')}:00.000Z`);

interface CoreFixture {
  instrument: Instrument;
  daily: Timeframe;
  hour: Timeframe;
  idea: Idea;
  ideaVersion: IdeaVersion;
  colony: Colony;
}

function seedCore(connection: ReturnType<typeof openDatabase>): CoreFixture {
  const instrument = createInstrument({
    id: entityId('Instrument', 'instrument-eurusd'),
    canonicalSymbol: 'EURUSD',
    displayName: 'EUR/USD',
    assetClass: 'FOREX',
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    pipSize: 0.0001,
    tickSize: 0.00001,
    priceDigits: 5,
    enabled: true,
    createdAt: t(0),
  });
  const daily = createTimeframe({ id: entityId('Timeframe', 'timeframe-d'), code: 'D', durationSeconds: null, calendarRule: 'BROKER_DAILY', displayOrder: 10 });
  const hour = createTimeframe({ id: entityId('Timeframe', 'timeframe-1h'), code: '1H', durationSeconds: 3600, calendarRule: null, displayOrder: 20 });
  new InstrumentRepository(connection.db).insert(instrument);
  const tf = new TimeframeRepository(connection.db);
  tf.insert(daily);
  tf.insert(hour);
  const idea = createIdea({
    id: entityId('Idea', 'idea-1'),
    instrumentId: instrument.id,
    thesisTimeframeId: daily.id,
    createdAt: t(1),
  });
  const ideaRepo = new CanonicalIdeaRepository(connection.db);
  ideaRepo.insert(idea);
  const ideaVersion = createIdeaVersion(idea, {
    id: entityId('IdeaVersion', 'idea-version-1'),
    direction: 'LONG',
    thesisText: 'Daily continuation toward external buy-side liquidity.',
    targetDescription: 'Prior daily high',
    invalidationDescription: 'Daily thesis invalidation',
    primaryTargetMarketObjectVersionId: null,
    invalidationMarketObjectVersionId: null,
    createdAt: t(2),
  });
  ideaRepo.appendVersion(ideaVersion);
  const colony = createColony({
    id: entityId('Colony', 'colony-1'),
    idea,
    originalIdeaVersion: ideaVersion,
    label: 'Daily Long #01',
    createdAt: t(3),
  });
  new ColonyRepository(connection.db).insert(colony);
  return { instrument, daily, hour, idea, ideaVersion, colony };
}

describe('M2 canonical persistence', () => {
  const opened: Array<ReturnType<typeof openDatabase>['sqlite']> = [];
  const connection = () => {
    const value = openDatabase(':memory:');
    opened.push(value.sqlite);
    return value;
  };
  afterEach(() => {
    while (opened.length) opened.pop()?.close();
  });

  it('round-trips canonical Instruments and Timeframes in deterministic order', () => {
    const db = connection();
    const fx = seedCore(db);
    expect(new InstrumentRepository(db.db).findById(fx.instrument.id)).toEqual(fx.instrument);
    expect(new TimeframeRepository(db.db).list()).toEqual([fx.daily, fx.hour]);
  });

  it('persists immutable IdeaVersion history, resolves current/exact versions, and reconstructs the Idea', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new CanonicalIdeaRepository(db.db);
    const v2 = createSuccessorIdeaVersion(fx.ideaVersion, {
      id: entityId('IdeaVersion', 'idea-version-2'),
      direction: 'LONG',
      thesisText: 'Updated wording; same durable Idea.',
      targetDescription: 'Weekly external liquidity',
      invalidationDescription: 'Daily thesis invalidation',
      primaryTargetMarketObjectVersionId: null,
      invalidationMarketObjectVersionId: null,
      createdAt: t(4),
    });
    repo.appendVersion(v2);
    expect(repo.findVersion(fx.idea.id, 1)).toEqual(fx.ideaVersion);
    expect(repo.currentVersion(fx.idea.id)).toEqual(v2);
    expect(repo.reconstruct(fx.idea.id)).toEqual({ idea: fx.idea, versions: [fx.ideaVersion, v2] });
  });

  it('rejects an IdeaVersion fork/stale head at the persistence boundary', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new CanonicalIdeaRepository(db.db);
    const v2 = createSuccessorIdeaVersion(fx.ideaVersion, {
      id: entityId('IdeaVersion', 'idea-version-2'), direction: 'LONG', thesisText: 'v2', targetDescription: '', invalidationDescription: '',
      primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null, createdAt: t(4),
    });
    repo.appendVersion(v2);
    const fork = createSuccessorIdeaVersion(fx.ideaVersion, {
      id: entityId('IdeaVersion', 'idea-version-fork'), direction: 'LONG', thesisText: 'fork', targetDescription: '', invalidationDescription: '',
      primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null, createdAt: t(5),
    });
    expect(() => repo.appendVersion(fork)).toThrow(PersistenceConflictError);
    expect(repo.listVersions(fx.idea.id)).toEqual([fx.ideaVersion, v2]);
  });

  it('persists Idea current state with optimistic transition protection', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new CanonicalIdeaRepository(db.db);
    const watching = transitionIdea(fx.idea, 'WATCHING', t(4));
    repo.replaceCurrent(watching, 'DRAFT');
    expect(repo.findById(fx.idea.id)).toEqual(watching);
    expect(() => repo.replaceCurrent(transitionIdea(watching, 'ACTIVE', t(5)), 'DRAFT')).toThrow(PersistenceConflictError);
  });

  it('atomically advances Colony current state and appends immutable transition history', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new ColonyRepository(db.db);
    const first = transitionColony(fx.colony, 'BUILDING', {
      id: entityId('ColonyStateEvent', 'colony-event-1'), reason: 'First scout participating', sourceType: 'SYSTEM', sourceId: null,
      occurredAt: t(4), manualOverride: false, correlationId: null,
    });
    expect(repo.transition(first.event)).toEqual(first.colony);
    expect(repo.listEvents(fx.colony.id)).toEqual([first.event]);

    const duplicateEventId = transitionColony(first.colony, 'ESTABLISHED', {
      id: first.event.id, reason: 'Survivor established', sourceType: 'SYSTEM', sourceId: null,
      occurredAt: t(5), manualOverride: false, correlationId: null,
    });
    expect(() => repo.transition(duplicateEventId.event)).toThrow();
    expect(repo.findById(fx.colony.id)).toEqual(first.colony);
    expect(repo.listEvents(fx.colony.id)).toEqual([first.event]);
  });

  it('persists Colony lineage without rewriting either Colony', () => {
    const db = connection();
    const fx = seedCore(db);
    const ideaRepo = new CanonicalIdeaRepository(db.db);
    const secondIdea = createIdea({ id: entityId('Idea', 'idea-2'), instrumentId: fx.instrument.id, thesisTimeframeId: fx.daily.id, createdAt: t(4) });
    ideaRepo.insert(secondIdea);
    const secondVersion = createIdeaVersion(secondIdea, { id: entityId('IdeaVersion', 'idea-version-2a'), direction: 'LONG', thesisText: '', targetDescription: '', invalidationDescription: '', primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null, createdAt: t(5) });
    ideaRepo.appendVersion(secondVersion);
    const secondColony = createColony({ id: entityId('Colony', 'colony-2'), idea: secondIdea, originalIdeaVersion: secondVersion, label: 'Weekly Long #01', createdAt: t(6) });
    const repo = new ColonyRepository(db.db);
    repo.insert(secondColony);
    const lineage = createColonyLineage({ id: entityId('ColonyLineage', 'lineage-1'), sourceColonyId: fx.colony.id, targetColonyId: secondColony.id, relationshipType: 'PROMOTED_TO' });
    repo.addLineage(lineage);
    expect(repo.listLineage(fx.colony.id)).toEqual([lineage]);
    expect(repo.findById(fx.colony.id)).toEqual(fx.colony);
  });

  it('atomically persists Target progression and keeps REACHED distinct from HIT', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new TargetRepository(db.db);
    const target = createTarget(fx.colony, { id: entityId('Target', 'target-1'), targetType: 'EXTERNAL_LIQUIDITY', exactPrice: 1.12, zoneMarketObjectId: null, managementMode: 'HYBRID', createdAt: t(4) });
    repo.insert(target);
    const approaching = transitionTarget(target, 'APPROACHING', { id: entityId('TargetEvent', 'target-event-1'), reason: 'Inside threshold', sourceType: 'SYSTEM', sourceId: null, occurredAt: t(5), manualOverride: false, correlationId: null });
    const reached = transitionTarget(approaching.target, 'REACHED', { id: entityId('TargetEvent', 'target-event-2'), reason: 'Price entered destination', sourceType: 'MARKET', sourceId: null, occurredAt: t(6), manualOverride: false, correlationId: null });
    repo.transition(approaching.event);
    repo.transition(reached.event);
    expect(repo.findById(target.id)?.status).toBe('REACHED');
    expect(repo.listEvents(target.id).map((event) => event.eventType)).toEqual(['APPROACHING', 'REACHED']);
  });

  it('round-trips Market Object revisions and resolves frozen versus live-linked references', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new MarketObjectRepository(db.db);
    const initial = createMarketObjectWithInitialVersion({
      id: entityId('MarketObject', 'market-object-1'),
      versionId: entityId('MarketObjectVersion', 'market-object-version-1'),
      instrumentId: fx.instrument.id,
      ownerType: 'COLONY',
      ownerId: fx.colony.id,
      geometryType: 'RECTANGLE',
      semanticType: 'FVG',
      role: 'AREA',
      timeframeId: fx.daily.id,
      name: 'D FVG #01',
      createdAt: t(4),
      archivedAt: null,
      geometryJson: { low: 1.1, high: 1.11 },
      semanticPropertiesJson: { direction: 'LONG' },
      sourceCandleIds: [entityId('Candle', 'candle-d-1')],
    });
    repo.insertInitial(initial);
    const revised = reviseMarketObject(initial.marketObject, initial.version, {
      id: entityId('MarketObjectVersion', 'market-object-version-2'),
      createdAt: t(5),
      geometryJson: { low: 1.101, high: 1.111 },
    });
    repo.appendRevision(revised);
    expect(repo.listVersions(initial.marketObject.id)).toEqual([initial.version, revised.version]);
    expect(repo.resolve({ mode: 'FROZEN', marketObjectId: initial.marketObject.id, versionId: initial.version.id })).toEqual(initial.version);
    expect(repo.resolve({ mode: 'LIVE_LINKED', marketObjectId: initial.marketObject.id })).toEqual(revised.version);
  });

  it('rejects a stale Market Object revision without adding a fork', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new MarketObjectRepository(db.db);
    const initial = createMarketObjectWithInitialVersion({
      id: entityId('MarketObject', 'market-object-1'), versionId: entityId('MarketObjectVersion', 'market-object-version-1'),
      instrumentId: fx.instrument.id, ownerType: 'COLONY', ownerId: fx.colony.id, geometryType: 'LINE', semanticType: 'CUSTOM', role: 'REFERENCE', timeframeId: fx.daily.id, name: 'Level', createdAt: t(4), archivedAt: null,
      geometryJson: { price: 1.1 }, semanticPropertiesJson: {}, sourceCandleIds: [],
    });
    repo.insertInitial(initial);
    const accepted = reviseMarketObject(initial.marketObject, initial.version, { id: entityId('MarketObjectVersion', 'market-object-version-2'), createdAt: t(5), name: 'Level revised' });
    repo.appendRevision(accepted);
    const stale = reviseMarketObject(initial.marketObject, initial.version, { id: entityId('MarketObjectVersion', 'market-object-version-fork'), createdAt: t(6), name: 'Fork' });
    expect(() => repo.appendRevision(stale)).toThrow(PersistenceConflictError);
    expect(repo.listVersions(initial.marketObject.id)).toEqual([initial.version, accepted.version]);
  });

  it('persists Market Object relations as immutable history', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new MarketObjectRepository(db.db);
    const make = (suffix: string): MarketObjectWithVersion => createMarketObjectWithInitialVersion({
      id: entityId('MarketObject', `market-object-${suffix}`), versionId: entityId('MarketObjectVersion', `market-object-version-${suffix}`),
      instrumentId: fx.instrument.id, ownerType: 'COLONY', ownerId: fx.colony.id, geometryType: 'LINE', semanticType: 'CUSTOM', role: 'REFERENCE', timeframeId: fx.daily.id, name: suffix, createdAt: t(4), archivedAt: null,
      geometryJson: { price: 1.1 }, semanticPropertiesJson: {}, sourceCandleIds: [],
    });
    const a = make('a'); const b = make('b'); repo.insertInitial(a); repo.insertInitial(b);
    const relation = createMarketObjectRelation({ id: entityId('MarketObjectRelation', 'relation-1'), sourceMarketObjectId: a.marketObject.id, targetMarketObjectId: b.marketObject.id, relationType: 'REFINES', createdAt: t(5) });
    repo.addRelation(relation);
    expect(repo.listRelations(a.marketObject.id)).toEqual([relation]);
    expect(() => db.sqlite.exec("UPDATE market_object_relations SET relation_type='OTHER' WHERE id='relation-1'")).toThrow('immutable');
  });

  it('persists nested Timeframe Projections and reconstructs the path to root', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new TimeframeProjectionRepository(db.db);
    const parent = createTimeframeProjection({
      id: entityId('TimeframeProjection', 'projection-d-1h'), sourceEntityType: 'COLONY', sourceEntityId: fx.colony.id,
      sourceTimeframeId: fx.daily.id, targetTimeframeId: fx.hour.id, intervalStart: timestamp('2026-09-09T00:00:00.000Z'), intervalEnd: timestamp('2026-09-10T00:00:00.000Z'),
      sourceHigh: 1.12, sourceLow: 1.10, colonyId: fx.colony.id, parentProjectionId: null, createdAt: t(4),
    });
    repo.insert(parent);
    const child = createTimeframeProjection({
      id: entityId('TimeframeProjection', 'projection-child'), sourceEntityType: 'COLONY', sourceEntityId: fx.colony.id,
      sourceTimeframeId: fx.hour.id, targetTimeframeId: fx.hour.id, intervalStart: timestamp('2026-09-09T08:00:00.000Z'), intervalEnd: timestamp('2026-09-09T12:00:00.000Z'),
      sourceHigh: 1.115, sourceLow: 1.105, colonyId: fx.colony.id, parentProjectionId: parent.id, createdAt: t(5),
    });
    repo.insert(child);
    expect(repo.pathToRoot(child.id)).toEqual([parent, child]);
    expect(repo.children(parent.id)).toEqual([child]);
  });

  it('persists Attempt → Trade → Position lineage without collapsing the concepts', () => {
    const db = connection();
    const fx = seedCore(db);
    const attemptRepo = new AttemptRepository(db.db);
    const tradeRepo = new TradeRepository(db.db);
    const positionRepo = new PositionRepository(db.db);
    const attempt = createAttempt(fx.colony, { id: entityId('Attempt', 'attempt-1'), strategyRuntimeId: null, sequenceNo: 1, startedAt: t(4), completedAt: null, result: null, pipCost: null });
    attemptRepo.insert(attempt);
    const trade = createTrade({ id: entityId('Trade', 'trade-1'), colony: fx.colony, ideaVersion: fx.ideaVersion, attempt, strategyMapVersionId: null, direction: 'LONG', createdAt: t(5), sourceType: 'ARISE_MANUAL' });
    tradeRepo.insert(trade);
    const position = createPosition(trade, { id: entityId('Position', 'position-1'), brokerAccountId: entityId('BrokerAccount', 'broker-account-1'), brokerPositionKey: brokerPositionKey('ticket:123'), currentColonyId: fx.colony.id, originalSize: 0.1, currentSize: 0.1, entryPrice: 1.105, currentState: 'SCOUT', openedAt: t(6), closedAt: null });
    positionRepo.insert(position);
    expect(attemptRepo.findById(attempt.id)).toEqual(attempt);
    expect(tradeRepo.findById(trade.id)).toEqual(trade);
    expect(positionRepo.findById(position.id)).toEqual(position);
  });

  it('enforces Attempt sequence uniqueness per Colony', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new AttemptRepository(db.db);
    const a: Attempt = createAttempt(fx.colony, { id: entityId('Attempt', 'attempt-1'), strategyRuntimeId: null, sequenceNo: 1, startedAt: t(4), completedAt: null, result: null, pipCost: null });
    const b: Attempt = createAttempt(fx.colony, { id: entityId('Attempt', 'attempt-2'), strategyRuntimeId: null, sequenceNo: 1, startedAt: t(5), completedAt: null, result: null, pipCost: null });
    repo.insert(a);
    expect(() => repo.insert(b)).toThrow();
    expect(repo.listByColony(fx.colony.id)).toEqual([a]);
  });

  it('completes an Attempt once and rejects history rewriting', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new AttemptRepository(db.db);
    const attempt = createAttempt(fx.colony, { id: entityId('Attempt', 'attempt-1'), strategyRuntimeId: null, sequenceNo: 1, startedAt: t(4), completedAt: null, result: null, pipCost: null });
    repo.insert(attempt);
    const completed: Attempt = Object.freeze({ ...attempt, completedAt: t(5), result: 'FAILED', pipCost: -4 });
    repo.complete(completed);
    expect(repo.findById(attempt.id)).toEqual(completed);
    expect(() => repo.complete(Object.freeze({ ...completed, pipCost: -5 }))).toThrow(PersistenceConflictError);
  });

  it('atomically advances Position state and preserves immutable PositionStateEvents', () => {
    const db = connection();
    const fx = seedCore(db);
    const attempt = createAttempt(fx.colony, { id: entityId('Attempt', 'attempt-1'), strategyRuntimeId: null, sequenceNo: 1, startedAt: t(4), completedAt: null, result: null, pipCost: null });
    new AttemptRepository(db.db).insert(attempt);
    const trade: Trade = createTrade({ id: entityId('Trade', 'trade-1'), colony: fx.colony, ideaVersion: fx.ideaVersion, attempt, strategyMapVersionId: null, direction: 'LONG', createdAt: t(5), sourceType: 'ARISE_AUTO' });
    new TradeRepository(db.db).insert(trade);
    const position: Position = createPosition(trade, { id: entityId('Position', 'position-1'), brokerAccountId: entityId('BrokerAccount', 'broker-account-1'), brokerPositionKey: brokerPositionKey('ticket:123'), currentColonyId: fx.colony.id, originalSize: 0.1, currentSize: 0.1, entryPrice: 1.105, currentState: 'SCOUT', openedAt: t(6), closedAt: null });
    const repo = new PositionRepository(db.db); repo.insert(position);
    const transition = transitionPosition(position, 'SURVIVOR', { id: entityId('PositionStateEvent', 'position-event-1'), reason: 'Scout survived', sourceType: 'SYSTEM', sourceId: null, occurredAt: t(7), manualOverride: false, correlationId: null });
    expect(repo.transition(transition.event)).toEqual(transition.position);
    expect(repo.listEvents(position.id)).toEqual([transition.event]);
    expect(() => db.sqlite.exec("DELETE FROM position_state_events WHERE id='position-event-1'")).toThrow('immutable');
  });

  it('persists mutable AttemptBudget JSON rules with optimistic replacement', () => {
    const db = connection();
    const fx = seedCore(db);
    const repo = new AttemptBudgetRepository(db.db);
    const budget = createAttemptBudget(fx.colony, {
      id: entityId('AttemptBudget', 'budget-1'), maxAttempts: 20, maxScoutingLossPips: 60,
      cooldownRule: { kind: 'SECONDS', value: 30 }, resetRule: { kind: 'NEW_CANDLE', timeframe: 'D' }, currentPeriodKey: 'D:2026-09-10', updatedAt: t(4),
    });
    repo.insert(budget);
    const next = createAttemptBudget(fx.colony, {
      id: budget.id, maxAttempts: 25, maxScoutingLossPips: budget.maxScoutingLossPips,
      cooldownRule: budget.cooldownRule, resetRule: budget.resetRule, currentPeriodKey: 'D:2026-09-11', updatedAt: t(5),
    });
    repo.replace(next, budget.updatedAt);
    expect(repo.findById(budget.id)).toEqual(next);
    expect(() => repo.replace(createAttemptBudget(fx.colony, { id: next.id, maxAttempts: next.maxAttempts, maxScoutingLossPips: next.maxScoutingLossPips, cooldownRule: next.cooldownRule, resetRule: next.resetRule, currentPeriodKey: next.currentPeriodKey, updatedAt: t(6) }), budget.updatedAt)).toThrow(PersistenceConflictError);
  });
});
