import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const executablePath = process.env.ARISE_PACKAGED_EXE?.trim()
  || path.join(repositoryRoot, 'release', 'windows', 'win-unpacked', 'ARISE.exe');
const expectedVersion = process.env.ARISE_EXPECT_VERSION?.trim() || '1.0.0-beta.2';
if (!existsSync(executablePath)) throw new Error(`Packaged executable not found: ${executablePath}`);

const userData = process.env.ARISE_SMOKE_USER_DATA?.trim()
  || await mkdtemp(path.join(tmpdir(), 'arise-packaged-smoke-'));
const preserveUserData = Boolean(process.env.ARISE_SMOKE_USER_DATA?.trim());
const validation = path.join(repositoryRoot, 'release', 'windows', 'validation');
await mkdir(validation, { recursive: true });
const logPath = path.join(userData, 'logs', 'arise.log');
const previousLog = existsSync(logPath) ? await readFile(logPath, 'utf8') : '';

let application;
try {
  const environment = { ...process.env, ARISE_USER_DATA_DIR: userData };
  delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath,
    env: environment,
  });
  const page = await application.firstWindow();
  await page.locator('.utility-nav button').filter({ hasText: 'System Health' }).click();
  await page.getByText(`ARISE ${expectedVersion}`, { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll('.system-table > div')]
      .find((element) => element.textContent?.includes('MT5 Agent'));
    return row && !row.textContent?.includes('DISCONNECTED') && !row.textContent?.includes('RECONNECTING');
  }, undefined, { timeout: 40_000 });
  const expectedServer = process.env.ARISE_EXPECT_MT5_SERVER?.trim();
  if (expectedServer) {
    await page.waitForTimeout(3_000);
    await page.waitForFunction(async (server) => {
      const workspace = await window.arise.getMt5Workspace();
      return workspace.connection.state === 'CONNECTED'
        && workspace.connection.truth === 'VERIFIED'
        && workspace.account?.server === server;
    }, expectedServer, { timeout: 40_000 });
  }
  const agentState = await page.locator('.system-table > div').filter({ hasText: 'MT5 Agent' }).innerText();
  const mt5 = await page.evaluate(() => window.arise.getMt5Workspace());
  if (expectedServer && (
    mt5.account?.server !== expectedServer
    || mt5.account.isLive !== false
    || !mt5.readOnly
    || mt5.executionAvailable
  )) throw new Error(`Read-only MT5 recognition failed for ${expectedServer}`);
  const isolation = await page.evaluate(() => ({
    requireType: typeof (window).require,
    processType: typeof (window).process,
    ariseType: typeof window.arise,
  }));
  if (isolation.requireType !== 'undefined' || isolation.processType !== 'undefined' || isolation.ariseType !== 'object') {
    throw new Error(`Renderer isolation check failed: ${JSON.stringify(isolation)}`);
  }
  const markerInstrument = process.env.ARISE_SMOKE_MARKER?.trim();
  let markerIdeaId = null;
  if (markerInstrument) {
    const ideas = await page.evaluate(() => window.arise.listIdeas());
    const existing = ideas.find((idea) => idea.instrumentId === markerInstrument);
    markerIdeaId = existing?.ideaId ?? (await page.evaluate(
      (instrumentId) => window.arise.createIdea({ instrumentId, timeframe: 'PRODUCTIZATION', direction: 'NEUTRAL' }),
      markerInstrument,
    )).ideaId;
  }
  const workspaceChecks = [];
  for (const [label, heading] of [
    ['Ideas', 'Ideas'],
    ['Trading', 'Trading'],
    ['Strategy', 'Strategy'],
    ['Review', 'Market Review'],
    ['Database', 'Database'],
  ]) {
    await page.locator('.nav-group button').filter({ hasText: label }).click();
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    if (label === 'Trading') await page.getByTestId('lightweight-chart-host').waitFor();
    workspaceChecks.push(label);
  }
  await page.locator('.nav-group button').filter({ hasText: 'Review' }).click();
  await page.getByRole('button', { name: 'EVIDENCE', exact: true }).click();
  await page.getByRole('heading', { name: 'Evidence + Decision Trace', exact: true }).waitFor();
  workspaceChecks.push('Evidence');
  await page.locator('.utility-nav button').filter({ hasText: 'System Health' }).click();
  await page.screenshot({ path: path.join(validation, 'packaged-system-health.png'), fullPage: true });
  await application.close();
  application = undefined;

  for (const relative of ['data/arise.db', 'logs/arise.log', 'config/mt5.json']) {
    if (!existsSync(path.join(userData, relative))) throw new Error(`Packaged launch did not create ${relative}`);
  }
  const completeLog = await readFile(logPath, 'utf8');
  const log = completeLog.startsWith(previousLog) ? completeLog.slice(previousLog.length) : completeLog;
  for (const event of ['startup', 'database-ready', 'mt5-agent-started', 'mt5-agent-client-connected', 'mt5-agent-handshake']) {
    if (!log.includes(`\"event\":\"${event}\"`)) throw new Error(`Packaged log is missing ${event}`);
  }
  console.log(JSON.stringify({
    executablePath,
    userData,
    screenshot: path.join(validation, 'packaged-system-health.png'),
    isolation,
    agentState,
    mt5: {
      connection: mt5.connection.state,
      truth: mt5.connection.truth,
      transportMode: mt5.connection.transportMode,
      broker: mt5.account?.broker ?? null,
      server: mt5.account?.server ?? null,
      isLive: mt5.account?.isLive ?? null,
      readOnly: mt5.readOnly,
      executionAvailable: mt5.executionAvailable,
      symbols: mt5.symbols.map((symbol) => symbol.brokerSymbol),
    },
    workspaceChecks,
    markerIdeaId,
  }, null, 2));
} finally {
  if (application) await application.close();
  if (!preserveUserData) await rm(userData, { recursive: true, force: true });
}
