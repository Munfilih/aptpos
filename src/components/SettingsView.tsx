import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Save,
  Store,
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
  Eye,
  X,
  Plus,
  Lock,
  UserCheck,
  Monitor,
  Moon,
  FileText,
  Globe,
  Printer,
  Sun,
} from 'lucide-react';
import type {
  AppScreenMode,
  AppVersion,
  PaperWidth,
  PrintDocumentType,
  StoreSettings,
  SettingsSectionId,
  TaxType,
  ThemeMode,
  UserAccount,
  VersionComponentPolicies,
} from '../types/pos';
import { APP_COMPONENTS, APP_VERSIONS } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { BUILT_IN_PAYMENT_METHODS, getPaymentMethods } from '../utils/paymentMethods';
import { APP_SCREEN_MODE_STORAGE_KEY } from '../utils/appScreenMode';
import {
  PRINT_DOCUMENT_OPTIONS,
  getPrintDocumentFormat,
  getPrintFormats,
  getPrintTemplates,
} from '../printTemplates/catalog';
import { resolveInvoiceMarginsMm } from '../utils/thermalPrinting';
import { translateEnglishToArabic } from '../utils/arabicTranslate';
import { PrintPreviewFrame } from './PrintPreviewFrame';
import { createPrintTemplateJob, printTemplateJob } from '../printTemplates/render';
import type { PrintDocumentData, PrintTemplateJob } from '../printTemplates/types';
import QRCode from 'qrcode';
import type { UpdateStatus } from '../../electron/updateStatus';

interface SettingsViewProps {
  settings: StoreSettings;
  appScreenMode: AppScreenMode;
  onAppScreenModeChange: (mode: AppScreenMode) => void;
  activeSection: SettingsSectionId;
  onActiveSectionChange: (section: SettingsSectionId) => void;
  showSectionNavigation?: boolean;
  isAppAdmin: boolean;
  canRegisterSystem: boolean;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  iconOnlyLauncher: boolean;
  onIconOnlyLauncherChange: (enabled: boolean) => void;
  onSaveLauncherBackground: (dataUrl: string) => Promise<void>;
  onSaveSettings: (updated: StoreSettings) => Promise<void>;
  onActivateVersion: (input: {
    appVersion: AppVersion;
    password: string;
  }) => Promise<void>;
  onActivateRegistrationKey: (registrationKey: string) => Promise<{
    username: string;
    appVersion: AppVersion;
  }>;
  onLoadVersionComponentPolicies: () => Promise<VersionComponentPolicies>;
  onResetDatabase?: (password: string) => Promise<void>;
  onRestoreDatabase?: (buffer: ArrayBuffer) => Promise<void>;
}

type BackupMode = 'on-close' | 'manual' | 'scheduled';
type UpdateSettingsPanel = 'software' | 'version';
type CardDimensionField =
  | 'productCardWidthIn'
  | 'productCardHeightIn'
  | 'categoryCardWidthIn'
  | 'categoryCardHeightIn';

function formatRegistrationDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return value;
  }
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

const CARD_DIMENSION_DEFAULTS: Record<CardDimensionField, number> = {
  productCardWidthIn: 2,
  productCardHeightIn: 3,
  categoryCardWidthIn: 2,
  categoryCardHeightIn: 3,
};

const MAX_STORE_LOGO_FILE_SIZE = 1_000_000;
const STORE_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LAUNCHER_BACKGROUND_FILE_SIZE = 5_000_000;

async function buildSamplePrintDocumentData(
  currentForm: StoreSettings,
  docType: PrintDocumentType,
  label: string,
  isRtl: boolean
): Promise<PrintDocumentData> {
  const currency = currentForm.currencySymbol || 'SAR';
  const nowStr = new Date().toLocaleString(isRtl ? 'ar-SA' : 'en-GB');
  let qrDataUrl: string | undefined;
  if (
    currentForm.invoiceShowQrCode !== false &&
    (docType === 'sales-invoice' || docType === 'sales-return')
  ) {
    qrDataUrl = await QRCode.toDataURL('aptPOS-Sample-ZATCA-QR-Preview', {
      width: 220,
      margin: 1,
    });
  }

  const isKot = docType === 'kot';
  const enFooter = (currentForm.receiptFooter ?? '').trim() || 'Thank you for your business!';
  const arFooter = (currentForm.receiptFooterAr ?? '').trim();
  const resolvedFooter =
    currentForm.multiLanguageInvoices && arFooter
      ? `${enFooter}\n${arFooter}`
      : isRtl && arFooter
        ? arFooter
        : enFooter;

  return {
    documentType: docType,
    title:
      docType === 'sales-invoice'
        ? currentForm.multiLanguageInvoices
          ? 'Simplified Tax Invoice / فاتورة ضريبية مبسطة'
          : 'Simplified Tax Invoice'
        : docType === 'cash-receipt'
          ? 'Cash Receipt / إيصال نقدي'
          : docType === 'bank-receipt'
            ? 'Bank Receipt / إيصال بنكي'
            : docType === 'sales-return'
              ? currentForm.multiLanguageInvoices
                ? 'Sales Return / مرتجع مبيعات'
                : 'Sales Return'
              : docType === 'kot'
                ? 'KOT'
                : label,
    number:
      docType === 'sales-return'
        ? 'SR-2026-1001'
        : docType === 'kot'
          ? 'KOT-1001'
          : 'RCP-2026-1001',
    date: nowStr,
    companyName: currentForm.storeName || 'aptPOS Retail',
    companyNameAr: currentForm.storeNameAr,
    companyAddress: currentForm.address,
    companyPhone: currentForm.phone,
    companyTaxId: currentForm.taxId,
    companyCrNumber: currentForm.crNumber,
    companyLogo: currentForm.invoiceShowStoreLogo !== false ? currentForm.storeLogoDataUrl : undefined,
    logoSizeMm: currentForm.invoiceLogoSizeMm,
    qrDataUrl,
    qrSizeMm: currentForm.invoiceQrCodeSizeMm,
    multiLanguage: Boolean(currentForm.multiLanguageInvoices),
    direction: isRtl ? 'rtl' : 'ltr',
    fields: isKot
      ? [
          { label: 'Order', value: 'Dine-In · Table 4' },
          { label: 'Cashier', value: currentForm.cashierName || 'Cashier' },
        ]
      : [
          {
            label: currentForm.multiLanguageInvoices ? 'Customer / العميل' : 'Customer',
            value: currentForm.defaultCustomer || 'Walk-in Customer',
          },
          {
            label: currentForm.multiLanguageInvoices ? 'Payment / الدفع' : 'Payment',
            value: 'Cash',
          },
        ],
    columns: isKot ? ['Item', 'Qty'] : ['#', 'Item', 'Qty', 'Total'],
    numericColumns: isKot ? [1] : [2, 3],
    rows: isKot
      ? [
          { values: ['Chicken Shawarma Wrap\nشاورما دجاج\nNo garlic · Extra spicy', '2'] },
          { values: ['Fresh Orange Juice\nعصير برتقال طازج', '1'] },
        ]
      : [
          {
            values: [
              '1',
              currentForm.multiLanguageInvoices
                ? 'Premium Basmati Rice 10Kg\nأرز بسمتي فاخر 10 كجم'
                : 'Premium Basmati Rice 10Kg',
              '2',
              `${currency} 40.00`,
            ],
          },
          {
            values: [
              '2',
              currentForm.multiLanguageInvoices
                ? 'Extra Virgin Olive Oil 1L\nزيت زيتون بكر ممتاز 1 لتر'
                : 'Extra Virgin Olive Oil 1L',
              '1',
              `${currency} 17.50`,
            ],
          },
        ],
    totals: isKot
      ? []
      : [
          {
            label: currentForm.multiLanguageInvoices ? 'Subtotal / المجموع الفرعي' : 'Subtotal',
            value: `${currency} 50.00`,
          },
          {
            label: currentForm.multiLanguageInvoices
              ? `VAT (${currentForm.taxRate}%) / الضريبة`
              : `VAT (${currentForm.taxRate}%)`,
            value: `${currency} 7.50`,
          },
          {
            label: currentForm.multiLanguageInvoices ? 'Total / الإجمالي' : 'Total',
            value: `${currency} 57.50`,
          },
        ],
    footer: currentForm.invoiceShowFooter !== false ? resolvedFooter : undefined,
  };
}

function readImageDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The selected logo could not be read.'));
    };
    reader.onerror = () => reject(reader.error || new Error('The selected logo could not be read.'));
    reader.onabort = () => reject(new Error('Reading the selected logo was cancelled.'));
    reader.readAsDataURL(file);
  });
}

function resolveCardDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeCardDimensionSettings(settings: StoreSettings): StoreSettings {
  return {
    ...settings,
    productCardWidthIn: resolveCardDimension(settings.productCardWidthIn, CARD_DIMENSION_DEFAULTS.productCardWidthIn),
    productCardHeightIn: resolveCardDimension(settings.productCardHeightIn, CARD_DIMENSION_DEFAULTS.productCardHeightIn),
    categoryCardWidthIn: resolveCardDimension(settings.categoryCardWidthIn, CARD_DIMENSION_DEFAULTS.categoryCardWidthIn),
    categoryCardHeightIn: resolveCardDimension(settings.categoryCardHeightIn, CARD_DIMENSION_DEFAULTS.categoryCardHeightIn),
  };
}

function getCardDimensionInputs(settings: StoreSettings): Record<CardDimensionField, string> {
  const normalizedSettings = normalizeCardDimensionSettings(settings);
  return {
    productCardWidthIn: String(normalizedSettings.productCardWidthIn),
    productCardHeightIn: String(normalizedSettings.productCardHeightIn),
    categoryCardWidthIn: String(normalizedSettings.categoryCardWidthIn),
    categoryCardHeightIn: String(normalizedSettings.categoryCardHeightIn),
  };
}

interface SettingsSectionTabsProps {
  activeSection: SettingsSectionId | null;
  isAppAdmin: boolean;
  onSelect: (section: SettingsSectionId) => void;
}

export const SettingsSectionTabs: React.FC<SettingsSectionTabsProps> = ({
  activeSection,
  isAppAdmin,
  onSelect,
}) => {
  const { t, isRtl } = useLanguage();
  const allSections: Array<{
    id: SettingsSectionId;
    label: string;
  }> = [
    { id: 'general', label: isRtl ? 'عام' : 'General' },
    { id: 'business', label: isRtl ? 'الأعمال' : 'Business' },
    { id: 'billing', label: isRtl ? 'الفوترة' : 'Billing' },
    { id: 'zatca', label: isRtl ? 'الفوترة الإلكترونية' : 'E-Invoicing' },
    { id: 'print', label: isRtl ? 'الطباعة' : 'Print' },
    { id: 'customers', label: isRtl ? 'العملاء' : 'Customers' },
    { id: 'payment', label: isRtl ? 'الدفع' : 'Payment' },
    { id: 'database', label: isRtl ? t.secDatabase : 'Database' },
    { id: 'registration', label: isRtl ? 'التسجيل' : 'Registration' },
    { id: 'updates', label: isRtl ? 'التحديثات' : 'Updates' },
    { id: 'users', label: isRtl ? t.secUsersPerms : 'Users' },
  ];
  return (
    <div className="settings-section-tabs">
      {allSections
        .filter((section) => isAppAdmin || section.id !== 'users')
        .map((section) => {
        const active = activeSection === section.id;
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(section.id)}
            title={section.label}
            className={`settings-section-tab${active ? ' is-active' : ''}`}
          >
            {section.label}
          </button>
        );
      })}
    </div>
  );
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  appScreenMode,
  onAppScreenModeChange,
  activeSection,
  onActiveSectionChange,
  showSectionNavigation = true,
  isAppAdmin,
  canRegisterSystem,
  theme,
  onThemeChange,
  iconOnlyLauncher,
  onIconOnlyLauncherChange,
  onSaveLauncherBackground,
  onSaveSettings,
  onActivateVersion,
  onActivateRegistrationKey,
  onLoadVersionComponentPolicies,
  onResetDatabase,
  onRestoreDatabase,
}) => {
  const { t, language, setLanguage, isRtl } = useLanguage();
  const [form, setForm] = useState<StoreSettings>(() => normalizeCardDimensionSettings(settings));
  const [cardDimensionInputs, setCardDimensionInputs] = useState<Record<CardDimensionField, string>>(
    () => getCardDimensionInputs(settings)
  );
  const activeSettingsSection = activeSection;
  const settingsViewRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [versionActivationOpen, setVersionActivationOpen] = useState(false);
  const [policyVersion, setPolicyVersion] = useState<AppVersion>(settings.appVersion || 'Standard');
  const [versionPolicies, setVersionPolicies] = useState<VersionComponentPolicies>({});
  const [versionPolicyLoading, setVersionPolicyLoading] = useState(false);
  const [versionPoliciesLoaded, setVersionPoliciesLoaded] = useState(false);
  const [versionPolicyLoadAttempt, setVersionPolicyLoadAttempt] = useState(0);
  const [versionPolicyError, setVersionPolicyError] = useState<string | null>(null);
  const [versionAdminPassword, setVersionAdminPassword] = useState('');
  const [versionActivationBusy, setVersionActivationBusy] = useState(false);
  const [versionActivationError, setVersionActivationError] = useState<string | null>(null);
  const [versionActivationNotice, setVersionActivationNotice] = useState(false);
  const [registrationKey, setRegistrationKey] = useState('');
  const [registrationKeyBusy, setRegistrationKeyBusy] = useState(false);
  const [registrationKeyError, setRegistrationKeyError] = useState<string | null>(null);
  const [registrationKeySuccess, setRegistrationKeySuccess] = useState<string | null>(null);
  const [systemCode, setSystemCode] = useState('');
  const [loadingSystemCode, setLoadingSystemCode] = useState(false);
  const [systemCodeError, setSystemCodeError] = useState<string | null>(null);
  const [systemCodeCopied, setSystemCodeCopied] = useState(false);
  const [newPaymentMethod, setNewPaymentMethod] = useState('');
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<string | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetAdminPassword, setResetAdminPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [updateSettingsPanel, setUpdateSettingsPanel] = useState<UpdateSettingsPanel>('software');
  const [updateActionError, setUpdateActionError] = useState<string | null>(null);
  const [selectedScreenMode, setSelectedScreenMode] = useState<AppScreenMode>(appScreenMode);
  const [screenModeActionBusy, setScreenModeActionBusy] = useState(false);
  const [screenModeActionError, setScreenModeActionError] = useState<string | null>(null);
  const [screenModeApplied, setScreenModeApplied] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [backupDirectory, setBackupDirectory] = useState<string | null>(null);
  const [backupActionError, setBackupActionError] = useState<string | null>(null);
  const [backupActionNotice, setBackupActionNotice] = useState<string | null>(null);
  const [backupActionBusy, setBackupActionBusy] = useState(false);
  const [backupMode, setBackupMode] = useState<BackupMode>('on-close');
  const [scheduledBackupTime, setScheduledBackupTime] = useState('02:00');
  const [backupSettingsBusy, setBackupSettingsBusy] = useState(false);
  const [googleDriveStatus, setGoogleDriveStatus] = useState<{
    clientId: string;
    connected: boolean;
  } | null>(null);
  const [googleDriveClientId, setGoogleDriveClientId] = useState('');
  const [availablePrinters, setAvailablePrinters] = useState<Array<{ name: string; displayName: string }>>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [voucherPreview, setVoucherPreview] = useState<{
    title: string;
    format: PaperWidth;
    job: PrintTemplateJob;
  } | null>(null);
  const [voucherPreviewLoading, setVoucherPreviewLoading] = useState<PrintDocumentType | null>(null);
  const [voucherPreviewPrinting, setVoucherPreviewPrinting] = useState(false);
  const [voucherPreviewError, setVoucherPreviewError] = useState<string | null>(null);
  const [expandedVoucher, setExpandedVoucher] = useState<PrintDocumentType | null>(null);
  const [marginDrafts, setMarginDrafts] = useState<Record<string, string>>({});
  const [translatingStoreNameAr, setTranslatingStoreNameAr] = useState(false);
  const [livePreviewDocType, setLivePreviewDocType] = useState<PrintDocumentType>('sales-invoice');
  const [livePreviewState, setLivePreviewState] = useState<{
    format: PaperWidth;
    job: PrintTemplateJob | null;
    loading: boolean;
    error: string | null;
  }>({ format: '80mm', job: null, loading: false, error: null });
  const [livePreviewPrinting, setLivePreviewPrinting] = useState(false);

  const handlePreviewVoucher = async (
    docType: PrintDocumentType,
    label: string,
    format: PaperWidth,
    templateId: string
  ) => {
    setLivePreviewDocType(docType);
    setVoucherPreviewLoading(docType);
    setVoucherPreviewError(null);
    try {
      const sampleData = await buildSamplePrintDocumentData(form, docType, label, isRtl);
      const job = await createPrintTemplateJob(sampleData, form, format, templateId);
      setVoucherPreview({ title: `${label} (${format})`, format, job });
    } catch (err) {
      setVoucherPreviewError(err instanceof Error ? err.message : 'Failed to generate preview.');
    } finally {
      setVoucherPreviewLoading(null);
    }
  };

  useEffect(() => {
    if (activeSettingsSection !== 'print') return;
    let cancelled = false;
    const option =
      PRINT_DOCUMENT_OPTIONS.find((item) => item.id === livePreviewDocType) ??
      PRINT_DOCUMENT_OPTIONS[0];
    const activeFormat = getPrintDocumentFormat(
      form,
      option.id,
      appScreenMode === 'flyerp' && option.id === 'sales-invoice'
        ? 'A4'
        : form.paperWidth || '80mm'
    );
    const templates = getPrintTemplates(option.id, activeFormat);
    const configuredTemplateId = form.printDocumentProfiles?.[option.id]?.[activeFormat]?.templateId;
    const selectedTemplateId = templates.some((t) => t.id === configuredTemplateId)
      ? configuredTemplateId
      : templates[0]?.id;

    setLivePreviewState((prev) => ({
      ...prev,
      format: activeFormat,
      loading: true,
      error: null,
    }));

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const sampleData = await buildSamplePrintDocumentData(
            form,
            option.id,
            option.label,
            isRtl
          );
          const job = await createPrintTemplateJob(
            sampleData,
            form,
            activeFormat,
            selectedTemplateId
          );
          if (cancelled) return;
          setLivePreviewState({
            format: activeFormat,
            job,
            loading: false,
            error: null,
          });
        } catch (err) {
          if (cancelled) return;
          setLivePreviewState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to update live preview.',
          }));
        }
      })();
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeSettingsSection,
    livePreviewDocType,
    isRtl,
    form.paperWidth,
    form.printDocumentFormats,
    form.printDocumentProfiles,
    form.invoiceShowFooter,
    form.receiptFooter,
    form.receiptFooterAr,
    form.invoiceShowStoreLogo,
    form.invoiceLogoSizeMm,
    form.invoiceShowQrCode,
    form.invoiceQrCodeSizeMm,
    form.invoiceMarginsMm,
    form.multiLanguageInvoices,
    form.storeName,
    form.storeNameAr,
    form.address,
    form.phone,
    form.taxId,
    form.crNumber,
    form.storeLogoDataUrl,
    form.currencySymbol,
    form.taxRate,
    form.defaultCustomer,
    form.cashierName,
  ]);

  const loadPrinters = async () => {
    if (!window.electronAPI?.listPrinters) return;
    setLoadingPrinters(true);
    try {
      const printers = await window.electronAPI.listPrinters();
      setAvailablePrinters(Array.isArray(printers) ? printers : []);
    } catch {
      setAvailablePrinters([]);
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    if (activeSettingsSection === 'print') {
      void loadPrinters();
    }
  }, [activeSettingsSection]);
  const [googleDriveBusy, setGoogleDriveBusy] = useState(false);
  const [googleDriveError, setGoogleDriveError] = useState<string | null>(null);
  const [googleDriveNotice, setGoogleDriveNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeLogoInputRef = useRef<HTMLInputElement>(null);
  const launcherBackgroundInputRef = useRef<HTMLInputElement>(null);
  const [storeLogoError, setStoreLogoError] = useState<string | null>(null);
  const [launcherBackgroundError, setLauncherBackgroundError] = useState<string | null>(null);
  const [launcherBackgroundSaving, setLauncherBackgroundSaving] = useState(false);

  useEffect(() => {
    setSelectedScreenMode(appScreenMode);
  }, [appScreenMode]);

  const handleStoreLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    setStoreLogoError(null);
    if (!file) return;
    if (!STORE_LOGO_MIME_TYPES.has(file.type)) {
      setStoreLogoError(isRtl
        ? 'اختر صورة بصيغة PNG أو JPEG أو WebP.'
        : 'Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_STORE_LOGO_FILE_SIZE) {
      setStoreLogoError(isRtl
        ? 'يجب ألا يتجاوز حجم الشعار 1 ميجابايت.'
        : 'The logo must be 1 MB or smaller.');
      return;
    }

    try {
      const dataUrl = await readImageDataUrl(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The selected file is not a valid image.'));
        image.src = dataUrl;
      });
      if (
        image.naturalWidth > 4096 ||
        image.naturalHeight > 4096 ||
        image.naturalWidth * image.naturalHeight > 16_000_000
      ) {
        throw new Error('Choose a logo image no larger than 4096 × 4096 pixels.');
      }
      setForm((current) => ({ ...current, storeLogoDataUrl: dataUrl }));
    } catch (error) {
      setStoreLogoError(error instanceof Error ? error.message : 'The selected logo could not be loaded.');
    }
  };

  const handleLauncherBackgroundChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    setLauncherBackgroundError(null);
    if (!file) return;
    if (!STORE_LOGO_MIME_TYPES.has(file.type)) {
      setLauncherBackgroundError(isRtl
        ? 'اختر صورة بصيغة PNG أو JPEG أو WebP.'
        : 'Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_LAUNCHER_BACKGROUND_FILE_SIZE) {
      setLauncherBackgroundError(isRtl
        ? 'يجب ألا يتجاوز حجم صورة الخلفية 5 ميجابايت.'
        : 'The background image must be 5 MB or smaller.');
      return;
    }

    setLauncherBackgroundSaving(true);
    try {
      const dataUrl = await readImageDataUrl(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The selected file is not a valid image.'));
        image.src = dataUrl;
      });
      if (
        image.naturalWidth > 8192 ||
        image.naturalHeight > 8192 ||
        image.naturalWidth * image.naturalHeight > 40_000_000
      ) {
        throw new Error(isRtl
          ? 'اختر صورة خلفية لا تتجاوز أبعادها 8192 × 8192 بكسل.'
          : 'Choose a background image no larger than 8192 × 8192 pixels.');
      }
      await onSaveLauncherBackground(dataUrl);
      setForm((current) => ({ ...current, launcherBackgroundDataUrl: dataUrl }));
    } catch (error) {
      setLauncherBackgroundError(
        error instanceof Error ? error.message : 'The selected background image could not be loaded.'
      );
    } finally {
      setLauncherBackgroundSaving(false);
    }
  };

  const handleRemoveLauncherBackground = async () => {
    setLauncherBackgroundError(null);
    setLauncherBackgroundSaving(true);
    try {
      await onSaveLauncherBackground('');
      setForm((current) => ({ ...current, launcherBackgroundDataUrl: '' }));
    } catch (error) {
      setLauncherBackgroundError(
        error instanceof Error ? error.message : 'The launcher background could not be removed.'
      );
    } finally {
      setLauncherBackgroundSaving(false);
    }
  };

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getBackupConfiguration) return;
    let active = true;
    void api.getBackupConfiguration()
      .then((configuration) => {
        if (!active) return;
        setBackupDirectory(configuration.directory);
        setBackupMode(configuration.mode);
        setScheduledBackupTime(configuration.scheduledTime);
      })
      .catch((error: unknown) => {
        if (active) {
          setBackupActionError(error instanceof Error ? error.message : 'Could not load backup folder.');
        }
      });
    if (api.getGoogleDriveStatus) {
      void api.getGoogleDriveStatus()
        .then((status) => {
          if (!active) return;
          setGoogleDriveStatus(status);
          setGoogleDriveClientId(status.clientId);
        })
        .catch((error: unknown) => {
          if (active) {
            setGoogleDriveError(error instanceof Error ? error.message : 'Could not load Google Drive status.');
          }
        });
    }
    return () => {
      active = false;
    };
  }, []);

  const handleChooseBackupDirectory = async () => {
    const api = window.electronAPI;
    if (!api?.chooseBackupDirectory) return;
    setBackupActionBusy(true);
    setBackupActionError(null);
    setBackupActionNotice(null);
    try {
      const directory = await api.chooseBackupDirectory();
      if (directory) {
        setBackupDirectory(directory);
        setBackupActionNotice(isRtl ? 'تم تحديث مجلد النسخ الاحتياطي.' : 'Backup folder updated.');
      }
    } catch (error) {
      setBackupActionError(error instanceof Error ? error.message : 'Could not choose a backup folder.');
    } finally {
      setBackupActionBusy(false);
    }
  };

  const handleCreateBackup = async () => {
    const api = window.electronAPI;
    if (!api?.createDatabaseBackup) return;
    setBackupActionBusy(true);
    setBackupActionError(null);
    setBackupActionNotice(null);
    try {
      const { filePath, googleDriveUploaded } = await api.createDatabaseBackup();
      setBackupActionNotice(
        isRtl
          ? `تم حفظ النسخة الاحتياطية${googleDriveUploaded ? ' ورفعها إلى Google Drive' : ''}: ${filePath}`
          : `Backup saved to ${filePath}${googleDriveUploaded ? ' and uploaded to Google Drive' : ''}.`
      );
    } catch (error) {
      setBackupActionError(error instanceof Error ? error.message : 'Could not create the backup.');
    } finally {
      setBackupActionBusy(false);
    }
  };

  const handleSaveBackupConfiguration = async () => {
    const api = window.electronAPI;
    if (!api?.setBackupConfiguration) return;
    setBackupSettingsBusy(true);
    setBackupActionError(null);
    setBackupActionNotice(null);
    try {
      const configuration = await api.setBackupConfiguration({
        mode: backupMode,
        scheduledTime: scheduledBackupTime,
      });
      setBackupDirectory(configuration.directory);
      setBackupMode(configuration.mode);
      setScheduledBackupTime(configuration.scheduledTime);
      setBackupActionNotice(isRtl ? 'تم حفظ إعدادات النسخ الاحتياطي.' : 'Backup settings saved.');
    } catch (error) {
      setBackupActionError(error instanceof Error ? error.message : 'Could not save backup settings.');
    } finally {
      setBackupSettingsBusy(false);
    }
  };

  const handleConnectGoogleDrive = async () => {
    const api = window.electronAPI;
    if (!api?.connectGoogleDrive) return;
    setGoogleDriveBusy(true);
    setGoogleDriveError(null);
    setGoogleDriveNotice(null);
    try {
      const status = await api.connectGoogleDrive(googleDriveClientId);
      setGoogleDriveStatus(status);
      setGoogleDriveClientId(status.clientId);
      setGoogleDriveNotice(
        isRtl
          ? 'تم ربط Google Drive. ستُرفع إليه نسخة إضافية عند إنشاء النسخ الاحتياطية.'
          : 'Google Drive connected. Backups will also be uploaded there.'
      );
    } catch (error) {
      setGoogleDriveError(error instanceof Error ? error.message : 'Could not connect Google Drive.');
    } finally {
      setGoogleDriveBusy(false);
    }
  };

  const handleDisconnectGoogleDrive = async () => {
    const api = window.electronAPI;
    if (!api?.disconnectGoogleDrive) return;
    setGoogleDriveBusy(true);
    setGoogleDriveError(null);
    setGoogleDriveNotice(null);
    try {
      const status = await api.disconnectGoogleDrive();
      setGoogleDriveStatus(status);
      setGoogleDriveClientId(status.clientId);
      setGoogleDriveNotice(isRtl ? 'تم فصل Google Drive.' : 'Google Drive disconnected.');
    } catch (error) {
      setGoogleDriveError(error instanceof Error ? error.message : 'Could not disconnect Google Drive.');
    } finally {
      setGoogleDriveBusy(false);
    }
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

  const handleDownloadUpdate = async () => {
    const api = window.electronAPI;
    if (!api?.downloadUpdate) return;
    setUpdateActionError(null);
    try {
      await api.downloadUpdate();
    } catch (error) {
      setUpdateActionError((error as Error).message || 'Could not download the update.');
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

  const handleSetDefaultScreenMode = async (mode: AppScreenMode) => {
    const api = window.electronAPI;
    setScreenModeActionBusy(true);
    setScreenModeActionError(null);
    setScreenModeApplied(false);
    onAppScreenModeChange(mode);
    try {
      if (api?.setDefaultScreenMode) {
        await api.setDefaultScreenMode(mode);
      } else {
        window.localStorage.setItem(APP_SCREEN_MODE_STORAGE_KEY, mode);
      }
      setScreenModeApplied(true);
    } catch (error) {
      setScreenModeApplied(false);
      setScreenModeActionError(
        error instanceof Error ? error.message : 'Could not save the default screen mode.'
      );
    } finally {
      setScreenModeActionBusy(false);
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
    permissions: ['register', 'sales', 'reports'],
  });
  const [userFormSaving, setUserFormSaving] = useState(false);
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [userActionSuccess, setUserActionSuccess] = useState<string | null>(null);

  const fetchUsers = async () => {
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
    if (isAppAdmin) void fetchUsers();
  }, [isAppAdmin]);

  useEffect(() => {
    if (
      !isAppAdmin &&
      activeSettingsSection === 'users'
    ) {
      onActiveSectionChange('general');
    }
  }, [activeSettingsSection, isAppAdmin, onActiveSectionChange]);

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
      permissions: ['register', 'sales', 'reports'],
    });
    setUserFormError(null);
    setUserModalOpen(true);
  };

  const handleOpenEditUser = (user: UserAccount) => {
    if (user.username.toLowerCase() === 'aptadmin') return;
    setEditingUser(user);
    setUserFormData({
      username: user.username,
      password: '', // Leave blank to keep existing password
      role: user.role,
      displayName: user.displayName,
      permissions: user.permissions && user.permissions.length > 0
        ? [...new Set([
            ...user.permissions,
            ...(user.permissions.includes('sales') ? ['reports'] : []),
          ])]
        : ['register', 'sales', 'reports'],
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
    if (editingUser?.username.toLowerCase() === 'aptadmin') {
      setUserFormError('The primary company admin account cannot be edited.');
      return;
    }
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
        'accounts',
        'reports',
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
    const updatedSettings = normalizeCardDimensionSettings(settings);
    setForm(updatedSettings);
    setCardDimensionInputs(getCardDimensionInputs(updatedSettings));
  }, [settings]);

  const updateCardDimensionInput = (field: CardDimensionField, value: string) => {
    setCardDimensionInputs((current) => ({ ...current, [field]: value }));
    const parsedValue = Number(value);
    if (value.trim() && Number.isFinite(parsedValue) && parsedValue > 0) {
      setForm((current) => ({ ...current, [field]: parsedValue }));
    }
  };

  const normalizeCardDimensionInput = (field: CardDimensionField) => {
    const parsedValue = Number(cardDimensionInputs[field]);
    const value = Number.isFinite(parsedValue) && parsedValue > 0
      ? parsedValue
      : CARD_DIMENSION_DEFAULTS[field];
    setCardDimensionInputs((current) => ({ ...current, [field]: String(value) }));
    setForm((current) => ({ ...current, [field]: value }));
  };

  useEffect(() => {
    setPolicyVersion(settings.appVersion || 'Standard');
  }, [settings.appVersion]);

  useEffect(() => {
    if (activeSettingsSection !== 'updates' || updateSettingsPanel !== 'version') {
      setVersionPoliciesLoaded(false);
      return;
    }

    let active = true;
    setVersionPolicyLoading(true);
    setVersionPoliciesLoaded(false);
    setVersionPolicyError(null);
    void onLoadVersionComponentPolicies()
      .then((policies) => {
        if (!active) return;
        setVersionPolicies(policies);
        setVersionPoliciesLoaded(true);
      })
      .catch((error: unknown) => {
        if (active) {
          setVersionPolicyError(
            error instanceof Error ? error.message : 'Could not load Firebase version policies.'
          );
        }
      })
      .finally(() => {
        if (active) setVersionPolicyLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    activeSettingsSection,
    updateSettingsPanel,
    settings.registeredSystem,
    onLoadVersionComponentPolicies,
    versionPolicyLoadAttempt,
  ]);

  useLayoutEffect(() => {
    settingsViewRef.current?.querySelectorAll<HTMLElement>('.settings-content-scroll').forEach((pane) => {
      pane.scrollTop = 0;
    });
  }, [activeSettingsSection, updateSettingsPanel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    setSettingsSaveError(null);
    try {
      const settingsToSave = { ...form };
      delete settingsToSave.versionComponentPolicies;
      await onSaveSettings(settingsToSave);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (error) {
      setSettingsSaveError(
        error instanceof Error ? error.message : 'Could not save version component policies.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleVersionActivation = async (event: React.FormEvent) => {
    event.preventDefault();
    setVersionActivationBusy(true);
    setVersionActivationError(null);
    try {
      const appVersion = policyVersion || 'Standard';
      await onActivateVersion({ appVersion, password: versionAdminPassword });
      setVersionActivationOpen(false);
      setVersionAdminPassword('');
      setVersionActivationNotice(true);
      setTimeout(() => setVersionActivationNotice(false), 3500);
    } catch (error) {
      setVersionActivationError(
        error instanceof Error ? error.message : 'Could not activate the selected version.'
      );
    } finally {
      setVersionActivationBusy(false);
    }
  };

  const handleRegistrationKeyActivation = async () => {
    setRegistrationKeyBusy(true);
    setRegistrationKeyError(null);
    setRegistrationKeySuccess(null);
    try {
      const result = await onActivateRegistrationKey(registrationKey.trim());
      setRegistrationKey('');
      setRegistrationKeySuccess(
        `Registered as ${result.appVersion}. Other local login accounts were removed, the primary aptadmin account was kept, and "${result.username}" is ready. Sign out and use the license account to continue.`
      );
    } catch (error) {
      setRegistrationKeyError(
        error instanceof Error ? error.message : 'Could not activate this registration key.'
      );
    } finally {
      setRegistrationKeyBusy(false);
    }
  };

  useEffect(() => {
    if (activeSettingsSection !== 'registration' || !canRegisterSystem || systemCode) {
      return;
    }
    let active = true;
    setLoadingSystemCode(true);
    setSystemCodeError(null);
    fetch('/api/registration/system-code')
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        const code = typeof data?.systemCode === 'string' ? data.systemCode : '';
        if (!response.ok || !code) {
          throw new Error(
            typeof data?.error === 'string'
              ? data.error
              : (isRtl ? 'تعذر تحميل رمز النظام.' : "Could not load this installation's system code.")
          );
        }
        if (active) setSystemCode(code);
      })
      .catch((error: unknown) => {
        if (active) {
          setSystemCodeError(
            error instanceof Error ? error.message : (isRtl ? 'تعذر تحميل رمز النظام.' : 'Could not load the system code.')
          );
        }
      })
      .finally(() => {
        if (active) setLoadingSystemCode(false);
      });

    return () => {
      active = false;
    };
  }, [activeSettingsSection, canRegisterSystem, isRtl, systemCode]);

  const handleCopySystemCode = async () => {
    if (!systemCode) return;
    try {
      await navigator.clipboard.writeText(systemCode);
      setSystemCodeCopied(true);
      setTimeout(() => setSystemCodeCopied(false), 2000);
    } catch {
      setSystemCodeCopied(false);
    }
  };

  const paymentMethods = getPaymentMethods(form.paymentMethods);

  const isBuiltInPaymentMethod = (method: string) =>
    BUILT_IN_PAYMENT_METHODS.some((builtInMethod) => builtInMethod.toLowerCase() === method.toLowerCase());

  const handleSavePaymentMethod = () => {
    const name = newPaymentMethod.trim();
    if (!name) {
      setPaymentMethodError(isRtl ? 'أدخل اسم طريقة الدفع.' : 'Enter a payment method name.');
      return;
    }
    if (paymentMethods.some((method) =>
      method.toLowerCase() !== editingPaymentMethod?.toLowerCase() &&
      method.toLowerCase() === name.toLowerCase()
    )) {
      setPaymentMethodError(isRtl ? 'طريقة الدفع موجودة بالفعل.' : 'That payment method already exists.');
      return;
    }

    setForm((current) => ({
      ...current,
      paymentMethods: editingPaymentMethod
        ? getPaymentMethods(current.paymentMethods).map((method) =>
          method === editingPaymentMethod ? name : method
        )
        : [...getPaymentMethods(current.paymentMethods), name],
    }));
    setNewPaymentMethod('');
    setEditingPaymentMethod(null);
    setPaymentMethodError(null);
  };

  const handleEditPaymentMethod = (method: string) => {
    if (isBuiltInPaymentMethod(method)) return;
    setEditingPaymentMethod(method);
    setNewPaymentMethod(method);
    setPaymentMethodError(null);
  };

  const handleDeletePaymentMethod = (method: string) => {
    if (isBuiltInPaymentMethod(method)) return;
    setForm((current) => ({
      ...current,
      paymentMethods: getPaymentMethods(current.paymentMethods).filter((configuredMethod) => configuredMethod !== method),
    }));
    if (editingPaymentMethod === method) {
      setEditingPaymentMethod(null);
      setNewPaymentMethod('');
    }
    setPaymentMethodError(null);
  };

  const handleCancelPaymentMethodEdit = () => {
    setEditingPaymentMethod(null);
    setNewPaymentMethod('');
    setPaymentMethodError(null);
  };

  const handleConfirmReset = async () => {
    if (!onResetDatabase) return;
    if (!resetAdminPassword.trim()) {
      setResetError('Enter the app admin password to reset the database.');
      return;
    }
    setIsResetting(true);
    setResetError(null);
    try {
      await onResetDatabase(resetAdminPassword);
      setShowResetModal(false);
      setResetAdminPassword('');
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

  const renderUpdatePanelTabs = () => (
    <div
      className="flex flex-wrap gap-2"
      role="tablist"
      aria-label={isRtl ? 'إعدادات التحديث والإصدار' : 'Update and version settings'}
    >
      {([
        { id: 'software', label: isRtl ? 'تحديثات البرنامج' : 'Software Updates' },
        { id: 'version', label: isRtl ? 'إصدار التطبيق' : 'App Version' },
      ] as const)
        .filter((panel) => isAppAdmin || panel.id !== 'version')
        .map((panel) => (
          <button
            key={panel.id}
            type="button"
            role="tab"
            aria-selected={updateSettingsPanel === panel.id}
            onClick={() => setUpdateSettingsPanel(panel.id)}
            className={`rounded-md border px-3 py-2 text-xs font-semibold ${
              updateSettingsPanel === panel.id
                ? 'border-blue-700 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {panel.label}
          </button>
        ))}
    </div>
  );

  return (
    <div ref={settingsViewRef} className="settings-view flex min-h-0 flex-1 flex-col overflow-hidden">
      {showSectionNavigation && (
        <nav
          className="settings-section-navigation"
          aria-label="Settings sections"
          role="tablist"
        >
          <SettingsSectionTabs
            activeSection={activeSettingsSection}
            isAppAdmin={isAppAdmin}
            onSelect={onActiveSectionChange}
          />
        </nav>
      )}

      <div className={`settings-content-scroll min-w-0 min-h-0 overflow-y-auto ${
        activeSettingsSection === 'updates' && updateSettingsPanel === 'software' ? 'hidden' : 'flex-1'
      }`}>
        <div className="settings-content-inner p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
          {activeSettingsSection === 'updates' && updateSettingsPanel === 'version' && renderUpdatePanelTabs()}
          {activeSettingsSection === 'general' && (
            <section className="settings-item-list settings-item-row settings-input-row">
              <div className="settings-item-copy">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {theme === 'dark' ? <Moon className="h-4 w-4" /> : theme === 'medium' ? <Monitor className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                  {isRtl ? 'المظهر' : 'Appearance'}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isRtl ? 'اختر مظهراً فاتحاً أو متوسطاً أو داكناً للتطبيق.' : 'Choose a light, medium, or dark appearance for the app.'}
                </p>
              </div>
              <select
                value={theme}
                aria-label={isRtl ? 'المظهر' : 'Theme'}
                onChange={(event) => {
                  if (
                    event.target.value === 'light' ||
                    event.target.value === 'medium' ||
                    event.target.value === 'dark'
                  ) {
                    onThemeChange(event.target.value);
                  }
                }}
                className="settings-item-control rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="light">{isRtl ? 'فاتح' : 'Light'}</option>
                <option value="medium">{isRtl ? 'متوسط' : 'Medium'}</option>
                <option value="dark">{isRtl ? 'داكن' : 'Dark'}</option>
              </select>
            </section>
          )}

          {activeSettingsSection === 'general' && (
              <section className="settings-item-list settings-item-row settings-input-row">
                <div className="settings-item-copy">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Monitor className="h-4 w-4" />
                    {isRtl ? 'وضع شاشة المبيعات' : 'Sales Screen Mode'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {window.electronAPI?.setDefaultScreenMode
                      ? isRtl
                        ? 'عند اختيار الوضع، يتغير رأس التطبيق وشعار شاشة تسجيل الدخول فوراً، ويُحفظ الاختيار لمرات التشغيل القادمة.'
                        : 'Selecting a mode immediately updates the app header, login branding, and app icon, and saves it for future launches.'
                      : isRtl
                        ? 'عند اختيار الوضع، يتغير رأس التطبيق وشعار شاشة تسجيل الدخول فوراً، ويُحفظ الاختيار في هذا المتصفح.'
                        : 'Selecting a mode immediately updates the app header and login branding, and saves it in this browser.'}
                  </p>
                </div>
                <div className="settings-item-control flex flex-col gap-2">
                  <select
                    value={selectedScreenMode}
                    aria-label={isRtl ? 'وضع شاشة المبيعات' : 'Sales Screen Mode'}
                    disabled={screenModeActionBusy}
                    onChange={(event) => {
                      if (
                        event.target.value === 'pos' ||
                        event.target.value === 'rpos' ||
                        event.target.value === 'erp' ||
                        event.target.value === 'flyerp'
                      ) {
                        setSelectedScreenMode(event.target.value);
                        setScreenModeActionError(null);
                        setScreenModeApplied(false);
                        void handleSetDefaultScreenMode(event.target.value);
                      }
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                  >
                    <option value="erp">aptERP</option>
                    <option value="flyerp">aptFlyERP</option>
                    <option value="pos">aptPOS</option>
                    <option value="rpos">aptRPOS</option>
                  </select>
                  <p className="min-h-4 text-xs" role="status" aria-live="polite">
                    {screenModeActionBusy
                      ? isRtl ? 'جارٍ حفظ الوضع...' : 'Saving selected mode...'
                      : screenModeApplied
                        ? isRtl ? 'تم حفظ الوضع' : 'Mode saved'
                        : ''}
                  </p>
                </div>
                {screenModeActionError && (
                  <p className="settings-item-copy text-xs text-red-700" role="alert">
                    {screenModeActionError}
                  </p>
                )}
              </section>
          )}

          {activeSettingsSection === 'general' && (
            <section
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
              aria-label={isRtl ? 'خلفية مشغل التطبيقات' : 'Launcher background'}
            >
              <h2 className="text-sm font-semibold text-slate-900">
                {isRtl ? 'خلفية مشغل التطبيقات' : 'Launcher Background'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {isRtl
                  ? 'اختر صورة لتظهر خلف أيقونات مشغل التطبيقات. PNG أو JPEG أو WebP، بحد أقصى 5 ميجابايت.'
                  : 'Choose an image to display behind the app launcher. PNG, JPEG, or WebP; maximum 5 MB.'}
              </p>
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex h-32 w-full max-w-sm items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {form.launcherBackgroundDataUrl ? (
                    <img
                      src={form.launcherBackgroundDataUrl}
                      alt={isRtl ? 'معاينة خلفية مشغل التطبيقات' : 'Launcher background preview'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-center text-slate-400">
                      <Monitor className="mx-auto h-7 w-7" aria-hidden="true" />
                      <span className="mt-1 block text-xs">
                        {isRtl ? 'لا توجد صورة محددة' : 'No image selected'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-start gap-2">
                  <input
                    ref={launcherBackgroundInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => void handleLauncherBackgroundChange(event)}
                    disabled={launcherBackgroundSaving}
                    className="hidden"
                    aria-label={isRtl ? 'اختيار صورة خلفية المشغل' : 'Choose launcher background image'}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => launcherBackgroundInputRef.current?.click()}
                      disabled={launcherBackgroundSaving}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      {launcherBackgroundSaving
                        ? isRtl ? 'جارٍ الحفظ...' : 'Saving...'
                        : form.launcherBackgroundDataUrl
                          ? isRtl ? 'تغيير الصورة' : 'Choose image'
                          : isRtl ? 'رفع صورة' : 'Choose image'}
                    </button>
                    {form.launcherBackgroundDataUrl && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveLauncherBackground()}
                        disabled={launcherBackgroundSaving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {isRtl ? 'إزالة الصورة' : 'Remove image'}
                      </button>
                    )}
                  </div>
                  {launcherBackgroundError && (
                    <p role="alert" className="text-xs font-medium text-red-700">
                      {launcherBackgroundError}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {activeSettingsSection === 'general' && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <h2 className="text-sm font-semibold text-slate-900">
                {isRtl ? 'أبعاد بطاقات الكتالوج' : 'Catalog Card Dimensions'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {isRtl
                  ? 'حدد العرض والارتفاع بالبوصة لبطاقات المنتجات والتصنيفات.'
                  : 'Set product and category card width and height in inches.'}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  {
                    title: isRtl ? 'بطاقات المنتجات' : 'Product Cards',
                    widthField: 'productCardWidthIn',
                    heightField: 'productCardHeightIn',
                  },
                  {
                    title: isRtl ? 'بطاقات التصنيفات' : 'Category Cards',
                    widthField: 'categoryCardWidthIn',
                    heightField: 'categoryCardHeightIn',
                  },
                ] as const).map((group) => (
                  <div key={group.widthField} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <h3 className="text-xs font-semibold text-slate-800">{group.title}</h3>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {([
                        {
                          field: group.widthField,
                          label: isRtl ? 'العرض' : 'Width',
                          ariaLabel: isRtl ? `${group.title} - العرض بالبوصة` : `${group.title} width in inches`,
                        },
                        {
                          field: group.heightField,
                          label: isRtl ? 'الارتفاع' : 'Height',
                          ariaLabel: isRtl ? `${group.title} - الارتفاع بالبوصة` : `${group.title} height in inches`,
                        },
                      ] as const).map((dimension) => (
                        <label key={dimension.field} className="block text-xs font-medium text-slate-700">
                          {dimension.label}
                          <span className="mt-1 flex items-center rounded-md border border-slate-300 bg-white focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100">
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              inputMode="decimal"
                              aria-label={dimension.ariaLabel}
                              value={cardDimensionInputs[dimension.field]}
                              onChange={(event) => updateCardDimensionInput(dimension.field, event.target.value)}
                              onBlur={() => normalizeCardDimensionInput(dimension.field)}
                              className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm text-slate-900 focus:outline-none"
                            />
                            <span className="px-2 text-xs text-slate-500">in</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                {isRtl ? 'الأبعاد الافتراضية لكلا النوعين هي 2 × 3 بوصات.' : 'Both default to 2 × 3 inches.'}
              </p>
            </section>
          )}

          {activeSettingsSection === 'general' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                  <Globe className="h-4 w-4" />
                </span>
                <h2 className="text-sm font-semibold text-slate-900">{t.languageSelect}</h2>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setLanguage('en');
                    setForm((current) => ({ ...current, appLanguage: 'en' }));
                  }}
                  aria-pressed={language === 'en'}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                    language === 'en'
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Globe className="h-4 w-4" />
                  <span>{t.english}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLanguage('ar');
                    setForm((current) => ({ ...current, appLanguage: 'ar' }));
                  }}
                  aria-pressed={language === 'ar'}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                    language === 'ar'
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Globe className="h-4 w-4" />
                  <span>{t.arabic}</span>
                </button>
              </div>
            </section>
          )}

          {/* Main Settings Form */}
          <form
            id="settings-form"
            onSubmit={handleSubmit}
            className="space-y-5 text-xs"
          >
            {settingsSaveError && (
              <p className="text-xs text-red-600" role="alert">{settingsSaveError}</p>
            )}
            {activeSettingsSection === 'registration' && (
              <section className={settings.registeredSystem ? '' : 'rounded-xl border border-slate-200 bg-white p-4 shadow-xs'}>
                {!settings.registeredSystem && (
                  <>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {isRtl ? 'تسجيل النظام' : 'Register this system'}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {isRtl
                        ? 'شارك رمز النظام مع تطبيق المصادقة ثم أدخل مفتاح التسجيل لتفعيل هذا النظام.'
                        : 'Share the system code with the Auth app, then enter the registration key to activate this system.'}
                    </p>
                  </>
                )}
                {!settings.registeredSystem && (
                <div className="mt-4 max-w-md">
                  <label className="block text-xs font-medium text-slate-700">
                    {isRtl ? 'رمز النظام' : 'System Code'}
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      aria-label={isRtl ? 'رمز النظام' : 'System Code'}
                      value={loadingSystemCode ? (isRtl ? 'جارٍ تحميل رمز النظام...' : 'Loading system code…') : systemCode}
                      className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800 select-all focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCopySystemCode()}
                      disabled={!systemCode || loadingSystemCode}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      title={isRtl ? 'نسخ رمز النظام' : 'Copy System Code'}
                    >
                      {systemCodeCopied ? (
                        <>
                          <Check className="h-4 w-4 text-emerald-600" />
                          <span>{isRtl ? 'تم النسخ' : 'Copied'}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 text-slate-500" />
                          <span>{isRtl ? 'نسخ' : 'Copy'}</span>
                        </>
                      )}
                    </button>
                  </div>
                  {systemCodeError && (
                    <p className="mt-1 text-xs text-red-600" role="alert">{systemCodeError}</p>
                  )}
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    {isRtl
                      ? 'شارك هذا الرمز مع المسؤول لإنشاء مفتاح التسجيل الخاص بهذا الجهاز.'
                      : 'Share this code with your administrator to generate a registration key for this machine.'}
                  </p>
                </div>
                )}
                {settings.registeredSystem ? (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-sm font-semibold text-emerald-900">
                      {isRtl ? 'هذا النظام مسجل' : 'This system is registered'}
                    </p>
                    <p className="mt-1 text-xs text-emerald-800">
                      {isRtl ? 'الإصدار:' : 'Version:'} {settings.appVersion || 'Standard'}
                    </p>
                    {settings.registrationDetails && (
                      <div className="mt-3 rounded-lg border border-emerald-200 bg-white/80 p-3">
                        <h3 className="text-xs font-semibold text-slate-900">
                          {isRtl ? 'تفاصيل تسجيل النشاط التجاري' : 'Business registration details'}
                        </h3>
                        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                          {[
                            [isRtl ? 'اسم النشاط التجاري' : 'Business name', settings.registrationDetails.businessName],
                            [isRtl ? 'العنوان' : 'Address', settings.registrationDetails.address],
                            [isRtl ? 'رقم الجوال' : 'Mobile number', settings.registrationDetails.mobileNumber],
                            [isRtl ? 'رمز النظام' : 'System code', settings.registrationDetails.systemCode],
                            [isRtl ? 'اسم المستخدم الأساسي' : 'Primary username', settings.registrationDetails.username],
                            [isRtl ? 'الإصدار' : 'Version', settings.registrationDetails.appVersion],
                            [
                              isRtl ? 'تاريخ بداية AMC' : 'AMC start date',
                              formatRegistrationDate(settings.registrationDetails.amcStartDate, isRtl ? 'ar' : 'en-GB'),
                            ],
                            [
                              isRtl ? 'تاريخ انتهاء AMC' : 'AMC expiry date',
                              settings.registrationDetails.amcEndDate
                                ? formatRegistrationDate(settings.registrationDetails.amcEndDate, isRtl ? 'ar' : 'en-GB')
                                : (isRtl ? 'بدون AMC' : 'No AMC'),
                            ],
                          ].map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                              <dd className="mt-0.5 break-words text-xs font-medium text-slate-800">{value}</dd>
                            </div>
                          ))}
                          {settings.registrationDetails.licenseNumber?.trim() && (
                            <div className="min-w-0">
                              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                {isRtl ? 'رقم الترخيص' : 'License number'}
                              </dt>
                              <dd className="mt-0.5 break-words text-xs font-medium text-slate-800">
                                {settings.registrationDetails.licenseNumber}
                              </dd>
                            </div>
                          )}
                          {settings.registrationDetails.amcNotes?.trim() && (
                            <div className="min-w-0 sm:col-span-2">
                              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                {isRtl ? 'ملاحظات AMC' : 'AMC notes'}
                              </dt>
                              <dd className="mt-0.5 break-words text-xs font-medium text-slate-800">
                                {settings.registrationDetails.amcNotes}
                              </dd>
                            </div>
                          )}
                          <div className="min-w-0">
                            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                              {isRtl ? 'كلمة المرور الأساسية' : 'Primary password'}
                            </dt>
                            <dd className="mt-0.5 text-xs font-medium text-slate-800">
                              {isRtl ? 'محفوظة بشكل آمن ولا تُعرض' : 'Protected on this device and not displayed'}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <label className="mt-4 block max-w-sm text-xs font-medium text-slate-700">
                      {isRtl ? 'مفتاح التسجيل' : 'Registration key'}
                      <input
                        value={registrationKey}
                        onChange={(event) => setRegistrationKey(event.target.value)}
                        autoComplete="off"
                        disabled={registrationKeyBusy}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <p className="mt-2 max-w-xl text-[11px] leading-4 text-amber-700" role="note">
                      {isRtl
                        ? 'عند التفعيل، ستُستبدل حسابات الدخول الأخرى بحساب الترخيص، مع الاحتفاظ بحساب aptadmin الأساسي.'
                        : 'Activation replaces other POS login accounts with the license account. The primary aptadmin account is kept.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleRegistrationKeyActivation()}
                      disabled={registrationKeyBusy || !registrationKey.trim()}
                      className="mt-4 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {registrationKeyBusy
                        ? (isRtl ? 'جارٍ التفعيل...' : 'Activating...')
                        : (isRtl ? 'تفعيل التسجيل' : 'Activate Registration')}
                    </button>
                  </>
                )}
                {registrationKeyError && (
                  <p className="mt-3 text-xs text-red-600" role="alert">{registrationKeyError}</p>
                )}
                {registrationKeySuccess && (
                  <p className="mt-3 text-xs text-emerald-700" role="status">{registrationKeySuccess}</p>
                )}
              </section>
            )}
            {isAppAdmin && activeSettingsSection === 'updates' && updateSettingsPanel === 'version' && (
              <div className="space-y-4">
                {settings.registeredSystem && (
                  <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-xs">
                    <h2 className="text-sm font-semibold text-slate-900">
                      {isRtl ? 'الإصدار المُدار مركزياً' : 'Registered version'}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {isRtl
                        ? `هذا النظام مسجل بإصدار ${settings.appVersion || 'Standard'}؛ يتم التحكم في المكونات المتاحة مركزياً وتُزامن عند فحص حالة الترخيص.`
                        : `This system is registered on ${settings.appVersion || 'Standard'}. Its component access is managed centrally and syncs during license checks.`}
                    </p>
                  </section>
                )}
                {!settings.registeredSystem && (
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {isRtl ? 'إصدار التطبيق' : 'Application Version'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {isRtl
                      ? 'اختر إصدار التطبيق. يمكنك ضبط المكونات المتاحة للمستخدمين أدناه.'
                      : 'Choose the app version. Configure which components users can access below.'}
                  </p>
                  <label
                    htmlFor="app-version"
                    className="mt-4 block text-xs font-medium text-slate-700"
                  >
                    {isRtl ? 'إصدار التطبيق' : 'App version'}
                  </label>
                  <select
                    id="app-version"
                    value={policyVersion}
                    onChange={(event) => {
                      const appVersion = APP_VERSIONS.find(
                        (version) => version === event.target.value
                      );
                      if (appVersion) {
                        setPolicyVersion(appVersion);
                      }
                    }}
                    className="mt-1 w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {APP_VERSIONS.map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {isRtl
                      ? `الإصدار النشط حالياً: ${settings.appVersion || 'Standard'}. لن تُطبق التغييرات حتى التفعيل.`
                      : `Currently active: ${settings.appVersion || 'Standard'}. Changes take effect only after activation.`}
                  </p>
                </section>
                )}

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {isRtl ? 'إعدادات المكونات لكل إصدار' : 'Component access by version'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {isRtl
                      ? 'سياسات المكونات للعرض فقط. تُدار التغييرات من بوابة aptPOS User Admin.'
                      : 'Component policies are read-only here. Manage changes from the aptPOS User Admin portal.'}
                  </p>
                  {versionPolicyLoading && (
                    <p className="mt-3 text-xs text-slate-500" role="status">
                      {isRtl ? 'جارٍ تحميل سياسات Firebase...' : 'Loading Firebase version policies...'}
                    </p>
                  )}
                  {versionPolicyError && (
                    <p className="mt-3 text-xs text-red-600" role="alert">{versionPolicyError}</p>
                  )}
                  {versionPolicyError && !versionPoliciesLoaded && (
                    <button
                      type="button"
                      onClick={() => setVersionPolicyLoadAttempt((attempt) => attempt + 1)}
                      disabled={versionPolicyLoading}
                      className="mt-2 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                    >
                      {isRtl ? 'إعادة المحاولة' : 'Retry loading policies'}
                    </button>
                  )}
                  {versionPoliciesLoaded && (
                    <>
                      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={isRtl ? 'إصدارات التطبيق' : 'App versions'}>
                        {APP_VERSIONS.map((version) => {
                          const allowedCount = versionPolicies[version]?.length ?? 0;
                          return (
                            <button
                              key={version}
                              type="button"
                              role="tab"
                              aria-selected={policyVersion === version}
                              onClick={() => setPolicyVersion(version)}
                              className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                                policyVersion === version
                                  ? 'border-blue-700 bg-blue-50 text-blue-800'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {version} · {allowedCount}/{APP_COMPONENTS.length}
                            </button>
                          );
                        })}
                      </div>
                      <h3 className="mt-4 text-xs font-semibold text-slate-700">
                        {policyVersion} {isRtl ? 'المكونات المسموح بها' : 'allowed components'}
                      </h3>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {isRtl
                          ? 'المكونات المحددة متاحة للمستخدمين. يبقى aptadmin قادراً على الوصول إلى جميع المكونات في الأنظمة غير المسجلة.'
                          : 'Checked components are available to users. aptadmin retains full access on non-registered systems.'}
                      </p>
                      <div className="settings-item-list mt-3">
                        {APP_COMPONENTS.map((component) => (
                          <label
                            key={component.id}
                            className="settings-item-row"
                          >
                            <span className="settings-item-copy text-sm font-medium text-slate-700">
                              {isRtl ? component.labelAr : component.label}
                            </span>
                            <input
                              type="checkbox"
                              checked={versionPolicies[policyVersion]?.includes(component.id) ?? false}
                              disabled
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}

            {/* General, billing, print, customer, and payment settings */}
            {(
              activeSettingsSection === 'general' ||
              activeSettingsSection === 'billing' ||
              activeSettingsSection === 'print' ||
              activeSettingsSection === 'customers' ||
              activeSettingsSection === 'payment'
            ) && (
              <div className="space-y-4">
                {activeSettingsSection !== 'payment' && activeSettingsSection !== 'print' && (
                <div className="settings-item-list">
                  {activeSettingsSection === 'general' && (
                  <label className="settings-item-row cursor-pointer">
                    <span className="settings-item-copy">
                      <span className="block text-sm font-semibold text-slate-700">
                        {isRtl ? 'السماح بتعديل تاريخ الفاتورة' : 'Allow Invoice Date Editing'}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {isRtl
                          ? 'السماح بتعديل التاريخ في شاشة aptERP.'
                          : 'Allow changing the invoice date in the aptERP sales-entry screen.'}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={isRtl ? 'السماح بتعديل تاريخ الفاتورة' : 'Allow Invoice Date Editing'}
                      checked={form.allowInvoiceDateEdit === true}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          allowInvoiceDateEdit: event.target.checked,
                        }))
                      }
                      className="peer sr-only"
                    />
                    <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600 rtl:peer-checked:after:-translate-x-4" />
                  </label>
                  )}
                  {activeSettingsSection === 'general' && (
                  <label className="settings-item-row cursor-pointer">
                    <span className="settings-item-copy">
                      <span className="block text-sm font-semibold text-slate-700">
                        {isRtl ? 'الأيقونات فقط' : 'Icon Only'}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {isRtl
                          ? 'إخفاء أسماء العناصر أسفل أيقونات المشغّل.'
                          : 'Hide the text labels below launcher icons.'}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={isRtl ? 'الأيقونات فقط' : 'Icon Only'}
                      checked={iconOnlyLauncher}
                      onChange={(event) => onIconOnlyLauncherChange(event.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600 rtl:peer-checked:after:-translate-x-4" />
                  </label>
                  )}
                  {activeSettingsSection === 'billing' && (
                  <label className="settings-item-row cursor-pointer">
                    <span className="settings-item-copy text-sm font-normal text-slate-700">
                      {isRtl ? 'سعر البيع شامل الضريبة' : 'Selling Price include tax'}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={isRtl ? 'سعر البيع شامل الضريبة' : 'Selling Price include tax'}
                      checked={form.taxType === 'inclusive'}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          taxType: event.target.checked ? 'inclusive' : 'exclusive',
                        }))
                      }
                      className="peer sr-only"
                    />
                    <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600 rtl:peer-checked:after:-translate-x-4" />
                  </label>
                  )}
                  {activeSettingsSection === 'billing' && (
                  <div className="settings-item-row settings-input-row">
                    <label className="settings-item-copy text-sm font-semibold text-slate-700">
                      Currency Symbol
                    </label>
                    <input
                      type="text"
                      maxLength={4}
                      value={form.currencySymbol}
                      onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })}
                      className="settings-item-control border border-slate-200 px-3 py-2 font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                  )}
                  {activeSettingsSection === 'billing' && (
                  <div className="settings-item-row settings-input-row">
                    <label htmlFor="pos-default-search-field" className="settings-item-copy">
                      <span className="block text-sm font-semibold text-slate-700">
                        {isRtl ? 'حقل البحث الافتراضي (نقطة البيع)' : 'Default Search Field (POS)'}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {isRtl
                          ? 'اختر كيفية بحث شريط المسح في شاشة POS (الباركود افتراضياً، أو الاسم، أو رمز الصنف، أو الكل شاملاً نسبة الضريبة).'
                          : 'Choose how the main POS search bar matches products (Barcode scanning by default, Name, SKU, or All product fields including tax %).'}
                      </span>
                    </label>
                    <select
                      id="pos-default-search-field"
                      value={form.posDefaultSearchField || 'barcode'}
                      onChange={(e) =>
                        setForm((current) => ({
                          ...current,
                          posDefaultSearchField: e.target.value as 'barcode' | 'name' | 'sku' | 'all',
                        }))
                      }
                      className="settings-item-control rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                    >
                      <option value="barcode">
                        {isRtl ? 'مسح الباركود (افتراضي)' : 'Barcode Scanning (Default)'}
                      </option>
                      <option value="name">
                        {isRtl ? 'الاسم' : 'Name'}
                      </option>
                      <option value="sku">
                        {isRtl ? 'رمز الصنف (SKU)' : 'SKU'}
                      </option>
                      <option value="all">
                        {isRtl ? 'الكل (أي حقل للمنتج بما في ذلك الضريبة %)' : 'All (Any product field incl. tax %)'}
                      </option>
                    </select>
                  </div>
                  )}
                  {activeSettingsSection === 'billing' && (
                  <>
                    <label className="settings-item-row cursor-pointer">
                      <span className="settings-item-copy">
                        <span className="block text-sm font-semibold text-slate-700">
                          {isRtl ? 'تفعيل وردية الصندوق' : 'Enable Counter Shift'}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {isRtl
                            ? 'يتطلب فتح وردية الصندوق قبل إنشاء أي سند (بما في ذلك المبيعات، المرتجعات، المشتريات، والمدفوعات النقدية).'
                            : 'Require opening a counter shift before creating any vouchers (including sales, returns, purchases, and cash payments).'}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={isRtl ? 'تفعيل وردية الصندوق' : 'Enable Counter Shift'}
                        checked={form.enableCounterShift === true}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            enableCounterShift: event.target.checked,
                            ...(!event.target.checked ? { enableDailyCounterShift: false } : {}),
                          }))
                        }
                        className="peer sr-only"
                      />
                      <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600 rtl:peer-checked:after:-translate-x-4" />
                    </label>

                    {form.enableCounterShift === true && (
                      <>
                        <label className="settings-item-row cursor-pointer">
                          <span className="settings-item-copy">
                            <span className="block text-sm font-semibold text-slate-700">
                              {isRtl ? 'وردية الصندوق اليومية' : 'Daily Counter Shift'}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {isRtl
                                ? 'حساب جميع المعاملات تلقائياً حسب وقت الفتح والإغلاق اليومي دون الحاجة لفتح أو إغلاق الوردية يدوياً.'
                                : 'Automatically calculate all daily entries by shift opening and closing time without manual shift opening or closing balance.'}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={isRtl ? 'وردية الصندوق اليومية' : 'Daily Counter Shift'}
                            checked={form.enableDailyCounterShift === true}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                enableDailyCounterShift: event.target.checked,
                              }))
                            }
                            className="peer sr-only"
                          />
                          <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600 rtl:peer-checked:after:-translate-x-4" />
                        </label>

                        {form.enableDailyCounterShift === true && (() => {
                          const openStr = form.dailyShiftOpenTime || '00:00';
                          const closeStr = form.dailyShiftCloseTime || '23:59';
                          const nextDay = form.dailyShiftCloseNextDay === true;
                          const [oH, oM] = openStr.split(':').map(Number);
                          const [cH, cM] = closeStr.split(':').map(Number);
                          const startMin = (oH || 0) * 60 + (oM || 0);
                          const endMin = (cH || 0) * 60 + (cM || 0) + (nextDay ? 1440 : 0);
                          const durationMin = endMin - startMin;
                          const validDuration = durationMin > 0;
                          const hours = validDuration ? Math.floor(durationMin / 60) : 0;
                          const mins = validDuration ? durationMin % 60 : 0;
                          return (
                            <div className="settings-item-row">
                              <div className="settings-item-copy">
                                <span className="block text-sm font-semibold text-slate-700">
                                  {isRtl ? 'وقت فتح وإغلاق الوردية اليومية' : 'Daily Shift Opening & Closing Time'}
                                </span>
                                <span className="mt-0.5 block text-xs text-slate-500">
                                  {isRtl
                                    ? 'يمكن للمستخدم إنشاء السندات فقط ضمن فترة الوردية المحددة.'
                                    : 'Users can only create vouchers within this shift time window.'}
                                </span>
                                <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                  <span>{isRtl ? 'مدة الوردية:' : 'Shift Duration:'}</span>
                                  {validDuration ? (
                                    <span className="font-mono">
                                      {hours}h {mins}m
                                    </span>
                                  ) : (
                                    <span className="text-red-600">
                                      {isRtl ? 'وقت الإغلاق قبل الفتح (فعّل اليوم التالي)' : 'Closing is before opening (enable Next Day)'}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-end gap-3">
                                <label className="text-xs font-semibold text-slate-600">
                                  <span className="mb-1 block">{isRtl ? 'وقت الفتح' : 'Opening Time'}</span>
                                  <input
                                    type="time"
                                    value={openStr}
                                    onChange={(e) =>
                                      setForm((cur) => ({
                                        ...cur,
                                        dailyShiftOpenTime: e.target.value || '00:00',
                                      }))
                                    }
                                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                                  />
                                </label>
                                <label className="text-xs font-semibold text-slate-600">
                                  <span className="mb-1 block">{isRtl ? 'وقت الإغلاق' : 'Closing Time'}</span>
                                  <input
                                    type="time"
                                    value={closeStr}
                                    onChange={(e) =>
                                      setForm((cur) => ({
                                        ...cur,
                                        dailyShiftCloseTime: e.target.value || '23:59',
                                      }))
                                    }
                                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                                  />
                                </label>
                                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                                  <input
                                    type="checkbox"
                                    checked={nextDay}
                                    onChange={(e) =>
                                      setForm((cur) => ({
                                        ...cur,
                                        dailyShiftCloseNextDay: e.target.checked,
                                      }))
                                    }
                                    className="h-3.5 w-3.5 accent-emerald-700"
                                  />
                                  <span>{isRtl ? 'اليوم التالي' : 'Next Day'}</span>
                                </label>
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </>
                  )}
                  {activeSettingsSection === 'customers' && (
                  <div className="settings-item-row settings-input-row">
                    <label className="settings-item-copy text-sm font-semibold text-slate-700">
                      Default Walk-in Customer Label
                    </label>
                    <input
                      type="text"
                      value={form.defaultCustomer}
                      onChange={(e) => setForm({ ...form, defaultCustomer: e.target.value })}
                      placeholder="Walk-in Customer"
                      className="settings-item-control border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                  )}
                  {activeSettingsSection === 'general' && (
                  <div className="settings-item-row settings-input-row">
                    <label className="settings-item-copy text-sm font-semibold text-slate-700">
                      Active Cashier Shift Name
                    </label>
                    <input
                      type="text"
                      value={form.cashierName}
                      onChange={(e) => setForm({ ...form, cashierName: e.target.value })}
                      className="settings-item-control border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                  )}
                </div>
                )}

                {activeSettingsSection === 'payment' && (
                <section className="space-y-2">
                  <div className="px-1">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {isRtl ? 'طرق الدفع' : 'Payment Methods'}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {isRtl
                        ? 'أضف طرق دفع مخصصة لتظهر عند إتمام البيع.'
                        : 'Add custom payment methods to make them available at checkout.'}
                    </p>
                  </div>
                  <div className="settings-item-list settings-item-row">
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
                          handleSavePaymentMethod();
                        }
                      }}
                      placeholder={isRtl ? 'مثال: تحويل بنكي' : 'e.g. Bank Transfer'}
                      aria-label={
                        editingPaymentMethod
                          ? (isRtl ? 'تعديل اسم طريقة الدفع' : 'Edit payment method name')
                          : (isRtl ? 'اسم طريقة الدفع الجديدة' : 'New payment method name')
                      }
                      className="settings-item-control border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSavePaymentMethod}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                    >
                      {editingPaymentMethod ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      {editingPaymentMethod
                        ? (isRtl ? 'تحديث طريقة الدفع' : 'Update Payment Method')
                        : (isRtl ? 'إضافة طريقة دفع' : 'Add New Payment Method')}
                    </button>
                    {editingPaymentMethod && (
                      <button
                        type="button"
                        onClick={handleCancelPaymentMethodEdit}
                        aria-label={isRtl ? 'إلغاء تعديل طريقة الدفع' : 'Cancel payment method edit'}
                        className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {paymentMethodError && (
                    <p role="alert" className="settings-item-row text-xs text-red-700">
                      {paymentMethodError}
                    </p>
                  )}
                  <div className="settings-item-list">
                    <div className="settings-item-row flex-wrap gap-2">
                      {paymentMethods.map((method) => {
                        const isBuiltIn = isBuiltInPaymentMethod(method);
                        return (
                          <div
                            key={method}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                          >
                            <span>{method}</span>
                            {isBuiltIn ? (
                              <span className="text-[10px] text-slate-400">
                                {isRtl ? 'افتراضي' : 'Default'}
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleEditPaymentMethod(method)}
                                  aria-label={`${isRtl ? 'تعديل' : 'Edit'} ${method}`}
                                  className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePaymentMethod(method)}
                                  aria-label={`${isRtl ? 'حذف' : 'Delete'} ${method}`}
                                  className="rounded-full p-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="settings-item-row text-[11px] text-slate-500">
                      {isRtl
                        ? 'احفظ الإعدادات لتطبيق التغييرات.'
                        : 'Save Settings to apply changes.'}
                    </p>
                  </div>
                </section>
                )}

                {/* Operational Toggles */}
                {(activeSettingsSection === 'general' || activeSettingsSection === 'billing') && (
                <section className="space-y-2">
                  <h3 className="px-1 text-sm font-semibold text-slate-900">
                    {activeSettingsSection === 'billing'
                      ? (isRtl ? 'إعدادات الفوترة' : 'Billing Options')
                      : (isRtl ? 'سلوك التطبيق' : 'App Behavior')}
                  </h3>

                  <div className="settings-item-list">
                  {activeSettingsSection === 'general' && (
                  <div className="settings-item-row settings-toggle-row">
                    <div className="settings-item-copy">
                      <span className="font-semibold text-slate-900 block">
                        Allow Negative Inventory Billing
                      </span>
                      <span className="text-[11px] text-slate-500">
                        When enabled, cashiers can complete sales even if SQLite stock count is zero or uncounted.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Allow Negative Inventory Billing"
                      aria-checked={form.allowNegativeStock}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          allowNegativeStock: !current.allowNegativeStock,
                        }))
                      }
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                        form.allowNegativeStock ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          isRtl ? 'right-0.5' : 'left-0.5'
                        } ${
                          form.allowNegativeStock
                            ? isRtl
                              ? '-translate-x-4'
                              : 'translate-x-4'
                            : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  )}

                  {activeSettingsSection === 'billing' && (
                  <div className="settings-item-row settings-toggle-row">
                    <div className="settings-item-copy">
                      <span className="font-semibold text-slate-900 block">
                        Cash Rounding to Nearest 5 Cents (Swedish Rounding)
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Rounds checkout balance to $0.05 for countries eliminating 1-cent coins.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Cash Rounding to Nearest 5 Cents"
                      aria-checked={form.roundTotalToFiveCents}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          roundTotalToFiveCents: !current.roundTotalToFiveCents,
                        }))
                      }
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                        form.roundTotalToFiveCents ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          isRtl ? 'right-0.5' : 'left-0.5'
                        } ${
                          form.roundTotalToFiveCents
                            ? isRtl
                              ? '-translate-x-4'
                              : 'translate-x-4'
                            : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  )}

                  {activeSettingsSection === 'general' && (
                  <div className="settings-item-row settings-toggle-row">
                    <div className="settings-item-copy">
                      <span className="font-semibold text-slate-900 block">
                        Audio Beep Feedback on Barcode Scan
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Synthesizes a short POS scan tone via Web Audio API whenever an item is added to the cart.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Audio Beep Feedback on Barcode Scan"
                      aria-checked={form.barcodeScanBeep}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          barcodeScanBeep: !current.barcodeScanBeep,
                        }))
                      }
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                        form.barcodeScanBeep ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          isRtl ? 'right-0.5' : 'left-0.5'
                        } ${
                          form.barcodeScanBeep
                            ? isRtl
                              ? '-translate-x-4'
                              : 'translate-x-4'
                            : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  )}
                  </div>
                </section>
                )}

                {activeSettingsSection === 'billing' && (
                  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {isRtl ? 'ترقيم الفواتير' : 'Invoice Numbering'}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {isRtl
                        ? 'يتم إصدار أرقام فواتير المبيعات تلقائياً والتحقق من تفردها عند إتمام البيع.'
                        : 'Sales invoice numbers are issued automatically and checked for uniqueness when a sale is completed.'}
                    </p>
                  </section>
                )}

                {activeSettingsSection === 'print' && (
                  <div className="space-y-4">
                    {/* Enable KOT & KOT Printer Selection */}
                    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <label htmlFor="enable-kot-toggle" className="cursor-pointer">
                          <span className="block text-sm font-semibold text-slate-900">
                            {isRtl ? 'تفعيل طلب المطبخ (KOT)' : 'Enable KOT'}
                          </span>
                        </label>
                        <input
                          id="enable-kot-toggle"
                          type="checkbox"
                          checked={Boolean(form.enableKot)}
                          onChange={(e) => setForm((cur) => ({ ...cur, enableKot: e.target.checked }))}
                          className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                        />
                      </div>

                      {form.enableKot && (
                        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                          <label htmlFor="kot-printer-select" className="text-xs font-semibold text-slate-700">
                            {isRtl ? 'طابعة KOT' : 'KOT Printer'}
                          </label>
                          <div className="flex items-center gap-2 sm:w-80">
                            <select
                              id="kot-printer-select"
                              value={form.kotPrinter || ''}
                              onChange={(e) => {
                                const printerName = e.target.value;
                                setForm((cur) => {
                                  const kotFormat = getPrintDocumentFormat(cur, 'kot', cur.paperWidth || '80mm');
                                  const existingKotProfile = cur.printDocumentProfiles?.kot?.[kotFormat];
                                  const kotTemplates = getPrintTemplates('kot', kotFormat);
                                  return {
                                    ...cur,
                                    kotPrinter: printerName || undefined,
                                    printDocumentProfiles: {
                                      ...cur.printDocumentProfiles,
                                      kot: {
                                        ...cur.printDocumentProfiles?.kot,
                                        [kotFormat]: {
                                          templateId: existingKotProfile?.templateId || kotTemplates[0]?.id || '',
                                          printerName: printerName || undefined,
                                          printerMode: printerName ? 'saved-printer' : 'system-default',
                                        },
                                      },
                                    },
                                  };
                                });
                              }}
                              className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-emerald-600"
                            >
                              <option value="">
                                {isRtl ? 'الطابعة الافتراضية للنظام' : 'System Default Printer'}
                              </option>
                              {availablePrinters.map((printer) => (
                                <option key={printer.name} value={printer.name}>
                                  {printer.displayName || printer.name}
                                </option>
                              ))}
                              {form.kotPrinter && !availablePrinters.some((p) => p.name === form.kotPrinter) && (
                                <option value={form.kotPrinter}>{form.kotPrinter}</option>
                              )}
                            </select>
                            {window.electronAPI?.listPrinters && (
                              <button
                                type="button"
                                onClick={() => void loadPrinters()}
                                disabled={loadingPrinters}
                                title={isRtl ? 'تحديث الطابعات' : 'Refresh printers'}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${loadingPrinters ? 'animate-spin' : ''}`} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
                        <label htmlFor="enable-cash-receipt-toggle" className="cursor-pointer">
                          <span className="block text-sm font-semibold text-slate-900">
                            {isRtl ? 'تفعيل الإيصال النقدي / البنكي' : 'Enable Cash / Bank Receipt'}
                          </span>
                        </label>
                        <input
                          id="enable-cash-receipt-toggle"
                          type="checkbox"
                          checked={Boolean(form.enableCashReceipt)}
                          onChange={(e) => setForm((cur) => ({ ...cur, enableCashReceipt: e.target.checked }))}
                          className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                        />
                      </div>
                    </section>

                    {/* Voucher-wise Template, Printer & Preview */}
                    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <Printer className="h-4 w-4 text-emerald-700" />
                          <h3 className="text-sm font-semibold text-slate-900">
                            {isRtl ? 'قوالب وطابعات السندات' : 'Voucher Templates & Printers'}
                          </h3>
                        </div>
                        {window.electronAPI?.listPrinters && (
                          <button
                            type="button"
                            onClick={() => void loadPrinters()}
                            disabled={loadingPrinters}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${loadingPrinters ? 'animate-spin' : ''}`} />
                            {isRtl ? 'تحديث الطابعات' : 'Refresh Printers'}
                          </button>
                        )}
                      </div>

                      {voucherPreviewError && (
                        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          {voucherPreviewError}
                        </p>
                      )}

                      <div className="divide-y divide-slate-100">
                        {PRINT_DOCUMENT_OPTIONS.filter(
                          (option) =>
                            (option.id !== 'kot' || Boolean(form.enableKot)) &&
                            ((option.id !== 'cash-receipt' && option.id !== 'bank-receipt') || Boolean(form.enableCashReceipt))
                        ).map((option) => {
                          const supportedFormats = getPrintFormats(option.id);
                          const defaultFallbackFormat: PaperWidth =
                            appScreenMode === 'flyerp' &&
                            (option.id === 'sales-invoice' || option.id === 'cash-receipt' || option.id === 'bank-receipt')
                              ? 'A4'
                              : form.paperWidth || '80mm';
                          const activeFormat = getPrintDocumentFormat(
                            form,
                            option.id,
                            defaultFallbackFormat
                          );
                          const templates = getPrintTemplates(option.id, activeFormat);
                          const currentProfile = form.printDocumentProfiles?.[option.id]?.[activeFormat];
                          const selectedTemplateId = templates.some((t) => t.id === currentProfile?.templateId)
                            ? currentProfile!.templateId
                            : (templates[0]?.id || '');
                          const selectedPrinter = currentProfile?.printerName || '';
                          const label = option.label;
                          const isPreviewLoading = voucherPreviewLoading === option.id;
                          const isExpanded = expandedVoucher === option.id;
                          const resolvedMargins = resolveInvoiceMarginsMm(
                            activeFormat,
                            currentProfile?.marginsMm ?? form.invoiceMarginsMm
                          );
                          const logoEnabled = currentProfile?.enableLogo !== undefined
                            ? currentProfile.enableLogo
                            : form.invoiceShowStoreLogo !== false;
                          const logoPreviewUrl = currentProfile?.logoDataUrl || form.storeLogoDataUrl;
                          const englishEnabled = currentProfile?.enableEnglish !== false;
                          const arabicEnabled = currentProfile?.enableArabic !== false;
                          const footerEn = currentProfile?.footer ?? '';
                          const footerAr = currentProfile?.footerAr ?? '';

                          const updateProfile = (patch: Partial<NonNullable<typeof currentProfile>>) => {
                            setForm((cur) => ({
                              ...cur,
                              printDocumentProfiles: {
                                ...cur.printDocumentProfiles,
                                [option.id]: {
                                  ...cur.printDocumentProfiles?.[option.id],
                                  [activeFormat]: {
                                    ...cur.printDocumentProfiles?.[option.id]?.[activeFormat],
                                    templateId:
                                      patch.templateId ??
                                      cur.printDocumentProfiles?.[option.id]?.[activeFormat]?.templateId ??
                                      selectedTemplateId,
                                    ...patch,
                                  },
                                },
                              },
                            }));
                          };

                          const handleProfileLogoPick = async (
                            event: React.ChangeEvent<HTMLInputElement>
                          ) => {
                            const input = event.currentTarget;
                            const file = input.files?.[0];
                            input.value = '';
                            if (!file) return;
                            if (!STORE_LOGO_MIME_TYPES.has(file.type)) {
                              setVoucherPreviewError(isRtl
                                ? 'اختر صورة بصيغة PNG أو JPEG أو WebP.'
                                : 'Choose a PNG, JPEG, or WebP image.');
                              return;
                            }
                            if (file.size > MAX_STORE_LOGO_FILE_SIZE) {
                              setVoucherPreviewError(isRtl
                                ? 'يجب ألا يتجاوز حجم الصورة 1 ميجابايت.'
                                : 'The image must be 1 MB or smaller.');
                              return;
                            }
                            try {
                              const dataUrl = await readImageDataUrl(file);
                              setVoucherPreviewError(null);
                              updateProfile({
                                logoDataUrl: dataUrl,
                                enableLogo: true,
                              });
                            } catch (err) {
                              setVoucherPreviewError(err instanceof Error ? err.message : 'Could not load image.');
                            }
                          };

                          return (
                            <div key={option.id} className="py-2.5 first:pt-1 last:pb-1">
                              <div className="grid grid-cols-1 items-center gap-2.5 lg:grid-cols-[minmax(160px,1.1fr)_minmax(160px,1.2fr)_minmax(160px,1.2fr)_auto]">
                                <button
                                  type="button"
                                  onClick={() => setExpandedVoucher(isExpanded ? null : option.id)}
                                  aria-expanded={isExpanded}
                                  className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-start transition-colors hover:bg-emerald-50/70"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 shrink-0 text-emerald-700" />
                                  ) : (
                                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 ${isRtl ? 'rotate-180' : ''}`} />
                                  )}
                                  <span className="truncate text-xs font-semibold text-slate-900">
                                    {label}
                                  </span>
                                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                                    {activeFormat}
                                  </span>
                                </button>

                                <select
                                  aria-label={`${label} template`}
                                  value={selectedTemplateId}
                                  onChange={(e) => updateProfile({ templateId: e.target.value })}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-600"
                                >
                                  {templates.map((template) => (
                                    <option key={template.id} value={template.id}>
                                      {template.label}
                                    </option>
                                  ))}
                                </select>

                                <select
                                  aria-label={`${label} printer`}
                                  value={selectedPrinter}
                                  onChange={(e) => {
                                    const nextPrinter = e.target.value;
                                    setForm((cur) => ({
                                      ...cur,
                                      ...(option.id === 'kot' ? { kotPrinter: nextPrinter || undefined } : {}),
                                      printDocumentProfiles: {
                                        ...cur.printDocumentProfiles,
                                        [option.id]: {
                                          ...cur.printDocumentProfiles?.[option.id],
                                          [activeFormat]: {
                                            ...cur.printDocumentProfiles?.[option.id]?.[activeFormat],
                                            templateId: selectedTemplateId,
                                            printerName: nextPrinter || undefined,
                                            printerMode: nextPrinter ? 'saved-printer' : 'system-default',
                                          },
                                        },
                                      },
                                    }));
                                  }}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-600"
                                >
                                  <option value="">
                                    {isRtl ? 'الطابعة الافتراضية' : 'System Default'}
                                  </option>
                                  {availablePrinters.map((printer) => (
                                    <option key={printer.name} value={printer.name}>
                                      {printer.displayName || printer.name}
                                    </option>
                                  ))}
                                  {selectedPrinter && !availablePrinters.some((p) => p.name === selectedPrinter) && (
                                    <option value={selectedPrinter}>{selectedPrinter}</option>
                                  )}
                                </select>

                                <button
                                  type="button"
                                  disabled={isPreviewLoading || !selectedTemplateId}
                                  onClick={() => void handlePreviewVoucher(option.id, label, activeFormat, selectedTemplateId)}
                                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                                >
                                  {isPreviewLoading ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                  <span>{isRtl ? 'معاينة' : 'Preview'}</span>
                                </button>
                              </div>

                              {isExpanded && (
                                <div className="mt-3 rounded-xl border border-emerald-200/80 bg-emerald-50/30 p-3.5 space-y-4">
                                  {/* Paper Type & Margins */}
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
                                      <label className="block text-xs font-semibold text-slate-900">
                                        {isRtl ? 'نوع الورق' : 'Paper Type'}
                                      </label>
                                      <select
                                        aria-label={`${label} paper type`}
                                        value={activeFormat}
                                        onChange={(e) => {
                                          const nextFormat = e.target.value as PaperWidth;
                                          setForm((cur) => ({
                                            ...cur,
                                            printDocumentFormats: {
                                              ...cur.printDocumentFormats,
                                              [option.id]: nextFormat,
                                            },
                                          }));
                                        }}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-emerald-600"
                                      >
                                        {supportedFormats.map((fmt) => (
                                          <option key={fmt} value={fmt}>{fmt}</option>
                                        ))}
                                      </select>
                                      {activeFormat === 'Custom' && (
                                        <div className="grid grid-cols-2 gap-2 pt-1">
                                          <label className="block text-[11px] font-medium text-slate-600">
                                            {isRtl ? 'العرض (مم)' : 'Width (mm)'}
                                            <input
                                              type="number"
                                              min={48}
                                              max={420}
                                              value={currentProfile?.customWidthMm ?? 210}
                                              onChange={(e) => updateProfile({
                                                customWidthMm: Math.min(420, Math.max(48, Number(e.target.value) || 210)),
                                              })}
                                              className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-emerald-600"
                                            />
                                          </label>
                                          <label className="block text-[11px] font-medium text-slate-600">
                                            {isRtl ? 'الارتفاع (مم)' : 'Height (mm)'}
                                            <input
                                              type="number"
                                              min={60}
                                              max={594}
                                              value={currentProfile?.customHeightMm ?? 297}
                                              onChange={(e) => updateProfile({
                                                customHeightMm: Math.min(594, Math.max(60, Number(e.target.value) || 297)),
                                              })}
                                              className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-emerald-600"
                                            />
                                          </label>
                                        </div>
                                      )}
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
                                      <span className="block text-xs font-semibold text-slate-900">
                                        {isRtl ? 'الهوامش (مم)' : 'Margins (mm)'}
                                      </span>
                                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                        {([
                                          { key: 'top' as const, label: isRtl ? 'أعلى' : 'Top' },
                                          { key: 'right' as const, label: isRtl ? 'يمين' : 'Right' },
                                          { key: 'bottom' as const, label: isRtl ? 'أسفل' : 'Bottom' },
                                          { key: 'left' as const, label: isRtl ? 'يسار' : 'Left' },
                                        ]).map((side) => {
                                          const draftKey = `${option.id}:${activeFormat}:${side.key}`;
                                          const inputValue = marginDrafts[draftKey] ?? String(resolvedMargins[side.key]);
                                          return (
                                            <label key={side.key} className="block text-[11px] font-medium text-slate-600">
                                              {side.label}
                                              <input
                                                type="text"
                                                inputMode="decimal"
                                                value={inputValue}
                                                onChange={(e) => {
                                                  const raw = e.target.value;
                                                  if (!/^\d*\.?\d*$/.test(raw)) return;
                                                  setMarginDrafts((prev) => ({ ...prev, [draftKey]: raw }));
                                                  if (raw === '' || raw === '.') return;
                                                  const parsed = Number(raw);
                                                  if (!Number.isFinite(parsed)) return;
                                                  updateProfile({
                                                    marginsMm: {
                                                      ...resolvedMargins,
                                                      [side.key]: Math.min(100, Math.max(0, parsed)),
                                                    },
                                                  });
                                                }}
                                                onBlur={() => {
                                                  const raw = marginDrafts[draftKey];
                                                  if (raw !== undefined) {
                                                    const parsed = Number(raw);
                                                    const normalized = raw.trim() === '' || !Number.isFinite(parsed)
                                                      ? 0
                                                      : Math.min(100, Math.max(0, parsed));
                                                    updateProfile({
                                                      marginsMm: {
                                                        ...resolvedMargins,
                                                        [side.key]: normalized,
                                                      },
                                                    });
                                                    setMarginDrafts((prev) => {
                                                      const next = { ...prev };
                                                      delete next[draftKey];
                                                      return next;
                                                    });
                                                  }
                                                }}
                                                className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-xs text-slate-900 outline-none focus:border-emerald-600"
                                              />
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Enable Logo & Choose Logo / Print Languages */}
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <label
                                          htmlFor={`enable-logo-${option.id}`}
                                          className="cursor-pointer text-xs font-semibold text-slate-900"
                                        >
                                          {isRtl ? 'تفعيل الشعار' : 'Enable Logo'}
                                        </label>
                                        <input
                                          id={`enable-logo-${option.id}`}
                                          type="checkbox"
                                          checked={logoEnabled}
                                          onChange={(e) => updateProfile({ enableLogo: e.target.checked })}
                                          className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                                        />
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                                          <Upload className="h-3.5 w-3.5" />
                                          <span>{isRtl ? 'اختيار الشعار' : 'Choose Logo'}</span>
                                          <input
                                            type="file"
                                            accept="image/png,image/jpeg,image/webp"
                                            className="sr-only"
                                            onChange={(e) => void handleProfileLogoPick(e)}
                                          />
                                        </label>
                                        {currentProfile?.logoDataUrl && (
                                          <button
                                            type="button"
                                            onClick={() => updateProfile({ logoDataUrl: undefined })}
                                            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                                          >
                                            {isRtl ? 'إزالة' : 'Remove'}
                                          </button>
                                        )}
                                        {logoEnabled && logoPreviewUrl && (
                                          <img
                                            src={logoPreviewUrl}
                                            alt=""
                                            className="h-9 max-w-[110px] rounded border border-slate-200 bg-white object-contain p-0.5"
                                          />
                                        )}
                                      </div>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
                                      <span className="block text-xs font-semibold text-slate-900">
                                        {isRtl ? 'لغة الطباعة' : 'Print Languages'}
                                      </span>
                                      <div className="space-y-2">
                                        <label
                                          htmlFor={`enable-english-${option.id}`}
                                          className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-slate-700"
                                        >
                                          <span>{isRtl ? 'تفعيل الإنجليزية' : 'Enable English'}</span>
                                          <input
                                            id={`enable-english-${option.id}`}
                                            type="checkbox"
                                            checked={englishEnabled}
                                            onChange={(e) => {
                                              const nextEnglish = e.target.checked;
                                              updateProfile({
                                                enableEnglish: nextEnglish,
                                                ...(!nextEnglish && !arabicEnabled ? { enableArabic: true } : {}),
                                              });
                                            }}
                                            className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                                          />
                                        </label>
                                        <label
                                          htmlFor={`enable-arabic-${option.id}`}
                                          className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-slate-700"
                                        >
                                          <span>{isRtl ? 'تفعيل العربية' : 'Enable Arabic'}</span>
                                          <input
                                            id={`enable-arabic-${option.id}`}
                                            type="checkbox"
                                            checked={arabicEnabled}
                                            onChange={(e) => {
                                              const nextArabic = e.target.checked;
                                              updateProfile({
                                                enableArabic: nextArabic,
                                                ...(!nextArabic && !englishEnabled ? { enableEnglish: true } : {}),
                                              });
                                            }}
                                            className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                                          />
                                        </label>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Invoice Footer */}
                                  <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
                                    <span className="block text-xs font-semibold text-slate-900">
                                      {isRtl ? 'تذييل الفاتورة' : 'Invoice Footer'}
                                    </span>
                                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                      <input
                                        type="text"
                                        value={footerEn}
                                        onChange={(e) => updateProfile({ footer: e.target.value })}
                                        placeholder={isRtl ? 'تذييل بالإنجليزية...' : 'Footer text (English)...'}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-emerald-600"
                                      />
                                      <input
                                        type="text"
                                        dir="rtl"
                                        value={footerAr}
                                        onChange={(e) => updateProfile({ footerAr: e.target.value })}
                                        placeholder={isRtl ? 'تذييل بالعربية...' : 'Footer text (Arabic)...'}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-emerald-600"
                                      />
                                    </div>
                                  </div>

                                  {/* Save Button */}
                                  <div className="flex items-center justify-end gap-2">
                                    {savedNotice && (
                                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                        <Check className="h-3.5 w-3.5" />
                                        {isRtl ? 'تم الحفظ' : 'Saved'}
                                      </span>
                                    )}
                                    <button
                                      type="submit"
                                      disabled={saving}
                                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-60"
                                    >
                                      <Save className="h-3.5 w-3.5" />
                                      {saving
                                        ? (isRtl ? 'جارٍ الحفظ…' : 'Saving…')
                                        : (isRtl ? 'حفظ' : 'Save')}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    {voucherPreview && (
                      <div
                        className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"
                        role="dialog"
                        aria-modal="true"
                        onClick={(event) => {
                          if (event.target === event.currentTarget) setVoucherPreview(null);
                        }}
                      >
                        <div className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                            <h3 className="text-sm font-bold text-slate-900">
                              {voucherPreview.title}
                            </h3>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={voucherPreviewPrinting}
                                onClick={async () => {
                                  setVoucherPreviewPrinting(true);
                                  try {
                                    await printTemplateJob({ ...voucherPreview.job, silent: false });
                                  } finally {
                                    setVoucherPreviewPrinting(false);
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                              >
                                <Printer className="h-3.5 w-3.5" />
                                {isRtl ? 'طباعة' : 'Print'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setVoucherPreview(null)}
                                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                                aria-label={isRtl ? 'إغلاق' : 'Close'}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <div className="min-h-0 flex-1 overflow-auto bg-slate-200/80 p-5">
                            <div className="mx-auto flex justify-center">
                              <PrintPreviewFrame
                                job={voucherPreview.job}
                                title={voucherPreview.title}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SECTION 2: STORE & RECEIPT INFO */}
            {activeSettingsSection === 'zatca' && (
              <div className="space-y-4">
                {/* Current Business Details */}
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        {isRtl ? 'بيانات المنشأة الحالية' : 'Current Business Details'}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {isRtl
                          ? 'تُستخدم هذه البيانات في الفاتورة الإلكترونية ورمز QR الخاص بهيئة الزكاة والضريبة والجمارك.'
                          : 'These business details are embedded in your ZATCA e-invoices and QR code.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onActiveSectionChange('business')}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {isRtl ? 'تعديل بيانات المنشأة' : 'Edit Business Profile'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                    {[
                      { label: isRtl ? 'اسم المنشأة' : 'Business Name', value: form.storeName },
                      { label: isRtl ? 'اسم المنشأة بالعربية' : 'Arabic Name', value: form.storeNameAr },
                      { label: isRtl ? 'الرقم الضريبي (VAT)' : 'VAT Number', value: form.taxId, mono: true },
                      { label: isRtl ? 'السجل التجاري (CR)' : 'CR Number', value: form.crNumber, mono: true },
                      { label: isRtl ? 'الهاتف' : 'Phone', value: form.phone, mono: true },
                      {
                        label: isRtl ? 'العنوان' : 'Address',
                        value:
                          [
                            form.buildingNo,
                            form.streetName,
                            form.district,
                            form.city,
                            form.postalCode,
                            form.country,
                          ]
                            .filter((part) => Boolean(part?.trim()))
                            .join(', ') || form.address,
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {item.label}
                        </span>
                        <span className={`mt-0.5 block truncate text-xs font-semibold text-slate-900 ${item.mono ? 'font-mono' : ''}`}>
                          {item.value?.trim() || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* ZATCA E-Invoice Phase */}
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {isRtl ? 'مرحلة الفوترة الإلكترونية (ZATCA)' : 'ZATCA E-Invoice Phase'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {isRtl
                        ? 'اختر مرحلة الامتثال المطبقة على منشأتك.'
                        : 'Select the ZATCA e-invoicing compliance phase for your store.'}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setForm((cur) => ({ ...cur, zatcaPhase: '1' }))}
                      className="flex flex-col items-start rounded-xl border border-emerald-600 bg-emerald-50/70 p-3.5 text-start ring-1 ring-emerald-500 transition-colors"
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-xs font-bold text-emerald-900">
                          {isRtl ? 'المرحلة 1 — الإصدار' : 'Phase 1 — Generation'}
                        </span>
                        <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white">
                          {isRtl ? 'نشط' : 'Active'}
                        </span>
                      </div>
                      <span className="mt-1 text-[11px] text-slate-600">
                        {isRtl
                          ? 'إصدار الفواتير الإلكترونية وحفظها مع رمز QR (TLV).'
                          : 'Generate and store compliant e-invoices with TLV QR code.'}
                      </span>
                    </button>

                    <div
                      aria-disabled="true"
                      className="flex cursor-not-allowed flex-col items-start rounded-xl border border-slate-200 bg-slate-50/90 p-3.5 text-start opacity-75"
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-600">
                          {isRtl ? 'المرحلة 2 — الربط والتكامل' : 'Phase 2 — Integration'}
                        </span>
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {isRtl ? 'غير نشط' : 'Inactive'}
                        </span>
                      </div>
                      <span className="mt-1 text-[11px] font-medium text-amber-800">
                        {isRtl
                          ? 'أنت غير مرتبط بالمرحلة 2. يرجى التواصل مع فريق aptPOS وسيرشدونك.'
                          : 'You are not integrated with Phase 2. Please contact team aptPOS and they will guide you.'}
                      </span>
                    </div>
                  </div>
                </section>

                {/* ZATCA Settings */}
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-4">
                  <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">
                    {isRtl ? 'إعدادات الفوترة الإلكترونية' : 'E-Invoice Settings'}
                  </h3>

                  <label className="flex cursor-pointer items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">
                        {isRtl ? 'تفعيل الفوترة الإلكترونية' : 'Enable E-Invoice'}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {isRtl
                          ? 'عند التفعيل، لا يمكن لأي مستخدم (حتى مدير الشركة) حذف فواتير المبيعات أو مرتجعات المبيعات.'
                          : 'When enabled, Sales and Sales Return vouchers cannot be deleted by any user (including company admin).'}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={isRtl ? 'تفعيل الفوترة الإلكترونية' : 'Enable E-Invoice'}
                      checked={form.enableZatcaEinvoice === true}
                      onChange={(event) =>
                        setForm((cur) => ({ ...cur, enableZatcaEinvoice: event.target.checked }))
                      }
                      className="peer sr-only"
                    />
                    <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-emerald-600 peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4" />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-slate-100 pt-3">
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">
                        {isRtl ? 'تفعيل رمز QR في الفواتير' : 'Enable QR Code in Invoices'}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {isRtl
                          ? 'عرض رمز الاستجابة السريعة ZATCA QR على الفواتير المطبوعة.'
                          : 'Show the ZATCA QR code on printed sales invoices.'}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={isRtl ? 'تفعيل رمز QR في الفواتير' : 'Enable QR Code in Invoices'}
                      checked={form.invoiceShowQrCode !== false}
                      onChange={(event) =>
                        setForm((cur) => ({ ...cur, invoiceShowQrCode: event.target.checked }))
                      }
                      className="peer sr-only"
                    />
                    <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-emerald-600 peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4" />
                  </label>

                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800">
                        {isRtl ? 'حجم رمز QR (مم)' : 'QR Code Size (mm)'}
                      </span>
                      <span className="font-mono text-xs font-bold text-emerald-700">
                        {form.invoiceQrCodeSizeMm ?? 25} mm
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={15}
                        max={50}
                        step={1}
                        value={form.invoiceQrCodeSizeMm ?? 25}
                        onChange={(e) =>
                          setForm((cur) => ({ ...cur, invoiceQrCodeSizeMm: Number(e.target.value) }))
                        }
                        className="flex-1 accent-emerald-700"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(form.invoiceQrCodeSizeMm ?? 25)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!/^\d*$/.test(raw)) return;
                          if (raw === '') return;
                          const parsed = Number(raw);
                          if (Number.isFinite(parsed)) {
                            setForm((cur) => ({
                              ...cur,
                              invoiceQrCodeSizeMm: Math.min(50, Math.max(15, parsed)),
                            }));
                          }
                        }}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right font-mono text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                      />
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeSettingsSection === 'business' && (
              <div className="space-y-4">
                <div className="px-1">
                  <h2 className="text-[15px] font-semibold text-[#1f1f1f] flex items-center gap-2">
                    <Store className="w-4 h-4 text-[#0f6cbd]" />
                    <span>Store Profile</span>
                  </h2>
                  <p className="text-xs text-[#666] mt-1">
                    Business identity, contact details, and receipt branding for your store.
                  </p>
                </div>

                <div className="settings-item-list settings-field-list">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
                      {form.storeLogoDataUrl ? (
                        <img
                          src={form.storeLogoDataUrl}
                          alt={isRtl ? 'شعار المتجر' : 'Store logo'}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Store className="h-8 w-8 text-slate-300" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-700">
                        {isRtl ? 'شعار المتجر' : 'Store Logo'}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        {isRtl
                          ? 'يظهر الشعار في معاينة وطباعة الفواتير وطلبات المطبخ. PNG أو JPEG أو WebP، بحد أقصى 1 ميجابايت.'
                          : 'Shown on invoice and KOT previews and prints. PNG, JPEG, or WebP; maximum 1 MB.'}
                      </p>
                      <input
                        ref={storeLogoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => void handleStoreLogoChange(event)}
                        className="hidden"
                        aria-label={isRtl ? 'اختيار شعار المتجر' : 'Choose store logo'}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => storeLogoInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {isRtl ? 'رفع الشعار' : 'Upload logo'}
                        </button>
                        {form.storeLogoDataUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setForm((current) => ({ ...current, storeLogoDataUrl: '' }));
                              setStoreLogoError(null);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {isRtl ? 'إزالة الشعار' : 'Remove logo'}
                          </button>
                        )}
                      </div>
                      {storeLogoError && (
                        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
                          {storeLogoError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="font-medium text-slate-700">
                        {isRtl ? 'حجم الشعار في الطباعة (مم)' : 'Logo Size on Prints (mm)'}
                      </label>
                      <span className="font-mono text-xs font-bold text-emerald-700">
                        {form.invoiceLogoSizeMm ?? 34} mm
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={12}
                        max={60}
                        step={1}
                        value={form.invoiceLogoSizeMm ?? 34}
                        onChange={(e) =>
                          setForm((cur) => ({ ...cur, invoiceLogoSizeMm: Number(e.target.value) }))
                        }
                        className="flex-1 accent-emerald-700"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(form.invoiceLogoSizeMm ?? 34)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (!/^\d*$/.test(raw)) return;
                          if (raw === '') return;
                          const parsed = Number(raw);
                          if (Number.isFinite(parsed)) {
                            setForm((cur) => ({
                              ...cur,
                              invoiceLogoSizeMm: Math.min(60, Math.max(12, parsed)),
                            }));
                          }
                        }}
                        className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                  </div>

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
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block font-medium text-slate-700">
                        Store Name (Arabic) / اسم المتجر بالعربية *
                      </label>
                      <button
                        type="button"
                        disabled={translatingStoreNameAr || !form.storeName.trim()}
                        onClick={async () => {
                          setTranslatingStoreNameAr(true);
                          try {
                            const translated = await translateEnglishToArabic(form.storeName);
                            setForm((cur) => ({ ...cur, storeNameAr: translated }));
                          } catch {
                            // Ignore transient translation error
                          } finally {
                            setTranslatingStoreNameAr(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-45"
                      >
                        <Globe className={`h-3 w-3 ${translatingStoreNameAr ? 'animate-spin' : ''}`} />
                        <span>{isRtl ? 'ترجمة للعربية' : 'Translate to Arabic'}</span>
                      </button>
                    </div>
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

                  <div>
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

            {/* SECTION 5: DATABASE MAINTENANCE, BACKUP & RESTORE */}
            {activeSettingsSection === 'database' && (
              <div className="space-y-4">
                <div className="px-1">
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

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {isRtl ? 'جدولة النسخ الاحتياطي' : 'Backup Schedule'}
                      </h3>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {isRtl
                          ? 'اختر وقت إنشاء النسخ الاحتياطية وسلوك الإغلاق.'
                          : 'Choose when backups are created and how closing behaves.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveBackupConfiguration}
                      disabled={backupSettingsBusy || !window.electronAPI?.setBackupConfiguration}
                      className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {backupSettingsBusy
                        ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...')
                        : (isRtl ? 'حفظ إعدادات النسخ' : 'Save Backup Settings')}
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
                    {([
                      {
                        value: 'on-close',
                        title: isRtl ? 'عند الإغلاق' : 'On Close',
                        description: isRtl
                          ? 'اسأل قبل الإغلاق لإنشاء نسخة احتياطية.'
                          : 'Ask to create a backup when closing.',
                      },
                      {
                        value: 'manual',
                        title: isRtl ? 'يدوي' : 'Manual',
                        description: isRtl
                          ? 'أنشئ النسخ الاحتياطية يدوياً فقط، دون سؤال عند الإغلاق.'
                          : 'Back up only when requested; no prompt on close.',
                      },
                      {
                        value: 'scheduled',
                        title: isRtl ? 'مجدول' : 'Scheduled',
                        description: isRtl
                          ? 'أنشئ نسخة يومياً في الوقت المحدد أثناء تشغيل التطبيق.'
                          : 'Back up daily at the selected time while the app is running.',
                      },
                    ] satisfies Array<{ value: BackupMode; title: string; description: string }>).map((option) => (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                          backupMode === option.value
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        } ${!window.electronAPI?.setBackupConfiguration ? 'pointer-events-none opacity-50' : ''}`}
                      >
                        <input
                          type="radio"
                          name="backup-mode"
                          value={option.value}
                          checked={backupMode === option.value}
                          disabled={!window.electronAPI?.setBackupConfiguration || backupSettingsBusy}
                          onChange={() => setBackupMode(option.value)}
                          className="mt-0.5 accent-blue-700"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-slate-900">{option.title}</span>
                          <span className="mt-1 block text-[10px] leading-relaxed text-slate-600">
                            {option.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {backupMode === 'scheduled' && (
                    <label className="mt-4 flex items-center gap-3 text-xs font-semibold text-slate-700">
                      {isRtl ? 'وقت النسخ اليومي' : 'Daily backup time'}
                      <input
                        type="time"
                        value={scheduledBackupTime}
                        onChange={(event) => setScheduledBackupTime(event.target.value)}
                        disabled={!window.electronAPI?.setBackupConfiguration || backupSettingsBusy}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                      />
                    </label>
                  )}
                  {!window.electronAPI?.isElectron && (
                    <p className="mt-3 text-[10px] text-slate-500">
                      {isRtl
                        ? 'إعدادات الجدولة متاحة في تطبيق سطح المكتب فقط.'
                        : 'Backup scheduling is available in the installed desktop app only.'}
                    </p>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Database className="h-4 w-4 text-blue-700" />
                        {isRtl ? 'مجلد النسخ الاحتياطي' : 'Backup Folder'}
                      </h3>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {isRtl
                          ? 'تُحفظ النسخ التي تُنشأ عند إغلاق aptPOS في هذا المجلد.'
                          : 'Backups created when closing aptPOS are saved here.'}
                      </p>
                      <p className="mt-2 break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        {backupDirectory || (window.electronAPI?.isElectron ? 'Loading...' : 'Desktop app only')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:w-44">
                      <button
                        type="button"
                        onClick={handleChooseBackupDirectory}
                        disabled={backupActionBusy || !window.electronAPI?.chooseBackupDirectory}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isRtl ? 'اختيار مجلد' : 'Choose Folder'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateBackup}
                        disabled={backupActionBusy || !window.electronAPI?.createDatabaseBackup}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {backupActionBusy ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {isRtl ? 'إنشاء نسخة الآن' : 'Back Up Now'}
                      </button>
                    </div>
                  </div>
                  {backupActionError && (
                    <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      {backupActionError}
                    </p>
                  )}
                  {backupActionNotice && (
                    <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      {backupActionNotice}
                    </p>
                  )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-blue-700" />
                        <h3 className="text-sm font-semibold text-slate-900">Google Drive</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          googleDriveStatus?.connected
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {googleDriveStatus?.connected
                            ? (isRtl ? 'متصل' : 'Connected')
                            : (isRtl ? 'غير متصل' : 'Not connected')}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {isRtl
                          ? 'عند الاتصال، تُرفع نسخة إضافية إلى Google Drive مع حفظ النسخة المحلية.'
                          : 'When connected, backups are uploaded to Google Drive in addition to the local folder.'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={googleDriveClientId}
                      onChange={(event) => setGoogleDriveClientId(event.target.value)}
                      disabled={googleDriveBusy || googleDriveStatus?.connected}
                      aria-label={isRtl ? 'معرّف عميل Google OAuth' : 'Google OAuth Desktop app Client ID'}
                      placeholder="Google OAuth Desktop app Client ID"
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={googleDriveStatus?.connected
                        ? handleDisconnectGoogleDrive
                        : handleConnectGoogleDrive}
                      disabled={
                        googleDriveBusy ||
                        (googleDriveStatus?.connected
                          ? !window.electronAPI?.disconnectGoogleDrive
                          : !googleDriveClientId.trim() || !window.electronAPI?.connectGoogleDrive)
                      }
                      className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                        googleDriveStatus?.connected
                          ? 'bg-slate-700 hover:bg-slate-800'
                          : 'bg-blue-700 hover:bg-blue-800'
                      }`}
                    >
                      {googleDriveBusy
                        ? (isRtl ? 'جارٍ الاتصال...' : 'Connecting...')
                        : googleDriveStatus?.connected
                          ? (isRtl ? 'فصل الحساب' : 'Disconnect')
                          : (isRtl ? 'ربط Google Drive' : 'Connect Google Drive')}
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    {isRtl ? 'يتطلب معرّف عميل OAuth لتطبيق سطح المكتب.' : 'Requires a Google OAuth Desktop app Client ID.'}{' '}
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-blue-700 hover:text-blue-800"
                    >
                      {isRtl ? 'إعداد بيانات الاعتماد' : 'Set up credentials'}
                    </a>
                  </p>
                  {googleDriveError && (
                    <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      {googleDriveError}
                    </p>
                  )}
                  {googleDriveNotice && (
                    <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      {googleDriveNotice}
                    </p>
                  )}
                </section>

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
                        setResetAdminPassword('');
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
                <div className="px-1">
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

                {settings.registeredSystem && settings.registrationDetails && (
                  (() => {
                    const registeredUser = usersList.find(
                      (user) => user.username === settings.registrationDetails?.username
                    );
                    return registeredUser ? (
                      <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                            <Shield className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                              {isRtl ? 'مستخدم التسجيل الرئيسي' : 'Registered primary account'}
                            </p>
                            <p className="mt-0.5 font-mono text-sm font-bold text-slate-900">
                              {registeredUser.username}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-600">
                              {registeredUser.displayName} · {registeredUser.role}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenEditUser(registeredUser)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 shadow-xs hover:bg-emerald-100"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          {isRtl ? 'إدارة بيانات المستخدم' : 'Manage account'}
                        </button>
                      </div>
                    ) : null;
                  })()
                )}

                {/* User list */}
                <div className="settings-item-list">
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
                      const isRegisteredPrimary =
                        settings.registeredSystem &&
                        settings.registrationDetails?.username === u.username;
                      return (
                        <div
                          key={u.id}
                          className="settings-item-row"
                        >
                            <div className="settings-item-copy flex items-center gap-3">
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
                                {isRegisteredPrimary && (
                                  <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                    {isRtl ? 'مستخدم التسجيل' : 'Registered'}
                                  </span>
                                )}
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
                              disabled={isPrimaryAdmin}
                              aria-label={isPrimaryAdmin ? 'Primary company admin cannot be edited' : `Edit ${u.username}`}
                              className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                              title={isPrimaryAdmin ? 'Primary company admin cannot be edited' : 'Edit user'}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {!isPrimaryAdmin && !isRegisteredPrimary && (
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
                    <span><span className="font-medium text-slate-700">sales</span> — Sales history</span>
                    <span><span className="font-medium text-slate-700">inventory</span> — Product catalog & stock</span>
                    <span><span className="font-medium text-slate-700">purchases</span> — Purchase orders</span>
                    <span><span className="font-medium text-slate-700">customers</span> — Customer ledger</span>
                    <span><span className="font-medium text-slate-700">vendors</span> — Vendor accounts</span>
                    <span><span className="font-medium text-slate-700">accounts</span> — Cashbook access</span>
                    <span><span className="font-medium text-slate-700">reports</span> — Business reports</span>
                    <span><span className="font-medium text-slate-700">settings</span> — System settings</span>
                  </div>
                </div>
              </div>
            )}

          </form>



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

            <label htmlFor="reset-admin-password" className="block text-xs font-semibold text-slate-700">
              App admin password
              <input
                id="reset-admin-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={resetAdminPassword}
                onChange={(event) => setResetAdminPassword(event.target.value)}
                disabled={isResetting}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
              />
            </label>

            {resetError && (
              <p role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
                {resetError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isResetting}
                onClick={() => {
                  setShowResetModal(false);
                  setResetAdminPassword('');
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isResetting || !resetAdminPassword.trim()}
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

      {activeSettingsSection === 'updates' && updateSettingsPanel === 'software' && (
        <div className="settings-content-scroll flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
          {renderUpdatePanelTabs()}
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <RefreshCw className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-semibold text-slate-900">
              {isRtl ? 'تحديثات aptPOS' : 'Software Updates'}
            </h2>
          </div>
          {!window.electronAPI?.checkForUpdates ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm" role="status">
              <Monitor className="h-5 w-5 shrink-0 text-slate-400" />
              <p className="text-sm">
                {isRtl
                  ? 'التحقق من التحديثات متاح في تطبيق سطح المكتب فقط.'
                  : 'Update checks are available in the installed desktop app only.'}
              </p>
            </div>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                    updateStatus.state === 'error' || updateActionError
                      ? 'bg-red-50 text-red-600'
                      : updateStatus.state === 'up-to-date' || updateStatus.state === 'downloaded'
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-blue-50 text-blue-700'
                  }`}>
                    {updateStatus.state === 'error' || updateActionError
                      ? <AlertTriangle className="h-5 w-5" />
                      : updateStatus.state === 'up-to-date' || updateStatus.state === 'downloaded'
                        ? <Check className="h-5 w-5" />
                        : <RefreshCw className={`h-5 w-5 ${updateStatus.state === 'checking' || updateStatus.state === 'backing-up' ? 'animate-spin' : ''}`} />}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${
                      updateStatus.state === 'error' || updateActionError
                        ? 'text-red-700'
                        : updateStatus.state === 'up-to-date' || updateStatus.state === 'downloaded'
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                    }`} role="status">
                      {updateActionError || (() => {
                        switch (updateStatus.state) {
                          case 'idle':
                            return isRtl ? 'جاهز للتحقق' : 'Ready to check';
                          case 'checking':
                            return isRtl ? 'جارٍ التحقق من التحديثات...' : 'Checking for updates...';
                          case 'available':
                            return isRtl
                              ? `يتوفر الإصدار ${updateStatus.version}. أكّد التنزيل للمتابعة.`
                              : `Version ${updateStatus.version} is available. Confirm to download.`;
                          case 'downloading':
                            return isRtl
                              ? `جارٍ تنزيل الإصدار ${updateStatus.version}...`
                              : `Downloading version ${updateStatus.version}...`;
                          case 'downloaded':
                            return isRtl
                              ? `الإصدار ${updateStatus.version} جاهز للتثبيت.`
                              : `Version ${updateStatus.version} is ready to install.`;
                          case 'backing-up':
                            return isRtl
                              ? `جارٍ إنشاء نسخة احتياطية قبل تثبيت الإصدار ${updateStatus.version}...`
                              : `Creating a backup before installing version ${updateStatus.version}...`;
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
                            return '';
                        }
                      })()}
                    </p>
                    {updateStatus.state === 'available' ||
                    updateStatus.state === 'downloading' ||
                    updateStatus.state === 'backing-up' ||
                    updateStatus.state === 'downloaded' ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {isRtl ? `الإصدار ${updateStatus.version}` : `Version ${updateStatus.version}`}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleCheckForUpdates}
                    disabled={
                      updateStatus.state === 'checking' ||
                      updateStatus.state === 'available' ||
                      updateStatus.state === 'downloading' ||
                      updateStatus.state === 'backing-up' ||
                      updateStatus.state === 'installing' ||
                      updateStatus.state === 'downloaded'
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${updateStatus.state === 'checking' ? 'animate-spin' : ''}`} />
                    {isRtl ? 'تحقق من التحديثات' : 'Check for Updates'}
                  </button>
                  {updateStatus.state === 'available' && (
                    <button
                      type="button"
                      onClick={handleDownloadUpdate}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {isRtl ? 'تنزيل التحديث' : 'Download Update'}
                    </button>
                  )}
                  {updateStatus.state === 'downloaded' && (
                    <button
                      type="button"
                      onClick={handleInstallUpdate}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {isRtl ? 'تثبيت وإعادة التشغيل' : 'Install & Restart'}
                    </button>
                  )}
                </div>
              </div>

              {updateStatus.state === 'downloading' && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <div className="mb-2 flex justify-between text-xs font-medium text-slate-600">
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
                updateStatus.state === 'backing-up' ||
                updateStatus.state === 'downloaded') && (
                <div className="border-t border-slate-100 px-5 py-4">
                  {updateStatus.releaseNotes && (
                    <>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {isRtl ? `ملاحظات الإصدار ${updateStatus.version}` : `Release notes · ${updateStatus.version}`}
                      </h3>
                      <div className="max-h-64 overflow-y-auto rounded-lg bg-slate-50 p-4">
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                          {updateStatus.releaseNotes}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
          </div>
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
                          ? ['register', 'inventory', 'purchases', 'customers', 'vendors', 'accounts', 'reports', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'settings']
                          : role === 'cashier'
                          ? ['register', 'sales', 'reports']
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
                    {(['register', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'inventory', 'purchases', 'customers', 'vendors', 'accounts', 'reports', 'settings'] as const).map((perm) => {
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
                                : perm === 'accounts'
                                  ? 'Accounts'
                                : perm === 'reports'
                                  ? 'Reports'
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


      {versionActivationOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !versionActivationBusy) {
              setVersionActivationOpen(false);
              setVersionAdminPassword('');
              setVersionActivationError(null);
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-activation-title"
            onSubmit={handleVersionActivation}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-blue-50 p-2 text-blue-700">
                <Lock className="h-4 w-4" />
              </span>
              <div>
                <h2 id="version-activation-title" className="text-sm font-bold text-slate-900">
                  {isRtl ? 'تأكيد تفعيل الإصدار' : 'Confirm Version Activation'}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isRtl
                    ? `أدخل كلمة مرور aptadmin لتفعيل ${policyVersion || 'Standard'} وتطبيق خيارات المكونات.`
                    : `Enter the aptadmin password to activate ${policyVersion || 'Standard'} and apply its component access settings.`}
                </p>
              </div>
            </div>
            <label htmlFor="version-admin-password" className="block text-xs font-semibold text-slate-700">
              {isRtl ? 'كلمة مرور مسؤول التطبيق' : 'App admin password'}
            </label>
            <input
              id="version-admin-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={versionAdminPassword}
              onChange={(event) => setVersionAdminPassword(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            {versionActivationError && (
              <p role="alert" className="text-xs font-medium text-rose-700">
                {versionActivationError}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                disabled={versionActivationBusy}
                onClick={() => {
                  setVersionActivationOpen(false);
                  setVersionAdminPassword('');
                  setVersionActivationError(null);
                }}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {isRtl ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={versionActivationBusy || !versionAdminPassword}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {versionActivationBusy
                  ? isRtl ? 'جارٍ التفعيل...' : 'Activating...'
                  : isRtl ? 'تفعيل الإصدار' : 'Activate Version'}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="settings-floating-save">
          {savedNotice && (
            <span className="settings-save-notice" role="status">
              <Check className="h-4 w-4" />
              {isRtl ? 'تم حفظ الإعدادات' : 'Settings saved'}
            </span>
          )}
          {versionActivationNotice && (
            <span className="settings-save-notice" role="status">
              <Check className="h-4 w-4" />
              {isRtl ? 'تم تفعيل الإصدار' : 'Version activated'}
            </span>
          )}
          {activeSettingsSection === 'registration' ? null : activeSettingsSection === 'updates' && updateSettingsPanel === 'version' ? (
            <>
              {!settings.registeredSystem && (policyVersion === 'Soft' || policyVersion === 'Silver') && (
                <button
                  type="button"
                  disabled={versionActivationBusy || !versionPoliciesLoaded}
                  onClick={() => {
                    setVersionActivationError(null);
                    setVersionAdminPassword('');
                    setVersionActivationOpen(true);
                  }}
                  className="settings-save-button"
                >
                  {isRtl ? 'تفعيل الإصدار' : `Activate ${policyVersion}`}
                </button>
              )}
            </>
          ) : (
            <button
              type="submit"
              form="settings-form"
              disabled={saving}
              className="settings-save-button"
            >
              {saving ? 'Saving...' : isRtl ? 'حفظ الإعدادات' : 'Save All Settings'}
            </button>
          )}
      </div>
    </div>
  );
};
