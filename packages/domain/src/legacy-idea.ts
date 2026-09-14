import type { Direction } from './idea-version';

// Frozen M0 smoke-test DTO. Not the canonical Idea/IdeaVersion model.
// Retained until persistence is explicitly migrated in a later task.

export interface LegacyIdea {
  id: string;
  instrumentId: string;
  thesisTimeframe: string;
  direction: Direction;
  status:
    'DRAFT' | 'WATCHING' | 'ACTIVE' | 'IN_PLAY' | 'COMPLETED' | 'INVALIDATED';
  createdAt: Date;
}

export function createDraftIdea(params: {
  id: string;
  instrumentId: string;
  thesisTimeframe: string;
  direction: Direction;
  now?: Date;
}): LegacyIdea {
  if (!params.instrumentId.trim()) throw new Error('instrumentId is required');
  if (!params.thesisTimeframe.trim())
    throw new Error('thesisTimeframe is required');

  return {
    id: params.id,
    instrumentId: params.instrumentId,
    thesisTimeframe: params.thesisTimeframe,
    direction: params.direction,
    status: 'DRAFT',
    createdAt: params.now ?? new Date(),
  };
}
