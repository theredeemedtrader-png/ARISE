// Deterministic test fixtures; no clock, persistence, market feed or broker.
import { createIdea } from './idea';
import { createIdeaVersion } from './idea-version';
import { createColony } from './colony';
import { createAttempt } from './attempt';
import { createTrade } from './trade';
import { createPosition } from './position';
import { brokerPositionKey } from './participation-values';
import { entityId, timestamp } from './primitives';

export const start = timestamp('2026-09-10T12:00:00.000Z');
export const later = timestamp('2026-09-10T13:00:00.000Z');
export const earlier = timestamp('2026-09-10T11:00:00.000Z');
export const idea = createIdea({
  id: entityId('Idea', 'idea-p'),
  instrumentId: entityId('Instrument', 'instrument-p'),
  thesisTimeframeId: entityId('Timeframe', 'tf-p'),
  createdAt: start,
});
export const version = createIdeaVersion(idea, {
  id: entityId('IdeaVersion', 'iv-p'),
  direction: 'LONG',
  thesisText: '',
  targetDescription: '',
  invalidationDescription: '',
  primaryTargetMarketObjectVersionId: null,
  invalidationMarketObjectVersionId: null,
  createdAt: start,
});
export const colony = createColony({
  id: entityId('Colony', 'colony-p'),
  idea,
  originalIdeaVersion: version,
  label: 'Weekly Long #05',
  createdAt: start,
});
export const attemptInput = {
  id: entityId('Attempt', 'attempt-p'),
  strategyRuntimeId: null,
  sequenceNo: 24,
  startedAt: start,
  completedAt: null,
  result: null,
  pipCost: null,
};
export const attempt = createAttempt(colony, attemptInput);
export const tradeInput = {
  id: entityId('Trade', 'trade-p'),
  colony,
  ideaVersion: version,
  attempt,
  strategyMapVersionId: null,
  direction: 'LONG' as const,
  sourceType: 'ARISE_AUTO' as const,
  createdAt: start,
};
export const trade = createTrade(tradeInput);
export const positionInput = {
  id: entityId('Position', 'position-p'),
  brokerAccountId: entityId('BrokerAccount', 'account-p'),
  brokerPositionKey: brokerPositionKey('provider:opaque/position@123'),
  currentColonyId: colony.id,
  originalSize: 0.1,
  currentSize: 0.1,
  entryPrice: 1.105,
  currentState: 'SCOUT' as const,
  openedAt: start,
  closedAt: null,
};
export const position = createPosition(trade, positionInput);
export const eventContext = {
  id: entityId('PositionStateEvent', 'pse-p'),
  reason: 'Supplied campaign evidence',
  sourceType: 'MANUAL_REVIEW',
  sourceId: 'source-p',
  manualOverride: true,
  correlationId: 'trace-p',
  occurredAt: later,
};
