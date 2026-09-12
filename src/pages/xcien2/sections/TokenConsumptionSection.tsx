import { useState, useEffect } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';
import { useTabTrack } from '../../../hooks/useTabTrack';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DailyPoint { day: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; }
interface ProviderStat { provider: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; budget_usd: number; pct_budget: number; }
interface ModelStat { model: string; provider: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; }
interface RecentCall { ts: string; provider: string; model: string; endpoint: string; input_tokens: number; output_tokens: number; cost_usd: number; }

interface Stats {
  period_days: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  by_provider: ProviderStat[];
  by_model: ModelStat[];
  by_endpoint: { endpoint: string; calls: number; cost_usd: number }[];
  daily: DailyPoint[];
  recent: RecentCall[];
}

// ─── Colores por proveedor ────────────────────────────────────────────────────
const PROVIDER_COLORS: Record<string, string> = {
  claude:      '#FF8C42',
  perplexity:  '#6C63FF',
  litellm:     '#00C896',
  ollama:      '#4FC3F7',
  antigravity: '#FFB703',
  unknown:     '#64748b',
};

const PROVIDER_ICONS: Record<string, string> = {
  claude:      '🟠',
  perplexity:  '🔮',
  litellm:     '⚡',
  ollama:      '🦙',
  antigravity: '💎',
  unknown:     '❓',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtK = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(1)}K` : String(n);
const fmtUSD = (n: number) => `$${n.toFixed(4)}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });

// ─── Mini sparkline SVG ───────────────────────────────────────────────────────
function Sparkline({ data, color, width = 120, height = 36 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * (width - 4) + 2;
    const y = height - 2 - ((v / max) * (height - 8));
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <polyline points={`2,${height - 2} ${pts} ${width - 2},${height - 2}`} fill={color} stroke="none" opacity="0.12" />
    </svg>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, spark, theme }: {
  label: string; value: string; sub?: string; color: string;
  spark?: number[]; theme: ThemeConfig;
}) {
  return (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: 14, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 6,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ fontSize: 11, color: theme.dim, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1, letterSpacing: '-1px' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: theme.dim }}>{sub}</div>}
      {spark && (
        <div style={{ position: 'absolute', bottom: 10, right: 12, opacity: 0.7 }}>
          <Sparkline data={spark} color={color} />
        </div>
      )}
    </div>
  );
}

// ─── Budget Bar ───────────────────────────────────────────────────────────────
function BudgetBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.min(pct, 100);
  const barColor = pct > 90 ? '#FF4757' : pct > 70 ? '#FFB703' : color;
  return (
    <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, height: 4, width: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${clamped}%`, background: barColor, borderRadius: 4, transition: 'width 0.8s ease' }} />
    </div>
  );
}

// ─── Mini bar chart ───────────────────────────────────────────────────────────
function DailyChart({ daily, theme }: { daily: DailyPoint[]; theme: ThemeConfig }) {
  const [hov, setHov] = useState<number | null>(null);
  const maxCost = Math.max(...daily.map(d => d.cost_usd), 0.001);
  const last14 = daily.slice(-14);

  if (!last14.length) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: theme.dim, fontSize: 13 }}>
      Aún sin datos — el primer uso de la IA registrará el consumo aquí.
    </div>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
      {last14.map((d, i) => {
        const h = Math.max((d.cost_usd / maxCost) * 64, d.cost_usd > 0 ? 4 : 2);
        const isHov = hov === i;
        return (
          <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'default', position: 'relative' }}
            onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
            {isHov && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                background: '#1e1e1e', border: `1px solid ${theme.border}`, borderRadius: 8,
                padding: '6px 10px', fontSize: 10, color: theme.text, whiteSpace: 'nowrap',
                zIndex: 10, marginBottom: 6,
              }}>
                <div style={{ fontWeight: 700 }}>{d.day}</div>
                <div>{fmtK(d.input_tokens + d.output_tokens)} tokens</div>
                <div style={{ color: '#FF8C42' }}>{fmtUSD(d.cost_usd)}</div>
                <div style={{ color: theme.dim }}>{d.calls} llamadas</div>
              </div>
            )}
            <div style={{
              width: '100%', height: h,
              background: isHov ? '#FF8C42' : d.cost_usd > 0 ? 'rgba(255,140,66,0.5)' : 'rgba(255,255,255,0.06)',
              borderRadius: 3, transition: 'all 0.2s',
            }} />
            <div style={{ fontSize: 8, color: theme.dim, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%', textAlign: 'center' }}>
              {d.day.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Demo data para cuando no hay backend ─────────────────────────────────────
const DEMO_STATS: Stats = {
  period_days: 30,
  calls: 847,
  input_tokens: 1_240_000,
  output_tokens: 380_000,
  total_tokens: 1_620_000,
  cost_usd: 5.47,
  by_provider: [
    { provider: 'claude',      calls: 612, input_tokens: 980_000, output_tokens: 280_000, cost_usd: 3.88, budget_usd: 50, pct_budget: 7.8 },
    { provider: 'antigravity', calls: 145, input_tokens: 210_000, output_tokens: 80_000,  cost_usd: 1.34, budget_usd: 50, pct_budget: 2.7 },
    { provider: 'perplexity',  calls: 68,  input_tokens: 40_000,  output_tokens: 18_000,  cost_usd: 0.20, budget_usd: 20, pct_budget: 1.0 },
    { provider: 'ollama',      calls: 22,  input_tokens: 10_000,  output_tokens: 2_000,   cost_usd: 0.00, budget_usd: 0,  pct_budget: 0 },
  ],
  by_model: [
    { model: 'claude-sonnet-4-6',         provider: 'claude',      calls: 512, input_tokens: 780_000, output_tokens: 210_000, cost_usd: 3.29 },
    { model: 'claude-haiku-4-5-20251001', provider: 'claude',      calls: 100, input_tokens: 200_000, output_tokens: 70_000,  cost_usd: 0.59 },
    { model: 'claude-sonnet-4-6',         provider: 'antigravity', calls: 145, input_tokens: 210_000, output_tokens: 80_000,  cost_usd: 1.34 },
    { model: 'llama-3.1-sonar-large',     provider: 'perplexity',  calls: 68,  input_tokens: 40_000,  output_tokens: 18_000,  cost_usd: 0.20 },
    { model: 'llama3.2',                  provider: 'ollama',      calls: 22,  input_tokens: 10_000,  output_tokens: 2_000,   cost_usd: 0.00 },
  ],
  by_endpoint: [
    { endpoint: '/api/cerebro/chat',   calls: 480, cost_usd: 2.14 },
    { endpoint: '/api/agentes/chat',   calls: 220, cost_usd: 1.80 },
    { endpoint: '/api/agentes/comite', calls: 95,  cost_usd: 1.12 },
    { endpoint: '/api/director/chat',  calls: 52,  cost_usd: 0.41 },
  ],
  daily: Array.from({ length: 14 }, (_, i) => ({
    day: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
    calls: Math.floor(Math.random() * 60 + 10),
    input_tokens: Math.floor(Math.random() * 60000 + 5000),
    output_tokens: Math.floor(Math.random() * 20000 + 2000),
    cost_usd: Math.random() * 0.6 + 0.05,
  })),
  recent: Array.from({ length: 8 }, (_, i) => ({
    ts: new Date(Date.now() - i * 1800000).toISOString(),
    provider: ['claude', 'antigravity', 'perplexity', 'ollama'][i % 4],
    model: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'llama-3.1-sonar-large', 'llama3.2'][i % 4],
    endpoint: ['/api/cerebro/chat', '/api/agentes/chat', '/api/agentes/comite', '/api/director/chat'][i % 4],
    input_tokens: Math.floor(Math.random() * 3000 + 200),
    output_tokens: Math.floor(Math.random() * 1000 + 50),
    cost_usd: Math.random() * 0.05,
  })),
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TokenConsumptionSection({ theme }: { theme: ThemeConfig }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<'overview' | 'providers' | 'models' | 'recent'>('overview');
  const [isDemo, setIsDemo] = useState(false);
  const trackTab = useTabTrack('tokens');

  const load = async (d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/cerebro/usage?days=${d}`);
      if (!res.ok) throw new Error('no data');
      const data = await res.json();
      setStats(data);
      setIsDemo(false);
    } catch {
      setStats(DEMO_STATS);
      setIsDemo(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]);

  const accentColor = '#FF8C42';

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 80, color: theme.dim }}>
      <div style={{ fontSize: 32, marginBottom: 16 }}>📈</div>
      Cargando analytics de consumo...
    </div>
  );

  const s = stats!;
  const dailyCosts = s.daily.map(d => d.cost_usd);
  const totalBudget = s.by_provider.reduce((a, p) => a + p.budget_usd, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `1px solid ${theme.border}`, paddingBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: theme.text, margin: 0 }}>
            📈 Consumo de Tokens AI
          </h2>
          <p style={{ fontSize: 11, color: theme.dim, marginTop: 4 }}>
            Uso en tiempo real · todos los proveedores de IA
            {isDemo && <span style={{ marginLeft: 8, color: '#FFB703', background: '#FFB70315', border: '1px solid #FFB70330', padding: '2px 8px', borderRadius: 20, fontSize: 10 }}>DEMO — conecta el backend para datos reales</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              background: days === d ? accentColor : 'transparent',
              border: `1px solid ${days === d ? accentColor : theme.border}`,
              color: days === d ? '#000' : theme.dim,
              transition: 'all 0.15s',
            }}>
              {d}d
            </button>
          ))}
          <button onClick={() => load(days)} style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim,
          }}>🔄</button>
        </div>
      </div>

      {/* ─── KPI Row ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KpiCard label="Costo total" value={fmtUSD(s.cost_usd)} sub={`de $${totalBudget.toFixed(0)} presupuesto`} color={accentColor} spark={dailyCosts} theme={theme} />
        <KpiCard label="Tokens totales" value={fmtK(s.total_tokens)} sub={`${fmtK(s.input_tokens)} in · ${fmtK(s.output_tokens)} out`} color="#4FC3F7" theme={theme} />
        <KpiCard label="Llamadas" value={fmtK(s.calls)} sub={`en últimos ${s.period_days} días`} color="#00C896" theme={theme} />
        <KpiCard label="Costo/llamada" value={`$${(s.cost_usd / Math.max(s.calls, 1)).toFixed(4)}`} sub="promedio por request" color="#A78BFA" theme={theme} />
      </div>

      {/* ─── Tabs ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${theme.border}`, paddingBottom: 0 }}>
        {([
          { id: 'overview',   label: '📊 Resumen' },
          { id: 'providers',  label: '🔌 Proveedores' },
          { id: 'models',     label: '🤖 Modelos' },
          { id: 'recent',     label: '🕐 Historial' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => { trackTab(t.id); setTab(t.id); }} style={{
            padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: 'transparent', border: 'none', outline: 'none',
            color: tab === t.id ? theme.text : theme.dim,
            borderBottom: `2px solid ${tab === t.id ? accentColor : 'transparent'}`,
            transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Overview tab ────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Daily Chart */}
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 16 }}>Costo diario (USD)</div>
            <DailyChart daily={s.daily} theme={theme} />
          </div>

          {/* By Endpoint */}
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 16 }}>Top endpoints por llamadas</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {s.by_endpoint.map(ep => {
                const maxCalls = Math.max(...s.by_endpoint.map(e => e.calls), 1);
                const pct = (ep.calls / maxCalls) * 100;
                return (
                  <div key={ep.endpoint} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: theme.dim, width: 200, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ep.endpoint}
                    </div>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: accentColor, borderRadius: 4, transition: 'width 0.8s ease', opacity: 0.8 }} />
                    </div>
                    <div style={{ fontSize: 11, color: theme.text, width: 40, textAlign: 'right', flexShrink: 0 }}>{ep.calls}</div>
                    <div style={{ fontSize: 11, color: theme.dim, width: 52, textAlign: 'right', flexShrink: 0 }}>{fmtUSD(ep.cost_usd)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Providers tab ───────────────────────────────────────────────── */}
      {tab === 'providers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          {s.by_provider.map(p => {
            const color = PROVIDER_COLORS[p.provider] || '#64748b';
            const icon  = PROVIDER_ICONS[p.provider]  || '❓';
            return (
              <div key={p.provider} style={{
                background: theme.card, border: `1px solid ${theme.border}`,
                borderRadius: 14, padding: '18px 20px',
                borderLeft: `3px solid ${color}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{icon} <span style={{ fontSize: 14, fontWeight: 800, color: theme.text }}>{p.provider}</span></div>
                    <div style={{ fontSize: 11, color: theme.dim }}>{p.calls} llamadas · {fmtK(p.input_tokens + p.output_tokens)} tokens</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color }}>{fmtUSD(p.cost_usd)}</div>
                    {p.budget_usd > 0 && <div style={{ fontSize: 10, color: theme.dim }}>de ${p.budget_usd}/mes</div>}
                  </div>
                </div>
                {p.budget_usd > 0 && (
                  <>
                    <BudgetBar pct={p.pct_budget} color={color} />
                    <div style={{ fontSize: 10, color: theme.dim, marginTop: 4, textAlign: 'right' }}>
                      {p.pct_budget}% del presupuesto mensual
                    </div>
                  </>
                )}
                {p.budget_usd === 0 && (
                  <div style={{ fontSize: 10, color: '#00C896', marginTop: 8 }}>✓ Proveedor local — sin costo de API</div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{fmtK(p.input_tokens)}</div>
                    <div style={{ fontSize: 9, color: theme.dim, marginTop: 2 }}>tokens entrada</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{fmtK(p.output_tokens)}</div>
                    <div style={{ fontSize: 9, color: theme.dim, marginTop: 2 }}>tokens salida</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Models tab ──────────────────────────────────────────────────── */}
      {tab === 'models' && (
        <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                {['Modelo', 'Proveedor', 'Llamadas', 'Tokens entrada', 'Tokens salida', 'Costo USD'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 10, color: theme.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${theme.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.by_model.map((m, i) => {
                const color = PROVIDER_COLORS[m.provider] || '#64748b';
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}>
                    <td style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>{m.model}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}15`, border: `1px solid ${color}30`, padding: '2px 8px', borderRadius: 20 }}>
                        {PROVIDER_ICONS[m.provider]} {m.provider}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: theme.text }}>{m.calls}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#4FC3F7' }}>{fmtK(m.input_tokens)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#A78BFA' }}>{fmtK(m.output_tokens)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: m.cost_usd > 0 ? accentColor : '#00C896' }}>
                      {m.cost_usd === 0 ? 'Gratis' : fmtUSD(m.cost_usd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Recent tab ──────────────────────────────────────────────────── */}
      {tab === 'recent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.recent.map((r, i) => {
            const color = PROVIDER_COLORS[r.provider] || '#64748b';
            const icon  = PROVIDER_ICONS[r.provider]  || '❓';
            return (
              <div key={i} style={{
                background: theme.card, border: `1px solid ${theme.border}`,
                borderRadius: 10, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{ fontSize: 18, flexShrink: 0 }}>{icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: theme.dim, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.endpoint}
                  </div>
                  <div style={{ fontSize: 12, color: theme.text }}>{r.model}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: '#4FC3F7' }}>{fmtK(r.input_tokens)} in</div>
                  <div style={{ fontSize: 12, color: '#A78BFA' }}>{fmtK(r.output_tokens)} out</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 60 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: r.cost_usd > 0 ? accentColor : '#00C896' }}>
                    {r.cost_usd === 0 ? '$0' : fmtUSD(r.cost_usd)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 80 }}>
                  <div style={{ fontSize: 10, color: theme.dim }}>{fmtDate(r.ts)}</div>
                  <span style={{ fontSize: 9, fontWeight: 700, color, background: `${color}15`, border: `1px solid ${color}30`, padding: '1px 6px', borderRadius: 10 }}>
                    {r.provider}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
