import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Send,
} from 'lucide-react';

interface ZatcaStatusSummary {
  configured: boolean;
  egsUuid: string | null;
  environment: 'sandbox' | 'simulation' | 'production';
  businessCategory: string;
  hasComplianceCsid: boolean;
  complianceChecksPassed: boolean;
  hasProductionCsid: boolean;
  certificateExpiresAt: string | null;
  lastIcv: number;
  onboardedAt: string | null;
  counts: {
    total: number;
    cleared: number;
    reported: number;
    warning: number;
    pending: number;
    rejected: number;
    failed: number;
  };
}

interface ComplianceCheckItem {
  label: string;
  ok: boolean;
  status: string;
  warnings: Array<{ message?: string; code?: string }>;
  errors: Array<{ message?: string; code?: string }>;
}

interface ZatcaInvoiceItem {
  id: number;
  documentType: 'SALE' | 'SALES_RETURN' | 'DEBIT_NOTE';
  invoiceNumber: string;
  invoiceTypeCode: '388' | '381' | '383';
  invoiceSubtype: '0100000' | '0200000';
  icv: number;
  submissionStatus: 'PENDING' | 'REPORTED' | 'CLEARED' | 'WARNING' | 'REJECTED' | 'FAILED';
  warnings: Array<{ message?: string; code?: string }>;
  errors: Array<{ message?: string; code?: string }>;
  retryCount: number;
  submittedAt: string | null;
  createdAt: string;
}

interface ZatcaPhase2PanelProps {
  isRtl: boolean;
  onStatusChange?: (phase2Active: boolean) => void;
}

export const ZatcaPhase2Panel: React.FC<ZatcaPhase2PanelProps> = ({ isRtl, onStatusChange }) => {
  const [status, setStatus] = useState<ZatcaStatusSummary | null>(null);
  const [invoices, setInvoices] = useState<ZatcaInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [environment, setEnvironment] = useState<'sandbox' | 'simulation' | 'production'>('sandbox');
  const [businessCategory, setBusinessCategory] = useState('Retail');
  const [otp, setOtp] = useState('');
  const [complianceResults, setComplianceResults] = useState<ComplianceCheckItem[] | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [statusRes, invoicesRes] = await Promise.all([
        fetch('/api/zatca/status'),
        fetch('/api/zatca/invoices?limit=25'),
      ]);
      if (statusRes.ok) {
        const s = (await statusRes.json()) as ZatcaStatusSummary;
        setStatus(s);
        onStatusChange?.(Boolean(s.hasProductionCsid));
        setEnvironment(s.environment);
        if (s.businessCategory) setBusinessCategory(s.businessCategory);
      }
      if (invoicesRes.ok) {
        const inv = (await invoicesRes.json()) as { invoices: ZatcaInvoiceItem[] };
        setInvoices(inv.invoices || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ZATCA status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOnboardCompliance = async () => {
    setBusyAction('compliance');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/zatca/onboard/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment, otp: otp.trim(), businessCategory: businessCategory.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Compliance onboarding failed.');
      setOtp('');
      setNotice(
        isRtl
          ? 'تم إصدار شهادة الامتثال (Compliance CSID) بنجاح. انتقل للخطوة 2.'
          : 'Compliance CSID issued successfully. Proceed to Step 2.'
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compliance onboarding failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunComplianceChecks = async () => {
    setBusyAction('checks');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/zatca/onboard/compliance-checks', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Compliance checks failed.');
      setComplianceResults(data.results || []);
      if (data.allPassed) {
        setNotice(
          isRtl
            ? 'اجتازت جميع فحوصات الامتثال الـ 6 بنجاح! يمكنك الآن تفعيل شهادة الإنتاج.'
            : 'All 6 ZATCA compliance checks passed! You can now activate Production CSID.'
        );
      } else {
        setError(
          isRtl
            ? 'فشل بعض فحوصات الامتثال. راجع التفاصيل أدناه.'
            : 'Some compliance checks failed. Review the details below.'
        );
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compliance checks failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleActivateProduction = async () => {
    setBusyAction('production');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/zatca/onboard/production', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Production CSID activation failed.');
      setNotice(
        isRtl
          ? 'تم تفعيل شهادة الإنتاج (Production CSID) بنجاح! المرحلة 2 نشطة الآن.'
          : 'Production CSID activated! ZATCA Phase 2 is now live on this terminal.'
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Production CSID activation failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleFlushQueue = async () => {
    setBusyAction('flush');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/zatca/queue/flush', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to flush queue.');
      setNotice(
        isRtl
          ? `تمت معالجة ${data.processed} فاتورة معلقة.`
          : `Processed ${data.processed} pending invoice(s).`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to flush queue.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRetryInvoice = async (id: number) => {
    setBusyAction(`retry-${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/zatca/invoices/${id}/retry`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retry failed.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const statusBadgeClass = (s: ZatcaInvoiceItem['submissionStatus']) => {
    if (s === 'CLEARED' || s === 'REPORTED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'WARNING' || s === 'PENDING') return 'bg-amber-50 text-amber-800 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
  };

  const docTypeLabel = (code: ZatcaInvoiceItem['invoiceTypeCode']) => {
    if (code === '381') return isRtl ? 'إشعار دائن (381)' : 'Credit Note (381)';
    if (code === '383') return isRtl ? 'إشعار مدين (383)' : 'Debit Note (383)';
    return isRtl ? 'فاتورة (388)' : 'Invoice (388)';
  };

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {isRtl ? 'جاري تحميل حالة ZATCA المرحلة 2...' : 'Loading ZATCA Phase 2 status...'}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* Live Status Summary */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-700" />
            <h3 className="text-sm font-bold text-slate-900">
              {isRtl ? 'الربط المباشر مع فاتورة (المرحلة 2)' : 'Direct Fatoora Integration (Phase 2)'}
            </h3>
          </div>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
              status?.hasProductionCsid
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : status?.hasComplianceCsid
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-slate-100 text-slate-600'
            }`}
          >
            {status?.hasProductionCsid
              ? isRtl
                ? 'شهادة الإنتاج نشطة'
                : 'Production CSID Active'
              : status?.hasComplianceCsid
                ? isRtl
                  ? 'شهادة الامتثال جاهزة'
                  : 'Compliance CSID Ready'
                : isRtl
                  ? 'غير مربوط بعد'
                  : 'Not Onboarded'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-500">
              {isRtl ? 'البيئة' : 'Environment'}
            </div>
            <div className="mt-0.5 font-bold capitalize text-slate-900">
              {status?.environment || environment}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-500">
              {isRtl ? 'آخر عداد ICV' : 'Last ICV Counter'}
            </div>
            <div className="mt-0.5 font-mono font-bold text-slate-900">{status?.lastIcv ?? 0}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-500">
              {isRtl ? 'تم الإرسال / الاعتماد' : 'Cleared / Reported'}
            </div>
            <div className="mt-0.5 font-mono font-bold text-emerald-700">
              {(status?.counts.cleared || 0) + (status?.counts.reported || 0)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-500">
              {isRtl ? 'معلق / مرفوض' : 'Pending / Rejected'}
            </div>
            <div className="mt-0.5 font-mono font-bold text-amber-700">
              {(status?.counts.pending || 0) + (status?.counts.failed || 0)} /{' '}
              <span className="text-red-600">{status?.counts.rejected || 0}</span>
            </div>
          </div>
        </div>

        {status?.egsUuid && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              EGS UUID: <code className="font-mono text-slate-700">{status.egsUuid}</code>
            </span>
            {status.certificateExpiresAt && (
              <span>
                {isRtl ? 'انتهاء الشهادة:' : 'Cert Expires:'}{' '}
                <strong className="text-slate-700">
                  {new Date(status.certificateExpiresAt).toLocaleDateString()}
                </strong>
              </span>
            )}
          </div>
        )}
      </section>

      {/* 3-Step Onboarding Wizard */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-4">
        <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-slate-900">
          {isRtl ? 'خطوات الربط مع منصة فاتورة (ZATCA)' : 'Fatoora Direct Onboarding (3 Steps)'}
        </h3>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Step 1 */}
        <div className="rounded-lg border border-slate-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">
              {isRtl ? '1. توليد CSR وإصدار شهادة الامتثال (Compliance CSID)' : '1. Generate CSR & Get Compliance CSID'}
            </span>
            {status?.hasComplianceCsid && (
              <span className="text-[11px] font-semibold text-emerald-700">✓ {isRtl ? 'مكتمل' : 'Done'}</span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <label className="block">
              <span className="block text-[11px] font-medium text-slate-600 mb-1">
                {isRtl ? 'بيئة فاتورة' : 'Fatoora Environment'}
              </span>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'simulation' | 'production')}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
              >
                <option value="sandbox">Sandbox (Developer)</option>
                <option value="simulation">Simulation (Pre-Prod)</option>
                <option value="production">Production (Live)</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-medium text-slate-600 mb-1">
                {isRtl ? 'تصنيف النشاط' : 'Business Category'}
              </span>
              <input
                type="text"
                value={businessCategory}
                onChange={(e) => setBusinessCategory(e.target.value)}
                placeholder="Retail"
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-medium text-slate-600 mb-1">
                {isRtl ? 'رمز OTP من فاتورة (6 أرقام)' : 'Fatoora OTP (6 digits)'}
              </span>
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busyAction !== null || otp.length !== 6}
            onClick={() => void handleOnboardCompliance()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busyAction === 'compliance' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {isRtl ? 'توليد CSR وإصدار Compliance CSID' : 'Generate CSR & Request Compliance CSID'}
          </button>
        </div>

        {/* Step 2 */}
        <div className="rounded-lg border border-slate-200 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-900">
                {isRtl ? '2. تشغيل فحوصات الامتثال الـ 6 (B2B و B2C)' : '2. Run 6 ZATCA Compliance Checks (B2B & B2C)'}
              </div>
              <div className="text-[11px] text-slate-500">
                {isRtl
                  ? 'يختبر تلقائياً الفواتير والإشعارات الدائنة والمدينة (B2B و B2C) أمام هيئة الزكاة.'
                  : 'Automatically tests B2B & B2C Invoice (388), Credit Note (381), and Debit Note (383).'}
              </div>
            </div>
            <button
              type="button"
              disabled={busyAction !== null || !status?.hasComplianceCsid}
              onClick={() => void handleRunComplianceChecks()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {busyAction === 'checks' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isRtl ? 'تشغيل الفحوصات' : 'Run 6 Checks'}
            </button>
          </div>
          {complianceResults && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {complianceResults.map((item) => (
                <div
                  key={item.label}
                  className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px] ${
                    item.ok
                      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                      : 'border-red-200 bg-red-50/70 text-red-800'
                  }`}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="font-bold">{item.ok ? 'PASS' : item.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step 3 */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
          <div>
            <div className="text-xs font-bold text-slate-900">
              {isRtl ? '3. تفعيل شهادة الإنتاج (Production CSID)' : '3. Activate Production CSID'}
            </div>
            <div className="text-[11px] text-slate-500">
              {isRtl
                ? 'بعد اجتياز فحوصات الامتثال، قم بترقية الشهادة لبدء الربط الفعلي للفواتير.'
                : 'Upgrade your Compliance CSID to a live Production CSID for real-time B2B clearance & B2C reporting.'}
            </div>
          </div>
          <button
            type="button"
            disabled={busyAction !== null || !status?.hasComplianceCsid}
            onClick={() => void handleActivateProduction()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {busyAction === 'production' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isRtl ? 'تفعيل Production CSID' : 'Activate Production CSID'}
          </button>
        </div>
      </section>
    </div>
  );
};
