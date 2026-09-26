// Render real en jsdom con react-dom/client + act (sin @testing-library:
// @testing-library/dom no está instalado y no se agregan dependencias).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import DispatchSection from './DispatchSection';
import { DEFAULT_THEME } from '../types';

const LARGO = 'Revisión completa de radiobase con acceso restringido por lluvia';

const RESPUESTA = {
  corte: '2026-09-25',
  personas: [
    {
      uid: 1, nombre: 'Ana Ruiz', email: 'ana@xcien.mx',
      total: 12, abiertas: 10, vencidas: 1,
      por_etapa: { Nuevo: 5, 'En curso': 4, Revisión: 3, Bloqueado: 2, Campo: 1, Cerrado: 1, Archivado: 1 },
      tareas_vencidas: [{ id: 91, nombre: LARGO, etapa: 'En curso', deadline: '2026-09-10', proyecto: 'CAE' }],
      tareas_proximas: [],
    },
    { uid: 2, nombre: 'Beto Lara', email: 'beto@xcien.mx', total: 10, abiertas: 10, vencidas: 3, por_etapa: { Nuevo: 2 }, tareas_vencidas: [], tareas_proximas: [] },
    { uid: 3, nombre: 'Caro Díaz', email: 'caro@xcien.mx', total: 10, abiertas: 10, vencidas: 5, por_etapa: { Nuevo: 2 }, tareas_vencidas: [], tareas_proximas: [] },
    { uid: 4, nombre: 'Dani Sosa', email: 'dani@xcien.mx', total: 3, abiertas: 0, vencidas: 0, por_etapa: {}, tareas_vencidas: [], tareas_proximas: [] },
    { uid: 5, nombre: 'Eva Mora', email: 'eva@xcien.mx', total: 300, abiertas: 200, vencidas: 80, por_etapa: { Nuevo: 200 }, tareas_vencidas: [], tareas_proximas: [], truncado: true },
  ],
};

let host: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => { root.render(<DispatchSection theme={DEFAULT_THEME} />); });
}
const texto = () => host.textContent ?? '';
const refreshBtn = () => [...host.querySelectorAll('button')]
  .find(b => b.textContent?.includes('Actualizar')) as HTMLButtonElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('DispatchSection', () => {
  // Va primero: el caché de módulo aún está vacío.
  it('muestra el estado de error con botón de reintento', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await mount();

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(texto()).toContain('No se pudo cargar el dispatch');
    expect(texto()).toContain('HTTP 404');
    expect(texto()).toContain('Reintentar');
  });

  it('renderiza una tarjeta por persona con semáforo, top-5 de etapas y listas colapsables', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => RESPUESTA }));
    await mount();

    expect(texto()).toContain('Dispatch — CAE Operaciones');
    expect(texto()).toContain('Corte 2026-09-25');
    ['Ana Ruiz', 'Beto Lara', 'Caro Díaz', 'Dani Sosa', 'Eva Mora'].forEach(n => expect(texto()).toContain(n));
    expect(host.querySelector('[role="alert"]')).toBeNull();

    // truncado: conteos como piso, nunca como total exacto
    expect(texto()).toContain('PARCIAL');
    expect(texto()).toContain('≥200');
    expect(texto()).toContain('≥80');

    // % vencido por umbral: 10% verde · 30% ámbar · 50% rojo · 0% sin abiertas
    expect(texto()).toContain('10%');
    expect(texto()).toContain('30%');
    expect(texto()).toContain('50%');
    expect(texto()).toMatch(/(^|\D)0%/);
    const html = host.innerHTML;
    expect(html).toContain('#FFB703');  // ámbar 20–35% (nadie tiene próximas)
    expect(html).toContain('#FF4757');  // rojo > 35%
    expect(html).toContain('#00C896');  // verde < 20%

    // Solo top 5 etapas de las 7 recibidas
    expect(texto()).toContain('Revisión');
    expect(texto()).not.toContain('Cerrado');
    expect(texto()).not.toContain('Archivado');

    // Colapsable: cerrado por defecto, abre al click, nombre truncado a 55
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.textContent).toContain('Vencidas');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(texto()).not.toContain('Revisión completa de radiobase');

    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(texto()).toContain('2026-09-10');
    expect(texto()).toContain(LARGO.slice(0, 54) + '…');
    expect(texto()).not.toContain(LARGO);
  });

  // El backend reporta fallos de Odoo como HTTP 200 + {error, personas: []}.
  // Se fuerza vía "Actualizar" para no depender del estado del caché de módulo.
  it('trata un 200 con campo error como error, no como éxito vacío', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ error: 'Odoo no respondió para Ana Ruiz', personas: [] }),
    }));
    await mount();
    await act(async () => { refreshBtn().click(); });

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(texto()).toContain('Odoo no respondió para Ana Ruiz');
    expect(texto()).not.toContain('Sin personas con tareas asignadas');
  });

  it('reusa el caché de 5 min y refetchea al pulsar Actualizar', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => RESPUESTA });
    vi.stubGlobal('fetch', f);

    await mount();                       // caché ya poblado por el test anterior
    expect(f).not.toHaveBeenCalled();
    expect(texto()).toContain('Ana Ruiz');

    await act(async () => { refreshBtn().click(); });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
