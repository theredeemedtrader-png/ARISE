import { and, asc, eq, or } from 'drizzle-orm';
import {
  createColonyLineage,
  createColonyStateEvent,
  transitionColony,
  validateColony,
  type Colony,
  type ColonyId,
  type ColonyLineage,
  type ColonyStateEvent,
  type IdeaId,
} from '@arise/domain';
import { boolToInt, hydrateColony, hydrateColonyLineage, hydrateColonyStateEvent } from './codec';
import type { AriseDatabase } from './database';
import { PersistenceConflictError, PersistenceIntegrityError, PersistenceNotFoundError } from './errors';
import { colonies, colonyLineage, colonyStateEvents, ideaVersions, ideas } from './schema';

export interface ColonyAggregate {
  readonly colony: Colony;
  readonly stateEvents: readonly ColonyStateEvent[];
  readonly lineage: readonly ColonyLineage[];
}

export class ColonyRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: Colony): Colony {
    validateColony(input);
    const idea = this.db.select().from(ideas).where(eq(ideas.id, input.ideaId)).limit(1).all()[0];
    if (!idea) throw new PersistenceNotFoundError('Idea', input.ideaId);
    const original = this.db.select().from(ideaVersions)
      .where(eq(ideaVersions.id, input.originalIdeaVersionId)).limit(1).all()[0];
    if (!original) throw new PersistenceNotFoundError('IdeaVersion', input.originalIdeaVersionId);
    if (original.ideaId !== input.ideaId || idea.instrumentId !== input.instrumentId)
      throw new PersistenceIntegrityError('Colony Idea/version/instrument relationship mismatch');

    this.db.insert(colonies).values({
      id: input.id,
      ideaId: input.ideaId,
      originalIdeaVersionId: input.originalIdeaVersionId,
      instrumentId: input.instrumentId,
      label: input.label,
      currentState: input.currentState,
      currentTargetId: input.currentTargetId,
      createdAt: input.createdAt,
      completedAt: input.completedAt,
    }).run();
    return input;
  }

  findById(id: ColonyId): Colony | null {
    const row = this.db.select().from(colonies).where(eq(colonies.id, id)).limit(1).all()[0];
    return row ? hydrateColony(row) : null;
  }

  listByIdea(ideaId: IdeaId): readonly Colony[] {
    return Object.freeze(this.db.select().from(colonies).where(eq(colonies.ideaId, ideaId))
      .orderBy(asc(colonies.createdAt), asc(colonies.id)).all().map(hydrateColony));
  }

  transition(eventInput: ColonyStateEvent): Colony {
    const event = createColonyStateEvent(eventInput);
    let next!: Colony;
    this.db.transaction((tx) => {
      const row = tx.select().from(colonies).where(eq(colonies.id, event.colonyId)).limit(1).all()[0];
      if (!row) throw new PersistenceNotFoundError('Colony', event.colonyId);
      const current = hydrateColony(row);
      if (current.currentState !== event.fromState)
        throw new PersistenceConflictError(`Colony stale state: expected ${event.fromState}, found ${current.currentState}`);
      next = transitionColony(current, event.toState, event).colony;
      const updated = tx.update(colonies).set({
        currentState: next.currentState,
        completedAt: next.completedAt,
      }).where(and(eq(colonies.id, current.id), eq(colonies.currentState, event.fromState))).run();
      if (updated.changes !== 1) throw new PersistenceConflictError('Colony changed concurrently');
      tx.insert(colonyStateEvents).values({
        id: event.id,
        colonyId: event.colonyId,
        fromState: event.fromState,
        toState: event.toState,
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

  addLineage(input: ColonyLineage): ColonyLineage {
    const value = createColonyLineage(input);
    this.db.insert(colonyLineage).values({
      id: value.id,
      sourceColonyId: value.sourceColonyId,
      targetColonyId: value.targetColonyId,
      relationshipType: value.relationshipType,
    }).run();
    return value;
  }

  listEvents(colonyId: ColonyId): readonly ColonyStateEvent[] {
    return Object.freeze(this.db.select().from(colonyStateEvents)
      .where(eq(colonyStateEvents.colonyId, colonyId))
      .orderBy(asc(colonyStateEvents.occurredAt), asc(colonyStateEvents.id))
      .all().map(hydrateColonyStateEvent));
  }

  listLineage(colonyId: ColonyId): readonly ColonyLineage[] {
    return Object.freeze(this.db.select().from(colonyLineage)
      .where(or(eq(colonyLineage.sourceColonyId, colonyId), eq(colonyLineage.targetColonyId, colonyId)))
      .orderBy(asc(colonyLineage.id)).all().map(hydrateColonyLineage));
  }

  reconstruct(id: ColonyId): ColonyAggregate | null {
    const colony = this.findById(id);
    if (!colony) return null;
    return Object.freeze({ colony, stateEvents: this.listEvents(id), lineage: this.listLineage(id) });
  }
}
