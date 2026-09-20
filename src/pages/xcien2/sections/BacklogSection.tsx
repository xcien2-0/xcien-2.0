import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '@/config';
import { ThemeConfig } from '../types';
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';

// ── Types ──────────────────────────────────────────────────────────────────
interface TicketDetail {
  id: number; name: string; cat: 'fallas' | 'hab';
  stage: string; tec: string; partner: string; age_days: number;
}
interface MuniOps {
  municipio: string; estado: string; total: number;
  fallas: number; hab: number; mediana: number;
  lat: number | null; lon: number | null;
  tickets: TicketDetail[];
}
interface TecData {
  tecnico: string; total: number; fallas: number;
  hab: number; mediana: number; plazas: string[];
}
interface BacklogOps {
  total: number; fallas: number; hab: number; mediana_dias: number;
  municipios: MuniOps[]; tecnicos: TecData[];
  updated_at: string; cached: boolean;
}
interface MuniCom {
  municipio: string; total: number; active: number;
  stages: Record<string, number>;
  lat: number | null; lon: number | null;
}
interface BacklogCom {
  total: number; total_active: number;
  municipios: MuniCom[];
  updated_at: string; cached: boolean;
}
interface Props { theme: ThemeConfig }

// ── Color helpers ──────────────────────────────────────────────────────────
function medColor(d: number): string {
  if (d > 90) return '#e84545';
  if (d > 30) return '#f0a050';
  return '#00c4b3';
}
const COM_STAGE_COLORS: Record<string, string> = {
  'Negociacion':'#a78bfa','Habilitacion':'#22d3ee','Contratacion':'#34d399',
  'Calificacion':'#94a3b8','Facturacion':'#fbbf24','Pre-Venta':'#60a5fa','Estudio':'#e879f9',
};
function stageColor(s: string): string { return COM_STAGE_COLORS[s] ?? '#64748b'; }
function activePctColor(pct: number): string {
  if (pct > 35) return '#34d399';
  if (pct > 15) return '#fbbf24';
  return '#a78bfa';
}

// ── Map ────────────────────────────────────────────────────────────────────
function opsBubbleSVG(total: number, fallas: number, hab: number, mediana: number): string {
  const r = Math.max(Math.sqrt(total) * 7, 14);
  const mc = medColor(mediana);
  const cx = r + 5, cy = r + 5, ro = r * 0.92, ri = r * 0.38;
  const size = (r + 5) * 2 + 2;
  let pie = '';
  if (fallas === 0) {
    pie = `<circle cx="${cx}" cy="${cy}" r="${ro}" fill="#f0a050"/>`;
  } else if (hab === 0) {
    pie = `<circle cx="${cx}" cy="${cy}" r="${ro}" fill="#00c4b3"/>`;
  } else {
    const ang = (fallas / total) * 2 * Math.PI;
    const x1 = cx + ro * Math.cos(-Math.PI/2), y1 = cy + ro * Math.sin(-Math.PI/2);
    const x2 = cx + ro * Math.cos(-Math.PI/2+ang), y2 = cy + ro * Math.sin(-Math.PI/2+ang);
    const lg = ang > Math.PI ? 1 : 0;
    pie = `<path d="M${cx},${cy} L${x1},${y1} A${ro},${ro} 0 ${lg},1 ${x2},${y2} Z" fill="#00c4b3"/>
           <path d="M${cx},${cy} L${x2},${y2} A${ro},${ro} 0 ${1-lg},1 ${x1},${y1} Z" fill="#f0a050"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${cx}" cy="${cy}" r="${r+4}" fill="none" stroke="${mc}" stroke-width="1.5" opacity="0.55"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0d1422"/>${pie}
    <circle cx="${cx}" cy="${cy}" r="${ri}" fill="#0d1422"/>
    <text x="${cx}" y="${cy+4}" text-anchor="middle"
      font-size="${Math.max(9,Math.min(13,Math.floor(r*0.6)))}"
      font-family="system-ui,sans-serif" font-weight="700" fill="#e2e8f0">${total}</text>
  </svg>`;
}

function comBubbleSVG(m: MuniCom): string {
  const r = Math.max(Math.sqrt(m.total) * 5.5, 13);
  const cx = r+5, cy = r+5, size = (r+5)*2+2;
  const pct = m.total>0 ? (m.active/m.total)*100 : 0;
  const ringCol = activePctColor(pct);
  const entries = Object.entries(m.stages);
  let pie = '';
  if (entries.length === 1) {
    pie = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${stageColor(entries[0][0])}" opacity="0.9"/>
           <circle cx="${cx}" cy="${cy}" r="${r*0.38}" fill="#0a0614"/>`;
  } else {
    let deg = -90;
    for (const [st, cnt] of entries) {
      const slice = (cnt/m.total)*360;
      const r1 = deg*Math.PI/180, r2 = (deg+slice)*Math.PI/180;
      const x1=cx+r*Math.cos(r1),y1=cy+r*Math.sin(r1),x2=cx+r*Math.cos(r2),y2=cy+r*Math.sin(r2);
      const xi1=cx+r*0.38*Math.cos(r2),yi1=cy+r*0.38*Math.sin(r2);
      const xi2=cx+r*0.38*Math.cos(r1),yi2=cy+r*0.38*Math.sin(r1);
      const lg = slice>180?1:0;
      pie += `<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${lg},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${xi1.toFixed(2)},${yi1.toFixed(2)} A${r*0.38},${r*0.38} 0 ${lg},0 ${xi2.toFixed(2)},${yi2.toFixed(2)} Z" fill="${stageColor(st)}" opacity="0.9"/>`;
      deg += slice;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${cx}" cy="${cy}" r="${r+4}" fill="none" stroke="${ringCol}" stroke-width="1.5" opacity="0.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(10,6,20,0.82)"/>${pie}
    <text x="${cx}" y="${cy+4}" text-anchor="middle"
      font-size="${Math.max(9,Math.min(13,Math.floor(r*0.6)))}"
      font-family="system-ui,sans-serif" font-weight="700" fill="white">${m.total}</text>
  </svg>`;
}

function BacklogMap({ mode, opsData, comData, selectedMuni, onSelectMuni }: {
  mode: 'ops'|'com'; opsData: MuniOps[]; comData: MuniCom[];
  selectedMuni: string|null; onSelectMuni: (name: string) => void;
}) {
  const mapRef  = useRef<HTMLDivElement>(null);
  const leafRef = useRef<L.Map|null>(null);
  const opLayer = useRef<L.LayerGroup|null>(null);
  const cmLayer = useRef<L.LayerGroup|null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!leafRef.current) {
      leafRef.current = L.map(mapRef.current, {
        center:[25.72,-100.31], zoom:10, zoomControl:true, attributionControl:false,
      });
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:17}).addTo(leafRef.current);
      L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:17,opacity:0.7}).addTo(leafRef.current);
    }
    if (opLayer.current) opLayer.current.remove();
    opLayer.current = L.layerGroup();
    opsData.filter(m=>m.lat&&m.lon).forEach(m => {
      const isSelected = m.municipio === selectedMuni;
      const svg = opsBubbleSVG(m.total, m.fallas, m.hab, m.mediana);
      const r = Math.max(Math.sqrt(m.total)*7,14), sz=(r+5)*2+2;
      const icon = L.divIcon({
        html: isSelected ? `<div style="filter:drop-shadow(0 0 6px #00c4b3)">${svg}</div>` : svg,
        className:'', iconSize:[sz,sz], iconAnchor:[sz/2,sz/2],
      });
      L.marker([m.lat!,m.lon!],{icon})
        .on('click',()=>onSelectMuni(m.municipio))
        .bindTooltip(m.municipio,{direction:'top',permanent:false})
        .addTo(opLayer.current!);
    });

    if (cmLayer.current) cmLayer.current.remove();
    cmLayer.current = L.layerGroup();
    comData.filter(m=>m.lat&&m.lon).forEach(m => {
      const svg = comBubbleSVG(m);
      const r=Math.max(Math.sqrt(m.total)*5.5,13), sz=(r+5)*2+2;
      const icon = L.divIcon({html:svg,className:'',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});
      const stages = Object.entries(m.stages).map(([k,v])=>`<span style="color:${stageColor(k)}">● ${k}: ${v}</span>`).join('<br/>');
      const pct = m.total>0?Math.round(m.active/m.total*100):0;
      L.marker([m.lat!,m.lon!],{icon})
        .bindPopup(`<b>${m.municipio}</b><br/><b style="color:#a78bfa">${m.total}</b> leads · activo <b style="color:${activePctColor(pct)}">${pct}%</b><br/><small>${stages}</small>`,
          {className:'blg-popup',maxWidth:230})
        .addTo(cmLayer.current!);
    });

    if (mode==='ops') { cmLayer.current.remove(); opLayer.current.addTo(leafRef.current!); }
    else              { opLayer.current.remove(); cmLayer.current.addTo(leafRef.current!); }
  }, [opsData, comData, mode, selectedMuni, onSelectMuni]);

  useEffect(()=>()=>{leafRef.current?.remove();leafRef.current=null;},[]);

  return (
    <>
      <style>{`.blg-popup .leaflet-popup-content-wrapper{background:#0d1422;color:#e2e8f0;border:1px solid #1e2d3d;border-radius:8px;font-size:12px;line-height:1.6}.blg-popup .leaflet-popup-tip{background:#0d1422}`}</style>
      <div ref={mapRef} style={{width:'100%',height:340,borderRadius:10,border:'1px solid rgba(255,255,255,0.07)',overflow:'hidden',cursor:'pointer'}}/>
      {mode==='ops' && <div style={{fontSize:11,color:'#64748b',marginTop:4,textAlign:'center'}}>Clic en un municipio para ver sus tickets</div>}
    </>
  );
}

// ── Ticket detail panel ────────────────────────────────────────────────────
function TicketPanel({ muni, onClose, theme }: { muni: MuniOps; onClose: ()=>void; theme: ThemeConfig }) {
  const [filter, setFilter] = useState<'all'|'fallas'|'hab'>('all');
  const tickets = muni.tickets.filter(t => filter==='all' || t.cat===filter);
  const T = { text:theme.text, dim:theme.dim, border:theme.border, acc:theme.accent };

  return (
    <div style={{
      background:'#0d1422', border:'1px solid #1e2d3d', borderRadius:12,
      overflow:'hidden', animation:'slideIn 0.15s ease',
    }}>
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {/* Panel header */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 16px', background:'#0e1825', borderBottom:'1px solid #1e2d3d',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:3,height:28,background:'#00c4b3',borderRadius:2}}/>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.text}}>{muni.municipio}</div>
            <div style={{fontSize:11,color:T.dim}}>{muni.total} tickets activos · mediana {muni.mediana}d</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {/* Filter chips */}
          {(['all','fallas','hab'] as const).map(f => (
            <button key={f} onClick={()=>setFilter(f)} style={{
              padding:'4px 12px', borderRadius:20, border:'none', cursor:'pointer',
              fontSize:11, fontWeight:600,
              background: filter===f
                ? f==='fallas'?'rgba(0,196,179,.2)':f==='hab'?'rgba(240,160,80,.2)':'rgba(255,255,255,.1)'
                : 'transparent',
              color: filter===f
                ? f==='fallas'?'#00c4b3':f==='hab'?'#f0a050':'#e2e8f0'
                : T.dim,
            }}>
              {f==='all'?`Todos (${muni.total})`:f==='fallas'?`Fallas (${muni.fallas})`:`Hab. (${muni.hab})`}
            </button>
          ))}
          <button onClick={onClose} style={{
            width:28,height:28,borderRadius:'50%',border:'1px solid #1e2d3d',
            background:'rgba(255,255,255,.05)',color:T.dim,cursor:'pointer',fontSize:16,
            display:'flex',alignItems:'center',justifyContent:'center',
          }}>×</button>
        </div>
      </div>

      {/* Ticket list */}
      <div style={{maxHeight:280,overflowY:'auto'}}>
        {tickets.length===0 && (
          <div style={{padding:'24px',textAlign:'center',color:T.dim,fontSize:13}}>Sin tickets en este filtro</div>
        )}
        {tickets.map((t,i) => {
          const ageCol = medColor(t.age_days);
          const catCol = t.cat==='fallas'?'#00c4b3':'#f0a050';
          return (
            <div key={t.id} style={{
              display:'grid',
              gridTemplateColumns:'44px 1fr auto auto',
              gap:'0 12px',
              padding:'10px 16px',
              alignItems:'center',
              background: i%2===0?'transparent':'rgba(255,255,255,.02)',
              borderBottom:'1px solid #1e2d3d',
            }}>
              {/* ID */}
              <div style={{
                fontFamily:'monospace',fontSize:11,fontWeight:700,
                color:catCol,background:`${catCol}18`,
                borderRadius:5,padding:'2px 5px',textAlign:'center',
              }}>#{t.id}</div>

              {/* Nombre + cliente */}
              <div>
                <div style={{fontSize:13,fontWeight:600,color:T.text,lineHeight:1.3}}>{t.name||'(sin título)'}</div>
                <div style={{fontSize:11,color:T.dim,marginTop:1}}>{t.partner} · {t.tec}</div>
              </div>

              {/* Stage */}
              <div style={{
                fontSize:11,fontWeight:600,
                color: t.stage.toLowerCase().includes('visita')||t.stage.toLowerCase().includes('cast')?'#60a5fa'
                  : t.stage.toLowerCase().includes('reincid')?'#f87171'
                  : t.stage.toLowerCase().includes('monitor')?'#fbbf24'
                  : T.dim,
                whiteSpace:'nowrap',
              }}>{t.stage}</div>

              {/* Edad */}
              <div style={{
                fontFamily:'monospace',fontSize:12,fontWeight:700,
                color:ageCol,whiteSpace:'nowrap',minWidth:38,textAlign:'right',
              }}>{t.age_days}d</div>
            </div>
          );
        })}
      </div>

      {/* Footer summary */}
      <div style={{
        display:'flex',gap:16,padding:'8px 16px',
        background:'#0e1825',borderTop:'1px solid #1e2d3d',
        fontSize:11,color:T.dim,
      }}>
        <span style={{color:'#00c4b3'}}><b>{muni.fallas}</b> fallas</span>
        <span style={{color:'#f0a050'}}><b>{muni.hab}</b> hab</span>
        <span>Mediana: <b style={{color:medColor(muni.mediana)}}>{muni.mediana}d</b></span>
        <span style={{marginLeft:'auto'}}>Mayor antigüedad: <b style={{color:medColor(tickets[0]?.age_days??0)}}>{tickets[0]?.age_days??0}d</b></span>
      </div>
    </div>
  );
}

// ── KPI card ───────────────────────────────────────────────────────────────
function KPI({ label, value, sub, color }: { label:string;value:string|number;sub?:string;color?:string }) {
  return (
    <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:10,padding:'14px 18px',flex:1,minWidth:110}}>
      <div style={{fontSize:26,fontWeight:800,color:color??'#e2e8f0',lineHeight:1}}>{value}</div>
      <div style={{fontSize:11,color:'#64748b',marginTop:4}}>{label}</div>
      {sub && <div style={{fontSize:10,color:'#475569',marginTop:2}}>{sub}</div>}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function BacklogSection({ theme }: Props) {
  const [opsData,  setOpsData]  = useState<BacklogOps|null>(null);
  const [comData,  setComData]  = useState<BacklogCom|null>(null);
  const [layer,    setLayer]    = useState<'ops'|'com'>('ops');
  const [tab,      setTab]      = useState<'municipios'|'tecnicos'>('municipios');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [refresh,  setRefresh]  = useState(false);
  const [selected, setSelected] = useState<string|null>(null);

  const load = useCallback(async (force=false) => {
    try {
      setError('');
      const [r1,r2] = await Promise.all([
        fetch(`${API_BASE}/api/backlog/ops${force?'?force=true':''}`),
        fetch(`${API_BASE}/api/backlog/comercial${force?'?force=true':''}`),
      ]);
      if (!r1.ok) throw new Error(`Operativo HTTP ${r1.status}`);
      const [d1,d2] = await Promise.all([r1.json(), r2.ok?r2.json():null]);
      setOpsData(d1);
      if (d2) setComData(d2);
    } catch(e:any) { setError(e.message??'Error'); }
    finally { setLoading(false); setRefresh(false); }
  },[]);

  useEffect(()=>{load();},[load]);

  const T = {bg:theme.bg,surf:theme.card,border:theme.border,text:theme.text,dim:theme.dim,acc:theme.accent};

  if (loading) return (
    <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:10,color:T.dim,fontSize:13}}>
      <div style={{width:14,height:14,border:`2px solid ${T.acc}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
      Cargando backlog desde Odoo…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if (error||!opsData) return (
    <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12,color:'#e84545'}}>
      <div style={{fontSize:32}}>⚠️</div>
      <div style={{fontWeight:700}}>Error cargando backlog</div>
      <div style={{fontSize:12,color:T.dim}}>{error}</div>
      <button onClick={()=>load()} style={{padding:'8px 20px',borderRadius:8,background:T.acc,color:'#000',border:'none',fontWeight:700,cursor:'pointer'}}>Reintentar</button>
    </div>
  );

  const maxTotal = Math.max(...opsData.municipios.map(m=>m.total),1);
  const maxTec   = Math.max(...opsData.tecnicos.map(t=>t.total),1);
  const opsH     = Math.round((Date.now()-new Date(opsData.updated_at).getTime())/3_600_000);
  const opsLbl   = opsH<1?'< 1h':opsH<24?`${opsH}h`:`${Math.floor(opsH/24)}d`;
  const isComActive = layer==='com' && !!comData;

  const selectedMuniData = selected ? opsData.municipios.find(m=>m.municipio===selected) : null;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16,maxWidth:960}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:T.text,margin:0}}>
            {isComActive?'Backlog Comercial':'Backlog Operativo'}
          </h2>
          <div style={{fontSize:12,color:T.dim,marginTop:3}}>
            {isComActive
              ? `Pipeline CRM activo NL · ${comData?.total??0} leads · Odoo wispi19`
              : `Fallas + Habilitaciones activas · Odoo wispi19`}
            {(isComActive?comData?.cached:opsData.cached) && (
              <span style={{marginLeft:8,color:'#f0a050'}}>· caché ({opsLbl})</span>
            )}
          </div>
        </div>
        <div style={{display:'flex',gap:6}}>
          <div style={{display:'flex',background:'rgba(255,255,255,0.04)',border:`1px solid ${T.border}`,borderRadius:8,padding:3,gap:3}}>
            <button onClick={()=>{setLayer('ops');setSelected(null);}} style={{
              padding:'5px 14px',borderRadius:5,border:'none',cursor:'pointer',fontSize:11,fontWeight:700,
              background:layer==='ops'?'rgba(0,196,179,.18)':'transparent',
              color:layer==='ops'?'#00c4b3':T.dim,
            }}>⚙ Operativo</button>
            <button onClick={()=>setLayer('com')} style={{
              padding:'5px 14px',borderRadius:5,border:'none',cursor:'pointer',fontSize:11,fontWeight:700,
              background:layer==='com'?'rgba(167,139,250,.2)':'transparent',
              color:layer==='com'?'#a78bfa':T.dim,
            }}>💼 Comercial{!comData&&' (cargando…)'}</button>
          </div>
          <button onClick={()=>{setRefresh(true);load(true);}} disabled={refresh} style={{
            padding:'7px 14px',borderRadius:8,border:`1px solid ${T.border}`,
            background:'rgba(255,255,255,0.04)',color:T.dim,cursor:'pointer',fontSize:12,
            display:'flex',alignItems:'center',gap:6,
          }}>
            {refresh?<span style={{display:'inline-block',width:11,height:11,border:`2px solid ${T.acc}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>:'↻'} Actualizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        {isComActive ? (
          <>
            <KPI label="leads totales NL" value={comData!.total} color="#a78bfa"/>
            <KPI label="pipeline activo" value={comData!.total_active} color="#34d399"/>
            <KPI label="% activo" value={`${comData!.total>0?Math.round(comData!.total_active/comData!.total*100):0}%`}
              color={activePctColor(comData!.total>0?comData!.total_active/comData!.total*100:0)} sub="Hab+Cont+Calif+Fact"/>
            <KPI label="municipios" value={comData!.municipios.length}/>
          </>
        ) : (
          <>
            <KPI label="tickets activos" value={opsData.total}/>
            <KPI label="fallas" value={opsData.fallas} color="#00c4b3"/>
            <KPI label="habilitaciones" value={opsData.hab} color="#f0a050"/>
            <KPI label="mediana días" value={`${opsData.mediana_dias}d`} color={medColor(opsData.mediana_dias)}
              sub={opsData.mediana_dias>90?'crítico':opsData.mediana_dias>30?'atención':'ok'}/>
          </>
        )}
      </div>

      {/* Mapa */}
      <BacklogMap mode={layer} opsData={opsData.municipios} comData={comData?.municipios??[]}
        selectedMuni={selected} onSelectMuni={n => setSelected(n===selected?null:n)}/>

      {/* Panel detalle municipio (operativo) */}
      {!isComActive && selectedMuniData && (
        <TicketPanel muni={selectedMuniData} onClose={()=>setSelected(null)} theme={theme}/>
      )}

      {/* Leyenda */}
      {isComActive ? (
        <div style={{display:'flex',gap:14,fontSize:11,color:T.dim,flexWrap:'wrap'}}>
          {Object.entries(COM_STAGE_COLORS).map(([s,c])=>(
            <span key={s} style={{display:'flex',alignItems:'center',gap:5}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:c,display:'inline-block'}}/>
              {s}
            </span>
          ))}
        </div>
      ) : (
        <div style={{display:'flex',gap:16,fontSize:11,color:T.dim}}>
          {[['#00c4b3','< 30d OK'],['#f0a050','30–90d atención'],['#e84545','> 90d crítico']].map(([c,l])=>(
            <span key={l} style={{display:'flex',alignItems:'center',gap:5}}>
              <span style={{width:8,height:8,borderRadius:2,background:c,display:'inline-block'}}/>{l}
            </span>
          ))}
        </div>
      )}

      {/* Tabs — Operativo */}
      {!isComActive && (
        <>
          <div style={{display:'flex',gap:4,borderBottom:`1px solid ${T.border}`}}>
            {(['municipios','tecnicos'] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{
                padding:'7px 18px',background:'none',border:'none',cursor:'pointer',
                fontSize:13,fontWeight:tab===t?700:400,
                color:tab===t?T.acc:T.dim,
                borderBottom:tab===t?`2px solid ${T.acc}`:'2px solid transparent',marginBottom:-1,
              }}>
                {t==='municipios'?'Por municipio':'Por técnico'}
              </button>
            ))}
          </div>

          {tab==='municipios' && (
            <div style={{borderRadius:10,border:`1px solid ${T.border}`,overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:'2fr 60px 60px 60px 80px 2fr',
                padding:'8px 16px',background:'rgba(255,255,255,0.04)',
                fontSize:11,fontWeight:700,color:T.dim,letterSpacing:'0.05em',textTransform:'uppercase'}}>
                <span>Municipio</span>
                <span style={{textAlign:'right'}}>Total</span>
                <span style={{textAlign:'right'}}>Fallas</span>
                <span style={{textAlign:'right'}}>Hab</span>
                <span style={{textAlign:'right'}}>Mediana</span>
                <span style={{paddingLeft:12}}>Distribución</span>
              </div>
              {opsData.municipios.map((m,i)=>(
                <div key={m.municipio}>
                  {/* Row — clickable */}
                  <div onClick={()=>setSelected(m.municipio===selected?null:m.municipio)}
                    style={{
                      display:'grid',gridTemplateColumns:'2fr 60px 60px 60px 80px 2fr',
                      padding:'10px 16px',alignItems:'center',cursor:'pointer',
                      background: m.municipio===selected
                        ? 'rgba(0,196,179,0.07)'
                        : i%2===0?'transparent':'rgba(255,255,255,0.02)',
                      borderTop:`1px solid ${T.border}`,
                      borderLeft: m.municipio===selected?'2px solid #00c4b3':'2px solid transparent',
                      transition:'background 0.15s',
                    }}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:10,color:T.dim,transition:'transform 0.15s',
                        transform:m.municipio===selected?'rotate(90deg)':'rotate(0deg)'}}>▶</span>
                      <span style={{fontSize:13,fontWeight:600,color:T.text}}>{m.municipio}</span>
                      <span style={{fontSize:10,color:T.dim}}>{m.estado}</span>
                    </div>
                    <div style={{textAlign:'right',fontWeight:700,color:T.text,fontSize:14,fontVariantNumeric:'tabular-nums'}}>{m.total}</div>
                    <div style={{textAlign:'right',color:'#00c4b3',fontSize:13,fontVariantNumeric:'tabular-nums'}}>{m.fallas}</div>
                    <div style={{textAlign:'right',color:'#f0a050',fontSize:13,fontVariantNumeric:'tabular-nums'}}>{m.hab}</div>
                    <div style={{textAlign:'right',fontSize:13,fontWeight:700,color:medColor(m.mediana),fontVariantNumeric:'tabular-nums'}}>{m.mediana}d</div>
                    <div style={{paddingLeft:12,display:'flex',alignItems:'center',gap:3}}>
                      {m.total>0&&(<>
                        <div style={{height:8,borderRadius:2,background:'#00c4b3',width:`${(m.fallas/maxTotal)*130}px`,minWidth:m.fallas>0?3:0,transition:'width 0.4s'}}/>
                        <div style={{height:8,borderRadius:2,background:'#f0a050',width:`${(m.hab/maxTotal)*130}px`,minWidth:m.hab>0?3:0,transition:'width 0.4s'}}/>
                      </>)}
                    </div>
                  </div>
                  {/* Inline ticket panel */}
                  {m.municipio===selected && (
                    <div style={{padding:'0 16px 12px',background:'rgba(0,196,179,0.04)',borderBottom:`1px solid ${T.border}`}}>
                      <TicketPanel muni={m} onClose={()=>setSelected(null)} theme={theme}/>
                    </div>
                  )}
                </div>
              ))}
              {opsData.municipios.length===0&&(
                <div style={{padding:'24px',textAlign:'center',color:T.dim,fontSize:13}}>Sin tickets activos</div>
              )}
            </div>
          )}

          {tab==='tecnicos' && (
            <div style={{borderRadius:10,border:`1px solid ${T.border}`,overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:'2fr 60px 60px 60px 80px 1fr 2fr',
                padding:'8px 16px',background:'rgba(255,255,255,0.04)',
                fontSize:11,fontWeight:700,color:T.dim,letterSpacing:'0.05em',textTransform:'uppercase'}}>
                <span>Técnico</span><span style={{textAlign:'right'}}>Total</span>
                <span style={{textAlign:'right'}}>Fallas</span><span style={{textAlign:'right'}}>Hab</span>
                <span style={{textAlign:'right'}}>Mediana</span><span style={{paddingLeft:8}}>Plazas</span>
                <span style={{paddingLeft:12}}>Carga</span>
              </div>
              {opsData.tecnicos.map((t,i)=>(
                <div key={t.tecnico} style={{
                  display:'grid',gridTemplateColumns:'2fr 60px 60px 60px 80px 1fr 2fr',
                  padding:'10px 16px',alignItems:'center',
                  background:i%2===0?'transparent':'rgba(255,255,255,0.02)',
                  borderTop:`1px solid ${T.border}`,
                }}>
                  <div style={{fontSize:13,fontWeight:t.tecnico==='Sin asignar'?400:600,color:t.tecnico==='Sin asignar'?T.dim:T.text}}>{t.tecnico}</div>
                  <div style={{textAlign:'right',fontWeight:700,color:T.text,fontSize:14,fontVariantNumeric:'tabular-nums'}}>{t.total}</div>
                  <div style={{textAlign:'right',color:'#00c4b3',fontSize:13,fontVariantNumeric:'tabular-nums'}}>{t.fallas}</div>
                  <div style={{textAlign:'right',color:'#f0a050',fontSize:13,fontVariantNumeric:'tabular-nums'}}>{t.hab}</div>
                  <div style={{textAlign:'right',fontSize:13,fontWeight:700,color:medColor(t.mediana),fontVariantNumeric:'tabular-nums'}}>{t.mediana}d</div>
                  <div style={{paddingLeft:8,fontSize:10,color:T.dim}}>{t.plazas.join(' · ')||'—'}</div>
                  <div style={{paddingLeft:12}}>
                    <div style={{height:5,borderRadius:3,background:'rgba(255,255,255,0.06)',overflow:'hidden'}}>
                      <div style={{width:`${Math.min(100,(t.total/maxTec)*100)}%`,height:'100%',background:medColor(t.mediana),transition:'width 0.4s'}}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tabla municipios — Comercial */}
      {isComActive && (
        <div style={{borderRadius:10,border:`1px solid ${T.border}`,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 60px 60px 80px 3fr',
            padding:'8px 16px',background:'rgba(255,255,255,0.04)',
            fontSize:11,fontWeight:700,color:T.dim,letterSpacing:'0.05em',textTransform:'uppercase'}}>
            <span>Municipio</span>
            <span style={{textAlign:'right'}}>Leads</span>
            <span style={{textAlign:'right'}}>Activo</span>
            <span style={{textAlign:'right'}}>%</span>
            <span style={{paddingLeft:12}}>Pipeline</span>
          </div>
          {comData!.municipios.map((m,i)=>{
            const pct=m.total>0?Math.round(m.active/m.total*100):0;
            return (
              <div key={m.municipio} style={{
                display:'grid',gridTemplateColumns:'2fr 60px 60px 80px 3fr',
                padding:'10px 16px',alignItems:'center',
                background:i%2===0?'transparent':'rgba(255,255,255,0.02)',
                borderTop:`1px solid ${T.border}`,
              }}>
                <div style={{fontSize:13,fontWeight:600,color:T.text}}>{m.municipio}</div>
                <div style={{textAlign:'right',fontWeight:700,color:'#a78bfa',fontSize:14,fontVariantNumeric:'tabular-nums'}}>{m.total}</div>
                <div style={{textAlign:'right',color:'#34d399',fontSize:13,fontVariantNumeric:'tabular-nums'}}>{m.active}</div>
                <div style={{textAlign:'right',fontSize:13,fontWeight:700,color:activePctColor(pct),fontVariantNumeric:'tabular-nums'}}>{pct}%</div>
                <div style={{paddingLeft:12,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                  {Object.entries(m.stages).map(([s,n])=>(
                    <span key={s} style={{fontSize:10,color:stageColor(s),whiteSpace:'nowrap'}}>{s.slice(0,4)} {n}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
