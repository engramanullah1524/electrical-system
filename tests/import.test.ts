import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import core from '../library/packs/core.json';
import { computeBoards, factorTable } from '../src/design/engine';
import type { Cell, SheetGrid } from '../src/import/grid';
import { planImport } from '../src/import/plan';
import { parsePanelSheet } from '../src/import/templateB';
import { readWorkbook } from '../src/import/xlsx';
import type { LibraryPack } from '../src/library/pack';
import type { Clause } from '../src/library/types';
import { seedFactors } from '../src/project/factors';

const factors = seedFactors((core as LibraryPack).clauses as unknown as Clause[]);

/** A sheet in the consultant template's layout (fictional values). */
function panelSheet(name: string, ways: [string, number, number, number][], footer?: { df: number; actual: number; md: number }): SheetGrid {
  const header: Cell[][] = [
    ['PROJECT :', null, null, null, null, null, null, null, 'DETAILS OF CONNECTED LOAD'],
    [],
    [name],
    [],
    [null, 'CIRCUIT /', 'SP /', 'RATING -', null, null, null, 'PVC /', 'CABLE SIZE', null, null, null, 'Length', 'ECC', 'CONNECTED LOAD'],
    ['SR. NO.', 'FEEDER DB NO', 'TP', 'AMPS', null, null, 'FAULT DUTY', 'XLPE'],
    [null, null, null, 'F/S', 'MCCB', 'ACB', null, 'SWA /', '2 / 4 X', null, '2 / 3 4C', null, null, null, 'R - PH', 'Y - PH', 'B - PH', 'TOTAL'],
    [null, null, null, 'ISOL', null, null, 'Ka', 'PVC', '1C MM2', null, 'MM2', null, '( Mtrs.)', 'mm2', 'Kw', 'Kw', 'Kw', 'Kw'],
    ['INCOMER-1', null, '4P', 1600],
    [null, 'OUT GOING :'],
  ];
  const rows: Cell[][] = ways.map(([label, r, y, b], i) => [i + 1, label, 'TP', null, 125, null, 50, 'XLPE/SWA/PVC', null, null, '4C 50', null, 40, '1C 25', r, y, b, r + y + b]);
  const t = ways.reduce((s, [, r, y, b]) => [s[0] + r, s[1] + y, s[2] + b], [0, 0, 0]);
  const totals: Cell[] = [null, null, null, null, null, null, null, 'TOTAL CONNECTED LOAD', null, null, null, null, null, null, t[0], t[1], t[2], t[0] + t[1] + t[2]];
  const foot: Cell[][] = footer
    ? [[null, 'DEMAND FACTOR', footer.df, 'MAX. DEMAND', null, null, null, footer.md, null, null, null, 'ACTUAL CONNECTED', null, null, null, footer.actual]]
    : [];
  return { name, rows: [...header, ...rows, [], totals, [], ...foot] };
}

describe('consultant template import', () => {
  const sheets = [
    panelSheet('LV PANEL-1-TX', [
      ['MAIN DB -1-TY', 10, 10, 10],
      ['SMDB-1F', 20, 20, 20],
      ['SPARE', 5, 5, 5],
      ['FIRE ELE PUMP', 50, 50, 50],
    ], { df: 0.7, actual: 255, md: 178.5 }),
    panelSheet('MAIN DB-1-TY', [['SMDB-2F', 10, 10, 10]]),
    panelSheet('LOAD SUMMERY-TX', [['LV PANEL-1-TX', 85, 85, 85]]),
    { name: 'Cover', rows: [['Project'], ['Nothing here']] },
  ];
  const plan = planImport(sheets, { projectId: 'p', file: 'draft.xlsx', factors, buildingFor: (s) => (s.endsWith('TY') ? 'Y' : 'X'), today: '2026-09-18' });

  it('reads way rows, their device and cable, and the footer', () => {
    const panel = parsePanelSheet(sheets[0])!;
    expect(panel.ways.map((w) => w.label)).toEqual(['MAIN DB -1-TY', 'SMDB-1F', 'SPARE', 'FIRE ELE PUMP']);
    expect(panel.ways[1]).toMatchObject({ phases: 3, device: 'MCCB', ratingA: 125, faultKA: 50, cable: '4C 50', ecc: '1C 25', lengthM: 40, total: 60 });
    expect(panel.footer).toEqual({ df: 0.7, md: 178.5, standby: null, actual: 255 });
  });

  it('turns a way that names another sheet into that board, never counting it twice', () => {
    const lvp = plan.boards.find((b) => b.ref === 'LV PANEL-1-TX')!;
    const mdb = plan.boards.find((b) => b.ref === 'MAIN DB-1-TY')!;
    expect(mdb.parentId).toBe(lvp.id);
    expect(mdb.building).toBe('Y');
    expect(mdb.rowFactor).toBeDefined(); // its row at the panel takes a factor like any way
    expect(lvp.loads.map((l) => l.label)).toEqual(['SMDB-1F', 'SPARE', 'FIRE ELE PUMP']);
    const results = computeBoards(plan.boards, [], factorTable(factors));
    expect(results.get(lvp.id)!.connectedKW).toBeCloseTo(255, 10);
  });

  it('suggests table-linked factors from way names and marks spares and fire pumps', () => {
    const lvp = plan.boards.find((b) => b.ref === 'LV PANEL-1-TX')!;
    const [smdb, spare, fire] = lvp.loads;
    expect(smdb.demandFactor).toMatchObject({ ref: 'dfResidentialSmdb', value: 0.7 });
    expect(spare).toMatchObject({ kind: 'spare', demandFactor: { ref: 'spareAtPanel' } });
    expect(fire.standbyKW).toBe(150);
    expect(lvp.spareFactor).toMatchObject({ ref: 'spareAtMainBoard' });
    expect(smdb.category).toBeNull(); // transformer load types are left to the user
    expect(plan.suggestions.join(' ')).toMatch(/enter the DEWA transformer kVA/);
  });

  it('keeps summary sheets out of the boards and lists what it skipped', () => {
    expect(plan.boards.map((b) => b.ref).sort()).toEqual(['LV PANEL-1-TX', 'MAIN DB-1-TY']);
    expect(plan.summaries).toEqual([{ name: 'LOAD SUMMERY-TX', totalKW: 255 }]);
    expect(plan.skipped).toEqual(['Cover']);
  });

  it('reports a way that disagrees with the sheet it names', () => {
    const bad = planImport([panelSheet('LVP-A', [['DB-X', 1, 1, 1]]), panelSheet('DB-X', [['C1', 2, 2, 2]])], {
      projectId: 'p', file: 'f', factors, buildingFor: () => '', today: '2026-09-18',
    });
    expect(bad.findings.join(' ')).toMatch(/states 3 kW but sheet DB-X totals 6 kW/);
  });
});

// Local-only check against the real pilot workbook; its path is kept in the gitignored private folder.
const CONFIG = 'private/fixtures/import-b.json';
const realFile: string | null = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')).file : null;

describe.skipIf(!realFile || !existsSync(realFile))('consultant template import: real pilot workbook', () => {
  it('imports the panels with the workbook totals and links', async () => {
    const data = readFileSync(realFile!);
    const sheets = await readWorkbook(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const plan = planImport(sheets, { projectId: 'p', file: 'pilot.xlsx', factors, buildingFor: () => '', today: '2026-09-18' });
    const byRef = new Map(plan.boards.map((b) => [b.ref, b]));
    const results = computeBoards(plan.boards, [], factorTable(factors));
    const lvp1 = byRef.get('LV PANEL-1-TA')!;
    expect(results.get(lvp1.id)!.connectedKW).toBeCloseTo(2140.885, 2);
    expect(byRef.get('MAIN DB-1-TC')!.parentId).toBe(lvp1.id);
    expect(results.get(byRef.get('LV PANEL-2-TB')!.id)!.connectedKW).toBeCloseTo(1814.049, 2);
    console.log([`pilot import: ${plan.boards.length} boards, ${plan.findings.length} findings, ${plan.suggestions.length} suggestions, ${plan.skipped.length} sheets skipped`, ...plan.boards.map((b) => `BOARD ${b.ref} <- ${plan.boards.find((x) => x.id === b.parentId)?.ref ?? 'DEWA'} (${b.loads.length} ways)`), ...plan.findings.map((f) => `FINDING ${f}`), ...plan.suggestions.filter((s) => /no factor|no "|marked standby/.test(s)).map((s) => `NOTE ${s}`)].join('\n'));
  }, 60_000);
});
