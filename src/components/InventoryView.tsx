import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Edit2,
  Plus,
  Search,
  Trash2,
  X,
  Upload,
  FileSpreadsheet,
  Check,
  AlertTriangle,
  RefreshCw,
  Languages,
  Loader2,
  Sparkles,
  Barcode,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type {
  InventoryOption,
  InventoryOptionType,
  ProductAdditionalBarcode,
  Product,
  ProductCategory,
  ProductMultiUnit,
  PurchaseEntry,
  PurchaseReturnVoucher,
  Sale,
  SalesReturnVoucher,
  StoreSettings,
  ThemeMode,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { ProductImage } from './ProductImage';
import { isFlyErpServiceCategory } from '../utils/flyErpServices';

const TRAVEL_SERVICES_CATEGORY = 'Travel Services';

interface InventoryViewProps {
  products: Product[];
  purchases: PurchaseEntry[];
  purchaseReturnVouchers: PurchaseReturnVoucher[];
  sales: Sale[];
  salesReturnVouchers: SalesReturnVoucher[];
  settings: StoreSettings;
  theme: ThemeMode;
  onRefreshProducts: () => Promise<void>;
  createProductRequest?: number;
  createProductBarcode?: string;
  createServiceRequest?: boolean;
  onCreateProductRequestHandled?: () => void;
  returnToSourceAfterCreate?: boolean;
  onProductCreated?: () => void;
  onProductCreateCancelled?: () => void;
  editProductRequest?: { product: Product; requestId: number } | null;
  editProductOnly?: boolean;
  onProductEditorClosed?: (requestId: number) => void;
  isFlyErpMode?: boolean;
}

const DEFAULT_UNITS = ['ea', 'pcs', 'box', 'pack', 'btl', 'kg', 'g', 'L', 'ml'];

function loadSavedOptions(key: string, defaults: string[]): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return [...new Set([...defaults, ...(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : [])])];
  } catch (error) {
    console.error(`Failed to load product options (${key}):`, error);
    return defaults;
  }
}

function isInventoryOption(value: unknown): value is InventoryOption {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    'type' in value &&
    (value.type === 'category' || value.type === 'brand' || value.type === 'taxRate' || value.type === 'unit') &&
    'value' in value &&
    typeof value.value === 'string' &&
    (!('imageData' in value) || typeof value.imageData === 'string') &&
    (!('isDefault' in value) || typeof value.isDefault === 'boolean')
  );
}

function readSupportedImageFile(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1_500_000) {
    return Promise.reject(new Error('Choose a JPEG, PNG, or WebP image smaller than 1.5 MB.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the selected image.'));
    };
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

interface ProductFormState {
  sku: string;
  barcode: string;
  name: string;
  nameAr: string;
  category: string;
  brand: string;
  costPrice: string;
  retailPrice: string;
  taxRate: string;
  requiresItinerary: boolean;
  stock: string;
  reorderLevel: string;
  unit: string;
}

const EMPTY_FORM: ProductFormState = {
  sku: '',
  barcode: '',
  name: '',
  nameAr: '',
  category: '',
  brand: '',
  costPrice: '',
  retailPrice: '',
  taxRate: '15',
  requiresItinerary: false,
  stock: '0',
  reorderLevel: '5',
  unit: 'ea',
};

type ProductFormTab = 'general' | 'advanced' | 'history' | 'settings';
type ProductHistoryFilter = 'all' | 'purchases' | 'purchaseReturns' | 'sales' | 'salesReturns';

interface ProductHistoryRow {
  id: string;
  type: Exclude<ProductHistoryFilter, 'all'>;
  date: string;
  reference: string;
  party: string;
  quantity: number;
  unit: string;
  rate: number;
  total: number;
}

function getProductHistoryRows(
  product: Product,
  purchases: PurchaseEntry[],
  purchaseReturnVouchers: PurchaseReturnVoucher[],
  sales: Sale[],
  salesReturnVouchers: SalesReturnVoucher[],
  isRtl: boolean
): ProductHistoryRow[] {
  const rows: ProductHistoryRow[] = [];

  purchases.forEach((purchase) => {
    purchase.items
      .filter((item) => item.productId === product.id)
      .forEach((item) => rows.push({
        id: `purchase-${purchase.id}-${item.id}`,
        type: 'purchases',
        date: purchase.receivedDate || purchase.createdAt,
        reference: purchase.invoiceNumber,
        party: purchase.vendorName,
        quantity: item.quantity,
        unit: product.unit,
        rate: item.unitCost,
        total: item.lineTotal,
      }));
  });

  purchaseReturnVouchers.forEach((voucher) => {
    voucher.items
      .filter((item) =>
        item.productId === product.id ||
        item.sku === product.sku ||
        item.productName === product.name
      )
      .forEach((item) => rows.push({
        id: `purchase-return-${voucher.id}-${item.id}`,
        type: 'purchaseReturns',
        date: voucher.createdAt,
        reference: voucher.voucherNumber,
        party: voucher.vendorName,
        quantity: item.quantity,
        unit: product.unit,
        rate: item.unitCost,
        total: item.lineTotal,
      }));
  });

  sales.filter((sale) => sale.status === 'COMPLETED').forEach((sale) => {
    sale.items
      .filter((item) => item.productId === product.id)
      .forEach((item) => rows.push({
        id: `sale-${sale.id}-${item.id}`,
        type: 'sales',
        date: sale.createdAt,
        reference: sale.receiptNumber,
        party: sale.customerName || (isRtl ? 'عميل نقدي' : 'Walk-in Customer'),
        quantity: item.quantity,
        unit: item.unitName || product.unit,
        rate: item.unitPrice,
        total: item.lineTotal - (item.discountAmount || 0),
      }));
  });

  const salesById = new Map(sales.map((sale) => [sale.id, sale]));
  salesReturnVouchers.forEach((voucher) => {
    voucher.items.forEach((returnItem) => {
      const sale = salesById.get(returnItem.saleId);
      const saleItem = sale?.items.find((item) => item.id === returnItem.saleItemId);
      const matchesProduct = saleItem
        ? saleItem.productId === product.id
        : returnItem.sku === product.sku || returnItem.productName === product.name;
      if (!matchesProduct) return;

      rows.push({
        id: `sales-return-${voucher.id}-${returnItem.saleItemId}`,
        type: 'salesReturns',
        date: voucher.createdAt,
        reference: voucher.voucherNumber,
        party: sale?.customerName || (isRtl ? 'عميل نقدي' : 'Walk-in Customer'),
        quantity: returnItem.quantity,
        unit: returnItem.unitName || saleItem?.unitName || product.unit,
        rate: returnItem.quantity > 0 ? returnItem.refundAmount / returnItem.quantity : 0,
        total: returnItem.refundAmount,
      });
    });
  });

  return rows.sort((left, right) => right.date.localeCompare(left.date));
}

interface ParsedImportRow {
  sku: string;
  barcode: string;
  name: string;
  nameAr?: string;
  category: ProductCategory;
  costPrice: number;
  retailPrice: number;
  taxRate: number;
  stock: number;
  reorderLevel: number;
  unit: string;
  isExisting?: boolean;
}

type InventorySortKey =
  | 'sku'
  | 'name'
  | 'category'
  | 'costPrice'
  | 'retailPrice'
  | 'stock'
  | 'unit'
  | 'taxRate';
type InventorySortDirection = 'asc' | 'desc';
type ProductOptionField = 'category' | 'brand' | 'unit';

interface MultiUnitDraft {
  id: string;
  name: string;
  barcode: string;
  unitsPerBase: string;
  packsPerBase: string;
  price: string;
}

interface AdditionalBarcodeDraft {
  id: string;
  barcode: string;
  unitId: string;
}

// Robust CSV parser supporting quotes, escaped quotes (""), and multiple newlines
function parseCsv(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let curr = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        curr += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(curr.trim());
      curr = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i++;
      }
      row.push(curr.trim());
      if (row.some((cell) => cell.length > 0)) {
        lines.push(row);
      }
      row = [];
      curr = '';
    } else {
      curr += char;
    }
  }

  if (curr.length > 0 || row.length > 0) {
    row.push(curr.trim());
    if (row.some((cell) => cell.length > 0)) {
      lines.push(row);
    }
  }

  return lines;
}

async function translateEnglishToArabic(text: string): Promise<string> {
  const response = await fetch('/api/translate/ar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const result = await response.json() as { translation?: unknown; error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof result.error === 'string' ? result.error : 'Arabic translation failed.'
    );
  }
  if (typeof result.translation !== 'string' || !result.translation.trim()) {
    throw new Error('Arabic translation returned an empty result.');
  }
  return result.translation;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  purchases,
  purchaseReturnVouchers,
  sales,
  salesReturnVouchers,
  settings,
  theme,
  onRefreshProducts,
  createProductRequest = 0,
  createProductBarcode = '',
  createServiceRequest = false,
  onCreateProductRequestHandled,
  returnToSourceAfterCreate = false,
  onProductCreated,
  onProductCreateCancelled,
  editProductRequest,
  editProductOnly = false,
  onProductEditorClosed,
  isFlyErpMode = false,
}) => {
  const { t, isRtl } = useLanguage();
  const isRposMode = settings.posScreenLayout === 'rpos';
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [sortConfig, setSortConfig] = useState<{
    key: InventorySortKey;
    direction: InventorySortDirection;
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [activeProductTab, setActiveProductTab] = useState<ProductFormTab>('general');
  const [productHistoryFilter, setProductHistoryFilter] = useState<ProductHistoryFilter>('all');
  const [selectedProductDetails, setSelectedProductDetails] = useState<Product | null>(null);
  const [productPendingDelete, setProductPendingDelete] = useState<Product | null>(null);
  const [deleteProductError, setDeleteProductError] = useState<string | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [productLookupCode, setProductLookupCode] = useState('');
  const [productLookupMessage, setProductLookupMessage] = useState<{
    type: 'error' | 'status';
    message: string;
  } | null>(null);
  const [multiUnitDrafts, setMultiUnitDrafts] = useState<MultiUnitDraft[]>([]);
  const [additionalBarcodeDrafts, setAdditionalBarcodeDrafts] =
    useState<AdditionalBarcodeDraft[]>([]);
  const [productImagePath, setProductImagePath] = useState('');
  const [productImageData, setProductImageData] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [servicesSearch, setServicesSearch] = useState('');
  const [inventorySection, setInventorySection] = useState<'products' | 'services' | 'manage'>(
    isFlyErpMode ? 'services' : 'products'
  );
  const [managementType, setManagementType] = useState<InventoryOptionType>('category');
  const [optionDialogOpen, setOptionDialogOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<InventoryOption | null>(null);
  const [optionValue, setOptionValue] = useState('');
  const [optionImageData, setOptionImageData] = useState('');
  const [optionReturnToProductField, setOptionReturnToProductField] =
    useState<ProductOptionField | null>(null);
  const [optionSaving, setOptionSaving] = useState(false);
  const [optionFormError, setOptionFormError] = useState<string | null>(null);
  const optionImageInputRef = useRef<HTMLInputElement>(null);
  const productImageInputRef = useRef<HTMLInputElement>(null);
  const productNameInputRef = useRef<HTMLInputElement>(null);
  const productLookupInputRef = useRef<HTMLInputElement>(null);
  const handledEditRequestIdRef = useRef<number | null>(null);
  const isServiceInventory = isFlyErpMode || inventorySection === 'services';

  useEffect(() => {
    setInventorySection(isFlyErpMode ? 'services' : 'products');
  }, [isFlyErpMode]);

  useEffect(() => {
    if (!modalOpen) return;
    const frame = window.requestAnimationFrame(() => productNameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [modalOpen, editingProduct]);

  const closeProductEditor = () => {
    setModalOpen(false);
    if (!editingProduct) onProductCreateCancelled?.();
    if (editProductOnly && editProductRequest) {
      onProductEditorClosed?.(editProductRequest.requestId);
    }
  };

  // Excel & Spreadsheet Import States
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFileName, setImportFileName] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const loadOptions = async () => {
      setOptionsLoading(true);
      setOptionsError(null);
      try {
        const response = await fetch('/api/inventory-options');
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message =
            typeof payload === 'object' && payload !== null && 'error' in payload &&
            typeof payload.error === 'string'
              ? payload.error
              : 'Failed to load inventory options.';
          throw new Error(message);
        }
        if (!Array.isArray(payload) || !payload.every(isInventoryOption)) {
          throw new Error('Inventory options response has an invalid format.');
        }

        const loaded = [...payload];
        const legacyOptions: Array<{ type: InventoryOptionType; value: string }> = [
          ...loadSavedOptions('aptpos_product_categories', []).map((value) => ({ type: 'category' as const, value })),
          ...loadSavedOptions('aptpos_product_units', []).map((value) => ({ type: 'unit' as const, value })),
        ];
        for (const option of legacyOptions) {
          if (loaded.some((item) => item.type === option.type && item.value.toLowerCase() === option.value.toLowerCase())) {
            continue;
          }
          const migratedResponse = await fetch('/api/inventory-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(option),
          });
          const migratedPayload: unknown = await migratedResponse.json();
          if (!migratedResponse.ok || !isInventoryOption(migratedPayload)) {
            const message =
              typeof migratedPayload === 'object' && migratedPayload !== null && 'error' in migratedPayload &&
              typeof migratedPayload.error === 'string'
                ? migratedPayload.error
                : 'Failed to migrate saved inventory options.';
            throw new Error(message);
          }
          loaded.push(migratedPayload);
        }
        try {
          localStorage.removeItem('aptpos_product_categories');
          localStorage.removeItem('aptpos_product_units');
        } catch (error) {
          console.error('Failed to clear migrated inventory options from browser storage:', error);
        }
        if (active) setInventoryOptions(loaded);
      } catch (error) {
        if (active) setOptionsError((error as Error).message);
      } finally {
        if (active) setOptionsLoading(false);
      }
    };
    void loadOptions();
    return () => {
      active = false;
    };
  }, []);

  const c = isRtl ? 'ر.س ' : (settings.currencySymbol || 'SAR ');
  const productHistoryRows = useMemo(
    () => editingProduct
      ? getProductHistoryRows(
          editingProduct,
          purchases,
          purchaseReturnVouchers,
          sales,
          salesReturnVouchers,
          isRtl
        )
      : [],
    [editingProduct, purchases, purchaseReturnVouchers, sales, salesReturnVouchers, isRtl]
  );
  const filteredProductHistoryRows = productHistoryFilter === 'all'
    ? productHistoryRows
    : productHistoryRows.filter((row) => row.type === productHistoryFilter);
  const categories = useMemo(
    () => [...new Set([
      ...inventoryOptions.filter((option) => option.type === 'category').map((option) => option.value),
      ...products.map((product) => product.category),
      TRAVEL_SERVICES_CATEGORY,
    ])].sort(),
    [inventoryOptions, products]
  );
  const filteredServices = useMemo(() => {
    const query = servicesSearch.trim().toLocaleLowerCase();
    return products
      .filter((product) => isFlyErpServiceCategory(product.category))
      .filter((product) => !query ||
        product.name.toLocaleLowerCase().includes(query) ||
        (product.nameAr?.toLocaleLowerCase().includes(query) ?? false) ||
        product.sku.toLocaleLowerCase().includes(query))
      .sort((left, right) =>
        (isRtl ? left.nameAr || left.name : left.name)
          .localeCompare(isRtl ? right.nameAr || right.name : right.name, undefined, {
            sensitivity: 'base',
          })
      );
  }, [isRtl, products, servicesSearch]);
  const brands = useMemo(
    () => [...new Set([...inventoryOptions.filter((option) => option.type === 'brand').map((option) => option.value), ...products.map((product) => product.brand || '').filter(Boolean)])].sort(),
    [inventoryOptions, products]
  );
  const taxRates = useMemo(
    () => [...new Set([
      ...inventoryOptions.filter((option) => option.type === 'taxRate').map((option) => Number(option.value)),
      ...products.map((product) => product.taxRate ?? 15),
    ])].filter(Number.isFinite).sort((a, b) => a - b),
    [inventoryOptions, products]
  );
  const defaultTaxRate = Number(
    inventoryOptions.find((option) => option.type === 'taxRate' && option.isDefault)?.value ??
    taxRates[0] ??
    15
  );
  const units = useMemo(
    () => [...new Set([...inventoryOptions.filter((option) => option.type === 'unit').map((option) => option.value), ...products.map((product) => product.unit)])].sort(),
    [inventoryOptions, products]
  );
  const defaultUnit =
    inventoryOptions.find((option) => option.type === 'unit' && option.isDefault)?.value ??
    units[0] ??
    EMPTY_FORM.unit;

  const generateNextSku = (baseSku?: string) => {
    const numericSkus = [
      ...products.map((product) => product.sku),
      ...(baseSku ? [baseSku] : []),
    ].filter((sku) => /^\d+$/.test(sku));
    const maxSku = numericSkus.reduce((max, sku) => Math.max(max, Number(sku)), 0);
    const width = Math.max(6, ...numericSkus.map((sku) => sku.length));
    let nextSku = String(maxSku + 1).padStart(width, '0');
    while (products.some((product) => product.sku.toLowerCase() === nextSku.toLowerCase())) {
      nextSku = String(Number(nextSku) + 1).padStart(width, '0');
    }
    return nextSku;
  };

  const generateNextBarcode = () => {
    const knownCodes = new Set(
      [
        ...products.flatMap((product) => [
          product.sku,
          product.barcode,
          ...(product.multiUnits || []).map((unit) => unit.barcode),
          ...(product.additionalBarcodes || []).map((entry) => entry.barcode),
        ]),
        form.sku,
        ...multiUnitDrafts.map((unit) => unit.barcode),
        ...additionalBarcodeDrafts.map((entry) => entry.barcode),
      ]
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean)
    );
    const numericCodes = [...knownCodes].filter((code) => /^\d+$/.test(code));
    const maxNumericCode = numericCodes.reduce(
      (max, code) => Math.max(max, Number(code)),
      890000000
    );
    const width = numericCodes.reduce((max, code) => Math.max(max, code.length), 9);
    let nextBarcode = String(maxNumericCode + 1).padStart(width, '0');
    while (knownCodes.has(nextBarcode.toLowerCase())) {
      nextBarcode = String(Number(nextBarcode) + 1).padStart(width, '0');
    }
    return nextBarcode;
  };

  const productCategories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [products]
  );

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter !== 'ALL' && p.category !== categoryFilter) {
        return false;
      }
      if (stockFilter === 'low' && !(p.stock > 0 && p.stock <= p.reorderLevel)) {
        return false;
      }
      if (stockFilter === 'out' && p.stock > 0) {
        return false;
      }
      if (search.trim() !== '') {
        const q = search.trim().toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.nameAr && p.nameAr.toLowerCase().includes(q)) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, categoryFilter, stockFilter, search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, stockFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));

  const sortedProducts = useMemo(() => {
    if (!sortConfig) return filteredProducts;

    const getValue = (product: Product): string | number => {
      switch (sortConfig.key) {
        case 'sku':
          return product.sku;
        case 'name':
          return isRtl ? product.nameAr || product.name : product.name;
        case 'category':
          return product.category;
        case 'costPrice':
          return product.costPrice;
        case 'retailPrice':
          return product.retailPrice;
        case 'stock':
          return product.stock;
        case 'unit':
          return product.unit;
        case 'taxRate':
          return product.taxRate ?? 15;
      }
    };

    return [...filteredProducts].sort((a, b) => {
      const aValue = getValue(a);
      const bValue = getValue(b);
      const comparison = typeof aValue === 'number' && typeof bValue === 'number'
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' });
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [filteredProducts, isRtl, sortConfig]);

  const toggleSort = (key: InventorySortKey) => {
    setSortConfig((current) => ({
      key,
      direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
    setCurrentPage(1);
  };

  const renderSortHeader = (key: InventorySortKey, label: string, alignClass = '') => {
    const active = sortConfig?.key === key;
    const direction = active ? sortConfig.direction : null;
    return (
      <th
        aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`py-2.5 px-4 ${alignClass}`}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={`inline-flex flex-col ${isRtl ? 'items-end' : 'items-start'} text-inherit hover:text-blue-700`}
          aria-label={`${label}: ${active ? (direction === 'asc' ? (isRtl ? 'تصاعدي' : 'Ascending') : (isRtl ? 'تنازلي' : 'Descending')) : (isRtl ? 'فرز' : 'Sort')}`}
        >
          <span>{label}</span>
          <span className={`text-[9px] font-medium normal-case ${active ? 'text-blue-700' : 'text-slate-400'}`}>
            {active
              ? direction === 'asc'
                ? (isRtl ? 'تصاعدي' : 'Ascending')
                : (isRtl ? 'تنازلي' : 'Descending')
              : (isRtl ? 'فرز' : 'Sort')}
          </span>
        </button>
      </th>
    );
  };

  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedProducts.slice(start, start + pageSize);
  }, [sortedProducts, currentPage, pageSize]);

  const openOptionDialog = (type: InventoryOptionType, option?: InventoryOption) => {
    setManagementType(type);
    setEditingOption(option || null);
    setOptionValue(option?.value || '');
    setOptionImageData(option?.imageData || '');
    setOptionFormError(null);
    setOptionReturnToProductField(null);
    setOptionDialogOpen(true);
  };

  const openProductOptionDialog = (type: ProductOptionField) => {
    openOptionDialog(type);
    setOptionReturnToProductField(type);
  };

  const handleOptionImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void readSupportedImageFile(file)
      .then((imageData) => {
        setOptionImageData(imageData);
        setOptionFormError(null);
      })
      .catch((error: unknown) => setOptionFormError((error as Error).message));
  };

  const handleProductImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void readSupportedImageFile(file)
      .then((imageData) => {
        setProductImageData(imageData);
        setProductImagePath('');
        setFormError(null);
      })
      .catch((error: unknown) => setFormError((error as Error).message));
  };

  const saveManagedOption = async (event: React.FormEvent) => {
    event.preventDefault();
    setOptionFormError(null);
    setOptionSaving(true);
    try {
      const response = await fetch(
        editingOption ? `/api/inventory-options/${editingOption.id}` : '/api/inventory-options',
        {
          method: editingOption ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: managementType,
            value: optionValue,
            ...(managementType === 'category' ? { imageData: optionImageData } : {}),
          }),
        }
      );
      const payload: unknown = await response.json();
      if (!response.ok || !isInventoryOption(payload)) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : 'Could not save this inventory option.';
        throw new Error(message);
      }

      setInventoryOptions((current) =>
        editingOption
          ? current.map((option) => option.id === payload.id ? payload : option)
          : [...current, payload]
      );
      const returnToProductField = optionReturnToProductField;
      if (returnToProductField && returnToProductField === payload.type) {
        setForm((current) => ({ ...current, [returnToProductField]: payload.value }));
        window.setTimeout(
          () => document.querySelector<HTMLElement>(`#product-form [data-product-field="${returnToProductField}"]`)?.focus(),
          0
        );
      }
      setOptionReturnToProductField(null);
      if (editingOption && editingOption.value !== payload.value) {
        await onRefreshProducts();
      }
      setOptionDialogOpen(false);
    } catch (error) {
      setOptionFormError((error as Error).message);
    } finally {
      setOptionSaving(false);
    }
  };

  const removeManagedOption = async (option: InventoryOption) => {
    const confirmed = window.confirm(
      `${isRtl ? 'حذف' : 'Delete'} ${option.type === 'taxRate' ? `${option.value}%` : option.value}?`
    );
    if (!confirmed) return;
    setOptionsError(null);
    try {
      const response = await fetch(`/api/inventory-options/${option.id}`, { method: 'DELETE' });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : 'Could not delete this inventory option.';
        throw new Error(message);
      }
      setInventoryOptions((current) => current.filter((item) => item.id !== option.id));
    } catch (error) {
      setOptionsError((error as Error).message);
    }
  };

  const setDefaultInventoryOption = async (option: InventoryOption) => {
    setOptionsError(null);
    try {
      const response = await fetch(`/api/inventory-options/${option.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: option.value, isDefault: true }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isInventoryOption(payload)) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : `Could not set the default ${option.type === 'taxRate' ? 'tax rate' : 'unit'}.`;
        throw new Error(message);
      }
      setInventoryOptions((current) =>
        current.map((entry) => entry.type === payload.type
          ? { ...entry, isDefault: entry.id === payload.id }
          : entry)
      );
    } catch (error) {
      setOptionsError((error as Error).message);
    }
  };

  const openCreateModal = (initialBarcode = '', initialCategory = '') => {
    setEditingProduct(null);
    setActiveProductTab('general');
    setProductHistoryFilter('all');
    setForm({
      ...EMPTY_FORM,
      sku: generateNextSku(),
      barcode: initialBarcode,
      category: initialCategory || categories[0] || EMPTY_FORM.category,
      brand: '',
      taxRate: String(defaultTaxRate),
      unit: defaultUnit,
    });
    setProductLookupCode('');
    setProductLookupMessage(null);
    setMultiUnitDrafts([]);
    setAdditionalBarcodeDrafts([]);
    setProductImagePath('');
    setProductImageData('');
    setFormError(null);
    setFormSuccess(null);
    setModalOpen(true);
  };

  useEffect(() => {
    if (createProductRequest > 0 && !optionsLoading) {
      openCreateModal(
        createProductBarcode,
        createServiceRequest ? TRAVEL_SERVICES_CATEGORY : ''
      );
      onCreateProductRequestHandled?.();
    }
  }, [
    createProductRequest,
    createProductBarcode,
    createServiceRequest,
    optionsLoading,
    onCreateProductRequestHandled,
  ]);

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setActiveProductTab('general');
    setProductHistoryFilter('all');
    setProductLookupCode('');
    setProductLookupMessage(null);
    setMultiUnitDrafts((product.multiUnits || []).map((unit) => ({
      id: unit.id,
      name: unit.name,
      barcode: unit.barcode,
      unitsPerBase: String(unit.unitsPerBase),
      packsPerBase: unit.unitsPerBase > 0 ? String(Number((1 / unit.unitsPerBase).toFixed(4))) : '1',
      price: unit.price === null ? '' : String(unit.price),
    })));
    setAdditionalBarcodeDrafts((product.additionalBarcodes || []).map((barcode) => ({
      id: crypto.randomUUID(),
      barcode: barcode.barcode,
      unitId: barcode.unitId || '',
    })));
    setForm({
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      nameAr: product.nameAr || '',
      category: product.category,
      brand: product.brand || '',
      costPrice: product.costPrice.toFixed(2),
      retailPrice: product.retailPrice.toFixed(2),
      taxRate: String(product.taxRate ?? 15),
      requiresItinerary: product.requiresItinerary === true,
      stock: '',
      reorderLevel: String(product.reorderLevel),
      unit: product.unit,
    });
    setProductImagePath(product.imagePath || '');
    setProductImageData(product.imageData || '');
    setFormError(null);
    setFormSuccess(null);
    setModalOpen(true);
  };

  useEffect(() => {
    if (
      !editProductOnly ||
      !editProductRequest ||
      optionsLoading ||
      handledEditRequestIdRef.current === editProductRequest.requestId
    ) {
      return;
    }
    const product =
      products.find((entry) => entry.id === editProductRequest.product.id) ||
      editProductRequest.product;
    openEditModal(product);
    handledEditRequestIdRef.current = editProductRequest.requestId;
  }, [editProductOnly, editProductRequest, optionsLoading, products]);

  const handleProductCodeLookup = () => {
    const code = productLookupCode.trim();
    if (!code) {
      setProductLookupMessage({
        type: 'error',
        message: isRtl ? 'أدخل الرمز الشريطي أو SKU.' : 'Enter a barcode or SKU.',
      });
      return;
    }

    const match =
      products.find((product) =>
        product.barcode.toLocaleLowerCase() === code.toLocaleLowerCase() ||
        product.multiUnits?.some((unit) => unit.barcode.toLocaleLowerCase() === code.toLocaleLowerCase()) ||
        product.additionalBarcodes?.some((barcode) => barcode.barcode.toLocaleLowerCase() === code.toLocaleLowerCase())
      ) ||
      products.find((product) => product.sku === code);
    if (match) {
      openEditModal(match);
      setProductLookupMessage({
        type: 'status',
        message: isRtl ? 'تم العثور على المنتج. يمكنك مراجعة التفاصيل وتعديلها.' : 'Product found. Review the details and make your changes.',
      });
      return;
    }

    const nextSku = /^\d+$/.test(code) ? code : generateNextSku();
    setEditingProduct(null);
    setMultiUnitDrafts([]);
    setAdditionalBarcodeDrafts([]);
    setForm({
      ...EMPTY_FORM,
      sku: nextSku,
      barcode: code,
      category: categories[0] || EMPTY_FORM.category,
      taxRate: String(defaultTaxRate),
      unit: defaultUnit,
    });
    setProductImagePath('');
    setProductImageData('');
    setFormError(null);
    setFormSuccess(null);
    setProductLookupMessage({
      type: 'status',
      message: isRtl
        ? 'لم يتم العثور على منتج بهذا الرمز. بدأ نموذج منتج جديد.'
        : 'No product matched this code. A new product form has been started.',
    });
    setProductLookupCode('');
  };

  const handleProductRowDoubleClick = (
    event: React.MouseEvent<HTMLElement>,
    product: Product
  ) => {
    if (event.target instanceof Element && event.target.closest('button, input, select, a')) return;
    setSelectedProductDetails(product);
  };

  const handleEditProductDetails = () => {
    if (!selectedProductDetails) return;
    const product = selectedProductDetails;
    setSelectedProductDetails(null);
    openEditModal(product);
  };

  const handleAutoTranslateName = async () => {
    if (!form.name.trim()) {
      setFormError('Please enter an English Product Name first before translating.');
      return;
    }
    setTranslating(true);
    setFormError(null);
    try {
      const translated = await translateEnglishToArabic(form.name);
      if (translated) {
        setForm((prev) => ({ ...prev, nameAr: translated }));
      }
    } catch (error) {
      setFormError((error as Error).message || 'Arabic translation failed.');
    } finally {
      setTranslating(false);
    }
  };

  const handleProductFieldEnter = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const fields = Array.from(
      e.currentTarget.form?.querySelectorAll<HTMLElement>('[data-product-field]') || []
    );
    const currentIndex = fields.indexOf(e.currentTarget);
    const nextField = fields[currentIndex + 1];
    if (nextField) {
      nextField.focus();
    } else {
      e.currentTarget.form?.requestSubmit();
    }
  };

  const handleTranslateAndAdvance = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const formElement = e.currentTarget.form;
    await handleAutoTranslateName();
    formElement?.querySelector<HTMLElement>('[data-product-field="sku"]')?.focus();
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim()) {
      setFormError('Product name is required.');
      return;
    }
    const sku = form.sku.trim() || editingProduct?.sku || generateNextSku();
    const otherProducts = products.filter((product) => product.id !== editingProduct?.id);
    const existingSkus = new Set(
      otherProducts.map((product) => product.sku.trim().toLocaleLowerCase())
    );
    const existingBarcodes = new Set(
      otherProducts
        .flatMap((product) => [
          product.barcode,
          ...(product.multiUnits || []).map((unit) => unit.barcode),
          ...(product.additionalBarcodes || []).map((entry) => entry.barcode),
        ])
        .map((code) => code.trim().toLocaleLowerCase())
        .filter(Boolean)
    );
    if (
      (!editingProduct || sku !== editingProduct.sku) &&
      !/^\d+$/.test(sku)
    ) {
      setFormError('SKU must contain numbers only.');
      return;
    }
    if (existingSkus.has(sku.toLocaleLowerCase())) {
      setFormError(`SKU ${sku} is already assigned to another product.`);
      return;
    }
    if (existingBarcodes.has(sku.toLocaleLowerCase())) {
      setFormError(`SKU ${sku} is already used as a barcode by another product.`);
      return;
    }
    const multiUnitEntries = multiUnitDrafts.filter(
      (unit) => unit.name.trim() || unit.barcode.trim() || unit.price.trim() || unit.unitsPerBase !== '1'
    );
    if (multiUnitEntries.some((unit) =>
      !unit.name.trim() ||
      !Number.isFinite(Number(unit.unitsPerBase)) ||
      Number(unit.unitsPerBase) <= 0 ||
      (unit.price.trim() !== '' && (!Number.isFinite(Number(unit.price)) || Number(unit.price) < 0))
    )) {
      setFormError('Complete each multi-unit name and conversion quantity, or remove the unfinished row.');
      return;
    }
    const multiUnits: ProductMultiUnit[] = multiUnitEntries.map((unit) => ({
      id: unit.id,
      name: unit.name.trim(),
      barcode: unit.barcode.trim(),
      unitsPerBase: Number(Number(unit.unitsPerBase).toFixed(6)),
      price: unit.price.trim() === '' ? null : Number(unit.price),
    }));
    const additionalBarcodes: ProductAdditionalBarcode[] = additionalBarcodeDrafts
      .filter((barcode) => barcode.barcode.trim())
      .map((barcode) => ({
        barcode: barcode.barcode.trim(),
        unitId: barcode.unitId || null,
      }));
    const barcode = form.barcode.trim();
    const submittedBarcodes = [
      barcode,
      ...multiUnits.map((unit) => unit.barcode),
      ...additionalBarcodes.map((entry) => entry.barcode),
    ].filter((code) => code.trim());
    const seenBarcodes = new Set<string>();
    for (const code of submittedBarcodes) {
      const normalizedCode = code.trim().toLocaleLowerCase();
      if (seenBarcodes.has(normalizedCode)) {
        setFormError(`Barcode ${code} is repeated in this product.`);
        return;
      }
      if (existingBarcodes.has(normalizedCode)) {
        setFormError(`Barcode ${code} is already assigned to another product.`);
        return;
      }
      if (existingSkus.has(normalizedCode)) {
        setFormError(`Barcode ${code} is already assigned as a SKU to another product.`);
        return;
      }
      seenBarcodes.add(normalizedCode);
    }

    setSaving(true);
    try {
      const enteredTaxRate = Number(form.taxRate);
      const payload = {
        sku,
        barcode,
        name: form.name.trim().toUpperCase(),
        nameAr: form.nameAr.trim() || undefined,
        category: form.category,
        brand: form.brand.trim() || undefined,
        costPrice: Math.max(0, Number(form.costPrice) || 0),
        retailPrice: Math.max(0, Number(form.retailPrice) || 0),
        taxRate: Number.isFinite(enteredTaxRate)
          ? Math.min(100, Math.max(0, enteredTaxRate))
          : 15,
        requiresItinerary: isServiceInventory && form.requiresItinerary,
        ...(editingProduct ? {} : { stock: Math.max(0, parseInt(form.stock, 10) || 0) }),
        reorderLevel: Math.max(0, parseInt(form.reorderLevel, 10) || 0),
        unit: form.unit.trim() || defaultUnit,
        multiUnits,
        additionalBarcodes,
        imagePath: productImagePath.trim(),
        imageData: productImageData,
      };

      const url = editingProduct
        ? `/api/products/${editingProduct.id}`
        : '/api/products';
      const method = editingProduct ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save product.');
      }

      await onRefreshProducts();
      if (editingProduct) {
        closeProductEditor();
      } else if (returnToSourceAfterCreate) {
        setModalOpen(false);
        onProductCreated?.();
      } else {
        setForm({
          ...EMPTY_FORM,
          sku: generateNextSku(form.sku),
          unit: defaultUnit,
          ...(isServiceInventory ? { category: TRAVEL_SERVICES_CATEGORY } : {}),
        });
        setMultiUnitDrafts([]);
        setAdditionalBarcodeDrafts([]);
        setProductImagePath('');
        setProductImageData('');
        setFormSuccess(isServiceInventory
          ? 'Service created. You can add another service.'
          : 'Product created. You can add another product.');
      }
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = (product: Product) => {
    setDeleteProductError(null);
    setProductPendingDelete(product);
  };

  const confirmDeleteProduct = async () => {
    if (!productPendingDelete || deletingProduct) return;
    const productToDelete = productPendingDelete;
    setDeletingProduct(true);
    try {
      const response = await fetch(`/api/products/${productToDelete.id}`, {
        method: 'DELETE',
      });
      const result = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || 'Failed to delete product.');
      if (!result.deleted) throw new Error('The product was not deleted.');
      await onRefreshProducts();
      setProductPendingDelete(null);
      if (editingProduct?.id === productToDelete.id) {
        closeProductEditor();
        setEditingProduct(null);
      }
    } catch (error) {
      setDeleteProductError(
        error instanceof Error ? error.message : 'Failed to delete product.'
      );
    } finally {
      setDeletingProduct(false);
    }
  };

  const handleExportExcel = () => {
    const headers = [
      'SKU',
      'Barcode',
      'Name',
      'Name (Arabic)',
      'Category',
      'Cost Price',
      'Retail Price',
      'Tax (%)',
      'Stock',
      'Reorder Level',
      'Unit',
    ];

    const rows = filteredProducts.map((p) => [
      p.sku,
      p.barcode,
      p.name,
      p.nameAr || '',
      p.category,
      p.costPrice,
      p.retailPrice,
      p.taxRate !== undefined ? p.taxRate : 15,
      p.stock,
      p.reorderLevel,
      p.unit,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 16 }, // SKU
      { wch: 18 }, // Barcode
      { wch: 34 }, // Name
      { wch: 34 }, // Name (Arabic)
      { wch: 18 }, // Category
      { wch: 12 }, // Cost Price
      { wch: 12 }, // Retail Price
      { wch: 10 }, // Tax (%)
      { wch: 10 }, // Stock
      { wch: 14 }, // Reorder Level
      { wch: 8 },  // Unit
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, `inventory-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleDownloadSampleExcel = () => {
    const sampleHeaders = [
      'SKU',
      'Barcode',
      'Name',
      'Name (Arabic)',
      'Category',
      'Cost Price',
      'Retail Price',
      'Tax (%)',
      'Stock',
      'Reorder Level',
      'Unit',
    ];

    const sampleRows = [
      ['WAT-101', '6281000101010', 'Al Qassim Water 24*200ml', 'ماء القصيم 24*200 مل', 'Beverages', 10.50, 15.00, 15, 100, 20, 'box'],
      ['BEV-106', '7891234567990', 'Organic Green Tea 330ml', 'شاي أخضر عضوي 330 مل', 'Beverages', 1.20, 2.95, 15, 45, 10, 'can'],
      ['SNK-305', '7891234567991', 'Roasted Salted Almonds 150g', 'لوز محمص ومملح 150 جم', 'Snacks', 2.40, 4.99, 15, 30, 8, 'bag'],
      ['BAK-208', '7891234567992', 'Sourdough Rye Loaf', 'خبز الجاودار العجين المخمر', 'Bakery & Pantry', 2.10, 4.50, 15, 15, 5, 'loaf'],
      ['HOU-404', '7891234567993', 'Bamboo Fiber Dish Towels 3pk', 'مناشف ألياف الخيزران 3 حبات', 'Household', 3.50, 7.99, 15, 25, 6, 'pkg'],
      ['STA-504', '7891234567994', 'Recycled Sticky Notes 4pk', 'أوراق ملاحظات لاصقة معاد تدويرها', 'Stationery', 1.50, 3.50, 15, 50, 15, 'pkg'],
    ];
    sampleRows.forEach((row, index) => {
      row[4] = categories[index % Math.max(categories.length, 1)] || '';
    });

    const ws = XLSX.utils.aoa_to_sheet([sampleHeaders, ...sampleRows]);
    ws['!cols'] = [
      { wch: 16 },
      { wch: 18 },
      { wch: 34 },
      { wch: 34 },
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 14 },
      { wch: 8 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sample Products');
    XLSX.writeFile(wb, 'products_sample_template.xlsx');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    setImportError(null);
    setImportSuccessMsg(null);

    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      let rawLines: any[][] = [];

      if (isExcel) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        if (!wb.SheetNames || wb.SheetNames.length === 0) {
          throw new Error('Excel workbook contains no sheets.');
        }
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        rawLines = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][];
      } else {
        // CSV: read buffer with fallback detection for UTF-8 (with or without BOM) and Windows-1256 (Arabic Excel)
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let text = '';
        if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
          text = new TextDecoder('utf-8').decode(bytes.subarray(3));
        } else {
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          } catch {
            try {
              text = new TextDecoder('windows-1256').decode(bytes);
            } catch {
              text = new TextDecoder().decode(bytes);
            }
          }
        }
        rawLines = parseCsv(text);
      }

      if (!rawLines || rawLines.length < 2) {
        throw new Error('The selected file is empty or has no data rows.');
      }

      const rawHeaders = (rawLines[0] || []).map((h) => String(h || '').trim());
      const cleanHeaders = rawHeaders.map((h) =>
        h.toLowerCase().replace(/[\s_\-()[\]]/g, '')
      );

      // 1. Arabic Name column (check first to avoid collision with English name)
      const nameArIdx = cleanHeaders.findIndex((h) =>
        h.includes('arabic') ||
        h.includes('namear') ||
        h.includes('arname') ||
        h.includes('عربي') ||
        h.includes('عرب')
      );

      // 2. English Name column
      const nameIdx = cleanHeaders.findIndex((h, idx) =>
        idx !== nameArIdx &&
        (h.includes('name') ||
          h.includes('title') ||
          h.includes('description') ||
          h.includes('item') ||
          h.includes('اسم'))
      );

      // 3. SKU column
      const skuIdx = cleanHeaders.findIndex((h) =>
        h === 'sku' ||
        h.includes('itemcode') ||
        h.includes('code') ||
        h.includes('itemno') ||
        h.includes('كود') ||
        h.includes('رمز')
      );

      // 4. Barcode column
      const barcodeIdx = cleanHeaders.findIndex((h) =>
        h.includes('barcode') ||
        h === 'upc' ||
        h === 'ean' ||
        h.includes('باركود') ||
        h.includes('بار')
      );

      const catIdx = cleanHeaders.findIndex((h) =>
        h.includes('category') ||
        h.includes('dept') ||
        h.includes('department') ||
        h.includes('فئة') ||
        h.includes('تصنيف') ||
        h.includes('قسم')
      );

      // 5. Cost price column (matches 'cost', 'unitcost', 'costprice', 'تكلفة', 'سعرالتكلفة', 'شراء')
      const costIdx = cleanHeaders.findIndex((h) =>
        h.includes('cost') ||
        h.includes('تكلفة') ||
        h.includes('شراء')
      );

      // 6. Retail / Selling price column (MUST NOT match the cost column!)
      // Excludes 'cost' / 'تكلفة' / 'شراء' and excludes costIdx so 'costprice' never matches retail!
      const retailIdx = cleanHeaders.findIndex((h, idx) =>
        idx !== costIdx &&
        !h.includes('cost') &&
        !h.includes('تكلفة') &&
        !h.includes('شراء') &&
        (h.includes('retail') ||
          h.includes('selling') ||
          h.includes('sale') ||
          h.includes('price') ||
          h.includes('سعر') ||
          h.includes('بيع'))
      );

      // 7. Tax (%) column (matches 'tax', 'vat', 'ضريبة', 'ضريبه')
      const taxIdx = cleanHeaders.findIndex((h) =>
        h.includes('tax') ||
        h.includes('vat') ||
        h.includes('ضريبة') ||
        h.includes('ضريبه')
      );

      const stockIdx = cleanHeaders.findIndex((h) =>
        h.includes('stock') ||
        h.includes('qty') ||
        h.includes('quantity') ||
        h.includes('units') ||
        h.includes('كمية') ||
        h.includes('مخزون') ||
        h.includes('رصيد')
      );

      const reorderIdx = cleanHeaders.findIndex((h) =>
        h.includes('reorder') ||
        h.includes('minstock') ||
        h.includes('حدالطلب') ||
        h.includes('طلب')
      );

      const unitIdx = cleanHeaders.findIndex((h) =>
        h === 'unit' ||
        h === 'uom' ||
        h.includes('وحدة')
      );

      if (skuIdx === -1 && nameIdx === -1 && nameArIdx === -1) {
        throw new Error('Could not identify SKU or Product Name columns in the header row. Please check the template format.');
      }

      const skuMap = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
      const barcodeMap = new Map(
        products.filter((p) => p.barcode).map((p) => [p.barcode.toLowerCase(), p])
      );

      const parsed: ParsedImportRow[] = [];
      for (let i = 1; i < rawLines.length; i++) {
        const row = rawLines[i];
        if (!row || row.length === 0 || row.every((c: any) => !String(c || '').trim())) continue;

        const rawSku = skuIdx !== -1 && row[skuIdx] !== undefined ? String(row[skuIdx]).trim() : '';
        const rawBarcode = barcodeIdx !== -1 && row[barcodeIdx] !== undefined ? String(row[barcodeIdx]).trim() : '';
        let rawName = nameIdx !== -1 && row[nameIdx] !== undefined ? String(row[nameIdx]).trim() : '';
        const rawNameAr = nameArIdx !== -1 && row[nameArIdx] !== undefined ? String(row[nameArIdx]).trim() : '';

        // If English name is empty but Arabic name exists, use Arabic name
        if (!rawName && rawNameAr) {
          rawName = rawNameAr;
        }
        if (!rawName) continue; // Skip nameless rows

        const sku = rawSku || (rawBarcode ? rawBarcode : `ITEM-${i}`);
        const barcode = rawBarcode;
        const name = rawName;
        const nameAr = rawNameAr || undefined;

        const category =
          catIdx !== -1 && row[catIdx]
            ? String(row[catIdx]).trim()
            : categories[0] || '';

        const costPrice = costIdx !== -1 ? Math.max(0, parseFloat(String(row[costIdx])) || 0) : 0;
        const retailPrice = retailIdx !== -1 ? Math.max(0, parseFloat(String(row[retailIdx])) || 0) : 0;
        const rawTaxRate = taxIdx !== -1 && row[taxIdx] !== undefined
          ? String(row[taxIdx]).trim().replace(/%$/, '').trim()
          : '';
        const taxRate = rawTaxRate ? Number(rawTaxRate) : defaultTaxRate;
        if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
          throw new Error(`Tax rate in row ${i + 1} must be a number between 0 and 100.`);
        }
        const stock = stockIdx !== -1 ? Math.max(0, parseInt(String(row[stockIdx]), 10) || 0) : 0;
        const reorderLevel = reorderIdx !== -1 ? Math.max(0, parseInt(String(row[reorderIdx]), 10) || 5) : 5;
        const unit = unitIdx !== -1 && row[unitIdx] !== undefined
          ? String(row[unitIdx]).trim() || defaultUnit
          : defaultUnit;

        const isExisting = Boolean(
          skuMap.get(sku.toLowerCase()) || (barcode ? barcodeMap.get(barcode.toLowerCase()) : false)
        );

        parsed.push({
          sku,
          barcode,
          name,
          nameAr,
          category,
          costPrice,
          retailPrice,
          taxRate,
          stock,
          reorderLevel,
          unit,
          isExisting,
        });
      }

      if (parsed.length === 0) {
        throw new Error('No valid product rows found in the file.');
      }

      setParsedRows(parsed);
      setImportModalOpen(true);
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setImportError(null);

    try {
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: parsedRows }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to import products.');
      }

      const errors = Array.isArray(data.errors)
        ? data.errors.filter((error: unknown): error is string => typeof error === 'string')
        : [];
      const optionsResponse = await fetch('/api/inventory-options');
      const optionsPayload: unknown = await optionsResponse.json();
      if (!optionsResponse.ok || !Array.isArray(optionsPayload) || !optionsPayload.every(isInventoryOption)) {
        const message =
          typeof optionsPayload === 'object' && optionsPayload !== null && 'error' in optionsPayload &&
          typeof optionsPayload.error === 'string'
            ? optionsPayload.error
            : 'Imported products, but could not refresh the managed tax rates.';
        setOptionsError(message);
      } else {
        setInventoryOptions(optionsPayload);
      }
      setImportModalOpen(false);
      if (errors.length > 0) {
        const visibleErrors = errors.slice(0, 8);
        setImportError([
          `Import completed with ${errors.length} rejected row(s).`,
          `${data.imported} new items created, ${data.updated} existing items updated.`,
          ...visibleErrors,
          ...(errors.length > visibleErrors.length
            ? [`...and ${errors.length - visibleErrors.length} more row error(s).`]
            : []),
        ].join('\n'));
        setImportSuccessMsg(null);
      } else {
        setImportSuccessMsg(
          `Import complete: ${data.imported} new items created, ${data.updated} existing items updated.`
        );
        setTimeout(() => setImportSuccessMsg(null), 5000);
      }
      void onRefreshProducts().catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        setImportError((currentError) =>
          [
            currentError,
            `Import completed, but refreshing inventory failed: ${reason}. Reload the page to view the imported products.`,
          ]
            .filter(Boolean)
            .join('\n')
        );
      });
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={editProductOnly ? 'hidden' : 'flex-1 overflow-y-auto p-2 sm:p-4 space-y-3 bg-white'}>
      {/* Import Notification Banner */}
      {importSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{importSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setImportSuccessMsg(null)}
            className="text-xs text-emerald-700 hover:text-emerald-900 underline font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {importError && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-medium whitespace-pre-line">{importError}</span>
          </div>
          <button
            type="button"
            onClick={() => setImportError(null)}
            className="text-xs text-red-700 hover:text-red-900 underline font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-end gap-1 border-b border-slate-300 bg-slate-100 px-2 pt-1.5 rounded-t-lg">
        {([
          ...(!isFlyErpMode ? [{ id: 'products' as const, label: isRtl ? 'المنتجات' : 'Products' }] : []),
          { id: 'services' as const, label: isRtl ? 'الخدمات' : 'Services' },
          { id: 'manage', label: isRtl ? 'إدارة الخيارات' : 'Manage' },
        ] as const).map((section) => {
          const active = inventorySection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setInventorySection(section.id)}
              className={`relative rounded-t-lg px-4 py-2 text-xs transition-colors ${
                active
                  ? 'z-10 -mb-px border border-b-white border-slate-300 bg-white font-semibold text-slate-900'
                  : 'border border-transparent font-medium text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              {section.label}
            </button>
          );
        })}
      </div>

      {inventorySection === 'products' && !isFlyErpMode ? (
      <>
      {/* Toolbar & Excel-like Table */}
      <div className="bg-white border border-slate-300 rounded-lg overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className={`w-4 h-4 text-slate-400 absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 pointer-events-none`} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isRtl ? 'البحث بالاسم، الرمز، أو الباركود...' : 'Search name, SKU, or barcode...'}
                className={`w-full ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-blue-700`}
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label={isRtl ? 'تصفية حسب التصنيف' : 'Filter by category'}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-blue-700 focus:outline-none"
            >
              <option value="ALL">{isRtl ? 'كل التصنيفات' : 'All Categories'}</option>
              {productCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {(
                [
                  { id: 'all', label: isRtl ? 'كل المخزون' : 'All Stock' },
                  { id: 'low', label: isRtl ? 'مخزون منخفض' : 'Low Stock' },
                  { id: 'out', label: isRtl ? 'نفد المخزون' : 'Out of Stock' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStockFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    stockFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={optionsLoading}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
              title={isRtl ? 'استيراد منتجات من ملف إكسل أو CSV' : 'Import products from Excel (.xlsx, .xls) or CSV'}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>{isRtl ? 'استيراد إكسل' : 'Import Excel'}</span>
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              title={isRtl ? 'تصدير قائمة المنتجات إلى إكسل' : 'Export products list to Excel (.xlsx)'}
            >
              <Download className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>{isRtl ? 'تصدير إكسل' : 'Export Excel'}</span>
            </button>
            <button
              type="button"
              onClick={() => openCreateModal()}
              disabled={optionsLoading}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isRtl ? 'إضافة منتج' : 'Add Product'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Inventory Cards View (< md) */}
        <div className="md:hidden divide-y divide-slate-100">
          {paginatedProducts.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              {isRtl ? 'لا توجد أصناف مطابقة للبحث الحالي.' : 'No inventory items match the current filter.'}
            </div>
          ) : (
            paginatedProducts.map((p) => {
              return (
                <div
                  key={p.id}
                  className="p-3.5 space-y-2.5"
                  title={isRtl ? 'انقر مرتين لعرض تفاصيل المنتج' : 'Double-click to view product details'}
                  onDoubleClick={(event) => handleProductRowDoubleClick(event, p)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 text-xs leading-snug">
                        {isRtl && p.nameAr ? p.nameAr : p.name}
                      </div>
                      {isRtl && p.name && (
                        <div className="text-[11px] text-slate-500 font-sans mt-0.5">
                          {p.name}
                        </div>
                      )}
                      {!isRtl && p.nameAr && (
                        <div className="text-[11px] text-blue-700 font-semibold font-arabic mt-0.5" dir="rtl">
                          {p.nameAr}
                        </div>
                      )}
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {p.sku} · {p.barcode}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                    <div className="space-y-0.5">
                      <div className="text-[11px] text-slate-500">
                        {isRtl ? 'البيع: ' : 'Retail: '}
                        <span className="font-mono font-bold text-slate-900">{c}{p.retailPrice.toFixed(2)}</span>
                        {' '}({isRtl ? 'التكلفة: ' : 'Cost: '}
                        <span className="font-mono">{c}{p.costPrice.toFixed(2)}</span>)
                      </div>
                      <div className="text-xs font-semibold text-slate-900 font-mono">
                        {isRtl ? `المخزون: ${p.stock} ${p.unit}` : `Stock: ${p.stock} ${p.unit}`}
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                        <span>
                          {isRtl ? 'الوحدة الأساسية:' : 'Base unit:'} <strong className="text-slate-700">{p.unit}</strong>
                        </span>
                        <span>
                          {isRtl ? 'فئة الضريبة:' : 'Tax category:'}{' '}
                          <strong className="text-slate-700">{p.taxRate ?? 15}%</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditModal(p)}
                        className="p-1.5 text-slate-600 hover:text-blue-700 rounded hover:bg-slate-100"
                        aria-label={`Edit ${p.name}`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Excel-like Table View (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className={`w-full ${isRtl ? 'text-right' : 'text-left'} border-collapse text-xs`}>
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-semibold text-slate-700 [&>th]:border-e [&>th]:border-slate-300 [&>th:last-child]:border-e-0">
                {renderSortHeader('sku', isRtl ? 'الرمز / الباركود' : 'SKU / Barcode')}
                {renderSortHeader('name', isRtl ? 'اسم المنتج' : 'Product Name')}
                {renderSortHeader('category', isRtl ? 'التصنيف' : 'Category')}
                {renderSortHeader('costPrice', isRtl ? 'التكلفة' : 'Cost', isRtl ? 'text-left' : 'text-right')}
                {renderSortHeader('retailPrice', isRtl ? 'البيع' : 'Retail', isRtl ? 'text-left' : 'text-right')}
                {renderSortHeader('stock', isRtl ? 'المتوفر' : 'On Hand', isRtl ? 'text-left' : 'text-right')}
                {renderSortHeader('unit', isRtl ? 'الوحدة' : 'Unit')}
                {renderSortHeader('taxRate', isRtl ? 'الضريبة' : 'Tax %', isRtl ? 'text-left' : 'text-right')}
                <th className="py-2 px-3 text-center w-16">{isRtl ? 'تعديل' : 'Edit'}</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500 border-b border-slate-200">
                    {isRtl ? 'لا توجد أصناف مطابقة للبحث الحالي.' : 'No inventory items match the current filter.'}
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((p) => {
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-slate-200 even:bg-slate-50/60 hover:bg-blue-50/50 transition-colors [&>td]:border-e [&>td]:border-slate-200 [&>td:last-child]:border-e-0"
                      onDoubleClick={(event) => handleProductRowDoubleClick(event, p)}
                    >
                      <td className="py-1.5 px-2.5 font-mono text-slate-700 whitespace-nowrap">
                        <span className="font-semibold text-slate-900">{p.sku}</span>
                        {p.barcode && <span className="ml-1.5 text-[11px] text-slate-400">{p.barcode}</span>}
                      </td>
                      <td className="py-1.5 px-2.5 font-medium text-slate-900">
                        {isRtl ? (
                          <span>
                            {p.nameAr || p.name}
                            {p.nameAr && p.name && <span className="ml-2 text-[11px] font-normal text-slate-500">{p.name}</span>}
                          </span>
                        ) : (
                          <span>
                            {p.name}
                            {p.nameAr && <span className="ml-2 text-[11px] text-slate-500" dir="rtl">{p.nameAr}</span>}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-700 whitespace-nowrap">
                        {p.category}
                      </td>
                      <td className={`py-1.5 px-2.5 ${isRtl ? 'text-left' : 'text-right'} font-mono text-slate-700 tabular-nums whitespace-nowrap`}>
                        {p.costPrice.toFixed(2)}
                      </td>
                      <td className={`py-1.5 px-2.5 ${isRtl ? 'text-left' : 'text-right'} font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap`}>
                        {p.retailPrice.toFixed(2)}
                      </td>
                      <td className={`py-1.5 px-2.5 ${isRtl ? 'text-left' : 'text-right'} font-mono font-semibold tabular-nums whitespace-nowrap ${
                        p.stock <= 0 ? 'text-rose-700' : p.stock <= p.reorderLevel ? 'text-amber-700' : 'text-slate-900'
                      }`}>
                        {p.stock}
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-600 whitespace-nowrap">
                        {p.unit}
                      </td>
                      <td className={`py-1.5 px-2.5 ${isRtl ? 'text-left' : 'text-right'} font-mono text-slate-600 tabular-nums whitespace-nowrap`}>
                        {p.taxRate ?? 15}%
                      </td>
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          className="p-1 text-slate-500 hover:text-blue-700 rounded hover:bg-blue-50"
                          aria-label={`Edit ${p.name}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        {filteredProducts.length > 0 && (
          <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>
                {isRtl ? (
                  <>عرض <strong className="text-slate-900">{(currentPage - 1) * pageSize + 1}</strong> إلى <strong className="text-slate-900">{Math.min(currentPage * pageSize, filteredProducts.length)}</strong> من أصل <strong className="text-slate-900">{filteredProducts.length}</strong> صنف</>
                ) : (
                  <>Showing{' '}<strong className="text-slate-900">{(currentPage - 1) * pageSize + 1}</strong>{' '}to{' '}<strong className="text-slate-900">{Math.min(currentPage * pageSize, filteredProducts.length)}</strong>{' '}of <strong className="text-slate-900">{filteredProducts.length}</strong> products</>
                )}
              </span>
              <span className="text-slate-300">|</span>
              <div className="flex items-center gap-1.5">
                <span>{isRtl ? 'في الصفحة:' : 'Per page:'}</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-slate-800 text-xs font-semibold focus:outline-none focus:border-blue-700"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold text-slate-700 transition-colors"
              >
                {isRtl ? 'السابق' : 'Previous'}
              </button>

              <span className="px-3 py-1 font-mono text-xs font-bold text-slate-900 bg-slate-100 rounded-lg">
                {isRtl ? `${currentPage} من ${totalPages}` : `Page ${currentPage} of ${totalPages}`}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold text-slate-700 transition-colors"
              >
                {isRtl ? 'التالي' : 'Next'}
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      ) : inventorySection === 'services' ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className={`pointer-events-none absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400`} />
              <input
                type="search"
                value={servicesSearch}
                onChange={(event) => setServicesSearch(event.target.value)}
                placeholder={isRtl ? 'البحث عن الخدمات المحفوظة...' : 'Search saved services...'}
                aria-label={isRtl ? 'البحث عن الخدمات' : 'Search services'}
                className={`w-full rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs text-slate-900 focus:border-blue-700 focus:bg-white focus:outline-none ${isRtl ? 'pl-3 pr-9' : 'pl-9 pr-3'}`}
              />
            </div>
            <button
              type="button"
              onClick={() => openCreateModal('', TRAVEL_SERVICES_CATEGORY)}
              disabled={optionsLoading}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {isRtl ? 'إضافة خدمة' : 'Add Service'}
            </button>
          </div>
          <div className="max-h-[min(70vh,640px)] overflow-auto">
            <table className={`w-full min-w-[620px] border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-2.5">{isRtl ? 'اسم الخدمة' : 'Service'}</th>
                  <th className="border-b border-slate-200 px-4 py-2.5">{isRtl ? 'الرمز' : 'Code'}</th>
                  <th className={`border-b border-slate-200 px-4 py-2.5 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'السعر' : 'Price'}</th>
                  <th className={`border-b border-slate-200 px-4 py-2.5 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الضريبة' : 'Tax'}</th>
                  <th className="border-b border-slate-200 px-4 py-2.5 text-center">{isRtl ? 'الإجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredServices.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                      {servicesSearch.trim()
                        ? (isRtl ? 'لا توجد خدمات تطابق البحث.' : 'No services match your search.')
                        : (isRtl ? 'لا توجد خدمات محفوظة. أضف خدمة للبدء.' : 'No saved services yet. Add a service to get started.')}
                    </td>
                  </tr>
                ) : filteredServices.map((service) => (
                  <tr key={service.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      <div>{isRtl ? service.nameAr || service.name : service.name}</div>
                      {!isRtl && service.nameAr && (
                        <div className="mt-0.5 text-[11px] text-slate-500" dir="rtl">{service.nameAr}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{service.sku || '—'}</td>
                    <td className={`px-4 py-2.5 font-mono font-semibold tabular-nums text-slate-900 ${isRtl ? 'text-left' : 'text-right'}`}>
                      {c}{service.retailPrice.toFixed(2)}
                    </td>
                    <td className={`px-4 py-2.5 font-mono tabular-nums text-slate-600 ${isRtl ? 'text-left' : 'text-right'}`}>
                      {service.taxRate ?? settings.taxRate}%
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => openEditModal(service)}
                        className="rounded p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                        aria-label={`${isRtl ? 'تعديل الخدمة' : 'Edit service'} ${service.name}`}
                        title={isRtl ? 'تعديل الخدمة' : 'Edit service'}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">{isRtl ? 'إدارة بيانات المنتجات' : 'Manage Product Data'}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {isRtl ? 'إدارة التصنيفات والعلامات التجارية والضرائب ووحدات القياس.' : 'Manage categories, brands, tax rates, and units of measure.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openOptionDialog(managementType)}
              disabled={optionsLoading}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {isRtl ? 'إضافة' : 'Add'} {managementType === 'taxRate' ? (isRtl ? 'ضريبة' : 'Tax Rate') : managementType === 'category' ? (isRtl ? 'تصنيف' : 'Category') : managementType === 'brand' ? (isRtl ? 'علامة تجارية' : 'Brand') : (isRtl ? 'وحدة' : 'Unit')}
            </button>
          </div>

          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 p-2">
            {([
              { id: 'category', label: isRtl ? 'التصنيفات' : 'Categories' },
              { id: 'brand', label: isRtl ? 'العلامات التجارية' : 'Brands' },
              { id: 'taxRate', label: isRtl ? 'معدلات الضريبة' : 'Tax Rates' },
              { id: 'unit', label: isRtl ? 'وحدات القياس' : 'Units of Measure' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setManagementType(tab.id)}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  managementType === tab.id
                    ? 'bg-white text-blue-800 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {optionsError && (
            <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {optionsError}
            </div>
          )}

          {optionsLoading ? (
            <div className="p-10 text-center text-sm text-slate-500">{isRtl ? 'جارٍ تحميل الخيارات...' : 'Loading options...'}</div>
          ) : managementType === 'category' ? (
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 sm:gap-4 sm:p-5">
              {inventoryOptions.filter((option) => option.type === 'category').map((option) => {
                const productCount = products.filter((product) => product.category === option.value).length;
                return (
                  <article key={option.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                    <div className="flex aspect-square items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50">
                      {option.imageData ? (
                        <img src={option.imageData} alt={option.value} className="h-auto w-auto max-h-full max-w-full object-contain" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
                          <Upload className="h-9 w-9" />
                          <span className="text-[10px] font-medium text-slate-400">{isRtl ? 'لا توجد صورة' : 'No image'}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1.5">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-slate-900" title={option.value}>{option.value}</h3>
                        <p className="mt-0.5 text-[11px] text-slate-500">{productCount} {isRtl ? 'منتج' : 'products'}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openOptionDialog('category', option)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                          aria-label={`${isRtl ? 'تعديل' : 'Edit'} ${option.value}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeManagedOption(option)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                          aria-label={`${isRtl ? 'حذف' : 'Delete'} ${option.value}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4 sm:p-5">
              {inventoryOptions.filter((option) => option.type === managementType).map((option) => (
                <article key={option.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-900">
                      {managementType === 'taxRate' ? `${option.value}%` : option.value}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {(managementType === 'taxRate' || managementType === 'unit') && option.isDefault
                        ? (isRtl ? 'الافتراضي' : 'Default')
                        : managementType === 'brand'
                          ? (isRtl ? 'علامة تجارية' : 'Brand')
                          : managementType === 'taxRate'
                            ? (isRtl ? 'معدل الضريبة' : 'Tax rate')
                            : (isRtl ? 'وحدة قياس' : 'Unit of measure')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {(managementType === 'taxRate' || managementType === 'unit') && !option.isDefault && (
                      <button
                        type="button"
                        onClick={() => void setDefaultInventoryOption(option)}
                        className="rounded-lg px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        {isRtl ? 'تعيين كافتراضي' : 'Set default'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openOptionDialog(managementType, option)}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                      aria-label={`${isRtl ? 'تعديل' : 'Edit'} ${option.value}`}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeManagedOption(option)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                      aria-label={`${isRtl ? 'حذف' : 'Delete'} ${option.value}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </article>
              ))}
              {inventoryOptions.filter((option) => option.type === managementType).length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-slate-500">
                  {isRtl ? 'لا توجد خيارات بعد.' : 'No options yet.'}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {optionDialogOpen && createPortal(
        <div
          className={`fixed inset-0 ${editProductOnly ? 'z-[110]' : 'z-[70]'} flex items-center justify-center bg-slate-900/60 p-3 sm:p-4`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-option-title"
        >
          <form
            onSubmit={saveManagedOption}
            data-theme={theme}
            className="pos-app-shell w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 id="inventory-option-title" className="text-base font-bold text-slate-900">
                {editingOption ? (isRtl ? 'تعديل' : 'Edit') : (isRtl ? 'إضافة' : 'Add')} {managementType === 'category' ? (isRtl ? 'تصنيف' : 'Category') : managementType === 'brand' ? (isRtl ? 'علامة تجارية' : 'Brand') : managementType === 'taxRate' ? (isRtl ? 'معدل ضريبة' : 'Tax Rate') : (isRtl ? 'وحدة قياس' : 'Unit of Measure')}
              </h2>
              <button
                type="button"
                onClick={() => setOptionDialogOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              {optionFormError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {optionFormError}
                </div>
              )}
              <div>
                <label htmlFor="inventory-option-value" className="mb-1 block text-xs font-semibold text-slate-700">
                  {managementType === 'taxRate' ? (isRtl ? 'معدل الضريبة (%)' : 'Tax rate (%)') : managementType === 'category' ? (isRtl ? 'اسم التصنيف' : 'Category name') : managementType === 'brand' ? (isRtl ? 'اسم العلامة التجارية' : 'Brand name') : (isRtl ? 'اسم الوحدة' : 'Unit name')}
                </label>
                <input
                  id="inventory-option-value"
                  required
                  type={managementType === 'taxRate' ? 'number' : 'text'}
                  min={managementType === 'taxRate' ? 0 : undefined}
                  max={managementType === 'taxRate' ? 100 : undefined}
                  step={managementType === 'taxRate' ? '0.01' : undefined}
                  maxLength={managementType === 'taxRate' ? undefined : 100}
                  value={optionValue}
                  onChange={(event) => setOptionValue(event.target.value)}
                  placeholder={managementType === 'taxRate' ? '15' : ''}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {managementType === 'category' && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">{isRtl ? 'صورة التصنيف' : 'Category image'}</label>
                  <input
                    ref={optionImageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleOptionImageChange}
                  />
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-300">
                      {optionImageData ? (
                        <img src={optionImageData} alt={optionValue || 'Category preview'} className="h-auto w-auto max-h-full max-w-full object-contain" />
                      ) : (
                        <Upload className="h-6 w-6" />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => optionImageInputRef.current?.click()}
                        className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        {isRtl ? 'اختيار صورة' : 'Choose image'}
                      </button>
                      {optionImageData && (
                        <button
                          type="button"
                          onClick={() => setOptionImageData('')}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          {isRtl ? 'إزالة' : 'Remove'}
                        </button>
                      )}
                      <p className="w-full text-[10px] text-slate-500">JPEG, PNG, WebP · max 1.5 MB</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setOptionDialogOpen(false)}
                disabled={optionSaving}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={optionSaving}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {optionSaving ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...') : (isRtl ? 'حفظ' : 'Save')}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {productPendingDelete && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-product-title"
          dir={isRtl ? 'rtl' : 'ltr'}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingProduct) {
              setProductPendingDelete(null);
              setDeleteProductError(null);
            }
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="delete-product-title" className="text-base font-bold text-slate-900">
                  {isRtl ? 'تأكيد حذف المنتج' : 'Delete product?'}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isRtl ? 'يرجى مراجعة المنتج قبل تأكيد الحذف.' : 'Review this product before confirming.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (deletingProduct) return;
                  setProductPendingDelete(null);
                  setDeleteProductError(null);
                }}
                disabled={deletingProduct}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-50"
                aria-label={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-4 p-5">
              {deleteProductError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {isRtl && deleteProductError.toLowerCase().includes('transaction history')
                      ? 'لا يمكن حذف هذا المنتج لوجود معاملات سابقة مرتبطة به.'
                      : deleteProductError}
                  </span>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="truncate text-sm font-bold text-slate-900">
                  {productPendingDelete.name}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span>SKU: <strong className="font-mono text-slate-700">{productPendingDelete.sku}</strong></span>
                  <span>
                    {isRtl ? 'المخزون:' : 'Stock:'}{' '}
                    <strong className="font-mono text-slate-700">
                      {productPendingDelete.stock} {productPendingDelete.unit}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <p>
                  {isRtl
                    ? 'لا يمكن حذف منتج مرتبط بمعاملة بيع أو شراء. حذف المنتج غير قابل للتراجع.'
                    : 'Products linked to a sale or purchase cannot be deleted. Deletion cannot be undone.'}
                </p>
              </div>
            </div>

            <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
              <button
                type="button"
                onClick={() => {
                  setProductPendingDelete(null);
                  setDeleteProductError(null);
                }}
                disabled={deletingProduct}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteProduct()}
                disabled={
                  deletingProduct ||
                  Boolean(deleteProductError?.toLowerCase().includes('transaction history'))
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletingProduct
                  ? (isRtl ? 'جارٍ الحذف...' : 'Deleting...')
                  : (isRtl ? 'حذف المنتج' : 'Delete product')}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {modalOpen && createPortal(
        <div
          className={`fixed inset-0 ${editProductOnly ? 'z-[100]' : 'z-50'} bg-slate-900/60 flex items-center justify-center p-2 sm:p-4`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-modal-title"
          onKeyDown={(e) => {
            if (e.altKey && e.key.toLowerCase() === 's') {
              e.preventDefault();
              e.stopPropagation();
              if (!saving && !optionDialogOpen) {
                e.currentTarget
                  .querySelector<HTMLFormElement>('#product-form')
                  ?.requestSubmit();
              }
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              if (!saving) closeProductEditor();
            }
          }}
        >
          <div
            data-theme={theme}
            className="pos-app-shell bg-white border border-slate-200 rounded-xl w-full max-w-3xl h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
          >
            <div className="shrink-0 border-b border-slate-200 px-3 py-2.5 sm:px-5 sm:py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="product-modal-title" className="shrink-0 text-sm font-semibold text-slate-900 sm:text-base">
                  {editingProduct
                    ? (isServiceInventory
                        ? (isRtl ? 'تعديل الخدمة' : 'Edit Service')
                        : (isRtl ? 'تعديل المنتج' : 'Edit Product'))
                    : (isServiceInventory
                        ? (isRtl ? 'إضافة خدمة جديدة' : 'Add New Service')
                        : (isRtl ? 'إضافة منتج جديد' : 'Add New Product'))}
                </h2>
                {!isServiceInventory && (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-xs">
                    <label htmlFor="product-code-lookup" className="sr-only">
                      {isRtl ? 'امسح أو أدخل الباركود أو SKU' : 'Scan or enter a product barcode or SKU'}
                    </label>
                    <input
                      id="product-code-lookup"
                      ref={productLookupInputRef}
                      type="text"
                      autoComplete="off"
                      value={productLookupCode}
                      onChange={(event) => {
                        setProductLookupCode(event.target.value);
                        setProductLookupMessage(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleProductCodeLookup();
                        }
                      }}
                      placeholder={isRtl ? 'امسح الباركود أو SKU' : 'Scan barcode or SKU'}
                      className="w-36 min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none sm:w-40"
                    />
                    <button
                      type="button"
                      onClick={handleProductCodeLookup}
                      className="shrink-0 rounded-lg bg-blue-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                    >
                      {isRtl ? 'بحث' : 'Find'}
                    </button>
                  </div>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={closeProductEditor}
                  className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
                >
                  {isRtl ? 'إلغاء (Esc)' : 'Cancel (Esc)'}
                </button>
                {editingProduct && !editProductOnly && (
                  <button
                    type="button"
                    onClick={() => handleDeleteProduct(editingProduct)}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {isRtl ? 'حذف' : 'Delete'}
                  </button>
                )}
                <button
                  type="submit"
                  form="product-form"
                  disabled={saving}
                  title={isServiceInventory
                    ? (isRtl ? 'حفظ الخدمة (Alt+S)' : 'Save service (Alt+S)')
                    : (isRtl ? 'حفظ المنتج (Alt+S)' : 'Save product (Alt+S)')}
                  aria-keyshortcuts="Alt+S"
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50"
                >
                  {saving
                    ? (isRtl ? 'جاري الحفظ...' : 'Saving...')
                    : editingProduct
                    ? (isRtl ? 'حفظ' : 'Save')
                    : (isRtl ? 'إنشاء' : 'Create')}
                </button>
                </div>
              </div>
              {!isServiceInventory && productLookupMessage && (
                <p
                  role={productLookupMessage.type === 'error' ? 'alert' : 'status'}
                  className={`mt-1 text-[11px] ${
                    productLookupMessage.type === 'error' ? 'text-red-700' : 'text-blue-800'
                  }`}
                >
                  {productLookupMessage.message}
                </p>
              )}
              <nav
                className={`mt-3 flex gap-1 overflow-x-auto border-b border-slate-200 ${isRtl ? 'flex-row-reverse' : ''}`}
                role="tablist"
                aria-label={isServiceInventory
                  ? (isRtl ? 'أقسام نموذج الخدمة' : 'Service form sections')
                  : (isRtl ? 'أقسام نموذج المنتج' : 'Product form sections')}
              >
                {([
                  { id: 'general', label: isRtl ? 'عام' : 'General' },
                  ...(!isServiceInventory
                    ? [{ id: 'advanced' as const, label: isRtl ? 'متقدم' : 'Advanced' }]
                    : []),
                  { id: 'history', label: isRtl ? 'السجل' : 'History' },
                  ...(!isServiceInventory
                    ? [{ id: 'settings' as const, label: isRtl ? 'الإعدادات' : 'Settings' }]
                    : []),
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    id={`product-form-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={activeProductTab === tab.id}
                    aria-controls="product-form-panel"
                    onClick={() => setActiveProductTab(tab.id)}
                    className={`shrink-0 border-b-2 px-4 py-2 text-xs font-semibold transition-colors ${
                      activeProductTab === tab.id
                        ? 'border-blue-700 text-blue-800'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <form
              id="product-form"
              noValidate
              onSubmit={handleSaveProduct}
              className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4 space-y-1.5 sm:space-y-2.5 text-xs"
            >
              {formError && (
                <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-800">
                  {formError}
                </div>
              )}
              {formSuccess && (
                <div role="status" className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800">
                  {formSuccess}
                </div>
              )}
              <div
                id="product-form-panel"
                role="tabpanel"
                aria-labelledby={`product-form-tab-${activeProductTab}`}
                className="space-y-2.5 sm:space-y-3"
              >

              {activeProductTab === 'general' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                <div>
                  <div className="mb-1 flex min-h-5 items-center">
                    <label className="block font-medium text-slate-700">
                      {isServiceInventory
                        ? (isRtl ? 'اسم الخدمة (إنجليزي) *' : 'Service Name (English) *')
                        : (isRtl ? 'اسم المنتج (إنجليزي) *' : 'Product Name (English) *')}
                    </label>
                  </div>
                  <input
                    type="text"
                    required
                    ref={productNameInputRef}
                    data-product-field="name"
                    value={form.name}
                    onKeyDown={handleProductFieldEnter}
                    onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })}
                    placeholder={isServiceInventory ? 'e.g., Flight Ticket' : 'e.g., Cold Brew 330ml'}
                    className="w-full px-2.5 py-1.5 uppercase border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <div className="mb-1 flex min-h-5 items-center justify-between gap-1">
                    <label className="block font-medium text-slate-700">
                      {isServiceInventory
                        ? (isRtl ? 'اسم الخدمة (عربي)' : 'Service Name (Arabic)')
                        : (isRtl ? 'اسم المنتج (عربي)' : 'Product Name (Arabic)')}
                    </label>
                    <button
                      type="button"
                      disabled={translating || !form.name.trim()}
                      onClick={handleAutoTranslateName}
                      className="inline-flex items-center gap-1 rounded px-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 disabled:text-slate-400"
                      title="Translate the English product name to Arabic"
                    >
                      {translating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Languages className="h-3.5 w-3.5" />
                      )}
                      <span>{translating ? 'Translating...' : 'Translate'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    dir="rtl"
                    data-product-field="nameAr"
                    value={form.nameAr}
                    onKeyDown={handleTranslateAndAdvance}
                    onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                    placeholder="مثال: شاي أخضر عضوي 330 مل"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                </div>
              )}

              {activeProductTab === 'advanced' && isRposMode && !isServiceInventory && (
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-400">
                  {productImagePath || productImageData ? (
                    <ProductImage
                      imagePath={productImagePath}
                      imageData={productImageData}
                      alt={form.name || (isRtl ? 'معاينة صورة المنتج' : 'Product image preview')}
                      className="h-auto w-auto max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <span className="mb-1 block font-medium text-slate-700">
                      {isRtl ? 'صورة المنتج' : 'Product Image'}
                    </span>
                    <input
                      ref={productImageInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleProductImageChange}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => productImageInputRef.current?.click()}
                        className="rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        {isRtl ? 'اختيار صورة' : 'Choose image'}
                      </button>
                      {(productImageData || productImagePath) && (
                        <button
                          type="button"
                          onClick={() => {
                            setProductImageData('');
                            setProductImagePath('');
                          }}
                          className="text-[10px] font-medium text-slate-600 hover:text-red-700"
                        >
                          {isRtl ? 'إزالة الصورة' : 'Remove image'}
                        </button>
                      )}
                      <span className="text-[10px] text-slate-500">JPEG, PNG, WebP · max 1.5 MB</span>
                    </div>
                  </div>
                </div>
                </div>
              )}

              {activeProductTab === 'general' && !isServiceInventory && (
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'الرمز (SKU)' : 'SKU'}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]+"
                    title="Numbers only"
                    data-product-field="sku"
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    value={form.sku}
                    onKeyDown={handleProductFieldEnter}
                    onChange={(e) => setForm({ ...form, sku: e.target.value.replace(/\D/g, '') })}
                    placeholder="0001"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">Generated from the latest SKU; editable.</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block font-medium text-slate-700">
                      {isRtl ? 'الباركود (اختياري)' : 'Barcode (optional)'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, barcode: generateNextBarcode() }))}
                      aria-label={isRtl ? 'إنشاء باركود متسلسل' : 'Generate sequential barcode'}
                      title={isRtl ? 'إنشاء باركود متسلسل' : 'Generate sequential barcode'}
                      className="rounded-md p-1 text-blue-700 hover:bg-blue-50"
                    >
                      <Barcode className="h-4 w-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    data-product-field="barcode"
                    onKeyDown={handleProductFieldEnter}
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    placeholder={isRtl ? 'أدخل أو أنشئ باركود' : 'Enter or generate a barcode'}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>
              )}

              {activeProductTab === 'general' && (
              <div className={`grid gap-2 sm:gap-3 ${isServiceInventory ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {!isServiceInventory && (
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    {isRtl ? `سعر التكلفة (${c})` : `Cost Price (${c})`}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    data-product-field="costPrice"
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    onKeyDown={handleProductFieldEnter}
                    value={form.costPrice}
                    onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
                )}
                <div>
                  <label className="mb-1 block font-medium text-slate-700">
                    {isServiceInventory
                      ? (isRtl ? `سعر الخدمة (${c})` : `Service Price (${c})`)
                      : (isRtl ? `سعر البيع (${c})` : `Selling Price (${c})`)}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    data-product-field="retailPrice"
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    onKeyDown={handleProductFieldEnter}
                    value={form.retailPrice}
                    onChange={(e) => setForm({ ...form, retailPrice: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              </div>
              )}

              {activeProductTab === 'general' && isServiceInventory && (
                <div className="space-y-3">
                  <section className="rounded-lg border border-slate-200 bg-white p-3">
                    <h3 className="font-semibold text-slate-800">
                      {isRtl ? 'إعدادات الخدمة' : 'Service Settings'}
                    </h3>
                    <p className="mb-3 mt-0.5 text-[10px] text-slate-500">
                      {isRtl
                        ? 'إعدادات الضريبة وبيانات المسافر والرحلة.'
                        : 'Configure service tax and itinerary details.'}
                    </p>
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        {isRtl ? 'نسبة الضريبة (%)' : 'Tax Rate (%)'}
                      </label>
                      <select
                        data-product-field="taxRate"
                        onKeyDown={handleProductFieldEnter}
                        value={form.taxRate}
                        onChange={(event) => setForm({ ...form, taxRate: event.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:border-blue-700 focus:outline-none"
                      >
                        {taxRates.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                      </select>
                    </div>
                    <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                      <input
                        type="checkbox"
                        checked={form.requiresItinerary}
                        onChange={(event) => setForm({
                          ...form,
                          requiresItinerary: event.target.checked,
                        })}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                      />
                      <span>
                        <span className="block font-semibold text-slate-800">
                          {isRtl ? 'طلب بيانات المسافر والرحلة عند البيع' : 'Enable passenger and itinerary fields in sales'}
                        </span>
                        <span className="mt-0.5 block text-slate-500">
                          {isRtl
                            ? 'عند اختيار هذه الخدمة في flyERP، ستظهر حقول بيانات المسافر والرحلة.'
                            : 'Selecting this service in flyERP opens passenger and flight detail fields.'}
                        </span>
                      </span>
                    </label>
                  </section>
                  <section className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-400">
                      {productImagePath || productImageData ? (
                        <ProductImage
                          imagePath={productImagePath}
                          imageData={productImageData}
                          alt={form.name || (isRtl ? 'معاينة صورة الخدمة' : 'Service image preview')}
                          className="h-auto w-auto max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <Upload className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <span className="mb-1 block font-medium text-slate-700">
                          {isRtl ? 'صورة الخدمة' : 'Service Image'}
                        </span>
                        <input
                          ref={productImageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={handleProductImageChange}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => productImageInputRef.current?.click()}
                            className="rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                          >
                            {isRtl ? 'اختيار صورة' : 'Choose image'}
                          </button>
                          {(productImageData || productImagePath) && (
                            <button
                              type="button"
                              onClick={() => {
                                setProductImageData('');
                                setProductImagePath('');
                              }}
                              className="text-[10px] font-medium text-slate-600 hover:text-red-700"
                            >
                              {isRtl ? 'إزالة الصورة' : 'Remove image'}
                            </button>
                          )}
                          <span className="text-[10px] text-slate-500">JPEG, PNG, WebP · max 1.5 MB</span>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {activeProductTab === 'settings' && !isServiceInventory && (
                <section className="rounded-lg border border-slate-200 bg-white p-3">
                  <h3 className="font-semibold text-slate-800">
                    {isRtl ? 'إعدادات المنتج' : 'Product Settings'}
                  </h3>
                  <p className="mb-3 mt-0.5 text-[10px] text-slate-500">
                    {isRtl
                      ? 'إعدادات الضريبة والوحدة وتنبيه المخزون لهذا المنتج.'
                      : 'Configure this product’s tax, unit, and low-stock threshold.'}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block font-medium text-slate-700">
                        {isRtl ? 'نسبة الضريبة (%)' : 'Tax Rate (%)'}
                      </label>
                      <select
                        data-product-field="taxRate"
                        onKeyDown={handleProductFieldEnter}
                        value={form.taxRate}
                        onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:border-blue-700 focus:outline-none"
                      >
                        {taxRates.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="block font-medium text-slate-700">{isRtl ? 'وحدة القياس' : 'Unit'}</label>
                        <button
                          type="button"
                          onClick={() => openProductOptionDialog('unit')}
                          className="rounded p-0.5 text-blue-700 hover:bg-blue-50"
                          aria-label={isRtl ? 'إضافة وحدة قياس' : 'Add unit'}
                          title={isRtl ? 'إضافة وحدة قياس' : 'Add unit'}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <select
                        data-product-field="unit"
                        onKeyDown={handleProductFieldEnter}
                        value={form.unit}
                        onChange={(e) => setForm({ ...form, unit: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-blue-700 focus:outline-none"
                      >
                        {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                    </div>
                    {!editingProduct && !isServiceInventory && (
                      <div>
                        <label className="mb-1 block font-medium text-slate-700">
                          {isRtl ? 'المخزون الافتتاحي' : 'Opening Stock'}
                        </label>
                        <input
                          type="number"
                          min={0}
                          data-product-field="stock"
                          onFocus={(event) => event.currentTarget.select()}
                          onClick={(event) => event.currentTarget.select()}
                          onKeyDown={handleProductFieldEnter}
                          value={form.stock}
                          onChange={(e) => setForm({ ...form, stock: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:border-blue-700 focus:outline-none"
                        />
                      </div>
                    )}
                    {!isServiceInventory && (
                      <div>
                        <label className="mb-1 block font-medium text-slate-700">
                          {isRtl ? 'حد إعادة الطلب' : 'Low Stock Reorder Level'}
                        </label>
                        <input
                          type="number"
                          min={0}
                          data-product-field="reorderLevel"
                          onFocus={(event) => event.currentTarget.select()}
                          onClick={(event) => event.currentTarget.select()}
                          onKeyDown={handleProductFieldEnter}
                          value={form.reorderLevel}
                          onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:border-blue-700 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}

              {activeProductTab === 'advanced' && !isServiceInventory && (
              <>
              <section className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-800">{isRtl ? 'الوحدات المتعددة' : 'Multi units'}</h3>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {isRtl
                        ? 'أدخل عدد الوحدات الأساسية. اترك السعر فارغاً لحسابه تلقائياً.'
                        : 'Enter the number of base units. Leave price empty to calculate it automatically.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMultiUnitDrafts((current) => [
                      ...current,
                      { id: crypto.randomUUID(), name: '', barcode: '', unitsPerBase: '1', packsPerBase: '1', price: '' },
                    ])}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {isRtl ? 'إضافة وحدة' : 'Add unit'}
                  </button>
                </div>
                {multiUnitDrafts.length > 0 && (
                  <div className="space-y-2">
                    {multiUnitDrafts.map((unit, index) => (
                      <div key={unit.id} className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-5">
                        <label className="text-[10px] font-semibold text-slate-600">
                          {isRtl ? 'اسم الوحدة' : 'Unit name'}
                          <select
                            value={unit.name}
                            onChange={(event) => setMultiUnitDrafts((current) => current.map((entry) =>
                              entry.id === unit.id ? { ...entry, name: event.target.value } : entry
                            ))}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-normal text-slate-900 focus:border-blue-600 focus:outline-none"
                          >
                            <option value="">{isRtl ? 'اختر وحدة...' : 'Select unit...'}</option>
                            {unit.name && !units.includes(unit.name) && (
                              <option value={unit.name}>{unit.name}</option>
                            )}
                            {units.map((unitOption) => (
                              <option key={unitOption} value={unitOption}>{unitOption}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[10px] font-semibold text-slate-600">
                          {isRtl ? 'باركود الوحدة' : 'Unit barcode'}
                          <input
                            type="text"
                            value={unit.barcode}
                            onChange={(event) => setMultiUnitDrafts((current) => current.map((entry) =>
                              entry.id === unit.id ? { ...entry, barcode: event.target.value } : entry
                            ))}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs font-normal text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        </label>
                        <label className="text-[10px] font-semibold text-slate-600">
                          {isRtl ? 'وحدة أساسية / عبوة' : 'Base units / pack'}
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={unit.unitsPerBase}
                            onChange={(event) => {
                              const nextUnitsPerBase = event.target.value;
                              const parsed = Number(nextUnitsPerBase);
                              setMultiUnitDrafts((current) => current.map((entry) =>
                                entry.id === unit.id
                                  ? {
                                      ...entry,
                                      unitsPerBase: nextUnitsPerBase,
                                      packsPerBase:
                                        Number.isFinite(parsed) && parsed > 0
                                          ? String(Number((1 / parsed).toFixed(4)))
                                          : entry.packsPerBase,
                                    }
                                  : entry
                              ));
                            }}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs font-normal text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        </label>
                        <label className="text-[10px] font-semibold text-slate-600">
                          {isRtl ? 'عبوة / وحدة أساسية' : 'Packs / base unit'}
                          <input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={unit.packsPerBase}
                            onChange={(event) => {
                              const nextPacksPerBase = event.target.value;
                              const parsed = Number(nextPacksPerBase);
                              setMultiUnitDrafts((current) => current.map((entry) =>
                                entry.id === unit.id
                                  ? {
                                      ...entry,
                                      packsPerBase: nextPacksPerBase,
                                      unitsPerBase:
                                        Number.isFinite(parsed) && parsed > 0
                                          ? String(Number((1 / parsed).toFixed(6)))
                                          : entry.unitsPerBase,
                                    }
                                  : entry
                              ));
                            }}
                            placeholder="e.g. 10"
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs font-normal text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        </label>
                        <label className="text-[10px] font-semibold text-slate-600">
                          {isRtl ? 'سعر البيع (اختياري)' : 'Selling price (optional)'}
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={unit.price}
                            onChange={(event) => setMultiUnitDrafts((current) => current.map((entry) =>
                              entry.id === unit.id ? { ...entry, price: event.target.value } : entry
                            ))}
                            placeholder={`${Number((Number(form.retailPrice || 0) * Number(unit.unitsPerBase || 1)).toFixed(2))}`}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs font-normal text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setMultiUnitDrafts((current) => current.filter((entry) => entry.id !== unit.id));
                            setAdditionalBarcodeDrafts((current) => current.map((entry) =>
                              entry.unitId === unit.id ? { ...entry, unitId: '' } : entry
                            ));
                          }}
                          aria-label={`${isRtl ? 'حذف الوحدة' : 'Remove unit'} ${index + 1}`}
                          className="col-span-2 justify-self-end rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 sm:col-span-5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-800">{isRtl ? 'باركودات إضافية' : 'Multiple barcodes'}</h3>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {isRtl ? 'كل باركود إضافي يُربط بالوحدة الأساسية أو بوحدة متعددة.' : 'Assign each extra barcode to the base unit or a multi unit.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdditionalBarcodeDrafts((current) => [
                      ...current,
                      { id: crypto.randomUUID(), barcode: '', unitId: '' },
                    ])}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {isRtl ? 'إضافة باركود' : 'Add barcode'}
                  </button>
                </div>
                {additionalBarcodeDrafts.length > 0 && (
                  <div className="space-y-2">
                    {additionalBarcodeDrafts.map((entry, index) => (
                      <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-end gap-2">
                        <label className="text-[10px] font-semibold text-slate-600">
                          {isRtl ? 'الوحدة' : 'Unit'}
                          <select
                            value={entry.unitId}
                            onChange={(event) => setAdditionalBarcodeDrafts((current) => current.map((item) =>
                              item.id === entry.id ? { ...item, unitId: event.target.value } : item
                            ))}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-normal text-slate-900 focus:border-blue-600 focus:outline-none"
                          >
                            <option value="">{isRtl ? 'الوحدة الأساسية' : 'Base unit'}</option>
                            {multiUnitDrafts.map((unit) => (
                              <option key={unit.id} value={unit.id}>{unit.name || (isRtl ? 'وحدة جديدة' : 'New unit')}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[10px] font-semibold text-slate-600">
                          {isRtl ? 'الباركود الإضافي' : 'Additional barcode'}
                          <input
                            type="text"
                            value={entry.barcode}
                            onChange={(event) => {
                              const barcode = event.target.value;
                              setAdditionalBarcodeDrafts((current) => {
                                const updated = current.map((item) =>
                                  item.id === entry.id ? { ...item, barcode } : item
                                );
                                if (index === current.length - 1 && barcode.trim()) {
                                  updated.push({ id: crypto.randomUUID(), barcode: '', unitId: '' });
                                }
                                return updated;
                              });
                            }}
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs font-normal text-slate-900 focus:border-blue-600 focus:outline-none"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setAdditionalBarcodeDrafts((current) => current.filter((item) => item.id !== entry.id))}
                          aria-label={`${isRtl ? 'حذف الباركود' : 'Remove barcode'} ${index + 1}`}
                          className="mb-1 rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              </>
              )}

              {activeProductTab === 'general' && !isServiceInventory && (
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block font-medium text-slate-700">{isRtl ? 'التصنيف' : 'Category'}</label>
                    <button
                      type="button"
                      onClick={() => openProductOptionDialog('category')}
                      className="rounded p-0.5 text-blue-700 hover:bg-blue-50"
                      aria-label={isRtl ? 'إضافة تصنيف' : 'Add category'}
                      title={isRtl ? 'إضافة تصنيف' : 'Add category'}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <select
                    data-product-field="category"
                    onKeyDown={handleProductFieldEnter}
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 bg-white focus:outline-none focus:border-blue-700"
                  >
                    <option value="">{isRtl ? 'بدون تصنيف' : 'No category'}</option>
                    {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block font-medium text-slate-700">{isRtl ? 'العلامة التجارية' : 'Brand'}</label>
                    <button
                      type="button"
                      onClick={() => openProductOptionDialog('brand')}
                      className="rounded p-0.5 text-blue-700 hover:bg-blue-50"
                      aria-label={isRtl ? 'إضافة علامة تجارية' : 'Add brand'}
                      title={isRtl ? 'إضافة علامة تجارية' : 'Add brand'}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <select
                    data-product-field="brand"
                    onKeyDown={handleProductFieldEnter}
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 bg-white focus:outline-none focus:border-blue-700"
                  >
                    <option value="">{isRtl ? 'بدون علامة تجارية' : 'No brand'}</option>
                    {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                  </select>
                </div>
              </div>
              )}

              {activeProductTab === 'history' && editingProduct && (
                <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3">
                    <div>
                      <h3 className="font-semibold text-slate-800">{isRtl ? 'سجل المنتج' : 'Product History'}</h3>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {isRtl ? 'سجل المشتريات والمبيعات والمرتجعات لهذا المنتج.' : 'Purchases, sales, and returns recorded for this product.'}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                      <span>{isRtl ? 'النوع' : 'Type'}</span>
                      <select
                        value={productHistoryFilter}
                        onChange={(event) => setProductHistoryFilter(event.target.value as ProductHistoryFilter)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                      >
                        <option value="all">{isRtl ? 'الكل' : 'All activity'}</option>
                        <option value="purchases">{isRtl ? 'المشتريات' : 'Purchases'}</option>
                        <option value="purchaseReturns">{isRtl ? 'مرتجعات المشتريات' : 'Purchase Returns'}</option>
                        <option value="sales">{isRtl ? 'المبيعات' : 'Sales'}</option>
                        <option value="salesReturns">{isRtl ? 'مرتجعات المبيعات' : 'Sales Returns'}</option>
                      </select>
                    </label>
                  </div>
                  <div className="max-h-[55vh] overflow-auto">
                    {filteredProductHistoryRows.length > 0 ? (
                      <table className={`w-full min-w-[760px] border-collapse text-[11px] ${isRtl ? 'text-right' : 'text-left'}`}>
                        <thead className="sticky top-0 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">{isRtl ? 'التاريخ' : 'Date'}</th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">{isRtl ? 'النوع' : 'Type'}</th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">{isRtl ? 'المرجع' : 'Reference'}</th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">{isRtl ? 'الجهة' : 'Party'}</th>
                            <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">{isRtl ? 'الكمية' : 'Quantity'}</th>
                            <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">{isRtl ? 'السعر' : 'Rate'}</th>
                            <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">{isRtl ? 'الإجمالي' : 'Total'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredProductHistoryRows.map((row) => {
                            const typeLabel = {
                              purchases: isRtl ? 'شراء' : 'Purchase',
                              purchaseReturns: isRtl ? 'مرتجع شراء' : 'Purchase Return',
                              sales: isRtl ? 'بيع' : 'Sale',
                              salesReturns: isRtl ? 'مرتجع بيع' : 'Sales Return',
                            }[row.type];
                            return (
                              <tr key={row.id} className="text-slate-700">
                                <td className="whitespace-nowrap px-3 py-2">{new Date(row.date).toLocaleString(isRtl ? 'ar-SA' : 'en-GB')}</td>
                                <td className="whitespace-nowrap px-3 py-2">{typeLabel}</td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono">{row.reference || '—'}</td>
                                <td className="px-3 py-2">{row.party || '—'}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{row.quantity} {row.unit}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{c}{row.rate.toFixed(2)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums">{c}{row.total.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="px-4 py-10 text-center text-xs text-slate-500">
                        {isRtl ? 'لا يوجد سجل لهذا المنتج.' : 'No product history found.'}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {activeProductTab === 'history' && !editingProduct && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-xs text-slate-500">
                  {isRtl ? 'احفظ المنتج أولاً لعرض سجلّه.' : 'Save the product first to view its history.'}
                </div>
              )}
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {selectedProductDetails && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-details-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setSelectedProductDetails(null);
            }
          }}
        >
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
              <h2 id="product-details-title" className="text-base font-bold text-slate-900">
                {isRtl ? 'تفاصيل المنتج' : 'Product Details'}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedProductDetails(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                {isRposMode && (
                  selectedProductDetails.imagePath || selectedProductDetails.imageData ? (
                    <div className="flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-2">
                      <ProductImage
                        imagePath={selectedProductDetails.imagePath}
                        imageData={selectedProductDetails.imageData}
                        alt={selectedProductDetails.name}
                        className="h-auto w-auto max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                      <Upload className="h-8 w-8" />
                    </div>
                  )
                )}
                <div className="min-w-0 text-center sm:text-start">
                  <h3 className="text-lg font-bold text-slate-900">{selectedProductDetails.name}</h3>
                  {selectedProductDetails.nameAr && (
                    <p className="mt-1 text-sm font-semibold text-blue-800" dir="rtl">
                      {selectedProductDetails.nameAr}
                    </p>
                  )}
                  {selectedProductDetails.brand && (
                    <p className="mt-2 text-sm text-slate-600">{selectedProductDetails.brand}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  [isRtl ? 'SKU' : 'SKU', selectedProductDetails.sku],
                  [isRtl ? 'الباركود' : 'Barcode', selectedProductDetails.barcode],
                  [isRtl ? 'الفئة' : 'Category', selectedProductDetails.category],
                  [isRtl ? 'الوحدة' : 'Unit', selectedProductDetails.unit],
                  [isRtl ? 'التكلفة' : 'Cost', `${c}${selectedProductDetails.costPrice.toFixed(2)}`],
                  [isRtl ? 'سعر البيع' : 'Retail Price', `${c}${selectedProductDetails.retailPrice.toFixed(2)}`],
                  [isRtl ? 'الضريبة' : 'Tax Rate', `${selectedProductDetails.taxRate ?? 15}%`],
                  [isRtl ? 'المخزون' : 'Stock', `${selectedProductDetails.stock} ${selectedProductDetails.unit}`],
                  [isRtl ? 'حد إعادة الطلب' : 'Reorder Level', String(selectedProductDetails.reorderLevel)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-500">{label}</div>
                    <div className="mt-0.5 break-words text-sm font-semibold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => setSelectedProductDetails(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {isRtl ? 'تم' : 'Done'}
              </button>
              <button
                type="button"
                onClick={handleEditProductDetails}
                className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                {isRtl ? 'تعديل المنتج' : 'Edit Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Preview & Confirmation Modal */}
      {importModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh] shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h2 id="import-modal-title" className="text-base font-semibold text-slate-900">
                  {isRtl ? 'معاينة استيراد المنتجات' : 'Import Products Preview'}
                </h2>
                {importFileName && (
                  <span className="ml-2 px-2 py-0.5 text-[11px] font-mono font-medium rounded bg-emerald-50 text-emerald-800 border border-emerald-200 truncate max-w-[200px]" title={importFileName}>
                    {importFileName}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
                  <div className="text-[11px] text-slate-500 font-medium">{isRtl ? 'إجمالي الصفوف' : 'Total Rows'}</div>
                  <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">
                    {parsedRows.length}
                  </div>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                  <div className="text-[11px] text-emerald-700 font-medium">{isRtl ? 'منتجات جديدة' : 'New Products'}</div>
                  <div className="text-lg font-bold font-mono text-emerald-800 mt-0.5">
                    {parsedRows.filter((r) => !r.isExisting).length}
                  </div>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-center">
                  <div className="text-[11px] text-blue-700 font-medium">{isRtl ? 'سيتم تحديثها' : 'Will Update Existing'}</div>
                  <div className="text-lg font-bold font-mono text-blue-800 mt-0.5">
                    {parsedRows.filter((r) => r.isExisting).length}
                  </div>
                </div>
              </div>

              {importError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 font-medium text-slate-700 flex items-center justify-between">
                  <span>{isRtl ? `السجلات (${parsedRows.length})` : `Product Records (${parsedRows.length})`}</span>
                  <span className="text-[11px] text-slate-500">{isRtl ? 'عرض أول 25 صف' : 'Showing first 25 rows'}</span>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <table className={`w-full ${isRtl ? 'text-right' : 'text-left'} border-collapse`}>
                    <thead className="bg-slate-50/70 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase sticky top-0">
                      <tr>
                        <th className="px-3 py-2">{isRtl ? 'الحالة' : 'Status'}</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">{isRtl ? 'الباركود' : 'Barcode'}</th>
                        <th className="px-3 py-2">{isRtl ? 'الاسم (إنجليزي)' : 'Name (English)'}</th>
                        <th className="px-3 py-2 text-right">{isRtl ? 'الاسم (عربي)' : 'Name (Arabic)'}</th>
                        <th className="px-3 py-2">{isRtl ? 'التصنيف' : 'Category'}</th>
                        <th className="px-3 py-2 text-right">{isRtl ? 'التكلفة' : 'Cost'}</th>
                        <th className="px-3 py-2 text-right">{isRtl ? 'البيع' : 'Retail'}</th>
                        <th className="px-3 py-2 text-right">{isRtl ? 'الضريبة' : 'Tax (%)'}</th>
                        <th className="px-3 py-2 text-right">{isRtl ? 'المخزون' : 'Stock'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {parsedRows.slice(0, 25).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2 font-sans">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                row.isExisting
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {row.isExisting ? (isRtl ? 'تحديث' : 'Update') : (isRtl ? 'جديد' : 'New')}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{row.sku}</td>
                          <td className="px-3 py-2 text-slate-500">{row.barcode}</td>
                          <td className="px-3 py-2 font-sans font-medium text-slate-900 max-w-[160px] truncate" title={row.name}>
                            {row.name}
                          </td>
                          <td className="px-3 py-2 font-sans text-slate-900 max-w-[160px] truncate font-medium text-right" dir="rtl" title={row.nameAr || ''}>
                            {row.nameAr ? (
                              <span className="text-emerald-800 font-semibold">{row.nameAr}</span>
                            ) : (
                              <span className="text-slate-400 italic text-[10px]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-sans text-slate-600">{row.category}</td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {c}{row.costPrice.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            {c}{row.retailPrice.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">
                            {row.taxRate ?? 15}%
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            +{row.stock} {row.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleDownloadSampleExcel}
                  className="text-xs text-emerald-700 hover:text-emerald-800 underline font-medium inline-flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isRtl ? 'تحميل نموذج الإكسل (.xlsx)' : 'Download sample Excel template (.xlsx)'}</span>
                </button>
                {parsedRows.length > 25 && (
                  <span className="text-[11px] text-slate-400">
                    {isRtl ? `+ ${parsedRows.length - 25} صنف آخر في الملف` : `+ ${parsedRows.length - 25} more items in file`}
                  </span>
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={handleConfirmImport}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
              >
                {importing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {importing
                    ? (isRtl ? 'جاري الاستيراد...' : 'Importing...')
                    : (isRtl ? `تأكيد الاستيراد (${parsedRows.length} منتج)` : `Confirm & Import (${parsedRows.length} Products)`)}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
