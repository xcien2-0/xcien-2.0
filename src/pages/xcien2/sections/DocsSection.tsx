import React, { useState, useEffect } from 'react';
import { ThemeConfig } from '../types';
import { API_BASE } from '../../../config';

interface Document {
  id: string;
  name: string;
  filename: string;
  type: 'pdf' | 'md';
  category: string;
  path: string;
}

export default function DocsSection({ theme }: { theme: ThemeConfig }) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/library/docs`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'success') {
          setDocs(data.documents);
        } else {
          throw new Error("Invalid status");
        }
      })
      .catch(e => {
        console.error("Error loading library, using mocks", e);
        setDocs([
          { id: 'd1', name: 'Manual de Instalación Mikrotik v2', filename: 'manual_mt_v2.pdf', type: 'pdf', category: 'Manuales Técnicos', path: 'manuales/mt.pdf' },
          { id: 'd2', name: 'Estándar de Cableado Estructurado 2026', filename: 'estandar_cableado.pdf', type: 'pdf', category: 'Estándares', path: 'estandares/cableado.pdf' },
          { id: 'd3', name: 'Reporte de Gobierno Q1 2025', filename: 'reporte_gob_q1.pdf', type: 'pdf', category: 'Reportes', path: 'reportes/gob.pdf' }
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Filter docs by search term
  const filteredDocs = docs.filter(doc => 
    doc.name.toLowerCase().includes(search.toLowerCase()) || 
    doc.category.toLowerCase().includes(search.toLowerCase())
  );

  // Group by category
  const groupedDocs = filteredDocs.reduce((acc, doc) => {
    if (!acc[doc.category]) acc[doc.category] = [];
    acc[doc.category].push(doc);
    return acc;
  }, {} as Record<string, Document[]>);

  const accent = theme.accent;

  const handleOpenDoc = (path: string) => {
    window.open(`${API_BASE}/api/library/download?path=${encodeURIComponent(path)}`, '_blank');
  };

  const handleDownloadDoc = async (e: React.MouseEvent, path: string, filename: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/api/library/download?path=${encodeURIComponent(path)}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(`${API_BASE}/api/library/download?path=${encodeURIComponent(path)}`, '_blank');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ borderBottom: `2px solid ${accent}`, paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: theme.text, margin: 0, textTransform: 'uppercase' }}>📚 Biblioteca Documental</h2>
          <p style={{ fontSize: 13, color: theme.dim, marginTop: 4 }}>Repositorio central de manuales, estándares y reportes estratégicos generados.</p>
        </div>
        <div style={{ width: 300 }}>
          <input 
            type="text" 
            placeholder="Buscar documentos..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '10px 16px', borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
              color: '#fff', fontSize: 14, outline: 'none'
            }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: theme.dim }}>Cargando biblioteca...</div>
      ) : Object.keys(groupedDocs).length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: theme.dim }}>No se encontraron documentos.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {Object.entries(groupedDocs).map(([category, items]) => (
            <div key={category}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: accent, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📁</span> {category}
                <span style={{ fontSize: 12, fontWeight: 500, color: theme.dim, background: `${accent}15`, padding: '2px 8px', borderRadius: 12 }}>
                  {items.length} archivo{items.length !== 1 ? 's' : ''}
                </span>
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {items.map(doc => (
                  <div 
                    key={doc.id}
                    onClick={() => handleOpenDoc(doc.path)}
                    style={{
                      background: theme.card,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 12, padding: 16,
                      cursor: 'pointer', transition: 'all 0.2s',
                      display: 'flex', flexDirection: 'column', gap: 12,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      position: 'relative', overflow: 'hidden'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = accent}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = theme.border}
                  >
                    {/* Icon banner */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 32 }}>
                        {doc.type === 'pdf' ? '📄' : '📝'}
                      </div>
                      <span style={{ 
                        fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase',
                        background: doc.type === 'pdf' ? '#FF475720' : '#4FC3F720',
                        color: doc.type === 'pdf' ? '#FF4757' : '#4FC3F7',
                        border: `1px solid ${doc.type === 'pdf' ? '#FF475740' : '#4FC3F740'}`
                      }}>
                        {doc.type}
                      </span>
                    </div>
                    
                    {/* Title */}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, lineHeight: 1.3, marginBottom: 4 }}>
                        {doc.name}
                      </div>
                      <div style={{ fontSize: 11, color: theme.dim, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {doc.filename}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenDoc(doc.path); }}
                        style={{
                          flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600,
                          background: 'rgba(255,255,255,0.05)', border: `1px solid ${theme.border}`,
                          borderRadius: 6, color: theme.dim, cursor: 'pointer',
                        }}
                      >
                        👁 Ver
                      </button>
                      <button
                        onClick={(e) => handleDownloadDoc(e, doc.path, doc.filename)}
                        style={{
                          flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600,
                          background: `${accent}18`, border: `1px solid ${accent}50`,
                          borderRadius: 6, color: accent, cursor: 'pointer',
                        }}
                      >
                        ⬇ Descargar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
