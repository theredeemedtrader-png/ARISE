import { useEffect, useMemo, useState } from 'react';
import type { AriseApi } from '@arise/shared';
import { Icon } from './icons';
import { PerformanceReviewLab } from './PerformanceReviewLab';

type Workspace = Awaited<ReturnType<AriseApi['getReviewWorkspace']>>;
type Review = Workspace['queue'][number];
type EvidenceWorkspace = Awaited<ReturnType<AriseApi['getEvidenceWorkspace']>>;

export function ReviewWorkspace({ defaultSymbol, onDataChanged }: { readonly defaultSymbol: string; readonly onDataChanged: () => void }) {
  const [data, setData] = useState<Workspace>({ schedules: [], queue: [], automaticTimingAvailable: false });
  const [catalog, setCatalog] = useState<Awaited<ReturnType<AriseApi['getChartCatalog']>> | null>(null);
  const [evidence, setEvidence] = useState<EvidenceWorkspace>({ events: [], stageSummaries: [], captureQueueDepth: 0, executionAvailable: false });
  const [surface, setSurface] = useState<'MARKET_REVIEW'|'EVIDENCE'|'PERFORMANCE_REVIEW'>('MARKET_REVIEW');
  const [selected, setSelected] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => { if (window.arise) { setData(await window.arise.getReviewWorkspace()); onDataChanged(); } };
  const reloadEvidence = async () => { if (window.arise) setEvidence(await window.arise.getEvidenceWorkspace()); };
  useEffect(() => { if (!window.arise) return; void Promise.all([window.arise.getReviewWorkspace(), window.arise.getChartCatalog(), window.arise.getEvidenceWorkspace()]).then(([workspace, chartCatalog, evidenceWorkspace]) => { setData(workspace); setCatalog(chartCatalog); setEvidence(evidenceWorkspace); }).catch((value: unknown) => setError(value instanceof Error ? value.message : String(value))); }, []);
  const selectedReview = data.queue.find((entry) => entry.reviewId === selected) ?? null;
  const due = useMemo(() => data.queue.filter((entry) => entry.status === 'DUE').sort((a, b) => a.dueAt.localeCompare(b.dueAt)), [data.queue]);
  return <div className="page-stack page-fill review-workspace">
    <div className="page-header"><div><div className="eyebrow">STUDY</div><h1>{surface === 'MARKET_REVIEW' ? 'Market Review' : surface==='EVIDENCE'?'Evidence + Decision Trace':'Performance Review'}</h1><p>{surface === 'MARKET_REVIEW' ? 'Review state is explicit and historical: DUE, COMPLETED, MISSED or SKIPPED. Not reviewed never becomes NEUTRAL.' : surface==='EVIDENCE'?'Immutable runtime events, exact historical references, original rasters, and the reasoning that advanced each node.':'Evidence-backed Trade and Colony study that turns observations into versioned playbook learning.'}</p></div><div className="page-actions review-surface-switch"><button className={surface==='MARKET_REVIEW'?'selected':''} onClick={()=>setSurface('MARKET_REVIEW')}>MARKET REVIEW</button><button className={surface==='EVIDENCE'?'selected':''} onClick={()=>{setSurface('EVIDENCE');void reloadEvidence();}}>EVIDENCE</button><button className={surface==='PERFORMANCE_REVIEW'?'selected':''} onClick={()=>setSurface('PERFORMANCE_REVIEW')}>REVIEW LAB</button>{surface==='MARKET_REVIEW'?<button className="primary-button" onClick={() => setShowSchedule(true)}><Icon name="plus" /> Review Schedule</button>:null}</div></div>
    {surface === 'EVIDENCE' ? <EvidenceBoard data={evidence} onReload={reloadEvidence} /> : surface==='PERFORMANCE_REVIEW'?<PerformanceReviewLab/>:<>
      <div className="review-notice"><Icon name="clock" /><div><strong>Candle-close automation is deliberately waiting for TimeframeService.</strong><span>Schedules persist now. “Queue now” creates a real manual review cycle; broker-aligned automatic cycles wait for canonical TimeframeService + live market data.</span></div></div>
      <div className="review-layout">
        <aside className="review-schedules"><header><span>SCHEDULES</span><b>{data.schedules.length}</b></header>{data.schedules.map((schedule) => <div className="review-schedule-card" key={schedule.id}><div><strong>{schedule.symbol} · {schedule.timeframe}</strong><span>{schedule.frequencyType.replaceAll('_', ' ')}</span></div><button onClick={() => { if (window.arise) void window.arise.queueReviewNow({ scheduleId: schedule.id }).then(async (entry) => { await reload(); setSelected(entry.reviewId); }); }}>Queue now</button></div>)}{!data.schedules.length ? <div className="navigator-empty">No schedules yet.</div> : null}<div className="calendar-context"><span>ECONOMIC CALENDAR</span><strong>Provider not configured</strong><small>Day/week economic context is provider-neutral and remains non-blocking until a calendar adapter is connected.</small></div></aside>
        <section className="review-board"><div className="review-summary-strip"><div><span>DUE</span><strong>{due.length}</strong></div><div><span>COMPLETED</span><strong>{data.queue.filter((item) => item.status === 'COMPLETED').length}</strong></div><div><span>MISSED</span><strong>{data.queue.filter((item) => item.status === 'MISSED').length}</strong></div><div><span>SKIPPED</span><strong>{data.queue.filter((item) => item.status === 'SKIPPED').length}</strong></div></div><div className="review-lanes m5">{(['DUE','COMPLETED','MISSED','SKIPPED'] as const).map((status) => <section className="review-lane" key={status}><header>{status}<span>{data.queue.filter((entry) => entry.status === status).length}</span></header>{data.queue.filter((entry) => entry.status === status).map((entry) => <button key={entry.reviewId} className={selected === entry.reviewId ? 'selected' : ''} onClick={() => setSelected(entry.reviewId)}><strong>{entry.symbol} · {entry.timeframe}</strong><span>{new Date(entry.dueAt).toLocaleString()}</span><small>{entry.direction}</small></button>)}{!data.queue.some((entry) => entry.status === status) ? <div>Nothing here yet</div> : null}</section>)}</div></section>
        <aside className="review-focus">{selectedReview ? <FocusedReview review={selectedReview} onResolved={async () => { await reload(); setSelected(null); }} /> : <div className="document-empty"><Icon name="clock"/><h3>{due.length ? 'Select a due review' : 'Review queue clear'}</h3><p>Focused review preserves the decision you actually made at review time.</p></div>}</aside>
      </div>
      {showSchedule && catalog ? <ScheduleDialog catalog={catalog} defaultSymbol={defaultSymbol} onClose={() => setShowSchedule(false)} onCreated={async () => { setShowSchedule(false); await reload(); }} /> : null}
    </>}
    {error ? <div className="error">{error}</div> : null}
  </div>;
}

function EvidenceBoard({ data, onReload }: { readonly data: EvidenceWorkspace; readonly onReload: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(data.events.at(-1)?.id ?? null);
  const [mode, setMode] = useState<'BOARD'|'DRILL_DOWN'>('BOARD');
  useEffect(() => { setSelectedId((current) => current && data.events.some((event) => event.id === current) ? current : data.events.at(-1)?.id ?? null); }, [data.events]);
  const selected = data.events.find((event) => event.id === selectedId) ?? null;
  const groups = useMemo(() => {
    const values = new Map<string, EvidenceWorkspace['events']>();
    for (const event of data.events) { const key = event.timeframe ?? 'NO TIMEFRAME'; values.set(key, [...(values.get(key) ?? []), event]); }
    return [...values.entries()];
  }, [data.events]);
  const regenerate = async () => { if (!window.arise || !selected) return; await window.arise.regenerateEvidenceSnapshot({ evidenceEventId: selected.id }); await onReload(); };
  return <section className="evidence-workspace">
    <div className="evidence-toolbar"><div><button className={mode==='BOARD'?'selected':''} onClick={()=>setMode('BOARD')}>BOARD</button><button className={mode==='DRILL_DOWN'?'selected':''} disabled={!selected} onClick={()=>setMode('DRILL_DOWN')}>DRILL-DOWN</button></div><span>{data.events.length} EVENTS · {data.captureQueueDepth} CAPTURING · EXECUTION DISABLED</span></div>
    {!data.events.length ? <div className="evidence-empty"><Icon name="review"/><h3>No Decision Evidence yet</h3><p>Runtime trigger, confirmation, failure, or expiry events will appear here. Capture runs after the canonical runtime transaction.</p></div> : mode === 'BOARD' ? <div className="evidence-board-layout"><div className="evidence-stage-grid">{groups.map(([timeframe, events])=><section className="evidence-stage" key={timeframe}><header><strong>{timeframe}</strong><span>{events.length} NODE EVENTS</span></header>{events.map((event,index)=><button key={event.id} className={selectedId===event.id?'selected':''} onClick={()=>setSelectedId(event.id)}><span className={`evidence-status status-${event.status.toLowerCase()}`}>{event.status}</span><strong>{index+1}. {event.summary}</strong><small>{event.eventType.replaceAll('_',' ')} · {new Date(event.occurredAt).toLocaleString()}</small><i>{event.captureState.replaceAll('_',' ')}</i></button>)}</section>)}</div><EvidenceInspector event={selected} onRegenerate={regenerate}/></div> : <EvidenceDrillDown event={selected} onRegenerate={regenerate}/>} 
  </section>;
}

function EvidenceImage({ event }: { readonly event: EvidenceWorkspace['events'][number] }) {
  const original = event.snapshots.find((snapshot)=>snapshot.captureOrigin!=='REGENERATED_VIEW') ?? event.snapshots[0] ?? null;
  if (!original) return <div className={`evidence-image-placeholder ${event.captureState.toLowerCase()}`}><Icon name="layers"/><strong>{event.captureState.replaceAll('_',' ')}</strong><span>The EvidenceEvent and reconstructable chart state are already durable.</span></div>;
  if (!original.imageDataUrl) return <div className="evidence-image-placeholder corrupt"><Icon name="health"/><strong>{original.assetIntegrity}</strong><span>Original metadata and SHA-256 remain preserved; the asset is not presented as valid.</span></div>;
  return <figure className="evidence-raster"><img src={original.imageDataUrl} alt={`Original evidence for ${event.summary}`}/><figcaption>ORIGINAL · {original.assetIntegrity} · SHA-256 {original.imageHash.slice(0,12)}…</figcaption></figure>;
}

function EvidenceInspector({ event, onRegenerate }: { readonly event: EvidenceWorkspace['events'][number] | null; readonly onRegenerate: () => Promise<void> }) {
  if (!event) return <aside className="evidence-inspector"><div className="navigator-empty">Select Evidence</div></aside>;
  return <aside className="evidence-inspector"><header><span>DECISION EVIDENCE</span><strong>{event.summary}</strong><small>{event.timeframe ?? 'No timeframe'} · {event.status}</small></header><EvidenceImage event={event}/><div className="evidence-trace"><span>DECISION TRACE</span><strong>{event.decisionTrace?.summary ?? 'No trace linked'}</strong><small>{event.decisionTrace?.eventType ?? '—'}</small></div><button className="ghost-button" onClick={()=>void onRegenerate()}>REGENERATE CURRENT VIEW</button><small className="regenerated-warning">Regenerated views are labeled and never replace the original.</small></aside>;
}

function EvidenceDrillDown({ event, onRegenerate }: { readonly event: EvidenceWorkspace['events'][number] | null; readonly onRegenerate: () => Promise<void> }) {
  if (!event) return null;
  return <div className="evidence-drilldown"><section><EvidenceImage event={event}/><div className="evidence-drill-header"><div><span>{event.eventType.replaceAll('_',' ')}</span><h2>{event.summary}</h2></div><span className={`evidence-status status-${event.status.toLowerCase()}`}>{event.status}</span></div><div className="evidence-metadata"><div><span>TIMEFRAME</span><strong>{event.timeframe ?? '—'}</strong></div><div><span>CAPTURE</span><strong>{event.captureState}</strong></div><div><span>POLICY</span><strong>{event.capturePolicy.replaceAll('_',' ')}</strong></div><div><span>OCCURRED</span><strong>{new Date(event.occurredAt).toLocaleString()}</strong></div></div></section><aside><div className="evidence-trace"><span>DECISION TRACE</span><strong>{event.decisionTrace?.summary ?? 'No trace linked'}</strong><small>{event.decisionTrace?.eventType.replaceAll('_',' ') ?? '—'}</small><pre>{JSON.stringify(event.decisionTrace?.details ?? {},null,2)}</pre></div><div className="evidence-reference-list"><span>EXACT REFERENCES</span>{event.references.map((reference)=><div key={reference.id}><strong>{reference.relationType.replaceAll('_',' ')}</strong><small>{reference.entityVersionId ?? reference.entityId}</small></div>)}</div><details><summary>RECONSTRUCTABLE WORKSPACE STATE</summary><pre>{JSON.stringify(event.workspaceState,null,2)}</pre></details><button className="ghost-button" onClick={()=>void onRegenerate()}>REGENERATE CURRENT VIEW</button></aside></div>;
}

function ScheduleDialog({ catalog, defaultSymbol, onClose, onCreated }: { readonly catalog: Awaited<ReturnType<AriseApi['getChartCatalog']>>; readonly defaultSymbol: string; readonly onClose: () => void; readonly onCreated: () => Promise<void> }) {
  const [symbol, setSymbol] = useState(catalog.instruments.some((item) => item.symbol === defaultSymbol) ? defaultSymbol : catalog.instruments[0]?.symbol ?? 'EURUSD');
  const [timeframe, setTimeframe] = useState('D');
  const [frequency, setFrequency] = useState<'EVERY_CANDLE'|'EVERY_2_CANDLES'|'EVERY_3_CANDLES'|'ONCE_TRADING_DAY'|'MANUAL'>('EVERY_CANDLE');
  const create = async () => { if (!window.arise) return; await window.arise.createReviewSchedule({ symbol, timeframe, frequencyType: frequency }); await onCreated(); };
  return <div className="modal-backdrop"><section className="modal-card schedule-dialog"><header><div><span>REVIEW SCHEDULE</span><strong>Define review expectation</strong></div><button className="icon-button" onClick={onClose}><Icon name="close"/></button></header><div className="form-grid three"><label>Instrument<select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{catalog.instruments.map((item) => <option key={item.instrumentId}>{item.symbol}</option>)}</select></label><label>Timeframe<select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>{catalog.timeframes.map((item) => <option key={item.timeframeId}>{item.code}</option>)}</select></label><label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option>EVERY_CANDLE</option><option>EVERY_2_CANDLES</option><option>EVERY_3_CANDLES</option><option>ONCE_TRADING_DAY</option><option>MANUAL</option></select></label></div><p className="modal-note">Configuration is durable now. Automatic due-cycle generation remains disabled until canonical broker-aligned candle boundaries exist.</p><footer><button className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={() => void create()}>Create Schedule</button></footer></section></div>;
}

function FocusedReview({ review, onResolved }: { readonly review: Review; readonly onResolved: () => Promise<void> }) {
  const [direction, setDirection] = useState<Review['direction']>(review.direction);
  const [notes, setNotes] = useState('');
  const resolve = async (status: 'COMPLETED'|'MISSED'|'SKIPPED') => { if (!window.arise) return; await window.arise.resolveMarketReview({ reviewId: review.reviewId, status, direction, notes }); await onResolved(); };
  if (review.status !== 'DUE') return <div className="review-resolved"><span>{review.status}</span><strong>{review.symbol} · {review.timeframe}</strong><p>Direction recorded: {review.direction}</p>{review.reviewedAt ? <small>{new Date(review.reviewedAt).toLocaleString()}</small> : null}</div>;
  return <div className="focused-review"><span>FOCUSED REVIEW</span><h3>{review.symbol} · {review.timeframe}</h3><small>Due {new Date(review.dueAt).toLocaleString()}</small><div className="direction-selector">{(['LONG','SHORT','NEUTRAL','UNCHANGED'] as const).map((value) => <button key={value} className={direction === value ? 'selected' : ''} onClick={() => setDirection(value)}>{value}</button>)}</div><label>Review notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What changed? What remains valid? Important Market Objects, target, invalidation, context…" /></label><div className="review-actions"><button className="ghost-button" onClick={() => void resolve('SKIPPED')}>Skip</button><button className="ghost-button danger" onClick={() => void resolve('MISSED')}>Mark missed</button><button className="primary-button" onClick={() => void resolve('COMPLETED')}>Save Review</button></div></div>;
}
