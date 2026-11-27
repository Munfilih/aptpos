import React from 'react';
import type { PrintDataContext } from '../utils/voucherPrintData';
import { formatPrintField } from '../utils/voucherPrintData';
import {
  formatFlyErpServiceDetailValue,
  formatFlyErpServiceDetails,
  parseFlyErpServiceDetails,
} from '../utils/flyErpServices';
import type { FlyErpServiceDetailKey } from '../utils/flyErpServices';
import { DocumentTemplate } from './DocumentTemplate';
import type {
  PrintDocumentData,
  PrintDocumentRow,
  PrintTemplateDefinition,
} from './types';

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
  paymentStatus: 'Payment Status',
  taxStatus: 'Tax status',
  sourceInvoices: 'Source Invoices',
  receivedDate: 'Received',
  invoiceNumber: 'Invoice',
  notes: 'Notes',
};

const FIELD_LABELS_AR: Record<string, string> = {
  customerName: 'العميل',
  customerNameAr: 'اسم العميل بالعربية',
  customerPhone: 'هاتف العميل',
  customerEmail: 'البريد الإلكتروني للعميل',
  customerAddress: 'عنوان العميل',
  customerBuildingNo: 'رقم المبنى',
  customerStreetName: 'الشارع',
  customerDistrict: 'الحي',
  customerCity: 'المدينة',
  customerPostalCode: 'الرمز البريدي',
  customerCountry: 'الدولة',
  customerVatNumber: 'الرقم الضريبي للعميل',
  customerCrNumber: 'السجل التجاري للعميل',
  vendorName: 'المورد',
  cashierName: 'الكاشير',
  paymentMethod: 'طريقة الدفع',
  paymentStatus: 'حالة الدفع',
  taxStatus: 'حالة الضريبة',
  sourceInvoices: 'فواتير المصدر',
  receivedDate: 'تاريخ الاستلام',
  invoiceNumber: 'رقم الفاتورة',
  notes: 'ملاحظات',
};

const PAYMENT_STATUS_LABELS: Record<string, readonly [string, string]> = {
  paid: ['Paid', 'مدفوع'],
  'partially-paid': ['Partially Paid', 'مدفوع جزئياً'],
  unpaid: ['Unpaid', 'غير مدفوع'],
};

const INVOICE_TAX_STATUS_LABELS: Record<string, readonly [string, string]> = {
  included: ['This invoice is tax included', 'الضريبة مشمولة في هذه الفاتورة'],
  excluded: ['This invoice is tax excluded', 'هذه الفاتورة غير شاملة للضريبة'],
};

const TOTAL_LABELS: Record<string, string> = {
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'VAT',
  shipping: 'Shipping',
  total: 'Total',
  paid: 'Paid',
  amountTendered: 'Amount Tendered',
  amountPaid: 'Paid Amount',
  balanceDue: 'Balance Due',
  balance: 'Balance',
  changeDue: 'Change Due',
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
  amountTendered: 'المبلغ المستلم',
  amountPaid: 'المبلغ المدفوع',
  balanceDue: 'الرصيد المستحق',
  balance: 'الرصيد',
  changeDue: 'الباقي',
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

const FLYERP_SERVICE_DETAIL_FIELDS: Array<{
  key: FlyErpServiceDetailKey;
  label: string;
  labelAr: string;
}> = [
  { key: 'passenger', label: 'Passenger', labelAr: 'المسافر' },
  { key: 'passport', label: 'Passport / ID', labelAr: 'رقم الجواز / الهوية' },
  { key: 'pnr', label: 'PNR', labelAr: 'رقم الحجز' },
  { key: 'flight', label: 'Flight', labelAr: 'رقم الرحلة' },
  { key: 'origin', label: 'From', labelAr: 'من' },
  { key: 'destination', label: 'To', labelAr: 'إلى' },
  { key: 'tripType', label: 'Trip Type', labelAr: 'نوع الرحلة' },
  { key: 'travelDate', label: 'Travel Date', labelAr: 'تاريخ السفر' },
  { key: 'returnFlight', label: 'Return Flight', labelAr: 'رحلة العودة' },
  { key: 'returnDate', label: 'Return Date', labelAr: 'تاريخ العودة' },
];

const FLYERP_INVOICE_FIELDS: Array<{ key: string; label: string; format?: string }> = [
  { key: 'serialNumber', label: 'Sl No.' },
  { key: 'name', label: 'Service' },
  ...FLYERP_SERVICE_DETAIL_FIELDS.map(({ key, label }) => ({ key, label })),
  { key: 'unitPrice', label: 'Rate', format: 'currency' },
  { key: 'tax', label: 'Tax', format: 'currency' },
  { key: 'total', label: 'Amount', format: 'currency' },
];

const ITEM_LABELS_AR: Record<string, string> = {
  '#': '#',
  'Sl No.': 'م',
  Item: 'الصنف',
  Service: 'الخدمة',
  Passenger: 'المسافر',
  'Passport / ID': 'رقم الجواز / الهوية',
  PNR: 'رقم الحجز',
  Flight: 'رقم الرحلة',
  'VAT Included': 'ضريبة القيمة المضافة مشمولة',
  From: 'من',
  To: 'إلى',
  'Trip Type': 'نوع الرحلة',
  'Travel Date': 'تاريخ السفر',
  'Return Flight': 'رحلة العودة',
  'Return Date': 'تاريخ العودة',
  Qty: 'الكمية',
  Price: 'السعر',
  Rate: 'السعر',
  Tax: 'الضريبة',
  Total: 'الإجمالي',
  Amount: 'المبلغ',
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
  multiLanguage = false,
  options: {
    includeArabicCompanyName?: boolean;
    includePartyDetails?: boolean;
    isFlyErp?: boolean;
    pendingBalance?: number;
  } = {}
): PrintDocumentData {
  const {
    includeArabicCompanyName = false,
    includePartyDetails = false,
    isFlyErp = false,
    pendingBalance = 0,
  } = options;
  const documentTitle = DOCUMENT_TITLES[documentType] || 'Voucher';
  const isDraft = Boolean(context.voucher.isDraft);
  const customerVatNumber = asText(context.party.vatNumber).trim();
  const salesInvoiceTitle = isDraft
    ? localizeLabel('Sales Draft', 'مسودة مبيعات', isRtl, multiLanguage)
    : customerVatNumber.length > 0
      ? localizeLabel('Sales Tax Invoice', 'فاتورة ضريبية للمبيعات', isRtl, multiLanguage)
      : localizeLabel('Simplified Tax Invoice', 'فاتورة ضريبية مبسطة', isRtl, multiLanguage);
  const voucherFields = Object.entries(context.voucher)
    .filter(([key, value]) =>
      key !== 'number' &&
      key !== 'date' &&
      key !== 'isDraft' &&
      key !== 'customer' &&
      key !== 'vendor' &&
      key !== 'eInvoiceQrCodePhase1' &&
      key !== 'eInvoiceQrCodePhase2' &&
      value !== undefined &&
      value !== null &&
      value !== '' &&
      typeof value !== 'object'
    )
    .map(([key, value]) => {
      const paymentStatus = key === 'paymentStatus' && typeof value === 'string'
        ? PAYMENT_STATUS_LABELS[value]
        : undefined;
      const taxStatus = key === 'taxStatus' && typeof value === 'string'
        ? INVOICE_TAX_STATUS_LABELS[value]
        : undefined;
      return {
        label: localizeLabel(FIELD_LABELS[key] || key, FIELD_LABELS_AR[key], isRtl, multiLanguage),
        value: taxStatus
          ? localizeLabel(taxStatus[0], taxStatus[1], isRtl, multiLanguage)
          : paymentStatus
            ? localizeLabel(paymentStatus[0], paymentStatus[1], isRtl, multiLanguage)
            : asText(value),
      };
    });
  const customerFieldLabels: Array<{ key: string; label: string; labelAr: string }> = [
    { key: 'nameAr', label: 'Customer Arabic Name', labelAr: FIELD_LABELS_AR.customerNameAr },
    { key: 'phone', label: 'Customer Phone', labelAr: FIELD_LABELS_AR.customerPhone },
    { key: 'email', label: 'Customer Email', labelAr: FIELD_LABELS_AR.customerEmail },
    { key: 'address', label: 'Customer Address', labelAr: FIELD_LABELS_AR.customerAddress },
    { key: 'buildingNo', label: 'Building No.', labelAr: FIELD_LABELS_AR.customerBuildingNo },
    { key: 'streetName', label: 'Street', labelAr: FIELD_LABELS_AR.customerStreetName },
    { key: 'district', label: 'District', labelAr: FIELD_LABELS_AR.customerDistrict },
    { key: 'city', label: 'City', labelAr: FIELD_LABELS_AR.customerCity },
    { key: 'postalCode', label: 'Postal Code', labelAr: FIELD_LABELS_AR.customerPostalCode },
    { key: 'country', label: 'Country', labelAr: FIELD_LABELS_AR.customerCountry },
    { key: 'vatNumber', label: 'Customer VAT No.', labelAr: FIELD_LABELS_AR.customerVatNumber },
    { key: 'crNumber', label: 'Customer CR No.', labelAr: FIELD_LABELS_AR.customerCrNumber },
  ];
  const customerFields = includePartyDetails
    ? customerFieldLabels.flatMap(({ key, label, labelAr }) => {
        const value = context.party[key];
        if (typeof value !== 'string' || !value.trim()) return [];
        return [{
          label: localizeLabel(label, labelAr, isRtl, multiLanguage),
          value: value.trim(),
        }];
      })
    : [];

  const isFlyErpInvoice = Boolean(isFlyErp) && documentType === 'sales-invoice';
  const parsedServiceDetails = isFlyErpInvoice
    ? context.items.map((item) => parseFlyErpServiceDetails(asText(item.description)))
    : [];
  const itemFields = isFlyErpInvoice
    ? FLYERP_INVOICE_FIELDS
        .map((field) => field.key === 'tax' && context.voucher.taxStatus === 'included'
          ? { ...field, label: 'VAT Included' }
          : field)
        .filter(({ key }) => {
        const detailKey = FLYERP_SERVICE_DETAIL_FIELDS.find((field) => field.key === key)?.key;
        return !detailKey ||
          detailKey === 'pnr' ||
          detailKey === 'travelDate' ||
          parsedServiceDetails.some(({ values }) => Boolean(values[detailKey]?.trim()));
      })
    : ITEM_FIELDS[documentType] || ITEM_FIELDS['sales-invoice'];
  const flyErpDetailKeys = new Set(FLYERP_SERVICE_DETAIL_FIELDS.map(({ key }) => key));
  const rows: PrintDocumentRow[] = context.items.map((item, itemIndex) => {
    const parsedDetails = parsedServiceDetails[itemIndex];
    return {
      values: itemFields.map(({ key, format }) => {
        const itemNameAr = typeof item.nameAr === 'string' ? item.nameAr : '';
        const value = key === 'name'
          ? [
              multiLanguage && itemNameAr
                ? `${asText(item.name)} / ${itemNameAr}`
                : isRtl && itemNameAr
                  ? itemNameAr
                  : asText(item.name),
              isFlyErpInvoice
                ? parsedDetails?.notes.join('\n') || ''
                : documentType === 'sales-invoice'
                  ? formatFlyErpServiceDetails(asText(item.description))
                  : '',
            ].filter(Boolean).join('\n')
          : flyErpDetailKeys.has(key as FlyErpServiceDetailKey)
            ? (() => {
                const detailKey = key as FlyErpServiceDetailKey;
                const detailValue = parsedDetails?.values[detailKey] || '';
                return formatFlyErpServiceDetailValue(detailKey, detailValue);
              })()
            : item[key];
        return formatPrintField(value, {
          format,
          currencySymbol: asText(context.company.currencySymbol) || 'SAR',
          decimalPlaces: Number(context.company.decimalPoints) || 2,
        });
      }),
    };
  });
  const totals = Object.entries(context.totals)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .map(([key, value]) => {
      const taxIsIncluded = isFlyErpInvoice &&
        key === 'tax' &&
        context.voucher.taxStatus === 'included';
      return {
        label: taxIsIncluded
          ? localizeLabel('VAT Included', ITEM_LABELS_AR['VAT Included'], isRtl, multiLanguage)
          : localizeLabel(TOTAL_LABELS[key] || key, TOTAL_LABELS_AR[key], isRtl, multiLanguage),
        value: formatPrintField(value, {
          format: typeof value === 'number' ? 'currency' : undefined,
          currencySymbol: asText(context.company.currencySymbol) || 'SAR',
          decimalPlaces: Number(context.company.decimalPoints) || 2,
        }),
      };
    });
  const formattedPendingBalance = pendingBalance > 0
    ? formatPrintField(pendingBalance, {
        format: 'currency',
        currencySymbol: asText(context.company.currencySymbol) || 'SAR',
        decimalPlaces: Number(context.company.decimalPoints) || 2,
      })
    : undefined;
  return {
    documentType,
    title: documentType === 'sales-invoice'
      ? salesInvoiceTitle
      : localizeLabel(documentTitle, DOCUMENT_TITLES_AR[documentType], isRtl, multiLanguage),
    number: asText(context.voucher.number),
    date: asText(context.voucher.date),
    companyName: asText(context.company.storeName),
    companyNameAr: multiLanguage || isRtl || includeArabicCompanyName
      ? asText(context.company.storeNameAr)
      : undefined,
    companyAddress: asText(context.company.address),
    companyBuildingNo: asText(context.company.buildingNo),
    companyStreetName: asText(context.company.streetName),
    companyDistrict: asText(context.company.district),
    companyCity: asText(context.company.city),
    companyPostalCode: asText(context.company.postalCode),
    companyCountry: asText(context.company.country),
    companyPhone: asText(context.company.phone),
    companyTaxId: asText(context.company.taxId),
    companyCrNumber: asText(context.company.crNumber),
    companyLogo: asText(context.company.logo) || undefined,
    fields: [...voucherFields, ...customerFields],
    columns: itemFields.map((field) =>
      localizeLabel(field.label, ITEM_LABELS_AR[field.label], isRtl, multiLanguage)
    ),
    numericColumns: itemFields
      .map((field, index) => field.format ? index : -1)
      .filter((index) => index >= 0),
    rows,
    totals,
    pendingBalance: formattedPendingBalance,
    multiLanguage,
    footer: (() => {
      const enFooter = asText(context.company.receiptFooter);
      const arFooter = asText(context.company.receiptFooterAr);
      if (enFooter || arFooter) {
        if (multiLanguage && enFooter && arFooter) return `${enFooter} · ${arFooter}`;
        return isRtl ? (arFooter || enFooter) : (enFooter || arFooter);
      }
      return localizeLabel(
        'Thank you for your business',
        'شكراً لتعاملكم معنا',
        isRtl,
        multiLanguage
      );
    })(),
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
