import type { Clause, ParamValue, Source } from './types';

/** How a value used in a calculation can be traced back. */
export type Provenance =
  | { kind: 'clause'; clauseId: string }
  | { kind: 'declared'; by: string; reason: string };

export type Resolution =
  | { usable: true; value: ParamValue; unit: string; provenance: Provenance; warnings: string[] }
  | { usable: false; reason: string };

export interface LibraryLookup {
  clause(id: string): Clause | undefined;
  source(id: string): Source | undefined;
}

/**
 * The single gate every calculation and check goes through: a value is only usable when it comes
 * from a clause the user has verified, in a source that is not superseded and is not a user note.
 */
export type ClauseCheck = { usable: true; clause: Clause; warnings: string[] } | { usable: false; reason: string };

/** Whether a whole clause may be relied on: verified, from a source that is not superseded or a note. */
export function usableClause(library: LibraryLookup, clauseId: string): ClauseCheck {
  const clause = library.clause(clauseId);
  if (!clause) return { usable: false, reason: `Clause ${clauseId} is not in the library.` };
  if (clause.status !== 'verified') {
    return { usable: false, reason: `${clause.ref} is ${clause.status}; it must be verified before use.` };
  }

  const source = library.source(clause.sourceId);
  if (!source) return { usable: false, reason: `The source of ${clause.ref} is missing from the library.` };
  if (source.type === 'user-note') {
    return { usable: false, reason: `${source.title} is a user note, not a source.` };
  }
  if (source.status === 'superseded') {
    return { usable: false, reason: `${source.title} ${source.edition} is superseded.` };
  }

  const warnings: string[] = [];
  if (source.status === 'unverified') warnings.push(`The edition of ${source.title} is not yet confirmed as current.`);
  if (source.type === 'project') warnings.push(`${clause.ref} is a project requirement, not an authority rule.`);
  return { usable: true, clause, warnings };
}

export function resolveFromClause(library: LibraryLookup, clauseId: string, key: string): Resolution {
  const checked = usableClause(library, clauseId);
  if (!checked.usable) return checked;
  const param = checked.clause.params.find((p) => p.key === key);
  if (!param) return { usable: false, reason: `${checked.clause.ref} does not state ${key}.` };
  return { usable: true, value: param.value, unit: param.unit, provenance: { kind: 'clause', clauseId }, warnings: checked.warnings };
}

/** A value the designer states without a document behind it. Exports must label it as such. */
export function declared(value: ParamValue, unit: string, by: string, reason: string): Resolution {
  if (!reason.trim()) return { usable: false, reason: 'A declared value needs a stated reason.' };
  return {
    usable: true,
    value,
    unit,
    provenance: { kind: 'declared', by, reason: reason.trim() },
    warnings: ["Designer's declared value, not taken from a source document."],
  };
}

export function lookupFrom(clauses: Clause[], sources: Source[]): LibraryLookup {
  const clauseById = new Map(clauses.map((c) => [c.id, c]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  return { clause: (id) => clauseById.get(id), source: (id) => sourceById.get(id) };
}
