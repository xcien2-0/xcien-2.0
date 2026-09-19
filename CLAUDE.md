# xcien-portal — Command Center XCIEN Networks

## Qué es este proyecto
Portal web de operaciones para XCIEN Networks. Centraliza NOC, campo (WFM), inventario, ventas, RRHH, academia y agentes de IA en una sola interfaz. No es solo una app de academia — es un Command Center completo con 25+ secciones.

## Stack
- **Frontend**: React 18 + TypeScript + Vite (puerto 8080 dev)
- **Backend**: FastAPI Python — `backend/servidor_academia.py` (puerto **8002**)
- **Estilos**: Tailwind CSS + shadcn/ui + sistema de temas con CSS variables
- **Datos reales**: Odoo wispi19 (inventario, WFM, RRHH, ventas, academia)
- **Monitoreo**: Observium (NOC alertas) + UISP (dispositivos red)
- **IA**: Claude Sonnet via Anthropic API — agentes y chat flotante
- **PM2**: Process manager para producción (`ecosystem.config.cjs`)

## Puertos
| Servicio | Puerto | Notas |
|---|---|---|
| Frontend (Vite dev) | **8080** | Proxy `/api`, `/academia`, `/static` → 8002 |
| Backend (FastAPI) | **8002** | `uvicorn servidor_academia:app --port 8002` |

> El frontend usa URLs relativas (`API_BASE = ''`). Vite proxea al backend. Funciona desde cualquier dispositivo en la red local.

## Para correr

```bash
# Dev (dos terminales)
npm run dev                          # Frontend en :8080
.venv/bin/python3 backend/servidor_academia.py  # Backend en :8002

# Producción con PM2
pm2 start ecosystem.config.cjs
pm2 logs
pm2 status
```

## Estructura de secciones (`src/pages/xcien2/sections/`)

### Operaciones — datos reales
| Sección | Archivo | Fuente |
|---|---|---|
| NOC Virtual | `NocSection.tsx` | Observium + UISP · polling 30s + SSE MTR |
| Mapa de Red | `RedSection.tsx` | Leaflet + datos NOC |
| Campo WFM | `WFMSection.tsx` | Odoo CAST — tickets, Kanban, comentarios |
| Bidrillas | `BidrillasSection.tsx` | Odoo tasks — mapa con técnicos geocodificados |
| Inventario | `InventarioSection.tsx` | Odoo stock.quant — productos, scanner QR |
| Transferencias | `InventarioTransfersSection.tsx` | token_service backend |
| Tokens Unificados | `XcienTokensSection.tsx` | token_service — audit log |

### Administración — datos reales
| Sección | Archivo | Fuente |
|---|---|---|
| Resumen Ventas | `VentasSection.tsx` | Odoo + CSV Google Sheets (`data/data_ventas.csv`) |
| RRHH | `RRHHSection.tsx` | Odoo hr.employee — directorio y organigrama |
| Sala de Juntas | `SalaJuntasSection.tsx` | Odoo calendar + Google Calendar OAuth |
| Reporte PDF NOC | `ReportLabSection.tsx` | Backend — genera PDF semanal |
| Documentos | `DocsSection.tsx` | Filesystem `Xcien_Docs/` |
| Bot Telegram | `TelegramBotSection.tsx` | `/api/telegram/` |

### Academia — mixto (real + mock)
| Sección | Archivo | Estado |
|---|---|---|
| Academia | `AcademiaSection.tsx` | Cursos/quizzes: Odoo real. Leaderboard/badges: **hardcodeados** |
| Academia Holo | `AcademiaHoloSection.tsx` | Three.js — modo matrix |

### Planeación — datos mock (pendiente conectar fuentes reales)
| Sección | Archivo | Estado |
|---|---|---|
| FODA | `FodaSection.tsx` | Contenido estático — pendiente datos reales |
| Adopción | `AdopcionSection.tsx` | Métricas de demo — pendiente datos reales |

### Infraestructura IA
| Sección | Archivo | Estado |
|---|---|---|
| Agentes IA | `AgentesSection.tsx` | Chat real con Claude via `/api/agentes/chat` |
| Data Bridge | inline `index.tsx` | Terminal visual → `/api/bridge/command` |
| War Room | inline `index.tsx` | Conversación hardcodeada (decorado) |
| Terminal Móvil | inline `index.tsx` | QR dinámico con `window.location.hostname` |

## Página principal: `src/pages/xcien2/index.tsx`
- Sidebar con 25+ secciones agrupadas, colapsable
- `themeReducer` — sistema de temas con presets, persistencia en localStorage
- `SectionErrorBoundary` — cada sección aislada, un error no rompe el portal
- URL-as-state: `?section=id` permite deep-linking directo a cualquier sección
- Polling diferenciado: health 10s, NOC 30s, bridge 3s

## Backend: `backend/servidor_academia.py`
Monolito FastAPI 2000+ líneas. Contiene todos los endpoints:
- `/api/noc/*` — alertas Observium, ciudades, MTR
- `/api/wfm/*` — tickets Odoo CAST, bidrillas
- `/api/inventario/odoo/*` — productos, stock, tránsito lento
- `/api/ventas/*` — MRR, órdenes, sync sheets
- `/api/rrhh/*` — directorio empleados Odoo
- `/api/agentes/*` — chat IA, Director General
- `/api/bridge/*` — bridge multi-agente
- `/api/academia/*` — cursos, exámenes Odoo
- `/api/tokens/*` — sistema de tokens unificados
- `/api/telegram/*` — bot alertas
- `/{full_path:path}` — catch-all SPA (debe ir AL FINAL)

> **IMPORTANTE**: cualquier endpoint nuevo `/api/` debe registrarse ANTES del catch-all SPA en la línea ~5328.

## Scripts de reportes (`backend/`)
```
generar_reporte_transito_lento.py  — Inventario 2+ años sin movimiento → PDF → Telegram
generar_bidrillas_pdf.py           — Reporte bidrillas → PDF → Telegram
generar_foda_pdf.py                — FODA estratégico → PDF
reporte_semanal.py                 — Reporte NOC semanal → PDF → Telegram
```

## Variables de entorno requeridas
```
ANTHROPIC_API_KEY=...        # Claude API
ODOO_URL=http://wispi17...   # Odoo instance
ODOO_DB=...
ODOO_USER=...
ODOO_PASSWORD=...
TOKEN_SECRET=...             # JWT para tokens internos
```

## Deuda técnica conocida
- Leaderboard de Academia hardcodeado (no llama a ningún endpoint)
- War Room: conversación estática, no ejecuta agentes reales
- ~~Sin autenticación en el frontend~~ — **Implementada**: JWT + RBAC 13 roles, 401 interceptor, rate limiting login
- `servidor_academia.py` debería dividirse en routers FastAPI separados
- Secciones FODA y Adopción muestran datos de demo sin advertencia visual
- Bundle sin code splitting (Leaflet, Three.js cargan siempre)

## Agentes BMAD (instalado 2026-06-13)
`/bmad-pm` `/bmad-architect` `/bmad-dev` `/bmad-qa` `/bmad-sm` `/bmad-analyst` `/bmad-ux-expert`

## Port Registry
Ver `~/Proyectos/PORT_REGISTRY.md` — registro canónico de puertos de todos los proyectos.

## Remote Trigger
`trig_01A1VdoN9yfwyoUFWChXbn3g` — Director General xcien-portal
