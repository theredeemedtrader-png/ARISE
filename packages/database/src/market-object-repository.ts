import { and, asc, eq, or } from 'drizzle-orm';
import {
  createMarketObject,
  createMarketObjectReference,
  createMarketObjectRelation,
  createMarketObjectVersion,
  resolveMarketObjectReference,
  validateMarketObjectVersionLink,
  type InstrumentId,
  type MarketObject,
  type MarketObjectId,
  type MarketObjectReference,
  type MarketObjectRelation,
  type MarketObjectVersion,
  type MarketObjectVersionId,
  type MarketObjectWithVersion,
} from '@arise/domain';
import {
  encodeJson,
  hydrateMarketObject,
  hydrateMarketObjectRelation,
  hydrateMarketObjectVersion,
} from './codec';
import type { AriseDatabase } from './database';
import { PersistenceConflictError, PersistenceIntegrityError, PersistenceNotFoundError } from './errors';
import { marketObjectRelations, marketObjects, marketObjectVersions } from './schema';

export interface MarketObjectAggregate {
  readonly marketObject: MarketObject;
  readonly versions: readonly MarketObjectVersion[];
  readonly relations: readonly MarketObjectRelation[];
}

function versionValues(version: MarketObjectVersion) {
  return {
    id: version.id,
    marketObjectId: version.marketObjectId,
    versionNo: version.versionNo,
    geometryType: version.geometryType,
    semanticType: version.semanticType,
    role: version.role,
    timeframeId: version.timeframeId,
    name: version.name,
    geometryJson: encodeJson(version.geometryJson),
    semanticPropertiesJson: encodeJson(version.semanticPropertiesJson),
    sourceCandleIdsJson: encodeJson(version.sourceCandleIds),
    createdAt: version.createdAt,
    supersedesVersionId: version.supersedesVersionId,
  };
}

export class MarketObjectRepository {
  constructor(private readonly db: AriseDatabase) {}

  private hydrateChecked(row: Parameters<typeof hydrateMarketObject>[0]): MarketObject {
    const marketObject = hydrateMarketObject(row);
    const versionRow = this.db.select().from(marketObjectVersions)
      .where(eq(marketObjectVersions.id, marketObject.currentVersionId)).limit(1).all()[0];
    if (!versionRow) throw new PersistenceIntegrityError('Market Object current version is missing');
    validateMarketObjectVersionLink(marketObject, hydrateMarketObjectVersion(versionRow));
    return marketObject;
  }

  insertInitial(input: MarketObjectWithVersion): MarketObjectWithVersion {
    const marketObject = createMarketObject(input.marketObject);
    const version = createMarketObjectVersion(input.version);
    validateMarketObjectVersionLink(marketObject, version);
    if (version.versionNo !== 1 || version.supersedesVersionId !== null || marketObject.currentVersionId !== version.id)
      throw new PersistenceIntegrityError('Initial Market Object must point to its v1');

    this.db.transaction((tx) => {
      tx.insert(marketObjects).values({
        id: marketObject.id,
        instrumentId: marketObject.instrumentId,
        ownerType: marketObject.ownerType,
        ownerId: marketObject.ownerId,
        geometryType: marketObject.geometryType,
        semanticType: marketObject.semanticType,
        role: marketObject.role,
        timeframeId: marketObject.timeframeId,
        name: marketObject.name,
        currentVersionId: marketObject.currentVersionId,
        createdAt: marketObject.createdAt,
        archivedAt: marketObject.archivedAt,
      }).run();
      tx.insert(marketObjectVersions).values(versionValues(version)).run();
    });
    return Object.freeze({ marketObject, version });
  }

  appendRevision(input: MarketObjectWithVersion): MarketObjectWithVersion {
    const nextObject = createMarketObject(input.marketObject);
    const nextVersion = createMarketObjectVersion(input.version);
    validateMarketObjectVersionLink(nextObject, nextVersion);

    this.db.transaction((tx) => {
      const currentRow = tx.select().from(marketObjects).where(eq(marketObjects.id, nextObject.id)).limit(1).all()[0];
      if (!currentRow) throw new PersistenceNotFoundError('MarketObject', nextObject.id);
      const current = hydrateMarketObject(currentRow);
      const headRow = tx.select().from(marketObjectVersions)
        .where(eq(marketObjectVersions.id, current.currentVersionId)).limit(1).all()[0];
      if (!headRow) throw new PersistenceIntegrityError('Market Object current version is missing');
      const head = hydrateMarketObjectVersion(headRow);

      if (
        nextObject.instrumentId !== current.instrumentId ||
        nextObject.ownerType !== current.ownerType ||
        nextObject.ownerId !== current.ownerId ||
        nextObject.createdAt !== current.createdAt ||
        nextObject.archivedAt !== current.archivedAt
      ) throw new PersistenceIntegrityError('Market Object stable identity/archive fields cannot change in a revision');
      if (
        nextVersion.marketObjectId !== current.id ||
        nextVersion.versionNo !== head.versionNo + 1 ||
        nextVersion.supersedesVersionId !== head.id ||
        nextObject.currentVersionId !== nextVersion.id ||
        nextVersion.createdAt < head.createdAt
      ) throw new PersistenceConflictError('Market Object revision must extend the current persisted head');

      tx.insert(marketObjectVersions).values(versionValues(nextVersion)).run();
      const updated = tx.update(marketObjects).set({
        geometryType: nextObject.geometryType,
        semanticType: nextObject.semanticType,
        role: nextObject.role,
        timeframeId: nextObject.timeframeId,
        name: nextObject.name,
        currentVersionId: nextObject.currentVersionId,
      }).where(and(eq(marketObjects.id, current.id), eq(marketObjects.currentVersionId, current.currentVersionId))).run();
      if (updated.changes !== 1) throw new PersistenceConflictError('Market Object changed concurrently');
    });
    return Object.freeze({ marketObject: nextObject, version: nextVersion });
  }

  findById(id: MarketObjectId): MarketObject | null {
    const row = this.db.select().from(marketObjects).where(eq(marketObjects.id, id)).limit(1).all()[0];
    return row ? this.hydrateChecked(row) : null;
  }

  listByInstrument(instrumentId: InstrumentId): readonly MarketObject[] {
    return Object.freeze(this.db.select().from(marketObjects)
      .where(eq(marketObjects.instrumentId, instrumentId))
      .orderBy(asc(marketObjects.createdAt), asc(marketObjects.id)).all().map((row) => this.hydrateChecked(row)));
  }

  findVersionById(id: MarketObjectVersionId): MarketObjectVersion | null {
    const row = this.db.select().from(marketObjectVersions).where(eq(marketObjectVersions.id, id)).limit(1).all()[0];
    return row ? hydrateMarketObjectVersion(row) : null;
  }

  listVersions(id: MarketObjectId): readonly MarketObjectVersion[] {
    return Object.freeze(this.db.select().from(marketObjectVersions)
      .where(eq(marketObjectVersions.marketObjectId, id))
      .orderBy(asc(marketObjectVersions.versionNo)).all().map(hydrateMarketObjectVersion));
  }

  resolve(referenceInput: MarketObjectReference): MarketObjectVersion {
    const reference = createMarketObjectReference(referenceInput);
    const marketObject = this.findById(reference.marketObjectId);
    if (!marketObject) throw new PersistenceNotFoundError('MarketObject', reference.marketObjectId);
    return resolveMarketObjectReference(reference, marketObject, this.listVersions(marketObject.id));
  }

  addRelation(input: MarketObjectRelation): MarketObjectRelation {
    const value = createMarketObjectRelation(input);
    this.db.insert(marketObjectRelations).values({
      id: value.id,
      sourceMarketObjectId: value.sourceMarketObjectId,
      targetMarketObjectId: value.targetMarketObjectId,
      relationType: value.relationType,
      createdAt: value.createdAt,
    }).run();
    return value;
  }

  listRelations(id: MarketObjectId): readonly MarketObjectRelation[] {
    return Object.freeze(this.db.select().from(marketObjectRelations)
      .where(or(eq(marketObjectRelations.sourceMarketObjectId, id), eq(marketObjectRelations.targetMarketObjectId, id)))
      .orderBy(asc(marketObjectRelations.createdAt), asc(marketObjectRelations.id)).all().map(hydrateMarketObjectRelation));
  }

  reconstruct(id: MarketObjectId): MarketObjectAggregate | null {
    const marketObject = this.findById(id);
    if (!marketObject) return null;
    return Object.freeze({
      marketObject,
      versions: this.listVersions(id),
      relations: this.listRelations(id),
    });
  }
}
