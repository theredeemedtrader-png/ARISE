import { and, asc, desc, eq } from 'drizzle-orm';
import {
  createColony,
  createIdea,
  createIdeaVersion,
  createSuccessorIdeaVersion,
  entityId,
  timestamp,
  transitionIdea,
  type ColonyState,
  type Direction,
  type IdeaId,
  type IdeaStatus,
} from '@arise/domain';
import {
  blockId,
  createDocumentWithInitialVersion,
  createEntityLink,
  createSuccessorDocumentVersion,
  documentId,
  documentVersionId,
  entityLinkId,
  type DocumentBlock,
  type DocumentContent,
} from '@arise/documents';
import type { AriseDatabase } from './database';
import { hydrateColony, hydrateIdea, hydrateIdeaVersion } from './codec';
import { PersistenceConflictError, PersistenceNotFoundError } from './errors';
import { blocks, colonies, documentVersions, documents, entityLinks, ideaVersions, ideas, instruments, timeframes } from './schema';

export interface PlanningIdeaView {
  readonly ideaId: string;
  readonly ideaVersionId: string;
  readonly versionNo: number;
  readonly colonyId: string;
  readonly colonyLabel: string;
  readonly colonyState: ColonyState;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly timeframeId: string;
  readonly timeframe: string;
  readonly status: IdeaStatus;
  readonly direction: Direction;
  readonly thesisText: string;
  readonly targetDescription: string;
  readonly invalidationDescription: string;
  readonly primaryTargetMarketObjectVersionId: string | null;
  readonly invalidationMarketObjectVersionId: string | null;
  readonly thesisDocumentId: string;
  readonly thesisDocumentVersionId: string;
  readonly thesisBlocks: readonly DocumentBlock[];
  readonly createdAt: string;
}

export interface CreatePlanningIdeaInput {
  readonly ideaId: string;
  readonly ideaVersionId: string;
  readonly colonyId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly blockId: string;
  readonly entityLinkId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly direction: Direction;
  readonly thesisText: string;
  readonly targetDescription: string;
  readonly invalidationDescription: string;
  readonly primaryTargetMarketObjectVersionId: string | null;
  readonly invalidationMarketObjectVersionId: string | null;
  readonly colonyLabel: string;
  readonly createdAt: string;
}

export interface UpdatePlanningThesisInput {
  readonly ideaId: string;
  readonly ideaVersionId: string;
  readonly documentVersionId: string;
  readonly entityLinkId: string;
  readonly direction: Direction;
  readonly thesisText: string;
  readonly targetDescription: string;
  readonly invalidationDescription: string;
  readonly primaryTargetMarketObjectVersionId: string | null;
  readonly invalidationMarketObjectVersionId: string | null;
  readonly thesisBlocks: DocumentContent;
  readonly createdAt: string;
}

export class PlanningRepository {
  constructor(private readonly db: AriseDatabase) {}

  create(input: CreatePlanningIdeaInput): PlanningIdeaView {
    const instrumentRow = this.db.select().from(instruments).where(eq(instruments.id, input.instrumentId)).limit(1).all()[0];
    const timeframeRow = this.db.select().from(timeframes).where(eq(timeframes.id, input.timeframeId)).limit(1).all()[0];
    if (!instrumentRow) throw new PersistenceNotFoundError('Instrument', input.instrumentId);
    if (!timeframeRow) throw new PersistenceNotFoundError('Timeframe', input.timeframeId);
    const createdAt = timestamp(input.createdAt);
    const idea = createIdea({
      id: entityId('Idea', input.ideaId),
      instrumentId: entityId('Instrument', input.instrumentId),
      thesisTimeframeId: entityId('Timeframe', input.timeframeId),
      createdAt,
    });
    const version = createIdeaVersion(idea, {
      id: entityId('IdeaVersion', input.ideaVersionId), createdAt, direction: input.direction,
      thesisText: input.thesisText, targetDescription: input.targetDescription, invalidationDescription: input.invalidationDescription,
      primaryTargetMarketObjectVersionId: input.primaryTargetMarketObjectVersionId === null ? null : entityId('MarketObjectVersion', input.primaryTargetMarketObjectVersionId),
      invalidationMarketObjectVersionId: input.invalidationMarketObjectVersionId === null ? null : entityId('MarketObjectVersion', input.invalidationMarketObjectVersionId),
    });
    const colony = createColony({ id: entityId('Colony', input.colonyId), idea, originalIdeaVersion: version, label: input.colonyLabel, createdAt });
    const thesisDocument = createDocumentWithInitialVersion({
      document: {
        id: documentId(input.documentId), documentType: 'THESIS', title: `${instrumentRow.canonicalSymbol} ${timeframeRow.code} Thesis`,
        primaryFolderId: null, linkedEntityType: 'IDEA', linkedEntityId: idea.id, createdAt,
      },
      versionId: documentVersionId(input.documentVersionId),
      content: { blocks: [{ id: blockId(input.blockId), type: 'PARAGRAPH', text: input.thesisText }] },
    });
    const link = createEntityLink({
      id: entityLinkId(input.entityLinkId), sourceType: 'DOCUMENT_VERSION', sourceId: thesisDocument.version.id,
      targetType: 'IDEA_VERSION', targetId: version.id, relationType: 'THESIS_SNAPSHOT', createdAt,
    });

    this.db.transaction((tx) => {
      tx.insert(ideas).values({ id: idea.id, instrumentId: idea.instrumentId, thesisTimeframeId: idea.thesisTimeframeId, currentStatus: idea.currentStatus, createdAt: idea.createdAt, archivedAt: idea.archivedAt }).run();
      tx.insert(ideaVersions).values({
        id: version.id, ideaId: version.ideaId, versionNo: version.versionNo, direction: version.direction, thesisText: version.thesisText,
        targetDescription: version.targetDescription, invalidationDescription: version.invalidationDescription,
        primaryTargetMarketObjectVersionId: version.primaryTargetMarketObjectVersionId, invalidationMarketObjectVersionId: version.invalidationMarketObjectVersionId,
        createdAt: version.createdAt, supersedesIdeaVersionId: version.supersedesIdeaVersionId,
      }).run();
      tx.insert(colonies).values({ id: colony.id, ideaId: colony.ideaId, originalIdeaVersionId: colony.originalIdeaVersionId, instrumentId: colony.instrumentId, label: colony.label, currentState: colony.currentState, currentTargetId: colony.currentTargetId, createdAt: colony.createdAt, completedAt: colony.completedAt }).run();
      tx.insert(documents).values({
        id: thesisDocument.document.id, documentType: thesisDocument.document.documentType, title: thesisDocument.document.title,
        currentVersionId: thesisDocument.document.currentVersionId, primaryFolderId: thesisDocument.document.primaryFolderId,
        linkedEntityType: thesisDocument.document.linkedEntityType, linkedEntityId: thesisDocument.document.linkedEntityId,
        createdAt: thesisDocument.document.createdAt, archivedAt: thesisDocument.document.archivedAt,
      }).run();
      for (const b of thesisDocument.blocks) tx.insert(blocks).values({ id: b.id, documentId: b.documentId, createdAt: b.createdAt }).run();
      tx.insert(documentVersions).values({ id: thesisDocument.version.id, documentId: thesisDocument.version.documentId, versionNo: 1, contentJson: JSON.stringify(thesisDocument.version.content), createdAt: thesisDocument.version.createdAt, supersedesDocumentVersionId: null }).run();
      tx.insert(entityLinks).values(link).run();
    });
    return this.findById(idea.id)!;
  }

  updateThesis(input: UpdatePlanningThesisInput): PlanningIdeaView {
    const id = entityId('Idea', input.ideaId);
    const currentIdea = this.db.select().from(ideas).where(eq(ideas.id, id)).limit(1).all()[0];
    if (!currentIdea) throw new PersistenceNotFoundError('Idea', id);
    const headRow = this.db.select().from(ideaVersions).where(eq(ideaVersions.ideaId, id)).orderBy(desc(ideaVersions.versionNo)).limit(1).all()[0];
    if (!headRow) throw new PersistenceNotFoundError('IdeaVersion', input.ideaVersionId);
    const previous = hydrateIdeaVersion(headRow);
    const currentDocumentRow = this.db.select().from(documents).where(and(eq(documents.linkedEntityType, 'IDEA'), eq(documents.linkedEntityId, id), eq(documents.documentType, 'THESIS'))).limit(1).all()[0];
    if (!currentDocumentRow) throw new PersistenceNotFoundError('Thesis Document', id);
    const previousDocumentVersionRow = this.db.select().from(documentVersions).where(eq(documentVersions.id, currentDocumentRow.currentVersionId)).limit(1).all()[0];
    if (!previousDocumentVersionRow) throw new PersistenceNotFoundError('DocumentVersion', currentDocumentRow.currentVersionId);
    const previousDocumentVersion = Object.freeze({
      id: documentVersionId(previousDocumentVersionRow.id), documentId: documentId(previousDocumentVersionRow.documentId), versionNo: previousDocumentVersionRow.versionNo,
      content: JSON.parse(previousDocumentVersionRow.contentJson) as DocumentContent, createdAt: previousDocumentVersionRow.createdAt,
      supersedesDocumentVersionId: previousDocumentVersionRow.supersedesDocumentVersionId === null ? null : documentVersionId(previousDocumentVersionRow.supersedesDocumentVersionId),
    });
    const createdAt = timestamp(input.createdAt);
    const nextVersion = createSuccessorIdeaVersion(previous, {
      id: entityId('IdeaVersion', input.ideaVersionId), createdAt, direction: input.direction, thesisText: input.thesisText,
      targetDescription: input.targetDescription, invalidationDescription: input.invalidationDescription,
      primaryTargetMarketObjectVersionId: input.primaryTargetMarketObjectVersionId === null ? null : entityId('MarketObjectVersion', input.primaryTargetMarketObjectVersionId),
      invalidationMarketObjectVersionId: input.invalidationMarketObjectVersionId === null ? null : entityId('MarketObjectVersion', input.invalidationMarketObjectVersionId),
    });
    const nextDocumentVersion = createSuccessorDocumentVersion(previousDocumentVersion, { id: documentVersionId(input.documentVersionId), content: input.thesisBlocks, createdAt });
    const link = createEntityLink({ id: entityLinkId(input.entityLinkId), sourceType: 'DOCUMENT_VERSION', sourceId: nextDocumentVersion.id, targetType: 'IDEA_VERSION', targetId: nextVersion.id, relationType: 'THESIS_SNAPSHOT', createdAt });

    this.db.transaction((tx) => {
      const head = tx.select().from(ideaVersions).where(eq(ideaVersions.ideaId, id)).orderBy(desc(ideaVersions.versionNo)).limit(1).all()[0];
      if (!head || head.id !== previous.id) throw new PersistenceConflictError('IdeaVersion changed concurrently');
      tx.insert(ideaVersions).values({
        id: nextVersion.id, ideaId: nextVersion.ideaId, versionNo: nextVersion.versionNo, direction: nextVersion.direction, thesisText: nextVersion.thesisText,
        targetDescription: nextVersion.targetDescription, invalidationDescription: nextVersion.invalidationDescription,
        primaryTargetMarketObjectVersionId: nextVersion.primaryTargetMarketObjectVersionId, invalidationMarketObjectVersionId: nextVersion.invalidationMarketObjectVersionId,
        createdAt: nextVersion.createdAt, supersedesIdeaVersionId: nextVersion.supersedesIdeaVersionId,
      }).run();
      const knownBlocks = new Set(tx.select().from(blocks).where(eq(blocks.documentId, currentDocumentRow.id)).all().map((row) => row.id));
      for (const b of nextDocumentVersion.content.blocks) if (!knownBlocks.has(b.id)) tx.insert(blocks).values({ id: b.id, documentId: currentDocumentRow.id, createdAt: nextDocumentVersion.createdAt }).run();
      tx.insert(documentVersions).values({ id: nextDocumentVersion.id, documentId: nextDocumentVersion.documentId, versionNo: nextDocumentVersion.versionNo, contentJson: JSON.stringify(nextDocumentVersion.content), createdAt: nextDocumentVersion.createdAt, supersedesDocumentVersionId: nextDocumentVersion.supersedesDocumentVersionId }).run();
      const updated = tx.update(documents).set({ currentVersionId: nextDocumentVersion.id }).where(and(eq(documents.id, currentDocumentRow.id), eq(documents.currentVersionId, previousDocumentVersion.id))).run();
      if (updated.changes !== 1) throw new PersistenceConflictError('Thesis Document changed concurrently');
      tx.insert(entityLinks).values(link).run();
    });
    return this.findById(id)!;
  }

  transitionStatus(ideaIdValue: string, to: IdeaStatus, occurredAtValue: string): PlanningIdeaView {
    const id = entityId('Idea', ideaIdValue);
    const row = this.db.select().from(ideas).where(eq(ideas.id, id)).limit(1).all()[0];
    if (!row) throw new PersistenceNotFoundError('Idea', id);
    const current = hydrateIdea(row);
    const next = transitionIdea(current, to, timestamp(occurredAtValue));
    const updated = this.db.update(ideas).set({ currentStatus: next.currentStatus, archivedAt: next.archivedAt }).where(and(eq(ideas.id, id), eq(ideas.currentStatus, current.currentStatus))).run();
    if (updated.changes !== 1) throw new PersistenceConflictError('Idea changed concurrently');
    return this.findById(id)!;
  }

  findById(id: IdeaId): PlanningIdeaView | null {
    const ideaRow = this.db.select().from(ideas).where(eq(ideas.id, id)).limit(1).all()[0];
    if (!ideaRow) return null;
    const versionRow = this.db.select().from(ideaVersions).where(eq(ideaVersions.ideaId, id)).orderBy(desc(ideaVersions.versionNo)).limit(1).all()[0];
    const colonyRow = this.db.select().from(colonies).where(eq(colonies.ideaId, id)).orderBy(asc(colonies.createdAt)).limit(1).all()[0];
    const instrumentRow = this.db.select().from(instruments).where(eq(instruments.id, ideaRow.instrumentId)).limit(1).all()[0];
    const timeframeRow = this.db.select().from(timeframes).where(eq(timeframes.id, ideaRow.thesisTimeframeId)).limit(1).all()[0];
    const documentRow = this.db.select().from(documents).where(and(eq(documents.linkedEntityType, 'IDEA'), eq(documents.linkedEntityId, id), eq(documents.documentType, 'THESIS'))).limit(1).all()[0];
    if (!versionRow || !colonyRow || !instrumentRow || !timeframeRow || !documentRow) throw new PersistenceConflictError(`Planning Idea ${id} is incomplete`);
    const docVersionRow = this.db.select().from(documentVersions).where(eq(documentVersions.id, documentRow.currentVersionId)).limit(1).all()[0];
    if (!docVersionRow) throw new PersistenceConflictError(`Planning Idea ${id} thesis document head missing`);
    const version = hydrateIdeaVersion(versionRow);
    const colony = hydrateColony(colonyRow);
    const content = JSON.parse(docVersionRow.contentJson) as DocumentContent;
    return Object.freeze({
      ideaId: ideaRow.id, ideaVersionId: version.id, versionNo: version.versionNo, colonyId: colony.id, colonyLabel: colony.label, colonyState: colony.currentState,
      instrumentId: instrumentRow.id, symbol: instrumentRow.canonicalSymbol, timeframeId: timeframeRow.id, timeframe: timeframeRow.code,
      status: ideaRow.currentStatus, direction: version.direction, thesisText: version.thesisText, targetDescription: version.targetDescription,
      invalidationDescription: version.invalidationDescription, primaryTargetMarketObjectVersionId: version.primaryTargetMarketObjectVersionId,
      invalidationMarketObjectVersionId: version.invalidationMarketObjectVersionId, thesisDocumentId: documentRow.id,
      thesisDocumentVersionId: docVersionRow.id, thesisBlocks: Object.freeze(content.blocks.map((b) => Object.freeze({ ...b }))), createdAt: ideaRow.createdAt,
    });
  }

  list(): readonly PlanningIdeaView[] {
    return Object.freeze(this.db.select().from(ideas).orderBy(desc(ideas.createdAt), desc(ideas.id)).all().map((row) => this.findById(entityId('Idea', row.id))!));
  }
}
