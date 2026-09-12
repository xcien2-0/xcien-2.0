import { useState, useEffect, useRef } from 'react';
import { ThemeConfig, WFMOrder, WFMOrderState, FieldTicket } from '../types';

import { API_BASE } from '../../../config';
import { useTabTrack } from '../../../hooks/useTabTrack';
const G = '#00ff88';

// ── Field Service View (Habilitaciones & Fallas desde Odoo CAST) ──────────────
const FS_STAGES = [
  { idx: 0, nombre: 'NOC',         icon: '📡', color: '#00B4D8' },
  { idx: 1, nombre: 'Dispatch',    icon: '🚛', color: '#FF6B35' },
  { idx: 2, nombre: 'Almacén',     icon: '📦', color: '#FFB703' },
  { idx: 3, nombre: 'Operaciones', icon: '🔧', color: '#00ff88' },
  { idx: 4, nombre: 'NOC Cierra',  icon: '✅', color: '#00C896' },
];
const PRIO_COLOR: Record<string, string> = {
  normal: '#888', alta: '#FFB703', urgente: '#FF6B35', 'crítica': '#FF4757',
};

// ── Ticket Detail Drawer ──────────────────────────────────────────────────────
interface TicketDetalle {
  id: number;
  nombre: string;
  descripcion: string;
  etapa_id: number | null;
  etapa: string;
  cliente: string | null;
  equipo: string | null;
  tipo: string | null;
  prioridad: string;
  tecnico: string | null;
  creado: string;
  ultimo_cambio: string;
  kanban_state: string;
  mensajes: { id: number; autor: string; fecha: string; cuerpo: string; tipo: string }[];
  etapas_disponibles: { id: number; nombre: string }[];
}

function TicketDrawer({ ticketId, theme, onClose, onUpdated }: {
  ticketId: number; theme: ThemeConfig; onClose: () => void; onUpdated: () => void;
}) {
  const [detalle, setDetalle]     = useState<TicketDetalle | null>(null);
  const [loading, setLoading]     = useState(true);
  const [comentario, setComent]   = useState('');
  const [enviando, setEnviando]   = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const bottomRef                 = useRef<HTMLDivElement>(null);

  const fetchDetalle = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/field-tickets/${ticketId}`);
      if (res.ok) setDetalle(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchDetalle(); }, [ticketId]);
  useEffect(() => {
    if (detalle) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detalle?.mensajes.length]);

  const enviarComentario = async () => {
    if (!comentario.trim()) return;
    setEnviando(true);
    try {
      await fetch(`${API_BASE}/api/wfm/field-tickets/${ticketId}/comentario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: comentario }),
      });
      setComent('');
      await fetchDetalle();
    } finally { setEnviando(false); }
  };

  const cambiarEtapa = async (etapa_id: number) => {
    setCambiando(true);
    try {
      await fetch(`${API_BASE}/api/wfm/field-tickets/${ticketId}/etapa`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etapa_id }),
      });
      await fetchDetalle();
      onUpdated();
    } finally { setCambiando(false); }
  };

  const KANBAN_COLOR: Record<string, string> = { normal: '#888', done: '#00C896', blocked: '#FF4757' };
  const KANBAN_LABEL: Record<string, string> = { normal: 'Normal', done: '✅ Listo', blocked: '🚫 Bloqueado' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }} />
      <div style={{
        position: 'relative', zIndex: 1, width: '100%', maxWidth: 580,
        background: theme.bg, borderLeft: `1px solid ${theme.border}`,
        display: 'flex', flexDirection: 'column', height: '100%',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading
              ? <div style={{ color: theme.dim, fontSize: 13 }}>Cargando ticket...</div>
              : <>
                  <div style={{ fontSize: 14, fontWeight: 800, color: theme.text, lineHeight: 1.35 }}>{detalle?.nombre}</div>
                  <div style={{ fontSize: 10, color: theme.dim, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {detalle?.cliente && <span>👤 {detalle.cliente}</span>}
                    {detalle?.equipo  && <span>🏢 {detalle.equipo}</span>}
                    {detalle?.tipo    && <span>📋 {detalle.tipo}</span>}
                  </div>
                </>
            }
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.dim, fontSize: 20, cursor: 'pointer', padding: 0 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {detalle && (
            <>
              {/* Meta */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                  background: 'rgba(0,180,216,0.15)', color: '#00B4D8', border: '1px solid rgba(0,180,216,0.3)' }}>
                  {detalle.etapa}
                </span>
                <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 20,
                  background: `${KANBAN_COLOR[detalle.kanban_state]}18`, color: KANBAN_COLOR[detalle.kanban_state],
                  border: `1px solid ${KANBAN_COLOR[detalle.kanban_state]}40` }}>
                  {KANBAN_LABEL[detalle.kanban_state] ?? detalle.kanban_state}
                </span>
                {detalle.tecnico && (
                  <span style={{ fontSize: 10, color: theme.dim }}>🔧 {detalle.tecnico}</span>
                )}
              </div>

              {/* Fechas */}
              <div style={{ display: 'flex', gap: 12, fontSize: 10, color: theme.dim }}>
                <span>📅 Creado: <span style={{ color: theme.text }}>{detalle.creado}</span></span>
                {detalle.ultimo_cambio && <span>🔄 Actualizado: <span style={{ color: theme.text }}>{detalle.ultimo_cambio}</span></span>}
              </div>

              {/* Descripcion */}
              {detalle.descripcion && (
                <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: `1px solid ${theme.border}`, fontSize: 12, color: theme.dim, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {detalle.descripcion}
                </div>
              )}

              {/* Cambiar etapa */}
              {detalle.etapas_disponibles.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: theme.dim, textTransform: 'uppercase', marginBottom: 8 }}>Mover a etapa</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {detalle.etapas_disponibles.map(e => (
                      <button key={e.id} onClick={() => cambiarEtapa(e.id)} disabled={cambiando || e.id === detalle.etapa_id} style={{
                        padding: '5px 12px', borderRadius: 8, border: 'none', cursor: e.id === detalle.etapa_id ? 'default' : 'pointer', fontSize: 11,
                        background: e.id === detalle.etapa_id ? `${G}20` : 'rgba(255,255,255,0.06)',
                        color: e.id === detalle.etapa_id ? G : theme.dim,
                        boxShadow: e.id === detalle.etapa_id ? `0 0 0 1px ${G}50` : 'none',
                        fontWeight: e.id === detalle.etapa_id ? 700 : 400,
                      }}>
                        {e.id === detalle.etapa_id ? '✓ ' : ''}{e.nombre}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chatter */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: theme.dim, textTransform: 'uppercase', marginBottom: 10 }}>
                  Historial ({detalle.mensajes.length})
                </div>
                {detalle.mensajes.length === 0 && (
                  <div style={{ fontSize: 12, color: theme.dim, textAlign: 'center', padding: '20px 0' }}>Sin mensajes aún</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {detalle.mensajes.map(m => (
                    <div key={m.id} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: `1px solid ${theme.border}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: G }}>{m.autor}</span>
                        <span style={{ fontSize: 10, color: theme.dim }}>{m.fecha}</span>
                      </div>
                      <div style={{ fontSize: 12, color: theme.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{m.cuerpo}</div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Comment input */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${theme.border}`, display: 'flex', gap: 10 }}>
          <textarea
            value={comentario}
            onChange={e => setComent(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && e.metaKey && (e.preventDefault(), enviarComentario())}
            placeholder="Agregar comentario... (⌘↵ enviar)"
            rows={2}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 12,
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
              color: theme.text, outline: 'none', resize: 'none',
            }}
          />
          <button onClick={enviarComentario} disabled={enviando || !comentario.trim()} style={{
            padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', alignSelf: 'flex-end',
            background: comentario.trim() && !enviando ? G : 'rgba(255,255,255,0.06)',
            color: comentario.trim() && !enviando ? '#000' : theme.dim,
            fontWeight: 700, fontSize: 13, transition: 'all 0.15s',
          }}>
            {enviando ? '...' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketMiniCard({ t, theme, onClick }: { t: FieldTicket; theme: ThemeConfig; onClick: () => void }) {
  const prioColor = PRIO_COLOR[t.prioridad] ?? '#888';
  const tipoColor = t.tipo === 'falla' ? '#FF4757' : '#00B4D8';
  const currentStage = FS_STAGES[t.etapa_op_idx];
  return (
    <div onClick={onClick}
      style={{
        background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14,
        padding: '14px 16px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
        transition: 'border-color 0.15s, transform 0.1s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = tipoColor + '50';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = theme.border;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: tipoColor, borderRadius: '14px 0 0 14px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginLeft: 6 }}>
        <span style={{ fontSize: 10, color: theme.dim, fontWeight: 600 }}>{t.id}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: tipoColor }}>{t.tipo === 'falla' ? '🔴 Falla' : '⚡ Hab.'}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: `${prioColor}18`, color: prioColor, border: `1px solid ${prioColor}30` }}>
          {t.prioridad.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, lineHeight: 1.35, marginBottom: 6, marginLeft: 6 }}>{t.nombre}</div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, marginLeft: 6, flexWrap: 'wrap' }}>
        {t.cliente && <span style={{ fontSize: 11, color: theme.dim }}>👤 {t.cliente}</span>}
        {t.tecnico && <span style={{ fontSize: 11, color: theme.dim }}>🔧 {t.tecnico}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginLeft: 6, marginBottom: 10 }}>
        {FS_STAGES.map((s, i) => (
          <div key={s.idx} style={{ display: 'flex', alignItems: 'center', flex: i < FS_STAGES.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: t.etapa_op_idx >= s.idx ? s.color : 'rgba(255,255,255,0.08)',
                boxShadow: t.etapa_op_idx === s.idx ? `0 0 10px ${s.color}` : 'none',
                border: t.etapa_op_idx === s.idx ? `2px solid ${s.color}` : 'none',
                transition: 'all 0.3s', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9,
              }} title={s.nombre}>{t.etapa_op_idx === s.idx ? s.icon : ''}</div>
              <span style={{ fontSize: 8, color: t.etapa_op_idx === s.idx ? s.color : theme.dim, whiteSpace: 'nowrap' }}>{s.nombre}</span>
            </div>
            {i < FS_STAGES.length - 1 && (
              <div style={{ flex: 1, height: 2, background: t.etapa_op_idx > s.idx ? s.color : 'rgba(255,255,255,0.07)', marginBottom: 14 }} />
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginLeft: 6 }}>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: `${currentStage?.color ?? '#888'}15`, color: currentStage?.color ?? theme.dim, border: `1px solid ${currentStage?.color ?? '#888'}30` }}>
          {t.etapa_odoo}
        </span>
        <span style={{ fontSize: 9, color: theme.dim }}>{t.fecha_creacion?.slice(0, 10)} · Ver detalle →</span>
      </div>
    </div>
  );
}

function FieldServiceView({ theme }: { theme: ThemeConfig }) {
  const [tickets, setTickets]       = useState<FieldTicket[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState<'all' | 'habilitacion' | 'falla'>('all');
  const [stageFilter, setStage]     = useState<number | null>(null);
  const [summary, setSummary]       = useState<any>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewMode, setViewMode]     = useState<'grid' | 'kanban' | 'carousel'>('grid');
  const trackTab = useTabTrack('wfm');
  const [carouselIdx, setCarousel]  = useState(0);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [res, sumRes] = await Promise.all([
        fetch(`${API_BASE}/api/wfm/field-tickets?limit=200`),
        fetch(`${API_BASE}/api/wfm/field-tickets/summary`),
      ]);
      if (res.ok)    { const d = await res.json(); setTickets(d.tickets ?? []); }
      if (sumRes.ok) { const d = await sumRes.json(); setSummary(d); }
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const filtered = tickets.filter(t => {
    if (filter === 'habilitacion' && t.tipo !== 'habilitacion') return false;
    if (filter === 'falla'        && t.tipo !== 'falla')        return false;
    if (viewMode === 'grid' && stageFilter !== null && t.etapa_op_idx !== stageFilter) return false;
    return true;
  });

  // Reset carousel index when filter changes
  useEffect(() => { setCarousel(0); }, [filter, viewMode]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: theme.dim }}>Conectando a CAST Odoo...</div>;

  const VIEW_MODES = [
    { id: 'grid',     icon: '▦',  label: 'Tarjetas' },
    { id: 'kanban',   icon: '☰',  label: 'Kanban'   },
    { id: 'carousel', icon: '▷',  label: 'Carrusel' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPIs */}
      {summary && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Total',          val: summary.total,           col: theme.accent },
            { label: 'Abiertos',       val: summary.abiertos,        col: '#FF6B35'    },
            { label: 'Cerrados',       val: summary.cerrados,        col: '#00C896'    },
            { label: 'Habilitaciones', val: summary.habilitaciones,  col: '#00B4D8'    },
            { label: 'Fallas',         val: summary.fallas,          col: '#FF4757'    },
          ].map(k => (
            <div key={k.label} style={{ flex: 1, minWidth: 80, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: k.col }}>{k.val}</div>
              <div style={{ fontSize: 9, color: theme.dim, marginTop: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filtros + toggle de vista */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all','habilitacion','falla'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11,
            background: filter === f ? `${theme.accent}25` : 'rgba(255,255,255,0.05)',
            color: filter === f ? theme.accent : theme.dim,
            boxShadow: filter === f ? `0 0 0 1px ${theme.accent}50` : 'none',
          }}>
            {f === 'all' ? 'Todos' : f === 'habilitacion' ? '⚡ Habilitaciones' : '🔴 Fallas'}
          </button>
        ))}

        {viewMode === 'grid' && (
          <>
            <div style={{ width: 1, background: theme.border, margin: '0 4px', alignSelf: 'stretch' }} />
            {FS_STAGES.map(s => (
              <button key={s.idx} onClick={() => setStage(stageFilter === s.idx ? null : s.idx)} style={{
                padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 10,
                background: stageFilter === s.idx ? `${s.color}20` : 'rgba(255,255,255,0.04)',
                color: stageFilter === s.idx ? s.color : theme.dim,
                boxShadow: stageFilter === s.idx ? `0 0 0 1px ${s.color}50` : 'none',
              }}>
                {s.icon} {s.nombre}
              </button>
            ))}
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* View mode toggle */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, gap: 2 }}>
          {VIEW_MODES.map(v => (
            <button key={v.id} onClick={() => { trackTab(v.id); setViewMode(v.id); }} title={v.label} style={{
              padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
              background: viewMode === v.id ? `${theme.accent}22` : 'transparent',
              color: viewMode === v.id ? theme.accent : theme.dim,
              boxShadow: viewMode === v.id ? `0 0 0 1px ${theme.accent}40` : 'none',
              fontWeight: viewMode === v.id ? 700 : 400,
              transition: 'all 0.15s',
            }}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── VISTA GRID ── */}
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
          {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: theme.dim, gridColumn: '1/-1' }}>Sin tickets en este filtro</div>}
          {filtered.map(t => (
            <TicketMiniCard key={t.id} t={t} theme={theme} onClick={() => setSelectedId(t.odoo_id)} />
          ))}
        </div>
      )}

      {/* ── VISTA KANBAN ── */}
      {viewMode === 'kanban' && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
          {FS_STAGES.map(stage => {
            const col = filtered.filter(t => t.etapa_op_idx === stage.idx);
            return (
              <div key={stage.idx} style={{ minWidth: 260, flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Column header */}
                <div style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: `${stage.color}12`, border: `1px solid ${stage.color}30`,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 16 }}>{stage.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: stage.color }}>{stage.nombre}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{
                    fontSize: 11, fontWeight: 800, minWidth: 22, textAlign: 'center',
                    padding: '1px 7px', borderRadius: 20,
                    background: col.length > 0 ? `${stage.color}25` : 'rgba(255,255,255,0.05)',
                    color: col.length > 0 ? stage.color : theme.dim,
                  }}>{col.length}</span>
                </div>
                {/* Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {col.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: theme.dim, fontSize: 11 }}>—</div>
                  )}
                  {col.map(t => {
                    const tipoColor = t.tipo === 'falla' ? '#FF4757' : '#00B4D8';
                    const prioColor = PRIO_COLOR[t.prioridad] ?? '#888';
                    return (
                      <div key={t.id} onClick={() => setSelectedId(t.odoo_id)}
                        style={{
                          background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10,
                          padding: '10px 12px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = stage.color + '50'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = theme.border}
                      >
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: tipoColor, borderRadius: '10px 10px 0 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 9, color: theme.dim }}>{t.id}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: `${prioColor}18`, color: prioColor }}>{t.prioridad.toUpperCase()}</span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, lineHeight: 1.3, marginBottom: 6 }}>{t.nombre}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {t.cliente && <span style={{ fontSize: 10, color: theme.dim }}>👤 {t.cliente}</span>}
                          {t.tecnico && <span style={{ fontSize: 10, color: theme.dim }}>🔧 {t.tecnico}</span>}
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: tipoColor }}>{t.tipo === 'falla' ? '🔴 Falla' : '⚡ Hab.'}</span>
                          <span style={{ fontSize: 9, color: theme.dim }}>{t.fecha_creacion?.slice(0, 10)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── VISTA CARRUSEL ── */}
      {viewMode === 'carousel' && (() => {
        if (filtered.length === 0) return (
          <div style={{ textAlign: 'center', padding: 60, color: theme.dim }}>Sin tickets en este filtro</div>
        );
        const idx = Math.min(carouselIdx, filtered.length - 1);
        const t   = filtered[idx];
        const tipoColor    = t.tipo === 'falla' ? '#FF4757' : '#00B4D8';
        const prioColor    = PRIO_COLOR[t.prioridad] ?? '#888';
        const currentStage = FS_STAGES[t.etapa_op_idx];

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            {/* Counter */}
            <div style={{ fontSize: 12, color: theme.dim }}>
              <span style={{ fontWeight: 800, color: theme.text }}>{idx + 1}</span> / {filtered.length}
            </div>

            {/* Card grande */}
            <div style={{
              width: '100%', maxWidth: 600,
              background: theme.card, borderRadius: 20,
              border: `1px solid ${tipoColor}30`,
              boxShadow: `0 0 40px ${tipoColor}10`,
              overflow: 'hidden', position: 'relative',
            }}>
              {/* Top color bar */}
              <div style={{ height: 5, background: `linear-gradient(90deg, ${tipoColor}, ${currentStage?.color ?? tipoColor})` }} />

              <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: tipoColor }}>
                        {t.tipo === 'falla' ? '🔴 FALLA' : '⚡ HABILITACIÓN'}
                      </span>
                      <span style={{ fontSize: 10, color: theme.dim }}>{t.id}</span>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: theme.text, lineHeight: 1.3, maxWidth: 420 }}>
                      {t.nombre}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 10,
                    background: `${prioColor}18`, color: prioColor, border: `1px solid ${prioColor}40`, flexShrink: 0 }}>
                    {t.prioridad.toUpperCase()}
                  </span>
                </div>

                {/* Cliente + técnico */}
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {t.cliente && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Cliente</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>👤 {t.cliente}</span>
                    </div>
                  )}
                  {t.tecnico && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Técnico</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>🔧 {t.tecnico}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Creado</span>
                    <span style={{ fontSize: 13, color: theme.text }}>📅 {t.fecha_creacion?.slice(0, 10)}</span>
                  </div>
                </div>

                {/* Flujo de etapas grande */}
                <div>
                  <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Progreso</div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {FS_STAGES.map((s, i) => (
                      <div key={s.idx} style={{ display: 'flex', alignItems: 'center', flex: i < FS_STAGES.length - 1 ? 1 : 0 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: t.etapa_op_idx >= s.idx ? s.color : 'rgba(255,255,255,0.06)',
                            boxShadow: t.etapa_op_idx === s.idx ? `0 0 16px ${s.color}80` : 'none',
                            border: t.etapa_op_idx === s.idx ? `2px solid ${s.color}` : `2px solid rgba(255,255,255,0.08)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: t.etapa_op_idx === s.idx ? 16 : 12,
                            transition: 'all 0.3s',
                          }}>
                            {t.etapa_op_idx >= s.idx ? s.icon : ''}
                          </div>
                          <span style={{
                            fontSize: 10, fontWeight: t.etapa_op_idx === s.idx ? 800 : 400,
                            color: t.etapa_op_idx === s.idx ? s.color : theme.dim,
                            whiteSpace: 'nowrap',
                          }}>{s.nombre}</span>
                        </div>
                        {i < FS_STAGES.length - 1 && (
                          <div style={{
                            flex: 1, height: 3, marginBottom: 22, borderRadius: 2,
                            background: t.etapa_op_idx > s.idx
                              ? `linear-gradient(90deg, ${s.color}, ${FS_STAGES[i+1].color})`
                              : 'rgba(255,255,255,0.06)',
                            transition: 'background 0.3s',
                          }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Etapa Odoo + botón detalle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 8,
                    background: `${currentStage?.color ?? '#888'}15`, color: currentStage?.color ?? theme.dim,
                    border: `1px solid ${currentStage?.color ?? '#888'}30` }}>
                    {t.etapa_odoo}
                  </span>
                  <button onClick={() => setSelectedId(t.odoo_id)} style={{
                    padding: '8px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: `${tipoColor}20`, color: tipoColor, fontWeight: 700, fontSize: 12,
                    boxShadow: `0 0 0 1px ${tipoColor}40`,
                  }}>
                    Ver detalle →
                  </button>
                </div>
              </div>
            </div>

            {/* Flechas navegación */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <button
                onClick={() => setCarousel(i => Math.max(0, i - 1))}
                disabled={idx === 0}
                style={{
                  width: 48, height: 48, borderRadius: '50%', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer',
                  background: idx === 0 ? 'rgba(255,255,255,0.04)' : `${theme.accent}20`,
                  color: idx === 0 ? theme.dim : theme.accent,
                  fontSize: 20, fontWeight: 700,
                  boxShadow: idx === 0 ? 'none' : `0 0 0 1px ${theme.accent}40`,
                  transition: 'all 0.15s',
                }}
              >←</button>

              {/* Dots */}
              <div style={{ display: 'flex', gap: 5 }}>
                {filtered.slice(Math.max(0, idx - 4), Math.min(filtered.length, idx + 5)).map((_, di) => {
                  const realIdx = Math.max(0, idx - 4) + di;
                  return (
                    <div key={realIdx} onClick={() => setCarousel(realIdx)} style={{
                      width: realIdx === idx ? 18 : 6, height: 6, borderRadius: 3,
                      background: realIdx === idx ? theme.accent : 'rgba(255,255,255,0.15)',
                      cursor: 'pointer', transition: 'all 0.2s',
                    }} />
                  );
                })}
              </div>

              <button
                onClick={() => setCarousel(i => Math.min(filtered.length - 1, i + 1))}
                disabled={idx === filtered.length - 1}
                style={{
                  width: 48, height: 48, borderRadius: '50%', border: 'none',
                  cursor: idx === filtered.length - 1 ? 'not-allowed' : 'pointer',
                  background: idx === filtered.length - 1 ? 'rgba(255,255,255,0.04)' : `${theme.accent}20`,
                  color: idx === filtered.length - 1 ? theme.dim : theme.accent,
                  fontSize: 20, fontWeight: 700,
                  boxShadow: idx === filtered.length - 1 ? 'none' : `0 0 0 1px ${theme.accent}40`,
                  transition: 'all 0.15s',
                }}
              >→</button>
            </div>
          </div>
        );
      })()}

      {/* Drawer — compartido en todas las vistas */}
      {selectedId !== null && (
        <TicketDrawer
          ticketId={selectedId}
          theme={theme}
          onClose={() => setSelectedId(null)}
          onUpdated={fetchData}
        />
      )}
    </div>
  );
}

// ── Matrix Background ─────────────────────────────────────────────────────────
function MatrixBackground() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.1, pointerEvents: 'none', zIndex: 0 }}>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'grid', gridTemplateColumns: 'repeat(30, 1fr)',
        fontFamily: 'monospace', fontSize: 12, color: '#00ff88', textShadow: '0 0 8px #00ff88',
        whiteSpace: 'nowrap', userSelect: 'none'
      }}>
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} style={{ 
            animation: `matrixFall ${15 + Math.random() * 25}s linear infinite`,
            animationDelay: `${-Math.random() * 25}s`,
            writingMode: 'vertical-rl',
            textAlign: 'center'
          }}>
            {Array.from({ length: 60 }).map(() => Math.random() > 0.5 ? '1' : '0').join(' ')}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes matrixFall {
          from { transform: translateY(-100%); }
          to { transform: translateY(100%); }
        }
      `}</style>
    </div>
  );
}

type WFMRole = 'comercial' | 'preventa' | 'almacen' | 'aprovisionamiento' | 'pm' | 'dispatch' | 'noc' | 'gerencia';
type DispatchTab = 'bidrillas' | 'checklist' | 'pruebas' | 'evidencias';

const ROLE_DATA: Record<WFMRole, { label: string; icon: string; color: string }> = {
  comercial:        { label: 'Comercial',        icon: '🤝', color: '#00C896' },
  preventa:         { label: 'Preventa',         icon: '🔍', color: '#4FC3F7' },
  almacen:          { label: 'Almacén',          icon: '📦', color: '#FFB703' },
  aprovisionamiento: { label: 'Aprovisionamiento',icon: '⚙️', color: '#A855F7' },
  pm:               { label: 'PM / Operaciones', icon: '📋', color: '#FF4757' },
  dispatch:         { label: 'Dispatch / Equipos',   icon: '🚛', color: '#00ff88' },
  noc:              { label: 'NOC',                  icon: '📡', color: '#00B4D8' },
  gerencia:         { label: 'Gerencia / KPIs',      icon: '📊', color: '#F97316' },
};

const STATE_LABEL: Record<WFMOrderState, string> = {
  SOLICITUD_PREVENTA:   'Solicitud Preventa',
  ANTEPROYECTO:         'Anteproyecto Listo',
  ORDEN_IMPLEMENTACION: 'Orden de Imp.',
  ALMACEN_VALIDACION:   'Validando Almacén',
  ESPERA_ALMACEN:       '⏸ Espera Almacén',
  ESPERA_INVENTARIO:    'Espera Inventario',
  APROVISIONAMIENTO:    'En Aprovisionamiento',
  REVISION_PM:          'Revisión Final PM',
  LISTO_INSTALACION:    'Listo p/ Instalación',
  INSTALACION:          'En Instalación',
  NOC_VALIDACION:       'Validación NOC',
  FACTURACION:          'Facturación ✓',
  BACKLOG:              'Backlog / Incidencia',
  CERRADO:              'Cerrado ✓',
};

const STATE_COLOR: Partial<Record<WFMOrderState, string>> = {
  CERRADO:        '#00C896',
  FACTURACION:    '#00C896',
  BACKLOG:        '#FF4757',
  INSTALACION:    '#FFB703',
  NOC_VALIDACION: '#00B4D8',
  ESPERA_ALMACEN: '#F97316',
};

// ── Components ───────────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}18`, color, border: `1px solid ${color}30`, textTransform: 'uppercase' }}>
      {label}
    </span>
  );
}

// ── KPIsPanel ─────────────────────────────────────────────────────────────────
interface KPIEtapa {
  horas: number | null; dias: number | null;
  sla_horas: number; sla_dias: number;
  estado: 'ok' | 'alerta' | 'excedido' | 'sin_datos';
  pct_sla: number | null;
}
interface KPIsGlobales {
  total_ordenes: number;
  por_estado: Record<string, number>;
  promedios_etapas: Record<string, { promedio_horas?: number; promedio_dias?: number; min_horas?: number; max_horas?: number; n: number; sla_horas?: number; pct_dentro_sla?: number }>;
  ordenes: Array<{ order_id: string; cliente: string; servicio: string; estado_actual: string; etapas: Record<string, KPIEtapa> }>;
  slas: Record<string, number>;
}

interface KPIsPanelProps { theme: ThemeConfig; order: WFMOrder | undefined; }

const ETAPA_META: Record<string, { label: string; color: string }> = {
  preventa:          { label: 'Preventa',          color: '#4FC3F7' },
  almacen:           { label: 'Almacén',           color: '#FFB703' },
  aprovisionamiento: { label: 'Aprovisionamiento', color: '#A855F7' },
  instalacion:       { label: 'Instalación',       color: '#00ff88' },
  noc:               { label: 'NOC',               color: '#00B4D8' },
  total:             { label: 'Total',             color: '#F97316' },
};

const ESTADO_COLOR_KPI: Record<string, string> = { ok: '#00C896', alerta: '#FFB703', excedido: '#FF4757', sin_datos: '#555' };

function KPIsPanel({ theme, order }: KPIsPanelProps) {
  const [globales, setGlobales]   = useState<KPIsGlobales | null>(null);
  const [ordenKpi, setOrdenKpi]   = useState<{ etapas: Record<string, KPIEtapa> } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [vista, setVista]         = useState<'global' | 'orden'>('global');
  const O = '#F97316';

  const fetchKpis = async () => {
    setLoading(true);
    try {
      const [gRes, oRes] = await Promise.all([
        fetch(`${API_BASE}/api/wfm/kpis`),
        order ? fetch(`${API_BASE}/api/wfm/kpis/${order.id}`) : Promise.resolve(null),
      ]);
      if (gRes.ok) setGlobales(await gRes.json());
      if (oRes?.ok) setOrdenKpi(await oRes.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchKpis(); }, [order?.id]);

  const EtapaBar = ({ etapa, data }: { etapa: string; data: KPIEtapa }) => {
    const meta = ETAPA_META[etapa];
    const color = ESTADO_COLOR_KPI[data.estado];
    const pct = Math.min(100, data.pct_sla ?? 0);
    const tiempoStr = data.horas != null
      ? data.dias! >= 1 ? `${data.dias!.toFixed(1)}d` : `${data.horas.toFixed(1)}h`
      : '—';
    const slaStr = data.sla_dias >= 1 ? `${data.sla_dias}d` : `${data.sla_horas}h`;

    return (
      <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${data.estado === 'sin_datos' ? theme.border : color + '30'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>{meta.label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color }}>{tiempoStr}</span>
            <span style={{ fontSize: 10, color: theme.dim }}>/ SLA {slaStr}</span>
            {data.estado !== 'sin_datos' && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: `${color}18`, color, border: `1px solid ${color}40` }}>
                {data.pct_sla}%
              </span>
            )}
          </div>
        </div>
        <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
        </div>
      </div>
    );
  };

  if (loading) return <div style={{ padding: 20, color: theme.dim, fontSize: 12 }}>Calculando KPIs...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ padding: 14, background: 'rgba(249,115,22,0.06)', borderRadius: 10, border: '1px solid rgba(249,115,22,0.2)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: O, marginBottom: 4 }}>📊 KPIs DE TIEMPO POR ETAPA — US-054–057</div>
        <div style={{ fontSize: 11, color: theme.dim }}>
          {globales?.total_ordenes ?? 0} órdenes totales · SLA: Preventa 5d · Almacén 2d · Apro 1d · Instalación 3d · NOC 1d · Total 15d
        </div>
      </div>

      {/* Tab vista */}
      <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 4, alignSelf: 'flex-start' }}>
        {(['global', 'orden'] as const).map(v => (
          <button key={v} onClick={() => setVista(v)} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', background: vista === v ? `${O}22` : 'transparent', color: vista === v ? O : theme.dim, fontSize: 11, fontWeight: vista === v ? 700 : 500, boxShadow: vista === v ? `0 0 0 1px ${O}40` : 'none' }}>
            {v === 'global' ? '📊 Global' : '🔍 Esta orden'}
          </button>
        ))}
      </div>

      {/* Vista global */}
      {vista === 'global' && globales && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Estado del pipeline */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>Pipeline de órdenes</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(globales.por_estado).sort((a,b) => b[1]-a[1]).map(([estado, n]) => (
                <div key={estado} style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: `1px solid ${STATE_COLOR[estado as WFMOrderState] ?? theme.border}30` }}>
                  <span style={{ fontSize: 10, color: STATE_COLOR[estado as WFMOrderState] ?? theme.dim, fontWeight: 700 }}>{n}</span>
                  <span style={{ fontSize: 10, color: theme.dim, marginLeft: 5 }}>{STATE_LABEL[estado as WFMOrderState] ?? estado}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Promedios por etapa */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>Tiempo promedio por etapa</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(ETAPA_META).map(([key, meta]) => {
                const d = globales.promedios_etapas[key];
                if (!d || d.n === 0) return (
                  <div key={key} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color }} /><span style={{ fontSize: 12 }}>{meta.label}</span></div>
                    <span style={{ fontSize: 11, color: theme.dim }}>Sin información registrada</span>
                  </div>
                );
                const pct_sla = d.pct_dentro_sla ?? 0;
                const color = pct_sla >= 80 ? '#00C896' : pct_sla >= 50 ? '#FFB703' : '#FF4757';
                const avgDias = (d.promedio_horas! / 24);
                return (
                  <div key={key} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${meta.color}20` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color }} />
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{meta.label}</span>
                        <span style={{ fontSize: 10, color: theme.dim }}>({d.n} órdenes)</span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: meta.color }}>{avgDias >= 1 ? `${avgDias.toFixed(1)}d` : `${d.promedio_horas!.toFixed(1)}h`} prom.</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: `${color}18`, color, border: `1px solid ${color}40` }}>{pct_sla}% en SLA</span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${pct_sla}%`, background: color, borderRadius: 2, transition: 'width 0.5s' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ fontSize: 9, color: theme.dim }}>Min: {(d.min_horas!/24).toFixed(1)}d</span>
                      <span style={{ fontSize: 9, color: theme.dim }}>SLA: {d.sla_horas!/24}d</span>
                      <span style={{ fontSize: 9, color: theme.dim }}>Max: {(d.max_horas!/24).toFixed(1)}d</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top órdenes más lentas */}
          {globales.ordenes.length > 0 && (() => {
            const conTotal = globales.ordenes.filter(o => o.etapas.total.horas != null).sort((a,b) => (b.etapas.total.horas ?? 0) - (a.etapas.total.horas ?? 0)).slice(0, 5);
            if (!conTotal.length) return null;
            return (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>Órdenes más antiguas</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {conTotal.map(o => {
                    const total = o.etapas.total;
                    const color = ESTADO_COLOR_KPI[total.estado];
                    return (
                      <div key={o.order_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: `1px solid ${color}20` }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700 }}>{o.cliente}</div>
                          <div style={{ fontSize: 10, color: theme.dim }}>{o.order_id} · {STATE_LABEL[o.estado_actual as WFMOrderState] ?? o.estado_actual}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color }}>{total.dias!.toFixed(1)}d</div>
                          <div style={{ fontSize: 9, color: theme.dim }}>SLA {total.sla_dias}d</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Vista orden individual */}
      {vista === 'orden' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!order && <div style={{ color: theme.dim, fontSize: 12 }}>Selecciona una orden en la lista.</div>}
          {order && !ordenKpi && <div style={{ color: theme.dim, fontSize: 12 }}>No hay KPIs registrados para esta orden.</div>}
          {order && ordenKpi && (
            <>
              <div style={{ fontSize: 12, color: theme.dim, marginBottom: 4 }}>{order.cliente} · {order.id}</div>
              {Object.entries(ETAPA_META).map(([key]) => (
                <EtapaBar key={key} etapa={key} data={ordenKpi.etapas[key]} />
              ))}
            </>
          )}
        </div>
      )}

      <button onClick={fetchKpis} style={{ alignSelf: 'flex-end', padding: '6px 14px', background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.dim, fontSize: 11, cursor: 'pointer' }}>
        🔄 Recalcular
      </button>
    </div>
  );
}

// ── NocValidacionPanel ────────────────────────────────────────────────────────
interface NocPanelProps { theme: ThemeConfig; order: WFMOrder | undefined; onRefresh: () => void; }

const HERRAMIENTAS_NOC = ['Zabbix', 'PRTG', 'Nagios', 'LibreNMS', 'Otro'];
const GRUPOS_ALERTA_DEFAULT = ['Caída de host', 'Alta latencia', 'Pérdida de paquetes', 'Uso de ancho de banda'];

function NocValidacionPanel({ theme, order, onRefresh }: NocPanelProps) {
  const [noc, setNoc] = useState(order?.noc ?? null);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState<string | null>(null);
  const [errMsg, setErrMsg]     = useState('');
  const showErr = (msg: string) => { setErrMsg(msg); setTimeout(() => setErrMsg(''), 5000); };

  // Ping form
  const [ipDestino, setIpDestino]   = useState(order?.aprovisionamiento?.gateway ?? '');
  const [pingOk, setPingOk]         = useState<boolean | null>(null);
  const [latenciaNoc, setLatenciaNoc] = useState('');

  // Alta monitoreo form
  const [herramienta, setHerramienta] = useState('Zabbix');
  const [hostId, setHostId]           = useState('');
  const [grupos, setGrupos]           = useState<string[]>([...GRUPOS_ALERTA_DEFAULT]);

  // Aprobación
  const [observaciones, setObservaciones] = useState('');

  const N = '#00B4D8';

  const fetchNoc = async () => {
    if (!order) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/noc/${order.id}`);
      if (res.ok) setNoc(await res.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchNoc(); }, [order?.id]);

  const handlePing = async () => {
    if (!order || pingOk === null || !latenciaNoc) return;
    setSaving('ping');
    try {
      const res = await fetch(`${API_BASE}/api/wfm/noc/ping`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, ping_ok: pingOk, latencia_ms: parseFloat(latenciaNoc), ip_destino: ipDestino, usuario: 'NOC' }),
      });
      if (res.ok) { await fetchNoc(); onRefresh(); }
    } finally { setSaving(null); }
  };

  const handleAlta = async () => {
    if (!order || !hostId) return;
    setSaving('alta');
    try {
      const res = await fetch(`${API_BASE}/api/wfm/noc/alta-monitoreo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, herramienta, host_id: hostId, grupos_alerta: grupos, usuario: 'NOC' }),
      });
      if (res.ok) { await fetchNoc(); onRefresh(); }
    } finally { setSaving(null); }
  };

  const handleAprobar = async () => {
    if (!order) return;
    setSaving('aprobar');
    try {
      const res = await fetch(`${API_BASE}/api/wfm/noc/aprobar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, observaciones, usuario: 'Supervisor NOC' }),
      });
      if (res.ok) { await fetchNoc(); onRefresh(); }
      else { const e = await res.json(); showErr(e.detail ?? 'Error'); }
    } finally { setSaving(null); }
  };

  const toggleGrupo = (g: string) =>
    setGrupos(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const inputStyle = { width: '100%', padding: '8px 10px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 12, boxSizing: 'border-box' as const };

  const Step = ({ num, title, done, active }: { num: number; title: string; done: boolean; active: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 8, background: done ? 'rgba(0,180,216,0.08)' : active ? 'rgba(255,255,255,0.04)' : 'transparent', border: `1px solid ${done ? N + '40' : active ? theme.border : 'transparent'}` }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: done ? N : active ? 'rgba(255,255,255,0.1)' : 'transparent', border: `2px solid ${done ? N : theme.dim}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: done ? '#000' : theme.dim, flexShrink: 0 }}>
        {done ? '✓' : num}
      </div>
      <span style={{ fontSize: 12, fontWeight: done ? 700 : 500, color: done ? N : active ? theme.text : theme.dim }}>{title}</span>
    </div>
  );

  if (!order) return <div style={{ color: theme.dim, fontSize: 13 }}>Selecciona una orden.</div>;

  const step1Done = noc?.ping_ok === true;
  const step2Done = noc?.dado_de_alta === true;
  const step3Done = noc?.aprobado === true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ padding: 14, background: 'rgba(0,180,216,0.06)', borderRadius: 10, border: `1px solid rgba(0,180,216,0.2)` }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: N, marginBottom: 4 }}>📡 FLUJO NOC — US-047 a 050</div>
        <div style={{ fontSize: 11, color: theme.dim }}>Validación conectividad · Alta en monitoreo · Configuración alertas · Aprobación</div>
      </div>

      {/* Progreso visual */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Step num={1} title="US-047 · Validar conectividad (ping)" done={step1Done} active={!step1Done} />
        <Step num={2} title="US-048–049 · Alta en monitoreo + alertas" done={step2Done} active={step1Done && !step2Done} />
        <Step num={3} title="US-050 · Aprobar — listo para facturación" done={step3Done} active={step2Done && !step3Done} />
      </div>

      {/* Estado final */}
      {step3Done && (
        <div style={{ padding: 14, borderRadius: 10, background: 'rgba(0,200,150,0.1)', border: '1px solid #00C89640', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#00C896' }}>✅ APROBADO POR NOC</div>
          <div style={{ fontSize: 11, color: theme.dim, marginTop: 4 }}>Host: {noc?.host_id} · {noc?.herramienta_monitoreo} · {noc?.aprobado_por}</div>
          {noc?.observaciones && <div style={{ fontSize: 11, color: theme.dim, marginTop: 4, fontStyle: 'italic' }}>"{noc.observaciones}"</div>}
        </div>
      )}

      {/* PASO 1: Ping */}
      {!step1Done && (
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: N, marginBottom: 12 }}>Paso 1 · Validación de conectividad</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>IP de destino</div>
              <input style={inputStyle} placeholder="ej. 200.1.2.1" value={ipDestino} onChange={e => setIpDestino(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Latencia medida (ms)</div>
              <input style={inputStyle} type="number" placeholder="ej. 15" value={latenciaNoc} onChange={e => setLatenciaNoc(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[true, false].map(v => (
              <button key={String(v)} onClick={() => setPingOk(v)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${pingOk === v ? (v ? '#00C896' : '#FF4757') : theme.border}`, background: pingOk === v ? (v ? 'rgba(0,200,150,0.12)' : 'rgba(255,71,87,0.12)') : 'transparent', color: pingOk === v ? (v ? '#00C896' : '#FF4757') : theme.dim, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
                {v ? '✅ Ping exitoso' : '❌ Ping fallido'}
              </button>
            ))}
          </div>
          <button disabled={pingOk === null || !latenciaNoc || saving === 'ping'} onClick={handlePing}
            style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', background: N, color: '#000', fontWeight: 800, cursor: 'pointer', opacity: pingOk === null ? 0.5 : 1 }}>
            {saving === 'ping' ? 'Registrando...' : 'REGISTRAR PING'}
          </button>
        </div>
      )}

      {/* Resultado ping */}
      {step1Done && (
        <div style={{ padding: 12, borderRadius: 8, background: noc?.ping_ok ? 'rgba(0,200,150,0.08)' : 'rgba(255,71,87,0.08)', border: `1px solid ${noc?.ping_ok ? '#00C89640' : '#FF475740'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: noc?.ping_ok ? '#00C896' : '#FF4757' }}>
            {noc?.ping_ok ? '✅' : '❌'} Ping → {noc?.ip_destino}
          </span>
          <span style={{ fontSize: 12, color: theme.dim }}>{noc?.latencia_ms}ms</span>
        </div>
      )}

      {/* PASO 2: Alta en monitoreo */}
      {step1Done && !step2Done && (
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: N, marginBottom: 12 }}>Paso 2 · Alta en monitoreo y alertas</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Herramienta</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {HERRAMIENTAS_NOC.map(h => (
                  <button key={h} onClick={() => setHerramienta(h)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${herramienta === h ? N : theme.border}`, background: herramienta === h ? `${N}18` : 'transparent', color: herramienta === h ? N : theme.dim, fontSize: 10, cursor: 'pointer', fontWeight: herramienta === h ? 700 : 400 }}>
                    {h}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Host ID / Nombre en {herramienta}</div>
              <input style={inputStyle} placeholder="ej. cliente-fw01" value={hostId} onChange={e => setHostId(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 6 }}>Grupos de alerta configurados</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {GRUPOS_ALERTA_DEFAULT.map(g => (
                <button key={g} onClick={() => toggleGrupo(g)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${grupos.includes(g) ? N : theme.border}`, background: grupos.includes(g) ? `${N}18` : 'transparent', color: grupos.includes(g) ? N : theme.dim, fontSize: 10, cursor: 'pointer' }}>
                  {grupos.includes(g) ? '✓ ' : ''}{g}
                </button>
              ))}
            </div>
          </div>
          <button disabled={!hostId || saving === 'alta'} onClick={handleAlta}
            style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', background: N, color: '#000', fontWeight: 800, cursor: 'pointer', opacity: !hostId ? 0.5 : 1 }}>
            {saving === 'alta' ? 'Registrando...' : 'DAR DE ALTA EN MONITOREO'}
          </button>
        </div>
      )}

      {/* Resultado alta */}
      {step2Done && (
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(0,180,216,0.08)', border: '1px solid rgba(0,180,216,0.3)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: N, marginBottom: 6 }}>📡 En monitoreo: {noc?.herramienta_monitoreo} · {noc?.host_id}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(noc?.grupos_alerta ?? []).map(g => (
              <span key={g} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: `${N}18`, color: N, border: `1px solid ${N}40` }}>{g}</span>
            ))}
          </div>
        </div>
      )}

      {/* PASO 3: Aprobar */}
      {step2Done && !step3Done && (
        <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${theme.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: N, marginBottom: 12 }}>Paso 3 · Confirmar monitoreo activo</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Observaciones</div>
            <textarea style={{ ...inputStyle, height: 60, resize: 'none' } as React.CSSProperties}
              placeholder="Todo en orden, equipo visible y alertas activas..."
              value={observaciones} onChange={e => setObservaciones(e.target.value)} />
          </div>
          <button disabled={saving === 'aprobar'} onClick={handleAprobar}
            style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: '#00C896', color: '#000', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            {saving === 'aprobar' ? 'Aprobando...' : '✅ APROBAR — LISTO PARA FACTURACIÓN'}
          </button>
        </div>
      )}

      {loading && <div style={{ fontSize: 11, color: theme.dim }}>Cargando estado NOC...</div>}
    </div>
  );
}

// ── AprovisionamientoPanel ────────────────────────────────────────────────────
interface AproProps { theme: ThemeConfig; order: WFMOrder | undefined; onRefresh: () => void; }

function AprovisionamientoPanel({ theme, order, onRefresh }: AproProps) {
  const apro = order?.aprovisionamiento;
  const [form, setForm] = useState({
    vlan: apro?.vlan?.toString() ?? '',
    bw_mbps: apro?.bw_mbps?.toString() ?? '',
    ip_wan: apro?.ip_wan ?? '',
    gateway: apro?.gateway ?? '',
    firmware: apro?.firmware ?? '',
    mac_address: apro?.mac_address ?? '',
    notas_config: apro?.notas_config ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const showErr = (msg: string) => { setErrMsg(msg); setTimeout(() => setErrMsg(''), 5000); };

  if (!order) return <div style={{ color: theme.dim, fontSize: 13 }}>Selecciona una orden.</div>;

  const listo = apro?.listo;
  const inputStyle = { width: '100%', padding: '8px 10px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 12, boxSizing: 'border-box' as const };
  const P = '#A855F7';

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const body: Record<string, any> = { order_id: order.id, usuario: 'Ing. Aprovisionamiento' };
      if (form.vlan)        body.vlan        = parseInt(form.vlan);
      if (form.bw_mbps)     body.bw_mbps     = parseInt(form.bw_mbps);
      if (form.ip_wan)      body.ip_wan      = form.ip_wan;
      if (form.gateway)     body.gateway     = form.gateway;
      if (form.firmware)    body.firmware    = form.firmware;
      if (form.mac_address) body.mac_address = form.mac_address;
      if (form.notas_config)body.notas_config= form.notas_config;
      const res = await fetch(`${API_BASE}/api/wfm/aprovisionamiento/registrar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) onRefresh();
      else { const e = await res.json(); showErr(e.detail ?? 'Error'); }
    } finally { setSaving(false); }
  };

  const Field = ({ label, field, placeholder, type = 'text' }: { label: string; field: keyof typeof form; placeholder: string; type?: string }) => (
    <div>
      <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>{label}</div>
      <input style={inputStyle} type={type} placeholder={placeholder}
        value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ padding: 14, background: 'rgba(168,85,247,0.06)', borderRadius: 10, border: '1px solid rgba(168,85,247,0.2)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: P, marginBottom: 4 }}>⚙️ APROVISIONAMIENTO LÓGICO — HU-07</div>
        <div style={{ fontSize: 11, color: theme.dim }}>Registra parámetros de red, firmware y dirección MAC del equipo</div>
      </div>

      {/* Estado actual si ya está aprovisionado */}
      {listo && (
        <div style={{ padding: 14, borderRadius: 10, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.3)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: P, marginBottom: 10 }}>✓ Aprovisionado — {apro?.aprovisionado_por} · {apro?.fecha_aprovisionamiento?.split('T')[0]}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {[
              ['VLAN',     apro?.vlan],
              ['BW',       apro?.bw_mbps ? `${apro.bw_mbps} Mbps` : null],
              ['IP WAN',   apro?.ip_wan],
              ['Gateway',  apro?.gateway],
              ['Firmware', apro?.firmware],
              ['MAC',      apro?.mac_address],
            ].filter(([, v]) => v).map(([label, val]) => (
              <div key={label as string} style={{ padding: 10, background: theme.bg, borderRadius: 8, border: `1px solid ${theme.border}` }}>
                <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase' }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{String(val)}</div>
              </div>
            ))}
          </div>
          {apro?.notas_config && (
            <div style={{ marginTop: 10, fontSize: 11, color: theme.dim, fontStyle: 'italic' }}>"{apro.notas_config}"</div>
          )}
        </div>
      )}

      {/* Formulario */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, textTransform: 'uppercase' }}>Parámetros de red</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="VLAN"        field="vlan"    placeholder="ej. 4022"       type="number" />
          <Field label="BW (Mbps)"   field="bw_mbps" placeholder="ej. 1000"       type="number" />
          <Field label="IP WAN"      field="ip_wan"  placeholder="ej. 200.1.2.3"              />
          <Field label="Gateway"     field="gateway" placeholder="ej. 200.1.2.1"              />
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, textTransform: 'uppercase', marginTop: 4 }}>Identificación del equipo (HU-07)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Versión de firmware</div>
            <input style={{ ...inputStyle, borderColor: form.firmware ? '#A855F7' : undefined }}
              placeholder="ej. RouterOS 7.14.3"
              value={form.firmware} onChange={e => setForm(f => ({ ...f, firmware: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Dirección MAC</div>
            <input style={{ ...inputStyle, borderColor: form.mac_address ? '#A855F7' : undefined, fontFamily: 'monospace' }}
              placeholder="ej. DC:2C:6E:A1:B2:C3"
              value={form.mac_address}
              onChange={e => {
                // Auto-formato XX:XX:XX:XX:XX:XX
                const raw = e.target.value.replace(/[^a-fA-F0-9]/g, '').toUpperCase().slice(0, 12);
                const mac = raw.match(/.{1,2}/g)?.join(':') ?? raw;
                setForm(f => ({ ...f, mac_address: mac }));
              }} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Notas de configuración</div>
          <textarea style={{ ...inputStyle, height: 60, resize: 'none' } as React.CSSProperties}
            placeholder="Parámetros adicionales, observaciones..."
            value={form.notas_config} onChange={e => setForm(f => ({ ...f, notas_config: e.target.value }))} />
        </div>
      </div>

      {/* Indicadores de campos críticos */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['Firmware', !!form.firmware], ['MAC', !!form.mac_address], ['VLAN', !!form.vlan], ['BW', !!form.bw_mbps]].map(([label, ok]) => (
          <div key={label as string} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ok ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.04)', color: ok ? P : theme.dim, border: `1px solid ${ok ? P + '40' : theme.border}` }}>
            {ok ? '✓' : '○'} {label}
          </div>
        ))}
      </div>

      <button
        disabled={saving}
        onClick={handleSubmit}
        style={{ padding: 12, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer', background: P, color: '#fff', transition: 'opacity 0.2s', opacity: saving ? 0.6 : 1 }}>
        {saving ? 'Guardando...' : listo ? '⚙️ ACTUALIZAR APROVISIONAMIENTO' : '⚙️ REGISTRAR APROVISIONAMIENTO'}
      </button>
    </div>
  );
}

// ── AlmacenPanel ─────────────────────────────────────────────────────────────
interface AlmacenPanelProps { theme: ThemeConfig; order: WFMOrder | undefined; onRefresh: () => void; }

function AlmacenPanel({ theme, order, onRefresh }: AlmacenPanelProps) {
  const [respuesta, setRespuesta] = useState<'disponible' | 'no_disponible' | 'disponible_en_fecha' | null>(null);
  const [motivo, setMotivo]         = useState('');
  const [fecha, setFecha]           = useState('');
  const [modelo, setModelo]         = useState('');
  const [serie, setSerie]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [showDetener, setShowDetener] = useState(false);
  const [motivoDetener, setMotivoDetener] = useState('');
  const [savingDetener, setSavingDetener] = useState(false);
  const [errMsg, setErrMsg]         = useState('');
  const showErr = (msg: string) => { setErrMsg(msg); setTimeout(() => setErrMsg(''), 5000); };

  if (!order) return <div style={{ color: theme.dim, fontSize: 13 }}>Selecciona una orden.</div>;

  const yaRespondio = order.almacen?.respuesta;
  const OPCIONES = [
    { id: 'disponible',          label: 'Disponible',              color: '#00C896', icon: '✅', desc: 'Equipo listo para despachar' },
    { id: 'no_disponible',       label: 'No disponible',           color: '#FF4757', icon: '❌', desc: 'Sin stock — pasa a Backlog'  },
    { id: 'disponible_en_fecha', label: 'Disponible en fecha',     color: '#FFB703', icon: '📅', desc: 'Hay stock confirmado en fecha futura' },
  ] as const;

  const handleEnviar = async () => {
    if (!respuesta) return;
    setSaving(true);
    const equipos = modelo && serie ? [{ modelo, sn: serie }] : [];
    try {
      const res = await fetch(`${API_BASE}/api/wfm/almacen/responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, respuesta, equipos, fecha_estimada: fecha || null, motivo, usuario: 'Jefe Almacén' }),
      });
      if (res.ok) { onRefresh(); }
      else { const e = await res.json(); showErr(e.detail ?? 'Error'); }
    } finally { setSaving(false); }
  };

  const inputStyle = { width: '100%', padding: '8px 10px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 12, boxSizing: 'border-box' as const };

  const handleDetener = async () => {
    if (!motivoDetener.trim()) return;
    setSavingDetener(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/almacen/espera`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, motivo: motivoDetener, responsable_almacen: 'Jefe Almacén', usuario: 'Jefe Almacén' }),
      });
      if (res.ok) { setShowDetener(false); setMotivoDetener(''); onRefresh(); }
      else { const e = await res.json(); showErr(e.detail ?? 'Error'); }
    } finally { setSavingDetener(false); }
  };

  const handleLiberar = async () => {
    setSavingDetener(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/almacen/liberar/${order.id}?usuario=Jefe+Almacén`, { method: 'POST' });
      if (res.ok) { onRefresh(); }
      else { const e = await res.json(); showErr(e.detail ?? 'Error'); }
    } finally { setSavingDetener(false); }
  };

  const esDetenido = order.estado === 'ESPERA_ALMACEN';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {errMsg && <div style={{ padding: '8px 12px', background: '#FF475720', border: '1px solid #FF475760', borderRadius: 8, fontSize: 12, color: '#FF4757' }}>{errMsg}</div>}
      {/* Banner ESPERA_ALMACEN si ya está detenido */}
      {esDetenido && (
        <div style={{ padding: 14, background: 'rgba(249,115,22,0.1)', borderRadius: 10, border: '2px solid rgba(249,115,22,0.4)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#F97316', marginBottom: 6 }}>⏸ CASO DETENIDO POR ALMACÉN</div>
          {order.almacen?.motivo && <div style={{ fontSize: 12, color: theme.text, marginBottom: 4 }}>Motivo: <b>{order.almacen.motivo}</b></div>}
          {order.almacen?.respondido_por && <div style={{ fontSize: 11, color: theme.dim }}>Registrado por: {order.almacen.respondido_por}</div>}
          {order.almacen?.fecha_respuesta && <div style={{ fontSize: 11, color: theme.dim }}>Fecha: {order.almacen.fecha_respuesta.slice(0,10)}</div>}
          <button
            onClick={handleLiberar}
            disabled={savingDetener}
            style={{ marginTop: 12, width: '100%', padding: 10, borderRadius: 8, border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer', background: '#00C896', color: '#000' }}>
            {savingDetener ? 'Liberando...' : '✅ Equipo disponible — Liberar caso'}
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: 14, background: 'rgba(255,183,3,0.06)', borderRadius: 10, border: '1px solid rgba(255,183,3,0.2)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#FFB703', marginBottom: 4 }}>📦 RESPUESTA DE ALMACÉN — HU-05</div>
        <div style={{ fontSize: 11, color: theme.dim }}>Indica disponibilidad de equipos para esta orden</div>
      </div>

      {/* Respuesta previa */}
      {yaRespondio && (() => {
        const op = OPCIONES.find(o => o.id === yaRespondio);
        return (
          <div style={{ padding: 14, borderRadius: 10, background: `${op?.color}10`, border: `1px solid ${op?.color}40` }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: op?.color }}>{op?.icon} Respuesta registrada: {op?.label}</div>
            {order.almacen.fecha_estimada && <div style={{ fontSize: 11, color: theme.dim, marginTop: 4 }}>Fecha estimada: {order.almacen.fecha_estimada}</div>}
            {order.almacen.motivo        && <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>Motivo: {order.almacen.motivo}</div>}
            {order.almacen.respondido_por && <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>Por: {order.almacen.respondido_por}</div>}
          </div>
        );
      })()}

      {/* Selector de respuesta */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>Disponibilidad de equipos</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {OPCIONES.map(op => (
            <button key={op.id} onClick={() => setRespuesta(op.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 10, border: `1px solid ${respuesta === op.id ? op.color : theme.border}`, background: respuesta === op.id ? `${op.color}12` : 'rgba(255,255,255,0.02)', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 20 }}>{op.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: respuesta === op.id ? op.color : theme.text }}>{op.label}</div>
                <div style={{ fontSize: 11, color: theme.dim }}>{op.desc}</div>
              </div>
              {respuesta === op.id && <span style={{ marginLeft: 'auto', fontSize: 14, color: op.color }}>●</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Campos contextuales */}
      {respuesta === 'disponible' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Modelo del equipo</div>
            <input style={inputStyle} placeholder="ej. Mikrotik CCR2004" value={modelo} onChange={e => setModelo(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Número de serie</div>
            <input style={inputStyle} placeholder="ej. SN-2026-X123" value={serie} onChange={e => setSerie(e.target.value)} />
          </div>
        </div>
      )}

      {respuesta === 'disponible_en_fecha' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Fecha estimada de llegada</div>
            <input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Modelo esperado</div>
            <input style={inputStyle} placeholder="ej. Mikrotik CCR2004" value={modelo} onChange={e => setModelo(e.target.value)} />
          </div>
        </div>
      )}

      {(respuesta === 'no_disponible' || respuesta === 'disponible_en_fecha') && (
        <div>
          <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Motivo / Observaciones</div>
          <input style={inputStyle} placeholder="ej. Proveedor sin stock hasta próximo mes" value={motivo} onChange={e => setMotivo(e.target.value)} />
        </div>
      )}

      {/* Botón enviar */}
      <button
        disabled={!respuesta || saving}
        onClick={handleEnviar}
        style={{ padding: 12, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13, cursor: respuesta ? 'pointer' : 'not-allowed', background: respuesta ? '#FFB703' : 'rgba(255,255,255,0.06)', color: respuesta ? '#000' : theme.dim, transition: 'all 0.2s' }}>
        {saving ? 'Enviando...' : respuesta ? `📦 REGISTRAR RESPUESTA` : 'Selecciona disponibilidad'}
      </button>

      {/* Separador */}
      <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 16 }}>
        {!esDetenido && !showDetener && (
          <button
            onClick={() => setShowDetener(true)}
            style={{ width: '100%', padding: 11, borderRadius: 10, border: `1px solid rgba(249,115,22,0.4)`, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: 'rgba(249,115,22,0.08)', color: '#F97316', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            ⏸ Detener por Almacén
          </button>
        )}

        {!esDetenido && showDetener && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#F97316', textTransform: 'uppercase' }}>
              ⏸ Motivo del bloqueo
            </div>
            <input
              style={{ ...inputStyle, border: '1px solid rgba(249,115,22,0.5)' }}
              placeholder="ej. Sin stock de antena Ubiquiti PowerBeam — proveedor sin fecha"
              value={motivoDetener}
              onChange={e => setMotivoDetener(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                onClick={() => { setShowDetener(false); setMotivoDetener(''); }}
                style={{ padding: 9, borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.dim, fontSize: 12, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button
                onClick={handleDetener}
                disabled={!motivoDetener.trim() || savingDetener}
                style={{ padding: 9, borderRadius: 8, border: 'none', fontWeight: 800, fontSize: 12, cursor: motivoDetener.trim() ? 'pointer' : 'not-allowed', background: motivoDetener.trim() ? '#F97316' : 'rgba(255,255,255,0.06)', color: motivoDetener.trim() ? '#fff' : theme.dim }}>
                {savingDetener ? 'Guardando...' : '⏸ Confirmar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PruebasVelocidadPanel ─────────────────────────────────────────────────────
type PruebaVelocidad = NonNullable<WFMOrder['pruebas_velocidad']>[number];

interface PruebasProps { theme: ThemeConfig; order: WFMOrder; onRefresh: () => void; }

function PruebasVelocidadPanel({ theme, order, onRefresh }: PruebasProps) {
  const [pruebas, setPruebas] = useState<PruebaVelocidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [form, setForm] = useState({
    bw_contratado_mbps: '',
    descarga_mbps: '',
    subida_mbps: '',
    latencia_ms: '',
    perdida_pct: '0',
    servidor: 'SRV-MTY',
    herramienta: 'iPerf3',
  });

  const fetchPruebas = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/instalacion/pruebas-velocidad/${order.id}`);
      if (res.ok) setPruebas(await res.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchPruebas(); }, [order.id]);

  const handleSubmit = async () => {
    const bw = parseFloat(form.bw_contratado_mbps);
    if (!bw || !form.descarga_mbps || !form.subida_mbps || !form.latencia_ms) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/instalacion/prueba-velocidad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          bw_contratado_mbps: bw,
          descarga_mbps: parseFloat(form.descarga_mbps),
          subida_mbps:   parseFloat(form.subida_mbps),
          latencia_ms:   parseFloat(form.latencia_ms),
          perdida_pct:   parseFloat(form.perdida_pct) || 0,
          servidor: form.servidor,
          herramienta: form.herramienta,
          usuario: 'Técnico',
        })
      });
      if (res.ok) {
        await fetchPruebas();
        onRefresh();
        setForm(f => ({ ...f, descarga_mbps: '', subida_mbps: '', latencia_ms: '', perdida_pct: '0' }));
      }
    } finally { setSaving(false); }
  };

  const lastPrueba = pruebas[pruebas.length - 1];

  const Gauge = ({ label, value, max, unit, ok }: { label: string; value: number; max: number; unit: string; ok: boolean }) => {
    const pct = Math.min(100, Math.round((value / max) * 100));
    const color = ok ? '#00C896' : '#FF4757';
    return (
      <div style={{ flex: 1, padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: `1px solid ${ok ? '#00C89630' : '#FF475730'}` }}>
        <div style={{ fontSize: 10, color: theme.dim, marginBottom: 6, textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color, marginBottom: 8 }}>{value}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>{unit}</span></div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ fontSize: 10, color, marginTop: 4, fontWeight: 700 }}>{ok ? '✓ OK' : '✗ FUERA DE RANGO'}</div>
      </div>
    );
  };

  const inputStyle = {
    width: '100%', padding: '8px 10px', background: theme.bg,
    border: `1px solid ${theme.border}`, borderRadius: 8,
    color: theme.text, fontSize: 12, boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ padding: 14, background: 'rgba(0,180,216,0.06)', borderRadius: 10, border: '1px solid rgba(0,180,216,0.2)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#00B4D8', marginBottom: 4 }}>📡 PRUEBAS DE VELOCIDAD Y LATENCIA — US-038–040</div>
        <div style={{ fontSize: 11, color: theme.dim }}>Criterios: ↓↑ ≥ 90% del BW contratado · Latencia ≤ 50ms · Pérdida ≤ 1%</div>
      </div>

      {/* Última prueba — gauges */}
      {lastPrueba && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim }}>
            Última prueba — {lastPrueba.fecha.split('T')[0]} {lastPrueba.fecha.split('T')[1]?.substring(0,5)} · {lastPrueba.herramienta} · {lastPrueba.servidor}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Gauge label="Descarga" value={lastPrueba.descarga_mbps} max={lastPrueba.bw_contratado_mbps} unit="Mbps" ok={lastPrueba.resultados.ok_descarga} />
            <Gauge label="Subida"   value={lastPrueba.subida_mbps}   max={lastPrueba.bw_contratado_mbps} unit="Mbps" ok={lastPrueba.resultados.ok_subida} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Gauge label="Latencia"    value={lastPrueba.latencia_ms} max={100} unit="ms"  ok={lastPrueba.resultados.ok_latencia} />
            <Gauge label="Pérdida pkt" value={lastPrueba.perdida_pct} max={5}   unit="%"   ok={lastPrueba.resultados.ok_perdida} />
          </div>
          <div style={{
            padding: 12, borderRadius: 10, textAlign: 'center', fontWeight: 800, fontSize: 14,
            background: lastPrueba.resultados.aprobada ? 'rgba(0,200,150,0.1)' : 'rgba(255,71,87,0.1)',
            color: lastPrueba.resultados.aprobada ? '#00C896' : '#FF4757',
            border: `1px solid ${lastPrueba.resultados.aprobada ? '#00C89640' : '#FF475740'}`,
          }}>
            {lastPrueba.resultados.aprobada ? '✅ PRUEBA APROBADA' : '❌ PRUEBA FALLIDA — Requiere revisión'}
          </div>
        </div>
      )}

      {/* Formulario nueva prueba */}
      <div style={{ padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${theme.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>+ Registrar nueva prueba</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>BW Contratado (Mbps)</div>
            <input style={inputStyle} type="number" placeholder="ej. 1000"
              value={form.bw_contratado_mbps} onChange={e => setForm(f => ({ ...f, bw_contratado_mbps: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Descarga (Mbps)</div>
            <input style={inputStyle} type="number" placeholder="ej. 945"
              value={form.descarga_mbps} onChange={e => setForm(f => ({ ...f, descarga_mbps: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Subida (Mbps)</div>
            <input style={inputStyle} type="number" placeholder="ej. 932"
              value={form.subida_mbps} onChange={e => setForm(f => ({ ...f, subida_mbps: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Latencia (ms)</div>
            <input style={inputStyle} type="number" placeholder="ej. 12"
              value={form.latencia_ms} onChange={e => setForm(f => ({ ...f, latencia_ms: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Pérdida paquetes (%)</div>
            <input style={inputStyle} type="number" placeholder="0"
              value={form.perdida_pct} onChange={e => setForm(f => ({ ...f, perdida_pct: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Servidor de prueba</div>
            <input style={inputStyle} placeholder="SRV-MTY"
              value={form.servidor} onChange={e => setForm(f => ({ ...f, servidor: e.target.value }))} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: theme.dim, marginBottom: 4 }}>Herramienta</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['iPerf3', 'Speedtest CLI', 'Manual'].map(h => (
              <button key={h} onClick={() => setForm(f => ({ ...f, herramienta: h }))}
                style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${form.herramienta === h ? '#00B4D8' : theme.border}`, background: form.herramienta === h ? 'rgba(0,180,216,0.12)' : 'transparent', color: form.herramienta === h ? '#00B4D8' : theme.dim, fontSize: 11, cursor: 'pointer', fontWeight: form.herramienta === h ? 700 : 400 }}>
                {h}
              </button>
            ))}
          </div>
        </div>
        <button
          disabled={saving || !form.bw_contratado_mbps || !form.descarga_mbps || !form.subida_mbps || !form.latencia_ms}
          onClick={handleSubmit}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: 'none', background: '#00B4D8', color: '#000', fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Registrando...' : '📡 REGISTRAR PRUEBA'}
        </button>
      </div>

      {/* Historial */}
      {pruebas.length > 1 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, marginBottom: 8 }}>Historial de pruebas</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...pruebas].reverse().slice(1).map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: `1px solid ${p.resultados.aprobada ? '#00C89620' : '#FF475720'}` }}>
                <div>
                  <span style={{ fontSize: 10, color: theme.dim }}>{p.fecha.split('T')[0]} {p.fecha.split('T')[1]?.substring(0,5)}</span>
                  <span style={{ fontSize: 11, marginLeft: 10 }}>↓{p.descarga_mbps} ↑{p.subida_mbps} Mbps · {p.latencia_ms}ms</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: p.resultados.aprobada ? '#00C896' : '#FF4757' }}>
                  {p.resultados.aprobada ? '✓' : '✗'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && pruebas.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: theme.dim, fontSize: 12 }}>
          Sin pruebas registradas para esta orden
        </div>
      )}
    </div>
  );
}

// ── ChecklistPanel ───────────────────────────────────────────────────────────
type ChecklistItem = NonNullable<WFMOrder['checklist']>[number];

interface ChecklistPanelProps {
  theme: ThemeConfig;
  order: WFMOrder;
  onRefresh: () => void;
}

const CATEGORIA_COLORS: Record<string, string> = {
  'Sitio': '#FFB703',
  'Cableado': '#4FC3F7',
  'Equipo': '#A855F7',
  'Conectividad': '#00C896',
  'NOC': '#00B4D8',
  'Cliente': '#F97316',
  'Limpieza': '#00ff88',
};

function ChecklistPanel({ theme, order, onRefresh }: ChecklistPanelProps) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});

  const fetchChecklist = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/instalacion/checklist/${order.id}`);
      if (res.ok) setItems(await res.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchChecklist(); }, [order.id]);

  const toggle = async (item: ChecklistItem) => {
    setToggling(item.id);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/instalacion/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          item_id: item.id,
          completado: !item.completado,
          observacion: obs[item.id] ?? item.observacion,
          usuario: 'Técnico',
        })
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.checklist);
        onRefresh();
      }
    } finally { setToggling(null); }
  };

  const completados = items.filter(i => i.completado).length;
  const total = items.length;
  const pct = total ? Math.round((completados / total) * 100) : 0;

  // Group by category
  const categorias = Array.from(new Set(items.map(i => i.categoria)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header + progress */}
      <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: `1px solid ${theme.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>📋 CHECKLIST DE INSTALACIÓN — US-036</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: pct === 100 ? '#00C896' : theme.accent }}>
            {completados}/{total} · {pct}%
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#00C896' : theme.accent, borderRadius: 3, transition: 'width 0.3s ease' }} />
        </div>
        {pct === 100 && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#00C896', fontWeight: 700 }}>✅ Checklist completo</div>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: theme.dim, padding: 10 }}>Cargando checklist...</div>
      ) : (
        categorias.map(cat => {
          const catItems = items.filter(i => i.categoria === cat);
          const catColor = CATEGORIA_COLORS[cat] ?? theme.accent;
          const catDone = catItems.filter(i => i.completado).length;
          return (
            <div key={cat}>
              <div style={{ fontSize: 10, fontWeight: 800, color: catColor, textTransform: 'uppercase', marginBottom: 6, letterSpacing: 1 }}>
                {cat} ({catDone}/{catItems.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {catItems.map(item => (
                  <div key={item.id}>
                    <div
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                        background: item.completado ? `${catColor}0d` : 'rgba(255,255,255,0.02)',
                        borderRadius: 8,
                        border: `1px solid ${item.completado ? catColor + '40' : theme.border}`,
                        cursor: 'pointer', transition: 'all 0.15s'
                      }}
                      onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    >
                      {/* Checkbox */}
                      <button
                        disabled={toggling === item.id}
                        onClick={e => { e.stopPropagation(); toggle(item); }}
                        style={{
                          flexShrink: 0, width: 20, height: 20, borderRadius: 5,
                          border: `2px solid ${item.completado ? catColor : theme.dim}`,
                          background: item.completado ? catColor : 'transparent',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#000', fontSize: 11, fontWeight: 900, transition: 'all 0.15s'
                        }}
                      >
                        {item.completado ? '✓' : ''}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: item.completado ? theme.text : theme.dim, textDecoration: item.completado ? 'none' : 'none', lineHeight: 1.4 }}>
                          <span style={{ fontSize: 10, color: theme.dim, marginRight: 6 }}>{item.id}</span>
                          {item.descripcion}
                        </div>
                        {item.completado && item.completado_por && (
                          <div style={{ fontSize: 10, color: catColor, marginTop: 3 }}>
                            {item.completado_por} · {item.fecha_completado?.split('T')[1]?.substring(0, 5)}
                          </div>
                        )}
                        {item.observacion && (
                          <div style={{ fontSize: 10, color: theme.dim, marginTop: 2, fontStyle: 'italic' }}>
                            "{item.observacion}"
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Expanded observacion input */}
                    {expanded === item.id && !item.completado && (
                      <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '0 0 8px 8px', border: `1px solid ${theme.border}`, borderTop: 'none', marginTop: -4 }}>
                        <input
                          placeholder="Observación (opcional)..."
                          value={obs[item.id] ?? ''}
                          onChange={e => setObs(prev => ({ ...prev, [item.id]: e.target.value }))}
                          onClick={e => e.stopPropagation()}
                          style={{ width: '100%', background: 'transparent', border: 'none', color: theme.dim, fontSize: 11, outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── EvidenciasPanel ──────────────────────────────────────────────────────────
interface EvidenciasPanelProps {
  theme: ThemeConfig;
  order: WFMOrder;
  onRefresh: () => void;
}

function EvidenciasPanel({ theme, order, onRefresh }: EvidenciasPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [notas, setNotas] = useState('');
  const [previewFotos, setPreviewFotos] = useState<{ tipo: 'antes' | 'despues'; dataUrl: string; filename: string }[]>([]);
  const [loadedEv, setLoadedEv] = useState<WFMOrder['evidencias'] | null>(null);
  const [loadingEv, setLoadingEv] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const showErr = (msg: string) => { setErrMsg(msg); setTimeout(() => setErrMsg(''), 5000); };
  const fileInputAntes   = useRef<HTMLInputElement>(null);
  const fileInputDespues = useRef<HTMLInputElement>(null);

  const G = '#00ff88';
  const fotos_antes   = loadedEv?.fotos_antes   ?? order.evidencias?.fotos_antes   ?? [];
  const fotos_despues = loadedEv?.fotos_despues  ?? order.evidencias?.fotos_despues ?? [];
  const cerrado       = (loadedEv?.cerrado_por ?? order.evidencias?.cerrado_por) != null;
  const canClose      = fotos_antes.length >= 1 && fotos_despues.length >= 1 && !cerrado;

  const loadEvidencias = async () => {
    setLoadingEv(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/instalacion/evidencias/${order.id}`);
      if (res.ok) setLoadedEv(await res.json());
    } catch { /* ignore */ } finally { setLoadingEv(false); }
  };

  useEffect(() => { loadEvidencias(); }, [order.id]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, tipo: 'antes' | 'despues') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        const b64 = dataUrl.split(',')[1];
        const res = await fetch(`${API_BASE}/api/wfm/instalacion/evidencia`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: order.id, tipo, filename: file.name, data_b64: b64, usuario: 'Técnico' })
        });
        if (res.ok) {
          setPreviewFotos(prev => [...prev, { tipo, dataUrl, filename: file.name }]);
          await loadEvidencias();
          onRefresh();
        }
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch { setUploading(false); }
  };

  const handleCerrar = async () => {
    if (!canClose) return;
    setClosing(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/instalacion/cerrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, notas, usuario: 'Técnico' })
      });
      if (res.ok) { await loadEvidencias(); onRefresh(); }
      else { const err = await res.json(); showErr(err.detail ?? 'No se pudo cerrar la tarea. Intenta de nuevo.'); }
    } finally { setClosing(false); }
  };

  const renderFotoGrid = (fotos: NonNullable<WFMOrder['evidencias']>['fotos_antes'], label: string, color: string) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 8, textTransform: 'uppercase' }}>
        {label} ({fotos.length})
      </div>
      {fotos.length === 0 ? (
        <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: `1px dashed ${color}40`, textAlign: 'center', fontSize: 11, color: theme.dim }}>
          Sin fotos — requerida mínimo 1
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {fotos.map((f, i) => (
            <div key={i} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: `1px solid ${color}40` }}>
              {f.data_b64 ? (
                <img src={`data:image/jpeg;base64,${f.data_b64}`} alt={f.filename}
                  style={{ width: 100, height: 80, objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ width: 100, height: 80, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: theme.dim }}>
                  {f.size_kb}KB
                </div>
              )}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.7)', fontSize: 9, padding: '2px 4px', color: '#ccc', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {f.fecha.split('T')[1]?.substring(0, 5)} · {f.usuario}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ padding: 14, background: 'rgba(0,255,136,0.05)', borderRadius: 10, border: `1px solid ${G}30` }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: G, marginBottom: 4 }}>📸 REPORTE FOTOGRÁFICO — US-041A</div>
        <div style={{ fontSize: 11, color: theme.dim }}>Mínimo 1 foto ANTES + 1 foto DESPUÉS · Bloquea cierre si faltan</div>
      </div>

      {/* Estado */}
      {cerrado && (
        <div style={{ padding: 12, background: 'rgba(0,200,150,0.08)', borderRadius: 8, border: '1px solid #00C89640', fontSize: 12, color: '#00C896', fontWeight: 700 }}>
          ✅ Instalación cerrada · {loadedEv?.cerrado_por ?? order.evidencias?.cerrado_por}
        </div>
      )}

      {loadingEv && <div style={{ fontSize: 11, color: theme.dim }}>Cargando evidencias...</div>}

      {/* Fotos antes */}
      {renderFotoGrid(fotos_antes, 'Fotos Antes', '#FFB703')}

      {/* Upload antes */}
      {!cerrado && (
        <div style={{ marginBottom: 8 }}>
          <input ref={fileInputAntes} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => handleFileChange(e, 'antes')} />
          <button disabled={uploading} onClick={() => fileInputAntes.current?.click()}
            style={{ padding: '8px 16px', background: '#FFB70322', border: '1px solid #FFB70360', borderRadius: 8, color: '#FFB703', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {uploading ? 'Subiendo...' : '+ Foto Antes'}
          </button>
        </div>
      )}

      {/* Fotos después */}
      {renderFotoGrid(fotos_despues, 'Fotos Después', '#4FC3F7')}

      {/* Upload después */}
      {!cerrado && (
        <div style={{ marginBottom: 12 }}>
          <input ref={fileInputDespues} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => handleFileChange(e, 'despues')} />
          <button disabled={uploading} onClick={() => fileInputDespues.current?.click()}
            style={{ padding: '8px 16px', background: '#4FC3F722', border: '1px solid #4FC3F760', borderRadius: 8, color: '#4FC3F7', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {uploading ? 'Subiendo...' : '+ Foto Después'}
          </button>
        </div>
      )}

      {/* Requerimiento visual */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, padding: 10, borderRadius: 8, background: fotos_antes.length >= 1 ? 'rgba(0,200,150,0.08)' : 'rgba(255,71,87,0.08)', border: `1px solid ${fotos_antes.length >= 1 ? '#00C89640' : '#FF475740'}`, textAlign: 'center', fontSize: 11, fontWeight: 700, color: fotos_antes.length >= 1 ? '#00C896' : '#FF4757' }}>
          {fotos_antes.length >= 1 ? '✓' : '✗'} Antes ({fotos_antes.length}/1)
        </div>
        <div style={{ flex: 1, padding: 10, borderRadius: 8, background: fotos_despues.length >= 1 ? 'rgba(0,200,150,0.08)' : 'rgba(255,71,87,0.08)', border: `1px solid ${fotos_despues.length >= 1 ? '#00C89640' : '#FF475740'}`, textAlign: 'center', fontSize: 11, fontWeight: 700, color: fotos_despues.length >= 1 ? '#00C896' : '#FF4757' }}>
          {fotos_despues.length >= 1 ? '✓' : '✗'} Después ({fotos_despues.length}/1)
        </div>
      </div>

      {/* Notas */}
      {!cerrado && (
        <textarea
          placeholder="Notas de cierre (opcional)..."
          value={notas}
          onChange={e => setNotas(e.target.value)}
          style={{ width: '100%', height: 60, background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, padding: 10, fontSize: 12, resize: 'none', boxSizing: 'border-box' }}
        />
      )}

      {/* Cerrar botón */}
      {!cerrado && (
        <button
          disabled={!canClose || closing}
          onClick={handleCerrar}
          style={{
            padding: 12, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13, cursor: canClose ? 'pointer' : 'not-allowed',
            background: canClose ? G : 'rgba(255,255,255,0.06)',
            color: canClose ? '#000' : theme.dim,
            transition: 'all 0.2s'
          }}
        >
          {closing ? 'Cerrando...' : canClose ? '✅ CERRAR INSTALACIÓN' : '🔒 Faltan fotos requeridas'}
        </button>
      )}
    </div>
  );
}

// ── SLA Escalation Banner (dinámico + editable) ───────────────────────────────
interface SLALimite { dias: number; owner: string; label: string; icon: string }
interface SLANodo   { label: string; icon: string; color: string }
interface SLAConfig {
  limites: Record<string, SLALimite>;
  nodos:   Record<string, SLANodo>;
  updated_at: string | null;
  updated_by: string | null;
}

// fallback mientras carga
const _FALLBACK_SLA_LIMITS: Record<string, number> = {
  SOLICITUD_PREVENTA:   5,   // días
  ANTEPROYECTO:         3,
  ORDEN_IMPLEMENTACION: 2,
  ALMACEN_VALIDACION:   2,
  ESPERA_ALMACEN:       7,
  ESPERA_INVENTARIO:    5,
  APROVISIONAMIENTO:    1,
  REVISION_PM:          1,
  LISTO_INSTALACION:    1,
  INSTALACION:          3,
  NOC_VALIDACION:       1,
  FACTURACION:          2,
};

function diasEnEstado(order: WFMOrder, limites?: Record<string, SLALimite>): number {
  const ts = (order as any).timestamps_estados?.[order.estado];
  if (ts) return (Date.now() - new Date(ts).getTime()) / 86_400_000;
  return (Date.now() - new Date(order.fecha_creacion).getTime()) / 86_400_000;
}

function slaStatusDynamic(order: WFMOrder, limites: Record<string, SLALimite>): 'ok' | 'alerta' | 'critico' {
  if (order.estado === 'CERRADO' || order.estado === 'FACTURACION' || order.estado === 'BACKLOG') return 'ok';
  const limit = limites[order.estado]?.dias ?? _FALLBACK_SLA_LIMITS[order.estado] ?? 3;
  const dias  = diasEnEstado(order);
  if (dias >= limit) return 'critico';
  if (dias >= limit * 0.7) return 'alerta';
  return 'ok';
}

interface EscEntry {
  esc_id: string; triggered_at: string; order_id: string; cliente: string;
  estado: string; severity: string; dias_sla: number; owner_node: string;
  status: string; cleared_at: string | null; cleared_by: string | null; notas: string;
}

type ViewMode = 'kanban' | 'timeline' | 'roles' | 'visibilidad';

// ── VisibilidadView — Cuellos de Botella ──────────────────────────────────────
const AREA_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  'NOC':          { label: 'NOC',       color: '#00B4D8', icon: '📡' },
  'Dispatch':     { label: 'Dispatch',  color: '#FF6B35', icon: '🚛' },
  'Almacén':      { label: 'Almacén',   color: '#FFB703', icon: '📦' },
  'Operaciones':  { label: 'Campo',     color: '#00ff88', icon: '🔧' },
  'NOC Cierra':   { label: 'Cierre',    color: '#00C896', icon: '✅' },
};
const ORDER_AREA: Partial<Record<WFMOrderState, string>> = {
  SOLICITUD_PREVENTA:   'NOC',    ANTEPROYECTO:      'NOC',
  ORDEN_IMPLEMENTACION: 'PM',     ALMACEN_VALIDACION:'Almacén',
  ESPERA_ALMACEN:       'Almacén',ESPERA_INVENTARIO: 'Almacén',
  APROVISIONAMIENTO:    'NOC',    REVISION_PM:       'PM',
  LISTO_INSTALACION:    'Campo',  INSTALACION:       'Campo',
  NOC_VALIDACION:       'NOC',    FACTURACION:       'Admin',
};
const ORDER_AREA_COLOR: Record<string, string> = {
  'NOC': '#00B4D8', 'PM': '#FF4757', 'Almacén': '#F97316',
  'Campo': '#00ff88', 'Admin': '#00C896',
};

function semaforo(dias: number, umbralAlerta = 3, umbralCritico = 7) {
  if (dias >= umbralCritico) return { color: '#EF4444', label: 'Crítico' };
  if (dias >= umbralAlerta)  return { color: '#F59E0B', label: 'Alerta' };
  return { color: '#00C896', label: 'OK' };
}

function VisibilidadView({ theme, orders, fieldTickets }: {
  theme: ThemeConfig; orders: WFMOrder[]; fieldTickets: FieldTicket[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const hoy = new Date();

  // ── Field tickets por etapa con antigüedad ──────────────────────────────────
  const ftPorEtapa: Record<string, FieldTicket[]> = {};
  for (const t of fieldTickets) {
    const e = t.etapa_op || 'Sin etapa';
    if (!ftPorEtapa[e]) ftPorEtapa[e] = [];
    ftPorEtapa[e].push(t);
  }

  // ── Orders por área con antigüedad ─────────────────────────────────────────
  const ordPorArea: Record<string, WFMOrder[]> = {};
  for (const o of orders.filter(o => o.estado !== 'CERRADO')) {
    const area = ORDER_AREA[o.estado] || o.estado;
    if (!ordPorArea[area]) ordPorArea[area] = [];
    ordPorArea[area].push(o);
  }

  const diasFT = (t: FieldTicket) => {
    const fc = t.fecha_creacion?.slice(0, 10);
    if (!fc) return 0;
    return Math.floor((hoy.getTime() - new Date(fc).getTime()) / 86400000);
  };
  const diasOrd = (o: WFMOrder) => {
    const fc = o.fecha_creacion?.slice(0, 10);
    if (!fc) return 0;
    return Math.floor((hoy.getTime() - new Date(fc).getTime()) / 86400000);
  };

  const block = (
    titulo: string, subtitulo: string, areaKey: string,
    items: { id: string; nombre: string; dias: number; extra?: string }[],
    color: string, icon: string
  ) => {
    const criticos  = items.filter(i => i.dias >= 7).length;
    const alertas   = items.filter(i => i.dias >= 3 && i.dias < 7).length;
    const maxDias   = items.length ? Math.max(...items.map(i => i.dias)) : 0;
    const sem       = semaforo(maxDias);
    const isOpen    = selected === areaKey;
    const sorted    = [...items].sort((a, b) => b.dias - a.dias).slice(0, 15);

    return (
      <div key={areaKey} style={{
        borderRadius: 12, overflow: 'hidden',
        border: `1.5px solid ${isOpen ? color : 'rgba(255,255,255,0.08)'}`,
        background: isOpen ? `${color}08` : 'rgba(255,255,255,0.02)',
        transition: 'all 0.2s',
      }}>
        {/* Header del bloque */}
        <button onClick={() => setSelected(isOpen ? null : areaKey)}
          style={{ width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' as const, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: theme.text, fontWeight: 800, fontSize: 14 }}>{titulo}</span>
              <span style={{ background: `${sem.color}22`, color: sem.color, borderRadius: 6, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>{sem.label}</span>
            </div>
            <span style={{ color: theme.dim, fontSize: 11 }}>{subtitulo}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {criticos > 0  && <span style={{ background: '#EF444422', color: '#EF4444', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>🔴 {criticos}</span>}
            {alertas > 0   && <span style={{ background: '#F59E0B22', color: '#F59E0B', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>🟡 {alertas}</span>}
            <span style={{ background: `${color}22`, color, borderRadius: 8, padding: '3px 12px', fontSize: 14, fontWeight: 800 }}>{items.length}</span>
            <span style={{ color: theme.dim, fontSize: 16 }}>{isOpen ? '▲' : '▼'}</span>
          </div>
        </button>

        {/* Detalle expandido */}
        {isOpen && (
          <div style={{ borderTop: `1px solid rgba(255,255,255,0.06)`, padding: '0 16px 16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' as const, marginTop: 12 }}>
              <thead>
                <tr>
                  {['ID', 'Caso', extra => extra, 'Días'].map((h, i) => (
                    <th key={i} style={{ textAlign: 'left' as const, fontSize: 10, fontWeight: 700, color: theme.dim, textTransform: 'uppercase' as const, padding: '4px 8px', borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
                      {typeof h === 'string' ? h : (sorted[0]?.extra !== undefined ? 'Técnico' : '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((item, i) => {
                  const s = semaforo(item.dias);
                  return (
                    <tr key={item.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: theme.dim, fontFamily: 'monospace' }}>{item.id}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: theme.text, maxWidth: 280 }}>{item.nombre.slice(0, 55)}{item.nombre.length > 55 ? '…' : ''}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: theme.dim }}>{item.extra || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ background: `${s.color}22`, color: s.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                          {item.dias}d
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {items.length > 15 && <div style={{ fontSize: 11, color: theme.dim, marginTop: 8, textAlign: 'center' as const }}>… y {items.length - 15} más</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', flex: 1 }}>
      <div style={{ fontSize: 12, color: theme.dim, marginBottom: 4 }}>
        🔍 Cuellos de botella — click en un área para ver los casos. 🔴 ≥7 días · 🟡 3-6 días · 🟢 &lt;3 días
      </div>

      {/* Field Tickets (Operacional) */}
      <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 }}>
        ⚡ Habilitaciones & Fallas (Odoo CAST)
      </div>
      {Object.entries(AREA_CONFIG).map(([key, cfg]) => {
        const items = (ftPorEtapa[key] || []).map(t => ({
          id: t.id, nombre: t.nombre, dias: diasFT(t), extra: t.tecnico || 'Sin asignar'
        }));
        if (!items.length) return null;
        return block(cfg.label, `${items.length} casos activos`, key, items, cfg.color, cfg.icon);
      })}

      {/* Pipeline Comercial */}
      <div style={{ fontSize: 11, fontWeight: 700, color: theme.dim, textTransform: 'uppercase', letterSpacing: 1, marginTop: 12 }}>
        📋 Pipeline Comercial (Órdenes WFM)
      </div>
      {Object.entries(ordPorArea)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([area, ords]) => {
          const items = ords.map(o => ({
            id: o.id, nombre: `${o.cliente} — ${o.servicio}`, dias: diasOrd(o), extra: o.comercial
          }));
          const color = ORDER_AREA_COLOR[area] || '#888';
          const icons: Record<string, string> = { NOC:'📡', PM:'📋', Almacén:'📦', Campo:'🔧', Admin:'💳' };
          return block(area, `${items.length} órdenes activas`, `ord-${area}`, items, color, icons[area] || '📌');
        })}
    </div>
  );
}

interface SLABannerProps {
  theme: ThemeConfig;
  orders: WFMOrder[];
  viewMode?: ViewMode;
  onViewChange?: (v: ViewMode) => void;
}

function SLAEscalationBanner({ theme, orders, viewMode, onViewChange }: SLABannerProps) {
  const [config, setConfig]       = useState<SLAConfig | null>(null);
  const [editMode, setEditMode]   = useState(false);
  const [draft, setDraft]         = useState<Record<string, number>>({});
  const [saving, setSaving]       = useState(false);
  const [showSLATable, setShowSLATable] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [escLog, setEscLog]       = useState<EscEntry[]>([]);
  const [showLog, setShowLog]     = useState(false);
  const [clearing, setClearing]   = useState<string | null>(null); // order_id en proceso

  const fetchConfig = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/wfm/sla-config`);
      if (r.ok) {
        const d: SLAConfig = await r.json();
        setConfig(d);
        setLastSaved(d.updated_at ? `${d.updated_by} · ${new Date(d.updated_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : null);
      }
    } catch { /* ignore */ }
  };

  const fetchLog = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/wfm/sla-escalaciones?limit=50`);
      if (r.ok) { const d = await r.json(); setEscLog(d.log ?? []); }
    } catch { /* ignore */ }
  };

  // Auto-registra escalaciones activas en el backend
  const autoRegister = async (ordersList: WFMOrder[], limitesCfg: Record<string, SLALimite>) => {
    const criticos = ordersList.filter(o => slaStatusDynamic(o, limitesCfg) === 'critico');
    for (const o of criticos) {
      const owner = limitesCfg[o.estado]?.owner ?? 'ops';
      await fetch(`${API_BASE}/api/wfm/sla-escalacion/registrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: o.id, cliente: o.cliente, estado: o.estado,
          severity: 'critico', dias: diasEnEstado(o), owner_node: owner,
          cleared_by: '', notas: '',
        }),
      }).catch(() => {});
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchLog();
    const t = setInterval(() => { fetchConfig(); fetchLog(); }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Auto-registra cuando cambian las órdenes
  useEffect(() => {
    if (config && orders.length > 0) autoRegister(orders, config.limites);
  }, [orders, config]);

  const handleClear = async (order: WFMOrder, severity: string) => {
    setClearing(order.id);
    try {
      const owner = config?.limites[order.estado]?.owner ?? 'ops';
      await fetch(`${API_BASE}/api/wfm/sla-escalacion/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id, cliente: order.cliente, estado: order.estado,
          severity, dias: diasEnEstado(order), owner_node: owner,
          cleared_by: 'NOC Operador', notas: 'Clear manual desde banner SLA',
        }),
      });
      await fetchLog();
    } finally { setClearing(null); }
  };

  const limites = config?.limites ?? {};
  const nodos   = config?.nodos   ?? {
    noc: { label: 'NOC',              icon: '📡', color: '#00B4D8' },
    pm:  { label: 'PM / Operaciones', icon: '📋', color: '#FF4757' },
    ops: { label: 'Campo / Dispatch', icon: '🚛', color: '#00ff88' },
  };

  const active = orders.filter(o => o.estado !== 'CERRADO' && o.estado !== 'BACKLOG');

  const byNode = (node: string) =>
    active.filter(o => limites[o.estado]?.owner === node || (!limites[o.estado] && node === 'ops'));

  const countStatus = (list: WFMOrder[]) => ({
    ok:      list.filter(o => slaStatusDynamic(o, limites) === 'ok').length,
    alerta:  list.filter(o => slaStatusDynamic(o, limites) === 'alerta').length,
    critico: list.filter(o => slaStatusDynamic(o, limites) === 'critico').length,
  });

  const nodeKeys  = Object.keys(nodos);
  const nodeStats = Object.fromEntries(nodeKeys.map(k => [k, countStatus(byNode(k))]));

  const totalCritico  = active.filter(o => slaStatusDynamic(o, limites) === 'critico').length;
  const totalAlerta   = active.filter(o => slaStatusDynamic(o, limites) === 'alerta').length;
  const cumplimiento  = active.length > 0
    ? Math.round((active.filter(o => slaStatusDynamic(o, limites) === 'ok').length / active.length) * 100)
    : 100;

  const nodeColor = (stats: { ok: number; alerta: number; critico: number }) =>
    stats.critico > 0 ? '#FF4757' : stats.alerta > 0 ? '#FFB703' : '#00C896';

  // Guardar cambios SLA
  const handleSave = async () => {
    setSaving(true);
    try {
      const limitesPatch: Record<string, { dias: number }> = {};
      for (const [estado, dias] of Object.entries(draft)) {
        limitesPatch[estado] = { dias };
      }
      const r = await fetch(`${API_BASE}/api/wfm/sla-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limites: limitesPatch, usuario: 'NOC Operaciones' }),
      });
      if (r.ok) {
        await fetchConfig();
        setEditMode(false);
        setDraft({});
      }
    } finally { setSaving(false); }
  };

  const handleReset = async () => {
    if (!confirm('¿Restaurar SLAs a valores por defecto?')) return;
    await fetch(`${API_BASE}/api/wfm/sla-config/reset`, { method: 'POST' });
    await fetchConfig();
    setEditMode(false);
    setDraft({});
  };

  // Sub-componentes
  const NodePulse = ({ color }: { color: string }) => (
    <span style={{ position: 'relative', display: 'inline-block', width: 10, height: 10, flexShrink: 0 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: color,
        animation: color === '#FF4757' ? 'sla-pulse 1.2s ease-in-out infinite' : 'none',
        boxShadow: `0 0 8px ${color}`,
      }} />
    </span>
  );

  const Connector = () => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', flexShrink: 0 }}>
      <div style={{ width: 32, height: 2, background: `linear-gradient(90deg, ${theme.accent}20, ${theme.accent}60, ${theme.accent}20)`, position: 'relative' }}>
        <div style={{ position: 'absolute', right: -4, top: -3, width: 8, height: 8, borderTop: `2px solid ${theme.accent}60`, borderRight: `2px solid ${theme.accent}60`, transform: 'rotate(45deg)' }} />
      </div>
    </div>
  );

  return (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: 14, padding: '12px 16px', marginBottom: 14,
    }}>
      <style>{`
        @keyframes sla-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(1.7)} }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: theme.dim, textTransform: 'uppercase', letterSpacing: 1 }}>
          ⚡ SLA · Escalamiento en Vivo
        </span>
        {/* Métricas globales */}
        <span style={{ fontSize: 11, fontWeight: 700, color: '#00C896' }}>✓ {cumplimiento}%</span>
        {totalCritico > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#FF4757', background: '#FF475718', padding: '2px 10px', borderRadius: 20, animation: 'sla-pulse 2s infinite' }}>
            ⚡ {totalCritico} CRÍTICO{totalCritico > 1 ? 'S' : ''}
          </span>
        )}
        {totalAlerta > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#FFB703', background: '#FFB70318', padding: '2px 10px', borderRadius: 20 }}>
            ⚠ {totalAlerta} en alerta
          </span>
        )}
        <span style={{ fontSize: 10, color: theme.dim }}>{active.length} activas</span>

        {/* ── Selector de vista ── */}
        {onViewChange && (
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 3, border: '1px solid rgba(255,255,255,0.08)', marginLeft: 8 }}>
            {([
              ['visibilidad', '🔍', 'Cuellos de Botella'],
              ['kanban',      '⬛', 'Kanban'],
              ['timeline',    '📅', 'Timeline'],
              ['roles',       '👤', 'Roles'],
            ] as [ViewMode, string, string][]).map(([id, icon, label]) => (
              <button key={id} onClick={() => onViewChange(id)} style={{
                padding: '4px 11px', borderRadius: 5, border: 'none', cursor: 'pointer',
                background: viewMode === id ? `${G}22` : 'transparent',
                color: viewMode === id ? G : theme.dim,
                fontSize: 10, fontWeight: viewMode === id ? 800 : 500,
                boxShadow: viewMode === id ? `0 0 0 1px ${G}40` : 'none',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}>
                {icon} {label}
              </button>
            ))}
          </div>
        )}

        {/* Botones derecha */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {lastSaved && !editMode && (
            <span style={{ fontSize: 9, color: theme.dim }}>Editado: {lastSaved}</span>
          )}
          <button onClick={() => { setShowLog(x => !x); if (!showLog) fetchLog(); }} style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
            background: escLog.filter(e => e.status === 'ACTIVO').length > 0 ? '#FF475718' : 'transparent',
            border: `1px solid ${escLog.filter(e => e.status === 'ACTIVO').length > 0 ? '#FF475750' : theme.border}`,
            color: escLog.filter(e => e.status === 'ACTIVO').length > 0 ? '#FF4757' : theme.dim, fontWeight: 700,
          }}>
            📋 Log {escLog.length > 0 ? `(${escLog.length})` : ''}
          </button>
          <button onClick={() => setShowSLATable(x => !x)} style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim,
          }}>
            {showSLATable ? '▲ SLAs' : '▼ SLAs'}
          </button>
          {!editMode ? (
            <button onClick={() => { setEditMode(true); setShowSLATable(true); const d: Record<string,number>={}; Object.entries(limites).forEach(([k,v])=>{d[k]=v.dias;}); setDraft(d); }} style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
              background: `${theme.accent}15`, border: `1px solid ${theme.accent}40`, color: theme.accent, fontWeight: 700,
            }}>
              ✏ Editar SLAs
            </button>
          ) : (
            <>
              <button onClick={handleSave} disabled={saving} style={{
                fontSize: 10, padding: '3px 12px', borderRadius: 6, cursor: 'pointer',
                background: '#00C896', border: 'none', color: '#000', fontWeight: 800,
              }}>
                {saving ? '...' : '✓ Guardar'}
              </button>
              <button onClick={() => { setEditMode(false); setDraft({}); }} style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim,
              }}>
                Cancelar
              </button>
              <button onClick={handleReset} style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                background: 'transparent', border: `1px solid #FF475740`, color: '#FF4757',
              }}>
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Nodos conectados ── */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {nodeKeys.map((nodeKey, i) => {
          const nodo  = nodos[nodeKey];
          const stats = nodeStats[nodeKey];
          const nc    = nodeColor(stats);
          const nodeOrds = byNode(nodeKey);
          return (
            <div key={nodeKey} style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0 }}>
              {i > 0 && <Connector />}
              <div style={{
                flex: 1, background: `${nc}08`, border: `1px solid ${nc}30`,
                borderRadius: 10, padding: '10px 14px', minWidth: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <NodePulse color={nc} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: nodo.color }}>{nodo.icon} {nodo.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9, background: `${nc}20`, color: nc, padding: '1px 7px', borderRadius: 20, fontWeight: 700 }}>
                    {nodeOrds.length}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {[{ l:'OK', c:'#00C896', n:stats.ok },{ l:'⚠', c:'#FFB703', n:stats.alerta },{ l:'⚡', c:'#FF4757', n:stats.critico }].map(s => (
                    <div key={s.l} style={{ flex:1, textAlign:'center', background:`${s.c}12`, border:`1px solid ${s.c}25`, borderRadius:6, padding:'4px 2px' }}>
                      <div style={{ fontSize:16, fontWeight:900, color:s.c, lineHeight:1 }}>{s.n}</div>
                      <div style={{ fontSize:7, color:`${s.c}80`, fontWeight:700 }}>{s.l}</div>
                    </div>
                  ))}
                </div>
                {/* Órdenes críticas con botón Clear */}
                {nodeOrds.filter(o => slaStatusDynamic(o, limites) !== 'ok').slice(0, 3).map(o => {
                  const sv = slaStatusDynamic(o, limites);
                  const svColor = sv === 'critico' ? '#FF4757' : '#FFB703';
                  return (
                    <div key={o.id} style={{ display:'flex', alignItems:'center', gap:4, marginTop:4 }}>
                      <span style={{ fontSize:8, color:svColor, fontWeight:700, flexShrink:0 }}>
                        {sv === 'critico' ? '⚡' : '⚠'}
                      </span>
                      <span style={{ fontSize:9, color:svColor, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {o.cliente.split(' ')[0]} ({diasEnEstado(o).toFixed(1)}d)
                      </span>
                      <button
                        onClick={() => handleClear(o, sv)}
                        disabled={clearing === o.id}
                        style={{
                          fontSize:8, padding:'1px 6px', borderRadius:4, cursor:'pointer', flexShrink:0,
                          background: clearing === o.id ? 'transparent' : `${svColor}20`,
                          border:`1px solid ${svColor}50`, color:svColor, fontWeight:700,
                        }}
                      >
                        {clearing === o.id ? '...' : 'CLEAR'}
                      </button>
                    </div>
                  );
                })}
                {stats.critico === 0 && stats.alerta === 0 && (
                  <div style={{ fontSize:9, color:'#00C896', marginTop:6, fontWeight:600 }}>✓ Dentro de SLA</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Log de Escalaciones NOC ── */}
      {showLog && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: theme.dim, textTransform: 'uppercase', letterSpacing: 1 }}>
              📋 Protocolo de Escalaciones NOC
            </span>
            <span style={{ fontSize: 9, color: theme.dim }}>Auto-clear: {30}min sin atención</span>
            <button onClick={fetchLog} style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim }}>
              ↻ Refrescar
            </button>
          </div>

          {escLog.length === 0 ? (
            <div style={{ fontSize: 11, color: theme.dim, textAlign: 'center', padding: 16 }}>Sin eventos registrados</div>
          ) : (
            <div style={{ fontFamily: 'monospace', fontSize: 10, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflowY: 'auto' }}>
              {/* Header tabla */}
              <div style={{ display: 'grid', gridTemplateColumns: '110px 80px 1fr 100px 80px 80px', gap: 8, padding: '4px 8px', background: `${theme.accent}10`, borderRadius: 4, fontSize: 9, fontWeight: 800, color: theme.dim }}>
                <span>TIMESTAMP</span><span>ID</span><span>CLIENTE / ESTADO</span><span>SEVERIDAD</span><span>DÍAS SLA</span><span>STATUS</span>
              </div>
              {escLog.map((e) => {
                const statusColor =
                  e.status === 'ACTIVO'       ? '#FF4757' :
                  e.status === 'CLEARED'      ? '#00C896' :
                  e.status === 'ATENDIDO'     ? '#4FC3F7' :
                  e.status === 'AUTO_CLEARED' ? '#FFB703' : theme.dim;
                const ts = new Date(e.triggered_at);
                const tsStr = `${ts.toLocaleDateString('es-MX', { month:'2-digit', day:'2-digit' })} ${ts.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;
                return (
                  <div key={e.esc_id} style={{
                    display: 'grid', gridTemplateColumns: '110px 80px 1fr 100px 80px 80px',
                    gap: 8, padding: '5px 8px', borderRadius: 4,
                    background: e.status === 'ACTIVO' ? '#FF475708' : `${theme.card}80`,
                    border: `1px solid ${e.status === 'ACTIVO' ? '#FF475730' : theme.border}`,
                    alignItems: 'center',
                  }}>
                    <span style={{ color: theme.dim, fontSize: 9 }}>{tsStr}</span>
                    <span style={{ color: theme.accent, fontWeight: 700, fontSize: 9 }}>{e.esc_id}</span>
                    <div>
                      <div style={{ color: theme.text, fontWeight: 600 }}>{e.cliente}</div>
                      <div style={{ color: theme.dim, fontSize: 9 }}>{e.estado.replace(/_/g, ' ')}</div>
                    </div>
                    <span style={{
                      fontWeight: 800, padding: '2px 6px', borderRadius: 4, fontSize: 9,
                      background: e.severity === 'CRITICO' ? '#FF475720' : '#FFB70320',
                      color: e.severity === 'CRITICO' ? '#FF4757' : '#FFB703',
                    }}>
                      {e.severity === 'CRITICO' ? '⚡' : '⚠'} {e.severity}
                    </span>
                    <span style={{ color: '#FFB703', fontWeight: 700 }}>{e.dias_sla.toFixed(1)}d</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: statusColor, background: `${statusColor}15`, padding: '1px 5px', borderRadius: 3 }}>
                        {e.status}
                      </span>
                      {e.status === 'ACTIVO' && (
                        <button
                          onClick={() => {
                            const o = orders.find(x => x.id === e.order_id);
                            if (o) handleClear(o, e.severity.toLowerCase());
                          }}
                          disabled={clearing === e.order_id}
                          style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, cursor: 'pointer', background: '#FF475720', border: '1px solid #FF475750', color: '#FF4757', fontWeight: 700 }}
                        >
                          CLR
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tabla SLA editable ── */}
      {showSLATable && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>
            Límites SLA por Etapa {editMode && <span style={{ color: theme.accent }}>— Modo Edición Activo</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
            {Object.entries(limites).map(([estado, cfg]) => {
              const ownerNode = nodos[cfg.owner];
              const ownerColor = ownerNode?.color ?? theme.accent;
              return (
                <div key={estado} style={{
                  background: theme.bg, border: `1px solid ${theme.border}`,
                  borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 14 }}>{cfg.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cfg.label}</div>
                    <div style={{ fontSize: 9, color: ownerColor, fontWeight: 600 }}>{ownerNode?.label ?? cfg.owner}</div>
                  </div>
                  {editMode ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => setDraft(d => ({ ...d, [estado]: Math.max(1, (d[estado] ?? cfg.dias) - 1) }))}
                        style={{ width:20, height:20, borderRadius:4, border:`1px solid ${theme.border}`, background:'transparent', color:theme.dim, cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                      <input
                        type="number" min={1} max={30}
                        value={draft[estado] ?? cfg.dias}
                        onChange={e => setDraft(d => ({ ...d, [estado]: Math.max(1, parseInt(e.target.value) || 1) }))}
                        style={{ width:36, textAlign:'center', background:theme.card, border:`1px solid ${theme.accent}`, borderRadius:4, color:theme.accent, fontWeight:800, fontSize:12, padding:'2px 0' }}
                      />
                      <button onClick={() => setDraft(d => ({ ...d, [estado]: Math.min(30, (d[estado] ?? cfg.dias) + 1) }))}
                        style={{ width:20, height:20, borderRadius:4, border:`1px solid ${theme.border}`, background:'transparent', color:theme.dim, cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                      <span style={{ fontSize:9, color:theme.dim }}>d</span>
                    </div>
                  ) : (
                    <span style={{ fontSize:13, fontWeight:900, color: theme.accent, flexShrink:0 }}>{cfg.dias}d</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Timeline View ─────────────────────────────────────────────────────────────
const PIPELINE_STATES: WFMOrderState[] = [
  'SOLICITUD_PREVENTA', 'ANTEPROYECTO', 'ORDEN_IMPLEMENTACION',
  'ALMACEN_VALIDACION', 'ESPERA_ALMACEN', 'ESPERA_INVENTARIO', 'APROVISIONAMIENTO',
  'REVISION_PM', 'LISTO_INSTALACION', 'INSTALACION', 'NOC_VALIDACION',
  'FACTURACION', 'CERRADO',
];
const STATE_INDEX = Object.fromEntries(PIPELINE_STATES.map((s, i) => [s, i]));
const LANE_FOR: Partial<Record<WFMOrderState, { color: string; area: string }>> = {
  SOLICITUD_PREVENTA:   { color: '#00B4D8', area: 'NOC' },
  ANTEPROYECTO:         { color: '#00B4D8', area: 'NOC' },
  ORDEN_IMPLEMENTACION: { color: '#FF4757', area: 'PM' },
  ALMACEN_VALIDACION:   { color: '#FF4757', area: 'PM' },
  ESPERA_ALMACEN:       { color: '#F97316', area: 'Almacén' },
  ESPERA_INVENTARIO:    { color: '#FFB703', area: 'PM' },
  APROVISIONAMIENTO:    { color: '#A855F7', area: 'PM' },
  REVISION_PM:          { color: '#FF4757', area: 'PM' },
  LISTO_INSTALACION:    { color: '#00ff88', area: 'Campo' },
  INSTALACION:          { color: '#00ff88', area: 'Campo' },
  NOC_VALIDACION:       { color: '#00B4D8', area: 'Campo' },
  FACTURACION:          { color: '#00C896', area: 'Campo' },
  CERRADO:              { color: '#00C896', area: 'Campo' },
};

function TimelineView({ theme, orders, onSelectOrder }: {
  theme: ThemeConfig;
  orders: WFMOrder[];
  onSelectOrder: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'active' | 'delayed'>('all');
  const now = Date.now();

  const filtered = orders.filter(o => {
    if (o.estado === 'CERRADO') return filter === 'all';
    if (filter === 'active') return o.estado !== 'CERRADO';
    if (filter === 'delayed') {
      const days = (now - new Date(o.fecha_creacion).getTime()) / 86_400_000;
      return days > 3;
    }
    return true;
  });

  // Sort by creation date desc
  const sorted = [...filtered].sort((a, b) =>
    new Date(b.fecha_creacion).getTime() - new Date(a.fecha_creacion).getTime()
  );

  const stateStep = 100 / (PIPELINE_STATES.length - 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Filter tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: theme.dim, fontWeight: 700 }}>FILTRO:</span>
        {([
          ['all',     '📋 Todas',    theme.text],
          ['active',  '🟢 Activas',  '#00C896'],
          ['delayed', '🔴 Retrasadas','#FF4757'],
        ] as const).map(([id, label, col]) => (
          <button key={id} onClick={() => setFilter(id)} style={{
            padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: filter === id ? 700 : 400,
            background: filter === id ? `${col}20` : 'rgba(255,255,255,0.04)',
            color: filter === id ? col : theme.dim,
            boxShadow: filter === id ? `0 0 0 1px ${col}50` : 'none',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.dim }}>{sorted.length} órdenes</span>
      </div>

      {/* Pipeline state header ruler */}
      <div style={{ position: 'relative', height: 28, marginBottom: 4 }}>
        {/* Ruler line */}
        <div style={{ position: 'absolute', top: 14, left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        {PIPELINE_STATES.map((s, i) => {
          const pct = i * stateStep;
          const meta = LANE_FOR[s];
          return (
            <div key={s} style={{
              position: 'absolute', left: `${pct}%`, transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: meta?.color ?? '#555', boxShadow: `0 0 4px ${meta?.color ?? '#555'}88` }} />
              <span style={{ fontSize: 8, color: meta?.color ?? theme.dim, fontWeight: 700, whiteSpace: 'nowrap', writingMode: 'horizontal-tb' }}>
                {(COLUMN_SHORT[s] ?? s).substring(0, 8)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Order rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
        {sorted.map(order => {
          const idx    = STATE_INDEX[order.estado] ?? 0;
          const pct    = idx * stateStep;
          const meta   = LANE_FOR[order.estado];
          const col    = meta?.color ?? '#888';
          const days   = (now - new Date(order.fecha_creacion).getTime()) / 86_400_000;
          const daysStr = days >= 1 ? `${days.toFixed(1)}d` : `${Math.round(days * 24)}h`;
          const urgency = days > 7 ? '#FF4757' : days > 3 ? '#FFB703' : '#00C896';
          const isActive = order.estado !== 'CERRADO';

          return (
            <div key={order.id}
              onClick={() => onSelectOrder(order.id)}
              style={{
                padding: '10px 14px', background: theme.card, borderRadius: 10,
                border: `1px solid ${theme.border}`, cursor: 'pointer',
                transition: 'border-color 0.15s',
                opacity: isActive ? 1 : 0.55,
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = col + '60')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = theme.border)}
            >
              {/* Row top: id + client + state badge + time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: theme.accent, fontFamily: 'monospace', flexShrink: 0 }}>{order.id}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{order.cliente}</span>
                <span style={{ fontSize: 9, color: theme.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130, flexShrink: 0 }}>{order.servicio}</span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: `${col}18`, color: col, border: `1px solid ${col}40`, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {STATE_LABEL[order.estado] ?? order.estado}
                </span>
                <span style={{ fontSize: 9, fontWeight: 700, color: urgency, flexShrink: 0 }}>{daysStr}</span>
              </div>

              {/* Progress bar */}
              <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                {/* Filled track */}
                <div style={{
                  position: 'absolute', left: 0, width: `${pct}%`, height: '100%',
                  background: `linear-gradient(90deg, #00B4D820, ${col}60)`,
                  borderRadius: 3, transition: 'width 0.4s ease',
                }} />
                {/* Dot at current position */}
                <div style={{
                  position: 'absolute', top: '50%', left: `${pct}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 10, height: 10, borderRadius: '50%',
                  background: col,
                  boxShadow: isActive ? `0 0 8px ${col}` : 'none',
                  border: `2px solid ${theme.card}`,
                  transition: 'left 0.4s ease',
                }} />
              </div>

              {/* Historial pills */}
              {order.historial && order.historial.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 6, overflowX: 'auto', paddingBottom: 2 }}>
                  {order.historial.slice(-5).map((h, i) => {
                    const ts = new Date(h.fecha);
                    const timeStr = `${ts.toLocaleDateString('es-MX', { month:'2-digit', day:'2-digit' })} ${ts.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })}`;
                    return (
                      <span key={i} style={{
                        fontSize: 8, whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 4,
                        background: 'rgba(255,255,255,0.04)', color: theme.dim, border: `1px solid ${theme.border}`,
                        flexShrink: 0,
                      }}>
                        {timeStr} · {h.accion?.substring(0, 20)}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: theme.dim, fontSize: 13 }}>Sin órdenes en este filtro</div>
        )}
      </div>
    </div>
  );
}

// ── Kanban View ───────────────────────────────────────────────────────────────
const KANBAN_LANES: {
  id: string;
  label: string;
  icon: string;
  color: string;
  slaLabel: string;
  states: WFMOrderState[];
}[] = [
  {
    id: 'noc',
    label: 'NOC',
    icon: '📡',
    color: '#00B4D8',
    slaLabel: '30 min',
    states: ['SOLICITUD_PREVENTA', 'ANTEPROYECTO'],
  },
  {
    id: 'pm',
    label: 'Almacén / PM',
    icon: '📋',
    color: '#FF4757',
    slaLabel: '2 hrs',
    states: ['ORDEN_IMPLEMENTACION', 'ALMACEN_VALIDACION', 'ESPERA_ALMACEN', 'ESPERA_INVENTARIO', 'APROVISIONAMIENTO', 'REVISION_PM'],
  },
  {
    id: 'campo',
    label: 'Campo',
    icon: '🚛',
    color: '#00ff88',
    slaLabel: '4.5 hrs',
    states: ['LISTO_INSTALACION', 'INSTALACION', 'NOC_VALIDACION', 'FACTURACION'],
  },
];

const COLUMN_SHORT: Partial<Record<WFMOrderState, string>> = {
  SOLICITUD_PREVENTA:   'Solicitud',
  ANTEPROYECTO:         'Anteproyecto',
  ORDEN_IMPLEMENTACION: 'Orden Imp.',
  ALMACEN_VALIDACION:   'Almacén',
  ESPERA_ALMACEN:       '⏸ Esp. Almacén',
  ESPERA_INVENTARIO:    'Espera Inv.',
  APROVISIONAMIENTO:    'Aprovision.',
  REVISION_PM:          'Rev. PM',
  LISTO_INSTALACION:    'Listo',
  INSTALACION:          'Instalación',
  NOC_VALIDACION:       'Val. NOC',
  FACTURACION:          'Facturación',
};

function daysInState(order: WFMOrder): number {
  // Try to find when it entered its current state from historial
  const hist = [...(order.historial ?? [])].reverse();
  const entry = hist.find(h =>
    h.accion?.toLowerCase().includes(order.estado.toLowerCase().replace(/_/g, ' ').substring(0, 8))
  );
  const ref = entry?.fecha ?? order.fecha_creacion;
  return (Date.now() - new Date(ref).getTime()) / 86_400_000;
}

function KanbanView({ theme, orders, onSelectOrder }: {
  theme: ThemeConfig;
  orders: WFMOrder[];
  onSelectOrder: (id: string) => void;
}) {
  // Count per state for bottleneck display
  const countByState = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.estado] = (acc[o.estado] ?? 0) + 1;
    return acc;
  }, {});
  const maxCount = Math.max(1, ...Object.values(countByState));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflowX: 'auto', minWidth: 0 }}>
      {/* SLA strip header */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 10, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
        {KANBAN_LANES.map(lane => (
          <div key={lane.id} style={{
            flex: lane.states.length,
            background: `${lane.color}12`,
            padding: '8px 14px',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: lane.color }}>{lane.icon} {lane.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: lane.color, background: `${lane.color}20`, padding: '2px 8px', borderRadius: 12, border: `1px solid ${lane.color}40` }}>
              SLA {lane.slaLabel}
            </span>
          </div>
        ))}
      </div>

      {/* Columns row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {KANBAN_LANES.map(lane =>
          lane.states.map(state => {
            const stateOrders = orders.filter(o => o.estado === state);
            const count = stateOrders.length;
            const isBottleneck = state === 'ANTEPROYECTO' && count > 10;
            const fillPct = Math.round((count / maxCount) * 100);

            return (
              <div key={state} style={{
                flex: 1,
                minWidth: 140,
                maxWidth: 220,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                background: isBottleneck ? 'rgba(255,71,87,0.06)' : `${lane.color}06`,
                borderRadius: 10,
                border: isBottleneck
                  ? '1.5px solid rgba(255,71,87,0.5)'
                  : `1px solid ${lane.color}18`,
                padding: '10px 8px',
              }}>
                {/* Column header */}
                <div style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: isBottleneck ? '#FF4757' : lane.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {COLUMN_SHORT[state] ?? state}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 800,
                      padding: '1px 7px', borderRadius: 10,
                      background: isBottleneck ? 'rgba(255,71,87,0.2)' : `${lane.color}18`,
                      color: isBottleneck ? '#FF4757' : lane.color,
                      border: `1px solid ${isBottleneck ? '#FF475750' : lane.color + '40'}`,
                    }}>
                      {count}
                    </span>
                  </div>
                  {/* Fill bar */}
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                    <div style={{
                      height: '100%',
                      width: `${fillPct}%`,
                      background: isBottleneck ? '#FF4757' : lane.color,
                      borderRadius: 2,
                      transition: 'width 0.5s ease',
                      boxShadow: isBottleneck ? '0 0 6px #FF475788' : undefined,
                    }} />
                  </div>
                  {isBottleneck && (
                    <div style={{ fontSize: 9, color: '#FF4757', fontWeight: 700, marginTop: 3 }}>
                      ⚡ CUELLO DE BOTELLA
                    </div>
                  )}
                </div>

                {/* Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 420, overflowY: 'auto' }}>
                  {stateOrders.slice(0, 12).map(order => {
                    const days = daysInState(order);
                    const daysStr = days >= 1 ? `${days.toFixed(1)}d` : `${Math.round(days * 24)}h`;
                    const urgency = days > 3 ? '#FF4757' : days > 1 ? '#FFB703' : '#00C896';
                    return (
                      <div
                        key={order.id}
                        onClick={() => onSelectOrder(order.id)}
                        style={{
                          padding: '7px 9px',
                          background: theme.card,
                          borderRadius: 7,
                          border: `1px solid ${theme.border}`,
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = lane.color + '60')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = theme.border)}
                      >
                        <div style={{ fontSize: 9, fontWeight: 700, color: theme.accent, marginBottom: 2, fontFamily: 'monospace' }}>{order.id}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: theme.text, lineHeight: 1.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.cliente}</div>
                        <div style={{ fontSize: 9, color: theme.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{order.servicio}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: urgency, background: `${urgency}15`, padding: '1px 5px', borderRadius: 4, border: `1px solid ${urgency}30` }}>
                            {daysStr}
                          </span>
                          {order.estado_fuente === 'odoo' && (
                            <span style={{ fontSize: 8, color: '#4FC3F7', opacity: 0.7 }}>Odoo</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {stateOrders.length > 12 && (
                    <div style={{ fontSize: 9, color: theme.dim, textAlign: 'center', padding: '4px 0' }}>
                      +{stateOrders.length - 12} más…
                    </div>
                  )}
                  {stateOrders.length === 0 && (
                    <div style={{ fontSize: 10, color: theme.dim, textAlign: 'center', padding: '12px 0', opacity: 0.5 }}>vacío</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Policy strip */}
      <div style={{ marginTop: 12, padding: '8px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: '#FFB703', fontWeight: 700 }}>📋 POLÍTICAS SLA</span>
        {[
          'Máx 1D incumplimiento/mes por plaza',
          'Fuera de horario → NOC llama a PM',
          'PM da seguimiento c/15 min',
          'Guardia: 20:00 – 16:00 hrs',
        ].map((p, i) => (
          <span key={i} style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>· {p}</span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>Plazas: Mty · SLP · PN · CDMX · Mva · Torreón · GDL · Mérida · Rey · Tamp · Caro</span>
      </div>
    </div>
  );
}

// ── Main Section ─────────────────────────────────────────────────────────────
interface Props { theme: ThemeConfig; activeThemeId?: string }

export default function WFMSection({ theme, activeThemeId }: Props) {
  const [dataSource, setDataSource] = useState<'operacional' | 'comercial'>('operacional');
  const [role, setRole]           = useState<WFMRole>('comercial');
  const [orders, setOrders]       = useState<WFMOrder[]>([]);
  const [fieldTickets, setFieldTickets] = useState<FieldTicket[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelected] = useState<string | null>(null);
  const [dispatchTab, setDispatchTab] = useState<DispatchTab>('checklist');
  const [viewMode, setViewMode]   = useState<ViewMode>('visibilidad');
  const trackTab = useTabTrack('wfm');

  // Forms
  const [newOrder, setNewOrder] = useState({ cliente: '', servicio: '' });
  const [pmMsg, setPmMsg]       = useState('');

  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/api/wfm/sync`, { method: 'POST' });
      await fetchOrders();
    } finally { setSyncing(false); }
  };

  const fetchOrders = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/wfm/ordenes`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      } else {
        throw new Error("API response not OK");
      }
    } catch (e) {
      console.error("Error fetching orders, using mocks", e);
      setOrders([
        { 
          id: 'ODOO-1025', 
          cliente: 'Xcien Corporativo', 
          servicio: 'Enlace Dedicado 1GB', 
          comercial: 'Jesús Morales', 
          estado: 'SOLICITUD_PREVENTA', 
          fecha_creacion: new Date().toISOString(), 
          preventa: { analisis: null, factibilidad: null, tecnologia: null, equipos_sugeridos: [], anteproyecto_url: null }, 
          almacen: { disponibilidad: false, equipos_asignados: [], esperando_inventario: false }, 
          aprovisionamiento: { config_logica: null, parametros_red: {}, listo: false }, 
          pm: { auditoria_ok: false, bloqueada: false, motivo_bloqueo: null, backlogs: [] }, 
          historial: [{ fecha: new Date().toISOString(), accion: 'Creación de solicitud', usuario: 'Comercial' }] 
        },
        { 
          id: 'ODOO-1026', 
          cliente: 'Hospital Santa Engracia', 
          servicio: 'Internet Simétrico 500MB', 
          comercial: 'Ana Rodríguez', 
          estado: 'LISTO_INSTALACION', 
          fecha_creacion: new Date().toISOString(), 
          preventa: { analisis: 'Factible', factibilidad: 'OK', tecnologia: 'Fibra', equipos_sugeridos: [], anteproyecto_url: '#' }, 
          almacen: { disponibilidad: true, equipos_asignados: [], esperando_inventario: false }, 
          aprovisionamiento: { config_logica: 'VLAN 400', parametros_red: {}, listo: true }, 
          pm: { auditoria_ok: true, bloqueada: false, motivo_bloqueo: null, backlogs: [] }, 
          historial: [{ fecha: new Date().toISOString(), accion: 'Aprovisionamiento completado', usuario: 'NOC' }] 
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetch(`${API_BASE}/api/wfm/field-tickets?limit=500`)
      .then(r => r.ok ? r.json() : { tickets: [] })
      .then(d => setFieldTickets(d.tickets || []));
  }, []);

  const handleCreate = async () => {
    if (!newOrder.cliente || !newOrder.servicio) return;
    await fetch(`${API_BASE}/api/wfm/comercial/solicitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newOrder, comercial: 'Usuario Demo' })
    });
    setNewOrder({ cliente: '', servicio: '' });
    fetchOrders();
  };

  const handleAudit = async (ok: boolean) => {
    if (!selectedId) return;
    await fetch(`${API_BASE}/api/wfm/pm/auditar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        order_id: selectedId, 
        ok, 
        motivo: ok ? 'Auditoría aprobada satisfactoriamente' : 'Documentación incompleta / Errores técnicos',
        usuario: 'Auditor PM'
      })
    });
    fetchOrders();
  };

  const handlePreventaUpdate = async () => {
    if (!selectedId) return;
    await fetch(`${API_BASE}/api/wfm/preventa/actualizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        order_id: selectedId, 
        data: { factibilidad: 'OK', tecnologia: 'Fibra', analisis: 'Factible vía FO' },
        usuario: 'Ing. Preventa'
      })
    });
    fetchOrders();
  };

  const handleVentasContratar = async () => {
    if (!selectedId) return;
    await fetch(`${API_BASE}/api/wfm/ventas/contratar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: selectedId, usuario: 'Gerente Ventas' })
    });
    fetchOrders();
  };

  const selectedOrder = orders.find(o => o.id === selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0, position: 'relative' }}>
      {activeThemeId === 'matrix' && <MatrixBackground />}

      {/* ── Toggle fuente de datos ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {([
          ['operacional', '⚡ Habilitaciones & Fallas', '#00B4D8'],
          ['comercial',   '📋 Pipeline Comercial',      G        ],
        ] as const).map(([id, label, col]) => (
          <button key={id} onClick={() => setDataSource(id)} style={{
            padding: '7px 18px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: dataSource === id ? 700 : 400,
            background: dataSource === id ? `${col}20` : 'rgba(255,255,255,0.04)',
            color: dataSource === id ? col : theme.dim,
            boxShadow: dataSource === id ? `0 0 0 1.5px ${col}50` : 'none',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {/* ── Vista Operacional: Habilitaciones & Fallas ── */}
      {dataSource === 'operacional' && <FieldServiceView theme={theme} />}

      {/* ── SLA & Escalamiento en Vivo (Pipeline Comercial) ── */}
      {dataSource === 'comercial' && !loading && (
        <SLAEscalationBanner
          theme={theme}
          orders={orders}
          viewMode={viewMode}
          onViewChange={(v) => { trackTab(v); setViewMode(v); }}
        />
      )}

      {/* ── Vista Cuellos de Botella — solo Pipeline Comercial ── */}
      {dataSource === 'comercial' && viewMode === 'visibilidad' && (
        <VisibilidadView theme={theme} orders={orders} fieldTickets={fieldTickets} />
      )}

      {dataSource === 'comercial' && viewMode !== 'visibilidad' && (<div style={{ display: 'flex', flex: 1, gap: 20, minHeight: 0 }}>
      {/* Sidebar de Roles — hidden in kanban view */}
      {viewMode === 'roles' && <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>Vistas por Rol</h3>
        {(Object.keys(ROLE_DATA) as WFMRole[]).map(r => (
          <button
            key={r}
            onClick={() => setRole(r)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10,
              background: role === r ? `${ROLE_DATA[r].color}15` : 'transparent',
              border: `1px solid ${role === r ? ROLE_DATA[r].color : 'transparent'}`,
              color: role === r ? ROLE_DATA[r].color : theme.dim,
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s'
            }}
          >
            <span style={{ fontSize: 18 }}>{ROLE_DATA[r].icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{ROLE_DATA[r].label}</span>
          </button>
        ))}
      </div>}

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>

        {/* Header Dinámico */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              {viewMode === 'kanban'   ? 'Kanban WFM — Flujo Compartido'
               : viewMode === 'timeline' ? 'Timeline — Avance por Orden'
               : `Dashboard de ${ROLE_DATA[role].label}`}
            </h2>
            <p style={{ fontSize: 12, color: theme.dim }}>
              {viewMode === 'kanban'   ? `${orders.length} órdenes · NOC · PM · Campo · SLA 7hrs total`
               : viewMode === 'timeline' ? `${orders.length} órdenes en pipeline · progreso visual por etapa`
               : 'Gestión de órdenes de implementación y field services'}
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{ padding: '8px 16px', borderRadius: 8, background: syncing ? `${theme.accent}22` : theme.card, border: `1px solid ${syncing ? theme.accent : theme.border}`, color: syncing ? theme.accent : theme.text, cursor: 'pointer', fontWeight: syncing ? 700 : 400, transition: 'all 0.2s' }}
          >
            {syncing ? '⏳ Sincronizando...' : '🔄 Sync Odoo'}
          </button>
        </div>

        {/* ── KANBAN VIEW ── */}
        {viewMode === 'kanban' && !loading && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
            <KanbanView
              theme={theme}
              orders={orders.filter(o => o.estado !== 'CERRADO' && o.estado !== 'BACKLOG')}
              onSelectOrder={id => { setSelected(id); trackTab('roles'); setViewMode('roles'); }}
            />
          </div>
        )}

        {/* ── TIMELINE VIEW ── */}
        {viewMode === 'timeline' && !loading && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <TimelineView
              theme={theme}
              orders={orders}
              onSelectOrder={id => { setSelected(id); trackTab('roles'); setViewMode('roles'); }}
            />
          </div>
        )}

        {loading && viewMode !== 'roles' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.dim }}>
            Cargando órdenes...
          </div>
        )}

        {/* ── ROLES VIEW ── */}
        {viewMode === 'roles' && <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: 20, flex: 1, minHeight: 0 }}>
          
          {/* Listado de Órdenes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', paddingRight: 4 }}>
            {role === 'comercial' && (
              <div style={{ background: `${theme.accent}10`, border: `1px dashed ${theme.accent}40`, borderRadius: 12, padding: 16, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>+ Nueva Solicitud</div>
                <input 
                  placeholder="Cliente" 
                  value={newOrder.cliente}
                  onChange={e => setNewOrder({...newOrder, cliente: e.target.value})}
                  style={{ width: '100%', padding: 8, background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 6, color: '#fff', marginBottom: 8 }}
                />
                <input 
                  placeholder="Servicio (ej. Fibra 100MB)" 
                  value={newOrder.servicio}
                  onChange={e => setNewOrder({...newOrder, servicio: e.target.value})}
                  style={{ width: '100%', padding: 8, background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 6, color: '#fff', marginBottom: 10 }}
                />
                <button 
                  onClick={handleCreate}
                  style={{ width: '100%', padding: 8, background: theme.accent, border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                >
                  Crear Solicitud
                </button>
              </div>
            )}

            {orders.map(o => (
              <div
                key={o.id}
                onClick={() => setSelected(o.id)}
                style={{
                  background: theme.card, border: `1px solid ${selectedId === o.id ? theme.accent : theme.border}`,
                  borderRadius: 12, padding: 14, cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: theme.dim }}>{o.id}</span>
                    {o.odoo_id && <span style={{ fontSize: 9, color: '#00C896', background: '#00C89612', padding: '1px 5px', borderRadius: 4, fontWeight: 800 }}>ODOO</span>}
                  </div>
                  <Badge label={STATE_LABEL[o.estado]} color={STATE_COLOR[o.estado] ?? theme.accent} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{o.cliente}</div>
                <div style={{ fontSize: 11, color: theme.dim, marginBottom: o.revenue || o.comercial ? 6 : 0 }}>{o.servicio}</div>
                {(o.revenue || o.comercial) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {o.comercial && <span style={{ fontSize: 10, color: theme.dim }}>👤 {o.comercial.split(' ')[0]}</span>}
                    {o.revenue ? <span style={{ fontSize: 10, fontWeight: 700, color: theme.accent }}>${o.revenue.toLocaleString()}</span> : null}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Panel de Detalles y Acciones */}
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {selectedOrder ? (
              <>
                <div style={{ padding: 20, borderBottom: `1px solid ${theme.border}`, background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{selectedOrder.cliente}</div>
                  <div style={{ display: 'flex', gap: 15, marginTop: 8 }}>
                    <span style={{ fontSize: 13, color: theme.dim }}>📦 Servicio: <b>{selectedOrder.servicio}</b></span>
                    <span style={{ fontSize: 13, color: theme.dim }}>👤 Comercial: <b>{selectedOrder.comercial}</b></span>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 15, textTransform: 'uppercase', color: ROLE_DATA[role].color }}>Acciones de {role.toUpperCase()}</h4>
                  
                  {/* Vista específica por ROL */}
                  {role === 'preventa' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: 15, borderRadius: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Evaluación de Factibilidad</div>
                        <textarea placeholder="Detalle técnico de factibilidad..." style={{ width: '100%', height: 80, background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 6, color: '#fff', padding: 10 }} />
                        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                          <button 
                            onClick={handlePreventaUpdate}
                            style={{ flex: 1, padding: 10, background: theme.accent, border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Generar Anteproyecto (US-009)
                          </button>
                        </div>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: 15, borderRadius: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Cierre de Venta (Oportunidad Ganada)</div>
                        <button 
                          onClick={handleVentasContratar}
                          style={{ width: '100%', padding: 10, background: '#00C896', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                        >
                          Marcar como Ganada y Emitir Token
                        </button>
                      </div>
                    </div>
                  )}

                  {role === 'almacen' && (
                    <AlmacenPanel theme={theme} order={selectedOrder} onRefresh={fetchOrders} />
                  )}

                  {role === 'aprovisionamiento' && (
                    <AprovisionamientoPanel theme={theme} order={selectedOrder} onRefresh={fetchOrders} />
                  )}

                  {role === 'pm' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                       <div style={{ background: 'rgba(255,255,255,0.03)', padding: 15, borderRadius: 10, border: `1px solid ${selectedOrder.pm.bloqueada ? '#FF4757' : 'transparent'}` }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Auditoría de Documento Único (US-025)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <button 
                            onClick={() => handleAudit(true)}
                            style={{ padding: 10, background: '#00C896', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Aprobar Instalación
                          </button>
                          <button 
                            onClick={() => handleAudit(false)}
                            style={{ padding: 10, background: '#FF4757', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Rechazar / Backlog
                          </button>
                        </div>
                      </div>
                      <div style={{ background: 'rgba(0,255,136,0.05)', padding: 15, borderRadius: 10, border: `1px dashed ${G}` }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: G }}>✨ HIGIENE TOTAL: BIDRILLAS 2026</div>
                        <p style={{ fontSize: 11, color: theme.dim, marginBottom: 12 }}>Generar reporte de cumplimiento y evidencia de sitio limpio para el cliente.</p>
                        <button 
                          onClick={async () => {
                            await fetch(`${API_BASE}/api/bridge/query`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ command: 'generate_bidrillas_pdf' })
                            });
                            setPmMsg("✅ Reporte 'Higiene Total' generado en /backend/db/"); setTimeout(() => setPmMsg(''), 5000);
                          }}
                          style={{ width: '100%', padding: 10, background: G, border: 'none', borderRadius: 6, color: '#000', fontWeight: 800, cursor: 'pointer' }}
                        >
                          GENERAR REPORTE DE CIERRE PDF
                        </button>
                        {pmMsg && <div style={{ marginTop: 10, padding: '6px 10px', background: '#00ff8820', borderRadius: 6, fontSize: 11, color: G }}>{pmMsg}</div>}
                      </div>
                    </div>
                  )}
                  {role === 'dispatch' && selectedOrder && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* Tab bar */}
                      <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 4, alignSelf: 'flex-start' }}>
                        {([
                          ['bidrillas', '🚛 Equipos'],
                          ['checklist', '📋 Checklist'],
                          ['pruebas',   '📡 Velocidad'],
                          ['evidencias','📸 Evidencias'],
                        ] as [DispatchTab, string][]).map(([id, label]) => (
                          <button key={id} onClick={() => { trackTab(id); setDispatchTab(id); }} style={{
                            padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                            background: dispatchTab === id ? `${G}22` : 'transparent',
                            color: dispatchTab === id ? G : theme.dim,
                            fontSize: 11, fontWeight: dispatchTab === id ? 700 : 500,
                            boxShadow: dispatchTab === id ? `0 0 0 1px ${G}40` : 'none',
                            transition: 'all 0.15s',
                          }}>
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Bidrillas */}
                      {dispatchTab === 'bidrillas' && (
                        <div style={{ background: 'rgba(0,255,136,0.05)', padding: 15, borderRadius: 10, border: `1px solid ${G}` }}>
                          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: G }}>🚛 GESTIÓN DE EQUIPOS EN CAMPO</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {[
                              { id: 'B-01', name: 'Escuadrón Alpha', status: 'En Sitio', tech: 'Laura Garza' },
                              { id: 'B-02', name: 'Escuadrón Delta', status: 'Trayecto', tech: 'Ana Rodríguez' }
                            ].map(b => (
                              <div key={b.id} style={{ padding: 12, background: theme.bg, borderRadius: 8, border: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 700 }}>{b.id} — {b.name}</div>
                                  <div style={{ fontSize: 10, color: theme.dim }}>Líder: {b.tech}</div>
                                </div>
                                <Badge label={b.status} color={b.status === 'En Sitio' ? G : '#4FC3F7'} />
                              </div>
                            ))}
                          </div>
                          <button style={{ width: '100%', marginTop: 15, padding: 10, background: 'transparent', border: `1px solid ${G}`, color: G, borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            + ASIGNAR NUEVO EQUIPO
                          </button>
                        </div>
                      )}

                      {/* Checklist US-036 */}
                      {dispatchTab === 'checklist' && (
                        <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 16 }}>
                          <ChecklistPanel theme={theme} order={selectedOrder} onRefresh={fetchOrders} />
                        </div>
                      )}

                      {/* Pruebas velocidad US-038–040 */}
                      {dispatchTab === 'pruebas' && (
                        <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 16 }}>
                          <PruebasVelocidadPanel theme={theme} order={selectedOrder} onRefresh={fetchOrders} />
                        </div>
                      )}

                      {/* Evidencias US-041A */}
                      {dispatchTab === 'evidencias' && (
                        <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 16 }}>
                          <EvidenciasPanel theme={theme} order={selectedOrder} onRefresh={fetchOrders} />
                        </div>
                      )}
                    </div>
                  )}

                  {role === 'dispatch' && !selectedOrder && (
                    <div style={{ color: theme.dim, fontSize: 13 }}>Selecciona una orden para gestionar campo.</div>
                  )}

                  {role === 'noc' && (
                    <NocValidacionPanel theme={theme} order={selectedOrder} onRefresh={fetchOrders} />
                  )}

                  {role === 'gerencia' && (
                    <KPIsPanel theme={theme} order={selectedOrder} />
                  )}

                  <div style={{ marginTop: 30 }}>
                    <h5 style={{ fontSize: 12, fontWeight: 700, color: theme.dim, marginBottom: 10 }}>Historial de la Orden</h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selectedOrder.historial.map((h, i) => (
                        <div key={i} style={{ fontSize: 11, color: theme.dim, padding: '4px 0', borderBottom: `1px solid ${theme.border}` }}>
                          <b>{h.fecha.split('T')[1].substring(0,5)}</b> · {h.accion} (<i>{h.usuario}</i>)
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: theme.dim }}>
                <span style={{ fontSize: 40, marginBottom: 20 }}>📁</span>
                <p>Selecciona una orden de implementación para ver detalles</p>
              </div>
            )}
          </div>

        </div>}

      </div>
      </div>)}
    </div>
  );
}
