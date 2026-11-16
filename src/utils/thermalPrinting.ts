import type { InvoiceMarginsMm, PaperWidth } from '../types/pos';

export interface ThermalPageSize {
  width: number;
  height: number;
}

export const MINIMUM_INVOICE_MARGIN_MM: Record<PaperWidth, number> = {
  '80mm': 3,
  '58mm': 2,
  A4: 5,
};

export function resolveInvoiceMarginsMm(
  format: PaperWidth,
  configured?: Partial<InvoiceMarginsMm>
): InvoiceMarginsMm {
  const minimum = MINIMUM_INVOICE_MARGIN_MM[format];
  const resolveMargin = (value: number | undefined, marginMinimum = minimum) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(20, Math.max(marginMinimum, value))
      : marginMinimum;

  return {
    top: resolveMargin(configured?.top, format === '80mm' ? 0 : minimum),
    right: resolveMargin(configured?.right),
    bottom: resolveMargin(configured?.bottom),
    left: resolveMargin(configured?.left),
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
      height: Math.ceil((heightPx * 25_400) / 96) + 1000,
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

export function printWithThermalPageSize(pageSize: ThermalPageSize): void {
  const widthMm = pageSize.width / 1000;
  const heightMm = pageSize.height / 1000;
  const pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
  document.head.appendChild(pageStyle);

  const cleanup = () => {
    pageStyle.remove();
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
