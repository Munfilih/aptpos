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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function invoiceSummaryFooterSvg(data: PrintDocumentData): { dataUrl: string; heightMm: number } | undefined {
  if (data.totals.length === 0) return undefined;

  const width = 480;
  const height = 22 + data.totals.length * 18;
  const title = data.multiLanguage
    ? 'Invoice Summary / ملخص الفاتورة'
    : data.direction === 'rtl'
      ? 'ملخص الفاتورة'
      : 'Invoice Summary';
  const svg = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width="120mm" height={`${height / 4}mm`} viewBox={`0 0 ${width} ${height}`}>
      <rect x="1" y="1" width={width - 2} height={height - 2} rx="8" fill="#ffffff" stroke="#cbd5e1" />
      <text x={width - 14} y="15" textAnchor="end" fontFamily="Arial, sans-serif" fontSize="10" fontWeight="700" fill="#475569">
        {title}
      </text>
      {data.totals.map((total, index) => {
        const isLast = index === data.totals.length - 1;
        const y = 30 + index * 18;
        return (
          <g key={`summary-${index}`}>
            {isLast && <rect x="2" y={y - 13} width={width - 4} height="17" fill="#1e3a8a" />}
            <text
              x={width - 164}
              y={y}
              textAnchor="end"
              fontFamily="Arial, sans-serif"
              fontSize="10"
              fontWeight={isLast ? '700' : '400'}
              fill={isLast ? '#ffffff' : '#0f172a'}
            >
              {total.label}
            </text>
            <text
              x={width - 14}
              y={y}
              textAnchor="end"
              direction="ltr"
              fontFamily="Arial, sans-serif"
              fontSize="10"
              fontWeight={isLast ? '700' : '400'}
              fill={isLast ? '#ffffff' : '#0f172a'}
            >
              {total.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    heightMm: height / 4,
  };
}

function documentHtml(
  data: PrintDocumentData,
  template: PrintTemplateDefinition,
  pageHeightMm: number,
  margins: InvoiceMarginsMm
): string {
  const widthMm = template.format === 'A4' ? 210 : Number.parseInt(template.format, 10);
  const pageSize = template.format === 'A4'
    ? 'A4 portrait'
    : `${widthMm}mm ${pageHeightMm}mm`;
  const hasFlyErpQrFooter =
    template.variant === 'flyerp' &&
    template.format === 'A4' &&
    Boolean(data.qrDataUrl);
  const qrSizeMm = Math.min(24, resolveInvoiceQrCodeSizeMm(data.qrSizeMm));
  const qrFooterImageUrl = hasFlyErpQrFooter && data.qrDataUrl
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${qrSizeMm}mm" height="${qrSizeMm}mm" viewBox="0 0 512 512"><image href="${data.qrDataUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" width="512" height="512"/></svg>`
      )}`
    : undefined;
  const invoiceSummary = hasFlyErpQrFooter ? invoiceSummaryFooterSvg(data) : undefined;
  const pageBottomMarginMm = hasFlyErpQrFooter
    ? Math.max(margins.bottom, Math.max(qrSizeMm, invoiceSummary?.heightMm || 0) + 4)
    : margins.bottom;
  const pageFooterRules =
    template.variant === 'flyerp' && template.format === 'A4'
      ? `${hasFlyErpQrFooter
          ? `@bottom-left { content: url("${qrFooterImageUrl}"); width: ${qrSizeMm}mm; height: ${qrSizeMm}mm; text-align: left; vertical-align: bottom; }`
          : ''}
        ${invoiceSummary
          ? `@bottom-right { content: url("${invoiceSummary.dataUrl}"); width: 150mm; text-align: right; vertical-align: bottom; }`
          : ''}`
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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap" rel="stylesheet">
    <style>
      @page { size: ${pageSize}; margin: ${margins.top}mm ${margins.right}mm ${pageBottomMarginMm}mm ${margins.left}mm; ${pageFooterRules} }
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: ${widthMm}mm; min-height: 0; background: #fff; color: #111827; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      [data-print-document] {
        width: calc(${widthMm}mm - ${margins.left + margins.right}mm) !important;
        max-width: calc(${widthMm}mm - ${margins.left + margins.right}mm) !important;
        margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm !important;
      }
      @media print {
        html, body { width: auto; }
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
  _settings: StoreSettings,
  format: PaperWidth,
  requestedTemplateId?: string
): Promise<PrintTemplateJob> {
  const template = resolvePrintTemplate(data.documentType, format, requestedTemplateId);
  const margins = resolveInvoiceMarginsMm(template.format);
  const initialHtml = documentHtml(data, template, template.format === 'A4' ? 297 : 1200, margins);
  const pageSize = template.format === 'A4'
    ? A4_PAGE_SIZE
    : {
        width: Number.parseInt(template.format, 10) * 1000,
        height: await measureThermalHeight(initialHtml, margins.top + margins.bottom),
      };
  const pageHeightMm = pageSize.height / 1000;
  const html = documentHtml(data, template, pageHeightMm, margins);
  return { template, html, pageSize, silent: true };
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
  const template = requestedTemplateId
    ? resolvePrintTemplate(documentType, printFormat, requestedTemplateId)
    : getDefaultPrintTemplate(documentType, printFormat);
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
        },
      }
    : payload.context;
  const showQr = documentType === 'sales-invoice';
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
  const data = toVoucherDocumentData(
    documentType,
    printContext,
    isRtl,
    resolvedQrDataUrl,
    template.variant === 'flyerp',
    {
      includeArabicCompanyName: template.variant === 'flyerp',
      includePartyDetails: template.variant === 'flyerp',
      pendingBalance: template.variant === 'flyerp' ? customerAccount?.balance : undefined,
    }
  );
  data.qrSizeMm = resolveInvoiceQrCodeSizeMm(undefined);
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
