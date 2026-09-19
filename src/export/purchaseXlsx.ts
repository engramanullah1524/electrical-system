import type { Workbook } from 'exceljs';
import type { CableRun, PurchaseLine } from '../procurement/glands';

/** The glands and lugs purchase list, with the cable runs it was counted from. */
export async function buildPurchaseWorkbook(projectName: string, lines: PurchaseLine[], runs: CableRun[]): Promise<Uint8Array> {
  const mod = (await import('exceljs')) as unknown as { Workbook?: new () => Workbook; default?: { Workbook: new () => Workbook } };
  const WorkbookClass = mod.Workbook ?? mod.default?.Workbook;
  if (!WorkbookClass) throw new Error('The Excel writer did not load.');
  const wb = new WorkbookClass();
  const bold = { name: 'Arial', size: 10, bold: true };

  const list = wb.addWorksheet('Glands and lugs');
  list.columns = [
    { header: 'No.', width: 6 },
    { header: 'Item description', width: 48 },
    { header: 'Qty', width: 8 },
    { header: 'Unit', width: 7 },
    { header: 'To confirm before ordering', width: 44 },
    { header: 'Cable runs', width: 60 },
  ];
  list.insertRow(1, [`${projectName}: cable glands and lugs`]);
  list.getRow(1).font = { name: 'Arial', size: 12, bold: true };
  list.getRow(2).font = bold;
  lines.forEach((line, i) => list.addRow([i + 1, line.description, line.qty, 'Nos', line.toConfirm ?? '', line.usedBy.join('; ')]));
  list.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  list.getColumn(6).alignment = { wrapText: true, vertical: 'top' };

  const sheet = wb.addWorksheet('Cable runs');
  sheet.columns = [
    { header: 'From', width: 22 },
    { header: 'To', width: 28 },
    { header: 'Cable', width: 22 },
    { header: 'ECC', width: 14 },
    { header: 'Fire-rated', width: 10 },
    { header: 'From end', width: 12 },
    { header: 'To end', width: 12 },
  ];
  sheet.getRow(1).font = bold;
  for (const r of runs) {
    sheet.addRow([r.from, r.to, `${r.runs}x4C ${r.sizeMm2} mm² Cu XLPE/SWA/PVC${r.fireRated ? '/FR' : ''}`, r.eccMm2 === null ? 'to confirm' : `${r.runs}x1C ${r.eccMm2} mm²`, r.fireRated ? 'Yes' : 'No', r.fromEnv ?? 'not set', r.toEnv ?? 'not set']);
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
