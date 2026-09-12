import { useState, Suspense, lazy } from 'react';
import { useTabTrack } from '../../../hooks/useTabTrack';
import { Phone, Headphones, PhoneCall } from 'lucide-react';

const CallCenter     = lazy(() => import('../../CallCenter'));
const Net2Phone      = lazy(() => import('./Net2PhoneSection'));
const MesaDeAyuda    = lazy(() => import('./HelpdeskSection'));

type Tab = 'conversaciones' | 'net2phone' | 'helpdesk';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'conversaciones', label: 'Conversaciones',      icon: <Phone     className="h-3.5 w-3.5" /> },
  { id: 'net2phone',      label: 'Net2Phone',            icon: <PhoneCall className="h-3.5 w-3.5" /> },
  { id: 'helpdesk',       label: 'Mesa de Ayuda',        icon: <Headphones className="h-3.5 w-3.5" /> },
];

function Spinner() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 28, height: 28, border: '2px solid #00c46a30', borderTopColor: '#00c46a', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
        <span style={{ fontSize: 12 }}>Conectando con el Call Center…</span>
      </div>
    </div>
  );
}

export default function CallCenterHubSection() {
  const [tab, setTab] = useState<Tab>('conversaciones');
  const trackTab = useTabTrack('call');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f1117', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '8px 16px', borderBottom: '1px solid #1e2535',
        background: '#161b27', flexShrink: 0,
      }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { trackTab(t.id); setTab(t.id); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                background: active ? 'rgba(0,196,106,0.15)' : 'transparent',
                color: active ? '#00c46a' : '#64748b',
                boxShadow: active ? 'inset 0 0 0 1px rgba(0,196,106,0.35)' : 'none',
              }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Suspense fallback={<Spinner />}>
          {tab === 'conversaciones' && <CallCenter />}
          {tab === 'net2phone'      && <Net2Phone />}
          {tab === 'helpdesk'       && <MesaDeAyuda />}
        </Suspense>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
