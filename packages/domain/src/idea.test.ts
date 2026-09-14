import { describe, expect, it } from 'vitest';
import { createDraftIdea } from './idea';

describe('createDraftIdea', () => {
  it('creates a DRAFT idea using LONG/SHORT/NEUTRAL terminology', () => {
    const idea = createDraftIdea({
      id: 'idea-1',
      instrumentId: 'EURUSD',
      thesisTimeframe: 'W',
      direction: 'LONG',
      now: new Date('2026-09-09T12:00:00Z'),
    });

    expect(idea.status).toBe('DRAFT');
    expect(idea.direction).toBe('LONG');
  });
});
