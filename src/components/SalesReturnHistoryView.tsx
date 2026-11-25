import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarRange, Pencil, Printer, Receipt, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { PaperWidth, SalesReturnVoucher, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { matchesDateBounds, resolveDateBounds, type DateFilter } from '../utils/dateFilters';
import {
  applyThermalPageSize,
  applyThermalPageWidth,
  buildStandaloneThermalPrintHtml,
  measureThermalPageSize,
  printWithThermalPageSize,
  resolveInvoiceMarginsMm,
  waitPrintSettlingDelay,
} from '../utils/thermalPrinting';

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
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);
  const currency = isRtl ? 'ر.س ' : settings.currencySymbol || 'SAR ';
  const activeFormat: PaperWidth = settings.paperWidth || '80mm';
  const templateSettings = settings.invoiceTemplates?.[activeFormat];
  const invoiceMarginsMm = resolveInvoiceMarginsMm(
    activeFormat,
    templateSettings?.invoiceMarginsMm
  );
  const hasActions = true;

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

  const handlePrintVoucher = async (voucher: SalesReturnVoucher) => {
    setPrintError(null);
    setPrintingVoucher(voucher);
    setIsPrinting(true);
    document.body.classList.add('receipt-printing');

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const thermalWidthMm = activeFormat === '58mm' ? 58 : 80;
      const paddingCss = `${invoiceMarginsMm.top}mm ${invoiceMarginsMm.right}mm ${invoiceMarginsMm.bottom}mm ${invoiceMarginsMm.left}mm`;
      const pageSize = activeFormat === 'A4'
        ? { width: 210_000, height: 297_000 }
        : measureThermalPageSize(printAreaRef.current, {
            elementWidthMm: thermalWidthMm,
            pageWidthMm: thermalWidthMm,
            padding: paddingCss,
            container: document.querySelector('.receipt-print-source'),
          });

      if (window.electronAPI?.isElectron) {
        const printerMode = templateSettings?.printerMode
          || (templateSettings?.defaultPrinter ? 'saved-printer' : 'system-default');
        const html = buildStandaloneThermalPrintHtml(printAreaRef.current, {
          widthMm: activeFormat === 'A4' ? 210 : thermalWidthMm,
          pageSize,
          padding: activeFormat === 'A4' ? undefined : paddingCss,
        });
        const result = await window.electronAPI.printReceipt({
          silent: printerMode !== 'choose-at-print-time',
          printerName: printerMode === 'saved-printer'
            ? templateSettings?.defaultPrinter || undefined
            : undefined,
          pageSize,
          html,
        });
        if (!result.ok) {
          throw new Error(result.error || 'Return voucher could not be printed.');
        }
      } else {
        if (activeFormat !== 'A4') {
          printWithThermalPageSize(pageSize);
        } else {
          window.print();
        }
      }
    } catch (error) {
      console.error('Failed to print sales return voucher:', error);
      setPrintError(error instanceof Error ? error.message : 'Return voucher could not be printed.');
    } finally {
      document.body.classList.remove('receipt-printing');
      setIsPrinting(false);
      setPrintingVoucher(null);
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
    new Date(date).toLocaleString(isRtl ? 'ar-SA' : 'en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
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
                  <input
                    id="return-history-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(event) => {
                      setDateFrom(event.target.value);
                      if (dateTo && event.target.value && dateTo < event.target.value) {
                        setDateTo('');
                      }
                    }}
                    aria-label={isRtl ? 'من تاريخ' : 'From date'}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:w-36 sm:flex-none"
                  />
                  <label className="sr-only" htmlFor="return-history-date-to">
                    {isRtl ? 'إلى تاريخ' : 'To date'}
                  </label>
                  <input
                    id="return-history-date-to"
                    type="date"
                    min={dateFrom || undefined}
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
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
                                  {onEditVoucher && (
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
                                  {onDeleteVoucher && (
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
                                {onEditVoucher && (
                                  <button
                                    type="button"
                                    onClick={() => onEditVoucher(voucher)}
                                    title={isRtl ? 'تعديل سند المرتجع' : 'Edit return voucher'}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {onDeleteVoucher && (
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
