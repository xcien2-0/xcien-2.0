import { useState, useEffect, useCallback } from 'react';
import { useTabTrack } from '../../../hooks/useTabTrack';
import { Headphones, RefreshCw, AlertTriangle, Clock, CheckCircle, TrendingUp, BarChart3, FileText, ChevronDown } from 'lucide-react';

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface Equipo  { id: number; name: string; total: number }
interface Ticket  {
  id: number; name: string; equipo: string; equipo_id: number | null;
  etapa: string; etapa_id: number | null; cliente: string; agente: string;
  tipo: string; prioridad: string; prioridad_n: number; kanban: string;
  sla_vencido: boolean; sla_deadline: string; creado: string;
  horas_cierre: number | null;
}
interface Resumen {
  total: number; urgentes: number; sla_vencidos: number;
  creados_hoy: number; resueltos: number; abiertos: number;
}
interface TendBucket { periodo: string; creados: number; resueltos: number; sla_venc: number }
interface TopItem    { nombre: string; total: number }
interface Analytics {
  periodo_dias: number; total_tickets: number; resueltos_total: number;
  sla_vencidos_total: number; avg_cierre_horas: number | null;
  tendencia: TendBucket[];
  por_tipo: TopItem[]; por_equipo: TopItem[];
  por_agente: TopItem[]; por_prioridad: TopItem[];
}

// ── Constantes ─────────────────────────────────────────────────────────────────
const G = '#00A859';
const PRIORIDAD_COLOR: Record<string, string> = {
  'Normal': '#6b7280', 'Urgente': '#f59e0b',
  'Muy urgente': '#ef4444', 'Bloqueante': '#7c3aed',
};
const PERIODO_OPTS = [
  { label: 'Hoy',         value: 'hoy',    dias: 1  },
  { label: 'Esta semana', value: 'semana', dias: 7  },
  { label: 'Este mes',    value: 'mes',    dias: 30 },
  { label: '90 días',     value: '90d',    dias: 90 },
];
const AGRUP_OPTS = [
  { label: 'Por día',    value: 'dia'    },
  { label: 'Por semana', value: 'semana' },
  { label: 'Por mes',    value: 'mes'    },
];
const TABS = ['tickets', 'tendencias', 'patrones'] as const;
type Tab = typeof TABS[number];

// ── Mini bar chart ─────────────────────────────────────────────────────────────
function MiniBar({ data, colorKey, label }: {
  data: TendBucket[]; colorKey: 'creados' | 'resueltos' | 'sla_venc'; label: string;
}) {
  const COLOR = colorKey === 'creados' ? '#3b82f6' : colorKey === 'resueltos' ? G : '#ef4444';
  const max   = Math.max(...data.map(d => d[colorKey]), 1);
  const show  = data.slice(-30);
  return (
    <div>
      <p style={{ fontSize: 10, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 48 }}>
        {show.map((d, i) => (
          <div key={i} title={`${d.periodo}: ${d[colorKey]}`}
            style={{
              flex: 1, background: COLOR, opacity: 0.85,
              height: `${Math.max(4, (d[colorKey] / max) * 100)}%`,
              borderRadius: '2px 2px 0 0', minWidth: 2,
            }} />
        ))}
      </div>
    </div>
  );
}

function HBar({ nombre, total, max, color }: { nombre: string; total: number; max: number; color: string }) {
  const pct = max > 0 ? (total / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <div style={{ width: 160, fontSize: 11, color: '#d1d5db', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={nombre}>{nombre}</div>
      <div style={{ flex: 1, background: '#1f2937', borderRadius: 3, height: 8 }}>
        <div style={{ background: color, width: `${pct}%`, height: '100%', borderRadius: 3, transition: 'width .4s' }} />
      </div>
      <div style={{ width: 36, textAlign: 'right', fontSize: 11, color, fontWeight: 700 }}>{total}</div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function HelpdeskSection() {
  const [equipos,       setEquipos]       = useState<Equipo[]>([]);
  const [resumen,       setResumen]       = useState<Resumen | null>(null);
  const [tickets,       setTickets]       = useState<Ticket[]>([]);
  const [reportMsg,     setReportMsg]     = useState('');
  const [total,         setTotal]         = useState(0);
  const [analytics,     setAnalytics]     = useState<Analytics | null>(null);
  const [teamId,        setTeamId]        = useState<number | null>(null);
  const [teamName,      setTeamName]      = useState('Todos los equipos');
  const [loading,       setLoading]       = useState(false);
  const [page,          setPage]          = useState(0);
  const [showDrop,      setShowDrop]      = useState(false);
  const [tab,           setTab]           = useState<Tab>('tickets');
  const trackTab = useTabTrack('helpdesk');
  const [periodo,       setPeriodo]       = useState('hoy');
  const [agrup,         setAgrup]         = useState('dia');
  const [reportLoading, setReportLoading] = useState(false);
  const LIMIT = 50;

  const fetchEquipos = useCallback(async () => {
    const r = await fetch('/api/helpdesk/equipos');
    if (r.ok) setEquipos(await r.json());
  }, []);

  const fetchResumen = useCallback(async (tid: number | null) => {
    const q = tid ? `?team_id=${tid}` : '';
    const r = await fetch(`/api/helpdesk/resumen${q}`);
    if (r.ok) setResumen(await r.json());
  }, []);

  const fetchTickets = useCallback(async (tid: number | null, p: number, per: string) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(p * LIMIT), periodo: per });
    if (tid) params.set('team_id', String(tid));
    const r = await fetch(`/api/helpdesk/tickets?${params}`);
    if (r.ok) {
      const d = await r.json();
      setTickets(Array.isArray(d.tickets) ? d.tickets : []); setTotal(d.total ?? 0);
    }
    setLoading(false);
  }, []);

  const fetchAnalytics = useCallback(async (tid: number | null, dias: number, ag: string) => {
    const params = new URLSearchParams({ dias: String(dias), agrup: ag });
    if (tid) params.set('team_id', String(tid));
    const r = await fetch(`/api/helpdesk/analytics?${params}`);
    if (r.ok) setAnalytics(await r.json());
  }, []);

  const reload = useCallback(() => {
    const opt = PERIODO_OPTS.find(o => o.value === periodo) ?? PERIODO_OPTS[2];
    fetchResumen(teamId);
    fetchTickets(teamId, page, periodo);
    fetchAnalytics(teamId, opt.dias, agrup);
  }, [teamId, page, periodo, agrup, fetchResumen, fetchTickets, fetchAnalytics]);

  useEffect(() => { fetchEquipos(); }, [fetchEquipos]);
  useEffect(() => { reload(); }, [reload]);

  const selectTeam = (id: number | null, name: string) => {
    setTeamId(id); setTeamName(name); setPage(0); setShowDrop(false);
  };

  const generateReport = async () => {
    setReportLoading(true);
    const opt = PERIODO_OPTS.find(o => o.value === periodo) ?? PERIODO_OPTS[2];
    const params = new URLSearchParams({ dias: String(opt.dias), agrup, equipo: teamName });
    if (teamId) params.set('team_id', String(teamId));
    const r = await fetch(`/api/helpdesk/reporte-pdf?${params}`, { method: 'POST' });
    setReportLoading(false);
    setReportMsg(r.ok ? '✅ Reporte enviado a Telegram' : '✗ No se pudo generar el reporte. Intenta de nuevo.');
    setTimeout(() => setReportMsg(''), 5000);
  };

  const totalPages = Math.ceil(total / LIMIT);
  const G_DIM = `${G}33`;

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#e5e7eb', minHeight: '100vh' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f9fafb', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Headphones size={18} color={G} /> Helpdesk
          </h2>
          <div style={{ color: '#6b7280', fontSize: 11, marginTop: 3 }}>{teamName} · Odoo wispi17</div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Filtro periodo */}
          <div style={{ display: 'flex', gap: 3 }}>
            {PERIODO_OPTS.map(o => (
              <button key={o.value} onClick={() => { setPeriodo(o.value); setPage(0); }}
                style={{ background: periodo === o.value ? G : '#111827',
                  border: `1px solid ${periodo === o.value ? G : '#374151'}`,
                  borderRadius: 6, color: periodo === o.value ? '#000' : '#9ca3af',
                  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
                  fontWeight: periodo === o.value ? 700 : 400 }}>
                {o.label}
              </button>
            ))}
          </div>

          {/* Equipo dropdown */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowDrop(v => !v)}
              style={{ background: '#111827', border: `1px solid ${G}55`, borderRadius: 8,
                color: '#e5e7eb', padding: '6px 12px', cursor: 'pointer', fontSize: 11,
                display: 'flex', alignItems: 'center', gap: 5 }}>
              {teamName.length > 18 ? teamName.slice(0,18)+'…' : teamName}
              <ChevronDown size={12} />
            </button>
            {showDrop && (
              <div style={{ position: 'absolute', right: 0, top: '110%', background: '#0d1117',
                border: '1px solid #374151', borderRadius: 8, zIndex: 50,
                minWidth: 200, maxHeight: 260, overflowY: 'auto' }}>
                <div onClick={() => selectTeam(null, 'Todos los equipos')}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                    color: !teamId ? G : '#e5e7eb', borderBottom: '1px solid #1f2937' }}>
                  Todos los equipos
                </div>
                {equipos.map(e => (
                  <div key={e.id} onClick={() => selectTeam(e.id, e.name)}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                      color: teamId === e.id ? G : '#e5e7eb', borderBottom: '1px solid #1f2937' }}>
                    {e.name}
                    <span style={{ color: '#4b5563', marginLeft: 6 }}>{e.total}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={reload}
            style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8,
              color: '#9ca3af', padding: '6px 10px', cursor: 'pointer' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>

          <button onClick={generateReport} disabled={reportLoading}
            style={{ background: G, border: 'none', borderRadius: 8, color: '#000',
              padding: '6px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: 5, opacity: reportLoading ? 0.6 : 1 }}>
            <FileText size={12} />
            {reportLoading ? 'Generando…' : 'PDF → Telegram'}
          </button>
          {reportMsg && (
            <span style={{ fontSize: 11, color: reportMsg.startsWith('✅') ? G : '#ef4444', fontWeight: 600 }}>
              {reportMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── KPIs ── */}
      {resumen && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Total activos', value: resumen.total,        color: '#3b82f6', icon: <Headphones size={13}/> },
            { label: 'Abiertos',      value: resumen.abiertos,     color: G,         icon: <Clock size={13}/> },
            { label: 'Resueltos',     value: resumen.resueltos,    color: '#22c55e', icon: <CheckCircle size={13}/> },
            { label: 'Urgentes',      value: resumen.urgentes,     color: '#f59e0b', icon: <AlertTriangle size={13}/> },
            { label: 'SLA vencidos',  value: resumen.sla_vencidos, color: '#ef4444', icon: <AlertTriangle size={13}/> },
            { label: 'Creados hoy',   value: resumen.creados_hoy,  color: '#a855f7', icon: <TrendingUp size={13}/> },
          ].map(k => (
            <div key={k.label} style={{ background: '#111827', border: `1px solid ${k.color}33`,
              borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ color: k.color, marginBottom: 4 }}>{k.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f9fafb' }}>{k.value.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(TABS as readonly Tab[]).map(t => {
          const labels: Record<Tab,string> = {
            tickets: '📋 Tickets', tendencias: '📈 Tendencias', patrones: '🔍 Patrones'
          };
          return (
            <button key={t} onClick={() => { trackTab(t); setTab(t); }}
              style={{ background: tab===t ? G_DIM : '#111827',
                border: `1px solid ${tab===t ? G : '#374151'}`,
                borderRadius: 8, color: tab===t ? G : '#9ca3af',
                padding: '6px 14px', cursor: 'pointer', fontSize: 11, fontWeight: tab===t ? 700 : 400 }}>
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* ══ TAB: TICKETS ══ */}
      {tab === 'tickets' && (
        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#4b5563' }}>Cargando tickets…</div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#0d1117', color: '#6b7280' }}>
                    {['#','Ticket','Cliente','Agente','Equipo','Etapa','Tipo','Prioridad','Creado','SLA'].map(h => (
                      <th key={h} style={{ padding: '9px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t, i) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #0d1117',
                      background: i%2===0 ? '#111827' : '#0f1720' }}>
                      <td style={{ padding: '7px 10px', color: '#4b5563' }}>{t.id}</td>
                      <td style={{ padding: '7px 10px', color: '#f9fafb', maxWidth: 180,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</td>
                      <td style={{ padding: '7px 10px', color: '#9ca3af', maxWidth: 120,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.cliente}</td>
                      <td style={{ padding: '7px 10px', color: '#9ca3af', maxWidth: 120,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.agente}</td>
                      <td style={{ padding: '7px 10px', color: '#6b7280' }}>{t.equipo}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ background: '#1f2937', borderRadius: 4,
                          padding: '2px 6px', fontSize: 10, color: '#d1d5db' }}>{t.etapa}</span>
                      </td>
                      <td style={{ padding: '7px 10px', color: '#6b7280', fontSize: 10 }}>{t.tipo}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ color: PRIORIDAD_COLOR[t.prioridad]??'#6b7280', fontWeight: 700, fontSize: 10 }}>
                          {t.prioridad}
                        </span>
                      </td>
                      <td style={{ padding: '7px 10px', color: '#6b7280', fontSize: 10, whiteSpace: 'nowrap' }}>
                        {t.creado.slice(0,10)}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        {t.sla_vencido
                          ? <span style={{ color: '#ef4444', fontSize: 10 }}>⚠ Vencido</span>
                          : <span style={{ color: '#22c55e', fontSize: 10 }}>✓ OK</span>}
                      </td>
                    </tr>
                  ))}
                  {tickets.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#4b5563' }}>
                      Sin tickets para el periodo seleccionado.
                    </td></tr>
                  )}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12 }}>
                  <button onClick={() => setPage(p => Math.max(0,p-1))} disabled={page===0}
                    style={{ background: '#0d1117', border: '1px solid #374151', borderRadius: 6,
                      color: '#9ca3af', padding: '4px 12px', cursor: page===0?'not-allowed':'pointer' }}>←</button>
                  <span style={{ color: '#6b7280', fontSize: 11, alignSelf: 'center' }}>
                    {page+1} / {totalPages} · {total.toLocaleString()} tickets
                  </span>
                  <button onClick={() => setPage(p => Math.min(totalPages-1,p+1))} disabled={page===totalPages-1}
                    style={{ background: '#0d1117', border: '1px solid #374151', borderRadius: 6,
                      color: '#9ca3af', padding: '4px 12px', cursor: page===totalPages-1?'not-allowed':'pointer' }}>→</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══ TAB: TENDENCIAS ══ */}
      {tab === 'tendencias' && analytics && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {AGRUP_OPTS.map(o => (
              <button key={o.value} onClick={() => setAgrup(o.value)}
                style={{ background: agrup===o.value ? G_DIM : '#111827',
                  border: `1px solid ${agrup===o.value ? G : '#374151'}`,
                  borderRadius: 6, color: agrup===o.value ? G : '#9ca3af',
                  padding: '4px 12px', cursor: 'pointer', fontSize: 11 }}>
                {o.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Tickets en periodo', value: analytics.total_tickets,       color: '#3b82f6' },
              { label: 'Resueltos',          value: analytics.resueltos_total,     color: G         },
              { label: 'SLA vencidos',       value: analytics.sla_vencidos_total,  color: '#ef4444' },
              { label: 'Avg cierre',         value: analytics.avg_cierre_horas != null ? `${analytics.avg_cierre_horas}h` : '—', color: '#f59e0b' },
            ].map(k => (
              <div key={k.label} style={{ background: '#111827', border: `1px solid ${k.color}33`,
                borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>
                  {typeof k.value === 'number' ? k.value.toLocaleString() : k.value}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            {[
              { key: 'creados'   as const, label: 'Creados'    },
              { key: 'resueltos' as const, label: 'Resueltos'  },
              { key: 'sla_venc'  as const, label: 'SLA venc.'  },
            ].map(g => (
              <div key={g.key} style={{ background: '#111827', border: '1px solid #1f2937',
                borderRadius: 10, padding: 16 }}>
                <MiniBar data={analytics.tendencia ?? []} colorKey={g.key} label={g.label} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                  {(analytics.tendencia ?? []).slice(-5).map((b, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#f9fafb' }}>{b[g.key]}</div>
                      <div style={{ fontSize: 9, color: '#4b5563' }}>{b.periodo.slice(-5)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#0d1117', color: '#6b7280' }}>
                  {['Periodo','Creados','Resueltos','SLA Venc.','% Resolución'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: h==='Periodo'?'left':'right', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...(analytics.tendencia ?? [])].reverse().map((b, i) => {
                  const pct = b.creados > 0 ? Math.round((b.resueltos/b.creados)*100) : 0;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #0d1117',
                      background: i%2===0 ? '#111827' : '#0f1720' }}>
                      <td style={{ padding: '7px 12px', color: '#f9fafb', fontWeight: 600 }}>{b.periodo}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', color: '#3b82f6' }}>{b.creados}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', color: G }}>{b.resueltos}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right',
                        color: b.sla_venc>0?'#ef4444':'#4b5563' }}>{b.sla_venc}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right',
                        color: pct>=80?G:pct>=50?'#f59e0b':'#ef4444' }}>
                        {b.creados > 0 ? `${pct}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ TAB: PATRONES ══ */}
      {tab === 'patrones' && analytics && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { title: '📂 Por tipo de ticket',   data: analytics.por_tipo      ?? [], color: '#3b82f6' },
            { title: '🏢 Por equipo',            data: analytics.por_equipo    ?? [], color: G         },
            { title: '👤 Top agentes',           data: analytics.por_agente    ?? [], color: '#a855f7' },
            { title: '🔴 Por prioridad',         data: analytics.por_prioridad ?? [], color: '#f59e0b' },
          ].map(block => {
            const max = Math.max(...block.data.map(d => d.total), 1);
            return (
              <div key={block.title} style={{ background: '#111827', border: '1px solid #1f2937',
                borderRadius: 10, padding: 16 }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: '#f9fafb' }}>
                  {block.title}
                </p>
                {block.data.map(item => (
                  <HBar key={item.nombre} nombre={item.nombre} total={item.total} max={max} color={block.color} />
                ))}
                {block.data.length === 0 && (
                  <p style={{ color: '#4b5563', fontSize: 11 }}>Sin tickets en este período</p>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
