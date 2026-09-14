import { asc, eq } from 'drizzle-orm';
import {
  createTimeframeProjection,
  validateProjectionParent,
  type ColonyId,
  type TimeframeProjection,
  type TimeframeProjectionId,
} from '@arise/domain';
import { hydrateTimeframeProjection } from './codec';
import type { AriseDatabase } from './database';
import { PersistenceNotFoundError } from './errors';
import { timeframeProjections } from './schema';

export class TimeframeProjectionRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: TimeframeProjection): TimeframeProjection {
    const value = createTimeframeProjection(input);
    if (value.parentProjectionId !== null) {
      const parent = this.findById(value.parentProjectionId);
      if (!parent) throw new PersistenceNotFoundError('TimeframeProjection', value.parentProjectionId);
      validateProjectionParent(value, parent);
    }
    this.db.insert(timeframeProjections).values({
      id: value.id,
      sourceEntityType: value.sourceEntityType,
      sourceEntityId: value.sourceEntityId,
      sourceTimeframeId: value.sourceTimeframeId,
      targetTimeframeId: value.targetTimeframeId,
      intervalStart: value.intervalStart,
      intervalEnd: value.intervalEnd,
      sourceHigh: value.sourceHigh,
      sourceLow: value.sourceLow,
      colonyId: value.colonyId,
      parentProjectionId: value.parentProjectionId,
      createdAt: value.createdAt,
    }).run();
    return value;
  }

  findById(id: TimeframeProjectionId): TimeframeProjection | null {
    const row = this.db.select().from(timeframeProjections)
      .where(eq(timeframeProjections.id, id)).limit(1).all()[0];
    return row ? hydrateTimeframeProjection(row) : null;
  }

  listByColony(colonyId: ColonyId): readonly TimeframeProjection[] {
    return Object.freeze(this.db.select().from(timeframeProjections)
      .where(eq(timeframeProjections.colonyId, colonyId))
      .orderBy(asc(timeframeProjections.intervalStart), asc(timeframeProjections.id))
      .all().map(hydrateTimeframeProjection));
  }

  children(parentId: TimeframeProjectionId): readonly TimeframeProjection[] {
    return Object.freeze(this.db.select().from(timeframeProjections)
      .where(eq(timeframeProjections.parentProjectionId, parentId))
      .orderBy(asc(timeframeProjections.intervalStart), asc(timeframeProjections.id))
      .all().map(hydrateTimeframeProjection));
  }

  pathToRoot(id: TimeframeProjectionId): readonly TimeframeProjection[] {
    const path: TimeframeProjection[] = [];
    const seen = new Set<string>();
    let current = this.findById(id);
    if (!current) throw new PersistenceNotFoundError('TimeframeProjection', id);
    while (current) {
      if (seen.has(current.id)) throw new Error('Persisted projection cycle detected');
      seen.add(current.id);
      path.push(current);
      if (current.parentProjectionId === null) break;
      current = this.findById(current.parentProjectionId);
      if (!current) throw new PersistenceNotFoundError('TimeframeProjection parent', path.at(-1)!.parentProjectionId!);
    }
    return Object.freeze(path.reverse());
  }
}
