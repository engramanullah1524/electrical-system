import { describe, expect, it } from 'vitest';
import core from '../library/packs/core.json';
import { computeBoards } from '../src/design/engine';
import {
  breakerFor,
  cableFor,
  cableText,
  ctMeterFor,
  eccFor,
  loadSizingRules,
  lvIncomerFor,
  meterFor,
  sizeBoards,
  sizeOne,
  transformerFor,
  type SizingRules,
} from '../src/design/selection';
import type { Board, DirectLoad } from '../src/design/types';
import type { LibraryPack } from '../src/library/pack';
import { lookupFrom } from '../src/library/provenance';
import type { Clause, Source } from '../src/library/types';

const pack = core as LibraryPack;
const library = (status: Clause['status']) =>
  lookupFrom(
    pack.clauses.map((c) => ({ ...c, status, reviewedOn: '2026-09-19', reviewNote: '', reviewedHash: '' })),
    pack.sources as Source[],
  );
const rules: SizingRules = loadSizingRules(library('verified'));
const declared = (value: number) => ({ value, basis: { kind: 'declared' as const, reason: 'test' } });

describe('sizing rules from the library', () => {
  it('reads every part once the clauses are verified', () => {
    expect(rules.blocked).toEqual([]);
    expect(rules.breaker?.ratingsA).toContain(63);
    expect(rules.cables?.[0]).toMatchObject({ key: '10', sizeMm2: 10, runs: 1, maxKW: 15, cbA: 40 });
    expect(rules.cables?.find((r) => r.key === '2x240')).toMatchObject({ runs: 2, sizeMm2: 240, maxKW: 400, cbA: 800 });
    expect(rules.voltageLL).toBe(400);
  });

  it('blocks instead of guessing while the clauses are candidates', () => {
    const blocked = loadSizingRules(library('candidate'));
    expect(blocked.breaker).toBeNull();
    expect(blocked.blocked.length).toBeGreaterThan(0);
    expect(sizeOne(20, 3, true, blocked, false).notes).toContain('breaker rule not verified yet');
  });
});

describe('breaker and cable: TCL × 1.25 × 1.73, then the chart B row', () => {
  // TCL (kW) → breaker (A), cable, ECC (mm²): the rule's results as shown to the user on 2026-09-19.
  const cases: [number, number, string, number][] = [
    [224.21, 500, '1x4C 300', 150],
    [201.822, 500, '1x4C 300', 150],
    [112.602, 250, '1x4C 95', 50],
    [96.7, 225, '1x4C 95', 50],
    [80.56, 200, '1x4C 70', 35],
    [72.386, 160, '1x4C 50', 25],
    [32, 80, '1x4C 16', 16],
    [22, 63, '1x4C 16', 16],
    [8.659, 20, '1x4C 10', 10],
    [9.523, 32, '1x4C 10', 10],
    [18.66, 63, '1x4C 16', 16],
  ];
  it.each(cases)('%f kW → %i A, %s, ECC %i mm²', (tcl, breaker, cable, ecc) => {
    const sized = sizeOne(tcl, 3, false, rules, false);
    expect(sized.breakerA).toBe(breaker);
    expect(cableText(sized.cable!)).toBe(cable);
    expect(sized.eccMm2).toBe(ecc);
  });

  it('uses the higher value of a printed breaker range as the cable capacity', () => {
    expect(cableFor(80, 20, rules.cables!)?.key).toBe('16'); // 60–80 A
    expect(cableFor(250, 110, rules.cables!)?.key).toBe('95'); // 225–250 A
  });

  it('reports a load beyond the listed ratings instead of picking one', () => {
    expect(breakerFor(1200, rules.breaker!).breakerA).toBeNull();
    expect(sizeOne(1200, 3, false, rules, false).notes.join(' ')).toMatch(/above the largest listed rating/);
  });

  it('does not apply the three-phase rule to single-phase loads', () => {
    expect(sizeOne(5, 1, false, rules, false).notes.join(' ')).toMatch(/single-phase rule has not been set/);
  });
});

describe('ECC (Building Code Table G.20)', () => {
  const sizes = rules.breaker!.conductorSizesMm2;
  it('rounds S/2 up to the next standard size above 35 mm²', () => {
    expect(eccFor(150, rules.ecc!, sizes, null)).toEqual({ mm2: 95 });
    expect(eccFor(120, rules.ecc!, sizes, null)).toEqual({ mm2: 70 });
    expect(eccFor(185, rules.ecc!, sizes, null)).toEqual({ mm2: 95 });
    expect(eccFor(240, rules.ecc!, sizes, null)).toEqual({ mm2: 120 });
  });
  it('keeps small sizes and uses 16 mm² between 16 and 35', () => {
    expect(eccFor(16, rules.ecc!, sizes, null)).toEqual({ mm2: 16 });
    expect(eccFor(25, rules.ecc!, sizes, null)).toEqual({ mm2: 16 });
  });
  it('asks for exactly 35 mm², which the table skips', () => {
    expect(eccFor(35, rules.ecc!, sizes, null)).toMatchObject({ mm2: null });
  });
  it('uses the DEWA-approved 70 mm² for 150 mm² only when the project opts in', () => {
    expect(eccFor(150, rules.ecc!, sizes, rules.eccPrecedent150)).toMatchObject({ mm2: 70 });
    // 135 kW → 292 A → 300 A → 4C 150.
    expect(sizeOne(135, 3, false, rules, true)).toMatchObject({ breakerA: 300, eccMm2: 70 });
    expect(sizeOne(135, 3, false, rules, false).eccMm2).toBe(95);
  });
});

describe('meters, transformer and LV panel incomer', () => {
  it('picks direct meters up to the chart limits, then CT ratios', () => {
    expect(meterFor(8.7, 3, rules.meters!)).toEqual({ kind: '3PH' });
    expect(meterFor(52, 3, rules.meters!)).toEqual({ kind: '3PH' });
    expect(meterFor(53, 3, rules.meters!)).toEqual({ kind: 'CT', ratio: 100, checkMeter: false });
    expect(meterFor(9, 1, rules.meters!)).toEqual({ kind: '1PH' });
  });
  it('picks the LV panel CT meter from maximum demand', () => {
    expect(ctMeterFor(735.927, rules.meters!)).toEqual({ kind: 'CT', ratio: 1600, checkMeter: false });
    expect(ctMeterFor(1051.3, rules.meters!)).toEqual({ kind: 'CT', ratio: 2000, checkMeter: true });
  });
  it('sizes the transformer from maximum demand against the DEWA note limits', () => {
    expect(transformerFor(735.927, rules.transformer!)?.kVA).toBe(1000);
    expect(transformerFor(380, rules.transformer!)?.kVA).toBe(500);
    expect(transformerFor(1200, rules.transformer!)).toBeNull();
  });
  it('sets the ACB from the transformer full-load current', () => {
    const acb = lvIncomerFor(1000, rules.breaker!.ratingsA, 400);
    expect(acb.flcA).toBeCloseTo(1443.4, 1);
    expect(acb).toMatchObject({ acbA: 1600, setting: 0.9 });
  });
});

describe('sizing a chain of boards', () => {
  const base = (patch: Partial<Board>): Board => ({
    id: 'x', projectId: 'p', building: 'A', ref: 'X', kind: 'SMDB', parentId: null, supply: null, phases: 3, incomerDevice: '',
    incomerA: null, faultKA: null, cable: '', eccMm2: null, lengthM: null, feeder: null, loadCategory: null,
    circuitDemandFactor: null, childFactor: null, spareFactor: null, circuits: [], loads: [],
    meters: { singlePhase: 0, threePhase: 0, ct: 0 }, location: '', remarks: '', ...patch,
  });
  const unit = (id: string, kw: number): DirectLoad => ({
    id, label: `DB-${id}`, kind: 'equipment', category: null, phaseKW: { R: kw / 3, Y: kw / 3, B: kw / 3 },
    demandFactor: declared(0.7), standbyKW: 0, largestMotorKW: null, remarks: '', unitTypeId: 'studio', metered: true,
  });
  const boards = [
    base({ id: 'lvp', ref: 'LVP-1', kind: 'LVP' }),
    base({ id: 's1', ref: 'SMDB-1F', parentId: 'lvp', rowFactor: declared(0.7), loads: [unit('101', 9), unit('102', 9), unit('103', 18)] }),
  ];
  const results = computeBoards(boards, []);
  const sizing = sizeBoards(boards, results, rules, { eccPrecedent: false });

  it('sizes each unit way and the SMDB incomer from their connected loads', () => {
    const smdb = sizing.get('s1')!;
    expect(smdb.ways.get('101')).toMatchObject({ breakerA: 20, meter: { kind: '3PH' } });
    expect(smdb.ways.get('103')?.breakerA).toBe(40); // 18 × 2.1625 = 38.9 A
    expect(smdb.incomer).toMatchObject({ tclKW: 36, breakerA: 80 });
    expect(smdb.meters).toEqual({ singlePhase: 0, threePhase: 3, ct: 0 });
  });

  it('sizes the LV panel transformer, ACB and CT meter from its maximum demand', () => {
    const lvp = sizing.get('lvp')!;
    expect(results.get('lvp')!.demandKW).toBeCloseTo(36 * 0.7, 10);
    expect(lvp.lv).toMatchObject({ transformer: { kVA: 500 }, acbA: 800, ctMeter: { kind: 'CT', ratio: 100 } });
    expect(lvp.meters).toEqual({ singlePhase: 0, threePhase: 3, ct: 1 });
  });
});
