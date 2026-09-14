import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('external Strategy Package imports, reconstructs, persists, exports, and runs in OBSERVE without broker commands', async () => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-package-'));
  const exportedPath = path.join(userData, 'price-touch-round-trip.arise-strategy');
  const fixturePath = path.resolve(
    process.cwd(),
    '../../examples/strategy-packages/price-touch-notification.arise-strategy',
  );
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const beforeCommands = await page.evaluate(async () =>
      (await window.arise.getExecutionWorkspace()).commands.length,
    );
    const colony = await page.evaluate(() => window.arise.createPlanningIdea({
      symbol: 'EURUSD',
      timeframe: 'D',
      direction: 'NEUTRAL',
      thesisText: 'External package acceptance fixture only.',
      targetDescription: 'Observe a neutral price level.',
      invalidationDescription: 'No broker execution is authorized.',
      primaryTargetMarketObjectVersionId: null,
      invalidationMarketObjectVersionId: null,
    }));

    await app.evaluate(async ({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
        bookmarks: [],
      });
    }, fixturePath);
    await page.getByRole('button', { name: 'Strategy' }).first().click();
    await page.getByRole('button', { name: 'IMPORT PACKAGE' }).click();
    const preview = page.getByRole('region', { name: 'Import ARISE Strategy Package' });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Price Touch Notification');
    await expect(preview).toContainText('VERIFIED');
    await expect(preview).toContainText('2 nodes · 1 edges');
    await expect(preview).toContainText('OBSERVE');
    await expect(preview).toContainText('No executable code · no broker command · no LIVE authority');
    await preview.getByRole('button', { name: 'IMPORT', exact: true }).click();
    await expect(page.locator('.strategy-list')).toContainText('Price Touch Notification');
    await expect(page.locator('.strategy-node')).toHaveCount(2);

    const accepted = await page.evaluate(async (colonyId) => {
      const workspace = await window.arise.getStrategyWorkspace();
      const definition = workspace.strategies.find((item) => item.name === 'Price Touch Notification');
      const map = workspace.maps.find((item) => item.name === 'Price Touch Notification Graph');
      if (!definition || !map) throw new Error('Imported definition/map missing');
      const runtime = await window.arise.createStrategyRuntime({
        mapId: map.mapId,
        colonyId,
        mode: 'OBSERVE',
      });
      const afterTouch = await window.arise.simulateStrategyRuntimeEvent({
        runtimeId: runtime.runtimeId,
        eventType: 'PRICE_UPDATE',
        timeframe: 'M5',
        price: 1.1,
        spreadPips: 1,
        pipSize: 0.0001,
        candle: null,
        states: {},
      });
      const afterNotify = await window.arise.simulateStrategyRuntimeEvent({
        runtimeId: runtime.runtimeId,
        eventType: 'EVENT',
        timeframe: 'M5',
        price: 1.1,
        spreadPips: 1,
        pipSize: 0.0001,
        candle: null,
        states: {},
      });
      const execution = await window.arise.getExecutionWorkspace();
      return { definition, map, afterTouch, afterNotify, commandCount: execution.commands.length };
    }, colony.colonyId);
    expect(accepted.definition.deploymentStatus).toBe('EXPERIMENTAL');
    expect(accepted.map.graph.nodes).toHaveLength(2);
    expect(accepted.map.graph.edges).toHaveLength(1);
    expect(accepted.afterTouch.evaluations).toEqual(
      expect.arrayContaining([expect.objectContaining({ detectorKey: 'price_touch', result: 'CONFIRMED' })]),
    );
    expect(accepted.afterNotify.actionProposals).toHaveLength(0);
    expect(accepted.afterNotify.traces).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'ACTION_OBSERVED' })]),
    );
    expect(accepted.commandCount).toBe(beforeCommands);

    await app.close();
    app = undefined;
    app = await launch();
    page = await app.firstWindow();
    const restored = await page.evaluate(async () => window.arise.getStrategyWorkspace());
    const definition = restored.strategies.find((item) => item.name === 'Price Touch Notification');
    const map = restored.maps.find((item) => item.name === 'Price Touch Notification Graph');
    expect(definition).toBeTruthy();
    expect(map?.graph.nodes).toHaveLength(2);
    expect(restored.runtimes.some((item) => item.mode === 'OBSERVE')).toBe(true);

    await app.evaluate(async ({ dialog }, selectedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selectedPath });
    }, exportedPath);
    const exported = await page.evaluate((definitionId) =>
      window.arise.exportStrategyPackage({ targetType: 'STRATEGY', targetId: definitionId }),
    definition!.definitionId);
    expect(exported.canceled).toBe(false);
    const original = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
    const roundTrip = JSON.parse(await readFile(exportedPath, 'utf8')) as unknown;
    expect(roundTrip).toEqual(original);

    await app.evaluate(async ({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
        bookmarks: [],
      });
    }, exportedPath);
    const selected = await page.evaluate(() => window.arise.selectStrategyPackage());
    expect(selected?.preview.disposition).toBe('IDENTICAL');
    const reimported = await page.evaluate((input) => window.arise.importStrategyPackage(input), {
      previewToken: selected!.previewToken,
      expectedChecksum: selected!.preview.checksum!,
      allowUpgrade: false,
    });
    expect(reimported.status).toBe('ALREADY_IMPORTED');
    expect((await page.evaluate(() => window.arise.getExecutionWorkspace())).commands).toHaveLength(beforeCommands);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
