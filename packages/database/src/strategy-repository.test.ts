import { describe, expect, it } from 'vitest';
import {
  strategyDefinitionId,
  strategyGraphEdgeId,
  strategyGraphNodeId,
  strategyMapId,
  strategyMapVersionId,
  strategyVersionId,
  type LogicGraph,
} from '@arise/strategy-engine';
import { openDatabase } from './database';
import { StrategyRepository } from './strategy-repository';

const now = '2026-09-11T12:00:00.000Z';

function graph(strategyVersion: string): LogicGraph {
  return {
    nodes: [
      { id: strategyGraphNodeId('node-strategy'), family:'STRATEGY', label:'Liquidity Sweep', position:{x:10,y:20}, timeframe:'D', purposes:['HINDSIGHT'], importance:'REQUIRED', executionMode:'CONFIRM', strategyVersionId: strategyVersionId(strategyVersion), parameters:{} },
      { id: strategyGraphNodeId('node-action'), family:'ACTION', label:'Notify', position:{x:260,y:20}, timeframe:'M5', purposes:['ENTRY'], importance:'REQUIRED', executionMode:'NOTIFY', actionKey:'notify', parameters:{} },
    ],
    edges: [{ id: strategyGraphEdgeId('edge-1'), sourceNodeId: strategyGraphNodeId('node-strategy'), targetNodeId: strategyGraphNodeId('node-action'), sourcePort:'out', targetPort:'in' }],
  };
}

describe('StrategyRepository', () => {
  it('persists immutable Encyclopedia and Map history', () => {
    const connection = openDatabase(':memory:');
    try {
      const repo = new StrategyRepository(connection.db);
      const first = repo.createDefinition({ definitionId: strategyDefinitionId('strategy-1'), versionId: strategyVersionId('strategy-v1'), name:'Liquidity Sweep', category:'LIQUIDITY', description:'Sweep liquidity', tags:['sweep'], automationCapability:'DETECTABLE', detector:{ key:'liquidity_sweep', version:'1', evaluationMode:'ON_BAR_CLOSE', parameterSchema:{} }, createdAt:now });
      const revised = repo.reviseDefinition(first.definition.id, { id: strategyVersionId('strategy-v2'), description:'Revised sweep', createdAt:'2026-09-11T12:01:00.000Z' });
      expect(revised.versions).toHaveLength(2);
      expect(revised.currentVersion.versionNo).toBe(2);

      const map = repo.createMap({ mapId: strategyMapId('map-1'), versionId: strategyMapVersionId('map-v1'), kind:'STRATEGY_MAP', name:'D to M5', graph:graph(revised.currentVersion.id), createdAt:'2026-09-11T12:02:00.000Z' });
      const saved = repo.reviseMap(map.map.id, { id: strategyMapVersionId('map-v2'), graph: map.currentVersion.graph, createdAt:'2026-09-11T12:03:00.000Z' });
      expect(saved.versions).toHaveLength(2);
      expect(saved.currentVersion.graph.edges).toHaveLength(1);

      expect(() => connection.sqlite.exec("UPDATE strategy_versions SET description='bad' WHERE id='strategy-v1'")).toThrow('immutable');
      expect(() => connection.sqlite.exec("DELETE FROM strategy_map_versions WHERE id='map-v1'")).toThrow('immutable');
    } finally { connection.sqlite.close(); }
  });
});
