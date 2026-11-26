import React from 'react';
import type { PrintDataContext } from '../utils/voucherPrintData';
import { formatPrintField } from '../utils/voucherPrintData';
import { DocumentTemplate } from './DocumentTemplate';
import type { PrintDocumentData, PrintDocumentRow, PrintTemplateDefinition } from './types';

const DOCUMENT_TITLES: Record<string, string> = {
  'sales-invoice': 'Sales Invoice',
  'sales-return': 'Sales Return',
  'purchase-invoice': 'Purchase Invoice',
  'purchase-return': 'Purchase Return',
};

const DOCUMENT_TITLES_AR: Record<string, string> = {
  'sales-invoice': 'فاتورة مبيعات',
  'sales-return': 'مرتجع مبيعات',
  'purchase-invoice': 'فاتورة مشتريات',
  'purchase-return': 'مرتجع مشتريات',
};

const FIELD_LABELS: Record<string, string> = {
  customerName: 'Customer',
  vendorName: 'Supplier',
  cashierName: 'Cashier',
  paymentMethod: 'Payment',
  sourceInvoices: 'Source Invoices',
  receivedDate: 'Received',
  invoiceNumber: 'Invoice',
  notes: 'Notes',
};

const FIELD_LABELS_AR: Record<string, string> = {
  customerName: 'العميل',
  vendorName: 'المورد',
  cashierName: 'الكاشير',
  paymentMethod: 'طريقة الدفع',
  sourceInvoices: 'فواتير المصدر',
  receivedDate: 'تاريخ الاستلام',
  invoiceNumber: 'رقم الفاتورة',
  notes: 'ملاحظات',
};

const TOTAL_LABELS: Record<string, string> = {
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'VAT',
  shipping: 'Shipping',
  total: 'Total',
  paid: 'Paid',
  balance: 'Balance',
  refund: 'Refund',
  taxRefund: 'VAT Refunded',
  totalRefund: 'Total Refunded',
};

const TOTAL_LABELS_AR: Record<string, string> = {
  subtotal: 'المجموع الفرعي',
  discount: 'الخصم',
  tax: 'ضريبة القيمة المضافة',
  shipping: 'الشحن',
  total: 'الإجمالي',
  paid: 'المدفوع',
  balance: 'الرصيد',
  refund: 'المبلغ المسترد',
  taxRefund: 'الضريبة المستردة',
  totalRefund: 'إجمالي المبلغ المسترد',
};

const ITEM_FIELDS: Record<string, Array<{ key: string; label: string; format?: string }>> = {
  'sales-invoice': [
    { key: 'serialNumber', label: '#' },
    { key: 'name', label: 'Item' },
    { key: 'quantity', label: 'Qty', format: 'number:2' },
    { key: 'unitPrice', label: 'Price', format: 'currency' },
    { key: 'tax', label: 'Tax', format: 'currency' },
    { key: 'total', label: 'Total', format: 'currency' },
  ],
  'sales-return': [
    { key: 'serialNumber', label: '#' },
    { key: 'name', label: 'Item' },
    { key: 'quantity', label: 'Qty', format: 'number:2' },
    { key: 'refundAmount', label: 'Refund', format: 'currency' },
  ],
  'purchase-invoice': [
    { key: 'serialNumber', label: '#' },
    { key: 'name', label: 'Item' },
    { key: 'quantity', label: 'Qty', format: 'number:2' },
    { key: 'unitCost', label: 'Cost', format: 'currency' },
    { key: 'total', label: 'Total', format: 'currency' },
  ],
  'purchase-return': [
    { key: 'serialNumber', label: '#' },
    { key: 'name', label: 'Item' },
    { key: 'quantity', label: 'Qty', format: 'number:2' },
    { key: 'unitCost', label: 'Cost', format: 'currency' },
    { key: 'total', label: 'Total', format: 'currency' },
  ],
};

const ITEM_LABELS_AR: Record<string, string> = {
  '#': '#',
  Item: 'الصنف',
  Qty: 'الكمية',
  Price: 'السعر',
  Tax: 'الضريبة',
  Total: 'الإجمالي',
  Refund: 'المسترد',
  Cost: 'التكلفة',
};

function asText(value: unknown): string {
  return formatPrintField(value);
}

function localizeLabel(english: string, arabic: string | undefined, isRtl: boolean, multiLanguage: boolean): string {
  if (multiLanguage && arabic) return `${english} / ${arabic}`;
  return isRtl && arabic ? arabic : english;
}

export function toVoucherDocumentData(
  documentType: PrintTemplateDefinition['documentType'],
  context: PrintDataContext,
  isRtl = false,
  qrDataUrl?: string,
  multiLanguage = false
): PrintDocumentData {
  const documentTitle = DOCUMENT_TITLES[documentType] || 'Voucher';
  const voucherFields = Object.entries(context.voucher)
    .filter(([key, value]) => key !== 'number' && key !== 'date' && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({
      label: localizeLabel(FIELD_LABELS[key] || key, FIELD_LABELS_AR[key], isRtl, multiLanguage),
      value: asText(value),
    }));

  const itemFields = ITEM_FIELDS[documentType] || ITEM_FIELDS['sales-invoice'];
  const rows: PrintDocumentRow[] = context.items.map((item) => ({
    values: itemFields.map(({ key, format }) => {
      const itemNameAr = typeof item.nameAr === 'string' ? item.nameAr : '';
      const value = key === 'name'
        ? multiLanguage && itemNameAr
          ? `${asText(item.name)} / ${itemNameAr}`
          : isRtl && itemNameAr
            ? itemNameAr
            : item.name
        : item[key];
      return formatPrintField(value, {
        format,
        currencySymbol: asText(context.company.currencySymbol) || 'SAR',
        decimalPlaces: Number(context.company.decimalPoints) || 2,
      });
    }),
  }));
  const totals = Object.entries(context.totals)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .map(([key, value]) => ({
      label: localizeLabel(TOTAL_LABELS[key] || key, TOTAL_LABELS_AR[key], isRtl, multiLanguage),
      value: formatPrintField(value, {
        format: typeof value === 'number' ? 'currency' : undefined,
        currencySymbol: asText(context.company.currencySymbol) || 'SAR',
        decimalPlaces: Number(context.company.decimalPoints) || 2,
      }),
    }));

  return {
    documentType,
    title: localizeLabel(documentTitle, DOCUMENT_TITLES_AR[documentType], isRtl, multiLanguage),
    number: asText(context.voucher.number),
    date: asText(context.voucher.date),
    companyName: asText(context.company.storeName),
    companyNameAr: multiLanguage || isRtl ? asText(context.company.storeNameAr) : undefined,
    companyAddress: asText(context.company.address),
    companyPhone: asText(context.company.phone),
    companyTaxId: asText(context.company.taxId),
    companyLogo: asText(context.company.logo) || undefined,
    fields: voucherFields,
    columns: itemFields.map((field) =>
      localizeLabel(field.label, ITEM_LABELS_AR[field.label], isRtl, multiLanguage)
    ),
    numericColumns: itemFields
      .map((field, index) => field.format ? index : -1)
      .filter((index) => index >= 0),
    rows,
    totals,
    multiLanguage,
    footer: localizeLabel(
      'Thank you for your business',
      'شكراً لتعاملكم معنا',
      isRtl,
      multiLanguage
    ),
    qrDataUrl,
    direction: isRtl && !multiLanguage ? 'rtl' : 'ltr',
  };
}

export const VoucherTemplate: React.FC<{
  data: PrintDocumentData;
  template: PrintTemplateDefinition;
}> = ({ data, template }) => (
  <DocumentTemplate data={data} format={template.format} variant={template.variant} />
);
