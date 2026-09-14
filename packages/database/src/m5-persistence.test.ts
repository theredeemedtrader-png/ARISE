import { describe, expect, it } from 'vitest';
import { blockId, documentId, documentVersionId, folderId } from '@arise/documents';
import { createMarketReview, createReviewCycle, createReviewSchedule, marketReviewId, reviewCycleId, reviewEventId, reviewScheduleId } from '@arise/calendar';
import { createInstrument, createTimeframe, entityId, timestamp } from '@arise/domain';
import { DocumentRepository } from './document-repository';
import { openDatabase } from './database';
import { InstrumentRepository, TimeframeRepository } from './reference-repository';
import { PlanningRepository } from './planning-repository';
import { ReviewRepository } from './review-repository';

const now = '2026-09-10T12:00:00.000Z';

describe('M5 documents and review persistence', () => {
  it('versions documents without overwriting old content', () => {
    const connection = openDatabase(':memory:');
    try {
      const repo = new DocumentRepository(connection.db);
      const folder = repo.insertFolder({ id: folderId('folder-1'), name: 'Research', parentFolderId: null, sortOrder: 0, createdAt: now });
      const first = repo.create({
        document: { id: documentId('doc-1'), documentType: 'NOTE', title: 'Liquidity', primaryFolderId: folder.id, linkedEntityType: null, linkedEntityId: null, createdAt: now },
        versionId: documentVersionId('docv-1'),
        content: { blocks: [{ id: blockId('block-1'), type: 'PARAGRAPH', text: 'First [[Target]]' }] },
      });
      repo.appendVersion(first.document.id, { id: documentVersionId('docv-2'), createdAt: '2026-09-10T12:01:00.000Z', content: { blocks: [{ id: blockId('block-1'), type: 'PARAGRAPH', text: 'Second' }] } });
      const rebuilt = repo.reconstruct(first.document.id)!;
      expect(rebuilt.versions).toHaveLength(2);
      expect(rebuilt.versions[0]?.content.blocks[0]?.text).toBe('First [[Target]]');
      expect(rebuilt.currentVersion.content.blocks[0]?.text).toBe('Second');
      expect(() => connection.sqlite.exec("UPDATE document_versions SET content_json='{}' WHERE id='docv-1'")).toThrow('immutable');
    } finally { connection.sqlite.close(); }
  });

  it('persists explicit review states without treating DUE as NEUTRAL', () => {
    const connection = openDatabase(':memory:');
    try {
      const instrument = createInstrument({ id: entityId('Instrument','instrument-eurusd'), canonicalSymbol: 'EURUSD', displayName: 'EUR/USD', assetClass: 'FOREX', baseCurrency: 'EUR', quoteCurrency: 'USD', pipSize: 0.0001, tickSize: 0.00001, priceDigits: 5, enabled: true, createdAt: timestamp(now) });
      const timeframe = createTimeframe({ id: entityId('Timeframe','timeframe-d'), code: 'D', durationSeconds: null, calendarRule: 'BROKER_DAILY', displayOrder: 1 });
      new InstrumentRepository(connection.db).insert(instrument);
      new TimeframeRepository(connection.db).insert(timeframe);
      const repo = new ReviewRepository(connection.db);
      const schedule = createReviewSchedule({ id: reviewScheduleId('schedule-1'), name: 'EURUSD Daily', timeframeId: timeframe.id, instrumentScopeType: 'INSTRUMENT', instrumentScopeId: instrument.id, frequencyType: 'EVERY_CANDLE', frequencyValue: 1, notificationPolicyId: null, enabled: true, createdAt: now });
      repo.insertSchedule(schedule);
      const cycle = createReviewCycle({ id: reviewCycleId('cycle-1'), reviewScheduleId: schedule.id, dueAt: now, candleId: null, status: 'DUE', createdAt: now });
      const review = createMarketReview({ id: marketReviewId('review-1'), reviewCycleId: cycle.id, instrumentId: instrument.id, timeframeId: timeframe.id, status: 'DUE', previousReviewId: null, ideaVersionId: null, direction: 'UNCHANGED', notesDocumentId: null, reviewedAt: null });
      repo.enqueue({ cycle, review });
      expect(repo.listQueue()[0]?.review.direction).toBe('UNCHANGED');
      repo.resolve(review.id, { status: 'COMPLETED', direction: 'LONG', reviewedAt: '2026-09-10T12:05:00.000Z', notesDocumentId: null, eventId: reviewEventId('review-event-1'), reason: 'Manual review' });
      expect(repo.listQueue()[0]?.review.status).toBe('COMPLETED');
      expect(repo.listEvents(review.id)).toHaveLength(1);
      expect(() => connection.sqlite.exec("UPDATE review_events SET reason='changed' WHERE id='review-event-1'")).toThrow('immutable');
    } finally { connection.sqlite.close(); }
  });
});

describe('M5 planning persistence', () => {
  it('creates Idea + v1 + Colony + Thesis document atomically and versions thesis edits', () => {
    const connection = openDatabase(':memory:');
    try {
      const instrument = createInstrument({ id: entityId('Instrument','instrument-plan'), canonicalSymbol: 'GBPUSD', displayName: 'GBP/USD', assetClass: 'FOREX', baseCurrency: 'GBP', quoteCurrency: 'USD', pipSize: 0.0001, tickSize: 0.00001, priceDigits: 5, enabled: true, createdAt: timestamp(now) });
      const timeframe = createTimeframe({ id: entityId('Timeframe','timeframe-plan-d'), code: 'D', durationSeconds: null, calendarRule: 'BROKER_DAILY', displayOrder: 1 });
      new InstrumentRepository(connection.db).insert(instrument);
      new TimeframeRepository(connection.db).insert(timeframe);
      const repo = new PlanningRepository(connection.db);
      const created = repo.create({
        ideaId: 'idea-plan', ideaVersionId: 'idea-plan-v1', colonyId: 'colony-plan', documentId: 'doc-plan', documentVersionId: 'doc-plan-v1', blockId: 'block-plan', entityLinkId: 'link-plan-v1',
        instrumentId: instrument.id, timeframeId: timeframe.id, direction: 'LONG', thesisText: 'Toward [[Weekly BSL]]', targetDescription: 'Weekly BSL', invalidationDescription: 'Daily close below low',
        primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null, colonyLabel: 'GBPUSD · D LONG #01', createdAt: '2026-09-10T12:01:00.000Z',
      });
      expect(created.status).toBe('DRAFT');
      expect(created.colonyState).toBe('DORMANT');
      expect(created.versionNo).toBe(1);
      const updated = repo.updateThesis({
        ideaId: created.ideaId, ideaVersionId: 'idea-plan-v2', documentVersionId: 'doc-plan-v2', entityLinkId: 'link-plan-v2', direction: 'LONG', thesisText: 'Updated thesis', targetDescription: 'External liquidity', invalidationDescription: 'Structure failure',
        primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null,
        thesisBlocks: { blocks: [{ id: blockId('block-plan'), type: 'PARAGRAPH', text: 'Updated thesis' }] }, createdAt: '2026-09-10T12:02:00.000Z',
      });
      expect(updated.versionNo).toBe(2);
      expect(updated.thesisText).toBe('Updated thesis');
      expect(repo.findById(entityId('Idea','idea-plan'))?.versionNo).toBe(2);
    } finally { connection.sqlite.close(); }
  });
});
