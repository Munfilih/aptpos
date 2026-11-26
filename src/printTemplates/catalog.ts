import type { PaperWidth, StoreSettings } from '../types/pos';
import type {
  PrintDocumentType,
  PrintTemplateDefinition,
  PrintTemplateVariant,
} from './types';

export const PRINT_DOCUMENT_OPTIONS: Array<{ id: PrintDocumentType; label: string }> = [
  { id: 'sales-invoice', label: 'Sales Invoice' },
  { id: 'sales-return', label: 'Sales Return' },
  { id: 'purchase-invoice', label: 'Purchase Invoice' },
  { id: 'purchase-return', label: 'Purchase Return' },
  { id: 'kot', label: 'Kitchen Order Ticket' },
  { id: 'ledger-statement', label: 'Ledger Statement' },
  { id: 'shift-report', label: 'Shift Report' },
  { id: 'saudi-vat-report', label: 'Saudi Tax Report' },
];

const PAPER_FORMATS: PaperWidth[] = ['80mm', '58mm', 'A4'];
const SALES_VARIANTS: Array<{ variant: PrintTemplateVariant; label: string }> = [
  { variant: 'classic', label: 'Classic' },
  { variant: 'minimal', label: 'Minimal' },
  { variant: 'bold', label: 'Bold' },
  { variant: 'bilingual', label: 'Bilingual' },
];
const STANDARD_VARIANTS: Array<{ variant: PrintTemplateVariant; label: string }> = [
  { variant: 'classic', label: 'Classic' },
  { variant: 'minimal', label: 'Minimal' },
];
const KOT_VARIANTS: Array<{ variant: PrintTemplateVariant; label: string }> = [
  { variant: 'kitchen', label: 'Kitchen Standard' },
  { variant: 'kitchen-compact', label: 'Kitchen Compact' },
  { variant: 'kitchen-station', label: 'Kitchen Station' },
];

function createEntries(
  documentType: PrintDocumentType,
  format: PaperWidth,
  variants: Array<{ variant: PrintTemplateVariant; label: string }>
): PrintTemplateDefinition[] {
  return variants.map(({ variant, label }) => ({
    id: `${documentType}-${format.toLowerCase()}-${variant}`,
    documentType,
    format,
    label: `${label} · ${format}`,
    variant,
  }));
}

const voucherTypes: PrintDocumentType[] = [
  'sales-return',
  'purchase-invoice',
  'purchase-return',
];

export const PRINT_TEMPLATE_CATALOG: PrintTemplateDefinition[] = [
  ...PAPER_FORMATS.flatMap((format) => createEntries('sales-invoice', format, SALES_VARIANTS)),
  ...createEntries('sales-invoice', 'A4', [{ variant: 'flyerp', label: 'aptFlyERP Travel' }]),
  ...voucherTypes.flatMap((documentType) =>
    PAPER_FORMATS.flatMap((format) => createEntries(documentType, format, STANDARD_VARIANTS))
  ),
  ...PAPER_FORMATS.flatMap((format) => createEntries('kot', format, KOT_VARIANTS)),
  ...(['80mm', 'A4'] as PaperWidth[]).flatMap((format) =>
    createEntries('ledger-statement', format, [
      { variant: 'ledger-summary', label: 'Summary' },
      { variant: 'ledger-detailed', label: 'Detailed' },
    ])
  ),
  ...(['80mm', '58mm', 'A4'] as PaperWidth[]).flatMap((format) =>
    createEntries('shift-report', format, [
      { variant: 'shift-summary', label: 'Summary' },
      { variant: 'shift-detailed', label: 'Detailed' },
    ])
  ),
  ...createEntries('saudi-vat-report', 'A4', [
    { variant: 'tax-standard', label: 'VAT Summary' },
    { variant: 'tax-compact', label: 'VAT Detail' },
  ]),
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
