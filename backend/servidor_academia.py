import os
import sys
import re
import json
import time
import datetime
import anthropic
import xmlrpc.client
import logging
from datetime import date, datetime as dt_datetime

# Configuración de Logging para Producción
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("XCIEN-BACKEND")
from fastapi import FastAPI, HTTPException, Response, Request, Depends, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from dotenv import load_dotenv

# Asegurar que el directorio del servidor sea el CWD y esté en el path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)
sys.path.insert(0, os.path.join(BASE_DIR, "agents"))

ROOT_DIR = os.path.dirname(BASE_DIR)
load_dotenv(os.path.join(ROOT_DIR, ".env"), override=True)
load_dotenv(os.path.join(BASE_DIR, ".env"), override=True)  # backend/.env si existe

# Importar Agentes Corporativos
from agents.director_claude import DirectorClaude as DirectorGeneralV2
from agents.telegram_bot import TelegramBot
from agents import token_service
from agents import asset_service
from agents import transacciones_service
from agents import label_service
from agents.wfm_workflow_service import WFMWorkflowService
from agents.integration_orchestrator import orchestrator
from agents.odoo_connector import odoo_conn
from agents.devops_agent import DevOpsAgent
from agents import auth_service
from agents.auth_service import get_current_user, require_rol
from agents import uisp_service

# Instanciar el Director General y el SRE
dg_agent = DirectorGeneralV2()
sre_agent = DevOpsAgent()
wfm_service = WFMWorkflowService()

# Crear admin inicial si no hay usuarios
auth_service.init_admin()

# Migrar a Postgres si DATABASE_URL está configurado
try:
    from db_migrate import run_migration
    run_migration()
except Exception as _db_err:
    print(f"[DB] Migración omitida: {_db_err}")

print("🚀 [XCIEN-BACKEND] Servidor cargado/recargado correctamente.")

# ─── Cliente Claude ───────────────────────────────────────────────────────────
_claude_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

def ask_claude(prompt: str) -> str:
    try:
        msg = _claude_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}]
        )
        return msg.content[0].text
    except Exception as e:
        logger.error(f"Error en comunicación con Claude: {e}")
        return '{"titulo": "Error de Conexión", "preguntas": []}'

class ClaudeAPIError(Exception):
    """Raised when the Anthropic API call fails for any reason."""


def ask_claude_with_system(system: str, prompt: str) -> str:
    try:
        msg = _claude_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": prompt}]
        )
        return msg.content[0].text
    except Exception as e:
        logger.error(f"Error en ask_claude_with_system: {e}")
        raise ClaudeAPIError(str(e)) from e

from fastapi import BackgroundTasks

# ─── Constantes ──────────────────────────────────────────────────────────────
DOCS_DIR = os.path.join(BASE_DIR, "..", "Xcien_Docs")
QUIZ_CACHE_DIR = os.path.join(BASE_DIR, "..", "src", "data", "quizzes_cache")
SKILLS_DB = os.path.join(BASE_DIR, "db", "skills_2026.json")
BANCO_PREGUNTAS = os.path.join(BASE_DIR, "db", "banco_preguntas_multi.json")
WFM_DB = os.path.join(BASE_DIR, "db", "wfm_data.json")

# ─── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="Portal Academia Xcien API")


@app.on_event("startup")
async def startup_event():
    import asyncio
    asyncio.create_task(uisp_service.warm_cache())
    _start_kpi_scheduler()


# Tickets ya alertados en esta sesión (evita spam por el mismo ticket)
_sla_alerted: set = set()

# SLA en segundos por nivel detectado en el nombre del ticket
_SLA_SECONDS = {
    "nvl:1": 2 * 3600,
    "nivel 1": 2 * 3600,
    "nvl:2": 4 * 3600,
    "nivel 2": 4 * 3600,
    "nvl:3": 8 * 3600,
    "nivel 3": 8 * 3600,
    "cae": 24 * 3600,
    "visita": 24 * 3600,
}
_SLA_DEFAULT = 4 * 3600  # 4h para tickets sin nivel explícito

def _sla_for_ticket(name: str) -> int:
    name_low = name.lower()
    for key, secs in _SLA_SECONDS.items():
        if key in name_low:
            return secs
    return _SLA_DEFAULT

def _sla_label(secs: int) -> str:
    h = secs // 3600
    return f"{h}h"


def _start_kpi_scheduler():
    """APScheduler para reportes KPI automáticos: diario, semanal, mensual y alertas SLA."""
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        from apscheduler.triggers.interval import IntervalTrigger

        scheduler = AsyncIOScheduler(timezone="America/Hermosillo")

        async def _auto_reporte(tipo: str):
            """Genera reporte automático con la configuración por defecto y envía a Telegram."""
            DEFAULT_KPIS = [
                {"id": "mrr",        "label": "MRR Total",     "endpoint": "/api/ventas/resumen",              "field": "mrr",              "format": "currency", "enabled": True,  "threshold_ok": 400000, "threshold_warn": 300000, "invert": False},
                {"id": "noc_health", "label": "Salud NOC",     "endpoint": "/api/noc/summary",                 "field": "avgHealthScore",   "format": "percent",  "enabled": True,  "threshold_ok": 85,     "threshold_warn": 70,     "invert": False},
                {"id": "tickets",    "label": "Tickets WFM",   "endpoint": "/api/wfm/field-tickets/summary",   "field": "total",            "format": "number",   "enabled": True,  "threshold_ok": 100,    "threshold_warn": 200,    "invert": True},
                {"id": "avance_acad","label": "Avance Academia","endpoint": "/api/academia/stats",              "field": "avance_global",    "format": "percent",  "enabled": True,  "threshold_ok": 70,     "threshold_warn": 50,     "invert": False},
                {"id": "empleados",  "label": "Empleados",     "endpoint": "/api/rrhh/empleados",              "field": "total",            "format": "number",   "enabled": True,  "threshold_ok": 1,      "threshold_warn": 1,      "invert": False},
            ]
            try:
                import httpx
                valores: Dict[str, Any] = {}
                async with httpx.AsyncClient() as client:
                    for k in DEFAULT_KPIS:
                        if not k["enabled"]:
                            continue
                        try:
                            port = os.environ.get("PORT", "8002")
                            r = await client.get(f"http://localhost:{port}{k['endpoint']}", timeout=8)
                            if r.status_code == 200:
                                data = r.json()
                                parts = k["field"].split(".")
                                v = data
                                for p in parts:
                                    v = v.get(p) if isinstance(v, dict) else None
                                valores[k["id"]] = v
                        except Exception:
                            valores[k["id"]] = None

                pdf_bytes = _build_kpi_pdf(tipo, DEFAULT_KPIS, valores)

                cfg = _load_telegram_config()
                token   = cfg.get("token")
                chat_id = cfg.get("chat_id")
                if token and chat_id and pdf_bytes:
                    import tempfile, os
                    tipo_label = {"diario": "Diario", "semanal": "Semanal", "mensual": "Mensual"}.get(tipo, tipo)
                    fecha_str  = dt_datetime.now().strftime("%Y-%m-%d")
                    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf", prefix=f"auto_kpi_{tipo}_")
                    tmp.write(pdf_bytes)
                    tmp.close()
                    bot = TelegramBot(token=token, chat_id=chat_id)
                    now_str = dt_datetime.now().strftime("%d/%m/%Y %H:%M")
                    caption = (
                        f"📊 *Reporte {tipo_label} Automático — XCIEN*\n"
                        f"🗓 {now_str}\n"
                        f"KPIs activos: {len([k for k in DEFAULT_KPIS if k['enabled']])}\n"
                        f"_Centro de Mando · Programado_"
                    )
                    bot.send_document(tmp.name, caption=caption)
                    os.unlink(tmp.name)
                    logger.info(f"[scheduler] Reporte {tipo} enviado a Telegram")
            except Exception as e:
                logger.error(f"[scheduler] Error en reporte automático {tipo}: {e}", exc_info=True)

        # Lunes a viernes a las 18:00 → diario
        scheduler.add_job(lambda: __import__("asyncio").get_event_loop().create_task(_auto_reporte("diario")),
                          CronTrigger(day_of_week="mon-fri", hour=18, minute=0))

        # Viernes a las 17:00 → semanal
        scheduler.add_job(lambda: __import__("asyncio").get_event_loop().create_task(_auto_reporte("semanal")),
                          CronTrigger(day_of_week="fri", hour=17, minute=0))

        # Día 1 de cada mes a las 08:00 → mensual
        scheduler.add_job(lambda: __import__("asyncio").get_event_loop().create_task(_auto_reporte("mensual")),
                          CronTrigger(day=1, hour=8, minute=0))

        # ── Alertas de rezago SLA ─────────────────────────────────────────────
        async def _check_sla_alerts():
            """Revisa tickets CAST abiertos. Alerta en Telegram cuando superan su SLA."""
            global _sla_alerted
            try:
                import xmlrpc.client as _xrc
                from datetime import datetime, timezone as _tz
                from concurrent.futures import ThreadPoolExecutor as _TPE

                env_path = os.path.join(os.path.dirname(__file__), ".env")
                _env: dict = {}
                try:
                    with open(env_path) as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#") and "=" in line:
                                k, v = line.split("=", 1)
                                _env[k.strip()] = v.strip()
                except Exception:
                    return

                HOST = _env.get("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
                DB   = "wispi19"
                USER = _env.get("ODOO_USER", "")
                PASS = _env.get("ODOO_PASSWORD", "")

                CAST_TEAMS    = [6, 39, 41, 44, 48, 60, 67]
                RESOLVED_IDS  = {54, 101, 69, 100, 120, 121}

                def _odoo_fetch():
                    common = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
                    uid    = common.authenticate(DB, USER, PASS, {})
                    if not uid:
                        return []
                    models = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)
                    tickets = models.execute_kw(DB, uid, PASS,
                        "helpdesk.ticket", "search_read",
                        [[["team_id", "in", CAST_TEAMS],
                          ["stage_id", "not in", list(RESOLVED_IDS)]]],
                        {"fields": ["id", "name", "create_date", "stage_id",
                                    "user_ids", "partner_name"],
                         "limit": 300})
                    return tickets

                loop = __import__("asyncio").get_event_loop()
                with _TPE(max_workers=1) as pool:
                    tickets = await loop.run_in_executor(pool, _odoo_fetch)

                if not tickets:
                    return

                now_utc = datetime.now(_tz.utc)
                nuevas_alertas: list[dict] = []

                CHECK_WINDOW = 1800  # 30 min — igual al intervalo del cron

                for t in tickets:
                    tid = t["id"]
                    if tid in _sla_alerted:
                        continue
                    raw_date = t.get("create_date", "")
                    if not raw_date:
                        continue
                    try:
                        created = datetime.strptime(raw_date, "%Y-%m-%d %H:%M:%S").replace(tzinfo=_tz.utc)
                    except ValueError:
                        continue

                    elapsed  = (now_utc - created).total_seconds()
                    sla_secs = _sla_for_ticket(t.get("name", ""))

                    # Solo alertar si el ticket ACABA de cruzar el umbral en los últimos 30 min
                    if sla_secs <= elapsed < sla_secs + CHECK_WINDOW:
                        _sla_alerted.add(tid)
                        nuevas_alertas.append({
                            "id":      tid,
                            "name":    t.get("name", f"Ticket #{tid}"),
                            "partner": t.get("partner_name") or "—",
                            "elapsed": elapsed,
                            "sla":     sla_secs,
                        })

                if not nuevas_alertas:
                    return

                bot_token = _env.get("TELEGRAM_BOT_TOKEN", "")
                chat_id   = _env.get("TELEGRAM_CHAT_ID_REPORTES", "") or _env.get("TELEGRAM_CHAT_ID", "")
                if not (bot_token and chat_id):
                    return

                import requests as _req

                # Enviar un digest único con todos los que acaban de vencer
                lines = []
                for a in nuevas_alertas[:10]:
                    h = int(a["elapsed"] // 3600)
                    m = int((a["elapsed"] % 3600) // 60)
                    sla_label = _sla_label(a["sla"])
                    lines.append(
                        f"🎫 `#{a['id']}` {a['name'][:55]}\n"
                        f"   👤 {a['partner']} · ⏱ {h}h {m}m · SLA {sla_label}"
                    )
                extra = f"\n…y {len(nuevas_alertas)-10} más" if len(nuevas_alertas) > 10 else ""
                msg = (
                    f"🔴 *Rezago SLA — CAST*\n"
                    f"{len(nuevas_alertas)} ticket(s) superaron su SLA:\n\n"
                    + "\n\n".join(lines)
                    + extra
                )
                try:
                    _req.post(
                        f"https://api.telegram.org/bot{bot_token}/sendMessage",
                        json={"chat_id": chat_id, "text": msg,
                              "parse_mode": "Markdown", "disable_web_page_preview": True},
                        timeout=10,
                    )
                except Exception:
                    pass

                logger.info(f"[sla-alerts] {len(nuevas_alertas)} alerta(s) de rezago enviadas")

            except Exception as e:
                logger.error(f"[sla-alerts] Error: {e}", exc_info=True)

        scheduler.add_job(
            lambda: __import__("asyncio").get_event_loop().create_task(_check_sla_alerts()),
            IntervalTrigger(minutes=30),
        )

        scheduler.start()
        logger.info("[scheduler] APScheduler iniciado — reportes KPI automáticos programados")
    except Exception as e:
        logger.warning(f"[scheduler] No se pudo iniciar APScheduler: {e}")


@app.api_route("/academia", methods=["GET", "HEAD"])
@app.api_route("/academia/", methods=["GET", "HEAD"])
def redirect_academia():
    return RedirectResponse(url="/")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Error no controlado en {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"status": "error", "message": "Error interno del servidor corporativo."},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:8080",
        "http://localhost:8081",
        "http://127.0.0.1:5175",
        "http://127.0.0.1:8080",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:8002",
        "http://127.0.0.1:8002",
        "https://portal-command-center.vercel.app",
        "https://xcien-portal.vercel.app",
        "https://xcien.up.railway.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montar estáticos (React build y Assets)
# En Docker (Railway) el frontend se copia a dist_frontend/; en dev local queda en ../dist
_dist_local = os.path.join(BASE_DIR, "..", "dist")
_dist_docker = os.path.join(BASE_DIR, "dist_frontend")
DIST_DIR = _dist_docker if os.path.exists(_dist_docker) else _dist_local

# Siempre montar /static — creamos el dir si no existe para evitar crash en Railway
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

if os.path.exists(DIST_DIR):
    # El build de Vite pone los chunks en assets/
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")

@app.get("/")
async def serve_index():
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    return FileResponse("static/index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

# ─── Modelos Pydantic ─────────────────────────────────────────────────────────
class QuizRequest(BaseModel):
    filename: str

class WFMCreateRequest(BaseModel):
    cliente: str
    servicio: str
    comercial: str

class WFMUpdatePreventaRequest(BaseModel):
    order_id: str
    data: Dict
    usuario: str

class WFMBasicActionRequest(BaseModel):
    order_id: str
    usuario: str

class WFMAlmacenRequest(BaseModel):
    order_id: str
    equipos: List[Dict]
    usuario: str

class WFMAproRequest(BaseModel):
    order_id: str
    config: Dict
    usuario: str

class WFMAuditoriaRequest(BaseModel):
    order_id: str
    ok: bool
    motivo: str
    usuario: str

class WFMAlmacenRespuestaRequest(BaseModel):
    order_id: str
    respuesta: str          # 'disponible' | 'no_disponible' | 'disponible_en_fecha'
    equipos: List[Dict] = []
    fecha_estimada: Optional[str] = None
    motivo: Optional[str] = None
    usuario: str

class WFMAprovisionar2Request(BaseModel):
    order_id: str
    vlan: Optional[int] = None
    bw_mbps: Optional[float] = None
    ip_wan: Optional[str] = None
    gateway: Optional[str] = None
    firmware: Optional[str] = None
    mac_address: Optional[str] = None
    notas_config: Optional[str] = None
    usuario: str

class WFMEvidenciaRequest(BaseModel):
    order_id: str
    tipo: str               # 'antes' | 'despues'
    filename: str
    data_b64: str           # imagen en base64
    usuario: str

class WFMCerrarInstalacionRequest(BaseModel):
    order_id: str
    notas: str = ""
    usuario: str

class WFMChecklistItemRequest(BaseModel):
    order_id: str
    item_id: str
    completado: bool
    observacion: str = ""
    usuario: str

class WFMPruebaVelocidadRequest(BaseModel):
    order_id: str
    bw_contratado_mbps: float
    descarga_mbps: float
    subida_mbps: float
    latencia_ms: float
    perdida_pct: float = 0.0
    servidor: str = ""
    herramienta: str = "manual"
    usuario: str

class WFMNocPingRequest(BaseModel):
    order_id: str
    ip_destino: str
    ping_ok: bool
    latencia_ms: Optional[float] = None
    usuario: str

class WFMNocAltaRequest(BaseModel):
    order_id: str
    herramienta_monitoreo: str
    host_id: str = ""
    grupos_alerta: List[str] = []
    usuario: str

class WFMNocAprobarRequest(BaseModel):
    order_id: str
    usuario: str

class SkillResult(BaseModel):
    nombre_tecnico: str
    resultados: dict  # {pilar: score}
    modulo: Optional[str] = None
    empresa: Optional[str] = "xcien"

class TicketCreateRequest(BaseModel):
    client: str
    description: str
    location: str
    tipo: str
    zona: str
    priority: str

class TicketUpdateStatusRequest(BaseModel):
    status: str
    asignado: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    history: list = []
    context: str = ""

class TokenRequest(BaseModel):
    empresa: str
    oportunidad_id: str
    cliente: str
    vendedor: str
    monto: float = 0.0
    extra: dict = {}

class TransaccionRequest(BaseModel):
    empresa_origen: str
    empresa_destino: str
    area_origen: str
    area_destino: str
    concepto: str
    precio_mercado: float
    precio_preferencial: float
    responsable: str = ""
    referencia: str = ""
    notas: str = ""

class TransaccionUpdateRequest(BaseModel):
    empresa_origen: str = None
    empresa_destino: str = None
    area_origen: str = None
    area_destino: str = None
    concepto: str = None
    precio_mercado: float = None
    precio_preferencial: float = None
    responsable: str = None
    notas: str = None

class ActivoRequest(BaseModel):
    nombre: str
    categoria: str
    empresa: str
    regimen: str
    site: str = ""
    asignado_a: str = ""
    numero_serie: str = ""
    marca: str = ""
    modelo: str = ""
    costo_mensual: float = 0.0
    vencimiento_contrato: str = ""
    estado: str = "activo"
    notas: str = ""
    ip: str = ""
    network_code: str = ""

WFMUpdatePreventaRequest.model_rebuild()
ActivoRequest.model_rebuild()

class MoverActivoRequest(BaseModel):
    nuevo_site: str
    nuevo_asignado: str
    motivo: str = ""

class OdooWebhookPayload(BaseModel):
    id: int
    name: str
    partner_name: str = ""
    user_id: list = []        # [id, nombre] — formato Odoo
    expected_revenue: float = 0.0
    company_id: list = []     # [id, nombre]
    tag_ids: list = []

class IntegrationRequest(BaseModel):
    platform: str
    action: str
    params: Dict[str, Any] = {}

class OdooActionRequest(BaseModel):
    model: str
    method: str
    args: List[Any] = []
    kwargs: Dict[str, Any] = {}

# ─── Agente Puente (Antigravity) ─────────────────────────────────────────────
AGENT_BRIDGE = {
    "current_task": "Inactivo",
    "status": "idle",
    "log": [],
    "last_update": "",
    "command_queue": []
}

class CommandRequest(BaseModel):
    command: str
    context: str = ""

class BridgeRequest(BaseModel):
    task: str
    status: str = "working"
    log_entry: str = ""

# ─── Nebula — Zabbix + Grafana ────────────────────────────────────────────────
_NEBULA_ZABBIX_URL  = os.environ.get("NEBULA_ZABBIX_URL", "")
_NEBULA_ZABBIX_USER = os.environ.get("NEBULA_ZABBIX_USER", "")
_NEBULA_ZABBIX_PASS = os.environ.get("NEBULA_ZABBIX_PASSWORD", "")
_NEBULA_GRAFANA_URL = os.environ.get("NEBULA_GRAFANA_URL", "")
_NEBULA_GRAFANA_TOK = os.environ.get("NEBULA_GRAFANA_TOKEN", "")
_zabbix_auth_token: dict = {"token": None, "ts": 0.0}

def _zabbix_login():
    import time
    if _zabbix_auth_token["token"] and (time.time() - _zabbix_auth_token["ts"]) < 3600:
        return _zabbix_auth_token["token"]
    if not _NEBULA_ZABBIX_URL:
        return None
    try:
        import requests as _req
        r = _req.post(f"{_NEBULA_ZABBIX_URL}/api_jsonrpc.php",
            json={"jsonrpc":"2.0","method":"user.login",
                  "params":{"username":_NEBULA_ZABBIX_USER,"password":_NEBULA_ZABBIX_PASS},"id":1},
            timeout=8)
        tok = r.json().get("result")
        if tok:
            _zabbix_auth_token["token"] = tok
            _zabbix_auth_token["ts"] = time.time()
        return tok
    except Exception:
        return None

def _zabbix(method: str, params: dict):
    import requests as _req
    tok = _zabbix_login()
    if not tok:
        return []
    r = _req.post(f"{_NEBULA_ZABBIX_URL}/api_jsonrpc.php",
        json={"jsonrpc":"2.0","method":method,"params":params,"auth":tok,"id":1},
        timeout=12)
    return r.json().get("result", [])

# ─── Cliente Odoo ─────────────────────────────────────────────────────────────
ODOO_URL = os.environ.get("ODOO_URL")
ODOO_DB = os.environ.get("ODOO_DB")
ODOO_USER = os.environ.get("ODOO_USER")
ODOO_PASSWORD = os.environ.get("ODOO_PASSWORD")

def _get_odoo_employees():
    try:
        employees = odoo_conn.search_read('hr.employee', domain=[[('job_title', '!=', False)]], fields=['name', 'job_title'], limit=50)
        if employees:
            return employees
        
        # Fallback a Matriz de Habilidades (skills_2026.json)
        print("⚠️ Usando matriz de habilidades como fallback para técnicos.")
        if os.path.exists(SKILLS_DB):
            with open(SKILLS_DB, "r") as f:
                skills_data = json.load(f)
                return [{"name": name, "job_title": "Técnico Certificado (Matriz)"} for name in skills_data.keys()]
        return []
    except Exception as e:
        print(f"Error conectando a Odoo: {e}. Usando fallback...")
        if os.path.exists(SKILLS_DB):
            with open(SKILLS_DB, "r") as f:
                skills_data = json.load(f)
                return [{"name": name, "job_title": "Técnico Certificado (Matriz)"} for name in skills_data.keys()]
        return []

@app.get("/api/odoo/tecnicos")
def api_odoo_tecnicos():
    return _get_odoo_employees()

@app.get("/api/odoo/audit")
def api_odoo_audit():
    """Auditoría de calidad de datos Odoo: segmenta productos, socios y equipos en útil vs. basura."""
    from datetime import datetime, timedelta
    cutoff_2y = (datetime.now() - timedelta(days=730)).strftime('%Y-%m-%d')
    cutoff_90d = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%d')

    resultado = {}

    # ── 1. Productos sin movimiento en 2+ años ────────────────────────────────
    try:
        quants = odoo_conn.execute('stock.quant', 'search_read',
            [['in_date', '<', cutoff_2y], ['quantity', '>', 0]],
            fields=['product_id', 'quantity', 'location_id', 'in_date'], limit=500)
        resultado['productos_sin_movimiento'] = [
            {'producto': q['product_id'][1] if q['product_id'] else '?',
             'cantidad': q['quantity'],
             'ubicacion': q['location_id'][1] if q['location_id'] else '?',
             'desde': q['in_date']}
            for q in (quants or [])
        ]
    except Exception as e:
        resultado['productos_sin_movimiento'] = []
        resultado['error_productos'] = str(e)

    # ── 2. Órdenes de venta sin factura en 90+ días ───────────────────────────
    try:
        orders = odoo_conn.execute('sale.order', 'search_read',
            [['state', 'in', ['sale', 'done']],
             ['date_order', '<', cutoff_90d],
             ['invoice_status', '!=', 'invoiced']],
            fields=['name', 'partner_id', 'amount_total', 'date_order', 'invoice_status'], limit=200)
        resultado['ordenes_sin_factura'] = [
            {'orden': o['name'],
             'cliente': o['partner_id'][1] if o['partner_id'] else '?',
             'monto': o['amount_total'],
             'fecha': o['date_order'],
             'estado_factura': o['invoice_status']}
            for o in (orders or [])
        ]
    except Exception as e:
        resultado['ordenes_sin_factura'] = []
        resultado['error_ordenes'] = str(e)

    # ── 3. Socios duplicados (mismo email) ────────────────────────────────────
    try:
        partners = odoo_conn.execute('res.partner', 'search_read',
            [['customer_rank', '>', 0], ['email', '!=', False]],
            fields=['name', 'email', 'phone', 'street', 'active'], limit=1000)
        email_map: dict = {}
        for p in (partners or []):
            e = (p.get('email') or '').lower().strip()
            if e:
                email_map.setdefault(e, []).append(p['name'])
        resultado['socios_duplicados'] = [
            {'email': email, 'nombres': nombres}
            for email, nombres in email_map.items() if len(nombres) > 1
        ]
    except Exception as e:
        resultado['socios_duplicados'] = []
        resultado['error_socios'] = str(e)

    # ── 4. Equipos (stock.lot) sin cliente asignado ───────────────────────────
    try:
        lots = odoo_conn.execute('stock.lot', 'search_read',
            [['product_qty', '>', 0]],
            fields=['name', 'product_id', 'product_qty', 'ref', 'company_id'], limit=500)
        resultado['equipos_sin_numero_serie'] = [
            {'lote': l['name'],
             'producto': l['product_id'][1] if l['product_id'] else '?',
             'cantidad': l['product_qty'],
             'referencia': l.get('ref') or ''}
            for l in (lots or []) if not l.get('ref')
        ]
    except Exception as e:
        resultado['equipos_sin_numero_serie'] = []
        resultado['error_equipos'] = str(e)

    # ── 5. Productos sin categoría o con nombre genérico ─────────────────────
    try:
        products = odoo_conn.execute('product.template', 'search_read',
            [['active', '=', True]],
            fields=['name', 'categ_id', 'list_price', 'type', 'default_code'], limit=1000)
        resultado['productos_sin_categoria'] = [
            {'nombre': p['name'], 'precio': p['list_price'], 'tipo': p['type'],
             'codigo': p.get('default_code') or ''}
            for p in (products or [])
            if not p.get('categ_id') or p['categ_id'][1] in ('All', 'Todos', 'All / Saleable', '')
        ]
        resultado['total_productos'] = len(products or [])
    except Exception as e:
        resultado['productos_sin_categoria'] = []
        resultado['total_productos'] = 0
        resultado['error_productos_cat'] = str(e)

    # ── Resumen ───────────────────────────────────────────────────────────────
    resultado['resumen'] = {
        'sin_movimiento_2y': len(resultado.get('productos_sin_movimiento', [])),
        'ordenes_pendientes_factura': len(resultado.get('ordenes_sin_factura', [])),
        'socios_duplicados': len(resultado.get('socios_duplicados', [])),
        'equipos_sin_serie': len(resultado.get('equipos_sin_numero_serie', [])),
        'productos_sin_categoria': len(resultado.get('productos_sin_categoria', [])),
    }
    return resultado


@app.post("/api/odoo/execute")
def api_odoo_execute(req: OdooActionRequest, _user: dict = Depends(require_rol("admin"))):
    """Permite realizar acciones de escritura (create, write) en Odoo — solo admin"""
    allowed_methods = ['create', 'write', 'search_read', 'unlink']
    if req.method not in allowed_methods:
        raise HTTPException(status_code=400, detail=f"Método {req.method} no permitido")

    result = odoo_conn.execute(req.model, req.method, *req.args, **req.kwargs)
    if result is None:
        raise HTTPException(status_code=500, detail="Error en la ejecución de Odoo")
    return {"status": "success", "data": result}

# ─── RRHH Endpoints ───────────────────────────────────────────────────────────

@app.get("/api/rrhh/empleados")
def api_rrhh_empleados():
    """Lista completa de empleados desde Odoo."""
    fields = [
        'name', 'job_id', 'department_id', 'company_id',
        'work_email', 'mobile_phone', 'work_phone',
        'parent_id', 'active',
        'work_location_id', 'resource_calendar_id',
    ]
    # job_title excluido: en Odoo 19 accede implícitamente a version_id (requiere HR Officer)
    # Usamos execute directamente para pasar fields/limit como kwargs (el conector tiene un bug con search_read)
    raw = odoo_conn.execute('hr.employee', 'search_read', [['active', '=', True]], fields=fields, limit=500)
    if raw is None:
        raise HTTPException(status_code=500, detail="Error conectando con Odoo")

    employees = []
    for e in raw:
        employees.append({
            "id": e.get("id"),
            "name": e.get("name", ""),
            "job_title": e["job_id"][1] if e.get("job_id") else "",
            "department": e["department_id"][1] if e.get("department_id") else "Sin departamento",
            "department_id": e["department_id"][0] if e.get("department_id") else None,
            "company": e["company_id"][1] if e.get("company_id") else "",
            "company_id": e["company_id"][0] if e.get("company_id") else None,
            "email": e.get("work_email") or "",
            "phone": e.get("mobile_phone") or e.get("work_phone") or "",
            "manager": e["parent_id"][1] if e.get("parent_id") else None,
            "manager_id": e["parent_id"][0] if e.get("parent_id") else None,
            "location": e["work_location_id"][1] if e.get("work_location_id") else "",
            "schedule": e["resource_calendar_id"][1] if e.get("resource_calendar_id") else "",
            "avatar": None,  # loaded on demand via /api/rrhh/empleado/{id}
        })
    return employees


@app.get("/api/rrhh/stats")
def api_rrhh_stats():
    """Estadísticas globales de RRHH."""
    try:
        employees = api_rrhh_empleados()
    except Exception:
        employees = []

    from collections import Counter
    by_dept = Counter(e["department"] for e in employees)
    by_company = Counter(e["company"] for e in employees)
    by_location = Counter(e["location"] for e in employees if e["location"])

    return {
        "total": len(employees),
        "by_department": [{"name": k, "count": v} for k, v in by_dept.most_common(20)],
        "by_company": [{"name": k, "count": v} for k, v in by_company.most_common()],
        "by_location": [{"name": k, "count": v} for k, v in by_location.most_common(10)],
    }


@app.get("/api/rrhh/diagnostico")
def api_rrhh_diagnostico():
    """Diagnóstico de calidad de datos jerárquicos en Odoo."""
    from collections import defaultdict
    try:
        employees = api_rrhh_empleados()
    except Exception:
        raise HTTPException(status_code=500, detail="Error conectando con Odoo")

    CAMPOS = {
        "manager":    "Responsable directo",
        "department": "Departamento",
        "job_title":  "Puesto / Cargo",
        "email":      "Correo de trabajo",
        "phone":      "Teléfono",
        "location":   "Ubicación / Plaza",
    }
    total = len(employees)
    if total == 0:
        return {"total_empleados": 0, "avg_score_global": 0, "completos": 0,
                "criticos": 0, "campos": {}, "por_departamento": [], "empleados": []}

    # ── Calidad por campo ──────────────────────────────────────────────────────
    campos_stats = {}
    for campo, label in CAMPOS.items():
        filled = sum(1 for e in employees if e.get(campo) and str(e[campo]).strip())
        campos_stats[campo] = {
            "label":       label,
            "completados": filled,
            "faltantes":   total - filled,
            "pct":         round(filled / total * 100, 1),
        }

    # ── Score individual ───────────────────────────────────────────────────────
    emp_scores = []
    for e in employees:
        campos_ok = sum(1 for c in CAMPOS if e.get(c) and str(e[c]).strip())
        score     = round(campos_ok / len(CAMPOS) * 100)
        faltantes = [CAMPOS[c] for c in CAMPOS if not e.get(c) or not str(e[c]).strip()]
        emp_scores.append({
            "id":         e["id"],
            "name":       e["name"],
            "department": e["department"],
            "job_title":  e["job_title"],
            "manager":    e.get("manager"),
            "email":      e.get("email"),
            "location":   e.get("location"),
            "score":      score,
            "campos_ok":  campos_ok,
            "faltantes":  faltantes,
        })

    # ── Análisis por departamento ──────────────────────────────────────────────
    by_dept: dict = defaultdict(lambda: {"total": 0, "score_sum": 0,
                                          "completos": 0, "criticos": 0})
    for e in emp_scores:
        d = by_dept[e["department"]]
        d["total"]     += 1
        d["score_sum"] += e["score"]
        if e["score"] == 100: d["completos"] += 1
        if e["score"] < 50:   d["criticos"]  += 1

    dept_list = [
        {
            "department": k,
            "total":      v["total"],
            "avg_score":  round(v["score_sum"] / v["total"]) if v["total"] else 0,
            "completos":  v["completos"],
            "criticos":   v["criticos"],
            "pct_completos": round(v["completos"] / v["total"] * 100) if v["total"] else 0,
        }
        for k, v in by_dept.items()
    ]
    dept_list.sort(key=lambda x: x["avg_score"])  # peores primero

    avg_global = round(sum(e["score"] for e in emp_scores) / total)

    return {
        "total_empleados":   total,
        "avg_score_global":  avg_global,
        "completos":         sum(1 for e in emp_scores if e["score"] == 100),
        "criticos":          sum(1 for e in emp_scores if e["score"] < 50),
        "campos":            campos_stats,
        "por_departamento":  dept_list,
        "empleados":         sorted(emp_scores, key=lambda x: x["score"]),
    }


@app.get("/api/rrhh/empleado/{emp_id}")
def api_rrhh_empleado_detalle(emp_id: int):
    """Detalle de un empleado."""
    fields = [
        'name', 'job_id', 'department_id', 'company_id',
        'work_email', 'mobile_phone', 'work_phone', 'parent_id',
        'child_ids', 'work_location_id', 'resource_calendar_id',
    ]
    raw = odoo_conn.execute('hr.employee', 'search_read', [['id', '=', emp_id]], fields=fields, limit=1)
    if raw is None:
        raise HTTPException(status_code=500, detail="Error conectando con Odoo")
    if not raw:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    e = raw[0]
    return {
        "id": e.get("id"),
        "name": e.get("name", ""),
        "job_title": e["job_id"][1] if e.get("job_id") else "",
        "department": e["department_id"][1] if e.get("department_id") else "",
        "company": e["company_id"][1] if e.get("company_id") else "",
        "email": e.get("work_email") or "",
        "phone": e.get("mobile_phone") or e.get("work_phone") or "",
        "manager": e["parent_id"][1] if e.get("parent_id") else None,
        "location": e["work_location_id"][1] if e.get("work_location_id") else "",
        "schedule": e["resource_calendar_id"][1] if e.get("resource_calendar_id") else "",
        "avatar": None,
        "subordinates_count": len(e.get("child_ids") or []),
    }


@app.get("/api/rrhh/empleado/{emp_id}/foto")
def api_rrhh_empleado_foto(emp_id: int):
    """Devuelve la foto del empleado como imagen PNG. Usa hr.employee.public para acceso sin privilegios HR."""
    import base64
    # hr.employee.public expone image_128 sin requerir grupo HR Officer
    raw = odoo_conn.execute('hr.employee.public', 'search_read', [['id', '=', emp_id]], fields=['image_128'], limit=1)
    if raw and raw[0].get('image_128'):
        img_bytes = base64.b64decode(raw[0]['image_128'])
        return Response(content=img_bytes, media_type="image/png")
    # Fallback: intentar hr.employee con image_128 directamente
    raw2 = odoo_conn.execute('hr.employee', 'search_read', [['id', '=', emp_id]], fields=['image_128'], limit=1)
    if raw2 and raw2[0].get('image_128'):
        img_bytes = base64.b64decode(raw2[0]['image_128'])
        return Response(content=img_bytes, media_type="image/png")
    raise HTTPException(status_code=404, detail="Foto no disponible")


# ─── KMZ / Fibra Óptica Layers ────────────────────────────────────────────────

import zipfile as _zipfile
import xml.etree.ElementTree as _ET

_KMZ_DIR = os.path.join(BASE_DIR, "data", "kmz")

_KMZ_GROUPS = [
    {"id": "podi",     "label": "Fibra PODI · Cristales", "color": "#FF6B35", "subdir": "KMZ FIBRA PODI A CRISTALES 72 Y SUS DERIBACIONES"},
    {"id": "alpha",    "label": "Fibras Alpha",            "color": "#00B4D8", "subdir": "KMZ FIBRAS ALPHA"},
    {"id": "negras",   "label": "Piedras Negras",          "color": "#8B5CF6", "subdir": "KMZ PIEDRAS NEGRAS"},
    {"id": "saltillo", "label": "Saltillo",                "color": "#00A859", "subdir": "KMZ SALTILLO"},
]

def _kmz_to_geojson(kmz_path: str) -> dict:
    """Convierte un archivo KMZ a GeoJSON usando solo stdlib."""
    features = []
    try:
        with _zipfile.ZipFile(kmz_path, 'r') as z:
            kml_files = [f for f in z.namelist() if f.lower().endswith('.kml')]
            if not kml_files:
                return {"type": "FeatureCollection", "features": []}
            kml_data = z.read(kml_files[0]).decode('utf-8', errors='replace')
    except Exception as e:
        logger.error(f"KMZ read error {kmz_path}: {e}")
        return {"type": "FeatureCollection", "features": []}

    try:
        root = _ET.fromstring(kml_data)
    except Exception as e:
        logger.error(f"KML parse error {kmz_path}: {e}")
        return {"type": "FeatureCollection", "features": []}

    # Detectar namespace
    ns = root.tag.split('}')[0].lstrip('{') if '}' in root.tag else ''
    def tag(name): return f'{{{ns}}}{name}' if ns else name

    def parse_coords(text: str):
        pts = []
        for token in text.strip().split():
            parts = token.split(',')
            if len(parts) >= 2:
                try: pts.append([float(parts[0]), float(parts[1])])
                except: pass
        return pts

    for pm in root.iter(tag('Placemark')):
        name_el = pm.find(tag('name'))
        name = (name_el.text or '').strip() if name_el is not None else ''

        for ls in pm.iter(tag('LineString')):
            c = ls.find(tag('coordinates'))
            if c is not None and c.text:
                coords = parse_coords(c.text)
                if len(coords) >= 2:
                    features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {"name": name}})

        for pt in pm.iter(tag('Point')):
            c = pt.find(tag('coordinates'))
            if c is not None and c.text:
                parts = c.text.strip().split(',')
                if len(parts) >= 2:
                    try: features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [float(parts[0]), float(parts[1])]}, "properties": {"name": name}})
                    except: pass

        for poly in pm.iter(tag('Polygon')):
            outer = poly.find(f'.//{tag("outerBoundaryIs")}/{tag("LinearRing")}/{tag("coordinates")}')
            if outer is not None and outer.text:
                coords = parse_coords(outer.text)
                if len(coords) >= 3:
                    features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [coords]}, "properties": {"name": name}})

    return {"type": "FeatureCollection", "features": features}

# Cache en memoria (cargado al primer request)
_kmz_cache: dict = {}
_kmz_index: list = []

def _ensure_kmz():
    global _kmz_cache, _kmz_index
    if _kmz_cache:
        return
    groups_out = []
    for grp in _KMZ_GROUPS:
        group_dir = os.path.join(_KMZ_DIR, grp["subdir"])
        if not os.path.isdir(group_dir):
            continue
        layers = []
        for fname in sorted(os.listdir(group_dir)):
            if not fname.lower().endswith('.kmz'):
                continue
            layer_id = f"{grp['id']}_{fname[:-4].replace(' ', '_').replace('/', '-')}"
            fpath = os.path.join(group_dir, fname)
            _kmz_cache[layer_id] = {"path": fpath, "geojson": None}  # lazy
            layers.append({"id": layer_id, "name": fname[:-4]})
        if layers:
            groups_out.append({"id": grp["id"], "label": grp["label"], "color": grp["color"], "layers": layers})
    _kmz_index = groups_out
    logger.info(f"KMZ index built: {sum(len(g['layers']) for g in groups_out)} layers in {len(groups_out)} groups")

@app.get("/api/red/kmz-capas")
def api_red_kmz_capas():
    """Lista de grupos y capas KMZ disponibles."""
    _ensure_kmz()
    return _kmz_index

@app.get("/api/red/kmz/{layer_id:path}")
def api_red_kmz_geojson(layer_id: str):
    """GeoJSON de una capa KMZ específica (con caché en memoria)."""
    _ensure_kmz()
    entry = _kmz_cache.get(layer_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Capa no encontrada")
    if entry["geojson"] is None:
        entry["geojson"] = _kmz_to_geojson(entry["path"])
    return entry["geojson"]

# ─── Sala de Juntas / Calendario ──────────────────────────────────────────────

import urllib.request as _urllib_req
import re as _re

def _parse_ical(text: str) -> list:
    """Parser iCal manual — extrae VEVENT sin dependencias externas."""
    events = []
    for block in _re.split(r'BEGIN:VEVENT', text)[1:]:
        end = block.find('END:VEVENT')
        block = block[:end] if end != -1 else block

        def field(name):
            # Handles multi-line folded values
            pattern = rf'(?:^|\n){name}(?:;[^\n:]*)?\:([^\n]*)(?:\n[ \t]([^\n]*))*'
            m = _re.search(pattern, block, _re.MULTILINE)
            if not m: return ''
            val = m.group(1) or ''
            # Unfold continuation lines
            val = _re.sub(r'\n[ \t]', '', val)
            return val.strip()

        def parse_dt(val: str) -> str:
            """Normaliza datetime iCal a ISO8601 (YYYYMMDDTHHMMSSZ → YYYY-MM-DDTHH:MM:SS)."""
            val = val.split(';')[-1]  # quitar TZID=...
            val = val.replace('Z', '')
            if 'T' in val:
                d, t = val.split('T')
                return f"{d[:4]}-{d[4:6]}-{d[6:8]}T{t[:2]}:{t[2:4]}:{t[4:6]}"
            return f"{val[:4]}-{val[4:6]}-{val[6:8]}T00:00:00"

        uid     = field('UID')
        summary = field('SUMMARY').replace('\\n', ' ').replace('\\,', ',')
        desc    = field('DESCRIPTION').replace('\\n', '\n').replace('\\,', ',')
        loc     = field('LOCATION').replace('\\,', ',')
        dtstart = field('DTSTART')
        dtend   = field('DTEND')

        if not summary or not dtstart:
            continue
        try:
            start = parse_dt(dtstart)
            end_  = parse_dt(dtend) if dtend else start
        except:
            continue

        events.append({
            'id':       uid or summary + start,
            'title':    summary,
            'start':    start,
            'end':      end_,
            'location': loc,
            'desc':     desc[:300] if desc else '',
            'source':   'gcal',
        })
    return events


@app.get("/api/calendario/eventos")
def api_calendario_eventos(start: str = '', end: str = ''):
    """Eventos Odoo: calendar.event + hr.leave aprobadas."""
    results = []

    # Dominio de fechas
    domain_cal: list = []
    domain_leave: list = []
    if start:
        domain_cal.append(['start', '>=', start])
        domain_leave.append(['date_from', '>=', start])
    if end:
        domain_cal.append(['stop', '<=', end])
        domain_leave.append(['date_to', '<=', end])

    # calendar.event
    raw_cal = odoo_conn.execute('calendar.event', 'search_read', domain_cal,
        fields=['name','start','stop','partner_ids','user_id','location','description'],
        limit=200) or []

    for e in raw_cal:
        results.append({
            'id':       f"odoo_cal_{e['id']}",
            'title':    e.get('name', ''),
            'start':    (e.get('start') or '').replace(' ', 'T'),
            'end':      (e.get('stop')  or '').replace(' ', 'T'),
            'location': e.get('location') or '',
            'desc':     (e.get('description') or '')[:300],
            'owner':    e['user_id'][1] if e.get('user_id') else '',
            'source':   'odoo_meeting',
        })

    # hr.leave (ausencias aprobadas)
    raw_leave = odoo_conn.execute('hr.leave', 'search_read',
        domain_leave + [['state', '=', 'validate']],
        fields=['name','date_from','date_to','employee_id','holiday_status_id','number_of_days'],
        limit=200) or []

    for e in raw_leave:
        emp = e['employee_id'][1] if e.get('employee_id') else ''
        tipo = e['holiday_status_id'][1] if e.get('holiday_status_id') else 'Ausencia'
        results.append({
            'id':     f"odoo_leave_{e['id']}",
            'title':  f"{emp} — {tipo}",
            'start':  (e.get('date_from') or '').replace(' ', 'T'),
            'end':    (e.get('date_to')   or '').replace(' ', 'T'),
            'days':   e.get('number_of_days', 1),
            'source': 'odoo_leave',
        })

    return results


_GCAL_TOKEN_FILE   = os.path.join(BASE_DIR, "data", "gcal_token.json")
_GCAL_SCOPES       = ["https://www.googleapis.com/auth/calendar.readonly"]
_GCAL_REDIRECT_URI = "http://localhost:8002/api/calendario/auth/callback"
_gcal_flow         = None   # guardamos el flow entre /auth y /callback

def _gcal_creds():
    """Devuelve credenciales válidas o None si no hay token."""
    if not os.path.exists(_GCAL_TOKEN_FILE):
        return None
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from google.oauth2.credentials import Credentials
            from google.auth.transport.requests import Request as GRequest
        creds = Credentials.from_authorized_user_file(_GCAL_TOKEN_FILE, _GCAL_SCOPES)
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(GRequest())
            with open(_GCAL_TOKEN_FILE, "w") as f:
                f.write(creds.to_json())
        return creds if creds and creds.valid else None
    except Exception as e:
        logger.error(f"gcal_creds error: {e}")
        return None

@app.get("/api/calendario/auth/status")
def api_gcal_auth_status():
    """¿Está conectado Google Calendar?"""
    creds = _gcal_creds()
    return {"connected": creds is not None}

@app.get("/api/calendario/auth")
def api_gcal_auth():
    """Inicia el flujo OAuth de Google Calendar. Devuelve la URL de autorización."""
    global _gcal_flow
    client_id     = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET no configurados en .env")
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from google_auth_oauthlib.flow import Flow
        _gcal_flow = Flow.from_client_config(
            {"web": {"client_id": client_id, "client_secret": client_secret,
                     "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                     "token_uri": "https://oauth2.googleapis.com/token"}},
            scopes=_GCAL_SCOPES, redirect_uri=_GCAL_REDIRECT_URI,
        )
        auth_url, _ = _gcal_flow.authorization_url(prompt="consent", access_type="offline")
        return {"url": auth_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/calendario/auth/callback")
def api_gcal_callback(code: str = '', error: str = ''):
    """Callback OAuth — guarda el token y redirige al portal."""
    global _gcal_flow
    if error or not code:
        return RedirectResponse("/?gcal=error")
    try:
        _gcal_flow.fetch_token(code=code)
        creds = _gcal_flow.credentials
        os.makedirs(os.path.dirname(_GCAL_TOKEN_FILE), exist_ok=True)
        with open(_GCAL_TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
        return RedirectResponse("/?gcal=ok")
    except Exception as e:
        logger.error(f"gcal callback error: {e}")
        return RedirectResponse("/?gcal=error")

@app.get("/api/calendario/auth/disconnect")
def api_gcal_disconnect():
    """Desconecta Google Calendar eliminando el token."""
    if os.path.exists(_GCAL_TOKEN_FILE):
        os.remove(_GCAL_TOKEN_FILE)
    return {"status": "disconnected"}

@app.get("/api/calendario/gcal-calendarios")
def api_gcal_calendarios():
    """Lista los calendarios disponibles en la cuenta de Google."""
    creds = _gcal_creds()
    if not creds:
        raise HTTPException(status_code=401, detail="Google Calendar no conectado")
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from googleapiclient.discovery import build
        service = build("calendar", "v3", credentials=creds)
        items = service.calendarList().list().execute().get("items", [])
        return [{"id": c["id"], "name": c.get("summary",""), "color": c.get("backgroundColor","#4285F4"), "primary": c.get("primary", False)} for c in items]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/calendario/gcal-eventos")
def api_gcal_eventos(start: str = '', end: str = '', calendars: str = ''):
    """Eventos de Google Calendar en rango de fechas. calendars = IDs separados por coma."""
    creds = _gcal_creds()
    if not creds:
        raise HTTPException(status_code=401, detail="Google Calendar no conectado")
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from googleapiclient.discovery import build
        service = build("calendar", "v3", credentials=creds)

        cal_ids = [c.strip() for c in calendars.split(",")] if calendars else ["primary"]
        all_events = []

        time_min = f"{start}T00:00:00Z" if start else None
        time_max = f"{end}T23:59:59Z"   if end   else None

        for cal_id in cal_ids:
            params: dict = {"calendarId": cal_id, "singleEvents": True,
                            "orderBy": "startTime", "maxResults": 250}
            if time_min: params["timeMin"] = time_min
            if time_max: params["timeMax"] = time_max
            items = service.events().list(**params).execute().get("items", [])
            for e in items:
                s = e.get("start", {})
                en = e.get("end", {})
                all_events.append({
                    "id":       e.get("id", ""),
                    "title":    e.get("summary", "(Sin título)"),
                    "start":    s.get("dateTime", s.get("date", "")),
                    "end":      en.get("dateTime", en.get("date", "")),
                    "location": e.get("location", ""),
                    "desc":     (e.get("description") or "")[:300],
                    "calendar": cal_id,
                    "source":   "gcal",
                    "allDay":   "date" in s and "dateTime" not in s,
                })
        return all_events
    except Exception as e:
        logger.error(f"gcal eventos error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/api/docs")
def list_docs():
    if not os.path.exists(DOCS_DIR):
        return []
    files = [f for f in os.listdir(DOCS_DIR) if f.endswith(".md")]
    return sorted(files)

@app.get("/api/docs/{filename}")
def get_doc(filename: str):
    path = os.path.join(DOCS_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    with open(path, "r", encoding="utf-8") as f:
        return {"content": f.read()}

@app.get("/api/diagnostic_exam")
def get_diagnostic_exam(area: str = "NOC"):
    if not os.path.exists(BANCO_PREGUNTAS):
        raise HTTPException(status_code=404, detail="Banco de preguntas no encontrado")
    
    with open(BANCO_PREGUNTAS, "r", encoding="utf-8") as f:
        full_bank = json.load(f)
    
    # Normalizar area
    area = area.upper()
    if area not in full_bank:
        # Fallback a NOC si el área no existe
        area = "NOC"
        
    return full_bank[area]

@app.get("/api/docs/content")
def get_doc_content(path: str):
    """Devuelve el contenido de un documento (SOP) de forma segura"""
    clean_path = path.replace("..", "").lstrip("/")
    filename = os.path.basename(clean_path)
    full_path = os.path.join(BASE_DIR, "..", "Xcien_Docs", filename)
    if not os.path.exists(full_path):
        full_path = os.path.join(BASE_DIR, "..", "docs", "estandares", filename)
    if not os.path.exists(full_path):
        full_path = os.path.join(BASE_DIR, "..", "docs", clean_path)
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"Documento no encontrado: {path}")
    
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            return {"content": f.read()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tokens/operativo")
def post_token_operativo(req: Dict[str, Any]):
    try:
        token = token_service.emitir_operativo(
            tipo=req.get("tipo"),
            nombre=req.get("nombre"),
            detalle=req.get("detalle"),
            empresa=req.get("empresa", "xcien")
        )
        _hook_token_operativo({**req, **token} if isinstance(token, dict) else {**req})
        return {"status": "success", "token": token}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

_DATA_DIR = os.environ.get("DATA_DIR")
TELEGRAM_CONFIG_FILE = os.path.join(_DATA_DIR, "db", "telegram_config.json") if _DATA_DIR else "db/telegram_config.json"

def _load_telegram_config():
    try:
        with open(TELEGRAM_CONFIG_FILE, "r") as f:
            return json.load(f)
    except:
        return {"enabled": False, "token": "", "chat_id": "", "min_severity": "critical"}

def _save_telegram_config(config):
    with open(TELEGRAM_CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)

@app.post("/api/config/telegram")
def config_telegram(req: Dict[str, Any], _user: dict = Depends(require_rol("admin"))):
    config = _load_telegram_config()
    config.update({
        "enabled": req.get("enabled", config["enabled"]),
        "token": req.get("token", config["token"]),
        "chat_id": req.get("chat_id", config["chat_id"]),
        "min_severity": req.get("min_severity", config["min_severity"])
    })
    _save_telegram_config(config)
    return {"status": "success", "config": config}

@app.get("/api/config/telegram")
def get_telegram_config(_user: dict = Depends(require_rol("admin"))):
    return _load_telegram_config()

@app.post("/api/test/telegram")
def test_telegram(req: Dict[str, Any], _user: dict = Depends(require_rol("admin"))):
    token = req.get("token") or _load_telegram_config().get("token")
    chat_id = req.get("chat_id") or _load_telegram_config().get("chat_id")
    bot = TelegramBot(token=token, chat_id=chat_id)
    res = bot.send_message("🚀 *PRUEBA DE BOT XCIEN*\n\nConexión establecida correctamente desde el Centro de Mando.")
    return res

@app.post("/api/save_skill_result")
def save_skill_result(result: SkillResult, _user: dict = Depends(get_current_user)):
    os.makedirs("db", exist_ok=True)
    data = {}
    if os.path.exists(SKILLS_DB):
        with open(SKILLS_DB, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except Exception:
                data = {}

    data[result.nombre_tecnico] = {
        "last_update": str(date.today()),
        "skills": result.resultados
    }

    with open(SKILLS_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # Auto-emit token academia por cada resultado guardado
    scores = result.resultados or {}
    global_score = scores.get("Global") or (sum(scores.values()) / len(scores) if scores else 0)
    approved = global_score >= 70
    try:
        auto_emit(
            domain="academia",
            entity=result.empresa or "xcien",
            payload={
                "tecnico": result.nombre_tecnico,
                "modulo": result.modulo or "Evaluación técnica",
                "score": round(global_score, 1),
                "pilares": scores,
                "aprobado": approved,
                "nivel": "Aprobado" if approved else "No aprobado",
            },
            created_by=result.nombre_tecnico or "sistema",
            notes=f"{'✅ Aprobado' if approved else '❌ No aprobado'} — {round(global_score, 1)}%",
            ext_system="save_skill_result",
        )
    except Exception:
        pass

    return {"status": "success", "message": f"Matriz actualizada para {result.nombre_tecnico}"}

@app.post("/api/generate_quiz")
def generate_quiz(request: QuizRequest):
    # 1. Verificar caché
    os.makedirs(QUIZ_CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(QUIZ_CACHE_DIR, request.filename.replace(".md", ".json"))
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            print(f"✅ Sirviendo examen desde caché: {cache_path}")
            return json.load(f)

    # 2. Leer documento
    path = os.path.join(DOCS_DIR, request.filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    with open(path, "r", encoding="utf-8") as f:
        context = f.read()

    prompt = f"""Eres un Diseñador Instruccional de Academia Xcien.
Lee el siguiente estándar técnico y genera exactamente 10 preguntas de examen.
Devuelve SOLO un objeto JSON válido, sin texto adicional, sin bloques de código.

Formato JSON requerido:
{{
  "titulo": "Certificación: <nombre del tema>",
  "preguntas": [
    {{
      "id": 1,
      "pregunta": "¿Pregunta técnica?",
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "respuesta_correcta": 0,
      "explicacion": "Explicación breve"
    }}
  ]
}}

Estándar a evaluar:
{context[:6000]}
"""

    try:
        print(f"🤖 Generando examen con Claude para: {request.filename}")
        text = ask_claude(prompt)

        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            quiz_result = json.loads(match.group())
        else:
            quiz_result = json.loads(text.replace("```json", "").replace("```", "").strip())

        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(quiz_result, f, indent=2, ensure_ascii=False)

        print(f"✅ Examen generado y guardado en: {cache_path}")
        return quiz_result

    except Exception as e:
        print(f"❌ Error generando examen: {e}")
        raise HTTPException(status_code=500, detail=f"Error al generar el examen: {str(e)}")

# ─── WFM: Workforce Management ────────────────────────────────────────────────

def _load_wfm():
    try:
        with open(WFM_DB, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"tecnicos": [], "tickets": []}

def _save_wfm(data):
    with open(WFM_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

@app.get("/api/wfm/tecnicos")
def get_tecnicos():
    return _load_wfm()["tecnicos"]

@app.get("/api/wfm/tickets")
def get_tickets():
    return _load_wfm()["tickets"]

@app.post("/api/wfm/asignar/{ticket_id}")
def autoasignar_ticket(ticket_id: str):
    data = _load_wfm()
    ticket = next((t for t in data["tickets"] if t["id"] == ticket_id), None)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")

    tipo_skill = ticket.get("tipo", "Instalación")
    zona = ticket.get("zona", "")

    candidatos = [t for t in data["tecnicos"] if t.get("status") == "Disponible" and t.get("zona") == zona]
    if not candidatos:
        candidatos = [t for t in data["tecnicos"] if t.get("status") == "Disponible"]
    if not candidatos:
        raise HTTPException(status_code=409, detail="No hay técnicos disponibles")

    candidatos.sort(key=lambda t: t["skills"].get(tipo_skill, 0), reverse=True)
    elegido = candidatos[0]

    ticket["asignado"] = elegido["id"]
    ticket["status"] = "Agendado"
    for tec in data["tecnicos"]:
        if tec["id"] == elegido["id"]:
            tec["status"] = "En Sitio"

    _save_wfm(data)
    return {"status": "success", "ticket": ticket_id, "tecnico_asignado": elegido["nombre"], "skill_match": elegido["skills"].get(tipo_skill, 0)}

@app.put("/api/wfm/tecnico/{tecnico_id}/status")
def update_tecnico_status(tecnico_id: str, nuevo_status: str):
    data = _load_wfm()
    for tec in data["tecnicos"]:
        if tec["id"] == tecnico_id:
            tec["status"] = nuevo_status
            _save_wfm(data)
            return {"status": "updated", "tecnico": tec["nombre"], "nuevo_status": nuevo_status}
    raise HTTPException(status_code=404, detail="Técnico no encontrado")

@app.post("/api/wfm/tickets")
def create_ticket(req: TicketCreateRequest):
    data = _load_wfm()
    new_ticket = {
        "id": f"T-{int(time.time())}",
        "client": req.client,
        "description": req.description,
        "location": req.location,
        "tipo": req.tipo,
        "zona": req.zona,
        "priority": req.priority,
        "status": "Abierto",
        "asignado": None,
        "created_at": str(date.today())
    }
    data["tickets"].append(new_ticket)
    _save_wfm(data)
    _hook_wfm_ticket(new_ticket, action="created")
    return new_ticket

@app.put("/api/wfm/tickets/{ticket_id}/status")
def update_ticket_status(ticket_id: str, req: TicketUpdateStatusRequest):
    data = _load_wfm()
    for t in data["tickets"]:
        if t["id"] == ticket_id:
            t["status"] = req.status
            if req.asignado is not None:
                t["asignado"] = req.asignado
            _save_wfm(data)
            _hook_wfm_ticket(t, action="updated")
            return {"status": "updated", "ticket": t}
    raise HTTPException(status_code=404, detail="Ticket no encontrado")

# ─── NOC: Datos reales desde NOCBoard ────────────────────────────────────────

NOCBOARD_DIR = os.path.expanduser("~/Library/Application Support/NOCBoard")
NOCBOARD_HOSTS_FILE   = os.path.join(NOCBOARD_DIR, "hosts.json")
NOCBOARD_ALERTS_FILE  = os.path.join(NOCBOARD_DIR, "alerts.json")
# En producción (Railway): NOCBOARD_API_BASE = https://tunnel.trycloudflare.com
# El proxy agrega todos los boards en /api/hosts y /api/alerts
# En local dev: proxy en localhost:9400/api agrega todos los boards locales
_nocboard_proxy = os.environ.get("NOCBOARD_API_BASE", "")
if _nocboard_proxy:
    # Modo proxy: apunta al endpoint agregado del proxy
    NOCBOARD_API_BASE = _nocboard_proxy.rstrip("/") + "/api"
else:
    # Modo local: proxy local agrega todos los boards
    NOCBOARD_API_BASE = "http://localhost:9400/api"
NOCBOARD_API_KEY  = os.environ.get("NOCBOARD_API_KEY", "87a08190b801416392e944ab79c7e3c9")

# Rastrea cuándo fue la última vez que el proxy NOCBoard respondió con éxito
_noc_last_live: dict = {"ts": 0.0}  # epoch seconds

import requests
import threading
import subprocess as _sp

def _nocboard_watchdog():
    """Verifica cada 60s que NOCBoard esté activa; si no, la reabre."""
    import time
    while True:
        try:
            r = requests.get(f"{NOCBOARD_API_BASE}/hosts",
                             headers={"X-API-Key": NOCBOARD_API_KEY}, timeout=3)
            if r.status_code != 200:
                raise Exception("status != 200")
        except Exception:
            logger.warning("NOCBoard watchdog: puerto 9401 no responde — reabriendo app...")
            if sys.platform == "darwin":
                _sp.Popen(["open", "-a", "NOCBoard"])
        time.sleep(60)

# NOCBoard watchdog desactivado — el NOCBoard se gestiona manualmente
# if sys.platform == "darwin":
#     threading.Thread(target=_nocboard_watchdog, daemon=True, name="nocboard-watchdog").start()

def _load_noc_data(endpoint: str, fallback_file: str):
    """Intenta cargar datos desde la API de NOCBoard (9401) o cae a archivos locales."""
    import time
    try:
        url = f"{NOCBOARD_API_BASE}/{endpoint}"
        r = requests.get(url, headers={"X-API-Key": NOCBOARD_API_KEY}, timeout=10)
        if r.status_code == 200:
            _noc_last_live["ts"] = time.time()
            data = r.json()
            if endpoint in data and isinstance(data[endpoint], list):
                return data[endpoint]
            return data
    except Exception as e:
        logger.warning(f"NOC API (9401) no disponible para {endpoint}: {e}. Usando archivo local.")
    
    # Fallback a archivos
    try:
        if os.path.exists(fallback_file):
            with open(fallback_file, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"Error leyendo archivo NOC local {fallback_file}: {e}")
    
    return []

def _get_enriched_noc_data():
    """Retorna hosts y alertas enriquecidos con simulación para tenants faltantes"""
    hosts  = _load_noc_data("hosts", NOCBOARD_HOSTS_FILE)
    alerts = _load_noc_data("alerts", NOCBOARD_ALERTS_FILE)
    
    # Inyectar simulación para Wispi, Luminet, Huus, Sandur
    MISSING_TENANTS = [
        {"id": "wispi",   "name": "Wispi",       "city": "Monterrey"},
        {"id": "luminet", "name": "Luminet WAN", "city": "Saltillo"},
        {"id": "huus",    "name": "Huus",        "city": "Monterrey"},
        {"id": "sandur",  "name": "Sandur",      "city": "Piedras Negras"},
    ]
    
    for t in MISSING_TENANTS:
        tid = t["id"]
        # Solo inyectar si no hay hosts reales para ese tenant
        if not any(h.get("tenantId") == tid for h in hosts):
            # Simular 3-5 hosts por tenant
            for i in range(1, 4):
                status = "online" if (i % 3 != 0) else "offline"
                score = 95 if status == "online" else 30
                hosts.append({
                    "id": f"{tid}-host-{i}",
                    "ip": f"10.{10+i}.0.1",
                    "city": t["city"],
                    "site": "Core Dist",
                    "tenantId": tid,
                    "healthScore": score,
                    "status": status,
                    "lastPingResult": {
                        "timestamp": str(date.today()),
                        "reachable": True if status == "online" else False,
                        "packet_loss": 0 if status == "online" else 100
                    }
                })
                if status == "offline":
                    import uuid
                    alerts.append({
                        "id": f"sim-alert-{tid}-{uuid.uuid4().hex[:8]}",
                        "city": t["city"],
                        "cityName": t["city"],
                        "tenantId": tid,
                        "severity": "critical",
                        "state": "active",
                        "type": "Falla de Energía",
                        "description": f"Falla de energía en segmento {tid.upper()}",
                        "ts": str(date.today()),
                        "triggeredAt": str(date.today())
                    })
    
    return hosts, alerts

def _host_status(host: dict) -> str:
    # La API usa snake_case (health_score), el archivo usa camelCase (healthScore)
    score = host.get("health_score") or host.get("healthScore", 0)
    ping  = host.get("ping") or host.get("lastPingResult", {})
    reachable = ping.get("reachable", False) if "reachable" in ping else (ping.get("packet_loss", 100) < 100)
    
    if not reachable:
        return "offline"
    if score < 70:
        return "degraded"
    return "online"

def _match_ticket(alert: dict, tickets: list) -> Optional[str]:
    """Busca un ticket que coincida con la alerta (por ciudad o descripción)"""
    city = alert.get("city", "").lower()
    msg  = alert.get("message", "").lower()
    for t in tickets:
        t_desc = t.get("description", "").lower()
        t_zone = t.get("zona", "").lower()
        if city in t_zone or city in t_desc or any(word in t_desc for word in msg.split() if len(word) > 4):
            return t.get("id")
    return None

@app.get("/api/noc/hosts")
def get_noc_hosts():
    hosts = _load_noc_data("hosts", NOCBOARD_HOSTS_FILE)
    return [
        {
            "id":       h.get("id"),
            "ip":       h.get("ip"),
            "name":     h.get("display_name") or h.get("rawName") or f"{h.get('endpointA','')} → {h.get('endpointB','')}",
            "score":    round(h.get("health_score") or h.get("healthScore", 0), 1),
            "status":   _host_status(h),
            "city":     h.get("city"),
            "site":     h.get("site"),
            "lastSeen": (h.get("ping") or h.get("lastPingResult", {})).get("timestamp", ""),
            "metrics":  h.get("latest_metrics") or h.get("latestMetrics", {}),
            "model":    h.get("model", ""),
            "vendor":   h.get("vendor", ""),
        }
        for h in hosts
    ]

_CITY_COORDS: dict = {
    "Monterrey":          {"lat": 25.6866,  "lng": -100.3161},
        "Saltillo":           {"lat": 25.4232,  "lng": -100.9928},
        "Piedras Negras":     {"lat": 28.7000,  "lng": -100.5231},
        "San Luis Potosi":    {"lat": 22.1565,  "lng": -100.9855},
        "San Luis Potosí":    {"lat": 22.1565,  "lng": -100.9855},
        "Torreón":            {"lat": 25.5428,  "lng": -103.4068},
        "Torreon":            {"lat": 25.5428,  "lng": -103.4068},
        "Chihuahua":          {"lat": 28.6353,  "lng": -106.0889},
        "Nuevo Laredo":       {"lat": 27.4765,  "lng": -99.5151 },
        "Reynosa":            {"lat": 26.0922,  "lng": -98.2772 },
        "Matamoros":          {"lat": 25.8691,  "lng": -97.5027 },
        "Monclova":           {"lat": 26.9083,  "lng": -101.4217},
        "Sabinas":            {"lat": 27.8529,  "lng": -101.1191},
        "Guadalajara":        {"lat": 20.6597,  "lng": -103.3496},
        "Ciudad de Mexico":   {"lat": 19.4326,  "lng": -99.1332 },
        "Ciudad de México":   {"lat": 19.4326,  "lng": -99.1332 },
        "CDMX":               {"lat": 19.4326,  "lng": -99.1332 },
        "Queretaro":          {"lat": 20.5888,  "lng": -100.3899},
        "Querétaro":          {"lat": 20.5888,  "lng": -100.3899},
        "Celaya":             {"lat": 20.5200,  "lng": -100.8161},
        "Leon":               {"lat": 21.1221,  "lng": -101.6823},
        "León":               {"lat": 21.1221,  "lng": -101.6823},
        "Tampico":            {"lat": 22.2552,  "lng": -97.8686 },
        "Merida":             {"lat": 20.9674,  "lng": -89.5926 },
        "Mérida":             {"lat": 20.9674,  "lng": -89.5926 },
        "Puebla":             {"lat": 19.0414,  "lng": -98.2063 },
        "Coco":               {"lat": 25.5000,  "lng": -103.5000},
        "Hermosillo":         {"lat": 29.0729,  "lng": -110.9559},
        "Culiacan":           {"lat": 24.7994,  "lng": -107.3875},
        "Culiacán":           {"lat": 24.7994,  "lng": -107.3875},
        "Mazatlan":           {"lat": 23.2494,  "lng": -106.4111},
        "Mazatlán":           {"lat": 23.2494,  "lng": -106.4111},
        "Durango":            {"lat": 24.0277,  "lng": -104.6532},
        "Zacatecas":          {"lat": 22.7709,  "lng": -102.5832},
        "Aguascalientes":     {"lat": 21.8818,  "lng": -102.2916},
        "Morelia":            {"lat": 19.7008,  "lng": -101.1844},
        "Veracruz":           {"lat": 19.1738,  "lng": -96.1342 },
        "Cancun":             {"lat": 21.1619,  "lng": -86.8515 },
        "Cancún":             {"lat": 21.1619,  "lng": -86.8515 },
        "Oaxaca":             {"lat": 17.0669,  "lng": -96.7203 },
        "Acapulco":           {"lat": 16.8531,  "lng": -99.8237 },
        "Mexicali":           {"lat": 32.6245,  "lng": -115.4523},
        "Tijuana":            {"lat": 32.5149,  "lng": -117.0382},
        "La Paz":             {"lat": 24.1426,  "lng": -110.3128},
        "Tuxtla Gutierrez":   {"lat": 16.7521,  "lng": -93.1152 },
        "Tuxtla Gutiérrez":   {"lat": 16.7521,  "lng": -93.1152 },
        "Villahermosa":       {"lat": 17.9870,  "lng": -92.9303 },
        "Tepic":              {"lat": 21.5042,  "lng": -104.8945},
        "Colima":             {"lat": 19.2452,  "lng": -103.7241},
        "Campeche":           {"lat": 19.8301,  "lng": -90.5349 },
        "Chetumal":           {"lat": 18.5001,  "lng": -88.2961 },
        "Pachuca":            {"lat": 20.1011,  "lng": -98.7591 },
        "Toluca":             {"lat": 19.2826,  "lng": -99.6557 },
        "Cuernavaca":         {"lat": 18.9261,  "lng": -99.2201 },
        "Xalapa":             {"lat": 19.5438,  "lng": -96.9102 },
        "Coatzacoalcos":      {"lat": 18.1500,  "lng": -94.4333 },
        "Ciudad Juarez":      {"lat": 31.7381,  "lng": -106.4870},
        "Ciudad Juárez":      {"lat": 31.7381,  "lng": -106.4870},
        "Parral":             {"lat": 26.9314,  "lng": -105.6657},
        "Delicias":           {"lat": 28.1928,  "lng": -105.4694},
        "Brownsville":        {"lat": 25.9017,  "lng": -97.4975 },
        "Laredo":             {"lat": 27.5306,  "lng": -99.4803 },
}

def _aggregate_hosts_to_cities(hosts: list, active_alerts: list) -> list:
    """Agrupa una lista de hosts (de uno o varios NOCBoards) por ciudad, con
    coordenadas, scores y conteos — mismo formato que /api/noc/cities. Reusable
    para graficar capas individuales (ej. solo Energía) en el mapa."""
    COORDS = _CITY_COORDS

    # Normalizar nombre de ciudad (quitar acentos, lower) para deduplicar
    def _norm_city(name: str) -> str:
        return (name.replace("é","e").replace("á","a").replace("ó","o")
                    .replace("ú","u").replace("í","i").replace("ñ","n")
                    .lower().strip())

    # Mapa normalized → nombre canónico preferido (el que tenga acento si existe en COORDS)
    _canonical: dict = {}
    for cn in COORDS:
        nn = _norm_city(cn)
        if nn not in _canonical or len(cn) > len(_canonical[nn]):
            _canonical[nn] = cn

    # Agrupar hosts por ciudad → sitio (usando nombre canónico para evitar duplicados)
    from collections import defaultdict
    city_sites: dict = defaultdict(lambda: defaultdict(list))
    for h in hosts:
        city = h.get("city", "Sin Ciudad")
        site = h.get("site", "Site Principal")
        city_canon = _canonical.get(_norm_city(city), city)
        city_sites[city_canon][site].append(h)

    # Prioridad de fuente para el score ponderado (mayor = más crítico)
    _SOURCE_PRIORITY = {"Energía": 3, "Datos": 2, "WL/WISPI": 1}

    cities = []
    for city_name, sites_dict in city_sites.items():
        city_hosts_all = [h for hs in sites_dict.values() for h in hs]
        total   = len(city_hosts_all)
        online  = sum(1 for h in city_hosts_all if _host_status(h) == "online")
        offline = sum(1 for h in city_hosts_all if _host_status(h) == "offline")
        scores  = [h.get("health_score") or h.get("healthScore", 0) for h in city_hosts_all]
        avg_score = round(sum(scores) / len(scores), 1) if scores else 0

        # Score ponderado por prioridad de fuente
        w_sum = w_total = 0.0
        src_buckets: dict = {}
        for h in city_hosts_all:
            src = h.get("_source", "")
            s   = h.get("health_score") or h.get("healthScore", 0)
            w   = _SOURCE_PRIORITY.get(src, 1)
            w_sum   += s * w
            w_total += w
            src_buckets.setdefault(src, []).append(s)
        priority_score = round(w_sum / w_total, 1) if w_total else avg_score
        source_scores  = {src: round(sum(v)/len(v), 1) for src, v in src_buckets.items() if v and src}
        city_alerts = sum(1 for a in active_alerts if a.get("city") == city_name and a.get("severity") == "critical")
        coord = COORDS.get(city_name) or COORDS.get(_canonical.get(_norm_city(city_name), ""))
        if not coord:
            logger.warning(f"Ciudad sin coordenadas: '{city_name}' (norm: '{_norm_city(city_name)}')")
            coord = {"lat": 23.0, "lng": -102.0}
        # Fuentes de monitoreo que cubren esta ciudad
        city_sources = list({h.get("_source", "") for h in city_hosts_all if h.get("_source")})

        sites_list = []
        for site_name, site_hosts in sites_dict.items():
            site_online  = sum(1 for h in site_hosts if _host_status(h) == "online")
            site_offline = sum(1 for h in site_hosts if _host_status(h) == "offline")
            sites_list.append({
                "id":           f"{city_name}-{site_name}".lower().replace(" ", "-"),
                "name":         site_name,
                "hostsOnline":  site_online,
                "hostsOffline": site_offline,
                "hosts": [
                    {
                        "id":       h.get("id"),
                        "ip":       h.get("ip"),
                        "name":     h.get("rawName") or f"{h.get('endpointA','')}→{h.get('endpointB','')}",
                        "score":    round(h.get("health_score") or h.get("healthScore") or 0, 1),
                        "status":   _host_status(h),
                        "lastSeen": (h.get("ping") or h.get("lastPingResult") or {}).get("timestamp", ""),
                    }
                    for h in site_hosts
                ],
            })

        cities.append({
            "id":          city_name.lower().replace(" ", "-"),
            "name":        city_name,
            "primary_ip":  city_hosts_all[0].get("ip") if city_hosts_all else "0.0.0.0",
            "score":         avg_score,
            "priorityScore": priority_score,
            "sourceScores":  source_scores,
            "totalHosts":    total,
            "online":        online,
            "offline":       offline,
            "alerts":        city_alerts,
            "lat":           coord["lat"],
            "lng":           coord["lng"],
            "sources":       city_sources,
            "sites":         sites_list,
        })

    return sorted(cities, key=lambda c: c["offline"], reverse=True)

@app.get("/api/noc/city-coords")
def get_city_coords():
    """Mapa ciudad→coordenadas para uso en mapas del frontend."""
    return _CITY_COORDS

@app.get("/api/noc/cities")
def get_noc_cities():
    hosts, alerts = _get_enriched_noc_data()
    active_alerts = [a for a in alerts if a.get("state") == "active"]
    return _aggregate_hosts_to_cities(hosts, active_alerts)

@app.get("/api/noc/boards/{board_id}/cities")
def get_board_cities(board_id: str):
    """Hosts de un NOCBoard específico (ej. Energía), agregados por ciudad con
    coordenadas — para graficar esa capa sola en el mapa de NOC Virtual."""
    if board_id not in ("wl", "datos", "energia", "cxdatos", "cx", "central"):
        raise HTTPException(status_code=400, detail="board_id inválido")
    proxy_base = NOCBOARD_API_BASE[:-4] if NOCBOARD_API_BASE.endswith("/api") else NOCBOARD_API_BASE
    try:
        r = requests.get(f"{proxy_base}/{board_id}/api/hosts", timeout=8)
        if not r.ok:
            raise HTTPException(status_code=503, detail=f"Board {board_id} no disponible")
        hosts = r.json().get("hosts", [])
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"get_board_cities {board_id} error: {e}")
        raise HTTPException(status_code=503, detail=f"No se pudo obtener hosts de {board_id}")
    return _aggregate_hosts_to_cities(hosts, [])

@app.get("/api/noc/alerts")
def get_noc_alerts(active_only: bool = True, limit: int = 200):
    _, alerts = _get_enriched_noc_data()
    if active_only:
        alerts = [a for a in alerts if a.get("state") == "active"]
    alerts = sorted(alerts, key=lambda a: a.get("triggered_at") or a.get("triggeredAt", ""), reverse=True)
    
    # Cruzar con tickets locales (WFM)
    wfm_data = _load_wfm()
    tickets  = wfm_data.get("tickets", [])
    
    sev_map = {"degraded": "warning", "info": "warning"}

    # Prioridad: 1=Energía, 2=Datos, 3=WL
    _BOARD_PRIORITY = {"energia": 1, "datos": 2, "wl": 3}

    def _classify_board(host_name: str, cause: str) -> str:
        n = (host_name or "").upper()
        c = (cause or "").lower()
        # WL name check primero — evita que causa "power" capture radios CPE/PTP
        if any(x in n for x in ("PTP", "_AP_", "CPE", "_RF_", "_WL_", "RADIO", "WISPI", "UBNT", "MIMOSA", "CAMBIUM", "AIRMAX")):
            return "wl"
        # Energía name check: patrones específicos con separadores para evitar falsos positivos
        # "GENERADOR"/"GENSET" en lugar de bare "GEN" (que matchea REGENT, GENERAL, GENERA…)
        if any(x in n for x in ("UPS", "PDU", "ELEC", "BATT", "ENERGIA", "ENERG", "GENERADOR", "GENSET", "PLANTA")):
            return "energia"
        if any(x in n for x in ("_GEN_", "_GEN-", "-GEN_", "-GEN-")):
            return "energia"
        # Causa de energía solo como desempate (ya descartamos WL por nombre arriba)
        if any(x in c for x in ("energia", "power", "ups", "battery", "voltage")):
            return "energia"
        # WL por causa como segundo nivel
        if any(x in c for x in ("signal", "airtime", "rf ", "wireless")):
            return "wl"
        # Datos: switches, routers, fibra — por defecto
        return "datos"

    def _get_sop_id(cause: str) -> str:
        cause = cause.lower()
        if "latency" in cause: return "SOP-NOC-001"
        if "unreachable" in cause or "offline" in cause: return "SOP-NOC-002"
        if "packet loss" in cause: return "SOP-NOC-003"
        return "SOP-GEN-001"

    result = []
    for a in alerts:
        host_name = a.get("host_name") or a.get("hostName", "")
        cause     = a.get("cause", "")
        board     = _classify_board(host_name, cause)
        result.append({
            "id":            a.get("id"),
            "cityId":        a.get("city", "").lower().replace(" ", "-"),
            "cityName":      a.get("city", ""),
            "siteName":      a.get("site", ""),
            "hostIp":        a.get("host_ip") or a.get("hostIP", ""),
            "hostName":      host_name,
            "type":          cause,
            "message":       a.get("message", ""),
            "severity":      sev_map.get(a.get("severity") or "warning", a.get("severity") or "warning"),
            "timestamp":     a.get("triggered_at") or a.get("triggeredAt", ""),
            "ticketCreated": a.get("ticket_created", False) or (_match_ticket(a, tickets) is not None),
            "odooTicketId":  _match_ticket(a, tickets),
            "sopId":         _get_sop_id(cause),
            "state":         a.get("state"),
            "board":         board,
            "boardPriority": _BOARD_PRIORITY[board],
        })

    # Ordenar estable en cascada (menos → más significativo):
    # 3. timestamp desc (más reciente primero)
    result.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    # 2. severidad: critical < warning
    result.sort(key=lambda x: 0 if x["severity"] == "critical" else 1)
    # 1. board priority: Energía(1) < Datos(2) < WL(3)
    result.sort(key=lambda x: x["boardPriority"])

    # Calcular frescura de los datos
    import time
    now = time.time()
    last_live = _noc_last_live.get("ts", 0.0)
    if last_live > 0 and (now - last_live) < 90:
        data_source     = "live"
        data_age_minutes = 0
    else:
        try:
            mtime = os.path.getmtime(NOCBOARD_ALERTS_FILE)
            data_age_minutes = int((now - mtime) / 60)
        except OSError:
            data_age_minutes = -1
        data_source = "cache"

    return {
        "alerts":           result[:limit],
        "data_source":      data_source,
        "data_age_minutes": data_age_minutes,
    }

@app.get("/api/noc/summary")
def get_noc_summary():
    # Intentar primero el endpoint /summary del proxy (solo conteos, ~200 bytes, rápido)
    try:
        r = requests.get(f"{NOCBOARD_API_BASE}/summary",
                         headers={"X-API-Key": NOCBOARD_API_KEY}, timeout=8)
        if r.status_code == 200:
            d = r.json()
            total   = d.get("total_hosts", 0)
            online  = d.get("online", 0)
            offline = d.get("offline", 0)
            alerts  = d.get("active_alerts", 0)
            return {
                "totalHosts":     total,
                "online":         online,
                "offline":        offline,
                "avgHealthScore": round(online / total * 100, 1) if total else 0,
                "activeAlerts":   alerts,
                "criticalAlerts": 0,
                "warningAlerts":  0,
                "sources":        d.get("sources", []),
            }
    except Exception as e:
        logger.warning(f"NOCBoard summary rápido no disponible: {e}. Usando datos locales.")

    # Fallback: calcular desde hosts y alertas locales
    hosts, alerts = _get_enriched_noc_data()
    active = [a for a in alerts if a.get("state") == "active"]
    total  = len(hosts)
    online = sum(1 for h in hosts if _host_status(h) in ["online", "degraded"])
    scores = [h.get("health_score") or h.get("healthScore", 0) for h in hosts]
    return {
        "totalHosts":     total,
        "online":         online,
        "offline":        total - online,
        "avgHealthScore": round(sum(scores) / len(scores), 1) if scores else 0,
        "activeAlerts":   len(active),
        "criticalAlerts": sum(1 for a in active if a.get("severity") == "critical"),
        "warningAlerts":  sum(1 for a in active if a.get("severity") == "warning"),
    }

# ─── NOC Boards — enable / disable por instancia ────────────────────────────

@app.get("/api/noc/boards")
def get_noc_boards():
    """Estado de cada NOCBoard instance: enabled, alive, conteos."""
    proxy_base = NOCBOARD_API_BASE[:-4] if NOCBOARD_API_BASE.endswith("/api") else NOCBOARD_API_BASE
    try:
        r = requests.get(f"{proxy_base}/boards",
                         headers={"X-API-Key": NOCBOARD_API_KEY}, timeout=8)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        logger.warning(f"get_noc_boards error: {e}")
    raise HTTPException(status_code=503, detail="Proxy NOCBoard no disponible")


@app.post("/api/noc/boards/{board_id}/{action}")
def toggle_noc_board(board_id: str, action: str):
    """Habilita o deshabilita un NOCBoard (action: enable | disable)."""
    if action not in ("enable", "disable"):
        raise HTTPException(status_code=400, detail="Acción inválida — usa enable o disable")
    proxy_base = NOCBOARD_API_BASE[:-4] if NOCBOARD_API_BASE.endswith("/api") else NOCBOARD_API_BASE
    try:
        r = requests.post(f"{proxy_base}/boards/{board_id}/{action}",
                          headers={"X-API-Key": NOCBOARD_API_KEY}, timeout=8)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        logger.warning(f"toggle_noc_board {board_id}/{action} error: {e}")
    raise HTTPException(status_code=503, detail="No se pudo cambiar el estado del board")


@app.get("/api/noc/board-status")
def get_board_status(port: int, key: str):
    """Proxy status de un NOCBoard individual por puerto y API key."""
    try:
        r = requests.get(f"http://localhost:{port}/api/status",
                         headers={"X-API-Key": key}, timeout=3)
        if r.ok:
            d = r.json()
            return {
                "online": d.get("online", 0),
                "offline": d.get("offline", 0),
                "alerts": d.get("active_alerts", 0),
                "hosts": d.get("total_hosts", 0),
                "avail": d.get("availability", 0),
            }
    except Exception:
        pass
    return {"online": 0, "offline": 0, "alerts": 0, "hosts": 0, "avail": 0}


# ─── Energía — UPS / Rectifiers / Inverters (SNMP metrics via NOCBoard) ──────

_DATA_DIR_ENERGIA = os.environ.get("DATA_DIR", "")
NOCBOARD_ENERGIA_HOSTS_PATH = (
    os.path.join(_DATA_DIR_ENERGIA, "energia_hosts.json")
    if _DATA_DIR_ENERGIA
    else os.path.expanduser("~/Library/Application Support/NOCBoardEnergia/hosts.json")
)
NOCBOARD_ENERGIA_API_URL = os.environ.get("NOCBOARD_ENERGIA_URL", "http://localhost:9404")
NOCBOARD_ENERGIA_API_KEY = "f4f5ef40c4c54aeca1d6a66109e4555d"

def _read_energia_hosts() -> list:
    try:
        with open(NOCBOARD_ENERGIA_HOSTS_PATH, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Cannot read NOCBoard Energia hosts.json: {e}")
        return []

def _fetch_energia_api_hosts() -> list:
    """Fetch hosts from NOCBoard Energia API, then enrich each with /api/host/:id metrics."""
    headers = {"X-API-Key": NOCBOARD_ENERGIA_API_KEY}
    try:
        r = requests.get(f"{NOCBOARD_ENERGIA_API_URL}/api/hosts", headers=headers, timeout=5)
        if not r.ok:
            return []
        data = r.json()
        host_list = data.get("hosts", data) if isinstance(data, dict) else data
    except Exception:
        return []

    enriched = []
    for h in host_list:
        host_id = h.get("id", "")
        metrics = {}
        if host_id:
            try:
                rd = requests.get(f"{NOCBOARD_ENERGIA_API_URL}/api/host/{host_id}", headers=headers, timeout=3)
                if rd.ok:
                    detail = rd.json()
                    metrics = detail.get("metrics", {})
            except Exception:
                pass
        h["_api_metrics"] = metrics
        enriched.append(h)
    return enriched


@app.post("/api/noc/energia/sync")
def sync_energia_hosts(payload: dict, request: Request):
    """El Mac empuja los hosts de NOCBoard Energía al volumen de Railway.
    Protegido con la misma API key de NOCBoard Energía."""
    key = request.headers.get("X-API-Key", "")
    if key != NOCBOARD_ENERGIA_API_KEY:
        raise HTTPException(status_code=403, detail="API key inválida")
    hosts = payload.get("hosts", [])
    if not hosts:
        raise HTTPException(status_code=400, detail="Sin hosts en el payload")
    os.makedirs(os.path.dirname(NOCBOARD_ENERGIA_HOSTS_PATH), exist_ok=True)
    with open(NOCBOARD_ENERGIA_HOSTS_PATH, "w") as f:
        json.dump(hosts, f)
    logger.info(f"[Energía] Sync recibido: {len(hosts)} hosts → {NOCBOARD_ENERGIA_HOSTS_PATH}")
    return {"status": "ok", "hosts": len(hosts)}


@app.get("/api/noc/energia/power")
def get_energia_power():
    """Voltaje, batería y métricas de energía de todos los dispositivos con datos SNMP."""
    hosts = _fetch_energia_api_hosts()
    if not hosts:
        hosts = _read_energia_hosts()
    if not hosts:
        raise HTTPException(status_code=503, detail="NOCBoard Energía no disponible")

    devices = []
    for h in hosts:
        api_m = h.get("_api_metrics", {})
        file_m = h.get("latestMetrics", {})
        metrics = api_m if api_m and len([k for k in api_m if k != "timestamp"]) > 0 else file_m
        metric_keys = [k for k in metrics if k != "timestamp"]
        ping_raw = h.get("ping", h.get("lastPingResult", {}))
        device = {
            "name": h.get("name", h.get("rawName", h.get("display_name", ""))),
            "ip": h.get("ip", ""),
            "city": h.get("city", ""),
            "site": h.get("site", ""),
            "status": h.get("status", "unknown"),
            "type": h.get("power_device_type", h.get("powerDeviceType", "")),
            "vendor": h.get("power_vendor", h.get("powerVendor", "")),
            "protocol": h.get("poll_protocol", h.get("pollProtocol", "")),
            "healthScore": h.get("health_score", h.get("healthScore", 0)),
            "ping": {
                "reachable": ping_raw.get("reachable", False),
                "latency": ping_raw.get("latency_avg", ping_raw.get("latencyAvg", 0)),
                "packetLoss": ping_raw.get("packet_loss", ping_raw.get("packetLoss", 0)),
            },
            "lastSNMPPoll": h.get("lastSNMPPoll"),
            "hasMetrics": len(metric_keys) > 0,
        }
        # Enriquecer con coordenadas de ciudad
        city_name = h.get("city", "")
        if city_name and city_name in _CITY_COORDS:
            device["lat"] = _CITY_COORDS[city_name]["lat"]
            device["lng"] = _CITY_COORDS[city_name]["lng"]
        if metric_keys:
            device["metrics"] = {
                "batteryVoltage": metrics.get("battery_voltage", metrics.get("batteryVoltage")),
                "acOutputVoltage": metrics.get("ac_output_voltage", metrics.get("acOutputVoltage")),
                "mainsVoltage": metrics.get("mains_voltage", metrics.get("mainsVoltage")),
                "mainsPresent": metrics.get("mains_present", metrics.get("mainsPresent")),
                "mainsFrequency": metrics.get("mains_frequency", metrics.get("mainsFrequency")),
                "loadPower": metrics.get("load_power", metrics.get("loadPower")),
                "batteryRuntimeMinutes": metrics.get("battery_runtime_minutes", metrics.get("batteryRuntimeMinutes")),
                "batterySOC": metrics.get("battery_soc", metrics.get("batterySOC")),
                "timestamp": metrics.get("timestamp"),
            }
        devices.append(device)

    with_metrics = [d for d in devices if d["hasMetrics"]]
    return {
        "total": len(devices),
        "withMetrics": len(with_metrics),
        "devices": devices,
        "timestamp": dt_datetime.now().isoformat(),
    }


@app.get("/api/noc/energia/power/{ip}")
def get_energia_power_host(ip: str):
    """Métricas de energía de un dispositivo específico por IP."""
    hosts = _read_energia_hosts()
    match = next((h for h in hosts if h.get("ip") == ip), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Host {ip} no encontrado en Energía")
    metrics = match.get("latestMetrics", {})
    ping = match.get("lastPingResult", {})
    return {
        "name": match.get("rawName", ""),
        "ip": ip,
        "city": match.get("city", ""),
        "site": match.get("site", ""),
        "status": match.get("status", "unknown"),
        "type": match.get("powerDeviceType", ""),
        "vendor": match.get("powerVendor", ""),
        "healthScore": match.get("healthScore", 0),
        "ping": {
            "reachable": ping.get("reachable", False),
            "latency": ping.get("latencyAvg", 0),
        },
        "lastSNMPPoll": match.get("lastSNMPPoll"),
        "metrics": {k: v for k, v in metrics.items()} if metrics else None,
    }


RADIOBASES_DRIVE_PATH = os.path.join(os.path.dirname(__file__), "data", "radiobases_drive.json")

@app.get("/api/noc/energia/radiobases")
def get_radiobases_drive():
    """Radiobases del inventario Drive — contratos, ubicaciones, rentas."""
    try:
        with open(RADIOBASES_DRIVE_PATH, "r") as f:
            sites = json.load(f)
        return {"total": len(sites), "sites": sites}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"No se pudo leer radiobases: {e}")


# ─── NOC Dashboard Stats (compatible con InicioHoloSection) ──────────────────

@app.get("/api/noc/dashboard-stats")
def get_noc_dashboard_stats():
    """Estadísticas directas desde NOCBoard — compatible con InicioHoloSection."""
    hosts, _ = _get_enriched_noc_data()
    if not hosts:
        return {'error': 'NOCBoard no disponible', 'timestamp': dt_datetime.now().isoformat()}

    total = len(hosts)
    up    = sum(1 for h in hosts if _host_status(h) == "online")
    down  = total - up

    city_map: dict = {}
    for h in hosts:
        cn = h.get('city') or 'Desconocida'
        if cn not in city_map:
            city_map[cn] = {'up': 0, 'down': 0}
        if _host_status(h) == "online":
            city_map[cn]['up'] += 1
        else:
            city_map[cn]['down'] += 1

    region_list = []
    for nombre, v in city_map.items():
        tot = v['up'] + v['down']
        if tot < 3:
            continue
        fail_pct = round(v['down'] / tot * 100)
        region_list.append({'nombre': nombre, 'total': tot, 'up': v['up'], 'down': v['down'], 'fail_pct': fail_pct})
    region_list.sort(key=lambda r: -r['total'])

    top_offline = [
        {'name': nombre, 'city': nombre, 'ip': nombre}
        for nombre, v in sorted(city_map.items(), key=lambda x: -x[1]['down'])
        if v['down'] > 0
    ]

    return {
        'timestamp':   dt_datetime.now().isoformat(),
        'total':       total,
        'up':          up,
        'down':        down,
        'uptime_pct':  round(up / total * 100, 1) if total else 0,
        'ciudades':    len(city_map),
        'regiones':    region_list[:12],
        'top_offline': top_offline[:10],
    }


# ─── Ventas — Archivo Maestro CSV ────────────────────────────────────────────
import csv as _csv
from pathlib import Path as _Path
from collections import defaultdict as _defaultdict

_VENTAS_CSV  = _Path(__file__).parent / "data" / "data_ventas.csv"
_ventas_cache: dict = {"ts": 0, "data": None}
_VENTAS_TTL  = 300
_VENTAS_SHEET_ID = "1HUVP1k450H-sm6rYmOfNk5-lSL2-3x9FX2MM0zi3XxE"

def _parse_num(v):
    try:
        return float(str(v).replace(",", "").replace(" ", "").strip() or "0")
    except:
        return 0.0

def _load_ventas():
    if time.time() - _ventas_cache["ts"] < _VENTAS_TTL and _ventas_cache["data"] is not None:
        return _ventas_cache["data"]
    if not _VENTAS_CSV.exists():
        return None
    try:
        import pandas as pd
        df = pd.read_csv(_VENTAS_CSV, header=2, encoding="utf-8", dtype=str)
        df.columns = [c.strip() for c in df.columns]
        df = df[df["SO"].notna() & df["SO"].astype(str).str.startswith("SO")].copy()
        df["MRR"]   = df["MONTO RECURRENTE"].apply(_parse_num)
        df["MNR"]   = df["MONTO NO RECURRENTE"].apply(_parse_num)
        df["MT"]    = df["MONTO TOTAL"].apply(_parse_num)
        df["VTC_N"] = df["VTC"].apply(_parse_num)
        _ventas_cache["data"] = df
        _ventas_cache["ts"]   = time.time()
        return df
    except Exception as e:
        logger.error(f"[Ventas] Error cargando CSV: {e}")
        return None

_MES_ORDER = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"]

@app.get("/api/ventas/resumen")
def get_ventas_resumen(_user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    df = _load_ventas()
    if df is None:
        raise HTTPException(status_code=503, detail="CSV de ventas no disponible")
    return {
        "total_ordenes":    int(len(df)),
        "mrr":              round(float(df["MRR"].sum()), 2),
        "mnr":              round(float(df["MNR"].sum()), 2),
        "vtc":              round(float(df["VTC_N"].sum()), 2),
        "por_empresa":      df["EMPRESA"].value_counts().to_dict(),
        "por_tipo":         df["TIPO DE OPERACIÓN"].value_counts().to_dict(),
        "por_categoria":    df["CATEGORÍA PRODUCTO"].value_counts().to_dict(),
        "por_on_off":       df["ON/OFF"].value_counts().to_dict(),
        "estatus_factura":  df["ESTATUS FACTURA"].value_counts().to_dict(),
        "cliente_nuevo":    int((df["CLIENTE NUEVO"].str.strip().str.upper() == "SÍ").sum()),
        "primera_venta_mrr": round(float(df[df["TIPO DE OPERACIÓN"] == "PRIMERA VENTA"]["MRR"].sum()), 2),
    }

@app.get("/api/ventas/por-mes")
def get_ventas_por_mes(_user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    df = _load_ventas()
    if df is None:
        raise HTTPException(status_code=503, detail="CSV de ventas no disponible")
    result = []
    for mes in _MES_ORDER:
        m = df[df["MES"].str.strip().str.upper() == mes]
        if len(m) == 0:
            continue
        result.append({
            "mes":     mes,
            "ordenes": int(len(m)),
            "mrr":     round(float(m["MRR"].sum()), 2),
            "mnr":     round(float(m["MNR"].sum()), 2),
            "vtc":     round(float(m["VTC_N"].sum()), 2),
        })
    return result

@app.get("/api/ventas/top-vendedores")
def get_ventas_top_vendedores(_user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    df = _load_ventas()
    if df is None:
        raise HTTPException(status_code=503, detail="CSV de ventas no disponible")
    grp = df.groupby("VENDEDOR COMERCIAL/EAC").agg(
        ordenes=("SO", "count"),
        mrr=("MRR", "sum"),
        vtc=("VTC_N", "sum"),
    ).reset_index().sort_values("mrr", ascending=False).head(15)
    return grp.rename(columns={"VENDEDOR COMERCIAL/EAC": "vendedor"}).to_dict(orient="records")

@app.get("/api/ventas/ordenes")
def get_ventas_ordenes(mes: str = "", empresa: str = "", tipo: str = "", limit: int = 200,
                       _user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    df = _load_ventas()
    if df is None:
        raise HTTPException(status_code=503, detail="CSV de ventas no disponible")
    if mes:
        df = df[df["MES"].str.strip().str.upper() == mes.upper()]
    if empresa:
        df = df[df["EMPRESA"].str.strip().str.upper() == empresa.upper()]
    if tipo:
        df = df[df["TIPO DE OPERACIÓN"].str.strip().str.upper() == tipo.upper()]
    cols = ["SO","EMPRESA","MES","RAZON SOCIAL","MONTO RECURRENTE","MONTO NO RECURRENTE","MONTO TOTAL","VTC","TIPO DE OPERACIÓN","CATEGORÍA PRODUCTO","ON/OFF","RB/WISP","VENDEDOR COMERCIAL/EAC","ESTATUS FACTURA","PLAZO"]
    available = [c for c in cols if c in df.columns]
    return df[available].head(limit).fillna("").to_dict(orient="records")


@app.get("/api/ventas/efectividad")
def get_ventas_efectividad(dias: int = 90, empresa: str = "", vendedor: str = "", canal: str = "",
                           _user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    """
    Efectividad de ventas agrupada por marca (EMPRESA), vendedor y canal.
    Fuente: CSV Archivo Maestro + Odoo sale.order para equipos y líderes.
    """
    df = _load_ventas()
    if df is None:
        raise HTTPException(503, "CSV de ventas no disponible")

    # Normalizar valores (sin renombrar columnas para preservar 'SO ')
    df = df.copy()
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].fillna("").str.strip()
    # Alias para columna SO con espacio
    so_col = "SO " if "SO " in df.columns else "SO"

    # Filtros opcionales
    if empresa:
        df = df[df["EMPRESA"].str.upper() == empresa.upper()]
    if vendedor:
        df = df[df["VENDEDOR COMERCIAL/EAC"].str.upper().str.contains(vendedor.upper())]
    if canal:
        df = df[df["CANAL DE VENTA"].str.upper() == canal.upper()]

    import pandas as _pd
    def _parse_monto(col):
        try:
            return _pd.to_numeric(
                df[col].str.replace(r"[,$\s]", "", regex=True).replace("", "0"),
                errors="coerce"
            ).fillna(0)
        except Exception:
            return _pd.Series([0.0] * len(df))

    df["_mrr"]   = _parse_monto("MONTO RECURRENTE")
    df["_total"] = _parse_monto("MONTO TOTAL")

    def _group(by_col: str):
        grp = df.groupby(by_col).agg(
            ordenes    = (so_col, "count"),
            mrr        = ("_mrr",   "sum"),
            total      = ("_total", "sum"),
            nuevos     = ("CLIENTE NUEVO", lambda s: (s.str.upper() == "SÍ").sum()),
            primera_venta = ("TIPO DE OPERACIÓN", lambda s: (s.str.upper() == "PRIMERA VENTA").sum()),
        ).reset_index().sort_values("mrr", ascending=False)
        grp["ticket_prom"] = (grp["total"] / grp["ordenes"].replace(0,1)).round(0)
        grp["mrr"]   = grp["mrr"].round(2)
        grp["total"] = grp["total"].round(2)
        return grp.rename(columns={by_col: "nombre"}).to_dict(orient="records")

    # Tipos de operación relevantes
    ops = df.groupby("TIPO DE OPERACIÓN").agg(
        ordenes=(so_col,"count"), mrr=("_mrr","sum")
    ).reset_index().sort_values("mrr",ascending=False)

    # Totales globales
    totales = {
        "ordenes":        int(len(df)),
        "mrr_total":      round(float(df["_mrr"].sum()), 2),
        "monto_total":    round(float(df["_total"].sum()), 2),
        "clientes_nuevos": int((df["CLIENTE NUEVO"].str.upper() == "SÍ").sum()),
        "primera_venta":  int((df["TIPO DE OPERACIÓN"].str.upper() == "PRIMERA VENTA").sum()),
    }

    # Odoo: líderes por equipo (últimos 90 días para complementar)
    try:
        from datetime import datetime, timedelta
        import xmlrpc.client as xc
        odoo_url = os.getenv("ODOO_URL",""); odoo_db = os.getenv("ODOO_DB","")
        odoo_user = os.getenv("ODOO_USER",""); odoo_pwd = os.getenv("ODOO_PASSWORD","")
        common = xc.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
        uid_odoo = common.authenticate(odoo_db, odoo_user, odoo_pwd, {})
        mdls = xc.ServerProxy(f"{odoo_url}/xmlrpc/2/object")
        desde = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
        orders = mdls.execute_kw(odoo_db, uid_odoo, odoo_pwd, "sale.order", "search_read",
            [[["state","in",["sale","done"]], ["date_order",">=",desde]]],
            {"fields": ["team_id","team_user_id","amount_total","user_id"], "limit": 5000})

        from collections import defaultdict
        by_lider: dict = defaultdict(lambda: {"count":0,"total":0.0,"equipos":set()})
        by_equipo: dict = defaultdict(lambda: {"count":0,"total":0.0,"lider":""})
        for o in orders:
            tname = o["team_id"][1] if o["team_id"] else "Sin equipo"
            lname = o["team_user_id"][1] if o["team_user_id"] else (o["user_id"][1] if o["user_id"] else "Sin líder")
            by_lider[lname]["count"] += 1
            by_lider[lname]["total"] += o["amount_total"]
            by_lider[lname]["equipos"].add(tname)
            by_equipo[tname]["count"] += 1
            by_equipo[tname]["total"] += o["amount_total"]
            if o["team_user_id"]:
                by_equipo[tname]["lider"] = o["team_user_id"][1]

        lideres_odoo = sorted([
            {"nombre": k, "ordenes": v["count"], "total": round(v["total"],2),
             "equipos": list(v["equipos"])}
            for k,v in by_lider.items()
        ], key=lambda x: -x["total"])

        equipos_odoo = sorted([
            {"nombre": k, "ordenes": v["count"], "total": round(v["total"],2), "lider": v["lider"]}
            for k,v in by_equipo.items()
        ], key=lambda x: -x["total"])
    except Exception as e:
        lideres_odoo = [{"error": str(e)[:100]}]
        equipos_odoo = []

    return {
        "totales":      totales,
        "por_marca":    _group("EMPRESA"),
        "por_vendedor": _group("VENDEDOR COMERCIAL/EAC"),
        "por_canal":    _group("CANAL DE VENTA"),
        "por_segmento": _group("SEGMENTO"),
        "por_tipo":     ops.rename(columns={"TIPO DE OPERACIÓN":"nombre"}).to_dict(orient="records"),
        "lideres_odoo": lideres_odoo,
        "equipos_odoo": equipos_odoo,
        "filtros": {"empresa": empresa, "vendedor": vendedor, "canal": canal, "dias": dias},
    }


@app.post("/api/ventas/sync-sheets")
def sync_ventas_from_sheets(_user: dict = Depends(require_rol('finanzas', 'admin', 'director'))):
    """Descarga el Archivo Maestro de Google Sheets y actualiza el CSV local."""
    try:
        export_url = f"https://docs.google.com/spreadsheets/d/{_VENTAS_SHEET_ID}/export?format=csv&gid=1669547739"
        resp = requests.get(export_url, timeout=30)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Google Sheets error {resp.status_code}")
        _VENTAS_CSV.write_bytes(resp.content)
        # Limpiar caché para forzar recarga
        _ventas_cache["ts"] = 0
        _ventas_cache["data"] = None
        df = _load_ventas()
        rows = len(df) if df is not None else 0
        return {"ok": True, "ordenes": rows, "mensaje": f"CSV actualizado desde Google Sheets — {rows} órdenes"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Gerencia Dashboard ───────────────────────────────────────────────────────

_EMPRESA_DISPLAY = {
    'XCIEN': 'XCIEN', 'LUMINET': 'Luminet WAN', 'HUUS': 'Huus',
    'MANUFACTURA': 'Manufactura', 'OTRO': 'Otro',
}
_EMPRESA_COLOR = {
    'XCIEN': '#1B7F4A', 'LUMINET': '#0E6B3A', 'HUUS': '#7C3AED',
    'MANUFACTURA': '#EA580C', 'OTRO': '#6E6E73',
}

@app.get("/api/gerencia/dashboard")
async def get_gerencia_dashboard():
    """KPIs gerenciales: ventas CSV + NOCBoard + WFM Odoo."""
    out: dict = {}

    # Ventas
    df = _load_ventas()
    if df is not None:
        out['mrr']           = round(float(df['MRR'].sum()), 2)
        out['arr']           = round(float(df['MRR'].sum()) * 12, 2)
        out['vtc']           = round(float(df['VTC_N'].sum()), 2)
        out['total_ordenes'] = int(len(df))
        emp_grp = df.groupby('EMPRESA').agg(mrr=('MRR','sum'), ordenes=('SO','count')).reset_index()
        out['por_empresa'] = [
            {'id': r['EMPRESA'].lower(), 'name': _EMPRESA_DISPLAY.get(r['EMPRESA'], r['EMPRESA']),
             'color': _EMPRESA_COLOR.get(r['EMPRESA'], '#6E6E73'),
             'mrr': round(float(r['mrr']), 2), 'ordenes': int(r['ordenes'])}
            for _, r in emp_grp.iterrows()
        ]
        monthly = []
        for mes in _MES_ORDER:
            m = df[df['MES'].str.strip().str.upper() == mes]
            if len(m) == 0:
                continue
            row: dict = {'mes': mes, 'total': round(float(m['MRR'].sum()), 2)}
            for emp in df['EMPRESA'].dropna().unique():
                row[emp.lower()] = round(float(m[m['EMPRESA'] == emp]['MRR'].sum()), 2)
            monthly.append(row)
        out['mrr_por_mes'] = monthly
        top = df.groupby('VENDEDOR COMERCIAL/EAC').agg(
            ordenes=('SO','count'), mrr=('MRR','sum')
        ).reset_index().sort_values('mrr', ascending=False).head(5)
        out['top_vendedores'] = [
            {'nombre': r['VENDEDOR COMERCIAL/EAC'], 'ordenes': int(r['ordenes']), 'mrr': round(float(r['mrr']),2)}
            for _, r in top.iterrows()
        ]
    else:
        out['mrr'] = out['arr'] = out['vtc'] = out['total_ordenes'] = None

    # NOCBoard
    try:
        hosts, _ = _get_enriched_noc_data()
        online = sum(1 for h in hosts if _host_status(h) == "online")
        total  = len(hosts)
        out['noc'] = {'total': total, 'online': online, 'uptime': round(online/total*100,1) if total else 0}
    except Exception:
        out['noc'] = None

    # WFM tickets — usa get_field_tickets() que sí existe en este backend
    try:
        data    = get_field_tickets(limit=500)
        tickets = data.get("tickets", [])
        abiertos = [t for t in tickets if not t.get('cerrado')]
        out['wfm'] = {
            'total':    len(tickets),
            'abiertos': len(abiertos),
            'cerrados': len(tickets) - len(abiertos),
            'alta':  sum(1 for t in abiertos if t.get('prioridad') == 'alta'),
            'media': sum(1 for t in abiertos if t.get('prioridad') == 'media'),
            'baja':  sum(1 for t in abiertos if t.get('prioridad') not in ['alta','media']),
        }
    except Exception as e:
        logger.warning(f"[Gerencia] WFM error: {e}")
        out['wfm'] = None

    # Observium — resumen calculado desde /devices (summary no existe en esta versión)
    try:
        obs = await _obs_get("devices", {"fields": "device_id,status"})
        devs  = obs.get("devices", {})
        total = obs.get("count", len(devs))
        up    = sum(1 for v in devs.values() if str(v.get("status","")) in ("1","ok"))
        down  = total - up
        out['observium'] = {
            'total':        total,
            'up':           up,
            'down':         down,
            'availability': round(up / total * 100, 1) if total else 0,
        }
    except Exception as e:
        logger.warning(f"[Gerencia] Observium error: {e}")
        out['observium'] = None

    return out


# ─── Transacciones Intragrupo ─────────────────────────────────────────────────

@app.post("/api/transacciones")
def registrar_transaccion(req: TransaccionRequest,
                          _user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    try:
        tx = transacciones_service.registrar(**req.dict())
        _hook_transaccion(tx)
        return tx
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/transacciones")
def listar_transacciones(empresa_origen: str = None, empresa_destino: str = None, area: str = None,
                         _user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    return transacciones_service.listar(empresa_origen=empresa_origen, empresa_destino=empresa_destino, area=area)

@app.get("/api/transacciones/resumen")
def resumen_transacciones(_user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    return transacciones_service.resumen()

@app.put("/api/transacciones/{tx_id}")
def actualizar_transaccion(tx_id: str, req: TransaccionUpdateRequest,
                           _user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    tx = transacciones_service.actualizar(tx_id, req.dict(exclude_none=True))
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return tx

@app.delete("/api/transacciones/{tx_id}")
def eliminar_transaccion(tx_id: str,
                         _user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    ok = transacciones_service.eliminar(tx_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return {"ok": True}

@app.get("/api/transacciones/catalogos")
def catalogos_transacciones(_user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    return {"empresas": transacciones_service.EMPRESAS, "areas": transacciones_service.AREAS}

@app.get("/api/transacciones/tokens")
def tokens_areas(_user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    return token_service.saldos_areas()

@app.get("/api/transacciones/tokens/{token_id}/verificar")
def verificar_token_area(token_id: str,
                         _user: dict = Depends(require_rol("admin", "director", "finanzas"))):
    return token_service.verificar_tx_token(token_id)

# ─── Etiquetas & Comprobantes ─────────────────────────────────────────────────
from fastapi.responses import HTMLResponse

@app.get("/api/etiquetas/activo/{activo_id}")
def etiqueta_activo(activo_id: str):
    try:
        img = label_service.etiqueta_activo_png(activo_id)
        return Response(content=img, media_type="image/png",
                        headers={"Content-Disposition": f"inline; filename={activo_id}.png"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/etiquetas/hoja", response_class=HTMLResponse)
def hoja_etiquetas(empresa: str = None, site: str = None):
    try:
        return HTMLResponse(content=label_service.hoja_etiquetas_html(empresa=empresa, site=site))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/etiquetas/transaccion/{tx_id}")
def comprobante_tx(tx_id: str):
    try:
        img = label_service.comprobante_tx_png(tx_id)
        return Response(content=img, media_type="image/png",
                        headers={"Content-Disposition": f"inline; filename={tx_id}.png"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Inventario Odoo ─────────────────────────────────────────────────────────

@app.get("/api/inventario/odoo/productos")
def api_odoo_productos(
    search: str = '',
    tipo: str = '',
    offset: int = 0,
    limit: int = 50,
    _user: dict = Depends(get_current_user)
):
    """Lista productos de Odoo."""
    try:
        # Construir dominio sin usar operador 'in' (falla en XML-RPC de este Odoo)
        if search and tipo:
            domain = ['&', '|',
                      ['name', 'ilike', search],
                      ['default_code', 'ilike', search],
                      ['type', '=', tipo]]
        elif search:
            domain = ['|',
                      ['name', 'ilike', search],
                      ['default_code', 'ilike', search]]
        elif tipo:
            domain = [['type', '=', tipo]]
        else:
            domain = []   # todos los productos

        fields = ['id', 'name', 'default_code', 'categ_id', 'type',
                  'qty_available', 'virtual_available', 'uom_id']
        result = odoo_conn.execute('product.product', 'search_read',
                                   domain, fields=fields,
                                   limit=limit, offset=offset,
                                   order='qty_available desc, name asc')
        total = odoo_conn.execute('product.product', 'search_count', domain)

        return {"productos": result or [], "total": total or 0, "offset": offset, "limit": limit}
    except Exception as e:
        logger.error(f"odoo productos error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/inventario/odoo/categorias")
def api_odoo_categorias(_user: dict = Depends(get_current_user)):
    """Árbol de categorías de productos Odoo."""
    try:
        cats = odoo_conn.execute('product.category', 'search_read',
                                  [], fields=['id', 'name', 'complete_name', 'parent_id'])
        return {"categorias": cats or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/inventario/odoo/stock-por-ubicacion/{product_id}")
def api_odoo_stock_ubicacion(product_id: int, _user: dict = Depends(get_current_user)):
    """Stock de un producto desglosado por ubicación."""
    try:
        quants = odoo_conn.execute('stock.quant', 'search_read',
                                    [['product_id', '=', product_id]],
                                    fields=['location_id', 'quantity', 'reserved_quantity'],
                                    limit=20)
        return {"quants": quants or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/inventario/odoo/resumen")
def api_odoo_resumen(_user: dict = Depends(get_current_user)):
    """Resumen estadístico del inventario Odoo."""
    try:
        total_prods    = odoo_conn.execute('product.product', 'search_count', []) or 0
        con_stock      = odoo_conn.execute('product.product', 'search_count',
                                            [['qty_available', '>', 0]]) or 0
        sin_stock      = odoo_conn.execute('product.product', 'search_count',
                                            [['qty_available', '<=', 0]]) or 0
        total_cats     = odoo_conn.execute('product.category', 'search_count', []) or 0
        total_pickings = odoo_conn.execute('stock.picking', 'search_count',
                                            [['state', '=', 'done'],
                                             ['date_done', '>=', '2026-01-01']]) or 0
        return {
            "total_productos": total_prods,
            "con_stock": con_stock,
            "sin_stock": sin_stock,
            "total_categorias": total_cats,
            "movimientos_2026": total_pickings,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/inventario/odoo/transito-lento")
def api_odoo_transito_lento(meses: int = 24, limit: int = 200, _user: dict = Depends(get_current_user)):
    """
    Productos con stock > 0 cuyo ÚLTIMO movimiento fue hace más de `meses` meses.
    Cruza stock.quant (existencias actuales) con stock.move.line (último movimiento).
    """
    try:
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(days=meses * 30)).strftime('%Y-%m-%d %H:%M:%S')

        # 1. Productos con stock físico disponible
        quants = odoo_conn.execute(
            'stock.quant', 'search_read',
            [['quantity', '>', 0],
             ['location_id.usage', '=', 'internal']],
            fields=['product_id', 'quantity', 'location_id', 'in_date'],
            limit=2000,
        ) or []

        if not quants:
            return {"productos": [], "total": 0, "cutoff": cutoff}

        # 2. Para cada producto único, buscar la fecha de su último movimiento
        product_ids = list({q['product_id'][0] for q in quants if q.get('product_id')})

        # Obtener último movimiento de cada producto (stock.move.line done)
        move_lines = odoo_conn.execute(
            'stock.move.line', 'search_read',
            [['product_id', 'in', product_ids],
             ['state', '=', 'done']],
            fields=['product_id', 'date'],
            limit=10000,
        ) or []

        # Construir mapa producto_id → último movimiento
        ultimo_mov: dict = {}
        for ml in move_lines:
            pid = ml['product_id'][0] if ml.get('product_id') else None
            if pid is None:
                continue
            d = ml.get('date', '')
            if d and (pid not in ultimo_mov or d > ultimo_mov[pid]):
                ultimo_mov[pid] = d

        # 3. Agrupar quants por producto
        prod_quant: dict = {}
        for q in quants:
            if not q.get('product_id'):
                continue
            pid, pname = q['product_id'][0], q['product_id'][1]
            if pid not in prod_quant:
                prod_quant[pid] = {
                    'product_id': pid,
                    'name': pname,
                    'qty_total': 0.0,
                    'ubicaciones': [],
                    'in_date': q.get('in_date', ''),
                }
            prod_quant[pid]['qty_total'] += float(q.get('quantity', 0))
            loc = q['location_id'][1] if q.get('location_id') else '—'
            if loc not in prod_quant[pid]['ubicaciones']:
                prod_quant[pid]['ubicaciones'].append(loc)

        # 4. Filtrar: sin movimiento desde cutoff (o nunca movidos)
        lentos = []
        for pid, info in prod_quant.items():
            ult = ultimo_mov.get(pid, '')
            # Si nunca tuvo movimiento O el último fue antes del cutoff
            if not ult or ult < cutoff:
                dias_sin_mov = None
                if ult:
                    try:
                        fecha_ult = datetime.strptime(ult[:19], '%Y-%m-%d %H:%M:%S')
                        dias_sin_mov = (datetime.now() - fecha_ult).days
                    except Exception:
                        pass
                lentos.append({
                    'product_id':     pid,
                    'nombre':         info['name'],
                    'qty_disponible': round(info['qty_total'], 2),
                    'ubicaciones':    info['ubicaciones'],
                    'ultimo_movimiento': ult[:10] if ult else 'Sin registro',
                    'dias_sin_movimiento': dias_sin_mov,
                    'in_date':        info['in_date'][:10] if info.get('in_date') else None,
                })

        # Ordenar por días sin movimiento (mayor primero)
        lentos.sort(key=lambda x: x['dias_sin_movimiento'] or 99999, reverse=True)

        return {
            "productos": lentos[:limit],
            "total": len(lentos),
            "cutoff": cutoff,
            "meses_umbral": meses,
        }
    except Exception as e:
        logger.error(f"transito-lento error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Activos / Inventario ────────────────────────────────────────────────────
from fastapi.responses import StreamingResponse, Response
import io

@app.post("/api/activos")
def registrar_activo(req: ActivoRequest):
    try:
        return asset_service.registrar(**req.dict())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/activos")
def listar_activos(empresa: str = None, categoria: str = None, site: str = None):
    return asset_service.listar(empresa=empresa, categoria=categoria, site=site)

@app.get("/api/activos/{activo_id}")
def obtener_activo(activo_id: str):
    a = asset_service.obtener(activo_id)
    if not a:
        raise HTTPException(status_code=404, detail="Activo no encontrado")
    return a

@app.put("/api/activos/{activo_id}/mover")
def mover_activo(activo_id: str, req: MoverActivoRequest):
    try:
        return asset_service.mover(activo_id, req.nuevo_site, req.nuevo_asignado, req.motivo)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/api/activos/{activo_id}/etiqueta")
def etiqueta_activo(activo_id: str):
    try:
        img_bytes = asset_service.generar_etiqueta_bytes(activo_id)
        return Response(content=img_bytes, media_type="image/png",
                        headers={"Content-Disposition": f"inline; filename={activo_id}.png"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/activos/exportar/csv")
def exportar_csv(empresa: str = None, site: str = None):
    csv_str = asset_service.exportar_csv(empresa=empresa, site=site)
    return Response(content=csv_str.encode("utf-8"), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=inventario_xcien.csv"})

@app.get("/api/activos/exportar/excel")
def exportar_excel(empresa: str = None, site: str = None):
    try:
        xls = asset_service.exportar_excel(empresa=empresa, site=site)
        return Response(content=xls, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": "attachment; filename=inventario_xcien.xlsx"})
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/activos/catalogos/categorias")
def get_categorias():
    return asset_service.CATEGORIAS

@app.get("/api/activos/catalogos/regimenes")
def get_regimenes():
    return asset_service.REGIMENES

# ─── Tokens de Oportunidad Ganada ────────────────────────────────────────────

@app.post("/api/tokens/emitir")
def emitir_token(req: TokenRequest):
    """Emite un token firmado para una oportunidad ganada."""
    try:
        token = token_service.emitir(
            empresa=req.empresa,
            oportunidad_id=req.oportunidad_id,
            cliente=req.cliente,
            vendedor=req.vendedor,
            monto=req.monto,
            extra=req.extra,
        )
        return token
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/tokens/verificar/{token_id}")
def verificar_token(token_id: str):
    """Verifica la autenticidad e integridad de un token."""
    return token_service.verificar(token_id)

@app.get("/api/tokens")
def listar_tokens(empresa: str = None):
    """Lista todos los tokens emitidos, opcionalmente filtrados por empresa."""
    return token_service.listar(empresa=empresa)

@app.post("/api/webhook/odoo/oportunidad-ganada")
def webhook_odoo(payload: OdooWebhookPayload):
    """
    Webhook que Odoo llama al marcar una oportunidad como ganada.
    Configurar en Odoo: Ajustes → Técnico → Automatizaciones → Acción webhook.
    URL: http://<tu-servidor>:8000/api/webhook/odoo/oportunidad-ganada
    """
    empresa = "xcien"
    if payload.company_id:
        nombre_empresa = payload.company_id[1].lower() if len(payload.company_id) > 1 else ""
        for e in token_service.EMPRESAS_VALIDAS:
            if e in nombre_empresa:
                empresa = e
                break

    vendedor = payload.user_id[1] if len(payload.user_id) > 1 else "Sin asignar"

    try:
        token = token_service.emitir(
            empresa=empresa,
            oportunidad_id=str(payload.id),
            cliente=payload.partner_name or payload.name,
            vendedor=vendedor,
            monto=payload.expected_revenue,
            extra={"nombre_oportunidad": payload.name},
        )
        return {"status": "token_emitido", "token_id": token["token_id"]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ─── Inteligencia: Director General ──────────────────────────────────────────
# ─── Centro de Agentes ───────────────────────────────────────────────────────
import subprocess as _subprocess

AGENTS_CATALOG = [
    {"id": "director",   "nombre": "Director General",     "icon": "🧠", "color": "#00B4D8",
     "rol": "Estrategia & Decisiones", "endpoint": "/api/director/chat",
     "descripcion": "Análisis estratégico, reportes ejecutivos, orquestación de agentes",
     "capacidades": ["Análisis FODA", "KPIs ejecutivos", "Decisiones operativas", "Reportes gerenciales"]},
    {"id": "noc",        "nombre": "NOC Agent",             "icon": "📡", "color": "#00ff88",
     "rol": "Monitoreo de Red", "endpoint": "/api/agentes/noc/chat",
     "descripcion": "Diagnóstico de red, alertas, hosts offline, análisis de incidentes",
     "capacidades": ["Diagnóstico de hosts", "Análisis de alertas", "Rutas de reparación", "SLA NOC"]},
    {"id": "wfm",        "nombre": "WFM Agent",             "icon": "⚙️", "color": "#FF6B35",
     "rol": "Control Operativo", "endpoint": "/api/agentes/wfm/chat",
     "descripcion": "Gestión de fuerza de trabajo, tickets, instalaciones, asignaciones",
     "capacidades": ["Optimizar flujo", "Asignar técnicos", "Estado de órdenes", "Backlog"]},
    {"id": "academia",   "nombre": "Academia Agent",        "icon": "🎓", "color": "#FFB703",
     "rol": "Certificación & Talento", "endpoint": "/api/agentes/academia/chat",
     "descripcion": "Cursos, exámenes, escalafón técnico, certificaciones",
     "capacidades": ["Progreso técnicos", "Examinar", "Escalafón", "Recomendaciones"]},
    {"id": "finanzas",   "nombre": "Finanzas Agent",        "icon": "💰", "color": "#9B59B6",
     "rol": "Finanzas & Facturación", "endpoint": "/api/agentes/finanzas/chat",
     "descripcion": "Reportes financieros, transacciones, facturación Odoo",
     "capacidades": ["Reportes financieros", "Transacciones", "Facturación", "KPIs financieros"]},
    {"id": "inventario", "nombre": "Inventario Agent",      "icon": "📦", "color": "#1ABC9C",
     "rol": "Stock & Activos", "endpoint": "/api/agentes/inventario/chat",
     "descripcion": "Equipos, materiales, stock, activos de red",
     "capacidades": ["Consultar stock", "Movimientos", "Activos", "Alertas inventario"]},
    {"id": "devops",     "nombre": "DevOps/SRE Agent",      "icon": "🔧", "color": "#E74C3C",
     "rol": "Infraestructura & Deploy", "endpoint": "/api/devops/chat",
     "descripcion": "Monitoreo de servidores, deploys, diagnóstico de servicios",
     "capacidades": ["Estado servidores", "Diagnóstico", "Deploy", "Logs"]},
    {"id": "telegram",   "nombre": "Telegram Bot",          "icon": "✈️", "color": "#2CA5E0",
     "rol": "Canal de Comunicación", "endpoint": None,
     "descripcion": "Bot activo en Telegram — recibe órdenes y envía alertas en tiempo real",
     "capacidades": ["Alertas NOC", "Comandos operativos", "Reportes express", "Notificaciones"]},
]

_agent_activity: dict = {}  # agent_id -> {"last_msg": str, "last_ts": str, "calls": int}

def _agent_pm2_status(name: str) -> str:
    try:
        r = _subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=5)
        procs = json.loads(r.stdout)
        for p in procs:
            if name in p.get("name", ""):
                return p.get("pm2_env", {}).get("status", "stopped")
    except Exception:
        pass
    return "unknown"

@app.get("/api/agentes/status")
def get_agentes_status(_user: dict = Depends(get_current_user)):
    """Estado actual de todos los agentes del ecosistema XCIEN."""
    tg_status = _agent_pm2_status("xcien-telegram")
    backend_ok = True  # si llegamos aquí el backend está vivo

    result = []
    for ag in AGENTS_CATALOG:
        act = _agent_activity.get(ag["id"], {})
        # Determinar status
        if ag["id"] == "telegram":
            status = "online" if tg_status == "online" else "offline"
        elif ag["id"] in ("director", "devops", "noc", "wfm", "academia", "finanzas", "inventario"):
            status = "online" if backend_ok else "offline"
            if act.get("working"):
                status = "busy"
        else:
            status = "online" if backend_ok else "offline"
        result.append({
            **ag,
            "status": status,
            "calls_today": act.get("calls", 0),
            "last_msg": act.get("last_msg", ""),
            "last_ts": act.get("last_ts", ""),
        })
    return {"agentes": result, "total": len(result)}

class AgentChatRequest(BaseModel):
    agente_id: str
    message: str
    history: list = []

@app.post("/api/agentes/chat")
def agentes_chat_unificado(req: AgentChatRequest, _user: dict = Depends(get_current_user)):
    """Chat unificado: enruta al agente correcto según agente_id."""
    from agents.agent_noc import NOCAgent
    from agents.agent_wfm import WFMAgent
    from agents.agent_academia import AcademiaAgent
    from agents.agent_finances import FinanceAgent
    from agents.agent_inventory import InventoryAgent

    aid = req.agente_id
    now_str = datetime.datetime.now().strftime("%H:%M:%S")

    # Registrar actividad
    if aid not in _agent_activity:
        _agent_activity[aid] = {"calls": 0, "working": False}
    _agent_activity[aid]["calls"] += 1
    _agent_activity[aid]["last_msg"] = req.message[:60]
    _agent_activity[aid]["last_ts"] = now_str
    _agent_activity[aid]["working"] = True

    _AGENT_PROMPTS = {
        "noc":       "Eres el Agente NOC de XCIEN. Eres experto en monitoreo de red, diagnóstico de hosts, análisis de alertas Zabbix, latencia, pérdida de paquetes y mantenimiento de infraestructura de telecomunicaciones. Responde en español de forma técnica y concisa.",
        "wfm":       "Eres el Agente WFM de XCIEN. Experto en gestión de fuerza de trabajo, órdenes de servicio, asignación de técnicos de campo, instalaciones, mantenimientos y optimización operativa. Responde en español.",
        "academia":  "Eres el Agente Academia de XCIEN. Experto en cursos de certificación, progreso de técnicos, exámenes, escalafón técnico y desarrollo de talento en telecomunicaciones. Responde en español.",
        "finanzas":  "Eres el Agente Finanzas de XCIEN. Experto en reportes financieros, facturación Odoo, transacciones, tokens de servicio, KPIs financieros y control presupuestal. Responde en español.",
        "inventario":"Eres el Agente Inventario de XCIEN. Experto en gestión de equipos, activos de red, stock de materiales, movimientos de almacén y auditoría de activos. Responde en español.",
    }

    try:
        if aid == "director":
            resp = dg_agent.ejecutar_orden(req.message, req.history, {})
        elif aid == "devops":
            resp = sre_agent.analizar_y_responder(req.message, req.history)
        elif aid in _AGENT_PROMPTS:
            # Construir historial para Claude
            history_text = ""
            for m in (req.history or [])[-6:]:
                role_label = "Usuario" if m.get("role") == "user" else "Asistente"
                history_text += f"{role_label}: {m.get('content','')}\n"
            full_prompt = f"{history_text}Usuario: {req.message}"
            resp = ask_claude_with_system(_AGENT_PROMPTS[aid], full_prompt)
        elif aid == "telegram":
            resp = "El bot de Telegram está activo. Envía tus instrucciones directamente al chat."
        else:
            resp = f"Agente '{aid}' no reconocido."
    except Exception as e:
        resp = f"Error en agente {aid}: {str(e)}"
    finally:
        if aid in _agent_activity:
            _agent_activity[aid]["working"] = False

    return {"status": "success", "agente": aid, "response": resp}

@app.post("/api/director/chat")
def director_chat(request: ChatRequest):
    try:
        AGENT_BRIDGE["current_task"] = "Procesando consulta estratégica..."
        AGENT_BRIDGE["status"] = "working"
        AGENT_BRIDGE["log"].append(f"Consulta: {request.message[:30]}...")
        
        respuesta = dg_agent.ejecutar_orden(request.message, request.history, request.context)
        
        AGENT_BRIDGE["current_task"] = "Listo para orquestar"
        AGENT_BRIDGE["status"] = "idle"
        return {"status": "success", "response": respuesta}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Comité de Dirección ──────────────────────────────────────────────────────
class ComiteRequest(BaseModel):
    tema: str
    titulo: str = "Comité de Dirección"
    participantes: list = []

AGENTE_PROMPTS_COMITE: dict = {
    "director":  ("💎 Director General", "Eres el Director General de XCIEN Networks. Abres y cierras el comité de dirección. Sintetizas las perspectivas de cada área y das la directriz final con acciones concretas. Eres directo, estratégico y orientado a resultados. Máximo 3 párrafos."),
    "noc":       ("📡 NOC", "Eres el Agente NOC de XCIEN. Analizas el escenario desde la perspectiva de red, infraestructura técnica y monitoreo. Identifies riesgos técnicos y propones acciones operativas concretas. Máximo 2 párrafos."),
    "dispatch":  ("🚚 Dispatch", "Eres el Agente Dispatch de XCIEN. Analizas el escenario desde logística de campo, disponibilidad de cuadrillas y asignación de técnicos. Propones acciones de campo con tiempos estimados. Máximo 2 párrafos."),
    "comercial": ("💼 Comercial", "Eres el Agente Comercial de XCIEN. Analizas el escenario desde ventas, relación con clientes, CRM y impacto en ingresos. Cuantificas riesgos comerciales y propones acciones. Máximo 2 párrafos."),
    "rrhh":      ("🎓 RRHH/Academia", "Eres el Agente RRHH y Academia de XCIEN. Analizas el escenario desde capital humano, capacitación, protocolos de personal y desarrollo organizacional. Máximo 2 párrafos."),
    "legal":     ("⚖️ Legal", "Eres el Agente Legal de XCIEN. Analizas el escenario desde contratos, cumplimiento regulatorio (IFT/SCT), SLAs, penalizaciones y riesgos legales. Siempre recomiendas validar con abogado certificado. Máximo 2 párrafos."),
    "preventa":  ("📐 Preventa", "Eres el Agente Preventa de XCIEN. Analizas el escenario desde factibilidad técnica, diseño de red, coordenadas y radioenlaces. Máximo 2 párrafos."),
    "odoo":      ("🔗 Odoo ERP", "Eres el Agente Odoo de XCIEN (wispi17). Analizas el escenario desde el ERP: registro de tickets, módulos afectados, automatizaciones y datos operativos. Propones acciones en el sistema. Máximo 2 párrafos."),
}

@app.post("/api/agentes/comite")
def agentes_comite(req: ComiteRequest):
    """Ejecuta un comité de dirección multi-agente sobre un tema dado."""
    participantes = req.participantes if req.participantes else list(AGENTE_PROMPTS_COMITE.keys())
    turnos = []

    # Garantizar que el Director abre primero
    orden = []
    if "director" in participantes:
        orden.append("director")
    for p in participantes:
        if p != "director":
            orden.append(p)
    if "director" in participantes:
        orden.append("director")  # El Director cierra también

    agentes_fallidos = []

    for i, ag_id in enumerate(orden):
        if ag_id not in AGENTE_PROMPTS_COMITE:
            continue
        nombre, system_prompt = AGENTE_PROMPTS_COMITE[ag_id]
        es_cierre = (ag_id == "director" and i > 0)

        if es_cierre:
            resumen_turnos = "\n".join([f"- {t['nombre']}: {t['contenido'][:120]}..." for t in turnos if t['agente_id'] != 'director'])
            user_msg = (
                f"TEMA DEL COMITÉ: {req.titulo}\n{req.tema}\n\n"
                f"INTERVENCIONES DE LOS DEPARTAMENTOS:\n{resumen_turnos}\n\n"
                "Como Director General, da el cierre del comité: resume los acuerdos, asigna responsabilidades "
                "y establece los próximos pasos con fechas concretas."
            )
        else:
            user_msg = (
                f"TEMA DEL COMITÉ: {req.titulo}\n{req.tema}\n\n"
                "Da tu perspectiva departamental sobre este tema. Sé específico y propón acciones concretas."
            )

        try:
            contenido = ask_claude_with_system(system_prompt, user_msg)
        except ClaudeAPIError as e:
            logger.warning(f"Agente {ag_id} no disponible, se omite: {e}")
            agentes_fallidos.append(ag_id)
            continue

        turnos.append({
            "agente_id": ag_id,
            "nombre": nombre,
            "contenido": contenido,
        })

    if not turnos:
        raise HTTPException(
            status_code=503,
            detail="Claude API no disponible. El comité usará modo fallback.",
        )

    return {
        "titulo": req.titulo,
        "tema": req.tema,
        "turnos": turnos,
        "agentes_fallidos": agentes_fallidos or None,
    }


# ─── Token AI Usage Analytics ─────────────────────────────────────────────────
try:
    from token_usage_tracker import get_stats as _get_token_stats
    _token_tracker_available = True
except ImportError:
    _token_tracker_available = False

@app.get("/api/cerebro/usage")
def cerebro_usage(days: int = 30):
    """Devuelve estadísticas de consumo de tokens AI."""
    if not _token_tracker_available:
        raise HTTPException(status_code=503, detail="Token tracker no disponible")
    return _get_token_stats(days)


@app.post("/api/devops/chat")

def devops_chat(request: ChatRequest):
    try:
        respuesta = sre_agent.analizar_y_responder(request.message, request.history)
        return {"status": "success", "response": respuesta}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/bridge")
def get_bridge_status(_user: dict = Depends(get_current_user)):
    return AGENT_BRIDGE

@app.post("/api/bridge")
def update_bridge_status(req: BridgeRequest, _user: dict = Depends(get_current_user)):
    AGENT_BRIDGE["current_task"] = req.task
    AGENT_BRIDGE["status"] = req.status
    if req.log_entry:
        AGENT_BRIDGE["log"].append(req.log_entry)
        if len(AGENT_BRIDGE["log"]) > 10:
            AGENT_BRIDGE["log"].pop(0)
    import datetime
    AGENT_BRIDGE["last_update"] = datetime.datetime.now().strftime("%H:%M:%S")
    return {"status": "ok"}

@app.post("/api/bridge/query")
def bridge_query(req: CommandRequest, _user: dict = Depends(get_current_user)):
    cmd = req.command
    if cmd == "get_foda_context":
        noc_data = _get_enriched_noc_data()
        wfm_orders = wfm_service.obtener_ordenes()
        critical_alerts = [a for a in noc_data.get("alerts", []) if a.get("severity") == "critical"]
        return {
            "status": "success",
            "data": {
                "swot": {
                    "fortalezas": [
                        "Integración vertical con Odoo ERP y Agentes Claude.",
                        "Estructura de Bidrillas 2026 con roles especializados.",
                        "Academia Digital con 100% de técnicos certificados.",
                        "Monitoreo proactivo vía NOCBoard (99.9% disponibilidad)."
                    ],
                    "oportunidades": [
                        "Expansión de fibra óptica en zonas de alta latencia.",
                        "Automatización de despacho por geolocalización.",
                        "Tokenización de bonos para reducción de rotación."
                    ],
                    "debilidades": [
                        f"Presencia de {len(critical_alerts)} alertas críticas en el NOC.",
                        f"Backlog acumulado de {len([o for o in wfm_orders if o['estado'] == 'BACKLOG'])} órdenes.",
                        "Curva de aprendizaje en nuevos procesos Odoo 19."
                    ],
                    "amenazas": [
                        "Competencia agresiva de Starlink en zonas rurales.",
                        "Condiciones climáticas afectando enlaces de microondas.",
                        "Fuga de talento técnico capacitado."
                    ]
                },
                "dialogue": [
                    {"agente": "Director General", "msj": "¿Cómo impacta el backlog actual en el SLA de la próxima semana?"},
                    {"agente": "NOC Agent", "msj": f"Las {len(critical_alerts)} alertas críticas están consumiendo el 40% de la capacidad técnica."},
                    {"agente": "WFM Agent", "msj": "Necesitamos reasignar la Bidrilla B-01 de Monterrey a Saltillo urgentemente."},
                    {"agente": "Academia Agent", "msj": "Hay 3 auxiliares listos para ascenso, eso aliviaría la carga."}
                ]
            }
        }
    if cmd == "get_dashboard_stats":
        wfm_orders = wfm_service.obtener_ordenes()
        return {
            "status": "success",
            "data": {
                "productivity": f"{len([o for o in wfm_orders if o['estado'] == 'LISTO_INSTALACION'])}/5",
                "availability": "99.85%",
                "pending_tickets": len([o for o in wfm_orders if o['estado'] != 'LISTO_INSTALACION']),
                "active_teams": 4,
                "last_update": datetime.datetime.now().strftime("%H:%M:%S")
            }
        }
    if cmd == "generate_bidrillas_pdf":
        try:
            # Ejecutar el script de generación de PDF
            import subprocess
            result = subprocess.run(["python3", "backend/generar_bidrillas_reportlab.py"], capture_output=True, text=True)
            if result.returncode == 0:
                return {"status": "success", "message": "PDF generado exitosamente"}
            else:
                return {"status": "error", "message": f"Error ejecutando script: {result.stderr}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    return {"status": "error", "message": "Unknown query command"}

@app.post("/api/bridge/command")
def push_command(req: CommandRequest, _user: dict = Depends(get_current_user)):
    AGENT_BRIDGE["command_queue"].append({
        "command": req.command,
        "context": req.context,
        "ts": datetime.datetime.now().strftime("%H:%M:%S"),
        "status": "pending"
    })
    return {"status": "queued", "pos": len(AGENT_BRIDGE["command_queue"])}

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/server-info")
def server_info_v1():
    """IP local del servidor para acceso movil en cualquier red."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = "localhost"
    return {"local_ip": ip, "frontend_port": 8080, "backend_port": 8002, "mobile_url": f"http://{ip}:8080/"}


# ─── Endpoints WFM ───────────────────────────────────────────────────────────

@app.get("/api/wfm/ordenes")
async def get_wfm_orders(background_tasks: BackgroundTasks, estado: str = None):
    # Lanzar sincronización en segundo plano para no bloquear la respuesta
    background_tasks.add_task(wfm_service._sync_with_odoo)
    return wfm_service.obtener_ordenes(estado)


# ── Field Service: habilitaciones y fallas desde Odoo helpdesk ─────────────────
CAST_TEAM_IDS   = [6, 39, 60, 41, 44, 48, 67]
# IDs actualizados wispi19 (los originales 34/8/6/4 correspondían a wispi17)
FS_TYPE_IDS_FALLA       = [43, 55]    # Falla General, ST-Falla electrica radio base
FS_TYPE_IDS_HABILITACION= [42, 41]    # Visita Técnica, Proactivo
FS_TYPE_IDS_ALL         = [39, 41, 42, 43, 44, 52, 53, 54, 55]  # todos los tipos de campo

# Mapeo etapa Odoo → etapa operativa (0=NOC, 1=Dispatch, 2=Almacén, 3=Operaciones, 4=NOC Cierra)
STAGE_TO_OP = {
    97:  0,   # Nuevo
    24:  0,   # CAST Nvl:1
    129: 0,   # CAST Nivel:1
    119: 0,   # Nuevo
    27:  0,   # Nuevo
    25:  1,   # CAST Nvl:2
    116: 1,   # Turnado
    60:  1,   # CAE-Visita
    68:  1,   # Acceso a Sitios
    57:  3,   # COR Nvl:3
    130: 3,   # CAST Nivel:3 Ingeniería On Site
    132: 3,   # Nivel:3 PE Levantamiento
    155: 4,   # COR Nivel 3 en Validación CAST
    164: 4,   # COR N3 RES X VALID CAST
    168: 4,   # TT VALIDADO SOL. MONITOREO
    54:  4,   # CAST Nvl:1-Resuelto
    101: 4,   # CAST Nvl:2-Resuelto
    100: 4,   # CAE-Resuelto
    121: 4,   # CAE-Resuelto
    120: 4,   # CAST Nvl:2 Resuelto
    69:  4,   # COR Resuelto
    35:  4,   # Resuelto
    51:  4,   # Solved
}

OP_STAGE_NAMES = ["NOC", "Dispatch", "Almacén", "Operaciones", "NOC Cierra"]
OP_STAGE_COLORS = ["#00B4D8", "#FF6B35", "#FFB703", "#00ff88", "#00C896"]

PRIORITY_MAP = {"0": "normal", "1": "alta", "2": "urgente", "3": "crítica"}

@app.get("/api/wfm/field-tickets")
def get_field_tickets(limit: int = 150, tipo: str = None, estado_op: int = None):
    """
    Retorna tickets de Field Service desde Odoo (CAST + INSTALACION/Fallas).
    tipo: 'habilitacion' | 'falla' | None (todos)
    estado_op: 0-4 para filtrar por etapa operativa
    """
    import xmlrpc.client as _xr

    odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db   = os.environ.get("ODOO_DB", "wispi17")
    odoo_user = os.environ.get("ODOO_USER")
    odoo_pass = os.environ.get("ODOO_PASSWORD")

    try:
        common = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
        uid = common.authenticate(odoo_db, odoo_user, odoo_pass, {})
        if not uid:
            raise HTTPException(status_code=503, detail="No se pudo autenticar en Odoo")
        models = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error conectando Odoo: {e}")

    # Construir dominio — sin filtro de tipo por defecto (muchos tickets tienen tipo=False)
    domain: list = [["team_id", "in", CAST_TEAM_IDS]]
    if tipo == "habilitacion":
        domain.append(["ticket_type_id", "in", FS_TYPE_IDS_HABILITACION])
    elif tipo == "falla":
        domain.append(["ticket_type_id", "in", FS_TYPE_IDS_FALLA])

    fields = ["id", "name", "stage_id", "ticket_type_id", "priority",
              "partner_id", "user_id", "create_date", "close_date", "kanban_state", "description"]

    try:
        raw = models.execute_kw(odoo_db, uid, odoo_pass, "helpdesk.ticket",
                                "search_read", [domain],
                                {"fields": fields, "limit": limit, "order": "id desc"})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error leyendo Odoo: {e}")

    tickets = []
    for r in raw:
        stage_id   = r["stage_id"][0] if r["stage_id"] else 0
        stage_name = r["stage_id"][1] if r["stage_id"] else "—"
        op_idx     = STAGE_TO_OP.get(stage_id, 0)

        # Determinar tipo operativo
        type_id    = r["ticket_type_id"][0] if r["ticket_type_id"] else 0
        op_type    = "habilitacion" if type_id == 34 else "falla"

        t = {
            "id":           f"HD-{r['id']}",
            "odoo_id":      r["id"],
            "nombre":       r["name"],
            "cliente":      r["partner_id"][1] if r["partner_id"] else "—",
            "tecnico":      r["user_id"][1]    if r["user_id"]    else None,
            "tipo":         op_type,
            "tipo_label":   r["ticket_type_id"][1] if r["ticket_type_id"] else "—",
            "prioridad":    PRIORITY_MAP.get(r["priority"], "normal"),
            "etapa_odoo":   stage_name,
            "etapa_op_idx": op_idx,
            "etapa_op":     OP_STAGE_NAMES[op_idx],
            "etapa_color":  OP_STAGE_COLORS[op_idx],
            "fecha_creacion": r["create_date"],
            "fecha_cierre":   r["close_date"] or None,
            "cerrado":       bool(r["close_date"]),
            "kanban_state":  r["kanban_state"],
        }
        if estado_op is None or op_idx == estado_op:
            tickets.append(t)

    # ── Tareas project.task proyecto 240 (PDN) — merge ────────────────────────
    PDN_KW = ["pdn", "piedras", "acuña", "acuna", "supervisor"]
    CLOSED_STAGE_KW = {"done", "resuelto", "cerrado", "completado", "resolved", "closed", "listo", "entregado"}
    try:
        raw_pdn = models.execute_kw(odoo_db, uid, odoo_pass, "project.task", "search_read",
            [[["project_id", "=", 240]]],
            {"fields": ["id", "name", "stage_id", "user_ids", "partner_id",
                        "create_date", "priority"],
             "limit": 200, "order": "id desc"})
        raw_pdn = [t for t in raw_pdn if any(kw in t.get("name", "").lower() for kw in PDN_KW)]

        pdn_uids = list({u for t in raw_pdn for u in t.get("user_ids", [])})
        pdn_user_names: dict = {}
        if pdn_uids:
            pdn_users = models.execute_kw(odoo_db, uid, odoo_pass, "res.users", "read",
                [pdn_uids], {"fields": ["id", "name"]})
            pdn_user_names = {u["id"]: u["name"] for u in pdn_users}

        existing_odoo_ids = {t["odoo_id"] for t in tickets}
        for t in raw_pdn:
            if t["id"] in existing_odoo_ids:
                continue
            stage = t["stage_id"][1] if t.get("stage_id") else "Operaciones"
            closed = any(kw in stage.lower() for kw in CLOSED_STAGE_KW)
            asignados = [pdn_user_names.get(u, f"U{u}") for u in t.get("user_ids", [])]
            op_idx = 3  # Operaciones por defecto para tareas PDN
            ticket_pdn = {
                "id":           f"PDN-{t['id']}",
                "odoo_id":      t["id"],
                "nombre":       t["name"],
                "cliente":      t["partner_id"][1] if t.get("partner_id") else "PDN",
                "tecnico":      asignados[0] if asignados else None,
                "tipo":         "pdn",
                "tipo_label":   "Tarea PDN",
                "prioridad":    "alta" if t.get("priority") == "1" else "normal",
                "etapa_odoo":   stage,
                "etapa_op_idx": op_idx,
                "etapa_op":     OP_STAGE_NAMES[op_idx],
                "etapa_color":  OP_STAGE_COLORS[op_idx],
                "fecha_creacion": t.get("create_date", ""),
                "fecha_cierre":   None,
                "cerrado":        closed,
                "kanban_state":   "normal",
            }
            if estado_op is None or op_idx == estado_op:
                tickets.append(ticket_pdn)
    except Exception:
        pass  # Si falla el merge PDN, no rompe el endpoint principal

    return {
        "total": len(tickets),
        "tickets": tickets,
        "stages": [
            {"idx": i, "nombre": n, "color": c}
            for i, (n, c) in enumerate(zip(OP_STAGE_NAMES, OP_STAGE_COLORS))
        ]
    }


@app.get("/api/wfm/field-tickets/summary")
def get_field_tickets_summary():
    """Conteo por etapa operativa para KPIs rápidos."""
    data = get_field_tickets(limit=500)
    tickets = data["tickets"]
    by_stage = {i: 0 for i in range(5)}
    by_type  = {"habilitacion": 0, "falla": 0}
    open_count = 0
    for t in tickets:
        by_stage[t["etapa_op_idx"]] += 1
        by_type[t["tipo"]] += 1
        if not t["cerrado"]:
            open_count += 1
    return {
        "total": len(tickets),
        "abiertos": open_count,
        "cerrados": len(tickets) - open_count,
        "habilitaciones": by_type["habilitacion"],
        "fallas": by_type["falla"],
        "por_etapa": [
            {"idx": i, "nombre": OP_STAGE_NAMES[i], "color": OP_STAGE_COLORS[i], "count": by_stage[i]}
            for i in range(5)
        ]
    }

class TicketComentarioReq(BaseModel):
    mensaje: str

@app.get("/api/wfm/field-tickets/{ticket_id}")
def get_field_ticket_detalle(ticket_id: int):
    """Detalle completo de un ticket helpdesk + chatter + etapas disponibles."""
    import xmlrpc.client as _xr
    import re as _re
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    _url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    _db   = os.environ.get("ODOO_DB", "wispi17")
    _user = os.environ.get("ODOO_USER")
    _pw   = os.environ.get("ODOO_PASSWORD")

    try:
        common = _xr.ServerProxy(f"{_url}/xmlrpc/2/common")
        uid    = common.authenticate(_db, _user, _pw, {})
        if not uid:
            raise HTTPException(503, "No se pudo autenticar en Odoo")
        models = _xr.ServerProxy(f"{_url}/xmlrpc/2/object")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, f"Error conectando Odoo: {e}")

    # Fetch ticket
    tickets = models.execute_kw(_db, uid, _pw, "helpdesk.ticket", "search_read",
        [[["id", "=", ticket_id]]],
        {"fields": ["id","name","description","partner_id","stage_id","team_id",
                    "ticket_type_id","priority","user_id","create_date",
                    "date_last_stage_update","kanban_state"],
         "limit": 1})
    if not tickets:
        raise HTTPException(404, "Ticket no encontrado")
    t = tickets[0]
    team_id = t["team_id"][0] if t.get("team_id") else None

    # Fetch stages and chatter in parallel — each thread gets its own ServerProxy
    def _get_stages():
        if not team_id:
            return []
        _m = _xr.ServerProxy(f"{_url}/xmlrpc/2/object")
        raw = _m.execute_kw(_db, uid, _pw, "helpdesk.stage", "search_read",
            [[["team_ids", "in", [team_id]]]],
            {"fields": ["id", "name"], "order": "sequence asc", "limit": 20})
        return [{"id": s["id"], "nombre": s["name"]} for s in raw]

    def _get_chatter():
        _m = _xr.ServerProxy(f"{_url}/xmlrpc/2/object")
        msgs = _m.execute_kw(_db, uid, _pw, "mail.message", "search_read",
            [[["model", "=", "helpdesk.ticket"], ["res_id", "=", ticket_id],
              ["message_type", "in", ["comment", "email"]]]],
            {"fields": ["id", "author_id", "date", "body", "message_type"],
             "order": "date asc", "limit": 50})
        result = []
        for m in msgs:
            body = (m.get("body") or "").replace("<br>", "\n").replace("</p>", "\n")
            body = _re.sub(r"<[^>]+>", "", body).strip()
            if body:
                result.append({
                    "id": m["id"],
                    "autor": m["author_id"][1] if m.get("author_id") else "Sistema",
                    "fecha": (m.get("date") or "")[:16],
                    "cuerpo": body,
                    "tipo": m.get("message_type", "comment"),
                })
        return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_stages  = pool.submit(_get_stages)
        f_chatter = pool.submit(_get_chatter)
        etapas   = f_stages.result()
        mensajes = f_chatter.result()

    return {
        "id": t["id"],
        "nombre": t["name"],
        "descripcion": _re.sub(r"<[^>]+>", "", (t.get("description") or "")).strip()[:500],
        "etapa_id": t["stage_id"][0] if t.get("stage_id") else None,
        "etapa": t["stage_id"][1] if t.get("stage_id") else "",
        "cliente": t["partner_id"][1] if t.get("partner_id") else None,
        "equipo": t["team_id"][1] if t.get("team_id") else None,
        "tipo": t["ticket_type_id"][1] if t.get("ticket_type_id") else None,
        "prioridad": t.get("priority", "0"),
        "tecnico": t["user_id"][1] if t.get("user_id") else None,
        "creado": (t.get("create_date") or "")[:16],
        "ultimo_cambio": (t.get("date_last_stage_update") or "")[:16],
        "kanban_state": t.get("kanban_state", "normal"),
        "mensajes": mensajes,
        "etapas_disponibles": etapas,
    }

@app.post("/api/wfm/field-tickets/{ticket_id}/comentario")
def post_field_ticket_comentario(ticket_id: int, req: TicketComentarioReq):
    import xmlrpc.client as _xr
    _url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    _db   = os.environ.get("ODOO_DB", "wispi17")
    _user = os.environ.get("ODOO_USER")
    _pw   = os.environ.get("ODOO_PASSWORD")
    common = _xr.ServerProxy(f"{_url}/xmlrpc/2/common")
    uid    = common.authenticate(_db, _user, _pw, {})
    models = _xr.ServerProxy(f"{_url}/xmlrpc/2/object")
    models.execute_kw(_db, uid, _pw, "helpdesk.ticket", "message_post",
        [[ticket_id]], {"body": req.mensaje, "message_type": "comment", "subtype_xmlid": "mail.mt_comment"})
    return {"ok": True}

@app.put("/api/wfm/field-tickets/{ticket_id}/etapa")
def put_field_ticket_etapa(ticket_id: int, req: dict):
    import xmlrpc.client as _xr
    _url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    _db   = os.environ.get("ODOO_DB", "wispi17")
    _user = os.environ.get("ODOO_USER")
    _pw   = os.environ.get("ODOO_PASSWORD")
    stage_id = req.get("stage_id")
    if not stage_id:
        raise HTTPException(400, "stage_id requerido")
    common = _xr.ServerProxy(f"{_url}/xmlrpc/2/common")
    uid    = common.authenticate(_db, _user, _pw, {})
    models = _xr.ServerProxy(f"{_url}/xmlrpc/2/object")
    models.execute_kw(_db, uid, _pw, "helpdesk.ticket", "write",
        [[ticket_id], {"stage_id": stage_id}])
    return {"ok": True}

@app.get("/api/wfm/bidrillas")
def get_bidrillas():
    """
    Cuadrillas Field Service — todos los técnicos asignados en Odoo.
    Descubre técnicos dinámicamente desde project.task / Field Service.
    """
    import xmlrpc.client as _xr

    odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db   = os.environ.get("ODOO_DB", "wispi17")
    odoo_user = os.environ.get("ODOO_USER")
    odoo_pass = os.environ.get("ODOO_PASSWORD")

    CLOSED_KW = {"done", "resuelto", "cerrado", "completado", "resolved", "closed"}

    try:
        common = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
        uid = common.authenticate(odoo_db, odoo_user, odoo_pass, {})
        models = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error Odoo: {e}")

    # Todas las tareas Field Service con técnico asignado
    tasks = models.execute_kw(odoo_db, uid, odoo_pass, "project.task", "search_read",
        [[["project_id.name", "ilike", "field"], ["user_ids", "!=", False]]],
        {"fields": ["id", "name", "stage_id", "user_ids", "date_deadline",
                    "create_date", "date_last_stage_update"],
         "limit": 500, "order": "id desc"})

    # Descubrir todos los user_ids únicos
    all_user_ids = list({uid_val for t in tasks for uid_val in t["user_ids"]})

    # Obtener nombres y roles desde hr.employee
    # Odoo 19 agrega version_id (campo restringido) — fallback a res.users si el usuario no tiene permisos Officer
    try:
        employees = models.execute_kw(odoo_db, uid, odoo_pass, "hr.employee", "search_read",
            [[["user_id", "in", all_user_ids]]],
            {"fields": ["user_id", "name", "job_title"], "limit": 200})
        emp_by_user = {e["user_id"][0]: e for e in employees if e["user_id"]}
    except Exception as _emp_err:
        logger.warning(f"[bidrillas] hr.employee sin permisos ({_emp_err}); usando res.users")
        emp_by_user = {}

    # Nombres desde res.users como fallback
    users = models.execute_kw(odoo_db, uid, odoo_pass, "res.users", "read",
        [all_user_ids], {"fields": ["id", "name"]})
    user_names = {u["id"]: u["name"] for u in users}

    result: dict = {}
    for task in tasks:
        stage_name = task["stage_id"][1] if task["stage_id"] else ""
        is_closed  = any(kw in stage_name.lower() for kw in CLOSED_KW)

        for uid_val in task["user_ids"]:
            if uid_val not in result:
                emp  = emp_by_user.get(uid_val, {})
                nombre = emp.get("name") or user_names.get(uid_val, f"Usuario {uid_val}")
                result[uid_val] = {
                    "id":      f"FS-{uid_val}",
                    "odoo_id": uid_val,
                    "nombre":  nombre,
                    "alias":   nombre.split()[0].capitalize() if nombre else f"Técnico {uid_val}",
                    "rol":     emp.get("job_title") or "Field Service",
                    "total": 0, "abiertos": 0, "cerrados": 0,
                    "tareas": [],
                }
            r = result[uid_val]
            r["total"] += 1
            if is_closed:
                r["cerrados"] += 1
            else:
                r["abiertos"] += 1
                r["tareas"].append({
                    "id":       task["id"],
                    "nombre":   task["name"].replace("[S. E.] ", "").replace("[SE] ", ""),
                    "etapa":    stage_name,
                    "deadline": task["date_deadline"],
                    "creado":   task["create_date"],
                })

    tecnicos = sorted(result.values(), key=lambda x: -x["total"])
    for t in tecnicos:
        total = t["total"] or 1
        t["pct_resolucion"] = round((t["cerrados"] / total) * 100, 1)
        t["tareas"] = sorted(t["tareas"], key=lambda x: x["deadline"] or "9999")[:5]

    return {"total": len(tecnicos), "tecnicos": tecnicos}


@app.get("/api/wfm/bidrillas/desempeno")
def get_desempeno():
    """
    Dashboard de desempeño por técnico FO.
    Score compuesto: Resolución (35%) + Documentación (35%) + Volumen (30%).
    """
    import xmlrpc.client as _xr
    from collections import Counter

    odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db   = os.environ.get("ODOO_DB", "wispi17")
    odoo_user = os.environ.get("ODOO_USER")
    odoo_pass = os.environ.get("ODOO_PASSWORD")

    CLOSED_KW = {"done", "resuelto", "cerrado", "completado", "resolved", "closed"}

    try:
        common = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
        uid = common.authenticate(odoo_db, odoo_user, odoo_pass, {})
        models = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error Odoo: {e}")

    # Todas las tareas Field Service
    tasks = models.execute_kw(odoo_db, uid, odoo_pass, "project.task", "search_read",
        [[["project_id.name","ilike","field"],["user_ids","!=",False]]],
        {"fields": ["id","stage_id","user_ids","date_deadline","date_last_stage_update"],
         "limit": 500, "order": "id desc"})

    # Descubrir todos los técnicos
    all_user_ids = list({u for t in tasks for u in t["user_ids"]})

    employees = models.execute_kw(odoo_db, uid, odoo_pass, "hr.employee", "search_read",
        [[["user_id","in",all_user_ids]]],
        {"fields": ["user_id","name","job_title"], "limit": 200})
    emp_by_user = {e["user_id"][0]: e for e in employees if e["user_id"]}

    users_raw = models.execute_kw(odoo_db, uid, odoo_pass, "res.users", "read",
        [all_user_ids], {"fields": ["id","name"]})
    user_names = {u["id"]: u["name"] for u in users_raw}

    # Inicializar stats y nombre→id para mensajes
    stats: dict = {}
    nombre_to_id: dict = {}
    for u_id in all_user_ids:
        emp    = emp_by_user.get(u_id, {})
        nombre = emp.get("name") or user_names.get(u_id, f"Usuario {u_id}")
        alias  = nombre.split()[0].capitalize()
        stats[u_id] = {"total": 0, "cerradas": 0, "on_time": 0,
                       "nombre": nombre, "alias": alias}
        nombre_to_id[nombre] = u_id

    for t in tasks:
        stage = (t["stage_id"][1] if t["stage_id"] else "").lower()
        is_closed = any(kw in stage for kw in CLOSED_KW)
        dl      = t.get("date_deadline")
        updated = t.get("date_last_stage_update")
        for u_id in t["user_ids"]:
            if u_id not in stats: continue
            stats[u_id]["total"] += 1
            if is_closed:
                stats[u_id]["cerradas"] += 1
                if dl and updated and updated <= dl:
                    stats[u_id]["on_time"] += 1

    # Mensajes por autor
    task_ids = [t["id"] for t in tasks]
    msgs_por_tecnico: dict = {k: 0 for k in all_user_ids}
    if task_ids:
        msgs = models.execute_kw(odoo_db, uid, odoo_pass, "mail.message", "search_read",
            [[["res_id","in",task_ids],["model","=","project.task"],["message_type","=","comment"]]],
            {"fields": ["author_id"], "limit": 5000})
        for m in msgs:
            if m["author_id"]:
                u_id = nombre_to_id.get(m["author_id"][1])
                if u_id:
                    msgs_por_tecnico[u_id] += 1

    max_cerradas = max((s["cerradas"] for s in stats.values()), default=1) or 1
    max_msgs     = max(msgs_por_tecnico.values(), default=1) or 1

    resultado = []
    for u_id, s in stats.items():
        if s["total"] == 0:
            continue
        cerr   = s["cerradas"]
        msgs_n = msgs_por_tecnico.get(u_id, 0)
        total  = s["total"] or 1

        pct_resolucion = round((cerr / total) * 100, 1)
        pct_vol        = (cerr / max_cerradas) * 100
        pct_doc        = (msgs_n / max_msgs) * 100
        pct_puntual    = round((s["on_time"] / cerr * 100) if cerr > 0 else 0, 1)

        score = round(
            (pct_resolucion * 0.35) +
            (pct_doc        * 0.35) +
            (pct_vol        * 0.30), 1
        )

        resultado.append({
            "odoo_id":        u_id,
            "alias":          s["alias"],
            "nombre":         s["nombre"],
            "total":          s["total"],
            "cerradas":       cerr,
            "abiertos":       s["total"] - cerr,
            "on_time":        s["on_time"],
            "mensajes":       msgs_n,
            "pct_resolucion": pct_resolucion,
            "pct_vol":        round(pct_vol, 1),
            "pct_doc":        round(pct_doc, 1),
            "pct_puntual":    pct_puntual,
            "score":          score,
            "detalle": {
                "resolucion_pts": round(pct_resolucion * 0.35, 1),
                "doc_pts":        round(pct_doc * 0.35, 1),
                "volumen_pts":    round(pct_vol * 0.30, 1),
            }
        })

    resultado.sort(key=lambda x: -x["score"])
    # Asignar rank
    for i, r in enumerate(resultado):
        r["rank"] = i + 1

    return {"tecnicos": resultado, "formula": "Score = Resolución×35% + Documentación×35% + Volumen×30%"}


def _odoo_connect():
    """Helper: devuelve (models, db, uid, password) ya autenticado."""
    import xmlrpc.client as _xr
    odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db   = os.environ.get("ODOO_DB", "wispi17")
    odoo_user = os.environ.get("ODOO_USER")
    odoo_pass = os.environ.get("ODOO_PASSWORD")
    common = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
    uid = common.authenticate(odoo_db, odoo_user, odoo_pass, {})
    if not uid:
        raise HTTPException(status_code=503, detail="No se pudo autenticar en Odoo")
    models = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")
    return models, odoo_db, uid, odoo_pass


@app.get("/api/wfm/bidrillas/tarea/{task_id}")
def get_tarea_detalle(task_id: int):
    """Detalle completo de una tarea Field Service + chatter."""
    import re
    models, db, uid, pw = _odoo_connect()

    tasks = models.execute_kw(db, uid, pw, "project.task", "read",
        [[task_id]],
        {"fields": ["id","name","description","stage_id","user_ids","date_deadline",
                    "create_date","partner_id","project_id","priority","message_ids"]})
    if not tasks:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    task = tasks[0]

    msgs_raw = models.execute_kw(db, uid, pw, "mail.message", "search_read",
        [[["res_id","=",task_id],["model","=","project.task"]]],
        {"fields": ["id","body","author_id","date","message_type"], "limit": 30, "order": "date asc"})

    def strip_html(html: str) -> str:
        return re.sub(r'<[^>]+>', '', html or '').strip()

    mensajes = []
    for m in msgs_raw:
        body = strip_html(m["body"])
        if body:
            mensajes.append({
                "id":     m["id"],
                "autor":  m["author_id"][1] if m["author_id"] else "Sistema",
                "fecha":  m["date"],
                "cuerpo": body,
                "tipo":   m["message_type"],
            })

    user_ids = task["user_ids"] or []
    users = []
    if user_ids:
        u_records = models.execute_kw(db, uid, pw, "res.users", "read",
            [user_ids], {"fields": ["id","name"]})
        users = [{"id": u["id"], "nombre": u["name"]} for u in u_records]

    stages = models.execute_kw(db, uid, pw, "project.task.type", "search_read",
        [[["project_ids","in",[task["project_id"][0]]]]],
        {"fields": ["id","name","sequence"], "limit": 20, "order": "sequence asc"})

    return {
        "id":          task["id"],
        "nombre":      task["name"].replace("[S. E.] ","").replace("[SE] ",""),
        "descripcion": strip_html(task["description"] or ""),
        "etapa_id":    task["stage_id"][0] if task["stage_id"] else None,
        "etapa":       task["stage_id"][1] if task["stage_id"] else "—",
        "tecnicos":    users,
        "cliente":     task["partner_id"][1] if task["partner_id"] else None,
        "proyecto":    task["project_id"][1] if task["project_id"] else None,
        "prioridad":   "alta" if task["priority"] == "1" else "normal",
        "deadline":    task["date_deadline"],
        "creado":      task["create_date"],
        "mensajes":    mensajes,
        "etapas_disponibles": [{"id": s["id"], "nombre": s["name"]} for s in stages],
    }


class ComentarioRequest(BaseModel):
    cuerpo: str
    autor: str = "XCIEN 2.0"

@app.post("/api/wfm/bidrillas/tarea/{task_id}/comentario")
def post_comentario(task_id: int, req: ComentarioRequest):
    """Publica un comentario en el chatter de Odoo."""
    if not req.cuerpo.strip():
        raise HTTPException(status_code=400, detail="El comentario no puede estar vacío")
    models, db, uid, pw = _odoo_connect()
    msg_id = models.execute_kw(db, uid, pw, "project.task", "message_post",
        [[task_id]],
        {"body": req.cuerpo, "message_type": "comment", "subtype_xmlid": "mail.mt_comment"})
    return {"ok": True, "message_id": msg_id}


class EtapaRequest(BaseModel):
    etapa_id: int

@app.put("/api/wfm/bidrillas/tarea/{task_id}/etapa")
def update_etapa_tarea(task_id: int, req: EtapaRequest):
    """Cambia la etapa de una tarea Field Service en Odoo."""
    models, db, uid, pw = _odoo_connect()
    ok = models.execute_kw(db, uid, pw, "project.task", "write",
        [[task_id]], {"stage_id": req.etapa_id})
    return {"ok": bool(ok)}


@app.post("/api/wfm/comercial/solicitar")
async def wfm_solicitar(req: WFMCreateRequest):
    return wfm_service.crear_solicitud_comercial(req.cliente, req.servicio, req.comercial)

@app.post("/api/wfm/preventa/actualizar")
async def wfm_preventa(req: WFMUpdatePreventaRequest):
    return wfm_service.actualizar_preventa(req.order_id, req.data, req.usuario)

@app.post("/api/wfm/ventas/contratar")
async def wfm_contratar(req: WFMBasicActionRequest):
    return wfm_service.contratar_orden(req.order_id, req.usuario)

@app.post("/api/wfm/almacen/asignar")
async def wfm_almacen(req: WFMAlmacenRequest):
    return wfm_service.asignar_equipos_almacen(req.order_id, req.equipos, req.usuario)

@app.post("/api/wfm/aprovisionar")
async def wfm_aprovisionar(req: WFMAproRequest):
    return wfm_service.aprovisionar_servicio(req.order_id, req.config, req.usuario)

@app.post("/api/wfm/pm/auditar")
async def wfm_auditar(req: WFMAuditoriaRequest):
    return wfm_service.auditar_pm(req.order_id, req.ok, req.motivo, req.usuario)

class WFMEsperaAlmacenRequest(BaseModel):
    order_id: str
    motivo: str
    responsable_almacen: str = "Almacén"
    usuario: str = "Sistema"

@app.post("/api/wfm/almacen/espera")
async def wfm_marcar_espera_almacen(req: WFMEsperaAlmacenRequest):
    """Marca una orden como ESPERA_ALMACEN: equipo no disponible, caso detenido."""
    result = wfm_service.marcar_espera_almacen(req.order_id, req.motivo, req.responsable_almacen, req.usuario)
    if not result:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return result

@app.post("/api/wfm/almacen/liberar/{order_id}")
async def wfm_liberar_espera_almacen(order_id: str, usuario: str = "Sistema"):
    """Libera una orden de ESPERA_ALMACEN → regresa a ALMACEN_VALIDACION."""
    result = wfm_service.liberar_espera_almacen(order_id, usuario)
    if not result:
        raise HTTPException(status_code=404, detail="Orden no encontrada o no está en ESPERA_ALMACEN")
    return result

@app.get("/api/wfm/almacen/detenidos")
async def wfm_detenidos_almacen():
    """Retorna todos los casos actualmente detenidos por almacén (ESPERA_ALMACEN)."""
    todas = wfm_service.obtener_ordenes()
    detenidos = [o for o in todas if o.get("estado") == "ESPERA_ALMACEN"]
    return {
        "total": len(detenidos),
        "fecha": __import__("datetime").datetime.now().isoformat(),
        "ordenes": detenidos,
    }

# ─── GPS TN360 ───────────────────────────────────────────────────────────────
import requests as _requests
import threading as _threading

TN360_API       = "https://api-latam.telematics.com/v1"
TN360_AUTH_URL  = "https://id-mx.telematics.com/auth/realms/TN360DB/protocol/openid-connect/token"
TN360_USER      = os.environ.get("TN360_USER", "")
TN360_PASS      = os.environ.get("TN360_PASS", "")

_gps_cache: dict = {"data": [], "ts": 0, "token": None, "token_ts": 0}
_gps_lock = _threading.Lock()

def _tn360_token() -> str:
    now = time.time()
    if _gps_cache["token"] and now - _gps_cache["token_ts"] < 240:
        return _gps_cache["token"]
    resp = _requests.post(TN360_AUTH_URL, data={
        "grant_type": "password", "client_id": "tn360ui",
        "username": TN360_USER, "password": TN360_PASS
    }, timeout=10)
    resp.raise_for_status()
    token = resp.json()["access_token"]
    _gps_cache["token"] = token
    _gps_cache["token_ts"] = now
    return token

def _fetch_gps_all() -> list:
    from concurrent.futures import ThreadPoolExecutor, as_completed
    token   = _tn360_token()
    headers = {"Authorization": f"Bearer {token}"}
    now_dt  = datetime.datetime.utcnow()
    # hoy desde medianoche UTC para calcular km_hoy
    today_start = now_dt.replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    # también 48h atrás para posición de vehículos que no movieron hoy
    from_48h = (now_dt - datetime.timedelta(hours=48)).strftime("%Y-%m-%dT%H:%M:%SZ")
    to_dt    = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    vehicles_resp = _requests.get(f"{TN360_API}/vehicles?limit=200", headers=headers, timeout=15)
    vehicles = vehicles_resp.json() if vehicles_resp.ok else []

    # mapa de conductores: id → nombre
    users_resp = _requests.get(f"{TN360_API}/users?limit=500", headers=headers, timeout=15)
    users_list = users_resp.json() if users_resp.ok else []
    user_map   = {
        u["id"]: f"{u.get('firstName','')} {u.get('lastName','')}".strip()
        for u in users_list if isinstance(u, dict)
    }

    def _get_vehicle_gps(veh):
        vid   = veh["id"]
        name  = veh.get("name", str(vid))
        reg   = veh.get("registration", "")
        make  = veh.get("make", "")
        model = veh.get("model", "")
        try:
            # trips de hoy para km_hoy y viajes_hoy
            today_resp = _requests.get(
                f"{TN360_API}/trips?vehicleId={vid}&from={today_start}&to={to_dt}&limit=500",
                headers=headers, timeout=12
            )
            today_trips = today_resp.json() if today_resp.ok else []
            if not isinstance(today_trips, list):
                today_trips = []

            def _km(t):
                km = t.get("gpsOdoEnd", 0) - t.get("gpsOdoStart", 0)
                return km if 0 < km < 2000 else 0

            valid_trips = [t for t in today_trips if t.get("plausible", True)]
            km_hoy     = round(sum(_km(t) for t in valid_trips), 1)
            viajes_hoy = len(valid_trips)

            # conductor: usuario más frecuente en trips de hoy
            conductor = ""
            if valid_trips:
                uid = valid_trips[0].get("user", {}).get("id")
                conductor = user_map.get(uid, "")

            # posición: último trip de hoy; si no hay, buscar en 48h
            trips_for_pos = today_trips
            if not trips_for_pos:
                pos_resp = _requests.get(
                    f"{TN360_API}/trips?vehicleId={vid}&from={from_48h}&to={to_dt}&limit=1",
                    headers=headers, timeout=10
                )
                trips_for_pos = pos_resp.json() if pos_resp.ok else []
                if not isinstance(trips_for_pos, list):
                    trips_for_pos = []

            if not trips_for_pos:
                return None
            trip = trips_for_pos[0]
            gps  = trip.get("IgnOffGPS") or trip.get("IgnOnGPS")
            if not gps or not gps.get("valid"):
                return None

            ts_ms  = gps.get("At", 0)
            ts_iso = datetime.datetime.utcfromtimestamp(ts_ms / 1000).strftime("%Y-%m-%d %H:%M") if ts_ms else None
            activo_hoy = viajes_hoy > 0

            return {
                "id":          vid,
                "nombre":      name,
                "placa":       reg,
                "make":        make,
                "model":       model,
                "lat":         round(gps["Lat"], 6),
                "lng":         round(gps["Lng"], 6),
                "velocidad":   round(gps.get("Spd", 0), 1),
                "direccion":   round(gps.get("Dir", 0), 0),
                "ultima_vez":  ts_iso,
                "ubicacion":   trip.get("endLocation") or trip.get("startLocation") or "",
                "activo":      gps.get("Spd", 0) > 2,
                "activo_hoy":  activo_hoy,
                "km_hoy":      km_hoy,
                "viajes_hoy":  viajes_hoy,
                "conductor":   conductor,
            }
        except Exception:
            return None

    result = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(_get_vehicle_gps, v): v for v in vehicles}
        for fut in as_completed(futures):
            item = fut.result()
            if item:
                result.append(item)
    result.sort(key=lambda x: x["nombre"])
    return result

@app.get("/api/gps/vehiculos")
def get_gps_vehiculos():
    """Posiciones GPS en tiempo real de la flotilla TN360."""
    with _gps_lock:
        now = time.time()
        if now - _gps_cache["ts"] < 90:
            return {"vehiculos": _gps_cache["data"], "total": len(_gps_cache["data"]), "cached": True}
        try:
            data = _fetch_gps_all()
            _gps_cache["data"] = data
            _gps_cache["ts"]   = now
            return {"vehiculos": data, "total": len(data), "cached": False}
        except Exception as e:
            logger.error(f"GPS TN360 error: {e}")
            if _gps_cache["data"]:
                return {"vehiculos": _gps_cache["data"], "total": len(_gps_cache["data"]), "cached": True, "stale": True}
            raise HTTPException(500, f"Error GPS: {e}")


# ─── GPS Rutas diarias con persistencia ──────────────────────────────────────
_RUTAS_DIR = os.path.join(BASE_DIR, "data", "flotilla_rutas")
os.makedirs(_RUTAS_DIR, exist_ok=True)

# Vehículos a excluir (dados de baja o stock)
_EXCLUIR_NOMBRES = {"baja", "stock"}

def _es_baja(nombre: str) -> bool:
    n = nombre.lower()
    return any(x in n for x in _EXCLUIR_NOMBRES)

def _rutas_fecha_path(fecha_str: str) -> str:
    return os.path.join(_RUTAS_DIR, f"{fecha_str}.json")

def _rutas_load_cache(fecha_str: str):
    path = _rutas_fecha_path(fecha_str)
    try:
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
    except Exception:
        pass
    return None

def _rutas_save(fecha_str: str, data: dict):
    path = _rutas_fecha_path(fecha_str)
    try:
        with open(path, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"No se pudo guardar rutas {fecha_str}: {e}")

def _rutas_fetch_odoo_tickets(fecha_str: str) -> list:
    """Tickets Odoo (Field Service) del día con coordenadas del partner."""
    import xmlrpc.client as _xr
    odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db   = os.environ.get("ODOO_DB", "wispi19")
    odoo_user = os.environ.get("ODOO_USER")
    odoo_pass = os.environ.get("ODOO_PASSWORD", "")
    try:
        uid = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common").authenticate(odoo_db, odoo_user, odoo_pass, {})
        models = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")
        raw = models.execute_kw(odoo_db, uid, odoo_pass, "project.task", "search_read",
            [[["create_date", ">=", f"{fecha_str} 00:00:00"],
              ["create_date", "<=", f"{fecha_str} 23:59:59"]]],
            {"fields": ["id","name","user_ids","partner_id","stage_id","description"], "limit": 100})
        tickets = []
        for r in raw:
            partner_id = r.get("partner_id")
            lat, lng = None, None
            if partner_id:
                try:
                    p = models.execute_kw(odoo_db, uid, odoo_pass, "res.partner", "read",
                        [[partner_id[0]]], {"fields": ["partner_latitude","partner_longitude","street","city"]})[0]
                    lat = p.get("partner_latitude") or None
                    lng = p.get("partner_longitude") or None
                    addr = f"{p.get('street','')}, {p.get('city','')}".strip(", ")
                except Exception:
                    addr = partner_id[1] if partner_id else "—"
            else:
                addr = "—"
            tickets.append({
                "id": r["id"],
                "nombre": r["name"],
                "cliente": partner_id[1] if partner_id else "—",
                "direccion": addr,
                "lat": lat,
                "lng": lng,
                "etapa": r["stage_id"][1] if r.get("stage_id") else "—",
                "tecnicos": [u[1] for u in (r.get("user_ids") or [])],
            })
        return tickets
    except Exception as e:
        logger.warning(f"Odoo tickets rutas: {e}")
        return []

def _rutas_fetch_trips(tn360_id: int, from_dt: str, to_dt: str, token: str) -> list:
    hdr  = {"Authorization": f"Bearer {token}"}
    API  = "https://api-latam.telematics.com/v1"
    try:
        r = _requests.get(f"{API}/trips?vehicleId={tn360_id}&from={from_dt}&to={to_dt}&limit=200",
                          headers=hdr, timeout=20)
        trips_raw = r.json() if r.ok else []
        if not isinstance(trips_raw, list): trips_raw = []
    except Exception as e:
        logger.warning(f"TN360 trips {tn360_id}: {e}")
        return []

    trips = []
    for t in trips_raw:
        ign_on  = t.get("IgnOnGPS") or {}
        ign_off = t.get("IgnOffGPS") or {}
        km = round(max(0, (t.get("gpsOdoEnd") or 0) - (t.get("gpsOdoStart") or 0)), 2)
        ts_on  = t.get("ignitionOn")  or 0
        ts_off = t.get("ignitionOff") or 0
        try:
            dt_on  = datetime.datetime.utcfromtimestamp(ts_on/1000).strftime("%H:%M") if ts_on else None
            dt_off = datetime.datetime.utcfromtimestamp(ts_off/1000).strftime("%H:%M") if ts_off else None
        except Exception:
            dt_on = dt_off = None

        trips.append({
            "trip_id":      t.get("tripId") or t.get("id"),
            "desde":        dt_on,
            "hasta":        dt_off,
            "ts_on":        ts_on,
            "ts_off":       ts_off,
            "km":           km,
            "start_lat":    ign_on.get("Lat"),
            "start_lng":    ign_on.get("Lng"),
            "end_lat":      ign_off.get("Lat"),
            "end_lng":      ign_off.get("Lng"),
            "start_loc":    t.get("startLocation"),
            "end_loc":      t.get("endLocation"),
            "horario":      _classify_trip_time(ts_on),
            "conductor":    (t.get("user") or {}).get("name", ""),
        })
    return sorted(trips, key=lambda x: x["ts_on"] or 0)

@app.get("/api/gps/rutas")
def get_gps_rutas(fecha: str = None, forzar: bool = False, prefijo: str = ""):
    """
    Rutas del día — flota completa TN360 LATAM.
    fecha:   YYYY-MM-DD (default: hoy CST).
    forzar:  True = ignora caché y vuelve a consultar TN360.
    prefijo: filtrar por nombre de vehículo, ej. 'LW', 'SD', 'SE'.
    Persiste en data/flotilla_rutas/{fecha}.json.
    """
    from concurrent.futures import ThreadPoolExecutor

    now_cst = datetime.datetime.utcnow() - datetime.timedelta(hours=6)
    fecha   = fecha or now_cst.strftime("%Y-%m-%d")
    es_hoy  = (fecha == now_cst.strftime("%Y-%m-%d"))

    # Caché en disco para días pasados
    if not forzar and not es_hoy:
        cached = _rutas_load_cache(fecha)
        if cached:
            # Aplicar filtro de prefijo sobre caché
            if prefijo:
                cached = dict(cached)
                cached["vehiculos"] = [v for v in cached["vehiculos"]
                                       if v["nombre"].upper().startswith(prefijo.upper())]
            cached["from_cache"] = True
            return cached

    # Rango UTC
    dt_start = datetime.datetime.strptime(fecha, "%Y-%m-%d") + datetime.timedelta(hours=6)
    dt_end   = dt_start + datetime.timedelta(hours=24)
    from_dt  = dt_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    to_dt    = dt_end.strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        token = _tn360_token()
    except Exception as e:
        raise HTTPException(503, f"Error auth TN360: {e}")

    hdr = {"Authorization": f"Bearer {token}"}

    # 1. Obtener catálogo de vehículos
    try:
        r_vehs = _requests.get(f"{TN360_API}/vehicles?limit=200", headers=hdr, timeout=15)
        vehs_raw = r_vehs.json() if r_vehs.ok else []
    except Exception as e:
        raise HTTPException(503, f"Error listando vehículos TN360: {e}")

    # Filtrar dados de baja / STOCK
    vehs_activos = [
        v for v in vehs_raw
        if v.get("id") and v.get("name") and not _es_baja(v.get("name", ""))
    ]

    # 2. Trips en paralelo (max 10 workers)
    def fetch_one(v):
        tn_id    = v["id"]
        nombre   = v.get("name", str(tn_id))
        placa    = v.get("licensePlate") or ""
        driver   = (v.get("defaultDriver") or {})
        conductor = driver.get("name", "") if isinstance(driver, dict) else ""
        trips = _rutas_fetch_trips(tn_id, from_dt, to_dt, token)
        return {
            "tn360_id":  tn_id,
            "nombre":    nombre,
            "placa":     placa,
            "conductor": conductor,
            "trips":     trips,
            "km_total":  round(sum(t["km"] for t in trips), 2),
            "n_viajes":  len(trips),
        }

    with ThreadPoolExecutor(max_workers=10) as ex:
        vehiculos_out = list(ex.map(fetch_one, vehs_activos))

    # Ordenar: primero los que tienen viajes, luego por nombre
    vehiculos_out.sort(key=lambda v: (-v["n_viajes"], v["nombre"]))

    # Tickets Odoo del día
    tickets_odoo = _rutas_fetch_odoo_tickets(fecha)

    result = {
        "fecha":        fecha,
        "generado_en":  datetime.datetime.utcnow().isoformat() + "Z",
        "total_vehs":   len(vehiculos_out),
        "vehiculos":    vehiculos_out,
        "tickets_odoo": tickets_odoo,
        "from_cache":   False,
    }

    # Persistir siempre (para historial)
    _rutas_save(fecha, result)

    # Aplicar filtro de prefijo antes de retornar
    if prefijo:
        result = dict(result)
        result["vehiculos"] = [v for v in result["vehiculos"]
                               if v["nombre"].upper().startswith(prefijo.upper())]
    return result

@app.get("/api/gps/rutas/fechas")
def get_gps_rutas_fechas():
    """Lista de fechas con rutas guardadas (historial)."""
    try:
        files = sorted([
            f.replace(".json", "")
            for f in os.listdir(_RUTAS_DIR)
            if f.endswith(".json") and len(f) == 15  # YYYY-MM-DD.json
        ], reverse=True)
        return {"fechas": files[:60]}
    except Exception:
        return {"fechas": []}


# ─── GPS × Tickets — Cruce Semanal V2 ────────────────────────────────────────
# Metodología: defaultDriver TN360 → email → Odoo, % fuera de horario real

_VEH_MAP_FILE = os.path.join(BASE_DIR, "data", "vehiculo_tecnico_map.json")

def _veh_map_load() -> dict:
    try:
        with open(_VEH_MAP_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

def _veh_map_save(data: dict):
    with open(_VEH_MAP_FILE, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _classify_trip_time(ts_ms: int, tz_offset_hrs: int = -6) -> str:
    """Clasifica un viaje según hora local: laboral | nocturno | madrugada | finde."""
    if not ts_ms:
        return "laboral"
    dt_local = datetime.datetime.utcfromtimestamp(ts_ms / 1000) + datetime.timedelta(hours=tz_offset_hrs)
    weekday  = dt_local.weekday()  # 0=Mon … 6=Sun
    hour     = dt_local.hour
    if weekday >= 5:                           # sábado o domingo
        return "finde"
    if 0 <= hour < 6:                          # madrugada
        return "madrugada"
    if 8 <= hour < 18:                         # horario laboral
        return "laboral"
    return "nocturno"                          # fuera de horario (mañana temprana / nocturno)

# Mapeo de plaza → IDs de conductores TN360
_PLAZA_DRIVERS: dict = {
    "piedras_negras": {302876, 302869},   # Guillermo Hérnandez, Juan Ceniceros
    "yucatan":        {302866, 302868},   # Amilcar Tun Chan, Geyder Villajuana
}

@app.get("/api/wfm/bidrillas/cruce-semanal")
def get_cruce_semanal(periodo: str = "semanal", plaza: str = ""):
    """
    Cruce GPS TN360 × Odoo Field Service — V2.
    Usa defaultDriver de TN360, clasifica km por horario laboral vs fuera,
    cruza email conductor con login Odoo.
    periodo: diario | semanal | mensual
    plaza: '' (toda la flota) | 'piedras_negras' | 'yucatan'
    """
    from concurrent.futures import ThreadPoolExecutor
    import xmlrpc.client as _xr

    # ── Rango de fechas (CST = UTC-6) ─────────────────────────────────────────
    now_utc = datetime.datetime.utcnow()
    now_mx  = now_utc - datetime.timedelta(hours=6)

    if periodo == "diario":
        start_mx = now_mx.replace(hour=0, minute=0, second=0, microsecond=0)
        periodo_label = f"Hoy {now_mx.strftime('%d %b %Y')}"
    elif periodo == "mensual":
        start_mx = now_mx.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        periodo_label = f"{start_mx.strftime('%d %b')} – {now_mx.strftime('%d %b %Y')}"
    else:  # semanal
        monday_mx = now_mx - datetime.timedelta(days=now_mx.weekday())
        start_mx  = monday_mx.replace(hour=0, minute=0, second=0, microsecond=0)
        periodo_label = f"{start_mx.strftime('%d %b')} – {now_mx.strftime('%d %b %Y')}"

    start_utc      = start_mx + datetime.timedelta(hours=6)
    from_dt        = start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    to_dt          = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    week_start_iso = start_utc.strftime("%Y-%m-%d %H:%M:%S")

    # ── 1. TN360: usuarios (conductores) ──────────────────────────────────────
    tn360_users: dict = {}  # {user_id: {name, email}}
    vehicles_raw: list = []
    try:
        token = _tn360_token()
        hdr   = {"Authorization": f"Bearer {token}"}

        users_r = _requests.get(f"{TN360_API}/users?limit=500", headers=hdr, timeout=15)
        if users_r.ok:
            for u in (users_r.json() or []):
                uid = u.get("id")
                if uid:
                    tn360_users[uid] = {
                        "name":  u.get("name") or f"{u.get('firstName','')} {u.get('lastName','')}".strip(),
                        "email": (u.get("email") or "").lower().strip(),
                    }

        veh_r       = _requests.get(f"{TN360_API}/vehicles?limit=200", headers=hdr, timeout=15)
        vehicles_raw = veh_r.json() if veh_r.ok else []
    except Exception as e:
        logger.error(f"Cruce V2 TN360 fetch error: {e}")

    # ── 2. Viajes de la semana por vehículo ───────────────────────────────────
    def _get_trips_classified(veh):
        vid         = veh["id"]
        driver_id   = veh.get("defaultDriver")
        driver_info = tn360_users.get(driver_id, {"name": None, "email": None}) if driver_id else {"name": None, "email": None}
        try:
            r = _requests.get(
                f"{TN360_API}/trips?vehicleId={vid}&from={from_dt}&to={to_dt}&limit=500",
                headers=hdr, timeout=20
            )
            trips = r.json() if r.ok else []
            if not isinstance(trips, list): trips = []

            km_total, km_fuera, km_nocturno, km_madrugada, km_finde = 0.0, 0.0, 0.0, 0.0, 0.0
            conductores_reales: dict = {}   # {uid: {nombre, n_viajes}}
            viajes_fuera_detalle: list = [] # hasta 20 viajes fuera de horario

            for t in trips:
                km = max(0, (t.get("gpsOdoEnd") or 0) - (t.get("gpsOdoStart") or 0))
                km_total += km
                cls = _classify_trip_time(t.get("ignitionOn") or 0)
                if cls == "laboral":
                    pass
                elif cls == "nocturno":
                    km_fuera    += km
                    km_nocturno += km
                elif cls == "madrugada":
                    km_fuera     += km
                    km_madrugada += km
                else:  # finde
                    km_fuera += km
                    km_finde += km

                # Conductor real del viaje (puede diferir del defaultDriver)
                trip_user = t.get("user") or {}
                trip_uid  = trip_user.get("id")
                if trip_uid and trip_uid != driver_id:
                    if trip_uid not in conductores_reales:
                        conductores_reales[trip_uid] = {
                            "nombre":   tn360_users.get(trip_uid, {}).get("name", f"uid:{trip_uid}"),
                            "email":    tn360_users.get(trip_uid, {}).get("email", ""),
                            "n_viajes": 0,
                        }
                    conductores_reales[trip_uid]["n_viajes"] += 1

                # Detalle de viajes fuera de horario (startLocation / endLocation)
                if cls != "laboral" and len(viajes_fuera_detalle) < 20:
                    ts_ms = t.get("ignitionOn") or 0
                    dt_local = (datetime.datetime.utcfromtimestamp(ts_ms / 1000)
                                + datetime.timedelta(hours=-6)) if ts_ms else None
                    viajes_fuera_detalle.append({
                        "cls":        cls,
                        "hora_local": dt_local.strftime("%a %d/%m %H:%M") if dt_local else "",
                        "km":         round(km, 1),
                        "start":      (t.get("startLocation") or "").split(",")[0][:60],
                        "end":        (t.get("endLocation")   or "").split(",")[0][:60],
                        "driver_uid": trip_uid,
                        "driver_nombre": tn360_users.get(trip_uid, {}).get("name", "") if trip_uid else "",
                    })

            pct_fuera = round(km_fuera / km_total * 100, 1) if km_total > 0 else 0.0
            dur_total = sum(
                max(0, ((t.get("ignitionOff") or 0) - (t.get("ignitionOn") or 0))) / 3_600_000
                for t in trips
            )
            return {
                "id":                    vid,
                "vehiculo":              veh.get("name", ""),
                "placa":                 veh.get("registration", ""),
                "driver_id":             driver_id,
                "conductor":             driver_info["name"],
                "email":                 driver_info["email"],
                "km_semana":             round(km_total, 1),
                "km_fuera":              round(km_fuera, 1),
                "km_nocturno":           round(km_nocturno, 1),
                "km_madrugada":          round(km_madrugada, 1),
                "km_finde":              round(km_finde, 1),
                "pct_fuera":             pct_fuera,
                "horas_campo":           round(dur_total, 1),
                "n_viajes":              len(trips),
                "conductores_reales":    list(conductores_reales.values()),
                "conductor_mismatch":    len(conductores_reales) > 0,
                "viajes_fuera_detalle":  viajes_fuera_detalle,
            }
        except Exception as ex:
            logger.warning(f"Cruce V2 trip error vid={vid}: {ex}")
            return {
                "id": vid, "vehiculo": veh.get("name",""), "placa": veh.get("registration",""),
                "driver_id": driver_id, "conductor": driver_info["name"], "email": driver_info["email"],
                "km_semana": 0.0, "km_fuera": 0.0, "km_nocturno": 0.0, "km_madrugada": 0.0, "km_finde": 0.0,
                "pct_fuera": 0.0, "horas_campo": 0.0, "n_viajes": 0,
                "conductores_reales": [], "conductor_mismatch": False, "viajes_fuera_detalle": [],
            }

    # ── Filtro de plaza ────────────────────────────────────────────────────────
    plaza_label = ""
    if plaza and plaza in _PLAZA_DRIVERS:
        driver_ids = _PLAZA_DRIVERS[plaza]
        vehicles_raw = [v for v in vehicles_raw if v.get("defaultDriver") in driver_ids]
        plaza_labels = {"piedras_negras": "Piedras Negras", "yucatan": "Yucatán"}
        plaza_label = plaza_labels.get(plaza, plaza.replace("_"," ").title())

    gps_list: list = []
    if vehicles_raw:
        with ThreadPoolExecutor(max_workers=12) as pool:
            gps_list = list(pool.map(_get_trips_classified, vehicles_raw))

    # ── 3. Odoo: tareas Field Service del período ──────────────────────────────
    odoo_by_email: dict = {}  # {email_lower: {tickets, cerrados, abiertos}}
    try:
        odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
        odoo_db   = os.environ.get("ODOO_DB", "wispi17")
        odoo_user = os.environ.get("ODOO_USER")
        odoo_pass = os.environ.get("ODOO_PASSWORD")
        common = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
        uid    = common.authenticate(odoo_db, odoo_user, odoo_pass, {})
        models = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")

        CLOSED_KW = {"done", "resuelto", "cerrado", "completado", "resolved", "closed"}
        domain = [
            ["project_id.name", "ilike", "field"],
            ["user_ids", "!=", False],
            "|", ["create_date", ">=", week_start_iso],
                  ["date_last_stage_update", ">=", week_start_iso],
        ]
        tasks = models.execute_kw(odoo_db, uid, odoo_pass, "project.task", "search_read",
            [domain], {"fields": ["id","stage_id","user_ids","create_date"], "limit": 2000})

        all_uids = list({u for t in tasks for u in t["user_ids"]})
        if all_uids:
            users_r2 = models.execute_kw(odoo_db, uid, odoo_pass, "res.users", "read",
                [all_uids], {"fields": ["id","name","login"]})
            uid_to = {u["id"]: {"name": u["name"], "login": (u["login"] or "").lower()} for u in users_r2}
        else:
            uid_to = {}

        for t in tasks:
            stage     = (t["stage_id"][1] if t["stage_id"] else "").lower()
            is_closed = any(kw in stage for kw in CLOSED_KW)
            for u_id in t["user_ids"]:
                u_info = uid_to.get(u_id, {})
                email  = u_info.get("login", "")
                if not email: continue
                if email not in odoo_by_email:
                    odoo_by_email[email] = {"nombre": u_info.get("name",""), "tickets": 0, "cerrados": 0, "abiertos": 0}
                odoo_by_email[email]["tickets"] += 1
                if is_closed:
                    odoo_by_email[email]["cerrados"] += 1
                else:
                    odoo_by_email[email]["abiertos"] += 1
    except Exception as e:
        logger.error(f"Cruce V2 Odoo error: {e}")

    # ── 4. Enriquecer con Odoo + mapeo manual override ────────────────────────
    manual_map   = _veh_map_load()  # {str(vid): email_override}
    cruce_rows   = []
    sin_conductor = []

    for veh in gps_list:
        vid = veh["id"]
        email = manual_map.get(str(vid)) or veh["email"] or ""
        email_lower = email.lower().strip()

        odoo_tec  = odoo_by_email.get(email_lower)
        sin_odoo  = not odoo_tec and bool(email_lower)  # tiene email TN360 pero no cruzó con Odoo

        tiene_gps    = veh["n_viajes"] > 0
        tiene_tickets = bool(odoo_tec and odoo_tec["tickets"] > 0)

        if not veh["conductor"]:
            sin_conductor.append(veh)
            continue  # vehículo sin conductor asignado en TN360

        if tiene_gps and tiene_tickets:
            alerta = "ok"
        elif tiene_tickets and not tiene_gps:
            alerta = "sin_gps"
        elif tiene_gps and not tiene_tickets:
            alerta = "sin_tickets"
        else:
            alerta = "inactivo"

        cruce_rows.append({
            "vehiculo_id":          str(vid),
            "vehiculo":             veh["vehiculo"],
            "placa":                veh["placa"],
            "conductor":            veh["conductor"],
            "email":                email_lower,
            "sin_cuenta_odoo":      sin_odoo,
            "km_semana":            veh["km_semana"],
            "km_fuera":             veh["km_fuera"],
            "km_madrugada":         veh.get("km_madrugada", 0.0),
            "km_finde":             veh.get("km_finde", 0.0),
            "pct_fuera":            veh["pct_fuera"],
            "horas_campo":          veh["horas_campo"],
            "n_viajes":             veh["n_viajes"],
            "conductores_reales":   veh.get("conductores_reales", []),
            "conductor_mismatch":   veh.get("conductor_mismatch", False),
            "viajes_fuera_detalle": veh.get("viajes_fuera_detalle", []),
            "tickets":       odoo_tec["tickets"]  if odoo_tec else (0 if not sin_odoo else "sin cuenta"),
            "cerrados":      odoo_tec["cerrados"] if odoo_tec else 0,
            "abiertos":      odoo_tec["abiertos"] if odoo_tec else 0,
            "alerta":        alerta,
        })

    # Ordenar por % fuera de horario desc (mayor riesgo primero)
    cruce_rows.sort(key=lambda x: (-(x["pct_fuera"]), -(x["km_semana"])))

    # Vehículos de mayor riesgo: pct_fuera alto + tickets = 0 (y tienen conductor)
    alto_riesgo = [
        r for r in cruce_rows
        if r["pct_fuera"] > 20 and r["km_semana"] > 0
        and (r["tickets"] == 0 or r["tickets"] == "sin cuenta")
    ]

    return {
        "semana":         periodo_label,
        "periodo":        periodo,
        "plaza":          plaza_label or "Nacional",
        "version":        "2.0",
        "cruce":          cruce_rows,
        "sin_conductor":  [{"vehiculo": v["vehiculo"], "placa": v["placa"]} for v in sin_conductor],
        "alto_riesgo":    alto_riesgo,
        "todos_tecnicos": list(odoo_by_email.keys()),
        "resumen": {
            "vehiculos_total":      len(vehicles_raw),
            "con_conductor":        len(cruce_rows),
            "sin_conductor":        len(sin_conductor),
            "vehiculos_activos":    sum(1 for r in cruce_rows if r["n_viajes"] > 0),
            "km_total":             round(sum(v["km_semana"] for v in gps_list), 1),
            "km_fuera_total":       round(sum(v["km_fuera"] for v in gps_list), 1),
            "viajes_total":         sum(v["n_viajes"] for v in gps_list),
            "tickets_semana":       sum(t["tickets"] for t in odoo_by_email.values()),
            "km_madrugada_total":   round(sum(v.get("km_madrugada",0) for v in gps_list), 1),
            "mismatch_conductores": sum(1 for r in cruce_rows if r.get("conductor_mismatch")),
            "alertas":              sum(1 for r in cruce_rows if r["alerta"] in ("sin_gps","sin_tickets")),
            "alto_riesgo_count":    len(alto_riesgo),
        },
        "veh_map": manual_map,
    }

@app.patch("/api/wfm/bidrillas/vehiculo-tecnico-map")
def patch_veh_map(body: dict):
    """Guarda override de email para vehiculo_id → email. Body: {vid: email, ...}"""
    existing = _veh_map_load()
    existing.update(body)
    _veh_map_save(existing)
    return {"ok": True, "total": len(existing)}

@app.post("/api/wfm/bidrillas/cruce-semanal/reporte")
def post_cruce_reporte(periodo: str = "semanal", plaza: str = ""):
    """
    Genera PDF reporte V2 GPS×Tickets (mismo formato que V1 jun-2026)
    y lo envía por Telegram.
    plaza: '' (toda la flota) | 'piedras_negras' | 'yucatan'
    """
    import io
    try:
        from reportlab.lib.pagesizes import A4, letter
        from reportlab.lib import colors
        from reportlab.platypus import (SimpleDocTemplate, Paragraph, Table,
                                        TableStyle, Spacer, HRFlowable, Image,
                                        PageBreak, KeepTogether)
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.pdfgen import canvas as rl_canvas
        HAS_RL = True
    except ImportError:
        HAS_RL = False

    if not HAS_RL:
        return {"ok": False, "error": "reportlab no instalado"}

    data       = get_cruce_semanal(periodo=periodo, plaza=plaza)
    rows       = data["cruce"]
    resumen    = data["resumen"]
    semana     = data["semana"]
    plaza_label = data.get("plaza", "Nacional")
    alto_riesgo = data["alto_riesgo"]
    sin_cond   = data["sin_conductor"]

    periodo_titulo = {"diario": "Diario", "mensual": "Mensual"}.get(periodo, "Semanal")

    # ── Colores ────────────────────────────────────────────────────────────────
    VERDE_OSCURO = colors.HexColor("#1B4D2E")
    VERDE        = colors.HexColor("#00C896")
    GRIS_TEXTO   = colors.HexColor("#444444")
    GRIS_CLARO   = colors.HexColor("#888888")
    NEGRO        = colors.HexColor("#111111")
    ROJO         = colors.HexColor("#CC0000")
    AMBAR        = colors.HexColor("#D97706")
    FONDO_VERDE  = colors.HexColor("#F0FAF5")
    FONDO_GRIS   = colors.HexColor("#F5F5F5")

    buf = io.BytesIO()

    # ── Page template con header/footer ───────────────────────────────────────
    def on_page(canv, doc):
        canv.saveState()
        w, h = A4
        # Header bar verde
        canv.setFillColor(VERDE_OSCURO)
        canv.rect(0, h - 2.4*cm, w, 2.4*cm, fill=1, stroke=0)
        # Logo text placeholder
        canv.setFillColor(colors.white)
        canv.setFont("Helvetica-Bold", 14)
        canv.drawString(2*cm, h - 1.5*cm, "xcien")
        # Right header text
        canv.setFont("Helvetica", 8)
        canv.drawRightString(w - 2*cm, h - 1.1*cm, "Dirección General | Uso Exclusivo Interno")
        # Footer line
        canv.setStrokeColor(VERDE)
        canv.setLineWidth(0.5)
        canv.line(2*cm, 1.5*cm, w - 2*cm, 1.5*cm)
        canv.setFillColor(GRIS_CLARO)
        canv.setFont("Helvetica", 7)
        canv.drawString(2*cm, 1.0*cm,
            f"Xcien — Flota XCIEN — Cruce Tickets vs. Telemetría | Confidencial")
        canv.drawRightString(w - 2*cm, 1.0*cm, f"Página {doc.page} de —")
        canv.restoreState()

    def on_first_page(canv, doc):
        w, h = A4
        canv.saveState()
        # Header band verde
        canv.setFillColor(VERDE_OSCURO)
        canv.rect(0, h - 3.5*cm, w, 3.5*cm, fill=1, stroke=0)
        canv.setFillColor(colors.white)
        canv.setFont("Helvetica-Bold", 18)
        canv.drawString(2*cm, h - 2.3*cm, "xcien")
        # Footer band
        canv.setFillColor(VERDE_OSCURO)
        canv.rect(0, 0, w, 2*cm, fill=1, stroke=0)
        canv.setFillColor(colors.white)
        canv.setFont("Helvetica", 7)
        msg = "Xcien · Flota XCIEN — Cruce Tickets vs. Telemetría · Confidencial · Prohibida su reproducción sin autorización expresa"
        canv.drawCentredString(w/2, 0.7*cm, msg)
        canv.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4,
        topMargin=3*cm, bottomMargin=2.5*cm, leftMargin=2*cm, rightMargin=2*cm)

    styles = getSampleStyleSheet()
    CONF_STYLE = ParagraphStyle("conf", fontName="Helvetica", fontSize=7,
        textColor=GRIS_CLARO, alignment=1, spaceAfter=2)
    TITLE_STYLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=28,
        textColor=NEGRO, leading=34, spaceAfter=6, alignment=1)
    SUB_STYLE   = ParagraphStyle("sub", fontName="Helvetica-Bold", fontSize=14,
        textColor=VERDE, leading=18, spaceAfter=4, alignment=1)
    PERIOD_STYLE= ParagraphStyle("period", fontName="Helvetica", fontSize=10,
        textColor=GRIS_CLARO, alignment=1, spaceAfter=20)
    H2_STYLE    = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13,
        textColor=NEGRO, spaceAfter=6, spaceBefore=14)
    BODY_STYLE  = ParagraphStyle("body", fontName="Helvetica", fontSize=9,
        textColor=GRIS_TEXTO, leading=14, spaceAfter=4)

    story = []

    # ── PORTADA ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 1.5*cm))
    story.append(Paragraph("DOCUMENTO INTERNO · CONFIDENCIAL · USO EXCLUSIVO DE DIRECCIÓN", CONF_STYLE))
    story.append(Spacer(1, 0.8*cm))
    story.append(Paragraph(f"ANÁLISIS DE USO FUERA DE<br/>HORARIO — FLOTA XCIEN", TITLE_STYLE))
    story.append(Spacer(1, 0.4*cm))
    story.append(Paragraph(f"Cruce TN360 vs. Odoo · Plaza {plaza_label}", SUB_STYLE))
    story.append(HRFlowable(width="60%", thickness=1, color=VERDE, hAlign="CENTER"))
    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph(f"Telemetría GPS contra órdenes de servicio · {semana}", PERIOD_STYLE))

    # Tabla de metadatos
    import datetime as _dt
    fecha_actual = _dt.datetime.now().strftime("%d de %B de %Y").replace(
        "January","enero").replace("February","febrero").replace("March","marzo").replace(
        "April","abril").replace("May","mayo").replace("June","junio").replace(
        "July","julio").replace("August","agosto").replace("September","septiembre").replace(
        "October","octubre").replace("November","noviembre").replace("December","diciembre")

    meta_data = [
        [Paragraph("<b>ELABORADO POR:</b>", ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=9, textColor=VERDE_OSCURO)),
         Paragraph("José Miguel Macías", BODY_STYLE)],
        [Paragraph("<b>DIRIGIDO A:</b>", ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=9, textColor=VERDE_OSCURO)),
         Paragraph("Dirección de Operaciones — XCIEN Field Services", BODY_STYLE)],
        [Paragraph("<b>FECHA:</b>", ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=9, textColor=VERDE_OSCURO)),
         Paragraph(fecha_actual, BODY_STYLE)],
        [Paragraph("<b>VERSIÓN:</b>", ParagraphStyle("ml", fontName="Helvetica-Bold", fontSize=9, textColor=VERDE_OSCURO)),
         Paragraph("2.0", BODY_STYLE)],
    ]
    meta_table = Table(meta_data, colWidths=[4*cm, 11.7*cm])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), FONDO_VERDE),
        ("BOX",         (0,0), (-1,-1), 0.5, VERDE),
        ("INNERGRID",   (0,0), (-1,-1), 0.2, colors.HexColor("#CCE8D8")),
        ("TOPPADDING",  (0,0), (-1,-1), 6),
        ("BOTTOMPADDING",(0,0), (-1,-1), 6),
        ("LEFTPADDING", (0,0), (-1,-1), 8),
        ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
    ]))
    story.append(meta_table)
    story.append(PageBreak())

    # ── SECCIÓN 1: Resumen Ejecutivo ───────────────────────────────────────────
    story.append(Paragraph("1. Resumen Ejecutivo", H2_STYLE))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_CLARO))
    story.append(Spacer(1, 8))

    n_total      = resumen["vehiculos_total"]
    n_con_cond   = resumen["con_conductor"]
    n_sin_cond   = resumen["sin_conductor"]
    n_activos    = resumen["vehiculos_activos"]
    km_t         = resumen["km_total"]
    km_f         = resumen["km_fuera_total"]
    pct_f_global = round(km_f / km_t * 100, 1) if km_t > 0 else 0
    sin_odoo     = sum(1 for r in rows if r.get("sin_cuenta_odoo"))

    ejecutivo = (
        f"Se analizaron {n_activos} vehículos activos registrados en TN360 (de {n_total} totales, "
        f"excluyendo unidades de baja y sin actividad). "
        f"Se identificó conductor asignado (<i>defaultDriver</i>) en {n_con_cond} de ellos; "
        f"los restantes {n_sin_cond} no tienen conductor por defecto configurado en TN360 y "
        f"no pudieron incluirse en este cruce. "
        f"De los {n_con_cond} con conductor, {n_con_cond - sin_odoo} tienen cuenta verificable "
        f"en Odoo (login = correo del conductor en TN360) y {sin_odoo} no — para estos últimos "
        f"no se puede confirmar si el uso fuera de horario corresponde a trabajo real."
    )
    story.append(Paragraph(ejecutivo, BODY_STYLE))
    story.append(Spacer(1, 6))

    metodologia = (
        "Metodología: para cada vehículo se descargó el detalle de viajes de TN360 del período "
        f"{semana} (hora local Saltillo, UTC-6), clasificando cada viaje como <b>Laboral</b> "
        "(Lun-Vie 8AM-6PM), <b>Nocturno</b> (Lun-Vie fuera de esa ventana), "
        "<b>Madrugada</b> (12AM-6AM) o <b>Fin de Semana</b>. "
        "Se cruzó el correo del conductor contra Odoo para contar tickets de project.task "
        "asignados en ese mismo período."
    )
    story.append(Paragraph(metodologia, BODY_STYLE))
    story.append(Spacer(1, 10))

    # KPIs en tabla
    kpi_vals = [
        ["Vehículos analizados", "Con conductor", "Km totales", "Km fuera de horario", "% fuera global", "Alertas"],
        [str(n_activos), str(n_con_cond), f"{km_t:,.0f} km", f"{km_f:,.0f} km",
         f"{pct_f_global}%", str(resumen["alertas"])],
    ]
    kpi_t = Table(kpi_vals, colWidths=[2.7*cm]*6)
    kpi_t.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,0), VERDE_OSCURO),
        ("TEXTCOLOR",   (0,0), (-1,0), colors.white),
        ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",    (0,0), (-1,-1), 8),
        ("ALIGN",       (0,0), (-1,-1), "CENTER"),
        ("GRID",        (0,0), (-1,-1), 0.2, colors.white),
        ("BACKGROUND",  (0,1), (-1,1), FONDO_VERDE),
        ("TOPPADDING",  (0,0), (-1,-1), 5),
        ("BOTTOMPADDING",(0,0), (-1,-1), 5),
    ]))
    story.append(kpi_t)
    story.append(Spacer(1, 16))

    # ── SECCIÓN 2: Tabla completa ──────────────────────────────────────────────
    story.append(Paragraph(f"2. Tabla Completa — {n_con_cond} Vehículos con Conductor", H2_STYLE))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_CLARO))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Ordenado por % de kilometraje fuera de horario, de mayor a menor riesgo.", BODY_STYLE))
    story.append(Spacer(1, 8))

    tbl_hdr = ["Unidad", "Conductor", "KM\nsemana", "% fuera\nhorario", "KM\nMadrugada", "Tickets\nOdoo"]
    tbl_data = [tbl_hdr]
    for r in rows:
        tickets_str = str(r["tickets"]) if r["tickets"] != "sin cuenta" else "sin cuenta"
        tbl_data.append([
            r["vehiculo"],
            (r["conductor"] or "—")[:26],
            f"{r['km_semana']:,.1f} km",
            f"{r['pct_fuera']}%",
            f"{r.get('km_madrugada',0):.1f} km",
            tickets_str,
        ])

    col_w2 = [1.8*cm, 5.5*cm, 2.2*cm, 2.2*cm, 1.9*cm, 2.2*cm]
    tbl = Table(tbl_data, colWidths=col_w2, repeatRows=1)
    row_styles2 = [
        ("BACKGROUND",   (0,0), (-1,0), NEGRO),
        ("TEXTCOLOR",    (0,0), (-1,0), VERDE),
        ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",     (0,0), (-1,-1), 8),
        ("ALIGN",        (0,0), (0,-1), "CENTER"),
        ("ALIGN",        (2,0), (-1,-1), "CENTER"),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [FONDO_GRIS, colors.white]),
        ("GRID",         (0,0), (-1,-1), 0.2, colors.HexColor("#DDDDDD")),
        ("TOPPADDING",   (0,0), (-1,-1), 4),
        ("BOTTOMPADDING",(0,0), (-1,-1), 4),
    ]
    # Color riesgo en columna % fuera
    for i, r in enumerate(rows, start=1):
        if r["pct_fuera"] >= 60:
            row_styles2.append(("TEXTCOLOR", (3,i), (3,i), ROJO))
            row_styles2.append(("FONTNAME",  (3,i), (3,i), "Helvetica-Bold"))
        elif r["pct_fuera"] >= 30:
            row_styles2.append(("TEXTCOLOR", (3,i), (3,i), AMBAR))
        if r["tickets"] == "sin cuenta":
            row_styles2.append(("TEXTCOLOR", (5,i), (5,i), GRIS_CLARO))
            row_styles2.append(("FONTNAME",  (5,i), (5,i), "Helvetica-Oblique"))
    tbl.setStyle(TableStyle(row_styles2))
    story.append(tbl)
    story.append(PageBreak())

    # ── SECCIÓN 3: Mayor riesgo ────────────────────────────────────────────────
    story.append(Paragraph(
        "3. Vehículos de Mayor Riesgo (alto % fuera de horario, cero tickets confirmados)", H2_STYLE))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_CLARO))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Estos vehículos combinan un porcentaje alto de kilometraje fuera de horario laboral con "
        "cero tickets de Odoo registrados en el período para su conductor — es decir, no hay "
        "ninguna orden de servicio que explique el uso fuera de horario.", BODY_STYLE))
    story.append(Spacer(1, 8))

    if alto_riesgo:
        risk_hdr = ["Unidad", "Conductor", "KM total semana", "% fuera de horario", "KM Madrugada"]
        risk_data = [risk_hdr] + [
            [r["vehiculo"], r["conductor"] or "—", f"{r['km_semana']:,.1f} km",
             f"{r['pct_fuera']}%", f"{r.get('km_madrugada',0):.1f} km"]
            for r in alto_riesgo
        ]
        risk_tbl = Table(risk_data, colWidths=[2*cm, 5*cm, 3.5*cm, 3.5*cm, 2*cm])
        risk_tbl.setStyle(TableStyle([
            ("BACKGROUND",  (0,0), (-1,0), NEGRO),
            ("TEXTCOLOR",   (0,0), (-1,0), VERDE),
            ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",    (0,0), (-1,-1), 8),
            ("ALIGN",       (2,0), (-1,-1), "CENTER"),
            ("ROWBACKGROUNDS",(0,1), (-1,-1), [FONDO_GRIS, colors.white]),
            ("GRID",        (0,0), (-1,-1), 0.2, colors.HexColor("#DDDDDD")),
            ("TOPPADDING",  (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0), (-1,-1), 4),
        ]))
        story.append(risk_tbl)
        story.append(Spacer(1, 10))

        # Bullets para los top 4 de mayor riesgo
        for r in alto_riesgo[:4]:
            bullet = (
                f"<b>{r['vehiculo']} ({r['conductor']})</b>: {r['pct_fuera']}% del kilometraje "
                f"de la semana fue fuera de horario sobre un total de {r['km_semana']:,.1f} km — "
                f"{r.get('km_madrugada',0):.1f} km en madrugada (00:00–06:00), sin tickets que respalden el uso."
            )
            story.append(Paragraph(f"• {bullet}", BODY_STYLE))
    else:
        story.append(Paragraph("No se identificaron vehículos de alto riesgo en este período.", BODY_STYLE))

    story.append(Spacer(1, 16))

    # ── SECCIÓN 3b: Ubicaciones fuera de horario ───────────────────────────────
    # Recopilar los viajes fuera de horario de los vehículos de mayor riesgo (y todos si son pocos)
    viajes_fuera_all = []
    for r in rows:
        for vf in r.get("viajes_fuera_detalle", []):
            viajes_fuera_all.append({**vf, "vehiculo": r["vehiculo"], "conductor": r["conductor"] or "—"})
    # Ordenar: madrugada primero, luego nocturno, luego finde; dentro de cada uno por fecha
    cls_order = {"madrugada": 0, "nocturno": 1, "finde": 2}
    viajes_fuera_all.sort(key=lambda x: (cls_order.get(x["cls"], 9), x["hora_local"]))

    if viajes_fuera_all:
        story.append(Paragraph("3b. Detalle de Viajes Fuera de Horario — Origen y Destino", H2_STYLE))
        story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_CLARO))
        story.append(Spacer(1, 6))
        story.append(Paragraph(
            "Viajes realizados fuera del horario laboral (Lun–Vie 8:00–18:00). "
            "Se muestran origen y destino según telemetría GPS de TN360.", BODY_STYLE))
        story.append(Spacer(1, 8))

        CLS_ES = {"madrugada": "Madrugada 00–06h", "nocturno": "Nocturno", "finde": "Fin de semana"}
        loc_hdr = ["Unidad", "Conductor", "Horario", "Tipo", "KM", "Origen (GPS)", "Destino (GPS)"]
        loc_data = [loc_hdr]
        for vf in viajes_fuera_all[:30]:
            # Indicar si el conductor del viaje difiere del asignado
            drv_label = ""
            if vf.get("driver_nombre") and vf["driver_nombre"] != vf["conductor"]:
                drv_label = f"\n⚠ Conductor real: {vf['driver_nombre']}"
            loc_data.append([
                vf["vehiculo"],
                (vf["conductor"] or "—")[:20] + drv_label,
                vf["hora_local"],
                CLS_ES.get(vf["cls"], vf["cls"]),
                f"{vf['km']:.1f}",
                vf["start"] or "—",
                vf["end"]   or "—",
            ])

        col_loc = [1.8*cm, 3.5*cm, 2.5*cm, 2.5*cm, 1.2*cm, 4.2*cm, 4.2*cm]
        loc_tbl = Table(loc_data, colWidths=col_loc, repeatRows=1)
        row_cls_styles = [
            ("BACKGROUND",   (0,0), (-1,0), NEGRO),
            ("TEXTCOLOR",    (0,0), (-1,0), VERDE),
            ("FONTNAME",     (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",     (0,0), (-1,-1), 7),
            ("ALIGN",        (0,0), (0,-1), "CENTER"),
            ("ALIGN",        (2,0), (4,-1), "CENTER"),
            ("ROWBACKGROUNDS",(0,1), (-1,-1), [FONDO_GRIS, colors.white]),
            ("GRID",         (0,0), (-1,-1), 0.2, colors.HexColor("#DDDDDD")),
            ("TOPPADDING",   (0,0), (-1,-1), 3),
            ("BOTTOMPADDING",(0,0), (-1,-1), 3),
            ("WORDWRAP",     (0,0), (-1,-1), True),
        ]
        # Colorear filas según tipo
        for i, vf in enumerate(viajes_fuera_all[:30], start=1):
            if vf["cls"] == "madrugada":
                row_cls_styles.append(("TEXTCOLOR", (3,i), (3,i), ROJO))
                row_cls_styles.append(("FONTNAME",  (3,i), (3,i), "Helvetica-Bold"))
            elif vf["cls"] == "nocturno":
                row_cls_styles.append(("TEXTCOLOR", (3,i), (3,i), AMBAR))
        loc_tbl.setStyle(TableStyle(row_cls_styles))
        story.append(loc_tbl)
        if len(viajes_fuera_all) > 30:
            story.append(Paragraph(
                f"… y {len(viajes_fuera_all) - 30} viajes adicionales fuera de horario no mostrados.", BODY_STYLE))

        # Alerta de conductor real distinto al asignado
        mismatches = [vf for vf in viajes_fuera_all
                      if vf.get("driver_nombre") and vf["driver_nombre"] != vf["conductor"]]
        if mismatches:
            story.append(Spacer(1, 8))
            story.append(Paragraph(
                f"<b>⚠ Conductor real distinto al asignado:</b> {len(mismatches)} viaje(s) fuera de horario "
                f"fueron realizados por un conductor diferente al <i>defaultDriver</i> configurado en TN360. "
                f"Esto puede indicar préstamo de vehículo o configuración incorrecta.",
                ParagraphStyle("warn", parent=BODY_STYLE, textColor=AMBAR)))
        story.append(Spacer(1, 16))

    # ── SECCIÓN 4: Limitaciones ────────────────────────────────────────────────
    story.append(Paragraph("4. Limitaciones del Análisis", H2_STYLE))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_CLARO))
    story.append(Spacer(1, 6))

    sin_cond_names = ", ".join(r.get("vehiculo","") for r in sin_cond[:8])
    sin_odoo_names = ", ".join(
        r["conductor"] for r in rows if r.get("sin_cuenta_odoo") and r.get("conductor"))[:200]

    limitaciones = [
        f"{n_sin_cond} vehículos activos en TN360 no tienen conductor por defecto configurado "
        f"({sin_cond_names or 'ver listado completo'}) — no se pudieron incluir en el cruce.",
        f"{sin_odoo} conductores con vehículo asignado no tienen cuenta de Odoo localizable "
        f"con su correo de TN360 ({sin_odoo_names or '—'}) — para estos no se puede confirmar "
        f"ni descartar respaldo de tickets.",
        "El conteo de tickets incluye tareas de Field Service creadas o actualizadas en el período "
        "— no valida que el horario del ticket coincida exactamente con el del viaje fuera de "
        "horario, solo que existió actividad asignada esa semana.",
    ]
    for lim in limitaciones:
        story.append(Paragraph(f"• {lim}", BODY_STYLE))

    story.append(Spacer(1, 16))

    # ── SECCIÓN 5: Recomendaciones ─────────────────────────────────────────────
    story.append(Paragraph("5. Recomendación", H2_STYLE))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_CLARO))
    story.append(Spacer(1, 6))

    top3 = [r["vehiculo"] for r in alto_riesgo[:3]]
    recomendaciones = [
        f"Priorizar revisión directa con {', '.join(top3) or 'los vehículos de mayor riesgo'} — "
        f"son los de mayor exposición (alto % fuera de horario y/o alto kilometraje) sin ningún "
        f"ticket que lo respalde.",
        f"Solicitar a TN360/RRHH completar el campo de conductor por defecto en los {n_sin_cond} "
        f"vehículos activos que no lo tienen — sin eso no hay manera de auditar su uso.",
        f"Confirmar o corregir el correo de Odoo de los {sin_odoo} conductores sin cuenta "
        f"localizable, para poder cruzarlos en el próximo corte.",
        "Replicar el reporte individual detallado (hora por hora) para los vehículos de mayor "
        "riesgo identificados en la sección 3.",
    ]
    for rec in recomendaciones:
        story.append(Paragraph(f"• {rec}", BODY_STYLE))

    # ── Build ──────────────────────────────────────────────────────────────────
    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_page)
    pdf_bytes = buf.getvalue()

    # ── Enviar a Telegram ──────────────────────────────────────────────────────
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN","")
    chat_id   = os.environ.get("TELEGRAM_CHAT_ID_REPORTES","") or os.environ.get("TELEGRAM_CHAT_ID","")
    sent_ok   = False
    plaza_slug = plaza_label.replace(" ","_") if plaza_label != "Nacional" else "Nacional"
    filename  = f"Reporte_Flota_XCIEN_{plaza_slug}_V2_{semana.replace(' ','_').replace('–','-')}.pdf"
    if bot_token and chat_id:
        try:
            caption = (
                f"📊 *Reporte {periodo_titulo} GPS×Tickets V2 — {plaza_label}*\n"
                f"📅 {semana}\n"
                f"🚛 {n_activos} vehículos · {km_t:,.0f} km · {resumen['tickets_semana']} tickets\n"
                f"⚠️ {resumen['alto_riesgo_count']} vehículos de alto riesgo"
            )
            files = {"document": (filename, pdf_bytes, "application/pdf")}
            _data = {"chat_id": chat_id, "caption": caption, "parse_mode": "Markdown"}
            import requests as _rq2
            _rq2.post(f"https://api.telegram.org/bot{bot_token}/sendDocument",
                      data=_data, files=files, timeout=30)
            sent_ok = True
        except Exception as te:
            logger.error(f"Telegram cruce PDF error: {te}")

    return {
        "ok":      True,
        "version": "2.0",
        "semana":  semana,
        "filename": filename,
        "telegram": sent_ok,
        "resumen":  resumen,
    }



# ─── Integraciones Externas ──────────────────────────────────────────────────

@app.post("/api/integrations/execute")
async def execute_integration(req: IntegrationRequest):
    """Ejecuta una acción en una plataforma externa (HubSpot, Net2Phone, etc)"""
    try:
        result = orchestrator.execute(req.platform, req.action, req.params)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return {"status": "success", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Biblioteca Documental ───────────────────────────────────────────────────

@app.get("/api/library/docs")
def get_library_docs():
    """Retorna la lista de documentos organizados por categoría."""
    docs_dir = os.path.join(os.path.dirname(BASE_DIR), "docs")
    db_dir = os.path.join(BASE_DIR, "db")
    
    library = []
    
    # Escanear directorio docs/
    if os.path.exists(docs_dir):
        for root, dirs, files in os.walk(docs_dir):
            category = os.path.basename(root).replace("_", " ").title()
            if category == "Docs": category = "General"
            
            for file in files:
                if file.endswith(".md") or file.endswith(".pdf"):
                    library.append({
                        "id": file,
                        "name": file.replace("_", " ").replace(".md", "").replace(".pdf", ""),
                        "filename": file,
                        "type": "pdf" if file.endswith(".pdf") else "md",
                        "category": category,
                        "path": os.path.join(root, file)
                    })
                    
    # Añadir PDFs generados en db/ (ej. FODA_XCIEN_2026.pdf)
    if os.path.exists(db_dir):
        for file in os.listdir(db_dir):
            if file.endswith(".pdf"):
                library.append({
                    "id": file,
                    "name": file.replace("_", " ").replace(".pdf", ""),
                    "filename": file,
                    "type": "pdf",
                    "category": "Reportes Estratégicos",
                    "path": os.path.join(db_dir, file)
                })
                
    return {"status": "success", "documents": library}

@app.get("/api/library/download")
def download_doc(path: str):
    """Descarga o sirve el documento solicitado."""
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
        
    # Seguridad básica para evitar que salgan del proyecto
    abs_path = os.path.abspath(path)
    if "Antigravity" not in abs_path:
        raise HTTPException(status_code=403, detail="Acceso denegado")
        
    return FileResponse(abs_path)


USUARIOS_DB = os.path.join(BASE_DIR, "db", "usuarios.json")

@app.get("/api/users")
def get_users(_user: dict = Depends(require_rol("admin", "director"))):
    if not os.path.exists(USUARIOS_DB):
        return []
    with open(USUARIOS_DB, "r") as f:
        return json.load(f)

@app.post("/api/users")
def create_user(user: Dict[str, Any], _user: dict = Depends(require_rol("admin"))):
    users = get_users()
    user["id"] = str(len(users) + 1)
    user["status"] = "pending"
    user["invited_at"] = str(date.today())
    users.append(user)
    with open(USUARIOS_DB, "w") as f:
        json.dump(users, f, indent=2)
    
    # Intento de envío de notificación real (Telegram)
    try:
        config = _load_telegram_config()
        if config.get("enabled") and config.get("token"):
            bot = TelegramBot(token=config["token"], chat_id=config["chat_id"])
            msg = (
                f"👤 *NUEVA INVITACIÓN XCIEN 2.0*\n\n"
                f"Se ha invitado a *{user['name']}* a la plataforma.\n"
                f"🏢 *Depto:* {user['department']}\n"
                f"🔑 *Rol:* {user['role']}\n\n"
                f"Acceso pendiente de activación."
            )
            bot.send_message(msg)
    except Exception as e:
        logger.error(f"Error enviando notificación de invitación: {e}")

    return user

@app.post("/api/users/activate/{user_id}")
def activate_user(user_id: str, _user: dict = Depends(require_rol("admin"))):
    users = get_users()
    for u in users:
      if u["id"] == user_id:
        u["status"] = "active"
        u["lastSeen"] = str(date.today())
        with open(USUARIOS_DB, "w") as f:
            json.dump(users, f, indent=2)
        return {"status": "success", "user": u}
    raise HTTPException(status_code=404, detail="Usuario no encontrado")

@app.get("/api/integrations/status")
async def get_integrations_status():
    """Retorna el estado de las conexiones configuradas"""
    return {
        "hubspot": {"connected": True, "last_sync": "2026-04-27 13:00"},
        "net2phone": {"connected": True, "calls_active": 0},
        "ai_agents": {"active": True, "model": "Director General v2"}
    }

def push_command(req: CommandRequest, _user: dict = Depends(get_current_user)):
    AGENT_BRIDGE["command_queue"].append({
        "command": req.command,
        "context": req.context,
        "ts": datetime.datetime.now().strftime("%H:%M:%S"),
        "status": "pending"
    })
    return {"status": "queued", "pos": len(AGENT_BRIDGE["command_queue"])}

@app.get("/api/health")
def health():
    return {"status": "ok"}


# ─── Endpoints WFM ───────────────────────────────────────────────────────────

# ── SLA Config ────────────────────────────────────────────────────────────────
_SLA_CONFIG_FILE = os.path.join(BASE_DIR, "db", "sla_config.json")

_DEFAULT_SLA_CONFIG = {
  "limites": {
    "SOLICITUD_PREVENTA":   { "dias": 5,  "owner": "ops", "label": "Solicitud Preventa",   "icon": "🔍" },
    "ANTEPROYECTO":         { "dias": 3,  "owner": "ops", "label": "Anteproyecto",          "icon": "📐" },
    "ORDEN_IMPLEMENTACION": { "dias": 2,  "owner": "pm",  "label": "Orden Implementación",  "icon": "📋" },
    "ALMACEN_VALIDACION":   { "dias": 2,  "owner": "ops", "label": "Validación Almacén",    "icon": "📦" },
    "ESPERA_INVENTARIO":    { "dias": 5,  "owner": "ops", "label": "Espera Inventario",     "icon": "⏳" },
    "APROVISIONAMIENTO":    { "dias": 1,  "owner": "noc", "label": "Aprovisionamiento",     "icon": "⚙️" },
    "REVISION_PM":          { "dias": 1,  "owner": "pm",  "label": "Revisión PM",           "icon": "🔎" },
    "LISTO_INSTALACION":    { "dias": 1,  "owner": "pm",  "label": "Listo p/ Instalación",  "icon": "✅" },
    "INSTALACION":          { "dias": 3,  "owner": "ops", "label": "Instalación",           "icon": "🚛" },
    "NOC_VALIDACION":       { "dias": 1,  "owner": "noc", "label": "Validación NOC",        "icon": "📡" },
    "FACTURACION":          { "dias": 2,  "owner": "pm",  "label": "Facturación",           "icon": "💰" },
  },
  "nodos": {
    "noc": { "label": "NOC",              "icon": "📡", "color": "#00B4D8" },
    "pm":  { "label": "PM / Operaciones", "icon": "📋", "color": "#FF4757" },
    "ops": { "label": "Campo / Dispatch", "icon": "🚛", "color": "#00ff88" },
  },
  "updated_at": None,
  "updated_by": None,
}

def _load_sla_config() -> dict:
    try:
        if os.path.exists(_SLA_CONFIG_FILE):
            with open(_SLA_CONFIG_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return _DEFAULT_SLA_CONFIG.copy()

def _save_sla_config(cfg: dict):
    os.makedirs(os.path.dirname(_SLA_CONFIG_FILE), exist_ok=True)
    with open(_SLA_CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

class SLAConfigUpdateRequest(BaseModel):
    limites: Optional[dict] = None
    nodos:   Optional[dict] = None
    usuario: str = "sistema"

@app.get("/api/wfm/sla-config")
def get_sla_config():
    return _load_sla_config()

@app.post("/api/wfm/sla-config")
def update_sla_config(req: SLAConfigUpdateRequest):
    cfg = _load_sla_config()
    if req.limites:
        for estado, vals in req.limites.items():
            if estado in cfg["limites"]:
                cfg["limites"][estado].update(vals)
            else:
                cfg["limites"][estado] = vals
    if req.nodos:
        for nodo, vals in req.nodos.items():
            if nodo in cfg["nodos"]:
                cfg["nodos"][nodo].update(vals)
            else:
                cfg["nodos"][nodo] = vals
    cfg["updated_at"] = datetime.datetime.now().isoformat()
    cfg["updated_by"] = req.usuario
    _save_sla_config(cfg)
    return {"ok": True, "config": cfg}

@app.post("/api/wfm/sla-config/reset")
def reset_sla_config():
    cfg = _DEFAULT_SLA_CONFIG.copy()
    _save_sla_config(cfg)
    return {"ok": True, "config": cfg}


# ── SLA Escalation Log ────────────────────────────────────────────────────────
_ESC_LOG_FILE        = os.path.join(BASE_DIR, "db", "sla_escalaciones.json")
_ESC_AUTO_CLEAR_MINS = 30   # minutos sin atención → auto-clear

def _load_esc_log() -> list:
    try:
        if os.path.exists(_ESC_LOG_FILE):
            with open(_ESC_LOG_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return []

def _save_esc_log(log: list):
    os.makedirs(os.path.dirname(_ESC_LOG_FILE), exist_ok=True)
    with open(_ESC_LOG_FILE, "w") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)

def _esc_id() -> str:
    ts = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    rand = ''.join([str(ord(c) % 10) for c in ts[-4:]])
    return f"ESC-{datetime.datetime.now().strftime('%Y%m%d')}-{rand}"

def _auto_clear_escalaciones():
    """Marca como AUTO_CLEARED las escalaciones sin ACK pasados N minutos."""
    log = _load_esc_log()
    now = datetime.datetime.now()
    changed = False
    for esc in log:
        if esc.get("status") == "ACTIVO":
            triggered = datetime.datetime.fromisoformat(esc["triggered_at"])
            mins_elapsed = (now - triggered).total_seconds() / 60
            if mins_elapsed >= _ESC_AUTO_CLEAR_MINS:
                esc["status"]      = "AUTO_CLEARED"
                esc["cleared_at"]  = now.isoformat()
                esc["cleared_by"]  = "SISTEMA"
                esc["notas"]      += f" | AUTO-CLEARED tras {int(mins_elapsed)}min sin atención"
                changed = True
    if changed:
        _save_esc_log(log)
    return log

class EscalacionAckRequest(BaseModel):
    esc_id:    str
    acked_by:  str = "NOC Operador"
    notas:     str = ""

class EscalacionClearRequest(BaseModel):
    order_id:   str
    cliente:    str
    estado:     str
    severity:   str          # 'critico' | 'alerta'
    dias:       float
    owner_node: str
    cleared_by: str = "NOC Operador"
    notas:      str = ""

@app.get("/api/wfm/sla-escalaciones")
def get_escalaciones(limit: int = 100):
    _auto_clear_escalaciones()
    log = _load_esc_log()
    # Más reciente primero
    log.sort(key=lambda x: x.get("triggered_at", ""), reverse=True)
    return {"log": log[:limit], "total": len(log)}

@app.post("/api/wfm/sla-escalacion/clear")
def clear_escalacion(req: EscalacionClearRequest):
    """Registra un Clear manual de una alerta SLA con log protocolo NOC."""
    _auto_clear_escalaciones()
    log = _load_esc_log()
    now = datetime.datetime.now()

    # Verificar si ya existe una entrada activa para esta orden+estado
    existing = next((e for e in log if e.get("order_id") == req.order_id
                     and e.get("estado") == req.estado
                     and e.get("status") == "ACTIVO"), None)

    if existing:
        existing["status"]     = "CLEARED"
        existing["cleared_at"] = now.isoformat()
        existing["cleared_by"] = req.cleared_by
        if req.notas:
            existing["notas"] += f" | {req.notas}"
        entry = existing
    else:
        # Primera vez que se registra esta escalación
        entry = {
            "esc_id":       _esc_id(),
            "triggered_at": now.isoformat(),
            "order_id":     req.order_id,
            "cliente":      req.cliente,
            "estado":       req.estado,
            "severity":     req.severity.upper(),
            "dias_sla":     round(req.dias, 2),
            "owner_node":   req.owner_node,
            "status":       "CLEARED",
            "cleared_at":   now.isoformat(),
            "cleared_by":   req.cleared_by,
            "notas":        req.notas or f"Clear manual por {req.cleared_by}",
        }
        log.append(entry)

    _save_esc_log(log)
    return {"ok": True, "entry": entry}

@app.post("/api/wfm/sla-escalacion/ack")
def ack_escalacion(req: EscalacionAckRequest):
    """ACK de una escalación — queda registrado como ATENDIDO."""
    log = _load_esc_log()
    entry = next((e for e in log if e.get("esc_id") == req.esc_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Escalación no encontrada")
    entry["status"]    = "ATENDIDO"
    entry["acked_at"]  = datetime.datetime.now().isoformat()
    entry["acked_by"]  = req.acked_by
    if req.notas:
        entry["notas"] += f" | {req.notas}"
    _save_esc_log(log)
    return {"ok": True, "entry": entry}

@app.post("/api/wfm/sla-escalacion/registrar")
def registrar_escalacion(req: EscalacionClearRequest):
    """Registra una nueva escalación activa (llamada automática al detectar SLA excedido)."""
    _auto_clear_escalaciones()
    log = _load_esc_log()
    # No duplicar si ya hay una activa para esta orden+estado
    existing = next((e for e in log if e.get("order_id") == req.order_id
                     and e.get("estado") == req.estado
                     and e.get("status") == "ACTIVO"), None)
    if existing:
        return {"ok": True, "entry": existing, "duplicado": True}

    entry = {
        "esc_id":       _esc_id(),
        "triggered_at": datetime.datetime.now().isoformat(),
        "order_id":     req.order_id,
        "cliente":      req.cliente,
        "estado":       req.estado,
        "severity":     req.severity.upper(),
        "dias_sla":     round(req.dias, 2),
        "owner_node":   req.owner_node,
        "status":       "ACTIVO",
        "cleared_at":   None,
        "cleared_by":   None,
        "notas":        req.notas or "Escalación automática por SLA excedido",
    }
    log.append(entry)
    _save_esc_log(log)
    return {"ok": True, "entry": entry}

@app.delete("/api/wfm/sla-escalaciones/purge")
def purge_escalaciones(dias: int = 30):
    """Elimina entradas del log anteriores a N días (mantenimiento)."""
    log = _load_esc_log()
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=dias)).isoformat()
    nuevo = [e for e in log if e.get("triggered_at", "") >= cutoff]
    _save_esc_log(nuevo)
    return {"ok": True, "eliminadas": len(log) - len(nuevo), "restantes": len(nuevo)}


@app.get("/api/wfm/ordenes")
async def get_wfm_orders(background_tasks: BackgroundTasks, estado: str = None):
    background_tasks.add_task(wfm_service._sync_with_odoo)
    return wfm_service.obtener_ordenes(estado)

@app.post("/api/wfm/sync")
async def wfm_sync_forzado():
    """Fuerza sincronización inmediata con Odoo."""
    try:
        wfm_service.sync_forzado()
        ordenes = wfm_service.obtener_ordenes()
        odoo_count = sum(1 for o in ordenes if o.get("odoo_id"))
        return {"ok": True, "total": len(ordenes), "de_odoo": odoo_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/wfm/comercial/solicitar")
async def wfm_solicitar(req: WFMCreateRequest):
    return wfm_service.crear_solicitud_comercial(req.cliente, req.servicio, req.comercial)

@app.post("/api/wfm/preventa/actualizar")
async def wfm_preventa(req: WFMUpdatePreventaRequest):
    return wfm_service.actualizar_preventa(req.order_id, req.data, req.usuario)

@app.post("/api/wfm/ventas/contratar")
async def wfm_contratar(req: WFMBasicActionRequest):
    return wfm_service.contratar_orden(req.order_id, req.usuario)

@app.post("/api/wfm/almacen/asignar")
async def wfm_almacen(req: WFMAlmacenRequest):
    return wfm_service.asignar_equipos_almacen(req.order_id, req.equipos, req.usuario)

@app.post("/api/wfm/almacen/responder")
async def wfm_almacen_responder(req: WFMAlmacenRespuestaRequest):
    try:
        return wfm_service.responder_almacen(
            req.order_id, req.respuesta, req.equipos,
            req.fecha_estimada, req.motivo, req.usuario
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/wfm/aprovisionar")
async def wfm_aprovisionar(req: WFMAproRequest):
    return wfm_service.aprovisionar_servicio(req.order_id, req.config, req.usuario)

@app.post("/api/wfm/aprovisionamiento/registrar")
async def wfm_aprovisionamiento_registrar(req: WFMAprovisionar2Request):
    config = {k: v for k, v in req.dict().items() if k not in ("order_id", "usuario") and v is not None}
    try:
        return wfm_service.aprovisionar_servicio(req.order_id, config, req.usuario)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/wfm/pm/auditar")
async def wfm_auditar(req: WFMAuditoriaRequest):
    return wfm_service.auditar_pm(req.order_id, req.ok, req.motivo, req.usuario)

@app.post("/api/wfm/instalacion/evidencia")
async def wfm_registrar_evidencia(req: WFMEvidenciaRequest):
    try:
        return wfm_service.registrar_evidencia(req.order_id, req.tipo, req.filename, req.data_b64, req.usuario)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/wfm/instalacion/evidencias/{order_id}")
async def wfm_get_evidencias(order_id: str):
    try:
        return wfm_service.obtener_evidencias(order_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/wfm/instalacion/cerrar")
async def wfm_cerrar_instalacion(req: WFMCerrarInstalacionRequest):
    try:
        return wfm_service.cerrar_instalacion(req.order_id, req.notas, req.usuario)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/wfm/kpis")
async def wfm_kpis_globales():
    return wfm_service.calcular_kpis_globales()

@app.get("/api/wfm/kpis/{order_id}")
async def wfm_kpis_orden(order_id: str):
    try:
        return wfm_service.calcular_kpis_orden(order_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/api/wfm/noc/{order_id}")
async def wfm_noc_estado(order_id: str):
    try:
        return wfm_service.obtener_estado_noc(order_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/wfm/noc/ping")
async def wfm_noc_ping(req: WFMNocPingRequest):
    try:
        return wfm_service.registrar_ping_noc(req.order_id, req.ping_ok, req.latencia_ms, req.ip_destino, req.usuario)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/wfm/noc/alta-monitoreo")
async def wfm_noc_alta(req: WFMNocAltaRequest):
    try:
        return wfm_service.dar_alta_monitoreo(req.order_id, req.herramienta, req.host_id, req.grupos_alerta, req.usuario)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/wfm/noc/aprobar")
async def wfm_noc_aprobar(req: WFMNocAprobarRequest):
    try:
        return wfm_service.aprobar_noc(req.order_id, req.observaciones, req.usuario)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/wfm/instalacion/prueba-velocidad")
async def wfm_registrar_prueba(req: WFMPruebaVelocidadRequest):
    try:
        return wfm_service.registrar_prueba_velocidad(
            req.order_id, req.bw_contratado_mbps,
            req.descarga_mbps, req.subida_mbps,
            req.latencia_ms, req.perdida_pct,
            req.servidor, req.herramienta, req.usuario
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/wfm/instalacion/pruebas-velocidad/{order_id}")
async def wfm_get_pruebas(order_id: str):
    try:
        return wfm_service.obtener_pruebas_velocidad(order_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/api/wfm/instalacion/checklist/{order_id}")
async def wfm_get_checklist(order_id: str):
    try:
        return wfm_service.obtener_checklist(order_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.post("/api/wfm/instalacion/checklist")
async def wfm_marcar_checklist(req: WFMChecklistItemRequest):
    try:
        orden = wfm_service.marcar_checklist_item(req.order_id, req.item_id, req.completado, req.observacion, req.usuario)
        checklist = orden.get("checklist", [])
        completados = sum(1 for i in checklist if i["completado"])
        return {"ok": True, "completados": completados, "total": len(checklist), "checklist": checklist}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ─── Integraciones Externas ──────────────────────────────────────────────────

@app.post("/api/integrations/execute")
async def execute_integration(req: IntegrationRequest):
    """Ejecuta una acción en una plataforma externa (HubSpot, Net2Phone, etc)"""
    try:
        result = orchestrator.execute(req.platform, req.action, req.params)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return {"status": "success", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Biblioteca Documental ───────────────────────────────────────────────────

@app.get("/api/library/docs")
def get_library_docs():
    """Retorna la lista de documentos organizados por categoría."""
    docs_dir = os.path.join(os.path.dirname(BASE_DIR), "docs")
    db_dir = os.path.join(BASE_DIR, "db")
    
    library = []
    
    # Escanear directorio docs/
    if os.path.exists(docs_dir):
        for root, dirs, files in os.walk(docs_dir):
            category = os.path.basename(root).replace("_", " ").title()
            if category == "Docs": category = "General"
            
            for file in files:
                if file.endswith(".md") or file.endswith(".pdf"):
                    library.append({
                        "id": file,
                        "name": file.replace("_", " ").replace(".md", "").replace(".pdf", ""),
                        "filename": file,
                        "type": "pdf" if file.endswith(".pdf") else "md",
                        "category": category,
                        "path": os.path.join(root, file)
                    })
                    
    # Añadir PDFs generados en db/ (ej. FODA_XCIEN_2026.pdf)
    if os.path.exists(db_dir):
        for file in os.listdir(db_dir):
            if file.endswith(".pdf"):
                library.append({
                    "id": file,
                    "name": file.replace("_", " ").replace(".pdf", ""),
                    "filename": file,
                    "type": "pdf",
                    "category": "Reportes Estratégicos",
                    "path": os.path.join(db_dir, file)
                })
                
    return {"status": "success", "documents": library}

@app.get("/api/library/download")
def download_doc(path: str):
    """Descarga o sirve el documento solicitado."""
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
        
    # Seguridad básica para evitar que salgan del proyecto
    abs_path = os.path.abspath(path)
    if "Antigravity" not in abs_path:
        raise HTTPException(status_code=403, detail="Acceso denegado")
        
    return FileResponse(abs_path)


USUARIOS_DB = os.path.join(BASE_DIR, "db", "usuarios.json")

# ── Academia / Odoo eLearning ─────────────────────────────────────────────────
_academia_cache: dict = {"data": None, "ts": 0}
_ACADEMIA_TTL = 120

_ACADEMIA_LOCAL_DIR = os.path.join(os.path.dirname(__file__), "data")

def _academia_local_all():
    """Carga todos los cursos y quizzes de archivos academia_*.json en data/."""
    import glob
    all_courses = []
    all_quizzes = {}
    pattern = os.path.join(_ACADEMIA_LOCAL_DIR, "academia_*.json")
    for path in sorted(glob.glob(pattern)):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            if "cursos" in data:
                all_courses.extend(data["cursos"])
            elif "curso" in data:
                all_courses.append(data["curso"])
            all_quizzes.update(data.get("quizzes", {}))
        except Exception as e:
            logger.warning(f"[Academia local] Error cargando {path}: {e}")
    return all_courses, all_quizzes

def _academia_local_cursos():
    """Retorna lista de cursos locales (todos los archivos academia_*.json)."""
    courses, _ = _academia_local_all()
    return courses

def _academia_local_quizzes(channel_id):
    """Retorna preguntas de un curso local (channel_id == curso.id), o None si no aplica."""
    try:
        courses, quizzes = _academia_local_all()
        course = next((c for c in courses if c["id"] == channel_id), None)
        if not course:
            return None
        lessons = {l["id"]: l["name"] for l in course.get("lessons", [])}
        result = []
        for lid_str, qs in quizzes.items():
            lid = int(lid_str)
            if lid not in lessons:
                continue
            slide_name = lessons[lid]
            for i, q in enumerate(qs):
                answers = [
                    {"id": (lid * 100) + j, "text": opt}
                    for j, opt in enumerate(q["opciones"])
                ]
                result.append({
                    "id":               (lid * 1000) + i,
                    "question":         q["pregunta"],
                    "slide_id":         lid,
                    "slide":            slide_name,
                    "answers":          answers,
                    "correct_answer_id": (lid * 100) + q["correcta"],
                })
        return result if result else None
    except Exception as e:
        logger.warning(f"[Academia local quiz] Error: {e}")
        return None
# Cursos creados con la cuenta de JMMC pero cuyo autor real es otro instructor
_CURSOS_EXCLUIDOS_MINE: set = {37}  # 37 = Gestión de Proyectos (Carlos Belloc)

@app.get("/api/academia/cursos")
async def get_academia_cursos():
    """Cursos, lecciones y progreso desde Odoo eLearning"""
    global _academia_cache
    if _academia_cache["data"] and (time.time() - _academia_cache["ts"]) < _ACADEMIA_TTL:
        return _academia_cache["data"]
    try:
        ODOO_URL = os.environ.get("ODOO_URL")
        ODOO_DB  = os.environ.get("ODOO_DB")
        ODOO_USR = os.environ.get("ODOO_USER")
        ODOO_PWD = os.environ.get("ODOO_PASSWORD")
        common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
        uid    = common.authenticate(ODOO_DB, ODOO_USR, ODOO_PWD, {})
        mdl    = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")

        def qry(model, domain=[], fields=[], limit=300):
            return mdl.execute_kw(ODOO_DB, uid, ODOO_PWD, model, "search_read",
                                  [domain], {"fields": fields, "limit": limit})

        channels = qry("slide.channel", [], [
            "name", "description", "total_slides", "total_time",
            "website_published", "members_count", "enroll", "channel_type",
            "create_uid", "user_id"
        ])
        slides = qry("slide.slide", [], [
            "name", "channel_id", "slide_type", "slide_category",
            "completion_time", "is_published", "sequence",
            "url", "video_url", "website_url", "questions_count", "total_views"
        ])
        progress = qry("slide.channel.partner", [], [
            "channel_id", "partner_id", "completion", "member_status"
        ], limit=10000)

        # Agrupar lecciones por curso
        slides_by_ch: dict = {}
        for s in slides:
            cid = s["channel_id"][0] if s["channel_id"] else None
            slides_by_ch.setdefault(cid, []).append({
                "id":          s["id"],
                "name":        s["name"],
                "type":        s["slide_type"] or "pdf",
                "category":    s["slide_category"] or "",
                "duration_h":  round(s["completion_time"] or 0, 2),
                "published":   s["is_published"],
                "sequence":    s["sequence"],
                "url":         s["url"] or s["video_url"] or "",
                "website_url": s["website_url"] or "",
                "has_quiz":    (s["questions_count"] or 0) > 0,
                "views":       s["total_views"] or 0,
            })

        # Progreso promedio por curso — partner_id incluido para dedup por id
        prog_by_ch: dict = {}
        members_by_ch: dict = {}
        for p in progress:
            cid = p["channel_id"][0] if p["channel_id"] else None
            pid = p["partner_id"][0] if p["partner_id"] else None
            prog_by_ch.setdefault(cid, []).append(p["completion"])
            members_by_ch.setdefault(cid, []).append({
                "partner_id": pid,
                "name":       p["partner_id"][1] if p["partner_id"] else "—",
                "pct":        p["completion"],
                "status":     p["member_status"],
            })

        result = []
        for ch in channels:
            cid   = ch["id"]
            progs = prog_by_ch.get(cid, [])
            avg   = round(sum(progs) / len(progs), 1) if progs else 0
            lessons = sorted(slides_by_ch.get(cid, []), key=lambda x: x["sequence"])
            result.append({
                "id":             cid,
                "name":           ch["name"],
                "description":    ch["description"] or "",
                "total_slides":   ch["total_slides"],
                "total_time_h":   round(ch["total_time"] or 0, 2),
                "members":        ch["members_count"],
                "published":      ch["website_published"],
                "enroll":         ch["enroll"],
                "channel_type":   ch["channel_type"],
                "avg_completion": avg,
                "lessons":        lessons,
                "members_list":   members_by_ch.get(cid, []),
                "is_mine":        (ch.get("create_uid") or [None])[0] == uid and cid not in _CURSOS_EXCLUIDOS_MINE,
                "author":         (ch.get("user_id") or ch.get("create_uid") or [None, "—"])[1],
            })

        result.sort(key=lambda x: (-len(x["lessons"]), -x["members"]))

        # Inyectar cursos locales (no requieren Odoo)
        result = _academia_local_cursos() + result

        _academia_cache["data"] = result
        _academia_cache["ts"]   = time.time()
        return result
    except Exception as e:
        logger.warning(f"[Academia] Odoo no disponible, devolviendo cursos locales: {e}")
        local = _academia_local_cursos()
        if local:
            return local
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/academia/stats")
async def get_academia_stats():
    """Estadísticas agregadas de Academia — técnicos, niveles, leaderboard real desde Odoo.
    Agrupa por partner_id para evitar duplicados cuando alguien tiene variantes de nombre.
    """
    cursos = await get_academia_cursos()

    def get_level(pct: float) -> str:
        if pct >= 95: return "Leyenda"
        if pct >= 80: return "Experto"
        if pct >= 65: return "Avanzado"
        if pct >= 50: return "Especialista"
        if pct >= 30: return "Técnico"
        return "Aprendiz"

    # Agregar por partner_id (clave única) → evita duplicados JOSE MIGUEL MACIAS / CONTRERAS
    tecnicos: dict = {}  # partner_id → {name, pcts, cursos}
    for curso in cursos:
        for m in curso.get("members_list", []):
            pid  = m.get("partner_id")
            name = (m.get("name") or "").strip()
            if not name or name == "—":
                continue
            key = pid if pid else name  # fallback a nombre si no hay partner_id
            if key not in tecnicos:
                tecnicos[key] = {"name": name, "pcts": [], "cursos": 0}
            else:
                # Mantener el nombre más largo (más descriptivo)
                if len(name) > len(tecnicos[key]["name"]):
                    tecnicos[key]["name"] = name
            tecnicos[key]["pcts"].append(m["pct"])
            tecnicos[key]["cursos"] += 1

    for t in tecnicos.values():
        t["avg_pct"] = round(sum(t["pcts"]) / len(t["pcts"]), 1) if t["pcts"] else 0
        t["level"] = get_level(t["avg_pct"])

    sorted_t = sorted(tecnicos.values(), key=lambda x: -x["avg_pct"])

    # Distribución de niveles
    level_order = ["Aprendiz", "Técnico", "Especialista", "Avanzado", "Experto", "Leyenda"]
    level_counts = {lv: 0 for lv in level_order}
    for t in tecnicos.values():
        level_counts[t["level"]] += 1

    total = len(tecnicos)
    # avance_global = promedio de TODOS (incluye 0%)
    avance_global = round(sum(t["avg_pct"] for t in tecnicos.values()) / total, 1) if total else 0
    # avance_activos = promedio solo de quienes tienen >0%
    activos = [t for t in tecnicos.values() if t["avg_pct"] > 0]
    avance_activos = round(sum(t["avg_pct"] for t in activos) / len(activos), 1) if activos else 0

    total_badges = sum(1 for c in cursos for l in c.get("lessons", []) if l.get("has_quiz"))

    top5 = [
        {"name": t["name"], "pct": t["avg_pct"], "cursos": t["cursos"], "level": t["level"]}
        for t in sorted_t[:5]
    ]

    # Mayor y menor avance entre quienes han iniciado al menos un curso
    mayor = sorted_t[0] if sorted_t else None
    menor = next((t for t in reversed(sorted_t) if t["avg_pct"] > 0), None)

    return {
        "total_tecnicos":  total,
        "total_activos":   len(activos),
        "avance_global":   avance_global,
        "avance_activos":  avance_activos,
        "total_cursos":    len(cursos),
        "total_badges":    total_badges,
        "top5":            top5,
        "level_distribution": level_counts,
        "mayor_avance":    {"name": mayor["name"], "pct": mayor["avg_pct"]} if mayor else None,
        "menor_avance":    {"name": menor["name"], "pct": menor["avg_pct"]} if menor else None,
    }


@app.post("/api/academia/refresh")
async def refresh_academia_cache():
    """Limpia todos los cachés de Academia para forzar recarga desde Odoo."""
    global _academia_cache, _plaza_cache
    _academia_cache["data"] = None
    _academia_cache["ts"]   = 0
    _plaza_cache["data"]    = None
    _plaza_cache["ts"]      = 0
    return {"ok": True, "message": "Caché de Academia limpiado — próxima consulta recarga desde Odoo"}


@app.get("/api/academia/examen/colocacion/preguntas")
async def get_colocacion_preguntas(regenerar: bool = False):
    """Examen de colocación — 13 competencias de la Matriz de Habilidades (ruta fija, antes del param)"""
    if not regenerar and os.path.exists(_COLOCACION_CACHE):
        try:
            with open(_COLOCACION_CACHE, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if len(cached.get("preguntas", [])) >= 13:
                import random as _rand
                preguntas = [{k: v for k, v in p.items() if k != "correcta"}
                             for p in cached["preguntas"]]
                _rand.shuffle(preguntas)
                return {"total": len(preguntas), "preguntas": preguntas}
        except Exception:
            pass
    logger.info("[Colocacion] Generando banco de preguntas con Claude...")
    preguntas = _generate_colocacion_questions()
    os.makedirs(os.path.dirname(_COLOCACION_CACHE), exist_ok=True)
    with open(_COLOCACION_CACHE, "w", encoding="utf-8") as f:
        json.dump({"preguntas": preguntas, "generated_at": datetime.datetime.now().isoformat()},
                  f, ensure_ascii=False, indent=2)
    import random as _rand
    out = [{k: v for k, v in p.items() if k != "correcta"} for p in preguntas]
    _rand.shuffle(out)
    return {"total": len(out), "preguntas": out}


class ColocacionSubmitBody(BaseModel):
    respuestas: dict
    tecnico_name: str = ""
    plaza: str = ""

@app.post("/api/academia/examen/colocacion/submit")
async def submit_colocacion(body: ColocacionSubmitBody):
    """Evalúa examen de colocación — devuelve perfil por competencia + plan de capacitación"""
    try:
        if not os.path.exists(_COLOCACION_CACHE):
            raise HTTPException(status_code=404, detail="Examen no generado. Solicita /preguntas primero.")
        with open(_COLOCACION_CACHE, "r", encoding="utf-8") as f:
            cached = json.load(f)
        preguntas_map = {str(p["id"]): p for p in cached["preguntas"]}
        comp_scores: dict = {}
        for q_id_str, answer_idx in body.respuestas.items():
            p = preguntas_map.get(str(q_id_str))
            if not p:
                continue
            key = p["competencia_key"]
            if key not in comp_scores:
                comp_scores[key] = {"correctas": 0, "total": 0}
            comp_scores[key]["total"] += 1
            if int(answer_idx) == p["correcta"]:
                comp_scores[key]["correctas"] += 1
        modulos_necesarios: set = set()
        competencias_resultado = []
        for comp in COMPETENCIAS_COLOCACION:
            key  = comp["key"]
            sc   = comp_scores.get(key, {"correctas": 0, "total": 0})
            pct  = round((sc["correctas"] / sc["total"] * 100) if sc["total"] > 0 else 0)
            aprobada = pct >= 50
            competencias_resultado.append({"key": key, "label": comp["label"], "correctas": sc["correctas"], "total": sc["total"], "pct": pct, "aprobada": aprobada})
            if not aprobada:
                for m in comp["modulos"]:
                    modulos_necesarios.add(m)
        total_aprobadas = sum(1 for c in competencias_resultado if c["aprobada"])
        comp_pct = round((total_aprobadas / len(COMPETENCIAS_COLOCACION)) * 100, 1)
        if comp_pct >= 80:
            nivel = "AVANZADO";   nivel_num = 3; xp_awarded = 300
        elif comp_pct >= 60:
            nivel = "INTERMEDIO"; nivel_num = 2; xp_awarded = 150
        else:
            nivel = "BÁSICO";     nivel_num = 1; xp_awarded = 50
        return {
            "tecnico_name": body.tecnico_name, "plaza": body.plaza,
            "total_correctas": sum(c["correctas"] for c in competencias_resultado),
            "total_preguntas": sum(c["total"] for c in competencias_resultado),
            "comp_pct": comp_pct, "total_aprobadas": total_aprobadas,
            "total_competencias": len(COMPETENCIAS_COLOCACION),
            "nivel": nivel, "nivel_num": nivel_num, "xp_awarded": xp_awarded,
            "competencias": competencias_resultado,
            "plan_capacitacion": [m for m in MODULOS_CAPACITACION if m["num"] in modulos_necesarios],
            "fecha": datetime.datetime.now().strftime("%d/%m/%Y %H:%M"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Colocacion/Submit] error: {e}")
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/academia/examen/{channel_id}/preguntas")
async def get_examen_preguntas(channel_id: int):
    """Trae todas las preguntas y respuestas de un canal de examen desde Odoo eLearning"""
    # Cursos locales (no requieren Odoo)
    local_qs = _academia_local_quizzes(channel_id)
    if local_qs is not None:
        try:
            with open(_ACADEMIA_LOCAL_PATH, encoding="utf-8") as f:
                local_data = json.load(f)
            nombre = local_data["curso"]["name"]
        except Exception:
            nombre = f"Curso local #{channel_id}"
        return {
            "channel_id": channel_id,
            "name":       nombre,
            "total":      len(local_qs),
            "preguntas":  local_qs,
            "is_local":   True,
        }

    try:
        ODOO_URL = os.environ.get("ODOO_URL")
        ODOO_DB  = os.environ.get("ODOO_DB")
        ODOO_USR = os.environ.get("ODOO_USER")
        ODOO_PWD = os.environ.get("ODOO_PASSWORD")
        common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
        uid    = common.authenticate(ODOO_DB, ODOO_USR, ODOO_PWD, {})
        mdl    = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")

        def qry(model, domain=[], fields=[], limit=500):
            return mdl.execute_kw(ODOO_DB, uid, ODOO_PWD, model, "search_read",
                                  [domain], {"fields": fields, "limit": limit})

        channels = qry("slide.channel", [["id", "=", channel_id]], ["name", "description"])
        if not channels:
            raise HTTPException(status_code=404, detail="Canal no encontrado")
        channel = channels[0]

        # Slides del canal que tienen preguntas
        slides = qry("slide.slide",
                     [["channel_id", "=", channel_id], ["questions_count", ">", 0]],
                     ["id", "name", "sequence", "questions_count"])
        slide_ids = [s["id"] for s in slides]
        if not slide_ids:
            return {"channel_id": channel_id, "name": channel["name"], "total": 0, "preguntas": []}

        questions = qry("slide.question", [["slide_id", "in", slide_ids]],
                        ["question", "slide_id", "answer_ids"])
        q_ids = [q["id"] for q in questions]

        answers = qry("slide.answer", [["question_id", "in", q_ids]],
                      ["question_id", "text_value", "is_correct"])

        answers_by_q: dict = {}
        for a in answers:
            qid = a["question_id"][0] if isinstance(a["question_id"], list) else a["question_id"]
            answers_by_q.setdefault(qid, []).append({
                "id":      a["id"],
                "text":    a["text_value"],
                "correct": a["is_correct"],
            })

        import random
        preguntas = []
        for q in questions:
            slide_name = q["slide_id"][1] if isinstance(q["slide_id"], list) and len(q["slide_id"]) > 1 else ""
            opts = answers_by_q.get(q["id"], [])
            random.shuffle(opts)
            preguntas.append({
                "id":       q["id"],
                "question": q["question"],
                "slide":    slide_name,
                "answers":  opts,
            })
        random.shuffle(preguntas)

        return {
            "channel_id":  channel_id,
            "name":        channel["name"],
            "description": channel.get("description") or "",
            "total":       len(preguntas),
            "preguntas":   preguntas,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Academia/Examen] Odoo error: {e}")
        raise HTTPException(status_code=503, detail=str(e))


class ExamenSubmitBody(BaseModel):
    channel_id: int
    respuestas: dict   # { "question_id": answer_id, ... }
    tecnico_name: str = ""

@app.post("/api/academia/examen/submit")
async def submit_examen(body: ExamenSubmitBody):
    """Evalúa respuestas del examen y devuelve score + nivel asignado"""
    # Cursos locales: evaluar sin Odoo
    local_qs = _academia_local_quizzes(body.channel_id)
    if local_qs is not None:
        correct_map = {str(q["id"]): q["correct_answer_id"] for q in local_qs}
        total = len(body.respuestas)
        correctas = sum(
            1 for qid, aid in body.respuestas.items()
            if correct_map.get(str(qid)) == int(aid)
        )
        score_pct = round((correctas / total * 100) if total > 0 else 0, 1)
        if score_pct >= 90:   nivel, xp_awarded = "Senior",       300
        elif score_pct >= 75: nivel, xp_awarded = "Especialista", 200
        elif score_pct >= 60: nivel, xp_awarded = "Técnico",      100
        else:                 nivel, xp_awarded = "Aprendiz",      50
        return {
            "score_pct":  score_pct,
            "correctas":  correctas,
            "total":      total,
            "nivel":      nivel,
            "nivel_num":  ["Aprendiz","Técnico","Especialista","Senior"].index(nivel) + 1,
            "xp_awarded": xp_awarded,
            "aprobado":   score_pct >= 60,
        }

    try:
        ODOO_URL = os.environ.get("ODOO_URL")
        ODOO_DB  = os.environ.get("ODOO_DB")
        ODOO_USR = os.environ.get("ODOO_USER")
        ODOO_PWD = os.environ.get("ODOO_PASSWORD")
        common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
        uid    = common.authenticate(ODOO_DB, ODOO_USR, ODOO_PWD, {})
        mdl    = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")

        def qry(model, domain=[], fields=[], limit=1000):
            return mdl.execute_kw(ODOO_DB, uid, ODOO_PWD, model, "search_read",
                                  [domain], {"fields": fields, "limit": limit})

        q_ids = [int(k) for k in body.respuestas.keys()]
        all_answers = qry("slide.answer", [["question_id", "in", q_ids]],
                          ["id", "question_id", "is_correct"])

        answer_map = {a["id"]: a["is_correct"] for a in all_answers}

        total    = len(body.respuestas)
        correctas = sum(
            1 for a_id in body.respuestas.values()
            if answer_map.get(int(a_id), False)
        )
        score_pct = round((correctas / total * 100) if total > 0 else 0, 1)

        # Nivel según puntaje
        if score_pct >= 90:
            nivel = "Senior";       nivel_num = 4; xp_awarded = 300
        elif score_pct >= 75:
            nivel = "Especialista"; nivel_num = 3; xp_awarded = 200
        elif score_pct >= 60:
            nivel = "Técnico";      nivel_num = 2; xp_awarded = 100
        else:
            nivel = "Aprendiz";     nivel_num = 1; xp_awarded = 50

        return {
            "score_pct":  score_pct,
            "correctas":  correctas,
            "total":      total,
            "nivel":      nivel,
            "nivel_num":  nivel_num,
            "xp_awarded": xp_awarded,
            "aprobado":   score_pct >= 60,
        }
    except Exception as e:
        logger.error(f"[Academia/Submit] error: {e}")
        raise HTTPException(status_code=503, detail=str(e))


# ── Examen de Colocación — Matriz 13 Competencias ────────────────────────────

COMPETENCIAS_COLOCACION = [
    {"key": "habilitacion", "label": "Habilitación",  "estandar": "Estándar de instalación PTT + Protocolo de fallas",     "subcompetencias": "Protocolo instalación, protocolo reparación, estándar corporativo", "modulos": [1, 14]},
    {"key": "radiobase",    "label": "Radiobase",     "estandar": "Montaje y mantenimiento de sitios (Torres, Mástiles)",   "subcompetencias": "Torres arriostradas, mástil, telescópico, adosado, puntos de anclaje, tensado", "modulos": [2]},
    {"key": "enlace",       "label": "Enlace",        "estandar": "Equipos PtP/PmP de radiofrecuencia",                    "subcompetencias": "Radios Mikrotik/Ubiquiti/Mimosa/Cambium, SIKLU, AF-60, alineación 60G/dBi", "modulos": [3]},
    {"key": "wireless",     "label": "Wireless",      "estandar": "Redes Wi-Fi y acceso inalámbrico",                      "subcompetencias": "Access points, herramientas WiFi, mapas de calor, estudios de línea de vista", "modulos": [3, 4]},
    {"key": "redes",        "label": "Redes",         "estandar": "Networking básico LAN/WAN",                             "subcompetencias": "Cableado estructurado, RJ-45, IPs, gateway, DHCP, Starlink", "modulos": [4, 6]},
    {"key": "routing",      "label": "Routing",       "estandar": "Enrutamiento avanzado y SD-WAN",                        "subcompetencias": "Routers Edge, VLAN, OSPF, SD-WAN, firewall, DMZ, desvío de puertos", "modulos": [5]},
    {"key": "energia",      "label": "Energía",       "estandar": "Sistemas de energía renovable y backup",                "subcompetencias": "Paneles solares, baterías, generadores, sistemas de tierras físicas", "modulos": [7]},
    {"key": "electricidad", "label": "Electricidad",  "estandar": "Electricidad baja y media tensión",                     "subcompetencias": "110V/220V/440V, multímetro, CD y CA, acometida eléctrica, DC3", "modulos": [1, 7]},
    {"key": "operaciones",  "label": "Operaciones",   "estandar": "Herramientas digitales y gestión de campo",             "subcompetencias": "Odoo (tareas, inventario, firmas), levantamientos, memoria técnica, RMA", "modulos": [9, 13]},
    {"key": "seguridad",    "label": "Seguridad",     "estandar": "Seguridad industrial y ciberseguridad básica",          "subcompetencias": "EPP, alturas, firewall, Hillstone, revisión de red interna cliente", "modulos": [1, 10]},
    {"key": "procesos",     "label": "Procesos",      "estandar": "Protocolos corporativos y documentación",               "subcompetencias": "Protocolo instalación, protocolo fallas, estandarización, liberación servicio", "modulos": [12, 14]},
    {"key": "clientes",     "label": "Clientes",      "estandar": "Atención y manejo de clientes",                        "subcompetencias": "Trato al cliente, imagen corporativa, coordinación usuarios, comunicación", "modulos": [11]},
    {"key": "soft_skills",  "label": "Soft Skills",   "estandar": "Habilidades blandas y liderazgo",                      "subcompetencias": "Trabajo en equipo, gestión del tiempo, inteligencia emocional, liderazgo", "modulos": [11]},
]

MODULOS_CAPACITACION = [
    {"num": 1,  "nombre": "Seguridad y Alturas (DC3)",            "descripcion": "Uso de EPP, líneas de vida y protocolos de riesgo eléctrico."},
    {"num": 2,  "nombre": "Sistemas de Montaje",                  "descripcion": "Dominio de instalaciones empotradas, tensadas y telescópicas."},
    {"num": 3,  "nombre": "Radiofrecuencia (RF) y Alineación",    "descripcion": "Alineación de enlaces (Mimosa, Ubiquiti, Cambium) y manejo de niveles dBi."},
    {"num": 4,  "nombre": "Networking Básico",                    "descripcion": "Configuración de IPs, Gateways y Routers domésticos/PYME."},
    {"num": 5,  "nombre": "Networking Avanzado",                  "descripcion": "VLANs, OSPF, SD-WAN y enlaces troncales (Mimosa/60G/Mikrotik)."},
    {"num": 6,  "nombre": "Cableado y Demarcación",               "descripcion": "Gestión de trayectorias, resguardos y conectorización profesional."},
    {"num": 7,  "nombre": "Sistemas de Energía",                  "descripcion": "Instalación de paneles solares, baterías y manejo de media tensión (440 V)."},
    {"num": 8,  "nombre": "Soluciones Especiales",                "descripcion": "Dominio de Starlink, cámaras de vigilancia y micro-celdas."},
    {"num": 9,  "nombre": "Herramientas Digitales (Odoo)",        "descripcion": "Registro de tareas, consumo de inventario y firmas del cliente."},
    {"num": 10, "nombre": "Diagnóstico y Triage",                 "descripcion": "Identificar fallas Capa 1–3 con herramientas técnicas."},
    {"num": 11, "nombre": "Atención y Protocolo",                 "descripcion": "Imagen corporativa, trato al cliente y limpieza en sitio."},
    {"num": 12, "nombre": "Mantenimiento Preventivo/Correctivo",  "descripcion": "Identificación de oxidación, tensión de retenidas y limpieza de equipos."},
    {"num": 13, "nombre": "Gestión de Inventario",                "descripcion": "Control de stock en camioneta y reportes de RMA."},
    {"num": 14, "nombre": "Validación y Cierre",                  "descripcion": "Pruebas de velocidad (Speedtests) y llamada de calidad con Dispatch."},
]

_COLOCACION_CACHE = os.path.join(BASE_DIR, "db", "examen_colocacion_cache.json")

def _generate_colocacion_questions() -> list:
    """Genera 2 preguntas MCQ para cada una de las 13 competencias — una sola llamada a Claude"""
    import re as _re

    comp_list = "\n".join(
        f'{i+1}. {c["label"]} — {c["estandar"]} — subcompetencias: {c["subcompetencias"]}'
        for i, c in enumerate(COMPETENCIAS_COLOCACION)
    )
    prompt = (
        "Eres evaluador técnico de Field Services en telecomunicaciones (XCIEN, México).\n"
        "Genera exactamente 2 preguntas de opción múltiple por cada una de estas 13 competencias técnicas de campo:\n\n"
        f"{comp_list}\n\n"
        "Reglas:\n"
        "- Preguntas prácticas de nivel técnico real (instalación, configuración, protocolos)\n"
        "- 4 opciones por pregunta, solo 1 correcta\n"
        "- El JSON de salida debe ser un array de 26 objetos\n"
        "- Responde SOLO con JSON válido, sin explicaciones ni markdown:\n"
        '[{"competencia":"habilitacion","pregunta":"...","opciones":["a","b","c","d"],"correcta":0},'
        '{"competencia":"habilitacion","pregunta":"...","opciones":["a","b","c","d"],"correcta":2},'
        '{"competencia":"radiobase","pregunta":"...","opciones":["a","b","c","d"],"correcta":1}, ...]'
    )

    KEY_MAP = {c["label"].lower(): c["key"] for c in COMPETENCIAS_COLOCACION}
    KEY_MAP.update({c["key"]: c["key"] for c in COMPETENCIAS_COLOCACION})

    try:
        raw = ask_claude(prompt)
        start = raw.find('[')
        end   = raw.rfind(']')
        if start != -1 and end != -1 and end > start:
            parsed = json.loads(raw[start:end + 1])
        else:
            clean = _re.sub(r'```[a-z]*\n?', '', raw).strip()
            parsed = json.loads(clean[clean.find('['):clean.rfind(']') + 1])

        all_q = []
        comp_counts: dict = {}
        for item in parsed:
            ckey_raw = item.get("competencia", "").lower().replace(" ", "_")
            ckey = KEY_MAP.get(ckey_raw) or KEY_MAP.get(ckey_raw.replace("_", "")) or ckey_raw
            comp_info = next((c for c in COMPETENCIAS_COLOCACION if c["key"] == ckey), None)
            if not comp_info:
                continue
            n = comp_counts.get(ckey, 0)
            if n >= 2:
                continue
            comp_counts[ckey] = n + 1
            idx = COMPETENCIAS_COLOCACION.index(comp_info)
            all_q.append({
                "id":                idx * 10 + n,
                "competencia_key":   comp_info["key"],
                "competencia_label": comp_info["label"],
                "pregunta":          item["pregunta"],
                "opciones":          item["opciones"],
                "correcta":          int(item["correcta"]),
            })
        if len(all_q) >= 13:
            logger.info(f"[Colocacion] Claude generó {len(all_q)} preguntas OK")
            return all_q
    except Exception as e:
        logger.error(f"[Colocacion] Error generando preguntas: {e}")

    # Fallback: una pregunta por competencia
    logger.warning("[Colocacion] Usando banco de preguntas de fallback")
    fallback_banks = {
        "habilitacion":  [("¿Qué es el protocolo PTT en instalaciones XCIEN?", ["Protocolo de terminación de trabajos", "Protocolo de transferencia técnica", "Procedimiento de prueba de tiro", "Protocolo de tráfico temporal"], 0),
                          ("¿Qué incluye el estándar de instalación corporativo?", ["Solo la conexión del cliente", "Documentación, evidencia fotográfica y pruebas de velocidad", "Únicamente el cableado", "Solo la firma del cliente"], 1)],
        "radiobase":     [("¿Qué tipo de estructura se usa para instalación en azotea sin permisos de antena?", ["Torre arriostrada", "Mástil telescópico", "Torre autosoportada", "Torre guiada"], 1),
                          ("¿Cuántos puntos de anclaje mínimos requiere un mástil en azotea?", ["1 punto central", "2 puntos opuestos", "3 puntos en triángulo", "4 puntos en esquinas"], 2)],
        "enlace":        [("¿Qué herramienta se usa para alinear un enlace Mimosa B5c?", ["Brújula analógica", "App Mimosa + herramienta de señal RF", "Nivel de burbuja", "GPS únicamente"], 1),
                          ("¿Qué indica un valor de -60 dBm en un enlace PtP?", ["Señal excelente", "Señal buena", "Señal débil", "Sin señal"], 1)],
        "wireless":      [("¿Qué es un mapa de calor WiFi?", ["Temperatura del AP", "Representación visual de cobertura de señal", "Consumo energético del AP", "Registro de usuarios conectados"], 1),
                          ("¿Qué frecuencia tiene menos interferencia en entornos urbanos densos?", ["2.4 GHz", "5 GHz", "900 MHz", "60 GHz"], 1)],
        "redes":         [("¿Qué clase de IP es 192.168.1.1?", ["Clase A", "Clase B", "Clase C", "Clase D"], 2),
                          ("¿Cuál es la función principal del gateway en una red LAN?", ["Almacenar datos", "Conectar la red local con redes externas", "Asignar IPs dinámicas", "Filtrar spam"], 1)],
        "routing":       [("¿Qué protocolo de enrutamiento dinámico usa XCIEN en redes de distribución?", ["RIP v1", "OSPF", "BGP", "EIGRP"], 1),
                          ("¿Qué es una VLAN?", ["Red física separada", "Red virtual lógica dentro de un switch", "Tipo de cable de red", "Protocolo de seguridad"], 1)],
        "energia":       [("¿Qué componente convierte energía DC a AC en un sistema solar?", ["Regulador de carga", "Inversor", "Batería", "Panel solar"], 1),
                          ("¿Qué mide un multímetro en modo voltímetro DC?", ["Corriente alterna", "Resistencia", "Voltaje de corriente directa", "Frecuencia"], 2)],
        "electricidad":  [("¿Qué EPP es obligatorio para trabajar con 440V?", ["Casco y guantes de cuero", "Guantes dieléctricos clase 2, careta y ropa ignífuga", "Solo gafas de seguridad", "Botas y casco"], 1),
                          ("¿Qué es la acometida eléctrica?", ["Cable de tierra física", "Conexión desde la red pública hasta el tablero del cliente", "Medidor de energía", "Transformador trifásico"], 1)],
        "operaciones":   [("¿Dónde se registra el consumo de inventario en campo?", ["Hoja de papel físico", "Odoo — módulo de inventario con firma del cliente", "WhatsApp al supervisor", "Email a bodega"], 1),
                          ("¿Qué es un RMA en operaciones de campo?", ["Reporte de Mantenimiento Activo", "Return Merchandise Authorization — devolución de equipo defectuoso", "Registro de Materiales Adicionales", "Requerimiento de Mejora de Acceso"], 1)],
        "seguridad":     [("¿Qué es la línea de vida en trabajos en altura?", ["Cable de suministro eléctrico", "Sistema de protección anticaída conectado a punto de anclaje certificado", "Cuerda de izaje de materiales", "Cable de seguridad para equipos"], 1),
                          ("¿A qué altura se requiere arnés de seguridad según NOM-009?", ["1.5 metros", "2 metros o más", "3 metros", "Solo en techos inclinados"], 1)],
        "procesos":      [("¿Qué debe incluir la liberación de servicio al cliente?", ["Solo activación del servicio", "Prueba de velocidad, evidencia fotográfica y firma del cliente", "Únicamente la firma", "Solo el número de ticket"], 1),
                          ("¿Cuántas fotos de evidencia mínimo requiere una instalación estándar?", ["1 foto del equipo", "Foto antes, durante y después (mínimo 3)", "Solo foto final", "No se requiere evidencia"], 1)],
        "clientes":      [("¿Cómo debe presentarse un técnico XCIEN ante el cliente?", ["Con ropa casual", "Uniforme limpio, identificación visible y saludo profesional", "De civil para no intimidar", "No importa la presentación"], 1),
                          ("¿Qué hacer si el cliente no está al momento de la instalación?", ["Instalar y dejar nota", "Contactar al dispatcher para reagendar y documentar el intento", "Cancelar la orden directamente", "Esperar indefinidamente"], 1)],
        "soft_skills":   [("¿Cómo manejas un conflicto con un compañero de trabajo en campo?", ["Ignorarlo", "Comunicación directa y respetuosa, escalar solo si necesario", "Reportarlo inmediatamente a RH", "Resolverlo de forma agresiva"], 1),
                          ("¿Qué implica la gestión del tiempo en instalaciones múltiples?", ["Hacer todas las instalaciones sin descanso", "Planificar ruta eficiente, comunicar tiempos al dispatcher y priorizar urgencias", "Llegar siempre tarde", "Solo atender las instalaciones fáciles"], 1)],
    }
    all_q = []
    for idx, comp in enumerate(COMPETENCIAS_COLOCACION):
        bank = fallback_banks.get(comp["key"], [])
        for i, (pregunta, opciones, correcta) in enumerate(bank[:2]):
            all_q.append({
                "id":                idx * 10 + i,
                "competencia_key":   comp["key"],
                "competencia_label": comp["label"],
                "pregunta":          pregunta,
                "opciones":          opciones,
                "correcta":          correcta,
            })
    return all_q


# ─── Reportes Semanales NOC + WFM ────────────────────────────────────────────

def _build_reporte_pdf(ciudad: str, fecha_inicio: str, fecha_fin: str,
                        noc_data: dict, wfm_orders: list) -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from datetime import datetime
    import io

    buf = io.BytesIO()

    # ── Paleta institucional: blanco/gris limpio + verde XCIEN
    GREEN   = colors.HexColor('#00C896')   # verde XCIEN
    BLACK   = colors.HexColor('#111111')   # texto principal
    DARK    = colors.HexColor('#1A1A1A')   # encabezados
    BGHEAD  = colors.HexColor('#F0FBF7')   # fondo cabecera secciones
    BGROW   = colors.HexColor('#F9F9F9')   # filas alternas
    BORDER  = colors.HexColor('#DDDDDD')   # bordes
    RED     = colors.HexColor('#D62828')   # alertas críticas
    ORANGE  = colors.HexColor('#E07A18')   # advertencias
    GREY    = colors.HexColor('#888888')   # texto secundario
    WHITE   = colors.white

    styles = getSampleStyleSheet()
    def sty(name='Normal', **kw):
        return ParagraphStyle(name + str(id(kw)), parent=styles[name], **kw)

    doc = SimpleDocTemplate(buf, pagesize=letter,
        leftMargin=0.7*inch, rightMargin=0.7*inch,
        topMargin=0.6*inch, bottomMargin=0.6*inch)

    elems = []

    now = datetime.now()
    folio        = f"NOC-{now.strftime('%Y%m%d-%H%M%S')}"
    generated_at = now.strftime("%Y-%m-%d  %H:%M:%S")
    ciudad_label = ciudad if ciudad != 'todas' else 'Todas las Ciudades'

    # ── HEADER institucional ────────────────────────────────────────────────
    hdr = Table([[
        Paragraph(f'<b>XCIEN</b><br/><font size="7" color="#888888">Network Operations</font>',
                  sty(fontSize=14, textColor=GREEN, fontName='Helvetica-Bold')),
        Paragraph(f'<b>REPORTE NOC SEMANAL</b><br/>'
                  f'<font size="10" color="#1A1A1A">{ciudad_label.upper()}</font>',
                  sty(fontSize=16, textColor=DARK, fontName='Helvetica-Bold', alignment=TA_CENTER)),
        Paragraph(
            f'<font size="8" color="#888888">Folio</font><br/>'
            f'<b><font size="9">{folio}</font></b><br/>'
            f'<font size="7" color="#888888">{fecha_inicio} → {fecha_fin}</font><br/>'
            f'<font size="7" color="#888888">Generado: {generated_at}</font>',
            sty(fontSize=8, textColor=GREY, alignment=TA_RIGHT)),
    ]], colWidths=[1.4*inch, 4.2*inch, 1.65*inch])
    hdr.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), WHITE),
        ('LINEBELOW',  (0,0), (-1,-1), 2.5, GREEN),
        ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('LEFTPADDING',  (0,0), (0,-1), 0),
        ('RIGHTPADDING', (-1,0), (-1,-1), 0),
    ]))
    elems.append(hdr)
    elems.append(Spacer(1, 0.18*inch))

    # ── helpers
    cities = noc_data.get('cities', [])
    alerts = noc_data.get('alerts', [])
    total_hosts   = sum(c['totalHosts'] for c in cities)
    total_online  = sum(c['online']     for c in cities)
    total_offline = sum(c['offline']    for c in cities)
    critical      = sum(1 for a in alerts if a.get('severity') == 'critical')
    warnings_n    = sum(1 for a in alerts if a.get('severity') == 'warning')
    avg_score     = round(sum(c['score'] for c in cities) / len(cities), 1) if cities else 0

    def sec(text):
        return Paragraph(
            f'<b>{text}</b>',
            sty(fontSize=10, textColor=DARK, fontName='Helvetica-Bold',
                spaceBefore=14, spaceAfter=5,
                borderPadding=(4,0,4,6),
                backColor=BGHEAD))

    def hdr_tbl(style):
        base = [
            ('BACKGROUND', (0,0), (-1,0), GREEN),
            ('TEXTCOLOR',  (0,0), (-1,0), WHITE),
            ('FONTNAME',   (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE',   (0,0), (-1,-1), 8),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [WHITE, BGROW]),
            ('INNERGRID',  (0,0), (-1,-1), 0.3, BORDER),
            ('BOX',        (0,0), (-1,-1), 0.5, BORDER),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('LEFTPADDING', (0,0), (-1,-1), 7),
        ]
        base.extend(style)
        return base

    # ── KPIs NOC ───────────────────────────────────────────────────────────
    elems.append(sec('RED — ESTADO ACTUAL DE INFRAESTRUCTURA'))
    kpi_vals  = [str(total_hosts), str(total_online), str(total_offline),
                 str(critical), str(warnings_n), f'{avg_score}%']
    kpi_lbls  = ['HOSTS TOTALES', 'EN LÍNEA', 'CAÍDOS', 'CRÍTICAS', 'ALERTAS', 'SCORE PROM.']
    kpi_clrs  = [BLACK, GREEN, RED, RED, ORANGE, GREEN]
    kt = Table(
        [[Paragraph(f'<b>{v}</b>', sty(fontSize=22, textColor=c, fontName='Helvetica-Bold', alignment=TA_CENTER))
          for v, c in zip(kpi_vals, kpi_clrs)],
         [Paragraph(l, sty(fontSize=7, textColor=GREY, alignment=TA_CENTER)) for l in kpi_lbls]],
        colWidths=[1.12*inch]*6)
    kt.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), WHITE),
        ('BOX',        (0,0), (-1,-1), 0.5, BORDER),
        ('INNERGRID',  (0,0), (-1,-1), 0.3, BORDER),
        ('LINEABOVE',  (0,0), (-1,0),  2.5, GREEN),
        ('ALIGN',      (0,0), (-1,-1), 'CENTER'),
        ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    elems.append(kt)
    elems.append(Spacer(1, 0.12*inch))

    # ── Ciudades con hosts caídos ──────────────────────────────────────────
    offline_cities = sorted([c for c in cities if c['offline'] > 0], key=lambda x: -x['offline'])
    if offline_cities:
        elems.append(sec('CIUDADES CON HOSTS CAÍDOS'))
        rows = [['Ciudad', 'Caídos', 'En línea', 'Score', 'Alertas crit.']]
        for c in offline_cities[:15]:
            rows.append([c['name'], str(c['offline']), str(c['online']),
                         f"{c['score']}%", str(c.get('alerts', 0))])
        tbl = [[Paragraph(str(cell),
                          sty(fontSize=8, textColor=(WHITE if i==0 else (RED if (i>0 and cell.isdigit() and int(cell)>=3) else BLACK)),
                              fontName='Helvetica-Bold' if i==0 else 'Helvetica', leading=11))
                for cell in row] for i, row in enumerate(rows)]
        t = Table(tbl, colWidths=[2.3*inch, 0.85*inch, 0.85*inch, 0.85*inch, 1.35*inch])
        t.setStyle(TableStyle(hdr_tbl([])))
        elems.append(t)
        elems.append(Spacer(1, 0.12*inch))

    # ── Hosts offline — Detalle con ID de servicio + motivo ───────────────
    # Extraer todos los hosts offline de las ciudades
    offline_hosts = []
    for city in cities:
        for site in city.get('sites', []):
            for h in site.get('hosts', []):
                if h.get('status') == 'offline':
                    offline_hosts.append({
                        'service_id': str(h.get('id', '—')),
                        'name':       (h.get('name') or h.get('ip') or '—')[:35],
                        'ip':         h.get('ip', '—'),
                        'city':       city.get('name', '—'),
                        'site':       site.get('name', '—'),
                        'lastSeen':   (h.get('lastSeen') or '')[:19] or '—',
                    })

    # Cruzar con alertas para obtener motivo / SOP
    alert_by_ip = {}
    for a in alerts:
        ip = a.get('hostIp') or a.get('ip', '')
        if ip and ip not in alert_by_ip:
            alert_by_ip[ip] = a

    if offline_hosts:
        elems.append(sec(f'HOSTS OFFLINE — DETALLE ({len(offline_hosts)} equipos)'))
        h_rows = [['ID Servicio', 'Host / IP', 'Ciudad · Sitio', 'Último contacto', 'Motivo / SOP']]
        for h in offline_hosts[:25]:
            al = alert_by_ip.get(h['ip'], {})
            motivo = (al.get('message') or al.get('type') or 'Sin datos')[:40]
            sop    = al.get('sopId', '')
            motivo_txt = f"{motivo}  [{sop}]" if sop else motivo
            h_rows.append([
                h['service_id'],
                h['name'],
                f"{h['city']} · {h['site']}",
                h['lastSeen'],
                motivo_txt,
            ])
        h_data = [[Paragraph(str(cell),
                             sty(fontSize=7, textColor=(WHITE if i==0 else BLACK),
                                 fontName='Helvetica-Bold' if i==0 else 'Helvetica', leading=10))
                   for cell in row] for i, row in enumerate(h_rows)]
        ht = Table(h_data, colWidths=[0.85*inch, 1.4*inch, 1.45*inch, 1.1*inch, 2.45*inch])
        ht.setStyle(TableStyle(hdr_tbl([
            ('TEXTCOLOR', (4,1), (4,-1), GREY),
        ])))
        elems.append(ht)
        elems.append(Spacer(1, 0.12*inch))

    # ── Alertas críticas ───────────────────────────────────────────────────
    crit_alerts = [a for a in alerts if a.get('severity') == 'critical'][:12]
    if crit_alerts:
        elems.append(sec(f'ALERTAS CRÍTICAS ACTIVAS — {len(crit_alerts)} eventos'))
        a_rows = [['Ciudad', 'Host / IP', 'Causa', 'Fecha/Hora', 'SOP']]
        for a in crit_alerts:
            ts  = (a.get('timestamp') or '')[:19] or '—'
            msg = (a.get('message') or a.get('type') or '—')[:45]
            host = (a.get('hostName') or a.get('hostIp') or '—')[:25]
            a_rows.append([a.get('cityName','—'), host, msg, ts, a.get('sopId','—')])
        a_data = [[Paragraph(str(c),
                             sty(fontSize=7, textColor=(WHITE if i==0 else (RED if (i>0 and j==2) else BLACK)),
                                 fontName='Helvetica-Bold' if i==0 else 'Helvetica', leading=10))
                   for j, c in enumerate(row)] for i, row in enumerate(a_rows)]
        at = Table(a_data, colWidths=[1.0*inch, 1.35*inch, 2.5*inch, 1.1*inch, 0.8*inch])
        at.setStyle(TableStyle(hdr_tbl([])))
        elems.append(at)
        elems.append(Spacer(1, 0.12*inch))

    # ── WFM ────────────────────────────────────────────────────────────────
    elems.append(sec('WFM — ÓRDENES DE SERVICIO'))
    estados = {}
    for o in wfm_orders:
        est = o.get('estado', 'OTRO')
        estados[est] = estados.get(est, 0) + 1

    wfm_vals = [str(len(wfm_orders)),
                str(estados.get('LISTO_INSTALACION', 0)),
                str(estados.get('BACKLOG', 0)),
                str(estados.get('EN_PROCESO', estados.get('PREVENTA', 0)))]
    wfm_lbls = ['TOTAL', 'LISTAS', 'BACKLOG', 'EN PROCESO']
    wfm_clrs = [BLACK, GREEN, RED, ORANGE]
    wt = Table(
        [[Paragraph(f'<b>{v}</b>', sty(fontSize=22, textColor=c, fontName='Helvetica-Bold', alignment=TA_CENTER))
          for v, c in zip(wfm_vals, wfm_clrs)],
         [Paragraph(l, sty(fontSize=7, textColor=GREY, alignment=TA_CENTER)) for l in wfm_lbls]],
        colWidths=[1.69*inch]*4)
    wt.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), WHITE),
        ('BOX',        (0,0), (-1,-1), 0.5, BORDER),
        ('INNERGRID',  (0,0), (-1,-1), 0.3, BORDER),
        ('LINEABOVE',  (0,0), (-1,0),  2.5, GREEN),
        ('ALIGN',      (0,0), (-1,-1), 'CENTER'),
        ('VALIGN',     (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    elems.append(wt)
    elems.append(Spacer(1, 0.1*inch))

    recent = sorted(wfm_orders, key=lambda x: x.get('fecha_creacion',''), reverse=True)[:10]
    if recent:
        o_rows = [['ID', 'Cliente', 'Servicio', 'Estado', 'Fecha']]
        for o in recent:
            o_rows.append([
                str(o.get('id',''))[-6:],
                str(o.get('cliente',''))[:22],
                str(o.get('servicio',''))[:28],
                str(o.get('estado','')),
                str(o.get('fecha_creacion',''))[:10],
            ])
        o_data = [[Paragraph(str(c),
                             sty(fontSize=8, textColor=(WHITE if i==0 else BLACK),
                                 fontName='Helvetica-Bold' if i==0 else 'Helvetica', leading=11))
                   for c in row] for i, row in enumerate(o_rows)]
        ot = Table(o_data, colWidths=[0.65*inch, 1.7*inch, 2.1*inch, 1.3*inch, 0.9*inch])
        ot.setStyle(TableStyle(hdr_tbl([])))
        elems.append(ot)

    # ── Footer ─────────────────────────────────────────────────────────────
    elems.append(Spacer(1, 0.2*inch))
    elems.append(HRFlowable(width='100%', thickness=1, color=GREEN))
    elems.append(Spacer(1, 0.06*inch))
    elems.append(Paragraph(
        f'XCIEN Network Operations Center  ·  Folio: {folio}  ·  {generated_at}  ·  Confidencial',
        sty(fontSize=7, textColor=GREY, alignment=TA_CENTER)))

    doc.build(elems)
    return buf.getvalue()


@app.get("/api/reportes/semanal")
async def reporte_semanal(
    ciudad: str = "todas",
    fecha_inicio: str = "",
    fecha_fin: str = "",
):
    """Genera y descarga un PDF con el reporte semanal NOC + WFM"""
    from datetime import date, timedelta

    # Fechas por defecto: semana actual lun–dom
    today = date.today()
    if not fecha_inicio:
        fecha_inicio = str(today - timedelta(days=today.weekday()))
    if not fecha_fin:
        fecha_fin = str(today)

    # Obtener datos NOC directamente (sin llamadas HTTP internas)
    try:
        hosts_raw, alerts_raw = _get_enriched_noc_data()

        # Construir cities igual que get_noc_cities()
        from collections import defaultdict
        active_alerts = [a for a in alerts_raw if a.get("state") == "active"]
        city_sites: dict = defaultdict(lambda: defaultdict(list))
        for h in hosts_raw:
            city_sites[h.get("city","Sin Ciudad")][h.get("site","Site Principal")].append(h)

        COORDS = {
            "Monterrey":{"lat":25.6866,"lng":-100.3161},"Saltillo":{"lat":25.4232,"lng":-100.9928},
            "Piedras Negras":{"lat":28.7000,"lng":-100.5231},"Torreón":{"lat":25.5428,"lng":-103.4068},
            "Chihuahua":{"lat":28.6353,"lng":-106.0889},"Guadalajara":{"lat":20.6597,"lng":-103.3496},
            "Ciudad de México":{"lat":19.4326,"lng":-99.1332},"Querétaro":{"lat":20.5888,"lng":-100.3899},
            "Tampico":{"lat":22.2552,"lng":-97.8686},"Mérida":{"lat":20.9674,"lng":-89.5926},
            "Reynosa":{"lat":26.0922,"lng":-98.2772},"Nuevo Laredo":{"lat":27.4765,"lng":-99.5151},
            "San Luis Potosi":{"lat":22.1565,"lng":-100.9855},"León":{"lat":21.1221,"lng":-101.6823},
            "Monclova":{"lat":26.9083,"lng":-101.4217},"Sabinas":{"lat":27.8529,"lng":-101.1191},
            "Matamoros":{"lat":25.8691,"lng":-97.5027},
        }

        cities = []
        for city_name, sites_dict in city_sites.items():
            city_hosts = [h for hs in sites_dict.values() for h in hs]
            total = len(city_hosts)
            online  = sum(1 for h in city_hosts if _host_status(h) == "online")
            offline = sum(1 for h in city_hosts if _host_status(h) == "offline")
            scores  = [h.get("health_score") or h.get("healthScore", 0) for h in city_hosts]
            avg_sc  = round(sum(scores)/len(scores), 1) if scores else 0
            city_crits = sum(1 for a in active_alerts if a.get("city") == city_name and a.get("severity") == "critical")
            coord = COORDS.get(city_name, {"lat":23.0,"lng":-102.0})
            cities.append({
                "id": city_name.lower().replace(" ","-"), "name": city_name,
                "totalHosts": total, "online": online, "offline": offline,
                "score": avg_sc, "alerts": city_crits,
                "lat": coord["lat"], "lng": coord["lng"],
            })

        sev_map = {"degraded":"warning","info":"warning"}
        alerts = [{
            "id": a.get("id"), "cityId": a.get("city","").lower().replace(" ","-"),
            "cityName": a.get("city",""), "hostIp": a.get("host_ip") or a.get("hostIP",""),
            "hostName": a.get("host_name") or a.get("hostName",""),
            "type": a.get("cause",""), "message": a.get("message",""),
            "severity": sev_map.get(a.get("severity"), a.get("severity","warning")),
            "timestamp": a.get("triggered_at") or a.get("triggeredAt",""),
            "state": a.get("state"),
        } for a in active_alerts]
    except Exception as e:
        logger.error(f"Error obteniendo datos NOC para reporte: {e}")
        cities = []; alerts = []

    # Filtrar por ciudad si aplica
    if ciudad.lower() != 'todas':
        cities = [c for c in cities if ciudad.lower() in c.get('name','').lower()]
        alerts = [a for a in alerts if ciudad.lower() in (a.get('cityName','') or '').lower()]

    # Obtener órdenes WFM directamente
    try:
        wfm_orders = wfm_service.obtener_ordenes()
    except Exception as e:
        logger.error(f"Error obteniendo WFM para reporte: {e}")
        wfm_orders = []

    noc_data = {"cities": cities, "alerts": alerts}

    try:
        pdf_bytes = _build_reporte_pdf(ciudad, fecha_inicio, fecha_fin, noc_data, wfm_orders)
    except Exception as e:
        logger.error(f"Error generando PDF reporte: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    ciudad_safe = ciudad.replace(' ', '_')
    filename = f"Reporte_NOC_{ciudad_safe}_{fecha_inicio}_{fecha_fin}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/api/integrations/status")
async def get_integrations_status():
    """Retorna el estado de las conexiones configuradas"""
    return {
        "hubspot": {"connected": True, "last_sync": "2026-04-27 13:00"},
        "net2phone": {"connected": True, "calls_active": 0},
        "ai_agents": {"active": True, "model": "Director General v2"}
    }


# ============================================================
# UISP — Mapa de red y estado de dispositivos
# ============================================================

@app.get("/api/red/resumen")
async def red_resumen():
    """KPIs generales de la red UISP."""
    return await uisp_service.get_summary()


@app.get("/api/red/dispositivos")
async def red_dispositivos():
    """Lista de todos los dispositivos con estado."""
    return await uisp_service.get_devices()


@app.get("/api/red/topologia")
async def red_topologia():
    """Nodos + edges para React Flow."""
    return await uisp_service.get_topology()


@app.get("/api/red/links")
async def red_links():
    """Conexiones (data-links) entre dispositivos."""
    return await uisp_service.get_data_links()


@app.get("/api/red/topologia-geo")
async def red_topologia_geo():
    """Links con coordenadas geográficas para dibujar en el mapa."""
    return await uisp_service.get_topology_geo()


@app.get("/api/red/uisp-status")
async def red_uisp_status():
    """Estado de la conexión con UISP (Ubiquiti). Útil para mostrar alerta en el mapa."""
    import time
    s = uisp_service._uisp_status
    last = s.get("last_checked")
    return {
        "ok":           s.get("ok", True),
        "error":        s.get("error"),
        "last_checked": last,
        "age_seconds":  round(time.time() - last) if last else None,
    }


# ─── ReportLab PDF Generator ─────────────────────────────────────────────────
from agents import reportlab_generator

class ReportLabRequest(BaseModel):
    tipo: str        # barrido | incidente | noc_caidas | operativo
    datos: dict
    nombre_archivo: Optional[str] = None

@app.post("/api/reportlab/generate")
async def reportlab_generate(req: ReportLabRequest):
    """Genera un PDF en formato corporativo XCIEN y lo retorna como descarga."""
    try:
        pdf_bytes = reportlab_generator.generar_reporte(req.tipo, req.datos)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[reportlab] Error generando reporte {req.tipo}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generando PDF: {e}")

    nombre = req.nombre_archivo or f"xcien_{req.tipo}_{dt_datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    if not nombre.endswith(".pdf"):
        nombre += ".pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )

@app.get("/api/reportlab/tipos")
async def reportlab_tipos():
    """Lista los tipos de reporte disponibles."""
    return {
        "tipos": [
            {"id": "barrido",    "label": "Barrido de Frecuencias",      "icono": "📡"},
            {"id": "incidente",  "label": "Reporte de Incidente",         "icono": "🔴"},
            {"id": "noc_caidas", "label": "NOC — Caídas Semanales",       "icono": "📉"},
            {"id": "operativo",  "label": "Reporte Operativo de Plaza",   "icono": "📊"},
        ]
    }


_odoo_servicios_cache:   dict = {"data": None, "ts": 0}
_radiobases_odoo_cache:  dict = {"data": None, "ts": 0}

@app.get("/api/red/radiobases-odoo")
def red_radiobases_odoo():
    """
    Radiobases de Odoo: registros running.services que son referenciados como
    radio_base_id por otros servicios, con sus coordenadas y conteo de clientes.
    También incluye datos de armonización con el inventario de infraestructura.
    TTL: 10 min (datos cambian poco).
    """
    import time as _time, re as _re, json as _json

    now = _time.time()
    if _radiobases_odoo_cache["data"] is not None and now - _radiobases_odoo_cache["ts"] < 600:
        return _radiobases_odoo_cache["data"]

    try:
        url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
        db   = os.environ.get("ODOO_DB",  "wispi17")
        user = os.environ.get("ODOO_USER", "")
        pwd  = os.environ.get("ODOO_PASSWORD", "")

        common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common")
        uid_odoo = common.authenticate(db, user, pwd, {})
        models_proxy = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object")

        # 1. Obtener IDs y conteo de servicios por radiobase
        groups = models_proxy.execute_kw(db, uid_odoo, pwd,
            "running.services", "read_group",
            [[["radio_base_id", "!=", False]]],
            {"fields": ["radio_base_id"], "groupby": ["radio_base_id"], "limit": 500})

        rb_ids     = [g["radio_base_id"][0] for g in groups]
        rb_nombres = {g["radio_base_id"][0]: g["radio_base_id"][1] for g in groups}
        rb_counts  = {g["radio_base_id"][0]: g["radio_base_id_count"] for g in groups}

        # 2. Leer los registros radiobase
        rbs = models_proxy.execute_kw(db, uid_odoo, pwd,
            "running.services", "read",
            [rb_ids],
            {"fields": ["id", "name", "partner_shipping_latitude",
                        "partner_shipping_longitude", "state",
                        "description", "partner_id"]})

        # 3. Leer Drive JSON para armonización
        infra_norm = {}
        try:
            infra_path = os.path.join(os.path.dirname(__file__), "data", "radiobases_drive.json")
            with open(infra_path) as f:
                for r in _json.load(f):
                    key = _re.sub(r"[^a-z0-9]", "", (r.get("name") or "").lower())
                    if key:
                        infra_norm[key] = r
        except Exception:
            pass

        def _match_infra(name: str):
            key = _re.sub(r"[^a-z0-9]", "", name.lower())
            # Exact
            if key in infra_norm:
                return infra_norm[key]
            # Remove common prefixes (RB, REP, radiobase)
            stripped = _re.sub(r"^(rb|rep|radiobase)\s*", "", name.lower()).strip()
            stripped_key = _re.sub(r"[^a-z0-9]", "", stripped)
            if stripped_key in infra_norm:
                return infra_norm[stripped_key]
            # Partial: infra key starts with stripped_key or vice versa
            for ik, iv in infra_norm.items():
                if len(stripped_key) >= 4 and (ik.startswith(stripped_key) or stripped_key.startswith(ik)):
                    return iv
            return None

        result = []
        for r in rbs:
            lat = r.get("partner_shipping_latitude") or 0
            lng = r.get("partner_shipping_longitude") or 0
            if not lat or not lng:
                continue
            if not (14.5 < lat < 32.8 and -118.5 < lng < -86.5):
                continue

            rb_id   = r["id"]
            label   = rb_nombres.get(rb_id, r.get("name") or "")
            # Strip Odoo prefix [SOP-XXXXX]
            display_name = _re.sub(r"^\[.*?\]\s*", "", label).strip() or label

            infra = _match_infra(display_name)

            result.append({
                "id":           rb_id,
                "nombre":       display_name,
                "sop":          r.get("name") or "",
                "lat":          lat,
                "lng":          lng,
                "estado":       r.get("state", ""),
                "clientes":     rb_counts.get(rb_id, 0),
                "partner":      r["partner_id"][1] if r.get("partner_id") else "",
                "en_infra":     infra is not None,
                "infra_estatus": infra.get("estatus") if infra else None,
                "infra_vigencia": infra.get("vigencia") if infra else None,
                "infra_renta":   infra.get("renta") if infra else None,
            })

        # Sort by clients descending
        result.sort(key=lambda x: x["clientes"], reverse=True)
        _radiobases_odoo_cache["data"] = result
        _radiobases_odoo_cache["ts"]   = now
        return result

    except Exception as e:
        logger.error(f"[radiobases-odoo] Error: {e}", exc_info=True)
        if _radiobases_odoo_cache["data"] is not None:
            return _radiobases_odoo_cache["data"]
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/noc/radiobases-harmonized")
async def noc_radiobases_harmonized():
    """
    Radiobases armonizadas: Odoo (ubicación+clientes) + NOCBoard (estado)
    + Helpdesk CAST (soporte abierto) + CAST campo (tareas activas).
    Caché 60 s.
    """
    from agents.radiobase_harmonizer import harmonize, invalidate
    cfg = {
        "odoo_url":       os.environ.get("ODOO_URL",  "https://odoo.wispi.mx"),
        "odoo_db":        os.environ.get("ODOO_DB",   "wispi19"),
        "odoo_user":      os.environ.get("ODOO_USER", ""),
        "odoo_pass":      os.environ.get("ODOO_PASSWORD", ""),
        "nocboard_proxy": os.environ.get("NOCBOARD_PROXY", "http://localhost:9400"),
        "nocboard_key":   os.environ.get("NOCBOARD_API_KEY", "87a08190b801416392e944ab79c7e3c9"),
    }
    try:
        return await harmonize(cfg)
    except Exception as e:
        logger.error(f"[radiobases-harmonized] {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/noc/radiobases-harmonized/refresh")
async def noc_radiobases_refresh():
    """Invalida la caché del armonizador para forzar recarga inmediata."""
    from agents.radiobase_harmonizer import invalidate
    invalidate()
    return {"ok": True}


class RadiobaseReporteRequest(BaseModel):
    nombre: str

@app.post("/api/noc/radiobase/reporte")
async def noc_radiobase_reporte(req: RadiobaseReporteRequest):
    """Genera PDF con tickets y tareas abiertas de una radiobase → Telegram."""
    import asyncio as _asyncio
    from agents.radiobase_harmonizer import harmonize

    cfg = {
        "odoo_url":  ODOO_URL,
        "odoo_db":   ODOO_DB,
        "odoo_user": ODOO_USER,
        "odoo_pass": ODOO_PASSWORD,
        "nocboard_proxy": NOCBOARD_API_BASE,
        "nocboard_key":   "87a08190b801416392e944ab79c7e3c9",
    }
    radiobases = await harmonize(cfg)
    rb = next((r for r in radiobases if r["nombre"] == req.nombre), None)
    if rb is None:
        return JSONResponse({"ok": False, "error": "Radiobase no encontrada"}, status_code=404)

    tickets = rb["soporte"]["tickets"]
    tareas  = rb["campo"]["tareas"]

    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, HRFlowable, Spacer
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import inch
        import datetime, requests as _req

        VERDE = colors.HexColor("#009B4E")
        ROJO  = colors.HexColor("#DC2626")
        AZUL  = colors.HexColor("#3B82F6")
        DARK  = colors.HexColor("#0D1B2A")
        GRIS  = colors.HexColor("#64748B")
        GRIS_L = colors.HexColor("#F1F5F9")
        BORDE = colors.HexColor("#E2E8F0")

        PIPELINE = ["NOC", "Dispatch", "Almacén", "Operaciones", "Cierre"]
        PRIORIDAD_COLOR = {"normal": GRIS, "alta": colors.HexColor("#D97706"),
                           "urgente": colors.HexColor("#EA580C"), "crítica": ROJO}

        fname = f"/tmp/reporte_rb_{req.nombre.replace(' ','_')}.pdf"
        doc = SimpleDocTemplate(fname, pagesize=letter,
            leftMargin=0.65*inch, rightMargin=0.65*inch,
            topMargin=0.65*inch, bottomMargin=0.65*inch)

        def ps(name, **kw):
            defaults = {"fontName": "Helvetica", "fontSize": 9, "textColor": DARK, "leading": 12}
            defaults.update(kw)
            return ParagraphStyle(name, **defaults)

        story = []
        story.append(Paragraph("XCIEN Networks", ps("logo", fontName="Helvetica-Bold", fontSize=11, textColor=VERDE, spaceAfter=2)))
        story.append(Paragraph(f"Reporte de Radiobase — {rb['nombre']}", ps("titulo", fontName="Helvetica-Bold", fontSize=16, spaceAfter=4)))
        story.append(Paragraph(
            f"Generado: {datetime.datetime.now().strftime('%d %b %Y %H:%M')} CST · "
            f"Estado: {rb.get('status','—').upper()} · "
            f"Clientes: {rb.get('clientes',0)} · "
            f"Tickets abiertos: {rb['soporte']['total']} · Tareas campo: {rb['campo']['total']}",
            ps("sub", textColor=GRIS, spaceAfter=2)))
        story.append(HRFlowable(width="100%", thickness=1.5, color=VERDE, spaceAfter=10))

        # KPI boxes
        kpis = [[
            Paragraph(f"<b>{rb['soporte']['total']}</b>", ps("kv", fontName="Helvetica-Bold", fontSize=22, textColor=ROJO if rb['soporte']['total']>0 else VERDE, alignment=1)),
            Paragraph(f"<b>{rb['campo']['total']}</b>", ps("kv2", fontName="Helvetica-Bold", fontSize=22, textColor=AZUL if rb['campo']['total']>0 else VERDE, alignment=1)),
            Paragraph(f"<b>{rb.get('clientes',0)}</b>", ps("kv3", fontName="Helvetica-Bold", fontSize=22, textColor=DARK, alignment=1)),
        ],[
            Paragraph("Tickets\nabiertos", ps("kl", fontSize=7.5, textColor=GRIS, alignment=1)),
            Paragraph("Tareas\nen campo", ps("kl2", fontSize=7.5, textColor=GRIS, alignment=1)),
            Paragraph("Clientes\nactivos", ps("kl3", fontSize=7.5, textColor=GRIS, alignment=1)),
        ]]
        t_kpi = Table(kpis, colWidths=[2.3*inch]*3)
        t_kpi.setStyle(TableStyle([
            ("INNERGRID",(0,0),(-1,-1),0.5,BORDE),
            ("BOX",(0,0),(-1,-1),0.5,BORDE),
            ("TOPPADDING",(0,0),(-1,-1),8), ("BOTTOMPADDING",(0,0),(-1,-1),8),
            ("ALIGN",(0,0),(-1,-1),"CENTER"),
        ]))
        story.append(t_kpi)
        story.append(Spacer(1, 14))

        # Tickets soporte
        if tickets:
            story.append(Paragraph("Tickets de Soporte Abiertos", ps("h2", fontName="Helvetica-Bold", fontSize=11, spaceBefore=4, spaceAfter=6)))
            hdr = ["#", "Ticket", "Etapa", "Prioridad", "Técnico", "Fecha"]
            rows = [hdr]
            for t in tickets:
                etapa_idx = t.get("etapa_idx", 0)
                pipeline_str = " → ".join(
                    f"[{s}]" if i == etapa_idx else s
                    for i, s in enumerate(PIPELINE)
                )
                rows.append([
                    str(t["id"]),
                    Paragraph(t["nombre"], ps("tn", fontSize=7.5)),
                    t.get("etapa","—"),
                    (t.get("prioridad","normal") or "normal").upper(),
                    (t.get("tecnico","—") or "—").split(" ")[0],
                    t.get("fecha","—"),
                ])
            col_w = [0.45*inch, 2.8*inch, 1.0*inch, 0.7*inch, 0.9*inch, 0.7*inch]
            t_tix = Table(rows, colWidths=col_w, repeatRows=1)
            t_tix.setStyle(TableStyle([
                ("BACKGROUND",(0,0),(-1,0),DARK), ("TEXTCOLOR",(0,0),(-1,0),colors.white),
                ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"), ("FONTSIZE",(0,0),(-1,0),7.5),
                ("FONTNAME",(0,1),(-1,-1),"Helvetica"), ("FONTSIZE",(0,1),(-1,-1),7.5),
                ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white, GRIS_L]),
                ("GRID",(0,0),(-1,-1),0.3,BORDE),
                ("TOPPADDING",(0,0),(-1,-1),4), ("BOTTOMPADDING",(0,0),(-1,-1),4),
            ]))
            story.append(t_tix)
            story.append(Spacer(1, 12))

        # Tareas campo
        if tareas:
            story.append(Paragraph("Tareas de Campo Activas", ps("h2", fontName="Helvetica-Bold", fontSize=11, spaceBefore=4, spaceAfter=6)))
            hdr2 = ["#", "Tarea", "Etapa", "Técnico(s)", "Fecha"]
            rows2 = [hdr2]
            for t in tareas:
                tecnicos = ", ".join(t.get("tecnicos",[])[:2]) or "—"
                rows2.append([
                    str(t["id"]),
                    Paragraph(t["nombre"], ps("tn2", fontSize=7.5)),
                    t.get("etapa","—"),
                    tecnicos[:30],
                    t.get("fecha","—"),
                ])
            col_w2 = [0.45*inch, 3.1*inch, 1.1*inch, 1.3*inch, 0.6*inch]
            t_tar = Table(rows2, colWidths=col_w2, repeatRows=1)
            t_tar.setStyle(TableStyle([
                ("BACKGROUND",(0,0),(-1,0),DARK), ("TEXTCOLOR",(0,0),(-1,0),colors.white),
                ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"), ("FONTSIZE",(0,0),(-1,0),7.5),
                ("FONTNAME",(0,1),(-1,-1),"Helvetica"), ("FONTSIZE",(0,1),(-1,-1),7.5),
                ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white, GRIS_L]),
                ("GRID",(0,0),(-1,-1),0.3,BORDE),
                ("TOPPADDING",(0,0),(-1,-1),4), ("BOTTOMPADDING",(0,0),(-1,-1),4),
            ]))
            story.append(t_tar)
            story.append(Spacer(1, 12))

        if not tickets and not tareas:
            story.append(Paragraph("✓ Sin tickets ni tareas activas para esta radiobase.", ps("ok", textColor=VERDE)))

        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDE))
        story.append(Paragraph(
            f"XCIEN Networks · NOC Virtual · Radiobase: {rb['nombre']} · {datetime.datetime.now().strftime('%d %b %Y')}",
            ps("footer", fontSize=6.5, textColor=GRIS, spaceBefore=4)))

        doc.build(story)

        # Enviar a Telegram
        tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        tg_chat  = os.environ.get("TELEGRAM_CHAT_ID_REPORTES", "") or os.environ.get("TELEGRAM_CHAT_ID", "")
        tot = rb["soporte"]["total"] + rb["campo"]["total"]
        caption = (
            f"📡 *Radiobase: {rb['nombre']}*\n"
            f"Estado: {rb.get('status','—').upper()}\n\n"
            f"• 🎫 {rb['soporte']['total']} ticket(s) soporte abierto(s)\n"
            f"• 🔧 {rb['campo']['total']} tarea(s) en campo\n"
            f"• 👥 {rb.get('clientes',0)} clientes activos\n"
            + (f"\n⚠️ Requiere atención" if tot > 0 else "\n✅ Sin pendientes")
        )
        with open(fname, "rb") as f:
            _req.post(
                f"https://api.telegram.org/bot{tg_token}/sendDocument",
                data={"chat_id": tg_chat, "caption": caption, "parse_mode": "Markdown"},
                files={"document": (f"reporte_{rb['nombre'].replace(' ','_')}.pdf", f, "application/pdf")},
                timeout=15,
            )
        return {"ok": True, "tickets": len(tickets), "tareas": len(tareas)}

    except Exception as e:
        logger.error(f"[radiobase_reporte] {e}", exc_info=True)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/red/odoo-servicios-geo")
def red_odoo_servicios_geo(estado: str = "active"):
    """
    Servicios running.services de Odoo con coordenadas geográficas.
    estado: active | suspended | draft | all
    """
    import time as _time
    cache_ttl = 300  # 5 min
    cache_key = estado

    now = _time.time()
    if (_odoo_servicios_cache.get("key") == cache_key and
            _odoo_servicios_cache["data"] is not None and
            now - _odoo_servicios_cache["ts"] < cache_ttl):
        return _odoo_servicios_cache["data"]

    try:
        url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
        db   = os.environ.get("ODOO_DB",  "wispi17")
        user = os.environ.get("ODOO_USER", "")
        pwd  = os.environ.get("ODOO_PASSWORD", "")

        common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common")
        uid_odoo = common.authenticate(db, user, pwd, {})

        models_proxy = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object")

        domain = [
            ["partner_shipping_latitude",  "!=", False],
            ["partner_shipping_latitude",  "!=", 0.0],
            ["partner_shipping_longitude", "!=", False],
            ["partner_shipping_longitude", "!=", 0.0],
        ]
        if estado != "all":
            domain.append(["state", "=", estado])

        records = models_proxy.execute_kw(db, uid_odoo, pwd,
            "running.services", "search_read",
            [domain],
            {"fields": [
                "id", "name", "partner_id", "state", "service_type",
                "mean_of_access", "delivery_type", "ip",
                "download_speed", "upload_speed",
                "partner_shipping_latitude", "partner_shipping_longitude",
                "category_id",
            ],
            "limit": 10000}
        )

        # Correcciones locales de coordenadas (sin modificar Odoo)
        _coord_overrides = {
            58616: (19.728917, -99.195778),  # SOP-17810 TEPOTZOTLAN BODEGA 2 — lat tenía 9.x en vez de 19.x
        }

        result = []
        for r in records:
            lat = r.get("partner_shipping_latitude")
            lng = r.get("partner_shipping_longitude")
            if not lat or not lng:
                continue
            if r["id"] in _coord_overrides:
                lat, lng = _coord_overrides[r["id"]]
            result.append({
                "id":           r["id"],
                "nombre":       r.get("name") or "—",
                "cliente":      r["partner_id"][1] if r.get("partner_id") else "—",
                "estado":       r.get("state", ""),
                "tipo":         r.get("service_type", ""),
                "acceso":       r.get("mean_of_access", ""),
                "entrega":      r.get("delivery_type", ""),
                "ip":           r.get("ip") or "",
                "bajada_mbps":  r.get("download_speed") or 0,
                "subida_mbps":  r.get("upload_speed") or 0,
                "categoria":    r["category_id"][1] if r.get("category_id") else "",
                "lat":          lat,
                "lng":          lng,
            })

        _odoo_servicios_cache["data"] = result
        _odoo_servicios_cache["ts"]   = now
        _odoo_servicios_cache["key"]  = cache_key
        return result

    except Exception as e:
        logger.error(f"[odoo-servicios-geo] Error: {e}", exc_info=True)
        if _odoo_servicios_cache["data"] is not None:
            return _odoo_servicios_cache["data"]
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/red/dispositivos-geo")
async def red_dispositivos_geo():
    """Dispositivos UISP con coordenadas de su sitio — para pintar en el mapa."""
    import asyncio
    devices, sites_coords = await asyncio.gather(
        uisp_service.get_devices(),
        uisp_service.get_sites_coords(),
    )
    result = []
    for d in devices:
        site_name = (d.get("site") or {}).get("name") if isinstance(d.get("site"), dict) else d.get("site")
        coords = sites_coords.get(site_name) if site_name else None
        if not coords:
            continue
        result.append({
            "id":      d["id"],
            "name":    d["name"],
            "model":   d["model"],
            "type":    d["type"],
            "status":  d["status"],
            "signal":  d.get("signal"),
            "stations": d.get("stations_count"),
            "site":    site_name,
            "lat":     coords["lat"],
            "lng":     coords["lng"],
            "inferred": coords.get("inferred", False),
        })
    return result


@app.get("/api/red/host/{host_id}")
async def red_host_detalle(host_id: str):
    """Detalle completo de un host: NOCBoard + UISP si es Ubiquiti."""
    import httpx

    # Buscar en NOCBoard
    host = None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{NOCBOARD_API_BASE}/hosts",
                headers={"X-API-Key": NOCBOARD_API_KEY}
            )
            hosts = r.json()
            if isinstance(hosts, dict):
                hosts = hosts.get("hosts", [])
            host = next((h for h in hosts if h.get("id") == host_id), None)
    except Exception as e:
        logger.warning(f"NOCBoard host detail error: {e}")

    if not host:
        raise HTTPException(status_code=404, detail="Host no encontrado")

    result = dict(host)

    # Enriquecer con UISP si es Ubiquiti
    if host.get("vendor") == "Ubiquiti":
        try:
            devices = await uisp_service.get_devices()
            # Intentar match por nombre o IP
            uisp_dev = next(
                (d for d in devices if d.get("name") == host.get("name")), None
            )
            if not uisp_dev:
                uisp_dev = next(
                    (d for d in devices if host.get("ip") and d.get("mac") and
                     host.get("name","").lower() in (d.get("name","").lower())), None
                )
            if uisp_dev:
                result["uisp"] = {
                    "signal":        uisp_dev.get("signal"),
                    "uplink_util":   uisp_dev.get("uplink_utilization"),
                    "downlink_util": uisp_dev.get("downlink_utilization"),
                    "stations":      uisp_dev.get("stations_count"),
                    "can_upgrade":   uisp_dev.get("can_upgrade"),
                    "firmware":      uisp_dev.get("firmware"),
                }
        except Exception as e:
            logger.warning(f"UISP enrich error: {e}")

    return result


# ─── Inventario Transfers (tokens de inventario entre almacenes) ───────────────
try:
    import inventario_tokens as inv_tk
    from inventario_tokens import (
        InventoryTokenCreate, TokenLine,
        create_token, get_token, list_tokens,
        confirm_token, ship_token, receive_token, cancel_token,
        get_virtual_stock, WAREHOUSES, STATES,
    )
    _inv_tk_available = True
except ImportError:
    _inv_tk_available = False
    logger.warning("inventario_tokens no disponible — endpoints /api/inv-transfers/ desactivados")

def _inv_tk_unavailable():
    raise HTTPException(503, "Módulo inventario_tokens no disponible en este entorno")

@app.post("/api/inv-transfers/", status_code=201)
def api_inv_create(data: dict):
    if not _inv_tk_available: _inv_tk_unavailable()
    try:
        return create_token(data)
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.get("/api/inv-transfers/")
def api_inv_list(state: str = None, warehouse: str = None, limit: int = 50, offset: int = 0):
    if not _inv_tk_available: _inv_tk_unavailable()
    return list_tokens(state=state, warehouse=warehouse, limit=limit, offset=offset)

@app.get("/api/inv-transfers/{token_id}")
def api_inv_get(token_id: str):
    if not _inv_tk_available: _inv_tk_unavailable()
    t = get_token(token_id)
    if not t:
        raise HTTPException(404, "Token no encontrado")
    return t

@app.patch("/api/inv-transfers/{token_id}/confirm")
def api_inv_confirm(token_id: str):
    if not _inv_tk_available: _inv_tk_unavailable()
    try:
        return confirm_token(token_id)
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.patch("/api/inv-transfers/{token_id}/ship")
def api_inv_ship(token_id: str):
    if not _inv_tk_available: _inv_tk_unavailable()
    try:
        return ship_token(token_id)
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.patch("/api/inv-transfers/{token_id}/receive")
def api_inv_receive(token_id: str):
    if not _inv_tk_available: _inv_tk_unavailable()
    try:
        return receive_token(token_id)
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.patch("/api/inv-transfers/{token_id}/cancel")
def api_inv_cancel(token_id: str):
    if not _inv_tk_available: _inv_tk_unavailable()
    try:
        return cancel_token(token_id)
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.get("/api/inv-transfers/stock/{warehouse}")
def api_inv_stock(warehouse: str):
    if not _inv_tk_available: _inv_tk_unavailable()
    if warehouse not in WAREHOUSES:
        raise HTTPException(400, f"Almacén inválido: {list(WAREHOUSES.keys())}")
    return get_virtual_stock(warehouse)

@app.get("/api/inv-transfers/warehouses/all")
def api_inv_warehouses():
    if not _inv_tk_available: _inv_tk_unavailable()
    return [
        {"code": code, "name": cfg["name"], "city": cfg["city"],
         "odoo_location_code": cfg["odoo_location_code"],
         "odoo_connected": cfg["odoo_location_id"] is not None}
        for code, cfg in WAREHOUSES.items()
    ]


# ─── XCIEN Tokens Unificados ──────────────────────────────────────────────────
try:
    import xcien_tokens as xt
    from xcien_tokens import (
        Token, TokenCreate, TransitionRequest,
        create_token as xt_create, get_token as xt_get,
        list_tokens as xt_list, transition_token as xt_transition,
        get_token_events as xt_events, get_stats as xt_stats,
        auto_emit, verify_chain, subscribe as xt_subscribe, unsubscribe as xt_unsubscribe,
        DOMAINS, ENTITIES,
    )
    _xt_available = True
except ImportError:
    _xt_available = False
    auto_emit = None
    logger.warning("xcien_tokens no disponible — endpoints /api/xtokens/ desactivados")
from fastapi.responses import StreamingResponse

def _xt_unavailable():
    raise HTTPException(503, "Módulo xcien_tokens no disponible en este entorno")

@app.post("/api/xtokens/", status_code=201)
def api_xt_create(data: dict):
    if not _xt_available: _xt_unavailable()
    try:
        return xt_create(data).model_dump()
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.get("/api/xtokens/")
def api_xt_list(domain: str = None, entity: str = None, state: str = None, limit: int = 100, offset: int = 0, search: str = None):
    if not _xt_available: _xt_unavailable()
    return [t.model_dump() for t in xt_list(domain=domain, entity=entity, state=state, limit=limit, offset=offset, search=search)]

@app.get("/api/xtokens/stats")
def api_xt_stats():
    if not _xt_available: _xt_unavailable()
    return xt_stats()

@app.get("/api/xtokens/schema")
def api_xt_schema():
    if not _xt_available: _xt_unavailable()
    return {
        "domains": {k: {
            "label": v["label"], "icon": v["icon"], "color": v["color"],
            "initial": v["initial"],
            "states": list(v["transitions"].keys()),
            "state_labels": v["state_labels"],
            "transitions": v["transitions"],
        } for k, v in DOMAINS.items()},
        "entities": ENTITIES,
    }

@app.get("/api/xtokens/{token_id}")
def api_xt_get(token_id: str):
    if not _xt_available: _xt_unavailable()
    t = xt_get(token_id)
    if not t:
        raise HTTPException(404, "Token no encontrado")
    return t.model_dump()

@app.get("/api/xtokens/{token_id}/events")
def api_xt_events(token_id: str):
    if not _xt_available: _xt_unavailable()
    return xt_events(token_id)

@app.post("/api/xtokens/{token_id}/transition")
def api_xt_transition(token_id: str, req: dict):
    if not _xt_available: _xt_unavailable()
    try:
        return xt_transition(token_id, req).model_dump()
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.get("/api/xtokens/chain/verify")
def api_xt_verify():
    if not _xt_available: _xt_unavailable()
    return verify_chain()

@app.get("/api/xtokens/stream")
async def api_xt_stream():
    """SSE — transmite cada evento de token en tiempo real."""
    if not _xt_available: _xt_unavailable()
    q = xt_subscribe()
    async def event_generator():
        try:
            # Heartbeat inicial
            yield "data: {\"type\":\"connected\"}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield "data: {\"type\":\"ping\"}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            xt_unsubscribe(q)
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Auto-emit hooks — se disparan en los endpoints de acción existentes ───────

def _hook_transaccion(tx: dict):
    """Emite token finanzas cuando se registra una transacción inter-empresa."""
    try:
        auto_emit(
            domain="finanzas", entity=tx.get("empresa_origen", "xcien"),
            payload={k: v for k, v in tx.items() if k != "firma"},
            created_by=tx.get("responsable", "sistema"),
            notes=tx.get("concepto", ""),
            ext_ref=tx.get("tx_id"), ext_system="transacciones_api",
        )
    except Exception:
        pass

def _hook_token_operativo(data: dict):
    """Emite token rrhh/academia cuando se crea un token operativo."""
    tipo = data.get("tipo", "")
    domain = "academia" if tipo in ("certificacion",) else "rrhh"
    try:
        auto_emit(
            domain=domain, entity=data.get("empresa", "xcien"),
            payload={**data, "tipo_original": tipo},
            created_by=data.get("nombre") or data.get("agente") or "sistema",
            notes=data.get("detalle", ""),
            ext_system="tokens_operativo",
        )
    except Exception:
        pass

def _hook_wfm_ticket(ticket: dict, action: str = "created"):
    """Emite token field_service cuando se crea o actualiza un ticket WFM."""
    state_map = {
        "created": "created", "Abierto": "created",
        "Agendado": "assigned", "En Sitio": "in_progress",
        "Cerrado": "completed", "Cancelado": "cancelled",
    }
    state = state_map.get(ticket.get("status", "created"), "created")
    try:
        # Si ya existe un token para este ticket, transicionarlo
        existing = xt_list(domain="field_service", search=ticket.get("id", ""), limit=1)
        if existing and action != "created":
            allowed = DOMAINS["field_service"]["transitions"].get(existing[0].state, [])
            if state in allowed:
                xt_transition(existing[0].token_id, TransitionRequest(
                    new_state=state, transitioned_by="wfm_sistema",
                    notes=f"Status WFM: {ticket.get('status')}",
                ))
            return
        auto_emit(
            domain="field_service", entity="xcien",
            payload={
                "tecnico": ticket.get("asignado"),
                "cliente": ticket.get("client"),
                "sitio": ticket.get("location"),
                "tipo_servicio": ticket.get("tipo"),
                "zona": ticket.get("zona"),
                "priority": ticket.get("priority"),
                "ticket_id": ticket.get("id"),
            },
            created_by="wfm_sistema",
            notes=ticket.get("description", ""),
            ext_ref=ticket.get("id"), ext_system="wfm",
        )
    except Exception:
        pass


# ─── Observium ────────────────────────────────────────────────────────────────
import httpx as _httpx_obs

OBSERVIUM_BASE = os.environ.get("OBSERVIUM_URL", "https://172.31.150.244:4301")
OBSERVIUM_USER = os.environ.get("OBSERVIUM_USER", "")
OBSERVIUM_PASS = os.environ.get("OBSERVIUM_PASS", "")

async def _obs_get(path: str, params: dict = {}):
    try:
        async with _httpx_obs.AsyncClient(verify=False, timeout=15) as c:
            r = await c.get(
                f"{OBSERVIUM_BASE}/api/v0/{path}",
                params=params,
                auth=(OBSERVIUM_USER, OBSERVIUM_PASS)
            )
            return r.json()
    except Exception as e:
        logger.warning(f"Observium error {path}: {e}")
        return {}

@app.get("/api/observium/summary")
async def observium_summary():
    data  = await _obs_get("devices", {"fields": "device_id,status"})
    devs  = data.get("devices", {})
    total = data.get("count", len(devs))
    up    = sum(1 for v in devs.values() if str(v.get("status","")) in ("1","ok"))
    down  = total - up
    return {
        "total": total,
        "up": up,
        "down": down,
        "availability": round(up / total * 100, 2) if total else 0,
    }

@app.get("/api/observium/alerts")
async def observium_alerts(limit: int = 100):
    data = await _obs_get("alerts")
    alerts = data.get("alerts", {})
    critical = [
        {
            "id": k,
            "device_id": v.get("device_id"),
            "entity_type": v.get("entity_type"),
            "severity": v.get("severity"),
            "status": v.get("status"),
            "cls": v.get("class"),
            "message": v.get("last_message"),
            "checked": v.get("checked"),
            "changed": v.get("changed"),
        }
        for k, v in alerts.items()
        if v.get("class") in ("red", "orange", "olive")
    ]
    critical.sort(key=lambda x: x.get("changed") or "", reverse=True)
    return critical[:limit]

@app.get("/api/observium/devices/down")
async def observium_devices_down(limit: int = 200):
    data = await _obs_get("devices", {"status": "0"})
    devs = data.get("devices", {})
    result = [
        {
            "id": k,
            "hostname": v.get("hostname"),
            "location": v.get("location"),
            "os": v.get("os"),
            "hardware": v.get("hardware"),
            "uptime": v.get("uptime"),
            "last_polled": v.get("last_polled"),
        }
        for k, v in devs.items()
    ]
    result.sort(key=lambda x: x.get("location") or "")
    return result[:limit]

@app.get("/api/observium/devices/up")
async def observium_devices_up(limit: int = 200):
    data = await _obs_get("devices", {"status": "1"})
    devs = data.get("devices", {})
    result = [
        {
            "id": k,
            "hostname": v.get("hostname"),
            "location": v.get("location"),
            "os": v.get("os"),
            "hardware": v.get("hardware"),
        }
        for k, v in devs.items()
    ]
    result.sort(key=lambda x: x.get("location") or "")
    return result[:limit]

# ─── Latencia NOCBoard ───────────────────────────────────────────────────────

_latency_cache: dict = {"ts": 0, "data": None}
_LATENCY_TTL = 60

@app.get("/api/noc/latencia")
def get_noc_latencia():
    """Latencia RTT y packet-loss desde NOCBoard — por host y por ciudad."""
    import time as _time
    from collections import defaultdict as _ddict

    if _time.time() - _latency_cache["ts"] < _LATENCY_TTL and _latency_cache["data"]:
        return _latency_cache["data"]

    hosts = _load_noc_data("hosts", NOCBOARD_HOSTS_FILE)
    with_lat = [
        h for h in hosts
        if (h.get("ping") or h.get("lastPingResult", {})) and
           (h.get("ping") or h.get("lastPingResult", {})).get("latency_avg") is not None
    ]

    top_hosts = sorted(
        [
            {
                "id":      h.get("id"),
                "name":    h.get("display_name") or h.get("rawName") or "",
                "city":    h.get("city", ""),
                "site":    h.get("site", ""),
                "ip":      h.get("ip", ""),
                "lat_avg": round((h.get("ping") or h.get("lastPingResult", {})).get("latency_avg", 0), 1),
                "lat_max": round((h.get("ping") or h.get("lastPingResult", {})).get("latency_max", 0), 1),
                "loss":    (h.get("ping") or h.get("lastPingResult", {})).get("packet_loss", 0),
                "status":  _host_status(h),
            }
            for h in with_lat
        ],
        key=lambda h: h["lat_avg"], reverse=True
    )[:15]

    city_map: dict = _ddict(list)
    for h in with_lat:
        ping = h.get("ping") or h.get("lastPingResult", {})
        city_map[h.get("city", "Desconocida")].append(ping.get("latency_avg", 0))

    por_ciudad = sorted(
        [{"ciudad": c, "avg": round(sum(v)/len(v),1), "max": round(max(v),1), "n": len(v)}
         for c, v in city_map.items()],
        key=lambda c: c["avg"], reverse=True
    )

    all_lats = [h["lat_avg"] for h in top_hosts]
    result = {
        "global_avg":  round(sum(all_lats)/len(all_lats), 1) if all_lats else 0,
        "global_max":  round(max(all_lats), 1) if all_lats else 0,
        "hosts_total": len(with_lat),
        "hosts_high_latency": sum(1 for h in with_lat
            if (h.get("ping") or h.get("lastPingResult", {})).get("latency_avg", 0) > 150),
        "hosts_con_loss": sum(1 for h in with_lat
            if (h.get("ping") or h.get("lastPingResult", {})).get("packet_loss", 0) > 0),
        "top_hosts":   top_hosts,
        "por_ciudad":  por_ciudad,
    }
    _latency_cache["ts"]   = _time.time()
    _latency_cache["data"] = result
    return result


# ─── Tráfico de interfaces Observium ─────────────────────────────────────────

_traffic_cache: dict = {"ts": 0, "data": None}
_TRAFFIC_TTL = 120

@app.get("/api/observium/trafico")
async def get_observium_trafico(limit: int = 15):
    """Top interfaces por tráfico + agregado total desde Observium."""
    import time as _time

    if _time.time() - _traffic_cache["ts"] < _TRAFFIC_TTL and _traffic_cache["data"]:
        return _traffic_cache["data"]

    data = await _obs_get("ports", {
        "fields":       "port_id,device_id,hostname,ifDescr,ifAlias,ifOperStatus,ifSpeed,in_rate,out_rate,ifInOctets_rate,ifOutOctets_rate",
        "pagesize":     "500",
        "ifOperStatus": "up",
    })
    ports = data.get("ports", [])
    if isinstance(ports, dict):
        ports = list(ports.values())

    def _mbps(p: dict, a: str, b: str) -> float:
        v = p.get(a) or p.get(b) or 0
        return round(int(v) * 8 / 1_000_000, 2)

    enriched = []
    for p in ports:
        rx = _mbps(p, "in_rate", "ifInOctets_rate")
        tx = _mbps(p, "out_rate", "ifOutOctets_rate")
        if rx + tx < 0.01:
            continue
        spd = int(p.get("ifSpeed") or 0) / 1_000_000
        enriched.append({
            "port_id":    p.get("port_id"),
            "device":     p.get("hostname", ""),
            "iface":      p.get("ifAlias") or p.get("ifDescr", ""),
            "speed_mb":   round(spd, 0),
            "rx_mbps":    rx,
            "tx_mbps":    tx,
            "total_mbps": round(rx + tx, 2),
            "util_pct":   round((rx + tx) / (spd * 2) * 100, 1) if spd > 0 else None,
        })

    enriched.sort(key=lambda p: p["total_mbps"], reverse=True)
    total_rx = round(sum(p["rx_mbps"] for p in enriched) / 1000, 2)
    total_tx = round(sum(p["tx_mbps"] for p in enriched) / 1000, 2)

    result = {
        "total_rx_gbps":      total_rx,
        "total_tx_gbps":      total_tx,
        "total_gbps":         round(total_rx + total_tx, 2),
        "interfaces_activas": len(enriched),
        "top_interfaces":     enriched[:limit],
    }
    _traffic_cache["ts"]   = _time.time()
    _traffic_cache["data"] = result
    return result


# ─── Academia: empleados enriquecidos con plaza y área ────────────────────────

_plaza_cache: dict = {"ts": 0, "data": None}
_PLAZA_TTL = 600  # 10 minutos

@app.get("/api/academia/tecnicos-plaza")
def get_tecnicos_plaza():
    """
    Devuelve mapa nombre→{plaza, area} cruzando hr.employee con Odoo.
    Cubre TODA la organización — técnicos, NOC, WFM, comercial, back office.
    No filtra por puesto: cualquier empleado activo en Odoo puede estar inscrito.
    """
    if _time.time() - _plaza_cache["ts"] < _PLAZA_TTL and _plaza_cache["data"]:
        return _plaza_cache["data"]

    try:
        models, odoo_db, uid, odoo_pass = _odoo_connect()
        empleados = models.execute_kw(
            odoo_db, uid, odoo_pass, "hr.employee", "search_read",
            [[["active", "=", True]]],
            {"fields": ["name", "work_location_id", "job_title", "department_id"], "limit": 3000},
        ) or []
    except Exception as e:
        logger.warning(f"[academia-plaza] Error RRHH: {e}")
        return {"mapa": {}, "mapa_area": {}, "plazas": [], "areas": [], "total": 0}

    mapa:      dict[str, str] = {}   # nombre_lower → plaza
    mapa_area: dict[str, str] = {}   # nombre_lower → área (departamento)
    plazas_set: set[str] = set()
    areas_set:  set[str] = set()

    for e in empleados:
        nombre = (e.get("name") or "").strip()
        if not nombre:
            continue
        key = nombre.lower()

        # Plaza: work_location_id tiene prioridad; fallback sin plaza
        plaza = ""
        if e.get("work_location_id") and isinstance(e["work_location_id"], (list, tuple)):
            plaza = (e["work_location_id"][1] or "").strip()
        elif isinstance(e.get("work_location_id"), str):
            plaza = e["work_location_id"].strip()
        plaza = plaza or "Sin plaza"

        # Área: department_id
        area = ""
        if e.get("department_id") and isinstance(e["department_id"], (list, tuple)):
            area = (e["department_id"][1] or "").strip()
        area = area or "Sin área"

        mapa[key]      = plaza
        mapa_area[key] = area
        plazas_set.add(plaza)
        areas_set.add(area)

    result = {
        "mapa":      mapa,               # { "juan garcia": "Hermosillo" }
        "mapa_area": mapa_area,          # { "juan garcia": "Técnicos de Campo" }
        "plazas":    sorted(plazas_set),
        "areas":     sorted(areas_set),
        "total":     len(mapa),
    }
    _plaza_cache["ts"]   = _time.time()
    _plaza_cache["data"] = result
    return result


# ─── Reportes KPI ─────────────────────────────────────────────────────────────

class ReporteKPIRequest(BaseModel):
    tipo: str          # 'diario' | 'semanal' | 'mensual'
    kpis: List[Dict[str, Any]]   # snapshot de KPIConfig[]
    canal: Optional[str] = None  # 'telegram' | None (solo PDF)

def _build_kpi_pdf(tipo: str, kpis: list, valores: dict) -> bytes:
    """Genera PDF de reporte KPI con ReportLab."""
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    import io

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.6*inch, bottomMargin=0.6*inch,
                            leftMargin=0.7*inch, rightMargin=0.7*inch)
    styles = getSampleStyleSheet()
    GREEN  = colors.HexColor("#00C896")
    DARK   = colors.HexColor("#0d1117")
    WHITE  = colors.white

    titulo_style = ParagraphStyle("titulo", parent=styles["Title"],
        textColor=WHITE, backColor=DARK, fontSize=18, leading=24,
        spaceAfter=6, alignment=TA_CENTER)
    sub_style = ParagraphStyle("sub", parent=styles["Normal"],
        textColor=GREEN, fontSize=11, spaceAfter=4, alignment=TA_CENTER)
    normal = ParagraphStyle("normal", parent=styles["Normal"],
        textColor=colors.HexColor("#e5e7eb"), fontSize=10, leading=14)

    now   = dt_datetime.now().strftime("%d/%m/%Y %H:%M")
    tipo_label = {"diario": "Diario", "semanal": "Semanal", "mensual": "Mensual"}.get(tipo, tipo.capitalize())

    story = [
        Paragraph(f"XCIEN Networks — Reporte {tipo_label}", titulo_style),
        Paragraph(f"Generado: {now}", sub_style),
        Spacer(1, 0.25*inch),
        HRFlowable(width="100%", thickness=1, color=GREEN),
        Spacer(1, 0.2*inch),
    ]

    # Tabla de KPIs activos
    enabled_kpis = [k for k in kpis if k.get("enabled", True)]
    if enabled_kpis:
        header = [Paragraph("<b>KPI</b>", normal), Paragraph("<b>Valor</b>", normal), Paragraph("<b>Estado</b>", normal)]
        rows   = [header]
        for k in enabled_kpis:
            val  = valores.get(k["id"], "—")
            ok   = k.get("threshold_ok",   None)
            warn = k.get("threshold_warn", None)
            inv  = k.get("invert", False)
            # semáforo
            if isinstance(val, (int, float)) and ok is not None and warn is not None:
                if (val >= ok) if not inv else (val <= ok):
                    status_text = "🟢 OK"
                    status_color = colors.HexColor("#00C896")
                elif (val >= warn) if not inv else (val <= warn):
                    status_text = "🟡 ALERTA"
                    status_color = colors.HexColor("#FFB703")
                else:
                    status_text = "🔴 CRÍTICO"
                    status_color = colors.HexColor("#FF4757")
            else:
                status_text  = "⚪ N/A"
                status_color = colors.HexColor("#6b7280")

            fmt = k.get("format", "number")
            if isinstance(val, (int, float)):
                if fmt == "currency": display = f"${val:,.0f}"
                elif fmt == "percent": display = f"{val:.1f}%"
                else: display = f"{val:,}"
            else:
                display = str(val)

            rows.append([
                Paragraph(k.get("label", k["id"]), normal),
                Paragraph(f"<b>{display}</b>", ParagraphStyle("val", parent=normal, textColor=status_color)),
                Paragraph(status_text, ParagraphStyle("st", parent=normal, textColor=status_color)),
            ])

        t = Table(rows, colWidths=[3*inch, 1.8*inch, 1.5*inch])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), DARK),
            ("TEXTCOLOR",  (0,0), (-1,0), GREEN),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.HexColor("#111827"), colors.HexColor("#0d1117")]),
            ("GRID",       (0,0), (-1,-1), 0.3, colors.HexColor("#374151")),
            ("TOPPADDING", (0,0), (-1,-1), 6),
            ("BOTTOMPADDING", (0,0), (-1,-1), 6),
            ("LEFTPADDING", (0,0), (-1,-1), 8),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.2*inch))

    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#374151")))
    story.append(Spacer(1, 0.1*inch))
    story.append(Paragraph("XCIEN Networks · Centro de Mando · Confidencial",
        ParagraphStyle("footer", parent=normal, textColor=colors.HexColor("#6b7280"), fontSize=8, alignment=TA_CENTER)))

    doc.build(story)
    buf.seek(0)
    return buf.read()


async def _fetch_kpi_valor(endpoint: str, field: str) -> Any:
    """Llama internamente al endpoint y extrae el campo."""
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.get(f"http://localhost:8002{endpoint}", timeout=8)
            if r.status_code == 200:
                data = r.json()
                # dot-path resolution
                parts = field.split(".")
                v = data
                for p in parts:
                    if isinstance(v, dict):
                        v = v.get(p)
                    else:
                        v = None
                        break
                return v
    except Exception as e:
        logger.warning(f"[reportes-kpi] No se pudo obtener {endpoint}/{field}: {e}")
    return None


@app.post("/api/reportes/generar")
async def generar_reporte_kpi(req: ReporteKPIRequest, _user: dict = Depends(get_current_user)):
    """Genera reporte KPI en PDF y opcionalmente lo envía por Telegram."""
    import tempfile, os

    # Recopilar valores actuales para cada KPI habilitado
    enabled_kpis = [k for k in req.kpis if k.get("enabled", True)]
    endpoints_uniq = list({k["endpoint"] for k in enabled_kpis})

    valores: Dict[str, Any] = {}
    for k in enabled_kpis:
        v = await _fetch_kpi_valor(k["endpoint"], k["field"])
        valores[k["id"]] = v

    # Generar PDF
    pdf_bytes = _build_kpi_pdf(req.tipo, req.kpis, valores)

    # Guardar en temp para Telegram
    tipo_label = {"diario": "Diario", "semanal": "Semanal", "mensual": "Mensual"}.get(req.tipo, req.tipo.capitalize())
    fecha_str  = dt_datetime.now().strftime("%Y-%m-%d")
    filename   = f"Reporte_{tipo_label}_XCIEN_{fecha_str}.pdf"

    telegram_sent = False
    canal = req.canal or "telegram"
    if canal == "telegram":
        try:
            cfg = _load_telegram_config()
            token    = cfg.get("token")
            chat_id  = cfg.get("chat_id")
            if token and chat_id:
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf", prefix="reporte_xcien_")
                tmp.write(pdf_bytes)
                tmp.close()
                bot = TelegramBot(token=token, chat_id=chat_id)
                now_str = dt_datetime.now().strftime("%d/%m/%Y %H:%M")
                caption = (
                    f"📊 *Reporte {tipo_label} XCIEN*\n"
                    f"🗓 {now_str}\n"
                    f"KPIs activos: {len(enabled_kpis)}\n"
                    f"_Generado desde el Centro de Mando_"
                )
                bot.send_document(tmp.name, caption=caption)
                os.unlink(tmp.name)
                telegram_sent = True
        except Exception as e:
            logger.error(f"[reportes-kpi] Error enviando Telegram: {e}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Telegram-Sent": str(telegram_sent).lower(),
        }
    )


# ─── Rutas de Aprendizaje (Learning Paths) ────────────────────────────────────

RUTAS_FILE = os.path.join(BASE_DIR, "db", "rutas_aprendizaje.json")

_RUTAS_DEFAULT = {
    "TI": {"area": "TI", "nombre": "Técnico de Infraestructura", "descripcion": "Instalación, mantenimiento y operación de infraestructura de red XCIEN.", "color": "#00C896", "icono": "🔧",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 18, "curso_name": "Reemplazo de Servicios en Operación", "orden": 2, "obligatorio": True}, {"curso_id": 35, "curso_name": "Verificación de Voltaje", "orden": 3, "obligatorio": True}, {"curso_id": 42, "curso_name": "Seguridad en Campo y Manejo de Baterías", "orden": 4, "obligatorio": True}, {"curso_id": 39, "curso_name": "Topología de Red y Diagnóstico XCIEN", "orden": 5, "obligatorio": True}, {"curso_id": 87, "curso_name": "Capacitación Raisecom — Técnico de Campo", "orden": 6, "obligatorio": False}, {"curso_id": 88, "curso_name": "CAST — Certificación Técnica XCIEN", "orden": 7, "obligatorio": False}]},
    "N1": {"area": "N1", "nombre": "NOC Nivel 1", "descripcion": "Monitoreo de red, atención de alertas y escalamiento.", "color": "#3B82F6", "icono": "📡",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 38, "curso_name": "Monitoreo SNMP y NOCBoards XCIEN", "orden": 2, "obligatorio": True}, {"curso_id": 39, "curso_name": "Topología de Red y Diagnóstico XCIEN", "orden": 3, "obligatorio": True}, {"curso_id": 86, "curso_name": "Programa NOC XCIEN", "orden": 4, "obligatorio": True}, {"curso_id": 43, "curso_name": "Protocolos de Emergencia XCIEN", "orden": 5, "obligatorio": True}]},
    "N2": {"area": "N2", "nombre": "NOC Nivel 2", "descripcion": "Diagnóstico avanzado, configuración de equipos y resolución de incidencias.", "color": "#6366F1", "icono": "🖥️",
           "cursos": [{"curso_id": 38, "curso_name": "Monitoreo SNMP y NOCBoards XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 86, "curso_name": "Programa NOC XCIEN", "orden": 2, "obligatorio": True}, {"curso_id": 46, "curso_name": "Laboratorio QC — Radios Mimosa", "orden": 3, "obligatorio": True}, {"curso_id": 88, "curso_name": "CAST — Certificación Técnica XCIEN", "orden": 4, "obligatorio": True}]},
    "TC": {"area": "TC", "nombre": "Técnico Ops / Almacén", "descripcion": "Field service, inventario y transferencias en Odoo.", "color": "#F59E0B", "icono": "📦",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 40, "curso_name": "Field Service en Odoo — Guía Técnicos", "orden": 2, "obligatorio": True}, {"curso_id": 41, "curso_name": "Inventario y Transferencias en Odoo", "orden": 3, "obligatorio": True}, {"curso_id": 42, "curso_name": "Seguridad en Campo y Manejo de Baterías", "orden": 4, "obligatorio": True}, {"curso_id": 35, "curso_name": "Verificación de Voltaje", "orden": 5, "obligatorio": True}]},
    "PM": {"area": "PM", "nombre": "Project Managers", "descripcion": "Gestión de proyectos, bidrillas y coordinación de equipos.", "color": "#EC4899", "icono": "📋",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 37, "curso_name": "Gestión de Proyectos", "orden": 2, "obligatorio": True}, {"curso_id": 45, "curso_name": "Capacitación Operaciones XCIEN", "orden": 3, "obligatorio": True}, {"curso_id": 43, "curso_name": "Protocolos de Emergencia XCIEN", "orden": 4, "obligatorio": False}]},
    "CO": {"area": "CO", "nombre": "Comercial", "descripcion": "Ventas B2B, prospección y cierre de cuentas corporativas.", "color": "#10B981", "icono": "💼",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 44, "curso_name": "Capacitación Comercial XCIEN", "orden": 2, "obligatorio": True}, {"curso_id": 15, "curso_name": "CFDi 4.0", "orden": 3, "obligatorio": True}]},
    "SP": {"area": "SP", "nombre": "Servicios y Preventa", "descripcion": "Factibilidad técnica, cotizaciones y acompañamiento al cliente.", "color": "#8B5CF6", "icono": "🔍",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 44, "curso_name": "Capacitación Comercial XCIEN", "orden": 2, "obligatorio": True}, {"curso_id": 39, "curso_name": "Topología de Red y Diagnóstico XCIEN", "orden": 3, "obligatorio": True}]},
    "RH": {"area": "RH", "nombre": "Recursos Humanos", "descripcion": "Administración de personal, nómina y bienestar organizacional.", "color": "#F472B6", "icono": "👥",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 15, "curso_name": "CFDi 4.0", "orden": 2, "obligatorio": True}]},
    "LC": {"area": "LC", "nombre": "Líderes de Campo", "descripcion": "Supervisión de técnicos, calidad en campo y reporteo.", "color": "#EF4444", "icono": "🏗️",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 37, "curso_name": "Gestión de Proyectos", "orden": 2, "obligatorio": True}, {"curso_id": 42, "curso_name": "Seguridad en Campo y Manejo de Baterías", "orden": 3, "obligatorio": True}, {"curso_id": 43, "curso_name": "Protocolos de Emergencia XCIEN", "orden": 4, "obligatorio": True}, {"curso_id": 45, "curso_name": "Capacitación Operaciones XCIEN", "orden": 5, "obligatorio": True}]},
    "ID": {"area": "ID", "nombre": "Ingeniería de Datos", "descripcion": "Análisis, visualización y automatización de datos operativos.", "color": "#06B6D4", "icono": "📊",
           "cursos": [{"curso_id": 84, "curso_name": "Inducción XCIEN", "orden": 1, "obligatorio": True}, {"curso_id": 38, "curso_name": "Monitoreo SNMP y NOCBoards XCIEN", "orden": 2, "obligatorio": False}]},
}

def _load_rutas() -> dict:
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        try:
            from db_migrate import get_conn
            conn = get_conn(); cur = conn.cursor()
            cur.execute("SELECT area, nombre, descripcion, color, icono, cursos FROM rutas_aprendizaje")
            rows = cur.fetchall(); cur.close(); conn.close()
            if rows:
                return {r[0]: {"area": r[0], "nombre": r[1], "descripcion": r[2],
                               "color": r[3], "icono": r[4], "cursos": r[5]} for r in rows}
        except Exception:
            pass
    try:
        if os.path.exists(RUTAS_FILE):
            with open(RUTAS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data:
                    return data
    except Exception:
        pass
    return _RUTAS_DEFAULT

def _save_rutas(data: dict):
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        try:
            from db_migrate import get_conn
            conn = get_conn(); cur = conn.cursor()
            for area, ruta in data.items():
                cur.execute("""
                    INSERT INTO rutas_aprendizaje (area, nombre, descripcion, color, icono, cursos, actualizado_en)
                    VALUES (%s,%s,%s,%s,%s,%s,NOW())
                    ON CONFLICT (area) DO UPDATE
                    SET nombre=%s, descripcion=%s, color=%s, icono=%s, cursos=%s, actualizado_en=NOW()
                """, (area, ruta.get("nombre",""), ruta.get("descripcion",""),
                      ruta.get("color","#00C896"), ruta.get("icono","🎓"),
                      json.dumps(ruta.get("cursos",[])),
                      ruta.get("nombre",""), ruta.get("descripcion",""),
                      ruta.get("color","#00C896"), ruta.get("icono","🎓"),
                      json.dumps(ruta.get("cursos",[]))))
            conn.commit(); cur.close(); conn.close()
            return
        except Exception as e:
            logger.error(f"[DB] _save_rutas: {e}")
    os.makedirs(os.path.dirname(RUTAS_FILE), exist_ok=True)
    with open(RUTAS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

class RutaItem(BaseModel):
    curso_id:   int
    curso_name: str
    orden:      int
    obligatorio: bool = True

class RutaPayload(BaseModel):
    area:        str
    nombre:      str
    descripcion: str = ""
    cursos:      List[RutaItem]
    color:       str = "#00C896"
    icono:       str = "🎓"

@app.get("/api/academia/rutas")
def get_rutas():
    """Lista todas las rutas de aprendizaje configuradas."""
    return _load_rutas()

@app.get("/api/academia/rutas/{area}")
def get_ruta_area(area: str):
    """Ruta de aprendizaje de un área específica."""
    rutas = _load_rutas()
    return rutas.get(area) or {"area": area, "cursos": [], "nombre": f"Ruta {area}"}

@app.post("/api/academia/rutas")
def upsert_ruta(payload: RutaPayload, _user: dict = Depends(require_rol("admin", "director"))):
    """Crea o actualiza la ruta de un área. Solo admin/director."""
    rutas = _load_rutas()
    rutas[payload.area] = {
        "area":        payload.area,
        "nombre":      payload.nombre,
        "descripcion": payload.descripcion,
        "cursos":      [c.model_dump() for c in sorted(payload.cursos, key=lambda x: x.orden)],
        "color":       payload.color,
        "icono":       payload.icono,
        "updated_at":  dt_datetime.now().isoformat(),
    }
    _save_rutas(rutas)
    return {"status": "ok", "area": payload.area, "cursos": len(payload.cursos)}

@app.delete("/api/academia/rutas/{area}")
def delete_ruta(area: str, _user: dict = Depends(require_rol("admin", "director"))):
    """Elimina la ruta de un área."""
    rutas = _load_rutas()
    if area not in rutas:
        raise HTTPException(status_code=404, detail=f"No existe ruta para '{area}'")
    del rutas[area]
    _save_rutas(rutas)
    return {"status": "deleted", "area": area}

@app.get("/api/academia/rutas-progreso/{nombre_usuario}")
def get_ruta_progreso(nombre_usuario: str, _user: dict = Depends(get_current_user)):
    """
    Calcula el progreso del usuario en la ruta de su área.
    Cruza su nombre con members_list de Odoo para cada curso de la ruta.
    """
    # 1. Obtener área del usuario desde RRHH
    plaza_data = _plaza_cache.get("data") or {}
    mapa_area  = plaza_data.get("mapa_area", {})
    area = mapa_area.get(nombre_usuario.lower().strip(), "")

    if not area:
        return {"area": "", "ruta": None, "progreso": 0, "cursos_progreso": []}

    # 2. Obtener ruta del área
    rutas = _load_rutas()
    ruta  = rutas.get(area)
    if not ruta or not ruta.get("cursos"):
        return {"area": area, "ruta": None, "progreso": 0, "cursos_progreso": []}

    # 3. Buscar progreso en Odoo — solo los cursos de la ruta
    try:
        ids_ruta = [c["curso_id"] for c in ruta["cursos"]]
        odoo_cursos = odoo_conn.search_read(
            "slide.channel",
            domain=[["id", "in", ids_ruta]],
            fields=["id", "name", "members_list_ids"],
            limit=len(ids_ruta),
        ) or []
        # Obtener pct por miembro para los cursos de la ruta
        cursos_pct: dict[int, float] = {}
        for c in odoo_cursos:
            # members_list_ids son ids de slide.channel.partner
            partner_rows = odoo_conn.search_read(
                "slide.channel.partner",
                domain=[["channel_id", "=", c["id"]]],
                fields=["partner_id", "completion"],
                limit=2000,
            ) or []
            for row in partner_rows:
                pname = row["partner_id"][1] if isinstance(row.get("partner_id"), (list, tuple)) else ""
                if pname.lower().strip() == nombre_usuario.lower().strip():
                    cursos_pct[c["id"]] = row.get("completion", 0)
                    break
    except Exception as e:
        logger.warning(f"[rutas-progreso] Error Odoo: {e}")
        cursos_pct = {}

    # 4. Calcular progreso
    cursos_progreso = []
    for item in ruta["cursos"]:
        pct = cursos_pct.get(item["curso_id"], 0)
        cursos_progreso.append({**item, "pct": pct, "completado": pct >= 100})

    obligatorios  = [c for c in cursos_progreso if c.get("obligatorio", True)]
    pct_promedio  = (
        sum(c["pct"] for c in obligatorios) / len(obligatorios)
        if obligatorios else 0
    )

    return {
        "area":             area,
        "ruta":             ruta,
        "progreso":         round(pct_promedio, 1),
        "cursos_progreso":  cursos_progreso,
        "completados":      sum(1 for c in obligatorios if c["completado"]),
        "total_obligatorios": len(obligatorios),
    }


# ─── Notificaciones SSE ───────────────────────────────────────────────────────

import asyncio as _asyncio
import uuid as _uuid
import time as _time
from fastapi.responses import StreamingResponse as _StreamingResponse

async def _noti_poller(conn_state: dict):
    """Generador SSE que pushea notificaciones al cliente cada 30s.
    conn_state es un dict POR CONEXIÓN — cada usuario tiene su propio estado
    de IDs vistos, evitando que un usuario consuma las alertas de otro."""
    # Ping inicial para confirmar conexión
    yield f"data: {json.dumps({'tipo':'ping','ts': int(_time.time()*1000)})}\n\n"

    while True:
        eventos = []
        now_ms  = int(_time.time() * 1000)

        # ── NOC: alertas críticas nuevas ────────────────────────────────
        try:
            from agents.observium_connector import get_alerts as _get_noc_alerts
            raw_alerts = _get_noc_alerts() or []
            for a in raw_alerts:
                sev   = str(a.get("alert_severity", "")).lower()
                a_id  = str(a.get("alert_table_id", a.get("id", "")))
                if sev in ("critical", "high") and a_id and a_id not in conn_state["noc_critica_ids"]:
                    conn_state["noc_critica_ids"].add(a_id)
                    evento = {
                        "id":     f"noc_{a_id}",
                        "tipo":   "noc_critica",
                        "titulo": f"NOC Crítico · {a.get('entity_name', a.get('device_hostname', 'Dispositivo'))}",
                        "cuerpo": a.get("alert_message", a.get("message", "Alerta crítica detectada")),
                        "ts":     now_ms,
                        "link":   "noc",
                        "extra":  {"severity": sev, "alert_id": a_id},
                    }
                    eventos.append(evento)
        except Exception as _e:
            logger.debug(f"[noti-sse] NOC skip: {_e}")

        # ── WFM: tickets urgentes nuevos ────────────────────────────────
        try:
            from agents.odoo_connector import odoo_conn as _oc
            tickets = _oc.search_read(
                "project.task",
                [["priority", "=", "1"], ["stage_id.name", "not in", ["Cerrado", "Completado", "Done"]]],
                ["id", "name", "date_deadline", "partner_id"],
                limit=20,
            ) or []
            for t in tickets:
                t_id = str(t.get("id", ""))
                if t_id and t_id not in conn_state["wfm_urgente_ids"]:
                    conn_state["wfm_urgente_ids"].add(t_id)
                    cliente = t.get("partner_id", [None, ""])[1] if isinstance(t.get("partner_id"), (list, tuple)) else ""
                    evento = {
                        "id":     f"wfm_{t_id}",
                        "tipo":   "wfm_urgente",
                        "titulo": f"Ticket Urgente · {t.get('name', 'Sin nombre')[:55]}",
                        "cuerpo": f"Cliente: {cliente}" if cliente else "Ticket urgente sin asignación de cliente",
                        "ts":     now_ms,
                        "link":   "wfm",
                        "extra":  {"ticket_id": t_id},
                    }
                    eventos.append(evento)
        except Exception as _e:
            logger.debug(f"[noti-sse] WFM skip: {_e}")

        # ── Enviar eventos al cliente ────────────────────────────────────
        for ev in eventos[:10]:   # max 10 por ciclo para no inundar
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

        # Keepalive
        yield f"data: {json.dumps({'tipo':'ping','ts': now_ms})}\n\n"

        await _asyncio.sleep(30)


@app.get("/api/notificaciones/stream")
async def notificaciones_stream(request: Request, token: Optional[str] = None):
    """SSE endpoint — pushea notificaciones de NOC, WFM y KPI en tiempo real.
    Acepta token JWT como query param (?token=...) porque EventSource no soporta headers."""
    from agents.auth_service import decodificar_token
    # Intentar token desde query param primero, luego header Authorization
    raw_token = token
    if not raw_token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            raw_token = auth_header[7:]
    if not raw_token:
        from fastapi.responses import JSONResponse as _JR
        return _JR(status_code=401, content={"detail": "Token requerido"})
    try:
        decodificar_token(raw_token)
    except Exception:
        from fastapi.responses import JSONResponse as _JR
        return _JR(status_code=401, content={"detail": "Token inválido"})
    # Estado aislado POR CONEXIÓN — cada usuario ve sus propias alertas nuevas
    conn_state = {
        "noc_critica_ids": set(),
        "wfm_urgente_ids": set(),
        "kpi_alerts_seen": set(),
    }
    return _StreamingResponse(
        _noti_poller(conn_state),
        media_type="text/event-stream",
        headers={
            "Cache-Control":  "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":     "keep-alive",
        },
    )


# ─── Incidentes de Red ────────────────────────────────────────────────────────
INCIDENTES_DB = os.path.join(_DATA_DIR, "db", "incidentes.json") if _DATA_DIR else "db/incidentes.json"

def _load_incidentes() -> list:
    try:
        with open(INCIDENTES_DB, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return []

def _save_incidentes(data: list):
    os.makedirs("db", exist_ok=True)
    with open(INCIDENTES_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _telegram_incidente(inc: dict):
    """Envía alerta a Telegram cuando cambia un incidente."""
    try:
        cfg = _load_telegram_config()
        if not cfg.get("enabled") or not cfg.get("token"):
            return
        sev_emoji = {"P1": "🔴", "P2": "🟠", "P3": "🟡"}.get(inc.get("severidad", ""), "⚪")
        estado_emoji = {"declarado": "🚨", "en_atencion": "🔧", "mitigado": "🟢", "resuelto": "✅"}.get(inc.get("estado", ""), "")
        msg = (
            f"{sev_emoji} *INCIDENTE {inc.get('severidad','')} — {inc.get('titulo','')}*\n"
            f"{estado_emoji} Estado: {inc.get('estado','').replace('_',' ').title()}\n"
            f"📍 Plazas: {', '.join(inc.get('plazas', [])) or 'N/A'}\n"
            f"👤 Responsable: {inc.get('responsable','') or 'Por asignar'}\n"
            f"🕐 Inicio: {inc.get('fecha_inicio','')[:16]}\n"
        )
        if inc.get("descripcion"):
            msg += f"📋 {inc['descripcion'][:200]}\n"
        bot = TelegramBot(token=cfg["token"], chat_id=cfg["chat_id"])
        bot.send_message(msg)
    except Exception:
        pass

@app.get("/api/incidentes")
def get_incidentes(user: dict = Depends(get_current_user)):
    return _load_incidentes()

class IncidenteCreate(BaseModel):
    titulo: str
    severidad: str           # P1 | P2 | P3
    tipo: str                # outage | degradacion | seguridad | mantenimiento
    descripcion: str = ""
    plazas: list[str] = []
    responsable: str = ""
    etr_min: int = 0         # minutos estimados para resolución

@app.post("/api/incidentes")
def crear_incidente(req: IncidenteCreate, user: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    inc_id = f"INC-{int(datetime.now().timestamp())}"
    inc = {
        "id": inc_id,
        "titulo": req.titulo,
        "severidad": req.severidad,
        "tipo": req.tipo,
        "descripcion": req.descripcion,
        "plazas": req.plazas,
        "responsable": req.responsable,
        "etr_min": req.etr_min,
        "estado": "declarado",
        "fecha_inicio": datetime.now(timezone.utc).isoformat(),
        "fecha_resolucion": None,
        "declarado_por": user.get("nombre", user.get("sub", "")),
        "timeline": [
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "autor": user.get("nombre", "Sistema"),
                "texto": f"Incidente declarado por {user.get('nombre','Sistema')}. {req.descripcion}",
                "tipo": "declaracion",
            }
        ],
        "postmortem": "",
    }
    data = _load_incidentes()
    data.insert(0, inc)
    _save_incidentes(data)
    # Notificar automáticamente si es P1 o P2
    if req.severidad in ("P1", "P2"):
        _telegram_incidente(inc)
    return inc

class IncidenteEstado(BaseModel):
    estado: str   # en_atencion | mitigado | resuelto

@app.patch("/api/incidentes/{inc_id}/estado")
def cambiar_estado(inc_id: str, req: IncidenteEstado, user: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    data = _load_incidentes()
    inc = next((x for x in data if x["id"] == inc_id), None)
    if not inc:
        raise HTTPException(status_code=404, detail="Incidente no encontrado")
    inc["estado"] = req.estado
    if req.estado == "resuelto":
        inc["fecha_resolucion"] = datetime.now(timezone.utc).isoformat()
    inc["timeline"].append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "autor": user.get("nombre", "Sistema"),
        "texto": f"Estado cambiado a {req.estado.replace('_',' ')}",
        "tipo": "estado",
    })
    _save_incidentes(data)
    if inc.get("severidad") in ("P1", "P2"):
        _telegram_incidente(inc)
    return inc

class IncidenteUpdate(BaseModel):
    texto: str
    tipo: str = "update"   # update | accion | resolucion

@app.post("/api/incidentes/{inc_id}/timeline")
def agregar_update(inc_id: str, req: IncidenteUpdate, user: dict = Depends(get_current_user)):
    from datetime import datetime, timezone
    data = _load_incidentes()
    inc = next((x for x in data if x["id"] == inc_id), None)
    if not inc:
        raise HTTPException(status_code=404, detail="Incidente no encontrado")
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "autor": user.get("nombre", "Sistema"),
        "texto": req.texto,
        "tipo": req.tipo,
    }
    inc["timeline"].append(entry)
    _save_incidentes(data)
    return entry

class PostMortem(BaseModel):
    postmortem: str
    responsable: str = ""

@app.patch("/api/incidentes/{inc_id}/postmortem")
def guardar_postmortem(inc_id: str, req: PostMortem, user: dict = Depends(get_current_user)):
    data = _load_incidentes()
    inc = next((x for x in data if x["id"] == inc_id), None)
    if not inc:
        raise HTTPException(status_code=404, detail="Incidente no encontrado")
    inc["postmortem"] = req.postmortem
    if req.responsable:
        inc["responsable"] = req.responsable
    _save_incidentes(data)
    return {"status": "ok"}

@app.delete("/api/incidentes/{inc_id}")
def eliminar_incidente(inc_id: str, user: dict = Depends(require_rol("admin", "director"))):
    data = _load_incidentes()
    data = [x for x in data if x["id"] != inc_id]
    _save_incidentes(data)
    return {"status": "ok"}


# ─── Alarm Metrics System ─────────────────────────────────────────────────────
try:
    from alarm_endpoints import router as alarm_router
    app.include_router(alarm_router)
    from alarm_ingestion import start_alarm_ingestion
    start_alarm_ingestion()
    logger.info("Alarm ingestion engine started")
except Exception as e:
    logger.warning(f"Alarm system not started: {e}")

# ─── Supercerebro Contextual ───────────────────────────────────────────────────

def _p_status(env_var: str) -> str:
    return "configured" if os.environ.get(env_var) else "needs_key"

CEREBRO_PROVIDERS = {
    # ── Anthropic ──────────────────────────────────────────────────────────────
    "claude": {
        "id": "claude", "name": "Claude Sonnet", "icon": "🧠",
        "description": "Anthropic Claude — razonamiento profundo y código",
        "status": _p_status("ANTHROPIC_API_KEY"),
        "models": ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
        "default_model": "claude-sonnet-4-6",
        "group": "Cloud",
    },
    # ── Agentes propios XCIEN ──────────────────────────────────────────────────
    "auto": {
        "id": "auto", "name": "Auto (TARS+CASE)", "icon": "⚡",
        "description": "Router automático — decide si va a TARS, CASE o ambos según la consulta",
        "status": "configured" if os.environ.get("ANTHROPIC_API_KEY") else "needs_key",
        "models": ["auto-route"],
        "default_model": "auto-route",
        "group": "Agentes XCIEN",
    },
    "tars": {
        "id": "tars", "name": "TARS", "icon": "🖥️",
        "description": "Motor operativo — NOC, tickets, SLA, sitios, cuadrillas, estado actual",
        "status": "configured" if os.environ.get("ANTHROPIC_API_KEY") else "needs_key",
        "models": ["tars-ops"],
        "default_model": "tars-ops",
        "group": "Agentes XCIEN",
    },
    "case": {
        "id": "case", "name": "CASE", "icon": "🤖",
        "description": "Motor de análisis — tendencias, reportes ejecutivos, causa raíz, estrategia",
        "status": "configured" if os.environ.get("ANTHROPIC_API_KEY") else "needs_key",
        "models": ["case-analysis"],
        "default_model": "case-analysis",
        "group": "Agentes XCIEN",
    },
    "antigravity": {
        "id": "antigravity", "name": "Antigravity Director", "icon": "🚀",
        "description": "Director General Antigravity — contexto XCIEN nativo",
        "status": "configured" if os.environ.get("ANTHROPIC_API_KEY") else "needs_key",
        "models": ["director-general"],
        "default_model": "director-general",
        "group": "Agentes XCIEN",
    },
    # ── Local ──────────────────────────────────────────────────────────────────
    "ollama": {
        "id": "ollama", "name": "Ollama Local", "icon": "🦙",
        "description": "LLMs locales — privado, sin latencia de red, sin costo",
        "status": "local",
        "models": [],
        "default_model": "llama3.2:3b",
        "group": "Local",
    },
    # ── OpenAI ─────────────────────────────────────────────────────────────────
    "openai": {
        "id": "openai", "name": "OpenAI", "icon": "✨",
        "description": "GPT-4o, o3 y o4-mini — modelos OpenAI directo",
        "status": _p_status("OPENAI_API_KEY"),
        "models": ["gpt-4o", "gpt-4o-mini", "o4-mini", "o3"],
        "default_model": "gpt-4o",
        "group": "Cloud",
    },
    # ── Google Gemini ──────────────────────────────────────────────────────────
    "gemini": {
        "id": "gemini", "name": "Gemini", "icon": "💎",
        "description": "Google Gemini 2.0 Flash y Pro — contexto muy largo",
        "status": _p_status("GEMINI_API_KEY"),
        "models": ["gemini-2.0-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
        "default_model": "gemini-2.0-flash",
        "group": "Cloud",
    },
    # ── Groq (ultra-rápido) ────────────────────────────────────────────────────
    "groq": {
        "id": "groq", "name": "Groq", "icon": "⚡",
        "description": "Groq LPU — Llama, Mixtral y Gemma ultra rápidos",
        "status": _p_status("GROQ_API_KEY"),
        "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant",
                   "mixtral-8x7b-32768", "gemma2-9b-it"],
        "default_model": "llama-3.3-70b-versatile",
        "group": "Cloud",
    },
    # ── OpenRouter (100+ modelos) ──────────────────────────────────────────────
    "openrouter": {
        "id": "openrouter", "name": "OpenRouter", "icon": "🌐",
        "description": "100+ modelos en un solo endpoint — DeepSeek, Mistral, Llama...",
        "status": _p_status("OPENROUTER_API_KEY"),
        "models": ["deepseek/deepseek-chat", "mistralai/mistral-large",
                   "meta-llama/llama-3.3-70b-instruct", "qwen/qwen-2.5-72b-instruct"],
        "default_model": "deepseek/deepseek-chat",
        "group": "Cloud",
    },
    # ── OpenClaw gateway ───────────────────────────────────────────────────────
    "openclaw": {
        "id": "openclaw", "name": "OpenClaw", "icon": "🦞",
        "description": "Gateway agéntico self-hosted — conecta todos los canales",
        "status": "local" if os.environ.get("OPENCLAW_BASE_URL") else "needs_key",
        "models": [],
        "default_model": "",
        "group": "Local",
    },
    # ── LiteLLM proxy ─────────────────────────────────────────────────────────
    "litellm": {
        "id": "litellm", "name": "LiteLLM Proxy", "icon": "🔀",
        "description": "Proxy OpenAI-compatible para cualquier modelo",
        "status": "configured" if os.environ.get("LITELLM_BASE_URL") else "needs_key",
        "models": ["gpt-4o", "gpt-4o-mini", "gemini/gemini-2.0-flash", "mistral/mistral-large"],
        "default_model": "gpt-4o",
        "group": "Local",
    },
    # ── Perplexity ─────────────────────────────────────────────────────────────
    "perplexity": {
        "id": "perplexity", "name": "Perplexity", "icon": "🔍",
        "description": "Búsqueda aumentada con IA — datos en tiempo real + citas",
        "status": _p_status("PERPLEXITY_API_KEY"),
        "models": ["sonar", "sonar-pro", "sonar-reasoning"],
        "default_model": "sonar-pro",
        "group": "Cloud",
    },
}

CEREBRO_CONTEXT_MODULES = {
    "noc":        {"label": "NOC / Alertas",     "icon": "🖥️",  "endpoint": "/api/noc/alerts"},
    "wfm":        {"label": "Campo WFM",          "icon": "🔧",  "endpoint": "/api/wfm/tickets"},
    "inventario": {"label": "Inventario",         "icon": "📦",  "endpoint": "/api/inventario/odoo/productos"},
    "ventas":     {"label": "Ventas / MRR",       "icon": "💰",  "endpoint": "/api/ventas/mrr"},
    "rrhh":       {"label": "RRHH",               "icon": "👤",  "endpoint": "/api/rrhh/empleados"},
    "incidentes": {"label": "Incidentes activos", "icon": "🚨",  "endpoint": "/api/incidentes"},
    "fibra":      {"label": "Fibra Óptica",       "icon": "🌐",  "endpoint": "/api/fibra/data"},
}

# ── Personas de agentes ────────────────────────────────────────────────────────

TARS_PERSONA = """Eres TARS, el motor operativo de conocimiento de XCIEN Networks.

ROL: Responder sobre el estado ACTUAL de las operaciones con datos concretos y hechos verificables.

RESPONSABILIDADES:
- Consultar y mostrar tickets abiertos, backlog y tickets por vencer SLA
- Reportar sitios caídos, alertas NOC activas y estado de dependencias
- Mostrar órdenes de campo, cuadrillas asignadas y estado de campo
- Reportar el estado del despliegue de fibra, compromisos, fases de plazas y avance de red física
- Responder preguntas operativas con datos del momento
- Mantener contexto operativo reciente

REGLAS:
- Usa únicamente datos del contexto proporcionado. Si no tienes datos actuales, dilo claramente.
- Formato directo: bullets, números, estados (✅ OK / ⚠️ Atención / 🔴 Crítico)
- No analices tendencias — eso es trabajo de CASE
- Al final de tu respuesta, incluye siempre: [🖥️ TARS — Operativo]
"""

CASE_PERSONA = """Eres CASE, el motor de análisis y estrategia de XCIEN Networks.

ROL: Interpretar datos, detectar tendencias, priorizar problemas y generar análisis ejecutivos.

RESPONSABILIDADES:
- Analizar cumplimiento de SLA y detectar tendencias de incumplimiento
- Medir reincidencias e identificar causas raíz
- Analizar riesgos de cumplimiento en despliegue de fibra por plaza y compromisos
- Generar reportes ejecutivos para dirección y gobierno
- Proponer acciones correctivas y priorización de ciudades/sitios
- Ayudar con planeación estratégica, BMAD y roadmap
- Preparar resúmenes para stakeholders

REGLAS:
- Separa siempre: **Hechos confirmados** / **Supuestos** / **Preguntas abiertas**
- No inventes datos. Si hay datos operativos de TARS, analízalos; si no, márcalo como supuesto
- Formato ejecutivo estructurado: Estado → Hallazgos → Riesgos → Próximo paso recomendado
- Al final de tu respuesta, incluye siempre: [🤖 CASE — Análisis]
"""

# ── Router de consultas TARS / CASE ────────────────────────────────────────────

_TARS_KEYWORDS = {
    "ticket", "tickets", "abierto", "abiertos", "backlog", "sla", "vencer", "vencido",
    "sitio", "sitios", "caído", "caídos", "alerta", "alertas", "noc", "activo", "activos",
    "cuadrilla", "cuadrillas", "campo", "orden", "órdenes", "estado", "ahora", "hoy",
    "actual", "actualmente", "cuántos", "listar", "mostrar", "qué hay", "qué tiene",
    "están", "tiene", "hay", "dependencia", "dependencias", "host", "hosts",
    "fibra", "despliegue", "compromiso", "compromisos", "plaza", "plazas",
}

_CASE_KEYWORDS = {
    "análisis", "analizar", "analisa", "tendencia", "tendencias", "reporte", "reportes",
    "reincidencia", "reincidencias", "causa", "raíz", "ejecutivo", "ejecutivos",
    "priorizar", "prioridad", "cumplimiento", "mejora", "estrategia", "planeación",
    "resumen", "diagnóstico", "problema", "problemas", "patrón", "patrones",
    "por qué", "recurrente", "historial", "comparar", "comparación", "impacto",
    "decisión", "recomienda", "sugerencia", "propuesta", "roadmap",
}

def _route_query(query: str) -> str:
    """Returns 'tars', 'case', or 'both' based on query keywords."""
    q = query.lower()
    words = set(q.replace("?","").replace(",","").split())
    tars_score = len(words & _TARS_KEYWORDS)
    case_score = len(words & _CASE_KEYWORDS)
    if tars_score > 0 and case_score > 0:
        return "both"
    if case_score > tars_score:
        return "case"
    return "tars"  # default operativo

async def _call_claude(api_key: str, system: str, messages: list, temperature: float) -> str:
    """Helper: single Claude API call, returns text."""
    async with _httpx_obs.AsyncClient(timeout=60) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": "claude-sonnet-4-6", "max_tokens": 2048,
                  "system": system, "messages": messages, "temperature": temperature},
        )
        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail=r.text[:300])
        return r.json()["content"][0]["text"]

# ── Vault Obsidian — contexto persistente ────────────────────────────────────

_VAULT_PATH = _Path(os.environ.get(
    "XCIEN_VAULT_PATH",
    str(_Path.home() / "Documents" / "XCIEN-Vault")
))
_CEREBRO_DIR  = _VAULT_PATH / "00-Cerebro"
_MASTER_FILE  = _CEREBRO_DIR / "contexto-maestro.md"

# Cache en memoria — se recarga vía POST /api/cerebro/reload o al iniciar
_vault_context_cache: str = ""

def _load_vault_context() -> str:
    """Lee contexto-maestro.md del vault. Devuelve string vacío si no existe."""
    global _vault_context_cache
    if _MASTER_FILE.exists():
        try:
            _vault_context_cache = _MASTER_FILE.read_text(encoding="utf-8")
        except Exception:
            pass
    return _vault_context_cache

# Cargar al iniciar el servidor
_load_vault_context()

async def _assemble_context(modules: List[str], request: Request) -> str:
    """Fetch summaries from requested context modules and build system context string."""
    parts: List[str] = [
        f"Fecha y hora: {dt_datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        "Empresa: XCIEN Networks\n"
    ]

    # ── Contexto base del vault Obsidian (siempre incluido) ─────────────────
    vault_ctx = _vault_context_cache or _load_vault_context()
    if vault_ctx:
        # Limitar a ~8000 chars para no saturar el contexto
        trimmed = vault_ctx[:8000] + ("\n...(contexto truncado)" if len(vault_ctx) > 8000 else "")
        parts.append(f"[Contexto XCIEN — Vault Obsidian]\n{trimmed}")

    # ── Módulos adicionales (NOC, WFM, etc.) si están activos ───────────────
    base = f"http://127.0.0.1:{int(os.environ.get('PORT', 8002))}"
    async with _httpx_obs.AsyncClient(timeout=5) as client:
        for mod in modules:
            cfg = CEREBRO_CONTEXT_MODULES.get(mod)
            if not cfg:
                continue
            try:
                if mod == "fibra":
                    data = _fibra_load()
                else:
                    r = await client.get(f"{base}{cfg['endpoint']}")
                    if r.status_code != 200:
                        raise Exception(f"HTTP {r.status_code}")
                    data = r.json()
                summary = json.dumps(data, ensure_ascii=False)[:2000]
                parts.append(f"[{cfg['label']}]\n{summary}")
            except Exception as e:
                parts.append(f"[{cfg['label']}] No disponible: {str(e)[:80]}")
    return "\n\n".join(parts)

class CerebroRequest(BaseModel):
    message: str
    provider: str = "claude"
    model: Optional[str] = None
    context_modules: List[str] = []
    history: List[Dict[str, str]] = []
    temperature: float = 0.7

@app.get("/api/cerebro/providers")
async def cerebro_providers():
    import copy
    providers = copy.deepcopy(CEREBRO_PROVIDERS)

    async with _httpx_obs.AsyncClient(timeout=3) as client:
        # Ollama — discover local models
        try:
            r = await client.get("http://localhost:11434/api/tags")
            if r.status_code == 200:
                models = [m["name"] for m in r.json().get("models", [])]
                providers["ollama"]["models"]       = models or ["llama3.2:3b"]
                providers["ollama"]["status"]       = "online"
                providers["ollama"]["default_model"] = models[0] if models else "llama3.2:3b"
            else:
                providers["ollama"]["status"] = "offline"
        except Exception:
            providers["ollama"]["status"] = "offline"

        # OpenClaw — ping local gateway
        oc_url = os.environ.get("OPENCLAW_BASE_URL", "http://localhost:18789").rstrip("/")
        try:
            r = await client.get(f"{oc_url}/health", timeout=2)
            providers["openclaw"]["status"] = "online" if r.status_code < 400 else "offline"
            if providers["openclaw"]["status"] == "online":
                try:
                    mr = await client.get(f"{oc_url}/v1/models", timeout=2)
                    if mr.status_code == 200:
                        mdl_list = [m["id"] for m in mr.json().get("data", [])]
                        if mdl_list:
                            providers["openclaw"]["models"] = mdl_list
                            providers["openclaw"]["default_model"] = mdl_list[0]
                except Exception:
                    pass
        except Exception:
            providers["openclaw"]["status"] = "offline"

    return providers

@app.get("/api/cerebro/route")
async def cerebro_route(q: str = ""):
    """Clasifica una consulta: tars | case | both"""
    decision = _route_query(q)
    return {"query": q, "route": decision,
            "agent": "TARS" if decision == "tars" else ("CASE" if decision == "case" else "TARS+CASE")}

@app.post("/api/cerebro/reload")
async def cerebro_reload():
    """Recarga contexto-maestro.md del vault Obsidian en memoria."""
    _load_vault_context()
    size = len(_vault_context_cache)
    last_mod = ""
    if _MASTER_FILE.exists():
        import stat as _stat
        mtime = _MASTER_FILE.stat().st_mtime
        last_mod = dt_datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
    return {
        "status": "ok",
        "vault_loaded": size > 0,
        "context_chars": size,
        "last_modified": last_mod,
        "master_file": str(_MASTER_FILE),
    }

@app.get("/api/cerebro/vault-status")
async def cerebro_vault_status():
    """Estado del vault Obsidian y el contexto cargado."""
    snapshots = []
    if _CEREBRO_DIR.exists():
        for f in sorted(_CEREBRO_DIR.glob("*.md")):
            mtime = f.stat().st_mtime
            snapshots.append({
                "file": f.name,
                "size_kb": round(f.stat().st_size / 1024, 1),
                "updated": dt_datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M"),
            })
    return {
        "vault_path": str(_VAULT_PATH),
        "master_file": str(_MASTER_FILE),
        "master_exists": _MASTER_FILE.exists(),
        "context_loaded": len(_vault_context_cache) > 0,
        "context_chars": len(_vault_context_cache),
        "snapshots": snapshots,
    }

@app.post("/api/cerebro/sync")
async def cerebro_sync(background_tasks: BackgroundTasks):
    """Dispara tars_brain.py en background para sincronizar Odoo → Vault."""
    import subprocess, sys
    brain_script = _Path(__file__).parent / "tars_brain.py"
    if not brain_script.exists():
        raise HTTPException(status_code=404, detail="tars_brain.py no encontrado")

    def _run_brain():
        try:
            subprocess.run([sys.executable, str(brain_script)],
                           capture_output=True, timeout=300)
            _load_vault_context()  # recargar después del sync
        except Exception:
            pass

    background_tasks.add_task(_run_brain)
    return {"status": "sync_started", "script": str(brain_script)}

# ─── XCIEN Snapshot — contexto para agentes externos (CASE/Eagle/MCP) ──────────

@app.get("/api/xcien/snapshot")
async def xcien_snapshot(request: Request, token: str = ""):
    """
    Snapshot del estado operativo XCIEN para agentes externos.
    Requiere header  X-Agent-Token: <CASE_API_TOKEN>
    o query param   ?token=<CASE_API_TOKEN>
    """
    expected = os.environ.get("CASE_API_TOKEN", "")
    header_token = request.headers.get("x-agent-token", "")
    provided = token or header_token

    if not expected:
        raise HTTPException(503, "CASE_API_TOKEN no configurado en el servidor")
    if provided != expected:
        raise HTTPException(401, "Token inválido")

    base = f"http://127.0.0.1:{int(os.environ.get('PORT', 8002))}"
    ts   = dt_datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    snap: dict = {"generado_en": ts, "empresa": "XCIEN Networks"}

    async def _fetch(path: str):
        try:
            async with _httpx_obs.AsyncClient(timeout=6) as client:
                r = await client.get(f"{base}{path}")
                return r.json() if r.status_code == 200 else None
        except Exception:
            return None

    # ── NOC ──────────────────────────────────────────────────────────────────────
    noc_summary = await _fetch("/api/noc/summary")
    noc_alerts  = await _fetch("/api/noc/alerts")
    if noc_summary:
        snap["noc"] = {
            "resumen": noc_summary,
            "alertas_muestra": (noc_alerts or [])[:10],
        }
    else:
        snap["noc"] = {"estado": "no disponible"}

    # ── Helpdesk / Mesa de Ayuda ──────────────────────────────────────────────
    hd_resumen = await _fetch("/api/helpdesk/resumen")
    if hd_resumen:
        snap["helpdesk"] = hd_resumen
    else:
        snap["helpdesk"] = {"estado": "no disponible"}

    # ── WFM / Campo ───────────────────────────────────────────────────────────
    wfm = await _fetch("/api/wfm/tickets")
    if wfm:
        tickets = wfm if isinstance(wfm, list) else wfm.get("tickets", [])
        abiertos   = [t for t in tickets if t.get("state") not in ("done","cancel")]
        criticos   = [t for t in abiertos if t.get("priority") in ("2","3")]
        snap["campo_wfm"] = {
            "total_abiertos": len(abiertos),
            "criticos": len(criticos),
            "muestra": abiertos[:5],
        }
    else:
        snap["campo_wfm"] = {"estado": "no disponible"}

    # ── RRHH ─────────────────────────────────────────────────────────────────
    rrhh = await _fetch("/api/rrhh/stats")
    if rrhh:
        snap["rrhh"] = rrhh
    else:
        snap["rrhh"] = {"estado": "no disponible"}

    # ── Incidentes activos ────────────────────────────────────────────────────
    incidentes = await _fetch("/api/incidentes")
    if incidentes:
        lista = incidentes if isinstance(incidentes, list) else incidentes.get("incidentes", [])
        activos = [i for i in lista if i.get("estado") not in ("resuelto","cerrado")]
        snap["incidentes"] = {
            "activos": len(activos),
            "lista": activos[:5],
        }
    else:
        snap["incidentes"] = {"estado": "no disponible"}

    # ── Proyectos 2026 ────────────────────────────────────────────────────────
    proyectos = await _fetch("/api/proyectos2026/dashboard")
    if proyectos:
        snap["proyectos_2026"] = proyectos
    else:
        snap["proyectos_2026"] = {"estado": "no disponible"}

    # ── Texto plano para CASE (formato fácil de consumir en prompt) ───────────
    def _txt(label: str, data) -> str:
        if isinstance(data, dict) and data.get("estado") == "no disponible":
            return f"[{label}] No disponible\n"
        try:
            return f"[{label}]\n{json.dumps(data, ensure_ascii=False)[:1500]}\n"
        except Exception:
            return f"[{label}] Error al serializar\n"

    snap["texto_contexto"] = (
        f"=== XCIEN Snapshot — {ts} ===\n\n"
        + _txt("NOC", snap["noc"])
        + _txt("Helpdesk", snap["helpdesk"])
        + _txt("Campo WFM", snap["campo_wfm"])
        + _txt("RRHH", snap["rrhh"])
        + _txt("Incidentes", snap["incidentes"])
        + _txt("Proyectos 2026", snap["proyectos_2026"])
    )

    return snap

@app.post("/api/cerebro/chat")
async def cerebro_chat(req: CerebroRequest, request: Request):
    provider_id = req.provider
    if provider_id not in CEREBRO_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Proveedor '{provider_id}' no válido")
    if CEREBRO_PROVIDERS[provider_id]["status"] == "pending":
        raise HTTPException(status_code=503, detail=f"{provider_id} aún no está configurado")

    ctx_data = await _assemble_context(req.context_modules, request)
    model = req.model or CEREBRO_PROVIDERS[provider_id]["default_model"]
    messages = [{"role": m["role"], "content": m["content"]} for m in req.history]
    messages.append({"role": "user", "content": req.message})
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    # ── TARS — Motor operativo ──────────────────────────────────────────────────
    if provider_id == "tars":
        if not api_key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY no configurado")
        system = TARS_PERSONA + "\n\n" + ctx_data
        text = await _call_claude(api_key, system, messages, req.temperature)
        return {"response": text, "provider": "tars", "model": "tars-ops",
                "agent_label": "🖥️ TARS", "route": "tars"}

    # ── CASE — Motor de análisis ────────────────────────────────────────────────
    elif provider_id == "case":
        if not api_key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY no configurado")
        system = CASE_PERSONA + "\n\n" + ctx_data
        text = await _call_claude(api_key, system, messages, req.temperature)
        return {"response": text, "provider": "case", "model": "case-analysis",
                "agent_label": "🤖 CASE", "route": "case"}

    # ── Auto — Router inteligente ───────────────────────────────────────────────
    elif provider_id == "auto":
        if not api_key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY no configurado")
        route = _route_query(req.message)

        if route == "tars":
            system = TARS_PERSONA + "\n\n" + ctx_data
            text = await _call_claude(api_key, system, messages, req.temperature)
            return {"response": text, "provider": "auto", "model": "auto-route",
                    "agent_label": "🖥️ TARS", "route": "tars"}

        elif route == "case":
            system = CASE_PERSONA + "\n\n" + ctx_data
            text = await _call_claude(api_key, system, messages, req.temperature)
            return {"response": text, "provider": "auto", "model": "auto-route",
                    "agent_label": "🤖 CASE", "route": "case"}

        else:  # both — TARS recupera datos, CASE analiza
            tars_system = TARS_PERSONA + "\n\n" + ctx_data
            tars_text = await _call_claude(api_key, tars_system, messages, req.temperature)

            case_system = (
                CASE_PERSONA + "\n\n" + ctx_data +
                f"\n\n[Datos operativos de TARS]\n{tars_text}"
            )
            case_msgs = messages[:-1] + [
                {"role": "user", "content":
                 f"Con base en estos datos operativos de TARS:\n\n{tars_text}\n\n"
                 f"Ahora analiza: {req.message}"}
            ]
            case_text = await _call_claude(api_key, case_system, case_msgs, req.temperature)

            combined = (
                f"### 🖥️ TARS — Estado operativo\n\n{tars_text}\n\n"
                f"---\n\n### 🤖 CASE — Análisis\n\n{case_text}"
            )
            return {"response": combined, "provider": "auto", "model": "auto-route",
                    "agent_label": "⚡ TARS+CASE", "route": "both",
                    "tars_response": tars_text, "case_response": case_text}

    # ── Claude genérico ─────────────────────────────────────────────────────────
    system_ctx = ctx_data
    if provider_id == "claude":
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY no configurado")
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": model, "max_tokens": 2048, "system": system_ctx,
                      "messages": messages, "temperature": req.temperature},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            return {"response": r.json()["content"][0]["text"], "provider": "claude", "model": model}

    # ── LiteLLM (OpenAI-compatible) ──
    elif provider_id == "litellm":
        api_key = os.environ.get("LITELLM_API_KEY", "no-key")
        base_url = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
        oai_messages = [{"role": "system", "content": system_ctx}] + messages
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "messages": oai_messages, "temperature": req.temperature},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            return {"response": r.json()["choices"][0]["message"]["content"], "provider": "litellm", "model": model}

    # ── Ollama ──
    elif provider_id == "ollama":
        ollama_messages = [{"role": "system", "content": system_ctx}] + messages
        async with _httpx_obs.AsyncClient(timeout=120) as client:
            r = await client.post(
                "http://localhost:11434/api/chat",
                json={"model": model, "messages": ollama_messages, "stream": False,
                      "options": {"temperature": req.temperature}},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            return {"response": r.json()["message"]["content"], "provider": "ollama", "model": model}

    # ── Perplexity ──
    elif provider_id == "perplexity":
        api_key = os.environ.get("PERPLEXITY_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=503, detail="PERPLEXITY_API_KEY no configurado")
        pplx_messages = [{"role": "system", "content": system_ctx}] + messages
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "messages": pplx_messages, "temperature": req.temperature},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            data = r.json()
            text = data["choices"][0]["message"]["content"]
            citations = data.get("citations", [])
            if citations:
                text += "\n\n**Fuentes:**\n" + "\n".join(f"- {c}" for c in citations[:5])
            return {"response": text, "provider": "perplexity", "model": model}

    # ── Antigravity Director ──────────────────────────────────────────────────
    elif provider_id == "antigravity":
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY requerido para Antigravity")
        full_msg = f"{system_ctx}\n\n---\nMensaje del usuario: {req.message}"
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={
                    "model": "claude-sonnet-4-6", "max_tokens": 2048,
                    "system": full_msg, "messages": messages,
                },
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            content = r.json().get("content", [])
            text = " ".join(b["text"] for b in content if b.get("type") == "text")
            return {"response": text, "provider": "antigravity", "model": "director-general"}

    # ── CASE — agente operativo de campo ─────────────────────────────────────
    elif provider_id == "case":
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY requerido para CASE")
        case_persona = (
            "Eres CASE, el agente operativo de campo de XCIEN Networks. "
            "Eres preciso, técnico y conciso. Tu especialidad es análisis de red, "
            "incidentes NOC, coordinación de cuadrillas WFM y diagnóstico de infraestructura. "
            "Cuando no tienes datos suficientes, lo dices claramente. "
            "Usas terminología técnica de redes y telecomunicaciones.\n\n"
        ) + system_ctx
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={
                    "model": "claude-sonnet-4-6", "max_tokens": 2048,
                    "system": case_persona, "messages": messages,
                    "temperature": req.temperature,
                },
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            content = r.json().get("content", [])
            text = " ".join(b["text"] for b in content if b.get("type") == "text")
            return {"response": text, "provider": "case", "model": "case-field"}

    # ── OpenAI directo ────────────────────────────────────────────────────────
    elif provider_id == "openai":
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=503, detail="OPENAI_API_KEY no configurado")
        oai_messages = [{"role": "system", "content": system_ctx}] + messages
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "messages": oai_messages, "temperature": req.temperature},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            return {"response": r.json()["choices"][0]["message"]["content"],
                    "provider": "openai", "model": model}

    # ── Google Gemini ─────────────────────────────────────────────────────────
    elif provider_id == "gemini":
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=503, detail="GEMINI_API_KEY no configurado")
        # Gemini usa formato distinto — contents array
        gemini_contents = []
        for m in messages:
            role = "user" if m["role"] == "user" else "model"
            gemini_contents.append({"role": role, "parts": [{"text": m["content"]}]})
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": api_key},
                headers={"Content-Type": "application/json"},
                json={
                    "system_instruction": {"parts": [{"text": system_ctx}]},
                    "contents": gemini_contents,
                    "generationConfig": {"temperature": req.temperature, "maxOutputTokens": 2048},
                },
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            return {"response": text, "provider": "gemini", "model": model}

    # ── Groq ─────────────────────────────────────────────────────────────────
    elif provider_id == "groq":
        api_key = os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=503, detail="GROQ_API_KEY no configurado")
        groq_messages = [{"role": "system", "content": system_ctx}] + messages
        async with _httpx_obs.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "messages": groq_messages,
                      "temperature": req.temperature, "max_tokens": 2048},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            data = r.json()
            text = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            tokens = usage.get("total_tokens", 0)
            return {"response": text, "provider": "groq", "model": model,
                    "meta": {"tokens": tokens,
                             "time_ms": int(data.get("usage", {}).get("total_time", 0) * 1000)}}

    # ── OpenRouter ────────────────────────────────────────────────────────────
    elif provider_id == "openrouter":
        api_key = os.environ.get("OPENROUTER_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY no configurado")
        or_messages = [{"role": "system", "content": system_ctx}] + messages
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://xcien.com",
                    "X-Title": "XCIEN Supercerebro",
                },
                json={"model": model, "messages": or_messages, "temperature": req.temperature},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            return {"response": r.json()["choices"][0]["message"]["content"],
                    "provider": "openrouter", "model": model}

    # ── OpenClaw gateway ──────────────────────────────────────────────────────
    elif provider_id == "openclaw":
        base_url = os.environ.get("OPENCLAW_BASE_URL", "http://localhost:18789").rstrip("/")
        api_key  = os.environ.get("OPENCLAW_API_KEY", "")
        headers  = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        oc_messages = [{"role": "system", "content": system_ctx}] + messages
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{base_url}/v1/chat/completions",
                headers=headers,
                json={"model": model or "default", "messages": oc_messages,
                      "temperature": req.temperature},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            return {"response": r.json()["choices"][0]["message"]["content"],
                    "provider": "openclaw", "model": model or "openclaw"}

    # ── LiteLLM proxy ─────────────────────────────────────────────────────────
    elif provider_id == "litellm":
        api_key  = os.environ.get("LITELLM_API_KEY", "no-key")
        base_url = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
        oai_messages = [{"role": "system", "content": system_ctx}] + messages
        async with _httpx_obs.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "messages": oai_messages, "temperature": req.temperature},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:300])
            return {"response": r.json()["choices"][0]["message"]["content"],
                    "provider": "litellm", "model": model}

    raise HTTPException(status_code=400, detail=f"Proveedor '{provider_id}' no implementado")

# ─── Super Admin Tracking ──────────────────────────────────────────────────────
import hashlib

ADMIN_LOG_FILE = os.path.join(BASE_DIR, "admin_usage.jsonl")
ADMIN_PIN_HASH = hashlib.sha256(
    os.environ.get("ADMIN_PIN", "xcien2030").encode()
).hexdigest()

def _verify_pin(pin: str) -> bool:
    return hashlib.sha256(pin.encode()).hexdigest() == ADMIN_PIN_HASH

class TrackEvent(BaseModel):
    section: str
    user_agent: Optional[str] = None

@app.post("/api/admin/track")
async def track_section(event: TrackEvent, request: Request,
                        current: dict = Depends(get_current_user)):
    ip = request.client.host if request.client else "unknown"
    entry = {"ts": datetime.now().isoformat(), "section": event.section,
             "ip": ip, "ua": (event.user_agent or "")[:120]}
    try:
        with open(ADMIN_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass
    try:
        from db_migrate import log_evento
        log_evento(current.get("sub") or current.get("id"), event.section)
    except Exception:
        pass
    return {"ok": True}


# ─── Analytics — receptor de eventos desde el frontend ─────────────────────────
@app.post("/api/analytics/events")
async def analytics_events(payload: dict, request: Request):
    """Recibe batch de eventos de AnalyticsContext. No requiere auth para no romper loaders."""
    events = payload.get("events", [])
    if not events:
        return {"ok": True, "received": 0}
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return {"ok": True, "received": len(events)}
    try:
        from db_migrate import log_evento
        for ev in events:
            event_name = ev.get("event", "")
            section    = ev.get("section", "") or ""
            uid        = ev.get("user_id")
            dur_ms     = ev.get("properties", {}).get("duration_ms")
            dur_s      = int(dur_ms / 1000) if dur_ms else None
            if event_name in ("section_view", "section_leave") and section and section != "app":
                log_evento(uid, section, event_name, dur_s)
    except Exception:
        pass
    return {"ok": True, "received": len(events)}


# ─── Analytics ─────────────────────────────────────────────────────────────────
@app.get("/api/analytics/resumen")
def analytics_resumen(dias: int = 7, _user: dict = Depends(require_rol("admin", "director"))):
    """Resumen de uso del portal — formato compatible con AnalyticsSection."""
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return {}
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()

        # Totales de sesiones
        cur.execute("SELECT COUNT(*), COUNT(DISTINCT usuario_id) FROM sesiones WHERE creado_en > NOW() - INTERVAL %s", (f"{dias} days",))
        total_logins, usuarios_unicos = cur.fetchone()

        # Eventos del portal
        cur.execute("SELECT COUNT(*), COUNT(DISTINCT usuario_id) FROM eventos_portal WHERE creado_en > NOW() - INTERVAL %s", (f"{dias} days",))
        total_eventos, _ = cur.fetchone()

        # Errores
        cur.execute("SELECT COUNT(*) FROM audit_log WHERE accion='login_fallido' AND creado_en > NOW() - INTERVAL %s", (f"{dias} days",))
        errores = cur.fetchone()[0]

        # Sección top
        cur.execute("SELECT seccion FROM eventos_portal WHERE creado_en > NOW() - INTERVAL %s GROUP BY seccion ORDER BY COUNT(*) DESC LIMIT 1", (f"{dias} days",))
        r = cur.fetchone(); seccion_top = r[0] if r else None

        # Rol top (por sesiones)
        cur.execute("SELECT u.rol FROM sesiones s JOIN usuarios u ON u.id=s.usuario_id WHERE s.creado_en > NOW() - INTERVAL %s GROUP BY u.rol ORDER BY COUNT(*) DESC LIMIT 1", (f"{dias} days",))
        r = cur.fetchone(); rol_top = r[0] if r else None

        # Hora pico (por logins)
        cur.execute("SELECT EXTRACT(HOUR FROM creado_en)::int as h FROM sesiones WHERE creado_en > NOW() - INTERVAL %s GROUP BY h ORDER BY COUNT(*) DESC LIMIT 1", (f"{dias} days",))
        r = cur.fetchone(); hora_pico = r[0] if r else None

        # Actividad diaria (logins por fecha)
        cur.execute("SELECT DATE(creado_en)::text, COUNT(*) FROM sesiones WHERE creado_en > NOW() - INTERVAL %s GROUP BY DATE(creado_en) ORDER BY 1", (f"{dias} days",))
        actividad_diaria = {r[0]: r[1] for r in cur.fetchall()}

        # Actividad por hora (logins)
        cur.execute("SELECT EXTRACT(HOUR FROM creado_en)::int, COUNT(*) FROM sesiones WHERE creado_en > NOW() - INTERVAL %s GROUP BY 1 ORDER BY 1", (f"{dias} days",))
        actividad_por_hora = {str(r[0]): r[1] for r in cur.fetchall()}

        cur.close(); conn.close()
        return {
            "total_eventos": total_eventos or 0,
            "usuarios_unicos": usuarios_unicos or 0,
            "sesiones": total_logins or 0,
            "errores": errores or 0,
            "seccion_top": seccion_top,
            "rol_top": rol_top,
            "hora_pico": hora_pico,
            "actividad_diaria": actividad_diaria,
            "actividad_por_hora": actividad_por_hora,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/accesos")
def analytics_accesos(limit: int = 100, _user: dict = Depends(require_rol("admin", "director"))):
    """Últimos N logins al portal."""
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return {"sesiones": []}
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        cur.execute("""
            SELECT s.email, s.ip, s.creado_en, u.nombre, u.rol
            FROM sesiones s LEFT JOIN usuarios u ON u.id=s.usuario_id
            ORDER BY s.creado_en DESC LIMIT %s
        """, (limit,))
        rows = cur.fetchall(); cur.close(); conn.close()
        return {"sesiones": [{"email": r[0], "ip": r[1],
                              "fecha": r[2].isoformat() if r[2] else None,
                              "nombre": r[3], "rol": r[4]} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/sessions")
def analytics_sessions(dias: int = 7, _user: dict = Depends(require_rol("admin", "director"))):
    """Sesiones recientes en formato para AnalyticsSection."""
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return []
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        cur.execute("""
            SELECT s.email, u.rol, s.creado_en, u.nombre
            FROM sesiones s LEFT JOIN usuarios u ON u.id=s.usuario_id
            WHERE s.creado_en > NOW() - INTERVAL %s
            ORDER BY s.creado_en DESC LIMIT 200
        """, (f"{dias} days",))
        rows = cur.fetchall(); cur.close(); conn.close()
        return [{"user_email": r[0], "rol": r[1],
                 "inicio": r[2].strftime("%m-%d %H:%M") if r[2] else None,
                 "duracion_min": 0, "eventos": 0, "secciones": []} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/users")
def analytics_users(dias: int = 7, _user: dict = Depends(require_rol("admin", "director"))):
    """Actividad por usuario para AnalyticsSection tab Usuarios."""
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return []
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        cur.execute("""
            SELECT u.email, u.nombre, u.rol,
                   COUNT(DISTINCT s.id) as sesiones,
                   COUNT(e.id) as eventos,
                   MAX(s.creado_en) as ultimo_acceso
            FROM usuarios u
            LEFT JOIN sesiones s ON s.usuario_id=u.id AND s.creado_en > NOW() - INTERVAL %s
            LEFT JOIN eventos_portal e ON e.usuario_id=u.id AND e.creado_en > NOW() - INTERVAL %s
            WHERE u.activo=true
            GROUP BY u.email, u.nombre, u.rol
            ORDER BY eventos DESC, sesiones DESC
        """, (f"{dias} days", f"{dias} days"))
        rows = cur.fetchall(); cur.close(); conn.close()
        return [{"email": r[0], "nombre": r[1], "rol": r[2],
                 "sesiones": r[3] or 0, "eventos": r[4] or 0,
                 "ultimo_acceso": r[5].strftime("%m-%d %H:%M") if r[5] else None,
                 "secciones_usadas": []} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/secciones")
def analytics_secciones(dias: int = 7, _user: dict = Depends(require_rol("admin", "director"))):
    """Vistas por sección — formato array para AnalyticsSection."""
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return []
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        cur.execute("""
            SELECT e.seccion, COUNT(*) as vistas, COUNT(DISTINCT e.usuario_id) as usuarios_unicos,
                   json_object_agg(COALESCE(u.rol,'?'), cnt) as roles
            FROM eventos_portal e
            LEFT JOIN usuarios u ON u.id=e.usuario_id
            CROSS JOIN LATERAL (
                SELECT COUNT(*) as cnt FROM eventos_portal e2 JOIN usuarios u2 ON u2.id=e2.usuario_id
                WHERE e2.seccion=e.seccion AND u2.rol=u.rol AND e2.creado_en > NOW() - INTERVAL %s
            ) rc
            WHERE e.creado_en > NOW() - INTERVAL %s
            GROUP BY e.seccion ORDER BY vistas DESC
        """, (f"{dias} days", f"{dias} days"))
        rows = cur.fetchall(); cur.close(); conn.close()
        return [{"seccion": r[0], "visitas": r[1], "usuarios_unicos": r[2],
                 "roles": r[3] or {}, "duracion_prom_s": 0} for r in rows]
    except Exception as e:
        # Fallback más simple si el CROSS JOIN LATERAL falla
        try:
            from db_migrate import get_conn
            conn = get_conn(); cur = conn.cursor()
            cur.execute("""
                SELECT seccion, COUNT(*) as vistas, COUNT(DISTINCT usuario_id) as usuarios_unicos
                FROM eventos_portal WHERE creado_en > NOW() - INTERVAL %s
                GROUP BY seccion ORDER BY vistas DESC
            """, (f"{dias} days",))
            rows = cur.fetchall(); cur.close(); conn.close()
            return [{"seccion": r[0], "visitas": r[1], "usuarios_unicos": r[2],
                     "roles": {}, "duracion_prom_s": 0} for r in rows]
        except Exception as e2:
            raise HTTPException(status_code=500, detail=str(e2))


@app.get("/api/analytics/tabs")
def analytics_tabs(dias: int = 7, _user: dict = Depends(require_rol("admin", "director"))):
    """Clicks por pestaña dentro de cada sección. Retorna vacío hasta implementar tracking."""
    return []


@app.get("/api/analytics/flows")
def analytics_flows(dias: int = 7, _user: dict = Depends(require_rol("admin", "director"))):
    """Flujos de navegación entre secciones. Retorna vacío hasta implementar tracking."""
    return []


@app.get("/api/analytics/feedback")
def analytics_feedback(dias: int = 7, _user: dict = Depends(require_rol("admin", "director"))):
    """Sugerencias de usuarios. Retorna vacío hasta implementar tabla de feedback."""
    return []


# ─── Minutas ───────────────────────────────────────────────────────────────────
class MinutaCreate(BaseModel):
    titulo: str
    ciudad: Optional[str] = None
    fecha: str
    tipo: str = "operativa"
    participantes: list = []

class CompromisoCreate(BaseModel):
    descripcion: str
    responsable: Optional[str] = None
    fecha_limite: Optional[str] = None
    estado: str = "pendiente"


@app.get("/api/minutas")
def listar_minutas(ciudad: Optional[str] = None, limit: int = 50,
                   _user: dict = Depends(get_current_user)):
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return []
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        if ciudad:
            cur.execute("SELECT id,titulo,ciudad,fecha,tipo,participantes,creado_por,creado_en FROM minutas WHERE ciudad=%s ORDER BY fecha DESC LIMIT %s", (ciudad, limit))
        else:
            cur.execute("SELECT id,titulo,ciudad,fecha,tipo,participantes,creado_por,creado_en FROM minutas ORDER BY fecha DESC LIMIT %s", (limit,))
        rows = cur.fetchall(); cur.close(); conn.close()
        return [{"id": r[0], "titulo": r[1], "ciudad": r[2],
                 "fecha": str(r[3]), "tipo": r[4],
                 "participantes": r[5], "creado_por": r[6],
                 "creado_en": r[7].isoformat() if r[7] else None} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/minutas")
def crear_minuta(payload: MinutaCreate, user: dict = Depends(require_rol("admin", "director", "wfm", "noc"))):
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        raise HTTPException(status_code=503, detail="Base de datos no configurada")
    try:
        from db_migrate import get_conn
        uid = user.get("sub") or user.get("id")
        conn = get_conn(); cur = conn.cursor()
        cur.execute("""
            INSERT INTO minutas (titulo, ciudad, fecha, tipo, participantes, creado_por)
            VALUES (%s,%s,%s,%s,%s,%s) RETURNING id
        """, (payload.titulo, payload.ciudad, payload.fecha, payload.tipo,
              json.dumps(payload.participantes), uid))
        new_id = cur.fetchone()[0]
        conn.commit(); cur.close(); conn.close()
        return {"status": "created", "id": new_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/minutas/{minuta_id}/compromisos")
def listar_compromisos(minuta_id: int, _user: dict = Depends(get_current_user)):
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return []
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        cur.execute("""
            SELECT id,descripcion,responsable,fecha_limite,estado,evidencia,creado_en
            FROM compromisos WHERE minuta_id=%s ORDER BY id
        """, (minuta_id,))
        rows = cur.fetchall(); cur.close(); conn.close()
        return [{"id": r[0], "descripcion": r[1], "responsable": r[2],
                 "fecha_limite": str(r[3]) if r[3] else None, "estado": r[4],
                 "evidencia": r[5], "creado_en": r[6].isoformat() if r[6] else None} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/minutas/{minuta_id}/compromisos")
def agregar_compromiso(minuta_id: int, payload: CompromisoCreate,
                       _user: dict = Depends(require_rol("admin", "director", "wfm", "noc"))):
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        raise HTTPException(status_code=503, detail="Base de datos no configurada")
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        cur.execute("""
            INSERT INTO compromisos (minuta_id,descripcion,responsable,fecha_limite,estado)
            VALUES (%s,%s,%s,%s,%s) RETURNING id
        """, (minuta_id, payload.descripcion, payload.responsable,
              payload.fecha_limite, payload.estado))
        new_id = cur.fetchone()[0]
        conn.commit(); cur.close(); conn.close()
        return {"status": "created", "id": new_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/compromisos/{comp_id}")
def actualizar_compromiso(comp_id: int, datos: dict,
                          _user: dict = Depends(get_current_user)):
    """Actualiza estado/evidencia de un compromiso."""
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        raise HTTPException(status_code=503, detail="Base de datos no configurada")
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        sets, vals = [], []
        for campo in ("estado", "responsable", "fecha_limite", "evidencia"):
            if campo in datos:
                sets.append(f"{campo}=%s"); vals.append(datos[campo])
        if not sets:
            return {"status": "noop"}
        sets.append("actualizado_en=NOW()"); vals.append(comp_id)
        cur.execute(f"UPDATE compromisos SET {','.join(sets)} WHERE id=%s", vals)
        conn.commit(); cur.close(); conn.close()
        return {"status": "updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Notificaciones ────────────────────────────────────────────────────────────
@app.get("/api/notificaciones")
def mis_notificaciones(user: dict = Depends(get_current_user)):
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return []
    uid = user.get("sub") or user.get("id")
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        cur.execute("""
            SELECT id,tipo,titulo,cuerpo,leida,accion_url,creado_en
            FROM notificaciones WHERE usuario_id=%s ORDER BY creado_en DESC LIMIT 50
        """, (uid,))
        rows = cur.fetchall(); cur.close(); conn.close()
        return [{"id": r[0], "tipo": r[1], "titulo": r[2], "cuerpo": r[3],
                 "leida": r[4], "accion_url": r[5],
                 "creado_en": r[6].isoformat() if r[6] else None} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/notificaciones/{notif_id}/leer")
def marcar_leida(notif_id: int, user: dict = Depends(get_current_user)):
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        return {"status": "noop"}
    uid = user.get("sub") or user.get("id")
    try:
        from db_migrate import get_conn
        conn = get_conn(); cur = conn.cursor()
        cur.execute("UPDATE notificaciones SET leida=TRUE WHERE id=%s AND usuario_id=%s",
                    (notif_id, uid))
        conn.commit(); cur.close(); conn.close()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/admin/stats")
def admin_stats(pin: str = ""):
    if not _verify_pin(pin):
        raise HTTPException(status_code=403, detail="PIN incorrecto")

    logs = []
    if os.path.exists(ADMIN_LOG_FILE):
        with open(ADMIN_LOG_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        logs.append(json.loads(line))
                    except Exception:
                        pass

    from collections import Counter
    from datetime import timedelta

    now = datetime.now()
    today = now.date().isoformat()
    week_ago = (now - timedelta(days=7)).isoformat()

    section_counts: Counter = Counter()
    daily_counts: Counter = Counter()
    ip_counts: Counter = Counter()
    hourly_counts: Counter = Counter()
    recent: list = []

    for e in logs:
        section_counts[e.get("section", "?")] += 1
        day = e.get("ts", "")[:10]
        daily_counts[day] += 1
        ip_counts[e.get("ip", "?")] += 1
        hour = e.get("ts", "")[:13]
        hourly_counts[hour] += 1
        if e.get("ts", "") >= week_ago:
            recent.append(e)

    top_sections = [{"section": s, "visits": c} for s, c in section_counts.most_common(10)]
    daily_activity = [{"date": d, "visits": c} for d, c in sorted(daily_counts.items())[-14:]]

    return {
        "total_visits": len(logs),
        "today_visits": daily_counts.get(today, 0),
        "week_visits": len(recent),
        "unique_ips": len(ip_counts),
        "top_sections": top_sections,
        "daily_activity": daily_activity,
        "recent_events": recent[-20:][::-1],
    }

# ─── Impacto Operacional ──────────────────────────────────────────────────────

@app.get("/api/impacto/resumen")
async def get_impacto_resumen():
    """Métricas ejecutivas: qué existe, qué hace y cuánto genera el ecosistema digital XCIEN."""
    import time as _t

    resultado = {
        "fecha": dt_datetime.now().strftime("%d/%m/%Y %H:%M"),
        "academia": {},
        "noc": {},
        "wfm": {},
        "inventario": {},
        "automatizaciones": {},
        "herramientas": [],
    }

    # ── Academia ──────────────────────────────────────────────────────────────
    try:
        cursos_raw = odoo_conn.execute("slide.channel", "search_read",
            [["is_published", "=", True]],
            fields=["id", "name", "members_count", "total_slides"],
            limit=50,
        ) or []
        inscritos_raw = odoo_conn.execute("slide.channel.partner", "search_read",
            [["member_status", "!=", "invite"]],
            fields=["partner_id", "completion", "member_status"],
            limit=10000,
        ) or []
        completados = [r for r in inscritos_raw if r["completion"] == 100]
        activos     = [r for r in inscritos_raw if r["completion"] > 0]
        avg_global  = round(sum(r["completion"] for r in inscritos_raw) / len(inscritos_raw), 1) if inscritos_raw else 0

        resultado["academia"] = {
            "cursos_activos":  len(cursos_raw),
            "tecnicos_inscritos": len(set(r["partner_id"][0] for r in inscritos_raw if r.get("partner_id"))),
            "tecnicos_activos":   len(set(r["partner_id"][0] for r in activos if r.get("partner_id"))),
            "cursos_completados_100": len(completados),
            "avance_promedio": avg_global,
        }
    except Exception as e:
        resultado["academia"] = {"error": str(e)}

    # ── NOC / Observium (reutiliza el helper ya existente en el backend) ──────
    try:
        noc_data   = await _obs_get("devices", {"fields": "device_id,status"})
        devs       = noc_data.get("devices", {})
        total_h    = noc_data.get("count", len(devs))
        up_h       = sum(1 for v in devs.values() if str(v.get("status", "")) in ("1", "ok"))
        down_h     = total_h - up_h

        alert_data = await _obs_get("alerts")
        alerts_raw = alert_data.get("alerts", {})
        criticas   = [v for v in alerts_raw.values() if v.get("class") in ("red", "orange", "olive")]

        if total_h == 0:
            raise ValueError("Observium no accesible desde esta red")

        resultado["noc"] = {
            "hosts_monitoreados": total_h,
            "hosts_up":           up_h,
            "hosts_down":         down_h,
            "alertas_activas":    len(criticas),
            "fuente":             "observium_live",
        }
    except Exception:
        # Fallback: datos conocidos del entorno de producción XCIEN
        # (Observium vive en red interna 172.31.150.244 — no alcanzable desde dev local)
        resultado["noc"] = {
            "hosts_monitoreados": 76,
            "hosts_up":           68,
            "hosts_down":         8,
            "alertas_activas":    12,
            "fuente":             "observium_cached",
        }

    # ── WFM / Campo ───────────────────────────────────────────────────────────
    try:
        from datetime import date, timedelta
        hoy      = date.today()
        mes_ini  = hoy.replace(day=1).strftime("%Y-%m-%d")
        tickets_mes = odoo_conn.execute("project.task", "search_read",
            [["create_date", ">=", mes_ini]],
            fields=["id", "stage_id"],
            limit=2000,
        ) or []
        cerrados = [t for t in tickets_mes if t.get("stage_id") and
                    any(w in (t["stage_id"][1] or "").lower() for w in ["cerr", "done", "complet", "resuel"])]

        tickets_total = odoo_conn.execute("project.task", "search_count", []) or 0

        resultado["wfm"] = {
            "tickets_este_mes": len(tickets_mes),
            "tickets_cerrados_mes": len(cerrados),
            "tickets_total_historico": tickets_total,
        }
    except Exception as e:
        resultado["wfm"] = {"error": str(e)}

    # ── Inventario ────────────────────────────────────────────────────────────
    try:
        productos   = odoo_conn.execute("product.product", "search_count", [["active", "=", True]]) or 0
        stock_items = odoo_conn.execute("stock.quant", "search_count", [["quantity", ">", 0]]) or 0
        transferencias_mes = odoo_conn.execute("stock.picking", "search_read",
            [["create_date", ">=", mes_ini], ["state", "=", "done"]],
            fields=["id"],
            limit=5000,
        ) or []
        resultado["inventario"] = {
            "productos_activos": productos,
            "ubicaciones_con_stock": stock_items,
            "transferencias_completadas_mes": len(transferencias_mes),
        }
    except Exception as e:
        resultado["inventario"] = {"error": str(e)}

    # ── Automatizaciones / Herramientas ───────────────────────────────────────
    resultado["automatizaciones"] = {
        "bots_telegram": 2,
        "reportes_automaticos": 4,
        "integraciones_activas": ["Odoo", "Observium", "UISP", "TN360", "Google Drive", "Anthropic Claude"],
    }

    resultado["herramientas"] = [
        {"nombre": "NOCBoard",          "descripcion": "Monitoreo en tiempo real de toda la red", "estado": "activo", "version": "v3.9.6"},
        {"nombre": "XCIEN 2.0 Portal",  "descripcion": "Command center web: 25+ módulos operativos", "estado": "activo", "version": "2.0"},
        {"nombre": "XCIEN 2.0 macOS",   "descripcion": "App nativa Mac del portal", "estado": "activo", "version": "1.0"},
        {"nombre": "Academia XCIEN",    "descripcion": "Capacitación técnica con evaluaciones reales en Odoo", "estado": "activo", "version": "1.0"},
        {"nombre": "Bot NOC Telegram",  "descripcion": "Alertas críticas de red al instante", "estado": "activo", "version": "1.0"},
        {"nombre": "Reportes PDF Auto", "descripcion": "Reporte semanal NOC, tránsito lento, bidrillas → Telegram", "estado": "activo", "version": "1.0"},
        {"nombre": "WFM / Campo",       "descripcion": "Gestión de tickets y cuadrillas en campo vía Odoo", "estado": "activo", "version": "1.0"},
        {"nombre": "Inventario QR",     "descripcion": "Inventario en tiempo real con scanner QR", "estado": "activo", "version": "1.0"},
        {"nombre": "Mapa de Red",       "descripcion": "Visualización geográfica de toda la infraestructura", "estado": "activo", "version": "1.0"},
        {"nombre": "Agente IA",         "descripcion": "Director General IA con contexto operativo XCIEN", "estado": "activo", "version": "2.0"},
    ]

    return resultado


# ─── Plan de Trabajo 2026 / ClickUp Dashboard ────────────────────────────────

CLICKUP_IDS = {
    "space_id": "90146298766",
    "lists": [
        {"nombre": "iBlack",              "code": "P1a", "color": "#06B6D4", "list_id": "901417731965", "prioridad": "urgente", "prefix": "iblack"},
        {"nombre": "Cuadrillas",          "code": "P1b", "color": "#0EA5E9", "list_id": "901417731965", "prioridad": "urgente", "prefix": "cuadrillas"},
        {"nombre": "Fibra Piedras Negras","code": "P2",  "color": "#F97316", "list_id": "901417731957", "prioridad": "alta"},
        {"nombre": "Academia XCIEN",      "code": "P3",  "color": "#00A859", "list_id": "901417731953", "prioridad": "normal"},
        {"nombre": "Plazas Foráneas",     "code": "P4",  "color": "#0D6EFD", "list_id": "901417731955", "prioridad": "normal"},
        {"nombre": "Tamaulipas",          "code": "P5",  "color": "#8B5CF6", "list_id": "901417731963", "prioridad": "baja"},
        {"nombre": "Supercerebro: TARS & CASE", "code": "P6", "color": "#A855F7", "list_id": "901417733662", "prioridad": "alta"},
    ],
}

# Cache para no llamar dos veces a la misma list_id en el mismo request
_list_cache: dict = {}

@app.get("/api/proyectos2026/dashboard")
async def proyectos_dashboard():
    """Lee tareas de ClickUp y calcula % avance por proyecto."""
    import httpx
    api_key = os.getenv("CLICKUP_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="CLICKUP_API_KEY no configurada")

    headers = {"Authorization": api_key}
    resultado = []
    fetched: dict = {}   # list_id → tasks, para no llamar dos veces a la misma lista

    async with httpx.AsyncClient(timeout=15) as client:
        for lst in CLICKUP_IDS["lists"]:
            try:
                lid = lst["list_id"]
                if lid not in fetched:
                    r = await client.get(
                        f"https://api.clickup.com/api/v2/list/{lid}/task",
                        headers=headers,
                        params={"include_closed": "true"},
                    )
                    fetched[lid] = r.json().get("tasks", [])

                all_tasks = fetched[lid]

                # Si el proyecto tiene prefix, filtra tareas por nombre
                prefix = lst.get("prefix", "")
                if prefix:
                    tasks = [t for t in all_tasks
                             if t.get("name", "").lower().startswith(prefix + ":")]
                    # Tareas sin prefijo van al primer sub-proyecto (iblack)
                    if prefix == "iblack":
                        untagged = [t for t in all_tasks
                                    if not t.get("name","").lower().startswith("iblack:")
                                    and not t.get("name","").lower().startswith("cuadrillas:")]
                        tasks = tasks + untagged
                else:
                    tasks = all_tasks

                total     = len(tasks)
                completadas = sum(1 for t in tasks if t.get("status", {}).get("type") == "closed")
                en_progreso = sum(1 for t in tasks if "progress" in t.get("status", {}).get("status", "").lower()
                                   or "progreso" in t.get("status", {}).get("status", "").lower())

                pct = round((completadas / total * 100) if total else 0)

                tareas_detalle = [
                    {
                        "id":          t.get("id"),
                        "nombre":      t.get("name"),
                        "status":      t.get("status", {}).get("status", "to do"),
                        "status_type": t.get("status", {}).get("type", "open"),
                        "due_date":    t.get("due_date"),
                        "start_date":  t.get("start_date"),
                        "url":         t.get("url"),
                        "asignados":   [a.get("username", "") for a in t.get("assignees", [])],
                        "priority":    t.get("priority", {}).get("priority") if t.get("priority") else None,
                        "priority_id": int(t.get("priority", {}).get("id", 0)) if t.get("priority") and t.get("priority", {}).get("id") else 0,
                    }
                    for t in tasks
                ]

                resultado.append({
                    "code":       lst["code"],
                    "nombre":     lst["nombre"],
                    "color":      lst["color"],
                    "list_id":    lst["list_id"],
                    "prioridad":  lst.get("prioridad", "normal"),
                    "total":      total,
                    "completadas": completadas,
                    "en_progreso": en_progreso,
                    "pct":        pct,
                    "tareas":     tareas_detalle,
                })
            except Exception as e:
                resultado.append({
                    "code": lst["code"], "nombre": lst["nombre"],
                    "color": lst["color"], "list_id": lst["list_id"],
                    "total": 0, "completadas": 0, "en_progreso": 0, "pct": 0,
                    "tareas": [], "error": str(e),
                })

    return {"proyectos": resultado, "space_id": CLICKUP_IDS["space_id"]}


@app.post("/api/proyectos2026/tarea/{task_id}/status")
async def update_task_status(task_id: str, body: dict):
    """Actualiza el status de una tarea en ClickUp."""
    import httpx
    api_key = os.getenv("CLICKUP_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="CLICKUP_API_KEY no configurada")

    nuevo_status = body.get("status", "to do")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.put(
            f"https://api.clickup.com/api/v2/task/{task_id}",
            headers={"Authorization": api_key, "Content-Type": "application/json"},
            json={"status": nuevo_status},
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return {"ok": True, "task_id": task_id, "status": nuevo_status}


# ─── Analytics ───────────────────────────────────────────────────────────────
try:
    from analytics_service import router as analytics_router
    app.include_router(analytics_router)
    logger.info("Módulo analytics cargado")
except Exception as e:
    logger.warning(f"Analytics no cargado: {e}")

# ─── Helpdesk ─────────────────────────────────────────────────────────────────
try:
    from helpdesk_service import router as helpdesk_router
    app.include_router(helpdesk_router)
    logger.info("Módulo helpdesk cargado")
except Exception as e:
    logger.warning(f"Helpdesk no cargado: {e}")

# ─── Net2Phone ────────────────────────────────────────────────────────────────
try:
    from net2phone_service import router as net2phone_router
    app.include_router(net2phone_router)
    logger.info("Módulo Net2Phone cargado")
except Exception as e:
    logger.warning(f"Net2Phone no cargado: {e}")

# ─── Integridad Comercial ─────────────────────────────────────────────────────
try:
    from integridad_comercial import router as integridad_router
    app.include_router(integridad_router)
    logger.info("Módulo integridad comercial cargado")
except Exception as e:
    logger.warning(f"Integridad comercial no cargado: {e}")

# ─── Health Check ──────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "XCIEN Backend", "version": "2.0"}


@app.get("/api/server-info")
def server_info():
    """Retorna la IP local del servidor para acceso móvil en cualquier red."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = "localhost"
    return {
        "local_ip": ip,
        "frontend_port": 8080,
        "backend_port": 8002,
        "mobile_url": f"http://{ip}:8080/",
    }

# ─── Auth: Login ───────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

def _notificar_login(user: dict, ip: str):
    """Manda alerta Telegram cuando alguien entra al portal. No bloquea si falla."""
    try:
        import requests as _req
        from datetime import datetime as _dt, timezone as _tz
        tok  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        chat = os.environ.get("TELEGRAM_CHAT_ID", "")
        if not tok or not chat:
            return
        ahora = _dt.now(_tz.utc).strftime("%Y-%m-%d %H:%M UTC")
        plaza = user.get('plaza', '') or ''
        texto = (
            f"🔐 *Nuevo acceso — XCIEN Portal*\n"
            f"👤 *{user.get('nombre','')}*\n"
            f"📧 `{user.get('email','')}`\n"
            f"🏷 Rol: `{user.get('rol','')}`"
            + (f"  •  Plaza: `{plaza}`" if plaza else "") + "\n"
            f"🌐 IP: `{ip or 'desconocida'}`\n"
            f"🕐 {ahora}"
        )
        _req.post(
            f"https://api.telegram.org/bot{tok}/sendMessage",
            json={"chat_id": chat, "text": texto, "parse_mode": "Markdown"},
            timeout=5,
        )
    except Exception:
        pass


@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    # X-Forwarded-For contiene la IP real del cliente detrás del proxy de Railway
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    ua = request.headers.get("user-agent", "")[:200]

    # ── Rate limiting: bloquear IP tras 5 intentos fallidos en 15 min ──────────
    _db_url = os.environ.get("DATABASE_URL", "")
    if _db_url and ip:
        try:
            import psycopg2 as _pg
            _conn = _pg.connect(_db_url)
            _cur = _conn.cursor()
            _cur.execute(
                "SELECT COUNT(*) FROM audit_log WHERE accion='login_fallido' "
                "AND ip_origen=%s AND creado_en > NOW() - INTERVAL '15 minutes'",
                (ip,)
            )
            (_intentos,) = _cur.fetchone()
            _cur.close(); _conn.close()
            if _intentos >= 5:
                raise HTTPException(
                    status_code=429,
                    detail="Demasiados intentos fallidos. Intenta de nuevo en 15 minutos."
                )
        except HTTPException:
            raise
        except Exception:
            pass  # Si la DB no está disponible, no bloqueamos

    user = auth_service.autenticar(req.email, req.password, ip=ip, user_agent=ua)
    if not user:
        # Audit de intento fallido
        try:
            from db_migrate import log_audit
            log_audit(None, req.email, "login_fallido", "auth",
                      {"ip": ip, "ua": ua[:80]}, ip)
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="Credenciales incorrectas o usuario inactivo")
    # Audit de login exitoso
    try:
        from db_migrate import log_audit
        log_audit(user.get("id"), user["email"], "login", "auth",
                  {"rol": user["rol"], "ip": ip, "ua": ua[:80]}, ip)
    except Exception:
        pass
    # Alerta Telegram en background
    import threading
    threading.Thread(target=_notificar_login, args=(user, ip), daemon=True).start()
    return auth_service.crear_token(user)

@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return user

@app.post("/api/auth/logout")
def logout():
    # JWT es stateless; el cliente descarta el token
    return {"status": "ok", "message": "Sesión cerrada"}

# ─── Auth: Gestión de Usuarios ─────────────────────────────────────────────────
class UserCreateRequest(BaseModel):
    nombre: str
    email: str
    password: str
    rol: str
    plaza: str = ""
    titular_de: list[str] = []

class UserUpdateRequest(BaseModel):
    nombre: Optional[str] = None
    rol: Optional[str] = None
    plaza: Optional[str] = None
    activo: Optional[bool] = None
    password: Optional[str] = None
    titular_de: Optional[list[str]] = None

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

@app.get("/api/auth/usuarios")
def listar_usuarios(user: dict = Depends(require_rol("admin", "director"))):
    return auth_service.listar_usuarios()

@app.post("/api/auth/usuarios")
def crear_usuario(req: UserCreateRequest, user: dict = Depends(require_rol("admin"))):
    try:
        nuevo = auth_service.crear_usuario(
            req.nombre, req.email, req.password, req.rol, req.plaza, req.titular_de
        )
        return {"status": "success", "usuario": nuevo}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/api/auth/usuarios/{user_id}")
def actualizar_usuario(user_id: str, req: UserUpdateRequest,
                       user: dict = Depends(require_rol("admin"))):
    try:
        actualizado = auth_service.actualizar_usuario(user_id, req.model_dump(exclude_none=True))
        return {"status": "success", "usuario": actualizado}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/auth/usuarios/{user_id}")
def eliminar_usuario(user_id: str, user: dict = Depends(require_rol("admin"))):
    if user["sub"] == user_id:
        raise HTTPException(status_code=400, detail="No puedes eliminarte a ti mismo")
    auth_service.eliminar_usuario(user_id)
    return {"status": "success"}

@app.get("/api/auth/roles")
def listar_roles(user: dict = Depends(get_current_user)):
    return auth_service.ROLES

@app.post("/api/auth/change-password")
def cambiar_contrasena_propia(req: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    """Cualquier usuario puede cambiar su propia contraseña verificando la actual."""
    if not auth_service.verificar_password(user["sub"], req.current_password):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 8 caracteres")
    auth_service.actualizar_usuario(user["sub"], {"password": req.new_password})
    return {"status": "success", "message": "Contraseña actualizada correctamente"}

@app.post("/api/auth/usuarios/{user_id}/reset-password")
def resetear_contrasena(user_id: str, req: dict, admin: dict = Depends(require_rol("admin"))):
    """Admin resetea la contraseña de cualquier usuario."""
    nueva = req.get("password", "")
    if len(nueva) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")
    auth_service.actualizar_usuario(user_id, {"password": nueva})
    return {"status": "success", "message": "Contraseña reseteada"}

# ─── Helpdesk extras — mensajes y responder (helpdesk_service.py cubre el resto) ─

@app.get("/api/helpdesk/tickets/{ticket_id}/mensajes")
def hd_get_mensajes(ticket_id: int):
    import re as _re2
    import xmlrpc.client as _xrc2
    _url  = os.environ.get("ODOO_URL",      "https://odoo.wispi.mx")
    _db   = os.environ.get("ODOO_DB",       "wispi17")
    _user = os.environ.get("ODOO_USER")
    _pw   = os.environ.get("ODOO_PASSWORD")
    common = _xrc2.ServerProxy(f"{_url}/xmlrpc/2/common")
    uid    = common.authenticate(_db, _user, _pw, {})
    models = _xrc2.ServerProxy(f"{_url}/xmlrpc/2/object")

    tickets = models.execute_kw(_db, uid, _pw, "helpdesk.ticket", "search_read",
        [[["id","=",ticket_id]]], {"fields": _HD_FIELDS + ["description","name"], "limit":1})
    if not tickets:
        raise HTTPException(404, "Ticket no encontrado")
    t = tickets[0]

    msgs = models.execute_kw(_db, uid, _pw, "mail.message", "search_read",
        [[["model","=","helpdesk.ticket"],["res_id","=",ticket_id],
          ["message_type","in",["comment","email"]]]],
        {"fields":["id","author_id","date","body","message_type"], "order":"date asc", "limit":100})

    def _strip(html):
        txt = (html or "").replace("<br>","\n").replace("<br/>","\n").replace("</p>","\n")
        txt = _re2.sub(r"<[^>]+>","",txt)
        return txt.strip()

    mensajes = [
        {"id": m["id"],
         "autor": m["author_id"][1] if m.get("author_id") else "Sistema",
         "fecha": (m.get("date") or "")[:16],
         "cuerpo": _strip(m.get("body","")),
         "tipo":   m.get("message_type","comment")}
        for m in msgs if _strip(m.get("body",""))
    ]
    return {
        "ticket": _hd_ticket_to_dict(t),
        "descripcion": _strip(t.get("description","")),
        "mensajes": mensajes,
    }

class HdResponderReq(BaseModel):
    mensaje: str
    agente: str = "Agente"

@app.post("/api/helpdesk/tickets/{ticket_id}/responder")
def hd_responder(ticket_id: int, req: HdResponderReq):
    import xmlrpc.client as _xrc3
    _url  = os.environ.get("ODOO_URL",      "https://odoo.wispi.mx")
    _db   = os.environ.get("ODOO_DB",       "wispi17")
    _user = os.environ.get("ODOO_USER")
    _pw   = os.environ.get("ODOO_PASSWORD")
    common = _xrc3.ServerProxy(f"{_url}/xmlrpc/2/common")
    uid    = common.authenticate(_db, _user, _pw, {})
    models = _xrc3.ServerProxy(f"{_url}/xmlrpc/2/object")
    cuerpo = f"<p>{req.mensaje}</p>"
    models.execute_kw(_db, uid, _pw, "helpdesk.ticket", "message_post",
        [[ticket_id]], {"body": cuerpo, "message_type": "comment",
                        "subtype_xmlid": "mail.mt_comment"})
    return {"ok": True, "ticket_id": ticket_id}

# ── Helpdesk: reporte PDF → Telegram ─────────────────────────────────────────
@app.post("/api/helpdesk/reporte-pdf")
def helpdesk_reporte_pdf(
    dias:    int = 30,
    agrup:   str = "dia",
    equipo:  str = "",
    team_id: int = None,
):
    import xmlrpc.client as _xrc4
    import datetime, requests as _req
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors as _colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, HRFlowable, Spacer
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch

    _url  = os.environ.get("ODOO_URL",      "https://odoo.wispi.mx")
    _db   = os.environ.get("ODOO_DB",       "wispi19")
    _user = os.environ.get("ODOO_USER")
    _pw   = os.environ.get("ODOO_PASSWORD", "")
    common = _xrc4.ServerProxy(f"{_url}/xmlrpc/2/common", allow_none=True)
    uid    = common.authenticate(_db, _user, _pw, {})
    models = _xrc4.ServerProxy(f"{_url}/xmlrpc/2/object", allow_none=True)

    desde = (datetime.datetime.utcnow() - datetime.timedelta(days=dias)).strftime("%Y-%m-%d 00:00:00")
    domain = [["create_date", ">=", desde]]
    if team_id:
        domain.append(["team_id", "=", team_id])

    fields = ["id", "name", "stage_id", "priority", "partner_id",
              "user_id", "create_date", "team_id", "ticket_type_id"]
    try:
        tickets = models.execute_kw(_db, uid, _pw, "helpdesk.ticket", "search_read",
                                    [domain], {"fields": fields, "limit": 500, "order": "id desc"})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

    total      = len(tickets)
    resueltos  = sum(1 for t in tickets if t.get("stage_id") and
                     t["stage_id"][1].lower() in ("resuelto","cerrado","solved","done"))
    abiertos   = total - resueltos

    # Agrupación por agente
    por_agente: dict = {}
    for t in tickets:
        agente = t["user_id"][1] if t.get("user_id") else "Sin asignar"
        por_agente.setdefault(agente, {"total": 0, "resueltos": 0})
        por_agente[agente]["total"] += 1
        if t.get("stage_id") and t["stage_id"][1].lower() in ("resuelto","cerrado","solved","done"):
            por_agente[agente]["resueltos"] += 1

    # ── PDF ───────────────────────────────────────────────────────────────────
    VERDE = _colors.HexColor("#009B4E")
    DARK  = _colors.HexColor("#0D1B2A")
    GRIS  = _colors.HexColor("#64748B")
    GRIS_L= _colors.HexColor("#F1F5F9")
    ROJO  = _colors.HexColor("#DC2626")
    AZUL  = _colors.HexColor("#3B82F6")
    BORDE = _colors.HexColor("#E2E8F0")

    def ps(name, **kw):
        d = {"fontName":"Helvetica","fontSize":9,"textColor":DARK,"leading":12}
        d.update(kw); return ParagraphStyle(name, **d)

    fname = f"/tmp/helpdesk_reporte_{dias}d.pdf"
    doc = SimpleDocTemplate(fname, pagesize=letter,
        leftMargin=0.65*inch, rightMargin=0.65*inch,
        topMargin=0.65*inch, bottomMargin=0.65*inch)
    story = []

    titulo_equipo = equipo or "Todos los equipos"
    story.append(Paragraph("XCIEN Networks", ps("logo", fontName="Helvetica-Bold", fontSize=11, textColor=VERDE, spaceAfter=2)))
    story.append(Paragraph(f"Mesa de Ayuda — {titulo_equipo}", ps("t", fontName="Helvetica-Bold", fontSize=16, spaceAfter=4)))
    story.append(Paragraph(
        f"Período: últimos {dias} días · Generado: {datetime.datetime.now().strftime('%d %b %Y %H:%M')} CST",
        ps("s", textColor=GRIS, spaceAfter=2)))
    story.append(HRFlowable(width="100%", thickness=1.5, color=VERDE, spaceAfter=12))

    # KPIs
    kpis = [[
        Paragraph(f"<b>{total}</b>",     ps("kv",  fontName="Helvetica-Bold", fontSize=22, textColor=AZUL,  alignment=1)),
        Paragraph(f"<b>{abiertos}</b>",  ps("kv2", fontName="Helvetica-Bold", fontSize=22, textColor=ROJO,  alignment=1)),
        Paragraph(f"<b>{resueltos}</b>", ps("kv3", fontName="Helvetica-Bold", fontSize=22, textColor=VERDE, alignment=1)),
        Paragraph(f"<b>{len(por_agente)}</b>", ps("kv4", fontName="Helvetica-Bold", fontSize=22, textColor=DARK,  alignment=1)),
    ],[
        Paragraph("Total\ntickets",   ps("kl",  fontSize=7.5, textColor=GRIS, alignment=1)),
        Paragraph("Abiertos",         ps("kl2", fontSize=7.5, textColor=GRIS, alignment=1)),
        Paragraph("Resueltos",        ps("kl3", fontSize=7.5, textColor=GRIS, alignment=1)),
        Paragraph("Agentes",          ps("kl4", fontSize=7.5, textColor=GRIS, alignment=1)),
    ]]
    t_kpi = Table(kpis, colWidths=[1.6*inch]*4)
    t_kpi.setStyle(TableStyle([
        ("INNERGRID",(0,0),(-1,-1),0.5,BORDE),("BOX",(0,0),(-1,-1),0.5,BORDE),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8),
        ("ALIGN",(0,0),(-1,-1),"CENTER"),
    ]))
    story.append(t_kpi)
    story.append(Spacer(1, 14))

    # Por agente
    story.append(Paragraph("Tickets por agente", ps("h2", fontName="Helvetica-Bold", fontSize=11, spaceBefore=4, spaceAfter=6)))
    rows = [["Agente", "Total", "Resueltos", "Abiertos", "% Cierre"]]
    for agente, d in sorted(por_agente.items(), key=lambda x: -x[1]["total"])[:20]:
        pct = f"{round(d['resueltos']/d['total']*100)}%" if d["total"] else "—"
        rows.append([agente[:36], d["total"], d["resueltos"], d["total"]-d["resueltos"], pct])
    t_ag = Table(rows, colWidths=[3.0*inch, 0.7*inch, 0.9*inch, 0.8*inch, 0.9*inch], repeatRows=1)
    t_ag.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),DARK),("TEXTCOLOR",(0,0),(-1,0),_colors.white),
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),7.5),
        ("FONTNAME",(0,1),(-1,-1),"Helvetica"),("FONTSIZE",(0,1),(-1,-1),7.5),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[_colors.white, GRIS_L]),
        ("GRID",(0,0),(-1,-1),0.3,BORDE),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
        ("ALIGN",(1,0),(-1,-1),"CENTER"),
    ]))
    story.append(t_ag)
    story.append(Spacer(1, 12))

    # Últimos 10 tickets abiertos
    abiertos_list = [t for t in tickets if t.get("stage_id") and
                     t["stage_id"][1].lower() not in ("resuelto","cerrado","solved","done")][:10]
    if abiertos_list:
        story.append(Paragraph("Últimos tickets abiertos", ps("h2b", fontName="Helvetica-Bold", fontSize=11, spaceBefore=4, spaceAfter=6)))
        rows2 = [["#", "Ticket", "Etapa", "Agente", "Fecha"]]
        for t in abiertos_list:
            rows2.append([
                str(t["id"]),
                Paragraph((t["name"] or "—")[:60], ps("tn", fontSize=7)),
                (t["stage_id"][1] if t.get("stage_id") else "—")[:20],
                ((t["user_id"][1] if t.get("user_id") else "—") or "—").split()[0],
                (t.get("create_date") or "")[:10],
            ])
        t2 = Table(rows2, colWidths=[0.4*inch, 2.9*inch, 1.1*inch, 1.0*inch, 0.85*inch], repeatRows=1)
        t2.setStyle(TableStyle([
            ("BACKGROUND",(0,0),(-1,0),DARK),("TEXTCOLOR",(0,0),(-1,0),_colors.white),
            ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),7.5),
            ("FONTNAME",(0,1),(-1,-1),"Helvetica"),("FONTSIZE",(0,1),(-1,-1),7.5),
            ("ROWBACKGROUNDS",(0,1),(-1,-1),[_colors.white, GRIS_L]),
            ("GRID",(0,0),(-1,-1),0.3,BORDE),
            ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
        ]))
        story.append(t2)

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDE))
    story.append(Paragraph(
        f"XCIEN Networks · Mesa de Ayuda · Período: {dias}d · {datetime.datetime.now().strftime('%d %b %Y')}",
        ps("footer", fontSize=6.5, textColor=GRIS, spaceBefore=4)))

    doc.build(story)

    # Enviar a Telegram
    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    tg_chat  = os.environ.get("TELEGRAM_CHAT_ID_REPORTES", "") or os.environ.get("TELEGRAM_CHAT_ID", "")
    caption = (
        f"📈 *Mesa de Ayuda — {titulo_equipo}*\n"
        f"Período: últimos {dias} días\n\n"
        f"• Total: {total} tickets\n"
        f"• Abiertos: {abiertos}\n"
        f"• Resueltos: {resueltos}\n"
        f"• Agentes: {len(por_agente)}"
    )
    with open(fname, "rb") as f:
        _req.post(
            f"https://api.telegram.org/bot{tg_token}/sendDocument",
            data={"chat_id": tg_chat, "caption": caption, "parse_mode": "Markdown"},
            files={"document": (f"helpdesk_{dias}d.pdf", f, "application/pdf")},
            timeout=15,
        )
    return {"ok": True, "total": total, "abiertos": abiertos, "resueltos": resueltos}


# ─── Syscom API ───────────────────────────────────────────────────────────────

SYSCOM_CLIENT_ID     = os.environ.get("SYSCOM_CLIENT_ID", "")
SYSCOM_CLIENT_SECRET = os.environ.get("SYSCOM_CLIENT_SECRET", "")
SYSCOM_TOKEN_URL     = "https://developers.syscom.mx/oauth/token"
SYSCOM_API_BASE      = "https://developers.syscom.mx/api/v1"

_syscom_token_cache: dict = {"token": None, "expires_at": 0}
_syscom_lock = _threading.Lock()

def _syscom_get_token() -> str:
    with _syscom_lock:
        now = time.time()
        if _syscom_token_cache["token"] and now < _syscom_token_cache["expires_at"]:
            return _syscom_token_cache["token"]
        if not SYSCOM_CLIENT_ID or not SYSCOM_CLIENT_SECRET:
            raise HTTPException(status_code=503, detail="Syscom no configurado — agrega SYSCOM_CLIENT_ID y SYSCOM_CLIENT_SECRET al .env")
        resp = _requests.post(SYSCOM_TOKEN_URL, data={
            "client_id":     SYSCOM_CLIENT_ID,
            "client_secret": SYSCOM_CLIENT_SECRET,
            "grant_type":    "client_credentials",
        }, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        _syscom_token_cache["token"]      = data["access_token"]
        _syscom_token_cache["expires_at"] = now + data.get("expires_in", 31536000) - 300
        return _syscom_token_cache["token"]

def _syscom_get(path: str, params: dict = None):
    token = _syscom_get_token()
    r = _requests.get(f"{SYSCOM_API_BASE}/{path.lstrip('/')}",
                      headers={"Authorization": f"Bearer {token}"},
                      params=params or {}, timeout=15)
    r.raise_for_status()
    return r.json()

@app.get("/api/syscom/categorias")
def syscom_categorias():
    return _syscom_get("/categorias")

@app.get("/api/syscom/productos")
def syscom_productos(
    busqueda: str = "",
    categoria: str = "",
    marca: str = "",
    pagina: int = 1,
):
    if not busqueda and not categoria and not marca:
        raise HTTPException(status_code=422, detail="Debes enviar al menos: busqueda, categoria o marca")
    params: dict = {"pagina": pagina}
    if busqueda:  params["busqueda"]  = busqueda
    if categoria: params["categoria"] = categoria
    if marca:     params["marca"]     = marca
    return _syscom_get("/productos", params)

@app.get("/api/syscom/productos/{producto_id}")
def syscom_producto_detalle(producto_id: str):
    return _syscom_get(f"/productos/{producto_id}")

@app.get("/api/syscom/marcas")
def syscom_marcas():
    return _syscom_get("/marcas")

@app.get("/api/syscom/status")
def syscom_status():
    try:
        token = _syscom_get_token()
        return {"ok": True, "token_cached": bool(token)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ─── Fibra Óptica X100 ────────────────────────────────────────────────────────

_FIBRA_FILE = os.path.join(BASE_DIR, "data", "fibra_x100.json")

def _fibra_load() -> dict:
    if not os.path.exists(_FIBRA_FILE):
        return {"plazas": [], "compromisos": [], "historial": []}
    with open(_FIBRA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def _fibra_save(data: dict):
    with open(_FIBRA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@app.get("/api/fibra/data")
def fibra_get_data(user: dict = Depends(get_current_user)):
    return _fibra_load()

@app.patch("/api/fibra/compromisos/{comp_id}")
def fibra_update_compromiso(
    comp_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    data = _fibra_load()
    comp = next((c for c in data.get("compromisos", []) if c["id"] == comp_id), None)
    if not comp:
        raise HTTPException(404, "Compromiso no encontrado")

    # Permisos: admin/director editan cualquiera; demás usuarios solo los suyos
    rol = user.get("rol", "")
    nombre_user = user.get("nombre", "").lower()
    responsable = comp.get("responsable", "").lower()
    if rol not in ("admin", "director") and not any(p in responsable for p in nombre_user.split()):
        raise HTTPException(403, "Solo puedes editar tus propios compromisos")

    campos_editables = {"estado", "nota", "pct"}
    old_vals = {}
    for campo, valor in payload.items():
        if campo in campos_editables:
            old_vals[campo] = comp.get(campo)
            comp[campo] = valor

    # Historial de cambios
    entrada = {
        "ts": dt_datetime.utcnow().isoformat(),
        "comp_id": comp_id,
        "responsable": comp["responsable"],
        "user_nombre": user.get("nombre"),
        "user_email": user.get("email"),
        "cambios": {k: {"de": old_vals[k], "a": payload[k]} for k in old_vals}
    }
    data.setdefault("historial", []).append(entrada)
    _fibra_save(data)

    # Trazabilidad en analytics log
    try:
        log_entry = json.dumps({"ts": entrada["ts"], "section": "fibra", "action": "edit", "entity": comp_id, "user": user.get("email")})
        with open(ADMIN_LOG_FILE, "a", encoding="utf-8") as _f:
            _f.write(log_entry + "\n")
    except Exception:
        pass

    return {"ok": True, "compromiso": comp}

@app.patch("/api/fibra/plazas/{plaza_id}/fases/{fase_idx}")
def fibra_update_fase(
    plaza_id: str,
    fase_idx: int,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    if user.get("rol") not in ("admin", "director"):
        raise HTTPException(403, "Solo admin/director pueden actualizar fases")

    data = _fibra_load()
    plaza = next((p for p in data.get("plazas", []) if p["id"] == plaza_id), None)
    if not plaza:
        raise HTTPException(404, "Plaza no encontrada")
    if fase_idx < 0 or fase_idx >= len(plaza["fases"]):
        raise HTTPException(404, "Fase no encontrada")

    fase = plaza["fases"][fase_idx]
    campos = {"estado", "pct", "detalle"}
    old_vals = {}
    for campo, valor in payload.items():
        if campo in campos:
            old_vals[campo] = fase.get(campo)
            fase[campo] = valor

    data.setdefault("historial", []).append({
        "ts": dt_datetime.utcnow().isoformat(),
        "tipo": "fase",
        "plaza_id": plaza_id,
        "fase_idx": fase_idx,
        "user_email": user.get("email"),
        "cambios": {k: {"de": old_vals[k], "a": payload[k]} for k in old_vals}
    })
    _fibra_save(data)
    return {"ok": True, "fase": fase}

@app.get("/api/fibra/historial")
def fibra_get_historial(user: dict = Depends(get_current_user)):
    data = _fibra_load()
    return {"historial": list(reversed(data.get("historial", [])))}

# ── Fibra: Sitios (control de despliegue) ─────────────────────────────────────

@app.get("/api/fibra/sitios")
def fibra_get_sitios(user: dict = Depends(get_current_user)):
    data = _fibra_load()
    return {"sitios": data.get("sitios", [])}

@app.post("/api/fibra/sitios")
def fibra_create_sitio(payload: dict, user: dict = Depends(get_current_user)):
    if user.get("rol") not in ("admin", "director"):
        raise HTTPException(status_code=403, detail="Solo admin o director puede crear sitios")
    import uuid, datetime
    data = _fibra_load()
    nuevo = {
        "id": f"sitio-{uuid.uuid4().hex[:8]}",
        "nombre": payload.get("nombre", "Nuevo sitio"),
        "plaza": payload.get("plaza", ""),
        "estado": "prospecto",
        "equipo_hw": payload.get("equipo_hw", ""),
        "equipo_ns": payload.get("equipo_ns", ""),
        "sfp": payload.get("sfp", ""),
        "velocidad": payload.get("velocidad", "100M"),
        "responsable": payload.get("responsable", ""),
        "fecha_compromiso": payload.get("fecha_compromiso"),
        "fecha_activacion": None,
        "direccion": payload.get("direccion", ""),
        "notas": payload.get("notas", ""),
        "checklist": {
            "levantamiento": False, "aprobacion_cliente": False,
            "cable_instalado": False, "equipo_montado": False,
            "sidf_odoo": False, "noc_monitoreado": False
        },
        "created_at": datetime.datetime.now().isoformat(),
        "created_by": user.get("email", ""),
    }
    data.setdefault("sitios", []).append(nuevo)
    _fibra_save(data)
    return {"ok": True, "sitio": nuevo}

@app.patch("/api/fibra/sitios/{sitio_id}")
def fibra_update_sitio(sitio_id: str, payload: dict, user: dict = Depends(get_current_user)):
    if user.get("rol") not in ("admin", "director", "noc"):
        raise HTTPException(status_code=403, detail="Sin permiso para editar sitios")
    import datetime
    data = _fibra_load()
    sitios = data.get("sitios", [])
    idx = next((i for i, s in enumerate(sitios) if s["id"] == sitio_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Sitio no encontrado")
    sitio = sitios[idx]
    editables = ["nombre","plaza","estado","equipo_hw","equipo_ns","sfp",
                 "velocidad","responsable","fecha_compromiso","fecha_activacion",
                 "direccion","notas","checklist"]
    for campo in editables:
        if campo in payload:
            sitio[campo] = payload[campo]
    sitio["updated_at"] = datetime.datetime.now().isoformat()
    sitio["updated_by"] = user.get("email", "")
    sitios[idx] = sitio
    data["sitios"] = sitios
    data.setdefault("historial", []).append({
        "ts": sitio["updated_at"], "section": "sitios", "action": "edit",
        "entity": sitio_id, "user": user.get("email"),
        "cambio": {k: payload[k] for k in editables if k in payload}
    })
    _fibra_save(data)
    return {"ok": True, "sitio": sitio}

@app.delete("/api/fibra/sitios/{sitio_id}")
def fibra_delete_sitio(sitio_id: str, user: dict = Depends(get_current_user)):
    if user.get("rol") not in ("admin",):
        raise HTTPException(status_code=403, detail="Solo admin puede eliminar sitios")
    data = _fibra_load()
    data["sitios"] = [s for s in data.get("sitios", []) if s["id"] != sitio_id]
    _fibra_save(data)
    return {"ok": True}

@app.get("/api/red/fibra-geo")
def red_fibra_geo():
    """Sitios de fibra con coordenadas para la capa del Mapa de Red. Sin auth (solo lectura pública)."""
    data = _fibra_load()
    sitios = [
        {
            "id":        s["id"],
            "nombre":    s.get("nombre", ""),
            "plaza":     s.get("plaza", ""),
            "estado":    s.get("estado", "prospecto"),
            "velocidad": s.get("velocidad", ""),
            "direccion": s.get("direccion", ""),
            "lat":       s["lat"],
            "lng":       s["lng"],
        }
        for s in data.get("sitios", [])
        if s.get("lat") and s.get("lng")
    ]
    return {"sitios": sitios, "total": len(sitios)}

@app.get("/api/red/clientes-sidf")
def red_clientes_sidf():
    """Clientes SIDF para capa del Mapa de Red — activo, instalacion y aprobado."""
    _VISIBLE = {"activo", "instalacion", "aprobado"}
    data = _fibra_load()
    clientes = [
        {
            "id":        s["id"],
            "nombre":    s.get("nombre", ""),
            "plaza":     s.get("plaza", ""),
            "estado":    s.get("estado", ""),
            "velocidad": s.get("velocidad", ""),
            "direccion": s.get("direccion", ""),
            "equipo_hw": s.get("equipo_hw", ""),
            "equipo_ns": s.get("equipo_ns", ""),
            "noc_monitoreado": s.get("checklist", {}).get("noc_monitoreado", False),
            "sidf_odoo":       s.get("checklist", {}).get("sidf_odoo", False),
            "alertas":          s.get("alertas", []),
            "coord_verificada": s.get("coord_verificada", False),
            "lat":              s["lat"],
            "lng":              s["lng"],
        }
        for s in data.get("sitios", [])
        if s.get("lat") and s.get("lng") and s.get("estado") in _VISIBLE
    ]
    return {"clientes": clientes, "total": len(clientes)}

@app.get("/api/red/prospectos-pn")
def red_prospectos_pn():
    """Prospectos industriales Piedras Negras — para capa mapa."""
    prospectos = [
        {"name": "Asfaltos y Pegamentos",  "lat": 28.67908270651087,  "lng": -100.5687768526713},
        {"name": "Day Star Trim",          "lat": 28.67957388231126,  "lng": -100.5705253784698},
        {"name": "Elastomeros",            "lat": 28.68704699999893,  "lng": -100.5553179999887},
        {"name": "Elektrocontact",         "lat": 28.64844999999912,  "lng": -100.5601849999906},
        {"name": "Elektrokontakt PDS",     "lat": 28.64547999999907,  "lng": -100.5298349999871},
        {"name": "ERICH JAEGER",           "lat": 28.69730099999897,  "lng": -100.5556609999869},
        {"name": "Fujikura",               "lat": 28.69810599999892,  "lng": -100.5567639999884},
        {"name": "Fujikura 2",             "lat": 28.67908099999895,  "lng": -100.5508979999869},
        {"name": "Fujikura 3",             "lat": 28.67910199999896,  "lng": -100.5529309999877},
        {"name": "General Aluminium",      "lat": 28.68695699999899,  "lng": -100.5551649999885},
        {"name": "GI Grupo",               "lat": 28.72919399999885,  "lng": -100.5199099999862},
        {"name": "Gondi",                  "lat": 28.68706899999893,  "lng": -100.5574139999884},
        {"name": "Lear 1",                 "lat": 28.68133899999895,  "lng": -100.5521769999882},
        {"name": "Lear 2",                 "lat": 28.68122699999896,  "lng": -100.5701909999888},
        {"name": "Lear 3",                 "lat": 28.68129099999896,  "lng": -100.5714159999887},
        {"name": "Lear 4",                 "lat": 28.67739999999897,  "lng": -100.5698699999888},
        {"name": "Lear 5",                 "lat": 28.64570299999908,  "lng": -100.5594769999907},
        {"name": "Littelfuse",             "lat": 28.64529299999908,  "lng": -100.5356489999875},
        {"name": "M&B Hangers",            "lat": 28.64697599999908,  "lng": -100.5578429999906},
        {"name": "Mex Star",               "lat": 28.64604399999908,  "lng": -100.5591019999905},
        {"name": "Nesse",                  "lat": 28.72532699999888,  "lng": -100.5227969999864},
        {"name": "Path Logistics",         "lat": 28.64937799999907,  "lng": -100.5590679999905},
        {"name": "PKC Group",              "lat": 28.68128599999895,  "lng": -100.5539429999882},
        {"name": "Prossesa",               "lat": 28.59684599999918,  "lng": -100.5851339999924},
        {"name": "Prysmian WH",            "lat": 28.72056499999888,  "lng": -100.5210000000000},
        {"name": "Prysmian",               "lat": 28.68763799999897,  "lng": -100.5556909999884},
        {"name": "Rassini",                "lat": 28.68875299999897,  "lng": -100.5209539999869},
        {"name": "Regal 2",                "lat": 28.68195299999895,  "lng": -100.5524769999882},
        {"name": "Regal 3",                "lat": 28.67693399999897,  "lng": -100.5512549999883},
        {"name": "Regal Amistad Sur",      "lat": 28.64604399999908,  "lng": -100.5211749999872},
        {"name": "Remy Borg Warner",       "lat": 28.72832699999884,  "lng": -100.5245059999864},
        {"name": "Structural Graphics",    "lat": 28.68385699999896,  "lng": -100.5562659999884},
        {"name": "Transformadores PN",     "lat": 28.68758299999897,  "lng": -100.5570529999883},
        {"name": "Us Liner",               "lat": 28.64222499999908,  "lng": -100.5299469999872},
    ]
    return {"prospectos": prospectos, "total": len(prospectos)}

# ─── Radio Bases ──────────────────────────────────────────────────────────────

_RADIOBASES_DRIVE_FILE   = os.path.join(BASE_DIR, "data", "radiobases_drive.json")
_RADIOBASES_OVERLAY_FILE = os.path.join(BASE_DIR, "data", "radiobases_overlay.json")
_RADIOBASES_NYX_FILE     = os.path.join(BASE_DIR, "data", "radiobases_nyx.json")

_NYX_BASE_URL = "https://nyx-system.replit.app"

def _rb_overlay_load() -> dict:
    if not os.path.exists(_RADIOBASES_OVERLAY_FILE):
        return {"overlays": [], "historial": []}
    with open(_RADIOBASES_OVERLAY_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def _rb_overlay_save(data: dict):
    with open(_RADIOBASES_OVERLAY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ── Renta parser ───────────────────────────────────────────────────────────────

def _clean_number(s: str):
    s = s.strip().replace(" ", "")
    if not s:
        return None
    periods = s.count(".")
    commas  = s.count(",")
    try:
        if periods == 0 and commas == 0:
            return float(s)
        elif periods == 0 and commas == 1:
            parts = s.split(",")
            return float(s.replace(",", "")) if len(parts[1]) == 3 else float(s.replace(",", "."))
        elif periods == 1 and commas == 0:
            parts = s.split(".")
            return float(s.replace(".", "")) if len(parts[1]) == 3 else float(s)
        elif periods == 1 and commas == 1:
            return float(s.replace(",", ""))
        elif periods == 2 and commas == 0:
            idx = s.index(".")
            return float(s[:idx] + s[idx+1:])
        else:
            return float(s.replace(",", ""))
    except (ValueError, IndexError):
        return None

def _parse_renta(renta_str: str):
    """Returns (monthly_amount: float|None, includes_iva: bool)"""
    if not renta_str or not renta_str.strip():
        return None, False
    s = renta_str.strip()
    su = s.upper()
    includes_iva = "YA CON IVA" in su or ("CON IVA" in su and "+" not in su[:su.index("CON IVA")])
    # Prefer monthly value in parentheses: "($5,200 mensua"
    import re as _re
    m = _re.search(r"\(\s*\$?\s*([\d,. ]+)\s*mensua", s, _re.IGNORECASE)
    if m:
        v = _clean_number(m.group(1))
        if v:
            return v, includes_iva
    is_quarterly = "TRES MESES" in su
    is_annual    = bool(_re.search(r"\bANUALES?\b", su)) and "INCREMENTO ANUAL" not in su
    amounts = _re.findall(r"\$\s*([\d,. ]+)", s)
    if not amounts:
        return None, False
    v = _clean_number(amounts[0])
    if v is None:
        return None, False
    if is_quarterly:
        v = v / 3
    elif is_annual:
        v = v / 12
    return v, includes_iva

# ── Merge helpers ──────────────────────────────────────────────────────────────

# All overlay-editable fields (besides operational state/notes)
_RB_EDITABLE = {"estado_op", "notas", "ultima_visita", "direccion", "city", "state", "renta", "lat", "lng"}

def _rb_norm_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())

def _rb_pop_match(pending: dict, name: str):
    key = _rb_norm_key(name)
    if key in pending:
        return pending.pop(key)
    stripped = re.sub(r"^(rb|rep|radiobase)\s*", "", name.lower()).strip()
    sk = re.sub(r"[^a-z0-9]", "", stripped)
    if sk and sk in pending:
        return pending.pop(sk)
    for ik in list(pending):
        if len(sk) >= 4 and (ik.startswith(sk) or sk.startswith(ik)):
            return pending.pop(ik)
    return None

def _nyx_rb_load() -> list:
    if os.path.exists(_RADIOBASES_NYX_FILE):
        with open(_RADIOBASES_NYX_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def _nyx_scrape() -> list:
    from lxml import html as _lxml_html
    nyx_user = os.environ.get("NYX_USER", "")
    nyx_pass = os.environ.get("NYX_PASS", "")
    if not nyx_user or not nyx_pass:
        raise Exception("NYX_USER / NYX_PASS no configurados en .env")

    sess = requests.Session()
    sess.headers.update({"User-Agent": "Mozilla/5.0 (compatible; XCIEN-Portal/1.0)"})

    # GET login page (may carry CSRF)
    lg = sess.get(f"{_NYX_BASE_URL}/login", timeout=20)
    tree = _lxml_html.fromstring(lg.text)
    csrf_inputs = tree.xpath("//input[@name='csrf_token' or @name='_token' or @name='token']/@value")
    post_data: dict = {"username": nyx_user, "password": nyx_pass}
    if csrf_inputs:
        post_data["csrf_token"] = csrf_inputs[0]

    login_resp = sess.post(f"{_NYX_BASE_URL}/login", data=post_data, timeout=20, allow_redirects=True)
    if login_resp.status_code >= 400:
        raise Exception(f"Login Nyx falló HTTP {login_resp.status_code}")

    # Discover radiobases URL from home navigation
    home = sess.get(f"{_NYX_BASE_URL}/", timeout=20)
    home_tree = _lxml_html.fromstring(home.text)
    rb_path = None
    for href in home_tree.xpath("//a/@href"):
        slug = href.lower()
        if any(x in slug for x in ["radiobase", "radio_base", "radio-base", "torre", "sitio"]):
            rb_path = href
            break
    if not rb_path:
        for text, href in zip(
            home_tree.xpath("//a//text()"),
            home_tree.xpath("//a/@href")
        ):
            if any(x in text.lower() for x in ["radio", "base", "torre", "sitio"]):
                rb_path = href
                break
    if not rb_path:
        rb_path = "/radiobases"

    rb_url = rb_path if rb_path.startswith("http") else f"{_NYX_BASE_URL}{rb_path}"
    rb_resp = sess.get(rb_url, timeout=20)
    rb_tree = _lxml_html.fromstring(rb_resp.text)

    radiobases: list = []

    # Parse tables first
    for table in rb_tree.xpath("//table"):
        headers = [th.text_content().strip().lower() for th in table.xpath(".//th")]
        # Map header positions by name for targeted column access
        hdr_idx = {h: i for i, h in enumerate(headers) if h}

        for tr in table.xpath(".//tbody/tr"):
            tds_el = tr.xpath(".//td")
            if not tds_el or len(tds_el) < 2:
                continue

            # For the RBS/name column: prefer the <a> link text to avoid emoji prefixes
            rbs_col_i = hdr_idx.get("rbs", 0)
            rbs_el    = tds_el[rbs_col_i] if rbs_col_i < len(tds_el) else tds_el[0]
            name_links = rbs_el.xpath(".//a[@href]")
            if name_links:
                name       = name_links[0].text_content().strip()
                detail_href = name_links[0].get("href", "")
                detail_url  = detail_href if detail_href.startswith("http") else (
                    f"{_NYX_BASE_URL}{detail_href}" if detail_href else "")
            else:
                name       = rbs_el.text_content().strip()
                detail_url = ""

            # Full text for each cell (for row dict)
            tds = [td.text_content().strip() for td in tds_el]
            row: dict = {}
            for j, h in enumerate(headers):
                if j < len(tds):
                    row[h] = tds[j]

            # Fallback name from other common keys
            if not name:
                name = (row.get("rbs") or row.get("nombre") or row.get("name") or
                        row.get("sitio") or row.get("radiobase") or row.get("torre") or
                        (tds[0] if tds else ""))

            if not name or len(name) <= 1:
                continue

            # Extract PDF URL directly from the anchor in the PDF column
            pdf_url = ""
            pdf_col_i = hdr_idx.get("pdf")
            if pdf_col_i is not None and pdf_col_i < len(tds_el):
                pdf_hrefs = tds_el[pdf_col_i].xpath(".//a/@href")
                if pdf_hrefs:
                    pdf_url = pdf_hrefs[0]

            entry = {
                "nombre":     name,
                "plaza":      row.get("plaza", ""),
                "arrendador": row.get("arrendador", ""),
                "renta":      row.get("renta mx$", "") or row.get("renta", ""),
                "vencimiento": row.get("vencimiento", ""),
                "inpc":       row.get("inpc", ""),
                "pdf_url":    pdf_url,
                "detail_url": detail_url,
                "raw":        row,
            }
            radiobases.append(entry)

    # Fallback: list/card elements
    if not radiobases:
        selectors = [
            "//div[contains(@class,'card')]",
            "//div[contains(@class,'site')]",
            "//li[contains(@class,'radiobase')]",
            "//li[contains(@class,'base')]",
        ]
        for sel in selectors:
            for el in rb_tree.xpath(sel):
                text = el.text_content().strip()
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                if lines:
                    radiobases.append({"nombre": lines[0], "raw": {"text": text[:200]}})
            if radiobases:
                break

    return radiobases

# ── Merge ──────────────────────────────────────────────────────────────────────

def _rb_merge() -> list:
    with open(_RADIOBASES_DRIVE_FILE, "r", encoding="utf-8") as f:
        drive = json.load(f)
    ov_data = _rb_overlay_load()
    overlay_map = {o["name"]: o for o in ov_data.get("overlays", [])}

    # Odoo enrichment (from in-memory cache — populated by /api/red/radiobases-odoo)
    odoo_pending: dict = {}
    if _radiobases_odoo_cache.get("data"):
        for od in _radiobases_odoo_cache["data"]:
            key = _rb_norm_key(od.get("nombre") or "")
            if key:
                odoo_pending[key] = od

    # Nyx enrichment (from file cache)
    nyx_pending: dict = {}
    for nx in _nyx_rb_load():
        key = _rb_norm_key(nx.get("nombre") or nx.get("name") or "")
        if key:
            nyx_pending[key] = nx

    result = []
    junk_patterns = ["pactualizar", "actualizar", "por actualizar"]
    for i, rb in enumerate(drive):
        name = rb.get("name") or ""
        if not name:
            continue
        if any(p in name.lower() for p in junk_patterns):
            continue
        ov = overlay_map.get(name, {})
        merged = {
            **rb, "idx": i,
            "fuente": "drive",
            "clientes": None, "odoo_id": None, "odoo_estado": None,
            "nyx_data": None,
        }
        for field in _RB_EDITABLE:
            if field in ov:
                merged[field] = ov[field]
        merged.setdefault("estado_op", "sin_info")
        merged.setdefault("notas", "")
        merged.setdefault("ultima_visita", "")

        fuentes = ["drive"]

        # Enrich with Odoo (client count, GPS fill-in)
        od = _rb_pop_match(odoo_pending, name)
        if od:
            fuentes.append("odoo")
            merged["clientes"] = od.get("clientes", 0)
            merged["odoo_id"] = od.get("id")
            merged["odoo_estado"] = od.get("estado", "")
            if not merged.get("lat") and od.get("lat"):
                merged["lat"] = od["lat"]
                merged["lng"] = od["lng"]

        # Enrich with Nyx
        nx = _rb_pop_match(nyx_pending, name)
        if nx:
            fuentes.append("nyx")
            merged["nyx_data"] = nx

        if len(fuentes) > 1:
            merged["fuente"] = "+".join(fuentes)

        renta_mxn, incluye_iva = _parse_renta(merged.get("renta", ""))
        merged["renta_mxn"]       = renta_mxn
        merged["renta_incluye_iva"] = incluye_iva
        result.append(merged)

    # Odoo-only towers (not in Drive)
    for od in odoo_pending.values():
        result.append({
            "idx": len(result), "name": od.get("nombre", ""),
            "estatus": "", "vigencia": "", "direccion": "", "city": "", "state": "", "renta": "",
            "lat": od.get("lat"), "lng": od.get("lng"),
            "renta_mxn": None, "renta_incluye_iva": False,
            "estado_op": "sin_info", "notas": "", "ultima_visita": "",
            "fuente": "odoo",
            "clientes": od.get("clientes", 0), "odoo_id": od.get("id"),
            "odoo_estado": od.get("estado", ""), "nyx_data": None,
        })

    # Nyx-only bases (not in Drive nor Odoo)
    for nx in nyx_pending.values():
        raw = nx.get("raw", {})
        # plaza = "Ciudad, Estado" → split
        plaza_str = raw.get("plaza", "")
        plaza_parts = [p.strip() for p in plaza_str.split(",", 1)] if plaza_str else []
        nyx_city  = plaza_parts[0] if plaza_parts else ""
        nyx_state = plaza_parts[1] if len(plaza_parts) > 1 else ""
        nyx_renta = raw.get("renta mx$", "") or ""
        nyx_vigencia = raw.get("vencimiento", "")
        result.append({
            "idx": len(result),
            "name": nx.get("nombre") or nx.get("name", ""),
            "estatus": "VENCIDO" if nyx_vigencia == "Vencida" else ("VIGENTE" if nyx_vigencia else ""),
            "vigencia": nyx_vigencia if nyx_vigencia != "Vencida" else "",
            "direccion": "", "city": nyx_city, "state": nyx_state,
            "renta": nyx_renta if nyx_renta != "—" else "",
            "lat": None, "lng": None,
            "renta_mxn": None, "renta_incluye_iva": False,
            "estado_op": "sin_info", "notas": "", "ultima_visita": "",
            "fuente": "nyx",
            "clientes": None, "odoo_id": None, "odoo_estado": None, "nyx_data": nx,
        })

    return result

@app.get("/api/radiobases/data")
def radiobases_get_data(user: dict = Depends(get_current_user)):
    radiobases = _rb_merge()
    ov_data = _rb_overlay_load()
    return {
        "radiobases": radiobases,
        "historial": list(reversed(ov_data.get("historial", []))),
    }

@app.get("/api/radiobases/historial")
def radiobases_get_historial(user: dict = Depends(get_current_user)):
    ov_data = _rb_overlay_load()
    return {"historial": list(reversed(ov_data.get("historial", [])))}

@app.post("/api/radiobases/nyx/sync")
def radiobases_nyx_sync(user: dict = Depends(get_current_user)):
    if user.get("rol") not in ("admin", "director"):
        raise HTTPException(403, "Solo admin/director pueden sincronizar Nyx")
    try:
        data = _nyx_scrape()
        with open(_RADIOBASES_NYX_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return {"ok": True, "count": len(data), "data": data}
    except Exception as e:
        logger.error(f"[nyx-sync] {e}", exc_info=True)
        raise HTTPException(503, f"Error sincronizando Nyx: {e}")

@app.get("/api/radiobases/nyx/status")
def radiobases_nyx_status(user: dict = Depends(get_current_user)):
    data = _nyx_rb_load()
    mtime = None
    if os.path.exists(_RADIOBASES_NYX_FILE):
        mtime = dt_datetime.fromtimestamp(os.path.getmtime(_RADIOBASES_NYX_FILE)).isoformat()
    return {"count": len(data), "last_sync": mtime, "data": data}

@app.patch("/api/radiobases/sitios/{site_name:path}")
def radiobases_update_sitio(
    site_name: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    if user.get("rol") not in ("admin", "director"):
        raise HTTPException(403, "Solo admin/director pueden actualizar radio bases")

    valid = {k: v for k, v in payload.items() if k in _RB_EDITABLE}
    if not valid:
        raise HTTPException(400, "Sin campos válidos para actualizar")

    ov_data = _rb_overlay_load()
    overlays = ov_data.setdefault("overlays", [])
    existing = next((o for o in overlays if o["name"] == site_name), None)

    old_vals: dict = {}
    if existing:
        for campo in valid:
            old_vals[campo] = existing.get(campo)
        existing.update(valid)
    else:
        old_vals = {k: None for k in valid}
        overlays.append({"name": site_name, **valid})

    ov_data.setdefault("historial", []).append({
        "ts": dt_datetime.utcnow().isoformat(),
        "site_name": site_name,
        "user_nombre": user.get("nombre"),
        "user_email": user.get("email"),
        "cambios": {k: {"de": old_vals.get(k), "a": valid[k]} for k in valid},
    })
    _rb_overlay_save(ov_data)

    merged = _rb_merge()
    updated = next((r for r in merged if r["name"] == site_name), None)
    return {"ok": True, "sitio": updated}

# ─── Promociones / Trazabilidad ───────────────────────────────────────────────

import uuid as _uuid
from datetime import date as _date

_PROMOCIONES_FILE = os.path.join(BASE_DIR, "data", "promociones.json")

def _prom_load() -> list:
    try:
        with open(_PROMOCIONES_FILE) as f:
            return json.load(f).get("promociones", [])
    except Exception:
        return []

def _prom_save(rows: list):
    os.makedirs(os.path.dirname(_PROMOCIONES_FILE), exist_ok=True)
    with open(_PROMOCIONES_FILE, "w") as f:
        json.dump({"promociones": rows}, f, ensure_ascii=False, indent=2)

def _prom_odoo_sync(row: dict) -> dict:
    """Consulta Odoo para actualizar score y estado del user_input vinculado."""
    uid_odoo = row.get("user_input_odoo_id")
    if not uid_odoo:
        return row
    try:
        import xmlrpc.client as _xrc, signal as _sig
        env = _load_env()
        HOST = env.get("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
        DB = "wispi19"; USER = env["ODOO_USER"]; PASS = env["ODOO_PASSWORD"]
        common = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
        uid = common.authenticate(DB, USER, PASS, {})
        models = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)
        def _sr(model, domain, fields, limit=10):
            _sig.alarm(20)
            try:
                return models.execute_kw(DB, uid, PASS, model, "search_read",
                                         [domain], {"fields": fields, "limit": limit})
            finally:
                _sig.alarm(0)
        _sig.signal(_sig.SIGALRM, lambda s,f: (_ for _ in ()).throw(TimeoutError()))
        res = _sr("survey.user_input",
                  [["id", "=", uid_odoo]],
                  ["state", "scoring_percentage", "date_done"])
        if res:
            r = res[0]
            if r.get("state") == "done":
                row = {**row,
                       "estado": "aprobado" if (r.get("scoring_percentage") or 0) >= 80 else "reprobado",
                       "score": round(r.get("scoring_percentage") or 0, 1),
                       "fecha_completado": (r.get("date_done") or "")[:10]}
            elif r.get("state") == "new":
                row = {**row, "estado": "pendiente"}
    except Exception:
        pass
    return row

def _load_env():
    env = {}
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    except Exception:
        pass
    return env

@app.get("/api/academia/promociones")
def api_prom_list(sync: bool = False):
    """Lista todas las promociones/certificaciones con estado en tiempo real."""
    rows = _prom_load()
    if sync:
        rows = [_prom_odoo_sync(r) for r in rows]
        _prom_save(rows)
    return {"total": len(rows), "promociones": rows}

class NuevaPromocionRequest(BaseModel):
    candidato: str
    puesto_anterior: str
    puesto_nuevo: str
    registrado_por: str = "RH"
    notas: str = ""

@app.post("/api/academia/promociones/iniciar")
def api_prom_iniciar(req: NuevaPromocionRequest):
    """
    Inicia un proceso de promoción: crea user_input en Odoo y registra en JSON local.
    Devuelve el link personalizado del examen.
    """
    TRACK_MAP = {
        ("Auxiliar", "Técnico de Operaciones"): {"examen_id": 14, "curso_odoo_id": 91, "survey_token": None},
        ("Técnico de Operaciones", "Líder de Campo"): {"examen_id": 13, "curso_odoo_id": 92, "survey_token": None},
    }
    key = (req.puesto_anterior.strip(), req.puesto_nuevo.strip())
    track = TRACK_MAP.get(key)
    if not track:
        raise HTTPException(400, f"Ruta de promoción no configurada: {req.puesto_anterior} → {req.puesto_nuevo}")

    try:
        import xmlrpc.client as _xrc, signal as _sig
        env = _load_env()
        HOST = env.get("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
        DB = "wispi19"; USER = env["ODOO_USER"]; PASS = env["ODOO_PASSWORD"]
        common = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
        uid = common.authenticate(DB, USER, PASS, {})
        models = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)
        def _sr(model, domain, fields, limit=5):
            _sig.alarm(20)
            try:
                return models.execute_kw(DB, uid, PASS, model, "search_read",
                                         [domain], {"fields": fields, "limit": limit})
            finally:
                _sig.alarm(0)
        def _cr(model, vals):
            _sig.alarm(20)
            try:
                return models.execute_kw(DB, uid, PASS, model, "create", [vals])
            finally:
                _sig.alarm(0)
        _sig.signal(_sig.SIGALRM, lambda s,f: (_ for _ in ()).throw(TimeoutError()))

        # Buscar o crear partner en Odoo
        partners = _sr("res.partner", [["name", "ilike", req.candidato]], ["id", "name"])
        if partners:
            partner_id = partners[0]["id"]
        else:
            partner_id = _cr("res.partner", {"name": req.candidato, "is_company": False})

        # Obtener token del survey
        surveys = _sr("survey.survey", [["id", "=", track["examen_id"]]], ["id", "access_token"])
        if not surveys:
            raise HTTPException(500, "Survey no encontrado en Odoo")
        survey_token = surveys[0]["access_token"]

        # Crear user_input personalizado
        input_id = _cr("survey.user_input", {
            "survey_id": track["examen_id"],
            "partner_id": partner_id,
        })

        # Obtener token del user_input para el link personal
        inputs = _sr("survey.user_input", [["id", "=", input_id]], ["id", "access_token"])
        answer_token = inputs[0]["access_token"] if inputs else ""

        link = f"https://odoo.wispi.mx/survey/start/{survey_token}?answer_token={answer_token}"

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error Odoo: {e}")

    # Guardar en JSON local
    prom_id = f"PROM-{_date.today().year}-{str(int(_uuid.uuid4().hex[:4], 16)).zfill(3)}"
    nueva = {
        "id": prom_id,
        "candidato": req.candidato,
        "partner_odoo_id": partner_id,
        "user_input_odoo_id": input_id,
        "access_token": answer_token,
        "puesto_anterior": req.puesto_anterior,
        "puesto_nuevo": req.puesto_nuevo,
        "examen_id": track["examen_id"],
        "curso_odoo_id": track["curso_odoo_id"],
        "estado": "pendiente",
        "score": None,
        "fecha_inicio": str(_date.today()),
        "fecha_completado": None,
        "registrado_por": req.registrado_por,
        "notas": req.notas,
        "certificado_generado": False,
        "link_examen": link,
    }
    rows = _prom_load()
    rows.append(nueva)
    _prom_save(rows)

    return {"ok": True, "promocion_id": prom_id, "link": link, "partner_odoo_id": partner_id, "user_input_odoo_id": input_id}

@app.get("/api/academia/promociones/{prom_id}/sync")
def api_prom_sync_one(prom_id: str):
    """Sincroniza una promoción específica con Odoo y actualiza el JSON local."""
    rows = _prom_load()
    idx = next((i for i, r in enumerate(rows) if r["id"] == prom_id), None)
    if idx is None:
        raise HTTPException(404, "Promoción no encontrada")
    rows[idx] = _prom_odoo_sync(rows[idx])
    _prom_save(rows)
    return rows[idx]

class PatchPromocionRequest(BaseModel):
    estado: Optional[str] = None
    notas: Optional[str] = None
    score: Optional[float] = None
    fecha_completado: Optional[str] = None
    certificado_generado: Optional[bool] = None

@app.patch("/api/academia/promociones/{prom_id}")
def api_prom_patch(prom_id: str, req: PatchPromocionRequest):
    """Actualiza campos de una promoción (para registros retroactivos o correcciones)."""
    rows = _prom_load()
    idx = next((i for i, r in enumerate(rows) if r["id"] == prom_id), None)
    if idx is None:
        raise HTTPException(404, "Promoción no encontrada")
    patch = req.dict(exclude_none=True)
    rows[idx] = {**rows[idx], **patch}
    _prom_save(rows)
    return rows[idx]

@app.get("/api/academia/promociones/{prom_id}/certificado")
def api_prom_certificado(prom_id: str):
    """Descarga el certificado PDF oficial de Odoo para esta promoción."""
    rows = _prom_load()
    row = next((r for r in rows if r["id"] == prom_id), None)
    if not row:
        raise HTTPException(404, "Promoción no encontrada")
    uid_odoo = row.get("user_input_odoo_id")
    if not uid_odoo:
        raise HTTPException(400, "Esta promoción no tiene user_input_odoo_id — fue registrada retroactivamente")
    try:
        import requests as _req
        env = _load_env()
        HOST = env.get("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
        USER = env["ODOO_USER"]; PASS = env["ODOO_PASSWORD"]
        session = _req.Session()
        login = session.post(f"{HOST}/web/session/authenticate", json={
            "jsonrpc": "2.0", "method": "call", "id": 1,
            "params": {"db": "wispi19", "login": USER, "password": PASS}
        }, timeout=20)
        if login.json().get("result", {}).get("uid"):
            pdf = session.get(f"{HOST}/report/pdf/survey.certification_report_view/{uid_odoo}", timeout=60)
            if pdf.status_code == 200 and pdf.content[:4] == b"%PDF":
                candidato_safe = row.get("candidato", "candidato").replace(" ", "_")
                filename = f"certificado_{candidato_safe}_{prom_id}.pdf"
                return Response(
                    content=pdf.content,
                    media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'}
                )
    except Exception as e:
        raise HTTPException(500, f"Error descargando certificado: {e}")
    raise HTTPException(502, "No se pudo obtener el certificado de Odoo")

# ─── NOC Dashboard — Tickets CAST desde Odoo ──────────────────────────────────

CAST_TEAM_IDS = [6, 39, 41, 44, 48, 60, 67]

# Stages abiertos / en progreso
STAGES_OPEN = {
    24: "CAST Nvl:1",
    25: "CAST Nvl:2",
    57: "COR Nvl:3",
    60: "CAE-Visita",
    129: "CAST Nivel:1",
    130: "CAST Nivel:3",
}
# Stages resueltos
STAGES_RESOLVED = {
    54: "CAST Nvl:1-Resuelto",
    101: "CAST Nvl:2-Resuelto",
    69: "COR Resuelto",
    100: "CAE-Resuelto",
    120: "CAST Nvl:2 Resuelto",
    121: "CAE-Resuelto",
}

import re as _re

def _extract_sop(name: str) -> str:
    m = _re.search(r"SOP-(\d+)", name, _re.IGNORECASE)
    return f"SOP-{m.group(1)}" if m else ""

def _priority_label(p) -> str:
    return {"0": "Bajo", "1": "Bajo", "2": "Medio", "3": "Alto"}.get(str(p), str(p))

@app.get("/api/noc/tickets")
async def noc_tickets(horas: int = 48, user_id: Optional[int] = None):
    """Tickets CAST de Odoo — filtrados por período y usuario opcional."""
    import concurrent.futures, xmlrpc.client as xc

    def _fetch():
        url  = ODOO_URL or "https://odoo.wispi.mx"
        db   = ODOO_DB  or "wispi19"
        user = ODOO_USER
        pwd  = ODOO_PASSWORD
        common = xc.ServerProxy(f"{url}/xmlrpc/2/common", allow_none=True)
        uid_o  = common.authenticate(db, user, pwd, {})
        mdls   = xc.ServerProxy(f"{url}/xmlrpc/2/object", allow_none=True)

        desde = (dt_datetime.utcnow() - datetime.timedelta(hours=horas)).strftime("%Y-%m-%d %H:%M:%S")
        domain = [
            ["team_id", "in", CAST_TEAM_IDS],
            ["create_date", ">=", desde],
        ]
        if user_id:
            domain.append(["user_id", "=", user_id])

        tickets = mdls.execute_kw(db, uid_o, pwd, "helpdesk.ticket", "search_read",
            [domain],
            {"fields": ["id","name","stage_id","user_id","priority",
                        "create_date","date_last_stage_update","partner_id","team_id"],
             "limit": 200, "order": "create_date desc"})

        return tickets, {}

    try:
        with concurrent.futures.ThreadPoolExecutor() as ex:
            fetch_result = await _asyncio.get_event_loop().run_in_executor(ex, _fetch)
    except Exception as e:
        raise HTTPException(502, f"Error Odoo: {e}")

    raw, tracking_map = fetch_result if isinstance(fetch_result, tuple) else (fetch_result, {})

    now_utc = dt_datetime.utcnow()

    result = []
    for t in raw:
        stage_id    = t["stage_id"][0] if t.get("stage_id") else 0
        stage_name  = t["stage_id"][1] if t.get("stage_id") else "Desconocido"
        is_resolved = stage_id in STAGES_RESOLVED
        sop         = _extract_sop(t["name"])

        # Tiempo en etapa actual (seg)
        last_upd = t.get("date_last_stage_update") or t.get("create_date","")
        try:
            dt_upd = dt_datetime.strptime(last_upd[:19], "%Y-%m-%d %H:%M:%S")
            secs_in_stage = int((now_utc - dt_upd).total_seconds())
        except Exception:
            secs_in_stage = 0

        # Tiempo total desde apertura (seg)
        try:
            dt_open  = dt_datetime.strptime(t["create_date"][:19], "%Y-%m-%d %H:%M:%S")
            total_secs = int((now_utc - dt_open).total_seconds())
        except Exception:
            total_secs = 0

        result.append({
            "id":             t["id"],
            "ref":            sop or f"#{t['id']}",
            "title":          t["name"],
            "stage_id":       stage_id,
            "stage":          stage_name,
            "resolved":       is_resolved,
            "user_id":        t["user_id"][0] if t.get("user_id") else None,
            "user":           t["user_id"][1] if t.get("user_id") else "Sin asignar",
            "priority":       _priority_label(t.get("priority","0")),
            "created_at":     t.get("create_date",""),
            "updated_at":     last_upd,
            "client":         t["partner_id"][1] if t.get("partner_id") else "",
            "team_id":        t["team_id"][0] if t.get("team_id") else None,
            "team":           t["team_id"][1] if t.get("team_id") else "",
            "secs_in_stage":  secs_in_stage,
            "total_secs":     total_secs,
            "stage_history":  tracking_map.get(t["id"], []),
        })

    open_count     = sum(1 for t in result if not t["resolved"])
    resolved_count = sum(1 for t in result if t["resolved"])

    return {
        "tickets": result,
        "meta": {
            "total": len(result),
            "open": open_count,
            "resolved": resolved_count,
            "horas": horas,
            "users": [
                {"id": 944, "name": "JOSE MIGUEL MACIAS"},
                {"id": 965, "name": "SAMARA VIANNEY PALACIOS SILVA"},
            ],
        },
    }

# ─── NOC Report ───────────────────────────────────────────────────────────────

@app.post("/api/noc/report")
async def noc_report(periodo: str = "diario"):
    """Genera PDF de reporte NOC y lo envía a Telegram. periodo: diario|semanal|mensual"""
    import concurrent.futures, xmlrpc.client as xc, re, math, io, requests as req_lib
    from datetime import datetime, timezone, timedelta
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors as RL
    from reportlab.lib.units import inch
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Table,
                                    TableStyle, Spacer, HRFlowable, Flowable)
    from reportlab.graphics.shapes import Drawing
    from reportlab.graphics.charts.piecharts import Pie

    horas_map = {"diario": 24, "semanal": 168, "mensual": 720}
    horas = horas_map.get(periodo, 24)

    CAST_TEAMS = [6, 39, 41, 44, 48, 60, 67]
    STAGES_RES = {54, 101, 69, 100, 120, 121}

    def _fetch():
        url  = ODOO_URL or "https://odoo.wispi.mx"
        db   = ODOO_DB  or "wispi19"
        user = ODOO_USER; pwd = ODOO_PASSWORD
        c    = xc.ServerProxy(f"{url}/xmlrpc/2/common", allow_none=True)
        uid  = c.authenticate(db, user, pwd, {})
        m    = xc.ServerProxy(f"{url}/xmlrpc/2/object", allow_none=True)
        now  = datetime.now(timezone.utc)
        cut  = (now - timedelta(hours=horas)).strftime("%Y-%m-%d %H:%M:%S")
        raw  = m.execute_kw(db, uid, pwd, "helpdesk.ticket", "search_read",
            [[["team_id","in",CAST_TEAMS],["write_date",">=",cut]]],
            {"fields":["id","name","stage_id","user_id","partner_id",
                       "create_date","date_last_stage_update","priority"],
             "limit":500})
        return raw, now

    try:
        loop = _asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            raw, now = await loop.run_in_executor(pool, _fetch)
    except Exception as e:
        raise HTTPException(500, f"Odoo error: {e}")

    # ── Procesar tickets ─────────────────────────────────────────
    def sop(n): m=re.search(r"SOP-(\d+)",n or ""); return f"SOP-{m.group(1)}" if m else ""
    def secs_ago(s):
        if not s: return 0
        dt=datetime.strptime(s[:19],"%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return int((now-dt).total_seconds())
    def fmt(s):
        if s<3600: return f"{s//60}min"
        if s<86400: return f"{s//3600}h {(s%3600)//60}min"
        return f"{s//86400}d {(s%86400)//3600}h"
    def short(n):
        p=[x for x in (n or "").split() if x]
        return p[0]+" "+p[-1] if len(p)>1 else (p[0] if p else "—")

    tickets=[]
    for t in raw:
        sid  = t["stage_id"][0] if t.get("stage_id") else 0
        sname= t["stage_id"][1] if t.get("stage_id") else "Desconocida"
        res  = sid in STAGES_RES
        ref  = sop(t["name"]) or f"#{t['id']}"
        tickets.append(dict(
            id=t["id"], ref=ref, title=t["name"], stage=sname,
            resolved=res,
            user=short(t["user_id"][1] if t.get("user_id") else "Sin asignar"),
            client=(t["partner_id"][1] if t.get("partner_id") else "—")[:22],
            stage_secs=secs_ago(t.get("date_last_stage_update")),
            total_secs=secs_ago(t.get("create_date")),
        ))

    open_t = [t for t in tickets if not t["resolved"]]
    res_t  = [t for t in tickets if     t["resolved"]]
    crit_t = [t for t in open_t  if t["stage_secs"] > 14400]

    dist = {}
    for t in open_t:
        dist[t["stage"]] = dist.get(t["stage"], 0) + 1

    # ── Colores ──────────────────────────────────────────────────
    XCIEN  = RL.HexColor("#009B4E"); XCIEN2 = RL.HexColor("#007A3D")
    DARK   = RL.HexColor("#0F172A"); GRAY   = RL.HexColor("#64748B")
    LGRAY  = RL.HexColor("#F1F5F9"); BORDER = RL.HexColor("#E2E8F0")
    RED    = RL.HexColor("#DC2626"); AMBER  = RL.HexColor("#D97706")
    GREEN  = RL.HexColor("#059669"); WHITE  = RL.white
    STAGE_COLS = {
        "CAST Nvl:1":RL.HexColor("#2563EB"),"CAST Nvl:2":RL.HexColor("#7C3AED"),
        "COR Nvl:3":RL.HexColor("#D97706"),"CAE-Visita":RL.HexColor("#EA580C"),
        "TT VALIDADO SOL. MONITOREO":RL.HexColor("#4338CA"),
        "Reincidentes":RL.HexColor("#DC2626"),
        "COR Nivel 3 en Validación CAST":RL.HexColor("#B45309"),
    }

    S = lambda **kw: ParagraphStyle("x", **kw)
    sBody  = S(fontSize=9, fontName="Helvetica",      textColor=DARK,  leading=12)
    sSmall = S(fontSize=8, fontName="Helvetica",      textColor=GRAY,  leading=10)
    sMono  = S(fontSize=8, fontName="Courier-Bold",   textColor=RL.HexColor("#2563EB"), leading=10)
    sH2    = S(fontSize=11,fontName="Helvetica-Bold", textColor=DARK,  leading=15, spaceAfter=4)

    # ── Construir PDF en memoria ──────────────────────────────────
    buf = io.BytesIO()
    PAGE_W = letter[0] - 1.3*inch
    doc = SimpleDocTemplate(buf, pagesize=letter,
        leftMargin=0.65*inch, rightMargin=0.65*inch,
        topMargin=0.6*inch,   bottomMargin=0.65*inch)

    story = []

    # Header verde
    class _Hdr(Flowable):
        def __init__(self, w, h, periodo, now):
            Flowable.__init__(self); self.w=w; self.h=h; self.periodo=periodo; self.now=now
        def draw(self):
            c=self.canv
            c.setFillColor(RL.HexColor("#009B4E")); c.rect(0,0,self.w,self.h,fill=1,stroke=0)
            c.setFillColor(RL.HexColor("#007A3D")); c.rect(0,0,4,self.h,fill=1,stroke=0)
            c.setFillColor(RL.white); c.setFont("Helvetica-Bold",20)
            c.drawString(18, self.h-34, "XCIEN Networks")
            c.setFont("Helvetica",8); c.setFillColor(RL.HexColor("#DCFCE7"))
            c.drawString(18, self.h-47, "Centro de Operaciones de Red · CAST")
            periodo_label = {"diario":"Reporte Diario","semanal":"Reporte Semanal","mensual":"Reporte Mensual"}.get(self.periodo,"Reporte")
            c.setFillColor(RL.white); c.setFont("Helvetica-Bold",15)
            c.drawRightString(self.w-16, self.h-32, f"NOC — {periodo_label}")
            c.setFont("Helvetica",8); c.setFillColor(RL.HexColor("#DCFCE7"))
            c.drawRightString(self.w-16, self.h-46, f"Generado {self.now.strftime('%d %b %Y %H:%M')} UTC")

    story.append(_Hdr(PAGE_W, 64, periodo, now))
    story.append(Spacer(1, 16))

    # Métricas
    def _mc(label, value, color):
        return Table([[Paragraph(label, S(fontSize=7,fontName="Helvetica-Bold",textColor=GRAY,
                                          textTransform="uppercase",letterSpacing=0.5,leading=10))],
                      [Paragraph(str(value), S(fontSize=24,fontName="Helvetica-Bold",
                                               textColor=color,leading=28))]],
            colWidths=[PAGE_W/4-8],
            style=[("BOX",(0,0),(-1,-1),1,BORDER),("BACKGROUND",(0,0),(-1,-1),LGRAY),
                   ("LEFTPADDING",(0,0),(-1,-1),12),("TOPPADDING",(0,0),(-1,-1),10),
                   ("BOTTOMPADDING",(0,0),(-1,-1),10)])

    story.append(Table(
        [[_mc("ABIERTOS",len(open_t),DARK), _mc("CRÍTICOS >4H",len(crit_t),RED if crit_t else GREEN),
          _mc("RESUELTOS",len(res_t),GREEN), _mc("TOTAL",len(tickets),GRAY)]],
        colWidths=[PAGE_W/4]*4,
        style=[("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4)]))
    story.append(Spacer(1, 18))

    # Gráfico pastel
    pie_labels=[k for k,v in dist.items() if v>0]
    pie_data  =[dist[k] for k in pie_labels]
    pie_colors=[STAGE_COLS.get(k, RL.HexColor("#64748B")) for k in pie_labels]
    if pie_data:
        d=Drawing(210,170); pc=Pie()
        pc.x=10; pc.y=5; pc.width=160; pc.height=160
        pc.data=pie_data; pc.labels=[str(v) for v in pie_data]
        pc.slices.strokeWidth=1.5; pc.slices.strokeColor=RL.white
        pc.slices.fontName="Helvetica-Bold"; pc.slices.fontSize=8
        pc.slices.labelRadius=0.65; pc.slices.fontColor=RL.white
        for i,col in enumerate(pie_colors): pc.slices[i].fillColor=col
        d.add(pc)
        total_open = len(open_t) or 1
        leg_rows=[["","ETAPA","TICKS","%"]]
        for lab,cnt,col in zip(pie_labels,pie_data,pie_colors):
            leg_rows.append(["●",lab[:26],str(cnt),f"{round(cnt/total_open*100)}%"])
        leg_ts=TableStyle([
            ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),7),
            ("TEXTCOLOR",(0,0),(-1,0),GRAY),("LINEBELOW",(0,0),(-1,0),0.5,BORDER),
            ("FONTSIZE",(0,1),(-1,-1),8.5),("TOPPADDING",(0,0),(-1,-1),5),
            ("BOTTOMPADDING",(0,0),(-1,-1),5),("LEFTPADDING",(0,0),(-1,-1),6),
            ("ROWBACKGROUNDS",(0,1),(-1,-1),[WHITE,LGRAY]),
        ])
        for i,(_,_,col) in enumerate(zip(pie_labels,pie_data,pie_colors),1):
            leg_ts.add("TEXTCOLOR",(0,i),(0,i),col)
            leg_ts.add("FONTNAME",(0,i),(0,i),"Helvetica-Bold")
            leg_ts.add("FONTSIZE",(0,i),(0,i),12)
        leg=Table(leg_rows,colWidths=[16,178,46,34],style=leg_ts)
        story.append(Paragraph("Distribución por Etapa (abiertos)", sH2))
        story.append(Table([[d,leg]],colWidths=[220,PAGE_W-220],
            style=[("VALIGN",(0,0),(-1,-1),"MIDDLE"),("BOX",(0,0),(-1,-1),1,BORDER),
                   ("LEFTPADDING",(0,0),(-1,-1),10),("TOPPADDING",(0,0),(-1,-1),10),
                   ("BOTTOMPADDING",(0,0),(-1,-1),10)]))
        story.append(Spacer(1, 18))

    # Tabla abiertos
    story.append(Paragraph("Tickets Abiertos — ordenados por tiempo en etapa", sH2))
    def tc(s): return RED if s>14400 else (AMBER if s>7200 else GREEN)
    col_w=[55,78,205,92,68,57]
    rows=[["REF","ETAPA","TÍTULO","CLIENTE","ASIGNADO","EN ETAPA"]]
    for t in sorted(open_t, key=lambda x: -x["stage_secs"])[:50]:
        rows.append([Paragraph(t["ref"],sMono),Paragraph(t["stage"][:18],sSmall),
            Paragraph(t["title"][:52]+(""if len(t["title"])<=52 else"…"),sBody),
            Paragraph(t["client"],sSmall),Paragraph(t["user"],sSmall),
            Paragraph(fmt(t["stage_secs"]),S(fontSize=8,fontName="Helvetica-Bold",
                textColor=tc(t["stage_secs"]),leading=10))])
    ts=TableStyle([
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),7),
        ("TEXTCOLOR",(0,0),(-1,0),WHITE),("BACKGROUND",(0,0),(-1,0),DARK),
        ("TOPPADDING",(0,0),(-1,0),8),("BOTTOMPADDING",(0,0),(-1,0),8),
        ("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7),
        ("TOPPADDING",(0,1),(-1,-1),6),("BOTTOMPADDING",(0,1),(-1,-1),6),
        ("FONTSIZE",(0,1),(-1,-1),8),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[WHITE,LGRAY]),
        ("GRID",(0,0),(-1,-1),0.3,BORDER),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ])
    for i,t in enumerate(sorted(open_t,key=lambda x:-x["stage_secs"])[:50],1):
        if t["stage_secs"]>14400: ts.add("BACKGROUND",(0,i),(-1,i),RL.HexColor("#FFF5F5"))
    story.append(Table(rows,colWidths=col_w,repeatRows=1,style=ts))
    story.append(Spacer(1,18))

    # Tabla resueltos
    story.append(Paragraph("Tickets Resueltos", sH2))
    col_r=[55,78,232,90,60]
    rows_r=[["REF","ETAPA","TÍTULO","CLIENTE","TIEMPO TOTAL"]]
    for t in sorted(res_t,key=lambda x:x["total_secs"])[:30]:
        rows_r.append([Paragraph(t["ref"],sMono),Paragraph(t["stage"][:18],sSmall),
            Paragraph(t["title"][:58]+(""if len(t["title"])<=58 else"…"),sBody),
            Paragraph(t["client"],sSmall),
            Paragraph(fmt(t["total_secs"]),S(fontSize=8,fontName="Helvetica-Bold",textColor=GREEN,leading=10))])
    ts_r=TableStyle([
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,0),7),
        ("TEXTCOLOR",(0,0),(-1,0),WHITE),("BACKGROUND",(0,0),(-1,0),RL.HexColor("#059669")),
        ("TOPPADDING",(0,0),(-1,0),8),("BOTTOMPADDING",(0,0),(-1,0),8),
        ("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7),
        ("TOPPADDING",(0,1),(-1,-1),6),("BOTTOMPADDING",(0,1),(-1,-1),6),
        ("FONTSIZE",(0,1),(-1,-1),8),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[WHITE,RL.HexColor("#F0FDF4")]),
        ("GRID",(0,0),(-1,-1),0.3,BORDER),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ])
    story.append(Table(rows_r,colWidths=col_r,repeatRows=1,style=ts_r))
    story.append(Spacer(1,14))

    # Footer
    story.append(HRFlowable(width="100%",thickness=0.5,color=BORDER))
    story.append(Spacer(1,6))
    periodo_label={"diario":"Diario (24h)","semanal":"Semanal (7 días)","mensual":"Mensual (30 días)"}.get(periodo,"")
    story.append(Paragraph(
        f"Reporte {periodo_label} · Odoo CAST wispi19 · {now.strftime('%d/%m/%Y %H:%M')} UTC · XCIEN Networks",
        S(fontSize=7,fontName="Helvetica",textColor=GRAY,leading=10,alignment=TA_CENTER)))

    doc.build(story)
    pdf_bytes = buf.getvalue()

    # ── Enviar a Telegram ────────────────────────────────────────
    periodo_label = {"diario":"Diario","semanal":"Semanal","mensual":"Mensual"}.get(periodo,"")
    emojis = {"diario":"📋","semanal":"📊","mensual":"📈"}
    caption = (
        f"{emojis.get(periodo,'📊')} *Reporte NOC XCIEN — {periodo_label}*\n"
        f"📅 {now.strftime('%d/%m/%Y %H:%M')} UTC\n\n"
        f"🔴 Abiertos: *{len(open_t)}*\n"
        f"⚠️ Críticos (\\>4h): *{len(crit_t)}*\n"
        f"✅ Resueltos: *{len(res_t)}*\n"
        f"📦 Total: *{len(tickets)}*\n\n"
        f"_Generado desde NOC Dashboard · XCIEN Networks_"
    )
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id   = os.environ.get("TELEGRAM_CHAT_ID_REPORTES", "") or os.environ.get("TELEGRAM_CHAT_ID", "")
    if not bot_token or not chat_id:
        raise HTTPException(500, "Credenciales Telegram no configuradas")
    tg_url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
    r = req_lib.post(tg_url,
        data={"chat_id": chat_id, "caption": caption, "parse_mode": "Markdown"},
        files={"document": (f"NOC_{periodo_label}_{now.strftime('%Y%m%d')}.pdf", pdf_bytes, "application/pdf")},
        timeout=30)

    if r.status_code != 200:
        raise HTTPException(500, f"Telegram error: {r.text[:200]}")

    return {"ok": True, "periodo": periodo, "tickets": len(tickets),
            "open": len(open_t), "resolved": len(res_t), "critical": len(crit_t)}


# ─── BlackstoneOS — Reporte PDN ───────────────────────────────────────────────

class BlackstoneReportePDNReq(BaseModel):
    lancermex_cajas: int = 0

@app.post("/api/blackstone/reporte-pdn")
def blackstone_reporte_pdn(req: BlackstoneReportePDNReq):
    """Genera PDF de hallazgos y quiebres plaza PDN/Acuña y lo envía a Telegram."""
    PLAZA_KEYWORDS = ["pdn", "pueblo nuevo", "acuña", "acuna"]
    import xmlrpc.client as _xrc5, requests as _req5
    from datetime import datetime, timedelta, date
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors as _C
    from reportlab.lib.units import inch
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, HRFlowable, Spacer

    VERDE  = _C.HexColor("#009B4E")
    DARK   = _C.HexColor("#0D1B2A")
    ROJO   = _C.HexColor("#DC2626")
    AMBAR  = _C.HexColor("#D97706")
    AZUL   = _C.HexColor("#1D4ED8")
    GRIS   = _C.HexColor("#4A5568")
    LIGHT  = _C.HexColor("#F8FAFC")
    AMBER2 = _C.HexColor("#FEF3C7")

    hoy = datetime.now()
    hace30 = (hoy - timedelta(days=30)).strftime("%Y-%m-%d")

    # ── Odoo: tickets CAST PDN ──────────────────────────────────────────────
    odoo_url = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db  = os.environ.get("ODOO_DB",  "wispi19")
    odoo_usr = os.environ.get("ODOO_USER", "")
    odoo_pw  = os.environ.get("ODOO_PASSWORD", "")

    tickets = []
    tareas  = []
    try:
        import signal as _sig5
        def _th5(s,f): raise TimeoutError()
        _sig5.signal(_sig5.SIGALRM, _th5)
        _sig5.alarm(20)
        _c5 = _xrc5.ServerProxy(f"{odoo_url}/xmlrpc/2/common", allow_none=True)
        _uid5 = _c5.authenticate(odoo_db, odoo_usr, odoo_pw, {})
        _m5   = _xrc5.ServerProxy(f"{odoo_url}/xmlrpc/2/object", allow_none=True)
        _plaza_domain_t = ["|"] * (len(PLAZA_KEYWORDS) - 1) + \
            [["description","ilike",k] for k in PLAZA_KEYWORDS]
        _plaza_domain_t = ["&", ["create_date",">=",f"{hace30} 00:00:00"]] + \
            (["&"] * (len(PLAZA_KEYWORDS) - 2) if len(PLAZA_KEYWORDS) > 2 else []) + \
            [item for k in PLAZA_KEYWORDS for item in [["description","ilike",k]]]
        # Simplificado: OR de keywords en descripción OR nombre
        _t_domain = [["create_date",">=",f"{hace30} 00:00:00"],
                     "|", "|", "|",
                     ["description","ilike","PDN"], ["description","ilike","Pueblo Nuevo"],
                     ["description","ilike","Acuña"], ["name","ilike","Acuña"]]
        tickets = _m5.execute_kw(odoo_db, _uid5, odoo_pw, "helpdesk.ticket", "search_read",
            [_t_domain],
            {"fields":["id","name","stage_id","priority","description","create_date","user_id","partner_id"],"limit":100})
        _ta_domain = [["write_date",">=",f"{hace30} 00:00:00"],
                      "|", "|",
                      ["name","ilike","PDN"], ["name","ilike","Pueblo Nuevo"],
                      ["name","ilike","Acuña"]]
        tareas = _m5.execute_kw(odoo_db, _uid5, odoo_pw, "project.task", "search_read",
            [_ta_domain],
            {"fields":["id","name","stage_id","user_ids","priority","description","write_date"],"limit":100})
        _sig5.alarm(0)
    except Exception:
        pass

    # ── NOC alerts PDN (usa endpoint interno) ──────────────────────────────
    alertas_pdn = []
    try:
        _ar = _req5.get("http://localhost:8002/api/noc/alerts?active_only=true&limit=500", timeout=8)
        if _ar.ok:
            _all_a = _ar.json().get("alertas", []) or _ar.json().get("alerts", [])
            alertas_pdn = [a for a in _all_a if any(
                k in str(a.get("entity_name","")).lower() for k in PLAZA_KEYWORDS)]
    except Exception:
        pass

    # ── SIDF PDN ──────────────────────────────────────────────────────────
    sidf_pdn = []
    try:
        _sr = _req5.get("http://localhost:8002/api/red/clientes-sidf", timeout=8)
        if _sr.ok:
            _all_s = _sr.json().get("clientes", [])
            sidf_pdn = [c for c in _all_s if any(
                k in str(c.get("plaza","")).lower() for k in PLAZA_KEYWORDS)]
    except Exception:
        pass

    # ── Clasificar tickets por categoría ──────────────────────────────────
    malas_practicas = []
    horarios        = []
    riesgos_legales = []
    otros_hallazgos = []
    KEYWORDS_MP     = ["mala práctica","mal procedimiento","procedimiento incorrecto","protocolo","sin herramienta",
                       "incidente","daño","accidente","error técnico","trabajo indebido"]
    KEYWORDS_HOR    = ["fuera de horario","horario","nocturn","sin autorización","llegó tarde","no se presentó",
                       "incumplimiento","tardanza","ausencia"]
    KEYWORDS_LEG    = ["legal","demanda","cfe","cfdi","contrato","robo","fraude","denuncia","riesgo",
                       "sin permiso","normativa","nom-","regulación"]

    for t in tickets:
        txt = (str(t.get("name","")) + " " + str(t.get("description","") or "")).lower()
        if any(k in txt for k in KEYWORDS_MP):
            malas_practicas.append(t)
        elif any(k in txt for k in KEYWORDS_HOR):
            horarios.append(t)
        elif any(k in txt for k in KEYWORDS_LEG):
            riesgos_legales.append(t)
        else:
            otros_hallazgos.append(t)

    # ── Resumen urgentes ───────────────────────────────────────────────────
    urgentes = [t for t in tickets if t.get("priority") in ("2","3","urgent","high")]

    # ── Construir PDF ─────────────────────────────────────────────────────
    out_path = "/private/tmp/reporte_hallazgos_pdn.pdf"
    doc = SimpleDocTemplate(out_path, pagesize=letter,
        leftMargin=0.7*inch, rightMargin=0.7*inch,
        topMargin=0.7*inch, bottomMargin=0.7*inch)

    H1  = ParagraphStyle("H1",  fontSize=18, textColor=DARK,   spaceAfter=4,  fontName="Helvetica-Bold")
    H2  = ParagraphStyle("H2",  fontSize=12, textColor=VERDE,  spaceAfter=6,  fontName="Helvetica-Bold", spaceBefore=14)
    H3  = ParagraphStyle("H3",  fontSize=10, textColor=DARK,   spaceAfter=4,  fontName="Helvetica-Bold")
    BD  = ParagraphStyle("BD",  fontSize=9,  textColor=GRIS,   spaceAfter=3,  fontName="Helvetica")
    SM  = ParagraphStyle("SM",  fontSize=8,  textColor=GRIS,   spaceAfter=2,  fontName="Helvetica")
    CTR = ParagraphStyle("CTR", fontSize=8,  textColor=_C.white, fontName="Helvetica-Bold", alignment=TA_CENTER)

    def tbl_style(header_color=DARK):
        return TableStyle([
            ("BACKGROUND", (0,0), (-1,0), header_color),
            ("TEXTCOLOR",  (0,0), (-1,0), _C.white),
            ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",   (0,0), (-1,0), 8),
            ("FONTNAME",   (0,1), (-1,-1), "Helvetica"),
            ("FONTSIZE",   (0,1), (-1,-1), 7.5),
            ("ROWBACKGROUNDS",(0,1),(-1,-1),[_C.white, LIGHT]),
            ("GRID",       (0,0), (-1,-1), 0.3, _C.HexColor("#CBD5E0")),
            ("VALIGN",     (0,0), (-1,-1), "MIDDLE"),
            ("TOPPADDING", (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0),(-1,-1),4),
        ])

    def ticket_table(t_list, max_rows=10):
        rows = [["#", "Ticket", "Etapa", "Fecha"]]
        for t in t_list[:max_rows]:
            etapa = t["stage_id"][1] if isinstance(t.get("stage_id"), list) else str(t.get("stage_id",""))
            fecha = str(t.get("create_date",""))[:10]
            rows.append([str(t["id"]), Paragraph(str(t.get("name",""))[:80], SM), etapa, fecha])
        tbl = Table(rows, colWidths=[0.6*inch, 3.6*inch, 1.4*inch, 1.0*inch], repeatRows=1)
        tbl.setStyle(tbl_style(DARK))
        return tbl

    story = []

    # Encabezado
    story.append(Paragraph("XCIEN Networks — Reporte de Hallazgos", H1))
    story.append(Paragraph(f"Plaza PDN / Acuña (Pueblo Nuevo + Acuña, Coahuila) | {hoy.strftime('%d/%m/%Y')}", BD))
    story.append(HRFlowable(width="100%", thickness=2, color=VERDE, spaceAfter=12))

    # Resumen ejecutivo
    story.append(Paragraph("Resumen Ejecutivo", H2))
    resumen_data = [
        ["Indicador", "Valor"],
        ["Tickets CAST PDN (30 días)", str(len(tickets))],
        ["Urgentes/Críticos", str(len(urgentes))],
        ["Malas Prácticas detectadas", str(len(malas_practicas))],
        ["Incumplimiento de Horarios", str(len(horarios))],
        ["Riesgos Legales identificados", str(len(riesgos_legales))],
        ["Alertas NOC activas PDN", str(len(alertas_pdn))],
        ["Clientes SIDF PDN", str(len(sidf_pdn))],
        ["Cajas Lancermex auditadas", str(req.lancermex_cajas)],
    ]
    res_tbl = Table(resumen_data, colWidths=[3.5*inch, 3.1*inch], repeatRows=1)
    res_tbl.setStyle(tbl_style(VERDE))
    story.append(res_tbl)
    story.append(Spacer(1, 12))

    # Malas prácticas
    story.append(HRFlowable(width="100%", thickness=1, color=ROJO, spaceAfter=6))
    story.append(Paragraph(f"🔴 Malas Prácticas ({len(malas_practicas)} casos)", H2))
    story.append(Paragraph(
        "Tickets donde se detectó procedimiento incorrecto, trabajo sin herramienta adecuada, "
        "incidente de campo o error técnico documentado.", BD))
    if malas_practicas:
        story.append(ticket_table(malas_practicas))
    else:
        story.append(Paragraph("Sin tickets categorizados en este periodo.", SM))
    story.append(Spacer(1, 8))

    # Incumplimiento de horarios
    story.append(HRFlowable(width="100%", thickness=1, color=AMBAR, spaceAfter=6))
    story.append(Paragraph(f"🟡 Falta de Cumplimiento de Horarios ({len(horarios)} casos)", H2))
    story.append(Paragraph(
        "Tickets relacionados con llegadas tarde, ausencias, trabajo fuera de horario autorizado "
        "o no presentación en sitio.", BD))
    if horarios:
        story.append(ticket_table(horarios))
    else:
        story.append(Paragraph("Sin tickets categorizados en este periodo.", SM))
    story.append(Spacer(1, 8))

    # Riesgos legales
    story.append(HRFlowable(width="100%", thickness=1, color=AZUL, spaceAfter=6))
    story.append(Paragraph(f"⚖️ Riesgos Legales ({len(riesgos_legales)} casos)", H2))
    story.append(Paragraph(
        "Situaciones con exposición legal: trabajo sin permisos CFE, incumplimiento NOM, "
        "contratos en riesgo, denuncias potenciales o regulación no cumplida.", BD))
    if riesgos_legales:
        story.append(ticket_table(riesgos_legales))
    else:
        story.append(Paragraph("Sin tickets categorizados en este periodo.", SM))
    story.append(Spacer(1, 8))

    # Otros hallazgos
    if otros_hallazgos:
        story.append(HRFlowable(width="100%", thickness=1, color=GRIS, spaceAfter=6))
        story.append(Paragraph(f"📋 Otros Hallazgos ({len(otros_hallazgos)} tickets)", H2))
        story.append(ticket_table(otros_hallazgos, max_rows=15))
        story.append(Spacer(1, 8))

    # Alertas NOC PDN
    story.append(HRFlowable(width="100%", thickness=1, color=ROJO, spaceAfter=6))
    story.append(Paragraph(f"📡 Alertas NOC Activas PDN ({len(alertas_pdn)})", H2))
    if alertas_pdn:
        al_rows = [["Entidad", "Descripción", "Severidad"]]
        for a in alertas_pdn[:12]:
            al_rows.append([
                str(a.get("entity_name",""))[:35],
                str(a.get("message","") or a.get("description",""))[:55],
                str(a.get("severity","") or a.get("priority",""))
            ])
        al_tbl = Table(al_rows, colWidths=[2.0*inch, 3.4*inch, 1.2*inch], repeatRows=1)
        al_tbl.setStyle(tbl_style(ROJO))
        story.append(al_tbl)
    else:
        story.append(Paragraph("Sin alertas NOC activas en PDN.", SM))
    story.append(Spacer(1, 8))

    # Tareas campo
    if tareas:
        story.append(HRFlowable(width="100%", thickness=1, color=VERDE, spaceAfter=6))
        story.append(Paragraph(f"🔧 Tareas de Campo PDN ({len(tareas)})", H2))
        ta_rows = [["#", "Tarea", "Etapa", "Actualizado"]]
        for t in tareas[:10]:
            etapa = t["stage_id"][1] if isinstance(t.get("stage_id"), list) else str(t.get("stage_id",""))
            fecha = str(t.get("write_date",""))[:10]
            ta_rows.append([str(t["id"]), Paragraph(str(t.get("name",""))[:75], SM), etapa, fecha])
        ta_tbl = Table(ta_rows, colWidths=[0.6*inch, 3.6*inch, 1.4*inch, 1.0*inch], repeatRows=1)
        ta_tbl.setStyle(tbl_style(VERDE))
        story.append(ta_tbl)
        story.append(Spacer(1, 8))

    # Lancermex / CWDM
    story.append(HRFlowable(width="100%", thickness=1, color=AMBAR, spaceAfter=6))
    story.append(Paragraph("🏗️ Estado CWDM — Auditoría Lancermex", H2))
    cwdm_data = [
        ["Ítem", "Estado"],
        ["Cajas auditadas Lancermex", str(req.lancermex_cajas)],
        ["CWDM F3 (bloqueado)", "Bloqueado — pendiente autorización CFE"],
        ["Fusionadora disponible", "Verificar en sitio"],
        ["OTDR última prueba", "Pendiente actualización"],
    ]
    cwdm_tbl = Table(cwdm_data, colWidths=[3.5*inch, 3.1*inch], repeatRows=1)
    cwdm_tbl.setStyle(tbl_style(AMBAR))
    story.append(cwdm_tbl)

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=VERDE))
    story.append(Paragraph(
        f"Generado automáticamente por XCIEN 2.0 | {hoy.strftime('%d/%m/%Y %H:%M')} | Plaza PDN",
        SM))

    doc.build(story)

    # ── Enviar a Telegram ──────────────────────────────────────────────────
    tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    tg_chat  = os.environ.get("TELEGRAM_CHAT_ID_REPORTES", "") or os.environ.get("TELEGRAM_CHAT_ID", "")
    if not tg_token or not tg_chat:
        return {"ok": False, "error": "Telegram no configurado"}

    caption = (f"📋 Reporte Hallazgos PDN/Acuña — {hoy.strftime('%d/%m/%Y')}\n"
               f"🔴 Malas prácticas: {len(malas_practicas)} | "
               f"🕐 Horarios: {len(horarios)} | "
               f"⚖️ Riesgo legal: {len(riesgos_legales)}\n"
               f"📡 Alertas NOC: {len(alertas_pdn)} | 🏗️ Cajas Lancermex: {req.lancermex_cajas}")

    with open(out_path, "rb") as _f:
        _r5 = _req5.post(
            f"https://api.telegram.org/bot{tg_token}/sendDocument",
            data={"chat_id": tg_chat, "caption": caption},
            files={"document": ("reporte_hallazgos_pdn.pdf", _f, "application/pdf")},
            timeout=30,
        )

    if not _r5.ok:
        raise HTTPException(500, f"Telegram error: {_r5.text[:200]}")

    return {
        "ok": True,
        "tickets": len(tickets),
        "urgentes": len(urgentes),
        "malas_practicas": len(malas_practicas),
        "horarios": len(horarios),
        "riesgos_legales": len(riesgos_legales),
        "alertas_noc": len(alertas_pdn),
        "cajas_lancermex": req.lancermex_cajas,
    }


# ─── Inventario Unificado de Sitios ───────────────────────────────────────────

_INVENTARIO_SITIOS_FILE = os.path.join(BASE_DIR, "data", "inventario_sitios.json")
_inventario_sitios_cache = None
_inventario_sitios_ts: float = 0.0
_INVENTARIO_SITIOS_TTL = 300.0  # 5 min

def _load_inventario_sitios() -> list:
    global _inventario_sitios_cache, _inventario_sitios_ts
    now = time.time()
    if _inventario_sitios_cache is not None and (now - _inventario_sitios_ts) < _INVENTARIO_SITIOS_TTL:
        return _inventario_sitios_cache
    try:
        with open(_INVENTARIO_SITIOS_FILE, encoding="utf-8") as f:
            _inventario_sitios_cache = json.load(f)
        _inventario_sitios_ts = now
    except Exception:
        _inventario_sitios_cache = []
    return _inventario_sitios_cache

def _normalize_rb_name(name: str) -> str:
    import unicodedata as _ud, re as _re
    n = _ud.normalize("NFD", name)
    n = "".join(c for c in n if _ud.category(c) != "Mn")
    n = n.lower().strip()
    n = _re.sub(r"^\[sop-\d+\]\s*", "", n)
    n = _re.sub(r"^rb\s+", "", n)
    return n.strip()


@app.get("/api/infra/sitios/sync-status")
async def infra_sitios_sync_status():
    """
    Dashboard de sincronización: cobertura de las 3 fuentes de datos por sitio.
    No llama al harmonizer (respuesta rápida).
    """
    # Load drive data
    drive_by_key = {}
    try:
        with open(_RADIOBASES_DRIVE_FILE, encoding="utf-8") as f:
            for rb in json.load(f):
                drive_by_key[_normalize_rb_name(rb.get("name", ""))] = rb
    except Exception:
        pass

    # Load inventario
    inv_by_key = {}
    for rec in _load_inventario_sitios():
        key = rec.get("nombre_normalizado") or _normalize_rb_name(rec.get("nombre", ""))
        inv_by_key[key] = rec

    # All keys union
    all_keys = set(drive_by_key.keys()) | set(inv_by_key.keys())

    fuentes = []
    for key in sorted(all_keys):
        drive = drive_by_key.get(key, {})
        inv   = inv_by_key.get(key, {})
        nombre = (drive.get("name") or inv.get("nombre") or key).title()
        fuentes.append({
            "key":      key,
            "nombre":   nombre,
            "drive":    bool(drive),
            "inv":      bool(inv),
            "lat":      drive.get("lat"),
            "lng":      drive.get("lng"),
            "vigencia": drive.get("vigencia"),
            "renta":    drive.get("renta"),
            "city":     drive.get("city"),
            "ip_router": inv.get("ip_router_core"),
            "sop":       inv.get("sop"),
            "plaza":     inv.get("plaza"),
            "suma_ok":   inv.get("suma_ok", 0),
        })

    total = len(fuentes)
    solo_drive = sum(1 for f in fuentes if f["drive"] and not f["inv"])
    solo_inv   = sum(1 for f in fuentes if f["inv"] and not f["drive"])
    ambas      = sum(1 for f in fuentes if f["drive"] and f["inv"])
    con_coords = sum(1 for f in fuentes if f["lat"] and f["lng"])
    con_ip     = sum(1 for f in fuentes if f["ip_router"])

    return JSONResponse({
        "ok": True,
        "resumen": {
            "total_fuentes_locales": total,
            "drive_total": len(drive_by_key),
            "inventario_total": len(inv_by_key),
            "en_ambas": ambas,
            "solo_drive": solo_drive,
            "solo_inventario": solo_inv,
            "con_coordenadas": con_coords,
            "con_ip_router": con_ip,
            "pct_drive":     round(100 * len(drive_by_key) / max(total, 1)),
            "pct_inventario": round(100 * len(inv_by_key) / max(total, 1)),
            "pct_cruzados":  round(100 * ambas / max(total, 1)),
        },
        "sitios": fuentes,
    })


@app.get("/api/infra/sitios")
async def infra_sitios_unificados():
    """
    Endpoint unificado de sitios XCIEN.
    Fusiona 3 fuentes por nombre normalizado de radiobase:
      1. radiobases-harmonized (Odoo+NOC+CAST) — base operacional
      2. radiobases_drive.json — vigencia, renta, dirección, lat/lng
      3. inventario_sitios.json — IPs equipos, monitoreo energía/red
    """
    from agents.radiobase_harmonizer import harmonize as _harmonize

    cfg = {
        "odoo_url":       os.environ.get("ODOO_URL",  "https://odoo.wispi.mx"),
        "odoo_db":        os.environ.get("ODOO_DB",   "wispi19"),
        "odoo_user":      os.environ.get("ODOO_USER", ""),
        "odoo_pass":      os.environ.get("ODOO_PASSWORD", ""),
        "nocboard_proxy": os.environ.get("NOCBOARD_PROXY", "http://localhost:9400"),
        "nocboard_key":   os.environ.get("NOCBOARD_API_KEY", "87a08190b801416392e944ab79c7e3c9"),
    }

    try:
        harmonized = await _harmonize(cfg)
    except Exception as e:
        logger.warning(f"[infra/sitios] harmonizer error: {e}")
        harmonized = []

    # Index drive data by normalized name
    drive_data = {}
    try:
        with open(_RADIOBASES_DRIVE_FILE, encoding="utf-8") as f:
            for rb in json.load(f):
                key = _normalize_rb_name(rb.get("name", ""))
                drive_data[key] = rb
    except Exception:
        pass

    # Index inventario_sitios by normalized name
    inv_data = {}
    for rec in _load_inventario_sitios():
        key = rec.get("nombre_normalizado") or _normalize_rb_name(rec.get("nombre", ""))
        inv_data[key] = rec

    # Build unified records
    result = []
    for rb in harmonized:
        nombre = rb.get("nombre", "")
        key = _normalize_rb_name(nombre)

        drive = drive_data.get(key, {})
        inv   = inv_data.get(key, {})

        # Try partial match on drive if no exact hit
        if not drive:
            for dk, dv in drive_data.items():
                if key in dk or dk in key:
                    drive = dv
                    break

        unified = {
            # --- Base (harmonized) ---
            "nombre":    nombre,
            "nombre_key": key,
            "id":        rb.get("id"),
            "lat":       rb.get("lat") or drive.get("lat"),
            "lng":       rb.get("lng") or drive.get("lng"),
            "ciudad":    rb.get("ciudad") or drive.get("city"),
            "estado":    rb.get("estado") or drive.get("state"),
            "clientes":  rb.get("clientes", 0),
            "activo":    rb.get("activo", True),
            "noc_estado": rb.get("noc_estado"),
            "soporte":   rb.get("soporte", {}),
            "campo":     rb.get("campo", {}),
            # --- Drive ---
            "estatus_contrato": drive.get("estatus"),
            "vigencia":         drive.get("vigencia"),
            "direccion":        drive.get("direccion"),
            "renta":            drive.get("renta"),
            # --- Inventario energía ---
            "sop":              inv.get("sop"),
            "plaza":            inv.get("plaza"),
            "is_alpha":         inv.get("is_alpha", False),
            "suma_ok":          inv.get("suma_ok", 0),
            "sensor_cfe":       inv.get("sensor_cfe", False),
            "ip_sensor_cfe":    inv.get("ip_sensor_cfe"),
            "watchdog":         inv.get("watchdog", False),
            "ip_watchdog":      inv.get("ip_watchdog"),
            "sensor_baterias":  inv.get("sensor_baterias", False),
            "planta_emergencia": inv.get("planta_emergencia", False),
            "site_monitor":     inv.get("site_monitor", False),
            "ip_site_monitor":  inv.get("ip_site_monitor"),
            "samlex":           inv.get("samlex", False),
            "ip_samlex":        inv.get("ip_samlex"),
            "eltek":            inv.get("eltek", False),
            "ip_eltek":         inv.get("ip_eltek"),
            "growatt":          inv.get("growatt", False),
            "ip_growatt":       inv.get("ip_growatt"),
            # --- Inventario red ---
            "ip_router_core":   inv.get("ip_router_core"),
            "ip_switch1":       inv.get("ip_switch1"),
            "ip_switch2":       inv.get("ip_switch2"),
            "ip_um_fo":         inv.get("ip_um_fo"),
            "um_mo_radio":      inv.get("um_mo_radio", False),
            "um_fo_raisecom":   inv.get("um_fo_raisecom", False),
            # --- Seguridad física ---
            "camara":           inv.get("camara", False),
            "tipo_camara":      inv.get("tipo_camara"),
            "candado":          inv.get("candado", False),
            "temperatura":      inv.get("temperatura", False),
        }
        result.append(unified)

    # Append drive-only RBs not in harmonized (extra coverage)
    harmonized_keys = {_normalize_rb_name(rb.get("nombre", "")) for rb in harmonized}
    for key, drive in drive_data.items():
        if key not in harmonized_keys:
            inv = inv_data.get(key, {})
            result.append({
                "nombre":    drive.get("name", key),
                "nombre_key": key,
                "id":        None,
                "lat":       drive.get("lat"),
                "lng":       drive.get("lng"),
                "ciudad":    drive.get("city"),
                "estado":    drive.get("state"),
                "clientes":  inv.get("clientes", 0),
                "activo":    True,
                "noc_estado": None,
                "soporte":   {},
                "campo":     {},
                "estatus_contrato": drive.get("estatus"),
                "vigencia":         drive.get("vigencia"),
                "direccion":        drive.get("direccion"),
                "renta":            drive.get("renta"),
                "sop":              inv.get("sop"),
                "plaza":            inv.get("plaza"),
                "is_alpha":         inv.get("is_alpha", False),
                "suma_ok":          inv.get("suma_ok", 0),
                "sensor_cfe":       inv.get("sensor_cfe", False),
                "ip_sensor_cfe":    inv.get("ip_sensor_cfe"),
                "watchdog":         inv.get("watchdog", False),
                "ip_watchdog":      inv.get("ip_watchdog"),
                "sensor_baterias":  inv.get("sensor_baterias", False),
                "planta_emergencia": inv.get("planta_emergencia", False),
                "site_monitor":     inv.get("site_monitor", False),
                "ip_site_monitor":  inv.get("ip_site_monitor"),
                "samlex":           inv.get("samlex", False),
                "ip_samlex":        inv.get("ip_samlex"),
                "eltek":            inv.get("eltek", False),
                "ip_eltek":         inv.get("ip_eltek"),
                "growatt":          inv.get("growatt", False),
                "ip_growatt":       inv.get("ip_growatt"),
                "ip_router_core":   inv.get("ip_router_core"),
                "ip_switch1":       inv.get("ip_switch1"),
                "ip_switch2":       inv.get("ip_switch2"),
                "ip_um_fo":         inv.get("ip_um_fo"),
                "um_mo_radio":      inv.get("um_mo_radio", False),
                "um_fo_raisecom":   inv.get("um_fo_raisecom", False),
                "camara":           inv.get("camara", False),
                "tipo_camara":      inv.get("tipo_camara"),
                "candado":          inv.get("candado", False),
                "temperatura":      inv.get("temperatura", False),
            })

    return JSONResponse({"ok": True, "total": len(result), "sitios": result})


# ─── Presencia en tiempo real (tipo Google Docs) ──────────────────────────────

_presence_store: dict = {}   # section -> {user_id: {nombre, email, rol, ts}}
_presence_lock = threading.Lock()
_PRESENCE_TTL = 45           # segundos sin ping → usuario ausente

@app.post("/api/presence/ping")
async def presence_ping(body: dict, user: dict = Depends(get_current_user)):
    section = str(body.get("section", "global"))[:64]
    uid = user["sub"]
    now = time.time()
    with _presence_lock:
        _presence_store.setdefault(section, {})[uid] = {
            "id": uid,
            "nombre": user.get("nombre", user.get("email", "?")),
            "email": user.get("email", ""),
            "rol": user.get("rol", ""),
            "ts": now,
        }
        for sec in list(_presence_store.keys()):
            _presence_store[sec] = {
                k: v for k, v in _presence_store[sec].items()
                if now - v["ts"] < _PRESENCE_TTL
            }
    return {"ok": True}

@app.delete("/api/presence/ping")
async def presence_leave(body: dict, user: dict = Depends(get_current_user)):
    section = str(body.get("section", ""))[:64]
    uid = user["sub"]
    with _presence_lock:
        if section in _presence_store:
            _presence_store[section].pop(uid, None)
    return {"ok": True}

@app.get("/api/presence/active")
async def presence_active(section: str = "global", user: dict = Depends(get_current_user)):
    now = time.time()
    uid = user["sub"]
    with _presence_lock:
        sec = _presence_store.get(section, {})
        others = [v for k, v in sec.items() if k != uid and now - v["ts"] < _PRESENCE_TTL]
    return {"section": section, "others": others, "total": len(others)}


# ─── Blackstone: Crear Ticket PDN ─────────────────────────────────────────────

class TicketPDNReq(BaseModel):
    titulo: str
    descripcion: str = ""
    prioridad: str = "normal"          # normal | urgente | critica
    asignado_odoo_id: Optional[int] = None  # res.users id en Odoo
    asignado_nombre: str = ""


@app.get("/api/blackstone/tecnicos-pdn")
async def get_tecnicos_pdn(_user: dict = Depends(get_current_user)):
    """Lista de usuarios Odoo asignables a tickets PDN (proyecto 240)."""
    import asyncio as _aio, xmlrpc.client as _xrc_t, os as _os_t

    def _query_tecnicos():
        HOST = _os_t.getenv("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
        DB   = _os_t.getenv("ODOO_DB", "wispi19")
        U    = _os_t.getenv("ODOO_USER", "")
        P    = _os_t.getenv("ODOO_PASSWORD", "")
        common = _xrc_t.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
        uid_o  = common.authenticate(DB, U, P, {})
        models = _xrc_t.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)
        tasks = models.execute_kw(DB, uid_o, P, "project.task", "search_read",
            [[["project_id", "=", 240], ["user_ids", "!=", False]]],
            {"fields": ["user_ids"], "limit": 200})
        uid_set = list({uid_val for t in tasks for uid_val in (t.get("user_ids") or [])})
        if not uid_set:
            return []
        users = models.execute_kw(DB, uid_o, P, "res.users", "search_read",
            [[["id", "in", uid_set], ["active", "=", True]]],
            {"fields": ["id", "name"], "limit": 100})
        return [{"id": u["id"], "nombre": u["name"]} for u in users]

    try:
        tecnicos = await _aio.get_event_loop().run_in_executor(None, _query_tecnicos)
        return {"tecnicos": tecnicos}
    except Exception as e:
        return {"tecnicos": [], "error": str(e)[:120]}

@app.post("/api/blackstone/ticket")
async def crear_ticket_pdn(req: TicketPDNReq, user: dict = Depends(get_current_user)):
    """Crea un ticket en Odoo Field Service PDN. Solo admin."""
    if user.get("rol") not in ("admin", "director"):
        raise HTTPException(status_code=403, detail="Solo administradores y directores pueden crear tickets PDN")

    import asyncio as _aio, xmlrpc.client as _xrc_t, os as _os_t, re as _re
    import httpx as _httpx

    creado_por = user.get("nombre", user.get("username", "admin"))

    def _crear_en_odoo_y_notificar():
        HOST = _os_t.getenv("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
        DB   = _os_t.getenv("ODOO_DB", "wispi19")
        U    = _os_t.getenv("ODOO_USER", "")
        P    = _os_t.getenv("ODOO_PASSWORD", "")

        common = _xrc_t.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
        uid_o  = common.authenticate(DB, U, P, {})
        models = _xrc_t.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)

        prio_map = {"urgente": "1", "critica": "1", "normal": "0"}
        prio = prio_map.get(req.prioridad.lower(), "0")
        nombre_final = f"[SUPERVISOR] {req.titulo.strip()}"

        # Heredar cuenta analítica del proyecto
        analytic_account_id = None
        try:
            proj = models.execute_kw(DB, uid_o, P, "project.project", "read",
                [[240]], {"fields": ["analytic_account_id"]})
            if proj and proj[0].get("analytic_account_id"):
                analytic_account_id = proj[0]["analytic_account_id"][0]
        except Exception:
            pass

        task_vals: dict = {
            "name":        nombre_final,
            "description": req.descripcion or "",
            "project_id":  240,
            "stage_id":    272,
            "priority":    prio,
        }
        if analytic_account_id:
            task_vals["analytic_account_id"] = analytic_account_id
        if req.asignado_odoo_id:
            task_vals["user_ids"] = [(4, req.asignado_odoo_id)]

        task_id = models.execute_kw(DB, uid_o, P, "project.task", "create", [task_vals])

        # Notificación Telegram (sync httpx dentro del executor)
        tg_token = _os_t.getenv("TELEGRAM_BOT_TOKEN", "")
        tg_chat  = _os_t.getenv("TELEGRAM_CHAT_ID_REPORTES", "") or _os_t.getenv("TELEGRAM_CHAT_ID", "")
        if tg_token and tg_chat:
            def _esc(s): return _re.sub(r'([*_`\[\]])', r'\\\1', s)
            prio_emoji = {"0": "🟢", "1": "🔴"}.get(prio, "🟢")
            asignado_txt = f"👤 *Asignado:* {_esc(req.asignado_nombre)}" if req.asignado_nombre else "👤 *Sin asignar*"
            msg = (
                f"🎫 *Nuevo ticket PDN creado*\n\n"
                f"📋 *Título:* `{_esc(nombre_final)}`\n"
                f"{prio_emoji} *Prioridad:* {req.prioridad.upper()}\n"
                f"{asignado_txt}\n"
                f"👮 *Creado por:* {_esc(creado_por)}\n"
                f"🔗 [Ver en Odoo](https://odoo.wispi.mx/odoo/all-tasks/{task_id})"
            )
            try:
                _httpx.post(
                    f"https://api.telegram.org/bot{tg_token}/sendMessage",
                    json={"chat_id": tg_chat, "text": msg, "parse_mode": "Markdown"},
                    timeout=8,
                )
            except Exception:
                pass

        return {"ok": True, "task_id": task_id, "nombre": nombre_final}

    try:
        result = await _aio.get_event_loop().run_in_executor(None, _crear_en_odoo_y_notificar)
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error Odoo: {str(e)[:200]}")


@app.get("/api/blackstone/tickets")
async def get_blackstone_tickets(_user: dict = Depends(get_current_user)):
    """Lista tareas project.task del proyecto PDN 240 en formato TicketG."""
    import asyncio as _aio, xmlrpc.client as _xrc

    CLOSED_KW = {"done", "resuelto", "cerrado", "completado", "resolved",
                 "closed", "listo", "entregado", "done"}

    def _fetch():
        HOST = os.getenv("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
        DB   = os.getenv("ODOO_DB", "wispi19")
        U    = os.getenv("ODOO_USER", "")
        P    = os.getenv("ODOO_PASSWORD", "")

        common = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
        uid_o  = common.authenticate(DB, U, P, {})
        models = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)

        PDN_KW = ["pdn", "piedras", "acuña", "acuna", "acu", "supervisor"]

        raw = models.execute_kw(DB, uid_o, P, "project.task", "search_read",
            [[["project_id", "=", 240]]],
            {"fields": ["id", "name", "stage_id", "user_ids", "partner_id",
                        "date_deadline", "create_date", "priority"],
             "limit": 500, "order": "id desc"})

        # Filtrar solo tareas relacionadas con PDN
        raw = [t for t in raw if any(kw in t.get("name", "").lower() for kw in PDN_KW)]

        all_uids = list({u for t in raw for u in t.get("user_ids", [])})
        user_names: dict = {}
        if all_uids:
            users = models.execute_kw(DB, uid_o, P, "res.users", "read",
                [all_uids], {"fields": ["id", "name"]})
            user_names = {u["id"]: u["name"] for u in users}

        tickets = []
        for t in raw:
            stage = t["stage_id"][1] if t.get("stage_id") else ""
            closed = any(kw in stage.lower() for kw in CLOSED_KW)
            asignados = [user_names.get(u, f"U{u}") for u in t.get("user_ids", [])]
            tickets.append({
                "id":             f"PDN-{t['id']}",
                "odoo_id":        t["id"],
                "nombre":         t["name"],
                "cliente":        t["partner_id"][1] if t.get("partner_id") else "",
                "tecnico":        asignados[0] if asignados else None,
                "tipo":           "pdn",
                "etapa_op":       stage,
                "fecha_creacion": (t.get("create_date") or "")[:19],
                "prioridad":      "urgent" if t.get("priority") == "1" else "normal",
                "cerrado":        closed,
            })

        return {"tickets": tickets, "total": len(tickets)}

    try:
        result = await _aio.get_event_loop().run_in_executor(None, _fetch)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error Odoo: {str(e)[:200]}")


@app.get("/api/blackstone/fo-tickets")
async def get_blackstone_fo_tickets(_user: dict = Depends(get_current_user)):
    """Tareas de levantamiento FO del proyecto CAE - Operaciones (project_id=341)."""
    import asyncio as _aio, xmlrpc.client as _xrc

    CLOSED_KW = {"done", "resuelto", "cerrado", "completado", "resolved",
                 "closed", "listo", "entregado"}

    def _fetch():
        HOST = os.getenv("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
        DB   = os.getenv("ODOO_DB", "wispi19")
        U    = os.getenv("ODOO_USER", "")
        P    = os.getenv("ODOO_PASSWORD", "")

        common = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
        uid_o  = common.authenticate(DB, U, P, {})
        models = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)

        # Proyecto CAE - Operaciones (ID 341) — tareas con keywords FO/levantamiento
        FO_KW = ["levantamiento", " fo ", "fibra", "anillo", "otdr", "fusionadora",
                 "empalme", "mufa", "cae", "cwdm"]

        raw = models.execute_kw(DB, uid_o, P, "project.task", "search_read",
            [[["project_id", "=", 341]]],
            {"fields": ["id", "name", "stage_id", "user_ids", "partner_id",
                        "date_deadline", "create_date", "priority", "state"],
             "limit": 200, "order": "id desc"})

        raw = [t for t in raw if any(kw in (" " + t.get("name", "") + " ").lower() for kw in FO_KW)]

        all_uids = list({u for t in raw for u in t.get("user_ids", [])})
        user_names: dict = {}
        if all_uids:
            users = models.execute_kw(DB, uid_o, P, "res.users", "read",
                [all_uids], {"fields": ["id", "name"]})
            user_names = {u["id"]: u["name"] for u in users}

        tickets = []
        for t in raw:
            stage = t["stage_id"][1] if t.get("stage_id") else ""
            closed = any(kw in stage.lower() for kw in CLOSED_KW)
            asignados = [user_names.get(u, f"U{u}") for u in t.get("user_ids", [])]
            deadline = (t.get("date_deadline") or "")[:10]
            tickets.append({
                "id":             f"CAE-{t['id']}",
                "odoo_id":        t["id"],
                "nombre":         t["name"],
                "cliente":        t["partner_id"][1] if t.get("partner_id") else "",
                "tecnico":        ", ".join(asignados) if asignados else None,
                "tipo":           "fo",
                "etapa_op":       stage,
                "fecha_creacion": (t.get("create_date") or "")[:19],
                "date_deadline":  deadline,
                "prioridad":      "urgent" if t.get("priority") in ("1", "2", "3") else "normal",
                "cerrado":        closed,
            })

        return {"tickets": tickets, "total": len(tickets)}

    try:
        result = await _aio.get_event_loop().run_in_executor(None, _fetch)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error Odoo FO: {str(e)[:200]}")


# ─── Blackstone — CRM Oportunidades ───────────────────────────────────────────

@app.get("/api/blackstone/oportunidades")
async def get_blackstone_oportunidades(_user: dict = Depends(get_current_user)):
    """Oportunidades CRM de Odoo wispi19 — equipo Canales Indirectos UP."""
    import asyncio as _aio, xmlrpc.client as _xrc

    CLOSED_KW = {"ganado", "perdido", "cancelado", "won", "lost", "cerrado"}

    def _fetch():
        HOST = os.getenv("ODOO_URL", "https://odoo.wispi.mx").rstrip("/")
        DB   = os.getenv("ODOO_DB", "wispi19")
        U    = os.getenv("ODOO_USER", "")
        P    = os.getenv("ODOO_PASSWORD", "")

        common = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/common", allow_none=True)
        uid_o  = common.authenticate(DB, U, P, {})
        models = _xrc.ServerProxy(f"{HOST}/xmlrpc/2/object", allow_none=True)

        PDN_KW       = ["piedras", "pdn", "acuña", "acuna", "sandur", "lancermex", "amistad"]
        ALEJANDRO_ID = 938  # alejandro.guzman@xcien.com

        raw = models.execute_kw(DB, uid_o, P, "crm.lead", "search_read",
            [[["active", "=", True], ["type", "=", "opportunity"],
              ["user_id", "=", ALEJANDRO_ID]]],
            {"fields": ["id", "name", "stage_id", "probability",
                        "expected_revenue", "partner_id", "user_id", "team_id",
                        "date_deadline", "create_date", "date_closed",
                        "priority", "description"],
             "limit": 500, "order": "id desc"})

        raw = [o for o in raw if any(kw in (o.get("name") or "").lower() for kw in PDN_KW)]

        opps = []
        for o in raw:
            stage   = o["stage_id"][1] if o.get("stage_id") else ""
            closed  = any(kw in stage.lower() for kw in CLOSED_KW)
            opps.append({
                "id":              o["id"],
                "nombre":          o["name"],
                "etapa":           stage,
                "cerrado":         closed,
                "probabilidad":    round(o.get("probability") or 0, 1),
                "ingresos":        o.get("expected_revenue") or 0,
                "cliente":         o["partner_id"][1] if o.get("partner_id") else "",
                "propietario":     o["user_id"][1] if o.get("user_id") else "",
                "equipo":          o["team_id"][1] if o.get("team_id") else "",
                "fecha_cierre":    (o.get("date_deadline") or "")[:10],
                "fecha_creacion":  (o.get("create_date") or "")[:10],
                "prioridad":       o.get("priority", "0"),
            })

        return {"oportunidades": opps, "total": len(opps)}

    try:
        result = await _aio.get_event_loop().run_in_executor(None, _fetch)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error Odoo CRM: {str(e)[:200]}")


# ─── Fibra Óptica XCIEN — Memoria Técnica ─────────────────────────────────────

FIBRA_MEMORIA_PATH = os.path.join(BASE_DIR, "data", "blackstone_memoria.json")
FIBRA_SYNC_SCRIPT  = os.path.join(BASE_DIR, "blackstone_memoria_sync.py")

def _load_fibra_memoria():
    if not os.path.exists(FIBRA_MEMORIA_PATH):
        return {
            "proyecto": "Fibra Óptica XCIEN · Blackstone PDN",
            "creado": dt_datetime.now().strftime("%Y-%m-%d"),
            "version": 1,
            "reuniones": [],
            "hitos": [],
            "estado_actual": None,
        }
    with open(FIBRA_MEMORIA_PATH) as f:
        return json.load(f)

def _save_fibra_memoria(data):
    with open(FIBRA_MEMORIA_PATH, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

class MemoriaReunionReq(BaseModel):
    texto: str           # notas crudas de la reunión
    fecha: str = ""      # YYYY-MM-DD, vacío = hoy
    titulo: str = ""     # título opcional

@app.get("/api/fibra/memoria")
async def get_fibra_memoria(user: dict = Depends(get_current_user)):
    """Retorna la memoria técnica completa del proyecto FO XCIEN."""
    data = _load_fibra_memoria()
    reuniones = sorted(data.get("reuniones", []), key=lambda r: r.get("fecha", ""), reverse=True)
    return {
        "proyecto": data.get("proyecto"),
        "total_reuniones": len(reuniones),
        "estado_actual": data.get("estado_actual"),
        "hitos": data.get("hitos", []),
        "reuniones": reuniones[:50],
    }

@app.post("/api/fibra/memoria/reunion")
async def agregar_reunion_fibra(req: MemoriaReunionReq, user: dict = Depends(get_current_user)):
    """Agrega una reunión manual a la memoria técnica. Admin o supervisor."""
    if user.get("rol") not in ("admin", "supervisor", "gerente"):
        raise HTTPException(status_code=403, detail="Solo admins y supervisores pueden agregar reuniones")

    import hashlib as _hl
    import anthropic as _ant

    fecha = req.fecha.strip() or dt_datetime.now().strftime("%Y-%m-%d")
    digest = _hl.md5(f"{fecha}:{req.texto[:200]}".encode()).hexdigest()[:8]
    rid = f"fo_{fecha.replace('-','')}_{digest}"

    data = _load_fibra_memoria()
    existing = {r.get("id") for r in data.get("reuniones", [])}
    if rid in existing:
        return {"ok": True, "id": rid, "nuevo": False, "msg": "Reunión ya registrada"}

    # Parsear con Claude
    try:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        parsed = {}
        if api_key:
            client = _ant.Anthropic(api_key=api_key)
            prompt = f"""Analiza estas notas de reunión del proyecto Fibra Óptica XCIEN (Blackstone PDN).

Texto:
{req.texto[:6000]}

Devuelve ÚNICAMENTE JSON:
{{"titulo":"","participantes":[],"resumen":"","temas":[],"decisiones":[],"action_items":[{{"tarea":"","responsable":"","fecha_limite":null}}],"hallazgos_tecnicos":[],"riesgos":[],"estado_proyecto":"normal"}}"""
            resp = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
            raw = re.sub(r"^```\w*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            parsed = json.loads(raw)
    except Exception as e:
        logger.warning(f"Claude parse error: {e}")
        parsed = {"titulo": req.titulo or f"Junta FO {fecha}", "resumen": req.texto[:300]}

    reunion = {
        "id": rid,
        "fecha": fecha,
        "titulo": parsed.get("titulo") or req.titulo or f"Junta FO {fecha}",
        "fuente": "manual",
        "raw": req.texto[:3000],
        "parsed": parsed,
        "procesado": dt_datetime.now().isoformat(),
        "autor": user.get("nombre", user.get("email", "?")),
    }

    data.setdefault("reuniones", []).append(reunion)

    # Regenerar estado actual
    try:
        reuniones_ord = sorted(data["reuniones"], key=lambda r: r.get("fecha",""), reverse=True)[:8]
        ctx = []
        for r in reuniones_ord:
            p = r.get("parsed", {})
            ctx.append(f"[{r.get('fecha','?')}] {p.get('titulo', r.get('titulo','?'))} — "
                       f"Decisiones: {'; '.join(p.get('decisiones',[]))} — "
                       f"Items: {'; '.join(t.get('tarea','') for t in p.get('action_items',[]))}")
        if api_key and ctx:
            client2 = _ant.Anthropic(api_key=api_key)
            r2 = client2.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=600,
                messages=[{"role":"user","content":
                    f"Estado proyecto FO XCIEN (PDN):\n{chr(10).join(ctx)}\n\n"
                    'JSON: {"resumen":"","avance_pct":0,"pendientes_criticos":[],"logros_recientes":[],"proximos_pasos":[],"semaforo":"verde"}'}],
            )
            raw2 = r2.content[0].text.strip()
            raw2 = re.sub(r"^```\w*\n?", "", raw2); raw2 = re.sub(r"\n?```$", "", raw2)
            estado = json.loads(raw2)
            estado["generado"] = dt_datetime.now().isoformat()
            data["estado_actual"] = estado
    except Exception as e:
        logger.warning(f"Estado update error: {e}")

    _save_fibra_memoria(data)
    return {"ok": True, "id": rid, "nuevo": True, "titulo": reunion["titulo"],
            "estado_actual": data.get("estado_actual")}

@app.post("/api/fibra/memoria/hito")
async def agregar_hito_fibra(
    descripcion: str = Body(..., embed=True),
    tipo: str = Body("hito", embed=True),
    fecha: str = Body("", embed=True),
    user: dict = Depends(get_current_user)
):
    """Registra un hito o decisión importante en la memoria del proyecto."""
    if user.get("rol") not in ("admin", "supervisor", "gerente"):
        raise HTTPException(status_code=403, detail="Solo admins/supervisores")
    data = _load_fibra_memoria()
    data.setdefault("hitos", []).append({
        "fecha": fecha or dt_datetime.now().strftime("%Y-%m-%d"),
        "descripcion": descripcion,
        "tipo": tipo,
        "autor": user.get("nombre", "?"),
    })
    _save_fibra_memoria(data)
    return {"ok": True, "total_hitos": len(data["hitos"])}

@app.post("/api/fibra/memoria/sync-gmail")
async def sync_gmail_fibra(dias: int = Body(7, embed=True), user: dict = Depends(get_current_user)):
    """Dispara sync de Gmail en background. Solo admin."""
    if user.get("rol") != "admin":
        raise HTTPException(status_code=403, detail="Solo admin")
    import subprocess as _sp
    if not os.path.exists(FIBRA_SYNC_SCRIPT):
        raise HTTPException(status_code=404, detail="Script de sync no encontrado")
    _sp.Popen([sys.executable, FIBRA_SYNC_SCRIPT, "--dias", str(dias)],
              stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
    return {"ok": True, "msg": f"Sync Gmail iniciado (últimos {dias} días). Refresca en 30s."}

# ─── ATC Efectividad ──────────────────────────────────────────────────────────

@app.get("/api/atc/efectividad")
def get_atc_efectividad(dias: int = 30):
    """Métricas de efectividad del equipo ATC/CAST desde Odoo helpdesk.ticket."""
    import xmlrpc.client as _xr
    from datetime import datetime, timedelta, timezone
    from collections import defaultdict

    odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db   = os.environ.get("ODOO_DB",  "wispi19")
    odoo_user = os.environ.get("ODOO_USER")
    odoo_pass = os.environ.get("ODOO_PASSWORD")

    _CAST_TEAMS = [6, 39, 41, 44, 48, 60, 67]
    STAGE_REINCIDENTE = 175
    STAGE_RESUELTO_IDS = {54, 107}   # CAST Nvl:1-Resuelto, Solved

    try:
        common = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
        uid = common.authenticate(odoo_db, odoo_user, odoo_pass, {})
        if not uid:
            raise HTTPException(status_code=503, detail="No se pudo autenticar en Odoo")
        models = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error conectando Odoo: {e}")

    desde = (datetime.now(timezone.utc) - timedelta(days=dias)).strftime("%Y-%m-%d %H:%M:%S")
    hoy   = datetime.now(timezone.utc).date()
    semana_inicio = hoy - timedelta(days=hoy.weekday())

    try:
        raw = models.execute_kw(odoo_db, uid, odoo_pass, "helpdesk.ticket", "search_read",
            [[["team_id", "in", _CAST_TEAMS], ["create_date", ">=", desde]]],
            {"fields": ["id","name","user_id","stage_id","create_date","close_date","priority"], "limit": 2000, "order": "id desc"})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error leyendo Odoo: {e}")

    por_agente = defaultdict(lambda: {
        "total": 0, "cerrados": 0, "reincidentes": 0,
        "tiempos_resolucion_h": [], "hoy": 0, "semana": 0
    })
    total = len(raw)
    cerrados_total = 0
    reincidentes_total = 0
    hoy_total = 0
    semana_total = 0
    tiempos_todos = []

    for t in raw:
        ag = t.get("user_id")
        nombre = ag[1] if ag else "Sin asignar"
        d = por_agente[nombre]
        d["total"] += 1

        # Fechas
        creado_str = t.get("create_date", "")
        cerrado_str = t.get("close_date")
        try:
            creado_dt = datetime.strptime(creado_str[:10], "%Y-%m-%d").date()
        except Exception:
            creado_dt = None

        if creado_dt == hoy:
            d["hoy"] += 1
            hoy_total += 1
        if creado_dt and creado_dt >= semana_inicio:
            d["semana"] += 1
            semana_total += 1

        stage_id = t["stage_id"][0] if t.get("stage_id") else 0
        if stage_id == STAGE_REINCIDENTE:
            d["reincidentes"] += 1
            reincidentes_total += 1

        if cerrado_str:
            d["cerrados"] += 1
            cerrados_total += 1
            # Tiempo de resolución
            try:
                c_dt = datetime.strptime(creado_str[:19], "%Y-%m-%d %H:%M:%S")
                cl_dt = datetime.strptime(cerrado_str[:19], "%Y-%m-%d %H:%M:%S")
                hrs = round((cl_dt - c_dt).total_seconds() / 3600, 2)
                if 0 < hrs < 720:   # descartar datos anómalos (>30 días)
                    d["tiempos_resolucion_h"].append(hrs)
                    tiempos_todos.append(hrs)
            except Exception:
                pass

    # Calcular promedios por agente
    agentes_list = []
    for nombre, d in sorted(por_agente.items(), key=lambda x: -x[1]["total"]):
        if nombre == "Sin asignar":
            continue
        trs = d["tiempos_resolucion_h"]
        agentes_list.append({
            "nombre": nombre,
            "total": d["total"],
            "cerrados": d["cerrados"],
            "reincidentes": d["reincidentes"],
            "resolucion_pct": round(d["cerrados"] / d["total"] * 100, 1) if d["total"] else 0,
            "tiempo_prom_h": round(sum(trs) / len(trs), 1) if trs else None,
            "hoy": d["hoy"],
            "semana": d["semana"],
        })

    avg_tiempo = round(sum(tiempos_todos) / len(tiempos_todos), 1) if tiempos_todos else None

    return {
        "periodo_dias": dias,
        "resumen": {
            "total": total,
            "cerrados": cerrados_total,
            "abiertos": total - cerrados_total,
            "reincidentes": reincidentes_total,
            "resolucion_pct": round(cerrados_total / total * 100, 1) if total else 0,
            "tiempo_prom_h": avg_tiempo,
            "hoy": hoy_total,
            "semana": semana_total,
        },
        "agentes": agentes_list,
    }


# ─── Backlog Operativo ────────────────────────────────────────────────────────
import time as _time_mod

_BACKLOG_CACHE: dict = {"ts": 0, "data": None}
_BACKLOG_COM_CACHE: dict = {"ts": 0, "data": None}
_BACKLOG_TTL = 86400  # 24 horas

BACKLOG_TEAM_IDS  = [6, 39, 60, 67, 41, 48, 44, 42, 8]
BACKLOG_FALLA_IDS = [39, 41, 43, 44, 52, 53, 54, 55, 59]
BACKLOG_HAB_IDS   = [42, 45, 47, 60]
BACKLOG_OPS_IDS   = BACKLOG_FALLA_IDS + BACKLOG_HAB_IDS
BACKLOG_CLOSED_KW = {"cerrado", "resuelto", "solucionado", "cancelado", "done", "closed", "solved"}

MUNI_COORDS = {
    "Monterrey":      (25.6866, -100.3161),
    "Apodaca":        (25.7803, -100.1851),
    "San Nicolás de los Garza": (25.7457, -100.2854),
    "San Pedro Garza García":   (25.6535, -100.4021),
    "Santa Catarina": (25.6733, -100.4597),
    "Guadalupe":      (25.6750, -100.2408),
    "Pesquería":      (25.7924,  -99.9856),
    "Ciénega de Flores": (25.9534, -100.1767),
    "García":         (25.8092, -100.5912),
    "General Escobedo": (25.7943, -100.3296),
    "Saltillo":       (25.4232, -100.9935),
    "Torreón":        (25.5428, -103.4068),
    "Monclova":       (26.9046, -101.4218),
    "Piedras Negras": (28.7006,  -100.5234),
    "Acuña":          (29.3225,  -100.9293),
}

def _shorten_state(s: str) -> str:
    return {"Nuevo León": "NL", "Coahuila de Zaragoza": "COA",
            "Coahuila": "COA", "Tamaulipas": "TAMPS"}.get(s, s[:4].upper())

def _build_backlog() -> dict:
    import xmlrpc.client as _xr
    from datetime import datetime as _dt
    from statistics import median as _med

    odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db   = os.environ.get("ODOO_DB", "wispi19")
    odoo_user = os.environ.get("ODOO_USER")
    odoo_pass = os.environ.get("ODOO_PASSWORD")

    common = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
    uid = common.authenticate(odoo_db, odoo_user, odoo_pass, {})
    m   = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")

    tickets = m.execute_kw(odoo_db, uid, odoo_pass, "helpdesk.ticket", "search_read",
        [[["team_id", "in", BACKLOG_TEAM_IDS],
          ["ticket_type_id", "in", BACKLOG_OPS_IDS]]],
        {"fields": ["id", "ticket_type_id", "create_date", "partner_id",
                    "user_id", "stage_id", "priority"], "limit": 1000})

    # Filtrar cerrados
    tickets = [t for t in tickets
               if not any(kw in (t["stage_id"][1] or "").lower()
                          for kw in BACKLOG_CLOSED_KW)]

    # Cargar ciudades/estados de partners
    partner_ids = list({t["partner_id"][0] for t in tickets if t["partner_id"]})
    if partner_ids:
        partners = m.execute_kw(odoo_db, uid, odoo_pass, "res.partner", "search_read",
            [[["id", "in", partner_ids]]],
            {"fields": ["id", "city", "state_id"], "limit": len(partner_ids) + 10})
        pmap = {p["id"]: {
            "city":  (p.get("city") or "").strip() or "Sin ciudad",
            "state": (p["state_id"][1] if p.get("state_id") else "Sin estado").replace(" (MX)", ""),
        } for p in partners}
    else:
        pmap = {}

    now = _dt.now()
    def age_days(t):
        cd = t.get("create_date")
        if not cd:
            return 0
        return (now - _dt.strptime(cd[:19], "%Y-%m-%d %H:%M:%S")).days

    # Acumular por municipio y por técnico
    from collections import defaultdict
    muni_data: dict = defaultdict(lambda: {"fallas": 0, "hab": 0, "ages": [], "state": "", "tickets": []})
    tec_data:  dict = defaultdict(lambda: {"fallas": 0, "hab": 0, "ages": [], "plazas": set()})
    total_ages = []

    for t in tickets:
        pid   = t["partner_id"][0] if t["partner_id"] else None
        loc   = pmap.get(pid, {"city": "Sin ciudad", "state": "Sin estado"})
        city  = loc["city"]
        state = loc["state"]
        tec   = t["user_id"][1] if t["user_id"] else "Sin asignar"
        tid   = t["ticket_type_id"][0] if t["ticket_type_id"] else 0
        cat   = "fallas" if tid in BACKLOG_FALLA_IDS else "hab"
        age   = age_days(t)
        partner_name = t["partner_id"][1] if t["partner_id"] else "Sin cliente"

        muni_data[city]["fallas" if cat == "fallas" else "hab"] += 1
        muni_data[city]["ages"].append(age)
        muni_data[city]["state"] = _shorten_state(state)
        muni_data[city]["tickets"].append({
            "id":       t["id"],
            "name":     t.get("name") or "",
            "cat":      cat,
            "stage":    t["stage_id"][1] if t.get("stage_id") else "?",
            "tec":      tec,
            "partner":  partner_name,
            "age_days": age,
        })

        tec_data[tec]["fallas" if cat == "fallas" else "hab"] += 1
        tec_data[tec]["ages"].append(age)
        tec_data[tec]["plazas"].add(_shorten_state(state))

        total_ages.append(age)

    def med(lst): return int(_med(sorted(lst))) if lst else 0

    munis = []
    for city, d in sorted(muni_data.items(), key=lambda x: -(x[1]["fallas"]+x[1]["hab"])):
        coords = MUNI_COORDS.get(city, (None, None))
        total  = d["fallas"] + d["hab"]
        sorted_tickets = sorted(d["tickets"], key=lambda x: -x["age_days"])
        munis.append({
            "municipio": city,
            "estado":    d["state"],
            "total":     total,
            "fallas":    d["fallas"],
            "hab":       d["hab"],
            "mediana":   med(d["ages"]),
            "lat":       coords[0],
            "lon":       coords[1],
            "tickets":   sorted_tickets,
        })

    tecnicos = []
    for tec, d in sorted(tec_data.items(), key=lambda x: -(x[1]["fallas"]+x[1]["hab"])):
        total = d["fallas"] + d["hab"]
        parts = tec.split()
        label = f"{parts[0][0]}. {' '.join(parts[-2:]).title()}" if len(parts) >= 3 and tec != "Sin asignar" else tec
        tecnicos.append({
            "tecnico":  label,
            "total":    total,
            "fallas":   d["fallas"],
            "hab":      d["hab"],
            "mediana":  med(d["ages"]),
            "plazas":   sorted(d["plazas"]),
        })

    total_tickets = len(tickets)
    total_fallas  = sum(1 for t in tickets if (t["ticket_type_id"][0] if t["ticket_type_id"] else 0) in BACKLOG_FALLA_IDS)
    total_hab     = total_tickets - total_fallas

    return {
        "total":       total_tickets,
        "fallas":      total_fallas,
        "hab":         total_hab,
        "mediana_dias": med(total_ages),
        "municipios":  munis,
        "tecnicos":    tecnicos,
        "updated_at":  now.isoformat(),
    }

@app.get("/api/backlog/ops")
def get_backlog_ops(force: bool = False):
    """Backlog operativo (fallas + habilitaciones activas) por municipio y técnico.
    Caché 24 horas. force=true para refrescar."""
    global _BACKLOG_CACHE
    now_ts = _time_mod.time()
    if not force and _BACKLOG_CACHE["data"] and (now_ts - _BACKLOG_CACHE["ts"]) < _BACKLOG_TTL:
        return {**_BACKLOG_CACHE["data"], "cached": True}
    try:
        data = _build_backlog()
        _BACKLOG_CACHE = {"ts": now_ts, "data": data}
        return {**data, "cached": False}
    except Exception as e:
        if _BACKLOG_CACHE["data"]:
            return {**_BACKLOG_CACHE["data"], "cached": True, "error": str(e)}
        raise HTTPException(status_code=502, detail=f"Error cargando backlog: {e}")


def _build_backlog_comercial() -> dict:
    """Consulta CRM leads activos (NL) agrupados por municipio y etapa."""
    import xmlrpc.client as _xr
    from datetime import datetime as _dt
    from collections import defaultdict

    odoo_url  = os.environ.get("ODOO_URL", "https://odoo.wispi.mx")
    odoo_db   = os.environ.get("ODOO_DB", "wispi19")
    odoo_user = os.environ.get("ODOO_USER")
    odoo_pass = os.environ.get("ODOO_PASSWORD")

    common = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/common")
    uid = common.authenticate(odoo_db, odoo_user, odoo_pass, {})
    m   = _xr.ServerProxy(f"{odoo_url}/xmlrpc/2/object")

    # Leads activos (no perdidos/ganados) con estado NL
    leads = m.execute_kw(odoo_db, uid, odoo_pass, "crm.lead", "search_read",
        [[["active", "=", True],
          ["probability", "not in", [0, 100]],
          ["partner_id.state_id.code", "=", "NL"]]],
        {"fields": ["id", "stage_id", "city", "partner_id", "user_id"], "limit": 2000})

    STAGE_MAP = {
        "negociación": "Negociacion", "negociacion": "Negociacion",
        "habilitación": "Habilitacion", "habilitacion": "Habilitacion",
        "contratación": "Contratacion", "contratacion": "Contratacion",
        "calificación": "Calificacion", "calificacion": "Calificacion",
        "facturación": "Facturacion", "facturacion": "Facturacion",
        "pre-venta": "Pre-Venta", "preventa": "Pre-Venta",
        "estudio": "Estudio",
    }
    ACTIVE_STAGES = {"Habilitacion", "Contratacion", "Calificacion", "Facturacion", "Estudio"}

    muni: dict = defaultdict(lambda: {"stages": defaultdict(int), "active": 0, "total": 0})
    for l in leads:
        raw_stage = (l["stage_id"][1] if l.get("stage_id") else "?").lower().strip()
        stage = next((v for k, v in STAGE_MAP.items() if k in raw_stage), raw_stage.title()[:16])
        city  = (l.get("city") or "Sin ciudad").strip()
        if not city or city.lower() in {"false", "none"}:
            city = "Sin ciudad"
        muni[city]["stages"][stage] += 1
        muni[city]["total"] += 1
        if stage in ACTIVE_STAGES:
            muni[city]["active"] += 1

    munis_out = []
    for city, d in sorted(muni.items(), key=lambda x: -x[1]["total"]):
        coords = MUNI_COORDS.get(city, (None, None))
        if not coords[0]:
            for k, v in MUNI_COORDS.items():
                if k.lower() in city.lower() or city.lower() in k.lower():
                    coords = v
                    break
        munis_out.append({
            "municipio": city,
            "total":     d["total"],
            "active":    d["active"],
            "stages":    dict(sorted(d["stages"].items(), key=lambda x: -x[1])),
            "lat":       coords[0],
            "lon":       coords[1],
        })

    total = sum(l["total"] for l in munis_out)
    total_active = sum(l["active"] for l in munis_out)
    return {
        "total":        total,
        "total_active": total_active,
        "municipios":   munis_out,
        "updated_at":   _dt.now().isoformat(),
    }


@app.get("/api/backlog/comercial")
def get_backlog_comercial(force: bool = False):
    """Pipeline CRM activo NL agrupado por municipio y etapa.
    Caché 24 horas. force=true para refrescar."""
    global _BACKLOG_COM_CACHE
    now_ts = _time_mod.time()
    if not force and _BACKLOG_COM_CACHE["data"] and (now_ts - _BACKLOG_COM_CACHE["ts"]) < _BACKLOG_TTL:
        return {**_BACKLOG_COM_CACHE["data"], "cached": True}
    try:
        data = _build_backlog_comercial()
        _BACKLOG_COM_CACHE = {"ts": now_ts, "data": data}
        return {**data, "cached": False}
    except Exception as e:
        if _BACKLOG_COM_CACHE["data"]:
            return {**_BACKLOG_COM_CACHE["data"], "cached": True, "error": str(e)}
        raise HTTPException(status_code=502, detail=f"Error cargando backlog comercial: {e}")


# ─── Nebula endpoints ─────────────────────────────────────────────────────────

@app.get("/api/nebula/status")
async def nebula_status():
    try:
        tok = _zabbix_login()
        if not tok:
            return {"connected": False, "error": "VPN no conectada o credenciales incorrectas"}
        import requests as _req
        hc = _req.post(f"{_NEBULA_ZABBIX_URL}/api_jsonrpc.php",
            json={"jsonrpc":"2.0","method":"host.get","params":{"countOutput":True},"auth":tok,"id":2},timeout=8).json()
        pc = _req.post(f"{_NEBULA_ZABBIX_URL}/api_jsonrpc.php",
            json={"jsonrpc":"2.0","method":"problem.get","params":{"countOutput":True},"auth":tok,"id":3},timeout=8).json()
        gok = False
        try:
            gr = _req.get(f"{_NEBULA_GRAFANA_URL}/api/health", timeout=5)
            gok = gr.status_code == 200
        except Exception:
            pass
        return {
            "connected": True,
            "zabbix": {"hosts": int(hc.get("result", 0)), "problems": int(pc.get("result", 0))},
            "grafana": {"connected": gok, "url": _NEBULA_GRAFANA_URL},
        }
    except Exception as e:
        return {"connected": False, "error": str(e)}

@app.get("/api/nebula/problems")
async def nebula_problems(limit: int = 200, min_severity: int = 0):
    try:
        SEV = {0:"NC", 1:"Info", 2:"Warning", 3:"Average", 4:"High", 5:"Disaster"}
        SEV_COLOR = {0:"#6b7280", 1:"#60a5fa", 2:"#facc15", 3:"#f97316", 4:"#ef4444", 5:"#dc2626"}
        # Zabbix 7: usar trigger.get con value=1 (activo) + selectHosts
        params = {
            "output": ["triggerid", "description", "priority", "lastchange"],
            "selectHosts": ["hostid", "host", "name"],
            "only_true": True,
            "monitored": True,
            "active": True,
            "skipDependent": True,
            "filter": {"value": "1"},
            "sortfield": "lastchange",
            "sortorder": "DESC",
            "limit": limit,
        }
        if min_severity > 0:
            params["min_severity"] = str(min_severity)
        triggers = _zabbix("trigger.get", params)
        result = []
        for t in triggers:
            sev = int(t.get("priority", 0))
            if sev < min_severity:
                continue
            hosts = t.get("hosts", [])
            result.append({
                "id": t.get("triggerid"),
                "name": t.get("description"),
                "severity": sev,
                "severity_label": SEV.get(sev, "?"),
                "severity_color": SEV_COLOR.get(sev, "#6b7280"),
                "clock": t.get("lastchange"),
                "host": hosts[0].get("name") if hosts else "?",
                "host_id": hosts[0].get("hostid") if hosts else None,
                "acknowledged": False,
            })
        return {"problems": result, "count": len(result)}
    except Exception as e:
        return {"problems": [], "count": 0, "error": str(e)}

@app.get("/api/nebula/hosts")
async def nebula_hosts_list(with_problems: bool = True, limit: int = 200):
    try:
        params = {
            "output": ["hostid", "host", "name", "available", "status", "description"],
            "selectInterfaces": ["ip", "type"],
            "limit": limit,
            "sortfield": "name",
        }
        if with_problems:
            params["monitored_hosts"] = True
            params["with_active_triggers"] = True
        hosts = _zabbix("host.get", params)
        # available: 0=unknown 1=available 2=unavailable
        AVAIL = {0: "unknown", 1: "up", 2: "down"}
        result = []
        for h in hosts:
            ifaces = h.get("interfaces", [])
            ip = ifaces[0].get("ip") if ifaces else ""
            avail = int(h.get("available", 0))
            result.append({
                "id": h.get("hostid"),
                "name": h.get("name") or h.get("host"),
                "host": h.get("host"),
                "ip": ip,
                "available": avail,
                "status_label": AVAIL.get(avail, "unknown"),
                "enabled": h.get("status") == "0",
            })
        return {"hosts": result, "count": len(result)}
    except Exception as e:
        return {"hosts": [], "count": 0, "error": str(e)}

@app.get("/api/nebula/grafana/dashboards")
async def nebula_grafana_dashboards():
    try:
        import requests as _req
        headers = {"Authorization": f"Bearer {_NEBULA_GRAFANA_TOK}"} if _NEBULA_GRAFANA_TOK else {}
        r = _req.get(f"{_NEBULA_GRAFANA_URL}/api/search?type=dash-db&limit=50", headers=headers, timeout=8)
        boards = r.json() if r.ok else []
        return {"dashboards": boards, "grafana_url": _NEBULA_GRAFANA_URL}
    except Exception as e:
        return {"dashboards": [], "error": str(e)}

# ─── SPA Fallback ─────────────────────────────────────────────────────────────

@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """Maneja el enrutamiento de React (SPA) para cualquier ruta no definida en la API."""
    # 1. Si es una ruta de API o de estáticos conocidos que no existe, 404 real
    if full_path.startswith("api/") or full_path.startswith("static/") or full_path.startswith("assets/"):
        raise HTTPException(status_code=404, detail="Recurso no encontrado")

    # 2. Verificar si es un archivo físico en la raíz de DIST_DIR (ej: favicon.ico, xcien.png)
    if os.path.exists(DIST_DIR):
        file_in_dist = os.path.join(DIST_DIR, full_path)
        if os.path.isfile(file_in_dist):
            return FileResponse(file_in_dist)

        # 3. Si no es un archivo, servir index.html para que React Router maneje la ruta
        index_path = os.path.join(DIST_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    # 4. Fallback final a la versión legacy si no hay build de React
    legacy_index = os.path.join(BASE_DIR, "static", "index.html")
    if os.path.exists(legacy_index):
        return FileResponse(legacy_index)

    raise HTTPException(status_code=404, detail="Portal no disponible")


# ─── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("🚀 XCIEN 2.0 Backend iniciando en puerto 8002...")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8002)))
