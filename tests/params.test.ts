import { describe, expect, it } from 'vitest';
import { formatParams, parseParams } from '../src/library/params';

describe('parseParams', () => {
  it('reads numbers, booleans, text and units', () => {
    const { params, errors } = parseParams('pfMin = 0.9\nvdMax = 4 %\nrcdRequired = true\nsystem = TN-S\n\n');
    expect(errors).toEqual([]);
    expect(params).toEqual([
      { key: 'pfMin', value: 0.9, unit: '' },
      { key: 'vdMax', value: 4, unit: '%' },
      { key: 'rcdRequired', value: true, unit: '' },
      { key: 'system', value: 'TN-S', unit: '' },
    ]);
  });

  it('reports lines it cannot read instead of dropping them', () => {
    expect(parseParams('pfMin 0.9\n= 4').errors).toEqual(['pfMin 0.9', '= 4']);
  });

  it('round-trips through formatParams', () => {
    const text = 'pfMin = 0.9\nvdMax = 4 %';
    expect(formatParams(parseParams(text).params)).toBe(text);
  });
});
