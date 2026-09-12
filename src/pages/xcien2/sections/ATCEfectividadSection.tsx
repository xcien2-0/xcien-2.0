// ATCEfectividadSection — métricas de efectividad del equipo ATC/CAST
import React, { useEffect, useState, useCallback } from 'react';
import { API_BASE } from '../../../config';
import { ThemeConfig } from '../types';

const G   = '#2d7a4f';
const GD  = '#1a4a2e';
const GB  = '#eef4ee';
const TX  = '#111827';
const DM  = '#6b7280';
const SF  = '#ffffff';
const GN  = '#16a34a';
const AM  = '#d97706';
const RD  = '#dc2626';
const BL  = '#2563eb';
const SH  = '0 1px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)';

interface Agente {
  nombre: string;
  total: number;
  cerrados: number;
  reincidentes: number;
  resolucion_pct: number;
  tiempo_prom_h: number | null;
  hoy: number;
  semana: number;
}

interface Resumen {
  total: number;
  cerrados: number;
  abiertos: number;
  reincidentes: number;
  resolucion_pct: number;
  tiempo_prom_h: number | null;
  hoy: number;
  semana: number;
}

interface Data {
  periodo_dias: number;
  resumen: Resumen;
  agentes: Agente[];
}

function pctColor(pct: number) {
  if (pct >= 90) return GN;
  if (pct >= 70) return AM;
  return RD;
}

function tiempoLabel(h: number | null) {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ width: '100%', height: 6, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .4s' }} />
    </div>
  );
}

const PERIODOS = [
  { label: '1 día',   val: 1  },
  { label: '7 días',  val: 7  },
  { label: '30 días', val: 30 },
  { label: '90 días', val: 90 },
];

export default function ATCEfectividadSection({ theme: _theme }: { theme: ThemeConfig }) {
  const [data,    setData]    = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [dias,    setDias]    = useState(1);

  const cargar = useCallback(async (d: number) => {
    setLoading(true); setError('');
    try {
      const tok = localStorage.getItem('xcien_token') ?? '';
      const r = await fetch(`${API_BASE}/api/atc/efectividad?dias=${d}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setData(json && typeof json === 'object' && !Array.isArray(json) ? json as Data : null);
    } catch (e: any) {
      setError(e.message ?? 'No se pudieron cargar los datos de efectividad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(dias); }, [cargar, dias]);

  const res = data?.resumen;
  const agentes = data?.agentes ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${GD} 0%, ${G} 100%)`,
        borderRadius: 14, padding: '20px 24px', color: SF,
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 32 }}>📞</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
            color: 'rgba(255,255,255,.55)', marginBottom: 3 }}>XCIEN 2.0 · CAST</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Efectividad Equipo ATC</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
            {agentes.length} agentes activos · datos en tiempo real desde Odoo
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PERIODOS.map(p => (
            <button key={p.val} onClick={() => setDias(p.val)} style={{
              padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              background: dias === p.val ? SF : 'rgba(255,255,255,.15)',
              color: dias === p.val ? GD : SF,
              border: `1px solid ${dias === p.val ? SF : 'rgba(255,255,255,.3)'}`,
              cursor: 'pointer',
            }}>{p.label}</button>
          ))}
          <button onClick={() => cargar(dias)} style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)',
            color: SF, cursor: 'pointer',
          }}>↻</button>
        </div>
      </div>

      {/* KPIs globales */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: DM, fontSize: 13 }}>
          Cargando métricas desde Odoo…
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 48, color: RD, fontSize: 13 }}>{error}</div>
      ) : res && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'Total tickets',     val: res.total,      color: BL,  icon: '🎫', sub: `${res.hoy} hoy · ${res.semana} esta semana` },
              { label: 'Cerrados',          val: res.cerrados,   color: GN,  icon: '✅', sub: `${res.abiertos} abiertos` },
              { label: '% Resolución',      val: `${res.resolucion_pct}%`, color: pctColor(res.resolucion_pct), icon: '📊', sub: `últimos ${dias} días` },
              { label: 'Tiempo prom.',      val: tiempoLabel(res.tiempo_prom_h), color: AM, icon: '⏱', sub: 'por ticket cerrado' },
            ].map(k => (
              <div key={k.label} style={{
                background: SF, borderRadius: 12, padding: '16px 18px',
                boxShadow: SH, borderTop: `3px solid ${k.color}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ fontSize: 22 }}>{k.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: k.color, fontVariantNumeric: 'tabular-nums' }}>
                    {k.val}
                  </div>
                  <div style={{ fontSize: 10, color: DM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {k.label}
                  </div>
                  <div style={{ fontSize: 10, color: DM, marginTop: 2 }}>{k.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Reincidentes aviso */}
          {res.reincidentes > 0 && (
            <div style={{
              background: '#fef3c7', borderRadius: 10, padding: '10px 16px',
              border: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>
                {res.reincidentes} ticket{res.reincidentes !== 1 ? 's' : ''} marcado{res.reincidentes !== 1 ? 's' : ''} como
                <strong> Reincidente</strong> en el período — clientes con falla recurrente.
              </span>
            </div>
          )}

          {/* Tabla por agente */}
          <div style={{ background: SF, borderRadius: 14, boxShadow: SH, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: TX }}>Rendimiento por agente</span>
              <span style={{
                fontSize: 10, fontWeight: 700, background: GB, color: G,
                padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase',
              }}>CAST · {dias}d</span>
            </div>

            {/* Encabezados */}
            <div style={{
              display: 'grid', gridTemplateColumns: '2fr 70px 70px 70px 100px 80px 90px',
              padding: '8px 20px', background: '#f9fafb',
              borderBottom: '1px solid #f3f4f6',
            }}>
              {['Agente','Total','Cerrados','Reinc.','% Resolución','T. Prom.','Hoy / Semana'].map(h => (
                <div key={h} style={{ fontSize: 9, fontWeight: 800, color: DM, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {h}
                </div>
              ))}
            </div>

            {agentes.map((ag, i) => {
              const c = pctColor(ag.resolucion_pct);
              return (
                <div key={ag.nombre} style={{
                  display: 'grid', gridTemplateColumns: '2fr 70px 70px 70px 100px 80px 90px',
                  padding: '11px 20px', alignItems: 'center',
                  borderBottom: i < agentes.length - 1 ? '1px solid #f3f4f6' : 'none',
                  background: i % 2 === 0 ? SF : '#fafafa',
                }}>
                  {/* Nombre */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: TX }}>
                      {ag.nombre.split(' ').slice(0,2).join(' ')}
                    </div>
                    <div style={{ fontSize: 10, color: DM }}>
                      {ag.nombre.split(' ').slice(2).join(' ')}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: TX, fontVariantNumeric: 'tabular-nums' }}>
                    {ag.total}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: GN, fontVariantNumeric: 'tabular-nums' }}>
                    {ag.cerrados}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ag.reincidentes > 0 ? RD : DM, fontVariantNumeric: 'tabular-nums' }}>
                    {ag.reincidentes > 0 ? `⚠️ ${ag.reincidentes}` : '—'}
                  </div>
                  {/* % resolución + barra */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: c, fontVariantNumeric: 'tabular-nums' }}>
                      {ag.resolucion_pct}%
                    </span>
                    <MiniBar pct={ag.resolucion_pct} color={c} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: DM }}>
                    {tiempoLabel(ag.tiempo_prom_h)}
                  </div>
                  <div style={{ fontSize: 11, color: DM, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: ag.hoy > 0 ? GN : DM, fontWeight: 700 }}>{ag.hoy}</span>
                    <span style={{ color: DM }}> / {ag.semana}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Leyenda */}
          <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {[
              { color: GN, label: '≥ 90% resolución' },
              { color: AM, label: '70–89%' },
              { color: RD, label: '< 70%' },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
                <span style={{ fontSize: 10, color: DM }}>{l.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
