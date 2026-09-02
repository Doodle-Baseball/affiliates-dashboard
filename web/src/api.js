export class AuthRequiredError extends Error {
  constructor() {
    super('not signed in');
    this.name = 'AuthRequiredError';
  }
}

const json = async (response) => {
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }
  return response.json();
};

// Same-origin, but the session cookie still has to be sent explicitly when the
// dev server proxies from another port.
const get = (path) => fetch(path, { credentials: 'same-origin' }).then(json);
const post = (path, body) =>
  fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then(json);

export const getAuth = () => get('/api/auth');
export const login = (password) => post('/api/login', { password });
export const logout = () => post('/api/logout');

export const getDashboard = (date) => get(`/api/dashboard${date ? `?date=${date}` : ''}`);
export const getChart = (days = 30, date) => get(`/api/chart?days=${days}${date ? `&date=${date}` : ''}`);
export const getDates = () => get('/api/dates');
export const submitManual = (payload) => post('/api/manual', payload);

/**
 * Start a sync and stream per-program progress. Returns a close() function.
 * Only available where a browser can actually run — a deployed dashboard
 * answers 501 and the UI hides the button.
 */
export function streamSync({ date, programs, onEvent, onDone, onError }) {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (programs?.length) params.set('programs', programs.join(','));

  const source = new EventSource(`/api/sync/stream?${params.toString()}`);
  for (const name of ['run:start', 'program:start', 'program:done']) {
    source.addEventListener(name, (event) => onEvent?.(name, JSON.parse(event.data)));
  }
  source.addEventListener('run:done', (event) => {
    onDone?.(JSON.parse(event.data));
    source.close();
  });
  source.addEventListener('run:error', (event) => {
    onError?.(new Error(JSON.parse(event.data).error));
    source.close();
  });
  source.onerror = () => {
    // A closed stream after run:done is normal; only surface a genuine drop.
    if (source.readyState === EventSource.CLOSED) return;
    onError?.(new Error('lost connection to the sync stream'));
    source.close();
  };
  return () => source.close();
}
