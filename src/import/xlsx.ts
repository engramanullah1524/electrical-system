import type { Cell, SheetGrid } from './grid';

/** Reads every worksheet of an .xlsx file into plain values, using the values Excel last calculated. */
export async function readWorkbook(data: ArrayBuffer): Promise<SheetGrid[]> {
  // Loaded only when a workbook is imported, so the library stays out of the app's first load.
  const mod = (await import('exceljs')) as unknown as { Workbook?: new () => ExcelWorkbook; default?: { Workbook: new () => ExcelWorkbook } };
  const Workbook = mod.Workbook ?? mod.default?.Workbook;
  if (!Workbook) throw new Error('The Excel reader did not load.');
  const workbook = new Workbook();
  await workbook.xlsx.load(data);

  return workbook.worksheets.map((sheet) => {
    const rows: Cell[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber - 1] = plain(cell.value);
      });
      rows[rowNumber - 1] = Array.from(cells, (c) => c ?? null);
    });
    return { name: sheet.name, rows: Array.from(rows, (r) => r ?? []) };
  });
}

interface ExcelWorkbook {
  xlsx: { load(data: ArrayBuffer): Promise<unknown> };
  worksheets: {
    name: string;
    eachRow(opts: { includeEmpty: boolean }, cb: (row: { eachCell(opts: { includeEmpty: boolean }, cb: (cell: { value: unknown }, col: number) => void): void }, rowNumber: number) => void): void;
  }[];
}

/** Formula cells carry their last calculated result; rich text and links become plain text. */
function plain(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('result' in v) return plain(v.result);
    if ('richText' in v && Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  return null;
}
