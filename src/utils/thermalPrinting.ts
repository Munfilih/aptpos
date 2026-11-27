import type { InvoiceMarginsMm, PaperWidth } from '../types/pos';

export interface ThermalPageSize {
  width: number;
  height: number;
}

export const MINIMUM_INVOICE_MARGIN_MM: Record<PaperWidth, number> = {
  '80mm': 2,
  '58mm': 1,
  A4: 5,
  A5: 5,
  Custom: 5,
};

export function resolveInvoiceMarginsMm(
  format: PaperWidth,
  configured?: Partial<InvoiceMarginsMm>
): InvoiceMarginsMm {
  const defaultMargin = MINIMUM_INVOICE_MARGIN_MM[format];
  const resolveMargin = (value: number | undefined, fallback = defaultMargin) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : fallback;

  return {
    top: resolveMargin(configured?.top, defaultMargin),
    right: resolveMargin(configured?.right, defaultMargin),
    bottom: resolveMargin(configured?.bottom, defaultMargin),
    left: resolveMargin(configured?.left, defaultMargin),
  };
}

interface MeasureThermalPageSizeOptions {
  elementWidthMm: number;
  pageWidthMm: number;
  padding: string;
  container?: HTMLElement | null;
}

export function measureThermalPageSize(
  element: HTMLElement | null,
  options: MeasureThermalPageSizeOptions
): ThermalPageSize {
  if (!element) throw new Error('The thermal print content is unavailable.');

  const originalElementStyle = element.getAttribute('style');
  const originalContainerStyle = options.container?.getAttribute('style') ?? null;

  try {
    options.container?.style.setProperty('display', 'block', 'important');
    element.style.setProperty('display', 'block', 'important');
    element.style.setProperty('position', 'static', 'important');
    element.style.setProperty('inset', 'auto', 'important');
    element.style.setProperty('width', `${options.elementWidthMm}mm`, 'important');
    element.style.setProperty('max-width', `${options.elementWidthMm}mm`, 'important');
    element.style.setProperty('height', 'auto', 'important');
    element.style.setProperty('margin', '0', 'important');
    element.style.setProperty('padding', options.padding, 'important');
    element.style.setProperty('border', '0', 'important');
    element.style.setProperty('box-shadow', 'none', 'important');
    element.style.setProperty('box-sizing', 'border-box', 'important');
    element.style.setProperty('overflow', 'visible', 'important');

    const heightPx = element.getBoundingClientRect().height;
    if (!Number.isFinite(heightPx) || heightPx <= 0) {
      throw new Error('Could not measure the thermal print content.');
    }

    return {
      width: Math.round(options.pageWidthMm * 1000),
      // 4000 microns (4mm) safety margin prevents Chromium from splitting into a 2nd page
      // due to DPI rounding, font metrics differences, or cutter distance
      height: Math.ceil((heightPx * 25_400) / 96) + 4000,
    };
  } finally {
    if (originalElementStyle === null) element.removeAttribute('style');
    else element.setAttribute('style', originalElementStyle);

    if (options.container) {
      if (originalContainerStyle === null) options.container.removeAttribute('style');
      else options.container.setAttribute('style', originalContainerStyle);
    }
  }
}

export function applyThermalPageSize(pageSize: ThermalPageSize): () => void {
  const widthMm = pageSize.width / 1000;
  const heightMm = pageSize.height / 1000;
  const pageStyle = document.createElement('style');
  pageStyle.id = 'thermal-page-style';
  pageStyle.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
  document.head.appendChild(pageStyle);

  return () => pageStyle.remove();
}

export function applyThermalPageWidth(widthMm: 58 | 80): () => void {
  const pageStyle = document.createElement('style');
  pageStyle.id = 'thermal-page-style';
  // CSS @page size does not support "<length> auto". Default to continuous roll height.
  pageStyle.textContent = `@page { size: ${widthMm}mm 297mm; margin: 0; }`;
  document.head.appendChild(pageStyle);

  return () => pageStyle.remove();
}

export function waitPrintSettlingDelay(ms = 600): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BuildStandalonePrintHtmlOptions {
  widthMm: number;
  pageSize: ThermalPageSize;
  padding?: string;
}

/**
 * Builds a self-contained HTML document containing only the print target element
 * and active app styles so Electron can print it in an isolated hidden window
 * without any main-window layout, modal, or visibility:hidden displacement.
 */
export function buildStandaloneThermalPrintHtml(
  element: HTMLElement | null,
  options: BuildStandalonePrintHtmlOptions
): string {
  if (!element) throw new Error('The thermal print content is unavailable.');

  const collectedCss: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (rules) {
        for (const rule of Array.from(rules)) {
          collectedCss.push(rule.cssText);
        }
      }
    } catch {
      // Cross-origin stylesheets (e.g. external fonts) cannot be read via cssRules.
    }
  }

  const clone = element.cloneNode(true) as HTMLElement;
  const isA4 = options.widthMm >= 200;

  clone.style.setProperty('display', 'block', 'important');
  clone.style.setProperty('position', 'static', 'important');
  clone.style.setProperty('inset', 'auto', 'important');
  clone.style.setProperty('width', `${options.widthMm}mm`, 'important');
  clone.style.setProperty('max-width', isA4 ? 'none' : `${options.widthMm}mm`, 'important');
  clone.style.setProperty('height', 'auto', 'important');
  clone.style.setProperty('min-height', '0', 'important');
  clone.style.setProperty('max-height', 'none', 'important');
  clone.style.setProperty('margin', '0', 'important');
  if (isA4) {
    clone.style.setProperty('padding', '0', 'important');
  } else if (options.padding) {
    clone.style.setProperty('padding', options.padding, 'important');
  }
  clone.style.setProperty('border', '0', 'important');
  clone.style.setProperty('box-shadow', 'none', 'important');
  clone.style.setProperty('box-sizing', 'border-box', 'important');
  clone.style.setProperty('overflow', 'visible', 'important');
  clone.style.setProperty('transform', 'none', 'important');

  const pageWidthMm = options.pageSize.width / 1000;
  const pageHeightMm = options.pageSize.height / 1000;
  const pageSizeRule = isA4 ? 'A4 portrait' : `${pageWidthMm}mm ${pageHeightMm}mm`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${collectedCss.join('\n')}</style>
    <style>
      @page {
        size: ${pageSizeRule};
        margin: 0;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: ${options.widthMm}mm !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        background: #ffffff !important;
        color: #000000 !important;
        overflow: visible !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body * {
        visibility: visible !important;
      }
      .no-print {
        display: none !important;
      }
    </style>
  </head>
  <body>${clone.outerHTML}</body>
</html>`;
}

export function printWithThermalPageSize(pageSize: ThermalPageSize): void {
  const removePageStyle = applyThermalPageSize(pageSize);
  const cleanup = () => {
    removePageStyle();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
