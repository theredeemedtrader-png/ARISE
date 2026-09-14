import { validateIdea, type Idea } from './idea';
import {
  DomainValidationError,
  requireId,
  requireInteger,
  requireMember,
  requireNotBefore,
  timestamp,
  type IdeaId,
  type IdeaVersionId,
  type MarketObjectVersionId,
  type Timestamp,
} from './primitives';

export const DIRECTIONS = Object.freeze(['LONG', 'SHORT', 'NEUTRAL'] as const);
export type Direction = (typeof DIRECTIONS)[number];
export interface ThesisSnapshot {
  readonly direction: Direction;
  readonly thesisText: string;
  readonly targetDescription: string;
  readonly invalidationDescription: string;
  readonly primaryTargetMarketObjectVersionId: MarketObjectVersionId | null;
  readonly invalidationMarketObjectVersionId: MarketObjectVersionId | null;
}
export interface IdeaVersion extends ThesisSnapshot {
  readonly id: IdeaVersionId;
  readonly ideaId: IdeaId;
  readonly versionNo: number;
  readonly createdAt: Timestamp;
  readonly supersedesIdeaVersionId: IdeaVersionId | null;
}
export type NewIdeaVersion = ThesisSnapshot & {
  readonly id: IdeaVersionId;
  readonly createdAt: Timestamp;
};
export function validateIdeaVersion(version: IdeaVersion): void {
  requireId(version.id);
  requireId(version.ideaId);
  requireInteger(version.versionNo, 1, 'versionNo');
  requireMember(version.direction, DIRECTIONS, 'direction');
  timestamp(version.createdAt);
  for (const field of [
    'thesisText',
    'targetDescription',
    'invalidationDescription',
  ] as const) {
    // Draft snapshots may contain empty prose, but never non-string values.
    if (typeof version[field] !== 'string')
      throw new DomainValidationError(`${field} must be text`);
  }
  for (const ref of [
    version.primaryTargetMarketObjectVersionId,
    version.invalidationMarketObjectVersionId,
  ]) {
    if (ref !== null) requireId(ref);
  }
  if (
    (version.versionNo === 1) !==
    (version.supersedesIdeaVersionId === null)
  ) {
    throw new DomainValidationError('Only v1 has no superseded version');
  }
  if (version.supersedesIdeaVersionId !== null) {
    requireId(version.supersedesIdeaVersionId);
    if (version.id === version.supersedesIdeaVersionId)
      throw new DomainValidationError('A version cannot supersede itself');
  }
}
function snapshot(
  ideaId: IdeaId,
  input: NewIdeaVersion,
  versionNo: number,
  supersedesIdeaVersionId: IdeaVersionId | null,
): IdeaVersion {
  const version: IdeaVersion = {
    id: input.id,
    ideaId,
    versionNo,
    createdAt: input.createdAt,
    supersedesIdeaVersionId,
    direction: input.direction,
    thesisText: input.thesisText,
    targetDescription: input.targetDescription,
    invalidationDescription: input.invalidationDescription,
    primaryTargetMarketObjectVersionId:
      input.primaryTargetMarketObjectVersionId,
    invalidationMarketObjectVersionId: input.invalidationMarketObjectVersionId,
  };
  validateIdeaVersion(version);
  return Object.freeze(version);
}
export function createIdeaVersion(
  idea: Idea,
  input: NewIdeaVersion,
): IdeaVersion {
  validateIdea(idea);
  requireNotBefore(input.createdAt, idea.createdAt);
  return snapshot(idea.id, input, 1, null);
}
/** Pure successor of supplied version. Global uniqueness/current-head checks belong to persistence. */
export function createSuccessorIdeaVersion(
  previous: IdeaVersion,
  input: NewIdeaVersion,
): IdeaVersion {
  validateIdeaVersion(previous);
  requireNotBefore(input.createdAt, previous.createdAt);
  if (
    input.id === previous.id ||
    input.id === previous.supersedesIdeaVersionId
  ) {
    throw new DomainValidationError(
      'Successor requires a fresh IdeaVersion ID',
    );
  }
  return snapshot(previous.ideaId, input, previous.versionNo + 1, previous.id);
}
