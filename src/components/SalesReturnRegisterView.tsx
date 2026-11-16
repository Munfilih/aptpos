import React, { useMemo, useState } from 'react';
import { ArrowLeft, Plus, Receipt, RotateCcw, Search, Trash2 } from 'lucide-react';
import type {
  CreateSalesReturnVoucherInput,
  PaymentMethod,
  Sale,
  SalesReturnVoucher,
  StoreSettings,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { calculateSaleReturnRefund } from '../utils/saleReturns';
import { getPaymentMethods } from '../utils/paymentMethods';

interface SalesReturnRegisterViewProps {
  initialSales: Sale[];
  sales: Sale[];
  settings: StoreSettings;
  cashierName: string;
  editingVoucher?: SalesReturnVoucher;
  onCancel: () => void;
  onProcessVoucher: (
    input: Omit<CreateSalesReturnVoucherInput, 'cashierName'>
  ) => Promise<SalesReturnVoucher>;
  onUpdateVoucher?: (
    voucherId: number,
    input: Omit<CreateSalesReturnVoucherInput, 'cashierName'>
  ) => Promise<SalesReturnVoucher>;
}

function getDefaultQuantities(sales: Sale[]): Record<number, number> {
  return Object.fromEntries(
    sales.flatMap((sale) =>
      sale.items.map((item) => [
        item.id,
        Math.max(0, item.quantity - (item.returnedQuantity || 0)),
      ])
    )
  );
}

function getInitialQuantities(
  sales: Sale[],
  editingVoucher?: SalesReturnVoucher
): Record<number, number> {
  if (!editingVoucher) return getDefaultQuantities(sales);
  return Object.fromEntries(
    sales.flatMap((sale) =>
      sale.items.map((item) => [
        item.id,
        editingVoucher.items.find(
          (voucherItem) => voucherItem.saleId === sale.id && voucherItem.saleItemId === item.id
        )?.quantity || 0,
      ])
    )
  );
}

function getSaleWithoutVoucher(sale: Sale, voucher?: SalesReturnVoucher): Sale {
  if (!voucher) return sale;
  const voucherItems = voucher.items.filter((item) => item.saleId === sale.id);
  const voucherQuantities = new Map(voucherItems.map((item) => [item.saleItemId, item.quantity]));
  const voucherRefund = voucherItems.reduce((sum, item) => sum + item.refundAmount, 0);
  return {
    ...sale,
    returnedTotal: Math.max(0, (sale.returnedTotal || 0) - voucherRefund),
    items: sale.items.map((item) => ({
      ...item,
      returnedQuantity: Math.max(
        0,
        (item.returnedQuantity || 0) - (voucherQuantities.get(item.id) || 0)
      ),
    })),
  };
}

export const SalesReturnRegisterView: React.FC<SalesReturnRegisterViewProps> = ({
  initialSales,
  sales,
  settings,
  cashierName,
  editingVoucher,
  onCancel,
  onProcessVoucher,
  onUpdateVoucher,
}) => {
  const { isRtl } = useLanguage();
  const [selectedSales, setSelectedSales] = useState(initialSales);
  const [returnQuantities, setReturnQuantities] = useState(() =>
    getInitialQuantities(initialSales, editingVoucher)
  );
  const [refundPaymentMethod, setRefundPaymentMethod] = useState<PaymentMethod>(
    editingVoucher?.paymentMethod || initialSales[0]?.paymentMethod || 'Cash'
  );
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = isRtl ? 'ر.س ' : settings.currencySymbol || 'SAR ';
  const paymentMethods = getPaymentMethods(settings.paymentMethods);
  const selectedIds = new Set(selectedSales.map((sale) => sale.id));
  const matchingSales = useMemo(() => {
    const query = invoiceSearch.trim().toLowerCase();
    return sales
      .filter(
        (sale) =>
          sale.status === 'COMPLETED' &&
          (sale.returnStatus !== 'FULL' ||
            editingVoucher?.items.some((item) => item.saleId === sale.id)) &&
          !selectedIds.has(sale.id) &&
          (!query ||
            sale.receiptNumber.toLowerCase().includes(query) ||
            sale.customerName.toLowerCase().includes(query))
      )
      .slice(0, 6);
  }, [sales, invoiceSearch, selectedSales, editingVoucher]);

  const voucherLines = useMemo(
    () => selectedSales.flatMap((sale) => {
      const saleWithoutVoucher = getSaleWithoutVoucher(sale, editingVoucher);
      return saleWithoutVoucher.items
          .map((item) => ({
            remaining: Math.max(0, item.quantity - (item.returnedQuantity || 0)),
            quantity: returnQuantities[item.id] ?? 0,
          }))
          .filter((line) => line.quantity > 0);
    }),
    [selectedSales, returnQuantities, editingVoucher]
  );
  const voucherTotal = useMemo(
    () =>
      selectedSales.reduce((sum, sale) => {
        const saleWithoutVoucher = getSaleWithoutVoucher(sale, editingVoucher);
        const items = sale.items
          .map((item) => ({
            saleItemId: item.id,
            quantity: returnQuantities[item.id] ?? 0,
          }))
          .filter((item) => item.quantity > 0);
        return sum + calculateSaleReturnRefund(
          saleWithoutVoucher,
          items,
          saleWithoutVoucher.returnedTotal || 0
        ).total;
      }, 0),
    [selectedSales, returnQuantities, editingVoucher]
  );

  const addInvoice = (sale: Sale) => {
    setSelectedSales((current) => [...current, sale]);
    setReturnQuantities((current) => ({
      ...current,
      ...(
        editingVoucher?.items.some((item) => item.saleId === sale.id)
          ? getInitialQuantities([sale], editingVoucher)
          : getDefaultQuantities([sale])
      ),
    }));
    setInvoiceSearch('');
    setError(null);
  };

  const removeInvoice = (saleId: number) => {
    setSelectedSales((current) => current.filter((sale) => sale.id !== saleId));
  };

  const handleProcess = async () => {
    if (voucherLines.length === 0) return;
    setIsProcessing(true);
    setError(null);
    try {
      const input = {
        paymentMethod: refundPaymentMethod,
        sales: selectedSales
          .map((sale) => ({
            saleId: sale.id,
            items: sale.items
              .map((item) => ({
                saleItemId: item.id,
                quantity: returnQuantities[item.id] ?? 0,
              }))
              .filter((item) => item.quantity > 0),
          }))
          .filter((sale) => sale.items.length > 0),
      };
      if (editingVoucher) {
        if (!onUpdateVoucher) throw new Error('Editing return vouchers is not available.');
        await onUpdateVoucher(editingVoucher.id, input);
      } else {
        await onProcessVoucher(input);
        setSelectedSales([]);
        setReturnQuantities({});
        setInvoiceSearch('');
      }
    } catch (processError) {
      setError(
        processError instanceof Error ? processError.message : 'Failed to process return voucher.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 p-3 lg:p-6">
      <div className="mx-auto max-w-[1440px] space-y-4 lg:space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-700 text-white shadow-sm">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 lg:text-xl">
                {editingVoucher
                  ? (isRtl ? 'تعديل مرتجع المبيعات' : 'Edit Sales Return')
                  : (isRtl ? 'تسجيل مرتجع مبيعات' : 'Sales Return Register')}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                {editingVoucher
                  ? `${isRtl ? 'السند' : 'Voucher'} ${editingVoucher.voucherNumber} · ${
                    isRtl ? 'يُعاد حساب المبلغ حسب الكميات.' : 'Refund recalculates from quantities.'
                  }`
                  : isRtl
                    ? 'حدد الكميات وأضف فواتير أخرى إلى سند المرتجع نفسه.'
                    : 'Choose return quantities and combine invoices on one return voucher.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            {editingVoucher
              ? (isRtl ? 'العودة لسجل المرتجعات' : 'Back to return history')
              : (isRtl ? 'العودة للمبيعات' : 'Back to sales')}
          </button>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:p-5">
          <div className="mb-3 flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-bold text-slate-900">
              {isRtl ? 'إضافة فاتورة إلى السند' : 'Add invoice to voucher'}
            </h2>
          </div>
          <div className="relative">
            <input
              type="search"
              value={invoiceSearch}
              onChange={(event) => setInvoiceSearch(event.target.value)}
              placeholder={isRtl ? 'ابحث برقم الفاتورة أو العميل...' : 'Search by receipt or customer...'}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-violet-100"
            />
          </div>
          {invoiceSearch.trim() && (
            <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {matchingSales.length > 0 ? (
                matchingSales.map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-bold text-slate-900">
                        {sale.receiptNumber}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {sale.customerName} · {currency}{sale.total.toFixed(2)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addInvoice(sale)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {isRtl ? 'إضافة' : 'Add'}
                    </button>
                  </div>
                ))
              ) : (
                <p className="p-3 text-xs text-slate-500">
                  {isRtl ? 'لا توجد فواتير قابلة للإرجاع.' : 'No eligible invoices found.'}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3">
          {selectedSales.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <Receipt className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                {isRtl ? 'أضف فاتورة لبدء سند المرتجع' : 'Add an invoice to start this return voucher'}
              </p>
            </div>
          ) : (
            selectedSales.map((sale) => {
              const saleWithoutVoucher = getSaleWithoutVoucher(sale, editingVoucher);
              return (
                <article
                  key={sale.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-3 lg:px-4">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-bold text-slate-900">
                        {sale.receiptNumber}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {sale.customerName} · {new Date(sale.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeInvoice(sale.id)}
                      aria-label={`${isRtl ? 'إزالة الفاتورة' : 'Remove invoice'} ${sale.receiptNumber}`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </header>
                  <div className="divide-y divide-slate-100">
                    {saleWithoutVoucher.items.map((item) => {
                      const remaining = Math.max(0, item.quantity - (item.returnedQuantity || 0));
                      const quantity = returnQuantities[item.id] ?? 0;
                      const lineRefund = calculateSaleReturnRefund(
                        saleWithoutVoucher,
                        [{ saleItemId: item.id, quantity }],
                        saleWithoutVoucher.returnedTotal || 0
                      ).total;
                      return (
                        <div
                          key={item.id}
                          className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_100px_130px] lg:px-4"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {isRtl ? item.nameAr || item.productName : item.productName}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {item.sku} · {isRtl ? 'الكمية المباعة' : 'Sold'} {item.quantity}
                              {(item.returnedQuantity || 0) > 0 &&
                                ` · ${isRtl ? 'مرتجع' : 'Returned'} ${item.returnedQuantity}`}
                            </p>
                          </div>
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-medium text-slate-500">
                              {isRtl ? 'كمية الإرجاع' : 'Return qty'} (max {remaining})
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              step={1}
                              value={quantity}
                              disabled={remaining === 0}
                              onChange={(event) => {
                                const next = Math.min(
                                  remaining,
                                  Math.max(0, Math.floor(Number(event.target.value) || 0))
                                );
                                setReturnQuantities((current) => ({ ...current, [item.id]: next }));
                              }}
                              className="w-full rounded-lg border border-slate-200 px-2 py-2 text-center text-sm font-bold text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-100 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </label>
                          <p className="hidden text-right text-xs font-semibold text-slate-700 lg:block">
                            {currency}{lineRefund.toFixed(2)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })
          )}
        </section>

        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isRtl ? 'طريقة رد المبلغ' : 'Refund payment method'}
            </span>
            <select
              value={refundPaymentMethod}
              onChange={(event) => setRefundPaymentMethod(event.target.value as PaymentMethod)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-100 sm:max-w-xs"
            >
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {method === 'Cash'
                    ? (isRtl ? 'نقداً' : 'Cash')
                    : method === 'Card'
                      ? (isRtl ? 'بطاقة' : 'Card')
                      : method === 'Split'
                        ? (isRtl ? 'مجزأ' : 'Split')
                        : method}
                </option>
              ))}
            </select>
            <span className="block text-[11px] text-slate-500">
              {editingVoucher
                ? `${isRtl ? 'الكاشير الأصلي:' : 'Original cashier:'} ${editingVoucher.cashierName}`
                : (isRtl ? `الكاشير: ${cashierName}` : `Cashier: ${cashierName}`)}
            </span>
          </label>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <p className="text-xs text-slate-500">
              {isRtl ? 'إجمالي المبلغ المسترد' : 'Voucher refund total'}
            </p>
            <p className="font-mono text-xl font-bold tabular-nums text-violet-800">
              {currency}{voucherTotal.toFixed(2)}
            </p>
            <button
              type="button"
              disabled={isProcessing || voucherLines.length === 0}
              onClick={handleProcess}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              {isProcessing
                ? (editingVoucher
                  ? (isRtl ? 'جارٍ حفظ التعديلات...' : 'Saving changes...')
                  : (isRtl ? 'جارٍ معالجة المرتجع...' : 'Processing return...'))
                : (editingVoucher
                  ? (isRtl ? 'حفظ التعديلات' : 'Save changes')
                  : (isRtl ? 'إصدار سند المرتجع' : 'Issue return voucher'))}
            </button>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 sm:col-span-2">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
};
