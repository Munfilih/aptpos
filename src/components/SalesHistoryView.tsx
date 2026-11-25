import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Edit2,
  Printer,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type { PaymentMethod, Sale, SalesReturnVoucher, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import {
  getInvoiceDateTime,
  matchesDateBounds,
  resolveDateBounds,
  type DateFilter,
} from '../utils/dateFilters';

interface SalesHistoryViewProps {
  sales: Sale[];
  returnVouchers: SalesReturnVoucher[];
  settings: StoreSettings;
  onReprintSale: (sale: Sale) => void;
  onOpenReturnRegister?: (sale: Sale) => void;
  onDeleteSale?: (saleId: number) => Promise<void>;
  onEditInvoice?: (sale: Sale) => void;
}

export const SalesHistoryView: React.FC<SalesHistoryViewProps> = ({
  sales,
  returnVouchers,
  settings,
  onReprintSale,
  onOpenReturnRegister,
  onDeleteSale,
  onEditInvoice,
}) => {
  const { isRtl } = useLanguage();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'RETURNED'>('ALL');
  const [dateFilter, setDateFilter] = useState<DateFilter>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [deletingSaleId, setDeletingSaleId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const c = isRtl ? 'ر.س ' : (settings.currencySymbol || 'SAR ');

  const dateBounds = useMemo(
    () => resolveDateBounds(dateFilter, dateFrom, dateTo),
    [dateFilter, dateFrom, dateTo]
  );

  const handleConfirmDelete = async () => {
    if (!deletingSaleId || !onDeleteSale) return;
    setIsDeleting(true);
    try {
      await onDeleteSale(deletingSaleId);
      setDeletingSaleId(null);
      setDeleteError(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete sale.');
    } finally {
      setIsDeleting(false);
    }
  };

  const summary = useMemo(() => {
    const completed = sales.filter((s) => s.status === 'COMPLETED');
    const returnedCount = sales.filter((s) => Boolean(s.returnStatus)).length;
    return {
      completedCount: completed.length,
      returnedCount,
    };
  }, [sales]);

  const returnVouchersBySale = useMemo(() => {
    const vouchersBySale = new Map<number, SalesReturnVoucher[]>();
    for (const voucher of returnVouchers) {
      for (const saleId of new Set(voucher.items.map((item) => item.saleId))) {
        const vouchers = vouchersBySale.get(saleId) || [];
        vouchers.push(voucher);
        vouchersBySale.set(saleId, vouchers);
      }
    }
    return vouchersBySale;
  }, [returnVouchers]);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (statusFilter === 'COMPLETED' && s.status !== 'COMPLETED') return false;
      if (statusFilter === 'RETURNED' && !s.returnStatus) return false;
      if (!matchesDateBounds(s.invoiceDate || s.createdAt, dateBounds)) return false;
      if (search.trim() !== '') {
        const q = search.trim().toLowerCase();
        return (
          s.receiptNumber.toLowerCase().includes(q) ||
          s.customerName.toLowerCase().includes(q) ||
          s.cashierName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sales, statusFilter, search, dateBounds]);

  const formatSaleDate = (sale: Sale) =>
    getInvoiceDateTime(sale.invoiceDate, sale.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const formatReturnVoucherDate = (date: string) =>
    new Date(date).toLocaleString(isRtl ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const paymentLabel = (method: PaymentMethod) =>
    method === 'Cash'
      ? (isRtl ? 'نقداً' : 'Cash')
      : method === 'Card'
        ? (isRtl ? 'بطاقة' : 'Card')
        : method === 'Split'
          ? (isRtl ? 'مجزأ' : 'Split')
          : method;

  const renderActions = (sale: Sale) => (
    <div className="flex flex-wrap items-center justify-center gap-1">
      <button
        type="button"
        onClick={() => onReprintSale(sale)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 lg:h-8 lg:w-8"
        title={isRtl ? 'إعادة طباعة الوصل' : 'Reprint receipt'}
        aria-label={isRtl ? 'إعادة طباعة الوصل' : 'Reprint receipt'}
      >
        <Printer className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
      </button>
      {onEditInvoice && sale.status === 'COMPLETED' && !sale.returnStatus && (
        <button
          type="button"
          onClick={() => onEditInvoice(sale)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 lg:h-8 lg:w-8"
          title={isRtl ? 'تعديل الفاتورة' : 'Edit invoice'}
          aria-label={isRtl ? 'تعديل الفاتورة' : 'Edit invoice'}
        >
          <Edit2 className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
        </button>
      )}
      {onOpenReturnRegister && sale.status === 'COMPLETED' && sale.returnStatus !== 'FULL' && (
        <button
          type="button"
          onClick={() => onOpenReturnRegister(sale)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 lg:h-8 lg:w-8"
          title={isRtl ? 'إرجاع أصناف' : 'Return items'}
          aria-label={isRtl ? 'إرجاع أصناف' : 'Return items'}
        >
          <RotateCcw className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
        </button>
      )}
      {onDeleteSale && !sale.returnStatus && (
        <button
          type="button"
          disabled={isDeleting}
          onClick={() => {
            setDeletingSaleId(sale.id);
            setDeleteError(null);
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 lg:h-8 lg:w-8"
          title={isRtl ? 'حذف سجل المبيعة' : 'Delete sale entry'}
          aria-label={isRtl ? 'حذف سجل المبيعة' : 'Delete sale entry'}
        >
          <Trash2 className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
        </button>
      )}
    </div>
  );

  const hasActiveFilter = search.trim() !== '' || statusFilter !== 'ALL' || dateFilter !== 'ALL';
  const emptyState = (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Search className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-900">
        {hasActiveFilter
          ? (isRtl ? 'لم يتم العثور على نتائج' : 'No matching sales')
          : (isRtl ? 'لا توجد مبيعات بعد' : 'No sales yet')}
      </h3>
      <p className="mt-1 max-w-sm text-xs text-slate-500">
        {hasActiveFilter
          ? (isRtl ? 'جرّب تغيير البحث أو عوامل التصفية.' : 'Try changing your search or filters.')
          : (isRtl ? 'ستظهر الفواتير المكتملة والمرتجعة والملغاة هنا.' : 'Completed, returned, and voided receipts will appear here.')}
      </p>
      {hasActiveFilter && (
        <button
          type="button"
          onClick={() => {
            setSearch('');
            setStatusFilter('ALL');
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
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 p-3 lg:p-6">
      <div className="mx-auto max-w-[1440px] space-y-3 lg:space-y-5">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="relative w-full sm:flex-1 sm:min-w-[220px] sm:max-w-sm xl:flex-none">
              <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isRtl ? 'بحث برقم الوصل، العميل، أو الكاشير...' : 'Search receipt, customer, or cashier...'}
                className={`w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100 ${isRtl ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
              />
            </div>
            <div className="flex w-full flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-auto">
              {[
                {
                  value: 'ALL' as const,
                  label: isRtl ? 'الكل' : 'All',
                  count: sales.length,
                },
                {
                  value: 'COMPLETED' as const,
                  label: isRtl ? 'مكتملة' : 'Completed',
                  count: summary.completedCount,
                },
                {
                  value: 'RETURNED' as const,
                  label: isRtl ? 'مرتجعة' : 'Returned',
                  count: summary.returnedCount,
                },
              ].map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={statusFilter === filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                    statusFilter === filter.value
                      ? 'bg-blue-700 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white hover:text-slate-900'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className={`font-mono text-[10px] tabular-nums ${statusFilter === filter.value ? 'text-blue-100' : 'text-slate-400'}`}>
                    {filter.count}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none">
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                aria-label={isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
                className="min-w-[130px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:flex-none"
              >
                <option value="ALL">{isRtl ? 'كل التواريخ' : 'Any date'}</option>
                <option value="RANGE">{isRtl ? 'نطاق تاريخ' : 'Date Range'}</option>
                <option value="TODAY">{isRtl ? 'اليوم' : 'Today'}</option>
                <option value="YESTERDAY">{isRtl ? 'أمس' : 'Yesterday'}</option>
                <option value="THIS_WEEK">{isRtl ? 'هذا الأسبوع' : 'This Week'}</option>
                <option value="THIS_MONTH">{isRtl ? 'هذا الشهر' : 'This Month'}</option>
              </select>
              {dateFilter === 'RANGE' && (
                <div className="flex min-w-0 flex-1 gap-2 sm:flex-none">
                  <label className="sr-only" htmlFor="sales-date-from">
                    {isRtl ? 'من تاريخ' : 'From date'}
                  </label>
                  <input
                    id="sales-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      const nextDate = e.target.value;
                      setDateFrom(nextDate);
                      if (dateTo && nextDate && dateTo < nextDate) setDateTo('');
                    }}
                    aria-label={isRtl ? 'من تاريخ' : 'From date'}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:w-36 sm:flex-none"
                  />
                  <label className="sr-only" htmlFor="sales-date-to">
                    {isRtl ? 'إلى تاريخ' : 'To date'}
                  </label>
                  <input
                    id="sales-date-to"
                    type="date"
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(e) => setDateTo(e.target.value)}
                    aria-label={isRtl ? 'إلى تاريخ' : 'To date'}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:w-36 sm:flex-none"
                  />
                </div>
              )}
            </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-3 lg:p-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isRtl ? 'المعاملات' : 'Transactions'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {isRtl ? 'الفواتير وفق البحث والتصفية المحددين.' : 'Receipts matching your search and filters.'}
              </p>
            </div>
            <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
              <span>{isRtl ? 'المعروض' : 'Showing'}</span>
              <span className="font-mono font-bold tabular-nums text-slate-900">{filteredSales.length}</span>
              <span>{isRtl ? 'من' : 'of'}</span>
              <span className="font-mono tabular-nums">{sales.length}</span>
            </div>
          </div>
          {filteredSales.length === 0 ? (
            emptyState
          ) : (
            <>
              <div className="xl:hidden">
                <table className={`w-full table-fixed border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
                  <thead className="bg-slate-50 text-[10px] font-semibold text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="w-[17%] border-e border-slate-200 px-1.5 py-2">{isRtl ? 'الوصل' : 'Receipt'}</th>
                      <th className="w-[21%] border-e border-slate-200 px-1.5 py-2">{isRtl ? 'البيع' : 'Sale'}</th>
                      <th className="w-[26%] border-e border-slate-200 px-1.5 py-2">{isRtl ? 'العميل' : 'Customer'}</th>
                      <th className="w-[20%] border-e border-slate-200 px-1.5 py-2">{isRtl ? 'الإجمالي / الحالة' : 'Total / status'}</th>
                      <th className="w-[16%] px-1 py-2 text-center">{isRtl ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSales.map((sale) => {
                      const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
                      const completed = sale.status === 'COMPLETED';
                      const linkedReturnVouchers = returnVouchersBySale.get(sale.id) || [];
                      const statusClass =
                        sale.returnStatus === 'FULL'
                          ? 'bg-violet-50 text-violet-700'
                          : sale.returnStatus === 'PARTIAL'
                            ? 'bg-amber-50 text-amber-700'
                            : completed
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700';
                      return (
                        <tr key={sale.id} className="transition-colors hover:bg-blue-50/40">
                          <td className="min-w-0 break-words border-e border-slate-200 px-2 py-2 align-top">
                            <span className="break-all font-mono text-[10px] font-bold text-slate-900">
                              {sale.receiptNumber}
                            </span>
                            {linkedReturnVouchers.map((voucher) => (
                              <span key={voucher.id} className="mt-1 block break-words text-[9px] font-medium text-violet-700">
                                {isRtl ? 'مرتجع: ' : 'Return: '}{voucher.voucherNumber}
                              </span>
                            ))}
                          </td>
                          <td className="min-w-0 break-words border-e border-slate-200 px-1.5 py-2 align-top text-[10px]">
                            <p className="text-slate-500">{formatSaleDate(sale)}</p>
                            <p className="mt-0.5 text-slate-600">
                              {itemCount} {isRtl ? 'صنف' : itemCount === 1 ? 'item' : 'items'} · {paymentLabel(sale.paymentMethod)}
                            </p>
                          </td>
                          <td className="min-w-0 break-words border-e border-slate-200 px-1.5 py-2 align-top text-[10px]">
                            <p className="font-semibold text-slate-900">{sale.customerName}</p>
                            <p className="mt-0.5 text-slate-500">
                              {isRtl ? 'الكاشير: ' : 'Cashier: '}{sale.cashierName}
                            </p>
                          </td>
                          <td className="min-w-0 break-words border-e border-slate-200 px-1.5 py-2 align-top">
                            <p className="whitespace-nowrap font-mono text-[10px] font-bold tabular-nums text-slate-900">
                              {c}{sale.total.toFixed(2)}
                            </p>
                            {(sale.returnedTotal || 0) > 0 && (
                              <p className="mt-0.5 break-words text-[9px] font-medium text-violet-700">
                                {isRtl ? 'مسترد: ' : 'Refunded: '}{c}{sale.returnedTotal?.toFixed(2)}
                                {sale.returnPaymentMethods && sale.returnPaymentMethods.length > 0 &&
                                  ` · ${sale.returnPaymentMethods.map(paymentLabel).join(', ')}`}
                              </p>
                            )}
                            <span className={`mt-1 inline-flex max-w-full items-center gap-1 whitespace-normal break-words rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-3 ${statusClass}`}>
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sale.returnStatus === 'FULL' ? 'bg-violet-500' : sale.returnStatus === 'PARTIAL' ? 'bg-amber-500' : completed ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                              {sale.returnStatus === 'FULL'
                                ? (isRtl ? 'مُعادة' : 'Returned')
                                : sale.returnStatus === 'PARTIAL'
                                  ? (isRtl ? 'إرجاع جزئي' : 'Partial')
                                  : completed
                                    ? (isRtl ? 'مكتملة' : 'Done')
                                    : (isRtl ? 'ملغاة' : 'Voided')}
                            </span>
                          </td>
                          <td className="px-1 py-2 align-top">{renderActions(sale)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="hidden xl:block">
              <table className={`w-full table-fixed border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="w-[150px] border-e border-slate-200 px-4 py-3">{isRtl ? 'رقم الوصل' : 'Receipt'}</th>
                    <th className="w-[150px] border-e border-slate-200 px-4 py-3">{isRtl ? 'التاريخ والوقت' : 'Date & time'}</th>
                    <th className="border-e border-slate-200 px-4 py-3">{isRtl ? 'العميل / الكاشير' : 'Customer / cashier'}</th>
                    <th className="w-[90px] border-e border-slate-200 px-3 py-3">{isRtl ? 'الأصناف' : 'Items'}</th>
                    <th className="w-[100px] border-e border-slate-200 px-3 py-3">{isRtl ? 'الدفع' : 'Payment'}</th>
                    <th className={`w-[135px] border-e border-slate-200 px-4 py-3 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجمالي' : 'Total'}</th>
                    <th className="w-[135px] border-e border-slate-200 px-3 py-3">{isRtl ? 'الحالة' : 'Status'}</th>
                    <th className="w-[160px] px-4 py-3 text-center">{isRtl ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.map((sale) => {
                    const itemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
                    const completed = sale.status === 'COMPLETED';
                    const linkedReturnVouchers = returnVouchersBySale.get(sale.id) || [];
                    const returnBadgeClass =
                      sale.returnStatus === 'FULL'
                        ? 'bg-violet-50 text-violet-700'
                        : sale.returnStatus === 'PARTIAL'
                          ? 'bg-amber-50 text-amber-700'
                          : completed
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700';
                    return (
                      <tr key={sale.id} className="transition-colors hover:bg-blue-50/40">
                        <td className="border-e border-slate-200 px-4 py-3.5">
                          <span className="whitespace-nowrap font-mono text-xs font-bold text-slate-900">
                            {sale.receiptNumber}
                          </span>
                          {linkedReturnVouchers.map((voucher) => (
                            <span key={voucher.id} className="mt-1 block whitespace-normal break-words text-[10px] font-medium text-violet-700">
                              {isRtl ? 'سند مرتجع: ' : 'Return: '}
                              {voucher.voucherNumber} · {formatReturnVoucherDate(voucher.createdAt)}
                            </span>
                          ))}
                        </td>
                        <td className="whitespace-nowrap border-e border-slate-200 px-4 py-3.5 text-xs text-slate-600">
                          {formatSaleDate(sale)}
                        </td>
                        <td className="min-w-0 border-e border-slate-200 px-4 py-3.5">
                          <p className="truncate text-xs font-semibold text-slate-900" title={sale.customerName}>
                            {sale.customerName}
                          </p>
                          <p className="mt-1 truncate text-[11px] text-slate-500" title={sale.cashierName}>
                            {isRtl ? `الكاشير: ${sale.cashierName}` : `Cashier: ${sale.cashierName}`}
                          </p>
                        </td>
                        <td className="border-e border-slate-200 px-3 py-3.5">
                          <span className="inline-flex rounded-lg bg-slate-100 px-2 py-1 font-mono text-[11px] font-semibold tabular-nums text-slate-700">
                            {itemCount} {isRtl ? 'صنف' : itemCount === 1 ? 'item' : 'items'}
                          </span>
                        </td>
                        <td className="border-e border-slate-200 px-3 py-3.5 text-xs font-medium text-slate-700">
                          {paymentLabel(sale.paymentMethod)}
                        </td>
                        <td className={`border-e border-slate-200 px-4 py-3.5 font-mono text-sm font-bold tabular-nums text-slate-900 ${isRtl ? 'text-left' : 'text-right'}`}>
                          <span className="block whitespace-nowrap">{c}{sale.total.toFixed(2)}</span>
                          {(sale.returnedTotal || 0) > 0 && (
                            <span className="mt-1 block whitespace-normal break-words font-sans text-[10px] font-medium text-violet-700">
                              {isRtl ? 'المسترد:' : 'Refunded:'} {c}{sale.returnedTotal?.toFixed(2)}
                              {sale.returnPaymentMethods && sale.returnPaymentMethods.length > 0 &&
                                ` · ${sale.returnPaymentMethods.map(paymentLabel).join(', ')}`}
                            </span>
                          )}
                        </td>
                        <td className="border-e border-slate-200 px-3 py-3.5">
                          <span className={`inline-flex max-w-full items-center gap-1.5 whitespace-normal break-words rounded-full px-2.5 py-1 text-[11px] font-semibold leading-4 ${returnBadgeClass}`}>
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sale.returnStatus === 'FULL' ? 'bg-violet-500' : sale.returnStatus === 'PARTIAL' ? 'bg-amber-500' : completed ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            <span className="min-w-0">
                              {sale.returnStatus === 'FULL'
                                ? (isRtl ? 'مُعادة' : 'Returned')
                                : sale.returnStatus === 'PARTIAL'
                                  ? (isRtl ? 'إرجاع جزئي' : 'Partially returned')
                                  : completed
                                    ? (isRtl ? 'مكتملة' : 'Completed')
                                    : (isRtl ? 'ملغاة' : 'Voided')}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3.5">{renderActions(sale)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>
      </div>

      {deletingSaleId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isRtl ? 'حذف سجل المبيعة' : 'Delete sales entry'}
                </h3>
                <p className="text-xs text-slate-500">
                  {isRtl ? 'حذف نهائي لهذه المعاملة' : 'Permanently delete this transaction'}
                </p>
              </div>
            </div>
            <p className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs leading-relaxed text-slate-600">
              {isRtl
                ? 'هل أنت متأكد من حذف هذا السجل نهائياً؟ ستتم إعادة الكميات غير المرتجعة من الفاتورة إلى المخزون.'
                : 'Permanently delete this sale? Any quantities not already returned will be restored to inventory.'}
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
                onClick={() => setDeletingSaleId(null)}
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
                {isDeleting ? (isRtl ? 'جارٍ الحذف...' : 'Deleting...') : (isRtl ? 'حذف نهائياً' : 'Delete permanently')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
