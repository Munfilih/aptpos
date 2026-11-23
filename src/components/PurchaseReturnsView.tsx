import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  History,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  CreatePurchaseReturnInput,
  PurchaseEntry,
  PurchaseItem,
  PurchaseReturnVoucher,
  StoreSettings,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

interface PurchaseReturnRegisterViewProps {
  purchases: PurchaseEntry[];
  returnVouchers: PurchaseReturnVoucher[];
  settings: StoreSettings;
  onCancel: () => void;
  onOpenReturnHistory: () => void;
  onProcessReturn: (input: CreatePurchaseReturnInput) => Promise<PurchaseReturnVoucher>;
}

interface PurchaseReturnHistoryViewProps {
  vouchers: PurchaseReturnVoucher[];
  settings: StoreSettings;
  onCreateReturn?: () => void;
  onDeleteVoucher: (voucherId: number) => Promise<void>;
}

const getAvailablePurchaseQuantity = (
  item: PurchaseItem,
  returnVouchers: PurchaseReturnVoucher[]
) => {
  const alreadyReturned = returnVouchers.reduce(
    (total, voucher) =>
      total + voucher.items
        .filter((returnItem) => returnItem.purchaseItemId === item.id)
        .reduce((sum, returnItem) => sum + returnItem.quantity, 0),
    0
  );
  return Math.max(0, item.quantity - alreadyReturned);
};

const getPurchaseReturnAmounts = (
  purchase: PurchaseEntry,
  quantities: Record<number, number>,
  returnVouchers: PurchaseReturnVoucher[]
) => {
  const subtotal = Number(
    purchase.items.reduce(
      (sum, item) =>
        sum + Number(((quantities[item.id] || 0) * item.unitCost).toFixed(2)),
      0
    ).toFixed(2)
  );
  const previousTax = returnVouchers
    .filter((voucher) => voucher.purchaseId === purchase.id)
    .reduce((sum, voucher) => sum + voucher.taxAmount, 0);
  const remainingTax = Math.max(0, purchase.taxAmount - previousTax);
  const taxAmount = purchase.subtotal > 0
    ? Math.min(remainingTax, Number((purchase.taxAmount * subtotal / purchase.subtotal).toFixed(2)))
    : 0;
  return { subtotal, taxAmount, total: Number((subtotal + taxAmount).toFixed(2)) };
};

const getDefaultPurchaseReturnQuantities = (
  purchase: PurchaseEntry,
  returnVouchers: PurchaseReturnVoucher[]
) =>
  Object.fromEntries(
    purchase.items.map((item) => [
      item.id,
      getAvailablePurchaseQuantity(item, returnVouchers),
    ])
  );

export const PurchaseReturnRegisterView: React.FC<PurchaseReturnRegisterViewProps> = ({
  purchases,
  returnVouchers,
  settings,
  onCancel,
  onOpenReturnHistory,
  onProcessReturn,
}) => {
  const { isRtl } = useLanguage();
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseEntry | null>(() =>
    purchases.find((purchase) =>
      purchase.items.some((item) => getAvailablePurchaseQuantity(item, returnVouchers) > 0)
    ) || null
  );
  const [search, setSearch] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>(() => {
    const initialPurchase = purchases.find((purchase) =>
      purchase.items.some((item) => getAvailablePurchaseQuantity(item, returnVouchers) > 0)
    );
    return initialPurchase
      ? getDefaultPurchaseReturnQuantities(initialPurchase, returnVouchers)
      : {};
  });
  const [notes, setNotes] = useState(() => {
    const initialPurchase = purchases.find((purchase) =>
      purchase.items.some((item) => getAvailablePurchaseQuantity(item, returnVouchers) > 0)
    );
    return initialPurchase?.notes || '';
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = isRtl ? 'ر.س ' : settings.currencySymbol || 'SAR ';

  const eligiblePurchases = useMemo(
    () => purchases.filter((purchase) =>
      purchase.items.some((item) => getAvailablePurchaseQuantity(item, returnVouchers) > 0)
    ),
    [purchases, returnVouchers]
  );
  const matchingPurchases = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return eligiblePurchases
      .filter((purchase) =>
        purchase.invoiceNumber.toLowerCase().includes(query) ||
        purchase.vendorName.toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [eligiblePurchases, search]);

  const returnAmounts = selectedPurchase
    ? getPurchaseReturnAmounts(selectedPurchase, quantities, returnVouchers)
    : { subtotal: 0, taxAmount: 0, total: 0 };
  const returnLines = selectedPurchase?.items.filter((item) => (quantities[item.id] || 0) > 0) || [];
  const returnedQuantity = returnLines.reduce((sum, item) => sum + (quantities[item.id] || 0), 0);

  const handleProcess = async () => {
    if (!selectedPurchase || returnLines.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setError(null);
    try {
      await onProcessReturn({
        purchaseId: selectedPurchase.id,
        notes,
        items: returnLines.map((item) => ({
          purchaseItemId: item.id,
          quantity: quantities[item.id] || 0,
        })),
      });
      setSelectedPurchase(null);
      setQuantities({});
      setNotes('');
      setSearch('');
    } catch (processError) {
      setError(
        processError instanceof Error ? processError.message : 'Failed to process purchase return.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-xs sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-700 text-white">
            <RotateCcw className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-slate-900">
              {isRtl ? 'مرتجع مشتريات' : 'Purchase Return Entry'}
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {isRtl
                ? 'اختر فاتورة شراء وأدخل الكميات المرتجعة للمورد.'
                : 'Select a purchase invoice and enter quantities being returned to the supplier.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenReturnHistory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">{isRtl ? 'سجل المرتجعات' : 'Return History'}</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{isRtl ? 'العودة للمشتريات' : 'Back to purchases'}</span>
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        {!selectedPurchase ? (
          <section className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center p-6">
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-4 text-center text-xs text-slate-500">
              {isRtl ? 'لا توجد مشتريات قابلة للإرجاع.' : 'There are no purchases with returnable items.'}
            </p>
          </section>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section className="flex shrink-0 flex-wrap items-end gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4 sm:py-3">
              <div className="relative min-w-[180px] max-w-[260px] flex-1 basis-[220px]">
                <label className="mb-1 block text-[11px] font-medium text-slate-700">
                  {isRtl ? 'المورد' : 'Vendor'}
                </label>
                <input
                  readOnly
                  value={selectedPurchase.vendorName}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                />
              </div>
              <div className="w-[150px] shrink-0">
                <label className="mb-1 block text-[11px] font-medium text-slate-700">
                  {isRtl ? 'رقم الفاتورة' : 'Invoice Number'}
                </label>
                <select
                  value={selectedPurchase.invoiceNumber}
                  onChange={(event) => {
                    const purchase = eligiblePurchases.find(
                      (candidate) => candidate.invoiceNumber === event.target.value
                    );
                    if (!purchase) return;
                    setSelectedPurchase(purchase);
                    setQuantities(getDefaultPurchaseReturnQuantities(purchase, returnVouchers));
                    setNotes(purchase.notes || '');
                    setError(null);
                  }}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900"
                >
                  {eligiblePurchases.map((purchase) => (
                    <option key={purchase.id} value={purchase.invoiceNumber}>
                      {purchase.invoiceNumber}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-[130px] shrink-0">
                <label className="mb-1 block text-[11px] font-medium text-slate-700">
                  {isRtl ? 'تاريخ الاستلام' : 'Date Received'}
                </label>
                <input
                  readOnly
                  value={selectedPurchase.receivedDate}
                  type="date"
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                />
              </div>
              <div className="ml-auto flex items-end justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setQuantities(getDefaultPurchaseReturnQuantities(selectedPurchase, returnVouchers))}
                  className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 lg:px-3"
                >
                  <RotateCcw className="h-4 w-4" />
                  {isRtl ? 'نسخ كامل الشراء' : 'Copy full purchase'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPurchase(eligiblePurchases[0] || null)}
                  className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 lg:px-3"
                >
                  {isRtl ? 'فاتورة أخرى' : 'Another invoice'}
                </button>
              </div>
            </section>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className={`w-full border-collapse text-xs ${isRtl ? 'text-right' : 'text-left'}`}>
                <thead className="sticky top-0 bg-slate-100 text-slate-600">
                  <tr>
                    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'رقم' : 'Sl no'}</th>
                    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'الباركود' : 'Barcode / SKU'}</th>
                    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'الصنف' : 'Product'}</th>
                    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'الكمية المشتراة' : 'Purchased'}</th>
                    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'المتبقي للإرجاع' : 'Returnable'}</th>
                    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'كمية الإرجاع' : 'Return qty'}</th>
                    <th className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'السعر' : 'Rate'}</th>
                    <th className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</th>
                    <th className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجمالي' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedPurchase.items.map((item, index) => {
                    const available = getAvailablePurchaseQuantity(item, returnVouchers);
                    const quantity = quantities[item.id] || 0;
                    return (
                      <tr key={item.id} className={available === 0 ? 'text-slate-400' : 'text-slate-800'}>
                        <td className="px-3 py-2 text-center">{index + 1}</td>
                        <td className="px-3 py-2 font-mono">{item.sku}</td>
                        <td className="px-3 py-2">
                          <div className="font-semibold">{item.productName}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{item.quantity}</td>
                        <td className="whitespace-nowrap px-3 py-2">{available}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            max={available}
                            step="any"
                            disabled={available === 0}
                            value={quantity || ''}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setQuantities((current) => ({
                                ...current,
                                [item.id]: Math.min(available, Math.max(0, Number.isFinite(value) ? value : 0)),
                              }));
                            }}
                            className="w-24 rounded border border-slate-300 px-2 py-1.5 text-center font-mono disabled:bg-slate-100"
                          />
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 font-mono ${isRtl ? 'text-left' : 'text-right'}`}>
                          {currency}{item.unitCost.toFixed(settings.decimalPoints ?? 2)}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 font-mono ${isRtl ? 'text-left' : 'text-right'}`}>
                          {currency}{Number((quantity * item.unitCost).toFixed(2)).toFixed(settings.decimalPoints ?? 2)}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 font-mono ${isRtl ? 'text-left' : 'text-right'}`}>
                          {currency}{Number((quantity * item.unitCost).toFixed(2)).toFixed(settings.decimalPoints ?? 2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer className="shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <label className="flex-1 text-xs font-medium text-slate-600">
                  {isRtl ? 'ملاحظات' : 'Notes'}
                  <input
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm font-normal text-slate-900"
                    placeholder={isRtl ? 'اختياري' : 'Optional'}
                  />
                </label>
                <div className="min-w-[220px] space-y-1 text-xs">
                  <div className="flex justify-between gap-6 text-slate-500">
                    <span>{isRtl ? 'الكمية المرتجعة' : 'Returned quantity'}</span>
                    <span className="font-mono">{returnedQuantity}</span>
                  </div>
                  <div className="flex justify-between gap-6 text-slate-500">
                    <span>{isRtl ? 'قيمة الأصناف' : 'Items value'}</span>
                    <span className="font-mono">{currency}{returnAmounts.subtotal.toFixed(2)}</span>
                  </div>
                  {returnAmounts.taxAmount > 0 && (
                    <div className="flex justify-between gap-6 text-slate-500">
                      <span>{isRtl ? 'ضريبة مستردة' : 'Tax credit'}</span>
                      <span className="font-mono">{currency}{returnAmounts.taxAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-6 border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900">
                    <span>{isRtl ? 'إجمالي إشعار الدائن' : 'Total supplier credit'}</span>
                    <span className="font-mono">{currency}{returnAmounts.total.toFixed(2)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isProcessing || returnLines.length === 0}
                  onClick={() => setIsConfirmOpen(true)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-rose-700 px-5 text-sm font-bold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <RotateCcw className="h-4 w-4" />
                  {isProcessing
                    ? (isRtl ? 'جارٍ حفظ المرتجع...' : 'Saving return...')
                    : (isRtl ? 'حفظ مرتجع المشتريات' : 'Save purchase return')}
                </button>
              </div>
              {error && (
                <p role="alert" className="mx-auto mt-2 max-w-5xl rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}
            </footer>
          </div>
        )}
      </main>
      {isConfirmOpen && selectedPurchase && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-return-confirm-title"
        >
          <section className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <h2 id="purchase-return-confirm-title" className="text-sm font-bold text-slate-900">
                  {isRtl ? 'تأكيد مرتجع المشتريات' : 'Confirm purchase return'}
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedPurchase.invoiceNumber} · {selectedPurchase.vendorName}
                </p>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-rose-100 bg-rose-50/60 p-3 text-xs text-slate-700">
              <div className="flex justify-between gap-3">
                <span>{isRtl ? 'الكمية المرتجعة' : 'Returned quantity'}</span>
                <strong>{returnedQuantity}</strong>
              </div>
              <div className="flex justify-between gap-3 border-t border-rose-200 pt-2 text-sm">
                <span className="font-semibold">{isRtl ? 'إجمالي إشعار الدائن' : 'Supplier credit total'}</span>
                <strong className="font-mono">{currency}{returnAmounts.total.toFixed(2)}</strong>
              </div>
            </div>
            <p className="text-xs text-slate-600">
              {isRtl
                ? 'سيتم خصم الكميات من المخزون وتسجيل إشعار دائن للمورد.'
                : 'This will reduce stock and record a supplier credit for the returned goods.'}
            </p>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setIsConfirmOpen(false)}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
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
                className="inline-flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {isProcessing
                  ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...')
                  : (isRtl ? 'تأكيد وحفظ' : 'Confirm and save')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export const PurchaseReturnHistoryView: React.FC<PurchaseReturnHistoryViewProps> = ({
  vouchers,
  settings,
  onCreateReturn,
  onDeleteVoucher,
}) => {
  const { isRtl } = useLanguage();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const currency = isRtl ? 'ر.س ' : settings.currencySymbol || 'SAR ';
  const filteredVouchers = vouchers.filter((voucher) => {
    const query = search.trim().toLowerCase();
    return !query ||
      voucher.voucherNumber.toLowerCase().includes(query) ||
      voucher.invoiceNumber.toLowerCase().includes(query) ||
      voucher.vendorName.toLowerCase().includes(query) ||
      voucher.items.some((item) => item.productName.toLowerCase().includes(query));
  });

  const handleDelete = async (voucher: PurchaseReturnVoucher) => {
    if (!window.confirm(
      isRtl
        ? `هل تريد حذف سند المرتجع ${voucher.voucherNumber}؟ ستتم إعادة الكميات إلى المخزون.`
        : `Delete return voucher ${voucher.voucherNumber}? The returned quantities will be restored to stock.`
    )) return;
    setDeletingId(voucher.id);
    setError(null);
    try {
      await onDeleteVoucher(voucher.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete purchase return.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-sm font-bold text-slate-900">
            {isRtl ? 'سجل مرتجعات المشتريات' : 'Purchase Return History'}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {vouchers.length} {isRtl ? 'سند مرتجع' : 'return vouchers'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isRtl ? 'بحث...' : 'Search returns...'}
              className={`w-52 rounded-lg border border-slate-300 py-2 text-xs focus:border-blue-600 focus:outline-none ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
            />
          </label>
          {onCreateReturn && (
            <button
              type="button"
              onClick={onCreateReturn}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              <Plus className="h-4 w-4" />
              {isRtl ? 'مرتجع جديد' : 'New return'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="m-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className={`w-full min-w-[900px] border-collapse text-xs ${isRtl ? 'text-right' : 'text-left'}`}>
          <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] text-slate-600">
            <tr>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'التاريخ' : 'Date'}</th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'رقم السند' : 'Voucher #'}</th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'فاتورة الشراء' : 'Purchase invoice'}</th>
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2">{isRtl ? 'المورد' : 'Supplier'}</th>
              <th className="border-b border-slate-200 px-3 py-2">{isRtl ? 'الأصناف' : 'Items'}</th>
              <th className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'قيمة الإرجاع' : 'Credit amount'}</th>
              <th className="border-b border-slate-200 px-3 py-2 text-center">{isRtl ? 'حذف' : 'Delete'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filteredVouchers.map((voucher) => (
              <tr key={voucher.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2">{new Date(voucher.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-US')}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold">{voucher.voucherNumber}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{voucher.invoiceNumber}</td>
                <td className="whitespace-nowrap px-3 py-2">{voucher.vendorName}</td>
                <td className="max-w-[360px] px-3 py-2">
                  <span className="block truncate" title={voucher.items.map((item) => `${item.productName} × ${item.quantity}`).join(', ')}>
                    {voucher.items.map((item) => `${item.productName} × ${item.quantity}`).join(', ')}
                  </span>
                  {voucher.notes && <span className="block truncate text-[10px] text-slate-400">{voucher.notes}</span>}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 font-mono font-semibold ${isRtl ? 'text-left' : 'text-right'}`}>
                  {currency}{voucher.total.toFixed(settings.decimalPoints ?? 2)}
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    type="button"
                    disabled={deletingId === voucher.id}
                    onClick={() => void handleDelete(voucher)}
                    aria-label={`${isRtl ? 'حذف سند' : 'Delete voucher'} ${voucher.voucherNumber}`}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {filteredVouchers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  <Receipt className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  {isRtl ? 'لا توجد مرتجعات مشتريات.' : 'No purchase returns found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
