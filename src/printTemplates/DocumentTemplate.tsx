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

const A4_PALETTE = {
  accent: '#0f172a',
  primary: '#1d4ed8',
  muted: '#475569',
  subtleBg: '#f8fafc',
  border: '#cbd5e1',
  borderLight: '#e2e8f0',
};

const THERMAL_PALETTE = {
  accent: '#000000',
  primary: '#000000',
  muted: '#000000',
  subtleBg: '#ffffff',
  border: '#000000',
  borderLight: '#000000',
};

const MODERN_TEXT_FONT = '"Cairo", "Plus Jakarta Sans", "Segoe UI", Tahoma, Arial, sans-serif';
const MODERN_DIGIT_FONT = '"JetBrains Mono", "Consolas", "Courier New", monospace';

const ARABIC_REGEX = /[\u0600-\u06FF]/;

function splitBilingual(value: string): { primary: string; secondary?: string } {
  const parts = value.split(' / ').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { primary: parts[0], secondary: parts.slice(1).join(' / ') };
  }
  return { primary: value };
}

function getColumnWidth(
  columnIndex: number,
  columnCount: number,
  isKot: boolean,
  hasSerialColumn: boolean,
  format: PaperWidth
): string | undefined {
  if (isKot) {
    return columnIndex === 0 ? '78%' : '22%';
  }
  if (!hasSerialColumn) {
    return undefined;
  }
  if (format === '58mm') {
    if (columnCount === 4) return ['8%', '50%', '14%', '28%'][columnIndex];
    if (columnCount === 5) return ['7%', '41%', '12%', '18%', '22%'][columnIndex];
  }
  if (format === '80mm') {
    if (columnCount === 4) return ['7%', '53%', '14%', '26%'][columnIndex];
    if (columnCount === 5) return ['6%', '44%', '12%', '17%', '21%'][columnIndex];
    if (columnCount === 6) return ['5%', '37%', '10%', '15%', '14%', '19%'][columnIndex];
  }
  if (format === 'A4' || format === 'A5' || format === 'Custom') {
    if (columnCount === 4) return ['6%', '56%', '14%', '24%'][columnIndex];
    if (columnCount === 5) return ['5%', '47%', '11%', '17%', '20%'][columnIndex];
    if (columnCount === 6) return ['5%', '41%', '10%', '14%', '13%', '17%'][columnIndex];
    if (columnCount === 7) return ['5%', '37%', '9%', '12%', '12%', '10%', '15%'][columnIndex];
  }
  return undefined;
}

function parseDetailLine(line: string): { label: string; value: string } | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex <= 0 || colonIndex >= line.length - 1) return null;
  const label = line.slice(0, colonIndex).trim();
  const value = line.slice(colonIndex + 1).trim();
  if (!label || !value || label.length > 64) return null;
  return { label, value };
}

function splitEnglishArabic(value: string): { english: string; arabic: string } | null {
  if (!value.includes(' / ')) return null;
  const parts = value.split(' / ').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const arabicParts = parts.filter((part) => ARABIC_REGEX.test(part));
  const englishParts = parts.filter((part) => !ARABIC_REGEX.test(part));
  if (arabicParts.length === 0 || englishParts.length === 0) return null;
  return {
    english: englishParts.join(' / '),
    arabic: arabicParts.join(' / '),
  };
}

function renderBilingualText(
  value: string,
  isMultiLanguage: boolean,
  isRtlOnly: boolean,
  style?: React.CSSProperties
) {
  if (isMultiLanguage) {
    const split = splitEnglishArabic(value);
    if (split) {
      return (
        <div
          dir="ltr"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '6px',
            width: '100%',
            ...style,
          }}
        >
          <span dir="ltr" style={{ textAlign: 'left', minWidth: 0, wordBreak: 'break-word' }}>
            {split.english}
          </span>
          <span dir="rtl" style={{ textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>
            {split.arabic}
          </span>
        </div>
      );
    }
  }
  return (
    <div
      dir={isRtlOnly ? 'rtl' : 'ltr'}
      style={{
        textAlign: isRtlOnly ? 'right' : 'left',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
        ...style,
      }}
    >
      <bdi dir="auto">{value}</bdi>
    </div>
  );
}

function extractProductSubContents(rawValue: string): {
  primaryLine: string;
  detailItems: Array<{ label: string; value: string }>;
  noteLines: string[];
} {
  const lines = rawValue.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { primaryLine: '—', detailItems: [], noteLines: [] };
  }
  const primaryLine = lines[0];
  const detailItems: Array<{ label: string; value: string }> = [];
  const noteLines: string[] = [];
  lines.slice(1).forEach((line) => {
    const parsed = parseDetailLine(line);
    if (parsed) detailItems.push(parsed);
    else noteLines.push(line);
  });
  return { primaryLine, detailItems, noteLines };
}

function renderFullWidthSubContents(
  detailItems: Array<{ label: string; value: string }>,
  noteLines: string[],
  isMultiLanguage: boolean,
  isRtlOnly: boolean
) {
  const cellDir = isRtlOnly ? 'rtl' : 'ltr';
  const cellAlign = isRtlOnly ? 'right' : 'left';
  const gridCols = detailItems.length <= 1
    ? 'minmax(0, 1fr)'
    : `repeat(${Math.min(4, detailItems.length)}, minmax(0, 1fr))`;

  return (
    <div dir={cellDir} style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', textAlign: cellAlign }}>
      {detailItems.length > 0 && (
        <div
          dir={cellDir}
          style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            gap: '6px 14px',
            padding: '7px 10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            width: '100%',
            textAlign: cellAlign,
          }}
        >
          {detailItems.map((detail, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1px',
                minWidth: 0,
                textAlign: cellAlign,
              }}
            >
              {renderBilingualText(detail.label, isMultiLanguage, isRtlOnly, {
                fontSize: '0.76em',
                fontWeight: 600,
                color: '#64748b',
                lineHeight: 1.2,
              })}
              {renderBilingualText(detail.value, isMultiLanguage, isRtlOnly, {
                fontSize: '0.88em',
                fontWeight: 700,
                color: '#0f172a',
                lineHeight: 1.25,
              })}
            </div>
          ))}
        </div>
      )}
      {noteLines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingInlineStart: '2px' }}>
          {noteLines.map((note, idx) => (
            <div key={idx}>
              {renderBilingualText(note, isMultiLanguage, isRtlOnly, {
                fontSize: '0.84em',
                fontWeight: 500,
                color: '#475569',
                lineHeight: 1.3,
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function renderResponsiveProductCell(
  rawValue: string,
  isThermal: boolean,
  isCompact: boolean,
  isMultiLanguage: boolean,
  isRtlOnly: boolean
) {
  const lines = rawValue.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return '—';

  const primaryLine = lines[0];
  const subLines = lines.slice(1);
  const cellDir = isRtlOnly ? 'rtl' : 'ltr';
  const cellAlign = isRtlOnly ? 'right' : 'left';

  if (subLines.length === 0) {
    return renderBilingualText(primaryLine, isMultiLanguage, isRtlOnly, {
      fontWeight: 700,
      fontSize: '1em',
      lineHeight: 1.3,
      color: isThermal ? '#000000' : '#0f172a',
    });
  }

  const detailItems: Array<{ label: string; value: string }> = [];
  const noteLines: string[] = [];
  subLines.forEach((line) => {
    const parsed = parseDetailLine(line);
    if (parsed) detailItems.push(parsed);
    else noteLines.push(line);
  });

  if (!isThermal && !isCompact && detailItems.length > 0) {
    return (
      <div dir={cellDir} style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: cellAlign }}>
        {renderBilingualText(primaryLine, isMultiLanguage, isRtlOnly, {
          fontWeight: 700,
          fontSize: '1em',
          lineHeight: 1.3,
          color: '#0f172a',
        })}
        <div
          dir={cellDir}
          style={{
            display: 'grid',
            gridTemplateColumns: detailItems.length === 1 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
            gap: '5px 12px',
            padding: '6px 8px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            textAlign: cellAlign,
          }}
        >
          {detailItems.map((detail, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1px',
                minWidth: 0,
                textAlign: cellAlign,
              }}
            >
              {renderBilingualText(detail.label, isMultiLanguage, isRtlOnly, {
                fontSize: '0.76em',
                fontWeight: 600,
                color: '#64748b',
                lineHeight: 1.2,
              })}
              {renderBilingualText(detail.value, isMultiLanguage, isRtlOnly, {
                fontSize: '0.88em',
                fontWeight: 700,
                color: '#0f172a',
                lineHeight: 1.25,
              })}
            </div>
          ))}
        </div>
        {noteLines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingInlineStart: '2px' }}>
            {noteLines.map((note, idx) => (
              <div key={idx}>
                {renderBilingualText(note, isMultiLanguage, isRtlOnly, {
                  fontSize: '0.84em',
                  fontWeight: 500,
                  color: '#475569',
                  lineHeight: 1.3,
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div dir={cellDir} style={{ display: 'flex', flexDirection: 'column', gap: isCompact ? '1px' : '2px', textAlign: cellAlign }}>
      {renderBilingualText(primaryLine, isMultiLanguage, isRtlOnly, {
        fontWeight: 700,
        fontSize: '1em',
        lineHeight: 1.28,
        color: isThermal ? '#000000' : '#0f172a',
      })}
      {subLines.map((line, lineIndex) => {
        const parsed = parseDetailLine(line);
        if (parsed) {
          return (
            <div
              key={lineIndex}
              dir={cellDir}
              style={{
                fontSize: isThermal ? '0.9em' : '0.86em',
                lineHeight: 1.28,
                color: isThermal ? '#000000' : '#334155',
                textAlign: cellAlign,
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              <span style={{ color: isThermal ? '#000000' : '#64748b', fontWeight: 600 }}>
                <bdi dir="auto">{parsed.label}</bdi>:{' '}
              </span>
              <span style={{ fontWeight: 600, color: isThermal ? '#000000' : '#0f172a' }}>
                <bdi dir="auto">{parsed.value}</bdi>
              </span>
            </div>
          );
        }
        return (
          <div key={lineIndex}>
            {renderBilingualText(line, isMultiLanguage, isRtlOnly, {
              fontWeight: 500,
              fontSize: isThermal ? '0.92em' : '0.88em',
              lineHeight: 1.28,
              color: isThermal ? '#000000' : '#475569',
            })}
          </div>
        );
      })}
    </div>
  );
}

export const DocumentTemplate: React.FC<DocumentTemplateProps> = ({
  data,
  format,
  variant,
}) => {
  const isThermal = format === '58mm' || format === '80mm';
  const isCompact = variant === 'minimal';
  const isModern80mm = format === '80mm' && !isCompact;
  const isKot = data.documentType === 'kot';
  const palette = isThermal ? THERMAL_PALETTE : A4_PALETTE;
  const isMainTotalLabel = (label: string) =>
    /^(total|grand total|total refund|amount received|settled amount|الإجمالي|المجموع الكلي|إجمالي المبلغ المسترد|المبلغ المستلم|المبلغ المسدد)(\s*\/|$)/i.test(
      label.trim()
    );
  const explicitMainTotalIndex = data.totals.findIndex((t) => isMainTotalLabel(t.label));
  const grandTotalIndex = explicitMainTotalIndex >= 0 ? explicitMainTotalIndex : data.totals.length - 1;
  const hasSerialColumn =
    data.documentType === 'sales-invoice' ||
    data.documentType === 'sales-return' ||
    data.documentType === 'purchase-invoice' ||
    data.documentType === 'purchase-return';

  const baseFontSize =
    format === '58mm'
      ? isCompact ? '9.5px' : '10px'
      : format === '80mm'
        ? isCompact ? '10.5px' : '11px'
        : isCompact ? '10.5px' : '11.5px';

  const tableFontSize = isKot
    ? format === '58mm' ? '12.5px' : format === '80mm' ? '14px' : '15px'
    : format === '58mm'
      ? isCompact ? '9px' : '9.5px'
      : format === '80mm'
        ? isCompact ? '10px' : '10.5px'
        : isCompact ? '10px' : '10.5px';

  const logoWidthMm = Math.min(60, Math.max(12, data.logoSizeMm ?? 34));
  const logoHeightMm = Math.round(logoWidthMm * 0.6);
  const qrSizeMm = Math.min(50, Math.max(15, data.qrSizeMm ?? 25));
  const titleParts = splitBilingual(data.title);
  const divider = isThermal ? '1px dashed #000000' : `1px solid ${palette.borderLight}`;
  const strongDivider = isThermal ? '1.5px solid #000000' : `2px solid ${palette.accent}`;

  if (isModern80mm) {
    const rule = '1px solid #222222';
    const isRtlOnly = data.direction === 'rtl' && !data.multiLanguage;
    const isMulti = Boolean(data.multiLanguage);
    const lbl = (en: string, ar: string) => (isMulti ? `${en} / ${ar}` : isRtlOnly ? ar : en);

    // Extract common metadata fields so they sit in their exact retail-receipt positions
    const findField = (pattern: RegExp) =>
      data.fields.find((f) => pattern.test(f.label));
    const customerField = findField(/^(customer|العميل|vendor|المورد)(\s*\/|$)/i);
    const cashierField = findField(/^(cashier|الكاشير)(\s*\/|$)/i);
    const paymentField = findField(/^(payment method|طريقة الدفع|payment|الدفع)(\s*\/|$)/i);
    const customerDetailFields = data.fields.filter(
      (f) =>
        f !== customerField &&
        /^(customer |اسم العميل|هاتف العميل|البريد الإلكتروني للعميل|عنوان العميل|الرقم الضريبي للعميل|السجل التجاري للعميل|building no|رقم المبنى|street|الشارع|district|الحي|city|المدينة|postal code|الرمز البريدي|country|الدولة)/i.test(
          f.label.trim()
        )
    );
    const usedFieldSet = new Set([customerField, cashierField, paymentField, ...customerDetailFields].filter(Boolean));
    const extraFields = data.fields.filter((f) => !usedFieldSet.has(f));

    // Extract totals cleanly
    const findTotal = (pattern: RegExp) =>
      data.totals.find((t) => pattern.test(t.label.trim()));
    const subtotalTotal = findTotal(/^(subtotal|المجموع الفرعي|الإجمالي الفرعي)(\s*\/|$)/i);
    const discountTotal = findTotal(/^(discount|الخصم)(\s*\/|$)/i);
    const taxTotal = findTotal(/^(tax|vat|الضريبة|ضريبة القيمة المضافة)(\s*\/|$)/i);
    const grandTotal = data.totals[grandTotalIndex];
    const paidTotal = findTotal(/^(amount paid|paid|amount tendered|المبلغ المدفوع|المدفوع|المبلغ المستلم)(\s*\/|$)/i);
    const changeTotal = findTotal(/^(change due|الباقي)(\s*\/|$)/i);
    const balanceTotal = findTotal(/^(balance due|balance|الرصيد المستحق|الرصيد)(\s*\/|$)/i);
    const usedTotalSet = new Set(
      [subtotalTotal, discountTotal, taxTotal, grandTotal, paidTotal, changeTotal, balanceTotal].filter(Boolean)
    );
    const otherTotals = data.totals.filter((t) => !usedTotalSet.has(t));

    // Compute Total Qty from Qty column if present
    const qtyColIndex = data.columns.findIndex((col) => /^(qty|quantity|الكمية)(\s*\/|$)/i.test(col.trim()));
    const totalQty = qtyColIndex >= 0
      ? data.rows.reduce((sum, row) => {
          const parsed = Number.parseFloat(String(row.values[qtyColIndex] || '').replace(/[^0-9.-]/g, ''));
          return sum + (Number.isFinite(parsed) ? parsed : 0);
        }, 0)
      : 0;

    // Identify item name column and numeric columns for the clean 2-line retail item layout
    const itemColIndex = hasSerialColumn ? 1 : 0;
    const detailColIndices = data.columns
      .map((_, idx) => idx)
      .filter((idx) => idx !== itemColIndex && !(hasSerialColumn && idx === 0));
    const useTwoLineItems = !isKot && detailColIndices.length >= 2;

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
          paddingBottom: '4mm',
          background: '#ffffff',
          color: '#111111',
          fontFamily: MODERN_TEXT_FONT,
          fontSize: '10.5px',
          lineHeight: 1.35,
          overflowWrap: 'break-word',
        }}
      >
        {/* ── 1. HEADER: LOGO ON TOP + COMPANY DETAILS BELOW ──────────────── */}
        {!isKot && (
          <header
            style={{
              textAlign: 'center',
              paddingBottom: '7px',
            }}
          >
            {data.companyLogo && (
              <img
                src={data.companyLogo}
                alt=""
                style={{
                  display: 'block',
                  maxWidth: `${logoWidthMm}mm`,
                  maxHeight: `${logoHeightMm}mm`,
                  objectFit: 'contain',
                  margin: '0 auto 5px',
                }}
              />
            )}
            <div style={{ fontSize: '1.22em', fontWeight: 800, lineHeight: 1.2, textTransform: 'uppercase' }}>
              {data.companyName || 'aptPOS'}
            </div>
            {data.companyNameAr && (
              <div dir="rtl" style={{ fontSize: '1.08em', fontWeight: 700, marginTop: '1px', lineHeight: 1.2 }}>
                {data.companyNameAr}
              </div>
            )}
            {data.companyAddress && (
              <div style={{ fontSize: '0.88em', marginTop: '2px', lineHeight: 1.3 }}>
                {data.companyAddress}
              </div>
            )}
            {data.companyPhone && (
              <div style={{ fontSize: '0.88em', lineHeight: 1.3, fontFamily: MODERN_DIGIT_FONT }}>
                {lbl('Tel', 'هاتف')} : {data.companyPhone}
              </div>
            )}
            {data.companyTaxId && (
              <div style={{ fontSize: '0.86em', lineHeight: 1.3 }}>
                {lbl('VAT No', 'الرقم الضريبي')} :{' '}
                <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{data.companyTaxId}</span>
              </div>
            )}
            {data.companyCrNumber && (
              <div style={{ fontSize: '0.86em', lineHeight: 1.3 }}>
                {lbl('CR No', 'السجل التجاري')} :{' '}
                <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{data.companyCrNumber}</span>
              </div>
            )}
          </header>
        )}

        {/* ── 2. VOUCHER TITLE STRIP BETWEEN TWO THIN HORIZONTAL RULES ─────── */}
        <div
          style={{
            borderTop: rule,
            borderBottom: rule,
            padding: '4px 0',
            textAlign: 'center',
            marginBottom: '5px',
          }}
        >
          <div style={{ fontSize: isKot ? '1.3em' : '1.02em', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
            {titleParts.primary}
          </div>
          {titleParts.secondary && (
            <div dir="rtl" style={{ fontSize: '0.96em', fontWeight: 700, marginTop: '1px' }}>
              {titleParts.secondary}
            </div>
          )}
        </div>

        {/* ── 3. BILL NO / DATE / EXTRA METADATA ───────────────────────────── */}
        <section style={{ paddingBottom: '5px', borderBottom: rule, fontSize: '0.94em' }}>
          {data.number && (
            <div style={{ display: 'flex', gap: '4px', fontWeight: isKot ? 800 : 500, fontSize: isKot ? '1.35em' : '1em' }}>
              <span>{isKot ? lbl('Order No', 'رقم الطلب') : lbl('Bill No', 'رقم الفاتورة')} :</span>
              <span style={{ fontFamily: MODERN_DIGIT_FONT, fontWeight: 700 }}>{data.number}</span>
            </div>
          )}
          {data.date && (
            <div style={{ display: 'flex', gap: '4px', marginTop: '1px' }}>
              <span>{lbl('Date', 'التاريخ')} :</span>
              <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{data.date}</span>
            </div>
          )}
          {extraFields.map((field, idx) => (
            <div key={`${field.label}-${idx}`} style={{ display: 'flex', gap: '4px', marginTop: '1px' }}>
              <span><bdi dir="auto">{field.label}</bdi> :</span>
              <span style={{ fontWeight: 600 }}><bdi dir="auto">{field.value || '—'}</bdi></span>
            </div>
          ))}
        </section>

        {/* ── 3B. CUSTOMER DETAILS (ABOVE ITEM LIST) ───────────────────────── */}
        {(customerField || customerDetailFields.length > 0) && (
          <section style={{ padding: '4px 0', borderBottom: rule, fontSize: '0.92em' }}>
            {customerField && (
              <div>
                {lbl('Customer', 'العميل')} : <strong><bdi dir="auto">{customerField.value}</bdi></strong>
              </div>
            )}
            {customerDetailFields.map((field, idx) => (
              <div key={`${field.label}-${idx}`} style={{ marginTop: '1px', fontSize: '0.94em' }}>
                <bdi dir="auto">{field.label}</bdi> :{' '}
                <span style={{ fontWeight: 600 }}><bdi dir="auto">{field.value}</bdi></span>
              </div>
            ))}
          </section>
        )}

        {/* ── 4. ITEMS TABLE (CLEAN 2-LINE RETAIL FORMAT) ──────────────────── */}
        {data.columns.length > 0 && (
          useTwoLineItems ? (
            <section style={{ borderBottom: rule, paddingBottom: '4px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `minmax(0, 1.25fr) ${detailColIndices.map(() => 'minmax(0, 1fr)').join(' ')}`,
                  gap: '4px',
                  padding: '4px 0',
                  borderBottom: rule,
                  fontWeight: 700,
                  fontSize: '0.92em',
                }}
              >
                <span style={{ textAlign: 'start' }}>
                  <bdi dir="auto">{data.columns[itemColIndex]}</bdi>
                </span>
                {detailColIndices.map((colIdx) => (
                  <span key={colIdx} style={{ textAlign: 'end' }}>
                    <bdi dir="auto">{data.columns[colIdx]}</bdi>
                  </span>
                ))}
              </div>
              {data.rows.length === 0 ? (
                <div style={{ padding: '8px 0', textAlign: 'center' }}>—</div>
              ) : (
                data.rows.map((row, rowIndex) => {
                  const itemText = row.values[itemColIndex] ?? '';
                  return (
                    <div key={rowIndex} style={{ padding: '4px 0' }}>
                      <div style={{ fontWeight: 600, lineHeight: 1.28 }}>
                        {renderResponsiveProductCell(itemText, true, false, isMulti, isRtlOnly)}
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: `minmax(0, 1.25fr) ${detailColIndices.map(() => 'minmax(0, 1fr)').join(' ')}`,
                          gap: '4px',
                          marginTop: '2px',
                          fontFamily: MODERN_DIGIT_FONT,
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: '0.94em',
                        }}
                      >
                        <span />
                        {detailColIndices.map((colIdx, pos) => (
                          <span
                            key={colIdx}
                            style={{
                              textAlign: 'end',
                              whiteSpace: 'nowrap',
                              fontWeight: pos === detailColIndices.length - 1 ? 700 : 500,
                            }}
                          >
                            {row.values[colIdx] ?? ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          ) : (
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
                fontSize: isKot ? '13.5px' : '10px',
                borderBottom: rule,
              }}
            >
              <thead>
                <tr style={{ borderBottom: rule }}>
                  {data.columns.map((column, index) => (
                    <th
                      key={`${column}-${index}`}
                      style={{
                        padding: '4px 2px',
                        textAlign: index === data.columns.length - 1 ? 'end' : 'start',
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
                  <tr
                    key={rowIndex}
                    style={{
                      borderBottom:
                        rowIndex < data.rows.length - 1
                          ? '1px dashed #222222'
                          : 'none',
                    }}
                  >
                    {data.columns.map((_, colIdx) => (
                      <td
                        key={`${rowIndex}-${colIdx}`}
                        style={{
                          padding: isKot ? '6px 2px' : '4px 2px',
                          verticalAlign: 'top',
                          textAlign: colIdx === data.columns.length - 1 ? 'end' : 'start',
                          fontWeight: isKot && colIdx === 1 ? 800 : 500,
                          fontFamily: colIdx === data.columns.length - 1 ? MODERN_DIGIT_FONT : undefined,
                        }}
                      >
                        {colIdx === 0
                          ? renderResponsiveProductCell(row.values[colIdx] ?? '', true, false, isMulti, isRtlOnly)
                          : row.values[colIdx] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* ── 5. SUM & TOTAL AMOUNT BLOCK ──────────────────────────────────── */}
        {data.totals.length > 0 && (
          <>
            {grandTotal && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '4px 0',
                  borderBottom: rule,
                  fontWeight: 700,
                  fontSize: '0.98em',
                }}
              >
                <span>{lbl('SUM', 'المجموع')}</span>
                <span style={{ fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums' }}>
                  {grandTotal.value}
                </span>
              </div>
            )}

            <section style={{ padding: '4px 0', borderBottom: rule, fontSize: '0.92em' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                <span>
                  {totalQty > 0 ? (
                    <>
                      {lbl('Total Qty', 'إجمالي الكمية')} :{' '}
                      <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{totalQty.toFixed(2)}</span>
                    </>
                  ) : (
                    subtotalTotal ? `${subtotalTotal.label} : ${subtotalTotal.value}` : ''
                  )}
                </span>
                {discountTotal && (
                  <span style={{ textAlign: 'end', fontFamily: MODERN_DIGIT_FONT }}>
                    {lbl('Discount', 'الخصم')} : {discountTotal.value}
                  </span>
                )}
              </div>
              {grandTotal && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'baseline',
                    gap: '4px',
                    marginTop: '2px',
                    fontWeight: 800,
                    fontSize: '1.08em',
                  }}
                >
                  <span>{lbl('Total Amount', 'المبلغ الإجمالي')} :</span>
                  <span style={{ fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums' }}>
                    {grandTotal.value}
                  </span>
                </div>
              )}
              {otherTotals.map((t, idx) => (
                <div key={`${t.label}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1px' }}>
                  <span><bdi dir="auto">{t.label}</bdi></span>
                  <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{t.value}</span>
                </div>
              ))}
            </section>
          </>
        )}

        {/* ── 6. PAY MODE RECEIVED BLOCK ───────────────────────────────────── */}
        {(paymentField || paidTotal || changeTotal || balanceTotal) && (
          <section style={{ padding: '4px 0', borderBottom: rule, fontSize: '0.92em' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: '2px' }}>
              <span>{lbl('Pay Mode Received', 'طريقة الدفع المستلمة')}</span>
              <span>{lbl('Amount', 'المبلغ')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>{paymentField?.value || lbl('Cash', 'نقدي')}</span>
              <span style={{ fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums' }}>
                {paidTotal?.value || grandTotal?.value || '—'}
              </span>
            </div>
            {changeTotal && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1px', fontSize: '0.94em' }}>
                <span><bdi dir="auto">{changeTotal.label}</bdi></span>
                <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{changeTotal.value}</span>
              </div>
            )}
            {balanceTotal && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1px', fontWeight: 700, fontSize: '0.94em' }}>
                <span><bdi dir="auto">{balanceTotal.label}</bdi></span>
                <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{balanceTotal.value}</span>
              </div>
            )}
          </section>
        )}

        {/* ── 7. TAX DETAILS SUMMARY TABLE ─────────────────────────────────── */}
        {subtotalTotal && taxTotal && grandTotal && (
          <section style={{ padding: '5px 0', borderBottom: rule, fontSize: '0.9em' }}>
            <div style={{ fontWeight: 700, marginBottom: '3px' }}>
              {lbl('Tax Details', 'تفاصيل الضريبة')} :
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.1fr 1fr 1fr 1fr',
                gap: '4px',
                fontWeight: 700,
                paddingBottom: '2px',
              }}
            >
              <span>{lbl('Tax Name', 'الضريبة')}</span>
              <span style={{ textAlign: 'end' }}>{lbl('Taxable Amt', 'الخاضع')}</span>
              <span style={{ textAlign: 'end' }}>{lbl('Tax Amt', 'الضريبة')}</span>
              <span style={{ textAlign: 'end' }}>{lbl('Total Amt', 'الإجمالي')}</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.1fr 1fr 1fr 1fr',
                gap: '4px',
                padding: '2px 0',
                fontFamily: MODERN_DIGIT_FONT,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span style={{ fontFamily: MODERN_TEXT_FONT }}>{lbl('VAT', 'ق.م')}</span>
              <span style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>{subtotalTotal.value}</span>
              <span style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>{taxTotal.value}</span>
              <span style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>{grandTotal.value}</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.1fr 1fr 1fr 1fr',
                gap: '4px',
                marginTop: '3px',
                paddingTop: '3px',
                borderTop: rule,
                fontWeight: 800,
                fontFamily: MODERN_DIGIT_FONT,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span style={{ fontFamily: MODERN_TEXT_FONT }}>{lbl('Total', 'الإجمالي')}</span>
              <span style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>{subtotalTotal.value}</span>
              <span style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>{taxTotal.value}</span>
              <span style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>{grandTotal.value}</span>
            </div>
          </section>
        )}

        {/* ── 8. ZATCA QR CODE ─────────────────────────────────────────────── */}
        {data.qrDataUrl && (
          <div style={{ padding: '8px 0', textAlign: 'center', borderBottom: rule, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <img
              src={data.qrDataUrl}
              alt="ZATCA e-Invoice QR Code"
              style={{ display: 'inline-block', width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm` }}
            />
          </div>
        )}

        {/* ── 10. BOTTOM CASHIER & FOOTER STRIP ────────────────────────────── */}
        {cashierField && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingTop: '4px',
              fontSize: '0.9em',
            }}
          >
            <span>
              {lbl('Cashier', 'الكاشير')} : <bdi dir="auto">{cashierField.value}</bdi>
            </span>
          </div>
        )}

        {data.footer && (
          <footer
            style={{
              marginTop: '6px',
              paddingTop: '5px',
              borderTop: rule,
              textAlign: 'center',
              fontSize: '0.86em',
              fontWeight: 600,
              whiteSpace: 'pre-line',
            }}
          >
            {data.footer}
          </footer>
        )}
      </article>
    );
  }

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
        background: '#ffffff',
        color: isThermal ? '#000000' : '#0f172a',
        fontFamily: MODERN_TEXT_FONT,
        fontSize: baseFontSize,
        lineHeight: isCompact ? 1.25 : 1.35,
        overflowWrap: 'break-word',
      }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      {isModern80mm ? (
        <header
          style={{
            textAlign: 'center',
            paddingBottom: '6px',
            marginBottom: '7px',
          }}
        >
          {data.companyLogo && (
            <img
              src={data.companyLogo}
              alt=""
              style={{
                display: 'block',
                maxWidth: `${logoWidthMm}mm`,
                maxHeight: `${logoHeightMm}mm`,
                objectFit: 'contain',
                margin: '0 auto 6px',
                filter: 'grayscale(1) contrast(1.25)',
              }}
            />
          )}
          {!isKot && (
            <div style={{ fontSize: '1.42em', fontWeight: 800, letterSpacing: '0.015em', lineHeight: 1.2 }}>
              {data.companyName || 'aptPOS'}
            </div>
          )}
          {!isKot && data.companyNameAr && (
            <div dir="rtl" style={{ fontSize: '1.18em', fontWeight: 700, marginTop: '2px', lineHeight: 1.2 }}>
              {data.companyNameAr}
            </div>
          )}
          {!isKot && (data.companyAddress || data.companyPhone) && (
            <div style={{ marginTop: '3px', fontSize: '0.86em', lineHeight: 1.35, fontWeight: 500 }}>
              {[data.companyAddress, data.companyPhone].filter(Boolean).join(' · ')}
            </div>
          )}
          {!isKot && (data.companyTaxId || data.companyCrNumber) && (
            <div style={{ marginTop: '2px', fontSize: '0.84em', fontWeight: 600, display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '4px 10px' }}>
              {data.companyTaxId && (
                <span>
                  {data.multiLanguage ? 'VAT / الرقم الضريبي' : data.direction === 'rtl' ? 'الرقم الضريبي' : 'VAT'}:{' '}
                  <span style={{ fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums' }}>{data.companyTaxId}</span>
                </span>
              )}
              {data.companyCrNumber && (
                <span>
                  {data.multiLanguage ? 'CR / السجل' : data.direction === 'rtl' ? 'السجل' : 'CR'}:{' '}
                  <span style={{ fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums' }}>{data.companyCrNumber}</span>
                </span>
              )}
            </div>
          )}

          {/* Modern Inverted Full-Width Voucher Title Banner */}
          <div
            style={{
              margin: '8px 0 6px',
              padding: isKot ? '6px 8px' : '5px 8px',
              background: '#000000',
              color: '#ffffff',
              borderRadius: '4px',
              width: '100%',
            }}
          >
            <div style={{ fontSize: isKot ? '1.35em' : '1.05em', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {titleParts.primary}
            </div>
            {titleParts.secondary && (
              <div dir="rtl" style={{ fontSize: isKot ? '1.1em' : '0.96em', fontWeight: 700, marginTop: '1px' }}>
                {titleParts.secondary}
              </div>
            )}
          </div>

          {/* Voucher Number & Date Strip */}
          {isKot ? (
            <>
              {data.number && (
                <div
                  style={{
                    fontWeight: 900,
                    fontSize: '2em',
                    fontFamily: MODERN_DIGIT_FONT,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '0.03em',
                    padding: '4px 0 2px',
                    borderBottom: '1.5px solid #000000',
                  }}
                >
                  {data.number}
                </div>
              )}
              {data.date && (
                <div style={{ fontSize: '0.88em', fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums', marginTop: '3px', fontWeight: 600 }}>
                  {data.date}
                </div>
              )}
            </>
          ) : (data.number || data.date) && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '8px',
                padding: '4px 7px',
                border: '1.5px solid #000000',
                borderRadius: '4px',
                fontFamily: MODERN_DIGIT_FONT,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span style={{ fontWeight: 800, fontSize: '1em' }}>
                {data.number || '—'}
              </span>
              {data.date && (
                <span style={{ fontWeight: 600, fontSize: '0.86em', textAlign: 'end' }}>
                  {data.date}
                </span>
              )}
            </div>
          )}
        </header>
      ) : isThermal ? (
        <header
          style={{
            textAlign: 'center',
            paddingBottom: isCompact ? '5px' : '8px',
            marginBottom: isCompact ? '5px' : '8px',
            borderBottom: divider,
          }}
        >
          {data.companyLogo && (
            <img
              src={data.companyLogo}
              alt=""
              style={{
                display: 'block',
                maxWidth: `${logoWidthMm}mm`,
                maxHeight: `${logoHeightMm}mm`,
                objectFit: 'contain',
                margin: '0 auto 5px',
                filter: 'grayscale(1) contrast(1.25)',
              }}
            />
          )}
          {!isKot && (
            <div style={{ fontSize: isCompact ? '1.2em' : '1.35em', fontWeight: 800, letterSpacing: '0.01em' }}>
              {data.companyName || 'aptPOS'}
            </div>
          )}
          {!isKot && data.companyNameAr && (
            <div dir="rtl" style={{ fontSize: isCompact ? '1.08em' : '1.18em', fontWeight: 700, marginTop: '1px' }}>
              {data.companyNameAr}
            </div>
          )}
          {!isKot && (data.companyAddress || data.companyPhone) && (
            <div style={{ marginTop: '3px', fontSize: '0.88em', lineHeight: 1.3 }}>
              {[data.companyAddress, data.companyPhone].filter(Boolean).join(' · ')}
            </div>
          )}
          {!isKot && data.companyTaxId && (
            <div style={{ marginTop: '2px', fontSize: '0.88em', fontWeight: 600 }}>
              {data.multiLanguage ? 'VAT / الرقم الضريبي' : data.direction === 'rtl' ? 'الرقم الضريبي' : 'VAT'}:{' '}
              <span style={{ fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums' }}>{data.companyTaxId}</span>
            </div>
          )}

          {/* Framed Document Title Badge */}
          <div
            style={{
              margin: isCompact ? '5px auto 4px' : '7px auto 5px',
              padding: isCompact ? '2px 6px' : '4px 8px',
              border: isKot ? '2px solid #000000' : '1.5px solid #000000',
              borderRadius: '3px',
              display: 'inline-block',
              maxWidth: '100%',
            }}
          >
            <div style={{ fontSize: isKot ? '1.45em' : '1.05em', fontWeight: 800, letterSpacing: '0.03em' }}>
              {titleParts.primary}
            </div>
            {titleParts.secondary && (
              <div dir="rtl" style={{ fontSize: '0.98em', fontWeight: 700, marginTop: '1px' }}>
                {titleParts.secondary}
              </div>
            )}
          </div>

          {data.number && (
            <div
              style={{
                fontWeight: isKot ? 900 : 800,
                fontSize: isKot ? '1.85em' : '1.05em',
                fontFamily: MODERN_DIGIT_FONT,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.02em',
              }}
            >
              {data.number}
            </div>
          )}
          {data.date && (
            <div style={{ fontSize: '0.88em', fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums', marginTop: '1px' }}>
              {data.date}
            </div>
          )}
        </header>
      ) : (
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '18px',
            borderBottom: strongDivider,
            paddingBottom: isCompact ? '8px' : '12px',
            marginBottom: isCompact ? '10px' : '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
            {data.companyLogo && (
              <img
                src={data.companyLogo}
                alt=""
                style={{
                  display: 'block',
                  maxWidth: `${logoWidthMm}mm`,
                  maxHeight: `${logoHeightMm}mm`,
                  objectFit: 'contain',
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              {!isKot && (
                <div style={{ color: palette.accent, fontSize: '1.5em', fontWeight: 800, lineHeight: 1.2 }}>
                  {data.companyName || 'aptPOS'}
                </div>
              )}
              {!isKot && data.companyNameAr && (
                <div dir="rtl" style={{ fontSize: '1.12em', fontWeight: 700, color: '#1e293b', marginTop: '2px' }}>
                  {data.companyNameAr}
                </div>
              )}
              {!isKot && (data.companyAddress || data.companyPhone) && (
                <div style={{ color: palette.muted, marginTop: '4px', fontSize: '0.88em' }}>
                  {[data.companyAddress, data.companyPhone].filter(Boolean).join(' · ')}
                </div>
              )}
              {!isKot && (data.companyTaxId || data.companyCrNumber) && (
                <div style={{ color: palette.muted, marginTop: '2px', fontSize: '0.88em', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {data.companyTaxId && (
                    <span>
                      <strong>{data.multiLanguage ? 'VAT / الرقم الضريبي:' : 'VAT:'}</strong>{' '}
                      <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{data.companyTaxId}</span>
                    </span>
                  )}
                  {data.companyCrNumber && (
                    <span>
                      <strong>{data.multiLanguage ? 'CR / السجل:' : 'CR:'}</strong>{' '}
                      <span style={{ fontFamily: MODERN_DIGIT_FONT }}>{data.companyCrNumber}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ textAlign: data.direction === 'rtl' ? 'left' : 'right', flexShrink: 0 }}>
            <div
              style={{
                display: 'inline-block',
                background: isCompact ? '#ffffff' : palette.accent,
                color: isCompact ? palette.accent : '#ffffff',
                border: isCompact ? `1.5px solid ${palette.accent}` : 'none',
                borderRadius: '6px',
                padding: isCompact ? '4px 10px' : '6px 12px',
              }}
            >
              <div style={{ fontSize: '1.15em', fontWeight: 800, letterSpacing: '0.02em' }}>
                {titleParts.primary}
              </div>
              {titleParts.secondary && (
                <div dir="rtl" style={{ fontSize: '0.95em', fontWeight: 700, opacity: 0.92, marginTop: '1px' }}>
                  {titleParts.secondary}
                </div>
              )}
            </div>
            {data.number && (
              <div style={{ marginTop: '6px', fontSize: '1.08em', fontWeight: 800, fontFamily: MODERN_DIGIT_FONT, color: palette.accent }}>
                {data.number}
              </div>
            )}
            {data.date && (
              <div style={{ marginTop: '2px', fontSize: '0.88em', fontFamily: MODERN_DIGIT_FONT, color: palette.muted }}>
                {data.date}
              </div>
            )}
          </div>
        </header>
      )}

      {/* ── METADATA FIELDS ─────────────────────────────────────────────────── */}
      {data.fields.length > 0 && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: isThermal ? '1fr' : 'repeat(2, minmax(0, 1fr))',
            gap: isModern80mm ? '0' : isThermal ? '2.5px 8px' : '6px 18px',
            padding: isModern80mm
              ? '3px 7px'
              : isThermal
                ? `0 0 ${isCompact ? '5px' : '7px'} 0`
                : (isCompact ? '6px 8px' : '10px 12px'),
            marginBottom: isModern80mm ? '8px' : isCompact ? '6px' : '10px',
            background: isThermal ? 'transparent' : palette.subtleBg,
            border: isModern80mm
              ? '1px solid #000000'
              : isThermal
                ? 'none'
                : `1px solid ${palette.borderLight}`,
            borderBottom: isModern80mm
              ? '1px solid #000000'
              : isThermal
                ? divider
                : `1px solid ${palette.borderLight}`,
            borderRadius: isModern80mm ? '4px' : isThermal ? 0 : '6px',
          }}
        >
          {data.fields.map((field, index) => (
            <div
              key={`${field.label}-${index}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '8px',
                ...(isModern80mm
                  ? {
                      padding: '2.5px 0',
                      borderBottom: index < data.fields.length - 1 ? '1px dotted #000000' : 'none',
                    }
                  : {}),
              }}
            >
              <span style={{ color: palette.muted, fontSize: isModern80mm ? '0.88em' : '0.92em', fontWeight: isModern80mm ? 600 : 400, flexShrink: 0 }}>
                <bdi dir="auto">{field.label}</bdi>
              </span>
              <strong style={{ textAlign: 'end', fontWeight: 700, fontSize: isModern80mm ? '0.92em' : '1em', wordBreak: 'break-word' }}>
                <bdi dir="auto">{field.value || '—'}</bdi>
              </strong>
            </div>
          ))}
        </section>
      )}

      {/* ── ITEMS TABLE ─────────────────────────────────────────────────────── */}
      {data.columns.length > 0 && (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
            fontSize: tableFontSize,
          }}
        >
          <thead>
            <tr
              style={{
                background: isThermal ? '#ffffff' : (isCompact ? '#f8fafc' : '#f1f5f9'),
                color: palette.accent,
                borderTop: isModern80mm ? '2px solid #000000' : isThermal ? '1px solid #000000' : `1px solid ${palette.border}`,
                borderBottom: isModern80mm ? '2px solid #000000' : isThermal ? '1.5px solid #000000' : `1.5px solid ${palette.accent}`,
              }}
            >
              {data.columns.map((column, index) => {
                const isNumeric = data.numericColumns?.includes(index);
                const colWidth = getColumnWidth(index, data.columns.length, isKot, hasSerialColumn, format);
                return (
                  <th
                    key={`${column}-${index}`}
                    style={{
                      width: colWidth,
                      padding: isCompact ? '3px 2px' : (isThermal ? '4px 2px' : '7px 6px'),
                      textAlign: isKot && index === 1 ? 'end' : isNumeric ? 'end' : index === 0 && hasSerialColumn ? 'center' : 'start',
                      fontWeight: 800,
                      verticalAlign: 'bottom',
                      wordBreak: 'break-word',
                    }}
                  >
                    <bdi dir="auto">{column}</bdi>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => {
              const productColIndex = hasSerialColumn ? 1 : (isKot ? 0 : -1);
              const rawProductCell = productColIndex >= 0 ? (row.values[productColIndex] ?? '') : '';
              const extracted = !isThermal && !isCompact && productColIndex >= 0
                ? extractProductSubContents(rawProductCell)
                : null;
              const hasFullWidthDetails = Boolean(
                extracted && (extracted.detailItems.length > 0 || extracted.noteLines.length > 0)
              );
              const rowBg = !isThermal && !isCompact && rowIndex % 2 === 1 ? '#f8fafc' : '#ffffff';
              const isMultiLang = Boolean(data.multiLanguage);
              const isRtlOnly = data.direction === 'rtl' && !data.multiLanguage;

              return (
                <React.Fragment key={rowIndex}>
                  <tr
                    style={{
                      background: rowBg,
                      borderBottom: hasFullWidthDetails
                        ? 'none'
                        : isThermal
                          ? '1px dotted #000000'
                          : `1px solid ${palette.borderLight}`,
                      fontWeight: row.emphasis ? 700 : 400,
                      ...(hasFullWidthDetails
                        ? { breakAfter: 'avoid', pageBreakAfter: 'avoid' }
                        : {}),
                    }}
                  >
                    {data.columns.map((_, columnIndex) => {
                      const isNumeric = data.numericColumns?.includes(columnIndex);
                      const isProductCol = columnIndex === productColIndex;
                      const rawCell = row.values[columnIndex] ?? '';
                      return (
                        <td
                          key={`${rowIndex}-${columnIndex}`}
                          style={{
                            padding: isCompact
                              ? '3px 2px'
                              : isThermal
                                ? '4px 2px'
                                : hasFullWidthDetails
                                  ? '7px 6px 4px 6px'
                                  : '7px 6px',
                            verticalAlign: 'top',
                            textAlign: isNumeric ? 'end' : (columnIndex === 0 && hasSerialColumn ? 'center' : 'start'),
                            ...(isNumeric
                              ? {
                                  fontFamily: MODERN_DIGIT_FONT,
                                  fontVariantNumeric: 'tabular-nums',
                                  whiteSpace: 'nowrap' as const,
                                  fontWeight: columnIndex === data.columns.length - 1 ? 700 : 500,
                                }
                              : {}),
                            ...(isKot && columnIndex === 1
                              ? { fontWeight: 900, fontSize: '1.15em', fontFamily: MODERN_DIGIT_FONT }
                              : {}),
                            overflowWrap: isNumeric ? 'normal' : 'break-word',
                          }}
                        >
                          {isProductCol
                            ? hasFullWidthDetails && extracted
                              ? renderBilingualText(extracted.primaryLine, isMultiLang, isRtlOnly, {
                                  fontWeight: 700,
                                  fontSize: '1em',
                                  lineHeight: 1.3,
                                  color: '#0f172a',
                                })
                              : renderResponsiveProductCell(
                                  rawCell,
                                  isThermal,
                                  isCompact,
                                  isMultiLang,
                                  isRtlOnly
                                )
                            : <bdi dir="auto">{rawCell}</bdi>}
                        </td>
                      );
                    })}
                  </tr>
                  {hasFullWidthDetails && extracted && (
                    <tr
                      style={{
                        background: rowBg,
                        borderBottom: `1px solid ${palette.borderLight}`,
                      }}
                    >
                      <td
                        colSpan={data.columns.length}
                        style={{ padding: '0 6px 8px 6px', width: '100%' }}
                      >
                        {renderFullWidthSubContents(
                          extracted.detailItems,
                          extracted.noteLines,
                          isMultiLang,
                          isRtlOnly
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, data.columns.length)} style={{ padding: '10px 4px', textAlign: 'center', color: palette.muted }}>
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* ── TOTALS & QR SECTION ─────────────────────────────────────────────── */}
      {isModern80mm ? (
        <>
          {data.totals.length > 0 && (
            <section
              style={{
                marginTop: '8px',
                border: '1.5px solid #000000',
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              {data.totals.map((total, index) => {
                const isGrandTotal = index === grandTotalIndex;
                return (
                  <div
                    key={`${total.label}-${index}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: '8px',
                      padding: isGrandTotal ? '6px 8px' : '3.5px 8px',
                      background: isGrandTotal ? '#000000' : '#ffffff',
                      color: isGrandTotal ? '#ffffff' : '#000000',
                      borderTop: index > 0 && !isGrandTotal ? '1px dotted #000000' : undefined,
                      fontWeight: isGrandTotal ? 800 : 600,
                      fontSize: isGrandTotal ? '1.2em' : '0.94em',
                    }}
                  >
                    <span><bdi dir="auto">{total.label}</bdi></span>
                    <span style={{ textAlign: 'end', fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      <bdi dir="auto">{total.value}</bdi>
                    </span>
                  </div>
                );
              })}
            </section>
          )}

          {data.qrDataUrl && (
            <div style={{ marginTop: '10px', textAlign: 'center', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <div style={{ display: 'inline-block', border: '1px solid #000000', borderRadius: '4px', padding: '5px' }}>
                <img
                  src={data.qrDataUrl}
                  alt="ZATCA e-Invoice QR Code"
                  style={{ display: 'block', width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm`, margin: '0 auto' }}
                />
                <div style={{ marginTop: '3px', fontSize: '0.76em', fontWeight: 700, letterSpacing: '0.02em' }}>
                  {data.multiLanguage ? 'ZATCA e-Invoice · الفاتورة الإلكترونية' : data.direction === 'rtl' ? 'الفاتورة الإلكترونية' : 'ZATCA e-Invoice'}
                </div>
              </div>
            </div>
          )}
        </>
      ) : isThermal ? (
        <>
          {data.totals.length > 0 && (
            <section style={{ marginTop: isCompact ? '5px' : '7px', paddingTop: '4px', borderTop: divider }}>
              {data.totals.map((total, index) => {
                const isGrandTotal = index === data.totals.length - 1;
                return (
                  <div
                    key={`${total.label}-${index}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: '8px',
                      padding: isGrandTotal ? (isCompact ? '4px 0' : '5px 0') : '2px 0',
                      marginTop: isGrandTotal ? '3px' : 0,
                      borderTop: isGrandTotal ? '1.5px solid #000000' : undefined,
                      borderBottom: isGrandTotal ? '1.5px solid #000000' : undefined,
                      fontWeight: isGrandTotal ? 800 : 600,
                      fontSize: isGrandTotal ? '1.18em' : '0.96em',
                    }}
                  >
                    <span><bdi dir="auto">{total.label}</bdi></span>
                    <span style={{ textAlign: 'end', fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      <bdi dir="auto">{total.value}</bdi>
                    </span>
                  </div>
                );
              })}
            </section>
          )}

          {data.qrDataUrl && (
            <div style={{ marginTop: isCompact ? '7px' : '10px', textAlign: 'center', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <img
                src={data.qrDataUrl}
                alt="ZATCA e-Invoice QR Code"
                style={{ display: 'inline-block', width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm` }}
              />
            </div>
          )}
        </>
      ) : (
        (data.totals.length > 0 || data.qrDataUrl) && (
          <section
            style={{
              marginTop: '14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '20px',
              breakInside: 'avoid',
              pageBreakInside: 'avoid',
            }}
          >
            <div>
              {data.qrDataUrl && (
                <div style={{ border: `1px solid ${palette.borderLight}`, borderRadius: '8px', padding: '8px', display: 'inline-block', textAlign: 'center' }}>
                  <img
                    src={data.qrDataUrl}
                    alt="ZATCA e-Invoice QR Code"
                    style={{ display: 'block', width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm`, margin: '0 auto' }}
                  />
                  <div style={{ marginTop: '4px', fontSize: '0.78em', color: palette.muted, fontWeight: 600 }}>
                    {data.multiLanguage ? 'ZATCA e-Invoice · الفاتورة الإلكترونية' : 'ZATCA e-Invoice'}
                  </div>
                </div>
              )}
            </div>

            {data.totals.length > 0 && (
              <div
                style={{
                  minWidth: '240px',
                  width: '44%',
                  border: `1px solid ${palette.border}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                {data.totals.map((total, index) => {
                  const isGrandTotal = index === data.totals.length - 1;
                  return (
                    <div
                      key={`${total.label}-${index}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: '12px',
                        padding: isGrandTotal ? '8px 12px' : '5px 12px',
                        background: isGrandTotal ? (isCompact ? '#f1f5f9' : palette.accent) : '#ffffff',
                        color: isGrandTotal ? (isCompact ? palette.accent : '#ffffff') : '#0f172a',
                        borderTop: index > 0 ? `1px solid ${palette.borderLight}` : undefined,
                        fontWeight: isGrandTotal ? 800 : 600,
                        fontSize: isGrandTotal ? '1.12em' : '0.94em',
                      }}
                    >
                      <span><bdi dir="auto">{total.label}</bdi></span>
                      <span style={{ fontFamily: MODERN_DIGIT_FONT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        <bdi dir="auto">{total.value}</bdi>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )
      )}

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      {data.footer && (
        <footer
          style={{
            marginTop: isCompact ? '7px' : '12px',
            paddingTop: '6px',
            borderTop: divider,
            textAlign: 'center',
            color: palette.muted,
            fontSize: '0.88em',
            fontWeight: 600,
            whiteSpace: 'pre-line',
          }}
        >
          {data.footer}
        </footer>
      )}
    </article>
  );
};
