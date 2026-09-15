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

type DrawingTool = 'SELECT' | 'HORIZONTAL' | 'LINE' | 'RAY' | 'RECTANGLE' | 'TRENDLINE' | 'POINT' | 'TEXT';
type Theme = 'dark' | 'light';
type InspectorTab = 'OBJECTS' | 'LAYERS' | 'EXECUTION';
type EditHandle = 'BODY' | 'START' | 'END' | 'POINT';

interface Props {
  readonly symbol: string;
  readonly theme: Theme;
}

interface EditSession {
  readonly objectId: string;
  readonly handle: EditHandle;
  readonly originPointer: ChartPoint;
  readonly originGeometry: DrawingGeometry;
}

interface EditPreview {
  readonly objectId: string;
  readonly geometry: DrawingGeometry;
}

const TOOL_ICON: Record<DrawingTool, Parameters<typeof Icon>[0]['name']> = {
  SELECT: 'cursor',
  HORIZONTAL: 'minus',
  LINE: 'minus',
  RAY: 'arrow',
  RECTANGLE: 'rectangle',
  TRENDLINE: 'trend',
  POINT: 'target',
  TEXT: 'text',
};

const SEMANTICS = ['GENERIC_ZONE', 'FVG', 'ORDER_BLOCK', 'LIQUIDITY_ZONE', 'RANGE', 'PREMIUM_DISCOUNT', 'TARGET_ZONE', 'INVALIDATION_ZONE'] as const;
const ROLES = ['REFERENCE', 'AREA', 'TRIGGER', 'TARGET', 'INVALIDATION', 'PROTECTION', 'CONFIRMATION', 'ORIGIN'] as const;
const MT5_TIMEFRAME: Readonly<Record<ChartTimeframeCode, string>> = Object.freeze({
  M5: 'M5',
  M15: 'M15',
  H1: 'H1',
  H4: 'H4',
  D: 'D1',
  W: 'W1',
});

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

function toChartCandles(
  workspace: Awaited<ReturnType<typeof window.arise.getMt5Workspace>>,
  symbol: string,
  timeframe: ChartTimeframeCode,
): readonly AriseCandle[] {
  const mt5Timeframe = MT5_TIMEFRAME[timeframe];
  const liveCandles = workspace.candles
    .filter((entry) => entry.canonicalSymbol === symbol && entry.timeframe === mt5Timeframe)
    .map((entry) => ({
      time: Math.floor(Date.parse(entry.openTime) / 1000),
      open: entry.open,
      high: entry.high,
      low: entry.low,
      close: entry.close,
    }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((left, right) => left.time - right.time);
  if (liveCandles.length > 0 || workspace.connection.state === 'CONNECTED') return liveCandles;
  return createDemoCandles(symbol, timeframe);
}

function movePoint(point: ChartPoint, timeDelta: number, priceDelta: number): ChartPoint {
  return { time: point.time + timeDelta, price: point.price + priceDelta };
}

function translateGeometry(geometry: DrawingGeometry, timeDelta: number, priceDelta: number): DrawingGeometry {
  const move = (point: ChartPoint) => movePoint(point, timeDelta, priceDelta);
  switch (geometry.kind) {
    case 'LINE':
    case 'RAY':
    case 'TRENDLINE':
    case 'RECTANGLE':
      return { kind: geometry.kind, start: move(geometry.start), end: move(geometry.end) };
    case 'POINT':
    case 'CANDLE_REFERENCE':
      return { kind: geometry.kind, point: move(geometry.point) };
    case 'TEXT':
      return { kind: geometry.kind, point: move(geometry.point), text: geometry.text };
  }
}

function editGeometry(
  geometry: DrawingGeometry,
  handle: EditHandle,
  originPointer: ChartPoint,
  currentPointer: ChartPoint,
): DrawingGeometry {
  if (handle === 'BODY') {
    return translateGeometry(
      geometry,
      currentPointer.time - originPointer.time,
      currentPointer.price - originPointer.price,
    );
  }
  if (geometry.kind === 'LINE' || geometry.kind === 'RAY' || geometry.kind === 'TRENDLINE') {
    const horizontal = geometry.kind === 'LINE' && Math.abs(geometry.start.price - geometry.end.price) <= 1e-12;
    if (handle === 'START') {
      if (horizontal) {
        return {
          kind: geometry.kind,
          start: currentPointer,
          end: { ...geometry.end, price: currentPointer.price },
        };
      }
      return { kind: geometry.kind, start: currentPointer, end: geometry.end };
    }
    if (handle === 'END') {
      if (horizontal) {
        return {
          kind: geometry.kind,
          start: { ...geometry.start, price: currentPointer.price },
          end: currentPointer,
        };
      }
      return { kind: geometry.kind, start: geometry.start, end: currentPointer };
    }
  }
  if (geometry.kind === 'RECTANGLE') {
    if (handle === 'START') return { kind: 'RECTANGLE', start: currentPointer, end: geometry.end };
    if (handle === 'END') return { kind: 'RECTANGLE', start: geometry.start, end: currentPointer };
  }
  if (handle === 'POINT') {
    if (geometry.kind === 'POINT' || geometry.kind === 'CANDLE_REFERENCE')
      return { kind: geometry.kind, point: currentPointer };
    if (geometry.kind === 'TEXT')
      return { kind: 'TEXT', point: currentPointer, text: geometry.text };
  }
  return geometry;
}

function sameGeometry(left: DrawingGeometry, right: DrawingGeometry): boolean {
  return JSON.stringify(encodeDrawingGeometry(left)) === JSON.stringify(encodeDrawingGeometry(right));
}

function shiftGeometry(geometry: DrawingGeometry, priceDelta: number): DrawingGeometry {
  return translateGeometry(geometry, 0, priceDelta);
}

function geometryForTool(tool: Exclude<DrawingTool, 'SELECT'>, start: ChartPoint, end: ChartPoint, semanticType: string): DrawingGeometry {
  if (tool === 'POINT') return { kind: 'POINT', point: end };
  if (tool === 'TEXT') return { kind: 'TEXT', point: end, text: semanticType.replaceAll('_', ' ') };
  if (tool === 'HORIZONTAL') return { kind: 'LINE', start, end: { ...end, price: start.price } };
  return { kind: tool, start, end } as DrawingGeometry;
}

function DrawingNode({ x, y, handle, onEditStart }: {
  readonly x: number;
  readonly y: number;
  readonly handle: EditHandle;
  readonly onEditStart: (handle: EditHandle, event: ReactPointerEvent<SVGElement>) => void;
}) {
  return <circle
    cx={x}
    cy={y}
    r={handle === 'BODY' ? 4 : 5}
    fill="var(--surface-0)"
    stroke="var(--blue-bright)"
    strokeWidth={2}
    vectorEffect="non-scaling-stroke"
    pointerEvents="all"
    style={{ cursor: handle === 'BODY' ? 'move' : 'grab' }}
    onPointerDown={(event) => onEditStart(handle, event)}
  />;
}

function DrawingShape({ drawing, controller, selected, draft = false, onEditStart }: {
  readonly drawing: ChartDrawing;
  readonly controller: AriseChartController;
  readonly selected: boolean;
  readonly draft?: boolean;
  readonly onEditStart: (handle: EditHandle, event: ReactPointerEvent<SVGElement>) => void;
}) {
  const coord = (point: ChartPoint) => {
    const x = controller.timeToX(point.time);
    const y = controller.priceToY(point.price);
    return x === null || y === null ? null : { x, y };
  };
  const className = `market-shape market-shape-${drawing.role.toLowerCase()} ${selected ? 'selected' : ''} ${draft ? 'draft' : ''}`;
  const geometry = drawing.geometry;
  const begin = (handle: EditHandle) => (event: ReactPointerEvent<SVGElement>) => {
    if (draft) return;
    onEditStart(handle, event);
  };
  if (geometry.kind === 'RECTANGLE') {
    const a = coord(geometry.start); const b = coord(geometry.end);
    if (!a || !b) return null;
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return <g>
      <rect className={className} x={Math.min(a.x,b.x)} y={Math.min(a.y,b.y)} width={Math.abs(b.x-a.x)} height={Math.abs(b.y-a.y)} rx="3" onPointerDown={begin('BODY')}/>
      {selected && !draft ? <>
        <DrawingNode x={a.x} y={a.y} handle="START" onEditStart={onEditStart}/>
        <DrawingNode x={b.x} y={b.y} handle="END" onEditStart={onEditStart}/>
        <DrawingNode x={center.x} y={center.y} handle="BODY" onEditStart={onEditStart}/>
      </> : null}
    </g>;
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
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return <g>
      {!draft ? <line x1={a.x} y1={a.y} x2={endX} y2={endY} stroke="transparent" strokeWidth={14} pointerEvents="stroke" style={{ cursor: 'move' }} onPointerDown={begin('BODY')}/> : null}
      <line className={className} x1={a.x} y1={a.y} x2={endX} y2={endY} onPointerDown={begin('BODY')}/>
      {selected && !draft ? <>
        <DrawingNode x={a.x} y={a.y} handle="START" onEditStart={onEditStart}/>
        <DrawingNode x={b.x} y={b.y} handle="END" onEditStart={onEditStart}/>
        <DrawingNode x={center.x} y={center.y} handle="BODY" onEditStart={onEditStart}/>
      </> : null}
    </g>;
  }
  if (geometry.kind === 'TEXT') {
    const valuePoint = coord(geometry.point);
    if (!valuePoint) return null;
    return <g>
      <text className={className} x={valuePoint.x+6} y={valuePoint.y-6} onPointerDown={begin('BODY')}>{geometry.text}</text>
      {selected && !draft ? <DrawingNode x={valuePoint.x} y={valuePoint.y} handle="POINT" onEditStart={onEditStart}/> : null}
    </g>;
  }
  if (geometry.kind === 'POINT' || geometry.kind === 'CANDLE_REFERENCE') {
    const valuePoint = coord(geometry.point);
    if (!valuePoint) return null;
    return <g>
      <circle className={className} cx={valuePoint.x} cy={valuePoint.y} r={selected ? 6 : 4} onPointerDown={begin('BODY')}/>
      {selected && !draft ? <DrawingNode x={valuePoint.x} y={valuePoint.y} handle="POINT" onEditStart={onEditStart}/> : null}
    </g>;
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
  const editSessionRef = useRef<EditSession | null>(null);
  const fitAfterNextDataRef = useRef(true);
  const [timeframe, setTimeframe] = useState<ChartTimeframeCode>('H1');
  const [tool, setTool] = useState<DrawingTool>('SELECT');
  const [semanticType, setSemanticType] = useState<string>('FVG');
  const [role, setRole] = useState<(typeof ROLES)[number]>('AREA');
  const [objects, setObjects] = useState<readonly ChartDrawing[]>([]);
  const [hiddenObjectIds, setHiddenObjectIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedCandle, setSelectedCandle] = useState<AriseCandle | null>(null);
  const [projectionStack, setProjectionStack] = useState<readonly CandleProjection[]>([]);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof window.arise.getChartCatalog>> | null>(null);
  const [candles, setCandles] = useState<readonly AriseCandle[]>([]);
  const [draftGeometry, setDraftGeometry] = useState<DrawingGeometry | null>(null);
  const [editPreview, setEditPreview] = useState<EditPreview | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('OBJECTS');
  const [overlayEpoch, setOverlayEpoch] = useState(0);
  const [status, setStatus] = useState('WAITING FOR MT5');

  const hiddenStorageKey = useMemo(() => `arise.chart.hidden-objects.${symbol}`, [symbol]);
  const activeObjects = useMemo(() => objects.filter((entry) => !hiddenObjectIds.has(entry.id)), [hiddenObjectIds, objects]);
  const visibleObjects = activeObjects;
  const renderedObjects = useMemo(() => visibleObjects.map((entry) => editPreview?.objectId === entry.id
    ? { ...entry, geometry: editPreview.geometry }
    : entry), [editPreview, visibleObjects]);
  const selectedObject = activeObjects.find((entry) => entry.id === selectedObjectId) ?? null;
  const instrument = catalog?.instruments.find((entry) => entry.symbol === symbol) ?? null;
  const hiddenCount = objects.length - activeObjects.length;
  const draftDrawing = useMemo<ChartDrawing | null>(() => draftGeometry ? ({
    id: '__draft__',
    versionId: '__draft__',
    versionNo: 1,
    geometryType: draftGeometry.kind,
    semanticType,
    role,
    name: 'Draft',
    timeframe,
    geometry: draftGeometry,
  } as ChartDrawing) : null, [draftGeometry, role, semanticType, timeframe]);

  const loadObjects = useCallback(async () => {
    if (!window.arise) return;
    const rows = await window.arise.listChartObjects({ symbol });
    setObjects(rows.map(toDrawing).filter((entry): entry is ChartDrawing => entry !== null));
  }, [symbol]);

  const loadMarketData = useCallback(async () => {
    if (!window.arise) return;
    try {
      const workspace = await window.arise.getMt5Workspace();
      const nextCandles = toChartCandles(workspace, symbol, timeframe);
      setCandles(nextCandles);
      if (workspace.connection.state === 'CONNECTED' && nextCandles.length > 0)
        setStatus('MT5 LIVE');
      else if (workspace.connection.state === 'CONNECTED')
        setStatus(`NO ${timeframe} DATA`);
      else
        setStatus(`MT5 ${workspace.connection.state} · OFFLINE DEMO`);
    } catch {
      setCandles(createDemoCandles(symbol, timeframe));
      setStatus('MT5 DATA ERROR · OFFLINE DEMO');
    }
  }, [symbol, timeframe]);

  const hideObject = useCallback((marketObjectId: string) => {
    setHiddenObjectIds((current) => {
      const next = new Set(current);
      next.add(marketObjectId);
      try { window.localStorage.setItem(hiddenStorageKey, JSON.stringify([...next])); } catch { /* local persistence is best effort */ }
      return next;
    });
    setSelectedObjectId((current) => current === marketObjectId ? null : current);
    setStatus('OBJECT DELETED FROM CHART');
  }, [hiddenStorageKey]);

  const restoreHiddenObjects = useCallback(() => {
    setHiddenObjectIds(new Set<string>());
    try { window.localStorage.removeItem(hiddenStorageKey); } catch { /* local persistence is best effort */ }
    setStatus('HIDDEN OBJECTS RESTORED');
  }, [hiddenStorageKey]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(hiddenStorageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      setHiddenObjectIds(new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []));
    } catch {
      setHiddenObjectIds(new Set<string>());
    }
  }, [hiddenStorageKey]);

  useEffect(() => {
    window.arise?.getChartCatalog().then(setCatalog).catch(() => setStatus('CATALOG ERROR'));
  }, []);

  useEffect(() => {
    loadObjects().catch(() => setStatus('OBJECT LOAD ERROR'));
    setSelectedObjectId(null);
    setSelectedCandle(null);
    setProjectionStack([]);
    editSessionRef.current = null;
    setEditPreview(null);
  }, [loadObjects]);

  useEffect(() => {
    fitAfterNextDataRef.current = true;
    setCandles([]);
    void loadMarketData();
    const timer = window.setInterval(() => void loadMarketData(), 1_000);
    return () => window.clearInterval(timer);
  }, [loadMarketData]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const controller = new AriseChartController(host, theme);
    controllerRef.current = controller;
    controller.onClick((click) => setSelectedCandle(click.candle));
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
    if (!controller || candles.length === 0) return;
    controller.setData(candles);
    if (fitAfterNextDataRef.current) {
      controller.fitContent();
      fitAfterNextDataRef.current = false;
    }
    setOverlayEpoch((value)=>value+1);
  }, [candles]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
      if (editing) return;
      if (event.key === 'Escape') {
        dragStartRef.current = null;
        editSessionRef.current = null;
        setDraftGeometry(null);
        setEditPreview(null);
        setTool('SELECT');
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedObjectId) {
        event.preventDefault();
        hideObject(selectedObjectId);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hideObject, selectedObjectId]);

  const persistDrawing = async (start: ChartPoint, end: ChartPoint) => {
    if (tool === 'SELECT') return;
    const geometry = geometryForTool(tool, start, end, semanticType);
    const sameTypeCount = activeObjects.filter((entry)=>entry.semanticType===semanticType).length + 1;
    const created = await window.arise.createChartObject({
      symbol,
      timeframe,
      geometryType: geometry.kind,
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

  const reviseGeometry = async (marketObjectId: string, geometry: DrawingGeometry) => {
    const revised = await window.arise.reviseChartObject({
      marketObjectId,
      geometryJson: encodeDrawingGeometry(geometry),
    });
    const drawing = toDrawing(revised);
    if (!drawing) return;
    setObjects((current)=>current.map((entry)=>entry.id===drawing.id?drawing:entry));
    setSelectedObjectId(drawing.id);
    setStatus(`REVISION v${drawing.versionNo} SAVED`);
  };

  const beginObjectEdit = (drawing: ChartDrawing, handle: EditHandle, event: ReactPointerEvent<SVGElement>) => {
    if (tool !== 'SELECT') return;
    const point = controllerRef.current?.pointFromClient(event.clientX, event.clientY) ?? null;
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedObjectId(drawing.id);
    editSessionRef.current = {
      objectId: drawing.id,
      handle,
      originPointer: point,
      originGeometry: drawing.geometry,
    };
    setEditPreview({ objectId: drawing.id, geometry: drawing.geometry });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'SELECT') return;
    const point = controllerRef.current?.pointFromClient(event.clientX, event.clientY) ?? null;
    if (!point) return;
    dragStartRef.current = point;
    setDraftGeometry(geometryForTool(tool, point, point, semanticType));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const editSession = editSessionRef.current;
    if (editSession) {
      const current = controllerRef.current?.pointFromClient(event.clientX, event.clientY) ?? null;
      if (!current) return;
      setEditPreview({
        objectId: editSession.objectId,
        geometry: editGeometry(editSession.originGeometry, editSession.handle, editSession.originPointer, current),
      });
      return;
    }
    if (tool === 'SELECT' || !dragStartRef.current) return;
    const end = controllerRef.current?.pointFromClient(event.clientX, event.clientY) ?? null;
    if (!end) return;
    setDraftGeometry(geometryForTool(tool, dragStartRef.current, end, semanticType));
  };

  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const editSession = editSessionRef.current;
    if (editSession) {
      const current = controllerRef.current?.pointFromClient(event.clientX, event.clientY) ?? null;
      const geometry = current
        ? editGeometry(editSession.originGeometry, editSession.handle, editSession.originPointer, current)
        : editSession.originGeometry;
      editSessionRef.current = null;
      setEditPreview(null);
      if (!sameGeometry(editSession.originGeometry, geometry))
        reviseGeometry(editSession.objectId, geometry).catch(() => setStatus('REVISION SAVE ERROR'));
      return;
    }
    if (tool === 'SELECT') return;
    const start = dragStartRef.current;
    const end = controllerRef.current?.pointFromClient(event.clientX, event.clientY) ?? null;
    dragStartRef.current = null;
    setDraftGeometry(null);
    if (!start || !end) return;
    persistDrawing(start, end).catch(() => setStatus('SAVE ERROR'));
  };

  const pointerCancel = () => {
    dragStartRef.current = null;
    editSessionRef.current = null;
    setDraftGeometry(null);
    setEditPreview(null);
  };

  const nudgeSelected = async (direction: 1 | -1) => {
    if (!selectedObject || !instrument) return;
    const geometry = shiftGeometry(selectedObject.geometry, instrument.pipSize * direction);
    await reviseGeometry(selectedObject.id, geometry);
  };

  const chooseTimeframe = (next: ChartTimeframeCode) => {
    fitAfterNextDataRef.current = true;
    editSessionRef.current = null;
    setEditPreview(null);
    setTimeframe(next);
    setProjectionStack([]);
    setSelectedCandle(null);
  };

  const expandTo = (targetTimeframe: ChartTimeframeCode) => {
    if (!selectedCandle) return;
    const projection = projectCandle(selectedCandle, timeframe, targetTimeframe);
    setProjectionStack((current)=>[...current,projection]);
    fitAfterNextDataRef.current = true;
    setTimeframe(targetTimeframe);
  };

  const showParent = () => {
    const current = projectionStack.at(-1);
    if (!current) return;
    fitAfterNextDataRef.current = true;
    setTimeframe(current.sourceTimeframe);
    setProjectionStack((stack)=>stack.slice(0,-1));
  };

  return <div className="m4-trading-workspace" data-testid="m4-chart-workspace">
    <section className="chart-workbench">
      <header className="chart-toolbar m4-chart-toolbar">
        <div className="chart-symbol-block"><strong>{symbol}</strong><span>{instrument?.displayName ?? 'Market'}</span></div>
        <div className="timeframe-tabs">{CHART_TIMEFRAMES.map((entry)=><button key={entry} className={entry===timeframe?'selected':''} onClick={()=>chooseTimeframe(entry)}>{entry}</button>)}</div>
        <div className="chart-context-mode"><button className="selected">MASTER</button><button disabled>COLONY</button></div>
        <button className="chart-fit-button" onClick={()=>controllerRef.current?.fitContent()} title="Fit chart">FIT</button>
        <span className="offline-pill demo-pill"><span className={`status-dot ${status==='MT5 LIVE'?'status-dot-good':'status-dot-warning'}`}/> {status}</span>
      </header>

      <div className="chart-stage">
        <div className="drawing-toolbar" aria-label="Drawing tools">{(['SELECT','HORIZONTAL','LINE','RAY','RECTANGLE','TRENDLINE','POINT','TEXT'] as const).map((entry)=><button key={entry} className={tool===entry?'active':''} onClick={()=>{setTool(entry);setDraftGeometry(null);editSessionRef.current=null;setEditPreview(null);dragStartRef.current=null;}} title={entry === 'HORIZONTAL' ? 'HORIZONTAL LINE' : entry}><Icon name={TOOL_ICON[entry]}/></button>)}</div>
        <div ref={hostRef} className="arise-chart-host" data-testid="lightweight-chart-host"/>
        <svg data-epoch={overlayEpoch} className={`market-overlay ${tool!=='SELECT'?'drawing-active':''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}>
          {projectionStack.map((projection,index)=><ProjectionShape key={projection.id} projection={projection} controller={controllerRef.current!} active={index===projectionStack.length-1}/>) }
          {controllerRef.current ? renderedObjects.map((drawing)=><DrawingShape key={`${drawing.id}:${drawing.versionNo}`} drawing={drawing} controller={controllerRef.current!} selected={drawing.id===selectedObjectId} onEditStart={(handle,event)=>beginObjectEdit(drawing,handle,event)}/>) : null}
          {controllerRef.current && draftDrawing ? <DrawingShape drawing={draftDrawing} controller={controllerRef.current} selected={false} draft onEditStart={()=>undefined}/> : null}
        </svg>
        <div className="chart-attribution-note">Chart engine: TradingView Lightweight Charts™ · times shown in system local time</div>
      </div>

      <footer className="projection-bar">
        <div className="projection-breadcrumb"><span>CONTEXT</span><button onClick={()=>setProjectionStack([])}>{timeframe}</button>{projectionStack.map((projection)=><span key={projection.id}>› {projection.label}</span>)}</div>
        <div className="projection-actions">
          {projectionStack.length ? <button onClick={showParent}>SHOW PARENT CANDLE</button> : null}
          <span>{selectedCandle ? `Selected ${timeframe} candle · H ${selectedCandle.high.toFixed(instrument?.priceDigits ?? 5)} / L ${selectedCandle.low.toFixed(instrument?.priceDigits ?? 5)}` : candles.length ? 'Click a candle to enable timeframe projection' : `Waiting for ${symbol} ${timeframe} market data`}</span>
          {selectedCandle ? lowerTimeframes(timeframe).map((target)=><button key={target} onClick={()=>expandTo(target)}>EXPAND TO {target}</button>) : null}
        </div>
      </footer>
    </section>

    <aside className="chart-inspector">
      <div className="inspector-tabs">{(['OBJECTS','LAYERS','EXECUTION'] as const).map((entry)=><button key={entry} className={inspectorTab===entry?'active':''} onClick={()=>setInspectorTab(entry)}>{entry}</button>)}</div>

      {inspectorTab === 'OBJECTS' ? <>
        <section className="inspector-section semantic-controls">
          <span className="section-label">NEW MARKET OBJECT</span>
          <label>Meaning<select value={semanticType} onChange={(event: { target: { value: string } })=>setSemanticType(event.target.value)}>{SEMANTICS.map((entry)=><option key={entry}>{entry}</option>)}</select></label>
          <label>Role<select value={role} onChange={(event: { target: { value: string } })=>setRole(event.target.value as typeof role)}>{ROLES.map((entry)=><option key={entry}>{entry}</option>)}</select></label>
          <p>Choose geometry on the chart toolbar, then drag anywhere in the visible chart — including future space past the current candle. Drawings remain visible when switching chart timeframes; the stored timeframe records their creation context.</p>
        </section>
        <section className="inspector-section object-list-section">
          <div className="inspector-heading"><span>MARKET OBJECTS</span><b>{visibleObjects.length}</b></div>
          <div className="object-list">{visibleObjects.length ? visibleObjects.map((entry)=><button key={entry.id} className={entry.id===selectedObjectId?'selected':''} onClick={()=>setSelectedObjectId(entry.id)}><span className={`object-role-marker role-${entry.role.toLowerCase()}`}/><div><strong>{entry.name}</strong><span>{entry.semanticType} · {entry.role}</span></div><b>v{entry.versionNo}</b></button>) : <div className="object-empty">No Market Objects on {symbol}.<br/>Draw one directly on the chart.</div>}</div>
        </section>
        {selectedObject ? <section className="inspector-section selected-object-card">
          <span className="section-label">SELECTED OBJECT</span>
          <h3>{selectedObject.name}</h3>
          <div><span>Geometry</span><b>{selectedObject.geometryType}</b></div>
          <div><span>Meaning</span><b>{selectedObject.semanticType}</b></div>
          <div><span>Role</span><b>{selectedObject.role}</b></div>
          <div><span>Version</span><b>v{selectedObject.versionNo}</b></div>
          <div className="object-nudge"><button onClick={()=>nudgeSelected(1)}>+1 PIP</button><button onClick={()=>nudgeSelected(-1)}>−1 PIP</button><button onClick={()=>hideObject(selectedObject.id)}>DELETE</button></div>
          <small>Drag the drawing body or center node to reposition it. Drag endpoint nodes to reshape it. Each completed drag creates a new immutable MarketObjectVersion.</small>
        </section> : null}
      </> : null}

      {inspectorTab === 'LAYERS' ? <section className="inspector-section object-list-section">
        <div className="inspector-heading"><span>VISIBLE LAYERS</span><b>{visibleObjects.length}</b></div>
        <p>Market Object drawings are global across chart timeframes. The timeframe shown here is the original creation context, not a visibility filter. Deleted chart objects remain preserved in underlying Market Object history.</p>
        {hiddenCount > 0 ? <button className="ghost-button" onClick={restoreHiddenObjects}>RESTORE {hiddenCount} HIDDEN</button> : null}
        <div className="object-list">{visibleObjects.length ? visibleObjects.map((entry)=><button key={entry.id} className={entry.id===selectedObjectId?'selected':''} onClick={()=>setSelectedObjectId(entry.id)}><span className={`object-role-marker role-${entry.role.toLowerCase()}`}/><div><strong>{entry.name}</strong><span>{entry.geometryType} · {entry.timeframe ?? 'GLOBAL'}</span></div><b>v{entry.versionNo}</b></button>) : <div className="object-empty">No visible layers.</div>}</div>
      </section> : null}

      {inspectorTab === 'EXECUTION' ? <section className="inspector-section execution-lock">
        <span className="section-label">EXECUTION</span><strong>LOCKED</strong><p>The tab remains inspectable while execution is gated. Broker mutation stays behind the existing explicit MT5 demo execution gateway.</p>
      </section> : null}
    </aside>
  </div>;
}
