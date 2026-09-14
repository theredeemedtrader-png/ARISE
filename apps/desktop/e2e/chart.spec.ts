import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('M4 chart renders, persists semantic Market Objects, revisions, and timeframe projection', async () => {
  test.setTimeout(60_000);
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-chart-'));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
  let app: Awaited<ReturnType<typeof launch>> | undefined;

  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Trading' }).first().click();
    await expect(page.getByRole('heading', { name: 'Trading' })).toBeVisible();
    await expect(page.getByTestId('lightweight-chart-host')).toBeVisible();
    await expect.poll(async () => page.getByTestId('lightweight-chart-host').locator('canvas').count()).toBeGreaterThan(0);

    const catalog = await page.evaluate(() => window.arise.getChartCatalog());
    expect(catalog.instruments.some((entry) => entry.symbol === 'EURUSD')).toBe(true);
    expect(catalog.timeframes.map((entry) => entry.code)).toContain('H1');

    const created = await page.evaluate(() => window.arise.createChartObject({
      symbol: 'EURUSD',
      timeframe: 'H1',
      geometryType: 'RECTANGLE',
      semanticType: 'FVG',
      role: 'AREA',
      name: 'H1 FVG E2E',
      geometryJson: { kind: 'RECTANGLE', start: { time: 1788220800, price: 1.16 }, end: { time: 1788224400, price: 1.165 } },
      semanticPropertiesJson: { layer: 'GLOBAL', source: 'E2E' },
    }));
    expect(created.versionNo).toBe(1);

    const revised = await page.evaluate((marketObjectId) => window.arise.reviseChartObject({
      marketObjectId,
      geometryJson: { kind: 'RECTANGLE', start: { time: 1788220800, price: 1.161 }, end: { time: 1788224400, price: 1.166 } },
    }), created.id);
    expect(revised.versionNo).toBe(2);

    await page.getByRole('button', { name: 'Overview' }).first().click();
    await page.getByRole('button', { name: 'Trading' }).first().click();
    await expect(page.getByRole('button', { name: /H1 FVG E2E/ })).toBeVisible();
    await expect(page.getByText('v2', { exact: true })).toBeVisible();

    const chart = page.getByTestId('lightweight-chart-host');
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    if (box) await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await expect(page.getByRole('button', { name: 'EXPAND TO M15' })).toBeVisible();
    await page.getByRole('button', { name: 'EXPAND TO M15' }).click();
    await expect(page.getByRole('button', { name: 'SHOW PARENT CANDLE' })).toBeVisible();

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Trading' }).first().click();
    await expect(page.getByRole('button', { name: /H1 FVG E2E/ })).toBeVisible();
    const persisted = await page.evaluate(() => window.arise.listChartObjects({ symbol: 'EURUSD' }));
    expect(persisted.find((entry) => entry.name === 'H1 FVG E2E')?.versionNo).toBe(2);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
