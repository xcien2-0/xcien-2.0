/**
 * RRHHSection.tsx — Módulo de Recursos Humanos
 * Directorio · Estadísticas · Organigrama por empresa/departamento
 */

import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../../../config';
import { ThemeConfig } from '../types';
import OrgTreeView from './OrgTreeView';
import brand from '../../../brand';
import { useTabTrack } from '../../../hooks/useTabTrack';

interface Empleado {
  id: number;
  name: string;
  job_title: string;
  department: string;
  department_id: number | null;
  company: string;
  company_id: number | null;
  email: string;
  phone: string;
  manager: string | null;
  location: string;
  schedule: string;
  avatar: string | null;
}

interface Stats {
  total: number;
  by_department: { name: string; count: number }[];
  by_company: { name: string; count: number }[];
  by_location: { name: string; count: number }[];
}

interface Props { theme: ThemeConfig }

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY_SHORT: Record<string, string> = {
  'SERVICIOS CORPORATIVOS WISPI': 'WISPI',
  'LUMINET WAN': 'LUMINET',
  'ADMINISTRADORA DE SERVICIOS INTERNET SANDUR': 'SANDUR',
  'MATERIALES ASESORIAS Y SERVICIOS': 'MAS',
  'SENEL': 'SENEL',
  'HUUS VAS': 'HUUS',
};

const COMPANY_COLOR: Record<string, string> = {
  SANDUR: '#8B5CF6',
  MAS: '#F97316', SENEL: '#EC4899',
};

const COMPANY_DESC: Record<string, string> = {
  WISPI:   'HQ Corporativo · Monterrey',
  LUMINET: 'Backbone & Mayorista · Saltillo',
  SANDUR:  'ISP Regional · Noreste',
  MAS:     'Materiales & Servicios · San Nicolás',
  SENEL:   'ISP Regional · Mérida',
  HUUS:    'Value Added Services · CDMX',
};

function shortCompany(name: string): string {
  return COMPANY_SHORT[name] || name.split(' ')[0];
}

function companyColor(name: string, fallback: string): string {
  return COMPANY_COLOR[shortCompany(name)] || fallback;
}

function avatarColor(name: string): string {
  const palette = [brand.accentColor,'#00B4D8','#8B5CF6','#F97316','#EC4899','#EAB308','#14B8A6','#6366F1'];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

// Limpia nombre de departamento quitando el path largo de Odoo
function shortDept(dept: string): string {
  const parts = dept.split('/');
  return parts[parts.length - 1].trim();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Avatar({ emp, size = 36 }: { emp: Empleado; size?: number }) {
  const color = avatarColor(emp.name);
  if (emp.avatar) {
    return <img src={emp.avatar} alt={emp.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${color}40`, flexShrink: 0 }} />;
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `${color}18`, border: `2px solid ${color}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.33, fontWeight: 800, color,
    }}>
      {initials(emp.name)}
    </div>
  );
}

function CompanyBadge({ company, accent }: { company: string; accent: string }) {
  const short = shortCompany(company);
  const c = COMPANY_COLOR[short] || accent;
  return (
    <span style={{ background: `${c}18`, color: c, border: `1px solid ${c}35`, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700 }}>
      {short}
    </span>
  );
}

// ── Organigrama Component ─────────────────────────────────────────────────────

function OrgChart({ empleados, theme }: { empleados: Empleado[]; theme: ThemeConfig }) {
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({});
  const [searchOrg, setSearchOrg] = useState('');
  const { card, border, text, dim, radius, accent } = theme;

  // Group: company → department → employees
  const structure = useMemo(() => {
    const q = searchOrg.toLowerCase();
    const filtered = q
      ? empleados.filter(e =>
          e.name.toLowerCase().includes(q) ||
          e.job_title.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q)
        )
      : empleados;

    const map: Record<string, Record<string, Empleado[]>> = {};
    for (const emp of filtered) {
      const co = emp.company || 'Sin empresa';
      const dept = shortDept(emp.department || 'Sin departamento');
      if (!map[co]) map[co] = {};
      if (!map[co][dept]) map[co][dept] = [];
      map[co][dept].push(emp);
    }
    return map;
  }, [empleados, searchOrg]);

  const companies = Object.keys(structure).sort();

  const toggleDept = (key: string) =>
    setExpandedDepts(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Search */}
      <input
        type="text"
        placeholder="Buscar en el organigrama…"
        value={searchOrg}
        onChange={e => setSearchOrg(e.target.value)}
        style={{
          padding: '8px 14px', background: card, border: `1px solid ${border}`,
          borderRadius: 8, color: text, fontSize: 13, outline: 'none', maxWidth: 340,
        }}
      />

      {/* Company columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {companies.map(company => {
          const color = companyColor(company, accent);
          const short = shortCompany(company);
          const depts = structure[company];
          const totalInCo = Object.values(depts).reduce((a, b) => a + b.length, 0);

          return (
            <div key={company} style={{
              background: card, border: `1px solid ${color}40`,
              borderRadius: radius + 2, overflow: 'hidden',
              boxShadow: `0 2px 12px ${color}10`,
            }}>
              {/* Company header */}
              <div style={{
                background: `${color}12`, borderBottom: `1px solid ${color}30`,
                padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10,
                      background: `${color}20`, border: `2px solid ${color}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 900, color,
                    }}>{short.slice(0, 2)}</div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, color }}>{short}</div>
                      <div style={{ fontSize: 11, color: dim, marginTop: 1 }}>{COMPANY_DESC[short] || company}</div>
                    </div>
                  </div>
                  <div style={{
                    background: `${color}20`, color, border: `1px solid ${color}30`,
                    borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 800,
                  }}>{totalInCo}</div>
                </div>
              </div>

              {/* Departments */}
              <div style={{ padding: '8px 0' }}>
                {Object.entries(depts).sort(([,a],[,b]) => b.length - a.length).map(([dept, emps]) => {
                  const deptKey = `${company}::${dept}`;
                  const isOpen = expandedDepts[deptKey] !== false; // open by default if ≤6 emps
                  const defaultOpen = emps.length <= 6;
                  const expanded = deptKey in expandedDepts ? expandedDepts[deptKey] : defaultOpen;

                  return (
                    <div key={dept}>
                      {/* Dept header */}
                      <button
                        onClick={() => toggleDept(deptKey)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center',
                          justifyContent: 'space-between', padding: '8px 16px',
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = `${color}08`)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, transition: 'transform 0.2s', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', color: dim }}>▶</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: text, textAlign: 'left' }}>{dept}</span>
                        </div>
                        <span style={{
                          background: `${color}15`, color, borderRadius: 10,
                          padding: '1px 8px', fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>{emps.length}</span>
                      </button>

                      {/* Employee list */}
                      {expanded && (
                        <div style={{ padding: '2px 12px 8px 28px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {emps.sort((a, b) => a.name.localeCompare(b.name)).map(emp => (
                            <div key={emp.id} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '5px 8px', borderRadius: 6, transition: 'background 0.1s',
                              cursor: 'default',
                            }}
                              onMouseEnter={e => (e.currentTarget.style.background = `${color}08`)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <Avatar emp={emp} size={28} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                                  {emp.name.split(' ').slice(0, 3).join(' ')}
                                </div>
                                {emp.job_title && (
                                  <div style={{ fontSize: 10, color: dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                                    {emp.job_title}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ height: 1, background: border, margin: '0 16px' }} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RRHHSection({ theme }: Props) {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [selectedEmp, setSelectedEmp] = useState<Empleado | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoZoom,   setPhotoZoom]   = useState(false);
  const [activeTab, setActiveTab] = useState<'arbol' | 'organigrama' | 'directorio' | 'estadisticas' | 'diagnostico'>('arbol');
  const [diagnostico, setDiagnostico] = useState<any | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const trackTab = useTabTrack('rrhh');
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  const openEmp = (emp: Empleado) => {
    setSelectedEmp(emp);
    setSelectedDetail(null);
    setDetailLoading(true);
    setPhotoFailed(false);
    setPhotoZoom(false);
    fetch(`${API_BASE}/api/rrhh/empleado/${emp.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setSelectedDetail(d); setDetailLoading(false); })
      .catch(() => setDetailLoading(false));
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [empRes, statsRes] = await Promise.all([
          fetch(`${API_BASE}/api/rrhh/empleados`),
          fetch(`${API_BASE}/api/rrhh/stats`),
        ]);
        if (!empRes.ok) throw new Error(`Error ${empRes.status}`);
        const [empData, statsData] = await Promise.all([empRes.json(), statsRes.json()]);
        setEmpleados(empData);
        setStats(statsData);
      } catch (e: any) {
        setError(e.message || 'No se pudo cargar el directorio de personas');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const departments = useMemo(() => [...new Set(empleados.map(e => e.department))].sort(), [empleados]);
  const companies = useMemo(() => [...new Set(empleados.map(e => e.company))].sort(), [empleados]);

  const filtered = useMemo(() => {
    let list = empleados;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.job_title.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q)
      );
    }
    if (filterDept) list = list.filter(e => e.department === filterDept);
    if (filterCompany) list = list.filter(e => e.company === filterCompany);
    return list;
  }, [empleados, search, filterDept, filterCompany]);

  const { accent, card, border, text, dim, radius, bg } = theme;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
      <div style={{ width: 48, height: 48, border: `3px solid ${accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: dim, fontSize: 13 }}>Cargando empleados desde Odoo…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 12 }}>
      <span style={{ fontSize: 32 }}>⚠️</span>
      <span style={{ color: '#FF4D4D', fontWeight: 700 }}>Error conectando con Odoo</span>
      <span style={{ color: dim, fontSize: 12 }}>{error}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
        {/* KPIs */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: text }}>Recursos Humanos</h2>
            <p style={{ fontSize: 12, color: dim, margin: '4px 0 0' }}>Directorio organizacional · ERP</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { val: empleados.length, label: 'EMPLEADOS', color: accent },
              { val: departments.length, label: 'DEPTOS', color: '#00B4D8' },
              { val: companies.length, label: 'EMPRESAS', color: '#8B5CF6' },
            ].map(({ val, label, color }) => (
              <div key={label} style={{ background: `${color}12`, border: `1px solid ${color}30`, borderRadius: 10, padding: '6px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 10, color: dim, fontWeight: 600, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${border}` }}>
          {([
            { id: 'arbol',        label: '🕸️ Árbol' },
            { id: 'organigrama',  label: '🏢 Organigrama' },
            { id: 'directorio',   label: '👥 Directorio'  },
            { id: 'estadisticas', label: '📊 Estadísticas' },
            { id: 'diagnostico',  label: '🔍 Diagnóstico' },
          ] as const).map(tab => (
            <button key={tab.id} onClick={() => {
              trackTab(tab.id); setActiveTab(tab.id);
              if (tab.id === 'diagnostico' && !diagnostico && !diagLoading) {
                setDiagLoading(true);
                fetch(`${API_BASE}/api/rrhh/diagnostico`)
                  .then(r => r.ok ? r.json() : null)
                  .then(d => { if (d) setDiagnostico(d); })
                  .catch(() => {})
                  .finally(() => setDiagLoading(false));
              }
            }} style={{
              padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
              color: activeTab === tab.id ? accent : dim, fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: 13, borderBottom: `2px solid ${activeTab === tab.id ? accent : 'transparent'}`,
              transition: 'all 0.2s',
            }}>{tab.label}</button>
          ))}
        </div>

        {/* Controls — only in directorio */}
        {activeTab === 'directorio' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 0 0' }}>
            <input
              type="text"
              placeholder="Buscar por nombre, puesto, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 220, padding: '8px 12px', background: card, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: 13, outline: 'none' }}
            />
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ padding: '8px 12px', background: card, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: 12, cursor: 'pointer', outline: 'none', minWidth: 180 }}>
              <option value="">Todos los departamentos</option>
              {departments.map(d => <option key={d} value={d}>{shortDept(d)}</option>)}
            </select>
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)} style={{ padding: '8px 12px', background: card, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: 12, cursor: 'pointer', outline: 'none', minWidth: 130 }}>
              <option value="">Todas las empresas</option>
              {companies.map(c => <option key={c} value={c}>{shortCompany(c)}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 2, background: card, border: `1px solid ${border}`, borderRadius: 8, padding: 2 }}>
              {(['cards', 'list'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{ padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 14, background: view === v ? `${accent}20` : 'transparent', color: view === v ? accent : dim, transition: 'all 0.15s' }}>
                  {v === 'cards' ? '⊞' : '≡'}
                </button>
              ))}
            </div>
            <span style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: dim }}>{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>

        {/* ÁRBOL */}
        {activeTab === 'arbol' && (
          <div style={{ height: 'calc(100vh - 260px)', minHeight: 480 }}>
            <OrgTreeView empleados={empleados} theme={theme} />
          </div>
        )}

        {/* ORGANIGRAMA */}
        {activeTab === 'organigrama' && <OrgChart empleados={empleados} theme={theme} />}

        {/* DIRECTORIO */}
        {activeTab === 'directorio' && (
          view === 'cards' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {filtered.map(emp => (
                <div key={emp.id}
                  onClick={() => openEmp(emp)}
                  style={{ background: card, border: `1px solid ${border}`, borderRadius: radius, padding: 16, cursor: 'pointer', transition: 'border-color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = `${accent}60`)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = border)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <Avatar emp={emp} size={44} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</div>
                      <div style={{ fontSize: 11, color: dim, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.job_title || '—'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 11, color: dim }}>🏢 {shortDept(emp.department)}</div>
                    {emp.location && <div style={{ fontSize: 11, color: dim }}>📍 {emp.location}</div>}
                    {emp.email && <div style={{ fontSize: 11, color: dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✉️ {emp.email}</div>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <CompanyBadge company={emp.company} accent={accent} />
                    {emp.manager && <span style={{ fontSize: 10, color: dim }}>→ {emp.manager.split(' ')[0]}</span>}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: dim }}>
                  No se encontraron empleados con ese criterio.
                </div>
              )}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${border}` }}>
                  {['Empleado', 'Puesto', 'Departamento', 'Empresa', 'Ubicación', 'Contacto'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: dim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => (
                  <tr key={emp.id}
                    onClick={() => openEmp(emp)}
                    style={{ borderBottom: `1px solid ${border}`, cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = `${accent}08`)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar emp={emp} size={28} />
                        <span style={{ fontWeight: 600, color: text }}>{emp.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', color: dim }}>{emp.job_title || '—'}</td>
                    <td style={{ padding: '10px 12px', color: dim }}>{shortDept(emp.department)}</td>
                    <td style={{ padding: '10px 12px' }}><CompanyBadge company={emp.company} accent={accent} /></td>
                    <td style={{ padding: '10px 12px', color: dim }}>{emp.location || '—'}</td>
                    <td style={{ padding: '10px 12px', color: dim }}>{emp.phone || emp.email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* ESTADÍSTICAS */}
        {activeTab === 'estadisticas' && stats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: text, marginBottom: 12 }}>🏢 Distribución por Empresa</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stats.by_company.map(item => {
                  const pct = Math.round((item.count / stats.total) * 100);
                  const color = companyColor(item.name, accent);
                  return (
                    <div key={item.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                        <span style={{ color: text, fontWeight: 600 }}>{shortCompany(item.name)} <span style={{ color: dim, fontWeight: 400 }}>— {item.name}</span></span>
                        <span style={{ color: dim }}>{item.count} · {pct}%</span>
                      </div>
                      <div style={{ background: `${color}15`, borderRadius: 4, height: 10, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: text, marginBottom: 12 }}>🗂️ Departamentos — clic para ver integrantes</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                {stats.by_department.map((item, i) => {
                  const palette = ['#00A859','#00B4D8','#8B5CF6','#F97316','#EC4899','#EAB308','#14B8A6','#6366F1','#F43F5E','#84CC16'];
                  const c = palette[i % palette.length];
                  const pct = Math.round((item.count / stats.total) * 100);
                  const isSelected = selectedDept === item.name;
                  return (
                    <div key={item.name}
                      onClick={() => setSelectedDept(isSelected ? null : item.name)}
                      style={{
                        background: isSelected ? `${c}18` : card,
                        border: `1px solid ${isSelected ? c : border}`,
                        borderRadius: radius, padding: '12px 14px',
                        display: 'flex', alignItems: 'center', gap: 12,
                        cursor: 'pointer', transition: 'all 0.15s',
                        boxShadow: isSelected ? `0 0 0 2px ${c}40` : 'none',
                      }}
                    >
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: `${c}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                        {['👔','🔧','📞','💻','📊','🌐','📦','🏗️','🎯','🔍'][i] || '👥'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: isSelected ? c : text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {shortDept(item.name)}
                        </div>
                        <div style={{ background: `${c}20`, borderRadius: 3, height: 4, marginTop: 5, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(pct * 4, 100)}%`, height: '100%', background: c, borderRadius: 3 }} />
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 18, color: c, flexShrink: 0 }}>{item.count}</div>
                    </div>
                  );
                })}
              </div>

              {/* Panel de integrantes del departamento seleccionado */}
              {selectedDept && (() => {
                const palette = ['#00A859','#00B4D8','#8B5CF6','#F97316','#EC4899','#EAB308','#14B8A6','#6366F1','#F43F5E','#84CC16'];
                const idx = stats.by_department.findIndex(d => d.name === selectedDept);
                const c = palette[idx % palette.length] || accent;
                const deptEmps = empleados.filter(e => e.department === selectedDept);
                return (
                  <div style={{ marginTop: 16, background: card, border: `1px solid ${c}50`, borderRadius: radius, overflow: 'hidden' }}>
                    {/* Header del panel */}
                    <div style={{ background: `${c}15`, borderBottom: `1px solid ${c}30`, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 13, color: c }}>{shortDept(selectedDept)}</span>
                        <span style={{ fontSize: 11, color: dim, marginLeft: 8 }}>{deptEmps.length} integrante{deptEmps.length !== 1 ? 's' : ''}</span>
                      </div>
                      <button
                        onClick={() => setSelectedDept(null)}
                        style={{ background: 'transparent', border: 'none', color: dim, fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                      >✕</button>
                    </div>
                    {/* Lista de empleados */}
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {deptEmps.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: dim, fontSize: 12 }}>Sin empleados registrados</div>
                      ) : (
                        deptEmps.map((emp, j) => (
                          <div key={emp.id}
                            onClick={() => openEmp(emp)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12,
                              padding: '10px 16px',
                              borderBottom: j < deptEmps.length - 1 ? `1px solid ${border}` : 'none',
                              cursor: 'pointer', transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = `${c}08`)}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <Avatar emp={emp} size={32} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {emp.name}
                              </div>
                              <div style={{ fontSize: 11, color: dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {emp.job_title || '—'}
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                              {emp.email && <div style={{ fontSize: 10, color: dim }}>{emp.email}</div>}
                              {emp.phone && <div style={{ fontSize: 10, color: dim }}>{emp.phone}</div>}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {stats.by_location.length > 0 && (
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: text, marginBottom: 12 }}>📍 Por Sede</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {stats.by_location.map(item => (
                    <div key={item.name} style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: dim }}>📍</span>
                      <span style={{ fontSize: 12, color: text, fontWeight: 600 }}>{item.name}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#F97316' }}>{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── DIAGNÓSTICO DE JERARQUÍA ── */}
        {activeTab === 'diagnostico' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {diagLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: dim, padding: '40px 0' }}>
                <div style={{ width: 16, height: 16, border: `2px solid ${accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
                Analizando datos de Odoo...
              </div>
            )}

            {!diagLoading && diagnostico && (() => {
              const d = diagnostico;
              const score = d.avg_score_global;
              const scoreColor = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
              const CAMPO_ICONS: Record<string, string> = {
                manager: '👤', department: '🏢', job_title: '💼',
                email: '📧', phone: '📱', location: '📍',
              };

              return (
                <>
                  {/* KPIs */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    {[
                      { label: 'Score global',     val: `${score}%`,      color: scoreColor,  icon: '📊' },
                      { label: 'Completos (100%)', val: d.completos,       color: '#10b981',   icon: '✅' },
                      { label: 'En riesgo (<50%)', val: d.criticos,        color: '#ef4444',   icon: '⚠️' },
                      { label: 'Total empleados',  val: d.total_empleados, color: accent,      icon: '👥' },
                    ].map((k, i) => (
                      <div key={i} style={{ background: card, border: `1px solid ${k.color}20`, borderRadius: radius, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color }} />
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{k.icon}</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: k.color, fontFamily: 'Oswald, sans-serif', lineHeight: 1 }}>{k.val}</div>
                        <div style={{ fontSize: 10, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{k.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Score global visual */}
                  <div style={{ background: card, border: `1px solid ${border}`, borderRadius: radius, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>Completitud global de datos jerárquicos</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: scoreColor }}>{score}%</span>
                    </div>
                    <div style={{ height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ width: `${score}%`, height: '100%', background: scoreColor, borderRadius: 5, transition: 'width 1s ease' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: dim }}>
                      <span style={{ color: '#10b981' }}>■ &gt;80% Listo para Board</span>
                      <span style={{ color: '#f59e0b' }}>■ 50-79% En progreso</span>
                      <span style={{ color: '#ef4444' }}>■ &lt;50% Requiere atención</span>
                    </div>
                  </div>

                  {/* Calidad por campo */}
                  <div style={{ background: card, border: `1px solid ${border}`, borderRadius: radius, padding: '18px 20px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
                      Campos de jerarquía — {d.total_empleados} empleados
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {Object.entries(d.campos as Record<string, any>)
                        .sort((a, b) => a[1].pct - b[1].pct)
                        .map(([campo, info]) => {
                          const c = info.pct >= 80 ? '#10b981' : info.pct >= 50 ? '#f59e0b' : '#ef4444';
                          return (
                            <div key={campo}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                                <span style={{ fontSize: 14, width: 22, textAlign: 'center', flexShrink: 0 }}>{CAMPO_ICONS[campo] ?? '📋'}</span>
                                <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{info.label}</span>
                                <span style={{ fontSize: 12, fontWeight: 800, color: c, minWidth: 40, textAlign: 'right' }}>{info.pct}%</span>
                                <span style={{ fontSize: 10, color: dim, minWidth: 110, textAlign: 'right' }}>
                                  {info.completados} ok · {info.faltantes} faltantes
                                </span>
                              </div>
                              <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', marginLeft: 32 }}>
                                <div style={{ width: `${info.pct}%`, height: '100%', background: c, borderRadius: 3, transition: 'width 1s ease' }} />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Por departamento */}
                  <div style={{ background: card, border: `1px solid ${border}`, borderRadius: radius, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 20px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Por departamento — peores primero</span>
                      <span style={{ fontSize: 10, color: dim }}>{d.por_departamento.length} departamentos</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                            {['Departamento', 'Empleados', 'Score prom.', 'Completos', 'En riesgo', 'Avance'].map(h => (
                              <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: dim, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {d.por_departamento.map((dep: any, i: number) => {
                            const c = dep.avg_score >= 80 ? '#10b981' : dep.avg_score >= 50 ? '#f59e0b' : '#ef4444';
                            return (
                              <tr key={dep.department} style={{ borderTop: `1px solid ${border}`, background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                                <td style={{ padding: '11px 16px', fontWeight: 600, color: text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dep.department}</td>
                                <td style={{ padding: '11px 16px', color: dim, textAlign: 'center' }}>{dep.total}</td>
                                <td style={{ padding: '11px 16px', textAlign: 'center' }}>
                                  <span style={{ fontWeight: 800, color: c, fontFamily: 'Oswald, sans-serif' }}>{dep.avg_score}%</span>
                                </td>
                                <td style={{ padding: '11px 16px', textAlign: 'center' }}>
                                  <span style={{ color: '#10b981', fontWeight: 700 }}>{dep.completos}</span>
                                  <span style={{ color: dim, fontSize: 10, marginLeft: 4 }}>/{dep.total}</span>
                                </td>
                                <td style={{ padding: '11px 16px', textAlign: 'center' }}>
                                  {dep.criticos > 0
                                    ? <span style={{ color: '#ef4444', fontWeight: 700 }}>⚠ {dep.criticos}</span>
                                    : <span style={{ color: dim }}>—</span>}
                                </td>
                                <td style={{ padding: '11px 20px 11px 16px', minWidth: 120 }}>
                                  <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ width: `${dep.pct_completos}%`, height: '100%', background: c, borderRadius: 3 }} />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Empleados con datos incompletos */}
                  <div style={{ background: card, border: `1px solid ${border}`, borderRadius: radius, overflow: 'hidden' }}>
                    <div style={{ padding: '14px 20px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Empleados con datos incompletos</span>
                      <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>
                        {d.empleados.filter((e: any) => e.score < 100).length} requieren actualización
                      </span>
                    </div>
                    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                      {d.empleados.filter((e: any) => e.score < 100).map((emp: any, i: number) => {
                        const c = emp.score >= 80 ? '#10b981' : emp.score >= 50 ? '#f59e0b' : '#ef4444';
                        return (
                          <div key={emp.id} style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                            borderBottom: `1px solid ${border}`,
                            background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                          }}>
                            <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${c}15`, border: `1.5px solid ${c}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: c, flexShrink: 0 }}>
                              {emp.name.charAt(0).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</div>
                              <div style={{ fontSize: 10, color: dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.department}{emp.job_title ? ` · ${emp.job_title}` : ''}</div>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 280, flexShrink: 0 }}>
                              {emp.faltantes.map((f: string) => (
                                <span key={f} style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', whiteSpace: 'nowrap' }}>
                                  ✗ {f}
                                </span>
                              ))}
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 44 }}>
                              <div style={{ fontSize: 15, fontWeight: 800, color: c, fontFamily: 'Oswald, sans-serif' }}>{emp.score}%</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* CTA */}
                  <div style={{ background: `${accent}08`, border: `1px solid ${accent}20`, borderRadius: radius, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: accent, marginBottom: 3 }}>
                        {score >= 80
                          ? '✅ Jerarquía lista — se puede activar el Board multicapa'
                          : score >= 50
                          ? `⚡ Faltan ${80 - score} puntos para desbloquear el Board multicapa`
                          : `🔴 Actualización urgente en Odoo — ${100 - score}% de datos incompletos`}
                      </div>
                      <div style={{ fontSize: 11, color: dim }}>
                        RRHH debe completar los campos faltantes en Odoo para cada empleado
                      </div>
                    </div>
                    <a href={`${brand.odooUrl}/odoo/employees`} target="_blank" rel="noreferrer"
                      style={{ padding: '9px 18px', borderRadius: 8, background: accent, color: '#000', fontWeight: 700, fontSize: 12, textDecoration: 'none', flexShrink: 0, marginLeft: 16 }}>
                      Actualizar en Odoo ↗
                    </a>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Employee Detail Modal ── */}
      {selectedEmp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { setSelectedEmp(null); setSelectedDetail(null); setPhotoFailed(false); setPhotoZoom(false); }}>
          <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, width: 420, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', position: 'relative', boxShadow: `0 20px 60px rgba(0,0,0,0.5)` }}
            onClick={e => e.stopPropagation()}>

            {/* Header con foto */}
            <div style={{ background: `${accent}10`, borderBottom: `1px solid ${border}`, padding: '20px 20px 16px', position: 'relative' }}>
              <button onClick={() => { setSelectedEmp(null); setSelectedDetail(null); setPhotoFailed(false); setPhotoZoom(false); }} style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', color: dim, fontSize: 20, cursor: 'pointer' }}>✕</button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Foto o avatar */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {!photoFailed
                    ? <img
                        src={`${API_BASE}/api/rrhh/empleado/${selectedEmp.id}/foto`}
                        alt={selectedEmp.name}
                        onError={() => setPhotoFailed(true)}
                        onClick={() => setPhotoZoom(true)}
                        style={{ width: 76, height: 76, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${accent}`, display: 'block', background: `${avatarColor(selectedEmp.name)}20`, cursor: 'zoom-in' }}
                      />
                    : (
                      <div style={{ width: 76, height: 76, borderRadius: '50%', background: `${avatarColor(selectedEmp.name)}20`, border: `3px solid ${avatarColor(selectedEmp.name)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: avatarColor(selectedEmp.name) }}>
                        {initials(selectedEmp.name)}
                      </div>
                    )
                  }
                  {detailLoading && (
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 20, height: 20, border: `2px solid ${accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    </div>
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 17, color: text, lineHeight: 1.2 }}>{selectedEmp.name}</div>
                  <div style={{ fontSize: 12, color: accent, marginTop: 4 }}>{selectedEmp.job_title || '—'}</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <CompanyBadge company={selectedEmp.company} accent={accent} />
                  </div>
                </div>
              </div>
            </div>

            {/* Detalles */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

              {/* Organización */}
              <ModalSection label="Organización">
                <ModalRow icon="🏢" label="Empresa"     value={selectedEmp.company} />
                <ModalRow icon="🗂️" label="Departamento" value={shortDept(selectedEmp.department)} />
                <ModalRow icon="👤" label="Reporta a"   value={selectedEmp.manager || '—'} />
                {selectedDetail?.subordinates_count > 0 && (
                  <ModalRow icon="👥" label="Subordinados" value={`${selectedDetail.subordinates_count} personas`} highlight={accent} />
                )}
                <ModalRow icon="📍" label="Sede"        value={(selectedDetail?.location) || selectedEmp.location || '—'} />
                <ModalRow icon="🕐" label="Horario"     value={(selectedDetail?.schedule) || selectedEmp.schedule || '—'} />
              </ModalSection>

              {/* Contacto */}
              <ModalSection label="Contacto">
                <ModalRow icon="✉️" label="Email"    value={selectedEmp.email || '—'} />
                <ModalRow icon="📱" label="Teléfono" value={selectedEmp.phone || '—'} />
              </ModalSection>

              {/* Subordinados destacados */}
              {selectedDetail?.subordinates_count > 0 && (
                <div style={{ background: `${accent}10`, border: `1px solid ${accent}25`, borderRadius: 8, padding: '8px 12px', marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: accent, fontWeight: 700 }}>👥 {selectedDetail.subordinates_count} persona{selectedDetail.subordinates_count !== 1 ? 's' : ''} a su cargo</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox — foto ampliada */}
      {photoZoom && selectedEmp && !photoFailed && (
        <div
          onClick={() => setPhotoZoom(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 400,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={`${API_BASE}/api/rrhh/empleado/${selectedEmp.id}/foto`}
            alt={selectedEmp.name}
            style={{
              maxWidth: '80vw', maxHeight: '75vh',
              borderRadius: 16, objectFit: 'contain',
              border: `3px solid ${avatarColor(selectedEmp.name)}`,
              boxShadow: `0 0 60px ${avatarColor(selectedEmp.name)}40`,
            }}
          />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>{selectedEmp.name}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4 }}>{selectedEmp.job_title}</div>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>Clic para cerrar</div>
        </div>
      )}
    </div>
  );
}

function ModalSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: '#888', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>{children}</div>
    </div>
  );
}

function ModalRow({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 12, flexShrink: 0, width: 20 }}>{icon}</span>
      <span style={{ fontSize: 11, color: '#888', flexShrink: 0, width: 96 }}>{label}</span>
      <span style={{ fontSize: 12, color: highlight || '#f0f0f0', fontWeight: highlight ? 700 : 500, wordBreak: 'break-word', flex: 1 }}>{value}</span>
    </div>
  );
}
