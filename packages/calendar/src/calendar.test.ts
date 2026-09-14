import { describe, expect, it } from 'vitest';
import {
  createMarketReview,
  createReviewCycle,
  deriveReviewFreshness,
  marketReviewId,
  resolveReview,
  reviewCycleId,
  reviewEventId,
  reviewScheduleId,
} from './index';

const now = '2026-09-10T12:00:00.000Z';

describe('review scheduler domain', () => {
  it('keeps not-reviewed distinct from NEUTRAL and resolves explicitly', () => {
    const cycle = createReviewCycle({ id: reviewCycleId('cycle-1'), reviewScheduleId: reviewScheduleId('schedule-1'), dueAt: now, candleId: null, status: 'DUE', createdAt: now });
    const review = createMarketReview({ id: marketReviewId('review-1'), reviewCycleId: cycle.id, instrumentId: 'instrument-1', timeframeId: 'tf-1', status: 'DUE', previousReviewId: null, ideaVersionId: null, direction: 'UNCHANGED', notesDocumentId: null, reviewedAt: null });
    const result = resolveReview(review, cycle, { status: 'COMPLETED', direction: 'LONG', reviewedAt: '2026-09-10T12:05:00.000Z', notesDocumentId: null, eventId: reviewEventId('event-1'), reason: 'Reviewed manually' });
    expect(result.review.status).toBe('COMPLETED');
    expect(result.review.direction).toBe('LONG');
    expect(result.event.fromStatus).toBe('DUE');
  });
});

describe('review freshness', () => {
  it('distinguishes not scheduled from a current completed queue', () => {
    expect(deriveReviewFreshness({ scheduled: false, due: 0, missed: 0 })).toBe('NOT_SCHEDULED');
    expect(deriveReviewFreshness({ scheduled: true, due: 0, missed: 0 })).toBe('CURRENT');
    expect(deriveReviewFreshness({ scheduled: true, due: 1, missed: 0 })).toBe('DUE');
    expect(deriveReviewFreshness({ scheduled: true, due: 0, missed: 1 })).toBe('MISSED');
  });
});

describe('economic calendar provider-neutral model', () => {
  it('normalizes currencies and validates immutable revisions', async () => {
    const { createEconomicEvent, createEconomicEventRevision, economicEventId, economicEventRevisionId, currenciesForSymbol, eventRelevantToCurrencies } = await import('./index');
    const event = createEconomicEvent({
      id: economicEventId('economic-event-1'), providerId: 'provider', providerEventKey: 'key-1', title: 'CPI', currency: 'usd', impact: 'HIGH', scheduledAt: now,
      actual: null, forecast: '2.4%', previous: '2.3%', status: 'SCHEDULED',
    });
    expect(event.currency).toBe('USD');
    expect(eventRelevantToCurrencies(event, currenciesForSymbol('eur', 'usd'))).toBe(true);
    const revision = createEconomicEventRevision({ id: economicEventRevisionId('economic-revision-1'), economicEventId: event.id, revisionNo: 1, payload: { forecast: '2.4%' }, receivedAt: now });
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.payload)).toBe(true);
  });
});
