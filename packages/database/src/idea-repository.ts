import { eq } from 'drizzle-orm';
import type { LegacyIdea } from '@arise/domain';
import type { AriseDatabase } from './database';
import { legacyIdeas } from './schema';

/** Frozen M0 compatibility repository. New code uses CanonicalIdeaRepository. */
export class IdeaRepository {
  constructor(private readonly db: AriseDatabase) {}

  async insert(idea: LegacyIdea): Promise<void> {
    await this.db.insert(legacyIdeas).values({
      id: idea.id,
      instrumentId: idea.instrumentId,
      thesisTimeframe: idea.thesisTimeframe,
      direction: idea.direction,
      status: idea.status,
      createdAtMs: idea.createdAt.getTime(),
    });
  }

  async findById(id: string): Promise<LegacyIdea | null> {
    const rows = await this.db.select().from(legacyIdeas).where(eq(legacyIdeas.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      instrumentId: row.instrumentId,
      thesisTimeframe: row.thesisTimeframe,
      direction: row.direction,
      status: row.status,
      createdAt: new Date(row.createdAtMs),
    };
  }

  async list(): Promise<LegacyIdea[]> {
    const rows = await this.db.select().from(legacyIdeas);
    return rows.map((row) => ({
      id: row.id,
      instrumentId: row.instrumentId,
      thesisTimeframe: row.thesisTimeframe,
      direction: row.direction,
      status: row.status,
      createdAt: new Date(row.createdAtMs),
    }));
  }
}
