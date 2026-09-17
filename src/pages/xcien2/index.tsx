import React, { useState, useReducer, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import QRCode from 'qrcode';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, Radio, Map, Settings, Truck, Phone, Package, ArrowLeftRight,
  GraduationCap, Link2, GitBranch, BarChart2, FileText, BookOpen,
  Shield, Users, User, Calendar, Bot, Zap, Bell,
  Database, Settings2, LayoutGrid, ChevronLeft, ChevronRight,
  Activity, Network, Layers, AlertTriangle, TrendingUp, BellRing,
} from 'lucide-react';
import { API_BASE } from '../../config';
import brand from '../../brand';
import { ThemeConfig, DEFAULT_THEME, SectionId, PresetTheme, PRESET_THEMES } from './types';
import { useAuth } from '../../contexts/AuthContext';
import { getRealCities, getRealAlerts, invalidateNOCCache } from '@/services/nocboard';
import { NOCCity, NOCAlert } from '@/types/noc';

// ── Siempre visibles — importación estática ───────────────────────────────────
import DevPanel from './DevPanel';
import NotificacionesPanel from './sections/NotificacionesPanel';
import CommandPalette from './sections/CommandPalette';
import InicioRol from './sections/InicioRol';
import { useNotificaciones } from '../../hooks/useNotificaciones';
import { useAnalytics } from '../../contexts/AnalyticsContext';
import FeedbackWidget from '../../components/FeedbackWidget';

import { useIsMobile } from '@/hooks/use-mobile';
import { Menu, X as CloseIcon } from 'lucide-react';
import { useVisibleInterval } from '../../hooks/useVisibleInterval';
import { usePresence } from '../../hooks/usePresence';
import PresenceAvatars from '../../components/PresenceAvatars';

// ── Secciones lazy — se cargan solo cuando el usuario las abre ────────────────
const HexoField3D        = lazy(() => import('../../components/HexoField3D'));
const InicioHoloSection  = lazy(() => import('./sections/InicioHoloSection'));
const NocSection              = lazy(() => import('./sections/NocSection'));
const CastSection             = lazy(() => import('./sections/CastSection'));
const MesaOperacionesSection  = lazy(() => import('./sections/MesaOperacionesSection'));
const InfraEnergiaSection = lazy(() => import('./sections/InfraEnergiaSection'));
const ProyectosSection    = lazy(() => import('./sections/ProyectosSection'));
const RedSection         = lazy(() => import('./sections/RedSection'));
const SyncSection        = lazy(() => import('./sections/SyncSection'));
const BidrillasSection   = lazy(() => import('./sections/BidrillasSection'));
const AcademiaSection    = lazy(() => import('./sections/AcademiaSection'));
const AcademiaHoloSection= lazy(() => import('./sections/AcademiaHoloSection'));
const WFMSection         = lazy(() => import('./sections/WFMSection'));
const RRHHSection        = lazy(() => import('./sections/RRHHSection'));
const SalaJuntasSection  = lazy(() => import('./sections/SalaJuntasSection'));
const VentasSection            = lazy(() => import('./sections/VentasSection'));
const VentasEfectividadSection = lazy(() => import('./sections/VentasEfectividadSection'));
const AgentesSection     = lazy(() => import('./sections/AgentesSection'));
const InventarioSection  = lazy(() => import('./sections/InventarioSection'));
const InventarioTransfersSection = lazy(() => import('./sections/InventarioTransfersSection'));
const XcienTokensSection = lazy(() => import('./sections/XcienTokensSection'));
const MerkleFeedSection  = lazy(() => import('./sections/MerkleFeedSection'));
const Estrategia2030Section = lazy(() => import('./sections/Estrategia2030Section'));
const ProyectosDashboardSection = lazy(() => import('./sections/ProyectosDashboardSection'));
const SuperAdminSection     = lazy(() => import('./sections/SuperAdminSection'));
const CerebroSection        = lazy(() => import('./sections/CerebroSection'));
const AdopcionSection    = lazy(() => import('./sections/AdopcionSection'));
const TelegramBotSection = lazy(() => import('./sections/TelegramBotSection'));
const DocsSection        = lazy(() => import('./sections/DocsSection'));
const BackupSection      = lazy(() => import('./sections/BackupSection'));
const ReportLabSection   = lazy(() => import('./sections/ReportLabSection'));
const AuditoriaOdooSection   = lazy(() => import('./sections/AuditoriaOdooSection'));
const AuditoriasPlazasSection = lazy(() => import('./sections/AuditoriasPlazasSection'));
const FinanzasSection    = lazy(() => import('./sections/FinanzasSection'));
const ReportesKPISection      = lazy(() => import('./sections/ReportesKPISection'));
const IncidentesSection       = lazy(() => import('./sections/IncidentesSection'));
const ComiteSection           = lazy(() => import('./sections/ComiteSection'));
const TokenConsumptionSection = lazy(() => import('./sections/TokenConsumptionSection'));
const ImpactoSection          = lazy(() => import('./sections/ImpactoSection'));
const IntegridadSection       = lazy(() => import('./sections/IntegridadSection'));
const AnalyticsSection        = lazy(() => import('./sections/AnalyticsSection'));
const HelpdeskSection         = lazy(() => import('./sections/HelpdeskSection'));
const Net2PhoneSection        = lazy(() => import('./sections/Net2PhoneSection'));
const CallCenterHubSection    = lazy(() => import('./sections/CallCenterHubSection'));
const FibraSection            = lazy(() => import('./sections/FibraSection'));
const IBlackSection           = lazy(() => import('./sections/IBlackSection'));
const RadioBasesSection       = lazy(() => import('./sections/RadioBasesSection'));
const FlotillaSection         = lazy(() => import('./sections/FlotillaSection'));
const OdooDocsSection         = lazy(() => import('./sections/OdooDocsSection'));
const BlackstoneOSSection     = lazy(() => import('./sections/BlackstoneOSSection'));
const FibraXCIENSection       = lazy(() => import('./sections/FibraXCIENSection'));
const UsuariosAdminSection      = lazy(() => import('./sections/UsuariosAdminSection'));
const UsuariosInvitadosSection  = lazy(() => import('./sections/UsuariosInvitadosSection'));
const ATCEfectividadSection     = lazy(() => import('./sections/ATCEfectividadSection'));
const CallCenter         = lazy(() => import('../CallCenter'));
const Gerencia           = lazy(() => import('../Gerencia'));
const ReportesGobierno   = lazy(() => import('../ReportesGobierno'));

// ── Theme reducer ─────────────────────────────────────────────────────────────
type ThemeAction = { type: 'patch'; payload: Partial<ThemeConfig> } | { type: 'reset' };

function themeReducer(state: ThemeConfig, action: ThemeAction): ThemeConfig {
  switch (action.type) {
    case 'patch': return { ...state, ...action.payload };
    case 'reset': return DEFAULT_THEME;
    default: return state;
  }
}

// ── Acceso por rol — alineado al PAC 2026 (17 áreas) ────────────────────────
// Mapa y secciones financieras: solo admin y director.
// Los roles se asignan en Railway por área según el PAC 2026.
const ROLE_SECTIONS: Record<string, SectionId[] | '*'> = {

  // ══ NIVEL DIRECCIÓN ══════════════════════════════════════════════════════
  admin:    '*',

  director: ['inicio','impacto','noc','cast','mesa-ops','red','infra-energia','incidentes',
              'ventas','integridad','reportes-kpi','auditoria-odoo','auditorias-plazas',
              'rrhh','sala_juntas','proyectos','plan2026','fibra','radiobases',
              'estrategia2030','agentes','comite','docs','reportlab','analytics',
              'blackstone','fibra_xcien','iblack','flotilla','wfm','bidrillas',
              'usuarios-invitados','atc-efectividad'],

  // ══ PAC ÁREA 1 — OPERACIONES ════════════════════════════════════════════
  operaciones: ['inicio','wfm','bidrillas','scan','inv-transfers','mesa-ops',
                'docs','sala_juntas','radiobases','blackstone','cast','auditorias-plazas'],
  wfm:         ['inicio','wfm','bidrillas','scan','inv-transfers','mesa-ops',
                'docs','sala_juntas','radiobases','blackstone','cast'],

  // ══ PAC ÁREA 2 — NOC ════════════════════════════════════════════════════
  noc:        ['inicio','noc','cast','mesa-ops','infra-energia','incidentes',
               'telegram','wfm','bidrillas','helpdesk','docs','radiobases',
               'blackstone','fibra_xcien'],
  'noc-viewer': ['inicio','noc','cast','infra-energia'],           // solo lectura NOC

  // ══ PAC ÁREA 3 — INFRAESTRUCTURA ════════════════════════════════════════
  infraestructura: ['inicio','noc','cast','infra-energia','incidentes',
                    'radiobases','fibra_xcien','academia','docs','blackstone'],
  tecnico:         ['inicio','academia','docs'],                   // alias legacy (básico)

  // ══ PAC ÁREA 4 — INGENIERÍA ═════════════════════════════════════════════
  ingenieria: ['inicio','proyectos','plan2026','fibra','fibra_xcien',
               'radiobases','blackstone','docs','sala_juntas','noc','infra-energia'],

  // ══ PAC ÁREA 5 — LEGAL ══════════════════════════════════════════════════
  legal: ['inicio','docs','sala_juntas'],

  // ══ PAC ÁREA 6 — RECURSOS HUMANOS ═══════════════════════════════════════
  rrhh:     ['inicio','rrhh','sala_juntas','academia','docs'],

  // ══ PAC ÁREA 7 — FACTURACIÓN Y COBRANZA ═════════════════════════════════
  facturacion: ['inicio','docs','sala_juntas'],

  // ══ PAC ÁREA 8 — FINANZAS Y CONTABILIDAD ════════════════════════════════
  // Datos financieros solo admin/director — rol finanzas acceso operativo
  finanzas: ['inicio','docs','sala_juntas','rrhh'],

  // ══ PAC ÁREA 9 — ATENCIÓN A CLIENTES ════════════════════════════════════
  atc:  ['inicio','cast','mesa-ops','helpdesk'],

  // ══ PAC ÁREA 10-13 — COMERCIAL (XCIEN / HUUS / LUMINET / GOBIERNO) ══════
  comercial:          ['inicio','sala_juntas','proyectos','docs','iblack'],
  'comercial-huus':   ['inicio','sala_juntas','proyectos','docs'],
  'comercial-luminet':['inicio','sala_juntas','proyectos','docs'],
  'comercial-gobierno':['inicio','sala_juntas','proyectos','docs'],

  // ══ PAC ÁREA 14 — MARKETING ═════════════════════════════════════════════
  marketing: ['inicio','sala_juntas','proyectos','docs'],

  // ══ PAC ÁREA 15 — PRE-VENTA ═════════════════════════════════════════════
  preventa: ['inicio','proyectos','plan2026','fibra','fibra_xcien',
             'blackstone','docs','sala_juntas','iblack','radiobases'],

  // ══ PAC ÁREA 16 — CADENA DE SUMINISTROS ═════════════════════════════════
  'cadena-suministros': ['inicio','scan','inv-transfers','docs'],
  almacen:              ['inicio','scan','inv-transfers','docs'],  // alias legacy

  // ══ PAC ÁREA 17 — T.I. ══════════════════════════════════════════════════
  ti: ['inicio','noc','cast','infra-energia','incidentes','radiobases',
       'agentes','cerebro','docs','academia','sync','blackstone','fibra_xcien'],

  // ══ ACADEMIA / CAPACITACIÓN — transversal al PAC ════════════════════════
  academico: ['inicio','academia','docs','blackstone','fibra_xcien','fibra'],

  // ══ SOLO LECTURA ════════════════════════════════════════════════════════
  readonly: ['inicio'],
};

function canAccess(rol: string | undefined, id: SectionId): boolean {
  if (!rol) return false;
  const allowed = ROLE_SECTIONS[rol] ?? [];
  if (allowed === '*') return true;
  return allowed.includes(id);
}

// ── Navigation structure ──────────────────────────────────────────────────────
interface NavEntry { id: SectionId; label: string; icon: string; group?: string }

const NAV: NavEntry[] = [
  { id: 'inicio', label: 'Hub Principal', icon: '🏠' },

  // ── Monitoreo ──────────────────────────────────────────────────────────────
  { id: 'noc',           label: 'NOC Virtual',             icon: '📡', group: 'Monitoreo' },
  { id: 'cast',          label: 'ATC NOC',                 icon: '🎫', group: 'Monitoreo' },
  { id: 'mesa-ops',      label: 'Mesa de Operaciones',     icon: '🗂️', group: 'Monitoreo' },
  { id: 'helpdesk',      label: 'Mesa de Ayuda',           icon: '📈', group: 'Monitoreo' },
  { id: 'infra-energia', label: 'Infraestructura Energía', icon: '⚡', group: 'Monitoreo' },
  { id: 'red',           label: 'Mapa de Red',             icon: '🗺️', group: 'Monitoreo' },
  { id: 'sync',          label: 'Sincronización Datos',    icon: '🔄', group: 'Monitoreo' },
  { id: 'fibra_xcien',   label: 'Fibra Óptica XCIEN',       icon: '🔆', group: 'Monitoreo' },
  { id: 'blackstone',    label: 'Blackstone · PDN',         icon: '🏙️', group: 'Monitoreo' },
  { id: 'incidentes',    label: 'Incidentes',              icon: '🚨', group: 'Monitoreo' },
  { id: 'telegram',      label: 'Bot de Alarmas',          icon: '🔔', group: 'Monitoreo' },

  // ── Flotilla ───────────────────────────────────────────────────────────────
  { id: 'flotilla',      label: 'Flotilla GPS',        icon: '🚗', group: 'Flotilla' },

  // ── Campo & Inventario ─────────────────────────────────────────────────────
  { id: 'wfm',           label: 'Control Operativo',    icon: '⚙️', group: 'Campo & Inventario' },
  { id: 'bidrillas',     label: 'Equipos de Campo',     icon: '🚛', group: 'Campo & Inventario' },
  { id: 'call',          label: 'Call Center',          icon: '📞', group: 'Campo & Inventario' },
  { id: 'scan',          label: 'Inventario & Scanner', icon: '🔍', group: 'Campo & Inventario' },
  { id: 'inv-transfers', label: 'Transferencias',       icon: '🏷️', group: 'Campo & Inventario' },
  { id: 'auditoria-odoo',    label: 'Auditoría Odoo',     icon: '🔎', group: 'Campo & Inventario' },
  { id: 'auditorias-plazas', label: 'Auditorías de Plazas', icon: '📋', group: 'Campo & Inventario' },
  { id: 'odoo-docs',         label: 'Guías Odoo',          icon: '📖', group: 'Campo & Inventario' },

  // ── Comercial ──────────────────────────────────────────────────────────────
  { id: 'ventas',             label: 'Resumen Ventas',       icon: '📈', group: 'Comercial' },
  { id: 'ventas-efectividad', label: 'Efectividad Ventas',   icon: '🏆', group: 'Comercial' },
  { id: 'integridad',         label: 'Integridad Comercial', icon: '🔒', group: 'Comercial' },
  { id: 'gerencia',           label: 'Gerencia',             icon: '📊', group: 'Comercial' },
  { id: 'reportes-kpi',       label: 'KPI Dashboard',        icon: '🎯', group: 'Comercial' },
  { id: 'reports',            label: 'Reportes',             icon: '📋', group: 'Comercial' },
  { id: 'docs',               label: 'Documentos',           icon: '📚', group: 'Comercial' },

  // ── Capital Humano ─────────────────────────────────────────────────────────
  { id: 'rrhh',        label: 'Recursos Humanos', icon: '👤', group: 'Capital Humano' },
  { id: 'academia',    label: 'Academia XCIEN',   icon: '🎓', group: 'Capital Humano' },
  { id: 'sala_juntas', label: 'Sala de Juntas',   icon: '📅', group: 'Capital Humano' },

  // ── Planeación ─────────────────────────────────────────────────────────────
  { id: 'plan2026',  label: 'Plan 2026 · ClickUp',  icon: '🎯', group: 'Planeación' },
  { id: 'proyectos', label: 'Tablero de Proyectos', icon: '📊', group: 'Planeación' },
  { id: 'fibra',       label: 'Fibra Óptica X100',    icon: '🔆', group: 'Planeación' },
  { id: 'radiobases', label: 'Radio Bases',          icon: '📡', group: 'Planeación' },
  { id: 'iblack',    label: 'iBlack · Producto',    icon: '🖤', group: 'Planeación' },

  // ── IA & Automatización ────────────────────────────────────────────────────
  { id: 'cerebro',       label: 'Infraestructura IA', icon: '🧠', group: 'IA & Automatización' },
  { id: 'agentes',       label: 'Agentes IA',         icon: '🤖', group: 'IA & Automatización' },
  { id: 'transacciones', label: 'Tokens Unificados',  icon: '🔗', group: 'IA & Automatización' },
  { id: 'merkle',        label: 'Merkle Feed',        icon: '⛓️', group: 'IA & Automatización' },
  { id: 'token-ai',      label: 'Consumo de Tokens',  icon: '📈', group: 'IA & Automatización' },

  // ── Sistema [colapsado por defecto] ────────────────────────────────────────
  { id: 'analytics',  label: 'Analytics de Uso', icon: '📊', group: 'Sistema' },
  { id: 'reportlab',  label: 'PDF Generator',    icon: '📄', group: 'Sistema' },
  { id: 'backup',     label: 'Migración',        icon: '💾', group: 'Sistema' },
  { id: 'editor',     label: 'Configuración',    icon: '🎨', group: 'Sistema' },
  { id: 'superadmin',     label: 'Super Admin',       icon: '🔐', group: 'Sistema' },
  { id: 'usuarios-admin',     label: 'Gestión de Usuarios',  icon: '👥', group: 'Sistema' },
  { id: 'usuarios-invitados', label: 'Usuarios Invitados',   icon: '🎟️', group: 'Sistema' },
  { id: 'atc-efectividad',   label: 'Efectividad ATC',       icon: '📞', group: 'Sistema' },
];

// ── Lucide icon map ───────────────────────────────────────────────────────────
const NAV_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  inicio: Home,
  noc: Radio,
  red: Network,
  wfm: Settings,
  bidrillas: Truck,
  call: Phone,
  scan: Package,
  'inv-transfers': ArrowLeftRight,
  academia: GraduationCap,
  transacciones: Link2,
  merkle: GitBranch,
  gerencia: BarChart2,
  ventas: TrendingUp,
  'reportes-kpi': Activity,
  reports: FileText,
  reportlab: FileText,
  docs: BookOpen,
  rrhh: User,
  sala_juntas: Calendar,
  adopcion: Users,
  incidentes: AlertTriangle,
  agentes: Bot,
  bridge: Zap,
  telegram: Bell,
  backup: Database,
  editor: Settings2,
  tokens: Link2,
  etiquetas: Package,
};

const SECTION_TITLE: Record<SectionId, string> = {
  inicio: 'Hub Principal',
  noc: 'NOC VIRTUAL',
  red: 'Mapa de Red',
  wfm: 'Control Operativo',
  bidrillas: 'Equipos de Campo',
  call: 'Call Center',
  scan: 'Inventario & Scanner',
  tokens: 'Transacciones & Tokens',
  transacciones: 'Tokens Unificados',
  etiquetas: 'Etiquetas & Comprobantes',
  adopcion: 'Gestión de Usuarios',
  academia: brand.academiaLabel,
  gerencia: 'Dashboard Gerencial',
  ventas:   'Resumen de Ventas',
  'reportes-kpi': 'KPI Dashboard Ejecutivo',
  reports: 'Reportes & Gobierno',
  reportlab: 'PDF Generator',
  bridge: 'Antigravity Data Bridge',
  incidentes: 'Gestor de Incidentes de Red',
  telegram: 'Monitor de Alarmas',
  docs: 'Biblioteca Documental',
  rrhh: 'Recursos Humanos',
  sala_juntas: 'Sala de Juntas',
  backup: 'Migración & Redundancia',
  editor: 'Configuración',
  agentes: 'Agentes IA',
  comite: 'Comité de Dirección',
  'token-ai': 'Consumo de Tokens AI',
  plan2026:  'Plan de Trabajo 2026',
  proyectos: 'Tablero de Proyectos',
  fibra:       'Fibra Óptica X100',
  fibra_xcien: 'Fibra Óptica XCIEN',
  radiobases: 'Radio Bases XCIEN',
  iblack:     'iBlack · Zona de Cliente + Cuadrillas',
  'infra-energia': 'Infraestructura Energía',
  sync: 'Sincronización de Fuentes',
  cerebro: 'Infraestructura IA',
  'inv-transfers': 'Transferencias de Inventario',
  merkle: 'Merkle Feed',
  estrategia2030: 'Estrategia 2030',
  superadmin: 'Super Admin',
  holo: 'Academia Holográfica',
  integridad: 'Integridad Comercial',
  analytics:  'Analytics de Uso',
  cast:       'ATC NOC',
  helpdesk:   'Mesa de Ayuda',
  net2phone:     'Net2Phone Call Center',
  'usuarios-admin':     'Gestión de Usuarios',
  'usuarios-invitados': 'Usuarios Invitados',
  // Módulos previamente sin entrada — redirigían a inicio al hacer click
  'mesa-ops':        'Mesa de Operaciones',
  flotilla:          'Flotilla GPS',
  blackstone:        'Blackstone · PDN',
  'auditoria-odoo':  'Auditoría Odoo',
  'auditorias-plazas': 'Auditorías de Plazas',
  'odoo-docs':       'Guías Odoo',
  'ventas-efectividad': 'Efectividad Ventas',
  'atc-efectividad': 'Efectividad ATC',
  impacto:           'Reporte de Impacto',
};

// ── UISP color constants ──────────────────────────────────────────────────────
const U = {
  bg: '#0d1117',
  sidebar: '#141921',
  header: '#0f1520',
  accent: '#00aff0',
  border: 'rgba(255,255,255,0.06)',
  text: '#e2e8f0',
  dim: '#64748b',
  muted: '#94a3b8',
  card: '#1a2234',
  active: 'rgba(0,175,240,0.08)',
};

// ── Sidebar ───────────────────────────────────────────────────────────────────
interface SidebarProps {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  theme: ThemeConfig;
  backendStatus: 'online' | 'offline';
  collapsed: boolean;
  onToggleCollapse: () => void;
  nav: NavEntry[];
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  activeThemeId: string;
  onApplyPreset: (p: PresetTheme) => void;
}

const COLLAPSED_BY_DEFAULT = new Set(['Sistema']);

function Sidebar({ active, onSelect, theme, backendStatus, collapsed, onToggleCollapse, nav, isMobile, mobileOpen, onMobileClose, activeThemeId, onApplyPreset }: SidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(COLLAPSED_BY_DEFAULT);
  // Alias que reemplaza a U hardcodeado — responde al tema activo
  const SB = {
    sidebar: theme.sidebar,
    border:  theme.border,
    text:    theme.text,
    dim:     theme.dim,
    accent:  theme.accent,
    muted:   theme.dim,
    active:  `${theme.accent}14`,
    card:    theme.card,
  };

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  const groups = useMemo(() => {
    const grouped: { label: string | null; items: NavEntry[] }[] = [];
    let current: NavEntry[] = [];
    let currentLabel: string | null = null;
    for (const entry of nav) {
      if (entry.group !== currentLabel) {
        if (current.length) grouped.push({ label: currentLabel, items: current });
        currentLabel = entry.group ?? null;
        current = [];
      }
      current.push(entry);
    }
    if (current.length) grouped.push({ label: currentLabel, items: current });
    return grouped;
  }, [nav]);

  const mobileStyle: React.CSSProperties = isMobile ? {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: 0,
    width: 250,
    maxWidth: '82vw',
    transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
    boxShadow: mobileOpen ? '4px 0 24px rgba(0,0,0,0.4)' : 'none',
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)',
  } : {};
  const effCollapsed = isMobile ? false : collapsed;

  return (
    <>
    {isMobile && mobileOpen && (
      <div
        onClick={onMobileClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 199 }}
      />
    )}
    <div style={{
      width: isMobile ? 250 : (collapsed ? 56 : 220),
      flexShrink: 0,
      background: SB.sidebar,
      borderRight: `1px solid ${SB.border}`,
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden',
      position: 'relative',
      zIndex: 200,
      ...mobileStyle,
    }}>
      {/* Logo bar */}
      <div style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '0 16px',
        borderBottom: `1px solid ${SB.border}`,
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
        <img src={brand.logo} alt={brand.name} style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }} />
        {(!collapsed || isMobile) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: SB.text, letterSpacing: -0.3 }}>{brand.name}</span>
            <span style={{
              color: SB.accent, fontSize: 9, fontWeight: 700,
              background: 'rgba(0,175,240,0.12)',
              padding: '2px 5px', borderRadius: 3, letterSpacing: 0.5,
            }}>{brand.version}</span>
          </div>
        )}
        </div>
        {isMobile && (
          <button
            onClick={onMobileClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, flexShrink: 0,
              background: 'transparent', border: 'none', color: SB.dim, cursor: 'pointer',
            }}
            title="Cerrar menú"
          >
            <CloseIcon size={18} />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 0' }}>
        {groups.map(({ label, items }) => {
          const isGroupCollapsed = label ? collapsedGroups.has(label) : false;
          return (
          <div key={label ?? '__root__'}>
            {/* Group separator / label */}
            {label && (
              collapsed && !isMobile
                ? <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '6px 8px' }} />
                : <button
                    onClick={() => toggleGroup(label)}
                    style={{
                      width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                      padding: '10px 16px 3px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}
                  >
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      letterSpacing: 1.5,
                      color: SB.dim,
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}>{label}</span>
                    <span style={{ color: SB.dim, fontSize: 10, marginTop: 1 }}>
                      {isGroupCollapsed ? '▸' : '▾'}
                    </span>
                  </button>
            )}

            {!isGroupCollapsed && items.map(item => {
              const Icon = NAV_ICONS[item.id] || LayoutGrid;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { onSelect(item.id); if (isMobile && onMobileClose) onMobileClose(); }}
                  title={effCollapsed ? item.label : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: effCollapsed ? 'center' : 'flex-start',
                    gap: 10,
                    width: '100%',
                    padding: effCollapsed ? '10px 0' : (isMobile ? '12px 14px' : '8px 14px'),
                    background: isActive ? SB.active : 'transparent',
                    borderTop: 'none',
                    borderRight: 'none',
                    borderBottom: 'none',
                    borderLeft: isActive ? `2px solid ${SB.accent}` : '2px solid transparent',
                    color: isActive ? SB.accent : SB.muted,
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    letterSpacing: 0.1,
                  }}
                  onMouseEnter={e => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                  }}
                  onMouseLeave={e => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <Icon size={isMobile ? 17 : 15} strokeWidth={isActive ? 2.2 : 1.8} />
                  {!effCollapsed && (
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: isMobile ? 13 : 12 }}>
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${SB.border}`, flexShrink: 0 }}>
        {/* User */}
        {!effCollapsed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px',
            borderBottom: `1px solid ${SB.border}`,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: SB.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 10, color: '#0d1117', flexShrink: 0,
            }}>JM</div>
            <div style={{ overflow: 'hidden', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: SB.text, whiteSpace: 'nowrap' }}>{brand.adminLabel}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: backendStatus === 'online' ? '#22c55e' : '#ef4444',
                }} />
                <span style={{ fontSize: 9, color: SB.dim }}>
                  {backendStatus === 'online' ? 'Conectado' : 'Sin conexión'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Theme picker */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: effCollapsed ? 'center' : 'space-between',
          padding: effCollapsed ? '8px 0' : '8px 14px',
          borderBottom: `1px solid ${SB.border}`,
        }}>
          {!effCollapsed && (
            <span style={{ fontSize: 9, fontWeight: 700, color: SB.dim, letterSpacing: 1, textTransform: 'uppercase' }}>
              Tema
            </span>
          )}
          <div style={{ display: 'flex', gap: 5, flexWrap: effCollapsed ? 'nowrap' : 'nowrap', justifyContent: effCollapsed ? 'center' : 'flex-end' }}>
            {PRESET_THEMES.map(p => (
              <button
                key={p.id}
                title={p.name}
                onClick={() => onApplyPreset(p)}
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: p.preview.accent,
                  border: activeThemeId === p.id
                    ? `2px solid ${p.preview.text}`
                    : '2px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                  outline: activeThemeId === p.id ? `1px solid ${p.preview.accent}` : 'none',
                  outlineOffset: 1,
                  transition: 'transform 0.12s',
                  transform: activeThemeId === p.id ? 'scale(1.25)' : 'scale(1)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.3)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = activeThemeId === p.id ? 'scale(1.25)' : 'scale(1)'; }}
              />
            ))}
          </div>
        </div>

        {/* Collapse toggle — no aplica en móvil, ahí se cierra con el backdrop o la X */}
        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-end',
              gap: 6,
              width: '100%',
              padding: collapsed ? '12px 0' : '10px 14px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: SB.dim,
              fontSize: 11,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = SB.text}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = SB.dim}
          >
            {collapsed
              ? <ChevronRight size={15} />
              : <><span>Colapsar</span><ChevronLeft size={15} /></>
            }
          </button>
        )}
      </div>
    </div>
    </>
  );
}

// ── Error Boundary ────────────────────────────────────────────────────────────
type EBProps = { children: React.ReactNode; section: string };
type EBState = { error: Error | null };

class SectionErrorBoundary extends React.Component<EBProps, EBState> {
  constructor(props: EBProps) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: EBProps) {
    if (prev.section !== this.props.section && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 40, flexDirection: 'column', gap: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#ff3366', fontFamily: 'monospace' }}>
            ERROR EN SECCIÓN: {this.props.section.toUpperCase()}
          </div>
          <pre style={{
            background: 'rgba(255,51,102,0.08)', border: '1px solid rgba(255,51,102,0.3)',
            borderRadius: 10, padding: '16px 20px', fontSize: 11, color: '#fca5a5',
            maxWidth: 700, overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace',
          }}>
            {this.state.error.message}{'\n\n'}{this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Suspense fallback ─────────────────────────────────────────────────────────
function SectionSpinner() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#555', fontSize: 13 }}>
      <div style={{ width: 16, height: 16, border: '2px solid #00A651', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Cargando sección...
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── Main Content ──────────────────────────────────────────────────────────────
interface ContentProps {
  section: SectionId;
  theme: ThemeConfig;
  activeThemeId: string;
  onThemeChange: (p: Partial<ThemeConfig>) => void;
  onThemeReset: () => void;
  onApplyPreset: (preset: PresetTheme) => void;
  cities: NOCCity[];
  alerts: NOCAlert[];
  activeTenantId: string | null;
  onTenantChange: (id: string | null) => void;
  bridgeData: any;
  onNocRefresh?: () => void;
}

function Content({
  section, rol, theme, activeThemeId, onThemeChange, onThemeReset, onApplyPreset,
  cities, alerts, activeTenantId, onTenantChange, bridgeData, onNocRefresh, backendStatus, odooStatus, observiumStatus, onSelect
}: ContentProps & { rol: string; backendStatus: 'online' | 'offline', odooStatus: 'conectado' | 'desconectado', observiumStatus: 'conectado' | 'desconectado', onSelect: (id: SectionId) => void }) {
  const isMobile = useIsMobile();
  // SectionGate — si el rol no tiene acceso a esta sección, muestra pantalla de acceso denegado
  if (!canAccess(rol, section)) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12, color: '#8B949E', background: theme.bg }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#E6EDF3' }}>Acceso restringido</div>
        <div style={{ fontSize: 13 }}>Tu rol <strong>{rol}</strong> no tiene acceso a esta sección.</div>
        <button onClick={() => onSelect('inicio')}
          style={{ marginTop: 8, padding: '8px 20px', borderRadius: 8, background: '#009A5A',
            color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
          Ir al inicio
        </button>
      </div>
    );
  }
  const padding = isMobile ? 16 : (theme.compact ? 20 : 32);
  const isFullHeight = section === 'red' || section === 'noc';
  return (
    <div style={{
      flex: 1, overflowY: isFullHeight ? 'hidden' : 'auto',
      padding: isFullHeight ? 0 : padding,
      background: theme.bg, minWidth: 0, width: '100%',
      display: 'flex', flexDirection: 'column',
      paddingBottom: isFullHeight ? 0 : `calc(${padding}px + env(safe-area-inset-bottom))`,
    }}>
      <Suspense fallback={<SectionSpinner />}>
      {section === 'inicio'   && <InicioRol theme={theme} onNavigate={onSelect} backendStatus={backendStatus} odooStatus={odooStatus} observiumStatus={observiumStatus} />}
      {section === 'impacto'  && <ImpactoSection />}
      {section === 'noc' && (
        <NocSection
          theme={theme}
          activeThemeId={activeThemeId}
          cities={cities}
          alerts={alerts}
          activeTenantId={activeTenantId}
          onTenantChange={onTenantChange}
          onRefresh={onNocRefresh}
        />
      )}
      {section === 'cast'         && <CastSection />}
      {section === 'mesa-ops'     && <MesaOperacionesSection />}
      {section === 'infra-energia' && <InfraEnergiaSection theme={theme} />}
      {section === 'red'      && <RedSection      theme={theme} />}
      {section === 'sync'     && <SyncSection />}
      {section === 'academia' && <AcademiaSection theme={theme} activeThemeId={activeThemeId} />}
      {section === 'wfm'      && <WFMSection      theme={theme} activeThemeId={activeThemeId} />}
      {section === 'bidrillas' && <BidrillasSection theme={theme} />}
      {section === 'rrhh'      && <RRHHSection      theme={theme} />}
      {section === 'sala_juntas' && <SalaJuntasSection theme={theme} />}
      {section === 'agentes'   && <AgentesSection   theme={theme} />}
      {section === 'comite'    && <ComiteSection    theme={theme} />}
      {section === 'token-ai'  && <TokenConsumptionSection theme={theme} />}
      {section === 'plan2026'  && <ProyectosDashboardSection />}
      {section === 'proyectos' && <ProyectosSection theme={theme} />}
      {section === 'fibra'       && <FibraSection theme={theme} />}
      {section === 'radiobases' && <RadioBasesSection theme={theme} />}
      {section === 'estrategia2030' && <Estrategia2030Section theme={theme} />}
      {section === 'adopcion' && <AdopcionSection theme={theme} />}
      {section === 'call'     && <CallCenterHubSection />}
      {section === 'scan'          && <InventarioSection theme={theme} />}
      {section === 'etiquetas'     && <InventarioSection theme={theme} initialTab="etiquetas" />}
      {section === 'inv-transfers' && <InventarioTransfersSection theme={theme} />}
      {section === 'blackstone'     && <BlackstoneOSSection theme={theme} />}
      {section === 'fibra_xcien'    && <FibraXCIENSection   theme={theme} />}

      {section === 'auditoria-odoo'    && <AuditoriaOdooSection   theme={theme} />}
      {section === 'auditorias-plazas' && <AuditoriasPlazasSection theme={theme} />}
      {section === 'odoo-docs'      && <OdooDocsSection theme={theme} />}
      {section === 'flotilla'       && <FlotillaSection theme={theme} />}
      {section === 'iblack'         && <IBlackSection theme={theme} />}
      {section === 'gerencia' && <Gerencia />}
      {section === 'ventas'              && <VentasSection theme={theme} />}
      {section === 'ventas-efectividad'  && <VentasEfectividadSection />}
      {section === 'integridad' && <IntegridadSection theme={theme} />}
      {section === 'analytics'  && <AnalyticsSection />}
      {section === 'helpdesk'   && <HelpdeskSection />}
      {section === 'net2phone'  && <Net2PhoneSection />}
      {section === 'reportes-kpi' && <ReportesKPISection theme={theme} />}
      {section === 'reports' && <ReportesGobierno />}
      {section === 'reportlab' && <ReportLabSection theme={theme} />}
      {section === 'superadmin'     && <SuperAdminSection    theme={theme} />}
      {section === 'cerebro'        && <CerebroSection       theme={theme} />}
      {section === 'usuarios-admin'     && <UsuariosAdminSection />}
      {section === 'usuarios-invitados' && <UsuariosInvitadosSection theme={theme} />}
      {section === 'atc-efectividad'   && <ATCEfectividadSection   theme={theme} />}

      {section === 'bridge' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', maxHeight: 'calc(100vh - 140px)' }}>
          <div style={{ padding: 20, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: theme.radius }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: theme.accent, marginBottom: 4 }}>⚡ ANTIGRAVITY BRIDGE</h2>
            <p style={{ fontSize: 13, color: theme.dim }}>Terminal de ejecución en tiempo real y recepción de órdenes.</p>
          </div>

          <div style={{
            flex: 1, background: '#000', border: `1px solid ${theme.accent}40`, borderRadius: 12,
            padding: 20, fontFamily: 'monospace', fontSize: 13, overflowY: 'auto',
            boxShadow: `0 0 30px ${theme.accent}10`, position: 'relative'
          }}>
            <div style={{ color: theme.accent, marginBottom: 10 }}>[SISTEMA] Puente establecido. Escuchando...</div>
            <div style={{ color: theme.text, whiteSpace: 'pre-wrap' }}>
              {`> Estado: trabajando en ${bridgeData.current_task}\n`}
              {`> Ultima actualización: ${bridgeData.last_update}\n\n`}
              {bridgeData.log.map((line: string, i: number) => (
                <div key={i} style={{ color: i === bridgeData.log.length - 1 ? theme.accent : '#888', marginBottom: 4 }}>
                  {`[${i}] ${line}`}
                </div>
              ))}
              <div style={{ color: theme.accent, marginTop: 10, animation: 'pulse 1s infinite' }}>_</div>
            </div>
          </div>

          <div style={{ background: '#111', border: `2px solid ${theme.accent}`, borderRadius: 12, padding: '16px 20px', boxShadow: `0 0 20px ${theme.accent}20` }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: theme.accent, marginBottom: 8, letterSpacing: '0.1em' }}>TERMINAL DE COMANDOS (Escribe aquí)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: theme.accent, fontSize: 20, fontWeight: 900 }}>{'>'}</span>
              <input
                id="bridge-input-main"
                autoFocus
                placeholder="Escribe tu orden para Antigravity..."
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const el = e.currentTarget;
                    const val = el.value;
                    if (!val) return;
                    el.value = 'Enviando...';
                    el.disabled = true;
                    try {
                      await fetch(`${API_BASE}/api/bridge/command`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command: val, context: 'bridge' })
                      });
                      el.value = '✅ Orden recibida — di "EJECUTA" en el chat';
                      setTimeout(() => { el.value = ''; }, 3000);
                    } catch (err) {
                      el.value = '❌ Error de conexión';
                      setTimeout(() => { el.value = ''; }, 3000);
                    }
                    el.disabled = false;
                    el.focus();
                  }
                }}
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  color: '#fff', outline: 'none', fontSize: 16, fontWeight: 500,
                  fontFamily: 'monospace'
                }}
              />
            </div>
          </div>
        </div>
      )}

      {section === 'incidentes' && (
        <Suspense fallback={<SectionSpinner />}>
          <IncidentesSection theme={theme} />
        </Suspense>
      )}

      {section === 'telegram' && <TelegramBotSection theme={theme} />}
      {section === 'docs' && <DocsSection theme={theme} />}
      {section === 'backup' && <BackupSection theme={theme} />}
      {section === 'transacciones' && <XcienTokensSection theme={theme} />}
      {section === 'tokens'        && <XcienTokensSection theme={theme} />}
      {section === 'merkle'        && <MerkleFeedSection theme={theme} />}
      {section === 'editor' && (
        <DevPanel
          theme={theme}
          activeThemeId={activeThemeId}
          onChange={onThemeChange}
          onApplyPreset={onApplyPreset}
          onReset={onThemeReset}
        />
      )}
      </Suspense>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────


export default function Xcien2Page() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  // embed=1 → running inside native macOS app; hide the web sidebar
  const embedMode = new URLSearchParams(window.location.search).get('embed') === '1';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [pwdStatus, setPwdStatus] = useState<'idle'|'loading'|'ok'|'error'>('idle');
  const [pwdError, setPwdError] = useState('');
  const { notificaciones, noLeidas, marcarLeida, marcarTodasLeidas, limpiar } = useNotificaciones();
  const [bridgeData, setBridgeData] = useState({ current_task: 'Inactivo', status: 'idle', log: [], last_update: '' });
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline'>('offline');
  const [odooStatus, setOdooStatus] = useState<'conectado' | 'desconectado'>('desconectado');
  const [observiumStatus, setObserviumStatus] = useState<'conectado' | 'desconectado'>('desconectado');
  const rol = user?.rol ?? 'readonly';
  const navFiltrado = useMemo(() => NAV.filter(e => canAccess(rol, e.id)), [rol]);
  const { trackSection, track } = useAnalytics();

  const [section, setSection] = useState<SectionId>(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('section') as SectionId;
    return (s && SECTION_TITLE[s]) ? s : 'inicio';
  });
  const presenceOthers = usePresence(section);

  const checkBackend = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        setBackendStatus('online');
        const data = await res.json();
        if (data.odoo) setOdooStatus(data.odoo === 'conectado' ? 'conectado' : 'desconectado');
        if (data.observium) setObserviumStatus(data.observium === 'conectado' ? 'conectado' : 'desconectado');
      } else {
        setBackendStatus('offline');
      }
    } catch { setBackendStatus('offline'); }
  }, []);

  useEffect(() => { checkBackend(); }, [checkBackend]);
  useVisibleInterval(checkBackend, 10000);

  const fetchBridge = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/bridge`);
      if (res.ok) setBridgeData(await res.json());
    } catch { }
  }, []);
  useEffect(() => { fetchBridge(); }, [fetchBridge]);
  useVisibleInterval(fetchBridge, 3000);

  const [theme, dispatch] = useReducer(themeReducer, DEFAULT_THEME, (initial) => {
    try {
      const saved = localStorage.getItem('app_theme');
      return saved ? { ...initial, ...JSON.parse(saved) } : initial;
    } catch { return initial; }
  });
  const [activeThemeId, setActiveThemeId] = useState('xcien');

  // NOC State
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [realCities, setRealCities] = useState<NOCCity[]>([]);
  const [realAlerts, setRealAlerts] = useState<NOCAlert[]>([]);

  const loadRealData = useCallback(async () => {
    try {
      const [cities, alerts] = await Promise.all([getRealCities(), getRealAlerts()]);
      if (cities) setRealCities(cities);
      if (alerts) setRealAlerts(alerts);
    } catch (e) { console.error("Error loading NOC data in Holo:", e); }
  }, []);

  const refreshNOC = useCallback(async () => {
    invalidateNOCCache();
    await loadRealData();
  }, [loadRealData]);

  useEffect(() => { loadRealData(); }, [loadRealData]);
  useVisibleInterval(loadRealData, 30_000);

  // Global Cmd+K shortcut for command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen(p => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const patchTheme = useCallback((patch: Partial<ThemeConfig>) => dispatch({ type: 'patch', payload: patch }), []);
  const resetTheme = useCallback(() => { dispatch({ type: 'reset' }); setActiveThemeId('xcien'); }, []);
  const applyPreset = useCallback((preset: PresetTheme) => {
    dispatch({ type: 'patch', payload: preset.config });
    setActiveThemeId(preset.id);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--app-accent', theme.accent);
    root.style.setProperty('--app-bg', theme.bg);
    root.style.setProperty('--app-card', theme.card);
    root.style.setProperty('--app-border', theme.border);
    root.style.setProperty('--app-text', theme.text);
    root.style.setProperty('--app-dim', theme.dim);
    root.style.setProperty('--app-radius', `${theme.radius}px`);
    root.style.setProperty('--app-font', `${theme.baseFontSize}px`);
    document.body.style.background = theme.bg;
  }, [theme]);

  const location = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('section') as SectionId;
    if (id && id !== section) {
      if (SECTION_TITLE[id]) setSection(id);
      else setSection('inicio');
    }
  }, [location.search, section]);

  const onSelectSection = useCallback((id: SectionId) => {
    trackSection(id, undefined, section);
    setSection(id);
    navigate(`?section=${id}`, { replace: true });
  }, [navigate, section, trackSection]);

  const alertCount = realAlerts.filter(a => a.severity === 'critical' || a.severity === 'warning').length;

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      fontFamily: "'Inter', sans-serif",
      fontSize: theme.baseFontSize,
      color: U.text,
      background: U.bg,
    }}>
      {!embedMode && (
        <Sidebar
          active={section}
          onSelect={onSelectSection}
          theme={theme}
          backendStatus={backendStatus}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(p => !p)}
          nav={navFiltrado}
          isMobile={isMobile}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
          activeThemeId={activeThemeId}
          onApplyPreset={applyPreset}
        />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* UISP-style top header — 48px (+ safe-area iOS en standalone) */}
        <header style={{
          height: 48,
          paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0,
          minHeight: isMobile ? 'calc(48px + env(safe-area-inset-top))' : 48,
          flexShrink: 0,
          padding: isMobile
            ? 'env(safe-area-inset-top) 12px 0 12px'
            : '0 20px',
          borderBottom: `1px solid ${U.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: U.header,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          {/* Left: hamburger (móvil) + breadcrumb + search trigger */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
            {isMobile && (
              <button
                onClick={() => setMobileNavOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 40, height: 40, flexShrink: 0,
                  background: 'rgba(255,255,255,0.04)', border: `1px solid ${U.border}`,
                  borderRadius: 8, color: U.text, cursor: 'pointer', marginRight: 2,
                }}
                title="Abrir menú"
              >
                <Menu size={18} />
              </button>
            )}
            {!isMobile && <span style={{ fontSize: 11, color: U.dim }}>{brand.name} {brand.version}</span>}
            {!isMobile && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)' }}>/</span>}
            <span style={{ fontSize: 12, fontWeight: 600, color: U.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {SECTION_TITLE[section]}
            </span>
            {!isMobile && (
              <button
                onClick={() => setCmdPaletteOpen(true)}
                style={{
                  marginLeft: 12,
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '4px 12px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, cursor: 'pointer', color: U.dim,
                  fontSize: 11, fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                title="Búsqueda global (Cmd+K)"
              >
                <span style={{ opacity: 0.6 }}>🔍</span>
                <span>Buscar…</span>
                <kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 9, fontFamily: 'monospace', color: '#6b7280' }}>⌘K</kbd>
              </button>
            )}
          </div>

          {/* Right: status + alerts + user */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6, flexShrink: 0 }}>
            {/* Backend status — en móvil solo el punto, sin texto, para ahorrar espacio */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: isMobile ? 6 : '4px 10px',
              background: backendStatus === 'online' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${backendStatus === 'online' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
              borderRadius: 20,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: backendStatus === 'online' ? '#22c55e' : '#ef4444',
                boxShadow: backendStatus === 'online' ? '0 0 6px #22c55e' : 'none',
              }} />
              {!isMobile && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: backendStatus === 'online' ? '#22c55e' : '#ef4444',
                  letterSpacing: 0.5,
                }}>
                  {backendStatus === 'online' ? 'EN LÍNEA' : 'OFFLINE'}
                </span>
              )}
            </div>

            {/* Alerts bell */}
            <button
              onClick={() => onSelectSection('noc')}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34,
                background: alertCount > 0 ? 'rgba(239,68,68,0.08)' : 'transparent',
                border: `1px solid ${alertCount > 0 ? 'rgba(239,68,68,0.2)' : 'transparent'}`,
                borderRadius: 8, cursor: 'pointer',
                color: alertCount > 0 ? '#ef4444' : U.dim,
                transition: 'all 0.15s',
              }}
              title="Ver alertas"
            >
              <AlertTriangle size={15} />
              {alertCount > 0 && (
                <div style={{
                  position: 'absolute', top: 3, right: 3,
                  background: '#ef4444', color: '#fff',
                  fontSize: 8, fontWeight: 700,
                  width: 14, height: 14, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${U.header}`,
                }}>{alertCount > 99 ? '99' : alertCount}</div>
              )}
            </button>

            {/* Live pulse — oculto en móvil para no saturar el header */}
            {!isMobile && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px',
                background: 'rgba(0,175,240,0.06)',
                border: '1px solid rgba(0,175,240,0.15)',
                borderRadius: 20,
              }}>
                <Activity size={11} color={U.accent} />
                <span style={{ fontSize: 10, fontWeight: 700, color: U.accent, letterSpacing: 0.5 }}>LIVE</span>
              </div>
            )}

            {/* Notification bell */}
            <button
              onClick={() => setNotifPanelOpen(p => !p)}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34,
                background: notifPanelOpen
                  ? 'rgba(255,183,3,0.12)'
                  : noLeidas > 0 ? 'rgba(255,183,3,0.06)' : 'transparent',
                border: `1px solid ${notifPanelOpen || noLeidas > 0 ? 'rgba(255,183,3,0.25)' : 'transparent'}`,
                borderRadius: 8, cursor: 'pointer',
                color: noLeidas > 0 ? '#FFB703' : U.dim,
                transition: 'all 0.15s',
              }}
              title="Notificaciones"
            >
              {noLeidas > 0 ? <BellRing size={15} /> : <Bell size={15} />}
              {noLeidas > 0 && (
                <div style={{
                  position: 'absolute', top: 3, right: 3,
                  background: '#FFB703', color: '#0d1117',
                  fontSize: 8, fontWeight: 900,
                  width: 14, height: 14, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${U.header}`,
                }}>{noLeidas > 99 ? '99' : noLeidas}</div>
              )}
            </button>

            {/* Presencia — quién más está viendo esta sección */}
            {!isMobile && <PresenceAvatars others={presenceOthers} section={section} />}

            {/* User badge real — en móvil solo el avatar, sin nombre/rol */}
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginLeft: 4 }}>
                {!isMobile && (
                <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#e5e7eb' }}>
                    {user.nombre.split(' ').slice(0, 2).join(' ')}
                  </p>
                  <p style={{ margin: 0, fontSize: 9, color: U.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {user.rol}
                  </p>
                </div>
                )}
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: `linear-gradient(135deg, ${U.accent}, #00ff88)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 900, fontSize: 11, color: '#0d1117',
                  flexShrink: 0, cursor: 'default',
                  border: '2px solid rgba(255,255,255,0.1)',
                }}>
                  {user.nombre.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <button
                  onClick={() => { setPwdForm({ current:'', next:'', confirm:'' }); setPwdStatus('idle'); setPwdError(''); setShowChangePwd(true); }}
                  title="Cambiar contraseña"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 6,
                    background: 'rgba(99,102,241,0.06)',
                    border: '1px solid rgba(99,102,241,0.15)',
                    color: '#818cf8', cursor: 'pointer', fontSize: 13,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.14)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.06)'; }}
                >
                  🔑
                </button>
                <button
                  onClick={logout}
                  title="Cerrar sesión"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 6,
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.15)',
                    color: '#ef4444', cursor: 'pointer', fontSize: 13,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.14)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.06)'; }}
                >
                  ⏻
                </button>
              </div>
            )}
          </div>
        </header>

        <SectionErrorBoundary section={section}>
          <Content
            section={section}
            rol={rol}
            theme={theme}
            activeThemeId={activeThemeId}
            onThemeChange={patchTheme}
            onThemeReset={resetTheme}
            onApplyPreset={applyPreset}
            cities={realCities}
            alerts={realAlerts}
            activeTenantId={activeTenantId}
            onTenantChange={setActiveTenantId}
            bridgeData={bridgeData}
            onNocRefresh={refreshNOC}
            backendStatus={backendStatus}
            odooStatus={odooStatus}
            observiumStatus={observiumStatus}
            onSelect={onSelectSection}
          />
        </SectionErrorBoundary>
      </div>

      {/* Notificaciones Panel */}
      <NotificacionesPanel
        open={notifPanelOpen}
        notificaciones={notificaciones}
        noLeidas={noLeidas}
        onClose={() => setNotifPanelOpen(false)}
        onMarcarLeida={marcarLeida}
        onMarcarTodasLeidas={marcarTodasLeidas}
        onLimpiar={limpiar}
        onNavigate={(id) => { onSelectSection(id); setNotifPanelOpen(false); }}
      />

      {/* Feedback Widget — mejora continua por proceso */}
      <FeedbackWidget
        section={section}
        sectionLabel={SECTION_TITLE[section]}
      />

      {/* Command Palette */}
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        onNavigate={(id) => { onSelectSection(id); setCmdPaletteOpen(false); }}
        secciones={navFiltrado}
      />

      <style>{`
        @keyframes pulse-dot {
          0%,100% { opacity:1; transform:scale(1) }
          50%      { opacity:.5; transform:scale(1.3) }
        }
        @keyframes matrix-scroll {
          0% { background-position: 0 0 }
          100% { background-position: 0 100% }
        }
        .matrix-bg {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(rgba(0,255,65,0.03) 50%, transparent 50%);
          background-size: 100% 4px;
          pointer-events: none; z-index: 100;
          animation: matrix-scroll 20s linear infinite;
        }
        input[type=range] { height: 4px }
        ::-webkit-scrollbar { width:4px }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); border-radius:2px }
        button:focus { outline:none }
      `}</style>
      {/* Matrix theme: hexo-particles 3D + scanline combinados */}
      {/* ── Modal cambiar contraseña ─────────────────────────────────────────── */}
      {showChangePwd && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowChangePwd(false)}>
          <div style={{
            background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16, padding: '28px 32px', width: 360, maxWidth: '90vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#e5e7eb', marginBottom: 6 }}>🔑 Cambiar contraseña</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 20 }}>Ingresa tu contraseña actual y la nueva</div>

            {(['current','next','confirm'] as const).map((f, i) => (
              <div key={f} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9ca3af', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {f === 'current' ? 'Contraseña actual' : f === 'next' ? 'Nueva contraseña' : 'Confirmar nueva'}
                </label>
                <input
                  type="password"
                  value={pwdForm[f]}
                  onChange={e => setPwdForm(p => ({ ...p, [f]: e.target.value }))}
                  placeholder={i === 0 ? '••••••••' : 'Mínimo 8 caracteres'}
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
                    background: 'rgba(255,255,255,0.05)', color: '#e5e7eb',
                    border: '1px solid rgba(255,255,255,0.1)', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}

            {pwdStatus === 'error' && (
              <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
                ⚠ {pwdError}
              </div>
            )}
            {pwdStatus === 'ok' && (
              <div style={{ fontSize: 12, color: '#00ff88', marginBottom: 12, padding: '8px 12px', background: 'rgba(0,255,136,0.08)', borderRadius: 6 }}>
                ✓ Contraseña actualizada correctamente
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowChangePwd(false)} style={{
                flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}>Cancelar</button>
              <button
                disabled={pwdStatus === 'loading'}
                onClick={async () => {
                  if (pwdForm.next !== pwdForm.confirm) { setPwdStatus('error'); setPwdError('Las contraseñas no coinciden'); return; }
                  if (pwdForm.next.length < 8) { setPwdStatus('error'); setPwdError('Mínimo 8 caracteres'); return; }
                  setPwdStatus('loading');
                  try {
                    const token = localStorage.getItem('xcien_token') || '';
                    const r = await fetch(`${API_BASE}/api/auth/change-password`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ current_password: pwdForm.current, new_password: pwdForm.next }),
                    });
                    const d = await r.json();
                    if (r.ok) { setPwdStatus('ok'); setTimeout(() => setShowChangePwd(false), 1500); }
                    else { setPwdStatus('error'); setPwdError(d.detail || 'Error al cambiar contraseña'); }
                  } catch { setPwdStatus('error'); setPwdError('Error de red'); }
                }}
                style={{
                  flex: 2, padding: '9px 0', borderRadius: 8, border: 'none',
                  background: pwdStatus === 'loading' ? '#374151' : '#4f46e5',
                  color: '#fff', cursor: pwdStatus === 'loading' ? 'default' : 'pointer',
                  fontSize: 13, fontWeight: 700,
                }}>
                {pwdStatus === 'loading' ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeThemeId === 'matrix' && (
        <>
          <div className="matrix-bg" />
          <HexoField3D
            mode="ambient"
            accentColor="#00ff41"
            interactive={false}
            opacity={0.18}
            style={{
              position: 'fixed', inset: 0,
              pointerEvents: 'none',
              zIndex: 99,
            }}
          />
        </>
      )}
    </div>
  );
}
