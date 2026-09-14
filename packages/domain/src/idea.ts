import {
  DomainValidationError,
  requireId,
  requireMember,
  requireNotBefore,
  timestamp,
  type IdeaId,
  type InstrumentId,
  type TimeframeId,
  type Timestamp,
} from './primitives';
import { requireTransition, transitionTable } from './lifecycle';

export const IDEA_STATUSES = Object.freeze([
  'DRAFT',
  'WATCHING',
  'ACTIVE',
  'IN_PLAY',
  'TARGET_APPROACHING',
  'TARGET_HIT',
  'COMPLETED',
  'INVALIDATED',
  'CANCELLED',
  'ARCHIVED',
] as const);
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
/** Conservative M1.1 defaults; STATE_MACHINES §8 specifies states, not edges. */
export const IDEA_TRANSITIONS = transitionTable<IdeaStatus>({
  DRAFT: ['WATCHING', 'CANCELLED'],
  WATCHING: ['ACTIVE', 'INVALIDATED', 'CANCELLED'],
  ACTIVE: ['IN_PLAY', 'INVALIDATED', 'CANCELLED'],
  IN_PLAY: ['TARGET_APPROACHING', 'INVALIDATED', 'CANCELLED'],
  TARGET_APPROACHING: ['TARGET_HIT', 'INVALIDATED', 'CANCELLED'],
  TARGET_HIT: ['COMPLETED'],
  COMPLETED: ['ARCHIVED'],
  INVALIDATED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
});
export interface Idea {
  readonly id: IdeaId;
  readonly instrumentId: InstrumentId;
  readonly thesisTimeframeId: TimeframeId;
  readonly currentStatus: IdeaStatus;
  readonly createdAt: Timestamp;
  readonly archivedAt: Timestamp | null;
}
export function validateIdea(idea: Idea): void {
  requireId(idea.id);
  requireId(idea.instrumentId);
  requireId(idea.thesisTimeframeId);
  requireMember(idea.currentStatus, IDEA_STATUSES, 'Idea status');
  timestamp(idea.createdAt);
  if ((idea.currentStatus === 'ARCHIVED') !== (idea.archivedAt !== null)) {
    throw new DomainValidationError(
      'archivedAt must exist exactly when Idea is ARCHIVED',
    );
  }
  if (idea.archivedAt !== null)
    requireNotBefore(idea.archivedAt, idea.createdAt);
}
export function createIdea(
  input: Pick<Idea, 'id' | 'instrumentId' | 'thesisTimeframeId' | 'createdAt'>,
): Idea {
  const idea: Idea = {
    id: input.id,
    instrumentId: input.instrumentId,
    thesisTimeframeId: input.thesisTimeframeId,
    currentStatus: 'DRAFT',
    createdAt: input.createdAt,
    archivedAt: null,
  };
  validateIdea(idea);
  return Object.freeze(idea);
}
/** Caller preserves consequential history when persisting; no external effects here. */
export function transitionIdea(
  idea: Idea,
  to: IdeaStatus,
  occurredAt: Timestamp,
): Idea {
  validateIdea(idea);
  requireNotBefore(occurredAt, idea.createdAt);
  requireTransition('Idea', IDEA_TRANSITIONS, idea.currentStatus, to);
  return Object.freeze({
    id: idea.id,
    instrumentId: idea.instrumentId,
    thesisTimeframeId: idea.thesisTimeframeId,
    createdAt: idea.createdAt,
    currentStatus: to,
    archivedAt: to === 'ARCHIVED' ? occurredAt : null,
  });
}
// Deprecated frozen-M0 compatibility entry point; canonical callers use createIdea.
export { createDraftIdea } from './legacy-idea';
