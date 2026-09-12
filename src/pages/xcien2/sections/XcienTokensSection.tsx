import { useState, useEffect, useCallback, useMemo } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';
import brand from '../../../brand';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DomainConfig {
  label: string; icon: string; color: string;
  initial: string;
  states: string[];
  state_labels: Record<string, string>;
  transitions: Record<string, string[]>;
}

interface XToken {
  token_id: string; token_name: string;
  domain: string; entity: string; state: string;
  payload: Record<string, any>;
  created_by: string; notes: string;
  created_at: string; updated_at: string;
  closed_at?: string;
  ext_ref?: string; ext_system?: string;
  signature: string;
}

interface Schema {
  domains: Record<string, DomainConfig>;
  entities: string[];
}

interface Stats {
  total: number; active: number;
  by_domain: Record<string, number>;
  by_entity: Record<string, number>;
  by_state: Record<string, number>;
  recent: XToken[];
}

interface TokenEvent {
  event_id: string; token_id: string;
  from_state?: string; to_state: string;
  by_user?: string; notes?: string;
  occurred_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function shortId(id: string) { return id.slice(0, 8).toUpperCase(); }

const ENTITY_COLOR: Record<string, string> = {
  empresa_a: '#1976D2', luminet: '#00796B', empresa_b: '#E65100', huus: '#7B1FA2',
};

function extractSummary(token: XToken, schema: Schema): string {
  const p = token.payload;
  const d = token.domain;
  if (d === 'inventory') {
    const lines = p.lines || [];
    const total = lines.reduce((s: number, l: any) => s + (l.quantity || 0), 0);
    return `${p.origin_warehouse || '?'} → ${p.dest_warehouse || '?'}  ·  ${lines.length} producto(s), ${total} pzs`;
  }
  if (d === 'rrhh') {
    const name = p.tecnico || p.nombre || p.agente || '—';
    const tipo = p.tipo_original || '';
    return `${name}  ·  ${tipo}`;
  }
  if (d === 'finanzas') {
    const monto = p.monto || p.precio_preferencial;
    const montoStr = monto ? `$${Number(monto).toLocaleString('es-MX')} MXN` : '';
    return `${p.cliente || p.concepto || p.tipo_original || '—'}  ${montoStr ? '·  ' + montoStr : ''}`;
  }
  if (d === 'noc') {
    return `${p.site || p.titulo || p.descripcion || '—'}`;
  }
  if (d === 'academia') {
    const score = p.score ? `  ·  ${p.score}%` : '';
    return `${p.tecnico || p.nombre || '—'}  ·  ${p.nivel || p.modulo || '—'}${score}`;
  }
  if (d === 'field_service') {
    return `${p.tecnico || '—'}  ·  ${p.sitio || p.cliente || '—'}`;
  }
  return token.notes || token.token_name;
}

// ─── Badge Components ─────────────────────────────────────────────────────────

function DomainBadge({ domain, schema, small }: { domain: string; schema: Schema; small?: boolean }) {
  const cfg = schema.domains[domain];
  if (!cfg) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: `${cfg.color}18`, color: cfg.color,
      border: `1px solid ${cfg.color}35`,
      borderRadius: 5, padding: small ? '1px 6px' : '2px 8px',
      fontSize: small ? 9 : 10, fontWeight: 700,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function StateBadge({ state, domain, schema }: { state: string; domain: string; schema: Schema }) {
  const cfg = schema.domains[domain];
  const label = cfg?.state_labels?.[state] || state;
  const isTerminal = ['received','cancelled','executed','settled','closed','revoked','completed'].includes(state);
  const isActive = !isTerminal && state !== cfg?.initial;
  const color = isTerminal
    ? (state === 'cancelled' || state === 'revoked' ? '#EF4444' : '#10B981')
    : isActive ? '#F59E0B' : '#64748b';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      background: `${color}18`, color,
      border: `1px solid ${color}35`,
      borderRadius: 20, padding: '1px 8px',
      fontSize: 9, fontWeight: 700,
    }}>
      {label}
    </span>
  );
}

function EntityBadge({ entity }: { entity: string }) {
  const color = ENTITY_COLOR[entity] || '#64748b';
  return (
    <span style={{
      display: 'inline-flex',
      background: `${color}15`, color,
      border: `1px solid ${color}30`,
      borderRadius: 4, padding: '1px 6px',
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const,
    }}>
      {entity}
    </span>
  );
}

// ─── Transition Panel ─────────────────────────────────────────────────────────

function TransitionPanel({ token, schema, theme, onDone }: {
  token: XToken; schema: Schema; theme: ThemeConfig; onDone: () => void;
}) {
  const cfg = schema.domains[token.domain];
  const allowed = cfg?.transitions?.[token.state] || [];
  const [selectedState, setSelectedState] = useState(allowed[0] || '');
  const [by, setBy] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  if (!allowed.length) return (
    <div style={{ fontSize: 11, color: '#10B981', padding: '8px 0' }}>
      ✓ Estado terminal — no hay transiciones disponibles.
    </div>
  );

  const handleTransition = async () => {
    if (!by.trim()) { setErr('Ingresa quién hace la transición'); return; }
    setLoading(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/xtokens/${token.token_id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_state: selectedState, transitioned_by: by, notes }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail); }
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    background: 'rgba(0,0,0,0.3)', border: `1px solid ${theme.border}`,
    color: theme.text, borderRadius: 5, padding: '6px 8px', fontSize: 11,
    width: '100%', boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0' }}>
      <div style={{ fontSize: 10, color: theme.dim, fontWeight: 600 }}>TRANSICIÓN DE ESTADO</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>NUEVO ESTADO</label>
          <select value={selectedState} onChange={e => setSelectedState(e.target.value)} style={inputStyle}>
            {allowed.map(s => <option key={s} value={s}>{cfg.state_labels?.[s] || s}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>QUIÉN</label>
          <input value={by} onChange={e => setBy(e.target.value)} placeholder={`tu@${brand.emailDomain}`} style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>NOTAS (OPCIONAL)</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Motivo de la transición..." style={inputStyle} />
      </div>
      {err && <div style={{ fontSize: 10, color: '#EF4444' }}>⚠ {err}</div>}
      <button
        onClick={handleTransition} disabled={loading}
        style={{
          background: cfg.color, color: '#fff', border: 'none', borderRadius: 6,
          padding: '7px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          opacity: loading ? 0.7 : 1, alignSelf: 'flex-start',
        }}
      >
        {loading ? 'Procesando...' : `→ ${cfg.state_labels?.[selectedState] || selectedState}`}
      </button>
    </div>
  );
}

// ─── Payload Viewer ───────────────────────────────────────────────────────────

function PayloadViewer({ payload, domain, theme }: { payload: Record<string, any>; domain: string; theme: ThemeConfig }) {
  const SKIP = ['tipo_original'];

  if (domain === 'inventory') {
    const lines = payload.lines || [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10 }}>
          {[['Origen', payload.origin_warehouse], ['Destino', payload.dest_warehouse],
            ['Prioridad', payload.priority], ['Odoo Picking', payload.odoo_picking_name || '—']].map(([k, v]) => (
            <div key={k}>
              <div style={{ color: theme.dim, marginBottom: 2 }}>{k}</div>
              <div style={{ color: theme.text, fontWeight: 600 }}>{String(v)}</div>
            </div>
          ))}
        </div>
        {lines.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: theme.dim, marginBottom: 5, fontWeight: 600 }}>PRODUCTOS</div>
            {lines.map((l: any, i: number) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between',
                background: 'rgba(255,255,255,0.03)', borderRadius: 4, padding: '5px 8px',
                fontSize: 10, marginBottom: 3,
              }}>
                <span style={{ fontFamily: 'monospace', color: theme.accent || '#60a5fa' }}>[{l.product_ref}]</span>
                <span style={{ color: theme.dim, flex: 1, marginLeft: 8 }}>{l.product_name}</span>
                <span style={{ fontWeight: 700, color: theme.text }}>{l.quantity} {l.uom}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Generic viewer for other domains
  const entries = Object.entries(payload).filter(([k]) => !SKIP.includes(k) && payload[k] !== null);
  if (!entries.length) return <div style={{ fontSize: 10, color: theme.dim }}>Sin datos adicionales registrados</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ fontSize: 10 }}>
          <div style={{ color: theme.dim, fontSize: 9, marginBottom: 1 }}>{k}</div>
          <div style={{ color: theme.text, fontWeight: 500, wordBreak: 'break-word' as const }}>
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Token Detail ─────────────────────────────────────────────────────────────

function TokenDetail({ token, schema, theme, onRefresh }: {
  token: XToken; schema: Schema; theme: ThemeConfig; onRefresh: () => void;
}) {
  const [events, setEvents] = useState<TokenEvent[]>([]);
  const cfg = schema.domains[token.domain];

  useEffect(() => {
    fetch(`${API_BASE}/api/xtokens/${token.token_id}/events`)
      .then(r => r.json()).then(setEvents).catch(() => {});
  }, [token.token_id]);

  return (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: theme.dim }}>#{shortId(token.token_id)}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginTop: 2 }}>{token.token_name}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <StateBadge state={token.state} domain={token.domain} schema={schema} />
          <EntityBadge entity={token.entity} />
        </div>
      </div>

      <div>
        <div style={{ fontSize: 9, color: theme.dim, fontWeight: 600, marginBottom: 6 }}>DATOS</div>
        <PayloadViewer payload={token.payload} domain={token.domain} theme={theme} />
      </div>

      {token.notes && (
        <div style={{ fontSize: 10, color: theme.dim, fontStyle: 'italic' }}>📝 {token.notes}</div>
      )}

      {token.ext_ref && (
        <div style={{ fontSize: 9, color: theme.dim, fontFamily: 'monospace' }}>
          🔗 {token.ext_system}: {token.ext_ref}
        </div>
      )}

      <div>
        <div style={{ fontSize: 9, color: theme.dim, fontWeight: 600, marginBottom: 6 }}>HISTORIAL</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
          {events.map(ev => (
            <div key={ev.event_id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 10, color: theme.dim,
            }}>
              <span style={{ fontSize: 8, width: 90, flexShrink: 0 }}>
                {new Date(ev.occurred_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ color: cfg?.color, fontWeight: 600 }}>
                {ev.from_state ? `${cfg?.state_labels?.[ev.from_state] || ev.from_state} → ` : ''}
                {cfg?.state_labels?.[ev.to_state] || ev.to_state}
              </span>
              {ev.by_user && <span>por {ev.by_user}</span>}
            </div>
          ))}
        </div>
      </div>

      <TransitionPanel token={token} schema={schema} theme={theme} onDone={onRefresh} />
    </div>
  );
}

// ─── New Token Form ───────────────────────────────────────────────────────────

function NewTokenForm({ schema, theme, onCreated, onCancel }: {
  schema: Schema; theme: ThemeConfig; onCreated: () => void; onCancel: () => void;
}) {
  const accent = theme.accent || '#60a5fa';
  const [domain, setDomain] = useState('inventory');
  const [entity, setEntity] = useState('empresa_a');
  const [createdBy, setCreatedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [payload, setPayload] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const cfg = schema.domains[domain];

  // Domain-specific quick fields
  const renderDomainFields = () => {
    const inputStyle = {
      background: 'rgba(0,0,0,0.3)', border: `1px solid ${theme.border}`,
      color: theme.text, borderRadius: 5, padding: '6px 8px', fontSize: 11,
      width: '100%', boxSizing: 'border-box' as const,
    };
    const set = (k: string, v: any) => setPayload(p => ({ ...p, [k]: v }));

    if (domain === 'inventory') return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['origin_warehouse','Origen','CDMX'],['dest_warehouse','Destino','MTY']].map(([k,l,ph]) => (
          <div key={k}>
            <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>{l}</label>
            <select value={payload[k]||'CDMX'} onChange={e=>set(k,e.target.value)} style={inputStyle}>
              {['CDMX','QRO','GDL','MTY'].map(w=><option key={w} value={w}>{w}</option>)}
            </select>
          </div>
        ))}
        <div style={{ gridColumn: '1/-1' }}>
          <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>PRODUCTO (referencia)</label>
          <input placeholder="C5X-500" style={inputStyle}
            onChange={e => set('lines', [{ product_ref: e.target.value, product_name: '', quantity: 1, uom: 'pza' }])} />
        </div>
      </div>
    );

    if (domain === 'rrhh') return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['tecnico','Colaborador'],['tipo_original','Tipo de movimiento']].map(([k,l]) => (
          <div key={k}>
            <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>{l.toUpperCase()}</label>
            {k === 'tipo_original' ? (
              <select value={payload[k]||'alta'} onChange={e=>set(k,e.target.value)} style={inputStyle}>
                {['alta','baja','promocion','movimiento','cambio_area','agente_ia'].map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            ) : (
              <input placeholder="Nombre completo" style={inputStyle}
                value={payload[k]||''} onChange={e=>set(k,e.target.value)} />
            )}
          </div>
        ))}
      </div>
    );

    if (domain === 'finanzas') return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['concepto','Concepto'],['monto','Monto MXN'],['empresa_destino','Empresa destino']].map(([k,l]) => (
          <div key={k}>
            <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>{l.toUpperCase()}</label>
            <input type={k==='monto'?'number':'text'} placeholder={l} style={inputStyle}
              value={payload[k]||''} onChange={e=>set(k,k==='monto'?Number(e.target.value):e.target.value)} />
          </div>
        ))}
      </div>
    );

    if (domain === 'noc') return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['site','Sitio'],['titulo','Título del incidente'],['severidad','Severidad']].map(([k,l]) => (
          <div key={k}>
            <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>{l.toUpperCase()}</label>
            {k === 'severidad' ? (
              <select value={payload[k]||'media'} onChange={e=>set(k,e.target.value)} style={inputStyle}>
                {['critica','alta','media','baja'].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input placeholder={l} style={inputStyle} value={payload[k]||''} onChange={e=>set(k,e.target.value)} />
            )}
          </div>
        ))}
      </div>
    );

    if (domain === 'academia') return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['tecnico','Colaborador'],['nivel','Nivel alcanzado'],['score','Score (%)'],['modulo','Módulo/Curso']].map(([k,l]) => (
          <div key={k}>
            <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>{l.toUpperCase()}</label>
            <input type={k==='score'?'number':'text'} placeholder={l} style={inputStyle}
              value={payload[k]||''} onChange={e=>set(k,k==='score'?Number(e.target.value):e.target.value)} />
          </div>
        ))}
      </div>
    );

    if (domain === 'field_service') return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['tecnico','Técnico'],['cliente','Cliente'],['sitio','Sitio'],['tipo_servicio','Tipo de servicio']].map(([k,l]) => (
          <div key={k}>
            <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>{l.toUpperCase()}</label>
            <input placeholder={l} style={inputStyle} value={payload[k]||''} onChange={e=>set(k,e.target.value)} />
          </div>
        ))}
      </div>
    );

    return null;
  };

  const handleSubmit = async () => {
    if (!createdBy.trim()) { setErr('Ingresa quién crea el token'); return; }
    setSaving(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/xtokens/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, entity, created_by: createdBy, notes, payload }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail); }
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    background: 'rgba(0,0,0,0.3)', border: `1px solid ${theme.border}`,
    color: theme.text, borderRadius: 5, padding: '6px 8px', fontSize: 11,
    width: '100%', boxSizing: 'border-box' as const,
  };

  return (
    <div style={{
      background: theme.card, border: `2px solid ${accent}`,
      borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: theme.text }}>Nuevo Token</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>DOMINIO</label>
          <select value={domain} onChange={e => setDomain(e.target.value)} style={inputStyle}>
            {Object.entries(schema.domains).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>ENTIDAD</label>
          <select value={entity} onChange={e => setEntity(e.target.value)} style={inputStyle}>
            {schema.entities.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>CREADO POR</label>
          <input value={createdBy} onChange={e => setCreatedBy(e.target.value)}
            placeholder={`tu@${brand.emailDomain}`} style={inputStyle} />
        </div>
      </div>

      {/* Domain-specific fields */}
      {renderDomainFields()}

      <div>
        <label style={{ fontSize: 9, color: theme.dim, display: 'block', marginBottom: 3 }}>NOTAS</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Descripción..." style={inputStyle} />
      </div>

      {err && <div style={{ fontSize: 10, color: '#EF4444', background: 'rgba(239,68,68,0.1)', borderRadius: 5, padding: '6px 10px' }}>⚠ {err}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim, borderRadius: 6, padding: '7px 14px', fontSize: 11, cursor: 'pointer' }}>
          Cancelar
        </button>
        <button onClick={handleSubmit} disabled={saving}
          style={{ background: cfg?.color || accent, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 18px', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Emitiendo...' : `${cfg?.icon || '+'} Emitir Token`}
        </button>
      </div>
    </div>
  );
}

// ─── Token Row ────────────────────────────────────────────────────────────────

function TokenRow({ token, schema, theme, selected, onSelect }: {
  token: XToken; schema: Schema; theme: ThemeConfig; selected: boolean; onSelect: () => void;
}) {
  const cfg = schema.domains[token.domain];
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'grid', gridTemplateColumns: '18px 1fr 80px 70px 90px',
        gap: 10, alignItems: 'center',
        background: selected ? `${cfg?.color}12` : 'transparent',
        border: `1px solid ${selected ? (cfg?.color || theme.border) : 'transparent'}`,
        borderRadius: 6, padding: '8px 12px', cursor: 'pointer',
        transition: 'background 0.1s',
      }}
    >
      <span style={{ fontSize: 12 }}>{cfg?.icon || '🔖'}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: cfg?.color || theme.dim, marginBottom: 1 }}>
          {token.token_name}
        </div>
        <div style={{ fontSize: 11, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {extractSummary(token, schema)}
        </div>
      </div>
      <EntityBadge entity={token.entity} />
      <StateBadge state={token.state} domain={token.domain} schema={schema} />
      <div style={{ fontSize: 9, color: theme.dim, textAlign: 'right' as const }}>
        {fmt(token.created_at)}
      </div>
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats, schema, theme, activeDomain, onDomainClick }: {
  stats: Stats; schema: Schema; theme: ThemeConfig;
  activeDomain: string | null; onDomainClick: (d: string | null) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <div
        onClick={() => onDomainClick(null)}
        style={{
          background: !activeDomain ? (theme.accent || '#60a5fa') + '20' : theme.card,
          border: `1px solid ${!activeDomain ? (theme.accent || '#60a5fa') : theme.border}`,
          borderRadius: 8, padding: '10px 14px', cursor: 'pointer', textAlign: 'center' as const,
          minWidth: 70,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800, color: theme.accent || '#60a5fa' }}>{stats.total}</div>
        <div style={{ fontSize: 9, color: theme.dim, marginTop: 2 }}>Total</div>
      </div>

      {Object.entries(schema.domains).map(([key, cfg]) => {
        const count = stats.by_domain[key] || 0;
        const active = activeDomain === key;
        return (
          <div
            key={key}
            onClick={() => onDomainClick(active ? null : key)}
            style={{
              background: active ? `${cfg.color}20` : theme.card,
              border: `1px solid ${active ? cfg.color : theme.border}`,
              borderRadius: 8, padding: '10px 14px', cursor: 'pointer', textAlign: 'center' as const,
              minWidth: 70, transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 9, marginBottom: 2 }}>{cfg.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{count}</div>
            <div style={{ fontSize: 9, color: theme.dim, marginTop: 1 }}>{cfg.label}</div>
          </div>
        );
      })}

      <div style={{
        background: theme.card, border: `1px solid ${theme.border}`,
        borderRadius: 8, padding: '10px 14px', textAlign: 'center' as const, minWidth: 70,
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#F59E0B' }}>{stats.active}</div>
        <div style={{ fontSize: 9, color: theme.dim, marginTop: 2 }}>Activos</div>
      </div>
    </div>
  );
}

// ─── Main Section ─────────────────────────────────────────────────────────────

export default function XcienTokensSection({ theme }: { theme: ThemeConfig }) {
  const accent = theme.accent || '#60a5fa';

  const [schema, setSchema] = useState<Schema | null>(null);
  const [tokens, setTokens] = useState<XToken[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('active');
  const [search, setSearch] = useState('');

  const loadSchema = useCallback(async () => {
    const r = await fetch(`${API_BASE}/api/xtokens/schema`);
    setSchema(await r.json());
  }, []);

  const loadTokens = useCallback(async () => {
    if (!schema) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (domainFilter) params.append('domain', domainFilter);
      if (entityFilter !== 'all') params.append('entity', entityFilter);
      if (search) params.append('search', search);

      const [tokensRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/xtokens/?${params}`).then(r => r.json()),
        fetch(`${API_BASE}/api/xtokens/stats`).then(r => r.json()),
      ]);
      setTokens(Array.isArray(tokensRes) ? tokensRes : []);
      setStats(statsRes);
    } catch { setTokens([]); }
    setLoading(false);
  }, [schema, domainFilter, entityFilter, search]);

  useEffect(() => { loadSchema(); }, []);
  useEffect(() => { if (schema) loadTokens(); }, [schema, domainFilter, entityFilter, search]);

  const TERMINAL = new Set(['received','cancelled','executed','settled','closed','revoked','completed']);

  const filtered = useMemo(() => {
    if (stateFilter === 'active') return tokens.filter(t => !TERMINAL.has(t.state));
    if (stateFilter === 'terminal') return tokens.filter(t => TERMINAL.has(t.state));
    if (stateFilter !== 'all') return tokens.filter(t => t.state === stateFilter);
    return tokens;
  }, [tokens, stateFilter]);

  const selected = tokens.find(t => t.token_id === selectedId) || null;

  if (!schema) return (
    <div style={{ color: theme.dim, textAlign: 'center', padding: 60, fontSize: 13 }}>
      Cargando sistema de tokens...
    </div>
  );

  const selectStyle = {
    background: 'rgba(0,0,0,0.3)', border: `1px solid ${theme.border}`,
    color: theme.text, borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: theme.text }}>
            {`Tokens ${brand.name} — Sistema Unificado`}
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: theme.dim }}>
            Inventario · RRHH · Finanzas · NOC · Academia · Campo — un solo registro, todos los dominios
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={loadTokens} style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.dim, borderRadius: 7, padding: '7px 12px', fontSize: 11, cursor: 'pointer' }}>
            ↺
          </button>
          <button
            onClick={() => { setShowForm(!showForm); setSelectedId(null); }}
            style={{ background: accent, color: '#000', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            {showForm ? '✕ Cancelar' : '+ Emitir Token'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <StatsBar
          stats={stats} schema={schema} theme={theme}
          activeDomain={domainFilter}
          onDomainClick={d => { setDomainFilter(d); setSelectedId(null); }}
        />
      )}

      {/* Form */}
      {showForm && (
        <NewTokenForm
          schema={schema} theme={theme}
          onCreated={() => { setShowForm(false); loadTokens(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar tokens..."
          style={{ ...selectStyle, width: 180, padding: '5px 10px' }}
        />
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} style={selectStyle}>
          <option value="all">Todas las entidades</option>
          {schema.entities.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} style={selectStyle}>
          <option value="all">Todos los estados</option>
          <option value="active">Solo activos</option>
          <option value="terminal">Solo terminados</option>
        </select>
        <span style={{ fontSize: 11, color: theme.dim }}>
          {filtered.length} token{filtered.length !== 1 ? 's' : ''}
          {domainFilter && schema.domains[domainFilter] && ` · ${schema.domains[domainFilter].icon} ${schema.domains[domainFilter].label}`}
        </span>
      </div>

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 16, alignItems: 'start' }}>

        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '18px 1fr 80px 70px 90px',
            gap: 10, padding: '4px 12px', fontSize: 9, color: theme.dim, fontWeight: 600,
          }}>
            <span />
            <span>TOKEN / RESUMEN</span>
            <span>ENTIDAD</span>
            <span>ESTADO</span>
            <span style={{ textAlign: 'right' as const }}>FECHA</span>
          </div>

          {loading ? (
            <div style={{ color: theme.dim, textAlign: 'center', padding: 40 }}>Cargando historial de tokens…</div>
          ) : filtered.length === 0 ? (
            <div style={{ background: theme.card, border: `1px dashed ${theme.border}`, borderRadius: 8, padding: 40, textAlign: 'center' as const }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🔖</div>
              <div style={{ fontSize: 12, color: theme.dim }}>
                {tokens.length === 0 ? 'No hay tokens. Emite el primero.' : 'Sin resultados con ese filtro.'}
              </div>
            </div>
          ) : (
            filtered.map(t => (
              <TokenRow
                key={t.token_id} token={t} schema={schema} theme={theme}
                selected={t.token_id === selectedId}
                onSelect={() => setSelectedId(t.token_id === selectedId ? null : t.token_id)}
              />
            ))
          )}
        </div>

        {/* Detail */}
        {selected && (
          <TokenDetail
            token={selected} schema={schema} theme={theme}
            onRefresh={() => { loadTokens(); }}
          />
        )}
      </div>

      {/* Footer note */}
      <div style={{
        background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
        borderRadius: 8, padding: '8px 14px', fontSize: 10, color: '#10B981',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>🔗</span>
        <span>
          <strong>Odoo-Ready</strong> — inventory → stock.picking · rrhh → hr.employee · finanzas → account.move · noc → helpdesk.ticket
        </span>
      </div>
    </div>
  );
}
