import { afterEach, describe, expect, it } from 'vitest';
import { createDraftIdea } from '@arise/domain';
import { openDatabase } from './database';
import { IdeaRepository } from './idea-repository';

describe('IdeaRepository', () => {
  const opened: Array<ReturnType<typeof openDatabase>['sqlite']> = [];

  afterEach(() => {
    while (opened.length) opened.pop()?.close();
  });

  it('writes and reads a domain Idea', async () => {
    const connection = openDatabase(':memory:');
    opened.push(connection.sqlite);

    const repo = new IdeaRepository(connection.db);
    const idea = createDraftIdea({
      id: 'idea-1',
      instrumentId: 'EURUSD',
      thesisTimeframe: 'W',
      direction: 'LONG',
      now: new Date('2026-09-09T12:00:00Z'),
    });

    await repo.insert(idea);
    const stored = await repo.findById('idea-1');

    expect(stored).toEqual(idea);
  });
});
