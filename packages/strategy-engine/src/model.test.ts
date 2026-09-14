import { describe, expect, it } from 'vitest';
import {
  createStrategyDefinitionWithInitialVersion,
  createStrategyMapWithInitialVersion,
  defaultNode,
  executionModeSupported,
  reviseStrategyDefinition,
  simpleSequence,
  strategyDefinitionId,
  strategyGraphEdgeId,
  strategyGraphNodeId,
  strategyMapId,
  strategyMapVersionId,
  strategyVersionId,
  validateLogicGraph,
} from './model';

const now = '2026-09-11T12:00:00.000Z';

describe('Strategy Encyclopedia', () => {
  it('creates immutable strategy versions and successors', () => {
    const initial = createStrategyDefinitionWithInitialVersion({
      definitionId: strategyDefinitionId('strategy-1'), versionId: strategyVersionId('strategy-v1'), name: 'Liquidity Sweep', category: 'LIQUIDITY',
      description: 'Sweep prior external liquidity.', tags: ['liquidity'], automationCapability: 'DETECTABLE',
      detector: { key: 'liquidity_sweep', version: '1', evaluationMode: 'ON_BAR_CLOSE', parameterSchema: { minWickPips: { type: 'number' } } }, createdAt: now,
    });
    const next = reviseStrategyDefinition(initial.definition, initial.version, { id: strategyVersionId('strategy-v2'), description: 'Revised.', createdAt: '2026-09-11T12:01:00.000Z' });
    expect(initial.version.versionNo).toBe(1);
    expect(next.version.versionNo).toBe(2);
    expect(next.version.supersedesStrategyVersionId).toBe(initial.version.id);
    expect(initial.version.description).not.toBe(next.version.description);
    expect(Object.isFrozen(initial.version)).toBe(true);
  });

  it('requires detector contracts for automatable strategies', () => {
    expect(() => createStrategyDefinitionWithInitialVersion({ definitionId: strategyDefinitionId('s'), versionId: strategyVersionId('sv'), name: 'X', category: 'X', description: '', automationCapability: 'AUTOMATABLE', detector: null, createdAt: now })).toThrow(/detector/i);
    expect(executionModeSupported('DETECTABLE', 'AUTO')).toBe(false);
    expect(executionModeSupported('AUTOMATABLE', 'AUTO')).toBe(true);
  });
});

describe('LogicGraph', () => {
  const a = { ...defaultNode({ id: strategyGraphNodeId('a'), family: 'STATE', label: 'Thesis Active', x: 0, y: 0 }), executionMode: 'OBSERVE' as const };
  const b = defaultNode({ id: strategyGraphNodeId('b'), family: 'LOGIC', label: 'THEN', x: 200, y: 0 });
  const c = defaultNode({ id: strategyGraphNodeId('c'), family: 'ACTION', label: 'Notify', x: 400, y: 0 });
  const edges = [
    { id: strategyGraphEdgeId('e1'), sourceNodeId: a.id, targetNodeId: b.id, sourcePort: 'out', targetPort: 'in' },
    { id: strategyGraphEdgeId('e2'), sourceNodeId: b.id, targetNodeId: c.id, sourcePort: 'out', targetPort: 'in' },
  ];

  it('accepts an acyclic graph and exposes the same linear model to Simple mode', () => {
    const graph = validateLogicGraph({ nodes: [a,b,c], edges });
    expect(simpleSequence(graph)).toEqual(['a','b','c']);
    const map = createStrategyMapWithInitialVersion({ mapId: strategyMapId('map-1'), versionId: strategyMapVersionId('map-v1'), kind: 'STRATEGY_MAP', name: 'D to M5', graph, createdAt: now });
    expect(map.version.graph.nodes).toHaveLength(3);
  });

  it('rejects cycles and branching from Simple mode', () => {
    expect(() => validateLogicGraph({ nodes: [a,b,c], edges: [...edges, { id: strategyGraphEdgeId('e3'), sourceNodeId: c.id, targetNodeId: a.id, sourcePort: 'out', targetPort: 'in' }] })).toThrow(/cycle/i);
    const branch = validateLogicGraph({ nodes: [a,b,c], edges: [edges[0]!, { id: strategyGraphEdgeId('e3'), sourceNodeId: a.id, targetNodeId: c.id, sourcePort: 'out', targetPort: 'in' }] });
    expect(simpleSequence(branch)).toBeNull();
  });
});
