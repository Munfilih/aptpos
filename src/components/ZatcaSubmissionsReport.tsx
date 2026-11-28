import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react';

export interface ZatcaSubmissionRecord {
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

interface ZatcaSubmissionsReportProps {
  isRtl: boolean;
}

type StatusFilter = 'ALL' | 'CLEARED' | 'REPORTED' | 'PENDING' | 'FAILED';

function docTypeLabel(code: '388' | '381' | '383', isRtl: boolean): string {
  if (code === '381') return isRtl ? 'إشعار دائن (381)' : 'Credit Note (381)';
  if (code === '383') return isRtl ? 'إشعار مدين (383)' : 'Debit Note (383)';
  return isRtl ? 'فاتورة (388)' : 'Invoice (388)';
}

function statusBadgeClass(status: ZatcaSubmissionRecord['submissionStatus']): string {
  if (status === 'CLEARED' || status === 'REPORTED') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (status === 'WARNING' || status === 'PENDING') {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  return 'bg-red-50 text-red-700 border-red-200';
}

export const ZatcaSubmissionsReport: React.FC<ZatcaSubmissionsReportProps> = ({ isRtl }) => {
  const [invoices, setInvoices] = useState<ZatcaSubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [resendingAll, setResendingAll] = useState(false);
  const [resendProgress, setResendProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/zatca/invoices?limit=250');
      if (!res.ok) throw new Error('Could not load ZATCA submissions.');
      const data = (await res.json()) as { invoices?: ZatcaSubmissionRecord[] };
      setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ZATCA submissions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  const counts = useMemo(() => {
    let clearedOrReported = 0;
    let pendingOrWarning = 0;
    let failedOrRejected = 0;
    for (const inv of invoices) {
      if (inv.submissionStatus === 'CLEARED' || inv.submissionStatus === 'REPORTED') {
        clearedOrReported += 1;
      } else if (inv.submissionStatus === 'PENDING' || inv.submissionStatus === 'WARNING') {
        pendingOrWarning += 1;
      } else {
        failedOrRejected += 1;
      }
    }
    return {
      total: invoices.length,
      clearedOrReported,
      pendingOrWarning,
      failedOrRejected,
    };
  }, [invoices]);

  const resendableInvoices = useMemo(
    () =>
      invoices.filter(
        (inv) =>
          inv.submissionStatus === 'PENDING' ||
          inv.submissionStatus === 'FAILED' ||
          inv.submissionStatus === 'REJECTED' ||
          inv.submissionStatus === 'WARNING'
      ),
    [invoices]
  );

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter === 'CLEARED' && inv.submissionStatus !== 'CLEARED') return false;
      if (statusFilter === 'REPORTED' && inv.submissionStatus !== 'REPORTED') return false;
      if (
        statusFilter === 'PENDING' &&
        inv.submissionStatus !== 'PENDING' &&
        inv.submissionStatus !== 'WARNING'
      ) {
        return false;
      }
      if (
        statusFilter === 'FAILED' &&
        inv.submissionStatus !== 'FAILED' &&
        inv.submissionStatus !== 'REJECTED'
      ) {
        return false;
      }
      if (q) {
        const hay = `${inv.invoiceNumber} ${inv.icv} ${inv.submissionStatus} ${inv.invoiceTypeCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, search, statusFilter]);

  const handleRetrySingle = async (id: number) => {
    setRetryingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/zatca/invoices/${id}/retry`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Retry failed');
      setNotice(
        isRtl
          ? `تمت إعادة إرسال الفاتورة بنجاح (${data.submissionStatus || 'OK'}).`
          : `Resent invoice: ${data.submissionStatus || 'OK'}`
      );
      await loadSubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend invoice.');
    } finally {
      setRetryingId(null);
    }
  };

  const handleResendAll = async () => {
    const targets = resendableInvoices;
    if (targets.length === 0) {
      setNotice(
        isRtl
          ? 'جميع الفواتير معتمدة أو مبلّغ عنها بالفعل.'
          : 'All invoices are already cleared or reported.'
      );
      return;
    }
    setResendingAll(true);
    setError(null);
    setNotice(null);
    setResendProgress({ done: 0, total: targets.length });
    let succeeded = 0;
    let failed = 0;
    try {
      for (let i = 0; i < targets.length; i += 1) {
        try {
          const res = await fetch(`/api/zatca/invoices/${targets[i].id}/retry`, {
            method: 'POST',
          });
          if (res.ok) succeeded += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
        setResendProgress({ done: i + 1, total: targets.length });
      }
      setNotice(
        isRtl
          ? `اكتملت إعادة الإرسال: ${succeeded} ناجحة${failed > 0 ? `، ${failed} فاشلة` : ''}.`
          : `Resend All complete: ${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ''}.`
      );
      await loadSubmissions();
    } finally {
      setResendingAll(false);
      setResendProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Summary Cards */}
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-medium text-slate-500">
            {isRtl ? 'إجمالي الإرسالات' : 'Total Submissions'}
          </p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
            {counts.total}
          </p>
        </article>
        <article className="rounded-xl border border-emerald-200 bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-medium text-slate-500">
            {isRtl ? 'معتمد / مبلّغ' : 'Cleared / Reported'}
          </p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-700">
            {counts.clearedOrReported}
          </p>
        </article>
        <article className="rounded-xl border border-amber-200 bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-medium text-slate-500">
            {isRtl ? 'معلق / تحذير' : 'Pending / Warning'}
          </p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums text-amber-700">
            {counts.pendingOrWarning}
          </p>
        </article>
        <article className="rounded-xl border border-rose-200 bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-medium text-slate-500">
            {isRtl ? 'فشل / مرفوض' : 'Failed / Rejected'}
          </p>
          <p className="mt-1 font-mono text-xl font-bold tabular-nums text-rose-700">
            {counts.failedOrRejected}
          </p>
        </article>
      </section>

      {/* Toolbar: Filters + Search + Resend All */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'ALL', label: isRtl ? 'الكل' : 'All' },
                { id: 'CLEARED', label: isRtl ? 'معتمد' : 'Cleared' },
                { id: 'REPORTED', label: isRtl ? 'مبلّغ' : 'Reported' },
                { id: 'PENDING', label: isRtl ? 'معلق' : 'Pending' },
                { id: 'FAILED', label: isRtl ? 'فشل / مرفوض' : 'Failed / Rejected' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setStatusFilter(pill.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === pill.id
                    ? 'bg-blue-700 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isRtl ? 'بحث برقم الفاتورة أو ICV...' : 'Search invoice # or ICV...'}
              className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={loading || resendingAll}
              onClick={() => void loadSubmissions()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{isRtl ? 'تحديث' : 'Refresh'}</span>
            </button>
            <button
              type="button"
              disabled={resendingAll || loading || resendableInvoices.length === 0}
              onClick={() => void handleResendAll()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-50"
            >
              {resendingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>
                {resendingAll && resendProgress
                  ? isRtl
                    ? `جارٍ الإرسال (${resendProgress.done}/${resendProgress.total})...`
                    : `Resending (${resendProgress.done}/${resendProgress.total})...`
                  : isRtl
                    ? `إعادة إرسال الكل (${resendableInvoices.length})`
                    : `Resend All (${resendableInvoices.length})`}
              </span>
            </button>
          </div>
        </div>

        {notice && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{isRtl ? 'جارٍ تحميل إرسالات فاتورة...' : 'Loading ZATCA submissions...'}</span>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">
            {isRtl
              ? 'لا توجد فواتير مطابقة لخيارات التصفية.'
              : 'No ZATCA submissions found matching the selected filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                  <th className="px-3 py-2 text-start">ICV</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'رقم المستند' : 'Number'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'النوع' : 'Type'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'التصنيف' : 'Flow'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2 text-start">{isRtl ? 'التاريخ' : 'Date'}</th>
                  <th className="px-3 py-2 text-end">{isRtl ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map((inv) => {
                  const firstError = inv.errors?.[0]?.message || inv.warnings?.[0]?.message;
                  const canResend =
                    inv.submissionStatus === 'PENDING' ||
                    inv.submissionStatus === 'FAILED' ||
                    inv.submissionStatus === 'REJECTED' ||
                    inv.submissionStatus === 'WARNING';
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2.5 font-mono font-semibold text-slate-600">
                        #{inv.icv}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-mono font-bold text-slate-900">{inv.invoiceNumber}</div>
                        {firstError && (
                          <div className="mt-0.5 max-w-xs truncate text-[10px] text-rose-600" title={firstError}>
                            {firstError}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {docTypeLabel(inv.invoiceTypeCode, isRtl)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          {inv.invoiceSubtype === '0100000' ? 'B2B' : 'B2C'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(
                            inv.submissionStatus
                          )}`}
                        >
                          {inv.submissionStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">
                        {new Date(inv.submittedAt || inv.createdAt).toLocaleString(
                          isRtl ? 'ar-SA' : 'en-GB',
                          { dateStyle: 'short', timeStyle: 'short' }
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-end">
                        <div className="inline-flex items-center gap-1.5">
                          {canResend && (
                            <button
                              type="button"
                              disabled={resendingAll || retryingId !== null}
                              onClick={() => void handleRetrySingle(inv.id)}
                              className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              {retryingId === inv.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                              <span>{isRtl ? 'إعادة إرسال' : 'Resend'}</span>
                            </button>
                          )}
                          <a
                            href={`/api/zatca/invoices/${inv.id}/xml`}
                            download
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="h-3 w-3" />
                            <span>XML</span>
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
