import { asc, eq } from 'drizzle-orm';
import {
  createEvidenceEvent,
  createEvidenceReference,
  createEvidenceSnapshot,
  createEvidenceStageSummary,
  evidenceCaptureAttemptId,
  evidenceEventId,
  evidenceSnapshotId,
  type ChartWorkspaceEvidenceState,
  type EvidenceCaptureAttemptId,
  type EvidenceFramingProfile,
  type EvidenceRecordPlan,
  type EvidenceReference,
  type EvidenceSnapshot,
  type EvidenceStageSummary,
} from '@arise/evidence';
import type { AriseDatabase, AriseTransaction } from './database';
import { PersistenceNotFoundError } from './errors';
import { evidenceCaptureAttempts, evidenceEvents, evidenceReferences, evidenceSnapshots, evidenceStageSummaries, evidenceStageSummaryItems } from './schema';

export interface EvidenceCaptureAttempt {
  readonly id: EvidenceCaptureAttemptId;
  readonly evidenceEventId: ReturnType<typeof evidenceEventId>;
  readonly evidenceSnapshotId: ReturnType<typeof evidenceSnapshotId> | null;
  readonly status: 'SUCCEEDED' | 'FAILED';
  readonly error: string | null;
  readonly attemptedAt: string;
}
export interface EvidenceAggregate {
  readonly plan: EvidenceRecordPlan;
  readonly snapshots: readonly EvidenceSnapshot[];
  readonly captureAttempts: readonly EvidenceCaptureAttempt[];
}

export function insertEvidencePlans(tx: AriseTransaction, plans: readonly EvidenceRecordPlan[]): void {
  if (!plans.length) return;
  tx.insert(evidenceEvents).values(plans.map(({ event, workspaceState, framingProfile }) => ({
    id: event.id, sourceType: event.sourceType, sourceId: event.sourceId, eventType: event.eventType, status: event.status,
    occurredAt: event.occurredAt, summary: event.summary, decisionTraceId: event.decisionTraceId,
    strategyRuntimeId: event.strategyRuntimeId, runtimeNodeId: event.runtimeNodeId, timeframe: event.timeframe,
    capturePolicy: event.capturePolicy, chartWorkspaceStateJson: JSON.stringify(workspaceState), framingProfileJson: JSON.stringify(framingProfile),
  }))).run();
  const references = plans.flatMap((plan) => plan.references);
  if (references.length) tx.insert(evidenceReferences).values(references.map((reference) => ({
    id: reference.id, evidenceEventId: reference.evidenceEventId, entityType: reference.entityType, entityId: reference.entityId,
    entityVersionId: reference.entityVersionId, relationType: reference.relationType, createdAt: reference.createdAt,
  }))).run();
}

export class EvidenceRepository {
  constructor(private readonly db: AriseDatabase) {}

  record(plans: readonly EvidenceRecordPlan[]): void { this.db.transaction((tx) => insertEvidencePlans(tx, plans)); }

  recordCaptureSuccess(snapshot: EvidenceSnapshot, attemptIdValue: string): void {
    this.db.transaction((tx) => {
      tx.insert(evidenceSnapshots).values({ id: snapshot.id, evidenceEventId: snapshot.evidenceEventId, chartWorkspaceStateJson: JSON.stringify(snapshot.chartWorkspaceState), imagePath: snapshot.imagePath, imageHash: snapshot.imageHash, framingProfileJson: JSON.stringify(snapshot.framingProfile), capturedAt: snapshot.capturedAt, captureOrigin: snapshot.captureOrigin }).run();
      tx.insert(evidenceCaptureAttempts).values({ id: evidenceCaptureAttemptId(attemptIdValue), evidenceEventId: snapshot.evidenceEventId, evidenceSnapshotId: snapshot.id, status: 'SUCCEEDED', error: null, attemptedAt: snapshot.capturedAt }).run();
    });
  }

  recordCaptureFailure(input: { readonly id: string; readonly evidenceEventId: string; readonly error: string; readonly attemptedAt: string }): void {
    txGuard(this.db, input.evidenceEventId);
    this.db.insert(evidenceCaptureAttempts).values({ id: evidenceCaptureAttemptId(input.id), evidenceEventId: evidenceEventId(input.evidenceEventId), evidenceSnapshotId: null, status: 'FAILED', error: input.error, attemptedAt: input.attemptedAt }).run();
  }

  find(idValue: string): EvidenceAggregate | null { return this.list().find((aggregate) => aggregate.plan.event.id === idValue) ?? null; }

  list(): readonly EvidenceAggregate[] {
    const references = this.db.select().from(evidenceReferences).orderBy(asc(evidenceReferences.createdAt), asc(evidenceReferences.id)).all();
    const snapshots = this.db.select().from(evidenceSnapshots).orderBy(asc(evidenceSnapshots.capturedAt), asc(evidenceSnapshots.id)).all();
    const attempts = this.db.select().from(evidenceCaptureAttempts).orderBy(asc(evidenceCaptureAttempts.attemptedAt), asc(evidenceCaptureAttempts.id)).all();
    return Object.freeze(this.db.select().from(evidenceEvents).orderBy(asc(evidenceEvents.occurredAt), asc(evidenceEvents.id)).all().map((row) => {
      const event = createEvidenceEvent({ id: row.id, sourceType: row.sourceType, sourceId: row.sourceId, eventType: row.eventType, status: row.status, occurredAt: row.occurredAt, summary: row.summary, decisionTraceId: row.decisionTraceId, strategyRuntimeId: row.strategyRuntimeId, runtimeNodeId: row.runtimeNodeId, timeframe: row.timeframe, capturePolicy: row.capturePolicy });
      const eventReferences: readonly EvidenceReference[] = Object.freeze(references.filter((item) => item.evidenceEventId === row.id).map((item) => createEvidenceReference({ id: item.id, evidenceEventId: item.evidenceEventId, entityType: item.entityType, entityId: item.entityId, entityVersionId: item.entityVersionId, relationType: item.relationType, createdAt: item.createdAt })));
      const eventSnapshots = Object.freeze(snapshots.filter((item) => item.evidenceEventId === row.id).map((item) => createEvidenceSnapshot({ id: item.id, evidenceEventId: item.evidenceEventId, chartWorkspaceState: JSON.parse(item.chartWorkspaceStateJson) as ChartWorkspaceEvidenceState, imagePath: item.imagePath, imageHash: item.imageHash, framingProfile: JSON.parse(item.framingProfileJson) as EvidenceFramingProfile, capturedAt: item.capturedAt, captureOrigin: item.captureOrigin })));
      const eventAttempts = Object.freeze(attempts.filter((item) => item.evidenceEventId === row.id).map((item): EvidenceCaptureAttempt => Object.freeze({ id: evidenceCaptureAttemptId(item.id), evidenceEventId: evidenceEventId(item.evidenceEventId), evidenceSnapshotId: item.evidenceSnapshotId === null ? null : evidenceSnapshotId(item.evidenceSnapshotId), status: item.status, error: item.error, attemptedAt: item.attemptedAt })));
      return Object.freeze({ plan: Object.freeze({ event, references: eventReferences, workspaceState: Object.freeze(JSON.parse(row.chartWorkspaceStateJson) as ChartWorkspaceEvidenceState), framingProfile: Object.freeze(JSON.parse(row.framingProfileJson) as EvidenceFramingProfile) }), snapshots: eventSnapshots, captureAttempts: eventAttempts });
    }));
  }

  createStageSummary(summary: EvidenceStageSummary): EvidenceStageSummary {
    this.db.transaction((tx) => {
      tx.insert(evidenceStageSummaries).values({ id: summary.id, strategyRuntimeId: summary.strategyRuntimeId, timeframe: summary.timeframe, title: summary.title, createdAt: summary.createdAt }).run();
      tx.insert(evidenceStageSummaryItems).values(summary.evidenceEventIds.map((id, ordinal) => ({ stageSummaryId: summary.id, evidenceEventId: id, ordinal }))).run();
    });
    return summary;
  }

  listStageSummaries(): readonly EvidenceStageSummary[] {
    const items = this.db.select().from(evidenceStageSummaryItems).orderBy(asc(evidenceStageSummaryItems.ordinal)).all();
    return Object.freeze(this.db.select().from(evidenceStageSummaries).orderBy(asc(evidenceStageSummaries.createdAt), asc(evidenceStageSummaries.id)).all().map((row) => createEvidenceStageSummary({ id: row.id, strategyRuntimeId: row.strategyRuntimeId, timeframe: row.timeframe, title: row.title, createdAt: row.createdAt, evidenceEventIds: items.filter((item) => item.stageSummaryId === row.id).map((item) => item.evidenceEventId) })));
  }
}

function txGuard(db: AriseDatabase, idValue: string): void {
  if (!db.select({ id: evidenceEvents.id }).from(evidenceEvents).where(eq(evidenceEvents.id, idValue)).limit(1).all()[0]) throw new PersistenceNotFoundError('EvidenceEvent', idValue);
}
