import type { Param, ParamValue } from './types';

const LINE = /^([A-Za-z][\w.]*)\s*=\s*(\S+)\s*(.*)$/;

/**
 * Reads one parameter per line as "key = value unit", e.g. "pfMin = 0.9" or "vdMax = 4 %".
 * Lines that do not fit are returned as errors instead of being silently dropped.
 */
export function parseParams(text: string): { params: Param[]; errors: string[] } {
  const params: Param[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = LINE.exec(line);
    if (!match) {
      errors.push(line);
      continue;
    }
    params.push({ key: match[1], value: toValue(match[2]), unit: match[3].trim() });
  }
  return { params, errors };
}

function toValue(text: string): ParamValue {
  if (text === 'true' || text === 'false') return text === 'true';
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

export function formatParams(params: Param[]): string {
  return params.map((p) => `${p.key} = ${p.value}${p.unit ? ` ${p.unit}` : ''}`).join('\n');
}
