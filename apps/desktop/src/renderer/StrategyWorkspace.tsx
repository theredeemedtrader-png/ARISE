import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AriseApi } from '@arise/shared';
import { Icon } from './icons';

type Workspace = Awaited<ReturnType<AriseApi['getStrategyWorkspace']>>;
type StrategyView = Workspace['strategies'][number];
type MapView = Workspace['maps'][number];
type Graph = MapView['graph'];
type Node = Graph['nodes'][number];
type Family = Node['family'];
type Mode = 'SIMPLE' | 'GRAPH';
type SurfaceMode = 'EDIT' | 'LIVE';

const EMPTY: Workspace = { strategies: [], maps: [], runtimes: [], runtimeColonies: [], runtimeAvailable: true, liveMarketDataAvailable: false };
const TIMEFRAMES = ['M','W','D','H12','H8','H6','H4','H2','H1','M30','M15','M10','M5','M3','M2','M1'];
const PURPOSES = ['HINDSIGHT','AREA','ENTRY'] as const;
const FAMILY_LIBRARY: readonly { family: Family; label: string; detail: string }[] = [
  { family: 'STRATEGY', label: 'Strategy', detail: 'Exact Encyclopedia version' },
  { family: 'LOGIC', label: 'Logic', detail: 'AND / OR / THEN / NOT' },
  { family: 'MODIFIER', label: 'Modifier', detail: 'Close, session, spread, limits' },
  { family: 'MARKET_OBJECT', label: 'Market Object', detail: 'Canonical chart object condition' },
  { family: 'STATE', label: 'State', detail: 'Thesis / Colony / Position state' },
  { family: 'ACTION', label: 'Action', detail: 'Notify, arm, scout, snapshot' },
];

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
function asGraph(value: Graph): Graph {
  return { nodes: value.nodes.map((node) => ({ ...node, position: { ...node.position }, purposes: [...node.purposes] } as Node)), edges: value.edges.map((edge) => ({ ...edge })) };
}
function newNode(family: Family, strategies: readonly StrategyView[], index: number): Node | null {
  const base = {
    id: uid('node'), family, label: family.replaceAll('_',' '), position: { x: 70 + (index % 3) * 230, y: 70 + Math.floor(index / 3) * 150 },
    timeframe: null, purposes: [] as ('HINDSIGHT'|'AREA'|'ENTRY')[], importance: 'REQUIRED' as const, executionMode: 'OBSERVE' as const,
  };
  switch (family) {
    case 'STRATEGY': {
      const strategy = strategies[0];
      if (!strategy) return null;
      return { ...base, family, label: strategy.name, strategyVersionId: strategy.versionId, parameters: {} };
    }
    case 'LOGIC': return { ...base, family, label: 'THEN', operator: 'THEN' };
    case 'MODIFIER': return { ...base, family, label: 'Require Candle Close', modifierKey: 'require_candle_close', parameters: {} };
    case 'MARKET_OBJECT': return { ...base, family, label: 'Price enters Area', marketObjectId: null, marketObjectVersionId: null, conditionKey: 'zone_entry' };
    case 'STATE': return { ...base, family, label: 'Thesis Active', stateKey: 'thesis_active' };
    case 'ACTION': return { ...base, family, label: 'Notify', actionKey: 'notify', parameters: {} };
  }
}
function familyTone(family: Family): string { return `family-${family.toLowerCase().replace('_','-')}`; }
function linearSequence(graph: Graph): Node[] | null {
  if (!graph.nodes.length) return [];
  const incoming = new Map(graph.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(graph.nodes.map((n) => [n.id, [] as string[]]));
  for (const e of graph.edges) {
    incoming.set(e.targetNodeId, (incoming.get(e.targetNodeId) ?? 0) + 1);
    outgoing.get(e.sourceNodeId)?.push(e.targetNodeId);
  }
  if ([...incoming.values()].some((v) => v > 1) || [...outgoing.values()].some((v) => v.length > 1)) return null;
  const start = graph.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
  if (start.length !== 1) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id,n]));
  const ordered: Node[] = []; let current: string | undefined = start[0]?.id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) { seen.add(current); const node = byId.get(current); if (!node) return null; ordered.push(node); current = outgoing.get(current)?.[0]; }
  return ordered.length === graph.nodes.length ? ordered : null;
}

export function StrategyWorkspace() {
  const [data, setData] = useState<Workspace>(EMPTY);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<Mode>('GRAPH');
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('EDIT');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewStrategy, setShowNewStrategy] = useState(false);
  const [editingDefinitionId, setEditingDefinitionId] = useState<string | null>(null);
  const [showNewMap, setShowNewMap] = useState(false);
  const [strategyDraft, setStrategyDraft] = useState({ name: 'Liquidity Sweep', category: 'LIQUIDITY', description: '', tags: 'liquidity,sweep', capability: 'DETECTABLE' as StrategyView['automationCapability'], deploymentStatus: 'EXPERIMENTAL' as StrategyView['deploymentStatus'], detectorKey: 'liquidity_sweep', evaluationMode: 'ON_BAR_CLOSE' as NonNullable<StrategyView['detector']>['evaluationMode'] });
  const [mapDraft, setMapDraft] = useState({ name: 'HTF to LTF Participation', kind: 'STRATEGY_MAP' as MapView['kind'] });
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null);
  const [runtimeColonyId, setRuntimeColonyId] = useState('');
  const [runtimeMode, setRuntimeMode] = useState<'OBSERVE'|'SHADOW'|'DEMO'>('OBSERVE');
  const [runtimePrice, setRuntimePrice] = useState('1.1000');
  const [runtimeSpread, setRuntimeSpread] = useState('1.0');
  const [runtimeEventType, setRuntimeEventType] = useState<'PRICE_UPDATE'|'BAR_CLOSE'|'EVENT'|'MANUAL'>('PRICE_UPDATE');
  const [connectTarget, setConnectTarget] = useState('');
  const drag = useRef<{ nodeId: string; dx: number; dy: number } | null>(null);

  const reload = async () => {
    if (!window.arise) return;
    const next = await window.arise.getStrategyWorkspace();
    setData(next);
    setSelectedStrategyId((current) => current && next.strategies.some((s) => s.definitionId === current) ? current : next.strategies[0]?.definitionId ?? null);
    setSelectedMapId((current) => current && next.maps.some((m) => m.mapId === current) ? current : next.maps[0]?.mapId ?? null);
    setSelectedRuntimeId((current) => current && next.runtimes.some((runtime) => runtime.runtimeId === current) ? current : next.runtimes[0]?.runtimeId ?? null);
    setRuntimeColonyId((current) => current && next.runtimeColonies.some((colony) => colony.colonyId === current) ? current : next.runtimeColonies[0]?.colonyId ?? '');
  };
  useEffect(() => { void reload().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }, []);

  const selectedMap = data.maps.find((map) => map.mapId === selectedMapId) ?? null;
  useEffect(() => { if (selectedMap) { setGraph(asGraph(selectedMap.graph)); setDirty(false); setSelectedNodeId(null); } else { setGraph({ nodes: [], edges: [] }); } }, [selectedMapId, selectedMap?.versionId]);
  const selectedRuntime = data.runtimes.find((runtime) => runtime.runtimeId === selectedRuntimeId) ?? null;
  const displayedGraph = surfaceMode === 'LIVE' && selectedRuntime ? selectedRuntime.graph : graph;
  const selectedNode = displayedGraph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedStrategy = data.strategies.find((strategy) => strategy.definitionId === selectedStrategyId) ?? null;
  const runtimeNodeByGraphId = useMemo(() => new Map((selectedRuntime?.nodes ?? []).map((node) => [node.graphNodeId, node])), [selectedRuntime]);
  const selectedRuntimeNode = selectedNode ? runtimeNodeByGraphId.get(selectedNode.id) ?? null : null;
  const selectedRuntimeEvaluation = selectedRuntimeNode && selectedRuntime
    ? [...selectedRuntime.evaluations].reverse().find((entry) => entry.runtimeNodeId === selectedRuntimeNode.id) ?? null
    : null;
  const simple = useMemo(() => linearSequence(displayedGraph), [displayedGraph]);

  const updateNode = (nodeId: string, patch: Partial<Node>) => {
    setGraph((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === nodeId ? ({ ...node, ...patch } as Node) : node) }));
    setDirty(true);
  };
  const addNode = (family: Family) => {
    if (surfaceMode !== 'EDIT') return;
    const node = newNode(family, data.strategies, graph.nodes.length);
    if (!node) { setError('Create an Encyclopedia strategy before adding a Strategy node.'); return; }
    setGraph((current) => ({ ...current, nodes: [...current.nodes, node] })); setSelectedNodeId(node.id); setDirty(true); setError(null);
  };
  const removeSelected = () => {
    if (!selectedNodeId) return;
    setGraph((current) => ({ nodes: current.nodes.filter((n) => n.id !== selectedNodeId), edges: current.edges.filter((e) => e.sourceNodeId !== selectedNodeId && e.targetNodeId !== selectedNodeId) }));
    setSelectedNodeId(null); setDirty(true);
  };
  const connect = () => {
    if (!selectedNodeId || !connectTarget || selectedNodeId === connectTarget) return;
    if (graph.edges.some((e) => e.sourceNodeId === selectedNodeId && e.targetNodeId === connectTarget)) return;
    setGraph((current) => ({ ...current, edges: [...current.edges, { id: uid('edge'), sourceNodeId: selectedNodeId, targetNodeId: connectTarget, sourcePort: 'out', targetPort: 'in' }] }));
    setDirty(true); setConnectTarget('');
  };
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, node: Node) => {
    if (surfaceMode !== 'EDIT') return;
    const rect = event.currentTarget.closest('.graph-stage')?.getBoundingClientRect(); if (!rect) return;
    drag.current = { nodeId: node.id, dx: event.clientX - rect.left - node.position.x, dy: event.clientY - rect.top - node.position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const value = drag.current; if (!value) return;
    const rect = event.currentTarget.getBoundingClientRect();
    updateNode(value.nodeId, { position: { x: Math.max(10, event.clientX - rect.left - value.dx), y: Math.max(10, event.clientY - rect.top - value.dy) } } as Partial<Node>);
  };
  const endDrag = () => { drag.current = null; };

  const createStrategy = async () => {
    if (!window.arise) return;
    try {
      const created = await window.arise.createStrategyDefinition({
        name: strategyDraft.name, category: strategyDraft.category, description: strategyDraft.description,
        tags: strategyDraft.tags.split(',').map((t) => t.trim()).filter(Boolean), automationCapability: strategyDraft.capability, deploymentStatus: strategyDraft.deploymentStatus,
        detectorKey: strategyDraft.capability === 'MANUAL' ? '' : strategyDraft.detectorKey,
        detectorVersion: '1', evaluationMode: strategyDraft.capability === 'MANUAL' ? 'MANUAL' : strategyDraft.evaluationMode, parameterSchema: {},
      });
      await reload(); setSelectedStrategyId(created.definitionId); setShowNewStrategy(false); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const reviseStrategy = async () => {
    if (!window.arise || !editingDefinitionId) return;
    const strategy = data.strategies.find((entry) => entry.definitionId === editingDefinitionId);
    if (!strategy) return;
    try {
      const revised = await window.arise.reviseStrategyDefinition({
        definitionId: strategy.definitionId, name: strategyDraft.name, category: strategyDraft.category, description: strategyDraft.description,
        tags: strategyDraft.tags.split(',').map((t) => t.trim()).filter(Boolean), automationCapability: strategyDraft.capability, deploymentStatus: strategyDraft.deploymentStatus,
        detectorKey: strategyDraft.capability === 'MANUAL' ? '' : strategyDraft.detectorKey, detectorVersion: '1',
        evaluationMode: strategyDraft.capability === 'MANUAL' ? 'MANUAL' : strategyDraft.evaluationMode, parameterSchema: {},
      });
      await reload(); setSelectedStrategyId(revised.definitionId); setShowNewStrategy(false); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const openStrategyEditor = (strategy?: StrategyView) => {
    setEditingDefinitionId(strategy?.definitionId ?? null);
    if (strategy) setStrategyDraft({ name: strategy.name, category: strategy.category, description: strategy.description, tags: strategy.tags.join(','), capability: strategy.automationCapability, deploymentStatus: strategy.deploymentStatus, detectorKey: strategy.detector?.key ?? '', evaluationMode: strategy.detector?.evaluationMode ?? 'MANUAL' });
    else setStrategyDraft({ name: 'Liquidity Sweep', category: 'LIQUIDITY', description: '', tags: 'liquidity,sweep', capability: 'DETECTABLE', deploymentStatus: 'EXPERIMENTAL', detectorKey: 'liquidity_sweep', evaluationMode: 'ON_BAR_CLOSE' });
    setShowNewStrategy(true);
  };
  const createMap = async () => {
    if (!window.arise) return;
    try {
      const created = await window.arise.createStrategyMap({ name: mapDraft.name, kind: mapDraft.kind, graph: { nodes: [], edges: [] } });
      await reload(); setSelectedMapId(created.mapId); setShowNewMap(false); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const saveMap = async () => {
    if (!window.arise || !selectedMap) return;
    try { const saved = await window.arise.saveStrategyMap({ mapId: selectedMap.mapId, graph }); await reload(); setSelectedMapId(saved.mapId); setDirty(false); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const launchRuntime = async () => {
    if (!window.arise || !selectedMap || !runtimeColonyId) return;
    try {
      const runtime = await window.arise.createStrategyRuntime({ mapId: selectedMap.mapId, colonyId: runtimeColonyId, mode: runtimeMode });
      await reload(); setSelectedRuntimeId(runtime.runtimeId); setSurfaceMode('LIVE'); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const stepRuntime = async () => {
    if (!window.arise || !selectedRuntime) return;
    try {
      const price = runtimePrice.trim() === '' ? null : Number(runtimePrice);
      const spreadPips = runtimeSpread.trim() === '' ? null : Number(runtimeSpread);
      if (price !== null && !Number.isFinite(price)) throw new Error('Lab price must be numeric');
      if (spreadPips !== null && (!Number.isFinite(spreadPips) || spreadPips < 0)) throw new Error('Spread must be zero or greater');
      const eventType = runtimeEventType;
      const candle = eventType === 'BAR_CLOSE' && price !== null ? {
        id: `lab-candle-${Date.now()}`, open: price, high: price, low: price, close: price,
        openedAt: new Date(Date.now() - 60_000).toISOString(), closedAt: new Date().toISOString(),
      } : null;
      const runtime = await window.arise.simulateStrategyRuntimeEvent({
        runtimeId: selectedRuntime.runtimeId, eventType, timeframe: selectedNode?.timeframe ?? null,
        price, spreadPips, pipSize: 0.0001, candle, states: {},
      });
      await reload(); setSelectedRuntimeId(runtime.runtimeId); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const decideRuntimeNode = async (decision: 'CONFIRM'|'REJECT'|'SKIP') => {
    if (!window.arise || !selectedRuntime || !selectedNode || !selectedRuntimeNode) return;
    try {
      const runtime = await window.arise.manualStrategyRuntimeDecision({ runtimeId: selectedRuntime.runtimeId, graphNodeId: selectedNode.id, decision });
      await reload(); setSelectedRuntimeId(runtime.runtimeId); setSelectedNodeId(selectedNode.id); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const executeProposal=async(correlationId:string)=>{if(!window.arise)return;try{const result=await window.arise.executeActionProposal({proposalCorrelationId:correlationId});const plan=result.plans.find(item=>item.proposalCorrelationId===correlationId);const lifecycle=plan?result.lifecycles.find(item=>item.orderPlanId===plan.id):null;setError(lifecycle?`${lifecycle.state}: ${lifecycle.detail}`:'Execution validation blocked; inspect the durable validation record.');}catch(e){setError(e instanceof Error?e.message:String(e));}};

  return <div className="strategy-workspace">
    <header className="strategy-topline">
      <div><span>BUILD</span><h1>Strategy</h1><p>Teach once. Compose visually. Freeze exact versions before runtime.</p></div>
      <div className="strategy-top-actions">
        <div className="segmented small"><button className={graphMode==='SIMPLE'?'selected':''} onClick={()=>setGraphMode('SIMPLE')}>SIMPLE</button><button className={graphMode==='GRAPH'?'selected':''} onClick={()=>setGraphMode('GRAPH')}>GRAPH</button></div>
        <div className="segmented small"><button className={surfaceMode==='EDIT'?'selected':''} onClick={()=>setSurfaceMode('EDIT')}>EDIT</button><button className={surfaceMode==='LIVE'?'selected':''} onClick={()=>setSurfaceMode('LIVE')}>LIVE</button></div>
        <button className="primary-button" onClick={()=>openStrategyEditor()}><Icon name="plus"/> New Strategy</button>
      </div>
    </header>

    <div className="strategy-main-grid">
      <aside className="strategy-encyclopedia">
        <div className="strategy-pane-title"><span>ENCYCLOPEDIA</span><b>{data.strategies.length}</b></div>
        <div className="strategy-search"><Icon name="search"/><span>Strategies</span></div>
        <div className="strategy-list">{data.strategies.length ? data.strategies.map((s)=><button key={s.definitionId} className={selectedStrategyId===s.definitionId?'selected':''} onClick={()=>setSelectedStrategyId(s.definitionId)} onDoubleClick={()=>openStrategyEditor(s)}><strong>{s.name}</strong><span>{s.category}</span><small>{s.automationCapability} · {s.deploymentStatus} · v{s.versionNo}</small></button>) : <div className="strategy-empty">No strategies yet.<br/>Create reusable knowledge first.</div>}</div>
        <div className="strategy-pane-title maps"><span>MAPS / COMBOS</span><button onClick={()=>setShowNewMap(true)} aria-label="New Strategy Map"><Icon name="plus"/></button></div>
        <div className="strategy-map-list">{data.maps.map((m)=><button key={m.mapId} className={selectedMapId===m.mapId?'selected':''} onClick={()=>setSelectedMapId(m.mapId)}><strong>{m.name}</strong><span>{m.kind.replaceAll('_',' ')}</span><small>v{m.versionNo}</small></button>)}</div>
      </aside>

      <section className="strategy-builder">
        <header className="builder-toolbar">
          <div><strong>{surfaceMode==='LIVE' && selectedRuntime ? selectedRuntime.mapName : selectedMap?.name ?? 'No Strategy Map'}</strong><span>{surfaceMode==='LIVE' && selectedRuntime ? `${selectedRuntime.mode} RUNTIME · MAP VERSION ${selectedRuntime.mapVersionNo} · ${selectedRuntime.status}` : selectedMap ? `${selectedMap.kind.replaceAll('_',' ')} · VERSION ${selectedMap.versionNo}` : 'Create a map to begin'}</span></div>
          <div>{surfaceMode==='LIVE' ? <span className="runtime-badge">{data.liveMarketDataAvailable ? 'LIVE MARKET DATA' : 'M7 LAB INPUT · NO LIVE FEED'}</span> : null}<button className="secondary-button" disabled={!selectedMap || !dirty || surfaceMode!=='EDIT'} onClick={()=>void saveMap()}>SAVE NEW VERSION</button></div>
        </header>
        {surfaceMode==='LIVE'?<div className="runtime-controlbar">
          <label>Runtime<select aria-label="Runtime" value={selectedRuntimeId ?? ''} onChange={(e)=>setSelectedRuntimeId(e.target.value||null)}><option value="">No runtime selected</option>{data.runtimes.map((runtime)=><option key={runtime.runtimeId} value={runtime.runtimeId}>{runtime.colonyLabel} · {runtime.mapName} · {runtime.mode}</option>)}</select></label>
          <label>Colony<select aria-label="Runtime Colony" value={runtimeColonyId} onChange={(e)=>setRuntimeColonyId(e.target.value)}><option value="">Choose Colony</option>{data.runtimeColonies.map((colony)=><option key={colony.colonyId} value={colony.colonyId}>{colony.symbol} · {colony.direction} · {colony.label}</option>)}</select></label>
          <label>Mode<select aria-label="Runtime Mode" value={runtimeMode} onChange={(e)=>setRuntimeMode(e.target.value as 'OBSERVE'|'SHADOW'|'DEMO')}><option>OBSERVE</option><option>SHADOW</option><option>DEMO</option></select></label>
          <button className="runtime-launch" disabled={!selectedMap || !runtimeColonyId} onClick={()=>void launchRuntime()}>LAUNCH RUNTIME</button>
          <span className="runtime-separator"/>
          <label>Lab event<select aria-label="Lab Event" value={runtimeEventType} onChange={(e)=>setRuntimeEventType(e.target.value as typeof runtimeEventType)}><option value="PRICE_UPDATE">PRICE UPDATE</option><option value="BAR_CLOSE">BAR CLOSE</option><option value="EVENT">EVENT</option><option value="MANUAL">MANUAL EVENT</option></select></label>
          <label>Price<input aria-label="Lab Price" value={runtimePrice} onChange={(e)=>setRuntimePrice(e.target.value)}/></label>
          <label>Spread<input aria-label="Lab Spread" value={runtimeSpread} onChange={(e)=>setRuntimeSpread(e.target.value)}/></label>
          <button className="runtime-step" disabled={!selectedRuntime || selectedRuntime.status==='COMPLETED' || selectedRuntime.status==='CANCELLED'} onClick={()=>void stepRuntime()}>STEP LAB EVENT</button>
        </div>:null}
        <div className="builder-body">
          <aside className="node-library"><span>NODE LIBRARY</span>{FAMILY_LIBRARY.map((item)=><button key={item.family} disabled={!selectedMap || surfaceMode!=='EDIT'} onClick={()=>addNode(item.family)}><i className={familyTone(item.family)}/><div><strong>{item.label}</strong><small>{item.detail}</small></div><Icon name="plus"/></button>)}</aside>

          {graphMode === 'GRAPH' ? <div className="graph-stage" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <div className="graph-grid"/>
            <svg className="graph-wires" aria-hidden="true">{displayedGraph.edges.map((edge)=>{ const a=displayedGraph.nodes.find((n)=>n.id===edge.sourceNodeId); const b=displayedGraph.nodes.find((n)=>n.id===edge.targetNodeId); if(!a||!b)return null; const x1=a.position.x+170,y1=a.position.y+44,x2=b.position.x,y2=b.position.y+44; const mid=(x1+x2)/2; return <path key={edge.id} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}/>; })}</svg>
            {displayedGraph.nodes.map((node)=>{ const runtimeNode=runtimeNodeByGraphId.get(node.id); return <div key={node.id} className={`strategy-node ${familyTone(node.family)} ${selectedNodeId===node.id?'selected':''} ${surfaceMode==='LIVE'?'live':''} ${runtimeNode ? `runtime-${runtimeNode.state.toLowerCase()}` : ''}`} style={{left:node.position.x,top:node.position.y}} onClick={()=>setSelectedNodeId(node.id)}>
              <div className="strategy-node-header" onPointerDown={(e)=>beginDrag(e,node)}><span>{node.family}</span><b>•••</b></div>
              <strong>{node.label}</strong><div className="node-meta"><span>{node.timeframe ?? 'ANY TF'}</span><span>{node.executionMode}</span></div>
              <div className="node-purposes">{node.purposes.length?node.purposes.map((p)=><em key={p}>{p}</em>):<em>UNASSIGNED</em>}</div>
              <i className="node-port input"/><i className="node-port output"/>{surfaceMode==='LIVE'?<small className="node-runtime-state">{runtimeNode?.state ?? 'NOT IN RUNTIME'}</small>:null}
            </div>})}
            {!displayedGraph.nodes.length?<div className="graph-empty"><Icon name="strategy"/><strong>Build a visual strategy</strong><span>Add nodes from the library. The graph is persisted as an immutable Strategy Map version.</span></div>:null}
          </div> : <div className="simple-stage">{simple === null ? <div className="simple-warning"><strong>This graph branches.</strong><span>Simple mode only represents a single linear chain. Graph mode remains the source of truth.</span></div> : <div className="simple-chain">{simple.map((node,index)=><div key={node.id}><button onClick={()=>{setSelectedNodeId(node.id);setGraphMode('GRAPH');}}><span>{node.timeframe ?? 'ANY'}</span><strong>{node.label}</strong><small>{node.family} · {node.executionMode}</small></button>{index<simple.length-1?<i>→</i>:null}</div>)}</div>}</div>}

          <aside className="node-inspector"><span className="inspector-title">INSPECTOR</span>{selectedNode ? <>
            <div className="inspector-family"><i className={familyTone(selectedNode.family)}/><div><strong>{selectedNode.family}</strong><span>{surfaceMode==='LIVE'?'Read-only runtime projection':'Definition properties'}</span></div></div>
            <label>Label<input disabled={surfaceMode!=='EDIT'} value={selectedNode.label} onChange={(e)=>updateNode(selectedNode.id,{label:e.target.value})}/></label>
            <label>Timeframe<select disabled={surfaceMode!=='EDIT'} value={selectedNode.timeframe ?? ''} onChange={(e)=>updateNode(selectedNode.id,{timeframe:e.target.value||null})}><option value="">Any / inherited</option>{TIMEFRAMES.map((tf)=><option key={tf}>{tf}</option>)}</select></label>
            <label>Importance<select disabled={surfaceMode!=='EDIT'} value={selectedNode.importance} onChange={(e)=>updateNode(selectedNode.id,{importance:e.target.value as Node['importance']})}><option>REQUIRED</option><option>OPTIONAL</option><option>INFORMATIONAL</option></select></label>
            <label>Execution<select disabled={surfaceMode!=='EDIT'} value={selectedNode.executionMode} onChange={(e)=>updateNode(selectedNode.id,{executionMode:e.target.value as Node['executionMode']})}><option>OBSERVE</option><option>NOTIFY</option><option>CONFIRM</option><option>AUTO</option></select></label>
            <div className="inspector-field"><span>PURPOSE</span><div className="purpose-buttons">{PURPOSES.map((p)=><button key={p} disabled={surfaceMode!=='EDIT'} className={selectedNode.purposes.includes(p)?'selected':''} onClick={()=>updateNode(selectedNode.id,{purposes:selectedNode.purposes.includes(p)?selectedNode.purposes.filter((x)=>x!==p):[...selectedNode.purposes,p]})}>{p}</button>)}</div></div>
            {selectedNode.family==='STRATEGY'?<><label>Strategy version<select disabled={surfaceMode!=='EDIT'} value={selectedNode.strategyVersionId} onChange={(e)=>{const s=data.strategies.find((x)=>x.versionId===e.target.value);updateNode(selectedNode.id,{strategyVersionId:e.target.value,label:s?.name??selectedNode.label} as Partial<Node>);}}>{data.strategies.map((s)=><option key={s.versionId} value={s.versionId}>{s.name} · v{s.versionNo} · {s.deploymentStatus}</option>)}</select></label><label>Parameters JSON<textarea key={`${selectedNode.id}-${JSON.stringify(selectedNode.parameters)}`} disabled={surfaceMode!=='EDIT'} defaultValue={JSON.stringify(selectedNode.parameters,null,2)} onBlur={(e)=>{try{const value=JSON.parse(e.target.value) as unknown;if(value===null||Array.isArray(value)||typeof value!=='object')throw new Error('Parameters must be a JSON object');updateNode(selectedNode.id,{parameters:value as Record<string,unknown>} as Partial<Node>);setError(null);}catch(err){setError(err instanceof Error?err.message:String(err));}}}/></label></>:null}
            {selectedNode.family==='ACTION'?<><label>Action<select disabled={surfaceMode!=='EDIT'} value={selectedNode.actionKey} onChange={(e)=>updateNode(selectedNode.id,{actionKey:e.target.value,label:e.target.value==='create_scout'?'Create Scout':'Notify'} as Partial<Node>)}><option value="notify">NOTIFY</option><option value="create_scout">CREATE SCOUT</option></select></label><label>Execution parameters JSON<textarea key={`${selectedNode.id}-${JSON.stringify(selectedNode.parameters)}`} disabled={surfaceMode!=='EDIT'} defaultValue={JSON.stringify(selectedNode.parameters,null,2)} placeholder='{"canonicalSymbol":"EURUSD","direction":"LONG","gearId":"GEAR_1","lots":0.1,"initialStop":1.09,"expiresInSeconds":30,"maxSpreadPips":2,"stackingEligible":true,"riskFresh":true,"sessionPermitted":true,"newsPermitted":true}' onBlur={(e)=>{try{const value=JSON.parse(e.target.value) as unknown;if(value===null||Array.isArray(value)||typeof value!=='object')throw new Error('Parameters must be a JSON object');updateNode(selectedNode.id,{parameters:value as Record<string,unknown>} as Partial<Node>);setError(null);}catch(err){setError(err instanceof Error?err.message:String(err));}}}/></label></>:null}
            {selectedNode.family==='LOGIC'?<label>Operator<select disabled={surfaceMode!=='EDIT'} value={selectedNode.operator} onChange={(e)=>updateNode(selectedNode.id,{operator:e.target.value as 'AND'|'OR'|'THEN'|'NOT'} as Partial<Node>)}><option>AND</option><option>OR</option><option>THEN</option><option>NOT</option></select></label>:null}
            {surfaceMode==='EDIT'?<div className="inspector-connect"><span>CONNECT SELECTED →</span><select value={connectTarget} onChange={(e)=>setConnectTarget(e.target.value)}><option value="">Choose target</option>{graph.nodes.filter((n)=>n.id!==selectedNode.id).map((n)=><option key={n.id} value={n.id}>{n.label}</option>)}</select><button disabled={!connectTarget} onClick={connect}>CONNECT</button><button className="danger-quiet" onClick={removeSelected}>REMOVE NODE</button></div>:<div className="runtime-diagnostics"><strong>{selectedRuntimeNode?.state ?? 'NOT IN RUNTIME'}</strong><span>{selectedRuntimeNode ? `Triggers ${selectedRuntimeNode.triggerCount} · last candle ${selectedRuntimeNode.lastEvaluatedCandleId ?? '—'}` : selectedRuntime ? 'This node is not part of the frozen runtime map.' : 'Launch or select a runtime to inspect node state.'}</span>{selectedRuntimeNode?.manualDecisionRequired && (selectedRuntimeNode.state==='WATCHING' || selectedRuntimeNode.state==='TRIGGERED') && selectedRuntime?.status==='RUNNING'?<div className="manual-decision-panel"><span>MANUAL DECISION REQUIRED</span><div><button className="confirm" onClick={()=>void decideRuntimeNode('CONFIRM')}>CONFIRM</button><button className="reject" onClick={()=>void decideRuntimeNode('REJECT')}>REJECT</button><button onClick={()=>void decideRuntimeNode('SKIP')}>SKIP</button></div></div>:null}{selectedRuntimeEvaluation?<><span>Last detector: {selectedRuntimeEvaluation.detectorKey} · {selectedRuntimeEvaluation.result}</span><pre>{JSON.stringify(selectedRuntimeEvaluation.diagnostics,null,2)}</pre></>:null}{selectedRuntime?.actionProposals.filter((proposal)=>proposal.graphNodeId===selectedNode.id).map((proposal)=><div key={proposal.correlationId}><span>Proposal: {proposal.actionKind} · recorded only, never executed in M7.</span>{proposal.actionKind==='CREATE_SCOUT'?<button onClick={()=>void executeProposal(proposal.correlationId)}>{selectedRuntime.mode==='SHADOW'?'CREATE SHADOW PLAN':'SEND DEMO PLAN'}</button>:null}</div>)}</div>}
          </> : <div className="inspector-empty">Select a node to edit its timeframe, purpose, importance and execution mode.</div>}</aside>
        </div>
      </section>
    </div>

    {selectedStrategy ? <footer className="strategy-detail-strip"><div><span>SELECTED STRATEGY</span><strong>{selectedStrategy.name}</strong><small>{selectedStrategy.category} · {selectedStrategy.automationCapability} · {selectedStrategy.deploymentStatus} · v{selectedStrategy.versionNo}</small></div><div><span>DETECTOR</span><strong>{selectedStrategy.detector?.key ?? 'MANUAL KNOWLEDGE'}</strong><small>{selectedStrategy.detector ? `${selectedStrategy.detector.evaluationMode} · contract v${selectedStrategy.detector.version}` : 'Descriptive knowledge is never executable implicitly.'}</small></div><button onClick={()=>openStrategyEditor(selectedStrategy)}>EDIT → NEW VERSION</button></footer>:null}
    {error?<div className="strategy-error">{error}</div>:null}

    {showNewStrategy?<div className="strategy-modal-backdrop"><section className="strategy-modal"><header><div><span>ENCYCLOPEDIA</span><strong>{editingDefinitionId ? 'Revise Strategy' : 'New Strategy'}</strong></div><button onClick={()=>setShowNewStrategy(false)}>×</button></header><label>Name<input aria-label="Strategy name" value={strategyDraft.name} onChange={(e)=>setStrategyDraft({...strategyDraft,name:e.target.value})}/></label><div className="form-row"><label>Category<input aria-label="Strategy category" value={strategyDraft.category} onChange={(e)=>setStrategyDraft({...strategyDraft,category:e.target.value})}/></label><label>Capability<select aria-label="Automation capability" value={strategyDraft.capability} onChange={(e)=>setStrategyDraft({...strategyDraft,capability:e.target.value as StrategyView['automationCapability']})}><option>MANUAL</option><option>DETECTABLE</option><option>AUTOMATABLE</option></select></label></div><label>Deployment status<select aria-label="Deployment status" value={strategyDraft.deploymentStatus} onChange={(e)=>setStrategyDraft({...strategyDraft,deploymentStatus:e.target.value as StrategyView['deploymentStatus']})}><option>EXPERIMENTAL</option><option>VALIDATED</option><option>DEMO_APPROVED</option><option>LIVE_APPROVED</option><option>RETIRED</option></select></label><label>Description<textarea aria-label="Strategy description" value={strategyDraft.description} onChange={(e)=>setStrategyDraft({...strategyDraft,description:e.target.value})}/></label><label>Tags<input aria-label="Strategy tags" value={strategyDraft.tags} onChange={(e)=>setStrategyDraft({...strategyDraft,tags:e.target.value})}/></label>{strategyDraft.capability!=='MANUAL'?<div className="form-row"><label>Detector key<input aria-label="Detector key" value={strategyDraft.detectorKey} onChange={(e)=>setStrategyDraft({...strategyDraft,detectorKey:e.target.value})}/></label><label>Evaluation<select aria-label="Evaluation mode" value={strategyDraft.evaluationMode} onChange={(e)=>setStrategyDraft({...strategyDraft,evaluationMode:e.target.value as typeof strategyDraft.evaluationMode})}><option>ON_TICK</option><option>ON_PRICE_UPDATE</option><option>ON_BAR_UPDATE</option><option>ON_BAR_CLOSE</option><option>ON_EVENT</option><option>MANUAL</option></select></label></div>:null}<footer><button onClick={()=>setShowNewStrategy(false)}>CANCEL</button><button className="primary-button" onClick={()=>void (editingDefinitionId ? reviseStrategy() : createStrategy())}>SAVE IMMUTABLE VERSION</button></footer></section></div>:null}
    {showNewMap?<div className="strategy-modal-backdrop"><section className="strategy-modal compact"><header><div><span>GRAPH</span><strong>New Reusable Map</strong></div><button onClick={()=>setShowNewMap(false)}>×</button></header><label>Name<input aria-label="Strategy map name" value={mapDraft.name} onChange={(e)=>setMapDraft({...mapDraft,name:e.target.value})}/></label><label>Kind<select aria-label="Strategy map kind" value={mapDraft.kind} onChange={(e)=>setMapDraft({...mapDraft,kind:e.target.value as MapView['kind']})}><option value="COMBO">COMBO</option><option value="STRATEGY_MAP">STRATEGY MAP</option><option value="TEMPLATE">TEMPLATE</option></select></label><footer><button onClick={()=>setShowNewMap(false)}>CANCEL</button><button className="primary-button" onClick={()=>void createMap()}>CREATE MAP</button></footer></section></div>:null}
  </div>;
}
