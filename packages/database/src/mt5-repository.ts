/* eslint-disable @typescript-eslint/no-explicit-any -- better-sqlite3 returns dynamic records which are validated by mt5WorkspaceSchema. */
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  classifyExternalPositionInputSchema,
  mt5AgentEnvelopeSchema,
  mt5WorkspaceSchema,
  type Mt5AgentEnvelope,
  type Mt5Snapshot,
  type Mt5Workspace,
} from '@arise/shared';

type Trigger = 'STARTUP' | 'RECONNECT' | 'MANUAL';
type Quote = Mt5Snapshot['quotes'][number];
type Candle = Mt5Snapshot['candles'][number];
type BrokerPosition = Mt5Snapshot['positions'][number];
const now = () => new Date().toISOString();
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const brokerMarker = (idempotencyKey: string) =>
  `ARISE:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)}`;
const json = <T>(value: string) => JSON.parse(value) as T;

export class Mt5Repository {
  constructor(private readonly sqlite: Database.Database) {}

  setConnection(
    state: Mt5Workspace['connection']['state'],
    detail: string,
    patch: {
      transportMode?: 'FAKE_HARNESS' | 'MT5_READ_ONLY' | 'MT5_DEMO' | null;
      sessionId?: string | null;
      terminalConnected?: boolean;
      lastMessageAt?: string | null;
      truth?: 'VERIFIED' | 'UNKNOWN';
    } = {},
  ): void {
    const prior = this.sqlite
      .prepare(
        'SELECT connection_state FROM mt5_session_state WHERE singleton=1',
      )
      .get() as { connection_state: string };
    const stamp = now();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `UPDATE mt5_session_state SET connection_state=?, truth_state=COALESCE(?,truth_state), transport_mode=COALESCE(?,transport_mode), session_id=COALESCE(?,session_id), terminal_connected=COALESCE(?,terminal_connected), last_message_at=COALESCE(?,last_message_at), detail=?, updated_at=? WHERE singleton=1`,
        )
        .run(
          state,
          patch.truth ?? null,
          patch.transportMode ?? null,
          patch.sessionId ?? null,
          patch.terminalConnected === undefined
            ? null
            : Number(patch.terminalConnected),
          patch.lastMessageAt ?? null,
          detail,
          stamp,
        );
      if (prior.connection_state !== state)
        this.sqlite
          .prepare('INSERT INTO mt5_connection_events VALUES (?,?,?,?,?,?)')
          .run(
            randomUUID(),
            prior.connection_state,
            state,
            detail,
            stamp,
            patch.sessionId ?? null,
          );
    })();
  }

  enqueue(
    messageId: string,
    kind: 'HELLO' | 'SNAPSHOT_REQUEST' | 'HEARTBEAT',
    payload: unknown,
  ): void {
    const stamp = now();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare('INSERT OR IGNORE INTO mt5_outbox VALUES (?,?,?,?,?,?)')
        .run(messageId, kind, JSON.stringify(payload), 'PENDING', stamp, stamp);
      if (
        (
          this.sqlite.prepare('SELECT changes() changes').get() as {
            changes: number;
          }
        ).changes
      )
        this.sqlite
          .prepare('INSERT INTO mt5_outbox_events VALUES (?,?,?,?,?,?)')
          .run(
            randomUUID(),
            messageId,
            null,
            'PENDING',
            stamp,
            'Read-only transport message queued',
          );
    })();
  }
  markOutbox(
    messageId: string,
    status: 'SENT' | 'ACKNOWLEDGED' | 'FAILED' | 'UNKNOWN',
    detail: string,
  ): void {
    const row = this.sqlite
      .prepare('SELECT status FROM mt5_outbox WHERE message_id=?')
      .get(messageId) as { status: string } | undefined;
    if (!row || row.status === status) return;
    const stamp = now();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          'UPDATE mt5_outbox SET status=?,updated_at=? WHERE message_id=?',
        )
        .run(status, stamp, messageId);
      this.sqlite
        .prepare('INSERT INTO mt5_outbox_events VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), messageId, row.status, status, stamp, detail);
    })();
  }

  ingest(
    raw: unknown,
    trigger: Trigger = 'RECONNECT',
  ): { duplicate: boolean; workspace: Mt5Workspace } {
    const envelope = mt5AgentEnvelopeSchema.parse(raw);
    const payloadHash = hash(envelope);
    const seen = this.sqlite
      .prepare('SELECT payload_hash FROM mt5_inbox WHERE message_id=?')
      .get(envelope.messageId) as { payload_hash: string } | undefined;
    if (seen) {
      if (seen.payload_hash !== payloadHash)
        throw new Error(`MT5 message identity conflict: ${envelope.messageId}`);
      return { duplicate: true, workspace: this.workspace() };
    }
    this.sqlite.transaction(() => {
      const stamp = now();
      this.sqlite
        .prepare('INSERT INTO mt5_inbox VALUES (?,?,?,?,?,?)')
        .run(
          envelope.messageId,
          payloadHash,
          envelope.payload.kind,
          envelope.correlationId,
          stamp,
          stamp,
        );
      if (envelope.correlationId)
        this.markOutbox(
          envelope.correlationId,
          'ACKNOWLEDGED',
          `${envelope.payload.kind} received`,
        );
      if (envelope.payload.kind === 'BROKER_SNAPSHOT')
        this.applySnapshot(envelope, envelope.payload.snapshot, trigger);
      if (envelope.payload.kind === 'QUOTE')
        this.applyQuote(envelope.payload.quote);
      if (envelope.payload.kind === 'CANDLE')
        this.applyCandle(envelope.payload.candle);
    })();
    return { duplicate: false, workspace: this.workspace() };
  }

  private accountKey(): string | null {
    return (
      this.sqlite
        .prepare('SELECT account_key FROM mt5_session_state WHERE singleton=1')
        .get() as { account_key: string | null }
    ).account_key;
  }
  private mapping(account: string, symbol: string): string {
    return (
      (
        this.sqlite
          .prepare(
            'SELECT canonical_symbol FROM broker_symbol_mappings WHERE account_key=? AND broker_symbol=?',
          )
          .get(account, symbol) as { canonical_symbol: string } | undefined
      )?.canonical_symbol ?? symbol
    );
  }
  private applyQuote(quote: Quote): void {
    const account = this.accountKey();
    if (!account) return;
    const canonical = this.mapping(account, quote.brokerSymbol);
    const prior = this.sqlite
      .prepare(
        'SELECT sequence FROM broker_quotes_current WHERE account_key=? AND broker_symbol=?',
      )
      .get(account, quote.brokerSymbol) as { sequence: number } | undefined;
    if (prior && prior.sequence >= quote.sequence) return;
    this.sqlite
      .prepare(
        'INSERT INTO broker_quotes_current VALUES (?,?,?,?,?,?) ON CONFLICT(account_key,broker_symbol) DO UPDATE SET canonical_symbol=excluded.canonical_symbol,sequence=excluded.sequence,payload_json=excluded.payload_json,received_at=excluded.received_at',
      )
      .run(
        account,
        quote.brokerSymbol,
        canonical,
        quote.sequence,
        JSON.stringify(quote),
        quote.receivedAt,
      );
  }
  private applyCandle(candle: Candle): void {
    const account = this.accountKey();
    if (!account) return;
    this.sqlite
      .prepare(
        'INSERT INTO broker_candles VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_key,broker_symbol,timeframe,open_time) DO UPDATE SET payload_json=excluded.payload_json,origin=excluded.origin',
      )
      .run(
        account,
        candle.brokerSymbol,
        this.mapping(account, candle.brokerSymbol),
        candle.timeframe,
        candle.openTime,
        JSON.stringify(candle),
        candle.origin,
      );
  }

  private applySnapshot(
    envelope: Mt5AgentEnvelope,
    snapshot: Mt5Snapshot,
    trigger: Trigger,
  ): void {
    const runId = randomUUID(),
      stamp = now(),
      priorAccount = this.accountKey();
    const latestSnapshot = snapshot.account
      ? (this.sqlite
          .prepare(
            'SELECT id snapshot_id,captured_at FROM broker_snapshots WHERE account_key=? AND complete=1 ORDER BY captured_at DESC,rowid DESC LIMIT 1',
          )
          .get(snapshot.account.accountKey) as
          | { snapshot_id: string; captured_at: string }
          | undefined)
      : undefined;
    this.sqlite
      .prepare('INSERT INTO broker_snapshots VALUES (?,?,?,?,?,?,?)')
      .run(
        snapshot.snapshotId,
        envelope.messageId,
        snapshot.account?.accountKey ?? null,
        Number(snapshot.complete),
        snapshot.capturedAt,
        JSON.stringify(snapshot),
        snapshot.unavailableReason,
      );
    const capturedAt = Date.parse(snapshot.capturedAt);
    if (snapshot.complete && !Number.isFinite(capturedAt)) {
      const detail = 'Broker snapshot timestamp is unverifiable; reconciliation is blocked.';
      this.sqlite
        .prepare('INSERT INTO mt5_safety_events VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), 'INVALID_BROKER_SNAPSHOT_TIME', 'BLOCKING', detail, stamp, runId);
      this.setConnection('BLOCKED', detail, {
        truth: 'UNKNOWN',
        lastMessageAt: envelope.sentAt,
      });
      return;
    }
    if (
      snapshot.complete &&
      latestSnapshot &&
      capturedAt < Date.parse(latestSnapshot.captured_at)
    ) {
      const detail = `Stale broker snapshot ${snapshot.snapshotId} was audited but not applied over newer snapshot ${latestSnapshot.snapshot_id}.`;
      this.sqlite
        .prepare('INSERT INTO mt5_safety_events VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), 'STALE_BROKER_SNAPSHOT', 'WARNING', detail, stamp, runId);
      return;
    }
    if (!snapshot.complete || !snapshot.account) {
      this.sqlite
        .prepare("UPDATE broker_positions_current SET reality_state='UNKNOWN'")
        .run();
      this.sqlite
        .prepare(
          "UPDATE broker_pending_orders_current SET reality_state='UNKNOWN'",
        )
        .run();
      this.sqlite
        .prepare('INSERT INTO reconciliation_runs VALUES (?,?,?,?,?,?,?,?)')
        .run(
          runId,
          trigger,
          'UNKNOWN',
          snapshot.snapshotId,
          priorAccount,
          stamp,
          stamp,
          snapshot.unavailableReason ?? 'Broker truth unavailable',
        );
      this.sqlite
        .prepare('INSERT INTO reconciliation_items VALUES (?,?,?,?,?,?)')
        .run(
          randomUUID(),
          runId,
          'UNKNOWN',
          'BROKER',
          'snapshot',
          snapshot.unavailableReason ?? 'Broker truth unavailable',
        );
      this.sqlite
        .prepare('INSERT INTO mt5_safety_events VALUES (?,?,?,?,?,?)')
        .run(
          randomUUID(),
          'BROKER_TRUTH_UNKNOWN',
          'BLOCKING',
          snapshot.unavailableReason ?? 'Broker truth unavailable',
          stamp,
          runId,
        );
      this.setConnection(
        'BLOCKED',
        'Broker truth is UNKNOWN; read-only recovery is required.',
        {
          truth: 'UNKNOWN',
          terminalConnected: false,
          lastMessageAt: envelope.sentAt,
        },
      );
      return;
    }
    if (priorAccount && priorAccount !== snapshot.account.accountKey) {
      const detail = `Account mismatch: expected ${priorAccount}, received ${snapshot.account.accountKey}`;
      this.sqlite
        .prepare('INSERT INTO reconciliation_runs VALUES (?,?,?,?,?,?,?,?)')
        .run(
          runId,
          trigger,
          'RECOVERY_REQUIRED',
          snapshot.snapshotId,
          snapshot.account.accountKey,
          stamp,
          stamp,
          detail,
        );
      this.sqlite
        .prepare('INSERT INTO reconciliation_items VALUES (?,?,?,?,?,?)')
        .run(
          randomUUID(),
          runId,
          'UNKNOWN',
          'ACCOUNT',
          snapshot.account.accountKey,
          detail,
        );
      this.sqlite
        .prepare('INSERT INTO mt5_safety_events VALUES (?,?,?,?,?,?)')
        .run(
          randomUUID(),
          'ACCOUNT_MISMATCH',
          'BLOCKING',
          detail,
          stamp,
          runId,
        );
      this.setConnection('BLOCKED', detail, {
        truth: 'UNKNOWN',
        lastMessageAt: envelope.sentAt,
      });
      return;
    }
    const account = snapshot.account.accountKey;
    this.sqlite
      .prepare('INSERT INTO broker_account_snapshots VALUES (?,?,?,?,?)')
      .run(
        randomUUID(),
        snapshot.snapshotId,
        account,
        JSON.stringify(snapshot.account),
        snapshot.capturedAt,
      );
    this.sqlite
      .prepare('UPDATE mt5_session_state SET account_key=? WHERE singleton=1')
      .run(account);
    for (const symbol of snapshot.symbols)
      this.sqlite
        .prepare(
          'INSERT INTO broker_symbol_mappings VALUES (?,?,?,?,?) ON CONFLICT(account_key,broker_symbol) DO UPDATE SET canonical_symbol=excluded.canonical_symbol,payload_json=excluded.payload_json,updated_at=excluded.updated_at',
        )
        .run(
          account,
          symbol.brokerSymbol,
          symbol.canonicalSymbol,
          JSON.stringify(symbol),
          stamp,
        );
    const discrepancies: Array<{
      category: string;
      entityType: string;
      entityKey: string;
      detail: string;
    }> = [];
    const incoming = new Set(
      snapshot.positions.map((p) => p.brokerPositionKey),
    );
    const existing = this.sqlite
      .prepare(
        "SELECT broker_position_key FROM broker_positions_current WHERE account_key=? AND reality_state='OPEN'",
      )
      .all(account) as Array<{ broker_position_key: string }>;
    for (const old of existing)
      if (!incoming.has(old.broker_position_key)) {
        this.sqlite
          .prepare(
            'DELETE FROM broker_positions_current WHERE account_key=? AND broker_position_key=?',
          )
          .run(account, old.broker_position_key);
        this.sqlite
          .prepare('INSERT INTO broker_reality_events VALUES (?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            snapshot.snapshotId,
            'POSITION',
            old.broker_position_key,
            'BROKER_CLOSED',
            '{}',
            stamp,
          );
      }
    for (const position of snapshot.positions) {
      const old = this.sqlite
        .prepare(
          'SELECT payload_json,classification,colony_id FROM broker_positions_current WHERE account_key=? AND broker_position_key=?',
        )
        .get(account, position.brokerPositionKey) as
        | {
            payload_json: string;
            classification: string | null;
            colony_id: string | null;
          }
        | undefined;
      const arise = this.sqlite
        .prepare(
          'SELECT p.id,p.current_size,p.entry_price,t.source_type FROM positions p JOIN trades t ON t.id=p.trade_id WHERE p.broker_account_id=? AND p.broker_position_key=?',
        )
        .get(account, position.brokerPositionKey) as
        { id: string; current_size: number; entry_price: number; source_type: string } | undefined;
      const canonical = this.mapping(account, position.brokerSymbol);
      this.sqlite
        .prepare(
          `INSERT INTO broker_positions_current VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(account_key,broker_position_key) DO UPDATE SET canonical_symbol=excluded.canonical_symbol,payload_json=excluded.payload_json,reality_state='OPEN',last_seen_at=excluded.last_seen_at`,
        )
        .run(
          account,
          position.brokerPositionKey,
          canonical,
          JSON.stringify(position),
          'OPEN',
          old?.classification ?? null,
          old?.colony_id ?? null,
          stamp,
          stamp,
        );
      const pendingExecution = !arise
        ? this.pendingExecutionForBrokerPosition(account, position)
        : null;
      if (!arise && !old && !pendingExecution)
        discrepancies.push({
          category: 'BROKER_ONLY',
          entityType: 'POSITION',
          entityKey: position.brokerPositionKey,
          detail:
            'Broker position has no ARISE Position; classification required.',
        });
      if (!arise && !old && pendingExecution)
        this.sqlite
          .prepare('INSERT INTO broker_reality_events VALUES (?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            snapshot.snapshotId,
            'EXECUTION_COMMAND',
            pendingExecution.commandId,
            'PENDING_EXECUTION_MARKER_MATCH',
            JSON.stringify({
              commandId: pendingExecution.commandId,
              brokerPositionKey: position.brokerPositionKey,
              brokerComment: position.comment,
            }),
            stamp,
          );
      const quantityMismatch = arise?.source_type === 'ARISE_AUTO' &&
        Math.abs(arise.current_size - position.volume) > 1e-8;
      const entryPriceMismatch = arise?.source_type === 'ARISE_AUTO' &&
        Math.abs(arise.entry_price - position.openPrice) > 1e-8;
      if (arise?.source_type === 'ARISE_AUTO' && (quantityMismatch || entryPriceMismatch)) {
        this.sqlite
          .prepare(
            'UPDATE positions SET current_size=?,entry_price=? WHERE id=?',
          )
          .run(position.volume, position.openPrice, arise.id);
        if (quantityMismatch)
          discrepancies.push({
            category: 'QUANTITY_MISMATCH',
            entityType: 'POSITION',
            entityKey: position.brokerPositionKey,
            detail: 'Broker volume changed; broker quantity won reconciliation.',
          });
        if (entryPriceMismatch)
          discrepancies.push({
            category: 'UNKNOWN',
            entityType: 'POSITION',
            entityKey: position.brokerPositionKey,
            detail: 'Broker weighted entry price changed; broker entry price won reconciliation.',
          });
      } else if (
        !arise &&
        old &&
        json<any>(old.payload_json).volume !== position.volume
      )
        discrepancies.push({
          category: 'QUANTITY_MISMATCH',
          entityType: 'POSITION',
          entityKey: position.brokerPositionKey,
          detail: 'Broker volume changed; broker value imported.',
        });
      const protectedPlan =
        arise?.source_type === 'ARISE_AUTO'
          ? (this.sqlite
              .prepare(
                "SELECT l.order_plan_id,COALESCE(pc.verified_stop,p.actual_stop) actual_stop,pc.verified_take_profit actual_take_profit FROM execution_position_links l LEFT JOIN position_protection_current pc ON pc.position_id=l.position_id LEFT JOIN initial_protection_attempts p ON p.event_id=(SELECT p2.event_id FROM initial_protection_attempts p2 WHERE p2.order_plan_id=l.order_plan_id AND p2.status='VERIFIED' ORDER BY p2.occurred_at DESC,p2.rowid DESC LIMIT 1) WHERE l.position_id=?",
              )
              .get(arise.id) as
              { order_plan_id: string; actual_stop: number | null; actual_take_profit: number | null } | undefined)
          : undefined;
      if (arise?.source_type === 'ARISE_AUTO') {
        const prior = this.sqlite.prepare('SELECT last_applied_sequence FROM position_protection_current WHERE position_id=?').get(arise.id) as { last_applied_sequence: number } | undefined;
        this.sqlite.prepare(`INSERT INTO position_protection_current VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(position_id) DO UPDATE SET state=excluded.state,broker_position_key=excluded.broker_position_key,broker_volume=excluded.broker_volume,protected_volume=excluded.protected_volume,verified_stop=excluded.verified_stop,verified_take_profit=excluded.verified_take_profit,truth_state='VERIFIED',updated_at=excluded.updated_at`).run(
          arise.id,
          position.stopLoss === null ? 'UNPROTECTED' : 'PROTECTED',
          position.brokerPositionKey,
          position.volume,
          position.stopLoss === null ? 0 : position.volume,
          position.stopLoss,
          position.takeProfit,
          prior?.last_applied_sequence ?? 0,
          'VERIFIED',
          snapshot.capturedAt,
        );
        this.reconcileManagement(arise.id, position, snapshot.capturedAt, snapshot.snapshotId);
      }
      if (protectedPlan) {
        const stopMatches =
          position.stopLoss !== null &&
          protectedPlan.actual_stop !== null &&
          Math.abs(position.stopLoss - protectedPlan.actual_stop) <= 1e-8;
        const takeProfitMatches =
          (position.takeProfit === null && protectedPlan.actual_take_profit === null) ||
          (position.takeProfit !== null &&
            protectedPlan.actual_take_profit !== null &&
            Math.abs(position.takeProfit - protectedPlan.actual_take_profit) <= 1e-8);
        const quantityMatches = arise?.current_size === position.volume;
        const entryMatches = arise !== undefined && Math.abs(arise.entry_price - position.openPrice) <= 1e-8;
        if (!stopMatches || !takeProfitMatches || !quantityMatches || !entryMatches) {
          const detail = !stopMatches || !takeProfitMatches
            ? 'Broker SL/TP differs from the last verified protection state; broker truth won and execution is recovery-blocked.'
            : !entryMatches
              ? 'Broker entry price differs from the materialized automated Position; broker truth won and execution is recovery-blocked.'
            : 'Broker quantity differs from the materialized automated Position; broker truth won and execution is recovery-blocked.';
          if (!stopMatches || !takeProfitMatches)
            discrepancies.push({
              category: 'PROTECTION_MISMATCH',
              entityType: 'POSITION',
              entityKey: position.brokerPositionKey,
              detail,
            });
          this.sqlite
            .prepare(
              "UPDATE execution_lifecycles SET state='UNKNOWN',filled_volume=?,protected_volume=?,updated_at=?,detail=? WHERE order_plan_id=?",
            )
            .run(
              position.volume,
              position.stopLoss === null ? 0 : position.volume,
              stamp,
              detail,
              protectedPlan.order_plan_id,
            );
          this.sqlite
            .prepare('INSERT INTO mt5_safety_events VALUES (?,?,?,?,?,?)')
            .run(
              randomUUID(),
              !stopMatches || !takeProfitMatches
                ? 'PROTECTION_MISMATCH'
                : !entryMatches
                  ? 'BROKER_ENTRY_OVERRIDE'
                  : 'BROKER_QUANTITY_OVERRIDE',
              'BLOCKING',
              detail,
              stamp,
              runId,
            );
        }
      }
    }
    this.sqlite
      .prepare('DELETE FROM broker_pending_orders_current WHERE account_key=?')
      .run(account);
    for (const order of snapshot.pendingOrders)
      this.sqlite
        .prepare(
          'INSERT INTO broker_pending_orders_current VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          account,
          order.brokerOrderKey,
          this.mapping(account, order.brokerSymbol),
          JSON.stringify(order),
          'PENDING',
          stamp,
          stamp,
        );
    for (const quote of snapshot.quotes) this.applyQuote(quote);
    for (const candle of snapshot.candles) this.applyCandle(candle);
    const arisePositions = this.sqlite
      .prepare(
        "SELECT p.id,p.broker_position_key,t.source_type FROM positions p JOIN trades t ON t.id=p.trade_id WHERE p.broker_account_id=? AND p.current_state<>'CLOSED'",
      )
      .all(account) as Array<{
      id: string;
      broker_position_key: string;
      source_type: string;
    }>;
    for (const pos of arisePositions)
      if (!incoming.has(pos.broker_position_key)) {
        discrepancies.push({
          category: 'ARISE_ONLY',
          entityType: 'POSITION',
          entityKey: pos.broker_position_key,
          detail: 'ARISE record is absent at broker; it will not be recreated.',
        });
        if (pos.source_type === 'ARISE_AUTO')
          {
            this.sqlite
              .prepare(
                "UPDATE positions SET current_size=0,current_state='CLOSED',closed_at=? WHERE id=?",
              )
              .run(snapshot.capturedAt, pos.id);
            this.sqlite.prepare(`INSERT INTO position_protection_current VALUES (?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(position_id) DO UPDATE SET state='UNPROTECTED',broker_volume=0,protected_volume=0,verified_stop=NULL,verified_take_profit=NULL,truth_state='VERIFIED',updated_at=excluded.updated_at`).run(
                pos.id, 'UNPROTECTED', pos.broker_position_key, 0, 0, null, null, 0, 'VERIFIED', snapshot.capturedAt,
              );
            this.reconcileManagement(pos.id, null, snapshot.capturedAt, snapshot.snapshotId);
          }
      }
    const status = discrepancies.length ? 'RECOVERY_REQUIRED' : 'MATCHED';
    this.sqlite
      .prepare('INSERT INTO reconciliation_runs VALUES (?,?,?,?,?,?,?,?)')
      .run(
        runId,
        trigger,
        status,
        snapshot.snapshotId,
        account,
        stamp,
        stamp,
        discrepancies.length
          ? `${discrepancies.length} discrepancy item(s)`
          : 'Broker reality verified',
      );
    for (const item of discrepancies)
      this.sqlite
        .prepare('INSERT INTO reconciliation_items VALUES (?,?,?,?,?,?)')
        .run(
          randomUUID(),
          runId,
          item.category,
          item.entityType,
          item.entityKey,
          item.detail,
        );
    this.setConnection(
      discrepancies.length ? 'DEGRADED' : 'CONNECTED',
      discrepancies.length
        ? 'Broker truth verified; external discrepancies require review.'
        : 'Broker reality verified read-only.',
      {
        truth: 'VERIFIED',
        terminalConnected: true,
        lastMessageAt: envelope.sentAt,
      },
    );
  }

  private pendingExecutionForBrokerPosition(
    accountKey: string,
    position: BrokerPosition,
  ): { readonly commandId: string } | null {
    const rows = this.sqlite
      .prepare(`SELECT command.id command_id,command.idempotency_key,command.payload_json
        FROM execution_commands command
        JOIN order_plans plan ON plan.id=command.order_plan_id
        WHERE plan.account_key=?
          AND command.command_type='CREATE_ORDER'
          AND command.status IN ('CREATED','SENDING','UNKNOWN','ACKNOWLEDGED')`)
      .all(accountKey) as Array<{
      command_id: string;
      idempotency_key: string;
      payload_json: string;
    }>;
    for (const row of rows) {
      const command = json<{
        brokerSymbol: string;
        direction: 'LONG' | 'SHORT' | null;
        volume: number | null;
      }>(row.payload_json);
      if (
        position.comment === brokerMarker(row.idempotency_key) &&
        position.brokerSymbol === command.brokerSymbol &&
        position.direction === command.direction &&
        command.volume !== null &&
        Math.abs(position.volume - command.volume) <= 1e-8
      )
        return { commandId: row.command_id };
    }
    return null;
  }

  private reconcileManagement(
    positionId: string,
    brokerPosition: BrokerPosition | null,
    occurredAt: string,
    snapshotId: string,
  ): void {
    const rows = this.sqlite.prepare(`SELECT * FROM management_commands
      WHERE position_id=? AND status IN ('SENDING','UNKNOWN') ORDER BY sequence_no`).all(positionId) as any[];
    for (const row of rows) {
      const command = json<any>(row.payload_json);
      let applied = false;
      if (command.commandType === 'FULL_CLOSE') applied = brokerPosition === null;
      else if (command.commandType === 'PARTIAL_CLOSE' && brokerPosition)
        applied = brokerPosition.volume <= command.expectedBrokerVolume - command.requestedCloseVolume + 1e-8;
      else if (command.commandType === 'MOVE_STOP' && brokerPosition && brokerPosition.stopLoss !== null) {
        applied = command.direction === 'LONG'
          ? brokerPosition!.stopLoss! >= command.requestedStop - 1e-8
          : brokerPosition!.stopLoss! <= command.requestedStop + 1e-8;
      } else if (command.commandType === 'SET_TP' && brokerPosition && brokerPosition.takeProfit !== null)
        applied = Math.abs(brokerPosition.takeProfit! - command.requestedTakeProfit) <= 1e-8;
      else if (command.commandType === 'REMOVE_TP' && brokerPosition)
        applied = brokerPosition.takeProfit === null;
      const commandStatus = applied ? 'COMPLETED' : 'FAILED';
      const requestStatus = applied ? 'VERIFIED' : 'SUPERSEDED';
      const detail = applied
        ? 'Reconnect reconciliation verified the idempotent broker effect.'
        : 'Broker reality did not match the uncertain local command; broker truth superseded it.';
      this.sqlite.prepare('UPDATE management_commands SET status=?,updated_at=? WHERE id=?').run(commandStatus, occurredAt, row.id);
      this.sqlite.prepare('INSERT INTO management_command_events VALUES (?,?,?,?,?,?,?)').run(
        randomUUID(), row.id, row.status, commandStatus, 'BROKER_RECONCILIATION', detail, occurredAt,
      );
      const request = this.sqlite.prepare('SELECT status FROM protection_requests WHERE id=?').get(row.protection_request_id) as { status: string } | undefined;
      if (request && !['SHADOW_COMPLETED','VERIFIED','REJECTED','FAILED','SUPERSEDED'].includes(request.status)) {
        this.sqlite.prepare('UPDATE protection_requests SET status=?,updated_at=? WHERE id=?').run(requestStatus, occurredAt, row.protection_request_id);
        this.sqlite.prepare('INSERT INTO protection_request_events VALUES (?,?,?,?,?,?,?)').run(
          randomUUID(), row.protection_request_id, request.status, requestStatus, 'BROKER_RECONCILIATION', detail, occurredAt,
        );
      }
      this.sqlite.prepare('INSERT INTO protection_verifications VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        randomUUID(), row.protection_request_id, row.id, command.brokerPositionKey,
        brokerPosition?.volume ?? 0, brokerPosition?.stopLoss === null || !brokerPosition ? 0 : brokerPosition.volume,
        brokerPosition?.stopLoss ?? null, brokerPosition?.takeProfit ?? null,
        applied ? 'VERIFIED' : 'UNKNOWN', detail, occurredAt,
      );
      this.sqlite.prepare('INSERT INTO broker_reality_events VALUES (?,?,?,?,?,?,?)').run(
        randomUUID(), snapshotId, 'MANAGEMENT_COMMAND', row.id,
        applied ? 'MANAGEMENT_EFFECT_VERIFIED' : 'MANAGEMENT_EFFECT_SUPERSEDED',
        JSON.stringify({ commandId: row.id, applied, brokerPosition }), occurredAt,
      );
    }
  }

  classify(raw: unknown): Mt5Workspace {
    const input = classifyExternalPositionInputSchema.parse(raw);
    const account = this.accountKey();
    if (!account) throw new Error('Broker account is not established');
    const result = this.sqlite
      .prepare(
        "UPDATE broker_positions_current SET classification=?,colony_id=? WHERE account_key=? AND broker_position_key=? AND reality_state='OPEN'",
      )
      .run(
        input.classification,
        input.colonyId,
        account,
        input.brokerPositionKey,
      );
    if (!result.changes) throw new Error('Open broker position not found');
    this.sqlite
      .prepare('INSERT INTO broker_reality_events VALUES (?,?,?,?,?,?,?)')
      .run(
        randomUUID(),
        null,
        'POSITION',
        input.brokerPositionKey,
        'CLASSIFIED',
        JSON.stringify(input),
        now(),
      );
    return this.workspace();
  }

  workspace(): Mt5Workspace {
    const state = this.sqlite
      .prepare('SELECT * FROM mt5_session_state WHERE singleton=1')
      .get() as any;
    const accountKey = state.account_key as string | null;
    const accountRow = accountKey
      ? (this.sqlite
          .prepare(
            'SELECT payload_json FROM broker_account_snapshots WHERE account_key=? ORDER BY captured_at DESC,id DESC LIMIT 1',
          )
          .get(accountKey) as { payload_json: string } | undefined)
      : undefined;
    const run = this.sqlite
      .prepare(
        'SELECT * FROM reconciliation_runs ORDER BY completed_at DESC,id DESC LIMIT 1',
      )
      .get() as any;
    const discrepancies = run
      ? this.sqlite
          .prepare(
            'SELECT category,entity_type entityType,entity_key entityKey,detail FROM reconciliation_items WHERE reconciliation_run_id=? ORDER BY rowid',
          )
          .all(run.id)
      : [];
    const maps = (table: string) =>
      accountKey
        ? (this.sqlite
            .prepare(
              `SELECT * FROM ${table} WHERE account_key=? ORDER BY rowid`,
            )
            .all(accountKey) as any[])
        : [];
    return mt5WorkspaceSchema.parse({
      connection: {
        state: state.connection_state,
        truth: state.truth_state,
        transportMode: state.transport_mode,
        sessionId: state.session_id,
        terminalConnected: Boolean(state.terminal_connected),
        lastMessageAt: state.last_message_at,
        detail: state.detail,
      },
      account: accountRow ? json(accountRow.payload_json) : null,
      reconciliation: {
        status: run?.status ?? 'UNKNOWN',
        trigger: run?.trigger ?? null,
        completedAt: run?.completed_at ?? null,
        discrepancies,
      },
      symbols: maps('broker_symbol_mappings').map((r) => json(r.payload_json)),
      quotes: maps('broker_quotes_current').map((r) => ({
        ...json<any>(r.payload_json),
        canonicalSymbol: r.canonical_symbol,
      })),
      candles: maps('broker_candles').map((r) => ({
        ...json<any>(r.payload_json),
        canonicalSymbol: r.canonical_symbol,
      })),
      positions: maps('broker_positions_current').map((r) => ({
        ...json<any>(r.payload_json),
        canonicalSymbol: r.canonical_symbol,
        classification: r.classification,
        colonyId: r.colony_id,
        realityState: r.reality_state,
      })),
      pendingOrders: maps('broker_pending_orders_current').map((r) => ({
        ...json<any>(r.payload_json),
        canonicalSymbol: r.canonical_symbol,
        realityState: r.reality_state,
      })),
      readOnly: true,
      executionAvailable: false,
    });
  }
}
