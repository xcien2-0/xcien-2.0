import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '@/config';
import { ThemeConfig } from '../types';

interface Muni {
  municipio: string; estado: string; total: number;
  fallas: number; hab: number; mediana: number;
  lat: number | null; lon: number | null;
}
interface Tec {
  tecnico: string; total: number; fallas: number;
  hab: number; mediana: number; plazas: string[];
}
interface BacklogData {
  total: number; fallas: number; hab: number; mediana_dias: number;
  municipios: Muni[]; tecnicos: Tec[];
  updated_at: string; cached: boolean;
}

interface Props { theme: ThemeConfig }

function medColor(d: number): string {
  if (d > 90) return '#e84545';
  if (d > 30) return '#f0a050';
  return '#00c4b3';
}

function KPI({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10, padding: '14px 18px', flex: 1, minWidth: 110,
    }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: color ?? '#e2e8f0', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  );
}

export default function BacklogSection({ theme }: Props) {
  const [data, setData] = useState<BacklogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'municipios' | 'tecnicos'>('municipios');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      setError('');
      const res = await fetch(`${API_BASE}/api/backlog/ops${force ? '?force=true' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setError(e.message ?? 'Error de conexión');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const forceRefresh = async () => {
    setRefreshing(true);
    await load(true);
  };

  const T = {
    bg:     theme.bg,
    surf:   theme.card,
    border: theme.border,
    text:   theme.text,
    dim:    theme.dim,
    acc:    theme.accent,
  };

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 10, color: T.dim, fontSize: 13 }}>
      <div style={{ width: 14, height: 14, border: `2px solid ${T.acc}`, borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Cargando backlog desde Odoo…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 12, color: '#e84545' }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ fontWeight: 700 }}>Error cargando backlog</div>
      <div style={{ fontSize: 12, color: T.dim }}>{error}</div>
      <button onClick={() => load()} style={{
        padding: '8px 20px', borderRadius: 8, background: T.acc,
        color: '#000', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 13,
      }}>Reintentar</button>
    </div>
  );

  if (!data) return null;

  const maxTotal = Math.max(...data.municipios.map(m => m.total), 1);
  const maxTec   = Math.max(...data.tecnicos.map(t => t.total), 1);

  const updatedAt = new Date(data.updated_at);
  const horasAtras = Math.round((Date.now() - updatedAt.getTime()) / 3_600_000);
  const updLabel = horasAtras < 1 ? 'hace menos de 1h'
    : horasAtras < 24 ? `hace ${horasAtras}h`
    : `hace ${Math.floor(horasAtras / 24)}d`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>
            Backlog Operativo
          </h2>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 2 }}>
            Fallas + Habilitaciones activas · Odoo wispi19
            {data.cached && (
              <span style={{ marginLeft: 8, color: '#f0a050' }}>· caché ({updLabel})</span>
            )}
            {!data.cached && (
              <span style={{ marginLeft: 8, color: '#00c4b3' }}>· actualizado ahora</span>
            )}
          </div>
        </div>
        <button onClick={forceRefresh} disabled={refreshing}
          style={{
            padding: '7px 16px', borderRadius: 8, border: `1px solid ${T.border}`,
            background: 'rgba(255,255,255,0.04)', color: T.dim, cursor: 'pointer',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
          }}>
          {refreshing ? (
            <span style={{ display: 'inline-block', width: 11, height: 11, border: `2px solid ${T.acc}`,
              borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          ) : '↻'} Actualizar
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label="tickets activos" value={data.total} />
        <KPI label="fallas" value={data.fallas} color="#00c4b3" />
        <KPI label="habilitaciones" value={data.hab} color="#f0a050" />
        <KPI label="mediana de días" value={`${data.mediana_dias}d`} color={medColor(data.mediana_dias)}
          sub={data.mediana_dias > 90 ? 'crítico' : data.mediana_dias > 30 ? 'atención' : 'ok'} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.border}`, paddingBottom: 0 }}>
        {(['municipios', 'tecnicos'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '7px 18px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: tab === t ? 700 : 400,
            color: tab === t ? T.acc : T.dim,
            borderBottom: tab === t ? `2px solid ${T.acc}` : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t === 'municipios' ? 'Por municipio' : 'Por técnico'}
          </button>
        ))}
      </div>

      {/* Tabla municipios */}
      {tab === 'municipios' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 10,
          border: `1px solid ${T.border}`, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 60px 60px 60px 80px 2fr',
            gap: 0, padding: '8px 16px',
            background: 'rgba(255,255,255,0.04)', fontSize: 11, fontWeight: 700,
            color: T.dim, letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            <span>Municipio</span>
            <span style={{ textAlign: 'right' }}>Total</span>
            <span style={{ textAlign: 'right' }}>Fallas</span>
            <span style={{ textAlign: 'right' }}>Hab</span>
            <span style={{ textAlign: 'right' }}>Mediana</span>
            <span style={{ paddingLeft: 12 }}>Distribución</span>
          </div>

          {data.municipios.map((m, i) => (
            <div key={m.municipio} style={{
              display: 'grid', gridTemplateColumns: '2fr 60px 60px 60px 80px 2fr',
              gap: 0, padding: '10px 16px', alignItems: 'center',
              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
              borderTop: `1px solid ${T.border}`,
            }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{m.municipio}</span>
                <span style={{ fontSize: 10, color: T.dim, marginLeft: 6 }}>{m.estado}</span>
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700, color: T.text, fontSize: 14,
                fontVariantNumeric: 'tabular-nums' }}>{m.total}</div>
              <div style={{ textAlign: 'right', color: '#00c4b3', fontSize: 13,
                fontVariantNumeric: 'tabular-nums' }}>{m.fallas}</div>
              <div style={{ textAlign: 'right', color: '#f0a050', fontSize: 13,
                fontVariantNumeric: 'tabular-nums' }}>{m.hab}</div>
              <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700,
                color: medColor(m.mediana), fontVariantNumeric: 'tabular-nums' }}>
                {m.mediana}d
              </div>
              <div style={{ paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                {m.total > 0 && (
                  <>
                    <div style={{ height: 8, borderRadius: 2, background: '#00c4b3',
                      width: `${(m.fallas / maxTotal) * 140}px`, minWidth: m.fallas > 0 ? 3 : 0,
                      transition: 'width 0.4s' }} />
                    <div style={{ height: 8, borderRadius: 2, background: '#f0a050',
                      width: `${(m.hab / maxTotal) * 140}px`, minWidth: m.hab > 0 ? 3 : 0,
                      transition: 'width 0.4s' }} />
                  </>
                )}
              </div>
            </div>
          ))}

          {data.municipios.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: T.dim, fontSize: 13 }}>
              Sin tickets activos
            </div>
          )}
        </div>
      )}

      {/* Tabla técnicos */}
      {tab === 'tecnicos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 10,
          border: `1px solid ${T.border}`, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 60px 60px 60px 80px 1fr 2fr',
            gap: 0, padding: '8px 16px',
            background: 'rgba(255,255,255,0.04)', fontSize: 11, fontWeight: 700,
            color: T.dim, letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            <span>Técnico</span>
            <span style={{ textAlign: 'right' }}>Total</span>
            <span style={{ textAlign: 'right' }}>Fallas</span>
            <span style={{ textAlign: 'right' }}>Hab</span>
            <span style={{ textAlign: 'right' }}>Mediana</span>
            <span style={{ paddingLeft: 8 }}>Plazas</span>
            <span style={{ paddingLeft: 12 }}>Carga</span>
          </div>

          {data.tecnicos.map((t, i) => (
            <div key={t.tecnico} style={{
              display: 'grid', gridTemplateColumns: '2fr 60px 60px 60px 80px 1fr 2fr',
              gap: 0, padding: '10px 16px', alignItems: 'center',
              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
              borderTop: `1px solid ${T.border}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: t.tecnico === 'Sin asignar' ? 400 : 600,
                color: t.tecnico === 'Sin asignar' ? T.dim : T.text,
                fontStyle: t.tecnico === 'Sin asignar' ? 'italic' : 'normal' }}>
                {t.tecnico}
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700, color: T.text, fontSize: 14,
                fontVariantNumeric: 'tabular-nums' }}>{t.total}</div>
              <div style={{ textAlign: 'right', color: '#00c4b3', fontSize: 13,
                fontVariantNumeric: 'tabular-nums' }}>{t.fallas}</div>
              <div style={{ textAlign: 'right', color: '#f0a050', fontSize: 13,
                fontVariantNumeric: 'tabular-nums' }}>{t.hab}</div>
              <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700,
                color: medColor(t.mediana), fontVariantNumeric: 'tabular-nums' }}>
                {t.mediana}d
              </div>
              <div style={{ paddingLeft: 8, fontSize: 10, color: T.dim }}>
                {t.plazas.join(' · ') || '—'}
              </div>
              <div style={{ paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Bar pct={(t.total / maxTec) * 100} color={medColor(t.mediana)} />
              </div>
            </div>
          ))}

          {data.tecnicos.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: T.dim, fontSize: 13 }}>
              Sin técnicos con tickets activos
            </div>
          )}
        </div>
      )}

      {/* Leyenda mediana */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: T.dim }}>
        {[['#00c4b3', '< 30 días — OK'], ['#f0a050', '30–90 días — Atención'], ['#e84545', '> 90 días — Crítico']].map(([c, l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
