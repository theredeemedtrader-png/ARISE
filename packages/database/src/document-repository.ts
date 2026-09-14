import { and, asc, desc, eq, or } from 'drizzle-orm';
import {
  blockId,
  createDocumentWithInitialVersion,
  createEntityLink,
  createFolder,
  createSuccessorDocumentVersion,
  documentId,
  documentVersionId,
  entityLinkId,
  folderId,
  freezeContent,
  type BlockIdentity,
  type Document,
  type DocumentContent,
  type DocumentId,
  type DocumentVersion,
  type EntityLink,
  type Folder,
} from '@arise/documents';
import type { AriseDatabase } from './database';
import { PersistenceConflictError, PersistenceNotFoundError } from './errors';
import { blocks, documentVersions, documents, entityLinks, folders } from './schema';

function hydrateDocument(row: typeof documents.$inferSelect): Document {
  return Object.freeze({
    id: documentId(row.id),
    documentType: row.documentType,
    title: row.title,
    currentVersionId: documentVersionId(row.currentVersionId),
    primaryFolderId: row.primaryFolderId === null ? null : folderId(row.primaryFolderId),
    linkedEntityType: row.linkedEntityType,
    linkedEntityId: row.linkedEntityId,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  });
}

function hydrateVersion(row: typeof documentVersions.$inferSelect): DocumentVersion {
  return Object.freeze({
    id: documentVersionId(row.id),
    documentId: documentId(row.documentId),
    versionNo: row.versionNo,
    content: freezeContent(JSON.parse(row.contentJson) as DocumentContent),
    createdAt: row.createdAt,
    supersedesDocumentVersionId: row.supersedesDocumentVersionId === null ? null : documentVersionId(row.supersedesDocumentVersionId),
  });
}

function hydrateFolder(row: typeof folders.$inferSelect): Folder {
  return createFolder({
    id: folderId(row.id),
    name: row.name,
    parentFolderId: row.parentFolderId === null ? null : folderId(row.parentFolderId),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  });
}

function hydrateLink(row: typeof entityLinks.$inferSelect): EntityLink {
  return createEntityLink({
    id: entityLinkId(row.id),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    targetType: row.targetType,
    targetId: row.targetId,
    relationType: row.relationType,
    createdAt: row.createdAt,
  });
}

export interface DocumentAggregate {
  readonly document: Document;
  readonly currentVersion: DocumentVersion;
  readonly versions: readonly DocumentVersion[];
  readonly blocks: readonly BlockIdentity[];
}

export class DocumentRepository {
  constructor(private readonly db: AriseDatabase) {}

  insertInitial(input: ReturnType<typeof createDocumentWithInitialVersion>): DocumentAggregate {
    this.db.transaction((tx) => {
      if (input.document.primaryFolderId !== null) {
        const folder = tx.select().from(folders).where(eq(folders.id, input.document.primaryFolderId)).limit(1).all()[0];
        if (!folder) throw new PersistenceNotFoundError('Folder', input.document.primaryFolderId);
      }
      tx.insert(documents).values({
        id: input.document.id,
        documentType: input.document.documentType,
        title: input.document.title,
        currentVersionId: input.document.currentVersionId,
        primaryFolderId: input.document.primaryFolderId,
        linkedEntityType: input.document.linkedEntityType,
        linkedEntityId: input.document.linkedEntityId,
        createdAt: input.document.createdAt,
        archivedAt: input.document.archivedAt,
      }).run();
      for (const block of input.blocks) {
        tx.insert(blocks).values({ id: block.id, documentId: block.documentId, createdAt: block.createdAt }).run();
      }
      tx.insert(documentVersions).values({
        id: input.version.id,
        documentId: input.version.documentId,
        versionNo: input.version.versionNo,
        contentJson: JSON.stringify(input.version.content),
        createdAt: input.version.createdAt,
        supersedesDocumentVersionId: input.version.supersedesDocumentVersionId,
      }).run();
    });
    return this.reconstruct(input.document.id)!;
  }

  create(input: Parameters<typeof createDocumentWithInitialVersion>[0]): DocumentAggregate {
    return this.insertInitial(createDocumentWithInitialVersion(input));
  }

  appendVersion(documentIdValue: DocumentId, input: { readonly id: ReturnType<typeof documentVersionId>; readonly content: DocumentContent; readonly createdAt: string }): DocumentVersion {
    let next!: DocumentVersion;
    this.db.transaction((tx) => {
      const documentRow = tx.select().from(documents).where(eq(documents.id, documentIdValue)).limit(1).all()[0];
      if (!documentRow) throw new PersistenceNotFoundError('Document', documentIdValue);
      const headRow = tx.select().from(documentVersions)
        .where(eq(documentVersions.documentId, documentIdValue))
        .orderBy(desc(documentVersions.versionNo))
        .limit(1).all()[0];
      if (!headRow) throw new PersistenceNotFoundError('DocumentVersion', documentRow.currentVersionId);
      const previous = hydrateVersion(headRow);
      if (documentRow.currentVersionId !== previous.id) throw new PersistenceConflictError('Document current version is not history head');
      next = createSuccessorDocumentVersion(previous, input);
      const knownBlockRows = tx.select().from(blocks).where(eq(blocks.documentId, documentIdValue)).all();
      const known = new Set(knownBlockRows.map((row) => row.id));
      for (const block of next.content.blocks) {
        if (!known.has(block.id)) tx.insert(blocks).values({ id: block.id, documentId: documentIdValue, createdAt: next.createdAt }).run();
      }
      tx.insert(documentVersions).values({
        id: next.id,
        documentId: next.documentId,
        versionNo: next.versionNo,
        contentJson: JSON.stringify(next.content),
        createdAt: next.createdAt,
        supersedesDocumentVersionId: next.supersedesDocumentVersionId,
      }).run();
      const updated = tx.update(documents).set({ currentVersionId: next.id }).where(and(eq(documents.id, documentIdValue), eq(documents.currentVersionId, previous.id))).run();
      if (updated.changes !== 1) throw new PersistenceConflictError('Document changed concurrently');
    });
    return next;
  }

  findById(id: DocumentId): Document | null {
    const row = this.db.select().from(documents).where(eq(documents.id, id)).limit(1).all()[0];
    return row ? hydrateDocument(row) : null;
  }

  list(): readonly Document[] {
    return Object.freeze(this.db.select().from(documents).orderBy(asc(documents.createdAt), asc(documents.id)).all().map(hydrateDocument));
  }

  listByLinkedEntity(entityType: string, entityIdValue: string): readonly Document[] {
    return Object.freeze(this.db.select().from(documents)
      .where(and(eq(documents.linkedEntityType, entityType), eq(documents.linkedEntityId, entityIdValue)))
      .orderBy(asc(documents.createdAt), asc(documents.id)).all().map(hydrateDocument));
  }

  currentVersion(id: DocumentId): DocumentVersion | null {
    const document = this.findById(id);
    if (!document) return null;
    const row = this.db.select().from(documentVersions).where(eq(documentVersions.id, document.currentVersionId)).limit(1).all()[0];
    return row ? hydrateVersion(row) : null;
  }

  listVersions(id: DocumentId): readonly DocumentVersion[] {
    return Object.freeze(this.db.select().from(documentVersions).where(eq(documentVersions.documentId, id))
      .orderBy(asc(documentVersions.versionNo)).all().map(hydrateVersion));
  }

  reconstruct(id: DocumentId): DocumentAggregate | null {
    const document = this.findById(id);
    if (!document) return null;
    const versions = this.listVersions(id);
    const currentVersion = versions.find((version) => version.id === document.currentVersionId);
    if (!currentVersion) throw new PersistenceConflictError('Document current version is missing');
    const blockRows = this.db.select().from(blocks).where(eq(blocks.documentId, id)).orderBy(asc(blocks.createdAt), asc(blocks.id)).all();
    return Object.freeze({
      document,
      currentVersion,
      versions,
      blocks: Object.freeze(blockRows.map((row) => Object.freeze({ id: blockId(row.id), documentId: documentId(row.documentId), createdAt: row.createdAt }))),
    });
  }

  insertFolder(input: Folder): Folder {
    const value = createFolder(input);
    if (value.parentFolderId !== null && !this.findFolder(value.parentFolderId)) throw new PersistenceNotFoundError('Folder', value.parentFolderId);
    this.db.insert(folders).values({ id: value.id, name: value.name, parentFolderId: value.parentFolderId, sortOrder: value.sortOrder, createdAt: value.createdAt }).run();
    return value;
  }

  findFolder(id: ReturnType<typeof folderId>): Folder | null {
    const row = this.db.select().from(folders).where(eq(folders.id, id)).limit(1).all()[0];
    return row ? hydrateFolder(row) : null;
  }

  listFolders(): readonly Folder[] {
    return Object.freeze(this.db.select().from(folders).orderBy(asc(folders.sortOrder), asc(folders.name)).all().map(hydrateFolder));
  }

  setPrimaryFolder(documentIdValue: DocumentId, folderIdValue: ReturnType<typeof folderId> | null): Document {
    const document = this.findById(documentIdValue);
    if (!document) throw new PersistenceNotFoundError('Document', documentIdValue);
    if (folderIdValue !== null && !this.findFolder(folderIdValue)) throw new PersistenceNotFoundError('Folder', folderIdValue);
    this.db.update(documents).set({ primaryFolderId: folderIdValue }).where(eq(documents.id, documentIdValue)).run();
    return this.findById(documentIdValue)!;
  }

  addLink(input: EntityLink): EntityLink {
    const value = createEntityLink(input);
    this.db.insert(entityLinks).values(value).run();
    return value;
  }

  listBacklinks(targetType: string, targetId: string): readonly EntityLink[] {
    return Object.freeze(this.db.select().from(entityLinks)
      .where(and(eq(entityLinks.targetType, targetType), eq(entityLinks.targetId, targetId)))
      .orderBy(asc(entityLinks.createdAt), asc(entityLinks.id)).all().map(hydrateLink));
  }

  listLinksFor(entityType: string, entityIdValue: string): readonly EntityLink[] {
    return Object.freeze(this.db.select().from(entityLinks)
      .where(or(
        and(eq(entityLinks.sourceType, entityType), eq(entityLinks.sourceId, entityIdValue)),
        and(eq(entityLinks.targetType, entityType), eq(entityLinks.targetId, entityIdValue)),
      )).orderBy(asc(entityLinks.createdAt), asc(entityLinks.id)).all().map(hydrateLink));
  }
}
