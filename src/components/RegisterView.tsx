import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Minus,
  Plus,
  Search,
  Trash2,
  Barcode,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ShoppingBag,
  ArrowRight,
  ArrowLeft,
  PauseCircle,
  X,
  Layers,
  LayoutGrid,
  Sparkles,
  PackageCheck,
  CreditCard,
  Banknote,
  RotateCcw,
  Printer,
} from 'lucide-react';
import type {
  CartItem,
  Customer,
  InventoryOption,
  PaymentMethod,
  Product,
  ProductCategory,
  Sale,
  StoreSettings,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { ProductImage } from './ProductImage';
import { getPaymentMethods } from '../utils/paymentMethods';
import { getKotNumberFromInvoice } from '../utils/documentNumbers';
import {
  applyThermalPageSize,
  measureThermalPageSize,
  printWithThermalPageSize,
} from '../utils/thermalPrinting';

export interface InvoiceTab {
  id: string;
  tabNumber: number;
  label: string;
  invoiceNumber?: string;
  cart: CartItem[];
  customerName: string;
  discountType: 'fixed' | 'percent';
  discountValue: string;
  paymentMethod: PaymentMethod;
  cashTendered: string;
  cashTenderedManuallySet?: boolean;
  cardTendered?: string;
  editingSaleId?: number;
  editingOriginalItems?: Array<{
    productId: number;
    quantity: number;
    unitPrice: number;
    unitId?: string;
    unitsPerBase?: number;
  }>;
  isHeld: boolean;
  createdAt: string;
}

interface RegisterState {
  tabs: InvoiceTab[];
  activeTabId: string;
}

interface RegisterViewProps {
  products: Product[];
  customers?: Customer[];
  settings: StoreSettings;
  onSaleCompleted: (sale: Sale, queuedOffline: boolean) => void;
  restoredSale?: Sale | null;
  onClearRestoredSale?: () => void;
  receiptModalOpen?: boolean;
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
    (!('imageData' in value) || typeof value.imageData === 'string')
  );
}

const REGISTER_STATE_KEY = 'counterline_register_state';
const RPOS_TICKET_WIDTH_KEY = 'counterline_rpos_ticket_width';
const DEFAULT_RPOS_TICKET_WIDTH = 320;

function getCartItemLineId(item: CartItem): string {
  return item.lineId || `${item.product.id}:${item.unitId || 'base'}`;
}

function getCartItemUnitsPerBase(item: CartItem): number {
  return item.unitsPerBase || 1;
}

function loadRposTicketWidth(): number {
  try {
    const stored = Number(localStorage.getItem(RPOS_TICKET_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= 150 && stored <= 800
      ? stored
      : DEFAULT_RPOS_TICKET_WIDTH;
  } catch (error) {
    console.error('Failed to restore RPOS ticket width:', error);
    return DEFAULT_RPOS_TICKET_WIDTH;
  }
}

function isInvoiceTab(value: unknown): value is InvoiceTab {
  if (!value || typeof value !== 'object') return false;
  const tab = value as InvoiceTab;
  return (
    typeof tab.id === 'string' &&
    typeof tab.tabNumber === 'number' &&
    typeof tab.label === 'string' &&
    (tab.invoiceNumber === undefined || typeof tab.invoiceNumber === 'string') &&
    Array.isArray(tab.cart) &&
    tab.cart.every(
      (item) =>
        item &&
        typeof item.quantity === 'number' &&
        item.product &&
        typeof item.product.id === 'number'
    ) &&
    typeof tab.customerName === 'string' &&
    (tab.discountType === 'fixed' || tab.discountType === 'percent') &&
    typeof tab.discountValue === 'string' &&
    typeof tab.paymentMethod === 'string' &&
    tab.paymentMethod.trim().length > 0 &&
    typeof tab.cashTendered === 'string' &&
    (tab.cardTendered === undefined || typeof tab.cardTendered === 'string') &&
    typeof tab.isHeld === 'boolean' &&
    typeof tab.createdAt === 'string'
  );
}

function loadRegisterState(): RegisterState | null {
  try {
    const stored = sessionStorage.getItem(REGISTER_STATE_KEY);
    if (!stored) return null;

    const state: unknown = JSON.parse(stored);
    if (
      !state ||
      typeof state !== 'object' ||
      !('tabs' in state) ||
      !Array.isArray(state.tabs) ||
      !state.tabs.every(isInvoiceTab) ||
      !('activeTabId' in state) ||
      typeof state.activeTabId !== 'string' ||
      !state.tabs.some((tab) => tab.id === state.activeTabId)
    ) {
      return null;
    }

    const tabs = state.tabs.map((tab) => {
      const migratedTab = { ...tab };
      const legacyTab = migratedTab as InvoiceTab & { orderNumber?: string; kotNumber?: string };
      delete legacyTab.orderNumber;
      delete legacyTab.kotNumber;
      if (migratedTab.cart.length === 0 && !migratedTab.editingSaleId) {
        delete migratedTab.invoiceNumber;
      }
      return migratedTab;
    });
    return { tabs, activeTabId: state.activeTabId };
  } catch (error) {
    console.error('Failed to restore POS tickets:', error);
    return null;
  }
}

// Audio synthesizer for scanner beep
function playScannerBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    // AudioContext not supported or restricted
  }
}

// Audio synthesizer for error buzz
function playErrorBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // AudioContext restricted
  }
}

export const RegisterView: React.FC<RegisterViewProps> = ({
  products,
  customers = [],
  settings,
  onSaleCompleted,
  restoredSale,
  onClearRestoredSale,
  receiptModalOpen,
}) => {
  const { t, isRtl } = useLanguage();
  const isRpos = settings.posScreenLayout === 'rpos';
  const paymentMethods = getPaymentMethods(settings.paymentMethods);
  const paymentMethodLabel = (method: PaymentMethod) =>
    method === 'Cash'
      ? (isRtl ? 'نقداً' : 'Cash')
      : method === 'Card'
        ? (isRtl ? 'بطاقة' : 'Card')
        : method === 'Split'
          ? (isRtl ? 'مجزأ' : 'Split')
          : method;
  const [mobileTab, setMobileTab] = useState<'table' | 'checkout'>('table');
  const [rposTicketWidth, setRposTicketWidth] = useState(loadRposTicketWidth);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [allProductSearch, setAllProductSearch] = useState('');
  const [isAllProductSearchFocused, setIsAllProductSearchFocused] = useState(false);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const allProductSearchRef = useRef<HTMLDivElement>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isBrowsingCategories, setIsBrowsingCategories] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogSort, setCatalogSort] = useState<'featured' | 'name' | 'price-low' | 'price-high'>('featured');
  const [catalogCategory, setCatalogCategory] = useState<string>('All');
  const [rposCategories, setRposCategories] = useState<Array<{ value: string; imageData: string }>>([]);
  const [rposCategoriesLoaded, setRposCategoriesLoaded] = useState(false);
  const [rposCategoryError, setRposCategoryError] = useState<string | null>(null);
  const [editingTicketItemId, setEditingTicketItemId] = useState<string | null>(null);
  const [selectedTicketItemId, setSelectedTicketItemId] = useState<string | null>(null);
  const [zeroPriceDialogItems, setZeroPriceDialogItems] = useState<CartItem[] | null>(null);
  const [selectedZeroPriceItemId, setSelectedZeroPriceItemId] = useState<string | null>(null);
  const [ticketEditPrice, setTicketEditPrice] = useState('');
  const [ticketEditQuantity, setTicketEditQuantity] = useState('');
  const [ticketEditUnitId, setTicketEditUnitId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const loadCategories = async () => {
      setRposCategoryError(null);
      try {
        const response = await fetch('/api/inventory-options');
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message =
            typeof payload === 'object' && payload !== null && 'error' in payload &&
            typeof payload.error === 'string'
              ? payload.error
              : 'Failed to load RPOS categories.';
          throw new Error(message);
        }
        if (!Array.isArray(payload) || !payload.every(isInventoryOption)) {
          throw new Error('RPOS categories response has an invalid format.');
        }
        const categories = payload
          .filter((option) => option.type === 'category')
          .map((option) => ({ value: option.value, imageData: option.imageData || '' }));
        if (active) setRposCategories(categories);
      } catch (error) {
        if (active) setRposCategoryError((error as Error).message);
      } finally {
        if (active) setRposCategoriesLoaded(true);
      }
    };
    void loadCategories();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(RPOS_TICKET_WIDTH_KEY, String(rposTicketWidth));
    } catch (error) {
      console.error('Failed to save RPOS ticket width:', error);
    }
  }, [rposTicketWidth]);

  // Wrong Barcode Alert Dialog state - when active, scanning next product is locked
  const [wrongBarcodeModal, setWrongBarcodeModal] = useState<{
    isOpen: boolean;
    barcode: string;
  } | null>(null);

  // Multi-tab / Held Invoices State
  const [initialRegisterState] = useState(loadRegisterState);
  const [tabs, setTabs] = useState<InvoiceTab[]>(
    () =>
      initialRegisterState?.tabs || [
        {
          id: 'tab-1',
          tabNumber: 1,
          label: 'Ticket #1',
          cart: [],
          customerName: settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
          discountType: 'fixed',
          discountValue: '',
          paymentMethod: 'Cash',
          cashTendered: '',
          isHeld: false,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]
  );
  const [activeTabId, setActiveTabId] = useState<string>(
    () => initialRegisterState?.activeTabId || 'tab-1'
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(REGISTER_STATE_KEY, JSON.stringify({ tabs, activeTabId }));
    } catch (error) {
      console.error('Failed to save POS tickets:', error);
    }
  }, [tabs, activeTabId]);

  const activeTab = useMemo(
    () =>
      tabs.find((t) => t.id === activeTabId) ||
      tabs[0] || {
        id: 'tab-1',
        tabNumber: 1,
        label: 'Ticket #1',
        cart: [],
        customerName: settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
        discountType: 'fixed' as const,
        discountValue: '',
        paymentMethod: 'Cash' as const,
        cashTendered: '',
        isHeld: false,
        createdAt: '',
      },
    [tabs, activeTabId, settings.defaultCustomer]
  );

  const cart = activeTab.cart;
  const customerName = activeTab.customerName;
  const defaultCustomerName = settings.defaultCustomer || 'Walk-in Customer / عميل نقدي';
  const customerQuery = customerSearch.trim().toLowerCase();
  const matchingCustomers = customers.filter((cust) => {
    const name = cust.name.trim().toLowerCase();
    const isDefaultCustomer =
      name === defaultCustomerName.trim().toLowerCase() ||
      name === 'walk-in customer' ||
      name === 'عميل نقدي';
    const searchableText = [cust.name, cust.nameAr, cust.phone]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return !isDefaultCustomer && (!customerQuery || searchableText.includes(customerQuery));
  });
  const showDefaultCustomerOption =
    !customerQuery ||
    defaultCustomerName.toLowerCase().includes(customerQuery) ||
    'walk-in customer'.includes(customerQuery) ||
    'عميل نقدي'.includes(customerQuery);
  const discountType = activeTab.discountType;
  const discountValue = activeTab.discountValue;
  const paymentMethod = activeTab.paymentMethod;
  const cashTendered = activeTab.cashTendered;
  const cardTendered = activeTab.cardTendered ?? '';

  const setCart = (action: React.SetStateAction<CartItem[]>) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const nextCart = typeof action === 'function' ? action(tab.cart) : action;
        return { ...tab, cart: nextCart, cashTenderedManuallySet: false };
      })
    );
  };

  const setCustomerName = (name: string) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTabId ? { ...tab, customerName: name } : tab))
    );
  };

  const setDiscountType = (action: React.SetStateAction<'fixed' | 'percent'>) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const next = typeof action === 'function' ? action(tab.discountType) : action;
        return { ...tab, discountType: next };
      })
    );
  };

  const setDiscountValue = (val: string) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTabId ? { ...tab, discountValue: val } : tab))
    );
  };

  const setPaymentMethod = (method: PaymentMethod) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTabId ? { ...tab, paymentMethod: method } : tab))
    );
  };

  const setCashTendered = (tendered: string, manual = false) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId
          ? { ...tab, cashTendered: tendered, cashTenderedManuallySet: manual || tab.cashTenderedManuallySet }
          : tab
      )
    );
  };

  const setCardTendered = (tendered: string) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTabId ? { ...tab, cardTendered: tendered } : tab))
    );
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const completeSaleRef = useRef<((confirmed?: boolean) => Promise<void>) | null>(null);
  const [isSaleConfirmationOpen, setIsSaleConfirmationOpen] = useState(false);
  const [isTenderModalOpen, setIsTenderModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
  const [isPrintingKot, setIsPrintingKot] = useState(false);

  const issueInvoiceNumber = async (): Promise<string> => {
    const response = await fetch('/api/invoice-numbers', { method: 'POST' });
    const responseText = await response.text();
    let data: { invoiceNumber?: unknown; error?: string };
    try {
      data = JSON.parse(responseText) as typeof data;
    } catch {
      throw new Error('The server returned an invalid response while issuing an invoice number.');
    }
    if (!response.ok) {
      throw new Error(data.error || `Failed to issue an invoice number (HTTP ${response.status}).`);
    }
    if (typeof data.invoiceNumber !== 'string' || !data.invoiceNumber) {
      throw new Error('The server returned an incomplete invoice number.');
    }
    return data.invoiceNumber;
  };

  const ensureActiveInvoiceNumber = async () => {
    if (activeTab.invoiceNumber) return activeTab.invoiceNumber;
    const invoiceNumber = await issueInvoiceNumber();
    setTabs((previous) =>
      previous.map((tab) =>
        tab.id === activeTabId ? { ...tab, invoiceNumber } : tab
      )
    );
    return invoiceNumber;
  };

  const handlePrintKot = async () => {
    if (cart.length === 0 || isPrintingKot || settings.enableKot !== true) return;

    setFeedback(null);
    try {
      const invoiceNumber = await ensureActiveInvoiceNumber();
      const kotNumber = getKotNumberFromInvoice(invoiceNumber);
      setIsPrintingKot(true);
      document.body.classList.add('kot-printing');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const kotPageSize = measureThermalPageSize(
        document.getElementById('kot-print-area'),
        {
          elementWidthMm: 72,
          pageWidthMm: 80,
          padding: '3mm',
          container: document.querySelector('.kot-print-source'),
        }
      );
      if (window.electronAPI?.isElectron) {
        const removePageStyle = applyThermalPageSize(kotPageSize);
        try {
          const result = await window.electronAPI.printReceipt({
            silent: true,
            printerName: settings.kotPrinter || undefined,
            pageSize: kotPageSize,
          });
          if (!result.ok) {
            throw new Error(result.error || 'Kitchen order ticket could not be printed.');
          }
          setFeedback({
            type: 'info',
            text: `KOT ${kotNumber} sent.`,
          });
        } finally {
          removePageStyle();
        }
      } else {
        printWithThermalPageSize(kotPageSize);
        setFeedback({
          type: 'info',
          text: `KOT ${kotNumber} print dialog opened.`,
        });
      }
    } catch (error) {
      console.error('Failed to print KOT:', error);
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Kitchen order ticket could not be printed.',
      });
    } finally {
      document.body.classList.remove('kot-printing');
      setIsPrintingKot(false);
    }
  };

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const cashTenderedInputRef = useRef<HTMLInputElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const ticketEditPriceInputRef = useRef<HTMLInputElement>(null);
  const c = isRtl ? 'ر.س' : (settings.currencySymbol || 'SAR');

  // Robust auto-focus barcode input across all render states and device widths
  const focusBarcodeInput = useCallback(() => {
    if (wrongBarcodeModal || editingTicketItemId !== null) return;
    setMobileTab('table');

    const focusTarget = () => {
      if (ticketEditPriceInputRef.current) return;
      const el =
        barcodeInputRef.current ||
        (document.getElementById('pos-barcode-scanner-input') as HTMLInputElement | null);
      if (el && !el.disabled) {
        el.focus();
        el.select();
      }
    };

    focusTarget();
    requestAnimationFrame(focusTarget);
    setTimeout(focusTarget, 30);
    setTimeout(focusTarget, 100);
    setTimeout(focusTarget, 250);
  }, [editingTicketItemId, wrongBarcodeModal]);

  useEffect(() => {
    focusBarcodeInput();
  }, [activeTabId, isCatalogOpen, wrongBarcodeModal, focusBarcodeInput]);

  useEffect(() => {
    if (editingTicketItemId === null) return;
    const frame = requestAnimationFrame(() => {
      ticketEditPriceInputRef.current?.focus();
      ticketEditPriceInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingTicketItemId]);

  // Whenever the receipt preview modal closes, automatically re-focus the barcode scanner
  const prevReceiptOpenRef = useRef(receiptModalOpen);
  useEffect(() => {
    if (prevReceiptOpenRef.current && !receiptModalOpen) {
      focusBarcodeInput();
    }
    prevReceiptOpenRef.current = receiptModalOpen;
  }, [receiptModalOpen, focusBarcodeInput]);

  // When window gains focus (e.g. cashier switches back to browser tab or POS window), re-focus barcode
  useEffect(() => {
    const handleWindowFocus = () => {
      if (!wrongBarcodeModal && !isCatalogOpen && !receiptModalOpen) {
        focusBarcodeInput();
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [wrongBarcodeModal, isCatalogOpen, receiptModalOpen, focusBarcodeInput]);

  // Restore an existing invoice as a register ticket for editing.
  useEffect(() => {
    if (!restoredSale) return;

    const originalQuantities = new Map<number, number>();
    for (const item of restoredSale.items) {
      originalQuantities.set(
        item.productId,
        (originalQuantities.get(item.productId) || 0) +
          item.quantity * (item.unitsPerBase || 1)
      );
    }

    const restoredCart: CartItem[] = restoredSale.items.map((item) => {
      const existingProduct = products.find((p) => p.id === item.productId);
      const product: Product = existingProduct
        ? {
            ...existingProduct,
            retailPrice: item.unitPrice,
            stock: existingProduct.stock + (originalQuantities.get(item.productId) || 0),
            unit: item.unitName || existingProduct.unit,
          }
        : {
            id: item.productId,
            sku: item.sku || `ITEM-${item.productId}`,
            barcode: item.sku || '',
            name: item.productName,
            nameAr: item.nameAr,
            category: 'Bakery & Pantry',
            costPrice: 0,
            retailPrice: item.unitPrice,
            stock: 100,
            reorderLevel: 5,
            unit: 'ea',
            multiUnits: item.unitId
              ? [{
                  id: item.unitId,
                  name: item.unitName || 'Unit',
                  barcode: '',
                  unitsPerBase: item.unitsPerBase || 1,
                  price: item.unitPrice,
                }]
              : [],
            updatedAt: new Date().toISOString(),
          };
      return {
        product,
        quantity: item.quantity,
        unitId: item.unitId,
        unitName: item.unitName || product.unit,
        unitsPerBase: item.unitsPerBase || 1,
        lineId: `${item.productId}:${item.unitId || 'base'}`,
      };
    });

    const newTabId = `tab-edit-${Date.now()}`;
    const nextTabNumber = (tabs.length > 0 ? Math.max(...tabs.map((t) => t.tabNumber)) : 0) + 1;
    const restoredTab: InvoiceTab = {
      id: newTabId,
      tabNumber: nextTabNumber,
      label: `Edit #${restoredSale.receiptNumber}`,
      invoiceNumber: restoredSale.receiptNumber,
      cart: restoredCart,
      customerName: restoredSale.customerName || settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
      discountType: restoredSale.discountType === 'percent' ? 'percent' : 'fixed',
      discountValue: restoredSale.discountValue ? String(restoredSale.discountValue) : '',
      paymentMethod: restoredSale.paymentMethod || 'Cash',
      cashTendered: restoredSale.paymentMethod === 'Cash' ? restoredSale.total.toFixed(2) : '',
      editingSaleId: restoredSale.id,
      editingOriginalItems: restoredSale.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitId: item.unitId,
        unitsPerBase: item.unitsPerBase || 1,
      })),
      isHeld: false,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setTabs((prev) => {
      const current = prev.find((t) => t.id === activeTabId);
      if (current && current.cart.length === 0 && prev.length === 1) {
        return [restoredTab];
      }
      return [...prev, restoredTab];
    });

    setActiveTabId(newTabId);
    setFeedback({
      type: 'info',
      text: `Editing invoice ${restoredSale.receiptNumber}. Save changes to update this invoice.`,
    });

    onClearRestoredSale?.();
    focusBarcodeInput();
    setTimeout(() => {
      focusBarcodeInput();
    }, 50);
    setTimeout(() => {
      focusBarcodeInput();
    }, 200);
  }, [restoredSale, products]);

  // Global Keyboard shortcuts & scanning lock trap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If Wrong Barcode Dialog is open, INTERCEPT KEYSTROKES to lock scanning, but allow Escape to dismiss!
      if (wrongBarcodeModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          dismissWrongBarcode();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (receiptModalOpen) return;

      if (isSaleConfirmationOpen) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const completeSale = completeSaleRef.current;
          if (completeSale) void completeSale(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setIsSaleConfirmationOpen(false);
        }
        return;
      }

      // Catalog open: Escape closes catalog
      if (isCatalogOpen && e.key === 'Escape') {
        e.preventDefault();
        setIsCatalogOpen(false);
        focusBarcodeInput();
        return;
      }

      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === 'F2') {
        e.preventDefault();
        focusBarcodeInput();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setIsCatalogOpen((prev) => !prev);
      } else if (e.key === 'F5') {
        e.preventDefault();
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTabId
              ? {
                  ...tab,
                  cart: [],
                  invoiceNumber: undefined,
                  customerName: settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
                  discountValue: '',
                  cashTendered: '',
                  cardTendered: '',
                  editingSaleId: undefined,
                  editingOriginalItems: undefined,
                  isHeld: false,
                }
              : tab
          )
        );
        setFeedback(null);
        focusBarcodeInput();
      } else if (e.key === 'F6') {
        e.preventDefault();
        handleHoldCurrentTab();
      } else if (e.key === 'F9' || e.key === 'F10') {
        e.preventDefault();
        const completeSale = completeSaleRef.current;
        if (completeSale) void completeSale();
      } else if (e.key === 'Escape' && isTenderModalOpen) {
        e.preventDefault();
        setIsTenderModalOpen(false);
      } else if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        focusBarcodeInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    wrongBarcodeModal,
    isCatalogOpen,
    isSaleConfirmationOpen,
    isTenderModalOpen,
    cart,
    isSubmitting,
    activeTabId,
    settings.defaultCustomer,
    settings.taxType,
    settings.taxRate,
    settings.roundTotalToFiveCents,
    isRpos,
    isRtl,
    paymentMethod,
    cashTendered,
    cardTendered,
    discountType,
    discountValue,
    receiptModalOpen,
  ]);

  // Dismiss wrong barcode alert and restore scanner readiness
  const dismissWrongBarcode = () => {
    setWrongBarcodeModal(null);
    setBarcodeInput('');
    setTimeout(() => {
      focusBarcodeInput();
    }, 50);
  };

  const getOriginalBaseUnits = (productId: number) =>
    (activeTab.editingOriginalItems || [])
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity * (item.unitsPerBase || 1), 0);

  const getReservedBaseUnits = (productId: number, exceptLineId?: string) =>
    cart
      .filter((item) => item.product.id === productId && getCartItemLineId(item) !== exceptLineId)
      .reduce((sum, item) => sum + item.quantity * getCartItemUnitsPerBase(item), 0);

  const getAvailableBaseUnits = (productId: number, exceptLineId?: string) => {
    const product = products.find((entry) => entry.id === productId);
    if (!product) {
      const cartProduct = cart.find((item) => item.product.id === productId)?.product;
      return Math.max(0, (cartProduct?.stock || 0) + getOriginalBaseUnits(productId) -
        getReservedBaseUnits(productId, exceptLineId));
    }
    return Math.max(
      0,
      product.stock + getOriginalBaseUnits(productId) -
        getReservedBaseUnits(productId, exceptLineId)
    );
  };

  const getUnitDetails = (product: Product, unitId?: string) => {
    const baseProduct = products.find((entry) => entry.id === product.id) || product;
    const multiUnit = unitId
      ? baseProduct.multiUnits?.find((unit) => unit.id === unitId)
      : undefined;
    return {
      unitId: multiUnit?.id,
      unitName: multiUnit?.name || baseProduct.unit,
      unitsPerBase: multiUnit?.unitsPerBase || 1,
      unitPrice: multiUnit
        ? multiUnit.price ?? baseProduct.retailPrice * multiUnit.unitsPerBase
        : baseProduct.retailPrice,
    };
  };

  const getMaxQuantityForItem = (
    item: CartItem,
    unitsPerBase = getCartItemUnitsPerBase(item)
  ) => {
    if (settings.allowNegativeStock) return 99999;
    return getAvailableBaseUnits(item.product.id, getCartItemLineId(item)) / unitsPerBase;
  };

  // Add a product in its scanned or selected unit while reserving base-unit stock.
  const addToCart = (product: Product, unitId?: string) => {
    setFeedback(null);
    const unit = getUnitDetails(product, unitId);
    if (unitId && !unit.unitId) {
      setFeedback({ type: 'error', text: `The selected unit is not available for ${product.name}.` });
      return;
    }
    const isZeroPriced = unit.unitPrice <= 0;
    const unitLinePrefix = `${product.id}:${unit.unitId || 'base'}`;
    const lineId = isZeroPriced ? `${unitLinePrefix}:${crypto.randomUUID()}` : unitLinePrefix;
    const existing = isZeroPriced
      ? undefined
      : cart.find(
          (item) => item.product.id === product.id && (item.unitId || '') === (unit.unitId || '')
        );
    const availableBaseUnits = getAvailableBaseUnits(product.id);
    if (!settings.allowNegativeStock && availableBaseUnits < unit.unitsPerBase) {
      setFeedback({
        type: 'error',
        text: `${product.name} does not have enough base units in stock for one ${unit.unitName}.`,
      });
      return;
    }

    const originalItem = activeTab.editingOriginalItems?.find(
      (item) => item.productId === product.id && (item.unitId || '') === (unit.unitId || '')
    );
    const itemUnitPrice = existing?.product.retailPrice ??
      (isZeroPriced ? unit.unitPrice : originalItem?.unitPrice ?? unit.unitPrice);
    const productForCart: Product = {
      ...product,
      stock: product.stock + getOriginalBaseUnits(product.id),
      unit: unit.unitName,
      retailPrice: itemUnitPrice,
    };
    const nextItem: CartItem = {
      product: productForCart,
      quantity: 1,
      unitId: unit.unitId,
      unitName: unit.unitName,
      unitsPerBase: unit.unitsPerBase,
      lineId,
    };
    if (settings.barcodeScanBeep) playScannerBeep();
    if (isZeroPriced) openTicketItemEditor(nextItem);

    setCart((prev) => {
      const sameUnit = isZeroPriced
        ? undefined
        : prev.find(
            (item) => item.product.id === product.id && (item.unitId || '') === (unit.unitId || '')
          );
      if (sameUnit) {
        return [
          { ...sameUnit, quantity: sameUnit.quantity + 1 },
          ...prev.filter((item) => getCartItemLineId(item) !== getCartItemLineId(sameUnit)),
        ];
      }
      return [nextItem, ...prev];
    });
  };

  const openTicketItemEditor = (item: CartItem) => {
    setTicketEditPrice(String(item.product.retailPrice));
    setTicketEditQuantity(String(item.quantity));
    setTicketEditUnitId(item.unitId || '');
    setEditingTicketItemId(getCartItemLineId(item));
  };

  const saveTicketItemEdits = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const item = cart.find((cartItem) => getCartItemLineId(cartItem) === editingTicketItemId);
    const price = Number(ticketEditPrice);
    const quantity = Number(ticketEditQuantity);
    const unit = item ? getUnitDetails(item.product, ticketEditUnitId || undefined) : null;

    if (
      !item ||
      !unit ||
      (ticketEditUnitId && !unit.unitId) ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(quantity) ||
      quantity < 1 ||
      (unit.unitId !== undefined && !Number.isInteger(quantity))
    ) {
      setFeedback({ type: 'error', text: isRtl ? 'أدخل سعراً وكمية صالحين.' : 'Enter a valid price and quantity.' });
      return;
    }

    const nextLineId = unit.unitPrice <= 0
      ? (item.unitId || '') === (unit.unitId || '')
        ? getCartItemLineId(item)
        : `${item.product.id}:${unit.unitId || 'base'}:${crypto.randomUUID()}`
      : `${item.product.id}:${unit.unitId || 'base'}`;
    if (
      unit.unitPrice > 0 &&
      cart.some(
        (entry) =>
          entry !== item &&
          entry.product.id === item.product.id &&
          (entry.unitId || '') === (unit.unitId || '')
      )
    ) {
      setFeedback({
        type: 'error',
        text: isRtl
          ? 'هذه الوحدة موجودة بالفعل في الفاتورة.'
          : 'This unit already has a line on the ticket.',
      });
      return;
    }

    if (!settings.allowNegativeStock && quantity > getMaxQuantityForItem(item, unit.unitsPerBase)) {
      setFeedback({
        type: 'error',
        text: `Only ${getMaxQuantityForItem(item, unit.unitsPerBase)} ${unit.unitName} available.`,
      });
      return;
    }

    setCart((prev) =>
      prev.map((entry) =>
        getCartItemLineId(entry) === editingTicketItemId
          ? {
              ...entry,
              quantity,
              unitId: unit.unitId,
              unitName: unit.unitName,
              unitsPerBase: unit.unitsPerBase,
              lineId: nextLineId,
              product: { ...entry.product, unit: unit.unitName, retailPrice: price },
            }
          : entry
      )
    );
    setFeedback(null);
    setSelectedTicketItemId(nextLineId);
    setEditingTicketItemId(null);
  };

  const adjustTicketEditQuantity = (delta: number) => {
    const item = cart.find((cartItem) => getCartItemLineId(cartItem) === editingTicketItemId);
    const currentQuantity = Number(ticketEditQuantity);
    const current = Number.isFinite(currentQuantity) && currentQuantity >= 1 ? currentQuantity : 1;
    const units = item ? getUnitDetails(item.product, ticketEditUnitId || undefined).unitsPerBase : 1;
    const maximum = item ? getMaxQuantityForItem(item, units) : 99999;
    setTicketEditQuantity(String(Math.max(1, Math.min(maximum, current + delta))));
  };

  const removeFromCart = (lineId: string) => {
    setCart((prev) => prev.filter((item) => getCartItemLineId(item) !== lineId));
    if (editingTicketItemId === lineId) setEditingTicketItemId(null);
    if (selectedTicketItemId === lineId) setSelectedTicketItemId(null);
  };

  const clearCart = () => {
    setSelectedTicketItemId(null);
    setEditingTicketItemId(null);
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              cart: [],
              invoiceNumber: undefined,
              customerName: settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
              discountValue: '',
              paymentMethod: 'Cash',
              cashTendered: '',
              cashTenderedManuallySet: false,
              cardTendered: '',
              editingSaleId: undefined,
              editingOriginalItems: undefined,
              isHeld: false,
            }
          : tab
      )
    );
    setFeedback(null);
    focusBarcodeInput();
  };

  // Multi-tab Management
  const handleNewTab = () => {
    const nextNum = (tabs.length > 0 ? Math.max(...tabs.map((t) => t.tabNumber)) : 0) + 1;
    const newTabId = `tab-${Date.now()}`;
    const newTab: InvoiceTab = {
      id: newTabId,
      tabNumber: nextNum,
      label: `Ticket #${nextNum}`,
      cart: [],
      customerName: settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
      discountType: 'fixed',
      discountValue: '',
      paymentMethod: 'Cash',
      cashTendered: '',
      cardTendered: '',
      isHeld: false,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);
    setFeedback(null);
    focusBarcodeInput();
  };

  const handleHoldCurrentTab = () => {
    if (activeTab.cart.length === 0) {
      setFeedback({ type: 'info', text: 'Current ticket is empty. Scan items before placing on hold.' });
      return;
    }

    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTabId ? { ...tab, isHeld: true } : tab))
    );

    const nextNum = Math.max(...tabs.map((t) => t.tabNumber)) + 1;
    const newTabId = `tab-${Date.now()}`;
    const newTab: InvoiceTab = {
      id: newTabId,
      tabNumber: nextNum,
      label: `Ticket #${nextNum}`,
      cart: [],
      customerName: settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
      discountType: 'fixed',
      discountValue: '',
      paymentMethod: 'Cash',
      cashTendered: '',
      cardTendered: '',
      isHeld: false,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);
    setFeedback({
      type: 'info',
      text: `${activeTab.label} placed ON HOLD. Opened a fresh ticket for next customer.`,
    });
    focusBarcodeInput();
  };

  const handleCloseTab = (tabId: string) => {
    const target = tabs.find((t) => t.id === tabId);
    if (!target) return;
    if (target.cart.length > 0) {
      if (!window.confirm(`Discard ${target.label} with ${target.cart.length} item(s)?`)) {
        return;
      }
    }

    if (tabs.length === 1) {
      setTabs([
        {
          id: `tab-${Date.now()}`,
          tabNumber: 1,
          label: 'Ticket #1',
          cart: [],
          customerName: settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
          discountType: 'fixed',
          discountValue: '',
          paymentMethod: 'Cash',
          cashTendered: '',
          cardTendered: '',
          isHeld: false,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      return;
    }

    const remaining = tabs.filter((t) => t.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[remaining.length - 1].id);
    }
    focusBarcodeInput();
  };

  // Fast indexed lookup for exact barcode scans
  const barcodeMap = useMemo(() => {
    const bMap = new Map<string, { product: Product; unitId?: string }>();
    for (const product of products) {
      if (product.barcode) {
        bMap.set(product.barcode.toLowerCase(), { product });
      }
      for (const unit of product.multiUnits || []) {
        if (unit.barcode) {
          bMap.set(unit.barcode.toLowerCase(), { product, unitId: unit.id });
        }
      }
      for (const alias of product.additionalBarcodes || []) {
        if (alias.barcode) {
          bMap.set(alias.barcode.toLowerCase(), {
            product,
            unitId: alias.unitId || undefined,
          });
        }
      }
    }
    return bMap;
  }, [products]);

  const matchingAllSearchProducts = useMemo(() => {
    const q = allProductSearch.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.nameAr && p.nameAr.toLowerCase().includes(q)) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        (p.multiUnits || []).some((unit) => unit.barcode.toLowerCase().includes(q)) ||
        (p.additionalBarcodes || []).some((entry) => entry.barcode.toLowerCase().includes(q)) ||
        p.category.toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [products, allProductSearch]);

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [allProductSearch]);

  // Dismiss product search results when clicking outside the search field
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        allProductSearchRef.current &&
        !allProductSearchRef.current.contains(e.target as Node)
      ) {
        setIsAllProductSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // BARCODE SCAN HANDLER WITH SCANNER-LOCK ON INVALID BARCODE
  const handleBarcodeSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (wrongBarcodeModal) return;

    const raw = barcodeInput.trim();
    if (!raw) {
      focusBarcodeInput();
      return;
    }

    const q = raw.toLowerCase();

    // Barcode entry is exact-match only; use product search for names and SKUs.
    const exactMatch = barcodeMap.get(q);

    if (exactMatch) {
      addToCart(exactMatch.product, exactMatch.unitId);
      setBarcodeInput('');
      focusBarcodeInput();
      return;
    }

    // NO MATCH FOUND -> TRIGGER SCANNER LOCK & MODAL DIALOG
    playErrorBeep();
    setWrongBarcodeModal({
      isOpen: true,
      barcode: raw,
    });
  };

  // Catalog state & pagination
  const [catalogPage, setCatalogPage] = useState(1);
  const CATALOG_PAGE_SIZE = 32;

  useEffect(() => {
    setCatalogPage(1);
  }, [catalogCategory, catalogSearch, catalogSort]);

  // Catalog filtered products
  const catalogFilteredProducts = useMemo(() => {
    const filtered = products.filter((p) => {
      if (catalogCategory !== 'All' && p.category !== catalogCategory) return false;
      if (catalogSearch.trim() !== '') {
        const q = catalogSearch.trim().toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.nameAr && p.nameAr.toLowerCase().includes(q)) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q)
        );
      }
      return true;
    });

    if (catalogSort === 'name') {
      return filtered.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (catalogSort === 'price-low') {
      return filtered.sort((a, b) => a.retailPrice - b.retailPrice || a.name.localeCompare(b.name));
    }
    if (catalogSort === 'price-high') {
      return filtered.sort((a, b) => b.retailPrice - a.retailPrice || a.name.localeCompare(b.name));
    }
    return filtered;
  }, [products, catalogCategory, catalogSearch, catalogSort]);

  const totalCatalogPages = Math.max(1, Math.ceil(catalogFilteredProducts.length / CATALOG_PAGE_SIZE));

  const paginatedCatalogProducts = useMemo(() => {
    const start = (catalogPage - 1) * CATALOG_PAGE_SIZE;
    return catalogFilteredProducts.slice(start, start + CATALOG_PAGE_SIZE);
  }, [catalogFilteredProducts, catalogPage]);

  // Screen model check: POS (standard retail scanning) vs RPOS (restaurant touch catalogue)
  // Available product groups for restaurant catalogue
  const availableGroups = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category && p.category.trim()) {
        set.add(p.category.trim());
      }
    });
    return Array.from(set).filter((group) => group !== 'All');
  }, [products]);
  const catalogCategoryFilters = useMemo(
    () => ['All', ...availableGroups],
    [availableGroups]
  );

  const categoryImageByName = useMemo(
    () => new Map(rposCategories.map((category) => [category.value, category.imageData])),
    [rposCategories]
  );

  const getGroupDisplayName = useCallback(
    (group: string) => {
      switch (group) {
        case 'All':
          return isRtl ? 'الفئات' : 'Categories';
        case 'Beverages':
          return isRtl ? 'مشروبات' : 'Beverages';
        case 'Bakery & Pantry':
          return isRtl ? 'مخبوزات وتموين' : 'Bakery & Pantry';
        case 'Snacks':
          return isRtl ? 'وجبات خفيفة' : 'Snacks';
        case 'Household':
          return isRtl ? 'منزليات' : 'Household';
        case 'Stationery':
          return isRtl ? 'قرطاسية' : 'Stationery';
        default:
          return group;
      }
    },
    [isRtl]
  );

  const getCategoryCount = useCallback(
    (cat: string) => {
      return products.filter((p) => p.category === cat).length;
    },
    [products]
  );

  // Financial Computations (Subtotal is strictly WITHOUT tax)
  const grossTotal = useMemo(
    () =>
      Number(
        cart
          .reduce((sum, item) => sum + item.product.retailPrice * item.quantity, 0)
          .toFixed(2)
      ),
    [cart]
  );

  const numericDiscount = Math.max(0, Number(discountValue) || 0);
  const discountAmount = useMemo(() => {
    if (numericDiscount <= 0) return 0;
    if (discountType === 'percent') {
      return Number(((grossTotal * Math.min(100, numericDiscount)) / 100).toFixed(2));
    }
    return Number(Math.min(grossTotal, numericDiscount).toFixed(2));
  }, [grossTotal, discountType, numericDiscount]);

  const netAfterDiscount = Math.max(0, grossTotal - discountAmount);

  // Saudi 15% VAT calculation & Subtotal without tax
  const { taxAmount, calculatedTotal, subtotal } = useMemo(() => {
    const rate = settings.taxRate > 0 ? settings.taxRate : 15.0;
    if (settings.taxType === 'inclusive') {
      const totalAmount = netAfterDiscount;
      const computedTax = Number((totalAmount - totalAmount / (1 + rate / 100)).toFixed(2));
      const netSubtotal = Number((totalAmount - computedTax).toFixed(2));
      return { taxAmount: computedTax, calculatedTotal: totalAmount, subtotal: netSubtotal };
    } else {
      const netSubtotal = netAfterDiscount;
      const computedTax = Number(((netSubtotal * rate) / 100).toFixed(2));
      return {
        taxAmount: computedTax,
        calculatedTotal: Number((netSubtotal + computedTax).toFixed(2)),
        subtotal: netSubtotal,
      };
    }
  }, [netAfterDiscount, settings.taxType, settings.taxRate]);

  const total = useMemo(() => {
    if (settings.roundTotalToFiveCents) {
      return Number((Math.round(calculatedTotal * 20) / 20).toFixed(2));
    }
    return calculatedTotal;
  }, [calculatedTotal, settings.roundTotalToFiveCents]);

  const cashTenderedNum = Math.max(0, Number(cashTendered) || 0);
  const cardTenderedNum = Math.max(0, Number(cardTendered) || 0);
  const tenderedNum =
    paymentMethod === 'Cash'
      ? cashTendered === ''
        ? total
        : cashTenderedNum
      : paymentMethod === 'Split'
      ? Number((cashTenderedNum + cardTenderedNum).toFixed(2))
      : total;
  const changeDue =
    paymentMethod === 'Cash' ? Number(Math.max(0, tenderedNum - total).toFixed(2)) : 0;
  const splitAmountsMatchTotal = Math.abs(tenderedNum - total) < 0.005;
  const canCompleteSale =
    cart.length > 0 &&
    !isSubmitting &&
    (paymentMethod === 'Cash'
      ? cashTendered.trim() !== '' && tenderedNum >= total
      : paymentMethod === 'Split'
      ? cashTendered.trim() !== '' && cardTendered.trim() !== '' && splitAmountsMatchTotal
      : true);

  useEffect(() => {
    if (paymentMethod === 'Cash' && !activeTab.cashTenderedManuallySet) {
      setCashTendered(cart.length > 0 ? total.toFixed(settings.decimalPoints ?? 2) : '');
    }
  }, [cart.length, paymentMethod, total, settings.decimalPoints, activeTab.cashTenderedManuallySet]);

  const handlePaymentMethodSelection = (method: PaymentMethod) => {
    setPaymentMethod(method);
    // Reset manual flag so cash field re-syncs to total for the new method
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, cashTenderedManuallySet: false } : tab
      )
    );
    if (method === 'Cash' && cashTendered.trim() === '') {
      setCashTendered(total.toFixed(2));
    }
    if (method === 'Split') {
      if (cashTendered.trim() === '') setCashTendered(total.toFixed(2));
      if (cardTendered.trim() === '') setCardTendered('0.00');
    }
  };

  const warnForZeroPriceItems = () => {
    const zeroPriceItems = cart.filter((item) => item.product.retailPrice <= 0);
    if (zeroPriceItems.length === 0) return false;

    setFeedback(null);
    setZeroPriceDialogItems(zeroPriceItems);
    setSelectedZeroPriceItemId(getCartItemLineId(zeroPriceItems[0]));
    return true;
  };

  const returnToZeroPriceItem = () => {
    const lineId = selectedZeroPriceItemId ?? (
      zeroPriceDialogItems?.[0] ? getCartItemLineId(zeroPriceDialogItems[0]) : undefined
    );
    setZeroPriceDialogItems(null);
    if (!lineId) return;

    setSelectedTicketItemId(lineId);
    requestAnimationFrame(() => {
      Array.from(document.querySelectorAll<HTMLElement>('[data-ticket-item]'))
        .find((element) => element.dataset.ticketItemId === lineId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const handleOpenSettlement = () => {
    if (cart.length === 0) {
      setFeedback({ type: 'error', text: isRtl ? 'أضف صنفاً إلى الفاتورة قبل تسوية الدفع.' : 'Add an item to the ticket before settling tender.' });
      return;
    }

    if (warnForZeroPriceItems()) return;

    if (paymentMethod === 'Cash' && cashTendered.trim() === '') {
      setCashTendered(total.toFixed(2));
    }
    if (paymentMethod === 'Split') {
      if (cashTendered.trim() === '') setCashTendered(total.toFixed(2));
      if (cardTendered.trim() === '') setCardTendered('0.00');
    }

    setCustomerSearch('');
    setIsCustomerPickerOpen(false);
    setFeedback(null);
    if (isRpos) {
      setIsTenderModalOpen(true);
    } else {
      setMobileTab('checkout');
      requestAnimationFrame(() => cashTenderedInputRef.current?.focus());
    }
  };

  const handleCompleteSale = async (confirmed = false) => {
    if (isSubmitting || isSubmittingRef.current) return;
    if (confirmed) setIsSaleConfirmationOpen(false);

    if (cart.length === 0) {
      playErrorBeep();
      setFeedback({
        type: 'error',
        text: isRtl
          ? 'السلة فارغة! يرجى اختيار صنف من الكتالوج أو مسح الباركود أولاً قبل إتمام البيع.'
          : 'Cart is empty! Please select an item from the menu or scan a barcode first before completing the sale.',
      });
      return;
    }

    if (warnForZeroPriceItems()) return;

    if (
      paymentMethod === 'Split' &&
      (cashTendered.trim() === '' || cardTendered.trim() === '' || !splitAmountsMatchTotal)
    ) {
      setMobileTab('checkout');
      requestAnimationFrame(() => cashTenderedInputRef.current?.focus());
      setFeedback({
        type: 'error',
        text: isRtl
          ? 'يجب أن يساوي مجموع المبلغين النقدي والبطاقة إجمالي الفاتورة.'
          : 'Cash and card amounts must add up to the invoice total.',
      });
      return;
    }

    if (paymentMethod === 'Cash' && tenderedNum < total) {
      setMobileTab('checkout');
      requestAnimationFrame(() => cashTenderedInputRef.current?.focus());
      playErrorBeep();
      setFeedback({
        type: 'error',
        text: isRtl
          ? `المبلغ المستلم غير كافٍ! المبلغ الإجمالي المطلوب: ${c} ${total.toFixed(2)} (المتبقي: ${c} ${(total - tenderedNum).toFixed(2)})`
          : `Insufficient cash tendered! Total due: ${c} ${total.toFixed(2)} (Short by ${c} ${(total - tenderedNum).toFixed(2)})`,
      });
      return;
    }

    if (!confirmed) {
      setIsSaleConfirmationOpen(true);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const salesUrl = activeTab.editingSaleId
        ? `/api/sales/${activeTab.editingSaleId}/invoice`
        : '/api/sales';
      const invoiceNumber = await ensureActiveInvoiceNumber();
      const res = await fetch(salesUrl, {
        method: activeTab.editingSaleId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim() || settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
          invoiceNumber,
          discountType,
          discountValue: numericDiscount,
          paymentMethod,
          amountTendered: tenderedNum,
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            unitPrice: item.product.retailPrice,
            unitId: item.unitId || null,
          })),
        }),
      });

      const responseText = await res.text();
      let data: { sale?: Sale; queuedOfflinePrint?: boolean; error?: string } | null = null;
      if (responseText.trim()) {
        try {
          data = JSON.parse(responseText);
        } catch {
          if (res.ok) {
            throw new Error('Server returned an invalid response while saving the sale.');
          }
        }
      }
      if (!res.ok) {
        const errorMessage = data?.error || `Failed to complete sale (HTTP ${res.status}).`;
        if (errorMessage.includes('invoice number has already been used')) {
          const invoiceNumber = await issueInvoiceNumber();
          setTabs((previous) =>
            previous.map((tab) =>
              tab.id === activeTabId
                ? { ...tab, invoiceNumber }
                : tab
            )
          );
          throw new Error('The invoice number was already used. A new number is ready; try again.');
        }
        throw new Error(errorMessage);
      }
      if (!data?.sale) throw new Error('Server returned an empty response while saving the sale.');

      if (tabs.length > 1) {
        const remaining = tabs.filter((t) => t.id !== activeTabId);
        const nextNum = Math.max(...tabs.map((tab) => tab.tabNumber)) + 1;
        const newTabId = `tab-${Date.now()}`;
        const newTab: InvoiceTab = {
          id: newTabId,
          tabNumber: nextNum,
          label: `Ticket #${nextNum}`,
          cart: [],
          customerName: settings.defaultCustomer || 'Walk-in Customer / عميل نقدي',
          discountType: 'fixed',
          discountValue: '',
          paymentMethod: 'Cash',
          cashTendered: '',
          cardTendered: '',
          isHeld: false,
          createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setTabs([...remaining, newTab]);
        setActiveTabId(newTabId);
      } else {
        clearCart();
      }

      setIsTenderModalOpen(false);
      onSaleCompleted(data.sale, Boolean(data.queuedOfflinePrint));
    } catch (err) {
      setFeedback({ type: 'error', text: (err as Error).message });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      focusBarcodeInput();
    }
  };
  completeSaleRef.current = handleCompleteSale;

  const totalUnitsInCart = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-ticket-item]') && !target.closest('[role="dialog"]')) {
      setSelectedTicketItemId(null);
    }
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea') ||
      target.closest('a') ||
      target.closest('[role="dialog"]') ||
      wrongBarcodeModal ||
      isCatalogOpen ||
      receiptModalOpen
    ) {
      return;
    }
    focusBarcodeInput();
  };

  const resizeRposTicket = (clientX: number, container: HTMLElement) => {
    const bounds = container.getBoundingClientRect();
    const maxWidth = Math.max(150, Math.min(800, bounds.width - 120));
    const nextWidth = Math.min(maxWidth, Math.max(150, bounds.right - clientX));
    setRposTicketWidth(nextWidth);
  };

  const handleRposResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.currentTarget.parentElement) {
      resizeRposTicket(e.clientX, e.currentTarget.parentElement);
    }
  };

  const handleRposResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !e.currentTarget.parentElement) return;
    resizeRposTicket(e.clientX, e.currentTarget.parentElement);
  };

  const handleRposResizeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowLeft' ? 16 : -16;
    setRposTicketWidth((width) => Math.min(800, Math.max(150, width + delta)));
  };

  const editingCartItem = cart.find(
    (item) => getCartItemLineId(item) === editingTicketItemId
  );

  return (
    <div
      onClick={handleContainerClick}
      className="flex-1 flex flex-col min-h-0 bg-slate-100 overflow-hidden relative"
    >
      {/* 1. TOP BAR: MULTI-INVOICE TICKET TABS */}
      <header className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 shrink-0 z-10 shadow-xs">
        <div className="flex items-center gap-2 overflow-x-auto min-w-0 flex-1 py-0.5">
          <div className="flex items-center gap-1.5 shrink-0">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const itemCount = tab.cart.reduce((s, i) => s + i.quantity, 0);
              const tabTotal = tab.cart.reduce(
                (s, i) => s + i.product.retailPrice * i.quantity,
                0
              );

              return (
                <div
                  key={tab.id}
                  className={`flex items-center rounded-lg text-xs font-medium transition-all shrink-0 border ${
                    isActive
                      ? 'bg-blue-50 text-blue-900 border-blue-400 shadow-xs font-bold'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTabId(tab.id);
                      focusBarcodeInput();
                    }}
                    className="px-3 py-1.5 flex items-center gap-2 text-left"
                  >
                    {tab.isHeld && (
                      <span
                        className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"
                        title="Ticket on Hold"
                      />
                    )}
                    <span>{tab.label}</span>
                    {itemCount > 0 && (
                      <span
                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                          isActive
                            ? 'bg-blue-600 text-white font-bold'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {itemCount} | {c} {tabTotal.toFixed(2)}
                      </span>
                    )}
                  </button>

                  {tabs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleCloseTab(tab.id)}
                      className="p-1 mr-1 text-slate-400 hover:text-red-600 hover:bg-white rounded transition-colors"
                      title="Close ticket"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleNewTab}
            className="px-2.5 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 rounded-lg text-slate-700 text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors"
            title={isRtl ? 'فتح فاتورة جديدة' : 'Open new invoice tab'}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isRtl ? 'فاتورة جديدة' : 'New Tab'}</span>
          </button>

          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="px-2.5 py-1.5 bg-white hover:bg-red-50 text-red-600 hover:text-red-700 border border-red-200 rounded-lg text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors"
              title={isRtl ? 'مسح الفاتورة الحالية (F5)' : 'Clear current ticket (F5)'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isRtl ? 'مسح' : 'Clear'}</span>
              <span className="text-[9px] font-mono opacity-70">F5</span>
            </button>
          )}

          {cart.length > 0 && (
            <button
              type="button"
              onClick={handleHoldCurrentTab}
              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors"
              title={isRtl ? 'تعليق الفاتورة الحالية والانتقال لأخرى (F6)' : 'Hold this ticket and switch to a new tab (F6)'}
            >
              <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
              <span>{isRtl ? 'تعليق' : 'Hold'}</span>
              <span className="text-[9px] font-mono opacity-70">F6</span>
            </button>
          )}

          <div className="flex items-center gap-2 whitespace-nowrap text-[9px] text-slate-400">
            <span><kbd className="font-mono">F2</kbd> {isRtl ? 'مسح' : 'Scan'}</span>
            <span>·</span>
            <span><kbd className="font-mono">F5</kbd> {isRtl ? 'مسح الفاتورة' : 'Clear Ticket'}</span>
            <span>·</span>
            <span>{isRtl ? 'اضغط' : 'Press'} <kbd className="font-mono">F9</kbd> {isRtl ? 'للتسوية' : 'to Settle'}</span>
          </div>
        </div>

        {/* Right Info: Store Name & Cashier */}
        <div className="hidden lg:flex items-center gap-3 text-xs text-slate-500 shrink-0">
          <span className="font-medium text-slate-700">
            {isRtl && settings.storeNameAr ? settings.storeNameAr : settings.storeName}
            {!isRtl && settings.storeNameAr ? ` · ${settings.storeNameAr}` : ''}
          </span>
          <span className="w-1 h-1 rounded-full bg-slate-300" />
          <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">
            {settings.cashierName}
          </span>
        </div>
      </header>

      {/* Universal Register Feedback Banner (Always visible in both POS and RPOS) */}
      {feedback && (
        <div
          className={`px-4 py-2.5 border-b text-xs flex items-center justify-between shrink-0 shadow-xs animate-in slide-in-from-top-1 ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900 font-semibold'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900 font-semibold'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-bold underline ml-4 hover:opacity-75"
          >
            {isRtl ? 'إغلاق' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Mobile Switcher (< 900px) */}
      {!isRpos && (
      <div className="min-[900px]:hidden p-2 bg-white border-b border-slate-200 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            setMobileTab('table');
            if (!isRpos) focusBarcodeInput();
          }}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 ${
            mobileTab === 'table'
              ? 'bg-blue-700 text-white shadow-xs'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          {isRpos ? <LayoutGrid className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
          <span>
            {isRpos
              ? (isRtl ? 'قائمة الأصناف والمجموعات' : 'Menu Catalogue')
              : (isRtl ? `الأصناف (${totalUnitsInCart})` : `Scanned Table (${totalUnitsInCart})`)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('checkout')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 ${
            mobileTab === 'checkout'
              ? 'bg-blue-700 text-white shadow-xs'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>
            {isRpos
              ? (isRtl ? `طلب الطاولة · ${c} ${total.toFixed(2)}` : `Ticket · ${c} ${total.toFixed(2)}`)
              : (isRtl ? `الدفع · ${c} ${total.toFixed(2)}` : `Pay · ${c} ${total.toFixed(2)}`)}
          </span>
        </button>
      </div>
      )}

      {/* 2. MAIN LAYOUT: SCANNED TABLE (TAKES MOST SPACE) + DOCKED CHECKOUT PANEL */}
      <div className={`flex-1 flex min-h-0 overflow-hidden ${isRpos ? 'flex-row' : 'flex-col min-[900px]:flex-row'}`}>
        {/* ======================================================== */}
        {/* LEFT / CENTER: EITHER RPOS (RESTAURANT) OR POS (RETAIL)   */}
        {/* ======================================================== */}
        {isRpos ? (
          <main
            className={`order-1 flex-1 flex flex-col min-w-0 bg-slate-50 border-r border-slate-200 overflow-hidden ${
              mobileTab === 'table' ? 'flex' : 'hidden lg:flex'
            }`}
          >
            {/* 1. RPOS Category Selector */}
            <div className="p-3 sm:p-4 bg-white border-b border-slate-200 shrink-0 shadow-xs">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => {
                    setCatalogSearch('');
                    if (isBrowsingCategories) {
                      setCatalogCategory('All');
                      setCatalogPage(1);
                      setIsBrowsingCategories(false);
                    } else {
                      setIsBrowsingCategories(true);
                    }
                  }}
                  aria-pressed={isBrowsingCategories}
                  className={`inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold shadow-xs sm:w-auto ${
                    isBrowsingCategories
                      ? 'border-blue-600 bg-blue-700 text-white'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <LayoutGrid className={`h-4 w-4 ${isBrowsingCategories ? 'text-white' : 'text-blue-600'}`} />
                  <span>{getGroupDisplayName('All')}</span>
                </button>
                <div className="relative min-w-0 flex-1">
                  <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-3' : 'left-3'}`} />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(event) => {
                      setCatalogSearch(event.target.value);
                      setIsBrowsingCategories(false);
                    }}
                    placeholder={
                      catalogCategory === 'All'
                        ? (isRtl ? 'بحث في جميع المنتجات...' : 'Search all products...')
                        : isRtl
                          ? `بحث في ${getGroupDisplayName(catalogCategory)}...`
                          : `Search ${getGroupDisplayName(catalogCategory)}...`
                    }
                    className={`w-full rounded-lg border border-slate-300 bg-slate-50 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 ${isRtl ? 'pr-9 pl-9' : 'pl-9 pr-9'}`}
                  />
                  {catalogSearch && (
                    <button
                      type="button"
                      onClick={() => setCatalogSearch('')}
                      className={`absolute top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 ${isRtl ? 'left-2' : 'right-2'}`}
                      aria-label={isRtl ? 'مسح البحث' : 'Clear search'}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <select
                  aria-label={isRtl ? 'ترتيب المنتجات' : 'Sort products'}
                  value={catalogSort}
                  onChange={(event) => setCatalogSort(event.target.value as typeof catalogSort)}
                  className="w-full shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 sm:w-40"
                >
                  <option value="featured">{isRtl ? 'الترتيب الافتراضي' : 'Featured'}</option>
                  <option value="name">{isRtl ? 'الاسم: أ إلى ي' : 'Name: A to Z'}</option>
                  <option value="price-low">{isRtl ? 'السعر: الأقل أولاً' : 'Price: Low to high'}</option>
                  <option value="price-high">{isRtl ? 'السعر: الأعلى أولاً' : 'Price: High to low'}</option>
                </select>
              </div>
            </div>

            {/* 3. Product Cards Grid */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-100/60">
              {isBrowsingCategories ? (
                <>
                  {rposCategoryError && (
                    <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      {rposCategoryError}
                    </div>
                  )}
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))' }}
                  >
                    {availableGroups.map((group) => {
                      const imageData = categoryImageByName.get(group) || '';
                      const selected = group === catalogCategory;
                      return (
                        <button
                          key={group}
                          type="button"
                          onClick={() => {
                            setCatalogCategory(group);
                            setCatalogPage(1);
                            setCatalogSearch('');
                            setIsBrowsingCategories(false);
                          }}
                          className={`group relative flex min-h-[230px] select-none flex-col overflow-hidden rounded-2xl border bg-white p-2.5 text-start shadow-sm transition-all active:scale-[0.99] ${
                            selected
                              ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md'
                              : 'border-slate-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-lg'
                          }`}
                        >
                          <div className="relative mb-1.5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50">
                            {imageData ? (
                              <img
                                src={imageData}
                                alt={getGroupDisplayName(group)}
                                className="h-auto w-auto max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                              />
                            ) : (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
                                <LayoutGrid className="h-10 w-10" />
                                <span className="text-[10px] font-medium text-slate-400">
                                  {isRtl ? 'لا توجد صورة' : 'No image'}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="mt-0.5 flex w-full flex-col gap-1">
                            <span className="truncate whitespace-nowrap text-sm font-medium leading-snug text-slate-900">
                              {getGroupDisplayName(group)}
                            </span>
                            <span className="text-xs font-semibold text-slate-500">
                              {getCategoryCount(group)} {isRtl ? 'منتج' : 'products'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : paginatedCatalogProducts.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-white rounded-2xl border border-slate-200 shadow-xs">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                    <Search className="w-8 h-8" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">
                    {isRtl ? 'لا توجد منتجات في هذه المجموعة' : 'No products found in this group'}
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    {isRtl ? 'حاول اختيار فئة أخرى.' : 'Try selecting another category.'}
                  </p>
                  {catalogCategory !== 'All' && (
                    <button
                      type="button"
                      onClick={() => {
                        setCatalogCategory('All');
                        setCatalogSearch('');
                      }}
                      className="mt-3 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-200 hover:bg-blue-100"
                    >
                      {isRtl ? 'عرض كل الأصناف' : 'Show All Items'}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {isRtl ? 'اختر منتجاً لإضافته إلى الطلب' : 'Select a product to add it to the ticket'}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
                      {catalogFilteredProducts.length} {isRtl ? 'منتج' : 'products'}
                    </span>
                  </div>
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))' }}
                  >
                  {paginatedCatalogProducts.map((prod) => {
                    const isOut = !settings.allowNegativeStock && prod.stock <= 0;
                    const inCartCount = cart.find((ci) => ci.product.id === prod.id)?.quantity || 0;

                    return (
                      <button
                        key={prod.id}
                        type="button"
                        disabled={isOut}
                        onClick={() => addToCart(prod)}
                        className={`group relative flex min-h-[230px] select-none flex-col overflow-hidden rounded-2xl border bg-white p-2.5 text-start shadow-sm transition-all active:scale-[0.99] ${
                          isOut
                            ? 'cursor-not-allowed border-slate-200 opacity-60'
                            : inCartCount > 0
                            ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md'
                            : 'border-slate-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-lg'
                        }`}
                      >
                        <div className="relative mb-1.5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50">
                          {!prod.imagePath && !prod.imageData && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
                              <PackageCheck className="h-10 w-10" />
                              <span className="text-[10px] font-medium text-slate-400">
                                {isRtl ? 'لا توجد صورة' : 'No image'}
                              </span>
                            </div>
                          )}
                          {(prod.imagePath || prod.imageData) && (
                            <ProductImage
                              imagePath={prod.imagePath}
                              imageData={prod.imageData}
                              alt={prod.name}
                              className="relative z-10 h-auto w-auto max-h-full max-w-full object-contain p-1 transition-transform duration-300 group-hover:scale-105"
                            />
                          )}
                          {inCartCount > 0 && (
                            <span className={`absolute ${isRtl ? 'left-2' : 'right-2'} top-2 z-20 inline-flex items-center gap-1 rounded-full bg-blue-700 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm`}>
                              <ShoppingBag className="h-3 w-3" />
                              ×{inCartCount}
                            </span>
                          )}
                          {isOut && (
                            <span className={`absolute bottom-2 ${isRtl ? 'right-2' : 'left-2'} z-20 rounded-full bg-slate-900/80 px-2.5 py-1 text-[10px] font-bold text-white`}>
                              {isRtl ? 'نفذ المخزون' : 'Out of stock'}
                            </span>
                          )}
                        </div>

                        <div className="mt-0.5 flex w-full flex-col gap-1.5 pt-0.5">
                          <div className={`flex min-w-0 items-center gap-1 text-start ${isRtl ? 'flex-row-reverse' : ''}`}>
                            <div
                              dir={isRtl ? 'rtl' : 'ltr'}
                              title={isRtl && prod.nameAr ? prod.nameAr : prod.name}
                              className="min-w-0 flex-1 truncate whitespace-nowrap text-[clamp(0.8rem,1vw,1rem)] font-medium leading-snug text-slate-900"
                            >
                              {isRtl && prod.nameAr ? prod.nameAr : prod.name}
                            </div>
                            {prod.nameAr && prod.name && (
                              <div
                                dir={isRtl ? 'ltr' : 'rtl'}
                                title={isRtl ? prod.name : prod.nameAr}
                                className="max-w-[42%] shrink-0 truncate whitespace-nowrap text-xs font-medium text-slate-500"
                              >
                                {isRtl ? prod.name : prod.nameAr}
                              </div>
                            )}
                          </div>

                          <div className="flex w-full items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-mono text-[clamp(0.9rem,1vw,1.1rem)] font-black tabular-nums text-slate-900">
                                {c} {prod.retailPrice.toFixed(2)}
                              </span>
                            </div>
                            <span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${
                              isOut
                                ? 'bg-slate-100 text-slate-500'
                                : inCartCount > 0
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-emerald-50 text-emerald-700'
                            }`}>
                              {isOut
                                ? (isRtl ? 'نفذ' : 'Unavailable')
                                : inCartCount > 0
                                  ? (isRtl ? 'مضاف' : 'Added')
                                  : (isRtl ? '+ إضافة' : '+ Add')}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  </div>
                </>
              )}
            </div>

            {/* 4. Pagination / Page Switcher if multiple pages */}
            {totalCatalogPages > 1 && !isBrowsingCategories && (
              <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 shrink-0">
                <span className="font-medium">
                  {isRtl
                    ? `عرض ${Math.min((catalogPage - 1) * CATALOG_PAGE_SIZE + 1, catalogFilteredProducts.length)} - ${Math.min(catalogPage * CATALOG_PAGE_SIZE, catalogFilteredProducts.length)} من ${catalogFilteredProducts.length}`
                    : `Showing ${Math.min((catalogPage - 1) * CATALOG_PAGE_SIZE + 1, catalogFilteredProducts.length)} - ${Math.min(catalogPage * CATALOG_PAGE_SIZE, catalogFilteredProducts.length)} of ${catalogFilteredProducts.length}`}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={catalogPage <= 1}
                    onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg font-bold text-xs"
                  >
                    {isRtl ? 'السابق' : 'Prev'}
                  </button>
                  <span className="px-2 font-mono font-bold text-slate-800">
                    {catalogPage} / {totalCatalogPages}
                  </span>
                  <button
                    type="button"
                    disabled={catalogPage >= totalCatalogPages}
                    onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg font-bold text-xs"
                  >
                    {isRtl ? 'التالي' : 'Next'}
                  </button>
                </div>
              </div>
            )}
          </main>
        ) : (
          <main
            className={`flex-1 flex flex-col min-w-0 bg-white border-r border-slate-200 overflow-hidden ${
              mobileTab === 'table' ? 'flex' : 'hidden min-[900px]:flex'
            }`}
          >
          {/* BARCODE SCANNING & QUICK ACTION BAR */}
          <div className="p-3 sm:p-4 bg-slate-50 border-b border-slate-200 space-y-2.5 shrink-0">
            <form onSubmit={handleBarcodeSubmit} className="flex flex-col gap-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative min-w-0">
                <Barcode className={`w-5 h-5 text-blue-700 absolute ${isRtl ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 pointer-events-none`} />
                <input
                  ref={barcodeInputRef}
                  id="pos-barcode-scanner-input"
                  disabled={Boolean(wrongBarcodeModal)}
                  autoFocus
                  type="text"
                  value={barcodeInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBarcodeSubmit(e);
                    }
                  }}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder={t.scanOrSearch}
                  className={`w-full ${isRtl ? 'pr-11 pl-3' : 'pl-11 pr-3'} py-2.5 text-xs sm:text-sm bg-white border-2 border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 rounded-lg text-slate-900 placeholder:text-slate-400 font-mono transition-all disabled:bg-slate-100 disabled:opacity-50`}
                />
              </div>
              <div ref={allProductSearchRef} className="relative min-w-0">
                <Search className={`w-5 h-5 text-slate-500 absolute ${isRtl ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2 pointer-events-none`} />
                <input
                  type="text"
                  value={allProductSearch}
                  onFocus={() => setIsAllProductSearchFocused(true)}
                  onChange={(e) => {
                    setAllProductSearch(e.target.value);
                    setSelectedSearchIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsAllProductSearchFocused(false);
                    } else if (e.key === 'ArrowDown' && matchingAllSearchProducts.length > 0) {
                      e.preventDefault();
                      setSelectedSearchIndex((index) =>
                        (index + 1) % matchingAllSearchProducts.length
                      );
                    } else if (e.key === 'ArrowUp' && matchingAllSearchProducts.length > 0) {
                      e.preventDefault();
                      setSelectedSearchIndex((index) =>
                        (index - 1 + matchingAllSearchProducts.length) % matchingAllSearchProducts.length
                      );
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      const selectedProduct = matchingAllSearchProducts[selectedSearchIndex];
                      if (selectedProduct) {
                        addToCart(selectedProduct);
                        setAllProductSearch('');
                        setIsAllProductSearchFocused(false);
                        focusBarcodeInput();
                      }
                    }
                  }}
                  placeholder={isRtl ? 'البحث في جميع المنتجات...' : 'Search all products...'}
                  aria-label={isRtl ? 'البحث في جميع المنتجات' : 'Search all products'}
                  className={`w-full ${isRtl ? 'pr-11 pl-3' : 'pl-11 pr-3'} py-2.5 text-xs sm:text-sm bg-white border-2 border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 rounded-lg text-slate-900 placeholder:text-slate-400 transition-all`}
                />
                {isAllProductSearchFocused && allProductSearch.trim() && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden max-h-80 overflow-y-auto">
                    {matchingAllSearchProducts.length === 0 ? (
                      <div className="p-4 text-xs text-center text-slate-500">
                        {isRtl ? 'لا توجد منتجات مطابقة' : 'No matching products found'}
                      </div>
                    ) : (
                      matchingAllSearchProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setSelectedSearchIndex(matchingAllSearchProducts.indexOf(product))}
                          onClick={() => {
                            addToCart(product);
                            setAllProductSearch('');
                            setIsAllProductSearchFocused(false);
                            focusBarcodeInput();
                          }}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left border-b border-slate-100 last:border-b-0 ${
                            matchingAllSearchProducts[selectedSearchIndex]?.id === product.id
                              ? 'bg-blue-100 ring-1 ring-inset ring-blue-300'
                              : 'hover:bg-blue-50'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-slate-900">
                              {isRtl && product.nameAr ? product.nameAr : product.name}
                            </span>
                            <span className="block truncate text-[11px] text-slate-500">
                              {product.sku}{product.barcode ? ` · ${product.barcode}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-xs font-semibold text-slate-700">
                            {c} {product.retailPrice.toFixed(2)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              </div>

            </form>

            <div className="flex items-center justify-end text-[11px] text-slate-500 pt-0.5">
              <div className="text-slate-600 font-medium">
                {isRtl ? 'الأصناف في الفاتورة:' : 'Active Items:'} <span className="font-bold text-blue-700">{cart.length}</span> {isRtl ? 'بنود' : 'lines'} ·{' '}
                <span className="font-bold text-blue-700">{totalUnitsInCart}</span> {isRtl ? 'قطع' : 'units'}
              </div>
            </div>
          </div>

          {/* THE ENTERPRISE SCANNED PRODUCTS TABLE */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="h-full min-h-[360px] flex flex-col items-center justify-center p-8 text-center bg-slate-50/50">
                <div className="w-20 h-20 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-4 shadow-xs">
                  <Barcode className="w-10 h-10" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Ready to Scan / بانتظار مسح الباركود
                </h3>
                <p className="text-xs text-slate-500 mt-1.5 max-w-md leading-relaxed">
                  Scan a barcode using the scanner gun to add items directly to this invoice. If a product has no barcode, click <strong>Browse Catalog (F4)</strong> to pick it manually.
                </p>
              </div>
            ) : (
              <div className="space-y-2 bg-slate-50 p-3 sm:p-4">
                {cart.map((item) => {
                  const lineSubtotal = item.product.retailPrice * item.quantity;
                  const taxRate = settings.taxRate || 15;
                  const lineTax =
                    settings.taxType === 'inclusive'
                      ? Number((lineSubtotal - lineSubtotal / (1 + taxRate / 100)).toFixed(2))
                      : Number(((lineSubtotal * taxRate) / 100).toFixed(2));
                  const lineWithoutTax =
                    settings.taxType === 'inclusive'
                      ? Number((lineSubtotal - lineTax).toFixed(2))
                      : lineSubtotal;
                  const lineTotal =
                    settings.taxType === 'inclusive'
                      ? lineSubtotal
                      : Number((lineSubtotal + lineTax).toFixed(2));
                  const lineId = getCartItemLineId(item);
                  return (
                    <div
                      key={lineId}
                      data-ticket-item
                      data-ticket-item-id={lineId}
                      onClick={() => setSelectedTicketItemId(lineId)}
                      onDoubleClick={() => openTicketItemEditor(item)}
                      title={isRtl ? 'انقر مرتين لتعديل الصنف' : 'Double-click to edit item'}
                      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-xl border p-2.5 transition-colors ${
                        selectedTicketItemId === lineId
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                          : 'border-slate-200 bg-slate-50 hover:bg-blue-50/40'
                      }`}
                    >
                      <div className="col-span-2 flex min-w-0 items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-left text-xs font-bold text-slate-900">
                            {item.product.name}
                          </span>
                          <span dir="rtl" className="min-w-0 truncate text-right text-xs font-bold text-slate-700">
                            {item.product.nameAr || ''}
                          </span>
                        </div>
                        {selectedTicketItemId === lineId && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeFromCart(lineId);
                            }}
                            aria-label={isRtl ? 'حذف الصنف' : 'Delete item'}
                            title={isRtl ? 'حذف الصنف' : 'Delete item'}
                            className="rounded-md p-1 text-red-600 hover:bg-red-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="col-span-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-semibold text-slate-600">
                        <span className="whitespace-nowrap font-mono text-xs font-bold text-blue-700">
                          {item.quantity}
                        </span>
                        <span className="whitespace-nowrap text-xs font-semibold text-slate-600">
                          · {item.unitName || item.product.unit || 'ea'} ·
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedTicketItemId(lineId);
                            openTicketItemEditor(item);
                          }}
                          className="whitespace-nowrap font-mono text-xs font-bold text-blue-700 hover:text-blue-900"
                          title={isRtl ? 'اضغط لتعديل السعر' : 'Click to edit price'}
                        >
                          {item.product.retailPrice.toFixed(2)}
                        </button>
                        <span className="whitespace-nowrap">
                          {isRtl ? 'قبل الضريبة' : 'Excl. Tax'}{' '}
                          <span className="font-mono text-xs font-semibold text-blue-700">
                            {lineWithoutTax.toFixed(2)}
                          </span>
                        </span>
                        <span className="whitespace-nowrap">
                          VAT <span className="font-mono text-xs font-semibold text-blue-700">{taxRate}%</span>
                        </span>
                        <span className="whitespace-nowrap">
                          {isRtl ? 'الضريبة' : 'Tax'}{' '}
                          <span className="font-mono text-xs font-semibold text-blue-700">
                            {lineTax.toFixed(2)}
                          </span>
                        </span>
                        <span className="ml-auto whitespace-nowrap text-right">
                          {isRtl ? 'الإجمالي' : 'Total'}{' '}
                          <strong className="font-mono text-xs font-black text-red-600">
                            {lineTotal.toFixed(2)}
                          </strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
        )}

        {/* ======================================================== */}
        {/* RIGHT SIDE: DOCKED TOTALS & CHECKOUT / PAYMENT PANEL     */}
        {/* ======================================================== */}
        {isRpos && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={isRtl ? 'تغيير عرض لوحة التذكرة' : 'Resize ticket panel'}
            aria-valuemin={150}
            aria-valuemax={800}
            aria-valuenow={Math.round(rposTicketWidth)}
            tabIndex={0}
            onPointerDown={handleRposResizePointerDown}
            onPointerMove={handleRposResizePointerMove}
            onKeyDown={handleRposResizeKeyDown}
            className="order-2 z-10 flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center bg-slate-200 transition-colors hover:bg-blue-400 focus-visible:bg-blue-500 focus-visible:outline-none"
            title={isRtl ? 'اسحب لتغيير عرض التذكرة' : 'Drag to resize the ticket panel'}
          >
            <span className="h-10 w-1 rounded-full bg-slate-400" />
          </div>
        )}
        <aside
          style={isRpos ? { width: `min(${rposTicketWidth}px, calc(100vw - 120px))` } : undefined}
          className={`${isRpos ? 'order-3' : 'order-2'} shrink-0 ${
            isRpos
              ? 'min-w-[150px] max-w-[800px]'
              : 'w-full min-[900px]:w-[320px] min-[1100px]:w-[380px] xl:w-[420px]'
          } bg-white flex flex-col min-h-0 border-l border-slate-200 ${
            isRpos ? 'xl:flex-none' : 'lg:flex-none'
          } ${
            isRpos ? 'flex' : mobileTab === 'checkout' ? 'flex flex-1 min-[900px]:flex-none' : 'hidden min-[900px]:flex'
          }`}
        >
          {/* Header */}
          <div className="px-2 py-1 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900">
                {isRpos ? activeTab.label : (isRtl ? 'تسوية الدفع' : 'Settlement')}
              </h2>
              {!isRpos && (
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {activeTab.label} · {cart.length} {isRtl ? 'بنود' : 'lines'} ({totalUnitsInCart} {isRtl ? 'قطع' : 'items'})
                </p>
              )}
            </div>
            {isRpos && (
              <div className="ml-2 flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={isSubmitting || cart.length === 0}
                  onClick={handleOpenSettlement}
                  aria-label={isRtl ? 'إتمام التذكرة' : 'Complete ticket'}
                  title={isRtl ? 'إتمام التذكرة' : 'Complete ticket'}
                  className="flex h-10 w-24 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-emerald-500 text-[10px] font-bold leading-tight text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{isRtl ? 'إتمام' : 'Complete'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-3 pt-3 pb-3 space-y-3">
            {/* IN RPOS MODE: TICKET ITEMS LIST WITH TOUCH CONTROLS */}
            {isRpos && (
              <div className="flex min-h-0 flex-1 flex-col space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>{isRtl ? 'الأصناف في الطلب' : 'Order Items'}</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    {cart.length} {isRtl ? 'بنود' : 'lines'} · {totalUnitsInCart} {isRtl ? 'قطع' : 'units'}
                  </span>
                </div>

                {cart.length === 0 ? (
                  <div className="p-5 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs">
                    <ShoppingBag className="w-7 h-7 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">
                      {isRtl ? 'الطلب فارغ حالياً' : 'Order Ticket is Empty'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {isRtl ? 'اضغط على أي صنف من الكتالوج لإضافته للطلب' : 'Click any dish or beverage from the menu to add'}
                    </p>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {cart.map((item) => {
                      const lineSubtotal = item.product.retailPrice * item.quantity;
                      const taxRate = settings.taxRate || 15;
                      const lineTax =
                        settings.taxType === 'inclusive'
                          ? Number((lineSubtotal - lineSubtotal / (1 + taxRate / 100)).toFixed(2))
                          : Number(((lineSubtotal * taxRate) / 100).toFixed(2));
                      const lineWithoutTax =
                        settings.taxType === 'inclusive'
                          ? Number((lineSubtotal - lineTax).toFixed(2))
                          : lineSubtotal;
                      const lineTotal =
                        settings.taxType === 'inclusive'
                          ? lineSubtotal
                          : Number((lineSubtotal + lineTax).toFixed(2));
                      const lineId = getCartItemLineId(item);
                      return (
                        <div
                            key={lineId}
                          data-ticket-item
                            data-ticket-item-id={lineId}
                            onClick={() => setSelectedTicketItemId(lineId)}
                          onDoubleClick={() => openTicketItemEditor(item)}
                          title={isRtl ? 'انقر مرتين لتعديل الصنف' : 'Double-click to edit item'}
                          className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-xl border p-2.5 transition-colors ${
                            selectedTicketItemId === lineId
                              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                              : 'border-slate-200 bg-slate-50 hover:bg-blue-50/40'
                          }`}
                        >
                          <div className="col-span-2 flex min-w-0 items-center gap-2">
                            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate text-left text-xs font-bold text-slate-900">
                                {item.product.name}
                              </span>
                              <span dir="rtl" className="min-w-0 truncate text-right text-xs font-bold text-slate-700">
                                {item.product.nameAr || ''}
                              </span>
                            </div>
                            {selectedTicketItemId === lineId && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeFromCart(lineId);
                                }}
                                aria-label={isRtl ? 'حذف الصنف' : 'Delete item'}
                                title={isRtl ? 'حذف الصنف' : 'Delete item'}
                                className="rounded-md p-1 text-red-600 hover:bg-red-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="col-span-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-semibold text-slate-600">
                            <span className="whitespace-nowrap text-xs font-mono font-bold text-blue-700">
                              {item.quantity}
                            </span>
                            <span className="whitespace-nowrap text-xs font-semibold text-slate-600">
                              · {item.unitName || item.product.unit || 'ea'} ·
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedTicketItemId(lineId);
                                openTicketItemEditor(item);
                              }}
                              className="whitespace-nowrap font-mono text-xs font-bold text-blue-700 hover:text-blue-900"
                              title={isRtl ? 'اضغط لتعديل السعر' : 'Click to edit price'}
                            >
                              {item.product.retailPrice.toFixed(2)}
                            </button>
                            <span className="whitespace-nowrap">
                              {isRtl ? 'قبل الضريبة' : 'Excl. Tax'}{' '}
                              <span className="font-mono text-xs font-semibold text-blue-700">
                                {lineWithoutTax.toFixed(2)}
                              </span>
                            </span>
                            <span className="whitespace-nowrap">
                              VAT <span className="font-mono text-xs font-semibold text-blue-700">{taxRate}%</span>
                            </span>
                            <span className="whitespace-nowrap">
                              {isRtl ? 'الضريبة' : 'Tax'}{' '}
                              <span className="font-mono text-xs font-semibold text-blue-700">
                                {lineTax.toFixed(2)}
                              </span>
                            </span>
                            <span className="ml-auto whitespace-nowrap text-right">
                              {isRtl ? 'الإجمالي' : 'Total'}{' '}
                              <strong className="font-mono text-xs font-black text-red-600">
                                {lineTotal.toFixed(2)}
                              </strong>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {/* Financial Ledger Summary */}
            {!isRpos && (
              <div className="space-y-3">
                <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <label className="block text-xs font-semibold text-slate-700">
                    {isRtl ? 'العميل' : 'Customer'}
                  </label>
                  <div className="relative" data-customer-picker>
                    <input
                      type="text"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={isCustomerPickerOpen}
                      aria-controls="settlement-customer-options"
                      value={isCustomerPickerOpen ? customerSearch : customerName}
                      onFocus={() => {
                        setCustomerSearch('');
                        setIsCustomerPickerOpen(true);
                      }}
                      onClick={() => {
                        if (!isCustomerPickerOpen) {
                          setCustomerSearch('');
                          setIsCustomerPickerOpen(true);
                        }
                      }}
                      onChange={(event) => {
                        setCustomerSearch(event.target.value);
                        setIsCustomerPickerOpen(true);
                      }}
                      placeholder={isRtl ? 'ابحث عن عميل بالاسم أو الهاتف' : 'Search customers by name or phone'}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    {isCustomerPickerOpen && (
                      <div
                        id="settlement-customer-options"
                        role="listbox"
                        className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
                      >
                        {showDefaultCustomerOption && (
                          <button
                            type="button"
                            role="option"
                            aria-selected={customerName === defaultCustomerName}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setCustomerName(defaultCustomerName);
                              setCustomerSearch('');
                              setIsCustomerPickerOpen(false);
                            }}
                            className="w-full rounded-md px-2 py-2 text-left text-xs text-slate-800 hover:bg-blue-50"
                          >
                            {defaultCustomerName}
                          </button>
                        )}
                        {matchingCustomers.map((customer) => (
                          <button
                            key={customer.id}
                            type="button"
                            role="option"
                            aria-selected={customerName === customer.name}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setCustomerName(customer.name);
                              setCustomerSearch('');
                              setIsCustomerPickerOpen(false);
                            }}
                            className="flex w-full flex-col items-start rounded-md px-2 py-2 text-left text-xs text-slate-800 hover:bg-blue-50"
                          >
                            <span>{customer.name}</span>
                            {(customer.nameAr || customer.phone) && (
                              <span className="text-[10px] text-slate-500">
                                {[customer.nameAr, customer.phone].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </button>
                        ))}
                        {matchingCustomers.length === 0 && !showDefaultCustomerOption && (
                          <p className="px-2 py-2 text-xs text-slate-500">
                            {isRtl ? 'لا يوجد عملاء مطابقون' : 'No matching customers'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <label className="block text-xs font-semibold text-slate-700">
                    {isRtl ? 'خصم الفاتورة' : 'Invoice Discount'}
                  </label>
                  <div className="flex">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={discountValue}
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.currentTarget.select()}
                      onChange={(event) => setDiscountValue(event.target.value)}
                      placeholder="0.00"
                      className={`w-full min-w-0 border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none ${isRtl ? 'rounded-r-lg border-l-0' : 'rounded-l-lg border-r-0'}`}
                    />
                    <button
                      type="button"
                      onClick={() => setDiscountType((previous) => previous === 'fixed' ? 'percent' : 'fixed')}
                      className={`border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-mono font-bold text-slate-700 hover:bg-slate-200 ${isRtl ? 'rounded-l-lg border-r-0' : 'rounded-r-lg border-l-0'}`}
                      title={isRtl ? 'تبديل الخصم بين القيمة والنسبة' : 'Toggle currency or percentage discount'}
                    >
                      {discountType === 'fixed' ? c : '%'}
                    </button>
                  </div>
                </section>

                <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <h3 className="text-xs font-semibold text-slate-700">
                    {isRtl ? 'طريقة الدفع' : 'Payment Method'}
                  </h3>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {paymentMethods.map((method) => {
                      const selected = paymentMethod === method;
                      return (
                        <button
                          key={method}
                          type="button"
                          onClick={() => handlePaymentMethodSelection(method)}
                          className={`flex items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-xs font-bold transition-colors ${
                            selected
                              ? 'border-blue-700 bg-blue-700 text-white'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {method === 'Cash' ? <Banknote className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                          {paymentMethodLabel(method)}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {paymentMethod === 'Cash' && (
                  <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-xs font-semibold text-slate-700">
                      {isRtl ? 'المبلغ النقدي المستلم' : 'Cash Received'}
                      <input
                        ref={cashTenderedInputRef}
                        type="number"
                        min={0}
                        step="0.01"
                        value={cashTendered}
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => event.currentTarget.select()}
                        onChange={(event) => setCashTendered(event.target.value, true)}
                        placeholder={total.toFixed(2)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-right text-base font-mono font-bold text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                      />
                    </label>
                    <div className="grid grid-cols-5 gap-1">
                      {[
                        { label: isRtl ? 'بالضبط' : 'Exact', value: total },
                        { label: '10', value: 10 },
                        { label: '50', value: 50 },
                        { label: '100', value: 100 },
                        { label: '500', value: 500 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setCashTendered(preset.value.toFixed(2))}
                          className="rounded border border-slate-200 bg-white py-1.5 text-[10px] font-semibold text-slate-700 hover:border-blue-500 hover:text-blue-700"
                        >
                          {preset.label === (isRtl ? 'بالضبط' : 'Exact') ? preset.label : `${c}${preset.label}`}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                      <span className="font-medium text-slate-600">{isRtl ? 'الباقي' : 'Change Due'}</span>
                      <strong className={`font-mono ${cashTendered !== '' && tenderedNum < total ? 'text-red-600' : 'text-emerald-700'}`}>
                        {cashTendered !== '' && tenderedNum < total
                          ? `${isRtl ? 'ناقص' : 'Short'} ${c} ${(total - tenderedNum).toFixed(2)}`
                          : `${c} ${changeDue.toFixed(2)}`}
                      </strong>
                    </div>
                  </section>
                )}

                {paymentMethod === 'Split' && (
                  <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] font-semibold text-slate-700">
                        {isRtl ? 'المبلغ النقدي' : 'Cash Amount'}
                        <input
                          ref={cashTenderedInputRef}
                          type="number"
                          min={0}
                          step="0.01"
                          value={cashTendered}
                          onFocus={(event) => event.currentTarget.select()}
                          onClick={(event) => event.currentTarget.select()}
                          onChange={(event) => setCashTendered(event.target.value, true)}
                          placeholder="0.00"
                          className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-right text-sm font-mono font-bold text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-slate-700">
                        {isRtl ? 'مبلغ البطاقة' : 'Card Amount'}
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={cardTendered}
                          onFocus={(event) => event.currentTarget.select()}
                          onClick={(event) => event.currentTarget.select()}
                          onChange={(event) => setCardTendered(event.target.value)}
                          placeholder="0.00"
                          className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-right text-sm font-mono font-bold text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                        />
                      </label>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs">
                      <span className="font-medium text-slate-600">{isRtl ? 'المتبقي' : 'Remaining'}</span>
                      <strong className={`font-mono ${splitAmountsMatchTotal ? 'text-emerald-700' : 'text-red-600'}`}>
                        {splitAmountsMatchTotal
                          ? (isRtl ? 'مكتمل' : 'Balanced')
                          : `${c} ${Math.abs(total - tenderedNum).toFixed(2)}`}
                      </strong>
                    </div>
                  </section>
                )}

                <section className="space-y-1.5 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span>
                    <span className="font-mono">{c} {subtotal.toFixed(settings.decimalPoints ?? 2)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-red-700">
                      <span>{isRtl ? 'الخصم' : 'Discount'}</span>
                      <span className="font-mono">−{c} {discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>{isRtl ? `ضريبة القيمة المضافة (${settings.taxRate || 15}%)` : `VAT (${settings.taxRate || 15}%)`}</span>
                    <span className="font-mono">{c} {taxAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-blue-200 pt-2">
                    <span className="font-bold text-slate-900">{isRtl ? 'الإجمالي المستحق' : 'Amount Due'}</span>
                    <strong className="font-mono text-xl font-black text-blue-800">{c} {total.toFixed(2)}</strong>
                  </div>
                </section>
              </div>
            )}

          </div>

          {!isRpos && (
            <footer className="shrink-0 border-t border-slate-200 bg-white p-3">
              <button
                type="button"
                onClick={() => void handleCompleteSale()}
                disabled={!canCompleteSale}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <CheckCircle2 className="h-4 w-4" />
                {isSubmitting
                  ? (isRtl ? 'جارٍ إتمام البيع...' : 'Completing Sale...')
                  : activeTab.editingSaleId
                    ? (isRtl ? 'حفظ الفاتورة' : 'Save Invoice')
                    : (isRtl ? 'تسوية الدفع وإتمام البيع' : 'Settle & Complete Sale')}
              </button>
            </footer>
          )}

          {isRpos && (
            <div className="shrink-0 border-t border-slate-200 bg-white px-3 pt-1 pb-3">
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span>
                  <span className="font-mono font-semibold">{c} {subtotal.toFixed(settings.decimalPoints ?? 2)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-red-700">
                    <span>{isRtl ? 'الخصم' : 'Discount'}</span>
                    <span className="font-mono font-semibold">−{c} {discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>{isRtl ? `ضريبة القيمة المضافة (${settings.taxRate || 15}%)` : `VAT (${settings.taxRate || 15}%)`}</span>
                  <span className="font-mono font-semibold">{c} {taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                  <span className="font-bold text-slate-900">{isRtl ? 'الإجمالي' : 'Total'}</span>
                  <strong className="font-mono text-xl font-black text-red-600">{c} {total.toFixed(2)}</strong>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {!isRpos && mobileTab === 'table' && (
        <div className="shrink-0 border-t border-slate-200 bg-white p-2 min-[900px]:hidden">
          <button
            type="button"
            onClick={() => setMobileTab('checkout')}
            aria-label={isRtl ? 'فتح تسوية الدفع' : 'Open settlement'}
            className="flex w-full items-center justify-between rounded-lg bg-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800"
          >
            <span className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {isRtl ? 'تسوية الدفع' : 'Open Settlement'}
            </span>
            <span className="font-mono tabular-nums">{c} {total.toFixed(2)}</span>
          </button>
        </div>
      )}

      {zeroPriceDialogItems && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="zero-price-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) returnToZeroPriceItem();
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 bg-amber-50 px-4 py-3">
              <h2 id="zero-price-dialog-title" className="text-sm font-bold text-slate-900">
                {isRtl ? 'أصناف بسعر صفر' : 'Items with zero price'}
              </h2>
              <button
                type="button"
                onClick={returnToZeroPriceItem}
                className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-800"
                aria-label={isRtl ? 'العودة للتذكرة' : 'Go back to ticket'}
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="space-y-3 p-4">
              <p className="text-xs text-slate-600">
                {isRtl
                  ? 'حدد صنفاً ثم اضغط رجوع إلى التذكرة لإبرازه وتعديل سعره.'
                  : 'Select an item, then go back to the ticket to highlight it and edit its price.'}
              </p>
              <div className="max-h-60 space-y-1 overflow-y-auto">
                {zeroPriceDialogItems.map((item) => {
                  const lineId = getCartItemLineId(item);
                  const isSelected = selectedZeroPriceItemId === lineId;
                  return (
                    <button
                      key={lineId}
                      type="button"
                      onClick={() => setSelectedZeroPriceItemId(lineId)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 text-blue-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="min-w-0 truncate font-semibold">
                        {isRtl && item.product.nameAr ? item.product.nameAr : item.product.name}
                      </span>
                      <span className="shrink-0 font-mono font-bold text-red-600">
                        {c} {item.product.retailPrice.toFixed(2)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={returnToZeroPriceItem}
                className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-800"
              >
                {isRtl ? 'العودة إلى التذكرة' : 'Go Back to Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTicketItemId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-ticket-item-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditingTicketItemId(null);
          }}
        >
          <form
            onSubmit={saveTicketItemEdits}
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="edit-ticket-item-title" className="text-sm font-bold text-slate-900">
                {isRtl ? 'تعديل الصنف' : 'Edit ticket item'}
              </h2>
              <button
                type="button"
                onClick={() => setEditingTicketItemId(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {(editingCartItem?.product.multiUnits?.length || 0) > 0 && (
              <label className="mt-3 block text-xs font-semibold text-slate-600">
                {isRtl ? 'الوحدة' : 'Unit'}
                <select
                  value={ticketEditUnitId}
                  onChange={(event) => {
                    const nextUnitId = event.target.value;
                    setTicketEditUnitId(nextUnitId);
                    if (editingCartItem) {
                      const unit = getUnitDetails(editingCartItem.product, nextUnitId || undefined);
                      setTicketEditPrice(String(unit.unitPrice));
                      if (unit.unitId) setTicketEditQuantity('1');
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">
                    {editingCartItem?.product.unit || (isRtl ? 'الوحدة الأساسية' : 'Base unit')}
                  </option>
                  {editingCartItem?.product.multiUnits?.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.unitsPerBase})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-slate-600">
                {isRtl ? 'السعر' : 'Price'} ({c})
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  ref={ticketEditPriceInputRef}
                  required
                  value={ticketEditPrice}
                  onChange={(event) => setTicketEditPrice(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                {isRtl ? 'الكمية' : 'Quantity'}
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => adjustTicketEditQuantity(-1)}
                    disabled={Number(ticketEditQuantity) <= 1}
                    aria-label={isRtl ? 'تقليل الكمية' : 'Decrease quantity'}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step={ticketEditUnitId ? '1' : 'any'}
                    max={
                      settings.allowNegativeStock || !editingCartItem
                        ? undefined
                        : getMaxQuantityForItem(
                            editingCartItem,
                            getUnitDetails(editingCartItem.product, ticketEditUnitId || undefined).unitsPerBase
                          )
                    }
                    required
                    value={ticketEditQuantity}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    onChange={(event) => setTicketEditQuantity(event.target.value)}
                    className="min-w-0 w-full rounded-lg border border-slate-300 px-2 py-2 text-center text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() => adjustTicketEditQuantity(1)}
                    disabled={
                      !settings.allowNegativeStock &&
                      Number(ticketEditQuantity) >=
                        (editingCartItem
                          ? getMaxQuantityForItem(
                              editingCartItem,
                              getUnitDetails(editingCartItem.product, ticketEditUnitId || undefined).unitsPerBase
                            )
                          : 0)
                    }
                    aria-label={isRtl ? 'زيادة الكمية' : 'Increase quantity'}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTicketItemId(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                {isRtl ? 'حفظ' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {isTenderModalOpen && isRpos && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tender-modal-title"
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => {
              if (!(event.target instanceof Element) || !event.target.closest('[data-customer-picker]')) {
                setIsCustomerPickerOpen(false);
              }
            }}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 id="tender-modal-title" className="text-base font-bold text-slate-900">
                  {isRtl ? 'تسوية الدفع' : 'Settle Tender'}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {activeTab.label} · {cart.length} {isRtl ? 'أصناف' : 'lines'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTenderModalOpen(false)}
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                aria-label={isRtl ? 'إغلاق نافذة الدفع' : 'Close tender window'}
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              {feedback?.type === 'error' && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                  {feedback.text}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  {isRtl ? 'العميل' : 'Customer'}
                </label>
                <div className="relative" data-customer-picker>
                  <input
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isCustomerPickerOpen}
                    aria-controls="customer-options"
                    value={isCustomerPickerOpen ? customerSearch : customerName}
                    onFocus={() => {
                      setCustomerSearch('');
                      setIsCustomerPickerOpen(true);
                    }}
                    onClick={() => {
                      if (!isCustomerPickerOpen) {
                        setCustomerSearch('');
                        setIsCustomerPickerOpen(true);
                      }
                    }}
                    onChange={(event) => {
                      setCustomerSearch(event.target.value);
                      setIsCustomerPickerOpen(true);
                    }}
                    placeholder={isRtl ? 'ابحث عن عميل بالاسم أو الهاتف' : 'Click to search customers by name or phone'}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  {isCustomerPickerOpen && (
                    <div
                      id="customer-options"
                      role="listbox"
                      className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
                    >
                      {showDefaultCustomerOption && (
                        <button
                          type="button"
                          role="option"
                          aria-selected={customerName === defaultCustomerName}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setCustomerName(defaultCustomerName);
                            setCustomerSearch('');
                            setIsCustomerPickerOpen(false);
                          }}
                          className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-800 hover:bg-blue-50"
                        >
                          {defaultCustomerName}
                        </button>
                      )}
                      {matchingCustomers.map((cust) => (
                        <button
                          key={cust.id}
                          type="button"
                          role="option"
                          aria-selected={customerName === cust.name}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setCustomerName(cust.name);
                            setCustomerSearch('');
                            setIsCustomerPickerOpen(false);
                          }}
                          className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left text-sm text-slate-800 hover:bg-blue-50"
                        >
                          <span>{cust.name}</span>
                          {(cust.nameAr || cust.phone) && (
                            <span className="text-xs text-slate-500">
                              {[cust.nameAr, cust.phone].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </button>
                      ))}
                      {matchingCustomers.length === 0 && !showDefaultCustomerOption && (
                        <p className="px-3 py-2 text-sm text-slate-500">
                          {isRtl ? 'لا يوجد عملاء مطابقون' : 'No matching customers'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  {isRtl ? 'خصم الفاتورة' : 'Invoice Discount'}
                </label>
                <div className="flex">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={discountValue}
                    onFocus={(event) => event.currentTarget.select()}
                    onClick={(event) => event.currentTarget.select()}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder="0.00"
                    className={`w-full border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none ${isRtl ? 'rounded-r-lg border-l-0' : 'rounded-l-lg border-r-0'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setDiscountType((prev) => (prev === 'fixed' ? 'percent' : 'fixed'))}
                    className={`border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-mono font-bold text-slate-700 hover:bg-slate-200 ${isRtl ? 'rounded-l-lg border-r-0' : 'rounded-r-lg border-l-0'}`}
                    title="Toggle currency or percentage discount"
                  >
                    {discountType === 'fixed' ? c : '%'}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700">
                  {isRtl ? 'طريقة الدفع' : 'Payment Method'}
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {paymentMethods.map((method) => {
                    const selected = paymentMethod === method;
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => handlePaymentMethodSelection(method)}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-2 py-3 text-sm font-bold transition-colors ${
                          selected
                            ? 'border-blue-700 bg-blue-700 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {method === 'Cash' ? <Banknote className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                        {paymentMethodLabel(method)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {paymentMethod === 'Cash' && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      {isRtl ? 'المبلغ النقدي المستلم' : 'Cash Received'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={cashTendered}
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.currentTarget.select()}
                      onChange={(e) => setCashTendered(e.target.value, true)}
                      placeholder={total.toFixed(2)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-right text-base font-mono font-bold text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { label: isRtl ? 'بالضبط' : 'Exact', value: total },
                      { label: '10', value: 10 },
                      { label: '50', value: 50 },
                      { label: '100', value: 100 },
                      { label: '500', value: 500 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setCashTendered(preset.value.toFixed(2))}
                        className="rounded border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:border-blue-500 hover:text-blue-700"
                      >
                        {preset.label === (isRtl ? 'بالضبط' : 'Exact') ? preset.label : `${c}${preset.label}`}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                    <span className="font-medium text-slate-600">{isRtl ? 'الباقي' : 'Change Due'}</span>
                    <strong className={`font-mono ${cashTendered !== '' && tenderedNum < total ? 'text-red-600' : 'text-emerald-700'}`}>
                      {cashTendered !== '' && tenderedNum < total
                        ? `${isRtl ? 'ناقص' : 'Short'} ${c} ${(total - tenderedNum).toFixed(2)}`
                        : `${c} ${changeDue.toFixed(2)}`}
                    </strong>
                  </div>
                </div>
              )}

              {paymentMethod === 'Split' && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-slate-700">
                      {isRtl ? 'المبلغ النقدي' : 'Cash Amount'}
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={cashTendered}
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => event.currentTarget.select()}
                        onChange={(event) => setCashTendered(event.target.value, true)}
                        placeholder="0.00"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-right text-sm font-mono font-bold text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-700">
                      {isRtl ? 'مبلغ البطاقة' : 'Card Amount'}
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={cardTendered}
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => event.currentTarget.select()}
                        onChange={(event) => setCardTendered(event.target.value)}
                        placeholder="0.00"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-right text-sm font-mono font-bold text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                      />
                    </label>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                    <span className="font-medium text-slate-600">
                      {isRtl ? 'المتبقي' : 'Remaining'}
                    </span>
                    <strong className={`font-mono ${splitAmountsMatchTotal ? 'text-emerald-700' : 'text-red-600'}`}>
                      {splitAmountsMatchTotal
                        ? (isRtl ? 'مكتمل' : 'Balanced')
                        : `${c} ${Math.abs(total - tenderedNum).toFixed(2)} ${tenderedNum > total ? (isRtl ? 'زيادة' : 'over') : ''}`}
                    </strong>
                  </div>
                </div>
              )}

              <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex justify-between text-sm text-slate-600">
                  <span>{isRtl ? 'المجموع الفرعي' : 'Subtotal'}</span>
                  <span className="font-mono">{c} {subtotal.toFixed(settings.decimalPoints ?? 2)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-red-700">
                    <span>{isRtl ? 'الخصم' : 'Discount'}</span>
                    <span className="font-mono">−{c} {discountAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-slate-600">
                  <span>{isRtl ? `ضريبة القيمة المضافة (${settings.taxRate || 15}%)` : `VAT (${settings.taxRate || 15}%)`}</span>
                  <span className="font-mono">{c} {taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex items-baseline justify-between border-t border-blue-200 pt-2">
                  <span className="font-bold text-slate-900">{isRtl ? 'الإجمالي المستحق' : 'Amount Due'}</span>
                  <strong className="font-mono text-2xl text-blue-800">{c} {total.toFixed(2)}</strong>
                </div>
              </div>
            </div>

            <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white p-4 sm:flex-row sm:gap-3">
              <button
                type="button"
                onClick={() => setIsTenderModalOpen(false)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
              >
                {isRtl ? 'رجوع للتذكرة' : 'Back to Ticket'}
              </button>
              {settings.enableKot === true && (
                <button
                  type="button"
                  onClick={() => void handlePrintKot()}
                  disabled={cart.length === 0 || isSubmitting || isPrintingKot}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
                >
                  <Printer className="h-5 w-5" />
                  {isPrintingKot
                    ? (isRtl ? 'جارٍ طباعة KOT...' : 'Printing KOT...')
                    : (isRtl ? 'طباعة KOT' : 'KOT')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCompleteSale()}
                disabled={!canCompleteSale || isPrintingKot}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <CheckCircle2 className="h-5 w-5" />
                {isSubmitting
                  ? (isRtl ? 'جارٍ إتمام البيع...' : 'Completing Sale...')
                  : activeTab.editingSaleId
                    ? (isRtl ? 'حفظ الفاتورة' : 'Save Invoice')
                    : (isRtl ? 'تسوية الدفع وإتمام البيع' : 'Settle Tender & Complete Sale')}
              </button>
            </footer>
          </div>
        </div>
      )}

      {isPrintingKot && (
        <div className="kot-print-source">
          <section id="kot-print-area" className="kot-print-area" aria-label="Kitchen order ticket">
            <header className="border-b-2 border-black pb-3 text-center">
              <h1 className="text-xl font-extrabold">{settings.storeName}</h1>
              <p className="mt-1 text-lg font-black">KITCHEN ORDER</p>
            </header>
            <div className="space-y-1 border-b border-dashed border-black py-3 text-sm">
              <p><strong>{isRtl ? 'رقم سند المطبخ:' : 'KOT No:'}</strong> {activeTab.invoiceNumber ? getKotNumberFromInvoice(activeTab.invoiceNumber) : ''}</p>
              <p><strong>{isRtl ? 'التذكرة:' : 'Ticket:'}</strong> {activeTab.label}</p>
              <p><strong>{isRtl ? 'الوقت:' : 'Time:'}</strong> {new Date().toLocaleString()}</p>
              <p><strong>{isRtl ? 'العميل:' : 'Customer:'}</strong> {customerName || defaultCustomerName}</p>
            </div>
            <div className="divide-y divide-dashed divide-black">
              {cart.map((item) => (
                <div key={getCartItemLineId(item)} className="flex items-start gap-3 py-3 text-base">
                  <strong className="min-w-10 text-lg">×{item.quantity}</strong>
                  <span className="font-bold">
                    {isRtl && item.product.nameAr ? item.product.nameAr : item.product.name}
                    {item.unitId && item.unitName ? ` (${item.unitName})` : ''}
                  </span>
                </div>
              ))}
            </div>
            <footer className="border-t-2 border-black pt-2 text-center text-xs font-semibold">
              {isRtl ? 'عدد الأصناف' : 'Items'}: {cart.reduce((count, item) => count + item.quantity, 0)}
            </footer>
          </section>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. WRONG BARCODE DIALOG MODAL (LOCKS SCANNER UNTIL DISMISSED) */}
      {/* ======================================================== */}
      {wrongBarcodeModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wrong-barcode-title"
        >
          <div className="bg-white border-2 border-red-500 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Header Alert Banner with Close Icon */}
            <div className="bg-red-600 text-white px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 id="wrong-barcode-title" className="text-base font-bold">
                    {isRtl ? 'الصنف غير متوفر' : 'Product Not Available'}
                  </h3>
                  <p className="text-xs text-red-100 mt-0.5">
                    {isRtl ? 'رمز الباركود غير مسجل في المخزون' : 'Barcode Not Found in System Inventory'}
                  </p>
                </div>
              </div>

              {/* Close Icon Button */}
              <button
                type="button"
                onClick={dismissWrongBarcode}
                className="p-1.5 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors cursor-pointer"
                title="Close dialogue"
                aria-label="Close dialogue"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-center space-y-1">
                <div className="text-xs font-semibold text-red-700 uppercase tracking-wider">
                  {isRtl ? 'الرمز الممسوح' : 'Scanned Barcode'}
                </div>
                <div className="font-mono text-lg font-bold text-red-950 tracking-wider">
                  {wrongBarcodeModal.barcode}
                </div>
              </div>

              <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
                {isRtl ? (
                  <p className="font-medium text-slate-800" dir="rtl">
                    رمز الباركود المدخل غير مسجل في المخزون أو غير متوفر حالياً. يرجى التحقق من صحة الرقم أو إضافة الصنف إلى قاعدة البيانات أولاً.
                  </p>
                ) : (
                  <p className="font-medium">
                    The scanned product code is not registered in the system inventory. Please check the barcode or register it in Inventory first.
                  </p>
                )}
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping shrink-0" />
                  <span>
                    {isRtl ? 'الماسح معلق مؤقتاً. اضغط زر الإغلاق أو مفتاح الهروب (Esc) للمتابعة.' : 'Scanner is locked. Click close or press Escape (Esc) to resume.'}
                  </span>
                </div>
              </div>

              {/* Action Close Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={dismissWrongBarcode}
                  className="w-full py-3 px-4 rounded-xl font-bold text-sm text-white bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                  <span>{isRtl ? 'إغلاق النافذة (Esc)' : 'Close Dialog (Esc)'}</span>
                </button>
                <p className="text-[11px] text-center text-slate-400 mt-2 font-medium">
                  {isRtl ? 'ملاحظة: يمكنك الضغط على مفتاح الهروب (Esc) في لوحة المفاتيح لإغلاق التنبيه مباشرة.' : 'Note: Press Escape (Esc) on your keyboard anytime to close this alert.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. PRODUCT CATALOG MODAL (USED IN STANDARD POS MODE)   */}
      {/* ======================================================== */}
      {!isRpos && isCatalogOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="catalog-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Catalog Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                  <LayoutGrid className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="catalog-modal-title" className="text-base font-bold text-slate-900">
                    {isRtl ? 'كتالوج المنتجات' : 'Product Catalogue'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isRtl ? 'انقر على أي منتج لإضافته إلى الفاتورة النشطة. اضغط Esc للإغلاق.' : 'Click any item to add it to the active invoice ticket. Press Esc to close.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsCatalogOpen(false);
                  focusBarcodeInput();
                }}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
                aria-label="Close catalog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search & Category Filter */}
            <div className="p-4 border-b border-slate-200 bg-white space-y-3 shrink-0">
              <div className="relative">
                <Search className={`w-4 h-4 text-slate-400 absolute ${isRtl ? 'right-3.5' : 'left-3.5'} top-1/2 -translate-y-1/2`} />
                <input
                  type="text"
                  autoFocus
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder={isRtl ? 'البحث بالاسم العربي أو الإنجليزي، الرمز أو الباركود...' : 'Search products by English or Arabic name, SKU, or Barcode...'}
                  className={`w-full ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-blue-700`}
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {catalogCategoryFilters.map((cat) => {
                  const active = catalogCategory === cat;
                  const catLabel =
                    cat === 'All'
                      ? (isRtl ? 'الكل' : 'All Items')
                      : cat === 'Beverages'
                      ? (isRtl ? 'مشروبات' : cat)
                      : cat === 'Bakery & Pantry'
                      ? (isRtl ? 'مخبوزات وتموين' : cat)
                      : cat === 'Snacks'
                      ? (isRtl ? 'وجبات خفيفة' : cat)
                      : cat === 'Household'
                      ? (isRtl ? 'منزليات' : cat)
                      : cat === 'Stationery'
                      ? (isRtl ? 'قرطاسية' : cat)
                      : cat;

                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCatalogCategory(cat)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-blue-700 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                      }`}
                    >
                      {catLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Product Cards Grid */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-50">
              {paginatedCatalogProducts.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center text-slate-500">
                  <p className="text-sm font-semibold">{isRtl ? 'لا توجد منتجات مطابقة' : 'No matching products found'}</p>
                  <p className="text-xs mt-1">{isRtl ? 'حاول تعديل مصطلح البحث أو اختيار تصنيف آخر.' : 'Try adjusting your search query or category filter.'}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {paginatedCatalogProducts.map((prod) => {
                    const isOut = !settings.allowNegativeStock && prod.stock <= 0;
                    const inCartCount =
                      cart.find((ci) => ci.product.id === prod.id)?.quantity || 0;

                    return (
                      <button
                        key={prod.id}
                        type="button"
                        disabled={isOut}
                        onClick={() => addToCart(prod)}
                        className={`text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                          isOut
                            ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                            : 'bg-white border-slate-200 hover:border-blue-600 hover:shadow-sm active:scale-[0.98]'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-1.5">
                            <h4 className="text-xs font-bold text-slate-900 leading-snug line-clamp-2">
                              {isRtl && prod.nameAr ? prod.nameAr : prod.name}
                            </h4>
                            {inCartCount > 0 && (
                              <span className="font-mono text-xs font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded shrink-0">
                                ×{inCartCount}
                              </span>
                            )}
                          </div>
                          {isRtl && prod.name && (
                            <div className="text-[11px] text-slate-500 font-normal mt-0.5 truncate">
                              {prod.name}
                            </div>
                          )}
                          {!isRtl && prod.nameAr && (
                            <div
                              className="text-[11px] text-blue-800 font-semibold mt-1 truncate"
                              dir="rtl"
                            >
                              {prod.nameAr}
                            </div>
                          )}
                          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                            <span>{prod.sku}</span>
                            <span>·</span>
                            <span>{isRtl ? `المخزون: ${prod.stock} ${prod.unit}` : `Stock: ${prod.stock} ${prod.unit}`}</span>
                          </div>
                        </div>

                        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-[10px] text-slate-400 truncate max-w-[80px]">
                            {prod.category}
                          </span>
                          <span className="font-mono text-xs font-black text-slate-900 tabular-nums">
                            {c} {prod.retailPrice.toFixed(2)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer with Catalog Pagination & Close Button */}
            <div className="px-5 py-3 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>
                  {isRtl ? (
                    <>
                      عرض <strong className="text-slate-900">
                        {Math.min((catalogPage - 1) * CATALOG_PAGE_SIZE + 1, catalogFilteredProducts.length)}
                      </strong> إلى <strong className="text-slate-900">
                        {Math.min(catalogPage * CATALOG_PAGE_SIZE, catalogFilteredProducts.length)}
                      </strong> من أصل <strong className="text-slate-900">{catalogFilteredProducts.length}</strong> صنف
                    </>
                  ) : (
                    <>
                      Showing <strong className="text-slate-900">
                        {Math.min((catalogPage - 1) * CATALOG_PAGE_SIZE + 1, catalogFilteredProducts.length)}
                      </strong> to <strong className="text-slate-900">
                        {Math.min(catalogPage * CATALOG_PAGE_SIZE, catalogFilteredProducts.length)}
                      </strong> of <strong className="text-slate-900">{catalogFilteredProducts.length}</strong> items
                    </>
                  )}
                </span>

                {totalCatalogPages > 1 && (
                  <div className="flex items-center gap-1 mx-2">
                    <button
                      type="button"
                      disabled={catalogPage <= 1}
                      onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 bg-slate-100 border border-slate-200 hover:bg-slate-200 disabled:opacity-40 rounded text-slate-700 text-xs font-semibold"
                    >
                      {isRtl ? 'السابق' : 'Prev'}
                    </button>
                    <span className="px-2 py-0.5 bg-slate-50 font-mono text-xs font-bold text-slate-800">
                      {catalogPage} / {totalCatalogPages}
                    </span>
                    <button
                      type="button"
                      disabled={catalogPage >= totalCatalogPages}
                      onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                      className="px-2.5 py-1 bg-slate-100 border border-slate-200 hover:bg-slate-200 disabled:opacity-40 rounded text-slate-700 text-xs font-semibold"
                    >
                      {isRtl ? 'التالي' : 'Next'}
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsCatalogOpen(false);
                  focusBarcodeInput();
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                {isRtl ? 'إغلاق الكتالوج (Esc)' : 'Close Catalog (Esc)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isSaleConfirmationOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sale-confirmation-title"
          aria-describedby="sale-confirmation-description"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-200 bg-amber-50 px-5 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <h2 id="sale-confirmation-title" className="text-sm font-bold text-slate-900">
                  {isRtl ? 'تأكيد إتمام البيع' : 'Confirm sale completion'}
                </h2>
                <p id="sale-confirmation-description" className="mt-1 text-xs leading-relaxed text-slate-600">
                  {isRtl ? 'هل تريد بالتأكيد إتمام هذه الفاتورة؟' : 'Are you sure you want to complete this sale?'}
                </p>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className="font-medium text-slate-600">{isRtl ? 'الإجمالي' : 'Total'}</span>
                <strong className="font-mono text-sm text-slate-900">{c} {total.toFixed(2)}</strong>
              </div>
              <p className="mt-3 text-center text-[11px] text-slate-500">
                {isRtl ? 'اضغط Enter للتأكيد أو Esc للإلغاء.' : 'Press Enter to confirm or Esc to cancel.'}
              </p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
              <button
                type="button"
                onClick={() => setIsSaleConfirmationOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {isRtl ? 'لا، رجوع' : 'No, go back'}
              </button>
              <button
                type="button"
                autoFocus
                disabled={isSubmitting}
                onClick={() => void handleCompleteSale(true)}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {isRtl ? 'نعم، إتمام البيع' : 'Yes, complete sale'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
