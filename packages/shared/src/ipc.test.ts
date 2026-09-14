import { describe, expect, it } from 'vitest';
import { appInfoSchema, createIdeaInputSchema, listIdeasResultSchema } from './ipc';

describe('M0 IPC contracts', () => {
  it.each(['LONG', 'SHORT', 'NEUTRAL'])('accepts %s and arbitrary timeframe labels', (direction) => {
    expect(createIdeaInputSchema.parse({ instrumentId: 'EURUSD', timeframe: '8H', direction }).direction).toBe(direction);
  });
  it.each([
    null,
    { instrumentId: ' ', timeframe: 'W', direction: 'LONG' },
    { instrumentId: 'EURUSD', timeframe: '', direction: 'LONG' },
    { instrumentId: 'EURUSD', timeframe: 'W', direction: 'BULL' },
  ])('rejects malformed input %#', (input) => {
    expect(() => createIdeaInputSchema.parse(input)).toThrow();
  });
  it('rejects invalid backend responses', () => {
    expect(() => appInfoSchema.parse({ name: 'ARISE', version: '1', databaseReady: 'yes' })).toThrow();
    expect(() => listIdeasResultSchema.parse([{ ideaId: '1', direction: 'BULL' }])).toThrow();
  });
});
