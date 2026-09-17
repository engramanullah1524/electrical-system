import { describe, expect, it } from 'vitest';
import { declared, lookupFrom, resolveFromClause } from '../src/library/provenance';
import type { Clause, Source } from '../src/library/types';

// Fictional documents: tests never carry real regulation text or project data.
const source = (patch: Partial<Source> = {}): Source => ({
  id: 's1',
  title: 'Example Wiring Rules',
  issuer: 'Example Authority',
  type: 'authority',
  edition: '2020',
  date: '2020-01-01',
  url: 'https://example.org/rules.pdf',
  localPath: '',
  status: 'current',
  checkedOn: '2026-01-01',
  notes: '',
  ...patch,
});

const clause = (patch: Partial<Clause> = {}): Clause => ({
  id: 'c1',
  sourceId: 's1',
  ref: '4.2',
  page: 12,
  title: 'Power factor',
  summary: 'Installations keep power factor at or above a stated minimum.',
  params: [{ key: 'pfMin', value: 0.9, unit: '' }],
  tags: ['power factor'],
  status: 'verified',
  reviewedOn: '2026-01-02',
  reviewNote: 'Checked page 12',
  ...patch,
});

describe('resolveFromClause', () => {
  it('uses a verified clause from a current source', () => {
    const result = resolveFromClause(lookupFrom([clause()], [source()]), 'c1', 'pfMin');
    expect(result).toEqual({
      usable: true,
      value: 0.9,
      unit: '',
      provenance: { kind: 'clause', clauseId: 'c1' },
      warnings: [],
    });
  });

  it.each(['candidate', 'rejected'] as const)('refuses a %s clause', (status) => {
    const result = resolveFromClause(lookupFrom([clause({ status })], [source()]), 'c1', 'pfMin');
    expect(result.usable).toBe(false);
  });

  it('refuses a clause whose source is superseded', () => {
    const result = resolveFromClause(lookupFrom([clause()], [source({ status: 'superseded' })]), 'c1', 'pfMin');
    expect(result).toMatchObject({ usable: false, reason: expect.stringContaining('superseded') });
  });

  it('refuses anything backed only by a user note, such as an AI-made checklist', () => {
    const result = resolveFromClause(lookupFrom([clause()], [source({ type: 'user-note' })]), 'c1', 'pfMin');
    expect(result).toMatchObject({ usable: false, reason: expect.stringContaining('user note') });
  });

  it('refuses a missing clause, a missing source or a value the clause does not state', () => {
    expect(resolveFromClause(lookupFrom([], [source()]), 'c1', 'pfMin').usable).toBe(false);
    expect(resolveFromClause(lookupFrom([clause()], []), 'c1', 'pfMin').usable).toBe(false);
    expect(resolveFromClause(lookupFrom([clause()], [source()]), 'c1', 'vdMax').usable).toBe(false);
  });

  it('warns when the edition is unconfirmed or the rule is only a project requirement', () => {
    const unconfirmed = resolveFromClause(lookupFrom([clause()], [source({ status: 'unverified' })]), 'c1', 'pfMin');
    const project = resolveFromClause(lookupFrom([clause()], [source({ type: 'project' })]), 'c1', 'pfMin');
    expect(unconfirmed).toMatchObject({ usable: true, warnings: [expect.stringContaining('not yet confirmed')] });
    expect(project).toMatchObject({ usable: true, warnings: [expect.stringContaining('project requirement')] });
  });
});

describe('declared', () => {
  it("labels a designer's value and requires a reason", () => {
    expect(declared(0.7, '', 'Designer', '')).toMatchObject({ usable: false });
    expect(declared(0.7, '', 'Designer', 'Consultant instruction')).toMatchObject({
      usable: true,
      provenance: { kind: 'declared', reason: 'Consultant instruction' },
    });
  });
});
