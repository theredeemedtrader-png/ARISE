import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type MouseEvent, type ReactNode } from 'react';

import type { AppInfo, AriseApi } from '@arise/shared';

import { Icon } from './icons';
import { TradingChart } from './TradingChart';
import { PlanningWorkspace } from './PlanningWorkspace';
import { KnowledgeWorkspace } from './KnowledgeWorkspace';
import { ReviewWorkspace } from './ReviewWorkspace';
import { StrategyWorkspace } from './StrategyWorkspace';
import { AnalyticsWorkspace } from './AnalyticsWorkspace';
import {
  COMMANDS,
  WORKSPACES,
  closeWorkspace,
  getWorkspace,
  openWorkspace,
  restoreWorkspaceTabs,
  type WorkspaceId,
  type WorkspaceTab,
} from './shell-model';

type Theme = 'dark' | 'light';
type Density = 'compact' | 'standard' | 'comfortable';
type PnlMode = 'PIP-FIRST' | 'PIPS + MONEY' | 'MONEY-FIRST' | '$ HIDDEN';

interface ShellPreferences {
  readonly theme: Theme;
  readonly density: Density;
  readonly pnlMode: PnlMode;
  readonly navigatorOpen: boolean;
}


type PlanningIdeaSummary = Awaited<ReturnType<AriseApi['listPlanningIdeas']>>[number];
type ReviewWorkspaceData = Awaited<ReturnType<AriseApi['getReviewWorkspace']>>;
type Mt5WorkspaceData = Awaited<ReturnType<AriseApi['getMt5Workspace']>>;

const EMPTY_REVIEW_WORKSPACE: ReviewWorkspaceData = { schedules: [], queue: [], automaticTimingAvailable: false };
const EMPTY_MT5_WORKSPACE: Mt5WorkspaceData = { connection:{state:'DISCONNECTED',truth:'UNKNOWN',transportMode:null,sessionId:null,terminalConnected:false,lastMessageAt:null,detail:'Local MT5 Agent unavailable; broker truth is unknown.'},account:null,reconciliation:{status:'UNKNOWN',trigger:null,completedAt:null,discrepancies:[]},symbols:[],quotes:[],candles:[],positions:[],pendingOrders:[],readOnly:true,executionAvailable:false };

interface LegacyIdeaSummary {
  readonly ideaId: string;
  readonly instrumentId: string;
  readonly timeframe: string;
  readonly direction: 'LONG' | 'SHORT' | 'NEUTRAL';
}

const PREFS_KEY = 'arise.shell.preferences.v1';
const TABS_KEY = 'arise.shell.tabs.v1';
const ACTIVE_KEY = 'arise.shell.active.v1';

const DEFAULT_PREFS: ShellPreferences = {
  theme: 'dark',
  density: 'standard',
  pnlMode: 'PIP-FIRST',
  navigatorOpen: true,
};

const WATCHLIST = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'NAS100'];

const iconByWorkspace: Record<WorkspaceId, Parameters<typeof Icon>[0]['name']> = {
  overview: 'overview',
  ideas: 'ideas',
  knowledge: 'knowledge',
  trading: 'trading',
  positions: 'positions',
  strategy: 'strategy',
  database: 'database',
  review: 'review',
  analytics: 'analytics',
  'system-health': 'health',
  settings: 'settings',
};

function readPreferences(): ShellPreferences {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const value = JSON.parse(raw) as Partial<ShellPreferences>;
    return {
      theme: value.theme === 'light' ? 'light' : 'dark',
      density: value.density === 'compact' || value.density === 'comfortable' ? value.density : 'standard',
      pnlMode: value.pnlMode === 'PIPS + MONEY' || value.pnlMode === 'MONEY-FIRST' || value.pnlMode === '$ HIDDEN' ? value.pnlMode : 'PIP-FIRST',
      navigatorOpen: value.navigatorOpen !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function readActiveWorkspace(): WorkspaceId {
  const raw = window.localStorage.getItem(ACTIVE_KEY);
  return WORKSPACES.some((workspace) => workspace.id === raw) ? raw as WorkspaceId : 'overview';
}

function StatusDot({ state }: { readonly state: 'good' | 'idle' | 'warning' }) {
  return <span className={`status-dot status-dot-${state}`} aria-hidden="true" />;
}

function EmptyState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="empty-state">
      <div className="empty-orbit"><Icon name="layers" /></div>
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function PageHeader({ eyebrow, title, subtitle, action }: {
  readonly eyebrow: string;
  readonly title: string;
  readonly subtitle: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action ? <div className="page-actions">{action}</div> : null}
    </div>
  );
}

function OverviewPage({ info, legacyIdeas, planningIdeas, reviews, open }: {
  readonly info: AppInfo | null;
  readonly legacyIdeas: readonly LegacyIdeaSummary[];
  readonly planningIdeas: readonly PlanningIdeaSummary[];
  readonly reviews: ReviewWorkspaceData;
  readonly open: (id: WorkspaceId) => void;
}) {
  const activeIdeas = planningIdeas.filter((idea) => !['COMPLETED','INVALIDATED','CANCELLED','ARCHIVED'].includes(idea.status));
  const dueReviews = reviews.queue.filter((review) => review.status === 'DUE').sort((a,b) => a.dueAt.localeCompare(b.dueAt));
  const nextReview = dueReviews[0] ?? null;
  const colonyCounts = (state: PlanningIdeaSummary['colonyState']) => planningIdeas.filter((idea) => idea.colonyState === state).length;
  return (
    <div className="page-stack">
      <PageHeader eyebrow="COMMAND CENTER" title="Overview" subtitle="What needs attention across planning, execution, review and system health." />
      <div className="metric-grid">
        <button className="metric-card" onClick={() => open('ideas')}>
          <span className="metric-kicker">ACTIVE COLONIES</span>
          <strong>{activeIdeas.length}</strong>
          <small>{activeIdeas.length ? `${planningIdeas.length} total Ideas · versioned Thesis attached` : 'Create an Idea to begin a Colony thesis'}</small>
        </button>
        <button className="metric-card" onClick={() => open('review')}>
          <span className="metric-kicker">NEXT REVIEW</span>
          <strong>{nextReview ? `${nextReview.symbol} · ${nextReview.timeframe}` : reviews.schedules.length ? 'Queue clear' : 'Not scheduled'}</strong>
          <small>{nextReview ? `Due ${new Date(nextReview.dueAt).toLocaleString()}` : reviews.schedules.length ? `${reviews.schedules.length} durable schedule${reviews.schedules.length===1?'':'s'}` : 'Create a Review Schedule when useful'}</small>
        </button>
        <button className="metric-card" onClick={() => open('positions')}>
          <span className="metric-kicker">POSITIONS</span>
          <strong>0 tracked</strong>
          <small>Execution remains disconnected by design</small>
        </button>
        <button className="metric-card" onClick={() => open('system-health')}>
          <span className="metric-kicker">SYSTEM HEALTH</span>
          <strong className="with-dot"><StatusDot state={info?.databaseReady ? 'good' : 'warning'} />{info?.databaseReady ? 'Ready' : 'Starting'}</strong>
          <small>Local database foundation</small>
        </button>
      </div>

      <div className="dashboard-grid">
        <section className="panel panel-large">
          <div className="panel-heading"><div><span>MARKET REVIEW</span><strong>Review queue</strong></div><button onClick={() => open('review')}>Open review <Icon name="chevron" /></button></div>
          <div className="review-strip">
            <div><span>DUE NOW</span><strong>{reviews.queue.filter((r)=>r.status==='DUE').length}</strong></div>
            <div><span>SCHEDULES</span><strong>{reviews.schedules.length}</strong></div>
            <div><span>MISSED</span><strong>{reviews.queue.filter((r)=>r.status==='MISSED').length}</strong></div>
            <div><span>COMPLETED</span><strong>{reviews.queue.filter((r)=>r.status==='COMPLETED').length}</strong></div>
          </div>
          {reviews.queue.length === 0 ? <EmptyState title={reviews.schedules.length ? 'Review queue clear' : 'No review schedule yet'} body={reviews.schedules.length ? 'Manual review cycles are available now. Automatic candle-close generation arrives with TimeframeService.' : 'Create schedules for any supported timeframe; history remains explicit and durable.'} /> : <div className="overview-review-list">{reviews.queue.slice(0,4).map((review)=><button key={review.reviewId} onClick={()=>open('review')}><strong>{review.symbol} · {review.timeframe}</strong><span>{review.status}</span><small>{new Date(review.dueAt).toLocaleString()}</small></button>)}</div>}
        </section>

        <section className="panel">
          <div className="panel-heading"><div><span>LOCAL FOUNDATION</span><strong>Persisted records</strong></div><Icon name="database" /></div>
          <div className="foundation-stat"><span>Legacy M0 ideas</span><strong>{legacyIdeas.length}</strong></div>
          <div className="foundation-stat"><span>SQLite</span><strong>{info?.databaseReady ? 'READY' : 'STARTING'}</strong></div>
          <div className="foundation-stat"><span>App version</span><strong>{info?.version ?? '—'}</strong></div>
          <p className="panel-note">Canonical M1–M5 planning records are local and versioned. ARISE still does not fabricate live market or broker values.</p>
        </section>

        <section className="panel panel-large">
          <div className="panel-heading"><div><span>ACTIVE COLONIES</span><strong>Participation board</strong></div><button onClick={() => open('ideas')}>View Ideas <Icon name="chevron" /></button></div>
          <div className="empty-kanban-preview">
            {(['DORMANT','BUILDING','ESTABLISHED','MATURE'] as const).map((state) => <div key={state}><span>{state}</span><b>{colonyCounts(state)}</b></div>)}
          </div>
          {planningIdeas.length === 0 ? <EmptyState title="No Colonies yet" body="Create an Idea to open a versioned Thesis Canvas and its durable Colony." /> : <div className="overview-colony-list">{planningIdeas.slice(0,4).map((idea)=><button key={idea.colonyId} onClick={()=>open('ideas')}><strong>{idea.symbol} · {idea.timeframe} {idea.direction}</strong><span>{idea.colonyState}</span><small>{idea.colonyLabel}</small></button>)}</div>}
        </section>

        <section className="panel">
          <div className="panel-heading"><div><span>STRATEGY RUNTIME</span><strong>Automation state</strong></div><Icon name="strategy" /></div>
          <div className="system-list compact">
            <div><span><StatusDot state="idle" />Active cascades</span><b>0</b></div>
            <div><span><StatusDot state="idle" />Manual confirmations</span><b>0</b></div>
            <div><span><StatusDot state="idle" />Blocked nodes</span><b>0</b></div>
          </div>
          <p className="panel-note">Strategy Runtime remains intentionally inactive until its dedicated milestone.</p>
        </section>
      </div>
    </div>
  );
}

function IdeasPage({ symbol, theme, onDataChanged }: { readonly symbol: string; readonly theme: Theme; readonly onDataChanged: () => void }) {
  return <PlanningWorkspace defaultSymbol={symbol} theme={theme} onDataChanged={onDataChanged} />;
}

function TradingPage({ symbol, theme }: { readonly symbol: string; readonly theme: Theme }) {
  return (
    <div className="page-stack page-fill trading-page">
      <PageHeader eyebrow="EXECUTE" title="Trading" subtitle="One chart workspace for market context, persistent semantic objects and exact multi-timeframe study. Execution remains intentionally locked." />
      <TradingChart symbol={symbol} theme={theme} />
    </div>
  );
}

function PositionsPage({ mt5, colonies, classify }: { readonly mt5:Mt5WorkspaceData;readonly colonies:readonly PlanningIdeaSummary[];readonly classify:(key:string,value:'ATTACH_TO_COLONY'|'TRACK_AS_EXTERNAL'|'IGNORE',colonyId:string|null)=>void }) {
  return (
    <div className="page-stack">
      <PageHeader eyebrow="BROKER REALITY · READ ONLY" title="Positions" subtitle="MT5 positions and pending orders are imported as broker truth. This surface cannot place, change, cancel, protect, or recreate exposure." />
      <div className="broker-summary"><b>{mt5.connection.truth}</b><span>{mt5.connection.detail}</span><em>{mt5.positions.length} positions · {mt5.pendingOrders.length} pending orders</em></div>
      <div className="broker-grid"><section className="panel broker-list"><div className="panel-heading"><div><span>OPEN AT BROKER</span><strong>External positions</strong></div><b>{mt5.positions.length}</b></div>{mt5.positions.length===0?<EmptyState title="No verified broker positions" body={mt5.connection.truth==='UNKNOWN'?'Broker truth is unavailable. ARISE will not infer an empty account.':'The verified snapshot contains no open positions.'}/>:mt5.positions.map(position=><article key={position.brokerPositionKey} data-testid={`broker-position-${position.brokerPositionKey}`}><header><strong>{position.canonicalSymbol} · {position.direction}</strong><span>{position.volume} lots</span></header><small>{position.brokerPositionKey} · {position.realityState} · {position.classification??'UNCLASSIFIED'}</small><div><button onClick={()=>classify(position.brokerPositionKey,'TRACK_AS_EXTERNAL',null)}>TRACK EXTERNAL</button><button onClick={()=>classify(position.brokerPositionKey,'IGNORE',null)}>IGNORE</button>{colonies[0]?<button onClick={()=>classify(position.brokerPositionKey,'ATTACH_TO_COLONY',colonies[0]!.colonyId)}>ATTACH TO COLONY</button>:null}</div></article>)}</section><section className="panel broker-list"><div className="panel-heading"><div><span>PENDING AT BROKER</span><strong>Read-only orders</strong></div><b>{mt5.pendingOrders.length}</b></div>{mt5.pendingOrders.length===0?<EmptyState title="No verified pending orders" body={mt5.connection.truth==='UNKNOWN'?'Status UNKNOWN until reconciliation succeeds.':'No pending broker orders in the snapshot.'}/>:mt5.pendingOrders.map(order=><article key={order.brokerOrderKey}><header><strong>{order.canonicalSymbol} · {order.orderType}</strong><span>{order.volume} lots</span></header><small>{order.brokerOrderKey} · {order.realityState}</small></article>)}</section></div>
    </div>
  );
}

function KnowledgePage() {
  return <KnowledgeWorkspace />;
}

function StrategyPage() {
  return <StrategyWorkspace />;
}

function DatabasePage({ info, legacyIdeas }: { readonly info: AppInfo | null; readonly legacyIdeas: readonly LegacyIdeaSummary[] }) {
  const rows = [
    ['Ideas + immutable versions', 'READY'], ['Colonies + lineage/events', 'READY'], ['Targets + events', 'READY'], ['Market Objects + revisions', 'READY'], ['Attempts / Trades / Positions', 'READY'], ['Timeframe Projections', 'READY'], ['Strategy Encyclopedia + Maps', 'READY'],
  ] as const;
  return (
    <div className="page-stack">
      <PageHeader eyebrow="STUDY" title="Database" subtitle="Browse canonical current state and reconstruct immutable historical decisions from local SQLite." />
      <div className="database-layout">
        <section className="panel"><div className="panel-heading"><div><span>LOCAL STORE</span><strong>ARISE SQLite</strong></div><span className="health-chip"><StatusDot state={info?.databaseReady ? 'good' : 'warning'} />{info?.databaseReady ? 'HEALTHY' : 'STARTING'}</span></div><div className="foundation-stat"><span>Journal mode</span><strong>WAL</strong></div><div className="foundation-stat"><span>Legacy M0 records</span><strong>{legacyIdeas.length}</strong></div><div className="foundation-stat"><span>Canonical milestone</span><strong>M9</strong></div></section>
        <section className="panel database-capabilities"><div className="panel-heading"><div><span>CANONICAL REPOSITORIES</span><strong>Persistence surface</strong></div></div>{rows.map(([label,status]) => <div key={label}><span>{label}</span><b><StatusDot state="good" />{status}</b></div>)}</section>
      </div>
    </div>
  );
}

function ReviewPage({ symbol, onDataChanged }: { readonly symbol: string; readonly onDataChanged: () => void }) {
  return <ReviewWorkspace defaultSymbol={symbol} onDataChanged={onDataChanged} />;
}

function SystemHealthPage({ info, mt5, reconcile }: { readonly info: AppInfo | null;readonly mt5:Mt5WorkspaceData;readonly reconcile:()=>void }) {
  const systems = [
    ['Database', info?.databaseReady ? 'CONNECTED' : 'RECONNECTING', info?.databaseReady ? 'good' : 'warning'],
    ['MT5 Agent', mt5.connection.state, mt5.connection.state==='CONNECTED'?'good':mt5.connection.state==='DISCONNECTED'?'idle':'warning'],
    ['Broker Truth', mt5.connection.truth, mt5.connection.truth==='VERIFIED'?'good':'warning'],
    ['Quotes', mt5.quotes.length?`${mt5.quotes.length} CURRENT`:'UNAVAILABLE', mt5.quotes.length?'good':'idle'],
    ['Economic Calendar', 'NOT CONFIGURED', 'idle'],
    ['Automation', 'BLOCKED', 'idle'],
  ] as const;
  const product = [
    ['Application', info ? `${info.name} ${info.version}` : 'STARTING'],
    ['Build', info ? `${info.buildCommit} · ${info.buildDate}` : 'STARTING'],
    ['Database schema', info ? String(info.databaseSchemaVersion) : '—'],
    ['MT5 protocol', info ? String(info.mt5ProtocolVersion) : '—'],
    ['Runtime', info?.packaged ? 'PACKAGED WINDOWS APP' : 'DEVELOPMENT'],
    ['Data directory', info?.dataDirectory ?? '—'],
    ['Logs directory', info?.logsDirectory ?? '—'],
  ] as const;
  return <div className="page-stack"><PageHeader eyebrow="UTILITY · READ ONLY" title="System Health" subtitle="Uncertainty is visible. ARISE does not infer that an unavailable subsystem is healthy." action={<button className="primary-button" onClick={reconcile}>RECONCILE NOW</button>}/><section className="panel health-page"><div className="product-identity"><img src="./arise-wordmark.svg" alt="ARISE Trading Systems"/></div><div className="health-summary"><div className="health-ring"><StatusDot state={mt5.connection.truth==='VERIFIED'?'good':'warning'}/></div><div><span>{mt5.connection.transportMode??'LOCAL AGENT'}</span><strong>{mt5.connection.truth==='VERIFIED'?'BROKER REALITY VERIFIED':'RECOVERY REQUIRED'}</strong><small>{mt5.connection.detail} Execution is unavailable.</small></div></div><div className="system-table">{systems.map(([name,state,tone])=><div key={name}><span>{name}</span><b><StatusDot state={tone as 'good'|'idle'|'warning'}/>{state}</b></div>)}</div><div className="product-details">{product.map(([name,value])=><div key={name}><span>{name}</span><b title={value}>{value}</b></div>)}</div><div className="reconciliation-panel"><strong>Last reconciliation: {mt5.reconciliation.status}</strong>{mt5.reconciliation.discrepancies.map(item=><span key={`${item.category}-${item.entityKey}`}>{item.category} · {item.entityType} {item.entityKey} · {item.detail}</span>)}</div></section></div>;
}

function SettingsPage({ preferences, setPreferences }: { readonly preferences: ShellPreferences; readonly setPreferences: (next: ShellPreferences) => void }) {
  const set = <K extends keyof ShellPreferences>(key: K, value: ShellPreferences[K]) => setPreferences({ ...preferences, [key]: value });
  return <div className="page-stack"><PageHeader eyebrow="UTILITY" title="Settings" subtitle="Presentation preferences are local to ARISE and persist across desktop restarts."/><div className="settings-layout"><section className="settings-section"><div><strong>Appearance</strong><span>Dark-first visual language with a dedicated light hierarchy.</span></div><div className="segmented">{(['dark','light'] as const).map((value)=><button key={value} className={preferences.theme===value?'selected':''} onClick={()=>set('theme',value)}>{value.toUpperCase()}</button>)}</div></section><section className="settings-section"><div><strong>Density</strong><span>Live trading can stay compact while study work remains comfortable.</span></div><div className="segmented">{(['compact','standard','comfortable'] as const).map((value)=><button key={value} className={preferences.density===value?'selected':''} onClick={()=>set('density',value)}>{value.toUpperCase()}</button>)}</div></section><section className="settings-section"><div><strong>P&amp;L display</strong><span>Pips remain the primary operational unit. Money can be hidden globally.</span></div><div className="segmented segmented-wrap">{(['PIP-FIRST','PIPS + MONEY','MONEY-FIRST','$ HIDDEN'] as const).map((value)=><button key={value} className={preferences.pnlMode===value?'selected':''} onClick={()=>set('pnlMode',value)}>{value}</button>)}</div></section><section className="settings-section"><div><strong>Market Navigator</strong><span>Keep the structural watchlist visible beside workspaces.</span></div><button className={`toggle ${preferences.navigatorOpen?'on':''}`} onClick={()=>set('navigatorOpen',!preferences.navigatorOpen)} aria-label="Toggle Market Navigator"><span/></button></section></div></div>;
}

function ShellPage({ id, info, legacyIdeas, planningIdeas, reviews, mt5, classifyMt5, reconcileMt5, preferences, setPreferences, open, selectedSymbol, onOperationalDataChanged }: {
  readonly id: WorkspaceId;
  readonly info: AppInfo | null;
  readonly legacyIdeas: readonly LegacyIdeaSummary[];
  readonly planningIdeas: readonly PlanningIdeaSummary[];
  readonly reviews: ReviewWorkspaceData;
  readonly mt5: Mt5WorkspaceData;
  readonly classifyMt5: (key:string,value:'ATTACH_TO_COLONY'|'TRACK_AS_EXTERNAL'|'IGNORE',colonyId:string|null)=>void;
  readonly reconcileMt5: () => void;
  readonly preferences: ShellPreferences;
  readonly setPreferences: (next: ShellPreferences) => void;
  readonly open: (id: WorkspaceId) => void;
  readonly selectedSymbol: string;
  readonly onOperationalDataChanged: () => void;
}) {
  switch (id) {
    case 'overview': return <OverviewPage info={info} legacyIdeas={legacyIdeas} planningIdeas={planningIdeas} reviews={reviews} open={open}/>;
    case 'ideas': return <IdeasPage symbol={selectedSymbol} theme={preferences.theme} onDataChanged={onOperationalDataChanged}/>;
    case 'knowledge': return <KnowledgePage/>;
    case 'trading': return <TradingPage symbol={selectedSymbol} theme={preferences.theme}/>;
    case 'positions': return <PositionsPage mt5={mt5} colonies={planningIdeas} classify={classifyMt5}/>;
    case 'strategy': return <StrategyPage/>;
    case 'database': return <DatabasePage info={info} legacyIdeas={legacyIdeas}/>;
    case 'review': return <ReviewPage symbol={selectedSymbol} onDataChanged={onOperationalDataChanged}/>;
    case 'analytics': return <AnalyticsWorkspace pnlMode={preferences.pnlMode}/>;
    case 'system-health': return <SystemHealthPage info={info} mt5={mt5} reconcile={reconcileMt5}/>;
    case 'settings': return <SettingsPage preferences={preferences} setPreferences={setPreferences}/>;
  }
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [legacyIdeas, setLegacyIdeas] = useState<readonly LegacyIdeaSummary[]>([]);
  const [planningIdeas, setPlanningIdeas] = useState<readonly PlanningIdeaSummary[]>([]);
  const [reviews, setReviews] = useState<ReviewWorkspaceData>(EMPTY_REVIEW_WORKSPACE);
  const [mt5, setMt5] = useState<Mt5WorkspaceData>(EMPTY_MT5_WORKSPACE);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<readonly WorkspaceTab[]>(() => restoreWorkspaceTabs(window.localStorage.getItem(TABS_KEY)));
  const [activeId, setActiveId] = useState<WorkspaceId>(() => readActiveWorkspace());
  const [preferences, setPreferences] = useState<ShellPreferences>(() => readPreferences());
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD');

  useEffect(() => {
    if (!window.arise) {
      setError('ARISE desktop bridge is unavailable. Start the Electron app.');
      return;
    }
    Promise.all([window.arise.getAppInfo(), window.arise.listIdeas(), window.arise.listPlanningIdeas(), window.arise.getReviewWorkspace(), window.arise.getMt5Workspace()])
      .then(([nextInfo, ideas, nextPlanningIdeas, nextReviews, nextMt5]) => {
        setInfo(nextInfo);
        setLegacyIdeas(ideas);
        setPlanningIdeas(nextPlanningIdeas);
        setReviews(nextReviews);
        setMt5(nextMt5);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => { const poll=window.setInterval(()=>void window.arise.getMt5Workspace().then(setMt5).catch(()=>undefined),500);return()=>window.clearInterval(poll); }, []);
  const classifyMt5=useCallback((brokerPositionKey:string,classification:'ATTACH_TO_COLONY'|'TRACK_AS_EXTERNAL'|'IGNORE',colonyId:string|null)=>{void window.arise.classifyExternalPosition({brokerPositionKey,classification,colonyId}).then(setMt5).catch((err:unknown)=>setError(err instanceof Error?err.message:String(err)));},[]);
  const reconcileMt5=useCallback(()=>{void window.arise.reconcileMt5().then(setMt5).catch((err:unknown)=>setError(err instanceof Error?err.message:String(err)));},[]);

  const refreshOperationalData = useCallback(() => {
    if (!window.arise) return;
    void Promise.all([window.arise.listPlanningIdeas(), window.arise.getReviewWorkspace()])
      .then(([nextPlanningIdeas, nextReviews]) => { setPlanningIdeas(nextPlanningIdeas); setReviews(nextReviews); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (activeId === 'overview' || activeId === 'ideas' || activeId === 'review') refreshOperationalData();
  }, [activeId, refreshOperationalData]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeId)) {
      setActiveId(tabs[tabs.length - 1]?.id ?? 'overview');
    }
  }, [tabs, activeId]);

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.density = preferences.density;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    window.localStorage.setItem(TABS_KEY, JSON.stringify(tabs.map((tab) => tab.id)));
    window.localStorage.setItem(ACTIVE_KEY, activeId);
  }, [tabs, activeId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((value) => !value);
        setCommandQuery('');
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = useCallback((id: WorkspaceId) => {
    setTabs((current) => openWorkspace(current, id));
    setActiveId(id);
  }, []);

  const close = useCallback((id: WorkspaceId) => {
    setTabs((current) => {
      const result = closeWorkspace(current, id, activeId);
      setActiveId(result.activeId);
      return result.tabs;
    });
  }, [activeId]);

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return COMMANDS;
    return COMMANDS.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(query));
  }, [commandQuery]);

  const groupedNavigation = useMemo(() => [
    ['PRIMARY', WORKSPACES.filter((workspace) => workspace.group === 'PRIMARY')],
    ['PLAN', WORKSPACES.filter((workspace) => workspace.group === 'PLAN')],
    ['EXECUTE', WORKSPACES.filter((workspace) => workspace.group === 'EXECUTE')],
    ['BUILD', WORKSPACES.filter((workspace) => workspace.group === 'BUILD')],
    ['STUDY', WORKSPACES.filter((workspace) => workspace.group === 'STUDY')],
  ] as const, []);

  const activeWorkspace = getWorkspace(activeId);
  const selectedSymbolIdeas = planningIdeas.filter((idea) => idea.symbol === selectedSymbol && !['COMPLETED','INVALIDATED','CANCELLED','ARCHIVED'].includes(idea.status));
  const selectedSymbolSchedules = reviews.schedules.filter((schedule) => schedule.symbol === selectedSymbol);
  const selectedSymbolDue = reviews.queue.filter((review) => review.symbol === selectedSymbol && review.status === 'DUE');
  const nextDueReview = reviews.queue.filter((review) => review.status === 'DUE').sort((a,b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;

  return (
    <div className={`app-shell ${preferences.navigatorOpen ? 'navigator-visible' : 'navigator-hidden'}`}>
      <aside className="sidebar">
        <button className="brand-button" onClick={() => open('overview')} aria-label="Open Overview"><img className="brand-mark" src="./arise-symbol.svg" alt=""/><span className="brand-word">ARISE</span></button>
        <nav className="primary-nav">
          {groupedNavigation.map(([group, entries]) => <div className="nav-group" key={group}>{group !== 'PRIMARY' ? <span className="nav-label">{group}</span> : null}{entries.map((workspace) => <button key={workspace.id} className={activeId===workspace.id?'active':''} onClick={()=>open(workspace.id)} title={workspace.description}><Icon name={iconByWorkspace[workspace.id]}/><span>{workspace.label}</span></button>)}</div>)}
        </nav>
        <div className="utility-nav"><span className="nav-label">UTILITY</span>{WORKSPACES.filter((workspace)=>workspace.group==='UTILITY').map((workspace)=><button key={workspace.id} className={activeId===workspace.id?'active':''} onClick={()=>open(workspace.id)}><Icon name={iconByWorkspace[workspace.id]}/><span>{workspace.label}</span>{workspace.id==='system-health'?<StatusDot state={info?.databaseReady?'good':'warning'}/>:null}</button>)}</div>
        <div className="sidebar-motto">DISCIPLINE<br/>CREATES FREEDOM</div>
      </aside>

      <section className="workspace-area">
        <header className="topbar">
          <button className="command-trigger" onClick={()=>setCommandOpen(true)}><Icon name="search"/><span>Search ARISE or run a command</span><kbd>Ctrl K</kbd></button>
          <div className="topbar-context"><span className="context-symbol">{selectedSymbol}</span><button className="next-review" onClick={()=>open('review')}><Icon name="clock"/><span>{nextDueReview ? `${nextDueReview.timeframe} Review` : 'Next Review'}</span><b>{nextDueReview ? nextDueReview.symbol : '—'}</b></button><button className="icon-button" aria-label="Notifications"><Icon name="bell"/><i>0</i></button><button className="health-button status" onClick={()=>open('system-health')}><StatusDot state={info?.databaseReady?'good':'warning'}/>{info?.databaseReady?'DATABASE READY':'STARTING'}</button><button className="icon-button" onClick={()=>setPreferences({...preferences,navigatorOpen:!preferences.navigatorOpen})} aria-label="Toggle Market Navigator"><Icon name="panel"/></button></div>
        </header>

        <div className="workspace-tabs" role="tablist" aria-label="Open workspaces">
          {tabs.map((tab)=><div key={tab.id} className={`workspace-tab ${tab.id===activeId?'active':''}`}><button onClick={()=>setActiveId(tab.id)}>{tab.label}</button>{tab.closeable?<button className="tab-close" onClick={()=>close(tab.id)} aria-label={`Close ${tab.label}`}><Icon name="close"/></button>:null}</div>)}
          <button className="tab-add" onClick={()=>setCommandOpen(true)} aria-label="Open workspace"><Icon name="plus"/></button>
          <span className="workspace-context">{activeWorkspace.description}</span>
        </div>

        <main className="workspace-content"><ShellPage id={activeId} info={info} legacyIdeas={legacyIdeas} planningIdeas={planningIdeas} reviews={reviews} mt5={mt5} classifyMt5={classifyMt5} reconcileMt5={reconcileMt5} preferences={preferences} setPreferences={setPreferences} open={open} selectedSymbol={selectedSymbol} onOperationalDataChanged={refreshOperationalData}/>{error ? <div className="error">{error}</div> : null}</main>
      </section>

      {preferences.navigatorOpen ? <aside className="navigator">
        <div className="navigator-heading"><div><span>MARKET</span><strong>Navigator</strong></div><button aria-label="Add symbol" disabled title="Watchlist editing is not implemented yet"><Icon name="plus"/></button></div>
        <div className="navigator-search"><Icon name="search"/><span>Search symbols…</span></div>
        <div className="watchlist-heading"><span>WATCHLIST</span><b>{WATCHLIST.length}</b></div>
        <div className="watchlist">{WATCHLIST.map((symbol)=>{const quote=mt5.quotes.find(item=>item.canonicalSymbol===symbol);return <button key={symbol} className={selectedSymbol===symbol?'selected':''} onClick={()=>setSelectedSymbol(symbol)}><div><strong>{symbol}</strong><span>{symbol==='NAS100'?'INDEX':'FX / CFD'}</span></div><div className="watch-state"><span>{quote?quote.bid.toFixed(mt5.symbols.find(item=>item.canonicalSymbol===symbol)?.digits??5):'—'}</span><small>{quote?'BROKER':'OFFLINE'}</small></div></button>})}</div>
        <div className="navigator-section"><div className="navigator-section-title"><span>COLONY CONTEXT</span><b>{selectedSymbolIdeas.length}</b></div>{selectedSymbolIdeas.length ? selectedSymbolIdeas.slice(0,3).map((idea)=><button className="navigator-colony-row" key={idea.colonyId} onClick={()=>open('ideas')}><strong>{idea.timeframe} {idea.direction}</strong><span>{idea.status.replaceAll('_',' ')}</span><small>{idea.targetDescription || idea.colonyLabel}</small></button>) : <div className="navigator-empty">No active Colony for {selectedSymbol}</div>}</div>
        <div className="navigator-section"><div className="navigator-section-title"><span>REVIEW FRESHNESS</span><Icon name="clock"/></div><div className="freshness-row"><span>{selectedSymbol}</span><b>{selectedSymbolDue.length ? 'DUE' : selectedSymbolSchedules.length ? 'CURRENT' : 'NOT SCHEDULED'}</b></div>{selectedSymbolSchedules.slice(0,3).map((schedule)=><div className="freshness-detail" key={schedule.id}><span>{schedule.timeframe}</span><small>{schedule.frequencyType.replaceAll('_',' ')}</small></div>)}</div>
        <div className="navigator-footer"><StatusDot state={mt5.connection.truth==='VERIFIED'?'good':'idle'}/><span>{mt5.connection.truth==='VERIFIED'?'Broker feed · read only':'Market feed disconnected'}</span></div>
      </aside> : null}

      {commandOpen ? <div className="command-backdrop" onMouseDown={()=>setCommandOpen(false)}><section className="command-palette" onMouseDown={(event: MouseEvent<HTMLElement>)=>event.stopPropagation()}><div className="command-input"><Icon name="search"/><input autoFocus value={commandQuery} onChange={(event: ChangeEvent<HTMLInputElement>)=>setCommandQuery(event.target.value)} placeholder="Search workspaces, symbols, commands…"/><kbd>ESC</kbd></div><div className="command-results"><span className="command-section-label">NAVIGATE</span>{filteredCommands.length ? filteredCommands.map((command)=><button key={command.id} onClick={()=>{open(command.workspaceId);setCommandOpen(false);}}><Icon name={iconByWorkspace[command.workspaceId]}/><div><strong>{command.label}</strong><span>{command.hint}</span></div><Icon name="chevron"/></button>) : <div className="no-command">No matching commands</div>}</div></section></div> : null}
    </div>
  );
}
