/* eslint-disable @typescript-eslint/no-explicit-any -- M12 immutable JSON snapshots are validated by shared schemas at this IPC boundary. */
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { buildRuntimeEvidencePlans, type EvidenceRecordPlan } from '@arise/evidence';
import {
  createDraftIdea,
  createMarketObjectWithInitialVersion,
  entityId,
  reviseMarketObject,
  timestamp,
  type MarketObjectJson,
} from '@arise/domain';
import {
  createDefaultDetectorRegistry,
  createRuntime,
  maximumRuntimeMode,
  processRuntimeEvent,
  manualNodeDecision,
  runtimeEventId,
  runtimeNodeId,
  runtimeNodeEventId,
  detectorEvaluationId,
  decisionTraceId,
  strategyDefinitionId,
  strategyMapId,
  strategyMapVersionId,
  strategyRuntimeId,
  strategyVersionId,
  validateLogicGraph,
  type DetectorContractRef,
  type LogicGraph,
  type RuntimeIdFactory,
  type RuntimeMarketEvent,
  type StrategyVersion,
  type StrategyGraphNode,
} from '@arise/strategy-engine';
import {
  blockId,
  createFolder,
  documentId,
  documentVersionId,
  extractWikiLinks,
  folderId,
  type DocumentContent,
} from '@arise/documents';
import {
  createMarketReview,
  createReviewCycle,
  createReviewSchedule,
  marketReviewId,
  reviewCycleId,
  reviewScheduleId,
  reviewEventId,
} from '@arise/calendar';
import {
  DocumentRepository,
  IdeaRepository,
  InstrumentRepository,
  MarketObjectRepository,
  PlanningRepository,
  ReviewRepository,
  StrategyRepository,
  RuntimeRepository,
  EvidenceRepository,
  Mt5Repository,
  TimeframeRepository,
  AnalyticsReviewRepository,
} from '@arise/database';
import {
  appInfoSchema,
  chartCatalogSchema,
  chartMarketObjectSchema,
  createChartObjectInputSchema,
  createFolderInputSchema,
  createIdeaInputSchema,
  createIdeaResultSchema,
  createKnowledgeDocumentInputSchema,
  createPlanningIdeaInputSchema,
  createReviewScheduleInputSchema,
  folderSchema,
  getKnowledgeDocumentInputSchema,
  ipcChannels,
  knowledgeDocumentDetailSchema,
  knowledgeLibrarySchema,
  listChartObjectsInputSchema,
  listChartObjectsResultSchema,
  listIdeasResultSchema,
  listPlanningIdeasResultSchema,
  moveKnowledgeDocumentInputSchema,
  planningIdeaSchema,
  queueReviewNowInputSchema,
  resolveMarketReviewInputSchema,
  reviewQueueEntrySchema,
  reviewScheduleViewSchema,
  reviewWorkspaceSchema,
  reviseChartObjectInputSchema,
  saveKnowledgeDocumentInputSchema,
  transitionPlanningIdeaInputSchema,
  updatePlanningThesisInputSchema,
  createStrategyDefinitionInputSchema,
  reviseStrategyDefinitionInputSchema,
  createStrategyMapInputSchema,
  saveStrategyMapInputSchema,
  strategyDefinitionViewSchema,
  strategyMapViewSchema,
  strategyWorkspaceSchema,
  createStrategyRuntimeInputSchema,
  simulateStrategyRuntimeEventInputSchema,
  manualStrategyRuntimeDecisionInputSchema,
  strategyRuntimeViewSchema,
  evidenceWorkspaceSchema,
  regenerateEvidenceSnapshotInputSchema,
  regenerateEvidenceSnapshotResultSchema,
  classifyExternalPositionInputSchema,
  mt5WorkspaceSchema,
  executionWorkspaceSchema,
  protectionWorkspaceSchema,
  createProtectionRuleInputSchema,
  recordProtectionTriggerInputSchema,
  executeProtectionProposalInputSchema,
  configureColonyAutomationInputSchema,
  invalidateColonyThesisInputSchema,
  setColonyCooldownInputSchema,
  resetAttemptPeriodInputSchema,
  executeActionProposalInputSchema,
  analyticsWorkspaceSchema,
  performanceReviewWorkspaceSchema,
  createPerformanceReviewInputSchema,
  revisePerformanceReviewInputSchema,
  createLessonInputSchema,
  advanceLessonInputSchema,
  createStrategyChangeProposalInputSchema,
  acceptStrategyChangeProposalInputSchema,
} from '@arise/shared';
import { chartInstrumentBySymbol, chartTimeframeByCode } from './chart-catalog.js';
import type { EvidenceCaptureCoordinator } from './evidence-capture.js';
import type { Mt5ReadOnlyClient } from './mt5-client.js';
import type { ExecutionGateway } from './execution-gateway.js';
import type { ProtectionGateway } from './protection-gateway.js';

function currentMarketObjectView(
  objectRepository: MarketObjectRepository,
  instrumentRepository: InstrumentRepository,
  timeframeRepository: TimeframeRepository,
  marketObjectId: string,
) {
  const aggregate = objectRepository.reconstruct(entityId('MarketObject', marketObjectId));
  if (!aggregate) throw new Error(`Market Object ${marketObjectId} not found`);
  const current = aggregate.versions.find((version) => version.id === aggregate.marketObject.currentVersionId);
  if (!current) throw new Error(`Market Object ${marketObjectId} current version is missing`);
  const instrument = instrumentRepository.findById(aggregate.marketObject.instrumentId);
  const timeframe = aggregate.marketObject.timeframeId === null ? null : timeframeRepository.findById(aggregate.marketObject.timeframeId);
  if (!instrument) throw new Error(`Market Object ${marketObjectId} instrument is missing`);
  return chartMarketObjectSchema.parse({
    id: aggregate.marketObject.id, versionId: current.id, versionNo: current.versionNo,
    symbol: instrument.canonicalSymbol, geometryType: current.geometryType, semanticType: current.semanticType,
    role: current.role, timeframe: timeframe?.code ?? null, name: current.name,
    geometryJson: current.geometryJson, semanticPropertiesJson: current.semanticPropertiesJson, createdAt: current.createdAt,
  });
}

function toDocumentContent(blocksValue: readonly { readonly id: string; readonly type: DocumentContent['blocks'][number]['type']; readonly text: string; readonly checked?: boolean | undefined }[]): DocumentContent {
  return {
    blocks: blocksValue.map((entry) => Object.freeze({
      id: blockId(entry.id),
      type: entry.type,
      text: entry.text,
      ...(entry.checked === undefined ? {} : { checked: entry.checked }),
    })),
  };
}

function knowledgeDetail(repository: DocumentRepository, documentIdValue: string) {
  const aggregate = repository.reconstruct(documentId(documentIdValue));
  if (!aggregate) throw new Error(`Document ${documentIdValue} not found`);
  const wikiLinks = extractWikiLinks(aggregate.currentVersion.content);
  const docsByTitle = new Map(repository.list().map((doc) => [doc.title.trim().toLowerCase(), doc]));
  const backlinks: { documentId: string; title: string; label: string }[] = [];
  for (const source of repository.list()) {
    if (source.id === aggregate.document.id) continue;
    const sourceVersion = repository.currentVersion(source.id);
    if (!sourceVersion) continue;
    for (const link of extractWikiLinks(sourceVersion.content)) {
      const target = docsByTitle.get(link.label.toLowerCase());
      if (target?.id === aggregate.document.id) backlinks.push({ documentId: source.id, title: source.title, label: link.label });
    }
  }
  return knowledgeDocumentDetailSchema.parse({
    id: aggregate.document.id,
    documentType: aggregate.document.documentType,
    title: aggregate.document.title,
    primaryFolderId: aggregate.document.primaryFolderId,
    linkedEntityType: aggregate.document.linkedEntityType,
    linkedEntityId: aggregate.document.linkedEntityId,
    currentVersionId: aggregate.currentVersion.id,
    versionNo: aggregate.currentVersion.versionNo,
    updatedAt: aggregate.currentVersion.createdAt,
    blocks: aggregate.currentVersion.content.blocks,
    wikiLinks: wikiLinks.map((link) => link.label),
    backlinks,
  });
}


function strategyDefinitionView(aggregate: ReturnType<StrategyRepository['reconstructDefinition']>) {
  if (!aggregate) throw new Error('Strategy definition missing');
  const version = aggregate.currentVersion;
  return strategyDefinitionViewSchema.parse({
    definitionId: aggregate.definition.id, versionId: version.id, versionNo: version.versionNo,
    name: version.name, category: version.category, description: version.description, tags: version.tags,
    automationCapability: version.automationCapability, deploymentStatus: version.deploymentStatus, detector: version.detector, createdAt: version.createdAt,
  });
}

function strategyMapView(aggregate: ReturnType<StrategyRepository['reconstructMap']>) {
  if (!aggregate) throw new Error('Strategy Map missing');
  const version = aggregate.currentVersion;
  return strategyMapViewSchema.parse({
    mapId: aggregate.map.id, versionId: version.id, versionNo: version.versionNo, kind: aggregate.map.kind,
    name: aggregate.map.name, graph: version.graph, createdAt: version.createdAt,
  });
}

function toLogicGraph(input: ReturnType<typeof createStrategyMapInputSchema.parse>['graph']): LogicGraph {
  return validateLogicGraph(JSON.parse(JSON.stringify(input)) as LogicGraph);
}


export function registerIpcHandlers(params: {
  ideaRepository: IdeaRepository;
  instrumentRepository?: InstrumentRepository;
  timeframeRepository?: TimeframeRepository;
  marketObjectRepository?: MarketObjectRepository;
  planningRepository?: PlanningRepository;
  documentRepository?: DocumentRepository;
  reviewRepository?: ReviewRepository;
  strategyRepository?: StrategyRepository;
  runtimeRepository?: RuntimeRepository;
  evidenceRepository?: EvidenceRepository;
  evidenceCapture?: EvidenceCaptureCoordinator;
  mt5Repository?: Mt5Repository;
  mt5Client?: Mt5ReadOnlyClient;
  executionGateway?:ExecutionGateway;
  protectionGateway?:ProtectionGateway;
  analyticsReviewRepository?:AnalyticsReviewRepository;
  version: string;
  buildCommit: string;
  buildDate: string;
  databaseSchemaVersion: number;
  mt5ProtocolVersion: number;
  dataDirectory: string;
  logsDirectory: string;
  databasePath: string;
  packaged: boolean;
}) {
  ipcMain.handle(ipcChannels.getAppInfo, () => appInfoSchema.parse({
    name: 'ARISE',
    version: params.version,
    buildCommit: params.buildCommit,
    buildDate: params.buildDate,
    databaseSchemaVersion: params.databaseSchemaVersion,
    mt5ProtocolVersion: params.mt5ProtocolVersion,
    dataDirectory: params.dataDirectory,
    logsDirectory: params.logsDirectory,
    databasePath: params.databasePath,
    packaged: params.packaged,
    databaseReady: true,
  }));
  if (params.mt5Repository && params.mt5Client) {
    ipcMain.handle(ipcChannels.getMt5Workspace, () => mt5WorkspaceSchema.parse(params.mt5Repository!.workspace()));
    ipcMain.handle(ipcChannels.classifyExternalPosition, (_event, rawInput) => params.mt5Repository!.classify(classifyExternalPositionInputSchema.parse(rawInput)));
    ipcMain.handle(ipcChannels.reconcileMt5, () => params.mt5Client!.requestReconciliation());
  }
  if(params.executionGateway){ipcMain.handle(ipcChannels.getExecutionWorkspace,()=>executionWorkspaceSchema.parse(params.executionGateway!.workspace()));ipcMain.handle(ipcChannels.executeActionProposal,(_event,rawInput)=>{const input=executeActionProposalInputSchema.parse(rawInput);return executionWorkspaceSchema.parse(params.executionGateway!.executeProposal(input.proposalCorrelationId));});}
  if(params.protectionGateway){
    const workspace=()=>protectionWorkspaceSchema.parse(params.protectionGateway!.workspace());
    ipcMain.handle(ipcChannels.getProtectionWorkspace,workspace);
    ipcMain.handle(ipcChannels.createProtectionRule,(_event,rawInput)=>{
      const input=createProtectionRuleInputSchema.parse(rawInput);
      return protectionWorkspaceSchema.parse(params.protectionGateway!.createRule({...input,allowWorsening:false}));
    });
    ipcMain.handle(ipcChannels.recordProtectionTrigger,(_event,rawInput)=>protectionWorkspaceSchema.parse(params.protectionGateway!.recordTrigger(recordProtectionTriggerInputSchema.parse(rawInput))));
    ipcMain.handle(ipcChannels.executeProtectionProposal,(_event,rawInput)=>{
      const input=executeProtectionProposalInputSchema.parse(rawInput);
      return protectionWorkspaceSchema.parse(params.protectionGateway!.executeProposal(input.proposal,input.mode));
    });
    ipcMain.handle(ipcChannels.configureColonyAutomation,(_event,rawInput)=>{const input=configureColonyAutomationInputSchema.parse(rawInput);return protectionWorkspaceSchema.parse(params.protectionGateway!.configureColony({...input,invalidationPolicy:input.invalidationPolicy??'MANUAL_DECISION'}));});
    ipcMain.handle(ipcChannels.invalidateColonyThesis,(_event,rawInput)=>{const input=invalidateColonyThesisInputSchema.parse(rawInput);return protectionWorkspaceSchema.parse(params.protectionGateway!.invalidateThesis(input.colonyId,input.occurredAt,input.correlationId));});
    ipcMain.handle(ipcChannels.setColonyCooldown,(_event,rawInput)=>{const input=setColonyCooldownInputSchema.parse(rawInput);return protectionWorkspaceSchema.parse(params.protectionGateway!.setCooldown(input.colonyId,input.cooldownUntil,input.occurredAt,input.correlationId));});
    ipcMain.handle(ipcChannels.resetAttemptPeriod,(_event,rawInput)=>{const input=resetAttemptPeriodInputSchema.parse(rawInput);return protectionWorkspaceSchema.parse(params.protectionGateway!.resetAttemptPeriod(input.colonyId,input.periodKey,input.occurredAt,input.correlationId));});
  }
  if(params.analyticsReviewRepository){
    const repository=params.analyticsReviewRepository;
    const reviewWorkspace=async()=>{
      const raw=repository.reviewWorkspace() as {reviews:any[];lessons:any[];proposals:any[]};
      const enrich=async(item:any)=>{
        const evidence=await Promise.all((item.evidence??[]).map(async(record:any)=>{
          if(record.integrity!=='UNVERIFIED_ASSET'||!params.evidenceCapture)return record;
          const original=record.snapshots.find((snapshot:any)=>snapshot.captureOrigin!=='REGENERATED_VIEW')??record.snapshots[0];
          if(!original)return {...record,integrity:'MISSING_ASSET'};
          const integrity=await params.evidenceCapture.assets.verify(original.imagePath,original.imageHash);
          return {...record,integrity};
        }));
        return {...item,evidence};
      };
      return performanceReviewWorkspaceSchema.parse({reviews:await Promise.all(raw.reviews.map(enrich)),lessons:await Promise.all(raw.lessons.map(enrich)),proposals:raw.proposals});
    };
    ipcMain.handle(ipcChannels.getAnalyticsWorkspace,()=>analyticsWorkspaceSchema.parse(repository.analyticsWorkspace()));
    ipcMain.handle(ipcChannels.getPerformanceReviewWorkspace,reviewWorkspace);
    ipcMain.handle(ipcChannels.createPerformanceReview,async(_event,rawInput)=>{
      const input=createPerformanceReviewInputSchema.parse(rawInput);const createdAt=new Date().toISOString();
      repository.createReview({id:randomUUID(),dissectionVersionId:randomUUID(),...input,createdAt});return reviewWorkspace();
    });
    ipcMain.handle(ipcChannels.revisePerformanceReview,async(_event,rawInput)=>{
      const input=revisePerformanceReviewInputSchema.parse(rawInput);repository.reviseReview({reviewId:input.reviewId,versionId:randomUUID(),dissection:input.dissection,createdAt:new Date().toISOString()});return reviewWorkspace();
    });
    ipcMain.handle(ipcChannels.createLesson,async(_event,rawInput)=>{
      const input=createLessonInputSchema.parse(rawInput);repository.createLesson({id:randomUUID(),versionId:randomUUID(),reviewId:input.reviewId,statement:input.statement,createdAt:new Date().toISOString()});return reviewWorkspace();
    });
    ipcMain.handle(ipcChannels.advanceLesson,async(_event,rawInput)=>{
      const input=advanceLessonInputSchema.parse(rawInput);repository.advanceLesson({lessonId:input.lessonId,versionId:randomUUID(),status:input.status,...(input.statement===undefined?{}:{statement:input.statement}),createdAt:new Date().toISOString()});return reviewWorkspace();
    });
    ipcMain.handle(ipcChannels.createStrategyChangeProposal,async(_event,rawInput)=>{
      const input=createStrategyChangeProposalInputSchema.parse(rawInput);repository.proposePlaybookUpdate({id:randomUUID(),...input,createdAt:new Date().toISOString()});return reviewWorkspace();
    });
    ipcMain.handle(ipcChannels.acceptStrategyChangeProposal,async(_event,rawInput)=>{
      const input=acceptStrategyChangeProposalInputSchema.parse(rawInput);repository.acceptPlaybookUpdate({proposalId:input.proposalId,resultingStrategyVersionId:randomUUID(),occurredAt:new Date().toISOString()});return reviewWorkspace();
    });
  }

  ipcMain.handle(ipcChannels.createIdea, async (_event, rawInput) => {
    const input = createIdeaInputSchema.parse(rawInput);
    const idea = createDraftIdea({ id: randomUUID(), instrumentId: input.instrumentId, thesisTimeframe: input.timeframe, direction: input.direction });
    await params.ideaRepository.insert(idea);
    return createIdeaResultSchema.parse({ ideaId: idea.id });
  });
  ipcMain.handle(ipcChannels.listIdeas, async () => {
    const rows = await params.ideaRepository.list();
    return listIdeasResultSchema.parse(rows.map((idea) => ({ ideaId: idea.id, instrumentId: idea.instrumentId, timeframe: idea.thesisTimeframe, direction: idea.direction })));
  });

  if (!params.instrumentRepository || !params.timeframeRepository || !params.marketObjectRepository) return;
  const instrumentRepository = params.instrumentRepository;
  const timeframeRepository = params.timeframeRepository;
  const marketObjectRepository = params.marketObjectRepository;

  if (params.evidenceRepository && params.evidenceCapture) {
    const evidenceRepository = params.evidenceRepository;
    const evidenceCapture = params.evidenceCapture;
    const workspace = async () => {
      const events = await Promise.all(evidenceRepository.list().map(async (aggregate) => {
        const snapshots = await Promise.all(aggregate.snapshots.map(async (snapshot) => {
          const integrity = await evidenceCapture.assets.verify(snapshot.imagePath, snapshot.imageHash);
          const imageDataUrl = integrity === 'VERIFIED' ? `data:image/png;base64,${Buffer.from(await evidenceCapture.assets.read(snapshot.imagePath)).toString('base64')}` : null;
          return { id: snapshot.id, imagePath: snapshot.imagePath, imageHash: snapshot.imageHash, capturedAt: snapshot.capturedAt, captureOrigin: snapshot.captureOrigin, assetIntegrity: integrity, imageDataUrl };
        }));
        const failedAttempts = aggregate.captureAttempts.filter((attempt) => attempt.status === 'FAILED').length;
        const trace = aggregate.plan.event.strategyRuntimeId && aggregate.plan.event.decisionTraceId && params.runtimeRepository
          ? params.runtimeRepository.traces(strategyRuntimeId(aggregate.plan.event.strategyRuntimeId)).find((item) => item.id === aggregate.plan.event.decisionTraceId) ?? null
          : null;
        return {
          ...aggregate.plan.event,
          decisionTrace: trace,
          captureState: snapshots.length ? 'CAPTURED' as const : failedAttempts >= 2 ? 'CAPTURE_FAILED' as const : 'PENDING' as const,
          workspaceState: aggregate.plan.workspaceState,
          references: aggregate.plan.references.map((reference) => ({ id: reference.id, entityType: reference.entityType, entityId: reference.entityId, entityVersionId: reference.entityVersionId, relationType: reference.relationType })),
          snapshots,
        };
      }));
      return evidenceWorkspaceSchema.parse({ events, stageSummaries: evidenceRepository.listStageSummaries(), captureQueueDepth: evidenceCapture.queue.size, executionAvailable: false });
    };
    ipcMain.handle(ipcChannels.getEvidenceWorkspace, workspace);
    ipcMain.handle(ipcChannels.regenerateEvidenceSnapshot, (_ipcEvent, rawInput) => {
      const input = regenerateEvidenceSnapshotInputSchema.parse(rawInput);
      const aggregate = evidenceRepository.find(input.evidenceEventId);
      if (!aggregate) throw new Error(`EvidenceEvent ${input.evidenceEventId} not found`);
      evidenceCapture.enqueue([aggregate.plan], 'REGENERATED_VIEW');
      return regenerateEvidenceSnapshotResultSchema.parse({ accepted: true, evidenceEventId: input.evidenceEventId, captureOrigin: 'REGENERATED_VIEW' });
    });
  }

  ipcMain.handle(ipcChannels.getChartCatalog, () => chartCatalogSchema.parse({
    instruments: instrumentRepository.list().filter((entry) => entry.enabled).map((entry) => ({ instrumentId: entry.id, symbol: entry.canonicalSymbol, displayName: entry.displayName, priceDigits: entry.priceDigits, pipSize: entry.pipSize, tickSize: entry.tickSize })),
    timeframes: timeframeRepository.list().map((entry) => ({ timeframeId: entry.id, code: entry.code })),
  }));

  ipcMain.handle(ipcChannels.listChartObjects, (_event, rawInput) => {
    const input = listChartObjectsInputSchema.parse(rawInput);
    const instrument = chartInstrumentBySymbol(instrumentRepository, input.symbol);
    if (!instrument) return listChartObjectsResultSchema.parse([]);
    return listChartObjectsResultSchema.parse(marketObjectRepository.listByInstrument(instrument.id).map((entry) => currentMarketObjectView(marketObjectRepository, instrumentRepository, timeframeRepository, entry.id)));
  });
  ipcMain.handle(ipcChannels.createChartObject, (_event, rawInput) => {
    const input = createChartObjectInputSchema.parse(rawInput);
    const instrument = chartInstrumentBySymbol(instrumentRepository, input.symbol);
    if (!instrument) throw new Error(`Unknown chart instrument ${input.symbol}`);
    const timeframe = input.timeframe === null ? null : chartTimeframeByCode(timeframeRepository, input.timeframe);
    if (input.timeframe !== null && !timeframe) throw new Error(`Unknown chart timeframe ${input.timeframe}`);
    const now = timestamp(new Date().toISOString());
    const record = createMarketObjectWithInitialVersion({
      id: entityId('MarketObject', randomUUID()), instrumentId: instrument.id, ownerType: 'INSTRUMENT_MASTER_CHART', ownerId: instrument.id,
      geometryType: input.geometryType, semanticType: input.semanticType, role: input.role, timeframeId: timeframe?.id ?? null,
      name: input.name, createdAt: now, archivedAt: null, versionId: entityId('MarketObjectVersion', randomUUID()),
      geometryJson: input.geometryJson as MarketObjectJson, semanticPropertiesJson: (input.semanticPropertiesJson ?? {}) as MarketObjectJson, sourceCandleIds: [],
    });
    marketObjectRepository.insertInitial(record);
    return currentMarketObjectView(marketObjectRepository, instrumentRepository, timeframeRepository, record.marketObject.id);
  });
  ipcMain.handle(ipcChannels.reviseChartObject, (_event, rawInput) => {
    const input = reviseChartObjectInputSchema.parse(rawInput);
    const marketObjectId = entityId('MarketObject', input.marketObjectId);
    const aggregate = marketObjectRepository.reconstruct(marketObjectId);
    if (!aggregate) throw new Error(`Market Object ${input.marketObjectId} not found`);
    const current = aggregate.versions.find((version) => version.id === aggregate.marketObject.currentVersionId);
    if (!current) throw new Error(`Market Object ${input.marketObjectId} current version is missing`);
    const revised = reviseMarketObject(aggregate.marketObject, current, { id: entityId('MarketObjectVersion', randomUUID()), createdAt: timestamp(new Date().toISOString()), geometryJson: input.geometryJson as MarketObjectJson });
    marketObjectRepository.appendRevision(revised);
    return currentMarketObjectView(marketObjectRepository, instrumentRepository, timeframeRepository, marketObjectId);
  });

  if (params.planningRepository) {
    const planningRepository = params.planningRepository;
    ipcMain.handle(ipcChannels.listPlanningIdeas, () => listPlanningIdeasResultSchema.parse(planningRepository.list()));
    ipcMain.handle(ipcChannels.createPlanningIdea, (_event, rawInput) => {
      const input = createPlanningIdeaInputSchema.parse(rawInput);
      const instrument = chartInstrumentBySymbol(instrumentRepository, input.symbol);
      const timeframe = chartTimeframeByCode(timeframeRepository, input.timeframe);
      if (!instrument) throw new Error(`Unknown instrument ${input.symbol}`);
      if (!timeframe) throw new Error(`Unknown timeframe ${input.timeframe}`);
      const count = planningRepository.list().filter((idea) => idea.symbol === input.symbol && idea.timeframe === input.timeframe).length + 1;
      const label = `${input.symbol} · ${input.timeframe} ${input.direction} #${String(count).padStart(2, '0')}`;
      const createdAt = new Date().toISOString();
      return planningIdeaSchema.parse(planningRepository.create({
        ideaId: randomUUID(), ideaVersionId: randomUUID(), colonyId: randomUUID(), documentId: randomUUID(), documentVersionId: randomUUID(), blockId: randomUUID(), entityLinkId: randomUUID(),
        instrumentId: instrument.id, timeframeId: timeframe.id, direction: input.direction, thesisText: input.thesisText,
        targetDescription: input.targetDescription, invalidationDescription: input.invalidationDescription,
        primaryTargetMarketObjectVersionId: input.primaryTargetMarketObjectVersionId,
        invalidationMarketObjectVersionId: input.invalidationMarketObjectVersionId,
        colonyLabel: label, createdAt,
      }));
    });
    ipcMain.handle(ipcChannels.updatePlanningThesis, (_event, rawInput) => {
      const input = updatePlanningThesisInputSchema.parse(rawInput);
      return planningIdeaSchema.parse(planningRepository.updateThesis({
        ideaId: input.ideaId, ideaVersionId: randomUUID(), documentVersionId: randomUUID(), entityLinkId: randomUUID(),
        direction: input.direction, thesisText: input.thesisText, targetDescription: input.targetDescription,
        invalidationDescription: input.invalidationDescription, primaryTargetMarketObjectVersionId: input.primaryTargetMarketObjectVersionId,
        invalidationMarketObjectVersionId: input.invalidationMarketObjectVersionId,
        thesisBlocks: toDocumentContent(input.thesisBlocks), createdAt: new Date().toISOString(),
      }));
    });
    ipcMain.handle(ipcChannels.transitionPlanningIdea, (_event, rawInput) => {
      const input = transitionPlanningIdeaInputSchema.parse(rawInput);
      return planningIdeaSchema.parse(planningRepository.transitionStatus(input.ideaId, input.to, new Date().toISOString()));
    });
  }

  if (params.documentRepository) {
    const documentRepository = params.documentRepository;
    ipcMain.handle(ipcChannels.getKnowledgeLibrary, () => knowledgeLibrarySchema.parse({
      folders: documentRepository.listFolders(),
      documents: documentRepository.list().map((doc) => {
        const version = documentRepository.currentVersion(doc.id);
        if (!version) throw new Error(`Document ${doc.id} has no current version`);
        return { id: doc.id, documentType: doc.documentType, title: doc.title, primaryFolderId: doc.primaryFolderId, linkedEntityType: doc.linkedEntityType, linkedEntityId: doc.linkedEntityId, versionNo: version.versionNo, updatedAt: version.createdAt };
      }),
    }));
    ipcMain.handle(ipcChannels.getKnowledgeDocument, (_event, rawInput) => {
      const input = getKnowledgeDocumentInputSchema.parse(rawInput);
      return knowledgeDetail(documentRepository, input.documentId);
    });
    ipcMain.handle(ipcChannels.createKnowledgeDocument, (_event, rawInput) => {
      const input = createKnowledgeDocumentInputSchema.parse(rawInput);
      const now = new Date().toISOString();
      const aggregate = documentRepository.create({
        document: { id: documentId(randomUUID()), documentType: input.documentType, title: input.title, primaryFolderId: input.primaryFolderId === null ? null : folderId(input.primaryFolderId), linkedEntityType: null, linkedEntityId: null, createdAt: now },
        versionId: documentVersionId(randomUUID()),
        content: { blocks: [{ id: blockId(randomUUID()), type: 'PARAGRAPH', text: input.text }] },
      });
      return knowledgeDetail(documentRepository, aggregate.document.id);
    });
    ipcMain.handle(ipcChannels.saveKnowledgeDocument, (_event, rawInput) => {
      const input = saveKnowledgeDocumentInputSchema.parse(rawInput);
      documentRepository.appendVersion(documentId(input.documentId), { id: documentVersionId(randomUUID()), content: toDocumentContent(input.blocks), createdAt: new Date().toISOString() });
      return knowledgeDetail(documentRepository, input.documentId);
    });
    ipcMain.handle(ipcChannels.createKnowledgeFolder, (_event, rawInput) => {
      const input = createFolderInputSchema.parse(rawInput);
      const value = createFolder({ id: folderId(randomUUID()), name: input.name, parentFolderId: input.parentFolderId === null ? null : folderId(input.parentFolderId), sortOrder: documentRepository.listFolders().length, createdAt: new Date().toISOString() });
      return folderSchema.parse(documentRepository.insertFolder(value));
    });
    ipcMain.handle(ipcChannels.moveKnowledgeDocument, (_event, rawInput) => {
      const input = moveKnowledgeDocumentInputSchema.parse(rawInput);
      documentRepository.setPrimaryFolder(documentId(input.documentId), input.folderId === null ? null : folderId(input.folderId));
      return knowledgeDetail(documentRepository, input.documentId);
    });
  }

  if (params.reviewRepository) {
    const reviewRepository = params.reviewRepository;
    const scheduleView = (schedule: ReturnType<ReviewRepository['findSchedule']>) => {
      if (!schedule) throw new Error('Review schedule missing');
      const instrument = instrumentRepository.findById(entityId('Instrument', schedule.instrumentScopeId));
      const timeframe = timeframeRepository.findById(entityId('Timeframe', schedule.timeframeId));
      if (!instrument || !timeframe) throw new Error('Review schedule scope missing');
      return reviewScheduleViewSchema.parse({ id: schedule.id, name: schedule.name, symbol: instrument.canonicalSymbol, instrumentId: instrument.id, timeframe: timeframe.code, timeframeId: timeframe.id, frequencyType: schedule.frequencyType, frequencyValue: schedule.frequencyValue, enabled: schedule.enabled, createdAt: schedule.createdAt, automaticTimingAvailable: false });
    };
    const queueView = (entry: ReturnType<ReviewRepository['resolve']>) => {
      const schedule = scheduleView(entry.schedule);
      return reviewQueueEntrySchema.parse({ reviewId: entry.review.id, cycleId: entry.cycle.id, scheduleId: entry.schedule.id, scheduleName: entry.schedule.name, symbol: schedule.symbol, timeframe: schedule.timeframe, dueAt: entry.cycle.dueAt, status: entry.review.status, direction: entry.review.direction, previousReviewId: entry.review.previousReviewId, ideaVersionId: entry.review.ideaVersionId, notesDocumentId: entry.review.notesDocumentId, reviewedAt: entry.review.reviewedAt });
    };
    const workspace = () => reviewWorkspaceSchema.parse({ schedules: reviewRepository.listSchedules().map(scheduleView), queue: reviewRepository.listQueue().map(queueView), automaticTimingAvailable: false });
    ipcMain.handle(ipcChannels.getReviewWorkspace, workspace);
    ipcMain.handle(ipcChannels.createReviewSchedule, (_event, rawInput) => {
      const input = createReviewScheduleInputSchema.parse(rawInput);
      const instrument = chartInstrumentBySymbol(instrumentRepository, input.symbol);
      const timeframe = chartTimeframeByCode(timeframeRepository, input.timeframe);
      if (!instrument || !timeframe) throw new Error('Unknown review scope');
      const schedule = createReviewSchedule({ id: reviewScheduleId(randomUUID()), name: `${input.symbol} · ${input.timeframe}`, timeframeId: timeframe.id, instrumentScopeType: 'INSTRUMENT', instrumentScopeId: instrument.id, frequencyType: input.frequencyType, frequencyValue: input.frequencyType === 'EVERY_2_CANDLES' ? 2 : input.frequencyType === 'EVERY_3_CANDLES' ? 3 : 1, notificationPolicyId: null, enabled: true, createdAt: new Date().toISOString() });
      return scheduleView(reviewRepository.insertSchedule(schedule));
    });
    ipcMain.handle(ipcChannels.queueReviewNow, (_event, rawInput) => {
      const input = queueReviewNowInputSchema.parse(rawInput);
      const schedule = reviewRepository.findSchedule(reviewScheduleId(input.scheduleId));
      if (!schedule) throw new Error(`Review schedule ${input.scheduleId} not found`);
      const now = new Date().toISOString();
      const previous = reviewRepository.previousCompleted(schedule.instrumentScopeId, schedule.timeframeId);
      const cycle = createReviewCycle({ id: reviewCycleId(randomUUID()), reviewScheduleId: schedule.id, dueAt: now, candleId: null, status: 'DUE', createdAt: now });
      const review = createMarketReview({ id: marketReviewId(randomUUID()), reviewCycleId: cycle.id, instrumentId: schedule.instrumentScopeId, timeframeId: schedule.timeframeId, status: 'DUE', previousReviewId: previous?.id ?? null, ideaVersionId: previous?.ideaVersionId ?? null, direction: 'UNCHANGED', notesDocumentId: null, reviewedAt: null });
      return queueView(reviewRepository.enqueue({ cycle, review }));
    });
    ipcMain.handle(ipcChannels.resolveMarketReview, (_event, rawInput) => {
      const input = resolveMarketReviewInputSchema.parse(rawInput);
      let notesDocumentId: string | null = null;
      if (input.notes.trim() && params.documentRepository) {
        const now = new Date().toISOString();
        const aggregate = params.documentRepository.create({
          document: { id: documentId(randomUUID()), documentType: 'MARKET_REVIEW', title: 'Market Review Notes', primaryFolderId: null, linkedEntityType: 'MARKET_REVIEW', linkedEntityId: input.reviewId, createdAt: now },
          versionId: documentVersionId(randomUUID()), content: { blocks: [{ id: blockId(randomUUID()), type: 'PARAGRAPH', text: input.notes }] },
        });
        notesDocumentId = aggregate.document.id;
      }
      const current = reviewRepository.listQueue().find((entry) => entry.review.id === input.reviewId);
      if (!current) throw new Error(`Review ${input.reviewId} not found`);
      let ideaVersionId = current.review.ideaVersionId;
      if (params.planningRepository) {
        const scope = scheduleView(current.schedule);
        const active = params.planningRepository.list().find((idea) => idea.symbol === scope.symbol && idea.timeframe === scope.timeframe && !['COMPLETED','INVALIDATED','CANCELLED','ARCHIVED'].includes(idea.status));
        if (active) ideaVersionId = active.ideaVersionId;
      }
      return queueView(reviewRepository.resolve(marketReviewId(input.reviewId), { status: input.status, direction: input.direction, reviewedAt: new Date().toISOString(), notesDocumentId, ideaVersionId, eventId: reviewEventId(randomUUID()), reason: input.status === 'COMPLETED' ? 'Completed in Market Review workspace' : `${input.status} in Market Review workspace` }));
    });
  }

  if (params.strategyRepository) {
    const strategyRepository = params.strategyRepository;
    const runtimeRepository = params.runtimeRepository;
    const planningRepository = params.planningRepository;
    const detectorRegistry = createDefaultDetectorRegistry();
    const runtimeIds = (): RuntimeIdFactory => ({
      runtimeNode: (graphNodeId) => runtimeNodeId(`rn-${randomUUID()}-${graphNodeId}`),
      runtimeNodeEvent: () => runtimeNodeEventId(`rne-${randomUUID()}`),
      detectorEvaluation: () => detectorEvaluationId(`de-${randomUUID()}`),
      decisionTrace: () => decisionTraceId(`dt-${randomUUID()}`),
    });
    const strategyVersions = (): Map<string, StrategyVersion> => new Map(
      strategyRepository.listDefinitions().flatMap((aggregate) => aggregate.versions).map((version) => [version.id, version]),
    );
    const findMapVersion = (versionId: string) => {
      for (const aggregate of strategyRepository.listMaps()) {
        const version = aggregate.versions.find((candidate) => candidate.id === versionId);
        if (version) return { aggregate, version };
      }
      return null;
    };
    const runtimeView = (snapshot: NonNullable<ReturnType<RuntimeRepository['reconstruct']>>) => {
      if (!runtimeRepository) throw new Error('Strategy Runtime persistence unavailable');
      const mapMatch = findMapVersion(snapshot.runtime.strategyMapVersionId);
      if (!mapMatch) throw new Error(`StrategyMapVersion ${snapshot.runtime.strategyMapVersionId} missing`);
      const colony = planningRepository?.list().find((candidate) => candidate.colonyId === snapshot.runtime.colonyId);
      const graphNodes = new Map<string, StrategyGraphNode>(mapMatch.version.graph.nodes.map((node) => [node.id, node]));
      const runtimeStrategyVersions = strategyVersions();
      return strategyRuntimeViewSchema.parse({
        runtimeId: snapshot.runtime.id,
        colonyId: snapshot.runtime.colonyId,
        colonyLabel: colony?.colonyLabel ?? snapshot.runtime.colonyId,
        mapId: mapMatch.aggregate.map.id,
        mapName: mapMatch.aggregate.map.name,
        mapVersionId: mapMatch.version.id,
        mapVersionNo: mapMatch.version.versionNo,
        graph: mapMatch.version.graph,
        mode: snapshot.runtime.mode,
        status: snapshot.runtime.status,
        startedAt: snapshot.runtime.startedAt,
        stoppedAt: snapshot.runtime.stoppedAt,
        nodes: snapshot.nodes.map((node) => {
          const definition = graphNodes.get(node.graphNodeId);
          if (!definition) throw new Error(`GraphNode ${node.graphNodeId} missing from frozen map version`);
          const strategyVersion = definition.family === 'STRATEGY' ? runtimeStrategyVersions.get(definition.strategyVersionId) ?? null : null;
          const manualDecisionRequired = definition.family === 'STRATEGY' && (strategyVersion?.detector === null || definition.executionMode === 'CONFIRM');
          return { id: node.id, graphNodeId: node.graphNodeId, label: definition.label, family: definition.family, state: node.state, triggerCount: node.triggerCount, lastEvaluatedCandleId: node.lastEvaluatedCandleId, runtimeMemory: node.runtimeMemory, manualDecisionRequired };
        }),
        evaluations: runtimeRepository.evaluations(snapshot.runtime.id),
        traces: runtimeRepository.traces(snapshot.runtime.id),
        actionProposals: runtimeRepository.proposals(snapshot.runtime.id),
      });
    };
    const workspace = () => strategyWorkspaceSchema.parse({
      strategies: strategyRepository.listDefinitions().map(strategyDefinitionView),
      maps: strategyRepository.listMaps().map(strategyMapView),
      runtimes: runtimeRepository ? runtimeRepository.list().map(runtimeView) : [],
      runtimeColonies: planningRepository ? planningRepository.list().map((item) => ({ colonyId: item.colonyId, label: item.colonyLabel, symbol: item.symbol, direction: item.direction, status: item.status })) : [],
      runtimeAvailable: true,
      liveMarketDataAvailable: false,
    });
    ipcMain.handle(ipcChannels.getStrategyWorkspace, workspace);
    ipcMain.handle(ipcChannels.createStrategyDefinition, (_event, rawInput) => {
      const input = createStrategyDefinitionInputSchema.parse(rawInput);
      const now = new Date().toISOString();
      const detector: DetectorContractRef | null = input.detectorKey
        ? { key: input.detectorKey, version: input.detectorVersion || '1', evaluationMode: input.evaluationMode, parameterSchema: input.parameterSchema }
        : null;
      const aggregate = strategyRepository.createDefinition({
        definitionId: strategyDefinitionId(randomUUID()), versionId: strategyVersionId(randomUUID()), name: input.name,
        category: input.category, description: input.description, tags: input.tags, automationCapability: input.automationCapability,
        detector, deploymentStatus: input.deploymentStatus, createdAt: now,
      });
      return strategyDefinitionView(aggregate);
    });
    ipcMain.handle(ipcChannels.reviseStrategyDefinition, (_event, rawInput) => {
      const input = reviseStrategyDefinitionInputSchema.parse(rawInput);
      const detector: DetectorContractRef | null = input.detectorKey
        ? { key: input.detectorKey, version: input.detectorVersion || '1', evaluationMode: input.evaluationMode, parameterSchema: input.parameterSchema }
        : null;
      return strategyDefinitionView(strategyRepository.reviseDefinition(strategyDefinitionId(input.definitionId), {
        id: strategyVersionId(randomUUID()), name: input.name, category: input.category, description: input.description,
        tags: input.tags, automationCapability: input.automationCapability, detector, deploymentStatus: input.deploymentStatus, createdAt: new Date().toISOString(),
      }));
    });
    ipcMain.handle(ipcChannels.createStrategyMap, (_event, rawInput) => {
      const input = createStrategyMapInputSchema.parse(rawInput);
      return strategyMapView(strategyRepository.createMap({
        mapId: strategyMapId(randomUUID()), versionId: strategyMapVersionId(randomUUID()), kind: input.kind, name: input.name,
        graph: toLogicGraph(input.graph), createdAt: new Date().toISOString(),
      }));
    });
    ipcMain.handle(ipcChannels.saveStrategyMap, (_event, rawInput) => {
      const input = saveStrategyMapInputSchema.parse(rawInput);
      return strategyMapView(strategyRepository.reviseMap(strategyMapId(input.mapId), {
        id: strategyMapVersionId(randomUUID()), graph: toLogicGraph(input.graph), createdAt: new Date().toISOString(),
      }));
    });
    if (runtimeRepository && planningRepository) {
      ipcMain.handle(ipcChannels.createStrategyRuntime, (_event, rawInput) => {
        const input = createStrategyRuntimeInputSchema.parse(rawInput);
        const mapAggregate = strategyRepository.reconstructMap(strategyMapId(input.mapId));
        if (!mapAggregate) throw new Error(`Strategy Map ${input.mapId} not found`);
        const colony = planningRepository.list().find((candidate) => candidate.colonyId === input.colonyId);
        if (!colony) throw new Error(`Colony ${input.colonyId} not found`);
        const versions = strategyVersions();
        validateLogicGraph(mapAggregate.currentVersion.graph, versions);
        const referenced = mapAggregate.currentVersion.graph.nodes.filter((node) => node.family === 'STRATEGY').map((node) => {
          const version = versions.get(node.strategyVersionId);
          if (!version) throw new Error(`StrategyVersion ${node.strategyVersionId} is not available for runtime`);
          return version;
        });
        const executableStatuses = referenced.filter((version) => version.detector !== null).map((version) => version.deploymentStatus);
        const maximum = maximumRuntimeMode(executableStatuses);
        const rank = { OBSERVE: 0, SHADOW: 1, DEMO: 2, LIVE: 3 } as const;
        if (maximum === null || rank[input.mode] > rank[maximum]) throw new Error(`Runtime mode ${input.mode} exceeds deployment approval ${maximum ?? 'RETIRED'}`);
        const snapshot = createRuntime({ runtimeId: strategyRuntimeId(randomUUID()), colonyId: colony.colonyId, mapVersion: mapAggregate.currentVersion, mode: input.mode, startedAt: new Date().toISOString(), ids: runtimeIds() });
        return runtimeView(runtimeRepository.create(snapshot));
      });
      ipcMain.handle(ipcChannels.simulateStrategyRuntimeEvent, (_ipcEvent, rawInput) => {
        const input = simulateStrategyRuntimeEventInputSchema.parse(rawInput);
        const snapshot = runtimeRepository.reconstruct(strategyRuntimeId(input.runtimeId));
        if (!snapshot) throw new Error(`Strategy Runtime ${input.runtimeId} not found`);
        if (snapshot.runtime.mode === 'LIVE') throw new Error('LIVE runtimes remain unavailable in M10');
        const mapMatch = findMapVersion(snapshot.runtime.strategyMapVersionId);
        if (!mapMatch) throw new Error(`StrategyMapVersion ${snapshot.runtime.strategyMapVersionId} missing`);
        const colony = planningRepository.list().find((candidate) => candidate.colonyId === snapshot.runtime.colonyId);
        if (!colony) throw new Error(`Colony ${snapshot.runtime.colonyId} missing`);
        const now = new Date().toISOString();
        const spreadPips = input.spreadPips;
        const halfSpread = input.price !== null && spreadPips !== null ? spreadPips * input.pipSize / 2 : null;
        const event: RuntimeMarketEvent = Object.freeze({
          id: runtimeEventId(randomUUID()), type: input.eventType, instrumentId: colony.instrumentId, timeframe: input.timeframe, occurredAt: now,
          context: Object.freeze({
            instrumentId: colony.instrumentId,
            timeframe: input.timeframe,
            candles: Object.freeze(input.candle === null ? [] : [Object.freeze(input.candle)]),
            bid: input.price === null ? null : halfSpread === null ? input.price : input.price - halfSpread,
            ask: input.price === null ? null : halfSpread === null ? input.price : input.price + halfSpread,
            chartPrice: input.price,
            spreadPips,
            pipSize: input.pipSize,
            marketObjects: Object.freeze([]),
            states: Object.freeze({ thesis_active: !['COMPLETED','INVALIDATED','CANCELLED','ARCHIVED'].includes(colony.status), ...input.states }),
            session: null,
            economicEvents: Object.freeze([]),
            occurredAt: now,
          }),
        });
        const versions = strategyVersions();
        const result = processRuntimeEvent({ snapshot, mapVersion: mapMatch.version, strategies: versions, detectorRegistry, event, ids: runtimeIds(), alreadyProcessed: runtimeRepository.eventProcessed(snapshot.runtime.id, event.id) });
        const plans = params.evidenceRepository ? buildRuntimeEvidencePlans({ runtime: result.snapshot.runtime, nodes: result.snapshot.nodes, graphNodes: mapMatch.version.graph.nodes, nodeEvents: result.nodeEvents, evaluations: result.evaluations, traces: result.traces, context: event.context, ideaVersionId: colony.ideaVersionId, ids: { evidenceEvent: () => `ee-${randomUUID()}`, evidenceReference: () => `er-${randomUUID()}` } }) : [];
        const committed = runtimeRepository.commit(event, result, plans);
        params.evidenceCapture?.enqueue(plans);
        return runtimeView(committed);
      });
      ipcMain.handle(ipcChannels.manualStrategyRuntimeDecision, (_ipcEvent, rawInput) => {
        const input = manualStrategyRuntimeDecisionInputSchema.parse(rawInput);
        const snapshot = runtimeRepository.reconstruct(strategyRuntimeId(input.runtimeId));
        if (!snapshot) throw new Error(`Strategy Runtime ${input.runtimeId} not found`);
        if (snapshot.runtime.mode === 'LIVE') throw new Error('LIVE runtimes remain unavailable in M10');
        const mapMatch = findMapVersion(snapshot.runtime.strategyMapVersionId);
        if (!mapMatch) throw new Error(`StrategyMapVersion ${snapshot.runtime.strategyMapVersionId} missing`);
        const colony = planningRepository.list().find((candidate) => candidate.colonyId === snapshot.runtime.colonyId);
        if (!colony) throw new Error(`Colony ${snapshot.runtime.colonyId} missing`);
        const versions = strategyVersions();
        const result = manualNodeDecision({
          snapshot, mapVersion: mapMatch.version, strategies: versions, graphNodeId: input.graphNodeId,
          decision: input.decision, occurredAt: new Date().toISOString(), ids: runtimeIds(),
        });
        const graphNode = mapMatch.version.graph.nodes.find((node) => node.id === input.graphNodeId);
        const context = { instrumentId: colony.instrumentId, timeframe: graphNode?.timeframe ?? null, candles: [], bid: null, ask: null, chartPrice: null, spreadPips: null, pipSize: 0.0001, marketObjects: [], states: {}, session: null, economicEvents: [], occurredAt: result.traces[0]?.occurredAt ?? new Date().toISOString() };
        const plans: readonly EvidenceRecordPlan[] = params.evidenceRepository ? buildRuntimeEvidencePlans({ runtime: result.snapshot.runtime, nodes: result.snapshot.nodes, graphNodes: mapMatch.version.graph.nodes, nodeEvents: result.nodeEvents, evaluations: result.evaluations, traces: result.traces, context, ideaVersionId: colony.ideaVersionId, ids: { evidenceEvent: () => `ee-${randomUUID()}`, evidenceReference: () => `er-${randomUUID()}` } }) : [];
        const committed = runtimeRepository.commitManualDecision(result, plans);
        params.evidenceCapture?.enqueue(plans);
        return runtimeView(committed);
      });
    }
  }

}
