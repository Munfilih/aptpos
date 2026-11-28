import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CreditCard,
  History,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  CreateSalesReturnVoucherInput,
  Customer,
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
  customers?: Customer[];
  settings: StoreSettings;
  cashierName: string;
  editingVoucher?: SalesReturnVoucher;
  onCancel: () => void;
  onOpenReturnHistory: () => void;
  onInvoiceTypeChange?: (type: 'B2B' | 'B2C') => void;
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
  customers = [],
  settings,
  cashierName,
  editingVoucher,
  onCancel,
  onOpenReturnHistory,
  onInvoiceTypeChange,
  onProcessVoucher,
  onUpdateVoucher,
}) => {
  const { isRtl } = useLanguage();
  const [selectedSales, setSelectedSales] = useState(initialSales);

  useEffect(() => {
    const primarySale = selectedSales[0];
    const matched = primarySale
      ? customers.find((c) => c.id === primarySale.customerId) ||
        customers.find((c) => c.name.trim() === primarySale.customerName.trim())
      : undefined;
    const isB2B = Boolean(matched?.vatNumber && /^\d{15}$/.test(matched.vatNumber.trim()));
    onInvoiceTypeChange?.(isB2B ? 'B2B' : 'B2C');
  }, [selectedSales, customers, onInvoiceTypeChange]);
  const [returnQuantities, setReturnQuantities] = useState(() =>
    getInitialQuantities(initialSales, editingVoucher)
  );
  const [refundPaymentMethod, setRefundPaymentMethod] = useState<PaymentMethod>(
    editingVoucher?.paymentMethod || initialSales[0]?.paymentMethod || 'Cash'
  );
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [mobileTab, setMobileTab] = useState<'table' | 'checkout'>('table');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
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
    <div className="flex-1 flex flex-col min-h-0 bg-slate-100 overflow-hidden relative">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-xs sm:px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
              <Receipt className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-bold tracking-tight text-slate-900">
                {editingVoucher
                  ? (isRtl ? 'تعديل مرتجع المبيعات' : 'Edit Sales Return')
                  : (isRtl ? 'تسجيل مرتجع مبيعات' : 'Sales Return Register')}
              </h1>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
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
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenReturnHistory}
              aria-label={isRtl ? 'سجل المرتجعات' : 'Return History'}
              title={isRtl ? 'سجل المرتجعات' : 'Return History'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700"
            >
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">{isRtl ? 'سجل المرتجعات' : 'Return History'}</span>
            </button>
            <button
              type="button"
              onClick={onCancel}
              aria-label={
                editingVoucher
                  ? (isRtl ? 'إلغاء التعديل' : 'Cancel editing')
                  : (isRtl ? 'العودة للمبيعات' : 'Back to sales')
              }
              title={
                editingVoucher
                  ? (isRtl ? 'إلغاء التعديل' : 'Cancel editing')
                  : (isRtl ? 'العودة للمبيعات' : 'Back to sales')
              }
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">
                {editingVoucher
                  ? (isRtl ? 'إلغاء التعديل' : 'Cancel editing')
                  : (isRtl ? 'العودة للمبيعات' : 'Back to sales')}
              </span>
            </button>
          </div>
        </header>

        <div className="min-[900px]:hidden shrink-0 border-b border-slate-200 bg-white p-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileTab('table')}
            aria-pressed={mobileTab === 'table'}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
              mobileTab === 'table' ? 'bg-blue-700 text-white shadow-xs' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {isRtl ? `الأصناف المرتجعة (${voucherLines.length})` : `Return Items (${voucherLines.length})`}
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('checkout')}
            aria-pressed={mobileTab === 'checkout'}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
              mobileTab === 'checkout' ? 'bg-blue-700 text-white shadow-xs' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {isRtl
              ? `تسوية المرتجع · ${currency}${voucherTotal.toFixed(2)}`
              : `Refund · ${currency}${voucherTotal.toFixed(2)}`}
          </button>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden flex-col min-[900px]:flex-row">
          <main
            className={`flex-1 flex flex-col min-h-0 min-w-0 bg-white border-r border-slate-200 overflow-hidden ${
              mobileTab === 'table' ? 'flex' : 'hidden min-[900px]:flex'
            }`}
          >
          <div className="shrink-0 space-y-1.5 border-b border-slate-200 bg-slate-50 p-2 sm:p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xs font-bold text-slate-800">
                  {isRtl ? 'اختيار فاتورة المبيعات' : 'Choose sales invoice'}
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {isRtl
                    ? 'ابحث برقم الفاتورة أو اسم العميل لإضافتها إلى سند المرتجع.'
                    : 'Search by receipt or customer to add an invoice to this return.'}
                </p>
              </div>
              {selectedSales.length > 0 && (
                <div className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                  <span>{isRtl ? 'الفواتير المحددة' : 'Selected invoices'}</span>
                  <span className="font-mono font-bold tabular-nums text-slate-900">
                    {selectedSales.length}
                  </span>
                </div>
              )}
            </div>
            <div className="relative w-full">
              <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
              <input
                type="search"
                value={invoiceSearch}
                onChange={(event) => setInvoiceSearch(event.target.value)}
                placeholder={isRtl ? 'ابحث برقم الفاتورة أو العميل...' : 'Search by receipt or customer...'}
                className={`w-full rounded-lg border-2 border-slate-300 bg-white py-1.5 text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
              />
            </div>
            {invoiceSearch.trim() && (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
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
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
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
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-2 bg-slate-50 p-2 sm:p-3">
            {selectedSales.length === 0 ? (
              <div className="h-full min-h-[360px] flex items-center justify-center p-6 text-center bg-slate-50/50">
                <div className="opacity-30">
                  <div className="text-xl font-bold text-slate-900">{settings.storeName}</div>
                </div>
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
                          {sale.customerName} · {new Date(sale.createdAt).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
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
                                className="w-full rounded-lg border border-slate-200 px-2 py-2 text-center text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
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
          </div>

          </main>

          <aside
            className={`z-10 flex w-full shrink-0 flex-col border-l border-slate-200 bg-white min-h-0 ${
              mobileTab === 'checkout' ? 'flex' : 'hidden min-[900px]:flex'
            } min-[900px]:w-1/3`}
          >
            <header className="shrink-0 border-b border-slate-200 bg-slate-50 px-2 py-1">
              <h2 className="text-sm font-bold text-slate-900">
                {isRtl ? 'تسوية المرتجع' : 'Return Settlement'}
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {selectedSales.length} {isRtl ? 'فواتير' : 'invoices'} · {voucherLines.length}{' '}
                {isRtl ? 'أصناف' : 'lines'}
              </p>
            </header>

            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-3 pt-3 pb-3 space-y-3">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-700">
                  {isRtl ? 'طريقة رد المبلغ' : 'Refund payment method'}
                </h3>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 min-[900px]:grid-cols-2 xl:grid-cols-3">
                  {paymentMethods.map((method) => {
                    const selected = refundPaymentMethod === method;
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setRefundPaymentMethod(method)}
                        aria-pressed={selected}
                        className={`flex items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-xs font-bold transition-colors ${
                          selected
                            ? 'border-blue-700 bg-blue-700 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {method === 'Cash'
                          ? <Banknote className="h-3.5 w-3.5" />
                          : <CreditCard className="h-3.5 w-3.5" />}
                        {method === 'Cash'
                          ? (isRtl ? 'نقداً' : 'Cash')
                          : method === 'Card'
                            ? (isRtl ? 'بطاقة' : 'Card')
                            : method === 'Split'
                              ? (isRtl ? 'مجزأ' : 'Split')
                              : method}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500">
                  {editingVoucher
                    ? `${isRtl ? 'الكاشير الأصلي:' : 'Original cashier:'} ${editingVoucher.cashierName}`
                    : (isRtl ? `الكاشير: ${cashierName}` : `Cashier: ${cashierName}`)}
                </p>
              </section>

              <section className="space-y-1.5 border-t border-slate-200 pt-3 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>{isRtl ? 'الفواتير' : 'Invoices'}</span>
                  <span className="font-mono">{selectedSales.length}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>{isRtl ? 'الكمية المرتجعة' : 'Returned quantity'}</span>
                  <span className="font-mono">
                    {voucherLines.reduce((sum, line) => sum + line.quantity, 0)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between border-t border-blue-200 pt-2">
                  <span className="font-bold text-slate-900">
                    {isRtl ? 'إجمالي المبلغ المسترد' : 'Total refund'}
                  </span>
                  <strong className="font-mono text-xl font-black text-blue-800">
                    {currency}{voucherTotal.toFixed(2)}
                  </strong>
                </div>
              </section>

              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}
            </div>

            <footer className="shrink-0 border-t border-slate-200 bg-white p-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={onCancel}
                  className="flex h-14 items-center justify-center rounded-lg border border-red-700 bg-red-700 px-4 text-sm font-bold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={isProcessing || voucherLines.length === 0}
                  onClick={() => {
                    setError(null);
                    setIsConfirmOpen(true);
                  }}
                  className="flex h-14 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <RotateCcw className="h-4 w-4" />
                  {isProcessing
                    ? (editingVoucher
                      ? (isRtl ? 'جارٍ حفظ التعديلات...' : 'Saving changes...')
                      : (isRtl ? 'جارٍ معالجة المرتجع...' : 'Processing return...'))
                    : (editingVoucher
                      ? (isRtl ? 'حفظ التعديلات' : 'Save changes')
                      : (isRtl ? 'إصدار سند المرتجع' : 'Issue return'))}
                </button>
              </div>
            </footer>
          </aside>
        </div>
      </div>
      {isConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-sales-return-title"
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 id="confirm-sales-return-title" className="text-base font-bold text-slate-900">
                  {editingVoucher
                    ? (isRtl ? 'تأكيد حفظ التعديلات' : 'Confirm return changes')
                    : (isRtl ? 'تأكيد مرتجع المبيعات' : 'Confirm sales return')}
                </h2>
                <p className="text-xs text-slate-500">
                  {isRtl ? 'يرجى مراجعة تفاصيل الإرجاع قبل المتابعة.' : 'Review the return details before continuing.'}
                </p>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-slate-700">
              <div className="flex justify-between gap-3">
                <span>{isRtl ? 'الفواتير' : 'Invoices'}</span>
                <strong>{selectedSales.length}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>{isRtl ? 'الكمية المرتجعة' : 'Returned quantity'}</span>
                <strong>{voucherLines.reduce((sum, line) => sum + line.quantity, 0)}</strong>
              </div>
              <div className="flex justify-between gap-3">
                <span>{isRtl ? 'طريقة رد المبلغ' : 'Refund method'}</span>
                <strong>{refundPaymentMethod}</strong>
              </div>
              <div className="flex justify-between gap-3 border-t border-blue-200 pt-2 text-sm">
                <span className="font-semibold">{isRtl ? 'إجمالي المبلغ' : 'Total refund'}</span>
                <strong className="font-mono">{currency}{voucherTotal.toFixed(2)}</strong>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              {isRtl
                ? 'سيتم حفظ سند المرتجع وتحديث الكميات والأرصدة المرتبطة به.'
                : 'Confirming will save the return voucher and update the related quantities and balances.'}
            </p>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setIsConfirmOpen(false)}
                className="rounded-lg px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setIsConfirmOpen(false);
                  void handleProcess();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {isProcessing
                  ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...')
                  : (isRtl ? 'تأكيد وحفظ' : 'Confirm and save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
