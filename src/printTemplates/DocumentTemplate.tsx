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
  flyerp: { accent: '#1e3a8a', muted: '#475569', border: '#cbd5e1' },
};

const thermalFontSize: Record<PaperWidth, string> = {
  '80mm': '11px',
  '58mm': '10px',
  A4: '11px',
};

const monochromePalette = { accent: '#000000', muted: '#000000', border: '#000000' };
const screenTextFont = 'Arial, "Segoe UI", Tahoma, sans-serif';
const screenDigitFont = '"Consolas", "Courier New", monospace';
const a4TextFont = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const a4DigitFont = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

export const DocumentTemplate: React.FC<DocumentTemplateProps> = ({
  data,
  format,
  variant,
}) => {
  const isThermal = format !== 'A4';
  const palette = isThermal ? monochromePalette : colors[variant];
  const textFont = isThermal ? screenTextFont : a4TextFont;
  const digitFont = isThermal ? screenDigitFont : a4DigitFont;
  const isKot = data.documentType === 'kot';
  const hasSerialColumn =
    data.documentType === 'sales-invoice' ||
    data.documentType === 'sales-return' ||
    data.documentType === 'purchase-invoice' ||
    data.documentType === 'purchase-return';
  const compact = isThermal || variant === 'minimal' || variant === 'kitchen-compact' || variant === 'tax-compact';
  const tableFontSize = isKot
    ? format === '58mm' ? '12px' : format === '80mm' ? '14px' : '16px'
    : format === '58mm' ? '9.5px' : format === '80mm' ? '10.5px' : '9px';
  const foreground = isThermal ? '#000000' : '#111827';
  const dividerStyle = isThermal ? '1px dashed #000000' : `1px solid ${palette.border}`;

  return (
    <article
      data-print-document
      dir={data.direction || 'ltr'}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
        margin: '0 auto',
        padding: 0,
        paddingBottom: isThermal ? '4mm' : 0,
        background: '#fff',
        color: foreground,
        fontFamily: textFont,
        fontSize: thermalFontSize[format],
        lineHeight: isThermal ? 1.3 : 1.35,
        overflowWrap: 'anywhere',
      }}
    >
      <header
        style={{
          borderBottom: isThermal ? '1px dashed #000000' : `2px solid ${palette.accent}`,
          paddingBottom: compact ? '6px' : '9px',
          marginBottom: compact ? '6px' : '12px',
          textAlign: 'center',
        }}
      >
        {data.companyLogo && (
          <img
            src={data.companyLogo}
            alt=""
            style={{
              display: 'block',
              maxWidth: `${Math.min(60, Math.max(12, data.logoSizeMm ?? 34))}mm`,
              maxHeight: `${Math.round(Math.min(60, Math.max(12, data.logoSizeMm ?? 34)) * 0.6)}mm`,
              objectFit: 'contain',
              margin: '0 auto 5px',
              ...(isThermal ? { filter: 'grayscale(1) contrast(1.2)' } : {}),
            }}
          />
        )}
        {!isKot && (
          <div style={{ color: palette.accent, fontSize: compact ? '1.2em' : '1.5em', fontWeight: 800 }}>
            {data.companyName || 'aptPOS'}
          </div>
        )}
        {!isKot && data.companyNameAr && (
          <div dir="rtl" style={{ fontSize: '1.1em', fontWeight: 700 }}>{data.companyNameAr}</div>
        )}
        {!isKot && (data.companyAddress || data.companyPhone) && (
          <div style={{ color: palette.muted, marginTop: '3px' }}>
            {[data.companyAddress, data.companyPhone].filter(Boolean).join(' · ')}
          </div>
        )}
        {!isKot && data.companyTaxId && (
          <div style={{ color: palette.muted, marginTop: '2px' }}>
            {data.multiLanguage ? 'VAT / الرقم الضريبي' : data.direction === 'rtl' ? 'الرقم الضريبي' : 'VAT'}:{' '}
            <span style={{ fontFamily: digitFont, fontVariantNumeric: 'tabular-nums' }}>{data.companyTaxId}</span>
          </div>
        )}
        <h1 style={{ color: palette.accent, fontSize: isKot ? '1.7em' : compact ? '1.2em' : '1.55em', margin: '6px 0 2px', fontWeight: 800 }}>
          {data.title}
        </h1>
        {data.number && (
          <div style={{
            color: palette.muted,
            fontWeight: isKot ? 900 : 700,
            fontSize: isKot ? '1.9em' : undefined,
            fontFamily: digitFont,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {data.number}
          </div>
        )}
        {data.date && (
          <div style={{ color: palette.muted, fontFamily: digitFont, fontVariantNumeric: 'tabular-nums' }}>
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
            borderBottom: dividerStyle,
            paddingBottom: compact ? '6px' : '8px',
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
            <tr style={{
              background: isThermal || variant === 'minimal' ? '#ffffff' : palette.accent,
              color: isThermal || variant === 'minimal' ? palette.accent : '#ffffff',
            }}>
              {data.columns.map((column, index) => (
                <th
                  key={`${column}-${index}`}
                  style={{
                    borderBottom: isThermal ? '1px solid #000000' : `1px solid ${palette.border}`,
                    padding: compact ? '3px 2px' : '5px 4px',
                    textAlign: data.documentType === 'kot' && index === 1 ? 'end' : index === 0 ? 'center' : 'start',
                    ...(hasSerialColumn && index === 0
                      ? { width: format === '58mm' ? '8%' : '6%', paddingLeft: '1px', paddingRight: '1px', whiteSpace: 'nowrap' as const }
                      : {}),
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
              <tr key={rowIndex} style={{
                borderBottom: isThermal ? '1px dotted #000000' : `1px solid ${palette.border}`,
                fontWeight: row.emphasis ? 700 : 400,
              }}>
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
                      ...(hasSerialColumn && columnIndex === 0
                        ? { width: format === '58mm' ? '8%' : '6%', paddingLeft: '1px', paddingRight: '1px', whiteSpace: 'nowrap' as const }
                        : {}),
                      ...(isKot && columnIndex === 0
                        ? { fontWeight: 800, whiteSpace: 'pre-line' as const }
                        : {}),
                      ...(data.documentType === 'sales-invoice' && columnIndex === 1
                        ? { whiteSpace: 'pre-line' as const }
                        : {}),
                      ...(data.numericColumns?.includes(columnIndex)
                        ? { fontFamily: digitFont, fontVariantNumeric: 'tabular-nums' }
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
        <section style={{ marginTop: compact ? '6px' : '12px', borderTop: dividerStyle, paddingTop: '5px' }}>
          {data.totals.map((total, index) => (
            <div
              key={`${total.label}-${index}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
                padding: compact ? '2px 0' : '4px 0',
                fontWeight: index === data.totals.length - 1 ? 800 : 600,
                fontSize: isThermal && index === data.totals.length - 1 ? '1.15em' : undefined,
                color: index === data.totals.length - 1 ? palette.accent : foreground,
                borderTop: index === data.totals.length - 1 ? dividerStyle : undefined,
              }}
            >
              <span><bdi dir="auto">{total.label}</bdi></span>
              <span style={{ textAlign: 'right', fontFamily: digitFont, fontVariantNumeric: 'tabular-nums' }}>
                <bdi dir="auto">{total.value}</bdi>
              </span>
            </div>
          ))}
        </section>
      )}

      {data.footer && (
        <footer style={{ marginTop: compact ? '8px' : '14px', paddingTop: '5px', borderTop: dividerStyle, textAlign: 'center', color: palette.muted }}>
          {data.footer}
        </footer>
      )}

      {data.qrDataUrl && (
        <div style={{ marginTop: '10px', textAlign: 'center', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <img
            src={data.qrDataUrl}
            alt="ZATCA e-invoice QR code"
            style={{ display: 'inline-block', width: `${data.qrSizeMm ?? 25}mm`, height: `${data.qrSizeMm ?? 25}mm` }}
          />
        </div>
      )}
    </article>
  );
};
