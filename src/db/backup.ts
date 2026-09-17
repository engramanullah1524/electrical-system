import { db } from './db';

// Settings are left out on purpose: they hold the sync token.
const TABLES = ['sources', 'clauses', 'items', 'projects'] as const;
type TableName = (typeof TABLES)[number];

interface Backup {
  app: 'electrical-system';
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

export async function exportBackup(): Promise<Blob> {
  const tables = {} as Record<TableName, unknown[]>;
  for (const name of TABLES) tables[name] = await db.table(name).toArray();
  const backup: Backup = { app: 'electrical-system', exportedAt: new Date().toISOString(), tables };
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

/** Merges a backup into this device: records with the same id are replaced, others are kept. */
export async function importBackup(text: string): Promise<number> {
  const backup = JSON.parse(text) as Partial<Backup>;
  if (backup.app !== 'electrical-system' || !backup.tables) throw new Error('This is not a backup from this app.');
  let count = 0;
  await db.transaction('rw', TABLES.map((name) => db.table(name)), async () => {
    for (const name of TABLES) {
      const rows = backup.tables?.[name] ?? [];
      await db.table(name).bulkPut(rows);
      count += rows.length;
    }
  });
  return count;
}
