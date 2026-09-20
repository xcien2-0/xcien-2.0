#!/usr/bin/env python3
"""
tars_brain.py — Sincronizador Obsidian × Odoo × XCIEN

Corre nightly (2am via PM2 cron). Lee Odoo y las notas del vault XCIEN y
genera snapshots de markdown en XCIEN-Vault/00-Cerebro/. El backend carga
contexto-maestro.md al arrancar y lo inyecta en cada conversación de Claude.

Flujo:
    Odoo (read-only) ──┐
    XCIEN-Vault/       ├──► tars_brain.py ──► 00-Cerebro/contexto-maestro.md
    Claude memory      ┘                            │
                                                    ▼
                                         backend/cerebro.py lo lee
                                         y lo inyecta en Claude chat
"""
from __future__ import annotations
import os, sys, json, signal, re, textwrap
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

VAULT_PATH   = Path(os.environ.get(
    "XCIEN_VAULT_PATH",
    str(Path.home() / "Documents" / "xcien" / "XCIEN-Vault")
))
CEREBRO_DIR  = VAULT_PATH / "00-Cerebro"
MASTER_FILE  = CEREBRO_DIR / "contexto-maestro.md"

ENV_FILE     = Path(__file__).parent / ".env"
TIMESTAMP    = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

# ── Load .env ────────────────────────────────────────────────────────────────

def _load_env() -> dict:
    env = {}
    if not ENV_FILE.exists():
        return env
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

# ── Odoo connection ───────────────────────────────────────────────────────────

def _odoo_connect(env: dict):
    import xmlrpc.client
    HOST = env.get("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
    DB   = env.get("ODOO_DB", "wispi19")
    USER = env.get("ODOO_USER", "")
    PASS = env.get("ODOO_PASSWORD", "")
    if not USER or not PASS:
        return None, None, None, None, None
    common = xmlrpc.client.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
    try:
        uid = common.authenticate(DB, USER, PASS, {})
    except Exception:
        return None, None, None, None, None
    models = xmlrpc.client.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)
    return models, uid, DB, PASS, HOST

def _sr(models, uid, db, pw, model, domain=None, fields=None, limit=200, timeout=25):
    domain = domain or []
    fields = fields or ["id", "name"]
    signal.alarm(timeout)
    try:
        return models.execute_kw(db, uid, pw, model, "search_read",
                                 [domain], {"fields": fields, "limit": limit})
    except TimeoutError:
        return []
    finally:
        signal.alarm(0)

signal.signal(signal.SIGALRM, lambda s, f: (_ for _ in ()).throw(TimeoutError()))

# ── Obsidian vault reader ─────────────────────────────────────────────────────

VAULT_INCLUDE = [
    "04 - Personas y Equipos",
    "01 - Ecosistema",
    "06 - Infraestructura",
    "NOC",
    "Plaza-PDN",
]

def _read_vault_notes(max_chars_per_note=3000) -> dict[str, str]:
    """Lee notas clave del vault. Devuelve {ruta_relativa: contenido_truncado}."""
    notes: dict[str, str] = {}
    for section in VAULT_INCLUDE:
        sec_path = VAULT_PATH / section
        if not sec_path.exists():
            continue
        for md in sec_path.rglob("*.md"):
            rel = str(md.relative_to(VAULT_PATH))
            try:
                text = md.read_text(encoding="utf-8")
                if len(text) > max_chars_per_note:
                    text = text[:max_chars_per_note] + "\n...(truncado)"
                notes[rel] = text
            except Exception:
                pass
    return notes

# ── Odoo data fetchers ────────────────────────────────────────────────────────

def fetch_wfm(models, uid, db, pw) -> str:
    """Tickets CAST abiertos — estado WFM."""
    try:
        tickets = _sr(models, uid, db, pw,
            "project.task",
            [["project_id.name", "ilike", "CAST"],
             ["stage_id.name", "not in", ["Hecho", "Cancelado", "Done", "Cancelled"]]],
            ["name", "stage_id", "user_ids", "date_deadline", "priority", "partner_id"],
            limit=100)
    except Exception:
        return "_Sin datos WFM_\n"

    if not tickets:
        return "Sin tickets abiertos en CAST.\n"

    lines = [f"**{len(tickets)} tickets abiertos en campo (CAST)**\n"]
    by_stage: dict[str, list] = {}
    for t in tickets:
        st = t.get("stage_id", [0, "Sin etapa"])[1]
        by_stage.setdefault(st, []).append(t)

    for st, ts in sorted(by_stage.items(), key=lambda x: -len(x[1])):
        lines.append(f"\n### {st} ({len(ts)})")
        for t in ts[:10]:
            users = ", ".join(u[1] for u in t.get("user_ids", []) if isinstance(u, (list,tuple)))
            deadline = t.get("date_deadline", "")[:10] if t.get("date_deadline") else "—"
            prio = "🔴" if t.get("priority") in ("2","3") else "⚪"
            client = t.get("partner_id", [0, "—"])[1] if t.get("partner_id") else "—"
            lines.append(f"- {prio} [{t['name'][:60]}] · técnico: {users or '—'} · cliente: {client} · vence: {deadline}")

    return "\n".join(lines) + "\n"

def fetch_empleados(models, uid, db, pw) -> str:
    """Directorio de empleados activos."""
    try:
        emps = _sr(models, uid, db, pw,
            "hr.employee",
            [["active", "=", True]],
            ["name", "job_title", "department_id", "work_email", "mobile_phone"],
            limit=300)
    except Exception:
        return "_Sin datos de empleados_\n"

    if not emps:
        return "Sin empleados en el sistema.\n"

    lines = [f"**{len(emps)} empleados activos**\n"]
    by_dept: dict[str, list] = {}
    for e in emps:
        dept = e.get("department_id", [0, "Sin depto"])[1] if e.get("department_id") else "Sin depto"
        by_dept.setdefault(dept, []).append(e)

    for dept, es in sorted(by_dept.items()):
        lines.append(f"\n### {dept}")
        for e in es:
            email = e.get("work_email", "")
            title = e.get("job_title", "")
            lines.append(f"- {e['name']} | {title} | {email}")

    return "\n".join(lines) + "\n"

def fetch_inventario(models, uid, db, pw) -> str:
    """Resumen de inventario — top productos por stock."""
    try:
        quants = _sr(models, uid, db, pw,
            "stock.quant",
            [["location_id.usage", "=", "internal"], ["quantity", ">", 0]],
            ["product_id", "location_id", "quantity", "reserved_quantity"],
            limit=500)
    except Exception:
        return "_Sin datos de inventario_\n"

    if not quants:
        return "Sin stock en inventario.\n"

    from collections import defaultdict
    by_product: dict[str, float] = defaultdict(float)
    for q in quants:
        prod = q.get("product_id", [0, "Desconocido"])[1] if q.get("product_id") else "Desconocido"
        by_product[prod] += q.get("quantity", 0)

    lines = [f"**{len(by_product)} productos en inventario**\n\nTop 30 por cantidad:"]
    for prod, qty in sorted(by_product.items(), key=lambda x: -x[1])[:30]:
        lines.append(f"- {prod}: {qty:,.0f} uds")

    return "\n".join(lines) + "\n"

def fetch_ventas(models, uid, db, pw) -> str:
    """Resumen de ventas — últimos 90 días."""
    from datetime import timedelta
    since = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    try:
        orders = _sr(models, uid, db, pw,
            "sale.order",
            [["date_order", ">=", since], ["state", "in", ["sale", "done"]]],
            ["name", "partner_id", "amount_total", "date_order", "state"],
            limit=300)
    except Exception:
        return "_Sin datos de ventas_\n"

    if not orders:
        return "Sin ventas confirmadas en los últimos 90 días.\n"

    total = sum(o.get("amount_total", 0) for o in orders)
    lines = [
        f"**{len(orders)} órdenes de venta (últimos 90 días)**",
        f"**Total facturado: ${total:,.0f} MXN**\n",
        "Top 10 clientes:",
    ]
    from collections import defaultdict
    by_client: dict[str, float] = defaultdict(float)
    for o in orders:
        client = o.get("partner_id", [0, "Desconocido"])[1] if o.get("partner_id") else "Desconocido"
        by_client[client] += o.get("amount_total", 0)
    for client, amt in sorted(by_client.items(), key=lambda x: -x[1])[:10]:
        lines.append(f"- {client}: ${amt:,.0f}")

    return "\n".join(lines) + "\n"

def fetch_academia(models, uid, db, pw) -> str:
    """Estadísticas de academia eLearning."""
    try:
        cursos = _sr(models, uid, db, pw,
            "slide.channel",
            [["website_published", "=", True]],
            ["name", "members_count", "total_slides"],
            limit=100)
        total_inscritos = models.execute_kw(db, uid, pw,
            "slide.channel.partner", "search_count", [[]], {})
    except Exception:
        return "_Sin datos de academia_\n"

    lines = [f"**{len(cursos)} cursos publicados · {total_inscritos} inscripciones totales**\n"]
    for c in sorted(cursos, key=lambda x: -x.get("members_count", 0))[:15]:
        lines.append(f"- {c['name']}: {c.get('members_count',0)} alumnos, {c.get('total_slides',0)} lecciones")

    return "\n".join(lines) + "\n"

# ── Vault note builder ────────────────────────────────────────────────────────

def _write_snapshot(name: str, title: str, content: str) -> Path:
    path = CEREBRO_DIR / f"{name}.md"
    path.write_text(
        f"# {title}\n_Generado: {TIMESTAMP}_\n\n{content}",
        encoding="utf-8"
    )
    print(f"  ✅ {path.name}")
    return path

def _vault_notes_to_markdown(notes: dict[str, str]) -> str:
    parts = []
    for rel, text in sorted(notes.items()):
        section = Path(rel).parts[0] if "/" in rel or "\\" in rel else "Vault"
        parts.append(f"### 📝 {rel}\n\n{text.strip()}")
    return "\n\n---\n\n".join(parts)

# ── Build master context ──────────────────────────────────────────────────────

def build_master(sections: dict[str, str]) -> str:
    """
    Genera contexto-maestro.md — el archivo que Claude recibe en cada conversación.
    """
    header = textwrap.dedent(f"""
        # Contexto XCIEN Networks — Maestro
        _Actualizado: {TIMESTAMP}_

        Este archivo es el cerebro persistente de XCIEN 2.0.
        Es generado automáticamente por tars_brain.py combinando datos de Odoo y notas del vault Obsidian.
        Claude lo recibe como contexto base en cada conversación del Supercerebro.

    """).lstrip()

    parts = [header]
    order = [
        ("wfm-snapshot",       "## 🔧 Campo WFM — Tickets Activos"),
        ("empleados-snapshot", "## 👤 Directorio de Empleados"),
        ("ventas-snapshot",    "## 💰 Ventas — Últimos 90 Días"),
        ("inventario-snapshot","## 📦 Inventario"),
        ("academia-snapshot",  "## 🎓 Academia"),
        ("vault-notas",        "## 📚 Notas del Vault Obsidian"),
    ]
    for key, heading in order:
        content = sections.get(key, "")
        if content.strip():
            parts.append(f"{heading}\n\n{content.strip()}")

    return "\n\n---\n\n".join(parts) + "\n"

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n🧠 tars_brain.py — {TIMESTAMP}")
    print(f"   Vault: {VAULT_PATH}")
    print(f"   Cerebro dir: {CEREBRO_DIR}\n")

    CEREBRO_DIR.mkdir(parents=True, exist_ok=True)

    env = _load_env()
    models, uid, db, pw, host = _odoo_connect(env)

    sections: dict[str, str] = {}

    # ── Odoo snapshots ────────────────────────────────────────────────────────
    if models and uid:
        print(f"📡 Conectado a Odoo ({host})\n")

        print("  Leyendo WFM…")
        sections["wfm-snapshot"] = fetch_wfm(models, uid, db, pw)
        _write_snapshot("wfm-snapshot", "WFM — Tickets Activos en Campo", sections["wfm-snapshot"])

        print("  Leyendo Empleados…")
        sections["empleados-snapshot"] = fetch_empleados(models, uid, db, pw)
        _write_snapshot("empleados-snapshot", "Directorio de Empleados", sections["empleados-snapshot"])

        print("  Leyendo Ventas…")
        sections["ventas-snapshot"] = fetch_ventas(models, uid, db, pw)
        _write_snapshot("ventas-snapshot", "Ventas — Últimos 90 Días", sections["ventas-snapshot"])

        print("  Leyendo Inventario…")
        sections["inventario-snapshot"] = fetch_inventario(models, uid, db, pw)
        _write_snapshot("inventario-snapshot", "Inventario", sections["inventario-snapshot"])

        print("  Leyendo Academia…")
        sections["academia-snapshot"] = fetch_academia(models, uid, db, pw)
        _write_snapshot("academia-snapshot", "Academia XCIEN", sections["academia-snapshot"])
    else:
        print("⚠️  Sin conexión a Odoo — omitiendo snapshots. Usando solo vault.\n")
        for key in ["wfm-snapshot", "empleados-snapshot", "ventas-snapshot",
                    "inventario-snapshot", "academia-snapshot"]:
            existing = CEREBRO_DIR / f"{key}.md"
            if existing.exists():
                sections[key] = existing.read_text(encoding="utf-8")

    # ── Obsidian vault notes ──────────────────────────────────────────────────
    print("\n  Leyendo notas del vault Obsidian…")
    vault_notes = _read_vault_notes()
    if vault_notes:
        sections["vault-notas"] = _vault_notes_to_markdown(vault_notes)
        note_count = len(vault_notes)
        print(f"  ✅ vault-notas ({note_count} archivos leídos)")
    else:
        sections["vault-notas"] = "_Sin notas del vault disponibles_"
        print("  ⚠️  Sin notas del vault")

    # ── Maestro ───────────────────────────────────────────────────────────────
    print("\n  Generando contexto-maestro.md…")
    master = build_master(sections)
    MASTER_FILE.write_text(master, encoding="utf-8")
    size_kb = MASTER_FILE.stat().st_size / 1024
    print(f"  ✅ contexto-maestro.md ({size_kb:.1f} KB)")

    # ── Resumen en README ─────────────────────────────────────────────────────
    readme = CEREBRO_DIR / "README.md"
    readme.write_text(textwrap.dedent(f"""
        # 00-Cerebro — XCIEN 2.0 Knowledge Base

        Generado por `tars_brain.py` en {TIMESTAMP}.

        ## Archivos
        - **contexto-maestro.md** — contexto consolidado para Claude ({size_kb:.1f} KB)
        - **wfm-snapshot.md** — tickets activos en campo
        - **empleados-snapshot.md** — directorio empleados
        - **ventas-snapshot.md** — ventas últimos 90 días
        - **inventario-snapshot.md** — inventario actual
        - **academia-snapshot.md** — estadísticas academia
        - **vault-notas** — incluido en maestro, no archivo separado

        ## Cómo agregar conocimiento
        Simplemente escribe notas en Obsidian en las carpetas:
        - `04 - Personas y Equipos/` — perfiles, contexto de personas
        - `01 - Ecosistema/` — proyectos, sistemas, integraciones
        - `06 - Infraestructura/` — sitios, radiobases, topología
        - `NOC/` — incidentes, historial de alertas
        - `Plaza-PDN/` — plazas de despliegue

        Al correr `tars_brain.py` de nuevo, tus notas se incluyen en el contexto de Claude.
    """).lstrip(), encoding="utf-8")

    # ── Actualizar SOUL de Hermes con contexto fresco ────────────────────────
    hermes_soul = Path.home() / ".hermes" / "SOUL.md"
    if hermes_soul.exists():
        soul_base = """Eres TARS, el motor de conocimiento operativo de XCIEN Networks.

Respondes en español mexicano. Eres directo, técnico y conciso. Usas bullets y datos concretos. No inventas — si no tienes el dato, lo dices.

Cuando el usuario pregunta sobre el estado operativo de XCIEN, das la información del contexto disponible. Cuando analiza tendencias o estrategia, estructuras la respuesta como: Estado → Hallazgos → Riesgos → Próximo paso.

---

"""
        # Incrusta el contexto maestro completo en el SOUL
        soul_content = soul_base + master
        hermes_soul.write_text(soul_content, encoding="utf-8")
        print(f"  ✅ SOUL de Hermes actualizado ({len(soul_content)//1024:.0f} KB)")
    else:
        print("  ℹ️  Hermes no instalado — SOUL.md no actualizado")

    print(f"\n🎉 Brain sync completo → {CEREBRO_DIR}\n")

if __name__ == "__main__":
    main()
