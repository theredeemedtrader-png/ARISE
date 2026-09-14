import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  DEFAULT_TRUSTED_ACTIONS,
  DEFAULT_TRUSTED_MARKET_OBJECT_CONDITIONS,
  DEFAULT_TRUSTED_MODIFIERS,
  DEFAULT_TRUSTED_STATES,
  compareSemanticVersions,
  createDefaultDetectorRegistry,
  extensionForPackageType,
  parseStrategyPackageText,
  reconstructPackageGraph,
  semanticVersionSatisfies,
  validatePackageTrust,
  withPackageChecksum,
  type PortableStrategyGraph,
  type StrategyPackageDependency,
  type StrategyPackageManifest,
  type StrategyPackageTrustPolicy,
} from '@arise/strategy-engine';
import type { AriseDatabase } from './database';
import { strategyDefinitions, strategyMapVersions, strategyMaps, strategyPackageImports, strategyVersions } from './schema';

export type StrategyPackageDependencyStatus = 'SATISFIED' | 'MISSING' | 'INCOMPATIBLE_VERSION' | 'UNSUPPORTED_CAPABILITY' | 'CIRCULAR_DEPENDENCY';
export type StrategyPackageDisposition = 'NEW' | 'IDENTICAL' | 'UPGRADE' | 'OLDER' | 'CONFLICT';

export interface StrategyPackageDependencyView {
  readonly kind: 'DETECTOR' | 'STRATEGY' | 'COMBO' | 'CAPABILITY';
  readonly id: string;
  readonly versionRange: string;
  readonly installedVersion: string | null;
  readonly required: boolean;
  readonly status: StrategyPackageDependencyStatus;
}

export interface StrategyPackagePreview {
  readonly valid: boolean;
  readonly filename: string;
  readonly packageId: string | null;
  readonly packageType: StrategyPackageManifest['packageType'] | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly version: string | null;
  readonly author: string | null;
  readonly source: string | null;
  readonly checksum: string | null;
  readonly integrity: 'VERIFIED' | 'FAILED' | 'UNKNOWN';
  readonly disposition: StrategyPackageDisposition | null;
  readonly dependencies: readonly StrategyPackageDependencyView[];
  readonly parameters: readonly StrategyPackageManifest['parameters'][number][];
  readonly graphSummary: Readonly<{ nodes: number; edges: number; actions: readonly string[] }>;
  readonly timeframeMappings: readonly StrategyPackageManifest['timeframeMappings'][number][];
  readonly evidencePolicy: StrategyPackageManifest['evidencePolicy'] | null;
  readonly deploymentModes: readonly string[];
  readonly preferredImportMode: 'OBSERVE';
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface StrategyPackageImportResult {
  readonly status: 'IMPORTED' | 'ALREADY_IMPORTED';
  readonly packageId: string;
  readonly packageType: StrategyPackageManifest['packageType'];
  readonly packageVersion: string;
  readonly checksum: string;
  readonly definitionId: string | null;
  readonly definitionVersionId: string | null;
  readonly mapId: string | null;
  readonly mapVersionId: string | null;
}

type ImportRow = typeof strategyPackageImports.$inferSelect;

function shortHash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 20); }
function extension(filename: string): string { const dot = filename.lastIndexOf('.'); return dot < 0 ? '' : filename.slice(dot).toLowerCase(); }
function latest(rows: readonly ImportRow[]): ImportRow | null { return [...rows].sort((a, b) => compareSemanticVersions(b.packageVersion, a.packageVersion))[0] ?? null; }
function freeze<T>(value: T): T { return Object.freeze(value); }

export class StrategyPackageRepository {
  private readonly detectorVersions: ReadonlyMap<string, string>;
  private readonly trust: StrategyPackageTrustPolicy;

  constructor(private readonly db: AriseDatabase, ariseVersion: string) {
    const detectors = createDefaultDetectorRegistry().list();
    this.detectorVersions = new Map(detectors.map((item) => [item.key, item.version]));
    this.trust = freeze({
      ariseVersion,
      detectors: this.detectorVersions,
      capabilities: new Set(['strategy-graph','timeframe-purpose','evidence','decision-trace','observe','shadow','demo']),
      actions: DEFAULT_TRUSTED_ACTIONS,
      modifiers: DEFAULT_TRUSTED_MODIFIERS,
      marketObjectConditions: DEFAULT_TRUSTED_MARKET_OBJECT_CONDITIONS,
      states: DEFAULT_TRUSTED_STATES,
    });
  }

  preview(text: string, filename: string): { readonly manifest: StrategyPackageManifest | null; readonly preview: StrategyPackagePreview } {
    const errors: string[] = []; const warnings: string[] = [];
    let manifest: StrategyPackageManifest | null = null;
    try { manifest = parseStrategyPackageText(text); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    if (!manifest) return freeze({ manifest: null, preview: this.emptyPreview(filename, errors) });

    try { warnings.push(...validatePackageTrust(manifest, this.trust)); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    const expectedExtension = extensionForPackageType(manifest.packageType);
    if (extension(filename) !== expectedExtension) warnings.push(`Filename extension does not match declared ${manifest.packageType} type; package contents remain authoritative.`);
    if (manifest.packageType !== 'STRATEGY' && manifest.graph === null) errors.push(`${manifest.packageType} packages require graph topology.`);

    const dependencies = this.dependencyViews(manifest);
    for (const dependency of dependencies) {
      if (dependency.required && dependency.status !== 'SATISFIED') errors.push(`${dependency.kind} dependency ${dependency.id} is ${dependency.status}.`);
    }
    if (this.hasCircularDependency(manifest)) errors.push(`Circular dependency includes ${manifest.packageId}.`);

    if (manifest.graph) {
      try {
        reconstructPackageGraph(manifest.graph, (ref) => {
          if (ref.packageId === manifest!.packageId && manifest!.packageType === 'STRATEGY') return `preview-self:${manifest!.packageId}`;
          const row = this.resolveImportedDependency('STRATEGY', ref.packageId, ref.versionRange);
          if (!row?.definitionVersionId) throw new Error(`Graph strategy reference ${ref.packageId} ${ref.versionRange} is unresolved`);
          return row.definitionVersionId;
        });
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }

    const disposition = this.disposition(manifest, errors);
    const actions = [...new Set((manifest.graph?.nodes ?? []).filter((node) => node.family === 'ACTION').map((node) => node.actionKey))];
    return freeze({ manifest, preview: freeze({
      valid: errors.length === 0, filename, packageId: manifest.packageId, packageType: manifest.packageType,
      name: manifest.name, description: manifest.description, version: manifest.version,
      author: manifest.author.name, source: manifest.author.source, checksum: manifest.integrity.checksum,
      integrity: 'VERIFIED', disposition, dependencies: freeze(dependencies), parameters: manifest.parameters,
      graphSummary: freeze({ nodes: manifest.graph?.nodes.length ?? 0, edges: manifest.graph?.edges.length ?? 0, actions: freeze(actions) }),
      timeframeMappings: manifest.timeframeMappings, evidencePolicy: manifest.evidencePolicy,
      deploymentModes: freeze([...manifest.deploymentRestrictions.allowedModes]), preferredImportMode: 'OBSERVE',
      warnings: freeze(warnings), errors: freeze(errors),
    }) });
  }

  importValidated(manifest: StrategyPackageManifest, filename: string, expectedChecksum: string, allowUpgrade: boolean, importedAt = new Date().toISOString()): StrategyPackageImportResult {
    const revalidated = this.preview(JSON.stringify(manifest), filename);
    if (!revalidated.manifest || !revalidated.preview.valid) throw new Error(revalidated.preview.errors.join(' '));
    if (manifest.integrity.checksum !== expectedChecksum) throw new Error('Package changed after preview');
    if (revalidated.preview.disposition === 'IDENTICAL') {
      const row = this.byIdentityVersion(manifest.packageId, manifest.version)!;
      return this.result(row, 'ALREADY_IMPORTED');
    }
    if (revalidated.preview.disposition === 'UPGRADE' && !allowUpgrade) throw new Error('Package upgrade requires explicit confirmation');
    if (!['NEW','UPGRADE'].includes(revalidated.preview.disposition ?? '')) throw new Error(`Package cannot be imported: ${revalidated.preview.disposition}`);

    const priorRows = this.byIdentity(manifest.packageId);
    const prior = latest(priorRows);
    const stable = shortHash(manifest.packageId);
    const semantic = manifest.version.replace(/[^A-Za-z0-9_.-]/g, '-');
    let definitionId: string | null = prior?.definitionId ?? null;
    let definitionVersionId: string | null = null;
    let mapId: string | null = prior?.mapId ?? null;
    let mapVersionId: string | null = null;

    this.db.transaction((tx) => {
      if (manifest.packageType === 'STRATEGY') {
        definitionId ??= `pkg-sd:${stable}`;
        definitionVersionId = `pkg-sv:${stable}:${semantic}`;
        const detector = manifest.definition!.detector === null ? null : JSON.stringify({
          ...manifest.definition!.detector,
          parameterSchema: Object.fromEntries(manifest.parameters.map((parameter) => [parameter.key, parameter])),
        });
        if (!prior) {
          tx.insert(strategyDefinitions).values({ id: definitionId, currentVersionId: definitionVersionId, createdAt: importedAt, archivedAt: null }).run();
          tx.insert(strategyVersions).values({ id: definitionVersionId, strategyDefinitionId: definitionId, versionNo: 1, name: manifest.name, category: manifest.definition!.category, description: manifest.description, tagsJson: JSON.stringify(manifest.definition!.tags), automationCapability: manifest.definition!.automationCapability, detectorJson: detector, deploymentStatus: 'EXPERIMENTAL', createdAt: importedAt, supersedesStrategyVersionId: null }).run();
        } else {
          const head = tx.select().from(strategyVersions).where(eq(strategyVersions.strategyDefinitionId, definitionId)).orderBy(desc(strategyVersions.versionNo)).limit(1).all()[0];
          if (!head) throw new Error('Imported Strategy history head is missing');
          tx.insert(strategyVersions).values({ id: definitionVersionId, strategyDefinitionId: definitionId, versionNo: head.versionNo + 1, name: manifest.name, category: manifest.definition!.category, description: manifest.description, tagsJson: JSON.stringify(manifest.definition!.tags), automationCapability: manifest.definition!.automationCapability, detectorJson: detector, deploymentStatus: 'EXPERIMENTAL', createdAt: importedAt, supersedesStrategyVersionId: head.id }).run();
          tx.update(strategyDefinitions).set({ currentVersionId: definitionVersionId }).where(eq(strategyDefinitions.id, definitionId)).run();
        }
      }

      if (manifest.graph) {
        mapId ??= `pkg-sm:${stable}`;
        mapVersionId = `pkg-smv:${stable}:${semantic}`;
        const graph = reconstructPackageGraph(manifest.graph, (ref) => {
          if (ref.packageId === manifest.packageId && manifest.packageType === 'STRATEGY') return definitionVersionId!;
          const row = this.resolveImportedDependency('STRATEGY', ref.packageId, ref.versionRange);
          if (!row?.definitionVersionId) throw new Error(`Graph strategy dependency ${ref.packageId} is unresolved`);
          return row.definitionVersionId;
        });
        if (!prior?.mapId) {
          tx.insert(strategyMaps).values({ id: mapId, kind: manifest.packageType === 'COMBO' ? 'COMBO' : manifest.packageType === 'TEMPLATE' ? 'TEMPLATE' : 'STRATEGY_MAP', name: manifest.packageType === 'STRATEGY' ? `${manifest.name} Graph` : manifest.name, currentVersionId: mapVersionId, createdAt: importedAt, archivedAt: null }).run();
          tx.insert(strategyMapVersions).values({ id: mapVersionId, strategyMapId: mapId, versionNo: 1, graphJson: JSON.stringify(graph), createdAt: importedAt, supersedesStrategyMapVersionId: null }).run();
        } else {
          const head = tx.select().from(strategyMapVersions).where(eq(strategyMapVersions.strategyMapId, mapId)).orderBy(desc(strategyMapVersions.versionNo)).limit(1).all()[0];
          if (!head) throw new Error('Imported Strategy Map history head is missing');
          tx.insert(strategyMapVersions).values({ id: mapVersionId, strategyMapId: mapId, versionNo: head.versionNo + 1, graphJson: JSON.stringify(graph), createdAt: importedAt, supersedesStrategyMapVersionId: head.id }).run();
          tx.update(strategyMaps).set({ currentVersionId: mapVersionId }).where(eq(strategyMaps.id, mapId)).run();
        }
      }

      tx.insert(strategyPackageImports).values({
        id: `pkg-import:${randomUUID()}`, packageId: manifest.packageId, packageType: manifest.packageType,
        packageVersion: manifest.version, checksum: manifest.integrity.checksum, importedAt,
        sourceJson: JSON.stringify(manifest.author), originatingFilename: filename,
        definitionId, definitionVersionId, mapId, mapVersionId,
        dependencyStateJson: JSON.stringify(revalidated.preview.dependencies), manifestJson: JSON.stringify(manifest),
      }).run();
    });
    return freeze({ status:'IMPORTED', packageId:manifest.packageId, packageType:manifest.packageType, packageVersion:manifest.version, checksum:manifest.integrity.checksum, definitionId, definitionVersionId, mapId, mapVersionId });
  }

  exportDefinition(definitionId: string): StrategyPackageManifest {
    const definition = this.db.select().from(strategyDefinitions).where(eq(strategyDefinitions.id, definitionId)).limit(1).all()[0];
    if (!definition) throw new Error(`StrategyDefinition ${definitionId} not found`);
    const version = this.db.select().from(strategyVersions).where(eq(strategyVersions.id, definition.currentVersionId)).limit(1).all()[0]!;
    const imported = this.db.select().from(strategyPackageImports).where(eq(strategyPackageImports.definitionVersionId, version.id)).limit(1).all()[0];
    if (imported) return parseStrategyPackageText(imported.manifestJson);
    const detector = version.detectorJson ? JSON.parse(version.detectorJson) as NonNullable<NonNullable<StrategyPackageManifest['definition']>['detector']> & {parameterSchema?:Record<string,unknown>} : null;
    const manifest = this.baseExport({ packageType:'STRATEGY', packageId:`arise.strategy.${definition.id}`, name:version.name, description:version.description, version:`1.0.${version.versionNo-1}`, createdAt:version.createdAt });
    return withPackageChecksum({ ...manifest, dependencies:{...manifest.dependencies,detectors:detector?[{id:detector.key,versionRange:detector.version,required:true}]:[]}, definition:{category:version.category,tags:JSON.parse(version.tagsJson) as string[],automationCapability:version.automationCapability,detector:detector?{key:detector.key,version:detector.version,evaluationMode:detector.evaluationMode as never}:null} });
  }

  exportMap(mapId: string): StrategyPackageManifest {
    const map = this.db.select().from(strategyMaps).where(eq(strategyMaps.id, mapId)).limit(1).all()[0];
    if (!map) throw new Error(`StrategyMap ${mapId} not found`);
    const version = this.db.select().from(strategyMapVersions).where(eq(strategyMapVersions.id, map.currentVersionId)).limit(1).all()[0]!;
    const imported = this.db.select().from(strategyPackageImports).where(eq(strategyPackageImports.mapVersionId, version.id)).limit(1).all()[0];
    if (imported) return parseStrategyPackageText(imported.manifestJson);
    const graph = JSON.parse(version.graphJson) as LogicGraphShape;
    const dependencyByPackage = new Map<string, StrategyPackageDependency>();
    const portable: PortableStrategyGraph = { nodes: graph.nodes.map((node) => {
      if (node.family !== 'STRATEGY') return node as unknown as PortableStrategyGraph['nodes'][number];
      const strategyVersionId = node.strategyVersionId;
      if (typeof strategyVersionId !== 'string') throw new Error('Strategy graph node is missing strategyVersionId');
      const strategyVersion = this.db.select().from(strategyVersions).where(eq(strategyVersions.id, strategyVersionId)).limit(1).all()[0];
      if (!strategyVersion) throw new Error(`StrategyVersion ${node.strategyVersionId} is missing`);
      const packageRow = this.db.select().from(strategyPackageImports).where(eq(strategyPackageImports.definitionVersionId, strategyVersion.id)).limit(1).all()[0];
      const packageId = packageRow?.packageId ?? `arise.strategy.${strategyVersion.strategyDefinitionId}`;
      const packageVersion = packageRow?.packageVersion ?? `1.0.${strategyVersion.versionNo-1}`;
      dependencyByPackage.set(packageId, {id:packageId,versionRange:packageVersion,required:true});
      const rest = { ...node };
      delete rest.strategyVersionId;
      return { ...rest, family:'STRATEGY', strategyRef:{packageId,versionRange:packageVersion} } as PortableStrategyGraph['nodes'][number];
    }), edges:graph.edges };
    const type = map.kind === 'COMBO' ? 'COMBO' : 'TEMPLATE';
    const manifest = this.baseExport({packageType:type,packageId:`arise.${type.toLowerCase()}.${map.id}`,name:map.name,description:`Exported ARISE ${map.kind.replaceAll('_',' ').toLowerCase()}.`,version:`1.0.${version.versionNo-1}`,createdAt:version.createdAt});
    return withPackageChecksum({...manifest,dependencies:{...manifest.dependencies,strategies:[...dependencyByPackage.values()]},graph:portable,definition:null,template:type==='TEMPLATE'?{attemptBudget:{},stackingPolicy:{mode:'MANUAL'},protectionPolicyReferences:[],colonyConfiguration:{}}:null});
  }

  listImports(): readonly ImportRow[] { return freeze(this.db.select().from(strategyPackageImports).orderBy(asc(strategyPackageImports.importedAt)).all()); }

  private emptyPreview(filename:string,errors:readonly string[]):StrategyPackagePreview{return freeze({valid:false,filename,packageId:null,packageType:null,name:null,description:null,version:null,author:null,source:null,checksum:null,integrity:'FAILED',disposition:null,dependencies:freeze([]),parameters:freeze([]),graphSummary:freeze({nodes:0,edges:0,actions:freeze([])}),timeframeMappings:freeze([]),evidencePolicy:null,deploymentModes:freeze([]),preferredImportMode:'OBSERVE',warnings:freeze([]),errors:freeze([...errors])});}
  private byIdentity(packageId:string):readonly ImportRow[]{return this.db.select().from(strategyPackageImports).where(eq(strategyPackageImports.packageId,packageId)).all();}
  private byIdentityVersion(packageId:string,version:string):ImportRow|null{return this.db.select().from(strategyPackageImports).where(and(eq(strategyPackageImports.packageId,packageId),eq(strategyPackageImports.packageVersion,version))).limit(1).all()[0]??null;}
  private disposition(manifest:StrategyPackageManifest,errors:string[]):StrategyPackageDisposition{const rows=this.byIdentity(manifest.packageId);if(!rows.length)return 'NEW';if(rows.some((row)=>row.packageType!==manifest.packageType)){errors.push('Package identity is already used by a different package type.');return 'CONFLICT';}const same=rows.find((row)=>row.packageVersion===manifest.version);if(same){if(same.checksum===manifest.integrity.checksum)return 'IDENTICAL';errors.push('Same package identity/version has different content.');return 'CONFLICT';}const head=latest(rows)!;if(compareSemanticVersions(manifest.version,head.packageVersion)>0)return 'UPGRADE';errors.push(`Package version ${manifest.version} is older than imported ${head.packageVersion}.`);return 'OLDER';}
  private resolveImportedDependency(type:'STRATEGY'|'COMBO',id:string,range:string):ImportRow|null{return latest(this.byIdentity(id).filter((row)=>row.packageType===type&&semanticVersionSatisfies(row.packageVersion,range)));}
  private dependencyViews(manifest:StrategyPackageManifest):StrategyPackageDependencyView[]{const result:StrategyPackageDependencyView[]=[];for(const item of manifest.dependencies.detectors){const found=this.detectorVersions.get(item.id)??null;result.push(freeze({kind:'DETECTOR',id:item.id,versionRange:item.versionRange,installedVersion:found,required:item.required,status:found===null?'MISSING':semanticVersionSatisfies(found.includes('.')?found:`${found}.0.0`,item.versionRange.includes('.')?item.versionRange:item.versionRange.replace(/(\d+)$/, '$1.0.0'))?'SATISFIED':'INCOMPATIBLE_VERSION'}));}for(const [kind,items] of [['STRATEGY',manifest.dependencies.strategies],['COMBO',manifest.dependencies.combos]] as const){for(const item of items){const row=this.resolveImportedDependency(kind,item.id,item.versionRange);const any=latest(this.byIdentity(item.id).filter((candidate)=>candidate.packageType===kind));result.push(freeze({kind,id:item.id,versionRange:item.versionRange,installedVersion:row?.packageVersion??any?.packageVersion??null,required:item.required,status:row?'SATISFIED':any?'INCOMPATIBLE_VERSION':'MISSING'}));}}for(const capability of manifest.capabilityRequirements)result.push(freeze({kind:'CAPABILITY',id:capability,versionRange:'built-in',installedVersion:this.trust.capabilities.has(capability)?'built-in':null,required:true,status:this.trust.capabilities.has(capability)?'SATISFIED':'UNSUPPORTED_CAPABILITY'}));return result;}
  private hasCircularDependency(candidate:StrategyPackageManifest):boolean{const manifests=new Map<string,StrategyPackageManifest>();for(const row of this.listImports()){try{const item=parseStrategyPackageText(row.manifestJson);const current=manifests.get(item.packageId);if(!current||compareSemanticVersions(item.version,current.version)>0)manifests.set(item.packageId,item);}catch{/* Existing corrupt provenance fails dependency resolution elsewhere without executing data. */}}manifests.set(candidate.packageId,candidate);const visiting=new Set<string>();const visited=new Set<string>();const walk=(id:string):boolean=>{if(visiting.has(id))return true;if(visited.has(id))return false;visiting.add(id);const item=manifests.get(id);for(const dependency of [...(item?.dependencies.strategies??[]),...(item?.dependencies.combos??[])])if(manifests.has(dependency.id)&&walk(dependency.id))return true;visiting.delete(id);visited.add(id);return false;};return walk(candidate.packageId);}
  private result(row:ImportRow,status:StrategyPackageImportResult['status']):StrategyPackageImportResult{return freeze({status,packageId:row.packageId,packageType:row.packageType,packageVersion:row.packageVersion,checksum:row.checksum,definitionId:row.definitionId,definitionVersionId:row.definitionVersionId,mapId:row.mapId,mapVersionId:row.mapVersionId});}
  private baseExport(input:{packageType:StrategyPackageManifest['packageType'];packageId:string;name:string;description:string;version:string;createdAt:string}):Omit<StrategyPackageManifest,'integrity'|'definition'>{return {schemaVersion:1,...input,author:{name:'ARISE',source:'ARISE Strategy Export',url:null},minimumAriseVersion:'1.0.0-beta.2',capabilityRequirements:['strategy-graph','timeframe-purpose','evidence','decision-trace','observe'],dependencies:{detectors:[],strategies:[],combos:[]},parameters:[],graph:null,timeframeMappings:[],evidencePolicy:{profile:'STRATEGY_EVIDENCE_AND_ENTRY',events:['CONFIRMATION','ENTRY'],references:['CANDLE','DECISION_TRACE','RUNTIME_NODE_EVENT','ENTRY_SNAPSHOT']},deploymentRestrictions:{allowedModes:['OBSERVE','SHADOW','DEMO'],preferredMode:'OBSERVE'},template:null};}
}

interface LogicGraphShape { readonly nodes: readonly (Record<string,unknown>&{family:string;strategyVersionId?:string})[]; readonly edges: readonly {id:string;sourceNodeId:string;targetNodeId:string;sourcePort:string;targetPort:string}[] }
