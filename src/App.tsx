import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import { LibraryPage } from './pages/LibraryPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';

const TABS = { projects: 'Projects', library: 'Library', settings: 'Settings' } as const;
type Tab = keyof typeof TABS;

// Hash routes (#/library) work on GitHub Pages without any server rewrites.
function tabFromHash(): Tab {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  return name in TABS ? (name as Tab) : 'projects';
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const awaitingReview = useLiveQuery(() => db.clauses.where('status').equals('candidate').count(), [], 0);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
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
        {tab === 'projects' && <ProjectsPage />}
        {tab === 'library' && <LibraryPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
