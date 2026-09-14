import { useEffect, useMemo, useState } from 'react';
import type { AriseApi } from '@arise/shared';
import { TradingChart } from './TradingChart';
import { Icon } from './icons';

type PlanningIdea = Awaited<ReturnType<AriseApi['listPlanningIdeas']>>[number];
type ChartObject = Awaited<ReturnType<AriseApi['listChartObjects']>>[number];
type Theme = 'dark' | 'light';

type Direction = PlanningIdea['direction'];
type IdeaStatus = PlanningIdea['status'];

const KANBAN: readonly { readonly label: string; readonly statuses: readonly IdeaStatus[] }[] = [
  { label: 'DRAFT / WATCHING', statuses: ['DRAFT', 'WATCHING'] },
  { label: 'ACTIVE', statuses: ['ACTIVE'] },
  { label: 'IN PLAY', statuses: ['IN_PLAY'] },
  { label: 'TARGET', statuses: ['TARGET_APPROACHING', 'TARGET_HIT'] },
  { label: 'CLOSED', statuses: ['COMPLETED', 'INVALIDATED', 'CANCELLED', 'ARCHIVED'] },
];

const NEXT_STATUS: Partial<Record<IdeaStatus, readonly IdeaStatus[]>> = {
  DRAFT: ['WATCHING', 'CANCELLED'],
  WATCHING: ['ACTIVE', 'INVALIDATED', 'CANCELLED'],
  ACTIVE: ['IN_PLAY', 'INVALIDATED', 'CANCELLED'],
  IN_PLAY: ['TARGET_APPROACHING', 'INVALIDATED', 'CANCELLED'],
  TARGET_APPROACHING: ['TARGET_HIT', 'INVALIDATED', 'CANCELLED'],
  TARGET_HIT: ['COMPLETED'],
  COMPLETED: ['ARCHIVED'],
  INVALIDATED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
};

function wikiRefs(text: string): readonly string[] {
  return Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g)).map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
}

export function PlanningWorkspace({ defaultSymbol, theme, onDataChanged }: { readonly defaultSymbol: string; readonly theme: Theme; readonly onDataChanged: () => void }) {
  const [ideas, setIdeas] = useState<readonly PlanningIdea[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<AriseApi['getChartCatalog']>> | null>(null);
  const [objects, setObjects] = useState<readonly ChartObject[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    if (!window.arise) return;
    const [nextIdeas, nextCatalog] = await Promise.all([window.arise.listPlanningIdeas(), window.arise.getChartCatalog()]);
    setIdeas(nextIdeas);
    setCatalog(nextCatalog);
    setSelectedId((current) => current && nextIdeas.some((idea) => idea.ideaId === current) ? current : nextIdeas[0]?.ideaId ?? null);
    onDataChanged();
  };

  useEffect(() => { void reload().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }, []);

  const selected = ideas.find((idea) => idea.ideaId === selectedId) ?? null;
  useEffect(() => {
    if (!selected || !window.arise) { setObjects([]); return; }
    void window.arise.listChartObjects({ symbol: selected.symbol }).then(setObjects).catch(() => setObjects([]));
  }, [selected?.ideaId, selected?.symbol]);

  const counts = useMemo(() => new Map(KANBAN.map((column) => [column.label, ideas.filter((idea) => column.statuses.includes(idea.status)).length])), [ideas]);

  return (
    <div className="page-stack page-fill planning-workspace">
      <div className="page-header">
        <div><div className="eyebrow">PLAN</div><h1>Ideas</h1><p>Form a higher-timeframe Thesis, preserve every revision, and let one Colony carry the campaign.</p></div>
        <div className="page-actions"><button className="primary-button" onClick={() => setCreating(true)}><Icon name="plus" /> New Idea</button></div>
      </div>

      <div className="idea-kanban">
        {KANBAN.map((column) => <section className="idea-kanban-column" key={column.label}>
          <header><strong>{column.label}</strong><b>{counts.get(column.label) ?? 0}</b></header>
          <div className="idea-cards">
            {ideas.filter((idea) => column.statuses.includes(idea.status)).map((idea) => <button key={idea.ideaId} className={`idea-card ${idea.ideaId === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(idea.ideaId)}>
              <div className="idea-card-top"><strong>{idea.symbol}</strong><span>{idea.timeframe}</span></div>
              <div className="idea-card-title">{idea.colonyLabel}</div>
              <div className="idea-card-target">{idea.targetDescription || 'No target described'}</div>
              <div className="idea-card-bottom"><span className={`direction-pill ${idea.direction.toLowerCase()}`}>{idea.direction}</span><span>{idea.status.replaceAll('_', ' ')}</span><small>v{idea.versionNo}</small></div>
            </button>)}
            {!ideas.some((idea) => column.statuses.includes(idea.status)) ? <div className="kanban-empty compact"><span>No Ideas</span></div> : null}
          </div>
        </section>)}
      </div>

      {selected ? <ThesisCanvas idea={selected} theme={theme} objects={objects} onChanged={reload} /> : <div className="panel thesis-empty"><strong>No Idea selected</strong><span>Create an Idea to open its Thesis Canvas.</span></div>}
      {creating && catalog ? <NewIdeaDialog catalog={catalog} defaultSymbol={defaultSymbol} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} /> : null}
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}

function NewIdeaDialog({ catalog, defaultSymbol, onClose, onCreated }: {
  readonly catalog: Awaited<ReturnType<AriseApi['getChartCatalog']>>;
  readonly defaultSymbol: string;
  readonly onClose: () => void;
  readonly onCreated: () => Promise<void>;
}) {
  const [symbol, setSymbol] = useState(catalog.instruments.some((item) => item.symbol === defaultSymbol) ? defaultSymbol : catalog.instruments[0]?.symbol ?? 'EURUSD');
  const [timeframe, setTimeframe] = useState('D');
  const [direction, setDirection] = useState<Direction>('LONG');
  const [thesis, setThesis] = useState('');
  const [target, setTarget] = useState('');
  const [invalidation, setInvalidation] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!window.arise) return;
    setBusy(true);
    try {
      await window.arise.createPlanningIdea({ symbol, timeframe, direction, thesisText: thesis, targetDescription: target, invalidationDescription: invalidation, primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null });
      await onCreated();
    } finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><section className="modal-card idea-dialog">
    <header><div><span>NEW IDEA</span><strong>Start a Thesis</strong></div><button className="icon-button" onClick={onClose}><Icon name="close" /></button></header>
    <div className="form-grid three"><label>Instrument<select value={symbol} onChange={(e: { target: { value: string } }) => setSymbol(e.target.value)}>{catalog.instruments.map((item) => <option key={item.instrumentId}>{item.symbol}</option>)}</select></label><label>Thesis timeframe<select value={timeframe} onChange={(e: { target: { value: string } }) => setTimeframe(e.target.value)}>{catalog.timeframes.map((item) => <option key={item.timeframeId}>{item.code}</option>)}</select></label><label>Direction<select value={direction} onChange={(e: { target: { value: string } }) => setDirection(e.target.value as Direction)}><option>LONG</option><option>SHORT</option><option>NEUTRAL</option></select></label></div>
    <label className="stacked-field">Thesis<textarea value={thesis} onChange={(e: { target: { value: string } }) => setThesis(e.target.value)} placeholder="What do you think price is doing, and why? Use [[wiki references]] freely." /></label>
    <div className="form-grid two"><label className="stacked-field">Target<input value={target} onChange={(e: { target: { value: string } }) => setTarget(e.target.value)} placeholder="Next opposing external liquidity" /></label><label className="stacked-field">Invalidation<input value={invalidation} onChange={(e: { target: { value: string } }) => setInvalidation(e.target.value)} placeholder="What would prove this thesis wrong?" /></label></div>
    <footer><button className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !symbol || !timeframe} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create Idea + Colony'}</button></footer>
  </section></div>;
}

function ThesisCanvas({ idea, theme, objects, onChanged }: { readonly idea: PlanningIdea; readonly theme: Theme; readonly objects: readonly ChartObject[]; readonly onChanged: () => Promise<void> }) {
  const [direction, setDirection] = useState<Direction>(idea.direction);
  const [text, setText] = useState(idea.thesisText);
  const [target, setTarget] = useState(idea.targetDescription);
  const [invalidation, setInvalidation] = useState(idea.invalidationDescription);
  const [primaryTarget, setPrimaryTarget] = useState(idea.primaryTargetMarketObjectVersionId ?? '');
  const [invalidationObject, setInvalidationObject] = useState(idea.invalidationMarketObjectVersionId ?? '');
  const [transitionTo, setTransitionTo] = useState<IdeaStatus | ''>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDirection(idea.direction); setText(idea.thesisText); setTarget(idea.targetDescription); setInvalidation(idea.invalidationDescription); setPrimaryTarget(idea.primaryTargetMarketObjectVersionId ?? ''); setInvalidationObject(idea.invalidationMarketObjectVersionId ?? ''); setTransitionTo(''); }, [idea.ideaId, idea.ideaVersionId]);
  const dirty = direction !== idea.direction || text !== idea.thesisText || target !== idea.targetDescription || invalidation !== idea.invalidationDescription || primaryTarget !== (idea.primaryTargetMarketObjectVersionId ?? '') || invalidationObject !== (idea.invalidationMarketObjectVersionId ?? '');
  const save = async () => {
    if (!window.arise) return;
    setBusy(true);
    try {
      const first = idea.thesisBlocks[0];
      await window.arise.updatePlanningThesis({
        ideaId: idea.ideaId, direction, thesisText: text, targetDescription: target, invalidationDescription: invalidation,
        primaryTargetMarketObjectVersionId: primaryTarget || null, invalidationMarketObjectVersionId: invalidationObject || null,
        thesisBlocks: [{ id: first?.id ?? crypto.randomUUID(), type: first?.type ?? 'PARAGRAPH', text }],
      });
      await onChanged();
    } finally { setBusy(false); }
  };
  const transition = async () => {
    if (!window.arise || !transitionTo) return;
    setBusy(true); try { await window.arise.transitionPlanningIdea({ ideaId: idea.ideaId, to: transitionTo }); await onChanged(); } finally { setBusy(false); }
  };
  const appendRef = (name: string) => setText((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}[[${name}]]`);
  return <section className="thesis-canvas">
    <header className="thesis-header"><div><span>{idea.symbol} · {idea.timeframe}</span><strong>{idea.colonyLabel}</strong><small>{idea.colonyState} · IDEA {idea.status.replaceAll('_', ' ')} · VERSION {idea.versionNo}</small></div><div className="thesis-status-actions"><select value={transitionTo} onChange={(e: { target: { value: string } }) => setTransitionTo(e.target.value as IdeaStatus | '')}><option value="">Change status…</option>{(NEXT_STATUS[idea.status] ?? []).map((status) => <option key={status}>{status}</option>)}</select><button className="ghost-button" disabled={!transitionTo || busy} onClick={() => void transition()}>Apply</button><button className="primary-button" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : `Save Thesis v${idea.versionNo + 1}`}</button></div></header>
    <div className="thesis-split">
      <div className="thesis-editor-pane">
        <div className="editor-meta"><select value={direction} onChange={(e: { target: { value: string } }) => setDirection(e.target.value as Direction)}><option>LONG</option><option>SHORT</option><option>NEUTRAL</option></select><span className={`direction-pill ${direction.toLowerCase()}`}>{direction}</span></div>
        <textarea className="thesis-editor" value={text} onChange={(e: { target: { value: string } }) => setText(e.target.value)} placeholder="Write the thesis. Reference chart semantics with [[Object Name]]." />
        <div className="thesis-fields"><label>TARGET<input value={target} onChange={(e: { target: { value: string } }) => setTarget(e.target.value)} /></label><label>INVALIDATION<input value={invalidation} onChange={(e: { target: { value: string } }) => setInvalidation(e.target.value)} /></label></div>
        <div className="object-reference-grid"><label>Primary target object<select value={primaryTarget} onChange={(e: { target: { value: string } }) => setPrimaryTarget(e.target.value)}><option value="">None</option>{objects.map((object) => <option key={object.versionId} value={object.versionId}>{object.name} · {object.role} · v{object.versionNo}</option>)}</select></label><label>Invalidation object<select value={invalidationObject} onChange={(e: { target: { value: string } }) => setInvalidationObject(e.target.value)}><option value="">None</option>{objects.map((object) => <option key={object.versionId} value={object.versionId}>{object.name} · {object.role} · v{object.versionNo}</option>)}</select></label></div>
        <div className="reference-tray"><div><span>THESIS REFERENCES</span><b>{wikiRefs(text).length}</b></div><div className="reference-chips">{wikiRefs(text).map((ref) => <span key={ref}>[[{ref}]]</span>)}{wikiRefs(text).length === 0 ? <small>Type [[...]] or insert a current chart object.</small> : null}</div><div className="object-insert-list">{objects.slice(0, 8).map((object) => <button key={object.id} onClick={() => appendRef(object.name)}>+ {object.name}</button>)}</div></div>
      </div>
      <div className="thesis-chart-pane"><TradingChart symbol={idea.symbol} theme={theme} /></div>
    </div>
  </section>;
}
