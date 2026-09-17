import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { PERMIT_AUTHORITY_LABEL, type PermitAuthority } from '../project/types';

export function ProjectsPage() {
  const projects = useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray(), [], []);
  const [name, setName] = useState('');
  const [authority, setAuthority] = useState<PermitAuthority>('DM');
  const [buildings, setBuildings] = useState('');

  async function addProject(event: FormEvent) {
    event.preventDefault();
    const now = new Date().toISOString();
    await db.projects.add({
      id: crypto.randomUUID(),
      name: name.trim(),
      permitAuthority: authority,
      authorityConfirmed: false,
      buildings: buildings.split(',').map((b) => b.trim()).filter(Boolean),
      notes: '',
      createdAt: now,
      updatedAt: now,
    });
    setName('');
    setBuildings('');
  }

  const toggleConfirmed = (id: string, confirmed: boolean) =>
    db.projects.update(id, { authorityConfirmed: confirmed, updatedAt: new Date().toISOString() });

  return (
    <section>
      <h1>Projects</h1>
      <form className="card form" onSubmit={addProject}>
        <label>
          Project name
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Building permit issued by
          <select value={authority} onChange={(e) => setAuthority(e.target.value as PermitAuthority)}>
            {Object.entries(PERMIT_AUTHORITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buildings (comma separated)
          <input value={buildings} onChange={(e) => setBuildings(e.target.value)} placeholder="e.g. A, B, C" />
        </label>
        <button type="submit">Add project</button>
      </form>

      {projects.length === 0 ? (
        <p className="muted">No projects yet.</p>
      ) : (
        <ul className="list">
          {projects.map((project) => (
            <li key={project.id} className="card">
              <strong>{project.name}</strong>
              <div className="meta">
                {PERMIT_AUTHORITY_LABEL[project.permitAuthority]} · {project.buildings.length} building(s)
                {project.buildings.length > 0 && `: ${project.buildings.join(', ')}`}
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={project.authorityConfirmed}
                  onChange={(e) => toggleConfirmed(project.id, e.target.checked)}
                />
                Permit authority confirmed from the permit document
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
