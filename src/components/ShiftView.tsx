import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Clock3, Eye, FileText, KeyRound, LockKeyhole, Printer, UnlockKeyhole, Wallet, X } from 'lucide-react';
import type {
  CashierShift,
  CashierShiftReport,
  PaperWidth,
  ShiftBankAccountSummary,
  ShiftPaymentSummary,
  StoreSettings,
  ThemeMode,
  UserSession,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import {
  applyThermalPageSize,
  measureThermalPageSize,
  printWithThermalPageSize,
  resolveInvoiceMarginsMm,
} from '../utils/thermalPrinting';

interface ShiftViewProps {
  currentUser: UserSession;
  settings: StoreSettings;
  theme: ThemeMode;
}

interface ShiftOverview {
  active: CashierShift | null;
  history: CashierShift[];
}

function isCashierShift(value: unknown): value is CashierShift {
  if (!value || typeof value !== 'object') return false;
  const shift = value as Record<string, unknown>;
  return (
    typeof shift.id === 'number' &&
    typeof shift.cashierUsername === 'string' &&
    typeof shift.cashierName === 'string' &&
    typeof shift.openedAt === 'string' &&
    typeof shift.openingCash === 'number' &&
    (shift.closedAt === null || typeof shift.closedAt === 'string') &&
    (shift.closingCash === null || typeof shift.closingCash === 'number')
  );
}

function isShiftPaymentSummary(value: unknown): value is ShiftPaymentSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<string, unknown>;
  return (
    typeof summary.paymentMethod === 'string' &&
    typeof summary.count === 'number' &&
    typeof summary.amount === 'number'
  );
}

function isShiftBankAccountSummary(value: unknown): value is ShiftBankAccountSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Record<string, unknown>;
  return (
    typeof summary.accountName === 'string' &&
    typeof summary.count === 'number' &&
    typeof summary.moneyIn === 'number' &&
    typeof summary.moneyOut === 'number'
  );
}

function isCashierShiftReport(value: unknown): value is CashierShiftReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  if (
    typeof report.shiftId !== 'number' ||
    typeof report.from !== 'string' ||
    typeof report.to !== 'string' ||
    typeof report.transactionCount !== 'number'
  ) return false;
  const isPaymentSection = (section: unknown) =>
    Boolean(
      section &&
      typeof section === 'object' &&
      'count' in section &&
      typeof section.count === 'number' &&
      'amount' in section &&
      typeof section.amount === 'number' &&
      'byPaymentMethod' in section &&
      Array.isArray(section.byPaymentMethod) &&
      section.byPaymentMethod.every(isShiftPaymentSummary)
    );
  const isCashbookSection = (section: unknown) =>
    Boolean(
      section &&
      typeof section === 'object' &&
      'count' in section &&
      typeof section.count === 'number' &&
      'countIn' in section &&
      typeof section.countIn === 'number' &&
      'countOut' in section &&
      typeof section.countOut === 'number' &&
      'moneyIn' in section &&
      typeof section.moneyIn === 'number' &&
      'moneyOut' in section &&
      typeof section.moneyOut === 'number'
    );
  if (!isPaymentSection(report.sales) || !isPaymentSection(report.returns) || !isCashbookSection(report.cashbook)) {
    return false;
  }
  if (
    !report.bank ||
    typeof report.bank !== 'object' ||
    !isCashbookSection(report.bank) ||
    !('byAccount' in report.bank) ||
    !Array.isArray(report.bank.byAccount) ||
    !report.bank.byAccount.every(isShiftBankAccountSummary)
  ) return false;
  return true;
}

function getErrorMessage(payload: unknown, fallback: string): string {
  return typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof payload.error === 'string'
    ? payload.error
    : fallback;
}

export const ShiftView: React.FC<ShiftViewProps> = ({ currentUser, settings, theme }) => {
  const { language, isRtl } = useLanguage();
  const cashierUsername = currentUser.username.trim();
  const cashierName = currentUser.displayName?.trim() || cashierUsername;
  const currency = settings.currencySymbol || 'SAR';
  const activeFormat: PaperWidth = settings.paperWidth || '80mm';
  const templateSettings = settings.invoiceTemplates?.[activeFormat];
  const invoiceMargins = resolveInvoiceMarginsMm(
    activeFormat,
    templateSettings?.invoiceMarginsMm
  );
  const [activeShift, setActiveShift] = useState<CashierShift | null>(null);
  const [shiftHistory, setShiftHistory] = useState<CashierShift[]>([]);
  const [openingCash, setOpeningCash] = useState('0.00');
  const [closingCash, setClosingCash] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'open' | 'close' | null>(null);
  const [confirmationAction, setConfirmationAction] = useState<'open' | 'close' | null>(null);
  const [confirmationPassword, setConfirmationPassword] = useState('');
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [selectedShift, setSelectedShift] = useState<CashierShift | null>(null);
  const [selectedShiftReport, setSelectedShiftReport] = useState<CashierShiftReport | null>(null);
  const [shiftReportLoading, setShiftReportLoading] = useState(false);
  const [shiftReportError, setShiftReportError] = useState<string | null>(null);
  const [previewBeforePrint, setPreviewBeforePrint] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/shifts?cashierUsername=${encodeURIComponent(cashierUsername)}`
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'Could not load cashier shifts.'));
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('active' in payload) ||
        !('history' in payload) ||
        (payload.active !== null && !isCashierShift(payload.active)) ||
        !Array.isArray(payload.history) ||
        !payload.history.every(isCashierShift)
      ) {
        throw new Error('Cashier shifts response has an invalid format.');
      }
      const overview = payload as ShiftOverview;
      setActiveShift(overview.active);
      setShiftHistory(overview.history);
      setClosingCash(overview.active?.openingCash.toFixed(2) || '');
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [cashierUsername]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  useEffect(() => {
    if (!selectedShift) {
      setSelectedShiftReport(null);
      setShiftReportError(null);
      setShiftReportLoading(false);
      return;
    }

    let active = true;
    setSelectedShiftReport(null);
    setShiftReportError(null);
    setShiftReportLoading(true);
    void fetch(
      `/api/shifts/${selectedShift.id}/report?cashierUsername=${encodeURIComponent(cashierUsername)}`
    )
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, 'Could not load the shift transaction summary.'));
        }
        if (!isCashierShiftReport(payload) || payload.shiftId !== selectedShift.id) {
          throw new Error('Shift report response has an invalid format.');
        }
        if (active) setSelectedShiftReport(payload);
      })
      .catch((reportError: unknown) => {
        if (active) {
          setShiftReportError(
            reportError instanceof Error
              ? reportError.message
              : 'Could not load the shift transaction summary.'
          );
        }
      })
      .finally(() => {
        if (active) setShiftReportLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedShift, cashierUsername]);

  const requestConfirmation = (action: 'open' | 'close') => {
    setConfirmationPassword('');
    setConfirmationError(null);
    setConfirmationAction(action);
  };

  const handleOpenShift = (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(openingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(isRtl ? 'أدخل مبلغاً افتتاحياً صحيحاً.' : 'Enter a valid opening amount.');
      return;
    }
    setError(null);
    requestConfirmation('open');
  };

  const handleCloseShift = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeShift) return;
    const amount = Number(closingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(isRtl ? 'أدخل مبلغاً ختامياً صحيحاً.' : 'Enter a valid closing amount.');
      return;
    }
    setError(null);
    requestConfirmation('close');
  };

  const handleConfirmShiftAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmationAction) return;
    if (!confirmationPassword) {
      setConfirmationError(isRtl ? 'أدخل كلمة المرور الحالية.' : 'Enter your current password.');
      return;
    }
    if (confirmationAction === 'close' && !activeShift) {
      setConfirmationError(isRtl ? 'لا توجد وردية مفتوحة.' : 'There is no open shift to close.');
      return;
    }

    const action = confirmationAction;
    setSaving(action);
    setConfirmationError(null);
    try {
      let response: Response;
      if (action === 'open') {
        response = await fetch('/api/shifts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cashierUsername,
              cashierName,
              openingCash: Number(openingCash),
              password: confirmationPassword,
            }),
          });
      } else {
        if (!activeShift) {
          throw new Error(isRtl ? 'لا توجد وردية مفتوحة.' : 'There is no open shift to close.');
        }
        response = await fetch(`/api/shifts/${activeShift.id}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cashierUsername,
              closingCash: Number(closingCash),
              password: confirmationPassword,
            }),
          });
      }
      const payload: unknown = await response.json();
      if (response.status === 401) {
        throw new Error(isRtl ? 'كلمة المرور الحالية غير صحيحة.' : 'The current password is incorrect.');
      }
      if (!response.ok || !isCashierShift(payload)) {
        throw new Error(getErrorMessage(
          payload,
          action === 'open' ? 'Could not open this shift.' : 'Could not close this shift.'
        ));
      }
      if (action === 'open') {
        setActiveShift(payload);
        setClosingCash(payload.openingCash.toFixed(2));
      } else {
        setActiveShift(null);
        setShiftHistory((history) => [payload, ...history].slice(0, 20));
        setOpeningCash('0.00');
        setClosingCash('');
      }
      setConfirmationAction(null);
      setConfirmationPassword('');
    } catch (actionError) {
      setConfirmationPassword('');
      setConfirmationError((actionError as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US');
  const formatAmount = (amount: number) => `${currency} ${amount.toFixed(2)}`;

  const renderShiftSummary = (compact = false) => {
    if (!selectedShiftReport) return null;
    const report = selectedShiftReport;
    const rowClass = compact
      ? 'flex justify-between gap-3 border-b border-dashed border-slate-300 py-1 text-[10px]'
      : 'flex justify-between gap-3 border-b border-slate-200 py-2 text-xs';
    const headingClass = compact
      ? 'mb-1 text-xs font-bold uppercase text-slate-900'
      : 'mb-2 text-sm font-bold text-slate-900';

    return (
      <section className={compact ? 'mt-4 space-y-3 text-slate-900' : 'space-y-4'}>
        <div>
          <h3 className={headingClass}>{isRtl ? 'ملخص جميع المعاملات' : 'All Transactions Summary'}</h3>
          <div className={rowClass}>
            <span>{isRtl ? 'إجمالي عدد المعاملات' : 'Total transaction count'}</span>
            <strong>{report.transactionCount}</strong>
          </div>
          <div className={rowClass}>
            <span>{isRtl ? 'المبيعات' : 'Sales'} ({report.sales.count})</span>
            <strong>{formatAmount(report.sales.amount)}</strong>
          </div>
          <div className={rowClass}>
            <span>{isRtl ? 'المرتجعات' : 'Sales returns'} ({report.returns.count})</span>
            <strong>{formatAmount(report.returns.amount)}</strong>
          </div>
          <div className={rowClass}>
            <span>{isRtl ? 'إدخالات دفتر النقدية' : 'Cashbook entries'} ({report.cashbook.count})</span>
            <strong>
              {isRtl ? 'داخل' : 'In'} {formatAmount(report.cashbook.moneyIn)} ·{' '}
              {isRtl ? 'خارج' : 'Out'} {formatAmount(report.cashbook.moneyOut)}
            </strong>
          </div>
        </div>

        {(report.sales.byPaymentMethod.length > 0 || report.returns.byPaymentMethod.length > 0) && (
          <div>
            <h3 className={headingClass}>{isRtl ? 'المبيعات والمرتجعات حسب طريقة الدفع' : 'Sales and Returns by Payment Method'}</h3>
            {report.sales.byPaymentMethod.map((item) => (
              <div className={rowClass} key={`sale-${item.paymentMethod}`}>
                <span>{item.paymentMethod} · {isRtl ? 'مبيعات' : 'Sales'} ({item.count})</span>
                <strong>{formatAmount(item.amount)}</strong>
              </div>
            ))}
            {report.returns.byPaymentMethod.map((item) => (
              <div className={rowClass} key={`return-${item.paymentMethod}`}>
                <span>{item.paymentMethod} · {isRtl ? 'مرتجعات' : 'Returns'} ({item.count})</span>
                <strong>{formatAmount(item.amount)}</strong>
              </div>
            ))}
          </div>
        )}

        <div>
          <h3 className={headingClass}>{isRtl ? 'ملخص معاملات البنك' : 'Bank Transaction Summary'}</h3>
          <div className={rowClass}>
            <span>{isRtl ? 'إجمالي معاملات البنك' : 'Bank transaction count'} ({report.bank.count})</span>
            <strong>
              {isRtl ? 'داخل' : 'In'} {formatAmount(report.bank.moneyIn)} ·{' '}
              {isRtl ? 'خارج' : 'Out'} {formatAmount(report.bank.moneyOut)}
            </strong>
          </div>
          {report.bank.byAccount.map((account) => (
            <div className={`${rowClass} ${compact ? 'pl-2' : 'pl-3'}`} key={account.accountName}>
              <span>{account.accountName} ({account.count})</span>
              <strong>
                {isRtl ? 'داخل' : 'In'} {formatAmount(account.moneyIn)} ·{' '}
                {isRtl ? 'خارج' : 'Out'} {formatAmount(account.moneyOut)}
              </strong>
            </div>
          ))}
        </div>
      </section>
    );
  };

  const handlePrintShift = async () => {
    if (!selectedShift) return false;
    if (!selectedShiftReport || selectedShiftReport.shiftId !== selectedShift.id) {
      setPrintError(
        shiftReportLoading
          ? (isRtl ? 'جارٍ تحميل ملخص الوردية.' : 'The shift summary is still loading.')
          : (isRtl ? 'تعذر تحميل ملخص الوردية.' : 'The shift summary is unavailable.')
      );
      return false;
    }
    setPrinting(true);
    setPrintError(null);
    try {
      const thermalWidthMm = activeFormat === '58mm' ? 58 : 80;
      const pageSize = activeFormat === 'A4'
        ? { width: 210_000, height: 297_000 }
        : measureThermalPageSize(
            document.querySelector<HTMLElement>('.shift-print-page:not(.paper-a4)'),
            {
              elementWidthMm: thermalWidthMm,
              pageWidthMm: thermalWidthMm,
              padding: `${invoiceMargins.top}mm ${invoiceMargins.right}mm ${invoiceMargins.bottom}mm ${invoiceMargins.left}mm`,
              container: document.querySelector<HTMLElement>('.shift-print-source'),
            }
          );
      document.body.classList.add('shift-printing');
      try {
        if (window.electronAPI?.isElectron) {
          const printerMode = templateSettings?.printerMode
            || (templateSettings?.defaultPrinter ? 'saved-printer' : 'system-default');
          const removePageStyle = applyThermalPageSize(pageSize);
          try {
            const result = await window.electronAPI.printReceipt({
              silent: printerMode !== 'choose-at-print-time',
              printerName: printerMode === 'saved-printer'
                ? templateSettings?.defaultPrinter || undefined
                : undefined,
              pageSize,
            });
            if (!result.ok) {
              if (['cancelled', 'canceled'].includes(result.error?.toLowerCase() || '')) {
                return false;
              }
              throw new Error(result.error || 'Shift report could not be printed.');
            }
          } finally {
            removePageStyle?.();
          }
        } else if (activeFormat !== 'A4') {
          printWithThermalPageSize(pageSize);
        } else {
          window.print();
        }
      } finally {
        document.body.classList.remove('shift-printing');
      }
      setShowPrintPreview(false);
      return true;
    } catch (printFailure) {
      console.error('Failed to print shift report:', printFailure);
      setPrintError((printFailure as Error).message || 'Shift report could not be printed.');
      return false;
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintAction = async () => {
    if (previewBeforePrint && !showPrintPreview) {
      setPrintError(null);
      setShowPrintPreview(true);
      return;
    }
    await handlePrintShift();
  };

  return (
    <main
      className="pos-app-shell min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6"
      data-theme={theme}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {isRtl ? 'فتح وإغلاق الوردية' : 'Shift Opening & Closing'}
            </h1>
            <p className="text-xs text-slate-500">
              {isRtl ? 'الكاشير:' : 'Cashier:'} {cashierName}
            </p>
          </div>
        </header>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            {isRtl ? 'جارٍ تحميل الورديات...' : 'Loading shifts...'}
          </div>
        ) : activeShift ? (
          <section className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <UnlockKeyhole className="h-4 w-4" />
                  {isRtl ? 'الوردية مفتوحة' : 'Shift is open'}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatDate(activeShift.openedAt)}
                </p>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-medium text-slate-500">
                  {isRtl ? 'الرصيد الافتتاحي' : 'Opening cash'}
                </div>
                <div className="font-mono text-lg font-bold text-slate-900">
                  {formatAmount(activeShift.openingCash)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedShift(activeShift);
                  setShowPrintPreview(false);
                  setPrintError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <FileText className="h-3.5 w-3.5" />
                {isRtl ? 'تفاصيل الوردية' : 'Shift details'}
              </button>
            </div>

            <form onSubmit={handleCloseShift} className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="shift-closing-cash" className="mb-1 block text-xs font-semibold text-slate-700">
                  {isRtl ? 'النقد الفعلي عند الإغلاق' : 'Counted cash at closing'}
                </label>
                <input
                  id="shift-closing-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={closingCash}
                  onChange={(event) => setClosingCash(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                type="submit"
                disabled={saving !== null}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-wait disabled:opacity-60"
              >
                <LockKeyhole className="h-4 w-4" />
                {saving === 'close'
                  ? (isRtl ? 'جارٍ إغلاق الوردية...' : 'Closing shift...')
                  : (isRtl ? 'إغلاق الوردية' : 'Close Shift')}
              </button>
            </form>
          </section>
        ) : (
          <section className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-blue-800">
                <UnlockKeyhole className="h-4 w-4" />
                {isRtl ? 'بدء وردية جديدة' : 'Open a new shift'}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {isRtl ? 'سجّل المبلغ النقدي الموجود في الدرج عند بداية الوردية.' : 'Record the cash in the drawer at the start of the shift.'}
              </p>
            </div>
            <form onSubmit={handleOpenShift} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="shift-opening-cash" className="mb-1 block text-xs font-semibold text-slate-700">
                  {isRtl ? 'الرصيد الافتتاحي النقدي' : 'Opening cash balance'}
                </label>
                <input
                  id="shift-opening-cash"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={openingCash}
                  onChange={(event) => setOpeningCash(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                type="submit"
                disabled={saving !== null}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
              >
                <UnlockKeyhole className="h-4 w-4" />
                {saving === 'open'
                  ? (isRtl ? 'جارٍ فتح الوردية...' : 'Opening shift...')
                  : (isRtl ? 'فتح الوردية' : 'Open Shift')}
              </button>
            </form>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-800">
              {isRtl ? 'الورديات السابقة' : 'Recent shifts'}
            </h2>
          </div>
          {shiftHistory.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {isRtl ? 'لا توجد ورديات مغلقة بعد.' : 'No closed shifts yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">{isRtl ? 'بداية الوردية' : 'Opened'}</th>
                    <th className="px-4 py-2.5 font-semibold">{isRtl ? 'نهاية الوردية' : 'Closed'}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">{isRtl ? 'الرصيد الافتتاحي' : 'Opening cash'}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">{isRtl ? 'الرصيد الختامي' : 'Closing cash'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shiftHistory.map((shift) => (
                    <tr
                      key={shift.id}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="dialog"
                      aria-label={`${isRtl ? 'تفاصيل الوردية' : 'Shift details'} ${shift.id}`}
                      onClick={() => {
                        setSelectedShift(shift);
                        setShowPrintPreview(false);
                        setPrintError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedShift(shift);
                          setShowPrintPreview(false);
                          setPrintError(null);
                        }
                      }}
                      className="cursor-pointer outline-none hover:bg-blue-50 focus-visible:bg-blue-50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(shift.openedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {shift.closedAt ? formatDate(shift.closedAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {formatAmount(shift.openingCash)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        {shift.closingCash === null ? '—' : formatAmount(shift.closingCash)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {confirmationAction && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-password-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmationAction(null);
              setConfirmationPassword('');
              setConfirmationError(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && saving === null) {
              event.preventDefault();
              setConfirmationAction(null);
              setConfirmationPassword('');
              setConfirmationError(null);
            }
          }}
        >
          <section className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 id="shift-password-title" className="text-sm font-bold text-slate-900">
                  {confirmationAction === 'open'
                    ? (isRtl ? 'تأكيد فتح الوردية' : 'Confirm opening shift')
                    : (isRtl ? 'تأكيد إغلاق الوردية' : 'Confirm closing shift')}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {isRtl
                    ? `أدخل كلمة مرور المستخدم ${cashierUsername} للمتابعة.`
                    : `Enter ${cashierUsername}'s current password to continue.`}
                </p>
              </div>
            </header>
            <form onSubmit={handleConfirmShiftAction} className="space-y-4 p-5">
              <div>
                <label htmlFor="shift-confirm-password" className="mb-1.5 block text-xs font-semibold text-slate-700">
                  {isRtl ? 'كلمة المرور الحالية' : 'Current password'}
                </label>
                <input
                  id="shift-confirm-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={confirmationPassword}
                  onChange={(event) => setConfirmationPassword(event.target.value)}
                  aria-describedby={confirmationError ? 'shift-password-error' : undefined}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              {confirmationError && (
                <p id="shift-password-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {confirmationError}
                </p>
              )}
              <footer className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => {
                    setConfirmationAction(null);
                    setConfirmationPassword('');
                    setConfirmationError(null);
                  }}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {isRtl ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={saving !== null || !confirmationPassword}
                  className="rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {saving
                    ? (isRtl ? 'جارٍ التحقق...' : 'Verifying...')
                    : (isRtl ? 'تأكيد' : 'Confirm')}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {selectedShift && (
        <div
          className="shift-report-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-details-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedShift(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              if (showPrintPreview) setShowPrintPreview(false);
              else setSelectedShift(null);
            }
          }}
        >
          <section className={`shift-report-dialog pos-app-shell flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl${showPrintPreview ? ' shift-preview-open' : ''}`}>
            <header className="no-print flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="shift-details-title" className="text-base font-bold text-slate-900">
                  {isRtl ? `تفاصيل الوردية #${selectedShift.id}` : `Shift Details #${selectedShift.id}`}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedShift.closedAt
                    ? (isRtl ? 'وردية مغلقة' : 'Closed shift')
                    : (isRtl ? 'الوردية مفتوحة' : 'Open shift')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedShift(null)}
                autoFocus
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label={isRtl ? 'إغلاق' : 'Close'}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="no-print min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              {printError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {printError}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    label: isRtl ? 'رقم الوردية' : 'Shift ID',
                    value: String(selectedShift.id),
                  },
                  {
                    label: isRtl ? 'الكاشير' : 'Cashier',
                    value: selectedShift.cashierName,
                  },
                  {
                    label: isRtl ? 'اسم المستخدم' : 'Username',
                    value: selectedShift.cashierUsername,
                  },
                  {
                    label: isRtl ? 'الحالة' : 'Status',
                    value: selectedShift.closedAt
                      ? (isRtl ? 'مغلقة' : 'Closed')
                      : (isRtl ? 'مفتوحة' : 'Open'),
                  },
                  {
                    label: isRtl ? 'وقت الفتح' : 'Opened',
                    value: formatDate(selectedShift.openedAt),
                  },
                  {
                    label: isRtl ? 'وقت الإغلاق' : 'Closed',
                    value: selectedShift.closedAt ? formatDate(selectedShift.closedAt) : '—',
                  },
                ].map((detail) => (
                  <article key={detail.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-medium text-slate-500">{detail.label}</p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-900">{detail.value}</p>
                  </article>
                ))}
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-medium text-slate-500">
                    {isRtl ? 'الرصيد الافتتاحي النقدي' : 'Opening cash'}
                  </p>
                  <p className="mt-1 font-mono text-sm font-bold text-slate-900">
                    {formatAmount(selectedShift.openingCash)}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-medium text-slate-500">
                    {isRtl ? 'الرصيد الختامي النقدي' : 'Closing cash'}
                  </p>
                  <p className="mt-1 font-mono text-sm font-bold text-slate-900">
                    {selectedShift.closingCash === null
                      ? '—'
                      : formatAmount(selectedShift.closingCash)}
                  </p>
                </article>
              </div>
              {shiftReportLoading && (
                <p className="text-center text-xs text-slate-500">
                  {isRtl ? 'جارٍ تحميل ملخص المعاملات...' : 'Loading transaction summary...'}
                </p>
              )}
              {shiftReportError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {shiftReportError}
                </div>
              )}
              {renderShiftSummary()}
            </div>

            <footer className="no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={previewBeforePrint}
                  onChange={(event) => setPreviewBeforePrint(event.target.checked)}
                  className="accent-blue-700"
                />
                <span>{isRtl ? 'معاينة قبل الطباعة' : 'Preview before printing'}</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedShift(null)}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {isRtl ? 'إغلاق' : 'Close'}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePrintAction()}
                  disabled={printing || shiftReportLoading || !selectedShiftReport}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {previewBeforePrint && !showPrintPreview
                    ? <Eye className="h-3.5 w-3.5" />
                    : <Printer className="h-3.5 w-3.5" />}
                  {printing
                    ? (isRtl ? 'جارٍ الطباعة...' : 'Printing...')
                    : previewBeforePrint && !showPrintPreview
                      ? (isRtl ? 'معاينة' : 'Preview')
                      : (isRtl ? 'طباعة التقرير' : 'Print report')}
                </button>
              </div>
            </footer>
          </section>

          <div className={`shift-print-source${showPrintPreview ? ' shift-print-preview-active' : ''}`}>
            <article
              className={`shift-print-page ${activeFormat === 'A4' ? 'paper-a4' : activeFormat === '58mm' ? 'paper-58mm' : 'paper-80mm'}`}
              style={{
                '--invoice-margin-top': `${invoiceMargins.top}mm`,
                '--invoice-margin-right': `${invoiceMargins.right}mm`,
                '--invoice-margin-bottom': `${invoiceMargins.bottom}mm`,
                '--invoice-margin-left': `${invoiceMargins.left}mm`,
              } as React.CSSProperties}
            >
              <header className="mb-5 border-b-2 border-slate-900 pb-3 text-center">
                <h1 className="text-lg font-black text-slate-950">{settings.storeName}</h1>
                {settings.storeNameAr && (
                  <p className="mt-1 text-sm font-bold text-slate-800" dir="rtl">{settings.storeNameAr}</p>
                )}
                <p className="mt-3 text-base font-extrabold uppercase tracking-wide text-slate-900">
                  {isRtl ? 'تقرير الوردية' : 'Shift Report'}
                </p>
                <p className="mt-1 text-xs font-mono text-slate-700">#{selectedShift.id}</p>
              </header>
              <div className="space-y-2 text-xs text-slate-900">
                {[
                  [isRtl ? 'الكاشير' : 'Cashier', selectedShift.cashierName],
                  [isRtl ? 'اسم المستخدم' : 'Username', selectedShift.cashierUsername],
                  [isRtl ? 'الحالة' : 'Status', selectedShift.closedAt
                    ? (isRtl ? 'مغلقة' : 'Closed')
                    : (isRtl ? 'مفتوحة' : 'Open')],
                  [isRtl ? 'وقت الفتح' : 'Opened', formatDate(selectedShift.openedAt)],
                  [isRtl ? 'وقت الإغلاق' : 'Closed', selectedShift.closedAt
                    ? formatDate(selectedShift.closedAt)
                    : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-b border-dashed border-slate-300 pb-1.5">
                    <span className="text-slate-600">{label}</span>
                    <span className="min-w-0 break-words text-right font-semibold">{value}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-b border-dashed border-slate-300 pb-1.5">
                  <span className="text-slate-600">{isRtl ? 'الرصيد الافتتاحي' : 'Opening cash'}</span>
                  <span className="font-mono font-semibold">{formatAmount(selectedShift.openingCash)}</span>
                </div>
                <div className="flex justify-between gap-3 border-b border-dashed border-slate-300 pb-1.5">
                  <span className="text-slate-600">{isRtl ? 'الرصيد الختامي' : 'Closing cash'}</span>
                  <span className="font-mono font-semibold">
                    {selectedShift.closingCash === null
                      ? '—'
                      : formatAmount(selectedShift.closingCash)}
                  </span>
                </div>
              </div>
              {renderShiftSummary(true)}
              <footer className="mt-6 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
                {settings.phone ? `${settings.phone} · ` : ''}{settings.address}
              </footer>
            </article>
            {showPrintPreview && (
              <div className="shift-print-controls no-print fixed bottom-4 left-1/2 z-[70] flex w-[min(94vw,480px)] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    {isRtl ? 'معاينة تقرير الوردية' : 'Shift report preview'}
                  </div>
                  {printError && <p role="alert" className="mt-1 text-xs text-red-700">{printError}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPrintPreview(false)}
                    autoFocus
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {isRtl ? 'رجوع' : 'Back'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePrintShift()}
                    disabled={printing || shiftReportLoading || !selectedShiftReport}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    {isRtl ? 'طباعة' : 'Print'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
};
