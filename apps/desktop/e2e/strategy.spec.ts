import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('M6 Strategy Encyclopedia and Graph persist immutable versions across restart', async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-m6-'));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Strategy' }).first().click();
    await expect(page.getByRole('heading', { name: 'Strategy' })).toBeVisible();

    await page.getByRole('button', { name: 'New Strategy', exact: true }).click();
    await page.getByLabel('Strategy name').fill('Liquidity Sweep');
    await page.getByLabel('Strategy description').fill('Detect a sweep of external liquidity before downstream participation.');
    await page.getByRole('button', { name: /SAVE IMMUTABLE VERSION/ }).click();
    await expect(page.locator('.strategy-list')).toContainText('Liquidity Sweep');

    await page.getByRole('button', { name: 'New Strategy Map' }).click();
    await page.getByLabel('Strategy map name').fill('D1 Sweep to M5 Entry');
    await page.getByRole('button', { name: 'CREATE MAP' }).click();
    await expect(page.locator('.builder-toolbar')).toContainText('D1 Sweep to M5 Entry');

    await page.locator('.node-library > button').filter({ hasText: 'Strategy' }).click();
    await page.locator('.node-library > button').filter({ hasText: 'Action' }).click();
    await expect(page.locator('.strategy-node')).toHaveCount(2);

    await page.locator('.strategy-node').first().click();
    const target = page.locator('.inspector-connect select');
    await target.selectOption({ label: 'Notify' });
    await page.getByRole('button', { name: 'CONNECT' }).click();
    await page.getByRole('button', { name: 'SAVE NEW VERSION' }).click();
    await expect(page.locator('.builder-toolbar')).toContainText('VERSION 2');

    await app.close(); app = undefined;
    app = await launch(); page = await app.firstWindow();
    const restored = await page.evaluate(async () => window.arise.getStrategyWorkspace());
    expect(restored.strategies.some((entry) => entry.name === 'Liquidity Sweep')).toBe(true);
    const map = restored.maps.find((entry) => entry.name === 'D1 Sweep to M5 Entry');
    expect(map?.versionNo).toBe(2);
    expect(map?.graph.nodes).toHaveLength(2);
    expect(map?.graph.edges).toHaveLength(1);
    expect(restored.runtimeAvailable).toBe(true);
    expect(restored.liveMarketDataAvailable).toBe(false);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
