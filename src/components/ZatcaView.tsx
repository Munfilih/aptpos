import React, { useEffect, useState } from 'react';
import { Check, QrCode, Save, ShieldCheck } from 'lucide-react';
import type { StoreSettings } from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { ZatcaPhase2Panel } from './ZatcaPhase2Panel';

interface ZatcaViewProps {
  settings: StoreSettings;
  canEdit?: boolean;
  onSaveSettings: (updated: StoreSettings) => Promise<void>;
  onOpenBusinessSettings?: () => void;
}

export const ZatcaView: React.FC<ZatcaViewProps> = ({
  settings,
  canEdit = true,
  onSaveSettings,
  onOpenBusinessSettings,
}) => {
  const { isRtl } = useLanguage();
  const [form, setForm] = useState<StoreSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zatcaPhase2Active, setZatcaPhase2Active] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    let active = true;
    void fetch('/api/zatca/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { hasProductionCsid?: boolean } | null) => {
        if (active && data) setZatcaPhase2Active(Boolean(data.hasProductionCsid));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const isDirty =
    (form.zatcaPhase || '1') !== (settings.zatcaPhase || '1') ||
    Boolean(form.enableZatcaEinvoice) !== Boolean(settings.enableZatcaEinvoice) ||
    (form.invoiceShowQrCode !== false) !== (settings.invoiceShowQrCode !== false) ||
    (form.invoiceQrCodeSizeMm ?? 25) !== (settings.invoiceQrCodeSizeMm ?? 25);

  const handleSave = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    try {
      await onSaveSettings(form);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save E-Invoice settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      {/* Top Action Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
              zatcaPhase2Active
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-600'
            }`}
          >
            <QrCode className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900">
                {isRtl ? 'الفوترة الإلكترونية (ZATCA)' : 'E-Invoicing (ZATCA)'}
              </h1>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  zatcaPhase2Active
                    ? 'bg-emerald-100 text-emerald-800'
                    : form.enableZatcaEinvoice
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                <ShieldCheck className="h-3 w-3" />
                {zatcaPhase2Active
                  ? isRtl ? 'المرحلة 2 مفعّلة' : 'Phase 2 Active'
                  : form.enableZatcaEinvoice
                    ? isRtl ? 'المرحلة 1 مفعّلة' : 'Phase 1 Active'
                    : isRtl ? 'غير مفعّل' : 'Not Activated'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {isRtl
                ? 'إعدادات الامتثال لهيئة الزكاة والضريبة والجمارك والربط المباشر مع فاتورة.'
                : 'ZATCA compliance, QR settings, and direct Fatoora Phase 2 integration.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              {isRtl ? 'تم الحفظ' : 'Saved'}
            </span>
          )}
          {canEdit && (
            <button
              type="button"
              disabled={saving || !isDirty}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? (isRtl ? 'جارٍ الحفظ...' : 'Saving...') : (isRtl ? 'حفظ التغييرات' : 'Save Changes')}</span>
            </button>
          )}
        </div>
      </header>

      {/* Scrollable Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {!canEdit && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {isRtl
                ? 'لديك صلاحية عرض فقط لإعدادات الفوترة الإلكترونية.'
                : 'You have view-only access to E-Invoicing settings.'}
            </div>
          )}

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
              {onOpenBusinessSettings && (
                <button
                  type="button"
                  onClick={onOpenBusinessSettings}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {isRtl ? 'تعديل بيانات المنشأة' : 'Edit Business Profile'}
                </button>
              )}
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
                disabled={!canEdit}
                onClick={() => setForm((cur) => ({ ...cur, zatcaPhase: '1' }))}
                className={`flex flex-col items-start rounded-xl border p-3.5 text-start transition-colors disabled:opacity-60 ${
                  (form.zatcaPhase || '1') === '1'
                    ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-500'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-900">
                    {isRtl ? 'المرحلة 1 — الإصدار' : 'Phase 1 — Generation'}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      (form.zatcaPhase || '1') === '1'
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {(form.zatcaPhase || '1') === '1'
                      ? isRtl ? 'نشط' : 'Active'
                      : isRtl ? 'اختر' : 'Select'}
                  </span>
                </div>
                <span className="mt-1 text-[11px] text-slate-600">
                  {isRtl
                    ? 'إصدار الفواتير الإلكترونية وحفظها مع رمز QR (TLV).'
                    : 'Generate and store compliant e-invoices with TLV QR code.'}
                </span>
              </button>

              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setForm((cur) => ({ ...cur, zatcaPhase: '2' }))}
                className={`flex flex-col items-start rounded-xl border p-3.5 text-start transition-colors disabled:opacity-60 ${
                  form.zatcaPhase === '2'
                    ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-500'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    {isRtl ? 'المرحلة 2 — الربط والتكامل' : 'Phase 2 — Integration'}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      form.zatcaPhase === '2'
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {form.zatcaPhase === '2'
                      ? isRtl ? 'نشط' : 'Active'
                      : isRtl ? 'تفعيل' : 'Enable'}
                  </span>
                </div>
                <span className="mt-1 text-[11px] text-slate-600">
                  {isRtl
                    ? 'الربط المباشر مع فاتورة (B2B اعتماد فوري، B2C إبلاغ، إشعار دائن ومدين).'
                    : 'Direct Fatoora integration (B2B real-time clearance, B2C reporting, Credit & Debit notes).'}
                </span>
              </button>
            </div>
          </section>

          {form.zatcaPhase === '2' && (
            <div className={canEdit ? undefined : 'pointer-events-none opacity-75'}>
              <ZatcaPhase2Panel isRtl={isRtl} onStatusChange={setZatcaPhase2Active} />
            </div>
          )}

          {/* E-Invoice Settings */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-4">
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">
              {isRtl ? 'إعدادات الفوترة الإلكترونية' : 'E-Invoice Settings'}
            </h3>

            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="block text-sm font-semibold text-slate-800">
                  {isRtl ? 'تفعيل الفوترة الإلكترونية' : 'Enable E-Invoice'}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {isRtl
                    ? 'عند التفعيل، لا يمكن لأي مستخدم (حتى مدير الشركة) حذف فواتير المبيعات أو مرتجعات المبيعات.'
                    : 'When enabled, Sales and Sales Return vouchers cannot be deleted by any user (including company admin).'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.enableZatcaEinvoice === true}
                aria-label={isRtl ? 'تفعيل الفوترة الإلكترونية' : 'Enable E-Invoice'}
                disabled={!canEdit}
                onClick={() =>
                  setForm((cur) => ({ ...cur, enableZatcaEinvoice: !(cur.enableZatcaEinvoice === true) }))
                }
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  form.enableZatcaEinvoice === true ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    form.enableZatcaEinvoice === true
                      ? isRtl ? '-translate-x-5' : 'translate-x-5'
                      : isRtl ? '-translate-x-0.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
              <div>
                <span className="block text-sm font-semibold text-slate-800">
                  {isRtl ? 'تفعيل رمز QR في الفواتير' : 'Enable QR Code in Invoices'}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {isRtl
                    ? 'عرض رمز الاستجابة السريعة ZATCA QR على الفواتير المطبوعة.'
                    : 'Show the ZATCA QR code on printed sales invoices.'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.invoiceShowQrCode !== false}
                aria-label={isRtl ? 'تفعيل رمز QR في الفواتير' : 'Enable QR Code in Invoices'}
                disabled={!canEdit}
                onClick={() =>
                  setForm((cur) => ({ ...cur, invoiceShowQrCode: !(cur.invoiceShowQrCode !== false) }))
                }
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  form.invoiceShowQrCode !== false ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    form.invoiceShowQrCode !== false
                      ? isRtl ? '-translate-x-5' : 'translate-x-5'
                      : isRtl ? '-translate-x-0.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

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
                  disabled={!canEdit}
                  value={form.invoiceQrCodeSizeMm ?? 25}
                  onChange={(e) =>
                    setForm((cur) => ({ ...cur, invoiceQrCodeSizeMm: Number(e.target.value) }))
                  }
                  className="flex-1 accent-emerald-700"
                />
                <input
                  type="number"
                  min={15}
                  max={50}
                  disabled={!canEdit}
                  value={form.invoiceQrCodeSizeMm ?? 25}
                  onChange={(e) => {
                    const num = Math.max(15, Math.min(50, Number(e.target.value) || 25));
                    setForm((cur) => ({ ...cur, invoiceQrCodeSizeMm: num }));
                  }}
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center font-mono text-xs"
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
