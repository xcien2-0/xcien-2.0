#!/usr/bin/env python3
"""
Agente Odoo XCIEN — Bot Telegram con Claude + herramientas Odoo (solo lectura)
Ejecutar: python3 agente_odoo.py
"""
import os, time, xmlrpc.client, json, signal, logging, urllib.request, urllib.parse
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv(os.path.expanduser("~/Proyectos/xcien/xcien-portal/backend/.env"))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("agente_odoo")

# ─── Configuración ───────────────────────────────────────────────────────────
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]
ODOO_URL      = os.environ.get("ODOO_URL",  "https://odoo.wispi.mx")
ODOO_DB       = os.environ.get("ODOO_DB",   "wispi17")
ODOO_USER     = os.environ.get("ODOO_USER", "miguel.macias@xcien.com")
ODOO_PASS     = os.environ["ODOO_PASSWORD"]
BOT_TOKEN     = os.environ.get("ODOO_AGENT_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
MODEL         = "claude-sonnet-4-6"
MAX_TOKENS    = 3000

# ─── Clientes ────────────────────────────────────────────────────────────────
client   = Anthropic(api_key=ANTHROPIC_KEY)
_common  = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
_models  = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")

def _uid():
    """Autenticar y devolver uid (lazy, en cada petición para evitar sesión expirada)."""
    return _common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASS, {})

# ─── Herramientas Odoo (solo lectura) ────────────────────────────────────────
def _odoo_call(model, method, args, kwargs):
    """Ejecutar llamada Odoo con timeout de 20 s."""
    def _timeout(s, f): raise TimeoutError("Odoo no respondió")
    signal.signal(signal.SIGALRM, _timeout)
    signal.alarm(20)
    try:
        uid = _uid()
        return _models.execute_kw(ODOO_DB, uid, ODOO_PASS, model, method, args, kwargs)
    finally:
        signal.alarm(0)

def herramienta_buscar(modelo: str, dominio: list, campos: list, limite: int = 80) -> list:
    """search_read — única herramienta de consulta masiva."""
    return _odoo_call(modelo, "search_read", [dominio], {
        "fields": campos, "limit": min(limite, 200)
    })

def herramienta_contar(modelo: str, dominio: list) -> int:
    """search_count — devuelve total de registros que cumplen dominio."""
    return _odoo_call(modelo, "search_count", [dominio], {})

def herramienta_campos(modelo: str, buscar: str = "") -> dict:
    """fields_get — descubrir campos disponibles en un modelo."""
    campos = _odoo_call(modelo, "fields_get", [], {"attributes": ["string","type"]})
    if buscar:
        campos = {k: v for k, v in campos.items() if buscar.lower() in k.lower() or buscar.lower() in v.get("string","").lower()}
    return dict(list(campos.items())[:40])  # máximo 40 para no saturar

# ─── Definición de tools para Claude ─────────────────────────────────────────
TOOLS = [
    {
        "name": "odoo_buscar",
        "description": (
            "Ejecuta search_read en Odoo wispi17 (solo lectura). "
            "Úsala para obtener listas de registros: cursos, empleados, "
            "tickets, inventario, transferencias, etc."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "modelo":  {"type": "string",  "description": "Modelo Odoo, ej: slide.channel, hr.employee, project.task"},
                "dominio": {"type": "array",   "description": "Filtros Odoo, ej: [[\"active\",\"=\",true]]. Vacío = todos."},
                "campos":  {"type": "array",   "description": "Lista de campos a traer, ej: [\"name\",\"members_count\"]"},
                "limite":  {"type": "integer", "description": "Máximo de registros (default 80, max 200)"}
            },
            "required": ["modelo", "dominio", "campos"]
        }
    },
    {
        "name": "odoo_contar",
        "description": "Cuenta registros en Odoo que cumplan el dominio. Más rápido que buscar cuando solo se necesita el total.",
        "input_schema": {
            "type": "object",
            "properties": {
                "modelo":  {"type": "string", "description": "Modelo Odoo"},
                "dominio": {"type": "array",  "description": "Filtros Odoo. Vacío = total de todos los registros."}
            },
            "required": ["modelo", "dominio"]
        }
    },
    {
        "name": "odoo_campos",
        "description": "Descubre qué campos existen en un modelo Odoo. Útil antes de hacer un buscar para saber cómo se llaman los campos.",
        "input_schema": {
            "type": "object",
            "properties": {
                "modelo": {"type": "string", "description": "Modelo Odoo a inspeccionar"},
                "buscar": {"type": "string", "description": "Filtrar campos por nombre (opcional)"}
            },
            "required": ["modelo"]
        }
    }
]

# ─── Sistema prompt ───────────────────────────────────────────────────────────
SYSTEM = """Eres el Asistente Odoo de XCIEN Networks — experto en el ERP wispi17.

CONEXIÓN: odoo.wispi.mx · base wispi17

REGLA CRÍTICA: Solo lectura. NUNCA usar create, write, unlink ni cambiar datos.
Usa únicamente odoo_buscar, odoo_contar y odoo_campos.

MÓDULOS PRINCIPALES:
- eLearning: slide.channel (cursos), slide.channel.partner (inscritos), slide.slide (lecciones)
- Field Service / CAST: project.task
- Inventario: stock.quant, stock.picking
- Empleados: hr.employee
- Productos: product.product, product.template
- Proyectos / Bidrillas: project.project

ACADEMIA XCIEN (contexto):
- 23 cursos publicados, 336 usuarios, 500+ inscripciones, pico mayo 2026 +32
- 10 áreas: TI (100%), PM (100%), CO (100%), NOC N1 (65%), TC (50%), NOC N2 (material listo), + 4 pendientes
- Osvaldo Ríos: 7 módulos NOC completos, pendiente publicar en Odoo
- Campus CAST: sites.google.com/wispi.mx/cert-cast-2023

FORMATO DE RESPUESTA:
- Responde en español, directo y claro
- Usa listas con guiones para múltiples ítems
- Números con separador de miles (1,234)
- Si son datos de tabla, usa formato de texto alineado o lista numerada
- Máximo 3500 caracteres para Telegram

Si no entiendes la pregunta, pide aclaración."""

# ─── Ejecutar herramienta ────────────────────────────────────────────────────
def ejecutar_herramienta(nombre: str, args: dict) -> str:
    try:
        if nombre == "odoo_buscar":
            result = herramienta_buscar(
                args["modelo"],
                args.get("dominio", []),
                args["campos"],
                args.get("limite", 80)
            )
            return json.dumps(result, ensure_ascii=False, default=str)

        elif nombre == "odoo_contar":
            count = herramienta_contar(args["modelo"], args.get("dominio", []))
            return json.dumps({"total": count})

        elif nombre == "odoo_campos":
            campos = herramienta_campos(args["modelo"], args.get("buscar", ""))
            return json.dumps(campos, ensure_ascii=False)

        else:
            return json.dumps({"error": f"Herramienta desconocida: {nombre}"})

    except TimeoutError:
        return json.dumps({"error": "Odoo no respondió en 20 s. Intenta de nuevo."})
    except Exception as e:
        return json.dumps({"error": str(e)})

# ─── Loop agentico ────────────────────────────────────────────────────────────
def responder(pregunta: str) -> str:
    """Ciclo agente: Claude → tools → Claude → respuesta final."""
    messages = [{"role": "user", "content": pregunta}]

    for _ in range(6):  # máximo 6 rondas de tool calling
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM,
            tools=TOOLS,
            messages=messages
        )

        # Agregar respuesta de Claude al historial
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            # Extraer texto final
            for bloque in response.content:
                if hasattr(bloque, "text"):
                    return bloque.text
            return "Sin respuesta."

        if response.stop_reason == "tool_use":
            # Ejecutar todas las herramientas que pidió Claude
            tool_results = []
            for bloque in response.content:
                if bloque.type == "tool_use":
                    log.info(f"Tool: {bloque.name}({json.dumps(bloque.input)[:120]})")
                    resultado = ejecutar_herramienta(bloque.name, bloque.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": bloque.id,
                        "content": resultado
                    })
            messages.append({"role": "user", "content": tool_results})

    return "Alcancé el límite de consultas. Intenta con una pregunta más específica."

# ─── Telegram (long polling) ──────────────────────────────────────────────────
TG_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"

def tg_get(offset: int) -> list:
    url = f"{TG_BASE}/getUpdates?timeout=20&offset={offset}"
    try:
        with urllib.request.urlopen(url, timeout=25) as r:
            data = json.loads(r.read())
            return data.get("result", [])
    except Exception as e:
        log.warning(f"getUpdates error: {e}")
        return []

def tg_send(chat_id: int, texto: str):
    payload = json.dumps({
        "chat_id": chat_id,
        "text": texto[:4000],
        "parse_mode": "Markdown"
    }).encode()
    req = urllib.request.Request(
        f"{TG_BASE}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req, timeout=15)
    except Exception as e:
        log.error(f"sendMessage error: {e}")
        # Reintentar sin Markdown si falló por formato
        try:
            payload2 = json.dumps({"chat_id": chat_id, "text": texto[:4000]}).encode()
            req2 = urllib.request.Request(f"{TG_BASE}/sendMessage", data=payload2,
                                          headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req2, timeout=15)
        except Exception:
            pass

def tg_typing(chat_id: int):
    payload = json.dumps({"chat_id": chat_id, "action": "typing"}).encode()
    req = urllib.request.Request(f"{TG_BASE}/sendChatAction", data=payload,
                                 headers={"Content-Type": "application/json"})
    try: urllib.request.urlopen(req, timeout=5)
    except Exception: pass

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    log.info("Agente Odoo XCIEN iniciado. Esperando mensajes...")
    offset = 0
    while True:
        updates = tg_get(offset)
        for upd in updates:
            offset = upd["update_id"] + 1
            msg = upd.get("message", {})
            chat_id = msg.get("chat", {}).get("id")
            texto   = msg.get("text", "").strip()
            if not texto or not chat_id:
                continue
            # Ignorar comandos del sistema excepto /start
            if texto == "/start":
                tg_send(chat_id, "Hola! Soy el Agente Odoo de XCIEN. "
                        "Pregúntame cualquier cosa sobre cursos, empleados, "
                        "inventario, tickets CAST o datos del sistema. "
                        "Ej: _¿Cuántos inscritos tiene el curso de NOC?_")
                continue
            log.info(f"Pregunta de {chat_id}: {texto[:80]}")
            tg_typing(chat_id)
            respuesta = responder(texto)
            tg_send(chat_id, respuesta)
            log.info(f"Respuesta enviada ({len(respuesta)} chars)")

if __name__ == "__main__":
    main()
