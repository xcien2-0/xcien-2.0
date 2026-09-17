import { useState, useEffect, useCallback } from 'react';
import { useVisibleInterval } from '../../../hooks/useVisibleInterval';
import { RefreshCw, AlertTriangle, Users, Clock, MapPin, Zap, Wrench, HelpCircle } from 'lucide-react';

// ── Paleta ────────────────────────────────────────────────────────────────────
const C = {
  bg:      '#080d16',
  surf:    '#0e1724',
  surf2:   '#141f30',
  border:  '#1e2d40',
  border2: '#263548',
  green:   '#00A859',
  greenDim:'rgba(0,168,89,0.12)',
  red:     '#ef4444',
  redDim:  'rgba(239,68,68,0.12)',
  amber:   '#f59e0b',
  amberDim:'rgba(245,158,11,0.12)',
  blue:    '#3b82f6',
  blueDim: 'rgba(59,130,246,0.12)',
  purple:  '#8b5cf6',
  text:    '#f0f6ff',
  sub:     '#94a3b8',
  muted:   '#4b6585',
  dim:     'rgba(255,255,255,0.06)',
};

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface StageRow  { etapa: string; total: number; }
interface AgentRow  { agente: string; total: number; }
interface OldTicket { id: number; name: string; stage: string; agent: string;
                      team: string; tipo: string; age_h: number; critico: boolean; }
interface BacklogData {
  total_abiertos: number; sin_asignar: number; criticos: number;
  por_etapa: StageRow[]; por_agente: AgentRow[];
  tickets_antiguos: OldTicket[]; capturado_at: string;
}

interface MuniRow {
  municipio: string; total: number;
  habilitaciones: number; fallas: number; otros: number;
  tickets: { id: number; name: string; stage: string; tipo: string; age_h: number; cat: string; }[];
}
interface BacklogNL {
  estado: string; total_abiertos: number;
  municipios: MuniRow[]; capturado_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ageLabel(h: number) {
  if (h < 1)   return `${Math.round(h * 60)}m`;
  if (h < 24)  return `${Math.round(h)}h`;
  if (h < 168) return `${Math.floor(h / 24)}d`;
  return `${Math.floor(h / 168)}sem`;
}

function stageColor(etapa: string) {
  const e = etapa.toLowerCase();
  if (e.includes('nuevo'))     return C.amber;
  if (e.includes('cae'))       return C.blue;
  if (e.includes('cor'))       return C.purple;
  if (e.includes('monitoreo') || e.includes('noc')) return C.green;
  if (e.includes('nvl:2') || e.includes('nivel 2')) return '#f97316';
  return C.sub;
}

// ── KPI tile ──────────────────────────────────────────────────────────────────
function Tile({ label, value, color, sub }: { label: string; value: number | string; color: string; sub?: string }) {
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: '14px 18px', minWidth: 130, flex: 1 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// ── Barra horizontal ──────────────────────────────────────────────────────────
function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11,
                    color: C.sub, marginBottom: 3 }}>
        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: C.text, fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{value}</span>
      </div>
      <div style={{ height: 5, background: C.dim, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color,
                      borderRadius: 3, transition: 'width .4s' }} />
      </div>
    </div>
  );
}

// ── Tab Nacional ──────────────────────────────────────────────────────────────
function TabNacional({ data }: { data: BacklogData }) {
  const maxStage = data.por_etapa[0]?.total ?? 1;
  const maxAgent = data.por_agente[0]?.total ?? 1;

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {/* Backlog por etapa */}
      <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: 16, flex: '1 1 280px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: 1,
                      textTransform: 'uppercase', marginBottom: 12 }}>Backlog por etapa</div>
        {data.por_etapa.map(r => (
          <Bar key={r.etapa} label={r.etapa} value={r.total} max={maxStage} color={stageColor(r.etapa)} />
        ))}
      </div>

      {/* Carga por agente */}
      <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: 16, flex: '1 1 240px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: 1,
                      textTransform: 'uppercase', marginBottom: 12 }}>Carga por agente</div>
        {data.por_agente.map(r => (
          <Bar key={r.agente} label={r.agente} value={r.total} max={maxAgent}
               color={r.total > 15 ? C.red : r.total > 8 ? C.amber : C.green} />
        ))}
      </div>

      {/* Tickets más antiguos */}
      <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: 16, flex: '1 1 100%', overflowX: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: 1,
                      textTransform: 'uppercase', marginBottom: 10 }}>
          Backlog crítico — tickets más antiguos
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.muted, textAlign: 'left' }}>
              {['ID','Asunto','Etapa','Agente','Tipo','Edad'].map(h => (
                <th key={h} style={{ padding: '4px 10px', fontWeight: 600,
                                     borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.tickets_antiguos.map((t, i) => (
              <tr key={t.id} style={{ background: i % 2 === 0 ? 'transparent' : C.dim }}>
                <td style={{ padding: '5px 10px', color: C.muted }}>{t.id}</td>
                <td style={{ padding: '5px 10px', color: C.text, maxWidth: 220,
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={t.name}>{t.name}</td>
                <td style={{ padding: '5px 10px' }}>
                  <span style={{ color: stageColor(t.stage), fontWeight: 500 }}>{t.stage}</span>
                </td>
                <td style={{ padding: '5px 10px', color: C.sub }}>{t.agent}</td>
                <td style={{ padding: '5px 10px', color: C.muted }}>{t.tipo}</td>
                <td style={{ padding: '5px 10px' }}>
                  <span style={{ color: t.critico ? C.red : t.age_h > 48 ? C.amber : C.green,
                                 fontWeight: t.critico ? 700 : 400 }}>
                    {ageLabel(t.age_h)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab Nuevo León ────────────────────────────────────────────────────────────
function TabNL({ data }: { data: BacklogNL }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const maxTotal = data.municipios[0]?.total ?? 1;

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {/* Mapa de calor municipal */}
      <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8,
                    padding: 16, flex: '1 1 320px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: 1,
                      textTransform: 'uppercase', marginBottom: 12 }}>
          Backlog por municipio — Nuevo León
        </div>
        {data.municipios.map(m => {
          const pct = maxTotal > 0 ? Math.round((m.total / maxTotal) * 100) : 0;
          const isOpen = expanded === m.municipio;
          return (
            <div key={m.municipio} style={{ marginBottom: 8 }}>
              <div onClick={() => setExpanded(isOpen ? null : m.municipio)}
                   style={{ cursor: 'pointer', display: 'flex', alignItems: 'center',
                            gap: 8, marginBottom: 4 }}>
                <MapPin size={12} color={C.muted} />
                <span style={{ fontSize: 12, color: C.text, flex: 1,
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.municipio}
                </span>
                {/* mini badges */}
                {m.habilitaciones > 0 && (
                  <span style={{ fontSize: 10, background: C.blueDim, color: C.blue,
                                 border: `1px solid ${C.blue}33`, borderRadius: 4,
                                 padding: '1px 5px', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Wrench size={9} />{m.habilitaciones}
                  </span>
                )}
                {m.fallas > 0 && (
                  <span style={{ fontSize: 10, background: C.redDim, color: C.red,
                                 border: `1px solid ${C.red}33`, borderRadius: 4,
                                 padding: '1px 5px', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Zap size={9} />{m.fallas}
                  </span>
                )}
                {m.otros > 0 && (
                  <span style={{ fontSize: 10, color: C.muted, padding: '1px 4px' }}>
                    +{m.otros}
                  </span>
                )}
                <span style={{ fontSize: 12, color: C.text, fontWeight: 700, minWidth: 24,
                               textAlign: 'right' }}>{m.total}</span>
              </div>
              {/* barra */}
              <div style={{ height: 4, background: C.dim, borderRadius: 2,
                            overflow: 'hidden', marginLeft: 20 }}>
                <div style={{ height: '100%', width: `${pct}%`,
                              background: m.fallas > m.habilitaciones ? C.red : C.blue,
                              borderRadius: 2, transition: 'width .3s' }} />
              </div>
              {/* detalle expandible */}
              {isOpen && m.tickets.length > 0 && (
                <div style={{ marginTop: 6, marginLeft: 20, background: C.surf2,
                              border: `1px solid ${C.border}`, borderRadius: 6, padding: 8 }}>
                  {m.tickets.map(t => (
                    <div key={t.id} style={{ display: 'flex', gap: 8, fontSize: 11,
                                            color: C.sub, marginBottom: 4, alignItems: 'center' }}>
                      <span style={{ color: C.muted, minWidth: 40 }}>#{t.id}</span>
                      <span style={{ flex: 1, color: C.text, overflow: 'hidden',
                                     textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>
                        {t.name}
                      </span>
                      <span style={{ color: t.cat === 'falla' ? C.red : t.cat === 'habilitacion' ? C.blue : C.muted,
                                     minWidth: 36, textAlign: 'right' }}>
                        {ageLabel(t.age_h)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Resumen agregado */}
      <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: 1,
                        textTransform: 'uppercase', marginBottom: 12 }}>Resumen NL</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Tile label="Total abiertos" value={data.total_abiertos} color={C.amber} />
            <Tile label="Municipios activos"
                  value={data.municipios.filter(m => m.total > 0).length}
                  color={C.blue} />
            <Tile label="Habilitaciones"
                  value={data.municipios.reduce((s, m) => s + m.habilitaciones, 0)}
                  color={C.blue} />
            <Tile label="Fallas"
                  value={data.municipios.reduce((s, m) => s + m.fallas, 0)}
                  color={C.red} />
          </div>
        </div>

        {/* Top 5 municipios con más carga */}
        <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: 1,
                        textTransform: 'uppercase', marginBottom: 10 }}>Top municipios</div>
          {data.municipios.slice(0, 8).map(m => (
            <div key={m.municipio} style={{ display: 'flex', justifyContent: 'space-between',
                                           alignItems: 'center', padding: '4px 0',
                                           borderBottom: `1px solid ${C.dim}`, fontSize: 12 }}>
              <span style={{ color: C.text }}>{m.municipio}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {m.fallas > 0 && <span style={{ color: C.red, fontSize: 11 }}>⚡{m.fallas}</span>}
                {m.habilitaciones > 0 && <span style={{ color: C.blue, fontSize: 11 }}>🔧{m.habilitaciones}</span>}
                <span style={{ color: C.amber, fontWeight: 700 }}>{m.total}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function MesaOperacionesSection() {
  const [tab, setTab]             = useState<'nacional' | 'nl'>('nacional');
  const [backlog, setBacklog]     = useState<BacklogData | null>(null);
  const [backlogNL, setBacklogNL] = useState<BacklogNL | null>(null);
  const [loading, setLoading]     = useState(false);
  const [loadingNL, setLoadingNL] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchNacional = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/helpdesk/backlog');
      if (r.ok) { setBacklog(await r.json()); setLastFetch(new Date()); }
    } finally { setLoading(false); }
  }, []);

  const fetchNL = useCallback(async () => {
    setLoadingNL(true);
    try {
      const r = await fetch('/api/helpdesk/backlog-nl');
      if (r.ok) { setBacklogNL(await r.json()); }
    } finally { setLoadingNL(false); }
  }, []);

  useEffect(() => { fetchNacional(); }, [fetchNacional]);
  useEffect(() => { if (tab === 'nl' && !backlogNL) fetchNL(); }, [tab, backlogNL, fetchNL]);

  // Polling: nacional cada 3 min, NL cada 5 min
  useVisibleInterval(fetchNacional, 3 * 60 * 1000);

  const tabs: { id: 'nacional' | 'nl'; label: string; icon: string }[] = [
    { id: 'nacional', label: 'Nacional', icon: '🗺️' },
    { id: 'nl',       label: 'Nuevo León', icon: '📍' },
  ];

  return (
    <div style={{ background: C.bg, minHeight: '100%', padding: 20,
                  fontFamily: 'system-ui, sans-serif', color: C.text }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Mesa de Operaciones</div>
          <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
            Backlog ATC · CAST · NOC · Control Operativo
            {lastFetch && (
              <span style={{ marginLeft: 8, color: C.muted }}>
                · actualizado {lastFetch.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => { fetchNacional(); if (tab === 'nl') fetchNL(); }}
                  disabled={loading}
                  style={{ background: 'transparent', border: `1px solid ${C.border}`,
                           borderRadius: 6, padding: '6px 10px', color: C.sub,
                           cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Actualizar
          </button>
        </div>
      </div>

      {/* KPIs globales */}
      {backlog && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <Tile label="Tickets abiertos" value={backlog.total_abiertos} color={C.amber}
                sub="todos los equipos CAST" />
          <Tile label="Sin asignar" value={backlog.sin_asignar} color={C.red}
                sub="sin agente asignado" />
          <Tile label="Críticos >7d" value={backlog.criticos} color={backlog.criticos > 0 ? C.red : C.green}
                sub="más de 168 horas abiertos" />
          <Tile label="En cola Nuevo" value={backlog.por_etapa.find(e => e.etapa === 'Nuevo')?.total ?? 0}
                color={C.amber} sub="sin triaje" />
          <Tile label="Campo CAE" value={backlog.por_etapa.find(e => e.etapa.toLowerCase().includes('cae'))?.total ?? 0}
                color={C.blue} sub="visitas pendientes" />
          <Tile label="NOC Monitoreo" value={backlog.por_etapa.find(e => e.etapa.toLowerCase().includes('monitoreo'))?.total ?? 0}
                color={C.green} sub="en validación NOC" />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16,
                    borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ background: tab === t.id ? C.surf : 'transparent',
                           border: `1px solid ${tab === t.id ? C.border2 : 'transparent'}`,
                           borderBottom: tab === t.id ? `2px solid ${C.green}` : '2px solid transparent',
                           borderRadius: '6px 6px 0 0', padding: '7px 14px', cursor: 'pointer',
                           color: tab === t.id ? C.text : C.muted, fontSize: 13, fontWeight: 500 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Contenido de tab */}
      {tab === 'nacional' && (
        loading && !backlog
          ? <div style={{ color: C.sub, padding: 40, textAlign: 'center' }}>Cargando backlog...</div>
          : backlog
            ? <TabNacional data={backlog} />
            : <div style={{ color: C.red, padding: 20 }}>Error al cargar datos</div>
      )}

      {tab === 'nl' && (
        loadingNL && !backlogNL
          ? <div style={{ color: C.sub, padding: 40, textAlign: 'center' }}>
              Cargando backlog Nuevo León — consultando 29,716 partners...
            </div>
          : backlogNL
            ? <TabNL data={backlogNL} />
            : <div style={{ color: C.sub, padding: 20 }}>Cargando datos NL...</div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
