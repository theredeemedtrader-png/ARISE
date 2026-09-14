import { and, asc, desc, eq } from 'drizzle-orm';
import {
  IDEA_TRANSITIONS,
  requireTransition,
  validateIdea,
  validateIdeaVersion,
  type Idea,
  type IdeaId,
  type IdeaStatus,
  type IdeaVersion,
  type IdeaVersionId,
} from '@arise/domain';
import { hydrateIdea, hydrateIdeaVersion } from './codec';
import type { AriseDatabase } from './database';
import { PersistenceConflictError, PersistenceIntegrityError, PersistenceNotFoundError } from './errors';
import { ideaVersions, ideas } from './schema';

export interface IdeaAggregate {
  readonly idea: Idea;
  readonly versions: readonly IdeaVersion[];
}

export class CanonicalIdeaRepository {
  constructor(private readonly db: AriseDatabase) {}

  insert(input: Idea): Idea {
    validateIdea(input);
    this.db.insert(ideas).values({
      id: input.id,
      instrumentId: input.instrumentId,
      thesisTimeframeId: input.thesisTimeframeId,
      currentStatus: input.currentStatus,
      createdAt: input.createdAt,
      archivedAt: input.archivedAt,
    }).run();
    return input;
  }

  findById(id: IdeaId): Idea | null {
    const row = this.db.select().from(ideas).where(eq(ideas.id, id)).limit(1).all()[0];
    return row ? hydrateIdea(row) : null;
  }

  list(): readonly Idea[] {
    return Object.freeze(this.db.select().from(ideas).orderBy(asc(ideas.createdAt), asc(ideas.id)).all().map(hydrateIdea));
  }

  replaceCurrent(next: Idea, expectedStatus: IdeaStatus): Idea {
    validateIdea(next);
    const current = this.findById(next.id);
    if (!current) throw new PersistenceNotFoundError('Idea', next.id);
    if (current.currentStatus !== expectedStatus)
      throw new PersistenceConflictError(`Idea stale state: expected ${expectedStatus}, found ${current.currentStatus}`);
    requireTransition('Idea', IDEA_TRANSITIONS, current.currentStatus, next.currentStatus);
    if (
      current.instrumentId !== next.instrumentId ||
      current.thesisTimeframeId !== next.thesisTimeframeId ||
      current.createdAt !== next.createdAt
    ) throw new PersistenceIntegrityError('Idea immutable identity fields cannot change');

    const result = this.db.update(ideas).set({
      currentStatus: next.currentStatus,
      archivedAt: next.archivedAt,
    }).where(and(eq(ideas.id, next.id), eq(ideas.currentStatus, expectedStatus))).run();
    if (result.changes !== 1) throw new PersistenceConflictError('Idea changed concurrently');
    return next;
  }

  appendVersion(input: IdeaVersion): IdeaVersion {
    validateIdeaVersion(input);
    this.db.transaction((tx) => {
      const ideaRow = tx.select().from(ideas).where(eq(ideas.id, input.ideaId)).limit(1).all()[0];
      if (!ideaRow) throw new PersistenceNotFoundError('Idea', input.ideaId);
      const idea = hydrateIdea(ideaRow);
      if (input.createdAt < idea.createdAt)
        throw new PersistenceIntegrityError('IdeaVersion predates its Idea');

      const headRow = tx.select().from(ideaVersions)
        .where(eq(ideaVersions.ideaId, input.ideaId))
        .orderBy(desc(ideaVersions.versionNo))
        .limit(1)
        .all()[0];
      if (!headRow) {
        if (input.versionNo !== 1 || input.supersedesIdeaVersionId !== null)
          throw new PersistenceConflictError('First persisted IdeaVersion must be v1');
      } else {
        const head = hydrateIdeaVersion(headRow);
        if (input.versionNo !== head.versionNo + 1 || input.supersedesIdeaVersionId !== head.id)
          throw new PersistenceConflictError('IdeaVersion must extend the current persisted head');
        if (input.createdAt < head.createdAt)
          throw new PersistenceIntegrityError('IdeaVersion successor predates current head');
      }

      tx.insert(ideaVersions).values({
        id: input.id,
        ideaId: input.ideaId,
        versionNo: input.versionNo,
        direction: input.direction,
        thesisText: input.thesisText,
        targetDescription: input.targetDescription,
        invalidationDescription: input.invalidationDescription,
        primaryTargetMarketObjectVersionId: input.primaryTargetMarketObjectVersionId,
        invalidationMarketObjectVersionId: input.invalidationMarketObjectVersionId,
        createdAt: input.createdAt,
        supersedesIdeaVersionId: input.supersedesIdeaVersionId,
      }).run();
    });
    return input;
  }

  findVersionById(id: IdeaVersionId): IdeaVersion | null {
    const row = this.db.select().from(ideaVersions).where(eq(ideaVersions.id, id)).limit(1).all()[0];
    return row ? hydrateIdeaVersion(row) : null;
  }

  findVersion(ideaId: IdeaId, versionNo: number): IdeaVersion | null {
    const row = this.db.select().from(ideaVersions)
      .where(and(eq(ideaVersions.ideaId, ideaId), eq(ideaVersions.versionNo, versionNo)))
      .limit(1)
      .all()[0];
    return row ? hydrateIdeaVersion(row) : null;
  }

  currentVersion(ideaId: IdeaId): IdeaVersion | null {
    const row = this.db.select().from(ideaVersions)
      .where(eq(ideaVersions.ideaId, ideaId))
      .orderBy(desc(ideaVersions.versionNo))
      .limit(1)
      .all()[0];
    return row ? hydrateIdeaVersion(row) : null;
  }

  listVersions(ideaId: IdeaId): readonly IdeaVersion[] {
    return Object.freeze(this.db.select().from(ideaVersions)
      .where(eq(ideaVersions.ideaId, ideaId))
      .orderBy(asc(ideaVersions.versionNo))
      .all()
      .map(hydrateIdeaVersion));
  }

  reconstruct(id: IdeaId): IdeaAggregate | null {
    const idea = this.findById(id);
    if (!idea) return null;
    return Object.freeze({ idea, versions: this.listVersions(id) });
  }
}
