export type ExecutionMode = 'SHADOW' | 'DEMO';
export type ExecutionDirection = 'LONG' | 'SHORT';
export type ValidationStatus = 'PASS' | 'BLOCK' | 'ERROR';

export interface ExecutionIntent {
  readonly id: string;
  readonly proposalCorrelationId: string;
  readonly strategyRuntimeId: string;
  readonly runtimeNodeId: string;
  readonly colonyId: string;
  readonly ideaVersionId: string;
  readonly strategyMapVersionId: string;
  readonly mode: ExecutionMode;
  readonly canonicalSymbol: string;
  readonly direction: ExecutionDirection;
  readonly gearId: string;
  readonly lots: number;
  readonly initialStop: number;
  readonly maxSpreadPips: number;
  readonly createdAt: string;
  readonly expiresAt: string;
}
export interface ExecutionHealth {
  readonly connection:
    | 'CONNECTED'
    | 'DEGRADED'
    | 'DISCONNECTED'
    | 'RECONNECTING'
    | 'RECONCILING'
    | 'BLOCKED';
  readonly truth: 'VERIFIED' | 'UNKNOWN';
  readonly reconciliation: 'MATCHED' | 'RECOVERY_REQUIRED' | 'UNKNOWN';
  readonly terminalConnected: boolean;
  readonly protocolCompatible: boolean;
  readonly accountKey: string | null;
  readonly accountIsLive: boolean | null;
  readonly sessionId: string | null;
  readonly brokerSymbol: string | null;
  readonly quote: {
    readonly bid: number;
    readonly ask: number;
    readonly receivedAt: string;
    readonly sequence: number;
  } | null;
  readonly deploymentApproved: boolean;
  readonly colonyActive: boolean;
  readonly ideaActive: boolean;
  readonly attemptBudgetAvailable: boolean;
  readonly stackingEligible: boolean;
  readonly riskFresh: boolean;
  readonly sessionPermitted: boolean;
  readonly newsPermitted: boolean;
  readonly spreadPermitted: boolean;
  readonly instrumentPermitted: boolean;
  readonly sizePermitted: boolean;
  readonly stopPermitted: boolean;
  readonly duplicateAbsent: boolean;
  readonly executionStateSafe: boolean;
}
export interface ValidationCheck {
  readonly key: string;
  readonly status: ValidationStatus;
  readonly detail: string;
}
export interface ExecutionValidation {
  readonly id: string;
  readonly intentId: string;
  readonly status: ValidationStatus;
  readonly checks: readonly ValidationCheck[];
  readonly evaluatedAt: string;
}
export interface OrderPlan {
  readonly id: string;
  readonly intentId: string;
  readonly proposalCorrelationId: string;
  readonly mode: ExecutionMode;
  readonly accountKey: string | null;
  readonly expectedSessionId: string | null;
  readonly brokerSymbol: string;
  readonly canonicalSymbol: string;
  readonly direction: ExecutionDirection;
  readonly requestedVolume: number;
  readonly gearId: string;
  readonly entryType: 'MARKET';
  readonly initialStop: number;
  readonly maxSpreadPips: number;
  readonly quote: {
    readonly bid: number;
    readonly ask: number;
    readonly receivedAt: string;
    readonly sequence: number;
  };
  readonly colonyId: string;
  readonly ideaVersionId: string;
  readonly strategyRuntimeId: string;
  readonly runtimeNodeId: string;
  readonly strategyMapVersionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

const freeze = <T extends object>(value: T): Readonly<T> =>
  Object.freeze(value);
const check = (key: string, ok: boolean, detail: string): ValidationCheck =>
  freeze({ key, status: ok ? 'PASS' : 'BLOCK', detail });
export function createExecutionIntent(input: ExecutionIntent): ExecutionIntent {
  if (input.mode !== 'SHADOW' && input.mode !== 'DEMO')
    throw new Error('LIVE execution is unavailable in M10');
  for (const [key, value] of Object.entries(input))
    if (typeof value === 'string' && !value.trim())
      throw new Error(`${key} is required`);
  if (!Number.isFinite(input.lots) || input.lots <= 0)
    throw new Error('Fixed lot size must be positive');
  if (!Number.isFinite(input.initialStop))
    throw new Error('Initial stop is required');
  if (!Number.isFinite(input.maxSpreadPips) || input.maxSpreadPips < 0)
    throw new Error('Maximum spread must be non-negative');
  if (Date.parse(input.expiresAt) <= Date.parse(input.createdAt))
    throw new Error('Intent expiry must follow creation');
  return freeze({ ...input });
}
export function validateExecution(
  intent: ExecutionIntent,
  health: ExecutionHealth,
  id: string,
  evaluatedAt: string,
): ExecutionValidation {
  const brokerRequired = intent.mode === 'DEMO';
  const transport = (key: string, ok: boolean, detail: string) =>
    check(
      key,
      !brokerRequired || ok,
      brokerRequired
        ? detail
        : 'Not required for SHADOW; no broker mutation will be sent',
    );
  const checks: ValidationCheck[] = [
    check(
      'RUNTIME_MODE',
      intent.mode === 'SHADOW' || intent.mode === 'DEMO',
      'Only SHADOW and DEMO are enabled in M10',
    ),
    check(
      'INTENT_NOT_EXPIRED',
      Date.parse(intent.expiresAt) > Date.parse(evaluatedAt),
      'Candidate/intent is within its immutable expiry',
    ),
    check(
      'DEPLOYMENT_PERMISSION',
      health.deploymentApproved,
      'Exact strategy versions are approved for requested mode',
    ),
    check(
      'COLONY_ACTIVE',
      health.colonyActive,
      'Colony permits another participation attempt',
    ),
    check(
      'IDEA_ACTIVE',
      health.ideaActive,
      'Parent Idea remains operationally valid',
    ),
    check(
      'ATTEMPT_BUDGET',
      health.attemptBudgetAvailable,
      'Attempt budget is available',
    ),
    check(
      'STACKING_ELIGIBILITY',
      health.stackingEligible,
      'Stacking rule permits participation',
    ),
    check(
      'RISK_FRESH',
      health.riskFresh,
      'Fixed-size Gear/risk inputs are fresh',
    ),
    check(
      'SESSION_PERMISSION',
      health.sessionPermitted,
      'Trading session permits entry',
    ),
    check('NEWS_PERMISSION', health.newsPermitted, 'News policy permits entry'),
    check(
      'SPREAD',
      health.spreadPermitted,
      'Spread is within the immutable plan threshold',
    ),
    check(
      'INSTRUMENT_PERMISSION',
      health.instrumentPermitted,
      'Instrument is permitted',
    ),
    check(
      'FIXED_SIZE',
      health.sizePermitted,
      'Fixed lot size matches broker constraints',
    ),
    check(
      'INITIAL_STOP',
      health.stopPermitted,
      'Initial stop is valid for direction and broker distance',
    ),
    check(
      'DUPLICATE_EXPOSURE',
      health.duplicateAbsent,
      'No prior intent/plan owns this proposal',
    ),
    transport(
      'EXECUTION_RECOVERY',
      health.executionStateSafe,
      'No unresolved execution lifecycle may create additional exposure',
    ),
    transport(
      'AGENT_CONNECTION',
      health.connection === 'CONNECTED',
      'MT5 Agent session must be CONNECTED',
    ),
    transport(
      'BROKER_TRUTH',
      health.truth === 'VERIFIED',
      'Broker truth must be VERIFIED',
    ),
    transport(
      'RECONCILIATION',
      health.reconciliation === 'MATCHED',
      'Reconciliation must be MATCHED',
    ),
    transport(
      'TERMINAL',
      health.terminalConnected,
      'MT5 terminal must be connected',
    ),
    transport(
      'PROTOCOL',
      health.protocolCompatible,
      'Desktop and Agent protocol must be compatible',
    ),
    transport(
      'ACCOUNT',
      health.accountKey !== null && !health.accountIsLive,
      'A known non-live account is required',
    ),
    transport(
      'SESSION_IDENTITY',
      health.sessionId !== null,
      'A current Agent session identity is required',
    ),
    transport(
      'INSTRUMENT_MAPPING',
      health.brokerSymbol !== null,
      'Canonical symbol must map to a broker instrument',
    ),
    transport(
      'QUOTE_FRESH',
      health.quote !== null &&
        Date.parse(evaluatedAt) - Date.parse(health.quote.receivedAt) <= 5000,
      'Broker quote must be no more than five seconds old',
    ),
  ];
  const status: ValidationStatus = checks.some(
    (item) => item.status === 'ERROR',
  )
    ? 'ERROR'
    : checks.some((item) => item.status === 'BLOCK')
      ? 'BLOCK'
      : 'PASS';
  return freeze({
    id,
    intentId: intent.id,
    status,
    checks: Object.freeze(checks),
    evaluatedAt,
  });
}
export function createOrderPlan(input: {
  readonly id: string;
  readonly intent: ExecutionIntent;
  readonly validation: ExecutionValidation;
  readonly health: ExecutionHealth;
}): OrderPlan {
  if (
    input.validation.intentId !== input.intent.id ||
    input.validation.status !== 'PASS'
  )
    throw new Error(
      'OrderPlan requires a passing validation for the same intent',
    );
  const quote = input.health.quote ?? {
    bid: 0,
    ask: 0,
    receivedAt: input.validation.evaluatedAt,
    sequence: 0,
  };
  return freeze({
    id: input.id,
    intentId: input.intent.id,
    proposalCorrelationId: input.intent.proposalCorrelationId,
    mode: input.intent.mode,
    accountKey: input.intent.mode === 'DEMO' ? input.health.accountKey : null,
    expectedSessionId:
      input.intent.mode === 'DEMO' ? input.health.sessionId : null,
    brokerSymbol: input.health.brokerSymbol ?? input.intent.canonicalSymbol,
    canonicalSymbol: input.intent.canonicalSymbol,
    direction: input.intent.direction,
    requestedVolume: input.intent.lots,
    gearId: input.intent.gearId,
    entryType: 'MARKET',
    initialStop: input.intent.initialStop,
    maxSpreadPips: input.intent.maxSpreadPips,
    quote: freeze({ ...quote }),
    colonyId: input.intent.colonyId,
    ideaVersionId: input.intent.ideaVersionId,
    strategyRuntimeId: input.intent.strategyRuntimeId,
    runtimeNodeId: input.intent.runtimeNodeId,
    strategyMapVersionId: input.intent.strategyMapVersionId,
    createdAt: input.validation.evaluatedAt,
    expiresAt: input.intent.expiresAt,
  });
}
