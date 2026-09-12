import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import type { ThemeConfig } from '../types';

interface Props { theme: ThemeConfig }

// ─── Types ────────────────────────────────────────────────────────────────────

interface PowerMetrics {
  batteryVoltage: number | null;
  acOutputVoltage: number | null;
  mainsVoltage: number | null;
  mainsPresent: boolean | null;
  loadPower: number | null;
  batteryRuntimeMinutes: number | null;
  batterySOC: number | null;
  timestamp: string | null;
}

interface PowerDevice {
  name: string; ip: string; city: string; site: string; status: string;
  type: string; vendor: string; healthScore: number;
  ping: { reachable: boolean; latency: number; packetLoss: number };
  hasMetrics: boolean;
  metrics?: PowerMetrics;
}

interface RadioBase {
  idx: number;
  name: string;
  estatus: string;
  vigencia: string;
  direccion: string;
  city: string;
  state: string;
  renta: string;
  lat: number | null;
  lng: number | null;
  // Parsed by backend
  renta_mxn: number | null;
  renta_incluye_iva: boolean;
  // Overlay (editable)
  estado_op: 'operativa' | 'degradada' | 'en_mantenimiento' | 'sin_info';
  notas: string;
  ultima_visita: string;
  // Enrichment
  fuente?: string;
  clientes?: number | null;
  odoo_id?: number | null;
  odoo_estado?: string | null;
  nyx_data?: { nombre: string; raw: Record<string, string> } | null;
}

interface HistorialEntry {
  ts: string;
  site_name: string;
  user_nombre: string;
  user_email: string;
  cambios: Record<string, { de: unknown; a: unknown }>;
}

interface RadioBasesData {
  radiobases: RadioBase[];
  historial: HistorialEntry[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ESTADO_OP_OPTS = [
  { value: 'operativa',        label: '🟢 Operativa' },
  { value: 'degradada',        label: '🟠 Degradada' },
  { value: 'en_mantenimiento', label: '🔵 Mantenimiento' },
  { value: 'sin_info',         label: '⚪ Sin info' },
];

const ESTADO_OP_CFG: Record<string, { label: string; color: string }> = {
  operativa:        { label: 'Operativa',     color: '#00C896' },
  degradada:        { label: 'Degradada',     color: '#FFB703' },
  en_mantenimiento: { label: 'Mantenimiento', color: '#3B82F6' },
  sin_info:         { label: 'Sin info',      color: '#6b7280' },
};

const ESTATUS_CFG: Record<string, { label: string; color: string }> = {
  'VIGENTE POR CONTRATO': { label: 'Vigente',  color: '#00C896' },
  'VIGENTE':              { label: 'Vigente',  color: '#00C896' },
  'VENCIDO':              { label: 'Vencido',  color: '#FF4757' },
  '':                     { label: 'Sin dato', color: '#6b7280' },
};

function normalizeEstatus(e: string) {
  if (e === 'VIGENTE POR CONTRATO' || e === 'VIGENTE') return 'vigente';
  if (e === 'VENCIDO') return 'vencido';
  return 'sin_dato';
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 12, height: 12,
      border: '2px solid rgba(0,200,150,0.2)', borderTopColor: '#00C896',
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: color + '20', color, border: `1px solid ${color}40`,
      borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function InlineInput({ value, onSave, onCancel, multiline, style }: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  multiline?: boolean;
  style?: React.CSSProperties;
}) {
  const [val, setVal] = useState(value);
  const baseStyle: React.CSSProperties = {
    width: '100%', background: 'transparent', border: 'none',
    borderBottom: '1px solid #00C896', outline: 'none', fontSize: 12,
    color: 'inherit', padding: '2px 0', resize: 'vertical',
    fontFamily: 'inherit',
    ...style,
  };
  if (multiline) {
    return (
      <textarea
        autoFocus
        value={val}
        rows={3}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        onBlur={() => onSave(val)}
        style={baseStyle}
      />
    );
  }
  return (
    <input
      autoFocus
      value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel(); }}
      onBlur={() => onSave(val)}
      style={baseStyle}
    />
  );
}

const PencilIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'inventario' | 'historial';
type EditKey = string;

const TABS: { id: Tab; label: string }[] = [
  { id: 'inventario', label: '📋 Inventario' },
  { id: 'historial',  label: '🕐 Historial' },
];

export default function RadioBasesSection({ theme }: Props) {
  const { user, authFetch } = useAuth();

  const [data, setData] = useState<RadioBasesData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inventario');
  const [powerDevices, setPowerDevices] = useState<PowerDevice[]>([]);
  const [nyxSyncing, setNyxSyncing] = useState(false);
  const [nyxMsg, setNyxMsg] = useState<string | null>(null);

  // List filters
  const [search, setSearch] = useState('');
  const [filterEstatus, setFilterEstatus] = useState<string>('todos');
  const [filterEstadoOp, setFilterEstadoOp] = useState<string>('todos');
  const [listPage, setListPage] = useState(0);
  const LIST_PAGE_SIZE = 50;

  // Selection + editing
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<EditKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const isAdmin = user?.rol === 'admin' || user?.rol === 'director';

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadData = useCallback(() => {
    authFetch('/api/radiobases/data')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: RadioBasesData) => setData(d))
      .catch(() => setLoadError('Error cargando Radio Bases. Verifica tu sesión.'));
    // Load power devices — fire-and-forget with timeout so it never blocks the main list
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 5000);
    authFetch('/api/noc/energia/power', { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.devices && setPowerDevices(d.devices))
      .catch(() => {})
      .finally(() => clearTimeout(tid));
  }, [authFetch]);

  useEffect(() => { loadData(); }, [loadData]);

  const syncNyx = useCallback(async () => {
    setNyxSyncing(true);
    setNyxMsg(null);
    try {
      const r = await authFetch('/api/radiobases/nyx/sync', { method: 'POST' });
      const d = await r.json();
      if (r.ok) {
        setNyxMsg(`✅ Nyx sincronizado — ${d.count} bases encontradas`);
        loadData();
      } else {
        setNyxMsg(`⚠️ ${d.detail || 'Error en sync'}`);
      }
    } catch {
      setNyxMsg('⚠️ Error conectando con Nyx');
    } finally {
      setNyxSyncing(false);
    }
  }, [authFetch, loadData]);

  // ── Save ───────────────────────────────────────────────────────────────────

  const saveSitio = useCallback(async (name: string, patch: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const encodedName = encodeURIComponent(name);
      const res = await authFetch(`/api/radiobases/sitios/${encodedName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Error ${res.status}`);
      }
      const { sitio } = await res.json();
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          radiobases: prev.radiobases.map(rb => rb.name === name ? { ...rb, ...sitio } : rb),
        };
      });
      // Reload historial silently
      authFetch('/api/radiobases/historial')
        .then(r => r.ok ? r.json() : null)
        .then(h => h && setData(prev => prev ? { ...prev, historial: h.historial } : prev))
        .catch(() => {});
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'No se pudieron guardar los cambios');
    } finally {
      setSaving(false);
      setEditKey(null);
    }
  }, [authFetch]);

  const startEdit = (key: EditKey) => { setSaveError(null); setEditKey(key); };
  const cancelEdit = () => setEditKey(null);

  const editableCell = (key: EditKey, children: React.ReactNode) => {
    if (!isAdmin) return <>{children}</>;
    return (
      <span
        onMouseEnter={() => setHoveredCell(key)}
        onMouseLeave={() => setHoveredCell(null)}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        onClick={() => startEdit(key)}
      >
        {children}
        {hoveredCell === key && (
          <span style={{ color: '#00C896', opacity: 0.7 }}><PencilIcon /></span>
        )}
      </span>
    );
  };

  // ── Financial summary ──────────────────────────────────────────────────────

  const finanzas = useMemo(() => {
    if (!data) return null;
    let neto = 0, conIva = 0, count = 0;
    for (const rb of data.radiobases) {
      if (rb.renta_mxn !== null && rb.renta_mxn !== undefined) {
        count++;
        neto += rb.renta_mxn;
        conIva += rb.renta_incluye_iva ? rb.renta_mxn : rb.renta_mxn * 1.16;
      }
    }
    return { neto, conIva, anual: conIva * 12, count };
  }, [data]);

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    setListPage(0);
    if (!data) return [];
    const q = search.toLowerCase();
    return data.radiobases.filter(rb => {
      const matchSearch = !q || rb.name.toLowerCase().includes(q)
        || rb.city.toLowerCase().includes(q)
        || rb.state.toLowerCase().includes(q)
        || rb.direccion.toLowerCase().includes(q);
      const matchEstatus = filterEstatus === 'todos' || normalizeEstatus(rb.estatus) === filterEstatus;
      const matchEstadoOp = filterEstadoOp === 'todos' || rb.estado_op === filterEstadoOp;
      return matchSearch && matchEstatus && matchEstadoOp;
    });
  }, [data, search, filterEstatus, filterEstadoOp]);

  const pagedFiltered = useMemo(
    () => filtered.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE),
    [filtered, listPage]
  );
  const totalPages = Math.ceil(filtered.length / LIST_PAGE_SIZE);

  const selected = useMemo(() =>
    data?.radiobases.find(rb => rb.name === selectedName) ?? null,
  [data, selectedName]);

  const energyBySite = useMemo(() => {
    const map: Record<string, PowerDevice[]> = {};
    for (const pd of powerDevices) {
      const siteName = (pd.site || pd.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!siteName) continue;
      if (!map[siteName]) map[siteName] = [];
      map[siteName].push(pd);
    }
    return map;
  }, [powerDevices]);

  const getSiteDevices = useCallback((name: string): PowerDevice[] => {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (energyBySite[key]) return energyBySite[key];
    for (const [k, devs] of Object.entries(energyBySite)) {
      if (key.length >= 4 && (k.includes(key) || key.includes(k))) return devs;
    }
    return [];
  }, [energyBySite]);

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div style={{ padding: '40px 24px', color: '#FF4757', fontFamily: 'inherit' }}>
        <div style={{ background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 10, padding: '16px 20px' }}>
          ⚠️ {loadError}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '40px 24px', display: 'flex', alignItems: 'center', gap: 10, color: theme.dim, fontFamily: 'inherit' }}>
        <Spinner /> Cargando Radio Bases…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total     = data.radiobases.length;
  const vigentes  = data.radiobases.filter(rb => normalizeEstatus(rb.estatus) === 'vigente').length;
  const vencidos  = data.radiobases.filter(rb => normalizeEstatus(rb.estatus) === 'vencido').length;
  const conCoords = data.radiobases.filter(rb => rb.lat !== null && rb.lng !== null).length;
  const conEnergia = data.radiobases.filter(rb => getSiteDevices(rb.name).length > 0).length;
  const deSoloOdoo = data.radiobases.filter(rb => rb.fuente === 'odoo').length;
  const deNyx = data.radiobases.filter(rb => (rb.fuente || '').includes('nyx')).length;

  const fmtMXN = (n: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);

  const s: React.CSSProperties = { fontFamily: 'inherit', color: theme.text, padding: '20px 24px', height: '100%', display: 'flex', flexDirection: 'column', maxWidth: 1200 };

  return (
    <div style={s}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22 }}>📡</span>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: theme.text }}>Radio Bases XCIEN</h1>
          <span style={{ background: 'rgba(0,200,150,0.15)', color: '#00C896', border: '1px solid rgba(0,200,150,0.3)', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
            {total} SITIOS
          </span>
          {powerDevices.length > 0 && (
            <span style={{ background: 'rgba(255,183,3,0.15)', color: '#FFB703', border: '1px solid rgba(255,183,3,0.3)', borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
              ⚡ {powerDevices.length} dispositivos energía
            </span>
          )}
          {isAdmin && (
            <button
              onClick={syncNyx}
              disabled={nyxSyncing}
              style={{
                marginLeft: 'auto', background: nyxSyncing ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.15)',
                color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 700,
                cursor: nyxSyncing ? 'not-allowed' : 'pointer',
              }}
            >
              {nyxSyncing ? '⏳ Sincronizando…' : '🔄 Sync Nyx'}
            </button>
          )}
        </div>
        <p style={{ fontSize: 13, color: theme.dim }}>
          Inventario de radiobases · contratos, energía (NOCBoard) y datos Nyx
          {isAdmin && (
            <span style={{ marginLeft: 12, fontSize: 11, color: '#00C896', background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.2)', borderRadius: 12, padding: '1px 8px' }}>
              ✏️ Edición activa — {user?.nombre}
            </span>
          )}
        </p>
        {nyxMsg && (
          <div style={{ marginTop: 6, fontSize: 12, color: nyxMsg.startsWith('✅') ? '#00C896' : '#FFB703' }}>
            {nyxMsg}
          </div>
        )}
      </div>

      {/* Save error */}
      {saveError && (
        <div style={{ background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#FF4757', display: 'flex', alignItems: 'center', gap: 8 }}>
          ⚠️ {saveError}
          <button onClick={() => setSaveError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FF4757', marginLeft: 'auto', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total sitios',          value: total,      sub: 'inventario completo',           color: '#00C896' },
          { label: 'Contratos vigentes',    value: vigentes,   sub: 'vigente / vigente x contrato',  color: '#3B82F6' },
          { label: 'Con energía NOCBoard',  value: conEnergia, sub: `de ${total} sitios`,            color: '#FFB703' },
          { label: 'Solo Odoo / Nyx',       value: deSoloOdoo + deNyx, sub: `${deSoloOdoo} Odoo · ${deNyx} Nyx`, color: '#8B5CF6' },
        ].map(k => (
          <div key={k.label} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, marginTop: 2 }}>{k.label}</div>
            <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Financial summary */}
      {finanzas && finanzas.count > 0 && (
        <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 20px', marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: theme.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>💰 Renta mensual neta</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#3B82F6' }}>{fmtMXN(finanzas.neto)}</div>
            <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>{finanzas.count} sitios con dato</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: theme.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>💰 Renta mensual c/IVA</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#00C896' }}>{fmtMXN(finanzas.conIva)}</div>
            <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>+16% IVA estimado</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: theme.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>📅 Proyección anual c/IVA</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#FFB703' }}>{fmtMXN(finanzas.anual)}</div>
            <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>sin inflación / incrementos</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: theme.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>⚠️ Sin dato de renta</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#FF4757' }}>{total - finanzas.count}</div>
            <div style={{ fontSize: 11, color: theme.dim, marginTop: 2 }}>de {total} sitios totales</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${theme.border}`, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? 'rgba(0,200,150,0.12)' : 'transparent',
            border: 'none',
            borderBottom: tab === t.id ? '2px solid #00C896' : '2px solid transparent',
            borderRadius: '6px 6px 0 0',
            padding: '8px 14px',
            cursor: 'pointer',
            color: tab === t.id ? '#00C896' : theme.dim,
            fontSize: 13,
            fontWeight: tab === t.id ? 700 : 400,
            transition: 'all 0.15s',
          }}>
            {t.label}
            {t.id === 'historial' && data.historial.length > 0 && (
              <span style={{ marginLeft: 5, background: '#00C896', color: '#000', fontSize: 9, fontWeight: 800, borderRadius: 10, padding: '1px 5px' }}>
                {data.historial.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Inventario ──────────────────────────────────────────────────── */}
      {tab === 'inventario' && (
        <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>

          {/* Left: list */}
          <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Filters */}
            <input
              placeholder="Buscar por nombre, ciudad, estado…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                background: theme.card, border: `1px solid ${theme.border}`,
                borderRadius: 8, padding: '7px 12px', fontSize: 12,
                color: theme.text, outline: 'none', width: '100%',
              }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={filterEstatus}
                onChange={e => setFilterEstatus(e.target.value)}
                style={{ flex: 1, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 11, color: theme.dim, outline: 'none' }}
              >
                <option value="todos">Todos contratos</option>
                <option value="vigente">Vigentes</option>
                <option value="vencido">Vencidos</option>
                <option value="sin_dato">Sin dato</option>
              </select>
              <select
                value={filterEstadoOp}
                onChange={e => setFilterEstadoOp(e.target.value)}
                style={{ flex: 1, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '5px 8px', fontSize: 11, color: theme.dim, outline: 'none' }}
              >
                <option value="todos">Todos estados</option>
                <option value="operativa">Operativa</option>
                <option value="degradada">Degradada</option>
                <option value="en_mantenimiento">Mantenimiento</option>
                <option value="sin_info">Sin info</option>
              </select>
            </div>
            <div style={{ fontSize: 11, color: theme.dim }}>
              {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
              {totalPages > 1 && ` · pág. ${listPage + 1}/${totalPages}`}
            </div>

            {/* Scrollable list */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {pagedFiltered.map(rb => {
                const isSelected = rb.name === selectedName;
                const opCfg = ESTADO_OP_CFG[rb.estado_op] ?? ESTADO_OP_CFG.sin_info;
                const esCfg = ESTATUS_CFG[rb.estatus] ?? ESTATUS_CFG[''];
                return (
                  <div
                    key={rb.name}
                    onClick={() => setSelectedName(rb.name === selectedName ? null : rb.name)}
                    style={{
                      background: isSelected ? 'rgba(0,200,150,0.08)' : theme.card,
                      border: `1px solid ${isSelected ? 'rgba(0,200,150,0.3)' : theme.border}`,
                      borderRadius: 8, padding: '8px 12px',
                      cursor: 'pointer', transition: 'all 0.12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: opCfg.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: isSelected ? '#00C896' : theme.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rb.name}
                      </span>
                      {getSiteDevices(rb.name).length > 0 && (
                        <span title="Tiene dispositivos de energía" style={{ fontSize: 10 }}>⚡</span>
                      )}
                      <Badge label={esCfg.label} color={esCfg.color} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 15 }}>
                      {(rb.city || rb.state) && (
                        <span style={{ fontSize: 11, color: theme.dim }}>
                          {[rb.city, rb.state].filter(Boolean).join(', ')}
                        </span>
                      )}
                      {rb.clientes != null && (
                        <span style={{ fontSize: 10, color: '#3B82F6', fontWeight: 700 }}>· {rb.clientes} clientes</span>
                      )}
                      {(rb.fuente || '').includes('nyx') && (
                        <span style={{ fontSize: 9, color: '#8B5CF6', fontWeight: 700 }}>NYX</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: theme.dim, fontSize: 12 }}>
                  Sin resultados para los filtros aplicados.
                </div>
              )}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: `1px solid ${theme.border}` }}>
                <button
                  onClick={() => setListPage(p => Math.max(0, p - 1))}
                  disabled={listPage === 0}
                  style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, border: `1px solid ${theme.border}`, background: theme.card, color: listPage === 0 ? theme.dim : theme.text, cursor: listPage === 0 ? 'default' : 'pointer' }}
                >← Anterior</button>
                <span style={{ fontSize: 11, color: theme.dim }}>{listPage + 1} / {totalPages}</span>
                <button
                  onClick={() => setListPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={listPage === totalPages - 1}
                  style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, border: `1px solid ${theme.border}`, background: theme.card, color: listPage === totalPages - 1 ? theme.dim : theme.text, cursor: listPage === totalPages - 1 ? 'default' : 'pointer' }}
                >Siguiente →</button>
              </div>
            )}
          </div>

          {/* Right: detail panel */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selected ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.dim, textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Selecciona un sitio</div>
                  <div style={{ fontSize: 12 }}>Haz clic en un sitio de la lista para ver sus detalles</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflowY: 'auto' }}>
                {/* Site header */}
                <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 800, color: theme.text, marginBottom: 4 }}>{selected.name}</h2>
                      <div style={{ fontSize: 12, color: theme.dim }}>
                        {[selected.city, selected.state].filter(Boolean).join(', ') || 'Sin ubicación registrada'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {(() => {
                        const esCfg = ESTATUS_CFG[selected.estatus] ?? ESTATUS_CFG[''];
                        return <Badge label={esCfg.label} color={esCfg.color} />;
                      })()}
                      {selected.fuente && selected.fuente !== 'drive' && (
                        <Badge
                          label={selected.fuente.toUpperCase().replace(/\+/g, ' + ')}
                          color={selected.fuente.includes('nyx') ? '#8B5CF6' : selected.fuente === 'odoo' ? '#3B82F6' : '#00C896'}
                        />
                      )}
                      {selected.clientes != null && (
                        <Badge label={`${selected.clientes} clientes`} color='#3B82F6' />
                      )}
                    </div>
                  </div>

                  {/* Estado operacional */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: theme.dim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 130 }}>Estado operacional</span>
                    {saving && editKey === `${selected.name}:estado_op` ? (
                      <Spinner />
                    ) : isAdmin && editKey === `${selected.name}:estado_op` ? (
                      <select
                        autoFocus
                        value={selected.estado_op}
                        onChange={e => {
                          const v = e.target.value as RadioBase['estado_op'];
                          if (v !== selected.estado_op) saveSitio(selected.name, { estado_op: v });
                          else cancelEdit();
                        }}
                        onBlur={cancelEdit}
                        style={{
                          background: theme.card, border: `1px solid ${theme.border}`,
                          borderRadius: 6, padding: '4px 8px', fontSize: 12, color: theme.text, outline: 'none',
                        }}
                      >
                        {ESTADO_OP_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      editableCell(`${selected.name}:estado_op`, (() => {
                        const opCfg = ESTADO_OP_CFG[selected.estado_op] ?? ESTADO_OP_CFG.sin_info;
                        return <Badge label={opCfg.label} color={opCfg.color} />;
                      })())
                    )}
                  </div>
                </div>

                {/* Contract info — editable */}
                <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 20px' }}>
                  <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#00C896', marginBottom: 12 }}>
                    Contrato de Arrendamiento {isAdmin && <span style={{ color: theme.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>· clic para editar</span>}
                  </h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>
                      {([
                        ['vigencia',  'Vigencia',        selected.vigencia],
                        ['renta',     'Renta mensual',   selected.renta],
                        ['direccion', 'Dirección',       selected.direccion],
                        ['city',      'Ciudad',          selected.city],
                        ['state',     'Estado',          selected.state],
                      ] as [string, string, string][]).map(([field, label, val]) => (
                        <tr key={field} style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <td style={{ padding: '7px 4px', color: theme.dim, fontWeight: 600, width: 130, fontSize: 12, verticalAlign: 'top' }}>{label}</td>
                          <td style={{ padding: '7px 4px', wordBreak: 'break-word' }}>
                            {isAdmin && editKey === `${selected.name}:${field}` ? (
                              <InlineInput
                                value={val || ''}
                                onSave={v => saveSitio(selected.name, { [field]: v })}
                                onCancel={cancelEdit}
                              />
                            ) : (
                              editableCell(`${selected.name}:${field}`,
                                <span style={{ color: val ? theme.text : theme.dim, fontStyle: val ? 'normal' : 'italic' }}>
                                  {val || (isAdmin ? '+ agregar' : '—')}
                                  {field === 'renta' && selected.renta_mxn !== null && (
                                    <span style={{ marginLeft: 8, fontSize: 11, color: '#00C896', fontWeight: 700 }}>
                                      ({fmtMXN(selected.renta_mxn)}/mes{selected.renta_incluye_iva ? ' c/IVA' : ''})
                                    </span>
                                  )}
                                </span>
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* GPS — editable */}
                <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 20px' }}>
                  <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#00C896', marginBottom: 12 }}>
                    Coordenadas GPS {isAdmin && <span style={{ color: theme.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>· clic para editar</span>}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {(['lat', 'lng'] as const).map(field => {
                      const val = selected[field];
                      const label = field === 'lat' ? 'Latitud' : 'Longitud';
                      return (
                        <div key={field}>
                          <div style={{ fontSize: 11, color: theme.dim, marginBottom: 4 }}>{label}</div>
                          {isAdmin && editKey === `${selected.name}:${field}` ? (
                            <InlineInput
                              value={val !== null ? String(val) : ''}
                              onSave={v => saveSitio(selected.name, { [field]: v === '' ? null : parseFloat(v) || v })}
                              onCancel={cancelEdit}
                              style={{ fontFamily: 'monospace' }}
                            />
                          ) : (
                            editableCell(`${selected.name}:${field}`,
                              <span style={{ fontFamily: 'monospace', fontSize: 13, color: val !== null ? theme.text : theme.dim, fontStyle: val !== null ? 'normal' : 'italic' }}>
                                {val !== null ? String(val) : (isAdmin ? '+ agregar' : 'sin dato')}
                              </span>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {selected.lat && selected.lng && (
                    <a
                      href={`https://www.google.com/maps?q=${selected.lat},${selected.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-block', marginTop: 10, fontSize: 11, color: '#3B82F6', textDecoration: 'none' }}
                    >
                      📍 Ver en Google Maps ↗
                    </a>
                  )}
                </div>

                {/* Energy devices widget */}
                {(() => {
                  const devs = getSiteDevices(selected.name);
                  if (!devs.length) return null;
                  const VENDOR_COLORS: Record<string, string> = { eltek: '#4F46E5', samlex: '#00B4D8', mei: '#FF6B35', victron: '#059669', unknown: '#6B7280' };
                  const TYPE_LABELS: Record<string, string> = { rectifier: 'Rectificador', inverter: 'Inversor', siteMonitor: 'Site Monitor' };
                  return (
                    <div style={{ background: theme.card, border: `1px solid rgba(255,183,3,0.25)`, borderRadius: 12, padding: '14px 20px' }}>
                      <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#FFB703', marginBottom: 12 }}>
                        ⚡ Energía en sitio · {devs.length} dispositivo{devs.length !== 1 ? 's' : ''}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {devs.map(d => {
                          const online = d.status === 'online';
                          const vc = VENDOR_COLORS[d.vendor?.toLowerCase()] ?? VENDOR_COLORS.unknown;
                          return (
                            <div key={d.ip} style={{ background: theme.bg, borderRadius: 8, padding: '10px 14px', border: `1px solid ${theme.border}` }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: online ? '#00C896' : '#FF4757', flexShrink: 0 }} />
                                <span style={{ fontSize: 12, fontWeight: 700, color: theme.text, flex: 1 }}>{d.name}</span>
                                <Badge label={TYPE_LABELS[d.type] || d.type || 'Dispositivo'} color={vc} />
                                <span style={{ fontSize: 10, color: theme.dim, fontFamily: 'monospace' }}>{d.ip}</span>
                              </div>
                              {d.metrics && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                                  {d.metrics.batteryVoltage != null && (
                                    <div style={{ fontSize: 11 }}>
                                      <div style={{ color: theme.dim, marginBottom: 1 }}>Bat. voltaje</div>
                                      <div style={{ color: '#FFB703', fontWeight: 700 }}>{d.metrics.batteryVoltage.toFixed(1)} V</div>
                                    </div>
                                  )}
                                  {d.metrics.mainsPresent != null && (
                                    <div style={{ fontSize: 11 }}>
                                      <div style={{ color: theme.dim, marginBottom: 1 }}>Red eléctrica</div>
                                      <div style={{ color: d.metrics.mainsPresent ? '#00C896' : '#FF4757', fontWeight: 700 }}>
                                        {d.metrics.mainsPresent ? 'Presente' : 'Ausente'}
                                      </div>
                                    </div>
                                  )}
                                  {d.metrics.batteryRuntimeMinutes != null && (
                                    <div style={{ fontSize: 11 }}>
                                      <div style={{ color: theme.dim, marginBottom: 1 }}>Autonomía bat.</div>
                                      <div style={{ color: '#3B82F6', fontWeight: 700 }}>
                                        {d.metrics.batteryRuntimeMinutes >= 60
                                          ? `${(d.metrics.batteryRuntimeMinutes / 60).toFixed(1)} h`
                                          : `${Math.round(d.metrics.batteryRuntimeMinutes)} min`}
                                      </div>
                                    </div>
                                  )}
                                  {d.metrics.acOutputVoltage != null && (
                                    <div style={{ fontSize: 11 }}>
                                      <div style={{ color: theme.dim, marginBottom: 1 }}>AC salida</div>
                                      <div style={{ color: theme.text, fontWeight: 700 }}>{d.metrics.acOutputVoltage.toFixed(0)} V</div>
                                    </div>
                                  )}
                                  {d.metrics.loadPower != null && (
                                    <div style={{ fontSize: 11 }}>
                                      <div style={{ color: theme.dim, marginBottom: 1 }}>Carga</div>
                                      <div style={{ color: theme.text, fontWeight: 700 }}>{d.metrics.loadPower.toFixed(0)} W</div>
                                    </div>
                                  )}
                                  {d.metrics.batterySOC != null && (
                                    <div style={{ fontSize: 11 }}>
                                      <div style={{ color: theme.dim, marginBottom: 1 }}>SOC batería</div>
                                      <div style={{ color: d.metrics.batterySOC > 50 ? '#00C896' : d.metrics.batterySOC > 20 ? '#FFB703' : '#FF4757', fontWeight: 700 }}>
                                        {d.metrics.batterySOC.toFixed(0)}%
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                              {!d.metrics && (
                                <div style={{ fontSize: 11, color: theme.dim, fontStyle: 'italic' }}>Sin métricas SNMP</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Nyx data */}
                {selected.nyx_data && (
                  <div style={{ background: theme.card, border: `1px solid rgba(139,92,246,0.25)`, borderRadius: 12, padding: '14px 20px' }}>
                    <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8B5CF6', marginBottom: 12 }}>
                      Datos Nyx
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {Object.entries(selected.nyx_data.raw || {}).map(([k, v]) => v && (
                        <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                          <span style={{ color: theme.dim, fontWeight: 600, minWidth: 120, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                          <span style={{ color: theme.text }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Editable fields */}
                {isAdmin && (
                  <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 20px' }}>
                    <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#00C896', marginBottom: 12 }}>
                      Campos Operativos
                    </h3>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: theme.dim, fontWeight: 600, marginBottom: 4 }}>Última visita de campo</div>
                      {editKey === `${selected.name}:ultima_visita` ? (
                        <InlineInput
                          value={selected.ultima_visita || ''}
                          onSave={v => saveSitio(selected.name, { ultima_visita: v })}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        editableCell(`${selected.name}:ultima_visita`,
                          <span style={{ fontSize: 13, color: selected.ultima_visita ? theme.text : theme.dim, fontStyle: selected.ultima_visita ? 'normal' : 'italic' }}>
                            {selected.ultima_visita || '+ agregar fecha'}
                          </span>
                        )
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: theme.dim, fontWeight: 600, marginBottom: 4 }}>Notas operativas</div>
                      {editKey === `${selected.name}:notas` ? (
                        <InlineInput
                          value={selected.notas || ''}
                          onSave={v => saveSitio(selected.name, { notas: v })}
                          onCancel={cancelEdit}
                          multiline
                        />
                      ) : (
                        editableCell(`${selected.name}:notas`,
                          <span style={{ fontSize: 13, color: selected.notas ? theme.text : theme.dim, fontStyle: selected.notas ? 'normal' : 'italic', whiteSpace: 'pre-wrap' }}>
                            {selected.notas || '+ agregar notas'}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}

                {!isAdmin && (selected.notas || selected.ultima_visita) && (
                  <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 20px' }}>
                    {selected.ultima_visita && (
                      <div style={{ marginBottom: 8 }}>
                        <span style={{ fontSize: 11, color: theme.dim, fontWeight: 600 }}>Última visita: </span>
                        <span style={{ fontSize: 13, color: theme.text }}>{selected.ultima_visita}</span>
                      </div>
                    )}
                    {selected.notas && (
                      <div>
                        <div style={{ fontSize: 11, color: theme.dim, fontWeight: 600, marginBottom: 4 }}>Notas</div>
                        <div style={{ fontSize: 13, color: theme.text, whiteSpace: 'pre-wrap' }}>{selected.notas}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Historial ──────────────────────────────────────────────────── */}
      {tab === 'historial' && (
        <div>
          {data.historial.length === 0 ? (
            <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <div style={{ color: theme.dim, fontSize: 13 }}>No hay cambios registrados aún.</div>
              <div style={{ color: theme.dim, fontSize: 12, marginTop: 4 }}>Edita el estado o las notas de un sitio para ver el historial aquí.</div>
            </div>
          ) : (
            <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                    {['Fecha / Hora', 'Usuario', 'Sitio', 'Cambios'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: theme.dim, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.historial.map((h, i) => {
                    const fecha = new Date(h.ts + 'Z');
                    const fechaStr = fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
                    const horaStr = fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${theme.border}`, background: i % 2 === 0 ? theme.bg : 'transparent' }}>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{fechaStr}</div>
                          <div style={{ fontSize: 11, color: theme.dim }}>{horaStr} UTC</div>
                        </td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#00C896' }}>{h.user_nombre ?? '—'}</div>
                          <div style={{ fontSize: 10, color: theme.dim }}>{h.user_email ?? ''}</div>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: 12, color: theme.text }}>📡 {h.site_name}</span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {Object.entries(h.cambios ?? {}).map(([campo, { de, a }]) => (
                            <div key={campo} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
                              <span style={{ fontSize: 11, color: theme.dim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{campo}:</span>
                              <span style={{ fontSize: 11, color: '#FF4757', background: 'rgba(255,71,87,0.1)', borderRadius: 4, padding: '0 4px' }}>{String(de ?? '—')}</span>
                              <span style={{ fontSize: 10, color: theme.dim }}>→</span>
                              <span style={{ fontSize: 11, color: '#00C896', background: 'rgba(0,200,150,0.1)', borderRadius: 4, padding: '0 4px' }}>{String(a ?? '—')}</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
