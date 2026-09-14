import { createEvidenceEvent, createEvidenceReference, defaultEvidenceFramingProfile, type ChartWorkspaceEvidenceState, type EvidenceEventType, type EvidenceRecordPlan, type EvidenceStatus } from './model';

export interface RuntimeEvidenceIdFactory { evidenceEvent(): string; evidenceReference(): string }
interface RuntimeNodeEventLike { readonly id: string; readonly strategyRuntimeId: string; readonly runtimeNodeId: string; readonly fromState: string; readonly toState: string; readonly eventType: string; readonly summary: string; readonly occurredAt: string }
interface DecisionTraceLike { readonly id: string; readonly runtimeNodeId: string | null; readonly eventType: string; readonly occurredAt: string }
interface EvaluationLike { readonly id: string; readonly runtimeNodeId: string; readonly strategyVersionId: string; readonly result: string; readonly candleId: string | null; readonly evaluatedAt: string }
interface GraphNodeLike { readonly id: string; readonly family: string; readonly label: string; readonly timeframe: string | null; readonly strategyVersionId?: string }
interface RuntimeNodeLike { readonly id: string; readonly graphNodeId: string; readonly state: string }
interface MarketContextLike {
  readonly instrumentId: string;
  readonly timeframe: string | null;
  readonly candles: readonly { readonly id: string; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly openedAt: string; readonly closedAt: string | null }[];
  readonly marketObjects: readonly { readonly id: string; readonly versionId: string | null }[];
  readonly economicEvents: readonly { readonly id: string }[];
  readonly occurredAt: string;
}
export interface RuntimeEvidenceInput {
  readonly runtime: { readonly id: string; readonly colonyId: string; readonly strategyMapVersionId: string };
  readonly nodes: readonly RuntimeNodeLike[];
  readonly graphNodes: readonly GraphNodeLike[];
  readonly nodeEvents: readonly RuntimeNodeEventLike[];
  readonly evaluations: readonly EvaluationLike[];
  readonly traces: readonly DecisionTraceLike[];
  readonly context: MarketContextLike;
  readonly ideaVersionId: string | null;
  readonly ids: RuntimeEvidenceIdFactory;
}

function transitionMeaning(event: RuntimeNodeEventLike): { eventType: EvidenceEventType; status: EvidenceStatus } | null {
  if (event.toState === 'TRIGGERED') return { eventType: 'STRATEGY_TRIGGER', status: 'CONFIRMED' };
  if (event.toState === 'CONFIRMED') return { eventType: 'STRATEGY_CONFIRMATION', status: event.eventType === 'MANUAL_CONFIRM' ? 'MANUALLY_CONFIRMED' : 'CONFIRMED' };
  if (event.toState === 'FAILED') return { eventType: 'STRATEGY_FAILURE', status: 'FAILED' };
  if (event.toState === 'EXPIRED') return { eventType: 'STRATEGY_EXPIRY', status: 'EXPIRED' };
  return null;
}

export function buildRuntimeEvidencePlans(input: RuntimeEvidenceInput): readonly EvidenceRecordPlan[] {
  const nodeByRuntimeId = new Map(input.nodes.map((node) => [node.id, node]));
  const graphById = new Map(input.graphNodes.map((node) => [node.id, node]));
  const evaluationByNode = new Map<string, EvaluationLike>();
  for (const evaluation of input.evaluations) evaluationByNode.set(evaluation.runtimeNodeId, evaluation);
  return Object.freeze(input.nodeEvents.flatMap((nodeEvent) => {
    const meaning = transitionMeaning(nodeEvent);
    if (!meaning) return [];
    const runtimeNode = nodeByRuntimeId.get(nodeEvent.runtimeNodeId);
    const graphNode = runtimeNode ? graphById.get(runtimeNode.graphNodeId) : undefined;
    if (!runtimeNode || !graphNode) throw new Error(`Evidence cannot resolve RuntimeNode ${nodeEvent.runtimeNodeId} against its frozen graph`);
    const trace = input.traces.find((item) => item.runtimeNodeId === nodeEvent.runtimeNodeId && item.eventType === nodeEvent.eventType && item.occurredAt === nodeEvent.occurredAt) ?? null;
    const evaluation = evaluationByNode.get(nodeEvent.runtimeNodeId) ?? null;
    const id = input.ids.evidenceEvent();
    const event = createEvidenceEvent({ id, sourceType: 'STRATEGY_RUNTIME', sourceId: nodeEvent.id, eventType: meaning.eventType, status: meaning.status, occurredAt: nodeEvent.occurredAt, summary: nodeEvent.summary, decisionTraceId: trace?.id ?? null, strategyRuntimeId: input.runtime.id, runtimeNodeId: nodeEvent.runtimeNodeId, timeframe: graphNode.timeframe ?? input.context.timeframe, capturePolicy: 'STRATEGY_EVIDENCE_AND_ENTRY' });
    const values: Array<{ entityType: string; entityId: string; entityVersionId: string | null; relationType: string }> = [
      { entityType: 'STRATEGY_RUNTIME', entityId: input.runtime.id, entityVersionId: null, relationType: 'RUNTIME' },
      { entityType: 'RUNTIME_NODE_EVENT', entityId: nodeEvent.id, entityVersionId: null, relationType: 'SOURCE_EVENT' },
      { entityType: 'RUNTIME_NODE', entityId: nodeEvent.runtimeNodeId, entityVersionId: null, relationType: 'ACTIVE_NODE' },
      { entityType: 'COLONY', entityId: input.runtime.colonyId, entityVersionId: null, relationType: 'COLONY_CONTEXT' },
      { entityType: 'STRATEGY_MAP', entityId: input.runtime.strategyMapVersionId, entityVersionId: input.runtime.strategyMapVersionId, relationType: 'EXACT_STRATEGY_MAP_VERSION' },
    ];
    if (input.ideaVersionId) values.push({ entityType: 'IDEA', entityId: input.ideaVersionId, entityVersionId: input.ideaVersionId, relationType: 'EXACT_IDEA_VERSION' });
    if (trace) values.push({ entityType: 'DECISION_TRACE', entityId: trace.id, entityVersionId: null, relationType: 'DECISION_TRACE' });
    if (graphNode.family === 'STRATEGY' && graphNode.strategyVersionId) values.push({ entityType: 'STRATEGY', entityId: graphNode.strategyVersionId, entityVersionId: graphNode.strategyVersionId, relationType: 'EXACT_STRATEGY_VERSION' });
    if (evaluation) {
      values.push({ entityType: 'DETECTOR_EVALUATION', entityId: evaluation.id, entityVersionId: null, relationType: 'DETECTOR_EVALUATION' });
      if (evaluation.candleId) values.push({ entityType: 'CANDLE', entityId: evaluation.candleId, entityVersionId: null, relationType: 'SOURCE_CANDLE' });
    }
    for (const candle of input.context.candles) if (!values.some((ref) => ref.entityType === 'CANDLE' && ref.entityId === candle.id)) values.push({ entityType: 'CANDLE', entityId: candle.id, entityVersionId: null, relationType: 'VISIBLE_CANDLE' });
    for (const object of input.context.marketObjects) values.push({ entityType: 'MARKET_OBJECT', entityId: object.id, entityVersionId: object.versionId, relationType: object.versionId ? 'EXACT_MARKET_OBJECT_VERSION' : 'UNVERSIONED_MARKET_OBJECT_CONTEXT' });
    for (const economicEvent of input.context.economicEvents) values.push({ entityType: 'ECONOMIC_EVENT_REVISION', entityId: economicEvent.id, entityVersionId: economicEvent.id, relationType: 'EXACT_ECONOMIC_EVENT_REVISION' });
    const references = Object.freeze(values.map((reference) => createEvidenceReference({ id: input.ids.evidenceReference(), evidenceEventId: id, ...reference, createdAt: nodeEvent.occurredAt })));
    const workspaceState: ChartWorkspaceEvidenceState = Object.freeze({
      schemaVersion: 1, instrumentId: input.context.instrumentId, timeframe: graphNode.timeframe ?? input.context.timeframe,
      visibleInterval: input.context.candles.length ? { from: input.context.candles[0]!.openedAt, to: input.context.candles.at(-1)!.closedAt ?? input.context.occurredAt } : null,
      candles: Object.freeze(input.context.candles.map((candle) => Object.freeze({ ...candle }))),
      marketObjectVersionIds: Object.freeze(input.context.marketObjects.flatMap((object) => object.versionId ? [object.versionId] : [])), projections: Object.freeze([]),
      activeRuntimeNode: Object.freeze({ runtimeId: input.runtime.id, runtimeNodeId: runtimeNode.id, graphNodeId: runtimeNode.graphNodeId, state: nodeEvent.toState }),
      colonyId: input.runtime.colonyId, ideaVersionId: input.ideaVersionId, strategyMapVersionId: input.runtime.strategyMapVersionId,
      annotations: Object.freeze([{ key: meaning.eventType, label: graphNode.label, entityId: nodeEvent.runtimeNodeId }]),
      eventContext: Object.freeze({ sourceRuntimeNodeEventId: nodeEvent.id, detectorEvaluationId: evaluation?.id ?? null, decisionTraceId: trace?.id ?? null }),
    });
    return [{ event, references, workspaceState, framingProfile: defaultEvidenceFramingProfile }];
  }));
}
