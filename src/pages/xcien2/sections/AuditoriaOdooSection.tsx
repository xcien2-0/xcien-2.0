import React, { useState, useEffect } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';

interface AuditData {
  resumen: {
    sin_movimiento_2y: number;
    ordenes_pendientes_factura: number;
    socios_duplicados: number;
    equipos_sin_serie: number;
    productos_sin_categoria: number;
  };
  productos_sin_movimiento: { producto: string; cantidad: number; ubicacion: string; desde: string }[];
  ordenes_sin_factura: { orden: string; cliente: string; monto: number; fecha: string; estado_factura: string }[];
  socios_duplicados: { email: string; nombres: string[] }[];
  equipos_sin_numero_serie: { lote: string; producto: string; cantidad: number; referencia: string }[];
  productos_sin_categoria: { nombre: string; precio: number; tipo: string; codigo: string }[];
  total_productos?: number;
  error_productos?: string;
  error_ordenes?: string;
  error_socios?: string;
  error_equipos?: string;
  error_productos_cat?: string;
}

type Tab = 'resumen' | 'stock' | 'ordenes' | 'socios' | 'equipos' | 'catalogo';

const TABS: { id: Tab; label: string; resumenKey?: keyof AuditData['resumen']; bad?: boolean }[] = [
  { id: 'resumen',   label: '📊 Resumen' },
  { id: 'stock',     label: '📦 Stock Muerto',    resumenKey: 'sin_movimiento_2y' },
  { id: 'ordenes',   label: '💸 Órdenes s/Factura', resumenKey: 'ordenes_pendientes_factura', bad: true },
  { id: 'socios',    label: '👥 Socios Duplicados', resumenKey: 'socios_duplicados' },
  { id: 'equipos',   label: '🔧 Equipos sin Serie', resumenKey: 'equipos_sin_serie' },
  { id: 'catalogo',  label: '🏷️ Catálogo',          resumenKey: 'productos_sin_categoria' },
];

export default function AuditoriaOdooSection({ theme }: { theme: ThemeConfig }) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/odoo/audit`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const card = (label: string, value: number | string, color: string, sub?: string) => (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderTop: `3px solid ${color}`,
      borderRadius: 8, padding: '14px 18px', minWidth: 140, flex: 1,
    }}>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12, color: theme.text, fontWeight: 600, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const th = (t: string) => (
    <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700,
      color: theme.dim, textTransform: 'uppercase', letterSpacing: '.05em',
      background: theme.card, borderBottom: `1px solid ${theme.border}` }}>{t}</th>
  );
  const td = (t: React.ReactNode, mono = false) => (
    <td style={{ padding: '7px 10px', fontSize: 12, color: theme.text,
      fontFamily: mono ? 'monospace' : undefined, borderBottom: `1px solid ${theme.border}` }}>{t}</td>
  );

  const badge = (text: string, color: string) => (
    <span style={{ background: `${color}22`, color, border: `1px solid ${color}55`,
      borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{text}</span>
  );

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: 300, color: theme.dim, gap: 12 }}>
      <div style={{ fontSize: 32 }}>🔍</div>
      <div style={{ fontSize: 14 }}>Analizando datos en Odoo wispi19…</div>
      <div style={{ fontSize: 12 }}>Esto puede tardar 15–30 segundos</div>
    </div>
  );

  if (error || !data) return (
    <div style={{ padding: 24, color: '#EF4444' }}>
      No se pudo conectar con Odoo: {error || 'sin respuesta del servidor'}
    </div>
  );

  const r = data.resumen;
  const totalProblemas = r.sin_movimiento_2y + r.ordenes_pendientes_factura +
    r.socios_duplicados + r.equipos_sin_serie + r.productos_sin_categoria;

  return (
    <div style={{ padding: '16px 20px', maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 }}>
              Auditoría de Datos Odoo
            </h2>
            <span style={{ background: 'rgba(234,179,8,0.15)', color: '#EAB308',
              border: '1px solid rgba(234,179,8,0.3)', borderRadius: 4,
              padding: '1px 7px', fontSize: 10, fontWeight: 800, letterSpacing: '.08em' }}>
              CALIDAD
            </span>
          </div>
          <div style={{ fontSize: 12, color: theme.dim, marginTop: 3 }}>
            Fuente: Odoo wispi19 · {new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${theme.border}`, marginBottom: 20 }}>
        {TABS.map(t => {
          const count = t.resumenKey ? r[t.resumenKey] : null;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: active ? 700 : 500,
              color: active ? '#EAB308' : theme.dim,
              background: active ? 'rgba(234,179,8,0.08)' : 'transparent',
              border: 'none', borderBottom: active ? '2px solid #EAB308' : '2px solid transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: -1,
            }}>
              {t.label}
              {count != null && count > 0 && (
                <span style={{ background: t.bad ? '#EF444422' : 'rgba(234,179,8,0.15)',
                  color: t.bad ? '#EF4444' : '#EAB308',
                  borderRadius: 10, padding: '0 6px', fontSize: 10, fontWeight: 800 }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── RESUMEN ──────────────────────────────────────────────────────────── */}
      {tab === 'resumen' && (
        <div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            {card('Stock sin movimiento +2 años', r.sin_movimiento_2y, '#EAB308', 'unidades en bodega')}
            {card('Órdenes sin factura +90d', r.ordenes_pendientes_factura, '#EF4444', 'ingresos en riesgo')}
            {card('Socios duplicados', r.socios_duplicados, '#F97316', 'mismo email')}
            {card('Equipos sin serie', r.equipos_sin_serie, '#8B5CF6', 'lotes sin referencia')}
            {card('Catálogo sin categoría', r.productos_sin_categoria, '#6B7280', 'productos huérfanos')}
          </div>

          <div style={{ background: theme.card, border: `1px solid ${theme.border}`,
            borderLeft: `4px solid ${totalProblemas > 20 ? '#EF4444' : totalProblemas > 5 ? '#F97316' : '#22C55E'}`,
            borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: theme.text, marginBottom: 6 }}>
              {totalProblemas > 20
                ? '🔴 Calidad de datos: CRÍTICA — se requiere limpieza urgente'
                : totalProblemas > 5
                ? '🟡 Calidad de datos: MODERADA — hay elementos a depurar'
                : '🟢 Calidad de datos: BUENA'}
            </div>
            <div style={{ fontSize: 12, color: theme.dim }}>
              {totalProblemas} registros requieren atención · {data.total_productos || 0} productos en catálogo total
            </div>
          </div>

          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {th('Categoría')}{th('Registros')}{th('Impacto')}{th('Acción sugerida')}
              </tr></thead>
              <tbody>
                {[
                  { cat: 'Stock sin movimiento +2 años', n: r.sin_movimiento_2y, imp: 'Espacio + capital muerto', acc: 'Revisar, devolver o dar de baja', color: '#EAB308' },
                  { cat: 'Órdenes sin factura +90d', n: r.ordenes_pendientes_factura, imp: 'Ingresos no facturados', acc: 'Facturar o cancelar orden', color: '#EF4444' },
                  { cat: 'Socios con email duplicado', n: r.socios_duplicados, imp: 'Contactos duplicados', acc: 'Fusionar en Odoo', color: '#F97316' },
                  { cat: 'Equipos sin N° de serie', n: r.equipos_sin_serie, imp: 'Sin trazabilidad', acc: 'Asignar referencia/serie', color: '#8B5CF6' },
                  { cat: 'Productos sin categoría', n: r.productos_sin_categoria, imp: 'Catálogo desordenado', acc: 'Categorizar o archivar', color: '#6B7280' },
                ].map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${theme.bg}44` }}>
                    {td(<span style={{ color: row.color, fontWeight: 600 }}>{row.cat}</span>)}
                    {td(<span style={{ fontWeight: 700, color: row.n > 0 ? row.color : '#22C55E' }}>{row.n}</span>)}
                    {td(row.imp)}
                    {td(row.acc)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── STOCK MUERTO ─────────────────────────────────────────────────────── */}
      {tab === 'stock' && (
        <div>
          <div style={{ marginBottom: 12, color: theme.dim, fontSize: 12 }}>
            Productos con quant en bodega sin movimiento desde hace más de 2 años
          </div>
          {data.error_productos && (
            <div style={{ color: '#EF4444', marginBottom: 8, fontSize: 12 }}>⚠ {data.error_productos}</div>
          )}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto…"
            style={{ width: '100%', padding: '7px 12px', marginBottom: 12, fontSize: 12,
              background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 6,
              color: theme.text, outline: 'none', boxSizing: 'border-box' }} />
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead><tr>{th('Producto')}{th('Cant.')}{th('Ubicación')}{th('Sin movimiento desde')}</tr></thead>
              <tbody>
                {data.productos_sin_movimiento
                  .filter(p => p.producto.toLowerCase().includes(search.toLowerCase()))
                  .map((p, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${theme.bg}44` }}>
                    {td(p.producto, true)}
                    {td(<span style={{ fontWeight: 700, color: '#EAB308' }}>{p.cantidad}</span>)}
                    {td(p.ubicacion)}
                    {td(p.desde?.split(' ')[0] || '—')}
                  </tr>
                ))}
                {data.productos_sin_movimiento.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: '#22C55E', fontSize: 13 }}>
                    ✓ Sin stock muerto detectado
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ÓRDENES SIN FACTURA ───────────────────────────────────────────────── */}
      {tab === 'ordenes' && (
        <div>
          <div style={{ marginBottom: 12, color: theme.dim, fontSize: 12 }}>
            Órdenes de venta confirmadas sin factura emitida en los últimos 90+ días
          </div>
          {data.error_ordenes && (
            <div style={{ color: '#EF4444', marginBottom: 8, fontSize: 12 }}>⚠ {data.error_ordenes}</div>
          )}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar orden o cliente…"
            style={{ width: '100%', padding: '7px 12px', marginBottom: 12, fontSize: 12,
              background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 6,
              color: theme.text, outline: 'none', boxSizing: 'border-box' }} />
          {data.ordenes_sin_factura.length > 0 && (
            <div style={{ background: '#EF444411', border: '1px solid #EF444433', borderRadius: 6,
              padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#EF4444' }}>
              💸 Total en riesgo: ${data.ordenes_sin_factura.reduce((s, o) => s + o.monto, 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
            </div>
          )}
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead><tr>{th('Orden')}{th('Cliente')}{th('Monto')}{th('Fecha orden')}{th('Estado factura')}</tr></thead>
              <tbody>
                {data.ordenes_sin_factura
                  .filter(o => `${o.orden} ${o.cliente}`.toLowerCase().includes(search.toLowerCase()))
                  .map((o, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${theme.bg}44` }}>
                    {td(<span style={{ fontFamily: 'monospace', color: '#EF4444' }}>{o.orden}</span>)}
                    {td(o.cliente)}
                    {td(<span style={{ fontWeight: 700 }}>${o.monto.toLocaleString('es-MX')}</span>)}
                    {td(o.fecha?.split(' ')[0] || '—')}
                    {td(badge(o.estado_factura, '#F97316'))}
                  </tr>
                ))}
                {data.ordenes_sin_factura.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#22C55E', fontSize: 13 }}>
                    ✓ Todas las órdenes están facturadas
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SOCIOS DUPLICADOS ────────────────────────────────────────────────── */}
      {tab === 'socios' && (
        <div>
          <div style={{ marginBottom: 12, color: theme.dim, fontSize: 12 }}>
            Socios/clientes con el mismo email registrado — posibles duplicados
          </div>
          {data.error_socios && (
            <div style={{ color: '#EF4444', marginBottom: 8, fontSize: 12 }}>⚠ {data.error_socios}</div>
          )}
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{th('Email')}{th('Registros con ese email')}</tr></thead>
              <tbody>
                {data.socios_duplicados.map((s, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${theme.bg}44` }}>
                    {td(<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.email}</span>)}
                    {td(
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {s.nombres.map((n, j) => (
                          <span key={j} style={{ background: `${theme.bg}66`, border: `1px solid ${theme.border}`,
                            borderRadius: 4, padding: '1px 7px', fontSize: 11 }}>{n}</span>
                        ))}
                      </div>
                    )}
                  </tr>
                ))}
                {data.socios_duplicados.length === 0 && (
                  <tr><td colSpan={2} style={{ padding: 20, textAlign: 'center', color: '#22C55E', fontSize: 13 }}>
                    ✓ Sin socios duplicados detectados
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── EQUIPOS SIN SERIE ────────────────────────────────────────────────── */}
      {tab === 'equipos' && (
        <div>
          <div style={{ marginBottom: 12, color: theme.dim, fontSize: 12 }}>
            Lotes de equipos sin número de referencia/serie — sin trazabilidad cliente-sitio
          </div>
          {data.error_equipos && (
            <div style={{ color: '#EF4444', marginBottom: 8, fontSize: 12 }}>⚠ {data.error_equipos}</div>
          )}
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead><tr>{th('Lote')}{th('Producto')}{th('Cantidad')}</tr></thead>
              <tbody>
                {data.equipos_sin_numero_serie.map((e, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${theme.bg}44` }}>
                    {td(<span style={{ fontFamily: 'monospace', color: '#8B5CF6' }}>{e.lote}</span>)}
                    {td(e.producto)}
                    {td(<span style={{ fontWeight: 700 }}>{e.cantidad}</span>)}
                  </tr>
                ))}
                {data.equipos_sin_numero_serie.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: '#22C55E', fontSize: 13 }}>
                    ✓ Todos los equipos tienen referencia asignada
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CATÁLOGO ──────────────────────────────────────────────────────────── */}
      {tab === 'catalogo' && (
        <div>
          <div style={{ marginBottom: 12, color: theme.dim, fontSize: 12 }}>
            Productos activos sin categoría (o en "All/Todos") — catálogo desordenado
          </div>
          {data.error_productos_cat && (
            <div style={{ color: '#EF4444', marginBottom: 8, fontSize: 12 }}>⚠ {data.error_productos_cat}</div>
          )}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto…"
            style={{ width: '100%', padding: '7px 12px', marginBottom: 12, fontSize: 12,
              background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 6,
              color: theme.text, outline: 'none', boxSizing: 'border-box' }} />
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
              <thead><tr>{th('Nombre')}{th('Tipo')}{th('Precio lista')}{th('Código interno')}</tr></thead>
              <tbody>
                {data.productos_sin_categoria
                  .filter(p => p.nombre.toLowerCase().includes(search.toLowerCase()))
                  .slice(0, 200)
                  .map((p, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${theme.bg}44` }}>
                    {td(p.nombre)}
                    {td(badge(p.tipo, '#6B7280'))}
                    {td(`$${p.precio.toLocaleString('es-MX')}`)}
                    {td(<span style={{ fontFamily: 'monospace', fontSize: 11, color: theme.dim }}>{p.codigo || '—'}</span>)}
                  </tr>
                ))}
                {data.productos_sin_categoria.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: '#22C55E', fontSize: 13 }}>
                    ✓ Todo el catálogo está categorizado
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
