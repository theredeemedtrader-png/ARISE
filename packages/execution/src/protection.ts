export type ProtectionState =
  | 'UNPROTECTED'
  | 'PROTECTION_PENDING'
  | 'PARTIALLY_PROTECTED'
  | 'PROTECTED'
  | 'PROTECTION_ERROR';

export type ProtectionTriggerType =
  | 'PRICE_TOUCH'
  | 'PRICE_CROSS'
  | 'WICK_THROUGH'
  | 'CANDLE_CLOSE_ABOVE'
  | 'CANDLE_CLOSE_BELOW'
  | 'RECLAIM'
  | 'ENTER_ZONE'
  | 'EXIT_ZONE'
  | 'STRATEGY_NODE_CONFIRMED'
  | 'POSITION_STATE_CHANGED'
  | 'TARGET_APPROACHING'
  | 'TARGET_REACHED'
  | 'TARGET_HIT'
  | 'MANUAL';

export type ProtectionActionType =
  | 'MOVE_TO_PRICE_BE'
  | 'MOVE_TO_TRUE_BE'
  | 'BE_PLUS_OFFSET'
  | 'LOCK_PIPS'
  | 'LOCK_MONEY'
  | 'LOCK_PERCENT_OPEN_PROFIT'
  | 'MOVE_TO_PRICE'
  | 'MOVE_TO_MARKET_OBJECT'
  | 'TRAIL_FIXED_DISTANCE'
  | 'TRAIL_MARKET_OBJECT'
  | 'TRAIL_STRUCTURE'
  | 'PARTIAL_CLOSE'
  | 'FULL_CLOSE'
  | 'REMOVE_TP'
  | 'SET_TP'
  | 'CONVERT_TO_RUNNER';

export type ProtectionScope =
  | 'THIS_POSITION'
  | 'SELECTED_POSITIONS'
  | 'ALL_SCOUTS'
  | 'ALL_SURVIVORS'
  | 'ALL_UNPROTECTED'
  | 'ALL_LEGS'
  | 'ALL_MATURE_LEGS'
  | 'ALL_POSITIONS_IN_COLONY'
  | 'POSITIONS_MATCHING_TAG';

export type ThesisInvalidationPolicy =
  | 'KEEP_MANAGING'
  | 'TIGHTEN'
  | 'MOVE_TO_PROTECTION'
  | 'CLOSE_ALL'
  | 'MANUAL_DECISION';

export interface FillCostFact {
  readonly volume: number;
  readonly price: number;
  /** Signed economic cost in account currency. Positive values must be recovered. */
  readonly costMoney: number;
}

export interface ProtectionPositionFact {
  readonly positionId: string;
  readonly brokerPositionKey: string;
  readonly colonyId: string;
  readonly source: 'ARISE_AUTO' | 'ARISE_MANUAL' | 'MT5_EXTERNAL';
  readonly direction: 'LONG' | 'SHORT';
  readonly state:
    | 'CANDIDATE'
    | 'SCOUT'
    | 'SURVIVOR'
    | 'PROTECTED'
    | 'LEG'
    | 'MATURE_LEG'
    | 'RUNNER'
    | 'CLOSED';
  readonly protectionState: ProtectionState;
  readonly actualVolume: number;
  readonly currentStop: number | null;
  readonly currentTakeProfit: number | null;
  readonly tags: readonly string[];
  readonly fills: readonly FillCostFact[];
}

export interface BrokerProtectionContext {
  readonly truth: 'VERIFIED' | 'UNKNOWN';
  readonly connection:
    | 'CONNECTED'
    | 'DEGRADED'
    | 'DISCONNECTED'
    | 'RECONNECTING'
    | 'RECONCILING'
    | 'BLOCKED';
  readonly reconciliation: 'MATCHED' | 'RECOVERY_REQUIRED' | 'UNKNOWN';
  readonly protocolCompatible: boolean;
  readonly terminalConnected: boolean;
  readonly accountMatches: boolean;
  readonly accountIsLive: boolean;
  readonly sessionMatches: boolean;
  readonly quoteFresh: boolean;
  readonly bid: number;
  readonly ask: number;
  readonly tickSize: number;
  readonly pipSize: number;
  readonly stopsLevel: number;
  readonly freezeLevel: number;
  readonly minVolume: number;
  readonly volumeStep: number;
}

export interface ProtectionProposal {
  readonly proposalId: string;
  readonly ruleVersionId: string;
  readonly triggerEventId: string;
  readonly positionId: string;
  readonly brokerPositionKey: string;
  readonly action: ProtectionActionType;
  readonly requestedStop: number | null;
  readonly requestedTakeProfit: number | null;
  readonly requestedCloseVolume: number | null;
  readonly convertToRunner: boolean;
  readonly sequence: number;
  readonly createdAt: string;
}

export interface ProtectionActionCalculationInput {
  readonly action: ProtectionActionType;
  readonly direction: 'LONG' | 'SHORT';
  readonly fills: readonly FillCostFact[];
  readonly actualVolume: number;
  readonly executablePrice: number;
  readonly pipSize: number;
  readonly moneyPerPriceUnitPerLot: number;
  readonly estimatedExitCostMoney?: number;
  readonly offsetPips?: number;
  readonly lockPips?: number;
  readonly lockMoney?: number;
  readonly openProfitPercent?: number;
  readonly explicitPrice?: number;
  readonly marketObjectPrice?: number;
  readonly structurePrice?: number;
  readonly trailDistancePips?: number;
  readonly partialCloseVolume?: number;
  readonly partialClosePercent?: number;
  readonly takeProfitPrice?: number;
}

export function calculateProtectionAction(
  input: ProtectionActionCalculationInput,
): Readonly<{
  requestedStop: number | null;
  requestedTakeProfit: number | null;
  requestedCloseVolume: number | null;
  convertToRunner: boolean;
}> {
  finitePositive(input.actualVolume, 'Actual broker volume');
  finitePositive(input.pipSize, 'Pip size');
  const entry = weightedEntryPrice(input.fills);
  const signed = (distance: number) => input.direction === 'LONG' ? entry + distance : entry - distance;
  let stop: number | null = null;
  let tp: number | null = null;
  let close: number | null = null;
  let runner = false;
  switch (input.action) {
    case 'MOVE_TO_PRICE_BE': stop = entry; break;
    case 'MOVE_TO_TRUE_BE':
      stop = trueBreakEvenPrice(input);
      break;
    case 'BE_PLUS_OFFSET': stop = signed((input.offsetPips ?? 0) * input.pipSize); break;
    case 'LOCK_PIPS': stop = signed((input.lockPips ?? 0) * input.pipSize); break;
    case 'LOCK_MONEY':
      stop = signed((input.lockMoney ?? 0) / (input.actualVolume * input.moneyPerPriceUnitPerLot));
      break;
    case 'LOCK_PERCENT_OPEN_PROFIT': {
      const fraction = (input.openProfitPercent ?? 0) / 100;
      if (fraction < 0 || fraction > 1) throw new Error('Open-profit lock percent must be between 0 and 100');
      stop = entry + (input.executablePrice - entry) * fraction;
      break;
    }
    case 'MOVE_TO_PRICE': stop = input.explicitPrice ?? null; break;
    case 'MOVE_TO_MARKET_OBJECT': stop = input.marketObjectPrice ?? null; break;
    case 'TRAIL_FIXED_DISTANCE':
      stop = input.direction === 'LONG'
        ? input.executablePrice - (input.trailDistancePips ?? 0) * input.pipSize
        : input.executablePrice + (input.trailDistancePips ?? 0) * input.pipSize;
      break;
    case 'TRAIL_MARKET_OBJECT': stop = input.marketObjectPrice ?? null; break;
    case 'TRAIL_STRUCTURE': stop = input.structurePrice ?? null; break;
    case 'PARTIAL_CLOSE':
      close = input.partialCloseVolume ?? input.actualVolume * ((input.partialClosePercent ?? 0) / 100);
      break;
    case 'FULL_CLOSE': close = input.actualVolume; break;
    case 'REMOVE_TP': break;
    case 'SET_TP': tp = input.takeProfitPrice ?? null; break;
    case 'CONVERT_TO_RUNNER': runner = true; break;
  }
  const requiredStop = [
    'MOVE_TO_PRICE_BE','MOVE_TO_TRUE_BE','BE_PLUS_OFFSET','LOCK_PIPS','LOCK_MONEY',
    'LOCK_PERCENT_OPEN_PROFIT','MOVE_TO_PRICE','MOVE_TO_MARKET_OBJECT','TRAIL_FIXED_DISTANCE',
    'TRAIL_MARKET_OBJECT','TRAIL_STRUCTURE',
  ].includes(input.action);
  if (requiredStop && (stop === null || !Number.isFinite(stop))) throw new Error(`${input.action} requires a finite stop result`);
  if (input.action === 'SET_TP' && (tp === null || !Number.isFinite(tp))) throw new Error('SET_TP requires a finite target price');
  if (close !== null && (!Number.isFinite(close) || close <= 0 || close > input.actualVolume + epsilon))
    throw new Error('Close quantity must be positive and no greater than broker reality');
  return Object.freeze({ requestedStop: stop, requestedTakeProfit: tp, requestedCloseVolume: close, convertToRunner: runner });
}

export interface ProtectionValidation {
  readonly status: 'PASS' | 'BLOCK';
  readonly reasons: readonly string[];
  readonly normalizedStop: number | null;
  readonly normalizedTakeProfit: number | null;
  readonly closeVolume: number | null;
}

const epsilon = 1e-9;
const finitePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
};

export function weightedEntryPrice(fills: readonly FillCostFact[]): number {
  if (fills.length === 0) throw new Error('At least one broker-confirmed fill is required');
  let volume = 0;
  let notional = 0;
  for (const fill of fills) {
    finitePositive(fill.volume, 'Fill volume');
    if (!Number.isFinite(fill.price)) throw new Error('Fill price must be finite');
    volume += fill.volume;
    notional += fill.volume * fill.price;
  }
  return notional / volume;
}

/**
 * Economic breakeven is expressed as the executable exit price. Spread must not
 * be added here: LONG exits execute at Bid and SHORT exits at Ask, which the
 * broker validator supplies separately.
 */
export function trueBreakEvenPrice(input: {
  readonly direction: 'LONG' | 'SHORT';
  readonly fills: readonly FillCostFact[];
  readonly moneyPerPriceUnitPerLot: number;
  readonly estimatedExitCostMoney?: number;
}): number {
  finitePositive(input.moneyPerPriceUnitPerLot, 'Money per price unit per lot');
  const volume = input.fills.reduce((sum, fill) => sum + fill.volume, 0);
  finitePositive(volume, 'Filled volume');
  const costs =
    input.fills.reduce((sum, fill) => sum + fill.costMoney, 0) +
    (input.estimatedExitCostMoney ?? 0);
  const adjustment = costs / (volume * input.moneyPerPriceUnitPerLot);
  const raw = weightedEntryPrice(input.fills);
  return input.direction === 'LONG' ? raw + adjustment : raw - adjustment;
}

export function protectionStateForQuantities(
  actualVolume: number,
  protectedVolume: number,
  failed = false,
): ProtectionState {
  if (failed) return 'PROTECTION_ERROR';
  if (actualVolume <= epsilon || protectedVolume <= epsilon) return 'UNPROTECTED';
  if (protectedVolume + epsilon < actualVolume) return 'PARTIALLY_PROTECTED';
  return 'PROTECTED';
}

export function isProtectionWorsening(
  direction: 'LONG' | 'SHORT',
  currentStop: number | null,
  proposedStop: number,
): boolean {
  if (currentStop === null) return false;
  return direction === 'LONG'
    ? proposedStop < currentStop - epsilon
    : proposedStop > currentStop + epsilon;
}

export function mostProtectiveStop(
  direction: 'LONG' | 'SHORT',
  values: readonly number[],
): number {
  if (values.length === 0) throw new Error('At least one stop is required');
  return direction === 'LONG' ? Math.max(...values) : Math.min(...values);
}

export function selectProtectionScope(input: {
  readonly scope: ProtectionScope;
  readonly colonyId: string;
  readonly positions: readonly ProtectionPositionFact[];
  readonly thisPositionId?: string;
  readonly selectedPositionIds?: readonly string[];
  readonly tag?: string;
}): readonly ProtectionPositionFact[] {
  const selected = new Set(input.selectedPositionIds ?? []);
  return Object.freeze(
    input.positions.filter((position) => {
      if (position.colonyId !== input.colonyId || position.state === 'CLOSED') return false;
      // Automated Colony rules may never silently adopt or mutate manual/external positions.
      if (position.source !== 'ARISE_AUTO') return false;
      switch (input.scope) {
        case 'THIS_POSITION': return position.positionId === input.thisPositionId;
        case 'SELECTED_POSITIONS': return selected.has(position.positionId);
        case 'ALL_SCOUTS': return position.state === 'SCOUT';
        case 'ALL_SURVIVORS': return ['SURVIVOR','PROTECTED'].includes(position.state);
        case 'ALL_UNPROTECTED': return position.protectionState !== 'PROTECTED';
        case 'ALL_LEGS': return position.state === 'LEG';
        case 'ALL_MATURE_LEGS': return position.state === 'MATURE_LEG';
        case 'ALL_POSITIONS_IN_COLONY': return true;
        case 'POSITIONS_MATCHING_TAG': return Boolean(input.tag) && position.tags.includes(input.tag!);
      }
    }),
  );
}

export function resolveProtectionProposals(
  position: ProtectionPositionFact,
  proposals: readonly ProtectionProposal[],
): readonly ProtectionProposal[] {
  const applicable = proposals.filter((proposal) => proposal.positionId === position.positionId);
  const fullClose = applicable.filter((proposal) => proposal.action === 'FULL_CLOSE');
  if (fullClose.length) return Object.freeze([fullClose.sort((a, b) => b.sequence - a.sequence)[0]!]);
  const partial = applicable.filter((proposal) => proposal.action === 'PARTIAL_CLOSE');
  const stops = applicable.filter((proposal) => proposal.requestedStop !== null);
  const nonStops = applicable.filter(
    (proposal) => proposal.requestedStop === null && proposal.action !== 'PARTIAL_CLOSE',
  );
  const chosenStop = stops.length
    ? stops.reduce((best, candidate) =>
        mostProtectiveStop(position.direction, [best.requestedStop!, candidate.requestedStop!]) === candidate.requestedStop
          ? candidate
          : best,
      )
    : null;
  return Object.freeze([
    ...(partial.length ? [partial.sort((a, b) => b.sequence - a.sequence)[0]!] : []),
    ...(chosenStop ? [chosenStop] : []),
    ...nonStops.sort((a, b) => a.sequence - b.sequence),
  ]);
}

const align = (price: number, tick: number) => Math.round(price / tick) * tick;

export function validateProtectionProposal(
  position: ProtectionPositionFact,
  proposal: ProtectionProposal,
  broker: BrokerProtectionContext,
): ProtectionValidation {
  const reasons: string[] = [];
  if (position.source !== 'ARISE_AUTO') reasons.push('POSITION_NOT_AUTOMATED');
  if (position.state === 'CLOSED' || position.actualVolume <= epsilon) reasons.push('POSITION_NOT_OPEN');
  if (proposal.brokerPositionKey !== position.brokerPositionKey) reasons.push('BROKER_POSITION_MISMATCH');
  if (broker.connection !== 'CONNECTED') reasons.push('CONNECTION_NOT_HEALTHY');
  if (broker.truth !== 'VERIFIED') reasons.push('BROKER_TRUTH_UNKNOWN');
  if (broker.reconciliation !== 'MATCHED') reasons.push('RECONCILIATION_INCOMPLETE');
  if (!broker.protocolCompatible) reasons.push('PROTOCOL_MISMATCH');
  if (!broker.terminalConnected) reasons.push('TERMINAL_DISCONNECTED');
  if (!broker.accountMatches) reasons.push('ACCOUNT_MISMATCH');
  if (broker.accountIsLive) reasons.push('LIVE_ACCOUNT_BLOCKED');
  if (!broker.sessionMatches) reasons.push('STALE_SESSION');
  if (!broker.quoteFresh) reasons.push('STALE_QUOTE');
  finitePositive(broker.tickSize, 'Tick size');
  finitePositive(broker.pipSize, 'Pip size');
  const stop = proposal.requestedStop === null ? null : align(proposal.requestedStop, broker.tickSize);
  const takeProfit = proposal.requestedTakeProfit === null ? null : align(proposal.requestedTakeProfit, broker.tickSize);
  const minimumDistance = Math.max(broker.stopsLevel, broker.freezeLevel) * broker.tickSize;
  if (stop !== null) {
    if (isProtectionWorsening(position.direction, position.currentStop, stop)) reasons.push('PROTECTION_WORSENING');
    const executable = position.direction === 'LONG' ? broker.bid : broker.ask;
    const validSide = position.direction === 'LONG' ? stop < executable : stop > executable;
    const distant = Math.abs(executable - stop) + epsilon >= minimumDistance;
    if (!validSide) reasons.push('STOP_WRONG_SIDE_OF_EXECUTABLE_PRICE');
    if (!distant) reasons.push('STOP_INSIDE_BROKER_DISTANCE');
  }
  if (takeProfit !== null) {
    const executable = position.direction === 'LONG' ? broker.bid : broker.ask;
    const validSide = position.direction === 'LONG' ? takeProfit > executable : takeProfit < executable;
    if (!validSide) reasons.push('TP_WRONG_SIDE_OF_EXECUTABLE_PRICE');
  }
  let closeVolume = proposal.requestedCloseVolume;
  if (proposal.action === 'FULL_CLOSE') closeVolume = position.actualVolume;
  if (closeVolume !== null && (closeVolume <= epsilon || closeVolume > position.actualVolume + epsilon))
    reasons.push('CLOSE_QUANTITY_EXCEEDS_BROKER_REALITY');
  if (proposal.action === 'PARTIAL_CLOSE' && closeVolume !== null) {
    const aligned = Math.abs(closeVolume / broker.volumeStep - Math.round(closeVolume / broker.volumeStep)) <= epsilon;
    const remaining = position.actualVolume - closeVolume;
    if (closeVolume < broker.minVolume - epsilon || !aligned) reasons.push('CLOSE_QUANTITY_INVALID_FOR_BROKER');
    if (remaining > epsilon && remaining < broker.minVolume - epsilon) reasons.push('REMAINDER_BELOW_BROKER_MINIMUM');
  }
  return Object.freeze({
    status: reasons.length ? 'BLOCK' : 'PASS',
    reasons: Object.freeze(reasons),
    normalizedStop: stop,
    normalizedTakeProfit: takeProfit,
    closeVolume,
  });
}

export interface ColonyAutomationFacts {
  readonly thesisValid: boolean;
  readonly countertrend: boolean;
  readonly mode: 'ANY_VALID_ENTRY' | 'ONLY_AFTER_SURVIVOR' | 'ONLY_AFTER_PROTECTED' | 'ONLY_AFTER_LEG' | 'MANUAL';
  readonly manualApproved: boolean;
  readonly hasSurvivor: boolean;
  readonly hasProtected: boolean;
  readonly hasLeg: boolean;
  readonly attemptsUsed: number;
  readonly maxAttempts: number | null;
  readonly scoutingLossPips: number;
  readonly maxScoutingLossPips: number | null;
  readonly activeExposure: number;
  readonly maxConcurrentExposure: number | null;
  readonly cooldownUntil: string | null;
  readonly evaluatedAt: string;
}

export function evaluateColonyAutomation(facts: ColonyAutomationFacts): {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  if (!facts.thesisValid) reasons.push('THESIS_INVALIDATED');
  if (facts.countertrend) reasons.push('COUNTERTREND_DISABLED');
  if (facts.maxAttempts !== null && facts.attemptsUsed >= facts.maxAttempts) reasons.push('ATTEMPT_BUDGET_EXHAUSTED');
  if (facts.maxScoutingLossPips !== null && facts.scoutingLossPips >= facts.maxScoutingLossPips)
    reasons.push('SCOUTING_COST_CAP_REACHED');
  if (facts.maxConcurrentExposure !== null && facts.activeExposure >= facts.maxConcurrentExposure)
    reasons.push('CONCURRENT_EXPOSURE_CAP_REACHED');
  if (facts.cooldownUntil !== null && Date.parse(facts.evaluatedAt) < Date.parse(facts.cooldownUntil)) reasons.push('COOLDOWN_ACTIVE');
  if (facts.mode === 'MANUAL' && !facts.manualApproved) reasons.push('MANUAL_APPROVAL_REQUIRED');
  if (facts.mode === 'ONLY_AFTER_SURVIVOR' && !facts.hasSurvivor) reasons.push('SURVIVOR_REQUIRED');
  if (facts.mode === 'ONLY_AFTER_PROTECTED' && !facts.hasProtected) reasons.push('PROTECTED_REQUIRED');
  if (facts.mode === 'ONLY_AFTER_LEG' && !facts.hasLeg) reasons.push('LEG_REQUIRED');
  return Object.freeze({ eligible: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function thesisInvalidationOutcome(
  policy: ThesisInvalidationPolicy = 'MANUAL_DECISION',
): { readonly disarmEntries: true; readonly positionAction: ProtectionActionType | null; readonly manualDecisionRequired: boolean } {
  switch (policy) {
    case 'CLOSE_ALL': return Object.freeze({ disarmEntries: true, positionAction: 'FULL_CLOSE', manualDecisionRequired: false });
    case 'MOVE_TO_PROTECTION': return Object.freeze({ disarmEntries: true, positionAction: 'MOVE_TO_TRUE_BE', manualDecisionRequired: false });
    case 'TIGHTEN': return Object.freeze({ disarmEntries: true, positionAction: 'TRAIL_STRUCTURE', manualDecisionRequired: false });
    case 'KEEP_MANAGING': return Object.freeze({ disarmEntries: true, positionAction: null, manualDecisionRequired: false });
    case 'MANUAL_DECISION': return Object.freeze({ disarmEntries: true, positionAction: null, manualDecisionRequired: true });
  }
}

export type TargetProgressState = 'ACTIVE' | 'APPROACHING' | 'REACHED' | 'HIT';
export function nextTargetProgress(input: {
  readonly current: TargetProgressState;
  readonly direction: 'LONG' | 'SHORT';
  readonly executablePrice: number;
  readonly targetPrice: number;
  readonly approachingDistance: number;
  readonly candleClosedBeyond?: boolean;
}): TargetProgressState {
  if (input.current === 'HIT') return 'HIT';
  const distance = input.direction === 'LONG'
    ? input.targetPrice - input.executablePrice
    : input.executablePrice - input.targetPrice;
  if (input.candleClosedBeyond) return 'HIT';
  if (distance <= 0) return 'REACHED';
  if (distance <= input.approachingDistance) return 'APPROACHING';
  return input.current;
}

export function durableProtectionIdempotencyKey(input: {
  readonly ruleVersionId: string;
  readonly triggerEventId: string;
  readonly brokerPositionKey: string;
  readonly action: ProtectionActionType;
  readonly sequence: number;
}): string {
  return `protection:${input.ruleVersionId}:${input.triggerEventId}:${input.brokerPositionKey}:${input.action}:${input.sequence}`;
}
