import { compact, num, text, upper, type Cell, type SheetGrid } from './grid';

/**
 * Reader for the consultant template with "R - PH / Y - PH / B - PH / TOTAL" headers, way names in
 * column B, and a footer giving demand factor, maximum demand, standby and actual connected load.
 */
export interface WayRow {
  row: number;
  label: string;
  phases: 1 | 3 | null;
  device: string;
  ratingA: number | null;
  faultKA: number | null;
  cable: string;
  ecc: string;
  lengthM: number | null;
  R: number;
  Y: number;
  B: number;
  total: number;
}

export interface PanelSheet {
  name: string;
  ways: WayRow[];
  totals: { R: number; Y: number; B: number; total: number };
  footer: { df: number | null; md: number | null; standby: number | null; actual: number | null };
}

export const isSummarySheet = (name: string) => /SUMM?ER?Y|SUMMARY/i.test(name);

export function parsePanelSheet(sheet: SheetGrid): PanelSheet | null {
  const rows = sheet.rows;
  const h = rows.slice(0, 15).findIndex((r) => r.some((v) => compact(v) === 'R-PH'));
  if (h < 0) return null;
  const at = (label: string) => rows[h].findIndex((v) => compact(v) === label);
  const R = at('R-PH');
  const Y = at('Y-PH');
  const B = at('B-PH');
  const T = at('TOTAL');
  if (R < 0 || Y < 0 || B < 0 || T < 0) return null;

  // Other columns are found by their header words in the rows just above.
  const find = (test: (t: string) => boolean) => {
    for (let r = Math.max(0, h - 3); r <= h + 1 && r < rows.length; r++) {
      const i = (rows[r] ?? []).findIndex((v) => test(upper(v)));
      if (i >= 0) return i;
    }
    return -1;
  };
  const cols = {
    phase: find((t) => t.startsWith('SP /') || t.startsWith('SP/')),
    isolator: find((t) => t.startsWith('F/S')),
    mccb: find((t) => t === 'MCCB'),
    acb: find((t) => t === 'ACB'),
    fault: find((t) => t.startsWith('FAULT')),
    cableSize: find((t) => t.startsWith('CABLE SIZE')),
    length: find((t) => t.startsWith('LENGTH')),
    ecc: find((t) => t.startsWith('ECC')),
  };
  const cell = (r: Cell[], i: number) => (i >= 0 ? r[i] : null);

  const ways: WayRow[] = [];
  let totals: PanelSheet['totals'] | null = null;
  const footer: PanelSheet['footer'] = { df: null, md: null, standby: null, actual: null };

  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const joined = r.map(upper).join(' ');
    if (!totals && joined.includes('TOTAL CONN') && num(r[R]) !== null) {
      totals = { R: num(r[R]) ?? 0, Y: num(r[Y]) ?? 0, B: num(r[B]) ?? 0, total: num(r[T]) ?? 0 };
      continue;
    }
    if (totals) {
      // Footer: a label followed somewhere to its right by its number.
      r.forEach((v, j) => {
        const t = upper(v);
        const key = t.startsWith('DEMAND FAC') ? 'df' : t.startsWith('MAX. DEMAN') ? 'md' : t.startsWith('STANDBY LO') ? 'standby' : t.startsWith('ACTUAL CON') ? 'actual' : null;
        if (key && footer[key] === null) footer[key] = r.slice(j + 1).map(num).find((n) => n !== null) ?? null;
      });
      continue;
    }
    const label = text(r[1]) || text(r[0]);
    if (/^(INCOMER|OUT ?GOING)/i.test(label) || /^INCOMER/i.test(text(r[0]))) continue;
    const phases = [num(r[R]), num(r[Y]), num(r[B])];
    if (phases.every((p) => p === null)) continue;

    const ratings: [string, number | null][] = [
      ['Isolator', num(cell(r, cols.isolator))],
      ['MCCB', num(cell(r, cols.mccb))],
      ['ACB', num(cell(r, cols.acb))],
    ];
    const [device, ratingA] = ratings.find(([, v]) => v !== null) ?? ['', null];
    const cableEnd = cols.length > cols.cableSize ? cols.length : cols.cableSize + 3;
    const cable = cols.cableSize >= 0 ? r.slice(cols.cableSize, cableEnd).map(text).find(Boolean) ?? '' : '';
    const phaseText = upper(cell(r, cols.phase));

    ways.push({
      row: i + 1,
      label: label || `(unnamed way, row ${i + 1})`,
      phases: phaseText.startsWith('TP') || phaseText.startsWith('4P') ? 3 : phaseText.startsWith('SP') || phaseText.startsWith('DP') ? 1 : null,
      device,
      ratingA,
      faultKA: num(cell(r, cols.fault)),
      cable,
      ecc: text(cell(r, cols.ecc)),
      lengthM: num(cell(r, cols.length)),
      R: phases[0] ?? 0,
      Y: phases[1] ?? 0,
      B: phases[2] ?? 0,
      total: num(r[T]) ?? 0,
    });
  }
  if (!totals) return null;
  return { name: sheet.name, ways, totals, footer };
}
