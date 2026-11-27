import type { PaperWidth, StoreSettings } from '../types/pos';
import type {
  PrintDocumentType,
  PrintTemplateDefinition,
  PrintTemplateVariant,
} from './types';

export const PRINT_DOCUMENT_OPTIONS: Array<{ id: PrintDocumentType; label: string }> = [
  { id: 'sales-invoice', label: 'Sales Invoice' },
  { id: 'cash-receipt', label: 'Cash Receipt' },
  { id: 'bank-receipt', label: 'Bank Receipt' },
  { id: 'sales-return', label: 'Sales Return' },
  { id: 'purchase-invoice', label: 'Purchase Invoice' },
  { id: 'purchase-return', label: 'Purchase Return' },
  { id: 'kot', label: 'Kitchen Order Ticket' },
  { id: 'ledger-statement', label: 'Ledger Statement' },
  { id: 'shift-report', label: 'Shift Report' },
  { id: 'saudi-vat-report', label: 'Saudi Tax Report' },
];

const PAPER_FORMATS: PaperWidth[] = ['80mm', '58mm', 'A4', 'A5', 'Custom'];

function createDesignEntries(
  documentType: PrintDocumentType,
  formats: PaperWidth[],
  extraVariants: Array<{ format: PaperWidth; variant: PrintTemplateVariant; label: string }> = []
): PrintTemplateDefinition[] {
  const entries: PrintTemplateDefinition[] = [];
  for (const extra of extraVariants) {
    entries.push({
      id: `${documentType}-${extra.format.toLowerCase()}-${extra.variant}`,
      documentType,
      format: extra.format,
      label: `${extra.label} · ${extra.format}`,
      variant: extra.variant,
    });
  }
  for (const format of formats) {
    entries.push(
      {
        id: `${documentType}-${format.toLowerCase()}-modern`,
        documentType,
        format,
        label: `Modern · ${format}`,
        variant: 'classic',
      },
      {
        id: `${documentType}-${format.toLowerCase()}-compact`,
        documentType,
        format,
        label: `Compact · ${format}`,
        variant: 'minimal',
      }
    );
  }
  return entries;
}

export const PRINT_TEMPLATE_CATALOG: PrintTemplateDefinition[] = [
  ...createDesignEntries('sales-invoice', PAPER_FORMATS, [
    { format: 'A4', variant: 'flyerp', label: 'aptFlyERP Travel' },
    { format: 'A5', variant: 'flyerp', label: 'aptFlyERP Travel' },
    { format: 'Custom', variant: 'flyerp', label: 'aptFlyERP Travel' },
  ]),
  ...createDesignEntries('cash-receipt', PAPER_FORMATS, [
    { format: 'A4', variant: 'flyerp', label: 'aptFlyERP Travel' },
    { format: 'A5', variant: 'flyerp', label: 'aptFlyERP Travel' },
    { format: 'Custom', variant: 'flyerp', label: 'aptFlyERP Travel' },
  ]),
  ...createDesignEntries('bank-receipt', PAPER_FORMATS, [
    { format: 'A4', variant: 'flyerp', label: 'aptFlyERP Travel' },
    { format: 'A5', variant: 'flyerp', label: 'aptFlyERP Travel' },
    { format: 'Custom', variant: 'flyerp', label: 'aptFlyERP Travel' },
  ]),
  ...createDesignEntries('sales-return', PAPER_FORMATS),
  ...createDesignEntries('purchase-invoice', PAPER_FORMATS),
  ...createDesignEntries('purchase-return', PAPER_FORMATS),
  ...createDesignEntries('kot', PAPER_FORMATS),
  ...createDesignEntries('ledger-statement', ['80mm', '58mm', 'A4', 'A5', 'Custom']),
  ...createDesignEntries('shift-report', PAPER_FORMATS),
  ...createDesignEntries('saudi-vat-report', ['A4', 'A5', 'Custom']),
];

export function getPrintTemplates(
  documentType: PrintDocumentType,
  format: PaperWidth
): PrintTemplateDefinition[] {
  return PRINT_TEMPLATE_CATALOG.filter(
    (template) => template.documentType === documentType && template.format === format
  );
}

export function getPrintFormats(documentType: PrintDocumentType): PaperWidth[] {
  return Array.from(new Set(
    PRINT_TEMPLATE_CATALOG
      .filter((template) => template.documentType === documentType)
      .map((template) => template.format)
  ));
}

export function getPrintDocumentFormat(
  settings: Pick<StoreSettings, 'paperWidth' | 'printDocumentFormats'>,
  documentType: PrintDocumentType,
  fallback?: PaperWidth
): PaperWidth {
  const formats = getPrintFormats(documentType);
  const configured = settings.printDocumentFormats?.[documentType];
  if (configured && formats.includes(configured)) return configured;
  if (fallback && formats.includes(fallback)) return fallback;
  const defaultFormat = settings.paperWidth;
  if (defaultFormat && formats.includes(defaultFormat)) return defaultFormat;
  if (formats.length === 0) {
    throw new Error(`No print format is registered for ${documentType}.`);
  }
  return formats[0];
}

export function getDefaultPrintTemplate(
  documentType: PrintDocumentType,
  format: PaperWidth
): PrintTemplateDefinition {
  const templates = getPrintTemplates(documentType, format);
  if (templates.length === 0) {
    throw new Error(`No print template is registered for ${documentType} (${format}).`);
  }
  return templates[0];
}

export function resolvePrintTemplate(
  documentType: PrintDocumentType,
  format: PaperWidth,
  templateId?: string
): PrintTemplateDefinition {
  const templates = getPrintTemplates(documentType, format);
  const selected = templates.find((template) => template.id === templateId);
  return selected || getDefaultPrintTemplate(documentType, format);
}
