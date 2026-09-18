import type { DemandFactorEntry, Factor } from '../../design/types';
import { linkedFactor } from '../../project/factors';

/**
 * Chooses a factor from the project's table (it then follows later changes to that entry), or a
 * custom value, which needs a reason so exports can show where it came from.
 */
export function FactorPicker({
  value,
  entries,
  onChange,
  allowNone = false,
}: {
  value: Factor | null;
  entries: DemandFactorEntry[];
  onChange: (factor: Factor | null) => void;
  allowNone?: boolean;
}) {
  const mode = value?.ref ?? (value ? 'custom' : 'none');
  const reason = value?.basis.kind === 'declared' ? value.basis.reason : '';

  return (
    <span className="factor-picker">
      <select
        value={mode}
        onChange={(e) => {
          const choice = e.target.value;
          if (choice === 'none') onChange(null);
          else if (choice === 'custom') onChange({ value: value?.value ?? 1, basis: { kind: 'declared', reason: '' } });
          else {
            const entry = entries.find((x) => x.id === choice);
            if (entry) onChange(linkedFactor(entry));
          }
        }}
      >
        {(allowNone || mode === 'none') && <option value="none">None</option>}
        {entries.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label} ({entry.value})
          </option>
        ))}
        <option value="custom">Custom value…</option>
      </select>
      {mode === 'custom' && value && (
        <>
          <input
            type="number"
            step="0.01"
            min={0}
            max={1}
            className="num"
            value={value.value}
            onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}
          />
          <input
            placeholder="Reason (required)"
            value={reason}
            className={reason ? '' : 'missing'}
            onChange={(e) => onChange({ ...value, basis: { kind: 'declared', reason: e.target.value } })}
          />
        </>
      )}
    </span>
  );
}
