import { useState } from 'react';
import { db } from '../../db/db';
import { deviationPercent } from '../../design/checks';
import { cableText, meterText, sizeOne, type SizingRules } from '../../design/selection';
import { floorTotals, planTypical } from '../../design/typical';
import type { Board, DemandFactorEntry } from '../../design/types';
import type { Project, TypicalFloor, UnitType } from '../../project/types';
import { fmt } from './tree';

/**
 * The typical-floor plan: unit (flat) DB types with their phase loads, and how many of each type
 * every floor has. Applying it builds each floor's SMDB under its LV panel; sizing follows.
 */
export function TypicalTab({
  project,
  boards,
  factors,
  rules,
  update,
}: {
  project: Project;
  boards: Board[];
  factors: DemandFactorEntry[];
  rules: SizingRules;
  update: (patch: Partial<Project>) => void;
}) {
  const types = project.unitTypes ?? [];
  const floors = project.typicalFloors ?? [];
  const buildings = project.buildings.length ? project.buildings : [''];
  const [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [range, setRange] = useState({ building: buildings[0], from: 1, to: 7, panel: 'LV PANEL-01' });
  const [rangeCounts, setRangeCounts] = useState<Record<string, number>>({});

  const setTypes = (next: UnitType[]) => update({ unitTypes: next });
  const setType = (i: number, patch: Partial<UnitType>) => setTypes(types.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const setFloors = (next: TypicalFloor[]) => update({ typicalFloors: next });
  const setFloor = (i: number, patch: Partial<TypicalFloor>) => setFloors(floors.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const factorOf = (id: string) => factors.find((f) => f.id === id);

  function addType() {
    setTypes([
      ...types,
      { id: crypto.randomUUID(), name: '', phaseKW: { R: 0, Y: 0, B: 0 }, phases: 3, metered: true, factorRef: factorOf('dfFlatDb') ? 'dfFlatDb' : '' },
    ]);
  }

  function addRange() {
    const added: TypicalFloor[] = [];
    for (let n = range.from; n <= range.to; n++) {
      const floor = `${n}F`;
      if (floors.some((f) => f.building === range.building && f.floor === floor)) continue;
      added.push({ id: crypto.randomUUID(), building: range.building, floor, smdb: `SMDB-${floor}`, panel: range.panel, firstUnitNo: n * 100 + 1, counts: { ...rangeCounts } });
    }
    setFloors([...floors, ...added]);
    setStatus(added.length ? `Added ${added.length} floor(s).` : 'Those floors are already in the plan.');
  }

  async function apply() {
    const result = planTypical(project, boards, factors);
    await db.transaction('rw', db.boards, async () => {
      await db.boards.bulkPut(result.boards);
      if (result.removeIds.length) await db.boards.bulkDelete(result.removeIds);
    });
    setNotes(result.notes);
    setStatus(`Built ${result.boards.length} board(s)${result.removeIds.length ? ` and removed ${result.removeIds.length} no longer in the plan` : ''}. See "Sizing & Excel".`);
  }

  const totals = floors.reduce((a, f) => {
    const t = floorTotals(f, types);
    return { units: a.units + t.units, kw: a.kw + t.kw };
  }, { units: 0, kw: 0 });

  return (
    <>
      <p className="muted">
        Enter each flat DB type once with its connected load per phase, then how many of each type every floor has. Applying the
        plan makes one SMDB per floor under the LV panel you name, with one way per flat, phases rotated for balance. Your own
        ways and boards are kept when you apply it again.
      </p>
      {!factorOf('dfFlatDb') && <p className="warn">Load the library factors on the Demand factors tab first (the flat DB factor comes from there).</p>}

      <div className="card form">
        <h2>Flat DB types</h2>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>R kW</th>
                <th>Y kW</th>
                <th>B kW</th>
                <th>TCL kW</th>
                <th>Supply</th>
                <th>DEWA meter</th>
                <th>Demand factor</th>
                <th>MD kW</th>
                <th>Imbalance</th>
                <th>Incomer · cable · ECC</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {types.map((type, i) => {
                const tcl = type.phaseKW.R + type.phaseKW.Y + type.phaseKW.B;
                const factor = factorOf(type.factorRef);
                const dev = type.phases === 3 ? deviationPercent(type.phaseKW) : null;
                const sized = tcl > 0 ? sizeOne(tcl, type.phases, type.metered, rules, project.eccPrecedent150 ?? false) : null;
                return (
                  <tr key={type.id}>
                    <td>
                      <input value={type.name} onChange={(e) => setType(i, { name: e.target.value })} placeholder="STD, 1BHK-A…" className={type.name ? '' : 'missing'} />
                    </td>
                    {(['R', 'Y', 'B'] as const).map((ph) => (
                      <td key={ph}>
                        <input type="number" step="0.001" className="num" value={type.phaseKW[ph] || ''} onChange={(e) => setType(i, { phaseKW: { ...type.phaseKW, [ph]: Number(e.target.value) } })} />
                      </td>
                    ))}
                    <td>{fmt(tcl, 3)}</td>
                    <td>
                      <select value={type.phases} onChange={(e) => setType(i, { phases: Number(e.target.value) as 1 | 3 })}>
                        <option value={3}>TP</option>
                        <option value={1}>SP</option>
                      </select>
                    </td>
                    <td>
                      <input type="checkbox" checked={type.metered} onChange={(e) => setType(i, { metered: e.target.checked })} aria-label="Needs a DEWA meter" />
                    </td>
                    <td>
                      <select value={type.factorRef} onChange={(e) => setType(i, { factorRef: e.target.value })} className={factor ? '' : 'missing'}>
                        <option value="">Choose…</option>
                        {factors.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label} ({f.value})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{factor ? fmt(tcl * factor.value, 3) : '—'}</td>
                    <td className={dev !== null && dev >= 3 ? 'warn' : ''}>{dev === null ? '—' : `${fmt(dev, 1)}%`}</td>
                    <td>
                      {sized?.breakerA ? `${sized.breakerA} A` : '—'}
                      {sized?.cable ? ` · ${cableText(sized.cable)} · ${sized.eccMm2 ?? '?'} mm²` : ''}
                      {sized?.meter ? ` · ${meterText(sized.meter)}` : ''}
                      {sized?.notes.length ? <div className="meta">{sized.notes.join('; ')}</div> : null}
                    </td>
                    <td>
                      <button type="button" className="secondary small" onClick={() => setTypes(types.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={addType}>
          Add flat DB type
        </button>
        <p className="meta">Imbalance must stay below 3% on final DBs (your limit); rebalance the flat's circuits if it is higher.</p>
      </div>

      <div className="card form">
        <h2>Floors</h2>
        {types.length === 0 ? (
          <p className="muted">Add the flat DB types first.</p>
        ) : (
          <>
            <div className="row">
              {buildings.length > 1 && (
                <label>
                  Building
                  <select value={range.building} onChange={(e) => setRange({ ...range, building: e.target.value })}>
                    {buildings.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                From floor
                <input type="number" value={range.from} onChange={(e) => setRange({ ...range, from: Number(e.target.value) })} />
              </label>
              <label>
                To floor
                <input type="number" value={range.to} onChange={(e) => setRange({ ...range, to: Number(e.target.value) })} />
              </label>
              <label>
                Fed from LV panel
                <input value={range.panel} onChange={(e) => setRange({ ...range, panel: e.target.value })} />
              </label>
              {types.map((t) => (
                <label key={t.id}>
                  {t.name || 'type'} per floor
                  <input type="number" min={0} value={rangeCounts[t.id] ?? ''} onChange={(e) => setRangeCounts({ ...rangeCounts, [t.id]: Number(e.target.value) })} />
                </label>
              ))}
            </div>
            <button type="button" className="secondary" onClick={addRange}>
              Add these floors
            </button>
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {buildings.length > 1 && <th>Building</th>}
                    <th>Floor</th>
                    <th>SMDB</th>
                    <th>Fed from</th>
                    <th>First unit no.</th>
                    {types.map((t) => (
                      <th key={t.id}>{t.name || 'type'}</th>
                    ))}
                    <th>Units</th>
                    <th>TCL kW</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {floors.map((floor, i) => {
                    const t = floorTotals(floor, types);
                    return (
                      <tr key={floor.id}>
                        {buildings.length > 1 && (
                          <td>
                            <select value={floor.building} onChange={(e) => setFloor(i, { building: e.target.value })}>
                              {buildings.map((b) => (
                                <option key={b}>{b}</option>
                              ))}
                            </select>
                          </td>
                        )}
                        <td>
                          <input value={floor.floor} onChange={(e) => setFloor(i, { floor: e.target.value })} className="num" />
                        </td>
                        <td>
                          <input value={floor.smdb} onChange={(e) => setFloor(i, { smdb: e.target.value })} />
                        </td>
                        <td>
                          <input value={floor.panel} onChange={(e) => setFloor(i, { panel: e.target.value })} />
                        </td>
                        <td>
                          <input type="number" className="num" value={floor.firstUnitNo} onChange={(e) => setFloor(i, { firstUnitNo: Number(e.target.value) })} />
                        </td>
                        {types.map((type) => (
                          <td key={type.id}>
                            <input
                              type="number"
                              min={0}
                              className="num"
                              value={floor.counts[type.id] ?? ''}
                              onChange={(e) => setFloor(i, { counts: { ...floor.counts, [type.id]: Number(e.target.value) } })}
                            />
                          </td>
                        ))}
                        <td>{t.units}</td>
                        <td>{fmt(t.kw, 3)}</td>
                        <td>
                          <button type="button" className="secondary small" onClick={() => setFloors(floors.filter((_, j) => j !== i))}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="meta">
              {floors.length} floor(s), {totals.units} flat DBs, {fmt(totals.kw, 3)} kW connected. Common loads of a floor (landlord DB,
              sauna…) are added as ways on its SMDB in the Boards tab; they stay when the plan is applied again.
            </p>
            <div className="row">
              <label>
                Way label prefix
                <input value={project.unitDbPrefix ?? 'DB-'} onChange={(e) => update({ unitDbPrefix: e.target.value })} />
              </label>
            </div>
            <button type="button" onClick={apply} disabled={!floors.length}>
              Build / update boards from this plan
            </button>
          </>
        )}
        {status && <p role="status">{status}</p>}
        {notes.length > 0 && (
          <ul>
            {notes.map((n, i) => (
              <li key={i} className="warn">
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
