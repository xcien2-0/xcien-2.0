import { ThemeConfig } from '../types';
import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../../config';
import brand from '../../../brand';

interface AuthUser {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  plaza: string;
  activo: boolean;
  creado_en: string;
  ultimo_login: string | null;
}

// ── Definición de áreas ───────────────────────────────────────────────────────
const AREAS = [
  { rol: 'director',  label: 'Dirección General',   icon: '🏢', color: '#7c3aed', desc: 'Dashboards ejecutivos, reportes, chat IA' },
  { rol: 'noc',       label: 'NOC',                  icon: '📡', color: '#0ea5e9', desc: 'Red, alertas, monitoreo, infraestructura' },
  { rol: 'wfm',       label: 'Operaciones / WFM',    icon: '🏗️', color: '#f59e0b', desc: 'Tickets, cuadrillas, órdenes de campo' },
  { rol: 'comercial', label: 'Comercial',             icon: '💰', color: '#10b981', desc: 'Ventas, integridad, KPIs comerciales' },
  { rol: 'preventa',  label: 'Preventa',              icon: '📐', color: '#06b6d4', desc: 'Cotizaciones, factibilidad, proyectos' },
  { rol: 'almacen',   label: 'Almacén',               icon: '📦', color: '#f97316', desc: 'Inventario, transferencias, materiales' },
  { rol: 'rrhh',      label: 'Recursos Humanos',      icon: '👥', color: '#ec4899', desc: 'Directorio, academia, nómina' },
  { rol: 'academico', label: 'Academia / Entregas',   icon: '🎓', color: '#a78bfa', desc: 'Capacitación, manuales, exámenes' },
  { rol: 'tecnico',   label: 'Técnicos de Campo',     icon: '🔧', color: '#34d399', desc: 'Mis tickets, checklist, evidencias' },
  { rol: 'readonly',  label: 'Solo lectura',          icon: '👁️', color: '#94a3b8', desc: 'Consulta sin modificar' },
  { rol: 'admin',     label: 'Administración',        icon: '🔐', color: '#ef4444', desc: 'Acceso total al sistema' },
];

const PLAZAS = ['Monterrey', 'Saltillo', 'Reynosa', 'Querétaro', 'Guadalajara', 'CDMX', 'Otra'];

function fmtDate(ts: string | null) {
  if (!ts) return 'Nunca';
  try {
    return new Date(ts).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return ts; }
}

// ── Modal de nuevo usuario ────────────────────────────────────────────────────
function NewUserModal({
  theme, defaultRol, onClose, onCreated,
}: {
  theme: ThemeConfig;
  defaultRol: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ nombre: '', email: '', password: '', plaza: 'Monterrey', rol: defaultRol });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const A = theme.accent;
  const area = AREAS.find(a => a.rol === form.rol) ?? AREAS[0];

  const submit = async () => {
    if (!form.nombre || !form.email || !form.password) { setError('Nombre, correo y contraseña son obligatorios'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/usuarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) { onCreated(); onClose(); }
      else {
        const e = await res.json().catch(() => ({}));
        setError(e.detail ?? 'No se pudo crear el usuario. Intenta de nuevo.');
      }
    } catch { setError('Error de conexión'); }
    setSaving(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: theme.card, border: `1px solid ${theme.border}`,
        borderRadius: 16, padding: 28, width: 480, maxWidth: '95vw',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Nuevo usuario</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              <span style={{ color: area.color }}>{area.icon} {area.label}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* Campos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Nombre completo', key: 'nombre' as const, type: 'text', placeholder: 'Ing. Roberto Garza' },
            { label: 'Correo', key: 'email' as const, type: 'email', placeholder: `usuario@${brand.emailDomain}` },
            { label: 'Contraseña inicial', key: 'password' as const, type: 'password', placeholder: '••••••••' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>{f.label}</label>
              <input
                type={f.type} value={form[f.key]} placeholder={f.placeholder}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${theme.border}`, borderRadius: 8, padding: '9px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          ))}

          {/* Plaza */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>Plaza</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PLAZAS.map(p => (
                <button key={p} onClick={() => setForm(f => ({ ...f, plaza: p }))}
                  style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${form.plaza === p ? A : theme.border}`, background: form.plaza === p ? `${A}14` : 'transparent', color: form.plaza === p ? A : '#6b7280', fontSize: 11, cursor: 'pointer' }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Área/Rol */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>Área</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {AREAS.map(a => (
                <button key={a.rol} onClick={() => setForm(f => ({ ...f, rol: a.rol }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px',
                    borderRadius: 8, border: `1px solid ${form.rol === a.rol ? a.color : theme.border}`,
                    background: form.rol === a.rol ? `${a.color}12` : 'transparent',
                    color: form.rol === a.rol ? a.color : '#6b7280',
                    fontSize: 11, fontWeight: form.rol === a.rol ? 700 : 400, cursor: 'pointer', textAlign: 'left',
                  }}>
                  <span>{a.icon}</span> {a.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ padding: '9px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontSize: 12 }}>
              {error}
            </div>
          )}

          <button onClick={submit} disabled={saving}
            style={{ marginTop: 4, padding: '11px', borderRadius: 10, background: saving ? `${A}60` : A, border: 'none', color: '#000', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Creando...' : 'Crear usuario'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Panel de detalle de área ──────────────────────────────────────────────────
function AreaPanel({
  area, users, theme, onAddUser,
}: {
  area: typeof AREAS[number];
  users: AuthUser[];
  theme: ThemeConfig;
  onAddUser: () => void;
}) {
  const active   = users.filter(u => u.activo).length;
  const inactive = users.length - active;

  return (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: 14, overflow: 'hidden',
    }}>
      {/* Área header */}
      <div style={{ height: 3, background: area.color }} />
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${area.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
          {area.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{area.label}</div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>{area.desc}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {users.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: area.color, fontFamily: 'Oswald, sans-serif', lineHeight: 1 }}>{users.length}</div>
              <div style={{ fontSize: 9, color: '#6b7280' }}>{active} activos{inactive > 0 ? `, ${inactive} inact.` : ''}</div>
            </div>
          )}
          <button onClick={onAddUser} style={{
            background: `${area.color}15`, border: `1px solid ${area.color}30`,
            color: area.color, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}>
            + Agregar
          </button>
        </div>
      </div>

      {/* User list */}
      {users.length === 0 ? (
        <div style={{ padding: '20px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', border: `1px dashed ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>?</div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Sin usuarios asignados</div>
            <div style={{ fontSize: 10, color: '#374151', marginTop: 1 }}>Agrega el primer integrante de esta área</div>
          </div>
        </div>
      ) : (
        <div>
          {users.map((u, i) => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px',
              borderBottom: i < users.length - 1 ? `1px solid ${theme.border}` : 'none',
            }}>
              {/* Avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: u.activo ? `${area.color}20` : 'rgba(255,255,255,0.04)',
                border: `1.5px solid ${u.activo ? area.color + '40' : theme.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, color: u.activo ? area.color : '#6b7280',
              }}>
                {u.nombre.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nombre}</div>
                <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
              </div>

              {/* Plaza */}
              {u.plaza && (
                <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>📍 {u.plaza}</span>
              )}

              {/* Último login */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 10, color: u.ultimo_login ? '#6b7280' : '#374151' }}>
                  {u.ultimo_login ? fmtDate(u.ultimo_login) : 'Sin acceso aún'}
                </div>
                {!u.ultimo_login && (
                  <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 1 }}>● Pendiente activación</div>
                )}
              </div>

              {/* Estado */}
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', flexShrink: 0,
                padding: '2px 7px', borderRadius: 20,
                background: u.activo ? `${area.color}12` : 'rgba(239,68,68,0.08)',
                color: u.activo ? area.color : '#ef4444',
                border: `1px solid ${u.activo ? area.color + '25' : 'rgba(239,68,68,0.2)'}`,
              }}>
                {u.activo ? 'Activo' : 'Inactivo'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdopcionSection({ theme }: { theme: ThemeConfig }) {
  const [users, setUsers]         = useState<AuthUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modalRol, setModalRol]   = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const A = theme.accent;

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/usuarios`);
      if (res.ok) setUsers(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const filteredAreas = useMemo(() => {
    const q = search.toLowerCase();
    return AREAS.map(area => ({
      ...area,
      users: users.filter(u => {
        const matchArea = u.rol === area.rol;
        const matchSearch = !q || u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.plaza?.toLowerCase().includes(q);
        return matchArea && matchSearch;
      }),
    }));
  }, [users, search]);

  // KPIs
  const totalActivos  = users.filter(u => u.activo).length;
  const totalLogueado = users.filter(u => u.ultimo_login).length;
  const areasConUsers = AREAS.filter(a => users.some(u => u.rol === a.rol)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 16, borderBottom: `2px solid ${A}` }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>👥 Usuarios por Área</h2>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
            Gestión de acceso al portal · segmentado por departamento
          </p>
        </div>
        <button onClick={() => setModalRol('readonly')}
          style={{ background: A, color: '#000', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
          + Nuevo usuario
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Total usuarios',    val: loading ? '…' : String(users.length),       color: A,         icon: '👤' },
          { label: 'Activos',           val: loading ? '…' : String(totalActivos),        color: '#10b981', icon: '✅' },
          { label: 'Han ingresado',     val: loading ? '…' : String(totalLogueado),       color: '#0ea5e9', icon: '🔓' },
          { label: 'Áreas cubiertas',   val: loading ? '…' : `${areasConUsers}/${AREAS.length}`, color: '#f59e0b', icon: '🏢' },
        ].map((k, i) => (
          <div key={i} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: k.color }} />
            <div style={{ fontSize: 16, marginBottom: 4 }}>{k.icon}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color, fontFamily: 'Oswald, sans-serif', lineHeight: 1 }}>{k.val}</div>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Buscador */}
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar usuario por nombre, correo o plaza..."
          style={{ width: '100%', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '9px 14px 9px 34px', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
      </div>

      {/* Grid de áreas */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Cargando usuarios...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {filteredAreas.map(area => (
            <AreaPanel
              key={area.rol}
              area={area}
              users={area.users}
              theme={theme}
              onAddUser={() => setModalRol(area.rol)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modalRol !== null && (
        <NewUserModal
          theme={theme}
          defaultRol={modalRol}
          onClose={() => setModalRol(null)}
          onCreated={fetchUsers}
        />
      )}
    </div>
  );
}
