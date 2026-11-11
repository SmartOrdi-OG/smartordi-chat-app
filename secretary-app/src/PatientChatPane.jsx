import { useEffect, useRef, useState } from 'react';
import { getMessagesForPatient, sendMessageToPatient } from './lib/patientsData';
import { colorForName } from './lib/avatarColor';
import { showToast } from './lib/toast';
import { markChatViewed } from './lib/unreadTracking';
import PflegefreistellungModal from './PflegefreistellungModal';
import ArbeitsunfaehigkeitModal from './ArbeitsunfaehigkeitModal';
import ImpfungModal from './ImpfungModal';
import PatientDocumentsModal from './PatientDocumentsModal';

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
export default function PatientChatPane({ patient, profile, onBack, onEdit }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attestMenuOpen, setAttestMenuOpen] = useState(false);
  const [pflegefreistellungOpen, setPflegefreistellungOpen] = useState(false);
  const [arbeitsunfaehigkeitOpen, setArbeitsunfaehigkeitOpen] = useState(false);
  const [impfungOpen, setImpfungOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
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
    // The secretary has now seen this patient's messages -- clears their
    // unread badge on Übersicht, same as openChat()'s own markChatViewed().
    markChatViewed(patient.id);
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
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <button className="patient-actions-toggle" type="button" onClick={() => setAttestMenuOpen((v) => !v)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg> Aktionen
          </button>
          <div className={`patient-actions-menu${attestMenuOpen ? ' show' : ''}`} style={{ right: 0, left: 'auto' }}>
            <button className="rail-btn" type="button" onClick={() => { setAttestMenuOpen(false); setPflegefreistellungOpen(true); }}>Pflegefreistellung ausstellen</button>
            <button className="rail-btn" type="button" onClick={() => { setAttestMenuOpen(false); setArbeitsunfaehigkeitOpen(true); }}>Arbeitsunfähigkeit ausstellen</button>
            <button className="rail-btn" type="button" onClick={() => { setAttestMenuOpen(false); setImpfungOpen(true); }}>Impfung eintragen</button>
            <div className="rail-divider" />
            <button className="rail-btn" type="button" onClick={() => { setAttestMenuOpen(false); setDocumentsOpen(true); }}>Dokumente anzeigen</button>
          </div>
        </div>
        <button type="button" onClick={onEdit} style={{ background: '#f1f5f9', border: 'none', color: '#475569', padding: '7px 12px', borderRadius: 9, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px' }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg> Bearbeiten
        </button>
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
      {pflegefreistellungOpen && <PflegefreistellungModal patient={patient} profile={profile} onClose={() => setPflegefreistellungOpen(false)} />}
      {arbeitsunfaehigkeitOpen && <ArbeitsunfaehigkeitModal patient={patient} profile={profile} onClose={() => setArbeitsunfaehigkeitOpen(false)} />}
      {impfungOpen && <ImpfungModal patient={patient} profile={profile} onClose={() => setImpfungOpen(false)} />}
      {documentsOpen && <PatientDocumentsModal patient={patient} profile={profile} onClose={() => setDocumentsOpen(false)} />}
    </div>
  );
}
