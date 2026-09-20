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

### T017 — Secciones pendientes: conectar datos reales
**Estado:** Pending — 5 subtareas independientes, reclamables por separado
**Archivos:** `src/pages/xcien2/sections/`
**Contexto:** secciones marcadas "pendiente funcional" en la revisión de 66 secciones del 2026-09-20.

- **T017a — `IntegridadSection.tsx`** — conectar antifraude Odoo: facturas sin PO, pagos sin 2° aprobador. Endpoint nuevo `/api/integridad/*` en `backend/servidor_academia.py`, registrado ANTES del catch-all SPA. **Agente:** backend-developer → frontend-developer.
- **T017b — `AdopcionSection.tsx`** — tracking de uso real del portal: secciones más visitadas por rol. Hoy no existe telemetría; hay que decidir dónde se registran los eventos antes de escribir código. **Agente:** backend-developer → frontend-developer.
- **T017c — `ComiteSection.tsx`** — actas y compromisos de mesa de trabajo. **Falta decisión:** fuente = Odoo, archivo en el repo, o captura manual en el portal. **Agente:** frontend-developer.
- **T017d — `ImpactoSection.tsx`** — métricas reales: tickets cerrados (Odoo CAST), uptime (Nebula), ROI (fórmula pendiente de definir). **Agente:** backend-developer → frontend-developer.
- **T017e — `AuditoriasPlazasSection.tsx`** — plazas foráneas (COA, NL, TAM) con checklist dinámico. **Agente:** frontend-developer.

**Orden recomendado:** T017a → T017d → T017e → T017b → T017c.
**Dependencias:** cada subtarea es backend-primero salvo T017e. T017b se superpone con T011 — si T017b entra primero, T011 queda reducida a FodaSection. T017c está en bloqueo suave hasta la decisión de fuente.

---

## Media prioridad

### T008 — Academia: conectar leaderboard a endpoint real
**Estado:** Pending
**Archivos:** `src/pages/xcien2/sections/AcademiaSection.tsx`
**Qué hacer:** El leaderboard está hardcodeado. Crear endpoint en backend que lea ranking de Odoo eLearning y conectarlo.
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
**Dependencia:** solapa con T017b. Si T017b se hace primero, esta tarea se reduce a FodaSection.

### T016 — AgentesSection: mejoras UI + nuevos agentes
**Estado:** In Progress — 2026-09-20
**Archivos:** `src/pages/xcien2/sections/AgentesSection.tsx`, `backend/servidor_academia.py` (`AGENTS_CATALOG` línea ~3190, `_agent_activity` línea ~3223)
**Qué hacer:**
1. **Backend** — agregar 3 agentes al `AGENTS_CATALOG` (8 → 11): CX Agent (`#EC4899`), Comercial Agent (`#F59E0B`), Flotilla Agent (`#10B981`).
2. **Backend** — `calls_today`: agregar reset diario — hoy el contador es acumulado desde el arranque del proceso, no "de hoy".
3. **Backend** — `last_msg`: cambiar de string a lista de hasta 3 mensajes para historial visible en UI.
4. **Frontend** — subheader con total `8 → 11 agentes`, log de actividad visible (últimas 3 consultas), mejor estado vacío.
**Agente:** backend-developer (1-3) → frontend-developer (4)
**Nota:** backend primero. El frontend necesita el shape del historial antes de tocar la UI.

---

## Baja prioridad / Deuda técnica

### T012 — Backend: dividir servidor_academia.py en routers
**Estado:** Pending
**Qué hacer:** `servidor_academia.py` supera 13,000 líneas. Dividir en routers FastAPI separados por dominio: noc, wfm, inventario, ventas, rrhh, academia, backlog, tokens, telegram. No cambiar comportamiento.
**Agente:** programmer

### T018 — Guías Odoo: rediseño + migrar a Academia
**Estado:** Pending
**Archivos:** `src/pages/xcien2/sections/OdooDocsSection.tsx` (registrada como `section === 'odoo-docs'` en `src/pages/xcien2/index.tsx`)
**Qué hacer:** El contenido es estático. Dos pasos:
1. Rediseño estético de la sección, alineado al sistema de temas del portal.
2. Migrar el contenido a módulos de Academia XCIEN en Odoo 19 eLearning; la sección queda como índice/enlace.
**Agente:** frontend-developer (paso 1) · backend-developer (paso 2, carga en Odoo)
**Dependencia:** el paso 2 necesita acordar a qué curso de Academia van los procesos — coordinar con Mayra Tamez (titular Academia).

### T019 — Simplifier: borrar 7 archivos .tsx huérfanos
**Estado:** Pending
**Archivos:** `src/pages/xcien2/sections/WarRoomSection.tsx`, `MerkleFeedSection.tsx`, `Estrategia2030Section.tsx`, `IBlackSection.tsx`, `XcienTokensSection.tsx`, `TokenConsumptionSection.tsx`, `ReportLabSection.tsx`
**Qué hacer:** Confirmar que ninguno está importado fuera de `index.tsx`, luego borrar. Verificar con grep en todo `src/` antes de borrar.
**Agente:** simplifier

### T020 — Documenter: actualizar tabla de secciones en CLAUDE.md
**Estado:** Pending
**Archivos:** `CLAUDE.md`
**Qué hacer:** La tabla de secciones en `CLAUDE.md` del repo todavía lista secciones removidas (XcienTokens, War Room, ReportLab) como activas. Actualizar para reflejar el estado real: 48 secciones activas + 7 removidas.
**Agente:** documenter

---

## Completadas

### T014 — Nebula: integración monitoreo vía VPN
**Estado:** Done — 2026-09-20
**Nota:** Nebula integrado en Railway production. Operativo dentro de NOC Virtual. Ya no depende de los accesos de Hinojosa.

### T013 — War Room: conectar agentes reales
**Estado:** Done — 2026-09-20
**Nota:** Removida de portal 2026-09-20. La sección War Room salió del portal en la revisión de 66 secciones. Cerrada por remoción, no implementada.

### Revisión de 66 secciones — 7 removidas del portal
**Estado:** Done — 2026-09-20
**Nota:** Removidas: Estrategia 2030, PDF Generator, XcienTokens, TokenConsumption, iBlack, War Room, Merkle Feed.

### NOCBoard: fix de proxy
**Estado:** Done — 2026-09-20
**Nota:** `.env` cambiado de `172.26.11.43:9400` → `localhost:9400`.

---

## Notas de drift (sin tarea asignada — pendiente decisión)

1. **T015 cross-repo.** hub-personal tiene su propio `TASKS.md` en el loop autónomo. hub-personal PM2 ya verificado (2026-09-20): ecosistemas separados, `gmail-meeting-sync` re-registrado, bloqueador real = falta `credentials.json` OAuth de Gmail. No abre tarea aquí para evitar dos fuentes de verdad.
2. **T007 (cuentas beta)** sigue bloqueado. Solicitud Odoo TI-2026-001 sin respuesta conocida.
