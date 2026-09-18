import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditSchedule, type ScheduleRow, type ScheduleTotals } from '../src/design/audit';
import { computeBoards } from '../src/design/engine';
import { PHASES, type Board } from '../src/design/types';

/**
 * Golden check against a real DEWA-approved load schedule. The fixture holds client data, so it is
 * generated locally into the gitignored private/ folder, and this suite is skipped wherever it is
 * absent (including CI).
 */
const FIXTURE = 'private/fixtures/load-schedule-golden.json';

interface Panel { name: string; ways: ScheduleRow[]; totals: ScheduleTotals }
interface Flat { name: string; circuits: { phase: 'R' | 'Y' | 'B'; statedW: number }[]; totals: Record<'R' | 'Y' | 'B', number> }
interface Finding { sheet: string; ref: string; kind: string; field: string }
interface Fixture { panels: Panel[]; flats: Flat[]; findings: Finding[] }

const fixture: Fixture | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;
const declared = (value: number) => ({ value, basis: { kind: 'declared' as const, reason: 'as approved' } });

function boardFor(id: string): Board {
  return {
    id,
    projectId: 'golden',
    building: '',
    ref: id,
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
    circuitDemandFactor: null,
    childFactor: null,
    circuits: [],
    loads: [],
    meters: { singlePhase: 0, threePhase: 0, ct: 0 },
    location: '',
    remarks: '',
  };
}

function panelBoard(panel: Panel): Board {
  const board = boardFor(panel.name);
  board.loads = panel.ways.map((w, i) => ({
    id: String(i),
    label: w.ref,
    kind: 'equipment' as const,
    phaseKW: { R: w.R, Y: w.Y, B: w.B },
    demandFactor: declared(w.df),
    standbyKW: w.standby,
    largestMotorKW: null,
    remarks: '',
  }));
  return board;
}

describe.skipIf(!fixture)('golden: DEWA-approved schedule', () => {
  const panels = fixture?.panels ?? [];
  const findingsFor = (sheet: string) => (fixture?.findings ?? []).filter((f) => f.sheet === sheet);

  it('the audit finds exactly the arithmetic errors identified independently', () => {
    const found = panels.flatMap((p) => auditSchedule(p.name, p.ways, p.totals)).map(({ sheet, ref, kind, field }) => ({ sheet, ref, kind, field }));
    expect(found).toEqual(fixture?.findings);
  });

  it.each(panels.map((p) => [p.name, p] as const))('%s: engine reproduces the approved totals where the sheet is consistent', (name, panel) => {
    const result = computeBoards([panelBoard(panel)], []).get(name)!;
    const findings = findingsFor(name);
    // A row whose phases do not add up to its total also throws off the demand the engine derives from it.
    const phaseError = findings.some((f) => f.kind === 'row-phases');
    const consistent = (field: string) =>
      !findings.some((f) => f.field === field) && !(phaseError && (field === 'total' || field === 'md'));

    // The engine always follows the rows' own phases, standby and factors.
    expect(result.standbyKW).toBeCloseTo(panel.ways.reduce((s, w) => s + w.standby, 0), 2);
    if (consistent('total')) expect(result.connectedKW).toBeCloseTo(panel.totals.total, 2);
    if (consistent('md')) expect(result.demandKW).toBeCloseTo(panel.totals.md, 2);
    for (const ph of PHASES) if (consistent(ph)) expect(result.connected[ph]).toBeCloseTo(panel.totals[ph], 2);
  });

  // Each circuit enters at the consultant's stated load, because rows carry their own watts per point.
  it.each((fixture?.flats ?? []).map((f) => [f.name, f] as const))('%s: circuit loads add up to the approved phase totals', (name, flat) => {
    const board = boardFor(name);
    board.circuitDemandFactor = declared(0.7);
    board.circuits = flat.circuits.map((c, i) => ({
      id: String(i),
      no: String(i + 1),
      phase: c.phase,
      breakerA: null,
      rcdMA: null,
      wireMm2: null,
      eccMm2: null,
      area: '',
      points: {},
      equipmentW: c.statedW,
      standby: false,
      remarks: '',
    }));
    const result = computeBoards([board], []).get(name)!;
    for (const ph of PHASES) expect(result.connected[ph]).toBeCloseTo(flat.totals[ph], 3);
  });
});
