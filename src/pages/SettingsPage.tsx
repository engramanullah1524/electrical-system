import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { db } from '../db/db';
import { exportBackup, importBackup } from '../db/backup';
import { ping, type SyncConfig } from '../sync/appsScript';

export function SettingsPage() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    db.settings.get('sync').then((row) => {
      const saved = row?.value as SyncConfig | undefined;
      if (saved) {
        setUrl(saved.url);
        setToken(saved.token);
      }
    });
    navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  async function saveAndTest(event: FormEvent) {
    event.preventDefault();
    const config = { url: url.trim(), token: token.trim() };
    await db.settings.put({ key: 'sync', value: config });
    setSyncStatus('Testing…');
    try {
      const reply = await ping(config);
      const version = reply.scriptVersion ? `, script v${reply.scriptVersion}` : '';
      setSyncStatus(`Connected to ${reply.sheet} — ${reply.rowCount} row(s)${version}.`);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadBackup() {
    const blob = await exportBackup();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `electrical-system-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const count = await importBackup(await file.text());
      setBackupStatus(`Restored ${count} record(s).`);
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : String(error));
    }
    event.target.value = '';
  }

  return (
    <section>
      <h1>Settings</h1>

      <form className="card form" onSubmit={saveAndTest}>
        <h2>Google Sheet sync</h2>
        <p className="muted">
          Uses your existing Site Tasks Sync script. The URL and token stay on this device only and are never part of
          the app's code.
        </p>
        <label>
          Web app URL (ends in /exec)
          <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Token
          <input type="password" required value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </label>
        <button type="submit">Save & test connection</button>
        {syncStatus && <p role="status">{syncStatus}</p>}
      </form>

      <div className="card form">
        <h2>Data on this device</h2>
        <p className="muted">
          {persisted === null
            ? 'This browser does not report whether local data is protected.'
            : persisted
              ? 'Local data is protected from automatic clean-up by the browser.'
              : 'The browser may clear local data when storage runs low.'}
        </p>
        {persisted === false && (
          <button type="button" onClick={async () => setPersisted(await navigator.storage.persist())}>
            Protect local data
          </button>
        )}
        <div className="row">
          <button type="button" onClick={downloadBackup}>
            Download backup
          </button>
          <label className="button secondary">
            Restore backup
            <input type="file" accept="application/json" hidden onChange={restoreBackup} />
          </label>
        </div>
        {backupStatus && <p role="status">{backupStatus}</p>}
      </div>
    </section>
  );
}
