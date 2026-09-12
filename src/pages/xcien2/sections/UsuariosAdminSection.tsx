import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../../../config';
import { Users, Plus, RefreshCw, Shield, CheckCircle, XCircle, Edit2, Key, Trash2, X, Save, Eye, EyeOff } from 'lucide-react';

const ROLE_META: Record<string, { label: string; color: string; bg: string; desc: string }> = {
  admin:     { label: 'Admin',       color: '#EF4444', bg: 'rgba(239,68,68,.15)',   desc: 'Acceso total al sistema' },
  director:  { label: 'Director',    color: '#8B5CF6', bg: 'rgba(139,92,246,.15)',  desc: 'Operaciones + finanzas + estrategia' },
  finanzas:  { label: 'Finanzas',    color: '#F59E0B', bg: 'rgba(245,158,11,.15)',  desc: 'Datos financieros y auditoría' },
  noc:       { label: 'NOC',         color: '#0EA5E9', bg: 'rgba(14,165,233,.15)',  desc: 'Red, alertas, monitoreo' },
  wfm:       { label: 'WFM',         color: '#F97316', bg: 'rgba(249,115,22,.15)',  desc: 'Campo, tickets, inventario' },
  comercial: { label: 'Comercial',   color: '#10B981', bg: 'rgba(16,185,129,.15)',  desc: 'Proyectos y sala de juntas' },
  preventa:  { label: 'Preventa',    color: '#06B6D4', bg: 'rgba(6,182,212,.15)',   desc: 'Propuestas y proyectos' },
  almacen:   { label: 'Almacén',     color: '#F59E0B', bg: 'rgba(245,158,11,.12)',  desc: 'Inventario físico' },
  rrhh:      { label: 'Capital Humano', color: '#EC4899', bg: 'rgba(236,72,153,.15)', desc: 'Directorio de personal' },
  academico: { label: 'Académico',   color: '#A78BFA', bg: 'rgba(167,139,250,.15)', desc: 'Cursos y certificaciones' },
  tecnico:   { label: 'Técnico',     color: '#34D399', bg: 'rgba(52,211,153,.15)',  desc: 'Academia y docs técnicos' },
  readonly:  { label: 'Solo lectura',color: '#6B7280', bg: 'rgba(107,114,128,.15)', desc: 'Hub principal únicamente' },
};

const PLAZAS = ['AGS', 'MTY', 'SLT', 'PN', 'PDN', 'CDMX', 'QRO', 'GDL', ''];

interface Usuario {
  id: string; nombre: string; email: string; rol: string; plaza: string;
  activo: boolean; creado_en: string | null; ultimo_login: string | null;
}

function RolBadge({ rol }: { rol: string }) {
  const m = ROLE_META[rol] ?? { label: rol, color: '#6B7280', bg: 'rgba(107,114,128,.15)', desc: '' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
      background: m.bg, color: m.color, border: `1px solid ${m.color}33`,
      borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700,
      fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso.slice(0, 16).replace('T', ' '); }
}

export default function UsuariosAdminSection() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [filterRol, setFilterRol] = useState('');

  // Panel edición
  const [editing, setEditing]   = useState<Usuario | null>(null);
  const [editData, setEditData] = useState<Partial<Usuario>>({});
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState('');

  // Reset password
  const [resetId, setResetId]   = useState<string | null>(null);
  const [newPass, setNewPass]   = useState('');
  const [showPass, setShowPass] = useState(false);
  const [resetMsg, setResetMsg] = useState('');

  // Crear usuario
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser]   = useState({ nombre:'', email:'', password:'', rol:'noc', plaza:'' });
  const [createMsg, setCreateMsg] = useState('');

  const token = () => localStorage.getItem('xcien_token') || '';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/auth/usuarios`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      setUsuarios(Array.isArray(json) ? json : json.usuarios ?? []);
    } catch (e: any) { setError(e.message || 'No se pudo cargar el directorio de usuarios'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (u: Usuario) => { setEditing(u); setEditData({ nombre: u.nombre, rol: u.rol, plaza: u.plaza, activo: u.activo }); setSaveMsg(''); };
  const closeEdit = () => { setEditing(null); setEditData({}); setSaveMsg(''); };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true); setSaveMsg('');
    try {
      const r = await fetch(`${API_BASE}/api/auth/usuarios/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(editData),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Error'); }
      setSaveMsg('Guardado');
      await load();
      setTimeout(closeEdit, 800);
    } catch (e: any) { setSaveMsg('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const toggleActivo = async (u: Usuario) => {
    try {
      await fetch(`${API_BASE}/api/auth/usuarios/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ activo: !u.activo }),
      });
      await load();
    } catch {}
  };

  const resetPassword = async () => {
    if (!resetId || newPass.length < 8) return;
    try {
      const r = await fetch(`${API_BASE}/api/auth/usuarios/${resetId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ password: newPass }),
      });
      if (!r.ok) throw new Error('No se pudo resetear el acceso del usuario');
      setResetMsg('Contraseña actualizada'); setNewPass('');
      setTimeout(() => { setResetId(null); setResetMsg(''); }, 1200);
    } catch (e: any) { setResetMsg('Error: ' + e.message); }
  };

  const crearUsuario = async () => {
    setCreateMsg('');
    if (!newUser.nombre || !newUser.email || !newUser.password) { setCreateMsg('Completa nombre, email y contraseña'); return; }
    try {
      const r = await fetch(`${API_BASE}/api/auth/usuarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(newUser),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Error'); }
      setCreateMsg('Usuario creado');
      setNewUser({ nombre:'', email:'', password:'', rol:'noc', plaza:'' });
      await load();
      setTimeout(() => { setCreating(false); setCreateMsg(''); }, 1000);
    } catch (e: any) { setCreateMsg('Error: ' + e.message); }
  };

  const filtered = usuarios.filter(u => {
    const q = search.toLowerCase();
    const matchQ = !q || u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.plaza.toLowerCase().includes(q);
    const matchR = !filterRol || u.rol === filterRol;
    return matchQ && matchR;
  });

  const C = { bg:'#060A10', card:'#0B1420', card2:'#0F1A28', border:'rgba(255,255,255,.07)', text:'#E0EAF4', body:'#60798A', dim:'#2A3D4D', accent:'#00C896' };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: "'Inter', sans-serif" }}>

      {/* Header */}
      <div style={{ padding: '24px 28px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Users size={20} color={C.accent} />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Gestión de Usuarios</h2>
          </div>
          <div style={{ fontSize: 12, color: C.body }}>{usuarios.length} usuarios registrados · Control de acceso por rol</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} disabled={loading} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 12px', color: C.body, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Actualizar
          </button>
          <button onClick={() => setCreating(true)} style={{ background: C.accent + '18', border: `1px solid ${C.accent}44`, borderRadius: 6, padding: '7px 14px', color: C.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600 }}>
            <Plus size={14} /> Nuevo usuario
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: '12px 28px', display: 'flex', gap: 10, borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, email o plaza…"
          style={{ flex: 1, minWidth: 200, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 12px', color: C.text, fontSize: 12, outline: 'none' }} />
        <select value={filterRol} onChange={e => setFilterRol(e.target.value)}
          style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 12px', color: C.text, fontSize: 12, cursor: 'pointer', minWidth: 140 }}>
          <option value="">Todos los roles</option>
          {Object.entries(ROLE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {Object.entries(
            filtered.reduce((acc, u) => { acc[u.rol] = (acc[u.rol] || 0) + 1; return acc; }, {} as Record<string,number>)
          ).sort().map(([rol, n]) => {
            const m = ROLE_META[rol];
            if (!m) return null;
            return <span key={rol} style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}33`, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>{m.label} {n}</span>;
          })}
        </div>
      </div>

      {error && <div style={{ margin: '12px 28px', padding: '10px 14px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, color: '#FCA5A5', fontSize: 12 }}>{error}</div>}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ background: C.card }}>
              {['Usuario', 'Rol', 'Plaza', 'Estado', 'Último acceso', 'Creado', 'Acciones'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.body, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: C.dim, fontSize: 12 }}>{search || filterRol ? 'Sin resultados para el filtro.' : 'Sin usuarios registrados.'}</td></tr>
            )}
            {filtered.map((u, i) => (
              <tr key={u.id} style={{ background: i % 2 === 0 ? C.card : C.bg, transition: 'background .15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = C.card2)}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? C.card : C.bg)}>

                {/* Usuario */}
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: (ROLE_META[u.rol]?.bg ?? 'rgba(255,255,255,.05)'), border: `1.5px solid ${ROLE_META[u.rol]?.color ?? '#6B7280'}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: ROLE_META[u.rol]?.color ?? '#6B7280', flexShrink: 0 }}>
                      {(u.nombre || u.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{u.nombre}</div>
                      <div style={{ fontSize: 11, color: C.body }}>{u.email}</div>
                    </div>
                  </div>
                </td>

                {/* Rol */}
                <td style={{ padding: '12px 16px' }}><RolBadge rol={u.rol} /></td>

                {/* Plaza */}
                <td style={{ padding: '12px 16px', fontSize: 12, color: u.plaza ? C.text : C.dim, fontFamily: 'monospace' }}>{u.plaza || '—'}</td>

                {/* Estado */}
                <td style={{ padding: '12px 16px' }}>
                  <button onClick={() => toggleActivo(u)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {u.activo
                      ? <><CheckCircle size={14} color="#00C896" /><span style={{ fontSize: 11, color: '#00C896', fontWeight: 600 }}>Activo</span></>
                      : <><XCircle size={14} color="#EF4444" /><span style={{ fontSize: 11, color: '#EF4444', fontWeight: 600 }}>Inactivo</span></>}
                  </button>
                </td>

                {/* Último acceso */}
                <td style={{ padding: '12px 16px', fontSize: 11, color: C.body, whiteSpace: 'nowrap' }}>{fmtDate(u.ultimo_login)}</td>

                {/* Creado */}
                <td style={{ padding: '12px 16px', fontSize: 11, color: C.dim, whiteSpace: 'nowrap' }}>{fmtDate(u.creado_en)}</td>

                {/* Acciones */}
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openEdit(u)} title="Editar" style={{ background: 'rgba(0,200,150,.1)', border: '1px solid rgba(0,200,150,.2)', borderRadius: 5, padding: '5px 8px', cursor: 'pointer', color: C.accent, display: 'flex', alignItems: 'center' }}>
                      <Edit2 size={12} />
                    </button>
                    <button onClick={() => { setResetId(u.id); setNewPass(''); setResetMsg(''); }} title="Cambiar contraseña" style={{ background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 5, padding: '5px 8px', cursor: 'pointer', color: '#F59E0B', display: 'flex', alignItems: 'center' }}>
                      <Key size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Panel de edición ── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 28, width: 440, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{editing.nombre}</div>
                <div style={{ fontSize: 12, color: C.body }}>{editing.email}</div>
              </div>
              <button onClick={closeEdit} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.body, padding: 4 }}><X size={18} /></button>
            </div>

            {/* Rol */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.body, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>Rol</label>
              <select value={editData.rol ?? editing.rol} onChange={e => setEditData(d => ({ ...d, rol: e.target.value }))}
                style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 12px', color: C.text, fontSize: 13, cursor: 'pointer' }}>
                {Object.entries(ROLE_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label} — {v.desc}</option>
                ))}
              </select>
              {editData.rol && <div style={{ marginTop: 6, fontSize: 11, color: ROLE_META[editData.rol]?.color }}>
                <Shield size={10} style={{ display: 'inline', marginRight: 4 }} />{ROLE_META[editData.rol]?.desc}
              </div>}
            </div>

            {/* Plaza */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.body, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>Plaza</label>
              <select value={editData.plaza ?? editing.plaza} onChange={e => setEditData(d => ({ ...d, plaza: e.target.value }))}
                style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 12px', color: C.text, fontSize: 13, cursor: 'pointer' }}>
                {PLAZAS.map(p => <option key={p} value={p}>{p || '— Sin plaza —'}</option>)}
              </select>
            </div>

            {/* Nombre */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.body, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>Nombre</label>
              <input value={editData.nombre ?? editing.nombre} onChange={e => setEditData(d => ({ ...d, nombre: e.target.value }))}
                style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
            </div>

            {/* Estado */}
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.body, letterSpacing: '.06em', textTransform: 'uppercase' }}>Estado</label>
              <button onClick={() => setEditData(d => ({ ...d, activo: !(d.activo ?? editing.activo) }))}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: (editData.activo ?? editing.activo) ? 'rgba(0,200,150,.12)' : 'rgba(239,68,68,.12)', border: `1px solid ${(editData.activo ?? editing.activo) ? '#00C89644' : '#EF444444'}`, borderRadius: 6, padding: '6px 14px', cursor: 'pointer', color: (editData.activo ?? editing.activo) ? C.accent : '#EF4444', fontWeight: 600, fontSize: 12 }}>
                {(editData.activo ?? editing.activo) ? <><CheckCircle size={13} /> Activo</> : <><XCircle size={13} /> Inactivo</>}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={closeEdit} style={{ flex: 1, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px', cursor: 'pointer', color: C.body, fontSize: 13 }}>Cancelar</button>
              <button onClick={saveEdit} disabled={saving} style={{ flex: 2, background: C.accent + '20', border: `1px solid ${C.accent}55`, borderRadius: 6, padding: '9px', cursor: 'pointer', color: C.accent, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {saving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
            {saveMsg && <div style={{ marginTop: 10, fontSize: 12, textAlign: 'center', color: saveMsg.startsWith('Error') ? '#EF4444' : C.accent }}>{saveMsg}</div>}
          </div>
        </div>
      )}

      {/* ── Reset password ── */}
      {resetId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setResetId(null); }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 28, width: 380, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Cambiar contraseña</div>
              <button onClick={() => setResetId(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.body }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12, color: C.body, marginBottom: 16 }}>
              {usuarios.find(u => u.id === resetId)?.email}
            </div>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <input type={showPass ? 'text' : 'password'} value={newPass} onChange={e => setNewPass(e.target.value)}
                placeholder="Nueva contraseña (mínimo 8 caracteres)"
                style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 40px 9px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
              <button onClick={() => setShowPass(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: C.body, padding: 2 }}>
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button onClick={resetPassword} disabled={newPass.length < 8}
              style={{ width: '100%', background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.4)', borderRadius: 6, padding: '9px', cursor: newPass.length < 8 ? 'not-allowed' : 'pointer', color: '#F59E0B', fontSize: 13, fontWeight: 600, opacity: newPass.length < 8 ? .5 : 1 }}>
              <Key size={13} style={{ display: 'inline', marginRight: 6 }} />Cambiar contraseña
            </button>
            {resetMsg && <div style={{ marginTop: 10, fontSize: 12, textAlign: 'center', color: resetMsg.startsWith('Error') ? '#EF4444' : C.accent }}>{resetMsg}</div>}
          </div>
        </div>
      )}

      {/* ── Crear usuario ── */}
      {creating && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setCreating(false); }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 28, width: 440, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Nuevo usuario</div>
              <button onClick={() => setCreating(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.body }}><X size={18} /></button>
            </div>

            {(['nombre', 'email', 'password'] as const).map(field => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.body, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>{field}</label>
                <input type={field === 'password' ? 'password' : 'text'} value={newUser[field]}
                  onChange={e => setNewUser(u => ({ ...u, [field]: e.target.value }))}
                  placeholder={field === 'password' ? 'Mínimo 8 caracteres' : ''}
                  style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
              </div>
            ))}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.body, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>Rol</label>
                <select value={newUser.rol} onChange={e => setNewUser(u => ({ ...u, rol: e.target.value }))}
                  style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 10px', color: C.text, fontSize: 12, cursor: 'pointer' }}>
                  {Object.entries(ROLE_META).filter(([k]) => k !== 'admin').map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.body, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>Plaza</label>
                <select value={newUser.plaza} onChange={e => setNewUser(u => ({ ...u, plaza: e.target.value }))}
                  style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '9px 10px', color: C.text, fontSize: 12, cursor: 'pointer' }}>
                  {PLAZAS.map(p => <option key={p} value={p}>{p || '— Sin plaza —'}</option>)}
                </select>
              </div>
            </div>

            {newUser.rol && (
              <div style={{ marginBottom: 16, padding: '8px 12px', background: `${ROLE_META[newUser.rol]?.bg ?? 'transparent'}`, borderRadius: 6, fontSize: 11, color: ROLE_META[newUser.rol]?.color ?? C.body }}>
                <Shield size={10} style={{ display: 'inline', marginRight: 5 }} />{ROLE_META[newUser.rol]?.desc}
              </div>
            )}

            <button onClick={crearUsuario}
              style={{ width: '100%', background: C.accent + '20', border: `1px solid ${C.accent}55`, borderRadius: 6, padding: '10px', cursor: 'pointer', color: C.accent, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Plus size={14} /> Crear usuario
            </button>
            {createMsg && <div style={{ marginTop: 10, fontSize: 12, textAlign: 'center', color: createMsg.startsWith('Error') ? '#EF4444' : C.accent }}>{createMsg}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
