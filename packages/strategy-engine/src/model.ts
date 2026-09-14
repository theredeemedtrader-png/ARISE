export type StrategyDefinitionId = string & { readonly __brand: 'StrategyDefinitionId' };
export type StrategyVersionId = string & { readonly __brand: 'StrategyVersionId' };
export type StrategyMapId = string & { readonly __brand: 'StrategyMapId' };
export type StrategyMapVersionId = string & { readonly __brand: 'StrategyMapVersionId' };
export type StrategyGraphNodeId = string & { readonly __brand: 'StrategyGraphNodeId' };
export type StrategyGraphEdgeId = string & { readonly __brand: 'StrategyGraphEdgeId' };

export type AutomationCapability = 'MANUAL' | 'DETECTABLE' | 'AUTOMATABLE';
export type ExecutionMode = 'OBSERVE' | 'NOTIFY' | 'CONFIRM' | 'AUTO';
export type EvaluationMode = 'ON_TICK' | 'ON_PRICE_UPDATE' | 'ON_BAR_UPDATE' | 'ON_BAR_CLOSE' | 'ON_EVENT' | 'MANUAL';
export type TimeframePurpose = 'HINDSIGHT' | 'AREA' | 'ENTRY';
export type StageImportance = 'REQUIRED' | 'OPTIONAL' | 'INFORMATIONAL';
export type StrategyMapKind = 'COMBO' | 'STRATEGY_MAP' | 'TEMPLATE';
export type StrategyNodeFamily = 'STRATEGY' | 'LOGIC' | 'MODIFIER' | 'MARKET_OBJECT' | 'STATE' | 'ACTION';
export type LogicOperator = 'AND' | 'OR' | 'THEN' | 'NOT';
export type DeploymentStatus = 'EXPERIMENTAL' | 'VALIDATED' | 'DEMO_APPROVED' | 'LIVE_APPROVED' | 'RETIRED';

export interface DetectorContractRef {
  readonly key: string;
  readonly version: string;
  readonly evaluationMode: EvaluationMode;
  readonly parameterSchema: Readonly<Record<string, unknown>>;
}

export interface StrategyDefinition {
  readonly id: StrategyDefinitionId;
  readonly currentVersionId: StrategyVersionId;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface StrategyVersion {
  readonly id: StrategyVersionId;
  readonly strategyDefinitionId: StrategyDefinitionId;
  readonly versionNo: number;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly automationCapability: AutomationCapability;
  readonly detector: DetectorContractRef | null;
  readonly deploymentStatus: DeploymentStatus;
  readonly createdAt: string;
  readonly supersedesStrategyVersionId: StrategyVersionId | null;
}

export interface GraphPosition { readonly x: number; readonly y: number }

interface StrategyNodeBase {
  readonly id: StrategyGraphNodeId;
  readonly family: StrategyNodeFamily;
  readonly label: string;
  readonly position: GraphPosition;
  readonly timeframe: string | null;
  readonly purposes: readonly TimeframePurpose[];
  readonly importance: StageImportance;
  readonly executionMode: ExecutionMode;
}

export interface StrategyReferenceNode extends StrategyNodeBase {
  readonly family: 'STRATEGY';
  readonly strategyVersionId: StrategyVersionId;
  readonly parameters: Readonly<Record<string, unknown>>;
}
export interface LogicNode extends StrategyNodeBase {
  readonly family: 'LOGIC';
  readonly operator: LogicOperator;
}
export interface ModifierNode extends StrategyNodeBase {
  readonly family: 'MODIFIER';
  readonly modifierKey: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}
export interface MarketObjectNode extends StrategyNodeBase {
  readonly family: 'MARKET_OBJECT';
  readonly marketObjectId: string | null;
  readonly marketObjectVersionId: string | null;
  readonly conditionKey: string;
}
export interface StateNode extends StrategyNodeBase {
  readonly family: 'STATE';
  readonly stateKey: string;
}
export interface ActionNode extends StrategyNodeBase {
  readonly family: 'ACTION';
  readonly actionKey: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}
export type StrategyGraphNode = StrategyReferenceNode | LogicNode | ModifierNode | MarketObjectNode | StateNode | ActionNode;

export interface StrategyGraphEdge {
  readonly id: StrategyGraphEdgeId;
  readonly sourceNodeId: StrategyGraphNodeId;
  readonly targetNodeId: StrategyGraphNodeId;
  readonly sourcePort: string;
  readonly targetPort: string;
}

export interface LogicGraph {
  readonly nodes: readonly StrategyGraphNode[];
  readonly edges: readonly StrategyGraphEdge[];
}

export interface StrategyMap {
  readonly id: StrategyMapId;
  readonly kind: StrategyMapKind;
  readonly name: string;
  readonly currentVersionId: StrategyMapVersionId;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface StrategyMapVersion {
  readonly id: StrategyMapVersionId;
  readonly strategyMapId: StrategyMapId;
  readonly versionNo: number;
  readonly graph: LogicGraph;
  readonly createdAt: string;
  readonly supersedesStrategyMapVersionId: StrategyMapVersionId | null;
}

function id<T extends string>(value: string, field: string): T {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) throw new Error(`${field} must be an opaque token`);
  return value as T;
}
function text(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  return trimmed;
}
function iso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
  return new Date(value).toISOString();
}
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function unique<T>(values: readonly T[]): readonly T[] { return Object.freeze([...new Set(values)]); }

export const strategyDefinitionId = (value: string) => id<StrategyDefinitionId>(value, 'strategyDefinitionId');
export const strategyVersionId = (value: string) => id<StrategyVersionId>(value, 'strategyVersionId');
export const strategyMapId = (value: string) => id<StrategyMapId>(value, 'strategyMapId');
export const strategyMapVersionId = (value: string) => id<StrategyMapVersionId>(value, 'strategyMapVersionId');
export const strategyGraphNodeId = (value: string) => id<StrategyGraphNodeId>(value, 'strategyGraphNodeId');
export const strategyGraphEdgeId = (value: string) => id<StrategyGraphEdgeId>(value, 'strategyGraphEdgeId');

export function executionModeSupported(capability: AutomationCapability, mode: ExecutionMode): boolean {
  return mode !== 'AUTO' || capability === 'AUTOMATABLE';
}

export function createStrategyDefinitionWithInitialVersion(input: {
  readonly definitionId: StrategyDefinitionId;
  readonly versionId: StrategyVersionId;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly tags?: readonly string[];
  readonly automationCapability: AutomationCapability;
  readonly detector?: DetectorContractRef | null;
  readonly deploymentStatus?: DeploymentStatus;
  readonly createdAt: string;
}): { readonly definition: StrategyDefinition; readonly version: StrategyVersion } {
  const createdAt = iso(input.createdAt, 'createdAt');
  const version = createStrategyVersion({
    id: input.versionId, strategyDefinitionId: input.definitionId, versionNo: 1,
    name: input.name, category: input.category, description: input.description,
    tags: input.tags ?? [], automationCapability: input.automationCapability,
    detector: input.detector ?? null, deploymentStatus: input.deploymentStatus ?? 'EXPERIMENTAL', createdAt, supersedesStrategyVersionId: null,
  });
  return Object.freeze({
    definition: Object.freeze({ id: strategyDefinitionId(input.definitionId), currentVersionId: version.id, createdAt, archivedAt: null }),
    version,
  });
}

export function createStrategyVersion(input: Omit<StrategyVersion, 'deploymentStatus'> & { readonly deploymentStatus?: DeploymentStatus }): StrategyVersion {
  if (!Number.isSafeInteger(input.versionNo) || input.versionNo < 1) throw new Error('versionNo must be positive');
  const name = text(input.name, 'name');
  const category = text(input.category, 'category');
  const createdAt = iso(input.createdAt, 'createdAt');
  if ((input.versionNo === 1) !== (input.supersedesStrategyVersionId === null)) throw new Error('Only v1 may omit supersedesStrategyVersionId');
  const detector = input.detector === null ? null : Object.freeze({
    key: text(input.detector.key, 'detector.key'),
    version: text(input.detector.version, 'detector.version'),
    evaluationMode: input.detector.evaluationMode,
    parameterSchema: Object.freeze(cloneJson(input.detector.parameterSchema)),
  });
  if (input.automationCapability === 'AUTOMATABLE' && detector === null) throw new Error('AUTOMATABLE strategies require a detector contract');
  return Object.freeze({
    id: strategyVersionId(input.id), strategyDefinitionId: strategyDefinitionId(input.strategyDefinitionId), versionNo: input.versionNo,
    name, category, description: input.description.trim(), tags: unique(input.tags.map((tag) => text(tag, 'tag'))),
    automationCapability: input.automationCapability, detector, deploymentStatus: input.deploymentStatus ?? 'EXPERIMENTAL', createdAt,
    supersedesStrategyVersionId: input.supersedesStrategyVersionId === null ? null : strategyVersionId(input.supersedesStrategyVersionId),
  });
}

export function reviseStrategyDefinition(definition: StrategyDefinition, previous: StrategyVersion, input: {
  readonly id: StrategyVersionId;
  readonly name?: string;
  readonly category?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly automationCapability?: AutomationCapability;
  readonly detector?: DetectorContractRef | null;
  readonly deploymentStatus?: DeploymentStatus;
  readonly createdAt: string;
}): { readonly definition: StrategyDefinition; readonly version: StrategyVersion } {
  if (definition.currentVersionId !== previous.id || previous.strategyDefinitionId !== definition.id) throw new Error('Revision requires current history head');
  const next = createStrategyVersion({ ...previous, ...input, id: input.id, strategyDefinitionId: definition.id, versionNo: previous.versionNo + 1, createdAt: input.createdAt, supersedesStrategyVersionId: previous.id });
  return Object.freeze({ definition: Object.freeze({ ...definition, currentVersionId: next.id }), version: next });
}

function cloneNode(node: StrategyGraphNode): StrategyGraphNode {
  const base = { ...node, position: Object.freeze({ ...node.position }), purposes: unique(node.purposes) };
  if (node.family === 'STRATEGY') return Object.freeze({ ...base, parameters: Object.freeze(cloneJson(node.parameters ?? {})) }) as StrategyGraphNode;
  if (node.family === 'MODIFIER' || node.family === 'ACTION') return Object.freeze({ ...base, parameters: Object.freeze(cloneJson(node.parameters)) }) as StrategyGraphNode;
  return Object.freeze(base) as StrategyGraphNode;
}

export function validateLogicGraph(input: LogicGraph, strategies: ReadonlyMap<string, StrategyVersion> = new Map()): LogicGraph {
  const nodeIds = new Set<string>();
  const nodes = input.nodes.map((raw) => {
    const node = cloneNode(raw);
    strategyGraphNodeId(node.id);
    text(node.label, 'node.label');
    if (nodeIds.has(node.id)) throw new Error(`Duplicate graph node ${node.id}`);
    nodeIds.add(node.id);
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) throw new Error('Node position must be finite');
    if (node.purposes.some((purpose) => !['HINDSIGHT','AREA','ENTRY'].includes(purpose))) throw new Error('Invalid timeframe purpose');
    if (node.family === 'STRATEGY') {
      const version = strategies.get(node.strategyVersionId);
      if (version && !executionModeSupported(version.automationCapability, node.executionMode)) throw new Error(`${version.automationCapability} strategy cannot run in ${node.executionMode}`);
    }
    if (node.family === 'LOGIC' && !['AND','OR','THEN','NOT'].includes(node.operator)) throw new Error('Invalid logic operator');
    return node;
  });
  const edgeIds = new Set<string>();
  const pairIds = new Set<string>();
  const edges = input.edges.map((raw) => {
    strategyGraphEdgeId(raw.id);
    if (edgeIds.has(raw.id)) throw new Error(`Duplicate graph edge ${raw.id}`);
    edgeIds.add(raw.id);
    if (!nodeIds.has(raw.sourceNodeId) || !nodeIds.has(raw.targetNodeId)) throw new Error('Graph edge endpoint is missing');
    if (raw.sourceNodeId === raw.targetNodeId) throw new Error('Graph edges cannot self-reference');
    const pair = `${raw.sourceNodeId}->${raw.targetNodeId}:${raw.sourcePort}:${raw.targetPort}`;
    if (pairIds.has(pair)) throw new Error('Duplicate graph connection');
    pairIds.add(pair);
    return Object.freeze({ ...raw, id: strategyGraphEdgeId(raw.id), sourceNodeId: strategyGraphNodeId(raw.sourceNodeId), targetNodeId: strategyGraphNodeId(raw.targetNodeId), sourcePort: text(raw.sourcePort, 'sourcePort'), targetPort: text(raw.targetPort, 'targetPort') });
  });
  // Strategy maps are declarative DAGs. Repeated participation is expressed by runtime/stacking policies, not graph cycles.
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  const visiting = new Set<string>(); const visited = new Set<string>();
  const walk = (nodeId: string) => {
    if (visiting.has(nodeId)) throw new Error('Strategy graph cycles are not allowed');
    if (visited.has(nodeId)) return;
    visiting.add(nodeId); for (const next of outgoing.get(nodeId) ?? []) walk(next); visiting.delete(nodeId); visited.add(nodeId);
  };
  for (const nodeId of nodeIds) walk(nodeId);
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}

export function createStrategyMapWithInitialVersion(input: {
  readonly mapId: StrategyMapId;
  readonly versionId: StrategyMapVersionId;
  readonly kind: StrategyMapKind;
  readonly name: string;
  readonly graph: LogicGraph;
  readonly createdAt: string;
}): { readonly map: StrategyMap; readonly version: StrategyMapVersion } {
  const createdAt = iso(input.createdAt, 'createdAt');
  const graph = validateLogicGraph(input.graph);
  const version: StrategyMapVersion = Object.freeze({ id: strategyMapVersionId(input.versionId), strategyMapId: strategyMapId(input.mapId), versionNo: 1, graph, createdAt, supersedesStrategyMapVersionId: null });
  return Object.freeze({ map: Object.freeze({ id: strategyMapId(input.mapId), kind: input.kind, name: text(input.name, 'name'), currentVersionId: version.id, createdAt, archivedAt: null }), version });
}

export function reviseStrategyMap(map: StrategyMap, previous: StrategyMapVersion, input: { readonly id: StrategyMapVersionId; readonly graph: LogicGraph; readonly createdAt: string }): { readonly map: StrategyMap; readonly version: StrategyMapVersion } {
  if (map.currentVersionId !== previous.id || previous.strategyMapId !== map.id) throw new Error('Revision requires current map history head');
  const version: StrategyMapVersion = Object.freeze({ id: strategyMapVersionId(input.id), strategyMapId: map.id, versionNo: previous.versionNo + 1, graph: validateLogicGraph(input.graph), createdAt: iso(input.createdAt, 'createdAt'), supersedesStrategyMapVersionId: previous.id });
  return Object.freeze({ map: Object.freeze({ ...map, currentVersionId: version.id }), version });
}

export function simpleSequence(graph: LogicGraph): readonly StrategyGraphNodeId[] | null {
  const validated = validateLogicGraph(graph);
  if (!validated.nodes.length) return Object.freeze([]);
  const incoming = new Map<string, number>(); const outgoing = new Map<string, string[]>();
  for (const node of validated.nodes) { incoming.set(node.id, 0); outgoing.set(node.id, []); }
  for (const edge of validated.edges) { incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1); outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId); }
  if ([...incoming.values()].some((count) => count > 1) || [...outgoing.values()].some((targets) => targets.length > 1)) return null;
  const starts = validated.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  if (starts.length !== 1) return null;
  const ordered: StrategyGraphNodeId[] = []; let current: string | undefined = starts[0]!.id;
  while (current) { ordered.push(strategyGraphNodeId(current)); current = outgoing.get(current)?.[0]; }
  return ordered.length === validated.nodes.length ? Object.freeze(ordered) : null;
}

export function defaultNode(input: { id: StrategyGraphNodeId; family: StrategyNodeFamily; label: string; x: number; y: number }): StrategyGraphNode {
  const base = { id: input.id, family: input.family, label: input.label, position: { x: input.x, y: input.y }, timeframe: null, purposes: [] as TimeframePurpose[], importance: 'REQUIRED' as StageImportance, executionMode: 'OBSERVE' as ExecutionMode };
  switch (input.family) {
    case 'STRATEGY': return Object.freeze({ ...base, family: 'STRATEGY', strategyVersionId: strategyVersionId('unassigned'), parameters: Object.freeze({}) });
    case 'LOGIC': return Object.freeze({ ...base, family: 'LOGIC', operator: 'THEN' });
    case 'MODIFIER': return Object.freeze({ ...base, family: 'MODIFIER', modifierKey: 'require_candle_close', parameters: Object.freeze({}) });
    case 'MARKET_OBJECT': return Object.freeze({ ...base, family: 'MARKET_OBJECT', marketObjectId: null, marketObjectVersionId: null, conditionKey: 'price_touch' });
    case 'STATE': return Object.freeze({ ...base, family: 'STATE', stateKey: 'thesis_active' });
    case 'ACTION': return Object.freeze({ ...base, family: 'ACTION', actionKey: 'notify', parameters: Object.freeze({}) });
  }
}

const DEPLOYMENT_RANK: Readonly<Record<DeploymentStatus, number>> = Object.freeze({ EXPERIMENTAL: 0, VALIDATED: 1, DEMO_APPROVED: 2, LIVE_APPROVED: 3, RETIRED: -1 });
const RUNTIME_MODE_RANK: Readonly<Record<'OBSERVE'|'SHADOW'|'DEMO'|'LIVE', number>> = Object.freeze({ OBSERVE: 0, SHADOW: 1, DEMO: 2, LIVE: 3 });
export function deploymentStatusAllowsRuntimeMode(status: DeploymentStatus, mode: 'OBSERVE'|'SHADOW'|'DEMO'|'LIVE'): boolean {
  return status !== 'RETIRED' && DEPLOYMENT_RANK[status] >= RUNTIME_MODE_RANK[mode];
}
export function maximumRuntimeMode(statuses: readonly DeploymentStatus[]): 'OBSERVE'|'SHADOW'|'DEMO'|'LIVE' | null {
  if (!statuses.length) return 'OBSERVE';
  if (statuses.some((status) => status === 'RETIRED')) return null;
  const rank = Math.min(...statuses.map((status) => DEPLOYMENT_RANK[status]));
  return rank >= 3 ? 'LIVE' : rank >= 2 ? 'DEMO' : rank >= 1 ? 'SHADOW' : 'OBSERVE';
}
