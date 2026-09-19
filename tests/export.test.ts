import { writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import core from '../library/packs/core.json';
import { computeBoards, factorTable } from '../src/design/engine';
import { loadSizingRules, sizeBoards } from '../src/design/selection';
import { planTypical } from '../src/design/typical';
import { buildScheduleWorkbook, scheduleRows } from '../src/export/scheduleXlsx';
import type { LibraryPack } from '../src/library/pack';
import { lookupFrom } from '../src/library/provenance';
import type { Clause, Source } from '../src/library/types';
import { seedFactors } from '../src/project/factors';
import type { Project } from '../src/project/types';

// Fictional project: two typical floors of studios and one-bed units on one LV panel.
const pack = core as LibraryPack;
const clauses = pack.clauses.map((c) => ({ ...c, status: 'verified' as const, reviewedOn: '2026-09-19', reviewNote: '', reviewedHash: '' })) as Clause[];
const factors = seedFactors(clauses);
const project: Project = {
  id: 'p', name: 'Test Tower', permitAuthority: 'DM', authorityConfirmed: false, buildings: ['A'], notes: '', createdAt: '', updatedAt: '',
  demandFactors: factors,
  unitTypes: [
    { id: 'std', name: 'STD', phaseKW: { R: 2.6, Y: 3.0, B: 3.1 }, phases: 3, metered: true, factorRef: 'dfFlatDb' },
    { id: '1bhk', name: '1BHK', phaseKW: { R: 3.2, Y: 3.2, B: 3.1 }, phases: 3, metered: true, factorRef: 'dfFlatDb' },
  ],
  typicalFloors: [1, 2].map((n) => ({ id: `f${n}`, building: 'A', floor: `${n}F`, smdb: `SMDB-${n}F`, panel: 'LV PANEL-01', firstUnitNo: n * 100 + 1, counts: { std: 8, '1bhk': 4 } })),
  faultKA: { lvPanel: 65, lvWays: 35, smdbWays: 25 },
  details: { owner: 'Owner LLC', consultant: 'Consultant Co', area: 'Dubai', plotNo: '123', completionDate: '', preparedBy: 'Engineer', telephone: '', fax: '', revision: '0', date: '2026-09-19' },
};
const boards = planTypical(project, [], factors).boards;
const table = factorTable(factors);
const results = computeBoards(boards, [], table);
const sizing = sizeBoards(boards, results, loadSizingRules(lookupFrom(clauses, pack.sources as Source[])), { eccPrecedent: false });
const input = { project, boards, results, sizing, factors: table };

describe('load schedule rows', () => {
  it('add up to the maximum demand the engine counts for every board', () => {
    for (const board of boards) {
      const rows = scheduleRows(board, input);
      expect(rows.reduce((s, r) => s + r.demandKW, 0)).toBeCloseTo(results.get(board.id)!.demandKW, 9);
    }
  });
});

describe('load schedule workbook (reference layout)', async () => {
  const data = await buildScheduleWorkbook(input);
  // Set SCHEDULE_SAMPLE to a file path to keep the workbook for a visual comparison.
  if (process.env.SCHEDULE_SAMPLE) writeFileSync(process.env.SCHEDULE_SAMPLE, data);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const value = (sheet: string, ref: string) => {
    const v = wb.getWorksheet(sheet)!.getCell(ref).value as unknown;
    return v !== null && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v;
  };

  it('has a summary, the LV panel, each SMDB and each unit DB type', () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual(['MAIN SUMMARY', 'LV PANEL-01', 'SMDB-1F', 'SMDB-2F', 'DB-STD', 'DB-1BHK']);
  });

  it('writes the SMDB sheet with the reference headings, incomer and unit ways', () => {
    expect(value('SMDB-1F', 'A5')).toBe('CIRCUIT/FEEDER DB No');
    expect(value('SMDB-1F', 'S5')).toBe('PROPOSED TYPE & No OF KWHMETERS');
    expect(value('SMDB-1F', 'B4')).toBe('SMDB-1F');
    expect(value('SMDB-1F', 'P2')).toBe('Dubai');
    // 8 × 8.7 + 4 × 9.5 = 107.6 kW → 232.7 A → 250 A → 4C 95 (225–250 A, up to 128 kW), ECC 50.
    expect(value('SMDB-1F', 'C7')).toBe(250);
    expect(value('SMDB-1F', 'G7')).toBe('1x4C 95');
    expect(value('SMDB-1F', 'J7')).toBe('1x1C 50');
    expect(value('SMDB-1F', 'F7')).toBe(35);
    expect(value('SMDB-1F', 'T7')).toBe(12);
    expect(value('SMDB-1F', 'A9')).toBe('DB-101 (STD)');
    expect(value('SMDB-1F', 'D9')).toBe(20);
    expect(value('SMDB-1F', 'I9')).toBe(10);
    expect(value('SMDB-1F', 'P9')).toBe(0.7);
    expect(value('SMDB-1F', 'Q7')).toBeCloseTo(107.6 * 0.7, 3);
    expect(wb.getWorksheet('SMDB-1F')!.model.merges).toContain('A5:A6');
  });

  it('writes the LV panel with the DEWA incomer, SMDB rows at the row factor, and the CT meter', () => {
    // Panel MD = 2 × 107.6 × 0.7 = 150.64 kW → 500 kVA (382 kW) → 722 A → 800 A ACB set at 0.90.
    expect(value('LV PANEL-01', 'F7')).toBe('800A SET AT 0.90');
    expect(value('LV PANEL-01', 'W7')).toBe('300/5A CTM'); // 110–160 kW
    expect(value('LV PANEL-01', 'A9')).toBe('SMDB-1F');
    expect(value('LV PANEL-01', 'B9')).toBe('RYB1');
    expect(value('LV PANEL-01', 'Q9')).toBe(0.7);
    expect(value('LV PANEL-01', 'R7')).toBeCloseTo(150.64, 3);
    expect(value('LV PANEL-01', 'U9')).toBe(12);
  });

  it('summarises the transformer per LV panel', () => {
    expect(value('MAIN SUMMARY', 'A8')).toBe('TX-01');
    expect(value('MAIN SUMMARY', 'U8')).toBe('500 kVA transformer for LV PANEL-01');
    expect(value('MAIN SUMMARY', 'S8')).toBe(24);
  });
});
