import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  Download,
  Loader2,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { PaperWidth, SalesReturnVoucher, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { AppDateInput } from './AppDateInput';
import { matchesDateBounds, resolveDateBounds, type DateFilter } from '../utils/dateFilters';
import { resolveInvoiceMarginsMm } from '../utils/thermalPrinting';
import { getPrintDocumentFormat, resolvePrintTemplate } from '../printTemplates/catalog';
import { createVoucherTemplateJob, printTemplateJob } from '../printTemplates/render';
import {
  OneTimeTemplateModal,
  type OneTimeDocumentOverride,
} from './OneTimeTemplateModal';

interface SalesReturnHistoryViewProps {
  vouchers: SalesReturnVoucher[];
  settings: StoreSettings;
  onEditVoucher?: (voucher: SalesReturnVoucher) => void;
  onDeleteVoucher?: (voucherId: number) => Promise<void>;
}

export const SalesReturnHistoryView: React.FC<SalesReturnHistoryViewProps> = ({
  vouchers,
  settings,
  onEditVoucher,
  onDeleteVoucher,
}) => {
  const { isRtl } = useLanguage();
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedVoucherId, setExpandedVoucherId] = useState<number | null>(null);
  const [deletingVoucher, setDeletingVoucher] = useState<SalesReturnVoucher | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [printingVoucher, setPrintingVoucher] = useState<SalesReturnVoucher | null>(null);
  const [printModalVoucher, setPrintModalVoucher] = useState<SalesReturnVoucher | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [oneTimeOverrides, setOneTimeOverrides] = useState<
    Partial<Record<'sales-return', OneTimeDocumentOverride>>
  >({});
  const [isPrinting, setIsPrinting] = useState(false);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);
  const currency = isRtl ? 'ر.س ' : settings.currencySymbol || 'SAR ';
  const activeFormat: PaperWidth = getPrintDocumentFormat(
    settings,
    'sales-return',
    settings.paperWidth || '80mm'
  );
  const invoiceMarginsMm = resolveInvoiceMarginsMm(activeFormat);
  const hasActions = true;

  const buildEffectiveSettings = (override?: OneTimeDocumentOverride): StoreSettings => {
    const resolved = override ?? oneTimeOverrides['sales-return'];
    if (!resolved) return settings;
    return {
      ...settings,
      printDocumentFormats: {
        ...settings.printDocumentFormats,
        'sales-return': resolved.format,
      },
      printDocumentProfiles: {
        ...settings.printDocumentProfiles,
        'sales-return': {
          ...settings.printDocumentProfiles?.['sales-return'],
          [resolved.format]: resolved.profile,
        },
      },
    };
  };

  const getReturnPrintSummary = () => {
    const effective = buildEffectiveSettings();
    const format = getPrintDocumentFormat(effective, 'sales-return', effective.paperWidth || '80mm');
    const profile = effective.printDocumentProfiles?.['sales-return']?.[format];
    const template = resolvePrintTemplate('sales-return', format, profile?.templateId);
    const enableEn = profile?.enableEnglish !== false;
    const enableAr = profile?.enableArabic !== false;
    const langLabel = enableEn && enableAr ? 'EN / AR' : enableAr ? 'AR' : 'EN';
    return `${template.label} · ${langLabel}`;
  };

  const createReturnPrintJob = async (
    voucher: SalesReturnVoucher,
    override?: OneTimeDocumentOverride
  ) => {
    const effective = buildEffectiveSettings(override);
    const format = getPrintDocumentFormat(effective, 'sales-return', effective.paperWidth || '80mm');
    const templateId = effective.printDocumentProfiles?.['sales-return']?.[format]?.templateId;
    return createVoucherTemplateJob('sales-return', voucher.id, effective, format, isRtl, undefined, templateId);
  };

  const handleConfirmDelete = async () => {
    if (!deletingVoucher || !onDeleteVoucher) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteVoucher(deletingVoucher.id);
      setDeletingVoucher(null);
      setExpandedVoucherId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete return voucher.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePrintVoucher = (voucher: SalesReturnVoucher) => {
    setPrintError(null);
    setPrintNotice(null);
    setOneTimeOverrides({});
    setPrintModalVoucher(voucher);
  };

  const executePrintReturn = async () => {
    if (!printModalVoucher) return;
    setPrintError(null);
    setPrintNotice(null);
    setPrintingVoucher(printModalVoucher);
    setIsPrinting(true);
    try {
      const job = await createReturnPrintJob(printModalVoucher);
      const printed = await printTemplateJob({ ...job, silent: false });
      setPrintNotice(
        printed
          ? (isRtl ? 'تم فتح نافذة الطباعة.' : 'Print dialog opened.')
          : (isRtl ? 'تم إلغاء الطباعة.' : 'Printing was cancelled.')
      );
    } catch (error) {
      console.error('Failed to print sales return voucher:', error);
      setPrintError(error instanceof Error ? error.message : 'Return voucher could not be printed.');
    } finally {
      setIsPrinting(false);
      setPrintingVoucher(null);
    }
  };

  const handleSaveReturnPdf = async () => {
    if (!printModalVoucher) return;
    setPrintError(null);
    setPrintNotice(null);
    setIsPrinting(true);
    try {
      const job = await createReturnPrintJob(printModalVoucher);
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const baseName = `${printModalVoucher.voucherNumber}_${dateStr}`;
      const fileName = `${baseName}.pdf`;
      const titledHtml = job.html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${baseName}</title>`);
      if (window.electronAPI?.isElectron) {
        const result = await window.electronAPI.exportDesignPdf({
          fileName,
          html: titledHtml,
          pageSize: job.pageSize,
        });
        setPrintNotice(
          result.canceled
            ? (isRtl ? 'تم إلغاء حفظ ملف PDF.' : 'PDF saving was cancelled.')
            : (isRtl ? `تم حفظ ملف PDF باسم ${fileName}.` : `PDF saved as ${fileName}.`)
        );
      } else {
        const printed = await printTemplateJob({ ...job, html: titledHtml, silent: false });
        setPrintNotice(
          printed
            ? (isRtl ? `اختر حفظ كملف PDF. اسم الملف: ${fileName}` : `Choose Save as PDF. File name: ${fileName}`)
            : (isRtl ? 'تم إلغاء حفظ ملف PDF.' : 'PDF saving was cancelled.')
        );
      }
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'Could not save return voucher as PDF.');
    } finally {
      setIsPrinting(false);
    }
  };

  const dateBounds = useMemo(
    () => resolveDateBounds(dateFilter, dateFrom, dateTo),
    [dateFilter, dateFrom, dateTo]
  );
  const filteredVouchers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vouchers.filter(
      (voucher) =>
        matchesDateBounds(voucher.createdAt, dateBounds) &&
        (!query ||
          voucher.voucherNumber.toLowerCase().includes(query) ||
          voucher.cashierName.toLowerCase().includes(query) ||
          voucher.sourceInvoices.some((invoice) => invoice.toLowerCase().includes(query)) ||
          voucher.items.some((item) => item.productName.toLowerCase().includes(query)))
    );
  }, [vouchers, search, dateBounds]);

  const hasActiveFilter = search.trim() !== '' || dateFilter !== 'ALL';

  const formatDate = (date: string) =>
    new Date(date).toLocaleString(isRtl ? 'ar-SA' : 'en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const dateFilterLabel = (filter: DateFilter) => {
    const labels: Record<DateFilter, string> = isRtl
      ? {
          ALL: 'كل التواريخ',
          RANGE: 'نطاق تاريخ',
          TODAY: 'اليوم',
          YESTERDAY: 'أمس',
          THIS_WEEK: 'هذا الأسبوع',
          THIS_MONTH: 'هذا الشهر',
        }
      : {
          ALL: 'Any date',
          RANGE: 'Date Range',
          TODAY: 'Today',
          YESTERDAY: 'Yesterday',
          THIS_WEEK: 'This Week',
          THIS_MONTH: 'This Month',
        };
    return labels[filter];
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 p-3 lg:p-6">
      <div className="mx-auto max-w-[1440px] space-y-3 lg:space-y-5">
        {printError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {printError}
          </p>
        )}
        <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white shadow-sm shadow-blue-900/15 lg:h-12 lg:w-12 lg:rounded-2xl">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 lg:text-xl">
                {isRtl ? 'سجل مرتجعات المبيعات' : 'Sales Return History'}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                {isRtl ? 'سندات المرتجع والفواتير المرتبطة بها.' : 'Return vouchers and their source invoices.'}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
            <div className="relative w-full sm:flex-1 sm:min-w-[220px] sm:max-w-sm xl:flex-none">
              <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={isRtl ? 'بحث برقم السند أو الفاتورة أو الصنف...' : 'Search voucher, invoice, or item...'}
                className={`w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100 ${isRtl ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none">
              <label className="sr-only" htmlFor="return-history-date-filter">
                {isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
              </label>
              <select
                id="return-history-date-filter"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value as DateFilter)}
                className="min-w-[130px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:flex-none"
              >
                {(['ALL', 'RANGE', 'TODAY', 'YESTERDAY', 'THIS_WEEK', 'THIS_MONTH'] as const).map(
                  (filter) => (
                    <option key={filter} value={filter}>
                      {dateFilterLabel(filter)}
                    </option>
                  )
                )}
              </select>
              {dateFilter === 'RANGE' && (
                <div className="flex min-w-0 flex-1 gap-2 sm:flex-none">
                  <label className="sr-only" htmlFor="return-history-date-from">
                    {isRtl ? 'من تاريخ' : 'From date'}
                  </label>
                  <AppDateInput
                    id="return-history-date-from"
                    value={dateFrom}
                    onChange={(nextDate) => {
                      setDateFrom(nextDate);
                      if (dateTo && nextDate && dateTo < nextDate) {
                        setDateTo('');
                      }
                    }}
                    aria-label={isRtl ? 'من تاريخ' : 'From date'}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:w-36 sm:flex-none"
                  />
                  <label className="sr-only" htmlFor="return-history-date-to">
                    {isRtl ? 'إلى تاريخ' : 'To date'}
                  </label>
                  <AppDateInput
                    id="return-history-date-to"
                    min={dateFrom || undefined}
                    value={dateTo}
                    onChange={setDateTo}
                    aria-label={isRtl ? 'إلى تاريخ' : 'To date'}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:w-36 sm:flex-none"
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-3 lg:p-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isRtl ? 'سندات المرتجع' : 'Return vouchers'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {isRtl ? 'سندات المرتجع والفواتير المرتبطة بها.' : 'Return vouchers and their source invoices.'}
              </p>
            </div>
            <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
              <span>{isRtl ? 'المعروض' : 'Showing'}</span>
              <strong className="font-mono tabular-nums text-slate-900">{filteredVouchers.length}</strong>
              <span>{isRtl ? 'من' : 'of'}</span>
              <span className="font-mono tabular-nums">{vouchers.length}</span>
            </div>
          </div>

          {filteredVouchers.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <CalendarRange className="h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                {hasActiveFilter
                  ? (isRtl ? 'لا توجد سندات مطابقة' : 'No matching return vouchers')
                  : (isRtl ? 'لا توجد سندات مرتجع' : 'No return vouchers found')}
              </p>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setDateFilter('ALL');
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {isRtl ? 'مسح عوامل التصفية' : 'Clear filters'}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="xl:hidden">
                <table className={`w-full table-fixed border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
                  <thead className="bg-slate-50 text-[10px] font-semibold text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="w-[17%] border-e border-slate-200 px-1.5 py-2">{isRtl ? 'السند' : 'Voucher'}</th>
                      <th className="w-[27%] border-e border-slate-200 px-1.5 py-2">{isRtl ? 'التاريخ / الفواتير' : 'Date / invoices'}</th>
                      <th className="w-[26%] border-e border-slate-200 px-1.5 py-2">{isRtl ? 'الأصناف / الكاشير' : 'Items / cashier'}</th>
                      <th className="w-[15%] border-e border-slate-200 px-1 py-2">{isRtl ? 'المبلغ' : 'Refund'}</th>
                      <th className="w-[15%] px-1 py-2 text-center">{isRtl ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredVouchers.map((voucher) => {
                      const itemCount = voucher.items.reduce((sum, item) => sum + item.quantity, 0);
                      return (
                        <React.Fragment key={voucher.id}>
                          <tr className="transition-colors hover:bg-blue-50/40">
                            <td className="min-w-0 break-all border-e border-slate-200 px-2 py-2 align-top font-mono text-[10px] font-bold text-slate-900">
                              {voucher.voucherNumber}
                            </td>
                            <td className="min-w-0 break-words border-e border-slate-200 px-1.5 py-2 align-top text-[10px]">
                              <p className="text-slate-500">{formatDate(voucher.createdAt)}</p>
                              <p className="mt-0.5 break-words text-slate-700">
                                <span className="font-medium text-slate-500">{isRtl ? 'الفواتير: ' : 'Invoices: '}</span>
                                {voucher.sourceInvoices.join(', ')}
                              </p>
                            </td>
                            <td className="min-w-0 break-words border-e border-slate-200 px-1.5 py-2 align-top text-[10px]">
                              <p className="mt-0.5 break-words text-slate-600">
                                {itemCount} {isRtl ? 'أصناف' : itemCount === 1 ? 'item' : 'items'} · {voucher.paymentMethod}
                              </p>
                              <p className="break-words text-slate-500">
                                {isRtl ? 'الكاشير: ' : 'Cashier: '}{voucher.cashierName}
                              </p>
                              <button
                                type="button"
                                aria-expanded={expandedVoucherId === voucher.id}
                                onClick={() =>
                                  setExpandedVoucherId((current) =>
                                    current === voucher.id ? null : voucher.id
                                  )
                                }
                                className="mt-1 rounded px-1 py-0.5 text-[9px] font-semibold text-violet-700 hover:bg-violet-50"
                              >
                                {expandedVoucherId === voucher.id
                                  ? (isRtl ? 'إخفاء التفاصيل' : 'Hide items')
                                  : (isRtl ? 'عرض الأصناف' : 'View items')}
                              </button>
                            </td>
                            <td className="min-w-0 break-all border-e border-slate-200 px-1 py-2 align-top font-mono text-[10px] font-bold tabular-nums text-violet-800">
                              {currency}{voucher.refundAmount.toFixed(2)}
                            </td>
                            <td className="px-1 py-2 align-top">
                              {hasActions && (
                                <div className="flex flex-wrap justify-center gap-1">
                                  <button
                                    type="button"
                                    disabled={isPrinting}
                                    onClick={() => void handlePrintVoucher(voucher)}
                                    title={isRtl ? 'طباعة' : 'Print'}
                                    aria-label={isRtl ? 'طباعة' : 'Print'}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Printer className="h-3 w-3" />
                                  </button>
                                  {onEditVoucher && settings.enableZatcaEinvoice !== true && (
                                    <button
                                      type="button"
                                      onClick={() => onEditVoucher(voucher)}
                                      title={isRtl ? 'تعديل' : 'Edit'}
                                      aria-label={isRtl ? 'تعديل' : 'Edit'}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                  )}
                                  {onDeleteVoucher && settings.enableZatcaEinvoice !== true && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeleteError(null);
                                        setDeletingVoucher(voucher);
                                      }}
                                      title={isRtl ? 'حذف' : 'Delete'}
                                      aria-label={isRtl ? 'حذف' : 'Delete'}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-rose-200 text-rose-700 hover:bg-rose-50"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                          {expandedVoucherId === voucher.id && (
                            <tr>
                              <td colSpan={5} className="bg-slate-50 px-3 py-2">
                                <div className="space-y-1">
                                  {voucher.items.map((item, index) => (
                                    <div key={`${item.saleItemId}-${index}`} className="flex min-w-0 justify-between gap-2 text-[10px]">
                                      <span className="min-w-0 break-words text-slate-700">
                                        {item.productName} · {item.receiptNumber} × {item.quantity}
                                      </span>
                                      <span className="shrink-0 font-mono tabular-nums text-slate-900">
                                        {currency}{item.refundAmount.toFixed(2)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="hidden xl:block">
                <table className={`w-full table-fixed border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="w-[170px] border-e border-slate-200 px-4 py-3">{isRtl ? 'سند المرتجع' : 'Voucher'}</th>
                      <th className="w-[165px] border-e border-slate-200 px-4 py-3">{isRtl ? 'التاريخ' : 'Date'}</th>
                      <th className="border-e border-slate-200 px-4 py-3">{isRtl ? 'فواتير المصدر' : 'Source invoices'}</th>
                      <th className="w-[110px] border-e border-slate-200 px-3 py-3">{isRtl ? 'الأصناف' : 'Items'}</th>
                      <th className="w-[130px] border-e border-slate-200 px-3 py-3">{isRtl ? 'طريقة الرد' : 'Refund method'}</th>
                      <th className={`w-[140px] border-e border-slate-200 px-4 py-3 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'المبلغ' : 'Refund'}</th>
                      <th className="w-[150px] border-e border-slate-200 px-4 py-3">{isRtl ? 'الكاشير' : 'Cashier'}</th>
                      <th className="w-[95px] border-e border-slate-200 px-3 py-3">{isRtl ? 'تفاصيل' : 'Details'}</th>
                      {hasActions && (
                        <th className="w-[150px] px-3 py-3 text-center">
                          {isRtl ? 'إجراءات' : 'Actions'}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredVouchers.map((voucher) => (
                      <React.Fragment key={voucher.id}>
                        <tr className="transition-colors hover:bg-blue-50/40">
                          <td className="border-e border-slate-200 px-4 py-3">
                            <span className="whitespace-nowrap font-mono text-xs font-bold text-slate-900">
                              {voucher.voucherNumber}
                            </span>
                          </td>
                          <td className="whitespace-nowrap border-e border-slate-200 px-4 py-3 text-xs text-slate-600">
                            {formatDate(voucher.createdAt)}
                          </td>
                          <td className="border-e border-slate-200 px-4 py-3 text-xs text-slate-700">
                            <p className="truncate" title={voucher.sourceInvoices.join(', ')}>
                              {voucher.sourceInvoices.join(', ')}
                            </p>
                          </td>
                          <td className="border-e border-slate-200 px-3 py-3 text-xs text-slate-700">
                            {voucher.items.reduce((sum, item) => sum + item.quantity, 0)}
                          </td>
                          <td className="break-words border-e border-slate-200 px-3 py-3 text-xs text-slate-700">
                            {voucher.paymentMethod}
                          </td>
                          <td className={`whitespace-nowrap border-e border-slate-200 px-4 py-3 font-mono text-sm font-bold tabular-nums text-violet-800 ${isRtl ? 'text-left' : 'text-right'}`}>
                            {currency}{voucher.refundAmount.toFixed(2)}
                          </td>
                          <td className="border-e border-slate-200 px-4 py-3">
                            <p className="truncate text-xs text-slate-600" title={voucher.cashierName}>
                              {voucher.cashierName}
                            </p>
                          </td>
                          <td className="border-e border-slate-200 px-3 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedVoucherId((current) =>
                                  current === voucher.id ? null : voucher.id
                                )
                              }
                              className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-50"
                            >
                              {expandedVoucherId === voucher.id
                                ? (isRtl ? 'إخفاء' : 'Hide')
                                : (isRtl ? 'عرض' : 'View')}
                            </button>
                          </td>
                          {hasActions && (
                            <td className="px-3 py-3">
                              <div className="flex justify-center gap-1">
                                <button
                                  type="button"
                                  disabled={isPrinting}
                                  onClick={() => void handlePrintVoucher(voucher)}
                                  title={isRtl ? 'طباعة سند المرتجع' : 'Print return voucher'}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </button>
                                {onEditVoucher && settings.enableZatcaEinvoice !== true && (
                                  <button
                                    type="button"
                                    onClick={() => onEditVoucher(voucher)}
                                    title={isRtl ? 'تعديل سند المرتجع' : 'Edit return voucher'}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {onDeleteVoucher && settings.enableZatcaEinvoice !== true && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeleteError(null);
                                      setDeletingVoucher(voucher);
                                    }}
                                    title={isRtl ? 'حذف سند المرتجع' : 'Delete return voucher'}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                        {expandedVoucherId === voucher.id && (
                          <tr>
                            <td colSpan={hasActions ? 9 : 8} className="bg-slate-50 px-5 py-3">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {voucher.items.map((item, index) => (
                                  <div
                                    key={`${item.saleItemId}-${index}`}
                                    className="flex justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                                  >
                                    <span className="min-w-0 truncate text-slate-700">
                                      {item.productName} · {item.receiptNumber} × {item.quantity}
                                    </span>
                                    <span className="shrink-0 font-mono font-semibold tabular-nums text-slate-900">
                                      {currency}{item.refundAmount.toFixed(2)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
      {printingVoucher && (
        <div className="receipt-print-source">
          <article
            ref={printAreaRef}
            id="sales-return-print-area"
            className={`thermal-receipt-print-area bg-white text-slate-950 ${
              activeFormat === 'A4'
                ? 'paper-a4 font-sans text-xs leading-normal'
                : `${activeFormat === '58mm' ? 'paper-58mm ' : ''}font-mono text-xs leading-relaxed`
            }`}
            style={{
              '--invoice-margin-top': `${invoiceMarginsMm.top}mm`,
              '--invoice-margin-right': `${invoiceMarginsMm.right}mm`,
              '--invoice-margin-bottom': `${invoiceMarginsMm.bottom}mm`,
              '--invoice-margin-left': `${invoiceMarginsMm.left}mm`,
            } as React.CSSProperties}
          >
            <header className="mb-3 border-b border-dashed border-slate-400 pb-3 text-center">
              <h1 className="text-sm font-bold uppercase">{settings.storeName}</h1>
              {settings.storeNameAr && (
                <p className="font-arabic text-xs font-bold" dir="rtl">{settings.storeNameAr}</p>
              )}
              <p className="mt-1 font-bold">
                {isRtl ? 'سند مرتجع المبيعات' : 'SALES RETURN VOUCHER'}
              </p>
            </header>
            <div className="space-y-1 border-b border-dashed border-slate-400 pb-3 text-[11px]">
              <p><strong>{isRtl ? 'رقم السند:' : 'Voucher:'}</strong> {printingVoucher.voucherNumber}</p>
              <p>
                <strong>{isRtl ? 'التاريخ:' : 'Date:'}</strong>{' '}
                {formatDate(printingVoucher.createdAt)}
              </p>
              <p><strong>{isRtl ? 'الكاشير:' : 'Cashier:'}</strong> {printingVoucher.cashierName}</p>
              <p><strong>{isRtl ? 'طريقة الرد:' : 'Refund method:'}</strong> {printingVoucher.paymentMethod}</p>
              <p><strong>{isRtl ? 'فواتير المصدر:' : 'Source invoices:'}</strong> {printingVoucher.sourceInvoices.join(', ')}</p>
            </div>
            <div className="divide-y divide-dashed divide-slate-300">
              {printingVoucher.items.map((item, index) => (
                <div key={`${item.saleItemId}-${index}`} className="flex justify-between gap-3 py-2 text-[11px]">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {isRtl ? item.nameAr || item.productName : item.productName}
                    </p>
                    <p className="text-slate-600">
                      {item.receiptNumber} × {item.quantity}
                    </p>
                  </div>
                  <strong className="shrink-0 font-mono">
                    {currency}{item.refundAmount.toFixed(2)}
                  </strong>
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-1 border-t border-dashed border-slate-400 pt-2 text-[11px]">
              {printingVoucher.taxRefundAmount > 0 && (
                <p className="flex justify-between gap-3">
                  <span>{isRtl ? 'الضريبة المستردة (ضمن الإجمالي)' : 'VAT refunded (included)'}</span>
                  <span className="font-mono">{currency}{printingVoucher.taxRefundAmount.toFixed(2)}</span>
                </p>
              )}
              <p className="flex justify-between gap-3 text-sm font-bold">
                <span>{isRtl ? 'إجمالي المبلغ المسترد' : 'TOTAL REFUND'}</span>
                <span className="font-mono">{currency}{printingVoucher.refundAmount.toFixed(2)}</span>
              </p>
            </div>
            {settings.receiptFooter && (
              <footer className="mt-3 border-t border-dashed border-slate-400 pt-2 text-center text-[10px]">
                {settings.receiptFooter}
              </footer>
            )}
          </article>
        </div>
      )}
      {printModalVoucher && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:p-5"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isPrinting && !showTemplateModal) {
              setPrintModalVoucher(null);
            }
          }}
        >
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-emerald-50/50 px-5 py-3.5">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-slate-900">
                  {isRtl ? 'ملخص وطباعة مرتجع المبيعات' : 'Sales Return Summary & Print'}
                </h2>
                <p className="mt-0.5 font-mono text-xs text-slate-500">
                  {printModalVoucher.voucherNumber} · {formatDate(printModalVoucher.createdAt)}
                </p>
              </div>
              <button
                type="button"
                disabled={isPrinting}
                onClick={() => setPrintModalVoucher(null)}
                aria-label={isRtl ? 'إغلاق' : 'Close'}
                className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-800 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-emerald-50/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {isRtl ? 'الفاتورة الأصلية' : 'Source Invoice(s)'}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs font-bold text-slate-900">
                      {printModalVoucher.sourceInvoices.join(', ') || '—'}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {isRtl ? 'إجمالي المرتجع' : 'Total Refund'}
                    </p>
                    <p className="mt-0.5 font-mono text-xl font-bold tabular-nums text-emerald-700">
                      {currency}{printModalVoucher.refundAmount.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 divide-x divide-slate-200 bg-white text-xs">
                  <div className="px-3 py-2.5">
                    <span className="block text-[10px] text-slate-500">{isRtl ? 'الدفع' : 'Payment'}</span>
                    <span className="mt-0.5 block font-semibold text-slate-900">{printModalVoucher.paymentMethod}</span>
                  </div>
                  <div className="px-3 py-2.5">
                    <span className="block text-[10px] text-slate-500">{isRtl ? 'الضريبة المستردة' : 'VAT Refunded'}</span>
                    <span className="mt-0.5 block font-mono font-semibold text-slate-900">
                      {currency}{printModalVoucher.taxRefundAmount.toFixed(2)}
                    </span>
                  </div>
                  <div className="px-3 py-2.5">
                    <span className="block text-[10px] text-slate-500">{isRtl ? 'الأصناف' : 'Items'}</span>
                    <span className="mt-0.5 block font-mono font-semibold text-slate-900">
                      {printModalVoucher.items.length}
                    </span>
                  </div>
                </div>
              </section>

              <button
                type="button"
                disabled={isPrinting}
                onClick={() => void executePrintReturn()}
                className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-start transition-colors hover:border-emerald-400 hover:bg-emerald-50/50 disabled:opacity-60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
                  {isPrinting ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Printer className="h-4.5 w-4.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    {isRtl ? 'طباعة سند مرتجع المبيعات' : 'Print Sales Return'}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                    {getReturnPrintSummary()}
                  </span>
                </span>
              </button>

              {printError && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {printError}
                </p>
              )}
              {printNotice && (
                <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  {printNotice}
                </p>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={isPrinting}
                  onClick={() => setShowTemplateModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline-offset-4 hover:text-emerald-800 hover:underline disabled:opacity-50"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>{isRtl ? 'اختيار القوالب' : 'Choose Templates'}</span>
                  {oneTimeOverrides['sales-return'] && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 no-underline">
                      {isRtl ? 'مخصص' : 'Custom'}
                    </span>
                  )}
                </button>
                <span className="text-slate-300" aria-hidden="true">|</span>
                <button
                  type="button"
                  disabled={isPrinting}
                  onClick={() => void handleSaveReturnPdf()}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 underline-offset-4 hover:text-emerald-800 hover:underline disabled:opacity-50"
                >
                  {isPrinting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  <span>{isRtl ? 'حفظ كـ PDF' : 'Save as PDF'}</span>
                </button>
              </div>
              <button
                type="button"
                disabled={isPrinting}
                onClick={() => setPrintModalVoucher(null)}
                className="rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {isRtl ? 'تم' : 'Done'}
              </button>
            </footer>
          </div>

          {showTemplateModal && (
            <OneTimeTemplateModal
              settings={settings}
              defaultFormatFallback={activeFormat}
              documents={[{ id: 'sales-return', label: isRtl ? 'مرتجع المبيعات' : 'Sales Return' }]}
              initialDocument="sales-return"
              overrides={oneTimeOverrides}
              onBuildPreviewJob={(_docType, override) => createReturnPrintJob(printModalVoucher, override)}
              onApply={(next) => setOneTimeOverrides({ 'sales-return': next['sales-return'] })}
              onClose={() => setShowTemplateModal(false)}
            />
          )}
        </div>
      )}

      {deletingVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isRtl ? 'حذف سند المرتجع' : 'Delete return voucher'}
                </h3>
                <p className="text-xs text-slate-500">{deletingVoucher.voucherNumber}</p>
              </div>
            </div>
            <p className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs leading-relaxed text-slate-600">
              {isRtl
                ? 'سيتم حذف السند وإلغاء الكميات المرتجعة من المخزون. لا يمكن التراجع عن هذا الإجراء.'
                : 'This permanently deletes the voucher and reverses its returned quantities from inventory.'}
            </p>
            {deleteError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {deleteError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingVoucher(null)}
                className="rounded-lg px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDeleting
                  ? (isRtl ? 'جارٍ الحذف...' : 'Deleting...')
                  : (isRtl ? 'حذف نهائياً' : 'Delete permanently')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
