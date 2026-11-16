import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  GripVertical,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  X,
  Edit2,
  AlertTriangle
} from 'lucide-react';
import type {
  Product,
  PurchaseEntry,
  StoreSettings,
  Vendor
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

interface PurchasesViewProps {
  purchases: PurchaseEntry[];
  vendors: Vendor[];
  products: Product[];
  settings: StoreSettings;
  onRefreshPurchases: () => Promise<void>;
  onRefreshProducts: () => Promise<void>;
  onNavigateToVendors: () => void;
  onDeletePurchase?: (purchaseId: number) => Promise<void>;
  onEditPurchase?: (purchaseId: number, data: any) => Promise<void>;
}

interface NewPurchaseItemRow {
  rowId: number;
  productId: number;
  productSearch: string;
  selectedProductIndex: number;
  quantity: number;
  unitCost: number;
  taxRate: number;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  purchases,
  vendors,
  products,
  settings,
  onRefreshPurchases,
  onRefreshProducts,
  onNavigateToVendors,
  onDeletePurchase,
  onEditPurchase,
}) => {
  const { t, isRtl } = useLanguage();
  const c = isRtl ? 'ر.س ' : (settings.currencySymbol || 'SAR ');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PAID' | 'PENDING' | 'PARTIAL'>('ALL');
  const [isCreatingPurchasePage, setIsCreatingPurchasePage] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseEntry | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseEntry | null>(null);
  const [editInvoice, setEditInvoice] = useState('');
  const [editVendorId, setEditVendorId] = useState<number>(0);
  const [editReceivedDate, setEditReceivedDate] = useState('');
  const [editPaymentStatus, setEditPaymentStatus] = useState<'PAID' | 'PENDING' | 'PARTIAL'>('PAID');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [purchaseActionError, setPurchaseActionError] = useState<string | null>(null);

  const handleOpenEdit = (p: PurchaseEntry) => {
    setPurchaseActionError(null);
    setEditingPurchase(p);
    setEditInvoice(p.invoiceNumber);
    setEditVendorId(p.vendorId);
    setEditReceivedDate(p.receivedDate);
    setEditPaymentStatus(p.paymentStatus);
    setEditNotes(p.notes || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPurchase || !onEditPurchase) return;
    setIsSavingEdit(true);
    try {
      await onEditPurchase(editingPurchase.id, {
        invoiceNumber: editInvoice.trim(),
        vendorId: editVendorId,
        receivedDate: editReceivedDate,
        paymentStatus: editPaymentStatus,
        notes: editNotes.trim(),
      });
      await onRefreshPurchases();
      setEditingPurchase(null);
    } catch (error) {
      setPurchaseActionError((error as Error).message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingPurchaseId || !onDeletePurchase) return;
    setPurchaseActionError(null);
    setIsDeleting(true);
    try {
      await onDeletePurchase(deletingPurchaseId);
      await onRefreshPurchases();
      await onRefreshProducts();
      setDeletingPurchaseId(null);
    } catch (error) {
      setPurchaseActionError((error as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Form states
  const [vendorId, setVendorId] = useState<number>(vendors[0]?.id || 0);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shippingCost, setShippingCost] = useState('0.00');
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'PENDING' | 'PARTIAL'>('PAID');
  const [notes, setNotes] = useState('');
  const [updateCostPrices, setUpdateCostPrices] = useState(true);
  const [items, setItems] = useState<NewPurchaseItemRow[]>([]);
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [dropTargetRowId, setDropTargetRowId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nextPurchaseRowId = useRef(0);
  const quantityInputRefs = useRef(new Map<number, HTMLInputElement>());
  const unitInputRefs = useRef(new Map<number, HTMLInputElement>());
  const costInputRefs = useRef(new Map<number, HTMLInputElement>());
  const taxInputRefs = useRef(new Map<number, HTMLInputElement>());
  const totalInputRefs = useRef(new Map<number, HTMLInputElement>());
  const productSearchInputRefs = useRef(new Map<number, HTMLInputElement>());

  const stats = useMemo(() => {
    const totalPurchases = purchases.length;
    const totalAmount = purchases.reduce((sum, p) => sum + p.total, 0);
    const pendingAmount = purchases
      .filter((p) => p.paymentStatus !== 'PAID')
      .reduce((sum, p) => sum + p.total, 0);
    const unitsProcured = purchases.reduce(
      (sum, p) => sum + p.items.reduce((acc, it) => acc + it.quantity, 0),
      0
    );
    return { totalPurchases, totalAmount, pendingAmount, unitsProcured };
  }, [purchases]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter((p) => {
      if (statusFilter !== 'ALL' && p.paymentStatus !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          p.invoiceNumber.toLowerCase().includes(q) ||
          p.vendorName.toLowerCase().includes(q) ||
          (p.notes && p.notes.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [purchases, statusFilter, search]);

  const openNewPurchasePage = () => {
    const seq = 101 + purchases.length;
    setInvoiceNumber(`PO-${new Date().getFullYear()}-${seq}`);
    setVendorId(vendors[0]?.id || 0);
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setShippingCost('0.00');
    setPaymentStatus('PAID');
    setNotes('');
    setUpdateCostPrices(true);
    setItems([createEmptyPurchaseRow()]);
    setFormError(null);
    setIsCreatingPurchasePage(true);
  };

  const createEmptyPurchaseRow = (): NewPurchaseItemRow => ({
    rowId: ++nextPurchaseRowId.current,
    productId: 0,
    productSearch: '',
    selectedProductIndex: 0,
    quantity: 1,
    unitCost: 0,
    taxRate: settings.taxRate,
  });

  const addPurchaseRow = () => {
    const row = createEmptyPurchaseRow();
    setItems((prev) => [...prev, row]);
    window.requestAnimationFrame(() => productSearchInputRefs.current.get(row.rowId)?.focus());
  };

  const matchingProductsForRow = (row: NewPurchaseItemRow): Product[] => {
    const query = row.productSearch.trim().toLowerCase();
    if (!query) return [];
    return products
      .filter((product) =>
        product.name.toLowerCase().includes(query) ||
        (product.nameAr && product.nameAr.toLowerCase().includes(query)) ||
        product.sku.toLowerCase().includes(query) ||
        product.barcode.toLowerCase().includes(query)
      )
      .slice(0, 10);
  };

  const selectProductForRow = (rowIndex: number, product: Product) => {
    const row = items[rowIndex];
    if (!row) return;
    updateItemRow(rowIndex, {
      productId: product.id,
      productSearch: isRtl && product.nameAr ? product.nameAr : product.name,
      selectedProductIndex: 0,
      quantity: 1,
      unitCost: product.costPrice,
      taxRate: product.taxRate ?? settings.taxRate,
    });
    window.requestAnimationFrame(() => quantityInputRefs.current.get(row.rowId)?.focus());
  };

  const removeItemRow = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveItemRow = (sourceRowId: number, targetRowId: number, insertAfter: boolean) => {
    setItems((prev) => {
      const sourceIndex = prev.findIndex((item) => item.rowId === sourceRowId);
      const targetIndex = prev.findIndex((item) => item.rowId === targetRowId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return prev;

      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      let insertionIndex = targetIndex + (insertAfter ? 1 : 0);
      if (sourceIndex < insertionIndex) insertionIndex -= 1;
      next.splice(insertionIndex, 0, moved);
      return next;
    });
  };

  const updateItemRow = (idx: number, patch: Partial<NewPurchaseItemRow>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const updated = { ...it, ...patch };
        return updated;
      })
    );
  };

  const formSubtotal = useMemo(() => {
    return items.reduce((sum, it) => it.productId ? sum + it.quantity * it.unitCost : sum, 0);
  }, [items]);

  const formTaxAmount = useMemo(
    () => items.reduce(
      (sum, item) => item.productId
        ? sum + (item.quantity * item.unitCost * item.taxRate) / 100
        : sum,
      0
    ),
    [items]
  );

  const formTotal = useMemo(() => {
    const ship = Number(shippingCost) || 0;
    return formSubtotal + formTaxAmount + ship;
  }, [formSubtotal, formTaxAmount, shippingCost]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!invoiceNumber.trim()) {
      setFormError(isRtl ? 'رقم الفاتورة مطلوب.' : 'PO / Invoice Number is required.');
      return;
    }
    if (!vendorId) {
      setFormError(isRtl ? 'الرجاء اختيار المورد.' : 'Please select a vendor supplier.');
      return;
    }
    if (items.length === 0) {
      setFormError(isRtl ? 'الرجاء إضافة صنف واحد على الأقل.' : 'Please add at least one line item to this purchase.');
      return;
    }
    if (items.some((item) => !item.productId)) {
      setFormError(isRtl ? 'الرجاء اختيار صنف أو حذف السطر الفارغ.' : 'Select a product or remove each empty line.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceNumber: invoiceNumber.trim(),
          vendorId,
          receivedDate,
          taxAmount: Number(formTaxAmount.toFixed(2)),
          shippingCost: Number(shippingCost) || 0,
          paymentStatus,
          notes: notes.trim(),
          updateCostPrices,
          items: items.map((it) => ({
            productId: it.productId,
            quantity: Math.max(1, it.quantity),
            unitCost: Math.max(0, it.unitCost),
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (isRtl ? 'فشل تسجيل الشراء.' : 'Failed to record purchase entry.'));
      }

      await Promise.all([onRefreshPurchases(), onRefreshProducts()]);
      setIsCreatingPurchasePage(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Invoice #',
      'Vendor',
      'Received Date',
      'Items Count',
      'Subtotal',
      'Tax',
      'Shipping',
      'Total',
      'Payment Status',
    ];
    const rows = filteredPurchases.map((p) => [
      `"${p.invoiceNumber}"`,
      `"${p.vendorName.replace(/"/g, '""')}"`,
      p.receivedDate,
      p.items.length,
      p.subtotal.toFixed(2),
      p.taxAmount.toFixed(2),
      p.shippingCost.toFixed(2),
      p.total.toFixed(2),
      p.paymentStatus,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `purchase-entries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6 bg-slate-50">
      {!isCreatingPurchasePage && (
        <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'إجمالي أوامر الشراء' : 'Total Purchase Orders'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {stats.totalPurchases}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'إجمالي المشتريات' : 'Gross Procurement'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums truncate">
            {c}
            {stats.totalAmount.toFixed(2)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'الوحدات المستلمة' : 'Units Procured'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            +{stats.unitsProcured}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'مستحقات معلقة' : 'Pending Payables'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-amber-700 tabular-nums truncate">
            {c}
            {stats.pendingAmount.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-3 sm:p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className={`w-4 h-4 text-slate-400 absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 pointer-events-none`} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isRtl ? 'بحث برقم الفاتورة أو المورد...' : 'Search invoice # or vendor...'}
                className={`w-full ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-blue-700`}
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {(['ALL', 'PAID', 'PENDING', 'PARTIAL'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    statusFilter === status
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {status === 'ALL'
                    ? (isRtl ? 'الكل' : 'All Purchases')
                    : status === 'PAID'
                    ? (isRtl ? 'مدفوع' : 'Settled (Paid)')
                    : status === 'PARTIAL'
                    ? (isRtl ? 'مدفوع جزئياً' : 'Partially Paid')
                    : (isRtl ? 'معلق' : 'Pending')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isRtl ? 'تصدير CSV' : 'Export CSV'}</span>
            </button>
            <button
              type="button"
              onClick={openNewPurchasePage}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>{isRtl ? 'استلام بضاعة' : 'New Purchase'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Purchases Cards View (< md) */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredPurchases.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              {isRtl ? 'لا توجد أوامر شراء. اضغط "استلام بضاعة" لإضافة.' : 'No purchase orders recorded yet. Click "New Purchase" to receive stock.'}
            </div>
          ) : (
            filteredPurchases.map((p) => {
              const totalUnits = p.items.reduce((sum, it) => sum + it.quantity, 0);

              return (
                <div key={p.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-mono">{p.invoiceNumber}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{p.vendorName}</span>
                      </div>
                    </div>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 ${
                        p.paymentStatus === 'PAID'
                          ? 'bg-emerald-50 text-emerald-700'
                          : p.paymentStatus === 'PARTIAL'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {p.paymentStatus === 'PAID'
                        ? (isRtl ? 'مدفوع' : 'Paid')
                        : p.paymentStatus === 'PARTIAL'
                        ? (isRtl ? 'جزئي' : 'Partial')
                        : (isRtl ? 'معلق' : 'Pending')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                    <div className="text-[11px] text-slate-500 font-mono">
                      {p.receivedDate} · {p.items.length} {isRtl ? 'سطر' : 'lines'} ({totalUnits} {isRtl ? 'قطعة' : 'pcs'})
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-slate-900 text-xs">
                        {c}{p.total.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedPurchase(p)}
                        className="p-1 text-slate-600 hover:text-blue-700 border border-slate-200 rounded"
                        title={isRtl ? 'عرض التفاصيل' : 'View details'}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Table View (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className={`w-full border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4">{isRtl ? 'رقم الفاتورة' : 'Invoice / PO #'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'المورد' : 'Vendor Supplier'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'تاريخ الاستلام' : 'Received Date'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الأصناف والوحدات' : 'Items & Units'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'إجمالي الفاتورة' : 'Invoice Total'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'الدفع' : 'Payment'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    {isRtl ? 'لا توجد أوامر شراء. اضغط "استلام بضاعة" لإضافة.' : 'No purchase orders recorded yet. Click "New Purchase Entry" to receive stock.'}
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((p) => {
                  const totalUnits = p.items.reduce((sum, it) => sum + it.quantity, 0);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{p.invoiceNumber}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{p.vendorName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{p.receivedDate}</span>
                        </div>
                      </td>
                      <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} font-mono text-slate-700 whitespace-nowrap tabular-nums`}>
                        {p.items.length} {p.items.length === 1 ? (isRtl ? 'سطر' : 'line') : (isRtl ? 'سطور' : 'lines')} ({totalUnits} {isRtl ? 'قطعة' : 'pcs'})
                      </td>
                      <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} font-mono font-semibold text-slate-900 whitespace-nowrap tabular-nums`}>
                        {c}
                        {p.total.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`font-medium ${
                            p.paymentStatus === 'PAID'
                              ? 'text-emerald-700'
                              : p.paymentStatus === 'PARTIAL'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          {p.paymentStatus === 'PAID'
                            ? (isRtl ? 'مدفوع بالكامل' : 'Paid in Full')
                            : p.paymentStatus === 'PARTIAL'
                            ? (isRtl ? 'مدفوع جزئياً' : 'Partially Paid')
                            : (isRtl ? 'معلق' : 'Pending')}
                        </span>
                      </td>
                      <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} whitespace-nowrap`}>
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedPurchase(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-blue-700 hover:text-blue-700 rounded-lg transition-colors"
                            title={isRtl ? 'عرض تفاصيل الشراء' : 'View purchase details'}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{isRtl ? 'عرض' : 'View'}</span>
                          </button>
                          {onEditPurchase && (
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(p)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-amber-600 hover:text-amber-700 rounded-lg transition-colors"
                              title={isRtl ? 'تعديل الفاتورة' : 'Edit purchase invoice'}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{isRtl ? 'تعديل' : 'Edit'}</span>
                            </button>
                          )}
                          {onDeletePurchase && (
                            <button
                              type="button"
                              onClick={() => {
                                setPurchaseActionError(null);
                                setDeletingPurchaseId(p.id);
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 border border-slate-200 rounded-lg transition-colors"
                              title={isRtl ? 'حذف أمر الشراء' : 'Delete purchase entry and adjust inventory'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {isCreatingPurchasePage && (
        <section className="w-full max-w-5xl mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 id="purchase-modal-title" className="text-base font-semibold text-slate-900">
                  {isRtl ? 'استلام بضاعة جديدة' : 'New Purchase Entry (Receive Stock)'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isRtl ? 'استلام الأصناف يزيد تلقائياً من كميات المخزون.' : 'Receiving items automatically increments current inventory stock in SQLite.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreatingPurchasePage(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {isRtl ? 'العودة للمشتريات' : 'Back to Purchases'}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5 text-xs">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Vendor & Invoice Meta */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-slate-700">{isRtl ? 'المورد *' : 'Vendor Supplier *'}</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingPurchasePage(false);
                        onNavigateToVendors();
                      }}
                      className="text-[11px] text-blue-700 hover:underline"
                    >
                      {isRtl ? '+ إضافة مورد' : '+ Add New Vendor'}
                    </button>
                  </div>
                  <select
                    value={vendorId}
                    onChange={(e) => setVendorId(Number(e.target.value))}
                    required
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 bg-white focus:outline-none focus:border-blue-700"
                  >
                    {vendors.length === 0 ? (
                      <option value={0}>{isRtl ? 'لا يوجد موردون' : 'No vendors registered'}</option>
                    ) : (
                      vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'رقم الفاتورة / أمر الشراء *' : 'Invoice / PO Number *'}</label>
                  <input
                    type="text"
                    required
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="e.g., INV-9921"
                    className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'تاريخ الاستلام' : 'Date Received'}</label>
                  <input
                    type="date"
                    required
                    value={receivedDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              {/* Line Items Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 text-xs">
                    {isRtl ? 'أصناف الشراء' : 'Purchase Items'}
                  </span>
                  <button
                    type="button"
                    onClick={addPurchaseRow}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{isRtl ? 'إضافة سطر' : 'Add Line'}</span>
                  </button>
                </div>

                <div className="overflow-x-auto border-y border-slate-200">
                  <table className={`w-full min-w-[880px] border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
                    <thead className="bg-slate-50 text-[10px] font-semibold text-slate-600">
                      <tr>
                        <th className="w-8" aria-label={isRtl ? 'ترتيب' : 'Reorder'} />
                        <th className="px-2 py-2">{isRtl ? 'بحث عن الصنف / الباركود' : 'Product / Barcode'}</th>
                        <th className="px-2 py-2 w-24">{isRtl ? 'الكمية' : 'Quantity'}</th>
                        <th className="px-2 py-2 w-20">{isRtl ? 'الوحدة' : 'Unit'}</th>
                        <th className="px-2 py-2 w-32">{isRtl ? `التكلفة (${c})` : `Unit Cost (${c})`}</th>
                        <th className="px-2 py-2 w-24">{isRtl ? 'الضريبة %' : 'Tax %'}</th>
                        <th className="px-2 py-2 w-32 text-right">{isRtl ? `الإجمالي (${c})` : `Total (${c})`}</th>
                        <th className="w-9" />
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      {items.map((item, index) => {
                        const product = products.find((candidate) => candidate.id === item.productId);
                        const matchingProducts = matchingProductsForRow(item);
                        const query = item.productSearch.trim().toLowerCase();
                        const exactScanMatch = products.find(
                          (candidate) => candidate.barcode && candidate.barcode.toLowerCase() === query
                        );
                        return (
                          <tr
                            key={item.rowId}
                            onDragOver={(event) => {
                              if (draggedRowId === null || draggedRowId === item.rowId) return;
                              event.preventDefault();
                              setDropTargetRowId(item.rowId);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const sourceId = draggedRowId ?? Number(event.dataTransfer.getData('text/plain'));
                              if (sourceId) {
                                const bounds = event.currentTarget.getBoundingClientRect();
                                moveItemRow(sourceId, item.rowId, event.clientY > bounds.top + bounds.height / 2);
                              }
                              setDraggedRowId(null);
                              setDropTargetRowId(null);
                            }}
                            className={`border-t border-slate-200 hover:bg-slate-50/60 ${
                              dropTargetRowId === item.rowId ? 'border-t-2 border-t-blue-600 bg-blue-50/70' : ''
                            } ${draggedRowId === item.rowId ? 'opacity-40' : ''}`}
                          >
                            <td className="px-1 py-1.5 text-center">
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', String(item.rowId));
                                  setDraggedRowId(item.rowId);
                                }}
                                onDragEnd={() => {
                                  setDraggedRowId(null);
                                  setDropTargetRowId(null);
                                }}
                                className="inline-flex cursor-grab touch-none text-slate-400 hover:text-slate-700 active:cursor-grabbing"
                                aria-label={isRtl ? `نقل ${product?.name || ''}` : `Drag to reorder ${product?.name || ''}`}
                                title={isRtl ? 'اسحب لإعادة الترتيب' : 'Drag to reorder'}
                              >
                                <GripVertical className="h-4 w-4" />
                              </button>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="relative">
                                <input
                                  ref={(element) => {
                                    if (element) productSearchInputRefs.current.set(item.rowId, element);
                                    else productSearchInputRefs.current.delete(item.rowId);
                                  }}
                                  type="text"
                                  value={item.productSearch}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) =>
                                    updateItemRow(index, {
                                      productId: 0,
                                      productSearch: event.target.value,
                                      selectedProductIndex: 0,
                                    })
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === 'ArrowDown' && matchingProducts.length > 0) {
                                      event.preventDefault();
                                      updateItemRow(index, {
                                        selectedProductIndex: (item.selectedProductIndex + 1) % matchingProducts.length,
                                      });
                                    } else if (event.key === 'ArrowUp' && matchingProducts.length > 0) {
                                      event.preventDefault();
                                      updateItemRow(index, {
                                        selectedProductIndex: (item.selectedProductIndex - 1 + matchingProducts.length) % matchingProducts.length,
                                      });
                                    } else if (event.key === 'Enter') {
                                      event.preventDefault();
                                      const selectedProduct =
                                        exactScanMatch ||
                                        products.find((candidate) => candidate.sku && candidate.sku.toLowerCase() === query) ||
                                        matchingProducts[item.selectedProductIndex];
                                      if (selectedProduct) selectProductForRow(index, selectedProduct);
                                    }
                                  }}
                                  aria-label={isRtl ? 'ابحث عن صنف أو امسح الباركود' : 'Search product or scan barcode'}
                                  placeholder={isRtl ? 'الاسم، الرمز، أو الباركود...' : 'Name, SKU, or barcode...'}
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:border-blue-700"
                                />
                                {!item.productId && item.productSearch && (
                                  <div className="absolute left-0 right-0 top-full z-30 max-h-56 overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
                                    {matchingProducts.length === 0 ? (
                                      <div className="p-2 text-center text-[10px] text-slate-500">
                                        {isRtl ? 'لا توجد أصناف مطابقة' : 'No matching products'}
                                      </div>
                                    ) : matchingProducts.map((match, matchIndex) => (
                                      <button
                                        key={match.id}
                                        type="button"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onMouseEnter={() =>
                                          updateItemRow(index, { selectedProductIndex: matchIndex })
                                        }
                                        onClick={() => selectProductForRow(index, match)}
                                        className={`w-full px-2 py-1.5 text-left border-b border-slate-100 last:border-0 ${
                                          item.selectedProductIndex === matchIndex
                                            ? 'bg-blue-100'
                                            : 'hover:bg-blue-50'
                                        }`}
                                      >
                                        <span className="block truncate font-medium">
                                          {isRtl && match.nameAr ? match.nameAr : match.name}
                                        </span>
                                        <span className="block truncate font-mono text-[10px] text-slate-500">
                                          {match.sku}{match.barcode ? ` · ${match.barcode}` : ''}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                ref={(element) => {
                                  if (element) quantityInputRefs.current.set(item.rowId, element);
                                  else quantityInputRefs.current.delete(item.rowId);
                                }}
                                type="number"
                                min={1}
                                required
                                value={item.quantity}
                                onFocus={(e) => e.currentTarget.select()}
                                onClick={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    unitInputRefs.current.get(item.rowId)?.focus();
                                  }
                                }}
                                onChange={(e) => updateItemRow(index, { quantity: parseInt(e.target.value, 10) || 1 })}
                                className="w-full px-2 py-1.5 font-mono border border-slate-200 rounded text-right tabular-nums"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                ref={(element) => {
                                  if (element) unitInputRefs.current.set(item.rowId, element);
                                  else unitInputRefs.current.delete(item.rowId);
                                }}
                                type="text"
                                readOnly
                                tabIndex={0}
                                value={product?.unit || ''}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    costInputRefs.current.get(item.rowId)?.focus();
                                  }
                                }}
                                aria-label={isRtl ? 'وحدة المنتج' : 'Product unit'}
                                className="w-full px-2 py-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                ref={(element) => {
                                  if (element) costInputRefs.current.set(item.rowId, element);
                                  else costInputRefs.current.delete(item.rowId);
                                }}
                                type="number"
                                min={0}
                                step="0.01"
                                required
                                value={item.unitCost}
                                onFocus={(e) => e.currentTarget.select()}
                                onClick={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    taxInputRefs.current.get(item.rowId)?.focus();
                                  }
                                }}
                                onChange={(e) => updateItemRow(index, { unitCost: parseFloat(e.target.value) || 0 })}
                                className="w-full px-2 py-1.5 font-mono border border-slate-200 rounded text-right tabular-nums"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                ref={(element) => {
                                  if (element) taxInputRefs.current.set(item.rowId, element);
                                  else taxInputRefs.current.delete(item.rowId);
                                }}
                                type="number"
                                min={0}
                                step="0.01"
                                value={item.taxRate}
                                onFocus={(e) => e.currentTarget.select()}
                                onClick={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    totalInputRefs.current.get(item.rowId)?.focus();
                                  }
                                }}
                                onChange={(e) => updateItemRow(index, { taxRate: Number(e.target.value) || 0 })}
                                aria-label={isRtl ? 'معدل الضريبة' : 'Tax rate'}
                                className="w-full px-2 py-1.5 font-mono border border-slate-200 rounded text-right tabular-nums"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                ref={(element) => {
                                  if (element) totalInputRefs.current.set(item.rowId, element);
                                  else totalInputRefs.current.delete(item.rowId);
                                }}
                                type="text"
                                readOnly
                                value={`${c}${(item.quantity * item.unitCost * (1 + item.taxRate / 100)).toFixed(2)}`}
                                onFocus={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addPurchaseRow();
                                  }
                                }}
                                aria-label={isRtl ? 'إجمالي الصنف مع الضريبة' : 'Line total including tax'}
                                className="w-full bg-transparent text-right font-mono font-semibold text-slate-900 tabular-nums focus:outline-none"
                              />
                            </td>
                            <td className="px-1 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => removeItemRow(index)}
                                className="p-1 text-slate-400 hover:text-red-600 rounded"
                                title={isRtl ? 'حذف السطر' : 'Remove line'}
                                aria-label={isRtl ? 'حذف السطر' : 'Remove line'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cost sync & Additional charges */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-start">
                <div className="space-y-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'حالة الدفع' : 'Payment Status'}</label>
                    <select
                      value={paymentStatus}
                      onChange={(e) =>
                        setPaymentStatus(e.target.value as 'PAID' | 'PENDING' | 'PARTIAL')
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 bg-white"
                    >
                      <option value="PAID">{isRtl ? 'مدفوع بالكامل' : 'Paid in Full'}</option>
                      <option value="PENDING">{isRtl ? 'معلق (ذمم دائنة)' : 'Pending (Accounts Payable)'}</option>
                      <option value="PARTIAL">{isRtl ? 'مدفوع جزئياً' : 'Partially Paid'}</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={updateCostPrices}
                      onChange={(e) => setUpdateCostPrices(e.target.checked)}
                      className="rounded text-blue-700 focus:ring-blue-700"
                    />
                    <span className="text-slate-700 text-xs">
                      {isRtl ? 'تحديث سعر التكلفة الافتراضي للأصناف' : 'Update product default cost price with these rates'}
                    </span>
                  </label>
                </div>

                <div className="sm:col-span-2 space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">{isRtl ? 'المجموع الفرعي:' : 'Subtotal:'}</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {c}
                      {formSubtotal.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-slate-600">{isRtl ? 'ضريبة الأصناف:' : 'Product Tax:'}</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-slate-500">{c}</span>
                      <span className="w-24 text-right font-mono tabular-nums text-slate-700">
                        {formTaxAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-slate-600">{isRtl ? 'الشحن والمناولة:' : 'Shipping & Handling:'}</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-slate-500">{c}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={shippingCost}
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => event.currentTarget.select()}
                        onChange={(e) => setShippingCost(e.target.value)}
                        className="w-24 px-2 py-1 font-mono text-right border border-slate-200 rounded bg-white tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm font-bold text-slate-900">
                    <span>{isRtl ? 'الإجمالي الكلي:' : 'Grand Total:'}</span>
                    <span className="font-mono tabular-nums text-sm font-bold text-slate-900">
                      {c}{formTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'ملاحظات / مذكرة استلام' : 'Notes / Receiving Memo'}</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={isRtl ? 'مثال: تم الاستلام بواسطة المدير، تم الفحص' : 'e.g., Received via Freight Logistics pallet 3, inspected by admin'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingPurchasePage(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 rounded-lg"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{saving ? (isRtl ? 'جاري التسجيل...' : 'Recording Stock...') : (isRtl ? 'تأكيد وإضافة للمخزون' : 'Confirm & Increment Stock')}</span>
                </button>
              </div>
            </form>
        </section>
      )}

      {/* View Detail Modal */}
      {selectedPurchase && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 id="detail-modal-title" className="text-base font-semibold text-slate-900">
                  {isRtl ? `فاتورة شراء ${selectedPurchase.invoiceNumber}` : `Purchase Invoice ${selectedPurchase.invoiceNumber}`}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isRtl
                    ? `المورد: ${selectedPurchase.vendorName} · تاريخ الاستلام: ${selectedPurchase.receivedDate}`
                    : `Vendor: ${selectedPurchase.vendorName} · Received ${selectedPurchase.receivedDate}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPurchase(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600">
                    <tr>
                      <th className="p-2.5">{isRtl ? 'الصنف' : 'Item'}</th>
                      <th className={`p-2.5 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الكمية' : 'Qty'}</th>
                      <th className={`p-2.5 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'التكلفة' : 'Cost'}</th>
                      <th className={`p-2.5 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الإجمالي' : 'Total'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedPurchase.items.map((it) => (
                      <tr key={it.id}>
                        <td className="p-2.5 font-medium text-slate-900">
                          {it.productName}
                          <span className="block text-[10px] text-slate-400 font-mono">
                            {it.sku}
                          </span>
                        </td>
                        <td className={`p-2.5 ${isRtl ? 'text-left' : 'text-right'} font-mono tabular-nums`}>
                          {it.quantity}
                        </td>
                        <td className={`p-2.5 ${isRtl ? 'text-left' : 'text-right'} font-mono tabular-nums`}>
                          {c}
                          {it.unitCost.toFixed(2)}
                        </td>
                        <td className={`p-2.5 ${isRtl ? 'text-left' : 'text-right'} font-mono font-semibold tabular-nums`}>
                          {c}
                          {it.lineTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={`space-y-1 ${isRtl ? 'text-left' : 'text-right'} text-xs pt-1`}>
                <div className="text-slate-600">
                  {isRtl ? 'المجموع الفرعي:' : 'Subtotal:'} <span className="font-mono font-semibold">{c}{selectedPurchase.subtotal.toFixed(2)}</span>
                </div>
                {selectedPurchase.taxAmount > 0 && (
                  <div className="text-slate-600">
                    {isRtl ? 'الضريبة / الرسوم:' : 'Tax / Duties:'} <span className="font-mono">{c}{selectedPurchase.taxAmount.toFixed(2)}</span>
                  </div>
                )}
                {selectedPurchase.shippingCost > 0 && (
                  <div className="text-slate-600">
                    {isRtl ? 'الشحن:' : 'Shipping:'} <span className="font-mono">{c}{selectedPurchase.shippingCost.toFixed(2)}</span>
                  </div>
                )}
                <div className="text-sm font-bold text-slate-900 pt-1 border-t border-slate-100">
                  {isRtl ? 'الإجمالي الكلي:' : 'Grand Total:'} <span className="font-mono">{c}{selectedPurchase.total.toFixed(2)}</span>
                </div>
              </div>

              {selectedPurchase.notes && (
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200 text-slate-700">
                  <span className="font-medium">{isRtl ? 'ملاحظة: ' : 'Memo: '}</span>
                  {selectedPurchase.notes}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedPurchase(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                {isRtl ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Purchase Entry Modal */}
      {editingPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isRtl ? 'تعديل أمر الشراء' : 'Edit Purchase Order'}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {editingPurchase.invoiceNumber} · {c}{editingPurchase.total.toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingPurchase(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              {purchaseActionError && (
                <div role="alert" className="p-2.5 rounded-lg border border-red-200 bg-red-50 text-red-800">
                  {purchaseActionError}
                </div>
              )}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{isRtl ? 'رقم الفاتورة *' : 'Invoice / PO Number *'}</label>
                <input
                  type="text"
                  required
                  value={editInvoice}
                  onChange={(e) => setEditInvoice(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{isRtl ? 'المورد *' : 'Vendor *'}</label>
                <select
                  value={editVendorId}
                  onChange={(e) => setEditVendorId(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700 bg-white"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{isRtl ? 'تاريخ الاستلام' : 'Received Date'}</label>
                  <input
                    type="date"
                    required
                    value={editReceivedDate}
                    onChange={(e) => setEditReceivedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{isRtl ? 'حالة الدفع' : 'Payment Status'}</label>
                  <select
                    value={editPaymentStatus}
                    onChange={(e) => setEditPaymentStatus(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700 bg-white"
                  >
                    <option value="PAID">{isRtl ? 'مدفوع بالكامل' : 'Paid in Full'}</option>
                    <option value="PENDING">{isRtl ? 'معلق' : 'Pending Payment'}</option>
                    <option value="PARTIAL">{isRtl ? 'مدفوع جزئياً' : 'Partial'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{isRtl ? 'ملاحظات / مذكرة استلام' : 'Notes / Receiving Memo'}</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  placeholder={isRtl ? 'معلومات الشحن، الحالة...' : 'Carrier tracking, bill of lading, condition...'}
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingPurchase(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {isSavingEdit ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : (isRtl ? 'حفظ التغييرات' : 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Purchase Confirmation Modal */}
      {deletingPurchaseId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{isRtl ? 'حذف أمر الشراء' : 'Delete Purchase Entry'}</h3>
                <p className="text-xs text-slate-500">{isRtl ? 'سيتم التراجع عن عملية الاستلام' : 'Roll back purchase receiving'}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-red-50 p-3 rounded-lg border border-red-100">
              {isRtl
                ? 'هل أنت متأكد من حذف هذا الأمر؟ سيتم خصم كميات جميع الأصناف المستلمة في هذا الأمر من المخزون الحالي تلقائياً.'
                : 'Are you sure you want to permanently delete this purchase order? All items received on this purchase will be automatically deducted from your current product inventory stock.'}
            </p>

            {purchaseActionError && (
              <div role="alert" className="p-2.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
                {purchaseActionError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingPurchaseId(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? (isRtl ? 'جاري الحذف...' : 'Deleting...') : (isRtl ? 'حذف وتراجع المخزون' : 'Delete & Roll Back Stock')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
