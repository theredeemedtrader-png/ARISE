import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultDetectorRegistry,
  createRuntime,
  defaultNode,
  processRuntimeEvent,
  manualNodeDecision,
  runtimeEventId,
  runtimeNodeId,
  runtimeNodeEventId,
  detectorEvaluationId,
  decisionTraceId,
  strategyDefinitionId,
  strategyVersionId,
  strategyMapId,
  strategyMapVersionId,
  strategyGraphEdgeId,
  strategyGraphNodeId,
  strategyRuntimeId,
  type RuntimeIdFactory,
} from '@arise/strategy-engine';
import { openDatabase } from './database';
import { RuntimeRepository } from './runtime-repository';
import { StrategyRepository } from './strategy-repository';
import { EvidenceRepository } from './evidence-repository';
import { buildRuntimeEvidencePlans } from '@arise/evidence';

const now='2026-09-11T12:00:00.000Z';
let seq=0;
const ids: RuntimeIdFactory={
  runtimeNode:(graphNodeId)=>runtimeNodeId(`rn-${graphNodeId}`),
  runtimeNodeEvent:()=>runtimeNodeEventId(`rne-${++seq}`),
  detectorEvaluation:()=>detectorEvaluationId(`de-${++seq}`),
  decisionTrace:()=>decisionTraceId(`dt-${++seq}`),
};

describe('M7 runtime persistence',()=>{
  it('restores exact runtime state after restart and preserves immutable progression history',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'arise-m7-'));
    const filename=path.join(dir,'arise.db');
    let connection=openDatabase(filename);
    try {
      connection.sqlite.exec(`
        INSERT INTO instruments VALUES ('instrument-eurusd','EURUSD','EUR/USD','FOREX','EUR','USD',0.0001,0.00001,5,1,'${now}');
        INSERT INTO timeframes VALUES ('timeframe-m5','M5',300,NULL,5);
        INSERT INTO ideas VALUES ('idea-1','instrument-eurusd','timeframe-m5','ACTIVE','${now}',NULL);
        INSERT INTO idea_versions VALUES ('idea-v1','idea-1',1,'LONG','thesis','target','invalid',NULL,NULL,'${now}',NULL);
        INSERT INTO colonies VALUES ('colony-1','idea-1','idea-v1','instrument-eurusd','EURUSD M5 Long','BUILDING',NULL,'${now}',NULL);
      `);
      const strategyRepo=new StrategyRepository(connection.db);
      const definition=strategyRepo.createDefinition({
        definitionId:strategyDefinitionId('sd'), versionId:strategyVersionId('sv'), name:'Touch', category:'ENTRY', description:'', tags:[], automationCapability:'AUTOMATABLE', deploymentStatus:'VALIDATED',
        detector:{key:'price_touch',version:'1',evaluationMode:'ON_PRICE_UPDATE',parameterSchema:{}}, createdAt:now,
      });
      const strategyNode={...defaultNode({id:strategyGraphNodeId('touch'),family:'STRATEGY',label:'Touch',x:0,y:0}),strategyVersionId:definition.currentVersion.id,parameters:{level:1.1000}};
      const actionNode={...defaultNode({id:strategyGraphNodeId('scout'),family:'ACTION',label:'Create Scout',x:200,y:0}),actionKey:'create_scout'};
      const map=strategyRepo.createMap({mapId:strategyMapId('map'),versionId:strategyMapVersionId('map-v1'),kind:'STRATEGY_MAP',name:'Runtime test',graph:{nodes:[strategyNode,actionNode],edges:[{id:strategyGraphEdgeId('edge'),sourceNodeId:strategyNode.id,targetNodeId:actionNode.id,sourcePort:'out',targetPort:'in'}]},createdAt:now});
      const runtimeRepo=new RuntimeRepository(connection.db);
      let snapshot=runtimeRepo.create(createRuntime({runtimeId:strategyRuntimeId('runtime-1'),colonyId:'colony-1',mapVersion:map.currentVersion,mode:'SHADOW',startedAt:now,ids}));
      const event={id:runtimeEventId('event-1'),type:'PRICE_UPDATE' as const,instrumentId:'instrument-eurusd',timeframe:'M5',occurredAt:now,context:{instrumentId:'instrument-eurusd',timeframe:'M5',candles:[],bid:1.0999,ask:1.1001,chartPrice:1.1000,spreadPips:2,pipSize:0.0001,marketObjects:[],states:{},session:null,economicEvents:[],occurredAt:now}};
      const result=processRuntimeEvent({snapshot,mapVersion:map.currentVersion,strategies:new Map([[definition.currentVersion.id,definition.currentVersion]]),detectorRegistry:createDefaultDetectorRegistry(),event,ids});
      const evidencePlans=buildRuntimeEvidencePlans({runtime:result.snapshot.runtime,nodes:result.snapshot.nodes,graphNodes:map.currentVersion.graph.nodes,nodeEvents:result.nodeEvents,evaluations:result.evaluations,traces:result.traces,context:event.context,ideaVersionId:'idea-v1',ids:{evidenceEvent:()=>`ee-${++seq}`,evidenceReference:()=>`er-${++seq}`}});
      snapshot=runtimeRepo.commit(event,result,evidencePlans);
      expect(snapshot.nodes.find((node)=>node.graphNodeId==='touch')?.state).toBe('CONFIRMED');
      expect(snapshot.nodes.find((node)=>node.graphNodeId==='scout')?.state).toBe('WATCHING');
      expect(runtimeRepo.evaluations(snapshot.runtime.id)).toHaveLength(1);
      expect(runtimeRepo.traces(snapshot.runtime.id).some((trace)=>trace.eventType==='DETECTOR_CONFIRMED')).toBe(true);
      const evidenceRepo=new EvidenceRepository(connection.db);
      expect(evidenceRepo.list()).toHaveLength(1);
      expect(evidenceRepo.list()[0]?.plan.event.decisionTraceId).not.toBeNull();
      expect(evidenceRepo.list()[0]?.plan.references.some((reference)=>reference.relationType==='EXACT_STRATEGY_MAP_VERSION'&&reference.entityVersionId==='map-v1')).toBe(true);
      evidenceRepo.recordCaptureFailure({id:'capture-failure',evidenceEventId:evidencePlans[0]!.event.id,error:'capture failed',attemptedAt:now});
      expect(runtimeRepo.reconstruct(snapshot.runtime.id)?.nodes.find((node)=>node.graphNodeId==='touch')?.state).toBe('CONFIRMED');
      expect(()=>runtimeRepo.commit(event,result)).toThrow(/already processed/i);
      connection.sqlite.close();
      connection=openDatabase(filename);
      const restored=new RuntimeRepository(connection.db).reconstruct(strategyRuntimeId('runtime-1'))!;
      expect(restored.nodes.find((node)=>node.graphNodeId==='touch')?.state).toBe('CONFIRMED');
      expect(restored.nodes.find((node)=>node.graphNodeId==='scout')?.state).toBe('WATCHING');
      expect(()=>connection.sqlite.exec("UPDATE runtime_node_events SET summary='bad'")).toThrow('immutable');
    } finally { connection.sqlite.close(); rmSync(dir,{recursive:true,force:true}); }
  });
  it('persists manual CONFIRM decisions and downstream arming without a synthetic processed market event',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'arise-m7-manual-'));
    const filename=path.join(dir,'arise.db');
    const connection=openDatabase(filename);
    try {
      connection.sqlite.exec(`
        INSERT INTO instruments VALUES ('instrument-eurusd','EURUSD','EUR/USD','FOREX','EUR','USD',0.0001,0.00001,5,1,'${now}');
        INSERT INTO timeframes VALUES ('timeframe-d','D',NULL,'DAILY',100);
        INSERT INTO ideas VALUES ('idea-manual','instrument-eurusd','timeframe-d','ACTIVE','${now}',NULL);
        INSERT INTO idea_versions VALUES ('idea-manual-v1','idea-manual',1,'LONG','thesis','target','invalid',NULL,NULL,'${now}',NULL);
        INSERT INTO colonies VALUES ('colony-manual','idea-manual','idea-manual-v1','instrument-eurusd','EURUSD D Long','BUILDING',NULL,'${now}',NULL);
      `);
      const strategyRepo=new StrategyRepository(connection.db);
      const definition=strategyRepo.createDefinition({
        definitionId:strategyDefinitionId('sd-manual-db'), versionId:strategyVersionId('sv-manual-db'), name:'Manual Gate', category:'CONTEXT', description:'', tags:[], automationCapability:'MANUAL', deploymentStatus:'EXPERIMENTAL', detector:null, createdAt:now,
      });
      const manualNode={...defaultNode({id:strategyGraphNodeId('manual-gate-db'),family:'STRATEGY',label:'Manual Gate',x:0,y:0}),strategyVersionId:definition.currentVersion.id,executionMode:'CONFIRM' as const,parameters:{}};
      const actionNode={...defaultNode({id:strategyGraphNodeId('manual-action-db'),family:'ACTION',label:'Notify',x:200,y:0}),actionKey:'notify'};
      const map=strategyRepo.createMap({mapId:strategyMapId('manual-map-db'),versionId:strategyMapVersionId('manual-map-db-v1'),kind:'STRATEGY_MAP',name:'Manual Runtime test',graph:{nodes:[manualNode,actionNode],edges:[{id:strategyGraphEdgeId('manual-edge-db'),sourceNodeId:manualNode.id,targetNodeId:actionNode.id,sourcePort:'out',targetPort:'in'}]},createdAt:now});
      const runtimeRepo=new RuntimeRepository(connection.db);
      const snapshot=runtimeRepo.create(createRuntime({runtimeId:strategyRuntimeId('runtime-manual-db'),colonyId:'colony-manual',mapVersion:map.currentVersion,mode:'OBSERVE',startedAt:now,ids}));
      const result=manualNodeDecision({snapshot,mapVersion:map.currentVersion,strategies:new Map([[definition.currentVersion.id,definition.currentVersion]]),graphNodeId:manualNode.id,decision:'CONFIRM',occurredAt:now,ids});
      const committed=runtimeRepo.commitManualDecision(result);
      expect(committed.nodes.find((node)=>node.graphNodeId===manualNode.id)?.state).toBe('CONFIRMED');
      expect(committed.nodes.find((node)=>node.graphNodeId===actionNode.id)?.state).toBe('WATCHING');
      expect(runtimeRepo.traces(committed.runtime.id).some((trace)=>trace.eventType==='MANUAL_CONFIRM' && trace.details.source==='USER_MANUAL')).toBe(true);
      expect(runtimeRepo.events(committed.runtime.id).some((event)=>event.eventType==='MANUAL_CONFIRM')).toBe(true);
    } finally { connection.sqlite.close(); rmSync(dir,{recursive:true,force:true}); }
  });

});
