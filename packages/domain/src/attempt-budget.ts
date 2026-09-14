import { validateColony, type Colony } from './colony';
import {
  copyRuleValue,
  eligibilityDecision,
  requireBoolean,
  requireNonnegative,
  type EligibilityDecision,
  type RuleValue,
} from './participation-values';
import {
  DomainValidationError,
  requireId,
  requireInteger,
  requireNotBefore,
  requireText,
  timestamp,
  type AttemptBudgetId,
  type ColonyId,
  type Timestamp,
} from './primitives';

export interface AttemptBudget {
  readonly id: AttemptBudgetId;
  readonly colonyId: ColonyId;
  readonly maxAttempts: number | null;
  readonly maxScoutingLossPips: number | null;
  readonly cooldownRule: RuleValue | null;
  readonly resetRule: Exclude<RuleValue, null>;
  readonly currentPeriodKey: string;
  readonly updatedAt: Timestamp;
}
export function validateAttemptBudget(budget: AttemptBudget): void {
  requireId(budget.id);
  requireId(budget.colonyId);
  if (budget.maxAttempts !== null)
    requireInteger(budget.maxAttempts, 0, 'maxAttempts');
  if (budget.maxScoutingLossPips !== null)
    requireNonnegative(budget.maxScoutingLossPips, 'maxScoutingLossPips');
  if (budget.resetRule === null)
    throw new DomainValidationError('resetRule is required');
  copyRuleValue(budget.cooldownRule);
  copyRuleValue(budget.resetRule);
  requireText(budget.currentPeriodKey, 'currentPeriodKey');
  timestamp(budget.updatedAt);
}
export function createAttemptBudget(
  colony: Colony,
  input: Omit<AttemptBudget, 'colonyId'>,
): AttemptBudget {
  validateColony(colony);
  requireNotBefore(input.updatedAt, colony.createdAt);
  const budget: AttemptBudget = {
    id: input.id,
    colonyId: colony.id,
    maxAttempts: input.maxAttempts,
    maxScoutingLossPips: input.maxScoutingLossPips,
    cooldownRule: copyRuleValue(input.cooldownRule),
    resetRule: copyRuleValue(input.resetRule) as Exclude<RuleValue, null>,
    currentPeriodKey: input.currentPeriodKey,
    updatedAt: input.updatedAt,
  };
  validateAttemptBudget(budget);
  return Object.freeze(budget);
}
export interface AttemptBudgetContext {
  readonly colonyId: ColonyId;
  readonly periodKey: string;
  readonly attemptsConsumed: number;
  /** Nonnegative loss consumption, not signed net Attempt.pipCost or P&L. */
  readonly scoutingLossPipsConsumed: number;
  readonly cooldownSatisfied: boolean;
}
export const ATTEMPT_BUDGET_REASONS = Object.freeze([
  'COLONY_CONTEXT_MISMATCH',
  'PERIOD_CONTEXT_MISMATCH',
  'MAX_ATTEMPTS_REACHED',
  'MAX_SCOUTING_LOSS_PIPS_REACHED',
  'BUDGET_COOLDOWN_NOT_SATISFIED',
] as const);
export type AttemptBudgetReason = (typeof ATTEMPT_BUDGET_REASONS)[number];
export interface AttemptBudgetDecision extends EligibilityDecision<AttemptBudgetReason> {
  readonly budgetId: AttemptBudgetId;
  readonly colonyId: ColonyId;
  readonly periodKey: string;
}
export function evaluateAttemptBudget(
  budget: AttemptBudget,
  context: AttemptBudgetContext,
): AttemptBudgetDecision {
  validateAttemptBudget(budget);
  requireId(context.colonyId);
  requireText(context.periodKey, 'periodKey');
  requireInteger(context.attemptsConsumed, 0, 'attemptsConsumed');
  requireNonnegative(
    context.scoutingLossPipsConsumed,
    'scoutingLossPipsConsumed',
  );
  requireBoolean(context.cooldownSatisfied, 'cooldownSatisfied');
  const reasons: AttemptBudgetReason[] = [];
  if (budget.colonyId !== context.colonyId)
    reasons.push('COLONY_CONTEXT_MISMATCH');
  if (budget.currentPeriodKey !== context.periodKey)
    reasons.push('PERIOD_CONTEXT_MISMATCH');
  if (
    budget.maxAttempts !== null &&
    context.attemptsConsumed >= budget.maxAttempts
  )
    reasons.push('MAX_ATTEMPTS_REACHED');
  if (
    budget.maxScoutingLossPips !== null &&
    context.scoutingLossPipsConsumed >= budget.maxScoutingLossPips
  )
    reasons.push('MAX_SCOUTING_LOSS_PIPS_REACHED');
  if (budget.cooldownRule !== null && !context.cooldownSatisfied)
    reasons.push('BUDGET_COOLDOWN_NOT_SATISFIED');
  return Object.freeze({
    ...eligibilityDecision(reasons),
    budgetId: budget.id,
    colonyId: budget.colonyId,
    periodKey: budget.currentPeriodKey,
  });
}
