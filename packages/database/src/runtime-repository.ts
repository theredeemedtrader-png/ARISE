import { and, asc, eq } from 'drizzle-orm';
import {
  decisionTraceId,
  detectorEvaluationId,
  runtimeEventId,
  runtimeNodeEventId,
  runtimeNodeId,
  strategyRuntimeId,
  type DecisionTrace,
  type DetectorEvaluation,
  type RuntimeActionProposal,
  type RuntimeMarketEvent,
  type RuntimeNode,
  type RuntimeNodeEvent,
  type RuntimeProcessResult,
  type RuntimeSnapshot,
  type StrategyRuntime,
} from '@arise/strategy-engine';
import type { AriseDatabase } from './database';
import type { EvidenceRecordPlan } from '@arise/evidence';
import { insertEvidencePlans } from './evidence-repository';
import { PersistenceConflictError, PersistenceNotFoundError } from './errors';
import {
  decisionTraces,
  detectorEvaluations,
  runtimeActionProposals,
  runtimeNodeEvents,
  runtimeNodes,
  runtimeProcessedEvents,
  strategyRuntimes,
} from './schema';

function hydrateRuntime(row: typeof strategyRuntimes.$inferSelect): StrategyRuntime {
  return Object.freeze({
    id: strategyRuntimeId(row.id), colonyId: row.colonyId, strategyMapVersionId: row.strategyMapVersionId,
    mode: row.mode, status: row.currentStatus, startedAt: row.startedAt, stoppedAt: row.stoppedAt,
  });
}
function hydrateNode(row: typeof runtimeNodes.$inferSelect): RuntimeNode {
  return Object.freeze({
    id: runtimeNodeId(row.id), strategyRuntimeId: strategyRuntimeId(row.strategyRuntimeId), graphNodeId: row.graphNodeId,
    state: row.state, armedAt: row.armedAt, triggeredAt: row.triggeredAt, confirmedAt: row.confirmedAt,
    lastEvaluatedCandleId: row.lastEvaluatedCandleId, triggerCount: row.triggerCount,
    runtimeMemory: Object.freeze(JSON.parse(row.runtimeMemoryJson) as Record<string, unknown>),
  });
}
function hydrateEvent(row: typeof runtimeNodeEvents.$inferSelect): RuntimeNodeEvent {
  return Object.freeze({ id: runtimeNodeEventId(row.id), strategyRuntimeId: strategyRuntimeId(row.strategyRuntimeId), runtimeNodeId: runtimeNodeId(row.runtimeNodeId), fromState: row.fromState as RuntimeNodeEvent['fromState'], toState: row.toState as RuntimeNodeEvent['toState'], eventType: row.eventType, sourceEventId: row.sourceEventId, summary: row.summary, occurredAt: row.occurredAt });
}
function hydrateEvaluation(row: typeof detectorEvaluations.$inferSelect): DetectorEvaluation {
  return Object.freeze({ id: detectorEvaluationId(row.id), runtimeNodeId: runtimeNodeId(row.runtimeNodeId), strategyVersionId: row.strategyVersionId, detectorKey: row.detectorKey, detectorVersion: row.detectorVersion, result: row.result, evaluatedAt: row.evaluatedAt, candleId: row.candleId, diagnostics: Object.freeze(JSON.parse(row.diagnosticsJson) as Record<string, unknown>) });
}
function hydrateTrace(row: typeof decisionTraces.$inferSelect): DecisionTrace {
  return Object.freeze({ id: decisionTraceId(row.id), strategyRuntimeId: strategyRuntimeId(row.strategyRuntimeId), eventType: row.eventType, runtimeNodeId: row.runtimeNodeId === null ? null : runtimeNodeId(row.runtimeNodeId), summary: row.summary, details: Object.freeze(JSON.parse(row.detailsJson) as Record<string, unknown>), occurredAt: row.occurredAt });
}

export class RuntimeRepository {
  constructor(private readonly db: AriseDatabase) {}

  create(snapshot: RuntimeSnapshot): RuntimeSnapshot {
    this.db.transaction((tx) => {
      tx.insert(strategyRuntimes).values({
        id: snapshot.runtime.id, colonyId: snapshot.runtime.colonyId, strategyMapVersionId: snapshot.runtime.strategyMapVersionId,
        mode: snapshot.runtime.mode, currentStatus: snapshot.runtime.status, startedAt: snapshot.runtime.startedAt, stoppedAt: snapshot.runtime.stoppedAt,
      }).run();
      if (snapshot.nodes.length) tx.insert(runtimeNodes).values(snapshot.nodes.map((node) => ({
        id: node.id, strategyRuntimeId: node.strategyRuntimeId, graphNodeId: node.graphNodeId, state: node.state,
        armedAt: node.armedAt, triggeredAt: node.triggeredAt, confirmedAt: node.confirmedAt, lastEvaluatedCandleId: node.lastEvaluatedCandleId,
        triggerCount: node.triggerCount, runtimeMemoryJson: JSON.stringify(node.runtimeMemory),
      }))).run();
    });
    return this.reconstruct(snapshot.runtime.id)!;
  }

  reconstruct(id: ReturnType<typeof strategyRuntimeId>): RuntimeSnapshot | null {
    const row = this.db.select().from(strategyRuntimes).where(eq(strategyRuntimes.id, id)).limit(1).all()[0];
    if (!row) return null;
    const nodes = this.db.select().from(runtimeNodes).where(eq(runtimeNodes.strategyRuntimeId, id)).orderBy(asc(runtimeNodes.graphNodeId)).all().map(hydrateNode);
    return Object.freeze({ runtime: hydrateRuntime(row), nodes: Object.freeze(nodes) });
  }

  list(): readonly RuntimeSnapshot[] {
    return Object.freeze(this.db.select().from(strategyRuntimes).orderBy(asc(strategyRuntimes.startedAt), asc(strategyRuntimes.id)).all().map((row) => this.reconstruct(strategyRuntimeId(row.id))!));
  }

  eventProcessed(runtimeIdValue: ReturnType<typeof strategyRuntimeId>, eventIdValue: ReturnType<typeof runtimeEventId>): boolean {
    return this.db.select().from(runtimeProcessedEvents).where(and(eq(runtimeProcessedEvents.strategyRuntimeId, runtimeIdValue), eq(runtimeProcessedEvents.eventId, eventIdValue))).limit(1).all().length > 0;
  }

  private persistResult(result: RuntimeProcessResult, event: RuntimeMarketEvent | null, evidence: readonly EvidenceRecordPlan[]): RuntimeSnapshot {
    if (result.duplicate) return result.snapshot;
    const runtimeIdValue = result.snapshot.runtime.id;
    this.db.transaction((tx) => {
      if (event) {
        const already = tx.select().from(runtimeProcessedEvents).where(and(eq(runtimeProcessedEvents.strategyRuntimeId, runtimeIdValue), eq(runtimeProcessedEvents.eventId, event.id))).limit(1).all()[0];
        if (already) throw new PersistenceConflictError(`Runtime event ${event.id} already processed`);
      }
      const updated = tx.update(strategyRuntimes).set({ currentStatus: result.snapshot.runtime.status, stoppedAt: result.snapshot.runtime.stoppedAt }).where(eq(strategyRuntimes.id, runtimeIdValue)).run();
      if (updated.changes !== 1) throw new PersistenceNotFoundError('StrategyRuntime', runtimeIdValue);
      for (const node of result.snapshot.nodes) {
        const changed = tx.update(runtimeNodes).set({ state: node.state, armedAt: node.armedAt, triggeredAt: node.triggeredAt, confirmedAt: node.confirmedAt, lastEvaluatedCandleId: node.lastEvaluatedCandleId, triggerCount: node.triggerCount, runtimeMemoryJson: JSON.stringify(node.runtimeMemory) }).where(and(eq(runtimeNodes.strategyRuntimeId, runtimeIdValue), eq(runtimeNodes.id, node.id))).run();
        if (changed.changes !== 1) throw new PersistenceConflictError(`RuntimeNode ${node.id} missing during commit`);
      }
      if (result.nodeEvents.length) tx.insert(runtimeNodeEvents).values(result.nodeEvents.map((item) => ({ id: item.id, strategyRuntimeId: item.strategyRuntimeId, runtimeNodeId: item.runtimeNodeId, fromState: item.fromState, toState: item.toState, eventType: item.eventType, sourceEventId: item.sourceEventId, summary: item.summary, occurredAt: item.occurredAt }))).run();
      if (result.evaluations.length) tx.insert(detectorEvaluations).values(result.evaluations.map((item) => ({ id: item.id, runtimeNodeId: item.runtimeNodeId, strategyVersionId: item.strategyVersionId, detectorKey: item.detectorKey, detectorVersion: item.detectorVersion, result: item.result, evaluatedAt: item.evaluatedAt, candleId: item.candleId, diagnosticsJson: JSON.stringify(item.diagnostics) }))).run();
      if (result.traces.length) tx.insert(decisionTraces).values(result.traces.map((item) => ({ id: item.id, strategyRuntimeId: item.strategyRuntimeId, eventType: item.eventType, runtimeNodeId: item.runtimeNodeId, summary: item.summary, detailsJson: JSON.stringify(item.details), occurredAt: item.occurredAt }))).run();
      insertEvidencePlans(tx, evidence);
      if (result.actionProposals.length) {
        if (!event) throw new PersistenceConflictError('Manual runtime decisions cannot persist action proposals without a source event');
        tx.insert(runtimeActionProposals).values(result.actionProposals.map((item) => ({ correlationId: item.correlationId, strategyRuntimeId: runtimeIdValue, runtimeNodeId: item.runtimeNodeId, graphNodeId: item.graphNodeId, actionKind: item.actionKind, parametersJson: JSON.stringify(item.parameters), sourceEventId: event.id, createdAt: event.occurredAt }))).run();
      }
      if (event) tx.insert(runtimeProcessedEvents).values({ strategyRuntimeId: runtimeIdValue, eventId: event.id, eventType: event.type, occurredAt: event.occurredAt }).run();
    });
    return this.reconstruct(runtimeIdValue)!;
  }

  commit(event: RuntimeMarketEvent, result: RuntimeProcessResult, evidence: readonly EvidenceRecordPlan[] = []): RuntimeSnapshot {
    return this.persistResult(result, event, evidence);
  }

  commitManualDecision(result: RuntimeProcessResult, evidence: readonly EvidenceRecordPlan[] = []): RuntimeSnapshot {
    return this.persistResult(result, null, evidence);
  }

  events(id: ReturnType<typeof strategyRuntimeId>): readonly RuntimeNodeEvent[] {
    return Object.freeze(this.db.select().from(runtimeNodeEvents).where(eq(runtimeNodeEvents.strategyRuntimeId, id)).orderBy(asc(runtimeNodeEvents.occurredAt), asc(runtimeNodeEvents.id)).all().map(hydrateEvent));
  }
  evaluations(id: ReturnType<typeof strategyRuntimeId>): readonly DetectorEvaluation[] {
    const nodeIds = new Set(this.reconstruct(id)?.nodes.map((node) => node.id) ?? []);
    return Object.freeze(this.db.select().from(detectorEvaluations).orderBy(asc(detectorEvaluations.evaluatedAt), asc(detectorEvaluations.id)).all().filter((row) => nodeIds.has(runtimeNodeId(row.runtimeNodeId))).map(hydrateEvaluation));
  }
  traces(id: ReturnType<typeof strategyRuntimeId>): readonly DecisionTrace[] {
    return Object.freeze(this.db.select().from(decisionTraces).where(eq(decisionTraces.strategyRuntimeId, id)).orderBy(asc(decisionTraces.occurredAt), asc(decisionTraces.id)).all().map(hydrateTrace));
  }
  proposals(id: ReturnType<typeof strategyRuntimeId>): readonly RuntimeActionProposal[] {
    return Object.freeze(this.db.select().from(runtimeActionProposals).where(eq(runtimeActionProposals.strategyRuntimeId, id)).orderBy(asc(runtimeActionProposals.createdAt), asc(runtimeActionProposals.correlationId)).all().map((row) => Object.freeze({ actionKind: row.actionKind as RuntimeActionProposal['actionKind'], runtimeNodeId: runtimeNodeId(row.runtimeNodeId), graphNodeId: row.graphNodeId, parameters: Object.freeze(JSON.parse(row.parametersJson) as Record<string, unknown>), correlationId: row.correlationId })));
  }
}
