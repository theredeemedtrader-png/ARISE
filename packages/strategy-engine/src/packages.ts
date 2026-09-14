import { createHash } from 'node:crypto';
import {
  strategyGraphEdgeId,
  strategyGraphNodeId,
  strategyVersionId,
  validateLogicGraph,
  type EvaluationMode,
  type ExecutionMode,
  type LogicGraph,
  type StageImportance,
  type StrategyGraphNode,
  type StrategyNodeFamily,
  type TimeframePurpose,
} from './model';

export const STRATEGY_PACKAGE_SCHEMA_VERSION = 1 as const;
export const STRATEGY_PACKAGE_MAX_BYTES = 1024 * 1024;
export const STRATEGY_PACKAGE_MAX_DEPTH = 32;

export type StrategyPackageType = 'STRATEGY' | 'COMBO' | 'TEMPLATE';
export type StrategyPackageExtension = '.arise-strategy' | '.arise-combo' | '.arise-template';
export type StrategyParameterType =
  | 'BOOLEAN' | 'INTEGER' | 'DECIMAL' | 'PIPS' | 'PRICE' | 'TIMEFRAME'
  | 'DIRECTION' | 'ENUM' | 'STRING' | 'DURATION' | 'CANDLE_COUNT'
  | 'MARKET_OBJECT_ROLE' | 'MARKET_OBJECT_TYPE' | 'DETECTOR_REFERENCE';
export type PackageRuntimeMode = 'OBSERVE' | 'SHADOW' | 'DEMO';
export type PackageMappingMode = 'MANUAL' | 'CONFIRMATION' | 'AUTOMATED' | 'IGNORED';

export interface StrategyPackageDependency {
  readonly id: string;
  readonly versionRange: string;
  readonly required: boolean;
}

export interface StrategyPackageParameter {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly type: StrategyParameterType;
  readonly defaultValue: unknown;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly allowedValues: readonly (string | number | boolean)[];
  readonly required: boolean;
  readonly unit: string | null;
  readonly scope: 'INHERITED' | 'LOCAL';
  readonly access: 'USER_EDITABLE' | 'READ_ONLY';
}

export interface StrategyPackageEvidencePolicy {
  readonly profile: 'ENTRY_ONLY' | 'STRATEGY_EVIDENCE_AND_ENTRY' | 'STRATEGY_EVIDENCE_ONLY' | 'CUSTOM';
  readonly events: readonly ('TRIGGER' | 'CONFIRMATION' | 'FAILURE' | 'EXPIRY' | 'ENTRY' | 'STAGE_SUMMARY')[];
  readonly references: readonly ('CANDLE' | 'MARKET_OBJECT' | 'DECISION_TRACE' | 'RUNTIME_NODE_EVENT' | 'ENTRY_SNAPSHOT' | 'STAGE_SUMMARY')[];
}

export interface StrategyPackageTimeframeMapping {
  readonly timeframe: string;
  readonly purposes: readonly TimeframePurpose[];
  readonly importance: StageImportance;
  readonly mode: PackageMappingMode;
}

interface PortableNodeBase {
  readonly id: string;
  readonly family: StrategyNodeFamily;
  readonly label: string;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly timeframe: string | null;
  readonly purposes: readonly TimeframePurpose[];
  readonly importance: StageImportance;
  readonly executionMode: ExecutionMode;
}
export interface PortableStrategyNode extends PortableNodeBase {
  readonly family: 'STRATEGY';
  readonly strategyRef: Readonly<{ packageId: string; versionRange: string }>;
  readonly parameters: Readonly<Record<string, unknown>>;
}
export interface PortableLogicNode extends PortableNodeBase { readonly family: 'LOGIC'; readonly operator: 'AND' | 'OR' | 'THEN' | 'NOT' }
export interface PortableModifierNode extends PortableNodeBase { readonly family: 'MODIFIER'; readonly modifierKey: string; readonly parameters: Readonly<Record<string, unknown>> }
export interface PortableMarketObjectNode extends PortableNodeBase { readonly family: 'MARKET_OBJECT'; readonly marketObjectId: string | null; readonly marketObjectVersionId: string | null; readonly conditionKey: string }
export interface PortableStateNode extends PortableNodeBase { readonly family: 'STATE'; readonly stateKey: string }
export interface PortableActionNode extends PortableNodeBase { readonly family: 'ACTION'; readonly actionKey: string; readonly parameters: Readonly<Record<string, unknown>> }
export type PortableStrategyGraphNode = PortableStrategyNode | PortableLogicNode | PortableModifierNode | PortableMarketObjectNode | PortableStateNode | PortableActionNode;
export interface PortableStrategyGraph {
  readonly nodes: readonly PortableStrategyGraphNode[];
  readonly edges: readonly Readonly<{ id: string; sourceNodeId: string; targetNodeId: string; sourcePort: string; targetPort: string }>[];
}

export interface StrategyPackageManifest {
  readonly schemaVersion: 1;
  readonly packageType: StrategyPackageType;
  readonly packageId: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly createdAt: string;
  readonly author: Readonly<{ name: string; source: string; url: string | null }>;
  readonly minimumAriseVersion: string;
  readonly capabilityRequirements: readonly string[];
  readonly dependencies: Readonly<{
    detectors: readonly StrategyPackageDependency[];
    strategies: readonly StrategyPackageDependency[];
    combos: readonly StrategyPackageDependency[];
  }>;
  readonly parameters: readonly StrategyPackageParameter[];
  readonly graph: PortableStrategyGraph | null;
  readonly timeframeMappings: readonly StrategyPackageTimeframeMapping[];
  readonly evidencePolicy: StrategyPackageEvidencePolicy;
  readonly deploymentRestrictions: Readonly<{ allowedModes: readonly PackageRuntimeMode[]; preferredMode: PackageRuntimeMode }>;
  readonly definition: Readonly<{
    category: string;
    tags: readonly string[];
    automationCapability: 'MANUAL' | 'DETECTABLE' | 'AUTOMATABLE';
    detector: Readonly<{ key: string; version: string; evaluationMode: EvaluationMode }> | null;
  }> | null;
  readonly template: Readonly<{
    attemptBudget: Readonly<Record<string, unknown>>;
    stackingPolicy: Readonly<Record<string, unknown>>;
    protectionPolicyReferences: readonly string[];
    colonyConfiguration: Readonly<Record<string, unknown>>;
  }> | null;
  readonly integrity: Readonly<{ algorithm: 'SHA-256'; checksum: string }>;
}

export interface StrategyPackageTrustPolicy {
  readonly ariseVersion: string;
  readonly detectors: ReadonlyMap<string, string>;
  readonly capabilities: ReadonlySet<string>;
  readonly actions: ReadonlySet<string>;
  readonly modifiers: ReadonlySet<string>;
  readonly marketObjectConditions: ReadonlySet<string>;
  readonly states: ReadonlySet<string>;
}

export const DEFAULT_TRUSTED_ACTIONS = Object.freeze(new Set([
  'notify', 'arm_strategy', 'create_scout', 'cancel_pending', 'move_stop',
  'partial_close', 'promote_leg', 'convert_runner', 'take_snapshot', 'create_lesson_marker',
]));
export const DEFAULT_TRUSTED_MODIFIERS = Object.freeze(new Set(['require_candle_close', 'allow_intracandle', 'max_spread']));
export const DEFAULT_TRUSTED_MARKET_OBJECT_CONDITIONS = Object.freeze(new Set(['price_touch', 'zone_entry']));
export const DEFAULT_TRUSTED_STATES = Object.freeze(new Set(['thesis_active', 'area_armed', 'scout_active', 'leg_protected', 'target_approaching']));

const PACKAGE_EXTENSIONS: Readonly<Record<StrategyPackageType, StrategyPackageExtension>> = Object.freeze({
  STRATEGY: '.arise-strategy', COMBO: '.arise-combo', TEMPLATE: '.arise-template',
});
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const HASH = /^[a-f0-9]{64}$/;
const PURPOSES = new Set(['HINDSIGHT', 'AREA', 'ENTRY']);
const IMPORTANCE = new Set(['REQUIRED', 'OPTIONAL', 'INFORMATIONAL']);
const EXECUTION_MODES = new Set(['OBSERVE', 'NOTIFY', 'CONFIRM', 'AUTO']);
const EVALUATION_MODES = new Set(['ON_TICK', 'ON_PRICE_UPDATE', 'ON_BAR_UPDATE', 'ON_BAR_CLOSE', 'ON_EVENT', 'MANUAL']);
const PARAMETER_TYPES = new Set<StrategyParameterType>(['BOOLEAN','INTEGER','DECIMAL','PIPS','PRICE','TIMEFRAME','DIRECTION','ENUM','STRING','DURATION','CANDLE_COUNT','MARKET_OBJECT_ROLE','MARKET_OBJECT_TYPE','DETECTOR_REFERENCE']);
const PACKAGE_KEYS = new Set(['schemaVersion','packageType','packageId','name','description','version','createdAt','author','minimumAriseVersion','capabilityRequirements','dependencies','parameters','graph','timeframeMappings','evidencePolicy','deploymentRestrictions','definition','template','integrity']);

function fail(message: string): never { throw new Error(`Strategy package validation failed: ${message}`); }
function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail(`${field} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) fail(`${field} contains unsupported field ${unexpected[0]}`);
}
function requiredString(value: unknown, field: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} is required`);
  if (value.length > max) fail(`${field} is too long`);
  if (/(^|[\\/])\.\.([\\/]|$)/.test(value) || /^[A-Za-z]:[\\/]/.test(value)) fail(`${field} contains a path traversal or absolute path`);
  return value.trim();
}
function optionalNullableString(value: unknown, field: string): string | null {
  return value === null ? null : requiredString(value, field);
}
function bool(value: unknown, field: string): boolean { if (typeof value !== 'boolean') fail(`${field} must be boolean`); return value; }
function finite(value: unknown, field: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be finite`); return value; }
function list(value: unknown, field: string, max = 256): unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  if (value.length > max) fail(`${field} exceeds ${max} items`);
  return value;
}
function enumValue<T extends string>(value: unknown, values: ReadonlySet<string>, field: string): T {
  if (typeof value !== 'string' || !values.has(value)) fail(`${field} is unsupported`);
  return value as T;
}
function idValue(value: unknown, field: string): string { const result = requiredString(value, field, 128); if (!ID.test(result)) fail(`${field} must be an opaque token`); return result; }
function semanticVersion(value: unknown, field: string): string { const result = requiredString(value, field, 64); if (!SEMVER.test(result)) fail(`${field} must be semantic versioning`); return result; }
function iso(value: unknown, field: string): string { const result = requiredString(value, field, 64); if (!Number.isFinite(Date.parse(result))) fail(`${field} must be an ISO timestamp`); return new Date(result).toISOString(); }
function jsonRecord(value: unknown, field: string): Readonly<Record<string, unknown>> { return Object.freeze(structuredClone(record(value, field))); }

function assertRawDepth(text: string): void {
  let depth = 0; let quoted = false; let escaped = false;
  for (const char of text) {
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{' || char === '[') { depth += 1; if (depth > STRATEGY_PACKAGE_MAX_DEPTH) fail(`nesting exceeds ${STRATEGY_PACKAGE_MAX_DEPTH}`); }
    else if (char === '}' || char === ']') depth -= 1;
  }
}

function assertDataOnly(value: unknown, path = 'package'): void {
  if (typeof value === 'string') {
    if (/(^|[\\/])\.\.([\\/]|$)/.test(value) || /^[A-Za-z]:[\\/]/.test(value)) fail(`${path} contains a path traversal or absolute path`);
    return;
  }
  if (Array.isArray(value)) { value.forEach((entry, index) => assertDataOnly(entry, `${path}[${index}]`)); return; }
  if (value === null || typeof value !== 'object') return;
  const forbidden = /^(code|script|javascript|typescript|python|shell|command|executable|dll|nativeCode|module|dynamicImport|process|filesystem|network)$/i;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.test(key)) fail(`${path}.${key} is an executable-code or side-effect field`);
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail(`${path}.${key} is forbidden`);
    assertDataOnly(entry, `${path}.${key}`);
  }
}

export function canonicalPackageJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPackageJson).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalPackageJson(source[key])}`).join(',')}}`;
}

export function packageChecksum(manifest: Omit<StrategyPackageManifest, 'integrity'> | StrategyPackageManifest): string {
  const payload = { ...manifest } as Record<string, unknown>;
  delete payload.integrity;
  return createHash('sha256').update(canonicalPackageJson(payload), 'utf8').digest('hex');
}

export function extensionForPackageType(type: StrategyPackageType): StrategyPackageExtension { return PACKAGE_EXTENSIONS[type]; }

function parseDependency(value: unknown, field: string): StrategyPackageDependency {
  const item = record(value, field); exact(item, new Set(['id','versionRange','required']), field);
  return Object.freeze({ id: idValue(item.id, `${field}.id`), versionRange: requiredString(item.versionRange, `${field}.versionRange`, 64), required: bool(item.required, `${field}.required`) });
}

function parseParameter(value: unknown, index: number): StrategyPackageParameter {
  const field = `parameters[${index}]`; const item = record(value, field);
  exact(item, new Set(['key','label','description','type','defaultValue','minimum','maximum','allowedValues','required','unit','scope','access']), field);
  const type = enumValue<StrategyParameterType>(item.type, PARAMETER_TYPES, `${field}.type`);
  const minimum = item.minimum === null ? null : finite(item.minimum, `${field}.minimum`);
  const maximum = item.maximum === null ? null : finite(item.maximum, `${field}.maximum`);
  if (minimum !== null && maximum !== null && minimum > maximum) fail(`${field} minimum exceeds maximum`);
  const allowedValues = list(item.allowedValues, `${field}.allowedValues`, 128).map((entry, valueIndex) => {
    if (!['string','number','boolean'].includes(typeof entry) || (typeof entry === 'number' && !Number.isFinite(entry))) fail(`${field}.allowedValues[${valueIndex}] is invalid`);
    return entry as string | number | boolean;
  });
  const defaultValue = structuredClone(item.defaultValue);
  validateParameterValue(type, defaultValue, `${field}.defaultValue`, allowedValues, minimum, maximum);
  return Object.freeze({ key: idValue(item.key, `${field}.key`), label: requiredString(item.label, `${field}.label`, 128), description: typeof item.description === 'string' ? item.description.trim() : fail(`${field}.description must be a string`), type, defaultValue, minimum, maximum, allowedValues: Object.freeze(allowedValues), required: bool(item.required, `${field}.required`), unit: optionalNullableString(item.unit, `${field}.unit`), scope: enumValue<'INHERITED'|'LOCAL'>(item.scope, new Set(['INHERITED','LOCAL']), `${field}.scope`), access: enumValue<'USER_EDITABLE'|'READ_ONLY'>(item.access, new Set(['USER_EDITABLE','READ_ONLY']), `${field}.access`) });
}

function validateParameterValue(type: StrategyParameterType, value: unknown, field: string, allowed: readonly (string|number|boolean)[], minimum: number|null, maximum: number|null): void {
  if (value === null) return;
  if (type === 'BOOLEAN' && typeof value !== 'boolean') fail(`${field} must be boolean`);
  if (['INTEGER','CANDLE_COUNT'].includes(type) && (!Number.isSafeInteger(value) || (value as number) < 0)) fail(`${field} must be a non-negative integer`);
  if (['DECIMAL','PIPS','PRICE','DURATION'].includes(type) && (typeof value !== 'number' || !Number.isFinite(value))) fail(`${field} must be numeric`);
  if (['TIMEFRAME','DIRECTION','ENUM','STRING','MARKET_OBJECT_ROLE','MARKET_OBJECT_TYPE','DETECTOR_REFERENCE'].includes(type) && typeof value !== 'string') fail(`${field} must be a string`);
  if (typeof value === 'number' && ((minimum !== null && value < minimum) || (maximum !== null && value > maximum))) fail(`${field} is outside bounds`);
  if (allowed.length && !allowed.some((candidate) => candidate === value)) fail(`${field} is not an allowed value`);
  if (type === 'DIRECTION' && !['LONG','SHORT','NEUTRAL'].includes(String(value))) fail(`${field} direction is invalid`);
}

function parseBaseNode(item: Record<string, unknown>, field: string): PortableNodeBase {
  const position = record(item.position, `${field}.position`); exact(position, new Set(['x','y']), `${field}.position`);
  return {
    id: idValue(item.id, `${field}.id`), family: enumValue(item.family, new Set(['STRATEGY','LOGIC','MODIFIER','MARKET_OBJECT','STATE','ACTION']), `${field}.family`),
    label: requiredString(item.label, `${field}.label`, 128), position: Object.freeze({ x: finite(position.x, `${field}.position.x`), y: finite(position.y, `${field}.position.y`) }),
    timeframe: item.timeframe === null ? null : idValue(item.timeframe, `${field}.timeframe`),
    purposes: Object.freeze(list(item.purposes, `${field}.purposes`, 3).map((entry) => enumValue<TimeframePurpose>(entry, PURPOSES, `${field}.purposes`))),
    importance: enumValue<StageImportance>(item.importance, IMPORTANCE, `${field}.importance`), executionMode: enumValue<ExecutionMode>(item.executionMode, EXECUTION_MODES, `${field}.executionMode`),
  };
}

function parseGraph(value: unknown): PortableStrategyGraph | null {
  if (value === null) return null;
  const graph = record(value, 'graph'); exact(graph, new Set(['nodes','edges']), 'graph');
  const nodes = list(graph.nodes, 'graph.nodes', 512).map((value, index): PortableStrategyGraphNode => {
    const field = `graph.nodes[${index}]`; const item = record(value, field); const base = parseBaseNode(item, field);
    const common = ['id','family','label','position','timeframe','purposes','importance','executionMode'];
    if (base.family === 'STRATEGY') { exact(item, new Set([...common,'strategyRef','parameters']), field); const ref = record(item.strategyRef, `${field}.strategyRef`); exact(ref, new Set(['packageId','versionRange']), `${field}.strategyRef`); return Object.freeze({ ...base, family:'STRATEGY', strategyRef:Object.freeze({packageId:idValue(ref.packageId,`${field}.strategyRef.packageId`),versionRange:requiredString(ref.versionRange,`${field}.strategyRef.versionRange`,64)}), parameters:jsonRecord(item.parameters,`${field}.parameters`) }); }
    if (base.family === 'LOGIC') { exact(item, new Set([...common,'operator']), field); return Object.freeze({ ...base, family:'LOGIC', operator:enumValue<'AND'|'OR'|'THEN'|'NOT'>(item.operator,new Set(['AND','OR','THEN','NOT']),`${field}.operator`) }); }
    if (base.family === 'MODIFIER') { exact(item, new Set([...common,'modifierKey','parameters']), field); return Object.freeze({ ...base, family:'MODIFIER', modifierKey:idValue(item.modifierKey,`${field}.modifierKey`), parameters:jsonRecord(item.parameters,`${field}.parameters`) }); }
    if (base.family === 'MARKET_OBJECT') { exact(item, new Set([...common,'marketObjectId','marketObjectVersionId','conditionKey']), field); return Object.freeze({ ...base, family:'MARKET_OBJECT', marketObjectId:item.marketObjectId===null?null:idValue(item.marketObjectId,`${field}.marketObjectId`), marketObjectVersionId:item.marketObjectVersionId===null?null:idValue(item.marketObjectVersionId,`${field}.marketObjectVersionId`), conditionKey:idValue(item.conditionKey,`${field}.conditionKey`) }); }
    if (base.family === 'STATE') { exact(item, new Set([...common,'stateKey']), field); return Object.freeze({ ...base, family:'STATE', stateKey:idValue(item.stateKey,`${field}.stateKey`) }); }
    exact(item, new Set([...common,'actionKey','parameters']), field); return Object.freeze({ ...base, family:'ACTION', actionKey:idValue(item.actionKey,`${field}.actionKey`), parameters:jsonRecord(item.parameters,`${field}.parameters`) });
  });
  const ids = new Set<string>(); for (const node of nodes) { if (ids.has(node.id)) fail(`duplicate graph node ${node.id}`); ids.add(node.id); }
  const edges = list(graph.edges, 'graph.edges', 1024).map((value, index) => { const field=`graph.edges[${index}]`; const item=record(value,field); exact(item,new Set(['id','sourceNodeId','targetNodeId','sourcePort','targetPort']),field); return Object.freeze({id:idValue(item.id,`${field}.id`),sourceNodeId:idValue(item.sourceNodeId,`${field}.sourceNodeId`),targetNodeId:idValue(item.targetNodeId,`${field}.targetNodeId`),sourcePort:idValue(item.sourcePort,`${field}.sourcePort`),targetPort:idValue(item.targetPort,`${field}.targetPort`)}); });
  // Reuse the canonical graph validator with placeholder strategy versions after portable references are resolved later.
  const edgeIds=new Set<string>(); const outgoing=new Map<string,string[]>(); for(const id of ids) outgoing.set(id,[]);
  for(const edge of edges){if(edgeIds.has(edge.id))fail(`duplicate graph edge ${edge.id}`);edgeIds.add(edge.id);if(!ids.has(edge.sourceNodeId)||!ids.has(edge.targetNodeId))fail(`graph edge ${edge.id} is dangling`);if(edge.sourceNodeId===edge.targetNodeId)fail(`graph edge ${edge.id} self-references`);outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);}
  const visiting=new Set<string>(); const visited=new Set<string>(); const walk=(id:string)=>{if(visiting.has(id))fail('graph cycles are not allowed');if(visited.has(id))return;visiting.add(id);for(const next of outgoing.get(id)??[])walk(next);visiting.delete(id);visited.add(id);}; for(const id of ids)walk(id);
  return Object.freeze({nodes:Object.freeze(nodes),edges:Object.freeze(edges)});
}

export function parseStrategyPackageText(text: string): StrategyPackageManifest {
  if (Buffer.byteLength(text, 'utf8') > STRATEGY_PACKAGE_MAX_BYTES) fail(`file exceeds ${STRATEGY_PACKAGE_MAX_BYTES} bytes`);
  assertRawDepth(text);
  let unknown: unknown; try { unknown = JSON.parse(text); } catch { fail('malformed JSON'); }
  assertDataOnly(unknown);
  const root = record(unknown, 'package'); exact(root, PACKAGE_KEYS, 'package');
  if (root.schemaVersion !== STRATEGY_PACKAGE_SCHEMA_VERSION) fail(`unsupported schemaVersion ${String(root.schemaVersion)}`);
  const packageType=enumValue<StrategyPackageType>(root.packageType,new Set(['STRATEGY','COMBO','TEMPLATE']),'packageType');
  const author=record(root.author,'author'); exact(author,new Set(['name','source','url']),'author');
  const dependencies=record(root.dependencies,'dependencies'); exact(dependencies,new Set(['detectors','strategies','combos']),'dependencies');
  const parameters=list(root.parameters,'parameters').map(parseParameter); const parameterKeys=new Set<string>(); for(const parameter of parameters){if(parameterKeys.has(parameter.key))fail(`duplicate parameter ${parameter.key}`);parameterKeys.add(parameter.key);}
  const evidence=record(root.evidencePolicy,'evidencePolicy'); exact(evidence,new Set(['profile','events','references']),'evidencePolicy');
  const deployment=record(root.deploymentRestrictions,'deploymentRestrictions'); exact(deployment,new Set(['allowedModes','preferredMode']),'deploymentRestrictions');
  const allowedModes=list(deployment.allowedModes,'deploymentRestrictions.allowedModes',3).map((mode)=>enumValue<PackageRuntimeMode>(mode,new Set(['OBSERVE','SHADOW','DEMO']),'deploymentRestrictions.allowedModes'));
  if (!allowedModes.length) fail('deploymentRestrictions.allowedModes is empty');
  const preferredMode=enumValue<PackageRuntimeMode>(deployment.preferredMode,new Set(['OBSERVE','SHADOW','DEMO']),'deploymentRestrictions.preferredMode'); if(!allowedModes.includes(preferredMode))fail('preferredMode must be allowed');
  let definition: StrategyPackageManifest['definition'] = null;
  if(root.definition!==null){const item=record(root.definition,'definition');exact(item,new Set(['category','tags','automationCapability','detector']),'definition');let detector:NonNullable<StrategyPackageManifest['definition']>['detector']=null;if(item.detector!==null){const d=record(item.detector,'definition.detector');exact(d,new Set(['key','version','evaluationMode']),'definition.detector');detector=Object.freeze({key:idValue(d.key,'definition.detector.key'),version:requiredString(d.version,'definition.detector.version',64),evaluationMode:enumValue<EvaluationMode>(d.evaluationMode,EVALUATION_MODES,'definition.detector.evaluationMode')});}definition=Object.freeze({category:requiredString(item.category,'definition.category',128),tags:Object.freeze(list(item.tags,'definition.tags',128).map((tag)=>requiredString(tag,'definition.tags',128))),automationCapability:enumValue<'MANUAL'|'DETECTABLE'|'AUTOMATABLE'>(item.automationCapability,new Set(['MANUAL','DETECTABLE','AUTOMATABLE']),'definition.automationCapability'),detector});}
  if(packageType==='STRATEGY'&&definition===null)fail('STRATEGY package requires definition'); if(packageType!=='STRATEGY'&&definition!==null)fail(`${packageType} package cannot define a strategy definition`);
  let template: StrategyPackageManifest['template']=null;
  if(root.template!==null){const item=record(root.template,'template');exact(item,new Set(['attemptBudget','stackingPolicy','protectionPolicyReferences','colonyConfiguration']),'template');template=Object.freeze({attemptBudget:jsonRecord(item.attemptBudget,'template.attemptBudget'),stackingPolicy:jsonRecord(item.stackingPolicy,'template.stackingPolicy'),protectionPolicyReferences:Object.freeze(list(item.protectionPolicyReferences,'template.protectionPolicyReferences').map((entry)=>idValue(entry,'template.protectionPolicyReferences'))),colonyConfiguration:jsonRecord(item.colonyConfiguration,'template.colonyConfiguration')});}
  if(packageType==='TEMPLATE'&&template===null)fail('TEMPLATE package requires template configuration'); if(packageType!=='TEMPLATE'&&template!==null)fail(`${packageType} package cannot contain template configuration`);
  const mappings=list(root.timeframeMappings,'timeframeMappings',128).map((value,index)=>{const field=`timeframeMappings[${index}]`;const item=record(value,field);exact(item,new Set(['timeframe','purposes','importance','mode']),field);return Object.freeze({timeframe:idValue(item.timeframe,`${field}.timeframe`),purposes:Object.freeze(list(item.purposes,`${field}.purposes`,3).map((entry)=>enumValue<TimeframePurpose>(entry,PURPOSES,`${field}.purposes`))),importance:enumValue<StageImportance>(item.importance,IMPORTANCE,`${field}.importance`),mode:enumValue<PackageMappingMode>(item.mode,new Set(['MANUAL','CONFIRMATION','AUTOMATED','IGNORED']),`${field}.mode`)});});
  const integrity=record(root.integrity,'integrity'); exact(integrity,new Set(['algorithm','checksum']),'integrity'); if(integrity.algorithm!=='SHA-256')fail('integrity.algorithm must be SHA-256'); const checksum=requiredString(integrity.checksum,'integrity.checksum',64).toLowerCase();if(!HASH.test(checksum))fail('integrity.checksum must be 64 lowercase hexadecimal characters');
  const manifest:StrategyPackageManifest=Object.freeze({schemaVersion:1,packageType,packageId:idValue(root.packageId,'packageId'),name:requiredString(root.name,'name',256),description:typeof root.description==='string'?root.description.trim():fail('description must be a string'),version:semanticVersion(root.version,'version'),createdAt:iso(root.createdAt,'createdAt'),author:Object.freeze({name:requiredString(author.name,'author.name',256),source:requiredString(author.source,'author.source',256),url:optionalNullableString(author.url,'author.url')}),minimumAriseVersion:semanticVersion(root.minimumAriseVersion,'minimumAriseVersion'),capabilityRequirements:Object.freeze(list(root.capabilityRequirements,'capabilityRequirements').map((entry)=>idValue(entry,'capabilityRequirements'))),dependencies:Object.freeze({detectors:Object.freeze(list(dependencies.detectors,'dependencies.detectors').map((entry,index)=>parseDependency(entry,`dependencies.detectors[${index}]`))),strategies:Object.freeze(list(dependencies.strategies,'dependencies.strategies').map((entry,index)=>parseDependency(entry,`dependencies.strategies[${index}]`))),combos:Object.freeze(list(dependencies.combos,'dependencies.combos').map((entry,index)=>parseDependency(entry,`dependencies.combos[${index}]`)))}),parameters:Object.freeze(parameters),graph:parseGraph(root.graph),timeframeMappings:Object.freeze(mappings),evidencePolicy:Object.freeze({profile:enumValue<StrategyPackageEvidencePolicy['profile']>(evidence.profile,new Set(['ENTRY_ONLY','STRATEGY_EVIDENCE_AND_ENTRY','STRATEGY_EVIDENCE_ONLY','CUSTOM']),'evidencePolicy.profile'),events:Object.freeze(list(evidence.events,'evidencePolicy.events').map((entry)=>enumValue<StrategyPackageEvidencePolicy['events'][number]>(entry,new Set(['TRIGGER','CONFIRMATION','FAILURE','EXPIRY','ENTRY','STAGE_SUMMARY']),'evidencePolicy.events'))),references:Object.freeze(list(evidence.references,'evidencePolicy.references').map((entry)=>enumValue<StrategyPackageEvidencePolicy['references'][number]>(entry,new Set(['CANDLE','MARKET_OBJECT','DECISION_TRACE','RUNTIME_NODE_EVENT','ENTRY_SNAPSHOT','STAGE_SUMMARY']),'evidencePolicy.references')))}),deploymentRestrictions:Object.freeze({allowedModes:Object.freeze([...new Set(allowedModes)]),preferredMode}),definition,template,integrity:Object.freeze({algorithm:'SHA-256',checksum})});
  const calculated=packageChecksum(manifest);if(calculated!==checksum)fail(`checksum mismatch (expected ${calculated})`);
  return manifest;
}

function semverParts(value:string):readonly[number,number,number,string|null]{const match=SEMVER.exec(value);if(!match)fail(`invalid semantic version ${value}`);return [Number(match[1]),Number(match[2]),Number(match[3]),match[4]??null];}
export function compareSemanticVersions(left:string,right:string):number{const a=semverParts(left),b=semverParts(right);for(let i=0;i<3;i+=1){if(a[i]!==b[i])return (a[i] as number)-(b[i] as number);}if(a[3]===b[3])return 0;if(a[3]===null)return 1;if(b[3]===null)return -1;return a[3].localeCompare(b[3]);}
export function semanticVersionSatisfies(version:string,range:string):boolean{const trimmed=range.trim();if(SEMVER.test(trimmed))return compareSemanticVersions(version,trimmed)===0;const operator=trimmed.startsWith('>=')?'>=':trimmed.startsWith('^')?'^':trimmed.startsWith('~')?'~':null;if(!operator)fail(`unsupported version range ${range}`);const target=trimmed.slice(operator.length).trim();semverParts(target);const cmp=compareSemanticVersions(version,target);if(operator==='>=')return cmp>=0;const v=semverParts(version),t=semverParts(target);if(cmp<0)return false;if(operator==='~')return v[0]===t[0]&&v[1]===t[1];return t[0]>0?v[0]===t[0]:t[1]>0?v[0]===0&&v[1]===t[1]:v[0]===0&&v[1]===0&&v[2]===t[2];}

export function validatePackageTrust(manifest:StrategyPackageManifest,policy:StrategyPackageTrustPolicy):readonly string[]{const warnings:string[]=[];if(compareSemanticVersions(policy.ariseVersion,manifest.minimumAriseVersion)<0)fail(`requires ARISE >= ${manifest.minimumAriseVersion}`);for(const capability of manifest.capabilityRequirements)if(!policy.capabilities.has(capability))fail(`unsupported capability ${capability}`);for(const dependency of manifest.dependencies.detectors){const version=policy.detectors.get(dependency.id);if(!version&&dependency.required)fail(`missing detector dependency ${dependency.id}`);if(version&&!semanticVersionSatisfies(normalizeDetectorVersion(version),normalizeDetectorRange(dependency.versionRange))&&dependency.required)fail(`incompatible detector dependency ${dependency.id} ${dependency.versionRange}`);}if(manifest.definition?.detector){const registered=policy.detectors.get(manifest.definition.detector.key);if(!registered)fail(`definition detector ${manifest.definition.detector.key}@${manifest.definition.detector.version} is not trusted`);if(normalizeDetectorVersion(registered)!==normalizeDetectorVersion(manifest.definition.detector.version))fail(`definition detector version is incompatible`);}for(const node of manifest.graph?.nodes??[]){if(node.family==='ACTION'&&!policy.actions.has(node.actionKey))fail(`unsupported action ${node.actionKey}`);if(node.family==='MODIFIER'&&!policy.modifiers.has(node.modifierKey))fail(`unsupported modifier ${node.modifierKey}`);if(node.family==='MARKET_OBJECT'&&!policy.marketObjectConditions.has(node.conditionKey))fail(`unsupported Market Object condition ${node.conditionKey}`);if(node.family==='STATE'&&!policy.states.has(node.stateKey))fail(`unsupported state ${node.stateKey}`);}if(manifest.deploymentRestrictions.preferredMode!=='OBSERVE')warnings.push(`Import defaults to OBSERVE; package preference ${manifest.deploymentRestrictions.preferredMode} does not grant authority.`);return Object.freeze(warnings);}
function normalizeDetectorVersion(value:string):string{return SEMVER.test(value)?value:`${value}.0.0`;}
function normalizeDetectorRange(value:string):string{return /^(>=|\^|~)/.test(value)?value.replace(/(>=|\^|~)\s*(\d+)$/, '$1$2.0.0').replace(/(>=|\^|~)\s*(\d+)\.(\d+)$/, '$1$2.$3.0'):normalizeDetectorVersion(value);}

export function reconstructPackageGraph(graph:PortableStrategyGraph,resolver:(ref:PortableStrategyNode['strategyRef'])=>string):LogicGraph{
  const nodes:StrategyGraphNode[]=graph.nodes.map((node)=>{const base={id:strategyGraphNodeId(node.id),family:node.family,label:node.label,position:node.position,timeframe:node.timeframe,purposes:node.purposes,importance:node.importance,executionMode:node.executionMode};if(node.family==='STRATEGY')return {...base,family:'STRATEGY',strategyVersionId:strategyVersionId(resolver(node.strategyRef)),parameters:node.parameters};if(node.family==='LOGIC')return {...base,family:'LOGIC',operator:node.operator};if(node.family==='MODIFIER')return {...base,family:'MODIFIER',modifierKey:node.modifierKey,parameters:node.parameters};if(node.family==='MARKET_OBJECT')return {...base,family:'MARKET_OBJECT',marketObjectId:node.marketObjectId,marketObjectVersionId:node.marketObjectVersionId,conditionKey:node.conditionKey};if(node.family==='STATE')return {...base,family:'STATE',stateKey:node.stateKey};return {...base,family:'ACTION',actionKey:node.actionKey,parameters:node.parameters};});
  return validateLogicGraph({nodes,edges:graph.edges.map((edge)=>({id:strategyGraphEdgeId(edge.id),sourceNodeId:strategyGraphNodeId(edge.sourceNodeId),targetNodeId:strategyGraphNodeId(edge.targetNodeId),sourcePort:edge.sourcePort,targetPort:edge.targetPort}))});
}

export function withPackageChecksum(manifest:Omit<StrategyPackageManifest,'integrity'>):StrategyPackageManifest{const checksum=packageChecksum(manifest);return Object.freeze({...manifest,integrity:Object.freeze({algorithm:'SHA-256' as const,checksum})});}
