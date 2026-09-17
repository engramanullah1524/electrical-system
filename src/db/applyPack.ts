import { db, today } from './db';
import { planMerge, validatePack, type LibraryPack, type MergeResult } from '../library/pack';

/**
 * Brings a bundled library pack into this device's database, once per pack version.
 * Returns what changed, or null when this version was already applied.
 */
export async function applyPack(pack: LibraryPack): Promise<MergeResult | null> {
  const problems = validatePack(pack);
  if (problems.length) throw new Error(`Library pack ${pack.packId} is invalid: ${problems.join(' ')}`);

  const key = `pack:${pack.packId}`;
  return db.transaction('rw', db.sources, db.clauses, db.settings, async () => {
    const applied = (await db.settings.get(key))?.value as { version?: string } | undefined;
    if (applied?.version === pack.packVersion) return null;

    const result = planMerge(pack, await db.clauses.toArray());
    await db.sources.bulkPut(result.sources);
    await db.clauses.bulkPut(result.clauses);
    await db.settings.put({
      key,
      value: {
        version: pack.packVersion,
        appliedOn: today(),
        added: result.added,
        reopened: result.reopened,
        updated: result.updated,
      },
    });
    return result;
  });
}
