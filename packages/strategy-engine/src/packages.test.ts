import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  STRATEGY_PACKAGE_MAX_BYTES,
  parseStrategyPackageText,
  reconstructPackageGraph,
  semanticVersionSatisfies,
  validatePackageTrust,
  withPackageChecksum,
  type StrategyPackageManifest,
} from './packages';

function base(overrides: Partial<Omit<StrategyPackageManifest,'integrity'>> = {}): Omit<StrategyPackageManifest,'integrity'> {
  return {
    schemaVersion:1, packageType:'STRATEGY', packageId:'external.price-touch', name:'Price Touch Notification',
    description:'Observe a trusted price touch and notify without broker execution.', version:'1.0.0', createdAt:'2026-09-14T12:00:00.000Z',
    author:{name:'External Author',source:'Published ARISE package specification',url:null}, minimumAriseVersion:'1.0.0-beta.2',
    capabilityRequirements:['strategy-graph','observe'], dependencies:{detectors:[{id:'price_touch',versionRange:'>=1.0.0',required:true}],strategies:[],combos:[]},
    parameters:[{key:'level',label:'Price level',description:'Observed price.',type:'PRICE',defaultValue:1.1,minimum:0,maximum:null,allowedValues:[],required:true,unit:'price',scope:'LOCAL',access:'USER_EDITABLE'}],
    graph:{nodes:[
      {id:'touch',family:'STRATEGY',label:'Price Touch',position:{x:0,y:0},timeframe:'M5',purposes:['ENTRY'],importance:'REQUIRED',executionMode:'OBSERVE',strategyRef:{packageId:'external.price-touch',versionRange:'1.0.0'},parameters:{level:1.1}},
      {id:'notify',family:'ACTION',label:'Notify',position:{x:220,y:0},timeframe:'M5',purposes:['ENTRY'],importance:'REQUIRED',executionMode:'OBSERVE',actionKey:'notify',parameters:{}},
    ],edges:[{id:'touch-notify',sourceNodeId:'touch',targetNodeId:'notify',sourcePort:'out',targetPort:'in'}]},
    timeframeMappings:[{timeframe:'M5',purposes:['ENTRY'],importance:'REQUIRED',mode:'AUTOMATED'}],
    evidencePolicy:{profile:'STRATEGY_EVIDENCE_ONLY',events:['CONFIRMATION'],references:['CANDLE','DECISION_TRACE','RUNTIME_NODE_EVENT']},
    deploymentRestrictions:{allowedModes:['OBSERVE'],preferredMode:'OBSERVE'},
    definition:{category:'NOTIFICATION',tags:['external','safe'],automationCapability:'AUTOMATABLE',detector:{key:'price_touch',version:'1',evaluationMode:'ON_PRICE_UPDATE'}}, template:null,
    ...overrides,
  };
}
function text(overrides: Partial<Omit<StrategyPackageManifest,'integrity'>> = {}): string { return JSON.stringify(withPackageChecksum(base(overrides))); }

describe('strategy package schema and security', () => {
  it.each(['price-touch-notification.arise-strategy','minimal-observe-combo.arise-combo','minimal-observe-template.arise-template'])('accepts published external example %s', (filename) => {
    const source=readFileSync(new URL(`../../../examples/strategy-packages/${filename}`,import.meta.url),'utf8');
    expect(parseStrategyPackageText(source).name).toBeTruthy();
  });
  it('parses a checksummed data-only strategy and reconstructs its canonical graph', () => {
    const parsed = parseStrategyPackageText(text());
    expect(parsed.integrity.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(reconstructPackageGraph(parsed.graph!, ()=>'strategy-version').nodes).toHaveLength(2);
  });
  it('supports deterministic semver ranges', () => {
    expect(semanticVersionSatisfies('1.2.3','>=1.0.0')).toBe(true);
    expect(semanticVersionSatisfies('1.2.3','^1.1.0')).toBe(true);
    expect(semanticVersionSatisfies('1.3.0','~1.2.0')).toBe(false);
  });
  it.each([
    ['malformed JSON','{'],
    ['unsupported schema',JSON.stringify({...withPackageChecksum(base()),schemaVersion:2})],
    ['missing field',JSON.stringify((({name:_name,...rest})=>rest)(withPackageChecksum(base())))],
    ['unknown package type',JSON.stringify({...withPackageChecksum(base()),packageType:'SCRIPT'})],
    ['unknown node type',JSON.stringify(withPackageChecksum({...base(),graph:{...base().graph!,nodes:[{...base().graph!.nodes[0]!,family:'SCRIPT'} as never]}}))],
    ['invalid enum',JSON.stringify(withPackageChecksum({...base(),timeframeMappings:[{...base().timeframeMappings[0]!,importance:'MANDATORY'} as never]}))],
    ['invalid parameter type',JSON.stringify(withPackageChecksum({...base(),parameters:[{...base().parameters[0]!,type:'SOURCE_CODE'} as never]}))],
    ['checksum mismatch',JSON.stringify({...withPackageChecksum(base()),description:'modified'})],
    ['code payload',JSON.stringify({...withPackageChecksum(base()),javascript:'eval("x")'})],
    ['path traversal',text({description:'../../escape'})],
    ['external file reference',text({description:'C:\\Windows\\System32\\drivers\\etc\\hosts'})],
    ['LIVE request',JSON.stringify({...withPackageChecksum(base()),deploymentRestrictions:{allowedModes:['LIVE'],preferredMode:'LIVE'}})],
  ])('rejects %s safely', (_label, payload) => expect(()=>parseStrategyPackageText(payload)).toThrow());
  it('rejects oversized and deeply nested input before interpretation', () => {
    expect(()=>parseStrategyPackageText(' '.repeat(STRATEGY_PACKAGE_MAX_BYTES+1))).toThrow(/exceeds/);
    expect(()=>parseStrategyPackageText(`${'['.repeat(40)}0${']'.repeat(40)}`)).toThrow(/nesting/);
  });
  it('rejects duplicate nodes, dangling edges, cycles, invalid parameters and unsupported actions', () => {
    const manifest=withPackageChecksum(base());
    const duplicate={...manifest,graph:{...manifest.graph!,nodes:[...manifest.graph!.nodes,manifest.graph!.nodes[0]!]}};
    expect(()=>parseStrategyPackageText(JSON.stringify(withPackageChecksum((({integrity:_i,...rest})=>rest)(duplicate))))).toThrow(/duplicate graph node/i);
    const dangling={...base(),graph:{...base().graph!,edges:[{id:'bad',sourceNodeId:'touch',targetNodeId:'missing',sourcePort:'out',targetPort:'in'}]}};
    expect(()=>parseStrategyPackageText(JSON.stringify(withPackageChecksum(dangling)))).toThrow(/dangling/i);
    const cycle={...base(),graph:{...base().graph!,edges:[...base().graph!.edges,{id:'back',sourceNodeId:'notify',targetNodeId:'touch',sourcePort:'out',targetPort:'in'}]}};
    expect(()=>parseStrategyPackageText(JSON.stringify(withPackageChecksum(cycle)))).toThrow(/cycles/i);
    expect(()=>parseStrategyPackageText(text({parameters:[{...base().parameters[0]!,type:'BOOLEAN'}]}))).toThrow(/must be boolean/i);
    const unsupported=parseStrategyPackageText(text({graph:{...base().graph!,nodes:base().graph!.nodes.map((node)=>node.family==='ACTION'?{...node,actionKey:'run_shell'}:node)}}));
    expect(()=>validatePackageTrust(unsupported,{ariseVersion:'1.0.0-beta.2',detectors:new Map([['price_touch','1']]),capabilities:new Set(['strategy-graph','observe']),actions:new Set(['notify']),modifiers:new Set(),marketObjectConditions:new Set(),states:new Set()})).toThrow(/unsupported action/i);
  });
});
