export type EvidenceEventId = string & { readonly __brand: 'EvidenceEventId' };
export type EvidenceSnapshotId = string & { readonly __brand: 'EvidenceSnapshotId' };
export type EvidenceReferenceId = string & { readonly __brand: 'EvidenceReferenceId' };
export type EvidenceCaptureAttemptId = string & { readonly __brand: 'EvidenceCaptureAttemptId' };
export type EvidenceStageSummaryId = string & { readonly __brand: 'EvidenceStageSummaryId' };

export type EvidenceSourceType = 'STRATEGY_RUNTIME' | 'TRADE' | 'POSITION' | 'REVIEW' | 'MANUAL';
export type EvidenceEventType =
  | 'REVIEW' | 'STRATEGY_TRIGGER' | 'STRATEGY_CONFIRMATION' | 'STRATEGY_FAILURE' | 'STRATEGY_EXPIRY'
  | 'CANDIDATE' | 'ENTRY' | 'SURVIVOR' | 'PROTECTED' | 'LEG' | 'MATURE_LEG'
  | 'TARGET_APPROACHING' | 'TARGET_HIT' | 'PARTIAL_EXIT' | 'EXIT' | 'CONSOLIDATION'
  | 'RUNNER_CONVERSION' | 'MANUAL';
export type EvidenceStatus = 'CONFIRMED' | 'MANUALLY_CONFIRMED' | 'FAILED' | 'EXPIRED' | 'BLOCKED' | 'ERROR';
export type EvidenceCapturePolicy = 'ENTRY_ONLY' | 'STRATEGY_EVIDENCE_AND_ENTRY' | 'STRATEGY_EVIDENCE_ONLY' | 'CUSTOM';
export type EvidenceCaptureOrigin = 'AUTOMATIC' | 'MANUAL' | 'REGENERATED_VIEW';
export type EvidenceAssetIntegrity = 'VERIFIED' | 'MISSING' | 'CORRUPT' | 'NOT_CAPTURED';

const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
function token<T extends string>(value: string, field: string): T {
  if (!tokenPattern.test(value)) throw new Error(`${field} must be an opaque token`);
  return value as T;
}
function iso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be a valid timestamp`);
  return new Date(value).toISOString();
}
function jsonCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export const evidenceEventId = (value: string) => token<EvidenceEventId>(value, 'evidenceEventId');
export const evidenceSnapshotId = (value: string) => token<EvidenceSnapshotId>(value, 'evidenceSnapshotId');
export const evidenceReferenceId = (value: string) => token<EvidenceReferenceId>(value, 'evidenceReferenceId');
export const evidenceCaptureAttemptId = (value: string) => token<EvidenceCaptureAttemptId>(value, 'evidenceCaptureAttemptId');
export const evidenceStageSummaryId = (value: string) => token<EvidenceStageSummaryId>(value, 'evidenceStageSummaryId');

export interface EvidenceEvent {
  readonly id: EvidenceEventId;
  readonly sourceType: EvidenceSourceType;
  readonly sourceId: string;
  readonly eventType: EvidenceEventType;
  readonly status: EvidenceStatus;
  readonly occurredAt: string;
  readonly summary: string;
  readonly decisionTraceId: string | null;
  readonly strategyRuntimeId: string | null;
  readonly runtimeNodeId: string | null;
  readonly timeframe: string | null;
  readonly capturePolicy: EvidenceCapturePolicy;
}

export interface EvidenceReference {
  readonly id: EvidenceReferenceId;
  readonly evidenceEventId: EvidenceEventId;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityVersionId: string | null;
  readonly relationType: string;
  readonly createdAt: string;
}

export interface EvidenceProjectionState {
  readonly projectionId: string;
  readonly sourceTimeframe: string;
  readonly targetTimeframe: string;
  readonly intervalStart: string;
  readonly intervalEnd: string;
  readonly sourceCandleId: string | null;
  readonly parentProjectionId: string | null;
}

export interface EvidenceCandleState {
  readonly id: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly openedAt: string;
  readonly closedAt: string | null;
}

export interface ChartWorkspaceEvidenceState {
  readonly schemaVersion: 1;
  readonly instrumentId: string;
  readonly timeframe: string | null;
  readonly visibleInterval: { readonly from: string; readonly to: string } | null;
  readonly candles: readonly EvidenceCandleState[];
  readonly marketObjectVersionIds: readonly string[];
  readonly projections: readonly EvidenceProjectionState[];
  readonly activeRuntimeNode: { readonly runtimeId: string; readonly runtimeNodeId: string; readonly graphNodeId: string; readonly state: string } | null;
  readonly colonyId: string | null;
  readonly ideaVersionId: string | null;
  readonly strategyMapVersionId: string | null;
  readonly annotations: readonly { readonly key: string; readonly label: string; readonly entityId: string | null }[];
  readonly eventContext: Readonly<Record<string, unknown>>;
}

export interface EvidenceFramingProfile {
  readonly barsBefore: number;
  readonly barsAfter: number;
  readonly verticalPaddingPercent: number;
  readonly showSourceMarketObjects: boolean;
  readonly showParentProjections: boolean;
  readonly showChildProjections: boolean;
  readonly showPositionOverlays: boolean;
  readonly showEconomicEvents: boolean;
  readonly annotationDensity: 'MINIMAL' | 'STANDARD' | 'DETAILED';
}

export const defaultEvidenceFramingProfile: EvidenceFramingProfile = Object.freeze({
  barsBefore: 30, barsAfter: 10, verticalPaddingPercent: 12, showSourceMarketObjects: true,
  showParentProjections: true, showChildProjections: true, showPositionOverlays: true,
  showEconomicEvents: true, annotationDensity: 'STANDARD',
});

export interface EvidenceSnapshot {
  readonly id: EvidenceSnapshotId;
  readonly evidenceEventId: EvidenceEventId;
  readonly chartWorkspaceState: ChartWorkspaceEvidenceState;
  readonly imagePath: string;
  readonly imageHash: string;
  readonly framingProfile: EvidenceFramingProfile;
  readonly capturedAt: string;
  readonly captureOrigin: EvidenceCaptureOrigin;
}

export interface EvidenceRecordPlan {
  readonly event: EvidenceEvent;
  readonly references: readonly EvidenceReference[];
  readonly workspaceState: ChartWorkspaceEvidenceState;
  readonly framingProfile: EvidenceFramingProfile;
}

export interface EvidenceStageSummary {
  readonly id: EvidenceStageSummaryId;
  readonly strategyRuntimeId: string;
  readonly timeframe: string;
  readonly title: string;
  readonly evidenceEventIds: readonly EvidenceEventId[];
  readonly createdAt: string;
}

export function createEvidenceEvent(input: Omit<EvidenceEvent, 'id' | 'occurredAt'> & { readonly id: string; readonly occurredAt: string }): EvidenceEvent {
  if (!input.sourceId.trim()) throw new Error('sourceId is required');
  if (!input.summary.trim()) throw new Error('summary is required');
  return Object.freeze({ ...input, id: evidenceEventId(input.id), occurredAt: iso(input.occurredAt, 'occurredAt') });
}

export function createEvidenceReference(input: Omit<EvidenceReference, 'id' | 'evidenceEventId' | 'createdAt'> & { readonly id: string; readonly evidenceEventId: string; readonly createdAt: string }): EvidenceReference {
  if (!input.entityType.trim() || !input.entityId.trim() || !input.relationType.trim()) throw new Error('Evidence reference identity and relation are required');
  return Object.freeze({ ...input, id: evidenceReferenceId(input.id), evidenceEventId: evidenceEventId(input.evidenceEventId), createdAt: iso(input.createdAt, 'createdAt') });
}

export function createEvidenceSnapshot(input: Omit<EvidenceSnapshot, 'id' | 'evidenceEventId' | 'capturedAt' | 'chartWorkspaceState' | 'framingProfile'> & { readonly id: string; readonly evidenceEventId: string; readonly capturedAt: string; readonly chartWorkspaceState: ChartWorkspaceEvidenceState; readonly framingProfile?: EvidenceFramingProfile }): EvidenceSnapshot {
  if (!/^[a-f0-9]{64}$/.test(input.imageHash)) throw new Error('imageHash must be a SHA-256 hex digest');
  if (!input.imagePath || input.imagePath.startsWith('/') || /^[A-Za-z]:/.test(input.imagePath) || input.imagePath.includes('..')) throw new Error('imagePath must be a portable relative path');
  return Object.freeze({ ...input, id: evidenceSnapshotId(input.id), evidenceEventId: evidenceEventId(input.evidenceEventId), chartWorkspaceState: Object.freeze(jsonCopy(input.chartWorkspaceState)), framingProfile: Object.freeze(jsonCopy(input.framingProfile ?? defaultEvidenceFramingProfile)), capturedAt: iso(input.capturedAt, 'capturedAt') });
}

export function createEvidenceStageSummary(input: Omit<EvidenceStageSummary, 'id' | 'createdAt' | 'evidenceEventIds'> & { readonly id: string; readonly createdAt: string; readonly evidenceEventIds: readonly string[] }): EvidenceStageSummary {
  if (!input.strategyRuntimeId.trim() || !input.timeframe.trim() || !input.title.trim()) throw new Error('Stage Summary scope is required');
  if (!input.evidenceEventIds.length) throw new Error('Stage Summary must retain at least one per-node EvidenceEvent');
  return Object.freeze({ ...input, id: evidenceStageSummaryId(input.id), createdAt: iso(input.createdAt, 'createdAt'), evidenceEventIds: Object.freeze(input.evidenceEventIds.map(evidenceEventId)) });
}
