import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { applyMigrations } from './migrations';

export type AriseDatabase = ReturnType<typeof drizzle<typeof schema>>;
export type AriseTransaction = Parameters<Parameters<AriseDatabase['transaction']>[0]>[0];

export function openDatabase(filename: string): { sqlite: Database.Database; db: AriseDatabase } {
  const sqlite = new Database(filename);
  try {
    sqlite.pragma('foreign_keys = ON');
    const mode = sqlite.pragma('journal_mode = WAL', { simple: true });
    if (filename !== ':memory:' && mode !== 'wal') throw new Error('SQLite WAL mode unavailable');
    applyMigrations(sqlite);
    return { sqlite, db: drizzle(sqlite, { schema }) };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
