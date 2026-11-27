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
import { APP_COMPONENTS } from '../types/pos';
import type { AppComponentId, AppScreenMode, SettingsSectionId, UserSession } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { SettingsSectionTabs } from './SettingsView';
import { LauncherAppArt } from './LauncherAppArt';

export type NavTab =
  | 'register'
  | 'sales-entry'
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

export interface LauncherSummaryData {
  currencySymbol: string;
  decimalPoints: number;
  storeName: string;
  todaySalesTotal: number;
  todaySalesCount: number;
  todayCashSales: number;
  todayCardSales: number;
  totalSalesTotal: number;
  totalSalesCount: number;
  draftSalesCount: number;
  pendingReceivables: number;
  totalVatCollected: number;
  todayPurchasesTotal: number;
  todayPurchasesCount: number;
  totalPurchasesTotal: number;
  totalPurchasesCount: number;
  pendingPayables: number;
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  stockValue: number;
  totalCustomers: number;
  totalVendors: number;
  salesReturnCount: number;
  salesReturnTotal: number;
  todaySalesReturnCount: number;
  purchaseReturnCount: number;
  purchaseReturnTotal: number;
  todayPurchaseReturnCount: number;
  cashbookBalance: number;
  cashbookInTotal: number;
  cashbookOutTotal: number;
  cashbookEntriesCount: number;
  taxRate: number;
  eInvoiceEnabled: boolean;
  paperWidth: string;
  shiftMode: 'daily' | 'manual' | 'off';
}

interface TopBarProps {
  appName: string;
  appScreenMode: AppScreenMode;
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
  registeredSystem?: boolean;
  amcStartDate?: string | null;
  amcEndDate?: string | null;
  disabledAppComponents?: AppComponentId[];
  iconOnlyLauncher: boolean;
  launcherBackgroundDataUrl?: string;
  launcherSummary?: LauncherSummaryData;
  openLauncherOnMount?: boolean;
  onLauncherOpened?: () => void;
  sideNavOpen?: boolean;
  onToggleSideNav?: () => void;
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
  appName,
  appScreenMode,
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
  registeredSystem = false,
  amcStartDate,
  amcEndDate,
  disabledAppComponents = [],
  iconOnlyLauncher,
  launcherBackgroundDataUrl,
  launcherSummary,
  openLauncherOnMount = false,
  onLauncherOpened,
  sideNavOpen = true,
  onToggleSideNav,
  purchaseVoucherNumber,
  purchaseVendor,
}) => {
  const { t, language, toggleLanguage } = useLanguage();
  const settingsSectionLabel: Record<SettingsSectionId, string> = {
    general: language === 'ar' ? 'عام' : 'General',
    business: language === 'ar' ? 'الأعمال' : 'Business',
    billing: language === 'ar' ? 'الفوترة' : 'Billing',
    zatca: language === 'ar' ? 'الفوترة الإلكترونية' : 'E-Invoicing',
    print: language === 'ar' ? 'الطباعة' : 'Print',
    customers: language === 'ar' ? 'العملاء' : 'Customers',
    payment: language === 'ar' ? 'الدفع' : 'Payment',
    users: t.secUsersPerms,
    database: t.secDatabase,
    registration: language === 'ar' ? 'التسجيل' : 'Registration',
    updates: language === 'ar' ? 'التحديثات' : 'Software Updates',
  };
  const [showLauncher, setShowLauncher] = useState(openLauncherOnMount);
  const [openNavigationGroup, setOpenNavigationGroup] = useState<HubModuleId | null>(null);
  const [demoSecondsRemaining, setDemoSecondsRemaining] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

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
  const getDaysUntilDate = (date: string | null | undefined): number | null => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const [year, month, day] = date.split('-').map(Number);
    const target = new Date(Date.UTC(year, month - 1, day));
    if (
      target.getUTCFullYear() !== year ||
      target.getUTCMonth() !== month - 1 ||
      target.getUTCDate() !== day
    ) {
      return null;
    }
    const now = new Date(currentTime);
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target.getTime() - today) / 86_400_000);
  };
  const amcStartDays = getDaysUntilDate(amcStartDate);
  const amcExpiryDays = getDaysUntilDate(amcEndDate);
  const amcStatus = (() => {
    if (!registeredSystem || currentUser?.demoMode) return null;
    if (!amcStartDate || !amcEndDate || amcStartDays === null || amcExpiryDays === null) {
      return {
        label: language === 'ar' ? 'بدون AMC' : 'No AMC',
        className: 'border-red-200 bg-red-50 text-red-700',
      };
    }
    if (amcStartDays > 0) {
      return {
        label: language === 'ar'
          ? `يبدأ AMC خلال ${amcStartDays} يوم`
          : `AMC starts in ${amcStartDays} day${amcStartDays === 1 ? '' : 's'}`,
        className: 'border-sky-200 bg-sky-50 text-sky-700',
      };
    }
    if (amcExpiryDays < 0) {
      return {
        label: language === 'ar' ? 'انتهى AMC' : 'AMC expired',
        className: 'border-red-200 bg-red-50 text-red-700',
      };
    }
    if (amcExpiryDays <= 10) {
      return {
        label: amcExpiryDays === 0
          ? (language === 'ar' ? 'ينتهي AMC اليوم' : 'AMC expires today')
          : language === 'ar'
            ? `ينتهي AMC خلال ${amcExpiryDays} يوم`
            : `AMC expires in ${amcExpiryDays} day${amcExpiryDays === 1 ? '' : 's'}`,
        className: 'border-orange-200 bg-orange-50 text-orange-800',
      };
    }
    return null;
  })();

  const isFlyErpMode = appScreenMode === 'flyerp';

  useEffect(() => {
    if (!openLauncherOnMount) return;
    if (!isFlyErpMode) {
      setShowLauncher(true);
    }
    onLauncherOpened?.();
  }, [isFlyErpMode, openLauncherOnMount, onLauncherOpened]);

  const navItems: TopNavItem[] = [
    ...(appScreenMode === 'erp' || appScreenMode === 'flyerp'
      ? [{
          id: 'sales-entry' as const,
          label: appScreenMode === 'flyerp'
            ? language === 'ar' ? 'فواتير السفر' : 'Travel Billing'
            : language === 'ar' ? 'إدخال المبيعات' : 'Sales Entry',
          icon: FileText,
        }]
      : []),
    { id: 'register', label: t.navRegister, icon: ShoppingBag },
    {
      id: 'return-register',
      label: t.navSalesReturnRegister,
      icon: RotateCcw,
      permission: 'sales-return',
    },
    { id: 'purchases', label: t.navPurchases, icon: FileText },
    {
      id: 'purchase-return-register',
      label: language === 'ar' ? 'مرتجع مشتريات' : 'Purchase Return',
      icon: RotateCcw,
    },
    {
      id: 'inventory',
      label: appScreenMode === 'flyerp'
        ? language === 'ar' ? 'الخدمات' : 'Services'
        : t.navInventory,
      icon: Package,
    },
    { id: 'shift', label: language === 'ar' ? 'الوردية' : 'Shift', icon: Wallet, permission: 'register' },
    { id: 'accounts', label: t.navAccounts, icon: Wallet, permission: 'accounts' },
    { id: 'reports', label: t.navReports, icon: BarChart3, permission: 'reports' },
    { id: 'settings', label: t.navSettings, icon: SettingsIcon, permission: 'settings' },
    { id: 'files', label: language === 'ar' ? 'الملفات' : 'Files', icon: Files },
    {
      id: 'parties',
      label: language === 'ar' ? 'الأطراف' : 'Parties',
      icon: Users,
      children: [
        { id: 'customers', label: t.navCustomers, permission: 'customers' },
        { id: 'vendors', label: t.navVendors, permission: 'vendors' },
      ],
    },
  ];

  const hasTabPermission = (tabId: NavTab) => {
    if (!currentUser) return false;
    if (
      (!isAppAdmin || currentUser.registeredSystem === true) &&
      disabledAppComponents.some((component) => component === tabId)
    ) return false;
    if (tabId === 'settings') {
      return isAppAdmin || currentUser.role === 'admin' || currentUser.permissions?.includes('settings') === true;
    }
    if (APP_COMPONENTS.some((component) => component.id === tabId)) return true;
    const item = navItems.find(
      (navItem): navItem is TopNavLink => navItem.id === tabId && !('children' in navItem)
    );
    const groupChild = navItems
      .filter((navItem): navItem is TopNavGroup => 'children' in navItem)
      .flatMap((group) => group.children)
      .find((child) => child.id === tabId);
    const requiredPermission = tabId === 'sales-entry'
      ? 'register'
      : item?.permission || groupChild?.permission;
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
      label: appScreenMode === 'flyerp' ? 'Services' : 'Inventory',
      labelAr: appScreenMode === 'flyerp' ? 'الخدمات' : 'المخزون',
      icon: Package,
      tab: 'inventory',
      destinations: [
        {
          label: appScreenMode === 'flyerp' ? 'Services' : 'Inventory',
          labelAr: appScreenMode === 'flyerp' ? 'الخدمات' : 'المخزون',
          icon: Package,
          tab: 'inventory',
        },
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
      tab: (appScreenMode === 'erp' || appScreenMode === 'flyerp') && module.id === 'sales'
        ? 'sales-entry'
        : module.tab,
      destinations: ((appScreenMode === 'erp' || appScreenMode === 'flyerp') && module.id === 'sales'
        ? [{
            ...module.destinations[0],
            label: appScreenMode === 'flyerp' ? 'Travel Billing' : 'Sales Entry',
            labelAr: appScreenMode === 'flyerp' ? 'فواتير السفر' : 'إدخال المبيعات',
            tab: 'sales-entry' as NavTab,
          }]
        : module.destinations).filter(
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
    componentId?: AppComponentId;
    comingSoon?: boolean;
    action?: 'open-cashbook';
  }> = [
    { id: 'sales-return', label: 'Sales Return', labelAr: 'مرتجع مبيعات', icon: RotateCcw, tab: 'return-register' },
    { id: 'purchase-return', label: 'Purchase Return', labelAr: 'مرتجع مشتريات', icon: RotateCcw, tab: 'purchase-return-register' },
    { id: 'sales-order', label: 'Sales Order', labelAr: 'طلب مبيعات', icon: ShoppingBag, componentId: 'sales-order', comingSoon: true },
    { id: 'sales-quotation', label: 'Sales Quotation', labelAr: 'عرض سعر', icon: FileText, componentId: 'sales-quotation', comingSoon: true },
    { id: 'purchase-order', label: 'Purchase Order', labelAr: 'أمر شراء', icon: Package, componentId: 'purchase-order', comingSoon: true },
    { id: 'purchase-quotation', label: 'Purchase Quotation', labelAr: 'عرض سعر شراء', icon: FileText, componentId: 'purchase-quotation', comingSoon: true },
    { id: 'goods-delivery', label: 'Goods Delivery', labelAr: 'تسليم البضائع', icon: Package, componentId: 'goods-delivery', comingSoon: true },
    { id: 'goods-receipt', label: 'Goods Receipt', labelAr: 'استلام البضائع', icon: Package, componentId: 'goods-receipt', comingSoon: true },
    { id: 'organization-hr', label: 'HR', labelAr: 'الموارد البشرية', icon: Users, componentId: 'organization-hr', comingSoon: true },
    { id: 'salary-process', label: 'Salary Process', labelAr: 'معالجة الرواتب', icon: Wallet, componentId: 'salary-process', comingSoon: true },
    { id: 'organization-shift', label: 'Shift', labelAr: 'الورديات', icon: Wallet, tab: 'shift' },
    { id: 'cashbook', label: 'Cash Book', labelAr: 'دفتر النقدية', icon: Wallet, tab: 'accounts', action: 'open-cashbook' },
  ];
  const visibleMenuShortcuts = menuShortcuts.filter(
    (item) =>
      (!item.componentId || !disabledAppComponents.includes(item.componentId)) &&
      (item.comingSoon || !item.tab || hasTabPermission(item.tab))
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

  const formatMoney = (amount: number) => {
    const currency = launcherSummary?.currencySymbol || 'SAR';
    const decimals = launcherSummary?.decimalPoints ?? 2;
    return `${currency} ${Number(amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  };

  interface TileSummaryContent {
    subtitle: string;
    headline: string;
    headlineCaption: string;
    badge?: { label: string; tone: 'emerald' | 'amber' | 'red' | 'blue' | 'slate' };
    metrics: Array<{ label: string; value: string; tone?: 'emerald' | 'amber' | 'red' | 'blue' }>;
  }

  const getTileSummary = (entryId: string): TileSummaryContent | null => {
    const s = launcherSummary;
    if (!s) return null;
    const isAr = language === 'ar';

    switch (entryId) {
      case 'sales':
        return {
          subtitle: isAr ? 'نقطة البيع والفواتير' : 'Billing & Point of Sale',
          headline: formatMoney(s.todaySalesTotal),
          headlineCaption: isAr ? 'مبيعات اليوم' : "Today's Sales",
          badge: s.draftSalesCount > 0
            ? { label: isAr ? `${s.draftSalesCount} مسودة` : `${s.draftSalesCount} Drafts`, tone: 'amber' }
            : { label: isAr ? `${s.todaySalesCount} فاتورة` : `${s.todaySalesCount} Bills`, tone: 'emerald' },
          metrics: [
            { label: isAr ? 'اليوم' : 'Today Bills', value: String(s.todaySalesCount) },
            { label: isAr ? 'الإجمالي' : 'Total Sales', value: formatMoney(s.totalSalesTotal) },
            {
              label: isAr ? 'مستحق' : 'Receivable',
              value: formatMoney(s.pendingReceivables),
              tone: s.pendingReceivables > 0 ? 'amber' : undefined,
            },
          ],
        };
      case 'purchase':
        return {
          subtitle: isAr ? 'المشتريات وفواتير الموردين' : 'Procurement & Vendor Bills',
          headline: formatMoney(s.totalPurchasesTotal),
          headlineCaption: isAr ? 'إجمالي المشتريات' : 'Total Purchases',
          badge: s.pendingPayables > 0
            ? { label: isAr ? 'مستحق للموردين' : 'Payables Due', tone: 'amber' }
            : { label: isAr ? `${s.totalPurchasesCount} فاتورة` : `${s.totalPurchasesCount} Bills`, tone: 'blue' },
          metrics: [
            { label: isAr ? 'اليوم' : 'Today', value: formatMoney(s.todayPurchasesTotal) },
            { label: isAr ? 'الفواتير' : 'Bills', value: String(s.totalPurchasesCount) },
            {
              label: isAr ? 'المدفوعات المستحقة' : 'Payables',
              value: formatMoney(s.pendingPayables),
              tone: s.pendingPayables > 0 ? 'amber' : undefined,
            },
          ],
        };
      case 'inventory':
        return {
          subtitle: isAr ? 'المنتجات والأسعار والمخزون' : 'Products, Stock & Pricing',
          headline: isAr ? `${s.totalProducts} صنف` : `${s.totalProducts} Items`,
          headlineCaption: isAr ? 'إجمالي الأصناف' : 'Active Catalog',
          badge: s.outOfStockCount > 0
            ? { label: isAr ? `${s.outOfStockCount} نفد` : `${s.outOfStockCount} Out`, tone: 'red' }
            : s.lowStockCount > 0
              ? { label: isAr ? `${s.lowStockCount} منخفض` : `${s.lowStockCount} Low`, tone: 'amber' }
              : { label: isAr ? 'متوفر' : 'In Stock', tone: 'emerald' },
          metrics: [
            {
              label: isAr ? 'منخفض' : 'Low Stock',
              value: String(s.lowStockCount),
              tone: s.lowStockCount > 0 ? 'amber' : undefined,
            },
            {
              label: isAr ? 'نفد' : 'Out of Stock',
              value: String(s.outOfStockCount),
              tone: s.outOfStockCount > 0 ? 'red' : undefined,
            },
            { label: isAr ? 'قيمة المخزون' : 'Stock Value', value: formatMoney(s.stockValue) },
          ],
        };
      case 'accounts':
        return {
          subtitle: isAr ? 'دفتر الحسابات والعملاء والموردين' : 'Ledger, Customers & Vendors',
          headline: formatMoney(s.pendingReceivables),
          headlineCaption: isAr ? 'ذمم العملاء المستحقة' : 'Customer Receivables',
          badge: {
            label: isAr ? `${s.totalCustomers + s.totalVendors} طرف` : `${s.totalCustomers + s.totalVendors} Parties`,
            tone: 'blue',
          },
          metrics: [
            { label: isAr ? 'العملاء' : 'Customers', value: String(s.totalCustomers) },
            { label: isAr ? 'الموردون' : 'Vendors', value: String(s.totalVendors) },
            {
              label: isAr ? 'مستحقات الموردين' : 'Payables',
              value: formatMoney(s.pendingPayables),
              tone: s.pendingPayables > 0 ? 'amber' : undefined,
            },
          ],
        };
      case 'reports':
        return {
          subtitle: isAr ? 'التقارير المالية والضريبية' : 'Financial, Sales & Tax Analytics',
          headline: formatMoney(s.totalSalesTotal - s.salesReturnTotal),
          headlineCaption: isAr ? 'صافي المبيعات' : 'Net Sales Volume',
          badge: { label: isAr ? 'تحليلات مباشرة' : 'Live Data', tone: 'blue' },
          metrics: [
            { label: isAr ? 'إجمالي الضريبة' : 'Total VAT', value: formatMoney(s.totalVatCollected) },
            { label: isAr ? 'فواتير البيع' : 'Sales Bills', value: String(s.totalSalesCount) },
            { label: isAr ? 'المرتجعات' : 'Returns', value: String(s.salesReturnCount) },
          ],
        };
      case 'organization-shift':
        return {
          subtitle: isAr ? 'إدارة الورديات وإقفال الصندوق' : 'Counter Shift & Drawer Closing',
          headline: formatMoney(s.todayCashSales),
          headlineCaption: isAr ? 'مبيعات الكاش اليوم' : "Today's Cash Sales",
          badge: {
            label: s.shiftMode === 'daily'
              ? (isAr ? 'وردية يومية' : 'Daily Shift')
              : s.shiftMode === 'manual'
                ? (isAr ? 'وردية يدوية' : 'Counter Shift')
                : (isAr ? 'غير مفعل' : 'Off'),
            tone: s.shiftMode === 'off' ? 'slate' : 'emerald',
          },
          metrics: [
            { label: isAr ? 'بطاقة اليوم' : 'Card Today', value: formatMoney(s.todayCardSales) },
            { label: isAr ? 'فواتير اليوم' : 'Today Bills', value: String(s.todaySalesCount) },
            { label: isAr ? 'إجمالي اليوم' : 'Day Total', value: formatMoney(s.todaySalesTotal) },
          ],
        };
      case 'cashbook':
        return {
          subtitle: isAr ? 'حركة النقدية والبنك اليومية' : 'Cash & Bank Movement Ledger',
          headline: formatMoney(s.cashbookBalance),
          headlineCaption: isAr ? 'الرصيد النقدي الصافي' : 'Net Cash Balance',
          badge: {
            label: isAr ? `${s.cashbookEntriesCount} قيد` : `${s.cashbookEntriesCount} Entries`,
            tone: s.cashbookBalance >= 0 ? 'emerald' : 'red',
          },
          metrics: [
            { label: isAr ? 'المقبوضات' : 'Cash In', value: formatMoney(s.cashbookInTotal), tone: 'emerald' },
            { label: isAr ? 'المدفوعات' : 'Cash Out', value: formatMoney(s.cashbookOutTotal), tone: 'red' },
            { label: isAr ? 'القيود' : 'Entries', value: String(s.cashbookEntriesCount) },
          ],
        };
      case 'sales-return':
        return {
          subtitle: isAr ? 'مرتجعات فواتير المبيعات' : 'Customer Refunds & Returns',
          headline: formatMoney(s.salesReturnTotal),
          headlineCaption: isAr ? 'إجمالي المرتجعات' : 'Total Refunded',
          badge: {
            label: isAr ? `${s.salesReturnCount} سند` : `${s.salesReturnCount} Vouchers`,
            tone: s.salesReturnCount > 0 ? 'amber' : 'slate',
          },
          metrics: [
            { label: isAr ? 'اليوم' : 'Today', value: String(s.todaySalesReturnCount) },
            { label: isAr ? 'الإجمالي' : 'Total Count', value: String(s.salesReturnCount) },
          ],
        };
      case 'purchase-return':
        return {
          subtitle: isAr ? 'مرتجعات فواتير المشتريات' : 'Supplier Return Vouchers',
          headline: formatMoney(s.purchaseReturnTotal),
          headlineCaption: isAr ? 'إجمالي مرتجع المشتريات' : 'Total Returned',
          badge: {
            label: isAr ? `${s.purchaseReturnCount} سند` : `${s.purchaseReturnCount} Vouchers`,
            tone: s.purchaseReturnCount > 0 ? 'amber' : 'slate',
          },
          metrics: [
            { label: isAr ? 'اليوم' : 'Today', value: String(s.todayPurchaseReturnCount) },
            { label: isAr ? 'الإجمالي' : 'Total Count', value: String(s.purchaseReturnCount) },
          ],
        };
      case 'files':
        return {
          subtitle: isAr ? 'أرشيف المستندات والتصدير' : 'Documents & Export Center',
          headline: isAr
            ? `${s.totalSalesCount + s.totalPurchasesCount} مستند`
            : `${s.totalSalesCount + s.totalPurchasesCount} Records`,
          headlineCaption: isAr ? 'إجمالي الفواتير والسندات' : 'Indexed Vouchers',
          metrics: [
            { label: isAr ? 'مبيعات' : 'Sales', value: String(s.totalSalesCount) },
            { label: isAr ? 'مشتريات' : 'Purchases', value: String(s.totalPurchasesCount) },
            { label: isAr ? 'مرتجعات' : 'Returns', value: String(s.salesReturnCount + s.purchaseReturnCount) },
          ],
        };
      case 'settings':
        return {
          subtitle: isAr ? 'إعدادات المتجر والطباعة والنظام' : 'Store, Tax, Print & Users',
          headline: s.eInvoiceEnabled
            ? (isAr ? 'الفوترة الإلكترونية مفعّلة' : 'E-Invoice Active')
            : (isAr ? 'إعدادات النظام' : 'System Ready'),
          headlineCaption: isAr ? 'حالة الامتثال والطباعة' : 'Compliance & Print Config',
          badge: {
            label: s.eInvoiceEnabled ? (isAr ? 'مفعّل' : 'Phase 1') : (isAr ? 'قياسي' : 'Standard'),
            tone: s.eInvoiceEnabled ? 'emerald' : 'slate',
          },
          metrics: [
            { label: isAr ? 'الضريبة' : 'VAT Rate', value: `${s.taxRate}%` },
            { label: isAr ? 'الورق' : 'Paper', value: s.paperWidth },
            { label: isAr ? 'العملة' : 'Currency', value: s.currencySymbol },
          ],
        };
      default:
        return null;
    }
  };

  const activeLauncherItems = launcherItems
    .filter((item) => !item.comingSoon)
    .sort((a, b) => (a.id === 'files' ? 1 : b.id === 'files' ? -1 : 0));
  const upgradeLauncherItems = launcherItems.filter((item) => item.comingSoon);

  const badgeToneClass = (tone: 'emerald' | 'amber' | 'red' | 'blue' | 'slate') => {
    if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-800';
    if (tone === 'red') return 'border-red-200 bg-red-50 text-red-700';
    if (tone === 'blue') return 'border-blue-200 bg-blue-50 text-blue-700';
    return 'border-slate-200 bg-slate-100 text-slate-600';
  };

  const metricToneClass = (tone?: 'emerald' | 'amber' | 'red' | 'blue') => {
    if (tone === 'emerald') return 'text-emerald-700';
    if (tone === 'amber') return 'text-amber-700';
    if (tone === 'red') return 'text-red-600';
    if (tone === 'blue') return 'text-blue-700';
    return 'text-slate-800';
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
              if (isFlyErpMode) {
                onToggleSideNav?.();
                return;
              }
              if (showLauncher) {
                closeLauncher();
              } else {
                setOpenNavigationGroup(null);
                onSettingsComponentChange(false);
                setShowLauncher(true);
              }
            }}
            className="p-1.5 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
            aria-label={
              isFlyErpMode
                ? (language === 'ar' ? 'تبديل قائمة التنقل' : 'Toggle navigation panel')
                : (language === 'ar' ? 'فتح مشغل التطبيقات' : 'Open app launcher')
            }
            aria-expanded={isFlyErpMode ? sideNavOpen : showLauncher}
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              handleSelectNavigationTab(
                appScreenMode === 'erp' || appScreenMode === 'flyerp' ? 'sales-entry' : 'register'
              );
              onSettingsLauncherChange(false);
              onSettingsComponentChange(false);
            }}
            className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded flex items-center gap-1.5"
          >
            <span>apt<span className={appName === 'aptERP' ? 'text-violet-700' : appName === 'aptFlyERP' ? 'text-emerald-700' : 'text-blue-700'}>{appName.slice(3)}</span></span>
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
            {currentUser.demoMode && (
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${
                  isFlyErpMode
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
                aria-label={
                  demoSecondsRemaining === null
                    ? (language === 'ar' ? 'وضع تجريبي' : 'Demo Mode')
                    : `Demo time remaining ${formatDemoCountdown(demoSecondsRemaining)}`
                }
                title={language === 'ar' ? 'وضع تجريبي' : 'Demo Mode'}
              >
                {language === 'ar' ? 'وضع تجريبي' : 'Demo Mode'}
                {demoSecondsRemaining !== null && (
                  <span className="ml-1 font-mono">{formatDemoCountdown(demoSecondsRemaining)}</span>
                )}
              </span>
            )}
            {amcStatus && (
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${amcStatus.className}`}
                role={amcExpiryDays !== null && amcExpiryDays >= 0 && amcExpiryDays <= 10 ? 'status' : undefined}
              >
                {amcStatus.label}
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

      {!isFlyErpMode && showLauncher && (
        <div
          className="app-launcher-backdrop fixed inset-x-0 bottom-0 top-14 z-[60] flex items-start justify-center bg-white p-2 sm:p-4 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeLauncher();
          }}
        >
          <div
            dir={language === 'ar' ? 'rtl' : 'ltr'}
            className="win11-start-panel relative flex h-[calc(100dvh-4.5rem)] max-h-[calc(100dvh-4.5rem)] w-full max-w-7xl flex-col overflow-hidden rounded-t-3xl p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:h-[calc(100dvh-5.5rem)] sm:max-h-[calc(100dvh-5.5rem)] sm:rounded-3xl sm:px-7 sm:pb-6 sm:pt-5"
            style={launcherBackgroundDataUrl
              ? {
                  backgroundImage: `linear-gradient(var(--theme-launcher-image-overlay), var(--theme-launcher-image-overlay)), url("${launcherBackgroundDataUrl}")`,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover',
                }
              : undefined}
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
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
                {launcherSummary && (
                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                          {launcherSummary.storeName || appName}
                        </h2>
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                          {appName}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {new Date(currentTime).toLocaleDateString(
                          language === 'ar' ? 'ar-SA' : 'en-GB',
                          { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' }
                        )}
                        {' · '}
                        {new Date(currentTime).toLocaleTimeString(
                          language === 'ar' ? 'ar-SA' : 'en-US',
                          { hour: '2-digit', minute: '2-digit' }
                        )}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {language === 'ar' ? 'مبيعات اليوم' : "Today's Sales"}
                        </div>
                        <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-emerald-700">
                          {formatMoney(launcherSummary.todaySalesTotal)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {language === 'ar' ? 'فواتير اليوم' : "Today's Bills"}
                        </div>
                        <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-slate-900">
                          {launcherSummary.todaySalesCount}
                          {launcherSummary.draftSalesCount > 0 && (
                            <span className="ml-1.5 text-[10px] font-semibold text-amber-700">
                              +{launcherSummary.draftSalesCount} {language === 'ar' ? 'مسودة' : 'draft'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {language === 'ar' ? 'تنبيهات المخزون' : 'Stock Alerts'}
                        </div>
                        <div className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                          launcherSummary.outOfStockCount > 0
                            ? 'text-red-600'
                            : launcherSummary.lowStockCount > 0
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                        }`}>
                          {launcherSummary.lowStockCount + launcherSummary.outOfStockCount}
                          <span className="ml-1 text-[10px] font-medium text-slate-500">
                            / {launcherSummary.totalProducts}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {language === 'ar' ? 'الرصيد النقدي' : 'Cash Balance'}
                        </div>
                        <div className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                          launcherSummary.cashbookBalance >= 0 ? 'text-blue-700' : 'text-red-600'
                        }`}>
                          {formatMoney(launcherSummary.cashbookBalance)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="launcher-grid grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {activeLauncherItems.map((entry) => {
                    const Icon = entry.icon;
                    const label = language === 'ar' ? entry.labelAr : entry.label;
                    const isMenuLanding = !selectedHubModule;
                    const summary = getTileSummary(entry.id);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        aria-label={label}
                        title={label}
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
                        className="group flex w-full min-w-0 flex-col justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white/95 p-4 text-start shadow-xs transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              data-art={isMenuLanding ? entry.id : undefined}
                              className="win11-launcher-icon relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
                            >
                              {isMenuLanding ? (
                                <LauncherAppArt id={entry.id} />
                              ) : (
                                <Icon strokeWidth={1.75} className="relative z-10 h-6 w-6 text-blue-700" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-slate-900 group-hover:text-blue-700">
                                {label}
                              </div>
                              {summary && (
                                <div className="mt-0.5 truncate text-[11px] text-slate-500">
                                  {summary.subtitle}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {summary?.badge && (
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeToneClass(summary.badge.tone)}`}>
                                {summary.badge.label}
                              </span>
                            )}
                            <ChevronRight
                              className={`h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600 ${
                                language === 'ar' ? 'rotate-180 group-hover:-translate-x-0.5' : ''
                              }`}
                            />
                          </div>
                        </div>

                        {summary && (
                          <div className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-2.5">
                            <span className="truncate font-mono text-lg font-bold tabular-nums text-slate-900">
                              {summary.headline}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              {summary.headlineCaption}
                            </span>
                          </div>
                        )}

                        {!iconOnlyLauncher && summary && summary.metrics.length > 0 && (
                          <div
                            className={`grid gap-2 rounded-xl bg-slate-50/90 px-2.5 py-2 ${
                              summary.metrics.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
                            }`}
                          >
                            {summary.metrics.map((metric) => (
                              <div key={metric.label} className="min-w-0">
                                <div className="truncate text-[10px] font-medium text-slate-500">
                                  {metric.label}
                                </div>
                                <div className={`mt-0.5 truncate font-mono text-xs font-bold tabular-nums ${metricToneClass(metric.tone)}`}>
                                  {metric.value}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {upgradeLauncherItems.length > 0 && (
                  <div className="space-y-2 border-t border-slate-200/80 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {language === 'ar' ? 'وحدات إضافية (ترقية)' : 'Additional Modules (Upgrade)'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {upgradeLauncherItems.map((entry) => {
                        const label = language === 'ar' ? entry.labelAr : entry.label;
                        const accessibleLabel = `${label} - ${language === 'ar' ? 'ترقية' : 'Upgrade'}`;
                        return (
                          <div
                            key={entry.id}
                            aria-label={accessibleLabel}
                            title={accessibleLabel}
                            className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2.5 opacity-65"
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span
                                data-art={entry.id}
                                className="win11-launcher-icon relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                              >
                                <LauncherAppArt id={entry.id} />
                              </span>
                              <span className="truncate text-xs font-semibold text-slate-700">
                                {label}
                              </span>
                            </div>
                            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                              {language === 'ar' ? 'ترقية' : 'Upgrade'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
