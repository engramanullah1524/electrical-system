import { describe, expect, it } from 'vitest';
import core from '../library/packs/core.json';
import { runChecks, type DesignContext } from '../src/design/checks';
import { computeBoards } from '../src/design/engine';
import type { Board, Circuit, DirectLoad, PointType } from '../src/design/types';
import { lookupFrom } from '../src/library/provenance';
import type { LibraryPack } from '../src/library/pack';
import type { Clause } from '../src/library/types';

// Fictional boards; rule values come from the bundled pack, treated here as verified by the user.
const pack = core as LibraryPack;
const verified = (ids: string[] | 'all'): Clause[] =>
  pack.clauses.map((c) => ({
    ...c,
    status: ids === 'all' || ids.includes(c.id) ? 'verified' : 'candidate',
    reviewedOn: '2026-09-17',
    reviewNote: '',
    reviewedHash: '',
  }));

const declared = (value: number) => ({ value, basis: { kind: 'declared' as const, reason: 'test' } });

const types: PointType[] = [
  { id: 'dl', label: 'Downlight', category: 'lighting', watts: 10, socketsPerPoint: 1, basis: { kind: 'declared', reason: 'datasheet' } },
  { id: 'ts', label: 'Twin socket', category: 'socket13A', watts: 400, socketsPerPoint: 2, basis: { kind: 'declared', reason: 'test' } },
  { id: 'wh', label: 'Water heater', category: 'waterHeater', watts: 1200, socketsPerPoint: 1, basis: { kind: 'declared', reason: 'datasheet' } },
];

const circuit = (patch: Partial<Circuit>): Circuit => ({
  id: patch.no ?? 'c',
  no: '1',
  phase: 'R',
  breakerA: 10,
  rcdMA: 30,
  wireMm2: 2.5,
  eccMm2: 2.5,
  area: 'Bedroom',
  points: {},
  equipmentW: 0,
  standby: false,
  remarks: '',
  ...patch,
});

const board = (patch: Partial<Board>): Board => ({
  id: 'b',
  projectId: 'p',
  building: 'A',
  ref: 'DB',
  kind: 'DB',
  parentId: null,
  supply: null,
  phases: 3,
  incomerDevice: 'MCB',
  incomerA: null,
  faultKA: null,
  cable: '',
  eccMm2: null,
  lengthM: null,
  circuitDemandFactor: null,
  childFactor: null,
  circuits: [],
  loads: [],
  meters: { singlePhase: 0, threePhase: 0, ct: 0 },
  location: '',
  remarks: '',
  ...patch,
});

const load = (patch: Partial<DirectLoad>): DirectLoad => ({
  id: 'l',
  label: 'Load',
  kind: 'equipment',
  phaseKW: { R: 0, Y: 0, B: 0 },
  demandFactor: declared(1),
  standbyKW: 0,
  largestMotorKW: null,
  remarks: '',
  ...patch,
});

describe('computeBoards', () => {
  const flat = board({
    id: 'db1',
    ref: 'DB-101',
    parentId: 'smdb',
    circuitDemandFactor: declared(0.7),
    circuits: [
      circuit({ no: '1', phase: 'R', points: { dl: 11 } }),
      circuit({ no: '2', phase: 'Y', breakerA: 20, wireMm2: 4, points: { ts: 3 } }),
      circuit({ no: '3', phase: 'B', breakerA: 20, wireMm2: 4, points: { wh: 1 } }),
    ],
  });
  const smdb = board({
    id: 'smdb',
    ref: 'SMDB-1',
    kind: 'SMDB',
    parentId: 'lvp',
    loads: [load({ id: 'fp', label: 'Fire pump', phaseKW: { R: 10, Y: 10, B: 10 }, demandFactor: declared(0), standbyKW: 30 })],
  });
  const lvp = board({
    id: 'lvp',
    ref: 'LVP-1',
    kind: 'LVP',
    supply: { kind: 'transformer', kVA: 1000 },
    loads: [load({ id: 'spare', label: 'Spare', kind: 'spare', phaseKW: { R: 2, Y: 2, B: 2 }, demandFactor: declared(0.5) })],
  });
  const results = computeBoards([flat, smdb, lvp], types);

  it('adds point loads per phase and applies the circuit demand factor', () => {
    const r = results.get('db1')!;
    expect(r.connected).toEqual({ R: 0.11, Y: 1.2, B: 1.2 });
    expect(r.demandKW).toBeCloseTo(2.51 * 0.7, 10);
  });

  it('keeps standby load in connected load but out of maximum demand', () => {
    const r = results.get('smdb')!;
    expect(r.connectedKW).toBeCloseTo(32.51, 10);
    expect(r.standbyKW).toBe(30);
    expect(r.demandKW).toBeCloseTo(2.51 * 0.7, 10);
    expect(r.overallFactor).toBeCloseTo(0.7, 10);
  });

  it('adds sub-board demand upward without applying diversity twice', () => {
    const r = results.get('lvp')!;
    expect(r.connectedKW).toBeCloseTo(38.51, 10);
    expect(r.demandKW).toBeCloseTo(2.51 * 0.7 + 6 * 0.5, 10);
  });

  it('reports the largest phase deviation from the average', () => {
    const r = results.get('db1')!;
    const average = 2.51 / 3;
    // R (0.11 kW) is furthest from the average, below it.
    expect(r.phaseDeviationPercent).toBeCloseTo(((average - 0.11) / average) * 100, 10);
  });

  it('refuses a board that feeds itself', () => {
    const loopA = board({ id: 'a', ref: 'A', parentId: 'b2' });
    const loopB = board({ id: 'b2', ref: 'B', parentId: 'a' });
    expect(() => computeBoards([loopA, loopB], types)).toThrow('feeding itself');
  });

  it('flags unknown point types and a missing demand factor instead of guessing', () => {
    const r = computeBoards([board({ circuits: [circuit({ points: { mystery: 2 } })] })], types).get('b')!;
    expect(r.connectedKW).toBe(0);
    expect(r.issues.join(' ')).toMatch(/not defined/);
    expect(r.issues.join(' ')).toMatch(/no demand factor/);
  });
});

describe('runChecks', () => {
  const boards = [
    board({
      id: 'db',
      ref: 'DB-1',
      incomerA: 40,
      circuitDemandFactor: declared(0.7),
      supply: { kind: 'feeder', amps: 60 },
      circuits: [
        circuit({ id: 'light', no: '1', points: { dl: 250 } }), // 2,500 W on a lighting circuit
        circuit({ id: 'sock', no: '2', phase: 'Y', breakerA: 20, wireMm2: 2.5, points: { ts: 3 } }), // 6 outlets, thin wire
        circuit({ id: 'heat', no: '3', phase: 'B', breakerA: 20, wireMm2: 4, rcdMA: 100, points: { wh: 1 } }),
      ],
    }),
  ];
  const context = (clauses: Clause[]): DesignContext => ({
    library: lookupFrom(clauses, pack.sources),
    boards,
    results: computeBoards(boards, types),
    pointTypes: types,
    designPowerFactor: declared(0.8),
    nocKWByBuilding: { A: 5 },
  });

  it('refuses to judge anything against clauses that are not verified', () => {
    const checks = runChecks(context(verified([])));
    const judged = checks.filter((c) => c.status === 'pass' || c.status === 'fail');
    // Only the NOC comparison, which uses the project's own document, can run.
    expect(judged.map((c) => c.id)).toEqual(['noc:A']);
    expect(checks.some((c) => c.status === 'blocked')).toBe(true);
  });

  it('finds breaches once the clauses are verified', () => {
    const checks = runChecks(context(verified('all')));
    const status = (prefix: string) => checks.find((c) => c.id.startsWith(prefix))?.status;
    expect(status('lighting:db:light')).toBe('fail');
    expect(status('socket-wire:db:sock')).toBe('fail');
    expect(status('socket-count:db:sock')).toBe('fail');
    expect(status('heater-rcd:db:heat')).toBe('fail');
    expect(status('md-limit:db')).toBe('pass');
    expect(status('noc:A')).toBe('pass');
    expect(checks.find((c) => c.id === 'lighting:db:light')?.clauseIds).toEqual(['dm-dbc-2021/G.4.16.1']);
  });

  it('checks the incomer against full connected load at the declared power factor', () => {
    const incomer = runChecks(context(verified('all'))).find((c) => c.id === 'incomer:db')!;
    // Worst phase: 2.5 kW on R → 2500 / (230 × 0.8) ≈ 13.6 A, within a 40 A incomer.
    expect(incomer.status).toBe('pass');
    expect(incomer.message).toMatch(/13\.6 A/);
  });

  it('falls back to the DEWA 2017 clause when only that one is verified', () => {
    const checks = runChecks(context(verified(['dewa-rei-2017/4.7.2'])));
    expect(checks.find((c) => c.id === 'md-limit:db')).toMatchObject({ status: 'pass', clauseIds: ['dewa-rei-2017/4.7.2'] });
  });
});
