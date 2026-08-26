import { useEffect, useRef, useState } from 'react';
import {
  directIconFamily,
  type DirectorContext,
  type DirectorMessage,
  type DirectorResult,
} from '../core/director';

interface Props {
  master: { name: string; dataUrl: string } | null;
  model: string;
  messages: DirectorMessage[];
  memory: string;
  context: DirectorContext;
  onMessages: (messages: DirectorMessage[]) => void;
  onMemory: (memory: string) => void;
  onApply: (result: DirectorResult) => void;
}

const QUICK_REQUESTS = [
  'Keep the thick glass frame',
  'Match the reference more closely',
  'Make selected icons simpler',
  'Redo failed cards',
];

const newMessage = (role: DirectorMessage['role'], text: string): DirectorMessage => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  role,
  text,
  createdAt: Date.now(),
});

export default function IconDirector(props: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [props.messages, busy]);

  const send = async (request = draft) => {
    const instruction = request.trim().slice(0, 1200);
    if (!instruction || !props.master || busy) return;
    const nextMessages = [...props.messages, newMessage('user', instruction)].slice(-40);
    props.onMessages(nextMessages);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      const result = await directIconFamily(
        props.model,
        props.master.dataUrl,
        props.context,
        nextMessages,
        props.memory,
      );
      props.onMessages([...nextMessages, newMessage('assistant', result.reply)].slice(-40));
      props.onMemory(result.memory);
      props.onApply(result);
    } catch (nextError) {
      setError((nextError as Error).message || 'Icon Director could not respond.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="icon-director" aria-label="Icon Director">
      <div className="director-head">
        <div>
          <strong>Icon Director</strong>
          <small>One conversation for this set · your reference stays in context</small>
        </div>
        <span className="director-cost-note">Image generation waits for your approval</span>
      </div>

      <div className="director-log" ref={log} aria-live="polite">
        {props.messages.length === 0 && (
          <div className="director-message director-assistant">
            Upload a reference, then tell me what the family should look like in normal language. I’ll stage the direction and select the cards that need work; you decide when to spend on generation.
          </div>
        )}
        {props.messages.map((message) => (
          <div
            className={`director-message director-${message.role}`}
            key={message.id}
          >
            <span>{message.role === 'user' ? 'You' : 'Director'}</span>
            {message.text}
          </div>
        ))}
        {busy && <div className="director-message director-assistant director-thinking">Reviewing the reference and set…</div>}
      </div>

      <div className="director-quick" aria-label="Quick requests">
        {QUICK_REQUESTS.map((request) => (
          <button type="button" className="chip" key={request} disabled={!props.master || busy} onClick={() => void send(request)}>
            {request}
          </button>
        ))}
      </div>

      <div className="director-compose">
        <textarea
          rows={3}
          maxLength={1200}
          value={draft}
          disabled={busy}
          placeholder={props.master
            ? 'Try: “The new icons lost the thick glass border. Keep that shell exactly like my reference and redo Menu, Search, and Apps.”'
            : 'Upload a reference first so the director can see the family style.'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" disabled={!props.master || !draft.trim() || busy} onClick={() => void send()}>
          {busy ? 'Directing…' : 'Apply direction'}
        </button>
      </div>
      {error && <p className="status status-error">{error}</p>}
      {!props.master && <p className="hint director-hint">The chat activates after you upload the set’s visual reference in Step 1.</p>}
    </section>
  );
}
