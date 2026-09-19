import { describe, expect, it } from 'vitest';
import core from '../library/packs/core.json';
import { computeBoards, factorTable } from '../src/design/engine';
import { balanceRotations, planTypical, rotate } from '../src/design/typical';
import type { Board } from '../src/design/types';
import type { LibraryPack } from '../src/library/pack';
import type { Clause } from '../src/library/types';
import { seedFactors } from '../src/project/factors';
import type { Project, TypicalFloor, UnitType } from '../src/project/types';

const factors = seedFactors((core as LibraryPack).clauses as unknown as Clause[]);

// Fictional unit loads (kW per phase).
const studio: UnitType = { id: 'std', name: 'STD', phaseKW: { R: 2.6, Y: 3.0, B: 3.1 }, phases: 3, metered: true, factorRef: 'dfFlatDb' };
const oneBed: UnitType = { id: '1bhk', name: '1BHK', phaseKW: { R: 3.2, Y: 3.2, B: 3.1 }, phases: 3, metered: true, factorRef: 'dfFlatDb' };
const floor = (n: number, panel: string, counts: Record<string, number>): TypicalFloor => ({
  id: `f${n}`, building: 'A', floor: `${n}F`, smdb: `SMDB-${n}F`, panel, firstUnitNo: n * 100 + 1, counts,
});
const project = (floors: TypicalFloor[]): Project => ({
  id: 'p', name: 'Test', permitAuthority: 'DM', authorityConfirmed: false, buildings: ['A'], notes: '', createdAt: '', updatedAt: '',
  unitTypes: [studio, oneBed], typicalFloors: floors, demandFactors: factors,
});

describe('phase rotation', () => {
  it('rotates cyclically, keeping the phase sequence', () => {
    expect(rotate({ R: 1, Y: 2, B: 3 }, 1)).toEqual({ R: 3, Y: 1, B: 2 });
    expect(rotate({ R: 1, Y: 2, B: 3 }, 2)).toEqual({ R: 2, Y: 3, B: 1 });
  });
  it('spreads identical unbalanced units over the three phases', () => {
    const r = balanceRotations({ R: 0, Y: 0, B: 0 }, [0, 1, 2].map(() => ({ R: 3, Y: 0, B: 0 })));
    expect([...r].sort()).toEqual([0, 1, 2]);
  });
});

describe('typical floor plan', () => {
  const floors = [1, 2, 3].map((n) => floor(n, 'LV PANEL-01', { std: 8, '1bhk': 4 }));
  const plan = planTypical(project(floors), [], factors);
  const byRef = new Map(plan.boards.map((b) => [b.ref, b]));

  it('makes one SMDB per floor under its LV panel, with one way per unit', () => {
    expect([...byRef.keys()].sort()).toEqual(['LV PANEL-01', 'SMDB-1F', 'SMDB-2F', 'SMDB-3F']);
    const smdb = byRef.get('SMDB-2F')!;
    expect(smdb.parentId).toBe(byRef.get('LV PANEL-01')!.id);
    expect(smdb.loads).toHaveLength(12);
    expect(smdb.loads[0]).toMatchObject({ label: 'DB-201 (STD)', unitTypeId: 'std', metered: true, demandFactor: { ref: 'dfFlatDb', value: 0.7 } });
    expect(smdb.loads[8].label).toBe('DB-209 (1BHK)');
    expect(smdb.rowFactor).toMatchObject({ ref: 'dfResidentialSmdb' });
    expect(byRef.get('LV PANEL-01')!.spareFactor).toMatchObject({ ref: 'spareAtMainBoard' });
  });

  it('adds up to the floor totals and balances the SMDB phases within the 10% limit', () => {
    const results = computeBoards(plan.boards, [], factorTable(factors));
    const smdb = results.get(byRef.get('SMDB-1F')!.id)!;
    expect(smdb.connectedKW).toBeCloseTo(8 * 8.7 + 4 * 9.5, 10);
    expect(smdb.demandKW).toBeCloseTo((8 * 8.7 + 4 * 9.5) * 0.7, 10);
    expect(smdb.phaseDeviationPercent!).toBeLessThan(1);
    const panel = results.get(byRef.get('LV PANEL-01')!.id)!;
    expect(panel.demandKW).toBeCloseTo(3 * (8 * 8.7 + 4 * 9.5) * 0.7, 10);
  });

  it('updates its own boards when run again and keeps the user’s ways', () => {
    const smdb = byRef.get('SMDB-1F')!;
    const edited: Board[] = plan.boards.map((b) =>
      b.id === smdb.id ? { ...b, loads: [...b.loads, { ...b.loads[0], id: 'sauna', label: 'SAUNA', unitTypeId: undefined }] } : b,
    );
    const again = planTypical(project([floor(1, 'LV PANEL-01', { std: 2, '1bhk': 0 })]), edited, factors);
    const updated = again.boards.find((b) => b.ref === 'SMDB-1F')!;
    expect(updated.id).toBe(smdb.id);
    expect(updated.loads.map((l) => l.label)).toEqual(['DB-101 (STD)', 'DB-102 (STD)', 'SAUNA']);
    // SMDB-2F and SMDB-3F are no longer in the plan and hold nothing of the user's.
    expect(again.removeIds.sort()).toEqual([byRef.get('SMDB-2F')!.id, byRef.get('SMDB-3F')!.id].sort());
  });

  it('leaves out units whose factor is missing and says so', () => {
    const noFactor = planTypical(project([floor(1, 'LV PANEL-01', { std: 2 })]), [], []);
    expect(noFactor.boards.find((b) => b.ref === 'SMDB-1F')!.loads).toHaveLength(0);
    expect(noFactor.notes.join(' ')).toMatch(/no "dfFlatDb" entry/);
  });
});
