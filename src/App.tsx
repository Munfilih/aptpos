import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { TopBar, type NavTab } from './components/TopBar';
import { RegisterView } from './components/RegisterView';
import { InventoryView } from './components/InventoryView';
import { PurchasesView } from './components/PurchasesView';
import {
  PurchaseReturnHistoryView,
} from './components/PurchaseReturnsView';
import { CustomersView } from './components/CustomersView';
import { VendorsView } from './components/VendorsView';
import { SalesHistoryView } from './components/SalesHistoryView';
import { SalesReturnRegisterView } from './components/SalesReturnRegisterView';
import { SalesReturnHistoryView } from './components/SalesReturnHistoryView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { FilesView } from './components/FilesView';
import { LedgerView } from './components/LedgerView';
import { ShiftView } from './components/ShiftView';
import { ThermalReceiptModal } from './components/ThermalReceiptModal';
import { LoginForm } from './components/LoginForm';
import { DemoRegistrationWindow } from './components/DemoRegistrationWindow';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import type {
  AppComponentId,
  AppVersion,
  CashbookEntry,
  CashbookOpeningBalance,
  Customer,
  DemoAccessStatus,
  CreateCashbookEntryInput,
  CreatePurchaseReturnInput,
  CreateSalesReturnVoucherInput,
  PrintJob,
  Product,
  PurchaseEntry,
  PurchaseReturnVoucher,
  Sale,
  SalesReturnVoucher,
  StoreSettings,
  SettingsSectionId,
  ThemeMode,
  UserSession,
  Vendor,
  VersionComponentPolicies,
} from './types/pos';
import { APP_COMPONENTS, APP_VERSIONS } from './types/pos';
import { parseVersionComponentPolicies } from './utils/versionComponentPolicies';

const RPOS_TICKET_WIDTH_KEY = 'counterline_rpos_ticket_width';
const DEFAULT_RPOS_TICKET_WIDTH = 320;

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

const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'aptPOS Retail',
  storeNameAr: 'ابت بوس للتجزئة',
  crNumber: '1010123456',
  address: 'King Fahd Road, Al Olaya, Riyadh, Saudi Arabia',
  phone: '+966 11 234 5678',
  taxId: '310123456700003',
  taxRate: 15.0,
  currencySymbol: 'SAR',
  receiptFooter: 'Thank you for your business!',
  receiptFooterAr: 'شكراً لتسوقكم معنا!',
  paperWidth: '80mm',
  printerOnline: true,
  cashierName: 'Cashier / الكاشير',
  taxType: 'inclusive',
  posScreenLayout: 'pos',
  barcodeScanBeep: true,
  allowNegativeStock: false,
  roundTotalToFiveCents: false,
  autoPrintReceiptOnSale: true,
  defaultReceiptAction: 'print',
  decimalPoints: 2,
  receiptBarcodeEnabled: true,
  enableStockAlertsOnCheckout: true,
  defaultCustomer: 'Walk-in Customer / عميل نقدي',
  paymentMethods: ['Cash', 'Card', 'Split'],
  kotPrinter: '',
  enableKot: false,
  appLanguage: 'en',
  defaultPrinter: 'System Default / افتراضي النظام',
  invoiceShowProductName: true,
  invoiceShowProductNameAr: true,
  invoiceShowBarcode: false,
  invoiceShowCustomerInfo: true,
  invoiceShowCashierName: true,
  invoiceShowTaxDetails: true,
  invoiceShowStoreAddress: true,
  invoiceShowReceiptBarcode: true,
  invoiceShowFooter: true,
  invoiceShowQrCode: true,
  appVersion: 'Standard',
  disabledAppComponents: [],
};

async function readCashbookResponse(response: Response, operation: string): Promise<unknown> {
  const body = await response.text();
  let payload: unknown;
  try {
    payload = body ? JSON.parse(body) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const apiError =
      typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : null;
    const restartHint = response.headers.get('content-type')?.includes('application/json')
      ? ''
      : ' Restart the local POS server to load the latest API routes.';
    throw new Error(apiError || `${operation} failed (HTTP ${response.status}).${restartHint}`);
  }

  if (payload === undefined) {
    throw new Error(
      `${operation} received an empty or invalid response. Restart the local POS server to load the latest API routes.`
    );
  }
  return payload;
}

function isCashbookEntry(value: unknown): value is CashbookEntry {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value && typeof value.id === 'number' &&
    'entryDate' in value && typeof value.entryDate === 'string' &&
    'direction' in value && (value.direction === 'IN' || value.direction === 'OUT') &&
    'category' in value && typeof value.category === 'string' &&
    'description' in value && typeof value.description === 'string' &&
    'amount' in value && typeof value.amount === 'number' &&
    'reference' in value && typeof value.reference === 'string' &&
    'createdBy' in value && typeof value.createdBy === 'string' &&
    'createdAt' in value && typeof value.createdAt === 'string'
  );
}

function isCashbookOpeningBalance(value: unknown): value is CashbookOpeningBalance {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'entryDate' in value && typeof value.entryDate === 'string' &&
    'amount' in value && typeof value.amount === 'number'
  );
}

interface AppCloseDialogProps {
  busy: boolean;
  error: string | null;
  onBackupAndClose: () => void;
  onCloseWithoutBackup: () => void;
  onCancel: () => void;
}

const AppCloseDialog: React.FC<AppCloseDialogProps> = ({
  busy,
  error,
  onBackupAndClose,
  onCloseWithoutBackup,
  onCancel,
}) => {
  const { isRtl } = useLanguage();

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-backup-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <h2 id="close-backup-title" className="text-lg font-semibold text-slate-900">
          {isRtl ? 'إنشاء نسخة احتياطية قبل الإغلاق؟' : 'Back up before closing?'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {isRtl
            ? 'يمكنك حفظ نسخة محلية ورفع نسخة إلى Google Drive إذا كان متصلاً قبل إغلاق aptPOS.'
            : 'Create a local backup and upload a copy to Google Drive if connected before closing aptPOS.'}
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isRtl ? 'العودة إلى التطبيق' : 'Return to app'}
          </button>
          <button
            type="button"
            onClick={onCloseWithoutBackup}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isRtl ? 'إغلاق دون نسخة' : 'Close without backup'}
          </button>
          <button
            type="button"
            onClick={onBackupAndClose}
            disabled={busy}
            className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          >
            {busy
              ? (isRtl ? 'جارٍ إنشاء النسخة...' : 'Creating backup...')
              : (isRtl ? 'نسخ احتياطي وإغلاق' : 'Back up & close')}
          </button>
        </div>
      </section>
    </div>
  );
};

export function App() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(() => {
    try {
      const stored = sessionStorage.getItem('counterline_user');
      const user = stored ? JSON.parse(stored) : null;
      return user?.username?.toLowerCase() === 'demo' ? null : user;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState<NavTab>('register');
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('sales');
  const [showSettingsWorkspace, setShowSettingsWorkspace] = useState(false);
  const [showSettingsComponent, setShowSettingsComponent] = useState(false);
  const [accountsSubtab, setAccountsSubtab] = useState<'ledger' | 'customers' | 'vendors' | 'payments'>('ledger');
  const [openLauncherAfterLogin, setOpenLauncherAfterLogin] = useState(false);
  const [loginDemoRegistration, setLoginDemoRegistration] = useState<{
    user: UserSession;
    status: DemoAccessStatus;
  } | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  useLayoutEffect(() => {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      activeElement instanceof HTMLSelectElement
    ) {
      activeElement.blur();
    }
  }, [activeTab, settingsSection, showSettingsWorkspace, showSettingsComponent]);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const savedTheme = localStorage.getItem('aptpos_theme');
    return savedTheme === 'dark' || savedTheme === 'medium' ? savedTheme : 'light';
  });
  const [iconOnlyLauncher, setIconOnlyLauncher] = useState(
    () => localStorage.getItem('aptpos_icon_only_launcher_v2') === 'true'
  );
  const [rposTicketWidth, setRposTicketWidth] = useState(loadRposTicketWidth);
  const handleLauncherOpened = useCallback(() => setOpenLauncherAfterLogin(false), []);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesReturnVouchers, setSalesReturnVouchers] = useState<SalesReturnVoucher[]>([]);
  const [cashbookEntries, setCashbookEntries] = useState<CashbookEntry[]>([]);
  const [cashbookOpeningBalance, setCashbookOpeningBalance] =
    useState<CashbookOpeningBalance | null>(null);
  const [cashbookModalOpen, setCashbookModalOpen] = useState(false);
  const [initialReturnSales, setInitialReturnSales] = useState<Sale[]>([]);
  const [editingReturnVoucher, setEditingReturnVoucher] = useState<SalesReturnVoucher | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [purchases, setPurchases] = useState<PurchaseEntry[]>([]);
  const [purchaseReturnVouchers, setPurchaseReturnVouchers] = useState<PurchaseReturnVoucher[]>([]);
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [purchaseVendor, setPurchaseVendor] = useState<{
    name: string;
    taxNumber: string;
    pendingBalance: number;
    currencySymbol: string;
    partialCount: number;
  } | null>(null);
  const [printQueue, setPrintQueue] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [productCreateRequest, setProductCreateRequest] = useState(0);
  const [productCreateBarcode, setProductCreateBarcode] = useState('');
  const [productCreateReturnTab, setProductCreateReturnTab] = useState<'register' | 'purchases' | null>(null);
  const [purchaseBarcodeFocusRequest, setPurchaseBarcodeFocusRequest] = useState(0);
  const handleProductCreateRequestHandled = useCallback(() => {
    setProductCreateRequest(0);
    setProductCreateBarcode('');
  }, []);
  const handleProductCreatedFromRegister = useCallback(() => {
    const returnTab = productCreateReturnTab || 'register';
    if (returnTab === 'purchases') {
      setPurchaseBarcodeFocusRequest((request) => request + 1);
    }
    setProductCreateReturnTab(null);
    setActiveTab(returnTab);
  }, [productCreateReturnTab]);
  const handleProductCreateCancelled = useCallback(() => {
    if (productCreateReturnTab === 'purchases') {
      setPurchaseBarcodeFocusRequest((request) => request + 1);
    }
    setProductCreateReturnTab(null);
  }, [productCreateReturnTab]);
  const [productEditRequest, setProductEditRequest] = useState<{
    product: Product;
    requestId: number;
  } | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<{
    sale: Sale;
    queuedOffline?: boolean;
  } | null>(null);
  const [restoredSale, setRestoredSale] = useState<Sale | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeBackupBusy, setCloseBackupBusy] = useState(false);
  const [closeBackupError, setCloseBackupError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('aptpos_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('aptpos_icon_only_launcher_v2', String(iconOnlyLauncher));
  }, [iconOnlyLauncher]);

  useEffect(() => {
    try {
      localStorage.setItem(RPOS_TICKET_WIDTH_KEY, String(rposTicketWidth));
    } catch (error) {
      console.error('Failed to save RPOS ticket width:', error);
    }
  }, [rposTicketWidth]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCloseRequested) return;
    return api.onCloseRequested(() => {
      setCloseBackupError(null);
      setCloseDialogOpen(true);
    });
  }, []);

  const handleCloseWithoutBackup = async () => {
    const api = window.electronAPI;
    if (!api?.resolveCloseRequest) return;
    try {
      await api.resolveCloseRequest(true);
      setCloseDialogOpen(false);
    } catch (error) {
      setCloseBackupError(error instanceof Error ? error.message : 'Could not close the app.');
    }
  };

  const handleCancelClose = async () => {
    const api = window.electronAPI;
    if (!api?.resolveCloseRequest) return;
    try {
      await api.resolveCloseRequest(false);
      setCloseDialogOpen(false);
    } catch (error) {
      setCloseBackupError(error instanceof Error ? error.message : 'Could not cancel closing the app.');
    }
  };

  const handleBackupAndClose = async () => {
    const api = window.electronAPI;
    if (!api?.createDatabaseBackup || !api.resolveCloseRequest) {
      setCloseBackupError('Backup is only available in the installed desktop app.');
      return;
    }
    setCloseBackupBusy(true);
    setCloseBackupError(null);
    try {
      await api.createDatabaseBackup();
      await api.resolveCloseRequest(true);
      setCloseDialogOpen(false);
    } catch (error) {
      setCloseBackupError(error instanceof Error ? error.message : 'Could not create the backup.');
    } finally {
      setCloseBackupBusy(false);
    }
  };

  useEffect(() => {
    const handleProductShortcut = (event: KeyboardEvent) => {
      if (
        event.key !== 'F8' ||
        currentUser?.role !== 'admin' ||
        document.querySelector('[role="dialog"]')
      ) {
        return;
      }

      event.preventDefault();
      setProductCreateBarcode('');
      setProductCreateReturnTab(null);
      setActiveTab('inventory');
      setProductCreateRequest((request) => request + 1);
    };

    window.addEventListener('keydown', handleProductShortcut);
    return () => window.removeEventListener('keydown', handleProductShortcut);
  }, [currentUser]);

  const fetchAll = useCallback(async () => {
    try {
      const [
        prodRes,
        salesRes,
        setRes,
        queueRes,
        custRes,
        vendRes,
        purchRes,
        purchaseReturnsRes,
        returnsRes,
        cashbookRes,
      ] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/sales'),
        fetch('/api/settings'),
        fetch('/api/print-queue'),
        fetch('/api/customers'),
        fetch('/api/vendors'),
        fetch('/api/purchases'),
        fetch('/api/purchase-returns'),
        fetch('/api/sales-returns'),
        fetch('/api/cashbook'),
      ]);

      if (prodRes.ok) setProducts(await prodRes.json());
      if (salesRes.ok) setSales(await salesRes.json());
      if (setRes.ok) setSettings(await setRes.json());
      if (queueRes.ok) setPrintQueue(await queueRes.json());
      if (custRes.ok) setCustomers(await custRes.json());
      if (vendRes.ok) setVendors(await vendRes.json());
      if (purchRes.ok) setPurchases(await purchRes.json());
      if (purchaseReturnsRes.ok) setPurchaseReturnVouchers(await purchaseReturnsRes.json());
      if (returnsRes.ok) setSalesReturnVouchers(await returnsRes.json());
      if (cashbookRes.ok) {
        const cashbookData = await readCashbookResponse(cashbookRes, 'Loading cashbook');
        if (
          typeof cashbookData !== 'object' ||
          cashbookData === null ||
          !('entries' in cashbookData) ||
          !Array.isArray(cashbookData.entries) ||
          !cashbookData.entries.every(isCashbookEntry) ||
          !('openingBalance' in cashbookData) ||
          (cashbookData.openingBalance !== null &&
            !isCashbookOpeningBalance(cashbookData.openingBalance))
        ) {
          throw new Error('Cashbook API returned an invalid data format.');
        }
        setCashbookEntries(cashbookData.entries);
        setCashbookOpeningBalance(cashbookData.openingBalance);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchAll();
    } else {
      setLoading(false);
    }
  }, [currentUser, fetchAll]);

  const handleLoginSuccess = (user: UserSession) => {
    setCurrentUser(user);
    setLoginDemoRegistration(null);
    setLoginError(null);
    try {
      sessionStorage.setItem('counterline_user', JSON.stringify(user));
    } catch {
      // storage disabled
    }
    setActiveTab('register');
    if (user.demoMode) {
      setSettingsSection('screen');
      setShowSettingsWorkspace(false);
      setShowSettingsComponent(false);
      setAccountsSubtab('ledger');
    }
    setOpenLauncherAfterLogin(true);
    setLoading(true);
    fetchAll();
  };

  const handleDemoRegistrationRequested = (user: UserSession, status: DemoAccessStatus) => {
    setLoginDemoRegistration({ user, status });
  };

  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    setCashbookModalOpen(false);
    setOpenLauncherAfterLogin(false);
    setLoginDemoRegistration(null);
    try {
      sessionStorage.removeItem('counterline_user');
    } catch {
      // ignore
    }
  }, []);

  const handleDemoActivated = (expiresAt: string) => {
    if (!loginDemoRegistration) return;
    handleLoginSuccess({
      ...loginDemoRegistration.user,
      role: 'admin',
      permissions: ['register', 'inventory', 'purchases', 'customers', 'vendors', 'accounts', 'reports', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'settings'],
      demoMode: true,
      demoExpiresAt: expiresAt,
    });
  };

  useEffect(() => {
    if (!currentUser?.demoMode || !currentUser.demoExpiresAt) return;
    const expiresAt = Date.parse(currentUser.demoExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      handleLogout();
      setLoginDemoRegistration({ user: currentUser, status: 'expired' });
      return;
    }

    const timeout = window.setTimeout(() => {
      handleLogout();
      setLoginDemoRegistration({ user: currentUser, status: 'expired' });
    }, expiresAt - Date.now());
    return () => window.clearTimeout(timeout);
  }, [currentUser, handleLogout]);

  useEffect(() => {
    if (!currentUser?.demoMode && !currentUser?.registeredSystem) return;

    let active = true;
    let checking = false;
    const checkDemoAccess = async () => {
      if (!active || checking) return;
      checking = true;
      try {
        const response = await fetch('/api/registration/demo-access', {
          cache: 'no-store',
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!active) return;

        if (!response.ok) {
          const message =
            typeof payload === 'object' &&
            payload !== null &&
            'error' in payload &&
            typeof payload.error === 'string'
              ? payload.error
              : 'Could not verify the demo license. Please sign in again.';
          handleLogout();
          setLoginError(message);
          return;
        }

        if (
          typeof payload !== 'object' ||
          payload === null ||
          !('status' in payload) ||
          !('expiresAt' in payload)
        ) {
          handleLogout();
          setLoginError('The demo status service returned an invalid response.');
          return;
        }

        const expiresAt = payload.expiresAt;
        if (payload.status === 'registered') {
          const appVersionValue = 'appVersion' in payload ? payload.appVersion : undefined;
          const appVersion = APP_VERSIONS.find((version) => version === appVersionValue);
          if (!appVersion) {
            handleLogout();
            setLoginError('The registered-system status returned an invalid app version.');
            return;
          }
          const settingsResponse = await fetch('/api/settings', { cache: 'no-store' });
          if (!settingsResponse.ok) {
            throw new Error('Could not refresh the registered system permissions.');
          }
          const updatedSettings: StoreSettings = await settingsResponse.json();
          if (!updatedSettings.registeredSystem || updatedSettings.appVersion !== appVersion) {
            throw new Error('The registered system permissions could not be synchronized.');
          }
          setSettings(updatedSettings);
          const updatedUser = {
            ...currentUser,
            demoMode: false,
            demoExpiresAt: undefined,
            registeredSystem: true,
            appVersion,
          };
          if (
            currentUser.registeredSystem !== true ||
            currentUser.appVersion !== appVersion ||
            currentUser.demoMode
          ) {
            setCurrentUser(updatedUser);
            try {
              sessionStorage.setItem('counterline_user', JSON.stringify(updatedUser));
            } catch {
              // storage disabled
            }
          }
          return;
        }
        if (
          payload.status === 'active' &&
          typeof expiresAt === 'string' &&
          Date.parse(expiresAt) > Date.now()
        ) {
          if (currentUser.demoExpiresAt !== expiresAt) {
            const updatedUser = { ...currentUser, demoExpiresAt: expiresAt };
            setCurrentUser(updatedUser);
            try {
              sessionStorage.setItem('counterline_user', JSON.stringify(updatedUser));
            } catch {
              // storage disabled
            }
          }
          return;
        }
        if (payload.status !== 'never' && payload.status !== 'expired') {
          handleLogout();
          setLoginError('The demo status service returned an invalid response.');
          return;
        }

        handleLogout();
        setLoginError(null);
        setLoginDemoRegistration({
          user: currentUser,
          status: payload.status,
        });
      } catch (error) {
        if (!active) return;
        handleLogout();
        setLoginError(
          error instanceof Error
            ? error.message
            : 'Could not verify the demo license. Please sign in again.'
        );
      } finally {
        checking = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkDemoAccess();
    };
    const interval = window.setInterval(() => void checkDemoAccess(), 60_000);
    window.addEventListener('focus', checkDemoAccess);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', checkDemoAccess);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser, handleLogout]);

  const refreshProducts = async () => {
    const res = await fetch('/api/products');
    if (!res.ok) {
      throw new Error(`Failed to refresh products (HTTP ${res.status}).`);
    }
    setProducts(await res.json());
  };

  const refreshCustomers = async () => {
    const res = await fetch('/api/customers');
    if (res.ok) setCustomers(await res.json());
  };

  const refreshVendors = async () => {
    const res = await fetch('/api/vendors');
    if (res.ok) setVendors(await res.json());
  };

  const refreshPurchases = async () => {
    const res = await fetch('/api/purchases');
    if (res.ok) setPurchases(await res.json());
  };

  const handleSaleCompleted = async (sale: Sale, queuedOffline: boolean) => {
    setActiveReceipt({ sale, queuedOffline });
    await fetchAll();
  };

  const handleDeleteSale = async (saleId: number) => {
    const res = await fetch(`/api/sales/${saleId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete sale.');
    }
    await fetchAll();
  };

  const handleCreateReturnVoucher = async (
    input: Omit<CreateSalesReturnVoucherInput, 'cashierName'>
  ) => {
    const res = await fetch('/api/sales-returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        cashierName: currentUser?.displayName || '',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to process return voucher.');
    }
    if (!data.voucher || !Array.isArray(data.sales)) {
      throw new Error('The server returned an invalid return voucher response.');
    }
    await fetchAll();
    setEditingReturnVoucher(null);
    setInitialReturnSales([]);
    setActiveTab('return-register');
    return data.voucher as SalesReturnVoucher;
  };

  const handleUpdateReturnVoucher = async (
    voucherId: number,
    input: Omit<CreateSalesReturnVoucherInput, 'cashierName'>
  ) => {
    const res = await fetch(`/api/sales-returns/${voucherId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update return voucher.');
    }
    if (!data.voucher || !Array.isArray(data.sales)) {
      throw new Error('The server returned an invalid updated return voucher response.');
    }
    await fetchAll();
    setEditingReturnVoucher(null);
    setInitialReturnSales([]);
    setActiveTab('return-history');
    return data.voucher as SalesReturnVoucher;
  };

  const handleDeleteReturnVoucher = async (voucherId: number) => {
    const res = await fetch(`/api/sales-returns/${voucherId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete return voucher.');
    }
    await fetchAll();
  };

  const handleCreateCashbookEntry = async (input: Omit<CreateCashbookEntryInput, 'createdBy'>) => {
    const res = await fetch('/api/cashbook/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, createdBy: currentUser?.displayName || '' }),
    });
    await readCashbookResponse(res, 'Saving cashbook entry');
    await fetchAll();
  };

  const handleEditReturnVoucher = (voucher: SalesReturnVoucher) => {
    setEditingReturnVoucher(voucher);
    setInitialReturnSales(
      sales.filter((sale) => voucher.items.some((item) => item.saleId === sale.id))
    );
    setActiveTab('return-register');
  };

  const handleEditInvoice = (sale: Sale) => {
    if (sale.returnStatus) return;
    if (
      currentUser?.role !== 'admin' &&
      !currentUser?.permissions?.includes('edit-sales')
    ) {
      return;
    }
    setRestoredSale(sale);
    setActiveTab('register');
  };

  const handleDeletePurchase = async (purchaseId: number) => {
    const res = await fetch(`/api/purchases/${purchaseId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete purchase.');
    }
    await fetchAll();
  };

  const handleCreatePurchaseReturn = async (input: CreatePurchaseReturnInput) => {
    const res = await fetch('/api/purchase-returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to process purchase return.');
    }
    if (!data || typeof data.id !== 'number' || !Array.isArray(data.items)) {
      throw new Error('The server returned an invalid purchase return response.');
    }
    await fetchAll();
    setActiveTab('purchase-return-register');
    return data as PurchaseReturnVoucher;
  };

  const handleDeletePurchaseReturn = async (voucherId: number) => {
    const res = await fetch(`/api/purchase-returns/${voucherId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete purchase return.');
    }
    await fetchAll();
  };

  const handleEditPurchase = async (purchaseId: number, data: any) => {
    const res = await fetch(`/api/purchases/${purchaseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const response = await res.json();
      throw new Error(response.error || 'Failed to update purchase.');
    }
    await fetchAll();
  };

  const handleResetDatabase = async () => {
    const res = await fetch('/api/database/reset', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Database reset failed (HTTP ${res.status}).`);
    }
    try {
      sessionStorage.removeItem('counterline_register_state');
      localStorage.removeItem('counterline_rpos_ticket_width');
      localStorage.removeItem('aptpos_lang');
    } catch (error) {
      console.error('Failed to clear local POS state after database reset:', error);
    }
    handleLogout();
    window.location.reload();
  };

  const handleRestoreDatabase = async (fileBuffer: ArrayBuffer) => {
    const bytes = new Uint8Array(fileBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const res = await fetch('/api/database/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64 }),
    });
    if (res.ok) {
      await fetchAll();
    } else {
      const data = await res.json();
      throw new Error(data.error || 'Restore failed');
    }
  };

  const handleSaveSettings = async (updated: StoreSettings) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof data.error === 'string'
          ? data.error
          : 'Could not save settings.'
      );
    }
    if (typeof data !== 'object' || data === null) {
      throw new Error('The settings service returned an invalid response.');
    }
    if (updated.versionComponentPolicies !== undefined) {
      const savedPolicies =
        'versionComponentPolicies' in data
          ? parseVersionComponentPolicies(data.versionComponentPolicies)
          : null;
      if (
        !savedPolicies ||
        JSON.stringify(savedPolicies) !== JSON.stringify(updated.versionComponentPolicies)
      ) {
        throw new Error('Version component policies were not saved correctly. Please retry.');
      }
    }
    setSettings(data as StoreSettings);
  };

  const loadVersionComponentPolicies = useCallback(async () => {
    const response = await fetch('/api/version-control', { cache: 'no-store' });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'string'
          ? payload.error
          : 'Could not load Firebase version policies.'
      );
    }
    if (typeof payload !== 'object' || payload === null || !('versionComponentPolicies' in payload)) {
      const contentType = response.headers.get('content-type') || 'an unknown content type';
      throw new Error(
        `The POS server returned ${contentType} instead of version policy data. Restart the POS app/server to load the updated API, then reopen Version settings.`
      );
    }
    const policies = parseVersionComponentPolicies(payload.versionComponentPolicies);
    if (!policies || APP_VERSIONS.some((version) => !Array.isArray(policies[version]))) {
      throw new Error('The version policy service returned an incomplete policy.');
    }
    return policies;
  }, []);

  const saveVersionComponentPolicies = useCallback(async (
    policies: VersionComponentPolicies,
    password: string
  ) => {
    const response = await fetch('/api/version-control', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionComponentPolicies: policies, password }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'string'
          ? payload.error
          : 'Could not save Firebase version policies.'
      );
    }
    if (typeof payload !== 'object' || payload === null || !('versionComponentPolicies' in payload)) {
      const contentType = response.headers.get('content-type') || 'an unknown content type';
      throw new Error(
        `The POS server returned ${contentType} instead of a version policy save response. Restart the POS app/server to load the updated API, then retry.`
      );
    }
    const savedPolicies = parseVersionComponentPolicies(payload.versionComponentPolicies);
    if (!savedPolicies || APP_VERSIONS.some((version) => !Array.isArray(savedPolicies[version]))) {
      throw new Error('The version policy service returned an incomplete save response.');
    }
    return savedPolicies;
  }, []);

  const handleActivateVersion = async (input: {
    appVersion: AppVersion;
    password: string;
  }) => {
    const res = await fetch('/api/settings/activate-version', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        typeof data?.error === 'string' ? data.error : 'Could not activate the selected version.'
      );
    }
    setSettings(data as StoreSettings);
  };

  const handleActivateRegistrationKey = async (registrationKey: string) => {
    const response = await fetch('/api/registration/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationKey }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'string'
          ? payload.error
          : `Could not activate this registration (HTTP ${response.status}).`
      );
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('settings' in payload) ||
      !('username' in payload) ||
      typeof payload.username !== 'string' ||
      !('appVersion' in payload) ||
      typeof payload.appVersion !== 'string' ||
      typeof payload.settings !== 'object' ||
      payload.settings === null ||
      !('registeredSystem' in payload.settings) ||
      payload.settings.registeredSystem !== true ||
      !APP_VERSIONS.some((version) => version === payload.appVersion)
    ) {
      throw new Error('The registration service returned an invalid activation response.');
    }
    setSettings(payload.settings as StoreSettings);
    return {
      username: payload.username,
      appVersion: payload.appVersion as AppVersion,
    };
  };

  const handleFlushPrintQueue = async () => {
    if (window.electronAPI?.isElectron) {
      await window.electronAPI.printReceipt({
        silent: true,
        printerName: settings.invoiceTemplates?.[settings.paperWidth || '80mm']?.defaultPrinter || undefined,
      });
    } else {
      window.print();
    }
    await fetch('/api/print-queue/flush', { method: 'POST' });
    const queueRes = await fetch('/api/print-queue');
    if (queueRes.ok) setPrintQueue(await queueRes.json());
  };

  const isAdmin = currentUser?.role === 'admin';
  const canEditSales = isAdmin || (
    currentUser?.permissions?.includes('edit-sales') === true &&
    currentUser?.permissions?.includes('register') === true &&
    currentUser?.permissions?.includes('sales') === true
  );
  const canManageSalesReturns =
    isAdmin || currentUser?.permissions?.includes('manage-sales-returns') === true;
  const canReturnSales =
    isAdmin ||
    currentUser?.permissions?.includes('sales-return') === true ||
    canManageSalesReturns;
  const canDeleteSales = isAdmin || currentUser?.permissions?.includes('delete-sales') === true;
  const isAppAdmin = currentUser?.username.toLowerCase() === 'aptadmin';
  const isRposMode = settings.posScreenLayout === 'rpos';

  const hasPermission = (tabId: NavTab) => {
    if (!currentUser) return false;
    if (
      tabId !== 'settings' &&
      tabId !== 'unavailable' &&
      (!isAppAdmin || settings.registeredSystem === true) &&
      settings.disabledAppComponents?.some((component) => component === tabId)
    ) return false;
    if (tabId === 'purchase-return-register' || tabId === 'purchase-return-history') {
      return isAdmin;
    }
    if (tabId === 'files') return isAdmin;
    if (tabId === 'settings') {
      return isAdmin || isAppAdmin || currentUser.permissions?.includes('settings') === true;
    }
    if (isAdmin) return true;
    const requiredPermission =
      tabId === 'shift'
        ? 'register'
        : tabId === 'return-register' || tabId === 'return-history'
        ? 'sales-return'
        : tabId;
    if (
      (tabId === 'return-register' || tabId === 'return-history') &&
      currentUser.permissions?.includes('manage-sales-returns')
    ) {
      return true;
    }
    return currentUser.permissions?.includes(requiredPermission) ?? false;
  };

  const fallbackTabs = APP_COMPONENTS
    .map((component) => component.id)
    .filter((tab) => hasPermission(tab));
  const effectiveTab: NavTab = hasPermission(activeTab)
    ? activeTab
    : fallbackTabs[0] || (hasPermission('settings') ? 'settings' : 'unavailable');
  const nextPurchaseVoucherId = purchases.length
    ? purchases.reduce((latest, purchase) => purchase.id > latest.id ? purchase : latest).id + 1
    : 1;
  const nextPurchaseVoucherNumber = `PV-${String(nextPurchaseVoucherId).padStart(6, '0')}`;
  const settingsWorkspace = (
    <SettingsView
      settings={settings}
      activeSection={isAdmin || isAppAdmin ? settingsSection : 'screen'}
      onActiveSectionChange={setSettingsSection}
      showSectionNavigation={!showSettingsComponent}
      printQueue={printQueue}
      isAdmin={isAdmin}
      isAppAdmin={isAppAdmin}
      canRegisterSystem={isAppAdmin || currentUser?.demoMode === true}
      theme={theme}
      onThemeChange={setTheme}
      iconOnlyLauncher={iconOnlyLauncher}
      onIconOnlyLauncherChange={setIconOnlyLauncher}
      onSaveSettings={handleSaveSettings}
      onActivateVersion={handleActivateVersion}
      onActivateRegistrationKey={handleActivateRegistrationKey}
      onLoadVersionComponentPolicies={loadVersionComponentPolicies}
      onSaveVersionComponentPolicies={saveVersionComponentPolicies}
      onFlushPrintQueue={handleFlushPrintQueue}
      onResetDatabase={handleResetDatabase}
      onRestoreDatabase={handleRestoreDatabase}
    />
  );

  return (
    <LanguageProvider initialLanguage={settings.appLanguage}>
      <>
        {!currentUser ? (
          <>
            <LoginForm
              onLoginSuccess={handleLoginSuccess}
              onDemoRegistrationRequested={handleDemoRegistrationRequested}
              initialError={loginError}
            />
            {loginDemoRegistration && (
              <DemoRegistrationWindow
                requestedBy={loginDemoRegistration.user.username}
                demoAccessStatus={loginDemoRegistration.status}
                onClose={() => setLoginDemoRegistration(null)}
                onDemoActivated={handleDemoActivated}
              />
            )}
          </>
        ) : (
          <div
            data-theme={theme}
            className={`pos-app-shell${activeReceipt ? ' invoice-print-open' : ''} h-[100dvh] max-h-[100dvh] w-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden`}
          >
          <TopBar
            activeTab={effectiveTab}
            activeSettingsSection={settingsSection}
            showSettingsComponent={showSettingsComponent}
            isAppAdmin={isAppAdmin}
            onSelectTab={setActiveTab}
            onSettingsSectionChange={setSettingsSection}
            onSettingsComponentChange={setShowSettingsComponent}
            settingsWorkspace={settingsWorkspace}
            onSettingsLauncherChange={setShowSettingsWorkspace}
            onLogout={handleLogout}
            onOpenCashbook={() => setCashbookModalOpen(true)}
            currentUser={currentUser}
            disabledAppComponents={settings.disabledAppComponents}
            iconOnlyLauncher={iconOnlyLauncher}
            openLauncherOnMount={openLauncherAfterLogin}
            onLauncherOpened={handleLauncherOpened}
            demoExpiresAt={currentUser.demoMode ? currentUser.demoExpiresAt : undefined}
            purchaseVoucherNumber={effectiveTab === 'purchases' ? nextPurchaseVoucherNumber : undefined}
            purchaseVendor={effectiveTab === 'purchases' ? purchaseVendor : null}
          />

          {loading ? (
            <main className="flex-1 flex items-center justify-center">
              <div className="text-sm text-slate-500">Loading POS terminal...</div>
            </main>
          ) : (
            <main className="win11-app-content flex-1 flex min-h-0 overflow-hidden">
          {effectiveTab === 'register' && (
            <div
              style={isRposMode
                ? {
                    width: `calc(100% - max(150px, min(${rposTicketWidth}px, calc(100vw - 120px))))`,
                    marginRight: 'auto',
                  }
                : undefined}
              className={`${isRposMode ? 'w-full' : 'w-full min-[900px]:w-2/3'} flex min-w-0 flex-col min-h-0`}
            >
              <div className="flex-1 min-w-0 min-h-0 flex">
                <RegisterView
                  products={products}
                  customers={customers}
                  settings={settings}
                  rposTicketWidth={rposTicketWidth}
                  onRposTicketWidthChange={setRposTicketWidth}
                  onSaleCompleted={handleSaleCompleted}
                  restoredSale={restoredSale}
                  onClearRestoredSale={() => setRestoredSale(null)}
                  receiptModalOpen={Boolean(activeReceipt)}
                  onOpenSalesHistory={
                    hasPermission('sales') ? () => setActiveTab('sales') : undefined
                  }
                  onEditProduct={
                    isAdmin && hasPermission('inventory')
                      ? (product) =>
                          setProductEditRequest((request) => ({
                            product,
                            requestId: (request?.requestId || 0) + 1,
                          }))
                      : undefined
                  }
                  onAddProduct={
                    isAdmin && hasPermission('inventory')
                      ? (barcode) => {
                          setProductCreateBarcode(barcode);
                          setProductCreateReturnTab('register');
                          setProductCreateRequest((request) => request + 1);
                        }
                      : undefined
                  }
                  productEditorOpen={Boolean(productEditRequest)}
                  productCreateModalOpen={
                    effectiveTab === 'register' && productCreateReturnTab === 'register'
                  }
                />
              </div>
            </div>
          )}

          {(effectiveTab === 'register' ||
            effectiveTab === 'purchases' ||
            effectiveTab === 'purchase-history') &&
            isAdmin &&
            productEditRequest && (
            <InventoryView
              products={products}
              settings={settings}
              theme={theme}
              onRefreshProducts={refreshProducts}
              editProductRequest={productEditRequest}
              editProductOnly
              onProductEditorClosed={(requestId) => {
                setProductEditRequest((request) =>
                  request?.requestId === requestId ? null : request
                );
                if (effectiveTab === 'purchases') {
                  setPurchaseBarcodeFocusRequest((request) => request + 1);
                }
              }}
            />
          )}

          {(effectiveTab === 'inventory' ||
            productCreateReturnTab === 'purchases' ||
            (effectiveTab === 'register' && productCreateReturnTab === 'register')) &&
            isAdmin && (
            <div className={effectiveTab === 'inventory' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <InventoryView
                products={products}
                settings={settings}
                theme={theme}
                onRefreshProducts={refreshProducts}
                createProductRequest={productCreateRequest}
                createProductBarcode={productCreateBarcode}
                onCreateProductRequestHandled={handleProductCreateRequestHandled}
                returnToSourceAfterCreate={Boolean(productCreateReturnTab)}
                onProductCreated={handleProductCreatedFromRegister}
                onProductCreateCancelled={handleProductCreateCancelled}
              />
            </div>
          )}

          {effectiveTab === 'files' && isAdmin && <FilesView />}
          {effectiveTab === 'shift' && currentUser && (
            <ShiftView currentUser={currentUser} settings={settings} theme={theme} />
          )}

          {isAdmin && (
            <div
              className={
                effectiveTab === 'purchases' ||
                effectiveTab === 'purchase-history' ||
                effectiveTab === 'purchase-return-register'
                  ? 'flex min-h-0 flex-1 flex-col'
                  : 'hidden'
              }
              aria-hidden={
                effectiveTab !== 'purchases' &&
                effectiveTab !== 'purchase-history' &&
                effectiveTab !== 'purchase-return-register'
              }
            >
              <PurchasesView
                isActive={effectiveTab === 'purchases' || effectiveTab === 'purchase-return-register'}
                page={effectiveTab === 'purchase-history' ? 'history' : 'entry'}
                mode={effectiveTab === 'purchase-return-register' ? 'purchase-return' : 'purchase'}
                focusBarcodeRequest={purchaseBarcodeFocusRequest}
                onNavigatePage={(page) => {
                if (effectiveTab === 'purchase-return-register') {
                  setActiveTab(page === 'history' ? 'purchase-return-history' : 'purchase-return-register');
                  return;
                }
                setActiveTab(page === 'history' ? 'purchase-history' : 'purchases');
                }}
                onSelectedVendorChange={setPurchaseVendor}
                purchases={purchases}
                purchaseReturnVouchers={purchaseReturnVouchers}
                sales={sales}
                salesReturnVouchers={salesReturnVouchers}
                vendors={vendors}
                products={products}
                settings={settings}
                onRefreshPurchases={refreshPurchases}
                onRefreshProducts={refreshProducts}
                onRefreshVendors={refreshVendors}
                onDeletePurchase={handleDeletePurchase}
                onEditPurchase={handleEditPurchase}
                onCreatePurchaseReturn={
                  hasPermission('purchase-return-register')
                    ? handleCreatePurchaseReturn
                    : undefined
                }
                onEditProduct={
                  hasPermission('inventory')
                    ? (product) =>
                        setProductEditRequest((request) => ({
                          product,
                          requestId: (request?.requestId || 0) + 1,
                        }))
                    : undefined
                }
                onAddProduct={
                  hasPermission('inventory')
                    ? (barcode) => {
                        setProductCreateBarcode(barcode);
                        setProductCreateReturnTab('purchases');
                        setProductCreateRequest((request) => request + 1);
                      }
                    : undefined
                }
              />
            </div>
          )}

          {['accounts', 'customers', 'vendors'].includes(effectiveTab) && (
            <div className="settings-view flex min-h-0 flex-1 flex-col overflow-hidden">
              <nav
                className="settings-section-navigation"
                aria-label={settings.appLanguage === 'ar' ? 'أقسام الحسابات' : 'Accounts sections'}
                role="tablist"
              >
                <div className="settings-section-tabs">
                  {[
                    { subtab: 'ledger' as const, id: 'accounts' as NavTab, label: settings.appLanguage === 'ar' ? 'دفتر الحسابات' : 'Ledger' },
                    { subtab: 'customers' as const, id: 'customers' as NavTab, label: settings.appLanguage === 'ar' ? 'العملاء' : 'Customers' },
                    { subtab: 'vendors' as const, id: 'vendors' as NavTab, label: settings.appLanguage === 'ar' ? 'الموردون' : 'Vendors' },
                    { subtab: 'payments' as const, id: 'accounts' as NavTab, label: settings.appLanguage === 'ar' ? 'المدفوعات والمقبوضات' : 'Payments & Receipts' },
                  ].filter((tab) => hasPermission(tab.id)).map((tab) => (
                    <button
                      key={tab.subtab}
                      type="button"
                      role="tab"
                      aria-selected={
                        tab.subtab === 'customers'
                          ? effectiveTab === 'customers'
                          : tab.subtab === 'vendors'
                            ? effectiveTab === 'vendors'
                            : effectiveTab === 'accounts' && accountsSubtab === tab.subtab
                      }
                      onClick={() => {
                        setAccountsSubtab(tab.subtab);
                        setActiveTab(tab.id);
                      }}
                      className={`settings-section-tab${
                        (tab.subtab === 'customers'
                          ? effectiveTab === 'customers'
                          : tab.subtab === 'vendors'
                            ? effectiveTab === 'vendors'
                            : effectiveTab === 'accounts' && accountsSubtab === tab.subtab)
                          ? ' is-active'
                          : ''
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </nav>
              <div className="settings-content-scroll min-h-0 flex-1 overflow-y-auto">
                {effectiveTab === 'accounts' && accountsSubtab === 'ledger' && (
                  <LedgerView
                    customers={customers}
                    vendors={vendors}
                    sales={sales}
                    purchases={purchases}
                    returnVouchers={salesReturnVouchers}
                    cashbookEntries={cashbookEntries}
                    settings={settings}
                  />
                )}

                {effectiveTab === 'customers' && isAdmin && (
                  <CustomersView
                    customers={customers}
                    settings={settings}
                    onRefresh={refreshCustomers}
                  />
                )}

                {effectiveTab === 'vendors' && isAdmin && (
                  <VendorsView
                    vendors={vendors}
                    settings={settings}
                    onRefresh={refreshVendors}
                  />
                )}

                {effectiveTab === 'accounts' && accountsSubtab === 'payments' && hasPermission('accounts') && (
                  <ReportsView
                    key="cashbook"
                    mode="cashbook"
                    sales={sales}
                    returnVouchers={salesReturnVouchers}
                    purchases={purchases}
                    cashbookEntries={cashbookEntries}
                    cashbookOpeningBalance={null}
                    canManageCashbook
                    onCreateCashbookEntry={handleCreateCashbookEntry}
                    accountOptions={[
                      'Cash',
                      'Bank',
                      ...customers.map((customer) => customer.name),
                      ...vendors.map((vendor) => vendor.name),
                    ]}
                    settings={settings}
                  />
                )}
              </div>
            </div>
          )}

          {effectiveTab === 'purchase-return-history' && isAdmin && (
            <PurchaseReturnHistoryView
              vouchers={purchaseReturnVouchers}
              settings={settings}
              onCreateReturn={
                hasPermission('purchase-return-register')
                  ? () => setActiveTab('purchase-return-register')
                  : undefined
              }
              onDeleteVoucher={handleDeletePurchaseReturn}
            />
          )}

          {effectiveTab === 'sales' && (
            <SalesHistoryView
              sales={sales}
              returnVouchers={salesReturnVouchers}
              settings={settings}
              onReprintSale={(sale) => setActiveReceipt({ sale })}
              onOpenReturnRegister={
                canReturnSales && hasPermission('return-register')
                  ? (sale) => {
                      setInitialReturnSales([sale]);
                      setActiveTab('return-register');
                    }
                  : undefined
              }
              onDeleteSale={canDeleteSales ? handleDeleteSale : undefined}
              onEditInvoice={canEditSales ? handleEditInvoice : undefined}
            />
          )}

          {effectiveTab === 'return-register' && canReturnSales && (
            <SalesReturnRegisterView
              initialSales={initialReturnSales}
              sales={sales}
              settings={settings}
              cashierName={currentUser.displayName}
              editingVoucher={editingReturnVoucher || undefined}
              onOpenReturnHistory={() => {
                setEditingReturnVoucher(null);
                setInitialReturnSales([]);
                setActiveTab('return-history');
              }}
              onCancel={() => {
                const wasEditing = Boolean(editingReturnVoucher);
                setEditingReturnVoucher(null);
                setInitialReturnSales([]);
                setActiveTab(
                  wasEditing
                    ? 'return-history'
                    : hasPermission('sales')
                      ? 'sales'
                      : 'return-history'
                );
              }}
              onProcessVoucher={handleCreateReturnVoucher}
              onUpdateVoucher={handleUpdateReturnVoucher}
            />
          )}

          {effectiveTab === 'return-history' && canReturnSales && (
            <SalesReturnHistoryView
              vouchers={salesReturnVouchers}
              settings={settings}
              onEditVoucher={canManageSalesReturns ? handleEditReturnVoucher : undefined}
              onDeleteVoucher={canManageSalesReturns ? handleDeleteReturnVoucher : undefined}
            />
          )}

          {effectiveTab === 'reports' && hasPermission('reports') && (
            <div className="settings-view flex min-h-0 flex-1 flex-col overflow-hidden">
              <nav
                className="settings-section-navigation"
                aria-label={settings.appLanguage === 'ar' ? 'أقسام التقارير' : 'Report sections'}
                role="tablist"
              >
                <div className="settings-section-tabs">
                  {[
                    settings.appLanguage === 'ar' ? 'التقارير اليومية' : 'Daily Reports',
                    settings.appLanguage === 'ar' ? 'تقارير المبيعات' : 'Sales Reports',
                    settings.appLanguage === 'ar' ? 'تقارير المشتريات' : 'Purchase Reports',
                    settings.appLanguage === 'ar' ? 'تقارير الضرائب' : 'Tax Reports',
                    settings.appLanguage === 'ar' ? 'تقارير أخرى' : 'Other Reports',
                  ].map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      role="tab"
                      aria-selected={index === 0}
                      className={`settings-section-tab${index === 0 ? ' is-active' : ''}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </nav>
              <div className="settings-content-scroll min-h-0 flex-1 overflow-y-auto">
                <ReportsView
                  key="reports"
                  mode="reports"
                  sales={sales}
                  returnVouchers={salesReturnVouchers}
                  purchases={purchases}
                  cashbookEntries={cashbookEntries}
                  cashbookOpeningBalance={cashbookOpeningBalance}
                  canManageCashbook={isAdmin}
                  onCreateCashbookEntry={handleCreateCashbookEntry}
                  settings={settings}
                />
              </div>
            </div>
          )}

          {effectiveTab === 'settings' && !showSettingsWorkspace && settingsWorkspace}
          {effectiveTab === 'unavailable' && (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-600">
              No app components are enabled for your account. Contact aptadmin.
            </div>
          )}
          </main>
          )}

          {activeReceipt && (
            <ThermalReceiptModal
              sale={activeReceipt.sale}
              returnVouchers={salesReturnVouchers.filter((voucher) =>
                voucher.items.some((item) => item.saleId === activeReceipt.sale.id)
              )}
              settings={settings}
              queuedOffline={activeReceipt.queuedOffline}
              onClose={() => setActiveReceipt(null)}
            />
          )}
          {cashbookModalOpen && currentUser && (
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-2 sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cashbook-modal-title"
              onClick={(event) => {
                if (event.target === event.currentTarget) setCashbookModalOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setCashbookModalOpen(false);
                }
              }}
            >
              <section className="pos-app-shell flex max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
                <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h2 id="cashbook-modal-title" className="text-sm font-bold text-slate-900">
                    {settings.appLanguage === 'ar' ? 'دفتر النقدية' : 'Cash Book'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setCashbookModalOpen(false)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    {settings.appLanguage === 'ar' ? 'إغلاق' : 'Close'}
                  </button>
                </header>
                <ReportsView
                  key="cashbook-modal"
                  mode="cashbook"
                  sales={sales}
                  returnVouchers={salesReturnVouchers}
                  purchases={purchases}
                  cashbookEntries={cashbookEntries}
                  cashbookOpeningBalance={cashbookOpeningBalance}
                  canManageCashbook={hasPermission('accounts')}
                  onCreateCashbookEntry={handleCreateCashbookEntry}
                  accountOptions={[
                    'Cash',
                    'Bank',
                    ...customers.map((customer) => customer.name),
                    ...vendors.map((vendor) => vendor.name),
                  ]}
                  settings={settings}
                />
              </section>
            </div>
          )}
          </div>
        )}
        {closeDialogOpen && (
          <AppCloseDialog
            busy={closeBackupBusy}
            error={closeBackupError}
            onBackupAndClose={handleBackupAndClose}
            onCloseWithoutBackup={handleCloseWithoutBackup}
            onCancel={handleCancelClose}
          />
        )}
      </>
    </LanguageProvider>
  );
}

export default App;
