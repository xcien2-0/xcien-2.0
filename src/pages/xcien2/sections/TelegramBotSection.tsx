import React, { useState, useEffect } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';

export default function TelegramBotSection({ theme }: { theme: ThemeConfig }) {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [minSeverity, setMinSeverity] = useState('critical');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', msg: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/config/telegram`)
      .then(r => r.json())
      .then(data => {
        setEnabled(data.enabled);
        setToken(data.token);
        setChatId(data.chat_id);
        setMinSeverity(data.min_severity || 'critical');
      })
      .catch(e => console.error("Error loading config", e));
  }, []);

  const handleSave = async (isTest = false) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/config/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, token, chat_id: chatId, min_severity: minSeverity })
      });
      const data = await res.json();
      if (data.status === 'success' && !isTest) {
        setStatus({ type: 'success', msg: 'Configuración guardada correctamente' });
      }
    } catch (e) {
      setStatus({ type: 'error', msg: 'No se pudo guardar la configuración del bot' });
    }
    setLoading(false);
  };

  const handleTest = async () => {
    if (!token || !chatId) {
      setStatus({ type: 'error', msg: 'Por favor ingresa el Token y el Chat ID' });
      return;
    }
    await handleSave(true);
    setLoading(true);
    setStatus({ type: 'info', msg: 'Enviando mensaje de prueba...' });
    try {
      const res = await fetch(`${API_BASE}/api/test/telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, chat_id: chatId })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setStatus({ type: 'success', msg: '¡Mensaje enviado con éxito! Revisa tu Telegram.' });
      } else {
        setStatus({ type: 'error', msg: `Error: ${data.message}` });
      }
    } catch (e) {
      setStatus({ type: 'error', msg: 'Error de conexión con el servidor' });
    }
    setLoading(false);
  };

  const accent = theme.accent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 800 }}>
      <div style={{ borderBottom: `2px solid ${accent}`, paddingBottom: 16 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: theme.text, margin: 0, textTransform: 'uppercase' }}>Telegram Bot Alarms</h2>
        <p style={{ fontSize: 13, color: theme.dim, marginTop: 4 }}>Configuración del bot de notificaciones en tiempo real para alertas críticas del NOC.</p>
      </div>

      <div style={{ 
        background: theme.card, 
        border: `1px solid ${theme.border}`, 
        borderRadius: 16, 
        padding: 32,
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 24 }}>Bot Configuration</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input 
              type="checkbox" 
              checked={enabled} 
              onChange={e => setEnabled(e.target.checked)}
              style={{ width: 20, height: 20, cursor: 'pointer', accentColor: accent }}
            />
            <label style={{ fontSize: 15, color: '#fff', fontWeight: 500 }}>Enable Telegram Alerts</label>
          </div>

          {/* Token Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ width: 120, fontSize: 13, color: theme.dim, textAlign: 'right' }}>Bot Token:</label>
            <input 
              type="text"
              placeholder="123456:ABC-DEF1234ghIkl..."
              value={token}
              onChange={e => setToken(e.target.value)}
              style={{ 
                flex: 1, 
                background: 'rgba(255,255,255,0.05)', 
                border: '1px solid rgba(255,255,255,0.1)', 
                borderRadius: 8, 
                padding: '10px 16px', 
                color: '#fff',
                fontSize: 14,
                fontFamily: 'monospace'
              }}
            />
          </div>

          {/* Chat ID Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ width: 120, fontSize: 13, color: theme.dim, textAlign: 'right' }}>Chat ID:</label>
            <input 
              type="text"
              placeholder="-1001234567890"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              style={{ 
                flex: 1, 
                background: 'rgba(255,255,255,0.05)', 
                border: '1px solid rgba(255,255,255,0.1)', 
                borderRadius: 8, 
                padding: '10px 16px', 
                color: '#fff',
                fontSize: 14,
                fontFamily: 'monospace'
              }}
            />
          </div>

          {/* Severity Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ width: 120, fontSize: 13, color: theme.dim, textAlign: 'right' }}>Alert Severity:</label>
            <select 
              value={minSeverity}
              onChange={e => setMinSeverity(e.target.value)}
              style={{ 
                flex: 1, 
                background: 'rgba(255,255,255,0.05)', 
                border: '1px solid rgba(255,255,255,0.1)', 
                borderRadius: 8, 
                padding: '10px 16px', 
                color: '#fff',
                fontSize: 14
              }}
            >
              <option value="all">Todas las alarmas (Info, Warning, Critical)</option>
              <option value="warning">Warning & Critical</option>
              <option value="critical">Solo Critical (Recomendado)</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 12, paddingLeft: 136 }}>
            <button 
              onClick={() => handleSave()}
              disabled={loading}
              style={{ 
                background: 'rgba(255,255,255,0.1)', 
                color: '#fff', 
                border: '1px solid rgba(255,255,255,0.2)', 
                borderRadius: 8, 
                padding: '10px 24px', 
                fontWeight: 700, 
                fontSize: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              Save Configuration
            </button>
            <button 
              onClick={handleTest}
              disabled={loading}
              style={{ 
                background: '#00C896', 
                color: '#000', 
                border: 'none', 
                borderRadius: 8, 
                padding: '10px 24px', 
                fontWeight: 700, 
                fontSize: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {loading ? 'Processing...' : 'Send Test Message'}
            </button>
          </div>

          {/* Status Message */}
          {status && (
            <div style={{ 
              padding: '12px 16px', 
              borderRadius: 8, 
              marginTop: 10,
              fontSize: 13,
              background: status.type === 'error' ? 'rgba(255,71,87,0.1)' : 'rgba(0,200,150,0.1)',
              color: status.type === 'error' ? '#FF4757' : '#00C896',
              border: `1px solid ${status.type === 'error' ? '#FF4757' : '#00C896'}30`
            }}>
              {status.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
