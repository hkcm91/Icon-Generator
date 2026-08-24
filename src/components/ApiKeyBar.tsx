import { useEffect, useState } from 'react';
import { readStoredToken, storeToken } from '../core/replicate';

interface Status {
  connected: boolean;
  source?: 'env' | 'client' | 'none';
  account?: string;
  error?: string;
  acceptsClientToken?: boolean;
}

/**
 * Where the API key goes.
 *
 * Previously the only way to supply one was to create a .env file before
 * starting the server, which is not discoverable from inside a running app —
 * you would have to already know it to find it. The key is posted to the local
 * proxy, validated against Replicate before being kept, and never sent back to
 * the browser: this bar only ever learns whether a token exists and whose
 * account it belongs to.
 */
export default function ApiKeyBar() {
  const [status, setStatus] = useState<Status>({ connected: false });
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const token = readStoredToken();
      const response = await fetch('/api/status', {
        headers: token ? { 'x-replicate-token': token } : {},
      });
      if (!response.ok && response.status === 404) {
        // No API routes at all: the site was deployed as static files only, or
        // the dev server is running without its API. Saying "local proxy" here
        // was wrong and unactionable on a deployment.
        setStatus({
          connected: false,
          error:
            'This build has no API routes. Deploy the whole repository (the api/ folder included), or run npm run dev locally.',
        });
        return;
      }
      setStatus(await response.json());
    } catch {
      setStatus({
        connected: false,
        error: 'Could not reach the API. Run npm run dev locally, or redeploy with the api/ folder.',
      });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'That token was not accepted.');

      // Kept in this browser and attached to each request. Serverless functions
      // are stateless, so there is no server-side place to keep it.
      storeToken(value.trim(), remember);
      setValue('');
      setOpen(false);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    storeToken(null);
    await refresh();
  };

  return (
    <div className="apikey">
      <button
        type="button"
        className={status.connected ? 'ghost key-ok' : 'ghost key-off'}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="key-dot" />
        {status.connected ? `Connected${status.account ? ` · ${status.account}` : ''}` : 'Add API key'}
      </button>

      {open && (
        <div className="key-panel">
          <p className="hint">
            Paste your Replicate API token. It is checked against Replicate before being kept, then
            attached to each request from this browser.
          </p>

          <label className="field">
            <span className="field-label">Token</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="r8_…"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && value.trim()) void save();
              }}
            />
          </label>

          <label className="toggle toggle-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Keep it in this browser (otherwise it is forgotten on refresh)
          </label>

          <div className="row">
            <button type="button" onClick={save} disabled={busy || !value.trim()}>
              {busy ? 'Checking…' : 'Connect'}
            </button>
            {status.connected && (
              <button type="button" className="ghost" onClick={disconnect} disabled={busy}>
                Disconnect
              </button>
            )}
            <button type="button" className="ghost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          {error && <p className="status status-error">{error}</p>}
          {status.error && !error && <p className="status status-error">{status.error}</p>}
          {status.connected && !error && (
            <p className="status status-ok">
              Connected as {status.account}
              {status.source === 'env' ? ' (from the server environment)' : ' (from this browser)'}.
            </p>
          )}
          <p className="hint">
            Get one at replicate.com → Account → API tokens. For a deployment other people can
            reach, set <code>REPLICATE_API_TOKEN</code> as an environment variable instead — a key
            entered here lives in this browser only, which is what you want for your own key and
            not what you want for a shared one.
          </p>
        </div>
      )}
    </div>
  );
}
