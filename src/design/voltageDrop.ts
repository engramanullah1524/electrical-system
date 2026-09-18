import type { Board, CableKind, Circuit } from './types';

/**
 * Voltage drop by the mV/A/m method: drop (V) = mV/A/m × current × length ÷ 1000 ÷ parallel runs,
 * as a percentage of the nominal voltage (line voltage for three-phase, phase voltage for
 * single-phase). Tables and limits come from library clauses; nothing here holds a value.
 */
export type VdTable = Map<number, number>;

/** Reads "vdMvAm_2_5 = 19" style parameters into size → mV/A/m. */
export function tableFromParams(params: { key: string; value: number | string | boolean }[]): VdTable {
  const table: VdTable = new Map();
  for (const p of params) {
    const m = /^vdMvAm_(\d+(?:_\d+)?)$/.exec(p.key);
    if (m && typeof p.value === 'number') table.set(Number(m[1].replace('_', '.')), p.value);
  }
  return table;
}

export function designCurrentA(kW: number, threePhase: boolean, powerFactor: number, voltageLL: number, voltageLN: number): number {
  return threePhase ? (kW * 1000) / (Math.sqrt(3) * voltageLL * powerFactor) : (kW * 1000) / (voltageLN * powerFactor);
}

export function dropPercent(mvPerAm: number, amps: number, lengthM: number, runs: number, nominalV: number): number {
  return ((mvPerAm * amps * lengthM) / 1000 / Math.max(runs, 1) / nominalV) * 100;
}

export type Lookup = { ok: true; mvPerAm: number } | { ok: false; reason: string };

export function lookup(tables: Partial<Record<CableKind, VdTable>>, kind: CableKind | null, sizeMm2: number | null): Lookup {
  if (!kind) return { ok: false, reason: 'the cable type is not set' };
  if (!sizeMm2) return { ok: false, reason: 'the cable size is not set' };
  const table = tables[kind];
  if (!table) return { ok: false, reason: `no verified voltage-drop table for ${kind === 'pvcSheathed' ? 'PVC-sheathed cables' : 'single-core wires in conduit'}` };
  const value = table.get(sizeMm2);
  return value === undefined ? { ok: false, reason: `the voltage-drop table has no ${sizeMm2} mm² entry` } : { ok: true, mvPerAm: value };
}

export const circuitIsThreePhase = (circuit: Circuit) => circuit.phase === 'RYB';
export const boardIsThreePhase = (board: Board) => board.phases === 3;
