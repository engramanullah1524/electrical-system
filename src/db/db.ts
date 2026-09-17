import Dexie, { type EntityTable } from 'dexie';
import type { Clause, Item, Source } from '../library/types';
import type { Project } from '../project/types';

export interface Setting {
  key: string;
  value: unknown;
}

/** Local-first store: everything works offline, and sync only copies it to Drive. */
export const db = new Dexie('electrical-system') as Dexie & {
  sources: EntityTable<Source, 'id'>;
  clauses: EntityTable<Clause, 'id'>;
  items: EntityTable<Item, 'id'>;
  projects: EntityTable<Project, 'id'>;
  settings: EntityTable<Setting, 'key'>;
};

db.version(1).stores({
  sources: 'id, type, status',
  clauses: 'id, sourceId, status, *tags',
  items: 'id, name, category, *aliases',
  projects: 'id, name, updatedAt',
  settings: 'key',
});

export const today = () => new Date().toISOString().slice(0, 10);
