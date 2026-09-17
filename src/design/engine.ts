import { PHASES, type Board, type Circuit, type PhaseKW, type PointType } from './types';

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
  issues: string[];
}

/**
 * Totals every board from the bottom up. Diversity is applied where a load is first grouped (a
 * board's own circuits, or a direct load) and demands are then added upwards, times any further
 * factor a board declares for the boards it feeds.
 */
export function computeBoards(boards: Board[], pointTypes: PointType[]): Map<string, BoardResult> {
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

    let circuitsKW = 0;
    for (const circuit of board.circuits) {
      const kw = circuitPhaseKW(circuit, watts, issues);
      connected = addKW(connected, kw);
      if (circuit.standby) standbyKW += totalKW(kw);
      else circuitsKW += totalKW(kw);
    }
    if (board.circuits.length > 0) {
      if (!board.circuitDemandFactor) {
        issues.push(`${board.ref}: no demand factor is set for its circuits, so their maximum demand equals connected load.`);
      }
      demandKW += circuitsKW * (board.circuitDemandFactor?.value ?? 1);
    }

    for (const load of board.loads) {
      connected = addKW(connected, load.phaseKW);
      const loadKW = totalKW(load.phaseKW);
      const standby = Math.min(Math.max(load.standbyKW, 0), loadKW);
      standbyKW += standby;
      demandKW += (loadKW - standby) * load.demandFactor.value;
    }

    for (const child of children.get(board.id) ?? []) {
      const result = visit(child);
      connected = addKW(connected, result.connected);
      standbyKW += result.standbyKW;
      demandKW += result.demandKW * (board.childFactor?.value ?? 1);
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
      issues,
    };
    inProgress.delete(board.id);
    results.set(board.id, result);
    return result;
  };

  for (const board of boards) visit(board);
  return results;
}
