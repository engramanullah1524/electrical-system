import { describe, expect, it } from 'vitest';
import { auditSchedule, type ScheduleRow } from '../src/design/audit';

const row = (patch: Partial<ScheduleRow>): ScheduleRow => ({
  ref: 'DB-1',
  R: 1,
  Y: 1,
  B: 1,
  total: 3,
  df: 0.7,
  md: 2.1,
  standby: 0,
  ...patch,
});

describe('auditSchedule', () => {
  it('passes a consistent sheet', () => {
    const rows = [row({}), row({ ref: 'DB-2' })];
    expect(auditSchedule('SMDB', rows, { R: 2, Y: 2, B: 2, total: 6, md: 4.2, standby: 0 })).toEqual([]);
  });

  it('catches a total formula that skips a row', () => {
    const rows = [row({}), row({ ref: 'Pump', R: 50, Y: 50, B: 50, total: 150, df: 0, md: 0, standby: 150 })];
    const findings = auditSchedule('LVP', rows, { R: 51, Y: 51, B: 1, total: 153, md: 2.1, standby: 150 });
    expect(findings).toMatchObject([{ kind: 'sheet-total', field: 'B', stated: 1, expected: 51 }]);
  });

  it('catches a row whose phases do not add up to its total', () => {
    expect(auditSchedule('SUM', [row({ total: 4, md: 2.8 })], { R: 1, Y: 1, B: 1, total: 4, md: 2.8, standby: 0 })).toMatchObject([
      { kind: 'row-phases', stated: 4, expected: 3 },
    ]);
  });

  it('catches demand that ignores the row’s own standby and factor', () => {
    const rows = [row({ R: 5.5, Y: 0, B: 0, total: 5.5, standby: 5.5, df: 0.5, md: 5.5 })];
    expect(auditSchedule('ESMDB', rows, { R: 5.5, Y: 0, B: 0, total: 5.5, md: 5.5, standby: 5.5 })).toMatchObject([
      { kind: 'row-demand', stated: 5.5, expected: 0 },
    ]);
  });
});
