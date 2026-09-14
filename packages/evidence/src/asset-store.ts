import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import type { ChartWorkspaceEvidenceState, EvidenceAssetIntegrity } from './model';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, 'ascii'); const payload = Buffer.from(data); const output = Buffer.alloc(12 + payload.length);
  output.writeUInt32BE(payload.length, 0); name.copy(output, 4); payload.copy(output, 8); output.writeUInt32BE(crc32(Buffer.concat([name, payload])), 8 + payload.length); return output;
}

/** Renders the immutable event-time chart state, not the mutable current workspace. */
export function renderEvidenceChartPng(state: ChartWorkspaceEvidenceState, width = 960, height = 540): Uint8Array {
  if (width < 320 || height < 200) throw new Error('Evidence raster dimensions are too small');
  const pixels = Buffer.alloc(width * height * 4);
  const set = (x: number, y: number, color: readonly [number, number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4; pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3];
  };
  const fill = (left: number, top: number, right: number, bottom: number, color: readonly [number, number, number, number]) => { for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) set(x, y, color); };
  fill(0, 0, width, height, [6, 14, 23, 255]); fill(0, 0, width, 46, [10, 27, 42, 255]); fill(20, 15, 31, 30, [38, 150, 238, 255]);
  const chart = { left: 42, top: 70, right: width - 28, bottom: height - 34 };
  for (let row = 0; row <= 5; row += 1) fill(chart.left, Math.round(chart.top + (chart.bottom - chart.top) * row / 5), chart.right, Math.round(chart.top + (chart.bottom - chart.top) * row / 5) + 1, [25, 49, 68, 255]);
  for (let column = 0; column <= 8; column += 1) fill(Math.round(chart.left + (chart.right - chart.left) * column / 8), chart.top, Math.round(chart.left + (chart.right - chart.left) * column / 8) + 1, chart.bottom, [20, 43, 61, 255]);
  const candles = state.candles;
  if (candles.length) {
    const rawLow = Math.min(...candles.map((item) => item.low)); const rawHigh = Math.max(...candles.map((item) => item.high)); const span = Math.max(rawHigh - rawLow, Math.abs(rawHigh) * 0.0001, 0.0001);
    const low = rawLow - span * 0.12; const high = rawHigh + span * 0.12; const y = (price: number) => Math.round(chart.bottom - (price - low) / (high - low) * (chart.bottom - chart.top));
    const spacing = (chart.right - chart.left) / Math.max(candles.length, 2); const bodyWidth = Math.max(4, Math.min(18, Math.floor(spacing * 0.55)));
    candles.forEach((candle, index) => {
      const x = Math.round(chart.left + spacing * (index + (candles.length === 1 ? 1 : 0.5))); const color: readonly [number, number, number, number] = candle.close >= candle.open ? [65, 190, 139, 255] : [224, 92, 103, 255];
      fill(x, y(candle.high), x + 1, y(candle.low) + 1, color); const bodyTop = Math.min(y(candle.open), y(candle.close)); const bodyBottom = Math.max(y(candle.open), y(candle.close)); fill(x - Math.floor(bodyWidth / 2), bodyTop, x + Math.ceil(bodyWidth / 2), Math.max(bodyTop + 2, bodyBottom + 1), color);
    });
  }
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) { const target = y * (width * 4 + 1); raw[target] = 0; pixels.copy(raw, target + 1, y * width * 4, (y + 1) * width * 4); }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([pngSignature, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

export class EvidenceAssetStore {
  constructor(private readonly rootDirectory: string) { if (!path.isAbsolute(rootDirectory)) throw new Error('Evidence asset root must be absolute'); }
  async writePng(input: { readonly eventId: string; readonly snapshotId: string; readonly bytes: Uint8Array }): Promise<{ readonly relativePath: string; readonly hash: string }> {
    if (!input.bytes.length || !Buffer.from(input.bytes.subarray(0, 8)).equals(pngSignature)) throw new Error('Evidence raster must be a PNG');
    const safeEvent = this.safeSegment(input.eventId); const safeSnapshot = this.safeSegment(input.snapshotId);
    const relativePath = path.posix.join(safeEvent, `${safeSnapshot}.png`); const absolutePath = path.join(this.rootDirectory, safeEvent, `${safeSnapshot}.png`);
    await mkdir(path.dirname(absolutePath), { recursive: true }); await writeFile(absolutePath, input.bytes, { flag: 'wx' });
    return Object.freeze({ relativePath, hash: sha256(input.bytes) });
  }
  async read(relativePath: string): Promise<Uint8Array> { return readFile(this.resolve(relativePath)); }
  async verify(relativePath: string, expectedHash: string): Promise<EvidenceAssetIntegrity> {
    try { return sha256(await this.read(relativePath)) === expectedHash ? 'VERIFIED' : 'CORRUPT'; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'MISSING' : 'CORRUPT'; }
  }
  private resolve(relativePath: string): string {
    if (!relativePath || relativePath.includes('..') || path.isAbsolute(relativePath)) throw new Error('Evidence asset path must be portable and relative');
    const resolved = path.resolve(this.rootDirectory, relativePath); const root = path.resolve(this.rootDirectory) + path.sep;
    if (!resolved.startsWith(root)) throw new Error('Evidence asset path escapes its root'); return resolved;
  }
  private safeSegment(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) throw new Error('Evidence asset identity must be an opaque token'); return value; }
}
