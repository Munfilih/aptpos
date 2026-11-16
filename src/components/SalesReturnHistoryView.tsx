import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarRange, Pencil, Receipt, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { SalesReturnVoucher, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { matchesDateBounds, resolveDateBounds, type DateFilter } from '../utils/dateFilters';

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
  const currency = isRtl ? 'ر.س ' : settings.currencySymbol || 'SAR ';
  const hasActions = Boolean(onEditVoucher || onDeleteVoucher);

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

  const totalRefund = filteredVouchers.reduce((sum, voucher) => sum + voucher.refundAmount, 0);
  const totalTaxRefund = filteredVouchers.reduce(
    (sum, voucher) => sum + voucher.taxRefundAmount,
    0
  );
  const totalItems = filteredVouchers.reduce(
    (sum, voucher) => sum + voucher.items.reduce((quantity, item) => quantity + item.quantity, 0),
    0
  );

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
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-700 text-white shadow-sm">
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
          <div className="inline-flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
            <span className="text-slate-500">{isRtl ? 'السندات' : 'Vouchers'}</span>
            <span className="font-mono font-bold tabular-nums text-slate-900">
              {filteredVouchers.length}
            </span>
          </div>
        </header>

        <section
          aria-label={isRtl ? 'ملخص المرتجعات' : 'Return summary'}
          className="grid grid-cols-2 gap-2 xl:grid-cols-3 lg:gap-3"
        >
          {[
            {
              label: isRtl ? 'إجمالي المبالغ المستردة' : 'Total refunds',
              value: `${currency}${totalRefund.toFixed(2)}`,
            },
            {
              label: isRtl ? 'الأصناف المرتجعة' : 'Items returned',
              value: String(totalItems),
            },
            {
              label: isRtl ? 'ضريبة مستردة' : 'Tax refunded',
              value: `${currency}${totalTaxRefund.toFixed(2)}`,
            },
          ].map((metric) => (
            <article
              key={metric.label}
              className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:rounded-2xl lg:p-4"
            >
              <p className="truncate text-[10px] font-medium text-slate-500 lg:text-xs">
                {metric.label}
              </p>
              <p className="mt-1 truncate font-mono text-base font-bold tabular-nums text-slate-900 lg:text-xl">
                {metric.value}
              </p>
            </article>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-3 border-b border-slate-200 p-3 lg:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {isRtl ? 'سندات المرتجع' : 'Return vouchers'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {isRtl ? 'ابحث بالسند أو الفاتورة أو الصنف.' : 'Search by voucher, invoice, or item.'}
                </p>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
                <span>{isRtl ? 'المعروض' : 'Showing'}</span>
                <strong className="font-mono tabular-nums text-slate-900">{filteredVouchers.length}</strong>
                <span>{isRtl ? 'من' : 'of'}</span>
                <span className="font-mono tabular-nums">{vouchers.length}</span>
              </div>
            </div>
            <div className="grid gap-2 xl:grid-cols-[minmax(240px,1fr)_auto] xl:items-center">
              <div className="relative">
                <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={isRtl ? 'بحث برقم السند أو الفاتورة أو الصنف...' : 'Search voucher, invoice, or item...'}
                  className={`w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-violet-100 ${isRtl ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="return-history-date-filter">
                  {isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
                </label>
                <select
                  id="return-history-date-filter"
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value as DateFilter)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-100"
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
                  <>
                    <label className="sr-only" htmlFor="return-history-date-from">From date</label>
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
                      className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                    <label className="sr-only" htmlFor="return-history-date-to">To date</label>
                    <input
                      id="return-history-date-to"
                      type="date"
                      min={dateFrom || undefined}
                      value={dateTo}
                      onChange={(event) => setDateTo(event.target.value)}
                      className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {filteredVouchers.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <CalendarRange className="h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                {isRtl ? 'لا توجد سندات مرتجع' : 'No return vouchers found'}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 bg-slate-50 p-2 lg:hidden">
                {filteredVouchers.map((voucher) => (
                  <article
                    key={voucher.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-bold text-slate-900">
                          {voucher.voucherNumber}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {formatDate(voucher.createdAt)} · {voucher.cashierName}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-sm font-bold tabular-nums text-violet-800">
                        {currency}{voucher.refundAmount.toFixed(2)}
                      </p>
                    </div>
                    <p className="mt-2 truncate text-xs text-slate-700" title={voucher.sourceInvoices.join(', ')}>
                      {isRtl ? 'الفواتير:' : 'Invoices:'} {voucher.sourceInvoices.join(', ')}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-slate-500">
                        {voucher.items.reduce((sum, item) => sum + item.quantity, 0)} {isRtl ? 'أصناف' : 'items'} · {voucher.paymentMethod}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedVoucherId((current) =>
                            current === voucher.id ? null : voucher.id
                          )
                        }
                        className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-50"
                      >
                        {expandedVoucherId === voucher.id
                          ? (isRtl ? 'إخفاء التفاصيل' : 'Hide details')
                          : (isRtl ? 'التفاصيل' : 'Details')}
                      </button>
                    </div>
                    {expandedVoucherId === voucher.id && (
                      <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                        {voucher.items.map((item, index) => (
                          <div key={`${item.saleItemId}-${index}`} className="flex justify-between gap-2 text-[10px]">
                            <span className="min-w-0 truncate text-slate-600">
                              {item.productName} · {item.receiptNumber} × {item.quantity}
                            </span>
                            <span className="shrink-0 font-mono tabular-nums text-slate-700">
                              {currency}{item.refundAmount.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {hasActions && (
                      <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-2">
                        {onEditVoucher && (
                          <button
                            type="button"
                            onClick={() => onEditVoucher(voucher)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="h-3 w-3" />
                            {isRtl ? 'تعديل' : 'Edit'}
                          </button>
                        )}
                        {onDeleteVoucher && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingVoucher(voucher);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            {isRtl ? 'حذف' : 'Delete'}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[900px] table-fixed border-collapse text-left">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="w-[170px] px-4 py-3">{isRtl ? 'سند المرتجع' : 'Voucher'}</th>
                      <th className="w-[165px] px-4 py-3">{isRtl ? 'التاريخ' : 'Date'}</th>
                      <th className="px-4 py-3">{isRtl ? 'فواتير المصدر' : 'Source invoices'}</th>
                      <th className="w-[110px] px-3 py-3">{isRtl ? 'الأصناف' : 'Items'}</th>
                      <th className="w-[110px] px-3 py-3">{isRtl ? 'طريقة الرد' : 'Refund method'}</th>
                      <th className="w-[140px] px-4 py-3 text-right">{isRtl ? 'المبلغ' : 'Refund'}</th>
                      <th className="w-[150px] px-4 py-3">{isRtl ? 'الكاشير' : 'Cashier'}</th>
                      <th className="w-[95px] px-3 py-3">{isRtl ? 'تفاصيل' : 'Details'}</th>
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
                        <tr className="hover:bg-violet-50/30">
                          <td className="px-4 py-3 font-mono text-xs font-bold text-slate-900">
                            {voucher.voucherNumber}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {formatDate(voucher.createdAt)}
                          </td>
                          <td className="truncate px-4 py-3 text-xs text-slate-700" title={voucher.sourceInvoices.join(', ')}>
                            {voucher.sourceInvoices.join(', ')}
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-700">
                            {voucher.items.reduce((sum, item) => sum + item.quantity, 0)}
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-700">{voucher.paymentMethod}</td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-violet-800">
                            {currency}{voucher.refundAmount.toFixed(2)}
                          </td>
                          <td className="truncate px-4 py-3 text-xs text-slate-600">{voucher.cashierName}</td>
                          <td className="px-3 py-3">
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
