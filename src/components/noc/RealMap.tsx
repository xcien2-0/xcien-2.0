import { useEffect, useRef, useMemo, useState } from 'react';
import { NOCCity } from '@/types/noc';

// ── Color helpers ─────────────────────────────────────────────────────────────
const G  = '#00ff88';   // verde  — healthy  ≥ 85
const Y  = '#ffcc00';   // amarillo — degraded 65–84
const O  = '#ff8800';   // naranja  — alerta   45–64
const R  = '#ff3366';   // rojo     — crítico   < 45
function nodeColor(score: number) {
  if (score >= 85) return G;
  if (score >= 65) return Y;
  if (score >= 45) return O;
  return R;
}

const ODOO_COLOR = '#00b4d8';

// ── Source priority & badge helpers ──────────────────────────────────────────
// Orden de prioridad: Energía > Datos > WL. Mayor prioridad = badge más grande.
const SOURCE_META: Record<string, { symbol: string; color: string; priority: number; size: number }> = {
  'Energía':   { symbol: '⚡', color: '#ffcc00', priority: 1, size: 13 },
  'Datos':     { symbol: '▲', color: '#00ff88', priority: 2, size: 11 },
  'ISP Principal':  { symbol: '◉', color: '#60a5fa', priority: 3, size: 9  },
  'CX Datos':  { symbol: '◆', color: '#a78bfa', priority: 4, size: 9  },
  'CX Radios': { symbol: '●', color: '#fb923c', priority: 5, size: 9  },
  'Central':   { symbol: '★', color: '#f472b6', priority: 6, size: 9  },
};

function buildSourceBadges(sources: string[] | undefined): string {
  if (!sources || sources.length === 0) return '';
  return [...sources]
    .filter(s => SOURCE_META[s])
    .sort((a, b) => (SOURCE_META[a]?.priority ?? 9) - (SOURCE_META[b]?.priority ?? 9))
    .map(s => {
      const m = SOURCE_META[s];
      return `<span style="font-size:${m.size}px;color:${m.color};line-height:1;text-shadow:0 0 5px ${m.color}88;" title="${s}">${m.symbol}</span>`;
    })
    .join('');
}

function buildSourceTooltip(
  sources: string[] | undefined,
  sourceScores: Record<string, number> | undefined
): string {
  if (!sources || sources.length === 0) return '';
  return [...sources]
    .filter(s => SOURCE_META[s])
    .sort((a, b) => (SOURCE_META[a]?.priority ?? 9) - (SOURCE_META[b]?.priority ?? 9))
    .map(s => {
      const m   = SOURCE_META[s];
      const sc  = sourceScores?.[s];
      const scStr = sc != null ? ` <b style="color:${m.color}">${Math.round(sc)}</b>` : '';
      return `<span style="color:${m.color}">${m.symbol} ${s}</span>${scStr}`;
    })
    .join(' · ');
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface OdooServicio {
  id: number;
  lat: number;
  lng: number;
  nombre: string;
  cliente: string;
  bajada?: number;
  subida?: number;
  rb?: string;
}

export interface RadiobaseHarmonized {
  id: number;
  nombre: string;
  lat: number;
  lng: number;
  clientes: number;
  estado_odoo: string;
  status: 'up' | 'degraded' | 'down' | 'unknown';
  alerts_count: number;
  sources: {
    odoo: any;
    nocboard: any;
    uisp: any;
    cambium: any;
    mimosa: any;
  };
  soporte: { total: number; tickets: any[] };
  campo:   { total: number; tareas:  any[] };
}

interface Props {
  cities: NOCCity[];
  onSelectCity: (city: NOCCity) => void;
  selectedCityId: string | null;
  odooServices?: OdooServicio[];
  radiobases?: RadiobaseHarmonized[];
  showRadiobases?: boolean;
  onSelectRadiobase?: (rb: RadiobaseHarmonized | null) => void;
  selectedRbId?: number | null;
  vendorLayers?: Partial<Record<VendorId, boolean>>;
  onVendorToggle?: (id: VendorId) => void;
}

// ── Map tile providers ────────────────────────────────────────────────────────
const MAP_TILES = [
  {
    id: 'dark',
    label: 'Dark',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { subdomains: 'abcd', maxZoom: 18 },
    filter: 'invert(100%) hue-rotate(180deg) brightness(90%) contrast(90%) saturate(0.8)',
    overlay: null,
  },
  {
    id: 'satellite',
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 18 },
    filter: 'brightness(1.05) saturate(1.2)',
    overlay: null,
  },
  {
    id: 'hybrid',
    label: 'Híbrido',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 18 },
    filter: 'brightness(1.05) saturate(1.1)',
    overlay: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  {
    id: 'light',
    label: 'Claro',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { subdomains: 'abcd', maxZoom: 18 },
    filter: 'brightness(0.95)',
    overlay: null,
  },
  {
    id: 'osm',
    label: 'OSM',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { subdomains: 'abc', maxZoom: 19 },
    filter: 'brightness(0.92) saturate(0.9)',
    overlay: null,
  },
] as const;
type MapTileId = typeof MAP_TILES[number]['id'];

// ── Radiobase status colors ───────────────────────────────────────────────────
const RB_COLOR: Record<string, string> = {
  up:       '#00ff88',
  degraded: '#ffcc00',
  down:     '#ff3366',
  unknown:  '#94a3b8',
};

// ── Vendor layers ─────────────────────────────────────────────────────────────
const VENDOR_LAYERS = [
  { id: 'uisp',    label: 'Ubiquiti', color: '#0891b2', icon: '◆' },
  { id: 'cambium', label: 'Cambium',  color: '#d97706', icon: '▲' },
  { id: 'mimosa',  label: 'Mimosa',   color: '#7c3aed', icon: '●' },
] as const;
type VendorId = typeof VENDOR_LAYERS[number]['id'];

// ── Component ─────────────────────────────────────────────────────────────────
export default function RealMap({
  cities, onSelectCity, selectedCityId,
  odooServices = [],
  radiobases = [], showRadiobases = false,
  onSelectRadiobase, selectedRbId = null,
  vendorLayers = {}, onVendorToggle,
}: Props) {
  const mapRef        = useRef<any>(null);
  const leafRef       = useRef<any>(null);
  const layerRef      = useRef<any>(null);
  const odooLayerRef  = useRef<any>(null);
  const rbLayerRef    = useRef<any>(null);
  const tileLayerRef    = useRef<any>(null);
  const overlayLayerRef = useRef<any>(null);
  const vendorLayerRefs = useRef<Partial<Record<VendorId, any>>>({});
  const svgRef        = useRef<SVGSVGElement | null>(null);
  const citiesRef     = useRef<NOCCity[]>(cities);
  const selectedRef   = useRef<string | null>(selectedCityId);
  const fittedRef     = useRef(false);
  const containerId   = 'noc-real-map';
  const [mapType, setMapType] = useState<MapTileId>('dark');

  // Keep refs in sync with props
  citiesRef.current   = cities;
  selectedRef.current = selectedCityId;

  // ── Init Leaflet map (once) ───────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    import('leaflet').then(L => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;

      const map = L.map(containerId, {
        center: [23.5, -102.5],
        zoom: 5,
        zoomControl: true,
        attributionControl: false,
        minZoom: 4,
      });

      const initialTile = MAP_TILES[0];
      tileLayerRef.current = L.tileLayer(initialTile.url, initialTile.opts).addTo(map);

      // Aplicar filtro dark en la carga inicial
      setTimeout(() => {
        const pane = document.querySelector(`#${containerId} .leaflet-tile-pane`) as HTMLElement | null;
        if (pane) pane.style.filter = initialTile.filter;
      }, 50);

      leafRef.current = L;
      mapRef.current  = map;

      // SVG overlay — created once
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:500;overflow:visible';
      document.getElementById(containerId)?.appendChild(svg);
      svgRef.current = svg;

      // Redraw arcs on pan/zoom using always-fresh refs
      map.on('moveend zoomend', () => {
        drawArcs(map, L, svg, citiesRef.current, selectedRef.current);
      });

      // Fix invalid size when container was hidden during init
      requestAnimationFrame(() => { map.invalidateSize(); });
      setTimeout(() => { map.invalidateSize(); }, 300);
    });

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; fittedRef.current = false; }
    };
  }, []);

  // Re-invalidate when container becomes visible (resize observer)
  useEffect(() => {
    const el = document.getElementById(containerId);
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (mapRef.current) mapRef.current.invalidateSize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Swap tile layer when mapType changes ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const L   = leafRef.current;
    if (!map || !L) return;
    const tile = MAP_TILES.find(t => t.id === mapType) ?? MAP_TILES[0];

    // Remove previous base + overlay
    if (tileLayerRef.current)   { map.removeLayer(tileLayerRef.current); }
    if (overlayLayerRef.current) { map.removeLayer(overlayLayerRef.current); overlayLayerRef.current = null; }

    tileLayerRef.current = L.tileLayer(tile.url, tile.opts).addTo(map);

    // Add labels overlay for hybrid
    if (tile.overlay) {
      overlayLayerRef.current = L.tileLayer(tile.overlay, { maxZoom: 18, opacity: 0.9 }).addTo(map);
    }

    // Apply per-tile CSS filter to the tile pane
    const pane = document.querySelector(`#${containerId} .leaflet-tile-pane`) as HTMLElement | null;
    if (pane) pane.style.filter = tile.filter;
  }, [mapType]);

  // ── Redraw markers + arcs when data changes ───────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const L   = leafRef.current;
    const svg = svgRef.current;
    if (!map || !L || !svg) return;

    // Markers
    if (layerRef.current) layerRef.current.clearLayers();
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;

    // fitBounds only on first load with real data
    if (cities.length > 0 && !fittedRef.current) {
      const bounds = L.latLngBounds(cities.map(c => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 7, animate: false });
      fittedRef.current = true;
    }

    // Draw arcs immediately (fitBounds with animate:false won't fire moveend)
    drawArcs(map, L, svg, cities, selectedCityId);

    cities.forEach(city => {
      // Usa priorityScore si está disponible — refleja jerarquía Energía > Datos > WL
      const displayScore = city.priorityScore ?? city.score;
      const c     = nodeColor(displayScore);
      const isSelected = city.id === selectedCityId;
      const size  = isSelected ? 18 : Math.max(10, Math.min(20, 8 + city.totalHosts / 20));
      const badges = buildSourceBadges(city.sources);
      const totalH = size + (badges ? 14 : 0);

      const icon = L.divIcon({
        className: '',
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
            <div style="
              width:${size}px;height:${size}px;border-radius:50%;
              background:${c}22;border:2px solid ${c};
              box-shadow:0 0 ${isSelected ? 20 : 10}px ${c}88;
              display:flex;align-items:center;justify-content:center;
              ${isSelected ? `animation:noc-pulse 1.5s ease-in-out infinite;` : ''}
            ">
              <div style="width:${size * 0.35}px;height:${size * 0.35}px;border-radius:50%;background:${c};"></div>
            </div>
            ${badges ? `<div style="display:flex;gap:2px;line-height:1;">${badges}</div>` : ''}
          </div>`,
        iconSize:   [size, totalH],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([city.lat, city.lng], { icon })
        .bindTooltip(`
          <div style="font-family:monospace;font-size:11px;background:#000d07;border:1px solid ${c}40;border-radius:8px;padding:8px 12px;color:#fff;min-width:160px">
            <div style="font-weight:800;color:${c};margin-bottom:5px">${city.name.toUpperCase()}</div>
            <div>Score: <b style="color:${c}">${Math.round(displayScore)}</b>${city.priorityScore != null && city.priorityScore !== city.score ? ` <span style="opacity:0.45;font-size:9px">(avg ${Math.round(city.score)})</span>` : ''}</div>
            <div>Hosts: ${city.online}↑ ${city.offline > 0 ? `<span style="color:${R}">${city.offline}↓</span>` : ''}</div>
            ${city.sources?.length ? `<div style="margin-top:5px;border-top:1px solid ${c}20;padding-top:4px;font-size:10px">${buildSourceTooltip(city.sources, city.sourceScores)}</div>` : ''}
          </div>`, {
          className: 'noc-tooltip',
          permanent: false,
          opacity: 1,
          direction: 'top',
          offset: [0, -size / 2],
        })
        .on('click', () => onSelectCity(city));

      group.addLayer(marker);
    });

    drawArcs(map, L, svg, cities, selectedCityId);
  }, [cities, selectedCityId]);

  // ── Odoo customer layer ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const L   = leafRef.current;
    if (!map || !L) return;

    if (odooLayerRef.current) { odooLayerRef.current.clearLayers(); }
    if (!odooServices.length) return;

    const group = odooLayerRef.current ?? L.layerGroup().addTo(map);
    odooLayerRef.current = group;
    group.clearLayers();

    odooServices.forEach(s => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:5px;height:5px;border-radius:50%;background:${ODOO_COLOR};opacity:0.75;box-shadow:0 0 4px ${ODOO_COLOR}88;"></div>`,
        iconSize:   [5, 5],
        iconAnchor: [2.5, 2.5],
      });
      L.marker([s.lat, s.lng], { icon })
        .bindTooltip(`
          <div style="font-family:monospace;font-size:11px;background:#000d14;border:1px solid ${ODOO_COLOR}40;border-radius:8px;padding:8px 12px;color:#fff">
            <div style="font-weight:800;color:${ODOO_COLOR};margin-bottom:4px">${s.cliente || s.nombre}</div>
            ${s.bajada ? `<div>↓ ${s.bajada} Mbps &nbsp; ↑ ${s.subida} Mbps</div>` : ''}
            ${s.rb ? `<div style="color:rgba(255,255,255,0.5)">RB: ${s.rb}</div>` : ''}
          </div>`, {
          className: 'noc-tooltip', permanent: false, opacity: 1, direction: 'top', offset: [0, -4],
        })
        .addTo(group);
    });
  }, [odooServices]);

  // ── Radiobase layer ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const L   = leafRef.current;
    if (!map || !L) return;

    if (rbLayerRef.current) { rbLayerRef.current.clearLayers(); }

    if (!showRadiobases || !radiobases.length) return;

    const maxClientes = Math.max(...radiobases.map(r => r.clientes), 1);
    const group = rbLayerRef.current ?? L.layerGroup().addTo(map);
    rbLayerRef.current = group;
    group.clearLayers();

    radiobases.forEach(rb => {
      const c       = RB_COLOR[rb.status] ?? RB_COLOR.unknown;
      const isSelected = rb.id === selectedRbId;
      const size    = Math.max(10, Math.min(26, 10 + (rb.clientes / maxClientes) * 16));
      const hasTix  = rb.soporte.total > 0;
      const hasCampo= rb.campo.total > 0;

      const badgeHtml = [
        hasTix   ? `<span style="font-size:9px;background:#ff336644;border-radius:10px;padding:1px 5px;color:#ff6688;font-weight:700">⚠${rb.soporte.total}</span>` : '',
        hasCampo ? `<span style="font-size:9px;background:#60a5fa22;border-radius:10px;padding:1px 5px;color:#60a5fa;font-weight:700">🔧${rb.campo.total}</span>` : '',
      ].filter(Boolean).join('');

      const icon = L.divIcon({
        className: '',
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
          <div style="
            width:${size}px;height:${size}px;
            background:${c}18;border:2px solid ${c};border-radius:4px;
            box-shadow:0 0 ${isSelected ? 20 : 8}px ${c}66;
            display:flex;align-items:center;justify-content:center;font-size:${size * 0.55}px;
            ${isSelected ? `animation:noc-pulse 1.5s ease-in-out infinite;` : ''}
          ">📡</div>
          ${badgeHtml ? `<div style="display:flex;gap:2px;">${badgeHtml}</div>` : ''}
        </div>`,
        iconSize:   [size, size + (badgeHtml ? 14 : 0)],
        iconAnchor: [size / 2, size / 2],
      });

      const statusLabel = { up:'✅ Operando', degraded:'⚠ Degradado', down:'🔴 Caído', unknown:'❔ Sin monitoreo' }[rb.status] ?? '';
      const tipContent = `
        <div style="font-family:monospace;font-size:11px;background:#000d07;border:1px solid ${c}40;border-radius:8px;padding:8px 12px;color:#fff;min-width:180px">
          <div style="font-weight:800;color:${c};margin-bottom:4px">${rb.nombre.toUpperCase()}</div>
          <div style="color:rgba(255,255,255,0.6);margin-bottom:5px">${statusLabel}</div>
          <div>👥 ${rb.clientes} clientes</div>
          ${rb.soporte.total ? `<div style="color:#ff6688">⚠ ${rb.soporte.total} ticket${rb.soporte.total>1?'s':''} abierto${rb.soporte.total>1?'s':''}</div>` : ''}
          ${rb.campo.total   ? `<div style="color:#60a5fa">🔧 ${rb.campo.total} tarea${rb.campo.total>1?'s':''} en campo</div>` : ''}
        </div>`;

      L.marker([rb.lat, rb.lng], { icon })
        .bindTooltip(tipContent, {
          className: 'noc-tooltip', permanent: false, opacity: 1, direction: 'top',
          offset: [0, -size / 2],
        })
        .on('click', () => onSelectRadiobase?.(rb))
        .addTo(group);
    });
  }, [radiobases, showRadiobases, selectedRbId]);

  // ── Vendor layers (UISP / Cambium / Mimosa) ───────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const L   = leafRef.current;
    if (!map || !L) return;

    VENDOR_LAYERS.forEach(v => {
      const active = !!vendorLayers[v.id];
      let grp = vendorLayerRefs.current[v.id];

      if (!active) {
        if (grp) { grp.clearLayers(); }
        return;
      }

      if (!grp) {
        grp = L.layerGroup().addTo(map);
        vendorLayerRefs.current[v.id] = grp;
      }
      grp.clearLayers();

      // Render markers for radiobases that have data from this vendor source
      radiobases.forEach(rb => {
        const src = rb.sources[v.id as keyof typeof rb.sources];
        if (!src) return; // no data yet for this vendor

        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:14px;height:14px;
            background:${v.color}22;border:2px solid ${v.color};
            border-radius:3px;display:flex;align-items:center;justify-content:center;
            font-size:8px;color:${v.color};box-shadow:0 0 8px ${v.color}66;
          ">${v.icon}</div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const tip = `<div style="font-family:monospace;font-size:11px;background:#0a0a1a;border:1px solid ${v.color}40;border-radius:6px;padding:6px 10px;color:#fff">
          <div style="color:${v.color};font-weight:800">${v.label}</div>
          <div style="opacity:0.7">${rb.nombre}</div>
        </div>`;
        L.marker([rb.lat, rb.lng], { icon })
          .bindTooltip(tip, { className: 'noc-tooltip', permanent: false, opacity: 1, direction: 'top' })
          .addTo(grp);
      });
    });
  }, [vendorLayers, radiobases]);

  return (
    <>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div id={containerId} style={{ width: '100%', height: '100%', borderRadius: 18, overflow: 'hidden' }} />

        {/* Bottom controls row */}
        <div style={{
          position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 1000,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          pointerEvents: 'none',
        }}>
          {/* Map type switcher — left */}
          <div style={{
            display: 'flex', gap: 4, background: 'rgba(10,20,14,0.88)',
            border: '1px solid #00ff8830', borderRadius: 8,
            padding: '4px 6px', backdropFilter: 'blur(6px)',
            pointerEvents: 'all',
          }}>
            <span style={{ fontSize: 9, color: '#00ff8855', fontFamily: 'monospace', alignSelf: 'center', marginRight: 2 }}>MAPA</span>
            {MAP_TILES.map(t => (
              <button key={t.id} onClick={() => setMapType(t.id)} style={{
                padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
                fontSize: 11, fontFamily: 'monospace',
                fontWeight: mapType === t.id ? 700 : 400,
                background: mapType === t.id ? '#00ff88' : 'transparent',
                color: mapType === t.id ? '#0a1a10' : '#00ff8899',
                transition: 'all 0.15s',
              }}>{t.label}</button>
            ))}
          </div>

          {/* Vendor layer toggles — right */}
          <div style={{
            display: 'flex', gap: 4, background: 'rgba(10,20,14,0.88)',
            border: '1px solid #ffffff18', borderRadius: 8,
            padding: '4px 6px', backdropFilter: 'blur(6px)',
            pointerEvents: 'all',
          }}>
            <span style={{ fontSize: 9, color: '#ffffff40', fontFamily: 'monospace', alignSelf: 'center', marginRight: 2 }}>CAPAS</span>
            {VENDOR_LAYERS.map(v => {
              const active = !!vendorLayers[v.id];
              const hasData = radiobases.some(rb => rb.sources[v.id as keyof typeof rb.sources] !== null);
              return (
                <button key={v.id} onClick={() => onVendorToggle?.(v.id)}
                  title={hasData ? `${active ? 'Ocultar' : 'Mostrar'} ${v.label}` : `${v.label} — sin datos`}
                  style={{
                    padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                    fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
                    border: `1px solid ${active ? v.color + '66' : '#ffffff15'}`,
                    background: active ? v.color + '22' : 'transparent',
                    color: active ? v.color : hasData ? '#ffffff55' : '#ffffff25',
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                  <span style={{ fontSize: 8 }}>{v.icon}</span>
                  {v.label}
                  {!hasData && <span style={{ fontSize: 8, opacity: 0.5 }}>–</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <style>{`
        #${containerId} .leaflet-tile-pane { filter: brightness(0.9) saturate(1.1); }
        #${containerId} .leaflet-control-zoom a {
          background:#0a1a10 !important; color:${G} !important;
          border-color:${G}30 !important; font-family:monospace !important;
        }
        .noc-tooltip .leaflet-tooltip { background:transparent !important; border:none !important; box-shadow:none !important; }
        @keyframes noc-pulse {
          0%,100% { box-shadow:0 0 20px #00ff8888; transform:scale(1); }
          50%      { box-shadow:0 0 35px #00ff88cc; transform:scale(1.15); }
        }
        @keyframes dash-flow {
          to { stroke-dashoffset: -30; }
        }
        @keyframes dot-move {
          0%   { opacity:0; }
          10%  { opacity:1; }
          90%  { opacity:1; }
          100% { opacity:0; }
        }
      `}</style>
    </>
  );
}

// ── Arc drawing ───────────────────────────────────────────────────────────────
function drawArcs(map: any, L: any, svg: SVGSVGElement, cities: NOCCity[], selectedCityId: string | null) {
  // Clear old arcs
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (cities.length < 2) return;

  const core = cities.find(c => c.name === 'Monterrey') || cities[0];

  cities.forEach(city => {
    if (city.id === core.id) return;

    const p1 = map.latLngToContainerPoint([core.lat, core.lng]);
    const p2 = map.latLngToContainerPoint([city.lat, city.lng]);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return;

    // Control point — arc curvature
    const mx  = (p1.x + p2.x) / 2 - dy * 0.25;
    const my  = (p1.y + p2.y) / 2 + dx * 0.25;
    const d   = `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`;
    const col = nodeColor(city.score);
    const isSelected = city.id === selectedCityId || city.id === core.id;

    // Base arc
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', col);
    path.setAttribute('stroke-width', isSelected ? '1.5' : '0.8');
    path.setAttribute('stroke-dasharray', '8 6');
    path.setAttribute('opacity', isSelected ? '0.6' : '0.2');
    path.style.animation = `dash-flow ${2 + Math.random()}s linear infinite`;
    svg.appendChild(path);

    // Animated dot — represents data packet traveling the link
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', isSelected ? '4' : '2.5');
    dot.setAttribute('fill', col);
    dot.setAttribute('opacity', '0');
    dot.style.filter = `drop-shadow(0 0 4px ${col})`;
    dot.style.animation = `dot-move ${3 + Math.random() * 2}s ease-in-out infinite`;

    const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
    anim.setAttribute('dur', `${3 + Math.random() * 3}s`);
    anim.setAttribute('repeatCount', 'indefinite');
    anim.setAttribute('path', d);
    dot.appendChild(anim);
    svg.appendChild(dot);
  });
}
