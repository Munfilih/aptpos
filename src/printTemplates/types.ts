import type { PaperWidth, PrintDocumentType } from '../types/pos';
export type { PrintDocumentType } from '../types/pos';

export type PrintTemplateVariant =
  | 'classic'
  | 'minimal'
  | 'bold'
  | 'bilingual'
  | 'kitchen'
  | 'kitchen-compact'
  | 'kitchen-station'
  | 'ledger-summary'
  | 'ledger-detailed'
  | 'tax-standard'
  | 'tax-compact'
  | 'shift-summary'
  | 'shift-detailed'
  | 'flyerp';

export interface PrintDocumentField {
  label: string;
  value: string;
}

export interface PrintDocumentRow {
  values: string[];
  emphasis?: boolean;
}

export interface PrintDocumentData {
  documentType: PrintDocumentType;
  title: string;
  number?: string;
  date?: string;
  companyName: string;
  companyNameAr?: string;
  companyAddress?: string;
  companyBuildingNo?: string;
  companyStreetName?: string;
  companyDistrict?: string;
  companyCity?: string;
  companyPostalCode?: string;
  companyCountry?: string;
  companyPhone?: string;
  companyTaxId?: string;
  companyCrNumber?: string;
  companyLogo?: string;
  logoSizeMm?: number;
  fields: PrintDocumentField[];
  columns: string[];
  numericColumns?: number[];
  rows: PrintDocumentRow[];
  totals: PrintDocumentField[];
  pendingBalance?: string;
  multiLanguage?: boolean;
  enableEnglish?: boolean;
  enableArabic?: boolean;
  compactPartyDetails?: boolean;
  footer?: string;
  qrDataUrl?: string;
  qrSizeMm?: number;
  direction?: 'ltr' | 'rtl';
}

export interface PrintTemplateDefinition {
  id: string;
  documentType: PrintDocumentType;
  format: PaperWidth;
  label: string;
  variant: PrintTemplateVariant;
}

export interface PrintTemplateJob {
  template: PrintTemplateDefinition;
  html: string;
  pageSize: { width: number; height: number };
  printerName?: string;
  silent: boolean;
}
