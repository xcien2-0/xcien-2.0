import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ThemeConfig } from '../types';
import brand from '../../../brand';
import { NOCCity, NOCAlert, NOCHost } from '@/types/noc';
import { CASA_TENANTS } from '@/types/tenant';
import { Activity, Terminal, Network, AlertTriangle, CheckCircle, Server, Wifi, WifiOff, Map, LayoutGrid, Route, X, ChevronDown, ChevronRight, Loader, Layers, Zap, Database, Radio, Eye, Signal, Triangle } from 'lucide-react';
import { API_BASE } from '../../../config';
import RealMap, { RadiobaseHarmonized } from '@/components/noc/RealMap';
import 'leaflet/dist/leaflet.css';
import { useTabTrack } from '../../../hooks/useTabTrack';
import { useVisibleInterval } from '../../../hooks/useVisibleInterval';

// ── Palette ───────────────────────────────────────────────────────────────────
const G   = '#00ff88';   // verde    — healthy  ≥ 85
const Y   = '#ffcc00';   // amarillo — degraded 65–84
const O   = '#ff8800';   // naranja  — alerta   45–64
const R   = '#ff3366';   // rojo     — crítico   < 45
const DIM = 'rgba(255,255,255,0.35)';

// ── Health ring ───────────────────────────────────────────────────────────────
function HealthRing({ value, color, size = 76 }: { value: number; color: string; size?: number }) {
  const r    = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, value / 100)) * circ;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ filter: `drop-shadow(0 0 8px ${color}80)`, transition: 'stroke-dasharray 0.6s ease' }}
      />
      <text x={size/2} y={size/2 + 1} textAnchor="middle" dominantBaseline="middle"
        fill={color} style={{ fontSize: 16, fontWeight: 900, fontFamily: 'Oswald', letterSpacing: -0.5 }}>
        {value}%
      </text>
    </svg>
  );
}

// ── Status Banner ─────────────────────────────────────────────────────────────
function NocStatusBanner({ health, citiesCount, critCount, warnCount, online, offline }: {
  health: number; citiesCount: number; critCount: number; warnCount: number; online: number; offline: number;
}) {
  const hc = health >= 95 ? G : health >= 85 ? Y : R;
  const statusLabel = health >= 95 ? 'OPERANDO CON NORMALIDAD' : health >= 85 ? 'DEGRADACIÓN LEVE' : 'ATENCIÓN REQUERIDA';
  const [clock, setClock] = useState('');
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      flexShrink: 0, padding: '14px 22px',
      background: `linear-gradient(135deg, ${hc}0a 0%, rgba(0,8,4,0.4) 60%)`,
      border: `1px solid ${hc}22`,
      borderRadius: 16, display: 'flex', alignItems: 'center', gap: 20,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Accent bar izquierdo */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: `linear-gradient(180deg, ${hc}, ${hc}40)`, borderRadius: '16px 0 0 16px' }} />

      {/* Ring */}
      <HealthRing value={health} color={hc} />

      {/* Status + clock */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 900, color: hc, fontFamily: 'monospace', letterSpacing: 2 }}>
          {statusLabel}
        </div>
        <div style={{ fontSize: 10, color: DIM, marginTop: 3, fontFamily: 'monospace' }}>
          {citiesCount} ciudades · {clock}
        </div>
      </div>

      {/* Separador */}
      <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)', marginLeft: 4 }} />

      {/* Mini stats */}
      <div style={{ display: 'flex', gap: 20 }}>
        {[
          { v: online,  c: G, label: 'ONLINE' },
          { v: offline, c: offline > 0 ? R : DIM, label: 'CAÍDOS' },
        ].map(({ v, c, label }) => (
          <div key={label}>
            <div style={{ fontSize: 22, fontWeight: 900, color: c, lineHeight: 1, fontFamily: 'Oswald' }}>{v}</div>
            <div style={{ fontSize: 8, color: DIM, fontFamily: 'monospace', letterSpacing: 1.2, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Alertas — solo si hay */}
      {(critCount > 0 || warnCount > 0) && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {critCount > 0 && (
            <div style={{
              background: `${R}12`, border: `1px solid ${R}35`,
              borderRadius: 10, padding: '8px 14px',
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <AlertTriangle size={13} color={R} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: R, lineHeight: 1, fontFamily: 'Oswald' }}>{critCount}</div>
                <div style={{ fontSize: 8, color: `${R}80`, fontFamily: 'monospace' }}>CRÍTICAS</div>
              </div>
            </div>
          )}
          {warnCount > 0 && (
            <div style={{
              background: `${Y}10`, border: `1px solid ${Y}30`,
              borderRadius: 10, padding: '8px 14px',
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <AlertTriangle size={13} color={Y} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: Y, lineHeight: 1, fontFamily: 'Oswald' }}>{warnCount}</div>
                <div style={{ fontSize: 8, color: `${Y}80`, fontFamily: 'monospace' }}>WARNINGS</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Corner ping */}
      <div style={{ position: 'absolute', top: 10, right: 16, display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: hc, animation: 'nocpulse 2s infinite' }} />
        <span style={{ fontSize: 8, color: `${hc}80`, fontFamily: 'monospace', letterSpacing: 1 }}>LIVE</span>
      </div>
    </div>
  );
}

function nodeColor(score: number) {
  if (score >= 85) return G;
  if (score >= 65) return Y;
  if (score >= 45) return O;
  return R;
}

// ── MTR Modal ────────────────────────────────────────────────────────────────
interface MtrHop {
  hop: number; ip: string; sent: number; loss: number;
  last: number | null; avg: number | null; best: number | null; worst: number | null;
}

function MtrModal({ host, onClose }: { host: NOCHost; onClose: () => void }) {
  const [hops, setHops] = useState<MtrHop[]>([]);
  const [status, setStatus] = useState<'connecting' | 'running' | 'done' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/noc/mtr?ip=${encodeURIComponent(host.ip)}&cycles=15`);
    esRef.current = es;
    setStatus('running');

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.hops) setHops(data.hops);
        if (data.done) { setStatus('done'); es.close(); }
        if (data.error) { setError(data.error); setStatus('error'); es.close(); }
      } catch {
        setError('Error procesando respuesta MTR');
        setStatus('error');
        es.close();
      }
    };
    es.onerror = () => { setStatus('error'); setError('Conexión perdida'); es.close(); };
    return () => es.close();
  }, [host.ip]);

  const lossColor = (loss: number) => loss >= 50 ? R : loss > 0 ? Y : G;
  const latColor  = (ms: number | null) => {
    if (ms === null) return DIM;
    return ms > 100 ? R : ms > 30 ? Y : G;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: 760, maxHeight: '80vh',
        background: 'rgba(0,10,5,0.97)', border: `1px solid ${G}30`,
        borderRadius: 20, display: 'flex', flexDirection: 'column',
        boxShadow: `0 0 80px ${G}10`,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: `1px solid ${G}15`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: `${G}05`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Route size={18} color={G} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                MTR — {host.ip}
              </div>
              <div style={{ fontSize: 10, color: DIM, marginTop: 1 }}>{host.name || host.ip}</div>
            </div>
            {status === 'running' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                <Loader size={12} color={G} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 9, color: G, fontFamily: 'monospace' }}>TRAZANDO...</span>
              </div>
            )}
            {status === 'done' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                <CheckCircle size={12} color={G} />
                <span style={{ fontSize: 9, color: G, fontFamily: 'monospace' }}>COMPLETADO · {hops.length} hops</span>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: 'none', color: '#fff',
            width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><X size={14} /></button>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px 180px 55px 60px 70px 70px 70px 70px',
          padding: '8px 24px', borderBottom: `1px solid rgba(255,255,255,0.05)`,
          background: 'rgba(255,255,255,0.02)',
        }}>
          {['HOP','HOST / IP','SENT','LOSS%','LAST','AVG','BEST','WORST'].map(h => (
            <div key={h} style={{ fontSize: 8, fontWeight: 800, color: DIM, fontFamily: 'monospace', letterSpacing: 1 }}>{h}</div>
          ))}
        </div>

        {/* Hops */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {hops.length === 0 && status === 'running' && (
            <div style={{ padding: 40, textAlign: 'center', color: DIM, fontSize: 12, fontFamily: 'monospace' }}>
              Descubriendo ruta...
            </div>
          )}
          {error && (
            <div style={{ padding: 24, color: R, fontSize: 12, fontFamily: 'monospace' }}>
              Error: {error}
            </div>
          )}
          {hops.map((hop, i) => {
            const isLast = i === hops.length - 1;
            const lc = lossColor(hop.loss);
            return (
              <div key={hop.hop} style={{
                display: 'grid',
                gridTemplateColumns: '40px 180px 55px 60px 70px 70px 70px 70px',
                padding: '10px 24px',
                borderBottom: `1px solid rgba(255,255,255,0.03)`,
                background: isLast ? `${G}06` : 'transparent',
                transition: 'background 0.15s',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = isLast ? `${G}06` : 'transparent')}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: DIM, fontFamily: 'monospace' }}>{hop.hop}</div>
                <div style={{ fontSize: 11, fontWeight: isLast ? 800 : 500, color: isLast ? G : '#fff', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hop.ip === '*' ? <span style={{ color: DIM }}>* * *</span> : hop.ip}
                </div>
                <div style={{ fontSize: 11, color: DIM, fontFamily: 'monospace' }}>{hop.sent}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: lc, fontFamily: 'monospace' }}>
                  {hop.ip === '*' ? '100%' : `${hop.loss}%`}
                </div>
                {(['last','avg','best','worst'] as const).map(k => (
                  <div key={k} style={{ fontSize: 11, fontWeight: k === 'avg' ? 700 : 400, color: latColor(hop[k]), fontFamily: 'monospace' }}>
                    {hop[k] !== null ? `${hop[k]}ms` : <span style={{ color: DIM }}>—</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Footer legend */}
        <div style={{
          padding: '10px 24px', borderTop: `1px solid rgba(255,255,255,0.05)`,
          display: 'flex', gap: 20, background: 'rgba(0,0,0,0.3)',
        }}>
          {[{ c: G, label: 'OK (<30ms / sin pérdida)' }, { c: Y, label: 'Degradado (30-100ms / pérdida parcial)' }, { c: R, label: 'Crítico (>100ms / alta pérdida)' }].map(({ c, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
              <span style={{ fontSize: 9, color: DIM }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = G, icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon: React.ReactNode;
}) {
  return (
    <div style={{
      flex: 1, minWidth: 140,
      background: 'rgba(0,8,4,0.55)',
      border: `1px solid ${color}20`,
      borderRadius: 16, padding: '18px 22px',
      display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: `0 4px 24px ${color}08, inset 0 1px 0 rgba(255,255,255,0.04)`,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Acento superior */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color}cc, ${color}20)` }} />

      {/* Label + icon */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: DIM, fontWeight: 700, letterSpacing: 1.5, fontFamily: 'monospace' }}>
          {label.toUpperCase()}
        </span>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `${color}12`, border: `1px solid ${color}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
      </div>

      {/* Valor */}
      <div style={{ fontSize: 30, fontWeight: 900, color, lineHeight: 1, fontFamily: 'Oswald', letterSpacing: -0.5 }}>
        {value}
      </div>

      {sub && <div style={{ fontSize: 10, color: DIM, marginTop: -4 }}>{sub}</div>}
    </div>
  );
}

// ── Map ───────────────────────────────────────────────────────────────────────
function HoloMap({ cities, onSelectCity, selectedCityId }: {
  cities: NOCCity[];
  onSelectCity: (city: NOCCity) => void;
  selectedCityId: string | null;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const coreNode = useMemo(() =>
    cities.find(c => c.name === 'Monterrey') || cities[0], [cities]);

  const { toSVG, nodes } = useMemo(() => {
    if (cities.length === 0) return {
      toSVG: () => ({ x: 500, y: 250 }),
      nodes: [],
    };
    const lats = cities.map(c => c.lat);
    const lngs = cities.map(c => c.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const padX = 90, padY = 60;
    const W = 1000 - padX * 2, H = 480 - padY * 2;
    const lngRange = maxLng - minLng || 1;
    const latRange = maxLat - minLat || 1;
    const scale = Math.min(W / lngRange, H / latRange);
    const offX = padX + (W - lngRange * scale) / 2;
    const offY = padY + (H - latRange * scale) / 2;
    const fn = (lat: number, lng: number) => ({
      x: offX + (lng - minLng) * scale,
      y: offY + (maxLat - lat) * scale,
    });
    // Pre-compute node sizes (proportional to host count)
    const maxHosts = Math.max(...cities.map(c => c.totalHosts), 1);
    const ns = cities.map(c => ({
      ...fn(c.lat, c.lng),
      r: 5 + (c.totalHosts / maxHosts) * 10,
      city: c,
    }));
    return { toSVG: fn, nodes: ns };
  }, [cities]);

  const gridLines = useMemo(() => {
    const lines = [];
    for (let i = 0; i <= 10; i++) {
      lines.push(
        <line key={`h${i}`} x1="0" y1={i * 48} x2="1000" y2={i * 48} stroke={`${G}08`} strokeWidth="1" />,
        <line key={`v${i}`} x1={i * 100} y1="0" x2={i * 100} y2="480" stroke={`${G}08`} strokeWidth="1" />,
      );
    }
    return lines;
  }, []);

  return (
    <div style={{
      position: 'relative', width: '100%', height: 480,
      background: 'rgba(0,8,4,0.7)',
      border: `1px solid ${G}20`, borderRadius: 18, overflow: 'hidden',
      boxShadow: `inset 0 0 60px ${G}06`,
    }}>
      {/* Scanline */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
        background: `repeating-linear-gradient(0deg, transparent, transparent 3px, ${G}03 3px, ${G}03 4px)`,
      }} />

      {/* HUD corners */}
      {[
        { style: { top: 16, left: 16 }, label: brand.nocLabel, value: `${cities.length} NODOS` },
        { style: { top: 16, right: 16 }, label: 'SYNC', value: 'REAL-TIME' },
      ].map(({ style, label, value }) => (
        <div key={label} style={{
          position: 'absolute', ...style, zIndex: 3,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
          padding: '5px 12px', borderRadius: 8, borderLeft: `2px solid ${G}60`,
        }}>
          <div style={{ fontSize: 8, color: `${G}60`, fontFamily: 'monospace', letterSpacing: 1.5 }}>{label}</div>
          <div style={{ fontSize: 12, color: G, fontWeight: 800, fontFamily: 'monospace' }}>{value}</div>
        </div>
      ))}

      <svg width="100%" height="100%" viewBox="0 0 1000 480" style={{ position: 'relative', zIndex: 2 }}>
        <defs>
          <filter id="noc-glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="noc-glow-strong">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Grid */}
        {gridLines}

        {/* Connection arcs from core node */}
        {coreNode && nodes.map(({ x: x2, y: y2, city }) => {
          if (city.id === coreNode.id) return null;
          const { x: x1, y: y1 } = toSVG(coreNode.lat, coreNode.lng);
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.15;
          const c = nodeColor(city.score);
          const isHov = hoveredId === city.id;
          return (
            <g key={`arc-${city.id}`}>
              <path
                d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
                fill="none" stroke={c}
                strokeWidth={isHov ? 1.5 : 0.8}
                strokeDasharray="6,8"
                opacity={isHov ? 0.5 : 0.15}
              >
                <animate attributeName="stroke-dashoffset" from="200" to="0" dur="4s" repeatCount="indefinite" />
              </path>
              {isHov && (
                <circle r="3" fill={c} opacity="0.8">
                  <animateMotion dur="2s" repeatCount="indefinite"
                    path={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} />
                </circle>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map(({ x, y, r, city }) => {
          const isSelected = selectedCityId === city.id;
          const isHov = hoveredId === city.id;
          const c = nodeColor(city.score);
          const active = isSelected || isHov;

          // Smart label offset: push label away from edges
          const labelRight = x < 850;
          const labelBelow = y < 60;
          const lx = labelRight ? x + r + 6 : x - r - 6;
          const ly = labelBelow ? y + r + 14 : y - r - 6;
          const anchor = labelRight ? 'start' : 'end';

          return (
            <g key={`node-${city.id}`}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectCity(city)}
              onMouseEnter={() => setHoveredId(city.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Pulse ring */}
              {active && (
                <circle cx={x} cy={y} r={r + 6} fill="none" stroke={c} strokeWidth="1.5" opacity="0.4">
                  <animate attributeName="r" from={r} to={r + 18} dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.5" to="0" dur="1.5s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Offline indicator ring */}
              {city.offline > 0 && (
                <circle cx={x} cy={y} r={r + 3} fill="none" stroke={R}
                  strokeWidth="1" strokeDasharray="3,4" opacity="0.5" />
              )}

              {/* Main node */}
              <circle cx={x} cy={y} r={r}
                fill={active ? `${c}25` : `${c}10`}
                stroke={c}
                strokeWidth={active ? 2.5 : 1.5}
                filter={active ? 'url(#noc-glow-strong)' : 'url(#noc-glow)'}
              />

              {/* Core dot */}
              <circle cx={x} cy={y} r={r * 0.35} fill={c} opacity={active ? 1 : 0.7} />

              {/* Label */}
              <text x={lx} y={ly} textAnchor={anchor}
                fill={active ? '#fff' : c}
                style={{
                  fontSize: active ? 12 : 10,
                  fontWeight: active ? 800 : 600,
                  fontFamily: 'monospace',
                  opacity: active ? 1 : 0.75,
                  textShadow: `0 0 8px ${c}`,
                }}
              >
                {city.name}
              </text>

              {/* Score badge on hover */}
              {active && (
                <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
                  fill={c} style={{ fontSize: 8, fontWeight: 900, fontFamily: 'monospace' }}>
                  {Math.round(city.score)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16, zIndex: 3,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        borderRadius: 10, padding: '8px 14px',
        display: 'flex', gap: 14, border: `1px solid rgba(255,255,255,0.06)`,
      }}>
        {[
          { c: G, label: '≥95%' },
          { c: Y, label: '80–94%' },
          { c: R, label: '<80%' },
        ].map(({ c, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, boxShadow: `0 0 6px ${c}` }} />
            <span style={{ fontSize: 9, color: DIM, fontFamily: 'monospace' }}>{label}</span>
          </div>
        ))}
        <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', border: `1px dashed ${R}`, opacity: 0.6 }} />
          <span style={{ fontSize: 9, color: DIM, fontFamily: 'monospace' }}>Hosts caídos</span>
        </div>
      </div>
    </div>
  );
}

// ── Alert stream ──────────────────────────────────────────────────────────────
const BOARD_CFG: Record<string, { label: string; color: string; pri: number }> = {
  energia: { label: 'ENERGÍA', color: '#ffcc00', pri: 1 },
  datos:   { label: 'DATOS',   color: '#00ff88', pri: 2 },
  wl:      { label: 'WL',      color: '#60a5fa', pri: 3 },
};

function AlertStream({ alerts }: { alerts: NOCAlert[] }) {
  const sevConfig: Record<string, { color: string; bg: string; label: string }> = {
    critical: { color: R,         bg: `${R}15`,             label: 'CRIT' },
    warning:  { color: Y,         bg: `${Y}15`,             label: 'WARN' },
    info:     { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', label: 'INFO' },
  };

  // Ordenar: prioridad board (Energía→Datos→WL) → severidad → timestamp
  const sorted = [...alerts].sort((a, b) => {
    const pa = a.boardPriority ?? BOARD_CFG[a.board ?? '']?.pri ?? 4;
    const pb = b.boardPriority ?? BOARD_CFG[b.board ?? '']?.pri ?? 4;
    if (pa !== pb) return pa - pb;
    const sa = a.severity === 'critical' ? 0 : 1;
    const sb = b.severity === 'critical' ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'rgba(0,6,3,0.8)', border: `1px solid ${G}15`,
      borderRadius: 16, overflow: 'hidden', height: '100%',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 18px', borderBottom: `1px solid ${G}10`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: `${G}04`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={13} color={G} />
          <span style={{ fontSize: 10, fontWeight: 800, color: G, fontFamily: 'monospace', letterSpacing: 1.5 }}>
            STREAM DE ALERTAS
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: G }}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: G, animation: 'nocpulse 1.5s infinite' }} />
          </div>
          <span style={{ fontSize: 9, color: G, fontFamily: 'monospace', opacity: 0.7 }}>
            {alerts.length} activas
          </span>
        </div>
      </div>

      {/* Alerts list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
        {sorted.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, opacity: 0.4 }}>
            <CheckCircle size={28} color={G} />
            <span style={{ fontSize: 11, color: G, fontFamily: 'monospace' }}>SIN AMENAZAS ACTIVAS</span>
          </div>
        ) : (
          sorted.map((a, i) => {
            const s = sevConfig[a.severity] || sevConfig.info;
            const bc = BOARD_CFG[a.board || ''];
            const time = a.timestamp?.split('T')[1]?.slice(0, 5) || '--:--';
            const displayName = a.hostName || a.cityName;
            return (
              <div key={a.id || i} style={{
                padding: '8px 14px', borderBottom: `1px solid rgba(255,255,255,0.03)`,
                display: 'flex', gap: 8, alignItems: 'flex-start',
                transition: 'background 0.15s',
                borderLeft: bc ? `2px solid ${bc.color}50` : '2px solid transparent',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Prioridad + board */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, width: 46 }}>
                  {bc && (
                    <div style={{
                      background: `${bc.color}15`, color: bc.color,
                      fontSize: 7, fontWeight: 900, fontFamily: 'monospace',
                      padding: '1px 4px', borderRadius: 3,
                      border: `1px solid ${bc.color}30`, textAlign: 'center',
                      letterSpacing: 0.3,
                    }}>
                      {bc.label}
                    </div>
                  )}
                  <div style={{
                    background: s.bg, color: s.color,
                    fontSize: 7, fontWeight: 900, fontFamily: 'monospace',
                    padding: '1px 4px', borderRadius: 3,
                    border: `1px solid ${s.color}30`, textAlign: 'center',
                  }}>
                    {s.label}
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {displayName}
                    </span>
                    <span style={{ fontSize: 8, color: DIM, fontFamily: 'monospace', flexShrink: 0 }}>{time}</span>
                  </div>
                  {(a.message || a.type) && (
                    <div style={{ fontSize: 9, color: DIM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                      {a.message || a.type}
                    </div>
                  )}
                  {a.siteName && (
                    <div style={{ fontSize: 8, color: `${G}45`, marginTop: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.siteName}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Grid card ─────────────────────────────────────────────────────────────────
function CityCard({ city, onClick }: { city: NOCCity; onClick: () => void }) {
  const c = nodeColor(city.score);
  const upPct = city.totalHosts > 0 ? Math.round((city.online / city.totalHosts) * 100) : 0;
  return (
    <div onClick={onClick} style={{
      background: 'rgba(0,12,7,0.7)', border: `1px solid ${c}25`,
      borderRadius: 14, padding: '16px 18px', cursor: 'pointer',
      transition: 'all 0.2s', position: 'relative', overflow: 'hidden',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = `${c}08`; (e.currentTarget as HTMLDivElement).style.borderColor = `${c}50`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,12,7,0.7)'; (e.currentTarget as HTMLDivElement).style.borderColor = `${c}25`; }}
    >
      {/* Color strip */}
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: c, borderRadius: '14px 0 0 14px' }} />

      <div style={{ paddingLeft: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{city.name}</div>
            <div style={{ fontSize: 9, color: DIM, fontFamily: 'monospace', marginTop: 2, whiteSpace: 'nowrap' }}>
              {city.sites?.length || 0} sitios · {city.totalHosts} hosts
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, width: 52 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: c, lineHeight: 1, fontFamily: 'Oswald' }}>
              {Math.round(city.score)}
            </div>
            <div style={{ fontSize: 8, color: DIM, fontFamily: 'monospace' }}>SCORE</div>
          </div>
        </div>

        {/* Hosts row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Wifi size={11} color={G} />
            <span style={{ fontSize: 11, fontWeight: 700, color: G }}>{city.online}</span>
            <span style={{ fontSize: 9, color: DIM }}>online</span>
          </div>
          {city.offline > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <WifiOff size={11} color={R} />
              <span style={{ fontSize: 11, fontWeight: 700, color: R }}>{city.offline}</span>
              <span style={{ fontSize: 9, color: DIM }}>caídos</span>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${upPct}%`,
            background: c, borderRadius: 4,
            boxShadow: `0 0 8px ${c}60`,
            transition: 'width 0.6s ease',
          }} />
        </div>
        <div style={{ fontSize: 8, color: DIM, marginTop: 4, fontFamily: 'monospace', textAlign: 'right' }}>
          {upPct}% uptime
        </div>
      </div>
    </div>
  );
}

// ── Site Inspector ────────────────────────────────────────────────────────────
function SiteInspector({ city, onClose }: { city: NOCCity; onClose: () => void }) {
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const [mtrHost, setMtrHost] = useState<NOCHost | null>(null);
  const c = nodeColor(city.score);
  const upPct = city.totalHosts > 0 ? Math.round((city.online / city.totalHosts) * 100) : 0;

  const toggleSite = (id: string) =>
    setExpandedSites(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  return (
    <div style={{
      width: 320, flexShrink: 0,
      background: 'rgba(0,12,7,0.92)', backdropFilter: 'blur(20px)',
      borderLeft: `1px solid ${c}25`, display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${c}15` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: 'Oswald', letterSpacing: 1 }}>
              {city.name.toUpperCase()}
            </h3>
            <span style={{ fontSize: 9, color: `${c}70`, fontFamily: 'monospace' }}>{city.id}</span>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: 'none',
            color: '#fff', cursor: 'pointer', width: 28, height: 28,
            borderRadius: 8, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Score + bar */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 9, color: DIM, fontFamily: 'monospace' }}>HEALTH SCORE</span>
            <span style={{ fontSize: 28, fontWeight: 900, color: c, fontFamily: 'Oswald', lineHeight: 1 }}>
              {Math.round(city.score)}
            </span>
          </div>
          <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${city.score}%`, background: c, boxShadow: `0 0 8px ${c}`, borderRadius: 4 }} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            { label: 'TOTAL', value: city.totalHosts, color: '#fff' },
            { label: 'ONLINE', value: city.online, color: G },
            { label: 'CAÍDOS', value: city.offline, color: city.offline > 0 ? R : DIM },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: 'rgba(255,255,255,0.03)', padding: '10px 8px', borderRadius: 10, textAlign: 'center',
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, color, fontFamily: 'Oswald' }}>{value}</div>
              <div style={{ fontSize: 8, color: DIM, fontFamily: 'monospace', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Uptime bar */}
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 9, color: DIM, fontFamily: 'monospace' }}>UPTIME</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: c, fontFamily: 'monospace' }}>{upPct}%</span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${upPct}%`, background: c, boxShadow: `0 0 8px ${c}60`, borderRadius: 4 }} />
          </div>
        </div>

        {/* Sites + Hosts */}
        <div>
          <div style={{ fontSize: 9, color: `${c}60`, fontFamily: 'monospace', fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>
            SITIOS ({city.sites?.length || 0})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {city.sites?.map(site => {
              const sc2 = site.hostsOffline > 0 ? (site.hostsOffline > site.hostsOnline ? R : Y) : G;
              const isExpanded = expandedSites.has(site.id);
              return (
                <div key={site.id}>
                  {/* Site header — clickable to expand */}
                  <div
                    onClick={() => toggleSite(site.id)}
                    style={{
                      background: 'rgba(255,255,255,0.03)', padding: '9px 12px', borderRadius: isExpanded ? '8px 8px 0 0' : 8,
                      border: `1px solid ${sc2}20`, cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isExpanded ? <ChevronDown size={11} color={DIM} /> : <ChevronRight size={11} color={DIM} />}
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{site.name}</div>
                        <div style={{ fontSize: 9, color: DIM, marginTop: 1 }}>{site.hostsOnline + site.hostsOffline} hosts</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: G }}>{site.hostsOnline}↑</span>
                      {site.hostsOffline > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: R }}>{site.hostsOffline}↓</span>}
                    </div>
                  </div>

                  {/* Host list */}
                  {isExpanded && (
                    <div style={{
                      background: 'rgba(0,0,0,0.3)', border: `1px solid ${sc2}15`,
                      borderTop: 'none', borderRadius: '0 0 8px 8px',
                      overflow: 'hidden',
                    }}>
                      {site.hosts?.map((host, hi) => {
                        const hc2 = host.status === 'offline' ? R : host.status === 'degraded' ? Y : G;
                        const displayName = host.name && host.name !== '→' ? host.name : host.ip;
                        return (
                          <div key={host.id || hi} style={{
                            padding: '7px 12px',
                            borderBottom: hi < (site.hosts?.length || 0) - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: hc2, flexShrink: 0, boxShadow: `0 0 4px ${hc2}` }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 10, color: '#fff', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {displayName}
                              </div>
                              <div style={{ fontSize: 9, color: DIM }}>{host.ip}</div>
                            </div>
                            <button
                              onClick={() => setMtrHost(host)}
                              style={{
                                flexShrink: 0, padding: '3px 8px',
                                background: `${G}12`, color: G,
                                border: `1px solid ${G}30`, borderRadius: 6,
                                fontSize: 9, fontWeight: 800, cursor: 'pointer',
                                fontFamily: 'monospace', letterSpacing: 0.5,
                                display: 'flex', alignItems: 'center', gap: 4,
                              }}
                            >
                              <Route size={9} />MTR
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* MTR modal */}
        {mtrHost && <MtrModal host={mtrHost} onClose={() => setMtrHost(null)} />}
      </div>

      {/* Actions */}
      <div style={{ padding: '14px 20px', borderTop: `1px solid ${c}15`, display: 'flex', gap: 8 }}>
        <button style={{
          flex: 1, padding: '10px', background: `${c}12`, color: c,
          border: `1px solid ${c}35`, borderRadius: 10, fontSize: 11,
          fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace', letterSpacing: 0.5,
        }}>
          PING TEST
        </button>
        <button style={{
          flex: 1, padding: '10px', background: 'rgba(255,255,255,0.04)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 11,
          fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
        }}>
          BIDRILLA
        </button>
      </div>
    </div>
  );
}

// ── NOCBoard Layers Panel ─────────────────────────────────────────────────────
const NOC_LAYERS = [
  { id: 'wl',      label: 'WL/WISPI',  icon: Signal,   color: '#60a5fa', desc: 'Wireless · APs · Antenas' },
  { id: 'datos',   label: 'Datos',     icon: Triangle, color: '#00ff88', desc: 'Switches · Routers · Fibra' },
  { id: 'energia', label: 'Energía',   icon: Zap,      color: '#ffcc00', desc: 'UPS · PDU · Planta eléctrica' },
  { id: 'cxdatos', label: 'CX Datos',  icon: Eye,      color: '#a78bfa', desc: 'Clientes · Datos' },
  { id: 'cx',      label: 'CX Radios', icon: Radio,    color: '#fb923c', desc: 'Clientes · Radios' },
  { id: 'central', label: 'Central',   icon: Network,  color: '#f472b6', desc: 'NOC Central' },
] as const;

type LayerId = typeof NOC_LAYERS[number]['id'];

interface BoardStatus {
  enabled: boolean;
  alive: boolean;
  name: string;
  port: number;
  has_key: boolean;
  total_hosts?: number;
  online?: number;
  offline?: number;
  active_alerts?: number;
}

function NocLayersPanel({ cities, onSelectCity, onRefresh }: {
  cities: NOCCity[];
  onSelectCity: (c: NOCCity) => void;
  onRefresh?: () => void;
}) {
  const [boards, setBoards] = useState<Record<string, BoardStatus>>({});
  const [selectedLayer, setSelectedLayer] = useState<LayerId | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [layerCities, setLayerCities] = useState<NOCCity[] | null>(null);
  const [layerLoading, setLayerLoading] = useState(false);

  // Al seleccionar una capa, graficar solo los hosts de ese NOCBoard en el mapa
  useEffect(() => {
    if (!selectedLayer) { setLayerCities(null); return; }
    let cancelled = false;
    setLayerLoading(true);
    fetch(`${API_BASE}/api/noc/boards/${selectedLayer}/cities`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { if (!cancelled) setLayerCities(data); })
      .catch(() => { if (!cancelled) setLayerCities([]); })
      .finally(() => { if (!cancelled) setLayerLoading(false); });
    return () => { cancelled = true; };
  }, [selectedLayer]);

  const fetchBoards = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/noc/boards`);
      const data = await r.json();
      if (r.ok && data.boards && !data.error) {
        setBoards(data.boards);
        setProxyError(null);
      } else {
        setProxyError(data.detail || data.error || 'Proxy no disponible');
      }
    } catch {
      setProxyError('Proxy no disponible');
    }
  }, []);

  useEffect(() => { fetchBoards(); }, [fetchBoards]);
  useVisibleInterval(fetchBoards, 15_000);

  const toggleLayer = async (id: LayerId) => {
    const current = boards[id];
    const newEnabled = current ? !current.enabled : false;
    const action = newEnabled ? 'enable' : 'disable';

    setToggling(id);
    // Optimistic update
    setBoards(prev => ({ ...prev, [id]: { ...prev[id], enabled: newEnabled } }));

    try {
      const r = await fetch(`${API_BASE}/api/noc/boards/${id}/${action}`, { method: 'POST' });
      const data = await r.json();
      if (r.ok && !data.error) {
        await fetchBoards();
        setTimeout(() => onRefresh?.(), 1500);
      } else {
        // Rollback — proxy respondió con error o HTTP no-ok
        setBoards(prev => ({ ...prev, [id]: { ...prev[id], enabled: !newEnabled } }));
        setProxyError(data.detail || data.error || 'No se pudo cambiar el estado. Intenta de nuevo.');
      }
    } catch {
      setBoards(prev => ({ ...prev, [id]: { ...prev[id], enabled: !newEnabled } }));
      setProxyError('Proxy no disponible');
    } finally {
      setToggling(null);
    }
  };

  const enabledCount = NOC_LAYERS.filter(l => boards[l.id]?.enabled).length;
  const totalOn  = Object.values(boards).reduce((a, b) => a + (b.online  ?? 0), 0);
  const totalOff = Object.values(boards).reduce((a, b) => a + (b.offline ?? 0), 0);

  return (
    <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0, overflow: 'hidden' }}>
      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {selectedLayer && (() => {
          const l = NOC_LAYERS.find(x => x.id === selectedLayer)!;
          const Icon = l.icon;
          const b = boards[selectedLayer];
          return (
            <div style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
              background: `${l.color}12`, border: `1px solid ${l.color}30`,
              borderRadius: 10, padding: '8px 14px',
            }}>
              <Icon size={14} color={l.color} />
              <span style={{ fontSize: 11, fontWeight: 800, color: l.color, fontFamily: 'monospace' }}>
                CAPA: {l.label.toUpperCase()}
              </span>
              <span style={{ fontSize: 10, color: DIM, marginLeft: 4 }}>{l.desc}</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'monospace', color: layerLoading ? DIM : (b?.alive ? G : R) }}>
                {layerLoading
                  ? '● cargando…'
                  : (layerCities ? `● ${layerCities.length} ciudades graficadas` : (b?.alive ? `● ${b.total_hosts ?? '—'} hosts` : '● offline'))}
              </span>
            </div>
          );
        })()}

        <div style={{ flex: 1, borderRadius: 18, overflow: 'hidden', border: `1px solid ${G}20`, minHeight: 0 }}>
          <RealMap cities={layerCities ?? cities} onSelectCity={onSelectCity} selectedCityId={null} />
        </div>
      </div>

      {/* ── Layer list ───────────────────────────────────────────────────── */}
      <div style={{
        width: 290, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'rgba(0,8,4,0.8)', border: `1px solid ${G}15`,
        borderRadius: 16, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${G}10` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <Layers size={13} color={G} />
            <span style={{ fontSize: 10, fontWeight: 800, color: G, fontFamily: 'monospace', letterSpacing: 1.5 }}>CAPAS NOCBOARD</span>
          </div>
          <div style={{ fontSize: 9, color: DIM, fontFamily: 'monospace' }}>
            {enabledCount}/{NOC_LAYERS.length} capas activas
          </div>
          {proxyError && (
            <div style={{
              marginTop: 6, padding: '4px 8px', borderRadius: 6,
              background: `${R}18`, border: `1px solid ${R}40`,
              fontSize: 9, color: R, fontFamily: 'monospace',
            }}>
              ⚠ {proxyError}
            </div>
          )}
        </div>

        {/* Layer rows */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {NOC_LAYERS.map(layer => {
            const b = boards[layer.id];
            const isOn  = b?.enabled ?? false;
            const alive = b?.alive   ?? false;
            const isSel = selectedLayer === layer.id;
            const busy  = toggling === layer.id;
            const Icon  = layer.icon;
            return (
              <div
                key={layer.id}
                onClick={() => setSelectedLayer(isSel ? null : layer.id)}
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid rgba(255,255,255,0.04)`,
                  cursor: 'pointer',
                  background: isSel ? `${layer.color}10` : isOn ? 'rgba(255,255,255,0.02)' : 'transparent',
                  opacity: busy ? 0.6 : isOn ? 1 : 0.45,
                  transition: 'all 0.15s',
                  borderLeft: isSel ? `3px solid ${layer.color}` : '3px solid transparent',
                }}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = isOn ? 'rgba(255,255,255,0.02)' : 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* Toggle switch */}
                  <div
                    onClick={e => { e.stopPropagation(); if (!busy) toggleLayer(layer.id); }}
                    style={{
                      width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      background: isOn ? layer.color : 'rgba(255,255,255,0.12)',
                      position: 'relative', transition: 'background 0.2s',
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: 3, left: isOn ? 15 : 3,
                      width: 12, height: 12, borderRadius: '50%',
                      background: busy ? '#aaa' : '#fff', transition: 'left 0.2s',
                      boxShadow: isOn && !busy ? `0 0 6px ${layer.color}` : 'none',
                    }} />
                  </div>

                  {/* Icon */}
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: `${layer.color}15`, border: `1px solid ${layer.color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={14} color={layer.color} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: isOn ? '#fff' : DIM }}>
                      {layer.label}
                    </div>
                    <div style={{ fontSize: 9, color: DIM, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b ? (
                        alive
                          ? `${b.total_hosts ?? '—'} hosts · ${b.online ?? '—'} online`
                          : 'Sin conexión'
                      ) : layer.desc}
                    </div>
                  </div>

                  {/* Alive indicator */}
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: isOn && alive ? layer.color : 'rgba(255,255,255,0.15)',
                    boxShadow: isOn && alive ? `0 0 6px ${layer.color}` : 'none',
                  }} />
                </div>

                {/* Expanded stats when selected and enabled */}
                {isSel && isOn && b && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${layer.color}20` }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ background: `${layer.color}10`, border: `1px solid ${layer.color}25`, borderRadius: 8, padding: '6px 10px', flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: layer.color, fontFamily: 'monospace' }}>{b.total_hosts ?? '—'}</div>
                        <div style={{ fontSize: 8, color: DIM, marginTop: 1 }}>TOTAL</div>
                      </div>
                      <div style={{ background: `${G}10`, border: `1px solid ${G}25`, borderRadius: 8, padding: '6px 10px', flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: G, fontFamily: 'monospace' }}>{b.online ?? '—'}</div>
                        <div style={{ fontSize: 8, color: DIM, marginTop: 1 }}>ONLINE</div>
                      </div>
                      <div style={{ background: `${R}10`, border: `1px solid ${R}25`, borderRadius: 8, padding: '6px 10px', flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: (b.offline ?? 0) > 0 ? R : DIM, fontFamily: 'monospace' }}>{b.offline ?? '—'}</div>
                        <div style={{ fontSize: 8, color: DIM, marginTop: 1 }}>CAÍDOS</div>
                      </div>
                    </div>
                    {(b.active_alerts ?? 0) > 0 && (
                      <div style={{ marginTop: 6, fontSize: 9, color: Y, fontFamily: 'monospace' }}>
                        ⚠ {b.active_alerts} alertas activas
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${G}10`, display: 'flex', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Wifi size={10} color={G} />
            <span style={{ fontSize: 9, color: G, fontFamily: 'monospace' }}>{totalOn} online</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <WifiOff size={10} color={R} />
            <span style={{ fontSize: 9, color: R, fontFamily: 'monospace' }}>{totalOff} caídos</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
interface Props {
  theme: ThemeConfig;
  activeThemeId?: string;
  cities?: NOCCity[];
  alerts?: NOCAlert[];
  activeTenantId?: string | null;
  onTenantChange?: (id: string | null) => void;
  onRefresh?: () => void;
}

// ── Reporte Semanal ───────────────────────────────────────────────────────────
function ReporteSemanal({ cities, alerts }: { cities: NOCCity[]; alerts: NOCAlert[] }) {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [ciudad, setCiudad]           = useState('todas');
  const [fechaInicio, setFechaInicio] = useState(fmt(monday));
  const [fechaFin, setFechaFin]       = useState(fmt(today));
  const [loading, setLoading]         = useState(false);
  const [pdfError, setPdfError]       = useState('');
  const [wfmStats, setWfmStats]       = useState<{total:number;backlog:number;listo:number;proceso:number}>({total:0,backlog:0,listo:0,proceso:0});

  useEffect(() => {
    fetch(`${API_BASE}/api/wfm/ordenes`).then(r => r.json()).then(d => {
      if (!Array.isArray(d)) return;
      setWfmStats({
        total:   d.length,
        backlog: d.filter((o:any) => o.estado === 'BACKLOG').length,
        listo:   d.filter((o:any) => o.estado === 'LISTO_INSTALACION').length,
        proceso: d.filter((o:any) => !['BACKLOG','LISTO_INSTALACION'].includes(o.estado)).length,
      });
    }).catch(() => {});
  }, []);

  const cityNames = ['todas', ...Array.from(new Set(cities.map(c => c.name))).sort()];

  const filteredCities = ciudad === 'todas' ? cities : cities.filter(c => c.name === ciudad);
  const filteredAlerts = ciudad === 'todas' ? alerts : alerts.filter(a => a.cityName === ciudad);

  const totalHosts   = filteredCities.reduce((s, c) => s + c.totalHosts, 0);
  const totalOnline  = filteredCities.reduce((s, c) => s + c.online, 0);
  const totalOffline = filteredCities.reduce((s, c) => s + c.offline, 0);
  const critical     = filteredAlerts.filter(a => a.severity === 'critical').length;
  const warnings     = filteredAlerts.filter(a => a.severity === 'warning').length;
  const avgScore     = filteredCities.length
    ? Math.round(filteredCities.reduce((s, c) => s + c.score, 0) / filteredCities.length)
    : 0;

  const offlineCities = filteredCities.filter(c => c.offline > 0)
    .sort((a, b) => b.offline - a.offline).slice(0, 8);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ ciudad, fecha_inicio: fechaInicio, fecha_fin: fechaFin });
      const res = await fetch(`${API_BASE}/api/reportes/semanal?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `Reporte_NOC_${ciudad}_${fechaInicio}_${fechaFin}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError('Error generando PDF — intenta de nuevo');
      setTimeout(() => setPdfError(''), 4000);
    } finally { setLoading(false); }
  };

  const kpiStyle = (color: string): React.CSSProperties => ({
    flex: 1, background: '#1A2733', border: `1px solid ${color}25`,
    borderRadius: 12, padding: '14px 16px', display: 'flex',
    flexDirection: 'column', gap: 3, borderTop: `2px solid ${color}`,
  });

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Controles */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, color: DIM }}>Ciudad</span>
          <select value={ciudad} onChange={e => setCiudad(e.target.value)} style={{
            background: '#1A2733', border: '1px solid rgba(0,255,136,0.2)', color: '#fff',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer', outline: 'none',
          }}>
            {cityNames.map(c => <option key={c} value={c}>{c === 'todas' ? '🌐 Todas las ciudades' : c}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, color: DIM }}>Desde</span>
          <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={{
            background: '#1A2733', border: '1px solid rgba(255,255,255,0.1)', color: '#fff',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, outline: 'none',
          }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, color: DIM }}>Hasta</span>
          <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} style={{
            background: '#1A2733', border: '1px solid rgba(255,255,255,0.1)', color: '#fff',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, outline: 'none',
          }} />
        </div>
        <button onClick={handleDownload} disabled={loading} style={{
          background: loading ? 'rgba(0,255,136,0.2)' : G, color: '#000',
          border: 'none', borderRadius: 8, padding: '8px 24px',
          fontSize: 13, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto',
          opacity: loading ? 0.7 : 1, transition: 'all 0.15s',
        }}>
          {loading
            ? <><div style={{ width: 14, height: 14, border: '2px solid #000', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Generando...</>
            : <>📄 Descargar PDF</>}
        </button>
      </div>
      {pdfError && (
        <div style={{ background: 'rgba(214,40,40,0.12)', border: '1px solid rgba(214,40,40,0.4)',
          borderRadius: 8, padding: '8px 14px', fontSize: 12, color: '#FF6B6B' }}>
          ⚠️ {pdfError}
        </div>
      )}

      {/* Preview NOC */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: G, letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>
          Red — {ciudad === 'todas' ? 'Global' : ciudad}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Hosts Totales',   value: totalHosts,   color: '#60A5FA' },
            { label: 'Online',          value: totalOnline,  color: G },
            { label: 'Offline',         value: totalOffline, color: R },
            { label: 'Alertas Críticas',value: critical,     color: R },
            { label: 'Warnings',        value: warnings,     color: Y },
            { label: 'Score Promedio',  value: `${avgScore}%`, color: Y },
          ].map(({ label, value, color }) => (
            <div key={label} style={kpiStyle(color)}>
              <span style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1, fontFamily: 'monospace' }}>{value}</span>
              <span style={{ fontSize: 9, color: DIM, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sitios con fallas */}
      {offlineCities.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: R, letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>
            Sitios con hosts caídos
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {offlineCities.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#1A2733', borderRadius: 10, border: '1px solid rgba(255,51,102,0.15)' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{c.name}</span>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <span style={{ fontSize: 11, color: R, fontWeight: 700 }}>{c.offline} offline</span>
                  <span style={{ fontSize: 11, color: G }}>{c.online} online</span>
                  <span style={{ fontSize: 11, color: Y }}>{c.score}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview WFM */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#60A5FA', letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>
          WFM — Órdenes de Servicio
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'Total Órdenes', value: wfmStats.total,   color: '#60A5FA' },
            { label: 'Listas',        value: wfmStats.listo,   color: G },
            { label: 'Backlog',       value: wfmStats.backlog, color: R },
            { label: 'En Proceso',    value: wfmStats.proceso, color: Y },
          ].map(({ label, value, color }) => (
            <div key={label} style={kpiStyle(color)}>
              <span style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1, fontFamily: 'monospace' }}>{value}</span>
              <span style={{ fontSize: 9, color: DIM, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── Pipeline de etapas ────────────────────────────────────────────────────────
const PIPELINE_STEPS = ['NOC', 'Dispatch', 'Almacén', 'Operaciones', 'Cierre'];
const PRIORIDAD_COLOR: Record<string, string> = {
  normal: DIM, alta: Y, urgente: O, crítica: R,
};

function TicketPipeline({ etapaIdx, color }: { etapaIdx: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, margin: '6px 0 8px' }}>
      {PIPELINE_STEPS.map((step, i) => {
        const active  = i === etapaIdx;
        const done    = i < etapaIdx;
        const stepCol = active ? color : done ? `${color}60` : 'rgba(255,255,255,0.12)';
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 2, flex: i < PIPELINE_STEPS.length - 1 ? '1' : 'none' }}>
            <div style={{
              fontSize: 7.5, fontWeight: active ? 900 : 600,
              color: active ? '#000' : done ? color : DIM,
              background: active ? color : done ? `${color}18` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${stepCol}`,
              borderRadius: 5, padding: '2px 5px', whiteSpace: 'nowrap', letterSpacing: 0.3,
              boxShadow: active ? `0 0 8px ${color}60` : 'none',
            }}>
              {step}
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div style={{ fontSize: 8, color: done ? `${color}80` : 'rgba(255,255,255,0.12)', flex: 1, textAlign: 'center' }}>›</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Panel de detalle de radiobase ─────────────────────────────────────────────
function RadiobasePanel({ rb, onClose }: { rb: RadiobaseHarmonized; onClose: () => void }) {
  const [tab, setTab]           = useState<'status' | 'tickets' | 'tareas'>('status');
  const [reporting, setReporting] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const c      = { up: G, degraded: Y, down: R, unknown: 'rgba(255,255,255,0.35)' }[rb.status] ?? DIM;
  const label  = { up: 'OPERANDO', degraded: 'DEGRADADO', down: 'CAÍDO', unknown: 'SIN MONITOREO' }[rb.status] ?? '';
  const noc    = rb.sources?.nocboard;
  const ODOO   = 'https://odoo.wispi.mx';

  const handleReporte = async () => {
    setReporting('loading');
    try {
      const r = await fetch(`${API_BASE}/api/noc/radiobase/reporte`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: rb.nombre }),
      });
      setReporting(r.ok ? 'ok' : 'err');
    } catch { setReporting('err'); }
    setTimeout(() => setReporting('idle'), 4000);
  };

  const tabs = [
    { id: 'status',  label: '📡 Estado' },
    { id: 'tickets', label: `🎫 Soporte${rb.soporte.total > 0 ? ` (${rb.soporte.total})` : ''}` },
    { id: 'tareas',  label: `🔧 Campo${rb.campo.total > 0 ? ` (${rb.campo.total})` : ''}` },
  ];

  return (
    <div style={{
      width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'rgba(0,8,4,0.92)', border: `1px solid ${c}22`,
      borderRadius: 18, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 8, color: c, fontFamily: 'monospace', letterSpacing: 2, fontWeight: 700 }}>📡 RADIOBASE</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', marginTop: 2, lineHeight: 1.2 }}>{rb.nombre}</div>
            <div style={{ fontSize: 9, color: c, fontFamily: 'monospace', marginTop: 2 }}>{label}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: DIM, cursor: 'pointer', fontSize: 16, padding: 0 }}>✕</button>
        </div>

        {/* KPIs */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {[
            { label: 'Clientes', value: rb.clientes, color: '#60a5fa' },
            { label: 'Soporte',  value: rb.soporte.total, color: rb.soporte.total > 0 ? R : G },
            { label: 'Campo',    value: rb.campo.total,   color: rb.campo.total > 0 ? '#60a5fa' : G },
          ].map(({ label: lbl, value, color }) => (
            <div key={lbl} style={{ flex: 1, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '6px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 900, color, fontFamily: 'Oswald' }}>{value}</div>
              <div style={{ fontSize: 7.5, color: DIM, textTransform: 'uppercase', letterSpacing: 1 }}>{lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)} style={{
            flex: 1, padding: '8px 4px', background: 'none', border: 'none',
            borderBottom: tab === t.id ? `2px solid ${c}` : '2px solid transparent',
            color: tab === t.id ? c : DIM, fontSize: 9, fontWeight: 700,
            cursor: 'pointer', letterSpacing: 0.5, transition: 'color .15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* ── Estado ─────────────────────────────────────────────────────────── */}
        {tab === 'status' && (
          <>
            {noc ? (
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: DIM, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>NOCBoard</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: 11, color: G }}>▲ {noc.online ? 'Online' : '—'}</span>
                  <span style={{ fontSize: 11, color: DIM }}>Score: <b style={{ color: c }}>{noc.score ?? '—'}</b></span>
                  {noc.alerts > 0 && <span style={{ fontSize: 11, color: Y }}>⚠ {noc.alerts} alertas</span>}
                </div>
                {noc.hostname && <div style={{ fontSize: 9, color: DIM, fontFamily: 'monospace', marginTop: 4 }}>{noc.hostname}</div>}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: DIM, fontSize: 11, padding: '14px 0' }}>Sin alertas registradas en NOCBoard</div>
            )}
            {rb.soporte.total === 0 && rb.campo.total === 0 && (
              <div style={{ textAlign: 'center', color: G, fontSize: 11, padding: '8px 0' }}>✓ Sin tickets ni tareas activas</div>
            )}
            {rb.soporte.total > 0 && (
              <div style={{ background: 'rgba(255,51,102,0.06)', border: '1px solid rgba(255,51,102,0.18)', borderRadius: 10, padding: '8px 12px' }}>
                <span style={{ fontSize: 9, color: R, fontWeight: 700 }}>⚠ {rb.soporte.total} ticket{rb.soporte.total > 1 ? 's' : ''} abierto{rb.soporte.total > 1 ? 's' : ''}</span>
                <span style={{ fontSize: 9, color: DIM, marginLeft: 6 }}>→ ver pestaña Soporte</span>
              </div>
            )}
            {rb.campo.total > 0 && (
              <div style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.18)', borderRadius: 10, padding: '8px 12px' }}>
                <span style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700 }}>🔧 {rb.campo.total} tarea{rb.campo.total > 1 ? 's' : ''} en campo</span>
                <span style={{ fontSize: 9, color: DIM, marginLeft: 6 }}>→ ver pestaña Campo</span>
              </div>
            )}
          </>
        )}

        {/* ── Tickets soporte ────────────────────────────────────────────────── */}
        {tab === 'tickets' && (
          rb.soporte.tickets.length === 0 ? (
            <div style={{ textAlign: 'center', color: G, fontSize: 11, padding: '24px 0' }}>✓ Sin tickets abiertos</div>
          ) : (
            rb.soporte.tickets.map((t: any) => {
              const pc = PRIORIDAD_COLOR[t.prioridad] ?? DIM;
              const etapaIdx = typeof t.etapa_idx === 'number' ? t.etapa_idx : 0;
              return (
                <div key={t.id} style={{
                  background: 'rgba(255,51,102,0.05)', border: '1px solid rgba(255,51,102,0.15)',
                  borderRadius: 10, padding: '10px 12px',
                }}>
                  {/* Pipeline */}
                  <TicketPipeline etapaIdx={etapaIdx} color={R} />

                  {/* Nombre */}
                  <div style={{ fontSize: 11, color: '#fff', fontWeight: 700, lineHeight: 1.3, marginBottom: 6 }}>{t.nombre}</div>

                  {/* Meta */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{ fontSize: 8.5, color: pc, fontFamily: 'monospace', fontWeight: 700 }}>
                      {(t.prioridad ?? 'normal').toUpperCase()}
                    </span>
                    {t.tecnico && <span style={{ fontSize: 8.5, color: DIM }}>👤 {t.tecnico.split(' ')[0]}</span>}
                    {t.tipo && <span style={{ fontSize: 8.5, color: DIM }}>{t.tipo}</span>}
                    <span style={{ fontSize: 8.5, color: DIM }}>{t.fecha}</span>
                  </div>

                  {/* Link Odoo */}
                  <a
                    href={`${ODOO}/odoo/helpdesk/${t.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 9, color: R, fontWeight: 700, textDecoration: 'none',
                      background: 'rgba(255,51,102,0.1)', border: '1px solid rgba(255,51,102,0.25)',
                      borderRadius: 6, padding: '3px 8px',
                    }}
                  >
                    Abrir ticket #{t.id} en Odoo ↗
                  </a>
                </div>
              );
            })
          )
        )}

        {/* ── Tareas campo ───────────────────────────────────────────────────── */}
        {tab === 'tareas' && (
          rb.campo.tareas.length === 0 ? (
            <div style={{ textAlign: 'center', color: G, fontSize: 11, padding: '24px 0' }}>✓ Sin tareas activas en campo</div>
          ) : (
            rb.campo.tareas.map((t: any) => (
              <div key={t.id} style={{
                background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.15)',
                borderRadius: 10, padding: '10px 12px',
              }}>
                {/* Etapa badge */}
                <div style={{ marginBottom: 6 }}>
                  <span style={{
                    fontSize: 7.5, color: '#60a5fa', fontWeight: 700,
                    background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)',
                    borderRadius: 5, padding: '2px 7px', letterSpacing: 0.5,
                  }}>
                    {t.etapa || 'En progreso'}
                  </span>
                </div>

                {/* Nombre */}
                <div style={{ fontSize: 11, color: '#fff', fontWeight: 700, lineHeight: 1.3, marginBottom: 6 }}>{t.nombre}</div>

                {/* Meta */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  {t.tecnicos?.length > 0 && (
                    <span style={{ fontSize: 8.5, color: DIM }}>👤 {t.tecnicos.join(', ').substring(0, 40)}</span>
                  )}
                  {t.cliente && <span style={{ fontSize: 8.5, color: DIM }}>{t.cliente}</span>}
                  {t.fecha && <span style={{ fontSize: 8.5, color: DIM }}>{t.fecha}</span>}
                </div>

                {/* Link Odoo */}
                <a
                  href={`${ODOO}/odoo/project/task/${t.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 9, color: '#60a5fa', fontWeight: 700, textDecoration: 'none',
                    background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
                    borderRadius: 6, padding: '3px 8px',
                  }}
                >
                  Abrir tarea #{t.id} en Odoo ↗
                </a>
              </div>
            ))
          )
        )}
      </div>

      {/* Footer — Reporte */}
      <div style={{ padding: '10px 14px', borderTop: `1px solid rgba(255,255,255,0.06)` }}>
        <button
          onClick={handleReporte}
          disabled={reporting === 'loading'}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 10, border: 'none',
            background: reporting === 'ok'  ? `${G}22` :
                        reporting === 'err' ? `${R}22` :
                        'rgba(255,255,255,0.06)',
            color: reporting === 'ok'  ? G :
                   reporting === 'err' ? R :
                   reporting === 'loading' ? DIM : '#c8d6e5',
            fontSize: 10, fontWeight: 700, cursor: reporting === 'loading' ? 'wait' : 'pointer',
            letterSpacing: 0.5, transition: 'all .2s',
          }}
        >
          {reporting === 'loading' ? '⏳ Generando reporte...' :
           reporting === 'ok'      ? '✓ PDF enviado a Telegram' :
           reporting === 'err'     ? '✗ Error al generar — intenta de nuevo' :
           '📄 Generar reporte PDF → Telegram'}
        </button>
      </div>
    </div>
  );
}

// Priority order: Energía → Datos → WL (wireless last)
const NOCBOARD_PRIORITY = [
  { name: 'Energía', port: 9404, key: 'f4f5ef40c4c54aeca1d6a66109e4555d' },
  { name: 'Datos',   port: 9403, key: 'e48b0da1798145199ad24639cc70c66b' },
  { name: 'WL',      port: 9401, key: '87a08190b801416392e944ab79c7e3c9' },
];

// ── MonitoreoPanel — NOCBoard + Nebula orquestados ───────────────────────────
function MonitoreoPanel({ cities, onSelectCity, onRefresh }: {
  cities: NOCCity[];
  onSelectCity: (c: NOCCity) => void;
  onRefresh?: () => void;
}) {
  const [sub, setSub] = useState<'nocboard' | 'nebula'>('nocboard');
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', gap:0, minHeight:0, overflow:'hidden' }}>
      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:2, flexShrink:0, borderBottom:'1px solid rgba(255,255,255,0.06)', paddingBottom:8, marginBottom:12 }}>
        {([['nocboard', 'NOCBoard', Layers], ['nebula', 'Nebula', Zap]] as const).map(([id, label, Icon]) => {
          const active = sub === id;
          return (
            <button key={id} onClick={() => setSub(id)} style={{
              padding:'7px 18px', fontSize:10, fontWeight:700, borderRadius:8, border:'none', cursor:'pointer',
              background: active ? G : 'rgba(255,255,255,0.04)',
              color: active ? '#001a0d' : 'rgba(0,255,136,0.5)',
              display:'flex', alignItems:'center', gap:5,
              boxShadow: active ? `0 2px 10px ${G}40` : 'none',
              transition:'all 0.15s',
            }}>
              <Icon size={11} />{label}
            </button>
          );
        })}
        <div style={{ marginLeft:'auto', fontSize:10, color:DIM, alignSelf:'center', fontFamily:'monospace' }}>
          NOCBoard + Zabbix orquestados
        </div>
      </div>
      {/* Content */}
      <div style={{ flex:1, minHeight:0, overflow:'hidden', display:'flex' }}>
        {sub === 'nocboard' ? (
          <NocLayersPanel cities={cities} onSelectCity={onSelectCity} onRefresh={onRefresh} />
        ) : (
          <NebulaPanelView />
        )}
      </div>
    </div>
  );
}

// ── NebulaPanelView ───────────────────────────────────────────────────────────
const SEV_COLOR: Record<number, string> = { 0:'#6b7280', 1:'#60a5fa', 2:'#facc15', 3:'#f97316', 4:'#ef4444', 5:'#dc2626' };
const SEV_LABEL: Record<number, string> = { 0:'NC', 1:'Info', 2:'Warning', 3:'Average', 4:'High', 5:'Disaster' };

function NebulaPanelView() {
  const [status, setStatus]     = useState<any>(null);
  const [problems, setProblems] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('');
  const [minSev, setMinSev]     = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, pr] = await Promise.all([
        fetch(`${API_BASE}/api/nebula/status`).then(r => r.json()),
        fetch(`${API_BASE}/api/nebula/problems?limit=200`).then(r => r.json()),
      ]);
      setStatus(st);
      setProblems(pr.problems || []);
    } catch { setStatus({ connected: false, error: 'Error de red' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisibleInterval(load, 30_000);

  const filtered = useMemo(() =>
    problems.filter(p =>
      p.severity >= minSev &&
      (!filter || p.host?.toLowerCase().includes(filter.toLowerCase()) ||
       p.name?.toLowerCase().includes(filter.toLowerCase()))
    ), [problems, filter, minSev]);

  const bySev = useMemo(() =>
    problems.reduce((acc, p) => { acc[p.severity] = (acc[p.severity] || 0) + 1; return acc; }, {} as Record<number,number>),
    [problems]);

  if (loading) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color: G }}>
      <Loader size={24} style={{ animation:'spin 1s linear infinite' }} />
      <span style={{ marginLeft:10, fontSize:13, fontFamily:'monospace' }}>Conectando a Nebula…</span>
    </div>
  );

  if (!status?.connected) return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12 }}>
      <AlertTriangle size={40} color={R} />
      <div style={{ color:R, fontWeight:700, fontSize:14 }}>Nebula no disponible</div>
      <div style={{ color:DIM, fontSize:12, maxWidth:320, textAlign:'center' }}>
        {status?.error || 'Verifica que la VPN esté conectada'}
      </div>
      <button onClick={load} style={{ padding:'8px 20px', background:G, color:'#001a0d', borderRadius:8, border:'none', fontWeight:700, fontSize:11, cursor:'pointer' }}>
        Reintentar
      </button>
    </div>
  );

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', gap:12, overflow:'hidden', minHeight:0 }}>
      {/* Header Nebula */}
      <div style={{ display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <div style={{ display:'flex', gap:10 }}>
          <div style={{ padding:'6px 14px', background:'rgba(0,255,136,0.08)', border:`1px solid ${G}30`, borderRadius:20, fontSize:10, fontWeight:700, color:G, fontFamily:'monospace' }}>
            ⚡ ZABBIX {status.zabbix?.hosts} hosts
          </div>
          <div style={{ padding:'6px 14px', background: status.grafana?.connected ? 'rgba(96,165,250,0.08)' : 'rgba(255,51,102,0.08)', border:`1px solid ${status.grafana?.connected ? '#60a5fa' : R}30`, borderRadius:20, fontSize:10, fontWeight:700, color: status.grafana?.connected ? '#60a5fa' : R, fontFamily:'monospace' }}>
            📊 GRAFANA {status.grafana?.connected ? 'OK' : 'OFFLINE'}
          </div>
        </div>
        <div style={{ flex:1 }} />
        {/* Grafana link */}
        {status.grafana?.connected && (
          <a href={status.grafana.url} target="_blank" rel="noreferrer" style={{ padding:'6px 14px', background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:10, fontWeight:700, color:'#60a5fa', textDecoration:'none' }}>
            Abrir Grafana ↗
          </a>
        )}
        <button onClick={load} style={{ padding:'6px 14px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, fontSize:10, color:DIM, cursor:'pointer' }}>
          ↻ Actualizar
        </button>
      </div>

      {/* Severity KPIs */}
      <div style={{ display:'flex', gap:8, flexShrink:0, flexWrap:'wrap' }}>
        {([5,4,3,2,1,0] as const).map(sev => {
          const count = bySev[sev] || 0;
          const color = SEV_COLOR[sev];
          return (
            <button key={sev} onClick={() => setMinSev(minSev === sev ? 0 : sev)} style={{
              padding:'8px 14px', borderRadius:10, border:`1px solid ${color}${minSev === sev ? 'aa' : '30'}`,
              background: minSev === sev ? `${color}20` : 'rgba(0,0,0,0.2)',
              cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:2, minWidth:72,
            }}>
              <span style={{ fontSize:18, fontWeight:900, color, fontFamily:'monospace' }}>{count}</span>
              <span style={{ fontSize:9, fontWeight:700, color, letterSpacing:1 }}>{SEV_LABEL[sev]}</span>
            </button>
          );
        })}
        <div style={{ flex:1, minWidth:160 }}>
          <input
            value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filtrar host o problema…"
            style={{ width:'100%', padding:'8px 12px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#fff', fontSize:11, fontFamily:'monospace', boxSizing:'border-box' }}
          />
        </div>
      </div>

      {/* Problems table */}
      <div style={{ flex:1, overflowY:'auto', borderRadius:12, border:'1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, fontFamily:'monospace' }}>
          <thead>
            <tr style={{ background:'rgba(0,0,0,0.4)', position:'sticky', top:0 }}>
              {['Severidad','Host','Problema','Hora','ACK'].map(h => (
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', color:DIM, fontWeight:700, fontSize:10, letterSpacing:1, borderBottom:'1px solid rgba(255,255,255,0.06)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:DIM }}>
                {problems.length === 0 ? '✅ Sin problemas activos' : 'Sin resultados para el filtro'}
              </td></tr>
            ) : filtered.map((p, i) => {
              const color = SEV_COLOR[p.severity] || '#6b7280';
              const ts = p.clock ? new Date(parseInt(p.clock) * 1000).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : '?';
              return (
                <tr key={p.id} style={{ background: i % 2 === 0 ? 'rgba(0,0,0,0.15)' : 'transparent', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding:'7px 12px' }}>
                    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:10, background:`${color}20`, color, fontSize:9, fontWeight:700, letterSpacing:1 }}>
                      {p.severity_label}
                    </span>
                  </td>
                  <td style={{ padding:'7px 12px', color:'#e2e8f0', fontWeight:600, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.host}</td>
                  <td style={{ padding:'7px 12px', color:DIM, maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</td>
                  <td style={{ padding:'7px 12px', color:DIM, whiteSpace:'nowrap' }}>{ts}</td>
                  <td style={{ padding:'7px 12px', textAlign:'center' }}>
                    {p.acknowledged ? <CheckCircle size={13} color={G} /> : <span style={{ color:DIM, fontSize:10 }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ color:DIM, fontSize:10, textAlign:'right', flexShrink:0 }}>
        {filtered.length} de {problems.length} problemas · Zabbix 7.0 · Actualiza cada 30s
      </div>
    </div>
  );
}

export default function NocSection({
  theme,
  cities = [],
  alerts = [],
  activeTenantId = null,
  onTenantChange,
  onRefresh,
}: Props) {
  const [selectedCity, setSelectedCity] = useState<NOCCity | null>(null);
  const [view, setView] = useState<'map' | 'grid' | 'reportes' | 'capas'>('map');
  const trackTab = useTabTrack('noc');

  // ── Radiobases armonizadas ─────────────────────────────────────────────────
  const [radiobases, setRadiobases]         = useState<RadiobaseHarmonized[]>([]);
  const [showRadiobases, setShowRadiobases] = useState(true);
  const [vendorLayers, setVendorLayers] = useState<Partial<Record<'uisp'|'cambium'|'mimosa', boolean>>>({});
  const [selectedRb, setSelectedRb]         = useState<RadiobaseHarmonized | null>(null);
  const [rbLoading, setRbLoading]           = useState(false);

  const fetchRadiobases = useCallback(async () => {
    const controller = new AbortController();
    setRbLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/noc/radiobases-harmonized`, { signal: controller.signal });
      if (r.ok) setRadiobases(await r.json());
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') console.warn('fetchRadiobases:', e.message);
    } finally { setRbLoading(false); }
    return () => controller.abort();
  }, []);

  useEffect(() => { fetchRadiobases(); }, [fetchRadiobases]);
  useVisibleInterval(fetchRadiobases, 60_000);
  const [boards, setBoards] = useState<Record<string, { online: number; offline: number; alerts: number; hosts: number; avail: number }>>({});

  const fetchNocBoards = useCallback(async () => {
    await Promise.all(NOCBOARD_PRIORITY.map(async ({ name, port, key }) => {
      try {
        const r = await fetch(`${API_BASE}/api/noc/board-status?port=${port}&key=${key}`);
        if (r.ok) {
          const d = await r.json();
          setBoards(prev => ({ ...prev, [name]: d }));
        }
      } catch {}
    }));
  }, []);

  useEffect(() => { fetchNocBoards(); }, [fetchNocBoards]);
  useVisibleInterval(fetchNocBoards, 30_000);

  const totalHosts  = useMemo(() => cities.reduce((a, c) => a + c.totalHosts, 0), [cities]);
  const totalOnline = useMemo(() => cities.reduce((a, c) => a + c.online, 0), [cities]);
  const totalOffline = useMemo(() => cities.reduce((a, c) => a + c.offline, 0), [cities]);
  const healthPct   = useMemo(() => cities.length === 0 ? 100 : Math.round(cities.reduce((a, c) => a + c.score, 0) / cities.length), [cities]);
  const critCount   = useMemo(() => alerts.filter(a => a.severity === 'critical').length, [alerts]);
  const warnCount   = useMemo(() => alerts.filter(a => a.severity === 'warning').length, [alerts]);
  const hc = healthPct >= 95 ? G : healthPct >= 85 ? Y : R;

  const handleSelectCity = useCallback((city: NOCCity) => {
    setSelectedCity(prev => prev?.id === city.id ? null : city);
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14,
      height: 'calc(100vh - 140px)',
    }}>
      {/* ── Status Banner ── */}
      <NocStatusBanner
        health={healthPct}
        citiesCount={cities.length}
        critCount={critCount}
        warnCount={warnCount}
        online={totalOnline}
        offline={totalOffline}
      />

      {/* ── KPI Row ── */}
      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
        <KpiCard label="Hosts Online" value={totalOnline}
          sub={`de ${totalHosts} total`} color={G}
          icon={<Server size={16} color={G} />} />
        <KpiCard label="Hosts Caídos" value={totalOffline}
          sub={totalOffline > 0 ? 'requieren atención' : 'sin incidentes'}
          color={totalOffline > 0 ? R : G}
          icon={<WifiOff size={16} color={totalOffline > 0 ? R : G} />} />
        <KpiCard label="Alertas Críticas" value={critCount}
          sub={`${warnCount} warnings activas`} color={critCount > 0 ? R : G}
          icon={<AlertTriangle size={16} color={critCount > 0 ? R : G} />} />
        <KpiCard label="Ciudades" value={cities.length}
          sub="nodos de red" color="#60a5fa"
          icon={<Network size={16} color="#60a5fa" />} />
      </div>

      {/* ── Board breakdown ── */}
      {Object.keys(boards).length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {Object.entries(boards).map(([name, b]) => {
            const pct = b.hosts > 0 ? Math.round((b.online / b.hosts) * 100) : 0;
            const bc = pct >= 90 ? G : pct >= 70 ? Y : R;
            return (
              <div key={name} style={{
                flex: 1, background: 'rgba(0,8,4,0.5)', border: `1px solid ${bc}18`,
                borderRadius: 12, padding: '10px 16px',
                position: 'relative', overflow: 'hidden',
              }}>
                {/* barra de fondo progreso */}
                <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: `${bc}07`, borderRadius: 12, pointerEvents: 'none' }} />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: bc, lineHeight: 1, fontFamily: 'Oswald' }}>{pct}%</div>
                    <div style={{ fontSize: 8, color: DIM, fontFamily: 'monospace', letterSpacing: 1 }}>{name.toUpperCase()}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: bc, boxShadow: `0 0 8px ${bc}60`, borderRadius: 3, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <span style={{ fontSize: 9, color: G, fontFamily: 'monospace' }}>▲{b.online}</span>
                      <span style={{ fontSize: 9, color: R, fontFamily: 'monospace' }}>▼{b.offline}</span>
                      {b.alerts > 0 && <span style={{ fontSize: 9, color: Y, fontFamily: 'monospace' }}>⚠{b.alerts}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        {/* Tenant filters */}
        <div style={{ display: 'flex', gap: 5 }}>
          {[{ id: null, label: 'Global' }, ...CASA_TENANTS.map(t => ({ id: t.id, label: t.name }))].map(({ id, label }) => {
            const active = activeTenantId === id;
            return (
              <button key={String(id)} onClick={() => onTenantChange?.(id)} style={{
                padding: '5px 13px', fontSize: 10, fontWeight: 700, borderRadius: 20, cursor: 'pointer',
                background: active ? `${G}18` : 'rgba(255,255,255,0.03)',
                color: active ? G : 'rgba(255,255,255,0.4)',
                border: `1px solid ${active ? `${G}35` : 'rgba(255,255,255,0.06)'}`,
                fontFamily: 'monospace', letterSpacing: 0.5, transition: 'all 0.15s',
              }}>{label.toUpperCase()}</button>
            );
          })}
        </div>

        {/* Capa radiobases + View toggle */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Toggle capa radiobases */}
          {view === 'map' && (
            <button onClick={() => setShowRadiobases(v => !v)} style={{
              padding: '5px 12px', fontSize: 10, fontWeight: 700, borderRadius: 20,
              border: `1px solid ${showRadiobases ? '#60a5fa44' : 'rgba(255,255,255,0.06)'}`,
              background: showRadiobases ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.03)',
              color: showRadiobases ? '#60a5fa' : 'rgba(255,255,255,0.35)',
              cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'monospace',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              📡 {rbLoading ? '…' : `${radiobases.length} RBs`}
            </button>
          )}
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', padding: 3, borderRadius: 12, gap: 2 }}>
          {([['map', 'Mapa', Map], ['grid', 'Rejilla', LayoutGrid], ['capas', 'Monitoreo', Layers], ['reportes', 'Reporte', Activity]] as const).map(([id, label, Icon]) => {
            const active = view === id;
            return (
              <button key={id} onClick={() => { trackTab(id); setView(id as any); }} style={{
                padding: '6px 14px', fontSize: 10, fontWeight: 700, borderRadius: 9,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: active ? G : 'transparent',
                color: active ? '#001a0d' : 'rgba(0,255,136,0.5)',
                display: 'flex', alignItems: 'center', gap: 5,
                boxShadow: active ? `0 2px 12px ${G}40` : 'none',
              }}>
                <Icon size={11} />{label}
              </button>
            );
          })}
        </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0, overflow: 'hidden' }}>
        {view === 'reportes' && (
          <ReporteSemanal cities={cities} alerts={alerts} />
        )}
        {view !== 'reportes' && view === 'map' ? (
          <>
            {/* Map + alerts side by side */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ flex: '0 0 auto', height: 520, position: 'relative', borderRadius: 18, overflow: 'hidden', border: `1px solid ${G}20` }}>
                <RealMap
                  cities={cities}
                  onSelectCity={handleSelectCity}
                  selectedCityId={selectedCity?.id || null}
                  radiobases={radiobases}
                  showRadiobases={showRadiobases}
                  onSelectRadiobase={rb => { setSelectedRb(rb); setSelectedCity(null); }}
                  selectedRbId={selectedRb?.id ?? null}
                  vendorLayers={vendorLayers}
                  onVendorToggle={id => setVendorLayers(prev => ({ ...prev, [id]: !prev[id] }))}
                />
              </div>
              <div style={{ flex: 1, minHeight: 180, overflow: 'hidden' }}>
                <AlertStream alerts={alerts} />
              </div>
            </div>

            {/* Side panel — ciudad o radiobase */}
            {selectedCity && !selectedRb && (
              <SiteInspector city={selectedCity} onClose={() => setSelectedCity(null)} />
            )}
            {selectedRb && (
              <RadiobasePanel rb={selectedRb} onClose={() => setSelectedRb(null)} />
            )}
          </>
        ) : view === 'grid' ? (
          <>
            <div style={{
              flex: 1, overflowY: 'auto',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 12, alignContent: 'start',
            }}>
              {cities.map(city => (
                <CityCard key={city.id} city={city} onClick={() => handleSelectCity(city)} />
              ))}
            </div>
            {selectedCity && (
              <SiteInspector city={selectedCity} onClose={() => setSelectedCity(null)} />
            )}
          </>
        ) : view === 'capas' ? (
          <MonitoreoPanel cities={cities} onSelectCity={handleSelectCity} onRefresh={onRefresh} />
        ) : null}
      </div>

      <style>{`
        @keyframes nocpulse {
          0%,100% { opacity:1; transform:scale(1) }
          50%      { opacity:0.4; transform:scale(1.8) }
        }
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
      `}</style>
    </div>
  );
}
