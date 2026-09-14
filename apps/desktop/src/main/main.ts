import { app, BrowserWindow } from 'electron';
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
} from '@arise/database';
import { EvidenceAssetStore } from '@arise/evidence';
import { ensureChartCatalog } from './chart-catalog.js';
import { registerIpcHandlers } from './ipc.js';
import { EvidenceCaptureCoordinator } from './evidence-capture.js';
import { Mt5ReadOnlyClient, mt5EndpointFromEnvironment } from './mt5-client.js';
import {ExecutionGateway} from './execution-gateway.js';
import { ProtectionGateway } from './protection-gateway.js';

let connection: ReturnType<typeof openDatabase> | null = null;
let mt5Client: Mt5ReadOnlyClient | null = null;

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    backgroundColor: '#0a1018',
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
  const dbPath = path.join(app.getPath('userData'), 'arise.db');
  connection = openDatabase(dbPath);
  const instrumentRepository = new InstrumentRepository(connection.db);
  const timeframeRepository = new TimeframeRepository(connection.db);
  const evidenceRepository = new EvidenceRepository(connection.db);
  const evidenceCapture = new EvidenceCaptureCoordinator(evidenceRepository, new EvidenceAssetStore(path.join(app.getPath('userData'), 'evidence')));
  const mt5Repository = new Mt5Repository(connection.sqlite);
  const executionRepository=new ExecutionRepository(connection.sqlite);
  const protectionRepository=new ProtectionRepository(connection.sqlite);
  mt5Client = new Mt5ReadOnlyClient(mt5Repository, mt5EndpointFromEnvironment(),executionRepository,protectionRepository);
  const executionGateway=new ExecutionGateway(connection.sqlite,mt5Repository,executionRepository,mt5Client);
  const protectionGateway=new ProtectionGateway(connection.sqlite,mt5Repository,protectionRepository,mt5Client);
  evidenceCapture.enqueue(evidenceRepository.list().filter((aggregate) => aggregate.snapshots.length === 0).map((aggregate) => aggregate.plan));
  ensureChartCatalog(instrumentRepository, timeframeRepository);

  registerIpcHandlers({
    ideaRepository: new IdeaRepository(connection.db),
    instrumentRepository,
    timeframeRepository,
    marketObjectRepository: new MarketObjectRepository(connection.db),
    planningRepository: new PlanningRepository(connection.db),
    documentRepository: new DocumentRepository(connection.db),
    reviewRepository: new ReviewRepository(connection.db),
    strategyRepository: new StrategyRepository(connection.db),
    runtimeRepository: new RuntimeRepository(connection.db),
    evidenceRepository,
    evidenceCapture,
    mt5Repository,
    mt5Client,
    executionGateway,
    protectionGateway,
    analyticsReviewRepository:new AnalyticsReviewRepository(connection.sqlite),
    version: app.getVersion(),
  });

  await createWindow();
  mt5Client.start();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}).catch((error: unknown) => {
  console.error('ARISE startup failed:', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  mt5Client?.stop();
  connection?.sqlite.close();
});
