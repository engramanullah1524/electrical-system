import { useState } from 'react';
import { factorTable, totalKW, type BoardResult } from '../../design/engine';
import { cableText, meterText, SIZING_CLAUSES, type BoardSizing } from '../../design/selection';
import type { Board, DemandFactorEntry } from '../../design/types';
import { downloadBytes, safeFileName } from '../../export/download';
import { buildScheduleWorkbook } from '../../export/scheduleXlsx';
import type { Clause } from '../../library/types';
import type { Project } from '../../project/types';
import { fmt, treeOrder } from './tree';

/** Clauses the automatic chain relies on, in the order a user would verify them. */
const CHAIN_CLAUSES = [
  SIZING_CLAUSES.breaker,
  SIZING_CLAUSES.cables,
  SIZING_CLAUSES.ecc,
  SIZING_CLAUSES.meters,
  SIZING_CLAUSES.transformer,
  SIZING_CLAUSES.lvPanel,
  'designer-sizing-rules/row-demand',
  'designer-sizing-rules/phase-imbalance',
  'designer-demand-factors/flat-db',
  'designer-demand-factors/by-load-type',
  'dm-dbc-2021/G.4.2',
];

/** Each board's automatic incomer, cable, ECC, meters and transformer, and the Excel download. */
export function ScheduleTab({
  project,
  boards,
  results,
  sizing,
  factors,
  clauses,
}: {
  project: Project;
  boards: Board[];
  results: Map<string, BoardResult>;
  sizing: Map<string, BoardSizing>;
  factors: DemandFactorEntry[];
  clauses: Clause[];
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = CHAIN_CLAUSES.map((id) => clauses.find((c) => c.id === id)).filter((c): c is Clause => Boolean(c) && c!.status !== 'verified');

  async function download() {
    setBusy(true);
    setMessage('Preparing the workbook…');
    try {
      const data = await buildScheduleWorkbook({ project, boards, results, sizing, factors: factorTable(factors) });
      downloadBytes(data, `${safeFileName(project.name)} - load schedule.xlsx`);
      setMessage('Downloaded. Check your Downloads folder.');
    } catch (error) {
      setMessage(`Could not build the workbook: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="card">
          <p className="warn">
            Sizing uses only rules you have verified. Verify these {pending.length} clause(s) in Library → Review; until then the parts
            that need them show "—".
          </p>
          <ul>
            {pending.map((c) => (
              <li key={c.id} className="meta">
                {c.title} <span className="pill blocked">{c.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card form">
        <div className="row between">
          <p className="muted">
            Breaker = next rating ≥ TCL × 1.25 × 1.73 A; cable = smallest chart B 4-core row covering it; ECC per Building Code Table G.20
            {project.eccPrecedent150 ? ' (70 mm² with 150 mm², your project option)' : ''}. LV panels: transformer from maximum demand,
            ACB from its full-load current, CT meter from maximum demand.
          </p>
          <button type="button" onClick={download} disabled={busy || boards.length === 0}>
            Download Excel (approved format)
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </div>

      {boards.length === 0 ? (
        <p className="muted">No boards yet. Build them from the Typical floors tab or add them on the Boards tab.</p>
      ) : (
        <div className="table-wrap card">
          <table className="grid">
            <thead>
              <tr>
                <th>Board</th>
                <th>TCL kW</th>
                <th>MD kW</th>
                <th>DF</th>
                <th>Incomer</th>
                <th>Cable</th>
                <th>ECC mm²</th>
                <th>Meters</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {treeOrder(boards).map(({ board, depth }) => {
                const r = results.get(board.id);
                const s = sizing.get(board.id);
                const lv = s?.lv;
                const inc = s?.incomer;
                const meters = s ? [s.meters.singlePhase && `1PH ×${s.meters.singlePhase}`, s.meters.threePhase && `3PH ×${s.meters.threePhase}`, s.meters.ct && `CT ×${s.meters.ct}`].filter(Boolean).join(', ') : '';
                const notes = [...(inc?.notes ?? []), ...(lv?.notes ?? [])].filter((n) => !/not verified yet/.test(n));
                const units = board.loads.filter((l) => l.unitTypeId);
                const groups = new Map<string, { label: string; count: number; text: string }>();
                for (const load of units) {
                  const w = s?.ways.get(load.id);
                  const name = /\(([^)]*)\)\s*$/.exec(load.label)?.[1] ?? load.label;
                  const text = w?.breakerA ? `${fmt(totalKW(load.phaseKW), 3)} kW → ${w.breakerA} A, ${w.cable ? cableText(w.cable) : '—'}, ECC ${w.eccMm2 ?? '—'}${w.meter ? `, ${meterText(w.meter)}` : ''}` : '—';
                  const key = `${name}|${text}`;
                  const g = groups.get(key) ?? { label: name, count: 0, text };
                  g.count++;
                  groups.set(key, g);
                }
                return (
                  <tr key={board.id}>
                    <td style={{ paddingLeft: 8 + depth * 18 }}>
                      <strong>{board.ref}</strong> <span className="meta">{board.kind}</span>
                      {groups.size > 0 && (
                        <details>
                          <summary className="meta">{units.length} flat DB way(s)</summary>
                          <ul>
                            {[...groups.values()].map((g) => (
                              <li key={g.label + g.text} className="meta">
                                {g.label} ×{g.count}: {g.text}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td>{fmt(r?.connectedKW, 3)}</td>
                    <td>{fmt(r?.demandKW, 3)}</td>
                    <td>{fmt(r?.overallFactor, 3)}</td>
                    <td>
                      {lv
                        ? [lv.transformer ? `${lv.transformer.kVA} kVA transformer` : 'transformer —', lv.acbA ? `ACB ${lv.acbA} A set ${lv.setting?.toFixed(2)}` : 'ACB —'].join('; ')
                        : inc?.breakerA
                          ? `${inc.breakerA} A (${fmt(inc.designA, 1)} A needed)`
                          : '—'}
                    </td>
                    <td>{lv ? 'By DEWA' : inc?.cable ? `${cableText(inc.cable)} XLPE/SWA/PVC${board.fireRated ? '/FR' : ''}` : '—'}</td>
                    <td>{inc?.cable && inc.eccMm2 !== null ? `${inc.cable.runs}x1C ${inc.eccMm2}` : '—'}</td>
                    <td>
                      {meters || '—'}
                      {lv?.ctMeter && lv.ctMeter.kind === 'CT' ? <div className="meta">{meterText(lv.ctMeter)}</div> : null}
                    </td>
                    <td className={notes.length ? 'warn' : ''}>{notes.join('; ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
