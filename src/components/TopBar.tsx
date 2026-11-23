import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  Menu,
  ShoppingBag,
  Package,
  FileText,
  Users,
  Receipt,
  Wallet,
  Settings as SettingsIcon,
  LogOut,
  RotateCcw,
  BarChart3,
  Files,
} from 'lucide-react';
import type { AppComponentId, SettingsSectionId, UserSession } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { SettingsSectionTabs } from './SettingsView';
import { LauncherAppArt } from './LauncherAppArt';

export type NavTab =
  | 'register'
  | 'inventory'
  | 'purchases'
  | 'purchase-history'
  | 'purchase-return-register'
  | 'purchase-return-history'
  | 'customers'
  | 'vendors'
  | 'sales'
  | 'return-register'
  | 'return-history'
  | 'accounts'
  | 'reports'
  | 'shift'
  | 'settings'
  | 'files'
  | 'unavailable';

interface TopBarProps {
  activeTab: NavTab;
  activeSettingsSection: SettingsSectionId;
  showSettingsComponent: boolean;
  isAppAdmin: boolean;
  onSelectTab: (tab: NavTab) => void;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  onSettingsComponentChange: (open: boolean) => void;
  settingsWorkspace: React.ReactNode;
  onSettingsLauncherChange: (open: boolean) => void;
  onLogout: () => void;
  onOpenCashbook: () => void;
  currentUser: UserSession | null;
  demoExpiresAt?: string;
  disabledAppComponents?: AppComponentId[];
  iconOnlyLauncher: boolean;
  openLauncherOnMount?: boolean;
  onLauncherOpened?: () => void;
  purchaseVoucherNumber?: string;
  purchaseVendor?: {
    name: string;
    taxNumber: string;
    pendingBalance: number;
    currencySymbol: string;
    partialCount: number;
  } | null;
}

interface TopNavLink {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  adminOnly?: boolean;
  permission?: string;
}

interface TopNavGroup {
  id: 'parties';
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: Array<{
    id: NavTab;
    label: string;
    permission: string;
    adminOnly?: boolean;
  }>;
}

type TopNavItem = TopNavLink | TopNavGroup;

type HubModuleId =
  | 'sales'
  | 'purchase'
  | 'inventory'
  | 'reports'
  | 'accounts'
  | 'settings'
  | 'files'
  | 'organization';

interface HubDestination {
  label: string;
  labelAr: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tab?: NavTab;
  comingSoon?: boolean;
}

interface HubModule {
  id: HubModuleId;
  label: string;
  labelAr: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tab?: NavTab;
  destinations: HubDestination[];
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  activeSettingsSection,
  showSettingsComponent,
  isAppAdmin,
  onSelectTab,
  onSettingsSectionChange,
  onSettingsComponentChange,
  settingsWorkspace,
  onSettingsLauncherChange,
  onLogout,
  onOpenCashbook,
  currentUser,
  demoExpiresAt,
  disabledAppComponents = [],
  iconOnlyLauncher,
  openLauncherOnMount = false,
  onLauncherOpened,
  purchaseVoucherNumber,
  purchaseVendor,
}) => {
  const { t, language, toggleLanguage } = useLanguage();
  const settingsSectionLabel: Record<SettingsSectionId, string> = {
    sales: t.secSalesTax,
    screen: language === 'ar' ? 'المظهر' : 'Theme',
    store: t.secStoreInfo,
    printer: t.secPrintTemplate,
    users: t.secUsersPerms,
    database: t.secDatabase,
    registration: language === 'ar' ? 'التسجيل' : 'Registration',
    version: language === 'ar' ? 'الإصدار' : 'Version',
    updates: language === 'ar' ? 'التحديثات' : 'Software Updates',
  };
  const [showLauncher, setShowLauncher] = useState(openLauncherOnMount);
  const [openNavigationGroup, setOpenNavigationGroup] = useState<HubModuleId | null>(null);
  const [demoSecondsRemaining, setDemoSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!demoExpiresAt) {
      setDemoSecondsRemaining(null);
      return;
    }

    const updateCountdown = () => {
      const expiry = Date.parse(demoExpiresAt);
      setDemoSecondsRemaining(
        Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - Date.now()) / 1000)) : 0
      );
    };
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, [demoExpiresAt]);

  const formatDemoCountdown = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    const time = [hours, minutes, remainingSeconds]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
    return days ? `${days}d ${time}` : time;
  };

  useEffect(() => {
    if (!openLauncherOnMount) return;
    setShowLauncher(true);
    onLauncherOpened?.();
  }, [openLauncherOnMount, onLauncherOpened]);

  const navItems: TopNavItem[] = [
    { id: 'register', label: t.navRegister, icon: ShoppingBag },
    {
      id: 'return-register',
      label: t.navSalesReturnRegister,
      icon: RotateCcw,
      permission: 'sales-return',
    },
    { id: 'purchases', label: t.navPurchases, icon: FileText, adminOnly: true },
    {
      id: 'purchase-return-register',
      label: language === 'ar' ? 'مرتجع مشتريات' : 'Purchase Return',
      icon: RotateCcw,
      adminOnly: true,
    },
    { id: 'inventory', label: t.navInventory, icon: Package, adminOnly: true },
    { id: 'shift', label: language === 'ar' ? 'الوردية' : 'Shift', icon: Wallet, permission: 'register' },
    { id: 'accounts', label: t.navAccounts, icon: Wallet, permission: 'accounts' },
    { id: 'reports', label: t.navReports, icon: BarChart3, permission: 'reports' },
    { id: 'settings', label: t.navSettings, icon: SettingsIcon, permission: 'settings' },
    { id: 'files', label: language === 'ar' ? 'الملفات' : 'Files', icon: Files, adminOnly: true },
    {
      id: 'parties',
      label: language === 'ar' ? 'الأطراف' : 'Parties',
      icon: Users,
      children: [
        { id: 'customers', label: t.navCustomers, permission: 'customers', adminOnly: true },
        { id: 'vendors', label: t.navVendors, permission: 'vendors', adminOnly: true },
      ],
    },
  ];

  const hasTabPermission = (tabId: NavTab) => {
    if (!currentUser) return false;
    if (
      (!isAppAdmin || currentUser.registeredSystem === true) &&
      disabledAppComponents.some((component) => component === tabId)
    ) return false;
    if (tabId === 'settings' && isAppAdmin) return true;
    const item = navItems.find(
      (navItem): navItem is TopNavLink => navItem.id === tabId && !('children' in navItem)
    );
    const groupChild = navItems
      .filter((navItem): navItem is TopNavGroup => 'children' in navItem)
      .flatMap((group) => group.children)
      .find((child) => child.id === tabId);
    const requiredPermission = item?.permission || groupChild?.permission;
    if ((item?.adminOnly || groupChild?.adminOnly) && currentUser.role !== 'admin') return false;
    if (currentUser.role === 'admin') return true;
    if (requiredPermission === 'sales-return' && currentUser.permissions?.includes('manage-sales-returns')) {
      return true;
    }
    return currentUser.permissions?.includes(requiredPermission || tabId) ?? false;
  };

  const hubModules: HubModule[] = [
    {
      id: 'sales',
      label: 'Sales',
      labelAr: 'المبيعات',
      icon: ShoppingBag,
      tab: 'register',
      destinations: [
        { label: 'Sales', labelAr: 'المبيعات', icon: ShoppingBag, tab: 'register' },
      ],
    },
    {
      id: 'purchase',
      label: 'Purchase',
      labelAr: 'المشتريات',
      icon: FileText,
      tab: 'purchases',
      destinations: [
        { label: 'Purchase', labelAr: 'المشتريات', icon: FileText, tab: 'purchases' },
      ],
    },
    {
      id: 'inventory',
      label: 'Inventory',
      labelAr: 'المخزون',
      icon: Package,
      tab: 'inventory',
      destinations: [
        { label: 'Inventory', labelAr: 'المخزون', icon: Package, tab: 'inventory' },
      ],
    },
    {
      id: 'files',
      label: 'Files',
      labelAr: 'الملفات',
      icon: Files,
      tab: 'files',
      destinations: [
        { label: 'Files', labelAr: 'الملفات', icon: Files, tab: 'files' },
      ],
    },
    {
      id: 'reports',
      label: 'Reports',
      labelAr: 'التقارير',
      icon: BarChart3,
      tab: 'reports',
      destinations: [
        { label: 'Daily Reports', labelAr: 'التقارير اليومية', icon: BarChart3, tab: 'reports' },
        { label: 'Sales Reports', labelAr: 'تقارير المبيعات', icon: Receipt, tab: 'reports' },
        { label: 'Purchase Reports', labelAr: 'تقارير المشتريات', icon: FileText, tab: 'reports' },
        { label: 'Tax Reports', labelAr: 'تقارير الضرائب', icon: Wallet, tab: 'reports' },
        { label: 'Other Reports', labelAr: 'تقارير أخرى', icon: BarChart3, tab: 'reports' },
      ],
    },
    {
      id: 'accounts',
      label: 'Accounts',
      labelAr: 'الحسابات',
      icon: Wallet,
      tab: 'accounts',
      destinations: [
        { label: 'Ledger', labelAr: 'دفتر الحسابات', icon: Wallet, tab: 'accounts' },
        { label: 'Customers', labelAr: 'العملاء', icon: Users, tab: 'customers' },
        { label: 'Vendors', labelAr: 'الموردون', icon: Users, tab: 'vendors' },
        { label: 'Payments & Receipts', labelAr: 'المدفوعات والمقبوضات', icon: Receipt, tab: 'accounts' },
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      labelAr: 'الإعدادات',
      icon: SettingsIcon,
      destinations: [
        { label: 'Settings', labelAr: 'الإعدادات', icon: SettingsIcon, tab: 'settings' },
      ],
    },
  ];

  const visibleHubModules = hubModules
    .map((module) => ({
      ...module,
      destinations: module.destinations.filter(
        (destination) => destination.comingSoon || (destination.tab && hasTabPermission(destination.tab))
      ),
    }))
    .filter((module) => module.destinations.length > 0);

  const menuShortcuts: Array<{
    id: string;
    label: string;
    labelAr: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    tab?: NavTab;
    comingSoon?: boolean;
    action?: 'open-cashbook';
  }> = [
    { id: 'sales-history', label: 'Sales History', labelAr: 'سجل المبيعات', icon: Receipt, tab: 'sales' },
    { id: 'purchase-history', label: 'Purchase History', labelAr: 'سجل المشتريات', icon: Receipt, tab: 'purchase-history' },
    { id: 'sales-return', label: 'Sales Return', labelAr: 'مرتجع مبيعات', icon: RotateCcw, tab: 'return-register' },
    { id: 'purchase-return', label: 'Purchase Return', labelAr: 'مرتجع مشتريات', icon: RotateCcw, tab: 'purchase-return-register' },
    { id: 'sales-order', label: 'Sales Order', labelAr: 'طلب مبيعات', icon: ShoppingBag, tab: 'register' },
    { id: 'sales-quotation', label: 'Sales Quotation', labelAr: 'عرض سعر', icon: FileText, comingSoon: true },
    { id: 'purchase-order', label: 'Purchase Order', labelAr: 'أمر شراء', icon: Package, tab: 'purchases' },
    { id: 'goods-delivery', label: 'Goods Delivery', labelAr: 'تسليم البضائع', icon: Package, comingSoon: true },
    { id: 'organization-hr', label: 'HR', labelAr: 'الموارد البشرية', icon: Users, comingSoon: true },
    { id: 'organization-shift', label: 'Shift', labelAr: 'الورديات', icon: Wallet, tab: 'shift' },
    { id: 'cashbook', label: 'Cash Book', labelAr: 'دفتر النقدية', icon: Wallet, tab: 'accounts', action: 'open-cashbook' },
  ];
  const visibleMenuShortcuts = menuShortcuts.filter(
    (item) => item.comingSoon || !item.tab || hasTabPermission(item.tab)
  );

  const selectedHubModule = visibleHubModules.find(
    (module) => module.id === openNavigationGroup
  );
  const launcherItems: Array<{
    id: string;
    label: string;
    labelAr: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    tab?: NavTab;
    comingSoon?: boolean;
    moduleId?: HubModuleId;
    action?: 'logout' | 'open-cashbook';
  }> = selectedHubModule
    ? selectedHubModule.destinations.map((destination, index) => ({
          ...destination,
          id: `${selectedHubModule.id}-${index}`,
        }))
    : [
        ...visibleHubModules.map((module) => ({
          id: module.id,
          label: module.label,
          labelAr: module.labelAr,
          icon: module.icon,
          moduleId: module.id,
          tab: module.tab,
        })),
        ...visibleMenuShortcuts,
      ];
  const closeLauncher = () => {
    if (selectedHubModule?.id === 'settings') {
        onSelectTab('settings');
        onSettingsLauncherChange(false);
    }
    onSettingsComponentChange(false);
    setOpenNavigationGroup(null);
    setShowLauncher(false);
  };

  useEffect(() => {
    if (!showLauncher) return;
    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') closeLauncher();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    showLauncher,
    openNavigationGroup,
    onSelectTab,
    onSettingsLauncherChange,
    onSettingsComponentChange,
  ]);
  const visibleNav: TopNavItem[] = [];
  for (const item of navItems) {
    if ('children' in item) {
      const children = item.children.filter(
        (child) => hasTabPermission(child.id)
      );
      if (children.length) visibleNav.push({ ...item, children });
      continue;
    }
    if (hasTabPermission(item.id)) {
      visibleNav.push(item);
    }
  }

  const activePageLabel = visibleNav
    .flatMap((item) =>
      'children' in item
        ? item.children
        : [{ id: item.id, label: item.label }]
    )
    .find((item) => item.id === activeTab)?.label ||
    (activeTab === 'purchase-history'
      ? language === 'ar' ? 'سجل المشتريات' : 'Purchase History'
      : activeTab === 'purchase-return-history'
        ? language === 'ar' ? 'سجل مرتجعات المشتريات' : 'Purchase Return History'
        : undefined);

  const handleSelectNavigationTab = (tab: NavTab) => {
    onSelectTab(tab);
    setShowLauncher(false);
    setOpenNavigationGroup(null);
  };

  return (
    <>
      <header className={`win11-titlebar no-print relative h-14 min-w-0 overflow-hidden bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-6 shrink-0 ${
        showLauncher ? 'z-[70]' : 'z-20'
      }`}>
        {/* Zone 1: Brand title & Menu Toggle */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (showLauncher) {
                closeLauncher();
              } else {
                setOpenNavigationGroup(null);
                onSettingsComponentChange(false);
                setShowLauncher(true);
              }
            }}
            className="p-1.5 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
            aria-label={language === 'ar' ? 'فتح مشغل التطبيقات' : 'Open app launcher'}
            aria-expanded={showLauncher}
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              handleSelectNavigationTab('register');
              onSettingsLauncherChange(false);
              onSettingsComponentChange(false);
            }}
            className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded flex items-center gap-1.5"
          >
            <span>apt<span className="text-blue-700">POS</span></span>
          </button>
          {activePageLabel && (
            <span className="border-l border-slate-200 pl-2 text-xs font-medium text-slate-600 sm:pl-3">
              {activePageLabel}
            </span>
          )}
          {purchaseVoucherNumber && activeTab === 'purchases' && (
            <span className="border-l border-slate-200 pl-2 font-mono text-[10px] font-semibold text-slate-700 sm:pl-3">
              {purchaseVoucherNumber}
            </span>
          )}
          {purchaseVendor && activeTab === 'purchases' && (
            <div
              className="min-w-0 border-l border-slate-200 pl-2 text-[10px] leading-4 text-slate-600 sm:pl-3"
              dir={language === 'ar' ? 'rtl' : 'ltr'}
            >
              <div className="max-w-[180px] truncate font-semibold text-slate-800" title={purchaseVendor.name}>
                {purchaseVendor.name}
              </div>
              <div className="flex gap-2 whitespace-nowrap">
                <span>{language === 'ar' ? 'الرقم الضريبي' : 'VAT'}: {purchaseVendor.taxNumber || '—'}</span>
                <span
                  className="font-semibold text-amber-700"
                  title={
                    purchaseVendor.partialCount > 0
                      ? (language === 'ar'
                        ? 'تُحتسب الفواتير المدفوعة جزئياً بكامل قيمتها لعدم تسجيل المبلغ المدفوع.'
                        : 'Partially paid invoices are counted at full value because the paid amount is not recorded.')
                      : undefined
                  }
                >
                  {language === 'ar' ? 'الرصيد المستحق' : 'Pending balance'}: {purchaseVendor.currencySymbol}{purchaseVendor.pendingBalance.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        {currentUser && (
          <div
            className="flex min-w-0 max-w-[70%] items-center gap-1.5"
          >
            {currentUser.demoMode && demoSecondsRemaining !== null && (
              <span
                className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[10px] font-bold text-amber-800"
                aria-label={`Demo time remaining ${formatDemoCountdown(demoSecondsRemaining)}`}
                title="Demo time remaining"
              >
                Demo {formatDemoCountdown(demoSecondsRemaining)}
              </span>
            )}
            <div
              className="min-w-0 cursor-pointer text-right"
              onDoubleClick={toggleLanguage}
              title={language === 'ar' ? 'انقر مرتين لتغيير اللغة' : 'Double-click to switch language'}
            >
              <div className="truncate text-xs font-semibold text-slate-800">
                {currentUser.displayName || currentUser.username}
              </div>
              <div className="truncate text-[10px] text-slate-500">
                {currentUser.username} · {currentUser.role}
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              aria-label={language === 'ar' ? 'تسجيل الخروج' : 'Log out'}
              title={language === 'ar' ? 'تسجيل الخروج' : 'Log out'}
            >
              <LogOut className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}

      </header>

      {showLauncher && (
        <div
          className="app-launcher-backdrop fixed inset-x-0 bottom-0 top-14 z-[60] flex items-start justify-center bg-white p-2 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeLauncher();
          }}
        >
          <div
            className="win11-start-panel relative flex h-[calc(100dvh-4.5rem)] max-h-[calc(100dvh-4.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl p-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:h-[38rem] sm:max-h-[calc(100dvh-6rem)] sm:rounded-3xl sm:px-8 sm:pb-8 sm:pt-2"
          >
            {selectedHubModule?.id === 'settings' ? (
              <>
                <nav
                  className="mb-5 flex shrink-0 items-center gap-1 border-b border-slate-300 pb-4 text-sm"
                  aria-label={language === 'ar' ? 'مسار التنقل' : 'Breadcrumb'}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenNavigationGroup(null);
                      onSettingsLauncherChange(false);
                      onSettingsComponentChange(false);
                    }}
                    className="font-medium text-slate-600 hover:text-blue-700"
                  >
                    {language === 'ar' ? 'القائمة' : 'Menu'}
                  </button>
                  <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  {showSettingsComponent ? (
                    <button
                      type="button"
                      onClick={() => onSettingsComponentChange(false)}
                      className="font-medium text-slate-600 hover:text-blue-700"
                    >
                      {language === 'ar' ? selectedHubModule.labelAr : selectedHubModule.label}
                    </button>
                  ) : (
                    <span aria-current="page" className="font-semibold text-slate-900">
                      {language === 'ar' ? selectedHubModule.labelAr : selectedHubModule.label}
                    </span>
                  )}
                  {showSettingsComponent && (
                    <>
                      <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      <span aria-current="page" className="font-semibold text-slate-900">
                        {settingsSectionLabel[activeSettingsSection]}
                      </span>
                    </>
                  )}
                </nav>
                {showSettingsComponent ? (
                  <div className="flex min-h-0 flex-1 flex-col">{settingsWorkspace}</div>
                ) : (
                  <nav
                    className="min-h-0 flex-1 overflow-y-auto"
                    aria-label={language === 'ar' ? 'مكونات الإعدادات' : 'Settings components'}
                    role="tablist"
                  >
                    <SettingsSectionTabs
                      activeSection={null}
                      isAppAdmin={isAppAdmin}
                      canRegisterSystem={isAppAdmin || currentUser?.demoMode === true}
                      themeOnly={currentUser?.role !== 'admin' && !isAppAdmin}
                      onSelect={(section) => {
                        onSettingsSectionChange(section);
                        onSettingsComponentChange(true);
                      }}
                    />
                  </nav>
                )}
              </>
            ) : selectedHubModule ? (
              <>
                <nav
                  className="mb-5 flex shrink-0 items-center gap-1 border-b border-slate-300 pb-4 text-sm"
                  aria-label={language === 'ar' ? 'مسار التنقل' : 'Breadcrumb'}
                >
                  <button
                    type="button"
                    onClick={() => setOpenNavigationGroup(null)}
                    className="font-medium text-slate-600 hover:text-blue-700"
                  >
                    {language === 'ar' ? 'القائمة' : 'Menu'}
                  </button>
                  <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span aria-current="page" className="font-semibold text-slate-900">
                    {language === 'ar' ? selectedHubModule.labelAr : selectedHubModule.label}
                  </span>
                </nav>
                <nav
                  className="settings-section-navigation"
                  aria-label={language === 'ar' ? 'مكونات القسم' : 'Section components'}
                  role="tablist"
                >
                  <div className="settings-section-tabs">
                    {selectedHubModule.destinations.map((destination, index) => {
                      const label = language === 'ar' ? destination.labelAr : destination.label;
                      const isActive = index === 0;
                      return (
                        <button
                          key={`${selectedHubModule.id}-${destination.label}`}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          disabled={Boolean(destination.comingSoon)}
                          onClick={() => {
                            if (destination.tab) handleSelectNavigationTab(destination.tab);
                          }}
                          className={`settings-section-tab${isActive ? ' is-active' : ''}`}
                          title={destination.comingSoon
                            ? `${label} - ${language === 'ar' ? 'ترقية' : 'Upgrade'}`
                            : label}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </nav>
              </>
            ) : (
              <>
                <div
                  className="launcher-grid min-h-0 flex-1 grid w-full grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] items-start justify-items-center content-start gap-4 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]"
                >
                {launcherItems.map((entry) => {
                const Icon = entry.icon;
                const label = language === 'ar' ? entry.labelAr : entry.label;
                const isComingSoon = entry.comingSoon;
                const accessibleLabel = isComingSoon
                  ? `${label} - ${language === 'ar' ? 'ترقية' : 'Upgrade'}`
                  : label;
                const isMenuLanding = !selectedHubModule;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={Boolean(isComingSoon)}
                    aria-label={accessibleLabel}
                    title={accessibleLabel}
                    onClick={() => {
                      if (entry.action === 'logout') {
                        closeLauncher();
                        onLogout();
                      } else if (entry.action === 'open-cashbook') {
                        onOpenCashbook();
                        setShowLauncher(false);
                        setOpenNavigationGroup(null);
                      } else if (entry.tab) {
                        handleSelectNavigationTab(entry.tab);
                      } else if (entry.moduleId === 'settings') {
                        onSelectTab('settings');
                        onSettingsLauncherChange(false);
                        onSettingsComponentChange(false);
                        setOpenNavigationGroup(null);
                        setShowLauncher(false);
                      } else if (entry.moduleId) {
                        setOpenNavigationGroup(entry.moduleId);
                      }
                    }}
                    className={`group flex min-h-28 w-28 min-w-0 flex-col items-center rounded-xl border border-transparent p-2 text-center transition-colors ${
                          iconOnlyLauncher ? 'justify-center' : 'justify-start gap-2'
                        } ${
                          isComingSoon
                            ? 'cursor-not-allowed opacity-50'
                            : 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300'
                        }`}
                  >
                      <span
                        data-art={isMenuLanding ? entry.id : undefined}
                        className={`win11-launcher-icon relative flex h-18 w-18 shrink-0 items-center justify-center rounded-xl transition-all sm:h-20 sm:w-20 ${
                          isComingSoon ? '' : 'group-hover:-translate-y-0.5 group-hover:scale-110 group-hover:shadow-md'
                        }`}
                      >
                        {isMenuLanding ? (
                          <LauncherAppArt id={entry.id} />
                        ) : (
                          <Icon
                            strokeWidth={1.5}
                            className="relative z-10 h-8 w-8 text-blue-700 sm:h-9 sm:w-9"
                          />
                        )}
                      </span>
                      {!iconOnlyLauncher && (
                        <span className="w-18 whitespace-normal break-words text-center text-xs font-semibold leading-tight text-slate-700">
                          {label}
                        </span>
                      )}
                      {!iconOnlyLauncher && isComingSoon && (
                        <span className="text-[10px] text-slate-500">
                          {language === 'ar' ? 'ترقية' : 'Upgrade'}
                        </span>
                      )}
                  </button>
                );
                })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
