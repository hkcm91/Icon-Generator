import { useEffect, useState } from 'react';

interface Status {
  connected: boolean;
  source?: 'env' | 'session' | 'none';
  account?: string;
  error?: string;
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
      const response = await fetch('/api/status');
      setStatus(await response.json());
    } catch {
      setStatus({ connected: false, error: 'The local proxy is not running. Start it with npm run dev.' });
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
        body: JSON.stringify({ token: value, remember }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'That token was not accepted.');
      // Held only by the server from here on; nothing keeps it in the page.
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
    await fetch('/api/token/clear', { method: 'POST' });
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
            Paste your Replicate API token. It is sent to the local proxy on this machine, checked
            against Replicate, and never stored in the browser.
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
            Save to .env so it survives a restart
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
              {status.source === 'env' ? ' (from .env)' : ''}.
            </p>
          )}
          <p className="hint">
            Get one at replicate.com → Account → API tokens.
          </p>
        </div>
      )}
    </div>
  );
}
