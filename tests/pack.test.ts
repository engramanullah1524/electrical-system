import { describe, expect, it } from 'vitest';
import core from '../library/packs/core.json';
import { clauseHash, planMerge, validatePack, type LibraryPack, type PackClause } from '../src/library/pack';
import type { Clause, Source } from '../src/library/types';

// Fictional content only.
const source: Source = {
  id: 's1',
  title: 'Example Code',
  issuer: 'Example Authority',
  type: 'authority',
  edition: '2020',
  date: '2020',
  url: 'https://example.org/code.pdf',
  localPath: '',
  status: 'current',
  checkedOn: '2026-01-01',
  notes: '',
};

const packClause = (patch: Partial<PackClause> = {}): PackClause => ({
  id: 's1/1.1',
  sourceId: 's1',
  ref: '1.1',
  page: 3,
  pageLabel: '1',
  title: 'Voltage drop',
  summary: 'Voltage drop stays within a stated limit.',
  params: [{ key: 'vdMaxPercent', value: 4, unit: '%' }],
  tags: ['voltage drop'],
  ...patch,
});

const pack = (clauses: PackClause[]): LibraryPack => ({
  format: 'electrical-system-library',
  formatVersion: 1,
  packId: 'test',
  packVersion: '1',
  sources: [source],
  clauses,
});

const reviewed = (clause: PackClause, status: 'verified' | 'rejected'): Clause => ({
  ...clause,
  status,
  reviewedOn: '2026-02-01',
  reviewNote: 'checked',
  reviewedHash: clauseHash(clause),
});

describe('planMerge', () => {
  it('adds new clauses as candidates, never as verified', () => {
    const result = planMerge(pack([packClause()]), []);
    expect(result.added).toBe(1);
    expect(result.clauses[0]).toMatchObject({ status: 'candidate', reviewedHash: '' });
  });

  it("keeps the user's decision when the clause is unchanged", () => {
    const result = planMerge(pack([packClause()]), [reviewed(packClause(), 'verified')]);
    expect(result.clauses).toEqual([]);
    expect(result.reopened).toBe(0);
  });

  it.each(['verified', 'rejected'] as const)('reopens a %s clause whose content changed', (status) => {
    const changed = packClause({ params: [{ key: 'vdMaxPercent', value: 5, unit: '%' }] });
    const result = planMerge(pack([changed]), [reviewed(packClause(), status)]);
    expect(result.reopened).toBe(1);
    expect(result.clauses[0]).toMatchObject({
      status: 'candidate',
      params: changed.params,
      reviewNote: expect.stringContaining(`marked it ${status}`),
    });
  });

  it('updates a candidate in place without counting it as reopened', () => {
    const local: Clause = { ...packClause(), status: 'candidate', reviewedOn: '', reviewNote: '', reviewedHash: '' };
    const result = planMerge(pack([packClause({ page: 4 })]), [local]);
    expect(result).toMatchObject({ updated: 1, reopened: 0 });
    expect(result.clauses[0]).toMatchObject({ page: 4, status: 'candidate' });
  });

  it('leaves clauses the user added alone', () => {
    const own: Clause = { ...reviewed(packClause({ id: 'mine' }), 'verified') };
    expect(planMerge(pack([packClause()]), [own]).clauses.map((c) => c.id)).toEqual(['s1/1.1']);
  });
});

describe('validatePack', () => {
  it('accepts a well-formed pack', () => {
    expect(validatePack(pack([packClause()]))).toEqual([]);
  });

  it('rejects clauses without a source, page or unique id', () => {
    const problems = validatePack(pack([packClause({ sourceId: 'missing' }), packClause({ page: null })]));
    expect(problems.join(' ')).toMatch(/not in the pack/);
    expect(problems.join(' ')).toMatch(/PDF page/);
    expect(problems.join(' ')).toMatch(/Duplicate clause id/);
  });

  it('requires a link and check date before an edition is called current', () => {
    const bad = { ...pack([]), sources: [{ ...source, url: '', checkedOn: '' }] };
    expect(validatePack(bad).join(' ')).toMatch(/official link/);
  });

  it('passes for the bundled core pack', () => {
    expect(validatePack(core as LibraryPack)).toEqual([]);
  });
});
