import { useState } from 'react';
import { today } from '../../db/db';
import type { BoardSizing } from '../../design/selection';
import type { Board } from '../../design/types';
import { downloadBytes, safeFileName } from '../../export/download';
import { buildPurchaseWorkbook } from '../../export/purchaseXlsx';
import type { LibraryLookup } from '../../library/provenance';
import { cableRuns, glandsAndLugs, loadGlandRule, seedGlandTable } from '../../procurement/glands';
import type { GlandRow, Project } from '../../project/types';

type Field = 'gland' | 'lug' | 'eccGland' | 'eccLug';
const FIELDS: [Field, string][] = [
  ['gland', '4-core cable gland'],
  ['lug', 'Phase lug (size × hole)'],
  ['eccGland', 'Gland when this size is the ECC'],
  ['eccLug', 'Lug when this size is the ECC'],
];

/** Glands and lugs to buy for every sized cable, and the size table they are read from. */
export function GlandsTab({
  project,
  boards,
  sizing,
  library,
  update,
}: {
  project: Project;
  boards: Board[];
  sizing: Map<string, BoardSizing>;
  library: LibraryLookup;
  update: (patch: Partial<Project>) => void;
}) {
  const [message, setMessage] = useState('');
  const loaded = loadGlandRule(library);
  const table = project.glandTable ?? [];
  const runs = cableRuns(boards, sizing);
  const lines = loaded.ok && table.length ? glandsAndLugs(runs, table, loaded.rule) : [];
  const toConfirm = lines.filter((l) => l.toConfirm);

  const setCell = (size: number, field: Field, value: string) =>
    update({ glandTable: table.map((r) => (r.sizeMm2 === size ? { ...r, [field]: value, source: `Edited by you on ${today()}` } : r)) });

  async function download() {
    try {
      const data = await buildPurchaseWorkbook(project.name, lines, runs);
      downloadBytes(data, `${safeFileName(project.name)} - glands and lugs.xlsx`);
      setMessage('Downloaded.');
    } catch (error) {
      setMessage(`Could not build the list: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!loaded.ok)
    return (
      <p className="warn">
        The purchase quantities come from your gland and lug schedule, which is not usable yet: {loaded.reason} Verify it in Library → Review.
      </p>
    );

  return (
    <>
      <p className="muted">
        One cable run = a 4-core cable and its ECC: 2 glands and 8 lugs for the cable, 2 LS glands and 2 lugs for the ECC. Glands are BW
        indoors and CW outdoors and in pump rooms, chosen at each end by the board's location; fire-rated cables take the LSF gland. Only
        cables the sizing has chosen are counted.
      </p>

      <div className="card form">
        <div className="row between">
          <h2>Purchase list</h2>
          <button type="button" onClick={download} disabled={!lines.length}>
            Download Excel
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        {table.length === 0 ? (
          <p className="muted">Start the size table below first.</p>
        ) : lines.length === 0 ? (
          <p className="muted">No sized cables yet: build the boards from the Typical floors tab and verify the sizing rules.</p>
        ) : (
          <>
            {toConfirm.length > 0 && <p className="warn">{toConfirm.length} line(s) cannot be ordered until you fill the missing size or location.</p>}
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>To confirm</th>
                    <th>Cable runs</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.description}>
                      <td>{line.description}</td>
                      <td>{line.qty}</td>
                      <td className={line.toConfirm ? 'warn' : ''}>{line.toConfirm ?? ''}</td>
                      <td>
                        <details>
                          <summary className="meta">{line.usedBy.length}</summary>
                          <span className="meta">{line.usedBy.join('; ')}</span>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card form">
        <div className="row between">
          <h2>Gland and lug sizes</h2>
          <button type="button" className="secondary" onClick={() => update({ glandTable: seedGlandTable(loaded.seed, table) })}>
            {table.length ? 'Add missing sizes from your schedule' : 'Start from your gland and lug schedule'}
          </button>
        </div>
        <p className="meta">Blank cells are not in your schedule yet. Fill them here; nothing is guessed.</p>
        {table.length > 0 && (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Size mm²</th>
                  {FIELDS.map(([, label]) => (
                    <th key={label}>{label}</th>
                  ))}
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {table.map((row: GlandRow) => (
                  <tr key={row.sizeMm2}>
                    <td>{row.sizeMm2}</td>
                    {FIELDS.map(([field]) => (
                      <td key={field}>
                        <input value={row[field]} onChange={(e) => setCell(row.sizeMm2, field, e.target.value)} className={row[field] ? '' : 'missing'} />
                      </td>
                    ))}
                    <td className="meta">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
