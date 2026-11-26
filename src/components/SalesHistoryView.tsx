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
import { AppDateInput } from './AppDateInput';
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
    getInvoiceDateTime(sale.invoiceDate, sale.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-GB', {
      year: 'numeric',
      month: '2-digit',
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
        title={sale.appScreenMode === 'flyerp'
          ? isRtl ? 'طباعة فاتورة السفر' : 'Print travel invoice'
          : isRtl ? 'إعادة طباعة الوصل' : 'Reprint receipt'}
        aria-label={sale.appScreenMode === 'flyerp'
          ? isRtl ? 'طباعة فاتورة السفر' : 'Print travel invoice'
          : isRtl ? 'إعادة طباعة الوصل' : 'Reprint receipt'}
      >
        <Printer className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
      </button>
      {onEditInvoice && sale.status === 'COMPLETED' && !sale.returnStatus && (
        <button
          type="button"
          onClick={() => onEditInvoice(sale)}
          className="inline-flex h-7 min-w-0 items-center justify-center gap-0.5 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-1 text-[9px] font-semibold text-amber-800 transition-colors hover:border-amber-300 hover:bg-amber-100 hover:text-amber-900 lg:h-8 lg:gap-1 lg:px-2 lg:text-xs"
          title={isRtl ? 'تعديل الفاتورة' : 'Edit invoice'}
          aria-label={isRtl ? 'تعديل الفاتورة' : 'Edit invoice'}
        >
          <Edit2 className="h-3 w-3 shrink-0 lg:h-3.5 lg:w-3.5" />
          <span>{isRtl ? 'تعديل' : 'Edit'}</span>
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
    <div className="flex-1 min-h-0 overflow-y-auto bg-white p-3 lg:p-4">
      <div className="mx-auto max-w-[1440px] space-y-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-2.5' : 'left-2.5'}`} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isRtl ? 'بحث برقم الوصل، العميل، أو الكاشير...' : 'Search receipt, customer, or cashier...'}
                className={`w-full rounded-lg border border-slate-200 bg-white py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none ${isRtl ? 'pr-8 pl-2.5' : 'pl-8 pr-2.5'}`}
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
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
                  className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    statusFilter === filter.value
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    {filter.count}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                aria-label={isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="ALL">{isRtl ? 'كل التواريخ' : 'Any date'}</option>
                <option value="RANGE">{isRtl ? 'نطاق تاريخ' : 'Date Range'}</option>
                <option value="TODAY">{isRtl ? 'اليوم' : 'Today'}</option>
                <option value="YESTERDAY">{isRtl ? 'أمس' : 'Yesterday'}</option>
                <option value="THIS_WEEK">{isRtl ? 'هذا الأسبوع' : 'This Week'}</option>
                <option value="THIS_MONTH">{isRtl ? 'هذا الشهر' : 'This Month'}</option>
              </select>
              {dateFilter === 'RANGE' && (
                <div className="flex gap-1.5">
                  <label className="sr-only" htmlFor="sales-date-from">
                    {isRtl ? 'من تاريخ' : 'From date'}
                  </label>
                  <AppDateInput
                    id="sales-date-from"
                    value={dateFrom}
                    onChange={(nextDate) => {
                      setDateFrom(nextDate);
                      if (dateTo && nextDate && dateTo < nextDate) setDateTo('');
                    }}
                    aria-label={isRtl ? 'من تاريخ' : 'From date'}
                    className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
                  />
                  <label className="sr-only" htmlFor="sales-date-to">
                    {isRtl ? 'إلى تاريخ' : 'To date'}
                  </label>
                  <AppDateInput
                    id="sales-date-to"
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={setDateTo}
                    aria-label={isRtl ? 'إلى تاريخ' : 'To date'}
                    className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
            {filteredSales.length} / {sales.length}
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          {filteredSales.length === 0 ? (
            emptyState
          ) : (
            <table className={`w-full min-w-[780px] border-collapse text-xs ${isRtl ? 'text-right' : 'text-left'}`}>
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">{isRtl ? 'رقم الوصل' : 'Receipt'}</th>
                  <th className="px-3 py-2.5">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="px-3 py-2.5">{isRtl ? 'العميل' : 'Customer'}</th>
                  <th className="px-3 py-2.5">{isRtl ? 'الأصناف' : 'Items'}</th>
                  <th className="px-3 py-2.5">{isRtl ? 'الدفع' : 'Payment'}</th>
                  <th className={`px-3 py-2.5 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجمالي' : 'Total'}</th>
                  <th className="px-3 py-2.5">{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2.5 text-center">{isRtl ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
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
                    <tr key={sale.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-slate-900">
                        <span>{sale.receiptNumber}</span>
                        {linkedReturnVouchers.length > 0 && (
                          <span className="ml-1.5 text-[10px] font-normal text-violet-700">
                            ({linkedReturnVouchers.map((v) => v.voucherNumber).join(', ')})
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {formatSaleDate(sale)}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 font-medium text-slate-900" title={`${sale.customerName} (${sale.cashierName})`}>
                        {sale.customerName}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-slate-700">
                        {itemCount}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {paymentLabel(sale.paymentMethod)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 font-mono font-semibold tabular-nums text-slate-900 ${isRtl ? 'text-left' : 'text-right'}`}>
                        {c}{sale.total.toFixed(2)}
                        {(sale.returnedTotal || 0) > 0 && (
                          <span className="ml-1.5 text-[10px] font-normal text-violet-700">
                            (-{c}{sale.returnedTotal?.toFixed(2)})
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
                          {sale.returnStatus === 'FULL'
                            ? (isRtl ? 'مُعادة' : 'Returned')
                            : sale.returnStatus === 'PARTIAL'
                              ? (isRtl ? 'إرجاع جزئي' : 'Partial')
                              : completed
                                ? (isRtl ? 'مكتملة' : 'Completed')
                                : (isRtl ? 'ملغاة' : 'Voided')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">{renderActions(sale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
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
