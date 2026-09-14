import { describe, expect, it } from 'vitest';
import { analyzeColony, analyzePosition, buildEquityCurve, buildPerformanceCurve, groupPerformance, presentMoney, type PositionAnalyticsInput } from './index';

const at = '2026-09-12T10:00:00.000Z';
function position(overrides: Partial<PositionAnalyticsInput> = {}): PositionAnalyticsInput {
  return {
    positionId: 'position-1', tradeId: 'trade-1', originalColonyId: 'colony-1', currentColonyId: 'colony-1', direction: 'LONG', pipSize: .0001,
    entryFills: [{ id: 'entry-1', quantity: .3, price: 1.1, occurredAt: at, money: null }, { id: 'entry-2', quantity: .2, price: 1.101, occurredAt: at, money: null }],
    exitFills: [{ id: 'exit-1', quantity: .2, price: 1.102, occurredAt: '2026-09-12T11:00:00.000Z', money: 32 }],
    currentQuantity: .3, mark: { price: 1.103, occurredAt: '2026-09-12T12:00:00.000Z', money: 78 },
    protection: { verifiedStop: 1.101, protectedQuantity: .3, occurredAt: '2026-09-12T11:30:00.000Z' },
    lifecycle: [{ state: 'SURVIVOR', occurredAt: '2026-09-12T10:30:00.000Z' }, { state: 'LEG', occurredAt: '2026-09-12T11:00:00.000Z' }],
    currentState: 'LEG', openedAt: at, closedAt: null,
    dimensions: { timeframes: ['M5'], strategies: ['Sweep v1'], combos: [], templates: ['London Entry v1'], tags: ['liquidity'], session: 'LONDON', qualification: 'AUTOMATICALLY_QUALIFIED' },
    ideaVersionId: 'idea-v1', strategyMapVersionId: 'map-v1', ...overrides,
  };
}

describe('M12 pip-first analytics', () => {
  it('uses weighted partial fills and partial closes without quantity drift', () => {
    const result = analyzePosition(position());
    expect(result.entryPrice).toMatchObject({ status: 'AVAILABLE', value: 1.1004 });
    expect(result.realizedPips.status).toBe('AVAILABLE');
    expect(result.realizedPips.value).toBeCloseTo(16);
    expect(result.openPips.value).toBeCloseTo(26);
    expect(result.positionPips.value).toBeCloseTo(11);
    expect(result.protectedPips.value).toBeCloseTo(6);
  });

  it('marks a partial-close mismatch unavailable instead of repairing it', () => {
    const result = analyzePosition(position({ currentQuantity: .4 }));
    expect(result.realizedPips).toMatchObject({ status: 'UNAVAILABLE', value: null });
    expect(result.positionPips).toMatchObject({ status: 'UNAVAILABLE', value: null });
  });

  it('distinguishes a missing mark, exit, protection, and money from zero', () => {
    const open = analyzePosition(position({ mark: null, protection: null }));
    expect(open.openPips.status).toBe('UNAVAILABLE');
    expect(open.protectedPips.status).toBe('UNAVAILABLE');
    const terminal = analyzePosition(position({ exitFills: [], currentQuantity: 0, currentState: 'CLOSED', closedAt: '2026-09-12T12:00:00.000Z', mark: null }));
    expect(terminal.realizedPips.status).toBe('UNAVAILABLE');
    expect(terminal.openPips).toMatchObject({ status: 'AVAILABLE', value: 0 });
    expect(terminal.totalMoney.status).toBe('UNAVAILABLE');
  });

  it('aggregates multiple Scouts without losing individual outcomes', () => {
    const loser = analyzePosition(position({ positionId: 'loser', entryFills: [{ id: 'e-l', quantity: .1, price: 1.1, occurredAt: at, money: null }], exitFills: [{ id: 'x-l', quantity: .1, price: 1.099, occurredAt: at, money: -10 }], currentQuantity: 0, mark: null, protection: null, lifecycle: [], currentState: 'FAILED', closedAt: at }));
    const winner = analyzePosition(position({ positionId: 'runner', entryFills: [{ id: 'e-r', quantity: .1, price: 1.1, occurredAt: at, money: null }], exitFills: [{ id: 'x-r', quantity: .1, price: 1.11, occurredAt: at, money: 100 }], currentQuantity: 0, mark: null, protection: null, lifecycle: [{state:'SURVIVOR',occurredAt:at},{state:'LEG',occurredAt:at},{state:'RUNNER',occurredAt:at}], currentState: 'CLOSED', closedAt: at }));
    const colony = analyzeColony({ colonyId: 'colony-1', attempts: [{attemptId:'a1',result:'FAILED',pipCost:10},{attemptId:'a2',result:'SURVIVED',pipCost:0}], positions: [loser, winner] });
    expect(colony).toMatchObject({ wins: 1, losses: 1, breakevens: 0, positionCount: 2 });
    expect(colony.scoutingCost.value).toBe(10);
    expect(colony.survivorContribution.value).toBeCloseTo(10);
    expect(colony.millipedeEfficiency.value).toBeCloseTo(1);
  });

  it('keeps win rate secondary and reports incomplete terminal outcomes', () => {
    const incomplete = analyzePosition(position({ exitFills: [], currentQuantity: 0, mark: null, protection: null, currentState: 'CLOSED', closedAt: at }));
    const colony = analyzeColony({ colonyId: 'colony-1', attempts: [], positions: [incomplete] });
    expect(colony).toMatchObject({ wins: 0, losses: 0, breakevens: 0, incompleteOutcomes: 1 });
    expect(colony.realizedPips.status).toBe('UNAVAILABLE');
  });

  it('does not turn a missing failed-Scout cost into zero', () => {
    const colony = analyzeColony({ colonyId: 'colony-1', attempts: [{attemptId:'a1',result:'FAILED',pipCost:null}], positions: [] });
    expect(colony.scoutingCost.status).toBe('UNAVAILABLE');
    expect(colony.millipedeEfficiency.status).toBe('UNAVAILABLE');
  });

  it('returns deliberate zero-trade counts and unavailable ratios', () => {
    const colony = analyzeColony({ colonyId: 'empty', attempts: [], positions: [] });
    expect(colony).toMatchObject({ positionCount: 0, attemptCount: 0, wins: 0, losses: 0, breakevens: 0 });
    expect(colony.realizedPips).toMatchObject({ status: 'AVAILABLE', value: 0 });
    expect(colony.averageScoutLoss.status).toBe('UNAVAILABLE');
    expect(colony.millipedeEfficiency.status).toBe('UNAVAILABLE');
  });

  it('groups exact dimensions and reports unsupported sessions separately', () => {
    const known = analyzePosition(position());
    const unknown = analyzePosition(position({ positionId:'p2', dimensions: { ...position().dimensions, session: null } }));
    expect(groupPerformance([known, unknown], 'SESSION')).toMatchObject({ unavailableCount: 1, groups: [{ key: 'LONDON', positions: 1 }] });
    expect(groupPerformance([known], 'TIMEFRAME').groups[0]?.key).toBe('M5');
    expect(groupPerformance([known], 'QUALIFICATION').groups[0]?.key).toBe('AUTOMATICALLY_QUALIFIED');
    const combo = analyzePosition(position({ positionId:'combo', dimensions: { ...position().dimensions, combos:['Sweep Combo v3'], templates:[] } }));
    expect(groupPerformance([combo], 'COMBO').groups[0]?.key).toBe('Sweep Combo v3');
  });

  it('builds pips, position-pips, and money curves from immutable exits', () => {
    const curve = buildPerformanceCurve([position({ currentQuantity: .3 })]);
    expect(curve).toHaveLength(1);
    expect(curve[0]).toMatchObject({ positionId: 'position-1', money: 32 });
    expect(curve[0]?.pips).toBeCloseTo(16);
    expect(curve[0]?.positionPips).toBeCloseTo(3.2);
  });

  it('builds equity from marks and leaves gaps when an open Position is unmarked', () => {
    const marked=position({marks:[{price:1.103,occurredAt:'2026-09-12T12:00:00.000Z',money:78}]});
    const equity=buildEquityCurve([marked]);
    expect(equity.at(-1)).toMatchObject({money:110});
    const gap=buildEquityCurve([marked,position({positionId:'unmarked',exitFills:[],currentQuantity:.5,mark:null,marks:[]})]);
    expect(gap.at(-1)).toMatchObject({pips:null,positionPips:null,money:null});
  });

  it('globally hides money without deleting its raw value', () => {
    const result = analyzePosition(position());
    expect(result.totalMoney).toMatchObject({ status: 'AVAILABLE', value: 110 });
    expect(presentMoney(result.totalMoney, '$ HIDDEN')).toEqual({ state: 'HIDDEN', value: null, reason: 'Money is hidden by the global presentation preference.' });
    expect(presentMoney(result.totalMoney, 'MONEY-FIRST')).toMatchObject({ state: 'VISIBLE', value: 110 });
  });

  it('preserves promoted/consolidated origin and current Colony lineage', () => {
    const result = analyzePosition(position({ originalColonyId: 'source', currentColonyId: 'target', currentState: 'CONSOLIDATED' }));
    expect(result).toMatchObject({ originalColonyId: 'source', currentColonyId: 'target' });
  });
});
