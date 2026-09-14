import { z } from 'zod';
import { classifyExternalPositionInputSchema, mt5WorkspaceSchema } from './mt5';

export const appInfoSchema = z.object({
  name: z.literal('ARISE'),
  version: z.string(),
  buildCommit: z.string(),
  buildDate: z.string(),
  databaseSchemaVersion: z.number().int().nonnegative(),
  mt5ProtocolVersion: z.number().int().positive(),
  dataDirectory: z.string(),
  logsDirectory: z.string(),
  databasePath: z.string(),
  packaged: z.boolean(),
  databaseReady: z.boolean(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

// Frozen M0 compatibility IPC.
export const createIdeaInputSchema = z.object({
  instrumentId: z.string().trim().min(1),
  timeframe: z.string().trim().min(1),
  direction: z.enum(['LONG', 'SHORT', 'NEUTRAL']),
});
export type CreateIdeaInput = z.infer<typeof createIdeaInputSchema>;
export const createIdeaResultSchema = z.object({ ideaId: z.string().min(1) });
export const ideaSummarySchema = createIdeaInputSchema.extend({ ideaId: z.string().min(1) });
export const listIdeasResultSchema = z.array(ideaSummarySchema);

const timeframeCodeSchema = z.enum(['M1', 'M2', 'M3', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'H6', 'H8', 'H12', 'D', 'W', 'M']);
const chartTimeframeSchema = z.enum(['M5', 'M15', 'H1', 'H4', 'D', 'W']);
const marketObjectGeometryTypeSchema = z.enum(['LINE', 'RAY', 'RECTANGLE', 'TRENDLINE', 'POINT', 'CANDLE_REFERENCE', 'TEXT']);
const marketObjectRoleSchema = z.enum(['REFERENCE', 'AREA', 'TRIGGER', 'TARGET', 'INVALIDATION', 'PROTECTION', 'CONFIRMATION', 'ORIGIN']);

export const chartInstrumentSchema = z.object({
  instrumentId: z.string().min(1),
  symbol: z.string().min(1),
  displayName: z.string().min(1),
  priceDigits: z.number().int().nonnegative(),
  pipSize: z.number().positive(),
  tickSize: z.number().positive(),
});
export const chartCatalogSchema = z.object({
  instruments: z.array(chartInstrumentSchema),
  timeframes: z.array(z.object({ timeframeId: z.string().min(1), code: timeframeCodeSchema })),
});
export const listChartObjectsInputSchema = z.object({ symbol: z.string().trim().min(1) });
export const chartMarketObjectSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  versionNo: z.number().int().positive(),
  symbol: z.string().min(1),
  geometryType: marketObjectGeometryTypeSchema,
  semanticType: z.string().min(1),
  role: marketObjectRoleSchema,
  timeframe: chartTimeframeSchema.nullable(),
  name: z.string().min(1),
  geometryJson: z.unknown(),
  semanticPropertiesJson: z.unknown(),
  createdAt: z.string().min(1),
});
export const listChartObjectsResultSchema = z.array(chartMarketObjectSchema);
export const createChartObjectInputSchema = z.object({
  symbol: z.string().trim().min(1),
  timeframe: chartTimeframeSchema.nullable(),
  geometryType: marketObjectGeometryTypeSchema,
  semanticType: z.string().trim().min(1),
  role: marketObjectRoleSchema,
  name: z.string().trim().min(1),
  geometryJson: z.unknown(),
  semanticPropertiesJson: z.unknown().optional(),
});
export const reviseChartObjectInputSchema = z.object({ marketObjectId: z.string().min(1), geometryJson: z.unknown() });

const directionSchema = z.enum(['LONG', 'SHORT', 'NEUTRAL']);
const ideaStatusSchema = z.enum(['DRAFT','WATCHING','ACTIVE','IN_PLAY','TARGET_APPROACHING','TARGET_HIT','COMPLETED','INVALIDATED','CANCELLED','ARCHIVED']);
const colonyStateSchema = z.enum(['DORMANT','BUILDING','ESTABLISHED','MATURE','DECAYING','INVALIDATED','COMPLETED']);
const documentTypeSchema = z.enum(['THESIS','COLONY_NOTE','POSITION_NOTE','TRADE_REVIEW','MARKET_REVIEW','LESSON','STRATEGY_ENCYCLOPEDIA','RESEARCH','NOTE']);
const documentBlockTypeSchema = z.enum(['PARAGRAPH','HEADING_1','HEADING_2','BULLET','QUOTE','CALLOUT','CHECKLIST','CODE']);
export const documentBlockSchema = z.object({ id: z.string().min(1), type: documentBlockTypeSchema, text: z.string(), checked: z.boolean().optional() });

export const planningIdeaSchema = z.object({
  ideaId: z.string().min(1),
  ideaVersionId: z.string().min(1),
  versionNo: z.number().int().positive(),
  colonyId: z.string().min(1),
  colonyLabel: z.string().min(1),
  colonyState: colonyStateSchema,
  instrumentId: z.string().min(1),
  symbol: z.string().min(1),
  timeframeId: z.string().min(1),
  timeframe: z.string().min(1),
  status: ideaStatusSchema,
  direction: directionSchema,
  thesisText: z.string(),
  targetDescription: z.string(),
  invalidationDescription: z.string(),
  primaryTargetMarketObjectVersionId: z.string().nullable(),
  invalidationMarketObjectVersionId: z.string().nullable(),
  thesisDocumentId: z.string().min(1),
  thesisDocumentVersionId: z.string().min(1),
  thesisBlocks: z.array(documentBlockSchema),
  createdAt: z.string().min(1),
});
export const listPlanningIdeasResultSchema = z.array(planningIdeaSchema);
export const createPlanningIdeaInputSchema = z.object({
  symbol: z.string().trim().min(1),
  timeframe: z.string().trim().min(1),
  direction: directionSchema,
  thesisText: z.string(),
  targetDescription: z.string(),
  invalidationDescription: z.string(),
  primaryTargetMarketObjectVersionId: z.string().nullable().default(null),
  invalidationMarketObjectVersionId: z.string().nullable().default(null),
});
export const updatePlanningThesisInputSchema = z.object({
  ideaId: z.string().min(1),
  direction: directionSchema,
  thesisText: z.string(),
  targetDescription: z.string(),
  invalidationDescription: z.string(),
  primaryTargetMarketObjectVersionId: z.string().nullable(),
  invalidationMarketObjectVersionId: z.string().nullable(),
  thesisBlocks: z.array(documentBlockSchema),
});
export const transitionPlanningIdeaInputSchema = z.object({ ideaId: z.string().min(1), to: ideaStatusSchema });

export const folderSchema = z.object({ id: z.string().min(1), name: z.string().min(1), parentFolderId: z.string().nullable(), sortOrder: z.number().int().nonnegative(), createdAt: z.string().min(1) });
export const knowledgeDocumentSummarySchema = z.object({
  id: z.string().min(1), documentType: documentTypeSchema, title: z.string().min(1), primaryFolderId: z.string().nullable(),
  linkedEntityType: z.string().nullable(), linkedEntityId: z.string().nullable(), versionNo: z.number().int().positive(), updatedAt: z.string().min(1),
});
export const knowledgeBacklinkSchema = z.object({ documentId: z.string().min(1), title: z.string().min(1), label: z.string().min(1) });
export const knowledgeDocumentDetailSchema = knowledgeDocumentSummarySchema.extend({
  currentVersionId: z.string().min(1), blocks: z.array(documentBlockSchema), wikiLinks: z.array(z.string()), backlinks: z.array(knowledgeBacklinkSchema),
});
export const knowledgeLibrarySchema = z.object({ folders: z.array(folderSchema), documents: z.array(knowledgeDocumentSummarySchema) });
export const getKnowledgeDocumentInputSchema = z.object({ documentId: z.string().min(1) });
export const createKnowledgeDocumentInputSchema = z.object({
  title: z.string().trim().min(1), documentType: documentTypeSchema, text: z.string().default(''), primaryFolderId: z.string().nullable().default(null),
});
export const saveKnowledgeDocumentInputSchema = z.object({ documentId: z.string().min(1), blocks: z.array(documentBlockSchema) });
export const createFolderInputSchema = z.object({ name: z.string().trim().min(1), parentFolderId: z.string().nullable().default(null) });
export const moveKnowledgeDocumentInputSchema = z.object({ documentId: z.string().min(1), folderId: z.string().nullable() });

const reviewFrequencySchema = z.enum(['EVERY_CANDLE','EVERY_2_CANDLES','EVERY_3_CANDLES','ONCE_TRADING_DAY','MANUAL']);
const reviewStatusSchema = z.enum(['DUE','COMPLETED','MISSED','SKIPPED']);
const reviewDirectionSchema = z.enum(['LONG','SHORT','NEUTRAL','UNCHANGED']);
export const reviewScheduleViewSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), symbol: z.string().min(1), instrumentId: z.string().min(1), timeframe: z.string().min(1), timeframeId: z.string().min(1),
  frequencyType: reviewFrequencySchema, frequencyValue: z.number().int().positive(), enabled: z.boolean(), createdAt: z.string().min(1), automaticTimingAvailable: z.boolean(),
});
export const reviewQueueEntrySchema = z.object({
  reviewId: z.string().min(1), cycleId: z.string().min(1), scheduleId: z.string().min(1), scheduleName: z.string().min(1), symbol: z.string().min(1), timeframe: z.string().min(1),
  dueAt: z.string().min(1), status: reviewStatusSchema, direction: reviewDirectionSchema, previousReviewId: z.string().nullable(), ideaVersionId: z.string().nullable(), notesDocumentId: z.string().nullable(), reviewedAt: z.string().nullable(),
});
export const reviewWorkspaceSchema = z.object({ schedules: z.array(reviewScheduleViewSchema), queue: z.array(reviewQueueEntrySchema), automaticTimingAvailable: z.literal(false) });
export const createReviewScheduleInputSchema = z.object({ symbol: z.string().trim().min(1), timeframe: z.string().trim().min(1), frequencyType: reviewFrequencySchema });
export const queueReviewNowInputSchema = z.object({ scheduleId: z.string().min(1) });
export const resolveMarketReviewInputSchema = z.object({
  reviewId: z.string().min(1), status: z.enum(['COMPLETED','MISSED','SKIPPED']), direction: reviewDirectionSchema, notes: z.string().default(''),
});



const automationCapabilitySchema = z.enum(['MANUAL','DETECTABLE','AUTOMATABLE']);
const deploymentStatusSchema = z.enum(['EXPERIMENTAL','VALIDATED','DEMO_APPROVED','LIVE_APPROVED','RETIRED']);
const executionModeSchema = z.enum(['OBSERVE','NOTIFY','CONFIRM','AUTO']);
const evaluationModeSchema = z.enum(['ON_TICK','ON_PRICE_UPDATE','ON_BAR_UPDATE','ON_BAR_CLOSE','ON_EVENT','MANUAL']);
const timeframePurposeSchema = z.enum(['HINDSIGHT','AREA','ENTRY']);
const stageImportanceSchema = z.enum(['REQUIRED','OPTIONAL','INFORMATIONAL']);
const strategyNodeFamilySchema = z.enum(['STRATEGY','LOGIC','MODIFIER','MARKET_OBJECT','STATE','ACTION']);
const strategyMapKindSchema = z.enum(['COMBO','STRATEGY_MAP','TEMPLATE']);
const logicOperatorSchema = z.enum(['AND','OR','THEN','NOT']);

export const detectorContractSchema = z.object({
  key: z.string().trim().min(1), version: z.string().trim().min(1), evaluationMode: evaluationModeSchema,
  parameterSchema: z.record(z.string(), z.unknown()),
});

const graphNodeBaseSchema = z.object({
  id: z.string().min(1), family: strategyNodeFamilySchema, label: z.string().trim().min(1),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }), timeframe: z.string().nullable(),
  purposes: z.array(timeframePurposeSchema), importance: stageImportanceSchema, executionMode: executionModeSchema,
});
export const strategyGraphNodeSchema = z.discriminatedUnion('family', [
  graphNodeBaseSchema.extend({ family: z.literal('STRATEGY'), strategyVersionId: z.string().min(1), parameters: z.record(z.string(), z.unknown()).default({}) }),
  graphNodeBaseSchema.extend({ family: z.literal('LOGIC'), operator: logicOperatorSchema }),
  graphNodeBaseSchema.extend({ family: z.literal('MODIFIER'), modifierKey: z.string().min(1), parameters: z.record(z.string(), z.unknown()) }),
  graphNodeBaseSchema.extend({ family: z.literal('MARKET_OBJECT'), marketObjectId: z.string().nullable(), marketObjectVersionId: z.string().nullable(), conditionKey: z.string().min(1) }),
  graphNodeBaseSchema.extend({ family: z.literal('STATE'), stateKey: z.string().min(1) }),
  graphNodeBaseSchema.extend({ family: z.literal('ACTION'), actionKey: z.string().min(1), parameters: z.record(z.string(), z.unknown()) }),
]);
export const strategyGraphEdgeSchema = z.object({ id: z.string().min(1), sourceNodeId: z.string().min(1), targetNodeId: z.string().min(1), sourcePort: z.string().min(1), targetPort: z.string().min(1) });
export const strategyGraphSchema = z.object({ nodes: z.array(strategyGraphNodeSchema), edges: z.array(strategyGraphEdgeSchema) });

export const strategyDefinitionViewSchema = z.object({
  definitionId: z.string().min(1), versionId: z.string().min(1), versionNo: z.number().int().positive(), name: z.string().min(1), category: z.string().min(1),
  description: z.string(), tags: z.array(z.string()), automationCapability: automationCapabilitySchema, deploymentStatus: deploymentStatusSchema,
  detector: detectorContractSchema.nullable(), createdAt: z.string().min(1),
});
export const strategyMapViewSchema = z.object({
  mapId: z.string().min(1), versionId: z.string().min(1), versionNo: z.number().int().positive(), kind: strategyMapKindSchema, name: z.string().min(1), graph: strategyGraphSchema, createdAt: z.string().min(1),
});
const runtimeModeSchema = z.enum(['OBSERVE','SHADOW','DEMO','LIVE']);
const runtimeStatusSchema = z.enum(['READY','RUNNING','PAUSED','COMPLETED','CANCELLED','ERROR']);
const runtimeNodeStateSchema = z.enum(['DORMANT','ARMED','WATCHING','TRIGGERED','CONFIRMED','COMPLETED','FAILED','EXPIRED','CANCELLED','BYPASSED']);
const detectorResultStatusSchema = z.enum(['NOT_MET','PARTIAL','TRIGGERED','CONFIRMED','BLOCKED','FAILED','EXPIRED','ERROR']);
const runtimeEventTypeSchema = z.enum(['TICK','PRICE_UPDATE','BAR_UPDATE','BAR_CLOSE','EVENT','MANUAL']);
export const runtimeNodeViewSchema = z.object({ id:z.string().min(1), graphNodeId:z.string().min(1), label:z.string().min(1), family:strategyNodeFamilySchema, state:runtimeNodeStateSchema, triggerCount:z.number().int().nonnegative(), lastEvaluatedCandleId:z.string().nullable(), runtimeMemory:z.record(z.string(),z.unknown()), manualDecisionRequired:z.boolean() });
export const detectorEvaluationViewSchema = z.object({ id:z.string().min(1), runtimeNodeId:z.string().min(1), strategyVersionId:z.string().min(1), detectorKey:z.string().min(1), detectorVersion:z.string().min(1), result:detectorResultStatusSchema, evaluatedAt:z.string().min(1), candleId:z.string().nullable(), diagnostics:z.record(z.string(),z.unknown()) });
export const decisionTraceViewSchema = z.object({ id:z.string().min(1), eventType:z.string().min(1), runtimeNodeId:z.string().nullable(), summary:z.string(), details:z.record(z.string(),z.unknown()), occurredAt:z.string().min(1) });
export const runtimeActionProposalViewSchema = z.object({ actionKind:z.string().min(1), runtimeNodeId:z.string().min(1), graphNodeId:z.string().min(1), parameters:z.record(z.string(),z.unknown()), correlationId:z.string().min(1) });
export const strategyRuntimeViewSchema = z.object({ runtimeId:z.string().min(1), colonyId:z.string().min(1), colonyLabel:z.string().min(1), mapId:z.string().min(1), mapName:z.string().min(1), mapVersionId:z.string().min(1), mapVersionNo:z.number().int().positive(), graph:strategyGraphSchema, mode:runtimeModeSchema, status:runtimeStatusSchema, startedAt:z.string().min(1), stoppedAt:z.string().nullable(), nodes:z.array(runtimeNodeViewSchema), evaluations:z.array(detectorEvaluationViewSchema), traces:z.array(decisionTraceViewSchema), actionProposals:z.array(runtimeActionProposalViewSchema) });
export const runtimeColonyViewSchema = z.object({ colonyId:z.string().min(1), label:z.string().min(1), symbol:z.string().min(1), direction:z.enum(['LONG','SHORT','NEUTRAL']), status:ideaStatusSchema });
export const strategyWorkspaceSchema = z.object({ strategies: z.array(strategyDefinitionViewSchema), maps: z.array(strategyMapViewSchema), runtimes:z.array(strategyRuntimeViewSchema), runtimeColonies:z.array(runtimeColonyViewSchema), runtimeAvailable: z.literal(true), liveMarketDataAvailable:z.literal(false) });
export const createStrategyDefinitionInputSchema = z.object({
  name: z.string().trim().min(1), category: z.string().trim().min(1), description: z.string().default(''), tags: z.array(z.string()).default([]), automationCapability: automationCapabilitySchema, deploymentStatus: deploymentStatusSchema.default('EXPERIMENTAL'),
  detectorKey: z.string().trim().default(''), detectorVersion: z.string().trim().default('1'), evaluationMode: evaluationModeSchema.default('MANUAL'), parameterSchema: z.record(z.string(), z.unknown()).default({}),
});
export const reviseStrategyDefinitionInputSchema = createStrategyDefinitionInputSchema.extend({ definitionId: z.string().min(1) });
export const createStrategyMapInputSchema = z.object({ name: z.string().trim().min(1), kind: strategyMapKindSchema, graph: strategyGraphSchema });
export const saveStrategyMapInputSchema = z.object({ mapId: z.string().min(1), graph: strategyGraphSchema });
export const createStrategyRuntimeInputSchema = z.object({ mapId:z.string().min(1), colonyId:z.string().min(1), mode:z.enum(['OBSERVE','SHADOW','DEMO']) });
export const simulateStrategyRuntimeEventInputSchema = z.object({
  runtimeId:z.string().min(1), eventType:runtimeEventTypeSchema, timeframe:z.string().nullable().default(null), price:z.number().finite().nullable().default(null), spreadPips:z.number().nonnegative().nullable().default(null), pipSize:z.number().positive().default(0.0001),
  candle:z.object({ id:z.string().min(1), open:z.number().finite(), high:z.number().finite(), low:z.number().finite(), close:z.number().finite(), openedAt:z.string().min(1), closedAt:z.string().nullable() }).nullable().default(null),
  states:z.record(z.string(), z.union([z.string(),z.number(),z.boolean(),z.null()])).default({}),
});
export const manualStrategyRuntimeDecisionInputSchema = z.object({ runtimeId:z.string().min(1), graphNodeId:z.string().min(1), decision:z.enum(['CONFIRM','REJECT','SKIP']) });

export const evidenceReferenceViewSchema = z.object({ id:z.string().min(1), entityType:z.string().min(1), entityId:z.string().min(1), entityVersionId:z.string().nullable(), relationType:z.string().min(1) });
export const evidenceSnapshotViewSchema = z.object({ id:z.string().min(1), imagePath:z.string().min(1), imageHash:z.string().length(64), capturedAt:z.string().min(1), captureOrigin:z.enum(['AUTOMATIC','MANUAL','REGENERATED_VIEW']), assetIntegrity:z.enum(['VERIFIED','MISSING','CORRUPT']), imageDataUrl:z.string().nullable() });
export const evidenceEventViewSchema = z.object({
  id:z.string().min(1), sourceType:z.enum(['STRATEGY_RUNTIME','TRADE','POSITION','REVIEW','MANUAL']), sourceId:z.string().min(1),
  eventType:z.enum(['REVIEW','STRATEGY_TRIGGER','STRATEGY_CONFIRMATION','STRATEGY_FAILURE','STRATEGY_EXPIRY','CANDIDATE','ENTRY','SURVIVOR','PROTECTED','LEG','MATURE_LEG','TARGET_APPROACHING','TARGET_HIT','PARTIAL_EXIT','EXIT','CONSOLIDATION','RUNNER_CONVERSION','MANUAL']),
  status:z.enum(['CONFIRMED','MANUALLY_CONFIRMED','FAILED','EXPIRED','BLOCKED','ERROR']), occurredAt:z.string().min(1), summary:z.string().min(1), decisionTraceId:z.string().nullable(),
  decisionTrace:decisionTraceViewSchema.nullable(), strategyRuntimeId:z.string().nullable(), runtimeNodeId:z.string().nullable(), timeframe:z.string().nullable(), capturePolicy:z.enum(['ENTRY_ONLY','STRATEGY_EVIDENCE_AND_ENTRY','STRATEGY_EVIDENCE_ONLY','CUSTOM']),
  captureState:z.enum(['PENDING','CAPTURED','CAPTURE_FAILED']), workspaceState:z.record(z.string(),z.unknown()), references:z.array(evidenceReferenceViewSchema), snapshots:z.array(evidenceSnapshotViewSchema),
});
export const evidenceStageSummaryViewSchema = z.object({ id:z.string().min(1), strategyRuntimeId:z.string().min(1), timeframe:z.string().min(1), title:z.string().min(1), evidenceEventIds:z.array(z.string().min(1)), createdAt:z.string().min(1) });
export const evidenceWorkspaceSchema = z.object({ events:z.array(evidenceEventViewSchema), stageSummaries:z.array(evidenceStageSummaryViewSchema), captureQueueDepth:z.number().int().nonnegative(), executionAvailable:z.literal(false) });
export const regenerateEvidenceSnapshotInputSchema = z.object({ evidenceEventId:z.string().min(1) });
export const regenerateEvidenceSnapshotResultSchema = z.object({ accepted:z.literal(true), evidenceEventId:z.string().min(1), captureOrigin:z.literal('REGENERATED_VIEW') });
export const executeActionProposalInputSchema=z.object({proposalCorrelationId:z.string().min(1)});
export const executionWorkspaceSchema=z.object({intents:z.array(z.record(z.string(),z.unknown())),validations:z.array(z.object({id:z.string(),intentId:z.string(),status:z.enum(['PASS','BLOCK','ERROR']),checks:z.array(z.object({key:z.string(),status:z.enum(['PASS','BLOCK','ERROR']),detail:z.string()})),evaluatedAt:z.string()})),plans:z.array(z.record(z.string(),z.unknown())),lifecycles:z.array(z.object({orderPlanId:z.string(),state:z.string(),filledVolume:z.number(),protectedVolume:z.number(),updatedAt:z.string(),detail:z.string()})),commands:z.array(z.object({commandId:z.string(),orderPlanId:z.string(),idempotencyKey:z.string(),commandType:z.string(),status:z.string(),attemptCount:z.number().int(),createdAt:z.string(),updatedAt:z.string()}))});
export const protectionTriggerTypeSchema=z.enum(['PRICE_TOUCH','PRICE_CROSS','WICK_THROUGH','CANDLE_CLOSE_ABOVE','CANDLE_CLOSE_BELOW','RECLAIM','ENTER_ZONE','EXIT_ZONE','STRATEGY_NODE_CONFIRMED','POSITION_STATE_CHANGED','TARGET_APPROACHING','TARGET_REACHED','TARGET_HIT','MANUAL']);
export const protectionActionTypeSchema=z.enum(['MOVE_TO_PRICE_BE','MOVE_TO_TRUE_BE','BE_PLUS_OFFSET','LOCK_PIPS','LOCK_MONEY','LOCK_PERCENT_OPEN_PROFIT','MOVE_TO_PRICE','MOVE_TO_MARKET_OBJECT','TRAIL_FIXED_DISTANCE','TRAIL_MARKET_OBJECT','TRAIL_STRUCTURE','PARTIAL_CLOSE','FULL_CLOSE','REMOVE_TP','SET_TP','CONVERT_TO_RUNNER']);
export const protectionScopeSchema=z.enum(['THIS_POSITION','SELECTED_POSITIONS','ALL_SCOUTS','ALL_SURVIVORS','ALL_UNPROTECTED','ALL_LEGS','ALL_MATURE_LEGS','ALL_POSITIONS_IN_COLONY','POSITIONS_MATCHING_TAG']);
export const protectionWorkspaceSchema=z.object({
  positions:z.array(z.record(z.string(),z.unknown())),
  rules:z.array(z.record(z.string(),z.unknown())),triggers:z.array(z.record(z.string(),z.unknown())),requests:z.array(z.record(z.string(),z.unknown())),
  commands:z.array(z.record(z.string(),z.unknown())),brokerEvents:z.array(z.record(z.string(),z.unknown())),protection:z.array(z.record(z.string(),z.unknown())),
  verifications:z.array(z.record(z.string(),z.unknown())),costs:z.array(z.record(z.string(),z.unknown())),managementFills:z.array(z.record(z.string(),z.unknown())),
  runnerConversions:z.array(z.record(z.string(),z.unknown())),stackingPolicies:z.array(z.record(z.string(),z.unknown())),colonyAutomation:z.array(z.record(z.string(),z.unknown())),automationEvents:z.array(z.record(z.string(),z.unknown())),
});
export const createProtectionRuleInputSchema=z.object({
  id:z.string().min(1),ruleId:z.string().min(1),version:z.number().int().positive(),triggerType:protectionTriggerTypeSchema,
  actionType:protectionActionTypeSchema,scope:protectionScopeSchema,config:z.record(z.string(),z.unknown()),
  createdAt:z.string().min(1),supersedesId:z.string().min(1).nullable(),
});
export const recordProtectionTriggerInputSchema=z.object({
  id:z.string().min(1),ruleVersionId:z.string().min(1),sourceType:z.enum(['PRICE_OBJECT','STRATEGY_EVENT','POSITION_STATE','TARGET_STATE','MANUAL']),
  sourceId:z.string().min(1),payload:z.record(z.string(),z.unknown()),occurredAt:z.string().min(1),correlationId:z.string().min(1),
});
export const executeProtectionProposalInputSchema=z.object({
  mode:z.enum(['SHADOW','DEMO']),proposal:z.object({
    proposalId:z.string().min(1),ruleVersionId:z.string().min(1),triggerEventId:z.string().min(1),positionId:z.string().min(1),brokerPositionKey:z.string().min(1),
    action:protectionActionTypeSchema,requestedStop:z.number().finite().nullable(),requestedTakeProfit:z.number().finite().nullable(),requestedCloseVolume:z.number().positive().nullable(),
    convertToRunner:z.boolean(),sequence:z.number().int().positive(),createdAt:z.string().min(1),
  }),
});
export const configureColonyAutomationInputSchema=z.object({
  policyVersionId:z.string().min(1),policyId:z.string().min(1),colonyId:z.string().min(1),version:z.number().int().positive(),
  mode:z.enum(['ANY_VALID_ENTRY','ONLY_AFTER_SURVIVOR','ONLY_AFTER_PROTECTED','ONLY_AFTER_LEG','MANUAL']),config:z.record(z.string(),z.unknown()),
  attemptBudgetId:z.string().min(1).nullable(),invalidationPolicy:z.enum(['KEEP_MANAGING','TIGHTEN','MOVE_TO_PROTECTION','CLOSE_ALL','MANUAL_DECISION']).optional(),
  currentPeriodKey:z.string().min(1),occurredAt:z.string().min(1),
});
export const invalidateColonyThesisInputSchema=z.object({colonyId:z.string().min(1),occurredAt:z.string().min(1),correlationId:z.string().min(1)});
export const setColonyCooldownInputSchema=z.object({colonyId:z.string().min(1),cooldownUntil:z.string().min(1).nullable(),occurredAt:z.string().min(1),correlationId:z.string().min(1)});
export const resetAttemptPeriodInputSchema=z.object({colonyId:z.string().min(1),periodKey:z.string().min(1),occurredAt:z.string().min(1),correlationId:z.string().min(1)});

const metricNumberSchema=z.discriminatedUnion('status',[
  z.object({status:z.literal('AVAILABLE'),value:z.number().finite(),reason:z.null()}),
  z.object({status:z.literal('UNAVAILABLE'),value:z.null(),reason:z.string().min(1)}),
]);
const analyticsDimensionsSchema=z.object({
  timeframes:z.array(z.string()),strategies:z.array(z.string()),combos:z.array(z.string()),templates:z.array(z.string()),tags:z.array(z.string()),
  session:z.string().nullable(),qualification:z.enum(['HUMAN_APPROVED','AUTOMATICALLY_QUALIFIED']).nullable(),entryHour:z.number().int().min(0).max(23),weekday:z.string(),direction:z.enum(['LONG','SHORT']),
});
export const positionAnalyticsViewSchema=z.object({
  positionId:z.string(),tradeId:z.string(),originalColonyId:z.string(),currentColonyId:z.string(),direction:z.enum(['LONG','SHORT']),currentState:z.string(),
  entryPrice:metricNumberSchema,realizedPips:metricNumberSchema,openPips:metricNumberSchema,positionPips:metricNumberSchema,protectedPips:metricNumberSchema,
  realizedMoney:metricNumberSchema,openMoney:metricNumberSchema,totalMoney:metricNumberSchema,reachedSurvivor:z.boolean(),reachedLeg:z.boolean(),isRunner:z.boolean(),legLifetimeMs:metricNumberSchema,
  dimensions:analyticsDimensionsSchema,ideaVersionId:z.string(),strategyMapVersionId:z.string().nullable(),
});
export const colonyAnalyticsMetricSchema=z.object({
  colonyId:z.string(),positionCount:z.number().int().nonnegative(),scoutCount:z.number().int().nonnegative(),attemptCount:z.number().int().nonnegative(),
  realizedPips:metricNumberSchema,openPips:metricNumberSchema,positionPips:metricNumberSchema,scoutingCost:metricNumberSchema,protectedPips:metricNumberSchema,
  averageScoutLoss:metricNumberSchema,survivorContribution:metricNumberSchema,longestLivedLegMs:metricNumberSchema,millipedeEfficiency:metricNumberSchema,
  wins:z.number().int().nonnegative(),losses:z.number().int().nonnegative(),breakevens:z.number().int().nonnegative(),incompleteOutcomes:z.number().int().nonnegative(),
});
const performanceGroupSchema=z.object({key:z.string(),dimension:z.string(),positions:z.number().int().nonnegative(),positionPips:metricNumberSchema,realizedPips:metricNumberSchema,wins:z.number().int().nonnegative(),losses:z.number().int().nonnegative(),breakevens:z.number().int().nonnegative()});
const performanceGroupResultSchema=z.object({groups:z.array(performanceGroupSchema),unavailableCount:z.number().int().nonnegative()});
export const analyticsWorkspaceSchema=z.object({
  asOf:z.string(),overall:colonyAnalyticsMetricSchema,money:z.object({realized:metricNumberSchema,open:metricNumberSchema,total:metricNumberSchema}),positions:z.array(positionAnalyticsViewSchema),
  colonies:z.array(z.object({colonyId:z.string(),label:z.string(),symbol:z.string(),ideaVersionId:z.string(),analytics:colonyAnalyticsMetricSchema,lineageColonyIds:z.array(z.string()),lineageAnalytics:colonyAnalyticsMetricSchema})),
  groups:z.object({TIMEFRAME:performanceGroupResultSchema,STRATEGY:performanceGroupResultSchema,COMBO:performanceGroupResultSchema,TEMPLATE:performanceGroupResultSchema,ENTRY_HOUR:performanceGroupResultSchema,WEEKDAY:performanceGroupResultSchema,SESSION:performanceGroupResultSchema,TAG:performanceGroupResultSchema,DIRECTION:performanceGroupResultSchema,QUALIFICATION:performanceGroupResultSchema}),
  curve:z.array(z.object({occurredAt:z.string(),positionId:z.string(),pips:z.number(),positionPips:z.number(),money:z.number().nullable()})),
  curves:z.object({balance:z.array(z.object({occurredAt:z.string(),positionId:z.string(),pips:z.number(),positionPips:z.number(),money:z.number().nullable()})),equity:z.array(z.object({occurredAt:z.string(),pips:z.number().nullable(),positionPips:z.number().nullable(),money:z.number().nullable()}))}),
});
export const reviewDissectionInputSchema=z.object({thesis:z.string().trim().min(1),decision:z.string().trim().min(1),management:z.string().trim().min(1),outcome:z.string().trim().min(1),lesson:z.string().trim().min(1)});
export const createPerformanceReviewInputSchema=z.object({sourceType:z.enum(['TRADE','COLONY']),sourceId:z.string().min(1),title:z.string().trim().min(1),dissection:reviewDissectionInputSchema,evidenceEventIds:z.array(z.string().min(1)).default([])});
export const revisePerformanceReviewInputSchema=z.object({reviewId:z.string().min(1),dissection:reviewDissectionInputSchema});
export const createLessonInputSchema=z.object({reviewId:z.string().min(1),statement:z.string().trim().min(1)});
export const advanceLessonInputSchema=z.object({lessonId:z.string().min(1),status:z.enum(['REPEATED_PATTERN','PLAYBOOK_RULE','MASTERED','ARCHIVED']),statement:z.string().trim().optional()});
export const createStrategyChangeProposalInputSchema=z.object({lessonId:z.string().min(1),strategyVersionId:z.string().min(1),proposedChange:z.string().trim().min(1),expectedEffect:z.string().trim().min(1),testRequirements:z.string().trim().min(1)});
export const acceptStrategyChangeProposalInputSchema=z.object({proposalId:z.string().min(1)});
const reviewEvidenceIntegritySchema=z.enum(['MISSING_EVENT','MISSING_ASSET','CAPTURE_FAILED','UNVERIFIED_ASSET','VERIFIED','MISSING','CORRUPT']);
const reviewEvidenceItemSchema=z.object({id:z.string(),integrity:reviewEvidenceIntegritySchema,event:z.record(z.string(),z.unknown()).nullable(),snapshots:z.array(z.record(z.string(),z.unknown()))});
export const performanceReviewViewSchema=z.object({id:z.string(),sourceType:z.enum(['TRADE','COLONY']),sourceId:z.string(),title:z.string(),ideaVersion:z.record(z.string(),z.unknown()),strategyMapVersion:z.record(z.string(),z.unknown()).nullable(),currentDissection:z.record(z.string(),z.unknown()).nullable(),dissectionVersions:z.array(z.record(z.string(),z.unknown())),evidence:z.array(reviewEvidenceItemSchema),createdAt:z.string()});
const lessonVersionViewSchema=z.object({id:z.string(),lessonId:z.string(),versionNo:z.number().int().positive(),status:z.enum(['OBSERVATION','REPEATED_PATTERN','PLAYBOOK_RULE','MASTERED','ARCHIVED']),statement:z.string(),createdAt:z.string(),supersedesId:z.string().nullable()});
export const lessonViewSchema=z.object({id:z.string(),currentVersion:lessonVersionViewSchema,versions:z.array(lessonVersionViewSchema),evidence:z.array(reviewEvidenceItemSchema),createdAt:z.string()});
export const strategyChangeProposalViewSchema=z.object({id:z.string(),lessonVersionId:z.string(),sourceStrategyVersionId:z.string(),proposedChange:z.string(),expectedEffect:z.string(),testRequirements:z.string(),status:z.enum(['PROPOSED','ACCEPTED','REJECTED']),resultingStrategyVersionId:z.string().nullable(),createdAt:z.string(),resolvedAt:z.string().nullable()});
export const performanceReviewWorkspaceSchema=z.object({reviews:z.array(performanceReviewViewSchema),lessons:z.array(lessonViewSchema),proposals:z.array(strategyChangeProposalViewSchema)});


export const ipcChannels = {
  getAppInfo: 'arise:get-app-info',
  createIdea: 'arise:create-idea',
  listIdeas: 'arise:list-ideas',
  getChartCatalog: 'arise:get-chart-catalog',
  listChartObjects: 'arise:list-chart-objects',
  createChartObject: 'arise:create-chart-object',
  reviseChartObject: 'arise:revise-chart-object',
  listPlanningIdeas: 'arise:list-planning-ideas',
  createPlanningIdea: 'arise:create-planning-idea',
  updatePlanningThesis: 'arise:update-planning-thesis',
  transitionPlanningIdea: 'arise:transition-planning-idea',
  getKnowledgeLibrary: 'arise:get-knowledge-library',
  getKnowledgeDocument: 'arise:get-knowledge-document',
  createKnowledgeDocument: 'arise:create-knowledge-document',
  saveKnowledgeDocument: 'arise:save-knowledge-document',
  createKnowledgeFolder: 'arise:create-knowledge-folder',
  moveKnowledgeDocument: 'arise:move-knowledge-document',
  getReviewWorkspace: 'arise:get-review-workspace',
  createReviewSchedule: 'arise:create-review-schedule',
  queueReviewNow: 'arise:queue-review-now',
  resolveMarketReview: 'arise:resolve-market-review',
  getStrategyWorkspace: 'arise:get-strategy-workspace',
  createStrategyDefinition: 'arise:create-strategy-definition',
  reviseStrategyDefinition: 'arise:revise-strategy-definition',
  createStrategyMap: 'arise:create-strategy-map',
  saveStrategyMap: 'arise:save-strategy-map',
  createStrategyRuntime: 'arise:create-strategy-runtime',
  simulateStrategyRuntimeEvent: 'arise:simulate-strategy-runtime-event',
  manualStrategyRuntimeDecision: 'arise:manual-strategy-runtime-decision',
  getEvidenceWorkspace: 'arise:get-evidence-workspace',
  regenerateEvidenceSnapshot: 'arise:regenerate-evidence-snapshot',
  getMt5Workspace: 'arise:get-mt5-workspace',
  classifyExternalPosition: 'arise:classify-external-position',
  reconcileMt5: 'arise:reconcile-mt5',
  getExecutionWorkspace:'arise:get-execution-workspace',
  executeActionProposal:'arise:execute-action-proposal',
  getProtectionWorkspace:'arise:get-protection-workspace',
  createProtectionRule:'arise:create-protection-rule',
  recordProtectionTrigger:'arise:record-protection-trigger',
  executeProtectionProposal:'arise:execute-protection-proposal',
  configureColonyAutomation:'arise:configure-colony-automation',
  invalidateColonyThesis:'arise:invalidate-colony-thesis',
  setColonyCooldown:'arise:set-colony-cooldown',
  resetAttemptPeriod:'arise:reset-attempt-period',
  getAnalyticsWorkspace:'arise:get-analytics-workspace',
  getPerformanceReviewWorkspace:'arise:get-performance-review-workspace',
  createPerformanceReview:'arise:create-performance-review',
  revisePerformanceReview:'arise:revise-performance-review',
  createLesson:'arise:create-lesson',
  advanceLesson:'arise:advance-lesson',
  createStrategyChangeProposal:'arise:create-strategy-change-proposal',
  acceptStrategyChangeProposal:'arise:accept-strategy-change-proposal',
} as const;

export interface AriseApi {
  getAppInfo(): Promise<AppInfo>;
  createIdea(input: CreateIdeaInput): Promise<z.infer<typeof createIdeaResultSchema>>;
  listIdeas(): Promise<z.infer<typeof listIdeasResultSchema>>;
  getChartCatalog(): Promise<z.infer<typeof chartCatalogSchema>>;
  listChartObjects(input: z.infer<typeof listChartObjectsInputSchema>): Promise<z.infer<typeof listChartObjectsResultSchema>>;
  createChartObject(input: z.infer<typeof createChartObjectInputSchema>): Promise<z.infer<typeof chartMarketObjectSchema>>;
  reviseChartObject(input: z.infer<typeof reviseChartObjectInputSchema>): Promise<z.infer<typeof chartMarketObjectSchema>>;
  listPlanningIdeas(): Promise<z.infer<typeof listPlanningIdeasResultSchema>>;
  createPlanningIdea(input: z.infer<typeof createPlanningIdeaInputSchema>): Promise<z.infer<typeof planningIdeaSchema>>;
  updatePlanningThesis(input: z.infer<typeof updatePlanningThesisInputSchema>): Promise<z.infer<typeof planningIdeaSchema>>;
  transitionPlanningIdea(input: z.infer<typeof transitionPlanningIdeaInputSchema>): Promise<z.infer<typeof planningIdeaSchema>>;
  getKnowledgeLibrary(): Promise<z.infer<typeof knowledgeLibrarySchema>>;
  getKnowledgeDocument(input: z.infer<typeof getKnowledgeDocumentInputSchema>): Promise<z.infer<typeof knowledgeDocumentDetailSchema>>;
  createKnowledgeDocument(input: z.infer<typeof createKnowledgeDocumentInputSchema>): Promise<z.infer<typeof knowledgeDocumentDetailSchema>>;
  saveKnowledgeDocument(input: z.infer<typeof saveKnowledgeDocumentInputSchema>): Promise<z.infer<typeof knowledgeDocumentDetailSchema>>;
  createKnowledgeFolder(input: z.infer<typeof createFolderInputSchema>): Promise<z.infer<typeof folderSchema>>;
  moveKnowledgeDocument(input: z.infer<typeof moveKnowledgeDocumentInputSchema>): Promise<z.infer<typeof knowledgeDocumentDetailSchema>>;
  getReviewWorkspace(): Promise<z.infer<typeof reviewWorkspaceSchema>>;
  createReviewSchedule(input: z.infer<typeof createReviewScheduleInputSchema>): Promise<z.infer<typeof reviewScheduleViewSchema>>;
  queueReviewNow(input: z.infer<typeof queueReviewNowInputSchema>): Promise<z.infer<typeof reviewQueueEntrySchema>>;
  resolveMarketReview(input: z.infer<typeof resolveMarketReviewInputSchema>): Promise<z.infer<typeof reviewQueueEntrySchema>>;
  getStrategyWorkspace(): Promise<z.infer<typeof strategyWorkspaceSchema>>;
  createStrategyDefinition(input: z.infer<typeof createStrategyDefinitionInputSchema>): Promise<z.infer<typeof strategyDefinitionViewSchema>>;
  reviseStrategyDefinition(input: z.infer<typeof reviseStrategyDefinitionInputSchema>): Promise<z.infer<typeof strategyDefinitionViewSchema>>;
  createStrategyMap(input: z.infer<typeof createStrategyMapInputSchema>): Promise<z.infer<typeof strategyMapViewSchema>>;
  saveStrategyMap(input: z.infer<typeof saveStrategyMapInputSchema>): Promise<z.infer<typeof strategyMapViewSchema>>;
  createStrategyRuntime(input: z.infer<typeof createStrategyRuntimeInputSchema>): Promise<z.infer<typeof strategyRuntimeViewSchema>>;
  simulateStrategyRuntimeEvent(input: z.infer<typeof simulateStrategyRuntimeEventInputSchema>): Promise<z.infer<typeof strategyRuntimeViewSchema>>;
  manualStrategyRuntimeDecision(input: z.infer<typeof manualStrategyRuntimeDecisionInputSchema>): Promise<z.infer<typeof strategyRuntimeViewSchema>>;
  getEvidenceWorkspace(): Promise<z.infer<typeof evidenceWorkspaceSchema>>;
  regenerateEvidenceSnapshot(input: z.infer<typeof regenerateEvidenceSnapshotInputSchema>): Promise<z.infer<typeof regenerateEvidenceSnapshotResultSchema>>;
  getMt5Workspace(): Promise<z.infer<typeof mt5WorkspaceSchema>>;
  classifyExternalPosition(input: z.infer<typeof classifyExternalPositionInputSchema>): Promise<z.infer<typeof mt5WorkspaceSchema>>;
  reconcileMt5(): Promise<z.infer<typeof mt5WorkspaceSchema>>;
  getExecutionWorkspace():Promise<z.infer<typeof executionWorkspaceSchema>>;
  executeActionProposal(input:z.infer<typeof executeActionProposalInputSchema>):Promise<z.infer<typeof executionWorkspaceSchema>>;
  getProtectionWorkspace():Promise<z.infer<typeof protectionWorkspaceSchema>>;
  createProtectionRule(input:z.infer<typeof createProtectionRuleInputSchema>):Promise<z.infer<typeof protectionWorkspaceSchema>>;
  recordProtectionTrigger(input:z.infer<typeof recordProtectionTriggerInputSchema>):Promise<z.infer<typeof protectionWorkspaceSchema>>;
  executeProtectionProposal(input:z.infer<typeof executeProtectionProposalInputSchema>):Promise<z.infer<typeof protectionWorkspaceSchema>>;
  configureColonyAutomation(input:z.infer<typeof configureColonyAutomationInputSchema>):Promise<z.infer<typeof protectionWorkspaceSchema>>;
  invalidateColonyThesis(input:z.infer<typeof invalidateColonyThesisInputSchema>):Promise<z.infer<typeof protectionWorkspaceSchema>>;
  setColonyCooldown(input:z.infer<typeof setColonyCooldownInputSchema>):Promise<z.infer<typeof protectionWorkspaceSchema>>;
  resetAttemptPeriod(input:z.infer<typeof resetAttemptPeriodInputSchema>):Promise<z.infer<typeof protectionWorkspaceSchema>>;
  getAnalyticsWorkspace():Promise<z.infer<typeof analyticsWorkspaceSchema>>;
  getPerformanceReviewWorkspace():Promise<z.infer<typeof performanceReviewWorkspaceSchema>>;
  createPerformanceReview(input:z.infer<typeof createPerformanceReviewInputSchema>):Promise<z.infer<typeof performanceReviewWorkspaceSchema>>;
  revisePerformanceReview(input:z.infer<typeof revisePerformanceReviewInputSchema>):Promise<z.infer<typeof performanceReviewWorkspaceSchema>>;
  createLesson(input:z.infer<typeof createLessonInputSchema>):Promise<z.infer<typeof performanceReviewWorkspaceSchema>>;
  advanceLesson(input:z.infer<typeof advanceLessonInputSchema>):Promise<z.infer<typeof performanceReviewWorkspaceSchema>>;
  createStrategyChangeProposal(input:z.infer<typeof createStrategyChangeProposalInputSchema>):Promise<z.infer<typeof performanceReviewWorkspaceSchema>>;
  acceptStrategyChangeProposal(input:z.infer<typeof acceptStrategyChangeProposalInputSchema>):Promise<z.infer<typeof performanceReviewWorkspaceSchema>>;
}
