import { ThemeConfig } from '../types';
import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { API_BASE } from '../../../config';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface TareaResumen {
  id: number;
  nombre: string;
  etapa: string;
  deadline: string | null;
  creado: string;
}

interface Mensaje {
  id: number;
  autor: string;
  fecha: string;
  cuerpo: string;
  tipo: string;
}

interface EtapaDisponible { id: number; nombre: string; }

interface TareaDetalle {
  id: number;
  nombre: string;
  descripcion: string;
  etapa_id: number | null;
  etapa: string;
  tecnicos: { id: number; nombre: string }[];
  cliente: string | null;
  proyecto: string | null;
  prioridad: 'normal' | 'alta';
  deadline: string | null;
  creado: string;
  mensajes: Mensaje[];
  etapas_disponibles: EtapaDisponible[];
}

interface Tecnico {
  id: string;
  odoo_id: number;
  nombre: string;
  alias: string;
  rol: string;
  total: number;
  abiertos: number;
  cerrados: number;
  pct_resolucion: number;
  tareas: TareaResumen[];
}

// ── Task Detail Drawer ────────────────────────────────────────────────────────
function TareaDrawer({
  taskId, theme, onClose, onUpdated,
}: { taskId: number; theme: ThemeConfig; onClose: () => void; onUpdated: () => void }) {
  const [detalle, setDetalle] = useState<TareaDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cambiandoEtapa, setCambiando] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchDetalle = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/bidrillas/tarea/${taskId}`);
      if (res.ok) setDetalle(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchDetalle(); }, [taskId]);
  useEffect(() => {
    if (detalle) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detalle?.mensajes.length]);

  const enviarComentario = async () => {
    if (!comentario.trim()) return;
    setEnviando(true);
    try {
      await fetch(`${API_BASE}/api/wfm/bidrillas/tarea/${taskId}/comentario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuerpo: comentario }),
      });
      setComentario('');
      await fetchDetalle();
    } finally { setEnviando(false); }
  };

  const cambiarEtapa = async (etapa_id: number) => {
    setCambiando(true);
    try {
      await fetch(`${API_BASE}/api/wfm/bidrillas/tarea/${taskId}/etapa`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etapa_id }),
      });
      await fetchDetalle();
      onUpdated();
    } finally { setCambiando(false); }
  };

  const etapaColor = (e: string) => {
    const s = e.toLowerCase();
    if (s.includes('done') || s.includes('resuel')) return '#00C896';
    if (s.includes('visit') || s.includes('campo'))  return '#FF6B35';
    return '#00B4D8';
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      />

      {/* Drawer */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 560,
        background: theme.bg, borderLeft: `1px solid ${theme.border}`,
        display: 'flex', flexDirection: 'column', height: '100%',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.4)',
      }}>

        {/* Drawer header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${theme.border}`,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading
              ? <div style={{ color: theme.dim, fontSize: 13 }}>Cargando bidrillas en campo…</div>
              : <div style={{ fontSize: 15, fontWeight: 700, color: theme.text, lineHeight: 1.3 }}>
                  {detalle?.nombre}
                </div>
            }
            {detalle && (
              <div style={{ fontSize: 11, color: theme.dim, marginTop: 4 }}>
                {detalle.cliente && <span>👤 {detalle.cliente} · </span>}
                <span>��� {detalle.proyecto}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: theme.dim, fontSize: 20,
            cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0,
          }}>✕</button>
        </div>

        {/* Drawer body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {detalle && (
            <>
              {/* Meta strip */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                  background: `${etapaColor(detalle.etapa)}20`, color: etapaColor(detalle.etapa),
                  border: `1px solid ${etapaColor(detalle.etapa)}50`,
                }}>{detalle.etapa}</span>
                {detalle.prioridad === 'alta' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#FFB70320', color: '#FFB703', border: '1px solid #FFB70350' }}>
                    ⚡ ALTA PRIORIDAD
                  </span>
                )}
                {detalle.deadline && (
                  <span style={{ fontSize: 10, color: theme.dim }}>
                    📅 {new Date(detalle.deadline).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              {/* Técnicos */}
              {detalle.tecnicos.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 6, textTransform: 'uppercase' }}>Asignado a</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {detalle.tecnicos.map(t => (
                      <span key={t.id} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: `${theme.accent}15`, color: theme.accent, border: `1px solid ${theme.accent}40` }}>
                        👷 {t.nombre}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Descripción */}
              {detalle.descripcion && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 6, textTransform: 'uppercase' }}>Descripción</div>
                  <div style={{
                    fontSize: 11, color: theme.text, lineHeight: 1.6,
                    background: 'rgba(255,255,255,0.03)', borderRadius: 8,
                    padding: '10px 12px', border: `1px solid ${theme.border}`,
                    maxHeight: 180, overflowY: 'auto', whiteSpace: 'pre-wrap',
                  }}>
                    {detalle.descripcion}
                  </div>
                </div>
              )}

              {/* Cambiar etapa */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>Cambiar etapa</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {detalle.etapas_disponibles.map(e => {
                    const active = e.id === detalle.etapa_id;
                    const col    = etapaColor(e.nombre);
                    return (
                      <button
                        key={e.id}
                        onClick={() => !active && cambiarEtapa(e.id)}
                        disabled={active || cambiandoEtapa}
                        style={{
                          padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: active ? 700 : 400,
                          background: active ? `${col}25` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${active ? col : theme.border}`,
                          color: active ? col : theme.dim,
                          cursor: active ? 'default' : 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        {active ? '● ' : ''}{e.nombre}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chatter */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>
                  Chatter Odoo ({detalle.mensajes.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                  {detalle.mensajes.length === 0 && (
                    <div style={{ fontSize: 11, color: theme.dim, textAlign: 'center', padding: 16 }}>Sin mensajes aún</div>
                  )}
                  {detalle.mensajes.map(m => (
                    <div key={m.id} style={{
                      padding: '10px 12px', borderRadius: 10,
                      background: m.tipo === 'comment'
                        ? `${theme.accent}08`
                        : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${m.tipo === 'comment' ? theme.accent + '30' : theme.border}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: theme.accent }}>{m.autor}</span>
                        <span style={{ fontSize: 9, color: theme.dim }}>
                          {new Date(m.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: theme.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.cuerpo}</div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Comentario input — fixed at bottom */}
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.border}`, background: theme.bg }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) enviarComentario(); }}
              placeholder="Escribe un comentario... (⌘↵ para enviar)"
              rows={2}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8, resize: 'none',
                background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
                color: theme.text, fontSize: 12, fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <button
              onClick={enviarComentario}
              disabled={enviando || !comentario.trim()}
              style={{
                padding: '0 16px', borderRadius: 8, border: 'none',
                background: comentario.trim() ? theme.accent : 'rgba(255,255,255,0.06)',
                color: comentario.trim() ? '#000' : theme.dim,
                fontWeight: 700, fontSize: 12, cursor: 'pointer',
                transition: 'all 0.15s', alignSelf: 'stretch',
              }}
            >
              {enviando ? '...' : '↑ Enviar'}
            </button>
          </div>
          <div style={{ fontSize: 9, color: theme.dim, marginTop: 4 }}>El comentario se publicará en Odoo Field Service</div>
        </div>
      </div>
    </div>
  );
}

// ── Desempeño Tab ─────────────────────────────────────────────────────────────
interface DesempenoTecnico {
  odoo_id: number; alias: string; nombre: string; rank: number;
  total: number; cerradas: number; abiertos: number; mensajes: number;
  pct_resolucion: number; pct_doc: number; pct_vol: number; pct_puntual: number;
  score: number;
  detalle: { resolucion_pts: number; doc_pts: number; volumen_pts: number };
}

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
    </div>
  );
}

function DesempenoTab({ theme }: { theme: ThemeConfig }) {
  const [data, setData]       = useState<{ tecnicos: DesempenoTecnico[]; formula: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/wfm/bidrillas/desempeno`)
      .then(r => r.json())
      .then(json => setData(json && typeof json === 'object' && !Array.isArray(json) ? json : null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: theme.dim }}>Calculando scores desde Odoo...</div>;
  if (!data)   return null;

  const MEDAL = ['🥇','🥈','🥉'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Formula badge */}
      <div style={{ fontSize: 10, color: theme.dim, padding: '6px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: `1px solid ${theme.border}`, display: 'inline-block', alignSelf: 'flex-start' }}>
        📐 {data.formula}
      </div>

      {/* Ranking cards */}
      {data.tecnicos.map(t => {
        const scoreColor = t.score >= 70 ? '#00C896' : t.score >= 40 ? '#FFB703' : '#FF4757';
        return (
          <div key={t.odoo_id} style={{
            background: theme.card, borderRadius: 16, padding: 22,
            border: `1px solid ${t.rank === 1 ? '#FFD70050' : theme.border}`,
            position: 'relative', overflow: 'hidden',
          }}>
            {/* Gold shimmer for #1 */}
            {t.rank === 1 && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #FFD700, #FFA500, #FFD700)' }} />}

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
              {/* Rank + medal */}
              <div style={{ textAlign: 'center', minWidth: 48 }}>
                <div style={{ fontSize: 28 }}>{MEDAL[t.rank - 1] ?? `#${t.rank}`}</div>
                <div style={{ fontSize: 9, color: theme.dim, fontWeight: 700 }}>RANK</div>
              </div>

              {/* Name + score */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: theme.text }}>{t.alias}</div>
                <div style={{ fontSize: 10, color: theme.dim }}>{t.nombre}</div>
              </div>

              {/* Score circle */}
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: `conic-gradient(${scoreColor} ${t.score * 3.6}deg, rgba(255,255,255,0.06) 0deg)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <div style={{ width: 50, height: 50, borderRadius: '50%', background: theme.card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{t.score}</div>
                  <div style={{ fontSize: 7, color: theme.dim }}>/ 100</div>
                </div>
              </div>
            </div>

            {/* Metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Tareas cerradas', val: t.cerradas,           color: '#00C896' },
                { label: 'Tasa resolución', val: `${t.pct_resolucion}%`, color: t.pct_resolucion > 30 ? '#00C896' : '#FFB703' },
                { label: 'Mensajes Odoo',   val: t.mensajes,            color: '#00B4D8' },
                { label: 'Abiertas',        val: t.abiertos,            color: t.abiertos > 20 ? '#FF4757' : '#FFB703' },
              ].map(k => (
                <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', border: `1px solid ${theme.border}`, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.val}</div>
                  <div style={{ fontSize: 8, color: theme.dim, fontWeight: 700, marginTop: 2 }}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Score breakdown bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Tasa de resolución', pts: t.detalle.resolucion_pts, max: 35, pct: t.pct_resolucion, color: '#00C896', weight: '35%' },
                { label: 'Documentación',       pts: t.detalle.doc_pts,        max: 35, pct: t.pct_doc,        color: '#00B4D8', weight: '35%' },
                { label: 'Volumen completado',  pts: t.detalle.volumen_pts,    max: 30, pct: t.pct_vol,        color: '#FF6B35', weight: '30%' },
              ].map(m => (
                <div key={m.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 9, color: theme.dim, fontWeight: 600 }}>{m.label} <span style={{ color: theme.dim, opacity: 0.6 }}>({m.weight})</span></span>
                    <span style={{ fontSize: 9, color: m.color, fontWeight: 700 }}>{m.pts} / {m.max} pts — {m.pct}%</span>
                  </div>
                  <ScoreBar value={m.pts} max={m.max} color={m.color} />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 10, color: theme.dim, textAlign: 'center', padding: '8px 0' }}>
        Datos calculados en tiempo real desde Odoo Field Service · Actualización automática
      </div>
    </div>
  );
}


// ── GPS Interfaces ────────────────────────────────────────────────────────────
interface Vehiculo {
  id: number;
  nombre: string;
  placa: string;
  make: string;
  model: string;
  lat: number;
  lng: number;
  velocidad: number;
  direccion: number;
  ultima_vez: string | null;
  ubicacion: string;
  activo: boolean;
  activo_hoy: boolean;
  km_hoy: number;
  viajes_hoy: number;
  conductor: string;
}

function vehiculoIcon(v: Vehiculo) {
  // verde = en movimiento ahora, azul = activo hoy, gris = sin actividad hoy
  const color = v.activo ? '#00ff88' : v.activo_hoy ? '#38BDF8' : '#556070';
  const ring  = v.activo
    ? `<circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 2" opacity="0.6"/>`
    : '';
  // ícono de camioneta
  const truck = `<path d="M5 19h2v1a1 1 0 002 0v-1h10v1a1 1 0 002 0v-1h2v-5l-3-6H5v11zm2-9h14l2.4 5H7V10z" fill="${color}" opacity="0.9"/>`;
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.8"/>
      ${ring}
      ${truck}
    </svg>`);
  return L.divIcon({
    html: `<img src="data:image/svg+xml,${svg}" width="36" height="36"/>`,
    className: '', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20],
  });
}

function MapFitter({ vehiculos }: { vehiculos: Vehiculo[] }) {
  const map = useMap();
  useEffect(() => {
    if (vehiculos.length === 0) return;
    const valid = vehiculos.filter(v => v.lat && v.lng);
    if (valid.length === 0) return;
    const bounds = L.latLngBounds(valid.map(v => [v.lat, v.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [vehiculos.length]);
  return null;
}

function GPSTab({ theme }: { theme: ThemeConfig }) {
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [selected, setSelected]   = useState<Vehiculo | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGPS = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/gps/vehiculos`);
      const data = await res.json();
      setVehiculos(data.vehiculos ?? []);
      setLastUpdate(new Date().toLocaleTimeString('es-MX'));
    } catch {
      // silently keep stale data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGPS();
    intervalRef.current = setInterval(fetchGPS, 90_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchGPS]);

  const enMovimiento = vehiculos.filter(v => v.activo).length;
  const activosHoy   = vehiculos.filter(v => v.activo_hoy).length;
  const sinActividad = vehiculos.filter(v => !v.activo_hoy).length;
  const kmTotales    = vehiculos.reduce((s, v) => s + (v.km_hoy ?? 0), 0);
  const [filtro, setFiltro] = useState<'todos' | 'movimiento' | 'hoy' | 'sin'>('todos');

  const vehiculosFiltrados = vehiculos.filter(v => {
    if (filtro === 'movimiento') return v.activo;
    if (filtro === 'hoy')        return v.activo_hoy && !v.activo;
    if (filtro === 'sin')        return !v.activo_hoy;
    return true;
  });

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 80, color: theme.dim }}>
      Conectando a TN360...
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* KPI bar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Total c/ GPS',    val: vehiculos.length,            col: theme.accent,  f: 'todos'      },
          { label: 'En movimiento',   val: enMovimiento,                col: '#00ff88',     f: 'movimiento' },
          { label: 'Activas hoy',     val: activosHoy,                  col: '#38BDF8',     f: 'hoy'        },
          { label: 'Sin actividad',   val: sinActividad,                col: '#556070',     f: 'sin'        },
          { label: 'KM totales hoy',  val: `${kmTotales.toFixed(0)} km`, col: '#FFB703',    f: null         },
        ].map(k => (
          <div
            key={k.label}
            onClick={() => k.f && setFiltro(k.f as any)}
            style={{
              flex: 1, minWidth: 90, background: theme.card,
              border: `1px solid ${filtro === k.f ? k.col + '80' : theme.border}`,
              borderRadius: 10, padding: '10px 14px',
              cursor: k.f ? 'pointer' : 'default',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: k.col }}>{k.val}</div>
            <div style={{ fontSize: 9, color: theme.dim, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
          </div>
        ))}
        <div style={{ flex: 1, minWidth: 90, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: theme.dim }}>Última sync</div>
          <div style={{ fontSize: 12, color: theme.text, fontWeight: 600, marginTop: 3 }}>{lastUpdate}</div>
          <div style={{ fontSize: 9, color: theme.dim, marginTop: 2 }}>Auto · 90 seg</div>
        </div>
      </div>

      {/* Leyenda colores */}
      <div style={{ display: 'flex', gap: 16, fontSize: 10, color: theme.dim }}>
        <span><span style={{ color: '#00ff88' }}>●</span> En movimiento ahora</span>
        <span><span style={{ color: '#38BDF8' }}>●</span> Activa hoy · detenida</span>
        <span><span style={{ color: '#556070' }}>●</span> Sin actividad hoy</span>
      </div>

      {/* Mapa + lista lado a lado */}
      <div style={{ display: 'flex', gap: 14, height: 520 }}>

        {/* Mapa */}
        <div style={{ flex: 1, borderRadius: 14, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
          {vehiculosFiltrados.length > 0 ? (
            <MapContainer
              center={[25.6, -100.3]}
              zoom={9}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; CARTO'
              />
              <MapFitter vehiculos={vehiculosFiltrados} />
              {vehiculosFiltrados.map(v => (
                <Marker
                  key={v.id}
                  position={[v.lat, v.lng]}
                  icon={vehiculoIcon(v)}
                  eventHandlers={{ click: () => setSelected(v) }}
                >
                  <Popup>
                    <div style={{ fontFamily: 'system-ui,sans-serif', fontSize: 12, minWidth: 190 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{v.nombre}</div>
                      <div style={{ color: '#666', marginBottom: 6 }}>{v.placa} · {v.make} {v.model}</div>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
                        <div style={{ flex: 1, background: '#f4f4f4', borderRadius: 6, padding: '4px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: v.activo ? '#00C896' : '#555' }}>{v.velocidad}</div>
                          <div style={{ fontSize: 9, color: '#888' }}>km/h</div>
                        </div>
                        <div style={{ flex: 1, background: '#f4f4f4', borderRadius: 6, padding: '4px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#2980B9' }}>{(v.km_hoy ?? 0).toFixed(0)}</div>
                          <div style={{ fontSize: 9, color: '#888' }}>km hoy</div>
                        </div>
                        <div style={{ flex: 1, background: '#f4f4f4', borderRadius: 6, padding: '4px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#8B5CF6' }}>{v.viajes_hoy}</div>
                          <div style={{ fontSize: 9, color: '#888' }}>viajes</div>
                        </div>
                      </div>
                      {v.conductor && <div style={{ fontSize: 11, color: '#444', marginBottom: 4 }}>👤 {v.conductor}</div>}
                      <div style={{ fontSize: 10, color: '#888', lineHeight: 1.4 }}>{v.ubicacion}</div>
                      <div style={{ fontSize: 9, color: '#aaa', marginTop: 3 }}>{v.ultima_vez} UTC</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.dim }}>
              Sin vehículos para el filtro seleccionado
            </div>
          )}
        </div>

        {/* Tabla lateral con header fijo */}
        <div style={{ width: 360, display: 'flex', flexDirection: 'column', border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {/* Header fijo */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '28px 1fr 70px 52px 36px',
            gap: 0,
            padding: '9px 12px',
            background: theme.surface ?? theme.card,
            borderBottom: `2px solid ${theme.border}`,
            position: 'sticky', top: 0, zIndex: 2,
            flexShrink: 0,
          }}>
            {['', 'Unidad / Conductor', 'KM hoy', 'Viajes', 'Vel'].map((h, i) => (
              <div key={i} style={{ fontSize: 11, fontWeight: 700, color: theme.dim, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>
          {/* Filas scrollables */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {vehiculosFiltrados.map(v => {
              const dotColor = v.activo ? '#00ff88' : v.activo_hoy ? '#38BDF8' : '#556070';
              const isSelected = selected?.id === v.id;
              return (
                <div
                  key={v.id}
                  onClick={() => setSelected(v)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 1fr 70px 52px 36px',
                    gap: 0,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    background: isSelected ? `${theme.accent}14` : 'transparent',
                    borderBottom: `1px solid ${theme.border}`,
                    borderLeft: `3px solid ${isSelected ? theme.accent : 'transparent'}`,
                    transition: 'background 0.12s',
                    alignItems: 'center',
                  }}
                >
                  {/* dot estado */}
                  <div style={{ fontSize: 13, color: dotColor, lineHeight: 1 }}>●</div>
                  {/* Unidad + conductor */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.nombre}
                    </div>
                    <div style={{ fontSize: 12, color: theme.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                      {v.conductor || v.placa}
                    </div>
                  </div>
                  {/* KM hoy */}
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#38BDF8' }}>{(v.km_hoy ?? 0).toFixed(0)}</span>
                    <span style={{ fontSize: 11, color: theme.dim }}> km</span>
                  </div>
                  {/* Viajes */}
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#a78bfa', textAlign: 'right' }}>{v.viajes_hoy ?? 0}</div>
                  {/* Velocidad */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: v.activo ? '#00ff88' : theme.dim, textAlign: 'right' }}>
                    {v.activo ? v.velocidad : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Panel detalle */}
      {selected && (
        <div style={{ background: theme.card, border: `1px solid ${theme.accent}40`, borderRadius: 12, padding: 16, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Unidad</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: theme.text }}>{selected.nombre}</div>
            <div style={{ fontSize: 11, color: theme.dim }}>{selected.placa} · {selected.make} {selected.model}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase' }}>Velocidad</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: selected.activo ? '#00ff88' : theme.accent }}>{selected.velocidad} <span style={{ fontSize: 11 }}>km/h</span></div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase' }}>KM hoy</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#38BDF8' }}>{(selected.km_hoy ?? 0).toFixed(1)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase' }}>Viajes hoy</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#8B5CF6' }}>{selected.viajes_hoy}</div>
          </div>
          {selected.conductor && (
            <div>
              <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase' }}>Conductor</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginTop: 2 }}>👤 {selected.conductor}</div>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase' }}>Última ubicación</div>
            <div style={{ fontSize: 12, color: theme.text, marginTop: 2, lineHeight: 1.4 }}>{selected.ubicacion || '—'}</div>
            <div style={{ fontSize: 10, color: theme.dim, marginTop: 3 }}>{selected.ultima_vez} UTC</div>
          </div>
          <button onClick={() => setSelected(null)} style={{ padding: '4px 10px', borderRadius: 6, background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim, cursor: 'pointer', fontSize: 11 }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ── Cruce GPS × Tickets Tab ───────────────────────────────────────────────────
type Periodo = 'diario' | 'semanal' | 'mensual';

interface ViajesFueraDet {
  cls: 'nocturno' | 'madrugada' | 'finde';
  hora_local: string;
  km: number;
  start: string;
  end: string;
  driver_uid: number | null;
  driver_nombre: string;
}

interface ConductorReal {
  nombre: string;
  email: string;
  n_viajes: number;
}

interface CruceRow {
  vehiculo_id: string;
  vehiculo: string;
  placa: string;
  conductor: string | null;
  email: string;
  sin_cuenta_odoo: boolean;
  km_semana: number;
  km_fuera: number;
  km_madrugada: number;
  km_finde: number;
  pct_fuera: number;
  horas_campo: number;
  n_viajes: number;
  tickets: number | 'sin cuenta';
  cerrados: number;
  abiertos: number;
  alerta: 'ok' | 'sin_gps' | 'sin_tickets' | 'inactivo';
  conductores_reales: ConductorReal[];
  conductor_mismatch: boolean;
  viajes_fuera_detalle: ViajesFueraDet[];
}

interface CruceData {
  semana: string;
  plaza: string;
  version: string;
  cruce: CruceRow[];
  sin_conductor: { vehiculo: string; placa: string }[];
  alto_riesgo: CruceRow[];
  todos_tecnicos: string[];
  resumen: {
    vehiculos_activos: number;
    vehiculos_total: number;
    con_conductor: number;
    sin_conductor: number;
    km_total: number;
    km_fuera_total: number;
    viajes_total: number;
    tickets_semana: number;
    km_madrugada_total: number;
    mismatch_conductores: number;
    alertas: number;
    alto_riesgo_count: number;
  };
  veh_map: Record<string, string>;
}

const ALERTA_CFG = {
  ok:           { label: '✓ OK',         color: '#00C896', bg: '#00C89615' },
  sin_gps:      { label: '⚠ Sin GPS',    color: '#FFB703', bg: '#FFB70315' },
  sin_tickets:  { label: '● Sin tickets', color: '#00B4D8', bg: '#00B4D815' },
  inactivo:     { label: '— Inactivo',    color: '#555',    bg: 'transparent' },
};

const PERIODO_LABEL: Record<Periodo, string> = {
  diario:  'Hoy',
  semanal: 'Esta semana',
  mensual: 'Este mes',
};

const PLAZAS = [
  { id: '',              label: 'Nacional' },
  { id: 'piedras_negras', label: 'Piedras Negras' },
  { id: 'yucatan',       label: 'Yucatán' },
];

function CruceGPSTab({ theme }: { theme: ThemeConfig }) {
  const [periodo,    setPeriodo]    = useState<Periodo>('semanal');
  const [plaza,      setPlaza]      = useState<string>('');
  const [data,       setData]       = useState<CruceData | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [sending,    setSending]    = useState(false);
  const [reportMsg,  setReportMsg]  = useState<string | null>(null);
  const [editMap,    setEditMap]    = useState<Record<string, string>>({});
  const [savingMap,  setSavingMap]  = useState(false);
  const [filterAlerta, setFilterAlerta] = useState<string>('todos');
  const [expanded,   setExpanded]   = useState<string | null>(null);

  const fetchCruce = async (p: Periodo, pz: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ periodo: p });
      if (pz) params.set('plaza', pz);
      const res  = await fetch(`${API_BASE}/api/wfm/bidrillas/cruce-semanal?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d: CruceData = await res.json();
      setData(d);
      setEditMap({ ...d.veh_map });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCruce(periodo, plaza); }, [periodo, plaza]);

  const generarReporte = async () => {
    setSending(true);
    setReportMsg(null);
    try {
      const params = new URLSearchParams({ periodo });
      if (plaza) params.set('plaza', plaza);
      const res  = await fetch(`${API_BASE}/api/wfm/bidrillas/cruce-semanal/reporte?${params}`, { method: 'POST' });
      const json = await res.json();
      const plazaLabel = PLAZAS.find(p => p.id === plaza)?.label || 'Nacional';
      setReportMsg(json.telegram
        ? `PDF ${plazaLabel} enviado a Telegram ✓ · ${json.semana}`
        : `PDF generado (sin Telegram) · ${json.semana}`);
    } catch (e: any) {
      setReportMsg(`Error: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  const saveMap = async () => {
    setSavingMap(true);
    try {
      await fetch(`${API_BASE}/api/wfm/bidrillas/vehiculo-tecnico-map`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editMap),
      });
      await fetchCruce(periodo);
    } finally {
      setSavingMap(false);
    }
  };

  const rows = (data?.cruce ?? []).map(r => ({ ...r, viajes_fuera_detalle: r.viajes_fuera_detalle ?? [] }));
  const filteredRows = filterAlerta === 'todos' ? rows : rows.filter(r => r.alerta === filterAlerta);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Period + plaza + actions bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, color: theme.dim, fontWeight: 700 }}>PERÍODO:</div>
        {(['diario','semanal','mensual'] as Periodo[]).map(p => (
          <button key={p} onClick={() => { setPeriodo(p); }}
            style={{
              padding: '6px 16px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: periodo === p ? 700 : 400,
              background: periodo === p ? `${theme.accent}25` : 'rgba(255,255,255,0.05)',
              color: periodo === p ? theme.accent : theme.dim,
              boxShadow: periodo === p ? `0 0 0 1.5px ${theme.accent}50` : 'none',
            }}>
            {PERIODO_LABEL[p]}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: theme.border }} />
        <div style={{ fontSize: 11, color: theme.dim, fontWeight: 700 }}>PLAZA:</div>
        {PLAZAS.map(pz => (
          <button key={pz.id} onClick={() => setPlaza(pz.id)}
            style={{
              padding: '6px 16px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: plaza === pz.id ? 700 : 400,
              background: plaza === pz.id ? '#8B5CF625' : 'rgba(255,255,255,0.05)',
              color: plaza === pz.id ? '#8B5CF6' : theme.dim,
              boxShadow: plaza === pz.id ? '0 0 0 1.5px #8B5CF650' : 'none',
            }}>
            {pz.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => fetchCruce(periodo, plaza)} disabled={loading}
          style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.dim, fontSize: 11, cursor: 'pointer' }}>
          🔄 Actualizar
        </button>
        <button onClick={generarReporte} disabled={sending || loading}
          style={{
            padding: '6px 18px', borderRadius: 8, border: 'none', cursor: sending ? 'not-allowed' : 'pointer',
            background: sending ? 'rgba(255,255,255,0.06)' : theme.accent,
            color: sending ? theme.dim : '#000', fontWeight: 700, fontSize: 11,
          }}>
          {sending ? '⏳ Generando...' : '📄 Generar Reporte PDF'}
        </button>
      </div>

      {reportMsg && (
        <div style={{ padding: '10px 16px', borderRadius: 8, background: reportMsg.startsWith('Error') ? '#FF475715' : '#00C89615', color: reportMsg.startsWith('Error') ? '#FF4757' : '#00C896', fontSize: 12, fontWeight: 600 }}>
          {reportMsg}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: theme.dim, fontSize: 13 }}>
          Cruzando GPS TN360 × Odoo Field Service...
        </div>
      )}
      {error && (
        <div style={{ padding: 16, borderRadius: 8, background: '#FF475710', color: '#FF4757', fontSize: 12 }}>
          Error: {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            {[
              { label: 'Con conductor',      val: `${data.resumen.con_conductor} / ${data.resumen.vehiculos_total}`, color: theme.accent },
              { label: 'Km totales',         val: `${data.resumen.km_total.toLocaleString('es-MX')} km`, color: '#00B4D8' },
              { label: 'Km fuera horario',   val: `${data.resumen.km_fuera_total.toLocaleString('es-MX')} km`, color: '#FFB703' },
              { label: 'Tickets Odoo',       val: data.resumen.tickets_semana, color: '#FFD700' },
              { label: 'Alto riesgo',        val: data.resumen.alto_riesgo_count, color: data.resumen.alto_riesgo_count > 0 ? '#FF4757' : '#00C896' },
            ].map(k => (
              <div key={k.label} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: k.color, fontVariantNumeric: 'tabular-nums' }}>{k.val}</div>
                <div style={{ fontSize: 9, color: theme.dim, marginTop: 3, fontWeight: 700 }}>{k.label.toUpperCase()}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 10, color: theme.dim }}>
            Período: <b style={{ color: theme.text }}>{data.semana}</b>
            {' · '}Plaza: <b style={{ color: '#8B5CF6' }}>{data.plaza}</b>
            {' · '}TN360 <i>defaultDriver</i> × Odoo Field Service · {rows.length} vehículos con conductor
            {data.resumen.sin_conductor > 0 && <span style={{ color: '#FFB703' }}> · {data.resumen.sin_conductor} sin conductor asignado</span>}
          </div>

          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: theme.dim, fontWeight: 700 }}>FILTRAR:</span>
            {(['todos', 'ok', 'sin_gps', 'sin_tickets', 'inactivo'] as const).map(f => {
              const cfg = f === 'todos' ? { label: 'Todos', color: theme.accent } : { label: ALERTA_CFG[f].label, color: ALERTA_CFG[f].color };
              return (
                <button key={f} onClick={() => setFilterAlerta(f)}
                  style={{
                    padding: '4px 12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: filterAlerta === f ? 700 : 400,
                    background: filterAlerta === f ? `${cfg.color}20` : 'rgba(255,255,255,0.04)',
                    color: filterAlerta === f ? cfg.color : theme.dim,
                    boxShadow: filterAlerta === f ? `0 0 0 1.5px ${cfg.color}40` : 'none',
                  }}>{cfg.label}</button>
              );
            })}
            <span style={{ fontSize: 10, color: theme.dim, marginLeft: 'auto' }}>{filteredRows.length} de {rows.length}</span>
          </div>

          {/* Main cruce table — header fijo, filas scrollables */}
          <div style={{ borderRadius: 12, border: `1px solid ${theme.border}`, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 520 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
                  <tr style={{ background: theme.card }}>
                    {[
                      { h: 'Unidad',        align: 'left'   as const, w: 110 },
                      { h: 'Conductor',     align: 'left'   as const, w: 180 },
                      { h: 'KM período',    align: 'center' as const, w: 100 },
                      { h: '% Fuera',       align: 'center' as const, w: 80  },
                      { h: 'Viajes',        align: 'center' as const, w: 70  },
                      { h: 'KM Madrugada', align: 'center' as const, w: 110 },
                      { h: 'Tickets',       align: 'center' as const, w: 80  },
                      { h: 'Estado',        align: 'center' as const, w: 110 },
                    ].map(({ h, align, w }) => (
                      <th key={h} style={{
                        padding: '12px 14px', textAlign: align, minWidth: w,
                        color: theme.accent, fontWeight: 700, fontSize: 11,
                        letterSpacing: '0.07em', whiteSpace: 'nowrap',
                        borderBottom: `2px solid ${theme.border}`,
                        background: theme.card,
                      }}>
                        {h.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, i) => {
                    const cfg = ALERTA_CFG[r.alerta];
                    const pctColor = r.pct_fuera >= 60 ? '#FF4757' : r.pct_fuera >= 30 ? '#FFB703' : '#00C896';
                    return (<Fragment key={r.vehiculo_id}>
                      <tr
                        onClick={() => setExpanded(expanded === r.vehiculo_id ? null : r.vehiculo_id)}
                        style={{
                          borderBottom: expanded === r.vehiculo_id ? 'none' : `1px solid ${theme.border}`,
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.018)',
                          transition: 'background 0.1s',
                          cursor: r.viajes_fuera_detalle.length > 0 ? 'pointer' : 'default',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = `${theme.accent}0A`}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.018)'}
                      >
                        <td style={{ padding: '11px 14px', color: theme.text, fontWeight: 700, fontFamily: 'monospace', fontSize: 13, whiteSpace: 'nowrap' }}>
                          {r.viajes_fuera_detalle.length > 0 && (
                            <span style={{ color: theme.dim, fontSize: 10, marginRight: 5 }}>
                              {expanded === r.vehiculo_id ? '▼' : '▶'}
                            </span>
                          )}
                          {r.vehiculo || '—'}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          {r.conductor
                            ? <div>
                                <div style={{ color: theme.text, fontSize: 13 }}>
                                  {r.conductor}
                                  {r.conductor_mismatch && (
                                    <span style={{ marginLeft: 7, fontSize: 10, color: '#FFB703', fontWeight: 700 }}>⚠ ≠ defaultDriver</span>
                                  )}
                                </div>
                                {r.sin_cuenta_odoo && (
                                  <div style={{ color: theme.dim, fontSize: 11, fontStyle: 'italic', marginTop: 1 }}>sin cuenta Odoo</div>
                                )}
                                {r.conductor_mismatch && r.conductores_reales.map(cr => (
                                  <div key={cr.nombre} style={{ color: '#FFB703', fontSize: 11, marginTop: 1 }}>
                                    Real: {cr.nombre} ({cr.n_viajes}v)
                                  </div>
                                ))}
                              </div>
                            : <span style={{ color: theme.dim, fontStyle: 'italic', fontSize: 12 }}>Sin conductor</span>}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'center', color: r.km_semana > 0 ? '#00B4D8' : theme.dim, fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 14 }}>
                          {r.km_semana.toLocaleString('es-MX')}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 14, color: pctColor }}>
                          {r.pct_fuera > 0 ? `${r.pct_fuera}%` : <span style={{ color: theme.dim, fontWeight: 400 }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'center', color: r.n_viajes > 0 ? '#FF6B35' : theme.dim, fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 700 }}>
                          {r.n_viajes}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'center', color: r.km_madrugada > 0 ? '#FF4757' : theme.dim, fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: r.km_madrugada > 0 ? 700 : 400 }}>
                          {r.km_madrugada > 0 ? `${r.km_madrugada.toFixed(1)}` : '—'}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 14 }}>
                          {r.tickets === 'sin cuenta'
                            ? <span style={{ color: theme.dim, fontStyle: 'italic', fontWeight: 400, fontSize: 11 }}>sin cuenta</span>
                            : <span style={{ color: (r.tickets as number) > 0 ? '#FFD700' : theme.dim }}>{r.tickets}</span>}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                          <span style={{ padding: '4px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
                            {cfg.label}
                          </span>
                        </td>
                      </tr>
                      {expanded === r.vehiculo_id && r.viajes_fuera_detalle.length > 0 && (
                        <tr key={`${r.vehiculo_id}-detail`} style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <td colSpan={8} style={{ padding: '0 14px 14px 36px', background: 'rgba(139,92,246,0.05)' }}>
                            <div style={{ fontSize: 11, color: '#8B5CF6', fontWeight: 700, marginBottom: 8, marginTop: 12, letterSpacing: '0.07em' }}>
                              VIAJES FUERA DE HORARIO — {r.viajes_fuera_detalle.length} registros
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr style={{ color: theme.dim }}>
                                    {['Horario', 'Tipo', 'KM', 'Origen (GPS)', 'Destino (GPS)'].map(h => (
                                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11, borderBottom: `1px solid ${theme.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.viajes_fuera_detalle.map((vf, vi) => {
                                    const clsColor = vf.cls === 'madrugada' ? '#FF4757' : vf.cls === 'nocturno' ? '#FFB703' : '#8B5CF6';
                                    const clsLabel = vf.cls === 'madrugada' ? 'Madrugada' : vf.cls === 'nocturno' ? 'Nocturno' : 'Fin semana';
                                    return (
                                      <tr key={vi} style={{ borderBottom: `1px solid ${theme.border}20` }}>
                                        <td style={{ padding: '6px 10px', color: theme.dim, whiteSpace: 'nowrap', fontSize: 12 }}>{vf.hora_local}</td>
                                        <td style={{ padding: '6px 10px', color: clsColor, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 12 }}>{clsLabel}</td>
                                        <td style={{ padding: '6px 10px', color: '#00B4D8', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 12 }}>{vf.km > 0 ? `${vf.km.toFixed(1)} km` : '—'}</td>
                                        <td style={{ padding: '6px 10px', color: theme.text, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{vf.start || '—'}</td>
                                        <td style={{ padding: '6px 10px', color: theme.text, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{vf.end || '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>);
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Vehículos sin conductor */}
          {data.sin_conductor.length > 0 && (
            <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB703', marginBottom: 8, letterSpacing: 0.5 }}>
                ⚠ VEHÍCULOS SIN CONDUCTOR ASIGNADO EN TN360 — {data.sin_conductor.length}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {data.sin_conductor.map(v => (
                  <span key={v.vehiculo} style={{ padding: '4px 12px', borderRadius: 8, background: 'rgba(255,183,3,0.08)', border: `1px solid rgba(255,183,3,0.2)`, fontSize: 10, color: '#FFB703', fontFamily: 'monospace' }}>
                    {v.vehiculo} · {v.placa}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Email override editor for vehicles without Odoo match */}
          {rows.filter(r => r.sin_cuenta_odoo).length > 0 && (
            <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB703', marginBottom: 4, letterSpacing: 0.5 }}>
                ⚙ CONDUCTORES SIN CUENTA ODOO LOCALIZABLE
              </div>
              <div style={{ fontSize: 10, color: theme.dim, marginBottom: 14 }}>
                El correo de TN360 no coincide con ningún login de Odoo. Puedes asignar el email correcto para el cruce:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.filter(r => r.sin_cuenta_odoo).map(r => (
                  <div key={r.vehiculo_id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 220, fontSize: 11, color: theme.text }}>
                      <span style={{ fontWeight: 700 }}>{r.vehiculo}</span>
                      <span style={{ color: theme.dim }}> · {r.conductor}</span>
                    </div>
                    <select
                      value={editMap[r.vehiculo_id] ?? ''}
                      onChange={e => setEditMap(m => ({ ...m, [r.vehiculo_id]: e.target.value }))}
                      style={{ flex: 1, padding: '6px 10px', borderRadius: 8, background: theme.bg, border: `1px solid ${theme.border}`, color: theme.text, fontSize: 11, outline: 'none' }}
                    >
                      <option value="">— seleccionar correo Odoo —</option>
                      {data.todos_tecnicos.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <button onClick={saveMap} disabled={savingMap}
                style={{ marginTop: 14, padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', background: theme.accent, color: '#000', fontWeight: 700, fontSize: 11 }}>
                {savingMap ? 'Guardando...' : '💾 Guardar mapeo'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Organizar Tab ─────────────────────────────────────────────────────────────

const ROLES_DISPONIBLES = ['Auxiliar', 'Técnico FO', 'Técnico RF/Microondas', 'Líder de Cuadrilla'];
const ZONAS = ['MTY Norte', 'MTY Sur', 'MTY Oriente', 'Saltillo', 'Piedras Negras', 'Nuevo Laredo', 'Reynosa', 'Cd. Victoria'];

const PLANTILLAS = [
  {
    id: 'ftth-basica',
    nombre: 'FTTH Básica',
    icon: '🔦',
    color: '#00B4D8',
    descripcion: 'Instalación residencial last-mile. 2 personas.',
    perfiles: ['Técnico FO', 'Auxiliar'],
    sla: '4 h/instalación',
    capacidad: '3 instalaciones/día',
  },
  {
    id: 'ftth-reforzada',
    nombre: 'FTTH Reforzada',
    icon: '⚡',
    color: '#00C896',
    descripcion: 'Proyectos empresariales o alta densidad. 3 personas.',
    perfiles: ['Líder de Cuadrilla', 'Técnico FO', 'Auxiliar'],
    sla: '6 h/instalación',
    capacidad: '2 proyectos/día',
  },
  {
    id: 'microondas',
    nombre: 'RF / Microondas',
    icon: '📡',
    color: '#FF6B35',
    descripcion: 'Enlace inalámbrico punto a punto. 2 personas especializadas.',
    perfiles: ['Técnico RF/Microondas', 'Técnico RF/Microondas'],
    sla: '8 h/enlace',
    capacidad: '1 enlace/día',
  },
  {
    id: 'mantenimiento',
    nombre: 'Mantenimiento Preventivo',
    icon: '🔧',
    color: '#FFB703',
    descripcion: 'Revisión y limpieza de nodos y splitters. 2 personas.',
    perfiles: ['Técnico FO', 'Auxiliar'],
    sla: '2 h/nodo',
    capacidad: '4 nodos/día',
  },
];

interface CuadrillaBuilt {
  id: string;
  nombre: string;
  plantilla: string;
  color: string;
  icon: string;
  zona: string;
  miembros: { nombre: string; rol: string; odoo_id: number }[];
  vehiculo: string;
  estado: 'activa' | 'en-campo' | 'en-pausa';
  creada: string;
}

function OrganizarTab({ theme, tecnicosPool }: { theme: ThemeConfig; tecnicosPool: Tecnico[] }) {
  const [plantillaActiva, setPlantillaActiva] = useState<string | null>(null);
  const [cuadrillas, setCuadrillas]           = useState<CuadrillaBuilt[]>([]);
  const [builder, setBuilder]                 = useState<{
    nombre: string; zona: string; vehiculo: string;
    miembros: { tecnico: Tecnico | null; rol: string }[];
  } | null>(null);
  const [vehiculos, setVehiculos]             = useState<{ nombre: string; placa: string }[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/gps/vehiculos`)
      .then(r => r.json())
      .then(d => setVehiculos(d.vehiculos ?? []))
      .catch(() => {});
  }, []);

  const plantillaSelected = PLANTILLAS.find(p => p.id === plantillaActiva);

  const iniciarBuilder = (plantilla: typeof PLANTILLAS[0]) => {
    setPlantillaActiva(plantilla.id);
    setBuilder({
      nombre: `${plantilla.nombre} — ${ZONAS[0]}`,
      zona: ZONAS[0],
      vehiculo: vehiculos[0]?.nombre ?? '',
      miembros: plantilla.perfiles.map(rol => ({ tecnico: null, rol })),
    });
  };

  const guardarCuadrilla = () => {
    if (!builder || !plantillaSelected) return;
    const nueva: CuadrillaBuilt = {
      id: crypto.randomUUID(),
      nombre: builder.nombre,
      plantilla: plantillaSelected.nombre,
      color: plantillaSelected.color,
      icon: plantillaSelected.icon,
      zona: builder.zona,
      vehiculo: builder.vehiculo,
      miembros: builder.miembros
        .filter(m => m.tecnico)
        .map(m => ({ nombre: m.tecnico!.alias, rol: m.rol, odoo_id: m.tecnico!.odoo_id })),
      estado: 'activa',
      creada: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    };
    setCuadrillas(prev => [nueva, ...prev]);
    setBuilder(null);
    setPlantillaActiva(null);
  };

  const estadoColor = (e: CuadrillaBuilt['estado']) =>
    e === 'activa' ? '#00C896' : e === 'en-campo' ? '#FF6B35' : '#FFB703';

  const disponibles = tecnicosPool.filter(t =>
    !cuadrillas.some(c => c.miembros.some(m => m.odoo_id === t.odoo_id))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* KPI bar de cobertura */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Cuadrillas activas', val: cuadrillas.length, color: '#00C896', icon: '👷' },
          { label: 'Técnicos en pool',   val: tecnicosPool.length, color: theme.accent, icon: '🧑‍🔧' },
          { label: 'Disponibles',        val: disponibles.length, color: '#00B4D8', icon: '✅' },
          { label: 'Zonas cubiertas',    val: new Set(cuadrillas.map(c => c.zona)).size, color: '#FFB703', icon: '📍' },
        ].map(k => (
          <div key={k.label} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 22 }}>{k.icon}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color, marginTop: 6 }}>{k.val}</div>
            <div style={{ fontSize: 10, color: theme.dim, marginTop: 2, fontWeight: 600 }}>{k.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Plantillas */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, color: theme.dim, marginBottom: 12, letterSpacing: 1 }}>
          PLANTILLAS DE CUADRILLA — selecciona una para armar tu equipo
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {PLANTILLAS.map(p => {
            const active = plantillaActiva === p.id;
            return (
              <div
                key={p.id}
                onClick={() => iniciarBuilder(p)}
                style={{
                  padding: '20px 22px', borderRadius: 14, cursor: 'pointer',
                  background: active ? `${p.color}12` : theme.card,
                  border: `1.5px solid ${active ? p.color : theme.border}`,
                  transition: 'all 0.15s', position: 'relative', overflow: 'hidden',
                }}
              >
                {active && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: p.color }} />}
                <div style={{ fontSize: 28, marginBottom: 8 }}>{p.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: active ? p.color : theme.text }}>{p.nombre}</div>
                <div style={{ fontSize: 11, color: theme.dim, marginTop: 4, lineHeight: 1.4 }}>{p.descripcion}</div>
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {p.perfiles.map((rol, i) => (
                    <span key={i} style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, background: `${p.color}20`, color: p.color, fontWeight: 700 }}>{rol}</span>
                  ))}
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 16 }}>
                  <span style={{ fontSize: 9, color: theme.dim }}>⏱ {p.sla}</span>
                  <span style={{ fontSize: 9, color: theme.dim }}>📦 {p.capacidad}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Builder */}
      {builder && plantillaSelected && (
        <div style={{ background: theme.card, border: `1.5px solid ${plantillaSelected.color}50`, borderRadius: 18, padding: 24, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: plantillaSelected.color }} />

          <div style={{ fontSize: 13, fontWeight: 800, color: plantillaSelected.color, marginBottom: 18 }}>
            {plantillaSelected.icon} ARMAR CUADRILLA — {plantillaSelected.nombre}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
            {/* Nombre */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 5 }}>NOMBRE DE CUADRILLA</div>
              <input
                value={builder.nombre}
                onChange={e => setBuilder(b => b ? { ...b, nombre: e.target.value } : b)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`, color: theme.text, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            {/* Zona */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 5 }}>ZONA / PLAZA</div>
              <select
                value={builder.zona}
                onChange={e => setBuilder(b => b ? { ...b, zona: e.target.value } : b)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: theme.bg, border: `1px solid ${theme.border}`, color: theme.text, fontSize: 12, outline: 'none' }}
              >
                {ZONAS.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            {/* Vehículo */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 5 }}>VEHÍCULO ASIGNADO</div>
              <select
                value={builder.vehiculo}
                onChange={e => setBuilder(b => b ? { ...b, vehiculo: e.target.value } : b)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: theme.bg, border: `1px solid ${theme.border}`, color: theme.text, fontSize: 12, outline: 'none' }}
              >
                <option value="">Sin asignar</option>
                {vehiculos.map(v => <option key={v.placa} value={v.nombre}>{v.nombre} · {v.placa}</option>)}
              </select>
            </div>
          </div>

          {/* Asignación de miembros */}
          <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 10, letterSpacing: 1 }}>ASIGNAR TÉCNICOS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {builder.miembros.map((m, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px', border: `1px solid ${theme.border}` }}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 10px', borderRadius: 10, background: `${plantillaSelected.color}20`, color: plantillaSelected.color, flexShrink: 0 }}>
                  {m.rol}
                </span>
                <select
                  value={m.tecnico?.odoo_id ?? ''}
                  onChange={e => {
                    const tec = tecnicosPool.find(t => t.odoo_id === Number(e.target.value)) ?? null;
                    setBuilder(b => {
                      if (!b) return b;
                      const miembros = [...b.miembros];
                      miembros[idx] = { ...miembros[idx], tecnico: tec };
                      return { ...b, miembros };
                    });
                  }}
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 8, background: theme.bg, border: `1px solid ${theme.border}`, color: theme.text, fontSize: 12, outline: 'none' }}
                >
                  <option value="">— seleccionar técnico —</option>
                  {disponibles.map(t => (
                    <option key={t.odoo_id} value={t.odoo_id}>{t.alias} · {t.abiertos} tareas abiertas</option>
                  ))}
                  {m.tecnico && !disponibles.find(d => d.odoo_id === m.tecnico!.odoo_id) && (
                    <option value={m.tecnico.odoo_id}>{m.tecnico.alias} (en uso)</option>
                  )}
                </select>
                {m.tecnico && (
                  <span style={{ fontSize: 10, color: m.tecnico.abiertos > 10 ? '#FF4757' : '#00C896', fontWeight: 700, flexShrink: 0 }}>
                    {m.tecnico.abiertos} abiertas
                  </span>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              onClick={guardarCuadrilla}
              disabled={builder.miembros.every(m => !m.tecnico)}
              style={{
                padding: '9px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: plantillaSelected.color, color: '#000', fontWeight: 800, fontSize: 12,
                opacity: builder.miembros.every(m => !m.tecnico) ? 0.4 : 1,
              }}
            >
              ✅ Activar Cuadrilla
            </button>
            <button
              onClick={() => { setBuilder(null); setPlantillaActiva(null); }}
              style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.dim, fontSize: 12, cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Cuadrillas creadas */}
      {cuadrillas.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: theme.dim, marginBottom: 12, letterSpacing: 1 }}>
            CUADRILLAS ACTIVAS — {cuadrillas.length} equipo{cuadrillas.length > 1 ? 's' : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
            {cuadrillas.map(c => (
              <div key={c.id} style={{ background: theme.card, border: `1px solid ${c.color}40`, borderRadius: 14, padding: 20, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: c.color }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 18 }}>{c.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: theme.text, marginTop: 4 }}>{c.nombre}</div>
                    <div style={{ fontSize: 10, color: theme.dim, marginTop: 2 }}>{c.plantilla} · {c.zona}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 10px', borderRadius: 10, background: `${estadoColor(c.estado)}20`, color: estadoColor(c.estado) }}>
                      ● {c.estado.toUpperCase()}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['activa', 'en-campo', 'en-pausa'] as const).map(e => (
                        <button key={e} onClick={() => setCuadrillas(prev => prev.map(x => x.id === c.id ? { ...x, estado: e } : x))}
                          style={{ padding: '2px 7px', borderRadius: 6, border: `1px solid ${c.estado === e ? estadoColor(e) : theme.border}`, background: 'transparent', color: c.estado === e ? estadoColor(e) : theme.dim, fontSize: 8, cursor: 'pointer' }}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {c.miembros.map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8, background: `${c.color}15`, color: c.color, fontWeight: 700, flexShrink: 0 }}>{m.rol}</span>
                      <span style={{ fontSize: 11, color: theme.text }}>{m.nombre}</span>
                    </div>
                  ))}
                </div>
                {c.vehiculo && (
                  <div style={{ marginTop: 12, fontSize: 10, color: theme.dim }}>🚛 {c.vehiculo}</div>
                )}
                <div style={{ marginTop: 8, fontSize: 9, color: theme.dim }}>Creada {c.creada}</div>
                <button
                  onClick={() => setCuadrillas(prev => prev.filter(x => x.id !== c.id))}
                  style={{ position: 'absolute', top: 12, right: 12, padding: '2px 8px', borderRadius: 6, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.dim, fontSize: 9, cursor: 'pointer' }}
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {cuadrillas.length === 0 && !builder && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: theme.dim, fontSize: 12 }}>
          Selecciona una plantilla arriba para armar tu primera cuadrilla.
        </div>
      )}
    </div>
  );
}

// ── Main Section ──────────────────────────────────────────────────────────────
export default function BidrillasSection({ theme }: { theme: ThemeConfig }) {
  const [tab, setTab]                 = useState<'cuadrillas' | 'desempeno' | 'gps' | 'organizar' | 'cruce'>('cuadrillas');
  const [tecnicos, setTecnicos]       = useState<Tecnico[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [selectedTask, setSelected]   = useState<number | null>(null);
  const [busqueda, setBusqueda]       = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wfm/bidrillas`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTecnicos(data.tecnicos ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const now = Date.now();

  const etapaColor = (etapa: string) => {
    const e = etapa.toLowerCase();
    if (e.includes('done') || e.includes('resuel')) return '#00C896';
    if (e.includes('visit') || e.includes('campo'))  return '#FF6B35';
    return '#00B4D8';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${theme.border}`, paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: theme.text, margin: 0 }}>
            🔦 CUADRILLAS FIBRA ÓPTICA
          </h2>
          <p style={{ fontSize: 12, color: theme.dim, marginTop: 4 }}>
            Equipos de campo — datos en vivo desde Odoo Field Service
          </p>
        </div>
        <button onClick={fetchData} style={{ padding: '6px 14px', borderRadius: 8, background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim, fontSize: 11, cursor: 'pointer' }}>
          🔄 Actualizar
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {([
          ['cuadrillas', '👷 Cuadrillas',      theme.accent],
          ['organizar',  '🏗️ Organizar',       '#00C896'],
          ['desempeno',  '🏆 Desempeño',       '#FFD700'],
          ['gps',        '🗺️ GPS en Vivo',     '#FF6B35'],
          ['cruce',      '🔁 Cruce GPS/Tickets','#8B5CF6'],
        ] as const).map(([id, label, col]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '7px 18px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === id ? 700 : 400,
            background: tab === id ? `${col}20` : 'rgba(255,255,255,0.04)',
            color: tab === id ? col : theme.dim,
            boxShadow: tab === id ? `0 0 0 1.5px ${col}50` : 'none',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {/* Organizar tab */}
      {tab === 'organizar' && <OrganizarTab theme={theme} tecnicosPool={tecnicos} />}

      {/* Desempeño tab */}
      {tab === 'desempeno' && <DesempenoTab theme={theme} />}

      {/* GPS tab */}
      {tab === 'gps' && <GPSTab theme={theme} />}

      {/* Cruce GPS × Tickets tab */}
      {tab === 'cruce' && <CruceGPSTab theme={theme} />}

      {loading && tab === 'cuadrillas' && <div style={{ textAlign: 'center', padding: 60, color: theme.dim }}>Conectando a Odoo Field Service...</div>}
      {error   && tab === 'cuadrillas' && <div style={{ padding: 16, borderRadius: 8, background: '#FF475710', color: '#FF4757', fontSize: 12 }}>Error: {error}</div>}

      {/* Buscador de técnicos */}
      {tab === 'cuadrillas' && !loading && !error && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: theme.dim, pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              placeholder="Buscar técnico por nombre, alias o rol..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 12px 8px 36px', borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${busqueda ? theme.accent + '70' : theme.border}`,
                color: theme.text, fontSize: 13, fontFamily: 'inherit',
                outline: 'none', transition: 'border-color 0.15s',
              }}
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda('')}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: theme.dim, cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}
              >✕</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: theme.dim, flexShrink: 0 }}>
            {busqueda
              ? <span><b style={{ color: theme.text }}>{tecnicos.filter(t => [t.alias, t.nombre, t.rol].some(f => f.toLowerCase().includes(busqueda.toLowerCase()))).length}</b> de {tecnicos.length}</span>
              : <span><b style={{ color: theme.text }}>{tecnicos.length}</b> técnicos</span>
            }
          </div>
        </div>
      )}

      {/* Tarjetas de técnicos */}
      {tab === 'cuadrillas' && !loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
          {tecnicos.filter(t =>
            !busqueda || [t.alias, t.nombre, t.rol].some(f => f.toLowerCase().includes(busqueda.toLowerCase()))
          ).map(t => (
            <div key={t.id} style={{
              background: theme.card, border: `1px solid ${theme.border}`,
              borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: theme.accent }} />

              {/* Header técnico */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: theme.accent, letterSpacing: 1, marginBottom: 4 }}>FIBRA ÓPTICA</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: theme.text }}>{t.alias}</div>
                  <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>{t.nombre}</div>
                  <div style={{ fontSize: 10, color: theme.accent, marginTop: 2, fontWeight: 600 }}>{t.rol}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: t.abiertos > 10 ? '#FF4757' : '#FFB703' }}>{t.abiertos}</div>
                  <div style={{ fontSize: 9, color: theme.dim, fontWeight: 700 }}>ABIERTAS</div>
                </div>
              </div>

              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
                {[
                  { label: 'Total',      val: t.total,               color: theme.text },
                  { label: 'Cerradas',   val: t.cerrados,            color: '#00C896' },
                  { label: 'Resolución', val: `${t.pct_resolucion}%`, color: t.pct_resolucion > 50 ? '#00C896' : '#FFB703' },
                ].map(k => (
                  <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', border: `1px solid ${theme.border}` }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: k.color }}>{k.val}</div>
                    <div style={{ fontSize: 9, color: theme.dim, fontWeight: 700 }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {/* Barra resolución */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ width: `${Math.min(t.pct_resolucion, 100)}%`, height: '100%', background: t.pct_resolucion > 50 ? '#00C896' : '#FFB703', borderRadius: 2 }} />
                </div>
              </div>

              {/* Tareas abiertas — clickeables */}
              {t.tareas.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: theme.dim, marginBottom: 8, textTransform: 'uppercase' }}>Tareas activas</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {t.tareas.map(tarea => {
                      const col     = etapaColor(tarea.etapa);
                      const overdue = tarea.deadline && new Date(tarea.deadline).getTime() < now;
                      return (
                        <div
                          key={tarea.id}
                          onClick={() => setSelected(tarea.id)}
                          style={{
                            padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                            background: 'rgba(255,255,255,0.03)',
                            border: `1px solid ${theme.border}`,
                            transition: 'border-color 0.15s, background 0.15s',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = col + '60'; (e.currentTarget as HTMLElement).style.background = col + '08'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = theme.border; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: `${col}20`, color: col, flexShrink: 0 }}>
                              {tarea.etapa}
                            </span>
                            {overdue && <span style={{ fontSize: 8, color: '#FF4757', fontWeight: 700, flexShrink: 0 }}>⚠️</span>}
                            <span style={{ fontSize: 10, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {tarea.nombre}
                            </span>
                            <span style={{ fontSize: 9, color: theme.dim, flexShrink: 0 }}>→</span>
                          </div>
                          {tarea.deadline && (
                            <div style={{ fontSize: 8, color: overdue ? '#FF4757' : theme.dim, marginTop: 3 }}>
                              📅 {new Date(tarea.deadline).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {t.tareas.length === 0 && (
                <div style={{ fontSize: 11, color: theme.dim, textAlign: 'center', padding: 12 }}>✅ Sin tareas abiertas</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty search result */}
      {tab === 'cuadrillas' && !loading && !error && busqueda && tecnicos.filter(t =>
        [t.alias, t.nombre, t.rol].some(f => f.toLowerCase().includes(busqueda.toLowerCase()))
      ).length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: theme.dim }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: 13 }}>Sin resultados para "<b style={{ color: theme.text }}>{busqueda}</b>"</div>
          <button onClick={() => setBusqueda('')} style={{ marginTop: 10, padding: '5px 14px', borderRadius: 8, background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim, fontSize: 11, cursor: 'pointer' }}>Limpiar búsqueda</button>
        </div>
      )}

      {/* Nota */}
      <div style={{ background: 'rgba(0,180,216,0.05)', border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, fontSize: 12, color: theme.dim }}>
        🔦 <b style={{ color: theme.text }}>Cuadrillas Fibra Óptica</b> — Datos en vivo desde <b>Odoo Field Service</b>.
        Haz clic en cualquier tarea para ver detalle, comentar o cambiar etapa. GPS en vivo vía <b>TN360</b>.
      </div>

      {/* Task Drawer */}
      {selectedTask !== null && (
        <TareaDrawer
          taskId={selectedTask}
          theme={theme}
          onClose={() => setSelected(null)}
          onUpdated={fetchData}
        />
      )}
    </div>
  );
}
