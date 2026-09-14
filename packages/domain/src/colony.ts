import { validateIdea, type Idea } from './idea';
import { validateIdeaVersion, type IdeaVersion } from './idea-version';
import {
  copyTransitionContext,
  requireTransition,
  transitionTable,
  type TransitionContext,
} from './lifecycle';
import {
  DomainValidationError,
  requireId,
  requireMember,
  requireNotBefore,
  requireText,
  timestamp,
  type ColonyId,
  type ColonyLineageId,
  type ColonyStateEventId,
  type IdeaId,
  type IdeaVersionId,
  type InstrumentId,
  type TargetId,
  type Timestamp,
} from './primitives';

export const COLONY_STATES = Object.freeze([
  'DORMANT',
  'BUILDING',
  'ESTABLISHED',
  'MATURE',
  'DECAYING',
  'INVALIDATED',
  'COMPLETED',
] as const);
export type ColonyState = (typeof COLONY_STATES)[number];
/** Exactly the listed edges in STATE_MACHINES §7. No implicit recovery/decay shortcut. */
export const COLONY_TRANSITIONS = transitionTable<ColonyState>({
  DORMANT: ['BUILDING', 'INVALIDATED'],
  BUILDING: ['ESTABLISHED', 'DECAYING', 'INVALIDATED', 'COMPLETED'],
  ESTABLISHED: ['MATURE', 'DECAYING', 'INVALIDATED', 'COMPLETED'],
  MATURE: ['DECAYING', 'INVALIDATED', 'COMPLETED'],
  DECAYING: ['INVALIDATED'],
  INVALIDATED: ['COMPLETED'],
  COMPLETED: [],
});
export interface Colony {
  readonly id: ColonyId;
  readonly ideaId: IdeaId;
  readonly originalIdeaVersionId: IdeaVersionId;
  readonly instrumentId: InstrumentId;
  readonly label: string;
  readonly currentState: ColonyState;
  readonly currentTargetId: TargetId | null;
  readonly createdAt: Timestamp;
  readonly completedAt: Timestamp | null;
}
export function validateColony(colony: Colony): void {
  for (const id of [
    colony.id,
    colony.ideaId,
    colony.originalIdeaVersionId,
    colony.instrumentId,
  ])
    requireId(id);
  if (colony.currentTargetId !== null) requireId(colony.currentTargetId);
  requireText(colony.label, 'label');
  timestamp(colony.createdAt);
  requireMember(colony.currentState, COLONY_STATES, 'Colony state');
  if ((colony.currentState === 'COMPLETED') !== (colony.completedAt !== null)) {
    throw new DomainValidationError(
      'completedAt must exist exactly when Colony is COMPLETED',
    );
  }
  if (colony.completedAt !== null)
    requireNotBefore(colony.completedAt, colony.createdAt);
}
export function createColony(input: {
  readonly id: ColonyId;
  readonly idea: Idea;
  readonly originalIdeaVersion: IdeaVersion;
  readonly label: string;
  readonly createdAt: Timestamp;
}): Colony {
  validateIdea(input.idea);
  validateIdeaVersion(input.originalIdeaVersion);
  if (input.originalIdeaVersion.ideaId !== input.idea.id)
    throw new DomainValidationError('IdeaVersion belongs to another Idea');
  requireNotBefore(input.originalIdeaVersion.createdAt, input.idea.createdAt);
  requireNotBefore(input.createdAt, input.originalIdeaVersion.createdAt);
  const colony: Colony = {
    id: input.id,
    ideaId: input.idea.id,
    originalIdeaVersionId: input.originalIdeaVersion.id,
    instrumentId: input.idea.instrumentId,
    label: input.label,
    currentState: 'DORMANT',
    currentTargetId: null,
    createdAt: input.createdAt,
    completedAt: null,
  };
  validateColony(colony);
  return Object.freeze(colony);
}
export interface ColonyStateEvent extends TransitionContext {
  readonly id: ColonyStateEventId;
  readonly colonyId: ColonyId;
  readonly fromState: ColonyState;
  readonly toState: ColonyState;
}
export function createColonyStateEvent(
  input: ColonyStateEvent,
): ColonyStateEvent {
  requireId(input.id);
  requireId(input.colonyId);
  requireTransition(
    'Colony',
    COLONY_TRANSITIONS,
    input.fromState,
    input.toState,
  );
  return Object.freeze({
    ...copyTransitionContext(input),
    id: input.id,
    colonyId: input.colonyId,
    fromState: input.fromState,
    toState: input.toState,
  });
}
/** Returns both values for a future atomic write. Does not persist or perform management. */
export function transitionColony(
  colony: Colony,
  to: ColonyState,
  context: TransitionContext & { readonly id: ColonyStateEventId },
): Readonly<{ colony: Colony; event: ColonyStateEvent }> {
  validateColony(colony);
  requireNotBefore(context.occurredAt, colony.createdAt);
  const event = createColonyStateEvent({
    ...context,
    colonyId: colony.id,
    fromState: colony.currentState,
    toState: to,
  });
  const next: Colony = {
    id: colony.id,
    ideaId: colony.ideaId,
    originalIdeaVersionId: colony.originalIdeaVersionId,
    instrumentId: colony.instrumentId,
    label: colony.label,
    currentTargetId: colony.currentTargetId,
    createdAt: colony.createdAt,
    currentState: to,
    completedAt: to === 'COMPLETED' ? context.occurredAt : null,
  };
  return Object.freeze({ colony: Object.freeze(next), event });
}
export const COLONY_RELATIONSHIPS = Object.freeze([
  'PROMOTED_TO',
  'CONSOLIDATED_INTO',
  'DERIVED_FROM',
] as const);
export type ColonyRelationship = (typeof COLONY_RELATIONSHIPS)[number];
export interface ColonyLineage {
  readonly id: ColonyLineageId;
  readonly sourceColonyId: ColonyId;
  readonly targetColonyId: ColonyId;
  readonly relationshipType: ColonyRelationship;
}
export function createColonyLineage(input: ColonyLineage): ColonyLineage {
  requireId(input.id);
  requireId(input.sourceColonyId);
  requireId(input.targetColonyId);
  requireMember(
    input.relationshipType,
    COLONY_RELATIONSHIPS,
    'Colony relationship',
  );
  if (input.sourceColonyId === input.targetColonyId)
    throw new DomainValidationError('Lineage requires distinct Colonies');
  return Object.freeze({
    id: input.id,
    sourceColonyId: input.sourceColonyId,
    targetColonyId: input.targetColonyId,
    relationshipType: input.relationshipType,
  });
}
