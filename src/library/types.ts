/**
 * Where a fact comes from. A 'user-note' is kept for reference only — for example a checklist made
 * with an AI tool — and can never back a calculation or a check.
 */
export type SourceType = 'authority' | 'standard' | 'manufacturer' | 'project' | 'user-note';

/** Whether the edition held has been confirmed as the one in force. */
export type SourceStatus = 'current' | 'superseded' | 'unverified';

export interface Source {
  id: string;
  title: string;
  issuer: string;
  type: SourceType;
  edition: string;
  date: string;
  /** Official page or PDF link, used to open the clause for checking. */
  url: string;
  /** Where the user's own copy is kept, when there is no public link. */
  localPath: string;
  status: SourceStatus;
  /** When the edition status was last checked against the issuer's site. */
  checkedOn: string;
  notes: string;
}

export type ClauseStatus = 'candidate' | 'verified' | 'rejected';
export type ParamValue = number | string | boolean;

export interface Param {
  key: string;
  value: ParamValue;
  unit: string;
}

export interface Clause {
  id: string;
  sourceId: string;
  /** The document's own reference, e.g. a clause, table or section number. */
  ref: string;
  page: number | null;
  title: string;
  /** A short paraphrase in our own words, never the document's text. */
  summary: string;
  params: Param[];
  tags: string[];
  status: ClauseStatus;
  reviewedOn: string;
  reviewNote: string;
}

export interface ItemAttribute {
  name: string;
  value: string;
  unit: string;
  clauseIds: string[];
}

/** An equipment or material type, e.g. an isolator, with facts that each point to clauses. */
export interface Item {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  attributes: ItemAttribute[];
  clauseIds: string[];
  notes: string;
}

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  authority: 'Authority',
  standard: 'Standard',
  manufacturer: 'Manufacturer',
  project: 'Project requirement',
  'user-note': 'User note (not a source)',
};

export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  current: 'Edition confirmed current',
  superseded: 'Superseded',
  unverified: 'Edition not yet confirmed',
};
