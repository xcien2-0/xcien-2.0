import { useState, useEffect, useCallback } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';
import brand from '../../../brand';

// ─── Types (mirrors inventario_tokens.py) ─────────────────────────────────────

interface TokenLine {
  line_id: string;
  product_ref: string;
  product_name: string;
  quantity: number;
  uom: string;
  lot_serial?: string;
}

interface InvToken {
  token_id: string;
  token_name: string;
  origin_warehouse: string;
  dest_warehouse: string;
  state: 'draft' | 'confirmed' | 'in_transit' | 'received' | 'cancelled';
  lines: TokenLine[];
  created_by: string;
  notes: string;
  priority: 'normal' | 'urgent';
  created_at: string;
  confirmed_at?: string;
  shipped_at?: string;
  received_at?: string;
  cancelled_at?: string;
  odoo_picking_id?: number;
  odoo_picking_name?: string;
}

interface Warehouse {
  code: string;
  name: string;
  city: string;
  odoo_location_code: string;
  odoo_connected: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WH_COLOR: Record<string, string> = {
  CDMX: '#1976D2',
  QRO:  '#2E7D32',
  GDL:  '#E65100',
  MTY:  '#7B1FA2',
};

const STATE_CONFIG = {
  draft:      { label: 'Borrador',    color: '#64748b', icon: '📝', next: 'confirm' },
  confirmed:  { label: 'Confirmado',  color: '#F59E0B', icon: '✅', next: 'ship'    },
  in_transit: { label: 'En Tránsito', color: '#3B82F6', icon: '🚚', next: 'receive' },
  received:   { label: 'Recibido',    color: '#10B981', icon: '📦', next: null       },
  cancelled:  { label: 'Cancelado',   color: '#EF4444', icon: '✕',  next: null       },
};

const ACTION_LABEL: Record<string, string> = {
  confirm: 'Confirmar',
  ship:    'Marcar en Tránsito',
  receive: 'Confirmar Recepción',
};

const WAREHOUSES = ['CDMX', 'QRO', 'GDL', 'MTY'];

const EMPTY_LINE = (): Partial<TokenLine> => ({
  product_ref: '', product_name: '', quantity: 1, uom: 'pza',
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function shortId(id: string) { return id.slice(0, 8).toUpperCase(); }

// ─── Sub-components ───────────────────────────────────────────────────────────

function WhBadge({ code, small }: { code: string; small?: boolean }) {
  const color = WH_COLOR[code] || '#64748b';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${color}20`, color, border: `1px solid ${color}40`,
      borderRadius: 6, padding: small ? '2px 6px' : '3px 10px',
      fontSize: small ? 10 : 11, fontWeight: 700,
    }}>
      {code}
    </span>
  );
}

function StateBadge({ state }: { state: InvToken['state'] }) {
  const cfg = STATE_CONFIG[state];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${cfg.color}18`, color: cfg.color,
      border: `1px solid ${cfg.color}35`,
      borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 700,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function StepBar({ state, theme }: { state: InvToken['state']; theme: ThemeConfig }) {
  const steps = ['draft', 'confirmed', 'in_transit', 'received'] as const;
  const idx = state === 'cancelled' ? -1 : steps.indexOf(state);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
      {steps.map((s, i) => {
        const cfg = STATE_CONFIG[s];
        const active = i <= idx;
        const current = i === idx;
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 0, gap: 4 }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
              background: active ? cfg.color : (theme.card || '#1e2f3d'),
              border: `2px solid ${active ? cfg.color : '#334155'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 800, color: active ? '#fff' : '#64748b',
              boxShadow: current ? `0 0 8px ${cfg.color}80` : 'none',
            }}>
              {i + 1}
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 2,
                background: i < idx ? cfg.color : '#1e293b',
                borderRadius: 2,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Token Card ───────────────────────────────────────────────────────────────

function TokenCard({
  token, theme, onAction, onSelect, selected,
}: {
  token: InvToken;
  theme: ThemeConfig;
  onAction: (id: string, action: string) => void;
  onSelect: (id: string) => void;
  selected: boolean;
}) {
  const cfg = STATE_CONFIG[token.state];
  const nextAction = cfg.next;
  const totalItems = token.lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div
      onClick={() => onSelect(token.token_id)}
      style={{
        background: selected ? `${cfg.color}10` : (theme.card || '#1e2f3d'),
        border: `1px solid ${selected ? cfg.color : (theme.border || '#2a3f50')}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 10, padding: '14px 16px',
        cursor: 'pointer', transition: 'border-color 0.15s',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: theme.dim, marginBottom: 3 }}>
            #{shortId(token.token_id)}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>
            {token.token_name}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <StateBadge state={token.state} />
          {token.priority === 'urgent' && (
            <span style={{ fontSize: 9, color: '#EF4444', fontWeight: 700 }}>⚠️ URGENTE</span>
          )}
        </div>
      </div>

      {/* Route */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <WhBadge code={token.origin_warehouse} />
        <span style={{ color: theme.dim, fontSize: 14 }}>→</span>
        <WhBadge code={token.dest_warehouse} />
        <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.dim }}>
          {token.lines.length} producto{token.lines.length !== 1 ? 's' : ''} · {totalItems} pzs
        </span>
      </div>

      {/* Step bar */}
      <StepBar state={token.state} theme={theme} />

      {/* Timeline */}
      <div style={{ fontSize: 10, color: theme.dim, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>Creado: {fmt(token.created_at)}</span>
        {token.confirmed_at && <span>Confirmado: {fmt(token.confirmed_at)}</span>}
        {token.shipped_at   && <span>Enviado: {fmt(token.shipped_at)}</span>}
        {token.received_at  && <span>Recibido: {fmt(token.received_at)}</span>}
      </div>

      {/* Action button */}
      {nextAction && token.state !== 'cancelled' && (
        <button
          onClick={e => { e.stopPropagation(); onAction(token.token_id, nextAction); }}
          style={{
            background: cfg.color, color: '#fff', border: 'none',
            borderRadius: 6, padding: '6px 14px', fontSize: 11, fontWeight: 700,
            cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          {ACTION_LABEL[nextAction]}
        </button>
      )}

      {/* Odoo badge */}
      {token.odoo_picking_id && (
        <div style={{ fontSize: 10, color: '#10B981', fontFamily: 'monospace' }}>
          🔗 Odoo: {token.odoo_picking_name || token.odoo_picking_id}
        </div>
      )}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function TokenDetail({ token, theme }: { token: InvToken; theme: ThemeConfig }) {
  return (
    <div style={{
      background: theme.card || '#1e2f3d',
      border: `1px solid ${theme.border || '#2a3f50'}`,
      borderRadius: 10, padding: 20,
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: theme.text }}>
          Detalle del Token
        </h3>
        <StateBadge state={token.state} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          ['Token ID', shortId(token.token_id)],
          ['Nombre', token.token_name],
          ['Creado por', token.created_by],
          ['Prioridad', token.priority],
          ['Notas', token.notes || '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: theme.dim, marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 12, color: theme.text, fontWeight: 500 }}>{value}</div>
          </div>
        ))}
      </div>

      <div>
        <div style={{ fontSize: 11, color: theme.dim, marginBottom: 8, fontWeight: 600 }}>
          LÍNEAS DE PRODUCTO
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {token.lines.map(line => (
            <div key={line.line_id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 12px',
              fontSize: 12,
            }}>
              <div>
                <span style={{ fontFamily: 'monospace', color: theme.accent || '#60a5fa', marginRight: 8 }}>
                  [{line.product_ref}]
                </span>
                <span style={{ color: theme.text }}>{line.product_name}</span>
                {line.lot_serial && (
                  <span style={{ color: theme.dim, fontSize: 10, marginLeft: 8 }}>S/N: {line.lot_serial}</span>
                )}
              </div>
              <div style={{ fontWeight: 700, color: theme.text }}>
                {line.quantity} {line.uom}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── New Transfer Form ────────────────────────────────────────────────────────

function NewTransferForm({
  theme, onCreated, onCancel,
}: {
  theme: ThemeConfig;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const accent = theme.accent || '#60a5fa';
  const [origin, setOrigin] = useState('CDMX');
  const [dest, setDest] = useState('MTY');
  const [createdBy, setCreatedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [lines, setLines] = useState<Partial<TokenLine>[]>([EMPTY_LINE()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addLine = () => setLines(l => [...l, EMPTY_LINE()]);
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof TokenLine, value: string | number) =>
    setLines(l => l.map((line, idx) => idx === i ? { ...line, [field]: value } : line));

  const handleSubmit = async () => {
    if (!createdBy.trim()) { setError('Ingresa quien crea el token'); return; }
    if (origin === dest) { setError('Origen y destino deben ser distintos'); return; }
    const validLines = lines.filter(l => l.product_ref && l.product_name && (l.quantity || 0) > 0);
    if (!validLines.length) { setError('Agrega al menos un producto válido'); return; }

    setSaving(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/inv-transfers/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_warehouse: origin,
          dest_warehouse: dest,
          created_by: createdBy,
          notes, priority,
          lines: validLines.map((l, i) => ({
            line_id: `l${i}`,
            product_ref: l.product_ref,
            product_name: l.product_name,
            quantity: Number(l.quantity),
            uom: l.uom || 'pza',
          })),
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Error'); }
      onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle = {
    width: '100%', background: 'rgba(0,0,0,0.3)',
    border: `1px solid ${theme.border || '#2a3f50'}`,
    borderRadius: 6, padding: '7px 10px',
    color: theme.text || '#f5f5f7', fontSize: 12,
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{
      background: theme.card || '#1e2f3d',
      border: `2px solid ${accent}`,
      borderRadius: 12, padding: 20,
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: theme.text }}>
        Nueva Transferencia de Inventario
      </h3>

      {/* Ruta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
        <div>
          <label style={{ fontSize: 10, color: theme.dim, display: 'block', marginBottom: 4 }}>ORIGEN</label>
          <select value={origin} onChange={e => setOrigin(e.target.value)} style={fieldStyle}>
            {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 18, color: theme.dim, paddingTop: 18 }}>→</div>
        <div>
          <label style={{ fontSize: 10, color: theme.dim, display: 'block', marginBottom: 4 }}>DESTINO</label>
          <select value={dest} onChange={e => setDest(e.target.value)} style={fieldStyle}>
            {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
      </div>

      {/* Meta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={{ fontSize: 10, color: theme.dim, display: 'block', marginBottom: 4 }}>CREADO POR</label>
          <input
            value={createdBy}
            onChange={e => setCreatedBy(e.target.value)}
            placeholder={`tu@${brand.emailDomain}`}
            style={fieldStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: 10, color: theme.dim, display: 'block', marginBottom: 4 }}>PRIORIDAD</label>
          <select value={priority} onChange={e => setPriority(e.target.value as any)} style={fieldStyle}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgente</option>
          </select>
        </div>
      </div>

      <div>
        <label style={{ fontSize: 10, color: theme.dim, display: 'block', marginBottom: 4 }}>NOTAS</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Motivo de la transferencia..." style={fieldStyle} />
      </div>

      {/* Líneas */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 10, color: theme.dim, fontWeight: 600 }}>PRODUCTOS</label>
          <button
            onClick={addLine}
            style={{ background: 'transparent', border: `1px solid ${accent}`, color: accent, borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            + Agregar
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lines.map((line, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 50px 28px', gap: 6, alignItems: 'center' }}>
              <input
                placeholder="REF-001"
                value={line.product_ref || ''}
                onChange={e => updateLine(i, 'product_ref', e.target.value)}
                style={{ ...fieldStyle, fontFamily: 'monospace', fontSize: 11 }}
              />
              <input
                placeholder="Nombre del producto"
                value={line.product_name || ''}
                onChange={e => updateLine(i, 'product_name', e.target.value)}
                style={fieldStyle}
              />
              <input
                type="number"
                min={1}
                value={line.quantity || ''}
                onChange={e => updateLine(i, 'quantity', Number(e.target.value))}
                style={{ ...fieldStyle, textAlign: 'center' }}
              />
              <select value={line.uom || 'pza'} onChange={e => updateLine(i, 'uom', e.target.value)} style={fieldStyle}>
                {['pza', 'mt', 'kg', 'caja', 'rollo'].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <button
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#EF4444', fontSize: 16, padding: 0,
                  opacity: lines.length === 1 ? 0.3 : 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ color: '#EF4444', fontSize: 12, background: 'rgba(239,68,68,0.1)', borderRadius: 6, padding: '8px 12px' }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim, borderRadius: 7, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }}>
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{ background: accent, color: '#000', border: 'none', borderRadius: 7, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Creando...' : 'Emitir Token de Transferencia'}
        </button>
      </div>
    </div>
  );
}

// ─── Stock Panel ──────────────────────────────────────────────────────────────

function StockPanel({ theme }: { theme: ThemeConfig }) {
  const [warehouse, setWarehouse] = useState('MTY');
  const [stock, setStock] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/inv-transfers/stock/${warehouse}`);
      setStock(await r.json());
    } catch { setStock(null); }
    setLoading(false);
  }, [warehouse]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{
      background: theme.card || '#1e2f3d',
      border: `1px solid ${theme.border || '#2a3f50'}`,
      borderRadius: 10, padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>Stock Virtual</span>
        <select
          value={warehouse}
          onChange={e => setWarehouse(e.target.value)}
          style={{
            background: 'rgba(0,0,0,0.3)', border: `1px solid ${theme.border}`,
            color: theme.text, borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
          }}
        >
          {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>

      {loading && <div style={{ color: theme.dim, fontSize: 12, textAlign: 'center', padding: 20 }}>Cargando transferencias…</div>}

      {!loading && stock && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <WhBadge code={warehouse} />
            <span style={{ fontSize: 10, color: theme.dim }}>{stock.warehouse_name}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: theme.dim }}>
              {stock.products?.length || 0} productos
            </span>
          </div>

          {(!stock.products || stock.products.length === 0) ? (
            <div style={{ fontSize: 11, color: theme.dim, textAlign: 'center', padding: 16 }}>
              Sin movimientos registrados aún
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 200, overflowY: 'auto' }}>
              {stock.products.map((p: any) => (
                <div key={p.product_ref} style={{
                  display: 'flex', justifyContent: 'space-between',
                  background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '6px 10px', fontSize: 11,
                }}>
                  <span style={{ fontFamily: 'monospace', color: theme.accent || '#60a5fa' }}>{p.product_ref}</span>
                  <span style={{ color: theme.dim, flex: 1, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product_name}</span>
                  <span style={{ fontWeight: 700, color: p.quantity > 0 ? '#10B981' : '#EF4444', marginLeft: 8 }}>
                    {p.quantity > 0 ? '+' : ''}{p.quantity} {p.uom || 'pza'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 9, color: theme.dim, fontStyle: 'italic' }}>
            ⏳ Stock calculado desde tokens recibidos — se sincronizará con Odoo stock.quant cuando se conecte
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Section ─────────────────────────────────────────────────────────────

export default function InventarioTransfersSection({ theme }: { theme: ThemeConfig }) {
  const accent = theme.accent || '#60a5fa';

  const [tokens, setTokens] = useState<InvToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [whFilter, setWhFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/inv-transfers/`);
      const data = await r.json();
      setTokens(Array.isArray(data) ? data : []);
    } catch { setTokens([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string) => {
    setActionLoading(id);
    try {
      await fetch(`${API_BASE}/api/inv-transfers/${id}/${action}`, { method: 'PATCH' });
      await load();
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = tokens.filter(t => {
    const okState = filter === 'all' || t.state === filter;
    const okWh = whFilter === 'all' || t.origin_warehouse === whFilter || t.dest_warehouse === whFilter;
    return okState && okWh;
  });

  const selected = tokens.find(t => t.token_id === selectedId) || null;

  // KPIs
  const kpis = {
    total:     tokens.length,
    active:    tokens.filter(t => ['confirmed', 'in_transit'].includes(t.state)).length,
    received:  tokens.filter(t => t.state === 'received').length,
    urgent:    tokens.filter(t => t.priority === 'urgent' && t.state !== 'received').length,
  };

  const selectStyle = {
    background: 'rgba(0,0,0,0.3)', border: `1px solid ${theme.border || '#2a3f50'}`,
    color: theme.text || '#f5f5f7', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: theme.text }}>
            Transferencias de Inventario
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: theme.dim }}>
            Tokens de movimiento entre almacenes CDMX · QRO · GDL · MTY
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={load}
            style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim, borderRadius: 7, padding: '7px 12px', fontSize: 11, cursor: 'pointer' }}
          >
            ↺ Actualizar
          </button>
          <button
            onClick={() => { setShowForm(!showForm); setSelectedId(null); }}
            style={{ background: accent, color: '#000', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            {showForm ? '✕ Cancelar' : '+ Nueva Transferencia'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'Total',      value: kpis.total,    color: accent },
          { label: 'En Curso',   value: kpis.active,   color: '#F59E0B' },
          { label: 'Recibidos',  value: kpis.received, color: '#10B981' },
          { label: 'Urgentes',   value: kpis.urgent,   color: '#EF4444' },
        ].map(k => (
          <div key={k.label} style={{
            background: theme.card || '#1e2f3d',
            border: `1px solid ${theme.border || '#2a3f50'}`,
            borderRadius: 8, padding: '12px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 10, color: theme.dim, marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <NewTransferForm
          theme={theme}
          onCreated={() => { setShowForm(false); load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 16, alignItems: 'start' }}>

        {/* Token list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={filter} onChange={e => setFilter(e.target.value)} style={selectStyle}>
              <option value="all">Todos los estados</option>
              <option value="draft">Borrador</option>
              <option value="confirmed">Confirmado</option>
              <option value="in_transit">En Tránsito</option>
              <option value="received">Recibido</option>
              <option value="cancelled">Cancelado</option>
            </select>
            <select value={whFilter} onChange={e => setWhFilter(e.target.value)} style={selectStyle}>
              <option value="all">Todos los almacenes</option>
              {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <span style={{ fontSize: 11, color: theme.dim, alignSelf: 'center' }}>
              {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Cards */}
          {loading ? (
            <div style={{ color: theme.dim, textAlign: 'center', padding: 40, fontSize: 13 }}>Cargando tokens...</div>
          ) : filtered.length === 0 ? (
            <div style={{
              background: theme.card, border: `1px dashed ${theme.border}`,
              borderRadius: 10, padding: 40, textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
              <div style={{ fontSize: 13, color: theme.dim }}>
                {tokens.length === 0 ? 'No hay transferencias aún. Crea la primera.' : 'Sin resultados con ese filtro.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(t => (
                <TokenCard
                  key={t.token_id}
                  token={t}
                  theme={theme}
                  onAction={(id, action) => handleAction(id, action)}
                  onSelect={id => setSelectedId(id === selectedId ? null : id)}
                  selected={t.token_id === selectedId}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail + Stock */}
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TokenDetail token={selected} theme={theme} />
            <StockPanel theme={theme} />
          </div>
        )}
      </div>

      {/* Odoo note */}
      <div style={{
        background: 'rgba(16,185,129,0.06)',
        border: '1px solid rgba(16,185,129,0.2)',
        borderRadius: 8, padding: '10px 14px',
        fontSize: 11, color: '#10B981',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>🔗</span>
        <span>
          <strong>Preparado para Odoo</strong> — Cuando se conecte, cada token se convierte en un
          {' '}<code style={{ fontFamily: 'monospace', fontSize: 10 }}>stock.picking</code> y actualiza
          {' '}<code style={{ fontFamily: 'monospace', fontSize: 10 }}>stock.quant</code> automáticamente.
        </span>
      </div>
    </div>
  );
}
