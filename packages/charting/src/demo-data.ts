import { TIMEFRAME_SECONDS, type AriseCandle, type ChartTimeframeCode } from './model';

const BASE_START = Date.UTC(2026, 7, 31, 0, 0, 0) / 1000;
const BASE_BARS = 4032;

function symbolSeed(symbol: string): number {
  let value = 2166136261;
  for (const char of symbol) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function random(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function basePrice(symbol: string): number {
  if (symbol === 'XAUUSD') return 2520;
  if (symbol === 'NAS100') return 24000;
  if (symbol === 'USDJPY') return 147;
  if (symbol === 'GBPUSD') return 1.355;
  return 1.165;
}

function amplitude(symbol: string): number {
  if (symbol === 'XAUUSD') return 2.4;
  if (symbol === 'NAS100') return 24;
  if (symbol === 'USDJPY') return 0.055;
  return 0.00055;
}

function makeM5(symbol: string): readonly AriseCandle[] {
  const next = random(symbolSeed(symbol));
  const output: AriseCandle[] = [];
  let close = basePrice(symbol);
  const size = amplitude(symbol);
  for (let index = 0; index < BASE_BARS; index += 1) {
    const cycle = Math.sin(index / 57) * size * 0.35 + Math.sin(index / 211) * size * 0.55;
    const drift = (next() - 0.49) * size;
    const open = close;
    close = Math.max(0.00001, open + drift + cycle * 0.05);
    const wick = (0.25 + next() * 0.8) * size;
    output.push(Object.freeze({
      time: BASE_START + index * 300,
      open,
      high: Math.max(open, close) + wick,
      low: Math.max(0.00001, Math.min(open, close) - wick * (0.7 + next() * 0.5)),
      close,
    }));
  }
  return Object.freeze(output);
}

export function aggregateCandles(candles: readonly AriseCandle[], seconds: number): readonly AriseCandle[] {
  if (seconds < 300 || seconds % 300 !== 0) throw new Error('Demo aggregation requires a multiple of M5');
  const bucketSize = seconds / 300;
  const output: AriseCandle[] = [];
  for (let index = 0; index + bucketSize <= candles.length; index += bucketSize) {
    const bucket = candles.slice(index, index + bucketSize);
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    output.push(Object.freeze({
      time: first.time,
      open: first.open,
      high: Math.max(...bucket.map((entry) => entry.high)),
      low: Math.min(...bucket.map((entry) => entry.low)),
      close: last.close,
    }));
  }
  return Object.freeze(output);
}

export function createDemoCandles(symbol: string, timeframe: ChartTimeframeCode): readonly AriseCandle[] {
  const base = makeM5(symbol);
  return timeframe === 'M5' ? base : aggregateCandles(base, TIMEFRAME_SECONDS[timeframe]);
}
