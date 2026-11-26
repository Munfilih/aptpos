import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PaperWidth, StoreSettings } from '../types/pos';
import type { PrintDataContext } from '../utils/voucherPrintData';
import {
  PRINT_TEMPLATE_CATALOG,
  getDefaultPrintTemplate,
  getPrintDocumentFormat,
  resolvePrintTemplate,
} from './catalog';
import { DocumentTemplate } from './DocumentTemplate';
import { toVoucherDocumentData } from './VoucherTemplate';
import type {
  PrintDocumentData,
  PrintDocumentType,
  PrintTemplateDefinition,
  PrintTemplateJob,
} from './types';

const A4_PAGE_SIZE = { width: 210_000, height: 297_000 };

function documentHtml(
  data: PrintDocumentData,
  template: PrintTemplateDefinition,
  pageHeightMm: number
): string {
  const widthMm = template.format === 'A4' ? 210 : Number.parseInt(template.format, 10);
  const marginMm = template.format === 'A4' ? 10 : 0;
  const pageSize = template.format === 'A4'
    ? 'A4 portrait'
    : `${widthMm}mm ${pageHeightMm}mm`;
  const markup = renderToStaticMarkup(
    <DocumentTemplate data={data} format={template.format} variant={template.variant} />
  );
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap" rel="stylesheet">
    <style>
      @page { size: ${pageSize}; margin: 0; }
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: ${widthMm}mm; min-height: 0; background: #fff; color: #111827; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      [data-print-document] { margin: ${marginMm}mm auto !important; }
      img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style>
  </head>
  <body>${markup}</body>
</html>`;
}

async function measureThermalHeight(html: string): Promise<number> {
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
    return Math.ceil((heightPx * 25_400) / 96) + 4_000;
  } finally {
    frame.remove();
  }
}

function resolvePrinter(
  settings: StoreSettings,
  documentType: PrintDocumentType,
  format: PaperWidth
): { printerName?: string; silent: boolean } {
  const profile = settings.printDocumentProfiles?.[documentType]?.[format];
  const legacyProfile = settings.invoiceTemplates?.[format];
  const printerMode = profile?.printerMode
    || legacyProfile?.printerMode
    || (profile?.printerName || legacyProfile?.defaultPrinter ? 'saved-printer' : 'system-default');
  const printerName = documentType === 'kot'
    ? profile?.printerName || settings.kotPrinter || legacyProfile?.defaultPrinter
    : profile?.printerName || legacyProfile?.defaultPrinter || settings.defaultPrinter;

  return {
    printerName: printerMode === 'saved-printer' ? printerName || undefined : undefined,
    silent: printerMode !== 'choose-at-print-time',
  };
}

export async function createPrintTemplateJob(
  data: PrintDocumentData,
  settings: StoreSettings,
  format: PaperWidth,
  requestedTemplateId?: string
): Promise<PrintTemplateJob> {
  const template = resolvePrintTemplate(data.documentType, format, requestedTemplateId);
  const initialHtml = documentHtml(data, template, template.format === 'A4' ? 297 : 1200);
  const pageSize = template.format === 'A4'
    ? A4_PAGE_SIZE
    : {
        width: Number.parseInt(template.format, 10) * 1000,
        height: await measureThermalHeight(initialHtml),
      };
  const pageHeightMm = pageSize.height / 1000;
  const html = documentHtml(data, template, pageHeightMm);
  const printer = resolvePrinter(settings, data.documentType, format);
  return { template, html, pageSize, ...printer };
}

export async function createVoucherTemplateJob(
  documentType: Extract<PrintDocumentType, 'sales-invoice' | 'sales-return' | 'purchase-invoice' | 'purchase-return'>,
  voucherId: number,
  settings: StoreSettings,
  format: PaperWidth,
  isRtl = false,
  qrDataUrl?: string
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
  const profile = settings.printDocumentProfiles?.[documentType]?.[printFormat];
  const template = resolvePrintTemplate(documentType, printFormat, profile?.templateId);
  const data = toVoucherDocumentData(
    documentType,
    payload.context,
    isRtl,
    qrDataUrl,
    settings.multiLanguageInvoices === true
  );
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
