import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsReviewRepository, IdeaRepository } from '@arise/database';
import type { EvidenceCaptureCoordinator } from './evidence-capture';
import { ipcChannels } from '@arise/shared';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } }));
import { registerIpcHandlers } from './ipc';

describe('Main-process IPC validation', () => {
  const insert = vi.fn();
  const list = vi.fn();
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers({ ideaRepository: { insert, list } as unknown as IdeaRepository, version: '0.0.1' });
  });
  it('returns validated app status', () => {
    expect(handlers.get(ipcChannels.getAppInfo)!()).toEqual({ name: 'ARISE', version: '0.0.1', databaseReady: true });
  });
  it('rejects invalid input before persistence', async () => {
    await expect(handlers.get(ipcChannels.createIdea)!({}, { instrumentId: 'EURUSD', timeframe: 'W', direction: 'BULL' })).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
  it('persists a domain draft and returns its identity', async () => {
    const result = await handlers.get(ipcChannels.createIdea)!({}, { instrumentId: 'EURUSD', timeframe: '8H', direction: 'NEUTRAL' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'DRAFT', direction: 'NEUTRAL', thesisTimeframe: '8H' }));
    expect(result).toEqual({ ideaId: insert.mock.calls[0]![0].id });
  });
  it('propagates database failures rather than acknowledging a write', async () => {
    insert.mockRejectedValueOnce(new Error('disk failure'));
    await expect(handlers.get(ipcChannels.createIdea)!({}, { instrumentId: 'EURUSD', timeframe: 'W', direction: 'LONG' })).rejects.toThrow('disk failure');
  });
  it('validates data returned from persistence', async () => {
    list.mockResolvedValueOnce([{ id: '1', instrumentId: 'EURUSD', thesisTimeframe: 'W', direction: 'BULL' }]);
    await expect(handlers.get(ipcChannels.listIdeas)!()).rejects.toThrow();
  });
  it('surfaces corrupt Review evidence instead of silently substituting it', async () => {
    handlers.clear();
    const analyticsReviewRepository = {
      reviewWorkspace: () => ({ reviews: [{ id:'review-1',sourceType:'TRADE',sourceId:'trade-1',title:'Review',ideaVersion:{id:'idea-v1'},strategyMapVersion:null,currentDissection:{id:'d1'},dissectionVersions:[{id:'d1'}],evidence:[{id:'evidence-1',integrity:'UNVERIFIED_ASSET',event:{id:'evidence-1'},snapshots:[{id:'snapshot-1',imagePath:'missing.png',imageHash:'a'.repeat(64),captureOrigin:'AUTOMATIC',capturedAt:'2026-09-12T00:00:00.000Z'}]}],createdAt:'2026-09-12T00:00:00.000Z' }],lessons:[],proposals:[] }),
    } as unknown as AnalyticsReviewRepository;
    const evidenceCapture = { assets: { verify: vi.fn().mockResolvedValue('CORRUPT') } } as unknown as EvidenceCaptureCoordinator;
    registerIpcHandlers({ ideaRepository: { insert, list } as unknown as IdeaRepository, analyticsReviewRepository, evidenceCapture, version:'0.0.1' });
    const workspace = await handlers.get(ipcChannels.getPerformanceReviewWorkspace)!();
    expect(workspace).toMatchObject({ reviews:[{ evidence:[{ integrity:'CORRUPT' }] }] });
  });
});
