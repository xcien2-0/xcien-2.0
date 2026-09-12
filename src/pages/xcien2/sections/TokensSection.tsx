import { useState, useEffect } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';

// ── Matrix Background ─────────────────────────────────────────────────────────
function MatrixBackground() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.1, pointerEvents: 'none', zIndex: 0 }}>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'grid', gridTemplateColumns: 'repeat(30, 1fr)',
        fontFamily: 'monospace', fontSize: 12, color: '#00ff88', textShadow: '0 0 8px #00ff88',
        whiteSpace: 'nowrap', userSelect: 'none'
      }}>
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} style={{ 
            animation: `matrixFall ${15 + Math.random() * 25}s linear infinite`,
            animationDelay: `${-Math.random() * 25}s`,
            writingMode: 'vertical-rl',
            textAlign: 'center'
          }}>
            {Array.from({ length: 60 }).map(() => Math.random() > 0.5 ? '1' : '0').join(' ')}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes matrixFall {
          from { transform: translateY(-100%); }
          to { transform: translateY(100%); }
        }
      `}</style>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Token {
  token_id: string;
  tipo: string;
  empresa: string;
  nombre?: string;
  detalle?: string;
  oportunidad_id?: string;
  cliente?: string;
  vendedor?: string;
  tecnico?: string;
  agente?: string;
  nivel?: string;
  score?: number;
  monto?: number;
  extra?: Record<string, any>;
  emitido_en: string;
  firma: string;
}

const DEMO_TOKENS: Token[] = [
  { token_id: "a1b2c3d4-0001", tipo: "alta", empresa: "empresa_a", nombre: "Juan Pérez", detalle: "Ingreso como Especialista de Red", emitido_en: "2026-04-26T10:00:00Z", firma: "demo" },
  { token_id: "a1b2c3d4-0002", tipo: "promocion", empresa: "luminet", nombre: "Ana Rodríguez", detalle: "Ascenso a Gerencia de Operaciones", emitido_en: "2026-04-25T14:30:00Z", firma: "demo" },
];

const TIPO_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  oportunidad_ganada: { label: 'Oportunidad ganada',    icon: '💼', color: '#00C896' },
  certificacion:      { label: 'Certificación',         icon: '🎓', color: '#534AB7' },
  promocion:          { label: 'Promoción',             icon: '⬆️', color: '#FFB703' },
  bono:               { label: 'Bono de desempeño',     icon: '🏆', color: '#FF6B35' },
  agente_ia:          { label: 'Acción agente IA',      icon: '🤖', color: '#4FC3F7' },
  alta:               { label: 'Alta de personal',      icon: '👤', color: '#00C896' },
  baja:               { label: 'Baja de personal',      icon: '📋', color: '#FF4757' },
  movimiento:         { label: 'Movimiento lateral',    icon: '↔️', color: '#60A5FA' },
  cambio_area:        { label: 'Cambio de área',        icon: '🏢', color: '#A78BFA' },
};

const EMPRESA_COLOR: Record<string, string> = {
  empresa_a: '#00C896',
  luminet:   '#4FC3F7',
  empresa_b: '#FFB703',
  huus:      '#FF6B35',
};

const EMPRESAS = ['todas', 'empresa_a', 'luminet', 'empresa_b', 'huus'];
const TIPOS    = ['todos', ...Object.keys(TIPO_CONFIG)];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getTitular(t: Token): string {
  return t.nombre || t.tecnico || t.vendedor || t.agente || t.cliente || '—';
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function KpiCard({ label, value, color, theme }: { label: string; value: number | string; color: string; theme: ThemeConfig }) {
  return (
    <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: theme.radius, padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: theme.dim, marginTop: 6 }}>{label}</div>
    </div>
  );
}

function TokenCard({ token, theme }: { token: Token; theme: ThemeConfig }) {
  const cfg = TIPO_CONFIG[token.tipo] || { label: token.tipo, icon: '🔖', color: '#94a3b8' };
  const empColor = EMPRESA_COLOR[token.empresa] || '#94a3b8';

  return (
    <div style={{
      background: theme.card,
      border: `1px solid ${theme.border}`,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: theme.radius,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16 }}>{cfg.icon}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
          background: `${empColor}18`, color: empColor, border: `1px solid ${empColor}30`,
          textTransform: 'uppercase',
        }}>
          {token.empresa}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
        {getTitular(token)}
      </div>
      <div style={{ fontSize: 11, color: theme.dim }}>
        {token.detalle || token.extra?.motivo || token.extra?.accion || '—'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: theme.dim, background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: 4 }}>
          #{shortId(token.token_id)}
        </span>
        <span style={{ fontSize: 10, color: theme.dim }}>{formatDate(token.emitido_en)}</span>
      </div>
    </div>
  );
}

export default function TokensSection({ theme, activeThemeId }: { theme: ThemeConfig, activeThemeId?: string }) {
  const [tokens, setTokens]           = useState<Token[]>([]);
  const [loading, setLoading]         = useState(true);
  const [empresaFiltro, setEmpresa]   = useState('todas');
  const [tipoFiltro, setTipo]         = useState('todos');
  const [backendOnline, setOnline]    = useState(false);
  const [showForm, setShowForm]       = useState(false);
  const [formData, setFormData]       = useState({ tipo: 'alta', nombre: '', detalle: '', empresa: 'empresa_a' });
  const [tokenErr, setTokenErr]       = useState('');
  const showErr = (m: string) => { setTokenErr(m); setTimeout(() => setTokenErr(''), 4000); };

  const loadTokens = () => {
    fetch(`${API_BASE}/api/tokens`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) { setTokens(data); setOnline(true); }
        else { setTokens(DEMO_TOKENS); setOnline(false); }
      })
      .catch(() => { setTokens(DEMO_TOKENS); setOnline(false); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTokens(); }, []);

  const handleGenerate = async () => {
    if (!formData.nombre) return;
    try {
      const res = await fetch(`${API_BASE}/api/tokens/operativo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setShowForm(false);
        setFormData({ tipo: 'alta', nombre: '', detalle: '', empresa: 'empresa_a' });
        loadTokens();
      }
    } catch (e) { showErr("✗ No se pudo generar el token. Intenta de nuevo."); }
  };

  const filtrados = tokens.filter(t => {
    const okEmpresa = empresaFiltro === 'todas' || t.empresa === empresaFiltro;
    const okTipo    = tipoFiltro === 'todos'    || t.tipo === tipoFiltro;
    return okEmpresa && okTipo;
  });

  const accent = theme.accent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'relative' }}>
      {activeThemeId === 'matrix' && <MatrixBackground />}
      {tokenErr && <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '10px 18px', borderRadius: 10, background: '#FF475722', border: '1px solid #FF4757', color: '#FF4757', fontSize: 13, fontWeight: 600 }}>{tokenErr}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Registro de Tokens</h2>
          <p style={{ fontSize: 12, color: theme.dim, margin: 0 }}>Cripto-validación de procesos operativos y RH</p>
        </div>
        <button 
          onClick={() => setShowForm(!showForm)}
          style={{
            background: accent, color: '#000', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer'
          }}
        >
          {showForm ? '✕ Cancelar' : '+ Generar Token Operativo'}
        </button>
      </div>

      {showForm && (
        <div style={{ background: theme.card, border: `2px solid ${accent}`, borderRadius: 12, padding: 20, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 11, color: theme.dim, marginBottom: 4 }}>Nombre del Colaborador</label>
            <input 
              value={formData.nombre} 
              onChange={e => setFormData({...formData, nombre: e.target.value})}
              style={{ width: '100%', background: '#000', border: `1px solid ${theme.border}`, padding: 8, borderRadius: 6, color: '#fff' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 11, color: theme.dim, marginBottom: 4 }}>Tipo de Movimiento</label>
            <select 
              value={formData.tipo}
              onChange={e => setFormData({...formData, tipo: e.target.value})}
              style={{ width: '100%', background: '#000', border: `1px solid ${theme.border}`, padding: 8, borderRadius: 6, color: '#fff' }}
            >
              <option value="alta">Alta de personal</option>
              <option value="baja">Baja de personal</option>
              <option value="movimiento">Movimiento lateral</option>
              <option value="promocion">Promoción</option>
              <option value="cambio_area">Cambio de área</option>
            </select>
          </div>
          <div style={{ flex: 2, minWidth: 300 }}>
            <label style={{ display: 'block', fontSize: 11, color: theme.dim, marginBottom: 4 }}>Detalle / Motivo</label>
            <input 
              value={formData.detalle} 
              onChange={e => setFormData({...formData, detalle: e.target.value})}
              style={{ width: '100%', background: '#000', border: `1px solid ${theme.border}`, padding: 8, borderRadius: 6, color: '#fff' }}
              placeholder="Ej: Ascenso a Senior, Cambio a zona Monterrey, etc."
            />
          </div>
          <button 
            onClick={handleGenerate}
            style={{ alignSelf: 'flex-end', background: '#00C896', color: '#000', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}
          >
            Emitir Token Criptográfico
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <KpiCard label="Total" value={tokens.length} color={accent} theme={theme} />
        <KpiCard label="Operativos" value={tokens.filter(t => ['alta','baja','movimiento','promocion','cambio_area'].includes(t.tipo)).length} color="#00C896" theme={theme} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {filtrados.slice().reverse().map(t => (
          <TokenCard key={t.token_id} token={t} theme={theme} />
        ))}
      </div>
    </div>
  );
}
