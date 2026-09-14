import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Electron status, isolated IPC, WAL, and persistence across restart', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'arise-electron-'));
  const launch = () => electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    app = await launch();
    const page = await app.firstWindow();
    await expect(page.locator('.status')).toHaveText('DATABASE READY');
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    const created = await page.evaluate(() => window.arise.createIdea({ instrumentId: 'EURUSD', timeframe: '8H', direction: 'LONG' }));
    const rows = await page.evaluate(() => window.arise.listIdeas());
    expect(rows).toEqual([{ ideaId: created.ideaId, instrumentId: 'EURUSD', timeframe: '8H', direction: 'LONG' }]);
    const wal = await app.evaluate(async ({ app: mainApp }) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const require = createRequire(`${mainApp.getAppPath()}/package.json`);
      const databaseRequire = createRequire(require.resolve('@arise/database'));
      const Database = databaseRequire('better-sqlite3');
      const db = new Database(`${mainApp.getPath('userData')}/data/arise.db`);
      try { return db.pragma('journal_mode', { simple: true }); } finally { db.close(); }
    });
    expect(wal).toBe('wal');
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await expect(reopened.locator('.status')).toHaveText('DATABASE READY');
    expect(await reopened.evaluate(() => window.arise.listIdeas())).toEqual(rows);
  } finally {
    await app?.close();
    await rm(userData, { recursive: true, force: true });
  }
});
