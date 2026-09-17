import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../db/db';
import { clauseHash } from '../library/pack';
import { formatParams, parseParams } from '../library/params';
import {
  SOURCE_STATUS_LABEL,
  SOURCE_TYPE_LABEL,
  type Clause,
  type Source,
  type SourceStatus,
  type SourceType,
} from '../library/types';

type View = 'review' | 'sources' | 'clauses';

export function LibraryPage() {
  const [view, setView] = useState<View>('review');
  const sources = useLiveQuery(() => db.sources.orderBy('id').toArray(), [], []);
  const clauses = useLiveQuery(() => db.clauses.toArray(), [], []);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const candidates = clauses
    .filter((c) => c.status === 'candidate')
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || (a.page ?? 0) - (b.page ?? 0));
  const reviewed = clauses.filter((c) => c.status !== 'candidate');

  const labels: Record<View, string> = {
    review: `Review (${candidates.length})`,
    sources: `Sources (${sources.length})`,
    clauses: `Clauses (${reviewed.length})`,
  };

  return (
    <section>
      <h1>Library</h1>
      <p className="muted">
        The app only uses a rule once you have checked it against its document, edition, clause and page.
      </p>
      <div className="segmented" role="tablist">
        {(Object.keys(labels) as View[]).map((name) => (
          <button key={name} role="tab" aria-selected={name === view} onClick={() => setView(name)}>
            {labels[name]}
          </button>
        ))}
      </div>
      {view === 'review' && <ReviewQueue clauses={candidates} sourceById={sourceById} />}
      {view === 'sources' && <SourcesView sources={sources} />}
      {view === 'clauses' && <ClausesView clauses={reviewed} sources={sources} sourceById={sourceById} />}
    </section>
  );
}

function sourceLabel(source?: Source) {
  if (!source) return 'Source missing';
  return [source.title, source.edition].filter(Boolean).join(', ');
}

function pageText(clause: Clause) {
  if (!clause.page) return '';
  const printed = clause.pageLabel && clause.pageLabel !== String(clause.page) ? ` (printed ${clause.pageLabel})` : '';
  return ` · PDF page ${clause.page}${printed}`;
}

function ReviewQueue({ clauses, sourceById }: { clauses: Clause[]; sourceById: Map<string, Source> }) {
  if (clauses.length === 0) return <p className="muted">Nothing is waiting for review.</p>;
  return (
    <ul className="list">
      {clauses.map((clause) => (
        <ReviewCard key={clause.id} clause={clause} source={sourceById.get(clause.sourceId)} />
      ))}
    </ul>
  );
}

function ReviewCard({ clause, source }: { clause: Clause; source?: Source }) {
  const [note, setNote] = useState('');
  // The fingerprint records exactly what was checked, so a later library change reopens review.
  const decide = (status: 'verified' | 'rejected') =>
    db.clauses.update(clause.id, {
      status,
      reviewedOn: today(),
      reviewNote: note.trim(),
      reviewedHash: clauseHash(clause),
    });
  const link = source?.url ? `${source.url}${clause.page ? `#page=${clause.page}` : ''}` : '';
  const isNote = source?.type === 'user-note';

  return (
    <li className="card">
      <strong>{clause.ref}</strong> {clause.title && `— ${clause.title}`}
      <div className="meta">
        {sourceLabel(source)}
        {pageText(clause)}
      </div>
      {clause.reviewNote && <p className="warn">{clause.reviewNote}</p>}
      <p>{clause.summary}</p>
      {clause.params.length > 0 && <pre className="params">{formatParams(clause.params)}</pre>}
      {link ? (
        <a href={link} target="_blank" rel="noreferrer">
          Open the source at this page
        </a>
      ) : (
        source?.localPath && <div className="meta">Your copy: {source.localPath}</div>
      )}
      {source?.notes && (
        <details>
          <summary>About this source</summary>
          <p className="meta">{source.notes}</p>
        </details>
      )}
      <label>
        What you checked
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {isNote && <p className="warn">This comes from a user note, which cannot be verified as a source.</p>}
      <div className="row">
        <button disabled={isNote || !source} onClick={() => decide('verified')}>
          Verified against the page
        </button>
        <button className="secondary" onClick={() => decide('rejected')}>
          Reject
        </button>
      </div>
    </li>
  );
}

const EMPTY_SOURCE = {
  title: '',
  issuer: '',
  type: 'authority' as SourceType,
  edition: '',
  date: '',
  url: '',
  localPath: '',
  status: 'unverified' as SourceStatus,
  notes: '',
};

function SourcesView({ sources }: { sources: Source[] }) {
  const [form, setForm] = useState(EMPTY_SOURCE);
  const set = (patch: Partial<typeof EMPTY_SOURCE>) => setForm({ ...form, ...patch });

  async function addSource(event: FormEvent) {
    event.preventDefault();
    await db.sources.add({ ...form, id: crypto.randomUUID(), checkedOn: form.status === 'unverified' ? '' : today() });
    setForm(EMPTY_SOURCE);
  }

  return (
    <>
      <form className="card form" onSubmit={addSource}>
        <label>
          Title
          <input required value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label>
          Issued by
          <input required value={form.issuer} onChange={(e) => set({ issuer: e.target.value })} />
        </label>
        <div className="row">
          <label>
            Type
            <select value={form.type} onChange={(e) => set({ type: e.target.value as SourceType })}>
              {Object.entries(SOURCE_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Edition
            <input value={form.edition} onChange={(e) => set({ edition: e.target.value })} />
          </label>
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
        </div>
        <label>
          Official link
          <input type="url" value={form.url} onChange={(e) => set({ url: e.target.value })} />
        </label>
        <label>
          Your copy (path or Drive name)
          <input value={form.localPath} onChange={(e) => set({ localPath: e.target.value })} />
        </label>
        <label>
          Edition status
          <select value={form.status} onChange={(e) => set({ status: e.target.value as SourceStatus })}>
            {Object.entries(SOURCE_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Add source</button>
      </form>
      {sources.length === 0 ? (
        <p className="muted">No sources yet.</p>
      ) : (
        <ul className="list">
          {sources.map((source) => (
            <li key={source.id} className="card">
              <strong>{sourceLabel(source)}</strong>
              <div className="meta">
                {source.issuer} · {SOURCE_TYPE_LABEL[source.type]} · {SOURCE_STATUS_LABEL[source.status]}
                {source.checkedOn && ` (checked ${source.checkedOn})`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ClausesView({
  clauses,
  sources,
  sourceById,
}: {
  clauses: Clause[];
  sources: Source[];
  sourceById: Map<string, Source>;
}) {
  const [sourceId, setSourceId] = useState('');
  const [ref, setRef] = useState('');
  const [page, setPage] = useState('');
  const [pageLabel, setPageLabel] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [paramText, setParamText] = useState('');
  const [tags, setTags] = useState('');
  const parsed = parseParams(paramText);

  async function addClause(event: FormEvent) {
    event.preventDefault();
    if (parsed.errors.length) return;
    // New clauses always start as candidates: nothing is used until it has been reviewed.
    await db.clauses.add({
      id: crypto.randomUUID(),
      sourceId,
      ref: ref.trim(),
      page: page ? Number(page) : null,
      pageLabel: pageLabel.trim(),
      title: title.trim(),
      summary: summary.trim(),
      params: parsed.params,
      tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      status: 'candidate',
      reviewedOn: '',
      reviewNote: '',
      reviewedHash: '',
    });
    setRef('');
    setPage('');
    setPageLabel('');
    setTitle('');
    setSummary('');
    setParamText('');
  }

  return (
    <>
      <form className="card form" onSubmit={addClause}>
        <label>
          Source
          <select required value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Choose a source…</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {sourceLabel(source)}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            Clause / table ref
            <input required value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
          <label>
            PDF page
            <input type="number" min={1} value={page} onChange={(e) => setPage(e.target.value)} />
          </label>
          <label>
            Printed page
            <input value={pageLabel} onChange={(e) => setPageLabel(e.target.value)} />
          </label>
        </div>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Summary in your own words
          <textarea required rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <label>
          Values, one per line as key = value unit
          <textarea rows={3} value={paramText} onChange={(e) => setParamText(e.target.value)} placeholder="pfMin = 0.9" />
        </label>
        {parsed.errors.length > 0 && <p className="warn">Not understood: {parsed.errors.join('; ')}</p>}
        <label>
          Tags (comma separated)
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="voltage drop, cables" />
        </label>
        <button type="submit" disabled={parsed.errors.length > 0}>
          Add for review
        </button>
      </form>
      {clauses.length === 0 ? (
        <p className="muted">No reviewed clauses yet.</p>
      ) : (
        <ul className="list">
          {clauses.map((clause) => (
            <li key={clause.id} className="card">
              <strong>{clause.ref}</strong> {clause.title && `— ${clause.title}`}{' '}
              <span className={`pill ${clause.status}`}>{clause.status}</span>
              <div className="meta">
                {sourceLabel(sourceById.get(clause.sourceId))}
                {pageText(clause)} · reviewed {clause.reviewedOn}
              </div>
              <p>{clause.summary}</p>
              {clause.params.length > 0 && <pre className="params">{formatParams(clause.params)}</pre>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
