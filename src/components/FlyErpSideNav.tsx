import React from 'react';
import {
  BarChart3,
  Barcode,
  BookOpen,
  Clock,
  FileText,
  Files,
  Package,
  Plane,
  QrCode,
  Receipt,
  RotateCcw,
  Settings,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import type { NavTab } from './TopBar';

type AccountsSubtab = 'ledger' | 'customers' | 'vendors' | 'payments';

interface FlyErpSideNavProps {
  isOpen: boolean;
  activeTab: NavTab;
  accountsSubtab: AccountsSubtab;
  hasPermission: (tab: NavTab) => boolean;
  onSelectTab: (tab: NavTab) => void;
  onSelectAccountsSubtab: (subtab: AccountsSubtab) => void;
  onOpenCashbook: () => void;
  onCloseMobile?: () => void;
}

interface SideNavEntry {
  id: string;
  label: string;
  labelAr: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tab: NavTab;
  accountsSubtab?: AccountsSubtab;
  action?: 'open-cashbook';
}

interface SideNavGroup {
  id: string;
  label: string;
  labelAr: string;
  items: SideNavEntry[];
}

export const FlyErpSideNav: React.FC<FlyErpSideNavProps> = ({
  isOpen,
  activeTab,
  accountsSubtab,
  hasPermission,
  onSelectTab,
  onSelectAccountsSubtab,
  onOpenCashbook,
  onCloseMobile,
}) => {
  const { language, isRtl } = useLanguage();

  if (!isOpen) {
    return null;
  }

  const groups: SideNavGroup[] = [
    {
      id: 'sales',
      label: 'Sales',
      labelAr: 'المبيعات',
      items: [
        {
          id: 'sales-entry',
          label: 'Travel Billing',
          labelAr: 'فواتير السفر',
          icon: Plane,
          tab: 'sales-entry',
        },
        {
          id: 'sales',
          label: 'Sales History',
          labelAr: 'سجل المبيعات',
          icon: Receipt,
          tab: 'sales',
        },
        {
          id: 'return-register',
          label: 'Sales Return',
          labelAr: 'مرتجع مبيعات',
          icon: RotateCcw,
          tab: 'return-register',
        },
        {
          id: 'return-history',
          label: 'Sales Return History',
          labelAr: 'سجل مرتجعات المبيعات',
          icon: RotateCcw,
          tab: 'return-history',
        },
      ],
    },
    {
      id: 'accounts',
      label: 'Accounts',
      labelAr: 'الحسابات',
      items: [
        {
          id: 'ledger',
          label: 'Ledger',
          labelAr: 'دفتر الحسابات',
          icon: BookOpen,
          tab: 'accounts',
          accountsSubtab: 'ledger',
        },
        {
          id: 'customers',
          label: 'Customers',
          labelAr: 'العملاء',
          icon: Users,
          tab: 'customers',
          accountsSubtab: 'customers',
        },
        {
          id: 'payments',
          label: 'Payments & Receipts',
          labelAr: 'المدفوعات والمقبوضات',
          icon: Receipt,
          tab: 'accounts',
          accountsSubtab: 'payments',
        },
        {
          id: 'cashbook',
          label: 'Cash Book',
          labelAr: 'دفتر النقدية',
          icon: Wallet,
          tab: 'accounts',
          action: 'open-cashbook',
        },
        {
          id: 'inventory',
          label: 'Services',
          labelAr: 'الخدمات',
          icon: Package,
          tab: 'inventory',
        },
      ],
    },
    {
      id: 'system',
      label: 'Operations & System',
      labelAr: 'العمليات والنظام',
      items: [
        {
          id: 'shift',
          label: 'Shift',
          labelAr: 'الوردية',
          icon: Clock,
          tab: 'shift',
        },
        {
          id: 'reports',
          label: 'Reports',
          labelAr: 'التقارير',
          icon: BarChart3,
          tab: 'reports',
        },
        {
          id: 'files',
          label: 'Files',
          labelAr: 'الملفات',
          icon: Files,
          tab: 'files',
        },
        {
          id: 'zatca',
          label: 'E-Invoicing',
          labelAr: 'الفوترة الإلكترونية',
          icon: QrCode,
          tab: 'zatca',
        },
        {
          id: 'settings',
          label: 'Settings',
          labelAr: 'الإعدادات',
          icon: Settings,
          tab: 'settings',
        },
      ],
    },
    {
      id: 'purchase-services',
      label: 'Purchase',
      labelAr: 'المشتريات',
      items: [
        {
          id: 'purchases',
          label: 'Purchase',
          labelAr: 'المشتريات',
          icon: FileText,
          tab: 'purchases',
        },
        {
          id: 'purchase-history',
          label: 'Purchase History',
          labelAr: 'سجل المشتريات',
          icon: FileText,
          tab: 'purchase-history',
        },
        {
          id: 'purchase-return-register',
          label: 'Purchase Return',
          labelAr: 'مرتجع مشتريات',
          icon: RotateCcw,
          tab: 'purchase-return-register',
        },
        {
          id: 'purchase-return-history',
          label: 'Purchase Return History',
          labelAr: 'سجل مرتجعات المشتريات',
          icon: RotateCcw,
          tab: 'purchase-return-history',
        },
        {
          id: 'vendors',
          label: 'Vendors',
          labelAr: 'الموردون',
          icon: Users,
          tab: 'vendors',
          accountsSubtab: 'vendors',
        },
        {
          id: 'barcode-print',
          label: 'Barcode Printing',
          labelAr: 'طباعة الباركود',
          icon: Barcode,
          tab: 'barcode-print',
        },
      ],
    },
  ];

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasPermission(item.tab)),
    }))
    .filter((group) => group.items.length > 0);

  const isEntryActive = (entry: SideNavEntry): boolean => {
    if (entry.action === 'open-cashbook') return false;
    if (entry.accountsSubtab) {
      if (entry.tab === 'customers') return activeTab === 'customers';
      if (entry.tab === 'vendors') return activeTab === 'vendors';
      return activeTab === 'accounts' && accountsSubtab === entry.accountsSubtab;
    }
    return activeTab === entry.tab;
  };

  const handleSelect = (entry: SideNavEntry) => {
    if (entry.action === 'open-cashbook') {
      onOpenCashbook();
    } else {
      if (entry.accountsSubtab) {
        onSelectAccountsSubtab(entry.accountsSubtab);
      }
      onSelectTab(entry.tab);
    }
    onCloseMobile?.();
  };

  return (
    <>
      <div
        className="no-print fixed inset-x-0 bottom-0 top-14 z-30 bg-slate-950/35 xl:hidden"
        onClick={onCloseMobile}
        aria-hidden="true"
      />
      <aside
        dir={isRtl ? 'rtl' : 'ltr'}
        aria-label={language === 'ar' ? 'التنقل الجانبي' : 'Side navigation'}
        className="no-print fixed inset-y-0 start-0 top-14 z-40 flex w-60 shrink-0 flex-col border-e border-slate-200 bg-white shadow-xl xl:static xl:inset-auto xl:top-auto xl:z-10 xl:shadow-none"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 xl:hidden">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {language === 'ar' ? 'القائمة' : 'Navigation'}
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label={language === 'ar' ? 'إغلاق القائمة' : 'Close navigation'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 py-3">
          {visibleGroups.map((group) => (
            <div key={group.id}>
              <div className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {language === 'ar' ? group.labelAr : group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((entry) => {
                  const Icon = entry.icon;
                  const active = isEntryActive(entry);
                  const label = language === 'ar' ? entry.labelAr : entry.label;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => handleSelect(entry)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-xs font-semibold transition-colors ${
                        active
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border border-transparent text-slate-600 hover:bg-emerald-50/70 hover:text-slate-900'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${active ? 'text-emerald-700' : 'text-slate-400'}`}
                        strokeWidth={2}
                      />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
};
