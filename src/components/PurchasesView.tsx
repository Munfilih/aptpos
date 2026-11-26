import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  PackagePlus,
  Search,
  Trash2,
  X,
  Edit2,
  AlertTriangle,
  Printer,
  Save
} from 'lucide-react';
import type {
  PaperWidth,
  Product,
  PurchaseEntry,
  PurchaseReturnVoucher,
  Sale,
  SalesReturnVoucher,
  StoreSettings,
  Vendor
} from '../types/pos';
import { createPrintTemplateJob, createVoucherTemplateJob, printTemplateJob } from '../printTemplates/render';
import { getPrintDocumentFormat } from '../printTemplates/catalog';
import type { PrintDocumentData, PrintTemplateJob } from '../printTemplates/types';
import { useLanguage } from '../i18n/LanguageContext';
import { resolveDateBounds, toLocalDateKey, type DateFilter } from '../utils/dateFilters';
import { VendorsView } from './VendorsView';

interface PurchasesViewProps {
  isActive: boolean;
  page: 'entry' | 'history';
  mode?: 'purchase' | 'purchase-return';
  focusBarcodeRequest: number;
  onNavigatePage: (page: 'entry' | 'history') => void;
  onSelectedVendorChange?: (vendor: {
    name: string;
    taxNumber: string;
    pendingBalance: number;
    currencySymbol: string;
    partialCount: number;
  } | null) => void;
  purchases: PurchaseEntry[];
  purchaseReturnVouchers: PurchaseReturnVoucher[];
  sales: Sale[];
  salesReturnVouchers: SalesReturnVoucher[];
  vendors: Vendor[];
  products: Product[];
  settings: StoreSettings;
  onRefreshPurchases: () => Promise<void>;
  onRefreshProducts: () => Promise<void>;
  onRefreshVendors: () => Promise<void>;
  onDeletePurchase?: (purchaseId: number) => Promise<void>;
  onEditPurchase?: (purchaseId: number, data: any) => Promise<void>;
  onCreatePurchaseReturn?: (input: {
    purchaseId: number;
    items: Array<{ purchaseItemId: number; quantity: number }>;
    notes?: string;
  }) => Promise<unknown>;
  onEditProduct?: (product: Product) => void;
  onAddProduct?: (barcode: string) => void;
}

interface NewPurchaseItemRow {
  rowId: number;
  productId: number;
  unitId: string;
  barcodeSearch: string;
  productSearch: string;
  selectedProductIndex: number;
  quantity: number | '';
  unitCost: number | '';
  taxRate: number | '';
}

type PurchaseColumn =
  | 'barcode'
  | 'name'
  | 'quantity'
  | 'unit'
  | 'rate'
  | 'subtotal'
  | 'taxRate'
  | 'tax'
  | 'lastPurchaseCost'
  | 'sellingPrice'
  | 'stock'
  | 'total'
  | 'delete';

const DEFAULT_PURCHASE_COLUMN_ORDER: PurchaseColumn[] = [
  'barcode',
  'name',
  'quantity',
  'unit',
  'rate',
  'subtotal',
  'taxRate',
  'tax',
  'lastPurchaseCost',
  'sellingPrice',
  'stock',
  'total',
  'delete',
];

const DEFAULT_PURCHASE_COLUMN_WIDTHS: Record<PurchaseColumn, number> = {
  barcode: 150,
  name: 280,
  quantity: 82,
  unit: 82,
  rate: 110,
  subtotal: 110,
  taxRate: 72,
  tax: 100,
  lastPurchaseCost: 140,
  sellingPrice: 120,
  stock: 76,
  total: 130,
  delete: 64,
};

const PURCHASE_COLUMN_ORDER_STORAGE_KEY = 'aptpos_purchase_column_order';
const PURCHASE_COLUMN_WIDTHS_STORAGE_KEY = 'aptpos_purchase_column_widths';

const MAX_PURCHASE_ROWS = 200;

const formatPurchaseVoucherNumber = (id: number) => `PV-${String(id).padStart(6, '0')}`;
const purchasePartyKey = (vendorId: number) => `vendor:${vendorId}`;
const getPurchaseBalance = (
  purchase: PurchaseEntry,
  returnVouchers: PurchaseReturnVoucher[]
) => Math.max(
  0,
  purchase.total -
    purchase.paidAmount -
    returnVouchers
      .filter((voucher) => voucher.purchaseId === purchase.id)
      .reduce((sum, voucher) => sum + voucher.total, 0)
);
const salesPartyKey = (sale?: Sale) =>
  `customer:${sale?.customerId ?? (sale?.customerName || 'walk-in')}`;

const loadPurchaseColumnWidths = (): Record<PurchaseColumn, number> => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PURCHASE_COLUMN_WIDTHS_STORAGE_KEY) || 'null');
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
      return DEFAULT_PURCHASE_COLUMN_WIDTHS;
    }

    const savedWidths = saved as Record<string, unknown>;
    const widths = { ...DEFAULT_PURCHASE_COLUMN_WIDTHS };
    for (const column of DEFAULT_PURCHASE_COLUMN_ORDER) {
      const width = savedWidths[column];
      if (typeof width === 'number' && Number.isFinite(width) && width >= 0) {
        widths[column] = width;
      }
    }
    return widths;
  } catch {
    return DEFAULT_PURCHASE_COLUMN_WIDTHS;
  }
};

const findProductBarcodeMatch = (
  products: Product[],
  barcode: string
): { product: Product; unitId: string } | undefined => {
  const normalizedBarcode = barcode.trim().toLocaleLowerCase();
  if (!normalizedBarcode) return undefined;

  for (const product of products) {
    if (product.barcode.trim().toLocaleLowerCase() === normalizedBarcode) {
      return { product, unitId: '' };
    }
    const multiUnit = product.multiUnits?.find(
      (unit) => unit.barcode.trim().toLocaleLowerCase() === normalizedBarcode
    );
    if (multiUnit) return { product, unitId: multiUnit.id };

    const additionalBarcode = product.additionalBarcodes?.find(
      (entry) => entry.barcode.trim().toLocaleLowerCase() === normalizedBarcode
    );
    if (additionalBarcode) {
      return { product, unitId: additionalBarcode.unitId || '' };
    }
  }
  return undefined;
};

const tokenizeProductSearch = (value: string): string[] =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];

const getPurchaseUnit = (product: Product | undefined, unitId: string) => {
  const selectedUnit = product?.multiUnits?.find((unit) => unit.id === unitId);
  const unitsPerBase = selectedUnit ? Math.max(1, selectedUnit.unitsPerBase) : 1;
  return {
    name: selectedUnit?.name || product?.unit || '',
    unitsPerBase,
    sellingPrice: selectedUnit?.price ?? (product ? product.retailPrice * unitsPerBase : undefined),
  };
};

const getPurchaseUnitCost = (product: Product | undefined, unitId: string) =>
  product ? product.costPrice * getPurchaseUnit(product, unitId).unitsPerBase : undefined;

const createPurchaseRows = (): NewPurchaseItemRow[] =>
  Array.from({ length: MAX_PURCHASE_ROWS }, (_, index) => ({
    rowId: index + 1,
    productId: 0,
    unitId: '',
    barcodeSearch: '',
    productSearch: '',
    selectedProductIndex: 0,
    quantity: '',
    unitCost: '',
    taxRate: '',
  }));

interface PurchasePrintEntry {
  voucherId?: number;
  invoiceNumber: string;
  vendorName: string;
  receivedDate: string;
  paymentStatus: 'PAID' | 'PENDING' | 'PARTIAL';
  paidAmount: number;
  notes: string;
  items: Array<{
    name: string;
    sku: string;
    quantity: number;
    unit: string;
    unitCost: number;
    taxRate: number;
    total: number;
  }>;
  subtotal: number;
  taxAmount: number;
  shippingCost: number;
  total: number;
}

interface SellingPriceWarning {
  product: Product;
  rowId: number;
  currentPrice: number;
}

type ProductHistoryTab = 'purchases' | 'purchaseReturns' | 'sales' | 'salesReturns' | 'details';

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  isActive,
  page,
  mode = 'purchase',
  focusBarcodeRequest,
  onNavigatePage,
  onSelectedVendorChange,
  purchases,
  purchaseReturnVouchers,
  sales,
  salesReturnVouchers,
  vendors,
  products,
  settings,
  onRefreshPurchases,
  onRefreshProducts,
  onRefreshVendors,
  onDeletePurchase,
  onEditPurchase,
  onCreatePurchaseReturn,
  onEditProduct,
  onAddProduct,
}) => {
  const { t, isRtl } = useLanguage();
  const c = isRtl ? 'ر.س ' : (settings.currencySymbol || 'SAR ');
  const decimalPlaces = settings.decimalPoints ?? 2;
  const lastPurchaseVoucherDate = purchases.length
    ? purchases.reduce((latest, purchase) => purchase.id > latest.id ? purchase : latest).receivedDate
    : toLocalDateKey(new Date());

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PAID' | 'PENDING' | 'PARTIAL'>('ALL');
  const [historyDateFilter, setHistoryDateFilter] = useState<DateFilter>('ALL');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [historyVendorFilter, setHistoryVendorFilter] = useState('ALL');
  const isCreatingPurchasePage = page === 'entry';
  const isPurchaseReturnMode = mode === 'purchase-return';
  const [isCreatingVendor, setIsCreatingVendor] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [unknownBarcodeAction, setUnknownBarcodeAction] = useState<'create' | 'cancel'>('create');
  const createProductButtonRef = useRef<HTMLButtonElement>(null);
  const cancelUnknownBarcodeButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseEntry | null>(null);
  const [productHistoryProduct, setProductHistoryProduct] = useState<Product | null>(null);
  const [historyPartyFilter, setHistoryPartyFilter] = useState('ALL');
  const [productHistoryTab, setProductHistoryTab] = useState<ProductHistoryTab>('purchases');
  const [bypassHighCostWarning, setBypassHighCostWarning] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseEntry | null>(null);
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [purchaseActionError, setPurchaseActionError] = useState<string | null>(null);

  const handleOpenEdit = (p: PurchaseEntry) => {
    setPurchaseActionError(null);
    setSelectedPurchase(null);
    setEditingPurchase(p);
    setInvoiceNumber(p.invoiceNumber);
    setVendorId(p.vendorId);
    setVendorSearch('');
    setVendorSearchOpen(false);
    receivedDateEditedRef.current = true;
    setReceivedDate(p.receivedDate);
    setShippingCost(String(p.shippingCost));
    setIsPaid(p.paymentStatus === 'PAID');
    setPartialPaymentAmount(p.paymentStatus === 'PARTIAL' ? String(p.paidAmount) : '');
    setNotes(p.notes || '');
    setBypassHighCostWarning(false);
    setFormError(null);
    setFormSuccess(null);

    const editRows = createPurchaseRows();
    p.items.slice(0, MAX_PURCHASE_ROWS).forEach((item, index) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      editRows[index] = {
        rowId: editRows[index].rowId,
        productId: item.productId,
        unitId: '',
        barcodeSearch: product?.barcode || '',
        productSearch: (isRtl && product?.nameAr) || product?.name || item.productName,
        selectedProductIndex: 0,
        quantity: item.quantity,
        unitCost: item.unitCost,
        taxRate: product?.taxRate ?? settings.taxRate,
      };
    });
    setItems(editRows);
    onNavigatePage('entry');
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
  const [vendorId, setVendorId] = useState<number>(0);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorSearchOpen, setVendorSearchOpen] = useState(false);
  const [vendorSelectedIndex, setVendorSelectedIndex] = useState(-1);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(() => lastPurchaseVoucherDate);
  const receivedDateEditedRef = useRef(false);
  const [shippingCost, setShippingCost] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [partialPaymentAmount, setPartialPaymentAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<NewPurchaseItemRow[]>(createPurchaseRows);
  const [productSearchOpenRowId, setProductSearchOpenRowId] = useState<number | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<PurchaseColumn, number>>(
    loadPurchaseColumnWidths
  );
  const [focusedPurchaseNumber, setFocusedPurchaseNumber] = useState<{
    rowId: number;
    field: 'quantity' | 'unitCost' | 'subtotal' | 'total';
    value?: string;
  } | null>(null);
  const [sellingPriceWarning, setSellingPriceWarning] = useState<SellingPriceWarning | null>(null);
  const [sellingPriceInput, setSellingPriceInput] = useState('');
  const [sellingPriceUpdateError, setSellingPriceUpdateError] = useState<string | null>(null);
  const [updatingSellingPrice, setUpdatingSellingPrice] = useState(false);
  const sellingPriceInputRef = useRef<HTMLInputElement>(null);
  const updateSellingPriceButtonRef = useRef<HTMLButtonElement>(null);
  const [purchaseColumnOrder, setPurchaseColumnOrder] = useState<PurchaseColumn[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PURCHASE_COLUMN_ORDER_STORAGE_KEY) || '[]');
      if (
        Array.isArray(saved) &&
        saved.length === DEFAULT_PURCHASE_COLUMN_ORDER.length &&
        DEFAULT_PURCHASE_COLUMN_ORDER.every((column) => saved.includes(column))
      ) {
        return saved as PurchaseColumn[];
      }
    } catch {
      // Use the default order if saved column settings are invalid.
    }
    return DEFAULT_PURCHASE_COLUMN_ORDER;
  });
  const purchaseGridTableRef = useRef<HTMLTableElement>(null);
  const draggingPurchaseColumnRef = useRef<PurchaseColumn | null>(null);
  const resizingColumnRef = useRef<{
    column: PurchaseColumn;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [printEntry, setPrintEntry] = useState<PurchasePrintEntry | null>(null);
  const saveAndPrintRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const quantityInputRefs = useRef(new Map<number, HTMLInputElement>());
  const barcodeInputRefs = useRef(new Map<number, HTMLInputElement>());
  const previousProductsRef = useRef(products);
  const previousSettingsTaxRateRef = useRef(settings.taxRate);
  const previousLanguageRtlRef = useRef(isRtl);
  const invoiceNumberInputRef = useRef<HTMLInputElement>(null);
  const receivedDateInputRef = useRef<HTMLInputElement>(null);
  const unitInputRefs = useRef(new Map<number, HTMLButtonElement>());
  const unitClickTimeoutRef = useRef<number | null>(null);
  const costInputRefs = useRef(new Map<number, HTMLInputElement>());
  const pendingRateWarningRowsRef = useRef(new Set<number>());
  const shownRateWarningsRef = useRef(new Set<string>());
  const taxInputRefs = useRef(new Map<number, HTMLElement>());
  const totalInputRefs = useRef(new Map<number, HTMLInputElement>());
  const productSearchInputRefs = useRef(new Map<number, HTMLInputElement>());
  const productSearchContainerRefs = useRef(new Map<number, HTMLDivElement>());
  const focusAvailableBarcode = () => {
    const row = items.find((item) => !item.productId) || items[0];
    if (!row) return;
    window.requestAnimationFrame(() => barcodeInputRefs.current.get(row.rowId)?.focus());
  };

  useEffect(() => {
    if (!formSuccess) return;
    const timeout = window.setTimeout(() => setFormSuccess(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [formSuccess]);

  useEffect(() => {
    if (productSearchOpenRowId === null) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const container = productSearchContainerRefs.current.get(productSearchOpenRowId);
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setProductSearchOpenRowId(null);
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown);
  }, [productSearchOpenRowId]);

  useEffect(
    () => () => {
      if (unitClickTimeoutRef.current !== null) {
        window.clearTimeout(unitClickTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const handlePurchaseSaveShortcut = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 's' ||
        !isActive ||
        !isCreatingPurchasePage ||
        saving ||
        document.querySelector('[role="dialog"]')
      ) {
        return;
      }

      event.preventDefault();
      saveAndPrintRef.current = false;
      const form = document.getElementById('purchase-entry-form');
      if (form instanceof HTMLFormElement) form.requestSubmit();
    };

    window.addEventListener('keydown', handlePurchaseSaveShortcut);
    return () => window.removeEventListener('keydown', handlePurchaseSaveShortcut);
  }, [isActive, isCreatingPurchasePage, saving]);

  const lastPurchaseCosts = useMemo(() => {
    const costs = new Map<number, { receivedDate: string; unitCost: number }>();
    for (const purchase of purchases) {
      for (const item of purchase.items) {
        const latest = costs.get(item.productId);
        if (!latest || purchase.receivedDate > latest.receivedDate) {
          costs.set(item.productId, {
            receivedDate: purchase.receivedDate,
            unitCost: item.unitCost,
          });
        }
      }
    }
    return costs;
  }, [purchases]);

  const historyDateBounds = useMemo(
    () => resolveDateBounds(historyDateFilter, historyDateFrom, historyDateTo),
    [historyDateFilter, historyDateFrom, historyDateTo]
  );

  const filteredPurchases = useMemo(() => {
    return purchases.filter((p) => {
      if (statusFilter !== 'ALL' && p.paymentStatus !== statusFilter) return false;
      const receivedDate = p.receivedDate.slice(0, 10);
      if (historyDateBounds.start && receivedDate < historyDateBounds.start) return false;
      if (historyDateBounds.end && receivedDate > historyDateBounds.end) return false;
      if (historyVendorFilter !== 'ALL' && p.vendorId !== Number(historyVendorFilter)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !p.invoiceNumber.toLowerCase().includes(q) &&
          !p.vendorName.toLowerCase().includes(q) &&
          !(p.notes && p.notes.toLowerCase().includes(q))
        ) return false;
      }
      return true;
    });
  }, [purchases, statusFilter, historyDateBounds, historyVendorFilter, search]);

  const productHistory = useMemo(() => {
    if (!productHistoryProduct) return null;

    const purchaseHistory = purchases
      .flatMap((purchase) =>
        purchase.items
          .filter((item) => item.productId === productHistoryProduct.id)
          .map((item) => ({ purchase, item }))
      )
      .sort((a, b) =>
        b.purchase.receivedDate.localeCompare(a.purchase.receivedDate) ||
        b.purchase.id - a.purchase.id
      );

    const purchaseReturnHistory = purchaseReturnVouchers.flatMap((voucher) =>
      voucher.items
        .filter((item) =>
          item.productId === productHistoryProduct.id ||
          item.sku === productHistoryProduct.sku ||
          item.productName === productHistoryProduct.name
        )
        .map((item) => ({ voucher, item }))
    ).sort((a, b) =>
      b.voucher.createdAt.localeCompare(a.voucher.createdAt) ||
      b.voucher.id - a.voucher.id
    );

    const salesHistory = sales
      .filter((sale) => sale.status === 'COMPLETED')
      .flatMap((sale) =>
        sale.items
          .filter((item) => item.productId === productHistoryProduct.id)
          .map((item) => ({ sale, item }))
      )
      .sort((a, b) =>
        b.sale.createdAt.localeCompare(a.sale.createdAt) ||
        b.sale.id - a.sale.id
      );

    const salesById = new Map<number, Sale>();
    sales.forEach((sale) => salesById.set(sale.id, sale));
    const salesReturnHistory = salesReturnVouchers.flatMap((voucher) =>
      voucher.items.flatMap((returnItem) => {
        const sale = salesById.get(returnItem.saleId);
        const saleItem = sale?.items.find((item) => item.id === returnItem.saleItemId);
        const matchesProduct = saleItem
          ? saleItem.productId === productHistoryProduct.id
          : returnItem.sku === productHistoryProduct.sku ||
            returnItem.productName === productHistoryProduct.name;
        return matchesProduct ? [{ voucher, returnItem, sale, saleItem }] : [];
      })
    );

    return { purchaseHistory, purchaseReturnHistory, salesHistory, salesReturnHistory };
  }, [productHistoryProduct, purchases, purchaseReturnVouchers, sales, salesReturnVouchers]);

  const historyPartyOptions = useMemo(() => {
    if (!productHistory) return [];
    const options = new Map<string, string>();
    productHistory.purchaseHistory.forEach(({ purchase }) => {
      options.set(purchasePartyKey(purchase.vendorId), purchase.vendorName);
    });
    productHistory.purchaseReturnHistory.forEach(({ voucher }) => {
      options.set(purchasePartyKey(voucher.vendorId), voucher.vendorName);
    });
    productHistory.salesHistory.forEach(({ sale }) => {
      options.set(
        salesPartyKey(sale),
        sale.customerName || (isRtl ? 'عميل نقدي' : 'Walk-in Customer')
      );
    });
    productHistory.salesReturnHistory.forEach(({ sale }) => {
      options.set(
        salesPartyKey(sale),
        sale?.customerName || (isRtl ? 'عميل نقدي' : 'Walk-in Customer')
      );
    });
    return Array.from(options, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, isRtl ? 'ar' : 'en'));
  }, [productHistory, isRtl]);

  const filteredProductPurchaseHistory = productHistory?.purchaseHistory.filter(
    ({ purchase }) =>
      historyPartyFilter === 'ALL' ||
      purchasePartyKey(purchase.vendorId) === historyPartyFilter
  ) || [];
  const filteredProductPurchaseReturnHistory = productHistory?.purchaseReturnHistory.filter(
    ({ voucher }) =>
      historyPartyFilter === 'ALL' ||
      purchasePartyKey(voucher.vendorId) === historyPartyFilter
  ) || [];
  const filteredProductSalesHistory = productHistory?.salesHistory.filter(
    ({ sale }) => historyPartyFilter === 'ALL' || salesPartyKey(sale) === historyPartyFilter
  ) || [];
  const filteredProductSalesReturnHistory = productHistory?.salesReturnHistory.filter(
    ({ sale }) => historyPartyFilter === 'ALL' || salesPartyKey(sale) === historyPartyFilter
  ) || [];

  const purchaseHistoryRows = [...filteredProductPurchaseHistory]
    .sort((a, b) =>
      b.purchase.receivedDate.localeCompare(a.purchase.receivedDate) ||
      b.purchase.id - a.purchase.id
    )
    .map(({ purchase, item }) => ({
      id: `purchase-${purchase.id}-${item.id}`,
      date: purchase.receivedDate,
      voucherNumber: formatPurchaseVoucherNumber(purchase.id),
      party: purchase.vendorName,
      quantity: item.quantity,
      unit: productHistoryProduct?.unit || '',
      rate: item.unitCost,
    }));
  const purchaseReturnHistoryRows = [...filteredProductPurchaseReturnHistory]
    .sort((a, b) =>
      b.voucher.createdAt.localeCompare(a.voucher.createdAt) ||
      b.voucher.id - a.voucher.id
    )
    .map(({ voucher, item }) => ({
      id: `purchase-return-${voucher.id}-${item.id}`,
      date: new Date(voucher.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-US'),
      voucherNumber: voucher.voucherNumber,
      party: voucher.vendorName,
      quantity: item.quantity,
      unit: productHistoryProduct?.unit || '',
      rate: item.unitCost,
    }));
  const salesHistoryRows = [...filteredProductSalesHistory]
    .sort((a, b) =>
      b.sale.createdAt.localeCompare(a.sale.createdAt) || b.sale.id - a.sale.id
    )
    .map(({ sale, item }) => ({
      id: `sale-${sale.id}-${item.id}`,
      date: new Date(sale.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-US'),
      voucherNumber: sale.receiptNumber,
      party: sale.customerName || (isRtl ? 'عميل نقدي' : 'Walk-in Customer'),
      quantity: item.quantity,
      unit: item.unitName || productHistoryProduct?.unit || '',
      rate: item.unitPrice,
    }));
  const salesReturnHistoryRows = [...filteredProductSalesReturnHistory]
    .sort((a, b) =>
      b.voucher.createdAt.localeCompare(a.voucher.createdAt) ||
      b.voucher.id - a.voucher.id
    )
    .map(({ voucher, returnItem, sale, saleItem }) => ({
      id: `sales-return-${voucher.id}-${returnItem.saleItemId}`,
      date: new Date(voucher.createdAt).toLocaleString(isRtl ? 'ar-SA' : 'en-US'),
      voucherNumber: voucher.voucherNumber,
      party: sale?.customerName || (isRtl ? 'عميل نقدي' : 'Walk-in Customer'),
      quantity: returnItem.quantity,
      unit: returnItem.unitName || saleItem?.unitName || productHistoryProduct?.unit || '',
      rate: returnItem.quantity > 0 ? returnItem.refundAmount / returnItem.quantity : 0,
    }));

  const productHistoryTotals = useMemo(() => {
    if (!productHistory || !productHistoryProduct) return null;

    const returnsBySaleItem = new Map<number, { quantity: number; refundAmount: number }>();
    filteredProductSalesReturnHistory.forEach(({ returnItem }) => {
      const current = returnsBySaleItem.get(returnItem.saleItemId) || {
        quantity: 0,
        refundAmount: 0,
      };
      returnsBySaleItem.set(returnItem.saleItemId, {
        quantity: current.quantity + returnItem.quantity,
        refundAmount: current.refundAmount + returnItem.refundAmount,
      });
    });

    const totalSales =
      filteredProductSalesHistory.reduce(
        (sum, { item }) => sum + item.lineTotal - (item.discountAmount || 0),
        0
      ) - filteredProductSalesReturnHistory.reduce(
        (sum, { returnItem }) => sum + returnItem.refundAmount,
        0
      );
    const totalPurchase = filteredProductPurchaseHistory.reduce(
      (sum, { item }) => sum + item.lineTotal,
      0
    ) - filteredProductPurchaseReturnHistory.reduce(
      (sum, { item }) => sum + item.lineTotal,
      0
    );
    const estimatedProfit = filteredProductSalesHistory.reduce((sum, { sale, item }) => {
      const returned = returnsBySaleItem.get(item.id);
      const netQuantity = Math.max(0, item.quantity - (returned?.quantity || 0));
      const saleDate = sale.createdAt.slice(0, 10);
      const costRecord = productHistory.purchaseHistory.find(
        ({ purchase }) => purchase.receivedDate.slice(0, 10) <= saleDate
      );
      const unitCost = costRecord?.item.unitCost ?? productHistoryProduct.costPrice;
      const netSaleAmount =
        item.lineTotal -
        (item.discountAmount || 0) -
        (returned?.refundAmount || 0);
      return sum + netSaleAmount - netQuantity * unitCost * (item.unitsPerBase || 1);
    }, 0);

    return {
      totalSales,
      totalPurchase,
      estimatedProfit,
      salesCount: new Set(filteredProductSalesHistory.map(({ sale }) => sale.id)).size,
      purchaseCount: new Set(filteredProductPurchaseHistory.map(({ purchase }) => purchase.id)).size,
      purchaseReturnCount: new Set(filteredProductPurchaseReturnHistory.map(({ voucher }) => voucher.id)).size,
      quantityOut:
        filteredProductSalesHistory.reduce(
          (sum, { item }) => sum + item.quantity * (item.unitsPerBase || 1),
          0
        ) +
        filteredProductPurchaseReturnHistory.reduce((sum, { item }) => sum + item.quantity, 0),
      quantityIn:
        filteredProductPurchaseHistory.reduce((sum, { item }) => sum + item.quantity, 0) +
        filteredProductSalesReturnHistory.reduce(
          (sum, { returnItem, saleItem }) =>
            sum + returnItem.quantity * (saleItem?.unitsPerBase || 1),
          0
        ),
    };
  }, [
    productHistory,
    productHistoryProduct,
    filteredProductPurchaseHistory,
    filteredProductPurchaseReturnHistory,
    filteredProductSalesHistory,
    filteredProductSalesReturnHistory,
  ]);

  const renderProductHistoryTable = (
    rows: Array<{
      id: string;
      date: string;
      voucherNumber: string;
      party: string;
      quantity: number;
      unit: string;
      rate: number;
    }>,
    emptyMessage: string
  ) => (
    <div className="h-full min-h-0 overflow-auto">
      <table className={`w-full border-collapse text-xs ${isRtl ? 'text-right' : 'text-left'}`}>
        <thead className="sticky top-0 bg-slate-50 text-[10px] text-slate-600">
          <tr>
            <th className="whitespace-nowrap px-2 py-1.5">{isRtl ? 'التاريخ' : 'Date'}</th>
            <th className="whitespace-nowrap px-2 py-1.5">{isRtl ? 'رقم السند' : 'Voucher number'}</th>
            <th className="whitespace-nowrap px-2 py-1.5">{isRtl ? 'الجهة' : 'Party'}</th>
            <th className={`whitespace-nowrap px-2 py-1.5 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الكمية' : 'Qty'}</th>
            <th className="whitespace-nowrap px-2 py-1.5">{isRtl ? 'الوحدة' : 'Unit'}</th>
            <th className={`whitespace-nowrap px-2 py-1.5 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'السعر' : 'Rate'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length > 0 ? rows.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-600">{row.date}</td>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-700">{row.voucherNumber}</td>
              <td className="max-w-[180px] truncate px-2 py-1.5 text-slate-700" title={row.party}>{row.party}</td>
              <td className={`whitespace-nowrap px-2 py-1.5 font-mono tabular-nums ${isRtl ? 'text-left' : 'text-right'}`}>{row.quantity}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{row.unit || '—'}</td>
              <td className={`whitespace-nowrap px-2 py-1.5 font-mono tabular-nums ${isRtl ? 'text-left' : 'text-right'}`}>
                {c}{row.rate.toFixed(decimalPlaces)}
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-slate-500">{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const filteredVendors = useMemo(() => {
    const query = vendorSearch.trim().toLowerCase();
    if (!query) return vendors;
    return vendors.filter((vendor) =>
      vendor.name.toLowerCase().includes(query) ||
      (vendor.nameAr?.toLowerCase().includes(query) ?? false) ||
      vendor.contactPerson.toLowerCase().includes(query)
    );
  }, [vendors, vendorSearch]);

  useEffect(() => {
    if (!receivedDateEditedRef.current) setReceivedDate(lastPurchaseVoucherDate);
  }, [lastPurchaseVoucherDate]);

  useEffect(() => {
    if (!unknownBarcode) return;
    const initialAction = onAddProduct ? 'create' : 'cancel';
    setUnknownBarcodeAction(initialAction);
    const frame = window.requestAnimationFrame(() => {
      const initialButton =
        initialAction === 'create'
          ? createProductButtonRef.current
          : cancelUnknownBarcodeButtonRef.current;
      initialButton?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [unknownBarcode, onAddProduct]);

  const selectedVendor = vendors.find((vendor) => vendor.id === vendorId);
  const getVendorPendingBalance = (targetVendorId: number) => {
    const netBalance = purchases
      .filter((purchase) => purchase.vendorId === targetVendorId)
      .reduce((balance, purchase) => {
        const supplierCredit = purchaseReturnVouchers
          .filter((voucher) => voucher.purchaseId === purchase.id)
          .reduce((sum, voucher) => sum + voucher.total, 0);
        return balance + purchase.total - purchase.paidAmount - supplierCredit;
      }, 0);
    return Math.max(0, netBalance);
  };
  useEffect(() => {
    if (!isActive || page !== 'entry' || !selectedVendor) {
      onSelectedVendorChange?.(null);
      return;
    }
    const vendorPurchases = purchases.filter((purchase) => purchase.vendorId === selectedVendor.id);
    onSelectedVendorChange?.({
      name: (isRtl && selectedVendor.nameAr) || selectedVendor.name,
      taxNumber: selectedVendor.taxNumber || '',
      pendingBalance: getVendorPendingBalance(selectedVendor.id),
      currencySymbol: c,
      partialCount: vendorPurchases.filter(
        (purchase) => purchase.paymentStatus === 'PARTIAL'
      ).length,
    });
  }, [
    isActive,
    page,
    selectedVendor,
    isRtl,
    onSelectedVendorChange,
    purchases,
    purchaseReturnVouchers,
    c,
  ]);

  const selectedVendorPurchases = selectedVendor
    ? purchases.filter((purchase) => purchase.vendorId === selectedVendor.id)
    : [];
  const selectedVendorPendingBalance = selectedVendor
    ? getVendorPendingBalance(selectedVendor.id)
    : 0;
  const selectedVendorPartialCount = selectedVendorPurchases.filter(
    (purchase) => purchase.paymentStatus === 'PARTIAL'
  ).length;

  const selectVendor = (vendor: Vendor) => {
    setVendorId(vendor.id);
    setVendorSearch('');
    setVendorSearchOpen(false);
    setVendorSelectedIndex(-1);
    if (isPurchaseReturnMode) {
      const purchase = purchases
        .filter((candidate) =>
          candidate.vendorId === vendor.id &&
          candidate.items.some((item) =>
            item.quantity -
              purchaseReturnVouchers
                .filter((voucher) => voucher.purchaseId === candidate.id)
                .flatMap((voucher) => voucher.items)
                .filter((returnItem) => returnItem.purchaseItemId === item.id)
                .reduce((sum, returnItem) => sum + returnItem.quantity, 0) >
            0
          )
        )
        .sort((a, b) => b.receivedDate.localeCompare(a.receivedDate))[0];
      if (purchase) clonePurchaseForReturn(purchase);
    }
  };

  const clonePurchaseForReturn = (purchase: PurchaseEntry) => {
    setEditingPurchase(null);
    setVendorId(purchase.vendorId);
    setVendorSearch('');
    setVendorSearchOpen(false);
    setInvoiceNumber(purchase.invoiceNumber);
    receivedDateEditedRef.current = true;
    setReceivedDate(purchase.receivedDate);
    setShippingCost(String(purchase.shippingCost));
    setNotes(purchase.notes || '');
    setBypassHighCostWarning(true);
    setFormError(null);
    setFormSuccess(null);

    const returnRows = createPurchaseRows();
    purchase.items.slice(0, MAX_PURCHASE_ROWS).forEach((item, index) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      const alreadyReturned = purchaseReturnVouchers
        .filter((voucher) => voucher.purchaseId === purchase.id)
        .flatMap((voucher) => voucher.items)
        .filter((returnItem) => returnItem.purchaseItemId === item.id)
        .reduce((sum, returnItem) => sum + returnItem.quantity, 0);
      const available = Math.max(0, item.quantity - alreadyReturned);
      returnRows[index] = {
        rowId: returnRows[index].rowId,
        productId: item.productId,
        unitId: '',
        barcodeSearch: product?.barcode || '',
        productSearch: (isRtl && product?.nameAr) || product?.name || item.productName,
        selectedProductIndex: 0,
        quantity: available,
        unitCost: item.unitCost,
        taxRate: product?.taxRate ?? settings.taxRate,
      };
    });
    setItems(returnRows);
  };

  const openNewPurchasePage = () => {
    onNavigatePage('entry');
  };

  const resetPurchaseDraft = () => {
    setEditingPurchase(null);
    setProductSearchOpenRowId(null);
    pendingRateWarningRowsRef.current.clear();
    shownRateWarningsRef.current.clear();
    setInvoiceNumber('');
    setVendorId(0);
    setVendorSearch('');
    setVendorSearchOpen(false);
    receivedDateEditedRef.current = false;
    setReceivedDate(lastPurchaseVoucherDate);
    setShippingCost('');
    setIsPaid(false);
    setPartialPaymentAmount('');
    setNotes('');
    setBypassHighCostWarning(false);
    pendingRateWarningRowsRef.current.clear();
    shownRateWarningsRef.current.clear();
    setItems(createPurchaseRows());
    setFormError(null);
    setFormSuccess(null);
  };

  const cancelPurchaseEntry = () => {
    resetPurchaseDraft();
    onNavigatePage('history');
  };

  const clearPurchaseDraft = () => {
    if (saving) return;
    const confirmed = window.confirm(
      isRtl
        ? (isPurchaseReturnMode
            ? 'هل تريد مسح جميع بيانات مرتجع المشتريات الحالية؟'
            : 'هل تريد مسح جميع بيانات إدخال الشراء الحالية؟')
        : (isPurchaseReturnMode
            ? 'Clear all current purchase return details?'
            : 'Clear all current purchase entry details?')
    );
    if (!confirmed) return;
    saveAndPrintRef.current = false;
    resetPurchaseDraft();
  };

  const matchingProductsForRow = (row: NewPurchaseItemRow): Product[] => {
    const queryTokens = tokenizeProductSearch(row.productSearch);
    if (queryTokens.length === 0) return [];

    const compactQuery = queryTokens.join('');
    return products
      .map((product, index) => {
        const nameTokens = [
          ...tokenizeProductSearch(product.name),
          ...tokenizeProductSearch(product.nameAr || ''),
        ];
        const searchableTokens = [
          ...nameTokens,
          ...tokenizeProductSearch(product.sku),
          ...tokenizeProductSearch(product.barcode),
        ];
        if (!queryTokens.every((queryToken) =>
          searchableTokens.some((token) => token.includes(queryToken))
        )) {
          return null;
        }

        const compactName = nameTokens.join('');
        const rank = compactName === compactQuery
          ? 0
          : compactName.includes(compactQuery)
            ? 1
            : queryTokens.every((queryToken) =>
              nameTokens.some((token) => token.includes(queryToken))
            )
              ? 2
              : 3;
        return { product, index, rank };
      })
      .filter((match): match is { product: Product; index: number; rank: number } => match !== null)
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .slice(0, 20)
      .map((match) => match.product);
  };

  const renderProductSuggestion = (
    product: Product,
    matchIndex: number,
    rowIndex: number,
    selectedIndex: number
  ) => {
    const multiUnitDetails = product.multiUnits?.map((unit) =>
      `${unit.name} × ${unit.unitsPerBase} (${c}${(unit.price ?? product.retailPrice * unit.unitsPerBase).toFixed(2)})`
    ).join(' · ');
    const productDetails = [
      `${isRtl ? 'رمز الصنف' : 'SKU'}: ${product.sku || '—'}`,
      `${isRtl ? 'الباركود' : 'Barcode'}: ${product.barcode || '—'}`,
      `${isRtl ? 'التصنيف' : 'Category'}: ${product.category || '—'}`,
      `${isRtl ? 'العلامة التجارية' : 'Brand'}: ${product.brand || '—'}`,
      `${isRtl ? 'الوحدة' : 'Unit'}: ${product.unit || '—'}`,
      `${isRtl ? 'المخزون' : 'Stock'}: ${product.stock}`,
      `${isRtl ? 'حد إعادة الطلب' : 'Reorder at'}: ${product.reorderLevel}`,
      `${isRtl ? 'الضريبة' : 'Tax'}: ${(product.taxRate ?? settings.taxRate).toFixed(2)}%`,
      `${isRtl ? 'التكلفة' : 'Cost'}: ${c}${product.costPrice.toFixed(2)}`,
      `${isRtl ? 'سعر البيع' : 'Selling'}: ${c}${product.retailPrice.toFixed(2)}`,
      multiUnitDetails ? `${isRtl ? 'الوحدات المتعددة' : 'Multi-units'}: ${multiUnitDetails}` : '',
    ].filter(Boolean).join(' · ');

    return (
      <button
        key={product.id}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => updateItemRow(rowIndex, { selectedProductIndex: matchIndex })}
        onClick={() => selectProductForRow(rowIndex, product)}
        title={`${product.name}${product.nameAr ? ` · ${product.nameAr}` : ''} · ${productDetails}`}
        className={`w-full border-b border-slate-100 px-2.5 py-2 text-left last:border-0 ${
          selectedIndex === matchIndex ? 'bg-blue-100' : 'hover:bg-blue-50'
        }`}
      >
        <span className="flex min-w-0 items-center gap-3 font-medium text-slate-900">
          <span dir="ltr" className="min-w-0 flex-1 truncate text-left">
            {product.name}
          </span>
          {product.nameAr && (
            <span dir="rtl" className="min-w-0 flex-1 truncate text-right">
              {product.nameAr}
            </span>
          )}
        </span>
        <span className="block truncate whitespace-nowrap text-[10px] text-slate-600" title={productDetails}>
          {productDetails}
        </span>
      </button>
    );
  };

  const selectProductForRow = (
    rowIndex: number,
    product: Product,
    unitId = '',
    scannedBarcode = product.barcode
  ) => {
    const row = items[rowIndex];
    if (!row) return;
    setProductSearchOpenRowId(null);
    pendingRateWarningRowsRef.current.delete(row.rowId);
    const purchaseUnitCost = getPurchaseUnitCost(product, unitId) ?? product.costPrice;
    const purchaseUnit = getPurchaseUnit(product, unitId);
    const currentSellingPrice = purchaseUnit.sellingPrice ?? product.retailPrice;
    const taxRate = product.taxRate ?? settings.taxRate;
    const purchaseCostWithTax = purchaseUnitCost * (1 + taxRate / 100);
    updateItemRow(rowIndex, {
      productId: product.id,
      unitId,
      barcodeSearch: scannedBarcode,
      productSearch: isRtl && product.nameAr ? product.nameAr : product.name,
      selectedProductIndex: 0,
      quantity: '',
      unitCost: purchaseUnitCost,
      taxRate,
    });
    if (purchaseCostWithTax > currentSellingPrice && !bypassHighCostWarning) {
      setSellingPriceInput((purchaseCostWithTax / purchaseUnit.unitsPerBase).toFixed(decimalPlaces));
      setSellingPriceUpdateError(null);
      setSellingPriceWarning({
        product,
        rowId: row.rowId,
        currentPrice: product.retailPrice,
      });
    } else {
      window.requestAnimationFrame(() => quantityInputRefs.current.get(row.rowId)?.focus());
    }
  };

  const dismissSellingPriceWarning = () => {
    const warning = sellingPriceWarning;
    setSellingPriceWarning(null);
    setSellingPriceUpdateError(null);
    if (!warning) return;
    window.requestAnimationFrame(() => costInputRefs.current.get(warning.rowId)?.focus());
  };

  const checkSellingPriceWarning = (
    rowId: number,
    product: Product | undefined,
    unitId: string,
    rate: number,
    taxRate: number
  ) => {
    if (
      !product ||
      !pendingRateWarningRowsRef.current.delete(rowId) ||
      !Number.isFinite(rate) ||
      bypassHighCostWarning
    ) {
      return;
    }

    const sellingPrice = getPurchaseUnit(product, unitId).sellingPrice;
    const costWithTax = rate * (1 + taxRate / 100);
    if (sellingPrice === undefined || costWithTax <= sellingPrice) return;

    const warningKey = `${rowId}:${product.id}:${unitId}:${costWithTax}`;
    if (shownRateWarningsRef.current.has(warningKey)) return;
    shownRateWarningsRef.current.add(warningKey);
    const purchaseUnit = getPurchaseUnit(product, unitId);
    setSellingPriceInput((costWithTax / purchaseUnit.unitsPerBase).toFixed(decimalPlaces));
    setSellingPriceUpdateError(null);
    setSellingPriceWarning({
      product,
      rowId,
      currentPrice: product.retailPrice,
    });
  };

  const updateProductSellingPrice = async (product: Product, baseUnitPrice: number) => {
    const payload = {
      retailPrice: baseUnitPrice,
      ...(product.multiUnits
        ? {
            multiUnits: product.multiUnits.map((unit) => ({
              ...unit,
              price: Number((baseUnitPrice * Math.max(1, unit.unitsPerBase)).toFixed(decimalPlaces)),
            })),
          }
        : {}),
    };
    const response = await fetch(`/api/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const errorMessage =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof data.error === 'string'
          ? data.error
          : (isRtl ? 'تعذر تحديث سعر بيع المنتج.' : 'Failed to update the product selling price.');
      throw new Error(errorMessage);
    }
    await onRefreshProducts();
  };

  const saveSellingPriceWarning = async () => {
    if (!sellingPriceWarning) return;
    const newPrice = Number(sellingPriceInput);
    if (!Number.isFinite(newPrice) || newPrice < 0) {
      setSellingPriceUpdateError(isRtl ? 'أدخل سعر بيع صالحاً.' : 'Enter a valid selling price.');
      return;
    }

    setUpdatingSellingPrice(true);
    setSellingPriceUpdateError(null);
    try {
      await updateProductSellingPrice(sellingPriceWarning.product, newPrice);
      dismissSellingPriceWarning();
    } catch (error) {
      setSellingPriceUpdateError(
        error instanceof Error ? error.message : (isRtl ? 'تعذر تحديث سعر البيع.' : 'Could not update the selling price.')
      );
    } finally {
      setUpdatingSellingPrice(false);
    }
  };

  const clearItemRow = (rowIndex: number) => {
    const row = items[rowIndex];
    if (!row) return;
    pendingRateWarningRowsRef.current.delete(row.rowId);
    updateItemRow(rowIndex, {
      productId: 0,
      unitId: '',
      barcodeSearch: '',
      productSearch: '',
      selectedProductIndex: 0,
      quantity: '',
      unitCost: '',
      taxRate: '',
    });
  };

  const startColumnResize = (
    column: PurchaseColumn,
    event: React.PointerEvent<HTMLSpanElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    resizingColumnRef.current = {
      column,
      startX: event.clientX,
      startWidth: columnWidths[column],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeColumn = (event: React.PointerEvent<HTMLSpanElement>) => {
    const resizing = resizingColumnRef.current;
    if (!resizing) return;
    const direction = isRtl ? -1 : 1;
    const width = Math.max(
      0,
      resizing.startWidth + (event.clientX - resizing.startX) * direction
    );
    setColumnWidths((current) => ({ ...current, [resizing.column]: width }));
  };

  const finishColumnResize = (event: React.PointerEvent<HTMLSpanElement>) => {
    const resizing = resizingColumnRef.current;
    if (!resizing) return;
    const direction = isRtl ? -1 : 1;
    const width = Math.max(
      0,
      resizing.startWidth + (event.clientX - resizing.startX) * direction
    );
    const nextWidths = { ...columnWidths, [resizing.column]: width };
    setColumnWidths(nextWidths);
    localStorage.setItem(PURCHASE_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(nextWidths));
    resizingColumnRef.current = null;
  };

  const movePurchaseColumn = (targetColumn: PurchaseColumn) => {
    const sourceColumn = draggingPurchaseColumnRef.current;
    if (!sourceColumn || sourceColumn === targetColumn) return;
    setPurchaseColumnOrder((current) => {
      const next = current.filter((column) => column !== sourceColumn);
      const targetIndex = next.indexOf(targetColumn);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, sourceColumn);
      localStorage.setItem(PURCHASE_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    draggingPurchaseColumnRef.current = null;
  };

  useEffect(() => {
    const table = purchaseGridTableRef.current;
    if (!table) return;

    const serialHeader = table.querySelector<HTMLTableCellElement>('thead tr th:first-child');
    const headerRow = table.querySelector<HTMLTableRowElement>('thead tr');
    const colGroup = table.querySelector<HTMLTableColElement>('colgroup');
    if (serialHeader && headerRow) {
      headerRow.appendChild(serialHeader);
      purchaseColumnOrder.forEach((column) => {
        const header = headerRow.querySelector<HTMLTableCellElement>(`th[data-purchase-column="${column}"]`);
        if (header) headerRow.appendChild(header);
      });
    }

    if (colGroup) {
      const serialCol = colGroup.querySelector<HTMLTableColElement>('col:first-child');
      if (serialCol) colGroup.appendChild(serialCol);
      purchaseColumnOrder.forEach((column) => {
        const col = colGroup.querySelector<HTMLTableColElement>(`col[data-purchase-column="${column}"]`);
        if (col) colGroup.appendChild(col);
      });
    }

    table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
      const serialCell = row.querySelector<HTMLTableCellElement>('td:first-child');
      if (serialCell) row.appendChild(serialCell);
      purchaseColumnOrder.forEach((column) => {
        const cell = row.querySelector<HTMLTableCellElement>(`td[data-purchase-column="${column}"]`);
        if (cell) row.appendChild(cell);
      });
    });
  }, [purchaseColumnOrder, isCreatingPurchasePage]);

  const preventNumberArrowChange = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.preventDefault();
  };

  const navigatePurchaseGrid = (
    rowIndex: number,
    event: React.KeyboardEvent<HTMLTableRowElement>
  ) => {
    if (
      event.defaultPrevented ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      return;
    }

    const activeElement = event.target instanceof HTMLElement ? event.target : null;
    const activeCell = activeElement?.closest<HTMLElement>('[data-purchase-grid-cell]');
    if (!activeCell) return;
    const activeColumn = activeCell.closest<HTMLElement>('td[data-purchase-column]')?.dataset.purchaseColumn;

    const currentCells = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[data-purchase-grid-cell]:not(:disabled):not([tabindex="-1"])'
      )
    );
    const currentColumnIndex = currentCells.indexOf(activeCell);
    if (currentColumnIndex < 0) return;

    event.preventDefault();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? (isRtl ? -1 : 1) : (isRtl ? 1 : -1);
      currentCells[currentColumnIndex + step]?.focus();
      return;
    }

    const nextRowIndex = rowIndex + (event.key === 'ArrowDown' ? 1 : -1);
    const rows = Array.from(event.currentTarget.closest('tbody')?.querySelectorAll('tr') || []);
    const nextRow = rows[nextRowIndex];
    if (!nextRow || !activeColumn) return;
    nextRow.querySelector<HTMLElement>(
      `td[data-purchase-column="${activeColumn}"] [data-purchase-grid-cell]:not(:disabled):not([tabindex="-1"])`
    )?.focus();
  };

  const renderColumnResizeHandle = (column: PurchaseColumn, label: string) => (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={isRtl ? `تغيير عرض عمود ${label}` : `Resize ${label} column`}
      onPointerDown={(event) => startColumnResize(column, event)}
      onPointerMove={resizeColumn}
      onPointerUp={finishColumnResize}
      onPointerCancel={finishColumnResize}
      className={`absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-blue-500/60 ${isRtl ? 'left-0' : 'right-0'}`}
    />
  );

  const updateItemRow = (idx: number, patch: Partial<NewPurchaseItemRow>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const updated = { ...it, ...patch };
        return updated;
      })
    );
  };

  useEffect(() => {
    const previousProducts = previousProductsRef.current;
    if (
      previousProducts === products &&
      previousSettingsTaxRateRef.current === settings.taxRate &&
      previousLanguageRtlRef.current === isRtl
    ) {
      return;
    }
    previousProductsRef.current = products;
    previousSettingsTaxRateRef.current = settings.taxRate;
    previousLanguageRtlRef.current = isRtl;

    setItems((currentItems) =>
      currentItems.map((item) => {
        if (!item.productId) return item;
        const product = products.find((candidate) => candidate.id === item.productId);
        if (!product) return item;

        const previousProduct = previousProducts.find(
          (candidate) => candidate.id === item.productId
        );
        const unitStillExists =
          !item.unitId || product.multiUnits?.some((unit) => unit.id === item.unitId);
        const nextUnitId = unitStillExists ? item.unitId : '';
        const previousUnitFactor = getPurchaseUnit(previousProduct, item.unitId).unitsPerBase;
        const nextUnitFactor = getPurchaseUnit(product, nextUnitId).unitsPerBase;
        const rateWasDefaultCost =
          previousProduct !== undefined &&
          item.unitCost !== '' &&
          Math.abs(
            Number(item.unitCost) - (getPurchaseUnitCost(previousProduct, item.unitId) ?? 0)
          ) < 0.005;
        const nextUnitCost = item.unitCost === ''
          ? getPurchaseUnitCost(product, nextUnitId) ?? ''
          : rateWasDefaultCost
            ? getPurchaseUnitCost(product, nextUnitId) ?? ''
            : previousUnitFactor === nextUnitFactor
              ? item.unitCost
              : Number(item.unitCost) / previousUnitFactor * nextUnitFactor;
        const nextTaxRate = product.taxRate ?? settings.taxRate;
        const nextProductName = (isRtl && product.nameAr) || product.name;

        if (
          item.unitId === nextUnitId &&
          item.unitCost === nextUnitCost &&
          item.taxRate === nextTaxRate &&
          item.barcodeSearch === product.barcode &&
          item.productSearch === nextProductName
        ) {
          return item;
        }

        return {
          ...item,
          unitId: nextUnitId,
          unitCost: nextUnitCost,
          taxRate: nextTaxRate,
          barcodeSearch: product.barcode,
          productSearch: nextProductName,
        };
      })
    );
  }, [products, settings.taxRate, isRtl]);

  const cyclePurchaseUnit = (rowIndex: number) => {
    const item = items[rowIndex];
    if (!item) return;
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product?.multiUnits?.length) return;

    const currentIndex = product.multiUnits.findIndex((unit) => unit.id === item.unitId);
    const nextIndex = currentIndex + 1;
    const nextUnit = product.multiUnits[nextIndex];
    const currentFactor = getPurchaseUnit(product, item.unitId).unitsPerBase;
    const nextFactor = getPurchaseUnit(product, nextUnit?.id || '').unitsPerBase;
    const nextRate = item.unitCost === ''
      ? ''
      : (Number(item.unitCost) / currentFactor) * nextFactor;

    updateItemRow(rowIndex, {
      unitId: nextUnit?.id || '',
      unitCost: nextRate,
    });
  };

  const handlePurchaseUnitClick = (rowIndex: number) => {
    if (unitClickTimeoutRef.current !== null) {
      window.clearTimeout(unitClickTimeoutRef.current);
    }
    unitClickTimeoutRef.current = window.setTimeout(() => {
      unitClickTimeoutRef.current = null;
      cyclePurchaseUnit(rowIndex);
    }, 250);
  };

  const handleOpenProductHistory = (product: Product) => {
    if (unitClickTimeoutRef.current !== null) {
      window.clearTimeout(unitClickTimeoutRef.current);
      unitClickTimeoutRef.current = null;
    }
    setHistoryPartyFilter('ALL');
    setProductHistoryTab('purchases');
    setProductHistoryProduct(product);
  };

  const formSubtotal = useMemo(() => {
    return items.reduce(
      (sum, item) => item.productId
        ? sum + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0)
        : sum,
      0
    );
  }, [items]);

  const formTaxAmount = useMemo(
    () => items.reduce(
      (sum, item) => item.productId
        ? sum + ((Number(item.quantity) || 0) * (Number(item.unitCost) || 0) * (Number(item.taxRate) || 0)) / 100
        : sum,
      0
    ),
    [items]
  );

  const formTotal = useMemo(() => {
    const ship = Number(shippingCost) || 0;
    return formSubtotal + formTaxAmount + ship;
  }, [formSubtotal, formTaxAmount, shippingCost]);

  const firstEmptyPurchaseRowIndex = items.findIndex((item) => !item.productId);
  const purchaseGridWidth =
    48 + Object.values(columnWidths).reduce((sum, width) => sum + width, 0);

  useEffect(() => {
    if (!printEntry) return;
    const handleAfterPrint = () => setPrintEntry(null);
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    let active = true;
    const printPurchase = async () => {
      try {
        let printJob: PrintTemplateJob;
        if (printEntry.voucherId) {
          printJob = await createVoucherTemplateJob(
            'purchase-invoice',
            printEntry.voucherId,
            settings,
            settings.paperWidth || '80mm',
            isRtl
          );
        } else {
          const format: PaperWidth = getPrintDocumentFormat(
            settings,
            'purchase-invoice',
            settings.paperWidth || '80mm'
          );
          const data: PrintDocumentData = {
            documentType: 'purchase-invoice',
            title: isRtl ? 'فاتورة مشتريات' : 'Purchase Invoice',
            number: printEntry.invoiceNumber,
            date: printEntry.receivedDate,
            companyName: settings.storeName,
            companyNameAr: settings.storeNameAr,
            companyAddress: settings.address,
            companyPhone: settings.phone,
            companyTaxId: settings.taxId,
            companyLogo: settings.storeLogoDataUrl,
            fields: [
              { label: isRtl ? 'المورد' : 'Supplier', value: printEntry.vendorName },
              { label: isRtl ? 'حالة الدفع' : 'Payment status', value: printEntry.paymentStatus },
              ...(printEntry.notes ? [{ label: isRtl ? 'ملاحظات' : 'Notes', value: printEntry.notes }] : []),
            ],
            columns: isRtl
              ? ['#', 'الصنف', 'الكمية', 'التكلفة', 'الإجمالي']
              : ['#', 'Item', 'Qty', 'Cost', 'Total'],
            rows: printEntry.items.map((item, index) => ({
              values: [
                String(index + 1),
                item.name,
                `${item.quantity} ${item.unit}`.trim(),
                `${settings.currencySymbol || 'SAR'} ${item.unitCost.toFixed(settings.decimalPoints ?? 2)}`,
                `${settings.currencySymbol || 'SAR'} ${item.total.toFixed(settings.decimalPoints ?? 2)}`,
              ],
            })),
            totals: [
              { label: isRtl ? 'المجموع الفرعي' : 'Subtotal', value: printEntry.subtotal.toFixed(settings.decimalPoints ?? 2) },
              { label: isRtl ? 'الضريبة' : 'VAT', value: printEntry.taxAmount.toFixed(settings.decimalPoints ?? 2) },
              { label: isRtl ? 'الشحن' : 'Shipping', value: printEntry.shippingCost.toFixed(settings.decimalPoints ?? 2) },
              { label: isRtl ? 'الإجمالي' : 'Total', value: printEntry.total.toFixed(settings.decimalPoints ?? 2) },
              { label: isRtl ? 'المدفوع' : 'Paid', value: printEntry.paidAmount.toFixed(settings.decimalPoints ?? 2) },
            ],
            direction: isRtl ? 'rtl' : 'ltr',
          };
          printJob = await createPrintTemplateJob(data, settings, format);
        }
        if (!active) return;
        await printTemplateJob(printJob);
        if (active) setPrintEntry(null);
      } catch (error) {
        if (active) {
          setFormError(error instanceof Error ? error.message : 'Purchase invoice could not be printed.');
          setPrintEntry(null);
        }
      }
    };
    void printPurchase();
    return () => {
      active = false;
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [printEntry]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    const shouldPrint = saveAndPrintRef.current;
    saveAndPrintRef.current = false;

    if (!invoiceNumber.trim()) {
      setFormError(isRtl ? 'رقم الفاتورة مطلوب.' : 'PO / Invoice Number is required.');
      return;
    }
    if (!vendorId) {
      setFormError(isRtl ? 'الرجاء اختيار المورد.' : 'Please select a vendor supplier.');
      return;
    }
    const selectedItems = items.filter((item) => item.productId > 0);
    if (selectedItems.length === 0) {
      setFormError(isRtl ? 'الرجاء إضافة صنف واحد على الأقل.' : 'Please add at least one line item to this purchase.');
      return;
    }
    if (items.some((item) => !item.productId && (item.productSearch.trim() || item.barcodeSearch.trim()))) {
      setFormError(isRtl ? 'الرجاء اختيار الصنف الذي تبحث عنه أو مسح الحقل.' : 'Select the searched product or clear the product field.');
      return;
    }
    if (selectedItems.some((item) => item.quantity === '' || item.quantity <= 0 || item.unitCost === '')) {
      setFormError(isRtl ? 'أدخل الكمية والتكلفة لكل صنف محدد.' : 'Enter a quantity and rate for each selected product.');
      return;
    }

    const enteredPartialAmount = partialPaymentAmount.trim() === ''
      ? 0
      : Number(partialPaymentAmount);
    const purchaseSubtotal = selectedItems.reduce((sum, item) => {
      const unitFactor = getPurchaseUnit(
        products.find((candidate) => candidate.id === item.productId),
        item.unitId
      ).unitsPerBase;
      const baseQuantity = (Number(item.quantity) || 0) * unitFactor;
      const baseUnitCost = Math.max(0, Number(item.unitCost) || 0) / unitFactor;
      return sum + Number((baseQuantity * baseUnitCost).toFixed(2));
    }, 0);
    const purchaseTotal = Number((
      purchaseSubtotal +
      Number(formTaxAmount.toFixed(2)) +
      Number((Number(shippingCost) || 0).toFixed(2))
    ).toFixed(2));
    if (
      !isPaid &&
      (!Number.isFinite(enteredPartialAmount) ||
        enteredPartialAmount < 0 ||
        enteredPartialAmount > purchaseTotal ||
        (purchaseTotal > 0 && enteredPartialAmount >= purchaseTotal))
    ) {
      setFormError(
        isRtl
          ? 'يجب أن يكون المبلغ الجزئي أقل من إجمالي الفاتورة. حدد خيار مدفوع إذا تم دفعها بالكامل.'
          : 'Partial amount must be less than the invoice total. Check Paid if it was paid in full.'
      );
      return;
    }

    const paidAmount = isPaid
      ? purchaseTotal
      : Number(enteredPartialAmount.toFixed(2));
    const paymentStatus = isPaid
      ? 'PAID'
      : paidAmount > 0
        ? 'PARTIAL'
        : 'PENDING';

    const editingPurchaseId = editingPurchase?.id;
    const purchasePayload = {
      invoiceNumber: invoiceNumber.trim(),
      vendorId,
      receivedDate,
      subtotal: Number(formSubtotal.toFixed(2)),
      taxAmount: Number(formTaxAmount.toFixed(2)),
      shippingCost: Number(shippingCost) || 0,
      paymentStatus,
      paidAmount,
      notes: notes.trim(),
      updateCostPrices: !bypassHighCostWarning,
      items: selectedItems.map((item) => {
        const unitFactor = getPurchaseUnit(
          products.find((candidate) => candidate.id === item.productId),
          item.unitId
        ).unitsPerBase;
        return {
          productId: item.productId,
          quantity: (Number(item.quantity) || 0) * unitFactor,
          unitCost: Math.max(0, Number(item.unitCost) || 0) / unitFactor,
        };
      }),
    };

    setSaving(true);
    let savedPurchaseId = editingPurchaseId;
    try {
      if (isPurchaseReturnMode) {
        if (!onCreatePurchaseReturn) {
          throw new Error(isRtl ? 'تعذر إنشاء مرتجع المشتريات.' : 'Purchase return creation is unavailable.');
        }
        const purchase = purchases.find(
          (candidate) =>
            candidate.invoiceNumber.toLocaleLowerCase() === invoiceNumber.trim().toLocaleLowerCase() &&
            candidate.vendorId === vendorId
        );
        if (!purchase) {
          throw new Error(isRtl ? 'رقم فاتورة الشراء غير صحيح للمورد المحدد.' : 'Purchase invoice does not match the selected vendor.');
        }

        const returnItems = selectedItems.flatMap((item) => {
          const purchaseItem = purchase.items.find(
            (candidate) => candidate.productId === item.productId
          );
          if (!purchaseItem) return [];

          const alreadyReturned = purchaseReturnVouchers
            .filter((voucher) => voucher.purchaseId === purchase.id)
            .flatMap((voucher) => voucher.items)
            .filter((returnItem) => returnItem.purchaseItemId === purchaseItem.id)
            .reduce((sum, returnItem) => sum + returnItem.quantity, 0);
          const available = Math.max(0, purchaseItem.quantity - alreadyReturned);
          const unitFactor = getPurchaseUnit(
            products.find((candidate) => candidate.id === item.productId),
            item.unitId
          ).unitsPerBase;
          const quantity = (Number(item.quantity) || 0) * unitFactor;
          if (quantity <= 0 || quantity > available) return [];
          return [{
            purchaseItemId: purchaseItem.id,
            quantity,
          }];
        });

        if (returnItems.length === 0) {
          throw new Error(isRtl ? 'أدخل كمية مرتجع صالحة.' : 'Enter a valid return quantity.');
        }

        await onCreatePurchaseReturn({
          purchaseId: purchase.id,
          items: returnItems,
          notes: notes.trim(),
        });
        await Promise.all([onRefreshPurchases(), onRefreshProducts()]);
        resetPurchaseDraft();
        setFormSuccess(isRtl ? 'تم تسجيل مرتجع المشتريات.' : 'Purchase return recorded.');
        setSaving(false);
        return;
      }

      if (editingPurchaseId !== undefined) {
        if (!onEditPurchase) throw new Error(isRtl ? 'تعذر تعديل الشراء.' : 'Purchase editing is unavailable.');
        await onEditPurchase(editingPurchaseId, purchasePayload);
      } else {
        const res = await fetch('/api/purchases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(purchasePayload),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || (isRtl ? 'فشل تسجيل الشراء.' : 'Failed to record purchase entry.'));
        }
        if (Number.isInteger(Number(data.id)) && Number(data.id) > 0) {
          savedPurchaseId = Number(data.id);
        }
      }

      if (shouldPrint) {
        setPrintEntry({
          ...(savedPurchaseId ? { voucherId: savedPurchaseId } : {}),
          invoiceNumber: invoiceNumber.trim(),
          vendorName: vendors.find((vendor) => vendor.id === vendorId)?.name || '',
          receivedDate,
          paymentStatus,
          paidAmount,
          notes: notes.trim(),
          items: selectedItems.map((item) => {
            const product = products.find((candidate) => candidate.id === item.productId);
            const unit = getPurchaseUnit(product, item.unitId);
            return {
              name: (isRtl && product?.nameAr) || product?.name || '',
              sku: product?.sku || '',
              quantity: Number(item.quantity) || 0,
              unit: unit.name,
              unitCost: Number(item.unitCost) || 0,
              taxRate: Number(item.taxRate) || 0,
              total: (Number(item.quantity) || 0) * (Number(item.unitCost) || 0) * (1 + (Number(item.taxRate) || 0) / 100),
            };
          }),
          subtotal: formSubtotal,
          taxAmount: formTaxAmount,
          shippingCost: Number(shippingCost) || 0,
          total: purchaseTotal,
        });
      }

      await Promise.all([onRefreshPurchases(), onRefreshProducts()]);
      setInvoiceNumber('');
      setVendorId(0);
      setVendorSearch('');
      setVendorSearchOpen(false);
      receivedDateEditedRef.current = false;
      setReceivedDate(receivedDate);
      setShippingCost('');
      setIsPaid(false);
      setPartialPaymentAmount('');
      setNotes('');
      setBypassHighCostWarning(false);
      setItems(createPurchaseRows());
      setEditingPurchase(null);
      setProductSearchOpenRowId(null);
      setFormSuccess(
        editingPurchaseId !== undefined
          ? (isRtl ? 'تم تحديث الشراء والمخزون.' : 'Purchase updated and stock adjusted.')
          : (isRtl ? 'تم تسجيل المشتريات وتحديث المخزون.' : 'Purchase recorded and stock updated.')
      );
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const closeUnknownBarcodeDialog = (focusBarcode = true) => {
    setUnknownBarcode(null);
    if (focusBarcode) focusAvailableBarcode();
  };

  const createProductFromUnknownBarcode = () => {
    if (!unknownBarcode || !onAddProduct) {
      closeUnknownBarcodeDialog();
      return;
    }
    const barcode = unknownBarcode;
    closeUnknownBarcodeDialog(false);
    onAddProduct(barcode);
  };

  const handleUnknownBarcodeDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeUnknownBarcodeDialog();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (unknownBarcodeAction === 'create' && onAddProduct) {
        createProductFromUnknownBarcode();
      } else {
        closeUnknownBarcodeDialog();
      }
      return;
    }

    const cancelAction =
      event.key === 'ArrowUp' ||
      (event.key === 'ArrowLeft' && !isRtl) ||
      (event.key === 'ArrowRight' && isRtl);
    const createAction =
      event.key === 'ArrowDown' ||
      (event.key === 'ArrowRight' && !isRtl) ||
      (event.key === 'ArrowLeft' && isRtl);
    if (cancelAction) {
      event.preventDefault();
      cancelUnknownBarcodeButtonRef.current?.focus();
    } else if (createAction && onAddProduct) {
      event.preventDefault();
      createProductButtonRef.current?.focus();
    }
  };

  return (
    <div
      className={
        isCreatingPurchasePage
          ? 'flex-1 overflow-y-auto p-0 space-y-0 bg-slate-50'
          : 'flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6 bg-slate-50'
      }
    >
      {formSuccess && (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed top-4 z-[100] flex max-w-sm items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg ${
            isRtl ? 'left-4' : 'right-4'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{formSuccess}</span>
        </div>
      )}
      {!isCreatingPurchasePage && (
        <>
      {/* Main Table Container */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-3 sm:p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className={`w-4 h-4 text-slate-400 absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 pointer-events-none`} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}

                className={`w-full ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-blue-700`}
              />
            </div>

            <label className="sr-only" htmlFor="purchase-history-date-filter">
              {isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
            </label>
            <select
              id="purchase-history-date-filter"
              value={historyDateFilter}
              onChange={(event) => setHistoryDateFilter(event.target.value as DateFilter)}
              aria-label={isRtl ? 'تصفية حسب التاريخ' : 'Filter by date'}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 focus:border-blue-700 focus:outline-none sm:w-36 sm:flex-none"
            >
              <option value="ALL">{isRtl ? 'كل التواريخ' : 'All'}</option>
              <option value="TODAY">{isRtl ? 'اليوم' : 'Today'}</option>
              <option value="YESTERDAY">{isRtl ? 'أمس' : 'Yesterday'}</option>
              <option value="THIS_WEEK">{isRtl ? 'هذا الأسبوع' : 'This Week'}</option>
              <option value="THIS_MONTH">{isRtl ? 'هذا الشهر' : 'This Month'}</option>
              <option value="RANGE">{isRtl ? 'نطاق تاريخ' : 'Date Range'}</option>
            </select>
            {historyDateFilter === 'RANGE' && (
              <div className="flex min-w-0 flex-1 gap-2 sm:flex-none">
                <label className="sr-only" htmlFor="purchase-history-date-from">
                  {isRtl ? 'من تاريخ' : 'From date'}
                </label>
                <input
                  id="purchase-history-date-from"
                  type="date"
                  value={historyDateFrom}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setHistoryDateFrom(nextDate);
                    if (historyDateTo && nextDate && historyDateTo < nextDate) {
                      setHistoryDateTo('');
                    }
                  }}
                  aria-label={isRtl ? 'من تاريخ' : 'From date'}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 focus:border-blue-700 focus:outline-none sm:w-36 sm:flex-none"
                />
                <label className="sr-only" htmlFor="purchase-history-date-to">
                  {isRtl ? 'إلى تاريخ' : 'To date'}
                </label>
                <input
                  id="purchase-history-date-to"
                  type="date"
                  value={historyDateTo}
                  min={historyDateFrom || undefined}
                  onChange={(event) => setHistoryDateTo(event.target.value)}
                  aria-label={isRtl ? 'إلى تاريخ' : 'To date'}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 focus:border-blue-700 focus:outline-none sm:w-36 sm:flex-none"
                />
              </div>
            )}

            <label className="sr-only" htmlFor="purchase-history-vendor">
              {isRtl ? 'تصفية حسب المورد' : 'Filter by vendor'}
            </label>
            <select
              id="purchase-history-vendor"
              value={historyVendorFilter}
              onChange={(event) => setHistoryVendorFilter(event.target.value)}
              aria-label={isRtl ? 'تصفية حسب المورد' : 'Filter by vendor'}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700 focus:border-blue-700 focus:outline-none sm:w-40 sm:flex-none"
            >
              <option value="ALL">{isRtl ? 'كل الموردين' : 'All vendors'}</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {(isRtl && vendor.nameAr) || vendor.name}
                </option>
              ))}
            </select>

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
              onClick={openNewPurchasePage}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>{isRtl ? 'العودة إلى الشراء' : 'Back to Purchase'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Purchases Cards View (< md) */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredPurchases.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              {isRtl ? 'لا توجد أوامر شراء. اضغط "العودة إلى الشراء" لإضافة.' : 'No purchase orders recorded yet. Click "Back to Purchase" to receive stock.'}
            </div>
          ) : (
            filteredPurchases.map((p) => {
              return (
                <div key={p.id} className="space-y-1 border-b border-slate-100 p-3.5 text-xs last:border-0">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{isRtl ? 'التاريخ' : 'Date'}</span>
                    <span className="font-mono text-slate-700">{p.receivedDate}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{isRtl ? 'رقم السند' : 'Voucher #'}</span>
                    <span className="font-mono text-slate-700">{formatPurchaseVoucherNumber(p.id)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{isRtl ? 'رقم الفاتورة' : 'Invoice number'}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedPurchase(p)}
                      className="font-mono font-semibold text-blue-700 hover:underline"
                      title={isRtl ? 'عرض تفاصيل الشراء' : 'View purchase details'}
                    >
                      {p.invoiceNumber}
                    </button>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{isRtl ? 'المورد' : 'Supplier'}</span>
                    <span className="break-words text-slate-700">{p.vendorName}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{isRtl ? 'مبلغ الفاتورة' : 'Bill amount'}</span>
                    <span className="font-mono font-semibold text-slate-900">{c}{p.total.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{isRtl ? 'حالة الدفع' : 'Payment Status'}</span>
                    <span className={`font-medium ${
                      p.paymentStatus === 'PAID'
                        ? 'text-emerald-700'
                        : p.paymentStatus === 'PARTIAL'
                        ? 'text-amber-700'
                        : 'text-red-700'
                    }`}>
                      {p.paymentStatus === 'PAID'
                        ? (isRtl ? 'مدفوع' : 'Paid')
                        : p.paymentStatus === 'PARTIAL'
                        ? (isRtl ? 'جزئي' : 'Partial')
                        : (isRtl ? 'معلق' : 'Pending')}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{isRtl ? 'المبلغ المتبقي' : 'Balance amount'}</span>
                    <span className="font-mono text-slate-700">
                      {c}{getPurchaseBalance(p, purchaseReturnVouchers).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-end gap-2 border-t border-slate-100 pt-2">
                    {onEditPurchase && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(p)}
                        className="rounded border border-slate-200 p-1.5 text-slate-600 hover:border-amber-600 hover:text-amber-700"
                        title={isRtl ? 'تعديل الفاتورة' : 'Edit purchase'}
                        aria-label={isRtl ? 'تعديل الفاتورة' : 'Edit purchase'}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {onDeletePurchase && (
                      <button
                        type="button"
                        onClick={() => {
                          setPurchaseActionError(null);
                          setDeletingPurchaseId(p.id);
                        }}
                        className="rounded border border-slate-200 p-1.5 text-slate-500 hover:border-red-600 hover:bg-red-50 hover:text-red-700"
                        title={isRtl ? 'حذف أمر الشراء' : 'Delete purchase'}
                        aria-label={isRtl ? 'حذف أمر الشراء' : 'Delete purchase'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
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
                <th className="py-2.5 px-4">{isRtl ? 'التاريخ' : 'Date'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'رقم السند' : 'Voucher #'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'رقم الفاتورة' : 'Invoice number'}</th>
                <th className="min-w-[240px] py-2.5 px-4">{isRtl ? 'المورد' : 'Supplier'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'مبلغ الفاتورة' : 'Bill amount'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'حالة الدفع' : 'Payment Status'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'المبلغ المتبقي' : 'Balance amount'}</th>
                <th className="py-2.5 px-2 text-center">{isRtl ? 'تعديل' : 'Edit'}</th>
                <th className="py-2.5 px-2 text-center">{isRtl ? 'حذف' : 'Delete'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    {isRtl ? 'لا توجد أوامر شراء. اضغط "العودة إلى الشراء" لإضافة.' : 'No purchase orders recorded yet. Click "Back to Purchase" to receive stock.'}
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {p.receivedDate}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {formatPurchaseVoucherNumber(p.id)}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedPurchase(p)}
                        className="text-blue-700 hover:underline"
                        title={isRtl ? 'عرض تفاصيل الشراء' : 'View purchase details'}
                      >
                        {p.invoiceNumber}
                      </button>
                    </td>
                    <td className="min-w-[240px] py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {p.vendorName}
                    </td>
                    <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} font-mono font-semibold text-slate-900 whitespace-nowrap tabular-nums`}>
                      {c}{p.total.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`font-medium ${
                        p.paymentStatus === 'PAID'
                          ? 'text-emerald-700'
                          : p.paymentStatus === 'PARTIAL'
                          ? 'text-amber-700'
                          : 'text-red-700'
                      }`}>
                        {p.paymentStatus === 'PAID'
                          ? (isRtl ? 'مدفوع بالكامل' : 'Paid in Full')
                          : p.paymentStatus === 'PARTIAL'
                          ? (isRtl ? 'مدفوع جزئياً' : 'Partially Paid')
                          : (isRtl ? 'معلق' : 'Pending')}
                      </span>
                    </td>
                    <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} font-mono text-slate-700 whitespace-nowrap tabular-nums`}>
                      {c}{getPurchaseBalance(p, purchaseReturnVouchers).toFixed(2)}
                    </td>
                    <td className="px-2 py-3 text-center">
                      {onEditPurchase && (
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(p)}
                          className="rounded border border-slate-200 p-1.5 text-slate-500 hover:border-amber-600 hover:bg-amber-50 hover:text-amber-700"
                          title={isRtl ? 'تعديل الفاتورة' : 'Edit purchase'}
                          aria-label={isRtl ? 'تعديل الفاتورة' : 'Edit purchase'}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center">
                      {onDeletePurchase && (
                        <button
                          type="button"
                          onClick={() => {
                            setPurchaseActionError(null);
                            setDeletingPurchaseId(p.id);
                          }}
                          className="rounded border border-slate-200 p-1.5 text-slate-500 hover:border-red-600 hover:bg-red-50 hover:text-red-700"
                          title={isRtl ? 'حذف أمر الشراء' : 'Delete purchase'}
                          aria-label={isRtl ? 'حذف أمر الشراء' : 'Delete purchase'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {isCreatingPurchasePage && (
        <section className="mx-auto w-full max-w-[1440px] border-y border-slate-200 bg-white">
            <div
              className="shrink-0 flex flex-wrap items-end gap-2 border-b border-slate-200 px-3 py-2 sm:px-4 sm:py-3"
              onChange={() => { saveAndPrintRef.current = false; }}
            >
                <div className="relative min-w-[180px] max-w-[260px] flex-1 basis-[220px]">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor="purchase-vendor-search" className="text-[11px] font-medium text-slate-700">
                      {isPurchaseReturnMode
                        ? (isRtl ? 'المورد *' : 'Supplier *')
                        : (isRtl ? 'المورد *' : 'Vendor *')}
                    </label>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setIsCreatingVendor(true)}
                      className="shrink-0 text-[11px] text-blue-700 hover:underline"
                    >
                      {isRtl ? '+ إنشاء مورد' : '+ Create Vendor'}
                    </button>
                  </div>
                  <input
                    id="purchase-vendor-search"
                    form="purchase-entry-form"
                    type="text"
                    required
                    autoComplete="off"
                    value={
                      vendorSearchOpen
                        ? vendorSearch
                        : vendors.find((vendor) => vendor.id === vendorId)?.name || vendorSearch
                    }
                    onFocus={() => {
                      setVendorSearch('');
                      setVendorSearchOpen(true);
                      setVendorSelectedIndex(-1);
                    }}
                    onBlur={() => setVendorSearchOpen(false)}
                    onChange={(event) => {
                      setVendorSearch(event.target.value);
                      setVendorId(0);
                      setVendorSearchOpen(true);
                      setVendorSelectedIndex(-1);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' && filteredVendors.length > 0) {
                        event.preventDefault();
                        setVendorSelectedIndex((index) => (index + 1) % filteredVendors.length);
                      } else if (event.key === 'ArrowUp' && filteredVendors.length > 0) {
                        event.preventDefault();
                        setVendorSelectedIndex((index) =>
                          index < 0 ? filteredVendors.length - 1 : (index - 1 + filteredVendors.length) % filteredVendors.length
                        );
                      } else if (event.key === 'Enter' && vendorSearchOpen) {
                        event.preventDefault();
                        const selectedVendor = filteredVendors[vendorSelectedIndex] || filteredVendors[0];
                        if (selectedVendor) selectVendor(selectedVendor);
                      } else if (event.key === 'Escape' && vendorSearchOpen) {
                        event.preventDefault();
                        setVendorSearchOpen(false);
                      }
                    }}

                    aria-label={isRtl ? 'ابحث عن مورد' : 'Search vendors'}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={vendorSearchOpen}
                    aria-controls="purchase-vendor-options"
                    aria-activedescendant={
                      vendorSearchOpen && filteredVendors[vendorSelectedIndex]
                        ? `purchase-vendor-option-${filteredVendors[vendorSelectedIndex].id}`
                        : undefined
                    }
                    className="w-full rounded-md px-3 py-2 border border-slate-200 text-xs text-slate-900 bg-white focus:outline-none focus:border-blue-700"
                  />
                  {vendorSearchOpen && (
                    <div className="absolute inset-x-0 top-full z-30 max-h-56 overflow-y-auto border border-slate-200 bg-white shadow-lg">
                      {filteredVendors.length === 0 ? (
                        <div id="purchase-vendor-options" className="p-2 text-center text-[11px] text-slate-500">
                          {isRtl ? 'لا يوجد مورد مطابق' : 'No matching vendors'}
                        </div>
                      ) : (
                        <div id="purchase-vendor-options" role="listbox">
                          {filteredVendors.map((vendor, index) => (
                            <button
                              id={`purchase-vendor-option-${vendor.id}`}
                              key={vendor.id}
                              type="button"
                              role="option"
                              aria-selected={index === vendorSelectedIndex}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setVendorSelectedIndex(index)}
                              onClick={() => selectVendor(vendor)}
                              className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-xs text-slate-900 last:border-b-0 ${
                                index === vendorSelectedIndex ? 'bg-blue-100' : 'hover:bg-blue-50'
                              }`}
                            >
                              <span className="block truncate font-medium">
                                {isRtl && vendor.nameAr ? vendor.nameAr : vendor.name}
                              </span>
                              {vendor.contactPerson && (
                                <span className="block truncate text-[10px] text-slate-500">
                                  {vendor.contactPerson}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="w-[150px] shrink-0">
                  <label htmlFor="purchase-invoice-number" className="mb-1 block text-[11px] font-medium text-slate-700">
                    {isPurchaseReturnMode
                      ? (isRtl ? 'فاتورة الشراء *' : 'Purchase Invoice *')
                      : (isRtl ? 'رقم الفاتورة *' : 'Invoice Number *')}
                  </label>
                  <input
                    id="purchase-invoice-number"
                    ref={invoiceNumberInputRef}
                    form="purchase-entry-form"
                    type="text"
                    required
                    value={invoiceNumber}
                    onChange={(event) => {
                      const nextInvoiceNumber = event.target.value;
                      setInvoiceNumber(nextInvoiceNumber);
                      if (isPurchaseReturnMode) {
                        const purchase = purchases.find(
                          (candidate) =>
                            candidate.invoiceNumber.toLocaleLowerCase() === nextInvoiceNumber.trim().toLocaleLowerCase() &&
                            (!vendorId || candidate.vendorId === vendorId)
                        );
                        if (purchase) clonePurchaseForReturn(purchase);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        receivedDateInputRef.current?.focus();
                      }
                    }}

                    className="w-full rounded-md px-3 py-2 font-mono border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="w-[130px] shrink-0">
                  <label htmlFor="purchase-received-date" className="mb-1 block text-[11px] font-medium text-slate-700">
                    {isPurchaseReturnMode
                      ? (isRtl ? 'تاريخ المرتجع' : 'Return Date')
                      : (isRtl ? 'تاريخ الاستلام' : 'Date Received')}
                  </label>
                  <input
                    id="purchase-received-date"
                    ref={receivedDateInputRef}
                    form="purchase-entry-form"
                    type="date"
                    required
                    value={receivedDate}
                    onChange={(event) => {
                      receivedDateEditedRef.current = true;
                      setReceivedDate(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        const firstRow = items[0];
                        if (firstRow) barcodeInputRefs.current.get(firstRow.rowId)?.focus();
                      }
                    }}
                    className="w-full rounded-md px-3 py-2 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div className="ml-auto flex items-end justify-end gap-1.5">
                  {editingPurchase && (
                    <span className="hidden whitespace-nowrap rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-800 sm:inline">
                      {isRtl ? 'تعديل' : 'Editing'} {formatPurchaseVoucherNumber(editingPurchase.id)}
                    </span>
                  )}
                <button
                  type="submit"
                  form="purchase-entry-form"
                  tabIndex={-1}
                  disabled={saving}
                  title={isPurchaseReturnMode
                    ? (isRtl ? 'حفظ مرتجع المشتريات (Alt+S)' : 'Save purchase return (Alt+S)')
                    : (isRtl ? 'حفظ الشراء (Alt+S)' : 'Save purchase (Alt+S)')}
                  onClick={() => { saveAndPrintRef.current = false; }}
                  className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-xs font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 sm:w-auto lg:px-3"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {saving
                      ? (isPurchaseReturnMode
                          ? (isRtl ? 'جاري حفظ المرتجع...' : 'Saving return...')
                          : (isRtl ? 'جاري الحفظ...' : 'Saving...'))
                      : editingPurchase
                        ? (isRtl ? 'تحديث' : 'Update')
                        : isPurchaseReturnMode
                          ? (isRtl ? 'حفظ المرتجع' : 'Save Return')
                          : (isRtl ? 'حفظ' : 'Save')}
                  </span>
                </button>
                {!isPurchaseReturnMode && (
                  <button
                    type="submit"
                    form="purchase-entry-form"
                    tabIndex={-1}
                    disabled={saving}
                    onClick={() => { saveAndPrintRef.current = true; }}
                    className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 sm:w-auto lg:px-3"
                  >
                    <Printer className="w-4 h-4" />
                    <span>{isRtl ? 'طباعة' : 'Print'}</span>
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={saving}
                  onClick={clearPurchaseDraft}
                  className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-red-200 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 sm:w-auto lg:px-3"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>{isRtl ? 'مسح' : 'Clear'}</span>
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => onNavigatePage('history')}
                  className="inline-flex w-20 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 sm:w-20 lg:px-2"
                >
                  <Clock className="h-3.5 w-3.5" />
                  {isRtl ? 'السجل' : 'History'}
                </button>
                <label
                  title={
                    isRtl
                      ? 'تجاوز تنبيه التكلفة المرتفعة مع إبقاء تكلفة المنتج الحالية'
                      : 'Skip high-cost warnings and keep current product costs'
                  }
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] text-slate-600"
                >
                  <input
                    type="checkbox"
                    checked={bypassHighCostWarning}
                    onChange={(event) => {
                      const shouldBypass = event.target.checked;
                      setBypassHighCostWarning(shouldBypass);
                    }}
                    className="h-3 w-3 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span>{isRtl ? 'تجاوز' : 'Bypass'}</span>
                </label>
              </div>
            </div>

            <form
              id="purchase-entry-form"
              onSubmit={handleSubmit}
              onChange={() => { saveAndPrintRef.current = false; }}
              className="grid grid-cols-1 gap-3 p-3 text-xs sm:p-4"
            >
              {formError && (
                <div className="shrink-0 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}
              <div className="min-w-0">
                <div className="max-h-[min(75vh,560px)] overflow-auto overscroll-contain border-y border-slate-200">
                  <table
                    ref={purchaseGridTableRef}
                    style={{ width: purchaseGridWidth, minWidth: purchaseGridWidth }}
                    className={`table-fixed border-collapse ${isRtl ? 'text-right' : 'text-left'}`}
                  >
                    <colgroup>
                      <col style={{ width: 48 }} />
                      <col data-purchase-column="barcode" style={{ width: columnWidths.barcode }} />
                      <col data-purchase-column="name" style={{ width: columnWidths.name }} />
                      <col data-purchase-column="quantity" style={{ width: columnWidths.quantity }} />
                      <col data-purchase-column="unit" style={{ width: columnWidths.unit }} />
                      <col data-purchase-column="rate" style={{ width: columnWidths.rate }} />
                      <col data-purchase-column="subtotal" style={{ width: columnWidths.subtotal }} />
                      <col data-purchase-column="taxRate" style={{ width: columnWidths.taxRate }} />
                      <col data-purchase-column="tax" style={{ width: columnWidths.tax }} />
                      <col data-purchase-column="lastPurchaseCost" style={{ width: columnWidths.lastPurchaseCost }} />
                      <col data-purchase-column="sellingPrice" style={{ width: columnWidths.sellingPrice }} />
                      <col data-purchase-column="stock" style={{ width: columnWidths.stock }} />
                      <col data-purchase-column="total" style={{ width: columnWidths.total }} />
                      <col data-purchase-column="delete" style={{ width: columnWidths.delete }} />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold text-slate-600">
                      <tr>
                        <th className="border border-slate-300 px-1 py-2 text-center">{isRtl ? 'رقم' : 'Sl no'}</th>
                        <th
                          draggable
                          data-purchase-column="barcode"
                          onDragStart={() => draggingPurchaseColumnRef.current = 'barcode'}
                          onDragOver={(event) => event.preventDefault()}
                          onDragEnter={(event) => event.preventDefault()}
                          onDragEnd={() => draggingPurchaseColumnRef.current = null}
                          onDrop={(event) => { event.preventDefault(); movePurchaseColumn('barcode'); }}
                          className="relative cursor-move border border-slate-300 px-2 py-2"
                        >
                          {isRtl ? 'الباركود' : 'Barcode'}
                          {renderColumnResizeHandle('barcode', isRtl ? 'الباركود' : 'Barcode')}
                        </th>
                        <th draggable data-purchase-column="name" onDragStart={() => draggingPurchaseColumnRef.current = 'name'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('name'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2">
                          {isRtl ? 'اسم الصنف' : 'Name'}
                          {renderColumnResizeHandle('name', isRtl ? 'اسم الصنف' : 'Name')}
                        </th>
                        <th draggable data-purchase-column="quantity" onDragStart={() => draggingPurchaseColumnRef.current = 'quantity'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('quantity'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2">
                          {isRtl ? 'الكمية' : 'Quantity'}
                          {renderColumnResizeHandle('quantity', isRtl ? 'الكمية' : 'Quantity')}
                        </th>
                        <th draggable data-purchase-column="unit" onDragStart={() => draggingPurchaseColumnRef.current = 'unit'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('unit'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2">
                          {isRtl ? 'الوحدة' : 'Unit'}
                          {renderColumnResizeHandle('unit', isRtl ? 'الوحدة' : 'Unit')}
                        </th>
                        <th draggable data-purchase-column="rate" onDragStart={() => draggingPurchaseColumnRef.current = 'rate'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('rate'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2">
                          {isRtl ? 'السعر' : 'Rate'}
                          {renderColumnResizeHandle('rate', isRtl ? 'السعر' : 'Rate')}
                        </th>
                        <th draggable data-purchase-column="subtotal" onDragStart={() => draggingPurchaseColumnRef.current = 'subtotal'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('subtotal'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2 text-right">
                          {isRtl ? 'المجموع الفرعي' : 'Subtotal'}
                          {renderColumnResizeHandle('subtotal', isRtl ? 'المجموع الفرعي' : 'Subtotal')}
                        </th>
                        <th draggable data-purchase-column="taxRate" onDragStart={() => draggingPurchaseColumnRef.current = 'taxRate'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('taxRate'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2">
                          {isRtl ? 'الضريبة %' : 'Tax %'}
                          {renderColumnResizeHandle('taxRate', isRtl ? 'الضريبة' : 'Tax')}
                        </th>
                        <th draggable data-purchase-column="tax" onDragStart={() => draggingPurchaseColumnRef.current = 'tax'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('tax'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2 text-right">
                          {isRtl ? 'الضريبة' : 'Tax'}
                          {renderColumnResizeHandle('tax', isRtl ? 'الضريبة' : 'Tax Amount')}
                        </th>
                        <th draggable data-purchase-column="lastPurchaseCost" onDragStart={() => draggingPurchaseColumnRef.current = 'lastPurchaseCost'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('lastPurchaseCost'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2 text-right">
                          LPC
                          {renderColumnResizeHandle('lastPurchaseCost', isRtl ? 'آخر تكلفة شراء' : 'Last Purchase Cost')}
                        </th>
                        <th draggable data-purchase-column="sellingPrice" onDragStart={() => draggingPurchaseColumnRef.current = 'sellingPrice'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('sellingPrice'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2 text-right">
                          {isRtl ? 'سعر البيع' : 'Selling Price'}
                          {renderColumnResizeHandle('sellingPrice', isRtl ? 'سعر البيع' : 'Selling Price')}
                        </th>
                        <th draggable data-purchase-column="stock" onDragStart={() => draggingPurchaseColumnRef.current = 'stock'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('stock'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2 text-right">
                          {isRtl ? 'المخزون' : 'Stock'}
                          {renderColumnResizeHandle('stock', isRtl ? 'المخزون' : 'Stock')}
                        </th>
                        <th draggable data-purchase-column="total" onDragStart={() => draggingPurchaseColumnRef.current = 'total'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('total'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2 text-right">
                          {isRtl ? 'الإجمالي' : 'Total'}
                          {renderColumnResizeHandle('total', isRtl ? 'الإجمالي' : 'Total')}
                        </th>
                        <th draggable data-purchase-column="delete" onDragStart={() => draggingPurchaseColumnRef.current = 'delete'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); movePurchaseColumn('delete'); }} onDragEnd={() => draggingPurchaseColumnRef.current = null} className="relative cursor-move border border-slate-300 px-2 py-2 text-center">
                          {isRtl ? 'حذف' : 'Delete'}
                          {renderColumnResizeHandle('delete', isRtl ? 'حذف' : 'Delete')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      {items.map((item, index) => {
                        const product = item.productId
                          ? products.find((candidate) => candidate.id === item.productId)
                          : undefined;
                        const matchingProducts = matchingProductsForRow(item);
                        const nameQuery = item.productSearch.trim().toLowerCase();
                        const barcodeQuery = item.barcodeSearch.trim().toLowerCase();
                        const exactBarcodeMatch = findProductBarcodeMatch(products, barcodeQuery);
                        const lastPurchaseCost = product ? lastPurchaseCosts.get(product.id)?.unitCost : undefined;
                        const purchaseUnit = getPurchaseUnit(product, item.unitId);
                        const currentUnitCost = getPurchaseUnitCost(product, item.unitId);
                        const rateExceedsSellingPrice =
                          item.unitCost !== '' &&
                          purchaseUnit.sellingPrice !== undefined &&
                          Number(item.unitCost) * (1 + (Number(item.taxRate) || 0) / 100) >
                            purchaseUnit.sellingPrice;
                        const rateAboveCurrentCost =
                          item.unitCost !== '' &&
                          currentUnitCost !== undefined &&
                          Number(item.unitCost) > currentUnitCost &&
                          !rateExceedsSellingPrice;
                        const rateBelowCurrentCost =
                          item.unitCost !== '' &&
                          currentUnitCost !== undefined &&
                          Number(item.unitCost) < currentUnitCost &&
                          !rateExceedsSellingPrice;
                        const rateCellBackgroundClass = rateExceedsSellingPrice
                          ? 'bg-red-50'
                          : rateAboveCurrentCost
                            ? 'bg-amber-50'
                            : rateBelowCurrentCost
                              ? 'bg-emerald-50'
                              : '';
                        const lineSubtotal =
                          product && item.quantity !== '' && item.unitCost !== ''
                            ? Number(item.quantity) * Number(item.unitCost)
                            : null;
                        const lineTotal =
                          lineSubtotal === null
                            ? null
                            : lineSubtotal * (1 + (Number(item.taxRate) || 0) / 100);
                        return (
                          <tr
                            key={item.rowId}
                            onKeyDown={(event) => navigatePurchaseGrid(index, event)}
                            className="hover:bg-slate-50/60"
                          >
                            <td
                              data-purchase-column="serial"
                              className={`border border-slate-300 px-2 py-1 text-center text-[10px] text-slate-400 ${
                                product ? 'cursor-pointer hover:bg-blue-50' : ''
                              }`}
                              onDoubleClick={() => {
                                if (product) onEditProduct?.(product);
                              }}
                            >
                              {index + 1}
                            </td>
                            <td data-purchase-column="barcode" className="border border-slate-300 p-0">
                              <div className="relative w-full min-w-0">
                                <input
                                  data-purchase-grid-cell
                                  ref={(element) => {
                                    if (element) barcodeInputRefs.current.set(item.rowId, element);
                                    else barcodeInputRefs.current.delete(item.rowId);
                                  }}
                                  type="text"
                                  disabled={!product && index !== firstEmptyPurchaseRowIndex}
                                  value={item.barcodeSearch}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) =>
                                    updateItemRow(index, {
                                      productId: 0,
                                      barcodeSearch: event.target.value,
                                      productSearch: '',
                                      selectedProductIndex: 0,
                                    })
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      if (exactBarcodeMatch) {
                                        selectProductForRow(
                                          index,
                                          exactBarcodeMatch.product,
                                          exactBarcodeMatch.unitId,
                                          item.barcodeSearch.trim()
                                        );
                                      } else if (item.barcodeSearch.trim()) {
                                        setUnknownBarcode(item.barcodeSearch.trim());
                                      } else {
                                        productSearchInputRefs.current.get(item.rowId)?.focus();
                                      }
                                    }
                                  }}
                                  aria-label={isRtl ? 'امسح أو ابحث عن باركود' : 'Scan or search barcode'}

                                  className="w-full rounded-none border-0 bg-transparent px-2 py-2 font-mono text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                                />
                              </div>
                            </td>
                            <td data-purchase-column="name" className="border border-slate-300 p-0">
                              <div
                                ref={(element) => {
                                  if (element) productSearchContainerRefs.current.set(item.rowId, element);
                                  else productSearchContainerRefs.current.delete(item.rowId);
                                }}
                                className="relative w-full min-w-0"
                              >
                                <input
                                  data-purchase-grid-cell
                                  ref={(element) => {
                                    if (element) productSearchInputRefs.current.set(item.rowId, element);
                                    else productSearchInputRefs.current.delete(item.rowId);
                                  }}
                                  type="text"
                                  disabled={!product && index !== firstEmptyPurchaseRowIndex}
                                  value={item.productSearch}
                                  onFocus={(event) => {
                                    event.currentTarget.select();
                                    if (item.productSearch.trim()) {
                                      setProductSearchOpenRowId(item.rowId);
                                    }
                                  }}
                                  onBlur={() => setProductSearchOpenRowId(null)}
                                  onChange={(event) => {
                                    setProductSearchOpenRowId(
                                      event.target.value.trim() ? item.rowId : null
                                    );
                                    updateItemRow(index, {
                                      productId: 0,
                                      barcodeSearch: '',
                                      productSearch: event.target.value,
                                      selectedProductIndex: 0,
                                    });
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'ArrowDown' && matchingProducts.length > 0) {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      updateItemRow(index, {
                                        selectedProductIndex: (item.selectedProductIndex + 1) % matchingProducts.length,
                                      });
                                    } else if (event.key === 'ArrowUp' && matchingProducts.length > 0) {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      updateItemRow(index, {
                                        selectedProductIndex: (item.selectedProductIndex - 1 + matchingProducts.length) % matchingProducts.length,
                                      });
                                    } else if (event.key === 'Enter') {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      const selectedProduct =
                                        products.find((candidate) => candidate.sku && candidate.sku.toLowerCase() === nameQuery) ||
                                        matchingProducts[item.selectedProductIndex];
                                      if (selectedProduct) selectProductForRow(index, selectedProduct);
                                    }
                                  }}
                                  aria-label={isRtl ? 'ابحث عن اسم الصنف' : 'Search product name'}

                                  className="w-full rounded-none border-0 bg-transparent px-2 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                                />
                                {!item.productId &&
                                  item.productSearch &&
                                  productSearchOpenRowId === item.rowId && (
                                  <div className={`absolute ${isRtl ? 'right-0' : 'left-0'} top-full z-30 box-border w-[min(760px,94vw)] max-h-[min(75vh,560px)] overflow-y-auto rounded border border-slate-200 bg-white shadow-lg`}>
                                    {matchingProducts.length === 0 ? (
                                      <div className="p-2 text-center text-[10px] text-slate-500">
                                        {isRtl ? 'لا توجد أصناف مطابقة' : 'No matching products'}
                                      </div>
                                    ) : matchingProducts.map((match, matchIndex) =>
                                      renderProductSuggestion(match, matchIndex, index, item.selectedProductIndex)
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td data-purchase-column="quantity" className="border border-slate-300 p-0">
                              <input
                                data-purchase-grid-cell
                                ref={(element) => {
                                  if (element) quantityInputRefs.current.set(item.rowId, element);
                                  else quantityInputRefs.current.delete(item.rowId);
                                }}
                                type="number"
                                min={0}
                                required
                                step="any"
                                disabled={!product}
                                value={
                                  item.quantity === ''
                                    ? ''
                                    : focusedPurchaseNumber?.rowId === item.rowId &&
                                        focusedPurchaseNumber.field === 'quantity'
                                      ? item.quantity
                                      : item.quantity.toFixed(decimalPlaces)
                                }
                                onFocus={(e) => {
                                  setFocusedPurchaseNumber({ rowId: item.rowId, field: 'quantity' });
                                  e.currentTarget.select();
                                }}
                                onBlur={() => setFocusedPurchaseNumber(null)}
                                onClick={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (item.quantity === '' || Number(item.quantity) <= 0) {
                                      e.currentTarget.focus();
                                      return;
                                    }
                                    unitInputRefs.current.get(item.rowId)?.focus();
                                  }
                                }}
                                onChange={(e) => {
                                  const quantity = e.target.value === '' ? '' : Number(e.target.value);
                                  updateItemRow(index, { quantity });
                                }}
                                className="purchase-entry-number-input w-full rounded-none border-0 bg-transparent px-2 py-2 font-mono text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                              />
                            </td>
                            <td data-purchase-column="unit" className="border border-slate-300 p-0">
                              <button
                                data-purchase-grid-cell
                                ref={(element) => {
                                  if (element) unitInputRefs.current.set(item.rowId, element);
                                  else unitInputRefs.current.delete(item.rowId);
                                }}
                                type="button"
                                disabled={!product}
                                tabIndex={0}
                                onClick={() => handlePurchaseUnitClick(index)}
                                onDoubleClick={() => {
                                  if (product) handleOpenProductHistory(product);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === ' ') {
                                    e.preventDefault();
                                    cyclePurchaseUnit(index);
                                  }
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    costInputRefs.current.get(item.rowId)?.focus();
                                  }
                                }}
                                aria-label={
                                  isRtl
                                    ? 'وحدة المنتج، اضغط المسافة للتبديل أو انقر مرتين لعرض سجل المنتج'
                                    : 'Product unit; press Space to switch units or double-click to view product history'
                                }
                                title={isRtl ? 'انقر مرتين لعرض سجل المنتج' : 'Double-click to view product history'}
                                className="w-full rounded-none border-0 bg-transparent px-2 py-2 text-left text-slate-600 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                              >
                                {purchaseUnit.name}
                              </button>
                            </td>
                            <td data-purchase-column="rate" className={`border border-slate-300 p-0 ${rateCellBackgroundClass}`}>
                              <div>
                                <input
                                  data-purchase-grid-cell
                                  ref={(element) => {
                                    if (element) costInputRefs.current.set(item.rowId, element);
                                    else costInputRefs.current.delete(item.rowId);
                                  }}
                                  type="number"
                                  min={0}
                                  step="any"
                                  disabled={!product}
                                  value={
                                    item.unitCost === ''
                                      ? ''
                                      : focusedPurchaseNumber?.rowId === item.rowId &&
                                          focusedPurchaseNumber.field === 'unitCost'
                                        ? item.unitCost
                                        : item.unitCost.toFixed(decimalPlaces)
                                  }
                                  onFocus={(e) => {
                                    setFocusedPurchaseNumber({ rowId: item.rowId, field: 'unitCost' });
                                    e.currentTarget.select();
                                  }}
                                  onClick={(e) => e.currentTarget.select()}
                                  onBlur={(e) => {
                                    setFocusedPurchaseNumber(null);
                                    checkSellingPriceWarning(
                                      item.rowId,
                                      product,
                                      item.unitId,
                                      Number(e.currentTarget.value),
                                      Number(item.taxRate) || 0
                                    );
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      taxInputRefs.current.get(item.rowId)?.focus();
                                    }
                                  }}
                                  onChange={(e) => {
                                    pendingRateWarningRowsRef.current.add(item.rowId);
                                    updateItemRow(index, {
                                      unitCost: e.target.value === '' ? '' : Number(e.target.value),
                                    });
                                  }}
                                  aria-invalid={rateExceedsSellingPrice}
                                  className={`purchase-entry-number-input w-full rounded-none border-0 bg-transparent px-2 py-2 font-mono text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600 ${
                                    rateExceedsSellingPrice
                                      ? 'text-red-800'
                                      : rateAboveCurrentCost
                                        ? 'text-amber-900'
                                        : rateBelowCurrentCost
                                          ? 'text-emerald-800'
                                          : ''
                                  }`}
                                />
                              </div>
                            </td>
                            <td data-purchase-column="subtotal" className="border border-slate-300 p-0 text-right">
                              <input
                                data-purchase-grid-cell
                                type="number"
                                min={0}
                                step="any"
                                disabled={!product || Number(item.quantity) <= 0}
                                value={
                                  focusedPurchaseNumber?.rowId === item.rowId &&
                                  focusedPurchaseNumber.field === 'subtotal'
                                    ? focusedPurchaseNumber.value ?? ''
                                    : lineSubtotal === null
                                      ? ''
                                      : lineSubtotal.toFixed(decimalPlaces)
                                }
                                onFocus={(e) => {
                                  setFocusedPurchaseNumber({
                                    rowId: item.rowId,
                                    field: 'subtotal',
                                    value: lineSubtotal?.toFixed(decimalPlaces) ?? '',
                                  });
                                  e.currentTarget.select();
                                }}
                                onBlur={(e) => {
                                  setFocusedPurchaseNumber(null);
                                  const quantity = Number(item.quantity);
                                  const amount = Number(e.currentTarget.value);
                                  checkSellingPriceWarning(
                                    item.rowId,
                                    product,
                                    item.unitId,
                                    quantity > 0 ? amount / quantity : Number.NaN,
                                    Number(item.taxRate) || 0
                                  );
                                }}
                                onChange={(e) => {
                                  const value = e.currentTarget.value;
                                  setFocusedPurchaseNumber({
                                    rowId: item.rowId,
                                    field: 'subtotal',
                                    value,
                                  });
                                  if (value === '') {
                                    pendingRateWarningRowsRef.current.delete(item.rowId);
                                    updateItemRow(index, { unitCost: '' });
                                    return;
                                  }
                                  const amount = Number(value);
                                  const quantity = Number(item.quantity);
                                  if (Number.isFinite(amount) && amount >= 0 && quantity > 0) {
                                    pendingRateWarningRowsRef.current.add(item.rowId);
                                    updateItemRow(index, { unitCost: amount / quantity });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    taxInputRefs.current.get(item.rowId)?.focus();
                                  }
                                }}
                                aria-label={isRtl ? 'المجموع الفرعي بدون ضريبة' : 'Subtotal before tax'}
                                className="purchase-entry-number-input w-full rounded-none border-0 bg-transparent px-2 py-2 text-right font-mono tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td data-purchase-column="taxRate" className="border border-slate-300 p-0">
                              <span
                                data-purchase-grid-cell
                                ref={(element) => {
                                  if (element) taxInputRefs.current.set(item.rowId, element);
                                  else taxInputRefs.current.delete(item.rowId);
                                }}
                                tabIndex={product ? 0 : -1}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    totalInputRefs.current.get(item.rowId)?.focus();
                                  }
                                }}
                                aria-label={isRtl ? 'معدل الضريبة' : 'Tax rate'}
                                className="block w-full cursor-default select-none px-2 py-2 font-mono text-right tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600"
                              >
                                {item.taxRate === '' ? '' : Number(item.taxRate).toFixed(decimalPlaces)}
                              </span>
                            </td>
                            <td data-purchase-column="tax" className="border border-slate-300 p-0 text-right">
                              <span data-purchase-grid-cell tabIndex={product ? 0 : -1} className="block px-2 py-2 font-mono tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600">
                                {product && item.quantity !== '' && item.unitCost !== ''
                                  ? (((Number(item.quantity) || 0) * (Number(item.unitCost) || 0) * (Number(item.taxRate) || 0)) / 100).toFixed(decimalPlaces)
                                  : ''}
                              </span>
                            </td>
                            <td data-purchase-column="lastPurchaseCost" className="border border-slate-300 p-0 text-right">
                              <span data-purchase-grid-cell tabIndex={product ? 0 : -1} className="block px-2 py-2 font-mono tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600">
                                {lastPurchaseCost === undefined ? '' : (lastPurchaseCost * purchaseUnit.unitsPerBase).toFixed(decimalPlaces)}
                              </span>
                            </td>
                            <td data-purchase-column="sellingPrice" className="border border-slate-300 p-0 text-right">
                              <span data-purchase-grid-cell tabIndex={product ? 0 : -1} className="block px-2 py-2 font-mono tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600">
                                {purchaseUnit.sellingPrice === undefined ? '' : purchaseUnit.sellingPrice.toFixed(decimalPlaces)}
                              </span>
                            </td>
                            <td data-purchase-column="stock" className="border border-slate-300 p-0 text-right">
                              <span data-purchase-grid-cell tabIndex={product ? 0 : -1} className="block px-2 py-2 font-mono tabular-nums text-slate-700 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-600">
                                {product ? product.stock.toFixed(decimalPlaces) : ''}
                              </span>
                            </td>
                            <td data-purchase-column="total" className="border border-slate-300 p-0 text-right">
                              <input
                                data-purchase-grid-cell
                                ref={(element) => {
                                  if (element) totalInputRefs.current.set(item.rowId, element);
                                  else totalInputRefs.current.delete(item.rowId);
                                }}
                                type="number"
                                min={0}
                                step="any"
                                disabled={!product || Number(item.quantity) <= 0}
                                value={
                                  focusedPurchaseNumber?.rowId === item.rowId &&
                                  focusedPurchaseNumber.field === 'total'
                                    ? focusedPurchaseNumber.value ?? ''
                                    : lineTotal === null
                                      ? ''
                                      : lineTotal.toFixed(decimalPlaces)
                                }
                                onFocus={(e) => {
                                  setFocusedPurchaseNumber({
                                    rowId: item.rowId,
                                    field: 'total',
                                    value: lineTotal?.toFixed(decimalPlaces) ?? '',
                                  });
                                  e.currentTarget.select();
                                }}
                                onBlur={(e) => {
                                  setFocusedPurchaseNumber(null);
                                  const quantity = Number(item.quantity);
                                  const amount = Number(e.currentTarget.value);
                                  const taxMultiplier = 1 + (Number(item.taxRate) || 0) / 100;
                                  checkSellingPriceWarning(
                                    item.rowId,
                                    product,
                                    item.unitId,
                                    quantity > 0 && taxMultiplier > 0
                                      ? amount / (quantity * taxMultiplier)
                                      : Number.NaN,
                                    Number(item.taxRate) || 0
                                  );
                                }}
                                onChange={(e) => {
                                  const value = e.currentTarget.value;
                                  setFocusedPurchaseNumber({
                                    rowId: item.rowId,
                                    field: 'total',
                                    value,
                                  });
                                  if (value === '') {
                                    pendingRateWarningRowsRef.current.delete(item.rowId);
                                    updateItemRow(index, { unitCost: '' });
                                    return;
                                  }
                                  const amount = Number(value);
                                  const quantity = Number(item.quantity);
                                  const taxMultiplier = 1 + (Number(item.taxRate) || 0) / 100;
                                  if (
                                    Number.isFinite(amount) &&
                                    amount >= 0 &&
                                    quantity > 0 &&
                                    taxMultiplier > 0
                                  ) {
                                    pendingRateWarningRowsRef.current.add(item.rowId);
                                    updateItemRow(index, {
                                      unitCost: amount / (quantity * taxMultiplier),
                                    });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const nextRow = items[index + 1];
                                    if (nextRow) barcodeInputRefs.current.get(nextRow.rowId)?.focus();
                                  }
                                }}
                                aria-label={isRtl ? 'إجمالي الصنف مع الضريبة' : 'Line total including tax'}
                                className="purchase-entry-number-input w-full rounded-none border-0 bg-transparent px-2 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums focus:outline-none disabled:cursor-not-allowed"
                              />
                            </td>
                            <td data-purchase-column="delete" className="border border-slate-300 p-0 text-center">
                              {product && (
                              <button
                                data-purchase-grid-cell
                                type="button"
                                onClick={() => clearItemRow(index)}
                                className="p-2 text-slate-400 hover:text-red-600"
                                title={isRtl ? 'مسح السطر' : 'Clear row'}
                                aria-label={isRtl ? 'مسح السطر' : 'Clear row'}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <section className="sticky bottom-0 z-20 grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 border-t border-slate-200 bg-white/95 py-2 shadow-[0_-8px_16px_-12px_rgba(15,23,42,0.5)] backdrop-blur lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
                <div className="grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={isPaid}
                      onChange={(event) => {
                        const paid = event.target.checked;
                        setIsPaid(paid);
                        if (paid) setPartialPaymentAmount('');
                      }}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                    />
                    <span>{isRtl ? 'مدفوع' : 'Paid'}</span>
                  </label>

                  <div className="min-w-0">
                    <label htmlFor="purchase-partial-payment" className="mb-0.5 block text-[10px] font-medium text-slate-700">
                      {isRtl ? 'المبلغ الجزئي' : 'Partial Amount'}
                    </label>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-slate-500">{c}</span>
                      <input
                        id="purchase-partial-payment"
                        type="number"
                        min={0}
                        step="0.01"
                        value={partialPaymentAmount}
                        disabled={isPaid}
                        onChange={(event) => setPartialPaymentAmount(event.target.value)}
                        className="w-full min-w-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-[11px] text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                  </div>

                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:col-span-2">
                    <div className="min-w-0">
                      <label className="mb-0.5 block text-[10px] font-medium text-slate-700">
                        {isRtl ? 'ملاحظات / مذكرة استلام' : 'Notes / Receiving Memo'}
                      </label>
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-700"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={cancelPurchaseEntry}
                      className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    >
                      {isRtl ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>

                <div className="min-w-0 border-t border-slate-200 pt-1 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0">
                  <table className="w-full border-collapse text-[11px]">
                    <tbody>
                      <tr>
                        <th scope="row" className={`py-0.5 font-medium text-slate-600 ${isRtl ? 'text-right' : 'text-left'}`}>
                          {isRtl ? 'المجموع الفرعي:' : 'Subtotal:'}
                        </th>
                        <td className="py-0.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                          {c}{formSubtotal.toFixed(decimalPlaces)}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className={`py-0.5 font-medium text-slate-600 ${isRtl ? 'text-right' : 'text-left'}`}>
                          {isRtl ? 'ضريبة الأصناف:' : 'Product Tax:'}
                        </th>
                        <td className="py-0.5 text-right font-mono text-slate-700 tabular-nums">
                          {c}{formTaxAmount.toFixed(decimalPlaces)}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" className={`py-0.5 font-medium text-slate-600 ${isRtl ? 'text-right' : 'text-left'}`}>
                          {isRtl ? 'الشحن والمناولة:' : 'Shipping & Handling:'}
                        </th>
                        <td className="py-0.5 text-right">
                          <span className="mr-1 font-mono text-slate-500">{c}</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={shippingCost}
                            onFocus={(event) => event.currentTarget.select()}
                            onClick={(event) => event.currentTarget.select()}
                            onKeyDown={preventNumberArrowChange}
                            onChange={(e) => setShippingCost(e.target.value)}
                            className="purchase-entry-number-input w-20 rounded px-1.5 py-0.5 font-mono text-right border border-slate-200 bg-white tabular-nums"
                          />
                        </td>
                      </tr>
                      <tr className="text-xs font-bold text-slate-900">
                        <th scope="row" className={`py-1 ${isRtl ? 'text-right' : 'text-left'}`}>
                          {isRtl ? 'الإجمالي الكلي:' : 'Grand Total:'}
                        </th>
                        <td className="py-1 text-right font-mono tabular-nums">
                          {c}{formTotal.toFixed(decimalPlaces)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
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

      {productHistoryProduct && productHistory && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-2 sm:p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-history-title"
        >
          <div className="flex h-[95vh] max-h-[95vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <header className="shrink-0 border-b border-slate-200 px-4 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="product-history-title" className="text-base font-semibold text-slate-900">
                    {isRtl ? 'سجل المنتج' : 'Product History'}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {(isRtl && productHistoryProduct.nameAr) || productHistoryProduct.name}
                    {productHistoryProduct.sku ? ` · ${productHistoryProduct.sku}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setProductHistoryProduct(null)}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={isRtl ? 'إغلاق' : 'Close'}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">{isRtl ? 'المبيعات' : 'Sales'} ({productHistoryTotals?.salesCount || 0})</span>
                  <span className="font-mono font-semibold text-slate-900">{c}{(productHistoryTotals?.totalSales || 0).toFixed(decimalPlaces)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">{isRtl ? 'المشتريات' : 'Purchases'} ({productHistoryTotals?.purchaseCount || 0})</span>
                  <span className="font-mono font-semibold text-slate-900">{c}{(productHistoryTotals?.totalPurchase || 0).toFixed(decimalPlaces)}</span>
                </div>
                <div
                  className="flex items-center gap-1.5"
                  title={isRtl
                    ? 'تقدير باستخدام آخر تكلفة شراء قبل كل عملية بيع؛ لا تُحفظ تكلفة البضاعة وقت البيع.'
                    : 'Estimated from the latest purchase cost before each sale; cost is not stored on sales.'}
                >
                  <span className="text-slate-500">{isRtl ? 'الربح التقديري' : 'Estimated Profit'}</span>
                  <span className="font-mono font-semibold text-slate-900">{c}{(productHistoryTotals?.estimatedProfit || 0).toFixed(decimalPlaces)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">{isRtl ? 'الكمية الخارجة' : 'Qty Out'}</span>
                  <span className="font-mono font-semibold text-slate-900">{(productHistoryTotals?.quantityOut || 0).toFixed(decimalPlaces)} {productHistoryProduct.unit}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">{isRtl ? 'الكمية الداخلة' : 'Qty In'}</span>
                  <span className="font-mono font-semibold text-slate-900">{(productHistoryTotals?.quantityIn || 0).toFixed(decimalPlaces)} {productHistoryProduct.unit}</span>
                </div>
              </div>
            </header>

            <nav className="flex shrink-0 overflow-x-auto border-b border-slate-200 px-3" role="tablist">
              {[
                { id: 'purchases' as const, label: isRtl ? 'المشتريات' : 'Purchases', count: productHistoryTotals?.purchaseCount || 0 },
                {
                  id: 'purchaseReturns' as const,
                  label: isRtl ? 'مرتجعات المشتريات' : 'Purchase Returns',
                  count: productHistoryTotals?.purchaseReturnCount || 0,
                },
                { id: 'sales' as const, label: isRtl ? 'المبيعات' : 'Sales', count: productHistoryTotals?.salesCount || 0 },
                {
                  id: 'salesReturns' as const,
                  label: isRtl ? 'مرتجعات المبيعات' : 'Sales Returns',
                  count: new Set(filteredProductSalesReturnHistory.map(({ voucher }) => voucher.id)).size,
                },
                { id: 'details' as const, label: isRtl ? 'تفاصيل المنتج' : 'Product Details', count: undefined },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`product-history-tab-${tab.id}`}
                  aria-selected={productHistoryTab === tab.id}
                  aria-controls="product-history-panel"
                  onClick={() => setProductHistoryTab(tab.id)}
                  className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium ${
                    productHistoryTab === tab.id
                      ? 'border-blue-700 text-blue-800'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && <span className="ml-1.5 text-slate-400">{tab.count}</span>}
                </button>
              ))}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col p-3">
              {productHistoryTab !== 'details' && (
                <div className="mb-2 flex shrink-0 items-center gap-2">
                  <label htmlFor="product-history-party" className="text-xs font-medium text-slate-700">
                    {isRtl ? 'اختيار الجهة' : 'Choose Party'}
                  </label>
                  <select
                    id="product-history-party"
                    value={historyPartyFilter}
                    onChange={(event) => setHistoryPartyFilter(event.target.value)}
                    className="min-w-[220px] rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                  >
                    <option value="ALL">{isRtl ? 'كل الجهات' : 'All Parties'}</option>
                    {historyPartyOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div
                id="product-history-panel"
                className="min-h-0 flex-1"
                role="tabpanel"
                aria-labelledby={`product-history-tab-${productHistoryTab}`}
                dir={isRtl ? 'rtl' : 'ltr'}
              >
                {productHistoryTab === 'purchases' &&
                  renderProductHistoryTable(
                    purchaseHistoryRows,
                    isRtl ? 'لا يوجد سجل شراء لهذا المنتج' : 'No purchase history for this product.'
                  )}
                {productHistoryTab === 'purchaseReturns' &&
                  renderProductHistoryTable(
                    purchaseReturnHistoryRows,
                    isRtl ? 'لا يوجد سجل مرتجع شراء لهذا المنتج' : 'No purchase return history for this product.'
                  )}
                {productHistoryTab === 'sales' &&
                  renderProductHistoryTable(
                    salesHistoryRows,
                    isRtl ? 'لا يوجد سجل بيع لهذا المنتج' : 'No sales history for this product.'
                  )}
                {productHistoryTab === 'salesReturns' &&
                  renderProductHistoryTable(
                    salesReturnHistoryRows,
                    isRtl ? 'لا يوجد سجل مرتجع لهذا المنتج' : 'No sales return history for this product.'
                  )}
                {productHistoryTab === 'details' && (
                    <div className="h-full overflow-auto">
                      <table className={`w-full border-collapse text-xs ${isRtl ? 'text-right' : 'text-left'}`}>
                        <tbody className="divide-y divide-slate-100">
                          {[
                            { label: isRtl ? 'الاسم بالإنجليزية' : 'English Name', value: productHistoryProduct.name },
                            { label: isRtl ? 'الاسم بالعربية' : 'Arabic Name', value: productHistoryProduct.nameAr || '—' },
                            { label: 'SKU', value: productHistoryProduct.sku || '—' },
                            { label: isRtl ? 'الباركود' : 'Barcode', value: productHistoryProduct.barcode || '—' },
                            { label: isRtl ? 'التصنيف' : 'Category', value: productHistoryProduct.category || '—' },
                            { label: isRtl ? 'العلامة التجارية' : 'Brand', value: productHistoryProduct.brand || '—' },
                            { label: isRtl ? 'الوحدة' : 'Unit', value: productHistoryProduct.unit || '—' },
                            { label: isRtl ? 'المخزون' : 'Stock', value: productHistoryProduct.stock },
                            { label: isRtl ? 'حد إعادة الطلب' : 'Reorder Level', value: productHistoryProduct.reorderLevel },
                            { label: isRtl ? 'سعر التكلفة' : 'Cost Price', value: `${c}${productHistoryProduct.costPrice.toFixed(decimalPlaces)}` },
                            { label: isRtl ? 'سعر البيع' : 'Selling Price', value: `${c}${productHistoryProduct.retailPrice.toFixed(decimalPlaces)}` },
                            { label: isRtl ? 'الضريبة' : 'Tax', value: `${(productHistoryProduct.taxRate ?? settings.taxRate).toFixed(2)}%` },
                            {
                              label: isRtl ? 'الباركودات الإضافية' : 'Additional Barcodes',
                              value: productHistoryProduct.additionalBarcodes?.map((barcode) => barcode.barcode).filter(Boolean).join(', ') || '—',
                            },
                            {
                              label: isRtl ? 'الوحدات المتعددة' : 'Multi-units',
                              value: productHistoryProduct.multiUnits?.map((unit) =>
                                `${unit.name} (${unit.unitsPerBase} ${productHistoryProduct.unit}) · ${unit.barcode || '—'} · ${unit.price === null ? '—' : `${c}${unit.price.toFixed(decimalPlaces)}`}`
                              ).join('; ') || '—',
                            },
                            { label: isRtl ? 'آخر تحديث' : 'Last Updated', value: productHistoryProduct.updatedAt || '—' },
                            { label: isRtl ? 'معرّف المنتج' : 'Product ID', value: productHistoryProduct.id },
                          ].map(({ label, value }) => (
                            <tr key={label}>
                              <th scope="row" className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-500">{label}</th>
                              <td className="break-words px-2 py-1.5 font-medium text-slate-800">{value}</td>
                            </tr>
                          ))}
                        </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
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
      {isCreatingVendor && (
        <VendorsView
          vendors={vendors}
          settings={settings}
          onRefresh={onRefreshVendors}
          createOnly
          onCreateOnlyClose={() => {
            setIsCreatingVendor(false);
            focusAvailableBarcode();
          }}
          onVendorCreated={(createdVendorId) => {
            setVendorId(createdVendorId);
            setVendorSearch('');
            setVendorSearchOpen(false);
            setIsCreatingVendor(false);
            focusAvailableBarcode();
          }}
        />
      )}
      {sellingPriceWarning && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-price-warning-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !updatingSellingPrice) {
              event.preventDefault();
              dismissSellingPriceWarning();
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <h2 id="purchase-price-warning-title" className="text-base font-bold text-slate-900">
                  {isRtl ? 'تحذير سعر البيع' : 'Selling Price Warning'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {isRtl
                    ? 'تكلفة الشراء مع الضريبة أعلى من سعر البيع الحالي. حدّث سعر الوحدة الأساسية، وسيتم تحديث أسعار الوحدات الأخرى تلقائياً.'
                    : 'The purchase cost including tax is higher than the current selling price. Update the base unit price; other unit prices will recalculate automatically.'}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {(isRtl && sellingPriceWarning.product.nameAr) || sellingPriceWarning.product.name}
                  {' · '}
                  {isRtl ? 'سعر الوحدة الأساسية الحالي' : 'Current base-unit price'}: {c}{sellingPriceWarning.currentPrice.toFixed(decimalPlaces)}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="purchase-selling-price-update" className="mb-1 block text-xs font-semibold text-slate-700">
                {isRtl
                  ? `سعر بيع الوحدة الأساسية الجديد (${sellingPriceWarning.product.unit})`
                  : `New Base-Unit Selling Price (${sellingPriceWarning.product.unit})`}
              </label>
              <input
                ref={sellingPriceInputRef}
                id="purchase-selling-price-update"
                type="number"
                min={0}
                step="any"
                value={sellingPriceInput}
                onChange={(event) => setSellingPriceInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    updateSellingPriceButtonRef.current?.focus();
                  }
                  if (event.key === 'Escape' && !updatingSellingPrice) {
                    event.preventDefault();
                    dismissSellingPriceWarning();
                  }
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className={`w-full border-collapse text-xs ${isRtl ? 'text-right' : 'text-left'}`}>
                  <thead className="bg-slate-50 text-[10px] text-slate-600">
                    <tr>
                      <th className="whitespace-nowrap px-2 py-2">{isRtl ? 'الوحدة' : 'Unit'}</th>
                      <th className="whitespace-nowrap px-2 py-2">{isRtl ? 'الوحدات الأساسية' : 'Base units'}</th>
                      <th className={`whitespace-nowrap px-2 py-2 ${isRtl ? 'text-left' : 'text-right'}`}>
                        {isRtl ? 'سعر البيع الحالي' : 'Current Selling Price'}
                      </th>
                      <th className={`whitespace-nowrap px-2 py-2 ${isRtl ? 'text-left' : 'text-right'}`}>
                        {isRtl ? 'السعر الجديد' : 'New Price'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      {
                        id: 'base',
                        name: `${sellingPriceWarning.product.unit || (isRtl ? 'الوحدة الأساسية' : 'Base Unit')} (${isRtl ? 'أساسية' : 'Base'})`,
                        unitsPerBase: 1,
                        currentPrice: sellingPriceWarning.product.retailPrice,
                      },
                      ...(sellingPriceWarning.product.multiUnits || []).map((unit) => ({
                        id: unit.id,
                        name: unit.name,
                        unitsPerBase: Math.max(1, unit.unitsPerBase),
                        currentPrice:
                          unit.price ??
                          sellingPriceWarning.product.retailPrice * Math.max(1, unit.unitsPerBase),
                      })),
                    ].map((unit) => {
                      const basePrice = Number(sellingPriceInput);
                      const newUnitPrice =
                        sellingPriceInput.trim() && Number.isFinite(basePrice)
                          ? basePrice * unit.unitsPerBase
                          : null;
                      return (
                        <tr key={unit.id}>
                          <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-800">{unit.name}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono text-slate-600">
                            {unit.unitsPerBase} × {sellingPriceWarning.product.unit}
                          </td>
                          <td className={`whitespace-nowrap px-2 py-2 font-mono tabular-nums ${isRtl ? 'text-left' : 'text-right'}`}>
                            {c}{unit.currentPrice.toFixed(decimalPlaces)}
                          </td>
                          <td className={`whitespace-nowrap px-2 py-2 font-mono font-semibold tabular-nums ${isRtl ? 'text-left' : 'text-right'}`}>
                            {newUnitPrice === null ? '—' : `${c}${newUnitPrice.toFixed(decimalPlaces)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {sellingPriceUpdateError && (
                <p role="alert" className="mt-2 text-xs text-red-700">
                  {sellingPriceUpdateError}
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={updatingSellingPrice}
                onClick={dismissSellingPriceWarning}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {isRtl ? 'إلغاء (Esc)' : 'Cancel (Esc)'}
              </button>
              <button
                ref={updateSellingPriceButtonRef}
                type="button"
                disabled={updatingSellingPrice}
                onClick={() => void saveSellingPriceWarning()}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
              >
                {updatingSellingPrice
                  ? (isRtl ? 'جارٍ التحديث...' : 'Updating...')
                  : (isRtl ? 'تحديث سعر المنتج' : 'Update Product Price')}
              </button>
            </div>
          </div>
        </div>
      )}
      {unknownBarcode && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unknown-purchase-barcode-title"
          onKeyDown={handleUnknownBarcodeDialogKeyDown}
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h2 id="unknown-purchase-barcode-title" className="text-base font-bold text-slate-900">
              {isRtl ? 'الباركود غير موجود' : 'Barcode Not Found'}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {isRtl ? 'هل تريد إنشاء منتج جديد لهذا الباركود؟' : 'Would you like to create a new product for this barcode?'}
            </p>
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">
              {unknownBarcode}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelUnknownBarcodeButtonRef}
                type="button"
                onFocus={() => setUnknownBarcodeAction('cancel')}
                onClick={() => closeUnknownBarcodeDialog()}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              {onAddProduct && (
                <button
                  ref={createProductButtonRef}
                  type="button"
                  onFocus={() => setUnknownBarcodeAction('create')}
                  onClick={createProductFromUnknownBarcode}
                  className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  {isRtl ? 'إنشاء منتج' : 'Create Product'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {printEntry && (
        <article className={`purchase-print-area p-8 text-slate-900 ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
          <h1 className="mb-1 text-2xl font-bold">{isRtl ? 'فاتورة شراء' : 'Purchase Invoice'}</h1>
          <div className="mb-6 grid grid-cols-2 gap-2 border-b border-slate-300 pb-4 text-sm">
            <p><strong>{isRtl ? 'رقم الفاتورة:' : 'Invoice / PO:'}</strong> {printEntry.invoiceNumber}</p>
            <p><strong>{isRtl ? 'المورد:' : 'Vendor:'}</strong> {printEntry.vendorName}</p>
            <p><strong>{isRtl ? 'تاريخ الاستلام:' : 'Received:'}</strong> {printEntry.receivedDate}</p>
            <p>
              <strong>{isRtl ? 'حالة الدفع:' : 'Payment status:'}</strong>{' '}
              {printEntry.paymentStatus === 'PAID'
                ? (isRtl ? 'مدفوع بالكامل' : 'Paid in Full')
                : printEntry.paymentStatus === 'PARTIAL'
                  ? (isRtl ? 'مدفوع جزئياً' : 'Partially Paid')
                  : (isRtl ? 'معلق' : 'Pending')}
            </p>
            <p>
              <strong>{isRtl ? 'المبلغ المدفوع:' : 'Paid amount:'}</strong>{' '}
              {c}{printEntry.paidAmount.toFixed(2)}
            </p>
            <p>
              <strong>{isRtl ? 'الرصيد المتبقي:' : 'Balance:'}</strong>{' '}
              {c}{Math.max(0, printEntry.total - printEntry.paidAmount).toFixed(2)}
            </p>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-400">
                <th className="px-2 py-2 text-left">{isRtl ? 'الصنف' : 'Product'}</th>
                <th className="px-2 py-2 text-left">{isRtl ? 'الرمز' : 'SKU'}</th>
                <th className="px-2 py-2 text-right">{isRtl ? 'الكمية' : 'Qty'}</th>
                <th className="px-2 py-2 text-left">{isRtl ? 'الوحدة' : 'Unit'}</th>
                <th className="px-2 py-2 text-right">{isRtl ? 'تكلفة الوحدة' : 'Unit Cost'}</th>
                <th className="px-2 py-2 text-right">{isRtl ? 'الضريبة' : 'Tax'}</th>
                <th className="px-2 py-2 text-right">{isRtl ? 'الإجمالي' : 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              {printEntry.items.map((item, index) => (
                <tr key={`${item.sku}-${index}`} className="border-b border-slate-200">
                  <td className="px-2 py-2">{item.name}</td>
                  <td className="px-2 py-2">{item.sku}</td>
                  <td className="px-2 py-2 text-right">{item.quantity}</td>
                  <td className="px-2 py-2">{item.unit}</td>
                  <td className="px-2 py-2 text-right">{c}{item.unitCost.toFixed(2)}</td>
                  <td className="px-2 py-2 text-right">{item.taxRate}%</td>
                  <td className="px-2 py-2 text-right">{c}{item.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="mt-6 ml-auto w-full max-w-sm border-collapse text-sm">
            <tbody>
              <tr><th className="py-1 text-left font-medium">{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</th><td className="py-1 text-right">{c}{printEntry.subtotal.toFixed(2)}</td></tr>
              <tr><th className="py-1 text-left font-medium">{isRtl ? 'ضريبة الأصناف' : 'Product Tax'}</th><td className="py-1 text-right">{c}{printEntry.taxAmount.toFixed(2)}</td></tr>
              <tr><th className="py-1 text-left font-medium">{isRtl ? 'الشحن والمناولة' : 'Shipping & Handling'}</th><td className="py-1 text-right">{c}{printEntry.shippingCost.toFixed(2)}</td></tr>
              <tr className="border-t-2 border-slate-400 text-base font-bold"><th className="py-2 text-left">{isRtl ? 'الإجمالي الكلي' : 'Grand Total'}</th><td className="py-2 text-right">{c}{printEntry.total.toFixed(2)}</td></tr>
            </tbody>
          </table>
          {printEntry.notes && <p className="mt-6 border-t border-slate-300 pt-3 text-sm"><strong>{isRtl ? 'ملاحظات:' : 'Notes:'}</strong> {printEntry.notes}</p>}
        </article>
      )}
    </div>
  );
};
