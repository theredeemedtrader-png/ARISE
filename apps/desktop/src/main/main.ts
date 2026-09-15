import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
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
  ExecutionRepository,
  ProtectionRepository,
  TimeframeRepository,
  openDatabase,
  AnalyticsReviewRepository,
  StrategyPackageRepository,
} from '@arise/database';
import { MT5_PROTOCOL_VERSION } from '@arise/shared';
import { EvidenceAssetStore } from '@arise/evidence';
import { ensureChartCatalog } from './chart-catalog.js';
import { registerIpcHandlers } from './ipc.js';
import { EvidenceCaptureCoordinator } from './evidence-capture.js';
import { Mt5ReadOnlyClient, mt5EndpointFromEnvironment } from './mt5-client.js';
import {ExecutionGateway} from './execution-gateway.js';
import { ProtectionGateway } from './protection-gateway.js';
import { BUILD_COMMIT, BUILD_DATE } from './build-metadata.js';
import { PackagedMt5Agent } from './mt5-agent-manager.js';
import { createProductLogger, type ProductLogger } from './product-logger.js';
import {
  StructureSyncCoordinator,
  structureSyncConfigurationFromEnvironment,
} from './structure-sync.js';
import {
  adoptLegacyDatabase,
  backupDatabase,
  ensureProductDirectories,
  resolveProductPaths,
} from './product-paths.js';

let connection: ReturnType<typeof openDatabase> | null = null;
let mt5Client: Mt5ReadOnlyClient | null = null;
let packagedAgent: PackagedMt5Agent | null = null;
let structureSync: StructureSyncCoordinator | null = null;

const defaultUserDataDirectory = app.getPath('userData');
const productPaths = resolveProductPaths({
  defaultUserDataDirectory,
  isPackaged: app.isPackaged,
});
if (app.getPath('userData') !== productPaths.root) app.setPath('userData', productPaths.root);
ensureProductDirectories(productPaths);
const logger: ProductLogger = createProductLogger(productPaths.logFile, {
  version: app.getVersion(),
  buildCommit: BUILD_COMMIT,
});

async function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'arise-symbol-256.png')
    : path.join(__dirname, '../../build/generated/arise-symbol-256.png');
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    backgroundColor: '#0a1018',
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/preload.cjs'),
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  logger.info('startup', `packaged=${app.isPackaged}`);
  const adopted = adoptLegacyDatabase(productPaths, [
    path.join(productPaths.root, 'arise.db'),
    ...(productPaths.isExplicit ? [] : [path.join(defaultUserDataDirectory, 'arise.db')]),
  ]);
  if (adopted) logger.info('legacy-database-adopted', adopted);
  const backup = backupDatabase(productPaths);
  if (backup) logger.info('database-backup-created', backup);
  connection = openDatabase(productPaths.database);
  const databaseSchemaVersion = connection.sqlite.pragma('user_version', { simple: true }) as number;
  logger.info('database-ready', `schema=${databaseSchemaVersion}`);
  const instrumentRepository = new InstrumentRepository(connection.db);
  const timeframeRepository = new TimeframeRepository(connection.db);
  const marketObjectRepository = new MarketObjectRepository(connection.db);
  const evidenceRepository = new EvidenceRepository(connection.db);
  const evidenceCapture = new EvidenceCaptureCoordinator(evidenceRepository, new EvidenceAssetStore(productPaths.evidence));
  const mt5Repository = new Mt5Repository(connection.sqlite);
  const executionRepository=new ExecutionRepository(connection.sqlite);
  const protectionRepository=new ProtectionRepository(connection.sqlite);
  mt5Client = new Mt5ReadOnlyClient(
    mt5Repository,
    mt5EndpointFromEnvironment(),
    executionRepository,
    protectionRepository,
    app.getVersion(),
    (event, detail) => logger.info(event, detail),
  );
  const executionGateway=new ExecutionGateway(connection.sqlite,mt5Repository,executionRepository,mt5Client);
  const protectionGateway=new ProtectionGateway(connection.sqlite,mt5Repository,protectionRepository,mt5Client);
  evidenceCapture.enqueue(evidenceRepository.list().filter((aggregate) => aggregate.snapshots.length === 0).map((aggregate) => aggregate.plan));
  ensureChartCatalog(instrumentRepository, timeframeRepository);
  structureSync = new StructureSyncCoordinator(
    mt5Repository,
    instrumentRepository,
    timeframeRepository,
    marketObjectRepository,
    structureSyncConfigurationFromEnvironment(),
    (event, detail) => logger.info(event, detail),
  );

  registerIpcHandlers({
    ideaRepository: new IdeaRepository(connection.db),
    instrumentRepository,
    timeframeRepository,
    marketObjectRepository,
    planningRepository: new PlanningRepository(connection.db),
    documentRepository: new DocumentRepository(connection.db),
    reviewRepository: new ReviewRepository(connection.db),
    strategyRepository: new StrategyRepository(connection.db),
    strategyPackageRepository: new StrategyPackageRepository(connection.db, app.getVersion()),
    runtimeRepository: new RuntimeRepository(connection.db),
    evidenceRepository,
    evidenceCapture,
    mt5Repository,
    mt5Client,
    executionGateway,
    protectionGateway,
    analyticsReviewRepository:new AnalyticsReviewRepository(connection.sqlite),
    version: app.getVersion(),
    buildCommit: BUILD_COMMIT,
    buildDate: BUILD_DATE,
    databaseSchemaVersion,
    mt5ProtocolVersion: MT5_PROTOCOL_VERSION,
    dataDirectory: productPaths.data,
    logsDirectory: productPaths.logs,
    databasePath: productPaths.database,
    packaged: app.isPackaged,
  });

  await createWindow();
  if (app.isPackaged) {
    packagedAgent = new PackagedMt5Agent(productPaths, logger, process.resourcesPath, app.getVersion());
    packagedAgent.start();
  }
  mt5Client.start();
  structureSync.start();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}).catch((error: unknown) => {
  logger.error('startup-failed', error);
  dialog.showErrorBox(
    'ARISE could not start',
    `ARISE stopped before opening to protect local data. See ${productPaths.logFile} for diagnostics.`,
  );
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  structureSync?.stop();
  packagedAgent?.stop();
  mt5Client?.stop();
  connection?.sqlite.close();
  logger.info('shutdown-complete');
});

process.on('uncaughtException', (error) => logger.error('uncaught-exception', error));
process.on('unhandledRejection', (error) => logger.error('unhandled-rejection', error));
