import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import corePack from '../library/packs/core.json';
import { applyPack } from './db/applyPack';
import { db } from './db/db';
import type { LibraryPack } from './library/pack';
import { LibraryPage } from './pages/LibraryPage';
import { ProjectDesignPage } from './pages/ProjectDesignPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';

const TABS = { projects: 'Projects', library: 'Library', settings: 'Settings' } as const;
type Tab = keyof typeof TABS;

// Hash routes (#/library, #/projects/<id>) work on GitHub Pages without any server rewrites.
function routeFromHash(): { tab: Tab; id: string | null } {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { tab: name in TABS ? (name as Tab) : 'projects', id: id || null };
}

export function App() {
  const [route, setRoute] = useState(routeFromHash);
  const tab = route.tab;
  const awaitingReview = useLiveQuery(() => db.clauses.where('status').equals('candidate').count(), [], 0);

  useEffect(() => {
    // New library versions ship with the app; each device merges them without losing its reviews.
    applyPack(corePack as LibraryPack).catch((error) => console.error(error));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <img src="icon.svg" alt="" width={28} height={28} />
        <span>Electrical Project System</span>
      </header>
      <nav className="nav" aria-label="Main">
        {(Object.keys(TABS) as Tab[]).map((name) => (
          <a key={name} href={`#/${name}`} aria-current={name === tab ? 'page' : undefined}>
            {TABS[name]}
            {name === 'library' && awaitingReview > 0 && <span className="badge">{awaitingReview}</span>}
          </a>
        ))}
      </nav>
      <main className="content">
        {tab === 'projects' && (route.id ? <ProjectDesignPage projectId={route.id} /> : <ProjectsPage />)}
        {tab === 'library' && <LibraryPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
