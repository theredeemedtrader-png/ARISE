import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Frozen M0 compatibility table. Canonical M1+ Ideas live in `ideas`. */
export const legacyIdeas = sqliteTable('legacy_ideas', {
  id: text('id').primaryKey(),
  instrumentId: text('instrument_id').notNull(),
  thesisTimeframe: text('thesis_timeframe').notNull(),
  direction: text('direction', {
    enum: ['LONG', 'SHORT', 'NEUTRAL'],
  }).notNull(),
  status: text('status', {
    enum: [
      'DRAFT',
      'WATCHING',
      'ACTIVE',
      'IN_PLAY',
      'COMPLETED',
      'INVALIDATED',
    ],
  }).notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
});

export const instruments = sqliteTable(
  'instruments',
  {
    id: text('id').primaryKey(),
    canonicalSymbol: text('canonical_symbol').notNull(),
    displayName: text('display_name').notNull(),
    assetClass: text('asset_class').notNull(),
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    pipSize: real('pip_size').notNull(),
    tickSize: real('tick_size').notNull(),
    priceDigits: integer('price_digits').notNull(),
    enabled: integer('enabled').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('instruments_canonical_symbol_uq').on(table.canonicalSymbol),
  ],
);

export const timeframes = sqliteTable(
  'timeframes',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    durationSeconds: integer('duration_seconds'),
    calendarRule: text('calendar_rule'),
    displayOrder: integer('display_order').notNull(),
  },
  (table) => [uniqueIndex('timeframes_code_uq').on(table.code)],
);

export const ideas = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  instrumentId: text('instrument_id').notNull(),
  thesisTimeframeId: text('thesis_timeframe_id').notNull(),
  currentStatus: text('current_status', {
    enum: [
      'DRAFT',
      'WATCHING',
      'ACTIVE',
      'IN_PLAY',
      'TARGET_APPROACHING',
      'TARGET_HIT',
      'COMPLETED',
      'INVALIDATED',
      'CANCELLED',
      'ARCHIVED',
    ],
  }).notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

export const ideaVersions = sqliteTable(
  'idea_versions',
  {
    id: text('id').primaryKey(),
    ideaId: text('idea_id').notNull(),
    versionNo: integer('version_no').notNull(),
    direction: text('direction', {
      enum: ['LONG', 'SHORT', 'NEUTRAL'],
    }).notNull(),
    thesisText: text('thesis_text').notNull(),
    targetDescription: text('target_description').notNull(),
    invalidationDescription: text('invalidation_description').notNull(),
    primaryTargetMarketObjectVersionId: text(
      'primary_target_market_object_version_id',
    ),
    invalidationMarketObjectVersionId: text(
      'invalidation_market_object_version_id',
    ),
    createdAt: text('created_at').notNull(),
    supersedesIdeaVersionId: text('supersedes_idea_version_id'),
  },
  (table) => [
    uniqueIndex('idea_versions_idea_version_no_uq').on(
      table.ideaId,
      table.versionNo,
    ),
  ],
);

export const colonies = sqliteTable('colonies', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull(),
  originalIdeaVersionId: text('original_idea_version_id').notNull(),
  instrumentId: text('instrument_id').notNull(),
  label: text('label').notNull(),
  currentState: text('current_state', {
    enum: [
      'DORMANT',
      'BUILDING',
      'ESTABLISHED',
      'MATURE',
      'DECAYING',
      'INVALIDATED',
      'COMPLETED',
    ],
  }).notNull(),
  currentTargetId: text('current_target_id'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});

export const colonyLineage = sqliteTable('colony_lineage', {
  id: text('id').primaryKey(),
  sourceColonyId: text('source_colony_id').notNull(),
  targetColonyId: text('target_colony_id').notNull(),
  relationshipType: text('relationship_type', {
    enum: ['PROMOTED_TO', 'CONSOLIDATED_INTO', 'DERIVED_FROM'],
  }).notNull(),
});

export const colonyStateEvents = sqliteTable('colony_state_events', {
  id: text('id').primaryKey(),
  colonyId: text('colony_id').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reason: text('reason').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  occurredAt: text('occurred_at').notNull(),
  manualOverride: integer('manual_override').notNull(),
  correlationId: text('correlation_id'),
});

export const targets = sqliteTable('targets', {
  id: text('id').primaryKey(),
  colonyId: text('colony_id').notNull(),
  targetType: text('target_type').notNull(),
  exactPrice: real('exact_price'),
  zoneMarketObjectId: text('zone_market_object_id'),
  managementMode: text('management_mode', {
    enum: [
      'REFERENCE_ONLY',
      'FULL_TP',
      'PARTIAL_TP',
      'TRAIL',
      'MANUAL',
      'HYBRID',
      'RUNNER',
    ],
  }).notNull(),
  status: text('status', {
    enum: [
      'ACTIVE',
      'APPROACHING',
      'REACHED',
      'HIT',
      'INVALIDATED',
      'REASSIGNED',
      'COMPLETED',
    ],
  }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const targetEvents = sqliteTable('target_events', {
  id: text('id').primaryKey(),
  targetId: text('target_id').notNull(),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  eventType: text('event_type').notNull(),
  reason: text('reason').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  occurredAt: text('occurred_at').notNull(),
  manualOverride: integer('manual_override').notNull(),
  correlationId: text('correlation_id'),
});

export const marketObjects = sqliteTable('market_objects', {
  id: text('id').primaryKey(),
  instrumentId: text('instrument_id').notNull(),
  ownerType: text('owner_type').notNull(),
  ownerId: text('owner_id').notNull(),
  geometryType: text('geometry_type').notNull(),
  semanticType: text('semantic_type').notNull(),
  role: text('role').notNull(),
  timeframeId: text('timeframe_id'),
  name: text('name').notNull(),
  currentVersionId: text('current_version_id').notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

export const marketObjectVersions = sqliteTable(
  'market_object_versions',
  {
    id: text('id').primaryKey(),
    marketObjectId: text('market_object_id').notNull(),
    versionNo: integer('version_no').notNull(),
    geometryType: text('geometry_type').notNull(),
    semanticType: text('semantic_type').notNull(),
    role: text('role').notNull(),
    timeframeId: text('timeframe_id'),
    name: text('name').notNull(),
    geometryJson: text('geometry_json').notNull(),
    semanticPropertiesJson: text('semantic_properties_json').notNull(),
    sourceCandleIdsJson: text('source_candle_ids_json').notNull(),
    createdAt: text('created_at').notNull(),
    supersedesVersionId: text('supersedes_version_id'),
  },
  (table) => [
    uniqueIndex('market_object_versions_object_version_no_uq').on(
      table.marketObjectId,
      table.versionNo,
    ),
  ],
);

export const marketObjectRelations = sqliteTable('market_object_relations', {
  id: text('id').primaryKey(),
  sourceMarketObjectId: text('source_market_object_id').notNull(),
  targetMarketObjectId: text('target_market_object_id').notNull(),
  relationType: text('relation_type').notNull(),
  createdAt: text('created_at').notNull(),
});

export const timeframeProjections = sqliteTable('timeframe_projections', {
  id: text('id').primaryKey(),
  sourceEntityType: text('source_entity_type').notNull(),
  sourceEntityId: text('source_entity_id').notNull(),
  sourceTimeframeId: text('source_timeframe_id').notNull(),
  targetTimeframeId: text('target_timeframe_id').notNull(),
  intervalStart: text('interval_start').notNull(),
  intervalEnd: text('interval_end').notNull(),
  sourceHigh: real('source_high'),
  sourceLow: real('source_low'),
  colonyId: text('colony_id'),
  parentProjectionId: text('parent_projection_id'),
  createdAt: text('created_at').notNull(),
});

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    colonyId: text('colony_id').notNull(),
    strategyRuntimeId: text('strategy_runtime_id'),
    sequenceNo: integer('sequence_no').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    result: text('result', {
      enum: ['EXPIRED', 'FAILED', 'SCRATCH', 'SURVIVED'],
    }),
    pipCost: real('pip_cost'),
  },
  (table) => [
    uniqueIndex('attempts_colony_sequence_no_uq').on(
      table.colonyId,
      table.sequenceNo,
    ),
  ],
);

export const trades = sqliteTable('trades', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id'),
  colonyId: text('colony_id').notNull(),
  ideaVersionId: text('idea_version_id').notNull(),
  strategyMapVersionId: text('strategy_map_version_id'),
  direction: text('direction', {
    enum: ['LONG', 'SHORT', 'NEUTRAL'],
  }).notNull(),
  createdAt: text('created_at').notNull(),
  sourceType: text('source_type', {
    enum: ['ARISE_AUTO', 'ARISE_MANUAL', 'EXTERNAL_MANUAL', 'IMPORTED'],
  }).notNull(),
});

export const positions = sqliteTable(
  'positions',
  {
    id: text('id').primaryKey(),
    tradeId: text('trade_id').notNull(),
    brokerAccountId: text('broker_account_id').notNull(),
    brokerPositionKey: text('broker_position_key').notNull(),
    originalColonyId: text('original_colony_id').notNull(),
    currentColonyId: text('current_colony_id').notNull(),
    direction: text('direction', {
      enum: ['LONG', 'SHORT', 'NEUTRAL'],
    }).notNull(),
    originalSize: real('original_size').notNull(),
    currentSize: real('current_size').notNull(),
    entryPrice: real('entry_price').notNull(),
    currentState: text('current_state', {
      enum: [
        'SCOUT',
        'SURVIVOR',
        'PROTECTED',
        'LEG',
        'MATURE_LEG',
        'RUNNER',
        'FAILED',
        'CLOSED',
        'CONSOLIDATED',
      ],
    }).notNull(),
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at'),
  },
  (table) => [
    uniqueIndex('positions_broker_identity_uq').on(
      table.brokerAccountId,
      table.brokerPositionKey,
    ),
  ],
);

export const positionStateEvents = sqliteTable('position_state_events', {
  id: text('id').primaryKey(),
  positionId: text('position_id').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reason: text('reason').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  occurredAt: text('occurred_at').notNull(),
  manualOverride: integer('manual_override').notNull(),
  correlationId: text('correlation_id'),
});

export const attemptBudgets = sqliteTable('attempt_budgets', {
  id: text('id').primaryKey(),
  colonyId: text('colony_id').notNull(),
  maxAttempts: integer('max_attempts'),
  maxScoutingLossPips: real('max_scouting_loss_pips'),
  cooldownRuleJson: text('cooldown_rule_json'),
  resetRuleJson: text('reset_rule_json').notNull(),
  currentPeriodKey: text('current_period_key').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentFolderId: text('parent_folder_id'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  documentType: text('document_type', {
    enum: [
      'THESIS',
      'COLONY_NOTE',
      'POSITION_NOTE',
      'TRADE_REVIEW',
      'MARKET_REVIEW',
      'LESSON',
      'STRATEGY_ENCYCLOPEDIA',
      'RESEARCH',
      'NOTE',
    ],
  }).notNull(),
  title: text('title').notNull(),
  currentVersionId: text('current_version_id').notNull(),
  primaryFolderId: text('primary_folder_id'),
  linkedEntityType: text('linked_entity_type'),
  linkedEntityId: text('linked_entity_id'),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

export const blocks = sqliteTable('blocks', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const documentVersions = sqliteTable(
  'document_versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    versionNo: integer('version_no').notNull(),
    contentJson: text('content_json').notNull(),
    createdAt: text('created_at').notNull(),
    supersedesDocumentVersionId: text('supersedes_document_version_id'),
  },
  (table) => [
    uniqueIndex('document_versions_document_version_no_uq').on(
      table.documentId,
      table.versionNo,
    ),
  ],
);

export const folderItems = sqliteTable('folder_items', {
  id: text('id').primaryKey(),
  folderId: text('folder_id').notNull(),
  itemType: text('item_type', {
    enum: ['DOCUMENT', 'ENTITY_SHORTCUT'],
  }).notNull(),
  itemId: text('item_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
});

export const entityLinks = sqliteTable('entity_links', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  relationType: text('relation_type').notNull(),
  createdAt: text('created_at').notNull(),
});

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    category: text('category'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('tags_category_name_uq').on(table.category, table.name),
  ],
);

export const tagAssignments = sqliteTable(
  'tag_assignments',
  {
    id: text('id').primaryKey(),
    tagId: text('tag_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('tag_assignments_unique_uq').on(
      table.tagId,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const reviewSchedules = sqliteTable('review_schedules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timeframeId: text('timeframe_id').notNull(),
  instrumentScopeType: text('instrument_scope_type', {
    enum: ['INSTRUMENT'],
  }).notNull(),
  instrumentScopeId: text('instrument_scope_id').notNull(),
  frequencyType: text('frequency_type', {
    enum: [
      'EVERY_CANDLE',
      'EVERY_2_CANDLES',
      'EVERY_3_CANDLES',
      'ONCE_TRADING_DAY',
      'MANUAL',
    ],
  }).notNull(),
  frequencyValue: integer('frequency_value').notNull(),
  notificationPolicyId: text('notification_policy_id'),
  enabled: integer('enabled').notNull(),
  createdAt: text('created_at').notNull(),
});

export const reviewCycles = sqliteTable('review_cycles', {
  id: text('id').primaryKey(),
  reviewScheduleId: text('review_schedule_id').notNull(),
  dueAt: text('due_at').notNull(),
  candleId: text('candle_id'),
  status: text('status', {
    enum: ['DUE', 'COMPLETED', 'MISSED', 'SKIPPED'],
  }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const marketReviews = sqliteTable('market_reviews', {
  id: text('id').primaryKey(),
  reviewCycleId: text('review_cycle_id').notNull(),
  instrumentId: text('instrument_id').notNull(),
  timeframeId: text('timeframe_id').notNull(),
  status: text('status', {
    enum: ['DUE', 'COMPLETED', 'MISSED', 'SKIPPED'],
  }).notNull(),
  previousReviewId: text('previous_review_id'),
  ideaVersionId: text('idea_version_id'),
  direction: text('direction', {
    enum: ['LONG', 'SHORT', 'NEUTRAL', 'UNCHANGED'],
  }).notNull(),
  notesDocumentId: text('notes_document_id'),
  reviewedAt: text('reviewed_at'),
});

export const reviewEvents = sqliteTable('review_events', {
  id: text('id').primaryKey(),
  marketReviewId: text('market_review_id').notNull(),
  fromStatus: text('from_status', { enum: ['DUE'] }).notNull(),
  toStatus: text('to_status', {
    enum: ['COMPLETED', 'MISSED', 'SKIPPED'],
  }).notNull(),
  occurredAt: text('occurred_at').notNull(),
  reason: text('reason').notNull(),
});

export const economicEvents = sqliteTable(
  'economic_events',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id').notNull(),
    providerEventKey: text('provider_event_key').notNull(),
    title: text('title').notNull(),
    currency: text('currency').notNull(),
    impact: text('impact', {
      enum: ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'],
    }).notNull(),
    scheduledAt: text('scheduled_at').notNull(),
    actual: text('actual'),
    forecast: text('forecast'),
    previous: text('previous'),
    status: text('status').notNull(),
  },
  (table) => [
    uniqueIndex('economic_events_provider_key_uq').on(
      table.providerId,
      table.providerEventKey,
    ),
  ],
);

export const economicEventRevisions = sqliteTable(
  'economic_event_revisions',
  {
    id: text('id').primaryKey(),
    economicEventId: text('economic_event_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    payloadJson: text('payload_json').notNull(),
    receivedAt: text('received_at').notNull(),
  },
  (table) => [
    uniqueIndex('economic_event_revisions_event_revision_no_uq').on(
      table.economicEventId,
      table.revisionNo,
    ),
  ],
);

export const strategyDefinitions = sqliteTable('strategy_definitions', {
  id: text('id').primaryKey(),
  currentVersionId: text('current_version_id').notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

export const strategyVersions = sqliteTable(
  'strategy_versions',
  {
    id: text('id').primaryKey(),
    strategyDefinitionId: text('strategy_definition_id').notNull(),
    versionNo: integer('version_no').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    tagsJson: text('tags_json').notNull(),
    automationCapability: text('automation_capability', {
      enum: ['MANUAL', 'DETECTABLE', 'AUTOMATABLE'],
    }).notNull(),
    detectorJson: text('detector_json'),
    deploymentStatus: text('deployment_status', {
      enum: [
        'EXPERIMENTAL',
        'VALIDATED',
        'DEMO_APPROVED',
        'LIVE_APPROVED',
        'RETIRED',
      ],
    }).notNull(),
    createdAt: text('created_at').notNull(),
    supersedesStrategyVersionId: text('supersedes_strategy_version_id'),
  },
  (table) => [
    uniqueIndex('strategy_versions_definition_version_no_uq').on(
      table.strategyDefinitionId,
      table.versionNo,
    ),
  ],
);

export const strategyMaps = sqliteTable('strategy_maps', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['COMBO', 'STRATEGY_MAP', 'TEMPLATE'] }).notNull(),
  name: text('name').notNull(),
  currentVersionId: text('current_version_id').notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

export const strategyMapVersions = sqliteTable(
  'strategy_map_versions',
  {
    id: text('id').primaryKey(),
    strategyMapId: text('strategy_map_id').notNull(),
    versionNo: integer('version_no').notNull(),
    graphJson: text('graph_json').notNull(),
    createdAt: text('created_at').notNull(),
    supersedesStrategyMapVersionId: text('supersedes_strategy_map_version_id'),
  },
  (table) => [
    uniqueIndex('strategy_map_versions_map_version_no_uq').on(
      table.strategyMapId,
      table.versionNo,
    ),
  ],
);

export const strategyRuntimes = sqliteTable('strategy_runtimes', {
  id: text('id').primaryKey(),
  colonyId: text('colony_id').notNull(),
  strategyMapVersionId: text('strategy_map_version_id').notNull(),
  mode: text('mode', { enum: ['OBSERVE', 'SHADOW', 'DEMO', 'LIVE'] }).notNull(),
  currentStatus: text('current_status', {
    enum: ['READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ERROR'],
  }).notNull(),
  startedAt: text('started_at').notNull(),
  stoppedAt: text('stopped_at'),
});

export const runtimeNodes = sqliteTable('runtime_nodes', {
  id: text('id').primaryKey(),
  strategyRuntimeId: text('strategy_runtime_id').notNull(),
  graphNodeId: text('graph_node_id').notNull(),
  state: text('state', {
    enum: [
      'DORMANT',
      'ARMED',
      'WATCHING',
      'TRIGGERED',
      'CONFIRMED',
      'COMPLETED',
      'FAILED',
      'EXPIRED',
      'CANCELLED',
      'BYPASSED',
    ],
  }).notNull(),
  armedAt: text('armed_at'),
  triggeredAt: text('triggered_at'),
  confirmedAt: text('confirmed_at'),
  lastEvaluatedCandleId: text('last_evaluated_candle_id'),
  triggerCount: integer('trigger_count').notNull(),
  runtimeMemoryJson: text('runtime_memory_json').notNull(),
});

export const runtimeNodeEvents = sqliteTable('runtime_node_events', {
  id: text('id').primaryKey(),
  strategyRuntimeId: text('strategy_runtime_id').notNull(),
  runtimeNodeId: text('runtime_node_id').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  eventType: text('event_type').notNull(),
  sourceEventId: text('source_event_id'),
  summary: text('summary').notNull(),
  occurredAt: text('occurred_at').notNull(),
});
export const detectorEvaluations = sqliteTable('detector_evaluations', {
  id: text('id').primaryKey(),
  runtimeNodeId: text('runtime_node_id').notNull(),
  strategyVersionId: text('strategy_version_id').notNull(),
  detectorKey: text('detector_key').notNull(),
  detectorVersion: text('detector_version').notNull(),
  result: text('result', {
    enum: [
      'NOT_MET',
      'PARTIAL',
      'TRIGGERED',
      'CONFIRMED',
      'BLOCKED',
      'FAILED',
      'EXPIRED',
      'ERROR',
    ],
  }).notNull(),
  evaluatedAt: text('evaluated_at').notNull(),
  candleId: text('candle_id'),
  diagnosticsJson: text('diagnostics_json').notNull(),
});
export const decisionTraces = sqliteTable('decision_traces', {
  id: text('id').primaryKey(),
  strategyRuntimeId: text('strategy_runtime_id').notNull(),
  eventType: text('event_type').notNull(),
  runtimeNodeId: text('runtime_node_id'),
  summary: text('summary').notNull(),
  detailsJson: text('details_json').notNull(),
  occurredAt: text('occurred_at').notNull(),
});
export const runtimeProcessedEvents = sqliteTable('runtime_processed_events', {
  strategyRuntimeId: text('strategy_runtime_id').notNull(),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  occurredAt: text('occurred_at').notNull(),
});
export const runtimeActionProposals = sqliteTable('runtime_action_proposals', {
  correlationId: text('correlation_id').primaryKey(),
  strategyRuntimeId: text('strategy_runtime_id').notNull(),
  runtimeNodeId: text('runtime_node_id').notNull(),
  graphNodeId: text('graph_node_id').notNull(),
  actionKind: text('action_kind').notNull(),
  parametersJson: text('parameters_json').notNull(),
  sourceEventId: text('source_event_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evidenceEvents = sqliteTable(
  'evidence_events',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type', {
      enum: ['STRATEGY_RUNTIME', 'TRADE', 'POSITION', 'REVIEW', 'MANUAL'],
    }).notNull(),
    sourceId: text('source_id').notNull(),
    eventType: text('event_type', {
      enum: [
        'REVIEW',
        'STRATEGY_TRIGGER',
        'STRATEGY_CONFIRMATION',
        'STRATEGY_FAILURE',
        'STRATEGY_EXPIRY',
        'CANDIDATE',
        'ENTRY',
        'SURVIVOR',
        'PROTECTED',
        'LEG',
        'MATURE_LEG',
        'TARGET_APPROACHING',
        'TARGET_HIT',
        'PARTIAL_EXIT',
        'EXIT',
        'CONSOLIDATION',
        'RUNNER_CONVERSION',
        'MANUAL',
      ],
    }).notNull(),
    status: text('status', {
      enum: [
        'CONFIRMED',
        'MANUALLY_CONFIRMED',
        'FAILED',
        'EXPIRED',
        'BLOCKED',
        'ERROR',
      ],
    }).notNull(),
    occurredAt: text('occurred_at').notNull(),
    summary: text('summary').notNull(),
    decisionTraceId: text('decision_trace_id'),
    strategyRuntimeId: text('strategy_runtime_id'),
    runtimeNodeId: text('runtime_node_id'),
    timeframe: text('timeframe'),
    capturePolicy: text('capture_policy', {
      enum: [
        'ENTRY_ONLY',
        'STRATEGY_EVIDENCE_AND_ENTRY',
        'STRATEGY_EVIDENCE_ONLY',
        'CUSTOM',
      ],
    }).notNull(),
    chartWorkspaceStateJson: text('chart_workspace_state_json').notNull(),
    framingProfileJson: text('framing_profile_json').notNull(),
  },
  (table) => [
    uniqueIndex('evidence_events_source_uq').on(
      table.sourceType,
      table.sourceId,
      table.eventType,
    ),
  ],
);

export const evidenceReferences = sqliteTable('evidence_references', {
  id: text('id').primaryKey(),
  evidenceEventId: text('evidence_event_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  entityVersionId: text('entity_version_id'),
  relationType: text('relation_type').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evidenceSnapshots = sqliteTable('evidence_snapshots', {
  id: text('id').primaryKey(),
  evidenceEventId: text('evidence_event_id').notNull(),
  chartWorkspaceStateJson: text('chart_workspace_state_json').notNull(),
  imagePath: text('image_path').notNull(),
  imageHash: text('image_hash').notNull(),
  framingProfileJson: text('framing_profile_json').notNull(),
  capturedAt: text('captured_at').notNull(),
  captureOrigin: text('capture_origin', {
    enum: ['AUTOMATIC', 'MANUAL', 'REGENERATED_VIEW'],
  }).notNull(),
});

export const evidenceCaptureAttempts = sqliteTable(
  'evidence_capture_attempts',
  {
    id: text('id').primaryKey(),
    evidenceEventId: text('evidence_event_id').notNull(),
    evidenceSnapshotId: text('evidence_snapshot_id'),
    status: text('status', { enum: ['SUCCEEDED', 'FAILED'] }).notNull(),
    error: text('error'),
    attemptedAt: text('attempted_at').notNull(),
  },
);

export const evidenceStageSummaries = sqliteTable('evidence_stage_summaries', {
  id: text('id').primaryKey(),
  strategyRuntimeId: text('strategy_runtime_id').notNull(),
  timeframe: text('timeframe').notNull(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evidenceStageSummaryItems = sqliteTable(
  'evidence_stage_summary_items',
  {
    stageSummaryId: text('stage_summary_id').notNull(),
    evidenceEventId: text('evidence_event_id').notNull(),
    ordinal: integer('ordinal').notNull(),
  },
  (table) => [
    uniqueIndex('evidence_stage_summary_item_uq').on(
      table.stageSummaryId,
      table.evidenceEventId,
    ),
  ],
);

export const deploymentSnapshots = sqliteTable('deployment_snapshots', {
  id: text('id').primaryKey(),
  strategyRuntimeId: text('strategy_runtime_id').notNull(),
  strategyMapVersionId: text('strategy_map_version_id').notNull(),
  exactVersionsJson: text('exact_versions_json').notNull(),
  approvedMode: text('approved_mode', { enum: ['SHADOW', 'DEMO'] }).notNull(),
  createdAt: text('created_at').notNull(),
});
export const executionIntents = sqliteTable(
  'execution_intents',
  {
    id: text('id').primaryKey(),
    proposalCorrelationId: text('proposal_correlation_id').notNull(),
    strategyRuntimeId: text('strategy_runtime_id').notNull(),
    mode: text('mode', { enum: ['SHADOW', 'DEMO'] }).notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('execution_intents_proposal_uq').on(
      table.proposalCorrelationId,
    ),
  ],
);
export const executionValidations = sqliteTable('execution_validations', {
  id: text('id').primaryKey(),
  executionIntentId: text('execution_intent_id').notNull(),
  status: text('status', { enum: ['PASS', 'BLOCK', 'ERROR'] }).notNull(),
  checksJson: text('checks_json').notNull(),
  evaluatedAt: text('evaluated_at').notNull(),
});
export const orderPlans = sqliteTable(
  'order_plans',
  {
    id: text('id').primaryKey(),
    executionIntentId: text('execution_intent_id').notNull(),
    deploymentSnapshotId: text('deployment_snapshot_id').notNull(),
    mode: text('mode', { enum: ['SHADOW', 'DEMO'] }).notNull(),
    accountKey: text('account_key'),
    expectedSessionId: text('expected_session_id'),
    payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('order_plans_intent_uq').on(table.executionIntentId)],
);
export const executionLifecycles = sqliteTable('execution_lifecycles', {
  orderPlanId: text('order_plan_id').primaryKey(),
  state: text('state').notNull(),
  filledVolume: real('filled_volume').notNull(),
  protectedVolume: real('protected_volume').notNull(),
  updatedAt: text('updated_at').notNull(),
  detail: text('detail').notNull(),
});
export const executionLifecycleEvents = sqliteTable(
  'execution_lifecycle_events',
  {
    id: text('id').primaryKey(),
    orderPlanId: text('order_plan_id').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    eventType: text('event_type').notNull(),
    detail: text('detail').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
);
export const executionCommands = sqliteTable(
  'execution_commands',
  {
    id: text('id').primaryKey(),
    orderPlanId: text('order_plan_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    commandType: text('command_type').notNull(),
    status: text('status').notNull(),
    attemptCount: integer('attempt_count').notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('execution_commands_idempotency_uq').on(table.idempotencyKey),
  ],
);
export const executionCommandEvents = sqliteTable('execution_command_events', {
  id: text('id').primaryKey(),
  commandId: text('command_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  eventType: text('event_type').notNull(),
  detail: text('detail').notNull(),
  occurredAt: text('occurred_at').notNull(),
});
export const brokerExecutionEvents = sqliteTable(
  'broker_execution_events',
  {
    eventId: text('event_id').primaryKey(),
    messageId: text('message_id').notNull(),
    commandId: text('command_id').notNull(),
    orderPlanId: text('order_plan_id').notNull(),
    eventKind: text('event_kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    uniqueIndex('broker_execution_events_message_uq').on(table.messageId),
  ],
);
export const executionFills = sqliteTable('execution_fills', {
  eventId: text('event_id').primaryKey(),
  orderPlanId: text('order_plan_id').notNull(),
  brokerOrderKey: text('broker_order_key').notNull(),
  brokerPositionKey: text('broker_position_key').notNull(),
  volume: real('volume').notNull(),
  price: real('price').notNull(),
  cumulativeVolume: real('cumulative_volume').notNull(),
  remainingVolume: real('remaining_volume').notNull(),
  filledAt: text('filled_at').notNull(),
});
export const initialProtectionAttempts = sqliteTable(
  'initial_protection_attempts',
  {
    eventId: text('event_id').primaryKey(),
    orderPlanId: text('order_plan_id').notNull(),
    brokerPositionKey: text('broker_position_key').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    requestedStop: real('requested_stop').notNull(),
    actualStop: real('actual_stop'),
    status: text('status', { enum: ['VERIFIED', 'REJECTED'] }).notNull(),
    reason: text('reason'),
    occurredAt: text('occurred_at').notNull(),
  },
);
export const executionPositionLinks = sqliteTable(
  'execution_position_links',
  {
    orderPlanId: text('order_plan_id').primaryKey(),
    attemptId: text('attempt_id').notNull(),
    tradeId: text('trade_id').notNull(),
    positionId: text('position_id').notNull(),
    brokerPositionKey: text('broker_position_key').notNull(),
    materializedAt: text('materialized_at').notNull(),
  },
  (table) => [
    uniqueIndex('execution_position_links_position_uq').on(table.positionId),
  ],
);
export const executionSafetyOperations = sqliteTable(
  'execution_safety_operations',
  {
    eventId: text('event_id').primaryKey(),
    orderPlanId: text('order_plan_id').notNull(),
    brokerCommandId: text('broker_command_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    operationType: text('operation_type', {
      enum: ['SET_INITIAL_STOP', 'SAFETY_FLATTEN'],
    }).notNull(),
    brokerPositionKey: text('broker_position_key').notNull(),
    targetVolume: real('target_volume').notNull(),
    targetStop: real('target_stop'),
    status: text('status', { enum: ['VERIFIED', 'REJECTED'] }).notNull(),
    attemptNo: integer('attempt_no').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
);

export const protectionRuleVersions = sqliteTable(
  'protection_rule_versions',
  {
    id: text('id').primaryKey(), ruleId: text('rule_id').notNull(), versionNo: integer('version_no').notNull(),
    triggerType: text('trigger_type').notNull(), actionType: text('action_type').notNull(), scope: text('scope').notNull(),
    configJson: text('config_json').notNull(), allowWorsening: integer('allow_worsening').notNull(), createdAt: text('created_at').notNull(), supersedesId: text('supersedes_id'),
  },
  (table) => [uniqueIndex('protection_rule_version_uq').on(table.ruleId, table.versionNo)],
);
export const protectionTriggerEvents = sqliteTable('protection_trigger_events', {
  id: text('id').primaryKey(), ruleVersionId: text('rule_version_id').notNull(), sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(), payloadJson: text('payload_json').notNull(), occurredAt: text('occurred_at').notNull(), correlationId: text('correlation_id').notNull(),
});
export const protectionRequests = sqliteTable(
  'protection_requests',
  {
    id: text('id').primaryKey(), positionId: text('position_id').notNull(), brokerPositionKey: text('broker_position_key').notNull(),
    ruleVersionId: text('rule_version_id').notNull(), triggerEventId: text('trigger_event_id').notNull(), mode: text('mode', { enum: ['SHADOW','DEMO'] }).notNull(),
    actionType: text('action_type').notNull(), sequenceNo: integer('sequence_no').notNull(), requestedStop: real('requested_stop'),
    requestedTakeProfit: real('requested_take_profit'), requestedCloseVolume: real('requested_close_volume'), status: text('status').notNull(),
    payloadJson: text('payload_json').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('protection_request_position_sequence_uq').on(table.positionId, table.sequenceNo)],
);
export const protectionRequestEvents = sqliteTable('protection_request_events', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull(), fromStatus: text('from_status'), toStatus: text('to_status').notNull(),
  eventType: text('event_type').notNull(), detail: text('detail').notNull(), occurredAt: text('occurred_at').notNull(),
});
export const managementCommands = sqliteTable(
  'management_commands',
  {
    id: text('id').primaryKey(), protectionRequestId: text('protection_request_id').notNull(), positionId: text('position_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(), commandType: text('command_type').notNull(), sequenceNo: integer('sequence_no').notNull(),
    status: text('status').notNull(), attemptCount: integer('attempt_count').notNull(), payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('management_command_request_uq').on(table.protectionRequestId), uniqueIndex('management_command_idempotency_uq').on(table.idempotencyKey)],
);
export const managementCommandEvents = sqliteTable('management_command_events', {
  id: text('id').primaryKey(), commandId: text('command_id').notNull(), fromStatus: text('from_status'), toStatus: text('to_status').notNull(),
  eventType: text('event_type').notNull(), detail: text('detail').notNull(), occurredAt: text('occurred_at').notNull(),
});
export const brokerManagementEvents = sqliteTable(
  'broker_management_events',
  {
    eventId: text('event_id').primaryKey(), messageId: text('message_id').notNull(), commandId: text('command_id').notNull(),
    protectionRequestId: text('protection_request_id').notNull(), brokerPositionKey: text('broker_position_key').notNull(), sequenceNo: integer('sequence_no').notNull(),
    status: text('status').notNull(), payloadJson: text('payload_json').notNull(), occurredAt: text('occurred_at').notNull(),
  },
  (table) => [uniqueIndex('broker_management_message_uq').on(table.messageId)],
);
export const positionProtectionCurrent = sqliteTable('position_protection_current', {
  positionId: text('position_id').primaryKey(), state: text('state').notNull(), brokerPositionKey: text('broker_position_key').notNull(),
  brokerVolume: real('broker_volume').notNull(), protectedVolume: real('protected_volume').notNull(), verifiedStop: real('verified_stop'),
  verifiedTakeProfit: real('verified_take_profit'), lastAppliedSequence: integer('last_applied_sequence').notNull(), truthState: text('truth_state').notNull(), updatedAt: text('updated_at').notNull(),
});
export const protectionVerifications = sqliteTable('protection_verifications', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull(), commandId: text('command_id').notNull(), brokerPositionKey: text('broker_position_key').notNull(),
  brokerVolume: real('broker_volume').notNull(), protectedVolume: real('protected_volume').notNull(), actualStop: real('actual_stop'), actualTakeProfit: real('actual_take_profit'),
  status: text('status').notNull(), detail: text('detail').notNull(), occurredAt: text('occurred_at').notNull(),
});
export const brokerPositionCostEvents = sqliteTable('broker_position_cost_events', {
  id: text('id').primaryKey(), positionId: text('position_id').notNull(), brokerFillEventId: text('broker_fill_event_id'),
  costType: text('cost_type').notNull(), amountMoney: real('amount_money').notNull(), occurredAt: text('occurred_at').notNull(), sourceId: text('source_id').notNull(),
});
export const positionManagementFills = sqliteTable('position_management_fills', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull(), positionId: text('position_id').notNull(), brokerPositionKey: text('broker_position_key').notNull(),
  operationType: text('operation_type').notNull(), requestedVolume: real('requested_volume').notNull(), actualClosedVolume: real('actual_closed_volume').notNull(),
  remainingBrokerVolume: real('remaining_broker_volume').notNull(), occurredAt: text('occurred_at').notNull(),
});
export const runnerConversionEvents = sqliteTable('runner_conversion_events', {
  id: text('id').primaryKey(), positionId: text('position_id').notNull(), colonyId: text('colony_id').notNull(), targetId: text('target_id'),
  fromState: text('from_state').notNull(), toState: text('to_state').notNull(), policyJson: text('policy_json').notNull(), occurredAt: text('occurred_at').notNull(), correlationId: text('correlation_id').notNull(),
});
export const stackingPolicyVersions = sqliteTable(
  'stacking_policy_versions',
  { id: text('id').primaryKey(), policyId: text('policy_id').notNull(), colonyId: text('colony_id').notNull(), versionNo: integer('version_no').notNull(), mode: text('mode').notNull(), configJson: text('config_json').notNull(), createdAt: text('created_at').notNull(), supersedesId: text('supersedes_id') },
  (table) => [uniqueIndex('stacking_policy_version_uq').on(table.policyId, table.versionNo)],
);
export const colonyAutomationAssignments = sqliteTable('colony_automation_assignments', {
  colonyId: text('colony_id').primaryKey(), stackingPolicyVersionId: text('stacking_policy_version_id').notNull(), attemptBudgetId: text('attempt_budget_id'),
  invalidationPolicy: text('invalidation_policy').notNull(), countertrendEnabled: integer('countertrend_enabled').notNull(), entryArmed: integer('entry_armed').notNull(),
  cooldownUntil: text('cooldown_until'), currentPeriodKey: text('current_period_key').notNull(), updatedAt: text('updated_at').notNull(),
});
export const colonyAutomationEvents = sqliteTable('colony_automation_events', {
  id: text('id').primaryKey(), colonyId: text('colony_id').notNull(), eventType: text('event_type').notNull(), payloadJson: text('payload_json').notNull(),
  occurredAt: text('occurred_at').notNull(), correlationId: text('correlation_id').notNull(),
});

// M12 records valuation facts and review knowledge without mutating execution history.
export const positionPerformanceEvents = sqliteTable(
  'position_performance_events',
  {
    id: text('id').primaryKey(), positionId: text('position_id').notNull(),
    eventType: text('event_type', { enum: ['EXIT_FILL','MARK'] }).notNull(),
    quantity: real('quantity'), price: real('price').notNull(), money: real('money'),
    sourceType: text('source_type').notNull(), sourceId: text('source_id').notNull(), occurredAt: text('occurred_at').notNull(),
  },
  (table) => [uniqueIndex('position_performance_source_uq').on(table.sourceType, table.sourceId, table.eventType)],
);
export const performanceReviews = sqliteTable('performance_reviews', {
  id: text('id').primaryKey(), sourceType: text('source_type', { enum: ['TRADE','COLONY'] }).notNull(),
  sourceId: text('source_id').notNull(), title: text('title').notNull(), ideaVersionId: text('idea_version_id').notNull(),
  strategyMapVersionId: text('strategy_map_version_id'), currentDissectionVersionId: text('current_dissection_version_id').notNull(),
  createdAt: text('created_at').notNull(),
});
export const reviewDissectionVersions = sqliteTable(
  'review_dissection_versions',
  {
    id: text('id').primaryKey(), reviewId: text('review_id').notNull(), versionNo: integer('version_no').notNull(),
    dissectionJson: text('dissection_json').notNull(), createdAt: text('created_at').notNull(), supersedesId: text('supersedes_id'),
  },
  (table) => [uniqueIndex('review_dissection_version_uq').on(table.reviewId, table.versionNo)],
);
export const reviewEvidenceLinks = sqliteTable('review_evidence_links', {
  id: text('id').primaryKey(), reviewId: text('review_id').notNull(), evidenceEventId: text('evidence_event_id').notNull(),
  relationType: text('relation_type').notNull(), createdAt: text('created_at').notNull(),
});
export const lessons = sqliteTable('lessons', {
  id: text('id').primaryKey(), currentVersionId: text('current_version_id').notNull(), createdAt: text('created_at').notNull(),
});
export const lessonVersions = sqliteTable(
  'lesson_versions',
  {
    id: text('id').primaryKey(), lessonId: text('lesson_id').notNull(), versionNo: integer('version_no').notNull(),
    status: text('status', { enum: ['OBSERVATION','REPEATED_PATTERN','PLAYBOOK_RULE','MASTERED','ARCHIVED'] }).notNull(),
    statement: text('statement').notNull(), createdAt: text('created_at').notNull(), supersedesId: text('supersedes_id'),
  },
  (table) => [uniqueIndex('lesson_version_uq').on(table.lessonId, table.versionNo)],
);
export const lessonEvidence = sqliteTable('lesson_evidence', {
  id: text('id').primaryKey(), lessonVersionId: text('lesson_version_id').notNull(), evidenceEventId: text('evidence_event_id').notNull(),
  relationType: text('relation_type').notNull(), createdAt: text('created_at').notNull(),
});
export const reviewLessonLinks = sqliteTable('review_lesson_links', {
  id: text('id').primaryKey(), reviewId: text('review_id').notNull(), lessonId: text('lesson_id').notNull(), createdAt: text('created_at').notNull(),
});
export const strategyChangeProposals = sqliteTable('strategy_change_proposals', {
  id: text('id').primaryKey(), lessonVersionId: text('lesson_version_id').notNull(), sourceStrategyVersionId: text('source_strategy_version_id').notNull(),
  proposedChange: text('proposed_change').notNull(), expectedEffect: text('expected_effect').notNull(), testRequirements: text('test_requirements').notNull(),
  status: text('status', { enum: ['PROPOSED','ACCEPTED','REJECTED'] }).notNull(), resultingStrategyVersionId: text('resulting_strategy_version_id'),
  createdAt: text('created_at').notNull(), resolvedAt: text('resolved_at'),
});
export const strategyChangeProposalEvents = sqliteTable('strategy_change_proposal_events', {
  id: text('id').primaryKey(), proposalId: text('proposal_id').notNull(), fromStatus: text('from_status'), toStatus: text('to_status').notNull(),
  detail: text('detail').notNull(), occurredAt: text('occurred_at').notNull(),
});
