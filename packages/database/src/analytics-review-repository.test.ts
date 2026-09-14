/* eslint-disable @typescript-eslint/no-explicit-any -- Tests inspect validated JSON workspace projections. */
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database';
import { AnalyticsReviewRepository } from './analytics-review-repository';

const at = '2026-09-12T10:00:00.000Z';
function seed(sqlite: ReturnType<typeof openDatabase>['sqlite']): void {
  sqlite.exec(`
    INSERT INTO instruments VALUES ('instrument','EURUSD','EUR/USD','FOREX','EUR','USD',0.0001,0.00001,5,1,'${at}');
    INSERT INTO timeframes VALUES ('tf-d','D',NULL,'BROKER_DAILY',1);
    INSERT INTO ideas VALUES ('idea','instrument','tf-d','ACTIVE','${at}',NULL);
    INSERT INTO idea_versions VALUES ('idea-v1','idea',1,'LONG','Original thesis','Target','Invalidation',NULL,NULL,'${at}',NULL);
    INSERT INTO colonies VALUES ('colony-source','idea','idea-v1','instrument','Source Colony','ESTABLISHED',NULL,'${at}',NULL);
    INSERT INTO colonies VALUES ('colony-promoted','idea','idea-v1','instrument','Promoted Colony','MATURE',NULL,'${at}',NULL);
    INSERT INTO colony_lineage VALUES ('lineage-1','colony-source','colony-promoted','PROMOTED_TO');
    INSERT INTO strategy_definitions VALUES ('strategy','strategy-v1','${at}',NULL);
    INSERT INTO strategy_versions (id,strategy_definition_id,version_no,name,category,description,tags_json,automation_capability,detector_json,deployment_status,created_at,supersedes_strategy_version_id)
      VALUES ('strategy-v1','strategy',1,'Sweep','ENTRY','Original rules','["liquidity"]','DETECTABLE',NULL,'VALIDATED','${at}',NULL);
    INSERT INTO strategy_maps VALUES ('template','TEMPLATE','London Entry','map-v1','${at}',NULL);
    INSERT INTO strategy_map_versions VALUES ('map-v1','template',1,'{"nodes":[{"strategyVersionId":"strategy-v1","timeframe":"M5","purposes":["ENTRY"]}],"edges":[]}','${at}',NULL);
    INSERT INTO strategy_runtimes VALUES ('runtime-human','colony-source','map-v1','SHADOW','RUNNING','${at}',NULL);
    INSERT INTO runtime_nodes VALUES ('runtime-node-human','runtime-human','manual-confirm','CONFIRMED',NULL,NULL,'${at}',NULL,1,'{}');
    INSERT INTO runtime_node_events VALUES ('manual-confirm-event','runtime-human','runtime-node-human','TRIGGERED','CONFIRMED','MANUAL_CONFIRM',NULL,'Human approved the opportunity','${at}');
    INSERT INTO attempts VALUES ('attempt-1','colony-source','runtime-human',1,'${at}','2026-09-12T10:30:00.000Z','FAILED',10);
    INSERT INTO attempts VALUES ('attempt-2','colony-source',NULL,2,'${at}','2026-09-12T13:00:00.000Z','SURVIVED',0);
    INSERT INTO trades VALUES ('trade-loser','attempt-1','colony-source','idea-v1','map-v1','LONG','${at}','ARISE_MANUAL');
    INSERT INTO trades VALUES ('trade-runner','attempt-2','colony-source','idea-v1','map-v1','LONG','${at}','ARISE_AUTO');
    INSERT INTO positions VALUES ('position-loser','trade-loser','account','broker-loser','colony-source','colony-source','LONG',0.1,0,1.1000,'FAILED','${at}','2026-09-12T10:30:00.000Z');
    INSERT INTO positions VALUES ('position-runner','trade-runner','account','broker-runner','colony-source','colony-promoted','LONG',0.2,0,1.1000,'CLOSED','${at}','2026-09-12T13:00:00.000Z');
    INSERT INTO position_state_events VALUES ('state-survivor','position-runner','SCOUT','SURVIVOR','survived','SYSTEM',NULL,'2026-09-12T10:45:00.000Z',0,NULL);
    INSERT INTO position_state_events VALUES ('state-leg','position-runner','SURVIVOR','LEG','leg','SYSTEM',NULL,'2026-09-12T11:00:00.000Z',0,NULL);
    INSERT INTO position_state_events VALUES ('state-runner','position-runner','LEG','RUNNER','runner','SYSTEM',NULL,'2026-09-12T11:30:00.000Z',0,NULL);
    INSERT INTO evidence_events VALUES ('evidence-1','TRADE','trade-runner','ENTRY','CONFIRMED','${at}','Entry evidence',NULL,NULL,NULL,'M5','CUSTOM','{}','{}');
  `);
}

describe('M12 analytics and evidence-backed review persistence', () => {
  it('attributes failed Scouts and a large Runner across promoted lineage', () => {
    const connection = openDatabase(':memory:');
    try {
      seed(connection.sqlite);
      const repo = new AnalyticsReviewRepository(connection.sqlite);
      repo.recordPerformanceFact({ id:'exit-loss',positionId:'position-loser',eventType:'EXIT_FILL',quantity:.1,price:1.099,money:-10,sourceType:'BROKER',sourceId:'deal-loss',occurredAt:'2026-09-12T10:30:00.000Z' });
      repo.recordPerformanceFact({ id:'exit-runner-1',positionId:'position-runner',eventType:'EXIT_FILL',quantity:.1,price:1.105,money:50,sourceType:'BROKER',sourceId:'deal-runner-1',occurredAt:'2026-09-12T12:00:00.000Z' });
      repo.recordPerformanceFact({ id:'exit-runner-2',positionId:'position-runner',eventType:'EXIT_FILL',quantity:.1,price:1.11,money:100,sourceType:'BROKER',sourceId:'deal-runner-2',occurredAt:'2026-09-12T13:00:00.000Z' });
      const workspace = repo.analyticsWorkspace('2026-09-12T14:00:00.000Z') as any;
      expect(workspace.overall).toMatchObject({ wins:1,losses:1,incompleteOutcomes:0 });
      expect(workspace.overall.scoutingCost.value).toBe(10);
      expect(workspace.positions.find((position: any)=>position.positionId==='position-runner')).toMatchObject({ originalColonyId:'colony-source',currentColonyId:'colony-promoted',isRunner:true });
      const source=workspace.colonies.find((colony:any)=>colony.colonyId==='colony-source');
      expect(source.lineageColonyIds).toEqual(['colony-promoted','colony-source']);
      expect(source.lineageAnalytics).toMatchObject({positionCount:2,wins:1,losses:1,millipedeEfficiency:{status:'AVAILABLE'}});
      expect(source.lineageAnalytics.millipedeEfficiency.value).toBeCloseTo(1.5);
      expect(workspace.groups.TEMPLATE.groups[0]).toMatchObject({key:'London Entry v1',positions:2});
      expect(workspace.groups.QUALIFICATION.groups.map((group: any)=>group.key)).toEqual(['AUTOMATICALLY_QUALIFIED','HUMAN_APPROVED']);
      expect(workspace.groups.QUALIFICATION.unavailableCount).toBe(0);
      expect(workspace.groups.SESSION).toMatchObject({groups:[],unavailableCount:2});
      expect(workspace.curve).toHaveLength(3);
    } finally { connection.sqlite.close(); }
  });

  it('reports missing exit/mark facts as unavailable and preserves true zero-trade metrics', () => {
    const connection = openDatabase(':memory:');
    try {
      seed(connection.sqlite);
      const repo = new AnalyticsReviewRepository(connection.sqlite);
      const workspace = repo.analyticsWorkspace() as any;
      expect(workspace.positions.every((position: any)=>position.realizedPips.status==='UNAVAILABLE')).toBe(true);
      const emptyConnection = openDatabase(':memory:');
      try {
        const empty = new AnalyticsReviewRepository(emptyConnection.sqlite).analyticsWorkspace() as any;
        expect(empty.overall).toMatchObject({positionCount:0,attemptCount:0,realizedPips:{status:'AVAILABLE',value:0},wins:0,losses:0,breakevens:0});
        expect(empty.overall.millipedeEfficiency.status).toBe('UNAVAILABLE');
      } finally { emptyConnection.sqlite.close(); }
    } finally { connection.sqlite.close(); }
  });

  it('deduplicates immutable broker performance facts', () => {
    const connection = openDatabase(':memory:');
    try {
      seed(connection.sqlite);
      const repo = new AnalyticsReviewRepository(connection.sqlite);
      const fact = { id:'exit',positionId:'position-loser',eventType:'EXIT_FILL' as const,quantity:.1,price:1.099,money:null,sourceType:'BROKER',sourceId:'deal-1',occurredAt:at };
      repo.recordPerformanceFact(fact);
      expect(()=>repo.recordPerformanceFact({...fact,id:'duplicate'})).toThrow();
      expect(()=>connection.sqlite.prepare("UPDATE position_performance_events SET price=2 WHERE id='exit'").run()).toThrow('immutable');
    } finally { connection.sqlite.close(); }
  });

  it('freezes exact Idea/Strategy versions through Dissection -> Lesson -> Pattern -> Playbook update', () => {
    const connection = openDatabase(':memory:');
    try {
      seed(connection.sqlite);
      const repo = new AnalyticsReviewRepository(connection.sqlite);
      const review = repo.createReview({ id:'review-1',dissectionVersionId:'dissection-v1',sourceType:'TRADE',sourceId:'trade-runner',title:'Runner dissection',dissection:{thesis:'Thesis valid',decision:'Entry qualified',management:'Protected then held',outcome:'Right tail captured',lesson:'Keep valid runners'},evidenceEventIds:['evidence-1'],createdAt:'2026-09-12T14:00:00.000Z' }) as any;
      expect(review.ideaVersion).toMatchObject({id:'idea-v1',thesis_text:'Original thesis'});
      expect(review.strategyMapVersion).toMatchObject({id:'map-v1',version_no:1});
      expect(review.evidence[0].integrity).toBe('MISSING_ASSET');
      expect(review.currentDissection.analytics[0]).toMatchObject({ideaVersionId:'idea-v1',strategyMapVersionId:'map-v1'});
      const revised = repo.reviseReview({reviewId:'review-1',versionId:'dissection-v2',dissection:{thesis:'Thesis remained valid',decision:'Entry was still qualified',management:'Protected and held',outcome:'Right tail remained captured',lesson:'Keep valid runners longer'},createdAt:'2026-09-12T14:00:30.000Z'}) as any;
      expect(revised.dissectionVersions).toHaveLength(2);
      expect(revised.currentDissection.analytics).toEqual(review.currentDissection.analytics);
      expect(revised.dissectionVersions[0].narrative.thesis).toBe('Thesis valid');

      repo.createLesson({id:'lesson-1',versionId:'lesson-v1',reviewId:'review-1',statement:'Preserve valid runners',createdAt:'2026-09-12T14:01:00.000Z'});
      repo.advanceLesson({lessonId:'lesson-1',versionId:'lesson-v2',status:'REPEATED_PATTERN',createdAt:'2026-09-12T14:02:00.000Z'});
      repo.advanceLesson({lessonId:'lesson-1',versionId:'lesson-v3',status:'PLAYBOOK_RULE',createdAt:'2026-09-12T14:03:00.000Z'});
      repo.proposePlaybookUpdate({id:'proposal-1',lessonId:'lesson-1',strategyVersionId:'strategy-v1',proposedChange:'Hold protected runners through first target.',expectedEffect:'Increase survivor contribution.',testRequirements:'Compare at least 20 Colonies.',createdAt:'2026-09-12T14:04:00.000Z'});
      const accepted = repo.acceptPlaybookUpdate({proposalId:'proposal-1',resultingStrategyVersionId:'strategy-v2',occurredAt:'2026-09-12T14:05:00.000Z'}) as any;
      expect(accepted).toMatchObject({status:'ACCEPTED',resultingStrategyVersionId:'strategy-v2'});
      expect(connection.sqlite.prepare("SELECT deployment_status,supersedes_strategy_version_id FROM strategy_versions WHERE id='strategy-v2'").get()).toEqual({deployment_status:'EXPERIMENTAL',supersedes_strategy_version_id:'strategy-v1'});
      expect((repo.advanceLesson({lessonId:'lesson-1',versionId:'lesson-v4',status:'MASTERED',createdAt:'2026-09-12T14:06:00.000Z'}) as any).currentVersion.status).toBe('MASTERED');
      expect((repo.advanceLesson({lessonId:'lesson-1',versionId:'lesson-v5',status:'ARCHIVED',createdAt:'2026-09-12T14:07:00.000Z'}) as any).currentVersion.status).toBe('ARCHIVED');
      connection.sqlite.exec("UPDATE ideas SET current_status='WATCHING' WHERE id='idea';");
      connection.sqlite.exec("INSERT INTO idea_versions VALUES ('idea-v2','idea',2,'SHORT','Revised thesis','New target','New invalidation',NULL,NULL,'2026-09-12T15:00:00.000Z','idea-v1');");
      const reconstructed = repo.review('review-1') as any;
      expect(reconstructed.ideaVersion).toMatchObject({id:'idea-v1',direction:'LONG',thesis_text:'Original thesis'});
      expect((repo.analyticsWorkspace() as any).groups.STRATEGY.groups[0].key).toBe('Sweep v1');
    } finally { connection.sqlite.close(); }
  });

  it('rejects skipped Lesson stages and stale playbook proposals', () => {
    const connection = openDatabase(':memory:');
    try {
      seed(connection.sqlite);
      const repo = new AnalyticsReviewRepository(connection.sqlite);
      const review=repo.createReview({ id:'review',dissectionVersionId:'d1',sourceType:'COLONY',sourceId:'colony-source',title:'Colony review',dissection:{thesis:'t',decision:'d',management:'m',outcome:'o',lesson:'l'},evidenceEventIds:[],createdAt:at }) as any;
      expect(review.currentDissection.analytics.positionCount).toBe(2);
      repo.createLesson({id:'lesson',versionId:'lv1',reviewId:'review',statement:'Observe',createdAt:at});
      expect(()=>repo.advanceLesson({lessonId:'lesson',versionId:'lv2',status:'PLAYBOOK_RULE',createdAt:at})).toThrow('cannot transition');
      repo.advanceLesson({lessonId:'lesson',versionId:'lv2',status:'REPEATED_PATTERN',createdAt:at});
      repo.advanceLesson({lessonId:'lesson',versionId:'lv3',status:'PLAYBOOK_RULE',createdAt:at});
      repo.proposePlaybookUpdate({id:'proposal',lessonId:'lesson',strategyVersionId:'strategy-v1',proposedChange:'change',expectedEffect:'effect',testRequirements:'tests',createdAt:at});
      connection.sqlite.exec("INSERT INTO strategy_versions (id,strategy_definition_id,version_no,name,category,description,tags_json,automation_capability,detector_json,deployment_status,created_at,supersedes_strategy_version_id) VALUES ('strategy-v2','strategy',2,'Sweep','ENTRY','Other change','[]','DETECTABLE',NULL,'EXPERIMENTAL','2026-09-12T15:00:00.000Z','strategy-v1'); UPDATE strategy_definitions SET current_version_id='strategy-v2' WHERE id='strategy';");
      expect(()=>repo.acceptPlaybookUpdate({proposalId:'proposal',resultingStrategyVersionId:'strategy-v3',occurredAt:'2026-09-12T16:00:00.000Z'})).toThrow('stale');
    } finally { connection.sqlite.close(); }
  });
});
