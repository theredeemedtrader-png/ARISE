import { describe, expect, it } from 'vitest';
import { createEvidenceEvent, createEvidenceReference, createEvidenceSnapshot, createEvidenceStageSummary, defaultEvidenceFramingProfile, type ChartWorkspaceEvidenceState } from '@arise/evidence';
import { openDatabase } from './database';
import { EvidenceRepository } from './evidence-repository';

const now = '2026-09-11T12:00:00.000Z';
const workspaceState: ChartWorkspaceEvidenceState = {
  schemaVersion: 1, instrumentId: 'instrument-eurusd', timeframe: '1H', visibleInterval: null, candles: [], marketObjectVersionIds: ['object-v1'], projections: [],
  activeRuntimeNode: { runtimeId: 'runtime-1', runtimeNodeId: 'runtime-node-1', graphNodeId: 'graph-node-1', state: 'CONFIRMED' }, colonyId: 'colony-1', ideaVersionId: 'idea-v1', strategyMapVersionId: 'map-v1', annotations: [], eventContext: {},
};

describe('M8 Evidence persistence', () => {
  it('persists EvidenceEvent and exact references before raster capture, then records failure independently', () => {
    const connection = openDatabase(':memory:');
    try {
      connection.sqlite.exec(`
        INSERT INTO instruments VALUES ('instrument-eurusd','EURUSD','EUR/USD','FOREX','EUR','USD',0.0001,0.00001,5,1,'${now}');
        INSERT INTO timeframes VALUES ('timeframe-h1','1H',3600,NULL,10);
        INSERT INTO ideas VALUES ('idea-1','instrument-eurusd','timeframe-h1','ACTIVE','${now}',NULL);
        INSERT INTO idea_versions VALUES ('idea-v1','idea-1',1,'LONG','thesis','target','invalidation',NULL,NULL,'${now}',NULL);
        INSERT INTO colonies VALUES ('colony-1','idea-1','idea-v1','instrument-eurusd','EURUSD 1H LONG','BUILDING',NULL,'${now}',NULL);
        INSERT INTO strategy_definitions VALUES ('strategy-1','strategy-v1','${now}',NULL);
        INSERT INTO strategy_versions (id,strategy_definition_id,version_no,name,category,description,tags_json,automation_capability,detector_json,created_at,supersedes_strategy_version_id,deployment_status)
          VALUES ('strategy-v1','strategy-1',1,'MSS','ENTRY','', '[]','AUTOMATABLE','{"key":"mss"}','${now}',NULL,'VALIDATED');
        INSERT INTO strategy_maps VALUES ('map-1','STRATEGY_MAP','Evidence map','map-v1','${now}',NULL);
        INSERT INTO strategy_map_versions VALUES ('map-v1','map-1',1,'{"nodes":[],"edges":[]}','${now}',NULL);
        INSERT INTO strategy_runtimes VALUES ('runtime-1','colony-1','map-v1','SHADOW','RUNNING','${now}',NULL);
        INSERT INTO runtime_nodes VALUES ('runtime-node-1','runtime-1','graph-node-1','CONFIRMED','${now}',NULL,'${now}',NULL,1,'{}');
        INSERT INTO runtime_node_events VALUES ('runtime-event-1','runtime-1','runtime-node-1','WATCHING','CONFIRMED','DETECTOR_CONFIRMED','market-event-1','MSS confirmed','${now}');
        INSERT INTO decision_traces VALUES ('trace-1','runtime-1','DETECTOR_CONFIRMED','runtime-node-1','MSS confirmed','{}','${now}');
      `);
      const repository = new EvidenceRepository(connection.db);
      const event = createEvidenceEvent({ id: 'evidence-1', sourceType: 'STRATEGY_RUNTIME', sourceId: 'runtime-event-1', eventType: 'STRATEGY_CONFIRMATION', status: 'CONFIRMED', occurredAt: now, summary: 'MSS confirmed', decisionTraceId: 'trace-1', strategyRuntimeId: 'runtime-1', runtimeNodeId: 'runtime-node-1', timeframe: '1H', capturePolicy: 'STRATEGY_EVIDENCE_AND_ENTRY' });
      repository.record([{ event, workspaceState, framingProfile: defaultEvidenceFramingProfile, references: [
        createEvidenceReference({ id: 'reference-map', evidenceEventId: event.id, entityType: 'STRATEGY_MAP', entityId: 'map-v1', entityVersionId: 'map-v1', relationType: 'EXACT_STRATEGY_MAP_VERSION', createdAt: now }),
        createEvidenceReference({ id: 'reference-object', evidenceEventId: event.id, entityType: 'MARKET_OBJECT', entityId: 'object-1', entityVersionId: 'object-v1', relationType: 'EXACT_MARKET_OBJECT_VERSION', createdAt: now }),
      ] }]);
      expect(repository.find(event.id)?.snapshots).toHaveLength(0);
      expect(repository.find(event.id)?.plan.references[1]?.entityVersionId).toBe('object-v1');
      repository.recordCaptureFailure({ id: 'attempt-failed', evidenceEventId: event.id, error: 'chart unavailable', attemptedAt: now });
      expect(repository.find(event.id)?.captureAttempts[0]?.status).toBe('FAILED');
      expect(repository.find(event.id)?.plan.event.decisionTraceId).toBe('trace-1');
      expect(() => connection.sqlite.exec("UPDATE evidence_events SET summary='changed' WHERE id='evidence-1'")).toThrow('immutable');
    } finally { connection.sqlite.close(); }
  });

  it('stores immutable raster metadata and Stage Summary links to each event', () => {
    const connection = openDatabase(':memory:');
    try {
      connection.sqlite.exec(`
        INSERT INTO instruments VALUES ('instrument-eurusd','EURUSD','EUR/USD','FOREX','EUR','USD',0.0001,0.00001,5,1,'${now}');
        INSERT INTO timeframes VALUES ('timeframe-h1','1H',3600,NULL,10);
        INSERT INTO ideas VALUES ('idea-1','instrument-eurusd','timeframe-h1','ACTIVE','${now}',NULL);
        INSERT INTO idea_versions VALUES ('idea-v1','idea-1',1,'LONG','','','',NULL,NULL,'${now}',NULL);
        INSERT INTO colonies VALUES ('colony-1','idea-1','idea-v1','instrument-eurusd','Colony','BUILDING',NULL,'${now}',NULL);
        INSERT INTO strategy_maps VALUES ('map-1','STRATEGY_MAP','Map','map-v1','${now}',NULL);
        INSERT INTO strategy_map_versions VALUES ('map-v1','map-1',1,'{"nodes":[],"edges":[]}','${now}',NULL);
        INSERT INTO strategy_runtimes VALUES ('runtime-1','colony-1','map-v1','OBSERVE','RUNNING','${now}',NULL);
      `);
      const repository = new EvidenceRepository(connection.db);
      const plans = ['evidence-a', 'evidence-b'].map((id, index) => ({ event: createEvidenceEvent({ id, sourceType: 'STRATEGY_RUNTIME', sourceId: `source-${index}`, eventType: 'STRATEGY_CONFIRMATION', status: 'CONFIRMED', occurredAt: now, summary: `Node ${index}`, decisionTraceId: null, strategyRuntimeId: 'runtime-1', runtimeNodeId: null, timeframe: '1H', capturePolicy: 'STRATEGY_EVIDENCE_AND_ENTRY' }), references: [], workspaceState, framingProfile: defaultEvidenceFramingProfile }));
      repository.record(plans);
      const snapshot = createEvidenceSnapshot({ id: 'snapshot-a', evidenceEventId: 'evidence-a', chartWorkspaceState: workspaceState, imagePath: 'evidence-a/snapshot-a.png', imageHash: 'f'.repeat(64), framingProfile: defaultEvidenceFramingProfile, capturedAt: now, captureOrigin: 'AUTOMATIC' });
      repository.recordCaptureSuccess(snapshot, 'attempt-success');
      expect(repository.find('evidence-a')?.snapshots[0]?.imageHash).toBe('f'.repeat(64));
      repository.createStageSummary(createEvidenceStageSummary({ id: 'summary-1', strategyRuntimeId: 'runtime-1', timeframe: '1H', title: '1H stage', evidenceEventIds: ['evidence-a','evidence-b'], createdAt: now }));
      expect(repository.listStageSummaries()[0]?.evidenceEventIds).toEqual(['evidence-a','evidence-b']);
      expect(() => connection.sqlite.exec("DELETE FROM evidence_snapshots WHERE id='snapshot-a'")).toThrow('immutable');
    } finally { connection.sqlite.close(); }
  });
});
