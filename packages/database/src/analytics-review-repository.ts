/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite JSON/version snapshots are decoded at this infrastructure boundary. */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  aggregateMetrics,
  analyzeColony,
  analyzePosition,
  buildPerformanceCurve,
  buildEquityCurve,
  groupPerformance,
  type AnalyticsDimension,
  type AnalyticsFill,
  type PositionAnalyticsInput,
} from '@arise/analytics';

export type LessonStatus = 'OBSERVATION' | 'REPEATED_PATTERN' | 'PLAYBOOK_RULE' | 'MASTERED' | 'ARCHIVED';
export interface ReviewDissection {
  readonly thesis: string;
  readonly decision: string;
  readonly management: string;
  readonly outcome: string;
  readonly lesson: string;
}
export interface PositionPerformanceFact {
  readonly id: string;
  readonly positionId: string;
  readonly eventType: 'EXIT_FILL' | 'MARK';
  readonly quantity: number | null;
  readonly price: number;
  readonly money: number | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly occurredAt: string;
}

const dimensions: readonly AnalyticsDimension[] = ['TIMEFRAME','STRATEGY','COMBO','TEMPLATE','ENTRY_HOUR','WEEKDAY','SESSION','TAG','DIRECTION','QUALIFICATION'];
const lessonTransitions: Readonly<Record<LessonStatus, readonly LessonStatus[]>> = Object.freeze({
  OBSERVATION: ['REPEATED_PATTERN','ARCHIVED'],
  REPEATED_PATTERN: ['PLAYBOOK_RULE','ARCHIVED'],
  PLAYBOOK_RULE: ['MASTERED','ARCHIVED'],
  MASTERED: ['ARCHIVED'],
  ARCHIVED: [],
});

function requireText(value: string, name: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}
function requireIso(value: string): void { if (!Number.isFinite(Date.parse(value))) throw new Error('occurredAt must be an ISO timestamp'); }
function freeze<T>(value: T): Readonly<T> { return Object.freeze(value); }

export class AnalyticsReviewRepository {
  constructor(private readonly sqlite: Database.Database) {}

  recordPerformanceFact(input: PositionPerformanceFact): void {
    requireIso(input.occurredAt);
    if (!Number.isFinite(input.price) || input.price <= 0) throw new Error('Performance price must be positive and finite');
    if (input.eventType === 'EXIT_FILL' && (!input.quantity || !Number.isFinite(input.quantity) || input.quantity <= 0)) throw new Error('Exit fill requires positive quantity');
    if (input.eventType === 'MARK' && input.quantity !== null) throw new Error('Mark quantity must be null');
    if (input.money !== null && !Number.isFinite(input.money)) throw new Error('Performance money must be finite when supplied');
    if (!this.sqlite.prepare('SELECT 1 FROM positions WHERE id=?').get(input.positionId)) throw new Error(`Position ${input.positionId} not found`);
    this.sqlite.prepare('INSERT INTO position_performance_events VALUES (?,?,?,?,?,?,?,?,?)').run(
      input.id, input.positionId, input.eventType, input.quantity, input.price, input.money,
      requireText(input.sourceType, 'sourceType'), requireText(input.sourceId, 'sourceId'), input.occurredAt,
    );
  }

  analyticsWorkspace(asOf = new Date().toISOString()): Readonly<Record<string, unknown>> {
    const positions = this.positionInputs().map((input) => analyzePosition(input, asOf));
    const colonies = (this.sqlite.prepare(`SELECT c.id,c.label,i.canonical_symbol symbol,c.original_idea_version_id idea_version_id
      FROM colonies c JOIN instruments i ON i.id=c.instrument_id ORDER BY c.created_at,c.id`).all() as any[]).map((row) => {
      const attempts = (this.sqlite.prepare('SELECT id,result,pip_cost FROM attempts WHERE colony_id=? ORDER BY sequence_no').all(row.id) as any[])
        .map((attempt) => freeze({ attemptId: attempt.id as string, result: attempt.result, pipCost: attempt.pip_cost as number|null }));
      const attributed = positions.filter((position) => position.currentColonyId === row.id);
      const lineageColonyIds=this.lineageIds(row.id);
      const lineageAttempts=(this.sqlite.prepare('SELECT id,colony_id,result,pip_cost FROM attempts ORDER BY started_at,id').all() as any[]).filter((attempt)=>lineageColonyIds.includes(attempt.colony_id)).map((attempt)=>freeze({attemptId:attempt.id as string,result:attempt.result,pipCost:attempt.pip_cost as number|null}));
      const lineagePositions=positions.filter((position)=>lineageColonyIds.includes(position.currentColonyId));
      return freeze({ colonyId: row.id, label: row.label, symbol: row.symbol, ideaVersionId: row.idea_version_id, analytics: analyzeColony({ colonyId: row.id, attempts, positions: attributed }), lineageColonyIds:freeze(lineageColonyIds), lineageAnalytics:analyzeColony({colonyId:row.id,attempts:lineageAttempts,positions:lineagePositions}) });
    });
    const allAttempts = (this.sqlite.prepare('SELECT id,result,pip_cost FROM attempts ORDER BY started_at,id').all() as any[])
      .map((attempt) => freeze({ attemptId: attempt.id as string, result: attempt.result, pipCost: attempt.pip_cost as number|null }));
    const overall = analyzeColony({ colonyId: 'ALL', attempts: allAttempts, positions });
    const money = freeze({
      realized: aggregateMetrics(positions.map((position) => position.realizedMoney)),
      open: aggregateMetrics(positions.map((position) => position.openMoney)),
      total: aggregateMetrics(positions.map((position) => position.totalMoney)),
    });
    const groups = Object.fromEntries(dimensions.map((dimension) => [dimension, groupPerformance(positions, dimension)]));
    const inputs=this.positionInputs();
    return freeze({ asOf, overall, money, positions: freeze(positions), colonies: freeze(colonies), groups: freeze(groups), curve: buildPerformanceCurve(inputs), curves:freeze({balance:buildPerformanceCurve(inputs),equity:buildEquityCurve(inputs)}) });
  }

  createReview(input: {
    readonly id: string; readonly dissectionVersionId: string; readonly sourceType: 'TRADE'|'COLONY'; readonly sourceId: string;
    readonly title: string; readonly dissection: ReviewDissection; readonly evidenceEventIds: readonly string[]; readonly createdAt: string;
  }): Readonly<Record<string, unknown>> {
    requireIso(input.createdAt);
    const context = this.sourceContext(input.sourceType, input.sourceId);
    const evidenceIds = [...new Set(input.evidenceEventIds)];
    for (const evidenceId of evidenceIds) if (!this.sqlite.prepare('SELECT 1 FROM evidence_events WHERE id=?').get(evidenceId)) throw new Error(`EvidenceEvent ${evidenceId} not found`);
    const sourceAnalytics = input.sourceType === 'TRADE'
      ? this.positionInputs().filter((position) => position.tradeId === input.sourceId).map((position) => analyzePosition(position, input.createdAt))
      : (this.analyticsWorkspace(input.createdAt).colonies as any[]).find((colony) => colony.colonyId === input.sourceId)?.lineageAnalytics ?? null;
    const snapshot = freeze({ narrative: this.validateDissection(input.dissection), analytics: sourceAnalytics });
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO performance_reviews VALUES (?,?,?,?,?,?,?,?)').run(
        input.id, input.sourceType, input.sourceId, requireText(input.title, 'title'), context.ideaVersionId,
        context.strategyMapVersionId, input.dissectionVersionId, input.createdAt,
      );
      this.sqlite.prepare('INSERT INTO review_dissection_versions VALUES (?,?,?,?,?,?)').run(
        input.dissectionVersionId, input.id, 1, JSON.stringify(snapshot), input.createdAt, null,
      );
      for (const evidenceEventId of evidenceIds) this.sqlite.prepare('INSERT INTO review_evidence_links VALUES (?,?,?,?,?)').run(
        randomUUID(), input.id, evidenceEventId, 'SUPPORTS_DISSECTION', input.createdAt,
      );
    })();
    return this.review(input.id)!;
  }

  reviseReview(input: { readonly reviewId: string; readonly versionId: string; readonly dissection: ReviewDissection; readonly createdAt: string }): Readonly<Record<string, unknown>> {
    requireIso(input.createdAt);
    const review = this.sqlite.prepare('SELECT current_dissection_version_id FROM performance_reviews WHERE id=?').get(input.reviewId) as any;
    if (!review) throw new Error(`PerformanceReview ${input.reviewId} not found`);
    const head = this.sqlite.prepare('SELECT version_no,dissection_json FROM review_dissection_versions WHERE id=?').get(review.current_dissection_version_id) as any;
    const prior = JSON.parse(head.dissection_json) as any;
    const snapshot = freeze({ narrative: this.validateDissection(input.dissection), analytics: prior.analytics });
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO review_dissection_versions VALUES (?,?,?,?,?,?)').run(input.versionId, input.reviewId, head.version_no + 1, JSON.stringify(snapshot), input.createdAt, review.current_dissection_version_id);
      this.sqlite.prepare('UPDATE performance_reviews SET current_dissection_version_id=? WHERE id=? AND current_dissection_version_id=?').run(input.versionId, input.reviewId, review.current_dissection_version_id);
    })();
    return this.review(input.reviewId)!;
  }

  createLesson(input: { readonly id: string; readonly versionId: string; readonly reviewId: string; readonly statement: string; readonly evidenceEventIds?: readonly string[]; readonly createdAt: string }): Readonly<Record<string, unknown>> {
    requireIso(input.createdAt);
    if (!this.sqlite.prepare('SELECT 1 FROM performance_reviews WHERE id=?').get(input.reviewId)) throw new Error(`PerformanceReview ${input.reviewId} not found`);
    const evidenceIds = [...new Set(input.evidenceEventIds ?? (this.sqlite.prepare('SELECT evidence_event_id id FROM review_evidence_links WHERE review_id=?').all(input.reviewId) as any[]).map((row) => row.id as string))];
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO lessons VALUES (?,?,?)').run(input.id, input.versionId, input.createdAt);
      this.sqlite.prepare('INSERT INTO lesson_versions VALUES (?,?,?,?,?,?,?)').run(input.versionId, input.id, 1, 'OBSERVATION', requireText(input.statement, 'statement'), input.createdAt, null);
      this.sqlite.prepare('INSERT INTO review_lesson_links VALUES (?,?,?,?)').run(randomUUID(), input.reviewId, input.id, input.createdAt);
      for (const evidenceEventId of evidenceIds) this.sqlite.prepare('INSERT INTO lesson_evidence VALUES (?,?,?,?,?)').run(randomUUID(), input.versionId, evidenceEventId, 'SUPPORTS', input.createdAt);
    })();
    return this.lesson(input.id)!;
  }

  advanceLesson(input: { readonly lessonId: string; readonly versionId: string; readonly status: LessonStatus; readonly statement?: string; readonly createdAt: string }): Readonly<Record<string, unknown>> {
    requireIso(input.createdAt);
    const lesson = this.sqlite.prepare('SELECT current_version_id FROM lessons WHERE id=?').get(input.lessonId) as any;
    if (!lesson) throw new Error(`Lesson ${input.lessonId} not found`);
    const current = this.sqlite.prepare('SELECT * FROM lesson_versions WHERE id=?').get(lesson.current_version_id) as any;
    if (!lessonTransitions[current.status as LessonStatus].includes(input.status)) throw new Error(`Lesson cannot transition ${current.status} -> ${input.status}`);
    const evidence = this.sqlite.prepare('SELECT evidence_event_id,relation_type FROM lesson_evidence WHERE lesson_version_id=?').all(current.id) as any[];
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO lesson_versions VALUES (?,?,?,?,?,?,?)').run(input.versionId, input.lessonId, current.version_no + 1, input.status, requireText(input.statement ?? current.statement, 'statement'), input.createdAt, current.id);
      this.sqlite.prepare('UPDATE lessons SET current_version_id=? WHERE id=? AND current_version_id=?').run(input.versionId, input.lessonId, current.id);
      for (const item of evidence) this.sqlite.prepare('INSERT INTO lesson_evidence VALUES (?,?,?,?,?)').run(randomUUID(), input.versionId, item.evidence_event_id, item.relation_type, input.createdAt);
    })();
    return this.lesson(input.lessonId)!;
  }

  proposePlaybookUpdate(input: { readonly id: string; readonly lessonId: string; readonly strategyVersionId: string; readonly proposedChange: string; readonly expectedEffect: string; readonly testRequirements: string; readonly createdAt: string }): Readonly<Record<string, unknown>> {
    requireIso(input.createdAt);
    const lesson = this.lesson(input.lessonId);
    if (!lesson || (lesson.currentVersion as any).status !== 'PLAYBOOK_RULE') throw new Error('A Playbook update requires a PLAYBOOK_RULE Lesson');
    if (!this.sqlite.prepare('SELECT 1 FROM strategy_versions WHERE id=?').get(input.strategyVersionId)) throw new Error(`StrategyVersion ${input.strategyVersionId} not found`);
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO strategy_change_proposals VALUES (?,?,?,?,?,?,?,?,?,?)').run(
        input.id, (lesson.currentVersion as any).id, input.strategyVersionId, requireText(input.proposedChange, 'proposedChange'),
        requireText(input.expectedEffect, 'expectedEffect'), requireText(input.testRequirements, 'testRequirements'), 'PROPOSED', null, input.createdAt, null,
      );
      this.sqlite.prepare('INSERT INTO strategy_change_proposal_events VALUES (?,?,?,?,?,?)').run(randomUUID(), input.id, null, 'PROPOSED', 'Lesson proposed a versioned playbook update', input.createdAt);
    })();
    return this.proposal(input.id)!;
  }

  acceptPlaybookUpdate(input: { readonly proposalId: string; readonly resultingStrategyVersionId: string; readonly occurredAt: string }): Readonly<Record<string, unknown>> {
    requireIso(input.occurredAt);
    const proposal = this.sqlite.prepare('SELECT * FROM strategy_change_proposals WHERE id=?').get(input.proposalId) as any;
    if (!proposal || proposal.status !== 'PROPOSED') throw new Error('Only a current proposed playbook update can be accepted');
    const source = this.sqlite.prepare('SELECT * FROM strategy_versions WHERE id=?').get(proposal.source_strategy_version_id) as any;
    const definition = source ? this.sqlite.prepare('SELECT current_version_id FROM strategy_definitions WHERE id=?').get(source.strategy_definition_id) as any : null;
    if (!source || definition?.current_version_id !== source.id) throw new Error('Playbook proposal is stale; source StrategyVersion is no longer current');
    const description = `${source.description}\n\nPlaybook update: ${proposal.proposed_change}`;
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO strategy_versions
        (id,strategy_definition_id,version_no,name,category,description,tags_json,automation_capability,detector_json,deployment_status,created_at,supersedes_strategy_version_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.resultingStrategyVersionId, source.strategy_definition_id, source.version_no + 1, source.name, source.category,
        description, source.tags_json, source.automation_capability, source.detector_json, 'EXPERIMENTAL', input.occurredAt, source.id,
      );
      this.sqlite.prepare('UPDATE strategy_definitions SET current_version_id=? WHERE id=? AND current_version_id=?').run(input.resultingStrategyVersionId, source.strategy_definition_id, source.id);
      this.sqlite.prepare("UPDATE strategy_change_proposals SET status='ACCEPTED',resulting_strategy_version_id=?,resolved_at=? WHERE id=? AND status='PROPOSED'").run(input.resultingStrategyVersionId, input.occurredAt, input.proposalId);
      this.sqlite.prepare('INSERT INTO strategy_change_proposal_events VALUES (?,?,?,?,?,?)').run(randomUUID(), input.proposalId, 'PROPOSED', 'ACCEPTED', 'Accepted as a new EXPERIMENTAL StrategyVersion; prior version preserved', input.occurredAt);
    })();
    return this.proposal(input.proposalId)!;
  }

  review(id: string): Readonly<Record<string, unknown>> | null {
    const row = this.sqlite.prepare('SELECT * FROM performance_reviews WHERE id=?').get(id) as any;
    if (!row) return null;
    const versions = this.sqlite.prepare('SELECT * FROM review_dissection_versions WHERE review_id=? ORDER BY version_no').all(id) as any[];
    const evidence = this.evidenceFor((this.sqlite.prepare('SELECT evidence_event_id id FROM review_evidence_links WHERE review_id=? ORDER BY created_at,id').all(id) as any[]).map((item) => item.id as string));
    const current = versions.find((version) => version.id === row.current_dissection_version_id);
    const idea = this.sqlite.prepare('SELECT id,version_no,direction,thesis_text,target_description,invalidation_description,created_at FROM idea_versions WHERE id=?').get(row.idea_version_id);
    const map = row.strategy_map_version_id ? this.sqlite.prepare(`SELECT mv.id,mv.version_no,m.name,m.kind,mv.created_at FROM strategy_map_versions mv JOIN strategy_maps m ON m.id=mv.strategy_map_id WHERE mv.id=?`).get(row.strategy_map_version_id) : null;
    return freeze({ id: row.id, sourceType: row.source_type, sourceId: row.source_id, title: row.title, ideaVersion: idea, strategyMapVersion: map,
      currentDissection: current ? freeze({ id: current.id, versionNo: current.version_no, ...JSON.parse(current.dissection_json), createdAt: current.created_at }) : null,
      dissectionVersions: freeze(versions.map((version) => freeze({ id: version.id, versionNo: version.version_no, ...JSON.parse(version.dissection_json), createdAt: version.created_at }))),
      evidence, createdAt: row.created_at });
  }

  lesson(id: string): Readonly<Record<string, unknown>> | null {
    const row = this.sqlite.prepare('SELECT * FROM lessons WHERE id=?').get(id) as any;
    if (!row) return null;
    const versions = this.sqlite.prepare('SELECT * FROM lesson_versions WHERE lesson_id=? ORDER BY version_no').all(id) as any[];
    const current = versions.find((version) => version.id === row.current_version_id);
    const evidenceIds = current ? (this.sqlite.prepare('SELECT evidence_event_id id FROM lesson_evidence WHERE lesson_version_id=?').all(current.id) as any[]).map((item) => item.id as string) : [];
    return freeze({ id: row.id, currentVersion: this.lessonVersion(current), versions: freeze(versions.map((version) => this.lessonVersion(version))), evidence: this.evidenceFor(evidenceIds), createdAt: row.created_at });
  }

  proposal(id: string): Readonly<Record<string, unknown>> | null {
    const row = this.sqlite.prepare('SELECT * FROM strategy_change_proposals WHERE id=?').get(id) as any;
    return row ? freeze({ id: row.id, lessonVersionId: row.lesson_version_id, sourceStrategyVersionId: row.source_strategy_version_id,
      proposedChange: row.proposed_change, expectedEffect: row.expected_effect, testRequirements: row.test_requirements,
      status: row.status, resultingStrategyVersionId: row.resulting_strategy_version_id, createdAt: row.created_at, resolvedAt: row.resolved_at }) : null;
  }

  reviewWorkspace(): Readonly<Record<string, unknown>> {
    const reviews = (this.sqlite.prepare('SELECT id FROM performance_reviews ORDER BY created_at,id').all() as any[]).map((row) => this.review(row.id));
    const lessons = (this.sqlite.prepare('SELECT id FROM lessons ORDER BY created_at,id').all() as any[]).map((row) => this.lesson(row.id));
    const proposals = (this.sqlite.prepare('SELECT id FROM strategy_change_proposals ORDER BY created_at,id').all() as any[]).map((row) => this.proposal(row.id));
    return freeze({ reviews: freeze(reviews), lessons: freeze(lessons), proposals: freeze(proposals) });
  }

  private positionInputs(): PositionAnalyticsInput[] {
    const rows = this.sqlite.prepare(`SELECT p.*,t.idea_version_id,t.strategy_map_version_id,t.source_type,a.strategy_runtime_id,c.instrument_id,i.pip_size,
      tf.code thesis_timeframe FROM positions p JOIN trades t ON t.id=p.trade_id JOIN colonies c ON c.id=p.original_colony_id
      LEFT JOIN attempts a ON a.id=t.attempt_id JOIN instruments i ON i.id=c.instrument_id JOIN ideas idea ON idea.id=c.idea_id JOIN timeframes tf ON tf.id=idea.thesis_timeframe_id
      ORDER BY p.opened_at,p.id`).all() as any[];
    return rows.map((row): PositionAnalyticsInput => {
      const entryRows = this.sqlite.prepare(`SELECT f.event_id id,f.volume quantity,f.price,f.filled_at occurred_at
        FROM execution_position_links link JOIN execution_fills f ON f.order_plan_id=link.order_plan_id WHERE link.position_id=? ORDER BY f.filled_at,f.event_id`).all(row.id) as any[];
      const entries: AnalyticsFill[] = (entryRows.length ? entryRows : [{ id: `position:${row.id}:entry`, quantity: row.original_size, price: row.entry_price, occurred_at: row.opened_at }])
        .map((fill) => freeze({ id: fill.id, quantity: fill.quantity, price: fill.price, occurredAt: fill.occurred_at, money: null }));
      const events = this.sqlite.prepare('SELECT * FROM position_performance_events WHERE position_id=? ORDER BY occurred_at,id').all(row.id) as any[];
      const exits: AnalyticsFill[] = events.filter((event) => event.event_type === 'EXIT_FILL').map((event) => freeze({ id: event.id, quantity: event.quantity, price: event.price, occurredAt: event.occurred_at, money: event.money }));
      const markRow = [...events].reverse().find((event) => event.event_type === 'MARK');
      const markRows = events.filter((event) => event.event_type === 'MARK');
      const protection = this.sqlite.prepare('SELECT verified_stop,protected_volume,updated_at FROM position_protection_current WHERE position_id=?').get(row.id) as any;
      const lifecycle = (this.sqlite.prepare('SELECT to_state,occurred_at FROM position_state_events WHERE position_id=? ORDER BY occurred_at,id').all(row.id) as any[]).map((event) => freeze({ state: event.to_state as string, occurredAt: event.occurred_at as string }));
      const exact = this.exactStrategyDimensions(row.strategy_map_version_id);
      return freeze({ positionId: row.id, tradeId: row.trade_id, originalColonyId: row.original_colony_id, currentColonyId: row.current_colony_id,
        direction: row.direction, pipSize: row.pip_size, entryFills: freeze(entries), exitFills: freeze(exits), currentQuantity: row.current_size,
        mark: markRow ? freeze({ price: markRow.price, occurredAt: markRow.occurred_at, money: markRow.money }) : null,
        marks:freeze(markRows.map((mark)=>freeze({price:mark.price,occurredAt:mark.occurred_at,money:mark.money}))),
        protection: protection ? freeze({ verifiedStop: protection.verified_stop, protectedQuantity: protection.protected_volume, occurredAt: protection.updated_at }) : null,
        lifecycle: freeze(lifecycle), currentState: row.current_state, openedAt: row.opened_at, closedAt: row.closed_at,
        dimensions: freeze({ timeframes: freeze([...new Set([row.thesis_timeframe, ...exact.timeframes])]), strategies: freeze(exact.strategies), combos: freeze(exact.combos), templates: freeze(exact.templates), tags: freeze(exact.tags), session: null,
          qualification: row.source_type === 'ARISE_AUTO' ? 'AUTOMATICALLY_QUALIFIED' : row.strategy_runtime_id && this.sqlite.prepare("SELECT 1 FROM runtime_node_events WHERE strategy_runtime_id=? AND event_type='MANUAL_CONFIRM' AND occurred_at<=? LIMIT 1").get(row.strategy_runtime_id,row.opened_at) ? 'HUMAN_APPROVED' : null }),
        ideaVersionId: row.idea_version_id, strategyMapVersionId: row.strategy_map_version_id });
    });
  }

  private exactStrategyDimensions(mapVersionId: string | null): { timeframes: string[]; strategies: string[]; combos: string[]; templates: string[]; tags: string[] } {
    if (!mapVersionId) return { timeframes: [], strategies: [], combos: [], templates: [], tags: [] };
    const row = this.sqlite.prepare(`SELECT mv.graph_json,mv.version_no,m.name,m.kind FROM strategy_map_versions mv JOIN strategy_maps m ON m.id=mv.strategy_map_id WHERE mv.id=?`).get(mapVersionId) as any;
    if (!row) return { timeframes: [], strategies: [], combos: [], templates: [], tags: [] };
    const graph = JSON.parse(row.graph_json) as any;
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const refs = [...new Set(nodes.map((node: any) => node.strategyVersionId).filter(Boolean))] as string[];
    const versions = refs.map((id) => this.sqlite.prepare('SELECT name,version_no,tags_json FROM strategy_versions WHERE id=?').get(id) as any).filter(Boolean);
    const label = `${row.name} v${row.version_no}`;
    return {
      timeframes: [...new Set(nodes.filter((node: any) => Array.isArray(node.purposes) && node.purposes.includes('ENTRY')).map((node: any) => node.timeframe).filter(Boolean))] as string[],
      strategies: versions.map((version) => `${version.name} v${version.version_no}`),
      combos: row.kind === 'COMBO' ? [label] : [], templates: row.kind === 'TEMPLATE' ? [label] : [],
      tags: [...new Set(versions.flatMap((version) => JSON.parse(version.tags_json) as string[]))],
    };
  }

  private sourceContext(sourceType: 'TRADE'|'COLONY', sourceId: string): { ideaVersionId: string; strategyMapVersionId: string|null } {
    if (sourceType === 'TRADE') {
      const row = this.sqlite.prepare('SELECT idea_version_id,strategy_map_version_id FROM trades WHERE id=?').get(sourceId) as any;
      if (!row) throw new Error(`Trade ${sourceId} not found`);
      return { ideaVersionId: row.idea_version_id, strategyMapVersionId: row.strategy_map_version_id };
    }
    const row = this.sqlite.prepare('SELECT original_idea_version_id FROM colonies WHERE id=?').get(sourceId) as any;
    if (!row) throw new Error(`Colony ${sourceId} not found`);
    return { ideaVersionId: row.original_idea_version_id, strategyMapVersionId: null };
  }

  private validateDissection(input: ReviewDissection): ReviewDissection {
    return freeze({ thesis: requireText(input.thesis, 'thesis'), decision: requireText(input.decision, 'decision'), management: requireText(input.management, 'management'), outcome: requireText(input.outcome, 'outcome'), lesson: requireText(input.lesson, 'lesson') });
  }

  private evidenceFor(ids: readonly string[]): readonly Readonly<Record<string, unknown>>[] {
    return freeze(ids.map((id) => {
      const event = this.sqlite.prepare('SELECT id,event_type,status,summary,occurred_at FROM evidence_events WHERE id=?').get(id) as any;
      if (!event) return freeze({ id, integrity: 'MISSING_EVENT', event: null, snapshots: freeze([]) });
      const snapshots = this.sqlite.prepare('SELECT id,image_path,image_hash,capture_origin,captured_at FROM evidence_snapshots WHERE evidence_event_id=? ORDER BY captured_at,id').all(id) as any[];
      const failed = this.sqlite.prepare("SELECT 1 FROM evidence_capture_attempts WHERE evidence_event_id=? AND status='FAILED' LIMIT 1").get(id);
      return freeze({ id, integrity: snapshots.length ? 'UNVERIFIED_ASSET' : failed ? 'CAPTURE_FAILED' : 'MISSING_ASSET', event: freeze({ id:event.id,eventType:event.event_type,status:event.status,summary:event.summary,occurredAt:event.occurred_at }), snapshots: freeze(snapshots.map((snapshot) => freeze({ id:snapshot.id,imagePath:snapshot.image_path,imageHash:snapshot.image_hash,captureOrigin:snapshot.capture_origin,capturedAt:snapshot.captured_at }))) });
    }));
  }

  private lessonVersion(row: any): Readonly<Record<string, unknown>> | null {
    return row ? freeze({ id: row.id, lessonId: row.lesson_id, versionNo: row.version_no, status: row.status, statement: row.statement, createdAt: row.created_at, supersedesId: row.supersedes_id }) : null;
  }

  private lineageIds(colonyId:string):string[]{
    const edges=this.sqlite.prepare('SELECT source_colony_id source,target_colony_id target FROM colony_lineage').all() as Array<{source:string;target:string}>;
    const seen=new Set([colonyId]);let changed=true;
    while(changed){changed=false;for(const edge of edges){if(seen.has(edge.source)&&!seen.has(edge.target)){seen.add(edge.target);changed=true;}if(seen.has(edge.target)&&!seen.has(edge.source)){seen.add(edge.source);changed=true;}}}
    return [...seen].sort();
  }
}
