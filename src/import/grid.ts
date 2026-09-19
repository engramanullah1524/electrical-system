/** A worksheet as plain values (formulas already evaluated by Excel), row by row. */
export type Cell = string | number | boolean | null;

export interface SheetGrid {
  name: string;
  rows: Cell[][];
}

export const text = (v: Cell | undefined): string => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim();
export const upper = (v: Cell | undefined) => text(v).toUpperCase();
export const compact = (v: Cell | undefined) => upper(v).replace(/\s+/g, '');
export const num = (v: Cell | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Board names compared the way people write them: "MAIN DB -1-TC" matches sheet "MAIN DB-1-TC". */
export const sameName = (a: string, b: string) => a.toUpperCase().replace(/[^A-Z0-9&]/g, '') === b.toUpperCase().replace(/[^A-Z0-9&]/g, '');
