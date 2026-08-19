import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '@shared';
import { MAX_CHAT_LENGTH } from '@shared';

interface ChatProps {
  messages: ChatMessage[];
  selfId: string | null;
  onSend: (text: string) => void;
  disabled: boolean;
}

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' });
const dayWithYearFormat = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Chave de dia no fuso local — nao usar ISO/UTC, que vira o dia perto da meia-noite. */
function dayKey(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const formatted =
    date.getFullYear() === now.getFullYear() ? dayFormat.format(date) : dayWithYearFormat.format(date);

  const today = dayKey(now.getTime());
  const yesterday = dayKey(now.getTime() - 24 * 60 * 60 * 1000);
  const key = dayKey(ts);

  if (key === today) return `Hoje, ${formatted}`;
  if (key === yesterday) return `Ontem, ${formatted}`;
  return formatted;
}

export function Chat({ messages, selfId, onSend, disabled }: ChatProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSend(draft);
    setDraft('');
  }

  return (
    <section className="chat">
      <h2>Chat</h2>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <p className="muted">Nenhuma mensagem ainda.</p>}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          // O historico vem do banco junto com as mensagens ao vivo, entao uma
          // sala reaberta pode conter varios dias na mesma lista.
          const startsNewDay = !previous || dayKey(previous.ts) !== dayKey(message.ts);

          return (
            <div key={message.id}>
              {startsNewDay && <div className="chat-day">{dayLabel(message.ts)}</div>}
              <div className={message.from === selfId ? 'chat-line own' : 'chat-line'}>
                <span className="chat-author">
                  {message.displayName}
                  <time dateTime={new Date(message.ts).toISOString()}>
                    {timeFormat.format(new Date(message.ts))}
                  </time>
                </span>
                <span className="chat-text">{message.text}</span>
              </div>
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Escreva uma mensagem"
          maxLength={MAX_CHAT_LENGTH}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || draft.trim().length === 0}>
          Enviar
        </button>
      </form>
    </section>
  );
}
