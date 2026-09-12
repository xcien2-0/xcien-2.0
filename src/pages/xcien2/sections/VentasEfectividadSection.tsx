import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, TrendingUp, Users, Building2, BarChart3 } from 'lucide-react';
import { useTabTrack } from '../../../hooks/useTabTrack';

interface Grupo { nombre: string; ordenes: number; mrr?: number; total?: number; ticket_prom?: number; nuevos?: number; primera_venta?: number; lider?: string; equipos?: string[] }
interface Totales { ordenes: number; mrr_total: number; monto_total: number; clientes_nuevos: number; primera_venta: number }
interface Data {
  totales: Totales;
  por_marca: Grupo[];
  por_vendedor: Grupo[];
  por_canal: Grupo[];
  por_segmento: Grupo[];
  por_tipo: { nombre: string; ordenes: number; mrr: number }[];
  lideres_odoo: (Grupo & { error?: string })[];
  equipos_odoo: Grupo[];
}

const fmt$ = (n: number) => n >= 1_000_000
  ? `$${(n/1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${n.toFixed(0)}`;

const MARCA_COLOR: Record<string, string> = {
  XCIEN: '#00A859', HUUS: '#3b82f6', LUMINET: '#f59e0b',
  MANUFACTURA: '#a855f7', OTRO: '#6b7280',
};

const DIAS_OPTS = [30, 60, 90, 180];
const TABS = ['marca', 'vendedor', 'canal', 'lider', 'equipo'] as const;
type Tab = typeof TABS[number];

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ background: '#1f2937', borderRadius: 3, height: 6, flex: 1 }}>
      <div style={{ background: color, width: `${pct}%`, height: '100%', borderRadius: 3, transition: 'width .4s' }} />
    </div>
  );
}

export default function VentasEfectividadSection() {
  const G = '#00A859';
  const [data, setData]     = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [dias, setDias]     = useState(90);
  const [tab, setTab]       = useState<Tab>('marca');
  const [empresa, setEmpresa] = useState('');
  const [vendedor, setVendedor] = useState('');
  const trackTab = useTabTrack('ventas-efectividad');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ dias: String(dias) });
    if (empresa) params.set('empresa', empresa);
    if (vendedor) params.set('vendedor', vendedor);
    const r = await fetch(`/api/ventas/efectividad?${params}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, [dias, empresa, vendedor]);

  useEffect(() => { load(); }, [load]);

  const rows: Grupo[] = data
    ? tab === 'marca'    ? (data.por_marca      ?? [])
    : tab === 'vendedor' ? (data.por_vendedor   ?? [])
    : tab === 'canal'    ? (data.por_canal      ?? [])
    : tab === 'lider'    ? (data.lideres_odoo   ?? []).filter(x => !x.error)
    :                      (data.equipos_odoo   ?? [])
    : [];

  const maxMrr = Math.max(...rows.map(r => r.mrr ?? r.total ?? 0), 1);

  const TAB_LABELS: Record<Tab, string> = {
    marca: '🏢 Por Marca', vendedor: '👤 Por Vendedor',
    canal: '📡 Por Canal', lider: '⭐ Líderes (Odoo)', equipo: '🏆 Equipos (Odoo)',
  };

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#e5e7eb', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f9fafb' }}>
            <BarChart3 size={18} style={{ marginRight: 8, verticalAlign: 'middle', color: G }} />
            Efectividad de Ventas
          </h2>
          <div style={{ color: '#6b7280', fontSize: 11, marginTop: 3 }}>
            CSV Archivo Maestro + Odoo · últimos {dias} días
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Días */}
          <div style={{ display: 'flex', gap: 4 }}>
            {DIAS_OPTS.map(d => (
              <button key={d} onClick={() => setDias(d)}
                style={{ background: dias === d ? G : '#111827', border: `1px solid ${dias === d ? G : '#374151'}`,
                  borderRadius: 6, color: dias === d ? '#000' : '#9ca3af', padding: '4px 10px',
                  cursor: 'pointer', fontSize: 11, fontWeight: dias === d ? 700 : 400 }}>
                {d}d
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            style={{ background: '#111827', border: '1px solid #374151', borderRadius: 6,
              color: '#9ca3af', padding: '6px 12px', cursor: 'pointer', display: 'flex',
              alignItems: 'center', gap: 5, fontSize: 11 }}>
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <select value={empresa} onChange={e => setEmpresa(e.target.value)}
          style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8,
            color: '#e5e7eb', padding: '6px 12px', fontSize: 11, cursor: 'pointer' }}>
          <option value="">Todas las marcas</option>
          {['XCIEN','HUUS','LUMINET','MANUFACTURA','OTRO'].map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input value={vendedor} onChange={e => setVendedor(e.target.value)}
          placeholder="Buscar vendedor..."
          style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8,
            color: '#e5e7eb', padding: '6px 12px', fontSize: 11, outline: 'none',
            width: 200 }} />
        {(empresa || vendedor) && (
          <button onClick={() => { setEmpresa(''); setVendedor(''); }}
            style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 8,
              color: '#6b7280', padding: '6px 10px', cursor: 'pointer', fontSize: 11 }}>
            ✕ Limpiar
          </button>
        )}
      </div>

      {/* KPIs globales */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Órdenes', value: data.totales.ordenes.toLocaleString(), icon: <BarChart3 size={14}/>, color: G },
            { label: 'MRR Total', value: fmt$(data.totales.mrr_total), icon: <TrendingUp size={14}/>, color: '#22c55e' },
            { label: 'Monto Total', value: fmt$(data.totales.monto_total), icon: <TrendingUp size={14}/>, color: '#3b82f6' },
            { label: 'Clientes Nuevos', value: data.totales.clientes_nuevos.toLocaleString(), icon: <Users size={14}/>, color: '#f59e0b' },
            { label: 'Primera Venta', value: data.totales.primera_venta.toLocaleString(), icon: <Building2 size={14}/>, color: '#a855f7' },
          ].map(k => (
            <div key={k.label} style={{ background: '#111827', border: `1px solid ${k.color}33`,
              borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ color: k.color, marginBottom: 6 }}>{k.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb' }}>{k.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => { trackTab(t); setTab(t); }}
            style={{ background: tab === t ? `${G}22` : '#111827',
              border: `1px solid ${tab === t ? G : '#374151'}`,
              borderRadius: 8, color: tab === t ? G : '#9ca3af',
              padding: '6px 14px', cursor: 'pointer', fontSize: 11, fontWeight: tab === t ? 700 : 400 }}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#4b5563' }}>Cargando datos de efectividad…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#0d1117', color: '#6b7280' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>#</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>
                  {tab === 'marca' ? 'Marca' : tab === 'vendedor' ? 'Vendedor' :
                   tab === 'canal' ? 'Canal' : tab === 'lider' ? 'Líder' : 'Equipo'}
                </th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Órdenes</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, minWidth: 120 }}>MRR / Total</th>
                {tab === 'vendedor' && <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>1a Venta</th>}
                {tab === 'vendedor' && <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Ticket Prom</th>}
                {tab === 'lider'    && <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Equipos</th>}
                {tab === 'equipo'   && <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Líder</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const color = tab === 'marca' ? (MARCA_COLOR[row.nombre] || '#6b7280') : G;
                const val = row.mrr ?? row.total ?? 0;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #0d1117',
                    background: i % 2 === 0 ? '#111827' : '#0f1720' }}>
                    <td style={{ padding: '8px 14px', color: '#4b5563', fontSize: 11 }}>{i+1}</td>
                    <td style={{ padding: '8px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {tab === 'marca' && (
                          <span style={{ width: 10, height: 10, borderRadius: '50%',
                            background: color, display: 'inline-block', flexShrink: 0 }} />
                        )}
                        <span style={{ color: '#f9fafb', fontWeight: 600 }}>{row.nombre || '—'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: '#9ca3af' }}>
                      {row.ordenes.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color, fontWeight: 700, minWidth: 60 }}>{fmt$(val)}</span>
                        <Bar value={val} max={maxMrr} color={color} />
                      </div>
                    </td>
                    {tab === 'vendedor' && (
                      <td style={{ padding: '8px 14px', textAlign: 'right', color: '#a855f7' }}>
                        {row.primera_venta ?? 0}
                      </td>
                    )}
                    {tab === 'vendedor' && (
                      <td style={{ padding: '8px 14px', textAlign: 'right', color: '#6b7280', fontSize: 11 }}>
                        {row.ticket_prom ? fmt$(row.ticket_prom) : '—'}
                      </td>
                    )}
                    {tab === 'lider' && (
                      <td style={{ padding: '8px 14px', color: '#6b7280', fontSize: 10 }}>
                        {(row.equipos || []).join(', ') || '—'}
                      </td>
                    )}
                    {tab === 'equipo' && (
                      <td style={{ padding: '8px 14px', color: '#9ca3af', fontSize: 11 }}>
                        {row.lider || '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#4b5563' }}>
                  Sin registros para los filtros seleccionados.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Tipos de operación */}
      {data && data.por_tipo.length > 0 && (
        <div style={{ marginTop: 20, background: '#111827', border: '1px solid #1f2937',
          borderRadius: 10, padding: 16 }}>
          <p style={{ color: '#6b7280', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: 2, marginBottom: 12 }}>Tipo de operación</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.por_tipo.map(t => (
              <div key={t.nombre} style={{ background: '#0d1117', borderRadius: 8,
                padding: '6px 12px', border: '1px solid #1f2937' }}>
                <span style={{ color: '#9ca3af', fontSize: 11 }}>{t.nombre}</span>
                <span style={{ color: G, fontSize: 11, fontWeight: 700, marginLeft: 8 }}>
                  {t.ordenes}
                </span>
                {t.mrr > 0 && (
                  <span style={{ color: '#4b5563', fontSize: 10, marginLeft: 6 }}>
                    {fmt$(t.mrr)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
