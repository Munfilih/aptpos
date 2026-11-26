import type {
  Customer,
  PurchaseEntry,
  PurchaseReturnVoucher,
  Sale,
  SalesReturnVoucher,
  StoreSettings,
  Vendor,
} from '../types/pos';
import { getInvoiceDateTime } from './dateFilters';
import { getSaleAppliedPayment, getSaleBalanceDue } from './saleBalances';
import { generateZatcaTlvBase64 } from './zatcaQr';

export interface PrintDataContext {
  voucher: Record<string, unknown>;
  party: Record<string, unknown>;
  company: Record<string, unknown>;
  totals: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
}

function companyData(settings: StoreSettings): Record<string, unknown> {
  return {
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
  };
}

function customerData(customer?: Customer): Record<string, unknown> {
  return {
    name: customer?.name,
    nameAr: customer?.nameAr,
    phone: customer?.phone,
    email: customer?.email,
    address: customer?.address,
    buildingNo: customer?.buildingNo,
    streetName: customer?.streetName,
    district: customer?.district,
    city: customer?.city,
    postalCode: customer?.postalCode,
    country: customer?.country,
    vatNumber: customer?.vatNumber,
    crNumber: customer?.crNumber,
  };
}

function vendorData(vendor?: Vendor): Record<string, unknown> {
  return {
    name: vendor?.name,
    phone: vendor?.phone,
    email: vendor?.email,
    address: vendor?.address,
    taxNumber: vendor?.taxNumber,
    crNumber: vendor?.crNumber,
  };
}

export function buildSalesInvoicePrintData(
  sale: Sale,
  settings: StoreSettings,
  customer?: Customer
): PrintDataContext {
  const amountPaid = getSaleAppliedPayment(sale);
  const balanceDue = getSaleBalanceDue(sale);
  const phase1QrCode = generateZatcaTlvBase64({
    sellerName: settings.storeNameAr || settings.storeName || 'aptPOS Retail',
    vatNumber: settings.taxId || '300000000000003',
    timestamp: getInvoiceDateTime(sale.invoiceDate, sale.createdAt).toISOString(),
    totalAmount: sale.total,
    taxAmount: sale.taxAmount,
  });
  return {
    voucher: {
      number: sale.receiptNumber,
      date: sale.invoiceDate || sale.createdAt,
      cashierName: sale.cashierName,
      paymentMethod: sale.paymentMethod,
      customerName: sale.customerName,
      paymentStatus: balanceDue > 0
        ? amountPaid > 0 ? 'partially-paid' : 'unpaid'
        : 'paid',
      ...(sale.appScreenMode === 'flyerp'
        ? {
            taxStatus: (sale.taxType ?? settings.taxType) === 'inclusive'
              ? 'included'
              : 'excluded',
          }
        : {}),
      customer: customerData(customer),
      eInvoiceQrCodePhase1: phase1QrCode,
      eInvoiceQrCodePhase2: '',
    },
    party: customerData(customer),
    company: companyData(settings),
    totals: {
      subtotal: sale.subtotal,
      discount: sale.discountAmount,
      tax: sale.taxAmount,
      total: sale.total,
      amountTendered: sale.amountTendered,
      changeDue: sale.changeDue,
      amountPaid,
      ...(balanceDue > 0 ? { balanceDue } : {}),
    },
    items: sale.items.map((item, index) => ({
      serialNumber: index + 1,
      code: item.sku,
      name: item.productName,
      nameAr: item.nameAr,
      description: item.description,
      quantity: item.quantity,
      unit: item.unitName,
      unitPrice: item.unitPrice,
      discount: item.discountAmount ?? 0,
      tax: item.taxAmount ?? 0,
      total: item.lineTotal,
    })),
  };
}

export function buildSalesReturnPrintData(
  voucher: SalesReturnVoucher,
  settings: StoreSettings,
  customerName?: string
): PrintDataContext {
  return {
    voucher: {
      number: voucher.voucherNumber,
      date: voucher.createdAt,
      cashierName: voucher.cashierName,
      paymentMethod: voucher.paymentMethod,
      sourceInvoices: voucher.sourceInvoices.join(', '),
      customerName,
    },
    party: { name: customerName },
    company: companyData(settings),
    totals: {
      refund: voucher.refundAmount,
      taxRefund: voucher.taxRefundAmount,
      totalRefund: voucher.refundAmount,
    },
    items: voucher.items.map((item, index) => ({
      serialNumber: index + 1,
      code: item.sku,
      name: item.productName,
      nameAr: item.nameAr,
      quantity: item.quantity,
      unit: item.unitName,
      refundAmount: item.refundAmount,
      total: item.refundAmount,
    })),
  };
}

export function buildPurchaseInvoicePrintData(
  purchase: PurchaseEntry,
  settings: StoreSettings,
  vendor?: Vendor
): PrintDataContext {
  return {
    voucher: {
      number: purchase.invoiceNumber,
      date: purchase.createdAt,
      receivedDate: purchase.receivedDate,
      vendorName: purchase.vendorName,
      vendor: vendorData(vendor),
      notes: purchase.notes,
    },
    party: vendorData(vendor),
    company: companyData(settings),
    totals: {
      subtotal: purchase.subtotal,
      tax: purchase.taxAmount,
      shipping: purchase.shippingCost,
      total: purchase.total,
      paid: purchase.paidAmount,
      balance: Math.max(0, purchase.total - purchase.paidAmount),
    },
    items: purchase.items.map((item, index) => ({
      serialNumber: index + 1,
      code: item.sku,
      name: item.productName,
      quantity: item.quantity,
      unitCost: item.unitCost,
      total: item.lineTotal,
    })),
  };
}

export function buildPurchaseReturnPrintData(
  voucher: PurchaseReturnVoucher,
  settings: StoreSettings,
  vendor?: Vendor
): PrintDataContext {
  return {
    voucher: {
      number: voucher.voucherNumber,
      date: voucher.createdAt,
      invoiceNumber: voucher.invoiceNumber,
      vendorName: voucher.vendorName,
      vendor: vendorData(vendor),
      notes: voucher.notes,
    },
    party: vendorData(vendor),
    company: companyData(settings),
    totals: {
      subtotal: voucher.subtotal,
      tax: voucher.taxAmount,
      total: voucher.total,
    },
    items: voucher.items.map((item, index) => ({
      serialNumber: index + 1,
      code: item.sku,
      name: item.productName,
      quantity: item.quantity,
      unitCost: item.unitCost,
      total: item.lineTotal,
    })),
  };
}

export function resolvePrintField(
  context: PrintDataContext,
  fieldPath: string,
  item?: Record<string, unknown>
): unknown {
  let value: unknown;
  let segments: string[];
  if (fieldPath.startsWith('items[].')) {
    value = item;
    segments = fieldPath.slice('items[].'.length).split('.');
  } else {
    const [root, ...pathSegments] = fieldPath.split('.');
    segments = pathSegments;
    if (root === 'voucher') value = context.voucher;
    else if (root === 'party') value = context.party;
    else if (root === 'company') value = context.company;
    else if (root === 'totals') value = context.totals;
    else return undefined;
  }

  for (const segment of segments) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

export function formatPrintField(
  value: unknown,
  options: {
    format?: string;
    prefix?: string;
    suffix?: string;
    emptyValue?: string;
    currencySymbol?: string;
    decimalPlaces?: number;
  } = {}
): string {
  if (value === null || value === undefined || value === '') return options.emptyValue ?? '';
  let rendered: string;
  const format = options.format || '';

  if (format.startsWith('date:')) {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      rendered = String(value);
    } else {
      const pattern = format.slice(5);
      rendered = pattern
        .replace(/dd/g, String(date.getDate()).padStart(2, '0'))
        .replace(/MM/g, String(date.getMonth() + 1).padStart(2, '0'))
        .replace(/yyyy/g, String(date.getFullYear()));
    }
  } else if (
    format === 'currency' ||
    format === 'percentage' ||
    format.startsWith('number:') ||
    (typeof value === 'number' && !Number.isInteger(value))
  ) {
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
      rendered = String(value);
    } else {
      const requestedPrecision = format.startsWith('number:')
        ? Number(format.slice('number:'.length))
        : options.decimalPlaces ?? 2;
      const precision = Number.isFinite(requestedPrecision) ? requestedPrecision : 2;
      const amount = numericValue.toLocaleString(undefined, {
        minimumFractionDigits: Math.max(0, Math.min(6, precision)),
        maximumFractionDigits: Math.max(0, Math.min(6, precision)),
      });
      rendered = format === 'currency'
        ? `${options.currencySymbol || 'SAR'} ${amount}`
        : format === 'percentage'
          ? `${amount}%`
          : amount;
    }
  } else if (format === 'uppercase') {
    rendered = String(value).toUpperCase();
  } else if (format === 'lowercase') {
    rendered = String(value).toLowerCase();
  } else {
    rendered = String(value);
  }

  return `${options.prefix || ''}${rendered}${options.suffix || ''}`;
}
