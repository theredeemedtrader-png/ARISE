import { z } from 'zod';

export const MT5_PROTOCOL_VERSION = 3;
export const mt5TransportModeSchema = z.enum([
  'FAKE_HARNESS',
  'MT5_READ_ONLY',
  'MT5_DEMO',
]);
export const mt5ConnectionStateSchema = z.enum([
  'CONNECTED',
  'DEGRADED',
  'DISCONNECTED',
  'RECONNECTING',
  'RECONCILING',
  'BLOCKED',
]);
export const mt5TruthStateSchema = z.enum(['VERIFIED', 'UNKNOWN']);

export const mt5AccountSchema = z.object({
  accountKey: z.string().min(1),
  broker: z.string().min(1),
  server: z.string().min(1),
  login: z.string().min(1),
  currency: z.string().min(1),
  balance: z.number().finite(),
  equity: z.number().finite(),
  margin: z.number().nonnegative(),
  freeMargin: z.number().finite(),
  leverage: z.number().positive(),
  isLive: z.boolean(),
  hedging: z.boolean(),
  capturedAt: z.string().min(1),
});
export const mt5SymbolSchema = z.object({
  brokerSymbol: z.string().min(1),
  canonicalSymbol: z.string().min(1),
  digits: z.number().int().nonnegative(),
  tickSize: z.number().positive(),
  pipSize: z.number().positive(),
  contractSize: z.number().positive(),
  minVolume: z.number().positive(),
  volumeStep: z.number().positive(),
  maxVolume: z.number().positive(),
  stopsLevel: z.number().nonnegative(),
  freezeLevel: z.number().nonnegative(),
});
export const mt5QuoteSchema = z
  .object({
    brokerSymbol: z.string().min(1),
    bid: z.number().finite(),
    ask: z.number().finite(),
    brokerTime: z.string().min(1),
    receivedAt: z.string().min(1),
    sequence: z.number().int().nonnegative(),
  })
  .refine((v) => v.ask >= v.bid, 'ask must be >= bid');
export const mt5CandleSchema = z.object({
  brokerSymbol: z.string().min(1),
  timeframe: z.string().min(1),
  openTime: z.string().min(1),
  closeTime: z.string().nullable(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  tickVolume: z.number().nonnegative(),
  origin: z.enum(['LIVE', 'RECOVERED']),
});
export const mt5PositionSchema = z.object({
  brokerPositionKey: z.string().min(1),
  brokerSymbol: z.string().min(1),
  direction: z.enum(['LONG', 'SHORT']),
  volume: z.number().positive(),
  openPrice: z.number().finite(),
  currentPrice: z.number().finite(),
  stopLoss: z.number().finite().nullable(),
  takeProfit: z.number().finite().nullable(),
  openedAt: z.string().min(1),
  magic: z.number().int(),
  comment: z.string(),
});
export const mt5PendingOrderSchema = z.object({
  brokerOrderKey: z.string().min(1),
  brokerSymbol: z.string().min(1),
  orderType: z.string().min(1),
  direction: z.enum(['LONG', 'SHORT']),
  volume: z.number().positive(),
  price: z.number().finite(),
  stopLoss: z.number().finite().nullable(),
  takeProfit: z.number().finite().nullable(),
  placedAt: z.string().min(1),
  magic: z.number().int(),
  comment: z.string(),
});
export const mt5SnapshotSchema = z
  .object({
    snapshotId: z.string().min(1),
    complete: z.boolean(),
    capturedAt: z.string().min(1),
    account: mt5AccountSchema.nullable(),
    symbols: z.array(mt5SymbolSchema),
    positions: z.array(mt5PositionSchema),
    pendingOrders: z.array(mt5PendingOrderSchema),
    quotes: z.array(mt5QuoteSchema),
    candles: z.array(mt5CandleSchema),
    unavailableReason: z.string().nullable(),
  })
  .refine(
    (v) => (v.complete ? v.account !== null : v.unavailableReason !== null),
    'complete snapshots require an account; incomplete snapshots require a reason',
  );

const helloSchema = z.object({
  kind: z.literal('HELLO'),
  appVersion: z.string(),
  protocolVersion: z.number().int(),
  minimumCompatibleVersion: z.number().int(),
});
const snapshotRequestSchema = z.object({
  kind: z.literal('SNAPSHOT_REQUEST'),
  trigger: z.enum(['STARTUP', 'RECONNECT', 'MANUAL']),
});
const heartbeatSchema = z.object({ kind: z.literal('HEARTBEAT') });
export const mt5ExecutionCommandSchema = z.object({
  commandId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  orderPlanId: z.string().min(1),
  commandType: z.enum(['CREATE_ORDER', 'SET_INITIAL_STOP', 'SAFETY_FLATTEN']),
  accountKey: z.string().min(1),
  brokerSymbol: z.string().min(1),
  direction: z.enum(['LONG', 'SHORT']).nullable(),
  volume: z.number().positive().nullable(),
  initialStop: z.number().finite().nullable(),
  brokerPositionKey: z.string().min(1).nullable(),
  expectedSessionId: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  maxSpreadPips: z.number().nonnegative(),
});
export const mt5ManagementCommandSchema = z
  .object({
    commandId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    protectionRequestId: z.string().min(1),
    ruleVersionId: z.string().min(1),
    triggerEventId: z.string().min(1),
    commandType: z.enum([
      'MOVE_STOP',
      'SET_TP',
      'REMOVE_TP',
      'PARTIAL_CLOSE',
      'FULL_CLOSE',
    ]),
    accountKey: z.string().min(1),
    brokerSymbol: z.string().min(1),
    brokerPositionKey: z.string().min(1),
    direction: z.enum(['LONG', 'SHORT']),
    expectedBrokerVolume: z.number().positive(),
    requestedStop: z.number().finite().nullable(),
    requestedTakeProfit: z.number().finite().nullable(),
    requestedCloseVolume: z.number().positive().nullable(),
    expectedSessionId: z.string().min(1),
    sequence: z.number().int().positive(),
    createdAt: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.commandType === 'MOVE_STOP' && value.requestedStop === null)
      context.addIssue({ code: 'custom', message: 'MOVE_STOP requires requestedStop' });
    if (value.commandType === 'SET_TP' && value.requestedTakeProfit === null)
      context.addIssue({ code: 'custom', message: 'SET_TP requires requestedTakeProfit' });
    if (
      (value.commandType === 'PARTIAL_CLOSE' || value.commandType === 'FULL_CLOSE') &&
      value.requestedCloseVolume === null
    )
      context.addIssue({ code: 'custom', message: 'Close commands require requestedCloseVolume' });
  });
const executionCommandSchema = z.object({
  kind: z.literal('EXECUTION_COMMAND'),
  command: mt5ExecutionCommandSchema,
});
const managementCommandSchema = z.object({
  kind: z.literal('MANAGEMENT_COMMAND'),
  command: mt5ManagementCommandSchema,
});
const helloAckSchema = z.object({
  kind: z.literal('HELLO_ACK'),
  agentVersion: z.string(),
  protocolVersion: z.number().int(),
  minimumCompatibleVersion: z.number().int(),
  sessionId: z.string().min(1),
  transportMode: mt5TransportModeSchema,
  terminalConnected: z.boolean(),
});
const snapshotMessageSchema = z.object({
  kind: z.literal('BROKER_SNAPSHOT'),
  snapshot: mt5SnapshotSchema,
});
const quoteMessageSchema = z.object({
  kind: z.literal('QUOTE'),
  quote: mt5QuoteSchema,
});
const candleMessageSchema = z.object({
  kind: z.literal('CANDLE'),
  candle: mt5CandleSchema,
});
const heartbeatAckSchema = z.object({
  kind: z.literal('HEARTBEAT_ACK'),
  terminalConnected: z.boolean(),
});
const commandAckSchema = z.object({
  kind: z.literal('COMMAND_ACK'),
  commandId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: z.enum(['ACCEPTED', 'REJECTED', 'ALREADY_APPLIED']),
  brokerOrderKey: z.string().min(1).nullable(),
  reason: z.string().nullable(),
});
const fillSchema = z.object({
  kind: z.literal('FILL'),
  eventId: z.string().min(1),
  commandId: z.string().min(1),
  orderPlanId: z.string().min(1),
  brokerOrderKey: z.string().min(1),
  brokerPositionKey: z.string().min(1),
  volume: z.number().positive(),
  price: z.number().finite(),
  cumulativeVolume: z.number().positive(),
  remainingVolume: z.number().nonnegative(),
  filledAt: z.string().min(1),
});
const protectionAttemptSchema = z.object({
  kind: z.literal('PROTECTION_ATTEMPT'),
  eventId: z.string().min(1),
  commandId: z.string().min(1),
  orderPlanId: z.string().min(1),
  brokerPositionKey: z.string().min(1),
  brokerCommandId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  attempt: z.number().int().positive().max(2),
  protectedVolume: z.number().positive(),
  requestedStop: z.number().finite(),
  actualStop: z.number().finite().nullable(),
  status: z.enum(['VERIFIED', 'REJECTED']),
  reason: z.string().nullable(),
  occurredAt: z.string().min(1),
});
const flattenResultSchema = z.object({
  kind: z.literal('FLATTEN_RESULT'),
  eventId: z.string().min(1),
  commandId: z.string().min(1),
  orderPlanId: z.string().min(1),
  brokerPositionKey: z.string().min(1),
  brokerCommandId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  targetVolume: z.number().positive(),
  status: z.enum(['VERIFIED', 'REJECTED']),
  closedVolume: z.number().nonnegative(),
  reason: z.string().nullable(),
  occurredAt: z.string().min(1),
});
const managementAckSchema = z.object({
  kind: z.literal('MANAGEMENT_ACK'),
  eventId: z.string().min(1),
  commandId: z.string().min(1),
  protectionRequestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  brokerEffectId: z.string().min(1),
  brokerPositionKey: z.string().min(1),
  sequence: z.number().int().positive(),
  status: z.enum(['VERIFIED', 'REJECTED', 'ALREADY_APPLIED']),
  actualVolume: z.number().nonnegative(),
  actualStop: z.number().finite().nullable(),
  actualTakeProfit: z.number().finite().nullable(),
  closedVolume: z.number().nonnegative(),
  reason: z.string().nullable(),
  occurredAt: z.string().min(1),
});
const errorSchema = z.object({
  kind: z.literal('ERROR'),
  code: z.string().min(1),
  message: z.string().min(1),
  recoverable: z.boolean(),
});

export const mt5DesktopPayloadSchema = z.discriminatedUnion('kind', [
  helloSchema,
  snapshotRequestSchema,
  heartbeatSchema,
  executionCommandSchema,
  managementCommandSchema,
]);
export const mt5AgentPayloadSchema = z.discriminatedUnion('kind', [
  helloAckSchema,
  snapshotMessageSchema,
  quoteMessageSchema,
  candleMessageSchema,
  heartbeatAckSchema,
  commandAckSchema,
  fillSchema,
  protectionAttemptSchema,
  flattenResultSchema,
  managementAckSchema,
  errorSchema,
]);
const envelopeBase = {
  messageId: z.string().min(1),
  correlationId: z.string().nullable(),
  schemaVersion: z.literal(MT5_PROTOCOL_VERSION),
  sentAt: z.string().min(1),
};
export const mt5DesktopEnvelopeSchema = z.object({
  ...envelopeBase,
  payload: mt5DesktopPayloadSchema,
});
export const mt5AgentEnvelopeSchema = z.object({
  ...envelopeBase,
  payload: mt5AgentPayloadSchema,
});
export type Mt5DesktopEnvelope = z.infer<typeof mt5DesktopEnvelopeSchema>;
export type Mt5AgentEnvelope = z.infer<typeof mt5AgentEnvelopeSchema>;
export type Mt5Snapshot = z.infer<typeof mt5SnapshotSchema>;
export type Mt5ExecutionCommand = z.infer<typeof mt5ExecutionCommandSchema>;
export type Mt5ManagementCommand = z.infer<typeof mt5ManagementCommandSchema>;

export const externalPositionClassificationSchema = z.enum([
  'ATTACH_TO_COLONY',
  'TRACK_AS_EXTERNAL',
  'IGNORE',
]);
export const classifyExternalPositionInputSchema = z
  .object({
    brokerPositionKey: z.string().min(1),
    classification: externalPositionClassificationSchema,
    colonyId: z.string().min(1).nullable(),
  })
  .refine(
    (v) =>
      v.classification === 'ATTACH_TO_COLONY'
        ? v.colonyId !== null
        : v.colonyId === null,
    'ATTACH TO COLONY requires a Colony; other classifications must not claim one',
  );
export const mt5WorkspaceSchema = z.object({
  connection: z.object({
    state: mt5ConnectionStateSchema,
    truth: mt5TruthStateSchema,
    transportMode: mt5TransportModeSchema.nullable(),
    sessionId: z.string().nullable(),
    terminalConnected: z.boolean(),
    lastMessageAt: z.string().nullable(),
    detail: z.string(),
  }),
  account: mt5AccountSchema.nullable(),
  reconciliation: z.object({
    status: z.enum(['MATCHED', 'RECOVERY_REQUIRED', 'UNKNOWN']),
    trigger: z.enum(['STARTUP', 'RECONNECT', 'MANUAL']).nullable(),
    completedAt: z.string().nullable(),
    discrepancies: z.array(
      z.object({
        category: z.enum([
          'MATCH',
          'BROKER_ONLY',
          'ARISE_ONLY',
          'QUANTITY_MISMATCH',
          'PROTECTION_MISMATCH',
          'UNKNOWN',
        ]),
        entityType: z.string(),
        entityKey: z.string(),
        detail: z.string(),
      }),
    ),
  }),
  symbols: z.array(mt5SymbolSchema),
  quotes: z.array(mt5QuoteSchema.extend({ canonicalSymbol: z.string() })),
  candles: z.array(mt5CandleSchema.extend({ canonicalSymbol: z.string() })),
  positions: z.array(
    mt5PositionSchema.extend({
      canonicalSymbol: z.string(),
      classification: externalPositionClassificationSchema.nullable(),
      colonyId: z.string().nullable(),
      realityState: z.enum(['OPEN', 'UNKNOWN']),
    }),
  ),
  pendingOrders: z.array(
    mt5PendingOrderSchema.extend({
      canonicalSymbol: z.string(),
      realityState: z.enum(['PENDING', 'UNKNOWN']),
    }),
  ),
  readOnly: z.literal(true),
  executionAvailable: z.literal(false),
});
export type Mt5Workspace = z.infer<typeof mt5WorkspaceSchema>;
