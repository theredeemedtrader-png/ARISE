import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import {
  MT5_PROTOCOL_VERSION,
  mt5DesktopEnvelopeSchema,
  mt5SnapshotSchema,
  type Mt5AgentEnvelope,
  type Mt5ExecutionCommand,
  type Mt5ManagementCommand,
  type Mt5Snapshot,
} from '@arise/shared';

type AgentPayload = Mt5AgentEnvelope['payload'];
export type FakeBrokerScenario =
  | 'NORMAL'
  | 'REJECTION'
  | 'TIMEOUT'
  | 'PARTIAL_FILL'
  | 'DISCONNECT'
  | 'DISCONNECT_AFTER_ACK'
  | 'DISCONNECT_AFTER_FILL'
  | 'STALE_ACK'
  | 'PROTECTION_FAILURE'
  | 'OUT_OF_ORDER_FILL'
  | 'OVER_PROTECTION'
  | 'WORSENING_PROTECTION';
export type FakeManagementScenario =
  | 'NORMAL'
  | 'REJECTION'
  | 'TIMEOUT'
  | 'DISCONNECT'
  | 'STALE_ACK'
  | 'WORSENING_PROTECTION';
export interface BrokerMutationConnector {
  hasApplied(idempotencyKey: string): boolean;
  execute(command: Mt5ExecutionCommand): {
    readonly payloads: readonly AgentPayload[];
    readonly disconnectAfter: number | null;
  };
  executeManagement(command: Mt5ManagementCommand): {
    readonly payloads: readonly AgentPayload[];
    readonly disconnectAfter: number | null;
  };
}
export class FakeExecutionBroker implements BrokerMutationConnector {
  private readonly applied = new Map<
    string,
    { readonly fingerprint: string; readonly payloads: readonly AgentPayload[] }
  >();
  private readonly flattenEffects = new Set<string>();
  private readonly managementApplied = new Map<
    string,
    { readonly fingerprint: string; readonly payload: Extract<AgentPayload, { kind: 'MANAGEMENT_ACK' }> }
  >();
  private readonly managedPositions = new Map<
    string,
    { volume: number; stop: number | null; takeProfit: number | null; sequence: number }
  >();
  constructor(public scenario: FakeBrokerScenario = 'NORMAL') {}
  managementScenario: FakeManagementScenario = 'NORMAL';
  managementEffectCount = 0;
  exposureCount = 0;
  exposureVolume = 0;
  protectedVolume = 0;
  get flattenEffectCount(): number {
    return this.flattenEffects.size;
  }
  hasApplied(idempotencyKey: string): boolean {
    return this.applied.has(idempotencyKey) || this.managementApplied.has(idempotencyKey);
  }
  seedPosition(
    key: string,
    input: { readonly volume: number; readonly stop: number | null; readonly takeProfit?: number | null },
  ): void {
    this.managedPositions.set(key, {
      volume: input.volume,
      stop: input.stop,
      takeProfit: input.takeProfit ?? null,
      sequence: 0,
    });
  }
  managedPosition(key: string): Readonly<{
    volume: number;
    stop: number | null;
    takeProfit: number | null;
    sequence: number;
  }> | null {
    const value = this.managedPositions.get(key);
    return value ? Object.freeze({ ...value }) : null;
  }
  executeManagement(command: Mt5ManagementCommand): {
    readonly payloads: readonly AgentPayload[];
    readonly disconnectAfter: number | null;
  } {
    const fingerprint = JSON.stringify({
      protectionRequestId: command.protectionRequestId,
      commandType: command.commandType,
      accountKey: command.accountKey,
      brokerPositionKey: command.brokerPositionKey,
      expectedBrokerVolume: command.expectedBrokerVolume,
      requestedStop: command.requestedStop,
      requestedTakeProfit: command.requestedTakeProfit,
      requestedCloseVolume: command.requestedCloseVolume,
      sequence: command.sequence,
    });
    const prior = this.managementApplied.get(command.idempotencyKey);
    if (prior && prior.fingerprint !== fingerprint)
      return {
        payloads: Object.freeze([
          this.managementAck(command, 'REJECTED', 'Idempotency identity reused with conflicting management payload'),
        ]),
        disconnectAfter: null,
      };
    if (prior)
      return {
        payloads: Object.freeze([
          {
            ...prior.payload,
            eventId: randomUUID(),
            commandId: command.commandId,
            status: 'ALREADY_APPLIED',
            occurredAt: new Date().toISOString(),
          },
        ]),
        disconnectAfter: null,
      };
    if (this.managementScenario === 'REJECTION')
      return {
        payloads: Object.freeze([this.managementAck(command, 'REJECTED', 'Fake management rejection')]),
        disconnectAfter: null,
      };
    const position = this.managedPositions.get(command.brokerPositionKey);
    if (!position)
      return {
        payloads: Object.freeze([this.managementAck(command, 'REJECTED', 'Broker position does not exist')]),
        disconnectAfter: null,
      };
    let closedVolume = 0;
    if (command.commandType === 'MOVE_STOP') position.stop = command.requestedStop;
    else if (command.commandType === 'SET_TP') position.takeProfit = command.requestedTakeProfit;
    else if (command.commandType === 'REMOVE_TP') position.takeProfit = null;
    else {
      closedVolume = Math.min(command.requestedCloseVolume ?? 0, position.volume);
      position.volume = Math.max(0, position.volume - closedVolume);
    }
    position.sequence = Math.max(position.sequence, command.sequence);
    this.managementEffectCount += 1;
    const payload = this.managementAck(command, 'VERIFIED', null, {
      actualVolume: position.volume,
      actualStop:
        this.managementScenario === 'WORSENING_PROTECTION'
          ? command.direction === 'LONG'
            ? (position.stop ?? 0) - 0.001
            : (position.stop ?? 0) + 0.001
          : position.stop,
      actualTakeProfit: position.takeProfit,
      closedVolume,
      sequence:
        this.managementScenario === 'STALE_ACK'
          ? Math.max(1, command.sequence - 1)
          : command.sequence,
    });
    this.managementApplied.set(command.idempotencyKey, { fingerprint, payload });
    if (this.managementScenario === 'TIMEOUT')
      return { payloads: Object.freeze([]), disconnectAfter: null };
    return {
      payloads: Object.freeze([payload]),
      disconnectAfter: this.managementScenario === 'DISCONNECT' ? 0 : null,
    };
  }
  private managementAck(
    command: Mt5ManagementCommand,
    status: 'VERIFIED' | 'REJECTED',
    reason: string | null,
    reality?: {
      actualVolume: number;
      actualStop: number | null;
      actualTakeProfit: number | null;
      closedVolume: number;
      sequence: number;
    },
  ): Extract<AgentPayload, { kind: 'MANAGEMENT_ACK' }> {
    const position = this.managedPositions.get(command.brokerPositionKey);
    return {
      kind: 'MANAGEMENT_ACK',
      eventId: randomUUID(),
      commandId: command.commandId,
      protectionRequestId: command.protectionRequestId,
      idempotencyKey: command.idempotencyKey,
      brokerEffectId: `management-effect:${command.idempotencyKey}`,
      brokerPositionKey: command.brokerPositionKey,
      sequence: reality?.sequence ?? command.sequence,
      status,
      actualVolume: reality?.actualVolume ?? position?.volume ?? command.expectedBrokerVolume,
      actualStop: reality?.actualStop ?? position?.stop ?? null,
      actualTakeProfit: reality?.actualTakeProfit ?? position?.takeProfit ?? null,
      closedVolume: reality?.closedVolume ?? 0,
      reason,
      occurredAt: new Date().toISOString(),
    };
  }
  execute(command: Mt5ExecutionCommand): {
    readonly payloads: readonly AgentPayload[];
    readonly disconnectAfter: number | null;
  } {
    const fingerprint = JSON.stringify({
      orderPlanId: command.orderPlanId,
      commandType: command.commandType,
      accountKey: command.accountKey,
      brokerSymbol: command.brokerSymbol,
      direction: command.direction,
      volume: command.volume,
      initialStop: command.initialStop,
      brokerPositionKey: command.brokerPositionKey,
    });
    const prior = this.applied.get(command.idempotencyKey);
    if (prior && prior.fingerprint !== fingerprint)
      return {
        payloads: Object.freeze([
          {
            kind: 'COMMAND_ACK',
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            status: 'REJECTED',
            brokerOrderKey: null,
            reason:
              'Idempotency identity was reused with a conflicting payload',
          },
        ]),
        disconnectAfter: null,
      };
    if (prior)
      return {
        payloads: Object.freeze([
          {
            kind: 'COMMAND_ACK',
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            status: 'ALREADY_APPLIED',
            brokerOrderKey: `order-${command.orderPlanId}`,
            reason: 'Idempotency key already applied',
          },
          ...prior.payloads.filter((item) => item.kind !== 'COMMAND_ACK'),
        ]),
        disconnectAfter: null,
      };
    const at = new Date().toISOString(),
      orderKey = `order-${command.orderPlanId}`,
      positionKey = `position-${command.orderPlanId}`;
    if (this.scenario === 'REJECTION')
      return {
        payloads: Object.freeze([
          {
            kind: 'COMMAND_ACK',
            commandId: command.commandId,
            idempotencyKey: command.idempotencyKey,
            status: 'REJECTED',
            brokerOrderKey: null,
            reason: 'Fake broker rejection',
          },
        ]),
        disconnectAfter: null,
      };
    const ack: AgentPayload = {
      kind: 'COMMAND_ACK',
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      status: 'ACCEPTED',
      brokerOrderKey: orderKey,
      reason: null,
    };
    const volume = command.volume ?? 0.1,
      price = 1.1002,
      stop = command.initialStop ?? 1.09;
    const fill = (
      part: number,
      cumulative: number,
      remaining: number,
    ): AgentPayload => ({
      kind: 'FILL',
      eventId: randomUUID(),
      commandId: command.commandId,
      orderPlanId: command.orderPlanId,
      brokerOrderKey: orderKey,
      brokerPositionKey: positionKey,
      volume: part,
      price,
      cumulativeVolume: cumulative,
      remainingVolume: remaining,
      filledAt: at,
    });
    const protect = (
      attempt: number,
      status: 'VERIFIED' | 'REJECTED',
      quantity: number,
      actualStop: number | null = status === 'VERIFIED' ? stop : null,
    ): AgentPayload => ({
      kind: 'PROTECTION_ATTEMPT',
      eventId: randomUUID(),
      commandId: command.commandId,
      orderPlanId: command.orderPlanId,
      brokerPositionKey: positionKey,
      brokerCommandId: `protect-${command.orderPlanId}-${quantity}-${attempt}`,
      idempotencyKey: `order-plan:${command.orderPlanId}:protect:${positionKey}:${quantity}`,
      attempt,
      protectedVolume: quantity,
      requestedStop: stop,
      actualStop,
      status,
      reason: status === 'VERIFIED' ? null : 'Fake protection rejection',
      occurredAt: at,
    });
    let payloads: AgentPayload[];
    if (this.scenario === 'PARTIAL_FILL')
      payloads = [
        ack,
        fill(volume / 2, volume / 2, volume / 2),
        protect(1, 'VERIFIED', volume / 2),
        fill(volume / 2, volume, 0),
        protect(1, 'VERIFIED', volume),
      ];
    else if (this.scenario === 'PROTECTION_FAILURE') {
      const flattenKey = `order-plan:${command.orderPlanId}:flatten:${positionKey}`;
      this.flattenEffects.add(flattenKey);
      payloads = [
        ack,
        fill(volume, volume, 0),
        protect(1, 'REJECTED', volume),
        protect(2, 'REJECTED', volume),
        {
          kind: 'FLATTEN_RESULT',
          eventId: randomUUID(),
          commandId: command.commandId,
          orderPlanId: command.orderPlanId,
          brokerPositionKey: positionKey,
          brokerCommandId: `flatten-${command.orderPlanId}`,
          idempotencyKey: flattenKey,
          targetVolume: volume,
          status: 'VERIFIED',
          closedVolume: volume,
          reason: 'Bounded protection retry exhausted',
          occurredAt: at,
        },
      ];
    } else if (this.scenario === 'STALE_ACK')
      payloads = [
        { ...ack, commandId: `stale-${command.commandId}` },
        ack,
        fill(volume, volume, 0),
        protect(1, 'VERIFIED', volume),
      ];
    else if (this.scenario === 'OUT_OF_ORDER_FILL')
      payloads = [
        ack,
        fill(volume, volume, 0),
        fill(volume / 2, volume / 2, volume / 2),
        protect(1, 'VERIFIED', volume),
      ];
    else if (this.scenario === 'OVER_PROTECTION')
      payloads = [
        ack,
        fill(volume / 2, volume / 2, volume / 2),
        protect(1, 'VERIFIED', volume),
      ];
    else if (this.scenario === 'WORSENING_PROTECTION')
      payloads = [
        ack,
        fill(volume / 2, volume / 2, volume / 2),
        protect(1, 'VERIFIED', volume / 2),
        fill(volume / 2, volume, 0),
        protect(
          1,
          'VERIFIED',
          volume,
          command.direction === 'LONG' ? stop - 0.001 : stop + 0.001,
        ),
      ];
    else
      payloads = [ack, fill(volume, volume, 0), protect(1, 'VERIFIED', volume)];
    this.exposureCount = this.scenario === 'PROTECTION_FAILURE' ? 0 : 1;
    this.exposureVolume = this.scenario === 'PROTECTION_FAILURE' ? 0 : volume;
    this.protectedVolume =
      this.scenario === 'PROTECTION_FAILURE'
        ? 0
        : this.scenario === 'OVER_PROTECTION'
          ? volume
          : this.scenario === 'PARTIAL_FILL' ||
              this.scenario === 'NORMAL' ||
              this.scenario === 'WORSENING_PROTECTION' ||
              this.scenario === 'OUT_OF_ORDER_FILL'
            ? volume
            : 0;
    if (this.exposureVolume > 0)
      this.seedPosition(positionKey, {
        volume: this.exposureVolume,
        stop: this.protectedVolume > 0 ? stop : null,
      });
    this.applied.set(command.idempotencyKey, {
      fingerprint,
      payloads: Object.freeze(payloads),
    });
    if (this.scenario === 'TIMEOUT')
      return { payloads: Object.freeze([]), disconnectAfter: null };
    if (this.scenario === 'DISCONNECT')
      return { payloads: Object.freeze(payloads), disconnectAfter: 0 };
    if (this.scenario === 'DISCONNECT_AFTER_ACK')
      return { payloads: Object.freeze(payloads), disconnectAfter: 1 };
    if (this.scenario === 'DISCONNECT_AFTER_FILL')
      return { payloads: Object.freeze(payloads), disconnectAfter: 2 };
    return { payloads: Object.freeze(payloads), disconnectAfter: null };
  }
}

export interface AgentServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly mode: 'FAKE_HARNESS' | 'MT5_READ_ONLY' | 'MT5_DEMO';
  readonly snapshot: () => Mt5Snapshot;
  readonly terminalConnected: () => boolean;
  readonly fakeBroker?: FakeExecutionBroker;
  readonly demoBroker?: BrokerMutationConnector;
}
export class ReadOnlyMt5AgentServer {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  private sessions = new Map<Socket, string>();
  private boundPort: number | null = null;
  constructor(private readonly options: AgentServerOptions) {}
  async start(): Promise<{ host: string; port: number }> {
    if (this.server) throw new Error('Agent already started');
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(
        this.options.port ?? this.boundPort ?? 0,
        this.options.host ?? '127.0.0.1',
        () => resolve(),
      );
    });
    const address = this.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Agent address unavailable');
    this.boundPort = address.port;
    return { host: address.address, port: address.port };
  }
  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      server.close(finish);
      for (const socket of this.sockets) socket.destroy();
      this.sockets.clear();
      this.sessions.clear();
      setTimeout(finish, 1000).unref();
    });
  }
  broadcastSnapshot(messageId = randomUUID()): void {
    for (const socket of this.sockets)
      this.send(socket, {
        messageId,
        correlationId: null,
        schemaVersion: MT5_PROTOCOL_VERSION as 3,
        sentAt: new Date().toISOString(),
        payload: { kind: 'BROKER_SNAPSHOT', snapshot: this.options.snapshot() },
      });
  }
  private accept(socket: Socket): void {
    this.sockets.add(socket);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('close', () => {
      this.sockets.delete(socket);
      this.sessions.delete(socket);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.trim()) this.receive(socket, line);
      }
    });
  }
  private receive(socket: Socket, line: string): void {
    try {
      const message = mt5DesktopEnvelopeSchema.parse(JSON.parse(line));
      const common = {
        messageId: randomUUID(),
        correlationId: message.messageId,
        schemaVersion: MT5_PROTOCOL_VERSION as 3,
        sentAt: new Date().toISOString(),
      };
      if (message.payload.kind === 'HELLO') {
        const sessionId = randomUUID();
        this.sessions.set(socket, sessionId);
        this.send(socket, {
          ...common,
          payload: {
            kind: 'HELLO_ACK',
            agentVersion: '0.0.1',
            protocolVersion: MT5_PROTOCOL_VERSION,
            minimumCompatibleVersion: MT5_PROTOCOL_VERSION,
            sessionId,
            transportMode: this.options.mode,
            terminalConnected: this.options.terminalConnected(),
          },
        });
      } else if (message.payload.kind === 'SNAPSHOT_REQUEST')
        this.send(socket, {
          ...common,
          payload: {
            kind: 'BROKER_SNAPSHOT',
            snapshot: this.options.snapshot(),
          },
        });
      else if (message.payload.kind === 'HEARTBEAT')
        this.send(socket, {
          ...common,
          payload: {
            kind: 'HEARTBEAT_ACK',
            terminalConnected: this.options.terminalConnected(),
          },
        });
      else if (message.payload.kind === 'EXECUTION_COMMAND')
        this.execute(socket, message.messageId, message.payload.command);
      else this.manage(socket, message.messageId, message.payload.command);
    } catch (error) {
      this.send(socket, {
        messageId: randomUUID(),
        correlationId: null,
        schemaVersion: MT5_PROTOCOL_VERSION as 3,
        sentAt: new Date().toISOString(),
        payload: {
          kind: 'ERROR',
          code: 'INVALID_AGENT_MESSAGE',
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
      });
    }
  }

  private reject(
    socket: Socket,
    correlationId: string,
    command: Mt5ExecutionCommand,
    reason: string,
  ): void {
    this.sendPayload(socket, correlationId, {
      kind: 'COMMAND_ACK',
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      status: 'REJECTED',
      brokerOrderKey: null,
      reason,
    });
  }
  private execute(
    socket: Socket,
    correlationId: string,
    command: Mt5ExecutionCommand,
  ): void {
    const broker =
      this.options.mode === 'FAKE_HARNESS'
        ? this.options.fakeBroker
        : this.options.mode === 'MT5_DEMO'
          ? this.options.demoBroker
          : undefined;
    const replay =
      broker?.hasApplied(command.idempotencyKey) ?? false;
    if (replay) {
      const result = broker!.execute(command);
      for (const payload of result.payloads)
        this.sendPayload(socket, correlationId, payload);
      return;
    }
    const session = this.sessions.get(socket);
    if (!session || command.expectedSessionId !== session) {
      this.reject(
        socket,
        correlationId,
        command,
        'Stale or missing Agent session identity',
      );
      return;
    }
    if (!broker) {
      this.reject(
        socket,
        correlationId,
        command,
        'MT5 transport is read-only; no demo mutation connector is configured',
      );
      return;
    }
    if (
      command.commandType !== 'CREATE_ORDER' ||
      command.brokerPositionKey !== null ||
      command.direction === null ||
      command.volume === null ||
      command.initialStop === null
    ) {
      this.reject(
        socket,
        correlationId,
        command,
        'M10 transport accepts only complete CREATE_ORDER commands; external positions cannot be targeted',
      );
      return;
    }
    if (Date.parse(command.expiresAt) <= Date.now()) {
      this.reject(
        socket,
        correlationId,
        command,
        'Immutable OrderPlan expired before broker mutation',
      );
      return;
    }
    const snapshot = this.options.snapshot(),
      account = snapshot.account,
      symbol = snapshot.symbols.find(
        (item) => item.brokerSymbol === command.brokerSymbol,
      ),
      quote = snapshot.quotes.find(
        (item) => item.brokerSymbol === command.brokerSymbol,
      );
    const fresh = quote && Date.now() - Date.parse(quote.receivedAt) <= 5000;
    const spread =
      symbol && quote
        ? (quote.ask - quote.bid) / symbol.pipSize
        : Number.POSITIVE_INFINITY;
    if (
      !this.options.terminalConnected() ||
      !snapshot.complete ||
      !account ||
      account.isLive ||
      account.accountKey !== command.accountKey ||
      !symbol ||
      !fresh ||
      spread > command.maxSpreadPips
    ) {
      this.reject(
        socket,
        correlationId,
        command,
        'Agent blocked mutation: demo account, terminal, symbol, quote, spread, or broker truth is incompatible',
      );
      return;
    }
    const result = broker.execute(command);
    for (const [index, payload] of result.payloads.entries()) {
      if (result.disconnectAfter === index) {
        socket.destroy();
        return;
      }
      this.sendPayload(socket, correlationId, payload);
    }
    if (result.disconnectAfter === result.payloads.length) socket.destroy();
  }
  private rejectManagement(
    socket: Socket,
    correlationId: string,
    command: Mt5ManagementCommand,
    reason: string,
  ): void {
    this.sendPayload(socket, correlationId, {
      kind: 'MANAGEMENT_ACK',
      eventId: randomUUID(),
      commandId: command.commandId,
      protectionRequestId: command.protectionRequestId,
      idempotencyKey: command.idempotencyKey,
      brokerEffectId: `rejected:${command.idempotencyKey}`,
      brokerPositionKey: command.brokerPositionKey,
      sequence: command.sequence,
      status: 'REJECTED',
      actualVolume: command.expectedBrokerVolume,
      actualStop: null,
      actualTakeProfit: null,
      closedVolume: 0,
      reason,
      occurredAt: new Date().toISOString(),
    });
  }
  private manage(
    socket: Socket,
    correlationId: string,
    command: Mt5ManagementCommand,
  ): void {
    const broker =
      this.options.mode === 'FAKE_HARNESS'
        ? this.options.fakeBroker
        : this.options.mode === 'MT5_DEMO'
          ? this.options.demoBroker
          : undefined;
    if (broker?.hasApplied(command.idempotencyKey)) {
      const replay = broker.executeManagement(command);
      for (const payload of replay.payloads)
        this.sendPayload(socket, correlationId, payload);
      return;
    }
    const session = this.sessions.get(socket);
    if (!session || command.expectedSessionId !== session) {
      this.rejectManagement(socket, correlationId, command, 'Stale or missing Agent session identity');
      return;
    }
    if (!broker) {
      this.rejectManagement(socket, correlationId, command, 'MT5 transport is read-only; no demo mutation connector is configured');
      return;
    }
    if (Date.parse(command.expiresAt) <= Date.now()) {
      this.rejectManagement(socket, correlationId, command, 'Management command expired before broker mutation');
      return;
    }
    const snapshot = this.options.snapshot();
    const account = snapshot.account;
    const symbol = snapshot.symbols.find((item) => item.brokerSymbol === command.brokerSymbol);
    const quote = snapshot.quotes.find((item) => item.brokerSymbol === command.brokerSymbol);
    const brokerPosition = snapshot.positions.find((item) => item.brokerPositionKey === command.brokerPositionKey);
    const fresh = quote && Date.now() - Date.parse(quote.receivedAt) <= 5000;
    if (
      !this.options.terminalConnected() ||
      !snapshot.complete ||
      !account ||
      account.isLive ||
      account.accountKey !== command.accountKey ||
      !symbol ||
      !quote ||
      !fresh ||
      !brokerPosition ||
      brokerPosition.magic === 0 ||
      !brokerPosition.comment.includes('ARISE') ||
      Math.abs(brokerPosition.volume - command.expectedBrokerVolume) > 1e-8
    ) {
      this.rejectManagement(socket, correlationId, command, 'Agent blocked management: demo account, session, quote, broker quantity, ownership, or truth is incompatible');
      return;
    }
    if (command.commandType === 'MOVE_STOP') {
      const requested = command.requestedStop!;
      const worsening =
        brokerPosition.stopLoss !== null &&
        (command.direction === 'LONG'
          ? requested < brokerPosition.stopLoss
          : requested > brokerPosition.stopLoss);
      const executable = command.direction === 'LONG' ? quote.bid : quote.ask;
      const validSide = command.direction === 'LONG' ? requested < executable : requested > executable;
      const minimum = Math.max(symbol.stopsLevel, symbol.freezeLevel) * symbol.tickSize;
      if (worsening || !validSide || Math.abs(executable - requested) < minimum) {
        this.rejectManagement(socket, correlationId, command, 'Agent blocked invalid or worsening stop modification');
        return;
      }
    }
    if (command.commandType === 'PARTIAL_CLOSE') {
      const close = command.requestedCloseVolume!;
      const remaining = brokerPosition.volume - close;
      const aligned = Math.abs(close / symbol.volumeStep - Math.round(close / symbol.volumeStep)) <= 1e-8;
      if (close < symbol.minVolume || close >= brokerPosition.volume || !aligned || (remaining > 1e-8 && remaining < symbol.minVolume)) {
        this.rejectManagement(socket, correlationId, command, 'Agent blocked invalid broker partial-close quantity');
        return;
      }
    }
    const result = broker.executeManagement(command);
    for (const [index, payload] of result.payloads.entries()) {
      if (result.disconnectAfter === index) {
        socket.destroy();
        return;
      }
      this.sendPayload(socket, correlationId, payload);
    }
  }
  private sendPayload(
    socket: Socket,
    correlationId: string,
    payload: AgentPayload,
  ): void {
    this.send(socket, {
      messageId: randomUUID(),
      correlationId,
      schemaVersion: MT5_PROTOCOL_VERSION as 3,
      sentAt: new Date().toISOString(),
      payload,
    });
  }
  private send(socket: Socket, message: Mt5AgentEnvelope): void {
    socket.write(`${JSON.stringify(message)}\n`);
  }
}

export function unavailableSnapshot(
  reason = 'MT5 terminal connection unavailable',
): Mt5Snapshot {
  return mt5SnapshotSchema.parse({
    snapshotId: randomUUID(),
    complete: false,
    capturedAt: new Date().toISOString(),
    account: null,
    symbols: [],
    positions: [],
    pendingOrders: [],
    quotes: [],
    candles: [],
    unavailableReason: reason,
  });
}
