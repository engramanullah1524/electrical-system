import { usableClause, type LibraryLookup } from '../library/provenance';
import type { BoardSizing, Sized } from '../design/selection';
import type { Board, Environment } from '../design/types';
import type { GlandRow } from '../project/types';

/**
 * Glands and lugs to buy for every sized cable run, following the user's purchase rule: one run is a
 * 4-core cable with its ECC; the 4-core cable takes a gland at each end and a lug on each core at each
 * end, and the ECC takes its own ("LS") gland and a lug at each end. Glands are BW indoors and CW
 * outdoors and in pump rooms, chosen by where each end is; fire-rated cables take the LSF version.
 * Sizes come from the project's gland and lug table; anything missing is listed "to confirm".
 */
export const GLAND_CLAUSE = 'designer-glands-lugs/schedule';

/** Conductor sizes the table covers (the sizes printed on chart B from 4 mm² up). */
export const TABLE_SIZES = [4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];

export interface CableRun {
  from: string;
  to: string;
  runs: number;
  sizeMm2: number;
  eccMm2: number | null;
  fireRated: boolean;
  fromEnv: Environment | null;
  toEnv: Environment | null;
}

export interface PurchaseLine {
  description: string;
  qty: number;
  /** Set when a size or gland type is still missing; the line cannot be ordered until it is filled. */
  toConfirm: string | null;
  usedBy: string[];
}

export interface GlandRule {
  glandsPerRun: number;
  phaseLugsPerRun: number;
  eccGlandsPerRun: number;
  eccLugsPerRun: number;
}

export type GlandRuleResult = { ok: true; rule: GlandRule; seed: GlandRow[] } | { ok: false; reason: string };

/** Reads the purchase quantities and the seed sizes from the user's gland and lug schedule (a verified clause). */
export function loadGlandRule(library: LibraryLookup): GlandRuleResult {
  const checked = usableClause(library, GLAND_CLAUSE);
  if (!checked.usable) return { ok: false, reason: checked.reason };
  const get = (key: string) => checked.clause.params.find((p) => p.key === key)?.value;
  const n = (key: string) => (typeof get(key) === 'number' ? (get(key) as number) : NaN);
  const rule = { glandsPerRun: n('glandsPerRun'), phaseLugsPerRun: n('phaseLugsPerRun'), eccGlandsPerRun: n('eccGlandsPerRun'), eccLugsPerRun: n('eccLugsPerRun') };
  if (Object.values(rule).some((v) => !Number.isFinite(v))) return { ok: false, reason: `${checked.clause.ref} does not state the quantities per run.` };
  const text = (key: string) => (typeof get(key) === 'string' ? (get(key) as string) : '');
  const seed = TABLE_SIZES.map((size) => ({
    sizeMm2: size,
    gland: text(`gland_${size}`),
    lug: text(`lug_${size}`),
    eccGland: text(`eccGland_${size}`),
    eccLug: text(`eccLug_${size}`),
    source: `Your gland and lug schedule (${checked.clause.sourceId})`,
  }));
  return { ok: true, rule, seed };
}

/** Starts the project table from the schedule; rows the user already has are kept. */
export function seedGlandTable(seed: GlandRow[], existing: GlandRow[] = []): GlandRow[] {
  const have = new Map(existing.map((r) => [r.sizeMm2, r]));
  return seed.map((row) => have.get(row.sizeMm2) ?? row).concat(existing.filter((r) => !seed.some((s) => s.sizeMm2 === r.sizeMm2)));
}

/** Every cable the sizing chose: each sub-board's feeder and each sized unit way. */
export function cableRuns(boards: Board[], sizing: Map<string, BoardSizing>): CableRun[] {
  const byId = new Map(boards.map((b) => [b.id, b]));
  const runs: CableRun[] = [];
  const push = (from: Board, to: string, sized: Sized | null | undefined, fireRated: boolean, toEnv: Environment | null) => {
    if (!sized?.cable) return;
    runs.push({ from: from.ref, to, runs: sized.cable.runs, sizeMm2: sized.cable.sizeMm2, eccMm2: sized.eccMm2, fireRated, fromEnv: from.environment ?? null, toEnv });
  };
  for (const board of boards) {
    const parent = board.parentId ? byId.get(board.parentId) : undefined;
    if (parent) push(parent, board.ref, sizing.get(board.id)?.incomer, board.fireRated ?? false, board.environment ?? null);
    for (const load of board.loads) push(board, load.label, sizing.get(board.id)?.ways.get(load.id), load.fireRated ?? false, load.environment ?? null);
  }
  return runs;
}

const glandType = (env: Environment | null) => (env === 'indoor' ? 'BW' : env === 'outdoor' || env === 'pumpRoom' ? 'CW' : null);

/** The purchase list: identical items added together, each with the runs that need it. */
export function glandsAndLugs(runs: CableRun[], table: GlandRow[], rule: GlandRule): PurchaseLine[] {
  const rows = new Map(table.map((r) => [r.sizeMm2, r]));
  const lines = new Map<string, PurchaseLine>();
  const add = (description: string, qty: number, toConfirm: string | null, usedBy: string) => {
    const line = lines.get(description) ?? { description, qty: 0, toConfirm, usedBy: [] };
    line.qty += qty;
    if (!line.usedBy.includes(usedBy)) line.usedBy.push(usedBy);
    lines.set(description, line);
  };

  for (const run of runs) {
    const label = `${run.from} → ${run.to}`;
    const row = rows.get(run.sizeMm2);
    const cable = `4C ${run.sizeMm2} mm²`;
    // One gland at each end of each cable.
    const perEnd = rule.glandsPerRun / 2;
    for (const [end, env] of [
      [run.from, run.fromEnv],
      [run.to, run.toEnv],
    ] as const) {
      const type = glandType(env);
      const size = row?.gland;
      const missing = [!type && `location of ${end} not set`, !size && `gland size for ${cable}`].filter(Boolean).join('; ');
      const description = `Brass Cable Gland ${type ?? 'BW/CW'} - ${size || `? (${cable})`}${run.fireRated ? '-LSF' : ''}`;
      add(description, perEnd * run.runs, missing || null, label);
    }
    const lug = row?.lug;
    add(lug ? `Copper Cable Lug ${lug}` : `Copper Cable Lug ${run.sizeMm2} mm² × ? mm`, rule.phaseLugsPerRun * run.runs, lug ? null : `lug for ${cable}`, label);

    const eccRow = run.eccMm2 === null ? undefined : rows.get(run.eccMm2);
    const ecc = run.eccMm2 === null ? `ECC of ${cable}, size to confirm` : `1C ${run.eccMm2} mm² ECC`;
    const eccGland = eccRow?.eccGland;
    add(eccGland ? `ECC Cable Gland ${eccGland}` : `ECC Cable Gland LS - ? (${ecc})`, rule.eccGlandsPerRun * run.runs, eccGland ? null : `ECC gland size for ${ecc}`, label);
    const eccLug = eccRow?.eccLug;
    add(
      eccLug ? `Tinned Copper Cable Lug ${eccLug} (ECC)` : `Tinned Copper Cable Lug ${run.eccMm2 ?? '?'} mm² × ? mm (ECC)`,
      rule.eccLugsPerRun * run.runs,
      eccLug ? null : `ECC lug for ${ecc}`,
      label,
    );
  }
  return [...lines.values()].sort((a, b) => Number(Boolean(a.toConfirm)) - Number(Boolean(b.toConfirm)) || a.description.localeCompare(b.description, undefined, { numeric: true }));
}
