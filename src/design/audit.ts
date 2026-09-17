/**
 * Arithmetic audit of a load schedule sheet as submitted (e.g. an imported consultant workbook):
 * each row must add up and follow its own demand factor and standby figures, and the sheet's
 * totals must equal the sum of its rows. Consultants reject schedules for exactly these errors.
 */
export interface ScheduleRow {
  ref: string;
  R: number;
  Y: number;
  B: number;
  total: number;
  df: number;
  md: number;
  standby: number;
}

export type ScheduleTotals = Pick<ScheduleRow, 'R' | 'Y' | 'B' | 'total' | 'md' | 'standby'>;

export interface AuditFinding {
  sheet: string;
  ref: string;
  kind: 'row-phases' | 'row-demand' | 'sheet-total';
  field: string;
  stated: number;
  expected: number;
  message: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function auditSchedule(sheet: string, rows: ScheduleRow[], totals: ScheduleTotals, tolerance = 0.01): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const row of rows) {
    const phases = row.R + row.Y + row.B;
    if (Math.abs(phases - row.total) > tolerance) {
      findings.push({
        sheet,
        ref: row.ref,
        kind: 'row-phases',
        field: 'total',
        stated: round3(row.total),
        expected: round3(phases),
        message: `${sheet} / ${row.ref}: R + Y + B = ${round3(phases)} kW but the row total is ${round3(row.total)} kW.`,
      });
    }
    const demand = (row.total - row.standby) * row.df;
    if (Math.abs(demand - row.md) > tolerance) {
      findings.push({
        sheet,
        ref: row.ref,
        kind: 'row-demand',
        field: 'md',
        stated: round3(row.md),
        expected: round3(demand),
        message: `${sheet} / ${row.ref}: maximum demand ${round3(row.md)} kW does not follow (connected ${round3(row.total)} − standby ${round3(row.standby)}) × factor ${round3(row.df)} = ${round3(demand)} kW.`,
      });
    }
  }

  for (const field of ['R', 'Y', 'B', 'total', 'md', 'standby'] as const) {
    const sum = rows.reduce((acc, row) => acc + row[field], 0);
    if (Math.abs(sum - totals[field]) > tolerance) {
      findings.push({
        sheet,
        ref: '(sheet total)',
        kind: 'sheet-total',
        field,
        stated: round3(totals[field]),
        expected: round3(sum),
        message: `${sheet}: the ${field} total is ${round3(totals[field])} but its rows add up to ${round3(sum)}.`,
      });
    }
  }
  return findings;
}
