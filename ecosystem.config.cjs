const path = require('path');
const ROOT = __dirname;
const PYTHON = path.join(ROOT, '.venv/bin/python3');

module.exports = {
  apps: [
    // ── Backend FastAPI ────────────────────────────────────────────────────
    {
      name: 'xcien-backend',
      script: 'backend/servidor_academia.py',
      interpreter: PYTHON,
      cwd: ROOT,
      instances: 1,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      max_memory_restart: '1G',
      env_file: 'backend/.env',
      env: {
        PYTHONUNBUFFERED: '1',
        PORT: 8002,
        TOKEN_SECRET: process.env.TOKEN_SECRET,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/err.log',
      out_file:   'logs/out.log',
      merge_logs: true,
    },

    // ── Frontend Vite ──────────────────────────────────────────────────────
    {
      name: 'xcien-frontend',
      script: 'node_modules/.bin/vite',
      args: '--host',
      cwd: ROOT,
      instances: 1,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/frontend-err.log',
      out_file:   'logs/frontend-out.log',
      merge_logs: true,
    },

    // ── Agente Odoo ───────────────────────────────────────────────────────
    {
      name: 'xcien-agente-odoo',
      script: 'agente_odoo.py',
      interpreter: PYTHON,
      cwd: ROOT,
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
      env_file: 'backend/.env',
      env: { PYTHONUNBUFFERED: '1' },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/agente-odoo-err.log',
      out_file:   'logs/agente-odoo-out.log',
      merge_logs: true,
    },

    // ── Telegram Bot ───────────────────────────────────────────────────────
    {
      name: 'xcien-telegram-bot',
      script: 'backend/agents/telegram_agent_bot.py',
      interpreter: PYTHON,
      cwd: ROOT,
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
      env: {
        PYTHONUNBUFFERED: '1',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/telegram-err.log',
      out_file:   'logs/telegram-out.log',
      merge_logs: true,
    },
  ],
};
