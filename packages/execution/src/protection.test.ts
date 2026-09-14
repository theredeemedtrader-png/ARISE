import { describe, expect, it } from 'vitest';
import {
  calculateProtectionAction,
  durableProtectionIdempotencyKey,
  evaluateColonyAutomation,
  isProtectionWorsening,
  mostProtectiveStop,
  nextTargetProgress,
  protectionStateForQuantities,
  resolveProtectionProposals,
  selectProtectionScope,
  thesisInvalidationOutcome,
  trueBreakEvenPrice,
  validateProtectionProposal,
  weightedEntryPrice,
  type BrokerProtectionContext,
  type ProtectionPositionFact,
  type ProtectionProposal,
} from './protection';

const position = (overrides: Partial<ProtectionPositionFact> = {}): ProtectionPositionFact => ({
  positionId: 'position-1', brokerPositionKey: 'broker-1', colonyId: 'colony-1', source: 'ARISE_AUTO',
  direction: 'LONG', state: 'SCOUT', protectionState: 'UNPROTECTED', actualVolume: 0.6,
  currentStop: 1.09, currentTakeProfit: null, tags: ['core'], fills: [{ volume: 0.2, price: 1.1, costMoney: 1 }, { volume: 0.4, price: 1.102, costMoney: 2 }], ...overrides,
});
const proposal = (overrides: Partial<ProtectionProposal> = {}): ProtectionProposal => ({
  proposalId: 'proposal-1', ruleVersionId: 'rule-v1', triggerEventId: 'trigger-1', positionId: 'position-1',
  brokerPositionKey: 'broker-1', action: 'MOVE_TO_PRICE_BE', requestedStop: 1.1, requestedTakeProfit: null,
  requestedCloseVolume: null, convertToRunner: false, sequence: 1, createdAt: '2026-09-11T12:00:00.000Z', ...overrides,
});
const broker = (overrides: Partial<BrokerProtectionContext> = {}): BrokerProtectionContext => ({
  truth: 'VERIFIED', connection: 'CONNECTED', reconciliation: 'MATCHED', protocolCompatible: true,
  terminalConnected: true, accountMatches: true, accountIsLive: false, sessionMatches: true, quoteFresh: true,
  bid: 1.11, ask: 1.1102, tickSize: 0.0001, pipSize: 0.0001, stopsLevel: 10, freezeLevel: 5, ...overrides,
  minVolume: 0.01, volumeStep: 0.01,
});

describe('M11 protection calculations and safety', () => {
  it('calculates every management action explicitly from broker/fill facts', () => {
    const base = { direction: 'LONG' as const, fills: position().fills, actualVolume: 0.6, executablePrice: 1.11, pipSize: 0.0001, moneyPerPriceUnitPerLot: 100_000 };
    const cases = [
      ['MOVE_TO_PRICE_BE', {}], ['MOVE_TO_TRUE_BE', {}], ['BE_PLUS_OFFSET', { offsetPips: 2 }],
      ['LOCK_PIPS', { lockPips: 5 }], ['LOCK_MONEY', { lockMoney: 30 }],
      ['LOCK_PERCENT_OPEN_PROFIT', { openProfitPercent: 50 }], ['MOVE_TO_PRICE', { explicitPrice: 1.1 }],
      ['MOVE_TO_MARKET_OBJECT', { marketObjectPrice: 1.1 }], ['TRAIL_FIXED_DISTANCE', { trailDistancePips: 10 }],
      ['TRAIL_MARKET_OBJECT', { marketObjectPrice: 1.1 }], ['TRAIL_STRUCTURE', { structurePrice: 1.1 }],
    ] as const;
    for (const [action, config] of cases)
      expect(calculateProtectionAction({ ...base, action, ...config }).requestedStop).not.toBeNull();
    expect(calculateProtectionAction({ ...base, action: 'PARTIAL_CLOSE', partialClosePercent: 50 }).requestedCloseVolume).toBeCloseTo(0.3);
    expect(calculateProtectionAction({ ...base, action: 'FULL_CLOSE' }).requestedCloseVolume).toBe(0.6);
    expect(calculateProtectionAction({ ...base, action: 'REMOVE_TP' }).requestedTakeProfit).toBeNull();
    expect(calculateProtectionAction({ ...base, action: 'SET_TP', takeProfitPrice: 1.2 }).requestedTakeProfit).toBe(1.2);
    expect(calculateProtectionAction({ ...base, action: 'CONVERT_TO_RUNNER' }).convertToRunner).toBe(true);
  });
  it('uses actual partial fills for price and true economic BE without adding spread twice', () => {
    expect(weightedEntryPrice(position().fills)).toBeCloseTo(1.1013333333);
    expect(trueBreakEvenPrice({ direction: 'LONG', fills: position().fills, moneyPerPriceUnitPerLot: 100_000, estimatedExitCostMoney: 1 })).toBeCloseTo(1.1014);
    expect(trueBreakEvenPrice({ direction: 'SHORT', fills: position().fills, moneyPerPriceUnitPerLot: 100_000, estimatedExitCostMoney: 1 })).toBeCloseTo(1.1012666667);
  });

  it('tracks protection independently against actual broker quantity', () => {
    expect(protectionStateForQuantities(0.6, 0)).toBe('UNPROTECTED');
    expect(protectionStateForQuantities(0.6, 0.2)).toBe('PARTIALLY_PROTECTED');
    expect(protectionStateForQuantities(0.4, 0.4)).toBe('PROTECTED');
    expect(protectionStateForQuantities(0.4, 0.4, true)).toBe('PROTECTION_ERROR');
  });

  it('defaults to the most protective stop and identifies worsening in both directions', () => {
    expect(mostProtectiveStop('LONG', [1.09, 1.1, 1.095])).toBe(1.1);
    expect(mostProtectiveStop('SHORT', [1.11, 1.1, 1.105])).toBe(1.1);
    expect(isProtectionWorsening('LONG', 1.1, 1.099)).toBe(true);
    expect(isProtectionWorsening('SHORT', 1.1, 1.101)).toBe(true);
  });

  it('resolves full close over every other action and stop conflicts protectively', () => {
    const stops = resolveProtectionProposals(position(), [proposal(), proposal({ proposalId: 'p2', requestedStop: 1.105, sequence: 2 })]);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.requestedStop).toBe(1.105);
    const closed = resolveProtectionProposals(position(), [proposal(), proposal({ proposalId: 'close', action: 'FULL_CLOSE', requestedStop: null, sequence: 3 })]);
    expect(closed.map((item) => item.action)).toEqual(['FULL_CLOSE']);
  });

  it('excludes manual and external positions from every Colony automation scope', () => {
    const positions = [position(), position({ positionId: 'manual', source: 'ARISE_MANUAL' }), position({ positionId: 'external', source: 'MT5_EXTERNAL' })];
    expect(selectProtectionScope({ scope: 'ALL_POSITIONS_IN_COLONY', colonyId: 'colony-1', positions }).map((item) => item.positionId)).toEqual(['position-1']);
    expect(selectProtectionScope({ scope: 'POSITIONS_MATCHING_TAG', colonyId: 'colony-1', positions, tag: 'core' })).toHaveLength(1);
  });

  it.each([
    ['UNKNOWN truth', { truth: 'UNKNOWN' as const }, 'BROKER_TRUTH_UNKNOWN'],
    ['BLOCKED session', { connection: 'BLOCKED' as const }, 'CONNECTION_NOT_HEALTHY'],
    ['incomplete reconciliation', { reconciliation: 'UNKNOWN' as const }, 'RECONCILIATION_INCOMPLETE'],
    ['protocol mismatch', { protocolCompatible: false }, 'PROTOCOL_MISMATCH'],
    ['account mismatch', { accountMatches: false }, 'ACCOUNT_MISMATCH'],
    ['live account', { accountIsLive: true }, 'LIVE_ACCOUNT_BLOCKED'],
    ['stale session', { sessionMatches: false }, 'STALE_SESSION'],
    ['stale quote', { quoteFresh: false }, 'STALE_QUOTE'],
  ])('blocks %s from broker mutation', (_name, change, reason) => {
    expect(validateProtectionProposal(position(), proposal(), broker(change)).reasons).toContain(reason);
  });

  it('validates bid/ask, stops distance, freeze level, tick alignment, and no-worsening', () => {
    const result = validateProtectionProposal(position(), proposal({ requestedStop: 1.1096 }), broker());
    expect(result.status).toBe('BLOCK');
    expect(result.reasons).toContain('STOP_INSIDE_BROKER_DISTANCE');
    expect(validateProtectionProposal(position(), proposal({ requestedStop: 1.08 }), broker()).reasons).toContain('PROTECTION_WORSENING');
    expect(validateProtectionProposal(position({ direction: 'SHORT', currentStop: 1.12 }), proposal({ requestedStop: 1.11131 }), broker()).normalizedStop).toBeCloseTo(1.1113);
  });

  it('reconciles partial-close quantity against broker reality and uses actual quantity for full close', () => {
    expect(validateProtectionProposal(position({ actualVolume: 0.4 }), proposal({ action: 'PARTIAL_CLOSE', requestedStop: null, requestedCloseVolume: 0.5 }), broker()).reasons).toContain('CLOSE_QUANTITY_EXCEEDS_BROKER_REALITY');
    expect(validateProtectionProposal(position({ actualVolume: 0.4 }), proposal({ action: 'FULL_CLOSE', requestedStop: null }), broker()).closeVolume).toBe(0.4);
    expect(validateProtectionProposal(position({ actualVolume: 0.4 }), proposal({ action: 'PARTIAL_CLOSE', requestedStop: null, requestedCloseVolume: 0.005 }), broker()).reasons).toContain('CLOSE_QUANTITY_INVALID_FOR_BROKER');
  });

  it('derives stable durable identities for retries', () => {
    const input = { ruleVersionId: 'r1', triggerEventId: 't1', brokerPositionKey: 'b1', action: 'MOVE_TO_TRUE_BE' as const, sequence: 2 };
    expect(durableProtectionIdempotencyKey(input)).toBe(durableProtectionIdempotencyKey(input));
  });
});

describe('M11 Colony, Target, and invalidation automation', () => {
  const eligible = { thesisValid: true, countertrend: false, mode: 'ANY_VALID_ENTRY' as const, manualApproved: false, hasSurvivor: false, hasProtected: false, hasLeg: false, attemptsUsed: 1, maxAttempts: 3, scoutingLossPips: 5, maxScoutingLossPips: 20, activeExposure: 1, maxConcurrentExposure: 3, cooldownUntil: null, evaluatedAt: '2026-09-11T12:00:00.000Z' };
  it.each([
    ['ANY_VALID_ENTRY', {}, true],
    ['ONLY_AFTER_SURVIVOR', { mode: 'ONLY_AFTER_SURVIVOR', hasSurvivor: true }, true],
    ['ONLY_AFTER_PROTECTED', { mode: 'ONLY_AFTER_PROTECTED', hasProtected: true }, true],
    ['ONLY_AFTER_LEG', { mode: 'ONLY_AFTER_LEG', hasLeg: true }, true],
    ['MANUAL', { mode: 'MANUAL', manualApproved: true }, true],
  ])('handles repeated valid signals under %s', (_name, overrides, expected) => {
    expect(evaluateColonyAutomation({ ...eligible, ...overrides } as typeof eligible).eligible).toBe(expected);
  });
  it('enforces budget, scouting-cost, exposure, cooldown, invalidation, and countertrend gates', () => {
    expect(evaluateColonyAutomation({ ...eligible, thesisValid: false, countertrend: true, attemptsUsed: 3, scoutingLossPips: 20, activeExposure: 3, cooldownUntil: '2026-09-11T13:00:00.000Z' }).reasons).toEqual([
      'THESIS_INVALIDATED','COUNTERTREND_DISABLED','ATTEMPT_BUDGET_EXHAUSTED','SCOUTING_COST_CAP_REACHED','CONCURRENT_EXPOSURE_CAP_REACHED','COOLDOWN_ACTIVE',
    ]);
  });
  it('treats a failed Scout as budget cost, not implicit thesis invalidation', () => {
    const result = evaluateColonyAutomation({ ...eligible, attemptsUsed: 2, scoutingLossPips: 10, thesisValid: true });
    expect(result.eligible).toBe(true);
    expect(result.reasons).not.toContain('THESIS_INVALIDATED');
  });
  it('defaults thesis invalidation to a manual decision while always disarming entry', () => {
    expect(thesisInvalidationOutcome()).toEqual({ disarmEntries: true, positionAction: null, manualDecisionRequired: true });
    expect(thesisInvalidationOutcome('CLOSE_ALL').positionAction).toBe('FULL_CLOSE');
  });
  it.each([
    ['KEEP_MANAGING', null, false],
    ['TIGHTEN', 'TRAIL_STRUCTURE', false],
    ['MOVE_TO_PROTECTION', 'MOVE_TO_TRUE_BE', false],
    ['CLOSE_ALL', 'FULL_CLOSE', false],
    ['MANUAL_DECISION', null, true],
  ] as const)('makes %s thesis-invalidation behavior explicit', (policy, action, manual) => {
    expect(thesisInvalidationOutcome(policy)).toEqual({ disarmEntries: true, positionAction: action, manualDecisionRequired: manual });
  });
  it('keeps Target approaching, reached, and hit distinct and terminal', () => {
    expect(nextTargetProgress({ current: 'ACTIVE', direction: 'LONG', executablePrice: 1.19, targetPrice: 1.2, approachingDistance: 0.02 })).toBe('APPROACHING');
    expect(nextTargetProgress({ current: 'APPROACHING', direction: 'LONG', executablePrice: 1.2, targetPrice: 1.2, approachingDistance: 0.02 })).toBe('REACHED');
    expect(nextTargetProgress({ current: 'REACHED', direction: 'LONG', executablePrice: 1.201, targetPrice: 1.2, approachingDistance: 0.02, candleClosedBeyond: true })).toBe('HIT');
    expect(nextTargetProgress({ current: 'HIT', direction: 'LONG', executablePrice: 1.1, targetPrice: 1.2, approachingDistance: 0.02 })).toBe('HIT');
  });
});
