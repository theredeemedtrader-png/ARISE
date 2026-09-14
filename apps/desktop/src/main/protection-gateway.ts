import { randomUUID } from 'node:crypto';
import {
  validateProtectionProposal,
  calculateProtectionAction,
  thesisInvalidationOutcome,
  type ProtectionPositionFact,
  type ProtectionProposal,
} from '@arise/execution';
import type { Mt5Repository, ProtectionRepository } from '@arise/database';
import type {
  ProtectionRuleVersionRecord,
  ProtectionTriggerRecord,
} from '@arise/database';
import type { Mt5ReadOnlyClient } from './mt5-client.js';

interface SqliteDatabase {
  prepare(sql: string): {
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
  };
}

export class ProtectionGateway {
  constructor(
    private readonly sqlite: SqliteDatabase,
    private readonly mt5: Mt5Repository,
    private readonly protection: ProtectionRepository,
    private readonly client: Mt5ReadOnlyClient,
  ) {}

  createRule(rule: ProtectionRuleVersionRecord): Readonly<Record<string, unknown>> {
    this.protection.persistRuleVersion(rule);
    return this.workspace();
  }

  recordTrigger(trigger: ProtectionTriggerRecord): Readonly<Record<string, unknown>> {
    this.protection.recordTrigger(trigger);
    return this.workspace();
  }

  configureColony(input: Parameters<ProtectionRepository['configureColony']>[0]): Readonly<Record<string, unknown>> {
    this.protection.configureColony(input);
    return this.workspace();
  }

  invalidateThesis(colonyId: string, occurredAt: string, correlationId: string): Readonly<Record<string, unknown>> {
    const policy = this.protection.invalidateThesis(colonyId, occurredAt, correlationId);
    const outcome = thesisInvalidationOutcome(policy);
    if (outcome.positionAction) {
      const assignment = this.sqlite.prepare(`SELECT policy.config_json FROM colony_automation_assignments assignment
        JOIN stacking_policy_versions policy ON policy.id=assignment.stacking_policy_version_id WHERE assignment.colony_id=?`).get(colonyId) as { config_json: string } | undefined;
      const config = assignment ? JSON.parse(assignment.config_json) as Record<string, unknown> : {};
      const ruleVersionId = typeof config.invalidationRuleVersionId === 'string' ? config.invalidationRuleVersionId : null;
      if (!ruleVersionId) {
        this.protection.recordAutomationEvent(colonyId, 'INVALIDATION_ACTION_BLOCKED', { policy, reason: 'Explicit immutable invalidationRuleVersionId is required' }, occurredAt, correlationId);
        return this.workspace();
      }
      const rule = this.sqlite.prepare('SELECT action_type FROM protection_rule_versions WHERE id=?').get(ruleVersionId) as { action_type: string } | undefined;
      if (!rule || rule.action_type !== outcome.positionAction) {
        this.protection.recordAutomationEvent(colonyId, 'INVALIDATION_ACTION_BLOCKED', { policy, ruleVersionId, reason: 'Configured rule action does not match invalidation policy' }, occurredAt, correlationId);
        return this.workspace();
      }
      const triggerEventId = randomUUID();
      this.protection.recordTrigger({ id: triggerEventId, ruleVersionId, sourceType: 'POSITION_STATE', sourceId: colonyId, payload: { policy }, occurredAt, correlationId });
      const positions = this.sqlite.prepare(`SELECT p.id,p.broker_position_key,COALESCE(pc.last_applied_sequence,0) sequence_no
        FROM positions p JOIN trades t ON t.id=p.trade_id LEFT JOIN position_protection_current pc ON pc.position_id=p.id
        WHERE p.current_colony_id=? AND t.source_type='ARISE_AUTO' AND p.current_state NOT IN ('CLOSED','FAILED','CONSOLIDATED')`).all(colonyId) as Array<{id:string;broker_position_key:string;sequence_no:number}>;
      const mode = config.managementMode === 'DEMO' ? 'DEMO' : 'SHADOW';
      for (const position of positions)
        this.executeProposal({
          proposalId: randomUUID(), ruleVersionId, triggerEventId, positionId: position.id,
          brokerPositionKey: position.broker_position_key, action: outcome.positionAction,
          requestedStop: null, requestedTakeProfit: null, requestedCloseVolume: null,
          convertToRunner: false, sequence: position.sequence_no + 1, createdAt: occurredAt,
        }, mode);
    }
    return this.workspace();
  }

  setCooldown(colonyId: string, cooldownUntil: string | null, occurredAt: string, correlationId: string): Readonly<Record<string, unknown>> {
    this.protection.setCooldown(colonyId, cooldownUntil, occurredAt, correlationId);
    return this.workspace();
  }

  resetAttemptPeriod(colonyId: string, periodKey: string, occurredAt: string, correlationId: string): Readonly<Record<string, unknown>> {
    this.protection.resetAttemptPeriod(colonyId, periodKey, occurredAt, correlationId);
    return this.workspace();
  }

  executeProposal(proposal: ProtectionProposal, mode: 'SHADOW' | 'DEMO'): Readonly<Record<string, unknown>> {
    const rule = this.sqlite.prepare('SELECT action_type,allow_worsening,config_json FROM protection_rule_versions WHERE id=?').get(proposal.ruleVersionId) as { action_type: string; allow_worsening: number; config_json: string } | undefined;
    const trigger = this.sqlite.prepare('SELECT rule_version_id FROM protection_trigger_events WHERE id=?').get(proposal.triggerEventId) as { rule_version_id: string } | undefined;
    if (!rule || !trigger || trigger.rule_version_id !== proposal.ruleVersionId || rule.action_type !== proposal.action)
      throw new Error('Protection proposal must resolve one exact rule version and trigger event');
    if (rule.allow_worsening !== 0) throw new Error('Protection-worsening rules are unavailable in M11');
    const local = this.sqlite.prepare(`SELECT p.*,t.source_type FROM positions p JOIN trades t ON t.id=p.trade_id WHERE p.id=?`).get(proposal.positionId) as Record<string, unknown> | undefined;
    if (!local) throw new Error(`Position ${proposal.positionId} not found`);
    const workspace = this.mt5.workspace();
    const brokerPosition = workspace.positions.find((item) => item.brokerPositionKey === proposal.brokerPositionKey);
    const symbol = brokerPosition
      ? workspace.symbols.find((item) => item.brokerSymbol === brokerPosition.brokerSymbol)
      : null;
    const quote = brokerPosition
      ? workspace.quotes.find((item) => item.brokerSymbol === brokerPosition.brokerSymbol)
      : null;
    const projection = this.sqlite.prepare('SELECT * FROM position_protection_current WHERE position_id=?').get(proposal.positionId) as Record<string, unknown> | undefined;
    const fillRows = this.sqlite.prepare(`SELECT f.volume,f.price FROM execution_position_links link
      JOIN execution_fills f ON f.order_plan_id=link.order_plan_id WHERE link.position_id=? ORDER BY f.cumulative_volume`).all(proposal.positionId) as Array<{volume:number;price:number}>;
    const costs = this.sqlite.prepare('SELECT COALESCE(SUM(amount_money),0) total FROM broker_position_cost_events WHERE position_id=?').get(proposal.positionId) as { total: number };
    const fills = fillRows.map((fill,index)=>({volume:fill.volume,price:fill.price,costMoney:index===0?costs.total:0}));
    const config = JSON.parse(rule.config_json) as Record<string, unknown>;
    const source = local.source_type === 'ARISE_AUTO' ? 'ARISE_AUTO' : local.source_type === 'ARISE_MANUAL' ? 'ARISE_MANUAL' : 'MT5_EXTERNAL';
    const supportedStates = ['SCOUT','SURVIVOR','PROTECTED','LEG','MATURE_LEG','RUNNER'];
    const fact: ProtectionPositionFact = {
      positionId: proposal.positionId,
      brokerPositionKey: String(local.broker_position_key),
      colonyId: String(local.current_colony_id),
      source,
      direction: local.direction as 'LONG'|'SHORT',
      state: (supportedStates.includes(String(local.current_state)) ? local.current_state : 'CLOSED') as ProtectionPositionFact['state'],
      protectionState: (projection?.state ?? 'UNPROTECTED') as ProtectionPositionFact['protectionState'],
      actualVolume: brokerPosition?.volume ?? Number(local.current_size),
      currentStop: brokerPosition?.stopLoss ?? (projection?.verified_stop as number | null | undefined) ?? null,
      currentTakeProfit: brokerPosition?.takeProfit ?? (projection?.verified_take_profit as number | null | undefined) ?? null,
      tags: [],
      fills,
    };
    const optionalNumber = (key: string) => typeof config[key] === 'number' ? config[key] as number : undefined;
    const calculation = calculateProtectionAction({
      action: proposal.action,
      direction: fact.direction,
      fills: fact.fills,
      actualVolume: fact.actualVolume,
      executablePrice: fact.direction === 'LONG'
        ? quote?.bid ?? (typeof config.referencePrice === 'number' ? config.referencePrice : Number(local.entry_price))
        : quote?.ask ?? (typeof config.referencePrice === 'number' ? config.referencePrice : Number(local.entry_price)),
      pipSize: symbol?.pipSize ?? 0.0001,
      moneyPerPriceUnitPerLot: optionalNumber('moneyPerPriceUnitPerLot') ?? symbol?.contractSize ?? 1,
      ...(optionalNumber('estimatedExitCostMoney') === undefined ? {} : { estimatedExitCostMoney: optionalNumber('estimatedExitCostMoney')! }),
      ...(optionalNumber('offsetPips') === undefined ? {} : { offsetPips: optionalNumber('offsetPips')! }),
      ...(optionalNumber('lockPips') === undefined ? {} : { lockPips: optionalNumber('lockPips')! }),
      ...(optionalNumber('lockMoney') === undefined ? {} : { lockMoney: optionalNumber('lockMoney')! }),
      ...(optionalNumber('openProfitPercent') === undefined ? {} : { openProfitPercent: optionalNumber('openProfitPercent')! }),
      ...(optionalNumber('explicitPrice') === undefined ? {} : { explicitPrice: optionalNumber('explicitPrice')! }),
      ...(optionalNumber('marketObjectPrice') === undefined ? {} : { marketObjectPrice: optionalNumber('marketObjectPrice')! }),
      ...(optionalNumber('structurePrice') === undefined ? {} : { structurePrice: optionalNumber('structurePrice')! }),
      ...(optionalNumber('trailDistancePips') === undefined ? {} : { trailDistancePips: optionalNumber('trailDistancePips')! }),
      ...(optionalNumber('partialCloseVolume') === undefined ? {} : { partialCloseVolume: optionalNumber('partialCloseVolume')! }),
      ...(optionalNumber('partialClosePercent') === undefined ? {} : { partialClosePercent: optionalNumber('partialClosePercent')! }),
      ...(optionalNumber('takeProfitPrice') === undefined ? {} : { takeProfitPrice: optionalNumber('takeProfitPrice')! }),
    });
    const planned: ProtectionProposal = Object.freeze({ ...proposal, ...calculation });
    this.protection.persistRequest(planned, mode);
    if (mode === 'SHADOW') return this.protection.workspace();
    if (projection && planned.sequence <= Number(projection.last_applied_sequence)) {
      this.protection.rejectRequest(planned.proposalId, 'Protection proposal sequence is stale');
      return this.protection.workspace();
    }
    const validation = validateProtectionProposal(fact, planned, {
      truth: workspace.connection.truth,
      connection: workspace.connection.state,
      reconciliation: workspace.reconciliation.status,
      protocolCompatible: workspace.connection.state !== 'BLOCKED',
      terminalConnected: workspace.connection.terminalConnected,
      accountMatches: Boolean(workspace.account && local.broker_account_id === workspace.account.accountKey),
      accountIsLive: workspace.account?.isLive ?? true,
      sessionMatches: workspace.connection.sessionId !== null,
      quoteFresh: Boolean(quote && Date.now() - Date.parse(quote.receivedAt) <= 5000),
      bid: quote?.bid ?? 0,
      ask: quote?.ask ?? 0,
      tickSize: symbol?.tickSize ?? 0.00001,
      pipSize: symbol?.pipSize ?? 0.0001,
      stopsLevel: symbol?.stopsLevel ?? Number.MAX_SAFE_INTEGER,
      freezeLevel: symbol?.freezeLevel ?? Number.MAX_SAFE_INTEGER,
      minVolume: symbol?.minVolume ?? Number.MAX_SAFE_INTEGER,
      volumeStep: symbol?.volumeStep ?? 1,
    });
    if (validation.status !== 'PASS') {
      this.protection.rejectRequest(proposal.proposalId, validation.reasons.join(','));
      return this.protection.workspace();
    }
    if (proposal.action === 'CONVERT_TO_RUNNER') {
      this.protection.convertToRunner({
        positionId: planned.positionId, targetId: null,
        policy: { ruleVersionId: proposal.ruleVersionId, triggerEventId: proposal.triggerEventId },
        occurredAt: planned.createdAt, correlationId: planned.proposalId,
      });
      this.protection.completeLocalRequest(planned.proposalId, 'Runner conversion preserved Position and Colony lineage');
      return this.protection.workspace();
    }
    const command = this.protection.createCommand(planned, {
      accountKey: workspace.account!.accountKey,
      brokerSymbol: brokerPosition!.brokerSymbol,
      direction: fact.direction,
      actualBrokerVolume: brokerPosition!.volume,
      expectedSessionId: workspace.connection.sessionId!,
      expiresAt: new Date(Date.parse(planned.createdAt) + 60_000).toISOString(),
    });
    if (this.protection.pendingCommands().some((item)=>item.commandId===command.commandId))
      this.client.sendManagementCommand(command);
    return this.protection.workspace();
  }

  workspace(): Readonly<Record<string, unknown>> {
    return this.protection.workspace();
  }
}
