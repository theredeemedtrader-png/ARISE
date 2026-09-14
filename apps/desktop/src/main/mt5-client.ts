import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import {
  MT5_PROTOCOL_VERSION,
  mt5AgentEnvelopeSchema,
  type Mt5DesktopEnvelope,
  type Mt5ExecutionCommand,
  type Mt5ManagementCommand,
  type Mt5Workspace,
} from '@arise/shared';
import type {
  ExecutionRepository,
  Mt5Repository,
  ProtectionRepository,
} from '@arise/database';

export class Mt5ReadOnlyClient {
  private socket: Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private commandTimers = new Map<string, NodeJS.Timeout>();
  private stopped = false;
  private connectedOnce = false;
  private buffer = '';
  private reconciliationTrigger: 'STARTUP' | 'RECONNECT' | 'MANUAL' = 'STARTUP';
  constructor(
    private readonly repository: Mt5Repository,
    private readonly endpoint: { host: string; port: number },
    private readonly executionRepository?: ExecutionRepository,
    private readonly protectionRepository?: ProtectionRepository,
    private readonly appVersion = '0.0.1',
    private readonly observe: (event: string, detail?: string) => void = () => undefined,
  ) {}
  start(): void {
    this.stopped = false;
    this.connect();
  }
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const timer of this.commandTimers.values()) clearTimeout(timer);
    this.commandTimers.clear();
    this.socket?.removeAllListeners();
    this.socket?.destroy();
    this.socket = null;
  }
  workspace(): Mt5Workspace {
    return this.repository.workspace();
  }
  requestReconciliation(): Mt5Workspace {
    if (!this.socket?.writable) {
      this.repository.setConnection(
        'BLOCKED',
        'Manual reconciliation unavailable: broker truth is UNKNOWN.',
        { truth: 'UNKNOWN', terminalConnected: false },
      );
      return this.workspace();
    }
    this.repository.setConnection(
      'RECONCILING',
      'Manual read-only reconciliation requested.',
    );
    this.reconciliationTrigger = 'MANUAL';
    this.send('SNAPSHOT_REQUEST', {
      kind: 'SNAPSHOT_REQUEST',
      trigger: 'MANUAL',
    });
    return this.workspace();
  }
  sendExecutionCommand(command: Mt5ExecutionCommand): void {
    const health = this.workspace();
    const socket = this.socket;
    const firstAttempt =
      (this.executionRepository?.attemptCount(command.commandId) ?? 0) === 0;
    const symbol = health.symbols.find(
      (item) => item.brokerSymbol === command.brokerSymbol,
    );
    const quote = health.quotes.find(
      (item) => item.brokerSymbol === command.brokerSymbol,
    );
    const currentSpread =
      symbol && quote
        ? (quote.ask - quote.bid) / symbol.pipSize
        : Number.POSITIVE_INFINITY;
    const baseUnsafe =
      !socket?.writable ||
      health.connection.state !== 'CONNECTED' ||
      health.connection.truth !== 'VERIFIED' ||
      health.reconciliation.status !== 'MATCHED' ||
      !health.connection.terminalConnected ||
      health.account?.isLive !== false ||
      health.account.accountKey !== command.accountKey;
    const initialContextUnsafe =
      firstAttempt &&
      (health.connection.sessionId !== command.expectedSessionId ||
        Date.parse(command.expiresAt) <= Date.now() ||
        !quote ||
        Date.now() - Date.parse(quote.receivedAt) > 5000 ||
        currentSpread > command.maxSpreadPips);
    if (baseUnsafe || initialContextUnsafe) {
      const detail =
        'Execution gateway blocked send because session/account/reconciliation/quote context is not safe.';
      if (firstAttempt)
        this.executionRepository?.rejectUnsent(command.commandId, detail);
      else this.executionRepository?.markUnknown(command.commandId, detail);
      return;
    }
    const message: Mt5DesktopEnvelope = {
      messageId: randomUUID(),
      correlationId: command.commandId,
      schemaVersion: MT5_PROTOCOL_VERSION,
      sentAt: new Date().toISOString(),
      payload: { kind: 'EXECUTION_COMMAND', command },
    };
    this.executionRepository?.markSending(command.commandId);
    socket.write(`${JSON.stringify(message)}\n`);
    const prior = this.commandTimers.get(command.commandId);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      this.commandTimers.delete(command.commandId);
      this.executionRepository?.markUnknown(
        command.commandId,
        'Agent acknowledgement timed out; delivery outcome is UNKNOWN.',
      );
      const retry = this.executionRepository
        ?.pendingCommands()
        .find((item) => item.commandId === command.commandId);
      if (retry) this.sendExecutionCommand(retry);
    }, 1500);
    timer.unref();
    this.commandTimers.set(command.commandId, timer);
  }
  retryPendingExecution(): void {
    for (const command of this.executionRepository?.pendingCommands() ?? [])
      this.sendExecutionCommand(command);
  }
  sendManagementCommand(command: Mt5ManagementCommand): void {
    const health = this.workspace();
    const socket = this.socket;
    const firstAttempt =
      (this.protectionRepository?.attemptCount(command.commandId) ?? 0) === 0;
    const brokerPosition = health.positions.find(
      (item) => item.brokerPositionKey === command.brokerPositionKey,
    );
    const quote = health.quotes.find(
      (item) => item.brokerSymbol === command.brokerSymbol,
    );
    const unsafe =
      !socket?.writable ||
      health.connection.state !== 'CONNECTED' ||
      health.connection.truth !== 'VERIFIED' ||
      health.reconciliation.status !== 'MATCHED' ||
      !health.connection.terminalConnected ||
      health.account?.isLive !== false ||
      health.account.accountKey !== command.accountKey ||
      (firstAttempt &&
        (health.connection.sessionId !== command.expectedSessionId ||
          Date.parse(command.expiresAt) <= Date.now() ||
          !quote ||
          Date.now() - Date.parse(quote.receivedAt) > 5000 ||
          !brokerPosition ||
          !this.protectionRepository?.isAutomatedPositionKey(command.brokerPositionKey) ||
          Math.abs(brokerPosition.volume - command.expectedBrokerVolume) > 1e-8));
    if (unsafe) {
      const detail =
        'Protection gateway blocked mutation because account/session/reconciliation/ownership/broker quantity is not safe.';
      if (firstAttempt)
        this.protectionRepository?.rejectUnsent(command.commandId, detail);
      else this.protectionRepository?.markUnknown(command.commandId, detail);
      return;
    }
    const message: Mt5DesktopEnvelope = {
      messageId: randomUUID(),
      correlationId: command.commandId,
      schemaVersion: MT5_PROTOCOL_VERSION,
      sentAt: new Date().toISOString(),
      payload: { kind: 'MANAGEMENT_COMMAND', command },
    };
    if (!this.protectionRepository?.markSending(command.commandId)) return;
    socket.write(`${JSON.stringify(message)}\n`);
    const prior = this.commandTimers.get(command.commandId);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      this.commandTimers.delete(command.commandId);
      this.protectionRepository?.markUnknown(
        command.commandId,
        'Agent management acknowledgement timed out; broker effect is UNKNOWN.',
      );
      const retry = this.protectionRepository
        ?.pendingCommands()
        .find((item) => item.commandId === command.commandId);
      if (retry) this.sendManagementCommand(retry);
    }, 1500);
    timer.unref();
    this.commandTimers.set(command.commandId, timer);
  }
  retryPendingManagement(): void {
    for (const command of this.protectionRepository?.pendingCommands() ?? [])
      this.sendManagementCommand(command);
  }
  private connect(): void {
    if (this.stopped) return;
    this.repository.setConnection(
      this.connectedOnce ? 'RECONNECTING' : 'DISCONNECTED',
      `Connecting to local MT5 Agent at ${this.endpoint.host}:${this.endpoint.port}.`,
      { truth: 'UNKNOWN', terminalConnected: false },
    );
    const socket = new Socket();
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(1500);
    socket.once('connect', () => {
      this.observe('mt5-agent-client-connected', `${this.endpoint.host}:${this.endpoint.port}`);
      socket.setTimeout(0);
      this.send('HELLO', {
        kind: 'HELLO',
        appVersion: this.appVersion,
        protocolVersion: MT5_PROTOCOL_VERSION,
        minimumCompatibleVersion: MT5_PROTOCOL_VERSION,
      });
      this.heartbeatTimer = setInterval(
        () => this.send('HEARTBEAT', { kind: 'HEARTBEAT' }),
        5000,
      );
      this.heartbeatTimer.unref();
    });
    socket.on('data', (chunk) => this.receive(String(chunk)));
    socket.once('error', () =>
      this.disconnected(
        'Local MT5 Agent unavailable; broker truth is UNKNOWN.',
      ),
    );
    socket.once('close', () =>
      this.disconnected('MT5 Agent session closed; broker truth is UNKNOWN.'),
    );
    socket.connect(this.endpoint.port, this.endpoint.host);
  }
  private disconnected(detail: string): void {
    this.observe('mt5-agent-client-disconnected', detail);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.repository.setConnection(
      this.connectedOnce ? 'RECONNECTING' : 'DISCONNECTED',
      detail,
      { truth: 'UNKNOWN', terminalConnected: false },
    );
    if (!this.stopped && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 750);
      this.reconnectTimer.unref();
    }
  }
  private send(
    kind: 'HELLO' | 'SNAPSHOT_REQUEST' | 'HEARTBEAT',
    payload: Extract<
      Mt5DesktopEnvelope['payload'],
      { kind: 'HELLO' | 'SNAPSHOT_REQUEST' | 'HEARTBEAT' }
    >,
  ): void {
    if (!this.socket?.writable) return;
    const message: Mt5DesktopEnvelope = {
      messageId: randomUUID(),
      correlationId: null,
      schemaVersion: MT5_PROTOCOL_VERSION,
      sentAt: new Date().toISOString(),
      payload,
    };
    this.repository.enqueue(message.messageId, kind, message);
    this.socket.write(`${JSON.stringify(message)}\n`);
    this.repository.markOutbox(
      message.messageId,
      'SENT',
      'Sent to local read-only Agent',
    );
  }
  private receive(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const envelope = mt5AgentEnvelopeSchema.parse(JSON.parse(line));
        if (envelope.payload.kind === 'HELLO_ACK') {
          this.observe('mt5-agent-handshake', `${envelope.payload.transportMode} protocol=${envelope.payload.protocolVersion}`);
          if (
            envelope.payload.protocolVersion < MT5_PROTOCOL_VERSION ||
            envelope.payload.minimumCompatibleVersion > MT5_PROTOCOL_VERSION
          ) {
            this.repository.ingest(envelope);
            this.repository.setConnection(
              'BLOCKED',
              'MT5 Agent protocol is incompatible.',
              {
                truth: 'UNKNOWN',
                transportMode: envelope.payload.transportMode,
                sessionId: envelope.payload.sessionId,
                terminalConnected: false,
              },
            );
            this.socket?.destroy();
            continue;
          }
          this.reconciliationTrigger = this.connectedOnce
            ? 'RECONNECT'
            : 'STARTUP';
          this.connectedOnce = true;
          this.repository.ingest(envelope);
          this.repository.setConnection(
            'RECONCILING',
            'Agent connected; establishing broker truth.',
            {
              truth: 'UNKNOWN',
              transportMode: envelope.payload.transportMode,
              sessionId: envelope.payload.sessionId,
              terminalConnected: envelope.payload.terminalConnected,
              lastMessageAt: envelope.sentAt,
            },
          );
          this.send('SNAPSHOT_REQUEST', {
            kind: 'SNAPSHOT_REQUEST',
            trigger: this.reconciliationTrigger,
          });
          continue;
        }
        if ('commandId' in envelope.payload) {
          const timer = this.commandTimers.get(envelope.payload.commandId);
          if (timer) {
            clearTimeout(timer);
            this.commandTimers.delete(envelope.payload.commandId);
          }
        }
        const result = this.repository.ingest(
          envelope,
          envelope.payload.kind === 'BROKER_SNAPSHOT'
            ? this.reconciliationTrigger
            : 'RECONNECT',
        );
        if (!result.duplicate)
          this.executionRepository?.recordAgentMessage(envelope);
        if (!result.duplicate)
          this.protectionRepository?.recordAgentMessage(envelope);
        if (!result.duplicate && envelope.payload.kind === 'MANAGEMENT_ACK')
          this.retryPendingManagement();
        if (
          envelope.payload.kind === 'BROKER_SNAPSHOT' &&
          result.workspace.connection.state === 'CONNECTED'
        )
          this.retryPendingExecution();
        if (
          envelope.payload.kind === 'BROKER_SNAPSHOT' &&
          result.workspace.connection.state === 'CONNECTED'
        )
          this.retryPendingManagement();
        if (
          envelope.payload.kind === 'HEARTBEAT_ACK' &&
          !envelope.payload.terminalConnected
        )
          this.repository.setConnection(
            'BLOCKED',
            'Agent heartbeat reports the MT5 terminal unavailable; broker truth is UNKNOWN.',
            {
              truth: 'UNKNOWN',
              terminalConnected: false,
              lastMessageAt: envelope.sentAt,
            },
          );
      } catch (error) {
        this.repository.setConnection(
          'BLOCKED',
          `Invalid Agent message: ${error instanceof Error ? error.message : String(error)}`,
          { truth: 'UNKNOWN' },
        );
      }
    }
  }
}

export function mt5EndpointFromEnvironment(): { host: string; port: number } {
  const raw = process.env.ARISE_MT5_ENDPOINT ?? '127.0.0.1:19781';
  const [host, portText] = raw.split(':');
  const port = Number(portText);
  return {
    host: host || '127.0.0.1',
    port: Number.isInteger(port) && port > 0 ? port : 19781,
  };
}
