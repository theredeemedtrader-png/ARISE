/* eslint-disable @typescript-eslint/no-explicit-any -- action parameter and SQLite validation occurs at this boundary. */
import { randomUUID } from 'node:crypto';
import {
  createExecutionIntent,
  createOrderPlan,
  validateExecution,
  evaluateColonyAutomation,
  type ExecutionHealth,
} from '@arise/execution';
import type { ExecutionRepository, Mt5Repository } from '@arise/database';
import type { Mt5ReadOnlyClient } from './mt5-client.js';
interface SqliteDatabase {
  prepare(sql: string): { get(...values: unknown[]): unknown };
}

const requiredString = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`CREATE_SCOUT requires ${name}`);
  return value;
};
const requiredNumber = (value: unknown, name: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`CREATE_SCOUT requires finite ${name}`);
  return value;
};
export class ExecutionGateway {
  constructor(
    private readonly sqlite: SqliteDatabase,
    private readonly mt5: Mt5Repository,
    private readonly executions: ExecutionRepository,
    private readonly client: Mt5ReadOnlyClient,
  ) {}
  executeProposal(correlationId: string): unknown {
    if (
      this.sqlite
        .prepare(
          'SELECT 1 FROM execution_intents WHERE proposal_correlation_id=?',
        )
        .get(correlationId)
    )
      return this.executions.workspace();
    const proposal = this.sqlite
      .prepare('SELECT * FROM runtime_action_proposals WHERE correlation_id=?')
      .get(correlationId) as any;
    if (!proposal) throw new Error('Action Proposal not found');
    if (proposal.action_kind !== 'CREATE_SCOUT')
      throw new Error('M10 only executes CREATE_SCOUT proposals');
    const runtime = this.sqlite
      .prepare('SELECT * FROM strategy_runtimes WHERE id=?')
      .get(proposal.strategy_runtime_id) as any;
    if (!runtime) throw new Error('Strategy Runtime not found');
    if (runtime.mode === 'LIVE')
      throw new Error('LIVE remains unavailable in M10');
    if (runtime.mode !== 'SHADOW' && runtime.mode !== 'DEMO')
      throw new Error('Only SHADOW or DEMO proposals can be planned');
    const colony = this.sqlite
      .prepare(
        'SELECT c.*,i.current_status idea_status,iv.direction idea_direction FROM colonies c JOIN ideas i ON i.id=c.idea_id JOIN idea_versions iv ON iv.id=c.original_idea_version_id WHERE c.id=?',
      )
      .get(runtime.colony_id) as any;
    if (!colony) throw new Error('Colony not found');
    const parameters = JSON.parse(proposal.parameters_json) as Record<
        string,
        unknown
      >,
      createdAt = new Date().toISOString();
    const expiresInSeconds = requiredNumber(
      parameters.expiresInSeconds,
      'expiresInSeconds',
    );
    if (expiresInSeconds <= 0 || expiresInSeconds > 3600)
      throw new Error('expiresInSeconds must be between 0 and 3600');
    const maxSpread = requiredNumber(parameters.maxSpreadPips, 'maxSpreadPips');
    const direction = requiredString(parameters.direction, 'direction');
    if (direction !== 'LONG' && direction !== 'SHORT')
      throw new Error('CREATE_SCOUT direction must be LONG or SHORT');
    const intent = createExecutionIntent({
      id: randomUUID(),
      proposalCorrelationId: correlationId,
      strategyRuntimeId: runtime.id,
      runtimeNodeId: proposal.runtime_node_id,
      colonyId: runtime.colony_id,
      ideaVersionId: colony.original_idea_version_id,
      strategyMapVersionId: runtime.strategy_map_version_id,
      mode: runtime.mode,
      canonicalSymbol: requiredString(
        parameters.canonicalSymbol,
        'canonicalSymbol',
      ),
      direction,
      gearId: requiredString(parameters.gearId, 'gearId'),
      lots: requiredNumber(parameters.lots, 'lots'),
      initialStop: requiredNumber(parameters.initialStop, 'initialStop'),
      maxSpreadPips: maxSpread,
      createdAt,
      expiresAt: new Date(
        Date.parse(createdAt) + expiresInSeconds * 1000,
      ).toISOString(),
    });
    const workspace = this.mt5.workspace(),
      mapping =
        workspace.symbols.find(
          (item) => item.canonicalSymbol === intent.canonicalSymbol,
        ) ?? null,
      quote =
        workspace.quotes.find(
          (item) => item.canonicalSymbol === intent.canonicalSymbol,
        ) ?? null;
    const map = this.sqlite
      .prepare('SELECT graph_json FROM strategy_map_versions WHERE id=?')
      .get(runtime.strategy_map_version_id) as { graph_json: string };
    const graph = JSON.parse(map.graph_json) as {
      nodes: Array<{ family: string; strategyVersionId?: string }>;
    };
    const versionIds = [
      ...new Set(
        graph.nodes
          .filter((node) => node.family === 'STRATEGY')
          .map((node) => node.strategyVersionId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const statuses = versionIds.map(
      (id) =>
        (
          this.sqlite
            .prepare(
              'SELECT deployment_status FROM strategy_versions WHERE id=?',
            )
            .get(id) as { deployment_status: string } | undefined
        )?.deployment_status ?? 'MISSING',
    );
    const accepted =
      runtime.mode === 'DEMO'
        ? new Set(['DEMO_APPROVED', 'LIVE_APPROVED'])
        : new Set(['VALIDATED', 'DEMO_APPROVED', 'LIVE_APPROVED']);
    const budget = this.sqlite
      .prepare(
        'SELECT max_attempts,max_scouting_loss_pips,current_period_key,updated_at FROM attempt_budgets WHERE colony_id=? ORDER BY updated_at DESC LIMIT 1',
      )
      .get(runtime.colony_id) as { max_attempts: number | null; max_scouting_loss_pips: number | null; current_period_key: string; updated_at: string } | undefined;
    const automation = this.sqlite.prepare(`SELECT a.*,p.mode,p.config_json
      FROM colony_automation_assignments a JOIN stacking_policy_versions p ON p.id=a.stacking_policy_version_id
      WHERE a.colony_id=?`).get(runtime.colony_id) as any;
    const attemptSince = automation?.updated_at ?? budget?.updated_at ?? '0000';
    const attemptFacts = this.sqlite.prepare(`SELECT COUNT(*) count,
      COALESCE(SUM(CASE WHEN result='FAILED' THEN ABS(COALESCE(pip_cost,0)) ELSE 0 END),0) scouting_loss,
      MAX(started_at) last_attempt_at
      FROM attempts WHERE colony_id=? AND started_at>=?`).get(runtime.colony_id, attemptSince) as { count: number; scouting_loss: number; last_attempt_at: string|null };
    const exposureFacts = this.sqlite.prepare(`SELECT
      COALESCE(SUM(CASE WHEN p.current_state NOT IN ('CLOSED','FAILED','CONSOLIDATED') THEN 1 ELSE 0 END),0) active_exposure,
      MAX(CASE WHEN p.current_state IN ('SURVIVOR','PROTECTED','LEG','MATURE_LEG','RUNNER') THEN 1 ELSE 0 END) has_survivor,
      MAX(CASE WHEN pc.state='PROTECTED' THEN 1 ELSE 0 END) has_protected,
      MAX(CASE WHEN p.current_state IN ('LEG','MATURE_LEG','RUNNER') THEN 1 ELSE 0 END) has_leg
      FROM positions p JOIN trades t ON t.id=p.trade_id LEFT JOIN position_protection_current pc ON pc.position_id=p.id
      WHERE p.current_colony_id=? AND t.source_type='ARISE_AUTO'`).get(runtime.colony_id) as { active_exposure: number; has_survivor: number|null; has_protected: number|null; has_leg: number|null };
    const policyConfig = automation ? JSON.parse(automation.config_json) as Record<string, unknown> : {};
    const policyCooldown = attemptFacts.last_attempt_at && typeof policyConfig.cooldownSeconds === 'number'
      ? new Date(Date.parse(attemptFacts.last_attempt_at) + policyConfig.cooldownSeconds * 1000).toISOString()
      : null;
    const effectiveCooldown = [automation?.cooldown_until ?? null, policyCooldown]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
    const automationEligibility = automation
      ? evaluateColonyAutomation({
          thesisValid: automation.entry_armed === 1 && !['INVALIDATED','COMPLETED'].includes(colony.current_state),
          countertrend: colony.idea_direction !== 'NEUTRAL' && colony.idea_direction !== direction,
          mode: automation.mode,
          manualApproved: parameters.manualStackingApproved === true,
          hasSurvivor: exposureFacts.has_survivor === 1,
          hasProtected: exposureFacts.has_protected === 1,
          hasLeg: exposureFacts.has_leg === 1,
          attemptsUsed: attemptFacts.count,
          maxAttempts: budget && budget.current_period_key === automation.current_period_key ? budget.max_attempts : budget ? 0 : null,
          scoutingLossPips: attemptFacts.scouting_loss,
          maxScoutingLossPips: budget?.max_scouting_loss_pips ?? null,
          activeExposure: exposureFacts.active_exposure,
          maxConcurrentExposure: typeof policyConfig.maxConcurrentExposure === 'number' ? policyConfig.maxConcurrentExposure : null,
          cooldownUntil: effectiveCooldown,
          evaluatedAt: createdAt,
        })
      : null;
    const spread =
      quote && mapping ? (quote.ask - quote.bid) / mapping.pipSize : 0;
    const entry = direction === 'LONG' ? quote?.ask : quote?.bid;
    const shadow = runtime.mode === 'SHADOW';
    const reference =
      typeof parameters.referencePrice === 'number'
        ? parameters.referencePrice
        : entry;
    const unresolved = this.sqlite
      .prepare(
        "SELECT 1 FROM execution_lifecycles WHERE state IN ('COMMAND_PENDING','SENT','ACKNOWLEDGED','PARTIALLY_FILLED','FILLED','PROTECTING','UNKNOWN') LIMIT 1",
      )
      .get();
    const health: ExecutionHealth = {
      connection: workspace.connection.state,
      truth: workspace.connection.truth,
      reconciliation: workspace.reconciliation.status,
      terminalConnected: workspace.connection.terminalConnected,
      protocolCompatible: workspace.connection.state !== 'BLOCKED',
      accountKey: workspace.account?.accountKey ?? null,
      accountIsLive: workspace.account?.isLive ?? null,
      sessionId: workspace.connection.sessionId,
      brokerSymbol: mapping?.brokerSymbol ?? null,
      quote: quote
        ? {
            bid: quote.bid,
            ask: quote.ask,
            receivedAt: quote.receivedAt,
            sequence: quote.sequence,
          }
        : shadow && reference !== undefined
          ? {
              bid: reference,
              ask: reference,
              receivedAt: createdAt,
              sequence: 0,
            }
          : null,
      deploymentApproved:
        versionIds.length > 0 &&
        statuses.every((status) => accepted.has(status)),
      colonyActive: !['INVALIDATED', 'COMPLETED'].includes(
        colony.current_state,
      ),
      ideaActive: ![
        'INVALIDATED',
        'COMPLETED',
        'CANCELLED',
        'ARCHIVED',
      ].includes(colony.idea_status),
      attemptBudgetAvailable:
        !budget ||
        ((budget.max_attempts === null || attemptFacts.count < budget.max_attempts) &&
          (budget.max_scouting_loss_pips === null || attemptFacts.scouting_loss < budget.max_scouting_loss_pips) &&
          (!automation || budget.current_period_key === automation.current_period_key)),
      stackingEligible: automationEligibility?.eligible ?? parameters.stackingEligible === true,
      riskFresh: parameters.riskFresh === true,
      sessionPermitted: parameters.sessionPermitted === true,
      newsPermitted: parameters.newsPermitted === true,
      spreadPermitted: shadow || spread <= maxSpread,
      instrumentPermitted: shadow || mapping !== null,
      sizePermitted:
        shadow ||
        (Boolean(mapping) &&
          intent.lots >= mapping!.minVolume &&
          intent.lots <= mapping!.maxVolume &&
          Math.abs(
            intent.lots / mapping!.volumeStep -
              Math.round(intent.lots / mapping!.volumeStep),
          ) < 1e-8),
      stopPermitted:
        reference !== undefined &&
        (direction === 'LONG'
          ? intent.initialStop < reference
          : intent.initialStop > reference),
      duplicateAbsent: true,
      executionStateSafe: shadow || !unresolved,
    };
    const validation = validateExecution(
      intent,
      health,
      randomUUID(),
      createdAt,
    );
    this.executions.persistIntentValidation(intent, validation);
    if (validation.status !== 'PASS') return this.executions.workspace();
    const plan = createOrderPlan({
      id: randomUUID(),
      intent,
      validation,
      health,
    });
    this.executions.persistPlan(plan, {
      strategyMapVersionId: runtime.strategy_map_version_id,
      strategyVersionIds: versionIds,
      ideaVersionId: intent.ideaVersionId,
    });
    if (plan.mode === 'DEMO')
      this.client.sendExecutionCommand(this.executions.createCommand(plan));
    return this.executions.workspace();
  }
  workspace(): unknown {
    return this.executions.workspace();
  }
}
