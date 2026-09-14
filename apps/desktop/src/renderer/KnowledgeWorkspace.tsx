import { useEffect, useMemo, useState } from 'react';
import type { AriseApi } from '@arise/shared';
import { Icon } from './icons';

type Library = Awaited<ReturnType<AriseApi['getKnowledgeLibrary']>>;
type Detail = Awaited<ReturnType<AriseApi['getKnowledgeDocument']>>;

export function KnowledgeWorkspace() {
  const [library, setLibrary] = useState<Library>({ folders: [], documents: [] });
  const [folder, setFolder] = useState<string | 'ALL' | 'UNFILED'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadLibrary = async () => { if (window.arise) setLibrary(await window.arise.getKnowledgeLibrary()); };
  useEffect(() => { void reloadLibrary().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(() => {
    if (!selectedId || !window.arise) { setDetail(null); return; }
    void window.arise.getKnowledgeDocument({ documentId: selectedId }).then((next) => { setDetail(next); setText(next.blocks.map((b) => b.text).join('\n\n')); setDirty(false); }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [selectedId]);

  const visible = useMemo(() => library.documents.filter((doc) => folder === 'ALL' || (folder === 'UNFILED' ? doc.primaryFolderId === null : doc.primaryFolderId === folder)), [library.documents, folder]);
  const newDocument = async () => {
    if (!window.arise) return;
    const title = window.prompt('Document title'); if (!title?.trim()) return;
    const doc = await window.arise.createKnowledgeDocument({ title: title.trim(), documentType: 'NOTE', text: '', primaryFolderId: folder !== 'ALL' && folder !== 'UNFILED' ? folder : null });
    await reloadLibrary(); setSelectedId(doc.id);
  };
  const newFolder = async () => {
    if (!window.arise) return;
    const name = window.prompt('Folder name'); if (!name?.trim()) return;
    await window.arise.createKnowledgeFolder({ name: name.trim(), parentFolderId: folder !== 'ALL' && folder !== 'UNFILED' ? folder : null });
    await reloadLibrary();
  };
  const save = async () => {
    if (!window.arise || !detail) return;
    const first = detail.blocks[0];
    const next = await window.arise.saveKnowledgeDocument({ documentId: detail.id, blocks: [{ id: first?.id ?? crypto.randomUUID(), type: first?.type ?? 'PARAGRAPH', text }] });
    setDetail(next); setText(next.blocks.map((b) => b.text).join('\n\n')); setDirty(false); await reloadLibrary();
  };
  const move = async (folderId: string) => {
    if (!window.arise || !detail) return;
    const next = await window.arise.moveKnowledgeDocument({ documentId: detail.id, folderId: folderId || null });
    setDetail(next); await reloadLibrary();
  };
  return <div className="page-stack page-fill">
    <div className="page-header"><div><div className="eyebrow">PLAN</div><h1>Knowledge</h1><p>One versioned knowledge system for theses, research, reviews, lessons and strategy notes.</p></div><div className="page-actions"><button className="ghost-button" onClick={() => void newFolder()}><Icon name="plus" /> Folder</button><button className="primary-button" onClick={() => void newDocument()}><Icon name="plus" /> New Document</button></div></div>
    <div className="knowledge-workspace">
      <aside className="knowledge-folders"><div className="tree-title">LIBRARY</div><button className={folder === 'ALL' ? 'selected' : ''} onClick={() => setFolder('ALL')}>All Documents<span>{library.documents.length}</span></button><button className={folder === 'UNFILED' ? 'selected' : ''} onClick={() => setFolder('UNFILED')}>Unfiled<span>{library.documents.filter((d) => d.primaryFolderId === null).length}</span></button>{library.folders.map((item) => <button key={item.id} className={folder === item.id ? 'selected' : ''} onClick={() => setFolder(item.id)}><Icon name="chevron" />{item.name}<span>{library.documents.filter((d) => d.primaryFolderId === item.id).length}</span></button>)}</aside>
      <section className="knowledge-list"><div className="knowledge-list-header"><span>DOCUMENTS</span><b>{visible.length}</b></div>{visible.map((doc) => <button key={doc.id} className={selectedId === doc.id ? 'selected' : ''} onClick={() => setSelectedId(doc.id)}><div><strong>{doc.title}</strong><span>{doc.documentType.replaceAll('_', ' ')}</span></div><small>v{doc.versionNo}</small></button>)}{visible.length === 0 ? <div className="knowledge-list-empty">No documents here.</div> : null}</section>
      <section className="knowledge-editor">{detail ? <><header><div><span>{detail.documentType.replaceAll('_', ' ')} · VERSION {detail.versionNo}</span><h2>{detail.title}</h2></div><div><select value={detail.primaryFolderId ?? ''} onChange={(e: { target: { value: string } }) => void move(e.target.value)}><option value="">Unfiled</option>{library.folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="primary-button" disabled={!dirty} onClick={() => void save()}>Save v{detail.versionNo + 1}</button></div></header><div className="markdown-toolbar"><span>MARKDOWN + WIKI LINKS</span><small>Use [[Document Title]] to create semantic references.</small></div><textarea value={text} onChange={(e: { target: { value: string } }) => { setText(e.target.value); setDirty(true); }} placeholder="Write here…" /></> : <div className="document-empty"><div className="doc-page-icon"/><h3>Select a document</h3><p>Documents are versioned. Saving creates a new immutable snapshot rather than overwriting history.</p></div>}</section>
      <aside className="knowledge-context">{detail ? <><div className="context-section"><span>WIKI LINKS</span><b>{detail.wikiLinks.length}</b>{detail.wikiLinks.map((link) => <div className="wiki-reference" key={link}>[[{link}]]</div>)}{!detail.wikiLinks.length ? <small>No outgoing references.</small> : null}</div><div className="context-section"><span>BACKLINKS</span><b>{detail.backlinks.length}</b>{detail.backlinks.map((link) => <button key={`${link.documentId}-${link.label}`} onClick={() => setSelectedId(link.documentId)}><strong>{link.title}</strong><small>references [[{link.label}]]</small></button>)}{!detail.backlinks.length ? <small>No documents reference this title.</small> : null}</div><div className="context-section"><span>LINKED ENTITY</span><small>{detail.linkedEntityType ? `${detail.linkedEntityType} · ${detail.linkedEntityId}` : 'Free document'}</small></div></> : null}</aside>
    </div>{error ? <div className="error">{error}</div> : null}
  </div>;
}
