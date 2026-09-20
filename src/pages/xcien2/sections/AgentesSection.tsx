import { useState, useEffect, useRef } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';

interface Agente {
  id: string;
  nombre: string;
  icon: string;
  color: string;
  rol: string;
  descripcion: string;
  capacidades: string[];
  status: 'online' | 'busy' | 'offline';
  calls_today: number;
  last_msg: string;
  last_ts: string;
}

interface ChatMsg { role: 'user' | 'assistant'; content: string; ts: string; }

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const color = status === 'online' ? '#00ff88' : status === 'busy' ? '#FFB703' : '#555';
  const label = status === 'online' ? 'En línea' : status === 'busy' ? 'Ocupado' : 'Offline';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0,
        boxShadow: status !== 'offline' ? `0 0 6px ${color}` : 'none',
      }} />
      <span style={{ color }}>{label}</span>
    </span>
  );
}

// ── Chat Panel ────────────────────────────────────────────────────────────────
function ChatPanel({ agente, theme, onClose }: { agente: Agente; theme: ThemeConfig; onClose: () => void }) {
  const [msgs, setMsgs]     = useState<ChatMsg[]>([]);
  const [input, setInput]   = useState('');
  const [loading, setLoad]  = useState(false);
  const bottomRef           = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const ts = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const history = msgs.map(m => ({ role: m.role, content: m.content }));
    setMsgs(prev => [...prev, { role: 'user', content: text, ts }]);
    setInput('');
    setLoad(true);
    try {
      const res = await fetch(`${API_BASE}/api/agentes/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agente_id: agente.id, message: text, history }),
      });
      const data = await res.json();
      const reply = data.response || data.detail || 'Sin respuesta';
      const ts2 = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      setMsgs(prev => [...prev, { role: 'assistant', content: reply, ts: ts2 }]);
    } catch (e: any) {
      setMsgs(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}`, ts: '' }]);
    } finally {
      setLoad(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <style>{`@keyframes agente-busy-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.25; transform: scale(0.75); } }`}</style>
      <div style={{
        width: 620, maxWidth: '95vw', height: 580, display: 'flex', flexDirection: 'column',
        background: theme.card, border: `1px solid ${agente.color}40`,
        borderRadius: 20, overflow: 'hidden',
        boxShadow: `0 0 40px ${agente.color}20`,
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 12, background: `${agente.color}08` }}>
          <span style={{ fontSize: 28 }}>{agente.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: agente.color, fontSize: 15 }}>{agente.nombre}</div>
            <div style={{ fontSize: 10, color: theme.dim }}>{agente.rol}</div>
          </div>
          {agente.status === 'busy' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#FFB703' }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: '#FFB703', flexShrink: 0,
                animation: 'agente-busy-pulse 1.1s ease-in-out infinite',
              }} />
              Procesando
            </span>
          ) : (
            <StatusDot status={agente.status} />
          )}
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: theme.dim, fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>✕</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {msgs.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{agente.icon}</div>
              <div style={{ color: theme.dim, fontSize: 13, marginBottom: 16 }}>{agente.descripcion}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {agente.capacidades.map(c => (
                  <button key={c} onClick={() => setInput(c)} style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                    background: `${agente.color}15`, border: `1px solid ${agente.color}40`, color: agente.color,
                  }}>{c}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', gap: 10, alignItems: 'flex-start' }}>
              {m.role === 'assistant' && (
                <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>{agente.icon}</span>
              )}
              <div style={{
                maxWidth: '80%', padding: '10px 14px', borderRadius: 14, fontSize: 13, lineHeight: 1.55,
                background: m.role === 'user' ? `${agente.color}20` : 'rgba(255,255,255,0.05)',
                color: theme.text,
                borderTopRightRadius: m.role === 'user' ? 4 : 14,
                borderTopLeftRadius: m.role === 'assistant' ? 4 : 14,
              }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                {m.ts && <div style={{ fontSize: 9, color: theme.dim, marginTop: 4, textAlign: 'right' }}>{m.ts}</div>}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 22 }}>{agente.icon}</span>
              <div style={{ padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.05)', fontSize: 12, color: theme.dim }}>
                Procesando<span style={{ animation: 'none' }}>...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${theme.border}`, display: 'flex', gap: 10 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder={`Consulta al ${agente.nombre}...`}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 13,
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
              color: theme.text, outline: 'none',
            }}
          />
          <button onClick={send} disabled={loading || !input.trim()} style={{
            padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: input.trim() && !loading ? agente.color : 'rgba(255,255,255,0.08)',
            color: input.trim() && !loading ? '#000' : theme.dim,
            fontWeight: 700, fontSize: 13, transition: 'all 0.15s',
          }}>
            {loading ? '...' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agent Card ────────────────────────────────────────────────────────────────
function AgenteCard({ ag, theme, onChat }: { ag: Agente; theme: ThemeConfig; onChat: () => void }) {
  return (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: 16, padding: 20, position: 'relative', overflow: 'hidden',
      transition: 'border-color 0.2s, transform 0.15s',
      cursor: 'default',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = ag.color + '50'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = theme.border; }}
    >
      {/* Left accent */}
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: ag.color }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{
            fontSize: 32, width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${ag.color}15`, borderRadius: 14, flexShrink: 0,
          }}>{ag.icon}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: theme.text }}>{ag.nombre}</div>
            <div style={{ fontSize: 10, color: ag.color, fontWeight: 600, marginTop: 2 }}>{ag.rol}</div>
            <div style={{ marginTop: 4 }}><StatusDot status={ag.status} /></div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: ag.calls_today > 0 ? ag.color : theme.dim }}>{ag.calls_today}</div>
          <div style={{ fontSize: 9, color: theme.dim }}>consultas hoy</div>
        </div>
      </div>

      {/* Description */}
      <p style={{ fontSize: 11, color: theme.dim, lineHeight: 1.5, margin: '0 0 14px' }}>{ag.descripcion}</p>

      {/* Capacidades */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {ag.capacidades.map(c => (
          <span key={c} style={{
            fontSize: 9, padding: '3px 8px', borderRadius: 10,
            background: `${ag.color}12`, color: ag.color, border: `1px solid ${ag.color}30`,
          }}>{c}</span>
        ))}
      </div>

      {/* Last activity */}
      {ag.last_msg && (
        <div style={{ fontSize: 10, color: theme.dim, marginBottom: 14, padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: `2px solid ${ag.color}40` }}>
          <span style={{ color: theme.dim }}>Última: </span>
          <span style={{ color: theme.text }}>{ag.last_msg}</span>
          {ag.last_ts && <span style={{ color: theme.dim }}> · {ag.last_ts}</span>}
        </div>
      )}

      {/* Chat button */}
      <button onClick={onChat} disabled={ag.status === 'offline'} style={{
        width: '100%', padding: '9px 0', borderRadius: 10, border: 'none', cursor: ag.status !== 'offline' ? 'pointer' : 'not-allowed',
        background: ag.status !== 'offline' ? `${ag.color}20` : 'rgba(255,255,255,0.04)',
        color: ag.status !== 'offline' ? ag.color : theme.dim,
        fontWeight: 700, fontSize: 12, transition: 'all 0.15s',
        boxShadow: ag.status !== 'offline' ? `0 0 0 1px ${ag.color}30` : 'none',
      }}
        onMouseEnter={e => { if (ag.status !== 'offline') (e.currentTarget as HTMLElement).style.background = `${ag.color}35`; }}
        onMouseLeave={e => { if (ag.status !== 'offline') (e.currentTarget as HTMLElement).style.background = `${ag.color}20`; }}
      >
        {ag.status === 'offline' ? '⚫ Sin conexión' : ag.status === 'busy' ? '⏳ Consultando...' : `💬 Consultar a ${ag.nombre.split(' ')[0]}`}
      </button>
    </div>
  );
}

// ── Main Section ──────────────────────────────────────────────────────────────
export default function AgentesSection({ theme }: { theme: ThemeConfig }) {
  const [agentes, setAgentes]   = useState<Agente[]>([]);
  const [loading, setLoading]   = useState(true);
  const [chatAgent, setChatAg]  = useState<Agente | null>(null);

  const fetchStatus = async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/agentes/status`);
      const data = await res.json();
      setAgentes(data.agentes ?? []);
    } catch { /* keep stale */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 10_000);
    return () => clearInterval(id);
  }, []);

  const online  = agentes.filter(a => a.status === 'online').length;
  const busy    = agentes.filter(a => a.status === 'busy').length;
  const offline = agentes.filter(a => a.status === 'offline').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${theme.border}`, paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: theme.text, margin: 0 }}>
            🤖 ECOSISTEMA DE AGENTES IA
          </h2>
          <p style={{ fontSize: 12, color: theme.dim, marginTop: 4 }}>
            Presencia y estado en tiempo real — actualización cada 10 segundos
          </p>
        </div>
        <button onClick={fetchStatus} style={{ padding: '6px 14px', borderRadius: 8, background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim, fontSize: 11, cursor: 'pointer' }}>
          🔄 Actualizar
        </button>
      </div>

      {/* KPI bar */}
      {!loading && (
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'En línea',  val: online,  col: '#00ff88' },
            { label: 'Ocupados',  val: busy,    col: '#FFB703' },
            { label: 'Offline',   val: offline, col: '#555'    },
            { label: 'Total',     val: agentes.length, col: theme.accent },
          ].map(k => (
            <div key={k.label} style={{ flex: 1, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: k.col }}>{k.val}</div>
              <div style={{ fontSize: 10, color: theme.dim, marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: theme.dim }}>
          Conectando con el ecosistema de agentes...
        </div>
      )}

      {/* Subheader */}
      {!loading && agentes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.dim, marginTop: -8 }}>
          <span style={{ color: theme.text, fontWeight: 700 }}>8 → 11 agentes</span>
          <span>·</span>
          <span style={{ color: '#00ff88' }}>{online} en línea</span>
        </div>
      )}

      {/* Agent grid */}
      {!loading && agentes.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
          {agentes.map(ag => (
            <AgenteCard
              key={ag.id}
              ag={ag}
              theme={theme}
              onChat={() => setChatAg(ag)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && agentes.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '48px 24px', color: theme.dim,
          background: theme.card, border: `1px dashed ${theme.border}`, borderRadius: 16,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 6 }}>
            Sin agentes disponibles
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
            El backend no devolvió ningún agente. Verifica que el servicio esté activo
            y que <code style={{ color: theme.text }}>/api/agentes/status</code> responda.
          </div>
          <button onClick={fetchStatus} style={{
            marginTop: 18, padding: '8px 18px', borderRadius: 10, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${theme.border}`, color: theme.text, fontSize: 12,
          }}>
            🔄 Reintentar
          </button>
        </div>
      )}

      {/* Chat modal */}
      {chatAgent && (
        <ChatPanel
          agente={chatAgent}
          theme={theme}
          onClose={() => setChatAg(null)}
        />
      )}
    </div>
  );
}
