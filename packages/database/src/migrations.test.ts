import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDraftIdea } from '@arise/domain';
import { openDatabase } from './database';
import { IdeaRepository } from './idea-repository';
import { applyMigrations, migrations } from './migrations';

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

describe('versioned persistence migrations', () => {
  it('uses WAL, foreign keys, M12 schema, and preserves frozen-M0 Ideas after reopening', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'arise-m2-'));
    const filename = path.join(dir, 'arise.db');
    let connection = openDatabase(filename);
    try {
      expect(connection.sqlite.pragma('journal_mode', { simple: true })).toBe(
        'wal',
      );
      expect(connection.sqlite.pragma('foreign_keys', { simple: true })).toBe(
        1,
      );
      expect(connection.sqlite.pragma('user_version', { simple: true })).toBe(
        11,
      );
      const idea = createDraftIdea({
        id: 'restart',
        instrumentId: 'EURUSD',
        thesisTimeframe: '8H',
        direction: 'SHORT',
      });
      await new IdeaRepository(connection.db).insert(idea);
      connection.sqlite.close();
      connection = openDatabase(filename);
      const repo = new IdeaRepository(connection.db);
      expect(await repo.findById(idea.id)).toEqual(idea);
      expect(await repo.list()).toEqual([idea]);
      expect(await repo.findById('missing')).toBeNull();
      await expect(repo.insert(idea)).rejects.toThrow();
    } finally {
      connection.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a schema-v1 database into legacy_ideas without losing the row', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(migrations[0]!.sql);
      sqlite.pragma('user_version = 1');
      sqlite.exec(
        "INSERT INTO ideas VALUES ('old', 'EURUSD', 'W', 'LONG', 'DRAFT', 123)",
      );
      applyMigrations(sqlite);
      expect(sqlite.pragma('user_version', { simple: true })).toBe(11);
      expect(
        sqlite.prepare('SELECT id, instrument_id FROM legacy_ideas').all(),
      ).toEqual([{ id: 'old', instrument_id: 'EURUSD' }]);
      expect(sqlite.prepare('SELECT id FROM ideas').all()).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('adopts the unversioned starter schema and then upgrades it through M12', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.exec(migrations[0]!.sql);
      sqlite.exec(
        "INSERT INTO ideas VALUES ('old', 'EURUSD', 'W', 'LONG', 'DRAFT', 123)",
      );
      applyMigrations(sqlite);
      applyMigrations(sqlite);
      expect(sqlite.pragma('user_version', { simple: true })).toBe(11);
      expect(sqlite.prepare('SELECT id FROM legacy_ideas').all()).toEqual([
        { id: 'old' },
      ]);
      expect(tableNames(sqlite)).toContain('market_object_versions');
      expect(tableNames(sqlite)).toContain('positions');
      expect(tableNames(sqlite)).toContain('performance_reviews');
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the whole pending migration batch, including schema version', () => {
    const sqlite = new Database(':memory:');
    try {
      expect(() =>
        applyMigrations(sqlite, [
          ...migrations,
          { version: 11, sql: 'CREATE TABLE partial (id TEXT); INVALID SQL;' },
        ]),
      ).toThrow();
      expect(sqlite.pragma('user_version', { simple: true })).toBe(0);
      expect(tableNames(sqlite)).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('refuses a newer database without changing its version', () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('user_version = 99');
      expect(() => applyMigrations(sqlite)).toThrow('newer');
      expect(sqlite.pragma('user_version', { simple: true })).toBe(99);
    } finally {
      sqlite.close();
    }
  });

  it('database-level version guards reject gaps and stale supersedes pointers', () => {
    const { sqlite } = openDatabase(':memory:');
    try {
      sqlite.exec(`
        INSERT INTO instruments VALUES ('instrument-eurusd','EURUSD','EUR/USD','FOREX','EUR','USD',0.0001,0.00001,5,1,'2026-09-10T00:00:00.000Z');
        INSERT INTO timeframes VALUES ('timeframe-d','D',NULL,'BROKER_DAILY',10);
        INSERT INTO ideas VALUES ('idea-1','instrument-eurusd','timeframe-d','DRAFT','2026-09-10T00:01:00.000Z',NULL);
        INSERT INTO idea_versions VALUES ('idea-version-1','idea-1',1,'LONG','','','',NULL,NULL,'2026-09-10T00:02:00.000Z',NULL);
      `);
      expect(() =>
        sqlite.exec(`
        INSERT INTO idea_versions VALUES ('idea-version-3','idea-1',3,'LONG','','','',NULL,NULL,'2026-09-10T00:03:00.000Z','idea-version-1');
      `),
      ).toThrow('current history head');
      sqlite.exec(`
        INSERT INTO idea_versions VALUES ('idea-version-2','idea-1',2,'LONG','','','',NULL,NULL,'2026-09-10T00:03:00.000Z','idea-version-1');
      `);
      expect(() =>
        sqlite.exec(`
        INSERT INTO idea_versions VALUES ('idea-version-bad','idea-1',3,'LONG','','','',NULL,NULL,'2026-09-10T00:04:00.000Z','idea-version-1');
      `),
      ).toThrow('supersedes pointer');
    } finally {
      sqlite.close();
    }
  });

  it('database-level immutable history triggers reject updates and deletes', () => {
    const { sqlite } = openDatabase(':memory:');
    try {
      sqlite.exec(`
        INSERT INTO instruments VALUES ('instrument-eurusd','EURUSD','EUR/USD','FOREX','EUR','USD',0.0001,0.00001,5,1,'2026-09-10T00:00:00.000Z');
        INSERT INTO timeframes VALUES ('timeframe-d','D',NULL,'BROKER_DAILY',10);
        INSERT INTO ideas VALUES ('idea-1','instrument-eurusd','timeframe-d','DRAFT','2026-09-10T00:01:00.000Z',NULL);
        INSERT INTO idea_versions VALUES ('idea-version-1','idea-1',1,'LONG','','','',NULL,NULL,'2026-09-10T00:02:00.000Z',NULL);
      `);
      expect(() =>
        sqlite.exec(
          "UPDATE idea_versions SET thesis_text='changed' WHERE id='idea-version-1'",
        ),
      ).toThrow('immutable');
      expect(() =>
        sqlite.exec("DELETE FROM idea_versions WHERE id='idea-version-1'"),
      ).toThrow('immutable');
      expect(
        sqlite
          .prepare(
            "SELECT thesis_text FROM idea_versions WHERE id='idea-version-1'",
          )
          .get(),
      ).toEqual({ thesis_text: '' });
    } finally {
      sqlite.close();
    }
  });
});
