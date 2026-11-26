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
  '58mm': '9px',
  A4: '11px',
};

const monochromePalette = { accent: '#000000', muted: '#000000', border: '#000000' };
const screenTextFont = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const screenDigitFont = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

export const DocumentTemplate: React.FC<DocumentTemplateProps> = ({
  data,
  format,
  variant,
}) => {
  const palette = format === 'A4' ? colors[variant] : monochromePalette;
  const compact = format !== 'A4' || variant === 'minimal' || variant === 'kitchen-compact' || variant === 'tax-compact';
  const tableFontSize = format === '58mm' ? '8px' : format === '80mm' ? '9px' : '9px';
  const foreground = format === 'A4' ? '#111827' : '#000000';

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
        color: foreground,
        fontFamily: screenTextFont,
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
            style={{
              display: 'block',
              maxWidth: '34mm',
              maxHeight: '18mm',
              objectFit: 'contain',
              margin: '0 auto 5px',
              ...(format === 'A4' ? {} : { filter: 'grayscale(1) contrast(1.2)' }),
            }}
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
          <div style={{ color: palette.muted, marginTop: '2px' }}>
            {data.multiLanguage ? 'VAT / الرقم الضريبي' : data.direction === 'rtl' ? 'الرقم الضريبي' : 'VAT'}:{' '}
            <span style={{ fontFamily: screenDigitFont, fontVariantNumeric: 'tabular-nums' }}>{data.companyTaxId}</span>
          </div>
        )}
        <h1 style={{ color: palette.accent, fontSize: compact ? '1.25em' : '1.55em', margin: '7px 0 2px', fontWeight: 800 }}>
          {data.title}
        </h1>
        {data.number && (
          <div style={{ color: palette.muted, fontWeight: 700, fontFamily: screenDigitFont, fontVariantNumeric: 'tabular-nums' }}>
            {data.number}
          </div>
        )}
        {data.date && (
          <div style={{ color: palette.muted, fontFamily: screenDigitFont, fontVariantNumeric: 'tabular-nums' }}>
            {data.date}
          </div>
        )}
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
              <span style={{ color: palette.muted }}><bdi dir="auto">{field.label}</bdi></span>
              <strong style={{ textAlign: 'right', fontWeight: 700 }}><bdi dir="auto">{field.value || '—'}</bdi></strong>
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
                  <bdi dir="auto">{column}</bdi>
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
                      textAlign: data.numericColumns?.includes(columnIndex)
                        ? 'end'
                        : columnIndex === 0
                          ? 'center'
                          : 'start',
                      ...(data.numericColumns?.includes(columnIndex)
                        ? { fontFamily: screenDigitFont, fontVariantNumeric: 'tabular-nums' }
                        : {}),
                      overflowWrap: 'anywhere',
                    }}
                  >
                    <bdi dir="auto">{row.values[columnIndex] ?? ''}</bdi>
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
                color: index === data.totals.length - 1 ? palette.accent : foreground,
                borderTop: index === data.totals.length - 1 ? `1px solid ${palette.border}` : undefined,
              }}
            >
              <span><bdi dir="auto">{total.label}</bdi></span>
              <span style={{ textAlign: 'right', fontFamily: screenDigitFont, fontVariantNumeric: 'tabular-nums' }}>
                <bdi dir="auto">{total.value}</bdi>
              </span>
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
