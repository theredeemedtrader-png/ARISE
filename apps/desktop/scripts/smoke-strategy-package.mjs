import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const executablePath = process.env.ARISE_PACKAGED_EXE?.trim()
  || path.join(repositoryRoot, 'release', 'windows', 'win-unpacked', 'ARISE.exe');
const fixturePath = path.join(repositoryRoot, 'examples', 'strategy-packages', 'price-touch-notification.arise-strategy');
if (!existsSync(executablePath)) throw new Error(`Packaged executable not found: ${executablePath}`);
if (!existsSync(fixturePath)) throw new Error(`External fixture not found: ${fixturePath}`);

const userData = process.env.ARISE_SMOKE_USER_DATA?.trim()
  || await mkdtemp(path.join(tmpdir(), 'arise-package-smoke-'));
const preserveUserData = Boolean(process.env.ARISE_SMOKE_USER_DATA?.trim());
const exportedPath = path.join(userData, 'price-touch-round-trip.arise-strategy');
const environment = { ...process.env, ARISE_USER_DATA_DIR: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath, env: environment });
let application;

try {
  application = await launch();
  let page = await application.firstWindow();
  await page.locator('.status').waitFor();
  const info = await page.evaluate(() => window.arise.getAppInfo());
  if (info.version !== '1.0.0-beta.2' || !info.packaged) {
    throw new Error(`Expected packaged beta.2, got ${JSON.stringify(info)}`);
  }
  const commandCountBefore = await page.evaluate(async () =>
    (await window.arise.getExecutionWorkspace()).commands.length,
  );
  const colony = await page.evaluate(() => window.arise.createPlanningIdea({
    symbol: 'EURUSD', timeframe: 'D', direction: 'NEUTRAL',
    thesisText: 'Packaged external Strategy Package acceptance.',
    targetDescription: 'Observe only.', invalidationDescription: 'No broker execution.',
    primaryTargetMarketObjectVersionId: null, invalidationMarketObjectVersionId: null,
  }));

  await application.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath], bookmarks: [] });
  }, fixturePath);
  await page.getByRole('button', { name: 'Strategy' }).first().click();
  await page.getByRole('button', { name: 'IMPORT PACKAGE' }).click();
  const preview = page.getByRole('region', { name: 'Import ARISE Strategy Package' });
  await preview.waitFor();
  const previewText = await preview.innerText();
  for (const expected of ['Price Touch Notification', 'VERIFIED', '2 nodes', 'OBSERVE', 'No executable code']) {
    if (!previewText.includes(expected)) throw new Error(`Import Preview is missing ${expected}`);
  }
  await preview.getByRole('button', { name: 'IMPORT', exact: true }).click();
  await page.locator('.strategy-list').filter({ hasText: 'Price Touch Notification' }).waitFor();

  const accepted = await page.evaluate(async (colonyId) => {
    const workspace = await window.arise.getStrategyWorkspace();
    const definition = workspace.strategies.find((item) => item.name === 'Price Touch Notification');
    const map = workspace.maps.find((item) => item.name === 'Price Touch Notification Graph');
    if (!definition || !map) throw new Error('Imported Encyclopedia/Graph records are missing');
    const runtime = await window.arise.createStrategyRuntime({ mapId: map.mapId, colonyId, mode: 'OBSERVE' });
    const afterTouch = await window.arise.simulateStrategyRuntimeEvent({
      runtimeId: runtime.runtimeId, eventType: 'PRICE_UPDATE', timeframe: 'M5', price: 1.1,
      spreadPips: 1, pipSize: 0.0001, candle: null, states: {},
    });
    const afterNotify = await window.arise.simulateStrategyRuntimeEvent({
      runtimeId: runtime.runtimeId, eventType: 'EVENT', timeframe: 'M5', price: 1.1,
      spreadPips: 1, pipSize: 0.0001, candle: null, states: {},
    });
    const liveRejected = await window.arise.createStrategyRuntime({
      mapId: map.mapId, colonyId, mode: 'LIVE',
    }).then(() => false, () => true);
    const execution = await window.arise.getExecutionWorkspace();
    return {
      definitionId: definition.definitionId, mapId: map.mapId,
      deploymentStatus: definition.deploymentStatus,
      nodes: map.graph.nodes.length, edges: map.graph.edges.length,
      detectorConfirmed: afterTouch.evaluations.some((item) => item.detectorKey === 'price_touch' && item.result === 'CONFIRMED'),
      actionObserved: afterNotify.traces.some((item) => item.eventType === 'ACTION_OBSERVED'),
      proposals: afterNotify.actionProposals.length,
      commands: execution.commands.length, liveRejected,
    };
  }, colony.colonyId);
  if (accepted.deploymentStatus !== 'EXPERIMENTAL' || accepted.nodes !== 2 || accepted.edges !== 1
      || !accepted.detectorConfirmed || !accepted.actionObserved || accepted.proposals !== 0
      || accepted.commands !== commandCountBefore || !accepted.liveRejected) {
    throw new Error(`Packaged OBSERVE acceptance failed: ${JSON.stringify(accepted)}`);
  }

  await application.close();
  application = undefined;
  application = await launch();
  page = await application.firstWindow();
  const restored = await page.evaluate(async () => window.arise.getStrategyWorkspace());
  const restoredDefinition = restored.strategies.find((item) => item.name === 'Price Touch Notification');
  const restoredMap = restored.maps.find((item) => item.name === 'Price Touch Notification Graph');
  if (!restoredDefinition || restoredMap?.graph.nodes.length !== 2 || !restored.runtimes.some((item) => item.mode === 'OBSERVE')) {
    throw new Error('Imported package/runtime did not persist across packaged restart');
  }

  await application.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
  }, exportedPath);
  const exported = await page.evaluate((definitionId) =>
    window.arise.exportStrategyPackage({ targetType: 'STRATEGY', targetId: definitionId }),
  restoredDefinition.definitionId);
  if (exported.canceled) throw new Error('Packaged export was canceled unexpectedly');
  const source = JSON.parse(await readFile(fixturePath, 'utf8'));
  const roundTrip = JSON.parse(await readFile(exportedPath, 'utf8'));
  if (JSON.stringify(roundTrip) !== JSON.stringify(source)) throw new Error('Packaged export is not lossless');

  await application.evaluate(async ({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath], bookmarks: [] });
  }, exportedPath);
  const reimport = await page.evaluate(async () => {
    const selected = await window.arise.selectStrategyPackage();
    if (!selected?.preview.checksum) throw new Error('Round-trip preview failed');
    const result = await window.arise.importStrategyPackage({
      previewToken: selected.previewToken,
      expectedChecksum: selected.preview.checksum,
      allowUpgrade: false,
    });
    return { disposition: selected.preview.disposition, status: result.status };
  });
  if (reimport.disposition !== 'IDENTICAL' || reimport.status !== 'ALREADY_IMPORTED') {
    throw new Error(`Round-trip re-import failed: ${JSON.stringify(reimport)}`);
  }
  const commandsAfter = await page.evaluate(async () => (await window.arise.getExecutionWorkspace()).commands.length);
  if (commandsAfter !== commandCountBefore) throw new Error('Strategy Package acceptance created a broker command');

  console.log(JSON.stringify({
    executablePath, userData, fixturePath, exportedPath,
    preview: 'PASS', validation: 'PASS', import: 'PASS', encyclopedia: 'PASS',
    graph: '2 nodes / 1 edge', restartPersistence: 'PASS', roundTrip: 'PASS',
    observe: 'PASS', brokerCommandsBefore: commandCountBefore, brokerCommandsAfter: commandsAfter,
    liveRejected: true,
  }, null, 2));
} finally {
  if (application) await application.close();
  if (!preserveUserData) await rm(userData, { recursive: true, force: true });
}
