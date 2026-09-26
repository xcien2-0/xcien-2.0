import brand from '../../brand';

// ── Theme ─────────────────────────────────────────────────────────────────────
export interface ThemeConfig {
  accent: string;
  bg: string;
  card: string;
  sidebar: string;
  border: string;
  text: string;
  dim: string;
  sidebarWidth: number;
  radius: number;
  baseFontSize: number;
  animations: boolean;
  compact: boolean;
}

export const DEFAULT_THEME: ThemeConfig = {
  accent:      brand.accentColor,
  bg:          '#0A0A0A',
  card:        '#151515',
  sidebar:     '#0F0F0F',
  border:      'rgba(255,255,255,0.06)',
  text:        '#F0F0F0',
  dim:         '#808080',
  sidebarWidth: 260,
  radius:       12,
  baseFontSize: 14,
  animations:   true,
  compact:      false,
};

export const PRESET_ACCENTS = [
  { label: 'Color Corporativo', value: brand.accentColor },
  { label: 'Cian NOC',    value: '#00B4D8' },
  { label: 'Azul',        value: '#3B82F6' },
  { label: 'Morado',      value: '#8B5CF6' },
  { label: 'Naranja',     value: '#F97316' },
  { label: 'Rosa',        value: '#EC4899' },
];

// ── Preset themes ─────────────────────────────────────────────────────────────
export interface PresetTheme {
  id:          string;
  name:        string;
  description: string;
  emoji:       string;
  preview:     { bg: string; accent: string; card: string; text: string };
  config:      ThemeConfig;
}

export const PRESET_THEMES: PresetTheme[] = [
  {
    id: 'xcien',
    name: 'XCIEN',
    description: 'Verde corporativo sobre negro · tema oficial por defecto',
    emoji: '🟢',
    preview: { bg: '#0A0A0A', accent: brand.accentColor, card: '#151515', text: '#F0F0F0' },
    config: DEFAULT_THEME,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Azul marino · ideal para operaciones de red',
    emoji: '🌊',
    preview: { bg: '#0B1826', accent: '#00B4D8', card: '#0f2030', text: '#e2e8f0' },
    config: {
      accent:       '#00B4D8',
      bg:           '#0B1826',
      card:         '#0f2030',
      sidebar:      '#091520',
      border:       'rgba(0,180,216,0.12)',
      text:         '#e2e8f0',
      dim:          '#4a6a7a',
      sidebarWidth: 260,
      radius:       12,
      baseFontSize: 14,
      animations:   true,
      compact:      false,
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Morado profundo · modo nocturno de trabajo',
    emoji: '🌙',
    preview: { bg: '#0D0A1A', accent: '#8B5CF6', card: '#141020', text: '#EDE9FE' },
    config: {
      accent:       '#8B5CF6',
      bg:           '#0D0A1A',
      card:         '#141020',
      sidebar:      '#0F0C18',
      border:       'rgba(139,92,246,0.15)',
      text:         '#EDE9FE',
      dim:          '#6D5E8A',
      sidebarWidth: 260,
      radius:       14,
      baseFontSize: 14,
      animations:   true,
      compact:      false,
    },
  },
  {
    id: 'holo',
    name: 'NOC Holográfico',
    description: 'Neon verde · estilo sala de control sci-fi',
    emoji: '⚡',
    preview: { bg: '#000905', accent: '#00ff88', card: '#050f07', text: '#d8f8e8' },
    config: {
      accent:       '#00ff88',
      bg:           '#000905',
      card:         '#050f07',
      sidebar:      '#020a04',
      border:       'rgba(0,255,136,0.12)',
      text:         '#d8f8e8',
      dim:          '#2a6040',
      sidebarWidth: 260,
      radius:       6,
      baseFontSize: 13,
      animations:   true,
      compact:      false,
    },
  },
  {
    id: 'matrix',
    name: 'Matrix',
    description: 'Código verde sobre negro · lluvia digital animada',
    emoji: '📟',
    preview: { bg: '#000500', accent: '#00ff41', card: '#001505', text: '#00ff88' },
    config: {
      accent:       '#00ff41',
      bg:           '#000500',
      card:         '#001505',
      sidebar:      '#000800',
      border:       'rgba(0,255,65,0.25)',
      text:         '#00ff88',
      dim:          '#004d00',
      sidebarWidth: 260,
      radius:       2,
      baseFontSize: 13,
      animations:   true,
      compact:      true,
    },
  },
  {
    id: 'corporate',
    name: 'Claro',
    description: 'Modo claro · presentaciones y visitas de cliente',
    emoji: '🏢',
    preview: { bg: '#F5F5F7', accent: '#0066CC', card: '#FFFFFF', text: '#1D1D1F' },
    config: {
      accent:       '#0066CC',
      bg:           '#F5F5F7',
      card:         '#FFFFFF',
      sidebar:      '#FAFAFA',
      border:       'rgba(0,0,0,0.08)',
      text:         '#1D1D1F',
      dim:          '#6E6E73',
      sidebarWidth: 260,
      radius:       12,
      baseFontSize: 14,
      animations:   true,
      compact:      false,
    },
  },
];

// ── Navigation ────────────────────────────────────────────────────────────────
export type SectionId = 'inicio' | 'noc' | 'red' | 'academia' | 'wfm' | 'call' | 'scan' | 'gerencia' | 'reports' | 'reportlab' | 'reportes-kpi' | 'tokens' | 'transacciones' | 'etiquetas' | 'editor' | 'holo' | 'foda' | 'bridge' | 'war-room' | 'incidentes' | 'mobile' | 'telegram' | 'docs' | 'adopcion' | 'bidrillas' | 'agentes' | 'rrhh' | 'sala_juntas' | 'inv-transfers' | 'merkle' | 'ventas' | 'ventas-efectividad' | 'estrategia2030' | 'superadmin' | 'cerebro' | 'comite' | 'token-ai' | 'proyectos' | 'infra-energia' | 'backup' | 'impacto' | 'plan2026' | 'integridad' | 'analytics' | 'helpdesk' | 'net2phone' | 'fibra' | 'radiobases' | 'auditoria-odoo' | 'auditorias-plazas' | 'iblack' | 'odoo-docs' | 'blackstone' | 'city-mty' | 'city-slt' | 'usuarios-admin' | 'usuarios-invitados' | 'atc-efectividad' | 'cast' | 'sync' | 'fibra_xcien' | 'mesa-ops' | 'flotilla' | 'dispatch' | 'backlog';

export interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  group?: string;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

// ── WFM ───────────────────────────────────────────────────────────────────────
export type TechStatus = 'Disponible' | 'En Sitio' | 'En Oficina';
export type TicketPriority = 'critical' | 'high' | 'medium';

export interface WFMTechnician {
  id: string;
  name: string;
  zone: string;
  specialization: string;
  skillPct: number;
  status: TechStatus;
}

export interface WFMTicket {
  id: string;
  client: string;
  description: string;
  location: string;
  priority: TicketPriority;
  assignedTo: string | null;
}

// ── WFM Implementation Order (Nuevo) ──────────────────────────────────────────
export type WFMOrderState =
  | 'SOLICITUD_PREVENTA'
  | 'ANTEPROYECTO'
  | 'ORDEN_IMPLEMENTACION'
  | 'ALMACEN_VALIDACION'
  | 'ESPERA_ALMACEN'
  | 'ESPERA_INVENTARIO'
  | 'APROVISIONAMIENTO'
  | 'REVISION_PM'
  | 'LISTO_INSTALACION'
  | 'INSTALACION'
  | 'NOC_VALIDACION'
  | 'FACTURACION'
  | 'BACKLOG'
  | 'CERRADO';

export interface WFMOrder {
  id: string;
  odoo_id?: number;
  odoo_stage_id?: number;
  cliente: string;
  servicio: string;
  comercial: string;
  estado: WFMOrderState;
  estado_fuente?: 'odoo' | 'local';
  revenue?: number;
  fecha_deadline?: string | null;
  fecha_creacion: string;
  preventa: {
    analisis: string | null;
    factibilidad: string | null;
    tecnologia: string | null;
    equipos_sugeridos: any[];
    anteproyecto_url: string | null;
  };
  almacen: {
    disponibilidad: boolean;
    equipos_asignados: any[];
    esperando_inventario: boolean;
    respuesta?: 'disponible' | 'no_disponible' | 'disponible_en_fecha';
    fecha_estimada?: string | null;
    motivo?: string;
    respondido_por?: string;
    fecha_respuesta?: string;
  };
  aprovisionamiento: {
    config_logica: string | null;
    parametros_red: Record<string, any>;
    listo: boolean;
    vlan?: number | null;
    bw_mbps?: number | null;
    ip_wan?: string | null;
    gateway?: string | null;
    firmware?: string | null;
    mac_address?: string | null;
    notas_config?: string | null;
    aprovisionado_por?: string | null;
    fecha_aprovisionamiento?: string | null;
  };
  pm: {
    auditoria_ok: boolean;
    bloqueada: boolean;
    motivo_bloqueo: string | null;
    backlogs: any[];
  };
  evidencias?: {
    fotos_antes: Array<{ filename: string; path_rel: string; tipo: string; fecha: string; usuario: string; size_kb: number; data_b64?: string }>;
    fotos_despues: Array<{ filename: string; path_rel: string; tipo: string; fecha: string; usuario: string; size_kb: number; data_b64?: string }>;
    checklist_ok: boolean;
    notas: string;
    cerrado_por: string | null;
    fecha_cierre: string | null;
  };
  checklist?: Array<{
    id: string;
    categoria: string;
    descripcion: string;
    completado: boolean;
    completado_por: string | null;
    fecha_completado: string | null;
    observacion: string;
  }>;
  noc?: {
    ping_ok: boolean | null;
    latencia_ms: number | null;
    ip_destino?: string;
    dado_de_alta: boolean;
    herramienta_monitoreo: string | null;
    host_id: string | null;
    alertas_configuradas: boolean;
    grupos_alerta: string[];
    aprobado: boolean;
    aprobado_por: string | null;
    fecha_alta: string | null;
    observaciones: string;
  };
  pruebas_velocidad?: Array<{
    id: string;
    fecha: string;
    usuario: string;
    bw_contratado_mbps: number;
    descarga_mbps: number;
    subida_mbps: number;
    latencia_ms: number;
    perdida_pct: number;
    servidor: string;
    herramienta: string;
    resultados: {
      ok_descarga: boolean;
      ok_subida: boolean;
      ok_latencia: boolean;
      ok_perdida: boolean;
      aprobada: boolean;
      pct_descarga: number;
      pct_subida: number;
    };
  }>;
  historial: Array<{ fecha: string; accion: string; usuario: string }>;
}

// ── Field Service Ticket (Habilitaciones & Fallas desde Odoo helpdesk) ────────
export interface FieldTicket {
  id: string;             // "HD-155749"
  odoo_id: number;
  nombre: string;         // nombre del ticket en Odoo
  cliente: string;
  tecnico: string | null;
  tipo: 'habilitacion' | 'falla';
  tipo_label: string;     // "INSTALACION" | "Falla General" | etc.
  prioridad: 'normal' | 'alta' | 'urgente' | 'crítica';
  etapa_odoo: string;     // nombre de la etapa en Odoo
  etapa_op_idx: number;   // 0=NOC, 1=Dispatch, 2=Almacén, 3=Operaciones, 4=NOC Cierra
  etapa_op: string;
  etapa_color: string;
  fecha_creacion: string;
  fecha_cierre: string | null;
  cerrado: boolean;
  kanban_state: 'normal' | 'done' | 'blocked';
}

// ── WFM mock data ─────────────────────────────────────────────────────────────
export const WFM_TECHNICIANS: WFMTechnician[] = [
  { id: 't1', name: 'Carlos Mendoza',       zone: 'Nuevo León',  specialization: 'Instalación Fibra', skillPct: 92, status: 'Disponible' },
  { id: 't2', name: 'Ana Rodríguez',         zone: 'Coahuila',    specialization: 'RF & Wireless',     skillPct: 87, status: 'En Sitio'   },
  { id: 't3', name: 'Miguel Ángel Torres',   zone: 'San Luis P.', specialization: 'Soporte Nivel 2',   skillPct: 78, status: 'Disponible' },
  { id: 't4', name: 'Laura Garza',           zone: 'Nuevo León',  specialization: 'Splicing Óptico',   skillPct: 95, status: 'En Oficina' },
  { id: 't5', name: 'Roberto Salinas',       zone: 'CDMX',        specialization: 'Infraestructura',   skillPct: 83, status: 'En Sitio'   },
  { id: 't6', name: 'Jorge Martínez',        zone: 'Jalisco',     specialization: 'Instalación Fibra', skillPct: 71, status: 'Disponible' },
];

export const WFM_TICKETS: WFMTicket[] = [
  { id: 'T-1042', client: 'Xcien Monterrey',  description: 'Latencia elevada en nodo core',    location: 'Apodaca, NL',     priority: 'critical', assignedTo: null },
  { id: 'T-1043', client: 'Luminet WAN',       description: 'Fibra cortada — restitución',      location: 'Torreón, COAH',   priority: 'critical', assignedTo: 't2' },
  { id: 'T-1044', client: 'Sandur SLP',        description: 'Configuración de equipo nuevo',    location: 'Soledad G.S.',    priority: 'high',     assignedTo: null },
  { id: 'T-1045', client: 'Huus CDMX',         description: 'Revisión de nodo secundario',      location: 'CDMX Sur',        priority: 'medium',   assignedTo: 't5' },
  { id: 'T-1046', client: 'Wispi Jalisco',      description: 'Instalación cliente corporativo',  location: 'Guadalajara, JAL',priority: 'high',     assignedTo: null },
];
