import type { LogicGraph, StrategyGraphNode, StrategyMapVersion, StrategyVersion } from './model';
import { validateLogicGraph } from './model';
import type { DetectorResult, DetectorResultStatus, MarketContext } from './detectors';
import { DetectorRegistry } from './detectors';

export type StrategyRuntimeId = string & { readonly __brand: 'StrategyRuntimeId' };
export type RuntimeNodeId = string & { readonly __brand: 'RuntimeNodeId' };
export type RuntimeNodeEventId = string & { readonly __brand: 'RuntimeNodeEventId' };
export type DetectorEvaluationId = string & { readonly __brand: 'DetectorEvaluationId' };
export type DecisionTraceId = string & { readonly __brand: 'DecisionTraceId' };
export type RuntimeEventId = string & { readonly __brand: 'RuntimeEventId' };

export type RuntimeMode = 'OBSERVE' | 'SHADOW' | 'DEMO' | 'LIVE';
export type RuntimeStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
export type RuntimeNodeState = 'DORMANT' | 'ARMED' | 'WATCHING' | 'TRIGGERED' | 'CONFIRMED' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'BYPASSED';
export type RuntimeMarketEventType = 'TICK' | 'PRICE_UPDATE' | 'BAR_UPDATE' | 'BAR_CLOSE' | 'EVENT' | 'MANUAL';
export type RuntimeActionKind = 'NOTIFY' | 'ARM_STRATEGY' | 'CREATE_SCOUT' | 'CANCEL_PENDING' | 'MOVE_STOP' | 'PARTIAL_CLOSE' | 'PROMOTE_LEG' | 'CONVERT_RUNNER' | 'TAKE_SNAPSHOT' | 'CREATE_LESSON_MARKER' | 'CUSTOM';

export interface StrategyRuntime {
  readonly id: StrategyRuntimeId;
  readonly colonyId: string;
  readonly strategyMapVersionId: string;
  readonly mode: RuntimeMode;
  readonly status: RuntimeStatus;
  readonly startedAt: string;
  readonly stoppedAt: string | null;
}
export interface RuntimeNode {
  readonly id: RuntimeNodeId;
  readonly strategyRuntimeId: StrategyRuntimeId;
  readonly graphNodeId: string;
  readonly state: RuntimeNodeState;
  readonly armedAt: string | null;
  readonly triggeredAt: string | null;
  readonly confirmedAt: string | null;
  readonly lastEvaluatedCandleId: string | null;
  readonly triggerCount: number;
  readonly runtimeMemory: Readonly<Record<string, unknown>>;
}
export interface RuntimeNodeEvent {
  readonly id: RuntimeNodeEventId;
  readonly strategyRuntimeId: StrategyRuntimeId;
  readonly runtimeNodeId: RuntimeNodeId;
  readonly fromState: RuntimeNodeState;
  readonly toState: RuntimeNodeState;
  readonly eventType: string;
  readonly sourceEventId: string | null;
  readonly summary: string;
  readonly occurredAt: string;
}
export interface DetectorEvaluation {
  readonly id: DetectorEvaluationId;
  readonly runtimeNodeId: RuntimeNodeId;
  readonly strategyVersionId: string;
  readonly detectorKey: string;
  readonly detectorVersion: string;
  readonly result: DetectorResultStatus;
  readonly evaluatedAt: string;
  readonly candleId: string | null;
  readonly diagnostics: Readonly<Record<string, unknown>>;
}
export interface DecisionTrace {
  readonly id: DecisionTraceId;
  readonly strategyRuntimeId: StrategyRuntimeId;
  readonly eventType: string;
  readonly runtimeNodeId: RuntimeNodeId | null;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}
export interface RuntimeMarketEvent {
  readonly id: RuntimeEventId;
  readonly type: RuntimeMarketEventType;
  readonly instrumentId: string;
  readonly timeframe: string | null;
  readonly occurredAt: string;
  readonly context: MarketContext;
}
export interface RuntimeActionProposal {
  readonly actionKind: RuntimeActionKind;
  readonly runtimeNodeId: RuntimeNodeId;
  readonly graphNodeId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
}
export interface RuntimeSnapshot {
  readonly runtime: StrategyRuntime;
  readonly nodes: readonly RuntimeNode[];
}
export interface RuntimeProcessResult {
  readonly snapshot: RuntimeSnapshot;
  readonly nodeEvents: readonly RuntimeNodeEvent[];
  readonly evaluations: readonly DetectorEvaluation[];
  readonly traces: readonly DecisionTrace[];
  readonly actionProposals: readonly RuntimeActionProposal[];
  readonly duplicate: boolean;
}

export interface RuntimeIdFactory {
  runtimeNode(graphNodeId: string): RuntimeNodeId;
  runtimeNodeEvent(): RuntimeNodeEventId;
  detectorEvaluation(): DetectorEvaluationId;
  decisionTrace(): DecisionTraceId;
}

function id<T extends string>(value: string, field: string): T {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) throw new Error(`${field} must be an opaque token`);
  return value as T;
}
const iso = (value: string) => {
  if (!Number.isFinite(Date.parse(value))) throw new Error('timestamp must be valid');
  return new Date(value).toISOString();
};
export const strategyRuntimeId = (value: string) => id<StrategyRuntimeId>(value, 'strategyRuntimeId');
export const runtimeNodeId = (value: string) => id<RuntimeNodeId>(value, 'runtimeNodeId');
export const runtimeNodeEventId = (value: string) => id<RuntimeNodeEventId>(value, 'runtimeNodeEventId');
export const detectorEvaluationId = (value: string) => id<DetectorEvaluationId>(value, 'detectorEvaluationId');
export const decisionTraceId = (value: string) => id<DecisionTraceId>(value, 'decisionTraceId');
export const runtimeEventId = (value: string) => id<RuntimeEventId>(value, 'runtimeEventId');

const TERMINAL = new Set<RuntimeNodeState>(['COMPLETED','FAILED','EXPIRED','CANCELLED','BYPASSED']);
const TRANSITIONS: Readonly<Record<RuntimeNodeState, readonly RuntimeNodeState[]>> = Object.freeze({
  DORMANT: ['ARMED','CANCELLED','BYPASSED'],
  ARMED: ['WATCHING','CANCELLED','BYPASSED','EXPIRED'],
  WATCHING: ['TRIGGERED','CONFIRMED','FAILED','EXPIRED','CANCELLED','BYPASSED'],
  TRIGGERED: ['CONFIRMED','FAILED','EXPIRED','CANCELLED','BYPASSED'],
  CONFIRMED: ['COMPLETED','CANCELLED'],
  COMPLETED: [], FAILED: [], EXPIRED: [], CANCELLED: [], BYPASSED: [],
});
export function runtimeNodeTransitionAllowed(from: RuntimeNodeState, to: RuntimeNodeState): boolean { return TRANSITIONS[from].includes(to); }

function replaceNode(nodes: readonly RuntimeNode[], updated: RuntimeNode): readonly RuntimeNode[] {
  return Object.freeze(nodes.map((node) => node.id === updated.id ? updated : node));
}

const RUNTIME_CONTROL_MEMORY_KEYS = Object.freeze([
  'manualConfirmationPending',
  'lastManualDecision',
  'lastManualDecisionAt',
] as const);

function mergeDetectorMemory(
  previous: Readonly<Record<string, unknown>>,
  detectorMemory: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = { ...detectorMemory };
  for (const key of RUNTIME_CONTROL_MEMORY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(previous, key)) merged[key] = previous[key];
  }
  return Object.freeze(merged);
}
function incoming(graph: LogicGraph, graphNodeId: string): readonly string[] { return graph.edges.filter((edge) => edge.targetNodeId === graphNodeId).map((edge) => edge.sourceNodeId); }
function outgoing(graph: LogicGraph, graphNodeId: string): readonly string[] { return graph.edges.filter((edge) => edge.sourceNodeId === graphNodeId).map((edge) => edge.targetNodeId); }
function runtimeNodeForGraph(nodes: readonly RuntimeNode[], graphNodeId: string): RuntimeNode { const value = nodes.find((node) => node.graphNodeId === graphNodeId); if (!value) throw new Error(`RuntimeNode for ${graphNodeId} missing`); return value; }
function graphNode(graph: LogicGraph, graphNodeId: string): StrategyGraphNode { const value = graph.nodes.find((node) => node.id === graphNodeId); if (!value) throw new Error(`GraphNode ${graphNodeId} missing`); return value; }
function isSatisfied(state: RuntimeNodeState): boolean { return state === 'CONFIRMED' || state === 'COMPLETED' || state === 'BYPASSED'; }
function isFailure(state: RuntimeNodeState): boolean { return state === 'FAILED' || state === 'EXPIRED' || state === 'CANCELLED'; }

function transition(node: RuntimeNode, to: RuntimeNodeState, now: string): RuntimeNode {
  if (node.state === to) return node;
  if (!runtimeNodeTransitionAllowed(node.state, to)) throw new Error(`Invalid RuntimeNode transition ${node.state} -> ${to}`);
  return Object.freeze({ ...node, state: to,
    armedAt: to === 'ARMED' && node.armedAt === null ? now : node.armedAt,
    triggeredAt: to === 'TRIGGERED' && node.triggeredAt === null ? now : node.triggeredAt,
    confirmedAt: to === 'CONFIRMED' && node.confirmedAt === null ? now : node.confirmedAt,
  });
}

export function createRuntime(input: { readonly runtimeId: StrategyRuntimeId; readonly colonyId: string; readonly mapVersion: StrategyMapVersion; readonly mode: RuntimeMode; readonly startedAt: string; readonly ids: RuntimeIdFactory }): RuntimeSnapshot {
  const graph = validateLogicGraph(input.mapVersion.graph);
  const startedAt = iso(input.startedAt);
  const runtime: StrategyRuntime = Object.freeze({ id: strategyRuntimeId(input.runtimeId), colonyId: input.colonyId, strategyMapVersionId: input.mapVersion.id, mode: input.mode, status: 'RUNNING', startedAt, stoppedAt: null });
  const roots = new Set(graph.nodes.filter((node) => incoming(graph, node.id).length === 0).map((node) => node.id));
  const nodes = graph.nodes.map((node) => {
    let state: RuntimeNodeState = roots.has(node.id) ? 'ARMED' : 'DORMANT';
    const armedAt: string | null = roots.has(node.id) ? startedAt : null;
    if (state === 'ARMED') state = 'WATCHING';
    return Object.freeze({ id: input.ids.runtimeNode(node.id), strategyRuntimeId: runtime.id, graphNodeId: node.id, state, armedAt, triggeredAt: null, confirmedAt: null, lastEvaluatedCandleId: null, triggerCount: 0, runtimeMemory: Object.freeze({}) });
  });
  return Object.freeze({ runtime, nodes: Object.freeze(nodes) });
}

export function eventMatchesNode(event: RuntimeMarketEvent, node: StrategyGraphNode, detectorMode: string | null): boolean {
  const mode = detectorMode ?? (node.family === 'MARKET_OBJECT' ? 'ON_PRICE_UPDATE' : node.family === 'STATE' || node.family === 'LOGIC' || node.family === 'ACTION' ? 'ON_EVENT' : node.family === 'MODIFIER' ? 'ON_EVENT' : 'MANUAL');
  const isMarketDataMode = mode === 'ON_TICK' || mode === 'ON_PRICE_UPDATE' || mode === 'ON_BAR_UPDATE' || mode === 'ON_BAR_CLOSE';
  // Market-data detectors are routed by instrument + timeframe. A transport event
  // without canonical timeframe identity must not evaluate them, even when the
  // graph node itself is intentionally timeframe-agnostic. ON_EVENT/MANUAL may
  // legitimately be timeframe-less.
  if (isMarketDataMode && event.timeframe === null) return false;
  if (node.timeframe !== null && node.timeframe !== event.timeframe) return false;
  return (mode === 'ON_TICK' && event.type === 'TICK') || (mode === 'ON_PRICE_UPDATE' && (event.type === 'PRICE_UPDATE' || event.type === 'TICK')) || (mode === 'ON_BAR_UPDATE' && event.type === 'BAR_UPDATE') || (mode === 'ON_BAR_CLOSE' && event.type === 'BAR_CLOSE') || (mode === 'ON_EVENT' && event.type === 'EVENT') || (mode === 'MANUAL' && event.type === 'MANUAL');
}

function logicSatisfied(node: Extract<StrategyGraphNode,{family:'LOGIC'}>, sources: readonly RuntimeNode[]): 'PASS'|'FAIL'|'WAIT' {
  if (sources.length === 0) return 'PASS';
  if (node.operator === 'AND' || node.operator === 'THEN') {
    if (sources.some((source) => isFailure(source.state))) return 'FAIL';
    return sources.every((source) => isSatisfied(source.state)) ? 'PASS' : 'WAIT';
  }
  if (node.operator === 'OR') {
    if (sources.some((source) => isSatisfied(source.state))) return 'PASS';
    return sources.every((source) => isFailure(source.state)) ? 'FAIL' : 'WAIT';
  }
  const source = sources[0];
  if (!source) return 'PASS';
  if (isFailure(source.state)) return 'PASS';
  if (isSatisfied(source.state)) return 'FAIL';
  return 'WAIT';
}

function stateNodeResult(node: Extract<StrategyGraphNode,{family:'STATE'}>, context: MarketContext): boolean {
  const value = context.states[node.stateKey];
  return value === true || value === 'ACTIVE' || value === 'ARMED' || value === 'IN_PLAY' || value === 'PROTECTED' || value === 'LEG' || value === 'MATURE_LEG' || value === 'RUNNER';
}
function marketObjectNodeResult(node: Extract<StrategyGraphNode,{family:'MARKET_OBJECT'}>, context: MarketContext): DetectorResult {
  const object = context.marketObjects.find((candidate) => node.marketObjectVersionId ? candidate.versionId === node.marketObjectVersionId : candidate.id === node.marketObjectId);
  if (!object) return Object.freeze({ status: 'BLOCKED', diagnostics: Object.freeze({ reason: 'MARKET_OBJECT_UNAVAILABLE' }), memory: Object.freeze({}), candleId: null, sourceObjectIds: Object.freeze([]) });
  const price = context.chartPrice ?? context.bid ?? context.ask;
  if (price === null) return Object.freeze({ status: 'BLOCKED', diagnostics: Object.freeze({ reason: 'PRICE_UNAVAILABLE' }), memory: Object.freeze({}), candleId: null, sourceObjectIds: Object.freeze([object.id]) });
  const hit = object.price !== null ? Math.abs(price - object.price) <= context.pipSize / 10 : object.low !== null && object.high !== null && price >= Math.min(object.low, object.high) && price <= Math.max(object.low, object.high);
  return Object.freeze({ status: hit ? 'CONFIRMED' : 'NOT_MET', diagnostics: Object.freeze({ price, objectId: object.id, condition: node.conditionKey }), memory: Object.freeze({ lastPrice: price }), candleId: null, sourceObjectIds: Object.freeze([object.id]) });
}
function modifierResult(node: Extract<StrategyGraphNode,{family:'MODIFIER'}>, event: RuntimeMarketEvent): DetectorResultStatus {
  if (node.modifierKey === 'require_candle_close') return event.type === 'BAR_CLOSE' ? 'CONFIRMED' : 'NOT_MET';
  if (node.modifierKey === 'allow_intracandle') return ['TICK','PRICE_UPDATE','BAR_UPDATE','BAR_CLOSE'].includes(event.type) ? 'CONFIRMED' : 'NOT_MET';
  if (node.modifierKey === 'max_spread') {
    const max = typeof node.parameters.maxPips === 'number' ? node.parameters.maxPips : null;
    return max !== null && event.context.spreadPips !== null && event.context.spreadPips <= max ? 'CONFIRMED' : 'BLOCKED';
  }
  return 'CONFIRMED';
}
function actionKind(actionKey: string): RuntimeActionKind {
  const map: Record<string, RuntimeActionKind> = { notify:'NOTIFY', arm_strategy:'ARM_STRATEGY', create_scout:'CREATE_SCOUT', cancel_pending:'CANCEL_PENDING', move_stop:'MOVE_STOP', partial_close:'PARTIAL_CLOSE', promote_leg:'PROMOTE_LEG', convert_runner:'CONVERT_RUNNER', take_snapshot:'TAKE_SNAPSHOT', create_lesson_marker:'CREATE_LESSON_MARKER' };
  return map[actionKey] ?? 'CUSTOM';
}

export function processRuntimeEvent(input: {
  readonly snapshot: RuntimeSnapshot;
  readonly mapVersion: StrategyMapVersion;
  readonly strategies: ReadonlyMap<string, StrategyVersion>;
  readonly detectorRegistry: DetectorRegistry;
  readonly event: RuntimeMarketEvent;
  readonly ids: RuntimeIdFactory;
  readonly alreadyProcessed?: boolean;
}): RuntimeProcessResult {
  if (input.alreadyProcessed) return Object.freeze({ snapshot: input.snapshot, nodeEvents: Object.freeze([]), evaluations: Object.freeze([]), traces: Object.freeze([]), actionProposals: Object.freeze([]), duplicate: true });
  if (input.snapshot.runtime.status !== 'RUNNING') throw new Error('Runtime must be RUNNING to process events');
  const graph = validateLogicGraph(input.mapVersion.graph, input.strategies);
  let nodes = input.snapshot.nodes;
  const nodeEvents: RuntimeNodeEvent[] = [];
  const evaluations: DetectorEvaluation[] = [];
  const traces: DecisionTrace[] = [];
  const proposals: RuntimeActionProposal[] = [];
  const now = iso(input.event.occurredAt);

  const emitTransition = (current: RuntimeNode, to: RuntimeNodeState, eventType: string, summary: string): RuntimeNode => {
    if (current.state === to) return current;
    const next = transition(current, to, now);
    nodeEvents.push(Object.freeze({ id: input.ids.runtimeNodeEvent(), strategyRuntimeId: input.snapshot.runtime.id, runtimeNodeId: current.id, fromState: current.state, toState: to, eventType, sourceEventId: input.event.id, summary, occurredAt: now }));
    traces.push(Object.freeze({ id: input.ids.decisionTrace(), strategyRuntimeId: input.snapshot.runtime.id, eventType, runtimeNodeId: current.id, summary, details: Object.freeze({ sourceEventId: input.event.id, graphNodeId: current.graphNodeId, fromState: current.state, toState: to }), occurredAt: now }));
    nodes = replaceNode(nodes, next);
    return next;
  };
  const armDownstream = (graphNodeId: string) => {
    for (const targetId of outgoing(graph, graphNodeId)) {
      let runtimeNode = runtimeNodeForGraph(nodes, targetId);
      if (runtimeNode.state !== 'DORMANT') continue;
      runtimeNode = emitTransition(runtimeNode, 'ARMED', 'UPSTREAM_SATISFIED', `Armed ${graphNode(graph, targetId).label}`);
      emitTransition(runtimeNode, 'WATCHING', 'SUBSCRIBED', `Watching ${graphNode(graph, targetId).label}`);
    }
  };

  // Logic nodes can become eligible from state already established before this market event.
  const settleLogic = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const definition of graph.nodes) {
        if (definition.family !== 'LOGIC') continue;
        const runtimeNode = runtimeNodeForGraph(nodes, definition.id);
        if (runtimeNode.state !== 'WATCHING') continue;
        const verdict = logicSatisfied(definition, incoming(graph, definition.id).map((id) => runtimeNodeForGraph(nodes, id)));
        if (verdict === 'PASS') { const next = emitTransition(runtimeNode, 'CONFIRMED', 'LOGIC_CONFIRMED', `${definition.operator} satisfied`); armDownstream(definition.id); emitTransition(next, 'COMPLETED', 'NODE_COMPLETED', `${definition.label} completed`); changed = true; }
        else if (verdict === 'FAIL') { emitTransition(runtimeNode, 'FAILED', 'LOGIC_FAILED', `${definition.operator} failed`); changed = true; }
      }
    }
  };
  const settleDeadBranches = () => {
    let changed = true;
    while (changed) {
      changed = false;
      settleLogic();
      for (const definition of graph.nodes) {
        let runtimeNode = runtimeNodeForGraph(nodes, definition.id);
        if (runtimeNode.state !== 'DORMANT') continue;
        const sourceIds = incoming(graph, definition.id);
        if (!sourceIds.length) continue;
        const sources = sourceIds.map((sourceId) => runtimeNodeForGraph(nodes, sourceId));
        const settled = sources.every((source) => isSatisfied(source.state) || isFailure(source.state));
        if (!settled) continue;
        if (definition.family === 'LOGIC') {
          runtimeNode = emitTransition(runtimeNode, 'ARMED', 'UPSTREAM_SETTLED', `Armed ${definition.label} after upstream settled`);
          emitTransition(runtimeNode, 'WATCHING', 'SUBSCRIBED', `Watching ${definition.label}`);
          changed = true;
          continue;
        }
        if (sources.some((source) => isFailure(source.state))) {
          emitTransition(runtimeNode, 'CANCELLED', 'UPSTREAM_FAILED', `${definition.label} cancelled because an upstream requirement failed`);
          changed = true;
          continue;
        }
        runtimeNode = emitTransition(runtimeNode, 'ARMED', 'UPSTREAM_SATISFIED', `Armed ${definition.label}`);
        emitTransition(runtimeNode, 'WATCHING', 'SUBSCRIBED', `Watching ${definition.label}`);
        changed = true;
      }
    }
    settleLogic();
  };
  settleDeadBranches();

  for (const definition of graph.nodes) {
    let runtimeNode = runtimeNodeForGraph(nodes, definition.id);
    if (runtimeNode.state !== 'WATCHING' && runtimeNode.state !== 'TRIGGERED') continue;
    if (definition.family === 'LOGIC') continue;
    let detectorMode: string | null = null;
    if (definition.family === 'STRATEGY') detectorMode = input.strategies.get(definition.strategyVersionId)?.detector?.evaluationMode ?? 'MANUAL';
    if (!eventMatchesNode(input.event, definition, detectorMode)) continue;

    let detectorResult: DetectorResult | null = null;
    let strategyVersion: StrategyVersion | null = null;
    if (definition.family === 'STRATEGY') {
      strategyVersion = input.strategies.get(definition.strategyVersionId) ?? null;
      if (!strategyVersion) throw new Error(`StrategyVersion ${definition.strategyVersionId} missing from runtime snapshot`);
      if (strategyVersion.detector === null) {
        // Manual knowledge is first-class. It never auto-confirms from a synthetic market event;
        // the user must choose CONFIRM / REJECT / SKIP through manualNodeDecision().
        continue;
      } else {
        const detector = input.detectorRegistry.get(strategyVersion.detector.key, strategyVersion.detector.version);
        if (!detector) detectorResult = Object.freeze({ status: 'ERROR', diagnostics: Object.freeze({ reason: 'DETECTOR_NOT_REGISTERED', key: strategyVersion.detector.key, version: strategyVersion.detector.version }), memory: runtimeNode.runtimeMemory, candleId: null, sourceObjectIds: Object.freeze([]) });
        else {
          try { detectorResult = detector.evaluate(input.event.context, definition.parameters ?? {}, runtimeNode.runtimeMemory); }
          catch (error) { detectorResult = Object.freeze({ status: 'ERROR', diagnostics: Object.freeze({ reason: 'DETECTOR_EXCEPTION', message: error instanceof Error ? error.message : String(error) }), memory: runtimeNode.runtimeMemory, candleId: null, sourceObjectIds: Object.freeze([]) }); }
        }
        evaluations.push(Object.freeze({ id: input.ids.detectorEvaluation(), runtimeNodeId: runtimeNode.id, strategyVersionId: strategyVersion.id, detectorKey: strategyVersion.detector.key, detectorVersion: strategyVersion.detector.version, result: detectorResult.status, evaluatedAt: now, candleId: detectorResult.candleId, diagnostics: detectorResult.diagnostics }));
      }
    } else if (definition.family === 'MARKET_OBJECT') detectorResult = marketObjectNodeResult(definition, input.event.context);
    else if (definition.family === 'STATE') detectorResult = Object.freeze({ status: stateNodeResult(definition, input.event.context) ? 'CONFIRMED' : 'NOT_MET', diagnostics: Object.freeze({ stateKey: definition.stateKey, value: input.event.context.states[definition.stateKey] ?? null }), memory: runtimeNode.runtimeMemory, candleId: null, sourceObjectIds: Object.freeze([]) });
    else if (definition.family === 'MODIFIER') detectorResult = Object.freeze({ status: modifierResult(definition, input.event), diagnostics: Object.freeze({ modifierKey: definition.modifierKey }), memory: runtimeNode.runtimeMemory, candleId: null, sourceObjectIds: Object.freeze([]) });
    else if (definition.family === 'ACTION') {
      const kind = actionKind(definition.actionKey);
      const isObserve = input.snapshot.runtime.mode === 'OBSERVE';
      if (!isObserve) proposals.push(Object.freeze({ actionKind: kind, runtimeNodeId: runtimeNode.id, graphNodeId: definition.id, parameters: definition.parameters, correlationId: `${input.snapshot.runtime.id}:${definition.id}:${input.event.id}` }));
      const next = emitTransition(runtimeNode, 'CONFIRMED', isObserve ? 'ACTION_OBSERVED' : 'ACTION_PROPOSED', isObserve ? `${definition.label}: ${kind} observed only` : `${definition.label}: ${kind} proposed`);
      armDownstream(definition.id); emitTransition(next, 'COMPLETED', 'NODE_COMPLETED', `${definition.label} completed`); continue;
    }
    if (!detectorResult) continue;
    runtimeNode = Object.freeze({ ...runtimeNode, runtimeMemory: mergeDetectorMemory(runtimeNode.runtimeMemory, detectorResult.memory), lastEvaluatedCandleId: detectorResult.candleId ?? runtimeNode.lastEvaluatedCandleId });
    nodes = replaceNode(nodes, runtimeNode);
    if (detectorResult.status === 'TRIGGERED' || detectorResult.status === 'PARTIAL') {
      if (runtimeNode.state === 'WATCHING') { runtimeNode = emitTransition(runtimeNode, 'TRIGGERED', 'DETECTOR_TRIGGERED', `${definition.label} triggered`); nodes = replaceNode(nodes, Object.freeze({ ...runtimeNode, triggerCount: runtimeNode.triggerCount + 1 })); }
    } else if (detectorResult.status === 'CONFIRMED') {
      const requiresManualConfirmation = definition.family === 'STRATEGY' && definition.executionMode === 'CONFIRM';
      if (requiresManualConfirmation) {
        const alreadyPending = runtimeNode.runtimeMemory.manualConfirmationPending === true;
        if (!alreadyPending) {
          if (runtimeNode.state === 'WATCHING') runtimeNode = emitTransition(runtimeNode, 'TRIGGERED', 'DETECTOR_TRIGGERED', `${definition.label} detected; manual confirmation required`);
          traces.push(Object.freeze({
            id: input.ids.decisionTrace(), strategyRuntimeId: input.snapshot.runtime.id, eventType: 'MANUAL_CONFIRMATION_REQUIRED', runtimeNodeId: runtimeNode.id,
            summary: `${definition.label} is waiting for CONFIRM / REJECT / SKIP`,
            details: Object.freeze({ graphNodeId: definition.id, strategyVersionId: strategyVersion?.id ?? null, detectorResult: detectorResult.status, executionMode: definition.executionMode }),
            occurredAt: now,
          }));
          nodes = replaceNode(nodes, Object.freeze({ ...runtimeNode, triggerCount: runtimeNode.triggerCount + 1, runtimeMemory: Object.freeze({ ...runtimeNode.runtimeMemory, manualConfirmationPending: true }) }));
        }
      } else {
        if (runtimeNode.state === 'WATCHING') { runtimeNode = emitTransition(runtimeNode, 'CONFIRMED', 'DETECTOR_CONFIRMED', `${definition.label} confirmed`); }
        else if (runtimeNode.state === 'TRIGGERED') runtimeNode = emitTransition(runtimeNode, 'CONFIRMED', 'DETECTOR_CONFIRMED', `${definition.label} confirmed`);
        nodes = replaceNode(nodes, Object.freeze({ ...runtimeNode, triggerCount: runtimeNode.triggerCount + 1 }));
        armDownstream(definition.id);
      }
    } else if (detectorResult.status === 'FAILED') emitTransition(runtimeNode, 'FAILED', 'DETECTOR_FAILED', `${definition.label} failed`);
    else if (detectorResult.status === 'EXPIRED') emitTransition(runtimeNode, 'EXPIRED', 'DETECTOR_EXPIRED', `${definition.label} expired`);
    else if (detectorResult.status === 'ERROR') traces.push(Object.freeze({ id: input.ids.decisionTrace(), strategyRuntimeId: input.snapshot.runtime.id, eventType: 'DETECTOR_ERROR', runtimeNodeId: runtimeNode.id, summary: `${definition.label} detector error`, details: detectorResult.diagnostics, occurredAt: now }));
  }
  settleDeadBranches();
  const allTerminal = nodes.every((node) => TERMINAL.has(node.state) || node.state === 'CONFIRMED');
  const runtime = allTerminal ? Object.freeze({ ...input.snapshot.runtime, status: 'COMPLETED' as const, stoppedAt: now }) : input.snapshot.runtime;
  return Object.freeze({ snapshot: Object.freeze({ runtime, nodes: Object.freeze([...nodes]) }), nodeEvents: Object.freeze(nodeEvents), evaluations: Object.freeze(evaluations), traces: Object.freeze(traces), actionProposals: Object.freeze(proposals), duplicate: false });
}

export function manualNodeDecision(input: {
  readonly snapshot: RuntimeSnapshot;
  readonly mapVersion: StrategyMapVersion;
  readonly strategies: ReadonlyMap<string, StrategyVersion>;
  readonly graphNodeId: string;
  readonly decision: 'CONFIRM'|'REJECT'|'SKIP';
  readonly occurredAt: string;
  readonly ids: RuntimeIdFactory;
}): RuntimeProcessResult {
  if (input.snapshot.runtime.status !== 'RUNNING') throw new Error('Runtime must be RUNNING for a manual decision');
  const graph = validateLogicGraph(input.mapVersion.graph, input.strategies);
  const definition = graphNode(graph, input.graphNodeId);
  if (definition.family !== 'STRATEGY') throw new Error('Manual decisions are only valid for Strategy nodes');
  const strategyVersion = input.strategies.get(definition.strategyVersionId);
  if (!strategyVersion) throw new Error(`StrategyVersion ${definition.strategyVersionId} missing from runtime snapshot`);
  if (strategyVersion.detector !== null && definition.executionMode !== 'CONFIRM') throw new Error('Strategy node does not require manual confirmation');
  const current = runtimeNodeForGraph(input.snapshot.nodes, input.graphNodeId);
  if (current.state !== 'WATCHING' && current.state !== 'TRIGGERED') throw new Error('Manual decision requires WATCHING or TRIGGERED node');

  const now = iso(input.occurredAt);
  const nodeEvents: RuntimeNodeEvent[] = [];
  const traces: DecisionTrace[] = [];
  let nodes = input.snapshot.nodes;

  const applyTransition = (node: RuntimeNode, to: RuntimeNodeState, eventType: string, summary: string): RuntimeNode => {
    const next = transition(node, to, now);
    nodeEvents.push(Object.freeze({
      id: input.ids.runtimeNodeEvent(), strategyRuntimeId: input.snapshot.runtime.id, runtimeNodeId: node.id,
      fromState: node.state, toState: to, eventType, sourceEventId: null, summary, occurredAt: now,
    }));
    traces.push(Object.freeze({
      id: input.ids.decisionTrace(), strategyRuntimeId: input.snapshot.runtime.id, eventType, runtimeNodeId: node.id,
      summary, details: Object.freeze({ graphNodeId: node.graphNodeId, decision: input.decision, source: 'USER_MANUAL' }), occurredAt: now,
    }));
    nodes = replaceNode(nodes, next);
    return next;
  };

  const to: RuntimeNodeState = input.decision === 'CONFIRM' ? 'CONFIRMED' : input.decision === 'REJECT' ? 'FAILED' : 'BYPASSED';
  const summary = `Manual ${input.decision.toLowerCase()} for ${definition.label}`;
  const decided = applyTransition(current, to, `MANUAL_${input.decision}`, summary);
  nodes = replaceNode(nodes, Object.freeze({ ...decided, runtimeMemory: Object.freeze({ ...decided.runtimeMemory, manualConfirmationPending: false, lastManualDecision: input.decision, lastManualDecisionAt: now }) }));

  if (input.decision === 'CONFIRM' || input.decision === 'SKIP') {
    for (const targetId of outgoing(graph, definition.id)) {
      let target = runtimeNodeForGraph(nodes, targetId);
      if (target.state !== 'DORMANT') continue;
      target = applyTransition(target, 'ARMED', 'UPSTREAM_SATISFIED', `Armed ${graphNode(graph, targetId).label}`);
      applyTransition(target, 'WATCHING', 'SUBSCRIBED', `Watching ${graphNode(graph, targetId).label}`);
    }
  }

  // Settle branches that have become impossible because of an explicit manual rejection.
  // This keeps a rejected linear cascade from remaining RUNNING with unreachable DORMANT children.
  let settledChanged = true;
  while (settledChanged) {
    settledChanged = false;
    for (const candidateDefinition of graph.nodes) {
      let candidate = runtimeNodeForGraph(nodes, candidateDefinition.id);
      if (candidate.state !== 'DORMANT') continue;
      const sourceIds = incoming(graph, candidateDefinition.id);
      if (!sourceIds.length) continue;
      const sources = sourceIds.map((sourceId) => runtimeNodeForGraph(nodes, sourceId));
      if (!sources.every((source) => isSatisfied(source.state) || isFailure(source.state))) continue;
      if (candidateDefinition.family === 'LOGIC') {
        const verdict = logicSatisfied(candidateDefinition, sources);
        candidate = applyTransition(candidate, 'ARMED', 'UPSTREAM_SETTLED', `Armed ${candidateDefinition.label} after upstream settled`);
        candidate = applyTransition(candidate, 'WATCHING', 'SUBSCRIBED', `Watching ${candidateDefinition.label}`);
        if (verdict === 'PASS') {
          candidate = applyTransition(candidate, 'CONFIRMED', 'LOGIC_CONFIRMED', `${candidateDefinition.operator} satisfied`);
          applyTransition(candidate, 'COMPLETED', 'NODE_COMPLETED', `${candidateDefinition.label} completed`);
        } else if (verdict === 'FAIL') {
          applyTransition(candidate, 'FAILED', 'LOGIC_FAILED', `${candidateDefinition.operator} failed`);
        }
        settledChanged = true;
        continue;
      }
      if (sources.some((source) => isFailure(source.state))) {
        applyTransition(candidate, 'CANCELLED', 'UPSTREAM_FAILED', `${candidateDefinition.label} cancelled because an upstream requirement failed`);
        settledChanged = true;
      } else if (sources.every((source) => isSatisfied(source.state))) {
        candidate = applyTransition(candidate, 'ARMED', 'UPSTREAM_SATISFIED', `Armed ${candidateDefinition.label}`);
        applyTransition(candidate, 'WATCHING', 'SUBSCRIBED', `Watching ${candidateDefinition.label}`);
        settledChanged = true;
      }
    }
  }

  const allTerminal = nodes.every((node) => TERMINAL.has(node.state) || node.state === 'CONFIRMED');
  const runtime = allTerminal ? Object.freeze({ ...input.snapshot.runtime, status: 'COMPLETED' as const, stoppedAt: now }) : input.snapshot.runtime;
  return Object.freeze({
    snapshot: Object.freeze({ runtime, nodes: Object.freeze([...nodes]) }),
    nodeEvents: Object.freeze(nodeEvents), evaluations: Object.freeze([]), traces: Object.freeze(traces),
    actionProposals: Object.freeze([]), duplicate: false,
  });
}
