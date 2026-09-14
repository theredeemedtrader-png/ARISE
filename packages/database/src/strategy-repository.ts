import { asc, desc, eq } from 'drizzle-orm';
import {
  createStrategyDefinitionWithInitialVersion,
  createStrategyMapWithInitialVersion,
  createStrategyVersion,
  reviseStrategyDefinition,
  reviseStrategyMap,
  strategyDefinitionId,
  strategyMapId,
  strategyMapVersionId,
  strategyVersionId,
  validateLogicGraph,
  type DetectorContractRef,
  type LogicGraph,
  type StrategyDefinition,
  type StrategyMap,
  type StrategyMapKind,
  type StrategyMapVersion,
  type StrategyVersion,
} from '@arise/strategy-engine';
import type { AriseDatabase } from './database';
import { PersistenceConflictError, PersistenceNotFoundError } from './errors';
import { strategyDefinitions, strategyMapVersions, strategyMaps, strategyVersions } from './schema';

function hydrateDefinition(row: typeof strategyDefinitions.$inferSelect): StrategyDefinition {
  return Object.freeze({
    id: strategyDefinitionId(row.id),
    currentVersionId: strategyVersionId(row.currentVersionId),
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  });
}
function hydrateVersion(row: typeof strategyVersions.$inferSelect): StrategyVersion {
  return createStrategyVersion({
    id: strategyVersionId(row.id),
    strategyDefinitionId: strategyDefinitionId(row.strategyDefinitionId),
    versionNo: row.versionNo,
    name: row.name,
    category: row.category,
    description: row.description,
    tags: JSON.parse(row.tagsJson) as string[],
    automationCapability: row.automationCapability,
    detector: row.detectorJson === null ? null : JSON.parse(row.detectorJson) as DetectorContractRef,
    deploymentStatus: row.deploymentStatus,
    createdAt: row.createdAt,
    supersedesStrategyVersionId: row.supersedesStrategyVersionId === null ? null : strategyVersionId(row.supersedesStrategyVersionId),
  });
}
function hydrateMap(row: typeof strategyMaps.$inferSelect): StrategyMap {
  return Object.freeze({
    id: strategyMapId(row.id), kind: row.kind, name: row.name,
    currentVersionId: strategyMapVersionId(row.currentVersionId), createdAt: row.createdAt, archivedAt: row.archivedAt,
  });
}
function hydrateMapVersion(row: typeof strategyMapVersions.$inferSelect): StrategyMapVersion {
  return Object.freeze({
    id: strategyMapVersionId(row.id), strategyMapId: strategyMapId(row.strategyMapId), versionNo: row.versionNo,
    graph: validateLogicGraph(JSON.parse(row.graphJson) as LogicGraph), createdAt: row.createdAt,
    supersedesStrategyMapVersionId: row.supersedesStrategyMapVersionId === null ? null : strategyMapVersionId(row.supersedesStrategyMapVersionId),
  });
}

export interface StrategyDefinitionAggregate {
  readonly definition: StrategyDefinition;
  readonly currentVersion: StrategyVersion;
  readonly versions: readonly StrategyVersion[];
}
export interface StrategyMapAggregate {
  readonly map: StrategyMap;
  readonly currentVersion: StrategyMapVersion;
  readonly versions: readonly StrategyMapVersion[];
}

export class StrategyRepository {
  constructor(private readonly db: AriseDatabase) {}

  createDefinition(input: Parameters<typeof createStrategyDefinitionWithInitialVersion>[0]): StrategyDefinitionAggregate {
    const initial = createStrategyDefinitionWithInitialVersion(input);
    this.db.transaction((tx) => {
      tx.insert(strategyDefinitions).values({ id: initial.definition.id, currentVersionId: initial.definition.currentVersionId, createdAt: initial.definition.createdAt, archivedAt: null }).run();
      tx.insert(strategyVersions).values({
        id: initial.version.id, strategyDefinitionId: initial.version.strategyDefinitionId, versionNo: 1, name: initial.version.name,
        category: initial.version.category, description: initial.version.description, tagsJson: JSON.stringify(initial.version.tags),
        automationCapability: initial.version.automationCapability, detectorJson: initial.version.detector === null ? null : JSON.stringify(initial.version.detector), deploymentStatus: initial.version.deploymentStatus,
        createdAt: initial.version.createdAt, supersedesStrategyVersionId: null,
      }).run();
    });
    return this.reconstructDefinition(initial.definition.id)!;
  }

  reviseDefinition(id: ReturnType<typeof strategyDefinitionId>, input: Parameters<typeof reviseStrategyDefinition>[2]): StrategyDefinitionAggregate {
    const aggregate = this.reconstructDefinition(id);
    if (!aggregate) throw new PersistenceNotFoundError('StrategyDefinition', id);
    const next = reviseStrategyDefinition(aggregate.definition, aggregate.currentVersion, input);
    this.db.transaction((tx) => {
      const head = tx.select().from(strategyVersions).where(eq(strategyVersions.strategyDefinitionId, id)).orderBy(desc(strategyVersions.versionNo)).limit(1).all()[0];
      if (!head || head.id !== aggregate.currentVersion.id) throw new PersistenceConflictError('Strategy definition changed concurrently');
      tx.insert(strategyVersions).values({
        id: next.version.id, strategyDefinitionId: next.version.strategyDefinitionId, versionNo: next.version.versionNo, name: next.version.name,
        category: next.version.category, description: next.version.description, tagsJson: JSON.stringify(next.version.tags),
        automationCapability: next.version.automationCapability, detectorJson: next.version.detector === null ? null : JSON.stringify(next.version.detector), deploymentStatus: next.version.deploymentStatus,
        createdAt: next.version.createdAt, supersedesStrategyVersionId: next.version.supersedesStrategyVersionId,
      }).run();
      const updated = tx.update(strategyDefinitions).set({ currentVersionId: next.version.id }).where(eq(strategyDefinitions.id, id)).run();
      if (updated.changes !== 1) throw new PersistenceConflictError('Strategy definition changed concurrently');
    });
    return this.reconstructDefinition(id)!;
  }

  listDefinitions(): readonly StrategyDefinitionAggregate[] {
    const rows = this.db.select().from(strategyDefinitions).orderBy(asc(strategyDefinitions.createdAt), asc(strategyDefinitions.id)).all();
    return Object.freeze(rows.map((row) => this.reconstructDefinition(strategyDefinitionId(row.id))!));
  }

  reconstructDefinition(id: ReturnType<typeof strategyDefinitionId>): StrategyDefinitionAggregate | null {
    const row = this.db.select().from(strategyDefinitions).where(eq(strategyDefinitions.id, id)).limit(1).all()[0];
    if (!row) return null;
    const definition = hydrateDefinition(row);
    const versions = this.db.select().from(strategyVersions).where(eq(strategyVersions.strategyDefinitionId, id)).orderBy(asc(strategyVersions.versionNo)).all().map(hydrateVersion);
    const currentVersion = versions.find((version) => version.id === definition.currentVersionId);
    if (!currentVersion) throw new PersistenceConflictError('Strategy definition current version is missing');
    return Object.freeze({ definition, currentVersion, versions: Object.freeze(versions) });
  }

  createMap(input: Parameters<typeof createStrategyMapWithInitialVersion>[0]): StrategyMapAggregate {
    const initial = createStrategyMapWithInitialVersion(input);
    this.db.transaction((tx) => {
      tx.insert(strategyMaps).values({ id: initial.map.id, kind: initial.map.kind, name: initial.map.name, currentVersionId: initial.map.currentVersionId, createdAt: initial.map.createdAt, archivedAt: null }).run();
      tx.insert(strategyMapVersions).values({ id: initial.version.id, strategyMapId: initial.version.strategyMapId, versionNo: 1, graphJson: JSON.stringify(initial.version.graph), createdAt: initial.version.createdAt, supersedesStrategyMapVersionId: null }).run();
    });
    return this.reconstructMap(initial.map.id)!;
  }

  reviseMap(id: ReturnType<typeof strategyMapId>, input: Parameters<typeof reviseStrategyMap>[2]): StrategyMapAggregate {
    const aggregate = this.reconstructMap(id);
    if (!aggregate) throw new PersistenceNotFoundError('StrategyMap', id);
    const next = reviseStrategyMap(aggregate.map, aggregate.currentVersion, input);
    this.db.transaction((tx) => {
      const head = tx.select().from(strategyMapVersions).where(eq(strategyMapVersions.strategyMapId, id)).orderBy(desc(strategyMapVersions.versionNo)).limit(1).all()[0];
      if (!head || head.id !== aggregate.currentVersion.id) throw new PersistenceConflictError('Strategy map changed concurrently');
      tx.insert(strategyMapVersions).values({ id: next.version.id, strategyMapId: next.version.strategyMapId, versionNo: next.version.versionNo, graphJson: JSON.stringify(next.version.graph), createdAt: next.version.createdAt, supersedesStrategyMapVersionId: next.version.supersedesStrategyMapVersionId }).run();
      const updated = tx.update(strategyMaps).set({ currentVersionId: next.version.id }).where(eq(strategyMaps.id, id)).run();
      if (updated.changes !== 1) throw new PersistenceConflictError('Strategy map changed concurrently');
    });
    return this.reconstructMap(id)!;
  }

  listMaps(kind?: StrategyMapKind): readonly StrategyMapAggregate[] {
    const rows = kind === undefined
      ? this.db.select().from(strategyMaps).orderBy(asc(strategyMaps.createdAt), asc(strategyMaps.id)).all()
      : this.db.select().from(strategyMaps).where(eq(strategyMaps.kind, kind)).orderBy(asc(strategyMaps.createdAt), asc(strategyMaps.id)).all();
    return Object.freeze(rows.map((row) => this.reconstructMap(strategyMapId(row.id))!));
  }

  reconstructMap(id: ReturnType<typeof strategyMapId>): StrategyMapAggregate | null {
    const row = this.db.select().from(strategyMaps).where(eq(strategyMaps.id, id)).limit(1).all()[0];
    if (!row) return null;
    const map = hydrateMap(row);
    const versions = this.db.select().from(strategyMapVersions).where(eq(strategyMapVersions.strategyMapId, id)).orderBy(asc(strategyMapVersions.versionNo)).all().map(hydrateMapVersion);
    const currentVersion = versions.find((version) => version.id === map.currentVersionId);
    if (!currentVersion) throw new PersistenceConflictError('Strategy map current version is missing');
    return Object.freeze({ map, currentVersion, versions: Object.freeze(versions) });
  }
}
