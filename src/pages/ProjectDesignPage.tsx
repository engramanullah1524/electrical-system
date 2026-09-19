import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../db/db';
import type { SheetGrid } from '../import/grid';
import { planImport } from '../import/plan';
import { readWorkbook } from '../import/xlsx';
import { runChecks, type CheckResult, type CheckStatus } from '../design/checks';
import { computeBoards, factorTable, type BoardResult } from '../design/engine';
import { loadSizingRules, sizeBoards, type BoardSizing } from '../design/selection';
import type { Board, BoardKind, DemandFactorEntry } from '../design/types';
import { lookupFrom } from '../library/provenance';
import { basisText, changeFactor, seedFactors } from '../project/factors';
import type { FaultDuty, Project, ProjectDetails } from '../project/types';
import { BoardEditor } from './design/BoardEditor';
import { GlandsTab } from './design/GlandsTab';
import { ScheduleTab } from './design/ScheduleTab';
import { fmt, treeOrder } from './design/tree';
import { TypicalTab } from './design/TypicalTab';

type Tab = 'typical' | 'boards' | 'schedule' | 'glands' | 'factors' | 'settings' | 'checks' | 'import';

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
  const library = lookupFrom(clauses, sources);
  const rules = loadSizingRules(library);
  const sizing: Map<string, BoardSizing> = error ? new Map() : sizeBoards(boards, results, rules, { eccPrecedent: project.eccPrecedent150 ?? false });
  const update = (patch: Partial<Project>) => db.projects.update(project.id, { ...patch, updatedAt: new Date().toISOString() });

  const labels: Record<Tab, string> = {
    typical: 'Typical floors',
    boards: 'Boards',
    schedule: 'Sizing & Excel',
    glands: 'Glands & lugs',
    factors: `Demand factors (${factors.length})`,
    settings: 'Settings',
    checks: 'Checks',
    import: 'Import workbook',
  };
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
      {tab === 'typical' && <TypicalTab project={project} boards={boards} factors={factors} rules={rules} update={update} />}
      {tab === 'boards' && <BoardsTab project={project} boards={boards} results={results} factors={factors} />}
      {tab === 'schedule' && <ScheduleTab project={project} boards={boards} results={results} sizing={sizing} factors={factors} clauses={clauses} />}
      {tab === 'glands' && <GlandsTab project={project} boards={boards} sizing={sizing} library={library} update={update} />}
      {tab === 'factors' && <FactorsTab factors={factors} onChange={(demandFactors) => update({ demandFactors })} seed={() => update({ demandFactors: seedFactors(clauses, factors) })} />}
      {tab === 'settings' && <SettingsTab project={project} update={update} />}
      {tab === 'import' && <ImportTab project={project} boards={boards} factors={factors} />}
      {tab === 'checks' && (
        <ChecksTab
          checks={
            error
              ? []
              : runChecks({
                  library,
                  boards,
                  results,
                  pointTypes: project.pointTypes ?? [],
                  designPowerFactor: project.designPowerFactor ?? null,
                  nocKWByBuilding: project.nocKWByBuilding ?? {},
                  vdCurrentBasis: project.vdCurrentBasis ?? null,
                  factors: factorTable(factors),
                  unitTypes: project.unitTypes,
                  eccPrecedent150: project.eccPrecedent150,
                })
          }
          boards={boards}
        />
      )}
    </section>
  );
}

function BoardsTab({ project, boards, results, factors }: { project: Project; boards: Board[]; results: Map<string, BoardResult>; factors: DemandFactorEntry[] }) {
  // Buildings named on the project plus any that imported boards brought with them.
  const named = [...new Set([...project.buildings, ...boards.map((b) => b.building)])];
  const buildings = named.length ? named : [''];
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
      <h2>ECC</h2>
      <label className="check-label">
        <input type="checkbox" checked={project.eccPrecedent150 ?? false} onChange={(e) => update({ eccPrecedent150: e.target.checked })} /> Use 70 mm² ECC with 150 mm²
        cables, as DEWA approved on your reference project (the Building Code's Table G.20 gives 95 mm²)
      </label>

      <h2>Fault duty on the schedule (kA)</h2>
      <div className="row">
        {(
          [
            ['lvPanel', 'LV panel incomer'],
            ['lvWays', 'LV panel ways and SMDB incomers'],
            ['smdbWays', 'SMDB ways (flat DBs)'],
          ] as [keyof FaultDuty, string][]
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              value={project.faultKA?.[key] ?? ''}
              onChange={(e) => update({ faultKA: { lvPanel: null, lvWays: null, smdbWays: null, ...project.faultKA, [key]: e.target.value ? Number(e.target.value) : null } })}
            />
          </label>
        ))}
      </div>

      <h2>Title block of the exported schedule</h2>
      <div className="row">
        {(
          [
            ['consultant', 'Consultant'],
            ['owner', 'Owner'],
            ['area', 'Area'],
            ['plotNo', 'Plot no.'],
            ['completionDate', 'Planned completion'],
            ['preparedBy', 'Prepared by'],
            ['telephone', 'Telephone'],
            ['fax', 'Fax'],
            ['revision', 'Revision'],
            ['date', 'Date'],
          ] as [keyof ProjectDetails, string][]
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={project.details?.[key] ?? ''}
              onChange={(e) =>
                update({
                  details: {
                    owner: '',
                    consultant: '',
                    area: '',
                    plotNo: '',
                    completionDate: '',
                    preparedBy: '',
                    telephone: '',
                    fax: '',
                    revision: '',
                    date: '',
                    ...project.details,
                    [key]: e.target.value,
                  },
                })
              }
            />
          </label>
        ))}
      </div>

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

/** The tower or building code at the end of a sheet name, e.g. "TA" in "LV PANEL-1-TA". */
const suffixOf = (name: string) => /(?:^|[-\s])(T[A-Z])(?=$|[\s&])/.exec(name.toUpperCase())?.[1] ?? '';

function ImportTab({ project, boards, factors }: { project: Project; boards: Board[]; factors: DemandFactorEntry[] }) {
  const [sheets, setSheets] = useState<SheetGrid[] | null>(null);
  const [file, setFile] = useState('');
  const [status, setStatus] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const plan = useMemo(
    () =>
      sheets
        ? planImport(sheets, {
            projectId: project.id,
            file,
            factors,
            buildingFor: (name) => {
              const suffix = suffixOf(name);
              return mapping[suffix] ?? suffix;
            },
            today: today(),
          })
        : null,
    [sheets, file, factors, mapping, project.id],
  );
  const suffixes = useMemo(() => [...new Set((plan?.boards ?? []).map((b) => suffixOf(b.ref)))].sort(), [plan]);
  const previous = boards.filter((b) => b.source?.file === file);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setStatus('Reading the workbook…');
    try {
      setSheets(await readWorkbook(await chosen.arrayBuffer()));
      setFile(chosen.name);
      setStatus('');
    } catch (error) {
      setSheets(null);
      setStatus(`Could not read the workbook: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function importNow() {
    if (!plan) return;
    await db.transaction('rw', db.boards, async () => {
      await db.boards.bulkDelete(previous.map((b) => b.id));
      await db.boards.bulkAdd(plan.boards);
    });
    setStatus(
      `Imported ${plan.boards.length} boards${previous.length ? `, replacing ${previous.length} from the earlier import of ${file}` : ''}. Review them on the Boards tab.`,
    );
  }

  return (
    <>
      <div className="card form">
        <p className="muted">
          Reads the consultant's load schedule workbook on this device; the file is not uploaded anywhere. Panel sheets
          become boards, and a way that names another sheet becomes that board. Factors are suggested from way names
          and link to your factor table. Transformer load types and kVA are left for you to set.
        </p>
        {factors.length === 0 && <p className="warn">Load the library factors on the Demand factors tab first, so ways get factor suggestions.</p>}
        <label className="button secondary">
          Choose .xlsx workbook
          <input type="file" accept=".xlsx" hidden onChange={choose} />
        </label>
        {status && <p role="status">{status}</p>}
      </div>

      {plan && (
        <>
          <div className="card form">
            <h2>{file}</h2>
            <p>
              {plan.boards.length} boards, {plan.boards.reduce((n, b) => n + b.loads.length, 0)} ways, {plan.findings.length} arithmetic
              finding(s), {plan.skipped.length} sheet(s) not imported.
            </p>
            {suffixes.some(Boolean) && (
              <div className="row">
                {suffixes.map((s) => (
                  <label key={s || 'none'}>
                    Sheets ending {s || '(no code)'} go to building
                    <input value={mapping[s] ?? s} onChange={(e) => setMapping({ ...mapping, [s]: e.target.value })} list="project-buildings" />
                  </label>
                ))}
                <datalist id="project-buildings">
                  {project.buildings.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
            )}
            <ul className="list">
              {plan.boards.map((b) => (
                <li key={b.id} className="check">
                  <strong>{b.ref}</strong> <span className="meta">({b.building || 'no building'})</span> ← {plan.boards.find((x) => x.id === b.parentId)?.ref ?? 'DEWA supply'} ·{' '}
                  {b.loads.length} way(s)
                </li>
              ))}
            </ul>
            {previous.length > 0 && <p className="warn">Importing replaces the {previous.length} board(s) imported earlier from this file, including any edits made to them.</p>}
            <button type="button" onClick={importNow}>
              Import {plan.boards.length} boards
            </button>
          </div>
          {plan.findings.length > 0 && (
            <details className="card" open>
              <summary>Arithmetic findings in the workbook ({plan.findings.length})</summary>
              <ul>
                {plan.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </details>
          )}
          <details className="card">
            <summary>Suggestions to confirm ({plan.suggestions.length})</summary>
            <ul>
              {plan.suggestions.map((s, i) => (
                <li key={i} className="meta">
                  {s}
                </li>
              ))}
            </ul>
          </details>
          {plan.summaries.length > 0 && (
            <details className="card">
              <summary>Summary sheets (for cross-checking)</summary>
              <ul>
                {plan.summaries.map((s) => (
                  <li key={s.name} className="meta">
                    {s.name}: {fmt(s.totalKW)} kW connected
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="card">
            <summary>Sheets not imported ({plan.skipped.length})</summary>
            <p className="meta">{plan.skipped.join(', ')}</p>
          </details>
        </>
      )}
    </>
  );
}
