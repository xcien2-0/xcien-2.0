/**
 * OrgTreeView.tsx — Vista árbol estilo The Brain
 * Grafo D3 navegable. La navegación es 100% imperativa dentro de D3
 * para evitar re-renders de React que destruyen el SVG.
 */

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { API_BASE } from '../../../config';
import brand from '../../../brand';

interface Empleado {
  id: number;
  name: string;
  job_title: string;
  department: string;
  company: string;
  email: string;
  phone: string;
  manager: string | null;
}

interface EmpDetail {
  id: number;
  name: string;
  job_title: string;
  department: string;
  company: string;
  email: string;
  phone: string;
  manager: string | null;
  location: string;
  schedule: string;
  avatar: string | null;
  subordinates_count: number;
  birthday: string | null;
  gender: string | null;
  marital: string | null;
  study_field: string | null;
  study_school: string | null;
}

interface Props {
  empleados: Empleado[];
  theme: {
    accent: string; bg: string; card: string; border: string;
    text: string; dim: string; radius: number;
  };
}

type NodeType = 'root' | 'company' | 'department' | 'employee';

interface GNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  sublabel: string;
  type: NodeType;
  color: string;
  r: number;
  data?: Empleado;
}

interface GLink extends d3.SimulationLinkDatum<GNode> {
  source: string | GNode;
  target: string | GNode;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CO_COLOR: Record<string, string> = {
  'ADMINISTRADORA DE SERVICIOS DE INTERNET SANDUR': '#8B5CF6',
  'ADMINISTRADORA DE SERVICIOS INTERNET SANDUR':    '#8B5CF6',
  'MATERIALES ASESORIAS Y SERVICIOS':               '#F97316',
  'SENEL':                                          '#EC4899',
};

const CO_SHORT: Record<string, string> = {
  'ADMINISTRADORA DE SERVICIOS DE INTERNET SANDUR': 'SANDUR',
  'ADMINISTRADORA DE SERVICIOS INTERNET SANDUR':    'SANDUR',
  'MATERIALES ASESORIAS Y SERVICIOS':               'MAS',
  'SENEL':                                          'SENEL',
};

function coColor(c: string) { return CO_COLOR[c] || '#888'; }
function coShort(c: string) { return CO_SHORT[c] || c.split(' ')[0]; }
function shortDept(d: string) { return d.split('/').pop()!.trim(); }
function shortName(n: string) { const p = n.trim().split(/\s+/); return p.length <= 2 ? n : `${p[0]} ${p[1]}`; }
function initials(n: string) { return n.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(); }

// ── Build nodes & links from current focus ────────────────────────────────────

function buildGraph(
  empleados: Empleado[],
  focusId: string,
  posCache: Record<string, {x:number;y:number}>,
  W: number,
  H: number,
): { nodes: GNode[]; links: GLink[] } {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const seen = new Set<string>();

  const add = (n: GNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    const cached = posCache[n.id];
    if (cached) { n.x = cached.x; n.y = cached.y; }
    nodes.push(n);
  };

  // group employees
  const structure: Record<string, Record<string, Empleado[]>> = {};
  for (const e of empleados) {
    const co   = e.company || 'Sin empresa';
    const dept = shortDept(e.department || 'Sin departamento');
    if (!structure[co])      structure[co] = {};
    if (!structure[co][dept]) structure[co][dept] = [];
    structure[co][dept].push(e);
  }

  // root
  add({ id:'root', label:brand.orgName, sublabel:'Grupo Empresarial', type:'root', color:brand.accentColor, r:36, x:W/2, y:H/2 });

  for (const [co, depts] of Object.entries(structure)) {
    const coId    = `co::${co}`;
    const color   = coColor(co);
    const total   = Object.values(depts).reduce((a,b)=>a+b.length,0);
    const empInCo = empleados.some(e=>`emp::${e.id}`===focusId && e.company===co);
    const deptInCo= Object.keys(depts).some(d=>`dept::${co}::${d}`===focusId);

    const showCo = focusId==='root' || focusId===coId || deptInCo || empInCo;
    if (!showCo) continue;

    add({ id:coId, label:coShort(co), sublabel:`${total} personas`, type:'company', color, r:28 });
    links.push({ source:'root', target:coId });

    for (const [dept, emps] of Object.entries(depts)) {
      const deptId = `dept::${co}::${dept}`;
      const empInDept = emps.some(e=>`emp::${e.id}`===focusId);

      const showDept = focusId==='root' || focusId===coId || focusId===deptId || empInDept;
      if (!showDept) continue;

      add({ id:deptId, label:dept, sublabel:`${emps.length} personas`, type:'department', color, r:20 });
      links.push({ source:coId, target:deptId });

      const showEmps = focusId===deptId || empInDept;
      if (showEmps) {
        for (const emp of emps) {
          const empId = `emp::${emp.id}`;
          add({ id:empId, label:shortName(emp.name), sublabel:emp.job_title||'', type:'employee', color, r:14, data:emp });
          links.push({ source:deptId, target:empId });
        }
      }
    }
  }

  return { nodes, links };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrgTreeView({ empleados, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedEmp, setSelectedEmp] = useState<Empleado | null>(null);
  const [empDetail, setEmpDetail]     = useState<EmpDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoZoom,   setPhotoZoom]   = useState(false);
  const [searchQ,     setSearchQ]     = useState('');
  const [searchRes,   setSearchRes]   = useState<Empleado[]>([]);
  const [crumbs, setCrumbs] = useState([{id:'root',label:brand.name}]);
  const { accent, bg, card, border, text, dim } = theme;

  // All mutable D3 state lives in refs — never causes re-renders
  const stateRef = useRef({
    focusId:  'root',
    posCache: {} as Record<string,{x:number;y:number}>,
    sim:      null as d3.Simulation<GNode,GLink>|null,
    svg:      null as d3.Selection<SVGSVGElement,unknown,null,undefined>|null,
    g:        null as d3.Selection<SVGGElement,unknown,null,undefined>|null,
    linkSel:  null as d3.Selection<SVGLineElement,GLink,SVGGElement,unknown>|null,
    nodeSel:  null as d3.Selection<SVGGElement,GNode,SVGGElement,unknown>|null,
    W: 900, H: 600,
  });

  // Called imperatively — no React state change, no re-render
  const expand = (nodeId: string, label: string) => {
    const s = stateRef.current;
    if (!s.svg || !s.g) return;

    // Save current positions
    if (s.sim) {
      s.sim.nodes().forEach(n => {
        if (n.x!=null && n.y!=null) s.posCache[n.id] = {x:n.x, y:n.y};
      });
      s.sim.stop();
    }

    s.focusId = nodeId;

    // Update breadcrumb via React (display only — doesn't affect D3)
    setCrumbs(prev => {
      const idx = prev.findIndex(b => b.id === nodeId);
      if (idx >= 0) return prev.slice(0, idx + 1);
      return [...prev, { id: nodeId, label }];
    });

    const { nodes, links } = buildGraph(empleados, nodeId, s.posCache, s.W, s.H);

    // Fix root
    const root = nodes.find(n=>n.id==='root');
    if (root) { root.fx = s.W/2; root.fy = s.H/2; }

    // Restart simulation with new data
    const sim = d3.forceSimulation<GNode>(nodes)
      .alpha(0.5).alphaDecay(0.025)
      .force('link', d3.forceLink<GNode,GLink>(links).id(d=>d.id)
        .distance(d => {
          const t = d.target as GNode;
          return t.type==='company' ? 160 : t.type==='department' ? 120 : 75;
        }).strength(0.5))
      .force('charge', d3.forceManyBody().strength(d =>
        d.type==='root'?-800 : d.type==='company'?-480 : d.type==='department'?-260 : -90))
      .force('center', d3.forceCenter(s.W/2, s.H/2).strength(0.04))
      .force('collision', d3.forceCollide<GNode>(d=>d.r+14));

    s.sim = sim;

    // Rebuild visual elements in place
    redraw(s.g!, sim, nodes, links, s.W, s.H);

    sim.on('tick', () => tick(s.g!));
    sim.on('end', () => {
      sim.nodes().forEach(n => { if (n.x!=null && n.y!=null) s.posCache[n.id]={x:n.x,y:n.y}; });
    });
  };

  // ── Open employee detail panel ────────────────────────────────────────────
  const openDetail = (emp: Empleado) => {
    setSelectedEmp(emp);
    setEmpDetail(null);
    setDetailLoading(true);
    setPhotoFailed(false);
    setPhotoZoom(false);
    fetch(`${API_BASE}/api/rrhh/empleado/${emp.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setEmpDetail(d); setDetailLoading(false); })
      .catch(() => setDetailLoading(false));
  };

  // ── Initial mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || empleados.length === 0) return;

    const s = stateRef.current;
    s.W = containerRef.current.clientWidth  || 900;
    s.H = containerRef.current.clientHeight || 600;

    // Clear old svg if any
    d3.select(containerRef.current).select('svg').remove();

    const svg = d3.select(containerRef.current)
      .append('svg')
      .attr('width','100%').attr('height','100%')
      .style('cursor','grab');

    s.svg = svg as any;

    // Defs
    const defs = svg.append('defs');
    const f = defs.append('filter').attr('id','glow-tree');
    f.append('feGaussianBlur').attr('stdDeviation','3').attr('result','blur');
    const fm = f.append('feMerge');
    fm.append('feMergeNode').attr('in','blur');
    fm.append('feMergeNode').attr('in','SourceGraphic');

    // Grid dots background
    defs.append('pattern').attr('id','grid-dots').attr('x',0).attr('y',0)
      .attr('width',28).attr('height',28).attr('patternUnits','userSpaceOnUse')
      .append('circle').attr('cx',1).attr('cy',1).attr('r',0.8)
      .attr('fill', dim + '25');
    svg.append('rect').attr('width','100%').attr('height','100%').attr('fill','url(#grid-dots)');

    const g = svg.append('g');
    s.g = g as any;

    // Zoom
    const zoom = d3.zoom<SVGSVGElement,unknown>()
      .scaleExtent([0.15,4])
      .on('zoom', e => (g as any).attr('transform', e.transform.toString()));
    (svg as any).call(zoom);

    // Click on background closes detail panel
    svg.on('click', () => { setSelectedEmp(null); setEmpDetail(null); setPhotoFailed(false); setPhotoZoom(false); });

    // Initial draw
    expand('root', brand.name);

  }, [empleados]); // only when data loads — never on click

  // ── Redraw (called imperatively) ───────────────────────────────────────────

  function redraw(
    g: d3.Selection<SVGGElement,unknown,null,undefined>,
    sim: d3.Simulation<GNode,GLink>,
    nodes: GNode[],
    links: GLink[],
    W: number, H: number,
  ) {
    g.selectAll('*').remove();

    // Links layer
    const linkG = g.append('g');
    const linkSel = linkG.selectAll<SVGLineElement,GLink>('line')
      .data(links).join('line')
      .attr('stroke', d => ((d.target as GNode).color || accent) + '50')
      .attr('stroke-width', d => {
        const t = d.target as GNode;
        return t.type==='company'?2.5 : t.type==='department'?1.8 : 1;
      });

    // Nodes layer
    const nodeG = g.append('g');
    const nodeSel = nodeG.selectAll<SVGGElement,GNode>('g')
      .data(nodes, d=>d.id).join('g')
      .attr('cursor', d => d.type==='employee' ? 'pointer' : 'pointer')
      .call(
        d3.drag<SVGGElement,GNode>()
          .on('start', (e,d) => { if(!e.active) sim.alphaTarget(0.2).restart(); d.fx=d.x; d.fy=d.y; })
          .on('drag',  (e,d) => { d.fx=e.x; d.fy=e.y; })
          .on('end',   (e,d) => { if(!e.active) sim.alphaTarget(0); if(d.type!=='root'){d.fx=null;d.fy=null;} })
      )
      .on('click', (event, d) => {
        event.stopPropagation();
        if (d.type === 'employee' && d.data) {
          event.stopPropagation();
          openDetail(d.data);
        } else if (d.type !== 'employee') {
          setSelectedEmp(null);
          setEmpDetail(null);
          expand(d.id, d.label);
        }
      })
      .on('mouseover', function(_,d) { d3.select(this).select('circle').attr('filter','url(#glow-tree)'); })
      .on('mouseout',  function()    { d3.select(this).select('circle').attr('filter',null); });

    // Pulse ring for root
    nodeSel.filter(d=>d.type==='root')
      .append('circle').attr('r', d=>d.r+12)
      .attr('fill','none').attr('stroke', d=>d.color)
      .attr('stroke-opacity',0.15).attr('stroke-width',10);

    // Main circle
    nodeSel.append('circle').attr('r', d=>d.r)
      .attr('fill', d => d.type==='root' ? d.color : `${d.color}18`)
      .attr('stroke', d=>d.color)
      .attr('stroke-width', d => d.type==='root'?0 : d.type==='company'?2.5 : d.type==='department'?2 : 1.2)
      .attr('stroke-opacity', d => d.type==='employee' ? 0.5 : 0.9);

    // Icon / initials
    nodeSel.filter(d=>d.type!=='employee').append('text')
      .text(d => d.type==='root'?'🏢' : d.type==='company'?'🏛':'📁')
      .attr('text-anchor','middle').attr('dominant-baseline','central')
      .attr('font-size', d=>d.type==='root'?18 : d.type==='company'?14:10)
      .attr('pointer-events','none');

    nodeSel.filter(d=>d.type==='employee').append('text')
      .text(d=>initials(d.label))
      .attr('text-anchor','middle').attr('dominant-baseline','central')
      .attr('font-size',8).attr('font-weight',800)
      .attr('fill',d=>d.color).attr('pointer-events','none');

    // Label
    nodeSel.append('text')
      .text(d=>d.label.length>18?d.label.slice(0,16)+'…':d.label)
      .attr('text-anchor','middle')
      .attr('dy', d=>d.r+14)
      .attr('font-size', d=>d.type==='root'?12 : d.type==='company'?11 : d.type==='department'?10:9)
      .attr('font-weight', d=>d.type==='root'?800 : d.type==='company'?700:500)
      .attr('fill', text).attr('pointer-events','none');

    // Sublabel
    nodeSel.filter(d=>!!d.sublabel && d.type!=='employee').append('text')
      .text(d=>d.sublabel)
      .attr('text-anchor','middle').attr('dy',d=>d.r+26)
      .attr('font-size',8).attr('fill',dim).attr('pointer-events','none');

    // Store selections for tick
    stateRef.current.linkSel = linkSel as any;
    stateRef.current.nodeSel = nodeSel as any;
  }

  function tick(g: d3.Selection<SVGGElement,unknown,null,undefined>) {
    const s = stateRef.current;
    if (!s.linkSel || !s.nodeSel) return;
    (s.linkSel as any)
      .attr('x1', (d:GLink) => (d.source as GNode).x!)
      .attr('y1', (d:GLink) => (d.source as GNode).y!)
      .attr('x2', (d:GLink) => (d.target as GNode).x!)
      .attr('y2', (d:GLink) => (d.target as GNode).y!);
    (s.nodeSel as any)
      .attr('transform', (d:GNode) => `translate(${d.x??0},${d.y??0})`);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const detail = empDetail || (selectedEmp ? { ...selectedEmp, location:'', schedule:'', avatar:null, subordinates_count:0, birthday:null, gender:null, marital:null, study_field:null, study_school:null } as EmpDetail : null);
  const empColor = detail ? (CO_COLOR[detail.company] || accent) : accent;

  const GENDER_LABEL: Record<string,string> = { male:'Masculino', female:'Femenino', other:'Otro' };
  const MARITAL_LABEL: Record<string,string> = { single:'Soltero/a', married:'Casado/a', cohabitant:'Unión libre', widower:'Viudo/a', divorced:'Divorciado/a' };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* Breadcrumb */}
      <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:10, flexWrap:'wrap', flexShrink:0 }}>
        <span style={{fontSize:11,color:dim}}>Vista:</span>
        {crumbs.map((b,i)=>(
          <div key={b.id} style={{display:'flex',alignItems:'center',gap:4}}>
            {i>0 && <span style={{color:dim,fontSize:11}}>›</span>}
            <button onClick={()=>{ setSelectedEmp(null); setEmpDetail(null); setPhotoFailed(false); setPhotoZoom(false); expand(b.id,b.label); }} style={{
              background: i===crumbs.length-1 ? `${accent}20`:'transparent',
              border:`1px solid ${i===crumbs.length-1?accent+'50':'transparent'}`,
              color: i===crumbs.length-1 ? accent : dim,
              padding:'3px 10px', borderRadius:6, fontSize:11,
              fontWeight: i===crumbs.length-1?700:500, cursor:'pointer',
            }}>{b.label}</button>
          </div>
        ))}
        {/* Search */}
        <div style={{ marginLeft:'auto', position:'relative' }}>
          <input
            type="text"
            placeholder="🔍 Buscar empleado…"
            value={searchQ}
            onChange={e => {
              const q = e.target.value;
              setSearchQ(q);
              if (q.trim().length < 2) { setSearchRes([]); return; }
              const ql = q.toLowerCase();
              setSearchRes(empleados.filter(emp =>
                emp.name.toLowerCase().includes(ql) ||
                emp.job_title.toLowerCase().includes(ql)
              ).slice(0, 8));
            }}
            onBlur={() => setTimeout(() => setSearchRes([]), 200)}
            style={{
              padding:'4px 10px', background:'rgba(255,255,255,0.07)',
              border:`1px solid ${accent}30`, borderRadius:8,
              color:'rgba(255,255,255,0.8)', fontSize:11, outline:'none', width:180,
            }}
          />
          {searchRes.length > 0 && (
            <div style={{
              position:'absolute', top:'110%', right:0,
              background:'rgba(5,15,10,0.98)', border:`1px solid ${accent}30`,
              borderRadius:10, zIndex:50, minWidth:240,
              boxShadow:'0 8px 24px rgba(0,0,0,0.5)', overflow:'hidden',
            }}>
              {searchRes.map(emp => (
                <div
                  key={emp.id}
                  onMouseDown={() => { openDetail(emp); setSearchQ(''); setSearchRes([]); }}
                  style={{ padding:'8px 12px', cursor:'pointer', borderBottom:'1px solid rgba(255,255,255,0.05)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${accent}15`)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.9)' }}>{emp.name}</div>
                  {emp.job_title && <div style={{ fontSize:10, color:dim, marginTop:1 }}>{emp.job_title}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main area: canvas + detail panel side by side */}
      <div style={{ flex:1, display:'flex', gap:12, minHeight:0 }}>

        {/* D3 canvas */}
        <div
          ref={containerRef}
          style={{ flex:1, border:`1px solid ${border}`, borderRadius:12, overflow:'hidden', position:'relative', background:bg, minHeight:400 }}
        />

        {/* Employee Detail Panel */}
        {selectedEmp && (
          <div style={{
            width:280, flexShrink:0,
            background:card, border:`1px solid ${empColor}40`,
            borderRadius:12, overflowY:'auto',
            boxShadow:`0 0 24px ${empColor}15`,
            display:'flex', flexDirection:'column',
          }}>
            {/* Header */}
            <div style={{ background:`${empColor}12`, borderBottom:`1px solid ${empColor}25`, padding:'16px 16px 12px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                <div style={{ fontSize:10, fontWeight:700, color:empColor, letterSpacing:'0.5px' }}>PERFIL DE EMPLEADO</div>
                <button onClick={()=>{ setSelectedEmp(null); setEmpDetail(null); setPhotoFailed(false); setPhotoZoom(false); }} style={{ background:'transparent', border:'none', color:dim, fontSize:16, cursor:'pointer', lineHeight:1 }}>✕</button>
              </div>

              {/* Avatar */}
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                {!photoFailed
                  ? <img
                      src={`${API_BASE}/api/rrhh/empleado/${selectedEmp.id}/foto`}
                      alt=""
                      onError={() => setPhotoFailed(true)}
                      onClick={() => setPhotoZoom(true)}
                      style={{ width:56, height:56, borderRadius:'50%', objectFit:'cover', border:`3px solid ${empColor}`, background:`${empColor}20`, cursor:'zoom-in' }}
                    />
                  : (
                    <div style={{ width:56, height:56, borderRadius:'50%', background:`${empColor}20`, border:`3px solid ${empColor}50`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:800, color:empColor, flexShrink:0 }}>
                      {initials(selectedEmp.name)}
                    </div>
                  )
                }
                <div>
                  <div style={{ fontWeight:800, fontSize:14, color:text, lineHeight:1.3 }}>{selectedEmp.name}</div>
                  <div style={{ fontSize:11, color:empColor, marginTop:3 }}>{selectedEmp.job_title || '—'}</div>
                  <div style={{ marginTop:5, background:`${empColor}18`, color:empColor, border:`1px solid ${empColor}35`, padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:700, display:'inline-block' }}>
                    {CO_SHORT[selectedEmp.company] || selectedEmp.company.split(' ')[0]}
                  </div>
                </div>
              </div>
            </div>

            {/* Loading spinner */}
            {detailLoading && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:20, gap:8 }}>
                <div style={{ width:16, height:16, border:`2px solid ${empColor}`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
                <span style={{ fontSize:11, color:dim }}>Cargando organigrama…</span>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            )}

            {/* Details */}
            {!detailLoading && detail && (
              <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:0 }}>

                {/* Contacto */}
                <Section label="Contacto" color={empColor}>
                  <Row icon="✉️" label="Email"    value={detail.email || '—'} dim={dim} text={text} />
                  <Row icon="📱" label="Teléfono" value={detail.phone || '—'} dim={dim} text={text} />
                </Section>

                {/* Organización */}
                <Section label="Organización" color={empColor}>
                  <Row icon="🏢" label="Empresa"    value={detail.company || '—'} dim={dim} text={text} />
                  <Row icon="🗂️" label="Depto"      value={shortDept(detail.department || '—')} dim={dim} text={text} />
                  <Row icon="👤" label="Reporta a"  value={detail.manager ? shortName(detail.manager) : '—'} dim={dim} text={text} />
                  {detail.subordinates_count > 0 && (
                    <Row icon="👥" label="Subordinados" value={`${detail.subordinates_count} personas`} dim={dim} text={text} color={empColor} />
                  )}
                  <Row icon="📍" label="Sede"       value={detail.location || '—'} dim={dim} text={text} />
                  <Row icon="🕐" label="Horario"    value={detail.schedule || '—'} dim={dim} text={text} />
                </Section>

                {/* Personal */}
                {(detail.birthday || detail.gender || detail.marital || detail.study_field) && (
                  <Section label="Información Personal" color={empColor}>
                    {detail.birthday && <Row icon="🎂" label="Nacimiento" value={detail.birthday} dim={dim} text={text} />}
                    {detail.gender   && <Row icon="👤" label="Género"     value={GENDER_LABEL[detail.gender] || detail.gender} dim={dim} text={text} />}
                    {detail.marital  && <Row icon="💍" label="Estado civil" value={MARITAL_LABEL[detail.marital] || detail.marital} dim={dim} text={text} />}
                    {detail.study_field  && <Row icon="📚" label="Área estudio" value={detail.study_field} dim={dim} text={text} />}
                    {detail.study_school && <Row icon="🎓" label="Institución" value={detail.study_school} dim={dim} text={text} />}
                  </Section>
                )}

              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {photoZoom && selectedEmp && !photoFailed && (
        <div
          onClick={() => setPhotoZoom(false)}
          style={{
            position:'fixed', inset:0, zIndex:400,
            background:'rgba(0,0,0,0.92)',
            display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap:16,
            cursor:'zoom-out',
          }}
        >
          <img
            src={`${API_BASE}/api/rrhh/empleado/${selectedEmp.id}/foto`}
            alt={selectedEmp.name}
            style={{
              maxWidth:'80vw', maxHeight:'75vh',
              borderRadius:16, objectFit:'contain',
              border:`3px solid ${CO_COLOR[selectedEmp.company] || accent}`,
              boxShadow:`0 0 60px ${CO_COLOR[selectedEmp.company] || accent}40`,
            }}
          />
          <div style={{ textAlign:'center' }}>
            <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>{selectedEmp.name}</div>
            <div style={{ color:'rgba(255,255,255,0.5)', fontSize:13, marginTop:4 }}>{selectedEmp.job_title}</div>
          </div>
          <div style={{ color:'rgba(255,255,255,0.25)', fontSize:12 }}>Clic para cerrar</div>
        </div>
      )}
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function Section({ label, color, children }: { label:string; color:string; children:React.ReactNode }) {
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontSize:9, fontWeight:800, color, letterSpacing:'0.8px', textTransform:'uppercase', marginBottom:6, marginTop:4 }}>{label}</div>
      <div style={{ display:'flex', flexDirection:'column', gap:1 }}>{children}</div>
    </div>
  );
}

function Row({ icon, label, value, dim, text, color }: { icon:string; label:string; value:string; dim:string; text:string; color?:string }) {
  return (
    <div style={{ display:'flex', gap:6, alignItems:'flex-start', padding:'4px 0', borderBottom:`1px solid ${dim}10` }}>
      <span style={{ fontSize:11, flexShrink:0, width:18 }}>{icon}</span>
      <span style={{ fontSize:10, color:dim, flexShrink:0, width:76 }}>{label}</span>
      <span style={{ fontSize:11, color: color || text, fontWeight:500, wordBreak:'break-word', flex:1 }}>{value}</span>
    </div>
  );
}
