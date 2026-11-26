import React from 'react';
import type { PrintDocumentData } from './types';

/** Props for the aptFlyERP dedicated A4 invoice layout. */
interface FlyErpInvoiceTemplateProps {
  data: PrintDocumentData;
}

const screenTextFont =
  '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const screenDigitFont =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

/** Brand colours for the travel-agency invoice. */
const BRAND = {
  primary: '#1e3a8a',       // deep blue
  primaryLight: '#dbeafe',  // blue-100
  accent: '#0b4a6f',        // darker blue for totals row
  muted: '#475569',         // slate-600
  border: '#cbd5e1',        // slate-300
  borderStrong: '#94a3b8',  // slate-400
  bg: '#f8fafc',            // slate-50
  white: '#ffffff',
  text: '#0f172a',          // slate-900
  subtext: '#64748b',       // slate-500
};

/** Thin horizontal rule used between sections. */
const Hr: React.FC<{ color?: string; mt?: number; mb?: number }> = ({
  color = BRAND.border,
  mt = 0,
  mb = 0,
}) => (
  <div
    style={{
      height: '1px',
      background: color,
      margin: `${mt}px 0 ${mb}px`,
    }}
  />
);

/** Two-column info grid cell (label + value). */
const InfoCell: React.FC<{
  label: string;
  value: string;
  dir?: 'ltr' | 'rtl';
  compact?: boolean;
}> = ({
  label,
  value,
  dir = 'ltr',
  compact = false,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
    <span
      style={{
        fontSize: compact ? '7px' : '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: BRAND.subtext,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
    <span
      dir={dir}
      style={{
        fontSize: compact ? '8px' : '10px',
        fontWeight: 700,
        color: BRAND.text,
        wordBreak: 'break-word',
      }}
    >
      {value || '—'}
    </span>
  </div>
);

export const FlyErpInvoiceTemplate: React.FC<FlyErpInvoiceTemplateProps> = ({ data }) => {
  const isRtl = data.direction === 'rtl';
  const isMulti = data.multiLanguage;
  const textDir = isMulti ? 'ltr' : data.direction || 'ltr';
  const paymentFields = [
    ...data.fields.filter((field) =>
      /payment/i.test(field.label) || field.label.includes('طريقة الدفع') || field.label.includes('حالة الدفع')
    ),
    ...(data.pendingBalance
      ? [{
          label: isMulti
            ? 'Customer Balance / رصيد العميل'
            : isRtl
              ? 'رصيد العميل'
              : 'Customer Balance',
          value: data.pendingBalance,
        }]
      : []),
  ];
  const infoFields = data.fields.filter((field) => !paymentFields.includes(field));
  const serviceColumns = data.columns.map((label, index) => ({ label, index }));
  const serviceNumberColumnIndex = 0;
  const serviceNameColumnIndex = serviceColumns.find(({ label }) =>
    /service|الخدمة/i.test(label)
  )?.index ?? 1;
  const amountColumnIndex = [...serviceColumns].reverse().find(({ label }) =>
    /amount|المبلغ/i.test(label)
  )?.index ?? -1;
  const cardDetailColumns = serviceColumns.filter(({ index }) =>
    index !== serviceNumberColumnIndex &&
    index !== serviceNameColumnIndex &&
    index !== amountColumnIndex
  );
  const businessDetails = [
    { englishLabel: 'Address', arabicLabel: 'العنوان', value: data.companyAddress },
    { englishLabel: 'Building No.', arabicLabel: 'رقم المبنى', value: data.companyBuildingNo },
    { englishLabel: 'Street', arabicLabel: 'الشارع', value: data.companyStreetName },
    { englishLabel: 'District', arabicLabel: 'الحي', value: data.companyDistrict },
    { englishLabel: 'City', arabicLabel: 'المدينة', value: data.companyCity },
    { englishLabel: 'Postal Code', arabicLabel: 'الرمز البريدي', value: data.companyPostalCode },
    { englishLabel: 'Country', arabicLabel: 'الدولة', value: data.companyCountry },
    { englishLabel: 'Phone', arabicLabel: 'الهاتف', value: data.companyPhone },
    { englishLabel: 'VAT No.', arabicLabel: 'الرقم الضريبي', value: data.companyTaxId },
    { englishLabel: 'CR No.', arabicLabel: 'السجل التجاري', value: data.companyCrNumber },
  ].flatMap(({ value, ...detail }) => {
    const normalizedValue = value?.trim();
    return normalizedValue ? [{ ...detail, value: normalizedValue }] : [];
  });
  const renderServiceCards = () =>
    data.rows.map((row, rowIndex) => {
        const serviceNumber = row.values[serviceNumberColumnIndex] || String(rowIndex + 1);
        const serviceName = row.values[serviceNameColumnIndex] || '';
        const amount = amountColumnIndex >= 0 ? row.values[amountColumnIndex] || '' : '';
        const details = cardDetailColumns
          .map(({ label, index }) => ({ label, value: row.values[index] || '' }))
          .filter(({ value }) => value.trim());
        return (
          <tr key={`service-row-${rowIndex}`}>
            <td style={{ padding: 0 }}>
              <article
                style={{
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                  breakInside: 'avoid',
                  pageBreakInside: 'avoid',
                }}
              >
                <header
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px 14px',
                padding: '8px 10px',
                background: BRAND.primaryLight,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr)',
                  gridTemplateRows: 'auto auto',
                  alignItems: 'baseline',
                  columnGap: '8px',
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    gridColumn: '2',
                    gridRow: '1',
                    fontSize: '7px',
                    fontWeight: 700,
                    color: BRAND.subtext,
                  }}
                >
                  <bdi dir="auto">{serviceColumns[serviceNameColumnIndex]?.label || 'Service'}</bdi>
                </div>
                <span
                  style={{
                    gridColumn: '1',
                    gridRow: '2',
                    color: BRAND.muted,
                    fontFamily: screenDigitFont,
                    fontSize: '9px',
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  <bdi dir="auto">{serviceNumber}</bdi>
                </span>
                <strong
                  style={{
                    gridColumn: '2',
                    gridRow: '2',
                    display: 'block',
                    minWidth: 0,
                    color: BRAND.primary,
                    fontSize: '10px',
                    whiteSpace: 'pre-line',
                    overflowWrap: 'anywhere',
                  }}
                >
                  <bdi dir="auto">{serviceName || '—'}</bdi>
                </strong>
              </div>
              {amountColumnIndex >= 0 && (
                <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                  <div style={{ fontSize: '7px', fontWeight: 700, color: BRAND.subtext }}>
                    <bdi dir="auto">{serviceColumns[amountColumnIndex]?.label}</bdi>
                  </div>
                  <strong style={{ fontFamily: screenDigitFont, fontSize: '10px', color: BRAND.text }}>
                    <bdi dir="auto">{amount}</bdi>
                  </strong>
                </div>
              )}
                </header>
                {details.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))',
                      gap: '6px',
                      padding: '8px 10px',
                    }}
                  >
                    {details.map(({ label, value }, detailIndex) => (
                      <div
                        key={`service-detail-${rowIndex}-${detailIndex}`}
                        style={{
                          minWidth: 0,
                          border: `1px solid ${BRAND.border}`,
                          borderRadius: '6px',
                          padding: '5px 7px',
                          background: BRAND.white,
                        }}
                      >
                        <div style={{ fontSize: '7px', color: BRAND.subtext, fontWeight: 700 }}>
                          <bdi dir="auto">{label}</bdi>
                        </div>
                        <div
                          style={{
                            marginTop: '2px',
                            color: BRAND.text,
                            fontSize: '8px',
                            fontWeight: 600,
                            overflowWrap: 'anywhere',
                            whiteSpace: 'pre-line',
                          }}
                        >
                          <bdi dir="auto">{value}</bdi>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </td>
          </tr>
        );
    });

  return (
    <article
      data-print-document
      dir={textDir}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
        margin: '0 auto',
        padding: 0,
        background: BRAND.white,
        color: BRAND.text,
        fontFamily: screenTextFont,
        fontSize: '11px',
        lineHeight: 1.4,
        overflowWrap: 'anywhere',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: '0 8px',
          tableLayout: 'fixed',
        }}
      >
        <thead>
          <tr>
            <td style={{ padding: 0 }}>
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header
        style={{
          display: 'block',
          position: 'relative',
          paddingBottom: '10px',
          borderBottom: `3px solid ${BRAND.primary}`,
          marginBottom: '14px',
        }}
      >
        <div
          style={{
            display: 'grid',
            position: 'relative',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            alignItems: 'center',
            gap: '18px',
            paddingTop: data.companyLogo ? '12px' : undefined,
            minHeight: data.companyLogo ? '112px' : undefined,
          }}
        >
          <div dir="ltr" style={{ minWidth: 0, position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 800, color: BRAND.primary, lineHeight: 1.2 }}>
              <bdi dir="ltr">{data.companyName || 'aptFlyERP'}</bdi>
            </div>
            {businessDetails.map((detail) => (
              <div key={detail.englishLabel} style={{ fontSize: '9px', color: BRAND.subtext }}>
                {detail.englishLabel}:{' '}
                <bdi dir="auto" style={{ fontFamily: detail.englishLabel.endsWith('No.') ? screenDigitFont : undefined }}>
                  {detail.value}
                </bdi>
              </div>
            ))}
          </div>

          {data.companyLogo && (
            <img
              src={data.companyLogo}
              alt=""
              style={{
                display: 'block',
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: '104px',
                height: '104px',
                objectFit: 'contain',
                borderRadius: '6px',
                transform: 'translate(-50%, -50%)',
                zIndex: 0,
                pointerEvents: 'none',
              }}
            />
          )}

          <div dir="rtl" style={{ minWidth: 0, textAlign: 'right', position: 'relative', zIndex: 1 }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 800,
                color: BRAND.primary,
                lineHeight: 1.2,
              }}
            >
              <bdi dir="rtl">{data.companyNameAr || data.companyName || 'aptFlyERP'}</bdi>
            </div>
            {businessDetails.map((detail) => (
              <div key={detail.arabicLabel} style={{ fontSize: '9px', color: BRAND.subtext }}>
                {detail.arabicLabel}:{' '}
                <bdi dir="auto" style={{ fontFamily: detail.englishLabel.endsWith('No.') ? screenDigitFont : undefined }}>
                  {detail.value}
                </bdi>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '12px', marginTop: '10px' }}>
          <div
            dir="ltr"
            style={{
              textAlign: 'left',
              background: BRAND.primaryLight,
              borderRadius: '8px',
              padding: '8px 12px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 800,
                color: BRAND.primary,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <bdi dir="auto">{data.title}</bdi>
            </div>
            {data.number && (
              <div
                style={{
                  fontFamily: screenDigitFont,
                  fontSize: '11px',
                  fontWeight: 700,
                  color: BRAND.accent,
                  marginTop: '3px',
                }}
              >
                {data.number}
              </div>
            )}
            {data.date && (
              <div
                style={{
                  fontFamily: screenDigitFont,
                  fontSize: '9px',
                  color: BRAND.muted,
                  marginTop: '2px',
                }}
              >
                {data.date}
              </div>
            )}
          </div>
          {paymentFields.length > 0 && (
            <div
              dir={isRtl ? 'rtl' : 'ltr'}
              style={{
                textAlign: 'right',
                background: BRAND.bg,
                border: `1px solid ${BRAND.border}`,
                borderRadius: '8px',
                padding: '8px 12px',
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 700, color: BRAND.subtext }}>
                {isMulti ? 'Payment Details / تفاصيل الدفع' : isRtl ? 'تفاصيل الدفع' : 'Payment Details'}
              </div>
              {paymentFields.map((field, index) => (
                <div
                  key={`${field.label}-${index}`}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}
                >
                  <span style={{ fontSize: '9px', color: BRAND.subtext }}>
                    <bdi dir="auto">{field.label}</bdi>
                  </span>
                  <strong style={{ fontSize: '10px', color: BRAND.text }}>
                    <bdi dir="auto">{field.value}</bdi>
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {data.columns.length > 0 && (
        <div
          style={{
            fontSize: '8.5px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: BRAND.subtext,
            marginTop: '10px',
          }}
        >
          {isRtl && !isMulti ? 'تفاصيل الخدمات' : isMulti ? 'Services / الخدمات' : 'Services'}
        </div>
      )}
            </td>
          </tr>
        </thead>
        <tbody>
      {/* ── INFO FIELDS ────────────────────────────────────────── */}
      {infoFields.length > 0 && (
        <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <td style={{ padding: 0 }}>
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '8px 16px',
              background: BRAND.bg,
              border: `1px solid ${BRAND.border}`,
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '14px',
            }}
          >
            {infoFields.map((field, index) => (
              <InfoCell
                key={`${field.label}-${index}`}
                label={field.label}
                value={field.value}
                dir={isRtl && !isMulti ? 'rtl' : 'ltr'}
                compact={data.compactPartyDetails}
              />
            ))}
          </section>
            </td>
        </tr>
      )}

      {/* ── SERVICE DETAILS ───────────────────────────────────── */}
      {data.columns.length > 0 && (
        <>
          {data.rows.length === 0 ? (
              <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <td style={{ padding: 0 }}>
                  <div
                    style={{
                      padding: '12px',
                      textAlign: 'center',
                      color: BRAND.subtext,
                      border: `1px dashed ${BRAND.border}`,
                      borderRadius: '8px',
                    }}
                  >
                    —
                  </div>
                </td>
              </tr>
          ) : (
            renderServiceCards()
          )}
        </>
      )}

      {/* ── TOTALS ─────────────────────────────────────────────── */}
      {data.totals.length > 0 && !data.qrDataUrl && (
        <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <td style={{ padding: 0 }}>
            <section
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: '14px',
            }}
            >
              <div
                style={{
                  minWidth: '220px',
                  border: `1px solid ${BRAND.border}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                {data.totals.map((total, index) => {
                  const isLast = index === data.totals.length - 1;
                  return (
                    <div
                      key={`total-${index}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '16px',
                        padding: isLast ? '8px 12px' : '5px 12px',
                        background: isLast ? BRAND.primary : index % 2 === 0 ? BRAND.white : BRAND.bg,
                        color: isLast ? BRAND.white : BRAND.text,
                        fontWeight: isLast ? 800 : 600,
                        fontSize: isLast ? '11px' : '10px',
                        borderTop: isLast ? `1px solid ${BRAND.borderStrong}` : undefined,
                      }}
                    >
                      <span>
                        <bdi dir="auto">{total.label}</bdi>
                      </span>
                      <span
                        style={{
                          fontFamily: screenDigitFont,
                          fontVariantNumeric: 'tabular-nums',
                          textAlign: 'right',
                        }}
                      >
                        <bdi dir="auto">{total.value}</bdi>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </td>
        </tr>
      )}

      {/* ── FOOTER ─────────────────────────────────────────────── */}
      {data.footer && (
        <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <td style={{ padding: 0 }}>
            <Hr color={BRAND.border} mt={4} mb={8} />
            <footer
              style={{
                textAlign: 'center',
                color: BRAND.subtext,
                fontSize: '9.5px',
                fontStyle: 'italic',
              }}
            >
              <bdi dir="auto">{data.footer}</bdi>
            </footer>
          </td>
        </tr>
      )}

        </tbody>
      </table>
    </article>
  );
};
