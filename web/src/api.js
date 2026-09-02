const json = async (response) => {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }
  return response.json();
};

export const getDashboard = (date) =>
  fetch(`/api/dashboard${date ? `?date=${date}` : ''}`).then(json);

export const getChart = (days = 30, date) =>
  fetch(`/api/chart?days=${days}${date ? `&date=${date}` : ''}`).then(json);

export const getDates = () => fetch('/api/dates').then(json);

export const submitManual = (payload) =>
  fetch('/api/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json);

/**
 * Start a sync and stream per-program progress. Returns a close() function.
 * Uses SSE so each program lands on screen the moment it finishes rather than
 * everything appearing at the end.
 */
export function streamSync({ date, programs, onEvent, onDone, onError }) {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (programs?.length) params.set('programs', programs.join(','));

  const source = new EventSource(`/api/sync/stream?${params.toString()}`);
  for (const name of ['run:start', 'program:start', 'program:done']) {
    source.addEventListener(name, (event) => {
      onEvent?.(name, JSON.parse(event.data));
    });
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
