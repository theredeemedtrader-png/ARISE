import {
  requireId,
  requireText,
  timestamp,
  type MarketObjectId,
  type MarketObjectRelationId,
  type Timestamp,
} from './primitives';

export interface MarketObjectRelation {
  readonly id: MarketObjectRelationId;
  readonly sourceMarketObjectId: MarketObjectId;
  readonly targetMarketObjectId: MarketObjectId;
  readonly relationType: string;
  readonly createdAt: Timestamp;
}
/** Static directed reference only; relation semantics and graph orchestration are external. */
export function createMarketObjectRelation(
  input: MarketObjectRelation,
): MarketObjectRelation {
  requireId(input.id);
  requireId(input.sourceMarketObjectId);
  requireId(input.targetMarketObjectId);
  requireText(input.relationType, 'relationType');
  timestamp(input.createdAt);
  return Object.freeze({
    id: input.id,
    sourceMarketObjectId: input.sourceMarketObjectId,
    targetMarketObjectId: input.targetMarketObjectId,
    relationType: input.relationType,
    createdAt: input.createdAt,
  });
}
