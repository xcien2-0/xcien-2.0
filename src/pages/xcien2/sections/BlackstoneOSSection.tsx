// BlackstoneOS PDN — Piedras Negras · Dashboard exclusivo con features propios
import React, { useState, useEffect } from 'react';
import CiudadOSSection, { ExtraTab, PROSPECTOS_PDN } from './CiudadOSSection';
import { PDN_CONFIG, XCIEN_CORPORATE_THEME } from './ciudadConfigs';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';
import { useAuth } from '../../../contexts/AuthContext';

// Paleta PDN fija (tema institucional claro)
const G  = '#2d7a3a';
const GD = '#1a3d2b';
const GB = '#d1e8d6';
const BG = '#f4fbf6';
const SF = '#ffffff';
const TX = '#111827';
const DM = '#6b7280';
const RD = '#dc2626';
const AM = '#d97706';
const BL = '#2563eb';
const PU = '#7c3aed';
const SH = '0 1px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tiempoAtras(fecha: string): string {
  if (!fecha) return '—';
  const diff = Date.now() - new Date(fecha.replace(' ', 'T') + 'Z').getTime();
  const h = Math.floor(diff / 3600000);
  if (h > 48) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h`;
  return `${Math.floor((diff % 3600000) / 60000)}m`;
}

function SectionCard({ children, style, accent }: { children: React.ReactNode; style?: React.CSSProperties; accent?: string }) {
  return (
    <div style={{
      background: SF, borderRadius: 14, border: `1px solid ${GB}`,
      boxShadow: SH, overflow: 'hidden',
      ...(accent ? { borderTop: `3px solid ${accent}` } : {}),
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ icon, title, badge, badgeColor, action }: {
  icon: string; title: string; badge?: number | string; badgeColor?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{
      padding: '11px 18px', borderBottom: `1px solid ${GB}`,
      display: 'flex', alignItems: 'center', gap: 10,
      background: `linear-gradient(135deg, ${BG} 0%, ${SF} 100%)`,
    }}>
      <span style={{
        width: 26, height: 26, borderRadius: 8,
        background: `${GD}12`, border: `1px solid ${GD}20`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, flexShrink: 0,
      }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: GD, letterSpacing: 0.3, flex: 1 }}>
        {title}
      </span>
      {action}
      {badge !== undefined && (
        <span style={{
          fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 100,
          background: `${badgeColor ?? G}18`, color: badgeColor ?? G,
          border: `1px solid ${badgeColor ?? G}30`, minWidth: 24, textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}>{badge}</span>
      )}
    </div>
  );
}

// Chip de estado reutilizable
function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, padding: '2px 9px', borderRadius: 100,
      background: `${color}15`, color, border: `1px solid ${color}30`,
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>{label}</span>
  );
}

// ── 1. LANCEMEX TRACKER ───────────────────────────────────────────────────────

interface LancermexEntry { id: string; fecha: string; cajas: number; nota: string; }
const LS_LANCEMEX = 'xcien-lancermex-pdn';
const TOTAL_CAJAS = 21;

function loadLancermex(): LancermexEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_LANCEMEX) ?? '[]'); } catch { return []; }
}

function LancermexTracker() {
  const [entries, setEntries] = useState<LancermexEntry[]>(() => loadLancermex());
  const [showModal, setShowModal] = useState(false);
  const [inputCajas, setInputCajas] = useState(0);
  const [inputNota, setInputNota] = useState('');

  const current = entries[0]?.cajas ?? 0;
  const pct = Math.round((current / TOTAL_CAJAS) * 100);
  const statusColor = pct >= 100 ? G : pct >= 50 ? AM : RD;
  const statusLabel = pct >= 100 ? 'COMPLETADO' : 'BLOQUEADO';

  const handleSave = () => {
    if (!inputNota.trim()) return;
    const updated = [
      { id: Date.now().toString(), fecha: new Date().toISOString(), cajas: inputCajas, nota: inputNota.trim() },
      ...entries,
    ].slice(0, 30);
    localStorage.setItem(LS_LANCEMEX, JSON.stringify(updated));
    setEntries(updated);
    setShowModal(false);
    setInputNota('');
  };

  const fechaCorta = (iso: string) =>
    new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionCard style={{ padding: 20 }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: `${statusColor}15`, border: `2px solid ${statusColor}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, flexShrink: 0,
          }}>🔌</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: TX }}>CWDM F3 — Lancermex</span>
              <span style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 100,
                background: `${statusColor}15`, color: statusColor,
                border: `1px solid ${statusColor}40`, fontWeight: 800, letterSpacing: 1,
              }}>{statusLabel}</span>
            </div>
            <div style={{ fontSize: 12, color: DM, fontFamily: 'system-ui, sans-serif' }}>
              Escalado a Francisco Alday · Fibra Piedras Negras F3
            </div>
          </div>
          <button onClick={() => { setInputCajas(current); setShowModal(true); }} style={{
            padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
            background: GD, color: '#fff', border: 'none',
            fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}>Actualizar avance</button>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: DM }}>Cajas completadas</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: statusColor, fontVariantNumeric: 'tabular-nums' }}>
              {current} / {TOTAL_CAJAS} — {pct}%
            </span>
          </div>
          <div style={{ height: 12, background: GB, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: `linear-gradient(90deg, ${statusColor}88, ${statusColor})`,
              borderRadius: 6, transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        {/* Chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: '21 cajas totales', c: DM },
            { label: 'F3 · Anillo Lancermex + ruta alterna', c: DM },
            { label: `${TOTAL_CAJAS - current} cajas restantes`, c: AM },
            { label: 'Escalado: Francisco Alday', c: RD },
          ].map(({ label, c }) => (
            <span key={label} style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 100,
              background: `${c}12`, color: c, border: `1px solid ${c}25`,
            }}>{label}</span>
          ))}
        </div>
      </SectionCard>

      {/* Timeline */}
      <SectionCard>
        <SectionHeader icon="◷" title="Historial de avance" badge={entries.length} />
        {entries.length === 0 ? (
          <div style={{ padding: '36px 18px', textAlign: 'center', color: DM, fontSize: 12 }}>
            Sin actualizaciones — presiona "Actualizar avance" para registrar la primera
          </div>
        ) : (
          entries.map((e, i) => (
            <div key={e.id} style={{
              padding: '14px 18px',
              borderBottom: i < entries.length - 1 ? `1px solid ${GB}` : 'none',
              display: 'flex', gap: 14, alignItems: 'flex-start',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: `${G}12`, border: `1px solid ${G}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: G,
              }}>{e.cajas}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: DM, marginBottom: 3, fontVariantNumeric: 'tabular-nums' }}>
                  {fechaCorta(e.fecha)} · {Math.round((e.cajas / TOTAL_CAJAS) * 100)}%
                </div>
                <div style={{ fontSize: 12, color: TX, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
                  {e.nota}
                </div>
              </div>
            </div>
          ))
        )}
      </SectionCard>

      {/* Modal */}
      {showModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }} style={{
          position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            background: SF, borderRadius: 12, border: `1px solid ${GB}`,
            boxShadow: '0 24px 48px rgba(0,0,0,0.2)', width: '100%', maxWidth: 440, padding: 24,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TX, marginBottom: 20 }}>
              🔌 Actualizar avance Lancermex
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: DM, letterSpacing: 1, marginBottom: 8 }}>
                CAJAS COMPLETADAS (de {TOTAL_CAJAS})
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <input
                  type="range" min={0} max={TOTAL_CAJAS} value={inputCajas}
                  onChange={e => setInputCajas(Number(e.target.value))}
                  style={{ flex: 1, accentColor: G }}
                />
                <span style={{ fontSize: 22, fontWeight: 800, color: G, minWidth: 36, textAlign: 'center' }}>
                  {inputCajas}
                </span>
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: DM, letterSpacing: 1, marginBottom: 8 }}>
                NOTA / OBSERVACIÓN
              </div>
              <textarea
                value={inputNota}
                onChange={e => setInputNota(e.target.value)}
                placeholder="Ej: Guillermo visitó 3 cajas esta semana. Lancermex reporta acceso dificultado por construcción..."
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box', background: BG,
                  border: `1px solid ${GB}`, borderRadius: 8, padding: '10px 12px',
                  color: TX, fontSize: 12, fontFamily: 'system-ui, sans-serif',
                  lineHeight: 1.6, resize: 'vertical', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{
                padding: '9px 18px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${GB}`, background: 'transparent', color: DM, fontSize: 12,
              }}>Cancelar</button>
              <button onClick={handleSave} disabled={!inputNota.trim()} style={{
                padding: '9px 22px', borderRadius: 8,
                cursor: inputNota.trim() ? 'pointer' : 'default',
                background: inputNota.trim() ? GD : GB, color: '#fff', border: 'none',
                fontSize: 12, fontWeight: 700,
              }}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 2. AMISTAD PIPELINE ───────────────────────────────────────────────────────

type ProspectoStatus = 'prospecto' | 'conversacion' | 'propuesta' | 'ganado' | 'descartado';

const STATUS_META: Record<ProspectoStatus, { label: string; color: string; icon: string }> = {
  prospecto:    { label: 'Prospecto',    color: DM, icon: '○' },
  conversacion: { label: 'Conversación', color: BL, icon: '◎' },
  propuesta:    { label: 'Propuesta',    color: AM, icon: '◈' },
  ganado:       { label: 'Ganado',       color: G,  icon: '✓' },
  descartado:   { label: 'Descartado',   color: RD, icon: '✕' },
};

const LS_AMISTAD = 'xcien-amistad-pipeline';

function AmistadPipeline() {
  const [statuses, setStatuses] = useState<Record<string, ProspectoStatus>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_AMISTAD) ?? '{}'); } catch { return {}; }
  });
  const [filter, setFilter] = useState<ProspectoStatus | 'todos'>('todos');

  const getStatus = (name: string): ProspectoStatus => statuses[name] ?? 'prospecto';

  const update = (name: string, s: ProspectoStatus) => {
    const updated = { ...statuses, [name]: s };
    setStatuses(updated);
    localStorage.setItem(LS_AMISTAD, JSON.stringify(updated));
  };

  const counts = (Object.keys(STATUS_META) as ProspectoStatus[]).reduce((acc, k) => {
    acc[k] = PROSPECTOS_PDN.filter(p => getStatus(p.name) === k).length;
    return acc;
  }, {} as Record<ProspectoStatus, number>);

  const visible = filter === 'todos'
    ? PROSPECTOS_PDN
    : [...PROSPECTOS_PDN].filter(p => getStatus(p.name) === filter);

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {(Object.entries(STATUS_META) as [ProspectoStatus, typeof STATUS_META[ProspectoStatus]][]).map(([k, m]) => (
          <button key={k} onClick={() => setFilter(filter === k ? 'todos' : k)} style={{
            background: filter === k ? `${m.color}15` : SF,
            border: `1px solid ${filter === k ? m.color + '55' : GB}`,
            borderRadius: 10, padding: '12px 8px', cursor: 'pointer',
            textAlign: 'center', transition: 'all 0.15s', boxShadow: SH,
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: m.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {counts[k]}
            </div>
            <div style={{ fontSize: 9, color: DM, marginTop: 4, letterSpacing: 0.5 }}>
              {m.label.toUpperCase()}
            </div>
          </button>
        ))}
      </div>

      {/* List */}
      <SectionCard>
        <SectionHeader
          icon="🏭"
          title={`Parque Industrial Amistad · ${visible.length} prospectos`}
          badge={filter !== 'todos' ? `${filter}` : undefined}
          badgeColor={filter !== 'todos' ? STATUS_META[filter as ProspectoStatus]?.color : undefined}
        />
        {visible.map((p, i) => {
          const st = getStatus(p.name);
          const m = STATUS_META[st];
          return (
            <div key={p.name} style={{
              padding: '10px 18px',
              borderBottom: i < visible.length - 1 ? `1px solid ${GB}` : 'none',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: 11, color: m.color, width: 14, flexShrink: 0 }}>{m.icon}</span>
              <div style={{ flex: 1, fontSize: 12, color: TX, fontFamily: 'system-ui, sans-serif' }}>
                {p.name}
              </div>
              <select
                value={st}
                onChange={e => update(p.name, e.target.value as ProspectoStatus)}
                style={{
                  fontSize: 10, padding: '4px 8px', borderRadius: 6,
                  border: `1px solid ${m.color}55`,
                  background: `${m.color}12`, color: m.color,
                  cursor: 'pointer', outline: 'none', fontWeight: 600,
                }}
              >
                {(Object.entries(STATUS_META) as [ProspectoStatus, typeof STATUS_META[ProspectoStatus]][]).map(([k, meta]) => (
                  <option key={k} value={k}>{meta.label}</option>
                ))}
              </select>
            </div>
          );
        })}
      </SectionCard>
    </div>
  );
}

// ── 3. CAMPO PDN — Guillermo ──────────────────────────────────────────────────

interface GPSVeh {
  nombre: string; placa: string; conductor?: string;
  lat?: number; lng?: number; velocidad?: number;
  km_hoy?: number; activo?: boolean; ubicacion?: string;
}
interface TicketG {
  id: string; odoo_id: number; nombre: string; cliente: string;
  tecnico: string | null; tipo: string; etapa_op: string;
  fecha_creacion: string; prioridad: string; cerrado: boolean;
}

function CampoPDN() {
  const [gps, setGps] = useState<GPSVeh | null>(null);
  const [tickets, setTickets] = useState<TicketG[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('xcien_token');
    Promise.all([
      fetch(`${API_BASE}/api/gps/vehiculos`).then(r => r.ok ? r.json() : { vehiculos: [] }),
      fetch(`${API_BASE}/api/wfm/field-tickets?limit=200`).then(r => r.ok ? r.json() : { tickets: [] }),
      fetch(`${API_BASE}/api/blackstone/tickets`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : { tickets: [] }),
    ]).then(([g, w, b]) => {
      const v = (g.vehiculos ?? []).find((v: GPSVeh) =>
        (v.conductor ?? v.nombre ?? '').toLowerCase().includes('guillermo'));
      setGps(v ?? null);
      const wts = (w.tickets ?? []).filter((t: TicketG) =>
        !t.cerrado && (t.tecnico ?? '').toLowerCase().includes('guillermo'));
      const bts = (b.tickets ?? []).filter((t: TicketG) => !t.cerrado);
      const merged = [...wts];
      for (const bt of bts) {
        if (!merged.find(m => m.odoo_id === bt.odoo_id)) merged.push(bt);
      }
      setTickets(merged);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* GPS + info */}
      <SectionCard style={{ padding: 20 }}>
        <div style={{ fontSize: 10, color: DM, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16 }}>
          🔧 Guillermo Hernandez F. — Técnico PDN + Acuña
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: DM }}>Cargando datos GPS...</div>
        ) : gps ? (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TX, marginBottom: 3 }}>
                  {gps.placa} · {gps.nombre}
                </div>
                <div style={{ fontSize: 11, color: DM, fontFamily: 'system-ui, sans-serif' }}>
                  {gps.ubicacion || 'Ubicación no disponible'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                {[
                  { val: `${gps.velocidad ?? 0}`, unit: 'km/h', color: gps.activo ? G : DM },
                  { val: `${(gps.km_hoy ?? 0).toFixed(0)}`, unit: 'km hoy', color: BL },
                ].map(({ val, unit, color }) => (
                  <div key={unit} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{val}</div>
                    <div style={{ fontSize: 9, color: DM, marginTop: 2 }}>{unit}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 100, fontWeight: 700,
                background: `${gps.activo ? G : DM}12`, color: gps.activo ? G : DM,
                border: `1px solid ${gps.activo ? G : DM}30`,
              }}>{gps.activo ? '● En movimiento' : '● Detenido'}</span>
              <span style={{
                fontSize: 9, padding: '3px 10px', borderRadius: 100,
                background: `${BL}12`, color: BL, border: `1px solid ${BL}30`,
              }}>Cobertura: PDN + Acuña</span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: DM }}>Vehículo de Guillermo no localizado en GPS</div>
        )}

        {/* MikroTik Acuña — solo disponible en red interna */}
        {(import.meta.env.VITE_MIKROTIK_URL as string) && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${GB}` }}>
            <a href={import.meta.env.VITE_MIKROTIK_URL as string} target="_blank" rel="noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 8, textDecoration: 'none',
              background: `${BL}12`, border: `1px solid ${BL}40`, color: BL,
              fontSize: 12, fontWeight: 600,
            }}>
              🌐 MikroTik Manager Acuña ↗
            </a>
          </div>
        )}
      </SectionCard>

      {/* Tickets de Guillermo */}
      <SectionCard>
        <SectionHeader
          icon="⚙"
          title="Tickets asignados a Guillermo"
          badge={tickets.length}
          badgeColor={tickets.some(t => t.prioridad === 'urgent') ? RD : BL}
        />
        {tickets.length === 0 ? (
          <div style={{ padding: '36px 18px', textAlign: 'center', color: DM, fontSize: 12 }}>
            {loading ? 'Cargando tickets…' : 'Sin tickets asignados a este técnico'}
          </div>
        ) : (
          tickets.slice(0, 10).map((t, i) => {
            const typeColor = t.tipo === 'falla' ? RD : BL;
            return (
              <div key={t.id} style={{
                padding: '11px 18px',
                borderBottom: i < Math.min(tickets.length, 10) - 1 ? `1px solid ${GB}` : 'none',
                borderLeft: `3px solid ${typeColor}`,
                display: 'flex', gap: 12, alignItems: 'flex-start',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: DM, marginBottom: 2 }}>{t.id}</div>
                  <div style={{ fontSize: 12, color: TX, fontFamily: 'system-ui, sans-serif', fontWeight: 500, marginBottom: 3 }}>
                    {t.nombre}
                  </div>
                  <div style={{ fontSize: 10, color: DM }}>{t.cliente || '—'} · {t.etapa_op}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: DM, marginBottom: 4 }}>{tiempoAtras(t.fecha_creacion)}</div>
                  <span style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 100,
                    background: `${typeColor}12`, color: typeColor,
                    border: `1px solid ${typeColor}30`, fontWeight: 700,
                  }}>{t.tipo === 'falla' ? 'FALLA' : 'INST'}</span>
                </div>
              </div>
            );
          })
        )}
      </SectionCard>
    </div>
  );
}

// ── 4. KPIs PDN ───────────────────────────────────────────────────────────────

interface SidfCliente {
  id: string; nombre: string; estado: string;
  plaza: string; velocidad?: string; noc_monitoreado?: boolean;
}

function NuevoTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [titulo, setTitulo] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [prio, setPrio] = React.useState<'normal'|'urgente'|'critica'>('normal');
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [tecnicos, setTecnicos] = React.useState<{ id: number; nombre: string }[]>([]);
  const [asignadoId, setAsignadoId] = React.useState<number | null>(null);
  const [asignadoNombre, setAsignadoNombre] = React.useState('');
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    const token = localStorage.getItem('xcien_token');
    fetch(`${API_BASE}/api/blackstone/tecnicos-pdn`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json() : { tecnicos: [] })
      .then(d => setTecnicos(d.tecnicos ?? []))
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!titulo.trim()) { setErr('El título es obligatorio'); return; }
    setSaving(true); setErr('');
    try {
      const token = localStorage.getItem('xcien_token');
      const r = await fetch(`${API_BASE}/api/blackstone/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          titulo: titulo.trim(),
          descripcion: desc.trim(),
          prioridad: prio,
          asignado_odoo_id: asignadoId ?? undefined,
          asignado_nombre: asignadoNombre,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Error');
      setSuccess(true);
      setTimeout(() => onCreated(), 1200);
    } catch (e: any) { setErr(e.message); setSaving(false); }
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const boxStyle: React.CSSProperties = {
    background: SF, border: `1px solid ${GB}`, borderRadius: 12, padding: 28,
    width: 440, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: `1px solid ${GB}`, background: BG, color: TX, fontSize: 13,
    fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box',
  };
  const prioColors: Record<string, string> = { normal: BL, urgente: AM, critica: RD };

  if (success) return (
    <div style={overlayStyle}>
      <div style={{ ...boxStyle, alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 36 }}>✅</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: G }}>Ticket creado en Odoo</div>
        <div style={{ fontSize: 12, color: DM, textAlign: 'center' }}>
          Notificación enviada por Telegram
          {asignadoNombre && ` · asignado a ${asignadoNombre}`}
        </div>
      </div>
    </div>
  );

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={boxStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: TX }}>+ Nuevo Ticket PDN</div>
        <div style={{ fontSize: 10, color: DM, marginTop: -8 }}>
          Se creará en Odoo Field Service · etapa New · prefijo [SUPERVISOR] · notificación Telegram automática
        </div>

        <div>
          <div style={{ fontSize: 11, color: DM, marginBottom: 6 }}>TÍTULO DEL TICKET *</div>
          <input style={inputStyle} value={titulo} onChange={e => setTitulo(e.target.value)}
            placeholder="Ej: SITIO PIEDRAS NEGRAS — Falla enlace principal" maxLength={120} />
        </div>

        <div>
          <div style={{ fontSize: 11, color: DM, marginBottom: 6 }}>PRIORIDAD</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['normal','urgente','critica'] as const).map(p => (
              <button key={p} onClick={() => setPrio(p)} style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                border: `1.5px solid ${prio === p ? prioColors[p] : GB}`,
                background: prio === p ? `${prioColors[p]}18` : 'transparent',
                color: prio === p ? prioColors[p] : DM, cursor: 'pointer', textTransform: 'capitalize',
              }}>{p}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: DM, marginBottom: 6 }}>ASIGNAR A</div>
          <select
            style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
            value={asignadoId ?? ''}
            onChange={e => {
              const sel = tecnicos.find(t => t.id === Number(e.target.value));
              setAsignadoId(sel ? sel.id : null);
              setAsignadoNombre(sel ? sel.nombre : '');
            }}
          >
            <option value="">— Sin asignar —</option>
            {tecnicos.map(t => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 11, color: DM, marginBottom: 6 }}>DESCRIPCIÓN (opcional)</div>
          <textarea style={{ ...inputStyle, height: 80, resize: 'vertical' }}
            value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Hallazgo, contexto, cliente afectado..." />
        </div>

        {err && <div style={{ fontSize: 11, color: RD }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 18px', borderRadius: 8, border: `1px solid ${GB}`,
            background: 'transparent', color: DM, fontSize: 12, cursor: 'pointer',
          }}>Cancelar</button>
          <button onClick={submit} disabled={saving} style={{
            padding: '7px 18px', borderRadius: 8, border: 'none',
            background: saving ? `${G}88` : G, color: '#fff', fontSize: 12,
            fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
          }}>{saving ? 'Creando…' : 'Crear Ticket'}</button>
        </div>
      </div>
    </div>
  );
}

// ── MemoriaTecnica — archivo vivo de juntas FO XCIEN ─────────────────────────

interface Reunion {
  id: string;
  fecha: string;
  titulo: string;
  fuente: 'gmail' | 'manual';
  autor?: string;
  parsed?: {
    resumen?: string;
    participantes?: string[];
    decisiones?: string[];
    action_items?: { tarea: string; responsable?: string; fecha_limite?: string }[];
    hallazgos_tecnicos?: string[];
    riesgos?: string[];
    estado_proyecto?: string;
  };
}

interface EstadoActual {
  resumen?: string;
  avance_pct?: number;
  semaforo?: 'verde' | 'amarillo' | 'rojo';
  pendientes_criticos?: string[];
  logros_recientes?: string[];
  proximos_pasos?: string[];
  generado?: string;
}

function MemoriaTecnica() {
  const { user } = useAuth();
  const [reuniones, setReuniones] = useState<Reunion[]>([]);
  const [estado, setEstado] = useState<EstadoActual | null>(null);
  const [hitos, setHitos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Modal nueva reunión
  const [showModal, setShowModal] = useState(false);
  const [modalTexto, setModalTexto] = useState('');
  const [modalFecha, setModalFecha] = useState(new Date().toISOString().slice(0, 10));
  const [modalTitulo, setModalTitulo] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Hito rápido
  const [hitoTexto, setHitoTexto] = useState('');
  const [showHito, setShowHito] = useState(false);

  const canEdit = user?.rol === 'admin' || user?.rol === 'supervisor' || user?.rol === 'gerente';

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('xcien_token');
      const r = await fetch(`${API_BASE}/api/fibra/memoria`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const d = await r.json();
        setReuniones(d.reuniones ?? []);
        setEstado(d.estado_actual ?? null);
        setHitos(d.hitos ?? []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitReunion = async () => {
    if (!modalTexto.trim()) { setSaveMsg('El texto de la reunión es obligatorio'); return; }
    setSaving(true); setSaveMsg('');
    try {
      const token = localStorage.getItem('xcien_token');
      const r = await fetch(`${API_BASE}/api/fibra/memoria/reunion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ texto: modalTexto, fecha: modalFecha, titulo: modalTitulo }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Error');
      setSaveMsg(`✓ Reunión registrada: ${d.titulo}`);
      setModalTexto(''); setModalTitulo('');
      setTimeout(() => { setShowModal(false); setSaveMsg(''); load(); }, 1500);
    } catch (e: any) { setSaveMsg(e.message); }
    setSaving(false);
  };

  const submitHito = async () => {
    if (!hitoTexto.trim()) return;
    try {
      const token = localStorage.getItem('xcien_token');
      await fetch(`${API_BASE}/api/fibra/memoria/hito`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ descripcion: hitoTexto, tipo: 'hito' }),
      });
      setHitoTexto(''); setShowHito(false); load();
    } catch {}
  };

  const semColorMap = { verde: '#16a34a', amarillo: '#d97706', rojo: '#dc2626' };
  const semLabel = { verde: 'En curso', amarillo: 'Atención requerida', rojo: 'Bloqueado' };

  const filtradas = reuniones.filter(r => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (r.titulo + (r.parsed?.resumen ?? '') + (r.fecha ?? '')).toLowerCase().includes(q);
  });

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: DM, fontSize: 13 }}>
      Cargando memoria técnica...
    </div>
  );

  const sem = estado?.semaforo ?? 'verde';
  const semColor = semColorMap[sem] ?? G;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Estado actual del proyecto */}
      {estado && (
        <SectionCard>
          <SectionHeader icon="📡" title="Estado actual del proyecto" badge={semLabel[sem]} badgeColor={semColor} />
          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: TX, lineHeight: 1.6 }}>{estado.resumen}</p>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {estado.avance_pct !== undefined && (
                <div>
                  <div style={{ fontSize: 11, color: DM, marginBottom: 4 }}>AVANCE ESTIMADO</div>
                  <div style={{ background: `${G}22`, borderRadius: 6, height: 8, width: 180, overflow: 'hidden' }}>
                    <div style={{ background: semColor, height: '100%', width: `${estado.avance_pct}%`, borderRadius: 6 }} />
                  </div>
                  <div style={{ fontSize: 11, color: semColor, marginTop: 3, fontWeight: 700 }}>{estado.avance_pct}%</div>
                </div>
              )}
            </div>
            {estado.pendientes_criticos?.length ? (
              <div>
                <div style={{ fontSize: 11, color: DM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Pendientes críticos</div>
                {estado.pendientes_criticos.map((p, i) => (
                  <div key={i} style={{ fontSize: 12, color: TX, padding: '3px 0', borderBottom: `1px solid ${GB}` }}>
                    ⚠ {p}
                  </div>
                ))}
              </div>
            ) : null}
            {estado.proximos_pasos?.length ? (
              <div>
                <div style={{ fontSize: 11, color: DM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Próximos pasos</div>
                {estado.proximos_pasos.map((p, i) => (
                  <div key={i} style={{ fontSize: 12, color: TX, padding: '3px 0' }}>→ {p}</div>
                ))}
              </div>
            ) : null}
            <div style={{ fontSize: 10, color: DM }}>
              Estado generado {estado.generado ? new Date(estado.generado).toLocaleString('es-MX') : '—'}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Hitos del proyecto */}
      {hitos.length > 0 && (
        <SectionCard>
          <SectionHeader icon="🏁" title="Hitos del proyecto" badge={hitos.length} />
          <div style={{ padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...hitos].reverse().map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 0', borderBottom: `1px solid ${GB}` }}>
                <span style={{ fontSize: 11, color: DM, minWidth: 80 }}>{h.fecha}</span>
                <span style={{ fontSize: 12, color: TX, flex: 1 }}>{h.descripcion}</span>
                {h.autor && <span style={{ fontSize: 10, color: DM }}>{h.autor}</span>}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Barra de acciones */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar en memoria..."
          style={{
            flex: 1, minWidth: 200, padding: '7px 12px', fontSize: 12,
            border: `1px solid ${GB}`, borderRadius: 8, outline: 'none', color: TX,
          }}
        />
        {canEdit && (
          <>
            <button onClick={() => setShowModal(true)} style={{
              padding: '7px 14px', background: G, color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              + Agregar junta
            </button>
            <button onClick={() => setShowHito(v => !v)} style={{
              padding: '7px 14px', background: BG, color: G, border: `1px solid ${G}55`,
              borderRadius: 8, fontSize: 12, cursor: 'pointer',
            }}>
              🏁 Hito
            </button>
          </>
        )}
        <span style={{ fontSize: 11, color: DM }}>{reuniones.length} juntas</span>
      </div>

      {/* Hito rápido inline */}
      {showHito && canEdit && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={hitoTexto}
            onChange={e => setHitoTexto(e.target.value)}
            placeholder="Describe el hito (decisión, logro, hallazgo)..."
            style={{ flex: 1, padding: '7px 12px', fontSize: 12, border: `1px solid ${GB}`, borderRadius: 8, outline: 'none', color: TX }}
            onKeyDown={e => e.key === 'Enter' && submitHito()}
          />
          <button onClick={submitHito} style={{ padding: '7px 14px', background: G, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>
            Guardar
          </button>
        </div>
      )}

      {/* Timeline de reuniones */}
      {filtradas.length === 0 ? (
        <SectionCard>
          <div style={{ padding: 40, textAlign: 'center', color: DM, fontSize: 13 }}>
            {query ? 'Sin resultados para esa búsqueda.' : 'Aún no hay juntas registradas. Agrega la primera.'}
          </div>
        </SectionCard>
      ) : (
        <SectionCard>
          <SectionHeader icon="📋" title="Reuniones del proyecto" badge={filtradas.length} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {filtradas.map((r, idx) => {
              const p = r.parsed ?? {};
              const isOpen = expanded === r.id;
              const estColor = p.estado_proyecto === 'bloqueado' ? RD : p.estado_proyecto === 'en_revision' ? AM : G;
              return (
                <div key={r.id} style={{ borderBottom: idx < filtradas.length - 1 ? `1px solid ${GB}` : 'none' }}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    style={{
                      padding: '12px 18px', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', gap: 12,
                      background: isOpen ? `${G}08` : 'transparent',
                    }}
                  >
                    <div style={{ minWidth: 70 }}>
                      <div style={{ fontSize: 11, color: DM }}>{r.fecha}</div>
                      <div style={{ fontSize: 10, color: DM, marginTop: 2 }}>
                        {r.fuente === 'gmail' ? '📧' : '✍️'} {r.fuente}
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: TX }}>{r.titulo}</div>
                      {p.resumen && (
                        <div style={{ fontSize: 11, color: DM, marginTop: 2 }}>{p.resumen.slice(0, 100)}{p.resumen.length > 100 ? '…' : ''}</div>
                      )}
                    </div>
                    {p.estado_proyecto && (
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 100, background: `${estColor}18`, color: estColor, border: `1px solid ${estColor}33` }}>
                        {p.estado_proyecto}
                      </span>
                    )}
                    <span style={{ fontSize: 14, color: DM }}>{isOpen ? '▲' : '▼'}</span>
                  </div>

                  {isOpen && (
                    <div style={{ padding: '4px 18px 16px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {p.participantes?.length ? (
                        <div>
                          <div style={{ fontSize: 10, color: DM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Participantes</div>
                          <div style={{ fontSize: 12, color: TX }}>{p.participantes.join(', ')}</div>
                        </div>
                      ) : null}
                      {p.decisiones?.length ? (
                        <div>
                          <div style={{ fontSize: 10, color: DM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Decisiones</div>
                          {p.decisiones.map((d, i) => <div key={i} style={{ fontSize: 12, color: TX, padding: '2px 0' }}>• {d}</div>)}
                        </div>
                      ) : null}
                      {p.action_items?.length ? (
                        <div>
                          <div style={{ fontSize: 10, color: DM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Action items</div>
                          {p.action_items.map((ai, i) => (
                            <div key={i} style={{ fontSize: 12, color: TX, padding: '3px 0', display: 'flex', gap: 8 }}>
                              <span>☐</span>
                              <span style={{ flex: 1 }}>{ai.tarea}</span>
                              {ai.responsable && <span style={{ color: G, fontWeight: 600 }}>{ai.responsable}</span>}
                              {ai.fecha_limite && <span style={{ color: DM }}>{ai.fecha_limite}</span>}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {p.hallazgos_tecnicos?.length ? (
                        <div>
                          <div style={{ fontSize: 10, color: DM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Hallazgos técnicos</div>
                          {p.hallazgos_tecnicos.map((h, i) => <div key={i} style={{ fontSize: 12, color: TX, padding: '2px 0' }}>⚙ {h}</div>)}
                        </div>
                      ) : null}
                      {p.riesgos?.length ? (
                        <div>
                          <div style={{ fontSize: 10, color: DM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Riesgos</div>
                          {p.riesgos.map((rr, i) => <div key={i} style={{ fontSize: 12, color: RD, padding: '2px 0' }}>⚠ {rr}</div>)}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Modal agregar reunión */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: SF, borderRadius: 14, width: '90%', maxWidth: 560,
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)', padding: 28,
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TX }}>Agregar junta FO / Blackstone</div>
            <div style={{ fontSize: 12, color: DM }}>
              Pega aquí las notas de la reunión (las notas de Gemini, el resumen de Elizabeth, o lo que tengas).
              Claude extraerá decisiones y action items automáticamente.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                value={modalFecha}
                onChange={e => setModalFecha(e.target.value)}
                type="date"
                style={{ padding: '7px 10px', border: `1px solid ${GB}`, borderRadius: 8, fontSize: 12, color: TX, outline: 'none' }}
              />
              <input
                value={modalTitulo}
                onChange={e => setModalTitulo(e.target.value)}
                placeholder="Título (opcional — Claude lo infiere)"
                style={{ flex: 1, padding: '7px 10px', border: `1px solid ${GB}`, borderRadius: 8, fontSize: 12, color: TX, outline: 'none' }}
              />
            </div>
            <textarea
              value={modalTexto}
              onChange={e => setModalTexto(e.target.value)}
              placeholder="Pega aquí las notas completas de la reunión..."
              rows={10}
              style={{
                resize: 'vertical', padding: '10px 12px', border: `1px solid ${GB}`,
                borderRadius: 8, fontSize: 12, color: TX, outline: 'none', fontFamily: 'inherit',
              }}
            />
            {saveMsg && (
              <div style={{ fontSize: 12, color: saveMsg.startsWith('✓') ? G : RD }}>{saveMsg}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowModal(false); setSaveMsg(''); }} style={{
                padding: '8px 18px', background: BG, color: DM, border: `1px solid ${GB}`,
                borderRadius: 8, fontSize: 12, cursor: 'pointer',
              }}>
                Cancelar
              </button>
              <button onClick={submitReunion} disabled={saving} style={{
                padding: '8px 20px', background: saving ? DM : G, color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: saving ? 'default' : 'pointer',
              }}>
                {saving ? 'Procesando con Claude...' : 'Guardar reunión'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KPIsPDN() {
  const [tickets, setTickets] = useState<TicketG[]>([]);
  const [alertas, setAlertas] = useState<any[]>([]);
  const [sidf, setSidf] = useState<SidfCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState<'idle'|'loading'|'ok'|'err'>('idle');
  const [showNuevoTicket, setShowNuevoTicket] = React.useState(false);

  const { user } = useAuth();

  const generateReport = async () => {
    setReporting('loading');
    // Leer cajas Lancermex desde localStorage para incluir en el reporte
    let lancermexCajas = 0;
    try {
      const raw = localStorage.getItem(LS_LANCEMEX);
      if (raw) { const entries = JSON.parse(raw); lancermexCajas = entries[0]?.cajas ?? 0; }
    } catch {}
    try {
      const token = localStorage.getItem('xcien_token');
      const r = await fetch(`${API_BASE}/api/blackstone/reporte-pdn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lancermex_cajas: lancermexCajas }),
      });
      setReporting(r.ok ? 'ok' : 'err');
    } catch { setReporting('err'); }
    setTimeout(() => setReporting('idle'), 4000);
  };

  const load = React.useCallback(() => {
    const pdnTerms = ['piedras', 'acuña', 'acuna', 'pdn', 'acu'];
    const token = localStorage.getItem('xcien_token');
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/wfm/field-tickets?limit=200`).then(r => r.ok ? r.json() : { tickets: [] }),
      fetch(`${API_BASE}/api/noc/alerts?active_only=true&limit=500`).then(r => r.ok ? r.json() : {}),
      fetch(`${API_BASE}/api/red/clientes-sidf`).then(r => r.ok ? r.json() : { clientes: [] }),
      fetch(`${API_BASE}/api/blackstone/tickets`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : { tickets: [] }),
    ]).then(([w, n, s, b]) => {
      const ts = (w.tickets ?? []).filter((t: TicketG) => {
        const hay = t.nombre.toLowerCase();
        return !t.cerrado && pdnTerms.some(term => hay.includes(term));
      });
      const bts = (b.tickets ?? []).filter((t: TicketG) => !t.cerrado);
      const merged = [...ts];
      for (const bt of bts) {
        if (!merged.find(m => m.odoo_id === bt.odoo_id)) merged.push(bt);
      }
      setTickets(merged);

      const alerts = Array.isArray(n) ? n : (n.alerts ?? []);
      setAlertas(alerts.filter((a: any) => {
        const hay = `${a.cityName} ${a.hostName} ${a.siteName}`.toLowerCase();
        return pdnTerms.some(t => hay.includes(t));
      }));

      setSidf((s.clientes ?? []).filter((c: SidfCliente) => c.plaza === 'pn'));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const fallas     = tickets.filter(t => t.tipo === 'falla');
  const habs       = tickets.filter(t => t.tipo === 'habilitacion');
  const urgentes   = tickets.filter(t => t.prioridad === 'urgent');
  const criticas   = alertas.filter(a => a.severity === 'critical');
  const avgAgeH    = tickets.length > 0
    ? tickets.reduce((s, t) => s + (Date.now() - new Date(t.fecha_creacion.replace(' ', 'T') + 'Z').getTime()) / 3600000, 0) / tickets.length
    : 0;
  const avgAgeStr  = avgAgeH > 48 ? `${Math.floor(avgAgeH / 24)}d` : `${Math.round(avgAgeH)}h`;

  const sidfActivos     = sidf.filter(c => c.estado === 'activo').length;
  const sidfInstalacion = sidf.filter(c => c.estado === 'instalacion').length;

  const kpis = [
    { label: 'Tickets PDN', value: tickets.length, sub: `${urgentes.length} urgentes`, color: urgentes.length > 0 ? RD : G, icon: '⚡' },
    { label: 'Fallas activas', value: fallas.length, sub: 'plaza PDN', color: fallas.length > 0 ? AM : G, icon: '⚠' },
    { label: 'Habilitaciones', value: habs.length, sub: 'en proceso', color: BL, icon: '✦' },
    { label: 'Alertas NOC', value: alertas.length, sub: `${criticas.length} críticas`, color: criticas.length > 0 ? RD : alertas.length > 0 ? AM : G, icon: '◈' },
    { label: 'SIDF activos', value: sidfActivos, sub: `${sidfInstalacion} en instalación`, color: G, icon: '◎' },
    { label: 'Edad promedio', value: 0, rawStr: loading ? '—' : avgAgeStr, sub: 'tickets abiertos', color: DM, icon: '◷' },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {showNuevoTicket && (
        <NuevoTicketModal
          onClose={() => setShowNuevoTicket(false)}
          onCreated={() => { setShowNuevoTicket(false); /* refresca tickets */ load(); }}
        />
      )}

      {/* Botón nuevo ticket — admin y director */}
      {(user?.rol === 'admin' || user?.rol === 'director') && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setShowNuevoTicket(true)} style={{
            padding: '7px 18px', borderRadius: 20, border: `1.5px solid ${G}`,
            background: `${G}12`, color: G, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 16 }}>+</span> Nuevo Ticket PDN
          </button>
        </div>
      )}

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {kpis.map(k => (
          <div key={k.label} style={{
            background: SF, borderRadius: 12, border: `1px solid ${GB}`,
            boxShadow: SH, padding: '18px 20px',
            borderLeft: `3px solid ${k.color}`, position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, right: 0, width: 60, height: 60,
              background: `radial-gradient(circle at 80% 20%, ${k.color}0c, transparent 70%)`,
              pointerEvents: 'none',
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: k.color, opacity: 0.7 }}>{k.icon}</span>
              <span style={{ fontSize: 9, color: DM, letterSpacing: 1.5, textTransform: 'uppercase' }}>{k.label}</span>
            </div>
            <div style={{
              fontSize: 36, fontWeight: 800, color: k.color, lineHeight: 1,
              opacity: loading ? 0.3 : 1, transition: 'opacity 0.3s', fontVariantNumeric: 'tabular-nums',
            }}>
              {loading ? '—' : (k.rawStr ?? k.value)}
            </div>
            <div style={{ fontSize: 10, color: DM, marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* SIDF breakdown */}
      <SectionCard>
        <SectionHeader icon="◎" title="Clientes SIDF — Piedras Negras" badge={sidf.length} badgeColor={G} />
        {sidf.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: DM, fontSize: 12 }}>
            {loading ? 'Cargando clientes…' : 'Sin clientes SIDF registrados en PDN'}
          </div>
        ) : (
          <div style={{ padding: '8px 0' }}>
            {sidf.map((c, i) => {
              const col = c.estado === 'activo' ? G : c.estado === 'instalacion' ? AM : BL;
              return (
                <div key={c.id} style={{
                  padding: '10px 18px',
                  borderBottom: i < sidf.length - 1 ? `1px solid ${GB}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 12, color: TX, fontFamily: 'system-ui, sans-serif' }}>
                    {c.nombre}
                  </div>
                  {c.velocidad && (
                    <span style={{ fontSize: 10, color: DM, fontVariantNumeric: 'tabular-nums' }}>{c.velocidad}</span>
                  )}
                  {c.noc_monitoreado && (
                    <span style={{ fontSize: 9, color: G }}>✓ NOC</span>
                  )}
                  <span style={{
                    fontSize: 9, padding: '2px 9px', borderRadius: 100, fontWeight: 700,
                    background: `${col}15`, color: col, border: `1px solid ${col}30`,
                  }}>{c.estado}</span>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Tareas Field Service PDN — lista completa */}
      <SectionCard>
        <SectionHeader icon="🎫" title="Tareas PDN — Proyecto 240" badge={tickets.length} badgeColor={G} />
        {tickets.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: DM, fontSize: 12 }}>
            {loading ? 'Cargando tareas...' : 'Sin tareas abiertas en proyecto PDN'}
          </div>
        ) : (
          <div>
            {tickets.map((t, i) => {
              const prioColor = t.prioridad === 'urgent' ? RD : t.tipo === 'pdn' ? BL : GD;
              return (
                <div key={t.id} style={{
                  padding: '11px 18px',
                  borderBottom: i < tickets.length - 1 ? `1px solid ${GB}` : 'none',
                  borderLeft: `3px solid ${prioColor}`,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: DM, marginBottom: 2 }}>{t.id}</div>
                    <div style={{ fontSize: 12, color: TX, fontFamily: 'system-ui, sans-serif', fontWeight: 500, marginBottom: 3 }}>
                      {t.nombre}
                    </div>
                    <div style={{ fontSize: 10, color: DM }}>
                      {t.tecnico ? `👤 ${t.tecnico}` : '—'} · {t.etapa_op || 'Sin etapa'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: DM, marginBottom: 4 }}>{tiempoAtras(t.fecha_creacion)}</div>
                    <a
                      href={`https://odoo.wispi.mx/odoo/all-tasks/${t.odoo_id}`}
                      target="_blank" rel="noreferrer"
                      style={{ fontSize: 9, color: G, textDecoration: 'none', fontWeight: 700 }}
                    >Ver en Odoo ↗</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Prospectos Amistad resumen */}
      <SectionCard style={{ padding: 18 }}>
        <div style={{ fontSize: 10, color: DM, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>
          🏭 Pipeline Amistad — resumen
        </div>
        <div style={{ fontSize: 12, color: TX, fontFamily: 'system-ui, sans-serif', lineHeight: 1.7 }}>
          <span style={{ fontWeight: 700, color: GD }}>{PROSPECTOS_PDN.length}</span> prospectos industriales identificados en Parque Amistad.
          Gestiona el pipeline completo en el tab <span style={{ color: G, fontWeight: 600 }}>🏭 AMISTAD</span>.
        </div>
      </SectionCard>

      {/* Botón reporte */}
      <button
        onClick={generateReport}
        disabled={reporting === 'loading' || loading}
        style={{
          width: '100%', padding: '14px 0', borderRadius: 12, border: `1.5px solid`,
          borderColor: reporting === 'ok' ? G : reporting === 'err' ? RD : GB,
          background: reporting === 'ok' ? `${G}10` : reporting === 'err' ? `${RD}08` : SF,
          color: reporting === 'ok' ? G : reporting === 'err' ? RD : GD,
          fontSize: 13, fontWeight: 700, cursor: reporting === 'loading' ? 'wait' : 'pointer',
          boxShadow: SH, transition: 'all .2s', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 8,
        }}
      >
        {reporting === 'loading' ? '⏳ Generando reporte...' :
         reporting === 'ok'      ? '✓ PDF enviado a Telegram' :
         reporting === 'err'     ? '✗ Error — intenta de nuevo' :
         '📄 Generar reporte de hallazgos → Telegram'}
      </button>
    </div>
  );
}

// ── LevantamientoTab — vista supervisión de levantamientos ───────────────────

const CUADRILLAS_API = (import.meta.env.VITE_CUADRILLAS_API as string) || 'http://localhost:8020';

const TIPO_ICONS: Record<string, string> = {
  caja: '📦', radiobase: '📡', tramo_fibra: '〰️', acceso_cliente: '🏠',
};
const COND_COLOR: Record<string, string> = {
  buena: G, regular: AM, mantenimiento: BL, critica: RD,
};
const ZONA_OPTS = ['PDN', 'AGS', 'QRO', 'SLT', 'MTY'];
const TIPO_OPTS = ['caja', 'radiobase', 'tramo_fibra', 'acceso_cliente'];

// Mini mapa con Leaflet — red PDN + pins levantamientos
function LevMap({ items, zona }: { items: any[]; zona: string }) {
  const divRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<any>(null);

  React.useEffect(() => {
    if (!divRef.current) return;
    let L: any;
    let map: any;

    import('leaflet').then((mod) => {
      L = mod.default ?? mod;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      map = L.map(divRef.current!, { zoomControl: true, attributionControl: false });
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Cargar GeoJSON de la red
      fetch(`${CUADRILLAS_API}/api/levantamiento/geojson/${zona}`)
        .then(r => r.ok ? r.json() : null)
        .then(gj => {
          if (!gj) return;
          L.geoJSON(gj, {
            style: { color: '#009A5A', weight: 2.5, opacity: 0.8 },
            pointToLayer: (_: any, latlng: any) =>
              L.circleMarker(latlng, { radius: 4, fillColor: '#009A5A', fillOpacity: 1, color: '#fff', weight: 1 }),
          }).addTo(map);
        }).catch(() => null);

      // Pines de levantamientos con GPS
      const conGps = items.filter(i => i.lat && i.lng);
      const condColors: Record<string, string> = {
        buena: '#009A5A', regular: '#F59E0B', mantenimiento: '#3B82F6', critica: '#EF4444',
      };

      conGps.forEach(item => {
        const color = condColors[item.condicion] || '#888';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        L.marker([item.lat, item.lng], { icon })
          .bindPopup(`<b>${TIPO_ICONS[item.tipo_elemento] || ''} ${item.tipo_elemento.replace('_', ' ')}</b><br>${item.condicion}<br>${item.tecnico_nombre || ''}`)
          .addTo(map);
      });

      // Centrar mapa
      if (conGps.length > 0) {
        const bounds = L.latLngBounds(conGps.map((i: any) => [i.lat, i.lng]));
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      } else {
        // Centro aproximado PDN
        const centers: Record<string, [number, number]> = {
          PDN: [28.7006, -100.5230], AGS: [21.8818, -102.2842],
          QRO: [20.5888, -100.3899], SLT: [25.4232, -100.9963], MTY: [25.6866, -100.3161],
        };
        const c = centers[zona] || [23.6345, -102.5528];
        map.setView(c, 12);
      }
    });

    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [items, zona]);

  return <div ref={divRef} style={{ height: 360, borderRadius: 12, overflow: 'hidden', border: `1px solid ${GB}` }} />;
}

// Barra de progreso por categoría
function ProgressBar({ label, val, total, color }: { label: string; val: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: TX, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color: DM, fontFamily: 'monospace' }}>{val} <span style={{ color: DM, fontSize: 10 }}>({pct}%)</span></span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: `${color}20`, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color, transition: 'width .4s' }} />
      </div>
    </div>
  );
}

function LevantamientoTab() {
  const [items, setItems]     = React.useState<any[]>([]);
  const [stats, setStats]     = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [offline, setOffline] = React.useState(false);
  const [zona, setZona]       = React.useState('PDN');
  const [tipo, setTipo]       = React.useState('');
  const [tab, setTab]         = React.useState<'tablero'|'mapa'|'registros'|'ordenes'>('ordenes');
  const [selected, setSelected] = React.useState<any>(null);
  const adminKey = localStorage.getItem('admin_apikey') || '';

  // Órdenes FO desde Odoo
  const [foTickets, setFoTickets]   = React.useState<TicketG[]>([]);
  const [foLoading, setFoLoading]   = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setOffline(false);
    try {
      const params = new URLSearchParams();
      if (zona) params.set('zona', zona);
      if (tipo) params.set('tipo', tipo);
      const [rList, rStats] = await Promise.all([
        fetch(`${CUADRILLAS_API}/api/levantamiento/listar?${params}`, { headers: { 'X-API-Key': adminKey } }),
        fetch(`${CUADRILLAS_API}/api/levantamiento/stats?zona=${zona}`, { headers: { 'X-API-Key': adminKey } }),
      ]);
      if (rList.ok)  setItems((await rList.json()).levantamientos || []);
      if (rStats.ok) setStats(await rStats.json());
    } catch {
      setOffline(true);
    } finally { setLoading(false); }
  }, [zona, tipo, adminKey]);

  const loadFoTickets = React.useCallback(async () => {
    setFoLoading(true);
    try {
      const token = localStorage.getItem('xcien_token');
      const r = await fetch(`${API_BASE}/api/blackstone/fo-tickets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const d = await r.json();
        setFoTickets(d.tickets ?? []);
      }
    } catch { /* offline ok */ }
    setFoLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Cargar fo-tickets al montar Y cuando se cambia a ese tab
  React.useEffect(() => { loadFoTickets(); }, [loadFoTickets]);
  React.useEffect(() => {
    if (tab === 'ordenes') loadFoTickets();
  }, [tab, loadFoTickets]);

  const fmt = (ts: string) => ts ? new Date(ts.replace(' ', 'T') + 'Z').toLocaleString('es-MX',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  const fmtDate = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-MX',
    { day: 'numeric', month: 'short' }) : '—';

  const TABS = [
    { id: 'tablero',   label: '📊 Tablero' },
    { id: 'mapa',      label: '🗺 Mapa' },
    { id: 'registros', label: '📋 Registros' },
    { id: 'ordenes',   label: '📡 Órdenes FO' },
  ] as const;

  // Banner inline cuando cuadrillas no está disponible (no bloquea Órdenes FO)
  const offlineBanner = offline ? (
    <div style={{ padding: '10px 14px', borderRadius: 8, background: `${AM}12`, border: `1px solid ${AM}30`,
      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, fontSize: 12 }}>
      <span style={{ fontSize: 16 }}>⚠️</span>
      <span style={{ color: AM, fontWeight: 700 }}>Cuadrillas :8020 no disponible</span>
      <span style={{ color: DM }}>— Mapa y registros requieren red interna o VPN</span>
      <button onClick={load} style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6,
        background: AM, color: '#fff', border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Reintentar</button>
    </div>
  ) : null;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13, color: TX }}>

      {/* Toolbar: zona + tabs + refresh */}
      <SectionCard style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: DM, fontWeight: 700 }}>ZONA</span>
        {ZONA_OPTS.map(z => (
          <button key={z} onClick={() => setZona(z)}
            style={{ padding: '4px 12px', borderRadius: 20, border: `1.5px solid ${zona === z ? G : GB}`,
              background: zona === z ? `${G}15` : 'transparent', color: zona === z ? G : DM,
              fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>{z}</button>
        ))}
        <div style={{ flexGrow: 1 }} />
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '5px 14px', borderRadius: 20, border: `1.5px solid ${tab === t.id ? G : GB}`,
              background: tab === t.id ? `${G}15` : 'transparent', color: tab === t.id ? G : DM,
              fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>{t.label}</button>
        ))}
        <button onClick={load} style={{ background: 'none', border: 'none', color: G, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>↻</button>
      </SectionCard>

      {offlineBanner}

      {/* ── TABLERO ── */}
      {tab === 'tablero' && (
        <>
          {/* KPIs principales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { lbl: 'Total registros',   val: stats?.total ?? '—',    color: TX },
              { lbl: 'Capturados hoy',    val: stats?.hoy ?? '—',      color: G  },
              { lbl: 'Con GPS',           val: items.filter(i => i.lat).length, color: BL },
              { lbl: 'Críticos',          val: stats?.criticos ?? '—', color: RD },
            ].map(s => (
              <SectionCard key={s.lbl} style={{ padding: '14px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{loading ? '…' : s.val}</div>
                <div style={{ fontSize: 10, color: DM, fontWeight: 700, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.lbl}</div>
              </SectionCard>
            ))}
          </div>

          {stats && stats.total > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {/* Por condición */}
              <SectionCard style={{ padding: 16 }}>
                <div style={{ fontSize: 10, color: DM, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Por condición</div>
                {[
                  { key: 'buena',         label: 'Buena',          color: G  },
                  { key: 'regular',       label: 'Regular',        color: AM },
                  { key: 'mantenimiento', label: 'Mantenimiento',  color: BL },
                  { key: 'critica',       label: 'Crítica',        color: RD },
                ].map(c => (
                  <ProgressBar key={c.key} label={c.label}
                    val={stats.por_condicion?.[c.key] ?? 0} total={stats.total} color={c.color} />
                ))}
              </SectionCard>

              {/* Por tipo */}
              <SectionCard style={{ padding: 16 }}>
                <div style={{ fontSize: 10, color: DM, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>Por tipo de elemento</div>
                {TIPO_OPTS.map(t => (
                  <ProgressBar key={t} label={`${TIPO_ICONS[t]} ${t.replace('_', ' ')}`}
                    val={stats.por_tipo?.[t] ?? 0} total={stats.total} color={G} />
                ))}
              </SectionCard>
            </div>
          )}

          {(!stats || stats.total === 0) && !loading && (
            <SectionCard>
              <div style={{ padding: 40, textAlign: 'center', color: DM }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
                <div style={{ fontWeight: 700 }}>Sin levantamientos en {zona}</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>Los técnicos aún no han capturado elementos en esta zona.</div>
              </div>
            </SectionCard>
          )}
        </>
      )}

      {/* ── MAPA ── */}
      {tab === 'mapa' && (
        <SectionCard style={{ padding: 14 }}>
          <div style={{ marginBottom: 10, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: DM, fontWeight: 700 }}>LEYENDA</span>
            {Object.entries({ buena: 'Buena', regular: 'Regular', mantenimiento: 'Mant.', critica: 'Crítica' }).map(([k,lbl]) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: COND_COLOR[k], display: 'inline-block', border: '1.5px solid #fff' }} />
                {lbl}
              </span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
              <span style={{ width: 22, height: 3, background: G, display: 'inline-block', borderRadius: 2 }} />
              Red fibra
            </span>
          </div>
          <LevMap items={items} zona={zona} />
          <div style={{ marginTop: 8, fontSize: 11, color: DM }}>
            {items.filter(i => i.lat).length} de {items.length} registros con GPS visible en el mapa.
          </div>
        </SectionCard>
      )}

      {/* ── REGISTROS ── */}
      {tab === 'registros' && (
        <>
          {/* Filtro tipo */}
          <SectionCard style={{ padding: '8px 14px', marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: DM, fontWeight: 700 }}>TIPO</span>
            <button onClick={() => setTipo('')}
              style={{ padding: '3px 10px', borderRadius: 20, border: `1.5px solid ${tipo === '' ? G : GB}`,
                background: tipo === '' ? `${G}15` : 'transparent', color: tipo === '' ? G : DM,
                fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Todos</button>
            {TIPO_OPTS.map(t => (
              <button key={t} onClick={() => setTipo(t)}
                style={{ padding: '3px 10px', borderRadius: 20, border: `1.5px solid ${tipo === t ? G : GB}`,
                  background: tipo === t ? `${G}15` : 'transparent', color: tipo === t ? G : DM,
                  fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>{TIPO_ICONS[t]} {t.replace('_', ' ')}</button>
            ))}
          </SectionCard>

          <SectionCard>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: DM }}>Cargando información…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: DM }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                <div style={{ fontWeight: 700 }}>Sin registros{tipo ? ` de ${tipo.replace('_',' ')}` : ''} en {zona}</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                  <thead>
                    <tr>
                      {['Elemento', 'Condición', 'Técnico', 'GPS', 'Observaciones', 'Fecha'].map(h => (
                        <th key={h} style={{ fontSize: 9, fontWeight: 800, color: DM, textTransform: 'uppercase',
                          letterSpacing: 1, padding: '8px 12px', textAlign: 'left',
                          borderBottom: `1px solid ${GB}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id}
                        onClick={() => setSelected(selected?.id === item.id ? null : item)}
                        style={{ cursor: 'pointer', background: selected?.id === item.id ? `${G}08` : 'transparent' }}>
                        <td style={{ padding: '10px 12px', borderBottom: `1px solid ${GB}` }}>
                          <span style={{ fontSize: 15, marginRight: 6 }}>{TIPO_ICONS[item.tipo_elemento] || '📋'}</span>
                          <span style={{ fontWeight: 700 }}>{item.tipo_elemento.replace('_', ' ')}</span>
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: `1px solid ${GB}` }}>
                          <span style={{ padding: '2px 10px', borderRadius: 20,
                            background: `${COND_COLOR[item.condicion]}18`,
                            color: COND_COLOR[item.condicion] || DM,
                            border: `1px solid ${COND_COLOR[item.condicion]}40`,
                            fontSize: 11, fontWeight: 700 }}>{item.condicion}</span>
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: `1px solid ${GB}`, color: DM }}>{item.tecnico_nombre || '—'}</td>
                        <td style={{ padding: '10px 12px', borderBottom: `1px solid ${GB}`, fontFamily: 'monospace', fontSize: 11, color: item.lat ? G : DM }}>
                          {item.lat ? `${(item.lat as number).toFixed(4)}, ${(item.lng as number).toFixed(4)}` : 'Sin GPS'}
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: `1px solid ${GB}`, maxWidth: 200, color: DM, fontSize: 12 }}>
                          {item.observaciones ? (item.observaciones as string).slice(0, 60) + ((item.observaciones as string).length > 60 ? '…' : '') : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', borderBottom: `1px solid ${GB}`, color: DM, fontSize: 11, whiteSpace: 'nowrap' }}>
                          {fmt(item.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Detalle expandible */}
          {selected && (
            <SectionCard style={{ marginTop: 12 }}>
              <SectionHeader icon="📋" title={`Detalle — ${(selected.tipo_elemento as string).replace('_', ' ')}`} />
              <div style={{ padding: '12px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 9, color: DM, fontWeight: 700, marginBottom: 3 }}>CONDICIÓN</div>
                  <span style={{ color: COND_COLOR[selected.condicion] || DM, fontWeight: 700 }}>{selected.condicion}</span>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: DM, fontWeight: 700, marginBottom: 3 }}>ZONA</div>
                  <span style={{ fontWeight: 700 }}>{selected.zona}</span>
                </div>
                {selected.lat && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 9, color: DM, fontWeight: 700, marginBottom: 3 }}>GPS</div>
                    <a href={`https://maps.google.com/?q=${selected.lat},${selected.lng}`} target="_blank"
                      rel="noreferrer" style={{ color: BL, fontFamily: 'monospace', fontSize: 12 }}>
                      {(selected.lat as number).toFixed(6)}, {(selected.lng as number).toFixed(6)} ↗
                    </a>
                  </div>
                )}
                {selected.observaciones && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 9, color: DM, fontWeight: 700, marginBottom: 3 }}>OBSERVACIONES</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>{selected.observaciones}</div>
                  </div>
                )}
                {selected.fotos && (selected.fotos as string[]).length > 0 && (
                  <div style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 9, color: DM, fontWeight: 700, marginBottom: 8 }}>FOTOS ({(selected.fotos as string[]).length})</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {(selected.fotos as string[]).map(f => (
                        <a key={f} href={`${CUADRILLAS_API}/api/levantamiento/foto/${f}`} target="_blank" rel="noreferrer">
                          <img src={`${CUADRILLAS_API}/api/levantamiento/foto/${f}`} alt="evidencia"
                            style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: `1px solid ${GB}` }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          )}
        </>
      )}
      {/* ── ÓRDENES FO — Odoo CAE-Operaciones ── */}
      {tab === 'ordenes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Hero card */}
          <div style={{
            background: `linear-gradient(135deg, ${GD} 0%, #2d7a3a 100%)`,
            borderRadius: 14, padding: '20px 24px', color: '#fff',
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{ fontSize: 32 }}>📡</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
                color: 'rgba(255,255,255,.55)', marginBottom: 3 }}>CAE — Operaciones</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Órdenes de Levantamiento FO</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
                Tareas Odoo · Proyecto CAE-Operaciones · Fibra Óptica Piedras Negras
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#7fff9a', fontVariantNumeric: 'tabular-nums' }}>
                {foLoading ? '…' : foTickets.filter(t => !t.cerrado).length}
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', textTransform: 'uppercase', letterSpacing: 1 }}>Activas</div>
            </div>
          </div>

          <SectionCard accent={BL}>
            <SectionHeader
              icon="📡"
              title="Órdenes FO — Odoo CAE-Operaciones"
              badge={foTickets.filter(t => !t.cerrado).length}
              badgeColor={BL}
              action={
                <button onClick={loadFoTickets} style={{
                  background: 'none', border: 'none', color: G, cursor: 'pointer',
                  fontSize: 16, padding: '0 4px', lineHeight: 1,
                }} title="Recargar">↻</button>
              }
            />
            {foLoading ? (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: DM, fontSize: 12 }}>
                Cargando órdenes desde Odoo…
              </div>
            ) : foTickets.length === 0 ? (
              <div style={{ padding: '36px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>📭</div>
                <div style={{ fontWeight: 700, color: TX, marginBottom: 4 }}>Sin órdenes FO activas</div>
                <div style={{ fontSize: 12, color: DM }}>No hay tareas de levantamiento en el proyecto CAE-Operaciones.</div>
              </div>
            ) : (
              foTickets.map((t, i) => {
                const isUrgent = t.prioridad === 'urgent';
                const accentColor = t.cerrado ? DM : isUrgent ? RD : BL;
                const today = new Date().toISOString().slice(0, 10);
                const isLate = t.date_deadline && t.date_deadline < today && !t.cerrado;
                return (
                  <div key={t.odoo_id} style={{
                    padding: '14px 20px',
                    borderBottom: i < foTickets.length - 1 ? `1px solid ${GB}` : 'none',
                    borderLeft: `3px solid ${isLate ? RD : accentColor}`,
                    display: 'flex', gap: 14, alignItems: 'flex-start',
                    background: isLate ? `${RD}04` : 'transparent',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9, fontFamily: 'monospace', color: DM, background: `${DM}12`,
                          padding: '1px 6px', borderRadius: 4 }}>{t.id}</span>
                        {isLate && <StatusChip label="VENCIDA" color={RD} />}
                        {isUrgent && !isLate && <StatusChip label="URGENTE" color={AM} />}
                        {t.cerrado && <StatusChip label="CERRADA" color={DM} />}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: TX, marginBottom: 5, lineHeight: 1.4 }}>
                        {t.nombre}
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {t.tecnico && (
                          <span style={{ fontSize: 11, color: DM, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>👤</span> {t.tecnico}
                          </span>
                        )}
                        {t.cliente && (
                          <span style={{ fontSize: 11, color: DM, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>🏢</span> {t.cliente}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: DM }}>
                          Etapa: <span style={{ color: TX, fontWeight: 600 }}>{t.etapa_op || '—'}</span>
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(t as any).date_deadline && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: isLate ? RD : DM }}>
                          {isLate ? '⚠ ' : ''}Límite: {fmtDate((t as any).date_deadline)}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: DM }}>{tiempoAtras(t.fecha_creacion)}</div>
                      <a
                        href={`https://odoo.wispi.mx/odoo/all-tasks/${t.odoo_id}`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 10, color: G, textDecoration: 'none', fontWeight: 700,
                          display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      >Ver en Odoo ↗</a>
                    </div>
                  </div>
                );
              })
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}

// ── OportunidadesTab — CRM Odoo wispi19 ──────────────────────────────────────

interface Oportunidad {
  id: number;
  nombre: string;
  etapa: string;
  cerrado: boolean;
  probabilidad: number;
  ingresos: number;
  cliente: string;
  propietario: string;
  equipo: string;
  fecha_cierre: string;
  fecha_creacion: string;
  prioridad: string;
}

const ETAPA_COLORS: Record<string, string> = {
  'nuevo':             BL,
  'calificado':        BL,
  'propuesta':         AM,
  'estudio presencial':AM,
  'negociacion':       PU,
  'negociación':       PU,
  'ganado':            G,
  'perdido':           RD,
};

function etapaColor(etapa: string): string {
  const key = etapa.toLowerCase().replace('> ', '').trim();
  for (const [k, c] of Object.entries(ETAPA_COLORS)) {
    if (key.includes(k)) return c;
  }
  return DM;
}

function ProbBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: `${color}20`, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {pct}%
      </span>
    </div>
  );
}

function OportunidadesTab() {
  const [opps,    setOpps]    = useState<Oportunidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [filtro,  setFiltro]  = useState<'todas' | 'activas' | 'cerradas'>('activas');
  const [busq,    setBusq]    = useState('');

  const load = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = localStorage.getItem('xcien_token');
      const r = await fetch(`${API_BASE}/api/blackstone/oportunidades`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setOpps(d.oportunidades ?? []);
    } catch (e: any) {
      setError(e.message ?? 'No se pudo cargar la información');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = opps
    .filter(o => filtro === 'todas' ? true : filtro === 'activas' ? !o.cerrado : o.cerrado)
    .filter(o => {
      if (!busq) return true;
      const q = busq.toLowerCase();
      return (o.nombre + o.cliente + o.propietario + o.etapa).toLowerCase().includes(q);
    });

  const totalIngresos  = opps.filter(o => !o.cerrado).reduce((s, o) => s + o.ingresos, 0);
  const totalActivas   = opps.filter(o => !o.cerrado).length;
  const probPromedio   = totalActivas > 0
    ? Math.round(opps.filter(o => !o.cerrado).reduce((s, o) => s + o.probabilidad, 0) / totalActivas)
    : 0;

  const fmtMXN = (v: number) => v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  const fmtFecha = (d: string) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit' })
    : '—';

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: 'Oportunidades activas', value: loading ? '—' : String(totalActivas), color: BL, icon: '◎' },
          { label: 'Pipeline total',        value: loading ? '—' : fmtMXN(totalIngresos), color: G,  icon: '$' },
          { label: 'Prob. promedio',        value: loading ? '—' : `${probPromedio}%`,    color: PU, icon: '◈' },
        ].map(k => (
          <div key={k.label} style={{
            background: SF, borderRadius: 12, border: `1px solid ${GB}`,
            boxShadow: SH, padding: '16px 20px', borderLeft: `3px solid ${k.color}`,
          }}>
            <div style={{ fontSize: 9, color: DM, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
              {k.icon} {k.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Controles */}
      <SectionCard style={{ padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['activas', 'todas', 'cerradas'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)} style={{
            padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            border: `1.5px solid ${filtro === f ? BL : GB}`,
            background: filtro === f ? `${BL}15` : 'transparent',
            color: filtro === f ? BL : DM,
            textTransform: 'capitalize',
          }}>{f}</button>
        ))}
        <div style={{ flexGrow: 1 }} />
        <input
          value={busq} onChange={e => setBusq(e.target.value)}
          placeholder="Buscar cliente / nombre..."
          style={{
            padding: '5px 12px', fontSize: 12, border: `1px solid ${GB}`,
            borderRadius: 8, outline: 'none', color: TX, minWidth: 180,
          }}
        />
        <button onClick={load} style={{ background: 'none', border: 'none', color: G, cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>↻</button>
      </SectionCard>

      {/* Lista */}
      <SectionCard accent={BL}>
        <SectionHeader icon="💼" title="Pipeline CRM — Odoo wispi19" badge={visible.length} badgeColor={BL} />
        {loading ? (
          <div style={{ padding: '40px 18px', textAlign: 'center', color: DM, fontSize: 12 }}>
            Cargando oportunidades desde Odoo…
          </div>
        ) : error ? (
          <div style={{ padding: '32px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: RD, marginBottom: 8 }}>⚠ {error}</div>
            <button onClick={load} style={{ padding: '6px 16px', borderRadius: 8, background: G, color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer' }}>
              Reintentar
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div style={{ padding: '40px 18px', textAlign: 'center', color: DM, fontSize: 12 }}>
            Sin oportunidades con los filtros actuales
          </div>
        ) : (
          visible.map((o, i) => {
            const eColor = etapaColor(o.etapa);
            const today  = new Date().toISOString().slice(0, 10);
            const isLate = o.fecha_cierre && o.fecha_cierre < today && !o.cerrado;
            const isHigh = o.prioridad === '1' || o.prioridad === '2';
            return (
              <div key={o.id} style={{
                padding: '14px 20px',
                borderBottom: i < visible.length - 1 ? `1px solid ${GB}` : 'none',
                borderLeft: `3px solid ${isLate ? RD : eColor}`,
                background: isLate ? `${RD}03` : 'transparent',
                display: 'flex', gap: 14, alignItems: 'flex-start',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, padding: '2px 8px', borderRadius: 100, fontWeight: 700,
                      background: `${eColor}15`, color: eColor, border: `1px solid ${eColor}30`,
                      textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>{o.etapa.replace('> ', '')}</span>
                    {isHigh && <StatusChip label="PRIORITARIA" color={AM} />}
                    {isLate  && <StatusChip label="VENCIDA"    color={RD} />}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TX, marginBottom: 5, lineHeight: 1.4 }}>
                    {o.nombre}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                    {o.cliente && (
                      <span style={{ fontSize: 11, color: DM, display: 'flex', alignItems: 'center', gap: 4 }}>
                        🏢 {o.cliente}
                      </span>
                    )}
                    {o.propietario && (
                      <span style={{ fontSize: 11, color: DM, display: 'flex', alignItems: 'center', gap: 4 }}>
                        👤 {o.propietario}
                      </span>
                    )}
                    {o.equipo && (
                      <span style={{ fontSize: 11, color: DM, display: 'flex', alignItems: 'center', gap: 4 }}>
                        👥 {o.equipo}
                      </span>
                    )}
                  </div>
                  <ProbBar pct={o.probabilidad} color={eColor} />
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: G, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMXN(o.ingresos)}
                  </div>
                  {o.fecha_cierre && (
                    <div style={{ fontSize: 10, color: isLate ? RD : DM, fontWeight: isLate ? 700 : 400 }}>
                      {isLate ? '⚠ ' : ''}Cierre: {fmtFecha(o.fecha_cierre)}
                    </div>
                  )}
                  <a
                    href={`https://odoo.wispi.mx/odoo/crm/${o.id}`}
                    target="_blank" rel="noreferrer"
                    style={{ fontSize: 10, color: BL, textDecoration: 'none', fontWeight: 700 }}
                  >Ver en Odoo ↗</a>
                </div>
              </div>
            );
          })
        )}
      </SectionCard>
    </div>
  );
}

// ── BlackstoneOSSection — componente principal ────────────────────────────────

export default function BlackstoneOSSection({ theme: _theme }: { theme: ThemeConfig }) {
  const extraTabs: ExtraTab[] = [
    { id: 'lancemex',      icon: '🔌', label: 'Lancermex',      content: <LancermexTracker /> },
    { id: 'amistad',       icon: '🏭', label: 'Amistad',        content: <AmistadPipeline /> },
    { id: 'campo',         icon: '🔧', label: 'Guillermo',      content: <CampoPDN /> },
    { id: 'kpis',          icon: '📊', label: 'KPIs PDN',       content: <KPIsPDN /> },
    { id: 'levantamiento', icon: '📍', label: 'Levantamientos', content: <LevantamientoTab /> },
    { id: 'memoria',       icon: '🧠', label: 'Memoria FO',     content: <MemoriaTecnica /> },
    { id: 'oportunidades', icon: '💼', label: 'Oportunidades',  content: <OportunidadesTab /> },
  ];

  return (
    <CiudadOSSection
      config={PDN_CONFIG}
      theme={XCIEN_CORPORATE_THEME}
      extraTabs={extraTabs}
    />
  );
}
