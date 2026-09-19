import { describe, expect, it } from 'vitest';
import core from '../library/packs/core.json';
import { runChecks, type DesignContext } from '../src/design/checks';
import { computeBoards } from '../src/design/engine';
import type { Board, Circuit, DirectLoad } from '../src/design/types';
import { dropPercent, tableFromParams } from '../src/design/voltageDrop';
import type { LibraryPack } from '../src/library/pack';
import { lookupFrom } from '../src/library/provenance';
import type { Clause } from '../src/library/types';

// Fictional boards; rule values come from the bundled pack, treated here as verified by the user.
const pack = core as LibraryPack;
const allVerified: Clause[] = pack.clauses.map((c) => ({ ...c, status: 'verified', reviewedOn: '2026-09-18', reviewNote: '', reviewedHash: '' }));
const declared = (value: number) => ({ value, basis: { kind: 'declared' as const, reason: 'test' } });

const board = (patch: Partial<Board>): Board => ({
  id: 'b', projectId: 'p', building: 'A', ref: 'B', kind: 'DB', parentId: null, supply: null, phases: 3,
  incomerDevice: '', incomerA: null, faultKA: null, cable: '', eccMm2: null, lengthM: null, feeder: null,
  loadCategory: null, circuitDemandFactor: null, childFactor: null, spareFactor: null, circuits: [], loads: [],
  meters: { singlePhase: 0, threePhase: 0, ct: 0 }, location: '', remarks: '', ...patch,
});
const load = (patch: Partial<DirectLoad>): DirectLoad => ({
  id: 'l', label: 'Load', kind: 'equipment', category: null, phaseKW: { R: 0, Y: 0, B: 0 },
  demandFactor: declared(1), standbyKW: 0, largestMotorKW: null, remarks: '', ...patch,
});
const circuit = (patch: Partial<Circuit>): Circuit => ({
  id: 'c', no: '1', phase: 'R', breakerA: 20, rcdMA: 30, wireMm2: 2.5, eccMm2: 2.5, lengthM: null, cableKind: null,
  area: 'Room', points: {}, equipmentW: 0, standby: false, remarks: '', ...patch,
});

function checks(boards: Board[], clauses: Clause[] = allVerified, extra: Partial<DesignContext> = {}) {
  return runChecks({
    library: lookupFrom(clauses, pack.sources),
    boards,
    results: computeBoards(boards, []),
    pointTypes: [],
    designPowerFactor: declared(0.8),
    nocKWByBuilding: {},
    vdCurrentBasis: 'demand',
    ...extra,
  });
}

describe('transformer size (schedule maximum demand against the DEWA note limits)', () => {
  const lvp = (loads: DirectLoad[], kVA: number | null = 1000) =>
    board({ id: 'lvp', ref: 'LVP-1', kind: 'LVP', supply: kVA === null ? null : { kind: 'transformer', kVA }, loads });
  const flats = (kw: number, standbyKW = 0) => load({ id: `l${kw}`, phaseKW: { R: kw / 3, Y: kw / 3, B: kw / 3 }, demandFactor: declared(0.7), standbyKW });

  it('passes when the maximum demand is within the limit, standby left out', () => {
    // 1,000 kW × 0.7 = 700 kW against 765 kW on 1,000 kVA; the 120 kW standby load is not counted.
    const result = checks([lvp([flats(1000), load({ id: 'fire', phaseKW: { R: 40, Y: 40, B: 40 }, standbyKW: 120 })])]).find((c) => c.id === 'transformer:lvp')!;
    expect(result.status).toBe('pass');
    expect(result.message).toMatch(/700 kW against 765 kW allowed on 1000 kVA/);
    expect(result.clauseIds).toEqual(['designer-sizing-rules/lv-panel-transformer', 'dewa-transformer-md-note/limits']);
  });

  it('fails and names the size needed when the demand exceeds the limit', () => {
    const result = checks([lvp([flats(1200)])]).find((c) => c.id === 'transformer:lvp')!;
    // 840 kW needs 1,250 kVA (956 kW).
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/needs 1250 kVA/);
  });

  it('proposes a size when none is entered on an LV panel', () => {
    const result = checks([lvp([flats(600)], null)]).find((c) => c.id === 'transformer:lvp')!; // 420 kW
    expect(result).toMatchObject({ status: 'info', message: expect.stringContaining('needs 630 kVA') });
  });

  it('is blocked for a rating the note does not list, and never falls back to other sources', () => {
    expect(checks([lvp([flats(10)], 800)]).find((c) => c.id === 'transformer:lvp')!.status).toBe('blocked');
    const withoutNote = allVerified.filter((c) => !c.id.startsWith('dewa-transformer-md-note'));
    expect(checks([lvp([flats(10)])], withoutNote).find((c) => c.id === 'transformer:lvp')!.status).toBe('blocked');
  });
});

describe('phase imbalance (the user\'s limits)', () => {
  it('allows less than 10% on SMDBs and MDBs', () => {
    const smdb = board({ id: 's', ref: 'SMDB', kind: 'SMDB', loads: [load({ phaseKW: { R: 10, Y: 10, B: 10.9 } })] });
    expect(checks([smdb]).find((c) => c.id === 'imbalance:s')!.status).toBe('pass');
    const bad = board({ id: 's', ref: 'SMDB', kind: 'SMDB', loads: [load({ phaseKW: { R: 10, Y: 10, B: 13 } })] });
    expect(checks([bad]).find((c) => c.id === 'imbalance:s')!.status).toBe('fail');
  });

  it('allows less than 3% on final DBs and unit DB types', () => {
    const db = board({ id: 'd', ref: 'DB', kind: 'DB', loads: [load({ phaseKW: { R: 3, Y: 3, B: 3.3 } })] });
    expect(checks([db]).find((c) => c.id === 'imbalance:d')!.status).toBe('fail');
    const unit = { id: 'u', name: 'STD', phaseKW: { R: 2.6, Y: 3, B: 3.1 }, phases: 3 as const, metered: true, factorRef: 'dfFlatDb' };
    const result = checks([db], allVerified, { unitTypes: [unit] }).find((c) => c.id === 'imbalance:Unit DB type STD')!;
    expect(result).toMatchObject({ status: 'fail', message: expect.stringContaining('limit below 3%') });
  });
});

describe('voltage drop', () => {
  it('reads chart parameters into a size table', () => {
    const table = tableFromParams([{ key: 'vdMvAm_2_5', value: 19 }, { key: 'vdMvAm_240', value: 0.21 }, { key: 'other', value: 1 }]);
    expect([...table.entries()]).toEqual([[2.5, 19], [240, 0.21]]);
  });

  it('computes drop as mV/A/m × A × m ÷ 1000 ÷ runs, as % of nominal voltage', () => {
    // 0.21 mV/A/m × 300 A × 100 m = 6.3 V → 1.575% of 400 V.
    expect(dropPercent(0.21, 300, 100, 1, 400)).toBeCloseTo(1.575, 10);
    expect(dropPercent(0.21, 300, 100, 2, 400)).toBeCloseTo(0.7875, 10);
  });

  it('adds sub-main and circuit drops from the point of supply', () => {
    const boards = [
      board({ id: 'lvp', ref: 'LVP', kind: 'LVP', supply: { kind: 'transformer', kVA: 1000 } }),
      board({
        id: 'smdb',
        ref: 'SMDB',
        kind: 'SMDB',
        parentId: 'lvp',
        feeder: { kind: 'pvcSheathed', sizeMm2: 240, runs: 1, lengthM: 100 },
        loads: [load({ category: 'other', phaseKW: { R: 50, Y: 50, B: 50 } })],
      }),
      board({
        id: 'db',
        ref: 'DB',
        parentId: 'smdb',
        feeder: { kind: 'pvcSheathed', sizeMm2: 16, runs: 1, lengthM: 30 },
        loadCategory: 'other',
        circuitDemandFactor: declared(1),
        circuits: [circuit({ id: 'c1', equipmentW: 2000, lengthM: 20, wireMm2: 2.5, cableKind: 'singleCoreConduit' })],
      }),
    ];
    const results = checks(boards);
    const vd = results.find((c) => c.id === 'vd:db:c1')!;
    const pf = 0.8;
    const smdbAmps = (152 * 1000) / (Math.sqrt(3) * 400 * pf); // demand: 150 kW + 2 kW
    const dbAmps = (2 * 1000) / (Math.sqrt(3) * 400 * pf);
    const circuitAmps = 2000 / (230 * pf);
    const expected =
      ((0.21 * smdbAmps * 100) / 1000 / 400) * 100 + ((2.5 * dbAmps * 30) / 1000 / 400) * 100 + ((19 * circuitAmps * 20) / 1000 / 230) * 100;
    expect(vd.status).toBe('pass');
    expect(vd.message).toContain(`${expected.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`);
    expect(vd.clauseIds).toContain('dewa-reference-chart-b/vd-pvc-sheathed');
  });

  it('is blocked, not guessed, when a size is missing from the chart or a setting is unset', () => {
    const boards = [
      board({ id: 'lvp', ref: 'LVP', supply: { kind: 'transformer', kVA: 1000 } }),
      board({
        id: 'db',
        ref: 'DB',
        parentId: 'lvp',
        feeder: { kind: 'pvcSheathed', sizeMm2: 6, runs: 1, lengthM: 30 },
        loadCategory: 'other',
        circuits: [circuit({ id: 'c1', equipmentW: 1000, lengthM: 10, cableKind: 'singleCoreConduit' })],
      }),
    ];
    expect(checks(boards).find((c) => c.id === 'vd:db:c1')).toMatchObject({ status: 'blocked', message: expect.stringContaining('no 6 mm² entry') });
    expect(checks(boards, allVerified, { vdCurrentBasis: null }).find((c) => c.id === 'vd:project')?.status).toBe('blocked');
  });
});

describe('spare capacity', () => {
  it('counts spares in full at their panel and at the main board factor when aggregated', () => {
    const boards = [
      board({
        id: 'mdb',
        ref: 'MDB',
        kind: 'MDB',
        spareFactor: declared(0.8),
        loads: [load({ id: 'mdb-spare', kind: 'spare', phaseKW: { R: 5 / 3, Y: 5 / 3, B: 5 / 3 }, demandFactor: declared(1) })],
      }),
      board({
        id: 'smdb',
        ref: 'SMDB',
        kind: 'SMDB',
        parentId: 'mdb',
        rowFactor: declared(0.7),
        loads: [
          load({ id: 'flats', phaseKW: { R: 20 / 3, Y: 20 / 3, B: 20 / 3 }, demandFactor: declared(0.7) }),
          load({ id: 'spare', kind: 'spare', phaseKW: { R: 10 / 3, Y: 10 / 3, B: 10 / 3 }, demandFactor: declared(1) }),
        ],
      }),
    ];
    const results = computeBoards(boards, []);
    // Panel: 20 × 0.7 + 10 × 1.0 = 24 kW.
    expect(results.get('smdb')!.demandKW).toBeCloseTo(24, 10);
    // Main board: 14 + (10 + 5) × 0.8 = 26 kW.
    expect(results.get('mdb')!.demandKW).toBeCloseTo(26, 10);
    expect(results.get('mdb')!.spareKW).toBeCloseTo(15, 10);
  });
});

describe('project demand factor table', () => {
  it('uses the table value for linked factors, so one change updates every way', () => {
    const linked = { value: 0.7, basis: { kind: 'declared' as const, reason: 'seed' }, ref: 'residentialSmdb' };
    const boards = [
      board({
        id: 'lvp',
        ref: 'LVP',
        loads: [
          load({ id: 'a', phaseKW: { R: 10, Y: 10, B: 10 }, demandFactor: linked }),
          load({ id: 'b', phaseKW: { R: 10, Y: 10, B: 10 }, demandFactor: linked }),
          load({ id: 'c', phaseKW: { R: 10, Y: 10, B: 10 }, demandFactor: declared(0.5) }),
        ],
      }),
    ];
    expect(computeBoards(boards, []).get('lvp')!.demandKW).toBeCloseTo(30 * 0.7 * 2 + 15, 10);
    // After the consultant meeting the table entry changes to 0.6; unlinked factors stay as they are.
    expect(computeBoards(boards, [], new Map([['residentialSmdb', 0.6]])).get('lvp')!.demandKW).toBeCloseTo(30 * 0.6 * 2 + 15, 10);
  });
});
