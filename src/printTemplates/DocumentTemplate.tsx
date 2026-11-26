import React from 'react';
import type {
  PrintDocumentData,
  PrintTemplateVariant,
} from './types';
import type { PaperWidth } from '../types/pos';

interface DocumentTemplateProps {
  data: PrintDocumentData;
  format: PaperWidth;
  variant: PrintTemplateVariant;
}

const colors: Record<PrintTemplateVariant, { accent: string; muted: string; border: string }> = {
  classic: { accent: '#111827', muted: '#4b5563', border: '#9ca3af' },
  minimal: { accent: '#0f172a', muted: '#64748b', border: '#cbd5e1' },
  bold: { accent: '#0b4a6f', muted: '#334155', border: '#64748b' },
  bilingual: { accent: '#14532d', muted: '#475569', border: '#94a3b8' },
  kitchen: { accent: '#111827', muted: '#374151', border: '#6b7280' },
  'kitchen-compact': { accent: '#000000', muted: '#404040', border: '#737373' },
  'kitchen-station': { accent: '#7c2d12', muted: '#44403c', border: '#a8a29e' },
  'ledger-summary': { accent: '#1e3a8a', muted: '#475569', border: '#94a3b8' },
  'ledger-detailed': { accent: '#0f172a', muted: '#475569', border: '#64748b' },
  'tax-standard': { accent: '#14532d', muted: '#475569', border: '#94a3b8' },
  'tax-compact': { accent: '#1e293b', muted: '#475569', border: '#94a3b8' },
  'shift-summary': { accent: '#1e3a8a', muted: '#475569', border: '#94a3b8' },
  'shift-detailed': { accent: '#0f172a', muted: '#475569', border: '#64748b' },
};

const thermalFontSize: Record<PaperWidth, string> = {
  '80mm': '10px',
  '58mm': '8px',
  A4: '11px',
};

export const DocumentTemplate: React.FC<DocumentTemplateProps> = ({
  data,
  format,
  variant,
}) => {
  const palette = colors[variant];
  const compact = format !== 'A4' || variant === 'minimal' || variant === 'kitchen-compact' || variant === 'tax-compact';
  const tableFontSize = format === '58mm' ? '7px' : format === '80mm' ? '8px' : '9px';

  return (
    <article
      data-print-document
      dir={data.direction || 'ltr'}
      style={{
        boxSizing: 'border-box',
        width: format === 'A4' ? '190mm' : format,
        maxWidth: format === 'A4' ? '190mm' : format,
        minHeight: format === 'A4' ? '277mm' : undefined,
        margin: '0 auto',
        padding: format === 'A4' ? '0' : '2mm',
        background: '#fff',
        color: '#111827',
        fontFamily: 'Arial, "Segoe UI", sans-serif',
        fontSize: thermalFontSize[format],
        lineHeight: 1.35,
        overflowWrap: 'anywhere',
      }}
    >
      <header
        style={{
          borderBottom: `2px solid ${palette.accent}`,
          paddingBottom: compact ? '5px' : '9px',
          marginBottom: compact ? '7px' : '12px',
          textAlign: 'center',
        }}
      >
        {data.companyLogo && (
          <img
            src={data.companyLogo}
            alt=""
            style={{ display: 'block', maxWidth: '34mm', maxHeight: '18mm', objectFit: 'contain', margin: '0 auto 5px' }}
          />
        )}
        <div style={{ color: palette.accent, fontSize: compact ? '1.2em' : '1.5em', fontWeight: 800 }}>
          {data.companyName || 'aptPOS'}
        </div>
        {data.companyNameAr && (
          <div dir="rtl" style={{ fontSize: '1.1em', fontWeight: 700 }}>{data.companyNameAr}</div>
        )}
        {(data.companyAddress || data.companyPhone) && (
          <div style={{ color: palette.muted, marginTop: '3px' }}>
            {[data.companyAddress, data.companyPhone].filter(Boolean).join(' · ')}
          </div>
        )}
        {data.companyTaxId && (
          <div style={{ color: palette.muted, marginTop: '2px' }}>VAT: {data.companyTaxId}</div>
        )}
        <h1 style={{ color: palette.accent, fontSize: compact ? '1.25em' : '1.55em', margin: '7px 0 2px', fontWeight: 800 }}>
          {data.title}
        </h1>
        {data.number && <div style={{ color: palette.muted, fontWeight: 700 }}>{data.number}</div>}
        {data.date && <div style={{ color: palette.muted }}>{data.date}</div>}
      </header>

      {data.fields.length > 0 && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: format === 'A4' ? 'repeat(2, minmax(0, 1fr))' : '1fr',
            gap: compact ? '3px 8px' : '6px 12px',
            borderBottom: `1px solid ${palette.border}`,
            paddingBottom: compact ? '5px' : '8px',
            marginBottom: compact ? '6px' : '10px',
          }}
        >
          {data.fields.map((field, index) => (
            <div key={`${field.label}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
              <span style={{ color: palette.muted }}>{field.label}</span>
              <strong style={{ textAlign: 'right', fontWeight: 700 }}>{field.value || '—'}</strong>
            </div>
          ))}
        </section>
      )}

      {data.columns.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: tableFontSize }}>
          <thead>
            <tr style={{ background: variant === 'minimal' ? '#fff' : palette.accent, color: variant === 'minimal' ? palette.accent : '#fff' }}>
              {data.columns.map((column, index) => (
                <th
                  key={`${column}-${index}`}
                  style={{
                    borderBottom: `1px solid ${palette.border}`,
                    padding: compact ? '3px 2px' : '5px 4px',
                    textAlign: index === 0 ? 'center' : 'start',
                    fontWeight: 700,
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={rowIndex} style={{ borderBottom: `1px solid ${palette.border}`, fontWeight: row.emphasis ? 700 : 400 }}>
                {data.columns.map((_, columnIndex) => (
                  <td
                    key={`${rowIndex}-${columnIndex}`}
                    style={{
                      padding: compact ? '3px 2px' : '5px 4px',
                      verticalAlign: 'top',
                      textAlign: columnIndex === 0 ? 'center' : 'start',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {row.values[columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, data.columns.length)} style={{ padding: '7px 3px', textAlign: 'center', color: palette.muted }}>
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {data.totals.length > 0 && (
        <section style={{ marginTop: compact ? '7px' : '12px', borderTop: `1px solid ${palette.border}`, paddingTop: '5px' }}>
          {data.totals.map((total, index) => (
            <div
              key={`${total.label}-${index}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
                padding: compact ? '2px 0' : '4px 0',
                fontWeight: index === data.totals.length - 1 ? 800 : 600,
                color: index === data.totals.length - 1 ? palette.accent : '#111827',
                borderTop: index === data.totals.length - 1 ? `1px solid ${palette.border}` : undefined,
              }}
            >
              <span>{total.label}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total.value}</span>
            </div>
          ))}
        </section>
      )}

      {data.qrDataUrl && (
        <div style={{ marginTop: '10px', textAlign: 'center' }}>
          <img src={data.qrDataUrl} alt="E-invoice QR code" style={{ width: '25mm', height: '25mm' }} />
        </div>
      )}

      {data.footer && (
        <footer style={{ marginTop: compact ? '8px' : '14px', paddingTop: '5px', borderTop: `1px solid ${palette.border}`, textAlign: 'center', color: palette.muted }}>
          {data.footer}
        </footer>
      )}
    </article>
  );
};
