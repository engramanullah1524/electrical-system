import { linkedFactor } from '../project/factors';
import type { Project, TypicalFloor, UnitType } from '../project/types';
import type { Board, DemandFactorEntry, DirectLoad, PhaseKW } from './types';

/**
 * Builds the floor SMDBs and their LV panels from the typical-floor plan: each floor's unit (flat)
 * DBs become ways on that floor's SMDB, and each SMDB is fed from the LV panel named for its floor.
 * Running it again updates what it made before and leaves the user's own boards and ways alone.
 */

type Rotation = 0 | 1 | 2;

/** Cyclic rotation keeps the phase sequence: 1 moves the unit's R load to Y, Y to B and B to R. */
export function rotate(kw: PhaseKW, rotation: Rotation): PhaseKW {
  if (rotation === 1) return { R: kw.B, Y: kw.R, B: kw.Y };
  if (rotation === 2) return { R: kw.Y, Y: kw.B, B: kw.R };
  return { ...kw };
}

const deviation = (kw: PhaseKW) => {
  const average = (kw.R + kw.Y + kw.B) / 3;
  return average > 0 ? Math.max(Math.abs(kw.R - average), Math.abs(kw.Y - average), Math.abs(kw.B - average)) : 0;
};

/** Picks each unit's rotation, largest units first, keeping the board's running phase loads as even as possible. */
export function balanceRotations(fixed: PhaseKW, units: PhaseKW[]): Rotation[] {
  const order = units.map((kw, i) => ({ i, kw })).sort((a, b) => b.kw.R + b.kw.Y + b.kw.B - (a.kw.R + a.kw.Y + a.kw.B) || a.i - b.i);
  const total = { ...fixed };
  const out: Rotation[] = units.map(() => 0);
  for (const { i, kw } of order) {
    let best: Rotation = 0;
    let bestDev = Infinity;
    for (const r of [0, 1, 2] as Rotation[]) {
      const k = rotate(kw, r);
      const dev = deviation({ R: total.R + k.R, Y: total.Y + k.Y, B: total.B + k.B });
      if (dev < bestDev - 1e-12) {
        best = r;
        bestDev = dev;
      }
    }
    const k = rotate(kw, best);
    total.R += k.R;
    total.Y += k.Y;
    total.B += k.B;
    out[i] = best;
  }
  return out;
}

export interface TypicalPlanResult {
  /** Boards to write: new ones and updated ones. */
  boards: Board[];
  /** Boards the plan made earlier that it no longer needs. */
  removeIds: string[];
  notes: string[];
}

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

function newBoard(project: Project, building: string, ref: string, patch: Partial<Board>): Board {
  return {
    id: crypto.randomUUID(),
    projectId: project.id,
    building,
    ref,
    kind: 'SMDB',
    parentId: null,
    supply: null,
    phases: 3,
    incomerDevice: '',
    incomerA: null,
    faultKA: null,
    cable: '',
    eccMm2: null,
    lengthM: null,
    feeder: null,
    loadCategory: null,
    circuitDemandFactor: null,
    childFactor: null,
    spareFactor: null,
    circuits: [],
    loads: [],
    meters: { singlePhase: 0, threePhase: 0, ct: 0 },
    location: '',
    remarks: '',
    ...patch,
  };
}

export function unitLabel(prefix: string, unitNo: number, type: UnitType) {
  return `${prefix}${unitNo} (${type.name})`;
}

export function planTypical(project: Project, existing: Board[], factors: DemandFactorEntry[]): TypicalPlanResult {
  const notes: string[] = [];
  const types = project.unitTypes ?? [];
  const floors = project.typicalFloors ?? [];
  const prefix = project.unitDbPrefix ?? 'DB-';
  const entry = (id: string) => factors.find((f) => f.id === id);
  const boards = new Map(existing.map((b) => [b.id, structuredClone(b)]));
  const touched = new Set<string>();
  const find = (building: string, ref: string) => [...boards.values()].find((b) => b.building === building && same(b.ref, ref));

  const smdbFactor = entry('dfResidentialSmdb');
  const spareMain = entry('spareAtMainBoard');
  if (!smdbFactor) notes.push('The factor table has no "Residential SMDB" entry, so SMDB rows at their LV panel have no row factor. Load the library factors first.');

  for (const floor of floors) {
    if (!floor.smdb.trim() || !floor.panel.trim()) {
      notes.push(`Floor ${floor.floor || '(unnamed)'}: give it an SMDB and an LV panel name.`);
      continue;
    }
    let panel = find(floor.building, floor.panel);
    if (!panel) {
      panel = newBoard(project, floor.building, floor.panel.trim(), {
        kind: 'LVP',
        environment: 'indoor',
        spareFactor: spareMain ? linkedFactor(spareMain) : null,
        generated: { by: 'typical', key: `panel:${floor.panel.trim().toUpperCase()}` },
      });
      boards.set(panel.id, panel);
    }
    touched.add(panel.id);

    let smdb = find(floor.building, floor.smdb);
    if (!smdb) {
      smdb = newBoard(project, floor.building, floor.smdb.trim(), {
        kind: 'SMDB',
        parentId: panel.id,
        rowFactor: smdbFactor ? linkedFactor(smdbFactor) : null,
        environment: 'indoor',
        location: `Electrical room ${floor.floor}`.trim(),
        generated: { by: 'typical', key: `smdb:${floor.smdb.trim().toUpperCase()}` },
      });
      boards.set(smdb.id, smdb);
    } else if (smdb.generated) {
      smdb.parentId = panel.id;
      if (!smdb.rowFactor && smdbFactor) smdb.rowFactor = linkedFactor(smdbFactor);
    } else if (smdb.parentId !== panel.id) {
      notes.push(`${smdb.ref} was not made by the plan, so its feeder was left as it is; only its unit DBs were updated.`);
    }
    touched.add(smdb.id);

    // Rebuild this floor's unit DBs; the user's own ways on the SMDB stay as they are.
    const own = smdb.loads.filter((l) => !l.unitTypeId);
    const units: { type: UnitType; no: number }[] = [];
    let no = floor.firstUnitNo;
    for (const type of types) {
      const count = Math.max(0, Math.floor(floor.counts[type.id] ?? 0));
      if (!count) continue;
      if (!entry(type.factorRef)) {
        notes.push(`${floor.smdb}: ${count} × ${type.name} left out, because the factor table has no "${type.factorRef}" entry.`);
        continue;
      }
      for (let i = 0; i < count; i++) units.push({ type, no: no++ });
    }
    const fixed = own.reduce((kw, l) => ({ R: kw.R + l.phaseKW.R, Y: kw.Y + l.phaseKW.Y, B: kw.B + l.phaseKW.B }), { R: 0, Y: 0, B: 0 });
    const rotations = balanceRotations(fixed, units.map((u) => u.type.phaseKW));
    const unitLoads: DirectLoad[] = units.map((u, i) => ({
      id: crypto.randomUUID(),
      label: unitLabel(prefix, u.no, u.type),
      kind: 'equipment',
      category: null,
      phaseKW: rotate(u.type.phaseKW, rotations[i]),
      demandFactor: linkedFactor(entry(u.type.factorRef)!),
      standbyKW: 0,
      largestMotorKW: null,
      remarks: '',
      phases: u.type.phases,
      unitTypeId: u.type.id,
      rotation: rotations[i],
      metered: u.type.metered,
      environment: 'indoor',
      fireRated: false,
    }));
    smdb.loads = [...unitLoads, ...own];
  }

  // Boards the plan made before but no longer names.
  const removeIds: string[] = [];
  const children = (id: string) => [...boards.values()].filter((b) => b.parentId === id);
  for (const board of [...boards.values()].filter((b) => b.generated?.by === 'typical' && !touched.has(b.id)).sort((a, b) => Number(a.kind === 'LVP') - Number(b.kind === 'LVP'))) {
    const keptChildren = children(board.id).filter((c) => !removeIds.includes(c.id));
    const ownLoads = board.loads.filter((l) => !l.unitTypeId);
    if (keptChildren.length || ownLoads.length) {
      notes.push(`${board.ref} is no longer in the plan but has your own ways or boards under it, so it was kept.`);
      board.loads = ownLoads;
      touched.add(board.id);
    } else removeIds.push(board.id);
  }

  const changed = [...boards.values()].filter((b) => touched.has(b.id));
  return { boards: changed, removeIds, notes };
}

/** Totals of a floor row for display: units, connected load per phase. */
export function floorTotals(floor: TypicalFloor, types: UnitType[]) {
  let units = 0;
  let kw = 0;
  for (const type of types) {
    const n = floor.counts[type.id] ?? 0;
    units += n;
    kw += n * (type.phaseKW.R + type.phaseKW.Y + type.phaseKW.B);
  }
  return { units, kw };
}
