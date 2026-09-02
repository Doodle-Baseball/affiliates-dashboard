import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { AuthRequiredError } from './api.js';
import { seriesColor, humanDate, relativeTime } from './format.js';
import Totals from './components/Totals.jsx';
import ProgramCard from './components/ProgramCard.jsx';
import ProgramTable from './components/ProgramTable.jsx';
import EarningsChart from './components/EarningsChart.jsx';
import ManualEntry from './components/ManualEntry.jsx';
import SyncPanel from './components/SyncPanel.jsx';
import SignIn from './components/SignIn.jsx';

/**
 * Theme preference. Storage access can throw outright — a private window, or a
 * browser set to block site data — so every read and write is guarded and the
 * page renders correctly with no stored value.
 */
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme') || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* preference simply does not persist */
    }
  }, [theme]);
  return [theme, setTheme];
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [date, setDate] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [chart, setChart] = useState(null);
  const [error, setError] = useState(null);
  const [manualFor, setManualFor] = useState(null);
  const [sync, setSync] = useState({ running: false, programs: {} });
  const [auth, setAuth] = useState(null);
  const closeStream = useRef(null);

  const load = useCallback(async (targetDate) => {
    try {
      const [next, nextChart] = await Promise.all([
        api.getDashboard(targetDate),
        api.getChart(30, targetDate),
      ]);
      setDashboard(next);
      setChart(nextChart);
      setDate(next.date);
      setAuth((previous) => ({ ...(previous || {}), signedIn: true }));
      setError(null);
    } catch (loadError) {
      if (loadError instanceof AuthRequiredError) {
        setAuth({ authRequired: true, signedIn: false });
        return;
      }
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    api.getAuth()
      .then((next) => {
        setAuth(next);
        if (!next.authRequired || next.signedIn) load(null);
      })
      .catch(() => load(null));
  }, [load]);

  const signIn = async (password) => {
    await api.login(password);
    setAuth({ authRequired: true, signedIn: true });
    await load(null);
  };

  const signOut = async () => {
    await api.logout().catch(() => {});
    setAuth({ authRequired: true, signedIn: false });
    setDashboard(null);
  };
  useEffect(() => () => closeStream.current?.(), []);

  /**
   * Colour is keyed to the program's position in config, so it is stable no
   * matter how the table is sorted or which series the legend hides.
   */
  const colorFor = useMemo(() => {
    const index = new Map((dashboard?.programs || []).map((p, i) => [p.key, i]));
    return (key) => seriesColor(index.get(key) ?? 0);
  }, [dashboard]);

  const runSync = () => {
    if (sync.running) return;
    const programs = Object.fromEntries(
      (dashboard?.programs || []).map((p) => [
        p.key,
        { programKey: p.key, displayName: p.displayName, state: 'pending' },
      ]),
    );
    setSync({ running: true, programs });

    closeStream.current = api.streamSync({
      date,
      onEvent: (name, payload) => {
        if (name === 'program:start' || name === 'program:done') {
          setSync((previous) => ({
            ...previous,
            programs: {
              ...previous.programs,
              [payload.programKey]: {
                ...previous.programs[payload.programKey],
                ...payload,
                state: name === 'program:done' ? 'done' : 'running',
              },
            },
          }));
        }
      },
      onDone: () => {
        setSync((previous) => ({ ...previous, running: false }));
        load(date);
        // Leave the result panel up briefly so failures are readable.
        setTimeout(() => setSync({ running: false, programs: {} }), 9000);
      },
      onError: (streamError) => {
        setError(streamError.message);
        setSync((previous) => ({ ...previous, running: false }));
      },
    });
  };

  const saveManual = async (payload) => {
    await api.submitManual(payload);
    setManualFor(null);
    await load(date);
  };

  if (auth?.authRequired && !auth.signedIn) {
    return <SignIn onSubmit={signIn} />;
  }

  if (error && !dashboard) {
    return (
      <div className="app">
        <div className="empty">
          <p><strong>Could not reach the API.</strong></p>
          <p>{error}</p>
          <p>Is the server running? <code>npm run dev</code></p>
        </div>
      </div>
    );
  }

  if (!dashboard) return <div className="app"><div className="empty">Loading…</div></div>;

  const { totals, programs, isToday } = dashboard;
  // A deployed dashboard has no browser, so it cannot scrape — the button would
  // only ever return an error, so it is replaced with what to do instead.
  const canSync = dashboard.canSync !== false;

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Affiliate earnings</h1>
          <p className="sub">
            {isToday ? 'Today' : humanDate(dashboard.date)} · {dashboard.timezone}
            {dashboard.lastSyncedAt ? ` · last synced ${relativeTime(dashboard.lastSyncedAt)}` : ' · never synced'}
          </p>
        </div>

        <div className="controls">
          <input
            type="date"
            value={dashboard.date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => { setDate(event.target.value); load(event.target.value); }}
            aria-label="Show a past day"
          />
          {!isToday && (
            <button type="button" className="btn" onClick={() => load(null)}>Today</button>
          )}
          <button
            type="button"
            className="btn btn-icon"
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}. Click to change.`}
            onClick={() => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')}
          >
            {theme === 'system' ? '◐' : theme === 'light' ? '☀' : '☾'}
          </button>
          {canSync ? (
            <button type="button" className="btn btn-primary" onClick={runSync} disabled={sync.running}>
              {sync.running ? 'Syncing…' : 'Sync all'}
            </button>
          ) : (
            <span className="remote-note" title="Scraping needs a browser, which this deployment does not have">
              synced from your machine
            </span>
          )}
          {auth?.authRequired && (
            <button type="button" className="btn" onClick={signOut}>Sign out</button>
          )}
        </div>
      </header>

      <Totals totals={totals} programCount={programs.length} isToday={isToday} />

      {Object.keys(sync.programs).length > 0 && (
        <SyncPanel progress={sync} colorFor={colorFor} />
      )}

      <section className="section">
        <div className="section-head">
          <h2>By program</h2>
          <span className="hint">{humanDate(dashboard.date)}</span>
        </div>
        <div className="cards">
          {programs.map((program) => (
            <ProgramCard
              key={program.key}
              program={program}
              color={colorFor(program.key)}
              onManual={setManualFor}
            />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>All programs</h2>
          <span className="hint">Click a column to sort</span>
        </div>
        <ProgramTable programs={programs} colorFor={colorFor} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Daily earnings, last 30 days</h2>
          <span className="hint">A gap means no snapshot that day, not zero earnings</span>
        </div>
        <div className="chart-card">
          <EarningsChart chart={chart} colorFor={colorFor} currency={totals.currency || 'USD'} />
        </div>
      </section>

      {manualFor && (
        <ManualEntry
          program={manualFor}
          date={dashboard.date}
          onClose={() => setManualFor(null)}
          onSaved={saveManual}
        />
      )}
    </div>
  );
}
