import {
  createMarketObjectWithInitialVersion,
  entityId,
  timestamp,
  type InstrumentId,
  type MarketObjectId,
  type MarketObjectJson,
  type TimeframeId,
} from '@arise/domain';
import type {
  LegStructureResult,
  NestedLegStructureResult,
  StructureLeg,
  StructureSwing,
} from '@arise/strategy-engine';
import { MarketObjectRepository } from './market-object-repository';

const STRUCTURE_PERSISTENCE_VERSION = 1;

export interface StructurePersistenceSummary {
  readonly insertedObjects: number;
  readonly existingObjects: number;
  readonly insertedRelations: number;
  readonly objectIds: readonly MarketObjectId[];
}

function objectId(structureId: string): MarketObjectId {
  return entityId('MarketObject', `si${STRUCTURE_PERSISTENCE_VERSION}:${structureId}`);
}

function versionId(id: MarketObjectId) {
  return entityId('MarketObjectVersion', `${id}:v1`);
}

function second(value: string): number {
  return Math.floor(Date.parse(value) / 1000);
}

function relationId(source: MarketObjectId, type: string, target: MarketObjectId) {
  return entityId('MarketObjectRelation', `si${STRUCTURE_PERSISTENCE_VERSION}:${type}:${source}:${target}`);
}

/** Only facts fixed at swing confirmation belong in immutable v1 payload. */
function swingProperties(swing: StructureSwing): MarketObjectJson {
  return {
    intelligenceSchema: 1,
    persistenceSchema: STRUCTURE_PERSISTENCE_VERSION,
    source: 'DETECTOR',
    detectorKey: 'leg_structure',
    lifecycle: 'CONFIRMED',
    direction: 'NEUTRAL',
    degree: swing.degree,
    structureId: swing.id,
    swingKind: swing.kind,
    classification: swing.classification,
    wickExtreme: swing.wickExtreme,
    closeExtreme: swing.closeExtreme,
    pivotAt: swing.pivotAt,
    structuralCloseAt: swing.structuralCloseAt,
    confirmedAt: swing.confirmedAt,
    precedingLegId: swing.precedingLegId,
  };
}

/** Parent/child membership is stored as relations because it may become known later. */
function legProperties(leg: StructureLeg): MarketObjectJson {
  return {
    intelligenceSchema: 1,
    persistenceSchema: STRUCTURE_PERSISTENCE_VERSION,
    source: 'DETECTOR',
    detectorKey: 'leg_structure',
    lifecycle: 'CONFIRMED',
    direction: leg.direction,
    degree: leg.degree,
    structureId: leg.id,
    startedAt: leg.startedAt,
    endedAt: leg.endedAt,
    confirmedAt: leg.confirmedAt,
    startClose: leg.startClose,
    endClose: leg.endClose,
    wickExtreme: leg.wickExtreme,
    startSwingId: leg.startSwingId,
    endSwingId: leg.endSwingId,
  };
}

function allResults(analysis: NestedLegStructureResult): readonly LegStructureResult[] {
  return [analysis.EXTERIOR, analysis.INTERIOR, analysis.MICRO];
}

export class StructureMarketObjectRepository {
  constructor(private readonly objects: MarketObjectRepository) {}

  persist(input: {
    readonly instrumentId: InstrumentId;
    readonly timeframeId: TimeframeId;
    readonly analysis: NestedLegStructureResult;
  }): StructurePersistenceSummary {
    let insertedObjects = 0;
    let existingObjects = 0;
    let insertedRelations = 0;
    const ids: MarketObjectId[] = [];

    for (const result of allResults(input.analysis)) {
      for (const leg of result.legs) {
        const id = objectId(leg.id);
        ids.push(id);
        if (this.objects.findById(id)) {
          existingObjects += 1;
          continue;
        }
        const createdAt = timestamp(new Date(leg.confirmedAt).toISOString());
        this.objects.insertInitial(createMarketObjectWithInitialVersion({
          id,
          instrumentId: input.instrumentId,
          ownerType: 'STRATEGY_INTELLIGENCE',
          ownerId: input.instrumentId,
          geometryType: 'TRENDLINE',
          semanticType: 'STRUCTURE_LEG',
          role: 'REFERENCE',
          timeframeId: input.timeframeId,
          name: `${result.degree} ${leg.direction} LEG`,
          createdAt,
          archivedAt: null,
          versionId: versionId(id),
          geometryJson: {
            kind: 'TRENDLINE',
            start: { time: second(leg.startedAt), price: leg.startClose },
            end: { time: second(leg.endedAt), price: leg.endClose },
          },
          semanticPropertiesJson: legProperties(leg),
          sourceCandleIds: [],
        }));
        insertedObjects += 1;
      }
      for (const swing of result.swings) {
        const id = objectId(swing.id);
        ids.push(id);
        if (this.objects.findById(id)) {
          existingObjects += 1;
          continue;
        }
        const createdAt = timestamp(new Date(swing.confirmedAt).toISOString());
        this.objects.insertInitial(createMarketObjectWithInitialVersion({
          id,
          instrumentId: input.instrumentId,
          ownerType: 'STRATEGY_INTELLIGENCE',
          ownerId: input.instrumentId,
          geometryType: 'POINT',
          semanticType: 'STRUCTURE_SWING',
          role: 'CONFIRMATION',
          timeframeId: input.timeframeId,
          name: `${result.degree} SWING ${swing.kind}${swing.classification ? ` ${swing.classification}` : ''}`,
          createdAt,
          archivedAt: null,
          versionId: versionId(id),
          geometryJson: {
            kind: 'POINT',
            point: { time: second(swing.pivotAt), price: swing.wickExtreme },
          },
          semanticPropertiesJson: swingProperties(swing),
          sourceCandleIds: [],
        }));
        insertedObjects += 1;
      }
    }

    const ensureRelation = (
      sourceStructureId: string,
      relationType: 'PARENT_OF' | 'CONTAINS',
      targetStructureId: string,
      occurredAt: string,
    ) => {
      const source = objectId(sourceStructureId);
      const target = objectId(targetStructureId);
      if (!this.objects.findById(source) || !this.objects.findById(target)) return;
      const exists = this.objects.listRelations(source).some((relation) =>
        relation.sourceMarketObjectId === source &&
        relation.targetMarketObjectId === target &&
        relation.relationType === relationType,
      );
      if (exists) return;
      this.objects.addRelation({
        id: relationId(source, relationType, target),
        sourceMarketObjectId: source,
        targetMarketObjectId: target,
        relationType,
        createdAt: timestamp(new Date(occurredAt).toISOString()),
      });
      insertedRelations += 1;
    };

    for (const result of allResults(input.analysis)) {
      for (const leg of result.legs) {
        if (leg.parentLegId)
          ensureRelation(leg.parentLegId, 'PARENT_OF', leg.id, leg.confirmedAt);
      }
      for (const swing of result.swings) {
        if (swing.parentSwingId)
          ensureRelation(swing.parentSwingId, 'PARENT_OF', swing.id, swing.confirmedAt);
        if (swing.parentLegId)
          ensureRelation(swing.parentLegId, 'CONTAINS', swing.id, swing.confirmedAt);
      }
    }

    return Object.freeze({
      insertedObjects,
      existingObjects,
      insertedRelations,
      objectIds: Object.freeze(ids),
    });
  }
}
