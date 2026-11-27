import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QRCode from 'qrcode';
import type { InvoiceMarginsMm, PaperWidth, StoreSettings } from '../types/pos';
import type { PrintDataContext } from '../utils/voucherPrintData';
import { resolveInvoiceMarginsMm } from '../utils/thermalPrinting';
import {
  PRINT_TEMPLATE_CATALOG,
  getDefaultPrintTemplate,
  getPrintDocumentFormat,
  resolvePrintTemplate,
} from './catalog';
import { DocumentTemplate } from './DocumentTemplate';
import { FlyErpInvoiceTemplate } from './FlyErpInvoiceTemplate';
import { toVoucherDocumentData } from './VoucherTemplate';
import type {
  PrintDocumentData,
  PrintDocumentType,
  PrintTemplateDefinition,
  PrintTemplateJob,
} from './types';

const A4_PAGE_SIZE = { width: 210_000, height: 297_000 };
const A5_PAGE_SIZE = { width: 148_000, height: 210_000 };
const THERMAL_ROLL_HEIGHT_MICRONS = 3_276_000; // 3276mm standard thermal roll height

function isSheetFormat(format: PaperWidth): boolean {
  return format === 'A4' || format === 'A5' || format === 'Custom';
}

function resolveSheetDimensionsMm(
  format: PaperWidth,
  customWidthMm?: number,
  customHeightMm?: number
): { widthMm: number; heightMm: number } {
  if (format === 'A5') return { widthMm: 148, heightMm: 210 };
  if (format === 'Custom') {
    const widthMm = typeof customWidthMm === 'number' && Number.isFinite(customWidthMm)
      ? Math.min(420, Math.max(48, customWidthMm))
      : 210;
    const heightMm = typeof customHeightMm === 'number' && Number.isFinite(customHeightMm)
      ? Math.min(594, Math.max(60, customHeightMm))
      : 297;
    return { widthMm, heightMm };
  }
  return { widthMm: 210, heightMm: 297 };
}

const ARABIC_CHAR_REGEX = /[\u0600-\u06FF]/;

function filterBilingualSegment(segment: string, enableEnglish: boolean, enableArabic: boolean): string {
  if (enableEnglish && enableArabic) return segment;
  if (!segment.includes(' / ')) return segment;
  const parts = segment.split(' / ').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return segment;
  const hasArabic = parts.some((part) => ARABIC_CHAR_REGEX.test(part));
  const hasNonArabic = parts.some((part) => !ARABIC_CHAR_REGEX.test(part));
  if (!hasArabic || !hasNonArabic) return segment;
  if (enableArabic && !enableEnglish) {
    return parts.filter((part) => ARABIC_CHAR_REGEX.test(part)).join(' / ');
  }
  return parts.filter((part) => !ARABIC_CHAR_REGEX.test(part)).join(' / ');
}

function filterBilingualLine(line: string, enableEnglish: boolean, enableArabic: boolean): string {
  if (enableEnglish && enableArabic) return line;
  if (!line.includes(' / ')) return line;
  const colonIndex = line.indexOf(':');
  if (colonIndex > 0 && colonIndex < line.length - 1) {
    const rawLabel = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();
    if (rawLabel && rawValue) {
      const filteredLabel = filterBilingualSegment(rawLabel, enableEnglish, enableArabic);
      const filteredValue = filterBilingualSegment(rawValue, enableEnglish, enableArabic);
      return `${filteredLabel}: ${filteredValue}`;
    }
  }
  return filterBilingualSegment(line, enableEnglish, enableArabic);
}

function filterBilingualText(value: string, enableEnglish: boolean, enableArabic: boolean): string {
  if (!value || (enableEnglish && enableArabic)) return value;
  const lines = value.split('\n');
  if (lines.length === 1) {
    return filterBilingualLine(value, enableEnglish, enableArabic);
  }
  const filteredLines = lines.map((line) => filterBilingualLine(line, enableEnglish, enableArabic));
  const hasArabicLine = filteredLines.some((line) => ARABIC_CHAR_REGEX.test(line));
  const hasNonArabicLine = filteredLines.some((line) => line.trim() && !ARABIC_CHAR_REGEX.test(line));
  if (hasArabicLine && hasNonArabicLine && lines.every((line) => !line.includes(' / '))) {
    const picked = enableArabic && !enableEnglish
      ? filteredLines.filter((line) => ARABIC_CHAR_REGEX.test(line))
      : filteredLines.filter((line) => !ARABIC_CHAR_REGEX.test(line));
    if (picked.length > 0) return picked.join('\n');
  }
  return filteredLines.join('\n');
}

function resolveProfileLanguages(profile?: { enableEnglish?: boolean; enableArabic?: boolean }) {
  let enableEnglish = profile?.enableEnglish !== false;
  let enableArabic = profile?.enableArabic !== false;
  if (!enableEnglish && !enableArabic) {
    enableEnglish = true;
  }
  return {
    enableEnglish,
    enableArabic,
    multiLanguage: enableEnglish && enableArabic,
    direction: (enableArabic && !enableEnglish ? 'rtl' : 'ltr') as 'ltr' | 'rtl',
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function documentHtml(
  data: PrintDocumentData,
  template: PrintTemplateDefinition,
  pageHeightMm: number,
  margins: InvoiceMarginsMm,
  pageWidthMmOverride?: number
): string {
  const sheet = isSheetFormat(template.format);
  const widthMm = sheet
    ? (pageWidthMmOverride ?? (template.format === 'A5' ? 148 : 210))
    : Number.parseInt(template.format, 10);
  const pageSize = template.format === 'A4'
    ? 'A4 portrait'
    : template.format === 'A5'
      ? 'A5 portrait'
      : `${widthMm}mm ${pageHeightMm}mm`;
  const isFlyErpSheet = template.variant === 'flyerp' && sheet;
  const pageTopMarginMm = margins.top;
  const pageBottomMarginMm = margins.bottom;
  const pageNumberLabel = data.multiLanguage
    ? '"Page " counter(page) " / " counter(pages)'
    : data.direction === 'rtl'
      ? '"صفحة " counter(page) " من " counter(pages)'
      : '"Page " counter(page) " of " counter(pages)';
  const pageFooterRules = isFlyErpSheet
    ? `@bottom-center { content: ${pageNumberLabel}; font-family: "Cairo", "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif; font-size: 8.5pt; font-weight: 700; color: #64748b; text-align: center; vertical-align: bottom; padding-bottom: 3mm; }`
    : '';
  const markup = renderToStaticMarkup(
    template.variant === 'flyerp'
      ? <FlyErpInvoiceTemplate data={data} />
      : <DocumentTemplate data={data} format={template.format} variant={template.variant} />
  );
  const documentTitle = data.number || data.title;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(documentTitle)}</title>
    ${sheet ? `<link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">` : ''}
    <style>
      @page { size: ${pageSize}; margin: ${pageTopMarginMm}mm ${margins.right}mm ${pageBottomMarginMm}mm ${margins.left}mm; ${pageFooterRules} }
      *, *::before, *::after { box-sizing: border-box; }
      html { margin: 0; padding: 0; width: ${widthMm}mm; min-height: ${sheet ? `${pageHeightMm}mm` : '0'}; background: #fff; overflow-x: hidden; }
      body {
        margin: 0;
        padding: ${pageTopMarginMm}mm ${margins.right}mm ${pageBottomMarginMm}mm ${margins.left}mm;
        width: ${widthMm}mm;
        min-height: ${sheet ? `${pageHeightMm}mm` : '0'};
        background: #fff;
        color: ${sheet ? '#111827' : '#000000'};
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      [data-print-document] {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
      }
      @media print {
        html, body { width: auto; min-height: 0; padding: 0 !important; overflow: visible; }
        [data-print-document] {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 auto !important;
          break-inside: auto;
          page-break-inside: auto;
        }
        table thead { display: table-header-group; }
        table tr { break-inside: avoid; page-break-inside: avoid; }
      }
      img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style>
  </head>
  <body>${markup}</body>
</html>`;
}

async function measureThermalHeight(html: string, verticalMarginsMm: number): Promise<number> {
  const frame = document.createElement('iframe');
  frame.title = 'Print template measurement';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '100mm',
    height: '1200mm',
    border: '0',
    visibility: 'hidden',
  });
  document.body.appendChild(frame);

  try {
    const loaded = new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Could not render the print template for measurement.'));
    });
    frame.srcdoc = html.replace(/@page \{ size: [^;]+;/, '@page { size: 100mm 1200mm;');
    await loaded;

    const frameDocument = frame.contentDocument;
    if (!frameDocument) throw new Error('The print template measurement frame is unavailable.');
    await frameDocument.fonts?.ready;
    const documentElement = frameDocument.querySelector<HTMLElement>('[data-print-document]');
    if (!documentElement) throw new Error('The print template content is unavailable.');
    const heightPx = documentElement.getBoundingClientRect().height;
    if (!Number.isFinite(heightPx) || heightPx <= 0) {
      throw new Error('Could not measure the print template height.');
    }
    return Math.ceil((heightPx * 25_400) / 96) + Math.ceil(verticalMarginsMm * 1000) + 4_000;
  } finally {
    frame.remove();
  }
}

export async function createPrintTemplateJob(
  data: PrintDocumentData,
  settings: StoreSettings,
  format: PaperWidth,
  requestedTemplateId?: string
): Promise<PrintTemplateJob> {
  const configuredProfile = settings.printDocumentProfiles?.[data.documentType]?.[format];
  const resolvedTemplateId = requestedTemplateId || configuredProfile?.templateId;
  const template = resolvePrintTemplate(data.documentType, format, resolvedTemplateId);
  const lang = resolveProfileLanguages(configuredProfile);
  const logoEnabled = configuredProfile?.enableLogo !== undefined
    ? configuredProfile.enableLogo
    : settings.invoiceShowStoreLogo !== false;
  const resolvedLogo = logoEnabled
    ? (configuredProfile?.logoDataUrl || data.companyLogo || settings.storeLogoDataUrl)
    : undefined;
  const profileFooterParts = [
    lang.enableEnglish ? configuredProfile?.footer : undefined,
    lang.enableArabic ? configuredProfile?.footerAr : undefined,
  ].filter((part): part is string => Boolean(part?.trim()));
  const rawFooter = profileFooterParts.length > 0
    ? profileFooterParts.join('\n')
    : settings.invoiceShowFooter === false
      ? undefined
      : data.footer;
  const resolvedFooter = rawFooter
    ? filterBilingualText(rawFooter, lang.enableEnglish, lang.enableArabic)
    : undefined;
  const resolvedData: PrintDocumentData = {
    ...data,
    title: filterBilingualText(data.title, lang.enableEnglish, lang.enableArabic),
    multiLanguage: lang.multiLanguage,
    enableEnglish: lang.enableEnglish,
    enableArabic: lang.enableArabic,
    direction: lang.direction,
    companyNameAr: lang.enableArabic ? data.companyNameAr : undefined,
    logoSizeMm: data.logoSizeMm ?? settings.invoiceLogoSizeMm,
    qrSizeMm: data.qrSizeMm ?? settings.invoiceQrCodeSizeMm,
    companyLogo: resolvedLogo,
    qrDataUrl: settings.invoiceShowQrCode === false ? undefined : data.qrDataUrl,
    columns: data.columns.map((column) =>
      filterBilingualText(column, lang.enableEnglish, lang.enableArabic)
    ),
    fields: data.fields.map((field) => ({
      label: filterBilingualText(field.label, lang.enableEnglish, lang.enableArabic),
      value: filterBilingualText(field.value, lang.enableEnglish, lang.enableArabic),
    })),
    rows: data.rows.map((row) => ({
      ...row,
      values: row.values.map((cell) =>
        filterBilingualText(cell, lang.enableEnglish, lang.enableArabic)
      ),
    })),
    totals: data.totals.map((total) => ({
      label: filterBilingualText(total.label, lang.enableEnglish, lang.enableArabic),
      value: total.value,
    })),
    footer: resolvedFooter,
  };
  const fallbackProfileFormat = getPrintDocumentFormat(settings, data.documentType, format);
  const fallbackProfile = fallbackProfileFormat !== format
    ? settings.printDocumentProfiles?.[data.documentType]?.[fallbackProfileFormat]
    : undefined;
  const margins = resolveInvoiceMarginsMm(
    template.format,
    configuredProfile?.marginsMm ?? fallbackProfile?.marginsMm ?? settings.invoiceMarginsMm
  );
  const sheet = isSheetFormat(template.format);
  const sheetDims = sheet
    ? resolveSheetDimensionsMm(template.format, configuredProfile?.customWidthMm, configuredProfile?.customHeightMm)
    : undefined;
  const pageSize = template.format === 'A4'
    ? A4_PAGE_SIZE
    : template.format === 'A5'
      ? A5_PAGE_SIZE
      : sheetDims
        ? { width: Math.round(sheetDims.widthMm * 1000), height: Math.round(sheetDims.heightMm * 1000) }
        : {
            width: Number.parseInt(template.format, 10) * 1000,
            height: THERMAL_ROLL_HEIGHT_MICRONS,
          };
  const pageHeightMm = pageSize.height / 1000;
  const html = documentHtml(resolvedData, template, pageHeightMm, margins, sheetDims?.widthMm);
  const rawPrinterName =
    configuredProfile?.printerName ||
    (data.documentType === 'kot' ? settings.kotPrinter : settings.defaultPrinter) ||
    '';
  const printerName =
    rawPrinterName.trim() && !/^(system default|default)\b/i.test(rawPrinterName.trim())
      ? rawPrinterName.trim()
      : undefined;
  return {
    template,
    html,
    pageSize,
    ...(printerName ? { printerName } : {}),
    silent: true,
  };
}

export function resolveInvoiceQrCodeSizeMm(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(50, Math.max(15, value))
    : 25;
}

export async function createVoucherTemplateJob(
  documentType: Extract<PrintDocumentType, 'sales-invoice' | 'sales-return' | 'purchase-invoice' | 'purchase-return'>,
  voucherId: number,
  settings: StoreSettings,
  format: PaperWidth,
  isRtl = false,
  qrDataUrl?: string,
  requestedTemplateId?: string,
  customerAccount?: {
    balance: number;
  }
): Promise<PrintTemplateJob> {
  const printFormat = getPrintDocumentFormat(settings, documentType, format);
  const response = await fetch(`/api/print-data/${documentType}/${voucherId}`, { cache: 'no-store' });
  if (!response.ok) {
    let message = `Print data request failed with HTTP ${response.status}.`;
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // Keep the HTTP failure explicit when the response is not JSON.
    }
    throw new Error(message);
  }
  const payload = await response.json() as {
    voucherType?: string;
    context?: PrintDataContext;
  };
  if (payload.voucherType !== documentType || !payload.context || !Array.isArray(payload.context.items)) {
    throw new Error('The voucher print data response was invalid.');
  }
  const configuredTemplateId = settings.printDocumentProfiles?.[documentType]?.[printFormat]?.templateId;
  const template = resolvePrintTemplate(documentType, printFormat, requestedTemplateId || configuredTemplateId);
  const printContext = template.variant === 'flyerp' && documentType === 'sales-invoice'
    ? {
        ...payload.context,
        company: {
          ...payload.context.company,
          storeName: settings.storeName,
          storeNameAr: settings.storeNameAr,
          address: settings.address,
          buildingNo: settings.buildingNo,
          streetName: settings.streetName,
          district: settings.district,
          city: settings.city,
          postalCode: settings.postalCode,
          country: settings.country,
          phone: settings.phone,
          taxId: settings.taxId,
          crNumber: settings.crNumber,
          currencySymbol: settings.currencySymbol,
          decimalPoints: settings.decimalPoints ?? 2,
          logo: settings.storeLogoDataUrl,
          receiptFooter: settings.receiptFooter,
          receiptFooterAr: settings.receiptFooterAr,
        },
      }
    : payload.context;
  const showQr = documentType === 'sales-invoice' && settings.invoiceShowQrCode !== false;
  const qrPayload = payload.context.voucher.eInvoiceQrCodePhase1;
  const resolvedQrDataUrl = showQr
    ? qrDataUrl || (
        typeof qrPayload === 'string' && qrPayload.trim()
          ? await QRCode.toDataURL(qrPayload, {
              errorCorrectionLevel: 'M',
              margin: 1,
              width: 512,
              color: { dark: '#000000', light: '#ffffff' },
            })
          : undefined
      )
    : undefined;
  const configuredProfile = settings.printDocumentProfiles?.[documentType]?.[printFormat];
  const lang = resolveProfileLanguages(configuredProfile);
  const data = toVoucherDocumentData(
    documentType,
    printContext,
    lang.direction === 'rtl',
    resolvedQrDataUrl,
    lang.multiLanguage,
    {
      includeArabicCompanyName: lang.enableArabic,
      includePartyDetails: template.variant === 'flyerp' || printFormat === '80mm' || printFormat === 'A4' || printFormat === 'A5' || printFormat === 'Custom',
      isFlyErp: template.variant === 'flyerp',
      pendingBalance: template.variant === 'flyerp' ? customerAccount?.balance : undefined,
    }
  );
  data.qrSizeMm = resolveInvoiceQrCodeSizeMm(settings.invoiceQrCodeSizeMm);
  data.logoSizeMm = settings.invoiceLogoSizeMm;
  return createPrintTemplateJob(data, settings, printFormat, template.id);
}

export async function printTemplateJob(job: PrintTemplateJob): Promise<boolean> {
  if (window.electronAPI?.isElectron) {
    const result = await window.electronAPI.printReceipt({
      silent: job.silent,
      printerName: job.printerName,
      pageSize: job.pageSize,
      html: job.html,
    });
    const reason = result.error?.toLowerCase();
    if (!result.ok && reason !== 'cancelled' && reason !== 'canceled') {
      throw new Error(result.error || 'The document could not be printed.');
    }
    return result.ok;
  }

  const frame = document.createElement('iframe');
  frame.title = 'Print document';
  frame.style.position = 'fixed';
  frame.style.left = '0';
  frame.style.top = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const printed = new Promise<boolean>((resolve, reject) => {
    frame.onload = () => {
      try {
        const printWindow = frame.contentWindow;
        if (!printWindow) throw new Error('The print window is unavailable.');
        printWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
        printWindow.focus();
        printWindow.print();
        resolve(true);
      } catch (error) {
        frame.remove();
        reject(error);
      }
    };
  });
  frame.srcdoc = job.html;
  window.setTimeout(() => frame.remove(), 60_000);
  return printed;
}

export function getDefaultTemplateId(documentType: PrintDocumentType, format: PaperWidth): string {
  return getDefaultPrintTemplate(documentType, format).id;
}

export function getAvailableTemplateIds(): string[] {
  return PRINT_TEMPLATE_CATALOG.map((template) => template.id);
}
