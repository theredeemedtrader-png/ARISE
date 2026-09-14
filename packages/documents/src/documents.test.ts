import { describe, expect, it } from 'vitest';
import {
  blockId,
  contentToMarkdown,
  createDocumentWithInitialVersion,
  createSuccessorDocumentVersion,
  documentId,
  documentVersionId,
  extractWikiLinks,
} from './index';

const t1 = '2026-09-10T12:00:00.000Z';
const t2 = '2026-09-10T12:01:00.000Z';

describe('documents', () => {
  it('creates an immutable v1 and successor while preserving block identity', () => {
    const first = createDocumentWithInitialVersion({
      document: {
        id: documentId('doc-1'), documentType: 'THESIS', title: 'EURUSD Thesis', primaryFolderId: null,
        linkedEntityType: 'IDEA', linkedEntityId: 'idea-1', createdAt: t1,
      },
      versionId: documentVersionId('docv-1'),
      content: { blocks: [{ id: blockId('block-1'), type: 'PARAGRAPH', text: 'Watching [[Weekly BSL]].' }] },
    });
    const second = createSuccessorDocumentVersion(first.version, {
      id: documentVersionId('docv-2'), createdAt: t2,
      content: { blocks: [{ id: blockId('block-1'), type: 'PARAGRAPH', text: 'Targeting [[Weekly BSL]].' }] },
    });
    expect(first.version.versionNo).toBe(1);
    expect(second.versionNo).toBe(2);
    expect(second.supersedesDocumentVersionId).toBe(first.version.id);
    expect(first.version.content.blocks[0]?.text).toBe('Watching [[Weekly BSL]].');
  });

  it('extracts unique wiki links and exports markdown', () => {
    const content = { blocks: [
      { id: blockId('b1'), type: 'HEADING_1' as const, text: 'Plan' },
      { id: blockId('b2'), type: 'PARAGRAPH' as const, text: 'Use [[D FVG #03]] then [[Weekly BSL]].' },
      { id: blockId('b3'), type: 'PARAGRAPH' as const, text: 'Still [[D FVG #03]].' },
    ] };
    expect(extractWikiLinks(content).map((link) => link.label)).toEqual(['D FVG #03', 'Weekly BSL']);
    expect(contentToMarkdown(content)).toContain('# Plan');
  });
});
