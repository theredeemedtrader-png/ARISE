import { and, asc, desc, eq } from 'drizzle-orm';
import {
  createMarketReview,
  createReviewCycle,
  createReviewSchedule,
  marketReviewId,
  resolveReview,
  reviewCycleId,
  reviewEventId,
  reviewScheduleId,
  type MarketReview,
  type ReviewCycle,
  type ReviewEvent,
  type ReviewSchedule,
  type ReviewStatus,
} from '@arise/calendar';
import type { AriseDatabase } from './database';
import { intToBool, boolToInt } from './codec';
import { PersistenceConflictError, PersistenceNotFoundError } from './errors';
import { instruments, marketReviews, reviewCycles, reviewEvents, reviewSchedules, timeframes } from './schema';

function hydrateSchedule(row: typeof reviewSchedules.$inferSelect): ReviewSchedule {
  return createReviewSchedule({
    id: reviewScheduleId(row.id), name: row.name, timeframeId: row.timeframeId,
    instrumentScopeType: row.instrumentScopeType, instrumentScopeId: row.instrumentScopeId,
    frequencyType: row.frequencyType, frequencyValue: row.frequencyValue,
    notificationPolicyId: row.notificationPolicyId, enabled: intToBool(row.enabled), createdAt: row.createdAt,
  });
}
function hydrateCycle(row: typeof reviewCycles.$inferSelect): ReviewCycle {
  return Object.freeze({ id: reviewCycleId(row.id), reviewScheduleId: reviewScheduleId(row.reviewScheduleId), dueAt: row.dueAt, candleId: row.candleId, status: row.status, createdAt: row.createdAt });
}
function hydrateReview(row: typeof marketReviews.$inferSelect): MarketReview {
  return createMarketReview({
    id: marketReviewId(row.id), reviewCycleId: reviewCycleId(row.reviewCycleId), instrumentId: row.instrumentId, timeframeId: row.timeframeId,
    status: row.status, previousReviewId: row.previousReviewId === null ? null : marketReviewId(row.previousReviewId), ideaVersionId: row.ideaVersionId,
    direction: row.direction, notesDocumentId: row.notesDocumentId, reviewedAt: row.reviewedAt,
  });
}
function hydrateEvent(row: typeof reviewEvents.$inferSelect): ReviewEvent {
  return Object.freeze({ id: reviewEventId(row.id), marketReviewId: marketReviewId(row.marketReviewId), fromStatus: row.fromStatus, toStatus: row.toStatus, occurredAt: row.occurredAt, reason: row.reason });
}

export interface ReviewQueueEntry {
  readonly schedule: ReviewSchedule;
  readonly cycle: ReviewCycle;
  readonly review: MarketReview;
}

export class ReviewRepository {
  constructor(private readonly db: AriseDatabase) {}

  insertSchedule(input: ReviewSchedule): ReviewSchedule {
    const value = createReviewSchedule(input);
    const instrument = this.db.select().from(instruments).where(eq(instruments.id, value.instrumentScopeId)).limit(1).all()[0];
    const timeframe = this.db.select().from(timeframes).where(eq(timeframes.id, value.timeframeId)).limit(1).all()[0];
    if (!instrument) throw new PersistenceNotFoundError('Instrument', value.instrumentScopeId);
    if (!timeframe) throw new PersistenceNotFoundError('Timeframe', value.timeframeId);
    this.db.insert(reviewSchedules).values({
      id: value.id, name: value.name, timeframeId: value.timeframeId, instrumentScopeType: value.instrumentScopeType,
      instrumentScopeId: value.instrumentScopeId, frequencyType: value.frequencyType, frequencyValue: value.frequencyValue,
      notificationPolicyId: value.notificationPolicyId, enabled: boolToInt(value.enabled), createdAt: value.createdAt,
    }).run();
    return value;
  }

  listSchedules(): readonly ReviewSchedule[] {
    return Object.freeze(this.db.select().from(reviewSchedules).orderBy(asc(reviewSchedules.createdAt), asc(reviewSchedules.id)).all().map(hydrateSchedule));
  }

  enqueue(input: { readonly cycle: ReviewCycle; readonly review: MarketReview }): ReviewQueueEntry {
    const cycle = createReviewCycle(input.cycle);
    const review = createMarketReview(input.review);
    if (review.reviewCycleId !== cycle.id) throw new Error('Review must belong to enqueued cycle');
    this.db.transaction((tx) => {
      const schedule = tx.select().from(reviewSchedules).where(eq(reviewSchedules.id, cycle.reviewScheduleId)).limit(1).all()[0];
      if (!schedule) throw new PersistenceNotFoundError('ReviewSchedule', cycle.reviewScheduleId);
      if (review.instrumentId !== schedule.instrumentScopeId || review.timeframeId !== schedule.timeframeId) throw new Error('Review scope must match schedule');
      tx.insert(reviewCycles).values(cycle).run();
      tx.insert(marketReviews).values({
        id: review.id, reviewCycleId: review.reviewCycleId, instrumentId: review.instrumentId, timeframeId: review.timeframeId, status: review.status,
        previousReviewId: review.previousReviewId, ideaVersionId: review.ideaVersionId, direction: review.direction,
        notesDocumentId: review.notesDocumentId, reviewedAt: review.reviewedAt,
      }).run();
    });
    return { schedule: this.findSchedule(cycle.reviewScheduleId)!, cycle, review };
  }

  resolve(reviewIdValue: ReturnType<typeof marketReviewId>, input: { readonly status: Exclude<ReviewStatus, 'DUE'>; readonly direction: MarketReview['direction']; readonly reviewedAt: string; readonly notesDocumentId: string | null; readonly ideaVersionId?: string | null; readonly eventId: ReturnType<typeof reviewEventId>; readonly reason: string }): ReviewQueueEntry {
    let nextReview!: MarketReview;
    let nextCycle!: ReviewCycle;
    this.db.transaction((tx) => {
      const reviewRow = tx.select().from(marketReviews).where(eq(marketReviews.id, reviewIdValue)).limit(1).all()[0];
      if (!reviewRow) throw new PersistenceNotFoundError('MarketReview', reviewIdValue);
      const currentReview = hydrateReview(reviewRow);
      const cycleRow = tx.select().from(reviewCycles).where(eq(reviewCycles.id, currentReview.reviewCycleId)).limit(1).all()[0];
      if (!cycleRow) throw new PersistenceNotFoundError('ReviewCycle', currentReview.reviewCycleId);
      const currentCycle = hydrateCycle(cycleRow);
      const result = resolveReview(currentReview, currentCycle, input);
      nextReview = result.review; nextCycle = result.cycle;
      const updatedReview = tx.update(marketReviews).set({
        status: nextReview.status, direction: nextReview.direction, reviewedAt: nextReview.reviewedAt,
        notesDocumentId: nextReview.notesDocumentId, ideaVersionId: nextReview.ideaVersionId,
      }).where(and(eq(marketReviews.id, currentReview.id), eq(marketReviews.status, 'DUE'))).run();
      const updatedCycle = tx.update(reviewCycles).set({ status: nextCycle.status }).where(and(eq(reviewCycles.id, currentCycle.id), eq(reviewCycles.status, 'DUE'))).run();
      if (updatedReview.changes !== 1 || updatedCycle.changes !== 1) throw new PersistenceConflictError('Review changed concurrently');
      tx.insert(reviewEvents).values(result.event).run();
    });
    const schedule = this.findSchedule(nextCycle.reviewScheduleId)!;
    return { schedule, cycle: nextCycle, review: nextReview };
  }

  findSchedule(id: ReturnType<typeof reviewScheduleId>): ReviewSchedule | null {
    const row = this.db.select().from(reviewSchedules).where(eq(reviewSchedules.id, id)).limit(1).all()[0];
    return row ? hydrateSchedule(row) : null;
  }

  listQueue(): readonly ReviewQueueEntry[] {
    const schedulesById = new Map<string, ReviewSchedule>(this.listSchedules().map((schedule) => [schedule.id, schedule]));
    const cyclesById = new Map<string, ReviewCycle>(this.db.select().from(reviewCycles).all().map(hydrateCycle).map((cycle) => [cycle.id, cycle]));
    const reviews = this.db.select().from(marketReviews).orderBy(asc(marketReviews.id)).all().map(hydrateReview);
    return Object.freeze(reviews.map((review) => {
      const cycle = cyclesById.get(review.reviewCycleId);
      if (!cycle) throw new PersistenceConflictError(`Review ${review.id} has no cycle`);
      const schedule = schedulesById.get(cycle.reviewScheduleId);
      if (!schedule) throw new PersistenceConflictError(`Review ${review.id} has no schedule`);
      return Object.freeze({ schedule, cycle, review });
    }));
  }

  previousCompleted(instrumentId: string, timeframeId: string): MarketReview | null {
    const row = this.db.select().from(marketReviews)
      .where(and(eq(marketReviews.instrumentId, instrumentId), eq(marketReviews.timeframeId, timeframeId), eq(marketReviews.status, 'COMPLETED')))
      .orderBy(desc(marketReviews.reviewedAt), desc(marketReviews.id)).limit(1).all()[0];
    return row ? hydrateReview(row) : null;
  }

  listEvents(reviewIdValue: ReturnType<typeof marketReviewId>): readonly ReviewEvent[] {
    return Object.freeze(this.db.select().from(reviewEvents).where(eq(reviewEvents.marketReviewId, reviewIdValue)).orderBy(asc(reviewEvents.occurredAt), asc(reviewEvents.id)).all().map(hydrateEvent));
  }
}
