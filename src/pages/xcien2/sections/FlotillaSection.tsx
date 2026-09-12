import { useState, useEffect, useCallback, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

// ─── Tipos ────────────────────────────────────────────────────────────────────
type Nivel  = 'critico' | 'urgente' | 'menor';
type Estado = 'pendiente' | 'en_proceso' | 'resuelto';
type Tab    = 'expediente' | 'gps';

interface VehiculoGPS {
  id: number;
  nombre: string;
  placa: string;
  lat: number | null;
  lng: number | null;
  velocidad: number;
  conductor: string;
  km_hoy: number;
  viajes_hoy: number;
  activo: boolean;
  ultima_vez: string | null;
  ubicacion: string | null;
}

interface GPSResponse {
  vehiculos: VehiculoGPS[];
  total: number;
  cached: boolean;
}

interface TripGPS {
  trip_id: number;
  desde: string | null;
  hasta: string | null;
  km: number;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  start_loc: string | null;
  end_loc: string | null;
  horario: 'laboral' | 'nocturno' | 'madrugada' | 'finde';
  conductor: string;
}

interface VehiculoRuta {
  tn360_id: number;
  nombre: string;
  placa: string;
  conductor: string;
  trips: TripGPS[];
  km_total: number;
  n_viajes: number;
}

interface TicketOdoo {
  id: number;
  nombre: string;
  cliente: string;
  direccion: string;
  lat: number | null;
  lng: number | null;
  etapa: string;
  tecnicos: string[];
}

interface RutasResponse {
  fecha: string;
  total_vehs: number;
  vehiculos: VehiculoRuta[];
  tickets_odoo: TicketOdoo[];
  from_cache: boolean;
}

interface Hallazgo {
  id: string;
  fecha: string;
  componente: string;
  descripcion: string;
  nivel: Nivel;
  estado: Estado;
  reportado_por: string;
  folio_ref?: string;
}

interface Mantenimiento {
  ultimo_servicio?: string;
  km_ultimo?: number;
  garantia_vigente: boolean;
  observacion?: string;
}

interface Vehiculo {
  id: string;
  nombre: string;
  placa: string;
  conductor: string;
  email_conductor: string;
  tn360_id: number;
  anio?: string;
  marca?: string;
  modelo?: string;
  color?: string;
  mantenimiento: Mantenimiento;
  hallazgos: Hallazgo[];
}

// ─── Datos iniciales (expediente histórico) ───────────────────────────────────
const VEHICULOS_INICIAL: Vehiculo[] = [
  {
    id: 'lw204',
    nombre: 'LW-204',
    placa: 'EY5920B',
    conductor: 'Alberto Espinosa',
    email_conductor: 'espinosaalberto711@gmail.com',
    tn360_id: 3330,
    mantenimiento: {
      garantia_vigente: true,
      observacion: 'Aún sin historial de servicio registrado',
    },
    hallazgos: [
      {
        id: 'lw204-001',
        fecha: '2026-08-03',
        componente: 'Sistema de escape',
        descripcion: 'Escape roto en el múltiple de escape (salida del motor). Ruido excesivo y fuga directa de gases calientes hacia el compartimento del motor. Riesgo de incendio sobre cableado y mangueras.',
        nivel: 'critico',
        estado: 'pendiente',
        reportado_por: 'José Miguel Macías',
        folio_ref: 'XCIEN-PDN-VEH-2026-001',
      },
      {
        id: 'lw204-002',
        fecha: '2026-08-03',
        componente: 'Transmisión / Clutch',
        descripcion: 'Accionamiento del clutch con resistencia anormal. Posible desgaste severo del disco de embrague o falla en el sistema hidráulico de la transmisión.',
        nivel: 'critico',
        estado: 'pendiente',
        reportado_por: 'José Miguel Macías',
        folio_ref: 'XCIEN-PDN-VEH-2026-001',
      },
      {
        id: 'lw204-003',
        fecha: '2026-08-03',
        componente: 'Motor (rendimiento)',
        descripcion: 'Motor percibido como desforzado. Probable pérdida de contrapresión relacionada con el escape roto. Verificar en conjunto con diagnóstico de escape.',
        nivel: 'urgente',
        estado: 'pendiente',
        reportado_por: 'José Miguel Macías',
        folio_ref: 'XCIEN-PDN-VEH-2026-001',
      },
      {
        id: 'lw204-004',
        fecha: '2026-08-03',
        componente: 'Infracción de tránsito',
        descripcion: 'Infracción registrada durante la visita a Ciudad Acuña el 03 de agosto de 2026. Detalle de la boleta pendiente de documentar. El vehículo y conductor deben aclarar situación legal antes de próxima asignación.',
        nivel: 'urgente',
        estado: 'pendiente',
        reportado_por: 'José Miguel Macías',
        folio_ref: 'XCIEN-PDN-VEH-2026-001',
      },
      {
        id: 'lw204-005',
        fecha: '2026-08-03',
        componente: 'Licencia de conducir',
        descripcion: 'Licencia de conducir del conductor Alberto Espinosa VENCIDA. El conductor operó el vehículo LW-204 sin licencia vigente durante la comisión a Ciudad Acuña. Implica responsabilidad civil y legal para XCIEN en caso de accidente.',
        nivel: 'critico',
        estado: 'pendiente',
        reportado_por: 'José Miguel Macías',
        folio_ref: 'XCIEN-PDN-VEH-2026-001',
      },
    ],
  },
  {
    id: 'lw207',
    nombre: 'LW-207',
    placa: 'PX7538B',
    conductor: 'Guillermo Hernández',
    email_conductor: 'guillermo.hernandez@luminet.com.mx',
    tn360_id: 3314,
    mantenimiento: {
      garantia_vigente: false,
      observacion: 'Mantenimiento de agencia VENCIDO — garantía comprometida. Requiere cita urgente.',
    },
    hallazgos: [
      {
        id: 'lw207-001',
        fecha: '2026-08-03',
        componente: 'Mantenimiento preventivo',
        descripcion: 'Servicio de agencia vencido (km o fecha superados). Cualquier falla mecánica a partir de este punto no será cubierta por garantía. Aceite, filtros, frenos y otros componentes sin revisión desde el último servicio.',
        nivel: 'urgente',
        estado: 'pendiente',
        reportado_por: 'José Miguel Macías',
        folio_ref: 'XCIEN-PDN-VEH-2026-001',
      },
    ],
  },
];

// ─── Constantes de UI ─────────────────────────────────────────────────────────
const NIVEL_CFG: Record<Nivel, { label: string; dot: string; badge: string; row: string }> = {
  critico: { label: 'CRÍTICO',  dot: 'bg-red-500',   badge: 'bg-red-100 text-red-700 border-red-300',   row: 'border-l-red-500 bg-red-50/60 dark:bg-red-950/20'   },
  urgente: { label: 'URGENTE',  dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 border-amber-300', row: 'border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/20' },
  menor:   { label: 'MENOR',    dot: 'bg-blue-400',  badge: 'bg-blue-100 text-blue-700 border-blue-300',  row: 'border-l-blue-400 bg-blue-50/40 dark:bg-blue-950/20'   },
};
const ESTADO_CFG: Record<Estado, { label: string; color: string; icon: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'text-red-500',   icon: '⏳' },
  en_proceso: { label: 'En proceso', color: 'text-amber-500', icon: '🔧' },
  resuelto:   { label: 'Resuelto',   color: 'text-green-600', icon: '✅' },
};

const STORAGE_KEY = 'xcien_flotilla_expediente';

function loadData(): Vehiculo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return VEHICULOS_INICIAL;
    const saved: Vehiculo[] = JSON.parse(raw);
    // Merge: para cada vehículo, combinar hallazgos iniciales + guardados sin duplicar por id
    return VEHICULOS_INICIAL.map(base => {
      const savedVeh = saved.find(s => s.id === base.id);
      if (!savedVeh) return base;
      const savedIds = new Set(savedVeh.hallazgos.map(h => h.id));
      const newFromBase = base.hallazgos.filter(h => !savedIds.has(h.id));
      return {
        ...savedVeh,
        hallazgos: [...savedVeh.hallazgos, ...newFromBase],
      };
    });
  } catch {
    return VEHICULOS_INICIAL;
  }
}

function saveData(vehiculos: Vehiculo[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vehiculos));
}

// ─── Formulario nuevo hallazgo ────────────────────────────────────────────────
function NuevoHallazgoForm({
  vehiculoNombre, onSave, onCancel,
}: { vehiculoNombre: string; onSave: (h: Omit<Hallazgo, 'id'>) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    componente: '',
    descripcion: '',
    nivel: 'urgente' as Nivel,
    estado: 'pendiente' as Estado,
    reportado_por: 'José Miguel Macías',
    folio_ref: '',
  });

  const ok = form.componente.trim() && form.descripcion.trim();

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
      <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3">
        Nuevo hallazgo — {vehiculoNombre}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Fecha</label>
          <input type="date" value={form.fecha}
            onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Componente</label>
          <input type="text" placeholder="Ej: Motor, Llantas, Frenos…" value={form.componente}
            onChange={e => setForm(f => ({ ...f, componente: e.target.value }))}
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Descripción del hallazgo</label>
          <textarea rows={3} placeholder="Descripción detallada del problema observado…" value={form.descripcion}
            onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Nivel de riesgo</label>
          <select value={form.nivel} onChange={e => setForm(f => ({ ...f, nivel: e.target.value as Nivel }))}
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            <option value="critico">🔴 Crítico</option>
            <option value="urgente">🟡 Urgente</option>
            <option value="menor">🔵 Menor</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Folio de referencia (opcional)</label>
          <input type="text" placeholder="Ej: XCIEN-PDN-VEH-2026-002" value={form.folio_ref}
            onChange={e => setForm(f => ({ ...f, folio_ref: e.target.value }))}
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
        </div>
      </div>
      <div className="flex gap-2 mt-3 justify-end">
        <button onClick={onCancel}
          className="text-sm px-3 py-1.5 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
          Cancelar
        </button>
        <button onClick={() => ok && onSave(form)} disabled={!ok}
          className="text-sm px-4 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium">
          Guardar hallazgo
        </button>
      </div>
    </div>
  );
}

// ─── Tab GPS + Rutas ─────────────────────────────────────────────────────────
const GPS_POLL_MS = 90_000;

const VEH_COLORS: Record<number, string> = { 3330: '#22c55e', 3314: '#3b82f6' };
const HORARIO_COLOR: Record<string, string> = {
  laboral: '#22c55e', nocturno: '#f59e0b', madrugada: '#ef4444', finde: '#a855f7',
};

function statusOf(v: VehiculoGPS): { label: string; dot: string; text: string } {
  if (!v.activo)        return { label: 'OFFLINE',   dot: 'bg-gray-400',  text: 'text-gray-500' };
  if (v.velocidad > 0)  return { label: 'EN CAMINO', dot: 'bg-green-500', text: 'text-green-600' };
  return                       { label: 'DETENIDO',  dot: 'bg-amber-400', text: 'text-amber-600' };
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Mapa Leaflet (imperativo para evitar re-renders)
function RutasMapa({ rutas, gps }: { rutas: RutasResponse | null; gps: GPSResponse | null }) {
  const mapRef  = useRef<HTMLDivElement>(null);
  const leafRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    let L: any;
    import('leaflet').then(mod => {
      L = mod.default ?? mod;
      if (leafRef.current) { leafRef.current.remove(); leafRef.current = null; }

      const map = L.map(mapRef.current!, { zoomControl: true, attributionControl: false });
      leafRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '© OSM',
      }).addTo(map);

      const bounds: [number,number][] = [];

      // ── Rutas del día (trips start→end) ──────────────────────────────────
      rutas?.vehiculos.forEach(veh => {
        const color = VEH_COLORS[veh.tn360_id] ?? '#94a3b8';
        veh.trips.forEach(trip => {
          const pts: [number,number][] = [];
          if (trip.start_lat && trip.start_lng) {
            pts.push([trip.start_lat, trip.start_lng]);
            bounds.push([trip.start_lat, trip.start_lng]);
          }
          if (trip.end_lat && trip.end_lng) {
            pts.push([trip.end_lat, trip.end_lng]);
            bounds.push([trip.end_lat, trip.end_lng]);
          }
          if (pts.length === 2) {
            const horColor = HORARIO_COLOR[trip.horario] ?? color;
            L.polyline(pts, { color: horColor, weight: 4, opacity: 0.8 }).addTo(map)
              .bindPopup(`<b>${veh.nombre}</b><br>${trip.desde ?? '?'} – ${trip.hasta ?? '?'}<br>${trip.km.toFixed(1)} km<br>${trip.horario}<br><small>${trip.start_loc ?? ''}</small>`);
            // Marcador de inicio
            L.circleMarker(pts[0], { radius: 5, color, fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(map)
              .bindPopup(`▶ ${veh.nombre} ${trip.desde ?? ''}<br>${trip.start_loc ?? ''}`);
            // Marcador de fin
            L.circleMarker(pts[1], { radius: 5, color, fillColor: color, fillOpacity: 1, weight: 2 }).addTo(map)
              .bindPopup(`■ ${veh.nombre} ${trip.hasta ?? ''}<br>${trip.end_loc ?? ''}`);
          }
        });
      });

      // ── Posición actual (live GPS) ────────────────────────────────────────
      gps?.vehiculos.filter(v => v.lat && v.lng).forEach(v => {
        const color = VEH_COLORS[v.id] ?? '#94a3b8';
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${color};border:2px solid #fff;border-radius:50%;width:14px;height:14px;box-shadow:0 0 6px ${color}"></div>`,
          iconSize: [14,14], iconAnchor: [7,7],
        });
        L.marker([v.lat!, v.lng!], { icon }).addTo(map)
          .bindPopup(`<b>${v.nombre ?? v.id}</b><br>${v.velocidad} km/h · ${v.conductor}<br>${v.ubicacion ?? ''}`);
        bounds.push([v.lat!, v.lng!]);
      });

      // ── Tickets Odoo con coordenadas ──────────────────────────────────────
      rutas?.tickets_odoo.filter(t => t.lat && t.lng).forEach(t => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#f59e0b;border:2px solid #fff;border-radius:3px;width:12px;height:12px;transform:rotate(45deg)"></div>`,
          iconSize: [12,12], iconAnchor: [6,6],
        });
        L.marker([t.lat!, t.lng!], { icon }).addTo(map)
          .bindPopup(`<b>🎫 ${t.nombre}</b><br>${t.cliente}<br>${t.etapa}<br><small>${t.direccion}</small>`);
        bounds.push([t.lat!, t.lng!]);
      });

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      } else {
        // Default: Piedras Negras
        map.setView([28.7006, -100.5232], 12);
      }
    });

    return () => { if (leafRef.current) { leafRef.current.remove(); leafRef.current = null; } };
  }, [rutas, gps]);

  return <div ref={mapRef} style={{ height: 420, borderRadius: 8, zIndex: 0 }} />;
}

function GPSTab({ vehiculosExpediente }: { vehiculosExpediente: Vehiculo[] }) {
  const todayStr = todayISO();
  const [fecha, setFecha]           = useState(todayStr);
  const [prefijo, setPrefijo]       = useState('');
  const [fechas, setFechas]         = useState<string[]>([]);
  const [rutas, setRutas]           = useState<RutasResponse | null>(null);
  const [gps, setGps]               = useState<GPSResponse | null>(null);
  const [loading, setLoading]       = useState(false);
  const [loadingGps, setLoadingGps] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [selectedVeh, setSelVeh]    = useState<number | null>(null);
  const pollRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cargar historial de fechas disponibles
  useEffect(() => {
    fetch('/api/gps/rutas/fechas').then(r => r.json()).then(d => setFechas(d.fechas ?? [])).catch(() => {});
  }, []);

  // Posición live (polling 90s)
  const fetchLive = useCallback(async () => {
    setLoadingGps(true);
    try {
      const r = await fetch('/api/gps/vehiculos');
      if (r.ok) setGps(await r.json());
    } finally { setLoadingGps(false); }
  }, []);

  useEffect(() => {
    fetchLive();
    pollRef.current = setInterval(fetchLive, GPS_POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchLive]);

  // Rutas del día seleccionado
  const fetchRutas = useCallback(async (f: string, forzar = false, pref = prefijo) => {
    setLoading(true); setError(null);
    try {
      const url = `/api/gps/rutas?fecha=${f}${forzar ? '&forzar=true' : ''}${pref ? `&prefijo=${pref}` : ''}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: RutasResponse = await r.json();
      setRutas(data);
      // Actualizar lista de fechas
      fetch('/api/gps/rutas/fechas').then(r2 => r2.json()).then(d => setFechas(d.fechas ?? [])).catch(() => {});
    } catch (e: any) {
      setError(e.message ?? 'Error');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRutas(fecha, false, prefijo); }, [fecha, prefijo, fetchRutas]);

  const esHoy = fecha === todayStr;
  const vehActivo = rutas?.vehiculos.find(v => v.tn360_id === selectedVeh);

  return (
    <div className="space-y-3">
      {/* ── Controles ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        {/* Selector de fecha */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500">Fecha:</label>
          <input type="date" value={fecha}
            max={todayStr}
            onChange={e => setFecha(e.target.value)}
            className="text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
        </div>
        {/* Historial rápido */}
        {fechas.slice(0,5).filter(f => f !== fecha).map(f => (
          <button key={f} onClick={() => setFecha(f)}
            className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            {f}
          </button>
        ))}
        {/* Filtro por tipo */}
        <div className="flex gap-1 flex-wrap">
          {[
            { v: '',   l: 'Toda la flota' },
            { v: 'LW', l: 'LW — PDN' },
            { v: 'SD', l: 'SD — Sedanes' },
            { v: 'SE', l: 'SE — Noreste' },
            { v: 'HV', l: 'HV — Van' },
          ].map(opt => (
            <button key={opt.v} onClick={() => setPrefijo(opt.v)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                prefijo === opt.v
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-gray-400'
              }`}>
              {opt.l}
            </button>
          ))}
        </div>

        <button onClick={() => fetchRutas(fecha, esHoy, prefijo)} disabled={loading}
          className="ml-auto text-xs px-3 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40">
          {loading ? '⟳ Cargando…' : esHoy ? '↻ Actualizar' : '↻ Recargar'}
        </button>
      </div>

      {/* ── Estado ──────────────────────────────────────────────────────── */}
      <div className="px-4 flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400">
        <span className={`w-2 h-2 rounded-full ${error ? 'bg-red-500' : rutas ? 'bg-green-500' : 'bg-gray-300'}`} />
        {error && <span className="text-red-500">{error}</span>}
        {rutas && !error && (
          <>
            <span>{rutas.fecha} · {rutas.from_cache ? '📁 caché' : '🔴 en vivo'} · {rutas.vehiculos.filter(v => v.n_viajes > 0).length}/{rutas.total_vehs ?? rutas.vehiculos.length} vehículos activos</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="font-medium text-gray-600 dark:text-gray-300">
              {rutas.vehiculos.reduce((s, v) => s + v.km_total, 0).toFixed(0)} km flota
            </span>
            {rutas.vehiculos.filter(v => v.n_viajes > 0).map(v => (
              <span key={v.tn360_id} className="font-medium" style={{ color: VEH_COLORS[v.tn360_id] ?? '#94a3b8' }}>
                {v.nombre}: {v.n_viajes}v · {v.km_total.toFixed(0)} km
              </span>
            ))}
            {rutas.tickets_odoo.length > 0 && (
              <span className="text-amber-500">🎫 {rutas.tickets_odoo.length} tickets Odoo</span>
            )}
          </>
        )}
        {loadingGps && <span>📡 GPS live…</span>}
      </div>

      {/* ── Mapa ─────────────────────────────────────────────────────────── */}
      <div className="px-4">
        <RutasMapa rutas={rutas} gps={gps} />
        {/* Leyenda */}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Horario laboral</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block" /> Nocturno</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block" /> Madrugada</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-500 inline-block" /> Fin de semana</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rotate-45 bg-amber-500 border border-white" /> Ticket Odoo</span>
        </div>
      </div>

      {/* ── Selector de vehículo / Detalle de viajes ─────────────────────── */}
      <div className="px-4 pb-4 space-y-3">
        <div className="flex gap-2">
          <button onClick={() => setSelVeh(null)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              selectedVeh === null ? 'bg-gray-900 text-white border-gray-900' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400'
            }`}>
            Todos los viajes
          </button>
          {rutas?.vehiculos.filter(v => v.n_viajes > 0).map(v => (
            <button key={v.tn360_id} onClick={() => setSelVeh(v.tn360_id)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                selectedVeh === v.tn360_id ? 'text-white border-transparent' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400'
              }`}
              style={selectedVeh === v.tn360_id ? { background: VEH_COLORS[v.tn360_id], borderColor: VEH_COLORS[v.tn360_id] } : {}}>
              {v.nombre} ({v.n_viajes})
            </button>
          ))}
        </div>

        {/* Tabla de viajes */}
        {(selectedVeh !== null ? [vehActivo!].filter(Boolean) : (rutas?.vehiculos ?? []).filter(v => v.n_viajes > 0)).map(veh => (
          <div key={veh.tn360_id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-2 flex items-center gap-2 border-b border-gray-100 dark:border-gray-700"
              style={{ borderLeftWidth: 4, borderLeftColor: VEH_COLORS[veh.tn360_id] }}>
              <span className="font-bold text-sm text-gray-900 dark:text-white">{veh.nombre}</span>
              <span className="text-xs text-gray-400 font-mono">{veh.placa}</span>
              <span className="ml-auto text-xs text-gray-500">{veh.n_viajes} viajes · {veh.km_total.toFixed(1)} km totales</span>
            </div>
            {veh.trips.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">Sin viajes registrados este día.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {veh.trips.map((trip, i) => (
                  <div key={trip.trip_id ?? i} className="px-4 py-2.5 flex items-start gap-3">
                    <div className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                      style={{ background: HORARIO_COLOR[trip.horario] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-mono text-gray-700 dark:text-gray-300">
                          {trip.desde ?? '?'} – {trip.hasta ?? '?'}
                        </span>
                        <span className="text-xs font-bold text-gray-500">{trip.km.toFixed(1)} km</span>
                        <span className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: HORARIO_COLOR[trip.horario] + '22', color: HORARIO_COLOR[trip.horario] }}>
                          {trip.horario}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        <span>▶ {trip.start_loc ?? '—'}</span>
                        {trip.end_loc && trip.end_loc !== trip.start_loc && (
                          <span> → {trip.end_loc}</span>
                        )}
                      </div>
                    </div>
                    {trip.start_lat && trip.start_lng && (
                      <a href={`https://maps.google.com/?q=${trip.start_lat},${trip.start_lng}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline shrink-0">
                        Mapa ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Tickets Odoo del día */}
        {rutas && rutas.tickets_odoo.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2"
              style={{ borderLeftWidth: 4, borderLeftColor: '#f59e0b' }}>
              <span className="font-bold text-sm text-gray-900 dark:text-white">🎫 Tickets Odoo — {rutas.fecha}</span>
              <span className="ml-auto text-xs text-gray-500">{rutas.tickets_odoo.length} asignaciones</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {rutas.tickets_odoo.map(t => (
                <div key={t.id} className="px-4 py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{t.nombre}</span>
                      <span className="text-xs text-gray-400">{t.etapa}</span>
                      {t.lat && t.lng ? (
                        <span className="text-xs text-green-600">📍 Con coords</span>
                      ) : (
                        <span className="text-xs text-gray-400">Sin coords</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {t.cliente} · {t.direccion}
                    </div>
                    {t.tecnicos.length > 0 && (
                      <div className="text-xs text-blue-500 mt-0.5">{t.tecnicos.join(', ')}</div>
                    )}
                  </div>
                  {t.lat && t.lng && (
                    <a href={`https://maps.google.com/?q=${t.lat},${t.lng}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline shrink-0">
                      Mapa ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function FlotillaSection({ theme }: { theme?: any }) {
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>(loadData);
  const [selected, setSelected] = useState<string>('lw204');
  const [showForm, setShowForm] = useState(false);
  const [filterEstado, setFilterEstado] = useState<string>('todos');
  const [activeTab, setActiveTab] = useState<Tab>('expediente');

  useEffect(() => { saveData(vehiculos); }, [vehiculos]);

  const veh = vehiculos.find(v => v.id === selected)!;
  const hallazgos = veh.hallazgos
    .filter(h => filterEstado === 'todos' || h.estado === filterEstado)
    .sort((a, b) => {
      const order: Record<Nivel, number> = { critico: 0, urgente: 1, menor: 2 };
      if (order[a.nivel] !== order[b.nivel]) return order[a.nivel] - order[b.nivel];
      return b.fecha.localeCompare(a.fecha);
    });

  const addHallazgo = (data: Omit<Hallazgo, 'id'>) => {
    const id = `${selected}-${Date.now()}`;
    setVehiculos(prev => prev.map(v =>
      v.id === selected ? { ...v, hallazgos: [...v.hallazgos, { ...data, id }] } : v
    ));
    setShowForm(false);
  };

  const updateEstado = (hid: string, estado: Estado) => {
    setVehiculos(prev => prev.map(v =>
      v.id !== selected ? v : {
        ...v,
        hallazgos: v.hallazgos.map(h => h.id === hid ? { ...h, estado } : h),
      }
    ));
  };

  const updateMantenimiento = (patch: Partial<Mantenimiento>) => {
    setVehiculos(prev => prev.map(v =>
      v.id !== selected ? v : { ...v, mantenimiento: { ...v.mantenimiento, ...patch } }
    ));
  };

  // KPIs globales
  const allHallazgos  = vehiculos.flatMap(v => v.hallazgos);
  const criticos      = allHallazgos.filter(h => h.nivel === 'critico' && h.estado !== 'resuelto').length;
  const urgentes      = allHallazgos.filter(h => h.nivel === 'urgente' && h.estado !== 'resuelto').length;
  const pendientes    = allHallazgos.filter(h => h.estado === 'pendiente').length;
  const sinGarantia   = vehiculos.filter(v => !v.mantenimiento.garantia_vigente).length;

  return (
    <div className="p-4 space-y-4" style={{ width: '100%', boxSizing: 'border-box' }}>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Flotilla — Plaza PDN
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Supervisión: José Miguel Macías Contreras · Folio base: XCIEN-PDN-VEH-2026-001
          </p>
        </div>
        {/* Nav de tabs */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
          {([
            { id: 'expediente', label: '📋 Expediente' },
            { id: 'gps',        label: '📡 GPS en Vivo' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-1.5 font-medium transition-colors ${
                activeTab === t.id
                  ? 'bg-gray-900 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab GPS */}
      {activeTab === 'gps' && <GPSTab vehiculosExpediente={vehiculos} />}

      {/* Tab Expediente */}
      {activeTab === 'expediente' && <>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { v: criticos,    l: 'Críticos activos',    c: 'text-red-600',   bg: 'bg-red-50 dark:bg-red-950/20',    i: '🔴' },
          { v: urgentes,    l: 'Urgentes activos',    c: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/20',i: '🟡' },
          { v: pendientes,  l: 'Sin resolver',        c: 'text-red-600',   bg: 'bg-red-50 dark:bg-red-950/20',    i: '⏳' },
          { v: sinGarantia, l: 'Sin garantía vigente',c: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/20',i: '⚠️' },
        ].map(k => (
          <div key={k.l} className={`${k.bg} rounded-lg p-3 border border-gray-200 dark:border-gray-700`}>
            <div className="text-base">{k.i}</div>
            <div className={`text-2xl font-bold ${k.c}`}>{k.v}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 leading-tight mt-0.5">{k.l}</div>
          </div>
        ))}
      </div>

      {/* Tabs por vehículo */}
      <div className="flex gap-2">
        {vehiculos.map(v => {
          const pendV = v.hallazgos.filter(h => h.estado !== 'resuelto');
          const hasCrit = pendV.some(h => h.nivel === 'critico');
          const isActive = v.id === selected;
          return (
            <button key={v.id} onClick={() => { setSelected(v.id); setShowForm(false); setFilterEstado('todos'); }}
              className={`flex-1 text-left p-3 rounded-xl border-2 transition-all ${
                isActive
                  ? 'border-green-500 bg-white dark:bg-gray-800 shadow-sm'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:border-gray-300'
              }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-gray-900 dark:text-white text-sm">{v.nombre}</span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                  hasCrit ? 'bg-red-100 text-red-700' : pendV.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                }`}>
                  {hasCrit ? '🔴 CRÍTICO' : pendV.length > 0 ? '🟡 URGENTE' : '✅ OK'}
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{v.conductor}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">{v.placa}</div>
              <div className="text-xs mt-1">
                <span className="text-red-500 font-medium">{pendV.length} hallazgo{pendV.length !== 1 ? 's' : ''} activo{pendV.length !== 1 ? 's' : ''}</span>
                {!v.mantenimiento.garantia_vigente && (
                  <span className="text-amber-600 ml-2">· ⚠ Garantía</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Expediente del vehículo seleccionado */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* Header unidad */}
        <div className="bg-gray-900 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-white font-bold">{veh.nombre}</span>
            <span className="text-gray-400 text-sm">·</span>
            <span className="text-gray-300 text-sm font-mono">{veh.placa}</span>
            <span className="text-gray-400 text-sm">·</span>
            <span className="text-gray-300 text-sm">{veh.conductor}</span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${
            veh.mantenimiento.garantia_vigente
              ? 'bg-green-900 text-green-300'
              : 'bg-red-900 text-red-300'
          }`}>
            {veh.mantenimiento.garantia_vigente ? '✓ Garantía OK' : '⚠ Sin garantía'}
          </span>
        </div>

        {/* Mantenimiento */}
        <div className={`px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2 ${
          !veh.mantenimiento.garantia_vigente
            ? 'bg-amber-50 dark:bg-amber-950/20'
            : 'bg-gray-50 dark:bg-gray-900/50'
        }`}>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            🔧 {veh.mantenimiento.observacion || 'Mantenimiento: sin observaciones'}
          </span>
          <button
            onClick={() => updateMantenimiento({ garantia_vigente: !veh.mantenimiento.garantia_vigente })}
            className={`text-xs px-2 py-0.5 rounded border font-medium shrink-0 ${
              veh.mantenimiento.garantia_vigente
                ? 'border-green-300 text-green-700 hover:bg-green-100'
                : 'border-amber-300 text-amber-700 hover:bg-amber-100'
            }`}>
            {veh.mantenimiento.garantia_vigente ? 'Marcar vencida' : 'Marcar vigente'}
          </button>
        </div>

        {/* Barra de acciones */}
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {(['todos','pendiente','en_proceso','resuelto'] as const).map(e => (
              <button key={e} onClick={() => setFilterEstado(e)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  filterEstado === e
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400'
                }`}>
                {e === 'todos' ? 'Todos' : ESTADO_CFG[e].label}
                {e !== 'todos' && (
                  <span className="ml-1 opacity-60">
                    ({veh.hallazgos.filter(h => h.estado === e).length})
                  </span>
                )}
              </button>
            ))}
          </div>
          <button onClick={() => setShowForm(f => !f)}
            className="text-xs px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-medium transition-colors">
            {showForm ? '✕ Cancelar' : '+ Nuevo hallazgo'}
          </button>
        </div>

        {/* Formulario nuevo hallazgo */}
        {showForm && (
          <NuevoHallazgoForm
            vehiculoNombre={veh.nombre}
            onSave={addHallazgo}
            onCancel={() => setShowForm(false)}
          />
        )}

        {/* Lista hallazgos */}
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {hallazgos.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
              {filterEstado === 'todos'
                ? 'Esta unidad no tiene hallazgos registrados.'
                : `Sin hallazgos en estado "${ESTADO_CFG[filterEstado as Estado]?.label}".`}
            </div>
          )}
          {hallazgos.map(h => {
            const nc = NIVEL_CFG[h.nivel];
            const ec = ESTADO_CFG[h.estado];
            return (
              <div key={h.id} className={`px-4 py-3 border-l-4 ${nc.row}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${nc.badge}`}>
                        {nc.label}
                      </span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {h.componente}
                      </span>
                      <span className="text-xs text-gray-400">{h.fecha}</span>
                      {h.folio_ref && (
                        <span className="text-xs text-gray-400 font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">
                          {h.folio_ref}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">
                      {h.descripcion}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Reportado por: {h.reportado_por}
                    </p>
                  </div>
                  {/* Cambio de estado */}
                  <div className="flex flex-col gap-1 shrink-0">
                    <span className={`text-xs font-medium ${ec.color} text-right`}>
                      {ec.icon} {ec.label}
                    </span>
                    <select
                      value={h.estado}
                      onChange={e => updateEstado(h.id, e.target.value as Estado)}
                      className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                      <option value="pendiente">Pendiente</option>
                      <option value="en_proceso">En proceso</option>
                      <option value="resuelto">Resuelto</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Resumen por vehículo */}
        {veh.hallazgos.length > 0 && (
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
            <span>Total hallazgos: <b className="text-gray-700 dark:text-gray-300">{veh.hallazgos.length}</b></span>
            <span>Críticos: <b className="text-red-600">{veh.hallazgos.filter(h => h.nivel === 'critico').length}</b></span>
            <span>Urgentes: <b className="text-amber-600">{veh.hallazgos.filter(h => h.nivel === 'urgente').length}</b></span>
            <span>Resueltos: <b className="text-green-600">{veh.hallazgos.filter(h => h.estado === 'resuelto').length}</b></span>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        El reporte semanal de flotilla (viernes 08:00 AM) cruza automáticamente los viajes TN360 con tickets Odoo Field Service.
        Los hallazgos se guardan localmente en este navegador.
      </p>

      </> /* fin tab expediente */}
    </div>
  );
}
