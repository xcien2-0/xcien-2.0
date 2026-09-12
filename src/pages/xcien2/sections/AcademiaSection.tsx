import { useState, useEffect, useCallback, useMemo } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';
import brand from '../../../brand';
import { useAuth } from '@/contexts/AuthContext';
import { useAnalytics } from '../../../contexts/AnalyticsContext';
import AcademiaGerencial from './academia/AcademiaGerencial';
import AcademiaTecnico from './academia/AcademiaTecnico';

// ── Odoo eLearning types ──────────────────────────────────────────────────────
// ── Rutas de aprendizaje ──────────────────────────────────────────────────────
interface RutaCurso { curso_id: number; curso_name: string; orden: number; obligatorio: boolean; }
interface Ruta { area: string; nombre: string; descripcion: string; cursos: RutaCurso[]; color: string; icono: string; }

function RutasView({ theme }: { theme: ThemeConfig }) {
  const [rutas, setRutas]   = useState<Record<string, Ruta>>({});
  const [cursos, setCursos] = useState<Record<number, OdooCurso>>({});
  const [area, setArea]     = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/academia/rutas`).then(r => r.json()),
      fetch(`${API_BASE}/api/academia/cursos`).then(r => r.json()),
    ]).then(([rd, cd]) => {
      setRutas(rd);
      const map: Record<number, OdooCurso> = {};
      (cd as OdooCurso[]).forEach(c => { map[c.id] = c; });
      setCursos(map);
      const first = Object.keys(rd)[0];
      if (first) setArea(first);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#555', gap: 12 }}>
      <div style={{ width: 16, height: 16, border: `2px solid ${theme.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Cargando rutas...
    </div>
  );

  const areas = Object.values(rutas);
  const ruta  = rutas[area];
  const lc = (n: number) => n <= 2 ? '#4FC3F7' : n <= 5 ? '#00C896' : n <= 7 ? '#FFB703' : '#7c3aed';

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 500 }}>
      {/* Sidebar */}
      <div style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#444', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>ÁREAS</div>
        {areas.map(r => (
          <button key={r.area} onClick={() => setArea(r.area)} style={{
            display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', width: '100%', cursor: 'pointer',
            background: area === r.area ? `${r.color}22` : 'transparent',
            border: area === r.area ? `1px solid ${r.color}55` : '1px solid transparent',
            borderRadius: 9, padding: '8px 10px', transition: 'all 0.15s',
          }}>
            <span style={{ fontSize: 15, flexShrink: 0 }}>{r.icono}</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: area === r.area ? '#fff' : '#777', lineHeight: 1.2 }}>{r.area}</div>
              <div style={{ fontSize: 9, color: '#444', marginTop: 1 }}>{r.cursos.length} cursos</div>
            </div>
          </button>
        ))}
      </div>

      {/* Ruta */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {!ruta ? <div style={{ color: '#444', padding: 40, textAlign: 'center' }}>Selecciona un área</div> : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, padding: '12px 16px', background: `${ruta.color}18`, border: `1px solid ${ruta.color}33`, borderRadius: 12 }}>
              <span style={{ fontSize: 26 }}>{ruta.icono}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{ruta.nombre}</div>
                <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{ruta.descripcion}</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: ruta.color }}>{ruta.cursos.length}</div>
                <div style={{ fontSize: 9, color: '#444' }}>cursos</div>
              </div>
            </div>

            {ruta.cursos.map((item, i) => {
              const c = cursos[item.curso_id];
              const isLast = i === ruta.cursos.length - 1;
              const hasContent = c && c.lessons.length > 0;
              const pct = c?.avg_completion ?? 0;
              const pc = pct >= 80 ? '#00C896' : pct >= 40 ? '#FFB703' : '#4FC3F7';
              return (
                <div key={item.curso_id} style={{ display: 'flex', gap: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 34, flexShrink: 0 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: hasContent ? `${ruta.color}33` : 'rgba(255,255,255,0.04)', border: `2px solid ${hasContent ? ruta.color : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: hasContent ? ruta.color : '#444' }}>{item.orden}</div>
                    {!isLast && <div style={{ width: 2, flex: 1, minHeight: 14, background: hasContent ? `${ruta.color}33` : 'rgba(255,255,255,0.05)', margin: '2px 0' }} />}
                  </div>
                  <div style={{ flex: 1, marginLeft: 12, marginBottom: isLast ? 0 : 8, background: hasContent ? theme.card : '#0a0a0a', border: `0.5px solid ${hasContent ? theme.border : 'rgba(255,255,255,0.04)'}`, borderRadius: 10, padding: '11px 13px', opacity: hasContent ? 1 : 0.65 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: hasContent ? 7 : 0 }}>
                      <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: hasContent ? '#fff' : '#555', lineHeight: 1.3 }}>{c ? c.name : item.curso_name}</div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: item.obligatorio ? 'rgba(255,71,87,0.1)' : 'rgba(255,255,255,0.04)', color: item.obligatorio ? '#FF4757' : '#444', border: `0.5px solid ${item.obligatorio ? 'rgba(255,71,87,0.2)' : 'rgba(255,255,255,0.06)'}` }}>{item.obligatorio ? 'OBLIGATORIO' : 'OPCIONAL'}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 8, color: lc(item.orden), background: `${lc(item.orden)}15`, border: `0.5px solid ${lc(item.orden)}33` }}>Paso {item.orden}</span>
                      </div>
                    </div>
                    {hasContent && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: pc, borderRadius: 2, transition: 'width 0.8s ease' }} />
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 600, color: pc, flexShrink: 0 }}>{pct}%</span>
                        <span style={{ fontSize: 9, color: '#444', flexShrink: 0 }}>{c.lessons.length} lec.</span>
                        {c.members > 0 && <span style={{ fontSize: 9, color: '#444', flexShrink: 0 }}>{c.members} ins.</span>}
                        <a href={`https://odoo.wispi.mx/slides/${c.id}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 9, color: '#444', textDecoration: 'none', padding: '2px 7px', borderRadius: 5, border: `0.5px solid ${theme.border}`, flexShrink: 0 }}>Ver ↗</a>
                      </div>
                    )}
                    {!hasContent && <div style={{ fontSize: 9, color: '#444', fontStyle: 'italic', marginTop: 3 }}>En desarrollo — sin contenido aún</div>}
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: 0, marginTop: 6 }}>
              <div style={{ width: 34, display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: `${ruta.color}40`, border: `2px solid ${ruta.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🏅</div>
              </div>
              <div style={{ flex: 1, marginLeft: 12, padding: '9px 13px', background: `${ruta.color}0d`, border: `1px dashed ${ruta.color}44`, borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: ruta.color }}>{ruta.nombre} — Certificado</div>
                <div style={{ fontSize: 9, color: '#444', marginTop: 2 }}>Completa los cursos obligatorios para obtener la certificación</div>
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

interface OdooLesson {
  id: number; name: string; type: string; category: string;
  duration_h: number; published: boolean; sequence: number;
  url: string; website_url: string; has_quiz: boolean; views: number;
  contenido?: string[];
}
interface OdooCurso {
  id: number; name: string; description: string;
  total_slides: number; total_time_h: number;
  members: number; published: boolean; enroll: string; channel_type: string;
  avg_completion: number; lessons: OdooLesson[];
  members_list: { name: string; pct: number; status: string }[];
  is_local?: boolean;
}

// ── Academia Stats ────────────────────────────────────────────────────────────
interface AcademiaStats {
  total_tecnicos: number;
  avance_global: number;
  total_cursos: number;
  total_badges: number;
  top5: { name: string; pct: number; cursos: number; level: string }[];
  level_distribution: Record<string, number>;
}

// ── Shared helpers ────────────────────────────────────────────────────────────
const SLIDE_TYPE_ICON: Record<string, string> = {
  pdf: '📄', youtube_video: '▶️', google_drive_video: '🎬',
  article: '📝', certification: '🏅', infographic: '🖼️',
};

const LEVELS = [
  { name: 'Aprendiz',     min: 0,  max: 30,  icon: '🌱', color: '#94a3b8' },
  { name: 'Técnico',      min: 30, max: 50,  icon: '🔧', color: '#4FC3F7' },
  { name: 'Especialista', min: 50, max: 65,  icon: '⚙️', color: '#00C896' },
  { name: 'Avanzado',     min: 65, max: 80,  icon: '🏆', color: '#7c3aed' },
  { name: 'Experto',      min: 80, max: 95,  icon: '🎖️', color: '#FFB703' },
  { name: 'Leyenda',      min: 95, max: 100, icon: '⭐', color: '#f87171' },
];

const DIM   = '#6b7280';
const GREEN = '#00C896';
const RED   = '#f87171';

const MATRIX_COLS = Array.from({ length: 30 }, () => ({
  duration: 15 + Math.random() * 25,
  delay:    -Math.random() * 25,
  chars:    Array.from({ length: 60 }, () => Math.random() > 0.5 ? '1' : '0').join(' '),
}));

function MatrixBackground() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.1, pointerEvents: 'none', zIndex: 0 }}>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(30, 1fr)', fontFamily: 'monospace', fontSize: 12, color: '#00ff88', textShadow: '0 0 8px #00ff88', whiteSpace: 'nowrap', userSelect: 'none' }}>
        {MATRIX_COLS.map((col, i) => (
          <div key={i} style={{ animation: `matrixFall ${col.duration}s linear infinite`, animationDelay: `${col.delay}s`, writingMode: 'vertical-rl', textAlign: 'center' }}>
            {col.chars}
          </div>
        ))}
      </div>
      <style>{`@keyframes matrixFall{from{transform:translateY(-100%)}to{transform:translateY(100%)}}`}</style>
    </div>
  );
}

function BarProgress({ pct, color = GREEN }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.8s ease' }} />
    </div>
  );
}

function Ring({ pct, size = 40, stroke = 3, color = GREEN }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const [p, setP] = useState(0);
  useEffect(() => { const t = setTimeout(() => setP(pct), 100); return () => clearTimeout(t); }, [pct]);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${(p / 100) * circ} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)' }} />
    </svg>
  );
}

// ── CursosView ────────────────────────────────────────────────────────────────
function CursosView({ theme }: { theme: ThemeConfig }) {
  const [cursos, setCursos]     = useState<OdooCurso[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [selected, setSelected] = useState<OdooCurso | null>(null);
  const [search, setSearch]     = useState('');
  const [hovId, setHovId]       = useState<number | null>(null);
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null);
  const A = theme.accent;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/academia/cursos`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCursos(await r.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() =>
    cursos.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase())),
    [cursos, search],
  );

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: DIM, gap: 12 }}>
      <div style={{ width: 16, height: 16, border: `2px solid ${A}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Cargando cursos desde Odoo...
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ textAlign: 'center', padding: 40, color: RED }}>
      Error conectando con Odoo: {error}
    </div>
  );

  // ── Detalle de curso ────────────────────────────────────────────────────────
  if (selected) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={() => setSelected(null)} style={{
          background: 'rgba(255,255,255,0.04)', border: `1px solid ${theme.border}`,
          color: '#cbd5e1', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 12, flexShrink: 0,
        }}>← Volver</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</div>
          <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
            {selected.lessons.length} lecciones · {selected.members} inscritos · {selected.avg_completion}% avance promedio
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: selected.published ? `${A}14` : 'rgba(255,71,87,0.1)', color: selected.published ? A : RED, border: `1px solid ${selected.published ? A + '30' : 'rgba(255,71,87,0.3)'}` }}>
            {selected.published ? '● Publicado' : '● Borrador'}
          </span>
          <a href={`${brand.odooUrl}/slides/${selected.id}`} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 8, background: `${A}15`, color: A, border: `1px solid ${A}30`, textDecoration: 'none' }}>
            Ver en Odoo ↗
          </a>
        </div>
      </div>

      {/* Progress bar */}
      {selected.avg_completion > 0 && (
        <div style={{ padding: '14px 18px', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: theme.radius }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: DIM }}>Avance del grupo</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: selected.avg_completion >= 80 ? A : selected.avg_completion >= 40 ? '#FFB703' : RED }}>
              {selected.avg_completion}%
            </span>
          </div>
          <BarProgress pct={selected.avg_completion} color={selected.avg_completion >= 80 ? A : selected.avg_completion >= 40 ? '#FFB703' : RED} />
        </div>
      )}

      {/* Lecciones */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          Lecciones ({selected.lessons.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {selected.lessons.length === 0
            ? <div style={{ color: DIM, fontSize: 13, padding: '20px 0' }}>Sin lecciones registradas</div>
            : selected.lessons.map((l, idx) => {
              const isLocal = selected.is_local && Array.isArray(l.contenido) && l.contenido.length > 0;
              const isExpanded = expandedLesson === l.id;
              return (
                <div key={l.id} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', cursor: isLocal ? 'pointer' : 'default' }}
                    onClick={() => isLocal && setExpandedLesson(isExpanded ? null : l.id)}
                  >
                    <span style={{ fontSize: 11, color: DIM, fontFamily: 'monospace', width: 20, textAlign: 'right', flexShrink: 0 }}>{idx + 1}</span>
                    <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>{SLIDE_TYPE_ICON[l.type] || '📄'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                        {l.duration_h > 0 && <span style={{ fontSize: 10, color: DIM }}>{Math.round(l.duration_h * 60)} min</span>}
                        {l.has_quiz && <span style={{ fontSize: 10, color: '#FFB703' }}>🧪 Quiz</span>}
                        {l.views > 0 && <span style={{ fontSize: 10, color: DIM }}>{l.views} vistas</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: l.published ? `${A}10` : 'rgba(255,71,87,0.1)', color: l.published ? A : RED }}>
                        {l.published ? 'Publicada' : 'Borrador'}
                      </span>
                      {l.website_url && (
                        <a href={`${brand.odooUrl}${l.website_url}`} target="_blank" rel="noreferrer"
                          style={{ fontSize: 10, color: DIM, textDecoration: 'none', padding: '3px 8px', borderRadius: 6, border: `1px solid ${theme.border}` }}>
                          Ver ↗
                        </a>
                      )}
                      {isLocal && (
                        <span style={{ fontSize: 11, color: A, padding: '3px 8px', borderRadius: 6, border: `1px solid ${A}40` }}>
                          {isExpanded ? '▲ Cerrar' : '▼ Leer'}
                        </span>
                      )}
                    </div>
                  </div>
                  {isLocal && isExpanded && (
                    <div style={{ padding: '0 16px 16px 58px', borderTop: `1px solid ${theme.border}` }}>
                      {l.contenido!.map((linea, i) => {
                        const isBlank = linea.trim() === '';
                        const isHeader = linea.toUpperCase() === linea && linea.trim().length > 0 && !linea.startsWith('•');
                        const isBullet = linea.startsWith('•');
                        return isBlank
                          ? <div key={i} style={{ height: 8 }} />
                          : isHeader
                            ? <div key={i} style={{ fontSize: 11, fontWeight: 700, color: A, marginTop: 10, marginBottom: 3, letterSpacing: '0.05em' }}>{linea}</div>
                            : isBullet
                              ? <div key={i} style={{ fontSize: 12, color: theme.text, lineHeight: 1.6, paddingLeft: 12, marginBottom: 1 }}>{linea}</div>
                              : <div key={i} style={{ fontSize: 12, color: theme.text, lineHeight: 1.7, marginBottom: 4 }}>{linea}</div>;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Inscritos */}
      {selected.members_list.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            Inscritos ({selected.members_list.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...selected.members_list].sort((a, b) => b.pct - a.pct).map((m, i) => {
              const c = m.pct >= 80 ? A : m.pct >= 40 ? '#FFB703' : RED;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${c}14`, border: `1px solid ${c}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: c, flexShrink: 0 }}>
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{m.name}</div>
                    <BarProgress pct={m.pct} color={c} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: c, flexShrink: 0, minWidth: 36, textAlign: 'right' }}>{m.pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ── Lista de cursos ────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: DIM, pointerEvents: 'none' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar curso..."
            style={{ width: '100%', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '8px 14px 8px 34px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <button onClick={load} style={{ background: theme.card, border: `1px solid ${theme.border}`, color: DIM, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
          ↺ Actualizar
        </button>
        <span style={{ fontSize: 11, color: DIM, whiteSpace: 'nowrap', flexShrink: 0 }}>{filtered.length} cursos</span>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
        {filtered.map(c => {
          const pct   = c.avg_completion;
          const color = pct >= 80 ? A : pct >= 40 ? '#FFB703' : '#60a5fa';
          const isHov = hovId === c.id;
          return (
            <div key={c.id}
              onClick={() => setSelected(c)}
              onMouseEnter={() => setHovId(c.id)}
              onMouseLeave={() => setHovId(null)}
              style={{
                background: theme.card,
                border: `1px solid ${isHov ? A + '40' : theme.border}`,
                borderRadius: theme.radius,
                cursor: 'pointer',
                transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
                transform: isHov ? 'translateY(-2px)' : 'none',
                boxShadow: isHov ? `0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px ${A}20` : 'none',
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
              }}
            >
              {/* Accent stripe */}
              <div style={{ height: 3, background: `linear-gradient(90deg, ${color} 0%, ${color}40 60%, transparent 100%)` }} />

              <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Title + badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, flex: 1 }}>{c.name}</div>
                  <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, flexShrink: 0, background: c.published ? `${A}10` : 'rgba(255,255,255,0.04)', color: c.published ? A : DIM, border: `1px solid ${c.published ? A + '25' : theme.border}` }}>
                    {c.published ? '● Pub' : '○ Draft'}
                  </span>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{c.lessons.length}</div>
                    <div style={{ fontSize: 9, color: DIM, marginTop: 2 }}>lecciones</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{c.members}</div>
                    <div style={{ fontSize: 9, color: DIM, marginTop: 2 }}>inscritos</div>
                  </div>
                  {c.total_time_h > 0 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{Math.round(c.total_time_h * 60)}</div>
                      <div style={{ fontSize: 9, color: DIM, marginTop: 2 }}>minutos</div>
                    </div>
                  )}
                  {c.lessons.some(l => l.has_quiz) && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>🧪</div>
                      <div style={{ fontSize: 9, color: '#FFB703', marginTop: 2 }}>quiz</div>
                    </div>
                  )}
                </div>

                {/* Progress */}
                {c.members > 0 ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 10, color: DIM }}>Avance promedio</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color }}>{pct}%</span>
                    </div>
                    <BarProgress pct={pct} color={color} />
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }}>Sin inscritos aún</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PanoramaView ──────────────────────────────────────────────────────────────
function PanoramaView({ theme, stats, statsLoaded }: {
  theme: ThemeConfig;
  stats: AcademiaStats | null;
  statsLoaded: boolean;
}) {
  const [cursos, setCursos] = useState<OdooCurso[]>([]);
  const A = theme.accent;

  useEffect(() => {
    fetch(`${API_BASE}/api/academia/cursos`)
      .then(r => r.ok ? r.json() : [])
      .then(setCursos)
      .catch(() => {});
  }, []);

  const riesgoCount = useMemo(() => {
    if (!cursos.length) return 0;
    const map: Record<string, number[]> = {};
    for (const c of cursos) {
      for (const m of c.members_list) {
        if (!map[m.name]) map[m.name] = [];
        map[m.name].push(m.pct);
      }
    }
    return Object.values(map).filter(vals => (vals.reduce((a, b) => a + b, 0) / vals.length) < 30).length;
  }, [cursos]);

  const lowCourses = useMemo(() =>
    [...cursos]
      .filter(c => c.members > 0 && c.avg_completion < 80)
      .sort((a, b) => a.avg_completion - b.avg_completion)
      .slice(0, 7),
    [cursos],
  );

  const kpis = [
    { label: 'Técnicos activos',  val: stats?.total_tecnicos ?? '—',                              icon: '👷', color: A },
    { label: 'Avance global',     val: stats ? `${Math.round(stats.avance_global)}%` : '—',       icon: '📈', color: A },
    { label: 'Cursos activos',    val: stats?.total_cursos ?? '—',                                icon: '📚', color: '#60a5fa' },
    { label: 'En riesgo (<30%)',  val: statsLoaded ? (cursos.length ? riesgoCount : '…') : '—',  icon: '⚠️', color: RED },
  ];

  const medals = ['🥇', '🥈', '🥉'];
  const dist   = stats?.level_distribution ?? {};
  const top5   = stats?.top5 ?? [];
  const total  = stats?.total_tecnicos ?? 1;

  const card: React.CSSProperties = {
    background: theme.card,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radius,
    padding: 20,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {kpis.map((k, i) => (
          <div key={i} style={{ ...card, padding: '16px 20px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2.5, background: k.color, opacity: 0.8 }} />
            <div style={{ fontSize: 18, marginBottom: 6 }}>{k.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: k.color, letterSpacing: -1, fontFamily: 'Oswald, sans-serif', lineHeight: 1 }}>
              {k.val}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: DIM, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>
              {k.label}
            </div>
          </div>
        ))}
      </div>

      {/* Two-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Level distribution */}
          <div style={card}>
            <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
              Distribución por nivel
            </div>
            {!statsLoaded ? (
              <div style={{ color: DIM, fontSize: 13 }}>Cargando cursos…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {LEVELS.map(lv => {
                  const count = dist[lv.name] ?? 0;
                  const pct   = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={lv.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, width: 22, textAlign: 'center', flexShrink: 0 }}>{lv.icon}</span>
                      <div style={{ width: 88, fontSize: 11, color: '#cbd5e1', flexShrink: 0 }}>{lv.name}</div>
                      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: lv.color, borderRadius: 3, transition: 'width 1s ease' }} />
                      </div>
                      <div style={{ width: 28, textAlign: 'right', fontSize: 11, fontWeight: 700, color: lv.color, flexShrink: 0 }}>{count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top performers */}
          <div style={card}>
            <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
              Top técnicos · Odoo en vivo
            </div>
            {top5.length === 0 ? (
              <div style={{ color: DIM, fontSize: 13 }}>
                {statsLoaded ? 'Sin información disponible aún' : 'Calculando estadísticas…'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {top5.map((t, i) => {
                  const ringColor = i === 0 ? '#FFB703' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7c3b' : A;
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10,
                      background: i === 0 ? `${A}06` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${i === 0 ? A + '18' : 'rgba(255,255,255,0.04)'}`,
                    }}>
                      <span style={{ fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' }}>
                        {i < 3 ? medals[i] : i + 1}
                      </span>
                      <Ring pct={t.pct} size={36} stroke={3} color={ringColor} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                        <div style={{ fontSize: 10, color: DIM, marginTop: 1 }}>{t.level} · {t.cursos} cursos</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: i === 0 ? '#FFB703' : '#e2e8f0', flexShrink: 0, fontFamily: 'Oswald, sans-serif' }}>
                        {typeof t.pct === 'number' ? t.pct.toFixed(0) : '—'}%
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Courses needing attention */}
        <div style={card}>
          <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
            Cursos que necesitan atención
          </div>
          {lowCourses.length === 0 ? (
            <div style={{ color: DIM, fontSize: 13 }}>
              {cursos.length === 0 ? 'Cargando cursos...' : (
                <div style={{ textAlign: 'center', padding: '28px 0' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
                  <div style={{ fontSize: 13, color: A, fontWeight: 600 }}>¡Todos los cursos superan el 80%!</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lowCourses.map(c => {
                const pct   = c.avg_completion;
                const color = pct < 20 ? RED : pct < 50 ? '#fbbf24' : A;
                return (
                  <div key={c.id} style={{
                    padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${color}18`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, flex: 1, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {c.name}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 800, color, flexShrink: 0, fontFamily: 'Oswald, sans-serif' }}>{pct}%</span>
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.8s' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <span style={{ fontSize: 10, color: DIM }}>{c.members} inscritos</span>
                      <span style={{ fontSize: 10, color: DIM }}>·</span>
                      <span style={{ fontSize: 10, color: DIM }}>{c.lessons.length} lecciones</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Exam View ─────────────────────────────────────────────────────────────────

// Shared question/answer types (Odoo)
interface OdooAnswer      { id: number; text: string }
interface OdooPregunta    { id: number; question: string; slide: string; answers: OdooAnswer[] }
interface OdooExamen      { channel_id: number; name: string; total: number; preguntas: OdooPregunta[] }
interface OdooResult      { score_pct: number; correctas: number; total: number; nivel: string; xp_awarded: number; aprobado: boolean }
interface OdooCursoSlim   { id: number; name: string; total_slides: number; lessons: { has_quiz: boolean }[] }

// Colocación types
interface ColPregunta  { id: number; competencia_key: string; competencia_label: string; pregunta: string; opciones: string[] }
interface ColData      { total: number; preguntas: ColPregunta[] }
interface ColCompResult { key: string; label: string; correctas: number; total: number; pct: number; aprobada: boolean }
interface ColResult    {
  tecnico_name: string; plaza: string; total_correctas: number; total_preguntas: number;
  comp_pct: number; total_aprobadas: number; total_competencias: number;
  nivel: string; nivel_num: number; xp_awarded: number;
  competencias: ColCompResult[];
  plan_capacitacion: { num: number; nombre: string; descripcion: string }[];
  fecha: string;
}

// ── Shared: generic question flow ─────────────────────────────────────────────
function QuestionFlow({
  title, subtitle, preguntas, onSubmit, onBack, loading, error,
  renderQuestion, totalLabel,
}: {
  title: string; subtitle: string;
  preguntas: { id: number | string; label?: string }[];
  onSubmit: (resp: Record<string, number>) => void;
  onBack: () => void; loading: boolean; error: string;
  renderQuestion: (q: any, selected: number | undefined, onSelect: (v: number) => void) => React.ReactNode;
  totalLabel?: string;
}) {
  const [qIdx, setQIdx]       = useState(0);
  const [resp, setResp]       = useState<Record<string, number>>({});
  const total    = preguntas.length;
  const answered = Object.keys(resp).length;
  const current  = preguntas[qIdx] as any;
  const pct      = Math.round((answered / total) * 100);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: DIM, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 4 }}>← Volver</button>
          <div style={{ fontSize: 11, color: DIM }}>{subtitle}</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Pregunta {qIdx + 1} de {total}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: DIM, marginBottom: 4 }}>{answered}/{total} respondidas</div>
          <div style={{ width: 120, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: GREEN, borderRadius: 2, transition: 'width 0.4s ease' }} />
          </div>
        </div>
      </div>

      {/* Question */}
      <div style={{ background: '#151515', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 28, marginBottom: 16 }}>
        {current?.competencia_label && (
          <div style={{ fontSize: 10, color: GREEN, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, fontWeight: 700 }}>
            📋 {current.competencia_label}
          </div>
        )}
        {current?.slide && (
          <div style={{ fontSize: 10, color: DIM, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>📄 {current.slide}</div>
        )}
        {renderQuestion(current, resp[String(current?.id)], (v) => setResp(p => ({ ...p, [String(current.id)]: v })))}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => setQIdx(i => Math.max(0, i - 1))} disabled={qIdx === 0}
          style={{ padding: '10px 20px', borderRadius: 10, background: '#151515', border: '0.5px solid rgba(255,255,255,0.1)', color: qIdx === 0 ? '#333' : '#fff', cursor: qIdx === 0 ? 'not-allowed' : 'pointer', fontSize: 13 }}>
          ← Anterior
        </button>
        {qIdx < total - 1 ? (
          <button onClick={() => setQIdx(i => i + 1)}
            style={{ flex: 1, padding: '10px 20px', borderRadius: 10, background: resp[String(current?.id)] !== undefined ? 'rgba(0,200,150,0.15)' : '#151515', border: `0.5px solid ${resp[String(current?.id)] !== undefined ? 'rgba(0,200,150,0.3)' : 'rgba(255,255,255,0.1)'}`, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Siguiente →
          </button>
        ) : (
          <button onClick={() => onSubmit(resp)} disabled={loading || answered < total}
            style={{ flex: 1, padding: '10px 20px', borderRadius: 10, background: answered >= total ? GREEN : '#151515', border: 'none', color: answered >= total ? '#000' : '#333', cursor: answered >= total && !loading ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, transition: 'all 0.2s' }}>
            {loading ? 'Evaluando...' : answered < total ? `Responde todas (${answered}/${total})` : '✓ Enviar examen'}
          </button>
        )}
      </div>

      {/* Dot nav */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 18, justifyContent: 'center' }}>
        {preguntas.map((p, i) => (
          <button key={i} onClick={() => setQIdx(i)}
            style={{ width: 26, height: 26, borderRadius: 6, border: `1.5px solid ${i === qIdx ? GREEN : resp[String(p.id)] !== undefined ? 'rgba(0,200,150,0.4)' : 'rgba(255,255,255,0.1)'}`, background: i === qIdx ? 'rgba(0,200,150,0.15)' : resp[String(p.id)] !== undefined ? 'rgba(0,200,150,0.06)' : 'transparent', color: i === qIdx ? GREEN : resp[String(p.id)] !== undefined ? GREEN : DIM, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
            {i + 1}
          </button>
        ))}
      </div>
      {error && <div style={{ marginTop: 12, color: '#FF4757', fontSize: 12 }}>{error}</div>}
    </div>
  );
}

// ── Colocación Flow ────────────────────────────────────────────────────────────
function ColocacionFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep]       = useState<'intro' | 'loading' | 'exam' | 'result'>('intro');
  const [data, setData]       = useState<ColData | null>(null);
  const [result, setResult]   = useState<ColResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [nombre, setNombre]   = useState('');
  const [plaza, setPlaza]     = useState('');

  const PLAZAS = ['Monterrey', 'Saltillo', 'Reynosa', 'Querétaro', 'Guadalajara', 'CDMX', 'Otra'];

  const loadExam = async () => {
    setStep('loading'); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/academia/examen/colocacion/preguntas`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: ColData = await r.json();
      setData(d); setStep('exam');
    } catch (e: any) { setError(e.message); setStep('intro'); }
  };

  const submit = async (resp: Record<string, number>) => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/academia/examen/colocacion/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respuestas: resp, tecnico_name: nombre, plaza }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResult(await r.json()); setStep('result');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  // Intro
  if (step === 'intro') return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: DIM, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 20 }}>← Volver</button>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎯</div>
        <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'Oswald, sans-serif', letterSpacing: -1, marginBottom: 8 }}>
          Examen de Colocación
        </div>
        <p style={{ color: DIM, fontSize: 14, lineHeight: 1.8, maxWidth: 440, margin: '0 auto' }}>
          Evalúa tus conocimientos en las <strong style={{ color: '#fff' }}>13 competencias técnicas</strong> de la Matriz de Habilidades.<br />
          <span style={{ fontSize: 12 }}>~26 preguntas · Generadas por IA · Nivel de campo real</span>
        </p>
      </div>

      {/* Competency chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 28 }}>
        {['Habilitación','Radiobase','Enlace','Wireless','Redes','Routing','Energía','Electricidad','Operaciones','Seguridad','Procesos','Clientes','Soft Skills'].map(c => (
          <span key={c} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, background: 'rgba(0,200,150,0.08)', border: '0.5px solid rgba(0,200,150,0.2)', color: GREEN }}>{c}</span>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        <div>
          <label style={{ fontSize: 11, color: DIM, display: 'block', marginBottom: 5 }}>Nombre completo</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Juan Pérez García"
            style={{ width: '100%', background: '#151515', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: DIM, display: 'block', marginBottom: 5 }}>Plaza</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PLAZAS.map(p => (
              <button key={p} onClick={() => setPlaza(p)}
                style={{ padding: '6px 14px', borderRadius: 20, border: `1px solid ${plaza === p ? GREEN : 'rgba(255,255,255,0.1)'}`, background: plaza === p ? 'rgba(0,200,150,0.12)' : 'transparent', color: plaza === p ? GREEN : DIM, fontSize: 12, cursor: 'pointer' }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div style={{ padding: '10px 14px', background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 10, color: '#FF4757', fontSize: 12, marginBottom: 16 }}>{error}</div>}

      <button onClick={loadExam}
        style={{ width: '100%', padding: '14px', borderRadius: 12, background: nombre ? GREEN : 'rgba(255,255,255,0.05)', border: 'none', color: nombre ? '#000' : '#333', fontSize: 15, fontWeight: 700, cursor: nombre ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>
        {nombre ? 'Comenzar examen →' : 'Ingresa tu nombre para continuar'}
      </button>
    </div>
  );

  // Loading
  if (step === 'loading') return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <div style={{ width: 40, height: 40, border: `3px solid ${GREEN}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 20px' }} />
      <div style={{ fontSize: 14, color: DIM }}>Generando banco de preguntas con IA...</div>
      <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>Esto puede tomar ~30 segundos la primera vez</div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  // Exam
  if (step === 'exam' && data) return (
    <QuestionFlow
      title="Examen de Colocación"
      subtitle={`${nombre}${plaza ? ` · ${plaza}` : ''}`}
      preguntas={data.preguntas}
      onSubmit={submit}
      onBack={() => setStep('intro')}
      loading={loading}
      error={error}
      renderQuestion={(q: ColPregunta, selected, onSelect) => (
        <>
          <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.55, marginBottom: 22 }}>{q.pregunta}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {q.opciones.map((op, i) => {
              const sel = selected === i;
              return (
                <button key={i} onClick={() => onSelect(i)}
                  style={{ textAlign: 'left', padding: '13px 18px', borderRadius: 10, border: `1.5px solid ${sel ? GREEN : 'rgba(255,255,255,0.08)'}`, background: sel ? 'rgba(0,200,150,0.1)' : 'rgba(255,255,255,0.02)', color: sel ? '#fff' : '#ccc', fontSize: 13, cursor: 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${sel ? GREEN : 'rgba(255,255,255,0.2)'}`, background: sel ? GREEN : 'transparent', flexShrink: 0, transition: 'all 0.15s' }} />
                  {op}
                </button>
              );
            })}
          </div>
        </>
      )}
    />
  );

  // Result
  if (step === 'result' && result) {
    const NIVEL_COLOR: Record<string, string> = { AVANZADO: '#00C896', INTERMEDIO: '#FFB703', BÁSICO: '#FF4757' };
    const NIVEL_ICON:  Record<string, string> = { AVANZADO: '🏆', INTERMEDIO: '🔧', BÁSICO: '🌱' };
    const nc = NIVEL_COLOR[result.nivel] || GREEN;
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Top */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{NIVEL_ICON[result.nivel] || '🎓'}</div>
          <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'Oswald, sans-serif', letterSpacing: -1, marginBottom: 4 }}>
            {result.tecnico_name || 'Resultado'}
          </div>
          {result.plaza && <div style={{ fontSize: 12, color: DIM, marginBottom: 16 }}>📍 {result.plaza}</div>}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ padding: '16px 24px', borderRadius: 12, background: `${nc}14`, border: `1px solid ${nc}40`, textAlign: 'center', minWidth: 110 }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: nc, fontFamily: 'Oswald, sans-serif' }}>{result.nivel}</div>
              <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>Nivel asignado</div>
            </div>
            <div style={{ padding: '16px 24px', borderRadius: 12, background: '#151515', border: '0.5px solid rgba(255,255,255,0.06)', textAlign: 'center', minWidth: 110 }}>
              <div style={{ fontSize: 32, fontWeight: 800, fontFamily: 'Oswald, sans-serif' }}>{result.total_aprobadas}/{result.total_competencias}</div>
              <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>Competencias cubiertas</div>
            </div>
            <div style={{ padding: '16px 24px', borderRadius: 12, background: '#151515', border: '0.5px solid rgba(255,255,255,0.06)', textAlign: 'center', minWidth: 110 }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#FFB703', fontFamily: 'Oswald, sans-serif' }}>+{result.xp_awarded}</div>
              <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>XP ganado</div>
            </div>
          </div>
        </div>

        {/* Competency grid */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Perfil de competencias</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {result.competencias.map(c => (
              <div key={c.key} style={{ padding: '10px 14px', borderRadius: 10, background: c.aprobada ? 'rgba(0,200,150,0.07)' : 'rgba(255,71,87,0.07)', border: `1px solid ${c.aprobada ? 'rgba(0,200,150,0.25)' : 'rgba(255,71,87,0.25)'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{c.aprobada ? '✓' : '✗'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: c.aprobada ? '#fff' : '#FF4757', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</div>
                  <div style={{ fontSize: 10, color: DIM }}>{c.correctas}/{c.total} correctas</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Training plan */}
        {result.plan_capacitacion.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
              Plan de capacitación recomendado ({result.plan_capacitacion.length} módulos)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {result.plan_capacitacion.map(m => (
                <div key={m.num} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', background: '#151515', border: '0.5px solid rgba(255,183,3,0.2)', borderRadius: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,183,3,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#FFB703', flexShrink: 0 }}>M{m.num}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{m.nombre}</div>
                    <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>{m.descripcion}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.plan_capacitacion.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', marginBottom: 24 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
            <div style={{ fontSize: 14, color: GREEN, fontWeight: 600 }}>¡Perfil completo! No se requieren módulos adicionales.</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => { setStep('intro'); setResult(null); setData(null); }}
            style={{ padding: '11px 24px', borderRadius: 40, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
            Nuevo examen
          </button>
          <button onClick={() => { setStep('exam'); setResult(null); }}
            style={{ padding: '11px 24px', borderRadius: 40, background: GREEN, border: 'none', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Reintentar
          </button>
        </div>
        <div style={{ textAlign: 'center', fontSize: 10, color: '#333', marginTop: 16 }}>{result.fecha}</div>
      </div>
    );
  }

  return null;
}

// ── Odoo Courses Flow ──────────────────────────────────────────────────────────
function OdooFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep]       = useState<'select' | 'exam' | 'result'>('select');
  const [cursos, setCursos]   = useState<OdooCursoSlim[]>([]);
  const [examen, setExamen]   = useState<OdooExamen | null>(null);
  const [result, setResult]   = useState<OdooResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [nombre, setNombre]   = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/academia/cursos`)
      .then(r => r.json())
      .then((data: OdooCursoSlim[]) => {
        const wq = data.filter(c => c.lessons.some(l => l.has_quiz));
        setCursos(wq.length > 0 ? wq : data);
      })
      .catch(() => {});
  }, []);

  const startExam = async (channelId: number) => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/academia/examen/${channelId}/preguntas`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: OdooExamen = await r.json();
      if (d.total === 0) { setError('Este curso no tiene preguntas de examen en Odoo. Agrega quizzes a las lecciones para habilitarlo.'); setLoading(false); return; }
      setExamen(d); setStep('exam');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (step === 'select') return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: DIM, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 20 }}>← Volver</button>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Exámenes de Cursos Odoo</div>
      <div style={{ fontSize: 13, color: DIM, marginBottom: 20 }}>Preguntas cargadas directamente desde Odoo eLearning.</div>
      <div style={{ marginBottom: 16 }}>
        <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre (opcional)"
          style={{ width: '100%', background: '#151515', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
      </div>
      {error && <div style={{ padding: '10px 14px', background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 10, color: '#FF4757', fontSize: 12, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cursos.map(c => {
          const qc = c.lessons.filter(l => l.has_quiz).length;
          return (
            <div key={c.id} onClick={() => !loading && startExam(c.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: '#151515', border: '0.5px solid rgba(255,255,255,0.06)', borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(0,200,150,0.3)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.06)'; }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(0,200,150,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🎓</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{c.total_slides} lecciones {qc > 0 ? `· 🧪 ${qc} con quiz` : ''}</div>
              </div>
              <span style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>{loading ? '...' : 'Iniciar →'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (step === 'exam' && examen) return (
    <QuestionFlow
      title={examen.name}
      subtitle={examen.name}
      preguntas={examen.preguntas.map(p => ({ ...p, id: p.id }))}
      onSubmit={async (resp) => {
        setLoading(true); setError('');
        try {
          const r = await fetch(`${API_BASE}/api/academia/examen/submit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_id: examen.channel_id, respuestas: resp, tecnico_name: nombre }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          setResult(await r.json()); setStep('result');
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
      }}
      onBack={() => setStep('select')}
      loading={loading}
      error={error}
      renderQuestion={(q: OdooPregunta, selected, onSelect) => (
        <>
          <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.55, marginBottom: 22 }}>{q.question}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {q.answers.map(a => {
              const sel = selected === a.id;
              return (
                <button key={a.id} onClick={() => onSelect(a.id)}
                  style={{ textAlign: 'left', padding: '13px 18px', borderRadius: 10, border: `1.5px solid ${sel ? GREEN : 'rgba(255,255,255,0.08)'}`, background: sel ? 'rgba(0,200,150,0.1)' : 'rgba(255,255,255,0.02)', color: sel ? '#fff' : '#ccc', fontSize: 13, cursor: 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${sel ? GREEN : 'rgba(255,255,255,0.2)'}`, background: sel ? GREEN : 'transparent', flexShrink: 0 }} />
                  {a.text}
                </button>
              );
            })}
          </div>
        </>
      )}
    />
  );

  if (step === 'result' && result) {
    const NC: Record<string, string> = { Aprendiz: '#888', Técnico: '#4FC3F7', Especialista: '#00C896', Senior: '#d97706' };
    const nc = NC[result.nivel] || GREEN;
    return (
      <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>{result.aprobado ? '🎉' : '📚'}</div>
        <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'Oswald, sans-serif', letterSpacing: -1, marginBottom: 8 }}>{result.aprobado ? '¡Aprobado!' : 'Sigue practicando'}</div>
        <div style={{ fontSize: 13, color: DIM, marginBottom: 28 }}>{nombre ? `${nombre} · ` : ''}{result.correctas}/{result.total} correctas</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
          <div style={{ padding: '20px 28px', borderRadius: 12, background: '#151515', border: '0.5px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: result.aprobado ? GREEN : '#FF4757', fontFamily: 'Oswald, sans-serif' }}>{result.score_pct}%</div>
            <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>Puntaje</div>
          </div>
          <div style={{ padding: '20px 28px', borderRadius: 12, background: `${nc}14`, border: `1px solid ${nc}40` }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: nc, fontFamily: 'Oswald, sans-serif' }}>{result.nivel}</div>
            <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>Nivel</div>
          </div>
          <div style={{ padding: '20px 28px', borderRadius: 12, background: '#151515', border: '0.5px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#FFB703', fontFamily: 'Oswald, sans-serif' }}>+{result.xp_awarded}</div>
            <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>XP</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => { setStep('select'); setResult(null); setExamen(null); }}
            style={{ padding: '10px 22px', borderRadius: 40, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
            Otro examen
          </button>
          {!result.aprobado && (
            <button onClick={() => { setStep('exam'); setResult(null); }}
              style={{ padding: '10px 22px', borderRadius: 40, background: GREEN, border: 'none', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ── Main ExamenView ────────────────────────────────────────────────────────────
function ExamenView({ theme }: { theme: ThemeConfig }) {
  const [mode, setMode] = useState<null | 'colocacion' | 'odoo'>(null);
  const A = theme.accent;

  if (mode === 'colocacion') return <ColocacionFlow onBack={() => setMode(null)} />;
  if (mode === 'odoo')       return <OdooFlow onBack={() => setMode(null)} />;

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: A, marginBottom: 10 }}>Evaluación</div>
        <div style={{ fontSize: 34, fontWeight: 800, fontFamily: 'Oswald, sans-serif', letterSpacing: -1, marginBottom: 8 }}>
          ¿Qué tipo de examen<br /><span style={{ color: DIM, fontWeight: 400 }}>quieres realizar?</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Colocación */}
        <div onClick={() => setMode('colocacion')}
          style={{ padding: 24, borderRadius: 16, background: theme.card, border: `1px solid ${A}20`, cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${A}60`; (e.currentTarget as HTMLDivElement).style.background = `${A}06`; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = `${A}20`; (e.currentTarget as HTMLDivElement).style.background = theme.card; }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Examen de Colocación</div>
          <div style={{ fontSize: 12, color: DIM, lineHeight: 1.7 }}>
            13 competencias técnicas<br />
            ~26 preguntas generadas por IA<br />
            <span style={{ color: A, fontWeight: 600 }}>Asigna nivel de ingreso</span>
          </div>
          <div style={{ marginTop: 16, fontSize: 11, color: A, fontWeight: 600 }}>Para técnicos nuevos →</div>
        </div>

        {/* Promoción / Odoo */}
        <div onClick={() => setMode('odoo')}
          style={{ padding: 24, borderRadius: 16, background: theme.card, border: '1px solid rgba(83,74,183,0.2)', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(83,74,183,0.5)'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(83,74,183,0.05)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(83,74,183,0.2)'; (e.currentTarget as HTMLDivElement).style.background = theme.card; }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Examen de Promoción</div>
          <div style={{ fontSize: 12, color: DIM, lineHeight: 1.7 }}>
            Cursos de Odoo eLearning<br />
            Preguntas por módulo<br />
            <span style={{ color: '#7c3aed', fontWeight: 600 }}>Evalúa cursos completados</span>
          </div>
          <div style={{ marginTop: 16, fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>Para ascenso de nivel →</div>
        </div>
      </div>
    </div>
  );
}

// ── Promoción interna ─────────────────────────────────────────────────────────
const PROMOCIONES = [
  {
    desde: 'Auxiliar',
    hacia: 'Técnico de Operaciones',
    icono: '🔧',
    color: '#00C896',
    descripcion: 'Examen teórico para ascender de Auxiliar a Técnico. Evalúa RF, networking MikroTik, estándares de instalación, seguridad y atención al cliente.',
    preguntas: '15 preguntas de opción múltiple',
    aprobatorio: '80% mínimo (12/15)',
    tiempo: '90 minutos',
    odooUrl: 'https://odoo.wispi.mx/slides/certificacion-tecnico-de-operaciones-91',
    cursoId: 91,
  },
  {
    desde: 'Técnico de Operaciones',
    hacia: 'Líder de Campo',
    icono: '🏆',
    color: '#FFB703',
    descripcion: 'Examen avanzado para ascender de Técnico a Líder de Campo. Evalúa RF avanzado (Mimosa/Ubiquiti), troubleshooting, diagnóstico de infraestructura y caso práctico.',
    preguntas: '13 MC + 2 preguntas abiertas',
    aprobatorio: '85% mínimo (en preguntas de opción múltiple)',
    tiempo: 'Sin límite',
    odooUrl: 'https://odoo.wispi.mx/slides/certificacion-lider-de-campo-avanzado-92',
    cursoId: 92,
  },
];

// ── Tipos para trazabilidad ───────────────────────────────────────────────────
interface Promocion {
  id: string;
  candidato: string;
  partner_odoo_id: number | null;
  user_input_odoo_id: number | null;
  access_token: string | null;
  puesto_anterior: string;
  puesto_nuevo: string;
  examen_id: number;
  curso_odoo_id: number;
  estado: 'pendiente' | 'en_progreso' | 'aprobado' | 'reprobado';
  score: number | null;
  fecha_inicio: string | null;
  fecha_completado: string | null;
  registrado_por: string;
  notas: string;
  certificado_generado: boolean;
  link_examen?: string;
}

const ESTADO_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pendiente:    { label: 'Pendiente',    color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  en_progreso:  { label: 'En progreso',  color: '#FFB703', bg: 'rgba(255,183,3,0.12)' },
  aprobado:     { label: 'Aprobado',     color: '#00C896', bg: 'rgba(0,200,150,0.12)' },
  reprobado:    { label: 'Reprobado',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

function NuevaPromocionModal({ theme, onClose, onCreated }: { theme: ThemeConfig; onClose: () => void; onCreated: (p: Promocion, link: string) => void }) {
  const [form, setForm] = useState({ candidato: '', puesto_anterior: 'Auxiliar', puesto_nuevo: 'Técnico de Operaciones', notas: '', registrado_por: 'RH' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const TRACKS = [
    { desde: 'Auxiliar', hacia: 'Técnico de Operaciones' },
    { desde: 'Técnico de Operaciones', hacia: 'Líder de Campo' },
  ];

  const submit = async () => {
    if (!form.candidato.trim()) { setError('Nombre del candidato requerido'); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/academia/promociones/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidato: form.candidato.trim(), puesto_anterior: form.puesto_anterior, puesto_nuevo: form.puesto_nuevo, notas: form.notas, registrado_por: form.registrado_por }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'No se pudo iniciar el examen. Intenta de nuevo.');
      onCreated({ id: d.promocion_id, candidato: form.candidato.trim(), partner_odoo_id: d.partner_odoo_id, user_input_odoo_id: d.user_input_odoo_id, access_token: '', puesto_anterior: form.puesto_anterior, puesto_nuevo: form.puesto_nuevo, examen_id: 0, curso_odoo_id: 0, estado: 'pendiente', score: null, fecha_inicio: new Date().toISOString().slice(0, 10), fecha_completado: null, registrado_por: form.registrado_por, notas: form.notas, certificado_generado: false, link_examen: d.link }, d.link);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 32, width: 460, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 20 }}>Nueva Promoción</div>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Nombre del candidato</label>
        <input value={form.candidato} onChange={e => f('candidato', e.target.value)} placeholder="Nombre completo" style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }} />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Ruta de promoción</label>
        <select value={`${form.puesto_anterior}|${form.puesto_nuevo}`} onChange={e => { const [d, h] = e.target.value.split('|'); f('puesto_anterior', d); f('puesto_nuevo', h); }} style={{ width: '100%', background: '#1a1d24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }}>
          {TRACKS.map(t => <option key={t.desde} value={`${t.desde}|${t.hacia}`}>{t.desde} → {t.hacia}</option>)}
        </select>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Registrado por</label>
        <input value={form.registrado_por} onChange={e => f('registrado_por', e.target.value)} placeholder="Nombre de quien registra" style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }} />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Notas (opcional)</label>
        <textarea value={form.notas} onChange={e => f('notas', e.target.value)} rows={2} placeholder="Contexto adicional..." style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, marginBottom: 20, boxSizing: 'border-box', resize: 'vertical' }} />

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#666', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={submit} disabled={loading} style={{ flex: 2, padding: '11px', borderRadius: 10, border: 'none', background: theme.accent, color: '#000', fontSize: 13, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creando en Odoo...' : 'Iniciar proceso →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LinkResult({ link, onClose }: { link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#0f1117', border: '1px solid #00C89660', borderRadius: 20, padding: 32, width: 520, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 22, marginBottom: 8 }}>Proceso iniciado</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>Comparte este link personal con el candidato. Solo ellos pueden usarlo.</div>
        <div style={{ background: 'rgba(0,200,150,0.06)', border: '1px solid #00C89640', borderRadius: 12, padding: '12px 16px', fontFamily: 'monospace', fontSize: 11, color: '#00C896', wordBreak: 'break-all', marginBottom: 20 }}>{link}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid #00C89640', background: 'transparent', color: copied ? '#00C896' : '#888', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {copied ? '✓ Copiado' : 'Copiar link'}
          </button>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: '#00C896', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Listo</button>
        </div>
      </div>
    </div>
  );
}

function PromocionView({ theme }: { theme: ThemeConfig }) {
  const [tab, setTab] = useState<'examenes' | 'historial'>('historial');
  const [copied, setCopied] = useState<number | null>(null);
  const [promociones, setPromociones] = useState<Promocion[]>([]);
  const [loadingProm, setLoadingProm] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newLink, setNewLink] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [certErr, setCertErr] = useState('');
  const showCertErr = (m: string) => { setCertErr(m); setTimeout(() => setCertErr(''), 4000); };

  const copyLink = (url: string, id: number) => {
    navigator.clipboard.writeText(url).then(() => { setCopied(id); setTimeout(() => setCopied(null), 2000); });
  };

  const fetchPromociones = useCallback(async (sync = false) => {
    setLoadingProm(true);
    try {
      const r = await fetch(`${API_BASE}/api/academia/promociones${sync ? '?sync=true' : ''}`);
      const d = await r.json();
      setPromociones((d.promociones || []).slice().reverse());
    } catch (_) { /* silencioso */ } finally {
      setLoadingProm(false);
    }
  }, []);

  useEffect(() => { fetchPromociones(); }, [fetchPromociones]);

  const syncOne = async (id: string) => {
    setSyncing(id);
    try {
      await fetch(`${API_BASE}/api/academia/promociones/${id}/sync`);
      fetchPromociones();
    } finally { setSyncing(null); }
  };

  const downloadCert = async (prom: Promocion) => {
    setDownloadingId(prom.id);
    try {
      const r = await fetch(`${API_BASE}/api/academia/promociones/${prom.id}/certificado`);
      if (!r.ok) { showCertErr('Certificado no disponible (examen sin registro formal en Odoo)'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `certificado_${prom.candidato.replace(/ /g,'_')}_${prom.id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloadingId(null); }
  };

  const handleCreated = (prom: Promocion, link: string) => {
    setShowModal(false);
    setNewLink(link);
    fetchPromociones();
  };

  const aprobados = promociones.filter(p => p.estado === 'aprobado').length;
  const pendientes = promociones.filter(p => p.estado === 'pendiente' || p.estado === 'en_progreso').length;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {showModal && <NuevaPromocionModal theme={theme} onClose={() => setShowModal(false)} onCreated={handleCreated} />}
      {newLink && <LinkResult link={newLink} onClose={() => setNewLink('')} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: theme.accent, marginBottom: 6 }}>Trazabilidad XCIEN</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Promociones y Certificaciones</div>
          <div style={{ fontSize: 12, color: DIM }}>Registro completo de cada examen aplicado — Odoo + Portal sincronizados.</div>
        </div>
        <button onClick={() => setShowModal(true)} style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: theme.accent, color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
          + Nueva promoción
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total registros', value: promociones.length, color: '#94a3b8' },
          { label: 'Aprobados', value: aprobados, color: '#00C896' },
          { label: 'Pendientes', value: pendientes, color: '#FFB703' },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '16px 20px' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4 }}>
        {[{ id: 'historial', label: 'Historial RH' }, { id: 'examenes', label: 'Exámenes disponibles' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as 'examenes' | 'historial')} style={{ flex: 1, padding: '8px', borderRadius: 9, border: 'none', background: tab === t.id ? 'rgba(255,255,255,0.08)' : 'transparent', color: tab === t.id ? '#fff' : '#666', fontSize: 12, fontWeight: tab === t.id ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Historial */}
      {tab === 'historial' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => fetchPromociones(true)} disabled={loadingProm} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#666', fontSize: 11, cursor: 'pointer' }}>
              {loadingProm ? 'Sincronizando con Odoo…' : 'Sincronizar con Odoo'}
            </button>
          </div>
          {loadingProm ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#555' }}>Cargando historial...</div>
          ) : promociones.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#555' }}>Sin registros aún. Inicia la primera promoción.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {promociones.map(p => {
                const ec = ESTADO_CONFIG[p.estado] || ESTADO_CONFIG.pendiente;
                const hasOdoo = !!p.user_input_odoo_id;
                return (
                  <div key={p.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      {/* Nombre y ruta */}
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{p.candidato}</div>
                        <div style={{ fontSize: 11, color: '#555' }}>{p.puesto_anterior} → <span style={{ color: '#fff' }}>{p.puesto_nuevo}</span></div>
                      </div>
                      {/* Estado */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, color: ec.color, background: ec.bg }}>{ec.label}</span>
                        {p.score !== null && <span style={{ fontSize: 13, fontWeight: 700, color: p.score >= 80 ? '#00C896' : '#ef4444' }}>{p.score}%</span>}
                      </div>
                      {/* Fecha */}
                      <div style={{ textAlign: 'right', fontSize: 11, color: '#555', minWidth: 80 }}>
                        <div>{p.fecha_completado || p.fecha_inicio || '—'}</div>
                        <div style={{ marginTop: 2 }}>{p.registrado_por}</div>
                      </div>
                      {/* Acciones */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        {hasOdoo && (
                          <button onClick={() => syncOne(p.id)} disabled={syncing === p.id} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#666', fontSize: 11, cursor: 'pointer' }}>
                            {syncing === p.id ? '...' : '↺'}
                          </button>
                        )}
                        {p.link_examen && (
                          <button onClick={() => navigator.clipboard.writeText(p.link_examen!)} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#666', fontSize: 11, cursor: 'pointer' }}>
                            🔗
                          </button>
                        )}
                        {p.estado === 'aprobado' && hasOdoo && (
                          <>
                            <button onClick={() => downloadCert(p)} disabled={downloadingId === p.id} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #00C89640', background: 'rgba(0,200,150,0.06)', color: '#00C896', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                              {downloadingId === p.id ? '...' : 'Cert.'}
                            </button>
                            {certErr && <span style={{ fontSize: 10, color: '#FF4757' }}>{certErr}</span>}
                          </>
                        )}
                      </div>
                    </div>
                    {p.notas && <div style={{ marginTop: 8, fontSize: 11, color: '#555', fontStyle: 'italic' }}>{p.notas}</div>}
                    {!hasOdoo && <div style={{ marginTop: 6, display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,183,3,0.1)', color: '#FFB703' }}>Registro retroactivo — sin examen formal en Odoo</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Exámenes disponibles */}
      {tab === 'examenes' && (
        <div>
          {/* Escalera visual */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28, padding: '16px 20px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16 }}>
            {['Auxiliar', 'Técnico de Operaciones', 'Líder de Campo'].map((nivel, i) => (
              <div key={nivel} style={{ display: 'flex', alignItems: 'center', flex: i === 1 ? 1 : 'none' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: i === 0 ? 20 : i === 1 ? 24 : 28, marginBottom: 4 }}>{i === 0 ? '👤' : i === 1 ? '🔧' : '🏆'}</div>
                  <div style={{ fontSize: i === 1 ? 12 : 11, fontWeight: i === 1 ? 700 : 600, color: i === 0 ? DIM : i === 1 ? '#00C896' : '#FFB703', whiteSpace: 'nowrap' }}>{nivel}</div>
                </div>
                {i < 2 && <div style={{ flex: 1, height: 2, background: `linear-gradient(90deg, ${i === 0 ? '#00C896' : '#FFB703'}40, ${i === 0 ? '#00C896' : '#FFB703'})`, margin: '0 16px', minWidth: 40 }} />}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {PROMOCIONES.map(p => (
              <div key={p.cursoId} style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${p.color}30`, borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', background: `${p.color}10`, borderBottom: `1px solid ${p.color}20`, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{p.icono}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: p.color, marginBottom: 2 }}>{p.desde} →</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{p.hacia}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => copyLink(p.odooUrl, p.cursoId)} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${p.color}40`, background: 'transparent', color: copied === p.cursoId ? p.color : DIM, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {copied === p.cursoId ? '✓ Copiado' : '🔗 Copiar link'}
                    </button>
                    <a href={p.odooUrl} target="_blank" rel="noreferrer" style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: p.color, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                      Abrir en Odoo ↗
                    </a>
                  </div>
                </div>
                <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <div><div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444', marginBottom: 4 }}>Preguntas</div><div style={{ fontSize: 13, fontWeight: 600 }}>{p.preguntas}</div></div>
                  <div><div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444', marginBottom: 4 }}>Aprobatorio</div><div style={{ fontSize: 13, fontWeight: 600, color: p.color }}>{p.aprobatorio}</div></div>
                  <div><div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444', marginBottom: 4 }}>Tiempo límite</div><div style={{ fontSize: 13, fontWeight: 600 }}>{p.tiempo}</div></div>
                  <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444', marginBottom: 4 }}>Contenido evaluado</div><div style={{ fontSize: 12, color: DIM, lineHeight: 1.6 }}>{p.descripcion}</div></div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, fontSize: 12, color: DIM, lineHeight: 1.7 }}>
            <span style={{ color: '#fff', fontWeight: 600 }}>Proceso de promoción:</span> El candidato toma el examen teórico (Fase 1) → evaluación práctica en campo con auditor (Fase 2) → dictamen final por coordinación. Tiempo total: 2 semanas.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props { theme: ThemeConfig; activeThemeId?: string }
export default function AcademiaSection({ theme, activeThemeId }: Props) {
  const { user } = useAuth();
  const { track } = useAnalytics();

  const ROLES_GERENCIALES = ['admin', 'director', 'wfm', 'comercial', 'readonly', 'academico', 'rrhh'];
  const esGerencial = user ? ROLES_GERENCIALES.includes(user.rol) : true;

  const [forceView, setForceView] = useState<'gerencial' | 'tecnico' | null>(null);
  const vistaActual = forceView ?? (esGerencial ? 'gerencial' : 'tecnico');

  const [view, setView]         = useState<'cursos' | 'panorama' | 'rutas' | 'exam' | 'promocion'>('cursos');
  const [stats, setStats]       = useState<AcademiaStats | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/academia/stats`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => {})
      .finally(() => setStatsLoaded(true));
  }, []);

  const A = theme.accent;

  // ── Vistas gerencial / técnico ────────────────────────────────────────────
  if (vistaActual === 'gerencial' || vistaActual === 'tecnico') {
    return (
      <div style={{ background: '#0d1117', borderRadius: theme.radius, border: `1px solid ${theme.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
        {(esGerencial || user?.rol === 'admin' || user?.rol === 'director') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderBottom: `1px solid ${theme.border}`, background: theme.card }}>
            <span style={{ fontSize: 11, color: DIM, marginRight: 4 }}>Vista:</span>
            {(['gerencial', 'tecnico'] as const).map(v => (
              <button key={v} onClick={() => { track('click', { action: 'tab_change', section: 'academia', tab: v }); setForceView(v); }}
                style={{ padding: '5px 14px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                  background: vistaActual === v ? A : 'rgba(255,255,255,0.04)',
                  color: vistaActual === v ? '#000' : DIM,
                }}>
                {v === 'gerencial' ? '📊 Gerencial' : '👤 Mi Perfil'}
              </button>
            ))}
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {vistaActual === 'gerencial'
            ? <AcademiaGerencial theme={theme} />
            : <AcademiaTecnico theme={theme} nombreTecnico={user?.nombre ?? ''} onExamen={() => setView('exam')} />
          }
        </div>
        {vistaActual === 'tecnico' && view === 'exam' && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: 32, maxWidth: 760, width: '95%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
              <button onClick={() => setView('cursos')} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.06)', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>✕ Cerrar</button>
              <ExamenView theme={theme} />
            </div>
          </div>
        )}
      </div>
    );
  }

  const TABS: { id: typeof view; label: string }[] = [
    { id: 'cursos',    label: '🎓 Cursos'     },
    { id: 'panorama',  label: '📊 Panorama'  },
    { id: 'rutas',     label: '🗺️ Rutas'     },
    { id: 'promocion', label: '⬆️ Promoción' },
    { id: 'exam',      label: '📝 Examen'    },
  ];

  return (
    <div style={{ background: '#0d1117', borderRadius: theme.radius, border: `1px solid ${theme.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '11px 20px', borderBottom: `1px solid ${theme.border}`, background: theme.card, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: A, boxShadow: `0 0 8px ${A}` }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: A }}>{brand.academiaLabel.toUpperCase()}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', border: `1px solid ${theme.border}`, borderRadius: 30, padding: '3px 4px' }}>
          {TABS.map(t => {
            const active = view === t.id;
            return (
              <button key={t.id} onClick={() => { track('click', { action: 'tab_change', section: 'academia', tab: t.id }); setView(t.id); }} style={{
                padding: '5px 16px', borderRadius: 26, fontSize: 12, fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.18s',
                background: active ? A : 'transparent',
                color: active ? '#000' : DIM,
                boxShadow: active ? `0 2px 8px ${A}30` : 'none',
              }}>{t.label}</button>
            );
          })}
        </div>
        {stats && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11, color: DIM }}>
            <span style={{ color: A }}>● en vivo</span>
            <span>{stats.total_tecnicos} técnicos</span>
            <span>{Math.round(stats.avance_global)}% avance</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24, position: 'relative' }}>
        {activeThemeId === 'matrix' && <MatrixBackground />}
        <div style={{ position: 'relative', zIndex: 1 }}>
          {view === 'cursos'    && <CursosView theme={theme} />}
          {view === 'panorama'  && <PanoramaView theme={theme} stats={stats} statsLoaded={statsLoaded} />}
          {view === 'rutas'     && <RutasView theme={theme} />}
          {view === 'promocion' && <PromocionView theme={theme} />}
          {view === 'exam'      && <ExamenView theme={theme} />}
        </div>
      </div>
    </div>
  );
}
