import { describe, expect, it } from 'vitest';
import {
  createExecutionIntent,
  createOrderPlan,
  validateExecution,
  type ExecutionHealth,
} from './model';
const at = '2026-09-11T12:00:00.000Z';
const intent = (mode: 'SHADOW' | 'DEMO') =>
  createExecutionIntent({
    id: `intent-${mode}`,
    proposalCorrelationId: 'proposal-1',
    strategyRuntimeId: 'runtime-1',
    runtimeNodeId: 'node-1',
    colonyId: 'colony-1',
    ideaVersionId: 'idea-version-1',
    strategyMapVersionId: 'map-version-1',
    mode,
    canonicalSymbol: 'EURUSD',
    direction: 'LONG',
    gearId: 'gear-1',
    lots: 0.1,
    initialStop: 1.09,
    maxSpreadPips: 2,
    createdAt: at,
    expiresAt: '2026-09-11T12:01:00.000Z',
  });
const healthy: ExecutionHealth = {
  connection: 'CONNECTED',
  truth: 'VERIFIED',
  reconciliation: 'MATCHED',
  terminalConnected: true,
  protocolCompatible: true,
  accountKey: 'demo-1',
  accountIsLive: false,
  sessionId: 'session-1',
  brokerSymbol: 'EURUSD.a',
  quote: { bid: 1.1, ask: 1.1002, receivedAt: at, sequence: 4 },
  deploymentApproved: true,
  colonyActive: true,
  ideaActive: true,
  attemptBudgetAvailable: true,
  stackingEligible: true,
  riskFresh: true,
  sessionPermitted: true,
  newsPermitted: true,
  spreadPermitted: true,
  instrumentPermitted: true,
  sizePermitted: true,
  stopPermitted: true,
  duplicateAbsent: true,
  executionStateSafe: true,
};
describe('M10 execution model', () => {
  it('blocks DEMO whenever broker truth is unknown', () => {
    expect(
      validateExecution(
        intent('DEMO'),
        { ...healthy, truth: 'UNKNOWN' },
        'v-1',
        at,
      ).status,
    ).toBe('BLOCK');
  });
  it('allows SHADOW to freeze a hypothetical plan without broker health', () => {
    const value = intent('SHADOW');
    const validation = validateExecution(
      value,
      {
        ...healthy,
        connection: 'BLOCKED',
        truth: 'UNKNOWN',
        reconciliation: 'UNKNOWN',
        accountKey: null,
        accountIsLive: null,
        sessionId: null,
        brokerSymbol: null,
        quote: null,
      },
      'v-2',
      at,
    );
    expect(validation.status).toBe('PASS');
    expect(
      createOrderPlan({
        id: 'plan-1',
        intent: value,
        validation,
        health: { ...healthy, quote: null },
      }).accountKey,
    ).toBeNull();
  });
  it('never accepts LIVE as an M10 intent', () =>
    expect(() =>
      createExecutionIntent({ ...intent('DEMO'), mode: 'LIVE' as 'DEMO' }),
    ).toThrow('LIVE'));
  it('blocks new DEMO exposure during unresolved recovery while SHADOW remains non-mutating', () => {
    expect(
      validateExecution(
        intent('DEMO'),
        { ...healthy, executionStateSafe: false },
        'v-3',
        at,
      ).status,
    ).toBe('BLOCK');
    expect(
      validateExecution(
        intent('SHADOW'),
        { ...healthy, executionStateSafe: false },
        'v-4',
        at,
      ).status,
    ).toBe('PASS');
  });
});
