import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AriseChartController,
  CHART_TIMEFRAMES,
  createDemoCandles,
  decodeDrawingGeometry,
  encodeDrawingGeometry,
  lowerTimeframes,
  projectCandle,
  type AriseCandle,
  type CandleProjection,
  type ChartDrawing,
  type ChartPoint,
  type ChartTimeframeCode,
  type DrawingGeometry,
} from '@arise/charting';
import { Icon } from './icons';

type DrawingTool = 'SELECT' | 'LINE' | 'RAY' | 'RECTANGLE' | 'TRENDLINE' | 'POINT' | 'TEXT';
type Theme = 'dark' | 'light';

interface Props {
  readonly symbol: string;
  readonly theme: Theme;
}

const TOOL_ICON: Record<DrawingTool, Parameters<typeof Icon>[0]['name']> = {
  SELECT: 'cursor',
  LINE: 'minus',
  RAY: 'arrow',
  RECTANGLE: 'rectangle',
  TRENDLINE: 'trend',
  POINT: 'target',
  TEXT: 'text',
};

const SEMANTICS = ['GENERIC_ZONE', 'FVG', 'ORDER_BLOCK', 'LIQUIDITY_ZONE', 'RANGE', 'PREMIUM_DISCOUNT', 'TARGET_ZONE', 'INVALIDATION_ZONE'] as const;
const ROLES = ['REFERENCE', 'AREA', 'TRIGGER', 'TARGET', 'INVALIDATION', 'PROTECTION', 'CONFIRMATION', 'ORIGIN'] as const;

function toDrawing(raw: Awaited<ReturnType<typeof window.arise.listChartObjects>>[number]): ChartDrawing | null {
  const geometry = decodeDrawingGeometry(raw.geometryJson);
  if (!geometry) return null;
  return {
    id: raw.id,
    versionId: raw.versionId,
    versionNo: raw.versionNo,
    geometryType: raw.geometryType,
    semanticType: raw.semanticType,
    role: raw.role,
    name: raw.name,
    timeframe: raw.timeframe !== null && CHART_TIMEFRAMES.includes(raw.timeframe as ChartTimeframeCode)
      ? raw.timeframe as ChartTimeframeCode
      : null,
    geometry,
  };
}

function shiftGeometry(geometry: DrawingGeometry, priceDelta: number): DrawingGeometry {
  const shift = (point: ChartPoint) => ({ ...point, price: point.price + priceDelta });
  switch (geometry.kind) {
    case 'LINE':
    case 'RAY':
    case 'TRENDLINE':
    case 'RECTANGLE':
      return { kind: geometry.kind, start: shift(geometry.start), end: shift(geometry.end) };
    case 'POINT':
    case 'CANDLE_REFERENCE':
      return { kind: geometry.kind, point: shift(geometry.point) };
    case 'TEXT':
      return { kind: geometry.kind, point: shift(geometry.point), text: geometry.text };
  }
}

function DrawingShape({ drawing, controller, selected, onSelect }: {
  readonly drawing: ChartDrawing;
  readonly controller: AriseChartController;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const coord = (point: ChartPoint) => {
    const x = controller.timeToX(point.time);
    const y = controller.priceToY(point.price);
    return x === null || y === null ? null : { x, y };
  };
  const className = `market-shape market-shape-${drawing.role.toLowerCase()} ${selected ? 'selected' : ''}`;
  const geometry = drawing.geometry;
  if (geometry.kind === 'RECTANGLE') {
    const a = coord(geometry.start); const b = coord(geometry.end);
    if (!a || !b) return null;
    return <rect className={className} x={Math.min(a.x,b.x)} y={Math.min(a.y,b.y)} width={Math.abs(b.x-a.x)} height={Math.abs(b.y-a.y)} rx="3" onPointerDown={(event: { stopPropagation(): void })=>{event.stopPropagation();onSelect();}}/>;
  }
  if (geometry.kind === 'LINE' || geometry.kind === 'RAY' || geometry.kind === 'TRENDLINE') {
    const a = coord(geometry.start); const b = coord(geometry.end);
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const rayScale = geometry.kind === 'RAY' && dx !== 0
      ? Math.max(1, (dx > 0 ? controller.width() - a.x : -a.x) / dx)
      : 1;
    const endX = geometry.kind === 'RAY' ? a.x + dx * rayScale : b.x;
    const endY = geometry.kind === 'RAY' ? a.y + (b.y - a.y) * rayScale : b.y;
    return <line className={className} x1={a.x} y1={a.y} x2={endX} y2={endY} onPointerDown={(event: { stopPropagation(): void })=>{event.stopPropagation();onSelect();}}/>;
  }
  if (geometry.kind === 'TEXT') {
    const valuePoint = coord(geometry.point);
    if (!valuePoint) return null;
    return <text className={className} x={valuePoint.x+6} y={valuePoint.y-6} onPointerDown={(event: { stopPropagation(): void })=>{event.stopPropagation();onSelect();}}>{geometry.text}</text>;
  }
  if (geometry.kind === 'POINT' || geometry.kind === 'CANDLE_REFERENCE') {
    const valuePoint = coord(geometry.point);
    if (!valuePoint) return null;
    return <circle className={className} cx={valuePoint.x} cy={valuePoint.y} r={selected ? 6 : 4} onPointerDown={(event: { stopPropagation(): void })=>{event.stopPropagation();onSelect();}}/>;
  }
  return null;
}

function ProjectionShape({ projection, controller, active }: { readonly projection: CandleProjection; readonly controller: AriseChartController; readonly active: boolean }) {
  const x1 = controller.timeToX(projection.intervalStart);
  const x2 = controller.timeToX(projection.intervalEnd);
  const y1 = controller.priceToY(projection.high);
  const y2 = controller.priceToY(projection.low);
  if ([x1,x2,y1,y2].some((value)=>value===null)) return null;
  return <g className={`projection-shape ${active ? 'active' : ''}`}>
    <rect x={Math.min(x1!,x2!)} y={Math.min(y1!,y2!)} width={Math.abs(x2!-x1!)} height={Math.abs(y2!-y1!)} rx="3"/>
    <text x={Math.min(x1!,x2!)+8} y={Math.min(y1!,y2!)+17}>{projection.label}</text>
  </g>;
}

export function TradingChart({ symbol, theme }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<AriseChartController | null>(null);
  const dragStartRef = useRef<ChartPoint | null>(null);
  const [timeframe, setTimeframe] = useState<ChartTimeframeCode>('H1');
  const [tool, setTool] = useState<DrawingTool>('SELECT');
  const [semanticType, setSemanticType] = useState<string>('FVG');
  const [role, setRole] = useState<(typeof ROLES)[number]>('AREA');
  const [objects, setObjects] = useState<readonly ChartDrawing[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedCandle, setSelectedCandle] = useState<AriseCandle | null>(null);
  const [projectionStack, setProjectionStack] = useState<readonly CandleProjection[]>([]);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof window.arise.getChartCatalog>> | null>(null);
  const [overlayEpoch, setOverlayEpoch] = useState(0);
  const [status, setStatus] = useState('DEMO SERIES');

  const candles = useMemo(() => createDemoCandles(symbol, timeframe), [symbol, timeframe]);
  const visibleObjects = useMemo(() => objects.filter((entry) => entry.timeframe === null || entry.timeframe === timeframe), [objects, timeframe]);
  const selectedObject = objects.find((entry) => entry.id === selectedObjectId) ?? null;
  const instrument = catalog?.instruments.find((entry) => entry.symbol === symbol) ?? null;

  const loadObjects = useCallback(async () => {
    if (!window.arise) return;
    const rows = await window.arise.listChartObjects({ symbol });
    setObjects(rows.map(toDrawing).filter((entry): entry is ChartDrawing => entry !== null));
  }, [symbol]);

  useEffect(() => {
    window.arise?.getChartCatalog().then(setCatalog).catch(() => setStatus('CATALOG ERROR'));
  }, []);

  useEffect(() => {
    loadObjects().catch(() => setStatus('OBJECT LOAD ERROR'));
    setSelectedObjectId(null);
    setSelectedCandle(null);
    setProjectionStack([]);
  }, [loadObjects]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const controller = new AriseChartController(host, theme);
    controllerRef.current = controller;
    controller.onClick((click) => setSelectedCandle(click.candle));
    controller.setData(candles);
    controller.fitContent();
    const onViewport = () => setOverlayEpoch((value) => value + 1);
    host.addEventListener('wheel', onViewport, { passive: true });
    host.addEventListener('pointermove', onViewport);
    return () => {
      host.removeEventListener('wheel', onViewport);
      host.removeEventListener('pointermove', onViewport);
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setTheme(theme);
    setOverlayEpoch((value)=>value+1);
  }, [theme]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !instrument) return;
    controller.setPriceFormat(instrument.priceDigits, instrument.tickSize);
  }, [instrument]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setData(candles);
    controller.fitContent();
    setSelectedCandle(null);
    setOverlayEpoch((value)=>value+1);
  }, [candles]);

  const persistDrawing = async (start: ChartPoint, end: ChartPoint) => {
    const geometryType = tool === 'SELECT' ? 'RECTANGLE' : tool;
    let geometry: DrawingGeometry;
    if (geometryType === 'POINT') geometry = { kind: 'POINT', point: end };
    else if (geometryType === 'TEXT') geometry = { kind: 'TEXT', point: end, text: semanticType.replaceAll('_',' ') };
    else geometry = { kind: geometryType, start, end } as DrawingGeometry;
    const sameTypeCount = objects.filter((entry)=>entry.semanticType===semanticType).length + 1;
    const created = await window.arise.createChartObject({
      symbol,
      timeframe,
      geometryType,
      semanticType,
      role,
      name: `${timeframe} ${semanticType.replaceAll('_',' ')} #${sameTypeCount}`,
      geometryJson: encodeDrawingGeometry(geometry),
      semanticPropertiesJson: { layer: 'GLOBAL', source: 'MANUAL_CHART' },
    });
    const drawing = toDrawing(created);
    if (drawing) {
      setObjects((current)=>[...current,drawing]);
      setSelectedObjectId(drawing.id);
      setTool('SELECT');
      setStatus('OBJECT SAVED');
    }
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'SELECT') return;
    const point = controllerRef.current?.pointFromClient(event.clientX, event.clientY) ?? null;
    if (!point) return;
    dragStartRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'SELECT') return;
    const start = dragStartRef.current;
    const end = controllerRef.current?.pointFromClient(event.clientX, event.clientY) ?? null;
    dragStartRef.current = null;
    if (!start || !end) return;
    persistDrawing(start, end).catch(() => setStatus('SAVE ERROR'));
  };

  const nudgeSelected = async (direction: 1 | -1) => {
    if (!selectedObject || !instrument) return;
    const geometry = shiftGeometry(selectedObject.geometry, instrument.pipSize * direction);
    const revised = await window.arise.reviseChartObject({ marketObjectId: selectedObject.id, geometryJson: encodeDrawingGeometry(geometry) });
    const drawing = toDrawing(revised);
    if (!drawing) return;
    setObjects((current)=>current.map((entry)=>entry.id===drawing.id?drawing:entry));
    setStatus(`REVISION v${drawing.versionNo} SAVED`);
  };

  const expandTo = (targetTimeframe: ChartTimeframeCode) => {
    if (!selectedCandle) return;
    const projection = projectCandle(selectedCandle, timeframe, targetTimeframe);
    setProjectionStack((current)=>[...current,projection]);
    setTimeframe(targetTimeframe);
  };

  const showParent = () => {
    const current = projectionStack.at(-1);
    if (!current) return;
    setTimeframe(current.sourceTimeframe);
    setProjectionStack((stack)=>stack.slice(0,-1));
  };

  return <div className="m4-trading-workspace" data-testid="m4-chart-workspace">
    <section className="chart-workbench">
      <header className="chart-toolbar m4-chart-toolbar">
        <div className="chart-symbol-block"><strong>{symbol}</strong><span>{instrument?.displayName ?? 'Market'}</span></div>
        <div className="timeframe-tabs">{CHART_TIMEFRAMES.map((entry)=><button key={entry} className={entry===timeframe?'selected':''} onClick={()=>{setTimeframe(entry);setProjectionStack([]);}}>{entry}</button>)}</div>
        <div className="chart-context-mode"><button className="selected">MASTER</button><button disabled>COLONY</button></div>
        <button className="chart-fit-button" onClick={()=>controllerRef.current?.fitContent()} title="Fit chart">FIT</button>
        <span className="offline-pill demo-pill"><span className="status-dot status-dot-warning"/> {status}</span>
      </header>

      <div className="chart-stage">
        <div className="drawing-toolbar" aria-label="Drawing tools">{(['SELECT','LINE','RAY','RECTANGLE','TRENDLINE','POINT','TEXT'] as const).map((entry)=><button key={entry} className={tool===entry?'active':''} onClick={()=>setTool(entry)} title={entry}><Icon name={TOOL_ICON[entry]}/></button>)}</div>
        <div ref={hostRef} className="arise-chart-host" data-testid="lightweight-chart-host"/>
        <svg data-epoch={overlayEpoch} className={`market-overlay ${tool!=='SELECT'?'drawing-active':''}`} onPointerDown={pointerDown} onPointerUp={pointerUp}>
          {projectionStack.map((projection,index)=><ProjectionShape key={projection.id} projection={projection} controller={controllerRef.current!} active={index===projectionStack.length-1}/>) }
          {controllerRef.current ? visibleObjects.map((drawing)=><DrawingShape key={`${drawing.id}:${drawing.versionNo}`} drawing={drawing} controller={controllerRef.current!} selected={drawing.id===selectedObjectId} onSelect={()=>setSelectedObjectId(drawing.id)}/>) : null}
        </svg>
        <div className="chart-attribution-note">Chart engine: TradingView Lightweight Charts™</div>
      </div>

      <footer className="projection-bar">
        <div className="projection-breadcrumb"><span>CONTEXT</span><button onClick={()=>setProjectionStack([])}>{timeframe}</button>{projectionStack.map((projection)=><span key={projection.id}>› {projection.label}</span>)}</div>
        <div className="projection-actions">
          {projectionStack.length ? <button onClick={showParent}>SHOW PARENT CANDLE</button> : null}
          <span>{selectedCandle ? `Selected ${timeframe} candle · H ${selectedCandle.high.toFixed(instrument?.priceDigits ?? 5)} / L ${selectedCandle.low.toFixed(instrument?.priceDigits ?? 5)}` : 'Click a candle to enable timeframe projection'}</span>
          {selectedCandle ? lowerTimeframes(timeframe).map((target)=><button key={target} onClick={()=>expandTo(target)}>EXPAND TO {target}</button>) : null}
        </div>
      </footer>
    </section>

    <aside className="chart-inspector">
      <div className="inspector-tabs"><button className="active">OBJECTS</button><button>LAYERS</button><button disabled>EXECUTION</button></div>
      <section className="inspector-section semantic-controls">
        <span className="section-label">NEW MARKET OBJECT</span>
        <label>Meaning<select value={semanticType} onChange={(event: { target: { value: string } })=>setSemanticType(event.target.value)}>{SEMANTICS.map((entry)=><option key={entry}>{entry}</option>)}</select></label>
        <label>Role<select value={role} onChange={(event: { target: { value: string } })=>setRole(event.target.value as typeof role)}>{ROLES.map((entry)=><option key={entry}>{entry}</option>)}</select></label>
        <p>Choose geometry on the chart toolbar, then drag on the chart. Geometry defines shape; these properties define meaning.</p>
      </section>
      <section className="inspector-section object-list-section">
        <div className="inspector-heading"><span>MARKET OBJECTS</span><b>{visibleObjects.length}</b></div>
        <div className="object-list">{visibleObjects.length ? visibleObjects.map((entry)=><button key={entry.id} className={entry.id===selectedObjectId?'selected':''} onClick={()=>setSelectedObjectId(entry.id)}><span className={`object-role-marker role-${entry.role.toLowerCase()}`}/><div><strong>{entry.name}</strong><span>{entry.semanticType} · {entry.role}</span></div><b>v{entry.versionNo}</b></button>) : <div className="object-empty">No Market Objects on {symbol} {timeframe}.<br/>Draw one directly on the chart.</div>}</div>
      </section>
      {selectedObject ? <section className="inspector-section selected-object-card">
        <span className="section-label">SELECTED OBJECT</span>
        <h3>{selectedObject.name}</h3>
        <div><span>Geometry</span><b>{selectedObject.geometryType}</b></div>
        <div><span>Meaning</span><b>{selectedObject.semanticType}</b></div>
        <div><span>Role</span><b>{selectedObject.role}</b></div>
        <div><span>Version</span><b>v{selectedObject.versionNo}</b></div>
        <div className="object-nudge"><button onClick={()=>nudgeSelected(1)}>+1 PIP</button><button onClick={()=>nudgeSelected(-1)}>−1 PIP</button></div>
        <small>Nudging creates a new immutable MarketObjectVersion; earlier geometry remains reconstructable.</small>
      </section> : null}
      <section className="inspector-section execution-lock">
        <span className="section-label">EXECUTION</span><strong>LOCKED</strong><p>Charting is operational, but broker actions remain unavailable until the explicit MT5 demo execution gate.</p>
      </section>
    </aside>
  </div>;
}
