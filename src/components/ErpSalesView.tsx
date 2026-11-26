import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Plus, Save, Search, Trash2, X } from 'lucide-react';
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

type GridField = 'barcode' | 'productSearch' | 'quantity' | 'unitPrice';

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
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState('0');
  const [cashTendered, setCashTendered] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ErpSaleRow[]>([createEmptyRow(1)]);
  const [nextRowId, setNextRowId] = useState(2);
  const [productSearchOpenRowId, setProductSearchOpenRowId] = useState<number | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const formRef = useRef<HTMLFormElement | null>(null);
  const cellRefs = useRef(new Map<number, Partial<Record<GridField, HTMLInputElement>>>());

  const setCellRef = (rowId: number, field: GridField, el: HTMLInputElement | null) => {
    const entry = cellRefs.current.get(rowId) || {};
    if (el) entry[field] = el;
    else delete entry[field];
    if (Object.keys(entry).length > 0) cellRefs.current.set(rowId, entry);
    else cellRefs.current.delete(rowId);
  };

  const focusCell = (rowId: number, field: GridField, select = true) => {
    window.requestAnimationFrame(() => {
      const target = cellRefs.current.get(rowId)?.[field];
      if (!target) return;
      target.focus();
      if (select) target.select();
    });
  };

  useEffect(() => {
    focusCell(1, 'productSearch', false);
  }, []);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, []);

  const customer = customers.find((entry) => entry.id === customerId);
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLocaleLowerCase();
    if (!query) return customers.slice(0, 30);
    return customers.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(query) ||
      (entry.nameAr?.toLocaleLowerCase().includes(query) ?? false) ||
      entry.phone.toLocaleLowerCase().includes(query) ||
      entry.email.toLocaleLowerCase().includes(query)
    ).slice(0, 30);
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
    const stockInUnit = product && unit ? product.stock / unit.factor : 0;
    const costInUnit = product && unit && product.costPrice > 0 ? product.costPrice * unit.factor : 0;

    return {
      product,
      subtotal: tax.subtotal,
      taxAmount: tax.taxAmount,
      total: tax.total,
      stockInUnit,
      unitName: unit?.name || '',
      exceedsStock: Boolean(validLine && quantity > stockInUnit),
      belowCost: Boolean(validLine && costInUnit > 0 && unitPrice < costInUnit),
    };
  }), [products, rows, settings.taxRate, settings.taxType]);

  const totals = useMemo(() => {
    const grossItems = rows.flatMap((row, index) => {
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
    });
    const grossTotal = grossItems.reduce((sum, item) => sum + item.amount, 0);
    const parsedDiscount = Math.max(0, Number(discountValue) || 0);
    const discountAmount = discountType === 'percent'
      ? Number((grossTotal * Math.min(100, parsedDiscount) / 100).toFixed(2))
      : Number(Math.min(grossTotal, parsedDiscount).toFixed(2));
    const tax = calculateSalesTax(grossItems, discountAmount, settings.taxType);
    const total = settings.roundTotalToFiveCents
      ? Number((Math.round(tax.total * 20) / 20).toFixed(2))
      : tax.total;
    const lineCount = grossItems.length;
    const totalUnits = rows.reduce((sum, row, index) => {
      if (!rowDetails[index].product) return sum;
      const qty = Number(row.quantity);
      return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
    }, 0);
    return {
      subtotal: tax.subtotal,
      discountAmount,
      tax: tax.taxAmount,
      total,
      lineCount,
      totalUnits,
    };
  }, [discountType, discountValue, rowDetails, rows, settings.roundTotalToFiveCents, settings.taxRate, settings.taxType]);

  const tenderedAmount = paymentMethod === 'Cash'
    ? (cashTendered.trim() === '' ? totals.total : Number(cashTendered))
    : totals.total;
  const changeAmount = paymentMethod === 'Cash' && Number.isFinite(tenderedAmount)
    ? Math.max(0, Number((tenderedAmount - totals.total).toFixed(2)))
    : 0;

  const addRow = (focusField: GridField = 'productSearch') => {
    const newId = nextRowId;
    setRows((current) => [...current, createEmptyRow(newId)]);
    setNextRowId((current) => current + 1);
    focusCell(newId, focusField, false);
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
    focusCell(row.id, 'quantity');
  };

  const clearDraft = () => {
    const newId = nextRowId;
    setCustomerId(null);
    setCustomerSearch('');
    setCustomerSearchOpen(false);
    setInvoiceDate(getTodayDate());
    setPaymentMethod('Cash');
    setDiscountType('fixed');
    setDiscountValue('0');
    setCashTendered('');
    setNotes('');
    setRows([createEmptyRow(newId)]);
    setNextRowId((current) => current + 1);
    setError(null);
    focusCell(newId, 'productSearch', false);
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
          discountType,
          discountValue: Math.max(0, Number(discountValue) || 0),
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
            description: row.remark.trim() || notes.trim(),
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100/70 text-slate-900">
      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col border-x border-slate-200 bg-white">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-base font-bold text-slate-900">
                {isRtl ? 'فاتورة مبيعات' : 'Sales Invoice Entry'}
              </h1>
              <p className="text-[11px] text-slate-500">
                {isRtl ? 'aptERP · المبيعات · اختصار الحفظ Alt+S' : 'aptERP · Sales · Press Alt+S to save'}
              </p>
            </div>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-slate-600 sm:inline-flex">
              {totals.lineCount} {isRtl ? 'أصناف' : 'lines'} · {totals.totalUnits} {isRtl ? 'وحدة' : 'qty'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addRow('productSearch')}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {isRtl ? 'إضافة سطر' : 'Add Line'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={clearDraft}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isRtl ? 'مسح' : 'Clear'}
            </button>
          </div>
        </header>

        <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="grid shrink-0 grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative min-w-0 lg:col-span-2">
              <label htmlFor="erp-sale-customer" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {isRtl ? 'العميل' : 'Customer'}
              </label>
              <div className="relative">
                <Search className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-2.5' : 'left-2.5'}`} />
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
                  onBlur={() => window.setTimeout(() => setCustomerSearchOpen(false), 120)}
                  onChange={(event) => {
                    setCustomerId(null);
                    setCustomerSearch(event.target.value);
                    setCustomerSearchOpen(true);
                  }}
                  placeholder={isRtl ? 'عميل نقدي أو ابحث بالاسم / الهاتف...' : 'Walk-in customer or search name / phone...'}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={customerSearchOpen}
                  className={`w-full rounded border border-slate-200 bg-white py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none ${isRtl ? 'pr-8 pl-7' : 'pl-8 pr-7'}`}
                />
                {customerId !== null && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCustomerId(null);
                      setCustomerSearch('');
                    }}
                    aria-label={isRtl ? 'مسح العميل' : 'Clear customer'}
                    className={`absolute top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 ${isRtl ? 'left-2' : 'right-2'}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {customerSearchOpen && (
                <div className="absolute inset-x-0 top-full z-30 mt-0.5 max-h-56 overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCustomerId(null);
                      setCustomerSearch('');
                      setCustomerSearchOpen(false);
                    }}
                    className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-blue-50"
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
                      className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 hover:bg-blue-50"
                    >
                      <span className="truncate font-medium text-slate-900">
                        {isRtl ? entry.nameAr || entry.name : entry.name}
                      </span>
                      {entry.phone && <span className="shrink-0 font-mono text-[10px] text-slate-500">{entry.phone}</span>}
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
              <label htmlFor="erp-sale-date" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {isRtl ? 'تاريخ الفاتورة' : 'Invoice Date'}
              </label>
              <AppDateInput
                id="erp-sale-date"
                value={invoiceDate}
                disabled={!settings.allowInvoiceDateEdit}
                onChange={setInvoiceDate}
                className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>

            <div>
              <label htmlFor="erp-sale-payment" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {isRtl ? 'طريقة الدفع' : 'Payment Method'}
              </label>
              <select
                id="erp-sale-payment"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as 'Cash' | 'Card' | 'Credit')}
                className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-700 focus:outline-none"
              >
                <option value="Cash">{isRtl ? 'نقداً' : 'Cash'}</option>
                <option value="Card">{isRtl ? 'بطاقة' : 'Card'}</option>
                <option value="Credit">{isRtl ? 'آجل' : 'Credit'}</option>
              </select>
            </div>
          </div>

          {error && (
            <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-white">
            <table className={`w-full min-w-[1160px] table-fixed border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
              <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="w-12 border-b border-e border-slate-300 px-1 py-2 text-center">{isRtl ? 'رقم' : 'Sl'}</th>
                  <th className="w-36 border-b border-e border-slate-300 px-2 py-2">{isRtl ? 'الباركود' : 'Barcode'}</th>
                  <th className="w-64 border-b border-e border-slate-300 px-2 py-2">{isRtl ? 'اسم الصنف' : 'Item Name'}</th>
                  <th className="w-24 border-b border-e border-slate-300 px-2 py-2 text-right">{isRtl ? 'الكمية' : 'Qty'}</th>
                  <th className="w-24 border-b border-e border-slate-300 px-2 py-2">{isRtl ? 'الوحدة' : 'Unit'}</th>
                  <th className="w-28 border-b border-e border-slate-300 px-2 py-2 text-right">{isRtl ? 'السعر' : 'Rate'}</th>
                  <th className="w-28 border-b border-e border-slate-300 px-2 py-2 text-right">{isRtl ? 'الفرعي' : 'Subtotal'}</th>
                  <th className="w-16 border-b border-e border-slate-300 px-2 py-2 text-right">{isRtl ? 'ض%' : 'Tax%'}</th>
                  <th className="w-24 border-b border-e border-slate-300 px-2 py-2 text-right">{isRtl ? 'الضريبة' : 'Tax'}</th>
                  <th className="w-20 border-b border-e border-slate-300 px-2 py-2 text-right">{isRtl ? 'المخزون' : 'Stock'}</th>
                  <th className="w-28 border-b border-e border-slate-300 px-2 py-2 text-right">{isRtl ? 'الإجمالي' : 'Total'}</th>
                  <th className="w-12 border-b border-slate-300 px-1 py-2 text-center">{isRtl ? 'حذف' : 'Del'}</th>
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
                    ).slice(0, 15)
                    : products.slice(0, 15);
                  const barcodeMatch = getProductForBarcode(products, row.barcode);
                  const taxRate = product?.taxRate ?? settings.taxRate;

                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="border-b border-e border-slate-200 px-1 py-1 text-center font-mono text-[10px] text-slate-400">
                        {index + 1}
                      </td>
                      <td className="border-b border-e border-slate-200 p-0">
                        <input
                          ref={(el) => setCellRef(row.id, 'barcode', el)}
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
                              if (barcodeMatch) {
                                selectProduct(row, barcodeMatch.product, barcodeMatch.unitId);
                              } else {
                                focusCell(row.id, 'productSearch', false);
                              }
                            }
                          }}
                          aria-label={isRtl ? 'الباركود' : 'Barcode'}
                          className="w-full border-0 bg-transparent px-2 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                        />
                      </td>
                      <td className="border-b border-e border-slate-200 p-0">
                        <div className="relative">
                          <input
                            ref={(el) => setCellRef(row.id, 'productSearch', el)}
                            type="text"
                            value={row.productSearch}
                            onFocus={() => {
                              setProductSearchOpenRowId(row.id);
                              setActiveSuggestionIndex(0);
                            }}
                            onBlur={() => window.setTimeout(() => setProductSearchOpenRowId((cur) => (cur === row.id ? null : cur)), 120)}
                            onChange={(event) => {
                              updateRow(row.id, {
                                productId: null,
                                barcode: '',
                                productSearch: event.target.value,
                                unitId: '',
                                unitPrice: '',
                              });
                              setProductSearchOpenRowId(row.id);
                              setActiveSuggestionIndex(0);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowDown' && matchingProducts.length > 0) {
                                event.preventDefault();
                                setProductSearchOpenRowId(row.id);
                                setActiveSuggestionIndex((cur) => Math.min(cur + 1, matchingProducts.length - 1));
                              } else if (event.key === 'ArrowUp' && matchingProducts.length > 0) {
                                event.preventDefault();
                                setActiveSuggestionIndex((cur) => Math.max(0, cur - 1));
                              } else if (event.key === 'Enter' && matchingProducts.length > 0) {
                                event.preventDefault();
                                selectProduct(row, matchingProducts[Math.min(activeSuggestionIndex, matchingProducts.length - 1)]);
                              } else if (event.key === 'Escape') {
                                setProductSearchOpenRowId(null);
                              }
                            }}
                            placeholder={isRtl ? 'ابحث عن صنف...' : 'Search item...'}
                            aria-label={isRtl ? 'اسم الصنف' : 'Product name'}
                            className="w-full border-0 bg-transparent px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                          />
                          {productSearchOpenRowId === row.id && matchingProducts.length > 0 && (
                            <div className="absolute left-0 top-full z-20 max-h-72 w-[min(560px,90vw)] min-w-[440px] overflow-y-auto rounded-b-md border border-slate-200 bg-white shadow-xl">
                              {matchingProducts.map((entry, optionIdx) => {
                                const entryTax = entry.taxRate ?? settings.taxRate;
                                return (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => setActiveSuggestionIndex(optionIdx)}
                                    onClick={() => selectProduct(row, entry)}
                                    className={`flex w-full items-start justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 ${
                                      optionIdx === activeSuggestionIndex ? 'bg-blue-50' : 'hover:bg-slate-50'
                                    }`}
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span className="flex flex-wrap items-baseline gap-x-2">
                                        <span className="font-semibold text-slate-900">
                                          {isRtl ? entry.nameAr || entry.name : entry.name}
                                        </span>
                                        {((isRtl && entry.name) || (!isRtl && entry.nameAr)) && (
                                          <span className="text-[11px] text-slate-500" dir={isRtl ? 'ltr' : 'rtl'}>
                                            {isRtl ? entry.name : entry.nameAr}
                                          </span>
                                        )}
                                      </span>
                                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                                        {entry.sku && <span className="font-mono">SKU: {entry.sku}</span>}
                                        {entry.barcode && <span className="font-mono">· {entry.barcode}</span>}
                                        {entry.category && <span>· {entry.category}</span>}
                                        {entry.brand && <span>· {entry.brand}</span>}
                                        <span>· {entry.unit}</span>
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-right">
                                      <span className="block font-mono text-xs font-bold tabular-nums text-blue-800">
                                        {currency} {entry.retailPrice.toFixed(decimalPlaces)}
                                      </span>
                                      <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-slate-500">
                                        <span className={entry.stock <= 0 ? 'font-semibold text-red-600' : 'text-emerald-700'}>
                                          {isRtl ? 'مخزون' : 'Stock'}: {entry.stock}
                                        </span>
                                        {entry.costPrice > 0 && ` · ${isRtl ? 'تكلفة' : 'Cost'}: ${entry.costPrice.toFixed(decimalPlaces)}`}
                                        {` · ${isRtl ? 'ض' : 'Tax'} ${entryTax}%`}
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className={`border-b border-e border-slate-200 p-0 ${detail.exceedsStock ? 'bg-amber-50' : ''}`}>
                        <input
                          ref={(el) => setCellRef(row.id, 'quantity', el)}
                          type="number"
                          min={selectedUnit ? '1' : '0.001'}
                          step={selectedUnit ? '1' : 'any'}
                          value={row.quantity}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => updateRow(row.id, { quantity: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              focusCell(row.id, 'unitPrice');
                            }
                          }}
                          className="w-full border-0 bg-transparent px-2 py-2 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                        />
                      </td>
                      <td className="border-b border-e border-slate-200 p-0">
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
                          className="w-full border-0 bg-transparent px-1.5 py-2 text-xs disabled:text-slate-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                        >
                          {product && <option value="">{product.unit}</option>}
                          {product?.multiUnits?.map((unit) => (
                            <option key={unit.id} value={unit.id}>{unit.name}</option>
                          ))}
                          {!product && <option value="">—</option>}
                        </select>
                      </td>
                      <td className={`border-b border-e border-slate-200 p-0 ${detail.belowCost ? 'bg-red-50' : ''}`}>
                        <input
                          ref={(el) => setCellRef(row.id, 'unitPrice', el)}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.unitPrice}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              const nextRow = rows[index + 1];
                              if (nextRow) {
                                focusCell(nextRow.id, 'productSearch', false);
                              } else {
                                addRow('productSearch');
                              }
                            }
                          }}
                          title={detail.belowCost ? (isRtl ? 'أقل من سعر التكلفة' : 'Below cost price') : undefined}
                          className="w-full border-0 bg-transparent px-2 py-2 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                        />
                      </td>
                      <td className="border-b border-e border-slate-200 px-2 py-2 text-right font-mono tabular-nums text-slate-700">
                        {product ? detail.subtotal.toFixed(decimalPlaces) : '—'}
                      </td>
                      <td className="border-b border-e border-slate-200 px-2 py-2 text-right font-mono tabular-nums text-slate-600">
                        {product ? `${taxRate}%` : '—'}
                      </td>
                      <td className="border-b border-e border-slate-200 px-2 py-2 text-right font-mono tabular-nums text-slate-700">
                        {product ? detail.taxAmount.toFixed(decimalPlaces) : '—'}
                      </td>
                      <td className={`border-b border-e border-slate-200 px-2 py-2 text-right font-mono tabular-nums ${detail.exceedsStock ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>
                        {product ? detail.stockInUnit.toFixed(decimalPlaces) : '—'}
                      </td>
                      <td className="border-b border-e border-slate-200 px-2 py-2 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {product ? detail.total.toFixed(decimalPlaces) : '—'}
                      </td>
                      <td className="border-b border-slate-200 px-1 py-1 text-center">
                        <button
                          type="button"
                          disabled={rows.length === 1}
                          onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
                          aria-label={isRtl ? 'حذف الصنف' : 'Remove product'}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
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

          <footer className="sticky bottom-0 z-20 grid min-w-0 shrink-0 grid-cols-1 gap-x-6 gap-y-3 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_16px_-12px_rgba(15,23,42,0.25)] backdrop-blur lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.75fr)]">
            <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="erp-sale-discount" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {isRtl ? 'الخصم' : 'Discount'}
                </label>
                <div className="flex gap-1">
                  <input
                    id="erp-sale-discount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={discountValue}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setDiscountValue(event.target.value)}
                    className="w-full min-w-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                  <select
                    value={discountType}
                    onChange={(event) => setDiscountType(event.target.value as 'fixed' | 'percent')}
                    aria-label={isRtl ? 'نوع الخصم' : 'Discount type'}
                    className="w-16 shrink-0 rounded border border-slate-200 bg-white px-1.5 py-1.5 text-xs focus:border-blue-700 focus:outline-none"
                  >
                    <option value="fixed">{currency}</option>
                    <option value="percent">%</option>
                  </select>
                </div>
              </div>

              {paymentMethod === 'Cash' && (
                <div>
                  <label htmlFor="erp-sale-tendered" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    {isRtl ? 'المبلغ المستلم' : 'Amount Tendered'}
                  </label>
                  <input
                    id="erp-sale-tendered"
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashTendered}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setCashTendered(event.target.value)}
                    placeholder={totals.total.toFixed(decimalPlaces)}
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              )}

              <div className={paymentMethod === 'Cash' ? '' : 'sm:col-span-2'}>
                <label htmlFor="erp-sale-notes" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  {isRtl ? 'ملاحظات / مرجع' : 'Notes / Reference'}
                </label>
                <input
                  id="erp-sale-notes"
                  type="text"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={isRtl ? 'ملاحظات الفاتورة الاختيارية...' : 'Optional invoice notes...'}
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col justify-between gap-2 border-t border-slate-200 pt-2 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <table className="w-full border-collapse text-xs">
                <tbody>
                  <tr>
                    <th scope="row" className={`py-0.5 font-medium text-slate-500 ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'المجموع الفرعي:' : 'Subtotal:'}
                    </th>
                    <td className="py-0.5 text-right font-mono tabular-nums text-slate-800">
                      {currency} {totals.subtotal.toFixed(decimalPlaces)}
                    </td>
                  </tr>
                  {totals.discountAmount > 0 && (
                    <tr>
                      <th scope="row" className={`py-0.5 font-medium text-slate-500 ${isRtl ? 'text-right' : 'text-left'}`}>
                        {isRtl ? 'الخصم:' : 'Discount:'}
                      </th>
                      <td className="py-0.5 text-right font-mono tabular-nums text-amber-700">
                        −{currency} {totals.discountAmount.toFixed(decimalPlaces)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row" className={`py-0.5 font-medium text-slate-500 ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'الضريبة:' : 'Tax:'}
                    </th>
                    <td className="py-0.5 text-right font-mono tabular-nums text-slate-800">
                      {currency} {totals.tax.toFixed(decimalPlaces)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-200 text-sm font-bold text-slate-900">
                    <th scope="row" className={`py-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                      {isRtl ? 'الإجمالي الكلي:' : 'Grand Total:'}
                    </th>
                    <td className="py-1 text-right font-mono text-base tabular-nums text-blue-800">
                      {currency} {totals.total.toFixed(decimalPlaces)}
                    </td>
                  </tr>
                  {changeAmount > 0 && (
                    <tr>
                      <th scope="row" className={`py-0.5 text-[11px] font-medium text-emerald-700 ${isRtl ? 'text-right' : 'text-left'}`}>
                        {isRtl ? 'الباقي للعميل:' : 'Change:'}
                      </th>
                      <td className="py-0.5 text-right font-mono text-[11px] font-semibold tabular-nums text-emerald-700">
                        {currency} {changeAmount.toFixed(decimalPlaces)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <button
                type="submit"
                disabled={saving || products.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving
                  ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…')
                  : (isRtl ? 'حفظ الفاتورة (Alt+S)' : 'Save Invoice (Alt+S)')}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </section>
  );
};
