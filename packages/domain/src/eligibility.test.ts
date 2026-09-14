import { describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT_BUDGET_REASONS,
  STACKING_MODES,
  STACKING_REASONS,
  DomainValidationError,
  copyRuleValue,
  createAttemptBudget,
  createStackingPolicy,
  entityId,
  evaluateAttemptBudget,
  evaluateStackingEligibility,
  type AttemptBudgetContext,
  type AttemptBudgetReason,
  type RuleValue,
  type StackingContext,
  type StackingMode,
  type StackingPolicy,
  type StackingReason,
} from './index';
import { colony, earlier, start } from './participation-fixtures';

const budgetInput = {
  id: entityId('AttemptBudget', 'budget-p'),
  maxAttempts: 3,
  maxScoutingLossPips: 12,
  cooldownRule: { seconds: 60 },
  resetRule: { kind: 'MANUAL' },
  currentPeriodKey: 'review-period:001',
  updatedAt: start,
};
const budget = createAttemptBudget(colony, budgetInput);
const budgetContext: AttemptBudgetContext = {
  colonyId: colony.id,
  periodKey: budget.currentPeriodKey,
  attemptsConsumed: 0,
  scoutingLossPipsConsumed: 0,
  cooldownSatisfied: true,
};
const policyInput: StackingPolicy = {
  mode: 'ANY_VALID_ENTRY',
  maxActiveScouts: 3,
  maxFreshRiskPositionPips: 10,
  cooldownRule: { seconds: 30 },
  targetProximityBlock: true,
  strategyStateConstraints: { stages: ['CONFIRMED'] },
};
const policy = createStackingPolicy(policyInput);
const context: StackingContext = {
  colonyId: colony.id,
  entryValid: true,
  participationAllowed: true,
  activeScoutCount: 0,
  freshRiskPositionPips: 2,
  additionalFreshRiskPositionPips: 1,
  hasSurvivorOrLater: false,
  hasQualifyingProtection: false,
  hasLegOrLater: false,
  cooldownSatisfied: true,
  targetProximityBlocked: false,
  strategyStateConstraintsSatisfied: true,
  manualApproval: false,
  attemptBudget: { budget, context: budgetContext },
};

// Fixed expected reason sequences guard the decision contract, independent of production arrays.
const expectedBudgetReasons: AttemptBudgetReason[] = [
  'COLONY_CONTEXT_MISMATCH',
  'PERIOD_CONTEXT_MISMATCH',
  'MAX_ATTEMPTS_REACHED',
  'MAX_SCOUTING_LOSS_PIPS_REACHED',
  'BUDGET_COOLDOWN_NOT_SATISFIED',
];
const expectedStackingReasons: StackingReason[] = [
  'ENTRY_NOT_VALID',
  'PARTICIPATION_BLOCKED',
  'SURVIVOR_EVIDENCE_REQUIRED',
  'QUALIFYING_PROTECTION_REQUIRED',
  'LEG_EVIDENCE_REQUIRED',
  'MANUAL_APPROVAL_REQUIRED',
  'MAX_ACTIVE_SCOUTS_REACHED',
  'MAX_FRESH_RISK_POSITION_PIPS_REACHED',
  'STACKING_COOLDOWN_NOT_SATISFIED',
  'TARGET_PROXIMITY_BLOCKED',
  'STRATEGY_STATE_CONSTRAINTS_NOT_SATISFIED',
  'ATTEMPT_BUDGET_COLONY_MISMATCH',
  'ATTEMPT_BUDGET_BLOCKED',
];

describe('opaque immutable JSON rule payloads', () => {
  it('deep-copies and freezes nested objects/arrays without interpreting rules', () => {
    const input = {
      reset: { kind: 'CUSTOM', values: [1, null, { nested: true }] },
      enabled: false,
    };
    const copied = copyRuleValue(input);
    expect(copied).toEqual(input);
    expect(copied).not.toBe(input);
    input.reset.kind = 'edited';
    input.reset.values.push(99);
    expect(copied).toEqual({
      reset: { kind: 'CUSTOM', values: [1, null, { nested: true }] },
      enabled: false,
    });
    const object = copied as { reset: { values: readonly RuleValue[] } };
    expect(Object.isFrozen(object)).toBe(true);
    expect(Object.isFrozen(object.reset)).toBe(true);
    expect(Object.isFrozen(object.reset.values)).toBe(true);
    expect(() => Object.assign(object.reset, { kind: 'rewrite' })).toThrow(
      TypeError,
    );
  });
  it.each([null, true, false, 'opaque-rule', 0, -1])(
    'accepts JSON primitive %s unchanged',
    (input) => {
      expect(copyRuleValue(input)).toBe(input);
    },
  );
  it('rejects cycles and non-JSON values rather than serializing away information', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const input of [
      undefined,
      () => 1,
      Symbol('x'),
      1n,
      NaN,
      Infinity,
      new Date(),
      new Map(),
      cycle,
      { invalid: undefined },
      [undefined],
      Array(2),
      Object.create({ inherited: true }),
    ]) {
      expect(() => copyRuleValue(input as RuleValue)).toThrow(
        DomainValidationError,
      );
    }
  });
  it('rejects getters without evaluating them and rejects symbol/nonenumerable properties', () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, 'rule', {
      enumerable: true,
      get() {
        reads++;
        return 'MANUAL';
      },
    });
    expect(() => copyRuleValue(accessor)).toThrow(DomainValidationError);
    expect(reads).toBe(0);
    expect(() => copyRuleValue({ [Symbol('secret')]: 3 } as RuleValue)).toThrow(
      DomainValidationError,
    );
    expect(() =>
      copyRuleValue(Object.defineProperty({}, 'hidden', { value: 1 })),
    ).toThrow(DomainValidationError);
  });
  it('handles shared acyclic subobjects and preserves special JSON keys without prototype mutation', () => {
    const shared = { kind: 'CUSTOM' };
    expect(copyRuleValue({ first: shared, second: shared })).toEqual({
      first: shared,
      second: shared,
    });
    const original = JSON.parse('{"__proto__":{"polluted":true}}') as RuleValue;
    const result = copyRuleValue(original);
    expect(Object.hasOwn(result as object, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('AttemptBudget record and pure eligibility', () => {
  it('preserves canonical fields and immutable nested rule payloads', () => {
    expect(budget).toEqual({ ...budgetInput, colonyId: colony.id });
    expect(Object.isFrozen(budget)).toBe(true);
    expect(Object.isFrozen(budget.cooldownRule)).toBe(true);
    expect(Object.isFrozen(budget.resetRule)).toBe(true);
    budgetInput.cooldownRule.seconds = 999;
    expect(budget.cooldownRule).toEqual({ seconds: 60 });
  });
  it('permits unlimited nullable caps and absent cooldown without resetting context', () => {
    const unlimited = createAttemptBudget(colony, {
      ...budgetInput,
      maxAttempts: null,
      maxScoutingLossPips: null,
      cooldownRule: null,
    });
    const result = evaluateAttemptBudget(unlimited, {
      ...budgetContext,
      attemptsConsumed: 100000,
      scoutingLossPipsConsumed: 100000,
      cooldownSatisfied: false,
    });
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result).toMatchObject({
      budgetId: budget.id,
      colonyId: colony.id,
      periodKey: budget.currentPeriodKey,
    });
  });
  it.each([0, 1, 2, 3, 4])(
    'checks consumed Attempt count %i against cap 3',
    (attemptsConsumed) => {
      const result = evaluateAttemptBudget(budget, {
        ...budgetContext,
        attemptsConsumed,
      });
      expect(result.allowed).toBe(attemptsConsumed < 3);
      expect(result.reasons).toEqual(
        attemptsConsumed < 3 ? [] : ['MAX_ATTEMPTS_REACHED'],
      );
    },
  );
  it.each([0, 11.9, 12, 12.1])(
    'checks consumed scouting loss %s against cap 12',
    (scoutingLossPipsConsumed) => {
      expect(
        evaluateAttemptBudget(budget, {
          ...budgetContext,
          scoutingLossPipsConsumed,
        }).reasons,
      ).toEqual(
        scoutingLossPipsConsumed < 12 ? [] : ['MAX_SCOUTING_LOSS_PIPS_REACHED'],
      );
    },
  );
  it('treats zero caps as explicit blocks rather than unlimited', () => {
    const zero = createAttemptBudget(colony, {
      ...budgetInput,
      maxAttempts: 0,
      maxScoutingLossPips: 0,
    });
    expect(evaluateAttemptBudget(zero, budgetContext).reasons).toEqual([
      'MAX_ATTEMPTS_REACHED',
      'MAX_SCOUTING_LOSS_PIPS_REACHED',
    ]);
  });
  it('checks cooldown only when a rule exists', () => {
    expect(
      evaluateAttemptBudget(budget, {
        ...budgetContext,
        cooldownSatisfied: false,
      }).reasons,
    ).toEqual(['BUDGET_COOLDOWN_NOT_SATISFIED']);
    const noRule = createAttemptBudget(colony, {
      ...budgetInput,
      cooldownRule: null,
    });
    expect(
      evaluateAttemptBudget(noRule, {
        ...budgetContext,
        cooldownSatisfied: false,
      }).allowed,
    ).toBe(true);
  });
  it('rejects stale period and foreign Colony context explicitly, without resetting counters', () => {
    const result = evaluateAttemptBudget(budget, {
      ...budgetContext,
      colonyId: entityId('Colony', 'other'),
      periodKey: 'previous-period',
    });
    expect(result.reasons).toEqual([
      'COLONY_CONTEXT_MISMATCH',
      'PERIOD_CONTEXT_MISMATCH',
    ]);
    expect(budget.currentPeriodKey).toBe('review-period:001');
  });
  it('collects every applicable budget blocker in stable order', () => {
    const result = evaluateAttemptBudget(budget, {
      ...budgetContext,
      colonyId: entityId('Colony', 'other'),
      periodKey: 'stale',
      attemptsConsumed: 3,
      scoutingLossPipsConsumed: 12,
      cooldownSatisfied: false,
    });
    expect(result.reasons).toEqual(expectedBudgetReasons);
    expect(ATTEMPT_BUDGET_REASONS).toEqual(expectedBudgetReasons);
    expect(result.allowed).toBe(false);
    expect(Object.isFrozen(result.reasons)).toBe(true);
  });
  it('rejects malformed budgets, missing reset rules and backdated updates', () => {
    for (const maxAttempts of [-1, 1.5, NaN, Infinity])
      expect(() =>
        createAttemptBudget(colony, { ...budgetInput, maxAttempts }),
      ).toThrow(DomainValidationError);
    for (const maxScoutingLossPips of [-1, NaN, Infinity])
      expect(() =>
        createAttemptBudget(colony, { ...budgetInput, maxScoutingLossPips }),
      ).toThrow(DomainValidationError);
    expect(() =>
      createAttemptBudget(colony, {
        ...budgetInput,
        resetRule: null as unknown as string,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createAttemptBudget(colony, { ...budgetInput, currentPeriodKey: '' }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createAttemptBudget(colony, { ...budgetInput, updatedAt: earlier }),
    ).toThrow(DomainValidationError);
  });
  it('rejects negative/net profit loss consumption and malformed contexts', () => {
    for (const bad of [
      { attemptsConsumed: -1 },
      { attemptsConsumed: 0.5 },
      { attemptsConsumed: NaN },
      { scoutingLossPipsConsumed: -1 },
      { scoutingLossPipsConsumed: Infinity },
      { scoutingLossPipsConsumed: NaN },
      { periodKey: '' },
      { cooldownSatisfied: undefined },
    ]) {
      expect(() =>
        evaluateAttemptBudget(budget, {
          ...budgetContext,
          ...bad,
        } as AttemptBudgetContext),
      ).toThrow(DomainValidationError);
    }
  });
});

describe('StackingPolicy value and evidence modes', () => {
  it.each(STACKING_MODES)(
    'preserves %s in a frozen value with no invented entity/version identity',
    (mode) => {
      const created = createStackingPolicy({ ...policyInput, mode });
      expect(created.mode).toBe(mode);
      expect(Object.isFrozen(created)).toBe(true);
      expect(created).not.toHaveProperty('id');
      expect(created).not.toHaveProperty('version');
    },
  );
  it.each([
    ['ONLY_AFTER_SURVIVOR', 'hasSurvivorOrLater', 'SURVIVOR_EVIDENCE_REQUIRED'],
    [
      'ONLY_AFTER_PROTECTED',
      'hasQualifyingProtection',
      'QUALIFYING_PROTECTION_REQUIRED',
    ],
    ['ONLY_AFTER_LEG', 'hasLegOrLater', 'LEG_EVIDENCE_REQUIRED'],
    ['MANUAL', 'manualApproval', 'MANUAL_APPROVAL_REQUIRED'],
  ] as const)(
    '%s requires its own explicit qualifying fact',
    (mode, fact, reason) => {
      const configured = createStackingPolicy({ ...policyInput, mode });
      expect(evaluateStackingEligibility(configured, context).reasons).toEqual([
        reason,
      ]);
      expect(
        evaluateStackingEligibility(configured, { ...context, [fact]: true })
          .allowed,
      ).toBe(true);
    },
  );
  it('ANY_VALID_ENTRY permits repeated participation until explicit caps are exhausted', () => {
    const original = JSON.stringify({ policy, context, budget });
    const results = [0, 1, 2, 3].map((consumed) =>
      evaluateStackingEligibility(policy, {
        ...context,
        activeScoutCount: consumed,
        attemptBudget: {
          budget,
          context: { ...budgetContext, attemptsConsumed: consumed },
        },
      }),
    );
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.reasons).toEqual([
      'MAX_ACTIVE_SCOUTS_REACHED',
      'ATTEMPT_BUDGET_BLOCKED',
    ]);
    expect(results[3]!.budgetDecision!.reasons).toEqual([
      'MAX_ATTEMPTS_REACHED',
    ]);
    expect(JSON.stringify({ policy, context, budget })).toBe(original);
  });
  it('does not infer qualifying protection from Survivor/Leg evidence or PROTECTED lifecycle labels', () => {
    const protectedPolicy = createStackingPolicy({
      ...policyInput,
      mode: 'ONLY_AFTER_PROTECTED',
    });
    const supplied = {
      ...context,
      hasSurvivorOrLater: true,
      hasLegOrLater: true,
      currentState: 'PROTECTED',
    };
    expect(
      evaluateStackingEligibility(protectedPolicy, supplied).reasons,
    ).toEqual(['QUALIFYING_PROTECTION_REQUIRED']);
    // A SCOUT may independently satisfy verified protection criteria.
    expect(
      evaluateStackingEligibility(protectedPolicy, {
        ...context,
        hasQualifyingProtection: true,
      }).allowed,
    ).toBe(true);
    const survivorPolicy = createStackingPolicy({
      ...policyInput,
      mode: 'ONLY_AFTER_SURVIVOR',
    });
    expect(
      evaluateStackingEligibility(survivorPolicy, {
        ...context,
        hasQualifyingProtection: true,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateStackingEligibility(survivorPolicy, {
        ...context,
        hasSurvivorOrLater: true,
      }).allowed,
    ).toBe(true);
  });
  it.each(STACKING_MODES)(
    'global guards still apply in %s even with all approvals/evidence',
    (mode) => {
      const configured = createStackingPolicy({ ...policyInput, mode });
      const facts = {
        ...context,
        hasSurvivorOrLater: true,
        hasQualifyingProtection: true,
        hasLegOrLater: true,
        manualApproval: true,
        entryValid: false,
        participationAllowed: false,
        activeScoutCount: 3,
        freshRiskPositionPips: 10,
        cooldownSatisfied: false,
        targetProximityBlocked: true,
        strategyStateConstraintsSatisfied: false,
        attemptBudget: {
          budget,
          context: { ...budgetContext, attemptsConsumed: 3 },
        },
      };
      expect(evaluateStackingEligibility(configured, facts).reasons).toEqual([
        'ENTRY_NOT_VALID',
        'PARTICIPATION_BLOCKED',
        'MAX_ACTIVE_SCOUTS_REACHED',
        'MAX_FRESH_RISK_POSITION_PIPS_REACHED',
        'STACKING_COOLDOWN_NOT_SATISFIED',
        'TARGET_PROXIMITY_BLOCKED',
        'STRATEGY_STATE_CONSTRAINTS_NOT_SATISFIED',
        'ATTEMPT_BUDGET_BLOCKED',
      ]);
    },
  );
  it.each([
    [{ entryValid: false }, 'ENTRY_NOT_VALID'],
    [{ participationAllowed: false }, 'PARTICIPATION_BLOCKED'],
    [{ activeScoutCount: 3 }, 'MAX_ACTIVE_SCOUTS_REACHED'],
    [{ freshRiskPositionPips: 10 }, 'MAX_FRESH_RISK_POSITION_PIPS_REACHED'],
    [{ cooldownSatisfied: false }, 'STACKING_COOLDOWN_NOT_SATISFIED'],
    [{ targetProximityBlocked: true }, 'TARGET_PROXIMITY_BLOCKED'],
    [
      { strategyStateConstraintsSatisfied: false },
      'STRATEGY_STATE_CONSTRAINTS_NOT_SATISFIED',
    ],
  ] as const)('enforces independent guard %j', (bad, reason) => {
    expect(
      evaluateStackingEligibility(policy, { ...context, ...bad }).reasons,
    ).toEqual([reason]);
  });
  it('checks projected new fresh risk so an otherwise valid entry cannot exceed the cap', () => {
    expect(
      evaluateStackingEligibility(policy, {
        ...context,
        freshRiskPositionPips: 9,
        additionalFreshRiskPositionPips: 2,
      }).allowed,
    ).toBe(false);
    expect(
      evaluateStackingEligibility(policy, {
        ...context,
        freshRiskPositionPips: 9,
        additionalFreshRiskPositionPips: 1,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateStackingEligibility(policy, {
        ...context,
        freshRiskPositionPips: 10,
        additionalFreshRiskPositionPips: 0,
      }).allowed,
    ).toBe(false);
    const zero = createStackingPolicy({
      ...policyInput,
      maxActiveScouts: 0,
      maxFreshRiskPositionPips: 0,
    });
    expect(
      evaluateStackingEligibility(zero, {
        ...context,
        freshRiskPositionPips: 0,
        additionalFreshRiskPositionPips: 0,
      }).reasons,
    ).toEqual([
      'MAX_ACTIVE_SCOUTS_REACHED',
      'MAX_FRESH_RISK_POSITION_PIPS_REACHED',
    ]);
  });
  it('supports explicitly absent optional policy guards and budget', () => {
    const unlimited = createStackingPolicy({
      ...policyInput,
      maxActiveScouts: null,
      maxFreshRiskPositionPips: null,
      cooldownRule: null,
      targetProximityBlock: false,
      strategyStateConstraints: null,
    });
    expect(
      evaluateStackingEligibility(unlimited, {
        ...context,
        activeScoutCount: 999,
        freshRiskPositionPips: 999,
        cooldownSatisfied: false,
        targetProximityBlocked: true,
        strategyStateConstraintsSatisfied: false,
        attemptBudget: null,
      }).allowed,
    ).toBe(true);
  });
  it('reports nested budget details and blocks budget/context belonging to a different Colony', () => {
    const foreign = entityId('Colony', 'foreign');
    const value = evaluateStackingEligibility(policy, {
      ...context,
      attemptBudget: {
        budget,
        context: { ...budgetContext, colonyId: foreign },
      },
    });
    expect(value.reasons).toEqual([
      'ATTEMPT_BUDGET_COLONY_MISMATCH',
      'ATTEMPT_BUDGET_BLOCKED',
    ]);
    expect(value.budgetDecision!.reasons).toEqual(['COLONY_CONTEXT_MISMATCH']);
    const internallyConsistentForeignBudget = evaluateStackingEligibility(
      policy,
      {
        ...context,
        attemptBudget: {
          budget: { ...budget, colonyId: foreign },
          context: { ...budgetContext, colonyId: foreign },
        },
      },
    );
    expect(internallyConsistentForeignBudget.reasons).toEqual([
      'ATTEMPT_BUDGET_COLONY_MISMATCH',
    ]);
    expect(internallyConsistentForeignBudget.allowed).toBe(false);
    const stale = evaluateStackingEligibility(policy, {
      ...context,
      attemptBudget: {
        budget,
        context: { ...budgetContext, periodKey: 'old' },
      },
    });
    expect(stale.reasons).toEqual(['ATTEMPT_BUDGET_BLOCKED']);
    expect(stale.budgetDecision!.reasons).toEqual(['PERIOD_CONTEXT_MISMATCH']);
  });
  it('validates the exact exported blocker vocabulary', () => {
    expect(STACKING_REASONS).toEqual(expectedStackingReasons);
  });
  it('rejects invalid modes, caps and rule payloads rather than silently ignoring them', () => {
    expect(() =>
      createStackingPolicy({
        ...policyInput,
        mode: 'STACK_EVERYTHING' as StackingMode,
      }),
    ).toThrow(DomainValidationError);
    for (const maxActiveScouts of [-1, 0.5, Infinity, NaN])
      expect(() =>
        createStackingPolicy({ ...policyInput, maxActiveScouts }),
      ).toThrow(DomainValidationError);
    for (const maxFreshRiskPositionPips of [-1, Infinity, NaN])
      expect(() =>
        createStackingPolicy({ ...policyInput, maxFreshRiskPositionPips }),
      ).toThrow(DomainValidationError);
    expect(() =>
      createStackingPolicy({
        ...policyInput,
        targetProximityBlock: 'yes' as unknown as boolean,
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createStackingPolicy({
        ...policyInput,
        cooldownRule: { invalid: undefined } as unknown as RuleValue,
      }),
    ).toThrow(DomainValidationError);
  });
  it('rejects malformed facts, negative values and projected numeric overflow', () => {
    for (const bad of [
      { activeScoutCount: -1 },
      { activeScoutCount: 0.5 },
      { freshRiskPositionPips: -1 },
      { freshRiskPositionPips: NaN },
      { additionalFreshRiskPositionPips: -1 },
      { additionalFreshRiskPositionPips: Infinity },
      {
        freshRiskPositionPips: Number.MAX_VALUE,
        additionalFreshRiskPositionPips: Number.MAX_VALUE,
      },
    ]) {
      expect(() =>
        evaluateStackingEligibility(policy, { ...context, ...bad }),
      ).toThrow(DomainValidationError);
    }
    for (const field of [
      'entryValid',
      'participationAllowed',
      'hasSurvivorOrLater',
      'hasQualifyingProtection',
      'hasLegOrLater',
      'cooldownSatisfied',
      'targetProximityBlocked',
      'strategyStateConstraintsSatisfied',
      'manualApproval',
    ] as const) {
      expect(() =>
        evaluateStackingEligibility(policy, {
          ...context,
          [field]: undefined,
        } as unknown as StackingContext),
      ).toThrow(DomainValidationError);
    }
  });
  it('has deterministic immutable outputs and no current-clock dependency or hidden consumption', () => {
    const before = JSON.stringify({ policy, context, budget });
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('clock access');
    });
    try {
      const first = evaluateStackingEligibility(policy, context);
      const second = evaluateStackingEligibility(policy, context);
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(Object.keys(first).sort()).toEqual([
        'allowed',
        'budgetDecision',
        'colonyId',
        'reasons',
      ]);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.reasons)).toBe(true);
      expect(Object.isFrozen(first.budgetDecision)).toBe(true);
      expect(Object.isFrozen(first.budgetDecision!.reasons)).toBe(true);
      expect(JSON.stringify({ policy, context, budget })).toBe(before);
      expect(now).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
});
