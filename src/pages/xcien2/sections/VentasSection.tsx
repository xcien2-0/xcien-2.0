import { useState, useEffect, useMemo } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';
import brand from '../../../brand';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { TrendingUp, DollarSign, Users, Zap, ChevronRight, X, Loader, Filter } from 'lucide-react';

interface Props { theme: ThemeConfig }

// ── Palettes ──────────────────────────────────────────────────────────────────
const G   = '#00ff88';
const B   = '#00b4d8';
const Y   = '#f59e0b';
const P   = '#a855f7';
const R   = '#ef4444';

const TIPO_COLORS: Record<string, string> = {
  'UPSALE': '#00ff88', 'RENOVACIÓN': '#00b4d8', 'UPGRADE': '#f59e0b',
  'PRIMERA VENTA': '#3b82f6', 'VENTA DE EQUIPO': '#ec4899',
  'CAMBIO DE DOMICILIO': '#8b5cf6', 'DECREMENTO': '#ef4444',
  'CORTESÍA': '#475569', 'MIGRACIÓN': '#a855f7', 'EVENTUAL': '#fb923c',
};

const CAT_COLORS: Record<string, string> = {
  'DEDICADO': '#00ff88', 'SERVICIOS ADMINISTRADOS': '#00b4d8',
  'PYME': '#f59e0b', 'SATELITAL': '#8b5cf6',
};

const EMP_COLORS: Record<string, string> = {
  'XCIEN': brand.accentColor, 'ISP 2': '#00b4d8', 'ISP 3': '#f59e0b',
  'MANUFACTURA': '#a855f7', 'OTRO': '#475569',
};

const FAC_COLORS: Record<string, string> = {
  'PAGADA': '#00ff88', 'PENDIENTE PAGO': '#f59e0b',
  'PENDIENTE ELABORACIÓN': '#ef4444', 'CANCELADA': '#475569',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, short = false) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(short ? 1 : 2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label, color = G }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(6,12,20,0.95)', border: `1px solid ${color}30`, borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#fff', backdropFilter: 'blur(8px)' }}>
      {label && <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 4, fontSize: 11 }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || color, fontWeight: 700 }}>
          {typeof p.value === 'number' && p.name?.includes('mrr') ? fmt(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}

// ── Donut Chart ───────────────────────────────────────────────────────────────
function DonutChart({ data, colors, size = 140 }: { data: { name: string; value: number }[]; colors: Record<string,string>; size?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const palette = data.map(d => colors[d.name] || '#475569');
  return (
    <PieChart width={size} height={size}>
      <Pie data={data} cx={size/2 - 1} cy={size/2 - 1} innerRadius={size * 0.32} outerRadius={size * 0.46}
        dataKey="value" paddingAngle={2}
        onMouseEnter={(_, i) => setActive(i)}
        onMouseLeave={() => setActive(null)}
      >
        {data.map((_, i) => (
          <Cell key={i} fill={palette[i]} opacity={active === null || active === i ? 1 : 0.35}
            stroke={active === i ? palette[i] : 'transparent'} strokeWidth={active === i ? 2 : 0} />
        ))}
      </Pie>
    </PieChart>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Resumen {
  total_ordenes: number; mrr: number; mnr: number; vtc: number;
  por_empresa: Record<string, number>;
  por_tipo: Record<string, number>;
  por_categoria: Record<string, number>;
  por_on_off: Record<string, number>;
  estatus_factura: Record<string, number>;
  cliente_nuevo: number;
  primera_venta_mrr: number;
}
interface MesDato   { mes: string; ordenes: number; mrr: number; mnr: number; vtc: number; }
interface Vendedor  { vendedor: string; ordenes: number; mrr: number; vtc: number; }

// ── Panel wrapper ─────────────────────────────────────────────────────────────
function Panel({ children, onClick, glow, style }: { children: React.ReactNode; onClick?: () => void; glow?: string; style?: React.CSSProperties }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${hov && glow ? glow + '40' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: 20,
        padding: '22px 24px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s',
        boxShadow: hov && glow ? `0 0 0 1px ${glow}15, 0 8px 32px rgba(0,0,0,0.3)` : '0 2px 12px rgba(0,0,0,0.2)',
        backdropFilter: 'blur(8px)',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      {glow && hov && <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at top left, ${glow}06 0%, transparent 70%)`, pointerEvents: 'none' }} />}
      {children}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon: Icon, sparkData }: { label: string; value: string; sub?: string; color: string; icon: any; sparkData?: number[] }) {
  return (
    <Panel glow={color}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>{label}</div>
          <div style={{ fontSize: 30, fontWeight: 900, color, letterSpacing: -1, lineHeight: 1 }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>{sub}</div>}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}15`, border: `1px solid ${color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={color} />
        </div>
      </div>
      {sparkData && (
        <div style={{ marginTop: 16, height: 40 }}>
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={sparkData.map((v, i) => ({ i, v }))} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#spark-${label})`} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ── Drill Modal ───────────────────────────────────────────────────────────────
type DrillTarget = 'tipo_op' | 'categoria' | 'empresa' | 'factura' | 'vendedores' | null;

function DrillModal({ target, resumen, vendedores, onClose }: { target: DrillTarget; resumen: Resumen; vendedores: Vendedor[]; onClose: () => void }) {
  if (!target) return null;

  const titles: Record<NonNullable<DrillTarget>, string> = {
    tipo_op: 'Tipo de Operación', categoria: 'Categoría de Producto',
    empresa: 'Desglose por Empresa', factura: 'Estatus Facturación', vendedores: 'Top Vendedores',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(12px)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'rgba(8,14,24,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: 32, minWidth: 520, maxWidth: 700, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 40px 100px rgba(0,0,0,0.8)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>{titles[target]}</h3>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}><X size={16} /></button>
        </div>

        {/* Tipo operación — horizontal bar chart */}
        {target === 'tipo_op' && (() => {
          const rows = Object.entries(resumen.por_tipo).sort((a,b)=>b[1]-a[1]);
          const total = rows.reduce((s,r)=>s+r[1],0);
          const data = rows.map(([name,value]) => ({ name, value, pct: ((value/total)*100).toFixed(1) }));
          return (
            <div>
              <ResponsiveContainer width="100%" height={data.length * 38 + 20}>
                <BarChart data={data} layout="vertical" margin={{ left: 130, right: 50, top: 0, bottom: 0 }} barSize={10}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} width={130} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                    {data.map((d, i) => <Cell key={i} fill={TIPO_COLORS[d.name] || '#475569'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                {data.slice(0, 6).map(d => (
                  <div key={d.name} style={{ fontSize: 11, color: TIPO_COLORS[d.name] || '#475569', background: `${TIPO_COLORS[d.name] || '#475569'}15`, borderRadius: 20, padding: '3px 10px', border: `1px solid ${TIPO_COLORS[d.name] || '#475569'}30` }}>
                    {d.name} · {d.pct}%
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Categoría — donut + lista */}
        {target === 'categoria' && (() => {
          const rows = Object.entries(resumen.por_categoria).sort((a,b)=>b[1]-a[1]);
          const total = rows.reduce((s,r)=>s+r[1],0);
          const data = rows.map(([name,value]) => ({ name, value }));
          return (
            <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
              <DonutChart data={data} colors={CAT_COLORS} size={180} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rows.map(([name, val]) => (
                  <div key={name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS[name] || '#475569', display: 'inline-block' }} />
                        <span style={{ color: '#fff', fontWeight: 600 }}>{name}</span>
                      </div>
                      <span style={{ color: CAT_COLORS[name] || '#475569', fontWeight: 700 }}>{val} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>({((val/total)*100).toFixed(0)}%)</span></span>
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${(val/rows[0][1])*100}%`, height: '100%', background: CAT_COLORS[name] || '#475569', borderRadius: 4, boxShadow: `0 0 6px ${CAT_COLORS[name] || '#475569'}88` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Empresa — donut + lista */}
        {target === 'empresa' && (() => {
          const rows = Object.entries(resumen.por_empresa).sort((a,b)=>b[1]-a[1]);
          const total = rows.reduce((s,r)=>s+r[1],0);
          const data = rows.map(([name,value]) => ({ name, value }));
          return (
            <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
              <DonutChart data={data} colors={EMP_COLORS} size={180} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rows.map(([name, val]) => (
                  <div key={name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: EMP_COLORS[name] || '#475569', display: 'inline-block' }} />
                        <span style={{ color: '#fff', fontWeight: 600 }}>{name}</span>
                      </div>
                      <span style={{ color: EMP_COLORS[name] || '#475569', fontWeight: 700 }}>{val} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>({((val/total)*100).toFixed(0)}%)</span></span>
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${(val/rows[0][1])*100}%`, height: '100%', background: EMP_COLORS[name] || '#475569', borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Factura — donut + lista */}
        {target === 'factura' && (() => {
          const rows = Object.entries(resumen.estatus_factura).sort((a,b)=>b[1]-a[1]);
          const total = rows.reduce((s,r)=>s+r[1],0);
          const data = rows.map(([name,value]) => ({ name, value }));
          return (
            <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
              <DonutChart data={data} colors={FAC_COLORS} size={180} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rows.map(([name, val]) => (
                  <div key={name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: FAC_COLORS[name] || '#475569', display: 'inline-block' }} />
                        <span style={{ color: '#fff', fontWeight: 600 }}>{name}</span>
                      </div>
                      <span style={{ color: FAC_COLORS[name] || '#475569', fontWeight: 700 }}>{val} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>({((val/total)*100).toFixed(0)}%)</span></span>
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${(val/rows[0][1])*100}%`, height: '100%', background: FAC_COLORS[name] || '#475569', borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Vendedores */}
        {target === 'vendedores' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {vendedores.map((v, i) => (
              <div key={v.vendedor} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 14, background: i === 0 ? `${G}08` : 'rgba(255,255,255,0.02)', border: `1px solid ${i < 3 ? G + '20' : 'rgba(255,255,255,0.05)'}` }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: i === 0 ? G : i === 1 ? B : i === 2 ? Y : 'rgba(255,255,255,0.3)', minWidth: 28 }}>#{i+1}</span>
                <span style={{ flex: 1, fontSize: 13, color: '#fff', fontWeight: 600 }}>{v.vendedor || '—'}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: G }}>{fmt(v.mrr)}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{v.ordenes} órdenes</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Section ──────────────────────────────────────────────────────────────
export default function VentasSection({ theme: T }: Props) {
  const [resumen,    setResumen]    = useState<Resumen | null>(null);
  const [meses,      setMeses]      = useState<MesDato[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [drill,      setDrill]      = useState<DrillTarget>(null);
  const [mesFiltro,  setMesFiltro]  = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/ventas/resumen`).then(r => r.json()),
      fetch(`${API_BASE}/api/ventas/por-mes`).then(r => r.json()),
      fetch(`${API_BASE}/api/ventas/top-vendedores`).then(r => r.json()),
    ]).then(([res, mes, vend]) => { setResumen(res); setMeses(mes); setVendedores(vend); })
      .catch(console.error).finally(() => setLoading(false));
  }, []);

  const resFiltrado = useMemo(() => {
    if (!mesFiltro || !meses.length || !resumen) return resumen;
    const m = meses.find(x => x.mes === mesFiltro);
    return m ? { ...resumen, mrr: m.mrr, mnr: m.mnr, vtc: m.vtc, total_ordenes: m.ordenes } : resumen;
  }, [resumen, meses, mesFiltro]);

  const sparkMrr = useMemo(() => meses.map(m => m.mrr), [meses]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, gap: 12, color: 'rgba(255,255,255,0.4)', flexDirection: 'column' }}>
      <Loader size={28} style={{ animation: 'spin 1s linear infinite', color: G }} />
      <span style={{ fontSize: 13 }}>Cargando datos de ventas...</span>
    </div>
  );

  if (!resumen || !resFiltrado) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: R }}>No se pudieron cargar los datos de ventas</div>
  );

  // Derived data
  const tipoData = Object.entries(resumen.por_tipo).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,value]) => ({ name, value }));
  const catData  = Object.entries(resumen.por_categoria).sort((a,b)=>b[1]-a[1]).map(([name,value]) => ({ name, value }));
  const empData  = Object.entries(resumen.por_empresa).sort((a,b)=>b[1]-a[1]).map(([name,value]) => ({ name, value }));
  const onOff    = resumen.por_on_off;
  const totalOnOff = (onOff['ON']||0) + (onOff['OFF']||0);

  // MRR area chart data
  const areaData = meses.map(m => ({ mes: m.mes.slice(0,3), mrr: m.mrr, ordenes: m.ordenes, vtc: m.vtc }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 40, fontFamily: "'Inter', sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: '#fff', margin: 0, letterSpacing: -1 }}>
            Ventas <span style={{ color: G }}>2026</span>
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', margin: '4px 0 0' }}>
            Archivo Maestro Comercial · {resumen.total_ordenes} órdenes · Ene–Jun 2026
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Filter size={12} color="rgba(255,255,255,0.3)" />
          <select value={mesFiltro} onChange={e => setMesFiltro(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '7px 12px', color: '#fff', fontSize: 12, cursor: 'pointer', outline: 'none' }}>
            <option value="">Todos los meses</option>
            {meses.map(m => <option key={m.mes} value={m.mes}>{m.mes}</option>)}
          </select>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KpiCard label="MRR Neto"        value={fmt(resFiltrado.mrr, true)}  sub={`${resFiltrado.total_ordenes} órdenes`}   color={G} icon={DollarSign} sparkData={sparkMrr} />
        <KpiCard label="No Recurrente"   value={fmt(resFiltrado.mnr, true)}  sub="Equipos y one-time"                        color={B} icon={Zap} />
        <KpiCard label="VTC Total"       value={fmt(resFiltrado.vtc, true)}  sub="Valor total contratos"                     color={Y} icon={TrendingUp} />
        <KpiCard label="Clientes Nuevos" value={String(resumen.cliente_nuevo)} sub={`de ${resumen.total_ordenes} órdenes`}  color={P} icon={Users} />
      </div>

      {/* MRR Area Chart */}
      <Panel glow={G} style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: '#fff', margin: 0 }}>MRR Mensual</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: '4px 0 0' }}>Ingresos recurrentes generados por mes · Clic en barra para filtrar</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: G }}>{fmt(meses.reduce((s,m)=>s+m.mrr,0), true)}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>acumulado 2026</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={areaData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
            onClick={(d: any) => d?.activeLabel && setMesFiltro(p => p === meses.find(m => m.mes.slice(0,3) === d.activeLabel)?.mes ? '' : meses.find(m => m.mes.slice(0,3) === d.activeLabel)?.mes || '')}
          >
            <defs>
              <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={G} stopOpacity={0.25} />
                <stop offset="100%" stopColor={G} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="mes" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} width={52} />
            <Tooltip content={<ChartTip color={G} />} formatter={(v: number) => fmt(v)} />
            <Area type="monotone" dataKey="mrr" name="mrr" stroke={G} strokeWidth={2.5} fill="url(#mrrGrad)" dot={{ fill: G, r: 4, strokeWidth: 0 }} activeDot={{ r: 6, fill: G, strokeWidth: 0, filter: `drop-shadow(0 0 6px ${G})` }} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* Row 2: Tipo Operación (bar) + ON/OFF + Empresa */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>

        {/* Tipo operación */}
        <Panel glow={G} onClick={() => setDrill('tipo_op')} style={{ padding: '22px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 800, color: '#fff', margin: 0 }}>Tipo de Operación</h2>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '3px 0 0' }}>{resumen.total_ordenes} operaciones totales</p>
            </div>
            <ChevronRight size={16} color="rgba(255,255,255,0.3)" />
          </div>
          <ResponsiveContainer width="100%" height={tipoData.length * 34}>
            <BarChart data={tipoData} layout="vertical" barSize={8} margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} width={148} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="value" radius={[0, 8, 8, 0]} label={{ position: 'right', fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                {tipoData.map((d, i) => <Cell key={i} fill={TIPO_COLORS[d.name] || '#475569'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ON/OFF Net */}
          <Panel glow={G} style={{ padding: '20px 22px', flex: 1 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: '0 0 16px' }}>ON · OFF Net</h2>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <DonutChart data={[{ name: 'ON', value: onOff['ON']||0 }, { name: 'OFF', value: onOff['OFF']||0 }]} colors={{ ON: '#22c55e', OFF: R }} size={100} />
              <div style={{ flex: 1 }}>
                {[['ON', '#22c55e'], ['OFF', R]].map(([k, c]) => (
                  <div key={k} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                      <span style={{ color: 'rgba(255,255,255,0.7)' }}>{k}-Net</span>
                      <span style={{ color: c, fontWeight: 700 }}>{onOff[k]||0}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${totalOnOff > 0 ? ((onOff[k]||0)/totalOnOff)*100 : 0}%`, height: '100%', background: c, borderRadius: 4, boxShadow: `0 0 6px ${c}88` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          {/* Empresa */}
          <Panel glow={B} onClick={() => setDrill('empresa')} style={{ padding: '20px 22px', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: 0 }}>Empresa</h2>
              <ChevronRight size={14} color="rgba(255,255,255,0.3)" />
            </div>
            {empData.map(({ name, value }) => {
              const total = empData.reduce((s,r)=>s+r.value,0);
              return (
                <div key={name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: EMP_COLORS[name]||'#475569', display: 'inline-block' }} />
                      <span style={{ color: 'rgba(255,255,255,0.7)' }}>{name}</span>
                    </div>
                    <span style={{ color: EMP_COLORS[name]||B, fontWeight: 700 }}>{value} <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>({((value/total)*100).toFixed(0)}%)</span></span>
                  </div>
                  <div style={{ height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <div style={{ width: `${(value/empData[0].value)*100}%`, height: '100%', background: EMP_COLORS[name]||B, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </Panel>
        </div>
      </div>

      {/* Row 3: Categoría (donut) + Facturación + Vendedores */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

        {/* Categoría */}
        <Panel glow={G} onClick={() => setDrill('categoria')} style={{ padding: '22px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: 0 }}>Categoría</h2>
            <ChevronRight size={14} color="rgba(255,255,255,0.3)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <DonutChart data={catData} colors={CAT_COLORS} size={120} />
            <div style={{ flex: 1 }}>
              {catData.map(({ name, value }) => {
                const total = catData.reduce((s,r)=>s+r.value,0);
                return (
                  <div key={name} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                      <span style={{ color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLORS[name]||'#475569', display: 'inline-block' }} />
                        {name.length > 14 ? name.slice(0,14)+'…' : name}
                      </span>
                      <span style={{ color: CAT_COLORS[name]||G, fontWeight: 700 }}>{((value/total)*100).toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        {/* Facturación */}
        <Panel glow={Y} onClick={() => setDrill('factura')} style={{ padding: '22px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: 0 }}>Facturación</h2>
            <ChevronRight size={14} color="rgba(255,255,255,0.3)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <DonutChart data={Object.entries(resumen.estatus_factura).map(([name,value])=>({name,value}))} colors={FAC_COLORS} size={120} />
            <div style={{ flex: 1 }}>
              {Object.entries(resumen.estatus_factura).sort((a,b)=>b[1]-a[1]).map(([name, val]) => {
                const total = Object.values(resumen.estatus_factura).reduce((s,v)=>s+v,0);
                return (
                  <div key={name} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                      <span style={{ color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: FAC_COLORS[name]||'#475569', display: 'inline-block' }} />
                        {name.length > 16 ? name.slice(0,16)+'…' : name}
                      </span>
                      <span style={{ color: FAC_COLORS[name]||Y, fontWeight: 700 }}>{val} <span style={{ color: 'rgba(255,255,255,0.3)' }}>({((val/total)*100).toFixed(0)}%)</span></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        {/* Top Vendedores */}
        <Panel glow={P} onClick={() => setDrill('vendedores')} style={{ padding: '22px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: 0 }}>Top Vendedores</h2>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '3px 0 0' }}>Por MRR generado</p>
            </div>
            <ChevronRight size={14} color="rgba(255,255,255,0.3)" />
          </div>
          {vendedores.slice(0, 6).map((v, i) => (
            <div key={v.vendedor} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: i === 0 ? G : i === 1 ? B : i === 2 ? Y : 'rgba(255,255,255,0.25)', minWidth: 22 }}>#{i+1}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.vendedor || '—'}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: i < 3 ? G : 'rgba(255,255,255,0.4)' }}>{fmt(v.mrr, true)}</span>
            </div>
          ))}
        </Panel>
      </div>

      {/* Drill Modal */}
      {drill && <DrillModal target={drill} resumen={resumen} vendedores={vendedores} onClose={() => setDrill(null)} />}
    </div>
  );
}
