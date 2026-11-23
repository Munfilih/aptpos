import React, { useMemo, useState } from 'react';
import {
  Building2,
  Download,
  Edit2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react';
import type { StoreSettings, Vendor } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

interface VendorsViewProps {
  vendors: Vendor[];
  settings: StoreSettings;
  onRefresh: () => Promise<void>;
  createOnly?: boolean;
  onCreateOnlyClose?: () => void;
  onVendorCreated?: (vendorId: number) => void;
}

interface VendorFormState {
  name: string;
  nameAr: string;
  contactPerson: string;
  phone: string;
  email: string;
  taxNumber: string;
  crNumber: string;
  buildingNo: string;
  streetName: string;
  district: string;
  city: string;
  postalCode: string;
  country: string;
  address: string;
}

const EMPTY_FORM: VendorFormState = {
  name: '',
  nameAr: '',
  contactPerson: '',
  phone: '',
  email: '',
  taxNumber: '',
  crNumber: '',
  buildingNo: '',
  streetName: '',
  district: '',
  city: '',
  postalCode: '',
  country: 'Saudi Arabia',
  address: '',
};

export const VendorsView: React.FC<VendorsViewProps> = ({
  vendors,
  settings,
  onRefresh,
  createOnly = false,
  onCreateOnlyClose,
  onVendorCreated,
}) => {
  const { t, isRtl } = useLanguage();
  const c = isRtl ? 'ر.س ' : (settings.currencySymbol || 'SAR ');

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(createOnly);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [form, setForm] = useState<VendorFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [vendorNotice, setVendorNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return vendors;
    const q = search.trim().toLowerCase();
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.nameAr && v.nameAr.toLowerCase().includes(q)) ||
        v.contactPerson.toLowerCase().includes(q) ||
        v.phone.toLowerCase().includes(q) ||
        v.email.toLowerCase().includes(q) ||
        v.taxNumber.toLowerCase().includes(q)
    );
  }, [vendors, search]);

  const stats = useMemo(() => {
    const totalCount = vendors.length;
    const totalPurchased = vendors.reduce((sum, v) => sum + (v.totalPurchased || 0), 0);
    const totalInvoices = vendors.reduce((sum, v) => sum + (v.purchasesCount || 0), 0);
    return { totalCount, totalPurchased, totalInvoices };
  }, [vendors]);

  const openCreateModal = () => {
    setEditingVendor(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    if (createOnly) onCreateOnlyClose?.();
  };

  const openEditModal = (vend: Vendor) => {
    setEditingVendor(vend);
    setForm({
      name: vend.name,
      nameAr: vend.nameAr || '',
      contactPerson: vend.contactPerson,
      phone: vend.phone,
      email: vend.email,
      taxNumber: vend.taxNumber,
      crNumber: vend.crNumber || '',
      buildingNo: vend.buildingNo || '',
      streetName: vend.streetName || '',
      district: vend.district || '',
      city: vend.city || '',
      postalCode: vend.postalCode || '',
      country: vend.country || 'Saudi Arabia',
      address: vend.address,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError(isRtl ? 'اسم المورد مطلوب.' : 'Supplier / Vendor name is required.');
      return;
    }

    setSaving(true);
    try {
      const url = editingVendor ? `/api/vendors/${editingVendor.id}` : '/api/vendors';
      const method = editingVendor ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (isRtl ? 'فشل حفظ بيانات المورد.' : 'Failed to save vendor.'));
      }

      const createdVendorId =
        !editingVendor &&
        typeof data === 'object' &&
        data !== null &&
        'id' in data &&
        typeof data.id === 'number'
          ? data.id
          : null;
      await onRefresh();
      setModalOpen(false);
      if (createOnly) {
        if (createdVendorId !== null && onVendorCreated) {
          onVendorCreated(createdVendorId);
        } else {
          onCreateOnlyClose?.();
        }
      }
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (vend: Vendor) => {
    if (vend.purchasesCount > 0) {
      setVendorNotice(
        isRtl
          ? `المورد "${vend.nameAr || vend.name}" مرتبط بـ ${vend.purchasesCount} أوامر شراء. احذف المشتريات أولاً.`
          : `Vendor "${vend.name}" is linked to ${vend.purchasesCount} purchase orders. Delete the purchases first.`
      );
      setTimeout(() => setVendorNotice(null), 4000);
      return;
    }
    await fetch(`/api/vendors/${vend.id}`, { method: 'DELETE' });
    await onRefresh();
  };

  const handleExportCsv = () => {
    const headers = ['Vendor Name', 'Contact Person', 'Phone', 'Email', 'Address', 'Tax Number', 'Total Purchased', 'Invoices Count'];
    const rows = filtered.map((v) => [
      `"${v.name.replace(/"/g, '""')}"`,
      `"${v.contactPerson.replace(/"/g, '""')}"`,
      `"${v.phone}"`,
      `"${v.email}"`,
      `"${v.address.replace(/"/g, '""')}"`,
      `"${v.taxNumber}"`,
      v.totalPurchased.toFixed(2),
      v.purchasesCount,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={createOnly ? 'contents' : 'flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6 bg-slate-50'}>
      {!createOnly && (
        <>
      {vendorNotice && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs">
          {vendorNotice}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'الموردون النشطون' : 'Active Suppliers'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {stats.totalCount}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'إجمالي المشتريات' : 'Total Purchase Volume'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {c}
            {stats.totalPurchased.toFixed(2)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4">
          <div className="text-xs font-medium text-slate-500">{isRtl ? 'فواتير الشراء المسجلة' : 'Recorded PO Invoices'}</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
            {stats.totalInvoices}
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
              placeholder={isRtl ? 'بحث باسم المورد أو جهة الاتصال...' : 'Search vendor name, contact, or phone...'}
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
              <span>{isRtl ? 'مورد جديد' : 'New Vendor'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Vendors Cards View (< md) */}
        <div className="md:hidden divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              {isRtl ? 'لا يوجد موردون. اضغط "مورد جديد" للإضافة.' : 'No suppliers registered yet. Click "New Vendor" to add one.'}
            </div>
          ) : (
            filtered.map((vend) => (
              <div key={vend.id} className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{isRtl && vend.nameAr ? vend.nameAr : vend.name}</span>
                    </div>
                    {vend.contactPerson && (
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        {isRtl ? 'جهة الاتصال:' : 'Contact:'} {vend.contactPerson}
                      </div>
                    )}
                    {vend.phone && (
                      <div className="text-[11px] text-slate-500 font-mono">
                        {vend.phone}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(vend)}
                      className="p-1.5 text-slate-600 hover:text-blue-700 rounded hover:bg-slate-100"
                      aria-label={`Edit ${vend.name}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(vend)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100"
                      aria-label={`Delete ${vend.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {vend.purchasesCount} {isRtl ? 'فاتورة' : (vend.purchasesCount === 1 ? 'invoice' : 'invoices')}
                  </span>
                  <span className="font-mono font-bold text-slate-900">
                    {c}{vend.totalPurchased.toFixed(2)}
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
                <th className="py-2.5 px-4">{isRtl ? 'اسم الشركة' : 'Vendor Company'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'جهة الاتصال' : 'Contact Person'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'بيانات التواصل' : 'Contact Details'}</th>
                <th className="py-2.5 px-4">{isRtl ? 'الرقم الضريبي' : 'Tax / EIN'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'الفواتير' : 'Invoices'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'إجمالي المشتريات' : 'Total Purchased'}</th>
                <th className={`py-2.5 px-4 ${isRtl ? 'text-left' : 'text-right'}`}>{isRtl ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    {isRtl ? 'لا يوجد موردون. اضغط "مورد جديد" للإضافة.' : 'No vendor suppliers found. Click "New Vendor" to register a supplier.'}
                  </td>
                </tr>
              ) : (
                filtered.map((vend) => (
                  <tr key={vend.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                        <div>
                          <div>{isRtl && vend.nameAr ? vend.nameAr : vend.name}</div>
                          {isRtl && vend.nameAr && (
                            <div className="text-[11px] text-slate-400">{vend.name}</div>
                          )}
                        </div>
                      </div>
                      {vend.address && (
                        <div className="text-[11px] text-slate-400 pl-6 flex items-center gap-1 mt-0.5 truncate max-w-xs">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{vend.address}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      {vend.contactPerson || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      <div className="space-y-0.5">
                        {vend.phone && (
                          <div className="flex items-center gap-1.5 font-mono text-[11px]">
                            <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{vend.phone}</span>
                          </div>
                        )}
                        {vend.email && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{vend.email}</span>
                          </div>
                        )}
                        {!vend.phone && !vend.email && <span>—</span>}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {vend.taxNumber || '—'}
                    </td>
                    <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} font-mono text-slate-600 tabular-nums whitespace-nowrap`}>
                      {vend.purchasesCount}
                    </td>
                    <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap`}>
                      {c}
                      {vend.totalPurchased.toFixed(2)}
                    </td>
                    <td className={`py-3 px-4 ${isRtl ? 'text-left' : 'text-right'} whitespace-nowrap`}>
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(vend)}
                          className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-slate-100 rounded transition-colors"
                          aria-label={`Edit ${vend.name}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(vend)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded transition-colors"
                          aria-label={`Delete ${vend.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {/* Vendor Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vendor-modal-title"
          onKeyDown={(event) => {
            if (event.altKey && event.key.toLowerCase() === 's') {
              event.preventDefault();
              event.stopPropagation();
              if (!saving) {
                event.currentTarget
                  .querySelector<HTMLFormElement>('#vendor-form')
                  ?.requestSubmit();
              }
            }
          }}
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h2 id="vendor-modal-title" className="text-base font-semibold text-slate-900">
                {editingVendor
                  ? (isRtl ? 'تعديل بيانات المورد' : 'Edit Vendor Supplier')
                  : (isRtl ? 'إضافة مورد جديد' : 'Add New Vendor / Supplier')}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form id="vendor-form" onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs overflow-y-auto flex-1">
              {formError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-800">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'اسم الشركة / المورد (إنجليزي) *' : 'Company / Vendor Name (En) *'}</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Almarai Distribution Co."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'اسم المورد (عربي)' : 'Vendor Name (Arabic)'}</label>
                  <input
                    type="text"
                    dir="rtl"
                    value={form.nameAr}
                    onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                    placeholder="شركة المراعي للتوزيع"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              {/* Saudi Tax & CR Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {isRtl ? 'الرقم الضريبي (15 رقم، هيئة الزكاة)' : 'VAT / Tax Number (15 digits, ZATCA)'}
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    value={form.taxNumber}
                    onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
                    placeholder="300123456700003"
                    className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {isRtl ? 'السجل التجاري (10 أرقام)' : 'CR Number (10 digits)'}
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={form.crNumber}
                    onChange={(e) => setForm({ ...form, crNumber: e.target.value })}
                    placeholder="1010123456"
                    className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'جهة الاتصال' : 'Contact Person'}</label>
                  <input
                    type="text"
                    value={form.contactPerson}
                    onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                    placeholder="e.g., Sarah Jenkins"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'الهاتف' : 'Phone'}</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+966 11 555 0199"
                    className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'البريد الإلكتروني' : 'Email'}</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="orders@supplier.sa"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              {/* Saudi National Address */}
              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'رقم المبنى' : 'Building No'}</label>
                  <input
                    type="text"
                    value={form.buildingNo}
                    onChange={(e) => setForm({ ...form, buildingNo: e.target.value })}
                    placeholder="7890"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'الشارع' : 'Street'}</label>
                  <input
                    type="text"
                    value={form.streetName}
                    onChange={(e) => setForm({ ...form, streetName: e.target.value })}
                    placeholder="Industrial Area St"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'الحي' : 'District'}</label>
                  <input
                    type="text"
                    value={form.district}
                    onChange={(e) => setForm({ ...form, district: e.target.value })}
                    placeholder="2nd Industrial City"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'المدينة' : 'City'}</label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    placeholder="Riyadh"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'الرمز البريدي' : 'Postal Code'}</label>
                  <input
                    type="text"
                    value={form.postalCode}
                    onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                    placeholder="11564"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'الدولة' : 'Country'}</label>
                  <input
                    type="text"
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    placeholder="Saudi Arabia"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">{isRtl ? 'العنوان الكامل' : 'Full Address'}</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Street, District, City, KSA"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 rounded-lg"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  title={isRtl ? 'حفظ المورد (Alt+S)' : 'Save vendor (Alt+S)'}
                  aria-keyshortcuts="Alt+S"
                  className="px-4 py-2 font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50"
                >
                  {saving
                    ? (isRtl ? 'جاري الحفظ...' : 'Saving...')
                    : editingVendor
                    ? (isRtl ? 'حفظ التغييرات' : 'Save Changes')
                    : (isRtl ? 'إضافة المورد' : 'Create Vendor')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
