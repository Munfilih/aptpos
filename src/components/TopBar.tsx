import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Menu,
  ShoppingBag,
  Package,
  FileText,
  Users,
  Receipt,
  History as HistoryIcon,
  Wallet,
  Settings as SettingsIcon,
  ChevronRight,
  CalendarDays,
  LogOut,
  RotateCcw,
  BarChart3,
} from 'lucide-react';
import type { UserSession } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

export type NavTab =
  | 'register'
  | 'inventory'
  | 'purchases'
  | 'customers'
  | 'vendors'
  | 'sales'
  | 'return-register'
  | 'return-history'
  | 'accounts'
  | 'reports'
  | 'settings';

interface TopBarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onLogout: () => void;
  currentUser: UserSession | null;
}

interface TopNavLink {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  permission?: string;
}

interface TopNavGroup {
  id: 'history' | 'parties';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: Array<{
    id: NavTab;
    label: string;
    permission: string;
    adminOnly?: boolean;
  }>;
}

type TopNavItem = TopNavLink | TopNavGroup;

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onLogout,
  currentUser,
}) => {
  const { t, language } = useLanguage();
  const [showNavigationDrawer, setShowNavigationDrawer] = useState(false);
  const [openNavigationGroup, setOpenNavigationGroup] = useState<'history' | 'parties' | null>(null);
  const [systemTime, setSystemTime] = useState(() => new Date());
  const calendarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setSystemTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
      id: 'history',
      label: t.navHistory,
      icon: HistoryIcon,
      children: [
        { id: 'sales', label: t.navSales, permission: 'sales' },
        { id: 'return-history', label: t.navSalesReturnHistory, permission: 'sales-return' },
      ],
    },
    { id: 'inventory', label: t.navInventory, icon: Package, adminOnly: true },
    { id: 'accounts', label: t.navAccounts, icon: Wallet, adminOnly: true },
    { id: 'reports', label: t.navReports, icon: BarChart3, permission: 'sales' },
    { id: 'settings', label: t.navSettings, icon: SettingsIcon, adminOnly: true },
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

  const handleSelectNavigationTab = (tab: NavTab) => {
    onSelectTab(tab);
    setShowNavigationDrawer(false);
    setOpenNavigationGroup(null);
  };

  const openCalendar = () => {
    const calendarInput = calendarInputRef.current;
    if (!calendarInput) return;

    calendarInput.value = [
      systemTime.getFullYear(),
      String(systemTime.getMonth() + 1).padStart(2, '0'),
      String(systemTime.getDate()).padStart(2, '0'),
    ].join('-');

    if (typeof calendarInput.showPicker === 'function') {
      calendarInput.showPicker();
    } else {
      calendarInput.focus();
      calendarInput.click();
    }
  };

  return (
    <>
      <header className="no-print h-14 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-6 shrink-0 z-20">
        {/* Zone 1: Brand title & Menu Toggle */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setShowNavigationDrawer(true)}
            className="p-1.5 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('register')}
            className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded flex items-center gap-1.5"
          >
            <span>apt<span className="text-blue-700">POS</span></span>
          </button>
        </div>

        {/* Zone 2: System date, time, and calendar */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={openCalendar}
              title={language === 'ar' ? 'فتح التقويم' : 'Open calendar'}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 sm:gap-2.5 sm:px-3"
            >
              <CalendarDays className="h-4 w-4 shrink-0 text-blue-700" />
              <span className="whitespace-nowrap">
                {systemTime.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <span className="whitespace-nowrap font-mono tabular-nums">
                {systemTime.toLocaleTimeString(language === 'ar' ? 'ar-SA' : 'en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </button>
            <input
              ref={calendarInputRef}
              type="date"
              aria-label={language === 'ar' ? 'التقويم' : 'Calendar'}
              className="pointer-events-none absolute h-px w-px opacity-0"
              tabIndex={-1}
            />
          </div>
        </div>
      </header>

      {/* Slide-over Navigation Drawer */}
      {showNavigationDrawer && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation Menu"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            onClick={() => setShowNavigationDrawer(false)}
          />

          {/* Drawer content */}
          <div className="relative w-72 max-w-[85vw] bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="font-display text-base font-bold text-slate-900">
                  apt<span className="text-blue-700">POS</span>
                </div>
                <div className="text-xs text-slate-500">Retail Terminal & Inventory</div>
              </div>
              <button
                type="button"
                onClick={() => setShowNavigationDrawer(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Navigation Tabs List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-400 px-3 py-1 uppercase tracking-wider">
                {t.terminalNav}
              </div>
              {visibleNav.map((item) => {
                if ('children' in item) {
                  const Icon = item.icon;
                  const isActive = item.children.some((child) => child.id === activeTab);
                  const isOpen = openNavigationGroup === item.id;
                  return (
                    <div key={item.id}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpenNavigationGroup(isOpen ? null : item.id)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-blue-50 text-blue-800 font-semibold'
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className={`w-4 h-4 ${isActive ? 'text-blue-700' : 'text-slate-400'}`} />
                          <span>{item.label}</span>
                        </div>
                        <ChevronRight className={`w-3.5 h-3.5 text-slate-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      </button>
                      {isOpen && (
                        <div className="ml-8 mt-1 space-y-1 border-l border-slate-200 pl-2">
                          {item.children.map((child) => (
                            <button
                              key={child.id}
                              type="button"
                              onClick={() => handleSelectNavigationTab(child.id)}
                              className={`w-full rounded-lg px-3 py-2 text-left text-xs font-medium ${
                                activeTab === child.id
                                  ? 'bg-blue-50 text-blue-800'
                                  : 'text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {child.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNavigationTab(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-800 font-semibold'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        className={`w-4 h-4 ${isActive ? 'text-blue-700' : 'text-slate-400'}`}
                      />
                      <span>{item.label}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                  </button>
                );
              })}
            </div>
            <div className="border-t border-slate-200 p-3">
              <button
                type="button"
                onClick={() => {
                  setShowNavigationDrawer(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                <span>{t.navLogout}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
