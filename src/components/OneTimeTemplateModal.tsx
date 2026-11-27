import React, { useState } from 'react';
import { Eye, Loader2, Printer, RotateCcw, SlidersHorizontal, Upload, X } from 'lucide-react';
import type { PaperWidth, PrintDocumentProfile, StoreSettings } from '../types/pos';
import type { PrintDocumentType, PrintTemplateJob } from '../printTemplates/types';
import {
  getPrintDocumentFormat,
  getPrintFormats,
  getPrintTemplates,
} from '../printTemplates/catalog';
import { printTemplateJob } from '../printTemplates/render';
import { resolveInvoiceMarginsMm } from '../utils/thermalPrinting';
import { useLanguage } from '../i18n/LanguageContext';
import { PrintPreviewFrame } from './PrintPreviewFrame';

export type OneTimeSaleDocument = Extract<
  PrintDocumentType,
  'sales-invoice' | 'sales-return' | 'cash-receipt' | 'bank-receipt' | 'kot' | 'shift-report'
>;

export interface OneTimeDocumentOverride {
  format: PaperWidth;
  profile: PrintDocumentProfile;
}

interface OneTimeTemplateModalProps {
  settings: StoreSettings;
  defaultFormatFallback?: PaperWidth;
  documents: Array<{ id: OneTimeSaleDocument; label: string }>;
  initialDocument: OneTimeSaleDocument;
  overrides: Partial<Record<OneTimeSaleDocument, OneTimeDocumentOverride>>;
  onBuildPreviewJob: (
    docType: OneTimeSaleDocument,
    override: OneTimeDocumentOverride
  ) => Promise<PrintTemplateJob>;
  onApply: (nextOverrides: Partial<Record<OneTimeSaleDocument, OneTimeDocumentOverride>>) => void;
  onClose: () => void;
}

const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_SIZE = 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the selected logo file.'));
    };
    reader.onerror = () => reject(new Error('Could not read the selected logo file.'));
    reader.readAsDataURL(file);
  });
}

export const OneTimeTemplateModal: React.FC<OneTimeTemplateModalProps> = ({
  settings,
  defaultFormatFallback = 'A4',
  documents,
  initialDocument,
  overrides,
  onBuildPreviewJob,
  onApply,
  onClose,
}) => {
  const { isRtl } = useLanguage();
  const text = (en: string, ar: string) => (isRtl ? ar : en);

  const [activeDoc, setActiveDoc] = useState<OneTimeSaleDocument>(initialDocument);
  const [draftOverrides, setDraftOverrides] = useState<
    Partial<Record<OneTimeSaleDocument, OneTimeDocumentOverride>>
  >(() => ({ ...overrides }));
  const [marginDrafts, setMarginDrafts] = useState<Record<string, string>>({});
  const [logoError, setLogoError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewJob, setPreviewJob] = useState<PrintTemplateJob | null>(null);
  const [previewPageCount, setPreviewPageCount] = useState(1);

  const defaultFormat = getPrintDocumentFormat(settings, activeDoc, defaultFormatFallback);
  const activeOverride = draftOverrides[activeDoc];
  const activeFormat: PaperWidth = activeOverride?.format ?? defaultFormat;
  const supportedFormats = getPrintFormats(activeDoc);
  const templates = getPrintTemplates(activeDoc, activeFormat);

  const savedProfile = settings.printDocumentProfiles?.[activeDoc]?.[activeFormat];
  const currentProfile: PrintDocumentProfile = activeOverride?.profile ?? {
    templateId: savedProfile?.templateId || templates[0]?.id || '',
    ...savedProfile,
  };

  const selectedTemplateId = templates.some((t) => t.id === currentProfile.templateId)
    ? currentProfile.templateId
    : (templates[0]?.id || '');

  const resolvedMargins = resolveInvoiceMarginsMm(
    activeFormat,
    currentProfile.marginsMm ?? settings.invoiceMarginsMm
  );
  const logoEnabled = currentProfile.enableLogo !== undefined
    ? currentProfile.enableLogo
    : settings.invoiceShowStoreLogo !== false;
  const logoPreviewUrl = currentProfile.logoDataUrl || settings.storeLogoDataUrl;
  const englishEnabled = currentProfile.enableEnglish !== false;
  const arabicEnabled = currentProfile.enableArabic !== false;
  const footerEn = currentProfile.footer ?? '';
  const footerAr = currentProfile.footerAr ?? '';

  const updateCurrentOverride = (
    nextFormat: PaperWidth,
    patch: Partial<PrintDocumentProfile>
  ) => {
    const nextTemplates = getPrintTemplates(activeDoc, nextFormat);
    const baseProfile =
      nextFormat === activeFormat
        ? currentProfile
        : (settings.printDocumentProfiles?.[activeDoc]?.[nextFormat] ?? {
            templateId: nextTemplates[0]?.id || '',
          });
    const nextTemplateId =
      patch.templateId && nextTemplates.some((t) => t.id === patch.templateId)
        ? patch.templateId
        : nextTemplates.some((t) => t.id === baseProfile.templateId)
          ? baseProfile.templateId
          : (nextTemplates[0]?.id || '');

    setDraftOverrides((prev) => ({
      ...prev,
      [activeDoc]: {
        format: nextFormat,
        profile: {
          ...baseProfile,
          ...patch,
          templateId: nextTemplateId,
        },
      },
    }));
  };

  const handleResetActiveDoc = () => {
    setDraftOverrides((prev) => {
      const next = { ...prev };
      delete next[activeDoc];
      return next;
    });
    setMarginDrafts({});
    setLogoError(null);
  };

  const handleLogoPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!LOGO_MIME_TYPES.has(file.type)) {
      setLogoError(text('Choose a PNG, JPEG, or WebP image.', 'اختر صورة بصيغة PNG أو JPEG أو WebP.'));
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setLogoError(text('The image must be 1 MB or smaller.', 'يجب ألا يتجاوز حجم الصورة 1 ميجابايت.'));
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setLogoError(null);
      updateCurrentOverride(activeFormat, { logoDataUrl: dataUrl, enableLogo: true });
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : text('Could not read image.', 'تعذرت قراءة الصورة.'));
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const effectiveOverride: OneTimeDocumentOverride = {
        format: activeFormat,
        profile: {
          ...currentProfile,
          templateId: selectedTemplateId,
          marginsMm: resolvedMargins,
        },
      };
      const job = await onBuildPreviewJob(activeDoc, effectiveOverride);
      setPreviewJob(job);
    } catch (err) {
      setPreviewError(
        err instanceof Error
          ? err.message
          : text('Could not generate preview.', 'تعذر إنشاء المعاينة.')
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-xs sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="one-time-template-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-emerald-50/50 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-white text-emerald-700 shadow-xs">
              <SlidersHorizontal className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <h2
                id="one-time-template-modal-title"
                className="truncate text-base font-bold text-slate-900"
              >
                {text('Choose Templates', 'اختيار القوالب')}
              </h2>
              <p className="text-[11px] text-slate-500">
                {text(
                  'Loaded with default settings. Changes apply to this print only.',
                  'محمّل بالإعدادات الافتراضية. تُطبّق التغييرات على هذه الطباعة فقط.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={text('Close', 'إغلاق')}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white hover:text-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {documents.length > 1 && (
            <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {documents.map((doc) => {
                const isActive = doc.id === activeDoc;
                const hasOverride = Boolean(draftOverrides[doc.id]);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => {
                      setActiveDoc(doc.id);
                      setLogoError(null);
                    }}
                    className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-slate-700 hover:bg-white'
                    }`}
                  >
                    <span>{doc.label}</span>
                    {hasOverride && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isActive ? 'bg-emerald-200' : 'bg-emerald-600'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Template & Paper Type */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
              <label className="block text-xs font-semibold text-slate-900">
                {text('Template', 'القالب')}
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => updateCurrentOverride(activeFormat, { templateId: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-emerald-600"
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
              <label className="block text-xs font-semibold text-slate-900">
                {text('Paper Type', 'نوع الورق')}
              </label>
              <select
                value={activeFormat}
                onChange={(e) => {
                  const nextFormat = e.target.value as PaperWidth;
                  updateCurrentOverride(nextFormat, {});
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
                    {text('Width (mm)', 'العرض (مم)')}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(currentProfile.customWidthMm ?? 210)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!/^\d*\.?\d*$/.test(raw)) return;
                        const parsed = Number(raw);
                        if (raw !== '' && Number.isFinite(parsed)) {
                          updateCurrentOverride(activeFormat, {
                            customWidthMm: Math.min(420, Math.max(48, parsed)),
                          });
                        }
                      }}
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-xs text-slate-900 outline-none focus:border-emerald-600"
                    />
                  </label>
                  <label className="block text-[11px] font-medium text-slate-600">
                    {text('Height (mm)', 'الارتفاع (مم)')}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(currentProfile.customHeightMm ?? 297)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!/^\d*\.?\d*$/.test(raw)) return;
                        const parsed = Number(raw);
                        if (raw !== '' && Number.isFinite(parsed)) {
                          updateCurrentOverride(activeFormat, {
                            customHeightMm: Math.min(594, Math.max(60, parsed)),
                          });
                        }
                      }}
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-xs text-slate-900 outline-none focus:border-emerald-600"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Margins */}
          <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
            <span className="block text-xs font-semibold text-slate-900">
              {text('Margins (mm)', 'الهوامش (مم)')}
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                { key: 'top' as const, label: text('Top', 'أعلى') },
                { key: 'right' as const, label: text('Right', 'يمين') },
                { key: 'bottom' as const, label: text('Bottom', 'أسفل') },
                { key: 'left' as const, label: text('Left', 'يسار') },
              ]).map((side) => {
                const draftKey = `${activeDoc}:${activeFormat}:${side.key}`;
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
                        updateCurrentOverride(activeFormat, {
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
                          updateCurrentOverride(activeFormat, {
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

          {/* Enable Logo & Choose Logo / Print Languages */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="one-time-enable-logo"
                  className="cursor-pointer text-xs font-semibold text-slate-900"
                >
                  {text('Enable Logo', 'تفعيل الشعار')}
                </label>
                <input
                  id="one-time-enable-logo"
                  type="checkbox"
                  checked={logoEnabled}
                  onChange={(e) => updateCurrentOverride(activeFormat, { enableLogo: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{text('Choose Logo', 'اختيار الشعار')}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => void handleLogoPick(e)}
                  />
                </label>
                {currentProfile.logoDataUrl && (
                  <button
                    type="button"
                    onClick={() => updateCurrentOverride(activeFormat, { logoDataUrl: undefined })}
                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    {text('Remove', 'إزالة')}
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
              {logoError && (
                <p className="text-[11px] font-medium text-red-600">{logoError}</p>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
              <span className="block text-xs font-semibold text-slate-900">
                {text('Print Languages', 'لغة الطباعة')}
              </span>
              <div className="space-y-2">
                <label
                  htmlFor="one-time-enable-english"
                  className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-slate-700"
                >
                  <span>{text('Enable English', 'تفعيل الإنجليزية')}</span>
                  <input
                    id="one-time-enable-english"
                    type="checkbox"
                    checked={englishEnabled}
                    onChange={(e) => {
                      const nextEnglish = e.target.checked;
                      updateCurrentOverride(activeFormat, {
                        enableEnglish: nextEnglish,
                        ...(!nextEnglish && !arabicEnabled ? { enableArabic: true } : {}),
                      });
                    }}
                    className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                  />
                </label>
                <label
                  htmlFor="one-time-enable-arabic"
                  className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-slate-700"
                >
                  <span>{text('Enable Arabic', 'تفعيل العربية')}</span>
                  <input
                    id="one-time-enable-arabic"
                    type="checkbox"
                    checked={arabicEnabled}
                    onChange={(e) => {
                      const nextArabic = e.target.checked;
                      updateCurrentOverride(activeFormat, {
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
              {text('Invoice Footer', 'تذييل الفاتورة')}
            </span>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <input
                type="text"
                value={footerEn}
                onChange={(e) => updateCurrentOverride(activeFormat, { footer: e.target.value })}
                placeholder={text('Footer text (English)...', 'تذييل بالإنجليزية...')}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-emerald-600"
              />
              <input
                type="text"
                dir="rtl"
                value={footerAr}
                onChange={(e) => updateCurrentOverride(activeFormat, { footerAr: e.target.value })}
                placeholder={text('Footer text (Arabic)...', 'تذييل بالعربية...')}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetActiveDoc}
              disabled={!activeOverride || previewLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {text('Reset to Default', 'استعادة الافتراضي')}
            </button>
            <button
              type="button"
              disabled={previewLoading || !selectedTemplateId}
              onClick={() => void handlePreview()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              {previewLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              <span>{text('Preview', 'معاينة')}</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {text('Cancel', 'إلغاء')}
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(draftOverrides);
                onClose();
              }}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              {text('Apply for This Print', 'تطبيق لهذه الطباعة')}
            </button>
          </div>
          {previewError && (
            <p role="alert" className="w-full text-xs font-medium text-red-600">
              {previewError}
            </p>
          )}
        </footer>
      </div>

      {previewJob && (
        <div
          className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreviewJob(null);
          }}
        >
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-emerald-50/50 px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-bold text-slate-900">
                  {text('Print Preview', 'معاينة الطباعة')} · {previewJob.template.label} ({activeFormat})
                  {previewPageCount > 1 && (
                    <span className="ms-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                      {previewPageCount} {text('pages', 'صفحات')}
                    </span>
                  )}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void printTemplateJob({ ...previewJob, silent: false })}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>{text('Print', 'طباعة')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewJob(null)}
                  aria-label={text('Close preview', 'إغلاق المعاينة')}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-200/80 p-5">
              <div className="mx-auto flex justify-center">
                <PrintPreviewFrame
                  job={previewJob}
                  title={text('Print Preview', 'معاينة الطباعة')}
                  onPageCountChange={setPreviewPageCount}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
