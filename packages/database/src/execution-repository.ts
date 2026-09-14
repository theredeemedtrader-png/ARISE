/* eslint-disable @typescript-eslint/no-explicit-any -- SQLite audit rows are decoded at this boundary. */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ExecutionIntent,
  ExecutionValidation,
  OrderPlan,
} from '@arise/execution';
import type { Mt5AgentEnvelope, Mt5ExecutionCommand } from '@arise/shared';

const now = () => new Date().toISOString();
const json = <T>(value: string) => JSON.parse(value) as T;
const closeEnough = (left: number, right: number) =>
  Math.abs(left - right) <= 1e-8;
const terminalLifecycles = new Set([
  'SHADOW_COMPLETED',
  'ACTIVE',
  'REJECTED',
  'FAILED',
  'FLATTENED',
]);
const terminalCommands = new Set(['COMPLETED', 'FAILED']);
type ExecutionPayload = Extract<
  Mt5AgentEnvelope['payload'],
  { kind: 'COMMAND_ACK' | 'FILL' | 'PROTECTION_ATTEMPT' | 'FLATTEN_RESULT' }
>;

export class ExecutionRepository {
  constructor(private readonly sqlite: Database.Database) {}

  persistIntentValidation(
    intent: ExecutionIntent,
    validation: ExecutionValidation,
  ): void {
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare('INSERT INTO execution_intents VALUES (?,?,?,?,?,?)')
        .run(
          intent.id,
          intent.proposalCorrelationId,
          intent.strategyRuntimeId,
          intent.mode,
          JSON.stringify(intent),
          intent.createdAt,
        );
      this.sqlite
        .prepare('INSERT INTO execution_validations VALUES (?,?,?,?,?)')
        .run(
          validation.id,
          intent.id,
          validation.status,
          JSON.stringify(validation.checks),
          validation.evaluatedAt,
        );
    })();
  }

  persistPlan(
    plan: OrderPlan,
    exactVersions: Readonly<Record<string, unknown>>,
  ): void {
    const deploymentId = randomUUID();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare('INSERT INTO deployment_snapshots VALUES (?,?,?,?,?,?)')
        .run(
          deploymentId,
          plan.strategyRuntimeId,
          plan.strategyMapVersionId,
          JSON.stringify(exactVersions),
          plan.mode,
          plan.createdAt,
        );
      this.sqlite
        .prepare('INSERT INTO order_plans VALUES (?,?,?,?,?,?,?,?)')
        .run(
          plan.id,
          plan.intentId,
          deploymentId,
          plan.mode,
          plan.accountKey,
          plan.expectedSessionId,
          JSON.stringify(plan),
          plan.createdAt,
        );
      const state =
        plan.mode === 'SHADOW' ? 'SHADOW_COMPLETED' : 'COMMAND_PENDING';
      this.sqlite
        .prepare('INSERT INTO execution_lifecycles VALUES (?,?,?,?,?,?)')
        .run(
          plan.id,
          state,
          0,
          0,
          plan.createdAt,
          plan.mode === 'SHADOW'
            ? 'Hypothetical result only; no broker command emitted.'
            : 'Awaiting durable Agent command',
        );
      this.sqlite
        .prepare(
          'INSERT INTO execution_lifecycle_events VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          plan.id,
          null,
          state,
          plan.mode === 'SHADOW' ? 'SHADOW_RESULT' : 'PLAN_READY',
          plan.mode === 'SHADOW'
            ? 'SHADOW stopped before the broker transport boundary.'
            : 'Immutable OrderPlan ready for DEMO transport.',
          plan.createdAt,
        );
    })();
  }

  createCommand(plan: OrderPlan): Mt5ExecutionCommand {
    if (plan.mode !== 'DEMO' || !plan.accountKey || !plan.expectedSessionId)
      throw new Error('Only a healthy DEMO plan can create a broker command');
    const command: Mt5ExecutionCommand = {
      commandId: randomUUID(),
      idempotencyKey: `order-plan:${plan.id}:create`,
      orderPlanId: plan.id,
      commandType: 'CREATE_ORDER',
      accountKey: plan.accountKey,
      brokerSymbol: plan.brokerSymbol,
      direction: plan.direction,
      volume: plan.requestedVolume,
      initialStop: plan.initialStop,
      brokerPositionKey: null,
      expectedSessionId: plan.expectedSessionId,
      createdAt: now(),
      expiresAt: plan.expiresAt,
      maxSpreadPips: plan.maxSpreadPips,
    };
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare('INSERT INTO execution_commands VALUES (?,?,?,?,?,?,?,?,?)')
        .run(
          command.commandId,
          plan.id,
          command.idempotencyKey,
          command.commandType,
          'CREATED',
          0,
          JSON.stringify(command),
          command.createdAt,
          command.createdAt,
        );
      this.sqlite
        .prepare('INSERT INTO execution_command_events VALUES (?,?,?,?,?,?,?)')
        .run(
          randomUUID(),
          command.commandId,
          null,
          'CREATED',
          'COMMAND_CREATED',
          'Durable idempotent command created',
          command.createdAt,
        );
    })();
    return command;
  }

  pendingCommands(): readonly Mt5ExecutionCommand[] {
    return Object.freeze(
      (
        this.sqlite
          .prepare(`SELECT command.payload_json FROM execution_commands command
            JOIN order_plans plan ON plan.id=command.order_plan_id
            JOIN execution_intents intent ON intent.id=plan.execution_intent_id
            LEFT JOIN strategy_runtimes runtime ON runtime.id=intent.strategy_runtime_id
            LEFT JOIN colony_automation_assignments automation ON automation.colony_id=runtime.colony_id
            WHERE command.status IN ('CREATED','SENDING','UNKNOWN','ACKNOWLEDGED') AND command.attempt_count<3
              AND (runtime.id IS NULL OR automation.colony_id IS NULL OR automation.entry_armed=1)
            ORDER BY command.created_at,command.id`)
          .all() as Array<{ payload_json: string }>
      ).map((row) =>
        Object.freeze(json<Mt5ExecutionCommand>(row.payload_json)),
      ),
    );
  }
  hasUnresolvedExecution(): boolean {
    return Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM execution_lifecycles WHERE state IN ('COMMAND_PENDING','SENT','ACKNOWLEDGED','PARTIALLY_FILLED','FILLED','PROTECTING','UNKNOWN') LIMIT 1",
        )
        .get(),
    );
  }

  attemptCount(commandId: string): number {
    return (
      (
        this.sqlite
          .prepare('SELECT attempt_count FROM execution_commands WHERE id=?')
          .get(commandId) as { attempt_count: number } | undefined
      )?.attempt_count ?? 0
    );
  }

  rejectUnsent(commandId: string, detail: string): void {
    const row = this.sqlite
      .prepare('SELECT status,order_plan_id FROM execution_commands WHERE id=?')
      .get(commandId) as { status: string; order_plan_id: string } | undefined;
    if (!row || row.status !== 'CREATED') return;
    this.commandTransition(commandId, 'FAILED', 'PRE_SEND_BLOCK', detail);
    this.lifecycle(row.order_plan_id, 'REJECTED', 'PRE_SEND_BLOCK', detail);
  }

  markSending(commandId: string): void {
    if (
      !this.commandTransition(
        commandId,
        'SENDING',
        'COMMAND_SENT',
        'Sent/retried through the execution gateway',
      )
    )
      return;
    const row = this.sqlite
      .prepare('SELECT order_plan_id FROM execution_commands WHERE id=?')
      .get(commandId) as { order_plan_id: string } | undefined;
    if (row)
      this.lifecycle(
        row.order_plan_id,
        'SENT',
        'COMMAND_SENT',
        'Agent command sent',
      );
  }
  markUnknown(commandId: string, detail: string): void {
    const current = this.sqlite
      .prepare('SELECT status,order_plan_id FROM execution_commands WHERE id=?')
      .get(commandId) as { status: string; order_plan_id: string } | undefined;
    if (!current || current.status !== 'SENDING') return;
    this.commandTransition(commandId, 'UNKNOWN', 'DELIVERY_UNCERTAIN', detail);
    this.lifecycle(
      current.order_plan_id,
      'UNKNOWN',
      'DELIVERY_UNCERTAIN',
      detail,
    );
  }

  recordAgentMessage(envelope: Mt5AgentEnvelope): void {
    const payload = envelope.payload;
    if (
      !['COMMAND_ACK', 'FILL', 'PROTECTION_ATTEMPT', 'FLATTEN_RESULT'].includes(
        payload.kind,
      )
    )
      return;
    this.sqlite.transaction(() =>
      this.applyBrokerEvent(
        envelope.messageId,
        payload as ExecutionPayload,
        envelope.sentAt,
      ),
    )();
  }
  private safety(
    detail: string,
    stamp: string,
    severity: 'WARNING' | 'BLOCKING' = 'WARNING',
  ): void {
    this.sqlite
      .prepare('INSERT INTO mt5_safety_events VALUES (?,?,?,?,?,?)')
      .run(
        randomUUID(),
        'STALE_EXECUTION_EVENT',
        severity,
        detail,
        stamp,
        null,
      );
  }

  private applyBrokerEvent(
    messageId: string,
    payload: ExecutionPayload,
    receivedAt: string,
  ): void {
    const command = this.sqlite
      .prepare(
        'SELECT order_plan_id,status,idempotency_key FROM execution_commands WHERE id=?',
      )
      .get(payload.commandId) as
      | { order_plan_id: string; status: string; idempotency_key: string }
      | undefined;
    if (!command) {
      this.safety(
        `Ignored ${payload.kind} for unknown command ${payload.commandId}`,
        receivedAt,
      );
      return;
    }
    const planId = command.order_plan_id;
    if ('orderPlanId' in payload && payload.orderPlanId !== planId) {
      this.safety(
        `Ignored ${payload.kind}: OrderPlan identity mismatch`,
        receivedAt,
        'BLOCKING',
      );
      return;
    }
    const eventId = 'eventId' in payload ? payload.eventId : messageId;
    if (
      this.sqlite
        .prepare(
          'SELECT 1 FROM broker_execution_events WHERE event_id=? OR message_id=?',
        )
        .get(eventId, messageId)
    )
      return;
    this.sqlite
      .prepare('INSERT INTO broker_execution_events VALUES (?,?,?,?,?,?,?)')
      .run(
        eventId,
        messageId,
        payload.commandId,
        planId,
        payload.kind,
        JSON.stringify(payload),
        'occurredAt' in payload
          ? payload.occurredAt
          : 'filledAt' in payload
            ? payload.filledAt
            : receivedAt,
      );
    const lifecycle = this.sqlite
      .prepare(
        'SELECT state,filled_volume FROM execution_lifecycles WHERE order_plan_id=?',
      )
      .get(planId) as { state: string; filled_volume: number };
    if (
      terminalCommands.has(command.status) ||
      terminalLifecycles.has(lifecycle.state)
    ) {
      this.safety(
        `Audited but ignored late ${payload.kind} for terminal execution ${planId}`,
        receivedAt,
      );
      return;
    }

    if (payload.kind === 'COMMAND_ACK') {
      if (lifecycle.filled_volume > 0) {
        this.safety(
          `Audited but ignored late COMMAND_ACK after broker fill for ${planId}`,
          receivedAt,
        );
        return;
      }
      if (payload.idempotencyKey !== command.idempotency_key) {
        this.safety(
          `Ignored COMMAND_ACK with mismatched idempotency identity for ${planId}`,
          receivedAt,
          'BLOCKING',
        );
        return;
      }
      if (payload.status === 'REJECTED') {
        this.commandTransition(
          payload.commandId,
          'FAILED',
          'BROKER_REJECTED',
          payload.reason ?? 'Broker rejected command',
        );
        this.lifecycle(
          planId,
          'REJECTED',
          'BROKER_REJECTED',
          payload.reason ?? 'Broker rejected command',
        );
      } else {
        this.commandTransition(
          payload.commandId,
          'ACKNOWLEDGED',
          payload.status,
          payload.reason ?? 'Broker accepted idempotent command',
        );
        this.lifecycle(
          planId,
          'ACKNOWLEDGED',
          payload.status,
          'Broker acknowledgement received; this is not treated as a fill.',
        );
      }
      return;
    }

    const plan = json<OrderPlan>(
      (
        this.sqlite
          .prepare('SELECT payload_json FROM order_plans WHERE id=?')
          .get(planId) as { payload_json: string }
      ).payload_json,
    );
    if (payload.kind === 'FILL') {
      const prior = this.sqlite
        .prepare(
          'SELECT broker_order_key,broker_position_key,cumulative_volume FROM execution_fills WHERE order_plan_id=? ORDER BY cumulative_volume DESC LIMIT 1',
        )
        .get(planId) as
        | {
            broker_order_key: string;
            broker_position_key: string;
            cumulative_volume: number;
          }
        | undefined;
      const expectedDelta =
        payload.cumulativeVolume - (prior?.cumulative_volume ?? 0);
      const identityOkay =
        !prior ||
        (prior.broker_order_key === payload.brokerOrderKey &&
          prior.broker_position_key === payload.brokerPositionKey);
      const quantityOkay =
        payload.cumulativeVolume <= plan.requestedVolume + 1e-8 &&
        payload.cumulativeVolume > (prior?.cumulative_volume ?? 0) &&
        closeEnough(payload.volume, expectedDelta) &&
        closeEnough(
          payload.remainingVolume,
          plan.requestedVolume - payload.cumulativeVolume,
        );
      if (!identityOkay || !quantityOkay) {
        this.safety(
          `Ignored stale/inconsistent FILL for ${planId}; broker identities and cumulative quantities must be monotonic`,
          receivedAt,
          'BLOCKING',
        );
        return;
      }
      this.sqlite
        .prepare('INSERT INTO execution_fills VALUES (?,?,?,?,?,?,?,?,?)')
        .run(
          payload.eventId,
          planId,
          payload.brokerOrderKey,
          payload.brokerPositionKey,
          payload.volume,
          payload.price,
          payload.cumulativeVolume,
          payload.remainingVolume,
          payload.filledAt,
        );
      this.sqlite
        .prepare(
          'UPDATE execution_lifecycles SET filled_volume=?,updated_at=?,detail=? WHERE order_plan_id=?',
        )
        .run(
          payload.cumulativeVolume,
          payload.filledAt,
          'Broker fill received; initial protection is not yet verified.',
          planId,
        );
      this.lifecycle(
        planId,
        payload.remainingVolume > 0 ? 'PARTIALLY_FILLED' : 'FILLED',
        payload.remainingVolume > 0 ? 'PARTIAL_FILL' : 'FILL',
        'Broker fill recorded; no Position is materialized from intent or acknowledgement.',
      );
      this.lifecycle(
        planId,
        'PROTECTING',
        'INITIAL_PROTECTION_REQUIRED',
        'Filled exposure awaits verified initial protection.',
      );
      return;
    }

    if (payload.kind === 'PROTECTION_ATTEMPT') {
      const fill = this.sqlite
        .prepare(
          'SELECT cumulative_volume FROM execution_fills WHERE order_plan_id=? AND broker_position_key=? ORDER BY cumulative_volume DESC LIMIT 1',
        )
        .get(planId, payload.brokerPositionKey) as
        { cumulative_volume: number } | undefined;
      const priorStop = this.sqlite
        .prepare(
          "SELECT actual_stop FROM initial_protection_attempts WHERE order_plan_id=? AND broker_position_key=? AND status='VERIFIED' ORDER BY occurred_at DESC,rowid DESC LIMIT 1",
        )
        .get(planId, payload.brokerPositionKey) as
        { actual_stop: number } | undefined;
      const noWorse =
        payload.actualStop === null ||
        !priorStop ||
        (plan.direction === 'LONG'
          ? payload.actualStop >= priorStop.actual_stop
          : payload.actualStop <= priorStop.actual_stop);
      const noWorseThanRequested =
        payload.actualStop === null ||
        (plan.direction === 'LONG'
          ? payload.actualStop >= payload.requestedStop
          : payload.actualStop <= payload.requestedStop);
      const noWorseThanPlan =
        plan.direction === 'LONG'
          ? payload.requestedStop >= plan.initialStop
          : payload.requestedStop <= plan.initialStop;
      const valid =
        Boolean(fill) &&
        closeEnough(payload.protectedVolume, fill!.cumulative_volume) &&
        payload.protectedVolume <= plan.requestedVolume + 1e-8 &&
        payload.idempotencyKey.startsWith(`order-plan:${planId}:protect:`) &&
        noWorse &&
        noWorseThanRequested &&
        noWorseThanPlan &&
        (payload.status === 'REJECTED' || payload.actualStop !== null);
      if (!valid) {
        this.safety(
          `Rejected unsafe PROTECTION_ATTEMPT for ${planId}: quantity, identity, or no-worsening invariant failed`,
          receivedAt,
          'BLOCKING',
        );
        this.lifecycle(
          planId,
          'UNKNOWN',
          'INVALID_PROTECTION_EVENT',
          'Broker protection result could not be verified.',
        );
        return;
      }
      this.sqlite
        .prepare(
          'INSERT INTO initial_protection_attempts VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          payload.eventId,
          planId,
          payload.brokerPositionKey,
          payload.attempt,
          payload.requestedStop,
          payload.actualStop,
          payload.status,
          payload.reason,
          payload.occurredAt,
        );
      this.sqlite
        .prepare(
          'INSERT INTO execution_safety_operations VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          payload.eventId,
          planId,
          payload.brokerCommandId,
          payload.idempotencyKey,
          'SET_INITIAL_STOP',
          payload.brokerPositionKey,
          payload.protectedVolume,
          payload.requestedStop,
          payload.status,
          payload.attempt,
          payload.occurredAt,
        );
      if (payload.status === 'VERIFIED')
        this.materializeOrUpdate(
          plan,
          payload.brokerPositionKey,
          payload.protectedVolume,
          payload.occurredAt,
        );
      else
        this.lifecycle(
          planId,
          'PROTECTING',
          'PROTECTION_RETRY',
          payload.reason ??
            'Initial protection rejected; bounded Agent retry required',
        );
      return;
    }

    const fill = this.sqlite
      .prepare(
        'SELECT cumulative_volume FROM execution_fills WHERE order_plan_id=? AND broker_position_key=? ORDER BY cumulative_volume DESC LIMIT 1',
      )
      .get(planId, payload.brokerPositionKey) as
      { cumulative_volume: number } | undefined;
    const failures = (
      this.sqlite
        .prepare(
          "SELECT COUNT(*) count FROM initial_protection_attempts WHERE order_plan_id=? AND broker_position_key=? AND status='REJECTED'",
        )
        .get(planId, payload.brokerPositionKey) as { count: number }
    ).count;
    const valid =
      Boolean(fill) &&
      failures === 2 &&
      closeEnough(payload.targetVolume, fill!.cumulative_volume) &&
      payload.idempotencyKey ===
        `order-plan:${planId}:flatten:${payload.brokerPositionKey}` &&
      (payload.status === 'REJECTED' ||
        closeEnough(payload.closedVolume, payload.targetVolume));
    if (!valid) {
      this.safety(
        `Rejected unsafe FLATTEN_RESULT for ${planId}: bounded-retry, quantity, or idempotency invariant failed`,
        receivedAt,
        'BLOCKING',
      );
      this.lifecycle(
        planId,
        'UNKNOWN',
        'INVALID_FLATTEN_EVENT',
        'Emergency flatten result could not be verified.',
      );
      return;
    }
    this.sqlite
      .prepare(
        'INSERT INTO execution_safety_operations VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        payload.eventId,
        planId,
        payload.brokerCommandId,
        payload.idempotencyKey,
        'SAFETY_FLATTEN',
        payload.brokerPositionKey,
        payload.targetVolume,
        null,
        payload.status,
        2,
        payload.occurredAt,
      );
    if (payload.status === 'VERIFIED') {
      const link = this.sqlite
        .prepare(
          'SELECT position_id FROM execution_position_links WHERE order_plan_id=?',
        )
        .get(planId) as { position_id: string } | undefined;
      if (link)
        this.sqlite
          .prepare(
            "UPDATE positions SET current_size=0,current_state='CLOSED',closed_at=? WHERE id=?",
          )
          .run(payload.occurredAt, link.position_id);
      this.commandTransition(
        payload.commandId,
        'COMPLETED',
        'SAFETY_FLATTEN_VERIFIED',
        'Affected automated exposure flattened after protection failure',
      );
      this.lifecycle(
        planId,
        'FLATTENED',
        'SAFETY_FLATTEN_VERIFIED',
        'Initial protection failed after bounded retry; affected automated exposure was flattened.',
      );
    } else
      this.lifecycle(
        planId,
        'UNKNOWN',
        'SAFETY_FLATTEN_FAILED',
        payload.reason ?? 'Flatten could not be verified; recovery required',
      );
  }

  private materializeOrUpdate(
    plan: OrderPlan,
    brokerPositionKey: string,
    protectedVolume: number,
    stamp: string,
  ): void {
    const fills = this.sqlite
      .prepare(
        'SELECT volume,price,remaining_volume,filled_at,cumulative_volume FROM execution_fills WHERE order_plan_id=? AND broker_position_key=? AND cumulative_volume<=? ORDER BY cumulative_volume',
      )
      .all(plan.id, brokerPositionKey, protectedVolume + 1e-8) as Array<{
      volume: number;
      price: number;
      remaining_volume: number;
      filled_at: string;
      cumulative_volume: number;
    }>;
    const final = fills.at(-1);
    if (!final || !closeEnough(final.cumulative_volume, protectedVolume))
      throw new Error(
        'Protection must resolve the exact broker-filled quantity',
      );
    const entry =
      fills.reduce((sum, fill) => sum + fill.volume * fill.price, 0) /
      protectedVolume;
    const link = this.sqlite
      .prepare(
        'SELECT position_id FROM execution_position_links WHERE order_plan_id=?',
      )
      .get(plan.id) as { position_id: string } | undefined;
    if (link)
      this.sqlite
        .prepare(
          'UPDATE positions SET original_size=?,current_size=?,entry_price=? WHERE id=?',
        )
        .run(protectedVolume, protectedVolume, entry, link.position_id);
    else {
      const sequence = (
        this.sqlite
          .prepare(
            'SELECT COALESCE(MAX(sequence_no),0)+1 next FROM attempts WHERE colony_id=?',
          )
          .get(plan.colonyId) as { next: number }
      ).next;
      const attemptId = randomUUID(),
        tradeId = randomUUID(),
        positionId = randomUUID();
      this.sqlite
        .prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?)')
        .run(
          attemptId,
          plan.colonyId,
          plan.strategyRuntimeId,
          sequence,
          final.filled_at,
          null,
          null,
          null,
        );
      this.sqlite
        .prepare('INSERT INTO trades VALUES (?,?,?,?,?,?,?,?)')
        .run(
          tradeId,
          attemptId,
          plan.colonyId,
          plan.ideaVersionId,
          plan.strategyMapVersionId,
          plan.direction,
          final.filled_at,
          'ARISE_AUTO',
        );
      this.sqlite
        .prepare('INSERT INTO positions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          positionId,
          tradeId,
          plan.accountKey,
          brokerPositionKey,
          plan.colonyId,
          plan.colonyId,
          plan.direction,
          protectedVolume,
          protectedVolume,
          entry,
          'SCOUT',
          final.filled_at,
          null,
        );
      this.sqlite
        .prepare('INSERT INTO execution_position_links VALUES (?,?,?,?,?,?)')
        .run(plan.id, attemptId, tradeId, positionId, brokerPositionKey, stamp);
    }
    this.sqlite
      .prepare(
        'UPDATE execution_lifecycles SET protected_volume=?,updated_at=? WHERE order_plan_id=?',
      )
      .run(protectedVolume, stamp, plan.id);
    this.lifecycle(
      plan.id,
      final.remaining_volume > 0 ? 'PARTIALLY_FILLED' : 'ACTIVE',
      'INITIAL_PROTECTION_VERIFIED',
      final.remaining_volume > 0
        ? 'Protected partial fill materialized as Scout; remainder remains explicit.'
        : 'Initial protection verified; automated Scout safely established.',
    );
    if (final.remaining_volume === 0)
      this.commandTransition(
        (
          this.sqlite
            .prepare(
              "SELECT id FROM execution_commands WHERE order_plan_id=? AND command_type='CREATE_ORDER'",
            )
            .get(plan.id) as { id: string }
        ).id,
        'COMPLETED',
        'ORDER_LIFECYCLE_COMPLETE',
        'Fill and initial protection verified',
      );
  }

  private commandTransition(
    id: string,
    to: string,
    eventType: string,
    detail: string,
  ): boolean {
    const row = this.sqlite
      .prepare('SELECT status,attempt_count FROM execution_commands WHERE id=?')
      .get(id) as { status: string; attempt_count: number } | undefined;
    if (!row || row.status === to || terminalCommands.has(row.status))
      return false;
    const stamp = now();
    const attempts =
      to === 'SENDING' ? row.attempt_count + 1 : row.attempt_count;
    this.sqlite
      .prepare(
        'UPDATE execution_commands SET status=?,attempt_count=?,updated_at=? WHERE id=?',
      )
      .run(to, attempts, stamp, id);
    this.sqlite
      .prepare('INSERT INTO execution_command_events VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), id, row.status, to, eventType, detail, stamp);
    return true;
  }
  private lifecycle(
    planId: string,
    to: string,
    eventType: string,
    detail: string,
  ): boolean {
    const row = this.sqlite
      .prepare('SELECT state FROM execution_lifecycles WHERE order_plan_id=?')
      .get(planId) as { state: string } | undefined;
    if (!row || row.state === to || terminalLifecycles.has(row.state))
      return false;
    const stamp = now();
    this.sqlite
      .prepare(
        'UPDATE execution_lifecycles SET state=?,updated_at=?,detail=? WHERE order_plan_id=?',
      )
      .run(to, stamp, detail, planId);
    this.sqlite
      .prepare('INSERT INTO execution_lifecycle_events VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), planId, row.state, to, eventType, detail, stamp);
    return true;
  }

  workspace(): unknown {
    return {
      intents: this.sqlite
        .prepare(
          'SELECT payload_json payload FROM execution_intents ORDER BY created_at DESC',
        )
        .all()
        .map((r: any) => json(r.payload)),
      validations: this.sqlite
        .prepare(
          'SELECT id,execution_intent_id intentId,status,checks_json checks,evaluated_at evaluatedAt FROM execution_validations ORDER BY evaluated_at DESC',
        )
        .all()
        .map((r: any) => ({ ...r, checks: json(r.checks) })),
      plans: this.sqlite
        .prepare(
          'SELECT payload_json payload FROM order_plans ORDER BY created_at DESC',
        )
        .all()
        .map((r: any) => json(r.payload)),
      lifecycles: this.sqlite
        .prepare(
          'SELECT order_plan_id orderPlanId,state,filled_volume filledVolume,protected_volume protectedVolume,updated_at updatedAt,detail FROM execution_lifecycles ORDER BY updated_at DESC',
        )
        .all(),
      commands: this.sqlite
        .prepare(
          'SELECT id commandId,order_plan_id orderPlanId,idempotency_key idempotencyKey,command_type commandType,status,attempt_count attemptCount,created_at createdAt,updated_at updatedAt FROM execution_commands ORDER BY created_at DESC',
        )
        .all(),
    };
  }
}
