import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('ARISE shell navigation, command palette, and preferences persist', async () => {
  test.setTimeout(60_000);

  const userData = await mkdtemp(path.join(tmpdir(), 'arise-shell-'));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
  let app: Awaited<ReturnType<typeof launch>> | undefined;

  try {
    await test.step('change shell preferences', async () => {
      app = await launch();
      const page = await app.firstWindow();

      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
      await expect(page.locator('.navigator')).toBeVisible();

      await page.keyboard.press('Control+K');
      await expect(page.locator('.command-palette')).toBeVisible();
      await page.getByPlaceholder('Search workspaces, symbols, commands…').fill('settings');
      await page.getByRole('button', { name: 'Go to Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

      await page.getByRole('button', { name: 'LIGHT' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.locator('.settings-layout').getByRole('button', { name: 'Toggle Market Navigator' }).click();
      await expect(page.locator('.navigator')).toHaveCount(0);

      // React persists shell state in effects. Wait for the durable values before
      // closing Electron so this test verifies persistence rather than racing it.
      await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('arise.shell.active.v1')))
        .toBe('settings');
      await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('arise.shell.preferences.v1')))
        .toContain('"theme":"light"');
      await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('arise.shell.preferences.v1')))
        .toContain('"navigatorOpen":false');
    });

    await test.step('restore shell preferences after restart', async () => {
      await app?.close();
      app = undefined;

      app = await launch();
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.locator('.navigator')).toHaveCount(0);
    });
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
