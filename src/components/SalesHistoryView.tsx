import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Edit2,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type { PaymentMethod, Sale, SalesReturnVoucher, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { matchesDateBounds, resolveDateBounds, type DateFilter } from '../utils/dateFilters';

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
    const grossSales = completed.reduce((sum, s) => sum + s.total, 0);
    const avgTicket = completed.length > 0 ? grossSales / completed.length : 0;
    const returnedCount = sales.filter((s) => Boolean(s.returnStatus)).length;
    return {
      grossSales,
      completedCount: completed.length,
      avgTicket,
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

  const metrics = [
    {
      label: isRtl ? 'إجمالي المبيعات' : 'Gross sales',
      value: `${c}${summary.grossSales.toFixed(2)}`,
      icon: DollarSign,
      iconClass: 'bg-emerald-50 text-emerald-700',
    },
    {
      label: isRtl ? 'الفواتير المكتملة' : 'Completed tickets',
      value: String(summary.completedCount),
      icon: CheckCircle2,
      iconClass: 'bg-blue-50 text-blue-700',
    },
    {
      label: isRtl ? 'متوسط قيمة الفاتورة' : 'Average ticket',
      value: `${c}${summary.avgTicket.toFixed(2)}`,
      icon: TrendingUp,
      iconClass: 'bg-violet-50 text-violet-700',
    },
    {
      label: isRtl ? 'المبيعات المرتجعة' : 'Returned sales',
      value: String(summary.returnedCount),
      icon: RotateCcw,
      iconClass: 'bg-violet-50 text-violet-700',
    },
  ];

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (statusFilter === 'COMPLETED' && s.status !== 'COMPLETED') return false;
      if (statusFilter === 'RETURNED' && !s.returnStatus) return false;
      if (!matchesDateBounds(s.createdAt, dateBounds)) return false;
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
    new Date(sale.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-US', {
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
    <div className={`flex items-center gap-1 ${isRtl ? 'justify-start' : 'justify-end'}`}>
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
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white shadow-sm shadow-blue-900/15 lg:h-12 lg:w-12 lg:rounded-2xl">
              <Receipt className="h-5 w-5 lg:h-6 lg:w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 lg:text-xl">
                {isRtl ? 'سجل المبيعات' : 'Sales History'}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 lg:text-sm">
                {isRtl
                  ? 'راجع الفواتير والمدفوعات وحالة كل عملية.'
                  : 'Review receipts, payments, and transaction status.'}
              </p>
            </div>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm lg:px-3.5 lg:py-2.5 lg:text-sm">
            <span className="text-slate-500">{isRtl ? 'إجمالي الفواتير' : 'Total receipts'}</span>
            <span className="font-mono font-bold tabular-nums text-slate-900">{sales.length}</span>
          </div>
        </header>

        <section aria-label={isRtl ? 'ملخص المبيعات' : 'Sales summary'} className="grid grid-cols-2 gap-2 lg:gap-3 xl:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <article
                key={metric.label}
                className="flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:gap-3 lg:rounded-2xl lg:p-4"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${metric.iconClass} lg:h-11 lg:w-11 lg:rounded-xl`}>
                  <Icon className="h-4 w-4 lg:h-5 lg:w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-medium text-slate-500 lg:text-xs">{metric.label}</p>
                  <p className="mt-0.5 truncate font-mono text-base font-bold tabular-nums text-slate-900 lg:mt-1 lg:text-xl">
                    {metric.value}
                  </p>
                </div>
              </article>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-3 border-b border-slate-200 p-3 lg:space-y-4 lg:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {isRtl ? 'المعاملات' : 'Transactions'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {isRtl ? 'ابحث عن الفواتير وصفّها حسب الحالة.' : 'Search receipts and filter by status.'}
                </p>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                <span>{isRtl ? 'المعروض' : 'Showing'}</span>
                <span className="font-mono font-bold tabular-nums text-slate-900">{filteredSales.length}</span>
                <span>{isRtl ? 'من' : 'of'}</span>
                <span className="font-mono tabular-nums">{sales.length}</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full xl:max-w-md">
                <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={isRtl ? 'بحث برقم الوصل، العميل، أو الكاشير...' : 'Search receipt, customer, or cashier...'}
                  className={`w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100 lg:py-2.5 ${isRtl ? 'pr-10 pl-3' : 'pl-10 pr-3'}`}
                />
              </div>
              <div className="flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1 xl:w-auto">
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
                    className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors lg:gap-2 lg:px-3 lg:py-2 lg:text-xs xl:flex-none ${
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
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                aria-label={isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:w-auto"
              >
                <option value="ALL">{isRtl ? 'كل التواريخ' : 'Any date'}</option>
                <option value="RANGE">{isRtl ? 'نطاق تاريخ' : 'Date Range'}</option>
                <option value="TODAY">{isRtl ? 'اليوم' : 'Today'}</option>
                <option value="YESTERDAY">{isRtl ? 'أمس' : 'Yesterday'}</option>
                <option value="THIS_WEEK">{isRtl ? 'هذا الأسبوع' : 'This Week'}</option>
                <option value="THIS_MONTH">{isRtl ? 'هذا الشهر' : 'This Month'}</option>
              </select>
              {dateFilter === 'RANGE' && (
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
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
                    className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
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
                    className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2 bg-slate-50 p-2 lg:hidden">
            {filteredSales.length === 0
              ? emptyState
              : filteredSales.map((sale) => {
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
                    <article
                      key={sale.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-blue-200 hover:shadow-md lg:gap-3 lg:rounded-2xl lg:p-4"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="min-w-0 truncate font-mono text-xs font-bold text-slate-900">
                            {sale.receiptNumber}
                          </p>
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${returnBadgeClass}`}>
                            {sale.returnStatus === 'FULL'
                              ? (isRtl ? 'مُعادة' : 'Returned')
                              : sale.returnStatus === 'PARTIAL'
                                ? (isRtl ? 'إرجاع جزئي' : 'Partially returned')
                                : completed
                                  ? (isRtl ? 'مكتملة' : 'Paid')
                                  : (isRtl ? 'ملغاة' : 'Voided')}
                          </span>
                        </div>
                        <p className="mt-0.5 min-w-0 truncate text-xs font-medium text-slate-800" title={sale.customerName}>
                          {sale.customerName}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">
                          {formatSaleDate(sale)}
                          <span className="mx-1 text-slate-300">·</span>
                          {isRtl ? `الكاشير: ${sale.cashierName}` : `Cashier: ${sale.cashierName}`}
                        </p>
                        {linkedReturnVouchers.map((voucher) => (
                          <p key={voucher.id} className="mt-0.5 truncate text-[10px] text-violet-700">
                            {isRtl ? 'سند مرتجع' : 'Return voucher'} {voucher.voucherNumber}
                            <span className="mx-1 text-slate-300">·</span>
                            {formatReturnVoucherDate(voucher.createdAt)}
                          </p>
                        ))}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <p className="whitespace-nowrap font-mono text-sm font-bold tabular-nums text-slate-900">
                          {c}{sale.total.toFixed(2)}
                        </p>
                        <p className="whitespace-nowrap text-[10px] font-medium text-slate-600">
                          {itemCount} {isRtl ? 'صنف' : itemCount === 1 ? 'item' : 'items'}
                          <span className="mx-1 text-slate-300">·</span>
                          {paymentLabel(sale.paymentMethod)}
                        </p>
                        {(sale.returnedTotal || 0) > 0 && (
                          <p className="whitespace-nowrap text-[10px] font-medium text-violet-700">
                            {isRtl ? 'المسترد:' : 'Refunded:'} {c}{sale.returnedTotal?.toFixed(2)}
                            {sale.returnPaymentMethods && sale.returnPaymentMethods.length > 0 &&
                              ` · ${sale.returnPaymentMethods.map(paymentLabel).join(', ')}`}
                          </p>
                        )}
                        {renderActions(sale)}
                      </div>
                    </article>
                  );
                })}
          </div>

          <div className="hidden lg:block overflow-x-auto">
            {filteredSales.length === 0 ? (
              emptyState
            ) : (
              <table className={`w-full min-w-[960px] table-fixed border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="w-[150px] px-4 py-3">{isRtl ? 'رقم الوصل' : 'Receipt'}</th>
                    <th className="w-[150px] px-4 py-3">{isRtl ? 'التاريخ والوقت' : 'Date & time'}</th>
                    <th className="px-4 py-3">{isRtl ? 'العميل / الكاشير' : 'Customer / cashier'}</th>
                    <th className="w-[90px] px-3 py-3">{isRtl ? 'الأصناف' : 'Items'}</th>
                    <th className="w-[100px] px-3 py-3">{isRtl ? 'الدفع' : 'Payment'}</th>
                    <th className={`w-[120px] px-4 py-3 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجمالي' : 'Total'}</th>
                    <th className="w-[115px] px-3 py-3">{isRtl ? 'الحالة' : 'Status'}</th>
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
                        <td className="px-4 py-3.5">
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
                        <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-600">
                          {formatSaleDate(sale)}
                        </td>
                        <td className="min-w-0 px-4 py-3.5">
                          <p className="truncate text-xs font-semibold text-slate-900" title={sale.customerName}>
                            {sale.customerName}
                          </p>
                          <p className="mt-1 truncate text-[11px] text-slate-500" title={sale.cashierName}>
                            {isRtl ? `الكاشير: ${sale.cashierName}` : `Cashier: ${sale.cashierName}`}
                          </p>
                        </td>
                        <td className="px-3 py-3.5">
                          <span className="inline-flex rounded-lg bg-slate-100 px-2 py-1 font-mono text-[11px] font-semibold tabular-nums text-slate-700">
                            {itemCount} {isRtl ? 'صنف' : itemCount === 1 ? 'item' : 'items'}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-xs font-medium text-slate-700">
                          {paymentLabel(sale.paymentMethod)}
                        </td>
                        <td className={`whitespace-nowrap px-4 py-3.5 font-mono text-sm font-bold tabular-nums text-slate-900 ${isRtl ? 'text-left' : 'text-right'}`}>
                          {c}{sale.total.toFixed(2)}
                          {(sale.returnedTotal || 0) > 0 && (
                            <span className="mt-1 block font-sans text-[10px] font-medium text-violet-700">
                              {isRtl ? 'المسترد:' : 'Refunded:'} {c}{sale.returnedTotal?.toFixed(2)}
                              {sale.returnPaymentMethods && sale.returnPaymentMethods.length > 0 &&
                                ` · ${sale.returnPaymentMethods.map(paymentLabel).join(', ')}`}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${returnBadgeClass}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${sale.returnStatus === 'FULL' ? 'bg-violet-500' : sale.returnStatus === 'PARTIAL' ? 'bg-amber-500' : completed ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            {sale.returnStatus === 'FULL'
                              ? (isRtl ? 'مُعادة' : 'Returned')
                              : sale.returnStatus === 'PARTIAL'
                                ? (isRtl ? 'إرجاع جزئي' : 'Partially returned')
                                : completed
                                  ? (isRtl ? 'مكتملة' : 'Completed')
                                  : (isRtl ? 'ملغاة' : 'Voided')}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">{renderActions(sale)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
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
