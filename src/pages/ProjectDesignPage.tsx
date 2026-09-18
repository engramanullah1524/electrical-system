import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { runChecks, type CheckResult, type CheckStatus } from '../design/checks';
import { computeBoards, factorTable, type BoardResult } from '../design/engine';
import type { Board, BoardKind, DemandFactorEntry } from '../design/types';
import { lookupFrom } from '../library/provenance';
import { basisText, changeFactor, seedFactors } from '../project/factors';
import type { Project } from '../project/types';
import { BoardEditor } from './design/BoardEditor';

type Tab = 'boards' | 'factors' | 'settings' | 'checks';
const fmt = (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits }));

export function ProjectDesignPage({ projectId }: { projectId: string }) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const boards = useLiveQuery(() => db.boards.where('projectId').equals(projectId).toArray(), [projectId], []);
  const clauses = useLiveQuery(() => db.clauses.toArray(), [], []);
  const sources = useLiveQuery(() => db.sources.toArray(), [], []);
  const [tab, setTab] = useState<Tab>('boards');

  if (project === undefined) return <p className="muted">Loading…</p>;
  if (project === null) return <p className="warn">This project no longer exists on this device.</p>;

  const factors = project.demandFactors ?? [];
  let results = new Map<string, BoardResult>();
  let error = '';
  try {
    results = computeBoards(boards, project.pointTypes ?? [], factorTable(factors));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const update = (patch: Partial<Project>) => db.projects.update(project.id, { ...patch, updatedAt: new Date().toISOString() });

  const labels: Record<Tab, string> = { boards: 'Boards', factors: `Demand factors (${factors.length})`, settings: 'Settings', checks: 'Checks' };
  return (
    <section>
      <a href="#/projects" className="meta">
        ← Projects
      </a>
      <h1>{project.name}</h1>
      <div className="segmented" role="tablist">
        {(Object.keys(labels) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {labels[t]}
          </button>
        ))}
      </div>
      {error && <p className="warn">{error}</p>}
      {tab === 'boards' && <BoardsTab project={project} boards={boards} results={results} factors={factors} />}
      {tab === 'factors' && <FactorsTab factors={factors} onChange={(demandFactors) => update({ demandFactors })} seed={() => update({ demandFactors: seedFactors(clauses, factors) })} />}
      {tab === 'settings' && <SettingsTab project={project} update={update} />}
      {tab === 'checks' && (
        <ChecksTab
          checks={
            error
              ? []
              : runChecks({
                  library: lookupFrom(clauses, sources),
                  boards,
                  results,
                  pointTypes: project.pointTypes ?? [],
                  designPowerFactor: project.designPowerFactor ?? null,
                  nocKWByBuilding: project.nocKWByBuilding ?? {},
                  vdCurrentBasis: project.vdCurrentBasis ?? null,
                  factors: factorTable(factors),
                })
          }
          boards={boards}
        />
      )}
    </section>
  );
}

/** Boards in feeding order: each board is followed by the boards it feeds, indented. */
function treeOrder(boards: Board[]): { board: Board; depth: number }[] {
  const ids = new Set(boards.map((b) => b.id));
  const out: { board: Board; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    boards
      .filter((b) => (parentId === null ? !b.parentId || !ids.has(b.parentId) : b.parentId === parentId))
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
      .forEach((b) => {
        out.push({ board: b, depth });
        walk(b.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

function BoardsTab({ project, boards, results, factors }: { project: Project; boards: Board[]; results: Map<string, BoardResult>; factors: DemandFactorEntry[] }) {
  const buildings = project.buildings.length ? project.buildings : [''];
  const [building, setBuilding] = useState(buildings[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [kind, setKind] = useState<BoardKind>('SMDB');
  const [parentId, setParentId] = useState('');
  const inBuilding = boards.filter((b) => b.building === building);
  const selectedBoard = boards.find((b) => b.id === selected);

  async function addBoard(event: FormEvent) {
    event.preventDefault();
    const board: Board = {
      id: crypto.randomUUID(),
      projectId: project.id,
      building,
      ref: ref.trim(),
      kind,
      parentId: parentId || null,
      supply: null,
      phases: 3,
      incomerDevice: '',
      incomerA: null,
      faultKA: null,
      cable: '',
      eccMm2: null,
      lengthM: null,
      feeder: null,
      loadCategory: null,
      circuitDemandFactor: null,
      childFactor: null,
      spareFactor: null,
      circuits: [],
      loads: [],
      meters: { singlePhase: 0, threePhase: 0, ct: 0 },
      location: '',
      remarks: '',
    };
    await db.boards.add(board);
    setRef('');
    setSelected(board.id);
  }

  return (
    <>
      {buildings.length > 1 && (
        <div className="segmented">
          {buildings.map((b) => (
            <button key={b} aria-selected={b === building} onClick={() => setBuilding(b)}>
              {b}
            </button>
          ))}
        </div>
      )}
      {inBuilding.length === 0 ? (
        <p className="muted">No boards yet. Start with the LV panel or MDB fed by DEWA.</p>
      ) : (
        <div className="table-wrap card">
          <table className="grid">
            <thead>
              <tr>
                <th>Board</th>
                <th>Connected kW</th>
                <th>Standby kW</th>
                <th>Max demand kW</th>
                <th>Overall factor</th>
                <th>Phase deviation</th>
              </tr>
            </thead>
            <tbody>
              {treeOrder(inBuilding).map(({ board, depth }) => {
                const r = results.get(board.id);
                return (
                  <tr key={board.id} className={board.id === selected ? 'selected' : ''}>
                    <td style={{ paddingLeft: 8 + depth * 18 }}>
                      <button type="button" className="link" onClick={() => setSelected(board.id)}>
                        {board.ref || '(unnamed)'}
                      </button>{' '}
                      <span className="meta">{board.kind}</span>
                    </td>
                    <td>{fmt(r?.connectedKW)}</td>
                    <td>{fmt(r?.standbyKW)}</td>
                    <td>{fmt(r?.demandKW)}</td>
                    <td>{fmt(r?.overallFactor, 3)}</td>
                    <td>{r?.phaseDeviationPercent === null || r === undefined ? '—' : `${fmt(r.phaseDeviationPercent, 1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <form className="card form" onSubmit={addBoard}>
        <h2>Add a board</h2>
        <div className="row">
          <label>
            Reference
            <input required value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. SMDB-1F" />
          </label>
          <label>
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as BoardKind)}>
              {(['LVP', 'MDB', 'SMDB', 'EMDB', 'ATS', 'MCC', 'DB'] as BoardKind[]).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Fed from
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">DEWA supply</option>
              {inBuilding.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.ref}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit">Add board</button>
      </form>

      {selectedBoard && (
        <BoardEditor key={selectedBoard.id} board={selectedBoard} boards={boards} factors={factors} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function FactorsTab({ factors, onChange, seed }: { factors: DemandFactorEntry[]; onChange: (f: DemandFactorEntry[]) => void; seed: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  function save(entry: DemandFactorEntry) {
    if (!reason.trim()) return;
    onChange(factors.map((f) => (f.id === entry.id ? changeFactor(f, Number(value), reason.trim()) : f)));
    setEditing(null);
    setReason('');
  }

  return (
    <>
      <p className="muted">
        Every board and way that picks a factor from this table follows it. Change a value after meeting the consultant: the old
        value, the date and your reason are kept.
      </p>
      <button type="button" className="secondary" onClick={seed}>
        {factors.length ? 'Add any missing factors from the library' : 'Start from the library factors'}
      </button>
      <ul className="list">
        {factors.map((entry) => (
          <li key={entry.id} className="card">
            <div className="row between">
              <strong>
                {entry.label}: {entry.value}
              </strong>
              {editing !== entry.id && (
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => {
                    setEditing(entry.id);
                    setValue(String(entry.value));
                  }}
                >
                  Change
                </button>
              )}
            </div>
            <div className="meta">{basisText(entry)}</div>
            {editing === entry.id && (
              <div className="row">
                <label>
                  New value
                  <input type="number" step="0.01" min={0} max={1} value={value} onChange={(e) => setValue(e.target.value)} />
                </label>
                <label>
                  Reason (e.g. agreed with consultant on …)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <button type="button" disabled={!reason.trim()} onClick={() => save(entry)}>
                  Save change
                </button>
                <button type="button" className="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            )}
            {entry.history.length > 0 && (
              <details>
                <summary>History ({entry.history.length})</summary>
                <ul>
                  {entry.history.map((h, i) => (
                    <li key={i} className="meta">
                      Was {h.value} ({basisText(h)}), changed on {h.changedOn}: {h.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function SettingsTab({ project, update }: { project: Project; update: (patch: Partial<Project>) => void }) {
  const pf = project.designPowerFactor;
  const buildings = project.buildings.length ? project.buildings : [''];
  return (
    <div className="card form">
      <div className="row">
        <label>
          Design power factor
          <input
            type="number"
            step="0.01"
            min={0}
            max={1}
            value={pf?.value ?? ''}
            onChange={(e) =>
              update({ designPowerFactor: e.target.value ? { value: Number(e.target.value), basis: pf?.basis ?? { kind: 'declared', reason: '' } } : null })
            }
          />
        </label>
        <label>
          Reason / basis
          <input
            value={pf?.basis.kind === 'declared' ? pf.basis.reason : ''}
            onChange={(e) => pf && update({ designPowerFactor: { ...pf, basis: { kind: 'declared', reason: e.target.value } } })}
            placeholder="e.g. consultant's design basis"
          />
        </label>
      </div>
      <label>
        Current used for sub-main voltage drop
        <select
          value={project.vdCurrentBasis ?? ''}
          onChange={(e) => update({ vdCurrentBasis: (e.target.value || null) as Project['vdCurrentBasis'] })}
        >
          <option value="">Not set</option>
          <option value="demand">Maximum demand of the board</option>
          <option value="connected">Full connected load of the board</option>
        </select>
      </label>
      <h2>DEWA NOC connected load</h2>
      <div className="row">
        {buildings.map((b) => (
          <label key={b}>
            {b || 'Building'} (kW)
            <input
              type="number"
              value={project.nocKWByBuilding?.[b] ?? ''}
              onChange={(e) => {
                const next = { ...(project.nocKWByBuilding ?? {}) };
                if (e.target.value) next[b] = Number(e.target.value);
                else delete next[b];
                update({ nocKWByBuilding: next });
              }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

const STATUS_ORDER: CheckStatus[] = ['fail', 'warn', 'blocked', 'info', 'pass'];
const STATUS_LABEL: Record<CheckStatus, string> = { fail: 'Fails', warn: 'Warnings', blocked: 'Blocked', info: 'Information', pass: 'Passes' };

function ChecksTab({ checks, boards }: { checks: CheckResult[]; boards: Board[] }) {
  if (boards.length === 0) return <p className="muted">Add boards to see checks.</p>;
  return (
    <>
      <p className="muted">
        "Blocked" means a rule cannot run until its library clause is verified or a value is entered. Nothing is judged on an
        unverified rule.
      </p>
      {STATUS_ORDER.map((status) => {
        const items = checks.filter((c) => c.status === status);
        if (!items.length) return null;
        return (
          <details key={status} open={status !== 'pass'} className="card">
            <summary>
              <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span> {items.length}
            </summary>
            <ul className="list">
              {items.map((c) => (
                <li key={c.id} className="check">
                  {c.message}
                  {c.clauseIds.length > 0 && <div className="meta">Source: {c.clauseIds.join(', ')}</div>}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </>
  );
}
