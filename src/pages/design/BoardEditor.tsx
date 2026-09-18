import { useState } from 'react';
import { db } from '../../db/db';
import {
  LOAD_CATEGORIES,
  LOAD_CATEGORY_LABEL,
  type Board,
  type BoardKind,
  type CableKind,
  type Circuit,
  type DemandFactorEntry,
  type DirectLoad,
  type LoadCategory,
} from '../../design/types';
import { FactorPicker } from './FactorPicker';

const KINDS: BoardKind[] = ['LVP', 'MDB', 'SMDB', 'EMDB', 'ATS', 'MCC', 'DB'];
const CABLE_KINDS: Record<CableKind, string> = {
  pvcSheathed: 'PVC-sheathed (armoured/unarmoured)',
  singleCoreConduit: 'Single-core wires in conduit',
};

const num = (text: string): number | null => (text.trim() === '' ? null : Number(text));
const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));

function CategorySelect({ value, onChange }: { value: LoadCategory | null; onChange: (v: LoadCategory | null) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as LoadCategory | null)} className={value ? '' : 'missing'}>
      <option value="">Not set</option>
      {LOAD_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {LOAD_CATEGORY_LABEL[c]}
        </option>
      ))}
    </select>
  );
}

export function newLoad(): DirectLoad {
  return {
    id: crypto.randomUUID(),
    label: '',
    kind: 'equipment',
    category: null,
    phaseKW: { R: 0, Y: 0, B: 0 },
    demandFactor: { value: 1, basis: { kind: 'declared', reason: '' } },
    standbyKW: 0,
    largestMotorKW: null,
    remarks: '',
  };
}

export function newCircuit(no: number): Circuit {
  return {
    id: crypto.randomUUID(),
    no: `C${no}`,
    phase: 'R',
    breakerA: null,
    rcdMA: null,
    wireMm2: null,
    eccMm2: null,
    lengthM: null,
    cableKind: null,
    area: '',
    points: {},
    equipmentW: 0,
    standby: false,
    remarks: '',
  };
}

export function BoardEditor({
  board,
  boards,
  factors,
  onClose,
}: {
  board: Board;
  boards: Board[];
  factors: DemandFactorEntry[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Board>(board);
  const [message, setMessage] = useState('');
  const set = (patch: Partial<Board>) => setDraft({ ...draft, ...patch });
  const setLoad = (i: number, patch: Partial<DirectLoad>) => set({ loads: draft.loads.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setCircuit = (i: number, patch: Partial<Circuit>) => set({ circuits: draft.circuits.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const parents = boards.filter((b) => b.id !== draft.id && b.building === draft.building);
  const children = boards.filter((b) => b.parentId === draft.id);

  async function save() {
    await db.boards.put(draft);
    setMessage('Saved.');
  }

  async function remove() {
    if (children.length) {
      setMessage(`Move or delete the ${children.length} board(s) fed from ${draft.ref} first.`);
      return;
    }
    await db.boards.delete(draft.id);
    onClose();
  }

  return (
    <div className="card form">
      <div className="row between">
        <h2>{draft.ref || 'Board'}</h2>
        <button type="button" className="secondary" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="row">
        <label>
          Reference
          <input value={draft.ref} onChange={(e) => set({ ref: e.target.value })} />
        </label>
        <label>
          Type
          <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as BoardKind })}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Fed from
          <select value={draft.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value || null })}>
            <option value="">DEWA supply (point of supply)</option>
            {parents.map((b) => (
              <option key={b.id} value={b.id}>
                {b.ref}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phases
          <select value={draft.phases} onChange={(e) => set({ phases: Number(e.target.value) as 1 | 3 })}>
            <option value={3}>3-phase</option>
            <option value={1}>1-phase</option>
          </select>
        </label>
      </div>

      {!draft.parentId && (
        <div className="row">
          <label>
            DEWA supply
            <select
              value={draft.supply?.kind ?? ''}
              onChange={(e) =>
                set({
                  supply:
                    e.target.value === 'transformer'
                      ? { kind: 'transformer', kVA: 1000 }
                      : e.target.value === 'feeder'
                        ? { kind: 'feeder', amps: 100 }
                        : null,
                })
              }
            >
              <option value="">Not set</option>
              <option value="transformer">Transformer</option>
              <option value="feeder">LV feeder</option>
            </select>
          </label>
          {draft.supply?.kind === 'transformer' && (
            <label>
              Transformer kVA
              <input type="number" value={draft.supply.kVA} onChange={(e) => set({ supply: { kind: 'transformer', kVA: Number(e.target.value) } })} />
            </label>
          )}
          {draft.supply?.kind === 'feeder' && (
            <label>
              Feeder A
              <input type="number" value={draft.supply.amps} onChange={(e) => set({ supply: { kind: 'feeder', amps: Number(e.target.value) } })} />
            </label>
          )}
        </div>
      )}

      <div className="row">
        <label>
          Incomer device
          <input value={draft.incomerDevice} onChange={(e) => set({ incomerDevice: e.target.value })} placeholder="ACB / MCCB / isolator" />
        </label>
        <label>
          Incomer A
          <input type="number" value={text(draft.incomerA)} onChange={(e) => set({ incomerA: num(e.target.value) })} />
        </label>
        <label>
          Fault duty kA
          <input type="number" value={text(draft.faultKA)} onChange={(e) => set({ faultKA: num(e.target.value) })} />
        </label>
        <label>
          Cable (as on schedule)
          <input value={draft.cable} onChange={(e) => set({ cable: e.target.value })} placeholder="1x4C 240 XLPE/SWA/PVC" />
        </label>
      </div>

      {draft.parentId && (
        <div className="row">
          <label>
            Incoming cable type (voltage drop)
            <select
              value={draft.feeder?.kind ?? ''}
              onChange={(e) =>
                set({
                  feeder: e.target.value
                    ? { kind: e.target.value as CableKind, sizeMm2: draft.feeder?.sizeMm2 ?? 0, runs: draft.feeder?.runs ?? 1, lengthM: draft.feeder?.lengthM ?? 0 }
                    : null,
                })
              }
            >
              <option value="">Not entered</option>
              {Object.entries(CABLE_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {draft.feeder && (
            <>
              <label>
                Size mm²
                <input type="number" value={draft.feeder.sizeMm2 || ''} onChange={(e) => set({ feeder: { ...draft.feeder!, sizeMm2: Number(e.target.value) } })} />
              </label>
              <label>
                Runs
                <input type="number" min={1} value={draft.feeder.runs} onChange={(e) => set({ feeder: { ...draft.feeder!, runs: Number(e.target.value) } })} />
              </label>
              <label>
                Length m
                <input type="number" value={draft.feeder.lengthM || ''} onChange={(e) => set({ feeder: { ...draft.feeder!, lengthM: Number(e.target.value) } })} />
              </label>
            </>
          )}
        </div>
      )}

      <div className="row">
        <label>
          Transformer load type of its circuits
          <CategorySelect value={draft.loadCategory} onChange={(v) => set({ loadCategory: v })} />
        </label>
        <label>
          Demand factor of its circuits
          <FactorPicker value={draft.circuitDemandFactor} entries={factors} allowNone onChange={(f) => set({ circuitDemandFactor: f })} />
        </label>
        <label>
          Factor on spare capacity here
          <FactorPicker value={draft.spareFactor} entries={factors} allowNone onChange={(f) => set({ spareFactor: f })} />
        </label>
      </div>

      <h3>Outgoing ways and direct loads</h3>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Way / load</th>
              <th>Kind</th>
              <th>Transformer type</th>
              <th>R kW</th>
              <th>Y kW</th>
              <th>B kW</th>
              <th>Demand factor</th>
              <th>Standby kW</th>
              <th>Largest motor kW</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.loads.map((load, i) => (
              <tr key={load.id}>
                <td>
                  <input value={load.label} onChange={(e) => setLoad(i, { label: e.target.value })} />
                </td>
                <td>
                  <select value={load.kind} onChange={(e) => setLoad(i, { kind: e.target.value as DirectLoad['kind'] })}>
                    <option value="equipment">Load</option>
                    <option value="spare">Spare</option>
                    <option value="future">Future</option>
                  </select>
                </td>
                <td>
                  <CategorySelect value={load.category} onChange={(v) => setLoad(i, { category: v })} />
                </td>
                {(['R', 'Y', 'B'] as const).map((ph) => (
                  <td key={ph}>
                    <input
                      type="number"
                      className="num"
                      value={load.phaseKW[ph] || ''}
                      onChange={(e) => setLoad(i, { phaseKW: { ...load.phaseKW, [ph]: Number(e.target.value) } })}
                    />
                  </td>
                ))}
                <td>
                  <FactorPicker value={load.demandFactor} entries={factors} onChange={(f) => f && setLoad(i, { demandFactor: f })} />
                </td>
                <td>
                  <input type="number" className="num" value={load.standbyKW || ''} onChange={(e) => setLoad(i, { standbyKW: Number(e.target.value) })} />
                </td>
                <td>
                  <input type="number" className="num" value={text(load.largestMotorKW)} onChange={(e) => setLoad(i, { largestMotorKW: num(e.target.value) })} />
                </td>
                <td>
                  <button type="button" className="secondary small" onClick={() => set({ loads: draft.loads.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="secondary" onClick={() => set({ loads: [...draft.loads, newLoad()] })}>
        Add way / load
      </button>

      <h3>Final circuits</h3>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>No.</th>
              <th>Phase</th>
              <th>Area</th>
              <th>Load W</th>
              <th>Breaker A</th>
              <th>RCD mA</th>
              <th>Wire mm²</th>
              <th>Length m</th>
              <th>Wiring type</th>
              <th>Standby</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.circuits.map((c, i) => (
              <tr key={c.id}>
                <td>
                  <input className="num" value={c.no} onChange={(e) => setCircuit(i, { no: e.target.value })} />
                </td>
                <td>
                  <select value={c.phase} onChange={(e) => setCircuit(i, { phase: e.target.value as Circuit['phase'] })}>
                    <option>R</option>
                    <option>Y</option>
                    <option>B</option>
                    <option value="RYB">3-phase</option>
                  </select>
                </td>
                <td>
                  <input value={c.area} onChange={(e) => setCircuit(i, { area: e.target.value })} />
                </td>
                <td>
                  <input type="number" className="num" value={c.equipmentW || ''} onChange={(e) => setCircuit(i, { equipmentW: Number(e.target.value) })} />
                </td>
                <td>
                  <input type="number" className="num" value={text(c.breakerA)} onChange={(e) => setCircuit(i, { breakerA: num(e.target.value) })} />
                </td>
                <td>
                  <input type="number" className="num" value={text(c.rcdMA)} onChange={(e) => setCircuit(i, { rcdMA: num(e.target.value) })} />
                </td>
                <td>
                  <input type="number" className="num" value={text(c.wireMm2)} onChange={(e) => setCircuit(i, { wireMm2: num(e.target.value) })} />
                </td>
                <td>
                  <input type="number" className="num" value={text(c.lengthM)} onChange={(e) => setCircuit(i, { lengthM: num(e.target.value) })} />
                </td>
                <td>
                  <select value={c.cableKind ?? ''} onChange={(e) => setCircuit(i, { cableKind: (e.target.value || null) as CableKind | null })}>
                    <option value="">Not set</option>
                    {Object.entries(CABLE_KINDS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={c.standby} onChange={(e) => setCircuit(i, { standby: e.target.checked })} />
                </td>
                <td>
                  <button type="button" className="secondary small" onClick={() => set({ circuits: draft.circuits.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="secondary" onClick={() => set({ circuits: [...draft.circuits, newCircuit(draft.circuits.length + 1)] })}>
        Add circuit
      </button>

      <label>
        Remarks
        <input value={draft.remarks} onChange={(e) => set({ remarks: e.target.value })} />
      </label>
      <div className="row">
        <button type="button" onClick={save}>
          Save board
        </button>
        <button type="button" className="secondary" onClick={remove}>
          Delete board
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
