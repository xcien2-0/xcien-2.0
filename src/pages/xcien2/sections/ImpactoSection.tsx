import { useEffect, useState } from 'react';
import { API_BASE } from '../../../config';
import brand from '../../../brand';

const GREEN   = '#00C896';
const BLUE    = '#38BDF8';
const PURPLE  = '#A78BFA';
const ORANGE  = '#FB923C';
const RED     = '#F87171';
const YELLOW  = '#FBBF24';
const DIM     = '#6b7280';
const CARD_BG = '#111827';

interface ImpactoData {
  fecha: string;
  academia:        Record<string, any>;
  noc:             Record<string, any>;
  wfm:             Record<string, any>;
  inventario:      Record<string, any>;
  automatizaciones: Record<string, any>;
  herramientas:    { nombre: string; descripcion: string; estado: string; version: string }[];
}

function Num({ value, suffix = '' }: { value: any; suffix?: string }) {
  const v = typeof value === 'number' ? value.toLocaleString('es-MX') : (value ?? '—');
  return (
    <span style={{ fontSize: 36, fontWeight: 900, color: '#f9fafb', lineHeight: 1 }}>
      {v}{suffix && <span style={{ fontSize: 18, color: DIM, marginLeft: 4 }}>{suffix}</span>}
    </span>
  );
}

function KPICard({ icon, label, value, suffix, color, sub }:
  { icon: string; label: string; value: any; suffix?: string; color: string; sub?: string }) {
  return (
    <div style={{
      background: CARD_BG, border: `1px solid ${color}25`, borderRadius: 16, padding: '20px 24px',
      display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '16px 16px 0 0' }} />
      <span style={{ fontSize: 22 }}>{icon}</span>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: DIM, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</p>
      <Num value={value} suffix={suffix} />
      {sub && <p style={{ margin: 0, fontSize: 12, color: DIM }}>{sub}</p>}
    </div>
  );
}

function AntesHoy({ antes, hoy, color }: { antes: string; hoy: string; color: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
      <div style={{
        background: 'rgba(255,71,87,0.06)', border: '1px solid rgba(255,71,87,0.25)',
        borderRadius: 12, padding: '14px 18px',
      }}>
        <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: '#F87171', textTransform: 'uppercase', letterSpacing: 1 }}>❌ Antes</p>
        <p style={{ margin: 0, fontSize: 14, color: '#f3f4f6', lineHeight: 1.5 }}>{antes}</p>
      </div>
      <div style={{
        background: `${color}0A`, border: `1px solid ${color}35`,
        borderRadius: 12, padding: '14px 18px',
      }}>
        <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: 1 }}>✅ Hoy</p>
        <p style={{ margin: 0, fontSize: 14, color: '#f3f4f6', lineHeight: 1.5 }}>{hoy}</p>
      </div>
    </div>
  );
}

function SectionTitle({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#f9fafb' }}>{label}</h3>
      <div style={{ flex: 1, height: 1, background: `${color}30` }} />
    </div>
  );
}

function ToolCard({ h }: { h: { nombre: string; descripcion: string; estado: string; version: string } }) {
  return (
    <div style={{
      background: CARD_BG, border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12,
      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: h.estado === 'activo' ? GREEN : RED,
        boxShadow: h.estado === 'activo' ? `0 0 8px ${GREEN}` : undefined,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#f3f4f6' }}>
          {h.nombre} <span style={{ fontSize: 11, color: DIM, fontWeight: 400 }}>{h.version}</span>
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: DIM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {h.descripcion}
        </p>
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
        background: h.estado === 'activo' ? `${GREEN}14` : 'rgba(255,0,0,0.1)',
        color: h.estado === 'activo' ? GREEN : RED,
        border: `1px solid ${h.estado === 'activo' ? GREEN : RED}30`,
        flexShrink: 0,
      }}>
        {h.estado.toUpperCase()}
      </span>
    </div>
  );
}

export default function ImpactoSection() {
  const [data, setData]       = useState<ImpactoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/impacto/resumen`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(() => setError('No se pudieron cargar los datos de impacto. Intenta de nuevo.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, gap: 12, color: DIM }}>
      <div style={{ width: 20, height: 20, border: `2px solid ${GREEN}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      Cargando datos en vivo...
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ padding: 40, color: RED, textAlign: 'center' }}>{error}</div>
  );

  if (!data) return null;

  const noc = data.noc;
  const ac  = data.academia;
  const wfm = data.wfm;
  const inv = data.inventario;
  const aut = data.automatizaciones;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 40 }}>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, #0d1117 0%, #111827 100%)`,
        border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, padding: '28px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: '#f9fafb', letterSpacing: -0.5 }}>
            Impacto Operacional
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: DIM }}>
            Ecosistema digital {brand.orgName} · Datos en vivo · {data.fecha}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 40, fontWeight: 900, color: GREEN, lineHeight: 1 }}>
            {data.herramientas.filter(h => h.estado === 'activo').length}
          </div>
          <div style={{ fontSize: 12, color: DIM, marginTop: 4 }}>herramientas activas</div>
        </div>
      </div>

      {/* Resumen ejecutivo — 4 grandes números */}
      <div>
        <SectionTitle icon="📊" label="Resumen Ejecutivo" color={GREEN} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <KPICard icon="🖥️" label="Hosts monitoreados" value={noc.hosts_monitoreados} color={BLUE}
            sub={`${noc.hosts_down ?? 0} con problemas activos`} />
          <KPICard icon="🎓" label="Técnicos en academia" value={ac.tecnicos_inscritos} color={GREEN}
            sub={`${ac.tecnicos_activos ?? 0} activos · ${ac.avance_promedio ?? 0}% promedio`} />
          <KPICard icon="🔧" label="Tickets este mes" value={wfm.tickets_este_mes} color={ORANGE}
            sub={`${wfm.tickets_cerrados_mes ?? 0} cerrados`} />
          <KPICard icon="📦" label="Productos en inventario" value={inv.productos_activos} color={PURPLE}
            sub={`${inv.transferencias_completadas_mes ?? 0} transferencias este mes`} />
        </div>
      </div>

      {/* NOC */}
      <div>
        <SectionTitle icon="🛡️" label="Monitoreo de Red (NOC)" color={BLUE} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <KPICard icon="📡" label="Infraestructura monitoreada" value={noc.hosts_monitoreados} suffix="hosts" color={BLUE}
            sub="Monitoreo 24/7 en tiempo real" />
          <KPICard icon="✅" label="Sitios operando" value={noc.hosts_up} color={GREEN}
            sub="Con conectividad confirmada" />
          <KPICard icon="🚨" label="Alertas activas" value={noc.alertas_activas} color={noc.alertas_activas > 10 ? RED : YELLOW}
            sub="Detectadas automáticamente" />
        </div>
        <AntesHoy color={BLUE}
          antes="Fallas detectadas por quejas de clientes — horas después del incidente."
          hoy="Detección automática en segundos. Notificación inmediata al equipo vía Telegram." />
      </div>

      {/* Academia */}
      <div>
        <SectionTitle icon="🎓" label={brand.academiaLabel} color={GREEN} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <KPICard icon="📚" label="Cursos activos" value={ac.cursos_activos} color={GREEN}
            sub="Con evaluaciones reales en Odoo" />
          <KPICard icon="👥" label="Personas inscritas" value={ac.tecnicos_inscritos} color={BLUE}
            sub="Acceso desde cualquier dispositivo" />
          <KPICard icon="🔥" label="Avanzando ahora" value={ac.tecnicos_activos} color={ORANGE}
            sub="Con progreso mayor a 0%" />
          <KPICard icon="📈" label="Avance promedio" value={ac.avance_promedio} suffix="%" color={PURPLE}
            sub="En todos los cursos" />
        </div>
        <AntesHoy color={GREEN}
          antes="Capacitación informal, sin registro, sin evidencia de quién sabe qué."
          hoy="Cada técnico tiene perfil de competencias medible con evaluaciones calificadas en Odoo." />
      </div>

      {/* WFM + Inventario */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <SectionTitle icon="🔧" label="Operaciones en Campo (WFM)" color={ORANGE} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <KPICard icon="📋" label="Tickets este mes" value={wfm.tickets_este_mes} color={ORANGE}
              sub={`${wfm.tickets_cerrados_mes ?? 0} cerrados · histórico: ${(wfm.tickets_total_historico ?? 0).toLocaleString('es-MX')}`} />
          </div>
          <AntesHoy color={ORANGE}
            antes="Visitas sin registro. Sin evidencia de materiales usados ni firma del cliente."
            hoy="Cada visita registrada: materiales, firma, fotos y tiempo de respuesta — desde el celular." />
        </div>

        <div>
          <SectionTitle icon="📦" label="Inventario" color={PURPLE} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <KPICard icon="🏪" label="Productos rastreados" value={inv.productos_activos} color={PURPLE}
              sub={`${inv.ubicaciones_con_stock ?? 0} ubicaciones con stock`} />
          </div>
          <AntesHoy color={PURPLE}
            antes="Inventario sin visibilidad. Sin saber qué hay en cada camión o almacén."
            hoy="6,367 productos rastreados en tiempo real. Transferencias y entradas con scanner QR." />
        </div>
      </div>

      {/* Automatizaciones */}
      <div>
        <SectionTitle icon="🤖" label="Automatizaciones en Operación" color={YELLOW} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <KPICard icon="🤖" label="Bots activos 24/7" value={aut.bots_telegram} color={YELLOW}
            sub="Alertas NOC + Reportes → Telegram" />
          <KPICard icon="📄" label="Reportes automáticos" value={aut.reportes_automaticos} color={ORANGE}
            sub="NOC semanal, tránsito, bidrillas, FODA" />
          <KPICard icon="🔗" label="Integraciones activas" value={(aut.integraciones_activas || []).length} color={BLUE}
            sub={(aut.integraciones_activas || []).join(' · ')} />
        </div>
      </div>

      {/* Herramientas */}
      <div>
        <SectionTitle icon="🛠️" label="Herramientas Desplegadas" color={DIM} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {data.herramientas.map(h => <ToolCard key={h.nombre} h={h} />)}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        background: CARD_BG, border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16, padding: '20px 28px', textAlign: 'center',
      }}>
        <p style={{ margin: 0, fontSize: 13, color: DIM }}>
          Datos en tiempo real desde Odoo · Observium · Sistema {brand.name} 2.0
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: `${DIM}80` }}>
          Todo lo que aparece aquí opera de forma continua — sin intervención manual.
        </p>
      </div>

    </div>
  );
}
