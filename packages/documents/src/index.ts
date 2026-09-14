export type DocumentId = string & { readonly __brand: 'DocumentId' };
export type DocumentVersionId = string & { readonly __brand: 'DocumentVersionId' };
export type BlockId = string & { readonly __brand: 'BlockId' };
export type FolderId = string & { readonly __brand: 'FolderId' };
export type FolderItemId = string & { readonly __brand: 'FolderItemId' };
export type EntityLinkId = string & { readonly __brand: 'EntityLinkId' };
export type TagId = string & { readonly __brand: 'TagId' };
export type TagAssignmentId = string & { readonly __brand: 'TagAssignmentId' };

export const DOCUMENT_TYPES = [
  'THESIS',
  'COLONY_NOTE',
  'POSITION_NOTE',
  'TRADE_REVIEW',
  'MARKET_REVIEW',
  'LESSON',
  'STRATEGY_ENCYCLOPEDIA',
  'RESEARCH',
  'NOTE',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const BLOCK_TYPES = [
  'PARAGRAPH',
  'HEADING_1',
  'HEADING_2',
  'BULLET',
  'QUOTE',
  'CALLOUT',
  'CHECKLIST',
  'CODE',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface DocumentBlock {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly text: string;
  readonly checked?: boolean;
}

export interface DocumentContent {
  readonly blocks: readonly DocumentBlock[];
}

export interface Document {
  readonly id: DocumentId;
  readonly documentType: DocumentType;
  readonly title: string;
  readonly currentVersionId: DocumentVersionId;
  readonly primaryFolderId: FolderId | null;
  readonly linkedEntityType: string | null;
  readonly linkedEntityId: string | null;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface DocumentVersion {
  readonly id: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly versionNo: number;
  readonly content: DocumentContent;
  readonly createdAt: string;
  readonly supersedesDocumentVersionId: DocumentVersionId | null;
}

export interface BlockIdentity {
  readonly id: BlockId;
  readonly documentId: DocumentId;
  readonly createdAt: string;
}

export interface Folder {
  readonly id: FolderId;
  readonly name: string;
  readonly parentFolderId: FolderId | null;
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface FolderItem {
  readonly id: FolderItemId;
  readonly folderId: FolderId;
  readonly itemType: 'DOCUMENT' | 'ENTITY_SHORTCUT';
  readonly itemId: string;
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface EntityLink {
  readonly id: EntityLinkId;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly relationType: string;
  readonly createdAt: string;
}

export interface Tag {
  readonly id: TagId;
  readonly name: string;
  readonly category: string | null;
  readonly createdAt: string;
}

export interface TagAssignment {
  readonly id: TagAssignmentId;
  readonly tagId: TagId;
  readonly entityType: string;
  readonly entityId: string;
  readonly createdAt: string;
}

export interface WikiLink {
  readonly label: string;
  readonly raw: string;
}

function requireToken(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) throw new Error(`${field} must be an opaque token`);
}
function requireText(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} is required`);
}
function requireIso(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
}

export function documentId(value: string): DocumentId { requireToken(value, 'DocumentId'); return value as DocumentId; }
export function documentVersionId(value: string): DocumentVersionId { requireToken(value, 'DocumentVersionId'); return value as DocumentVersionId; }
export function blockId(value: string): BlockId { requireToken(value, 'BlockId'); return value as BlockId; }
export function folderId(value: string): FolderId { requireToken(value, 'FolderId'); return value as FolderId; }
export function folderItemId(value: string): FolderItemId { requireToken(value, 'FolderItemId'); return value as FolderItemId; }
export function entityLinkId(value: string): EntityLinkId { requireToken(value, 'EntityLinkId'); return value as EntityLinkId; }
export function tagId(value: string): TagId { requireToken(value, 'TagId'); return value as TagId; }
export function tagAssignmentId(value: string): TagAssignmentId { requireToken(value, 'TagAssignmentId'); return value as TagAssignmentId; }

export function createBlock(input: DocumentBlock): DocumentBlock {
  requireToken(input.id, 'BlockId');
  if (!BLOCK_TYPES.includes(input.type)) throw new Error(`Invalid block type: ${input.type}`);
  if (typeof input.text !== 'string') throw new Error('Block text must be text');
  if (input.type !== 'CHECKLIST' && input.checked !== undefined) throw new Error('Only CHECKLIST blocks may carry checked');
  return Object.freeze({ ...input });
}

export function freezeContent(content: DocumentContent): DocumentContent {
  const seen = new Set<string>();
  const blocks = content.blocks.map((block) => {
    const next = createBlock(block);
    if (seen.has(next.id)) throw new Error(`Duplicate block id ${next.id}`);
    seen.add(next.id);
    return next;
  });
  return Object.freeze({ blocks: Object.freeze(blocks) });
}

export function createDocumentWithInitialVersion(input: {
  readonly document: Omit<Document, 'currentVersionId' | 'archivedAt'> & { readonly currentVersionId?: never; readonly archivedAt?: never };
  readonly versionId: DocumentVersionId;
  readonly content: DocumentContent;
}): Readonly<{ document: Document; version: DocumentVersion; blocks: readonly BlockIdentity[] }> {
  requireToken(input.document.id, 'DocumentId');
  requireText(input.document.title, 'title');
  requireIso(input.document.createdAt, 'createdAt');
  if (!DOCUMENT_TYPES.includes(input.document.documentType)) throw new Error(`Invalid document type: ${input.document.documentType}`);
  requireToken(input.versionId, 'DocumentVersionId');
  if (input.document.primaryFolderId !== null) requireToken(input.document.primaryFolderId, 'FolderId');
  if ((input.document.linkedEntityType === null) !== (input.document.linkedEntityId === null)) {
    throw new Error('linkedEntityType and linkedEntityId must both be present or both be null');
  }
  const content = freezeContent(input.content);
  const version: DocumentVersion = Object.freeze({
    id: input.versionId,
    documentId: input.document.id,
    versionNo: 1,
    content,
    createdAt: input.document.createdAt,
    supersedesDocumentVersionId: null,
  });
  const document: Document = Object.freeze({
    ...input.document,
    currentVersionId: version.id,
    archivedAt: null,
  });
  const blocks = Object.freeze(content.blocks.map((block) => Object.freeze({
    id: block.id,
    documentId: document.id,
    createdAt: document.createdAt,
  })));
  return Object.freeze({ document, version, blocks });
}

export function createSuccessorDocumentVersion(previous: DocumentVersion, input: {
  readonly id: DocumentVersionId;
  readonly content: DocumentContent;
  readonly createdAt: string;
}): DocumentVersion {
  requireToken(input.id, 'DocumentVersionId');
  if (input.id === previous.id) throw new Error('Successor DocumentVersion requires a fresh id');
  requireIso(input.createdAt, 'createdAt');
  if (input.createdAt < previous.createdAt) throw new Error('DocumentVersion successor predates previous version');
  return Object.freeze({
    id: input.id,
    documentId: previous.documentId,
    versionNo: previous.versionNo + 1,
    content: freezeContent(input.content),
    createdAt: input.createdAt,
    supersedesDocumentVersionId: previous.id,
  });
}

export function contentToMarkdown(content: DocumentContent): string {
  return content.blocks.map((block) => {
    switch (block.type) {
      case 'HEADING_1': return `# ${block.text}`;
      case 'HEADING_2': return `## ${block.text}`;
      case 'BULLET': return `- ${block.text}`;
      case 'QUOTE': return `> ${block.text}`;
      case 'CALLOUT': return `> [!NOTE] ${block.text}`;
      case 'CHECKLIST': return `- [${block.checked ? 'x' : ' '}] ${block.text}`;
      case 'CODE': return `\`\`\`\n${block.text}\n\`\`\``;
      default: return block.text;
    }
  }).join('\n\n');
}

export function extractWikiLinks(content: DocumentContent): readonly WikiLink[] {
  const links: WikiLink[] = [];
  const seen = new Set<string>();
  for (const block of content.blocks) {
    for (const match of block.text.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const label = match[1]?.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      links.push(Object.freeze({ label, raw: match[0] }));
    }
  }
  return Object.freeze(links);
}

export function createFolder(input: Folder): Folder {
  requireToken(input.id, 'FolderId'); requireText(input.name, 'folder name'); requireIso(input.createdAt, 'createdAt');
  if (input.parentFolderId !== null) {
    requireToken(input.parentFolderId, 'parentFolderId');
    if (input.parentFolderId === input.id) throw new Error('Folder cannot parent itself');
  }
  if (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0) throw new Error('sortOrder must be a non-negative integer');
  return Object.freeze({ ...input });
}

export function createEntityLink(input: EntityLink): EntityLink {
  requireToken(input.id, 'EntityLinkId'); requireText(input.sourceType, 'sourceType'); requireToken(input.sourceId, 'sourceId');
  requireText(input.targetType, 'targetType'); requireToken(input.targetId, 'targetId'); requireText(input.relationType, 'relationType'); requireIso(input.createdAt, 'createdAt');
  if (input.sourceType === input.targetType && input.sourceId === input.targetId) throw new Error('EntityLink cannot self-reference');
  return Object.freeze({ ...input });
}
