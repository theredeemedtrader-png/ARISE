import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adoptLegacyDatabase, backupDatabase, ensureProductDirectories, resolveProductPaths } from './product-paths';

const roots: string[] = [];
function temporaryRoot(name: string): string {
  const root = path.join(tmpdir(), `arise-product-paths-${name}-${Date.now()}-${Math.random()}`);
  roots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('Windows product paths', () => {
  it('uses the stable LocalAppData ARISE root when packaged', () => {
    const local = temporaryRoot('local');
    const paths = resolveProductPaths({
      defaultUserDataDirectory: 'ignored',
      isPackaged: true,
      argv: [],
      environment: { LOCALAPPDATA: local },
    });
    expect(paths.database).toBe(path.join(local, 'ARISE', 'data', 'arise.db'));
    expect(paths.logFile).toBe(path.join(local, 'ARISE', 'logs', 'arise.log'));
  });

  it('honors an isolated user-data directory for tests and diagnostics', () => {
    const explicit = temporaryRoot('explicit');
    const paths = resolveProductPaths({
      defaultUserDataDirectory: 'ignored',
      isPackaged: true,
      argv: [`--user-data-dir=${explicit}`],
      environment: {},
    });
    expect(paths.root).toBe(path.resolve(explicit));
    expect(paths.isExplicit).toBe(true);
  });

  it('adopts a legacy database without overwriting a production database', () => {
    const root = temporaryRoot('adopt');
    const legacy = path.join(root, 'arise.db');
    writeFileSync(legacy, 'legacy');
    const paths = resolveProductPaths({ defaultUserDataDirectory: root, isPackaged: false });
    ensureProductDirectories(paths);
    expect(adoptLegacyDatabase(paths, [legacy])).toBe(path.resolve(legacy));
    expect(readFileSync(paths.database, 'utf8')).toBe('legacy');
    writeFileSync(legacy, 'changed');
    expect(adoptLegacyDatabase(paths, [legacy])).toBeNull();
    expect(readFileSync(paths.database, 'utf8')).toBe('legacy');
  });

  it('creates a pre-start backup and retains the database', () => {
    const root = temporaryRoot('backup');
    const paths = resolveProductPaths({ defaultUserDataDirectory: root, isPackaged: false });
    ensureProductDirectories(paths);
    writeFileSync(paths.database, 'durable');
    const backup = backupDatabase(paths, new Date('2026-09-14T12:00:00.000Z'));
    expect(backup).not.toBeNull();
    expect(existsSync(backup!)).toBe(true);
    expect(readFileSync(backup!, 'utf8')).toBe('durable');
  });
});
