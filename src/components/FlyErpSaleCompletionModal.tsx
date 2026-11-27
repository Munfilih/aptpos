import React, { useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Printer,
  SlidersHorizontal,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import type { AppScreenMode, Customer, Sale, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { getInvoiceDateTime } from '../utils/dateFilters';
import { getKotNumberFromInvoice } from '../utils/documentNumbers';
import {
  allocatePaymentAcrossServices,
  getSaleAppliedPayment,
  getSaleBalanceDue,
} from '../utils/saleBalances';
import { getTaxExcludedUnitPrice } from '../utils/salesTax';
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
import { getPrintDocumentFormat, resolvePrintTemplate } from '../printTemplates/catalog';
import type { PrintDocumentData } from '../printTemplates/types';
import {
  OneTimeTemplateModal,
  type OneTimeDocumentOverride,
} from './OneTimeTemplateModal';

type SaleDocument = 'cash-receipt' | 'bank-receipt' | 'sales-invoice' | 'kot';

interface FlyErpSaleCompletionModalProps {
  sale: Sale;
  sales: Sale[];
  settings: StoreSettings;
  appScreenMode?: AppScreenMode;
  customer?: Customer;
  queuedOffline?: boolean;
  isReprint?: boolean;
  onClose: () => void;
}

export const FlyErpSaleCompletionModal: React.FC<FlyErpSaleCompletionModalProps> = ({
  sale,
  sales,
  settings,
  appScreenMode,
  customer,
  queuedOffline,
  isReprint = false,
  onClose,
}) => {
  const { isRtl } = useLanguage();
  const text = (english: string, arabic: string) => isRtl ? arabic : english;
  const [selectedDocument, setSelectedDocument] = useState<SaleDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [printingDirectDoc, setPrintingDirectDoc] = useState<SaleDocument | null>(null);
  const [savingPdfDirectDoc, setSavingPdfDirectDoc] = useState<SaleDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [oneTimeOverrides, setOneTimeOverrides] = useState<
    Partial<Record<SaleDocument, OneTimeDocumentOverride>>
  >({});
  const isDraftSale = sale.status === 'DRAFT';
  const isFlyErpSale = sale.appScreenMode === 'flyerp';
  const isFlyErpMode = isFlyErpSale || appScreenMode === 'flyerp';
  const isRposSale = sale.appScreenMode === 'rpos';
  const defaultFormatFallback = isFlyErpSale ? 'A4' : (settings.paperWidth || '80mm');
  const paymentMethod = sale.paymentMethod.trim().toUpperCase();
  const canPrintCashReceipt = !isDraftSale && Boolean(settings.enableCashReceipt) && paymentMethod.includes('CASH');
  const canPrintBankReceipt =
    !isDraftSale &&
    Boolean(settings.enableCashReceipt) &&
    (paymentMethod.includes('CARD') || paymentMethod.includes('BANK'));
  const canPrintKot = !isDraftSale && sale.appScreenMode === 'rpos' && settings.enableKot === true;

  const documentTitle = (document: SaleDocument) => {
    if (document === 'cash-receipt') return text('Cash Receipt', 'إيصال نقدي');
    if (document === 'bank-receipt') return text('Bank Receipt', 'إيصال بنكي');
    if (document === 'kot') return text('Kitchen Order (KOT)', 'طلب المطبخ (KOT)');
    return isDraftSale
      ? text('Sales Draft', 'مسودة مبيعات')
      : text('Sales Invoice', 'فاتورة المبيعات');
  };

  const getDocumentPrintSummary = (docType: SaleDocument) => {
    const effective = buildEffectiveSettings(docType);
    const format = getPrintDocumentFormat(effective, docType, defaultFormatFallback);
    const profile = effective.printDocumentProfiles?.[docType]?.[format];
    const template = resolvePrintTemplate(docType, format, profile?.templateId);
    const enableEn = profile?.enableEnglish !== false;
    const enableAr = profile?.enableArabic !== false;
    const langLabel = enableEn && enableAr
      ? 'EN / AR'
      : enableAr
        ? 'AR'
        : 'EN';
    return `${template.label} · ${langLabel}`;
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

  const buildEffectiveSettings = (
    docType: SaleDocument,
    override?: OneTimeDocumentOverride
  ): StoreSettings => {
    const resolvedOverride = override ?? oneTimeOverrides[docType];
    if (!resolvedOverride) return settings;
    return {
      ...settings,
      printDocumentFormats: {
        ...settings.printDocumentFormats,
        [docType]: resolvedOverride.format,
      },
      printDocumentProfiles: {
        ...settings.printDocumentProfiles,
        [docType]: {
          ...settings.printDocumentProfiles?.[docType],
          [resolvedOverride.format]: resolvedOverride.profile,
        },
      },
    };
  };

  const createJobForDocument = async (
    docType: SaleDocument,
    override?: OneTimeDocumentOverride
  ) => {
    const effectiveSettings = buildEffectiveSettings(docType, override);
    if (docType === 'sales-invoice') {
      const customerAccount = { balance: getCustomerPendingBalance() };
      const salesFormat = getPrintDocumentFormat(effectiveSettings, 'sales-invoice', defaultFormatFallback);
      const salesTemplateId =
        effectiveSettings.printDocumentProfiles?.['sales-invoice']?.[salesFormat]?.templateId;
      return createVoucherTemplateJob(
        'sales-invoice',
        sale.id,
        effectiveSettings,
        salesFormat,
        isRtl,
        undefined,
        salesTemplateId,
        customerAccount
      );
    }

    if (docType === 'kot') {
      const kotFormat = getPrintDocumentFormat(
        effectiveSettings,
        'kot',
        effectiveSettings.paperWidth || '80mm'
      );
      const kotNumber = getKotNumberFromInvoice(sale.receiptNumber);
      const kotData: PrintDocumentData = {
        documentType: 'kot',
        title: 'Kitchen Order / طلب المطبخ',
        number: kotNumber,
        date: getInvoiceDateTime(sale.invoiceDate, sale.createdAt).toLocaleString(
          isRtl ? 'ar-SA' : 'en-GB'
        ),
        companyName: '',
        companyLogo: effectiveSettings.storeLogoDataUrl,
        fields: [
          {
            label: 'Customer / العميل',
            value: sale.customerName || effectiveSettings.defaultCustomer || 'Walk-in Customer',
          },
          {
            label: 'Cashier / الكاشير',
            value: sale.cashierName || effectiveSettings.cashierName || 'Cashier',
          },
        ],
        columns: ['Item / الصنف', 'Qty / الكمية'],
        numericColumns: [1],
        rows: sale.items.map((item) => {
          const itemName = item.nameAr && item.nameAr !== item.productName
            ? `${item.productName} / ${item.nameAr}`
            : item.productName;
          const unit = item.unitName ? ` (${item.unitName})` : '';
          const description = item.description?.trim() ? `\n${item.description.trim()}` : '';
          return { values: [`${itemName}${unit}${description}`, String(item.quantity)] };
        }),
        totals: [],
        direction: 'ltr',
      };
      return createPrintTemplateJob(
        kotData,
        effectiveSettings,
        kotFormat,
        effectiveSettings.printDocumentProfiles?.kot?.[kotFormat]?.templateId
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
    const isCashReceipt = docType === 'cash-receipt';
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
    const itemColumnLabel = isFlyErpSale ? 'Service / الخدمة' : 'Item / الصنف';
    const columns = isCashReceipt
      ? [
          '# / م',
          itemColumnLabel,
          ...activeServiceDetailColumns.map(({ english, arabic }) => `${english} / ${arabic}`),
          'Amount Received / المبلغ المستلم',
        ]
      : [
          '# / م',
          itemColumnLabel,
          ...activeServiceDetailColumns.map(({ english, arabic }) => `${english} / ${arabic}`),
          'Rate / السعر',
          'Amount / المبلغ',
        ];
    const rateColumnIndex = isCashReceipt
      ? -1
      : columns.findIndex((column) => column.startsWith('Rate /'));
    const amountColumnIndex = columns.length - 1;
    const resolvedTaxType = sale.taxType ?? settings.taxType;
    const rows = sale.items.map((item, index) => {
      const details = parsedServiceDetails[index];
      const name = [...new Set([item.productName, item.nameAr].filter(Boolean))].join(' / ');
      const description = [name, details.notes.join('\n')]
        .filter(Boolean)
        .join('\n');
      const taxExcludedRate = getTaxExcludedUnitPrice(
        item.unitPrice,
        item.quantity,
        resolvedTaxType,
        item.taxRate ?? sale.taxRate,
        item.taxAmount
      );
      return {
        values: [
          String(index + 1),
          description,
          ...activeServiceDetailColumns.map(({ key }) =>
            formatFlyErpServiceDetailValue(key, details.values[key] || '')
          ),
          ...(isCashReceipt
            ? [formatMoney(serviceReceivedAmounts[index] || 0)]
            : [formatMoney(taxExcludedRate), formatMoney(item.lineTotal)]),
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
    const receiptDocType = isCashReceipt ? 'cash-receipt' : 'bank-receipt';
    const receiptFormat = getPrintDocumentFormat(effectiveSettings, receiptDocType, defaultFormatFallback);
    const data: PrintDocumentData = {
      documentType: receiptDocType,
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
      effectiveSettings,
      receiptFormat,
      effectiveSettings.printDocumentProfiles?.[receiptDocType]?.[receiptFormat]?.templateId
    );
  };

  const createSelectedJob = async () => {
    if (!selectedDocument) throw new Error('Choose a sales document first.');
    return createJobForDocument(selectedDocument);
  };

  const handleDirectPrint = async (docType: SaleDocument) => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    setPrintingDirectDoc(docType);
    try {
      const job = await createJobForDocument(docType);
      const printed = await printTemplateJob({ ...job, silent: false });
      setNotice(
        printed
          ? text('Print dialog opened.', 'تم فتح نافذة الطباعة.')
          : text('Printing was cancelled.', 'تم إلغاء الطباعة.')
      );
    } catch (printError) {
      setError(
        printError instanceof Error
          ? printError.message
          : text('Could not print this document.', 'تعذرت طباعة المستند.')
      );
    } finally {
      setBusy(false);
      setPrintingDirectDoc(null);
    }
  };

  const handleDocumentClick = async (docType: SaleDocument) => {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!isRposSale && !isFlyErpMode) {
      setSelectedDocument(docType);
      return;
    }
    await handleDirectPrint(docType);
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

  const handleSavePdf = async (docTypeOverride?: SaleDocument) => {
    if (busy) return;
    const targetDoc = docTypeOverride ?? selectedDocument ?? 'sales-invoice';
    setBusy(true);
    setSavingPdfDirectDoc(targetDoc);
    setError(null);
    setNotice(null);
    try {
      const job = await createJobForDocument(targetDoc);
      const now = new Date();
      const currentDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const baseFileName = `${sale.receiptNumber}_${currentDateStr}`;
      const fileName = `${baseFileName}.pdf`;
      const titledHtml = job.html.replace(
        /<title>[\s\S]*?<\/title>/i,
        `<title>${baseFileName}</title>`
      );
      if (window.electronAPI?.isElectron) {
        const result = await window.electronAPI.exportDesignPdf({
          fileName,
          html: titledHtml,
          pageSize: job.pageSize,
        });
        if (result.canceled) {
          setNotice(text('PDF saving was cancelled.', 'تم إلغاء حفظ ملف PDF.'));
        } else {
          setNotice(text(`PDF saved as ${fileName}.`, `تم حفظ ملف PDF باسم ${fileName}.`));
          setSelectedDocument(null);
        }
      } else {
        const printed = await printTemplateJob({ ...job, html: titledHtml, silent: false });
        setNotice(printed
          ? text(
              `Choose Save as PDF. File name: ${fileName}`,
              `اختر حفظ كملف PDF. اسم الملف: ${fileName}`
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
      setSavingPdfDirectDoc(null);
    }
  };

  const closeDocumentChoice = () => {
    if (busy) return;
    setSelectedDocument(null);
    setError(null);
    setNotice(null);
  };

  const currency = settings.currencySymbol || 'SAR';
  const decimals = settings.decimalPoints ?? 2;
  const appliedPayment = getSaleAppliedPayment(sale);
  const balanceDue = getSaleBalanceDue(sale);
  const formattedInvoiceDate = getInvoiceDateTime(sale.invoiceDate, sale.createdAt).toLocaleDateString(
    isRtl ? 'ar-SA' : 'en-GB',
    { year: 'numeric', month: 'short', day: '2-digit' }
  );
  const paymentStatusLabel =
    balanceDue <= 0
      ? text('Paid', 'مدفوع')
      : appliedPayment > 0
        ? text('Partially Paid', 'مدفوع جزئياً')
        : text('Unpaid', 'غير مدفوع');
  const paymentStatusClass =
    balanceDue <= 0
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : appliedPayment > 0
        ? 'border-sky-200 bg-sky-50 text-sky-800'
        : 'border-slate-200 bg-slate-100 text-slate-700';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="flyerp-sale-completion-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          if (selectedDocument) closeDocumentChoice();
          else onClose();
        }
      }}
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-emerald-50/50 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-white text-emerald-700 shadow-xs">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="flyerp-sale-completion-title" className="truncate text-base font-bold text-slate-900">
                  {selectedDocument
                    ? documentTitle(selectedDocument)
                    : isReprint
                      ? text('Invoice Summary & Reprint', 'ملخص الفاتورة وإعادة الطباعة')
                      : text('Invoice Summary', 'ملخص الفاتورة')}
                </h2>
                {!selectedDocument && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${paymentStatusClass}`}>
                    {paymentStatusLabel}
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-slate-500">
                {sale.receiptNumber} · {formattedInvoiceDate}
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
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white hover:text-slate-800 disabled:opacity-50"
          >
            {selectedDocument
              ? <ArrowLeft className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />
              : <X className="h-4 w-4" />}
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {!selectedDocument && (
            <>
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-emerald-50/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {text('Customer', 'العميل')}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-bold text-slate-900">
                      {sale.customerName}
                    </p>
                    {customer?.phone && (
                      <p className="font-mono text-[11px] text-slate-500">
                        {customer.phone}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {text('Invoice Total', 'إجمالي الفاتورة')}
                    </p>
                    <p className="mt-0.5 font-mono text-xl font-bold tabular-nums text-emerald-700">
                      {currency} {sale.total.toFixed(decimals)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 divide-y divide-slate-200 bg-white text-xs sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                  <div className="px-3 py-2.5">
                    <span className="block text-[10px] font-medium text-slate-500">
                      {text('Payment', 'الدفع')}
                    </span>
                    <span className="mt-0.5 block truncate font-semibold text-slate-900">
                      {sale.paymentMethod}
                    </span>
                  </div>
                  <div className="px-3 py-2.5">
                    <span className="block text-[10px] font-medium text-slate-500">
                      {text('Paid', 'المدفوع')}
                    </span>
                    <span className="mt-0.5 block font-mono font-semibold tabular-nums text-emerald-700">
                      {currency} {appliedPayment.toFixed(decimals)}
                    </span>
                  </div>
                  <div className="px-3 py-2.5">
                    <span className="block text-[10px] font-medium text-slate-500">
                      {text('Balance Due', 'المستحق')}
                    </span>
                    <span className={`mt-0.5 block font-mono font-semibold tabular-nums ${balanceDue > 0 ? 'text-slate-900' : 'text-slate-400'}`}>
                      {currency} {balanceDue.toFixed(decimals)}
                    </span>
                  </div>
                  <div className="px-3 py-2.5">
                    <span className="block text-[10px] font-medium text-slate-500">
                      {isFlyErpSale ? text('Services', 'الخدمات') : text('Items', 'الأصناف')}
                    </span>
                    <span className="mt-0.5 block font-mono font-semibold tabular-nums text-slate-900">
                      {sale.items.length}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50/50 px-4 py-2 text-[11px] text-slate-500">
                  <span>
                    {text('Subtotal', 'الإجمالي الفرعي')}:{' '}
                    <strong className="font-mono font-semibold text-slate-700">
                      {currency} {sale.subtotal.toFixed(decimals)}
                    </strong>
                  </span>
                  {sale.discountAmount > 0 && (
                    <span>
                      {text('Discount', 'الخصم')}:{' '}
                      <strong className="font-mono font-semibold text-slate-700">
                        −{currency} {sale.discountAmount.toFixed(decimals)}
                      </strong>
                    </span>
                  )}
                  <span>
                    {text('VAT', 'الضريبة')}:{' '}
                    <strong className="font-mono font-semibold text-slate-700">
                      {currency} {sale.taxAmount.toFixed(decimals)}
                    </strong>
                  </span>
                </div>
              </section>

              {queuedOffline && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  {text(
                    'The sale was saved offline. Printing will be queued until the printer is available.',
                    'تم حفظ البيع دون اتصال. ستتم إضافة الطباعة إلى قائمة الانتظار حتى تتوفر الطابعة.'
                  )}
                </p>
              )}
            </>
          )}

          {!selectedDocument ? (
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {text('Documents & Output', 'المستندات والطباعة')}
              </p>
              <div className="space-y-2">
                {isFlyErpMode ? (
                  <>
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
                        <FileText className="h-4.5 w-4.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">
                          {isDraftSale
                            ? text('Sales Draft', 'مسودة مبيعات')
                            : text('Sales Invoice', 'فاتورة المبيعات')}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                          {getDocumentPrintSummary('sales-invoice')}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDirectPrint('sales-invoice')}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60"
                        >
                          {printingDirectDoc === 'sales-invoice'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Printer className="h-3.5 w-3.5" />}
                          {text('Print', 'طباعة')}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSavePdf('sales-invoice')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
                        >
                          {savingPdfDirectDoc === 'sales-invoice'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Download className="h-3.5 w-3.5" />}
                          {text('PDF', 'PDF')}
                        </button>
                      </div>
                    </div>

                    {canPrintCashReceipt && (
                      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
                          <Banknote className="h-4.5 w-4.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900">
                            {text('Cash Receipt', 'إيصال نقدي')}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                            {getDocumentPrintSummary('cash-receipt')}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDirectPrint('cash-receipt')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60"
                          >
                            {printingDirectDoc === 'cash-receipt'
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Printer className="h-3.5 w-3.5" />}
                            {text('Print', 'طباعة')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleSavePdf('cash-receipt')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
                          >
                            {savingPdfDirectDoc === 'cash-receipt'
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Download className="h-3.5 w-3.5" />}
                            {text('PDF', 'PDF')}
                          </button>
                        </div>
                      </div>
                    )}

                    {canPrintBankReceipt && (
                      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700">
                          <CreditCard className="h-4.5 w-4.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900">
                            {text('Bank Receipt', 'إيصال بنكي')}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                            {getDocumentPrintSummary('bank-receipt')}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDirectPrint('bank-receipt')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60"
                          >
                            {printingDirectDoc === 'bank-receipt'
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Printer className="h-3.5 w-3.5" />}
                            {text('Print', 'طباعة')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleSavePdf('bank-receipt')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
                          >
                            {savingPdfDirectDoc === 'bank-receipt'
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Download className="h-3.5 w-3.5" />}
                            {text('PDF', 'PDF')}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDocumentClick('sales-invoice')}
                      className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-start transition-colors hover:border-emerald-400 hover:bg-emerald-50/50 disabled:opacity-60"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
                        {printingDirectDoc === 'sales-invoice'
                          ? <Loader2 className="h-4.5 w-4.5 animate-spin" />
                          : <FileText className="h-4.5 w-4.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">
                          {isDraftSale
                            ? text('Sales Draft', 'مسودة مبيعات')
                            : text('Sales Invoice', 'فاتورة المبيعات')}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                          {getDocumentPrintSummary('sales-invoice')}
                        </span>
                      </span>
                      {isRposSale
                        ? <Printer className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-emerald-700" />
                        : <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:text-emerald-700 ${isRtl ? 'rotate-180' : ''}`} />}
                    </button>

                    {canPrintCashReceipt && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDocumentClick('cash-receipt')}
                        className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-start transition-colors hover:border-emerald-400 hover:bg-emerald-50/50 disabled:opacity-60"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
                          {printingDirectDoc === 'cash-receipt'
                            ? <Loader2 className="h-4.5 w-4.5 animate-spin" />
                            : <Banknote className="h-4.5 w-4.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900">
                            {text('Cash Receipt', 'إيصال نقدي')}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                            {getDocumentPrintSummary('cash-receipt')}
                          </span>
                        </span>
                        {isRposSale
                          ? <Printer className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-emerald-700" />
                          : <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:text-emerald-700 ${isRtl ? 'rotate-180' : ''}`} />}
                      </button>
                    )}

                    {canPrintBankReceipt && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDocumentClick('bank-receipt')}
                        className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-start transition-colors hover:border-blue-400 hover:bg-blue-50/50 disabled:opacity-60"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700">
                          {printingDirectDoc === 'bank-receipt'
                            ? <Loader2 className="h-4.5 w-4.5 animate-spin" />
                            : <CreditCard className="h-4.5 w-4.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900">
                            {text('Bank Receipt', 'إيصال بنكي')}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                            {getDocumentPrintSummary('bank-receipt')}
                          </span>
                        </span>
                        {isRposSale
                          ? <Printer className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-blue-700" />
                          : <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:text-blue-700 ${isRtl ? 'rotate-180' : ''}`} />}
                      </button>
                    )}

                    {canPrintKot && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDocumentClick('kot')}
                        className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-start transition-colors hover:border-amber-400 hover:bg-amber-50/50 disabled:opacity-60"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700">
                          {printingDirectDoc === 'kot'
                            ? <Loader2 className="h-4.5 w-4.5 animate-spin" />
                            : <UtensilsCrossed className="h-4.5 w-4.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900">
                            {text('Kitchen Order (KOT)', 'طلب المطبخ (KOT)')}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                            {getDocumentPrintSummary('kot')}
                          </span>
                        </span>
                        {isRposSale
                          ? <Printer className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-amber-700" />
                          : <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:text-amber-700 ${isRtl ? 'rotate-180' : ''}`} />}
                      </button>
                    )}
                  </>
                )}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-emerald-50/40 p-4">
              <p className="text-sm font-semibold text-slate-900">
                {text('Print or save as PDF?', 'هل تريد الطباعة أم الحفظ كملف PDF؟')}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handlePrint()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  {text('Print', 'طباعة')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSavePdf()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {text('Save PDF', 'حفظ PDF')}
                </button>
              </div>
            </section>
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

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <div className="flex items-center gap-3">
            {selectedDocument && (
              <button
                type="button"
                disabled={busy}
                onClick={closeDocumentChoice}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <ArrowLeft className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />
                {text('Back', 'رجوع')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowTemplateModal(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline-offset-4 hover:text-emerald-800 hover:underline disabled:opacity-50"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>{text('Choose Templates', 'اختيار القوالب')}</span>
              {Object.keys(oneTimeOverrides).length > 0 && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 no-underline">
                  {text('Custom', 'مخصص')}
                </span>
              )}
            </button>
            {!isFlyErpMode && (
              <>
                <span className="text-slate-300" aria-hidden="true">|</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSavePdf(selectedDocument ?? 'sales-invoice')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 underline-offset-4 hover:text-emerald-800 hover:underline disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  <span>{text('Save as PDF', 'حفظ كـ PDF')}</span>
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {text('Done', 'تم')}
          </button>
        </footer>
      </div>

      {showTemplateModal && (
        <OneTimeTemplateModal
          settings={settings}
          defaultFormatFallback={defaultFormatFallback}
          documents={[
            { id: 'sales-invoice', label: text('Sales Invoice', 'فاتورة المبيعات') },
            ...(canPrintCashReceipt
              ? [{ id: 'cash-receipt' as const, label: text('Cash Receipt', 'إيصال نقدي') }]
              : []),
            ...(canPrintBankReceipt
              ? [{ id: 'bank-receipt' as const, label: text('Bank Receipt', 'إيصال بنكي') }]
              : []),
            ...(canPrintKot
              ? [{ id: 'kot' as const, label: text('Kitchen Order (KOT)', 'طلب المطبخ (KOT)') }]
              : []),
          ]}
          initialDocument={selectedDocument ?? 'sales-invoice'}
          overrides={oneTimeOverrides}
          onBuildPreviewJob={(docType, override) =>
            createJobForDocument(docType as SaleDocument, override)
          }
          onApply={setOneTimeOverrides}
          onClose={() => setShowTemplateModal(false)}
        />
      )}
    </div>
  );
};
