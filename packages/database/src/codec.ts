import {
  brokerPositionKey,
  createMarketObject,
  createMarketObjectRelation,
  createMarketObjectVersion,
  createTargetEvent,
  createTimeframeProjection,
  createTimeframe,
  createInstrument,
  createColonyLineage,
  createColonyStateEvent,
  createPositionStateEvent,
  requireId,
  timestamp,
  validateAttempt,
  validateAttemptBudget,
  validateColony,
  validateIdea,
  validateIdeaVersion,
  validatePosition,
  validateTarget,
  validateTrade,
  type Attempt,
  type AttemptBudget,
  type BrokerAccountId,
  type Colony,
  type ColonyId,
  type ColonyLineage,
  type ColonyState,
  type ColonyStateEvent,
  type Direction,
  type EntityId,
  type EntityKind,
  type Idea,
  type IdeaId,
  type IdeaStatus,
  type IdeaVersion,
  type IdeaVersionId,
  type Instrument,
  type InstrumentId,
  type MarketObject,
  type MarketObjectGeometryType,
  type MarketObjectId,
  type MarketObjectJson,
  type MarketObjectRelation,
  type MarketObjectRelationId,
  type MarketObjectRole,
  type MarketObjectVersion,
  type MarketObjectVersionId,
  type Position,
  type PositionId,
  type PositionState,
  type PositionStateEvent,
  type RuleValue,
  type StrategyMapVersionId,
  type StrategyRuntimeId,
  type Target,
  type TargetEvent,
  type TargetEventId,
  type TargetEventType,
  type TargetId,
  type TargetManagementMode,
  type TargetStatus,
  type Timeframe,
  type TimeframeId,
  type TimeframeProjection,
  type TimeframeProjectionId,
  type Trade,
  type TradeId,
  type TradeSourceType,
  type AttemptId,
  type AttemptResult,
  type AttemptBudgetId,
  type PositionStateEventId,
  type Timestamp,
} from '@arise/domain';

export function opaqueId<T extends string>(value: string): T {
  requireId(value);
  return value as T;
}

export function opaqueEntityId(value: string): EntityId<EntityKind> {
  requireId(value);
  return value as EntityId<EntityKind>;
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

export function intToBool(value: number): boolean {
  if (value !== 0 && value !== 1) throw new Error(`Invalid persisted boolean: ${value}`);
  return value === 1;
}

export function encodeJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Value is not JSON serializable');
  return encoded;
}

export function decodeJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export type InstrumentRow = {
  id: string;
  canonicalSymbol: string;
  displayName: string;
  assetClass: string;
  baseCurrency: string;
  quoteCurrency: string;
  pipSize: number;
  tickSize: number;
  priceDigits: number;
  enabled: number;
  createdAt: string;
};
export function hydrateInstrument(row: InstrumentRow): Instrument {
  return createInstrument({
    id: opaqueId<InstrumentId>(row.id),
    canonicalSymbol: row.canonicalSymbol,
    displayName: row.displayName,
    assetClass: row.assetClass,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    pipSize: row.pipSize,
    tickSize: row.tickSize,
    priceDigits: row.priceDigits,
    enabled: intToBool(row.enabled),
    createdAt: timestamp(row.createdAt),
  });
}

export type TimeframeRow = {
  id: string;
  code: string;
  durationSeconds: number | null;
  calendarRule: string | null;
  displayOrder: number;
};
export function hydrateTimeframe(row: TimeframeRow): Timeframe {
  return createTimeframe({
    id: opaqueId<TimeframeId>(row.id),
    code: row.code,
    durationSeconds: row.durationSeconds,
    calendarRule: row.calendarRule,
    displayOrder: row.displayOrder,
  });
}

export type IdeaRow = {
  id: string;
  instrumentId: string;
  thesisTimeframeId: string;
  currentStatus: string;
  createdAt: string;
  archivedAt: string | null;
};
export function hydrateIdea(row: IdeaRow): Idea {
  const value: Idea = {
    id: opaqueId<IdeaId>(row.id),
    instrumentId: opaqueId<InstrumentId>(row.instrumentId),
    thesisTimeframeId: opaqueId<TimeframeId>(row.thesisTimeframeId),
    currentStatus: row.currentStatus as IdeaStatus,
    createdAt: timestamp(row.createdAt),
    archivedAt: row.archivedAt === null ? null : timestamp(row.archivedAt),
  };
  validateIdea(value);
  return Object.freeze(value);
}

export type IdeaVersionRow = {
  id: string;
  ideaId: string;
  versionNo: number;
  direction: string;
  thesisText: string;
  targetDescription: string;
  invalidationDescription: string;
  primaryTargetMarketObjectVersionId: string | null;
  invalidationMarketObjectVersionId: string | null;
  createdAt: string;
  supersedesIdeaVersionId: string | null;
};
export function hydrateIdeaVersion(row: IdeaVersionRow): IdeaVersion {
  const value: IdeaVersion = {
    id: opaqueId<IdeaVersionId>(row.id),
    ideaId: opaqueId<IdeaId>(row.ideaId),
    versionNo: row.versionNo,
    direction: row.direction as Direction,
    thesisText: row.thesisText,
    targetDescription: row.targetDescription,
    invalidationDescription: row.invalidationDescription,
    primaryTargetMarketObjectVersionId:
      row.primaryTargetMarketObjectVersionId === null
        ? null
        : opaqueId<MarketObjectVersionId>(row.primaryTargetMarketObjectVersionId),
    invalidationMarketObjectVersionId:
      row.invalidationMarketObjectVersionId === null
        ? null
        : opaqueId<MarketObjectVersionId>(row.invalidationMarketObjectVersionId),
    createdAt: timestamp(row.createdAt),
    supersedesIdeaVersionId:
      row.supersedesIdeaVersionId === null
        ? null
        : opaqueId<IdeaVersionId>(row.supersedesIdeaVersionId),
  };
  validateIdeaVersion(value);
  return Object.freeze(value);
}

export type ColonyRow = {
  id: string;
  ideaId: string;
  originalIdeaVersionId: string;
  instrumentId: string;
  label: string;
  currentState: string;
  currentTargetId: string | null;
  createdAt: string;
  completedAt: string | null;
};
export function hydrateColony(row: ColonyRow): Colony {
  const value: Colony = {
    id: opaqueId<ColonyId>(row.id),
    ideaId: opaqueId<IdeaId>(row.ideaId),
    originalIdeaVersionId: opaqueId<IdeaVersionId>(row.originalIdeaVersionId),
    instrumentId: opaqueId<InstrumentId>(row.instrumentId),
    label: row.label,
    currentState: row.currentState as ColonyState,
    currentTargetId: row.currentTargetId === null ? null : opaqueId<TargetId>(row.currentTargetId),
    createdAt: timestamp(row.createdAt),
    completedAt: row.completedAt === null ? null : timestamp(row.completedAt),
  };
  validateColony(value);
  return Object.freeze(value);
}

export type ColonyLineageRow = {
  id: string;
  sourceColonyId: string;
  targetColonyId: string;
  relationshipType: 'PROMOTED_TO' | 'CONSOLIDATED_INTO' | 'DERIVED_FROM';
};
export function hydrateColonyLineage(row: ColonyLineageRow): ColonyLineage {
  return createColonyLineage({
    id: opaqueId(row.id),
    sourceColonyId: opaqueId(row.sourceColonyId),
    targetColonyId: opaqueId(row.targetColonyId),
    relationshipType: row.relationshipType,
  });
}

export type TransitionRow = {
  reason: string;
  sourceType: string;
  sourceId: string | null;
  occurredAt: string;
  manualOverride: number;
  correlationId: string | null;
};
function hydrateTransition(row: TransitionRow) {
  return {
    reason: row.reason,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    occurredAt: timestamp(row.occurredAt),
    manualOverride: intToBool(row.manualOverride),
    correlationId: row.correlationId,
  } as const;
}

export type ColonyStateEventRow = TransitionRow & {
  id: string;
  colonyId: string;
  fromState: string;
  toState: string;
};
export function hydrateColonyStateEvent(row: ColonyStateEventRow): ColonyStateEvent {
  return createColonyStateEvent({
    ...hydrateTransition(row),
    id: opaqueId(row.id),
    colonyId: opaqueId(row.colonyId),
    fromState: row.fromState as ColonyState,
    toState: row.toState as ColonyState,
  });
}

export type TargetRow = {
  id: string;
  colonyId: string;
  targetType: string;
  exactPrice: number | null;
  zoneMarketObjectId: string | null;
  managementMode: string;
  status: string;
  createdAt: string;
};
export function hydrateTarget(row: TargetRow): Target {
  const value: Target = {
    id: opaqueId<TargetId>(row.id),
    colonyId: opaqueId<ColonyId>(row.colonyId),
    targetType: row.targetType,
    exactPrice: row.exactPrice,
    zoneMarketObjectId:
      row.zoneMarketObjectId === null ? null : opaqueId<MarketObjectId>(row.zoneMarketObjectId),
    managementMode: row.managementMode as TargetManagementMode,
    status: row.status as TargetStatus,
    createdAt: timestamp(row.createdAt),
  };
  validateTarget(value);
  return Object.freeze(value);
}

export type TargetEventRow = TransitionRow & {
  id: string;
  targetId: string;
  fromStatus: string;
  toStatus: string;
  eventType: string;
};
export function hydrateTargetEvent(row: TargetEventRow): TargetEvent {
  return createTargetEvent({
    ...hydrateTransition(row),
    id: opaqueId<TargetEventId>(row.id),
    targetId: opaqueId<TargetId>(row.targetId),
    fromStatus: row.fromStatus as TargetStatus,
    toStatus: row.toStatus as TargetEventType,
    eventType: row.eventType as TargetEventType,
  });
}

export type MarketObjectRow = {
  id: string;
  instrumentId: string;
  ownerType: string;
  ownerId: string;
  geometryType: string;
  semanticType: string;
  role: string;
  timeframeId: string | null;
  name: string;
  currentVersionId: string;
  createdAt: string;
  archivedAt: string | null;
};
export function hydrateMarketObject(row: MarketObjectRow): MarketObject {
  return createMarketObject({
    id: opaqueId<MarketObjectId>(row.id),
    instrumentId: opaqueId<InstrumentId>(row.instrumentId),
    ownerType: row.ownerType,
    ownerId: opaqueEntityId(row.ownerId),
    geometryType: row.geometryType as MarketObjectGeometryType,
    semanticType: row.semanticType,
    role: row.role as MarketObjectRole,
    timeframeId: row.timeframeId === null ? null : opaqueId<TimeframeId>(row.timeframeId),
    name: row.name,
    currentVersionId: opaqueId<MarketObjectVersionId>(row.currentVersionId),
    createdAt: timestamp(row.createdAt),
    archivedAt: row.archivedAt === null ? null : timestamp(row.archivedAt),
  });
}

export type MarketObjectVersionRow = {
  id: string;
  marketObjectId: string;
  versionNo: number;
  geometryType: string;
  semanticType: string;
  role: string;
  timeframeId: string | null;
  name: string;
  geometryJson: string;
  semanticPropertiesJson: string;
  sourceCandleIdsJson: string;
  createdAt: string;
  supersedesVersionId: string | null;
};
export function hydrateMarketObjectVersion(row: MarketObjectVersionRow): MarketObjectVersion {
  return createMarketObjectVersion({
    id: opaqueId<MarketObjectVersionId>(row.id),
    marketObjectId: opaqueId<MarketObjectId>(row.marketObjectId),
    versionNo: row.versionNo,
    geometryType: row.geometryType as MarketObjectGeometryType,
    semanticType: row.semanticType,
    role: row.role as MarketObjectRole,
    timeframeId: row.timeframeId === null ? null : opaqueId<TimeframeId>(row.timeframeId),
    name: row.name,
    geometryJson: decodeJson<MarketObjectJson>(row.geometryJson),
    semanticPropertiesJson: decodeJson<MarketObjectJson>(row.semanticPropertiesJson),
    sourceCandleIds: decodeJson<string[]>(row.sourceCandleIdsJson).map((id) => opaqueId(id)),
    createdAt: timestamp(row.createdAt),
    supersedesVersionId:
      row.supersedesVersionId === null ? null : opaqueId<MarketObjectVersionId>(row.supersedesVersionId),
  });
}

export type MarketObjectRelationRow = {
  id: string;
  sourceMarketObjectId: string;
  targetMarketObjectId: string;
  relationType: string;
  createdAt: string;
};
export function hydrateMarketObjectRelation(row: MarketObjectRelationRow): MarketObjectRelation {
  return createMarketObjectRelation({
    id: opaqueId<MarketObjectRelationId>(row.id),
    sourceMarketObjectId: opaqueId<MarketObjectId>(row.sourceMarketObjectId),
    targetMarketObjectId: opaqueId<MarketObjectId>(row.targetMarketObjectId),
    relationType: row.relationType,
    createdAt: timestamp(row.createdAt),
  });
}

export type TimeframeProjectionRow = {
  id: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceTimeframeId: string;
  targetTimeframeId: string;
  intervalStart: string;
  intervalEnd: string;
  sourceHigh: number | null;
  sourceLow: number | null;
  colonyId: string | null;
  parentProjectionId: string | null;
  createdAt: string;
};
export function hydrateTimeframeProjection(row: TimeframeProjectionRow): TimeframeProjection {
  return createTimeframeProjection({
    id: opaqueId<TimeframeProjectionId>(row.id),
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: opaqueEntityId(row.sourceEntityId),
    sourceTimeframeId: opaqueId<TimeframeId>(row.sourceTimeframeId),
    targetTimeframeId: opaqueId<TimeframeId>(row.targetTimeframeId),
    intervalStart: timestamp(row.intervalStart),
    intervalEnd: timestamp(row.intervalEnd),
    sourceHigh: row.sourceHigh,
    sourceLow: row.sourceLow,
    colonyId: row.colonyId === null ? null : opaqueId<ColonyId>(row.colonyId),
    parentProjectionId:
      row.parentProjectionId === null ? null : opaqueId<TimeframeProjectionId>(row.parentProjectionId),
    createdAt: timestamp(row.createdAt),
  });
}

export type AttemptRow = {
  id: string;
  colonyId: string;
  strategyRuntimeId: string | null;
  sequenceNo: number;
  startedAt: string;
  completedAt: string | null;
  result: string | null;
  pipCost: number | null;
};
export function hydrateAttempt(row: AttemptRow): Attempt {
  const value: Attempt = {
    id: opaqueId<AttemptId>(row.id),
    colonyId: opaqueId<ColonyId>(row.colonyId),
    strategyRuntimeId:
      row.strategyRuntimeId === null ? null : opaqueId<StrategyRuntimeId>(row.strategyRuntimeId),
    sequenceNo: row.sequenceNo,
    startedAt: timestamp(row.startedAt),
    completedAt: row.completedAt === null ? null : timestamp(row.completedAt),
    result: row.result as AttemptResult | null,
    pipCost: row.pipCost,
  };
  validateAttempt(value);
  return Object.freeze(value);
}

export type TradeRow = {
  id: string;
  attemptId: string | null;
  colonyId: string;
  ideaVersionId: string;
  strategyMapVersionId: string | null;
  direction: string;
  createdAt: string;
  sourceType: string;
};
export function hydrateTrade(row: TradeRow): Trade {
  const value: Trade = {
    id: opaqueId<TradeId>(row.id),
    attemptId: row.attemptId === null ? null : opaqueId<AttemptId>(row.attemptId),
    colonyId: opaqueId<ColonyId>(row.colonyId),
    ideaVersionId: opaqueId<IdeaVersionId>(row.ideaVersionId),
    strategyMapVersionId:
      row.strategyMapVersionId === null ? null : opaqueId<StrategyMapVersionId>(row.strategyMapVersionId),
    direction: row.direction as Direction,
    createdAt: timestamp(row.createdAt),
    sourceType: row.sourceType as TradeSourceType,
  };
  validateTrade(value);
  return Object.freeze(value);
}

export type PositionRow = {
  id: string;
  tradeId: string;
  brokerAccountId: string;
  brokerPositionKey: string;
  originalColonyId: string;
  currentColonyId: string;
  direction: string;
  originalSize: number;
  currentSize: number;
  entryPrice: number;
  currentState: string;
  openedAt: string;
  closedAt: string | null;
};
export function hydratePosition(row: PositionRow): Position {
  const value: Position = {
    id: opaqueId<PositionId>(row.id),
    tradeId: opaqueId<TradeId>(row.tradeId),
    brokerAccountId: opaqueId<BrokerAccountId>(row.brokerAccountId),
    brokerPositionKey: brokerPositionKey(row.brokerPositionKey),
    originalColonyId: opaqueId<ColonyId>(row.originalColonyId),
    currentColonyId: opaqueId<ColonyId>(row.currentColonyId),
    direction: row.direction as Direction,
    originalSize: row.originalSize,
    currentSize: row.currentSize,
    entryPrice: row.entryPrice,
    currentState: row.currentState as Position['currentState'],
    openedAt: timestamp(row.openedAt),
    closedAt: row.closedAt === null ? null : timestamp(row.closedAt),
  };
  validatePosition(value);
  return Object.freeze(value);
}

export type PositionStateEventRow = TransitionRow & {
  id: string;
  positionId: string;
  fromState: string;
  toState: string;
};
export function hydratePositionStateEvent(row: PositionStateEventRow): PositionStateEvent {
  return createPositionStateEvent({
    ...hydrateTransition(row),
    id: opaqueId<PositionStateEventId>(row.id),
    positionId: opaqueId<PositionId>(row.positionId),
    fromState: row.fromState as PositionState,
    toState: row.toState as PositionState,
  });
}

export type AttemptBudgetRow = {
  id: string;
  colonyId: string;
  maxAttempts: number | null;
  maxScoutingLossPips: number | null;
  cooldownRuleJson: string | null;
  resetRuleJson: string;
  currentPeriodKey: string;
  updatedAt: string;
};
export function hydrateAttemptBudget(row: AttemptBudgetRow): AttemptBudget {
  const value: AttemptBudget = {
    id: opaqueId<AttemptBudgetId>(row.id),
    colonyId: opaqueId<ColonyId>(row.colonyId),
    maxAttempts: row.maxAttempts,
    maxScoutingLossPips: row.maxScoutingLossPips,
    cooldownRule: row.cooldownRuleJson === null ? null : decodeJson<RuleValue>(row.cooldownRuleJson),
    resetRule: decodeJson<Exclude<RuleValue, null>>(row.resetRuleJson),
    currentPeriodKey: row.currentPeriodKey,
    updatedAt: timestamp(row.updatedAt),
  };
  validateAttemptBudget(value);
  return Object.freeze(value);
}

export type { Timestamp };
