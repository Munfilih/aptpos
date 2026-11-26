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

function asText(value: unknown): string {
  return formatPrintField(value);
}

export function toVoucherDocumentData(
  documentType: PrintTemplateDefinition['documentType'],
  context: PrintDataContext,
  isRtl = false,
  qrDataUrl?: string
): PrintDocumentData {
  const voucherFields = Object.entries(context.voucher)
    .filter(([key, value]) => key !== 'number' && key !== 'date' && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({
      label: FIELD_LABELS[key] || key,
      value: asText(value),
    }));

  const itemFields = ITEM_FIELDS[documentType] || ITEM_FIELDS['sales-invoice'];
  const rows: PrintDocumentRow[] = context.items.map((item) => ({
    values: itemFields.map(({ key, format }) =>
      formatPrintField(item[key], {
        format,
        currencySymbol: asText(context.company.currencySymbol) || 'SAR',
        decimalPlaces: Number(context.company.decimalPoints) || 2,
      })
    ),
  }));
  const totals = Object.entries(context.totals)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .map(([key, value]) => ({
      label: TOTAL_LABELS[key] || key,
      value: formatPrintField(value, {
        format: typeof value === 'number' ? 'currency' : undefined,
        currencySymbol: asText(context.company.currencySymbol) || 'SAR',
        decimalPlaces: Number(context.company.decimalPoints) || 2,
      }),
    }));

  return {
    documentType,
    title: DOCUMENT_TITLES[documentType] || 'Voucher',
    number: asText(context.voucher.number),
    date: asText(context.voucher.date),
    companyName: asText(context.company.storeName),
    companyNameAr: asText(context.company.storeNameAr),
    companyAddress: asText(context.company.address),
    companyPhone: asText(context.company.phone),
    companyTaxId: asText(context.company.taxId),
    companyLogo: asText(context.company.logo) || undefined,
    fields: voucherFields,
    columns: itemFields.map((field) => field.label),
    rows,
    totals,
    footer: isRtl ? 'شكراً لتعاملكم معنا' : 'Thank you for your business',
    qrDataUrl,
    direction: isRtl ? 'rtl' : 'ltr',
  };
}

export const VoucherTemplate: React.FC<{
  data: PrintDocumentData;
  template: PrintTemplateDefinition;
}> = ({ data, template }) => (
  <DocumentTemplate data={data} format={template.format} variant={template.variant} />
);
