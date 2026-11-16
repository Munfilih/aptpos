import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Printer,
  Store,
  LayoutGrid,
  Percent,
  Database,
  Download,
  Upload,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Users,
  UserPlus,
  Shield,
  Trash2,
  Edit2,
  X,
  Plus,
  Lock,
  UserCheck,
  Monitor,
  FileText,
  Globe,
  QrCode,
} from 'lucide-react';
import type {
  InvoiceTemplateSettings,
  PaperWidth,
  PosScreenLayout,
  PrintJob,
  StoreSettings,
  TaxType,
  UserAccount,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { getPaymentMethods } from '../utils/paymentMethods';
import { MINIMUM_INVOICE_MARGIN_MM, resolveInvoiceMarginsMm } from '../utils/thermalPrinting';
import type { UpdateStatus } from '../../electron/updateStatus';

interface SettingsViewProps {
  settings: StoreSettings;
  printQueue: PrintJob[];
  isAppAdmin: boolean;
  onSaveSettings: (updated: StoreSettings) => Promise<void>;
  onFlushPrintQueue: () => Promise<void>;
  onResetDatabase?: () => Promise<void>;
  onRestoreDatabase?: (buffer: ArrayBuffer) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  printQueue,
  isAppAdmin,
  onSaveSettings,
  onFlushPrintQueue,
  onResetDatabase,
  onRestoreDatabase,
}) => {
  const { t, language, setLanguage, isRtl } = useLanguage();
  const [form, setForm] = useState<StoreSettings>(settings);
  const [selectedTemplate, setSelectedTemplate] = useState<PaperWidth>(settings.paperWidth || '80mm');
  const [availablePrinters, setAvailablePrinters] = useState<Array<{ name: string; displayName: string }>>([]);
  const [printerListError, setPrinterListError] = useState<string | null>(null);
  const [printerDialogOpen, setPrinterDialogOpen] = useState(false);
  const [printerDialogTarget, setPrinterDialogTarget] = useState<'template' | 'kot'>('template');
  const [printersLoading, setPrintersLoading] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<
    'sales' | 'screen' | 'store' | 'printer' | 'users' | 'database' | 'updates'
  >('sales');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [newPaymentMethod, setNewPaymentMethod] = useState('');
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [updateActionError, setUpdateActionError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const templateSettings = (
    current: StoreSettings,
    format: PaperWidth
  ): InvoiceTemplateSettings => ({
    defaultPrinter: current.defaultPrinter?.toLowerCase().startsWith('system default')
      ? ''
      : current.defaultPrinter,
    printerMode: current.defaultPrinter && !current.defaultPrinter.toLowerCase().startsWith('system default')
      ? 'saved-printer'
      : 'system-default',
    invoiceShowProductName: current.invoiceShowProductName,
    invoiceShowProductNameAr: current.invoiceShowProductNameAr,
    invoiceShowBarcode: current.invoiceShowBarcode,
    invoiceShowCustomerInfo: current.invoiceShowCustomerInfo,
    invoiceShowCashierName: current.invoiceShowCashierName,
    invoiceShowTaxDetails: current.invoiceShowTaxDetails,
    invoiceShowStoreAddress: current.invoiceShowStoreAddress,
    invoiceShowReceiptBarcode: current.invoiceShowReceiptBarcode,
    invoiceShowFooter: current.invoiceShowFooter,
    invoiceShowQrCode: current.invoiceShowQrCode,
    ...current.invoiceTemplates?.[format],
    invoiceMarginsMm: resolveInvoiceMarginsMm(
      format,
      current.invoiceTemplates?.[format]?.invoiceMarginsMm
    ),
  });

  const updateTemplateSettings = <K extends keyof InvoiceTemplateSettings>(
    key: K,
    value: InvoiceTemplateSettings[K]
  ) => {
    setForm((current) => ({
      ...current,
      invoiceTemplates: {
        ...current.invoiceTemplates,
        [selectedTemplate]: {
          ...templateSettings(current, selectedTemplate),
          [key]: value,
        },
      },
    }));
  };

  const handleCheckForUpdates = async () => {
    const api = window.electronAPI;
    if (!api?.checkForUpdates) return;
    setUpdateActionError(null);
    setUpdateStatus({ state: 'checking' });
    try {
      await api.checkForUpdates();
    } catch (error) {
      setUpdateActionError((error as Error).message || 'Could not check for updates.');
    }
  };

  const handleInstallUpdate = async () => {
    const api = window.electronAPI;
    if (!api?.installUpdate) return;
    setUpdateActionError(null);
    try {
      await api.installUpdate();
    } catch (error) {
      setUpdateActionError((error as Error).message || 'Could not install the update.');
    }
  };

  // User Management State
  const [usersList, setUsersList] = useState<UserAccount[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [userFormData, setUserFormData] = useState<{
    username: string;
    password: string;
    role: 'admin' | 'cashier' | 'custom';
    displayName: string;
    permissions: string[];
  }>({
    username: '',
    password: '',
    role: 'cashier',
    displayName: '',
    permissions: ['register', 'sales'],
  });
  const [userFormSaving, setUserFormSaving] = useState(false);
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [userActionSuccess, setUserActionSuccess] = useState<string | null>(null);

  const fetchUsers = async () => {
    if (!isAppAdmin) return;
    setUsersLoading(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsersList(data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (isAppAdmin) {
      fetchUsers();
    }
  }, [isAppAdmin]);

  useEffect(() => {
    if (!isAppAdmin && (activeSettingsSection === 'screen' || activeSettingsSection === 'users' || activeSettingsSection === 'database')) {
      setActiveSettingsSection('sales');
    }
  }, [isAppAdmin, activeSettingsSection]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getUpdateStatus || !api.onUpdateStatus) return;

    let active = true;
    const unsubscribe = api.onUpdateStatus((status) => {
      if (active) setUpdateStatus(status);
    });
    void api.getUpdateStatus()
      .then((status) => {
        if (active) setUpdateStatus(status);
      })
      .catch((error: unknown) => {
        if (active) {
          setUpdateActionError((error as Error).message || 'Could not load update status.');
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleOpenAddUser = () => {
    setEditingUser(null);
    setUserFormData({
      username: '',
      password: '',
      role: 'cashier',
      displayName: '',
      permissions: ['register', 'sales'],
    });
    setUserFormError(null);
    setUserModalOpen(true);
  };

  const handleOpenEditUser = (user: UserAccount) => {
    setEditingUser(user);
    setUserFormData({
      username: user.username,
      password: '', // Leave blank to keep existing password
      role: user.role,
      displayName: user.displayName,
      permissions: user.permissions && user.permissions.length > 0 ? user.permissions : ['register', 'sales'],
    });
    setUserFormError(null);
    setUserModalOpen(true);
  };

  const handleDeleteUser = async (userId: number, username: string) => {
    if (username.toLowerCase() === 'aptadmin') {
      alert('The primary company admin account cannot be deleted.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete user account "${username}"?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to delete user');
        return;
      }
      setUserActionSuccess(`User "${username}" was removed.`);
      setTimeout(() => setUserActionSuccess(null), 3000);
      await fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormSaving(true);
    setUserFormError(null);
    try {
      if (!userFormData.username.trim()) {
        throw new Error('Username is required.');
      }
      if (!editingUser && !userFormData.password.trim()) {
        throw new Error('Password is required for new accounts.');
      }

      const allPossiblePerms = [
        'register',
        'sales',
        'edit-sales',
        'sales-return',
        'manage-sales-returns',
        'delete-sales',
        'inventory',
        'purchases',
        'customers',
        'vendors',
        'settings',
      ];
      const requestedPerms = new Set(userFormData.permissions);
      if (requestedPerms.has('edit-sales')) {
        requestedPerms.add('register');
        requestedPerms.add('sales');
      }
      if (
        requestedPerms.has('sales-return') ||
        requestedPerms.has('manage-sales-returns') ||
        requestedPerms.has('delete-sales')
      ) {
        requestedPerms.add('sales');
      }
      if (requestedPerms.has('manage-sales-returns')) requestedPerms.add('sales-return');
      const effectivePerms = userFormData.role === 'admin'
        ? allPossiblePerms
        : (requestedPerms.size > 0 ? [...requestedPerms] : ['register']);

      if (editingUser) {
        const payload: any = {
          username: userFormData.username.trim(),
          role: userFormData.role,
          displayName: userFormData.displayName.trim() || userFormData.username.trim(),
          permissions: effectivePerms,
        };
        if (userFormData.password.trim()) {
          payload.password = userFormData.password.trim();
        }
        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update user');
        }
      } else {
        const payload = {
          username: userFormData.username.trim(),
          password: userFormData.password.trim(),
          role: userFormData.role,
          displayName: userFormData.displayName.trim() || userFormData.username.trim(),
          permissions: effectivePerms,
        };
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create user');
        }
      }

      setUserModalOpen(false);
      setEditingUser(null);
      setUserActionSuccess(editingUser ? 'User credentials updated successfully!' : 'New user created successfully!');
      setTimeout(() => setUserActionSuccess(null), 3500);
      await fetchUsers();
    } catch (err: any) {
      setUserFormError(err.message || 'An error occurred.');
    } finally {
      setUserFormSaving(false);
    }
  };

  // Synchronize form when external settings update
  useEffect(() => {
    setForm(settings);
    setSelectedTemplate(settings.paperWidth || '80mm');
  }, [settings]);

  const loadAvailablePrinters = async () => {
    if (!window.electronAPI?.isElectron) {
      setPrinterListError('Available printers can only be listed in the desktop app.');
      return;
    }

    setPrintersLoading(true);
    setPrinterListError(null);
    try {
      setAvailablePrinters(await window.electronAPI.listPrinters());
    } catch (error) {
      console.error('Failed to load installed printers:', error);
      setPrinterListError('Could not load installed printers.');
    } finally {
      setPrintersLoading(false);
    }
  };

  const openPrinterDialog = (target: 'template' | 'kot' = 'template') => {
    setPrinterDialogTarget(target);
    setPrinterDialogOpen(true);
    void loadAvailablePrinters();
  };

  const selectPrinter = (printerName: string) => {
    if (printerDialogTarget === 'kot') {
      setForm((current) => ({ ...current, kotPrinter: printerName }));
    } else {
      updateTemplateSettings('defaultPrinter', printerName);
      updateTemplateSettings('printerMode', printerName ? 'saved-printer' : 'system-default');
    }
    setPrinterDialogOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveSettings(form);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const paymentMethods = getPaymentMethods(form.paymentMethods);

  const handleAddPaymentMethod = () => {
    const name = newPaymentMethod.trim();
    if (!name) {
      setPaymentMethodError(isRtl ? 'أدخل اسم طريقة الدفع.' : 'Enter a payment method name.');
      return;
    }
    if (paymentMethods.some((method) => method.toLowerCase() === name.toLowerCase())) {
      setPaymentMethodError(isRtl ? 'طريقة الدفع موجودة بالفعل.' : 'That payment method already exists.');
      return;
    }

    setForm((current) => ({
      ...current,
      paymentMethods: [...getPaymentMethods(current.paymentMethods), name],
    }));
    setNewPaymentMethod('');
    setPaymentMethodError(null);
  };

  const handleSelectLayout = async (layoutId: PosScreenLayout) => {
    const next = { ...form, posScreenLayout: layoutId };
    setForm(next);
    setSaving(true);
    try {
      await onSaveSettings(next);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmReset = async () => {
    if (!onResetDatabase) return;
    setIsResetting(true);
    setResetError(null);
    try {
      await onResetDatabase();
      setShowResetModal(false);
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 4000);
    } catch (error) {
      setResetError(`Database reset failed: ${(error as Error).message}`);
    } finally {
      setIsResetting(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onRestoreDatabase) return;
    setIsRestoring(true);
    setRestoreNotice(null);
    try {
      const buffer = await file.arrayBuffer();
      await onRestoreDatabase(buffer);
      setRestoreNotice('Database successfully restored from backup.');
      setTimeout(() => setRestoreNotice(null), 5000);
    } catch (err) {
      setRestoreNotice(`Restore failed: ${(err as Error).message}`);
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const screenModels: Array<{
    id: PosScreenLayout;
    title: string;
    description: string;
    badge: string;
  }> = [
    {
      id: 'pos',
      title: isRtl ? 'POS - نقطة البيع العادية (باركود وجدول)' : 'POS - Standard Retail Terminal',
      description: isRtl
        ? 'الواجهة الافتراضية مع ماسح الباركود، والبحث السريع، والجدول المفصل للأصناف الممسوحة والدفع المباشر.'
        : 'Current standard retail layout optimized for high-speed barcode scanning, fast SKU search, and line item spreadsheet ticket.',
      badge: isRtl ? 'تجزئة ومحلات' : 'Retail Standard',
    },
    {
      id: 'rpos',
      title: isRtl ? 'RPOS - نقطة بيع المطاعم والمقاهي (كتالوج ومجموعات)' : 'RPOS - Restaurant & Café Touch POS',
      description: isRtl
        ? 'تصميم مخصص للمطاعم والمقاهي: شاشة لمس مع كتالوج مرئي مقسم حسب المجموعات والتصنيفات للاختيار السريع للأطباق والمشروبات.'
        : 'Touchscreen-ready restaurant layout with visual product catalog categorized by food & beverage groups for instant order entry.',
      badge: isRtl ? 'مطاعم ومقاهي' : 'Restaurants & Cafés',
    },
  ];

  const settingsNav = ([
    { id: 'sales',    label: t.secSalesTax,        icon: Percent,   desc: 'Tax modes, rounding, discounts' },
    { id: 'screen',   label: t.secScreenModels,    icon: LayoutGrid, desc: 'Layout & display model' },
    { id: 'store',    label: t.secStoreInfo,       icon: Store,     desc: 'Store info, logo, footer' },
    { id: 'printer',  label: t.secPrintTemplate,   icon: Printer,   desc: 'Paper, A4 template & items' },
    { id: 'users',    label: t.secUsersPerms,      icon: Users,     desc: 'Staff accounts & access' },
    { id: 'database', label: t.secDatabase,        icon: Database,  desc: 'Backup, restore, reset' },
    { id: 'updates',  label: isRtl ? 'التحديثات' : 'Software Updates', icon: RefreshCw, desc: 'Check and install app updates' },
  ] as const).filter((section) => isAppAdmin || !['screen', 'users', 'database'].includes(section.id));

  const activeTemplateSettings = templateSettings(form, selectedTemplate);
  const activeInvoiceMarginsMm = resolveInvoiceMarginsMm(
    selectedTemplate,
    activeTemplateSettings.invoiceMarginsMm
  );
  const invoiceOptions: Array<{
    key: keyof Omit<InvoiceTemplateSettings, 'defaultPrinter' | 'invoiceShowReceiptBarcode'>;
    label: string;
    desc: string;
    val: boolean;
  }> = [
    { key: 'invoiceShowProductName', label: t.showProductName, desc: 'Display English / primary item title', val: activeTemplateSettings.invoiceShowProductName !== false },
    { key: 'invoiceShowProductNameAr', label: t.showProductNameAr, desc: 'Display Arabic item title below name', val: activeTemplateSettings.invoiceShowProductNameAr !== false },
    { key: 'invoiceShowBarcode', label: t.showBarcode, desc: 'Include item SKU/barcode in row', val: activeTemplateSettings.invoiceShowBarcode === true },
    { key: 'invoiceShowCustomerInfo', label: t.showCustomerInfo, desc: 'Customer name and ledger info', val: activeTemplateSettings.invoiceShowCustomerInfo !== false },
    { key: 'invoiceShowCashierName', label: t.showCashierName, desc: 'Cashier operator name on invoice', val: activeTemplateSettings.invoiceShowCashierName !== false },
    { key: 'invoiceShowTaxDetails', label: t.showTaxDetails, desc: 'Subtotal excl. tax & VAT breakdown', val: activeTemplateSettings.invoiceShowTaxDetails !== false },
    { key: 'invoiceShowStoreAddress', label: t.showStoreAddress, desc: 'Store street address & phone number', val: activeTemplateSettings.invoiceShowStoreAddress !== false },
    { key: 'invoiceShowFooter', label: t.showFooter, desc: 'Bilingual thank you footer notice', val: activeTemplateSettings.invoiceShowFooter !== false },
    { key: 'invoiceShowQrCode', label: t.showQrCode, desc: 'Include the electronic invoice QR code', val: activeTemplateSettings.invoiceShowQrCode !== false },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#f3f3f3] text-[#1f1f1f]">
      <nav
        className="shrink-0 bg-[#f3f3f3] px-2 py-3 sm:px-4"
        aria-label="Settings sections"
        role="tablist"
      >
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
          {settingsNav.map((sec) => {
            const Icon = sec.icon;
            const active = activeSettingsSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSettingsSection(sec.id)}
                className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-md border px-2 py-3 text-xs font-semibold transition-colors sm:px-4 ${
                  active
                    ? 'border-[#0f6cbd] bg-[#eaf3ff] text-[#0f6cbd]'
                    : 'border-[#d9d9d9] bg-white text-[#555] hover:border-[#a6a6a6] hover:bg-[#f8f8f8] hover:text-[#1a1a1a]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">

          {/* Main Settings Form */}
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-[#d9d9d9] rounded-md p-4 sm:p-5 space-y-4 text-xs shadow-[0_1px_0_rgba(0,0,0,0.02)]"
          >
            {/* SECTION 1: SALES & TAX SETTINGS */}
            {activeSettingsSection === 'sales' && (
              <div className="space-y-4">
                <div className="rounded-md border border-[#d9d9d9] bg-[#fafafa] p-4">
                  <h2 className="text-[15px] font-semibold text-[#1f1f1f] flex items-center gap-2">
                    <Percent className="w-4 h-4 text-[#0f6cbd]" />
                    <span>Sales & Taxation</span>
                  </h2>
                  <p className="text-xs text-[#666] mt-1">
                    Configure tax modes, rounding rules, and checkout safeguards.
                  </p>
                </div>

                {/* Tax Inclusion Toggle */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-900">
                      Tax Calculation Mode
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Choose whether retail shelf prices already include sales tax or if tax is computed and added on top at checkout.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, taxType: 'exclusive' })}
                      className={`p-3 text-left rounded-md border transition-all ${
                        form.taxType === 'exclusive'
                          ? 'bg-[#edf5ff] border-[#8ab4ff] shadow-[inset_0_0_0_1px_rgba(15,108,189,0.2)]'
                          : 'bg-white border-[#d9d9d9] text-[#444] hover:bg-[#fafafa]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">Tax Exclusive (Added)</span>
                        {form.taxType === 'exclusive' && (
                          <span className="text-blue-700 text-[10px] font-bold uppercase tracking-wider">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Tax is added on top of the subtotal at checkout (Standard in US & Canada).
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setForm({ ...form, taxType: 'inclusive' })}
                      className={`p-3 text-left rounded-md border transition-all ${
                        form.taxType === 'inclusive'
                          ? 'bg-[#edf5ff] border-[#8ab4ff] shadow-[inset_0_0_0_1px_rgba(15,108,189,0.2)]'
                          : 'bg-white border-[#d9d9d9] text-[#444] hover:bg-[#fafafa]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">Tax Inclusive (VAT/GST)</span>
                        {form.taxType === 'inclusive' && (
                          <span className="text-blue-700 text-[10px] font-bold uppercase tracking-wider">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Retail price includes tax. Subtotal and extracted tax breakdown printed on receipt.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-[#333] mb-1">
                      Standard Sales Tax Rate (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={form.taxRate}
                      onFocus={(event) => event.currentTarget.select()}
                      onClick={(event) => event.currentTarget.select()}
                      onChange={(e) =>
                        setForm({ ...form, taxRate: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full px-3 py-2 font-mono border border-[#c9c9c9] rounded-md text-[#1f1f1f] tabular-nums focus:outline-none focus:border-[#0f6cbd] bg-white"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Currency Symbol
                    </label>
                    <input
                      type="text"
                      maxLength={4}
                      value={form.currencySymbol}
                      onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })}
                      className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Default Walk-in Customer Label
                    </label>
                    <input
                      type="text"
                      value={form.defaultCustomer}
                      onChange={(e) => setForm({ ...form, defaultCustomer: e.target.value })}
                      placeholder="Walk-in Customer"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Active Cashier Shift Name
                    </label>
                    <input
                      type="text"
                      value={form.cashierName}
                      onChange={(e) => setForm({ ...form, cashierName: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>
                </div>

                <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {isRtl ? 'طرق الدفع' : 'Payment Methods'}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {isRtl
                        ? 'أضف طرق دفع مخصصة لتظهر عند إتمام البيع.'
                        : 'Add custom payment methods to make them available at checkout.'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      maxLength={40}
                      value={newPaymentMethod}
                      onChange={(event) => {
                        setNewPaymentMethod(event.target.value);
                        setPaymentMethodError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleAddPaymentMethod();
                        }
                      }}
                      placeholder={isRtl ? 'مثال: تحويل بنكي' : 'e.g. Bank Transfer'}
                      aria-label={isRtl ? 'اسم طريقة الدفع الجديدة' : 'New payment method name'}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddPaymentMethod}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                    >
                      <Plus className="h-4 w-4" />
                      {isRtl ? 'إضافة طريقة دفع' : 'Add New Payment Method'}
                    </button>
                  </div>
                  {paymentMethodError && (
                    <p role="alert" className="text-xs text-red-700">{paymentMethodError}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {paymentMethods.map((method) => (
                      <span
                        key={method}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                      >
                        {method}
                        {(method === 'Cash' || method === 'Card' || method === 'Split') && (
                          <span className="text-[10px] text-slate-400">
                            {isRtl ? 'افتراضي' : 'Default'}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {isRtl
                      ? 'احفظ الإعدادات لتطبيق التغييرات.'
                      : 'Save Settings to apply changes.'}
                  </p>
                </section>

                {/* Operational Toggles */}
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider text-slate-500">
                    Checkout & Inventory Safeguards
                  </h3>

                  <label className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.allowNegativeStock}
                      onChange={(e) => setForm({ ...form, allowNegativeStock: e.target.checked })}
                      className="mt-0.5 rounded text-blue-700 focus:ring-blue-700"
                    />
                    <div>
                      <span className="font-semibold text-slate-900 block">
                        Allow Negative Inventory Billing
                      </span>
                      <span className="text-[11px] text-slate-500">
                        When enabled, cashiers can complete sales even if SQLite stock count is zero or uncounted.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.roundTotalToFiveCents}
                      onChange={(e) =>
                        setForm({ ...form, roundTotalToFiveCents: e.target.checked })
                      }
                      className="mt-0.5 rounded text-blue-700 focus:ring-blue-700"
                    />
                    <div>
                      <span className="font-semibold text-slate-900 block">
                        Cash Rounding to Nearest 5 Cents (Swedish Rounding)
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Rounds checkout balance to $0.05 for countries eliminating 1-cent coins.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.barcodeScanBeep}
                      onChange={(e) => setForm({ ...form, barcodeScanBeep: e.target.checked })}
                      className="mt-0.5 rounded text-blue-700 focus:ring-blue-700"
                    />
                    <div>
                      <span className="font-semibold text-slate-900 block">
                        Audio Beep Feedback on Barcode Scan
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Synthesizes a short POS scan tone via Web Audio API whenever an item is added to the cart.
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* SECTION 2: POS SCREEN MODELS */}
            {isAppAdmin && activeSettingsSection === 'screen' && (
              <div className="space-y-4">
                <div className="rounded-md border border-[#d9d9d9] bg-[#fafafa] p-4">
                  <h2 className="text-[15px] font-semibold text-[#1f1f1f] flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-[#0f6cbd]" />
                    <span>{isRtl ? 'نماذج شاشة نقطة البيع' : 'POS Screen Modes'}</span>
                  </h2>
                  <p className="text-xs text-[#666] mt-1">
                    {isRtl
                      ? 'اختر بين نموذج POS القياسي ونموذج RPOS للمطاعم.'
                      : 'Choose the retail or restaurant-friendly interface for your POS workflow.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {screenModels.map((model) => {
                    const isSelected = form.posScreenLayout === model.id || (model.id === 'pos' && form.posScreenLayout !== 'rpos');
                    return (
                      <div
                        key={model.id}
                        onClick={() => handleSelectLayout(model.id)}
                        className={`p-5 rounded-md border cursor-pointer transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-[#edf5ff] border-[#8ab4ff] shadow-[inset_0_0_0_1px_rgba(15,108,189,0.15)]'
                            : 'bg-white border-[#d9d9d9] hover:border-[#b7b7b7]'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-900 text-base">
                              {model.title}
                            </span>
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                                isSelected
                                  ? 'bg-blue-700 text-white shadow-xs'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {model.badge}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                            {model.description}
                          </p>
                        </div>

                        <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                          <span
                            className={
                              isSelected ? 'text-blue-700 font-bold' : 'text-slate-400 font-medium'
                            }
                          >
                            {isSelected ? (isRtl ? '✓ النموذج النشط حالياً' : '✓ Active Layout Model') : (isRtl ? 'انقر للتفعيل' : 'Click to Activate')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SECTION 3: STORE & RECEIPT INFO */}
            {activeSettingsSection === 'store' && (
              <div className="space-y-4">
                <div className="rounded-md border border-[#d9d9d9] bg-[#fafafa] p-4">
                  <h2 className="text-[15px] font-semibold text-[#1f1f1f] flex items-center gap-2">
                    <Store className="w-4 h-4 text-[#0f6cbd]" />
                    <span>Store Profile</span>
                  </h2>
                  <p className="text-xs text-[#666] mt-1">
                    Business identity, contact details, and receipt branding for your store.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Store Name (English) *</label>
                    <input
                      type="text"
                      required
                      value={form.storeName}
                      onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                      placeholder="aptPOS Retail"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Store Name (Arabic) / اسم المتجر بالعربية *
                    </label>
                    <input
                      type="text"
                      dir="rtl"
                      value={form.storeNameAr || ''}
                      onChange={(e) => setForm({ ...form, storeNameAr: e.target.value })}
                      placeholder="كاونترلاين للتجزئة"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      CR Number / رقم السجل التجاري (10 digits)
                    </label>
                    <input
                      type="text"
                      maxLength={10}
                      value={form.crNumber || ''}
                      onChange={(e) => setForm({ ...form, crNumber: e.target.value })}
                      placeholder="1010123456"
                      className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      VAT Number / الرقم الضريبي (15 digits, ZATCA)
                    </label>
                    <input
                      type="text"
                      maxLength={15}
                      value={form.taxId}
                      onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                      placeholder="310123456700003"
                      className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Building No / رقم المبنى</label>
                    <input
                      type="text"
                      value={form.buildingNo || ''}
                      onChange={(e) => setForm({ ...form, buildingNo: e.target.value })}
                      placeholder="1234"
                      className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Street Name / اسم الشارع</label>
                    <input
                      type="text"
                      value={form.streetName || ''}
                      onChange={(e) => setForm({ ...form, streetName: e.target.value })}
                      placeholder="King Fahd Road / طريق الملك فهد"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">District / الحي</label>
                    <input
                      type="text"
                      value={form.district || ''}
                      onChange={(e) => setForm({ ...form, district: e.target.value })}
                      placeholder="Al Olaya / العليا"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">City / المدينة</label>
                    <input
                      type="text"
                      value={form.city || ''}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      placeholder="Riyadh / الرياض"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Postal Code / الرمز البريدي</label>
                    <input
                      type="text"
                      maxLength={5}
                      value={form.postalCode || ''}
                      onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                      placeholder="12211"
                      className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Country / الدولة</label>
                    <input
                      type="text"
                      value={form.country || 'Saudi Arabia'}
                      onChange={(e) => setForm({ ...form, country: e.target.value })}
                      placeholder="Saudi Arabia / المملكة العربية السعودية"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Phone Number / رقم الهاتف</label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+966 11 234 5678"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Full Address Line / العنوان بالكامل
                    </label>
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      placeholder="King Fahd Road, Al Olaya, Riyadh, Saudi Arabia"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Receipt Footer Notice (English)
                    </label>
                    <textarea
                      rows={2}
                      value={form.receiptFooter}
                      onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
                      placeholder="Thank you for your business!"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Receipt Footer Notice (Arabic) / تذييل الفاتورة بالعربية
                    </label>
                    <textarea
                      rows={2}
                      dir="rtl"
                      value={form.receiptFooterAr || ''}
                      onChange={(e) => setForm({ ...form, receiptFooterAr: e.target.value })}
                      placeholder="شكراً لتسوقكم معنا! البضاعة المباعة ترد خلال 7 أيام."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 4: PRINT & INVOICE TEMPLATE SETTINGS */}
            {activeSettingsSection === 'printer' && (
              <div className="space-y-4">
                <div className="rounded-md border border-[#d9d9d9] bg-[#fafafa] p-4">
                  <h2 className="text-[15px] font-semibold text-[#1f1f1f] flex items-center gap-2">
                    <Printer className="w-4 h-4 text-[#0f6cbd]" />
                    <span>{t.printTemplateTitle}</span>
                  </h2>
                  <p className="text-xs text-[#666] mt-1">
                    {t.printTemplateDesc}
                  </p>
                </div>

                <div className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">KOT Printer</h3>
                    <p className="mt-1 text-xs text-slate-600">
                      Print kitchen order tickets to a dedicated printer. System Default is used when none is selected.
                    </p>
                    <label className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={form.enableKot === true}
                        onChange={(event) => setForm((current) => ({ ...current, enableKot: event.target.checked }))}
                        className="rounded text-blue-700 focus:ring-blue-600 border-slate-300"
                      />
                      Enable KOT printing
                    </label>
                    <p className="mt-2 text-xs font-medium text-slate-700">
                      Selected: {form.kotPrinter || 'System Default'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openPrinterDialog('kot')}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Choose KOT Printer
                  </button>
                </div>

                {/* 1. Paper Format Selection (80mm / 58mm / A4) */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-900">
                      {t.paperFormat}
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Choose between standard thermal receipt roll printers or full-page A4 commercial tax invoices.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: '80mm', title: '80mm Roll', desc: 'Standard POS thermal receipt roll', badge: 'Standard POS' },
                      { id: '58mm', title: '58mm Roll', desc: 'Compact portable receipt printer', badge: 'Compact' },
                      { id: 'A4', title: 'A4 Invoice Sheet', desc: 'Full page official tax invoice with table', badge: 'Commercial A4' },
                    ].map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => {
                          const format = fmt.id as PaperWidth;
                          setSelectedTemplate(format);
                          setForm((current) => ({ ...current, paperWidth: format }));
                        }}
                        className={`p-3.5 text-left rounded-md border transition-all cursor-pointer ${
                          selectedTemplate === fmt.id
                            ? 'bg-[#edf5ff] border-[#8ab4ff] shadow-[inset_0_0_0_1px_rgba(15,108,189,0.15)]'
                            : 'bg-white border-[#d9d9d9] text-[#444] hover:bg-[#fafafa]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-xs">{fmt.title}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            selectedTemplate === fmt.id ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {fmt.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
                          {fmt.desc}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Selected template printer */}
                <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-4 shadow-2xs">
                  <p className="text-xs font-semibold text-slate-700">
                    Editing {selectedTemplate} template printer and invoice elements
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-semibold text-slate-800 mb-1">
                        {t.defaultPrinter}
                      </label>
                      <div className="mb-3 space-y-2">
                        {([
                          { value: 'system-default', label: 'Use system default printer' },
                          { value: 'saved-printer', label: 'Use selected template printer' },
                          { value: 'choose-at-print-time', label: 'Choose printer at print time' },
                        ] satisfies Array<{ value: NonNullable<InvoiceTemplateSettings['printerMode']>; label: string }>).map((option) => (
                          <label key={option.value} className="flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="radio"
                              name={`printer-mode-${selectedTemplate}`}
                              checked={(activeTemplateSettings.printerMode || 'system-default') === option.value}
                              onChange={() => updateTemplateSettings(
                                'printerMode',
                                option.value
                              )}
                              className="accent-blue-700"
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          {activeTemplateSettings.defaultPrinter || 'System Default'}
                        </div>
                        <button
                          type="button"
                          onClick={() => openPrinterDialog()}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Choose Printer
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Select an installed printer for “Use selected template printer”.
                      </p>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-800 mb-1">
                        {t.languageSelect}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setLanguage('en');
                            setForm({ ...form, appLanguage: 'en' });
                          }}
                          className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                            language === 'en'
                              ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <Globe className="w-3.5 h-3.5" />
                          <span>English (EN)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLanguage('ar');
                            setForm({ ...form, appLanguage: 'ar' });
                          }}
                          className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                            language === 'ar'
                              ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <Globe className="w-3.5 h-3.5" />
                          <span>العربية (AR)</span>
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Switches interface language and document layout direction (RTL/LTR).
                      </p>
                    </div>
                  </div>

                </div>

                <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs">
                  <label htmlFor="invoice-margin-mm" className="block font-semibold text-slate-800">
                    Invoice Margins (mm)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    {isRtl
                      ? 'الحد الأدنى للهوامش الجانبية والسفلية: ٣ مم للرول الحراري و٥ مم لورق A4. يمكن جعل الهامش العلوي لرول ٨٠ مم صفراً.'
                      : `Minimum safe margins are ${MINIMUM_INVOICE_MARGIN_MM[selectedTemplate]} mm for this format. The top margin for 80mm paper can be 0 mm.`}
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {([
                      { key: 'top', label: 'Top' },
                      { key: 'right', label: 'Right' },
                      { key: 'bottom', label: 'Bottom' },
                      { key: 'left', label: 'Left' },
                    ] as const).map(({ key, label }) => {
                      const minimumMargin =
                        key === 'top' && selectedTemplate === '80mm'
                          ? 0
                          : MINIMUM_INVOICE_MARGIN_MM[selectedTemplate];
                      return (
                        <div key={key}>
                          <label htmlFor={`invoice-margin-${key}`} className="mb-1 block text-xs font-medium text-slate-700">
                            {label}
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              id={`invoice-margin-${key}`}
                              type="number"
                              min={minimumMargin}
                              max="20"
                              step="0.5"
                              value={activeInvoiceMarginsMm[key]}
                              onChange={(event) => {
                                const margin = Number(event.target.value);
                                if (Number.isFinite(margin)) {
                                  updateTemplateSettings('invoiceMarginsMm', {
                                    ...activeInvoiceMarginsMm,
                                    [key]: Math.min(20, Math.max(minimumMargin, margin)),
                                  });
                                }
                              }}
                              className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                            />
                            <span className="text-xs text-slate-500">mm</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Invoice Item Elements Display Options */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-700" />
                      <span>{t.invoiceDisplayOptions}</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {t.invoiceDisplayOptionsDesc}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {invoiceOptions.map((opt) => (
                      <label
                        key={opt.key}
                        className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all cursor-pointer ${
                          opt.val ? 'bg-white border-blue-200 shadow-2xs' : 'bg-white/60 border-slate-200 hover:bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={opt.val}
                          onChange={(e) => updateTemplateSettings(opt.key, e.target.checked)}
                          className="mt-0.5 rounded text-blue-700 focus:ring-blue-600 border-slate-300"
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-slate-800">{opt.label}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 4. Decimal Places (Price & Quantity) */}
                <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs">
                  <label className="block font-semibold text-slate-800">
                    Decimal Places (Price &amp; Quantity)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Number of decimal digits shown in prices and quantities across register, receipts, and invoices.
                  </p>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {[0, 1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setForm({ ...form, decimalPoints: n })}
                        className={`w-10 h-10 rounded-lg border text-sm font-bold transition-all cursor-pointer ${
                          (form.decimalPoints ?? 2) === n
                            ? 'border-blue-700 bg-blue-50 ring-2 ring-blue-700/20 text-blue-700 shadow-2xs'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="text-xs text-slate-400 ml-2 font-mono">
                      Preview: {(9.5).toFixed(form.decimalPoints ?? 2)} / qty {(1).toFixed(form.decimalPoints ?? 2)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 5: DATABASE MAINTENANCE, BACKUP & RESTORE */}
            {isAppAdmin && activeSettingsSection === 'database' && (
              <div className="space-y-4">
                <div className="rounded-md border border-[#d9d9d9] bg-[#fafafa] p-4">
                  <h2 className="text-[15px] font-semibold text-[#1f1f1f] flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#0f6cbd]" />
                    <span>Database & Backup</span>
                  </h2>
                  <p className="text-xs text-[#666] mt-1">
                    Manage your local SQLite POS storage, create backups, restore archives, or reset to defaults.
                  </p>
                </div>

                {restoreNotice && (
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                      restoreNotice.includes('failed')
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    }`}
                  >
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{restoreNotice}</span>
                  </div>
                )}

                {resetSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>Database has been reset and seed catalog successfully restored!</span>
                  </div>
                )}

                {/* Backup & Restore Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Download Backup */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-slate-900 font-semibold mb-1">
                        <Download className="w-4 h-4 text-blue-700" />
                        <span>Export Database Backup</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Download a snapshot copy of your current SQLite database (`pos.sqlite`) including all products, sales history, customers, and configuration.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-200/70">
                      <a
                        href="/api/database/backup"
                        download="aptpos-backup.sqlite"
                        className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 font-semibold rounded-lg shadow-2xs hover:bg-slate-50 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download SQLite Backup</span>
                      </a>
                    </div>
                  </div>

                  {/* Restore from Backup */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-slate-900 font-semibold mb-1">
                        <Upload className="w-4 h-4 text-purple-700" />
                        <span>Restore from Backup</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Upload an existing `.sqlite` backup file to overwrite and replace current store data with the archived records.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-200/70">
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".sqlite,.db"
                        onChange={handleRestoreFile}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 bg-white border border-purple-300 hover:border-purple-400 text-purple-700 font-semibold rounded-lg shadow-2xs hover:bg-purple-50 transition-colors disabled:opacity-50"
                      >
                        {isRestoring ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Restoring Database...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-3.5 h-3.5" />
                            <span>Select Backup File (.sqlite)</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Danger Zone: Reset Database */}
                <div className="p-4 bg-red-50/60 border border-red-200 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-red-100 text-red-700 rounded-lg shrink-0 mt-0.5">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-red-900">
                        Reset Database to Factory Defaults
                      </h3>
                      <p className="text-[11px] text-red-700 mt-1 leading-relaxed">
                        Wipes all transactions, inventory modifications, purchase orders, customer and vendor ledger balances, and resets the terminal back to fresh sample seed data.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setResetError(null);
                        setShowResetModal(true);
                      }}
                      className="px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Database...</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION: USERS & PERMISSIONS */}
            {isAppAdmin && activeSettingsSection === 'users' && (
              <div className="space-y-4">
                <div className="rounded-md border border-[#d9d9d9] bg-[#fafafa] p-4">
                  <h2 className="text-[15px] font-semibold text-[#1f1f1f] flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#0f6cbd]" />
                    <span>Users & Permissions</span>
                  </h2>
                  <p className="text-xs text-[#666] mt-1">
                    Manage staff accounts and assign access to the POS modules they need.
                  </p>
                </div>

                {/* Success banner */}
                {userActionSuccess && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>{userActionSuccess}</span>
                  </div>
                )}

                {/* User list */}
                <div className="space-y-2">
                  {usersLoading ? (
                    <div className="py-8 text-center text-slate-400 text-xs">Loading accounts…</div>
                  ) : usersList.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg">
                      No user accounts found.
                    </div>
                  ) : (
                    usersList.map((u) => {
                      const isAdmin = u.role === 'admin';
                      const isPrimaryAdmin = u.username.toLowerCase() === 'aptadmin';
                      return (
                        <div
                          key={u.id}
                          className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isAdmin ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
                              {isAdmin ? <Shield className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-900 font-mono text-xs">{u.username}</span>
                                <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${
                                  u.role === 'admin'
                                    ? 'bg-blue-100 text-blue-700'
                                    : u.role === 'cashier'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-purple-100 text-purple-700'
                                }`}>
                                  {u.role}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                                {u.displayName}
                                {u.permissions && u.permissions.length > 0 && (
                                  <span className="ml-1.5 text-slate-400">
                                    · {u.permissions.join(', ')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <button
                              type="button"
                              onClick={() => handleOpenEditUser(u)}
                              className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Edit user"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {!isPrimaryAdmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u.id, u.username)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete user"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Add new user button */}
                <button
                  type="button"
                  onClick={handleOpenAddUser}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-sm transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add New Staff Account</span>
                </button>

                {/* Permissions legend */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500 space-y-1">
                  <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <Lock className="w-3 h-3" /> Permission Modules
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <span><span className="font-medium text-slate-700">register</span> — POS Register (checkout)</span>
                    <span><span className="font-medium text-slate-700">sales</span> — Sales history & reports</span>
                    <span><span className="font-medium text-slate-700">inventory</span> — Product catalog & stock</span>
                    <span><span className="font-medium text-slate-700">purchases</span> — Purchase orders</span>
                    <span><span className="font-medium text-slate-700">customers</span> — Customer ledger</span>
                    <span><span className="font-medium text-slate-700">vendors</span> — Vendor accounts</span>
                    <span><span className="font-medium text-slate-700">settings</span> — System settings</span>
                  </div>
                </div>
              </div>
            )}

            {/* Save Buttons */}
            <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
              <div>
                {savedNotice && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <Check className="w-4 h-4" />
                    <span>Configuration saved to SQLite</span>
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
              >
                {saving ? 'Saving...' : 'Save All Settings'}
              </button>
            </div>
          </form>

          {/* Printer status and queue controls belong to the printer settings section. */}
          {activeSettingsSection === 'printer' && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Printer className="w-4 h-4 text-slate-500" />
                  Thermal Hardware
                </h3>
                <div className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${form.printerOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {form.printerOnline ? 'Online' : 'Offline'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => { const next = { ...form, printerOnline: true }; setForm(next); onSaveSettings(next); }}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors ${form.printerOnline ? 'bg-white text-emerald-700 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Online
                </button>
                <button
                  type="button"
                  onClick={() => { const next = { ...form, printerOnline: false }; setForm(next); onSaveSettings(next); }}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors ${!form.printerOnline ? 'bg-white text-amber-700 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Offline
                </button>
              </div>
              {printQueue.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-slate-500 font-mono tabular-nums">{printQueue.length} job{printQueue.length !== 1 ? 's' : ''} queued</span>
                  <button
                    type="button"
                    onClick={onFlushPrintQueue}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-sm"
                  >
                    <Printer className="w-3 h-3" />
                    Print All
                  </button>
                </div>
              )}
            </div>
          )}

        </div>{/* /max-w-3xl */}
      </div>{/* /main content */}

      {/* Reset Database Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Confirm Database Reset</h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-red-50 p-3 rounded-lg border border-red-100">
              Are you sure you want to completely reset the database? All sales transactions, inventory records, purchase orders, and customers will be cleared and restored to default factory seed data.
            </p>

            {resetError && (
              <p role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
                {resetError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isResetting}
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={handleConfirmReset}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isResetting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Resetting...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Yes, Reset Database</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSettingsSection === 'updates' && (
        <div className="space-y-5">
          <header className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-900 p-6 text-white shadow-lg">
            <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-blue-400/20 blur-3xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
                  <RefreshCw className="h-6 w-6 text-cyan-200" />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">
                    {isRtl ? 'مركز التحديثات' : 'UPDATE CENTER'}
                  </p>
                  <h2 className="mt-1 text-xl font-bold tracking-tight">
                    {isRtl ? 'تحديثات aptPOS' : 'aptPOS Software Updates'}
                  </h2>
                  <p className="mt-1 max-w-xl text-xs leading-relaxed text-blue-100/80">
                    {isRtl
                      ? 'تحقق من إصدارات GitHub الجديدة، واعرض التغييرات، ثم ثبّت التحديث عند جاهزيته.'
                      : 'Check GitHub for new releases, review what changed, and install when the update is ready.'}
                  </p>
                </div>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                GitHub Releases
              </span>
            </div>
          </header>

          {!window.electronAPI?.checkForUpdates ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900" role="status">
              {isRtl
                ? 'التحقق من التحديثات متاح في تطبيق سطح المكتب فقط.'
                : 'Update checks are available in the installed desktop app only.'}
            </p>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    updateStatus.state === 'error'
                      ? 'bg-red-50 text-red-600'
                      : updateStatus.state === 'up-to-date' || updateStatus.state === 'downloaded'
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-blue-50 text-blue-700'
                  }`}>
                    {updateStatus.state === 'up-to-date' || updateStatus.state === 'downloaded'
                      ? <Check className="h-4 w-4" />
                      : <RefreshCw className={`h-4 w-4 ${updateStatus.state === 'checking' ? 'animate-spin' : ''}`} />}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-bold ${
                      updateStatus.state === 'error' || updateActionError
                        ? 'text-red-700'
                        : updateStatus.state === 'up-to-date' || updateStatus.state === 'downloaded'
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                    }`} role="status">
                      {updateActionError || (() => {
                        switch (updateStatus.state) {
                          case 'checking':
                            return isRtl ? 'جارٍ التحقق من التحديثات...' : 'Checking for updates...';
                          case 'available':
                            return isRtl
                              ? `يتوفر الإصدار ${updateStatus.version}، جارٍ بدء التنزيل...`
                              : `Version ${updateStatus.version} is available. Starting download...`;
                          case 'downloading':
                            return isRtl
                              ? `جارٍ تنزيل الإصدار ${updateStatus.version}...`
                              : `Downloading version ${updateStatus.version}...`;
                          case 'downloaded':
                            return isRtl
                              ? `الإصدار ${updateStatus.version} جاهز للتثبيت.`
                              : `Version ${updateStatus.version} is ready to install.`;
                          case 'up-to-date':
                            return isRtl
                              ? `التطبيق محدّث بالفعل (${updateStatus.version}).`
                              : `aptPOS is up to date (${updateStatus.version}).`;
                          case 'installing':
                            return isRtl
                              ? 'جارٍ تثبيت التحديث وإعادة تشغيل aptPOS...'
                              : 'Installing the update and restarting aptPOS...';
                          case 'error':
                            return updateStatus.message;
                          default:
                            return isRtl
                              ? 'تحقق من GitHub للحصول على أحدث إصدار.'
                              : 'Ready to check for the latest aptPOS release.';
                        }
                      })()}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      {isRtl
                        ? 'ستظهر هنا ملاحظات الإصدار عند توفر تحديث.'
                        : 'Release notes appear here when an update is available.'}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={handleCheckForUpdates}
                    disabled={
                      updateStatus.state === 'checking' ||
                      updateStatus.state === 'available' ||
                      updateStatus.state === 'downloading' ||
                      updateStatus.state === 'installing' ||
                      updateStatus.state === 'downloaded'
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-xs font-bold text-blue-800 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${updateStatus.state === 'checking' ? 'animate-spin' : ''}`} />
                    {isRtl ? 'تحقق من التحديثات' : 'Check for Updates'}
                  </button>
                  {updateStatus.state === 'downloaded' && (
                    <button
                      type="button"
                      onClick={handleInstallUpdate}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-800"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {isRtl ? 'تثبيت وإعادة التشغيل' : 'Install & Restart'}
                    </button>
                  )}
                </div>
              </div>

              {updateStatus.state === 'downloading' && (
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="mb-2 flex justify-between text-[11px] font-semibold text-slate-600">
                    <span>{isRtl ? 'تنزيل التحديث' : 'Downloading update'}</span>
                    <span>{Math.round(updateStatus.percent)}%</span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-label={isRtl ? 'تقدم تنزيل التحديث' : 'Update download progress'}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(updateStatus.percent)}
                  >
                    <div
                      className="h-full rounded-full bg-blue-600 transition-[width]"
                      style={{ width: `${updateStatus.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {(updateStatus.state === 'available' ||
                updateStatus.state === 'downloading' ||
                updateStatus.state === 'downloaded') && (
                <div className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                      {isRtl ? `ما الجديد في الإصدار ${updateStatus.version}` : `What's new in v${updateStatus.version}`}
                    </h3>
                    <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">
                      {isRtl ? 'تحديث جديد' : 'NEW RELEASE'}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">
                      {updateStatus.releaseNotes ||
                        (isRtl ? 'لم يضف هذا الإصدار ملاحظات تغيير.' : 'No release notes were provided for this release.')}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ===== User Add/Edit Modal ===== */}
      {userModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                  {editingUser ? <Edit2 className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingUser ? `Edit — ${editingUser.username}` : 'Create New Staff Account'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {editingUser ? 'Update credentials and access permissions.' : 'Set up login credentials and access control.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveUser} className="p-5 space-y-4 text-xs">
              {userFormError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{userFormError}</span>
                </div>
              )}

              {/* Username + Display Name */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">
                    Username <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    required
                    value={userFormData.username}
                    onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                    disabled={editingUser?.username.toLowerCase() === 'aptadmin'}
                    placeholder="e.g. john_cashier"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">Display Name</label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={userFormData.displayName}
                    onChange={(e) => setUserFormData({ ...userFormData, displayName: e.target.value })}
                    placeholder="e.g. John (Front Desk)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1">
                <label className="block font-semibold text-slate-700">
                  Password {editingUser ? <span className="text-slate-400 font-normal">(leave blank to keep current)</span> : <span className="text-red-500">*</span>}
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={userFormData.password}
                  onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                  placeholder={editingUser ? '••••••••' : 'Enter password'}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Role */}
              <div className="space-y-1">
                <label className="block font-semibold text-slate-700">Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['admin', 'cashier', 'custom'] as const).map((role) => (
                    <button
                      key={role}
                      type="button"
                      disabled={editingUser?.username.toLowerCase() === 'aptadmin'}
                      onClick={() => setUserFormData({
                        ...userFormData,
                        role,
                        permissions: role === 'admin'
                          ? ['register', 'inventory', 'purchases', 'customers', 'vendors', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'settings']
                          : role === 'cashier'
                          ? ['register', 'sales']
                          : userFormData.permissions,
                      })}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold capitalize transition-all ${
                        userFormData.role === role
                          ? role === 'admin'
                            ? 'bg-blue-700 text-white border-blue-700'
                            : role === 'cashier'
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                      } disabled:opacity-60`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              {/* Permissions (only for custom / cashier roles) */}
              {userFormData.role !== 'admin' && (
                <div className="space-y-2">
                  <label className="block font-semibold text-slate-700">
                    Access Permissions
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    {(['register', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'inventory', 'purchases', 'customers', 'vendors', 'settings'] as const).map((perm) => {
                      const checked = userFormData.permissions.includes(perm);
                      return (
                        <label key={perm} className="flex items-center gap-2 cursor-pointer select-none py-1 px-2 hover:bg-slate-100 rounded-lg">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              let next = checked
                                ? userFormData.permissions.filter((p) => p !== perm)
                                : [...userFormData.permissions, perm];
                              if (perm === 'edit-sales' && !checked) {
                                next = [...new Set([...next, 'register', 'sales'])];
                              } else if (
                                (perm === 'sales-return' ||
                                  perm === 'manage-sales-returns' ||
                                  perm === 'delete-sales') &&
                                !checked
                              ) {
                                next = [...new Set([...next, 'sales'])];
                                if (perm === 'manage-sales-returns') {
                                  next = [...new Set([...next, 'sales-return'])];
                                }
                              } else if (perm === 'sales-return' && checked) {
                                next = next.filter((p) => p !== 'manage-sales-returns');
                              } else if (perm === 'register' && checked) {
                                next = next.filter((p) => p !== 'edit-sales');
                              } else if (perm === 'sales' && checked) {
                                next = next.filter(
                                  (p) =>
                                    p !== 'edit-sales' &&
                                    p !== 'sales-return' &&
                                    p !== 'manage-sales-returns' &&
                                    p !== 'delete-sales'
                                );
                              }
                              setUserFormData({ ...userFormData, permissions: next });
                            }}
                            className="w-3.5 h-3.5 accent-blue-700"
                          />
                          <span className="font-medium text-slate-700 capitalize">
                            {perm === 'edit-sales'
                              ? 'Edit Sales'
                              : perm === 'sales-return'
                                ? 'Sales Return'
                                : perm === 'manage-sales-returns'
                                  ? 'Manage Sales Returns'
                                : perm === 'delete-sales'
                                  ? 'Delete Sales'
                                  : perm}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Edit Sales requires Register and Sales History access. Sales Return, Manage Sales Returns, and Delete Sales require Sales History access.
                  </p>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={userFormSaving}
                  onClick={() => setUserModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={userFormSaving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {userFormSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{editingUser ? 'Save Changes' : 'Create Account'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {printerDialogOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPrinterDialogOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="printer-dialog-title"
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 id="printer-dialog-title" className="text-sm font-bold text-slate-900">
                  {printerDialogTarget === 'kot' ? 'Select KOT Printer' : 'Select a Printer'}
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {printerDialogTarget === 'kot'
                    ? 'Available system printers for kitchen order tickets'
                    : `Available system printers for ${selectedTemplate}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrinterDialogOpen(false)}
                aria-label="Close printer selection"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-80 space-y-1 overflow-y-auto p-3">
              <button
                type="button"
                onClick={() => selectPrinter('')}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-xs ${
                  !(printerDialogTarget === 'kot' ? form.kotPrinter : activeTemplateSettings.defaultPrinter)
                    ? 'border-blue-300 bg-blue-50 text-blue-900'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>System Default</span>
                {!(printerDialogTarget === 'kot' ? form.kotPrinter : activeTemplateSettings.defaultPrinter) && (
                  <Check className="h-4 w-4" />
                )}
              </button>

              {printersLoading && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading available printers...
                </div>
              )}
              {!printersLoading && printerListError && (
                <p role="alert" className="px-2 py-4 text-center text-xs text-rose-600">
                  {printerListError}
                </p>
              )}
              {!printersLoading && !printerListError && availablePrinters.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-slate-500">
                  No printers were found on this system.
                </p>
              )}
              {!printersLoading && availablePrinters.map((printer) => (
                <button
                  type="button"
                  key={printer.name}
                  onClick={() => selectPrinter(printer.name)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-xs ${
                    (printerDialogTarget === 'kot' ? form.kotPrinter : activeTemplateSettings.defaultPrinter) === printer.name
                      ? 'border-blue-300 bg-blue-50 text-blue-900'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{printer.displayName || printer.name}</span>
                    {printer.displayName && printer.displayName !== printer.name && (
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">{printer.name}</span>
                    )}
                  </span>
                  {(printerDialogTarget === 'kot' ? form.kotPrinter : activeTemplateSettings.defaultPrinter) === printer.name && (
                    <Check className="ml-3 h-4 w-4 shrink-0" />
                  )}
                </button>
              ))}
            </div>
            <footer className="flex justify-between border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => void loadAvailablePrinters()}
                disabled={printersLoading}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${printersLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setPrinterDialogOpen(false)}
                className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
};
