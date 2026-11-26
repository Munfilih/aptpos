import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { Customer } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';

interface CustomerFormState {
  name: string;
  nameAr: string;
  vatNumber: string;
  crNumber: string;
  phone: string;
  email: string;
  buildingNo: string;
  streetName: string;
  district: string;
  city: string;
  postalCode: string;
  country: string;
  address: string;
  notes: string;
}

interface CustomerFormModalProps {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (customer: Customer) => Promise<void> | void;
}

const EMPTY_FORM: CustomerFormState = {
  name: '',
  nameAr: '',
  vatNumber: '',
  crNumber: '',
  phone: '',
  email: '',
  buildingNo: '',
  streetName: '',
  district: '',
  city: '',
  postalCode: '',
  country: 'Saudi Arabia',
  address: '',
  notes: '',
};

const isCustomerResponse = (value: unknown): value is Customer => {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value && typeof value.id === 'number' &&
    'name' in value && typeof value.name === 'string' &&
    'phone' in value && typeof value.phone === 'string' &&
    'email' in value && typeof value.email === 'string' &&
    'address' in value && typeof value.address === 'string' &&
    'notes' in value && typeof value.notes === 'string' &&
    'createdAt' in value && typeof value.createdAt === 'string' &&
    'totalSpent' in value && typeof value.totalSpent === 'number' &&
    'ordersCount' in value && typeof value.ordersCount === 'number'
  );
};

const getCustomerForm = (customer: Customer | null): CustomerFormState =>
  customer
    ? {
        name: customer.name,
        nameAr: customer.nameAr || '',
        vatNumber: customer.vatNumber || '',
        crNumber: customer.crNumber || '',
        phone: customer.phone,
        email: customer.email,
        buildingNo: customer.buildingNo || '',
        streetName: customer.streetName || '',
        district: customer.district || '',
        city: customer.city || '',
        postalCode: customer.postalCode || '',
        country: customer.country || 'Saudi Arabia',
        address: customer.address,
        notes: customer.notes,
      }
    : EMPTY_FORM;

export const CustomerFormModal: React.FC<CustomerFormModalProps> = ({
  customer,
  onClose,
  onSaved,
}) => {
  const { isRtl } = useLanguage();
  const [form, setForm] = useState<CustomerFormState>(() => getCustomerForm(customer));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError(isRtl ? 'اسم العميل مطلوب.' : 'Customer name is required.');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        customer ? `/api/customers/${customer.id}` : '/api/customers',
        {
          method: customer ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' &&
          payload !== null &&
          'error' in payload &&
          typeof payload.error === 'string'
            ? payload.error
            : isRtl ? 'فشل حفظ بيانات العميل.' : 'Failed to save customer.';
        throw new Error(message);
      }
      if (!isCustomerResponse(payload)) {
        throw new Error(isRtl
          ? 'أعاد نظام العملاء استجابة غير صالحة.'
          : 'The customer service returned an invalid response.');
      }

      await onSaved(payload);
      onClose();
    } catch (error) {
      setFormError(error instanceof Error
        ? error.message
        : isRtl ? 'فشل حفظ بيانات العميل.' : 'Failed to save customer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="customer-modal-title" className="text-base font-semibold text-slate-900">
            {customer
              ? (isRtl ? 'تعديل بيانات العميل' : 'Edit Customer')
              : (isRtl ? 'إضافة عميل جديد' : 'Add New Customer')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={isRtl ? 'إغلاق' : 'Close'}
            className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-3.5 overflow-y-auto p-5 text-xs">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-800">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-medium text-slate-700">
                {isRtl ? 'اسم العميل (إنجليزي) *' : 'Customer Name (English) *'}
              </label>
              <input
                type="text"
                required
                autoFocus
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g., Al Rajhi Trading Co."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700">
                {isRtl ? 'اسم العميل (عربي)' : 'Customer Name (Arabic)'}
              </label>
              <input
                type="text"
                dir="rtl"
                value={form.nameAr}
                onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
                placeholder="شركة الراجحي للتجارة"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-1 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-medium text-slate-700">
                {isRtl ? 'الرقم الضريبي (15 رقم، هيئة الزكاة)' : 'VAT / Tax Number (15 digits, ZATCA)'}
              </label>
              <input
                type="text"
                maxLength={15}
                value={form.vatNumber}
                onChange={(event) => setForm({ ...form, vatNumber: event.target.value })}
                placeholder="300000000000003"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700">
                {isRtl ? 'السجل التجاري (10 أرقام)' : 'CR Number (10 digits)'}
              </label>
              <input
                type="text"
                maxLength={10}
                value={form.crNumber}
                onChange={(event) => setForm({ ...form, crNumber: event.target.value })}
                placeholder="1010000000"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'الهاتف' : 'Phone'}</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="+966 50 123 4567"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'البريد الإلكتروني' : 'Email'}</label>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="customer@domain.sa"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-1">
            <div>
              <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'رقم المبنى' : 'Building No'}</label>
              <input
                type="text"
                value={form.buildingNo}
                onChange={(event) => setForm({ ...form, buildingNo: event.target.value })}
                placeholder="2345"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'الشارع' : 'Street'}</label>
              <input
                type="text"
                value={form.streetName}
                onChange={(event) => setForm({ ...form, streetName: event.target.value })}
                placeholder="King Abdulaziz Rd"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'الحي' : 'District'}</label>
              <input
                type="text"
                value={form.district}
                onChange={(event) => setForm({ ...form, district: event.target.value })}
                placeholder="Al Malaz"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'المدينة' : 'City'}</label>
              <input
                type="text"
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
                placeholder="Riyadh"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'الرمز البريدي' : 'Postal Code'}</label>
              <input
                type="text"
                value={form.postalCode}
                onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
                placeholder="12643"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'الدولة' : 'Country'}</label>
              <input
                type="text"
                value={form.country}
                onChange={(event) => setForm({ ...form, country: event.target.value })}
                placeholder="Saudi Arabia"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'العنوان الكامل' : 'Billing / Full Address'}</label>
            <input
              type="text"
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
              placeholder="Street, District, City, KSA"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-slate-700">{isRtl ? 'ملاحظات' : 'Preferences & Notes'}</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder={isRtl ? 'تعليمات خاصة أو شروط ائتمانية' : 'Special instructions or credit terms'}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-4 py-2 font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              {isRtl ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving
                ? (isRtl ? 'جاري الحفظ...' : 'Saving...')
                : customer
                  ? (isRtl ? 'حفظ التغييرات' : 'Save Changes')
                  : (isRtl ? 'إضافة العميل' : 'Create Customer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
