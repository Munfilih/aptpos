import React, { useMemo, useState } from 'react';
import {
  Download,
  Edit2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Trash2,
  User
} from 'lucide-react';
import type { Customer, StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { CustomerFormModal } from './CustomerFormModal';

interface CustomersViewProps {
  customers: Customer[];
  settings: StoreSettings;
  onRefresh: () => Promise<void>;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  settings,
  onRefresh,
}) => {
  const { t, isRtl } = useLanguage();
  const c = isRtl ? 'ر.س ' : (settings.currencySymbol || 'SAR ');

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.trim().toLowerCase();
    return customers.filter(
      (cust) =>
        cust.name.toLowerCase().includes(q) ||
        (cust.nameAr && cust.nameAr.toLowerCase().includes(q)) ||
        cust.phone.toLowerCase().includes(q) ||
        cust.email.toLowerCase().includes(q) ||
        cust.address.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const stats = useMemo(() => {
    const totalCount = customers.length;
    const totalSpent = customers.reduce((sum, cust) => sum + (cust.totalSpent || 0), 0);
    const avgSpent = totalCount > 0 ? totalSpent / totalCount : 0;
    return { totalCount, totalSpent, avgSpent };
  }, [customers]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    setModalOpen(true);
  };

  const openEditModal = (cust: Customer) => {
    setEditingCustomer(cust);
    setModalOpen(true);
  };

  const handleDelete = async (cust: Customer) => {
    if (cust.name === 'Walk-in Customer') {
      setActionNotice(isRtl ? 'لا يمكن حذف عميل الزيارة الافتراضي.' : 'Default Walk-in Customer cannot be removed.');
      setTimeout(() => setActionNotice(null), 3000);
      return;
    }
    await fetch(`/api/customers/${cust.id}`, { method: 'DELETE' });
    await onRefresh();
  };

  const handleExportCsv = () => {
    const headers = ['Name', 'Phone', 'Email', 'Address', 'Total Spent', 'Orders Count', 'Notes'];
    const rows = filtered.map((c) => [
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.phone}"`,
      `"${c.email}"`,
      `"${c.address.replace(/"/g, '""')}"`,
      c.totalSpent.toFixed(2),
      c.ordersCount,
      `"${(c.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6 bg-slate-50">
      {actionNotice && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs">
          {actionNotice}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'العملاء المسجلون' : 'Registered Customers'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {stats.totalCount}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'إجمالي الإيرادات' : 'Cumulative Revenue'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {c}
            {stats.totalSpent.toFixed(2)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'متوسط قيمة العميل' : 'Average Lifetime Value'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {c}
            {stats.avgSpent.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-3 sm:p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className={`w-4 h-4 text-slate-400 absolute ${isRtl ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 pointer-events-none`} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isRtl ? 'بحث باسم العميل أو الهاتف...' : 'Search customer name, phone, or email...'}
              className={`w-full ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'} py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-blue-700`}
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isRtl ? 'تصدير CSV' : 'Export CSV'}</span>
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isRtl ? 'عميل جديد' : 'New Customer'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Customer Cards (< md) */}
        <div className="md:hidden divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              {isRtl ? 'لا يوجد عملاء. اضغط "عميل جديد" للإضافة.' : 'No customer accounts found. Click "New Customer" to register one.'}
            </div>
          ) : (
            filtered.map((cust) => (
              <div key={cust.id} className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{isRtl && cust.nameAr ? cust.nameAr : cust.name}</span>
                    </div>
                    {isRtl && cust.nameAr && cust.name && (
                      <div className="text-[11px] text-slate-400 mt-0.5 ps-5">{cust.name}</div>
                    )}
                    {cust.phone && (
                      <div className="text-[11px] text-slate-600 font-mono mt-0.5">
                        {cust.phone}
                      </div>
                    )}
                    {cust.email && (
                      <div className="text-[11px] text-slate-500 truncate">
                        {cust.email}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(cust)}
                      className="p-1.5 text-slate-600 hover:text-blue-700 rounded hover:bg-slate-100"
                      aria-label={`Edit ${cust.name}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {cust.name !== 'Walk-in Customer' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(cust)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100"
                        aria-label={`Delete ${cust.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {cust.ordersCount} {isRtl ? 'طلب' : (cust.ordersCount === 1 ? 'order' : 'orders')}
                  </span>
                  <span className="font-mono font-bold text-slate-900">
                    {c}{cust.totalSpent.toFixed(2)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop Table View (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className={`w-full border-collapse ${isRtl ? 'text-right' : 'text-left'}`}>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4">{isRtl ? 'اسم العميل' : 'Customer Name'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'الهاتف' : 'Phone'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'البريد الإلكتروني' : 'Email'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'العنوان' : 'Address'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الطلبات' : 'Orders'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'إجمالي الإنفاق' : 'Total Spent'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    {isRtl ? 'لا يوجد عملاء. اضغط "عميل جديد" للإضافة.' : 'No customer accounts found. Click "New Customer" to register one.'}
                  </td>
                </tr>
              ) : (
                filtered.map((cust) => (
                  <tr key={cust.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-slate-400 shrink-0" />
                        <div>
                          <div>{isRtl && cust.nameAr ? cust.nameAr : cust.name}</div>
                          {isRtl && cust.nameAr && (
                            <div className="text-[11px] text-slate-400">{cust.name}</div>
                          )}
                        </div>
                      </div>
                      {cust.notes && (
                        <div className="text-[11px] text-slate-400 pl-6 line-clamp-1">
                          {cust.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {cust.phone ? (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{cust.phone}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {cust.email ? (
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{cust.email}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                      {cust.address ? (
                        <div className="flex items-center gap-1.5 truncate">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{cust.address}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} font-mono text-slate-600 tabular-nums whitespace-nowrap`}>
                      {cust.ordersCount}
                    </td>
                    <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap`}>
                      {c}
                      {cust.totalSpent.toFixed(2)}
                    </td>
                    <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} whitespace-nowrap`}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(cust)}
                          className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-slate-100 rounded transition-colors"
                          aria-label={`Edit ${cust.name}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {cust.name !== 'Walk-in Customer' && (
                          <button
                            type="button"
                            onClick={() => handleDelete(cust)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded transition-colors"
                            aria-label={`Delete ${cust.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <CustomerFormModal
          customer={editingCustomer}
          onClose={() => {
            setModalOpen(false);
            setEditingCustomer(null);
          }}
          onSaved={onRefresh}
        />
      )}
    </div>
  );
};
