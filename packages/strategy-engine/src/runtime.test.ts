import { describe, expect, it } from 'vitest';
import {
  createStrategyDefinitionWithInitialVersion, createStrategyMapWithInitialVersion, defaultNode,
  deploymentStatusAllowsRuntimeMode, maximumRuntimeMode, strategyDefinitionId, strategyGraphEdgeId,
  strategyGraphNodeId, strategyMapId, strategyMapVersionId, strategyVersionId,
} from './model';
import { createDefaultDetectorRegistry, type MarketContext } from './detectors';
import {
  createRuntime, processRuntimeEvent, manualNodeDecision, runtimeEventId, runtimeNodeId, runtimeNodeEventId, detectorEvaluationId, decisionTraceId, strategyRuntimeId,
  type RuntimeIdFactory,
} from './runtime';

const now='2026-09-11T12:00:00.000Z';
let seq=0;
const ids: RuntimeIdFactory = {
  runtimeNode: (graphNodeId)=>runtimeNodeId(`rn-${graphNodeId}`), runtimeNodeEvent:()=>runtimeNodeEventId(`rne-${++seq}`),
  detectorEvaluation:()=>detectorEvaluationId(`de-${++seq}`), decisionTrace:()=>decisionTraceId(`dt-${++seq}`),
};
function market(chartPrice:number): MarketContext { return { instrumentId:'EURUSD',timeframe:'M5',candles:[],bid:chartPrice-0.0001,ask:chartPrice+0.0001,chartPrice,spreadPips:2,pipSize:0.0001,marketObjects:[],states:{},session:'NY',economicEvents:[],occurredAt:now }; }

describe('strategy runtime',()=>{
  it('enforces deployment approval ceilings',()=>{
    expect(deploymentStatusAllowsRuntimeMode('EXPERIMENTAL','OBSERVE')).toBe(true);
    expect(deploymentStatusAllowsRuntimeMode('EXPERIMENTAL','SHADOW')).toBe(false);
    expect(deploymentStatusAllowsRuntimeMode('VALIDATED','SHADOW')).toBe(true);
    expect(maximumRuntimeMode(['LIVE_APPROVED','DEMO_APPROVED','VALIDATED'])).toBe('SHADOW');
    expect(maximumRuntimeMode(['LIVE_APPROVED','RETIRED'])).toBeNull();
  });
  it('arms roots, evaluates only matching event modes, progresses downstream, and proposes rather than executes actions',()=>{
    const {version}=createStrategyDefinitionWithInitialVersion({definitionId:strategyDefinitionId('sd'),versionId:strategyVersionId('sv'),name:'Touch',category:'ENTRY',description:'',automationCapability:'AUTOMATABLE',deploymentStatus:'VALIDATED',detector:{key:'price_touch',version:'1',evaluationMode:'ON_PRICE_UPDATE',parameterSchema:{}},createdAt:now});
    const a={...defaultNode({id:strategyGraphNodeId('a'),family:'STRATEGY',label:'Touch',x:0,y:0}),strategyVersionId:version.id,parameters:{level:1.1000}};
    const b={...defaultNode({id:strategyGraphNodeId('b'),family:'ACTION',label:'Create Scout',x:200,y:0}),actionKey:'create_scout'};
    const map=createStrategyMapWithInitialVersion({mapId:strategyMapId('m'),versionId:strategyMapVersionId('mv'),kind:'STRATEGY_MAP',name:'Map',graph:{nodes:[a,b],edges:[{id:strategyGraphEdgeId('e'),sourceNodeId:a.id,targetNodeId:b.id,sourcePort:'out',targetPort:'in'}]},createdAt:now});
    const snapshot=createRuntime({runtimeId:strategyRuntimeId('rt'),colonyId:'colony',mapVersion:map.version,mode:'SHADOW',startedAt:now,ids});
    expect(snapshot.nodes.find(n=>n.graphNodeId==='a')?.state).toBe('WATCHING');
    expect(snapshot.nodes.find(n=>n.graphNodeId==='b')?.state).toBe('DORMANT');
    const wrong=processRuntimeEvent({snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-bar'),type:'BAR_CLOSE',instrumentId:'EURUSD',timeframe:'M5',occurredAt:now,context:market(1.1000)},ids});
    expect(wrong.evaluations).toHaveLength(0);
    const missingTimeframe=processRuntimeEvent({snapshot:wrong.snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-null-tf'),type:'PRICE_UPDATE',instrumentId:'EURUSD',timeframe:null,occurredAt:now,context:{...market(1.1000),timeframe:null}},ids});
    expect(missingTimeframe.evaluations).toHaveLength(0);
    const first=processRuntimeEvent({snapshot:missingTimeframe.snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-price'),type:'PRICE_UPDATE',instrumentId:'EURUSD',timeframe:'M5',occurredAt:now,context:market(1.1000)},ids});
    expect(first.evaluations[0]?.result).toBe('CONFIRMED');
    expect(first.snapshot.nodes.find(n=>n.graphNodeId==='b')?.state).toBe('WATCHING');
    const second=processRuntimeEvent({snapshot:first.snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-action'),type:'EVENT',instrumentId:'EURUSD',timeframe:'M5',occurredAt:now,context:market(1.1000)},ids});
    expect(second.actionProposals[0]?.actionKind).toBe('CREATE_SCOUT');
    expect(second.snapshot.nodes.find(n=>n.graphNodeId==='b')?.state).toBe('COMPLETED');
  });

  it('keeps OBSERVE mode non-proposing while still tracing action intent',()=>{
    const action={...defaultNode({id:strategyGraphNodeId('observe-action'),family:'ACTION',label:'Create Scout',x:0,y:0}),actionKey:'create_scout'};
    const map=createStrategyMapWithInitialVersion({mapId:strategyMapId('m-observe'),versionId:strategyMapVersionId('mv-observe'),kind:'STRATEGY_MAP',name:'Observe',graph:{nodes:[action],edges:[]},createdAt:now});
    const snapshot=createRuntime({runtimeId:strategyRuntimeId('rt-observe'),colonyId:'colony',mapVersion:map.version,mode:'OBSERVE',startedAt:now,ids});
    const value=processRuntimeEvent({snapshot,mapVersion:map.version,strategies:new Map(),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-observe'),type:'EVENT',instrumentId:'EURUSD',timeframe:null,occurredAt:now,context:market(1.1)},ids});
    expect(value.actionProposals).toHaveLength(0);
    expect(value.snapshot.nodes[0]?.state).toBe('COMPLETED');
    expect(value.traces.some((entry)=>entry.eventType==='ACTION_OBSERVED')).toBe(true);
  });
  it('records malformed detector parameters as ERROR without mutating runtime state',()=>{
    const {version}=createStrategyDefinitionWithInitialVersion({definitionId:strategyDefinitionId('sd-error'),versionId:strategyVersionId('sv-error'),name:'Touch',category:'ENTRY',description:'',automationCapability:'AUTOMATABLE',deploymentStatus:'VALIDATED',detector:{key:'price_touch',version:'1',evaluationMode:'ON_PRICE_UPDATE',parameterSchema:{}},createdAt:now});
    const node={...defaultNode({id:strategyGraphNodeId('err-node'),family:'STRATEGY',label:'Malformed Touch',x:0,y:0}),strategyVersionId:version.id,parameters:{}};
    const map=createStrategyMapWithInitialVersion({mapId:strategyMapId('m-error'),versionId:strategyMapVersionId('mv-error'),kind:'STRATEGY_MAP',name:'Error Map',graph:{nodes:[node],edges:[]},createdAt:now});
    const snapshot=createRuntime({runtimeId:strategyRuntimeId('rt-error'),colonyId:'colony',mapVersion:map.version,mode:'SHADOW',startedAt:now,ids});
    const value=processRuntimeEvent({snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-error'),type:'PRICE_UPDATE',instrumentId:'EURUSD',timeframe:'M5',occurredAt:now,context:market(1.1)},ids});
    expect(value.evaluations[0]?.result).toBe('ERROR');
    expect(value.snapshot.nodes[0]?.state).toBe('WATCHING');
    expect(value.traces.some((entry)=>entry.eventType==='DETECTOR_ERROR')).toBe(true);
  });

  it('pauses manual strategy nodes until CONFIRM, REJECT, or SKIP and records a Decision Trace',()=>{
    const {version}=createStrategyDefinitionWithInitialVersion({definitionId:strategyDefinitionId('sd-manual'),versionId:strategyVersionId('sv-manual'),name:'Manual Read',category:'CONTEXT',description:'',automationCapability:'MANUAL',deploymentStatus:'EXPERIMENTAL',detector:null,createdAt:now});
    const manual={...defaultNode({id:strategyGraphNodeId('manual-node'),family:'STRATEGY',label:'Manual Read',x:0,y:0}),strategyVersionId:version.id,executionMode:'CONFIRM' as const,parameters:{}};
    const action={...defaultNode({id:strategyGraphNodeId('manual-action'),family:'ACTION',label:'Notify',x:200,y:0}),actionKey:'notify'};
    const map=createStrategyMapWithInitialVersion({mapId:strategyMapId('m-manual'),versionId:strategyMapVersionId('mv-manual'),kind:'STRATEGY_MAP',name:'Manual Map',graph:{nodes:[manual,action],edges:[{id:strategyGraphEdgeId('e-manual'),sourceNodeId:manual.id,targetNodeId:action.id,sourcePort:'out',targetPort:'in'}]},createdAt:now});
    const snapshot=createRuntime({runtimeId:strategyRuntimeId('rt-manual'),colonyId:'colony',mapVersion:map.version,mode:'OBSERVE',startedAt:now,ids});
    const synthetic=processRuntimeEvent({snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-manual-synthetic'),type:'MANUAL',instrumentId:'EURUSD',timeframe:null,occurredAt:now,context:market(1.1)},ids});
    expect(synthetic.snapshot.nodes.find((node)=>node.graphNodeId==='manual-node')?.state).toBe('WATCHING');
    expect(synthetic.traces).toHaveLength(0);
    const decided=manualNodeDecision({snapshot:synthetic.snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),graphNodeId:'manual-node',decision:'CONFIRM',occurredAt:now,ids});
    expect(decided.snapshot.nodes.find((node)=>node.graphNodeId==='manual-node')?.state).toBe('CONFIRMED');
    expect(decided.snapshot.nodes.find((node)=>node.graphNodeId==='manual-action')?.state).toBe('WATCHING');
    expect(decided.traces.some((entry)=>entry.eventType==='MANUAL_CONFIRM' && entry.details.source==='USER_MANUAL')).toBe(true);
  });


  it('supports explicit REJECT and SKIP manual decisions with distinct cascade semantics',()=>{
    const {version}=createStrategyDefinitionWithInitialVersion({definitionId:strategyDefinitionId('sd-manual-alt'),versionId:strategyVersionId('sv-manual-alt'),name:'Manual Alt',category:'CONTEXT',description:'',automationCapability:'MANUAL',deploymentStatus:'EXPERIMENTAL',detector:null,createdAt:now});
    const manual={...defaultNode({id:strategyGraphNodeId('manual-alt-node'),family:'STRATEGY',label:'Manual Alt',x:0,y:0}),strategyVersionId:version.id,executionMode:'CONFIRM' as const,parameters:{}};
    const action={...defaultNode({id:strategyGraphNodeId('manual-alt-action'),family:'ACTION',label:'Notify',x:200,y:0}),actionKey:'notify'};
    const map=createStrategyMapWithInitialVersion({mapId:strategyMapId('m-manual-alt'),versionId:strategyMapVersionId('mv-manual-alt'),kind:'STRATEGY_MAP',name:'Manual Alt Map',graph:{nodes:[manual,action],edges:[{id:strategyGraphEdgeId('e-manual-alt'),sourceNodeId:manual.id,targetNodeId:action.id,sourcePort:'out',targetPort:'in'}]},createdAt:now});
    const strategies=new Map([[version.id,version]]);

    const rejectedStart=createRuntime({runtimeId:strategyRuntimeId('rt-manual-reject'),colonyId:'colony',mapVersion:map.version,mode:'OBSERVE',startedAt:now,ids});
    const rejected=manualNodeDecision({snapshot:rejectedStart,mapVersion:map.version,strategies,graphNodeId:'manual-alt-node',decision:'REJECT',occurredAt:now,ids});
    expect(rejected.snapshot.nodes.find((node)=>node.graphNodeId==='manual-alt-node')?.state).toBe('FAILED');
    expect(rejected.snapshot.nodes.find((node)=>node.graphNodeId==='manual-alt-action')?.state).toBe('CANCELLED');
    expect(rejected.snapshot.runtime.status).toBe('COMPLETED');
    expect(rejected.traces.some((entry)=>entry.eventType==='MANUAL_REJECT')).toBe(true);

    const skippedStart=createRuntime({runtimeId:strategyRuntimeId('rt-manual-skip'),colonyId:'colony',mapVersion:map.version,mode:'OBSERVE',startedAt:now,ids});
    const skipped=manualNodeDecision({snapshot:skippedStart,mapVersion:map.version,strategies,graphNodeId:'manual-alt-node',decision:'SKIP',occurredAt:now,ids});
    expect(skipped.snapshot.nodes.find((node)=>node.graphNodeId==='manual-alt-node')?.state).toBe('BYPASSED');
    expect(skipped.snapshot.nodes.find((node)=>node.graphNodeId==='manual-alt-action')?.state).toBe('WATCHING');
    expect(skipped.traces.some((entry)=>entry.eventType==='MANUAL_SKIP')).toBe(true);
  });
  it('holds detector-confirmed CONFIRM nodes at TRIGGERED until a manual decision',()=>{
    const {version}=createStrategyDefinitionWithInitialVersion({definitionId:strategyDefinitionId('sd-confirm'),versionId:strategyVersionId('sv-confirm'),name:'Confirm Touch',category:'ENTRY',description:'',automationCapability:'AUTOMATABLE',deploymentStatus:'VALIDATED',detector:{key:'price_touch',version:'1',evaluationMode:'ON_PRICE_UPDATE',parameterSchema:{}},createdAt:now});
    const a={...defaultNode({id:strategyGraphNodeId('confirm-touch'),family:'STRATEGY',label:'Confirm Touch',x:0,y:0}),strategyVersionId:version.id,executionMode:'CONFIRM' as const,parameters:{level:1.1}};
    const b={...defaultNode({id:strategyGraphNodeId('confirm-action'),family:'ACTION',label:'Create Scout',x:200,y:0}),actionKey:'create_scout'};
    const map=createStrategyMapWithInitialVersion({mapId:strategyMapId('m-confirm'),versionId:strategyMapVersionId('mv-confirm'),kind:'STRATEGY_MAP',name:'Confirm Map',graph:{nodes:[a,b],edges:[{id:strategyGraphEdgeId('e-confirm'),sourceNodeId:a.id,targetNodeId:b.id,sourcePort:'out',targetPort:'in'}]},createdAt:now});
    const snapshot=createRuntime({runtimeId:strategyRuntimeId('rt-confirm'),colonyId:'colony',mapVersion:map.version,mode:'SHADOW',startedAt:now,ids});
    const detected=processRuntimeEvent({snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-confirm-detect'),type:'PRICE_UPDATE',instrumentId:'EURUSD',timeframe:'M5',occurredAt:now,context:market(1.1)},ids});
    expect(detected.snapshot.nodes.find((node)=>node.graphNodeId==='confirm-touch')?.state).toBe('TRIGGERED');
    expect(detected.snapshot.nodes.find((node)=>node.graphNodeId==='confirm-action')?.state).toBe('DORMANT');
    expect(detected.traces.filter((entry)=>entry.eventType==='MANUAL_CONFIRMATION_REQUIRED')).toHaveLength(1);
    const repeated=processRuntimeEvent({snapshot:detected.snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('ev-confirm-repeat'),type:'PRICE_UPDATE',instrumentId:'EURUSD',timeframe:'M5',occurredAt:now,context:market(1.1)},ids});
    expect(repeated.snapshot.nodes.find((node)=>node.graphNodeId==='confirm-touch')?.triggerCount).toBe(1);
    expect(repeated.traces.filter((entry)=>entry.eventType==='MANUAL_CONFIRMATION_REQUIRED')).toHaveLength(0);
    const confirmed=manualNodeDecision({snapshot:repeated.snapshot,mapVersion:map.version,strategies:new Map([[version.id,version]]),graphNodeId:'confirm-touch',decision:'CONFIRM',occurredAt:now,ids});
    expect(confirmed.snapshot.nodes.find((node)=>node.graphNodeId==='confirm-touch')?.state).toBe('CONFIRMED');
    expect(confirmed.snapshot.nodes.find((node)=>node.graphNodeId==='confirm-action')?.state).toBe('WATCHING');
  });
  it('treats duplicate transport events as no-op when repository says already processed',()=>{
    const map=createStrategyMapWithInitialVersion({mapId:strategyMapId('m2'),versionId:strategyMapVersionId('mv2'),kind:'STRATEGY_MAP',name:'Map',graph:{nodes:[],edges:[]},createdAt:now});
    const snapshot=createRuntime({runtimeId:strategyRuntimeId('rt2'),colonyId:'colony',mapVersion:map.version,mode:'OBSERVE',startedAt:now,ids});
    const value=processRuntimeEvent({snapshot,mapVersion:map.version,strategies:new Map(),detectorRegistry:createDefaultDetectorRegistry(),event:{id:runtimeEventId('dup'),type:'EVENT',instrumentId:'EURUSD',timeframe:null,occurredAt:now,context:market(1.1)},ids,alreadyProcessed:true});
    expect(value.duplicate).toBe(true); expect(value.nodeEvents).toEqual([]); expect(value.actionProposals).toEqual([]);
  });
});
