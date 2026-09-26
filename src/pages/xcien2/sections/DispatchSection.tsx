import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../../../config';
import { ThemeConfig } from '../types';

// ── Types (contrato GET /api/dispatch/equipo) ─────────────────────────────────
interface TareaItem {
  id: number;
  nombre: string;
  etapa: string;
  deadline: string;   // "2026-09-10"
  proyecto: string;
}

interface PersonaDispatch {
  uid: number;
  nombre: string;
  email: string;
  total: number;
  abiertas: number;
  vencidas: number;
  por_etapa: Record<string, number>;
  tareas_vencidas: TareaItem[];
  tareas_proximas: TareaItem[];
  truncado?: boolean;   // backend topó el límite: los conteos son piso, no exactos
}

interface DispatchResponse {
  corte?: string;       // "2026-09-25" — ausente en la respuesta de error
  personas: PersonaDispatch[];
  error?: string;       // el backend devuelve HTTP 200 + error en fallos de Odoo
}

// ── Semáforo ──────────────────────────────────────────────────────────────────
const OK = '#00C896', WARN = '#FFB703', BAD = '#FF4757';

function pctVencido(p: PersonaDispatch): number {
  if (!p.abiertas) return 0;
  return Math.round((p.vencidas / p.abiertas) * 100);
}
function semaforo(pct: number): string {
  if (pct > 35) return BAD;
  if (pct >= 20) return WARN;
  return OK;
}

const trunc = (s: string, n = 55) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ponytail: caché a nivel de módulo (no useRef) para que sobreviva al
// desmontaje del lazy chunk al cambiar de sección. Subir a react-query si
// alguna vez hacen falta invalidaciones cruzadas entre secciones.
const TTL_MS = 5 * 60 * 1000;
let cache: { data: DispatchResponse; ts: number } | null = null;

// ── Lista colapsable de tareas ────────────────────────────────────────────────
function TareasCollapse({ titulo, tareas, color, theme }: {
  titulo: string; tareas: TareaItem[]; color: string; theme: ThemeConfig;
}) {
  const [open, setOpen] = useState(false);
  if (!tareas.length) return null;

  return (
    <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer',
          color: theme.text, textAlign: 'left', font: 'inherit',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 10, color: theme.dim, width: 10, flexShrink: 0 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {titulo}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: '1px 7px', borderRadius: 10,
          background: `${color}18`, color, border: `1px solid ${color}35`,
        }}>
          {tareas.length}
        </span>
      </button>

      {open && (
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {tareas.map(t => (
            <li key={t.id} style={{
              display: 'flex', gap: 10, alignItems: 'baseline',
              padding: '6px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.025)',
            }}>
              <span style={{ fontSize: 10, fontWeight: 800, color, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {t.deadline}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span title={t.nombre} style={{ fontSize: 11, color: theme.text, lineHeight: 1.4 }}>
                  {trunc(t.nombre)}
                </span>
                <span style={{ fontSize: 10, color: theme.dim, display: 'block', marginTop: 1 }}>
                  {t.etapa}{t.proyecto ? ` · ${t.proyecto}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tarjeta de persona ────────────────────────────────────────────────────────
function PersonaCard({ p, theme }: { p: PersonaDispatch; theme: ThemeConfig }) {
  const pct   = pctVencido(p);
  const color = semaforo(pct);

  const etapas = Object.entries(p.por_etapa)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxEtapa = etapas.length ? etapas[0][1] : 1;

  // truncado: el backend topó su límite de tareas abiertas, así que los
  // conteos son piso. Se marca con "≥" en lugar de fingir exactitud.
  const piso = p.truncado ? '≥' : '';
  const metricas = [
    { label: 'Abiertas',  val: piso + p.abiertas, col: theme.text },
    { label: 'Vencidas',  val: piso + p.vencidas, col: p.vencidas > 0 ? BAD : theme.dim },
    { label: '% vencido', val: `${pct}%`,         col: color },
  ];

  return (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: theme.radius, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header con semáforo */}
      <div style={{
        padding: '12px 16px', background: `${color}14`,
        borderBottom: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: theme.text, lineHeight: 1.3 }}>{p.nombre}</div>
          <div style={{ fontSize: 10, color: theme.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.email}
          </div>
        </div>
        {p.truncado && (
          <span
            title="El backend topó su límite de tareas abiertas: los conteos son un piso, no el total exacto."
            style={{
              fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 10, flexShrink: 0,
              background: `${WARN}18`, color: WARN, border: `1px solid ${WARN}35`,
            }}
          >
            PARCIAL
          </span>
        )}
        <span style={{ fontSize: 10, color: theme.dim, flexShrink: 0 }}>{p.total} tareas</span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        {/* Métricas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {metricas.map(m => (
            <div key={m.label}>
              <div style={{ fontSize: 24, fontWeight: 800, color: m.col, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                {m.val}
              </div>
              <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>

        {/* Barras por etapa */}
        {etapas.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: theme.dim, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 7 }}>
              Por etapa
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {etapas.map(([etapa, n]) => (
                <div key={etapa} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span title={etapa} style={{
                    fontSize: 10, color: theme.dim, width: 96, flexShrink: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {etapa}
                  </span>
                  <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: '100%',
                      background: theme.accent, borderRadius: 3,
                      transform: `scaleX(${Math.max(0.03, n / maxEtapa)})`,
                      transformOrigin: 'left',
                      transition: theme.animations ? 'transform 0.4s ease' : undefined,
                    }} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: theme.text, width: 22, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {n}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <TareasCollapse titulo="Vencidas"          tareas={p.tareas_vencidas} color={BAD}  theme={theme} />
        <TareasCollapse titulo="Próximas 7 días"   tareas={p.tareas_proximas} color={WARN} theme={theme} />
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ theme }: { theme: ThemeConfig }) {
  const block = (h: number, w: string | number) => (
    <div style={{ height: h, width: w, borderRadius: 6, background: 'rgba(255,255,255,0.06)' }} />
  );
  return (
    <>
      <style>{`@keyframes dispatchPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }`}</style>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} aria-hidden="true" style={{
          background: theme.card, border: `1px solid ${theme.border}`, borderRadius: theme.radius,
          padding: 16, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 240,
          animation: theme.animations ? `dispatchPulse 1.4s ease-in-out ${i * 0.12}s infinite` : undefined,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {block(14, '55%')}
            {block(10, '40%')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {block(30, '80%')}{block(30, '80%')}{block(30, '80%')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {block(6, '90%')}{block(6, '75%')}{block(6, '60%')}{block(6, '45%')}
          </div>
        </div>
      ))}
    </>
  );
}

// ── Sección ───────────────────────────────────────────────────────────────────
export default function DispatchSection({ theme }: { theme: ThemeConfig }) {
  const [data, setData]       = useState<DispatchResponse | null>(cache?.data ?? null);
  const [loading, setLoading] = useState(!cache);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!force && cache && Date.now() - cache.ts < TTL_MS) {
      setData(cache.data);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/dispatch/equipo`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DispatchResponse = await res.json();
      // El backend reporta fallos de Odoo como HTTP 200 + {error, personas: []}.
      if (json.error) { setError(json.error); return; }
      cache = { data: json, ts: Date.now() };
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const personas = data?.personas ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: theme.text, margin: 0 }}>
          Dispatch — CAE Operaciones
        </h2>
        {data?.corte && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: `${theme.accent}18`, color: theme.accent, border: `1px solid ${theme.accent}35`,
          }}>
            Corte {data.corte}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          aria-label="Actualizar datos de dispatch"
          style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 11, font: 'inherit',
            fontWeight: 600, background: 'transparent', border: `1px solid ${theme.border}`,
            color: theme.dim, cursor: loading ? 'progress' : 'pointer', opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'Actualizando…' : '🔄 Actualizar'}
        </button>
      </div>

      {/* Error */}
      {error && !loading && (
        <div role="alert" style={{
          padding: 20, borderRadius: theme.radius, textAlign: 'center',
          background: `${BAD}0F`, border: `1px solid ${BAD}35`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: BAD }}>No se pudo cargar el dispatch</div>
          <div style={{ fontSize: 11, color: theme.dim, marginTop: 4 }}>{error}</div>
          <button
            type="button"
            onClick={() => load(true)}
            style={{
              marginTop: 12, padding: '7px 18px', borderRadius: 8, border: 'none',
              background: BAD, color: '#000', fontWeight: 800, fontSize: 12, cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Grid 2×2 */}
      {!error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          {loading && !data && <Skeleton theme={theme} />}
          {personas.map(p => <PersonaCard key={p.uid} p={p} theme={theme} />)}
        </div>
      )}

      {!loading && !error && personas.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: theme.dim, fontSize: 12 }}>
          Sin personas con tareas asignadas en este corte.
        </div>
      )}
    </div>
  );
}
