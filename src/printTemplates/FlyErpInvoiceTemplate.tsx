import React from 'react';
import type { PrintDocumentData } from './types';

/** Props for the aptFlyERP dedicated A4 Cash Receipt & Sales Invoice layout. */
interface FlyErpInvoiceTemplateProps {
  data: PrintDocumentData;
}

const screenTextFont =
  '"Cairo", "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, sans-serif';
const screenDigitFont =
  '"JetBrains Mono", "Consolas", ui-monospace, SFMono-Regular, monospace';

const ARABIC_REGEX = /[\u0600-\u06FF]/;
const MONO_LABEL_REGEX = /pnr|flight|passport|vat|cr|tax|date|rate|amount|total|balance|مرجع|رحلة|جواز|ضريب|تاريخ|السعر|المبلغ|الإجمالي|الرصيد/i;

/** Clean aviation blue/white palette matching the FlyERP reference layout. */
const BRAND = {
  navy: '#1e3a8a',          // deep royal navy (primary header text, divider, total bar)
  navyDark: '#1b3175',      // darker royal navy for the grand total bar
  softBlue: '#e4efff',      // soft sky-blue card fill (title box & service header)
  softBlueBorder: '#bfdbfe', // light blue card border
  text: '#0f172a',          // slate-900 primary value ink
  muted: '#475569',         // slate-600 secondary ink
  subtext: '#64748b',       // slate-500 label ink
  border: '#cbd5e1',        // slate-300 crisp card border
  borderLight: '#e2e8f0',   // slate-200 hairline divider
  white: '#ffffff',
};

function renderMultilineServiceName(value: string) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return '—';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {lines.map((line, idx) => {
        const isAr = ARABIC_REGEX.test(line);
        return (
          <div
            key={idx}
            dir={isAr ? 'auto' : 'ltr'}
            style={{
              fontSize: idx === 0 ? '11px' : '9.5px',
              fontWeight: idx === 0 ? 800 : 700,
              color: idx === 0 ? BRAND.navy : BRAND.text,
              lineHeight: 1.25,
              wordBreak: 'break-word',
            }}
          >
            <bdi dir="auto">{line}</bdi>
          </div>
        );
      })}
    </div>
  );
}

/** Info cell inside the customer/party metadata strip. */
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
}) => {
  const isMono = MONO_LABEL_REGEX.test(label);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <span
        style={{
          fontSize: compact ? '7px' : '7.5px',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          color: BRAND.subtext,
          fontWeight: 700,
        }}
      >
        <bdi dir="auto">{label}</bdi>
      </span>
      <span
        dir={dir}
        style={{
          fontSize: compact ? '8.8px' : '9.5px',
          fontWeight: 700,
          fontFamily: isMono ? screenDigitFont : screenTextFont,
          color: BRAND.text,
          wordBreak: 'break-word',
        }}
      >
        <bdi dir="auto">{value || '—'}</bdi>
      </span>
    </div>
  );
};

export const FlyErpInvoiceTemplate: React.FC<FlyErpInvoiceTemplateProps> = ({ data }) => {
  const isRtl = data.direction === 'rtl';
  const isMulti = data.multiLanguage;
  const enableEnglish = data.enableEnglish !== false;
  const enableArabic = data.enableArabic !== false;
  const showEnglishHeader = enableEnglish || !enableArabic;
  const showArabicHeader = enableArabic;
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

  const logoWidthMm = Math.min(60, Math.max(12, data.logoSizeMm ?? 34));
  const qrSizeMm = Math.min(50, Math.max(15, data.qrSizeMm ?? 25));
  const intermediateTotals = data.totals.length > 1 ? data.totals.slice(0, -1) : [];
  const primaryTotal = data.totals.length > 0 ? data.totals[data.totals.length - 1] : null;

  const renderServiceCards = () =>
    data.rows.map((row, rowIndex) => {
      const serviceNumber = row.values[serviceNumberColumnIndex] || String(rowIndex + 1);
      const serviceName = row.values[serviceNameColumnIndex] || '';
      const amount = amountColumnIndex >= 0 ? row.values[amountColumnIndex] || '' : '';
      const details = cardDetailColumns
        .map(({ label, index }) => ({ label, value: row.values[index] || '' }))
        .filter(({ value }) => value.trim());
      const detailRows =
        details.length <= 8
          ? details.length > 0 ? [details] : []
          : (() => {
              const perRow = Math.ceil(details.length / 2);
              return [details.slice(0, perRow), details.slice(perRow)];
            })();

      return (
        <tr key={`service-row-${rowIndex}`}>
          <td style={{ padding: '0 0 8px 0' }}>
            <article
              style={{
                border: `1px solid ${BRAND.softBlueBorder}`,
                borderRadius: '10px',
                background: BRAND.white,
                overflow: 'hidden',
                breakInside: 'avoid',
                pageBreakInside: 'avoid',
              }}
            >
              {/* Soft Sky-Blue Service Header Band */}
              <header
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '14px',
                  padding: '9px 14px',
                  background: BRAND.softBlue,
                  borderBottom: details.length > 0 ? `1px solid ${BRAND.softBlueBorder}` : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      marginTop: '11px',
                      fontFamily: screenDigitFont,
                      fontSize: '9.5px',
                      fontWeight: 800,
                      color: BRAND.navy,
                      flexShrink: 0,
                    }}
                  >
                    {serviceNumber}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: '7.5px',
                        fontWeight: 600,
                        color: BRAND.muted,
                        marginBottom: '2px',
                      }}
                    >
                      <bdi dir="auto">{serviceColumns[serviceNameColumnIndex]?.label || 'Service / الخدمة'}</bdi>
                    </div>
                    {renderMultilineServiceName(serviceName)}
                  </div>
                </div>

                {amountColumnIndex >= 0 && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: '7.5px',
                        fontWeight: 600,
                        color: BRAND.muted,
                        marginBottom: '2px',
                      }}
                    >
                      <bdi dir="auto">{serviceColumns[amountColumnIndex]?.label}</bdi>
                    </div>
                    <strong
                      style={{
                        fontFamily: screenDigitFont,
                        fontSize: '11px',
                        fontWeight: 800,
                        color: BRAND.text,
                      }}
                    >
                      <bdi dir="auto">{amount}</bdi>
                    </strong>
                  </div>
                )}
              </header>

              {/* Tabular Item Sub-Contents */}
              {detailRows.length > 0 && (
                <div style={{ background: BRAND.white }}>
                  {detailRows.map((chunk, chunkIndex) => (
                    <table
                      key={`service-detail-table-${rowIndex}-${chunkIndex}`}
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        tableLayout: 'fixed',
                        borderTop: chunkIndex > 0 ? `1px solid ${BRAND.border}` : 'none',
                      }}
                    >
                      <thead>
                        <tr>
                          {chunk.map(({ label }, detailIndex) => (
                            <th
                              key={`service-detail-th-${rowIndex}-${chunkIndex}-${detailIndex}`}
                              style={{
                                padding: '5px 7px',
                                background: '#f8fafc',
                                borderBottom: `1px solid ${BRAND.border}`,
                                borderRight: detailIndex < chunk.length - 1 ? `1px solid ${BRAND.borderLight}` : 'none',
                                textAlign: 'left',
                                verticalAlign: 'bottom',
                                fontSize: '7.2px',
                                fontWeight: 700,
                                color: BRAND.subtext,
                                lineHeight: 1.25,
                              }}
                            >
                              <bdi dir="auto">{label}</bdi>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {chunk.map(({ label, value }, detailIndex) => {
                            const isMono = MONO_LABEL_REGEX.test(label);
                            return (
                              <td
                                key={`service-detail-td-${rowIndex}-${chunkIndex}-${detailIndex}`}
                                style={{
                                  padding: '6px 7px',
                                  background: BRAND.white,
                                  borderRight: detailIndex < chunk.length - 1 ? `1px solid ${BRAND.borderLight}` : 'none',
                                  textAlign: 'left',
                                  verticalAlign: 'top',
                                  color: BRAND.text,
                                  fontSize: '8.5px',
                                  fontWeight: 700,
                                  fontFamily: isMono ? screenDigitFont : screenTextFont,
                                  overflowWrap: 'anywhere',
                                  whiteSpace: 'pre-line',
                                }}
                              >
                                <bdi dir="auto">{value}</bdi>
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
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
        lineHeight: 1.38,
        overflowWrap: 'anywhere',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          borderSpacing: 0,
          tableLayout: 'fixed',
        }}
      >
        <thead style={{ display: 'table-header-group' }}>
          <tr>
            <td style={{ padding: '0 0 8px 0' }}>
              {/* ── REPEATING MY BUSINESS HEADER (ALL PAGES) ──────────── */}
              <header
                style={{
                  paddingBottom: '8px',
                  borderBottom: `2.5px solid ${BRAND.navy}`,
                  marginBottom: '2px',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: data.companyLogo
                      ? 'minmax(0, 1fr) auto minmax(0, 1fr)'
                      : showEnglishHeader && showArabicHeader
                        ? 'minmax(0, 1fr) minmax(0, 1fr)'
                        : 'minmax(0, 1fr)',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  {showEnglishHeader ? (
                    <div dir="ltr" style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: BRAND.text, lineHeight: 1.2 }}>
                        <bdi dir="ltr">{data.companyName || 'aptFlyERP'}</bdi>
                      </div>
                      <div style={{ marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '1px', lineHeight: 1.22 }}>
                        {businessDetails.map((detail) => (
                          <div key={detail.englishLabel} style={{ fontSize: '8px', color: BRAND.subtext }}>
                            <span>{detail.englishLabel}:</span>{' '}
                            <bdi
                              dir="auto"
                              style={{
                                fontFamily: detail.englishLabel.endsWith('No.') ? screenDigitFont : undefined,
                                color: BRAND.muted,
                              }}
                            >
                              {detail.value}
                            </bdi>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : data.companyLogo ? (
                    <div />
                  ) : null}

                  {data.companyLogo && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img
                        src={data.companyLogo}
                        alt=""
                        style={{
                          display: 'block',
                          maxWidth: `${logoWidthMm}mm`,
                          maxHeight: `${Math.round(logoWidthMm * 0.75)}mm`,
                          objectFit: 'contain',
                        }}
                      />
                    </div>
                  )}

                  {showArabicHeader ? (
                    <div dir="rtl" style={{ minWidth: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: BRAND.text, lineHeight: 1.2 }}>
                        <bdi dir="rtl">{data.companyNameAr || data.companyName || 'aptFlyERP'}</bdi>
                      </div>
                      <div style={{ marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '1px', lineHeight: 1.22 }}>
                        {businessDetails.map((detail) => (
                          <div key={detail.arabicLabel} style={{ fontSize: '8px', color: BRAND.subtext }}>
                            <span>{detail.arabicLabel}:</span>{' '}
                            <bdi
                              dir="auto"
                              style={{
                                fontFamily: detail.englishLabel.endsWith('No.') ? screenDigitFont : undefined,
                                color: BRAND.muted,
                              }}
                            >
                              {detail.value}
                            </bdi>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : data.companyLogo ? (
                    <div />
                  ) : null}
                </div>
              </header>
            </td>
          </tr>
        </thead>

        <tbody>
          {/* ── DOCUMENT TITLE CARD + PAYMENT DETAILS CARD (PAGE 1) ──── */}
          <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <td style={{ padding: '0 0 8px 0' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: paymentFields.length > 0 ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr',
                  gap: '10px',
                }}
              >
                <div
                  dir="ltr"
                  style={{
                    background: BRAND.softBlue,
                    border: `1px solid ${BRAND.softBlueBorder}`,
                    borderRadius: '10px',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: '3px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 800,
                      color: BRAND.navy,
                      letterSpacing: '0.02em',
                      textTransform: 'uppercase',
                    }}
                  >
                    <bdi dir="auto">{data.title}</bdi>
                  </div>
                  {data.number && (
                    <div
                      style={{
                        fontFamily: screenDigitFont,
                        fontSize: '11px',
                        fontWeight: 800,
                        color: BRAND.navy,
                      }}
                    >
                      {data.number}
                    </div>
                  )}
                  {data.date && (
                    <div
                      style={{
                        fontFamily: screenDigitFont,
                        fontSize: '9.5px',
                        color: BRAND.muted,
                      }}
                    >
                      {data.date}
                    </div>
                  )}
                </div>

                {paymentFields.length > 0 && (
                  <div
                    dir="ltr"
                    style={{
                      background: BRAND.white,
                      border: `1px solid ${BRAND.border}`,
                      borderRadius: '10px',
                      padding: '10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: '4px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        color: BRAND.text,
                        textAlign: 'right',
                        marginBottom: '2px',
                      }}
                    >
                      {isMulti
                        ? 'Payment Details / تفاصيل الدفع'
                        : isRtl
                          ? 'تفاصيل الدفع'
                          : 'Payment Details'}
                    </div>
                    {paymentFields.map((field, index) => (
                      <div
                        key={`${field.label}-${index}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: '10px',
                        }}
                      >
                        <span style={{ fontSize: '9px', fontWeight: 500, color: BRAND.subtext }}>
                          <bdi dir="auto">{field.label}</bdi>
                        </span>
                        <strong style={{ fontSize: '9.5px', fontWeight: 800, color: BRAND.text }}>
                          <bdi dir="auto">{field.value}</bdi>
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </td>
          </tr>
          {/* ── SERVICES SECTION LABEL ───────────────────────────────── */}
          {data.columns.length > 0 && (
            <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <td style={{ padding: '2px 0 6px 0' }}>
                <div
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: BRAND.subtext,
                  }}
                >
                  {isRtl && !isMulti ? 'الخدمات' : isMulti ? 'SERVICES / الخدمات' : 'SERVICES'}
                </div>
              </td>
            </tr>
          )}

          {/* ── CUSTOMER / CASHIER / BILL TOTAL STRIP ────────────────── */}
          {infoFields.length > 0 && (
            <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <td style={{ padding: '0 0 8px 0' }}>
                <section
                  style={{
                    background: BRAND.white,
                    border: `1px solid ${BRAND.border}`,
                    borderRadius: '8px',
                    padding: '10px 14px',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: '8px 16px',
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
                  </div>
                </section>
              </td>
            </tr>
          )}

          {/* ── SERVICE CARDS ────────────────────────────────────────── */}
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

          {/* ── TOTALS & ZATCA QR SECTION ────────────────────────────── */}
          {(data.totals.length > 0 || data.qrDataUrl) && (
            <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <td style={{ paddingTop: '4px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-end',
                    gap: '16px',
                  }}
                >
                  {data.qrDataUrl ? (
                    <div
                      style={{
                        border: `1px solid ${BRAND.border}`,
                        borderRadius: '8px',
                        padding: '6px',
                        background: BRAND.white,
                        textAlign: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src={data.qrDataUrl}
                        alt="ZATCA QR"
                        style={{ display: 'block', width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm`, objectFit: 'contain' }}
                      />
                    </div>
                  ) : (
                    <div />
                  )}

                  {primaryTotal && (
                    <div
                      style={{
                        minWidth: '250px',
                        maxWidth: '340px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      {intermediateTotals.length > 0 && (
                        <div
                          style={{
                            border: `1px solid ${BRAND.border}`,
                            borderRadius: '8px',
                            background: BRAND.white,
                            padding: '8px 14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                          }}
                        >
                          {intermediateTotals.map((entry, idx) => (
                            <div
                              key={`${entry.label}-${idx}`}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'baseline',
                                gap: '16px',
                              }}
                            >
                              <span style={{ fontSize: '9px', fontWeight: 600, color: BRAND.muted }}>
                                <bdi dir="auto">{entry.label}</bdi>
                              </span>
                              <span
                                style={{
                                  fontFamily: screenDigitFont,
                                  fontSize: '9.5px',
                                  fontWeight: 700,
                                  color: BRAND.text,
                                }}
                              >
                                <bdi dir="auto">{entry.value}</bdi>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '18px',
                          background: BRAND.navyDark,
                          color: BRAND.white,
                          borderRadius: '8px',
                          padding: '9px 16px',
                        }}
                      >
                        <span style={{ fontSize: '10.5px', fontWeight: 700 }}>
                          <bdi dir="auto">{primaryTotal.label}</bdi>
                        </span>
                        <strong
                          style={{
                            fontFamily: screenDigitFont,
                            fontSize: '11.5px',
                            fontWeight: 800,
                          }}
                        >
                          <bdi dir="auto">{primaryTotal.value}</bdi>
                        </strong>
                      </div>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          )}

          {/* ── FOOTER NOTE ───────────────────────────────────────────── */}
          {data.footer && (
            <tr style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <td style={{ paddingTop: '6px' }}>
                <footer
                  style={{
                    paddingTop: '6px',
                    borderTop: `1px dashed ${BRAND.border}`,
                    textAlign: 'center',
                    color: BRAND.subtext,
                    fontSize: '9px',
                    fontWeight: 600,
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
