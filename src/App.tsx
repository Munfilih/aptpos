import React, { useCallback, useEffect, useState } from 'react';
import { TopBar, type NavTab } from './components/TopBar';
import { RegisterView } from './components/RegisterView';
import { InventoryView } from './components/InventoryView';
import { PurchasesView } from './components/PurchasesView';
import { CustomersView } from './components/CustomersView';
import { VendorsView } from './components/VendorsView';
import { SalesHistoryView } from './components/SalesHistoryView';
import { SalesReturnRegisterView } from './components/SalesReturnRegisterView';
import { SalesReturnHistoryView } from './components/SalesReturnHistoryView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { ThermalReceiptModal } from './components/ThermalReceiptModal';
import { LoginForm } from './components/LoginForm';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import type {
  CashbookEntry,
  CashbookOpeningBalance,
  Customer,
  CreateCashbookEntryInput,
  CreateSalesReturnVoucherInput,
  PrintJob,
  Product,
  PurchaseEntry,
  Sale,
  SalesReturnVoucher,
  StoreSettings,
  UserSession,
  Vendor,
} from './types/pos';

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
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState<NavTab>('register');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesReturnVouchers, setSalesReturnVouchers] = useState<SalesReturnVoucher[]>([]);
  const [cashbookEntries, setCashbookEntries] = useState<CashbookEntry[]>([]);
  const [cashbookOpeningBalance, setCashbookOpeningBalance] =
    useState<CashbookOpeningBalance | null>(null);
  const [initialReturnSales, setInitialReturnSales] = useState<Sale[]>([]);
  const [editingReturnVoucher, setEditingReturnVoucher] = useState<SalesReturnVoucher | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [purchases, setPurchases] = useState<PurchaseEntry[]>([]);
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [printQueue, setPrintQueue] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [productCreateRequest, setProductCreateRequest] = useState(0);
  const [activeReceipt, setActiveReceipt] = useState<{
    sale: Sale;
    queuedOffline?: boolean;
  } | null>(null);
  const [restoredSale, setRestoredSale] = useState<Sale | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeBackupBusy, setCloseBackupBusy] = useState(false);
  const [closeBackupError, setCloseBackupError] = useState<string | null>(null);

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
    try {
      sessionStorage.setItem('counterline_user', JSON.stringify(user));
    } catch {
      // storage disabled
    }
    setActiveTab('register');
    setLoading(true);
    fetchAll();
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      sessionStorage.removeItem('counterline_user');
    } catch {
      // ignore
    }
  };

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
    if (res.ok) {
      setSettings(await res.json());
    }
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
    if (tabId === 'settings' && !isAdmin) return false;
    if (tabId === 'accounts' && !isAdmin) return false;
    if (isAdmin) return true;
    const requiredPermission =
      tabId === 'return-register' || tabId === 'return-history'
        ? 'sales-return'
        : tabId === 'reports'
          ? 'sales'
          : tabId;
    if (
      (tabId === 'return-register' || tabId === 'return-history') &&
      currentUser.permissions?.includes('manage-sales-returns')
    ) {
      return true;
    }
    return currentUser.permissions?.includes(requiredPermission) ?? false;
  };

  const fallbackTabs = currentUser?.permissions?.filter(
    (tab): tab is NavTab =>
      ['register', 'inventory', 'purchases', 'customers', 'vendors', 'sales'].includes(tab)
  );
  const effectiveTab: NavTab = hasPermission(activeTab)
    ? activeTab
    : fallbackTabs?.[0] || 'register';

  return (
    <LanguageProvider initialLanguage={settings.appLanguage}>
      <>
        {!currentUser ? (
          <LoginForm onLoginSuccess={handleLoginSuccess} />
        ) : (
          <div className="h-[100dvh] max-h-[100dvh] w-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden">
          <TopBar
            activeTab={effectiveTab}
            onSelectTab={setActiveTab}
            onLogout={handleLogout}
            currentUser={currentUser}
          />

          {loading ? (
            <main className="flex-1 flex items-center justify-center">
              <div className="text-sm text-slate-500">Loading POS terminal...</div>
            </main>
          ) : (
            <main className="flex-1 flex min-h-0 overflow-hidden">
          {effectiveTab === 'register' && (
            <RegisterView
              products={products}
              customers={customers}
              settings={settings}
              onSaleCompleted={handleSaleCompleted}
              restoredSale={restoredSale}
              onClearRestoredSale={() => setRestoredSale(null)}
              receiptModalOpen={Boolean(activeReceipt)}
            />
          )}

          {effectiveTab === 'inventory' && isAdmin && (
            <InventoryView
              products={products}
              settings={settings}
              onRefreshProducts={refreshProducts}
              createProductRequest={productCreateRequest}
            />
          )}

          {effectiveTab === 'purchases' && isAdmin && (
            <PurchasesView
              purchases={purchases}
              vendors={vendors}
              products={products}
              settings={settings}
              onRefreshPurchases={refreshPurchases}
              onRefreshProducts={refreshProducts}
              onNavigateToVendors={() => setActiveTab('vendors')}
              onDeletePurchase={handleDeletePurchase}
              onEditPurchase={handleEditPurchase}
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

          {effectiveTab === 'sales' && (
            <SalesHistoryView
              sales={sales}
              returnVouchers={salesReturnVouchers}
              settings={settings}
              onReprintSale={(sale) => setActiveReceipt({ sale })}
              onOpenReturnRegister={
                canReturnSales
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

          {effectiveTab === 'reports' && (isAdmin || currentUser.permissions?.includes('sales')) && (
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
          )}

          {effectiveTab === 'accounts' && isAdmin && (
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
              settings={settings}
            />
          )}

          {effectiveTab === 'settings' && isAdmin && (
            <SettingsView
              settings={settings}
              printQueue={printQueue}
              isAppAdmin={isAppAdmin}
              onSaveSettings={handleSaveSettings}
              onFlushPrintQueue={handleFlushPrintQueue}
              onResetDatabase={handleResetDatabase}
              onRestoreDatabase={handleRestoreDatabase}
            />
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
