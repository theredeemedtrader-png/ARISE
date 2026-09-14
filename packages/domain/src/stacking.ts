import {
  evaluateAttemptBudget,
  type AttemptBudget,
  type AttemptBudgetContext,
  type AttemptBudgetDecision,
} from './attempt-budget';
import {
  copyRuleValue,
  eligibilityDecision,
  requireBoolean,
  requireFinite,
  requireNonnegative,
  type EligibilityDecision,
  type RuleValue,
} from './participation-values';
import {
  requireId,
  requireInteger,
  requireMember,
  type ColonyId,
} from './primitives';

export const STACKING_MODES = Object.freeze([
  'ANY_VALID_ENTRY',
  'ONLY_AFTER_SURVIVOR',
  'ONLY_AFTER_PROTECTED',
  'ONLY_AFTER_LEG',
  'MANUAL',
] as const);
export type StackingMode = (typeof STACKING_MODES)[number];
/** Minimal immutable value object; durable identity/versioning and runtime orchestration are deferred. */
export interface StackingPolicy {
  readonly mode: StackingMode;
  readonly maxActiveScouts: number | null;
  readonly maxFreshRiskPositionPips: number | null;
  readonly cooldownRule: RuleValue | null;
  readonly targetProximityBlock: boolean;
  readonly strategyStateConstraints: RuleValue | null;
}
export function validateStackingPolicy(policy: StackingPolicy): void {
  requireMember(policy.mode, STACKING_MODES, 'stacking mode');
  if (policy.maxActiveScouts !== null)
    requireInteger(policy.maxActiveScouts, 0, 'maxActiveScouts');
  if (policy.maxFreshRiskPositionPips !== null)
    requireNonnegative(
      policy.maxFreshRiskPositionPips,
      'maxFreshRiskPositionPips',
    );
  requireBoolean(policy.targetProximityBlock, 'targetProximityBlock');
  copyRuleValue(policy.cooldownRule);
  copyRuleValue(policy.strategyStateConstraints);
}
export function createStackingPolicy(input: StackingPolicy): StackingPolicy {
  validateStackingPolicy(input);
  return Object.freeze({
    mode: input.mode,
    maxActiveScouts: input.maxActiveScouts,
    maxFreshRiskPositionPips: input.maxFreshRiskPositionPips,
    cooldownRule: copyRuleValue(input.cooldownRule),
    targetProximityBlock: input.targetProximityBlock,
    strategyStateConstraints: copyRuleValue(input.strategyStateConstraints),
  });
}
export interface StackingContext {
  readonly colonyId: ColonyId;
  readonly entryValid: boolean;
  /** Higher layers decide thesis/Area/session permission; false blocks even manual mode. */
  readonly participationAllowed: boolean;
  readonly activeScoutCount: number;
  readonly freshRiskPositionPips: number;
  readonly additionalFreshRiskPositionPips: number;
  readonly hasSurvivorOrLater: boolean;
  /** Explicit verified protection fact, independent of lifecycle classification. */
  readonly hasQualifyingProtection: boolean;
  readonly hasLegOrLater: boolean;
  readonly cooldownSatisfied: boolean;
  readonly targetProximityBlocked: boolean;
  readonly strategyStateConstraintsSatisfied: boolean;
  readonly manualApproval: boolean;
  readonly attemptBudget: Readonly<{
    budget: AttemptBudget;
    context: AttemptBudgetContext;
  }> | null;
}
export const STACKING_REASONS = Object.freeze([
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
] as const);
export type StackingReason = (typeof STACKING_REASONS)[number];
export interface StackingDecision extends EligibilityDecision<StackingReason> {
  readonly colonyId: ColonyId;
  readonly budgetDecision: AttemptBudgetDecision | null;
}
export function evaluateStackingEligibility(
  policy: StackingPolicy,
  context: StackingContext,
): StackingDecision {
  validateStackingPolicy(policy);
  requireId(context.colonyId);
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
    requireBoolean(context[field], field);
  }
  requireInteger(context.activeScoutCount, 0, 'activeScoutCount');
  requireNonnegative(context.freshRiskPositionPips, 'freshRiskPositionPips');
  requireNonnegative(
    context.additionalFreshRiskPositionPips,
    'additionalFreshRiskPositionPips',
  );
  const proposedRisk =
    context.freshRiskPositionPips + context.additionalFreshRiskPositionPips;
  requireFinite(proposedRisk, 'projected fresh risk');
  const reasons: StackingReason[] = [];
  if (!context.entryValid) reasons.push('ENTRY_NOT_VALID');
  if (!context.participationAllowed) reasons.push('PARTICIPATION_BLOCKED');
  switch (policy.mode) {
    case 'ONLY_AFTER_SURVIVOR':
      if (!context.hasSurvivorOrLater)
        reasons.push('SURVIVOR_EVIDENCE_REQUIRED');
      break;
    case 'ONLY_AFTER_PROTECTED':
      if (!context.hasQualifyingProtection)
        reasons.push('QUALIFYING_PROTECTION_REQUIRED');
      break;
    case 'ONLY_AFTER_LEG':
      if (!context.hasLegOrLater) reasons.push('LEG_EVIDENCE_REQUIRED');
      break;
    case 'MANUAL':
      if (!context.manualApproval) reasons.push('MANUAL_APPROVAL_REQUIRED');
      break;
  }
  if (
    policy.maxActiveScouts !== null &&
    context.activeScoutCount >= policy.maxActiveScouts
  )
    reasons.push('MAX_ACTIVE_SCOUTS_REACHED');
  if (
    policy.maxFreshRiskPositionPips !== null &&
    (context.freshRiskPositionPips >= policy.maxFreshRiskPositionPips ||
      proposedRisk > policy.maxFreshRiskPositionPips)
  )
    reasons.push('MAX_FRESH_RISK_POSITION_PIPS_REACHED');
  if (policy.cooldownRule !== null && !context.cooldownSatisfied)
    reasons.push('STACKING_COOLDOWN_NOT_SATISFIED');
  if (policy.targetProximityBlock && context.targetProximityBlocked)
    reasons.push('TARGET_PROXIMITY_BLOCKED');
  if (
    policy.strategyStateConstraints !== null &&
    !context.strategyStateConstraintsSatisfied
  )
    reasons.push('STRATEGY_STATE_CONSTRAINTS_NOT_SATISFIED');
  let budgetDecision: AttemptBudgetDecision | null = null;
  if (context.attemptBudget !== null) {
    const supplied = context.attemptBudget;
    budgetDecision = evaluateAttemptBudget(supplied.budget, supplied.context);
    if (
      supplied.budget.colonyId !== context.colonyId ||
      supplied.context.colonyId !== context.colonyId
    )
      reasons.push('ATTEMPT_BUDGET_COLONY_MISMATCH');
    if (!budgetDecision.allowed) reasons.push('ATTEMPT_BUDGET_BLOCKED');
  }
  return Object.freeze({
    ...eligibilityDecision(reasons),
    colonyId: context.colonyId,
    budgetDecision,
  });
}
