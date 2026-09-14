import { and, asc, eq } from 'drizzle-orm';
import {
  createTargetEvent,
  transitionTarget,
  validateTarget,
  type ColonyId,
  type Target,
  type TargetEvent,
  type TargetId,
} from '@arise/domain';
import { boolToInt, hydrateTarget, hydrateTargetEvent } from './codec';
import type { AriseDatabase } from './database';
import { PersistenceConflictError, PersistenceNotFoundError } from './errors';
import { colonies, targetEvents, targets } from './schema';

export interface TargetAggregate {
  readonly target: Target;
  readonly events: readonly TargetEvent[];
}

export class TargetRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: Target): Target {
    validateTarget(input);
    if (!this.db.select({ id: colonies.id }).from(colonies).where(eq(colonies.id, input.colonyId)).limit(1).all()[0])
      throw new PersistenceNotFoundError('Colony', input.colonyId);
    this.db.insert(targets).values({
      id: input.id,
      colonyId: input.colonyId,
      targetType: input.targetType,
      exactPrice: input.exactPrice,
      zoneMarketObjectId: input.zoneMarketObjectId,
      managementMode: input.managementMode,
      status: input.status,
      createdAt: input.createdAt,
    }).run();
    return input;
  }

  findById(id: TargetId): Target | null {
    const row = this.db.select().from(targets).where(eq(targets.id, id)).limit(1).all()[0];
    return row ? hydrateTarget(row) : null;
  }

  listByColony(colonyId: ColonyId): readonly Target[] {
    return Object.freeze(this.db.select().from(targets).where(eq(targets.colonyId, colonyId))
      .orderBy(asc(targets.createdAt), asc(targets.id)).all().map(hydrateTarget));
  }

  transition(eventInput: TargetEvent): Target {
    const event = createTargetEvent(eventInput);
    let next!: Target;
    this.db.transaction((tx) => {
      const row = tx.select().from(targets).where(eq(targets.id, event.targetId)).limit(1).all()[0];
      if (!row) throw new PersistenceNotFoundError('Target', event.targetId);
      const current = hydrateTarget(row);
      if (current.status !== event.fromStatus)
        throw new PersistenceConflictError(`Target stale state: expected ${event.fromStatus}, found ${current.status}`);
      next = transitionTarget(current, event.toStatus, event).target;
      const updated = tx.update(targets).set({ status: next.status })
        .where(and(eq(targets.id, current.id), eq(targets.status, event.fromStatus))).run();
      if (updated.changes !== 1) throw new PersistenceConflictError('Target changed concurrently');
      tx.insert(targetEvents).values({
        id: event.id,
        targetId: event.targetId,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        eventType: event.eventType,
        reason: event.reason,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        occurredAt: event.occurredAt,
        manualOverride: boolToInt(event.manualOverride),
        correlationId: event.correlationId,
      }).run();
    });
    return next;
  }

  listEvents(targetId: TargetId): readonly TargetEvent[] {
    return Object.freeze(this.db.select().from(targetEvents).where(eq(targetEvents.targetId, targetId))
      .orderBy(asc(targetEvents.occurredAt), asc(targetEvents.id)).all().map(hydrateTargetEvent));
  }

  reconstruct(id: TargetId): TargetAggregate | null {
    const target = this.findById(id);
    if (!target) return null;
    return Object.freeze({ target, events: this.listEvents(id) });
  }
}
