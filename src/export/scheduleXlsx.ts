import type { Alignment, Borders, PaperSize, Workbook, Worksheet } from 'exceljs';
import { factorValue, totalKW, type BoardResult } from '../design/engine';
import { cableText, type BoardSizing, type MeterPick, type Sized } from '../design/selection';
import type { Board, PhaseKW } from '../design/types';
import type { Project, UnitType } from '../project/types';

/**
 * The load schedule workbook in the layout of the user's DEWA-approved reference schedule: a
 * project summary, one sheet per LV panel, one per sub-board, and one per unit DB type. Column
 * order, merged headings, widths, fonts and the footer follow the reference; the numbers come from
 * the app's engine and sizing, and totals are live Excel formulas.
 */
export interface ScheduleInput {
  project: Project;
  boards: Board[];
  results: Map<string, BoardResult>;
  sizing: Map<string, BoardSizing>;
  factors: Map<string, number>;
}

/** One row of a board schedule. */
export interface ScheduleRow {
  name: string;
  phases: 1 | 3;
  kw: PhaseKW;
  standbyKW: number;
  /** Effective factor on (connected − standby), so that the row's demand = (TCL − standby) × factor. */
  factor: number;
  demandKW: number;
  sized: Sized | null;
  fireRated: boolean;
  meters: { singlePhase: number; threePhase: number; ct: number };
  remarks: string;
}

const zero = () => ({ singlePhase: 0, threePhase: 0, ct: 0 });
const meterCount = (pick: MeterPick | null) => ({
  singlePhase: pick?.kind === '1PH' ? 1 : 0,
  threePhase: pick?.kind === '3PH' ? 1 : 0,
  ct: pick?.kind === 'CT' ? 1 : 0,
});

/** The rows a board shows: its own ways first, then the boards it feeds, with the demand the engine counts for each. */
export function scheduleRows(board: Board, input: ScheduleInput): ScheduleRow[] {
  const { boards, results, sizing, factors } = input;
  const rows: ScheduleRow[] = [];
  const spareFactor = board.spareFactor ? factorValue(board.spareFactor, factors) : null;
  const own = sizing.get(board.id);

  const children = boards
    .filter((b) => b.parentId === board.id)
    .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));

  if (board.circuits.length) {
    // The board's own final circuits, as the engine sums them: what is left after its ways and sub-boards.
    const r = results.get(board.id);
    if (r) {
      const kw = { ...r.connected };
      let standby = r.standbyKW;
      for (const l of board.loads) {
        kw.R -= l.phaseKW.R;
        kw.Y -= l.phaseKW.Y;
        kw.B -= l.phaseKW.B;
        standby -= Math.min(Math.max(l.standbyKW, 0), totalKW(l.phaseKW));
      }
      for (const c of children) {
        const cr = results.get(c.id);
        if (!cr) continue;
        kw.R -= cr.connected.R;
        kw.Y -= cr.connected.Y;
        kw.B -= cr.connected.B;
        standby -= cr.standbyKW;
      }
      const f = board.circuitDemandFactor ? factorValue(board.circuitDemandFactor, factors) : 1;
      rows.push({ name: 'Final circuits of this board', phases: board.phases, kw, standbyKW: standby, factor: f, demandKW: (totalKW(kw) - standby) * f, sized: null, fireRated: false, meters: zero(), remarks: '' });
    }
  }

  for (const load of board.loads) {
    const tcl = totalKW(load.phaseKW);
    const standby = Math.min(Math.max(load.standbyKW, 0), tcl);
    const f = load.kind === 'spare' && spareFactor !== null ? spareFactor : factorValue(load.demandFactor, factors);
    const sized = own?.ways.get(load.id) ?? null;
    rows.push({
      name: load.label,
      phases: load.phases ?? 3,
      kw: load.phaseKW,
      standbyKW: standby,
      factor: f,
      demandKW: (tcl - standby) * f,
      sized,
      fireRated: load.fireRated ?? false,
      meters: meterCount(sized?.meter ?? null),
      remarks: load.remarks,
    });
  }

  for (const child of children) {
    const r = results.get(child.id);
    if (!r) continue;
    const rowFactor = child.rowFactor ?? board.childFactor;
    const f = rowFactor ? factorValue(rowFactor, factors) : 1;
    const spareDemand = spareFactor !== null ? r.spareKW * spareFactor : r.spareDemandKW;
    const demand = (r.connectedKW - r.standbyKW - r.spareKW) * f + spareDemand;
    const base = r.connectedKW - r.standbyKW;
    rows.push({
      name: child.ref,
      phases: child.phases,
      kw: r.connected,
      standbyKW: r.standbyKW,
      factor: base > 0 ? demand / base : f,
      demandKW: demand,
      sized: sizing.get(child.id)?.incomer ?? null,
      fireRated: child.fireRated ?? false,
      meters: sizing.get(child.id)?.meters ?? zero(),
      remarks: child.remarks,
    });
  }
  return rows;
}

// ---------- formatting helpers ----------

const THIN = { style: 'thin' as const };
const BOX: Partial<Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const CENTER: Partial<Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
const LEFT: Partial<Alignment> = { horizontal: 'left', vertical: 'middle', wrapText: true };
const KW = '#,##0.00';
const DF = '0.00';

type Value = string | number | null | { formula: string; result: number };

class Sheet {
  constructor(readonly ws: Worksheet) {}
  set(ref: string, value: Value, opts: { bold?: boolean; size?: number; align?: Partial<Alignment>; fmt?: string; box?: boolean } = {}) {
    const cell = this.ws.getCell(ref);
    if (value !== null && value !== '') cell.value = value;
    cell.font = { name: 'Arial', size: opts.size ?? 9, bold: opts.bold ?? false };
    cell.alignment = opts.align ?? CENTER;
    if (opts.fmt) cell.numFmt = opts.fmt;
    if (opts.box !== false) cell.border = BOX;
  }
  merge(range: string, value: Value = null, opts: Parameters<Sheet['set']>[2] = {}) {
    const [first, last] = range.split(':');
    this.ws.mergeCells(range);
    this.set(first, value, opts);
    // Borders on every cell of the merge so the box prints whole.
    const a = this.ws.getCell(first);
    const b = this.ws.getCell(last);
    for (let r = Number(a.row); r <= Number(b.row); r++)
      for (let c = Number(a.col); c <= Number(b.col); c++) if (opts.box !== false) this.ws.getCell(r, c).border = BOX;
  }
  widths(widths: number[]) {
    widths.forEach((w, i) => (this.ws.getColumn(i + 1).width = w));
  }
  height(row: number, h: number) {
    this.ws.getRow(row).height = h;
  }
}

const col = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const cableType = (fireRated: boolean) => (fireRated ? 'XLPE/SWA/PVC/FR' : 'XLPE/SWA/PVC');
const eccCell = (s: Sized | null) => (s?.cable && s.eccMm2 !== null ? `${s.cable.runs}x1C ${s.eccMm2}` : '');
const sp = (phases: 1 | 3) => (phases === 1 ? 'SP' : 'TP');
const METER_LEGEND = ['(1)  Up to 60A (1 Phase)', '(2)  Up to 100A (3 Phase)', '(3)  125-160A', '(4)  LV CT /A        HV CT /A'];

function titleBlock(s: Sheet, title: string, project: Project, location: string, ref: string | null, layout: TitleLayout) {
  const d = project.details;
  s.set('A1', title, { bold: true, size: 11, align: LEFT, box: false });
  s.merge(layout.consultant, d?.consultant ?? '', { bold: true, size: 16, align: { horizontal: 'right', vertical: 'middle' }, box: false });
  const [p, o, a] = layout.row2;
  s.set(p[0], 'Project:', { bold: true, size: 8, align: LEFT });
  s.merge(p[1], project.name, { bold: true, size: 8, align: LEFT });
  s.merge(o[0], 'Owner:', { bold: true, size: 8, align: LEFT });
  s.merge(o[1], d?.owner ?? '', { bold: true, size: 8, align: LEFT });
  s.set(a[0], 'Area:', { bold: true, size: 8, align: LEFT });
  s.merge(a[1], d?.area ?? '', { bold: true, size: 8, align: LEFT });
  const [c, l, pl] = layout.row3;
  s.set(c[0], 'Planned Completion Date:', { bold: true, size: 8, align: LEFT });
  s.merge(c[1], d?.completionDate ?? '', { bold: true, size: 8, align: LEFT });
  s.merge(l[0], 'Location:', { bold: true, size: 8, align: LEFT });
  s.merge(l[1], location, { bold: true, size: 8, align: LEFT });
  s.set(pl[0], 'Plot No:', { bold: true, size: 8, align: LEFT });
  s.merge(pl[1], d?.plotNo ?? '', { bold: true, size: 8, align: LEFT });
  if (ref !== null && layout.row4) {
    s.set('A4', 'PANEL REFERENCE:', { bold: true, size: 8, align: LEFT });
    s.merge(layout.row4[0], ref, { bold: true, size: 10, align: LEFT });
    s.merge(layout.row4[1], '', { box: true });
  }
  s.height(1, 24);
  s.height(2, 18.75);
  s.height(3, 18.75);
  s.height(4, 16.5);
}

interface TitleLayout {
  consultant: string;
  row2: [[string, string], [string, string], [string, string]];
  row3: [[string, string], [string, string], [string, string]];
  row4?: [string, string];
}

function footer(s: Sheet, row: number, project: Project, last: string, cols: { tel: string; fax: string; rev: string; revValue: string; legend: string[]; dateLabel: string; dateValue: string }) {
  const d = project.details;
  s.set(`A${row}`, `PREPARED BY: ${d?.preparedBy ?? ''}`.trim(), { size: 9, align: LEFT, box: false });
  s.set(`${cols.tel}${row}`, `Telephone No: ${d?.telephone ?? ''}`.trim(), { size: 9, align: LEFT, box: false });
  s.set(`${cols.fax}${row}`, `Fax No: ${d?.fax ?? ''}`.trim(), { size: 9, align: LEFT, box: false });
  s.set(`${cols.rev}${row}`, 'REV:', { size: 9, align: LEFT, box: false });
  s.set(`${cols.revValue}${row}`, d?.revision ?? '', { size: 9, align: LEFT, box: false });
  s.set(`A${row + 1}`, 'Type of Meter (Rating of Incomer):', { size: 9, align: LEFT, box: false });
  cols.legend.forEach((c, i) => s.set(`${c}${row + 1}`, METER_LEGEND[i], { size: 9, align: LEFT, box: false }));
  s.set(`${cols.dateLabel}${row + 1}`, 'DATE:', { size: 9, align: LEFT, box: false });
  s.set(`${cols.dateValue}${row + 1}`, d?.date ?? '', { size: 9, align: LEFT, box: false });
  s.height(row, 24.9);
  s.height(row + 1, 24.9);
  s.ws.pageSetup.printArea = `A1:${last}${row + 1}`;
}

function setupPage(ws: Worksheet) {
  ws.pageSetup.orientation = 'landscape';
  ws.pageSetup.paperSize = 8 as unknown as PaperSize; // A3
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.views = [{ showGridLines: false }];
}

// ---------- sub-board sheet (SMDB, MDB, EMDB, MCC, DB) ----------

function boardSheet(ws: Worksheet, board: Board, input: ScheduleInput) {
  const s = new Sheet(ws);
  setupPage(ws);
  s.widths([32.3, 6.1, 8.3, 13, 9.8, 12.4, 14, 22.7, 11.4, 13, 13, 9.8, 13, 13, 10.8, 13, 13, 13, 6.8, 13, 7.4, 37.1]);
  const { project, results, boards } = input;
  titleBlock(s, 'SUB-MAIN DISTRIBUTION BOARD - DETAILS OF CONNECTED LOAD', project, board.location, board.ref, {
    consultant: 'L1:U1',
    row2: [['A2', 'B2:F2'], ['G2:H2', 'I2:N2'], ['O2', 'P2:U2']],
    row3: [['A3', 'B3:F3'], ['G3:H3', 'I3:N3'], ['O3', 'P3:U3']],
    row4: ['B4:F4', 'G4:U4'],
  });

  const head = { bold: true };
  s.merge('A5:A6', 'CIRCUIT/FEEDER DB No', head);
  s.merge('B5:B6', 'SP/ TP', head);
  s.merge('C5:E5', 'RATING AMPS', head);
  s.set('C6', 'ISOLATOR', head);
  s.set('D6', 'MCCB', head);
  s.set('E6', 'ACB', head);
  s.merge('F5:F6', 'FAULT DUTY IN KA', head);
  s.set('G5', '', head);
  s.set('G6', 'No. Of CORES 1c/2c/4c', head);
  s.merge('H5:I5', 'CABLE SIZE', head);
  s.set('H6', 'TYPE XLPE/ SWA/ PVC', head);
  s.set('I6', 'SIZE', head);
  s.set('J5', 'ECC', head);
  s.set('J6', 'SIZE mm²', head);
  s.merge('K5:K6', 'Length Of Cable (Mtres.)', head);
  s.merge('L5:O5', 'CONNECTED LOAD IN KW', head);
  ['R-PH KW', 'Y-PH KW', 'B-PH KW', 'TOTAL LOAD KW'].forEach((t, i) => s.set(`${col(12 + i)}6`, t, head));
  s.merge('P5:P6', 'DIVERSITY FACTOR', head);
  s.merge('Q5:Q6', 'MAXIMUM DEMAND LOAD IN kW', head);
  s.merge('R5:R6', 'STANDBY LOAD IN KW', head);
  s.merge('S5:U5', 'PROPOSED TYPE & No OF KWHMETERS', head);
  s.set('S6', '1PH (1)', head);
  s.set('T6', '3PH (2)', head);
  s.set('U6', 'LV/HV CT', head);
  s.merge('V5:V6', 'REMARKS', head);
  s.height(5, 27.75);
  s.height(6, 36.75);

  const rows = scheduleRows(board, input);
  const first = 9;
  const lastRow = first + Math.max(rows.length, 1) - 1;
  const totalRow = lastRow + 2;
  const faultWays = project.faultKA?.smdbWays ?? null;
  rows.forEach((row, i) => {
    const r = first + i;
    const z = row.sized;
    s.set(`A${r}`, row.name, { align: LEFT });
    s.set(`B${r}`, sp(row.phases));
    s.set(`C${r}`, null);
    s.set(`D${r}`, z?.breakerA ?? null);
    s.set(`E${r}`, null);
    s.set(`F${r}`, z?.breakerA ? faultWays : null);
    s.set(`G${r}`, z?.cable ? `${z.cable.runs}x4C` : '');
    s.set(`H${r}`, z?.cable ? cableType(row.fireRated) : '');
    s.set(`I${r}`, z?.cable?.sizeMm2 ?? null);
    s.set(`J${r}`, z?.cable ? (z.cable.runs === 1 ? z.eccMm2 : eccCell(z)) : null);
    s.set(`K${r}`, null);
    s.set(`L${r}`, round3(row.kw.R), { fmt: KW });
    s.set(`M${r}`, round3(row.kw.Y), { fmt: KW });
    s.set(`N${r}`, round3(row.kw.B), { fmt: KW });
    s.set(`O${r}`, { formula: `SUM(L${r}:N${r})`, result: round3(totalKW(row.kw)) }, { fmt: KW });
    s.set(`P${r}`, round3(row.factor), { fmt: DF });
    s.set(`Q${r}`, { formula: `(O${r}-R${r})*P${r}`, result: round3(row.demandKW) }, { fmt: KW });
    s.set(`R${r}`, round3(row.standbyKW), { fmt: KW });
    s.set(`S${r}`, row.meters.singlePhase || null);
    s.set(`T${r}`, row.meters.threePhase || null);
    s.set(`U${r}`, row.meters.ct || null);
    s.set(`V${r}`, row.remarks, { align: LEFT });
    s.height(r, 24);
  });
  for (let c = 1; c <= 22; c++) s.set(`${col(c)}${lastRow + 1}`, null);

  // Incomer (row 7) and totals.
  const result = results.get(board.id);
  const incomer = input.sizing.get(board.id)?.incomer ?? null;
  const parent = boards.find((b) => b.id === board.parentId);
  const sum = (c: string) => ({ formula: `SUM(${c}${first}:${c}${lastRow})` });
  const totals = {
    R: result?.connected.R ?? 0,
    Y: result?.connected.Y ?? 0,
    B: result?.connected.B ?? 0,
    tcl: result?.connectedKW ?? 0,
    md: result?.demandKW ?? 0,
    sb: result?.standbyKW ?? 0,
  };
  const meters = rows.reduce((m, r) => ({ s: m.s + r.meters.singlePhase, t: m.t + r.meters.threePhase, c: m.c + r.meters.ct }), { s: 0, t: 0, c: 0 });
  s.set('A7', 'INCOMER', { bold: true, align: LEFT });
  s.set('B7', sp(board.phases), head);
  s.set('C7', incomer?.breakerA ?? null, head);
  s.set('D7', null);
  s.set('E7', null);
  s.set('F7', incomer?.breakerA ? (project.faultKA?.lvWays ?? null) : null, head);
  s.set('G7', incomer?.cable ? cableText(incomer.cable) : '', head);
  s.set('H7', incomer?.cable ? cableType(board.fireRated ?? false) : '', head);
  s.set('I7', null);
  s.set('J7', eccCell(incomer), head);
  s.set('K7', null);
  s.set('L7', { formula: `L${totalRow}`, result: round3(totals.R) }, { ...head, fmt: KW });
  s.set('M7', { formula: `M${totalRow}`, result: round3(totals.Y) }, { ...head, fmt: KW });
  s.set('N7', { formula: `N${totalRow}`, result: round3(totals.B) }, { ...head, fmt: KW });
  s.set('O7', { formula: `O${totalRow}`, result: round3(totals.tcl) }, { ...head, fmt: KW });
  s.set('P7', { formula: `P${totalRow}`, result: round3(totals.tcl - totals.sb > 0 ? totals.md / (totals.tcl - totals.sb) : 0) }, { ...head, fmt: DF });
  s.set('Q7', { formula: `Q${totalRow}`, result: round3(totals.md) }, { ...head, fmt: KW });
  s.set('R7', { formula: `R${totalRow}`, result: round3(totals.sb) }, { ...head, fmt: KW });
  s.set('S7', { formula: `S${totalRow}`, result: meters.s }, head);
  s.set('T7', { formula: `T${totalRow}`, result: meters.t }, head);
  s.set('U7', { formula: `U${totalRow}`, result: meters.c }, head);
  s.set('V7', null);
  s.height(7, 24);
  s.merge('A8:V8', 'OUTGOING WAYS:', { bold: true, align: LEFT });

  s.merge(`A${totalRow}:F${totalRow}`, '', {});
  s.merge(`G${totalRow}:K${totalRow + 1}`, 'CONNECTED LOAD IN KW :', head);
  (['L', 'M', 'N', 'O'] as const).forEach((c, i) =>
    s.merge(`${c}${totalRow}:${c}${totalRow + 1}`, { ...sum(c), result: round3([totals.R, totals.Y, totals.B, totals.tcl][i]) }, { ...head, fmt: KW }),
  );
  s.merge(`P${totalRow}:P${totalRow + 1}`, { formula: `IF(O${totalRow}-R${totalRow}>0,Q${totalRow}/(O${totalRow}-R${totalRow}),0)`, result: round3(totals.tcl - totals.sb > 0 ? totals.md / (totals.tcl - totals.sb) : 0) }, { ...head, fmt: DF });
  s.merge(`Q${totalRow}:Q${totalRow + 1}`, { ...sum('Q'), result: round3(rows.reduce((a, r) => a + r.demandKW, 0)) }, { ...head, fmt: KW });
  s.merge(`R${totalRow}:R${totalRow + 1}`, { ...sum('R'), result: round3(totals.sb) }, { ...head, fmt: KW });
  s.merge(`S${totalRow}:S${totalRow + 1}`, { ...sum('S'), result: meters.s }, head);
  s.merge(`T${totalRow}:T${totalRow + 1}`, { ...sum('T'), result: meters.t }, head);
  s.merge(`U${totalRow}:U${totalRow + 1}`, { ...sum('U'), result: meters.c }, head);
  s.merge(`V${totalRow}:V${totalRow + 1}`, 'TOTAL', { ...head, align: LEFT });
  s.height(totalRow, 15);
  s.height(totalRow + 1, 15);

  const f = totalRow + 2;
  s.set(`A${f}`, `${board.kind === 'SMDB' ? 'SMDB' : 'BOARD'} CONNECTED TO:`, { bold: true, align: LEFT });
  s.merge(`B${f}:F${f}`, parent?.ref ?? 'DEWA SUPPLY', { bold: true, align: LEFT });
  s.set(`A${f + 1}`, `MAX. DEMAND IN KW (${board.phases === 1 ? '1PH' : '3PH'}):`, { bold: true, align: LEFT });
  s.merge(`B${f + 1}:D${f + 1}`, { formula: `Q${totalRow}`, result: round3(totals.md) }, { bold: true, size: 11, fmt: KW });
  s.merge(`E${f + 1}:G${f + 1}`, 'OVERALL DIVERSITY FACTOR =', { bold: true, align: { horizontal: 'right', vertical: 'middle' } });
  s.merge(`H${f + 1}:I${f + 1}`, { formula: `P${totalRow}`, result: round3(totals.tcl - totals.sb > 0 ? totals.md / (totals.tcl - totals.sb) : 0) }, { bold: true, fmt: DF, align: LEFT });
  s.merge(`J${f + 1}:R${f + 1}`, 'TOTAL CONNECTED LOAD IN KW [DUTY+STANDBY] =', { bold: true, align: { horizontal: 'right', vertical: 'middle' } });
  s.merge(`S${f + 1}:U${f + 1}`, { formula: `O${totalRow}`, result: round3(totals.tcl) }, { bold: true, size: 11, fmt: KW, align: LEFT });
  s.merge(`A${f + 2}:I${f + 2}`, '', {});
  s.merge(`J${f + 2}:R${f + 2}`, 'STANDBY LOAD IN KW =', { bold: true, align: { horizontal: 'right', vertical: 'middle' } });
  s.merge(`S${f + 2}:U${f + 2}`, { formula: `R${totalRow}`, result: round3(totals.sb) }, { bold: true, size: 11, fmt: KW, align: LEFT });
  s.merge(`A${f + 3}:I${f + 3}`, 'NOTE:', { bold: true, align: LEFT });
  s.merge(`J${f + 3}:R${f + 3}`, 'ACTUAL CONNECTED LOAD IN KW [DUTY - STANDBY] =', { bold: true, align: { horizontal: 'right', vertical: 'middle' } });
  s.merge(`S${f + 3}:U${f + 3}`, { formula: `O${totalRow}-R${totalRow}`, result: round3(totals.tcl - totals.sb) }, { bold: true, size: 11, fmt: KW, align: LEFT });
  for (let r = f; r <= f + 3; r++) s.height(r, 15);
  footer(s, f + 4, project, 'V', { tel: 'G', fax: 'L', rev: 'U', revValue: 'V', legend: ['C', 'G', 'I', 'M'], dateLabel: 'U', dateValue: 'V' });
}

// ---------- LV panel sheet ----------

function lvPanelSheet(ws: Worksheet, board: Board, input: ScheduleInput, txName: string) {
  const s = new Sheet(ws);
  setupPage(ws);
  s.widths([25.3, 8.1, 6.1, 8.3, 8.8, 13, 7, 13.1, 28.1, 12.7, 11.4, 13, 9.8, 13, 13, 11.3, 13.1, 12.7, 10.8, 6.7, 13, 8, 37.1]);
  const { project, results } = input;
  titleBlock(s, 'MAIN DISTRIBUTION BOARD - DETAILS OF CONNECTED LOAD', project, board.location, board.ref, {
    consultant: 'M1:V1',
    row2: [['A2', 'B2:G2'], ['H2:I2', 'J2:O2'], ['P2', 'Q2:V2']],
    row3: [['A3', 'B3:G3'], ['H3:I3', 'J3:O3'], ['P3', 'Q3:V3']],
    row4: ['B4:G4', 'H4:V4'],
  });
  const head = { bold: true };
  s.merge('A5:A6', 'CIRCUIT/FEEDER DB No', head);
  s.merge('B5:B6', 'WAY NO', head);
  s.merge('C5:C6', 'SP/ TP', head);
  s.merge('D5:F5', 'RATING AMPS', head);
  s.set('D6', 'ISOLATOR', head);
  s.set('E6', 'MCCB', head);
  s.set('F6', 'ACB', head);
  s.merge('G5:G6', 'FAULT DUTY IN KA', head);
  s.merge('H5:J5', 'CABLE SIZE, TYPE AND NO. OF CORES', head);
  s.set('H6', 'No. Of CORES 1c/2c/4c', head);
  s.set('I6', 'TYPE XLPE/ SWA/ PVC', head);
  s.set('J6', 'SIZE', head);
  s.set('K5', 'ECC', head);
  s.set('K6', 'SIZE mm²', head);
  s.set('L5', '', head);
  s.set('L6', 'Length Of Cable (Mtres.)', head);
  s.merge('M5:P5', 'CONNECTED LOAD IN KW', head);
  ['R-PH KW', 'Y-PH KW', 'B-PH KW', 'TOTAL LOAD KW'].forEach((t, i) => s.set(`${col(13 + i)}6`, t, head));
  s.merge('Q5:Q6', 'DIVERSITY FACTOR', head);
  s.merge('R5:R6', 'MAXIMUM DEMAND LOAD IN kW', head);
  s.merge('S5:S6', 'STANDBY LOAD IN KW', head);
  s.merge('T5:V5', 'PROPOSED TYPE & No OF KWHMETERS', head);
  s.set('T6', '1PH (1)', head);
  s.set('U6', '3PH (2)', head);
  s.set('V6', 'LV/HV CT', head);
  s.merge('W5:W6', 'REMARKS', head);
  s.height(5, 27.75);
  s.height(6, 36.75);

  const rows = scheduleRows(board, input);
  const first = 9;
  const lastRow = first + Math.max(rows.length, 1) - 1;
  const totalRow = lastRow + 2;
  const lv = input.sizing.get(board.id)?.lv ?? null;
  rows.forEach((row, i) => {
    const r = first + i;
    const z = row.sized;
    s.set(`A${r}`, row.name, { align: LEFT });
    s.set(`B${r}`, `RYB${i + 1}`);
    s.set(`C${r}`, sp(row.phases));
    s.set(`D${r}`, null);
    s.set(`E${r}`, z?.breakerA ?? null);
    s.set(`F${r}`, null);
    s.set(`G${r}`, z?.breakerA ? (project.faultKA?.lvWays ?? null) : null);
    s.set(`H${r}`, null);
    s.set(`I${r}`, z?.cable ? cableType(row.fireRated) : '');
    s.set(`J${r}`, z?.cable ? cableText(z.cable) : '');
    s.set(`K${r}`, eccCell(z));
    s.set(`L${r}`, null);
    s.set(`M${r}`, round3(row.kw.R), { fmt: KW });
    s.set(`N${r}`, round3(row.kw.Y), { fmt: KW });
    s.set(`O${r}`, round3(row.kw.B), { fmt: KW });
    s.set(`P${r}`, { formula: `SUM(M${r}:O${r})`, result: round3(totalKW(row.kw)) }, { fmt: KW });
    s.set(`Q${r}`, round3(row.factor), { fmt: DF });
    s.set(`R${r}`, { formula: `(P${r}-S${r})*Q${r}`, result: round3(row.demandKW) }, { fmt: KW });
    s.set(`S${r}`, round3(row.standbyKW), { fmt: KW });
    s.set(`T${r}`, row.meters.singlePhase || null);
    s.set(`U${r}`, row.meters.threePhase || null);
    s.set(`V${r}`, row.meters.ct || null);
    s.set(`W${r}`, row.remarks, { align: LEFT });
    s.height(r, 24);
  });
  for (let c = 1; c <= 23; c++) s.set(`${col(c)}${lastRow + 1}`, null);

  const result = results.get(board.id);
  const t = { R: result?.connected.R ?? 0, Y: result?.connected.Y ?? 0, B: result?.connected.B ?? 0, tcl: result?.connectedKW ?? 0, md: result?.demandKW ?? 0, sb: result?.standbyKW ?? 0 };
  const df = t.tcl - t.sb > 0 ? t.md / (t.tcl - t.sb) : 0;
  const meters = rows.reduce((m, r) => ({ s: m.s + r.meters.singlePhase, t: m.t + r.meters.threePhase, c: m.c + r.meters.ct }), { s: 0, t: 0, c: 0 });
  const ct = lv?.ctMeter?.kind === 'CT' ? lv.ctMeter : null;
  s.set('A7', 'INCOMER 1', { bold: true, align: LEFT });
  s.set('B7', null);
  s.set('C7', '4P', head);
  s.set('D7', null);
  s.set('E7', null);
  s.set('F7', lv?.acbA ? `${lv.acbA}A SET AT ${lv.setting?.toFixed(2)}` : '', head);
  s.set('G7', project.faultKA?.lvPanel ?? null, head);
  s.merge('H7:J7', '<<<<<  BY DEWA  >>>>>', head);
  s.set('K7', null);
  s.set('L7', null);
  s.set('M7', { formula: `M${totalRow}`, result: round3(t.R) }, { ...head, fmt: KW });
  s.set('N7', { formula: `N${totalRow}`, result: round3(t.Y) }, { ...head, fmt: KW });
  s.set('O7', { formula: `O${totalRow}`, result: round3(t.B) }, { ...head, fmt: KW });
  s.set('P7', { formula: `P${totalRow}`, result: round3(t.tcl) }, { ...head, fmt: KW });
  s.set('Q7', { formula: `Q${totalRow}`, result: round3(df) }, { ...head, fmt: DF });
  s.set('R7', { formula: `R${totalRow}`, result: round3(t.md) }, { ...head, fmt: KW });
  s.set('S7', { formula: `S${totalRow}`, result: round3(t.sb) }, { ...head, fmt: KW });
  s.set('T7', 0, head);
  s.set('U7', null);
  s.set('V7', ct ? 1 : null, head);
  s.set('W7', ct ? `${ct.ratio}/5A CTM${ct.checkMeter ? ' + CHECK METER' : ''}` : '', { ...head, align: LEFT });
  s.height(7, 24);
  s.merge('A8:W8', 'OUTGOING WAYS:', { bold: true, align: LEFT });

  const sum = (c: string) => ({ formula: `SUM(${c}${first}:${c}${lastRow})` });
  s.merge(`A${totalRow}:G${totalRow}`, '', {});
  s.merge(`H${totalRow}:L${totalRow + 1}`, 'CONNECTED LOAD IN KW :', head);
  (['M', 'N', 'O', 'P'] as const).forEach((c, i) => s.merge(`${c}${totalRow}:${c}${totalRow + 1}`, { ...sum(c), result: round3([t.R, t.Y, t.B, t.tcl][i]) }, { ...head, fmt: KW }));
  s.merge(`Q${totalRow}:Q${totalRow + 1}`, { formula: `IF(P${totalRow}-S${totalRow}>0,R${totalRow}/(P${totalRow}-S${totalRow}),0)`, result: round3(df) }, { ...head, fmt: DF });
  s.merge(`R${totalRow}:R${totalRow + 1}`, { ...sum('R'), result: round3(rows.reduce((a, r) => a + r.demandKW, 0)) }, { ...head, fmt: KW });
  s.merge(`S${totalRow}:S${totalRow + 1}`, { ...sum('S'), result: round3(t.sb) }, { ...head, fmt: KW });
  s.merge(`T${totalRow}:T${totalRow + 1}`, { ...sum('T'), result: meters.s }, head);
  s.merge(`U${totalRow}:U${totalRow + 1}`, { ...sum('U'), result: meters.t }, head);
  s.merge(`V${totalRow}:V${totalRow + 1}`, { formula: `V7+SUM(V${first}:V${lastRow})`, result: meters.c + (ct ? 1 : 0) }, head);
  s.merge(`W${totalRow}:W${totalRow + 1}`, 'TOTAL', { ...head, align: LEFT });
  s.height(totalRow, 15);
  s.height(totalRow + 1, 15);

  const f = totalRow + 2;
  s.set(`A${f}`, 'MDB CONNECTED TO:', { bold: true, align: LEFT });
  s.merge(`B${f}:G${f}`, txName, { bold: true, align: LEFT });
  s.set(`A${f + 1}`, 'MAXIMUM DEMAND IN KW (3PH):', { bold: true, align: LEFT });
  s.merge(`B${f + 1}:E${f + 1}`, { formula: `R${totalRow}`, result: round3(t.md) }, { bold: true, size: 11, fmt: KW });
  s.merge(`F${f + 1}:H${f + 1}`, 'AT DIVERSITY FACTOR =', { bold: true, align: { horizontal: 'right', vertical: 'middle' } });
  s.merge(`I${f + 1}:J${f + 1}`, { formula: `Q${totalRow}`, result: round3(df) }, { bold: true, fmt: DF, align: LEFT });
  s.merge(`K${f + 1}:S${f + 1}`, 'TOTAL CONNECTED LOAD IN KW [DUTY+STANDBY] =', { bold: true, align: { horizontal: 'right', vertical: 'middle' } });
  s.merge(`T${f + 1}:V${f + 1}`, { formula: `P${totalRow}`, result: round3(t.tcl) }, { bold: true, size: 11, fmt: KW, align: LEFT });
  s.merge(`A${f + 2}:J${f + 2}`, '', {});
  s.merge(`K${f + 2}:S${f + 2}`, 'STANDBY LOAD IN KW =', { bold: true, align: { horizontal: 'right', vertical: 'middle' } });
  s.merge(`T${f + 2}:V${f + 2}`, { formula: `S${totalRow}`, result: round3(t.sb) }, { bold: true, size: 11, fmt: KW, align: LEFT });
  s.merge(`A${f + 3}:J${f + 3}`, lv?.transformer ? `NOTE: ${lv.transformer.kVA} kVA transformer (DEWA limit ${lv.transformer.maxKW} kW).` : 'NOTE:', { bold: true, align: LEFT });
  s.merge(`K${f + 3}:S${f + 3}`, 'ACTUAL CONNECTED LOAD IN KW [DUTY - STANDBY] =', { bold: true, align: { horizontal: 'right', vertical: 'middle' } });
  s.merge(`T${f + 3}:V${f + 3}`, { formula: `P${totalRow}-S${totalRow}`, result: round3(t.tcl - t.sb) }, { bold: true, size: 11, fmt: KW, align: LEFT });
  for (let r = f; r <= f + 3; r++) s.height(r, 15);
  footer(s, f + 4, project, 'W', { tel: 'H', fax: 'M', rev: 'V', revValue: 'W', legend: ['D', 'H', 'J', 'N'], dateLabel: 'V', dateValue: 'W' });
}

// ---------- project summary ----------

function summarySheet(ws: Worksheet, panels: Board[], input: ScheduleInput, txNames: Map<string, string>) {
  const s = new Sheet(ws);
  setupPage(ws);
  s.widths([15.8, 11.1, 12.3, 23.1, 14.4, 7.7, 11.4, 13.1, 9.7, 7.8, 9, 13, 13, 12, 10.8, 13, 9, 9.4, 6.8, 8.8, 37]);
  const { project, results, sizing } = input;
  s.merge('A1:I1', 'PROJECT SUMMARY', { bold: true, size: 11, align: LEFT, box: false });
  s.merge('L1:T1', project.details?.consultant ?? '', { bold: true, size: 16, align: { horizontal: 'right', vertical: 'middle' }, box: false });
  const d = project.details;
  s.merge('A2:B2', 'Project:', { bold: true, size: 8, align: LEFT });
  s.merge('C2:G2', project.name, { bold: true, size: 8, align: LEFT });
  s.merge('H2:I2', 'Owner:', { bold: true, size: 8, align: LEFT });
  s.merge('J2:O2', d?.owner ?? '', { bold: true, size: 8, align: LEFT });
  s.set('P2', 'Area:', { bold: true, size: 8, align: LEFT });
  s.merge('Q2:T2', d?.area ?? '', { bold: true, size: 8, align: LEFT });
  s.merge('A3:B3', 'Planned Completion Date:', { bold: true, size: 8, align: LEFT });
  s.merge('C3:G3', d?.completionDate ?? '', { bold: true, size: 8, align: LEFT });
  s.merge('H3:I3', 'Location:', { bold: true, size: 8, align: LEFT });
  s.merge('J3:O3', '', { bold: true, size: 8, align: LEFT });
  s.set('P3', 'Plot No:', { bold: true, size: 8, align: LEFT });
  s.merge('Q3:T3', d?.plotNo ?? '', { bold: true, size: 8, align: LEFT });

  const head = { bold: true };
  s.merge('A5:A6', 'Transformer Reference', head);
  s.set('B5', '', head);
  s.set('B6', 'SP/ TP', head);
  s.merge('C5:E5', 'RATINGS/AMPS', head);
  s.set('C6', 'F/S ISO', head);
  s.set('D6', 'ACB', head);
  s.set('E6', 'MCCB', head);
  s.merge('F5:F6', 'FAULT DUTY IN KA', head);
  s.merge('G5:I5', 'CABLE SIZE, TYPE AND NO. OF CORES', head);
  s.set('G6', 'No. Of CORES 1c/2c/4c', head);
  s.set('H6', 'TYPE XLPE/ SWA/ PVC', head);
  s.set('I6', 'SIZE', head);
  s.set('J5', 'ECC', head);
  s.set('J6', 'SIZE mm2', head);
  s.merge('K5:N5', 'CONNECTED LOAD IN KW- TCL', head);
  ['R-PH KW', 'Y-PH KW', 'B-PH KW', 'TOTAL KW'].forEach((t, i) => s.set(`${col(11 + i)}6`, t, head));
  s.merge('O5:O6', 'DIVERSITY FACTOR', head);
  s.merge('P5:P6', 'MAXIMUM DEMAND LOAD IN kW', head);
  s.merge('Q5:Q6', 'STAND BY LOAD IN KW', head);
  s.merge('R5:T5', 'PROPOSED TYPE & No OF KWH METERS', head);
  s.set('R6', '1PH (1)', head);
  s.set('S6', '3PH (2)', head);
  s.set('T6', 'LV/HV CT', head);
  s.merge('U5:U6', 'REMARKS', head);
  s.height(5, 27.75);
  s.height(6, 36.75);
  s.set('A7', 'OUTGOINGS:', { bold: true, align: LEFT, box: false });

  const first = 8;
  panels.forEach((panel, i) => {
    const r = first + i;
    const res = results.get(panel.id);
    const lv = sizing.get(panel.id)?.lv ?? null;
    const m = sizing.get(panel.id)?.meters ?? zero();
    const base = (res?.connectedKW ?? 0) - (res?.standbyKW ?? 0);
    s.set(`A${r}`, txNames.get(panel.id) ?? '', { align: LEFT });
    s.set(`B${r}`, '4P');
    s.set(`C${r}`, null);
    s.set(`D${r}`, lv?.acbA ? `${lv.acbA}A @${lv.setting?.toFixed(2)}` : '');
    s.set(`E${r}`, null);
    s.set(`F${r}`, project.faultKA?.lvPanel ?? null);
    s.set(`G${r}`, 'BY DEWA');
    s.set(`H${r}`, null);
    s.set(`I${r}`, null);
    s.set(`J${r}`, null);
    s.set(`K${r}`, round3(res?.connected.R ?? 0), { fmt: KW });
    s.set(`L${r}`, round3(res?.connected.Y ?? 0), { fmt: KW });
    s.set(`M${r}`, round3(res?.connected.B ?? 0), { fmt: KW });
    s.set(`N${r}`, { formula: `SUM(K${r}:M${r})`, result: round3(res?.connectedKW ?? 0) }, { fmt: KW });
    s.set(`O${r}`, round3(base > 0 ? (res?.demandKW ?? 0) / base : 0), { fmt: DF });
    s.set(`P${r}`, round3(res?.demandKW ?? 0), { fmt: KW });
    s.set(`Q${r}`, round3(res?.standbyKW ?? 0), { fmt: KW });
    s.set(`R${r}`, m.singlePhase);
    s.set(`S${r}`, m.threePhase);
    s.set(`T${r}`, m.ct);
    s.set(`U${r}`, lv?.transformer ? `${lv.transformer.kVA} kVA transformer for ${panel.ref}` : panel.ref, { align: LEFT });
    s.height(r, 24);
  });
  const last = first + Math.max(panels.length, 1) - 1;
  const t = panels.reduce(
    (a, p) => {
      const r = results.get(p.id);
      const m = sizing.get(p.id)?.meters ?? zero();
      return { R: a.R + (r?.connected.R ?? 0), Y: a.Y + (r?.connected.Y ?? 0), B: a.B + (r?.connected.B ?? 0), tcl: a.tcl + (r?.connectedKW ?? 0), md: a.md + (r?.demandKW ?? 0), sb: a.sb + (r?.standbyKW ?? 0), s: a.s + m.singlePhase, t3: a.t3 + m.threePhase, ct: a.ct + m.ct };
    },
    { R: 0, Y: 0, B: 0, tcl: 0, md: 0, sb: 0, s: 0, t3: 0, ct: 0 },
  );
  const df = t.tcl - t.sb > 0 ? t.md / (t.tcl - t.sb) : 0;
  const tr = last + 2;
  const sum = (c: string) => ({ formula: `SUM(${c}${first}:${c}${last})` });
  s.merge(`G${tr}:J${tr + 1}`, 'CONNECTED LOAD IN KW :', head);
  (['K', 'L', 'M', 'N'] as const).forEach((c, i) => s.merge(`${c}${tr}:${c}${tr + 1}`, { ...sum(c), result: round3([t.R, t.Y, t.B, t.tcl][i]) }, { ...head, fmt: KW }));
  s.merge(`O${tr}:O${tr + 1}`, { formula: `IF(N${tr}-Q${tr}>0,P${tr}/(N${tr}-Q${tr}),0)`, result: round3(df) }, { ...head, fmt: DF });
  s.merge(`P${tr}:P${tr + 1}`, { ...sum('P'), result: round3(t.md) }, { ...head, fmt: KW });
  s.merge(`Q${tr}:Q${tr + 1}`, { ...sum('Q'), result: round3(t.sb) }, { ...head, fmt: KW });
  s.merge(`R${tr}:R${tr + 1}`, { ...sum('R'), result: t.s }, head);
  s.merge(`S${tr}:S${tr + 1}`, { ...sum('S'), result: t.t3 }, head);
  s.merge(`T${tr}:T${tr + 1}`, { ...sum('T'), result: t.ct }, head);
  s.merge(`U${tr}:U${tr + 1}`, 'TOTAL', { ...head, align: LEFT });
  const f = tr + 2;
  s.merge(`A${f}:D${f}`, 'TOTAL CONNECTED LOAD INCLUDING STANDBY IN KW (3PH) =', { bold: true, align: LEFT });
  s.set(`E${f}`, { formula: `N${tr}`, result: round3(t.tcl) }, { bold: true, fmt: KW });
  s.set(`P${f}`, 'TOTAL STANDBY LOAD IN KW (3PH)=', { bold: true, align: LEFT });
  s.set(`Q${f}`, { formula: `Q${tr}`, result: round3(t.sb) }, { bold: true, fmt: KW });
  s.merge(`A${f + 1}:D${f + 1}`, 'TOTAL CONNECTED LOAD EXCLUDING STANDBY IN KW (3PH) =', { bold: true, align: LEFT });
  s.set(`E${f + 1}`, { formula: `N${tr}-Q${tr}`, result: round3(t.tcl - t.sb) }, { bold: true, fmt: KW });
  s.set(`I${f + 1}`, 'OVER ALL DIVERSITY FACTOR =', { bold: true, align: LEFT });
  s.set(`J${f + 1}`, { formula: `O${tr}`, result: round3(df) }, { bold: true, fmt: DF });
  s.set(`P${f + 1}`, 'MAXIMUM DEMAND IN KW (3PH)=', { bold: true, align: LEFT });
  s.set(`Q${f + 1}`, { formula: `P${tr}`, result: round3(t.md) }, { bold: true, fmt: KW });
  footer(s, f + 2, project, 'U', { tel: 'H', fax: 'L', rev: 'T', revValue: 'U', legend: ['D', 'H', 'J', 'M'], dateLabel: 'T', dateValue: 'U' });
}

// ---------- unit (flat) DB type sheet ----------

function unitTypeSheet(ws: Worksheet, type: UnitType, input: ScheduleInput, fedFrom: string[]) {
  const s = new Sheet(ws);
  setupPage(ws);
  s.widths([22, 14, 30, 14, 14, 14, 14, 40]);
  const { project, factors } = input;
  const f = factors.get(type.factorRef) ?? null;
  const tcl = totalKW(type.phaseKW);
  let sized: Sized | null = null;
  for (const board of input.boards) {
    const load = board.loads.find((l) => l.unitTypeId === type.id);
    if (load) {
      sized = input.sizing.get(board.id)?.ways.get(load.id) ?? null;
      break;
    }
  }
  s.set('A1', 'PROJECT :', { bold: true, align: LEFT, box: false });
  s.set('C1', project.name, { bold: true, align: LEFT, box: false });
  s.set('E1', 'LOAD DISTRIBUTION SCHEDULE', { bold: true, size: 11, align: LEFT, box: false });
  s.set('A2', 'PLOT NO.:', { bold: true, align: LEFT, box: false });
  s.set('C2', project.details?.plotNo ?? '', { bold: true, align: LEFT, box: false });
  s.set('A3', 'DB REF.:', { bold: true, align: LEFT, box: false });
  s.set('C3', `DB-${type.name}`, { bold: true, align: LEFT, box: false });
  s.set('A4', 'FED FROM :', { bold: true, align: LEFT, box: false });
  s.set('C4', fedFrom.join(', '), { bold: true, align: LEFT, box: false });
  const head = { bold: true };
  ['PHASE', 'R', 'Y', 'B', 'TOTAL'].forEach((t, i) => s.set(`${col(i + 1)}6`, t, head));
  s.set('A7', 'CONNECTED LOAD (KW)', { bold: true, align: LEFT });
  s.set('B7', round3(type.phaseKW.R), { fmt: KW });
  s.set('C7', round3(type.phaseKW.Y), { fmt: KW });
  s.set('D7', round3(type.phaseKW.B), { fmt: KW });
  s.set('E7', { formula: 'SUM(B7:D7)', result: round3(tcl) }, { fmt: KW, bold: true });
  const line = (r: number, label: string, value: Value, fmt?: string, unit = '') => {
    s.set(`A${r}`, label, { bold: true, align: LEFT });
    s.set(`B${r}`, '=', {});
    s.set(`C${r}`, value, { bold: true, fmt, align: LEFT });
    s.set(`D${r}`, unit, {});
  };
  line(9, 'CONNECTED LOAD', { formula: 'E7', result: round3(tcl) }, KW, 'KW');
  line(10, 'DIVERSITY FACTOR', f, DF);
  line(11, 'MAX. DEMAND AT DIVERSITY', f === null ? null : { formula: 'C9*C10', result: round3(tcl * f) }, KW, 'KW');
  line(12, 'INCOMER RATING', sized?.breakerA ?? null, undefined, 'A');
  line(13, 'FEEDER CABLE', sized?.cable ? `${cableText(sized.cable)} ${cableType(false)} + ${eccCell(sized)} ECC` : '', undefined, '');
  line(14, 'DEWA METER', sized?.meter?.kind === '3PH' ? '3-phase direct' : sized?.meter?.kind === '1PH' ? '1-phase direct' : sized?.meter?.kind === 'CT' ? `${sized.meter.ratio}/5A CT` : '', undefined, '');
  s.merge('A16:H16', 'Circuit-by-circuit details of this DB are not in the app yet; only its phase loads were entered.', { align: LEFT, box: false });
  s.ws.pageSetup.printArea = 'A1:H16';
}

// ---------- workbook ----------

const cleanName = (name: string) => name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Sheet';

export async function buildScheduleWorkbook(input: ScheduleInput): Promise<Uint8Array> {
  const mod = (await import('exceljs')) as unknown as { Workbook?: new () => Workbook; default?: { Workbook: new () => Workbook } };
  const WorkbookClass = mod.Workbook ?? mod.default?.Workbook;
  if (!WorkbookClass) throw new Error('The Excel writer did not load.');
  const wb = new WorkbookClass();
  wb.creator = 'Electrical Project System';
  wb.calcProperties.fullCalcOnLoad = true;
  const used = new Set<string>();
  const add = (name: string) => {
    let n = cleanName(name);
    for (let i = 2; used.has(n.toUpperCase()); i++) n = cleanName(`${name.slice(0, 27)} (${i})`);
    used.add(n.toUpperCase());
    return wb.addWorksheet(n);
  };

  const { boards } = input;
  const ids = new Set(boards.map((b) => b.id));
  const roots = boards.filter((b) => !b.parentId || !ids.has(b.parentId));
  const panels = roots.filter((b) => b.kind === 'LVP' || b.supply?.kind === 'transformer').sort((a, b) => a.building.localeCompare(b.building) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  const txNames = new Map(panels.map((p, i) => [p.id, `TX-${String(i + 1).padStart(2, '0')}`]));
  const buildings = [...new Set(panels.map((p) => p.building))];
  for (const building of buildings) {
    summarySheet(add(buildings.length > 1 ? `SUMMARY ${building}` : 'MAIN SUMMARY'), panels.filter((p) => p.building === building), input, txNames);
  }
  for (const panel of panels) lvPanelSheet(add(panel.ref), panel, input, txNames.get(panel.id) ?? '');

  // Every other board, in feeding order under its panel.
  const order: Board[] = [];
  const walk = (parentId: string) =>
    boards
      .filter((b) => b.parentId === parentId)
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
      .forEach((b) => {
        order.push(b);
        walk(b.id);
      });
  for (const root of roots) {
    if (!panels.includes(root)) order.push(root);
    walk(root.id);
  }
  for (const board of order) boardSheet(add(board.ref), board, input);

  for (const type of input.project.unitTypes ?? []) {
    const fedFrom = boards.filter((b) => b.loads.some((l) => l.unitTypeId === type.id)).map((b) => b.ref);
    if (fedFrom.length) unitTypeSheet(add(`DB-${type.name}`), type, input, fedFrom);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
