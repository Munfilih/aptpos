import React, { useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Printer,
  X,
} from 'lucide-react';
import type { Customer, Sale, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { getInvoiceDateTime } from '../utils/dateFilters';
import {
  allocatePaymentAcrossServices,
  getSaleAppliedPayment,
  getSaleBalanceDue,
} from '../utils/saleBalances';
import {
  formatFlyErpServiceDetailValue,
  parseFlyErpServiceDetails,
} from '../utils/flyErpServices';
import type { FlyErpServiceDetailKey } from '../utils/flyErpServices';
import {
  createPrintTemplateJob,
  createVoucherTemplateJob,
  printTemplateJob,
} from '../printTemplates/render';
import type { PrintDocumentData } from '../printTemplates/types';

type SaleDocument = 'cash-receipt' | 'bank-receipt' | 'sales-invoice';

interface FlyErpSaleCompletionModalProps {
  sale: Sale;
  sales: Sale[];
  settings: StoreSettings;
  customer?: Customer;
  queuedOffline?: boolean;
  isReprint?: boolean;
  onClose: () => void;
}

export const FlyErpSaleCompletionModal: React.FC<FlyErpSaleCompletionModalProps> = ({
  sale,
  sales,
  settings,
  customer,
  queuedOffline,
  isReprint = false,
  onClose,
}) => {
  const { isRtl } = useLanguage();
  const text = (english: string, arabic: string) => isRtl ? arabic : english;
  const [selectedDocument, setSelectedDocument] = useState<SaleDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const paymentMethod = sale.paymentMethod.trim().toUpperCase();
  const canPrintCashReceipt = paymentMethod.includes('CASH');
  const canPrintBankReceipt = paymentMethod.includes('CARD');

  const documentTitle = (document: SaleDocument) => {
    if (document === 'cash-receipt') return text('Cash Receipt', 'إيصال نقدي');
    if (document === 'bank-receipt') return text('Bank Receipt', 'إيصال بنكي');
    return text('Detailed A4 Sales Invoice', 'فاتورة مبيعات تفصيلية A4');
  };

  const getCustomerPendingBalance = () => {
    const accountCustomerId = customer?.id ?? sale.customerId;
    const accountCustomerName = customer?.name ?? sale.customerName;
    if (accountCustomerId === undefined || accountCustomerId === null) {
      return 0;
    }

    const customerSales = new Map<number, Sale>();
    [...sales, sale].forEach((candidate) => {
      if (
        candidate.status === 'COMPLETED' &&
        (candidate.customerId === accountCustomerId || candidate.customerName === accountCustomerName)
      ) {
        customerSales.set(candidate.id, candidate);
      }
    });
    return Number(
      [...customerSales.values()]
        .reduce((balance, candidate) => balance + getSaleBalanceDue(candidate), 0)
        .toFixed(2)
    );
  };

  const createSelectedJob = async () => {
    if (!selectedDocument) throw new Error('Choose a sales document first.');
    if (selectedDocument === 'sales-invoice') {
      const customerAccount = { balance: getCustomerPendingBalance() };
      return createVoucherTemplateJob(
        'sales-invoice',
        sale.id,
        settings,
        'A4',
        isRtl,
        undefined,
        'sales-invoice-a4-flyerp',
        customerAccount
      );
    }

    const configuredDecimalPlaces = settings.decimalPoints ?? 2;
    const decimalPlaces = Number.isInteger(configuredDecimalPlaces) &&
      configuredDecimalPlaces >= 0 &&
      configuredDecimalPlaces <= 4
      ? configuredDecimalPlaces
      : 2;
    const currency = settings.currencySymbol || 'SAR';
    const formatMoney = (amount: number) =>
      `${currency} ${Number(amount || 0).toFixed(decimalPlaces)}`;
    const date = getInvoiceDateTime(sale.invoiceDate, sale.createdAt)
      .toLocaleDateString('en-GB');
    const isCashReceipt = selectedDocument === 'cash-receipt';
    const serviceFinalAmounts = sale.items.map((item) => {
      const afterDiscount = Math.max(0, item.lineTotal - (item.discountAmount || 0));
      const taxAmount = Math.max(0, item.taxAmount || 0);
      return (sale.taxType ?? settings.taxType) === 'inclusive'
        ? afterDiscount
        : afterDiscount + taxAmount;
    });
    const serviceReceivedAmounts = isCashReceipt
      ? allocatePaymentAcrossServices(getSaleAppliedPayment(sale), serviceFinalAmounts)
      : [];
    const parsedServiceDetails = sale.items.map((item) =>
      parseFlyErpServiceDetails(item.description || '')
    );
    const serviceDetailColumns: Array<{
      key: FlyErpServiceDetailKey;
      english: string;
      arabic: string;
    }> = [
      { key: 'passenger', english: 'Passenger', arabic: 'المسافر' },
      { key: 'passport', english: 'Passport / ID', arabic: 'رقم الجواز / الهوية' },
      { key: 'pnr', english: 'PNR', arabic: 'رقم الحجز' },
      { key: 'flight', english: 'Flight', arabic: 'رقم الرحلة' },
      { key: 'origin', english: 'From', arabic: 'من' },
      { key: 'destination', english: 'To', arabic: 'إلى' },
      { key: 'tripType', english: 'Trip Type', arabic: 'نوع الرحلة' },
      { key: 'travelDate', english: 'Travel Date', arabic: 'تاريخ السفر' },
      { key: 'returnFlight', english: 'Return Flight', arabic: 'رحلة العودة' },
      { key: 'returnDate', english: 'Return Date', arabic: 'تاريخ العودة' },
    ];
    const activeServiceDetailColumns = serviceDetailColumns.filter(({ key }) =>
      key === 'pnr' ||
      key === 'travelDate' ||
      parsedServiceDetails.some(({ values }) => Boolean(values[key]?.trim()))
    );
    const columns = isCashReceipt
      ? [
          '# / م',
          'Service / الخدمة',
          ...activeServiceDetailColumns.map(({ english, arabic }) => `${english} / ${arabic}`),
          'Amount Received / المبلغ المستلم',
        ]
      : [
          '# / م',
          'Service / الخدمة',
          ...activeServiceDetailColumns.map(({ english, arabic }) => `${english} / ${arabic}`),
          'Rate / السعر',
          'Amount / المبلغ',
        ];
    const rateColumnIndex = isCashReceipt
      ? -1
      : columns.findIndex((column) => column.startsWith('Rate /'));
    const amountColumnIndex = columns.length - 1;
    const rows = sale.items.map((item, index) => {
      const details = parsedServiceDetails[index];
      const name = [...new Set([item.productName, item.nameAr].filter(Boolean))].join(' / ');
      const description = [name, details.notes.join('\n')]
        .filter(Boolean)
        .join('\n');
      return {
        values: [
          String(index + 1),
          description,
          ...activeServiceDetailColumns.map(({ key }) =>
            formatFlyErpServiceDetailValue(key, details.values[key] || '')
          ),
          ...(isCashReceipt
            ? [formatMoney(serviceReceivedAmounts[index] || 0)]
            : [formatMoney(item.unitPrice), formatMoney(item.lineTotal)]),
        ],
      };
    });
    const bilingualLabel = (english: string, arabic: string) => `${english} / ${arabic}`;
    const customerDetails: Array<[string, string | undefined]> = [
      [bilingualLabel('Customer Arabic Name', 'اسم العميل بالعربية'), customer?.nameAr],
      [bilingualLabel('Customer Phone', 'هاتف العميل'), customer?.phone],
      [bilingualLabel('Customer Email', 'البريد الإلكتروني للعميل'), customer?.email],
      [bilingualLabel('Customer Address', 'عنوان العميل'), customer?.address],
      [bilingualLabel('Building No.', 'رقم المبنى'), customer?.buildingNo],
      [bilingualLabel('Street', 'الشارع'), customer?.streetName],
      [bilingualLabel('District', 'الحي'), customer?.district],
      [bilingualLabel('City', 'المدينة'), customer?.city],
      [bilingualLabel('Postal Code', 'الرمز البريدي'), customer?.postalCode],
      [bilingualLabel('Country', 'الدولة'), customer?.country],
      [bilingualLabel('Customer VAT No.', 'الرقم الضريبي للعميل'), customer?.vatNumber],
      [bilingualLabel('Customer CR No.', 'السجل التجاري للعميل'), customer?.crNumber],
    ];
    const data: PrintDocumentData = {
      documentType: 'sales-invoice',
      title: isCashReceipt
        ? 'Cash Receipt / إيصال نقدي'
        : 'Bank Receipt / إيصال بنكي',
      number: sale.receiptNumber,
      date,
      companyName: settings.storeName || 'aptPOS',
      companyNameAr: settings.storeNameAr,
      companyAddress: settings.address,
      companyBuildingNo: settings.buildingNo,
      companyStreetName: settings.streetName,
      companyDistrict: settings.district,
      companyCity: settings.city,
      companyPostalCode: settings.postalCode,
      companyCountry: settings.country,
      companyPhone: settings.phone,
      companyTaxId: settings.taxId,
      companyCrNumber: settings.crNumber,
      companyLogo: settings.storeLogoDataUrl,
      multiLanguage: true,
      compactPartyDetails: isCashReceipt,
      fields: [
        {
          label: bilingualLabel('Customer / Buyer', 'العميل / المشتري'),
          value: sale.customerName,
        },
        ...customerDetails
          .flatMap(([label, value]) => value?.trim() ? [{ label, value: value.trim() }] : []),
        {
          label: bilingualLabel('Cashier', 'الكاشير'),
          value: sale.cashierName,
        },
        {
          label: bilingualLabel('Payment Method', 'طريقة الدفع'),
          value: isCashReceipt
            ? 'Cash / نقداً'
            : 'Card / بطاقة',
        },
        ...(isCashReceipt
          ? [{
              label: bilingualLabel('Payment Status', 'حالة الدفع'),
              value: getSaleBalanceDue(sale) > 0
                ? bilingualLabel('Partially Paid', 'مدفوع جزئياً')
                : bilingualLabel('Paid', 'مدفوع'),
            }]
          : []),
        ...(isCashReceipt
          ? [
              {
                label: bilingualLabel('Bill Total (reference)', 'إجمالي الفاتورة (للمرجع)'),
                value: formatMoney(sale.total),
              },
              ...(getSaleBalanceDue(sale) > 0
                ? [{
                    label: bilingualLabel('Balance Due', 'الرصيد المستحق'),
                    value: formatMoney(getSaleBalanceDue(sale)),
                  }]
                : []),
            ]
          : []),
      ],
      columns,
      numericColumns: [
        0,
        ...(rateColumnIndex >= 0 ? [rateColumnIndex] : []),
        amountColumnIndex,
      ],
      rows,
      totals: [{
        label: bilingualLabel(
          isCashReceipt ? 'Amount Received' : 'Settled Amount',
          isCashReceipt ? 'المبلغ المستلم' : 'المبلغ المسدد'
        ),
        value: formatMoney(isCashReceipt ? getSaleAppliedPayment(sale) : sale.total),
      }],
      footer: isCashReceipt
        ? undefined
        : [settings.receiptFooter, settings.receiptFooterAr]
            .filter((value): value is string => Boolean(value?.trim()))
            .join('\n'),
      direction: 'ltr',
    };
    return createPrintTemplateJob(
      data,
      settings,
      'A4',
      'sales-invoice-a4-flyerp'
    );
  };

  const handlePrint = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const job = await createSelectedJob();
      const printed = await printTemplateJob({ ...job, silent: false });
      setNotice(printed
        ? text('Print dialog opened.', 'تم فتح نافذة الطباعة.')
        : text('Printing was cancelled.', 'تم إلغاء الطباعة.'));
      if (printed) setSelectedDocument(null);
    } catch (printError) {
      setError(printError instanceof Error
        ? printError.message
        : text('Could not print this document.', 'تعذرت طباعة المستند.'));
    } finally {
      setBusy(false);
    }
  };

  const handleSavePdf = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const job = await createSelectedJob();
      const fileName = `${sale.receiptNumber}.pdf`;
      if (window.electronAPI?.isElectron) {
        const result = await window.electronAPI.exportDesignPdf({
          fileName,
          html: job.html,
          pageSize: job.pageSize,
        });
        if (result.canceled) {
          setNotice(text('PDF saving was cancelled.', 'تم إلغاء حفظ ملف PDF.'));
        } else {
          setNotice(text('PDF saved.', 'تم حفظ ملف PDF.'));
          setSelectedDocument(null);
        }
      } else {
        const printed = await printTemplateJob({ ...job, silent: false });
        setNotice(printed
          ? text(
              `Choose Save as PDF. The suggested file name is ${fileName}.`,
              `اختر حفظ كملف PDF. اسم الملف المقترح هو ${fileName}.`
            )
          : text('PDF saving was cancelled.', 'تم إلغاء حفظ ملف PDF.'));
        if (printed) setSelectedDocument(null);
      }
    } catch (pdfError) {
      setError(pdfError instanceof Error
        ? pdfError.message
        : text('Could not save this document as PDF.', 'تعذر حفظ المستند بصيغة PDF.'));
    } finally {
      setBusy(false);
    }
  };

  const closeDocumentChoice = () => {
    if (busy) return;
    setSelectedDocument(null);
    setError(null);
    setNotice(null);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="flyerp-sale-completion-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <h2 id="flyerp-sale-completion-title" className="text-lg font-bold text-slate-900">
                {selectedDocument
                  ? documentTitle(selectedDocument)
                  : isReprint
                    ? text('Reprint sale', 'إعادة طباعة البيع')
                    : text('Invoice saved', 'تم حفظ الفاتورة')}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {selectedDocument
                  ? text('Choose how to output this document.', 'اختر طريقة إخراج هذا المستند.')
                  : `${text('Invoice number', 'رقم الفاتورة')}: ${sale.receiptNumber}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={selectedDocument ? closeDocumentChoice : onClose}
            aria-label={selectedDocument
              ? text('Back to documents', 'العودة إلى المستندات')
              : text('Close', 'إغلاق')}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
          >
            {selectedDocument
              ? <ArrowLeft className="h-4 w-4" />
              : <X className="h-4 w-4" />}
          </button>
        </header>

        <div className="space-y-4 p-5">
          {queuedOffline && !selectedDocument && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {text(
                'The sale was saved offline. Printing will be queued until the printer is available.',
                'تم حفظ البيع دون اتصال. ستتم إضافة الطباعة إلى قائمة الانتظار حتى تتوفر الطابعة.'
              )}
            </p>
          )}

          {!selectedDocument ? (
            <>
              <p className="text-sm text-slate-600">
                {isReprint
                  ? text('Choose a receipt or detailed A4 invoice to reprint.', 'اختر إيصالاً أو فاتورة A4 تفصيلية لإعادة الطباعة.')
                  : text('Choose a receipt or print the detailed sales invoice.', 'اختر إيصالاً أو اطبع فاتورة المبيعات التفصيلية.')}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {canPrintCashReceipt && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDocument('cash-receipt');
                      setError(null);
                      setNotice(null);
                    }}
                    className="flex min-h-16 items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-amber-400 hover:bg-amber-50"
                  >
                    <Banknote className="h-5 w-5 shrink-0 text-emerald-700" />
                    <span className="font-semibold text-slate-800">{text('Print Cash Receipt', 'طباعة إيصال نقدي')}</span>
                  </button>
                )}
                {canPrintBankReceipt && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDocument('bank-receipt');
                      setError(null);
                      setNotice(null);
                    }}
                    className="flex min-h-16 items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50"
                  >
                    <CreditCard className="h-5 w-5 shrink-0 text-blue-700" />
                    <span className="font-semibold text-slate-800">{text('Print Bank Receipt', 'طباعة إيصال بنكي')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDocument('sales-invoice');
                    setError(null);
                    setNotice(null);
                  }}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-amber-400 hover:bg-amber-50 sm:col-span-2"
                >
                  <FileText className="h-5 w-5 shrink-0 text-amber-700" />
                  <span className="font-semibold text-slate-800">{text('Print Detailed A4 Invoice', 'طباعة فاتورة A4 تفصيلية')}</span>
                </button>
              </div>
              {paymentMethod === 'SPLIT' && (
                <p className="text-xs text-slate-500">
                  {text(
                    'Separate cash or card receipts are unavailable because this sale does not store a payment split.',
                    'لا تتوفر إيصالات نقدية أو بطاقات منفصلة لأن هذا البيع لا يحفظ توزيع المبلغ.'
                  )}
                </p>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">
                {text('Print or save as PDF?', 'هل تريد الطباعة أم الحفظ كملف PDF؟')}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {text(
                  `The PDF will be named ${sale.receiptNumber}.pdf.`,
                  `سيكون اسم ملف PDF هو ${sale.receiptNumber}.pdf.`
                )}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePrint()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  {text('Print', 'طباعة')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSavePdf()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {text('PDF', 'PDF')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          )}
        </div>

        {!selectedDocument && (
          <footer className="flex justify-end border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {text('Done', 'تم')}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
};
