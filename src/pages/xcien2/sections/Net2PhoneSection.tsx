import { useState, useEffect, useCallback } from 'react';
import { Phone, PhoneCall, PhoneOff, PhoneMissed, Clock, Users,
         TrendingUp, RefreshCw, CheckCircle, AlertCircle, Settings } from 'lucide-react';

interface Status {
  configured: boolean; connected: boolean; base_url: string;
  account_id: string; account: { name?: string; domain?: string };
  missing_vars: string[];
}
interface Agent {
  id: string; name: string; extension: string; email: string;
  status: string; department: string; on_call: boolean;
}
interface ActiveCall {
  id: string; caller: string; caller_num: string;
  callee: string; callee_num: string; duration_s: number;
  direction: string; status: string; started: string;
}
interface CDRRecord {
  id: string; fecha: string; caller: string; caller_num: string;
  callee: string; callee_num: string; duracion: string; duracion_s: number;
  direction: string; resultado: string; agente: string; extension: string;
}
interface Summary {
  fecha: string; total_hoy: number; contestadas: number; perdidas: number;
  entrantes: number; salientes: number; duracion_prom_s: number;
  tasa_atencion: number; en_llamada_ahora: number;
}

const STATUS_COLOR: Record<string, string> = {
  available: '#10b981', online: '#10b981',
  busy: '#ef4444', 'on-call': '#ef4444', dnd: '#ef4444',
  away: '#f59e0b', idle: '#f59e0b',
  offline: '#6b7280', unknown: '#6b7280',
};
const STATUS_LABEL: Record<string, string> = {
  available: 'Disponible', online: 'En línea',
  busy: 'Ocupado', 'on-call': 'En llamada', dnd: 'No molestar',
  away: 'Ausente', idle: 'Inactivo',
  offline: 'Desconectado', unknown: '—',
};
const DIR_LABEL: Record<string, string> = {
  inbound: '← Entrante', outbound: '→ Saliente',
  INBOUND: '← Entrante', OUTBOUND: '→ Saliente',
};

function fmtSeg(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export default function Net2PhoneSection() {
  const [status,  setStatus]  = useState<Status | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [agents,  setAgents]  = useState<Agent[]>([]);
  const [active,  setActive]  = useState<ActiveCall[]>([]);
  const [cdr,     setCdr]     = useState<CDRRecord[]>([]);
  const [cdrKpis, setCdrKpis] = useState<any>(null);
  const [tab,     setTab]     = useState<'live'|'cdr'|'agents'>('live');
  const [days,    setDays]    = useState(7);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    const r = await fetch('/api/net2phone/status');
    if (r.ok) setStatus(await r.json());
  }, []);

  const fetchLive = useCallback(async () => {
    setLoading(true);
    const [sa, sc, aa] = await Promise.all([
      fetch('/api/net2phone/summary').then(r => r.ok ? r.json() : null),
      fetch('/api/net2phone/active-calls').then(r => r.ok ? r.json() : null),
      fetch('/api/net2phone/agents').then(r => r.ok ? r.json() : null),
    ]);
    if (sa) setSummary(sa);
    if (sc) setActive(sc.calls || []);
    if (aa) setAgents(aa.agents || []);
    setLoading(false);
  }, []);

  const fetchCdr = useCallback(async (d: number) => {
    setLoading(true);
    const r = await fetch(`/api/net2phone/cdr?days=${d}&limit=100`);
    if (r.ok) {
      const data = await r.json();
      setCdr(data.records || []);
      setCdrKpis(data.kpis || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (!status?.connected) return;
    if (tab === 'live' || tab === 'agents') fetchLive();
    if (tab === 'cdr') fetchCdr(days);
  }, [status?.connected, tab, days, fetchLive, fetchCdr]);

  // Auto-refresh llamadas activas cada 15s
  useEffect(() => {
    if (!status?.connected || tab !== 'live') return;
    const t = setInterval(fetchLive, 15000);
    return () => clearInterval(t);
  }, [status?.connected, tab, fetchLive]);

  // ── Sin configurar ─────────────────────────────────────────────────────────
  if (status && !status.configured) {
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', maxWidth: 620 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:24 }}>
          <Phone size={22} color="#00A859"/>
          <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:'#f9fafb' }}>
            Net2Phone — Call Center
          </h2>
        </div>
        <div style={{ background:'#111827', border:'1px solid #374151', borderRadius:12, padding:28 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
            <Settings size={16} color="#f59e0b"/>
            <span style={{ color:'#f59e0b', fontWeight:700, fontSize:13 }}>
              Credenciales pendientes
            </span>
          </div>
          <p style={{ color:'#9ca3af', fontSize:12, lineHeight:1.7, margin:'0 0 20px' }}>
            El módulo está listo. Solo falta agregar las credenciales de la API de Net2Phone
            en el archivo <code style={{ color:'#00A859' }}>.env</code> del servidor:
          </p>
          <div style={{ background:'#0d1117', borderRadius:8, padding:16,
            border:'1px solid #1f2937', fontFamily:'monospace', fontSize:12 }}>
            {['NET2PHONE_CLIENT_ID','NET2PHONE_CLIENT_SECRET',
              'NET2PHONE_ACCOUNT_ID','NET2PHONE_BASE_URL'].map(v => (
              <div key={v} style={{ marginBottom:6 }}>
                <span style={{ color: status.missing_vars.includes(v) ? '#ef4444' : '#10b981' }}>
                  {status.missing_vars.includes(v) ? '✗' : '✓'}
                </span>
                {' '}
                <span style={{ color: status.missing_vars.includes(v) ? '#fca5a5' : '#6b7280' }}>
                  {v}
                </span>
                {status.missing_vars.includes(v) &&
                  <span style={{ color:'#4b5563' }}>=<em>pendiente</em></span>}
              </div>
            ))}
          </div>
          <p style={{ color:'#6b7280', fontSize:11, marginTop:16, lineHeight:1.6 }}>
            Obtener credenciales en{' '}
            <span style={{ color:'#3b82f6' }}>developer.net2phone.com</span>
            {' '}→ My Apps → Create App.
            Tras agregar las variables, reiniciar el backend con{' '}
            <code style={{ color:'#00A859' }}>pm2 restart xcien-backend</code>.
          </p>
        </div>
      </div>
    );
  }

  const kpis = summary ? [
    { label:'Total hoy',       value: summary.total_hoy,         icon:<Phone size={15}/>,       color:'#00A859' },
    { label:'Contestadas',     value: summary.contestadas,        icon:<PhoneCall size={15}/>,   color:'#10b981' },
    { label:'Perdidas',        value: summary.perdidas,           icon:<PhoneMissed size={15}/>, color:'#ef4444' },
    { label:'En llamada ahora',value: summary.en_llamada_ahora,   icon:<PhoneCall size={15}/>,   color:'#f59e0b' },
    { label:'Tasa de atención',value: `${summary.tasa_atencion}%`,icon:<TrendingUp size={15}/>,  color:'#3b82f6' },
    { label:'Duración prom.',  value: fmtSeg(summary.duracion_prom_s), icon:<Clock size={15}/>, color:'#a855f7' },
  ] : [];

  const tabs = [
    { id:'live',   label:'En vivo' },
    { id:'cdr',    label:'Historial CDR' },
    { id:'agents', label:'Agentes' },
  ] as const;

  return (
    <div style={{ padding:24, fontFamily:'monospace', color:'#e5e7eb', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:'#f9fafb', display:'flex', alignItems:'center', gap:8 }}>
            <Phone size={18} color="#00A859"/>
            Net2Phone — Call Center
          </h2>
          <div style={{ color:'#6b7280', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:6 }}>
            {status?.connected
              ? <><CheckCircle size={11} color="#10b981"/> Conectado · {status.account?.name || status.account_id}</>
              : <><AlertCircle size={11} color="#ef4444"/> Sin conexión</>}
          </div>
        </div>
        <button onClick={() => { fetchStatus(); if (tab==='live'||tab==='agents') fetchLive(); else fetchCdr(days); }}
          style={{ background:'#111827', border:'1px solid #374151', borderRadius:6,
            color:'#9ca3af', padding:'6px 12px', cursor:'pointer',
            display:'flex', alignItems:'center', gap:5, fontSize:11 }}>
          <RefreshCw size={12}/> Actualizar
        </button>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10, marginBottom:22 }}>
          {kpis.map(k => (
            <div key={k.label} style={{ background:'#111827',
              border:`1px solid ${k.color}33`, borderRadius:8, padding:'12px 14px' }}>
              <div style={{ color:k.color, marginBottom:5 }}>{k.icon}</div>
              <div style={{ fontSize:22, fontWeight:700, color:'#f9fafb' }}>{k.value}</div>
              <div style={{ fontSize:10, color:'#6b7280', marginTop:2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:18 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab===t.id ? '#00A859' : '#111827',
            border:`1px solid ${tab===t.id ? '#00A859' : '#374151'}`,
            borderRadius:6, color: tab===t.id ? '#001a0e' : '#9ca3af',
            padding:'6px 16px', cursor:'pointer', fontSize:12, fontWeight: tab===t.id ? 700 : 400,
          }}>{t.label}</button>
        ))}
      </div>

      {loading && <div style={{ color:'#4b5563', fontSize:12, marginBottom:12 }}>Cargando extensiones…</div>}

      {/* ── EN VIVO ─────────────────────────────────────────────────────── */}
      {tab === 'live' && (
        <div style={{ background:'#111827', border:'1px solid #1f2937', borderRadius:10, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #1f2937',
            display:'flex', alignItems:'center', gap:8 }}>
            <PhoneCall size={13} color="#00A859"/>
            <span style={{ fontSize:13, fontWeight:600, color:'#f9fafb' }}>
              Llamadas activas — {active.length}
            </span>
            <span style={{ marginLeft:'auto', fontSize:10, color:'#4b5563' }}>
              Auto-refresh 15s
            </span>
          </div>
          {active.length === 0 ? (
            <div style={{ padding:40, textAlign:'center', color:'#4b5563' }}>
              <PhoneOff size={28} style={{ marginBottom:8, opacity:0.4 }}/>
              <div>Sin llamadas activas en este momento</div>
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ background:'#0d1117', color:'#6b7280' }}>
                  {['Dirección','Quien llama','Extensión / Agente','Duración','Estado'].map(h => (
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left',
                      fontWeight:600, borderBottom:'1px solid #1f2937' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom:'1px solid #0d1117',
                    background: i%2===0 ? '#111827' : '#0f1720' }}>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ color: c.direction.toLowerCase()==='inbound' ? '#10b981':'#3b82f6', fontWeight:600 }}>
                        {DIR_LABEL[c.direction] || c.direction}
                      </span>
                    </td>
                    <td style={{ padding:'8px 12px', color:'#e5e7eb' }}>
                      {c.caller || c.caller_num}
                    </td>
                    <td style={{ padding:'8px 12px', color:'#9ca3af' }}>
                      {c.callee || c.callee_num}
                    </td>
                    <td style={{ padding:'8px 12px', color:'#f59e0b', fontWeight:600 }}>
                      {fmtSeg(c.duration_s)}
                    </td>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ background:'#10b98122', color:'#10b981',
                        borderRadius:4, padding:'2px 8px', fontSize:10 }}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── CDR ─────────────────────────────────────────────────────────── */}
      {tab === 'cdr' && (
        <div>
          <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center' }}>
            <span style={{ fontSize:11, color:'#6b7280' }}>Período:</span>
            {[1,7,14,30].map(d => (
              <button key={d} onClick={() => { setDays(d); fetchCdr(d); }} style={{
                background: days===d ? '#00A859' : '#111827',
                border:`1px solid ${days===d ? '#00A859' : '#374151'}`,
                borderRadius:5, color: days===d ? '#001a0e':'#9ca3af',
                padding:'4px 12px', cursor:'pointer', fontSize:11,
                fontWeight: days===d ? 700:400,
              }}>{d}d</button>
            ))}
            {cdrKpis && (
              <span style={{ marginLeft:12, fontSize:11, color:'#6b7280' }}>
                {cdrKpis.contestadas} contestadas ·{' '}
                {cdrKpis.perdidas} perdidas ·{' '}
                {cdrKpis.tasa_atencion}% atención ·{' '}
                prom. {fmtSeg(cdrKpis.duracion_prom)}
              </span>
            )}
          </div>

          <div style={{ background:'#111827', border:'1px solid #1f2937', borderRadius:10, overflow:'hidden' }}>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead>
                  <tr style={{ background:'#0d1117', color:'#6b7280' }}>
                    {['Fecha','Dirección','Origen','Destino/Agente','Duración','Resultado'].map(h => (
                      <th key={h} style={{ padding:'8px 10px', textAlign:'left',
                        fontWeight:600, borderBottom:'1px solid #1f2937', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cdr.map((r, i) => {
                    const ok = ['answered','ANSWERED','completed'].includes(r.resultado);
                    const miss = ['no-answer','NO ANSWER','missed','busy','BUSY'].includes(r.resultado);
                    return (
                      <tr key={r.id} style={{ borderBottom:'1px solid #0d1117',
                        background: i%2===0 ? '#111827' : '#0f1720' }}>
                        <td style={{ padding:'6px 10px', color:'#6b7280', whiteSpace:'nowrap' }}>
                          {r.fecha}
                        </td>
                        <td style={{ padding:'6px 10px' }}>
                          <span style={{ color: r.direction.toLowerCase()==='inbound' ? '#10b981':'#3b82f6', fontSize:10 }}>
                            {DIR_LABEL[r.direction] || r.direction}
                          </span>
                        </td>
                        <td style={{ padding:'6px 10px', color:'#9ca3af' }}>
                          {r.caller || r.caller_num}
                        </td>
                        <td style={{ padding:'6px 10px', color:'#e5e7eb' }}>
                          {r.agente || r.callee || r.callee_num}
                        </td>
                        <td style={{ padding:'6px 10px', color:'#d1d5db' }}>{r.duracion}</td>
                        <td style={{ padding:'6px 10px' }}>
                          <span style={{
                            color: ok ? '#10b981' : miss ? '#ef4444' : '#6b7280',
                            fontWeight: miss ? 700 : 400, fontSize:10,
                          }}>
                            {miss ? '✗ ' : ok ? '✓ ' : ''}{r.resultado || '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {cdr.length === 0 && !loading && (
                    <tr><td colSpan={6} style={{ padding:32, textAlign:'center', color:'#4b5563' }}>
                      Sin registros en este período.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── AGENTES ─────────────────────────────────────────────────────── */}
      {tab === 'agents' && (
        <div style={{ background:'#111827', border:'1px solid #1f2937', borderRadius:10, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #1f2937',
            display:'flex', alignItems:'center', gap:8 }}>
            <Users size={13} color="#00A859"/>
            <span style={{ fontSize:13, fontWeight:600, color:'#f9fafb' }}>
              Agentes — {agents.length}
            </span>
            <span style={{ marginLeft:'auto', fontSize:10, color:'#4b5563' }}>
              {agents.filter(a => ['available','online'].includes(a.status)).length} disponibles ·{' '}
              {agents.filter(a => a.on_call).length} en llamada
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:1 }}>
            {agents.map(a => {
              const col = STATUS_COLOR[a.status] || '#6b7280';
              return (
                <div key={a.id} style={{ padding:'12px 16px',
                  borderBottom:'1px solid #0d1117', display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:col, flexShrink:0 }}/>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:12, color:'#e5e7eb', fontWeight:600,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {a.name}
                    </div>
                    <div style={{ fontSize:10, color:'#6b7280', marginTop:2 }}>
                      Ext. {a.extension || '—'} · {STATUS_LABEL[a.status] || a.status}
                      {a.on_call && <span style={{ color:'#f59e0b', marginLeft:4 }}>📞</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {agents.length === 0 && !loading && (
              <div style={{ padding:32, textAlign:'center', color:'#4b5563', gridColumn:'1/-1' }}>
                Sin agentes registrados.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
