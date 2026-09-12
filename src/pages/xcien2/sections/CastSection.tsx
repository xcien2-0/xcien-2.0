import { useState, useEffect, useRef, useCallback } from 'react';
import { useTabTrack } from '../../../hooks/useTabTrack';
import { useVisibleInterval } from '../../../hooks/useVisibleInterval';
import { FileText, Search, RefreshCw, ChevronDown, ExternalLink, X } from 'lucide-react';

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
interface Ticket {
  id: number; ref: string; name: string; client: string;
  agent: string; stage: string; level: string;
  created_at: string; elapsed_s: number; resolved: boolean;
}
interface NocData {
  tickets: Ticket[]; total: number; open: number;
  resolved: number; critical: number; avg_response_h: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function elapsedLabel(s: number) {
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function slaFor(level: string | undefined | null) {
  if (!level) return 4 * 3600;
  const l = level.toLowerCase();
  if (l.includes('nvl:1') || l.includes('nivel 1')) return 2 * 3600;
  if (l.includes('nvl:2') || l.includes('nivel 2')) return 4 * 3600;
  if (l.includes('nvl:3') || l.includes('nivel 3')) return 8 * 3600;
  if (l.includes('cae')   || l.includes('visita'))  return 24 * 3600;
  return 4 * 3600;
}

function slaColor(elapsed: number, sla: number, resolved: boolean) {
  if (resolved)          return C.green;
  if (elapsed > sla)     return C.red;
  if (elapsed > sla / 2) return C.amber;
  return C.green;
}

// ── Dona SVG ──────────────────────────────────────────────────────────────────
const SEGMENTS = [
  { key: 'nvl1',    label: 'Nvl:1',      color: '#3b82f6' },
  { key: 'nvl2',    label: 'Nvl:2',      color: '#8b5cf6' },
  { key: 'nvl3',    label: 'Nvl:3',      color: '#f59e0b' },
  { key: 'cae',     label: 'CAE/Visita', color: '#06b6d4' },
  { key: 'otros',   label: 'Otros',      color: '#6b7280' },
  { key: 'resueltos', label: 'Resueltos', color: '#00A859' },
];

function classifyTicket(t: Ticket): string {
  if (t.resolved) return 'resueltos';
  if (!t.level) return 'otros';
  const l = t.level.toLowerCase();
  if (l.includes('nvl:1') || l.includes('nivel 1')) return 'nvl1';
  if (l.includes('nvl:2') || l.includes('nivel 2')) return 'nvl2';
  if (l.includes('nvl:3') || l.includes('nivel 3')) return 'nvl3';
  if (l.includes('cae')   || l.includes('visita'))  return 'cae';
  return 'otros';
}

function DonutChart({ tickets }: { tickets: Ticket[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const counts: Record<string, number> = {};
  SEGMENTS.forEach(s => { counts[s.key] = 0; });
  tickets.forEach(t => { const k = classifyTicket(t); counts[k] = (counts[k] || 0) + 1; });
  const total = tickets.length || 1;

  const R = 70, r = 46, cx = 90, cy = 90;
  const circ = 2 * Math.PI * R;
  let offset = 0;
  const slices = SEGMENTS.map(seg => {
    const pct   = counts[seg.key] / total;
    const len   = pct * circ;
    const slice = { ...seg, pct, len, offset, count: counts[seg.key] };
    offset += len;
    return slice;
  }).filter(s => s.count > 0);

  const hovSeg = hovered ? SEGMENTS.find(s => s.key === hovered) : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <svg width={180} height={180} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={C.border} strokeWidth={24} />
        {slices.map(seg => (
          <circle key={seg.key} cx={cx} cy={cy} r={R} fill="none"
            stroke={seg.color} strokeWidth={hovered === seg.key ? 28 : 22}
            strokeDasharray={`${seg.len} ${circ - seg.len}`}
            strokeDashoffset={-seg.offset}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ cursor: 'pointer', transition: 'stroke-width .15s',
              filter: hovered === seg.key ? `drop-shadow(0 0 8px ${seg.color}88)` : 'none' }}
            onMouseEnter={() => setHovered(seg.key)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        {/* Centro */}
        <circle cx={cx} cy={cy} r={r} fill={C.surf} />
        {hovSeg ? (
          <>
            <text x={cx} y={cy - 8} textAnchor="middle" fill={hovSeg.color}
              style={{ fontSize: 22, fontWeight: 900 }}>{counts[hovSeg.key]}</text>
            <text x={cx} y={cy + 10} textAnchor="middle" fill={C.sub}
              style={{ fontSize: 10 }}>{hovSeg.label}</text>
            <text x={cx} y={cy + 24} textAnchor="middle" fill={C.muted}
              style={{ fontSize: 9 }}>{Math.round((counts[hovSeg.key] / total) * 100)}%</text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - 6} textAnchor="middle" fill={C.text}
              style={{ fontSize: 26, fontWeight: 900 }}>{total}</text>
            <text x={cx} y={cy + 13} textAnchor="middle" fill={C.sub}
              style={{ fontSize: 10 }}>tickets</text>
          </>
        )}
      </svg>

      {/* Leyenda */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SEGMENTS.filter(s => counts[s.key] > 0).map(seg => (
          <div key={seg.key}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              opacity: hovered && hovered !== seg.key ? 0.4 : 1, transition: 'opacity .15s' }}
            onMouseEnter={() => setHovered(seg.key)}
            onMouseLeave={() => setHovered(null)}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: C.sub, minWidth: 72 }}>{seg.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: seg.color,
              fontVariantNumeric: 'tabular-nums' }}>{counts[seg.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Métrica card ──────────────────────────────────────────────────────────────
function Metric({ label, value, color, sub }: {
  label: string; value: string | number; color: string; sub?: string;
}) {
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
      <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: 10, color: C.muted }}>{sub}</span>}
    </div>
  );
}

// ── Analíticas helpers ────────────────────────────────────────────────────────
function groupBy<T>(arr: T[], key: (t: T) => string): { nombre: string; total: number }[] {
  const map: Record<string, number> = {};
  arr.forEach(t => { const k = key(t) || 'Sin asignar'; map[k] = (map[k] || 0) + 1; });
  return Object.entries(map).map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total);
}

function HBar({ nombre, total, max, color }: { nombre: string; total: number; max: number; color: string }) {
  const pct = max > 0 ? (total / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', maxWidth: '75%' }} title={nombre}>{nombre}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
      </div>
      <div style={{ height: 5, background: C.border, borderRadius: 4 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4,
          transition: 'width .4s ease' }} />
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function CastSection() {
  useTabTrack('cast');

  const [data,       setData]       = useState<NocData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [clock,      setClock]      = useState('');
  const [search,     setSearch]     = useState('');
  const [expanded,   setExpanded]   = useState<number | null>(null);
  const [horas,      setHoras]      = useState(48);
  const [sending,    setSending]    = useState(false);
  const [sendMsg,    setSendMsg]    = useState('');
  const [showMenu,   setShowMenu]   = useState(false);
  const [mainTab,    setMainTab]    = useState<'tablero' | 'analiticas'>('tablero');
  const menuRef = useRef<HTMLDivElement>(null);

  // Reloj
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('es-MX',
      { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  // Click fuera cierra menú
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/noc/tickets?horas=${horas}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const raw = await r.json();
      // Map API fields → Ticket interface
      const items = Array.isArray(raw.tickets) ? raw.tickets : Array.isArray(raw) ? raw : [];
      const tickets: Ticket[] = items.map((t: any) => ({
        id:         t.id,
        ref:        t.ref || `#${t.id}`,
        name:       t.title ?? t.name ?? '',
        client:     t.client ?? '',
        agent:      t.user   ?? t.agent ?? 'Sin asignar',
        stage:      t.stage  ?? '',
        level:      t.stage  ?? t.level ?? '',   // stage tiene "CAST Nvl:1" etc.
        created_at: t.created_at ?? '',
        elapsed_s:  t.total_secs ?? t.elapsed_s ?? 0,
        resolved:   t.resolved ?? false,
      }));
      const meta = raw.meta ?? {};
      const open     = tickets.filter(t => !t.resolved).length;
      const resolved = tickets.filter(t =>  t.resolved).length;
      const critical = tickets.filter(t => !t.resolved && t.elapsed_s > slaFor(t.level)).length;
      setData({
        tickets,
        total:        meta.total          ?? tickets.length,
        open:         meta.open           ?? open,
        resolved:     meta.resolved       ?? resolved,
        critical:     meta.critical       ?? critical,
        avg_response_h: meta.avg_response_h ?? 0,
      });
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [horas]);

  useVisibleInterval(load, 60_000);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const sendReport = async (periodo: string) => {
    setShowMenu(false);
    setSending(true);
    setSendMsg('');
    try {
      const r = await fetch(`/api/noc/report?periodo=${periodo}`, { method: 'POST' });
      const j = await r.json();
      setSendMsg(j.ok ? `✓ Reporte ${periodo} enviado a Telegram` : '✗ No se pudo generar el PDF. Intenta de nuevo.');
    } catch {
      setSendMsg('✗ Error de conexión');
    } finally {
      setSending(false);
      setTimeout(() => setSendMsg(''), 5000);
    }
  };

  // Filtro
  const tickets = data?.tickets ?? [];
  const filtered = search.trim()
    ? tickets.filter(t => {
        const q = search.toLowerCase();
        return t.ref.toLowerCase().includes(q)
            || t.name.toLowerCase().includes(q)
            || t.client.toLowerCase().includes(q);
      })
    : tickets;

  const open     = tickets.filter(t => !t.resolved);
  const resolved = tickets.filter(t => t.resolved);
  const critical = open.filter(t => t.elapsed_s > slaFor(t.level));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 28px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: -0.5 }}>
            ATC <span style={{ color: C.green }}>NOC</span>
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>
            Atención al Cliente · datos en tiempo real · Odoo wispi19
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Selector ventana */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[24, 48, 72, 168].map(h => (
              <button key={h} onClick={() => setHoras(h)}
                style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${horas === h ? C.green : C.border}`,
                  background: horas === h ? C.greenDim : C.surf,
                  color: horas === h ? C.green : C.muted, fontWeight: horas === h ? 700 : 400 }}>
                {h < 24 ? `${h}h` : h === 24 ? '1d' : h === 48 ? '2d' : h === 72 ? '3d' : '7d'}
              </button>
            ))}
          </div>
          {/* Refresh */}
          <button onClick={() => { setLoading(true); load(); }}
            style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8,
              color: C.sub, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            <span style={{ fontSize: 11 }}>{clock}</span>
          </button>
          {/* Reporte PDF */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowMenu(v => !v)} disabled={sending}
              style={{ background: sending ? C.surf : C.green, border: 'none', borderRadius: 8,
                color: '#fff', padding: '6px 14px', cursor: sending ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
              <FileText size={13} />
              {sending ? 'Enviando…' : 'Reporte PDF'}
              {!sending && <ChevronDown size={12} />}
            </button>
            {showMenu && (
              <div style={{ position: 'absolute', right: 0, top: '110%', background: C.surf2,
                border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden',
                zIndex: 100, minWidth: 140, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                {['diario','semanal','mensual'].map(p => (
                  <button key={p} onClick={() => sendReport(p)}
                    style={{ width: '100%', padding: '10px 16px', background: 'none', border: 'none',
                      color: C.text, fontSize: 12, textAlign: 'left', cursor: 'pointer',
                      textTransform: 'capitalize',
                      borderBottom: p !== 'mensual' ? `1px solid ${C.border}` : 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.greenDim)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {sendMsg && (
        <div style={{ background: sendMsg.startsWith('✓') ? C.greenDim : C.redDim,
          border: `1px solid ${sendMsg.startsWith('✓') ? C.green : C.red}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: sendMsg.startsWith('✓') ? C.green : C.red, fontSize: 13, fontWeight: 600 }}>
          {sendMsg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: C.redDim, border: `1px solid ${C.red}40`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: C.red, fontSize: 13 }}>
          Error: {error} — ¿Está corriendo el backend en :8002?
        </div>
      )}

      {/* ── Métricas + Dona ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 20 }}>
        {/* Métricas */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Metric label="Total" value={data?.total ?? '—'} color={C.text} sub={`últimas ${horas}h`} />
          <Metric label="Abiertos" value={open.length} color={C.amber}
            sub={open.length > 0 ? 'pendientes' : 'sin pendientes'} />
          <Metric label="Críticos" value={critical.length} color={C.red}
            sub="SLA vencido" />
          <Metric label="Resueltos" value={resolved.length} color={C.green}
            sub={`${data && data.total > 0 ? Math.round((resolved.length / data.total) * 100) : 0}% resolución`} />
          <Metric label="Resp. prom." value={data?.avg_response_h != null ? `${data.avg_response_h}h` : '—'}
            color={C.blue} sub="casos resueltos" />
        </div>
        {/* Dona */}
        <div style={{ background: C.surf, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '16px 20px' }}>
          {data ? <DonutChart tickets={tickets} /> : (
            <div style={{ width: 180, height: 180, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: C.muted, fontSize: 12 }}>
              {loading ? 'Cargando datos…' : 'Sin registros para este período'}
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {([['tablero', '📋 Tablero'], ['analiticas', '📊 Analíticas']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setMainTab(id)}
            style={{ padding: '6px 16px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${mainTab === id ? C.green : C.border}`,
              background: mainTab === id ? C.greenDim : C.surf,
              color: mainTab === id ? C.green : C.sub, fontWeight: mainTab === id ? 700 : 400 }}>
            {label}
          </button>
        ))}
      </div>

      {mainTab === 'tablero' && (<>

      {/* ── SLA leyenda ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Nvl:1 → 2h', color: C.blue  },
          { label: 'Nvl:2 → 4h', color: C.purple },
          { label: 'Nvl:3 → 8h', color: C.amber  },
          { label: 'CAE/Visita → 24h', color: '#06b6d4' },
          { label: 'Sin nivel → 4h',   color: C.muted   },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5,
            background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6,
            padding: '4px 10px' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
            <span style={{ fontSize: 10, color: C.sub }}>{label}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green  }} />
          <span style={{ fontSize: 10, color: C.sub }}>En SLA (&lt;50%)</span>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.amber  }} />
          <span style={{ fontSize: 10, color: C.sub }}>Por vencer (&gt;50%)</span>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.red    }} />
          <span style={{ fontSize: 10, color: C.sub }}>Fuera de SLA</span>
        </div>
      </div>

      {/* ── Buscador ─────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%',
          transform: 'translateY(-50%)', color: C.muted }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por SOP, título o cliente…"
          style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 36, paddingRight: 36,
            padding: '10px 36px', background: C.surf, border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.text, fontSize: 13, outline: 'none',
            paddingLeft: 36 }} />
        {search && (
          <button onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 2 }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Contador resultados */}
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
        {search ? `${filtered.length} resultado(s) para "${search}"` : `${filtered.length} tickets`}
        {critical.length > 0 && !search && (
          <span style={{ marginLeft: 12, color: C.red, fontWeight: 700 }}>
            ⚠ {critical.length} con SLA vencido
          </span>
        )}
      </div>

      {/* ── Tabla ────────────────────────────────────────────────────────── */}
      <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {loading && !data ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>
            Cargando tickets desde Odoo…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>
            {search ? 'Sin resultados para esa búsqueda' : 'Sin tickets en este periodo'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.surf2, borderBottom: `1px solid ${C.border}` }}>
                {['Ref', 'Ticket', 'Cliente', 'Agente', 'Etapa', 'Tiempo', 'SLA'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: C.muted,
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
                    whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const sla   = slaFor(t.level);
                const col   = slaColor(t.elapsed_s, sla, t.resolved);
                const isExp = expanded === t.id;
                return (
                  <>
                    <tr key={t.id}
                      onClick={() => setExpanded(isExp ? null : t.id)}
                      className={!t.resolved && t.elapsed_s > sla && !isExp ? 'critical-row' : ''}
                      style={{ borderBottom: `1px solid ${C.border}`,
                        background: isExp ? C.surf2 : i % 2 === 0 ? C.surf : C.dim,
                        cursor: 'pointer', transition: 'background .1s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.animation = 'none'; (e.currentTarget as HTMLElement).style.background = C.surf2; }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = i % 2 === 0 ? C.surf : C.dim; if (!t.resolved && t.elapsed_s > sla && !isExp) el.style.animation = ''; }}>

                      {/* Ref */}
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: C.green,
                        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{t.ref}</td>

                      {/* Ticket name */}
                      <td style={{ padding: '10px 14px', color: C.text, maxWidth: 260 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={t.name}>{t.name}</div>
                        {t.level && (
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{t.level}</div>
                        )}
                      </td>

                      {/* Cliente */}
                      <td style={{ padding: '10px 14px', color: C.sub, maxWidth: 160 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={t.client}>{t.client || '—'}</div>
                      </td>

                      {/* Agente */}
                      <td style={{ padding: '10px 14px', color: C.sub, whiteSpace: 'nowrap' }}>
                        {t.agent ? t.agent.split(' ')[0] : '—'}
                      </td>

                      {/* Etapa */}
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20,
                          background: t.resolved ? C.greenDim : C.amberDim,
                          color: t.resolved ? C.green : C.amber, fontWeight: 700 }}>
                          {t.stage}
                        </span>
                      </td>

                      {/* Tiempo abierto */}
                      <td style={{ padding: '10px 14px', color: col, fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {elapsedLabel(t.elapsed_s)}
                      </td>

                      {/* SLA — barra de progreso animada */}
                      <td style={{ padding: '8px 14px', minWidth: 130 }}>
                        {t.resolved ? (
                          <span style={{ fontSize: 10, color: C.green }}>✓ resuelto</span>
                        ) : (() => {
                          const pct     = Math.min((t.elapsed_s / sla) * 100, 100);
                          const over    = t.elapsed_s > sla;
                          const warning = !over && t.elapsed_s > sla / 2;
                          const barCol  = over ? C.red : warning ? C.amber : C.green;
                          const remaining = sla - t.elapsed_s;
                          return (
                            <div>
                              {/* track */}
                              <div style={{ width: '100%', height: 6, borderRadius: 3,
                                background: 'rgba(255,255,255,.08)', overflow: 'hidden', marginBottom: 4 }}>
                                <div style={{
                                  height: '100%',
                                  width: `${pct}%`,
                                  borderRadius: 3,
                                  background: barCol,
                                  transition: 'width 1s linear',
                                  boxShadow: over ? `0 0 6px ${C.red}` : undefined,
                                }} />
                              </div>
                              {/* label */}
                              <div style={{ fontSize: 10, color: barCol, fontWeight: 600,
                                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                                {over
                                  ? `+${elapsedLabel(t.elapsed_s - sla)} excedido`
                                  : `${elapsedLabel(remaining)} restante`}
                              </div>
                              <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>
                                {pct.toFixed(0)}% de {sla / 3600}h SLA
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>

                    {/* Detalle expandido */}
                    {isExp && (
                      <tr key={`${t.id}-exp`}
                        style={{ background: C.surf2, borderBottom: `1px solid ${C.border}` }}>
                        <td colSpan={7} style={{ padding: '12px 20px' }}>
                          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>CREADO</div>
                              <div style={{ fontSize: 12, color: C.sub }}>
                                {new Date(t.created_at).toLocaleString('es-MX')}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>AGENTE COMPLETO</div>
                              <div style={{ fontSize: 12, color: C.sub }}>{t.agent || '—'}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>SLA</div>
                              <div style={{ fontSize: 12, color: col, fontWeight: 700 }}>
                                {sla / 3600}h · transcurrido {elapsedLabel(t.elapsed_s)}
                              </div>
                            </div>
                            <a href={`https://odoo.wispi.mx/odoo/helpdesk/${t.id}`}
                              target="_blank" rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              style={{ display: 'flex', alignItems: 'center', gap: 6,
                                color: C.green, fontSize: 12, textDecoration: 'none',
                                padding: '6px 12px', background: C.greenDim,
                                borderRadius: 6, border: `1px solid ${C.green}40` }}>
                              <ExternalLink size={12} />
                              Ver en Odoo · #{t.id}
                            </a>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      </>)}

      {/* ── ANALÍTICAS ───────────────────────────────────────────────────── */}
      {mainTab === 'analiticas' && (() => {
        const open     = tickets.filter(t => !t.resolved);
        const resolved = tickets.filter(t =>  t.resolved);
        const fuera    = open.filter(t => t.elapsed_s > slaFor(t.level));
        const porVencer = open.filter(t => t.elapsed_s > slaFor(t.level) / 2 && t.elapsed_s <= slaFor(t.level));
        const enSla    = open.filter(t => t.elapsed_s <= slaFor(t.level) / 2);
        const tasaRes  = tickets.length > 0 ? Math.round((resolved.length / tickets.length) * 100) : 0;

        const porAgente = groupBy(open, t => t.agent.split(' ').slice(0, 2).join(' '));
        const porNivel  = groupBy(tickets, t => classifyTicket(t));
        const porEtapa  = groupBy(open, t => t.stage);

        const maxAgente = Math.max(...porAgente.map(x => x.total), 1);
        const maxNivel  = Math.max(...porNivel.map(x => x.total),  1);
        const maxEtapa  = Math.max(...porEtapa.map(x => x.total),  1);

        return (
          <div>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Total período',   value: tickets.length, color: C.text  },
                { label: 'Abiertos',        value: open.length,    color: C.amber },
                { label: 'Resueltos',       value: resolved.length,color: C.green },
                { label: 'Fuera de SLA',    value: fuera.length,   color: C.red   },
                { label: 'Por vencer',      value: porVencer.length,color: C.amber },
                { label: 'En SLA (<50%)',   value: enSla.length,   color: C.green },
                { label: 'Tasa resolución', value: `${tasaRes}%`,  color: tasaRes >= 80 ? C.green : tasaRes >= 50 ? C.amber : C.red },
              ].map(k => (
                <div key={k.label} style={{ background: C.surf, border: `1px solid ${C.border}`,
                  borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: k.color,
                    fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Estado SLA visual */}
            <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: 16, marginBottom: 16 }}>
              <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: C.text }}>
                Estado SLA — tickets abiertos ({open.length})
              </p>
              <div style={{ display: 'flex', gap: 0, height: 20, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
                {[
                  { pct: open.length > 0 ? (fuera.length / open.length) * 100 : 0, color: C.red   },
                  { pct: open.length > 0 ? (porVencer.length / open.length) * 100 : 0, color: C.amber },
                  { pct: open.length > 0 ? (enSla.length / open.length) * 100 : 0, color: C.green },
                ].map((seg, i) => seg.pct > 0 && (
                  <div key={i} style={{ width: `${seg.pct}%`, background: seg.color, transition: 'width .4s' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                {[
                  { label: '🔴 Fuera de SLA', count: fuera.length,    color: C.red   },
                  { label: '🟡 Por vencer',   count: porVencer.length, color: C.amber },
                  { label: '🟢 En SLA',       count: enSla.length,     color: C.green },
                ].map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: C.sub }}>{s.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.color,
                      fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Grilla de breakdowns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {/* Por agente */}
              <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: C.text }}>
                  👤 Tickets abiertos por agente
                </p>
                {porAgente.slice(0, 10).map(item => (
                  <HBar key={item.nombre} nombre={item.nombre} total={item.total} max={maxAgente} color={C.blue} />
                ))}
                {porAgente.length === 0 && <p style={{ color: C.muted, fontSize: 11 }}>Sin registros disponibles aún</p>}
              </div>

              {/* Por nivel */}
              <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: C.text }}>
                  📊 Por nivel / tipo
                </p>
                {porNivel.map(item => {
                  const seg = SEGMENTS.find(s => s.key === item.nombre);
                  return (
                    <HBar key={item.nombre} nombre={seg?.label ?? item.nombre}
                      total={item.total} max={maxNivel} color={seg?.color ?? C.purple} />
                  );
                })}
                {porNivel.length === 0 && <p style={{ color: C.muted, fontSize: 11 }}>Sin registros disponibles aún</p>}
              </div>

              {/* Por etapa */}
              <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, color: C.text }}>
                  🏷️ Por etapa (abiertos)
                </p>
                {porEtapa.slice(0, 10).map(item => (
                  <HBar key={item.nombre} nombre={item.nombre} total={item.total} max={maxEtapa} color={C.amber} />
                ))}
                {porEtapa.length === 0 && <p style={{ color: C.muted, fontSize: 11 }}>Sin registros disponibles aún</p>}
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-red {
          0%, 100% { background: rgba(239,68,68,0.08); }
          50%       { background: rgba(239,68,68,0.22); }
        }
        tr.critical-row { animation: pulse-red 1.6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
