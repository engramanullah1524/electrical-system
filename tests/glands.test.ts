import { describe, expect, it } from 'vitest';
import core from '../library/packs/core.json';
import { cableRuns, glandsAndLugs, loadGlandRule, seedGlandTable, type CableRun } from '../src/procurement/glands';
import type { LibraryPack } from '../src/library/pack';
import { lookupFrom } from '../src/library/provenance';
import type { Clause, Source } from '../src/library/types';
import type { Board } from '../src/design/types';
import type { BoardSizing } from '../src/design/selection';

const pack = core as LibraryPack;
const library = (status: Clause['status']) =>
  lookupFrom(pack.clauses.map((c) => ({ ...c, status, reviewedOn: '', reviewNote: '', reviewedHash: '' })), pack.sources as Source[]);
const loaded = loadGlandRule(library('verified'));
if (!loaded.ok) throw new Error(loaded.reason);
const table = seedGlandTable(loaded.seed);

const run = (patch: Partial<CableRun>): CableRun => ({ from: 'LVP', to: 'SMDB', runs: 1, sizeMm2: 300, eccMm2: 150, fireRated: false, fromEnv: 'indoor', toEnv: 'indoor', ...patch });
const qty = (lines: ReturnType<typeof glandsAndLugs>, description: string) => lines.find((l) => l.description === description)?.qty;

describe('glands and lugs per cable run (the user’s purchase rule)', () => {
  it('reads the quantities per run and seeds the sizes from the schedule', () => {
    expect(loaded.rule).toEqual({ glandsPerRun: 2, phaseLugsPerRun: 8, eccGlandsPerRun: 2, eccLugsPerRun: 2 });
    expect(table.find((r) => r.sizeMm2 === 16)).toMatchObject({ gland: '25L', lug: '16 × 6 mm', eccGland: '', eccLug: '' });
    expect(table.find((r) => r.sizeMm2 === 150)).toMatchObject({ gland: '50L', eccGland: 'LS 32 mm' });
  });

  it('takes two glands and eight lugs for the 4-core cable and two glands and two lugs for its ECC', () => {
    const lines = glandsAndLugs([run({})], table, loaded.rule);
    expect(qty(lines, 'Brass Cable Gland BW - 75L')).toBe(2);
    expect(qty(lines, 'Copper Cable Lug 300 × 12 mm')).toBe(8);
    expect(qty(lines, 'ECC Cable Gland LS 32 mm')).toBe(2);
    // The ECC lug hole is not in the schedule yet: it stays on the list, marked to confirm.
    expect(lines.find((l) => l.description.startsWith('Tinned Copper Cable Lug 150'))).toMatchObject({ qty: 2, toConfirm: expect.stringContaining('ECC lug') });
  });

  it('chooses BW or CW at each end, LSF for fire-rated cables, and counts every parallel run', () => {
    const lines = glandsAndLugs([run({ runs: 2, sizeMm2: 240, eccMm2: 120, fireRated: true, toEnv: 'pumpRoom' })], table, loaded.rule);
    expect(qty(lines, 'Brass Cable Gland BW - 63L-LSF')).toBe(2);
    expect(qty(lines, 'Brass Cable Gland CW - 63L-LSF')).toBe(2);
    expect(qty(lines, 'Copper Cable Lug 240 × 12 mm')).toBe(16);
    expect(qty(lines, 'ECC Cable Gland LS 32 mm')).toBe(4);
  });

  it('marks what is missing instead of guessing', () => {
    const lines = glandsAndLugs([run({ sizeMm2: 35, eccMm2: null, toEnv: null })], table, loaded.rule);
    expect(lines.every((l) => l.qty > 0)).toBe(true);
    expect(lines.find((l) => l.description.startsWith('Brass Cable Gland BW/CW'))?.toConfirm).toMatch(/location of SMDB not set; gland size for 4C 35/);
    expect(lines.find((l) => l.description.startsWith('ECC Cable Gland'))?.toConfirm).toMatch(/size to confirm/);
  });

  it('is blocked until the schedule clause is verified', () => {
    expect(loadGlandRule(library('candidate')).ok).toBe(false);
  });

  it('collects a run for each sized feeder and unit way', () => {
    const sized = { tclKW: 9, designA: 19, breakerA: 20, cable: { key: '10', runs: 1, sizeMm2: 10, maxKW: 15, cbA: 40, cbMinA: null }, eccMm2: 10, meter: null, notes: [] };
    const boards = [
      { id: 'p', ref: 'LVP', parentId: null, environment: 'indoor', loads: [] },
      { id: 's', ref: 'SMDB-1F', parentId: 'p', environment: 'indoor', loads: [{ id: 'u', label: 'DB-101 (STD)', environment: 'indoor' }] },
    ] as unknown as Board[];
    const sizing = new Map<string, BoardSizing>([
      ['p', { boardId: 'p', incomer: null, lv: null, ways: new Map(), meters: { singlePhase: 0, threePhase: 0, ct: 0 } }],
      ['s', { boardId: 's', incomer: sized, lv: null, ways: new Map([['u', sized]]), meters: { singlePhase: 0, threePhase: 1, ct: 0 } }],
    ]);
    expect(cableRuns(boards, sizing).map((r) => `${r.from} → ${r.to} 4C${r.sizeMm2}`)).toEqual(['LVP → SMDB-1F 4C10', 'SMDB-1F → DB-101 (STD) 4C10']);
  });
});
