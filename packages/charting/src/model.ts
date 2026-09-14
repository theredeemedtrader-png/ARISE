export type ChartTimeframeCode = 'M5' | 'M15' | 'H1' | 'H4' | 'D' | 'W';

export interface AriseCandle {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export interface ChartPoint {
  readonly time: number;
  readonly price: number;
}

export interface ChartDrawing {
  readonly id: string;
  readonly versionId: string;
  readonly versionNo: number;
  readonly geometryType: 'LINE' | 'RAY' | 'RECTANGLE' | 'TRENDLINE' | 'POINT' | 'CANDLE_REFERENCE' | 'TEXT';
  readonly semanticType: string;
  readonly role: 'REFERENCE' | 'AREA' | 'TRIGGER' | 'TARGET' | 'INVALIDATION' | 'PROTECTION' | 'CONFIRMATION' | 'ORIGIN';
  readonly name: string;
  readonly timeframe: ChartTimeframeCode | null;
  readonly geometry: DrawingGeometry;
}

export type DrawingGeometry =
  | { readonly kind: 'LINE' | 'RAY' | 'TRENDLINE'; readonly start: ChartPoint; readonly end: ChartPoint }
  | { readonly kind: 'RECTANGLE'; readonly start: ChartPoint; readonly end: ChartPoint }
  | { readonly kind: 'POINT' | 'CANDLE_REFERENCE'; readonly point: ChartPoint }
  | { readonly kind: 'TEXT'; readonly point: ChartPoint; readonly text: string };

export interface CandleProjection {
  readonly id: string;
  readonly sourceTimeframe: ChartTimeframeCode;
  readonly targetTimeframe: ChartTimeframeCode;
  readonly intervalStart: number;
  readonly intervalEnd: number;
  readonly high: number;
  readonly low: number;
  readonly label: string;
}

export const TIMEFRAME_SECONDS: Readonly<Record<ChartTimeframeCode, number>> = Object.freeze({
  M5: 5 * 60,
  M15: 15 * 60,
  H1: 60 * 60,
  H4: 4 * 60 * 60,
  D: 24 * 60 * 60,
  W: 7 * 24 * 60 * 60,
});

export const CHART_TIMEFRAMES: readonly ChartTimeframeCode[] = Object.freeze(['M5', 'M15', 'H1', 'H4', 'D', 'W']);

function point(value: unknown): ChartPoint | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.time === 'number' && Number.isFinite(candidate.time) &&
    typeof candidate.price === 'number' && Number.isFinite(candidate.price)
    ? { time: candidate.time, price: candidate.price }
    : null;
}

export function encodeDrawingGeometry(geometry: DrawingGeometry): Readonly<Record<string, unknown>> {
  switch (geometry.kind) {
    case 'LINE':
    case 'RAY':
    case 'TRENDLINE':
    case 'RECTANGLE':
      return Object.freeze({ kind: geometry.kind, start: Object.freeze({ ...geometry.start }), end: Object.freeze({ ...geometry.end }) });
    case 'POINT':
    case 'CANDLE_REFERENCE':
      return Object.freeze({ kind: geometry.kind, point: Object.freeze({ ...geometry.point }) });
    case 'TEXT':
      return Object.freeze({ kind: geometry.kind, point: Object.freeze({ ...geometry.point }), text: geometry.text });
  }
}

export function decodeDrawingGeometry(value: unknown): DrawingGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  if (kind === 'LINE' || kind === 'RAY' || kind === 'TRENDLINE' || kind === 'RECTANGLE') {
    const start = point(candidate.start);
    const end = point(candidate.end);
    return start && end ? Object.freeze({ kind, start: Object.freeze(start), end: Object.freeze(end) }) : null;
  }
  if (kind === 'POINT' || kind === 'CANDLE_REFERENCE') {
    const valuePoint = point(candidate.point);
    return valuePoint ? Object.freeze({ kind, point: Object.freeze(valuePoint) }) : null;
  }
  if (kind === 'TEXT') {
    const valuePoint = point(candidate.point);
    return valuePoint && typeof candidate.text === 'string'
      ? Object.freeze({ kind, point: Object.freeze(valuePoint), text: candidate.text })
      : null;
  }
  return null;
}

export function lowerTimeframes(source: ChartTimeframeCode): readonly ChartTimeframeCode[] {
  const seconds = TIMEFRAME_SECONDS[source];
  return CHART_TIMEFRAMES.filter((timeframe) => TIMEFRAME_SECONDS[timeframe] < seconds).sort(
    (left, right) => TIMEFRAME_SECONDS[right] - TIMEFRAME_SECONDS[left],
  );
}

export function projectCandle(candle: AriseCandle, sourceTimeframe: ChartTimeframeCode, targetTimeframe: ChartTimeframeCode): CandleProjection {
  if (TIMEFRAME_SECONDS[targetTimeframe] >= TIMEFRAME_SECONDS[sourceTimeframe]) {
    throw new Error('Timeframe projection target must be lower than the source timeframe');
  }
  return Object.freeze({
    id: `projection:${sourceTimeframe}:${candle.time}:${targetTimeframe}`,
    sourceTimeframe,
    targetTimeframe,
    intervalStart: candle.time,
    intervalEnd: candle.time + TIMEFRAME_SECONDS[sourceTimeframe],
    high: candle.high,
    low: candle.low,
    label: `${sourceTimeframe} ${new Date(candle.time * 1000).toISOString().slice(5, 16).replace('T', ' ')}`,
  });
}
