import React, { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { Customer, Product, Sale, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { calculateSalesTax } from '../utils/salesTax';

interface ErpSalesViewProps {
  products: Product[];
  customers: Customer[];
  settings: StoreSettings;
  onSaleCompleted: (sale: Sale, queuedOffline: boolean) => void;
}

interface ErpSaleRow {
  id: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  remark: string;
}

const getTodayDate = () => {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const createEmptyRow = (id: number): ErpSaleRow => ({
  id,
  productId: '',
  quantity: '1',
  unitPrice: '',
  remark: '',
});

export const ErpSalesView: React.FC<ErpSalesViewProps> = ({
  products,
  customers,
  settings,
  onSaleCompleted,
}) => {
  const { isRtl } = useLanguage();
  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayDate);
  const [isCredit, setIsCredit] = useState(false);
  const [rows, setRows] = useState<ErpSaleRow[]>([createEmptyRow(1)]);
  const [nextRowId, setNextRowId] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const customer = customers.find((entry) => entry.id === Number(customerId));
  const totals = useMemo(() => {
    const tax = calculateSalesTax(
      rows.flatMap((row) => {
        const product = products.find((entry) => entry.id === Number(row.productId));
        const quantity = Number(row.quantity);
        const unitPrice = Number(row.unitPrice);
        if (
          !product ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(unitPrice) ||
          unitPrice < 0
        ) {
          return [];
        }
        return [{ amount: quantity * unitPrice, taxRate: product.taxRate ?? settings.taxRate }];
      }),
      0,
      settings.taxType
    );
    const total = settings.roundTotalToFiveCents
      ? Number((Math.round(tax.total * 20) / 20).toFixed(2))
      : tax.total;
    return { subtotal: tax.subtotal, tax: tax.taxAmount, total };
  }, [products, rows, settings.roundTotalToFiveCents, settings.taxRate, settings.taxType]);

  const addRow = () => {
    setRows((current) => [...current, createEmptyRow(nextRowId)]);
    setNextRowId((current) => current + 1);
  };

  const updateRow = (rowId: number, patch: Partial<ErpSaleRow>) => {
    setRows((current) =>
      current.map((row) => row.id === rowId ? { ...row, ...patch } : row)
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!rows.length || rows.some((row) => !row.productId)) {
      setError(isRtl ? 'اختر صنفاً لكل سطر.' : 'Select a product for every line.');
      return;
    }
    if (isCredit && !customer) {
      setError(isRtl ? 'اختر عميلاً للفاتورة الآجلة.' : 'Select a customer for a credit invoice.');
      return;
    }
    if (rows.some((row) =>
      !Number.isFinite(Number(row.quantity)) ||
      Number(row.quantity) <= 0 ||
      !Number.isFinite(Number(row.unitPrice)) ||
      Number(row.unitPrice) < 0
    )) {
      setError(isRtl ? 'تحقق من الكمية والسعر.' : 'Check each line quantity and price.');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appScreenMode: 'erp',
          customerId: customer ? customer.id : null,
          customerName: customer?.name || settings.defaultCustomer,
          ...(settings.allowInvoiceDateEdit ? { invoiceDate } : {}),
          discountType: 'fixed',
          discountValue: 0,
          paymentMethod: isCredit ? 'Credit' : 'Cash',
          amountTendered: isCredit ? 0 : totals.total,
          items: rows.map((row) => ({
            productId: Number(row.productId),
            quantity: Number(row.quantity),
            unitPrice: Number(row.unitPrice),
            description: row.remark.trim(),
          })),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' &&
          payload !== null &&
          'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : `Could not save invoice (HTTP ${response.status}).`;
        throw new Error(message);
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('sale' in payload) ||
        typeof payload.sale !== 'object' ||
        payload.sale === null
      ) {
        throw new Error('The sales service returned an invalid invoice.');
      }
      const result = payload as { sale: Sale; queuedOfflinePrint?: boolean };
      onSaleCompleted(result.sale, result.queuedOfflinePrint === true);
      setCustomerId('');
      setInvoiceDate(getTodayDate());
      setIsCredit(false);
      setRows([createEmptyRow(nextRowId)]);
      setNextRowId((current) => current + 1);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Could not save the invoice.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-slate-50 p-4 text-slate-900">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{isRtl ? 'إدخال فاتورة مبيعات' : 'Sales Invoice Entry'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isRtl ? 'aptERP' : 'aptERP · Sales'}
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
        >
          <Plus className="h-4 w-4" />
          {isRtl ? 'إضافة صنف' : 'Add Product'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {isRtl ? 'العميل' : 'Customer'}
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              className="rounded border border-slate-300 bg-white px-3 py-2 font-normal"
            >
              <option value="">{isRtl ? 'عميل نقدي (بدون حساب)' : 'Walk-in (no customer account)'}</option>
              {customers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {isRtl ? entry.nameAr || entry.name : entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {isRtl ? 'تاريخ الفاتورة' : 'Invoice Date'}
            <input
              type="date"
              value={invoiceDate}
              disabled={!settings.allowInvoiceDateEdit}
              onChange={(event) => setInvoiceDate(event.target.value)}
              className="rounded border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100 disabled:text-slate-500"
            />
            {!settings.allowInvoiceDateEdit && (
              <span className="text-xs font-normal text-slate-500">
                {isRtl
                  ? 'للتعديل، فعّل الخيار من الإعدادات ← السندات.'
                  : 'To edit, enable this in Settings → Vouchers.'}
              </span>
            )}
          </label>
          <label className="flex items-center gap-3 self-center rounded border border-slate-200 px-3 py-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={isCredit}
              onChange={(event) => setIsCredit(event.target.checked)}
              className="h-4 w-4 accent-violet-700"
            />
            {isRtl ? 'فاتورة آجلة' : 'Credit Invoice'}
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className={`w-full min-w-[760px] border-collapse text-sm ${isRtl ? 'text-right' : 'text-left'}`}>
            <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="border-b border-slate-200 px-3 py-3">{isRtl ? 'الصنف' : 'Product'}</th>
                <th className="w-28 border-b border-slate-200 px-3 py-3">{isRtl ? 'الكمية' : 'Quantity'}</th>
                <th className="w-36 border-b border-slate-200 px-3 py-3">{isRtl ? 'السعر' : 'Rate'}</th>
                <th className="border-b border-slate-200 px-3 py-3">{isRtl ? 'ملاحظات' : 'Remark'}</th>
                <th className="w-36 border-b border-slate-200 px-3 py-3">{isRtl ? 'الإجمالي' : 'Total'}</th>
                <th className="w-14 border-b border-slate-200 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const product = products.find((entry) => entry.id === Number(row.productId));
                const lineTotal = product
                  ? Number(row.quantity || 0) * Number(row.unitPrice || 0)
                  : 0;
                return (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <select
                        required
                        value={row.productId}
                        onChange={(event) => {
                          const selectedProduct = products.find(
                            (entry) => entry.id === Number(event.target.value)
                          );
                          updateRow(row.id, {
                            productId: event.target.value,
                            unitPrice: selectedProduct ? String(selectedProduct.retailPrice) : '',
                          });
                        }}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-2"
                      >
                        <option value="">{isRtl ? 'اختر صنفاً' : 'Select product'}</option>
                        {products.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.sku} · {isRtl ? entry.nameAr || entry.name : entry.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        value={row.quantity}
                        onChange={(event) => updateRow(row.id, { quantity: event.target.value })}
                        className="w-full rounded border border-slate-300 px-2 py-2"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.unitPrice}
                        onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })}
                        className="w-full rounded border border-slate-300 px-2 py-2"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.remark}
                        onChange={(event) => updateRow(row.id, { remark: event.target.value })}
                        placeholder={isRtl ? 'اختياري' : 'Optional'}
                        className="w-full rounded border border-slate-300 px-2 py-2"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {lineTotal.toFixed(settings.decimalPoints ?? 2)} {settings.currencySymbol}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        disabled={rows.length === 1}
                        onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
                        aria-label={isRtl ? 'حذف الصنف' : 'Remove product'}
                        className="rounded p-2 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="min-w-[220px] space-y-1 text-sm">
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">{isRtl ? 'الإجمالي قبل الضريبة' : 'Subtotal'}</span>
              <span>{totals.subtotal.toFixed(2)} {settings.currencySymbol}</span>
            </div>
            <div className="flex justify-between gap-8">
              <span className="text-slate-500">{isRtl ? 'الضريبة' : 'Tax'}</span>
              <span>{totals.tax.toFixed(2)} {settings.currencySymbol}</span>
            </div>
            <div className="flex justify-between gap-8 border-t border-slate-200 pt-2 text-base font-semibold">
              <span>{isRtl ? 'الإجمالي' : 'Invoice Total'}</span>
              <span>{totals.total.toFixed(2)} {settings.currencySymbol}</span>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-56">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={saving || products.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-violet-700 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…') : (isRtl ? 'حفظ الفاتورة' : 'Save Invoice')}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
};
