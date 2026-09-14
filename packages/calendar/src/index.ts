export type ReviewScheduleId = string & { readonly __brand: 'ReviewScheduleId' };
export type ReviewCycleId = string & { readonly __brand: 'ReviewCycleId' };
export type MarketReviewId = string & { readonly __brand: 'MarketReviewId' };
export type ReviewEventId = string & { readonly __brand: 'ReviewEventId' };
export type EconomicEventId = string & { readonly __brand: 'EconomicEventId' };
export type EconomicEventRevisionId = string & { readonly __brand: 'EconomicEventRevisionId' };

export const REVIEW_FREQUENCIES = ['EVERY_CANDLE','EVERY_2_CANDLES','EVERY_3_CANDLES','ONCE_TRADING_DAY','MANUAL'] as const;
export type ReviewFrequencyType = (typeof REVIEW_FREQUENCIES)[number];
export const REVIEW_STATUSES = ['DUE','COMPLETED','MISSED','SKIPPED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_DIRECTIONS = ['LONG','SHORT','NEUTRAL','UNCHANGED'] as const;
export type ReviewDirection = (typeof REVIEW_DIRECTIONS)[number];

export interface ReviewSchedule {
  readonly id: ReviewScheduleId;
  readonly name: string;
  readonly timeframeId: string;
  readonly instrumentScopeType: 'INSTRUMENT';
  readonly instrumentScopeId: string;
  readonly frequencyType: ReviewFrequencyType;
  readonly frequencyValue: number;
  readonly notificationPolicyId: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export interface ReviewCycle {
  readonly id: ReviewCycleId;
  readonly reviewScheduleId: ReviewScheduleId;
  readonly dueAt: string;
  readonly candleId: string | null;
  readonly status: ReviewStatus;
  readonly createdAt: string;
}

export interface MarketReview {
  readonly id: MarketReviewId;
  readonly reviewCycleId: ReviewCycleId;
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly status: ReviewStatus;
  readonly previousReviewId: MarketReviewId | null;
  readonly ideaVersionId: string | null;
  readonly direction: ReviewDirection;
  readonly notesDocumentId: string | null;
  readonly reviewedAt: string | null;
}

export interface ReviewEvent {
  readonly id: ReviewEventId;
  readonly marketReviewId: MarketReviewId;
  readonly fromStatus: 'DUE';
  readonly toStatus: Exclude<ReviewStatus, 'DUE'>;
  readonly occurredAt: string;
  readonly reason: string;
}

export function reviewScheduleId(value: string): ReviewScheduleId { requireToken(value, 'ReviewScheduleId'); return value as ReviewScheduleId; }
export function reviewCycleId(value: string): ReviewCycleId { requireToken(value, 'ReviewCycleId'); return value as ReviewCycleId; }
export function marketReviewId(value: string): MarketReviewId { requireToken(value, 'MarketReviewId'); return value as MarketReviewId; }
export function reviewEventId(value: string): ReviewEventId { requireToken(value, 'ReviewEventId'); return value as ReviewEventId; }
export function economicEventId(value: string): EconomicEventId { requireToken(value, 'EconomicEventId'); return value as EconomicEventId; }
export function economicEventRevisionId(value: string): EconomicEventRevisionId { requireToken(value, 'EconomicEventRevisionId'); return value as EconomicEventRevisionId; }

function requireToken(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) throw new Error(`${field} must be an opaque token`);
}
function requireText(value: string, field: string): void { if (!value.trim()) throw new Error(`${field} is required`); }
function requireIso(value: string, field: string): void { if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`); }

export function createReviewSchedule(input: ReviewSchedule): ReviewSchedule {
  requireToken(input.id, 'ReviewScheduleId'); requireText(input.name, 'name'); requireToken(input.timeframeId, 'timeframeId');
  requireToken(input.instrumentScopeId, 'instrumentScopeId'); requireIso(input.createdAt, 'createdAt');
  if (input.instrumentScopeType !== 'INSTRUMENT') throw new Error('ReviewSchedule instrumentScopeType must be INSTRUMENT');
  if (!REVIEW_FREQUENCIES.includes(input.frequencyType)) throw new Error(`Invalid review frequency ${input.frequencyType}`);
  if (!Number.isSafeInteger(input.frequencyValue) || input.frequencyValue < 1) throw new Error('frequencyValue must be >= 1');
  if (input.notificationPolicyId !== null) requireToken(input.notificationPolicyId, 'notificationPolicyId');
  return Object.freeze({ ...input });
}

export function createReviewCycle(input: ReviewCycle): ReviewCycle {
  requireToken(input.id, 'ReviewCycleId'); requireToken(input.reviewScheduleId, 'reviewScheduleId');
  requireIso(input.dueAt, 'dueAt'); requireIso(input.createdAt, 'createdAt');
  if (input.candleId !== null) requireToken(input.candleId, 'candleId');
  if (input.status !== 'DUE') throw new Error('New ReviewCycle must begin DUE');
  return Object.freeze({ ...input });
}

export function createMarketReview(input: MarketReview): MarketReview {
  requireToken(input.id, 'MarketReviewId'); requireToken(input.reviewCycleId, 'reviewCycleId');
  requireToken(input.instrumentId, 'instrumentId'); requireToken(input.timeframeId, 'timeframeId');
  if (!REVIEW_STATUSES.includes(input.status)) throw new Error(`Invalid review status ${input.status}`);
  if (!REVIEW_DIRECTIONS.includes(input.direction)) throw new Error(`Invalid review direction ${input.direction}`);
  if (input.previousReviewId !== null) { requireToken(input.previousReviewId, 'previousReviewId'); if (input.previousReviewId === input.id) throw new Error('MarketReview cannot reference itself as previous review'); }
  if (input.ideaVersionId !== null) requireToken(input.ideaVersionId, 'ideaVersionId');
  if (input.notesDocumentId !== null) requireToken(input.notesDocumentId, 'notesDocumentId');
  if ((input.status === 'DUE') !== (input.reviewedAt === null)) throw new Error('reviewedAt must be null only while DUE');
  if (input.reviewedAt !== null) requireIso(input.reviewedAt, 'reviewedAt');
  return Object.freeze({ ...input });
}

export function resolveReview(review: MarketReview, cycle: ReviewCycle, input: {
  readonly status: Exclude<ReviewStatus, 'DUE'>;
  readonly direction: ReviewDirection;
  readonly reviewedAt: string;
  readonly notesDocumentId: string | null;
  readonly ideaVersionId?: string | null;
  readonly eventId: ReviewEventId;
  readonly reason: string;
}): Readonly<{ review: MarketReview; cycle: ReviewCycle; event: ReviewEvent }> {
  if (review.status !== 'DUE' || cycle.status !== 'DUE') throw new Error('Only DUE reviews may be resolved');
  if (review.reviewCycleId !== cycle.id) throw new Error('Review and cycle mismatch');
  requireIso(input.reviewedAt, 'reviewedAt'); requireText(input.reason, 'reason'); requireToken(input.eventId, 'ReviewEventId');
  const nextReview = createMarketReview({
    ...review,
    status: input.status,
    direction: input.direction,
    reviewedAt: input.reviewedAt,
    notesDocumentId: input.notesDocumentId,
    ideaVersionId: input.ideaVersionId === undefined ? review.ideaVersionId : input.ideaVersionId,
  });
  const nextCycle: ReviewCycle = Object.freeze({ ...cycle, status: input.status });
  const event: ReviewEvent = Object.freeze({
    id: input.eventId,
    marketReviewId: review.id,
    fromStatus: 'DUE',
    toStatus: input.status,
    occurredAt: input.reviewedAt,
    reason: input.reason,
  });
  return Object.freeze({ review: nextReview, cycle: nextCycle, event });
}

export function deriveReviewFreshness(input: { readonly scheduled: boolean; readonly due: number; readonly missed: number }): 'CURRENT' | 'DUE' | 'MISSED' | 'NOT_SCHEDULED' {
  if (!input.scheduled) return 'NOT_SCHEDULED';
  if (input.missed > 0) return 'MISSED';
  if (input.due > 0) return 'DUE';
  return 'CURRENT';
}

export interface EconomicEvent {
  readonly id: EconomicEventId;
  readonly providerId: string;
  readonly providerEventKey: string;
  readonly title: string;
  readonly currency: string;
  readonly impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  readonly scheduledAt: string;
  readonly actual: string | null;
  readonly forecast: string | null;
  readonly previous: string | null;
  readonly status: string;
}
export interface EconomicEventRevision {
  readonly id: EconomicEventRevisionId;
  readonly economicEventId: EconomicEventId;
  readonly revisionNo: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly receivedAt: string;
}

export function createEconomicEvent(input: EconomicEvent): EconomicEvent {
  requireToken(input.id, 'EconomicEventId');
  requireText(input.providerId, 'providerId');
  requireText(input.providerEventKey, 'providerEventKey');
  requireText(input.title, 'title');
  requireText(input.currency, 'currency');
  requireIso(input.scheduledAt, 'scheduledAt');
  if (!['LOW','MEDIUM','HIGH','UNKNOWN'].includes(input.impact)) throw new Error(`Invalid economic impact ${input.impact}`);
  requireText(input.status, 'status');
  return Object.freeze({ ...input, currency: input.currency.toUpperCase() });
}

export function createEconomicEventRevision(input: EconomicEventRevision): EconomicEventRevision {
  requireToken(input.id, 'EconomicEventRevisionId');
  requireToken(input.economicEventId, 'economicEventId');
  if (!Number.isSafeInteger(input.revisionNo) || input.revisionNo < 1) throw new Error('revisionNo must be >= 1');
  requireIso(input.receivedAt, 'receivedAt');
  return Object.freeze({ ...input, payload: Object.freeze({ ...input.payload }) });
}

export interface CalendarProvider {
  readonly id: string;
  fetchRange(startAt: string, endAt: string): Promise<readonly EconomicEvent[]>;
}
export function currenciesForSymbol(baseCurrency: string, quoteCurrency: string): readonly string[] {
  return Object.freeze([baseCurrency.toUpperCase(), quoteCurrency.toUpperCase()]);
}
export function eventRelevantToCurrencies(event: EconomicEvent, currencies: readonly string[]): boolean {
  return currencies.some((currency) => currency.toUpperCase() === event.currency.toUpperCase());
}
