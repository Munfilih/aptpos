import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  Printer,
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
  X,
  Plus,
  Lock,
  UserCheck,
  Monitor,
  Moon,
  FileText,
  Globe,
  QrCode,
  Sun,
} from 'lucide-react';
import type {
  AppComponentId,
  AppVersion,
  InvoiceTemplateSettings,
  PaperWidth,
  PosScreenLayout,
  PrintJob,
  StoreSettings,
  SettingsSectionId,
  TaxType,
  ThemeMode,
  UserAccount,
  VersionComponentPolicies,
} from '../types/pos';
import { APP_COMPONENTS, APP_VERSIONS } from '../types/pos';
import {
  getAllVersionComponentPolicies,
  getAllowedComponentsForVersion,
} from '../utils/versionComponentPolicies';
import { useLanguage } from '../i18n/LanguageContext';
import { BUILT_IN_PAYMENT_METHODS, getPaymentMethods } from '../utils/paymentMethods';
import { MINIMUM_INVOICE_MARGIN_MM, resolveInvoiceMarginsMm } from '../utils/thermalPrinting';
import type { UpdateStatus } from '../../electron/updateStatus';

interface SettingsViewProps {
  settings: StoreSettings;
  activeSection: SettingsSectionId;
  onActiveSectionChange: (section: SettingsSectionId) => void;
  showSectionNavigation?: boolean;
  printQueue: PrintJob[];
  isAdmin: boolean;
  isAppAdmin: boolean;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  iconOnlyLauncher: boolean;
  onIconOnlyLauncherChange: (enabled: boolean) => void;
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
  onSaveVersionComponentPolicies: (
    policies: VersionComponentPolicies,
    password: string
  ) => Promise<VersionComponentPolicies>;
  onFlushPrintQueue: () => Promise<void>;
  onResetDatabase?: () => Promise<void>;
  onRestoreDatabase?: (buffer: ArrayBuffer) => Promise<void>;
}

type BackupMode = 'on-close' | 'manual' | 'scheduled';

interface SettingsSectionTabsProps {
  activeSection: SettingsSectionId | null;
  isAppAdmin: boolean;
  themeOnly?: boolean;
  onSelect: (section: SettingsSectionId) => void;
}

export const SettingsSectionTabs: React.FC<SettingsSectionTabsProps> = ({
  activeSection,
  isAppAdmin,
  themeOnly = false,
  onSelect,
}) => {
  const { t, isRtl } = useLanguage();
  const allSections: Array<{
    id: SettingsSectionId;
    label: string;
  }> = [
    { id: 'sales', label: isRtl ? t.secSalesTax : 'Vouchers' },
    { id: 'screen', label: isRtl ? 'المظهر' : 'Theme' },
    { id: 'store', label: isRtl ? t.secStoreInfo : 'My Store' },
    { id: 'printer', label: isRtl ? t.secPrintTemplate : 'Print' },
    { id: 'users', label: isRtl ? t.secUsersPerms : 'Users' },
    { id: 'database', label: isRtl ? t.secDatabase : 'Database' },
    { id: 'registration', label: isRtl ? 'التسجيل' : 'Registration' },
    { id: 'version', label: isRtl ? 'الإصدار' : 'Version' },
    { id: 'updates', label: isRtl ? 'التحديثات' : 'Update' },
  ];
  const sections = themeOnly
    ? allSections.filter((section) => section.id === 'screen')
    : allSections.filter(
      (section) => isAppAdmin || !['users', 'database', 'registration', 'version'].includes(section.id)
      );

  return (
    <div className="settings-section-tabs">
      {sections.map((section) => {
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
  activeSection,
  onActiveSectionChange,
  showSectionNavigation = true,
  printQueue,
  isAdmin,
  isAppAdmin,
  theme,
  onThemeChange,
  iconOnlyLauncher,
  onIconOnlyLauncherChange,
  onSaveSettings,
  onActivateVersion,
  onActivateRegistrationKey,
  onLoadVersionComponentPolicies,
  onSaveVersionComponentPolicies,
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
  const activeSettingsSection = activeSection;
  const settingsViewRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [versionActivationOpen, setVersionActivationOpen] = useState(false);
  const [policyVersion, setPolicyVersion] = useState<AppVersion>(settings.appVersion || 'Standard');
  const [versionPolicyAdminPassword, setVersionPolicyAdminPassword] = useState('');
  const [versionPolicyLoading, setVersionPolicyLoading] = useState(false);
  const [versionPoliciesLoaded, setVersionPoliciesLoaded] = useState(false);
  const [versionPolicySaving, setVersionPolicySaving] = useState(false);
  const [versionPolicyError, setVersionPolicyError] = useState<string | null>(null);
  const versionPolicySaveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingVersionPolicySaves = useRef(0);
  const [versionAdminPassword, setVersionAdminPassword] = useState('');
  const [versionActivationBusy, setVersionActivationBusy] = useState(false);
  const [versionActivationError, setVersionActivationError] = useState<string | null>(null);
  const [versionActivationNotice, setVersionActivationNotice] = useState(false);
  const [registrationKey, setRegistrationKey] = useState('');
  const [registrationKeyBusy, setRegistrationKeyBusy] = useState(false);
  const [registrationKeyError, setRegistrationKeyError] = useState<string | null>(null);
  const [registrationKeySuccess, setRegistrationKeySuccess] = useState<string | null>(null);
  const [newPaymentMethod, setNewPaymentMethod] = useState('');
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<string | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [updateActionError, setUpdateActionError] = useState<string | null>(null);
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
  const [googleDriveBusy, setGoogleDriveBusy] = useState(false);
  const [googleDriveError, setGoogleDriveError] = useState<string | null>(null);
  const [googleDriveNotice, setGoogleDriveNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (!isAdmin && !isAppAdmin && activeSettingsSection !== 'screen') {
      onActiveSectionChange('screen');
    } else if (
      isAdmin &&
      !isAppAdmin &&
      (activeSettingsSection === 'users' ||
        activeSettingsSection === 'database' ||
        activeSettingsSection === 'registration' ||
        activeSettingsSection === 'version')
    ) {
      onActiveSectionChange('sales');
    }
  }, [isAdmin, isAppAdmin, activeSettingsSection, onActiveSectionChange]);

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
    setForm(settings);
    setSelectedTemplate(settings.paperWidth || '80mm');
  }, [settings]);

  useEffect(() => {
    setPolicyVersion(settings.appVersion || 'Standard');
  }, [settings.appVersion]);

  useEffect(() => {
    if (activeSettingsSection !== 'version') {
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
        setForm((current) => ({ ...current, versionComponentPolicies: policies }));
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
  }, [activeSettingsSection, settings.registeredSystem, onLoadVersionComponentPolicies]);

  useLayoutEffect(() => {
    settingsViewRef.current?.querySelectorAll<HTMLElement>('.settings-content-scroll').forEach((pane) => {
      pane.scrollTop = 0;
    });
  }, [activeSettingsSection]);

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
      const appVersion = form.appVersion || 'Standard';
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
        `Registered as ${result.appVersion}. The owner account "${result.username}" is ready; sign out and use it to continue.`
      );
    } catch (error) {
      setRegistrationKeyError(
        error instanceof Error ? error.message : 'Could not activate this registration key.'
      );
    } finally {
      setRegistrationKeyBusy(false);
    }
  };

  const queueVersionPolicySave = (policies: VersionComponentPolicies) => {
    const password = versionPolicyAdminPassword.trim();
    if (!versionPoliciesLoaded || !password) return;

    pendingVersionPolicySaves.current += 1;
    setVersionPolicySaving(true);
    setVersionPolicyError(null);
    const save = versionPolicySaveQueue.current.then(() =>
      onSaveVersionComponentPolicies(policies, password)
    );
    versionPolicySaveQueue.current = save.then(() => undefined, () => undefined);
    void save
      .then((savedPolicies) => {
        if (JSON.stringify(savedPolicies) !== JSON.stringify(policies)) {
          throw new Error('Firebase returned different version policies than the ones saved.');
        }
        setVersionPolicyError(null);
      })
      .catch((error: unknown) => {
        setVersionPolicyError(
          error instanceof Error ? error.message : 'Could not save Firebase version policies.'
        );
      })
      .finally(() => {
        pendingVersionPolicySaves.current -= 1;
        if (pendingVersionPolicySaves.current === 0) setVersionPolicySaving(false);
      });
  };

  const saveAllVersionPolicies = () => {
    queueVersionPolicySave(getAllVersionComponentPolicies(form));
  };

  const updateAllowedComponent = (component: AppComponentId, allowed: boolean) => {
    const policies = getAllVersionComponentPolicies(form);
    const allowedComponents = new Set(policies[policyVersion]);
    if (allowed) allowedComponents.add(component);
    else allowedComponents.delete(component);
    const updatedPolicies = {
      ...policies,
      [policyVersion]: Array.from(allowedComponents),
    };
    setForm((current) => ({
      ...current,
      versionComponentPolicies: updatedPolicies,
    }));
    queueVersionPolicySave(updatedPolicies);
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
            themeOnly={!isAdmin && !isAppAdmin}
            onSelect={onActiveSectionChange}
          />
        </nav>
      )}

      <div className={`settings-content-scroll min-w-0 min-h-0 overflow-y-auto ${activeSettingsSection === 'updates' ? 'hidden' : 'flex-1'}`}>
        <div className="settings-content-inner p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
          {activeSettingsSection === 'screen' && (
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

          {/* Main Settings Form */}
          <form
            id="settings-form"
            onSubmit={handleSubmit}
            className="space-y-5 text-xs"
          >
            {settingsSaveError && (
              <p className="text-xs text-red-600" role="alert">{settingsSaveError}</p>
            )}
            {isAppAdmin && activeSettingsSection === 'registration' && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <h2 className="text-sm font-semibold text-slate-900">
                  {isRtl ? 'تسجيل النظام' : 'Register this system'}
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {isRtl
                    ? 'أدخل مفتاح التسجيل المقدم من تطبيق المصادقة لتفعيل هذا النظام.'
                    : 'Enter the registration key provided by the Auth app to activate this system.'}
                </p>
                {settings.registeredSystem ? (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-sm font-semibold text-emerald-900">
                      {isRtl ? 'هذا النظام مسجل' : 'This system is registered'}
                    </p>
                    <p className="mt-1 text-xs text-emerald-800">
                      {isRtl ? 'الإصدار:' : 'Version:'} {settings.appVersion || 'Standard'}
                    </p>
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
            {isAppAdmin && activeSettingsSection === 'version' && (
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
                    value={form.appVersion || 'Standard'}
                    onChange={(event) => {
                      const appVersion = APP_VERSIONS.find(
                        (version) => version === event.target.value
                      );
                      if (appVersion) {
                        setForm((current) => ({ ...current, appVersion }));
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
                      ? 'حدد المكونات المسموح بها لكل إصدار. تُحفظ التغييرات مباشرة في Firebase وتُطبق عند اختيار الإصدار.'
                      : 'Choose allowed components independently for each version. Changes sync to Firebase immediately and apply when a version is selected.'}
                  </p>
                  <label className="mt-4 block max-w-sm text-xs font-medium text-slate-700">
                    {isRtl ? 'كلمة مرور مسؤول aptadmin للمزامنة' : 'aptadmin password for Firebase updates'}
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={versionPolicyAdminPassword}
                      onChange={(event) => setVersionPolicyAdminPassword(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  {versionPolicyLoading && (
                    <p className="mt-3 text-xs text-slate-500" role="status">
                      {isRtl ? 'جارٍ تحميل سياسات Firebase...' : 'Loading Firebase version policies...'}
                    </p>
                  )}
                  {versionPolicySaving && (
                    <p className="mt-3 text-xs text-slate-500" role="status">
                      {isRtl ? 'جارٍ الحفظ في Firebase...' : 'Saving changes to Firebase...'}
                    </p>
                  )}
                  {versionPolicyError && (
                    <p className="mt-3 text-xs text-red-600" role="alert">{versionPolicyError}</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={isRtl ? 'إصدارات التطبيق' : 'App versions'}>
                    {APP_VERSIONS.map((version) => {
                      const allowedCount = getAllowedComponentsForVersion(form, version).length;
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
                        className="settings-item-row cursor-pointer"
                      >
                        <span className="settings-item-copy text-sm font-medium text-slate-700">
                          {isRtl ? component.labelAr : component.label}
                        </span>
                        <input
                          type="checkbox"
                          checked={getAllowedComponentsForVersion(form, policyVersion).includes(component.id)}
                          disabled={!versionPoliciesLoaded || versionPolicyLoading || !versionPolicyAdminPassword.trim()}
                          onChange={(event) => updateAllowedComponent(component.id, event.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* SECTION 1: SALES & TAX SETTINGS */}
            {activeSettingsSection === 'sales' && (
              <div className="space-y-4">
                <div className="settings-item-list">
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
                </div>

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

                {/* Operational Toggles */}
                <section className="space-y-2">
                  <h3 className="px-1 text-sm font-semibold text-slate-900">
                    Checkout & Inventory Safeguards
                  </h3>

                  <div className="settings-item-list">
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
                  </div>
                </section>
              </div>
            )}

            {/* SECTION 2: POS SCREEN MODELS */}
            {isAppAdmin && activeSettingsSection === 'screen' && (
              <div className="space-y-4">
                <div className="px-1">
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

                <div className="settings-item-list">
                  {screenModels.map((model) => {
                    const isSelected = form.posScreenLayout === model.id || (model.id === 'pos' && form.posScreenLayout !== 'rpos');
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => handleSelectLayout(model.id)}
                        className={`settings-item-row w-full text-left transition-colors ${
                          isSelected
                            ? 'bg-blue-50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="settings-item-copy">
                          <span className="block font-semibold text-slate-900">
                            {model.title}
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                            {model.description}
                          </span>
                        </div>
                        <span className="shrink-0 text-right">
                          <span className="block text-xs font-semibold text-slate-700">
                            {model.badge}
                          </span>
                          <span className={`mt-1 block text-[11px] font-semibold ${isSelected ? 'text-blue-700' : 'text-slate-400'}`}>
                            {isSelected ? (isRtl ? 'النموذج النشط' : 'Active') : (isRtl ? 'انقر للتفعيل' : 'Select')}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SECTION 3: STORE & RECEIPT INFO */}
            {activeSettingsSection === 'store' && (
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

            {/* SECTION 4: PRINT & INVOICE TEMPLATE SETTINGS */}
            {activeSettingsSection === 'printer' && (
              <div className="space-y-4">
                <div className="px-1">
                  <h2 className="text-[15px] font-semibold text-[#1f1f1f] flex items-center gap-2">
                    <Printer className="w-4 h-4 text-[#0f6cbd]" />
                    <span>{t.printTemplateTitle}</span>
                  </h2>
                  <p className="text-xs text-[#666] mt-1">
                    {t.printTemplateDesc}
                  </p>
                </div>

                <div className="settings-item-list">
                <div className="settings-item-row">
                  <div className="settings-item-copy">
                    <h3 className="text-sm font-semibold text-slate-900">KOT Printer</h3>
                    <p className="mt-1 text-xs text-slate-600">
                      Print kitchen order tickets to a dedicated printer. System Default is used when none is selected.
                    </p>
                    <p className="mt-2 text-xs font-medium text-slate-700">
                      Selected: {form.kotPrinter || 'System Default'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                      Enable
                      <input
                        type="checkbox"
                        checked={form.enableKot === true}
                        onChange={(event) => setForm((current) => ({ ...current, enableKot: event.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => openPrinterDialog('kot')}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-slate-50"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Choose Printer
                    </button>
                  </div>
                </div>
                </div>

                {/* 1. Paper Format Selection (80mm / 58mm / A4) */}
                <section className="space-y-2">
                  <div className="px-1">
                    <label className="block font-semibold text-slate-900">
                      {t.paperFormat}
                    </label>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Choose between standard thermal receipt roll printers or full-page A4 commercial tax invoices.
                    </p>
                  </div>

                  <div className="settings-item-list">
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
                        className={`settings-item-row w-full text-left transition-colors ${
                          selectedTemplate === fmt.id
                            ? 'bg-blue-50'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="settings-item-copy">
                          <span className="block font-semibold text-slate-900">{fmt.title}</span>
                          <span className="mt-1 block text-[11px] text-slate-500">{fmt.desc}</span>
                        </div>
                        <span className="shrink-0 text-right">
                          <span className="block text-xs font-semibold text-slate-700">{fmt.badge}</span>
                          <span className={`mt-1 block text-[11px] font-semibold ${selectedTemplate === fmt.id ? 'text-blue-700' : 'text-slate-400'}`}>
                            {selectedTemplate === fmt.id ? 'Selected' : 'Select'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

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
                <section className="space-y-2">
                  <div className="px-1">
                    <h3 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-700" />
                      <span>{t.invoiceDisplayOptions}</span>
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {t.invoiceDisplayOptionsDesc}
                    </p>
                  </div>

                  <div className="settings-item-list">
                    {invoiceOptions.map((opt) => (
                      <label
                        key={opt.key}
                        className="settings-item-row cursor-pointer transition-colors hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={opt.val}
                          onChange={(e) => updateTemplateSettings(opt.key, e.target.checked)}
                          className="peer sr-only"
                        />
                        <div className="settings-item-copy">
                          <div className="font-semibold text-slate-800">{opt.label}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500">{opt.desc}</div>
                        </div>
                        <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600 rtl:peer-checked:after:-translate-x-4" />
                      </label>
                    ))}
                  </div>
                </section>

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
        <div className="settings-content-scroll flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <RefreshCw className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-semibold text-slate-900">
              {isRtl ? 'تحديثات aptPOS' : 'Software Updates'}
            </h2>
          </div>
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <Globe className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-semibold text-slate-900">{t.languageSelect}</h3>
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
                        : <RefreshCw className={`h-5 w-5 ${updateStatus.state === 'checking' ? 'animate-spin' : ''}`} />}
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
                    ? `أدخل كلمة مرور aptadmin لتفعيل ${form.appVersion || 'Standard'} وتطبيق خيارات المكونات.`
                    : `Enter the aptadmin password to activate ${form.appVersion || 'Standard'} and apply its component access settings.`}
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
      {(isAdmin || isAppAdmin) && (
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
          {activeSettingsSection === 'registration' ? null : activeSettingsSection === 'version' ? (
            <>
              <button
                type="button"
                onClick={saveAllVersionPolicies}
                disabled={versionPolicySaving || versionPolicyLoading || !versionPoliciesLoaded || !versionPolicyAdminPassword.trim()}
                className="settings-save-button"
              >
                {versionPolicySaving
                  ? isRtl ? 'جارٍ الحفظ...' : 'Saving...'
                  : isRtl ? 'حفظ الإصدارات' : 'Save Versions'}
              </button>
              {!settings.registeredSystem && (form.appVersion === 'Soft' || form.appVersion === 'Silver') && (
                <button
                  type="button"
                  disabled={versionActivationBusy || versionPolicySaving || !versionPoliciesLoaded}
                  onClick={() => {
                    setVersionActivationError(null);
                    setVersionAdminPassword('');
                    setVersionActivationOpen(true);
                  }}
                  className="settings-save-button"
                >
                  {isRtl ? 'تفعيل الإصدار' : `Activate ${form.appVersion}`}
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
      )}
    </div>
  );
};
