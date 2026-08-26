import { useEffect, useRef, useState } from 'react';
import {
  stageDirectorInstruction,
  type DirectorContext,
  type DirectorMessage,
  type DirectorResult,
} from '../core/director';

interface Props {
  master: { name: string; dataUrl: string } | null;
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
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [props.messages]);

  const send = (request = draft) => {
    const instruction = request.trim().slice(0, 1200);
    if (!instruction || !props.master) return;
    const nextMessages = [...props.messages, newMessage('user', instruction)].slice(-40);
    props.onMessages(nextMessages);
    setDraft('');
    const result = stageDirectorInstruction(instruction, props.context, props.memory);
    props.onMessages([...nextMessages, newMessage('assistant', result.reply)].slice(-40));
    props.onMemory(result.memory);
    props.onApply(result);
  };

  return (
    <section className="icon-director" aria-label="Icon Director">
      <div className="director-head">
        <div>
          <strong>Icon Director</strong>
          <small>One conversation for this set · directions go straight to the selected image model</small>
        </div>
        <span className="director-cost-note">No planning-model charge · ask here to generate selected cards</span>
      </div>

      <div className="director-log" ref={log} aria-live="polite">
        {props.messages.length === 0 && (
          <div className="director-message director-assistant">
            Upload a reference, then describe the family in normal language. I’ll keep the direction, target the right cards, and generate the selected cards when you ask. Your batch limit still applies.
          </div>
        )}
        {props.messages.map((message) => (
          <div
            className={`director-message director-${message.role}`}
            key={message.id}
          >
            <strong>{message.role === 'user' ? 'You:' : 'Director:'}</strong>{' '}
            {message.text}
          </div>
        ))}
      </div>

      <div className="director-quick" aria-label="Quick requests">
        {QUICK_REQUESTS.map((request) => (
          <button type="button" className="chip" key={request} disabled={!props.master} onClick={() => send(request)}>
            {request}
          </button>
        ))}
      </div>

      <div className="director-compose">
        <textarea
          rows={3}
          maxLength={1200}
          value={draft}
          placeholder={props.master
            ? 'Try: “The new icons lost the thick glass border. Keep that shell exactly like my reference and redo Menu, Search, and Apps.”'
            : 'Upload a reference first so the director can see the family style.'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button type="button" disabled={!props.master || !draft.trim()} onClick={() => send()}>
          Send
        </button>
      </div>
      {!props.master && <p className="hint director-hint">The chat activates after you upload the set’s visual reference in Step 1.</p>}
    </section>
  );
}
