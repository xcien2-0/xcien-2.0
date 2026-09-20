# TASKS — xcien-portal

> Gestionado por el `organizer`. Solo el `organizer` modifica este archivo directamente.
> El loop autónomo usa `task-claim.sh` para reclamar tareas antes de trabajarlas.

## Leyenda
- `[Pending]` — listo para trabajar
- `[In Progress]` — reclamado por una sesión activa
- `[Done]` — completado
- `[Blocked]` — esperando externo

---

## Crítico

### T001 — BacklogSection: commit cambios en progreso
**Estado:** Pending
**Archivos:** `backend/servidor_academia.py`, `src/pages/xcien2/sections/BacklogSection.tsx`
**Qué hacer:** Hay cambios sin commitear en estos dos archivos (endpoint `/api/backlog/comercial` + frontend con drill-down de tickets). Verificar que compilan, correr `npx tsc --noEmit` y hacer commit.
**Agente:** programmer

### T002 — Mapa de Red: Layer Registry Pattern
**Estado:** Pending
**Archivos:** `src/pages/xcien2/sections/RedSection.tsx`
**Qué hacer:** Refactorizar el mapa de red con Layer Registry Pattern. 7 capas identificadas: Fibra, Radioenlaces, Sitios, Alertas, Cobertura, Clientes, Proveedores. Cada capa como objeto `{id, label, icon, fetch, style, toggle}` en un registro central. Ver memory `project_mapa_capas.md`.
**Agente:** frontend-developer
**Prioridad:** MUY IMPORTANTE — retomar

### T003 — Seguridad Portal: revisión + Cloudflare WAF
**Estado:** Pending
**Qué hacer:** Revisión exhaustiva de seguridad del portal. Plan: Cloudflare WAF + Zero Trust (gratis ≤50 usuarios). Ver memory `project_seguridad_portal.md`. El `security-reviewer` debe auditar primero, luego `backend-developer` implementa headers/WAF.
**Agente:** security-reviewer

---

## Alta prioridad

### T004 — FibraSection: campos editables por rol
**Estado:** Pending
**Archivos:** `src/pages/xcien2/sections/FibraSection.tsx` (o equivalente)
**Qué hacer:** Criterio 2 — compromisos + fases editables según rol del usuario logueado. Depende de RBAC existente (JWT + 13 roles).
**Agente:** frontend-developer

### T005 — RBAC Fase 3: TitularPanel.tsx
**Estado:** Pending
**Qué hacer:** Implementar TitularPanel.tsx — panel de acciones por titular de sección. Titulares: Rodrigo Flores=Ops, Mayra Tamez=Academia, Maribel Baldo=Finanzas, Ernesto Villareal=Flotilla, Yuliana=ATC.
**Agente:** frontend-developer

### T006 — RBAC Fase 4: SectionGate
**Estado:** Pending
**Qué hacer:** SectionGate — componente que oculta/deshabilita secciones según rol. Debe usar el sistema JWT ya implementado.
**Agente:** frontend-developer

### T007 — Cuentas beta: crear 5 usuarios en producción
**Estado:** Blocked — espera accesos Odoo TI-2026-001
**Usuarios:** Rodrigo Flores, Mayra Tamez, Maribel Baldo, Ernesto Villareal, Yuliana
**Qué hacer:** Cuando lleguen los accesos Odoo, crear cuentas con roles correctos y coordinar onboarding.

---

## Media prioridad

### T008 — Academia: conectar leaderboard a endpoint real
**Estado:** Pending
**Archivos:** `src/pages/xcien2/sections/AcademiaSection.tsx`
**Qué hacer:** El leaderboard está hardcodeado. Crear endpoint en backend que lea ranking de Odoo eLearning y conectarlo. El `organizer` debe detallar qué campos exponer.
**Agente:** backend-developer

### T009 — Toggle OnNet/OffNet en FibraSection y xcien-mapa-red
**Estado:** Pending
**Qué hacer:** Agregar toggle de visibilidad OnNet/OffNet en la vista de fibra y en el mapa de red. Coordinar entre `FibraSection.tsx` y `RedSection.tsx`.
**Agente:** frontend-developer

### T010 — Bundle: code splitting para Leaflet y Three.js
**Estado:** Pending
**Archivos:** `vite.config.ts`
**Qué hacer:** Leaflet y Three.js cargan siempre aunque no se use el mapa ni la vista holo. Agregar dynamic import / lazy loading. Medir impacto en First Contentful Paint.
**Agente:** programmer

### T011 — FODA y Adopción: advertencia "datos de demo"
**Estado:** Pending
**Archivos:** `src/pages/xcien2/sections/FodaSection.tsx`, `src/pages/xcien2/sections/AdopcionSection.tsx`
**Qué hacer:** Agregar banner visible "Estos datos son de demostración — pendiente conectar fuente real" para no confundir a usuarios beta.
**Agente:** frontend-developer

---

## Baja prioridad / Deuda técnica

### T012 — Backend: dividir servidor_academia.py en routers
**Estado:** Pending
**Qué hacer:** `servidor_academia.py` supera 13,000 líneas. Dividir en routers FastAPI separados por dominio: noc, wfm, inventario, ventas, rrhh, academia, backlog, tokens, telegram. No cambiar comportamiento.
**Agente:** programmer

### T013 — War Room: conectar agentes reales
**Estado:** Pending
**Archivos:** `src/pages/xcien2/index.tsx` (sección War Room inline)
**Qué hacer:** War Room tiene conversación estática. Conectar a `/api/agentes/chat` para ejecutar agentes reales en tiempo real.
**Agente:** backend-developer

### T014 — Nebula: integración monitoreo vía VPN
**Estado:** Blocked — esperando accesos de Hinojosa
**Qué hacer:** Integrar sistema de monitoreo "Nebula" al xcien-portal. El sistema corre en una IP privada accesible vía OpenVPN. Con los accesos, añadir variables al `.env` y crear endpoint `/api/nebula/*` + sección en el portal.
**Contacto:** Hinojosa (XCIEN TI) — solicitar: IP del servidor, archivo .ovpn, credenciales API de Nebula
**Agente:** backend-developer

---

## Completadas

*(ninguna aún — este archivo se creó el 2026-09-19)*
