import type { Clause, ClauseStatus, Source, SourceStatus, SourceType } from './types';

/**
 * A library pack carries sources and draft clauses prepared on the laptop to every device.
 * Pack clauses always arrive as candidates: a device never trusts a clause until its user has
 * checked it, and a later pack that changes a clause sends it back for review.
 */
export interface LibraryPack {
  format: 'electrical-system-library';
  formatVersion: 1;
  packId: string;
  packVersion: string;
  sources: Source[];
  clauses: PackClause[];
}

export type PackClause = Omit<Clause, 'status' | 'reviewedOn' | 'reviewNote' | 'reviewedHash'>;

type HashedFields = Pick<Clause, 'sourceId' | 'ref' | 'page' | 'pageLabel' | 'title' | 'summary' | 'params'>;

/** FNV-1a over the fields a reviewer checks, so any change to them is detected. */
export function clauseHash(clause: HashedFields): string {
  const text = JSON.stringify([
    clause.sourceId,
    clause.ref,
    clause.page,
    clause.pageLabel,
    clause.title,
    clause.summary,
    clause.params.map((p) => [p.key, p.value, p.unit]),
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const SOURCE_TYPES: SourceType[] = ['authority', 'provider', 'standard', 'manufacturer', 'project', 'user-note'];
const SOURCE_STATUSES: SourceStatus[] = ['current', 'superseded', 'unverified'];
const MAX_SUMMARY = 900;

/** Lists everything wrong with a pack; an empty list means it can be applied. */
export function validatePack(pack: LibraryPack): string[] {
  const problems: string[] = [];
  if (pack.format !== 'electrical-system-library' || pack.formatVersion !== 1) problems.push('Unknown pack format.');
  if (!pack.packId || !pack.packVersion) problems.push('Pack id and version are required.');

  const sourceIds = new Set<string>();
  for (const source of pack.sources) {
    if (sourceIds.has(source.id)) problems.push(`Duplicate source id ${source.id}.`);
    sourceIds.add(source.id);
    if (!source.title || !source.issuer) problems.push(`${source.id}: title and issuer are required.`);
    if (!SOURCE_TYPES.includes(source.type)) problems.push(`${source.id}: unknown type ${source.type}.`);
    if (!SOURCE_STATUSES.includes(source.status)) problems.push(`${source.id}: unknown status ${source.status}.`);
    if (source.status === 'current' && (!source.url || !source.checkedOn)) {
      problems.push(`${source.id}: a current edition needs the official link and the date it was checked.`);
    }
  }

  const clauseIds = new Set<string>();
  for (const clause of pack.clauses) {
    if (clauseIds.has(clause.id)) problems.push(`Duplicate clause id ${clause.id}.`);
    clauseIds.add(clause.id);
    if (!sourceIds.has(clause.sourceId)) problems.push(`${clause.id}: source ${clause.sourceId} is not in the pack.`);
    if (!clause.ref || !clause.summary) problems.push(`${clause.id}: reference and summary are required.`);
    if (!Number.isInteger(clause.page) || (clause.page ?? 0) < 1) problems.push(`${clause.id}: needs a PDF page number.`);
    if (clause.summary.length > MAX_SUMMARY) problems.push(`${clause.id}: summary is too long for a paraphrase.`);
    const keys = clause.params.map((p) => p.key);
    if (new Set(keys).size !== keys.length) problems.push(`${clause.id}: repeated parameter key.`);
  }
  return problems;
}

export interface MergeResult {
  sources: Source[];
  clauses: Clause[];
  added: number;
  reopened: number;
  updated: number;
}

/**
 * Works out what a pack changes on this device. Pack sources replace local copies of the same id.
 * New clauses are added as candidates; a reviewed clause keeps its decision unless the pack
 * changed what was reviewed, in which case it goes back to the review queue with a note.
 */
export function planMerge(pack: LibraryPack, localClauses: Clause[]): MergeResult {
  const local = new Map(localClauses.map((c) => [c.id, c]));
  const clauses: Clause[] = [];
  let added = 0;
  let reopened = 0;
  let updated = 0;

  for (const incoming of pack.clauses) {
    const existing = local.get(incoming.id);
    if (!existing) {
      clauses.push({ ...incoming, status: 'candidate', reviewedOn: '', reviewNote: '', reviewedHash: '' });
      added++;
      continue;
    }
    const hash = clauseHash(incoming);
    if (existing.status === 'candidate') {
      if (clauseHash(existing) !== hash) {
        clauses.push({ ...existing, ...incoming });
        updated++;
      }
      continue;
    }
    if (existing.reviewedHash !== hash) {
      const was: ClauseStatus = existing.status;
      clauses.push({
        ...incoming,
        status: 'candidate',
        reviewedOn: '',
        reviewedHash: '',
        reviewNote: `A library update changed this clause after you marked it ${was} on ${existing.reviewedOn}. Check it again.`,
      });
      reopened++;
    }
  }

  return { sources: pack.sources, clauses, added, reopened, updated };
}
