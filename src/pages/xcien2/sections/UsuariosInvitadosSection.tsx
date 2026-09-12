// UsuariosInvitadosSection — seguimiento de usuarios invitados al portal
import React, { useEffect, useState, useCallback } from 'react';
import { API_BASE } from '../../../config';
import { ThemeConfig } from '../types';

const G  = '#2d7a4f';
const GD = '#1a4a2e';
const GB = '#eef4ee';
const TX = '#111827';
const DM = '#6b7280';
const LG = '#f9fafb';
const SF = '#ffffff';
const GN = '#16a34a';  // verde activo
const AM = '#d97706';  // ámbar inactivo
const RD = '#dc2626';  // rojo nunca
const SH = '0 1px 4px rgba(0,0,0,0.07), 0 4px 12px rgba(0,0,0,0.04)';

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  plaza?: string;
  activo: boolean;
  ultimo_login: string | null;
  creado_en: string;
  motivo_acceso?: string;
  invitado_por?: string;
  grupo_invitacion?: string;
  fecha_invitacion?: string;
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function semaforo(u: Usuario): { color: string; label: string; icon: string } {
  if (!u.activo) return { color: DM, label: 'Inactivo', icon: '⏸' };
  const dias = diasDesde(u.ultimo_login);
  if (dias === null) return { color: RD, label: 'Nunca ingresó', icon: '⚠️' };
  if (dias === 0)    return { color: GN, label: 'Hoy',          icon: '🟢' };
  if (dias <= 3)     return { color: GN, label: `Hace ${dias}d`, icon: '🟢' };
  if (dias <= 10)    return { color: AM, label: `Hace ${dias}d`, icon: '🟡' };
  return { color: RD, label: `Hace ${dias}d`, icon: '🔴' };
}

const GRUPOS = ['Todos', 'Fase Beta Dirección', 'Fase Beta PDN', 'Fase Beta NOC', 'Fase Beta Comercial'];

export default function UsuariosInvitadosSection({ theme: _theme }: { theme: ThemeConfig }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [filtro,   setFiltro]   = useState('Todos');
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const tok = localStorage.getItem('xcien_token') ?? '';
      const r = await fetch(`${API_BASE}/api/auth/usuarios`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: Usuario[] = await r.json();
      setUsuarios(data);
    } catch (e: any) {
      setError(e.message ?? 'No se pudo cargar la lista de usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = usuarios.filter(u => {
    const matchGrupo = filtro === 'Todos' || u.grupo_invitacion === filtro;
    const q = busqueda.toLowerCase();
    const matchBusq = !q || u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    return matchGrupo && matchBusq;
  });

  // Estadísticas rápidas
  const nuncaIngresaron = usuarios.filter(u => !u.ultimo_login).length;
  const activos         = usuarios.filter(u => u.ultimo_login && (diasDesde(u.ultimo_login) ?? 99) <= 3).length;
  const inactivos       = usuarios.filter(u => u.ultimo_login && (diasDesde(u.ultimo_login) ?? 0) > 3).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${GD} 0%, ${G} 100%)`,
        borderRadius: 14, padding: '20px 24px', color: SF,
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 32 }}>👥</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
            color: 'rgba(255,255,255,.55)', marginBottom: 3 }}>Portal XCIEN 2.0</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Seguimiento de Usuarios Invitados</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
            Fase de pruebas · {usuarios.length} usuarios registrados
          </div>
        </div>
        <button onClick={cargar} style={{
          background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)',
          color: SF, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
        }}>↻ Actualizar</button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: 'Nunca ingresaron', val: nuncaIngresaron, color: RD, icon: '⚠️' },
          { label: 'Activos (≤3 días)',  val: activos,         color: GN, icon: '🟢' },
          { label: 'Sin actividad +3d',  val: inactivos,       color: AM, icon: '🟡' },
        ].map(k => (
          <div key={k.label} style={{
            background: SF, borderRadius: 12, padding: '16px 18px',
            boxShadow: SH, borderTop: `3px solid ${k.color}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ fontSize: 22 }}>{k.icon}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, color: k.color, fontVariantNumeric: 'tabular-nums' }}>
                {loading ? '…' : k.val}
              </div>
              <div style={{ fontSize: 10, color: DM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {k.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Buscar por nombre o email…"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{
            flex: 1, minWidth: 200, padding: '7px 12px', borderRadius: 8,
            border: '1px solid #d1d5db', fontSize: 12, outline: 'none', color: TX,
          }}
        />
        {GRUPOS.map(g => (
          <button key={g} onClick={() => setFiltro(g)} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            background: filtro === g ? G : LG,
            color: filtro === g ? SF : DM,
            border: `1px solid ${filtro === g ? G : '#e5e7eb'}`,
          }}>{g}</button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: DM, fontSize: 12 }}>Cargando usuarios…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 40, color: RD, fontSize: 12 }}>{error}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibles.map(u => {
            const s = semaforo(u);
            const dias = diasDesde(u.ultimo_login);
            return (
              <div key={u.id} style={{
                background: SF, borderRadius: 12, padding: '14px 18px',
                boxShadow: SH, display: 'flex', alignItems: 'center', gap: 14,
                borderLeft: `4px solid ${s.color}`,
              }}>
                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  background: GB, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 800, color: G,
                }}>
                  {u.nombre.charAt(0).toUpperCase()}
                </div>

                {/* Info principal */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: TX }}>{u.nombre}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
                      background: GB, color: G, padding: '2px 7px', borderRadius: 4,
                    }}>{u.rol}</span>
                    {u.grupo_invitacion && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                        background: '#eff6ff', color: '#2563eb', padding: '2px 7px', borderRadius: 4,
                      }}>{u.grupo_invitacion}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: DM, marginTop: 2 }}>{u.email}</div>
                  {u.motivo_acceso && (
                    <div style={{ fontSize: 10, color: G, marginTop: 3, fontStyle: 'italic' }}>
                      {u.motivo_acceso}
                    </div>
                  )}
                </div>

                {/* Estado acceso */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: `${s.color}12`, border: `1px solid ${s.color}30`,
                    borderRadius: 20, padding: '4px 10px',
                  }}>
                    <span style={{ fontSize: 10 }}>{s.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.label}</span>
                  </div>
                  {u.ultimo_login && (
                    <div style={{ fontSize: 9, color: DM, marginTop: 3 }}>
                      {new Date(u.ultimo_login).toLocaleString('es-MX', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                  )}
                  {u.fecha_invitacion && (
                    <div style={{ fontSize: 9, color: DM, marginTop: 1 }}>
                      Invitado: {u.fecha_invitacion}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {visibles.length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: DM, fontSize: 12 }}>
              Sin resultados para "{busqueda || filtro}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
