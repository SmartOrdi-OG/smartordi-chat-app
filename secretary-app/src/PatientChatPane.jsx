import { useEffect, useRef, useState } from 'react';
import { getMessagesForPatient, sendMessageToPatient } from './lib/patientsData';
import { colorForName } from './lib/avatarColor';
import { showToast } from './lib/toast';

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-1px', display: 'inline-block' }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Mirrors secretary.html's openChat()/sendSecChatMsg() -- simplified to go
// straight from the patient list into the conversation itself (the original
// shows a "Nächste Termine/Letzte Nachrichten" overview pane first, with the
// actual thread living in a separate floating popup; both pull in Termine/
// Impfung data this app doesn't have yet, so this phase skips straight to
// the conversation). Only plain text messages are supported so far.
export default function PatientChatPane({ patient, onBack }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMessagesForPatient(patient.id).then((msgs) => {
      if (!cancelled) {
        setMessages(msgs);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [patient.id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const name = patient.fullName || patient.name || '?';
  const color = colorForName(name);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const optimistic = { id: 'pending-' + Date.now(), out: true, text, time: new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }), pending: true };
    setMessages((m) => [...m, optimistic]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = '42px';
    try {
      const saved = await sendMessageToPatient(patient.id, text);
      setMessages((m) => m.map((msg) => (msg.id === optimistic.id ? saved : msg)));
    } catch {
      showToast('Nachricht konnte nicht gesendet werden', 'error');
      setMessages((m) => m.filter((msg) => msg.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="nachrichten-chat-pane">
      <div className="view-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="nachrichten-chat-back" type="button" onClick={onBack}>‹</button>
        <div className="avatar" style={{ width: 34, height: 34, fontSize: 13, background: color }}>{name[0]}</div>
        <div>
          <div className="view-title" style={{ fontSize: 15 }}>{name}</div>
          <div className="view-sub">Chat</div>
        </div>
      </div>
      <div className="messages" ref={scrollRef}>
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: 13 }}>Noch keine Nachrichten</div>
        )}
        {messages.length > 0 && <div className="msg-date">Heute</div>}
        {messages.map((m) => (
          <div key={m.id} className={`msg-row${m.out ? ' out' : ''}`}>
            {!m.out && <div className="avatar" style={{ width: 28, height: 28, fontSize: 11, background: color, marginBottom: 2 }}>{name[0]}</div>}
            <div>
              <div className="msg-bubble">{m.text}</div>
              <span className="msg-time">
                {m.time}
                {m.out && !m.pending && <> <CheckIcon /></>}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="msg-input"
          placeholder="Nachricht schreiben..."
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
          }}
        />
        <button className="send-btn" type="button" disabled={!input.trim() || sending} onClick={handleSend}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
      </div>
    </div>
  );
}
