import { useEffect, useState } from 'react';
import { API_BASE } from '../../../config';

interface Tarea {
  id: string;
  nombre: string;
  status: string;
  status_type: string;
  due_date: string | null;
  start_date: string | null;
  url: string;
  asignados: string[];
  priority: string | null;
  priority_id: number;
}

interface Proyecto {
  code: string;
  nombre: string;
  color: string;
  list_id: string;
  prioridad: string;
  total: number;
  completadas: number;
  en_progreso: number;
  pct: number;
  tareas: Tarea[];
  error?: string;
}

type SortMode = 'fecha' | 'prioridad' | 'status';

const PRIORIDAD_META: Record<string, { label: string; color: string; dot: string }> = {
  urgente: { label: 'Urgente', color: '#EF4444', dot: '#EF4444' },
  alta:    { label: 'Alta',    color: '#F97316', dot: '#F97316' },
  normal:  { label: 'Normal',  color: '#3B82F6', dot: '#3B82F6' },
  baja:    { label: 'Baja',    color: '#6B7280', dot: '#6B7280' },
};

const PRIORIDAD_ORDER: Record<string, number> = { urgente: 0, alta: 1, normal: 2, baja: 3 };

// ClickUp priority_id: 1=urgent 2=high 3=normal 4=low
const TASK_PRIO_COLOR: Record<number, string> = {
  1: '#EF4444', 2: '#F97316', 3: '#3B82F6', 4: '#6B7280', 0: '#444',
};

function formatDate(ts: string | null) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

function isOverdue(ts: string | null) {
  if (!ts) return false;
  return Number(ts) < Date.now();
}

function ProgressRing({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="rotate-[-90deg] flex-shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#222" strokeWidth={5} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        fill="white" fontSize={11} fontWeight="bold"
        style={{ transform: `rotate(90deg)`, transformOrigin: `${size/2}px ${size/2}px` }}>
        {pct}%
      </text>
    </svg>
  );
}

function sortTareas(tareas: Tarea[], mode: SortMode): Tarea[] {
  return [...tareas].sort((a, b) => {
    if (mode === 'fecha') {
      const da = Number(a.start_date ?? a.due_date ?? 9e15);
      const db = Number(b.start_date ?? b.due_date ?? 9e15);
      return da - db;
    }
    if (mode === 'prioridad') {
      return (a.priority_id || 99) - (b.priority_id || 99);
    }
    // status: pendientes primero, completadas al final
    const sa = a.status_type === 'closed' ? 1 : 0;
    const sb = b.status_type === 'closed' ? 1 : 0;
    return sa - sb;
  });
}

export default function ProyectosDashboardSection() {
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);
  const [updating, setUpdating]   = useState<string | null>(null);
  const [sortMode, setSortMode]   = useState<SortMode>('fecha');

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${API_BASE}/api/proyectos2026/dashboard`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setProyectos(d.proyectos ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const updateStatus = async (taskId: string, newStatus: string) => {
    setUpdating(taskId);
    try {
      await fetch(`${API_BASE}/api/proyectos2026/tarea/${taskId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchData();
    } finally {
      setUpdating(null);
    }
  };

  const totalTareas      = proyectos.reduce((a, p) => a + p.total, 0);
  const totalCompletadas = proyectos.reduce((a, p) => a + p.completadas, 0);
  const pctGlobal        = totalTareas ? Math.round(totalCompletadas / totalTareas * 100) : 0;

  // Proyectos ordenados por prioridad definida
  const proyectosOrdenados = [...proyectos].sort(
    (a, b) => (PRIORIDAD_ORDER[a.prioridad] ?? 9) - (PRIORIDAD_ORDER[b.prioridad] ?? 9)
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#00A859] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6 text-red-400 bg-[#1a0a0a] rounded-xl border border-red-800">
      No se pudo conectar con ClickUp: {error}
    </div>
  );

  return (
    <div className="space-y-5 p-1">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Plan de Trabajo 2026</h2>
          <p className="text-[#555] text-xs mt-0.5">Julio — Diciembre · ClickUp</p>
        </div>
        <button onClick={fetchData}
          className="text-xs text-[#555] hover:text-white px-3 py-1.5 rounded-lg border border-[#2a2a2a] hover:border-[#444] transition-all">
          ↻ Actualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { val: '5',                      label: 'Proyectos' },
          { val: String(totalTareas),      label: 'Fases' },
          { val: String(totalCompletadas), label: 'Completadas' },
          { val: `${pctGlobal}%`,          label: 'Avance' },
        ].map(({ val, label }) => (
          <div key={label} className="bg-[#111] border border-[#222] rounded-xl p-3 text-center">
            <div className="text-xl font-black text-[#00A859]">{val}</div>
            <div className="text-[#555] text-[11px] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Barra global */}
      <div className="bg-[#111] border border-[#222] rounded-xl p-4">
        <div className="flex justify-between text-[11px] text-[#555] mb-2">
          <span>Avance consolidado</span>
          <span>{totalCompletadas} / {totalTareas} fases</span>
        </div>
        <div className="h-2 bg-[#1e1e1e] rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-[#00A859] to-[#00C46A] rounded-full transition-all duration-700"
               style={{ width: `${pctGlobal}%` }} />
        </div>
        {/* Mini barras por proyecto */}
        <div className="flex gap-1 mt-3">
          {proyectosOrdenados.map(p => (
            <div key={p.code} className="flex-1 h-1 rounded-full bg-[#1e1e1e] overflow-hidden" title={p.nombre}>
              <div className="h-full rounded-full transition-all duration-500"
                   style={{ width: `${p.pct}%`, background: p.color }} />
            </div>
          ))}
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <span className="text-[#555] text-xs">Ordenar fases por:</span>
        {(['fecha', 'prioridad', 'status'] as SortMode[]).map(m => (
          <button key={m} onClick={() => setSortMode(m)}
            className={`text-xs px-3 py-1 rounded-full border transition-all ${
              sortMode === m
                ? 'bg-[#00A859] border-[#00A859] text-black font-bold'
                : 'border-[#2a2a2a] text-[#666] hover:border-[#444] hover:text-white'
            }`}>
            {m === 'fecha' ? '📅 Fecha' : m === 'prioridad' ? '🔴 Prioridad' : '✅ Estado'}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {proyectosOrdenados.map((p, idx) => {
          const isOpen  = expandido === p.code;
          const pmeta   = PRIORIDAD_META[p.prioridad] ?? PRIORIDAD_META.normal;
          const tareas  = sortTareas(p.tareas, sortMode);
          const pendientes = p.tareas.filter(t => t.status_type !== 'closed').length;

          return (
            <div key={p.code} className="bg-[#111] border border-[#222] rounded-2xl overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[#161616] transition-colors text-left"
                onClick={() => setExpandido(isOpen ? null : p.code)}>

                {/* Posición */}
                <span className="text-[#333] text-xs font-black w-4 flex-shrink-0">{idx + 1}</span>

                {/* Color bar lateral */}
                <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ background: p.color }} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white text-sm truncate">{p.nombre}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: pmeta.color + '22', color: pmeta.color }}>
                      {pmeta.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-[#1e1e1e] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                           style={{ width: `${p.pct}%`, background: p.color }} />
                    </div>
                    <span className="text-[11px] text-[#555] flex-shrink-0">
                      {p.completadas}/{p.total} · {pendientes} pendientes
                    </span>
                  </div>
                </div>

                <ProgressRing pct={p.pct} color={p.color} />

                <span className={`text-[#444] text-lg transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>›</span>
              </button>

              {/* Fases */}
              {isOpen && (
                <div className="border-t border-[#1e1e1e]">
                  {/* Cabecera tabla */}
                  <div className="grid grid-cols-[1fr_80px_90px_36px] gap-2 px-5 py-2 text-[10px] font-bold text-[#444] uppercase tracking-wider border-b border-[#1a1a1a]">
                    <span>Fase</span>
                    <span className="text-center">Fechas</span>
                    <span className="text-center">Estado</span>
                    <span />
                  </div>

                  {tareas.length === 0 && (
                    <div className="px-5 py-4 text-[#555] text-sm">Sin fases registradas.</div>
                  )}

                  {tareas.map((t) => {
                    const closed   = t.status_type === 'closed';
                    const overdue  = !closed && isOverdue(t.due_date);
                    const prioColor = TASK_PRIO_COLOR[t.priority_id] ?? '#444';

                    return (
                      <div key={t.id}
                        className={`grid grid-cols-[1fr_80px_90px_36px] gap-2 items-center px-5 py-2.5 border-b border-[#181818] transition-colors
                          ${closed ? 'opacity-50' : overdue ? 'bg-[#1f0a0a]' : 'hover:bg-[#161616]'}`}>

                        {/* Nombre + dot prioridad */}
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: prioColor }} />
                          <span className={`text-sm truncate ${closed ? 'line-through text-[#444]' : 'text-white'}`}>
                            {t.nombre}
                          </span>
                          {overdue && <span className="text-[10px] text-red-500 flex-shrink-0">vencida</span>}
                        </div>

                        {/* Fechas */}
                        <div className="text-center">
                          <span className="text-[11px] text-[#555]">
                            {formatDate(t.start_date)} → {formatDate(t.due_date)}
                          </span>
                        </div>

                        {/* Status select */}
                        <select
                          value={t.status}
                          disabled={updating === t.id}
                          onChange={(e) => updateStatus(t.id, e.target.value)}
                          className="bg-[#1a1a1a] border border-[#2a2a2a] text-[11px] text-white rounded-lg px-2 py-1 cursor-pointer hover:border-[#444] transition-colors disabled:opacity-40 w-full">
                          <option value="to do">⬜ Pendiente</option>
                          <option value="complete">✅ Completada</option>
                        </select>

                        {/* Link ClickUp */}
                        {t.url ? (
                          <a href={t.url} target="_blank" rel="noreferrer"
                             className="text-[#333] hover:text-[#00A859] transition-colors text-center text-sm"
                             title="Abrir en ClickUp">↗</a>
                        ) : <span />}
                      </div>
                    );
                  })}

                  <div className="px-5 py-3 flex justify-end">
                    <a href={`https://app.clickup.com/90141376562/v/li/${p.list_id}`}
                       target="_blank" rel="noreferrer"
                       className="text-[11px] text-[#444] hover:text-white transition-colors">
                      Ver en ClickUp ↗
                    </a>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
