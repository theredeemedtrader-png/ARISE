export const METRIC_UNAVAILABLE_REASONS = {
  noEntry: 'No immutable entry fill is available.',
  quantityMismatch: 'Entry, exit, and current broker quantities do not reconcile.',
  noExit: 'The Position is terminal but no immutable exit fill is available.',
  noMark: 'No immutable/current mark is available for open exposure.',
  noProtection: 'No verified protection projection is available.',
  noMoney: 'Monetary outcome was not supplied by an authoritative source.',
  noScoutingCost: 'A failed Attempt is missing its pip-cost fact.',
  noDenominator: 'The metric has no meaningful denominator.',
  noLeg: 'No Leg lifecycle event exists.',
} as const;

export type Metric<T = number> =
  | Readonly<{ status: 'AVAILABLE'; value: T; reason: null }>
  | Readonly<{ status: 'UNAVAILABLE'; value: null; reason: string }>;

export const available = <T>(value: T): Metric<T> => Object.freeze({ status: 'AVAILABLE', value, reason: null });
export const unavailable = <T = number>(reason: string): Metric<T> => Object.freeze({ status: 'UNAVAILABLE', value: null, reason });

export interface AnalyticsFill {
  readonly id: string;
  readonly quantity: number;
  readonly price: number;
  readonly occurredAt: string;
  /** Net broker/account-currency result for an exit. Null means unavailable, not zero. */
  readonly money: number | null;
}

export interface PositionDimensions {
  readonly timeframes: readonly string[];
  readonly strategies: readonly string[];
  readonly combos: readonly string[];
  readonly templates: readonly string[];
  readonly tags: readonly string[];
  readonly session: string | null;
  readonly qualification: 'HUMAN_APPROVED' | 'AUTOMATICALLY_QUALIFIED' | null;
}

export interface PositionAnalyticsInput {
  readonly positionId: string;
  readonly tradeId: string;
  readonly originalColonyId: string;
  readonly currentColonyId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly pipSize: number;
  readonly entryFills: readonly AnalyticsFill[];
  readonly exitFills: readonly AnalyticsFill[];
  readonly currentQuantity: number;
  readonly mark: Readonly<{ price: number; occurredAt: string; money: number | null }> | null;
  readonly marks?: readonly Readonly<{ price: number; occurredAt: string; money: number | null }>[];
  readonly protection: Readonly<{ verifiedStop: number | null; protectedQuantity: number; occurredAt: string }> | null;
  readonly lifecycle: readonly Readonly<{ state: string; occurredAt: string }>[];
  readonly currentState: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly dimensions: PositionDimensions;
  readonly ideaVersionId: string;
  readonly strategyMapVersionId: string | null;
}

export interface PositionAnalytics {
  readonly positionId: string;
  readonly tradeId: string;
  readonly originalColonyId: string;
  readonly currentColonyId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly currentState: string;
  readonly entryPrice: Metric<number>;
  readonly realizedPips: Metric<number>;
  readonly openPips: Metric<number>;
  readonly positionPips: Metric<number>;
  readonly protectedPips: Metric<number>;
  readonly realizedMoney: Metric<number>;
  readonly openMoney: Metric<number>;
  readonly totalMoney: Metric<number>;
  readonly reachedSurvivor: boolean;
  readonly reachedLeg: boolean;
  readonly isRunner: boolean;
  readonly legLifetimeMs: Metric<number>;
  readonly dimensions: PositionDimensions & Readonly<{ entryHour: number; weekday: string; direction: 'LONG' | 'SHORT' }>;
  readonly ideaVersionId: string;
  readonly strategyMapVersionId: string | null;
}

export interface AttemptAnalyticsInput {
  readonly attemptId: string;
  readonly result: 'EXPIRED' | 'FAILED' | 'SCRATCH' | 'SURVIVED' | null;
  readonly pipCost: number | null;
}

export interface ColonyAnalytics {
  readonly colonyId: string;
  readonly positionCount: number;
  readonly scoutCount: number;
  readonly attemptCount: number;
  readonly realizedPips: Metric<number>;
  readonly openPips: Metric<number>;
  readonly positionPips: Metric<number>;
  readonly scoutingCost: Metric<number>;
  readonly protectedPips: Metric<number>;
  readonly averageScoutLoss: Metric<number>;
  readonly survivorContribution: Metric<number>;
  readonly longestLivedLegMs: Metric<number>;
  readonly millipedeEfficiency: Metric<number>;
  readonly wins: number;
  readonly losses: number;
  readonly breakevens: number;
  readonly incompleteOutcomes: number;
}

const EPSILON = 1e-8;
const survivorStates = new Set(['SURVIVOR', 'PROTECTED', 'LEG', 'MATURE_LEG', 'RUNNER']);
const legStates = new Set(['LEG', 'MATURE_LEG', 'RUNNER']);

function finitePositive(value: number): boolean { return Number.isFinite(value) && value > 0; }
function sumAvailable(metrics: readonly Metric<number>[]): Metric<number> {
  const missing = metrics.find((metric) => metric.status === 'UNAVAILABLE');
  return missing?.status === 'UNAVAILABLE' ? unavailable(missing.reason) : available(metrics.reduce((sum, metric) => sum + (metric.value ?? 0), 0));
}
export function aggregateMetrics(metrics: readonly Metric<number>[]): Metric<number> { return sumAvailable(metrics); }
function signedPips(direction: 'LONG' | 'SHORT', from: number, to: number, pipSize: number): number {
  return (direction === 'LONG' ? to - from : from - to) / pipSize;
}

export function analyzePosition(input: PositionAnalyticsInput, asOf = new Date().toISOString()): PositionAnalytics {
  const entryQuantity = input.entryFills.reduce((sum, fill) => sum + fill.quantity, 0);
  const exitQuantity = input.exitFills.reduce((sum, fill) => sum + fill.quantity, 0);
  const entryPrice = finitePositive(entryQuantity)
    ? available(input.entryFills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0) / entryQuantity)
    : unavailable(METRIC_UNAVAILABLE_REASONS.noEntry);
  const quantitiesValid = finitePositive(input.pipSize) && input.currentQuantity >= -EPSILON &&
    Math.abs(entryQuantity - exitQuantity - input.currentQuantity) <= EPSILON;
  const terminal = input.closedAt !== null || ['CLOSED', 'FAILED', 'CONSOLIDATED'].includes(input.currentState);

  let realizedPips: Metric<number>;
  if (entryPrice.status === 'UNAVAILABLE') realizedPips = unavailable(entryPrice.reason);
  else if (!quantitiesValid) realizedPips = unavailable(METRIC_UNAVAILABLE_REASONS.quantityMismatch);
  else if (terminal && exitQuantity <= EPSILON && entryQuantity > EPSILON) realizedPips = unavailable(METRIC_UNAVAILABLE_REASONS.noExit);
  else if (exitQuantity <= EPSILON) realizedPips = available(0);
  else realizedPips = available(input.exitFills.reduce((sum, fill) => sum + fill.quantity * signedPips(input.direction, entryPrice.value, fill.price, input.pipSize), 0) / exitQuantity);

  let openPips: Metric<number>;
  if (input.currentQuantity <= EPSILON) openPips = available(0);
  else if (entryPrice.status === 'UNAVAILABLE') openPips = unavailable(entryPrice.reason);
  else if (!quantitiesValid) openPips = unavailable(METRIC_UNAVAILABLE_REASONS.quantityMismatch);
  else if (!input.mark) openPips = unavailable(METRIC_UNAVAILABLE_REASONS.noMark);
  else openPips = available(signedPips(input.direction, entryPrice.value, input.mark.price, input.pipSize));

  let positionPips: Metric<number>;
  if (entryPrice.status === 'UNAVAILABLE') positionPips = unavailable(entryPrice.reason);
  else if (!quantitiesValid) positionPips = unavailable(METRIC_UNAVAILABLE_REASONS.quantityMismatch);
  else {
    const realized = input.exitFills.reduce((sum, fill) => sum + fill.quantity * signedPips(input.direction, entryPrice.value, fill.price, input.pipSize), 0);
    if (input.currentQuantity > EPSILON && openPips.status === 'UNAVAILABLE') positionPips = unavailable(openPips.reason);
    else positionPips = available(realized + input.currentQuantity * (openPips.value ?? 0));
  }

  let protectedPips: Metric<number>;
  if (input.currentQuantity <= EPSILON) protectedPips = available(0);
  else if (entryPrice.status === 'UNAVAILABLE') protectedPips = unavailable(entryPrice.reason);
  else if (!input.protection) protectedPips = unavailable(METRIC_UNAVAILABLE_REASONS.noProtection);
  else if (input.protection.verifiedStop === null || input.protection.protectedQuantity <= EPSILON) protectedPips = available(0);
  else protectedPips = available(Math.max(0, signedPips(input.direction, entryPrice.value, input.protection.verifiedStop, input.pipSize)) * Math.min(1, input.protection.protectedQuantity / input.currentQuantity));

  const realizedMoney = realizedPips.status === 'UNAVAILABLE'
    ? unavailable(realizedPips.reason)
    : input.exitFills.some((fill) => fill.money === null)
      ? unavailable(METRIC_UNAVAILABLE_REASONS.noMoney)
      : available(input.exitFills.reduce((sum, fill) => sum + (fill.money ?? 0), 0));
  const openMoney = input.currentQuantity <= EPSILON
    ? available(0)
    : input.mark?.money === null || !input.mark
      ? unavailable(METRIC_UNAVAILABLE_REASONS.noMoney)
      : available(input.mark.money as number);
  const totalMoney = sumAvailable([realizedMoney, openMoney]);

  const stateTimeline = [{ state: 'SCOUT', occurredAt: input.openedAt }, ...input.lifecycle];
  const reachedSurvivor = stateTimeline.some((event) => survivorStates.has(event.state));
  const legStart = stateTimeline.find((event) => legStates.has(event.state))?.occurredAt ?? null;
  const legLifetimeMs = legStart === null
    ? unavailable(METRIC_UNAVAILABLE_REASONS.noLeg)
    : available(Math.max(0, Date.parse(input.closedAt ?? asOf) - Date.parse(legStart)));
  const opened = new Date(input.openedAt);

  return Object.freeze({
    positionId: input.positionId, tradeId: input.tradeId, originalColonyId: input.originalColonyId,
    currentColonyId: input.currentColonyId, direction: input.direction, currentState: input.currentState,
    entryPrice, realizedPips, openPips, positionPips, protectedPips, realizedMoney, openMoney, totalMoney,
    reachedSurvivor, reachedLeg: legStart !== null, isRunner: stateTimeline.some((event) => event.state === 'RUNNER'), legLifetimeMs,
    dimensions: Object.freeze({ ...input.dimensions, entryHour: opened.getUTCHours(), weekday: opened.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), direction: input.direction }),
    ideaVersionId: input.ideaVersionId, strategyMapVersionId: input.strategyMapVersionId,
  });
}

function aggregate(metrics: readonly Metric<number>[]): Metric<number> { return sumAvailable(metrics); }

export function analyzeColony(input: {
  readonly colonyId: string;
  readonly attempts: readonly AttemptAnalyticsInput[];
  readonly positions: readonly PositionAnalytics[];
}): ColonyAnalytics {
  const failedAttempts = input.attempts.filter((attempt) => attempt.result === 'FAILED' || attempt.result === 'SCRATCH');
  const scoutingCost = failedAttempts.some((attempt) => attempt.pipCost === null)
    ? unavailable(METRIC_UNAVAILABLE_REASONS.noScoutingCost)
    : available(failedAttempts.reduce((sum, attempt) => sum + Math.abs(attempt.pipCost ?? 0), 0));
  const scoutLosses = input.positions.filter((position): position is PositionAnalytics & { readonly realizedPips: Extract<Metric<number>, { status: 'AVAILABLE' }> } =>
    !position.reachedSurvivor && position.realizedPips.status === 'AVAILABLE' && position.realizedPips.value < -EPSILON);
  const averageScoutLoss = scoutLosses.length
    ? available(scoutLosses.reduce((sum, position) => sum + Math.abs(position.realizedPips.value), 0) / scoutLosses.length)
    : unavailable(METRIC_UNAVAILABLE_REASONS.noDenominator);
  const survivors = input.positions.filter((position) => position.reachedSurvivor);
  const survivorContribution = aggregate(survivors.map((position) => position.positionPips));
  const legLifetimes = input.positions.map((position) => position.legLifetimeMs).filter((metric): metric is Extract<Metric<number>, {status:'AVAILABLE'}> => metric.status === 'AVAILABLE');
  const longestLivedLegMs = legLifetimes.length ? available(Math.max(...legLifetimes.map((metric) => metric.value))) : unavailable(METRIC_UNAVAILABLE_REASONS.noLeg);
  const millipedeEfficiency = scoutingCost.status === 'AVAILABLE' && scoutingCost.value > EPSILON && survivorContribution.status === 'AVAILABLE'
    ? available(survivorContribution.value / scoutingCost.value)
    : unavailable(METRIC_UNAVAILABLE_REASONS.noDenominator);
  let wins = 0, losses = 0, breakevens = 0, incompleteOutcomes = 0;
  for (const position of input.positions.filter((item) => ['CLOSED', 'FAILED', 'CONSOLIDATED'].includes(item.currentState))) {
    if (position.realizedPips.status === 'UNAVAILABLE') { incompleteOutcomes += 1; continue; }
    if (position.realizedPips.value > EPSILON) wins += 1;
    else if (position.realizedPips.value < -EPSILON) losses += 1;
    else breakevens += 1;
  }
  return Object.freeze({
    colonyId: input.colonyId, positionCount: input.positions.length, scoutCount: input.positions.length, attemptCount: input.attempts.length,
    realizedPips: aggregate(input.positions.map((position) => position.realizedPips)),
    openPips: aggregate(input.positions.map((position) => position.openPips)),
    positionPips: aggregate(input.positions.map((position) => position.positionPips)),
    scoutingCost, protectedPips: aggregate(input.positions.map((position) => position.protectedPips)),
    averageScoutLoss, survivorContribution, longestLivedLegMs, millipedeEfficiency,
    wins, losses, breakevens, incompleteOutcomes,
  });
}

export type AnalyticsDimension = 'TIMEFRAME' | 'STRATEGY' | 'COMBO' | 'TEMPLATE' | 'ENTRY_HOUR' | 'WEEKDAY' | 'SESSION' | 'TAG' | 'DIRECTION' | 'QUALIFICATION';
export interface PerformanceGroup {
  readonly key: string;
  readonly dimension: AnalyticsDimension;
  readonly positions: number;
  readonly positionPips: Metric<number>;
  readonly realizedPips: Metric<number>;
  readonly wins: number;
  readonly losses: number;
  readonly breakevens: number;
}

function dimensionValues(position: PositionAnalytics, dimension: AnalyticsDimension): readonly string[] {
  switch (dimension) {
    case 'TIMEFRAME': return position.dimensions.timeframes;
    case 'STRATEGY': return position.dimensions.strategies;
    case 'COMBO': return position.dimensions.combos;
    case 'TEMPLATE': return position.dimensions.templates;
    case 'ENTRY_HOUR': return [String(position.dimensions.entryHour).padStart(2, '0')];
    case 'WEEKDAY': return [position.dimensions.weekday];
    case 'SESSION': return position.dimensions.session ? [position.dimensions.session] : [];
    case 'TAG': return position.dimensions.tags;
    case 'DIRECTION': return [position.direction];
    case 'QUALIFICATION': return position.dimensions.qualification ? [position.dimensions.qualification] : [];
  }
}

export function groupPerformance(positions: readonly PositionAnalytics[], dimension: AnalyticsDimension): Readonly<{ groups: readonly PerformanceGroup[]; unavailableCount: number }> {
  const grouped = new Map<string, PositionAnalytics[]>();
  let unavailableCount = 0;
  for (const position of positions) {
    const values = [...new Set(dimensionValues(position, dimension))];
    if (!values.length) { unavailableCount += 1; continue; }
    for (const value of values) grouped.set(value, [...(grouped.get(value) ?? []), position]);
  }
  const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, members]): PerformanceGroup => {
    let wins = 0, losses = 0, breakevens = 0;
    for (const member of members) {
      if (member.realizedPips.status === 'UNAVAILABLE') continue;
      if (member.realizedPips.value > EPSILON) wins += 1;
      else if (member.realizedPips.value < -EPSILON) losses += 1;
      else if (['CLOSED', 'FAILED', 'CONSOLIDATED'].includes(member.currentState)) breakevens += 1;
    }
    return Object.freeze({ key, dimension, positions: members.length, positionPips: aggregate(members.map((item) => item.positionPips)), realizedPips: aggregate(members.map((item) => item.realizedPips)), wins, losses, breakevens });
  });
  return Object.freeze({ groups: Object.freeze(groups), unavailableCount });
}

export interface PerformanceCurvePoint {
  readonly occurredAt: string;
  readonly positionId: string;
  readonly pips: number;
  readonly positionPips: number;
  readonly money: number | null;
}

export function buildPerformanceCurve(inputs: readonly PositionAnalyticsInput[]): readonly PerformanceCurvePoint[] {
  const points = inputs.flatMap((input) => {
    const quantity = input.entryFills.reduce((sum, fill) => sum + fill.quantity, 0);
    if (!finitePositive(quantity) || !finitePositive(input.pipSize)) return [];
    const entry = input.entryFills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0) / quantity;
    return input.exitFills.map((fill) => {
      const pips = signedPips(input.direction, entry, fill.price, input.pipSize);
      return { occurredAt: fill.occurredAt, positionId: input.positionId, pips, positionPips: pips * fill.quantity, money: fill.money };
    });
  }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.positionId.localeCompare(b.positionId));
  let pips = 0, positionPips = 0, money = 0, moneyAvailable = true;
  return Object.freeze(points.map((point) => {
    pips += point.pips; positionPips += point.positionPips;
    if (point.money === null) moneyAvailable = false; else money += point.money;
    return Object.freeze({ occurredAt: point.occurredAt, positionId: point.positionId, pips, positionPips, money: moneyAvailable ? money : null });
  }));
}

export interface EquityCurvePoint {
  readonly occurredAt: string;
  readonly pips: number | null;
  readonly positionPips: number | null;
  readonly money: number | null;
}

/**
 * Replays immutable exits and timestamped marks. Equity is unavailable at a
 * point when any then-open Position lacks a mark; that gap is never plotted as zero.
 */
export function buildEquityCurve(inputs: readonly PositionAnalyticsInput[]): readonly EquityCurvePoint[] {
  const times = [...new Set(inputs.flatMap((input) => [...input.exitFills.map((fill) => fill.occurredAt), ...(input.marks ?? (input.mark ? [input.mark] : [])).map((mark) => mark.occurredAt)]))].sort();
  return Object.freeze(times.map((occurredAt) => {
    let realizedPips = 0, realizedPositionPips = 0, realizedMoney = 0;
    let pipsAvailable = true, moneyAvailable = true, openPips = 0, openPositionPips = 0, openMoney = 0;
    for (const input of inputs) {
      const entries = input.entryFills.filter((fill) => fill.occurredAt <= occurredAt);
      const entryQuantity = entries.reduce((sum, fill) => sum + fill.quantity, 0);
      if (entryQuantity <= EPSILON) continue;
      const entry = entries.reduce((sum, fill) => sum + fill.quantity * fill.price, 0) / entryQuantity;
      const exits = input.exitFills.filter((fill) => fill.occurredAt <= occurredAt);
      const closedQuantity = exits.reduce((sum, fill) => sum + fill.quantity, 0);
      for (const exit of exits) {
        const pips = signedPips(input.direction, entry, exit.price, input.pipSize);
        realizedPips += pips; realizedPositionPips += pips * exit.quantity;
        if (exit.money === null) moneyAvailable = false; else realizedMoney += exit.money;
      }
      const remaining = entryQuantity - closedQuantity;
      if (remaining <= EPSILON) continue;
      const marks = (input.marks ?? (input.mark ? [input.mark] : [])).filter((mark) => mark.occurredAt <= occurredAt).sort((a,b) => a.occurredAt.localeCompare(b.occurredAt));
      const mark = marks.at(-1);
      if (!mark) { pipsAvailable = false; moneyAvailable = false; continue; }
      const pips = signedPips(input.direction, entry, mark.price, input.pipSize);
      openPips += pips; openPositionPips += pips * remaining;
      if (mark.money === null) moneyAvailable = false; else openMoney += mark.money;
    }
    return Object.freeze({ occurredAt, pips: pipsAvailable ? realizedPips + openPips : null, positionPips: pipsAvailable ? realizedPositionPips + openPositionPips : null, money: moneyAvailable ? realizedMoney + openMoney : null });
  }));
}

export type PnlDisplayMode = 'PIP-FIRST' | 'PIPS + MONEY' | 'MONEY-FIRST' | '$ HIDDEN';
export function presentMoney(metric: Metric<number>, mode: PnlDisplayMode): Readonly<{ state: 'HIDDEN' | 'UNAVAILABLE' | 'VISIBLE'; value: number | null; reason: string | null }> {
  if (mode === '$ HIDDEN') return Object.freeze({ state: 'HIDDEN', value: null, reason: 'Money is hidden by the global presentation preference.' });
  if (metric.status === 'UNAVAILABLE') return Object.freeze({ state: 'UNAVAILABLE', value: null, reason: metric.reason });
  return Object.freeze({ state: 'VISIBLE', value: metric.value, reason: null });
}
