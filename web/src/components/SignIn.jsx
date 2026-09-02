import { useState } from 'react';

/**
 * Sign-in, shown only where a password is configured — that is, on a deployed
 * dashboard. Locally the server binds to 127.0.0.1 and this never appears.
 */
export default function SignIn({ onSubmit }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (submitError) {
      setError(submitError.message);
      setBusy(false);
    }
  };

  return (
    <div className="signin-wrap">
      <form className="signin" onSubmit={submit}>
        <h1>Affiliate earnings</h1>
        <p className="signin-sub">This dashboard is private. Enter the password to continue.</p>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error && <div className="error-box"><div className="msg">{error}</div></div>}

        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
