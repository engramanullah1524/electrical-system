import { PHASES, type Board, type Circuit, type DemandFactorEntry, type Factor, type LoadCategory, type PhaseKW, type PointType } from './types';

/** A factor's value, taken from the project's demand factor table when the factor links to it. */
export function factorValue(factor: Factor, table?: Map<string, number>): number {
  return factor.ref !== undefined && table?.has(factor.ref) ? table.get(factor.ref)! : factor.value;
}

export const factorTable = (entries: DemandFactorEntry[] = []) => new Map(entries.map((e) => [e.id, e.value]));

export type CategoryKW = Record<LoadCategory | 'uncategorised', number>;
const zeroCategories = (): CategoryKW => ({ chiller: 0, fahuPumpsLifts: 0, retail: 0, other: 0, uncategorised: 0 });

export const zeroKW = (): PhaseKW => ({ R: 0, Y: 0, B: 0 });
export const totalKW = (kw: PhaseKW) => kw.R + kw.Y + kw.B;
const addKW = (a: PhaseKW, b: PhaseKW): PhaseKW => ({ R: a.R + b.R, Y: a.Y + b.Y, B: a.B + b.B });

export function circuitWatts(circuit: Circuit, watts: Map<string, number>, issues?: string[]): number {
  let total = circuit.equipmentW || 0;
  for (const [typeId, count] of Object.entries(circuit.points)) {
    if (!count) continue;
    const each = watts.get(typeId);
    if (each === undefined) {
      issues?.push(`Circuit ${circuit.no}: point type "${typeId}" is not defined, so it was not counted.`);
      continue;
    }
    total += each * count;
  }
  return total;
}

export function circuitPhaseKW(circuit: Circuit, watts: Map<string, number>, issues?: string[]): PhaseKW {
  const kw = circuitWatts(circuit, watts, issues) / 1000;
  if (circuit.phase === 'RYB') return { R: kw / 3, Y: kw / 3, B: kw / 3 };
  return { ...zeroKW(), [circuit.phase]: kw };
}

export interface BoardResult {
  boardId: string;
  /** Total connected load per phase, including standby, spare and future provisions. */
  connected: PhaseKW;
  connectedKW: number;
  standbyKW: number;
  demandKW: number;
  /** Maximum demand ÷ (connected load − standby), as shown on DEWA schedules. */
  overallFactor: number | null;
  /** Largest deviation of any phase from the three-phase average, in percent. */
  phaseDeviationPercent: number | null;
  /** Connected load without standby, by load group, for the DEWA transformer demand. */
  byCategory: CategoryKW;
  /** Spare capacity in this board and below: its connected kW and the demand it contributes. */
  spareKW: number;
  spareDemandKW: number;
  issues: string[];
}

/**
 * Totals every board from the bottom up. A board's own circuits and direct loads take their own
 * demand factors. A sub-board counts at the board above as its connected load less standby and
 * spares, times its row factor (the user's rule of 2026-09-19, as in the DEWA-approved reference).
 * Its own maximum demand stays on its own schedule. Spares keep their own rule: in full at their
 * panel, then replaced by a main board's spare factor where one is set.
 */
export function computeBoards(boards: Board[], pointTypes: PointType[], factors?: Map<string, number>): Map<string, BoardResult> {
  const watts = new Map(pointTypes.map((t) => [t.id, t.watts]));
  const byId = new Map(boards.map((b) => [b.id, b]));
  const children = new Map<string, Board[]>();
  for (const board of boards) {
    if (!board.parentId) continue;
    const list = children.get(board.parentId) ?? [];
    list.push(board);
    children.set(board.parentId, list);
  }

  const results = new Map<string, BoardResult>();
  const inProgress = new Set<string>();

  const visit = (board: Board): BoardResult => {
    const done = results.get(board.id);
    if (done) return done;
    if (inProgress.has(board.id)) throw new Error(`Board ${board.ref} ends up feeding itself through its sub-boards.`);
    inProgress.add(board.id);

    const issues: string[] = [];
    let connected = zeroKW();
    let standbyKW = 0;
    let demandKW = 0;

    const byCategory = zeroCategories();
    let circuitsKW = 0;
    for (const circuit of board.circuits) {
      const kw = circuitPhaseKW(circuit, watts, issues);
      connected = addKW(connected, kw);
      if (circuit.standby) standbyKW += totalKW(kw);
      else circuitsKW += totalKW(kw);
    }
    byCategory[board.loadCategory ?? 'uncategorised'] += circuitsKW;
    if (board.circuits.length > 0) {
      if (!board.circuitDemandFactor) {
        issues.push(`${board.ref}: no demand factor is set for its circuits, so their maximum demand equals connected load.`);
      }
      demandKW += circuitsKW * (board.circuitDemandFactor ? factorValue(board.circuitDemandFactor, factors) : 1);
    }

    let spareKW = 0;
    let spareDemandKW = 0;
    for (const load of board.loads) {
      connected = addKW(connected, load.phaseKW);
      const loadKW = totalKW(load.phaseKW);
      const standby = Math.min(Math.max(load.standbyKW, 0), loadKW);
      standbyKW += standby;
      const loadDemand = (loadKW - standby) * factorValue(load.demandFactor, factors);
      demandKW += loadDemand;
      byCategory[load.category ?? 'uncategorised'] += loadKW - standby;
      if (load.kind === 'spare') {
        spareKW += loadKW - standby;
        spareDemandKW += loadDemand;
      }
    }

    for (const child of children.get(board.id) ?? []) {
      const result = visit(child);
      connected = addKW(connected, result.connected);
      standbyKW += result.standbyKW;
      const rowFactor = child.rowFactor ?? board.childFactor;
      if (!rowFactor) issues.push(`${child.ref}: no row factor is set at ${board.ref}, so its row counts its full connected load.`);
      const factor = rowFactor ? factorValue(rowFactor, factors) : 1;
      // Spare demand is carried separately so a main board can apply its own spare factor to it.
      demandKW += (result.connectedKW - result.standbyKW - result.spareKW) * factor + result.spareDemandKW;
      spareKW += result.spareKW;
      spareDemandKW += result.spareDemandKW;
      for (const key of Object.keys(byCategory) as (keyof CategoryKW)[]) byCategory[key] += result.byCategory[key];
    }

    if (board.spareFactor && spareKW > 0) {
      // Replace the spares' panel-level demand with the main board's factor on their capacity.
      const spareFactor = factorValue(board.spareFactor, factors);
      demandKW += spareKW * spareFactor - spareDemandKW;
      spareDemandKW = spareKW * spareFactor;
    }

    if (board.parentId && !byId.has(board.parentId)) issues.push(`${board.ref}: the board it is fed from no longer exists.`);

    const connectedKW = totalKW(connected);
    const base = connectedKW - standbyKW;
    const average = connectedKW / 3;
    const result: BoardResult = {
      boardId: board.id,
      connected,
      connectedKW,
      standbyKW,
      demandKW,
      overallFactor: base > 0 ? demandKW / base : null,
      phaseDeviationPercent:
        board.phases === 3 && average > 0
          ? (Math.max(...PHASES.map((p) => Math.abs(connected[p] - average))) / average) * 100
          : null,
      byCategory,
      spareKW,
      spareDemandKW,
      issues,
    };
    inProgress.delete(board.id);
    results.set(board.id, result);
    return result;
  };

  for (const board of boards) visit(board);
  return results;
}
