/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite JSON is decoded at this boundary. */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  durableProtectionIdempotencyKey,
  protectionStateForQuantities,
  type ProtectionActionType,
  type ProtectionProposal,
  type ProtectionScope,
  type ProtectionTriggerType,
  type ThesisInvalidationPolicy,
} from '@arise/execution';
import type { Mt5AgentEnvelope, Mt5ManagementCommand } from '@arise/shared';

const now = () => new Date().toISOString();
const terminalRequest = new Set(['SHADOW_COMPLETED','VERIFIED','REJECTED','FAILED','SUPERSEDED']);
const terminalCommand = new Set(['COMPLETED','FAILED']);

export interface ProtectionRuleVersionRecord {
  readonly id: string;
  readonly ruleId: string;
  readonly version: number;
  readonly triggerType: ProtectionTriggerType;
  readonly actionType: ProtectionActionType;
  readonly scope: ProtectionScope;
  readonly config: Readonly<Record<string, unknown>>;
  readonly allowWorsening?: false;
  readonly createdAt: string;
  readonly supersedesId: string | null;
}

export interface ProtectionTriggerRecord {
  readonly id: string;
  readonly ruleVersionId: string;
  readonly sourceType: 'PRICE_OBJECT' | 'STRATEGY_EVENT' | 'POSITION_STATE' | 'TARGET_STATE' | 'MANUAL';
  readonly sourceId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
  readonly correlationId: string;
}

export interface ProtectionCommandContext {
  readonly accountKey: string;
  readonly brokerSymbol: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly actualBrokerVolume: number;
  readonly expectedSessionId: string;
  readonly expiresAt: string;
}

export class ProtectionRepository {
  constructor(private readonly sqlite: Database.Database) {}

  persistRuleVersion(rule: ProtectionRuleVersionRecord): void {
    if (rule.allowWorsening) throw new Error('M11 protection rules cannot opt into worsening protection');
    this.sqlite.prepare('INSERT INTO protection_rule_versions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      rule.id, rule.ruleId, rule.version, rule.triggerType, rule.actionType, rule.scope,
      JSON.stringify(rule.config), 0, rule.createdAt, rule.supersedesId,
    );
  }

  recordTrigger(event: ProtectionTriggerRecord): void {
    this.sqlite.prepare('INSERT INTO protection_trigger_events VALUES (?,?,?,?,?,?,?)').run(
      event.id, event.ruleVersionId, event.sourceType, event.sourceId,
      JSON.stringify(event.payload), event.occurredAt, event.correlationId,
    );
  }

  recordCostFact(input: {
    readonly id: string; readonly positionId: string; readonly brokerFillEventId: string | null;
    readonly costType: 'COMMISSION'|'SWAP'|'FEE'|'ESTIMATED_EXIT_COST'; readonly amountMoney: number;
    readonly occurredAt: string; readonly sourceId: string;
  }): void {
    if (!Number.isFinite(input.amountMoney)) throw new Error('Broker cost must be finite');
    this.sqlite.prepare('INSERT INTO broker_position_cost_events VALUES (?,?,?,?,?,?,?)').run(
      input.id, input.positionId, input.brokerFillEventId, input.costType, input.amountMoney, input.occurredAt, input.sourceId,
    );
  }

  persistRequest(proposal: ProtectionProposal, mode: 'SHADOW' | 'DEMO'): void {
    const status = mode === 'SHADOW' ? 'SHADOW_COMPLETED' : 'COMMAND_PENDING';
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO protection_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        proposal.proposalId, proposal.positionId, proposal.brokerPositionKey, proposal.ruleVersionId,
        proposal.triggerEventId, mode, proposal.action, proposal.sequence, proposal.requestedStop,
        proposal.requestedTakeProfit, proposal.requestedCloseVolume, status, JSON.stringify(proposal),
        proposal.createdAt, proposal.createdAt,
      );
      this.event(proposal.proposalId, null, status, mode === 'SHADOW' ? 'SHADOW_RESULT' : 'REQUEST_PLANNED',
        mode === 'SHADOW' ? 'Hypothetical protection result; no broker command emitted.' : 'Validated management request awaits durable command.', proposal.createdAt);
    })();
  }

  createCommand(proposal: ProtectionProposal, context: ProtectionCommandContext): Mt5ManagementCommand {
    const request = this.sqlite.prepare('SELECT mode,status FROM protection_requests WHERE id=?').get(proposal.proposalId) as { mode: string; status: string } | undefined;
    if (!request || request.mode !== 'DEMO' || request.status !== 'COMMAND_PENDING')
      throw new Error('Only a validated pending DEMO protection request can create a command');
    const commandType = this.commandType(proposal.action);
    if (!commandType) throw new Error(`${proposal.action} is a local state action and emits no broker command`);
    const idempotencyKey = durableProtectionIdempotencyKey({
      ruleVersionId: proposal.ruleVersionId, triggerEventId: proposal.triggerEventId,
      brokerPositionKey: proposal.brokerPositionKey, action: proposal.action, sequence: proposal.sequence,
    });
    const command: Mt5ManagementCommand = Object.freeze({
      commandId: randomUUID(), idempotencyKey, protectionRequestId: proposal.proposalId,
      ruleVersionId: proposal.ruleVersionId, triggerEventId: proposal.triggerEventId, commandType,
      accountKey: context.accountKey, brokerSymbol: context.brokerSymbol,
      brokerPositionKey: proposal.brokerPositionKey, direction: context.direction,
      expectedBrokerVolume: context.actualBrokerVolume, requestedStop: proposal.requestedStop,
      requestedTakeProfit: proposal.requestedTakeProfit,
      requestedCloseVolume: proposal.action === 'FULL_CLOSE' ? context.actualBrokerVolume : proposal.requestedCloseVolume,
      expectedSessionId: context.expectedSessionId, sequence: proposal.sequence,
      createdAt: now(), expiresAt: context.expiresAt,
    });
    this.sqlite.transaction(() => {
      if (command.commandType === 'FULL_CLOSE') {
        const superseded = this.sqlite.prepare("SELECT id,protection_request_id FROM management_commands WHERE position_id=? AND status='CREATED'").all(proposal.positionId) as Array<{id:string;protection_request_id:string}>;
        for (const prior of superseded) {
          this.sqlite.prepare("UPDATE management_commands SET status='FAILED',updated_at=? WHERE id=?").run(command.createdAt, prior.id);
          this.commandEvent(prior.id, 'CREATED', 'FAILED', 'SUPERSEDED_BY_FULL_CLOSE', 'Full close has broker-effect priority', command.createdAt);
          this.requestTransition(prior.protection_request_id, 'SUPERSEDED', 'SUPERSEDED_BY_FULL_CLOSE', 'Full close superseded queued protection mutation', command.createdAt);
        }
      }
      this.sqlite.prepare('INSERT INTO management_commands VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        command.commandId, proposal.proposalId, proposal.positionId, command.idempotencyKey,
        command.commandType, command.sequence, 'CREATED', 0, JSON.stringify(command), command.createdAt, command.createdAt,
      );
      const current = this.sqlite.prepare('SELECT protected_volume,verified_stop,verified_take_profit,last_applied_sequence FROM position_protection_current WHERE position_id=?').get(proposal.positionId) as any;
      this.sqlite.prepare(`INSERT INTO position_protection_current VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(position_id) DO UPDATE SET state='PROTECTION_PENDING',broker_volume=excluded.broker_volume,truth_state='VERIFIED',updated_at=excluded.updated_at`).run(
          proposal.positionId, 'PROTECTION_PENDING', proposal.brokerPositionKey, context.actualBrokerVolume,
          current?.protected_volume ?? 0, current?.verified_stop ?? null, current?.verified_take_profit ?? null,
          current?.last_applied_sequence ?? 0, 'VERIFIED', command.createdAt,
        );
      this.commandEvent(command.commandId, null, 'CREATED', 'COMMAND_CREATED', 'Durable idempotent management command created', command.createdAt);
    })();
    return command;
  }

  pendingCommands(): readonly Mt5ManagementCommand[] {
    const rows = this.sqlite.prepare(`
      SELECT command.payload_json FROM management_commands command
      WHERE command.status IN ('CREATED','SENDING','UNKNOWN') AND command.attempt_count<3
        AND (command.command_type='FULL_CLOSE' OR NOT EXISTS (
          SELECT 1 FROM management_commands prior
          WHERE prior.position_id=command.position_id AND prior.sequence_no<command.sequence_no
            AND prior.status NOT IN ('COMPLETED','FAILED')
        ))
      ORDER BY command.position_id,command.sequence_no
    `).all() as Array<{ payload_json: string }>;
    return Object.freeze(rows.map((row) => Object.freeze(JSON.parse(row.payload_json) as Mt5ManagementCommand)));
  }

  attemptCount(commandId: string): number {
    return (this.sqlite.prepare('SELECT attempt_count count FROM management_commands WHERE id=?').get(commandId) as { count: number } | undefined)?.count ?? 0;
  }

  markSending(commandId: string): boolean {
    const row = this.commandRow(commandId);
    if (!row || terminalCommand.has(row.status) || row.attempt_count >= 3) return false;
    const blocked = row.command_type !== 'FULL_CLOSE' && this.sqlite.prepare(`SELECT 1 FROM management_commands
      WHERE position_id=? AND sequence_no<? AND status NOT IN ('COMPLETED','FAILED') LIMIT 1`).get(row.position_id, row.sequence_no);
    if (blocked) return false;
    const at = now();
    this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE management_commands SET status='SENDING',attempt_count=attempt_count+1,updated_at=? WHERE id=? AND status NOT IN ('COMPLETED','FAILED') AND attempt_count<3").run(at, commandId);
      this.commandEvent(commandId, row.status, 'SENDING', 'COMMAND_SENT', 'Sent/retried through the execution gateway', at);
      this.requestTransition(row.protection_request_id, 'SENDING', 'COMMAND_SENT', 'Management command sent', at);
    })();
    return true;
  }

  rejectUnsent(commandId: string, detail: string): void {
    const row = this.commandRow(commandId);
    if (!row || row.status !== 'CREATED') return;
    const at = now();
    this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE management_commands SET status='FAILED',updated_at=? WHERE id=? AND status='CREATED'").run(at, commandId);
      this.commandEvent(commandId, 'CREATED', 'FAILED', 'PRE_SEND_BLOCK', detail, at);
      this.requestTransition(row.protection_request_id, 'REJECTED', 'PRE_SEND_BLOCK', detail, at);
    })();
  }

  rejectRequest(requestId: string, detail: string): void {
    this.requestTransition(requestId, 'REJECTED', 'VALIDATION_BLOCKED', detail, now());
  }

  completeLocalRequest(requestId: string, detail: string): void {
    this.requestTransition(requestId, 'VERIFIED', 'LOCAL_STATE_ACTION', detail, now());
  }

  markUnknown(commandId: string, detail: string): void {
    const row = this.commandRow(commandId);
    if (!row || row.status !== 'SENDING') return;
    const at = now();
    this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE management_commands SET status='UNKNOWN',updated_at=? WHERE id=? AND status='SENDING'").run(at, commandId);
      this.commandEvent(commandId, 'SENDING', 'UNKNOWN', 'TRANSPORT_UNCERTAIN', detail, at);
      this.requestTransition(row.protection_request_id, 'UNKNOWN', 'TRANSPORT_UNCERTAIN', detail, at);
      this.sqlite.prepare("UPDATE position_protection_current SET truth_state='UNKNOWN',updated_at=? WHERE position_id=?").run(at, row.position_id);
    })();
  }

  recordAgentMessage(envelope: Mt5AgentEnvelope): void {
    if (envelope.payload.kind !== 'MANAGEMENT_ACK') return;
    const payload = envelope.payload;
    if (this.sqlite.prepare('SELECT 1 FROM broker_management_events WHERE message_id=? OR event_id=?').get(envelope.messageId, payload.eventId)) return;
    const command = this.commandRow(payload.commandId);
    const at = payload.occurredAt;
    if (!command || command.protection_request_id !== payload.protectionRequestId || command.idempotency_key !== payload.idempotencyKey) {
      this.safety('STALE_MANAGEMENT_EVENT', 'Management response has no matching durable command identity', at);
      return;
    }
    const request = this.sqlite.prepare('SELECT * FROM protection_requests WHERE id=?').get(payload.protectionRequestId) as any;
    const current = this.sqlite.prepare('SELECT * FROM position_protection_current WHERE position_id=?').get(command.position_id) as any;
    const stale = terminalRequest.has(request.status) || terminalCommand.has(command.status) ||
      payload.sequence !== command.sequence_no || (current && payload.sequence <= current.last_applied_sequence);
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO broker_management_events VALUES (?,?,?,?,?,?,?,?,?)').run(
        payload.eventId, envelope.messageId, payload.commandId, payload.protectionRequestId,
        payload.brokerPositionKey, payload.sequence, stale ? 'STALE' : payload.status,
        JSON.stringify(payload), at,
      );
      if (stale) {
        this.verification(payload, command, 'STALE', 'Late/duplicate response recorded without advancing state');
        this.safety('STALE_MANAGEMENT_EVENT', 'Terminal or superseded management response ignored', at);
        return;
      }
      if (payload.status === 'REJECTED') {
        this.finish(command, request, 'FAILED', 'REJECTED', payload.reason ?? 'Broker rejected management command', at);
        const priorStop = current?.verified_stop ?? null;
        this.upsertProjection(command.position_id, payload.brokerPositionKey, payload.actualVolume, priorStop ? payload.actualVolume : 0, priorStop, current?.verified_take_profit ?? null, payload.sequence, 'UNKNOWN', at, true);
        this.verification(payload, command, 'REJECTED', payload.reason ?? 'Broker rejection');
        return;
      }
      const decoded = JSON.parse(command.payload_json) as Mt5ManagementCommand;
      const position = this.sqlite.prepare('SELECT direction,current_state,current_size FROM positions WHERE id=?').get(command.position_id) as { direction: 'LONG'|'SHORT'; current_state: string; current_size: number } | undefined;
      if (!position || payload.brokerPositionKey !== decoded.brokerPositionKey) {
        this.finish(command, request, 'FAILED', 'FAILED', 'Broker position identity mismatch', at);
        this.safety('BROKER_POSITION_MISMATCH', 'Management result could not be applied safely', at);
        return;
      }
      if (decoded.commandType === 'MOVE_STOP' && payload.actualStop === null) {
        this.finish(command, request, 'FAILED', 'FAILED', 'Broker did not verify requested stop', at);
        this.upsertProjection(command.position_id, payload.brokerPositionKey, payload.actualVolume, 0, null, payload.actualTakeProfit, payload.sequence, 'UNKNOWN', at, true);
        return;
      }
      const closeDelta = decoded.expectedBrokerVolume - payload.actualVolume;
      const effectMismatch =
        (payload.actualVolume > 1e-9 && payload.actualStop === null) ||
        (decoded.commandType === 'SET_TP' &&
          (payload.actualTakeProfit === null || Math.abs(payload.actualTakeProfit - decoded.requestedTakeProfit!) > 1e-8)) ||
        (decoded.commandType === 'REMOVE_TP' && payload.actualTakeProfit !== null) ||
        (decoded.commandType === 'PARTIAL_CLOSE' &&
          (payload.closedVolume <= 0 ||
            payload.closedVolume > decoded.requestedCloseVolume! + 1e-8 ||
            Math.abs(closeDelta - payload.closedVolume) > 1e-8)) ||
        (decoded.commandType === 'FULL_CLOSE' &&
          (payload.actualVolume > 1e-8 ||
            Math.abs(payload.closedVolume - decoded.expectedBrokerVolume) > 1e-8));
      if (effectMismatch) {
        this.finish(command, request, 'FAILED', 'FAILED', 'Broker result did not verify the requested management effect', at);
        this.upsertProjection(command.position_id, payload.brokerPositionKey, payload.actualVolume, 0, payload.actualStop, payload.actualTakeProfit, payload.sequence, 'UNKNOWN', at, true);
        this.safety('MANAGEMENT_EFFECT_MISMATCH', 'Broker result requires reconciliation before further mutation', at);
        this.verification(payload, command, 'UNKNOWN', 'Broker effect mismatch');
        return;
      }
      const priorStop = current?.verified_stop as number | null | undefined;
      const worsened = decoded.commandType === 'MOVE_STOP' && priorStop != null && payload.actualStop != null &&
        (position.direction === 'LONG' ? payload.actualStop < priorStop - 1e-9 : payload.actualStop > priorStop + 1e-9);
      if (worsened) {
        this.finish(command, request, 'FAILED', 'FAILED', 'Broker reported a worsening stop; recovery required', at);
        this.upsertProjection(command.position_id, payload.brokerPositionKey, payload.actualVolume, 0, payload.actualStop, payload.actualTakeProfit, payload.sequence, 'UNKNOWN', at, true);
        this.safety('PROTECTION_WORSENED', 'Broker reality conflicts with never-worsen invariant', at);
        return;
      }
      const protectedVolume = payload.actualStop === null ? 0 : payload.actualVolume;
      this.upsertProjection(command.position_id, payload.brokerPositionKey, payload.actualVolume, protectedVolume,
        payload.actualStop, payload.actualTakeProfit, payload.sequence, 'VERIFIED', at, false);
      this.sqlite.prepare('UPDATE positions SET current_size=? WHERE id=?').run(payload.actualVolume, command.position_id);
      if (decoded.commandType === 'PARTIAL_CLOSE' || decoded.commandType === 'FULL_CLOSE') {
        this.sqlite.prepare('INSERT INTO position_management_fills VALUES (?,?,?,?,?,?,?,?,?)').run(
          payload.eventId, request.id, command.position_id, payload.brokerPositionKey, decoded.commandType,
          decoded.requestedCloseVolume, payload.closedVolume, payload.actualVolume, at,
        );
      }
      if (payload.actualVolume === 0 && position.current_state !== 'CLOSED') {
        this.sqlite.prepare("UPDATE positions SET current_state='CLOSED',closed_at=? WHERE id=?").run(at, command.position_id);
        this.sqlite.prepare('INSERT INTO position_state_events VALUES (?,?,?,?,?,?,?,?,?,?)').run(
          randomUUID(), command.position_id, position.current_state, 'CLOSED', 'Broker-confirmed management close',
          'EXECUTION', payload.eventId, at, 0, request.id,
        );
      }
      this.finish(command, request, 'COMPLETED', 'VERIFIED', 'Broker effect verified', at);
      this.verification(payload, command, 'VERIFIED', payload.status === 'ALREADY_APPLIED' ? 'Idempotent broker effect replay verified' : 'Broker effect verified');
    })();
  }

  reconcilePosition(input: {
    readonly positionId: string; readonly brokerPositionKey: string; readonly actualVolume: number;
    readonly actualStop: number | null; readonly actualTakeProfit: number | null; readonly occurredAt: string;
  }): void {
    const current = this.sqlite.prepare('SELECT last_applied_sequence FROM position_protection_current WHERE position_id=?').get(input.positionId) as { last_applied_sequence: number } | undefined;
    const protectedVolume = input.actualStop === null ? 0 : input.actualVolume;
    this.sqlite.transaction(() => {
      this.upsertProjection(input.positionId, input.brokerPositionKey, input.actualVolume, protectedVolume,
        input.actualStop, input.actualTakeProfit, current?.last_applied_sequence ?? 0, 'VERIFIED', input.occurredAt, false);
      this.sqlite.prepare('UPDATE positions SET current_size=? WHERE id=?').run(input.actualVolume, input.positionId);
      this.sqlite.prepare('INSERT INTO colony_automation_events VALUES (?,?,?,?,?,?)').run(
        randomUUID(), this.colonyId(input.positionId), 'BROKER_RECONCILIATION', JSON.stringify(input), input.occurredAt, `reconcile:${input.brokerPositionKey}:${input.occurredAt}`,
      );
    })();
  }

  convertToRunner(input: { readonly positionId: string; readonly targetId: string | null; readonly policy: Readonly<Record<string, unknown>>; readonly occurredAt: string; readonly correlationId: string }): void {
    const row = this.sqlite.prepare(`SELECT p.current_state,p.current_colony_id,t.source_type,pc.state protection_state,pc.truth_state
      FROM positions p JOIN trades t ON t.id=p.trade_id LEFT JOIN position_protection_current pc ON pc.position_id=p.id WHERE p.id=?`).get(input.positionId) as { current_state: string; current_colony_id: string; source_type: string; protection_state: string|null; truth_state: string|null } | undefined;
    if (!row || row.source_type !== 'ARISE_AUTO') throw new Error('Only an ARISE automated Position can convert to Runner');
    if (!['LEG','MATURE_LEG','PROTECTED'].includes(row.current_state)) throw new Error('Runner conversion requires a managed protected/leg Position');
    if (row.protection_state !== 'PROTECTED' || row.truth_state !== 'VERIFIED') throw new Error('Runner conversion requires independently verified broker protection');
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO runner_conversion_events VALUES (?,?,?,?,?,?,?,?,?)').run(
        randomUUID(), input.positionId, row.current_colony_id, input.targetId, row.current_state, 'RUNNER',
        JSON.stringify(input.policy), input.occurredAt, input.correlationId,
      );
      this.sqlite.prepare("UPDATE positions SET current_state='RUNNER' WHERE id=?").run(input.positionId);
      this.sqlite.prepare('INSERT INTO position_state_events VALUES (?,?,?,?,?,?,?,?,?,?)').run(
        randomUUID(), input.positionId, row.current_state, 'RUNNER', 'Explicit runner conversion policy', 'SYSTEM', input.correlationId, input.occurredAt, 0, input.correlationId,
      );
    })();
  }

  configureColony(input: {
    readonly policyVersionId: string; readonly policyId: string; readonly colonyId: string; readonly version: number;
    readonly mode: 'ANY_VALID_ENTRY'|'ONLY_AFTER_SURVIVOR'|'ONLY_AFTER_PROTECTED'|'ONLY_AFTER_LEG'|'MANUAL';
    readonly config: Readonly<Record<string, unknown>>; readonly attemptBudgetId: string | null;
    readonly invalidationPolicy?: ThesisInvalidationPolicy; readonly currentPeriodKey: string; readonly occurredAt: string;
  }): void {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO stacking_policy_versions VALUES (?,?,?,?,?,?,?,?)').run(
        input.policyVersionId, input.policyId, input.colonyId, input.version, input.mode, JSON.stringify(input.config), input.occurredAt, null,
      );
      this.sqlite.prepare(`INSERT INTO colony_automation_assignments VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(colony_id) DO UPDATE SET stacking_policy_version_id=excluded.stacking_policy_version_id,attempt_budget_id=excluded.attempt_budget_id,invalidation_policy=excluded.invalidation_policy,countertrend_enabled=0,entry_armed=excluded.entry_armed,current_period_key=excluded.current_period_key,updated_at=excluded.updated_at`).run(
        input.colonyId, input.policyVersionId, input.attemptBudgetId, input.invalidationPolicy ?? 'MANUAL_DECISION', 0, 1, null, input.currentPeriodKey, input.occurredAt,
      );
      this.sqlite.prepare('INSERT INTO colony_automation_events VALUES (?,?,?,?,?,?)').run(
        randomUUID(), input.colonyId, 'POLICY_ASSIGNED', JSON.stringify(input), input.occurredAt, `stacking:${input.policyVersionId}`,
      );
    })();
  }

  invalidateThesis(colonyId: string, occurredAt: string, correlationId: string): ThesisInvalidationPolicy {
    const assignment = this.sqlite.prepare('SELECT invalidation_policy FROM colony_automation_assignments WHERE colony_id=?').get(colonyId) as { invalidation_policy: ThesisInvalidationPolicy } | undefined;
    const policy = assignment?.invalidation_policy ?? 'MANUAL_DECISION';
    this.sqlite.transaction(() => {
      if (assignment) this.sqlite.prepare('UPDATE colony_automation_assignments SET entry_armed=0,updated_at=? WHERE colony_id=?').run(occurredAt, colonyId);
      const unsent = this.sqlite.prepare(`SELECT command.id,command.status,command.order_plan_id
        FROM execution_commands command JOIN order_plans plan ON plan.id=command.order_plan_id
        JOIN execution_intents intent ON intent.id=plan.execution_intent_id
        JOIN strategy_runtimes runtime ON runtime.id=intent.strategy_runtime_id
        WHERE runtime.colony_id=? AND command.status='CREATED'`).all(colonyId) as Array<{ id: string; status: string; order_plan_id: string }>;
      for (const command of unsent) {
        this.sqlite.prepare("UPDATE execution_commands SET status='FAILED',updated_at=? WHERE id=? AND status='CREATED'").run(occurredAt, command.id);
        this.sqlite.prepare('INSERT INTO execution_command_events VALUES (?,?,?,?,?,?,?)').run(
          randomUUID(), command.id, command.status, 'FAILED', 'THESIS_INVALIDATED', 'Unsent Scout command cancelled before exposure', occurredAt,
        );
        const lifecycle = this.sqlite.prepare('SELECT state FROM execution_lifecycles WHERE order_plan_id=?').get(command.order_plan_id) as { state: string } | undefined;
        if (lifecycle?.state === 'COMMAND_PENDING') {
          this.sqlite.prepare("UPDATE execution_lifecycles SET state='REJECTED',updated_at=?,detail='Thesis invalidated before broker send' WHERE order_plan_id=?").run(occurredAt, command.order_plan_id);
          this.sqlite.prepare('INSERT INTO execution_lifecycle_events VALUES (?,?,?,?,?,?,?)').run(
            randomUUID(), command.order_plan_id, lifecycle.state, 'REJECTED', 'THESIS_INVALIDATED', 'Scout creation disarmed before broker send', occurredAt,
          );
        }
      }
      this.sqlite.prepare('INSERT INTO colony_automation_events VALUES (?,?,?,?,?,?)').run(
        randomUUID(), colonyId, 'THESIS_INVALIDATED_ENTRY_DISARMED', JSON.stringify({ policy }), occurredAt, correlationId,
      );
    })();
    return policy;
  }

  setCooldown(colonyId: string, cooldownUntil: string | null, occurredAt: string, correlationId: string): void {
    const result = this.sqlite.prepare('UPDATE colony_automation_assignments SET cooldown_until=?,updated_at=? WHERE colony_id=?').run(cooldownUntil, occurredAt, colonyId);
    if (result.changes !== 1) throw new Error(`Colony automation ${colonyId} not configured`);
    this.sqlite.prepare('INSERT INTO colony_automation_events VALUES (?,?,?,?,?,?)').run(
      randomUUID(), colonyId, cooldownUntil ? 'COOLDOWN_STARTED' : 'COOLDOWN_CLEARED', JSON.stringify({ cooldownUntil }), occurredAt, correlationId,
    );
  }

  resetAttemptPeriod(colonyId: string, periodKey: string, occurredAt: string, correlationId: string): void {
    this.sqlite.transaction(() => {
      const assignment = this.sqlite.prepare('UPDATE colony_automation_assignments SET current_period_key=?,cooldown_until=NULL,updated_at=? WHERE colony_id=?').run(periodKey, occurredAt, colonyId);
      if (assignment.changes !== 1) throw new Error(`Colony automation ${colonyId} not configured`);
      this.sqlite.prepare('UPDATE attempt_budgets SET current_period_key=?,updated_at=? WHERE colony_id=?').run(periodKey, occurredAt, colonyId);
      this.sqlite.prepare('INSERT INTO colony_automation_events VALUES (?,?,?,?,?,?)').run(
        randomUUID(), colonyId, 'ATTEMPT_PERIOD_RESET', JSON.stringify({ periodKey }), occurredAt, correlationId,
      );
    })();
  }

  recordAutomationEvent(colonyId: string, eventType: string, payload: Readonly<Record<string, unknown>>, occurredAt: string, correlationId: string): void {
    this.sqlite.prepare('INSERT INTO colony_automation_events VALUES (?,?,?,?,?,?)').run(
      randomUUID(), colonyId, eventType, JSON.stringify(payload), occurredAt, correlationId,
    );
  }

  workspace(): Readonly<Record<string, unknown>> {
    const list = (table: string) => this.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    return Object.freeze({
      positions: this.sqlite.prepare(`SELECT p.id position_id,p.broker_position_key,p.current_colony_id colony_id,p.direction,p.current_state,p.current_size,p.entry_price,t.source_type
        FROM positions p JOIN trades t ON t.id=p.trade_id ORDER BY p.opened_at,p.id`).all(),
      rules: list('protection_rule_versions'), triggers: list('protection_trigger_events'), requests: list('protection_requests'),
      commands: list('management_commands'), brokerEvents: list('broker_management_events'), protection: list('position_protection_current'),
      verifications: list('protection_verifications'), costs: list('broker_position_cost_events'), managementFills: list('position_management_fills'), runnerConversions: list('runner_conversion_events'),
      stackingPolicies: list('stacking_policy_versions'), colonyAutomation: list('colony_automation_assignments'), automationEvents: list('colony_automation_events'),
    });
  }

  private commandType(action: ProtectionActionType): Mt5ManagementCommand['commandType'] | null {
    if (['MOVE_TO_PRICE_BE','MOVE_TO_TRUE_BE','BE_PLUS_OFFSET','LOCK_PIPS','LOCK_MONEY','LOCK_PERCENT_OPEN_PROFIT','MOVE_TO_PRICE','MOVE_TO_MARKET_OBJECT','TRAIL_FIXED_DISTANCE','TRAIL_MARKET_OBJECT','TRAIL_STRUCTURE'].includes(action)) return 'MOVE_STOP';
    if (action === 'SET_TP') return 'SET_TP';
    if (action === 'REMOVE_TP') return 'REMOVE_TP';
    if (action === 'PARTIAL_CLOSE') return 'PARTIAL_CLOSE';
    if (action === 'FULL_CLOSE') return 'FULL_CLOSE';
    return null;
  }
  private commandRow(id: string): any { return this.sqlite.prepare('SELECT * FROM management_commands WHERE id=?').get(id); }
  private event(requestId: string, from: string|null, to: string, type: string, detail: string, at: string): void {
    this.sqlite.prepare('INSERT INTO protection_request_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), requestId, from, to, type, detail, at);
  }
  private commandEvent(commandId: string, from: string|null, to: string, type: string, detail: string, at: string): void {
    this.sqlite.prepare('INSERT INTO management_command_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), commandId, from, to, type, detail, at);
  }
  private requestTransition(id: string, to: string, type: string, detail: string, at: string): void {
    const row = this.sqlite.prepare('SELECT status FROM protection_requests WHERE id=?').get(id) as { status: string } | undefined;
    if (!row || terminalRequest.has(row.status)) return;
    this.sqlite.prepare('UPDATE protection_requests SET status=?,updated_at=? WHERE id=?').run(to, at, id);
    this.event(id, row.status, to, type, detail, at);
  }
  private finish(command: any, request: any, commandStatus: 'COMPLETED'|'FAILED', requestStatus: 'VERIFIED'|'REJECTED'|'FAILED', detail: string, at: string): void {
    this.sqlite.prepare('UPDATE management_commands SET status=?,updated_at=? WHERE id=?').run(commandStatus, at, command.id);
    this.commandEvent(command.id, command.status, commandStatus, 'BROKER_RESULT', detail, at);
    this.sqlite.prepare('UPDATE protection_requests SET status=?,updated_at=? WHERE id=?').run(requestStatus, at, request.id);
    this.event(request.id, request.status, requestStatus, 'BROKER_RESULT', detail, at);
  }
  private verification(payload: Extract<Mt5AgentEnvelope['payload'], {kind:'MANAGEMENT_ACK'}>, command: any, status: string, detail: string): void {
    this.sqlite.prepare('INSERT INTO protection_verifications VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      randomUUID(), payload.protectionRequestId, payload.commandId, payload.brokerPositionKey, payload.actualVolume,
      payload.actualStop === null ? 0 : payload.actualVolume, payload.actualStop, payload.actualTakeProfit, status, detail, payload.occurredAt,
    );
  }
  private upsertProjection(positionId: string, brokerKey: string, volume: number, protectedVolume: number, stop: number|null, tp: number|null, sequence: number, truth: 'VERIFIED'|'UNKNOWN', at: string, failed: boolean): void {
    const state = failed ? 'PROTECTION_ERROR' : protectionStateForQuantities(volume, protectedVolume);
    this.sqlite.prepare(`INSERT INTO position_protection_current VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(position_id) DO UPDATE SET state=excluded.state,broker_position_key=excluded.broker_position_key,broker_volume=excluded.broker_volume,protected_volume=excluded.protected_volume,verified_stop=excluded.verified_stop,verified_take_profit=excluded.verified_take_profit,last_applied_sequence=excluded.last_applied_sequence,truth_state=excluded.truth_state,updated_at=excluded.updated_at`).run(
        positionId, state, brokerKey, volume, protectedVolume, stop, tp, sequence, truth, at,
      );
  }
  private safety(type: string, detail: string, at: string): void {
    this.sqlite.prepare('INSERT INTO mt5_safety_events VALUES (?,?,?,?,?,?)').run(randomUUID(), type, 'BLOCK', detail, at, null);
  }
  private colonyId(positionId: string): string {
    const row = this.sqlite.prepare('SELECT current_colony_id id FROM positions WHERE id=?').get(positionId) as { id: string } | undefined;
    if (!row) throw new Error(`Position ${positionId} not found`);
    return row.id;
  }
  isAutomatedPositionKey(brokerPositionKey: string): boolean {
    return Boolean(this.sqlite.prepare(`SELECT 1 FROM positions p JOIN trades t ON t.id=p.trade_id
      WHERE p.broker_position_key=? AND t.source_type='ARISE_AUTO' AND p.current_state NOT IN ('CLOSED','FAILED')`).get(brokerPositionKey));
  }
}
