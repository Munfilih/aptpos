import React, { useMemo, useState } from 'react';
import { AlertCircle, Plus, Save, Trash2 } from 'lucide-react';
import type { Customer, Product, Sale, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { calculateSalesTax } from '../utils/salesTax';
import { AppDateInput } from './AppDateInput';

interface ErpSalesViewProps {
  products: Product[];
  customers: Customer[];
  settings: StoreSettings;
  onSaleCompleted: (sale: Sale, queuedOffline: boolean) => void;
}

interface ErpSaleRow {
  id: number;
  productId: number | null;
  barcode: string;
  productSearch: string;
  unitId: string;
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
  productId: null,
  barcode: '',
  productSearch: '',
  unitId: '',
  quantity: '1',
  unitPrice: '',
  remark: '',
});

const getProductForBarcode = (products: Product[], barcode: string) => {
  const query = barcode.trim().toLocaleLowerCase();
  if (!query) return undefined;

  for (const product of products) {
    if (product.barcode.toLocaleLowerCase() === query) {
      return { product, unitId: '' };
    }

    const multiUnit = product.multiUnits?.find(
      (unit) => unit.barcode.toLocaleLowerCase() === query
    );
    if (multiUnit) return { product, unitId: multiUnit.id };

    const additionalBarcode = product.additionalBarcodes?.find(
      (entry) => entry.barcode.toLocaleLowerCase() === query
    );
    if (additionalBarcode) {
      return { product, unitId: additionalBarcode.unitId || '' };
    }
  }

  return undefined;
};

export const ErpSalesView: React.FC<ErpSalesViewProps> = ({
  products,
  customers,
  settings,
  onSaleCompleted,
}) => {
  const { isRtl } = useLanguage();
  const currency = settings.currencySymbol || 'SAR';
  const decimalPlaces = settings.decimalPoints ?? 2;
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(getTodayDate);
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card' | 'Credit'>('Cash');
  const [cashTendered, setCashTendered] = useState('');
  const [rows, setRows] = useState<ErpSaleRow[]>([createEmptyRow(1)]);
  const [nextRowId, setNextRowId] = useState(2);
  const [productSearchOpenRowId, setProductSearchOpenRowId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const customer = customers.find((entry) => entry.id === customerId);
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLocaleLowerCase();
    if (!query) return customers;
    return customers.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(query) ||
      (entry.nameAr?.toLocaleLowerCase().includes(query) ?? false) ||
      entry.phone.toLocaleLowerCase().includes(query) ||
      entry.email.toLocaleLowerCase().includes(query)
    );
  }, [customerSearch, customers]);

  const getUnitDetails = (product: Product, unitId: string) => {
    const unit = product.multiUnits?.find((entry) => entry.id === unitId);
    return {
      name: unit?.name || product.unit,
      factor: unit?.unitsPerBase || 1,
      price: unit ? unit.price ?? product.retailPrice * unit.unitsPerBase : product.retailPrice,
    };
  };

  const rowDetails = useMemo(() => rows.map((row) => {
    const product = products.find((entry) => entry.id === row.productId);
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    const validLine =
      product &&
      Number.isFinite(quantity) &&
      quantity > 0 &&
      Number.isFinite(unitPrice) &&
      unitPrice >= 0;
    const amount = validLine ? quantity * unitPrice : 0;
    const taxRate = product?.taxRate ?? settings.taxRate;
    const tax = calculateSalesTax(
      validLine ? [{ amount, taxRate }] : [],
      0,
      settings.taxType
    );
    const unit = product ? getUnitDetails(product, row.unitId) : null;

    return {
      product,
      subtotal: tax.subtotal,
      taxAmount: tax.taxAmount,
      total: tax.total,
      stockInUnit: product && unit ? product.stock / unit.factor : 0,
      unitName: unit?.name || '',
    };
  }), [products, rows, settings.taxRate, settings.taxType]);

  const totals = useMemo(() => {
    const tax = calculateSalesTax(
      rows.flatMap((row, index) => {
        const detail = rowDetails[index];
        const quantity = Number(row.quantity);
        const unitPrice = Number(row.unitPrice);
        if (
          !detail.product ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(unitPrice) ||
          unitPrice < 0
        ) {
          return [];
        }
        return [{
          amount: quantity * unitPrice,
          taxRate: detail.product.taxRate ?? settings.taxRate,
        }];
      }),
      0,
      settings.taxType
    );
    const total = settings.roundTotalToFiveCents
      ? Number((Math.round(tax.total * 20) / 20).toFixed(2))
      : tax.total;
    return { subtotal: tax.subtotal, tax: tax.taxAmount, total };
  }, [rowDetails, rows, settings.roundTotalToFiveCents, settings.taxRate, settings.taxType]);

  const addRow = () => {
    setRows((current) => [...current, createEmptyRow(nextRowId)]);
    setNextRowId((current) => current + 1);
  };

  const updateRow = (rowId: number, patch: Partial<ErpSaleRow>) => {
    setRows((current) =>
      current.map((row) => row.id === rowId ? { ...row, ...patch } : row)
    );
  };

  const selectProduct = (row: ErpSaleRow, product: Product, unitId = '') => {
    const unit = getUnitDetails(product, unitId);
    const selectedUnit = product.multiUnits?.find((entry) => entry.id === unitId);
    updateRow(row.id, {
      productId: product.id,
      productSearch: isRtl ? product.nameAr || product.name : product.name,
      barcode: selectedUnit?.barcode || product.barcode,
      unitId,
      unitPrice: String(unit.price),
    });
    setProductSearchOpenRowId(null);
    setError(null);
  };

  const clearDraft = () => {
    setCustomerId(null);
    setCustomerSearch('');
    setCustomerSearchOpen(false);
    setInvoiceDate(getTodayDate());
    setPaymentMethod('Cash');
    setCashTendered('');
    setRows([createEmptyRow(nextRowId)]);
    setNextRowId((current) => current + 1);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!rows.length || rows.some((row) => !row.productId)) {
      setError(isRtl ? 'اختر صنفاً لكل سطر أو احذف السطر الفارغ.' : 'Select a product for every line or remove the empty line.');
      return;
    }
    if (paymentMethod === 'Credit' && !customer) {
      setError(isRtl ? 'اختر عميلاً للفاتورة الآجلة.' : 'Select a customer for a credit invoice.');
      return;
    }
    if (rows.some((row) =>
      !Number.isFinite(Number(row.quantity)) ||
      Number(row.quantity) <= 0 ||
      !Number.isFinite(Number(row.unitPrice)) ||
      Number(row.unitPrice) < 0
    )) {
      setError(isRtl ? 'تحقق من الكمية والسعر لكل صنف.' : 'Check the quantity and rate for each product.');
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
          paymentMethod,
          amountTendered: paymentMethod === 'Credit'
            ? 0
            : paymentMethod === 'Cash'
              ? Math.max(totals.total, Number(cashTendered || totals.total))
              : totals.total,
          items: rows.map((row) => ({
            productId: row.productId,
            quantity: Number(row.quantity),
            ...(row.unitId ? { unitId: row.unitId } : {}),
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
      clearDraft();
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 text-slate-900">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">{isRtl ? 'إدخال فاتورة مبيعات' : 'Sales Invoice Entry'}</h1>
          <p className="mt-0.5 text-xs text-slate-500">{isRtl ? 'aptERP · المبيعات' : 'aptERP · Sales'}</p>
        </div>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" />
          {isRtl ? 'إضافة صنف' : 'Add Product'}
        </button>
      </header>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-1 gap-2 border-b border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="relative min-w-0">
            <label htmlFor="erp-sale-customer" className="mb-1 block text-[11px] font-medium text-slate-700">
              {isRtl ? 'العميل' : 'Customer'}
            </label>
            <input
              id="erp-sale-customer"
              type="text"
              autoComplete="off"
              value={
                customerSearchOpen
                  ? customerSearch
                  : customer
                    ? (isRtl ? customer.nameAr || customer.name : customer.name)
                    : ''
              }
              onFocus={() => {
                setCustomerSearch('');
                setCustomerSearchOpen(true);
              }}
              onBlur={() => setCustomerSearchOpen(false)}
              onChange={(event) => {
                setCustomerId(null);
                setCustomerSearch(event.target.value);
                setCustomerSearchOpen(true);
              }}
              placeholder={isRtl ? 'عميل نقدي أو ابحث عن عميل' : 'Walk-in customer or search customers'}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={customerSearchOpen}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs focus:border-blue-700 focus:outline-none"
            />
            {customerSearchOpen && (
              <div className="absolute inset-x-0 top-full z-30 max-h-56 overflow-y-auto border border-slate-200 bg-white shadow-lg">
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setCustomerId(null);
                    setCustomerSearch('');
                    setCustomerSearchOpen(false);
                  }}
                  className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-blue-50"
                >
                  {isRtl ? 'عميل نقدي (بدون حساب)' : 'Walk-in Customer (no account)'}
                </button>
                {filteredCustomers.length ? filteredCustomers.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCustomerId(entry.id);
                      setCustomerSearch('');
                      setCustomerSearchOpen(false);
                    }}
                    className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 hover:bg-blue-50"
                  >
                    <span className="block truncate font-medium">
                      {isRtl ? entry.nameAr || entry.name : entry.name}
                    </span>
                    {entry.phone && <span className="block text-[10px] text-slate-500">{entry.phone}</span>}
                  </button>
                )) : (
                  <div className="px-3 py-2 text-xs text-slate-500">
                    {isRtl ? 'لا يوجد عميل مطابق' : 'No matching customers'}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="erp-sale-date" className="mb-1 block text-[11px] font-medium text-slate-700">
              {isRtl ? 'تاريخ الفاتورة' : 'Invoice Date'}
            </label>
            <AppDateInput
              id="erp-sale-date"
              value={invoiceDate}
              disabled={!settings.allowInvoiceDateEdit}
              onChange={setInvoiceDate}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs disabled:bg-slate-100 disabled:text-slate-500"
            />
            {!settings.allowInvoiceDateEdit && (
              <span className="mt-1 block text-[10px] text-slate-500">
                {isRtl ? 'التعديل متاح من الإعدادات ← السندات.' : 'Enable editing in Settings → Vouchers.'}
              </span>
            )}
          </div>

          <div>
            <label htmlFor="erp-sale-payment" className="mb-1 block text-[11px] font-medium text-slate-700">
              {isRtl ? 'طريقة الدفع' : 'Payment Method'}
            </label>
            <select
              id="erp-sale-payment"
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as 'Cash' | 'Card' | 'Credit')}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="Cash">{isRtl ? 'نقداً' : 'Cash'}</option>
              <option value="Card">{isRtl ? 'بطاقة' : 'Card'}</option>
              <option value="Credit">{isRtl ? 'آجل' : 'Credit'}</option>
            </select>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-white">
          <table className={`w-full min-w-[1160px] border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold text-slate-600">
              <tr>
                <th className="w-12 border border-slate-300 px-1 py-2 text-center">{isRtl ? 'رقم' : 'Sl no'}</th>
                <th className="w-36 border border-slate-300 px-2 py-2">{isRtl ? 'الباركود' : 'Barcode'}</th>
                <th className="min-w-[220px] border border-slate-300 px-2 py-2">{isRtl ? 'اسم الصنف' : 'Name'}</th>
                <th className="w-24 border border-slate-300 px-2 py-2">{isRtl ? 'الكمية' : 'Quantity'}</th>
                <th className="w-28 border border-slate-300 px-2 py-2">{isRtl ? 'الوحدة' : 'Unit'}</th>
                <th className="w-28 border border-slate-300 px-2 py-2 text-right">{isRtl ? 'السعر' : 'Rate'}</th>
                <th className="w-28 border border-slate-300 px-2 py-2 text-right">{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</th>
                <th className="w-20 border border-slate-300 px-2 py-2 text-right">{isRtl ? 'الضريبة %' : 'Tax %'}</th>
                <th className="w-24 border border-slate-300 px-2 py-2 text-right">{isRtl ? 'الضريبة' : 'Tax'}</th>
                <th className="w-24 border border-slate-300 px-2 py-2 text-right">{isRtl ? 'المخزون' : 'Stock'}</th>
                <th className="w-28 border border-slate-300 px-2 py-2 text-right">{isRtl ? 'الإجمالي' : 'Total'}</th>
                <th className="w-12 border border-slate-300 px-1 py-2 text-center">{isRtl ? 'حذف' : 'Delete'}</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {rows.map((row, index) => {
                const detail = rowDetails[index];
                const product = detail.product;
                const selectedUnit = product?.multiUnits?.find((unit) => unit.id === row.unitId);
                const query = row.productSearch.trim().toLocaleLowerCase();
                const matchingProducts = query
                  ? products.filter((entry) =>
                    entry.name.toLocaleLowerCase().includes(query) ||
                    (entry.nameAr?.toLocaleLowerCase().includes(query) ?? false) ||
                    entry.sku.toLocaleLowerCase().includes(query) ||
                    entry.barcode.toLocaleLowerCase().includes(query) ||
                    entry.category.toLocaleLowerCase().includes(query) ||
                    (entry.brand?.toLocaleLowerCase().includes(query) ?? false)
                  ).slice(0, 10)
                  : [];
                const barcodeMatch = getProductForBarcode(products, row.barcode);
                const taxRate = product?.taxRate ?? settings.taxRate;

                return (
                  <tr key={row.id} className="hover:bg-slate-50/60">
                    <td className="border border-slate-300 px-2 py-1 text-center text-[10px] text-slate-400">{index + 1}</td>
                    <td className="border border-slate-300 p-0">
                      <input
                        type="text"
                        value={row.barcode}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => updateRow(row.id, {
                          productId: null,
                          barcode: event.target.value,
                          productSearch: '',
                          unitId: '',
                          unitPrice: '',
                        })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (barcodeMatch) selectProduct(row, barcodeMatch.product, barcodeMatch.unitId);
                          }
                        }}
                        aria-label={isRtl ? 'الباركود' : 'Barcode'}
                        className="w-full border-0 bg-transparent px-2 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                      />
                    </td>
                    <td className="border border-slate-300 p-0">
                      <div className="relative">
                        <input
                          type="text"
                          value={row.productSearch}
                          onFocus={() => setProductSearchOpenRowId(row.id)}
                          onBlur={() => setProductSearchOpenRowId(null)}
                          onChange={(event) => {
                            updateRow(row.id, {
                              productId: null,
                              barcode: '',
                              productSearch: event.target.value,
                              unitId: '',
                              unitPrice: '',
                            });
                            setProductSearchOpenRowId(row.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && matchingProducts[0]) {
                              event.preventDefault();
                              selectProduct(row, matchingProducts[0]);
                            }
                          }}
                          placeholder={isRtl ? 'ابحث عن صنف' : 'Search products'}
                          aria-label={isRtl ? 'اسم الصنف' : 'Product name'}
                          className="w-full border-0 bg-transparent px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                        />
                        {productSearchOpenRowId === row.id && matchingProducts.length > 0 && (
                          <div className="absolute inset-x-0 top-full z-20 max-h-56 overflow-y-auto border border-slate-200 bg-white shadow-lg">
                            {matchingProducts.map((entry) => (
                              <button
                                key={entry.id}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => selectProduct(row, entry)}
                                className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 hover:bg-blue-50"
                              >
                                <span className="block truncate font-medium">
                                  {entry.sku} · {isRtl ? entry.nameAr || entry.name : entry.name}
                                </span>
                                <span className="block text-[10px] text-slate-500">
                                  {isRtl ? 'المخزون' : 'Stock'}: {entry.stock}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input
                        type="number"
                        min={selectedUnit ? '1' : '0.001'}
                        step={selectedUnit ? '1' : 'any'}
                        value={row.quantity}
                        onChange={(event) => updateRow(row.id, { quantity: event.target.value })}
                        className="w-full border-0 bg-transparent px-2 py-2 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                      />
                    </td>
                    <td className="border border-slate-300 p-0">
                      <select
                        disabled={!product}
                        value={row.unitId}
                        onChange={(event) => {
                          if (!product) return;
                          const unit = getUnitDetails(product, event.target.value);
                          const selected = product.multiUnits?.find((entry) => entry.id === event.target.value);
                          updateRow(row.id, {
                            unitId: event.target.value,
                            barcode: selected?.barcode || product.barcode,
                            unitPrice: String(unit.price),
                          });
                        }}
                        className="w-full border-0 bg-transparent px-2 py-2 text-xs disabled:text-slate-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                      >
                        {product && <option value="">{product.unit}</option>}
                        {product?.multiUnits?.map((unit) => (
                          <option key={unit.id} value={unit.id}>{unit.name}</option>
                        ))}
                        {!product && <option value="">{isRtl ? '—' : '—'}</option>}
                      </select>
                    </td>
                    <td className="border border-slate-300 p-0">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.unitPrice}
                        onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })}
                        className="w-full border-0 bg-transparent px-2 py-2 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                      />
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right font-mono tabular-nums">
                      {product ? `${currency} ${detail.subtotal.toFixed(decimalPlaces)}` : '—'}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right font-mono tabular-nums">
                      {product ? `${taxRate}%` : '—'}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right font-mono tabular-nums">
                      {product ? `${currency} ${detail.taxAmount.toFixed(decimalPlaces)}` : '—'}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right font-mono tabular-nums">
                      {product ? detail.stockInUnit.toFixed(decimalPlaces) : '—'}
                    </td>
                    <td className="border border-slate-300 px-2 py-2 text-right font-mono font-semibold tabular-nums">
                      {product ? `${currency} ${detail.total.toFixed(decimalPlaces)}` : '—'}
                    </td>
                    <td className="border border-slate-300 px-1 py-1 text-center">
                      <button
                        type="button"
                        disabled={rows.length === 1}
                        onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
                        aria-label={isRtl ? 'حذف الصنف' : 'Remove product'}
                        className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="grid shrink-0 grid-cols-1 gap-3 border-t border-slate-200 bg-white p-3 sm:grid-cols-[minmax(220px,1fr)_minmax(260px,auto)] sm:items-end sm:px-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            {paymentMethod === 'Cash' && (
              <label className="min-w-36 text-[11px] font-medium text-slate-600">
                {isRtl ? 'المبلغ المستلم' : 'Amount Tendered'}
                <input
                  type="number"
                  min={totals.total}
                  step="0.01"
                  value={cashTendered}
                  onChange={(event) => setCashTendered(event.target.value)}
                  placeholder={totals.total.toFixed(decimalPlaces)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-2 text-right font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </label>
            )}
            <div className="min-w-44 space-y-1 text-xs">
              <div className="flex justify-between gap-8">
                <span className="text-slate-500">{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span>
                <span className="font-mono tabular-nums">{currency} {totals.subtotal.toFixed(decimalPlaces)}</span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-slate-500">{isRtl ? 'الضريبة' : 'Tax'}</span>
                <span className="font-mono tabular-nums">{currency} {totals.tax.toFixed(decimalPlaces)}</span>
              </div>
              <div className="flex justify-between gap-8 border-t border-slate-200 pt-1.5 text-sm font-semibold">
                <span>{isRtl ? 'إجمالي الفاتورة' : 'Invoice Total'}</span>
                <span className="font-mono tabular-nums">{currency} {totals.total.toFixed(decimalPlaces)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={clearDraft}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {isRtl ? 'مسح' : 'Clear'}
            </button>
            <button
              type="submit"
              disabled={saving || products.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…') : (isRtl ? 'حفظ الفاتورة' : 'Save Invoice')}
            </button>
          </div>
        </footer>
      </form>
    </section>
  );
};
